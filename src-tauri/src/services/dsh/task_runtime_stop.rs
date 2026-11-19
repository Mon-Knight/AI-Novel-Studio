//! Root stop facts and cleanup. An error must not strand a withheld running candidate.
use super::*;

pub(super) fn record_stop(
    connection: &mut rusqlite::Connection,
    input: &StartTaskTurnInput,
    error: &str,
) -> Result<(), String> {
    let root = input
        .execution
        .as_ref()
        .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    let latest:Option<(String,String)>=connection.query_row("SELECT r.run_id,r.status FROM task_runs r JOIN tool_call_events e ON e.run_id=r.run_id AND e.tool_name='dsh.execution_contract' AND e.status='succeeded' WHERE r.conversation_id=?1 AND json_extract(e.arguments_summary_json,'$.execution.rootTurnId')=?2 ORDER BY r.created_at DESC,e.sequence DESC LIMIT 1",rusqlite::params![input.conversation_id,root.root_turn_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|e.to_string())?;
    let (run_id, status) = if let Some(latest) = latest {
        latest
    } else {
        let id = root.root_run_id.clone();
        conversation_service::create_run(
            connection,
            CreateRunInput {
                run_id: id.clone(),
                conversation_id: input.conversation_id.clone(),
                turn_id: input.turn_id.clone(),
                model_snapshot: input.model_snapshot.clone(),
                worker_id: format!("native-root:{}", root.root_run_id),
                chapter_id: input.chapter_id.clone(),
                created_at: now(),
            },
        )
        .map_err(|e| e.to_string())?;
        record_minimal_contract(connection, input, &id)?;
        (id, "queued".into())
    };
    let safe = safe_runtime_error(error);
    let cancelled = root.cancel.load(Ordering::SeqCst);
    if matches!(status.as_str(), "queued" | "running" | "cancel_requested") {
        conversation_service::terminalize_open_tool_events(
            connection,
            &run_id,
            if cancelled { "cancelled" } else { "failed" },
            &safe,
            &now(),
        )
        .map_err(|e| e.to_string())?;
        conversation_service::update_run(
            connection,
            UpdateRunInput {
                run_id: run_id.clone(),
                status: if cancelled { "cancelled" } else { "failed" }.into(),
                error: Some(safe.clone()),
                updated_at: now(),
                started_at: None,
                finished_at: Some(now()),
            },
        )
        .map_err(|e| e.to_string())?;
    }
    let event_id = format!("{run_id}-root-stop");
    if connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM tool_call_events WHERE event_id=?1)",
            [&event_id],
            |r| r.get::<_, bool>(0),
        )
        .map_err(|e| e.to_string())?
    {
        return Ok(());
    }
    host_facts::append(connection,AppendToolEventInput{event_id,run_id:run_id.clone(),tool_name:"dsh.root_stop".into(),arguments_summary:json!({"source":"ans-native-host","rootTaskId":input.conversation_id,"rootTurnId":root.root_turn_id,"reason":safe,"committedTransactionsPreserved":true}),status:if cancelled{"cancelled"}else{"failed"}.into(),duration_ms:None,error:Some(safe.clone()),result:Some(json!({"newAuthorizedWritesStopped":true,"modelReplayed":false})),created_at:now(),finished_at:Some(now())}).map_err(|e|e.to_string())?;
    conversation_service::append_runtime_assistant_turn(
        connection,
        &format!("{run_id}-root-stop-message"),
        &input.conversation_id,
        &run_id,
        &format!(
            "任务已停止：{}。已提交的事务保留，未完成阶段不会被报告为全部成功或全部撤销。",
            safe
        ),
        &now(),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn record_minimal_contract(
    connection: &mut rusqlite::Connection,
    input: &StartTaskTurnInput,
    run_id: &str,
) -> Result<(), String> {
    let text = serde_json::to_string(&retry::ExecutionContract::from_input(input))
        .map_err(|e| e.to_string())?;
    let hash = large_text_repository::sha256(&text);
    let event_id = format!("{run_id}-execution-contract");
    let document_id = format!("{event_id}-result");
    large_text_repository::insert_document_for_target(
        connection,
        &document_id,
        "tool_event",
        &event_id,
        "result",
        None,
        &text,
        &hash,
        &now(),
    )
    .map_err(|e| e.to_string())?;
    host_facts::append(connection,AppendToolEventInput{event_id,run_id:run_id.into(),tool_name:"dsh.execution_contract".into(),arguments_summary:json!({"source":"ans-host","taskKind":input.task_kind,"preflightFailure":true,"execution":execution::execution_metadata(input),"requestTimeoutSeconds":input.request_policy.timeout_seconds}),status:"succeeded".into(),duration_ms:None,error:None,result:Some(json!({"largeTextRefId":document_id,"contentHash":hash})),created_at:now(),finished_at:Some(now())}).map_err(|e|e.to_string())?;
    Ok(())
}
