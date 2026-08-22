use serde::{Deserialize, Serialize};

// ==================== Volume ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VolumeDto {
    pub id: String,
    pub novel_id: String,
    pub title: String,
    pub summary: Option<String>,
    pub goal: Option<String>,
    pub main_conflict: Option<String>,
    pub order_index: i64,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateVolumeInput {
    pub novel_id: String,
    pub title: String,
    pub summary: Option<String>,
    pub goal: Option<String>,
    pub main_conflict: Option<String>,
    pub order_index: Option<i64>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVolumeInput {
    pub title: Option<String>,
    pub summary: Option<String>,
    pub goal: Option<String>,
    pub main_conflict: Option<String>,
    pub order_index: Option<i64>,
    pub status: Option<String>,
}

pub const VOLUME_STATUSES: [&str; 3] = ["planned", "writing", "completed"];

// ==================== Chapter ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterDto {
    pub id: String,
    pub novel_id: String,
    pub volume_id: Option<String>,
    pub title: String,
    pub outline: Option<String>,
    pub goal: Option<String>,
    pub order_index: i64,
    pub status: String,
    pub adopted_draft_id: Option<String>,
    pub word_count: i64,
    pub target_word_count: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateChapterInput {
    pub novel_id: String,
    pub volume_id: Option<String>,
    pub title: String,
    pub outline: Option<String>,
    pub goal: Option<String>,
    pub target_word_count: Option<i64>,
    pub order_index: Option<i64>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateChapterInput {
    pub volume_id: Option<String>,
    pub title: Option<String>,
    pub outline: Option<String>,
    pub goal: Option<String>,
    pub order_index: Option<i64>,
    pub status: Option<String>,
    pub target_word_count: Option<i64>,
}

pub const CHAPTER_STATUSES: [&str; 7] = [
    "not_started",
    "outline_ready",
    "draft_generated",
    "editing",
    "polished",
    "adopted",
    "summarized",
];

// ==================== Chapter Draft ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterDraftDto {
    pub id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub title: Option<String>,
    pub content: String,
    pub source: String,
    pub version_no: i64,
    pub word_count: i64,
    pub is_adopted: bool,
    pub ai_task_id: Option<String>,
    pub note: Option<String>,
    pub large_text_ref_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
#[serde(rename_all = "camelCase")]
pub struct CreateChapterDraftInput {
    pub novel_id: String,
    pub chapter_id: String,
    pub title: Option<String>,
    pub content: String,
    pub source: String,
    pub ai_task_id: Option<String>,
    pub note: Option<String>,
    pub large_text_ref_id: Option<String>,
}

// ==================== Chapter Engineering State ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[allow(dead_code)]
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

#[derive(Debug, Deserialize, Clone)]
#[allow(dead_code)]
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
