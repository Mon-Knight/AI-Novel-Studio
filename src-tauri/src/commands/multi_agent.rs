use crate::db::get_connection;
use crate::errors::AppError;
use crate::repositories::multi_agent_repository::{
    MultiAgentSessionBundle, MultiAgentSessionRecord,
};
use crate::services::multi_agent_service::{
    self, AppendMultiAgentRoundInput, CompleteMultiAgentSessionInput, CreateMultiAgentSessionInput,
};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiAgentSessionIdInput {
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMultiAgentSessionsInput {
    pub chapter_id: String,
    pub limit: Option<i64>,
}

#[tauri::command]
pub fn create_multi_agent_session(
    input: CreateMultiAgentSessionInput,
) -> Result<MultiAgentSessionBundle, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    multi_agent_service::create_session(&mut connection, input)
}

#[tauri::command]
pub fn append_multi_agent_round(
    input: AppendMultiAgentRoundInput,
) -> Result<MultiAgentSessionBundle, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    multi_agent_service::append_round(&mut connection, input)
}

#[tauri::command]
pub fn complete_multi_agent_session(
    input: CompleteMultiAgentSessionInput,
) -> Result<MultiAgentSessionBundle, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    multi_agent_service::complete_session(&mut connection, input)
}

#[tauri::command]
pub fn get_multi_agent_session(
    input: MultiAgentSessionIdInput,
) -> Result<MultiAgentSessionBundle, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    multi_agent_service::get_session_bundle(&connection, &input.session_id)
}

#[tauri::command]
pub fn list_multi_agent_sessions_by_chapter(
    input: ListMultiAgentSessionsInput,
) -> Result<Vec<MultiAgentSessionRecord>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    multi_agent_service::list_sessions_by_chapter(
        &connection,
        &input.chapter_id,
        input.limit.unwrap_or(20),
    )
}
