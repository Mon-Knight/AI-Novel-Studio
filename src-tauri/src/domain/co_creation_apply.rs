use crate::domain::apply_plan::ApplyPlan;
use crate::domain::placement::PlacementProposal;
use serde::{Deserialize, Serialize};

pub const CO_CREATION_APPLY_CONTRACT: &str = "co_creation_canon_apply_v1";
pub const CO_CREATION_UNDO_CONTRACT: &str = "co_creation_canon_undo_v1";
pub const CO_CREATION_APPLY_VALIDATOR_VERSION: &str = "co-creation-canon-v1";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareCoCreationApplyInput {
    pub operation_id: String,
    pub novel_id: String,
    pub session_id: String,
    pub draft_revision_id: String,
    pub expected_draft_content_hash: String,
    pub suggestion_ids: Vec<String>,
    #[serde(default)]
    pub parent_plan_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareCoCreationUndoInput {
    pub operation_id: String,
    pub novel_id: String,
    pub completed_plan_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoCreationApplyPreparationV1 {
    pub proposal: PlacementProposal,
    pub plan: ApplyPlan,
    pub affected_targets: Vec<CoCreationAffectedTargetV1>,
    pub impact_warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoCreationAffectedTargetV1 {
    pub target_type: String,
    pub target_id: String,
    pub action: String,
    pub field_paths: Vec<String>,
}
