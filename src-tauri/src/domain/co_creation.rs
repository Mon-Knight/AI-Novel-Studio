use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CO_CREATION_SCHEMA_VERSION: i64 = 1;
pub const CO_CREATION_WORKSPACE_TYPE: &str = "ai_co_creation";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoCreationTurnContextV1 {
    pub current_stage: String,
    pub canonical_data_hash: String,
    pub data_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoCreationSessionV1 {
    pub session_id: String,
    pub novel_id: String,
    pub workspace_type: String,
    pub status: String,
    pub revision: i64,
    pub state_hash: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoCreationMessageV1 {
    pub message_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub sequence_no: i64,
    pub role: String,
    pub status: String,
    pub content: String,
    pub content_hash: String,
    pub content_length: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_to_message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_context: Option<CoCreationTurnContextV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<Value>,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoCreationDraftRevisionV1 {
    pub draft_revision_id: String,
    pub session_id: String,
    pub stage_key: String,
    pub revision_no: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_revision_id: Option<String>,
    pub schema_version: i64,
    pub payload: Value,
    pub content_hash: String,
    pub origin: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_artifact_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoCreationWorkspaceV1 {
    pub schema_version: i64,
    pub session: CoCreationSessionV1,
    pub messages: Vec<CoCreationMessageV1>,
    pub draft_revisions: Vec<CoCreationDraftRevisionV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenCoCreationWorkspaceResultV1 {
    pub created: bool,
    pub workspace: CoCreationWorkspaceV1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoCreationMutationReceiptV1 {
    pub session_id: String,
    pub operation_id: String,
    pub operation_type: String,
    pub revision: i64,
    pub state_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft_revision_id: Option<String>,
    pub idempotent_replay: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenCoCreationWorkspaceInput {
    pub novel_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadCoCreationWorkspaceInput {
    pub novel_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoverCoCreationTurnTaskInput {
    pub novel_id: String,
    pub session_id: String,
    pub user_message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredCoCreationTurnTaskV1 {
    pub task_id: String,
    pub current_stage: String,
    pub canonical_data_hash: String,
    pub data_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppendCoCreationUserMessageInput {
    pub novel_id: String,
    pub session_id: String,
    pub expected_revision: i64,
    pub expected_state_hash: String,
    pub operation_id: String,
    #[serde(default)]
    pub request_hash: Option<String>,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BindCoCreationTurnTaskInput {
    pub novel_id: String,
    pub session_id: String,
    pub user_message_id: String,
    pub task_id: String,
    pub expected_revision: i64,
    pub expected_state_hash: String,
    pub operation_id: String,
    #[serde(default)]
    pub request_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompleteCoCreationTurnInput {
    pub novel_id: String,
    pub session_id: String,
    pub user_message_id: String,
    pub task_id: String,
    pub artifact_id: String,
    pub expected_revision: i64,
    pub expected_state_hash: String,
    pub operation_id: String,
    #[serde(default)]
    pub request_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FailCoCreationTurnInput {
    pub novel_id: String,
    pub session_id: String,
    pub user_message_id: String,
    pub task_id: String,
    pub error_code: String,
    pub error_message: String,
    pub expected_revision: i64,
    pub expected_state_hash: String,
    pub operation_id: String,
    #[serde(default)]
    pub request_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveCoCreationDraftRevisionInput {
    pub novel_id: String,
    pub session_id: String,
    pub stage_key: String,
    pub schema_version: i64,
    pub payload: Value,
    pub origin: String,
    #[serde(default)]
    pub source_message_id: Option<String>,
    #[serde(default)]
    pub source_task_id: Option<String>,
    #[serde(default)]
    pub source_artifact_id: Option<String>,
    pub expected_draft_revision: i64,
    #[serde(default)]
    pub expected_draft_content_hash: Option<String>,
    pub expected_revision: i64,
    pub expected_state_hash: String,
    pub operation_id: String,
    #[serde(default)]
    pub request_hash: Option<String>,
}
