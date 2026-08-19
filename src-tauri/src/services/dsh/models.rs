//! Serde types mirroring the TS contract (docs/architecture/dsh-feasibility-spike.md §6.2
//! and src/types/chapterPreparation.ts). camelCase wire names, zero logic here.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterPreparationInput {
    pub novel_id: String,
    pub chapter_id: String,
    /// Caller-known current revisions for every source; the proposal must echo them verbatim.
    pub baseline_revisions: Vec<ChapterBaselineRevision>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterBaselineRevision {
    pub source: String,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterPreparationProposal {
    pub schema_version: i64,
    pub planner: String,
    pub target_chapter: TargetChapter,
    pub baseline_revisions: Vec<ChapterBaselineRevision>,
    pub retrieved_evidence: Vec<RetrievedEvidenceItem>,
    pub chapter_goals: Vec<String>,
    pub scene_plan: Vec<ScenePlanItem>,
    pub character_constraints: Vec<CharacterConstraintItem>,
    pub continuity_risks: Vec<ContinuityRiskItem>,
    pub unresolved_questions: Vec<String>,
    pub recommended_actions: Vec<RecommendedActionItem>,
    pub produced_at: String,
    pub metrics: ProposalMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetChapter {
    pub novel_id: String,
    pub chapter_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievedEvidenceItem {
    pub source: String,
    /// Must exactly equal the baseline revision for this source.
    pub revision: i64,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenePlanItem {
    pub title: String,
    pub purpose: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conflicts: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterConstraintItem {
    pub character_id: String,
    pub constraint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinuityRiskItem {
    pub kind: String,
    pub description: String,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendedActionItem {
    /// Only read_tool / ask_user are allowed; any write action rejects the proposal.
    pub r#type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    pub description: String,
}

/// Adapter-owned runtime metrics (the model never sees them).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalMetrics {
    pub planner: String,
    pub duration_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completion_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub process_restarts: Option<i64>,
    /// Present when the adapter normalized a near-miss planner enum (never silent).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub planner_coerced: Option<PlannerCoercion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannerCoercion {
    pub original: String,
    pub distance: usize,
}
