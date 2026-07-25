use crate::db::get_connection;
use crate::errors::AppError;
use crate::repositories::ai_task_repository::AiTaskRecord;
use crate::services::ai_task_service::{
    self, AiTaskAttemptResult, AiTaskDetail, ClaimAiTaskAttemptInput, CreateAiTaskInput,
};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskIdInput {
    pub task_id: String,
    pub trace_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAiTasksInput {
    pub novel_id: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkProviderSucceededInput {
    pub task_id: String,
    pub attempt_id: String,
    pub response_metadata_json: Value,
    pub trace_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailAiTaskAttemptInput {
    pub task_id: String,
    pub attempt_id: String,
    pub error: AppError,
    pub trace_id: Option<String>,
}

#[tauri::command]
pub fn create_ai_task(input: CreateAiTaskInput) -> Result<AiTaskRecord, AppError> {
    let trace_id = input.trace_id.clone();
    let operation_id = input.operation_id.clone();
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_task_service::create_task(&mut connection, input)
        .map_err(|error| error.with_context(trace_id.as_deref(), Some(&operation_id)))
}

#[tauri::command]
pub fn get_ai_task(input: AiTaskIdInput) -> Result<AiTaskDetail, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_task_service::get_task_detail(&connection, &input.task_id)
        .map_err(|error| error.with_context(input.trace_id.as_deref(), None))
}

#[tauri::command]
pub fn list_ai_tasks(input: ListAiTasksInput) -> Result<Vec<AiTaskRecord>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_task_service::list_tasks(
        &connection,
        input.novel_id.as_deref(),
        input.limit.unwrap_or(100),
    )
}

#[tauri::command]
pub fn queue_ai_task_attempt(input: AiTaskIdInput) -> Result<AiTaskAttemptResult, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_task_service::queue_attempt(&mut connection, &input.task_id)
        .map_err(|error| error.with_context(input.trace_id.as_deref(), None))
}

#[tauri::command]
pub fn claim_ai_task_attempt(
    input: ClaimAiTaskAttemptInput,
) -> Result<AiTaskAttemptResult, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_task_service::claim_attempt(&mut connection, input)
}

#[tauri::command]
pub fn mark_ai_task_provider_succeeded(
    input: MarkProviderSucceededInput,
) -> Result<AiTaskAttemptResult, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_task_service::mark_provider_succeeded(
        &mut connection,
        &input.task_id,
        &input.attempt_id,
        input.response_metadata_json,
    )
    .map_err(|error| error.with_context(input.trace_id.as_deref(), None))
}

#[tauri::command]
pub fn fail_ai_task_attempt(
    input: FailAiTaskAttemptInput,
) -> Result<AiTaskAttemptResult, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_task_service::fail_attempt(
        &mut connection,
        &input.task_id,
        &input.attempt_id,
        input.error,
    )
    .map_err(|error| error.with_context(input.trace_id.as_deref(), None))
}

#[tauri::command]
pub fn cancel_ai_task(input: AiTaskIdInput) -> Result<AiTaskRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_task_service::cancel_task(&mut connection, &input.task_id)
        .map_err(|error| error.with_context(input.trace_id.as_deref(), None))
}
