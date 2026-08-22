use serde::{Deserialize, Serialize};

// ==================== Chapter Summary ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterSummaryDto {
    pub id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub volume_id: Option<String>,
    pub adopted_draft_id: String,
    pub summary: String,
    pub key_events: Option<String>,
    pub character_changes: Option<String>,
    pub relationship_changes: Option<String>,
    pub new_foreshadows: Option<String>,
    pub resolved_foreshadows: Option<String>,
    pub next_chapter_hints: Option<String>,
    pub core_events: Option<String>,
    pub protagonist_state_change: Option<String>,
    pub important_character_changes: Option<String>,
    pub setting_changes: Option<String>,
    pub new_locations: Option<String>,
    pub new_items_or_abilities: Option<String>,
    pub foreshadowing: Option<String>,
    pub unresolved_questions: Option<String>,
    pub facts_must_remember: Option<String>,
    pub next_chapter_hook: Option<String>,
    pub validation_status: Option<String>,
    pub validation_result: Option<String>,
    pub enabled: bool,
    pub content_hash: Option<String>,
    pub draft_version: Option<i64>,
    pub is_expired: bool,
    pub ai_task_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveChapterSummaryInput {
    pub id: Option<String>,
    pub novel_id: String,
    pub chapter_id: String,
    pub volume_id: Option<String>,
    pub adopted_draft_id: String,
    pub summary: String,
    pub key_events: Option<String>,
    pub character_changes: Option<String>,
    pub relationship_changes: Option<String>,
    pub new_foreshadows: Option<String>,
    pub resolved_foreshadows: Option<String>,
    pub next_chapter_hints: Option<String>,
    pub core_events: Option<String>,
    pub protagonist_state_change: Option<String>,
    pub important_character_changes: Option<String>,
    pub setting_changes: Option<String>,
    pub new_locations: Option<String>,
    pub new_items_or_abilities: Option<String>,
    pub foreshadowing: Option<String>,
    pub unresolved_questions: Option<String>,
    pub facts_must_remember: Option<String>,
    pub next_chapter_hook: Option<String>,
    pub validation_status: Option<String>,
    pub validation_result: Option<String>,
    pub enabled: Option<bool>,
    pub content_hash: Option<String>,
    pub draft_version: Option<i64>,
    pub ai_task_id: Option<String>,
}

// ==================== Context Records ====================

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextRecordDto {
    pub id: String,
    pub novel_id: String,
    pub chapter_id: Option<String>,
    pub volume_id: Option<String>,
    pub context_type: String,
    pub title: String,
    pub content: String,
    pub importance: i64,
    pub is_active: bool,
    pub is_expired: bool,
    pub content_hash: Option<String>,
    pub draft_version: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveContextRecordInput {
    pub id: Option<String>,
    pub novel_id: String,
    pub chapter_id: Option<String>,
    pub volume_id: Option<String>,
    pub context_type: String,
    pub title: String,
    pub content: String,
    pub importance: Option<i64>,
    pub is_active: Option<bool>,
    pub content_hash: Option<String>,
    pub draft_version: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateContextRecordInput {
    pub novel_id: String,
    pub chapter_id: Option<String>,
    pub volume_id: Option<String>,
    pub context_type: String,
    pub title: String,
    pub content: String,
    pub importance: i64,
    pub is_active: bool,
    pub is_expired: bool,
    pub content_hash: Option<String>,
    pub draft_version: Option<i64>,
}

// ==================== Character State ====================

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CharacterStateDto {
    pub id: String,
    pub novel_id: String,
    pub character_id: String,
    pub chapter_id: Option<String>,
    pub state_summary: String,
    pub relationship_changes: Option<String>,
    pub goal_changes: Option<String>,
    pub location: Option<String>,
    pub health_state: Option<String>,
    pub knowledge_state: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveCharacterStateInput {
    pub id: Option<String>,
    pub novel_id: String,
    pub character_id: String,
    pub chapter_id: Option<String>,
    pub state_summary: String,
    pub relationship_changes: Option<String>,
    pub goal_changes: Option<String>,
    pub location: Option<String>,
    pub health_state: Option<String>,
    pub knowledge_state: Option<String>,
}

// ==================== Chapter Context Bundle ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveChapterContextBundleInput {
    pub novel_id: String,
    pub chapter_id: String,
    pub adopted_draft_id: String,
    pub summary: SaveChapterSummaryInput,
    #[serde(default)]
    pub context_records: Vec<SaveContextRecordInput>,
    #[serde(default)]
    pub character_states: Vec<SaveCharacterStateInput>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveChapterContextBundleResult {
    pub summary: ChapterSummaryDto,
    pub context_records: Vec<ContextRecordDto>,
    pub character_states: Vec<CharacterStateDto>,
    pub chapter_status: String,
}
