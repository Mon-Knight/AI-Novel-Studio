//! Finite host dispatch: a model-selected action narrows, never expands, task scope.
use super::*;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalCommand {
    pub kind: String,
    pub target_word_count: i64,
    pub word_range: ChapterWordRangeInput,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WritingPreferences {
    pub target_word_count: Option<i64>,
    pub word_range_percents: WordRangePercents,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WordRangePercents {
    pub hard_minimum_percent: f64,
    pub hard_maximum_percent: f64,
}

pub(super) fn from_action(
    input: &StartTaskTurnInput,
    action: &creative_dialogue::PlannedAction,
    original_chapter: Option<&str>,
) -> Result<StartTaskTurnInput, String> {
    if original_chapter.is_some() && action.chapter_id.as_deref() != original_chapter {
        return Err("DSH_CHILD_SCOPE_EXPANSION: 子任务不能改变父任务绑定章节".into());
    }
    let kind = match action.action.as_str() {
        "prepare_settings" => "setting_expand",
        "prepare_characters" => "character_generate",
        "generate_outline" if action.chapter_id.is_some() => "outline_generate",
        "generate_outline" => "story_plan_generate",
        "generate_chapter" => "chapter_write",
        "polish_chapter" => "chapter_polish",
        "summarize_chapter" => "chapter_summary",
        "check_quality" => "quality_check",
        "suggest_events" => "event_suggest",
        _ => return Err("DSH_CHILD_ACTION_UNKNOWN".into()),
    };
    let (tool, artifact) =
        expected_contract_for_task_kind(kind)?.ok_or("DSH_CHILD_ACTION_UNKNOWN")?;
    let mut child = input.clone();
    child.task_kind = kind.into();
    child.chapter_id = action.chapter_id.clone();
    child.expected_tool = Some(tool.into());
    child.expected_artifact_type = Some(artifact.into());
    child.required_read_tools = vec!["novel.read_context".into()];
    if child.chapter_id.is_some() {
        child
            .required_read_tools
            .push("chapter.read_outline".into());
    }
    if matches!(
        kind,
        "chapter_write" | "chapter_polish" | "quality_check" | "event_suggest"
    ) {
        child
            .required_read_tools
            .push("get_character_states".into());
        child.required_read_tools.push("search_memory".into());
    }
    child.retry_source_run_id = None;
    child.chapter_word_range = None;
    child.chapter_host_gate = None;
    child.verified_continuity = None;
    child.continuity_checked = false;
    Ok(child)
}

pub(super) fn prepare_writing(
    connection: &rusqlite::Connection,
    input: &mut StartTaskTurnInput,
) -> Result<(), String> {
    let chapter = input
        .chapter_id
        .as_deref()
        .ok_or("DSH_CHAPTER_TARGET_REQUIRED")?;
    let configured:i64=connection.query_row("SELECT COALESCE(target_word_count,3000) FROM chapters WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL",
        rusqlite::params![chapter,input.novel_id],|r|r.get(0)).map_err(|_|"DSH_CHAPTER_SCOPE_INVALID".to_string())?;
    let durable = durable_target(connection, input)?;
    let preferences = input
        .unified_runtime
        .as_ref()
        .and_then(|u| u.writing_preferences.as_ref());
    let target = durable.unwrap_or(configured.max(1));
    if let Some(submitted) = preferences.and_then(|p| p.target_word_count) {
        if submitted != target {
            return Err("DSH_CHAPTER_WORD_TARGET_MISMATCH".into());
        }
    }
    if input.chapter_word_range.is_none() {
        let (minimum, maximum) = preferences
            .map(|p| {
                (
                    p.word_range_percents.hard_minimum_percent,
                    p.word_range_percents.hard_maximum_percent,
                )
            })
            .unwrap_or((90.0, 110.0));
        if !minimum.is_finite()
            || !maximum.is_finite()
            || !(1.0..=100.0).contains(&minimum)
            || !(100.0..=200.0).contains(&maximum)
            || target > 100_000
        {
            return Err("DSH_CHAPTER_WORD_RANGE_INVALID".into());
        }
        input.chapter_word_range = Some(ChapterWordRangeInput {
            target,
            minimum: ((target as f64 * minimum / 100.0).ceil() as i64).max(1),
            maximum: (target as f64 * maximum / 100.0).floor() as i64,
        });
    }
    if let Some(range) = &input.chapter_word_range {
        if durable.is_some_and(|v| v != range.target) {
            return Err("DSH_CHAPTER_WORD_TARGET_MISMATCH".into());
        }
    }
    if let Some(root) = input.execution.as_mut() {
        root.writing_range = input.chapter_word_range.clone();
    }
    if input.chapter_host_gate.is_none() {
        input.chapter_host_gate = Some(chapter_gate::ChapterHostGate {
            phase: "draft".into(),
            source_run_id: None,
            content_hash: None,
            issue_codes: vec![],
            issue_severities: vec![],
            max_integrity_repairs: Some(2),
            continues_run_id: None,
            explicit_retry: input.retry_source_run_id.is_some(),
        });
    }
    Ok(())
}

fn durable_target(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
) -> Result<Option<i64>, String> {
    let mut statement=connection.prepare("SELECT content,turn_id FROM conversation_turns WHERE conversation_id=?1 AND role='user' AND sequence<=(SELECT sequence FROM conversation_turns WHERE conversation_id=?1 AND turn_id=?2) ORDER BY sequence DESC").map_err(|e|e.to_string())?;
    let turns = statement
        .query_map(
            rusqlite::params![input.conversation_id, input.turn_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .map_err(|e| e.to_string())?;
    for turn in turns {
        let (raw, id) = turn.map_err(|e| e.to_string())?;
        if raw.contains("[[ANS_WORKBENCH_TURN:v1;origin=") {
            continue;
        }
        let (goal, _) = revision_source::decode_turn(&raw).map_err(|e| e.to_string())?;
        if let Some((target, persistent)) = word_target::parse(&goal)? {
            if id == input.turn_id || persistent {
                return Ok(Some(target));
            }
        }
    }
    Ok(None)
}

pub(in super::super) fn validate_assets(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
) -> Result<(), String> {
    if !is_chapter_writing_turn(input) {
        return Ok(());
    }
    let novel = input.require_novel_id()?;
    let chapter = input.chapter_id.as_deref().unwrap_or("");
    let outline: String = connection
        .query_row(
            "SELECT outline FROM chapters WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL",
            rusqlite::params![chapter, novel],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mut missing = Vec::new();
    if outline.trim().is_empty() {
        missing.push("chapter_outline");
    }
    let worlds:i64=connection.query_row("SELECT COUNT(*) FROM world_settings WHERE novel_id=?1 AND is_active=1 AND LENGTH(TRIM(content))>0",[novel],|r|r.get(0)).map_err(|e|e.to_string())?;
    if worlds == 0 {
        missing.push("world_setting");
    }
    let rules:i64=connection.query_row("SELECT COUNT(*) FROM rule_systems WHERE novel_id=?1 AND is_active=1 AND LENGTH(TRIM(content))>0",[novel],|r|r.get(0)).map_err(|e|e.to_string())?;
    if rules == 0 {
        missing.push("rule_system");
    }
    let protagonists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM protagonists WHERE novel_id=?1 AND LENGTH(TRIM(name))>0",
            [novel],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let profiles: String = connection
        .query_row(
            "SELECT protagonists_json FROM novels WHERE id=?1",
            [novel],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if protagonists == 0
        && !crate::repositories::novel_repository::parse_protagonists_json(&profiles)
            .iter()
            .any(|p| !p.name.trim().is_empty())
    {
        missing.push("protagonist");
    }
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!("GENERATION_CORE_ASSETS_MISSING: {}；需要先准备并由用户审阅或有效预授权应用，不能切换执行框架",missing.join(",")))
    }
}

pub(super) fn local_command(
    input: StartTaskTurnInput,
    notifier: Option<TaskProjectionObserver>,
) -> Result<TaskRuntimeResult, String> {
    let result = {
        let mut connection = crate::db::get_connection()
            .lock()
            .map_err(|_| "数据库锁失败".to_string())?;
        persist_local_command(&mut connection, &input)?
    };
    notify_projection(
        notifier.as_ref(),
        &input.conversation_id,
        &result.run.run_id,
        "terminal",
    )?;
    Ok(result)
}

pub(in super::super) fn persist_local_command(
    connection: &mut rusqlite::Connection,
    input: &StartTaskTurnInput,
) -> Result<TaskRuntimeResult, String> {
    let command = input
        .unified_runtime
        .as_ref()
        .and_then(|u| u.local_command.as_ref())
        .ok_or("DSH_LOCAL_COMMAND_MISSING")?;
    if command.kind != "task_word_target"
        || !word_target::setting_only(&input.goal)?
        || word_target::parse(&input.goal)?.map(|v| v.0) != Some(command.target_word_count)
        || command.word_range.target != command.target_word_count
        || command.word_range.minimum <= 0
        || command.word_range.minimum > command.word_range.target
        || command.word_range.maximum < command.word_range.target
    {
        return Err("DSH_LOCAL_COMMAND_INVALID: 本地设置必须与持久化的纯设置用户指令一致".into());
    }
    let root = input
        .execution
        .as_ref()
        .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    root.check()?;
    let run_id = root.root_run_id.clone();
    let worker_id = format!("native:{}", input.conversation_id);
    let time = now();
    conversation_service::create_run(
        connection,
        CreateRunInput {
            run_id: run_id.clone(),
            conversation_id: input.conversation_id.clone(),
            turn_id: input.turn_id.clone(),
            // This is the identity of the actual no-Provider execution, not a
            // replacement for the task's selected model on a later author turn.
            model_snapshot: json!({
                "providerId": "ans-local",
                "modelId": "workbench-help-v1",
                "runtimeMode": "mock",
                "capabilities": ["conversation_turn"],
                "options": {},
                "runtime": {
                    "adapterProtocol": "ans_local_conversation_v1",
                    "adapterProvider": "ans-local",
                    "bundle": "application",
                    "profile": "workbench-local-help-v1"
                },
                "capturedAt": time
            }),
            worker_id: worker_id.clone(),
            chapter_id: input.chapter_id.clone(),
            created_at: time.clone(),
        },
    )
    .map_err(|e| e.to_string())?;
    let event_id = format!("{run_id}-local-preferences");
    let text = format!(
        "已将本任务章节目标设为 {} 字，当前验收范围为 {}～{} 字；此操作未调用模型，也未保存或采用正文。",
        command.target_word_count, command.word_range.minimum, command.word_range.maximum
    );
    let apply = (|| {
        conversation_service::update_run(
            connection,
            UpdateRunInput {
                run_id: run_id.clone(),
                status: "running".into(),
                error: None,
                updated_at: time.clone(),
                started_at: Some(time.clone()),
                finished_at: None,
            },
        )
        .map_err(|e| e.to_string())?;
        retry::record_contract(connection, input, &run_id)?;
        conversation_service::append_tool_event(
            connection,
            AppendToolEventInput {
                event_id: event_id.clone(),
                run_id: run_id.clone(),
                tool_name: "task.configure_word_target".into(),
                arguments_summary: json!({
                    "source": "ans-host",
                    "targetWordCount": command.target_word_count,
                    "wordRange": command.word_range,
                    "formalWrite": false
                }),
                status: "running".into(),
                duration_ms: None,
                error: None,
                result: None,
                created_at: time,
                finished_at: None,
            },
        )
        .map_err(|e| e.to_string())?;
        conversation_service::update_tool_event(
            connection,
            UpdateToolEventInput {
                event_id: event_id.clone(),
                status: "succeeded".into(),
                duration_ms: Some(0),
                error: None,
                result: Some(json!({"scope": "task", "modelCalled": false})),
                finished_at: Some(now()),
            },
        )
        .map_err(|e| e.to_string())?;
        conversation_service::append_runtime_assistant_turn(
            connection,
            &format!("{run_id}-local-result"),
            &input.conversation_id,
            &run_id,
            &text,
            &now(),
        )
        .map_err(|e| e.to_string())?;
        conversation_service::update_run(
            connection,
            UpdateRunInput {
                run_id: run_id.clone(),
                status: "completed".into(),
                error: None,
                updated_at: now(),
                started_at: None,
                finished_at: Some(now()),
            },
        )
        .map_err(|e| e.to_string())
    })();
    let run = match apply {
        Ok(run) => run,
        Err(error) => {
            let error = safe_runtime_error(&error);
            // The run row already exists. Close any active internal events before
            // marking it failed; never ship an orphan active local run to the UI.
            for event_id in [event_id, format!("{run_id}-execution-contract")] {
                let _ = conversation_service::update_tool_event(
                    connection,
                    UpdateToolEventInput {
                        event_id,
                        status: "failed".into(),
                        duration_ms: None,
                        error: Some(error.clone()),
                        result: None,
                        finished_at: Some(now()),
                    },
                );
            }
            conversation_service::update_run(
                connection,
                UpdateRunInput {
                    run_id: run_id.clone(),
                    status: "failed".into(),
                    error: Some(error.clone()),
                    updated_at: now(),
                    started_at: None,
                    finished_at: Some(now()),
                },
            )
            .map_err(|settlement| format!("{error}；本地运行终止写入失败：{settlement}"))?;
            return Err(error);
        }
    };
    Ok(TaskRuntimeResult {
        run,
        session_id: format!("native:{run_id}"),
        agent_id: format!("native:{run_id}"),
        worker_id,
        runtime: "ans-native-local-command".into(),
        assistant_text: Some(text),
        artifact_id: None,
        planned_action: None,
        session_lifecycle: None,
        model_tool_attestation: None,
        pending_chapter_candidate: None,
    })
}
