use crate::domain::context::{
    SaveChapterSummaryInput, SaveCharacterStateInput, SaveContextRecordInput,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

// ==================== Chapter Engineering State & Generation Snapshot ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterEngineeringStateDto {
    pub id: String,
    pub novel_id: String,
    pub volume_id: Option<String>,
    pub chapter_id: String,
    pub chapter_card_json: String,
    pub scene_plan_json: String,
    pub generation_constraints_json: String,
    pub quality_rules_json: String,
    pub draft_version: i64,
    pub active_version: i64,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub activated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveChapterEngineeringDraftInput {
    pub novel_id: String,
    pub volume_id: Option<String>,
    pub chapter_id: String,
    pub chapter_card_json: String,
    pub scene_plan_json: String,
    pub generation_constraints_json: String,
    pub quality_rules_json: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterGenerationSnapshotDto {
    pub id: String,
    pub novel_id: String,
    pub volume_id: Option<String>,
    pub chapter_id: String,
    pub engineering_state_id: Option<String>,
    pub style_profile_id: Option<String>,
    pub output_profile_id: Option<String>,
    pub compiled_context_json: String,
    pub compiled_prompt_text: String,
    pub prompt_summary: String,
    pub context_hash: String,
    pub sources_json: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveChapterGenerationSnapshotInput {
    pub id: String,
    pub novel_id: String,
    pub volume_id: Option<String>,
    pub chapter_id: String,
    pub engineering_state_id: Option<String>,
    pub style_profile_id: Option<String>,
    pub output_profile_id: Option<String>,
    pub compiled_context_json: String,
    pub compiled_prompt_text: String,
    pub prompt_summary: String,
    pub context_hash: String,
    pub sources_json: String,
    pub created_at: String,
}

// ==================== Generation Jobs & Steps ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GenerationJobDto {
    pub id: String,
    pub world_id: Option<String>,
    pub novel_id: String,
    pub volume_id: Option<String>,
    pub chapter_id: String,
    pub job_type: String,
    pub status: String,
    pub current_step: Option<String>,
    pub progress_percent: i64,
    pub provider: Option<String>,
    pub model_name: Option<String>,
    pub input_token_estimate: Option<i64>,
    pub output_token_estimate: Option<i64>,
    pub actual_input_tokens: Option<i64>,
    pub actual_output_tokens: Option<i64>,
    pub cost_estimate: Option<f64>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub retry_count: i64,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGenerationJobInput {
    pub id: String,
    pub world_id: Option<String>,
    pub novel_id: String,
    pub volume_id: Option<String>,
    pub chapter_id: String,
    pub job_type: String,
    pub status: String,
    pub current_step: Option<String>,
    pub progress_percent: i64,
    pub provider: Option<String>,
    pub model_name: Option<String>,
    pub retry_count: i64,
    pub created_at: String,
    pub started_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGenerationJobInput {
    pub id: String,
    pub status: Option<String>,
    pub current_step: Option<String>,
    pub progress_percent: Option<i64>,
    pub provider: Option<String>,
    pub model_name: Option<String>,
    pub input_token_estimate: Option<i64>,
    pub output_token_estimate: Option<i64>,
    pub actual_input_tokens: Option<i64>,
    pub actual_output_tokens: Option<i64>,
    pub cost_estimate: Option<f64>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub retry_count: Option<i64>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GenerationStepResultDto {
    pub id: String,
    pub job_id: String,
    pub step_name: String,
    pub status: String,
    pub input_snapshot_json: Option<String>,
    pub output_json: Option<String>,
    pub output_text: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGenerationStepResultInput {
    pub id: String,
    pub job_id: String,
    pub step_name: String,
    pub status: String,
    pub input_snapshot_json: Option<String>,
    pub output_json: Option<String>,
    pub output_text: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StartupTaskRecoveryDto {
    pub recovered_jobs: i64,
    pub recovered_at: String,
}

// ==================== AI Task Records ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskRecordDto {
    pub id: String,
    pub novel_id: Option<String>,
    pub chapter_id: Option<String>,
    pub task_type: String,
    pub status: String,
    pub runtime_mode: Option<String>,
    pub provider: Option<String>,
    pub model_name: Option<String>,
    pub prompt_template_id: Option<String>,
    pub input_summary: Option<String>,
    pub prompt_snapshot: Option<String>,
    pub result_text: Option<String>,
    pub result_json: Option<String>,
    pub error_message: Option<String>,
    pub token_input: Option<i64>,
    pub token_output: Option<i64>,
    pub token_total: Option<i64>,
    pub input_price_per_million_tokens: Option<f64>,
    pub output_price_per_million_tokens: Option<f64>,
    pub cost_estimate: Option<f64>,
    pub cost_currency: Option<String>,
    pub cost_status: Option<String>,
    pub pricing_source: Option<String>,
    pub duration_ms: Option<i64>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAiTaskRecordInput {
    pub id: String,
    pub novel_id: Option<String>,
    pub chapter_id: Option<String>,
    pub task_type: String,
    pub status: String,
    pub runtime_mode: Option<String>,
    pub provider: Option<String>,
    pub model_name: Option<String>,
    pub input_price_per_million_tokens: Option<f64>,
    pub output_price_per_million_tokens: Option<f64>,
    pub cost_currency: Option<String>,
    pub pricing_source: Option<String>,
    pub input_summary: Option<String>,
    pub started_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkAiTaskSucceededInput {
    pub result_text: Option<String>,
    pub prompt_snapshot: Option<String>,
    pub result_json: Option<String>,
    pub token_input: Option<i64>,
    pub token_output: Option<i64>,
    pub token_total: Option<i64>,
    pub duration_ms: Option<i64>,
    pub finished_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAiTaskRecordsInput {
    pub ids: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAiTaskRecordsResult {
    pub deleted_count: i64,
    pub requested_count: i64,
    pub before_count: i64,
    pub after_count: i64,
    pub before_match_count: i64,
    pub after_match_count: i64,
    pub affected_rows: i64,
    pub db_path: String,
    pub deleted_child_rows: HashMap<String, i64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskRecordsDebugState {
    pub db_path: String,
    pub table_exists: bool,
    pub total_count: i64,
    pub matched_count: Option<i64>,
    pub sample_ids: Vec<String>,
}

// ==================== Style Profiles ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StyleProfileDto {
    pub id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub narrative_perspective: Option<String>,
    pub tone: Option<String>,
    pub pace: Option<String>,
    pub sentence_style: Option<String>,
    pub dialogue_ratio: f64,
    pub description_ratio: f64,
    pub psychological_ratio: Option<f64>,
    pub battle_style: Option<String>,
    pub battle_intensity: Option<String>,
    pub emotion_tendency: Option<String>,
    pub chapter_ending: Option<String>,
    pub forbidden_styles_json: Option<String>,
    pub style_summary: Option<String>,
    pub raw_config_json: Option<String>,
    pub is_active: bool,
    pub source_type: String,
    pub source_asset_id: Option<String>,
    pub source_reference_work_id: Option<String>,
    pub source_reference_import_id: Option<String>,
    pub source_content_sha256: Option<String>,
    pub source_state: String,
    pub analysis_metadata_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveStyleProfileInput {
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub narrative_perspective: Option<String>,
    pub tone: Option<String>,
    pub pace: Option<String>,
    pub sentence_style: Option<String>,
    pub dialogue_ratio: Option<f64>,
    pub description_ratio: Option<f64>,
    pub psychological_ratio: Option<f64>,
    pub battle_style: Option<String>,
    pub battle_intensity: Option<String>,
    pub emotion_tendency: Option<String>,
    pub chapter_ending: Option<String>,
    pub forbidden_styles: Option<Vec<String>>,
    pub style_summary: Option<String>,
    pub raw_config_json: Option<String>,
    pub source_type: Option<String>,
    pub source_asset_id: Option<String>,
    pub source_reference_work_id: Option<String>,
    pub source_reference_import_id: Option<String>,
    pub source_content_sha256: Option<String>,
    pub source_state: Option<String>,
    pub analysis_metadata_json: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct UpdateStyleProfileInput {
    pub id: String,
    pub project_id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub narrative_perspective: Option<String>,
    pub tone: Option<String>,
    pub pace: Option<String>,
    pub sentence_style: Option<String>,
    pub dialogue_ratio: Option<f64>,
    pub description_ratio: Option<f64>,
    pub psychological_ratio: Option<f64>,
    pub battle_style: Option<String>,
    pub battle_intensity: Option<String>,
    pub emotion_tendency: Option<String>,
    pub chapter_ending: Option<String>,
    pub forbidden_styles: Option<Vec<String>>,
    pub style_summary: Option<String>,
    pub raw_config_json: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetActiveStyleProfileInput {
    pub project_id: String,
    pub style_profile_id: String,
}

// ==================== Quality Check ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QualityCheckReportDto {
    pub id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub draft_id: String,
    pub scope: String,
    pub status: String,
    pub overall_score: Option<i64>,
    pub summary: Option<String>,
    pub ai_task_id: Option<String>,
    pub draft_version: Option<i64>,
    pub model: Option<String>,
    pub content_hash: Option<String>,
    pub content_length: Option<i64>,
    pub checked_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QualityCheckItemDto {
    pub id: String,
    pub report_id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub draft_id: String,
    pub issue_type: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub category: Option<String>,
    pub evidence: Option<String>,
    pub suggestion: Option<String>,
    pub quote: Option<String>,
    pub start_offset: Option<i64>,
    pub end_offset: Option<i64>,
    pub paragraph_index: Option<i64>,
    pub issue_key: String,
    pub status: String,
    pub resolution_note: Option<String>,
    pub resolved_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QualityCheckStatisticsDto {
    pub total: i64,
    pub pending: i64,
    pub resolved: i64,
    pub ignored: i64,
    pub critical: i64,
    pub high: i64,
    pub medium: i64,
    pub low: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GetQualityCheckIssuesResult {
    pub report: Option<QualityCheckReportDto>,
    pub items: Vec<QualityCheckItemDto>,
    pub statistics: QualityCheckStatisticsDto,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateQualityReportInput {
    pub novel_id: String,
    pub chapter_id: String,
    pub draft_id: String,
    pub scope: Option<String>,
    pub content_hash: Option<String>,
    pub content_length: Option<i64>,
    pub checked_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveQualityCheckResultInput {
    pub report_id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub draft_id: String,
    pub result: QualityCheckResultDto,
    pub draft_version: Option<i64>,
    pub model: Option<String>,
    pub content_hash: Option<String>,
    pub content_length: Option<i64>,
    pub checked_at: Option<String>,
    pub ai_task_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityCheckResultDto {
    pub overall_score: Option<i64>,
    pub summary: Option<String>,
    pub items: Vec<QualityCheckResultItemDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityCheckResultItemDto {
    pub issue_type: Option<String>,
    pub severity: Option<String>,
    pub category: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub evidence: Option<String>,
    pub suggestion: Option<String>,
    pub quote: Option<String>,
    pub start_offset: Option<i64>,
    pub end_offset: Option<i64>,
    pub paragraph_index: Option<i64>,
    pub issue_key: Option<String>,
}

// ==================== Quality Fix Runs ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QualityFixRunDto {
    pub id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub source_draft_id: String,
    pub source_draft_version: i64,
    pub target_draft_id: Option<String>,
    pub target_draft_version: Option<i64>,
    pub source_content_hash: Option<String>,
    pub target_content_hash: Option<String>,
    pub before_report_id: Option<String>,
    pub after_report_id: Option<String>,
    pub before_score: Option<i64>,
    pub after_score: Option<i64>,
    pub before_pending_count: i64,
    pub after_pending_count: Option<i64>,
    pub before_serious_count: i64,
    pub after_serious_count: Option<i64>,
    pub fixed_issue_ids: Option<String>,
    pub new_issue_ids: Option<String>,
    pub mode: String,
    pub status: String,
    pub model: Option<String>,
    pub revision_summary: Option<String>,
    pub changed_ranges_json: Option<String>,
    pub used_context_ids: Option<String>,
    pub skipped_context_ids: Option<String>,
    pub warnings: Option<String>,
    pub failure_reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveQualityFixRunInput {
    pub id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub source_draft_id: String,
    pub source_draft_version: i64,
    pub target_draft_id: Option<String>,
    pub target_draft_version: Option<i64>,
    pub source_content_hash: Option<String>,
    pub target_content_hash: Option<String>,
    pub before_report_id: Option<String>,
    pub after_report_id: Option<String>,
    pub before_score: Option<i64>,
    pub after_score: Option<i64>,
    pub before_pending_count: i64,
    pub after_pending_count: Option<i64>,
    pub before_serious_count: i64,
    pub after_serious_count: Option<i64>,
    pub fixed_issue_ids: Option<String>,
    pub new_issue_ids: Option<String>,
    pub mode: Option<String>,
    pub status: String,
    pub model: Option<String>,
    pub revision_summary: Option<String>,
    pub changed_ranges_json: Option<String>,
    pub used_context_ids: Option<String>,
    pub skipped_context_ids: Option<String>,
    pub warnings: Option<String>,
    pub failure_reason: Option<String>,
}

// ==================== Context Read Logs ====================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveContextReadLogInput {
    pub id: String,
    pub novel_id: String,
    pub task_type: String,
    pub chapter_id: Option<String>,
    pub volume_id: Option<String>,
    pub used_context_ids: Option<String>,
    pub skipped_context_ids: Option<String>,
    pub warnings: Option<String>,
}

// ==================== Legacy Chapter Context Migration ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LegacyChapterSummaryInput {
    #[serde(flatten)]
    pub data: SaveChapterSummaryInput,
    pub is_expired: Option<bool>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LegacyContextRecordInput {
    #[serde(flatten)]
    pub data: SaveContextRecordInput,
    pub is_expired: Option<bool>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LegacyCharacterStateInput {
    #[serde(flatten)]
    pub data: SaveCharacterStateInput,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyMigrationEntityCounts {
    pub inserted: usize,
    pub matched: usize,
    pub skipped: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MigrateLegacyChapterContextInput {
    #[serde(default)]
    pub chapter_summaries: Vec<LegacyChapterSummaryInput>,
    #[serde(default)]
    pub context_records: Vec<LegacyContextRecordInput>,
    #[serde(default)]
    pub character_states: Vec<LegacyCharacterStateInput>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MigrateLegacyChapterContextResult {
    pub chapter_summaries: LegacyMigrationEntityCounts,
    pub context_records: LegacyMigrationEntityCounts,
    pub character_states: LegacyMigrationEntityCounts,
    pub id_map: BTreeMap<String, String>,
    pub warnings: Vec<String>,
}
