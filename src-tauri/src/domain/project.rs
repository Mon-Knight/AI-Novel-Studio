use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProtagonistProfileDto {
    pub id: String,
    pub label: String,
    pub name: String,
    pub gender: String,
    pub identity: String,
    pub personality: String,
    pub goal: String,
    pub motivation: String,
    pub ability: String,
    pub limitation: String,
    pub background: String,
    pub arc: String,
    pub notes: String,
    pub special_ability: Option<String>,
    pub ability_limits: Option<String>,
    pub forbidden_behaviors: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DualProtagonistRelationDto {
    #[serde(rename = "type")]
    pub relation_type: String,
    pub description: String,
    pub conflict: String,
    pub cooperation: String,
    pub emotional_progression: String,
    pub narrative_weight: String,
}

pub fn default_dual_relation() -> DualProtagonistRelationDto {
    DualProtagonistRelationDto {
        relation_type: "partner".to_string(),
        description: String::new(),
        conflict: String::new(),
        cooperation: String::new(),
        emotional_progression: String::new(),
        narrative_weight: "balanced".to_string(),
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NovelDto {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub genre: Option<String>,
    pub description: Option<String>,
    pub outline: String,
    pub cover_path: Option<String>,
    pub status: String,
    pub current_volume_id: Option<String>,
    pub current_chapter_id: Option<String>,
    pub total_word_count: i64,
    pub target_word_count: Option<i64>,
    pub last_opened_at: Option<String>,
    pub protagonist_mode: String,
    pub protagonists: Vec<ProtagonistProfileDto>,
    pub dual_protagonist_relation: DualProtagonistRelationDto,
    pub main_character: String,
    pub protagonist_ability: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateNovelInput {
    pub title: String,
    pub subtitle: Option<String>,
    pub description: Option<String>,
    pub outline: Option<String>,
    pub genre: Option<String>,
    pub target_word_count: Option<i64>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNovelInput {
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub description: Option<String>,
    pub outline: Option<String>,
    pub genre: Option<String>,
    pub status: Option<String>,
    pub target_word_count: Option<i64>,
    pub current_volume_id: Option<String>,
    pub current_chapter_id: Option<String>,
    pub total_word_count: Option<i64>,
    pub protagonist_mode: Option<String>,
    pub protagonists: Option<Vec<ProtagonistProfileDto>>,
    pub dual_protagonist_relation: Option<DualProtagonistRelationDto>,
    pub main_character: Option<String>,
    pub protagonist_ability: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseRepairResult {
    pub storage: String,
    pub before: i64,
    pub after: i64,
    pub repaired_count: i64,
    pub skipped_count: i64,
    pub backup_key: String,
    pub integrity_ok: bool,
    pub integrity_message: String,
    pub foreign_key_violations: i64,
}
