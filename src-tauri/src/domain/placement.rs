use serde::{Deserialize, Serialize};

pub const PLACEMENT_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlacementTarget {
    pub target_type: String,
    pub target_id: String,
    pub novel_id: String,
    pub chapter_id: Option<String>,
    pub draft_id: Option<String>,
    pub action: String,
    pub expected_version: Option<i64>,
    pub expected_hash: Option<String>,
    pub source_priority: i64,
    pub confidence: f64,
    pub reason: String,
    pub is_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlacementProposal {
    pub proposal_id: String,
    pub artifact_id: String,
    pub parent_proposal_id: Option<String>,
    pub schema_version: i64,
    pub targets: Vec<PlacementTarget>,
    pub confidence: f64,
    pub reasons: Vec<String>,
    pub warnings: Vec<String>,
    pub unresolved_items: Vec<String>,
    pub project_revision_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementTargetOverride {
    pub novel_id: String,
    pub chapter_id: String,
    #[serde(default)]
    pub draft_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePlacementProposalInput {
    pub artifact_id: String,
    #[serde(default)]
    pub target: Option<PlacementTargetOverride>,
    #[serde(default)]
    pub parent_proposal_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProposalValidation {
    pub proposal_id: String,
    pub stale: bool,
    pub reason: Option<String>,
    pub current_project_revision_hash: String,
}
