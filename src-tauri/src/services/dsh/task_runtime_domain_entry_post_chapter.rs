//! Adopted-chapter analysis produces pending domain facts only. Application stays
//! in the existing manual/preauthorization service and never fakes human review.
use super::{context, scoped_plan, value_string, StartTaskTurnInput, TaskRuntimeResult};
use crate::repositories::draft_repository;
use crate::services::{
    artifact_service, draft_service, summary_coverage, summary_grounding, world_rule_governance,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
#[path="task_runtime_domain_entry_post_settings.rs"]
mod post_settings;

pub(super) fn prepare(
    connection: &mut Connection,
    input: &mut StartTaskTurnInput,
    plan_id: &str,
    draft_id: &str,
) -> Result<Value, String> {
    let mut plan = scoped_plan(connection, input.require_novel_id()?, plan_id)?;
    if plan["status"] != "applied" {
        return Err("AUTONOMOUS_PLAN_NOT_APPLIED".to_string());
    }
    let draft = draft_repository::find_draft(connection, draft_id)
        .map_err(|error| error.to_string())?
        .ok_or("DOMAIN_SOURCE_DRAFT_MISSING")?;
    if draft.novel_id != input.require_novel_id()?
        || !draft.is_adopted
        || input
            .chapter_id
            .as_deref()
            .is_some_and(|id| id != draft.chapter_id)
    {
        return Err("DOMAIN_ENTRY_SCOPE_MISMATCH".to_string());
    }
    let current:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM chapters WHERE id=?1 AND novel_id=?2 AND adopted_draft_id=?3 AND deleted_at IS NULL)",params![draft.chapter_id,input.novel_id,draft_id],|row|row.get(0)).map_err(|error|error.to_string())?;
    if !current {
        return Err("DOMAIN_ADOPTED_BASELINE_CHANGED".to_string());
    }
    input.chapter_id = Some(draft.chapter_id.clone());
    let chapter = plan["chapters"]
        .as_array()
        .and_then(|chapters| {
            chapters
                .iter()
                .find(|chapter| chapter["id"] == draft.chapter_id)
        })
        .cloned()
        .ok_or("DOMAIN_ENTRY_SCOPE_MISMATCH")?;
    let verified =
        draft_service::load_full_content(connection, &draft).map_err(|error| error.to_string())?;
    let mut runs = plan["chapterRuns"].as_array().cloned().unwrap_or_default();
    let index = runs
        .iter()
        .rposition(|run| run["chapterId"] == draft.chapter_id)
        .unwrap_or(runs.len());
    let mut run=runs.get(index).cloned().unwrap_or_else(||json!({"runId":format!("adoption:{}",draft.chapter_id),"operationId":format!("autonomous-adoption:{draft_id}"),"chapterId":draft.chapter_id,"chapterNumber":chapter["chapterNumber"],"plannedCharacterBeatIds":chapter["characterBeatIds"],"confirmedCharacterBeatIds":[],"createdAt":draft.updated_at}));
    if run["analysis"]["adoptedDraftId"] == draft_id
        && matches!(
            run["analysis"]["status"].as_str(),
            Some("pending_confirmation" | "confirmed")
        )
    {
        return Ok(json!({"completed":true,"projection":plan}));
    }
    run["status"] = json!("adopted");
    run["adoptedDraftId"] = json!(draft_id);
    run["updatedAt"] = json!(chrono::Utc::now().to_rfc3339());
    run["analysis"] = json!({"status":"running","adoptedDraftId":draft_id,"worldSuggestionIds":[],"updatedAt":run["updatedAt"],"runtimeConversationId":input.conversation_id});
    if index == runs.len() {
        runs.push(run);
    } else {
        runs[index] = run;
    }
    plan["chapterRuns"] = json!(runs);
    plan = super::chapter::save(connection, plan)?;
    let rules = world_rule_governance::rule_set_snapshot(connection, input.require_novel_id()?)
        .map_err(|error| error.to_string())?;
    Ok(
        json!({"entryKind":"autonomous_post_chapter","stageKey":"analyze_adopted","taskKind":"chapter_summary","planId":plan_id,"runIndex":index,"expectedRevision":plan["revision"],"adoptedDraftId":draft_id,"sourceHash":verified.content_hash,"chapterId":draft.chapter_id,"nativeRuleSet":rules,
        "instructions":"仅总结当前已采用稿的实际事件、人物变化与上下文事实。按章节总结契约显式返回 characterChanges/contextRecords 数组并提供grounding；不得推测新增正史，不得声称内容语义正确、已经人工审阅、已应用或已采用。"}),
    )
}

