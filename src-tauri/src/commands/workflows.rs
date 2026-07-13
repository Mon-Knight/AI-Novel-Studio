use crate::ai_worker::AiWorkerManager;
use crate::db::get_connection;
use crate::errors::AppError;
use crate::services::workflow_service::{
    self, CreateBackgroundWorkflowInput, CreateChapterSummaryWorkflowInput, WorkflowCreated,
};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowActionResult {
    pub task_id: String,
    pub status: String,
    pub affected: usize,
}

#[tauri::command]
pub fn create_chapter_summary_workflow(
    input: CreateChapterSummaryWorkflowInput,
) -> Result<WorkflowCreated, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    workflow_service::create_chapter_summary_workflow(&mut connection, input)
}

#[tauri::command]
pub fn create_background_ai_workflow(
    input: CreateBackgroundWorkflowInput,
) -> Result<WorkflowCreated, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    workflow_service::create_background_workflow(&mut connection, input)
}

#[tauri::command]
pub fn cancel_ai_workflow_task(
    task_id: String,
    manager: State<'_, AiWorkerManager>,
) -> Result<WorkflowActionResult, AppError> {
    let running = {
        let mut connection = get_connection()
            .lock()
            .map_err(|_| AppError::poisoned_lock())?;
        workflow_service::request_cancel(&mut connection, &task_id)?
    };
    for running_task_id in &running {
        manager.cancel(running_task_id);
    }
    Ok(WorkflowActionResult {
        task_id,
        status: "cancel_requested".into(),
        affected: running.len(),
    })
}

#[tauri::command]
pub fn retry_ai_workflow_step(task_id: String) -> Result<WorkflowActionResult, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    workflow_service::retry_child(&connection, &task_id)?;
    Ok(WorkflowActionResult {
        task_id,
        status: "queued".into(),
        affected: 1,
    })
}

#[tauri::command]
pub fn mark_ai_workflow_downstream_stale(
    source_task_id: String,
    reason: String,
) -> Result<WorkflowActionResult, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    let affected = workflow_service::propagate_stale(&mut connection, &source_task_id, &reason)?;
    Ok(WorkflowActionResult {
        task_id: source_task_id,
        status: "stale".into(),
        affected,
    })
}
