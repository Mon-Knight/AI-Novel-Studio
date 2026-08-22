use serde::{Deserialize, Serialize};

// ==================== World Setting ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorldSettingDto {
    pub id: String,
    pub novel_id: String,
    pub title: String,
    pub content: String,
    pub structured_json: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveWorldSettingInput {
    pub novel_id: String,
    pub title: String,
    pub content: String,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

pub fn default_true() -> bool {
    true
}

// ==================== Rule System ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuleSystemDto {
    pub id: String,
    pub novel_id: String,
    pub title: String,
    pub category: Option<String>,
    pub content: String,
    pub forbidden_rules: Option<String>,
    pub structured_json: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveRuleSystemInput {
    pub novel_id: String,
    pub title: String,
    pub category: Option<String>,
    pub content: String,
    pub forbidden_rules: Option<String>,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

// ==================== Protagonist ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProtagonistDto {
    pub id: String,
    pub novel_id: String,
    pub name: String,
    pub identity: Option<String>,
    pub personality: Option<String>,
    pub goal: Option<String>,
    pub special_ability: Option<String>,
    pub ability_limits: Option<String>,
    pub forbidden_behaviors: Option<String>,
    pub current_state: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveProtagonistInput {
    pub novel_id: String,
    pub name: String,
    pub identity: Option<String>,
    pub personality: Option<String>,
    pub goal: Option<String>,
    pub special_ability: Option<String>,
    pub ability_limits: Option<String>,
    pub forbidden_behaviors: Option<String>,
    pub current_state: Option<String>,
}

// ==================== Character Library ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CharacterDto {
    pub id: String,
    pub novel_id: String,
    pub name: String,
    pub role_type: Option<String>,
    pub identity: Option<String>,
    pub faction: Option<String>,
    pub relation_to_protagonist: Option<String>,
    pub goal: Option<String>,
    pub personality: Option<String>,
    pub behavior_limits: Option<String>,
    pub forbidden_behaviors: Option<String>,
    pub first_appearance_chapter_id: Option<String>,
    pub current_state: Option<String>,
    pub source: String,
    pub is_protagonist: bool,
    pub protagonist_key: Option<String>,
    pub protagonist_label: Option<String>,
    pub protagonist_order: i64,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateCharacterInput {
    pub novel_id: String,
    pub name: String,
    pub role_type: Option<String>,
    pub identity: Option<String>,
    pub faction: Option<String>,
    pub relation_to_protagonist: Option<String>,
    pub goal: Option<String>,
    pub personality: Option<String>,
    pub behavior_limits: Option<String>,
    pub forbidden_behaviors: Option<String>,
    pub current_state: Option<String>,
    #[serde(default)]
    pub is_protagonist: bool,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCharacterInput {
    pub name: Option<String>,
    pub role_type: Option<String>,
    pub identity: Option<String>,
    pub faction: Option<String>,
    pub relation_to_protagonist: Option<String>,
    pub goal: Option<String>,
    pub personality: Option<String>,
    pub behavior_limits: Option<String>,
    pub forbidden_behaviors: Option<String>,
    pub current_state: Option<String>,
    pub is_protagonist: Option<bool>,
    pub is_active: Option<bool>,
}

// ==================== Chapter Character ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterCharacterDto {
    pub id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub character_id: String,
    pub character_name: Option<String>,
    pub role_in_chapter: String,
    pub must_appear: bool,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AddChapterCharacterInput {
    pub novel_id: String,
    pub chapter_id: String,
    pub character_id: String,
    pub character_name: Option<String>,
    #[serde(default = "default_role_in_chapter")]
    pub role_in_chapter: String,
    #[serde(default)]
    pub must_appear: bool,
    pub note: Option<String>,
}

pub fn default_role_in_chapter() -> String {
    "supporting".to_string()
}

// ==================== Chapter Event ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChapterEventDto {
    pub id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub title: String,
    pub description: String,
    pub involved_character_ids: Option<String>,
    pub impact: Option<String>,
    pub risk: Option<String>,
    pub status: String,
    pub source: String,
    pub ai_task_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CreateChapterEventInput {
    pub novel_id: String,
    pub chapter_id: String,
    pub title: String,
    pub description: String,
    pub involved_character_ids: Option<Vec<String>>,
    pub impact: Option<String>,
    pub risk: Option<String>,
    pub status: Option<String>,
    pub source: Option<String>,
    pub ai_task_id: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateChapterEventInput {
    pub title: Option<String>,
    pub description: Option<String>,
    pub involved_character_ids: Option<Vec<String>>,
    pub impact: Option<String>,
    pub risk: Option<String>,
    pub status: Option<String>,
}
