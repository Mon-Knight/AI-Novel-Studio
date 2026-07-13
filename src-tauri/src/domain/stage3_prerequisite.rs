use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const INITIALIZATION_CANDIDATE_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CreativeKnowledgeClass {
    AuthorExplicit,
    InferredPreference,
    RequiresConfirmation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceReferenceV1 {
    pub evidence_id: String,
    pub source_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub excerpt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorConfirmationV1 {
    pub status: String,
    #[serde(default)]
    pub confirmed_by: Option<String>,
    #[serde(default)]
    pub confirmed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializationConflictV1 {
    pub code: String,
    pub severity: String,
    pub message: String,
    #[serde(default)]
    pub evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializationCandidateV1 {
    pub candidate_id: String,
    pub target_type: String,
    pub proposed_value: Value,
    pub knowledge_class: CreativeKnowledgeClass,
    pub confidence: f64,
    pub evidence: Vec<EvidenceReferenceV1>,
    pub explanation: String,
    #[serde(default)]
    pub conflicts: Vec<InitializationConflictV1>,
    #[serde(default)]
    pub conflict_acknowledged: bool,
    pub confirmation: AuthorConfirmationV1,
    #[serde(default)]
    pub depends_on_candidate_ids: Vec<String>,
    pub candidate_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentReferenceV1 {
    pub intent_id: String,
    pub revision: i64,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializationCandidateBundleV1 {
    pub schema_version: i64,
    pub bundle_id: String,
    pub novel_id: String,
    pub revision: i64,
    #[serde(default)]
    pub parent_bundle_id: Option<String>,
    pub intent: IntentReferenceV1,
    pub items: Vec<InitializationCandidateV1>,
    pub created_at: String,
    pub content_hash: String,
}
