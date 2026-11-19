//! Deterministic capabilities share the same native Run lifecycle and root budget.
use super::*;

pub(super) fn local_domain(
    input: &StartTaskTurnInput,
    notifier: Option<TaskProjectionObserver>,
) -> Result<TaskRuntimeResult, String> {
    let root = input
        .execution
        .as_ref()
        .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    root.check()?;
    let mut connection = crate::db::get_connection()
        .lock()
        .map_err(|_| "数据库锁失败".to_string())?;
    let run_id =
        if crate::repositories::conversation_repository::get_run(&connection, &root.root_run_id)
            .map_err(|e| e.to_string())?
            .is_none()
        {
            root.root_run_id.clone()
        } else {
            uuid::Uuid::new_v4().to_string()
        };
    let worker_id = format!("native:{}", input.conversation_id);
    conversation_service::create_run(
        &mut connection,
        CreateRunInput {
            run_id: run_id.clone(),
            conversation_id: input.conversation_id.clone(),
            turn_id: input.turn_id.clone(),
            model_snapshot: input.model_snapshot.clone(),
            worker_id: worker_id.clone(),
            chapter_id: input.chapter_id.clone(),
            created_at: now(),
        },
    )
    .map_err(|e| e.to_string())?;
    conversation_service::update_run(
        &mut connection,
        UpdateRunInput {
            run_id: run_id.clone(),
            status: "running".into(),
            error: None,
            updated_at: now(),
            started_at: Some(now()),
            finished_at: None,
        },
    )
    .map_err(|e| e.to_string())?;
    retry::record_contract(&mut connection, input, &run_id)?;
    domain_entry::record_context(&mut connection, input, &run_id)?;
    staged::begin(&mut connection, input, &run_id)?;
    usage::authorize_tool(&mut connection, root, "chapter.stage_local")?;
    let output = if staged::is_local(input) {
        staged::execute_local(&mut connection, input, &run_id).map(Some)
    } else {
        domain_entry::execute_local(&mut connection, input, &run_id)
    };
    let error = output.as_ref().err().cloned();
    if error.is_some() {
        staged::finish_failed(&mut connection, input, &run_id)?;
    }
    let run = conversation_service::update_run(
        &mut connection,
        UpdateRunInput {
            run_id: run_id.clone(),
            status: if error.is_some() {
                "failed"
            } else {
                "completed"
            }
            .into(),
            error,
            updated_at: now(),
            started_at: Some(now()),
            finished_at: Some(now()),
        },
    )
    .map_err(|e| e.to_string())?;
    notify_projection(
        notifier.as_ref(),
        &input.conversation_id,
        &run_id,
        "terminal",
    )?;
    let result = output?.ok_or("DOMAIN_LOCAL_RESULT_MISSING")?;
    Ok(TaskRuntimeResult {
        run,
        session_id: format!("native:{run_id}"),
        agent_id: format!("native:{run_id}"),
        worker_id,
        runtime: "ans-native-local-command".into(),
        assistant_text: Some(result.to_string()),
        artifact_id: None,
        planned_action: None,
        session_lifecycle: None,
        model_tool_attestation: None,
        pending_chapter_candidate: None,
    })
}
