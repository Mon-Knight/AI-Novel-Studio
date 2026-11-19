//! Trusted-user task preauthorization. These are authority facts, not a second task runtime.
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    ApplyPlanning,
    AdoptChapterText,
    ApplySummary,
}
impl Action {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ApplyPlanning => "apply_planning",
            Self::AdoptChapterText => "adopt_chapter_text",
            Self::ApplySummary => "apply_summary",
        }
    }
    pub fn artifact_type(&self) -> &'static str {
        match self {
            Self::ApplyPlanning => "outline",
            Self::AdoptChapterText => "chapter_text",
            Self::ApplySummary => "chapter_summary",
        }
    }
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Budget {
    pub max_requests: i64,
    pub max_tool_calls: i64,
    pub max_revisions: i64,
    pub max_tokens: i64,
    pub max_cost_usd: f64,
    pub max_wall_clock_ms: i64,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreationScope {
    pub first_volume_index: i64,
    pub last_volume_index: i64,
    pub max_new_volumes: i64,
    pub max_new_chapters: i64,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionLimit {
    pub action: Action,
    pub max_writes: i64,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IssueInput {
    pub conversation_id: String,
    pub novel_id: String,
    pub source_turn_id: String,
    pub chapter_ids: Vec<String>,
    pub allow_novel_planning: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creation_scope: Option<CreationScope>,
    pub actions: Vec<ActionLimit>,
    pub max_writes: i64,
    pub budget: Budget,
    pub expires_at: String,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyInput {
    pub authorization_id: String,
    pub operation_id: String,
    pub card_id: String,
    pub artifact_id: String,
    pub action: Action,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevokeInput {
    pub authorization_id: String,
    #[serde(default)]
    pub reason: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Authorization {
    pub authorization_id: String,
    pub conversation_id: String,
    pub novel_id: String,
    pub source_turn_id: String,
    pub status: String,
    pub revision: i64,
    pub spec: IssueInput,
    pub model_snapshot: Value,
    pub model_snapshot_hash: String,
    pub baseline_hash: String,
    pub used_writes: i64,
    pub issued_at: String,
    pub expires_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revoked_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revocation_reason: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub receipt_id: String,
    pub authorization_id: String,
    pub operation_id: String,
    pub conversation_id: String,
    pub novel_id: String,
    pub artifact_id: String,
    pub card_id: String,
    pub action: Action,
    pub authority: String,
    pub before_hash: String,
    pub after_hash: String,
    pub result: Value,
    pub created_at: String,
    #[serde(default)]
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewSavedDraft {
    pub draft_id: String,
    pub draft_version: i64,
    pub content_hash: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewRenewalPreview {
    pub authorization_id: String,
    pub card_id: String,
    pub conversation_id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub artifact_id: String,
    pub artifact_hash: String,
    pub chapter_baseline_hash: String,
    pub chapter_revision: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adopted_draft_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adopted_content_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saved_draft: Option<ReviewSavedDraft>,
    pub preview_hash: String,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewReviewRenewalInput {
    pub authorization_id: String,
    #[serde(default)]
    pub saved_draft_id: Option<String>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenewReviewInput {
    pub authorization_id: String,
    pub operation_id: String,
    pub expected_preview_hash: String,
    #[serde(default)]
    pub saved_draft_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GetReviewRenewalInput {
    pub authorization_id: String,
    pub operation_id: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewResumeDraft {
    pub draft_id: String,
    pub draft_version: i64,
    pub content_hash: String,
    pub changed_since_renewal: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewResume {
    pub requested_authorization_id: String,
    pub authorization: crate::repositories::conversation_repository::ReviewAuthorizationRecord,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_draft_binding: Option<ReviewResumeDraft>,
}
