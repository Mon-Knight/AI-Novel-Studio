use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const APPLY_PLAN_SCHEMA_VERSION: i64 = 1;
pub const APPLY_VALIDATOR_VERSION: &str = "single-target-v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApplyPlanStatus {
    Draft,
    Validated,
    Blocked,
    Ready,
    Applying,
    Completed,
    Failed,
    CommitUnknown,
    Cancelled,
}

impl ApplyPlanStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Validated => "validated",
            Self::Blocked => "blocked",
            Self::Ready => "ready",
            Self::Applying => "applying",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::CommitUnknown => "commit_unknown",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOperation {
    pub apply_operation_id: String,
    pub operation_index: i64,
    pub target_type: String,
    pub target_id: String,
    pub action: String,
    pub payload: Value,
    pub payload_hash: String,
    pub expected_version: Option<i64>,
    pub expected_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyDependency {
    pub operation_id: String,
    pub depends_on_operation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyConflict {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPlan {
    pub plan_id: String,
    pub proposal_id: String,
    pub artifact_id: String,
    pub parent_plan_id: Option<String>,
    pub schema_version: i64,
    pub operations: Vec<ApplyOperation>,
    pub dependencies: Vec<ApplyDependency>,
    pub expected_versions: Value,
    pub expected_hashes: Value,
    pub conflicts: Vec<ApplyConflict>,
    pub operation_id: String,
    pub request_hash: String,
    pub status: ApplyPlanStatus,
    pub result: Option<Value>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityFixApplyPayload {
    pub fix_run_id: String,
    #[serde(default)]
    pub fixed_issue_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateApplyPlanInput {
    pub proposal_id: String,
    #[serde(default)]
    pub parent_plan_id: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub quality_fix: Option<QualityFixApplyPayload>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteApplyPlanInput {
    pub plan_id: String,
    pub operation_id: String,
    pub request_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactTargetLink {
    pub link_id: String,
    pub artifact_id: String,
    pub plan_id: String,
    pub apply_operation_id: String,
    pub target_type: String,
    pub target_id: String,
    pub target_version: Option<i64>,
    pub target_hash: Option<String>,
    pub operation_id: String,
    pub result_metadata: Option<Value>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyExecutionResult {
    pub plan_id: String,
    pub operation_id: String,
    pub status: ApplyPlanStatus,
    pub target_links: Vec<ArtifactTargetLink>,
    pub result: Value,
    pub idempotent_replay: bool,
}
