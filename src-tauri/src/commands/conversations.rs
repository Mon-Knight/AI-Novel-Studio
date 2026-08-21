use crate::db::get_connection;
use crate::errors::AppError;
use crate::services::conversation_service as service;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListConversationsInput {
    pub novel_id: Option<String>,
    pub limit: Option<i64>,
}

#[tauri::command]
pub fn recover_task_runs(input: service::RecoverRunsInput) -> Result<i64, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::recover_interrupted_runs(&mut connection, input)
}

#[tauri::command]
pub fn create_task_conversation(
    input: service::CreateConversationInput,
) -> Result<service::TaskConversationRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::create(&mut connection, input)
}

#[tauri::command]
pub fn list_task_conversations(
    input: ListConversationsInput,
) -> Result<Vec<service::TaskConversationRecord>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::list(
        &connection,
        input.novel_id.as_deref(),
        input.limit.unwrap_or(100),
    )
}

#[tauri::command]
pub fn get_task_conversation(
    conversation_id: String,
) -> Result<Option<service::TaskConversationBundle>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::get(&connection, &conversation_id)
}

#[tauri::command]
pub fn update_task_conversation_model(
    input: service::UpdateConversationModelInput,
) -> Result<service::TaskConversationRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::update_model(&mut connection, input)
}

#[tauri::command]
pub fn append_conversation_turn(
    input: service::AppendTurnInput,
) -> Result<service::ConversationTurnRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::append_turn(&mut connection, input)
}

#[tauri::command]
pub fn create_task_run(input: service::CreateRunInput) -> Result<service::TaskRunRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::create_run(&mut connection, input)
}

#[tauri::command]
pub fn update_task_run(input: service::UpdateRunInput) -> Result<service::TaskRunRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::update_run(&mut connection, input)
}

#[tauri::command]
pub fn append_tool_call_event(
    input: service::AppendToolEventInput,
) -> Result<service::ToolCallEventRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::append_tool_event(&mut connection, input)
}

#[tauri::command]
pub fn update_tool_call_event(
    input: service::UpdateToolEventInput,
) -> Result<service::ToolCallEventRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::update_tool_event(&mut connection, input)
}

#[tauri::command]
pub fn create_conversation_artifact_card(
    input: service::CreateArtifactCardInput,
) -> Result<service::ConversationArtifactCardRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::create_artifact_card(&mut connection, input)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueReviewAuthorizationInput {
    pub authorization_id: String,
    pub decision_id: String,
    pub artifact_id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub issued_at: String,
}

#[tauri::command]
pub fn record_artifact_decision(
    input: service::RecordArtifactDecisionInput,
) -> Result<service::ArtifactDecisionRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::record_artifact_decision(&mut connection, input)
}

#[tauri::command]
pub fn issue_review_authorization(
    input: IssueReviewAuthorizationInput,
) -> Result<service::ReviewAuthorizationRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::issue_review_authorization(
        &mut connection,
        &input.authorization_id,
        &input.decision_id,
        &input.artifact_id,
        &input.novel_id,
        &input.chapter_id,
        &input.issued_at,
    )
}

#[tauri::command]
pub fn consume_review_authorization(
    input: service::ConsumeReviewAuthorizationInput,
) -> Result<service::ReviewAuthorizationRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::consume_review_authorization(&mut connection, input)
}
