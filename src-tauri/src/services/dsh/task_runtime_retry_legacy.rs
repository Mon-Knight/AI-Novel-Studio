//! Legacy retry contract recovery: re-derive a verified execution contract from
//! persisted turn/run facts when the host contract tool event is absent.
//!
//! This module only parses existing records; it does not write, adopt or reset budget.

use super::*;

pub(super) fn legacy_contract(
    connection: &rusqlite::Connection,
    bundle: &conversation_service::TaskConversationBundle,
    run_id: &str,
) -> Result<Option<ExecutionContract>, String> {
    let source = bundle
        .runs
        .iter()
        .find(|run| run.run_id == run_id)
        .ok_or(INVALID)?;
    let raw: String = connection.query_row(
        "SELECT content FROM conversation_turns WHERE turn_id=?1 AND conversation_id=?2 AND role='user'",
        rusqlite::params![source.turn_id, source.conversation_id], |row| row.get(0),
    ).map_err(|_| INVALID.to_string())?;
    let (goal, revision) =
        super::super::revision_source::decode_turn(&raw).map_err(|e| e.to_string())?;
    let original_planner = bundle
        .runs
        .iter()
        .take_while(|run| run.run_id != run_id)
        .filter(|run| {
            run.turn_id == source.turn_id
                && run.status == "completed"
                && bundle.tool_events.iter().any(|event| {
                    event.run_id == run.run_id
                        && event.tool_name == "creative.plan_action"
                        && event.status == "succeeded"
                })
        })
        .last();
    let action = if let Some(revision) = revision {
        crate::services::artifact_service::revision_source::verify_source(
            connection,
            &revision,
            bundle
                .conversation
                .novel_id
                .as_deref()
                .ok_or("DSH_NOVEL_SCOPE_REQUIRED")?,
            source.chapter_id.as_deref(),
        )
        .map_err(|e| e.to_string())?;
        let action = match revision.artifact_type.as_str() {
            "setting_candidates" => "prepare_settings",
            "outline" => "generate_outline",
            _ => return Err("DSH_RETRY_LEGACY_CONTRACT_MISSING: 旧修订没有保留执行动作，请重新选择来源候选并发送新要求".into()),
        };
        super::super::creative_dialogue::PlannedAction {
            action: action.into(),
            chapter_id: source.chapter_id.clone(),
            instruction: goal.clone(),
        }
    } else if let Some(planner) = original_planner {
        if model_identity(&planner.model_snapshot) != model_identity(&source.model_snapshot) {
            return Err(INVALID.into());
        }
        super::super::creative_dialogue::read_persisted_action(
            connection,
            bundle
                .conversation
                .novel_id
                .as_deref()
                .ok_or("DSH_NOVEL_SCOPE_REQUIRED")?,
            &planner.run_id,
        )?
        .ok_or(INVALID)?
    } else if bundle
        .tool_events
        .iter()
        .any(|event| event.run_id == run_id && event.tool_name == "creative.plan_action")
        && !bundle.tool_events.iter().any(|event| {
            event.run_id == run_id
                && CANDIDATE_TOOLS
                    .split(',')
                    .any(|tool| tool == event.tool_name)
        })
    {
        return Ok(Some(ExecutionContract {
            goal,
            task_kind: "creative_dialogue".into(),
            expected_tool: None,
            expected_artifact_type: None,
            required_read_tools: Vec::new(),
            chapter_word_range: None,
        }));
    } else {
        return Err("DSH_RETRY_LEGACY_CONTRACT_MISSING: 旧运行没有保留可核验的执行动作，请在输入框确认目标后发送新任务；原失败记录保留".into());
    };
    if action.chapter_id != source.chapter_id {
        return Err(INVALID.into());
    }
    let (kind, tool, artifact, _) = match action.action.as_str() {
        "generate_chapter" => (
            "chapter_write",
            "generate_chapter",
            "chapter_text",
            "生成本章正文",
        ),
        "polish_chapter" => (
            "chapter_polish",
            "polish_chapter",
            "chapter_text",
            "润色本章正文",
        ),
        "prepare_settings" => (
            "setting_expand",
            "expand_settings",
            "setting_candidates",
            "生成世界与规则设定候选",
        ),
        "prepare_characters" => (
            "character_generate",
            "generate_characters",
            "character_candidates",
            "生成主角候选",
        ),
        "generate_outline" if action.chapter_id.is_some() => (
            "outline_generate",
            "generate_outline",
            "outline",
            "生成本章大纲候选",
        ),
        "generate_outline" => (
            "story_plan_generate",
            "generate_outline",
            "outline",
            "生成全书规划候选",
        ),
        "summarize_chapter" => (
            "chapter_summary",
            "summarize_chapter",
            "chapter_summary",
            "总结本章",
        ),
        "check_quality" => (
            "quality_check",
            "check_quality",
            "quality_report",
            "检查本章质量",
        ),
        "suggest_events" => (
            "event_suggest",
            "suggest_events",
            "event_candidates",
            "生成本章事件候选",
        ),
        _ => return Err(INVALID.into()),
    };
    let writing = matches!(kind, "chapter_write" | "chapter_polish");
    let range = if writing {
        let mut verified = None;
        for run in bundle
            .runs
            .iter()
            .take_while(|run| run.run_id != run_id)
            .chain(std::iter::once(source))
            .filter(|run| {
                run.turn_id == source.turn_id
                    && run.chapter_id == source.chapter_id
                    && model_identity(&run.model_snapshot) == model_identity(&source.model_snapshot)
            })
        {
            if let Some(range) = legacy_word_range(run.error.as_deref().unwrap_or("")) {
                if verified.as_ref().is_some_and(|prior| prior != &range) {
                    return Err(INVALID.into());
                }
                verified = Some(range);
            }
        }
        Some(verified.ok_or("DSH_RETRY_LEGACY_RANGE_MISSING: 旧运行没有保留原字数区间，无法安全恢复；请在输入框确认目标章节和字数后发送新任务；原失败记录保留")?)
    } else {
        None
    };
    let mut reads = vec!["novel.read_context".into()];
    if source.chapter_id.is_some() {
        reads.push("chapter.read_outline".into());
    }
    if writing
        || matches!(
            kind,
            "character_generate" | "event_suggest" | "quality_check"
        ) && source.chapter_id.is_some()
    {
        reads.push("get_character_states".into());
    }
    if writing || matches!(kind, "event_suggest" | "quality_check") {
        reads.push("search_memory".into());
    }
    Ok(Some(ExecutionContract {
        goal,
        task_kind: kind.into(),
        expected_tool: Some(tool.into()),
        expected_artifact_type: Some(artifact.into()),
        required_read_tools: reads,
        chapter_word_range: range,
    }))
}

pub(in crate::services::dsh::task_runtime) fn legacy_word_range(
    error: &str,
) -> Option<ChapterWordRangeInput> {
    if !error.starts_with("DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED:") {
        return None;
    }
    let (_, range) = error.split_once("超出宿主区间 ")?;
    let (minimum, rest) = range.split_once('～')?;
    let (maximum, rest) = rest.split_once(" 字（目标 ")?;
    let (target, _) = rest.split_once(" 字）")?;
    let range = ChapterWordRangeInput {
        minimum: minimum.parse().ok()?,
        maximum: maximum.parse().ok()?,
        target: target.parse().ok()?,
    };
    (range.minimum > 0 && range.minimum <= range.target && range.target <= range.maximum)
        .then_some(range)
}
