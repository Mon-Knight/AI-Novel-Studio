//! One isolated governed carrier stage; the root coordinator owns all transitions.
use super::*;

pub(in super::super) fn execute(
    input: StartTaskTurnInput,
    run_id: String,
    worker_id: String,
    session_id: String,
    process: Arc<WorkerProcess>,
    projection: Arc<Mutex<Option<ProjectionTarget>>>,
    cancel: Arc<AtomicBool>,
    notifier: Option<TaskProjectionObserver>,
    model_tool_attestation: Option<ModelToolAttestation>,
    protocol_recovery_retry: usize,
    previous_terminal_runs: usize,
    chapter_recovery: &mut ChapterLengthRecovery,
) -> Result<TaskRuntimeResult, String> {
    let turn_error = Arc::new(Mutex::new(None));
    let runtime = process.runtime.clone();
    *projection
        .lock()
        .map_err(|_| "DSH 事件投影锁失败".to_string())? = Some(ProjectionTarget {
        session_id: session_id.clone(),
        run_id: run_id.clone(),
        turn_error: turn_error.clone(),
        notifier: notifier.clone(),
        request_identity: process._policy_guard.request_identity_reader(),
        allowed_tools: turn_allowed_tools(&input).to_string(),
        staged_input: input
            .execution
            .as_ref()
            .and_then(|r| r.staged.as_ref())
            .map(|_| {
                let mut cloned = input.clone();
                cloned.api_key.clear();
                Arc::new(cloned)
            }),
    });
    ensure_runtime_initialized_with_timeout(&input, &runtime, |cap| {
        chapter_recovery.timeout(cap, &cancel)
    })?;
    let route = selected_model_route(&input)?;
    let max_tokens = if is_chapter_writing_turn(&input) {
        super::chapter_gate::capped_output_tokens(&input)
    } else {
        input
            .model_snapshot
            .pointer("/options/maxTokens")
            .and_then(Value::as_u64)
            .unwrap_or(8000)
    };
    let before = runtime.snapshot(&session_id).unwrap_or_default();
    let mut turn_prompt =
        chapter_recovery.prompt(&input, protocol_recovery_retry, previous_terminal_runs);
    if input.task_kind == "creative_dialogue" {
        let connection = crate::db::get_connection()
            .lock()
            .map_err(|_| "数据库锁失败".to_string())?;
        turn_prompt.push_str(&super::creative_dialogue::history(&connection, &input)?);
    }
    if let Some(root) = input.execution.as_ref() {
        if let Some(instruction) = root.planned_instruction.as_deref() {
            turn_prompt.push_str(&format!(
                "\n\n原生已核验阶段目标（不扩大权限）：{}",
                instruction
            ));
        }
    }
    let prompt_result = runtime
        .request(
            "session/prompt",
            Some(json!({
                "sessionId":session_id,
                "contentBlocks":[{"type":"text","text":turn_prompt}],
                "route":{
                    "provider":route.harness_provider,
                    "model":route.model,
                    "maxTokens":max_tokens,
                    "reasoningEffort":workbench_reasoning_effort(&input)
                }
            })),
            chapter_recovery.timeout(Duration::from_secs(30), &cancel)?,
        )
        .map_err(|error| safe_supervisor_error(&runtime, "session/prompt 失败", &error))?;
    if prompt_result.get("sessionId").and_then(Value::as_str) != Some(session_id.as_str())
        || prompt_result.get("agentId").and_then(Value::as_str) != Some(session_id.as_str())
    {
        return Err("DSH 持久 Session/Agent 身份响应不匹配".to_string());
    }
    let session_lifecycle = prompt_result
        .get("lifecycle")
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(lifecycle) = session_lifecycle.as_deref() {
        if !matches!(lifecycle, "created" | "continued" | "resumed") {
            return Err(format!("DSH Session 生命周期无效: {}", lifecycle));
        }
    }
    runtime
        .wait_idle_checked_with_cancel(
            &session_id,
            chapter_recovery.timeout(Duration::from_secs(480), &cancel)?,
            Some(&cancel),
        )
        .map_err(|error| {
            if chapter_recovery.remaining_at(Instant::now()).is_zero() {
                runtime.kill();
                CHAPTER_WALL_BUDGET_EXHAUSTED.to_string()
            } else {
                safe_supervisor_error(&runtime, "DSH 回合失败", &error)
            }
        })?;
    let snapshot = runtime.snapshot(&session_id).unwrap_or_default();
    if let Some(error) = turn_error.lock().ok().and_then(|error| error.clone()) {
        let diagnostics = process._proxy_guard.safe_diagnostics();
        return Err(match diagnostics {
            Some(diagnostics) => format!("DSH 回合以错误结束: {} | {}", error, diagnostics),
            None => format!("DSH 回合以错误结束: {}", error),
        });
    }
    let assistant_text = snapshot.last_assistant_text.clone();
    let mut connection = crate::db::get_connection()
        .lock()
        .map_err(|_| "数据库锁失败".to_string())?;
    let open_tools: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM tool_call_events
             WHERE run_id=?1 AND status IN ('pending','queued','running')",
            rusqlite::params![run_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if open_tools != 0 {
        return Err(format!(
            "DSH 回合结束时仍有 {} 个工具调用未收敛",
            open_tools
        ));
    }
    chapter_recovery.timeout(Duration::from_secs(480), &cancel)?;
    let generated = chapter_recovery.read_candidate(&connection, &input, &run_id)?;
    let planned_action = super::creative_dialogue::read_action(&connection, &input, &run_id)?;
    chapter_recovery.timeout(Duration::from_secs(480), &cancel)?;
    super::chapter_continuity::revalidate_now(&connection, &input)?;
    let withhold = super::chapter_gate::withholds_artifact(&input);
    if withhold && generated.is_none() {
        return Err("DSH_EXPECTED_CANDIDATE_RESULT_MISSING".to_string());
    }
    let pending = generated
        .as_ref()
        .filter(|_| withhold)
        .map(|item| super::chapter_gate::pending_candidate(&input, &run_id, &item.text));
    let artifact_id = if withhold {
        None
    } else {
        generated
            .as_ref()
            .map(|generated| {
                create_artifact_projection(
                    &mut connection,
                    &input,
                    &run_id,
                    generated,
                    snapshot.prompt_tokens.saturating_sub(before.prompt_tokens),
                    snapshot
                        .completion_tokens
                        .saturating_sub(before.completion_tokens),
                )
            })
            .transpose()
            .map_err(|error| error.to_string())?
            .flatten()
    };
    if artifact_id.is_some() {
        notify_projection(
            notifier.as_ref(),
            &input.conversation_id,
            &run_id,
            "artifact",
        )?;
    }
    let withheld = pending.is_some();
    let finished_at = now();
    let run = conversation_service::update_run(
        &mut connection,
        UpdateRunInput {
            run_id: run_id.clone(),
            status: if withheld {
                "running".to_string()
            } else {
                "completed".to_string()
            },
            error: withheld.then(|| super::chapter_gate::WITHHELD_ERROR.to_string()),
            updated_at: finished_at.clone(),
            started_at: None,
            finished_at: (!withheld).then_some(finished_at),
        },
    )
    .map_err(|error| error.to_string())?;
    drop(connection);
    notify_projection(
        notifier.as_ref(),
        &input.conversation_id,
        &run_id,
        if withheld { "run" } else { "terminal" },
    )?;
    *projection
        .lock()
        .map_err(|_| "DSH 事件投影锁失败".to_string())? = None;
    let agent_id = session_id.clone();
    Ok(TaskRuntimeResult {
        run,
        session_id,
        agent_id,
        worker_id,
        runtime: "dsh-headless-persistent".to_string(),
        assistant_text: (!assistant_text.trim().is_empty()).then_some(assistant_text),
        artifact_id,
        planned_action,
        session_lifecycle,
        model_tool_attestation,
        pending_chapter_candidate: pending,
    })
}