pub(super) fn accept(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    result: &TaskRuntimeResult,
) -> Result<(), String> {
    let stage = context(input)?;
    let plan_id = value_string(stage, "planId")?;
    let mut plan = scoped_plan(connection, input.require_novel_id()?, plan_id)?;
    if plan["revision"] != stage["expectedRevision"] {
        return Err("AUTONOMOUS_PLAN_STATE_CONFLICT".to_string());
    }
    let draft_id = value_string(stage, "adoptedDraftId")?;
    let draft = draft_repository::find_draft(connection, draft_id)
        .map_err(|error| error.to_string())?
        .ok_or("DOMAIN_SOURCE_DRAFT_MISSING")?;
    let current:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM chapters WHERE id=?1 AND novel_id=?2 AND adopted_draft_id=?3 AND deleted_at IS NULL)",params![draft.chapter_id,input.novel_id,draft_id],|row|row.get(0)).map_err(|error|error.to_string())?;
    let verified =
        draft_service::load_full_content(connection, &draft).map_err(|error| error.to_string())?;
    if !current
        || !draft.is_adopted
        || verified.content_hash != stage["sourceHash"].as_str().unwrap_or_default()
    {
        return Err("DOMAIN_ADOPTED_BASELINE_CHANGED".to_string());
    }
    let artifact_id = result
        .artifact_id
        .as_deref()
        .ok_or("DOMAIN_CANDIDATE_REQUIRED")?;
    let artifact = artifact_service::get_artifact_bundle(connection, artifact_id)
        .map_err(|error| error.to_string())?;
    if artifact.artifact.source_novel_id != input.novel_id
        || artifact.artifact.source_chapter_id != input.chapter_id
        || artifact.artifact.artifact_type != "chapter_summary"
    {
        return Err("DOMAIN_CANDIDATE_SCOPE_OR_VALIDATION_INVALID".to_string());
    }
    let mut candidate = summary_grounding::candidate(
        &artifact.raw_content,
        artifact.structured_payload_json.as_ref(),
    );
    if summary_coverage::validate(&candidate, true, summary_coverage::Depth::Complete)
        .iter()
        .any(|issue| issue.severity == "error")
        || summary_grounding::validate(&verified.content, &candidate, true)
            .iter()
            .any(|issue| issue.severity == "error")
    {
        return Err(
            "SUMMARY_BLOCKING_ISSUES: 总结候选包含阻断问题，不得自动进入上下文".to_string(),
        );
    }
    for key in [
        "keyEvents",
        "relationshipChanges",
        "newForeshadows",
        "resolvedForeshadows",
    ] {
        if candidate.get(key).is_none() {
            candidate[key] = json!([]);
        }
    }
    if candidate.get("nextChapterHints").is_none() {
        candidate["nextChapterHints"] = json!("");
    }
    candidate["coverageVersion"] = json!(1);
    candidate["coverage"] = json!({"characterChanges":"explicit","contextRecords":"explicit"});
    let index = stage["runIndex"]
        .as_u64()
        .ok_or("DOMAIN_CHAPTER_RUN_MISSING")? as usize;
    let suggestion_ids=post_settings::project(connection,input.require_novel_id()?,stage,&candidate,artifact_id)?;
    plan["chapterRuns"][index]["analysis"] = json!({"status":"pending_confirmation","adoptedDraftId":draft_id,"result":candidate,"worldSuggestionIds":suggestion_ids,"updatedAt":chrono::Utc::now().to_rfc3339(),"runtimeArtifactId":artifact_id,"runtimeConversationId":input.conversation_id});
    plan["progress"]["lastCheckpoint"] =
        json!("章节分析已生成并验证结构与来源，仍待作者确认；不代表语义正确");
    super::chapter::save(connection, plan).map(|_| ())
}
