use crate::db::get_connection;
use crate::errors::AppError;
use crate::services::conversation_service as service;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListConversationsInput {
    pub novel_id: Option<String>,
    #[serde(default)]
    pub include_archived: bool,
    pub limit: Option<i64>,
}

fn reject_client_tool_attestation(snapshot: Option<&Value>) -> Result<(), AppError> {
    if snapshot.is_some_and(|value| value.pointer("/runtime/toolCallingAttestation").is_some()) {
        return Err(AppError::new(
            "MODEL_ATTESTATION_UNTRUSTED",
            "客户端模型快照不得声明模型工具认证；该证明只能由 DSH 运行时写入",
            false,
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn recover_task_runs(input: service::RecoverRunsInput) -> Result<i64, AppError> {
    crate::services::dsh::task_runtime::with_active_runtime_run_ids(|protected_run_ids| {
        let mut connection = get_connection()
            .lock()
            .map_err(|_| AppError::poisoned_lock())?;
        service::recover_interrupted_runs_excluding(&mut connection, input, protected_run_ids)
    })
    .map_err(|_| AppError::poisoned_lock())?
}

#[tauri::command]
pub fn create_task_conversation(
    input: service::CreateConversationInput,
) -> Result<service::TaskConversationRecord, AppError> {
    reject_client_tool_attestation(input.default_model.as_ref())?;
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::create(&mut connection, input)
}

#[tauri::command]
pub fn create_initialized_task_conversation(
    input: service::CreateInitializedConversationInput,
) -> Result<service::InitializedTaskConversation, AppError> {
    reject_client_tool_attestation(Some(&input.default_model))?;
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::create_initialized(&mut connection, input)
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
        input.include_archived,
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
pub fn get_task_turn_run_projection(
    conversation_id: String,
    turn_id: String,
) -> Result<Option<service::TaskTurnRunProjection>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::get_turn_run_projection(&connection, &conversation_id, &turn_id)
}

#[tauri::command]
pub fn update_task_conversation_model(
    input: service::UpdateConversationModelInput,
) -> Result<service::TaskConversationRecord, AppError> {
    reject_client_tool_attestation(Some(&input.default_model))?;
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::update_model(&mut connection, input)
}

#[tauri::command]
pub fn rename_task_conversation(
    input: service::RenameConversationInput,
) -> Result<service::TaskConversationRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::rename(&mut connection, input)
}

#[tauri::command]
pub fn set_task_conversation_archived(
    input: service::SetConversationArchivedInput,
) -> Result<service::TaskConversationRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::set_archived(&mut connection, input)
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
    reject_client_tool_attestation(Some(&input.model_snapshot))?;
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

#[tauri::command]
pub fn publish_structured_candidate(
    input: service::PublishStructuredCandidateInput,
) -> Result<service::ConversationArtifactCardRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::publish_structured_candidate(&mut connection, input)
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
pub fn apply_structured_artifact(
    input: crate::services::structured_artifact_apply_service::ApplyStructuredArtifactInput,
) -> Result<service::ArtifactDecisionRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    crate::services::structured_artifact_apply_service::apply_structured_artifact(
        &mut connection,
        input,
    )
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

#[tauri::command]
pub fn get_review_authorization(
    authorization_id: String,
) -> Result<Option<service::ReviewAuthorizationRecord>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::get_review_authorization(&connection, &authorization_id)
}

#[tauri::command]
pub fn ensure_chapter_summary_follow_up(
    authorization_id: String,
) -> Result<service::ChapterSummaryFollowUp, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::ensure_chapter_summary_follow_up(&mut connection, &authorization_id)
}

#[tauri::command]
pub fn adopt_review_authorized_draft(
    input: service::AdoptReviewAuthorizedDraftInput,
) -> Result<service::AdoptReviewAuthorizedDraftResult, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::adopt_review_authorized_draft(&mut connection, input)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_client_supplied_tool_calling_attestation() {
        assert!(reject_client_tool_attestation(None).is_ok());
        assert!(reject_client_tool_attestation(Some(&json!({
            "runtime": { "adapterProtocol": "ans_task_session_v2" }
        })))
        .is_ok());

        for snapshot in [
            json!({ "runtime": { "toolCallingAttestation": { "verified": true } } }),
            json!({
                "runtime": {
                    "toolCallingAttestation": {
                        "protocol": "ans_model_tool_attestation_v1",
                        "provider": "provider-a",
                        "model": "model-a",
                        "verified": true,
                        "cached": false,
                        "verifiedAt": "2026-08-28T00:00:00Z",
                        "expiresAt": "2026-08-28T00:10:00Z",
                        "cacheTtlMs": 600000,
                        "finishKind": "tool-calls",
                        "observedToolCalls": 1
                    }
                }
            }),
        ] {
            let error = reject_client_tool_attestation(Some(&snapshot))
                .expect_err("client attestation must be rejected");
            assert_eq!(error.code, "MODEL_ATTESTATION_UNTRUSTED");
        }
    }
}
