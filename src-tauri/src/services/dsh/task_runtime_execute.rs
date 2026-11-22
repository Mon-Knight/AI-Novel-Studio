//! One isolated governed native stage; the root coordinator owns all transitions.
use crate::services::dsh::commands::gateway_database_path;
use crate::services::dsh::native_agent_loop::{run_native_turn, NativeTurnParams};
use crate::services::dsh::native_agent_transport::NativePolicySpec;
use super::*;
use std::time::Instant;

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
    let allowed_tools = turn_allowed_tools(&input).to_string();
    let staged_input = input
        .execution
        .as_ref()
        .and_then(|r| r.staged.as_ref())
        .map(|_| {
            let mut cloned = input.clone();
            cloned.api_key.clear();
            Arc::new(cloned)
        });
    *projection
        .lock()
        .map_err(|_| "DSH 事件投影锁失败".to_string())? = Some(ProjectionTarget {
        session_id: session_id.clone(),
        run_id: run_id.clone(),
        turn_error: turn_error.clone(),
        notifier: notifier.clone(),
        request_identity: process.request_identity.clone(),
        allowed_tools: allowed_tools.clone(),
        staged_input: staged_input.clone(),
    });

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
    let temperature = input
        .model_snapshot
        .pointer("/options/temperature")
        .and_then(Value::as_f64);
    let top_p = input
        .model_snapshot
        .pointer("/options/topP")
        .and_then(Value::as_f64);
    let reasoning_effort = Some(workbench_reasoning_effort(&input).to_string());

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

    let upstream_base = process
        .mock_base_url()
        .unwrap_or_else(|| route.base_url.clone());
    let pricing = input.model_snapshot.get("pricing");
    let owner_hash = large_text_repository::sha256(&input.conversation_id);
    let transport_instance_id = uuid::Uuid::new_v4().simple().to_string();
    let policy_spec = NativePolicySpec {
        owner_id: input
            .execution
            .as_ref()
            .map(|e| e.owner_id.clone())
            .unwrap_or_else(|| format!("dsh-workbench:{}", &owner_hash[..32])),
        request_prefix: format!("dsh:{}:{}", &owner_hash[..32], transport_instance_id),
        max_requests_per_minute: input.request_policy.max_requests_per_minute,
        max_concurrent_requests: input.request_policy.max_concurrent_requests,
        daily_token_budget: input.request_policy.daily_token_budget,
        daily_cost_budget_usd: None,
        input_price_per_million_tokens: pricing
            .and_then(|value| value.get("inputPricePerMillionTokens"))
            .and_then(Value::as_f64),
        output_price_per_million_tokens: pricing
            .and_then(|value| value.get("outputPricePerMillionTokens"))
            .and_then(Value::as_f64),
        warning_percent: input.request_policy.warning_percent,
        ttl_ms: (input.request_policy.timeout_seconds.max(1) * 1_000 + 60_000)
            .clamp(60_000, 2 * 60 * 60_000),
        root: input.execution.clone(),
    };

    let budget_window = chapter_recovery.timeout(Duration::from_secs(480), &cancel)?;
    let deadline = Instant::now() + budget_window;
    let request_timeout = Duration::from_secs(
        u64::try_from(input.request_policy.timeout_seconds.max(1)).unwrap_or(120),
    );
    let candidate_policy = candidate_validation_policy(&input);
    let db_path = gateway_database_path();
    let reset_history = protocol_recovery_retry > 0 || chapter_recovery.is_repairing();
    let conversation_id_for_events = input.conversation_id.clone();
    let request_identity_reader = process.request_identity.clone();

    let turn_outcome = run_native_turn(
        NativeTurnParams {
            session_id: &session_id,
            worker_instance_id: &process.instance_id,
            reset_history,
            system_prompt: workbench_system_prompt(&input),
            user_prompt: &turn_prompt,
            base_url: &upstream_base,
            api_key: &process.upstream_key,
            model: &route.model,
            max_tokens,
            temperature,
            top_p,
            reasoning_effort,
            request_timeout,
            allowed_tools_csv: Some(allowed_tools.as_str()),
            novel_id: input.novel_id.as_deref(),
            chapter_id: input.chapter_id.as_deref(),
            candidate_policy: candidate_policy.as_deref(),
            db_path: &db_path,
            policy: Some(&policy_spec),
            root: input.execution.as_ref(),
            latest_request_identity: Some(&request_identity_reader),
            cancel: &cancel,
            deadline,
        },
        |notification| {
            project_session_event(
                notification,
                &session_id,
                &conversation_id_for_events,
                &run_id,
                &turn_error,
                notifier.as_ref(),
                &request_identity_reader,
                &allowed_tools,
                staged_input.as_deref(),
            )
        },
    )
    .map_err(|error| {
        if chapter_recovery.remaining_at(Instant::now()).is_zero() {
            CHAPTER_WALL_BUDGET_EXHAUSTED.to_string()
        } else {
            safe_runtime_error(&error)
        }
    })?;

    if let Some(error) = turn_error.lock().ok().and_then(|error| error.clone()) {
        return Err(format!("DSH 回合以错误结束: {}", error));
    }

    let assistant_text = turn_outcome.last_assistant_text;
    let session_lifecycle = Some(turn_outcome.lifecycle);
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
                    turn_outcome.prompt_tokens,
                    turn_outcome.completion_tokens,
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
