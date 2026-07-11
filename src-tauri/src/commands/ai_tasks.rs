use crate::db::get_connection;
use crate::errors::AppError;
use crate::repositories::ai_task_repository::AiTaskRecord;
use crate::services::ai_task_service::{self, AttemptResult, CreateAiTaskInput};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionAiTaskInput {
    pub task_id: String,
    pub expected_status: String,
    pub next_status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAiAttemptInput {
    pub task_id: String,
    pub provider_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteAiAttemptInput {
    pub task_id: String,
    pub attempt_id: String,
    pub response_metadata_json: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailAiAttemptInput {
    pub task_id: String,
    pub attempt_id: String,
    pub error: AppError,
}

#[tauri::command]
pub fn create_ai_task(input: CreateAiTaskInput) -> Result<AiTaskRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_task_service::create_task(&mut connection, input)
}

#[tauri::command]
pub fn get_ai_task(task_id: String) -> Result<Option<AiTaskRecord>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    crate::repositories::ai_task_repository::find(&connection, &task_id)
}

#[tauri::command]
pub fn transition_ai_task(input: TransitionAiTaskInput) -> Result<AiTaskRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_task_service::transition_task(
        &mut connection,
        &input.task_id,
        &input.expected_status,
        &input.next_status,
    )
}

#[tauri::command]
pub fn start_ai_task_attempt(input: StartAiAttemptInput) -> Result<AttemptResult, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_task_service::start_attempt(
        &mut connection,
        &input.task_id,
        input.provider_id.as_deref(),
    )
}

#[tauri::command]
pub fn mark_ai_task_attempt_succeeded(
    input: CompleteAiAttemptInput,
) -> Result<AiTaskRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_task_service::mark_attempt_succeeded(
        &mut connection,
        &input.task_id,
        &input.attempt_id,
        input.response_metadata_json,
    )
}

#[tauri::command]
pub fn fail_ai_task_attempt(input: FailAiAttemptInput) -> Result<AiTaskRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_task_service::fail_attempt(
        &mut connection,
        &input.task_id,
        &input.attempt_id,
        input.error,
    )
}

#[tauri::command]
pub fn cancel_ai_task(task_id: String) -> Result<AiTaskRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_task_service::cancel_task(&mut connection, &task_id)
}

#[tauri::command]
pub fn record_ai_task_late_response(
    input: CompleteAiAttemptInput,
) -> Result<AiTaskRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_task_service::record_late_response(
        &mut connection,
        &input.task_id,
        &input.attempt_id,
        input.response_metadata_json,
    )
}
