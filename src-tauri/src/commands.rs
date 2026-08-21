use crate::db::{get_connection, get_database_path};
use crate::errors::{log_workspace_event, WorkspaceLogEvent};
use rusqlite::{params, Connection, Row, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

pub mod agent_plans;
pub mod ai_request_policy;
pub mod ai_tasks;
pub mod app_update;
pub mod artifacts;
pub mod autonomous_scheduler;
pub mod autonomous_story;
pub mod content_transactions;
pub mod conversations;
pub mod drafts;
pub mod memory;
pub mod multi_agent;
pub mod output_profiles;
pub mod placements;
pub mod recovery;
pub mod reference_library;

// ==================== Novel ====================

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

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNovelInput {
    pub title: String,
    pub subtitle: Option<String>,
    pub description: Option<String>,
    pub outline: Option<String>,
    pub genre: Option<String>,
    pub target_word_count: Option<i64>,
}

#[derive(Debug, Deserialize)]
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

fn default_dual_relation() -> DualProtagonistRelationDto {
    DualProtagonistRelationDto {
        relation_type: "partner".to_string(),
        description: String::new(),
        conflict: String::new(),
        cooperation: String::new(),
        emotional_progression: String::new(),
        narrative_weight: "balanced".to_string(),
    }
}

fn parse_protagonists_json(value: &str) -> Vec<ProtagonistProfileDto> {
    serde_json::from_str::<Vec<ProtagonistProfileDto>>(value).unwrap_or_default()
}

fn parse_dual_relation_json(value: &str) -> DualProtagonistRelationDto {
    serde_json::from_str::<DualProtagonistRelationDto>(value)
        .unwrap_or_else(|_| default_dual_relation())
}

fn protagonist_name_from_json(value: &str) -> String {
    parse_protagonists_json(value)
        .first()
        .map(|item| item.name.clone())
        .unwrap_or_default()
}

fn protagonist_ability_from_json(value: &str) -> String {
    parse_protagonists_json(value)
        .first()
        .map(|item| {
            if !item.ability.is_empty() {
                item.ability.clone()
            } else {
                item.special_ability.clone().unwrap_or_default()
            }
        })
        .unwrap_or_default()
}

fn novel_select_sql() -> &'static str {
    "SELECT id, title, subtitle, genre, description, outline, cover_path, status, current_volume_id, current_chapter_id, total_word_count, target_word_count, last_opened_at, protagonist_mode, protagonists_json, dual_protagonist_relation_json, main_character, protagonist_ability, created_at, updated_at FROM novels"
}

fn map_novel_row(row: &Row<'_>) -> rusqlite::Result<NovelDto> {
    let protagonists_json: String = row.get(14)?;
    let relation_json: String = row.get(15)?;
    let main_character: String = row.get(16)?;
    let protagonist_ability: String = row.get(17)?;
    let fallback_main_character = if main_character.is_empty() {
        protagonist_name_from_json(&protagonists_json)
    } else {
        main_character
    };
    let fallback_protagonist_ability = if protagonist_ability.is_empty() {
        protagonist_ability_from_json(&protagonists_json)
    } else {
        protagonist_ability
    };

    Ok(NovelDto {
        id: row.get(0)?,
        title: row.get(1)?,
        subtitle: row.get(2)?,
        genre: row.get(3)?,
        description: row.get(4)?,
        outline: row.get(5)?,
        cover_path: row.get(6)?,
        status: row.get(7)?,
        current_volume_id: row.get(8)?,
        current_chapter_id: row.get(9)?,
        total_word_count: row.get(10)?,
        target_word_count: row.get(11)?,
        last_opened_at: row.get(12)?,
        protagonist_mode: row.get(13)?,
        protagonists: parse_protagonists_json(&protagonists_json),
        dual_protagonist_relation: parse_dual_relation_json(&relation_json),
        main_character: fallback_main_character,
        protagonist_ability: fallback_protagonist_ability,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
    })
}

#[tauri::command]
pub fn get_all_novels() -> Result<Vec<NovelDto>, String> {
    crate::runtime::append_e2e_log("get_all_novels: waiting for database lock");
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    crate::runtime::append_e2e_log("get_all_novels: database lock acquired");
    let sql = format!(
        "{} WHERE deleted_at IS NULL ORDER BY updated_at DESC",
        novel_select_sql()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let novels = stmt
        .query_map([], map_novel_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    crate::runtime::append_e2e_log("get_all_novels: complete");
    Ok(novels)
}

#[tauri::command]
pub fn get_novel_by_id(id: String) -> Result<Option<NovelDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    get_novel_by_id_internal(&conn, &id)
}

fn get_novel_by_id_internal(conn: &Connection, id: &str) -> Result<Option<NovelDto>, String> {
    let sql = format!(
        "{} WHERE id = ?1 AND deleted_at IS NULL",
        novel_select_sql()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    stmt.query_row(params![id], map_novel_row)
        .optional()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_novel(input: CreateNovelInput) -> Result<NovelDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let relation_json =
        serde_json::to_string(&default_dual_relation()).unwrap_or_else(|_| "{}".to_string());

    conn.execute(
        "INSERT INTO novels (id, title, subtitle, genre, description, outline, status, total_word_count, target_word_count, protagonist_mode, protagonists_json, dual_protagonist_relation_json, main_character, protagonist_ability, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', 0, ?7, 'single', '[]', ?8, '', '', ?9, ?9)",
        params![&id, input.title, input.subtitle, input.genre, input.description, input.outline.unwrap_or_default(), input.target_word_count, relation_json, now],
    )
    .map_err(|e| e.to_string())?;

    get_novel_by_id_internal(&conn, &id)?.ok_or_else(|| "作品创建后无法读取".to_string())
}

#[tauri::command]
pub fn update_novel(id: String, input: UpdateNovelInput) -> Result<NovelDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let protagonists_json = input
        .protagonists
        .as_ref()
        .map(|items| serde_json::to_string(items).unwrap_or_else(|_| "[]".to_string()));
    let relation_json = input
        .dual_protagonist_relation
        .as_ref()
        .map(|relation| serde_json::to_string(relation).unwrap_or_else(|_| "{}".to_string()));

    conn.execute(
        "UPDATE novels SET
            title = COALESCE(?1, title),
            subtitle = COALESCE(?2, subtitle),
            description = COALESCE(?3, description),
            outline = COALESCE(?4, outline),
            genre = COALESCE(?5, genre),
            status = COALESCE(?6, status),
            target_word_count = COALESCE(?7, target_word_count),
            current_volume_id = COALESCE(?8, current_volume_id),
            current_chapter_id = COALESCE(?9, current_chapter_id),
            total_word_count = COALESCE(?10, total_word_count),
            protagonist_mode = COALESCE(?11, protagonist_mode),
            protagonists_json = COALESCE(?12, protagonists_json),
            dual_protagonist_relation_json = COALESCE(?13, dual_protagonist_relation_json),
            main_character = COALESCE(?14, main_character),
            protagonist_ability = COALESCE(?15, protagonist_ability),
            updated_at = ?16
         WHERE id = ?17",
        params![
            input.title,
            input.subtitle,
            input.description,
            input.outline,
            input.genre,
            input.status,
            input.target_word_count,
            input.current_volume_id,
            input.current_chapter_id,
            input.total_word_count,
            input.protagonist_mode,
            protagonists_json,
            relation_json,
            input.main_character,
            input.protagonist_ability,
            now,
            &id,
        ],
    )
    .map_err(|e| e.to_string())?;

    get_novel_by_id_internal(&conn, &id)?.ok_or_else(|| "作品保存后无法读取".to_string())
}

#[tauri::command]
pub fn delete_novel(id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE novels SET deleted_at = ?1 WHERE id = ?2",
        params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ==================== World Setting ====================

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWorldSettingInput {
    pub novel_id: String,
    pub title: String,
    pub content: String,
    #[serde(default = "default_true")]
    pub is_active: bool,
}

fn default_true() -> bool {
    true
}

#[tauri::command]
pub fn get_world_settings(novel_id: String) -> Result<Vec<WorldSettingDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, novel_id, title, content, structured_json, is_active, created_at, updated_at FROM world_settings WHERE novel_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map(params![novel_id], |row| {
            Ok(WorldSettingDto {
                id: row.get(0)?,
                novel_id: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                structured_json: row.get(4)?,
                is_active: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

#[tauri::command]
pub fn save_world_setting(
    id: Option<String>,
    input: SaveWorldSettingInput,
) -> Result<WorldSettingDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    if let Some(existing_id) = id {
        conn.execute(
            "UPDATE world_settings SET title = ?1, content = ?2, is_active = ?3, updated_at = ?4 WHERE id = ?5",
            params![input.title, input.content, input.is_active as i64, now, existing_id],
        )
        .map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare("SELECT id, novel_id, title, content, structured_json, is_active, created_at, updated_at FROM world_settings WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![existing_id], |row| {
            Ok(WorldSettingDto {
                id: row.get(0)?,
                novel_id: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                structured_json: row.get(4)?,
                is_active: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())
    } else {
        let new_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO world_settings (id, novel_id, title, content, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![new_id, input.novel_id, input.title, input.content, input.is_active as i64, now],
        )
        .map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare("SELECT id, novel_id, title, content, structured_json, is_active, created_at, updated_at FROM world_settings WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![new_id], |row| {
            Ok(WorldSettingDto {
                id: row.get(0)?,
                novel_id: row.get(1)?,
                title: row.get(2)?,
                content: row.get(3)?,
                structured_json: row.get(4)?,
                is_active: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())
    }
}

// ==================== Rule System ====================

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Deserialize)]
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

#[tauri::command]
pub fn get_rule_systems(novel_id: String) -> Result<Vec<RuleSystemDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, novel_id, title, category, content, forbidden_rules, structured_json, is_active, created_at, updated_at FROM rule_systems WHERE novel_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map(params![novel_id], |row| {
            Ok(RuleSystemDto {
                id: row.get(0)?,
                novel_id: row.get(1)?,
                title: row.get(2)?,
                category: row.get(3)?,
                content: row.get(4)?,
                forbidden_rules: row.get(5)?,
                structured_json: row.get(6)?,
                is_active: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

#[tauri::command]
pub fn save_rule_system(
    id: Option<String>,
    input: SaveRuleSystemInput,
) -> Result<RuleSystemDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    if let Some(existing_id) = id {
        conn.execute(
            "UPDATE rule_systems SET title = ?1, category = ?2, content = ?3, forbidden_rules = ?4, is_active = ?5, updated_at = ?6 WHERE id = ?7",
            params![input.title, input.category, input.content, input.forbidden_rules, input.is_active as i64, now, existing_id],
        )
        .map_err(|e| e.to_string())?;
        get_rule_system_by_id(&conn, &existing_id)
    } else {
        let new_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO rule_systems (id, novel_id, title, category, content, forbidden_rules, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![new_id, input.novel_id, input.title, input.category, input.content, input.forbidden_rules, input.is_active as i64, now],
        )
        .map_err(|e| e.to_string())?;
        get_rule_system_by_id(&conn, &new_id)
    }
}

fn get_rule_system_by_id(conn: &rusqlite::Connection, id: &str) -> Result<RuleSystemDto, String> {
    let mut stmt = conn
        .prepare("SELECT id, novel_id, title, category, content, forbidden_rules, structured_json, is_active, created_at, updated_at FROM rule_systems WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![id], |row| {
        Ok(RuleSystemDto {
            id: row.get(0)?,
            novel_id: row.get(1)?,
            title: row.get(2)?,
            category: row.get(3)?,
            content: row.get(4)?,
            forbidden_rules: row.get(5)?,
            structured_json: row.get(6)?,
            is_active: row.get::<_, i64>(7)? != 0,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_rule_system(id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM rule_systems WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ==================== Protagonist ====================

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Deserialize)]
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

#[tauri::command]
pub fn get_protagonist(novel_id: String) -> Result<Option<ProtagonistDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, novel_id, name, identity, personality, goal, special_ability, ability_limits, forbidden_behaviors, current_state, created_at, updated_at FROM protagonists WHERE novel_id = ?1 LIMIT 1")
        .map_err(|e| e.to_string())?;

    let result = stmt
        .query_row(params![novel_id], |row| {
            Ok(ProtagonistDto {
                id: row.get(0)?,
                novel_id: row.get(1)?,
                name: row.get(2)?,
                identity: row.get(3)?,
                personality: row.get(4)?,
                goal: row.get(5)?,
                special_ability: row.get(6)?,
                ability_limits: row.get(7)?,
                forbidden_behaviors: row.get(8)?,
                current_state: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(result)
}

#[tauri::command]
pub fn save_protagonist(
    id: Option<String>,
    input: SaveProtagonistInput,
) -> Result<ProtagonistDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    if let Some(existing_id) = id {
        conn.execute(
            "UPDATE protagonists SET name = ?1, identity = ?2, personality = ?3, goal = ?4, special_ability = ?5, ability_limits = ?6, forbidden_behaviors = ?7, current_state = ?8, updated_at = ?9 WHERE id = ?10",
            params![input.name, input.identity, input.personality, input.goal, input.special_ability, input.ability_limits, input.forbidden_behaviors, input.current_state, now, existing_id],
        )
        .map_err(|e| e.to_string())?;
        get_protagonist_by_id(&conn, &existing_id)
    } else {
        let new_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO protagonists (id, novel_id, name, identity, personality, goal, special_ability, ability_limits, forbidden_behaviors, current_state, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![new_id, input.novel_id, input.name, input.identity, input.personality, input.goal, input.special_ability, input.ability_limits, input.forbidden_behaviors, input.current_state, now],
        )
        .map_err(|e| e.to_string())?;
        get_protagonist_by_id(&conn, &new_id)
    }
}

fn get_protagonist_by_id(conn: &rusqlite::Connection, id: &str) -> Result<ProtagonistDto, String> {
    let mut stmt = conn
        .prepare("SELECT id, novel_id, name, identity, personality, goal, special_ability, ability_limits, forbidden_behaviors, current_state, created_at, updated_at FROM protagonists WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![id], |row| {
        Ok(ProtagonistDto {
            id: row.get(0)?,
            novel_id: row.get(1)?,
            name: row.get(2)?,
            identity: row.get(3)?,
            personality: row.get(4)?,
            goal: row.get(5)?,
            special_ability: row.get(6)?,
            ability_limits: row.get(7)?,
            forbidden_behaviors: row.get(8)?,
            current_state: row.get(9)?,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
        })
    })
    .map_err(|e| e.to_string())
}

// ==================== Volume ====================

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVolumeInput {
    pub novel_id: String,
    pub title: String,
    pub summary: Option<String>,
    pub goal: Option<String>,
    pub main_conflict: Option<String>,
    pub order_index: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVolumeInput {
    pub title: Option<String>,
    pub summary: Option<String>,
    pub goal: Option<String>,
    pub main_conflict: Option<String>,
    pub order_index: Option<i64>,
    pub status: Option<String>,
}

const VOLUME_STATUSES: [&str; 3] = ["planned", "writing", "completed"];

fn validate_volume_update_input(input: &UpdateVolumeInput) -> Result<(), String> {
    if let Some(status) = input.status.as_deref() {
        if !VOLUME_STATUSES.contains(&status) {
            return Err("volume_status_invalid".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_volumes_by_novel_id(novel_id: String) -> Result<Vec<VolumeDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, novel_id, title, summary, goal, main_conflict, order_index, status, created_at, updated_at FROM volumes WHERE novel_id = ?1 AND deleted_at IS NULL ORDER BY order_index ASC")
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![novel_id], |row| {
            Ok(VolumeDto {
                id: row.get(0)?,
                novel_id: row.get(1)?,
                title: row.get(2)?,
                summary: row.get(3)?,
                goal: row.get(4)?,
                main_conflict: row.get(5)?,
                order_index: row.get(6)?,
                status: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_volume_by_id(id: String) -> Result<Option<VolumeDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    match get_volume_by_id_internal(&conn, &id) {
        Ok(volume) => Ok(Some(volume)),
        Err(err) if err.contains("Query returned no rows") => Ok(None),
        Err(err) => Err(err),
    }
}

#[tauri::command]
pub fn create_volume(input: CreateVolumeInput) -> Result<VolumeDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let order = input.order_index.unwrap_or(0);
    conn.execute(
        "INSERT INTO volumes (id, novel_id, title, summary, goal, main_conflict, order_index, status, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'planned',?8,?8)",
        params![id, input.novel_id, input.title, input.summary, input.goal, input.main_conflict, order, now],
    ).map_err(|e| e.to_string())?;
    get_volume_by_id_internal(&conn, &id)
}

#[tauri::command]
pub fn update_volume(id: String, input: UpdateVolumeInput) -> Result<VolumeDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    update_volume_internal(&conn, &id, input, &now)
}

fn update_volume_internal(
    conn: &Connection,
    id: &str,
    input: UpdateVolumeInput,
    now: &str,
) -> Result<VolumeDto, String> {
    validate_volume_update_input(&input)?;
    conn.execute(
        "UPDATE volumes
         SET title = COALESCE(?1, title),
             summary = COALESCE(?2, summary),
             goal = COALESCE(?3, goal),
             main_conflict = COALESCE(?4, main_conflict),
             order_index = COALESCE(?5, order_index),
             status = COALESCE(?6, status),
             updated_at = ?7
         WHERE id = ?8",
        params![
            input.title.as_deref(),
            input.summary.as_deref(),
            input.goal.as_deref(),
            input.main_conflict.as_deref(),
            input.order_index,
            input.status.as_deref(),
            now,
            id,
        ],
    )
    .map_err(|e| e.to_string())?;
    get_volume_by_id_internal(conn, id)
}

#[tauri::command]
pub fn delete_volume(id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chapters WHERE volume_id = ?1 AND deleted_at IS NULL",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count > 0 {
        return Err("该分卷下仍有章节，请先移动或删除章节".into());
    }
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE volumes SET deleted_at = ?1 WHERE id = ?2",
        params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn get_volume_by_id_internal(conn: &rusqlite::Connection, id: &str) -> Result<VolumeDto, String> {
    let mut stmt = conn.prepare("SELECT id, novel_id, title, summary, goal, main_conflict, order_index, status, created_at, updated_at FROM volumes WHERE id = ?1").map_err(|e| e.to_string())?;
    stmt.query_row(params![id], |row| {
        Ok(VolumeDto {
            id: row.get(0)?,
            novel_id: row.get(1)?,
            title: row.get(2)?,
            summary: row.get(3)?,
            goal: row.get(4)?,
            main_conflict: row.get(5)?,
            order_index: row.get(6)?,
            status: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    })
    .map_err(|e| e.to_string())
}

// ==================== Chapter ====================

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Deserialize)]
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

#[derive(Debug, Deserialize)]
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

const CHAPTER_STATUSES: [&str; 7] = [
    "not_started",
    "outline_ready",
    "draft_generated",
    "editing",
    "polished",
    "adopted",
    "summarized",
];

fn validate_chapter_update_input(input: &UpdateChapterInput) -> Result<(), String> {
    if let Some(status) = input.status.as_deref() {
        if !CHAPTER_STATUSES.contains(&status) {
            return Err("chapter_status_invalid".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_chapters_by_novel_id(novel_id: String) -> Result<Vec<ChapterDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, novel_id, volume_id, title, outline, goal, order_index, status, adopted_draft_id, word_count, target_word_count, created_at, updated_at FROM chapters WHERE novel_id = ?1 AND deleted_at IS NULL ORDER BY order_index ASC")
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![novel_id], |row| {
            Ok(ChapterDto {
                id: row.get(0)?,
                novel_id: row.get(1)?,
                volume_id: row.get(2)?,
                title: row.get(3)?,
                outline: row.get(4)?,
                goal: row.get(5)?,
                order_index: row.get(6)?,
                status: row.get(7)?,
                adopted_draft_id: row.get(8)?,
                word_count: row.get(9)?,
                target_word_count: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_chapters_by_volume_id(volume_id: String) -> Result<Vec<ChapterDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, novel_id, volume_id, title, outline, goal, order_index, status, adopted_draft_id, word_count, target_word_count, created_at, updated_at FROM chapters WHERE volume_id = ?1 AND deleted_at IS NULL ORDER BY order_index ASC")
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![volume_id], |row| {
            Ok(ChapterDto {
                id: row.get(0)?,
                novel_id: row.get(1)?,
                volume_id: row.get(2)?,
                title: row.get(3)?,
                outline: row.get(4)?,
                goal: row.get(5)?,
                order_index: row.get(6)?,
                status: row.get(7)?,
                adopted_draft_id: row.get(8)?,
                word_count: row.get(9)?,
                target_word_count: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_chapter_by_id(id: String) -> Result<Option<ChapterDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    match get_chapter_by_id_internal(&conn, &id) {
        Ok(chapter) => Ok(Some(chapter)),
        Err(err) if err.contains("Query returned no rows") => Ok(None),
        Err(err) => Err(err),
    }
}

#[tauri::command]
pub fn create_chapter(input: CreateChapterInput) -> Result<ChapterDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let order = input.order_index.unwrap_or(0);
    let status = if input.outline.is_some() {
        "outline_ready"
    } else {
        "not_started"
    };
    conn.execute(
        "INSERT INTO chapters (id, novel_id, volume_id, title, outline, goal, order_index, status, word_count, target_word_count, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,?9,?10,?10)",
        params![id, input.novel_id, input.volume_id, input.title, input.outline, input.goal, order, status, input.target_word_count, now],
    ).map_err(|e| e.to_string())?;
    get_chapter_by_id_internal(&conn, &id)
}

#[tauri::command]
pub fn update_chapter(id: String, input: UpdateChapterInput) -> Result<ChapterDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    update_chapter_internal(&conn, &id, input, &now)
}

fn update_chapter_internal(
    conn: &Connection,
    id: &str,
    input: UpdateChapterInput,
    now: &str,
) -> Result<ChapterDto, String> {
    validate_chapter_update_input(&input)?;
    conn.execute(
        "UPDATE chapters
         SET volume_id = COALESCE(?1, volume_id),
             title = COALESCE(?2, title),
             outline = COALESCE(?3, outline),
             goal = COALESCE(?4, goal),
             order_index = COALESCE(?5, order_index),
             status = COALESCE(?6, status),
             target_word_count = COALESCE(?7, target_word_count),
             updated_at = ?8
         WHERE id = ?9",
        params![
            input.volume_id.as_deref(),
            input.title.as_deref(),
            input.outline.as_deref(),
            input.goal.as_deref(),
            input.order_index,
            input.status.as_deref(),
            input.target_word_count,
            now,
            id,
        ],
    )
    .map_err(|e| e.to_string())?;
    get_chapter_by_id_internal(conn, id)
}

#[tauri::command]
pub fn delete_chapter(id: String) -> Result<(), String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    let novel_id: String = transaction
        .query_row(
            "SELECT novel_id FROM chapters WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let affected = transaction
        .execute(
            "UPDATE chapters SET deleted_at = ?1 WHERE id = ?2",
            params![now, &id],
        )
        .map_err(|e| e.to_string())?;
    if affected != 1 {
        return Err("TARGET_CHAPTER_NOT_FOUND: 章节删除未命中唯一目标".to_string());
    }
    let recovery_document_id =
        crate::repositories::recovery_repository::get(&transaction, &novel_id, &id)
            .map_err(|error| error.to_string())?
            .and_then(|snapshot| snapshot.large_text_ref_id);
    crate::repositories::recovery_repository::delete_exact(&transaction, &novel_id, &id)
        .map_err(|error| error.to_string())?;
    if let Some(document_id) = recovery_document_id {
        crate::repositories::large_text_repository::delete_if_unreferenced(
            &transaction,
            &document_id,
        )
        .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn get_chapter_by_id_internal(conn: &rusqlite::Connection, id: &str) -> Result<ChapterDto, String> {
    let mut stmt = conn.prepare("SELECT id, novel_id, volume_id, title, outline, goal, order_index, status, adopted_draft_id, word_count, target_word_count, created_at, updated_at FROM chapters WHERE id = ?1").map_err(|e| e.to_string())?;
    stmt.query_row(params![id], |row| {
        Ok(ChapterDto {
            id: row.get(0)?,
            novel_id: row.get(1)?,
            volume_id: row.get(2)?,
            title: row.get(3)?,
            outline: row.get(4)?,
            goal: row.get(5)?,
            order_index: row.get(6)?,
            status: row.get(7)?,
            adopted_draft_id: row.get(8)?,
            word_count: row.get(9)?,
            target_word_count: row.get(10)?,
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
        })
    })
    .map_err(|e| e.to_string())
}

// ==================== Chapter Draft ====================

#[derive(Debug, Serialize, Deserialize)]
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

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
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

pub(crate) fn count_words(content: &str) -> i64 {
    let mut count = 0_i64;
    let mut in_ascii_word = false;

    for character in content.chars() {
        let is_cjk = ('\u{3400}'..='\u{4dbf}').contains(&character)
            || ('\u{4e00}'..='\u{9fff}').contains(&character);
        if is_cjk {
            count += 1;
            in_ascii_word = false;
        } else if character.is_ascii_alphanumeric() {
            if !in_ascii_word {
                count += 1;
                in_ascii_word = true;
            }
        } else {
            in_ascii_word = false;
        }
    }

    count
}

fn map_draft_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChapterDraftDto> {
    let is_adopted: i64 = row.get(8)?;
    Ok(ChapterDraftDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        chapter_id: row.get(2)?,
        title: row.get(3)?,
        content: row.get(4)?,
        source: row.get(5)?,
        version_no: row.get(6)?,
        word_count: row.get(7)?,
        is_adopted: is_adopted != 0,
        ai_task_id: row.get(9)?,
        note: row.get(10)?,
        large_text_ref_id: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

pub(crate) fn get_draft_by_id_internal(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<ChapterDraftDto, String> {
    let mut stmt = conn.prepare("SELECT id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, ai_task_id, note, large_text_ref_id, created_at, updated_at FROM chapter_drafts WHERE id = ?1").map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_draft_row)
        .map_err(|e| e.to_string())
}

pub(crate) fn get_draft_by_id_and_chapter_internal(
    conn: &rusqlite::Connection,
    id: &str,
    chapter_id: &str,
) -> Result<ChapterDraftDto, String> {
    let mut stmt = conn
        .prepare("SELECT d.id, d.novel_id, d.chapter_id, d.title, d.content, d.source, d.version_no, d.word_count, d.is_adopted, d.ai_task_id, d.note, d.large_text_ref_id, d.created_at, d.updated_at FROM chapter_drafts AS d INNER JOIN chapters AS c ON c.id = d.chapter_id AND c.novel_id = d.novel_id WHERE d.id = ?1 AND d.chapter_id = ?2 AND c.deleted_at IS NULL")
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![id, chapter_id], map_draft_row)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_drafts_by_chapter_id(
    chapter_id: String,
    page: Option<i64>,
    size: Option<i64>,
) -> Result<Vec<ChapterDraftDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let paged = page.is_some() || size.is_some();
    let page = page.unwrap_or(1).max(1);
    let size = size.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * size;
    let sql = if paged {
        "SELECT id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, ai_task_id, note, large_text_ref_id, created_at, updated_at FROM chapter_drafts WHERE chapter_id = ?1 ORDER BY version_no DESC LIMIT ?2 OFFSET ?3"
    } else {
        "SELECT id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, ai_task_id, note, large_text_ref_id, created_at, updated_at FROM chapter_drafts WHERE chapter_id = ?1 ORDER BY version_no ASC"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let items = if paged {
        stmt.query_map(params![chapter_id, size, offset], map_draft_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    } else {
        stmt.query_map(params![chapter_id], map_draft_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    Ok(items)
}

#[tauri::command]
pub fn count_drafts_by_chapter_id(chapter_id: String) -> Result<i64, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT COUNT(*) FROM chapter_drafts WHERE chapter_id = ?1",
        params![chapter_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_latest_draft_by_chapter_id(
    chapter_id: String,
) -> Result<Option<ChapterDraftDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, ai_task_id, note, large_text_ref_id, created_at, updated_at FROM chapter_drafts WHERE chapter_id = ?1 ORDER BY version_no DESC LIMIT 1")
        .map_err(|e| e.to_string())?;
    match stmt.query_row(params![chapter_id], map_draft_row) {
        Ok(draft) => Ok(Some(draft)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn get_adopted_draft_by_chapter_id(
    chapter_id: String,
) -> Result<Option<ChapterDraftDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, ai_task_id, note, large_text_ref_id, created_at, updated_at FROM chapter_drafts WHERE chapter_id = ?1 AND is_adopted = 1 ORDER BY version_no DESC LIMIT 1")
        .map_err(|e| e.to_string())?;
    match stmt.query_row(params![chapter_id], map_draft_row) {
        Ok(draft) => Ok(Some(draft)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn get_draft_by_chapter_and_id(
    chapter_id: String,
    draft_id: String,
) -> Result<Option<ChapterDraftDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT d.id, d.novel_id, d.chapter_id, d.title, d.content, d.source, d.version_no, d.word_count, d.is_adopted, d.ai_task_id, d.note, d.large_text_ref_id, d.created_at, d.updated_at FROM chapter_drafts AS d INNER JOIN chapters AS c ON c.id = d.chapter_id AND c.novel_id = d.novel_id WHERE d.id = ?1 AND d.chapter_id = ?2 AND c.deleted_at IS NULL")
        .map_err(|e| e.to_string())?;
    match stmt.query_row(params![draft_id, chapter_id], map_draft_row) {
        Ok(draft) => Ok(Some(draft)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
#[allow(dead_code)]
pub fn create_chapter_draft(input: CreateChapterDraftInput) -> Result<ChapterDraftDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let max_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version_no), 0) FROM chapter_drafts WHERE chapter_id = ?1",
            params![&input.chapter_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let word_count = count_words(&input.content);
    let ai_task_id = match input.ai_task_id {
        Some(task_id) if !task_id.is_empty() => {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM ai_task_records WHERE id = ?1",
                    params![&task_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if exists > 0 {
                Some(task_id)
            } else {
                None
            }
        }
        _ => None,
    };

    conn.execute(
        "INSERT INTO chapter_drafts (id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, ai_task_id, note, large_text_ref_id, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,?9,?10,?11,?12,?12)",
        params![
            &id,
            &input.novel_id,
            &input.chapter_id,
            &input.title,
            &input.content,
            &input.source,
            max_version + 1,
            word_count,
            &ai_task_id,
            &input.note,
            &input.large_text_ref_id,
            now
        ],
    ).map_err(|e| e.to_string())?;

    get_draft_by_id_internal(&conn, &id)
}

fn update_chapter_draft_internal(
    conn: &Connection,
    id: &str,
    chapter_id: &str,
    content: &str,
    source: Option<&str>,
    large_text_ref_id: Option<&str>,
) -> Result<ChapterDraftDto, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let source = source.unwrap_or("user_edited");
    let word_count = count_words(content);
    let affected_rows = conn.execute(
        "UPDATE chapter_drafts SET content = ?1, source = ?2, word_count = ?3, large_text_ref_id = ?4, updated_at = ?5 WHERE id = ?6 AND chapter_id = ?7 AND EXISTS (SELECT 1 FROM chapters AS c WHERE c.id = chapter_drafts.chapter_id AND c.novel_id = chapter_drafts.novel_id AND c.deleted_at IS NULL)",
        params![content, source, word_count, large_text_ref_id, now, id, chapter_id],
    ).map_err(|e| format!("draft_update_failed: {}", e))?;

    if affected_rows != 1 {
        return Err(format!(
            "draft_update_conflict: expected one draft for id={} chapter_id={}, affected_rows={}",
            id, chapter_id, affected_rows
        ));
    }

    get_draft_by_id_and_chapter_internal(conn, id, chapter_id)
        .map_err(|e| format!("draft_update_readback_failed: {}", e))
}

#[tauri::command]
#[allow(dead_code)]
pub fn update_chapter_draft(
    id: String,
    chapter_id: String,
    content: String,
    source: Option<String>,
    large_text_ref_id: Option<String>,
) -> Result<ChapterDraftDto, String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    update_chapter_draft_with_cleanup_internal(
        &mut conn,
        &id,
        &chapter_id,
        &content,
        source.as_deref(),
        large_text_ref_id.as_deref(),
    )
}

fn update_chapter_draft_with_cleanup_internal(
    conn: &mut Connection,
    id: &str,
    chapter_id: &str,
    content: &str,
    source: Option<&str>,
    large_text_ref_id: Option<&str>,
) -> Result<ChapterDraftDto, String> {
    let transaction = conn
        .transaction()
        .map_err(|e| format!("draft_update_transaction_begin_failed: {}", e))?;
    let old_large_text_ref = transaction
        .query_row(
            "SELECT large_text_ref_id FROM chapter_drafts WHERE id = ?1 AND chapter_id = ?2",
            params![id, chapter_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|e| format!("draft_update_large_text_lookup_failed: {}", e))?
        .ok_or_else(|| {
            format!(
                "draft_update_conflict: expected one draft for id={} chapter_id={}",
                id, chapter_id
            )
        })?;
    let draft = update_chapter_draft_internal(
        &transaction,
        id,
        chapter_id,
        content,
        source,
        large_text_ref_id,
    )?;
    if let Some(old_document_id) = old_large_text_ref.as_deref() {
        if large_text_ref_id != Some(old_document_id) {
            crate::large_text_save::delete_unreferenced_draft_large_text(
                &transaction,
                old_document_id,
            )?;
        }
    }
    transaction
        .commit()
        .map_err(|e| format!("draft_update_transaction_commit_failed: {}", e))?;
    Ok(draft)
}

fn validate_live_draft_target_internal(
    conn: &Connection,
    draft_id: &str,
    chapter_id: &str,
) -> Result<i64, String> {
    let target = conn.query_row(
        "SELECT d.chapter_id, d.novel_id, d.word_count, d.large_text_ref_id, c.id, c.novel_id, c.deleted_at FROM chapter_drafts AS d LEFT JOIN chapters AS c ON c.id = ?2 WHERE d.id = ?1",
        params![draft_id, chapter_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        },
    );

    let (
        actual_chapter_id,
        draft_novel_id,
        word_count,
        large_text_ref_id,
        target_chapter_id,
        chapter_novel_id,
        deleted_at,
    ) = match target {
        Ok(target) => target,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(format!(
                "target_not_found: chapter draft '{}' does not exist",
                draft_id
            ));
        }
        Err(e) => return Err(format!("adopt_target_lookup_failed: {}", e)),
    };

    if actual_chapter_id != chapter_id {
        return Err(format!(
            "target_mismatch: chapter draft '{}' belongs to chapter '{}', not '{}'",
            draft_id, actual_chapter_id, chapter_id
        ));
    }

    if target_chapter_id.is_none() {
        return Err(format!(
            "target_not_found: chapter '{}' does not exist",
            chapter_id
        ));
    }

    if deleted_at.is_some() {
        return Err(format!(
            "target_deleted: chapter '{}' has been deleted",
            chapter_id
        ));
    }

    if chapter_novel_id.as_deref() != Some(draft_novel_id.as_str()) {
        return Err(format!(
            "target_mismatch: chapter draft '{}' belongs to novel '{}', but chapter '{}' belongs to novel '{}'",
            draft_id,
            draft_novel_id,
            chapter_id,
            chapter_novel_id.as_deref().unwrap_or("<missing>")
        ));
    }

    if let Some(document_id) = large_text_ref_id.as_deref() {
        let full_content =
            crate::large_text_save::read_large_text_document_internal(conn, document_id)
                .map_err(|e| format!("adopt_large_text_read_failed: {}", e))?;
        return Ok(count_words(&full_content));
    }

    Ok(word_count)
}

fn adopt_chapter_draft_internal(
    conn: &mut Connection,
    draft_id: &str,
    chapter_id: &str,
) -> Result<ChapterDraftDto, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction()
        .map_err(|e| format!("adopt_transaction_begin_failed: {}", e))?;

    let word_count = validate_live_draft_target_internal(&transaction, draft_id, chapter_id)?;
    let (chapter_novel_id, previous_adopted_draft_id) = transaction
        .query_row(
            "SELECT novel_id, adopted_draft_id FROM chapters
             WHERE id = ?1 AND deleted_at IS NULL",
            params![chapter_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .map_err(|e| format!("adopt_previous_draft_lookup_failed: {}", e))?;
    let adopted_draft_changed = previous_adopted_draft_id.as_deref() != Some(draft_id);

    transaction
        .execute(
            "UPDATE chapter_drafts SET is_adopted = 0, updated_at = ?1 WHERE chapter_id = ?2",
            params![&now, chapter_id],
        )
        .map_err(|e| format!("adopt_clear_previous_failed: {}", e))?;

    let adopted_rows = transaction.execute(
        "UPDATE chapter_drafts SET is_adopted = 1, updated_at = ?1 WHERE id = ?2 AND chapter_id = ?3 AND EXISTS (SELECT 1 FROM chapters AS c WHERE c.id = chapter_drafts.chapter_id AND c.novel_id = chapter_drafts.novel_id AND c.deleted_at IS NULL)",
        params![&now, draft_id, chapter_id],
    ).map_err(|e| format!("adopt_target_update_failed: {}", e))?;
    if adopted_rows != 1 {
        return Err(format!(
            "adopt_conflict: expected one target draft for id={} chapter_id={}, affected_rows={}",
            draft_id, chapter_id, adopted_rows
        ));
    }

    let chapter_rows = transaction.execute(
        "UPDATE chapters SET adopted_draft_id = ?1, word_count = ?2, status = 'adopted', updated_at = ?3 WHERE id = ?4 AND deleted_at IS NULL AND novel_id = (SELECT novel_id FROM chapter_drafts WHERE id = ?1 AND chapter_id = ?4)",
        params![draft_id, word_count, &now, chapter_id],
    ).map_err(|e| format!("adopt_chapter_update_failed: {}", e))?;
    if chapter_rows != 1 {
        return Err(format!(
            "adopt_chapter_conflict: expected one chapter for id={}, affected_rows={}",
            chapter_id, chapter_rows
        ));
    }

    if adopted_draft_changed {
        expire_chapter_context_rows(&transaction, chapter_id, &now)?;
        crate::services::memory_service::invalidate_for_adopted_draft_change(
            &transaction,
            &chapter_novel_id,
            chapter_id,
            draft_id,
            &now,
        )
        .map_err(|e| format!("adopt_memory_invalidation_failed: {}", e))?;
    }

    let adopted = get_draft_by_id_and_chapter_internal(&transaction, draft_id, chapter_id)
        .map_err(|e| format!("adopt_readback_failed: {}", e))?;
    if !adopted.is_adopted {
        return Err(format!(
            "adopt_readback_conflict: draft '{}' is not marked adopted",
            draft_id
        ));
    }

    transaction
        .commit()
        .map_err(|e| format!("adopt_transaction_commit_failed: {}", e))?;
    Ok(adopted)
}

#[tauri::command]
pub fn adopt_chapter_draft(
    draft_id: String,
    chapter_id: String,
) -> Result<ChapterDraftDto, String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    adopt_chapter_draft_internal(&mut conn, &draft_id, &chapter_id)
}

#[tauri::command]
pub fn delete_chapter_draft(id: String, chapter_id: String) -> Result<(), String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    delete_chapter_draft_internal(&mut conn, &id, &chapter_id)
}

fn delete_chapter_draft_internal(
    conn: &mut Connection,
    id: &str,
    chapter_id: &str,
) -> Result<(), String> {
    let transaction = conn
        .transaction()
        .map_err(|e| format!("draft_delete_transaction_begin_failed: {}", e))?;
    let old_large_text_ref = transaction
        .query_row(
            "SELECT large_text_ref_id FROM chapter_drafts WHERE id = ?1 AND chapter_id = ?2",
            params![id, chapter_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|e| format!("draft_delete_large_text_lookup_failed: {}", e))?
        .flatten();
    transaction
        .execute(
            "DELETE FROM chapter_drafts WHERE id = ?1 AND chapter_id = ?2",
            params![id, chapter_id],
        )
        .map_err(|e| format!("draft_delete_failed: {}", e))?;
    if let Some(old_document_id) = old_large_text_ref.as_deref() {
        crate::large_text_save::delete_unreferenced_draft_large_text(
            &transaction,
            old_document_id,
        )?;
    }
    transaction
        .commit()
        .map_err(|e| format!("draft_delete_transaction_commit_failed: {}", e))?;
    Ok(())
}

// ==================== Chapter Engineering State ====================

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

fn map_chapter_engineering_state_row(
    row: &Row<'_>,
) -> rusqlite::Result<ChapterEngineeringStateDto> {
    Ok(ChapterEngineeringStateDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        volume_id: row.get(2)?,
        chapter_id: row.get(3)?,
        chapter_card_json: row.get(4)?,
        scene_plan_json: row.get(5)?,
        generation_constraints_json: row.get(6)?,
        quality_rules_json: row.get(7)?,
        draft_version: row.get(8)?,
        active_version: row.get(9)?,
        status: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        activated_at: row.get(13)?,
    })
}

fn get_chapter_engineering_state_by_id_internal(
    conn: &Connection,
    id: &str,
) -> Result<ChapterEngineeringStateDto, String> {
    let mut stmt = conn.prepare(
        "SELECT id, novel_id, volume_id, chapter_id, chapter_card_json, scene_plan_json, generation_constraints_json, quality_rules_json, draft_version, active_version, status, created_at, updated_at, activated_at FROM chapter_engineering_states WHERE id = ?1",
    ).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_chapter_engineering_state_row)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_chapter_engineering_states(
    chapter_id: String,
) -> Result<Vec<ChapterEngineeringStateDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, novel_id, volume_id, chapter_id, chapter_card_json, scene_plan_json, generation_constraints_json, quality_rules_json, draft_version, active_version, status, created_at, updated_at, activated_at FROM chapter_engineering_states WHERE chapter_id = ?1 ORDER BY draft_version DESC, updated_at DESC",
    ).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![chapter_id], map_chapter_engineering_state_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn save_chapter_engineering_draft(
    input: SaveChapterEngineeringDraftInput,
) -> Result<ChapterEngineeringStateDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let max_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(draft_version), 0) FROM chapter_engineering_states WHERE chapter_id = ?1",
            params![&input.chapter_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let active_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(draft_version), 0) FROM chapter_engineering_states WHERE chapter_id = ?1 AND status = 'active'",
            params![&input.chapter_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO chapter_engineering_states (id, novel_id, volume_id, chapter_id, chapter_card_json, scene_plan_json, generation_constraints_json, quality_rules_json, draft_version, active_version, status, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'draft',?11,?11)",
        params![
            &id,
            &input.novel_id,
            &input.volume_id,
            &input.chapter_id,
            &input.chapter_card_json,
            &input.scene_plan_json,
            &input.generation_constraints_json,
            &input.quality_rules_json,
            max_version + 1,
            active_version,
            &now,
        ],
    ).map_err(|e| e.to_string())?;

    get_chapter_engineering_state_by_id_internal(&conn, &id)
}

#[tauri::command]
pub fn activate_chapter_engineering_state(
    id: String,
    chapter_id: String,
) -> Result<ChapterEngineeringStateDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let draft_version: i64 = match conn.query_row(
        "SELECT draft_version FROM chapter_engineering_states WHERE id = ?1 AND chapter_id = ?2",
        params![&id, &chapter_id],
        |row| row.get(0),
    ) {
        Ok(version) => version,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err("chapter engineering state not found".to_string())
        }
        Err(e) => return Err(e.to_string()),
    };
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE chapter_engineering_states SET status = 'archived', updated_at = ?1 WHERE chapter_id = ?2 AND status = 'active'",
        params![&now, &chapter_id],
    ).map_err(|e| e.to_string())?;
    let affected = conn.execute(
        "UPDATE chapter_engineering_states SET status = 'active', active_version = ?1, updated_at = ?2, activated_at = ?2 WHERE id = ?3 AND chapter_id = ?4",
        params![draft_version, &now, &id, &chapter_id],
    ).map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("chapter engineering state not found".to_string());
    }

    get_chapter_engineering_state_by_id_internal(&conn, &id)
}

// ==================== Chapter Generation Snapshot ====================

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

fn map_chapter_generation_snapshot_row(
    row: &Row<'_>,
) -> rusqlite::Result<ChapterGenerationSnapshotDto> {
    Ok(ChapterGenerationSnapshotDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        volume_id: row.get(2)?,
        chapter_id: row.get(3)?,
        engineering_state_id: row.get(4)?,
        style_profile_id: row.get(5)?,
        output_profile_id: row.get(6)?,
        compiled_context_json: row.get(7)?,
        compiled_prompt_text: row.get(8)?,
        prompt_summary: row.get(9)?,
        context_hash: row.get(10)?,
        sources_json: row.get(11)?,
        created_at: row.get(12)?,
    })
}

fn get_chapter_generation_snapshot_by_id_internal(
    conn: &Connection,
    id: &str,
) -> Result<ChapterGenerationSnapshotDto, String> {
    let mut stmt = conn.prepare(
        "SELECT id, novel_id, volume_id, chapter_id, engineering_state_id, style_profile_id, output_profile_id, compiled_context_json, compiled_prompt_text, prompt_summary, context_hash, sources_json, created_at FROM chapter_generation_snapshots WHERE id = ?1",
    ).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_chapter_generation_snapshot_row)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_chapter_generation_snapshot(
    input: SaveChapterGenerationSnapshotInput,
) -> Result<ChapterGenerationSnapshotDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO chapter_generation_snapshots (id, novel_id, volume_id, chapter_id, engineering_state_id, style_profile_id, output_profile_id, compiled_context_json, compiled_prompt_text, prompt_summary, context_hash, sources_json, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        params![
            &input.id,
            &input.novel_id,
            &input.volume_id,
            &input.chapter_id,
            &input.engineering_state_id,
            &input.style_profile_id,
            &input.output_profile_id,
            &input.compiled_context_json,
            &input.compiled_prompt_text,
            &input.prompt_summary,
            &input.context_hash,
            &input.sources_json,
            &input.created_at,
        ],
    ).map_err(|e| e.to_string())?;

    get_chapter_generation_snapshot_by_id_internal(&conn, &input.id)
}

#[tauri::command]
pub fn get_chapter_generation_snapshots(
    chapter_id: String,
) -> Result<Vec<ChapterGenerationSnapshotDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, novel_id, volume_id, chapter_id, engineering_state_id, style_profile_id, output_profile_id, compiled_context_json, compiled_prompt_text, prompt_summary, context_hash, sources_json, created_at FROM chapter_generation_snapshots WHERE chapter_id = ?1 ORDER BY created_at DESC",
    ).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![chapter_id], map_chapter_generation_snapshot_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_latest_chapter_generation_snapshot(
    chapter_id: String,
) -> Result<Option<ChapterGenerationSnapshotDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, novel_id, volume_id, chapter_id, engineering_state_id, style_profile_id, output_profile_id, compiled_context_json, compiled_prompt_text, prompt_summary, context_hash, sources_json, created_at FROM chapter_generation_snapshots WHERE chapter_id = ?1 ORDER BY created_at DESC LIMIT 1",
    ).map_err(|e| e.to_string())?;
    match stmt.query_row(params![chapter_id], map_chapter_generation_snapshot_row) {
        Ok(snapshot) => Ok(Some(snapshot)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// ==================== Generation Jobs ====================

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

fn map_generation_job_row(row: &Row<'_>) -> rusqlite::Result<GenerationJobDto> {
    Ok(GenerationJobDto {
        id: row.get(0)?,
        world_id: row.get(1)?,
        novel_id: row.get(2)?,
        volume_id: row.get(3)?,
        chapter_id: row.get(4)?,
        job_type: row.get(5)?,
        status: row.get(6)?,
        current_step: row.get(7)?,
        progress_percent: row.get(8)?,
        provider: row.get(9)?,
        model_name: row.get(10)?,
        input_token_estimate: row.get(11)?,
        output_token_estimate: row.get(12)?,
        actual_input_tokens: row.get(13)?,
        actual_output_tokens: row.get(14)?,
        cost_estimate: row.get(15)?,
        error_code: row.get(16)?,
        error_message: row.get(17)?,
        retry_count: row.get(18)?,
        created_at: row.get(19)?,
        started_at: row.get(20)?,
        finished_at: row.get(21)?,
    })
}

fn map_generation_step_result_row(row: &Row<'_>) -> rusqlite::Result<GenerationStepResultDto> {
    Ok(GenerationStepResultDto {
        id: row.get(0)?,
        job_id: row.get(1)?,
        step_name: row.get(2)?,
        status: row.get(3)?,
        input_snapshot_json: row.get(4)?,
        output_json: row.get(5)?,
        output_text: row.get(6)?,
        error_message: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn get_generation_job_by_id_internal(
    conn: &Connection,
    id: &str,
) -> Result<GenerationJobDto, String> {
    let mut stmt = conn.prepare(
        "SELECT id, world_id, novel_id, volume_id, chapter_id, job_type, status, current_step, progress_percent, provider, model_name, input_token_estimate, output_token_estimate, actual_input_tokens, actual_output_tokens, cost_estimate, error_code, error_message, retry_count, created_at, started_at, finished_at FROM generation_jobs WHERE id = ?1",
    ).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_generation_job_row)
        .map_err(|e| e.to_string())
}

fn generation_job_status_is_terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled")
}

fn generation_job_transition_is_allowed(current: &str, next: &str) -> bool {
    current == next
        || matches!(
            (current, next),
            ("pending", "running")
                | ("pending", "retrying")
                | ("pending", "failed")
                | ("pending", "cancelled")
                | ("running", "retrying")
                | ("running", "completed")
                | ("running", "failed")
                | ("running", "cancelled")
                | ("retrying", "running")
                | ("retrying", "completed")
                | ("retrying", "failed")
                | ("retrying", "cancelled")
        )
}

fn update_generation_job_internal(
    conn: &Connection,
    input: &UpdateGenerationJobInput,
) -> Result<GenerationJobDto, String> {
    let current = get_generation_job_by_id_internal(conn, &input.id)
        .map_err(|error| format!("generation_job_not_found: {}", error))?;
    if generation_job_status_is_terminal(&current.status) {
        return Err(format!(
            "generation_job_terminal: {} is already {}",
            input.id, current.status
        ));
    }
    if let Some(next_status) = input.status.as_deref() {
        if !generation_job_transition_is_allowed(&current.status, next_status) {
            return Err(format!(
                "generation_job_invalid_transition: {} -> {}",
                current.status, next_status
            ));
        }
    }
    if let Some(progress) = input.progress_percent {
        if !(0..=100).contains(&progress) {
            return Err(format!(
                "generation_job_invalid_progress: {} is outside 0..100",
                progress
            ));
        }
        if progress < current.progress_percent {
            return Err(format!(
                "generation_job_progress_regression: {} -> {}",
                current.progress_percent, progress
            ));
        }
    }

    let affected = conn
        .execute(
            "UPDATE generation_jobs SET status = COALESCE(?1, status), current_step = COALESCE(?2, current_step), progress_percent = COALESCE(?3, progress_percent), provider = COALESCE(?4, provider), model_name = COALESCE(?5, model_name), input_token_estimate = COALESCE(?6, input_token_estimate), output_token_estimate = COALESCE(?7, output_token_estimate), actual_input_tokens = COALESCE(?8, actual_input_tokens), actual_output_tokens = COALESCE(?9, actual_output_tokens), cost_estimate = COALESCE(?10, cost_estimate), error_code = COALESCE(?11, error_code), error_message = COALESCE(?12, error_message), retry_count = COALESCE(?13, retry_count), started_at = COALESCE(?14, started_at), finished_at = COALESCE(?15, finished_at) WHERE id = ?16",
            params![
                &input.status,
                &input.current_step,
                input.progress_percent,
                &input.provider,
                &input.model_name,
                input.input_token_estimate,
                input.output_token_estimate,
                input.actual_input_tokens,
                input.actual_output_tokens,
                input.cost_estimate,
                &input.error_code,
                &input.error_message,
                input.retry_count,
                &input.started_at,
                &input.finished_at,
                &input.id,
            ],
        )
        .map_err(|e| e.to_string())?;
    if affected != 1 {
        return Err(format!(
            "generation_job_update_conflict: expected one row, affected {}",
            affected
        ));
    }
    get_generation_job_by_id_internal(conn, &input.id)
}

#[tauri::command]
pub fn create_generation_job(input: CreateGenerationJobInput) -> Result<GenerationJobDto, String> {
    if input.status != "pending" || input.progress_percent != 0 {
        return Err("generation_job_invalid_initial_state: expected pending at 0%".to_string());
    }
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO generation_jobs (id, world_id, novel_id, volume_id, chapter_id, job_type, status, current_step, progress_percent, provider, model_name, retry_count, created_at, started_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
        params![
            &input.id,
            &input.world_id,
            &input.novel_id,
            &input.volume_id,
            &input.chapter_id,
            &input.job_type,
            &input.status,
            &input.current_step,
            input.progress_percent,
            &input.provider,
            &input.model_name,
            input.retry_count,
            &input.created_at,
            &input.started_at,
        ],
    ).map_err(|e| e.to_string())?;
    get_generation_job_by_id_internal(&conn, &input.id)
}

#[tauri::command]
pub fn update_generation_job(input: UpdateGenerationJobInput) -> Result<GenerationJobDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    update_generation_job_internal(&conn, &input)
}

#[tauri::command]
pub fn get_generation_job(id: String) -> Result<Option<GenerationJobDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    match get_generation_job_by_id_internal(&conn, &id) {
        Ok(job) => Ok(Some(job)),
        Err(err) if err.contains("Query returned no rows") => Ok(None),
        Err(err) => Err(err),
    }
}

#[tauri::command]
pub fn get_generation_jobs_by_chapter_id(
    chapter_id: String,
) -> Result<Vec<GenerationJobDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, world_id, novel_id, volume_id, chapter_id, job_type, status, current_step, progress_percent, provider, model_name, input_token_estimate, output_token_estimate, actual_input_tokens, actual_output_tokens, cost_estimate, error_code, error_message, retry_count, created_at, started_at, finished_at FROM generation_jobs WHERE chapter_id = ?1 ORDER BY created_at DESC",
    ).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![chapter_id], map_generation_job_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn cancel_generation_job(
    id: String,
    finished_at: String,
) -> Result<Option<GenerationJobDto>, String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    cancel_generation_job_internal(&mut conn, &id, &finished_at)
}

fn cancel_generation_job_internal(
    conn: &mut Connection,
    id: &str,
    finished_at: &str,
) -> Result<Option<GenerationJobDto>, String> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("generation_job_cancel_begin_failed: {}", error))?;
    let current = match get_generation_job_by_id_internal(&tx, id) {
        Ok(job) => job,
        Err(error) if error.contains("Query returned no rows") => return Ok(None),
        Err(error) => return Err(error),
    };
    if generation_job_status_is_terminal(&current.status) {
        tx.commit()
            .map_err(|error| format!("generation_job_cancel_commit_failed: {}", error))?;
        return Ok(Some(current));
    }

    let step_name = normalized_recovery_step_name(current.current_step.clone());
    tx.execute(
        "UPDATE generation_jobs SET status = 'cancelled', finished_at = ?1 WHERE id = ?2 AND status NOT IN ('completed', 'failed', 'cancelled')",
        params![finished_at, id],
    )
    .map_err(|error| format!("generation_job_cancel_update_failed: {}", error))?;
    tx.execute(
        "INSERT INTO generation_step_results (id, job_id, step_name, status, output_text, created_at) VALUES (?1, ?2, ?3, 'cancelled', ?4, ?5)",
        params![
            uuid::Uuid::new_v4().to_string(),
            id,
            step_name,
            "任务已取消。",
            finished_at,
        ],
    )
    .map_err(|error| format!("generation_job_cancel_checkpoint_failed: {}", error))?;
    let cancelled = get_generation_job_by_id_internal(&tx, id)?;
    tx.commit()
        .map_err(|error| format!("generation_job_cancel_commit_failed: {}", error))?;
    Ok(Some(cancelled))
}

#[tauri::command]
pub fn save_generation_step_result(
    input: SaveGenerationStepResultInput,
) -> Result<GenerationStepResultDto, String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    save_generation_step_result_internal(&mut conn, &input)
}

fn save_generation_step_result_internal(
    conn: &mut Connection,
    input: &SaveGenerationStepResultInput,
) -> Result<GenerationStepResultDto, String> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("generation_step_begin_failed: {}", error))?;
    let parent = get_generation_job_by_id_internal(&tx, &input.job_id)
        .map_err(|error| format!("generation_step_parent_not_found: {}", error))?;
    if generation_job_status_is_terminal(&parent.status) {
        return Err(format!(
            "generation_step_parent_terminal: {} is already {}",
            input.job_id, parent.status
        ));
    }
    tx.execute(
        "INSERT INTO generation_step_results (id, job_id, step_name, status, input_snapshot_json, output_json, output_text, error_message, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            &input.id,
            &input.job_id,
            &input.step_name,
            &input.status,
            &input.input_snapshot_json,
            &input.output_json,
            &input.output_text,
            &input.error_message,
            &input.created_at,
        ],
    ).map_err(|e| e.to_string())?;
    let result = {
        let mut stmt = tx.prepare(
            "SELECT id, job_id, step_name, status, input_snapshot_json, output_json, output_text, error_message, created_at FROM generation_step_results WHERE id = ?1",
        ).map_err(|e| e.to_string())?;
        stmt.query_row(params![&input.id], map_generation_step_result_row)
            .map_err(|e| e.to_string())?
    };
    tx.commit()
        .map_err(|error| format!("generation_step_commit_failed: {}", error))?;
    Ok(result)
}

#[tauri::command]
pub fn get_generation_step_results(job_id: String) -> Result<Vec<GenerationStepResultDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    get_generation_step_results_internal(&conn, &job_id)
}

fn get_generation_step_results_internal(
    conn: &Connection,
    job_id: &str,
) -> Result<Vec<GenerationStepResultDto>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, job_id, step_name, status, input_snapshot_json, output_json, output_text, error_message, created_at FROM generation_step_results WHERE job_id = ?1 ORDER BY created_at ASC, id ASC",
    ).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![job_id], map_generation_step_result_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

const STARTUP_RECOVERY_ERROR_CODE: &str = "APP_RESTART_INTERRUPTED";
const STARTUP_RECOVERY_MESSAGE: &str =
    "应用在任务完成前退出；已保留完成步骤和草稿，请确认后手动重新开始。";

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StartupTaskRecoveryDto {
    pub recovered_jobs: i64,
    pub recovered_at: String,
}

#[derive(Debug)]
struct InterruptedGenerationJob {
    id: String,
    previous_status: String,
    current_step: Option<String>,
    progress_percent: i64,
}

fn normalized_recovery_step_name(current_step: Option<String>) -> String {
    const STEPS: [&str; 9] = [
        "preflight",
        "compile_context",
        "chapter_card",
        "scene_plan",
        "draft_generation",
        "quality_check",
        "patch_generation",
        "patch_apply",
        "save_version",
    ];
    current_step
        .filter(|step| STEPS.contains(&step.as_str()))
        .unwrap_or_else(|| "preflight".to_string())
}

fn recover_interrupted_generation_jobs_internal(
    conn: &mut Connection,
    recovered_at: &str,
) -> Result<StartupTaskRecoveryDto, String> {
    let tx = conn
        .transaction()
        .map_err(|error| format!("task_recovery_begin_failed: {}", error))?;
    let jobs = {
        let mut stmt = tx
            .prepare(
                "SELECT id, status, current_step, progress_percent FROM generation_jobs WHERE status IN ('pending', 'running', 'retrying') ORDER BY created_at ASC, id ASC",
            )
            .map_err(|error| format!("task_recovery_query_failed: {}", error))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(InterruptedGenerationJob {
                    id: row.get(0)?,
                    previous_status: row.get(1)?,
                    current_step: row.get(2)?,
                    progress_percent: row.get(3)?,
                })
            })
            .map_err(|error| format!("task_recovery_query_failed: {}", error))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("task_recovery_query_failed: {}", error))?;
        rows
    };

    let mut recovered_jobs = 0_i64;
    for job in jobs {
        let affected = tx
            .execute(
                "UPDATE generation_jobs SET status = 'failed', error_code = ?1, error_message = ?2, finished_at = ?3 WHERE id = ?4 AND status IN ('pending', 'running', 'retrying')",
                params![
                    STARTUP_RECOVERY_ERROR_CODE,
                    STARTUP_RECOVERY_MESSAGE,
                    recovered_at,
                    &job.id,
                ],
            )
            .map_err(|error| format!("task_recovery_job_update_failed: {}", error))?;
        if affected == 0 {
            continue;
        }

        let step_name = normalized_recovery_step_name(job.current_step);
        let output_json = serde_json::json!({
            "recoveryReason": STARTUP_RECOVERY_ERROR_CODE,
            "previousStatus": job.previous_status,
            "preservedProgressPercent": job.progress_percent,
        })
        .to_string();
        tx.execute(
            "INSERT INTO generation_step_results (id, job_id, step_name, status, output_json, output_text, error_message, created_at) VALUES (?1, ?2, ?3, 'failed', ?4, ?5, ?5, ?6)",
            params![
                uuid::Uuid::new_v4().to_string(),
                &job.id,
                step_name,
                output_json,
                STARTUP_RECOVERY_MESSAGE,
                recovered_at,
            ],
        )
        .map_err(|error| format!("task_recovery_checkpoint_insert_failed: {}", error))?;
        recovered_jobs += 1;
    }

    tx.commit()
        .map_err(|error| format!("task_recovery_commit_failed: {}", error))?;
    Ok(StartupTaskRecoveryDto {
        recovered_jobs,
        recovered_at: recovered_at.to_string(),
    })
}

#[tauri::command]
pub fn recover_interrupted_generation_jobs() -> Result<StartupTaskRecoveryDto, String> {
    let recovered_at = chrono::Utc::now().to_rfc3339();
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    recover_interrupted_generation_jobs_internal(&mut conn, &recovered_at)
}

// ==================== AI Task Records ====================

#[derive(Debug, Serialize, Deserialize)]
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

fn validate_mark_ai_task_succeeded_input(input: &MarkAiTaskSucceededInput) -> Result<(), String> {
    for (field, value) in [
        ("tokenInput", input.token_input),
        ("tokenOutput", input.token_output),
        ("tokenTotal", input.token_total),
        ("durationMs", input.duration_ms),
    ] {
        if value.is_some_and(|number| number < 0) {
            return Err(format!("{field} must be non-negative"));
        }
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAiTaskRecordsInput {
    pub ids: Vec<String>,
}

#[derive(Debug, Serialize)]
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
    /// 子表被清理的引用行数 { table_name: rows_updated }
    pub deleted_child_rows: std::collections::HashMap<String, i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskRecordsDebugState {
    pub db_path: String,
    pub table_exists: bool,
    pub total_count: i64,
    pub matched_count: Option<i64>,
    pub sample_ids: Vec<String>,
}

fn map_ai_task_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiTaskRecordDto> {
    Ok(AiTaskRecordDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        chapter_id: row.get(2)?,
        task_type: row.get(3)?,
        status: row.get(4)?,
        runtime_mode: row.get(5)?,
        provider: row.get(6)?,
        model_name: row.get(7)?,
        prompt_template_id: row.get(8)?,
        input_summary: row.get(9)?,
        prompt_snapshot: row.get(10)?,
        result_text: row.get(11)?,
        result_json: row.get(12)?,
        error_message: row.get(13)?,
        token_input: row.get(14)?,
        token_output: row.get(15)?,
        token_total: row.get(16)?,
        input_price_per_million_tokens: row.get(17)?,
        output_price_per_million_tokens: row.get(18)?,
        cost_estimate: row.get(19)?,
        cost_currency: row.get(20)?,
        cost_status: row.get(21)?,
        pricing_source: row.get(22)?,
        duration_ms: row.get(23)?,
        started_at: row.get(24)?,
        finished_at: row.get(25)?,
        created_at: row.get(26)?,
    })
}

fn ai_task_select_sql() -> &'static str {
    "SELECT id, novel_id, chapter_id, task_type, status, runtime_mode, provider, model_name, prompt_template_id, input_summary, prompt_snapshot, result_text, result_json, error_message, token_input, token_output, token_total, input_price_per_million_tokens, output_price_per_million_tokens, cost_estimate, cost_currency, cost_status, pricing_source, duration_ms, started_at, finished_at, created_at FROM ai_task_records"
}

fn ai_task_db_path_for_log() -> String {
    get_database_path().display().to_string()
}

fn normalize_ai_task_ids(ids: Vec<String>) -> Vec<String> {
    let mut ids = ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    ids
}

fn ai_task_records_table_exists(conn: &Connection) -> Result<bool, String> {
    let count = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'ai_task_records'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| format!("Failed to check ai_task_records table: {}", e))?;
    Ok(count > 0)
}

fn ensure_ai_task_records_table(conn: &Connection, db_path: &str) -> Result<(), String> {
    let table_exists = ai_task_records_table_exists(conn)?;
    if !table_exists {
        return Err(format!(
            "ai_task_records table does not exist. db_path={}",
            db_path
        ));
    }
    Ok(())
}

fn count_ai_task_records_in_conn(conn: &Connection) -> Result<i64, String> {
    conn.query_row("SELECT COUNT(*) FROM ai_task_records", [], |row| row.get(0))
        .map_err(|e| e.to_string())
}

const AI_TASK_TYPE_FILTERS: &[&str] = &[
    "connection_test",
    "setting_expand",
    "setting_suggestion_generate",
    "outline_generate",
    "volume_outline_generate",
    "context_summarize",
    "setting_structure",
    "rule_structure",
    "protagonist_structure",
    "volume_outline_expand",
    "chapter_outline_generate",
    "style_analyze",
    "character_generate",
    "event_suggest",
    "chapter_generate",
    "chapter_beat_repair",
    "chapter_scene_generate",
    "chapter_scene_plan_generate",
    "chapter_rewrite",
    "chapter_polish",
    "quality_check",
    "quality_fix",
    "multi_agent_review",
    "multi_agent_revision",
    "autonomous_plot_plan",
    "autonomous_character_evolution",
    "autonomous_world_build",
    "autonomous_conflict_generate",
    "autonomous_pacing_control",
    "autonomous_chapter_batch",
    "chapter_summarize",
    "context_update",
];
const AI_TASK_STATUS_FILTERS: &[&str] = &["pending", "running", "succeeded", "failed", "cancelled"];

fn normalize_ai_task_filter(
    value: Option<String>,
    allowed: &[&str],
    label: &str,
) -> Result<Option<String>, String> {
    let value = value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty());
    if let Some(candidate) = value.as_deref() {
        if !allowed.contains(&candidate) {
            return Err(format!("invalid AI task {} filter", label));
        }
    }
    Ok(value)
}

fn normalize_ai_task_type_filter(value: Option<String>) -> Result<Option<String>, String> {
    normalize_ai_task_filter(value, AI_TASK_TYPE_FILTERS, "type")
}

fn normalize_ai_task_status_filter(value: Option<String>) -> Result<Option<String>, String> {
    normalize_ai_task_filter(value, AI_TASK_STATUS_FILTERS, "status")
}

fn count_ai_task_records_filtered_in_conn(
    conn: &Connection,
    task_type: Option<&str>,
    status: Option<&str>,
) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM ai_task_records WHERE (?1 IS NULL OR task_type = ?1) AND (?2 IS NULL OR status = ?2)",
        params![task_type, status],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn count_ai_task_records_by_ids(conn: &Connection, ids: &[String]) -> Result<i64, String> {
    let mut count = 0_i64;
    for id in ids {
        count += conn
            .query_row(
                "SELECT COUNT(*) FROM ai_task_records WHERE id = ?1",
                params![id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(count)
}

fn ensure_ai_tasks_are_not_bound_to_completed_quality_reports(
    conn: &Connection,
    ids: Option<&[String]>,
) -> Result<(), String> {
    let protected_count = if let Some(ids) = ids {
        let mut count = 0_i64;
        for id in ids {
            count += conn
                .query_row(
                    "SELECT COUNT(*) FROM quality_check_reports
                     WHERE status = 'completed' AND ai_task_id = ?1",
                    params![id],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|error| error.to_string())?;
        }
        count
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM quality_check_reports
             WHERE status = 'completed' AND ai_task_id IS NOT NULL",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?
    };

    if protected_count > 0 {
        return Err("quality_check_ai_task_delete_protected".to_string());
    }
    Ok(())
}

fn ensure_ai_tasks_are_terminal(conn: &Connection, ids: Option<&[String]>) -> Result<(), String> {
    let active_count = if let Some(ids) = ids {
        let mut count = 0_i64;
        for id in ids {
            count += conn
                .query_row(
                    "SELECT COUNT(*) FROM ai_task_records
                     WHERE id = ?1 AND status IN ('pending', 'running')",
                    params![id],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|error| error.to_string())?;
        }
        count
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM ai_task_records WHERE status IN ('pending', 'running')",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?
    };
    if active_count > 0 {
        return Err("ai_task_running_delete_protected".to_string());
    }
    Ok(())
}

fn sample_ai_task_ids(conn: &Connection, limit: i64) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM ai_task_records ORDER BY created_at DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;
    let ids = stmt
        .query_map(params![limit], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(ids)
}

fn delete_ai_task_records_by_ids_internal(
    conn: &Connection,
    ids: Vec<String>,
    db_path: String,
) -> Result<DeleteAiTaskRecordsResult, String> {
    let ids = normalize_ai_task_ids(ids);
    let requested_count = ids.len() as i64;
    let table_exists = ai_task_records_table_exists(conn)?;
    log_workspace_event(WorkspaceLogEvent {
        level: "info",
        event: "ai_task_delete_many_started",
        trace_id: None,
        operation_id: None,
        novel_id: None,
        chapter_id: None,
        draft_id: None,
        error_code: None,
        metadata: Some(serde_json::json!({
            "tableExists": table_exists,
            "requestedCount": requested_count,
        })),
    });
    ensure_ai_task_records_table(conn, &db_path)?;
    let before_count = count_ai_task_records_in_conn(conn)?;

    if ids.is_empty() {
        log_workspace_event(WorkspaceLogEvent {
            level: "info",
            event: "ai_task_delete_many_empty",
            trace_id: None,
            operation_id: None,
            novel_id: None,
            chapter_id: None,
            draft_id: None,
            error_code: None,
            metadata: Some(serde_json::json!({ "beforeCount": before_count })),
        });
        return Ok(DeleteAiTaskRecordsResult {
            deleted_count: 0,
            requested_count,
            before_count,
            after_count: before_count,
            before_match_count: 0,
            after_match_count: 0,
            affected_rows: 0,
            db_path,
            deleted_child_rows: std::collections::HashMap::new(),
        });
    }

    let before_match_count = count_ai_task_records_by_ids(conn, &ids)?;
    if before_match_count == 0 {
        let sample_ids = sample_ai_task_ids(conn, 5)?;
        log_workspace_event(WorkspaceLogEvent {
            level: "warn",
            event: "ai_task_delete_many_no_match",
            trace_id: None,
            operation_id: None,
            novel_id: None,
            chapter_id: None,
            draft_id: None,
            error_code: Some("AI_TASK_NOT_FOUND"),
            metadata: Some(serde_json::json!({
                "requestedCount": requested_count,
                "sampleCount": sample_ids.len(),
                "beforeCount": before_count,
            })),
        });
        return Err("No AI task records matched selected ids.".to_string());
    }
    ensure_ai_tasks_are_terminal(conn, Some(&ids))?;
    ensure_ai_tasks_are_not_bound_to_completed_quality_reports(conn, Some(&ids))?;

    // 构建 IN 子句占位符
    let placeholders: Vec<String> = ids.iter().map(|_| "?".to_string()).collect();
    let placeholders_str = placeholders.join(",");

    // 开启事务
    conn.execute_batch("BEGIN TRANSACTION")
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    let mut deleted_child_rows: std::collections::HashMap<String, i64> =
        std::collections::HashMap::new();

    // 按顺序清理子表引用（FOREIGN KEY 子表必须在父表删除前处理）
    let child_tables: &[&str] = &[
        "chapter_drafts",
        "quality_check_reports",
        "polish_records",
        // 以下表无 FK 约束，但清理 ai_task_id 引用以保持数据整洁
        "chapter_events",
        "chapter_summaries",
    ];

    for table in child_tables {
        let sql = format!(
            "UPDATE {} SET ai_task_id = NULL WHERE ai_task_id IN ({})",
            table, placeholders_str
        );
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = ids
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        match conn.execute(&sql, rusqlite::params_from_iter(params_refs.iter())) {
            Ok(rows) => {
                if rows > 0 {
                    log_workspace_event(WorkspaceLogEvent {
                        level: "info",
                        event: "ai_task_delete_many_child_cleanup",
                        trace_id: None,
                        operation_id: None,
                        novel_id: None,
                        chapter_id: None,
                        draft_id: None,
                        error_code: None,
                        metadata: Some(serde_json::json!({ "table": table, "rows": rows })),
                    });
                    deleted_child_rows.insert(table.to_string(), rows as i64);
                }
            }
            Err(e) => {
                let msg = format!("Failed to clean child table {}: {}", table, e);
                log_workspace_event(WorkspaceLogEvent {
                    level: "error",
                    event: "ai_task_delete_many_child_cleanup_failed",
                    trace_id: None,
                    operation_id: None,
                    novel_id: None,
                    chapter_id: None,
                    draft_id: None,
                    error_code: Some("DATABASE_TRANSACTION_FAILED"),
                    metadata: Some(serde_json::json!({ "table": table })),
                });
                let _ = conn.execute_batch("ROLLBACK");
                return Err(msg);
            }
        }
    }

    // 删除父表记录
    let mut affected_rows = 0_i64;
    for id in &ids {
        match conn.execute("DELETE FROM ai_task_records WHERE id = ?1", params![id]) {
            Ok(rows) => affected_rows += rows as i64,
            Err(e) => {
                let msg = format!("Failed to delete ai_task_record: {}", e);
                log_workspace_event(WorkspaceLogEvent {
                    level: "error",
                    event: "ai_task_delete_many_parent_delete_failed",
                    trace_id: None,
                    operation_id: None,
                    novel_id: None,
                    chapter_id: None,
                    draft_id: None,
                    error_code: Some("DATABASE_TRANSACTION_FAILED"),
                    metadata: None,
                });
                let _ = conn.execute_batch("ROLLBACK");
                return Err(msg);
            }
        }
    }

    let after_match_count = count_ai_task_records_by_ids(conn, &ids)?;
    let after_count = count_ai_task_records_in_conn(conn)?;
    let deleted_count = before_match_count - after_match_count;

    log_workspace_event(WorkspaceLogEvent {
        level: "info",
        event: "ai_task_delete_many_completed",
        trace_id: None,
        operation_id: None,
        novel_id: None,
        chapter_id: None,
        draft_id: None,
        error_code: None,
        metadata: Some(serde_json::json!({
            "beforeCount": before_count,
            "matchedCount": before_match_count,
            "affectedRows": affected_rows,
            "afterMatchCount": after_match_count,
            "afterCount": after_count,
            "deletedCount": deleted_count,
            "childTableCount": deleted_child_rows.len(),
        })),
    });

    if before_match_count > 0 && after_match_count > 0 {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(format!(
            "AI task records still exist after delete. after_match_count={}",
            after_match_count
        ));
    }

    conn.execute_batch("COMMIT")
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;

    Ok(DeleteAiTaskRecordsResult {
        deleted_count,
        requested_count,
        before_count,
        after_count,
        before_match_count,
        after_match_count,
        affected_rows,
        db_path,
        deleted_child_rows,
    })
}

fn clear_ai_task_records_internal(
    conn: &Connection,
    db_path: String,
) -> Result<DeleteAiTaskRecordsResult, String> {
    let table_exists = ai_task_records_table_exists(conn)?;
    log_workspace_event(WorkspaceLogEvent {
        level: "info",
        event: "ai_task_clear_all_started",
        trace_id: None,
        operation_id: None,
        novel_id: None,
        chapter_id: None,
        draft_id: None,
        error_code: None,
        metadata: Some(serde_json::json!({ "tableExists": table_exists })),
    });
    ensure_ai_task_records_table(conn, &db_path)?;
    let before_count = count_ai_task_records_in_conn(conn)?;
    ensure_ai_tasks_are_terminal(conn, None)?;
    ensure_ai_tasks_are_not_bound_to_completed_quality_reports(conn, None)?;

    // 开启事务
    conn.execute_batch("BEGIN TRANSACTION")
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    let mut deleted_child_rows: std::collections::HashMap<String, i64> =
        std::collections::HashMap::new();

    // 按顺序清理子表引用（FOREIGN KEY 子表必须在父表删除前处理）
    // 使用子查询匹配所有 ai_task_records 的 id
    let child_tables: &[&str] = &[
        "chapter_drafts",
        "quality_check_reports",
        "polish_records",
        // 以下表无 FK 约束，但清理 ai_task_id 引用以保持数据整洁
        "chapter_events",
        "chapter_summaries",
    ];

    for table in child_tables {
        let sql = format!(
            "UPDATE {} SET ai_task_id = NULL WHERE ai_task_id IN (SELECT id FROM ai_task_records)",
            table
        );
        match conn.execute(&sql, []) {
            Ok(rows) => {
                if rows > 0 {
                    log_workspace_event(WorkspaceLogEvent {
                        level: "info",
                        event: "ai_task_clear_all_child_cleanup",
                        trace_id: None,
                        operation_id: None,
                        novel_id: None,
                        chapter_id: None,
                        draft_id: None,
                        error_code: None,
                        metadata: Some(serde_json::json!({ "table": table, "rows": rows })),
                    });
                    deleted_child_rows.insert(table.to_string(), rows as i64);
                }
            }
            Err(e) => {
                let msg = format!("Failed to clean child table {}: {}", table, e);
                log_workspace_event(WorkspaceLogEvent {
                    level: "error",
                    event: "ai_task_clear_all_child_cleanup_failed",
                    trace_id: None,
                    operation_id: None,
                    novel_id: None,
                    chapter_id: None,
                    draft_id: None,
                    error_code: Some("DATABASE_TRANSACTION_FAILED"),
                    metadata: Some(serde_json::json!({ "table": table })),
                });
                let _ = conn.execute_batch("ROLLBACK");
                return Err(msg);
            }
        }
    }

    // 删除父表所有记录
    let affected_rows = conn
        .execute("DELETE FROM ai_task_records", [])
        .map_err(|e| {
            let msg = format!("Failed to delete ai_task_records: {}", e);
            log_workspace_event(WorkspaceLogEvent {
                level: "error",
                event: "ai_task_clear_all_parent_delete_failed",
                trace_id: None,
                operation_id: None,
                novel_id: None,
                chapter_id: None,
                draft_id: None,
                error_code: Some("DATABASE_TRANSACTION_FAILED"),
                metadata: None,
            });
            let _ = conn.execute_batch("ROLLBACK");
            msg
        })? as i64;

    let after_count = count_ai_task_records_in_conn(conn)?;
    let deleted_count = before_count - after_count;
    log_workspace_event(WorkspaceLogEvent {
        level: "info",
        event: "ai_task_clear_all_completed",
        trace_id: None,
        operation_id: None,
        novel_id: None,
        chapter_id: None,
        draft_id: None,
        error_code: None,
        metadata: Some(serde_json::json!({
            "beforeCount": before_count,
            "affectedRows": affected_rows,
            "afterCount": after_count,
            "deletedCount": deleted_count,
            "childTableCount": deleted_child_rows.len(),
        })),
    });

    if after_count != 0 {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(format!(
            "AI task records still exist after clear. after_count={}",
            after_count
        ));
    }

    conn.execute_batch("COMMIT")
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;

    Ok(DeleteAiTaskRecordsResult {
        deleted_count,
        requested_count: before_count,
        before_count,
        after_count,
        before_match_count: before_count,
        after_match_count: after_count,
        affected_rows,
        db_path,
        deleted_child_rows,
    })
}

fn validate_ai_task_pricing(input: &CreateAiTaskRecordInput) -> Result<(), String> {
    const MAX_PRICE_PER_MILLION: f64 = 1_000_000.0;
    let valid_price = |value: Option<f64>| {
        value
            .is_none_or(|price| price.is_finite() && (0.0..=MAX_PRICE_PER_MILLION).contains(&price))
    };
    if !valid_price(input.input_price_per_million_tokens)
        || !valid_price(input.output_price_per_million_tokens)
    {
        return Err("AI task pricing must be finite and non-negative".to_string());
    }

    match input.pricing_source.as_deref() {
        None => {
            if input.input_price_per_million_tokens.is_some()
                || input.output_price_per_million_tokens.is_some()
                || input.cost_currency.is_some()
            {
                return Err(
                    "AI task pricing source is required when pricing is present".to_string()
                );
            }
        }
        Some("mock") => {
            if input.input_price_per_million_tokens != Some(0.0)
                || input.output_price_per_million_tokens != Some(0.0)
                || input.cost_currency.as_deref() != Some("USD")
            {
                return Err("Mock AI task pricing must be zero USD".to_string());
            }
        }
        Some("user_configured") => {
            if input.input_price_per_million_tokens.is_none()
                || input.output_price_per_million_tokens.is_none()
                || input.cost_currency.as_deref() != Some("USD")
            {
                return Err("Configured AI task pricing requires both USD token rates".to_string());
            }
        }
        Some("unconfigured") => {
            if input.input_price_per_million_tokens.is_some()
                || input.output_price_per_million_tokens.is_some()
                || input.cost_currency.as_deref() != Some("USD")
            {
                return Err("Unconfigured AI task pricing cannot contain token rates".to_string());
            }
        }
        Some(_) => return Err("Unsupported AI task pricing source".to_string()),
    }
    Ok(())
}

#[tauri::command]
pub fn create_ai_task_record(input: CreateAiTaskRecordInput) -> Result<AiTaskRecordDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    create_ai_task_record_internal(&conn, &input)
}

fn create_ai_task_record_internal(
    conn: &Connection,
    input: &CreateAiTaskRecordInput,
) -> Result<AiTaskRecordDto, String> {
    validate_ai_task_pricing(input)?;
    let id = input.id.clone();
    let existing_count = conn
        .query_row(
            "SELECT COUNT(*) FROM ai_task_records WHERE id = ?1",
            params![&input.id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    if existing_count > 0 {
        let existing = get_ai_task_record_by_id_internal(conn, &id)?;
        validate_ai_task_projection_identity(&existing, input)?;
        return Ok(existing);
    }
    conn.execute(
        "INSERT INTO ai_task_records (id, novel_id, chapter_id, task_type, status, runtime_mode, provider, model_name, input_price_per_million_tokens, output_price_per_million_tokens, cost_currency, pricing_source, input_summary, started_at, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15) ON CONFLICT(id) DO NOTHING",
        params![
            &input.id,
            &input.novel_id,
            &input.chapter_id,
            &input.task_type,
            &input.status,
            &input.runtime_mode,
            &input.provider,
            &input.model_name,
            input.input_price_per_million_tokens,
            input.output_price_per_million_tokens,
            &input.cost_currency,
            &input.pricing_source,
            &input.input_summary,
            &input.started_at,
            &input.created_at,
        ],
    ).map_err(|e| e.to_string())?;

    let created = get_ai_task_record_by_id_internal(conn, &id)?;
    validate_ai_task_projection_identity(&created, input)?;
    Ok(created)
}

fn validate_ai_task_projection_identity(
    existing: &AiTaskRecordDto,
    input: &CreateAiTaskRecordInput,
) -> Result<(), String> {
    if existing.task_type != input.task_type
        || existing.novel_id != input.novel_id
        || existing.chapter_id != input.chapter_id
        || existing.runtime_mode != input.runtime_mode
        || existing.provider != input.provider
        || existing.model_name != input.model_name
    {
        return Err("ai_task_projection_identity_conflict".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn mark_ai_task_running_for_retry(id: String, started_at: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    mark_ai_task_running_for_retry_internal(&conn, &id, &started_at)?;
    Ok(())
}

fn mark_ai_task_running_for_retry_internal(
    conn: &Connection,
    id: &str,
    started_at: &str,
) -> Result<usize, String> {
    conn.execute(
        "UPDATE ai_task_records
         SET status = 'running', error_message = NULL, duration_ms = NULL,
             finished_at = NULL, started_at = ?1
         WHERE id = ?2 AND status = 'failed'",
        params![started_at, id],
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn mark_ai_task_succeeded(id: String, input: MarkAiTaskSucceededInput) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    mark_ai_task_succeeded_internal(&conn, &id, &input)?;
    Ok(())
}

fn mark_ai_task_succeeded_internal(
    conn: &Connection,
    id: &str,
    input: &MarkAiTaskSucceededInput,
) -> Result<usize, String> {
    validate_mark_ai_task_succeeded_input(input)?;
    conn.execute(
        "UPDATE ai_task_records SET status = 'succeeded', result_text = ?1, prompt_snapshot = ?2, result_json = ?3, error_message = NULL, token_input = ?4, token_output = ?5, token_total = ?6,
         cost_estimate = CASE
           WHEN pricing_source = 'mock' THEN 0.0
           WHEN input_price_per_million_tokens IS NOT NULL AND output_price_per_million_tokens IS NOT NULL AND ?4 IS NOT NULL AND ?5 IS NOT NULL
             THEN ROUND(((?4 * input_price_per_million_tokens) + (?5 * output_price_per_million_tokens)) / 1000000.0, 8)
           ELSE NULL
         END,
         cost_status = CASE
           WHEN pricing_source = 'mock' THEN 'mock'
           WHEN input_price_per_million_tokens IS NULL OR output_price_per_million_tokens IS NULL THEN 'unpriced'
           WHEN ?4 IS NULL OR ?5 IS NULL THEN 'usage_missing'
           ELSE 'complete'
         END,
         duration_ms = ?7, finished_at = ?8 WHERE id = ?9 AND status IN ('pending', 'running')",
        params![
            &input.result_text,
            &input.prompt_snapshot,
            &input.result_json,
            input.token_input,
            input.token_output,
            input.token_total,
            input.duration_ms,
            input.finished_at,
            id,
        ],
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mark_ai_task_failed(
    id: String,
    error_message: String,
    finished_at: String,
    duration_ms: Option<i64>,
) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE ai_task_records SET status = 'failed', error_message = ?1, duration_ms = ?2, finished_at = ?3 WHERE id = ?4 AND status IN ('pending', 'running')",
        params![error_message, duration_ms, finished_at, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

fn mark_ai_task_cancelled_internal(
    conn: &Connection,
    id: &str,
    finished_at: &str,
    duration_ms: Option<i64>,
) -> Result<usize, String> {
    conn.execute(
        "UPDATE ai_task_records SET status = 'cancelled', error_message = NULL, duration_ms = ?1, finished_at = ?2 WHERE id = ?3 AND status IN ('pending', 'running')",
        params![duration_ms, finished_at, id],
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mark_ai_task_cancelled(
    id: String,
    finished_at: String,
    duration_ms: Option<i64>,
) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    mark_ai_task_cancelled_internal(&conn, &id, &finished_at, duration_ms)?;
    Ok(())
}

#[tauri::command]
pub fn get_ai_task_records(
    page: Option<i64>,
    size: Option<i64>,
    task_type: Option<String>,
    status: Option<String>,
) -> Result<Vec<AiTaskRecordDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let page = page.unwrap_or(1).max(1);
    let size = size.unwrap_or(20).clamp(1, 500);
    let offset = (page - 1) * size;
    let task_type = normalize_ai_task_type_filter(task_type)?;
    let status = normalize_ai_task_status_filter(status)?;
    let sql = format!(
        "{} WHERE (?3 IS NULL OR task_type = ?3) AND (?4 IS NULL OR status = ?4) ORDER BY created_at DESC LIMIT ?1 OFFSET ?2",
        ai_task_select_sql()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let result = stmt
        .query_map(
            params![size, offset, task_type.as_deref(), status.as_deref()],
            map_ai_task_row,
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    result
}

#[tauri::command]
pub fn count_ai_task_records(
    task_type: Option<String>,
    status: Option<String>,
) -> Result<i64, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let task_type = normalize_ai_task_type_filter(task_type)?;
    let status = normalize_ai_task_status_filter(status)?;
    let count =
        count_ai_task_records_filtered_in_conn(&conn, task_type.as_deref(), status.as_deref())?;
    Ok(count)
}

#[tauri::command]
pub fn delete_ai_task_record(id: String) -> Result<DeleteAiTaskRecordsResult, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let db_path = ai_task_db_path_for_log();
    delete_ai_task_records_by_ids_internal(&conn, vec![id], db_path)
}

#[tauri::command]
pub fn delete_ai_task_records_by_ids(
    input: DeleteAiTaskRecordsInput,
) -> Result<DeleteAiTaskRecordsResult, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let db_path = ai_task_db_path_for_log();
    delete_ai_task_records_by_ids_internal(&conn, input.ids, db_path)
}

#[tauri::command]
pub fn clear_ai_task_records() -> Result<DeleteAiTaskRecordsResult, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let db_path = ai_task_db_path_for_log();
    clear_ai_task_records_internal(&conn, db_path)
}

#[tauri::command]
pub fn get_ai_task_records_debug_state(
    ids: Option<Vec<String>>,
) -> Result<AiTaskRecordsDebugState, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let db_path = ai_task_db_path_for_log();
    let normalized_ids = ids.map(normalize_ai_task_ids);
    let table_exists = ai_task_records_table_exists(&conn)?;
    let matched_count = if table_exists {
        match &normalized_ids {
            Some(ids) if !ids.is_empty() => Some(count_ai_task_records_by_ids(&conn, ids)?),
            Some(_) => Some(0),
            None => None,
        }
    } else {
        normalized_ids.as_ref().map(|_| 0)
    };
    let total_count = if table_exists {
        count_ai_task_records_in_conn(&conn)?
    } else {
        0
    };
    let sample_ids = if table_exists {
        sample_ai_task_ids(&conn, 10)?
    } else {
        Vec::new()
    };
    Ok(AiTaskRecordsDebugState {
        db_path,
        table_exists,
        total_count,
        matched_count,
        sample_ids,
    })
}

#[tauri::command]
pub fn get_ai_task_records_by_chapter_id(
    chapter_id: String,
) -> Result<Vec<AiTaskRecordDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "{} WHERE chapter_id = ?1 ORDER BY created_at DESC",
        ai_task_select_sql()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let result = stmt
        .query_map(params![chapter_id], map_ai_task_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    result
}

#[tauri::command]
pub fn get_ai_task_records_by_novel_id(novel_id: String) -> Result<Vec<AiTaskRecordDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "{} WHERE novel_id = ?1 ORDER BY created_at DESC",
        ai_task_select_sql()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let result = stmt
        .query_map(params![novel_id], map_ai_task_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    result
}

fn get_ai_task_record_by_id_internal(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<AiTaskRecordDto, String> {
    let sql = format!("{} WHERE id = ?1", ai_task_select_sql());
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_ai_task_row)
        .map_err(|e| e.to_string())
}

// ==================== Style Profiles ====================

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleProfileDto {
    pub id: String,
    pub project_id: String,
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
#[allow(dead_code)] // Kept for backwards-compatible IPC payload deserialization.
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

fn map_style_profile_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StyleProfileDto> {
    let is_active: i64 = row.get(17)?;
    Ok(StyleProfileDto {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        narrative_perspective: row.get(4)?,
        tone: row.get(5)?,
        pace: row.get(6)?,
        sentence_style: row.get(7)?,
        dialogue_ratio: row.get::<_, f64>(8)?,
        description_ratio: row.get::<_, f64>(9)?,
        psychological_ratio: row.get(10)?,
        battle_style: row.get(11)?,
        battle_intensity: row.get(12)?,
        emotion_tendency: row.get(13)?,
        chapter_ending: row.get(14)?,
        forbidden_styles_json: row.get(15)?,
        style_summary: row.get(16)?,
        raw_config_json: row.get::<_, Option<String>>(18).unwrap_or(None),
        is_active: is_active != 0,
        source_type: row.get(19)?,
        created_at: row.get(20)?,
        updated_at: row.get(21)?,
        source_asset_id: row.get(22)?,
        source_reference_work_id: row.get(23)?,
        source_reference_import_id: row.get(24)?,
        source_content_sha256: row.get(25)?,
        source_state: row.get(26)?,
        analysis_metadata_json: row.get(27)?,
    })
}

fn style_select_sql() -> &'static str {
    "SELECT id, novel_id, name, description, narrative_perspective, tone, pace, sentence_style, dialogue_ratio, description_ratio, psychological_ratio, battle_style, battle_intensity, emotion_tendency, chapter_ending, forbidden_styles, style_summary, is_active, raw_config_json, source_type, created_at, updated_at, source_asset_id, source_reference_work_id, source_reference_import_id, source_content_sha256, source_state, analysis_metadata_json FROM style_profiles"
}

#[tauri::command]
pub fn list_style_profiles(project_id: Option<String>) -> Result<Vec<StyleProfileDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let sql = match project_id.as_ref() {
        Some(_) => format!(
            "{} WHERE novel_id = ?1 ORDER BY is_active DESC, updated_at DESC",
            style_select_sql()
        ),
        None => format!(
            "{} ORDER BY is_active DESC, updated_at DESC",
            style_select_sql()
        ),
    };
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = if let Some(project_id) = project_id {
        stmt.query_map(params![project_id], map_style_profile_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    } else {
        stmt.query_map([], map_style_profile_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    Ok(items)
}

#[tauri::command]
pub fn get_active_style_profile(project_id: String) -> Result<Option<StyleProfileDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    // Prefer active, fallback to latest
    let sql = format!(
        "{} WHERE novel_id = ?1 ORDER BY is_active DESC, updated_at DESC LIMIT 1",
        style_select_sql()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    match stmt.query_row(params![&project_id], map_style_profile_row) {
        Ok(dto) => Ok(Some(dto)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn save_style_profile(
    id: Option<String>,
    input: SaveStyleProfileInput,
) -> Result<StyleProfileDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let forbidden_json = serde_json::to_string(&input.forbidden_styles.unwrap_or_default())
        .unwrap_or_else(|_| "[]".to_string());
    let source_type = input.source_type.unwrap_or_else(|| "manual".to_string());
    let source_state = input.source_state.clone().unwrap_or_else(|| {
        if input.source_reference_import_id.is_some() {
            "available".to_string()
        } else {
            "none".to_string()
        }
    });
    if !matches!(
        source_state.as_str(),
        "none" | "available" | "outdated" | "missing" | "legacy_unverified"
    ) {
        return Err("REFERENCE_INPUT_INVALID: invalid style source state".to_string());
    }
    if let Some(metadata) = input.analysis_metadata_json.as_deref() {
        let parsed = serde_json::from_str::<serde_json::Value>(metadata)
            .map_err(|_| "REFERENCE_INPUT_INVALID: invalid analysis metadata".to_string())?;
        if !parsed.is_object() || metadata.len() > 500_000 {
            return Err("REFERENCE_INPUT_INVALID: invalid analysis metadata".to_string());
        }
    }
    let reference_fields = [
        input.source_reference_work_id.as_deref(),
        input.source_reference_import_id.as_deref(),
        input.source_content_sha256.as_deref(),
    ];
    let populated_reference_fields = reference_fields
        .iter()
        .filter(|value| value.is_some())
        .count();
    if populated_reference_fields != 0 && populated_reference_fields != reference_fields.len() {
        return Err("REFERENCE_INPUT_INVALID: incomplete style reference identity".to_string());
    }
    if populated_reference_fields == reference_fields.len() {
        let source_hash = input.source_content_sha256.as_deref().unwrap_or_default();
        if source_hash.len() != 64
            || !source_hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err("REFERENCE_INPUT_INVALID: invalid style source hash".to_string());
        }
        let valid_scope: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM reference_imports i
                 INNER JOIN reference_works w
                   ON w.id = i.reference_work_id AND w.novel_id = i.novel_id
                 WHERE w.novel_id = ?1 AND w.id = ?2 AND i.id = ?3 AND i.source_sha256 = ?4
                   AND (?5 <> 'available' OR i.is_current = 1)",
                params![
                    input.project_id,
                    input.source_reference_work_id,
                    input.source_reference_import_id,
                    input.source_content_sha256,
                    source_state,
                ],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if valid_scope != 1 {
            return Err(
                "REFERENCE_SCOPE_MISMATCH: style reference does not belong to project".to_string(),
            );
        }
    }
    let source_state_update = if populated_reference_fields == reference_fields.len() {
        Some(source_state.clone())
    } else {
        input.source_state.clone()
    };

    if let Some(existing_id) = id {
        conn.execute(
            "UPDATE style_profiles SET name = ?1, description = ?2, narrative_perspective = ?3, tone = ?4, pace = ?5, sentence_style = ?6, dialogue_ratio = ?7, description_ratio = ?8, psychological_ratio = ?9, battle_style = ?10, battle_intensity = ?11, emotion_tendency = ?12, chapter_ending = ?13, forbidden_styles = ?14, style_summary = ?15, raw_config_json = ?16, source_type = ?17, updated_at = ?18, source_asset_id = COALESCE(?21, source_asset_id), source_reference_work_id = COALESCE(?22, source_reference_work_id), source_reference_import_id = COALESCE(?23, source_reference_import_id), source_content_sha256 = COALESCE(?24, source_content_sha256), source_state = COALESCE(?25, source_state), analysis_metadata_json = COALESCE(?26, analysis_metadata_json) WHERE id = ?19 AND novel_id = ?20",
            params![
                &input.name, &input.description,
                &input.narrative_perspective, &input.tone, &input.pace, &input.sentence_style,
                input.dialogue_ratio.unwrap_or(0.35), input.description_ratio.unwrap_or(0.4),
                input.psychological_ratio, &input.battle_style, &input.battle_intensity,
                &input.emotion_tendency, &input.chapter_ending,
                &forbidden_json, &input.style_summary, &input.raw_config_json,
                &source_type, &now, &existing_id, &input.project_id,
                &input.source_asset_id, &input.source_reference_work_id,
                &input.source_reference_import_id, &input.source_content_sha256,
                &source_state_update, &input.analysis_metadata_json,
            ],
        ).map_err(|e| e.to_string())?;
        get_style_profile_by_id_internal(&conn, &existing_id)
    } else {
        let new_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO style_profiles (id, novel_id, name, description, narrative_perspective, tone, pace, sentence_style, dialogue_ratio, description_ratio, psychological_ratio, battle_style, battle_intensity, emotion_tendency, chapter_ending, forbidden_styles, style_summary, is_active, raw_config_json, source_type, created_at, updated_at, source_asset_id, source_reference_work_id, source_reference_import_id, source_content_sha256, source_state, analysis_metadata_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,0,?18,?19,?20,?20,?21,?22,?23,?24,?25,?26)",
            params![
                &new_id, &input.project_id, &input.name, &input.description,
                &input.narrative_perspective, &input.tone, &input.pace, &input.sentence_style,
                input.dialogue_ratio.unwrap_or(0.35), input.description_ratio.unwrap_or(0.4),
                input.psychological_ratio, &input.battle_style, &input.battle_intensity,
                &input.emotion_tendency, &input.chapter_ending,
                &forbidden_json, &input.style_summary, &input.raw_config_json,
                &source_type, &now,
                &input.source_asset_id, &input.source_reference_work_id,
                &input.source_reference_import_id, &input.source_content_sha256,
                &source_state, &input.analysis_metadata_json,
            ],
        ).map_err(|e| e.to_string())?;
        get_style_profile_by_id_internal(&conn, &new_id)
    }
}

#[tauri::command]
pub fn set_active_style_profile(input: SetActiveStyleProfileInput) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE style_profiles SET is_active = 0 WHERE novel_id = ?1",
        params![&input.project_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE style_profiles SET is_active = 1, updated_at = ?1 WHERE id = ?2 AND novel_id = ?3",
        params![
            &chrono::Utc::now().to_rfc3339(),
            &input.style_profile_id,
            &input.project_id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_style_profile(project_id: String, style_profile_id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    // Check if active
    let is_active: i64 = conn
        .query_row(
            "SELECT is_active FROM style_profiles WHERE id = ?1 AND novel_id = ?2",
            params![&style_profile_id, &project_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM style_profiles WHERE id = ?1 AND novel_id = ?2",
        params![&style_profile_id, &project_id],
    )
    .map_err(|e| e.to_string())?;

    // If deleted was active, activate the latest remaining
    if is_active != 0 {
        let latest: Option<String> = conn
            .query_row(
                "SELECT id FROM style_profiles WHERE novel_id = ?1 ORDER BY updated_at DESC LIMIT 1",
                params![&project_id],
                |r| r.get(0),
            )
            .ok();
        if let Some(new_active_id) = latest {
            conn.execute(
                "UPDATE style_profiles SET is_active = 1 WHERE id = ?1",
                params![&new_active_id],
            )
            .ok();
        }
    }
    Ok(())
}

fn get_style_profile_by_id_internal(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<StyleProfileDto, String> {
    let sql = format!("{} WHERE id = ?1", style_select_sql());
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_style_profile_row)
        .map_err(|e| e.to_string())
}

// ==================== Character Library ====================

#[derive(Debug, Serialize, Deserialize)]
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

fn map_character_row(row: &rusqlite::Row) -> rusqlite::Result<CharacterDto> {
    Ok(CharacterDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        name: row.get(2)?,
        role_type: row.get(3)?,
        identity: row.get(4)?,
        faction: row.get(5)?,
        relation_to_protagonist: row.get(6)?,
        goal: row.get(7)?,
        personality: row.get(8)?,
        behavior_limits: row.get(9)?,
        forbidden_behaviors: row.get(10)?,
        first_appearance_chapter_id: row.get(11)?,
        current_state: row.get(12)?,
        source: row.get(13)?,
        is_protagonist: row.get::<_, i64>(14)? != 0,
        is_active: row.get::<_, i64>(15)? != 0,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
        protagonist_key: row.get(18)?,
        protagonist_label: row.get(19)?,
        protagonist_order: row.get::<_, i64>(20)?,
    })
}

fn character_select_sql() -> &'static str {
    "SELECT id, novel_id, name, role_type, identity, faction, relation_to_protagonist, goal, personality, behavior_limits, forbidden_behaviors, first_appearance_chapter_id, current_state, source, is_protagonist, is_active, created_at, updated_at, protagonist_key, protagonist_label, protagonist_order FROM characters"
}

#[derive(Debug, Deserialize)]
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

#[derive(Debug, Deserialize)]
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

/// 同步主角：从 protagonists 表 / novels 表读取主角信息，upsert 到 characters 表
/// 保留向后兼容：内部调用同步逻辑，返回第一个主角
#[tauri::command]
pub fn sync_protagonist_to_character_library(
    novel_id: String,
) -> Result<Option<CharacterDto>, String> {
    let all = sync_protagonists_to_character_library_inner(&novel_id)?;
    Ok(all.into_iter().next())
}

/// 同步所有主角到角色库（新接口，返回数组）
#[tauri::command]
pub fn sync_protagonists_to_character_library(
    novel_id: String,
) -> Result<Vec<CharacterDto>, String> {
    sync_protagonists_to_character_library_inner(&novel_id)
}

fn sync_protagonists_to_character_library_inner(
    novel_id: &str,
) -> Result<Vec<CharacterDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    // 收集所有需要同步的主角信息
    struct ProtagonistInfo {
        key: String,
        label: String,
        order: i64,
        name: String,
        identity: Option<String>,
        personality: Option<String>,
        goal: Option<String>,
        special_ability: Option<String>,
        ability_limits: Option<String>,
        forbidden_behaviors: Option<String>,
        current_state: Option<String>,
    }

    let mut protagonists: Vec<ProtagonistInfo> = Vec::new();

    // 1. 优先从 novels 表的 protagonists_json 读取（支持双主角/多主角）
    let novel_row: Option<(String, String, String)> = conn
        .query_row(
            "SELECT main_character, protagonist_ability, protagonists_json FROM novels WHERE id = ?1 AND deleted_at IS NULL",
            params![novel_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some((main_char, _ability_str, protagonists_json)) = novel_row {
        if !protagonists_json.is_empty() && protagonists_json != "[]" {
            if let Ok(profiles) =
                serde_json::from_str::<Vec<ProtagonistProfileDto>>(&protagonists_json)
            {
                for (i, profile) in profiles.iter().enumerate() {
                    if profile.name.trim().is_empty() {
                        continue;
                    }
                    protagonists.push(ProtagonistInfo {
                        key: profile.label.clone(),
                        label: match profile.label.as_str() {
                            "primary" => "主角A".to_string(),
                            "secondary" => "主角B".to_string(),
                            _ => format!("主角{}", i + 1),
                        },
                        order: i as i64,
                        name: profile.name.clone(),
                        identity: if profile.identity.is_empty() {
                            None
                        } else {
                            Some(profile.identity.clone())
                        },
                        personality: if profile.personality.is_empty() {
                            None
                        } else {
                            Some(profile.personality.clone())
                        },
                        goal: if profile.goal.is_empty() {
                            None
                        } else {
                            Some(profile.goal.clone())
                        },
                        special_ability: profile.special_ability.clone(),
                        ability_limits: profile.ability_limits.clone(),
                        forbidden_behaviors: profile.forbidden_behaviors.clone(),
                        current_state: None,
                    });
                }
            }
        }
        // 回退：如果 protagonists_json 为空，用 main_character
        if protagonists.is_empty() && !main_char.is_empty() {
            protagonists.push(ProtagonistInfo {
                key: "primary".to_string(),
                label: "主角".to_string(),
                order: 0,
                name: main_char,
                identity: None,
                personality: None,
                goal: None,
                special_ability: None,
                ability_limits: None,
                forbidden_behaviors: None,
                current_state: None,
            });
        }
    }

    // 2. 如果 novels 表也没有，尝试从 protagonists 表读取
    if protagonists.is_empty() {
        let mut stmt = conn
            .prepare(
                "SELECT name, identity, personality, goal, special_ability, ability_limits, forbidden_behaviors, current_state FROM protagonists WHERE novel_id = ?1 ORDER BY created_at ASC"
            )
            .map_err(|e| e.to_string())?;
        let protag_rows: Vec<(
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = stmt
            .query_map(params![novel_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        for (
            i,
            (
                name,
                identity,
                personality,
                goal,
                ability,
                ability_limits,
                forbidden_behaviors,
                current_state,
            ),
        ) in protag_rows.iter().enumerate()
        {
            if name.trim().is_empty() {
                continue;
            }
            protagonists.push(ProtagonistInfo {
                key: if i == 0 {
                    "primary".to_string()
                } else {
                    format!("lead_{}", i + 1)
                },
                label: if i == 0 {
                    "主角".to_string()
                } else {
                    format!("主角{}", i + 1)
                },
                order: i as i64,
                name: name.clone(),
                identity: identity.clone(),
                personality: personality.clone(),
                goal: goal.clone(),
                special_ability: ability.clone(),
                ability_limits: ability_limits.clone(),
                forbidden_behaviors: forbidden_behaviors.clone(),
                current_state: current_state.clone(),
            });
        }
    }

    // 3. 对每个主角执行 upsert（按 novel_id + protagonist_key 去重）
    let mut results: Vec<CharacterDto> = Vec::new();

    for info in &protagonists {
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM characters
                 WHERE novel_id = ?1 AND protagonist_key = ?2
                 LIMIT 1",
                params![novel_id, &info.key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some(existing_id) = existing {
            conn.execute(
                "UPDATE characters SET name = ?1, role_type = 'protagonist', identity = ?2, personality = ?3, goal = ?4, behavior_limits = ?5, forbidden_behaviors = ?6, current_state = ?7, source = 'protagonist_profile', source_type = 'protagonist_profile', is_protagonist = 1, is_active = 1, protagonist_label = ?8, protagonist_order = ?9, updated_at = ?10 WHERE id = ?11",
                params![
                    &info.name,
                    &info.identity,
                    &info.personality,
                    &info.goal,
                    &info.ability_limits,
                    &info.forbidden_behaviors,
                    &info.current_state,
                    &info.label,
                    &info.order,
                    now,
                    &existing_id,
                ],
            )
            .map_err(|e| e.to_string())?;

            let sql = format!("{} WHERE id = ?1", character_select_sql());
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            if let Some(ch) = stmt
                .query_row(params![&existing_id], map_character_row)
                .optional()
                .map_err(|e| e.to_string())?
            {
                results.push(ch);
            }
        } else {
            let new_id = uuid::Uuid::new_v4().to_string();
            let special_ability_text = info.special_ability.clone().unwrap_or_default();
            let ability_limits_text = info.ability_limits.clone().unwrap_or_default();
            let personality_notes = info.personality.clone().unwrap_or_default();
            let goal_text = info.goal.clone().unwrap_or_default();
            let current_state_text = info.current_state.clone().unwrap_or_default();

            conn.execute(
                "INSERT INTO characters (id, novel_id, name, role_type, identity, faction, relation_to_protagonist, goal, personality, behavior_limits, forbidden_behaviors, first_appearance_chapter_id, current_state, source, source_type, is_protagonist, protagonist_key, protagonist_label, protagonist_order, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, 'protagonist', ?4, NULL, NULL, ?5, ?6, ?7, ?8, NULL, ?9, 'protagonist_profile', 'protagonist_profile', 1, ?10, ?11, ?12, 1, ?13, ?13)",
                params![
                    &new_id,
                    novel_id,
                    &info.name,
                    &info.identity,
                    &goal_text,
                    &personality_notes,
                    &ability_limits_text,
                    &info.forbidden_behaviors,
                    &current_state_text,
                    &info.key,
                    &info.label,
                    &info.order,
                    now,
                ],
            )
            .map_err(|e| e.to_string())?;

            if !special_ability_text.is_empty() {
                let _ = conn.execute(
                    "UPDATE characters SET goal = goal || ?1 WHERE id = ?2",
                    params![format!("\n特殊能力：{}", special_ability_text), &new_id],
                );
            }

            let sql = format!("{} WHERE id = ?1", character_select_sql());
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            if let Some(ch) = stmt
                .query_row(params![&new_id], map_character_row)
                .optional()
                .map_err(|e| e.to_string())?
            {
                results.push(ch);
            }
        }
    }

    Ok(results)
}

/// 获取主角角色（从 characters 表，单主角-保留向后兼容）
#[tauri::command]
pub fn get_protagonist_character(novel_id: String) -> Result<Option<CharacterDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "{} WHERE novel_id = ?1 AND is_protagonist = 1 ORDER BY protagonist_order ASC LIMIT 1",
        character_select_sql()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![&novel_id], map_character_row)
        .optional()
        .map_err(|e| e.to_string())
}

/// 获取所有主角角色（新接口，返回数组）
#[tauri::command]
pub fn get_protagonist_characters(novel_id: String) -> Result<Vec<CharacterDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "{} WHERE novel_id = ?1 AND is_protagonist = 1 AND is_active = 1 ORDER BY protagonist_order ASC, updated_at DESC",
        character_select_sql()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![&novel_id], map_character_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

/// 列出作品的所有角色
#[tauri::command]
pub fn list_characters(novel_id: String) -> Result<Vec<CharacterDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "{} WHERE novel_id = ?1 AND is_active = 1 ORDER BY is_protagonist DESC, updated_at DESC",
        character_select_sql()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![&novel_id], map_character_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

/// 创建角色
#[tauri::command]
pub fn create_character(input: CreateCharacterInput) -> Result<CharacterDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let is_protagonist = if input.is_protagonist { 1 } else { 0 };

    conn.execute(
        "INSERT INTO characters (id, novel_id, name, role_type, identity, faction, relation_to_protagonist, goal, personality, behavior_limits, forbidden_behaviors, current_state, source, is_protagonist, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'manual', ?13, 1, ?14, ?14)",
        params![
            &id,
            &input.novel_id,
            &input.name,
            input.role_type.unwrap_or_else(|| "supporting".to_string()),
            input.identity,
            input.faction,
            input.relation_to_protagonist,
            input.goal,
            input.personality,
            input.behavior_limits,
            input.forbidden_behaviors,
            input.current_state,
            is_protagonist,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!("{} WHERE id = ?1", character_select_sql());
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![&id], map_character_row)
        .map_err(|e| e.to_string())
}

/// 更新角色
#[tauri::command]
pub fn update_character(id: String, input: UpdateCharacterInput) -> Result<CharacterDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE characters SET
            name = COALESCE(?1, name),
            role_type = COALESCE(?2, role_type),
            identity = COALESCE(?3, identity),
            faction = COALESCE(?4, faction),
            relation_to_protagonist = COALESCE(?5, relation_to_protagonist),
            goal = COALESCE(?6, goal),
            personality = COALESCE(?7, personality),
            behavior_limits = COALESCE(?8, behavior_limits),
            forbidden_behaviors = COALESCE(?9, forbidden_behaviors),
            current_state = COALESCE(?10, current_state),
            is_protagonist = COALESCE(?11, is_protagonist),
            is_active = COALESCE(?12, is_active),
            updated_at = ?13
         WHERE id = ?14",
        params![
            input.name,
            input.role_type,
            input.identity,
            input.faction,
            input.relation_to_protagonist,
            input.goal,
            input.personality,
            input.behavior_limits,
            input.forbidden_behaviors,
            input.current_state,
            input.is_protagonist.map(|b| b as i64),
            input.is_active.map(|b| b as i64),
            now,
            &id,
        ],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!("{} WHERE id = ?1", character_select_sql());
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![&id], map_character_row)
        .map_err(|e| e.to_string())
}

/// 删除角色（软删除）
#[tauri::command]
pub fn delete_character(id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE characters SET is_active = 0, updated_at = ?1 WHERE id = ?2",
        params![now, &id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ==================== Chapter Character ====================

#[derive(Debug, Serialize, Deserialize)]
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

fn map_chapter_character_row(row: &rusqlite::Row) -> rusqlite::Result<ChapterCharacterDto> {
    Ok(ChapterCharacterDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        chapter_id: row.get(2)?,
        character_id: row.get(3)?,
        character_name: row.get(4)?,
        role_in_chapter: row.get(5)?,
        must_appear: row.get::<_, i64>(6)? != 0,
        note: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

#[derive(Debug, Deserialize)]
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

fn default_role_in_chapter() -> String {
    "supporting".to_string()
}

/// 添加章节出场角色
#[tauri::command]
pub fn add_chapter_character(
    input: AddChapterCharacterInput,
) -> Result<ChapterCharacterDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;

    // 检查是否已存在
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM chapter_characters WHERE chapter_id = ?1 AND character_id = ?2 LIMIT 1",
            params![&input.chapter_id, &input.character_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(existing_id) = existing {
        // 已存在，更新角色
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE chapter_characters SET role_in_chapter = ?1, must_appear = ?2, note = ?3, character_name = ?4, updated_at = ?5 WHERE id = ?6",
            params![
                input.role_in_chapter,
                input.must_appear as i64,
                input.note,
                input.character_name,
                now,
                &existing_id,
            ],
        )
        .map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare("SELECT id, novel_id, chapter_id, character_id, character_name, role_in_chapter, must_appear, note, created_at, updated_at FROM chapter_characters WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![&existing_id], map_chapter_character_row)
            .map_err(|e| e.to_string())
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO chapter_characters (id, novel_id, chapter_id, character_id, character_name, role_in_chapter, must_appear, note, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![
                &id,
                &input.novel_id,
                &input.chapter_id,
                &input.character_id,
                input.character_name,
                input.role_in_chapter,
                input.must_appear as i64,
                input.note,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare("SELECT id, novel_id, chapter_id, character_id, character_name, role_in_chapter, must_appear, note, created_at, updated_at FROM chapter_characters WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![&id], map_chapter_character_row)
            .map_err(|e| e.to_string())
    }
}

/// 列出章节出场角色
#[tauri::command]
pub fn list_chapter_characters(chapter_id: String) -> Result<Vec<ChapterCharacterDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, novel_id, chapter_id, character_id, character_name, role_in_chapter, must_appear, note, created_at, updated_at FROM chapter_characters WHERE chapter_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![&chapter_id], map_chapter_character_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

/// 移除章节出场角色
#[tauri::command]
pub fn remove_chapter_character(chapter_id: String, character_id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM chapter_characters WHERE chapter_id = ?1 AND character_id = ?2",
        params![&chapter_id, &character_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

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

#[derive(Debug, Deserialize)]
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateChapterEventInput {
    pub title: Option<String>,
    pub description: Option<String>,
    pub involved_character_ids: Option<Vec<String>>,
    pub impact: Option<String>,
    pub risk: Option<String>,
    pub status: Option<String>,
}

fn chapter_event_status(value: Option<&str>, fallback: &str) -> Result<String, String> {
    let status = value.unwrap_or(fallback).trim();
    match status {
        "candidate" | "selected" | "required" | "forbidden" | "adopted" | "discarded" => {
            Ok(status.to_string())
        }
        _ => Err("章节事件状态无效".to_string()),
    }
}

fn encode_character_ids(ids: Option<&[String]>) -> Option<String> {
    ids.filter(|values| !values.is_empty())
        .and_then(|values| serde_json::to_string(values).ok())
}

fn map_chapter_event_row(row: &rusqlite::Row) -> rusqlite::Result<ChapterEventDto> {
    Ok(ChapterEventDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        chapter_id: row.get(2)?,
        title: row.get(3)?,
        description: row.get(4)?,
        involved_character_ids: row.get(5)?,
        impact: row.get(6)?,
        risk: row.get(7)?,
        status: row.get(8)?,
        source: row.get(9)?,
        ai_task_id: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

const CHAPTER_EVENT_SELECT: &str = "SELECT id, novel_id, chapter_id, title, description, involved_character_ids, impact, risk, status, source, ai_task_id, created_at, updated_at FROM chapter_events";

#[tauri::command]
pub fn list_chapter_events(chapter_id: String) -> Result<Vec<ChapterEventDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!(
            "{CHAPTER_EVENT_SELECT} WHERE chapter_id = ?1 ORDER BY created_at ASC"
        ))
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![&chapter_id], map_chapter_event_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn create_chapter_event(input: CreateChapterEventInput) -> Result<ChapterEventDto, String> {
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > 240 {
        return Err("事件标题无效".to_string());
    }
    let status = chapter_event_status(input.status.as_deref(), "candidate")?;
    let source = match input.source.as_deref().unwrap_or("manual") {
        "manual" | "ai_suggested" => input.source.unwrap_or_else(|| "manual".to_string()),
        _ => return Err("事件来源无效".to_string()),
    };
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let involved = encode_character_ids(input.involved_character_ids.as_deref());
    conn.execute(
        "INSERT INTO chapter_events (id, novel_id, chapter_id, title, description, involved_character_ids, impact, risk, status, source, ai_task_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
        params![
            &id,
            &input.novel_id,
            &input.chapter_id,
            title,
            input.description,
            involved,
            input.impact,
            input.risk,
            status,
            source,
            input.ai_task_id,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!("{CHAPTER_EVENT_SELECT} WHERE id = ?1"))
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![&id], map_chapter_event_row)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_chapter_event(
    id: String,
    input: UpdateChapterEventInput,
) -> Result<ChapterEventDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let status = match &input.status {
        Some(value) => Some(chapter_event_status(Some(value), "candidate")?),
        None => None,
    };
    let involved = encode_character_ids(input.involved_character_ids.as_deref());
    conn.execute(
        "UPDATE chapter_events SET
            title = COALESCE(?1, title),
            description = COALESCE(?2, description),
            involved_character_ids = COALESCE(?3, involved_character_ids),
            impact = COALESCE(?4, impact),
            risk = COALESCE(?5, risk),
            status = COALESCE(?6, status),
            updated_at = ?7
         WHERE id = ?8",
        params![
            input.title,
            input.description,
            involved,
            input.impact,
            input.risk,
            status,
            now,
            &id,
        ],
    )
    .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!("{CHAPTER_EVENT_SELECT} WHERE id = ?1"))
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![&id], map_chapter_event_row)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_chapter_event_status(id: String, status: String) -> Result<(), String> {
    let status = chapter_event_status(Some(&status), "candidate")?;
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE chapter_events SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![status, now, &id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_chapter_event(id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM chapter_events WHERE id = ?1", params![&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Optional helper for QueryRow
trait OptionalExt<T> {
    fn optional(self) -> Result<Option<T>, rusqlite::Error>;
}

impl<T> OptionalExt<T> for Result<T, rusqlite::Error> {
    fn optional(self) -> Result<Option<T>, rusqlite::Error> {
        match self {
            Ok(val) => Ok(Some(val)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }
}

// ==================== Quality Check ====================

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Serialize, Deserialize)]
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

fn map_quality_report_row(row: &rusqlite::Row) -> rusqlite::Result<QualityCheckReportDto> {
    Ok(QualityCheckReportDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        chapter_id: row.get(2)?,
        draft_id: row.get(3)?,
        scope: row.get(4)?,
        status: row.get(5)?,
        overall_score: row.get(6)?,
        summary: row.get(7)?,
        ai_task_id: row.get(8)?,
        draft_version: row.get(9)?,
        model: row.get(10)?,
        content_hash: row.get(11)?,
        content_length: row.get(12)?,
        checked_at: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

fn map_quality_item_row(row: &rusqlite::Row) -> rusqlite::Result<QualityCheckItemDto> {
    Ok(QualityCheckItemDto {
        id: row.get(0)?,
        report_id: row.get(1)?,
        novel_id: row.get(2)?,
        chapter_id: row.get(3)?,
        draft_id: row.get(4)?,
        issue_type: row.get(5)?,
        severity: row.get(6)?,
        title: row.get(7)?,
        description: row.get(8)?,
        category: row.get(9)?,
        evidence: row.get(10)?,
        suggestion: row.get(11)?,
        quote: row.get(12)?,
        start_offset: row.get(13)?,
        end_offset: row.get(14)?,
        paragraph_index: row.get(15)?,
        issue_key: row.get(16)?,
        status: row.get(17)?,
        resolution_note: row.get(18)?,
        resolved_at: row.get(19)?,
        created_at: row.get(20)?,
        updated_at: row.get(21)?,
        sort_order: row.get(22)?,
    })
}

fn quality_item_select_sql() -> &'static str {
    "SELECT id, report_id, novel_id, chapter_id, draft_id, issue_type, severity, title, description, category, evidence, suggestion, quote, start_offset, end_offset, paragraph_index, issue_key, status, resolution_note, resolved_at, created_at, updated_at, sort_order FROM quality_check_items"
}

fn quality_workflow_item_select_sql() -> &'static str {
    "SELECT item.id, item.report_id, item.novel_id, item.chapter_id, item.draft_id, item.issue_type, item.severity, item.title, item.description, item.category, item.evidence, item.suggestion, item.quote, item.start_offset, item.end_offset, item.paragraph_index, item.issue_key, COALESCE(state.status, item.status), CASE WHEN state.id IS NOT NULL THEN state.resolution_note ELSE item.resolution_note END, CASE WHEN state.id IS NOT NULL THEN state.resolved_at ELSE item.resolved_at END, item.created_at, COALESCE(state.updated_at, item.updated_at), item.sort_order FROM quality_check_items AS item LEFT JOIN quality_issue_states AS state ON state.chapter_id = item.chapter_id AND state.issue_key = item.issue_key"
}

fn quality_report_select_sql() -> &'static str {
    "SELECT id, novel_id, chapter_id, draft_id, scope, status, overall_score, summary, ai_task_id, draft_version, model, content_hash, content_length, checked_at, created_at, updated_at FROM quality_check_reports"
}

/// 创建质量检查报告占位记录
#[tauri::command]
pub fn create_quality_check_report(
    input: CreateQualityReportInput,
) -> Result<QualityCheckReportDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let scope = input.scope.unwrap_or_else(|| "current_draft".to_string());
    if !matches!(scope.as_str(), "current_draft" | "adopted_draft") {
        return Err("quality_check_scope_invalid".to_string());
    }
    let draft_target = conn
        .query_row(
            "SELECT novel_id, chapter_id FROM chapter_drafts WHERE id = ?1",
            params![&input.draft_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| format!("quality_check_draft_read_failed: {error}"))?
        .ok_or_else(|| "quality_check_draft_missing".to_string())?;
    if draft_target.0 != input.novel_id || draft_target.1 != input.chapter_id {
        return Err("quality_check_draft_ownership_mismatch".to_string());
    }
    conn.execute(
        "INSERT INTO quality_check_reports (id, novel_id, chapter_id, draft_id, scope, status, content_hash, content_length, checked_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8, ?9, ?9)",
        params![
            &id,
            &input.novel_id,
            &input.chapter_id,
            &input.draft_id,
            &scope,
            &input.content_hash,
            &input.content_length,
            &input.checked_at,
            &now,
        ],
    )
    .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!("{} WHERE id = ?1", quality_report_select_sql()))
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![&id], map_quality_report_row)
        .map_err(|e| e.to_string())
}

/// 获取章节的质量检查结果（最新报告 + 问题列表 + 统计）
#[tauri::command]
pub fn get_quality_check_issues(chapter_id: String) -> Result<GetQualityCheckIssuesResult, String> {
    let conn = get_connection().lock().map_err(|error| error.to_string())?;
    get_quality_check_issues_internal(&conn, &chapter_id)
}

fn load_quality_report(
    conn: &Connection,
    report_id: &str,
) -> Result<Option<QualityCheckReportDto>, String> {
    conn.query_row(
        &format!("{} WHERE id = ?1", quality_report_select_sql()),
        params![report_id],
        map_quality_report_row,
    )
    .optional()
    .map_err(|error| format!("quality_report_read_failed: {error}"))
}

fn load_quality_items(
    conn: &Connection,
    report_id: &str,
    overlay_workflow_state: bool,
) -> Result<Vec<QualityCheckItemDto>, String> {
    let (select, qualifier, item_id) = if overlay_workflow_state {
        (
            quality_workflow_item_select_sql(),
            "item.report_id",
            "item.id",
        )
    } else {
        (quality_item_select_sql(), "report_id", "id")
    };
    let sql = format!("{select} WHERE {qualifier} = ?1 ORDER BY sort_order ASC, {item_id} ASC");
    let mut statement = conn
        .prepare(&sql)
        .map_err(|error| format!("quality_items_prepare_failed: {error}"))?;
    let result = statement
        .query_map(params![report_id], map_quality_item_row)
        .map_err(|error| format!("quality_items_read_failed: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("quality_items_decode_failed: {error}"));
    result
}

fn get_quality_check_issues_internal(
    conn: &Connection,
    chapter_id: &str,
) -> Result<GetQualityCheckIssuesResult, String> {
    let report = conn
        .query_row(
            &format!(
                "{} WHERE chapter_id = ?1 AND status = 'completed' ORDER BY created_at DESC, id DESC LIMIT 1",
                quality_report_select_sql()
            ),
            params![chapter_id],
            map_quality_report_row,
        )
        .optional()
        .map_err(|error| format!("quality_latest_report_read_failed: {error}"))?;
    let items = match report.as_ref() {
        Some(report) => load_quality_items(conn, &report.id, true)?,
        None => Vec::new(),
    };
    let statistics = compute_statistics(&items);
    Ok(GetQualityCheckIssuesResult {
        report,
        items,
        statistics,
    })
}

fn list_quality_check_reports_internal(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<QualityCheckReportDto>, String> {
    let sql = format!(
        "{} WHERE chapter_id = ?1 AND status = 'completed' ORDER BY created_at DESC, id DESC",
        quality_report_select_sql()
    );
    let mut statement = conn
        .prepare(&sql)
        .map_err(|error| format!("quality_report_history_prepare_failed: {error}"))?;
    let result = statement
        .query_map(params![chapter_id], map_quality_report_row)
        .map_err(|error| format!("quality_report_history_read_failed: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("quality_report_history_decode_failed: {error}"));
    result
}

#[tauri::command]
pub fn list_quality_check_reports(
    chapter_id: String,
) -> Result<Vec<QualityCheckReportDto>, String> {
    let conn = get_connection().lock().map_err(|error| error.to_string())?;
    list_quality_check_reports_internal(&conn, &chapter_id)
}

fn get_quality_check_report_snapshot_internal(
    conn: &Connection,
    report_id: &str,
) -> Result<GetQualityCheckIssuesResult, String> {
    let report = load_quality_report(conn, report_id)?
        .ok_or_else(|| "quality_check_report_missing".to_string())?;
    if report.status != "completed" {
        return Err("quality_check_report_not_completed".to_string());
    }
    let items = load_quality_items(conn, report_id, false)?;
    let statistics = compute_statistics(&items);
    Ok(GetQualityCheckIssuesResult {
        report: Some(report),
        items,
        statistics,
    })
}

#[tauri::command]
pub fn get_quality_check_report_snapshot(
    report_id: String,
) -> Result<GetQualityCheckIssuesResult, String> {
    let conn = get_connection().lock().map_err(|error| error.to_string())?;
    get_quality_check_report_snapshot_internal(&conn, &report_id)
}

fn compute_statistics(items: &[QualityCheckItemDto]) -> QualityCheckStatisticsDto {
    let total = items.len() as i64;
    let pending = items.iter().filter(|i| i.status == "pending").count() as i64;
    let resolved = items.iter().filter(|i| i.status == "resolved").count() as i64;
    let ignored = items.iter().filter(|i| i.status == "ignored").count() as i64;
    let critical = items.iter().filter(|i| i.severity == "critical").count() as i64;
    let high = items.iter().filter(|i| i.severity == "high").count() as i64;
    let medium = items.iter().filter(|i| i.severity == "medium").count() as i64;
    let low = items.iter().filter(|i| i.severity == "low").count() as i64;

    QualityCheckStatisticsDto {
        total,
        pending,
        resolved,
        ignored,
        critical,
        high,
        medium,
        low,
    }
}

/// 更新单条问题状态
fn validate_quality_issue_status(status: &str) -> Result<(), String> {
    if matches!(status, "pending" | "resolved" | "ignored") {
        Ok(())
    } else {
        Err("quality_issue_status_invalid".to_string())
    }
}

fn upsert_quality_issue_state(
    conn: &Connection,
    chapter_id: &str,
    issue_key: &str,
    status: &str,
    resolution_note: Option<&str>,
    resolved_at: Option<&str>,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO quality_issue_states
            (id, chapter_id, issue_key, status, resolution_note, resolved_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(chapter_id, issue_key) DO UPDATE SET
            status = excluded.status,
            resolution_note = excluded.resolution_note,
            resolved_at = excluded.resolved_at,
            updated_at = excluded.updated_at",
        params![
            uuid::Uuid::new_v4().to_string(),
            chapter_id,
            issue_key,
            status,
            resolution_note,
            resolved_at,
            now,
        ],
    )
    .map_err(|error| format!("quality_issue_state_write_failed: {error}"))?;
    Ok(())
}

fn get_mutable_quality_issue_identity(
    conn: &Connection,
    issue_id: &str,
) -> Result<(String, String), String> {
    let identity = conn
        .query_row(
            "SELECT item.report_id, item.chapter_id, item.issue_key,
                    (SELECT report.id
                     FROM quality_check_reports AS report
                     WHERE report.chapter_id = item.chapter_id AND report.status = 'completed'
                     ORDER BY report.created_at DESC, report.id DESC
                     LIMIT 1)
             FROM quality_check_items AS item
             WHERE item.id = ?1",
            params![issue_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("quality_issue_identity_read_failed: {error}"))?
        .ok_or_else(|| "quality_issue_not_found".to_string())?;
    if identity.3.as_deref() != Some(identity.0.as_str()) {
        return Err("quality_issue_history_read_only".to_string());
    }
    Ok((identity.1, identity.2))
}

fn update_quality_issue_status_internal(
    conn: &mut Connection,
    issue_id: &str,
    status: &str,
    resolution_note: Option<&str>,
) -> Result<QualityCheckItemDto, String> {
    validate_quality_issue_status(status)?;
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("quality_issue_transaction_failed: {error}"))?;
    let identity = get_mutable_quality_issue_identity(&transaction, issue_id)?;
    let resolved_at = (status == "resolved").then_some(now.as_str());
    upsert_quality_issue_state(
        &transaction,
        &identity.0,
        &identity.1,
        status,
        resolution_note,
        resolved_at,
        &now,
    )?;
    let item = transaction
        .query_row(
            &format!("{} WHERE item.id = ?1", quality_workflow_item_select_sql()),
            params![issue_id],
            map_quality_item_row,
        )
        .map_err(|error| format!("quality_issue_read_after_update_failed: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("quality_issue_commit_failed: {error}"))?;
    Ok(item)
}

#[tauri::command]
pub fn update_quality_issue_status(
    issue_id: String,
    status: String,
    resolution_note: Option<String>,
) -> Result<QualityCheckItemDto, String> {
    let mut conn = get_connection().lock().map_err(|error| error.to_string())?;
    update_quality_issue_status_internal(&mut conn, &issue_id, &status, resolution_note.as_deref())
}

/// 批量更新问题状态
fn batch_update_quality_issue_status_internal(
    conn: &mut Connection,
    issue_ids: &[String],
    status: &str,
) -> Result<Vec<QualityCheckItemDto>, String> {
    validate_quality_issue_status(status)?;
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("quality_issue_batch_transaction_failed: {error}"))?;
    let resolved_at = (status == "resolved").then_some(now.as_str());

    for issue_id in issue_ids {
        let identity = get_mutable_quality_issue_identity(&transaction, issue_id)?;
        upsert_quality_issue_state(
            &transaction,
            &identity.0,
            &identity.1,
            status,
            None,
            resolved_at,
            &now,
        )?;
    }

    let mut items = Vec::with_capacity(issue_ids.len());
    for issue_id in issue_ids {
        let item = transaction
            .query_row(
                &format!("{} WHERE item.id = ?1", quality_workflow_item_select_sql()),
                params![issue_id],
                map_quality_item_row,
            )
            .map_err(|error| format!("quality_issue_batch_read_failed: {error}"))?;
        items.push(item);
    }
    transaction
        .commit()
        .map_err(|error| format!("quality_issue_batch_commit_failed: {error}"))?;
    Ok(items)
}

#[tauri::command]
pub fn batch_update_quality_issue_status(
    issue_ids: Vec<String>,
    status: String,
) -> Result<Vec<QualityCheckItemDto>, String> {
    let mut conn = get_connection().lock().map_err(|error| error.to_string())?;
    batch_update_quality_issue_status_internal(&mut conn, &issue_ids, &status)
}

fn has_newer_completed_quality_report(
    conn: &Connection,
    chapter_id: &str,
    created_at: &str,
    report_id: &str,
) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM quality_check_reports
            WHERE chapter_id = ?1 AND status = 'completed'
              AND (created_at > ?2 OR (created_at = ?2 AND id > ?3))
         )",
        params![chapter_id, created_at, report_id],
        |row| row.get(0),
    )
    .map_err(|error| format!("quality_latest_report_identity_read_failed: {error}"))
}

/// 保存质量检查结果（创建 run + 合并 issues）
fn save_quality_check_result_internal(
    conn: &mut Connection,
    input: &SaveQualityCheckResultInput,
) -> Result<GetQualityCheckIssuesResult, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("quality_result_transaction_failed: {error}"))?;
    let ownership = transaction
        .query_row(
            "SELECT novel_id, chapter_id, draft_id, status, ai_task_id, created_at FROM quality_check_reports WHERE id = ?1",
            params![&input.report_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("quality_report_ownership_read_failed: {error}"))?
        .ok_or_else(|| "quality_check_report_missing".to_string())?;

    if ownership.0 != input.novel_id
        || ownership.1 != input.chapter_id
        || ownership.2 != input.draft_id
    {
        return Err("quality_check_report_ownership_mismatch".to_string());
    }
    let ai_task_id = input.ai_task_id.trim();
    if ai_task_id.is_empty() {
        return Err("quality_check_ai_task_required".to_string());
    }
    let task = transaction
        .query_row(
            "SELECT novel_id, chapter_id, task_type, status FROM ai_task_records WHERE id = ?1",
            params![ai_task_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("quality_check_ai_task_read_failed: {error}"))?
        .ok_or_else(|| "quality_check_ai_task_missing".to_string())?;
    if task.0.as_deref() != Some(input.novel_id.as_str())
        || task.1.as_deref() != Some(input.chapter_id.as_str())
        || task.2 != "quality_check"
        || task.3 != "succeeded"
    {
        return Err("quality_check_ai_task_mismatch".to_string());
    }
    let has_newer_completed_report = has_newer_completed_quality_report(
        &transaction,
        &input.chapter_id,
        &ownership.5,
        &input.report_id,
    )?;
    if ownership.3 == "completed" {
        if ownership.4.as_deref() != Some(ai_task_id) {
            return Err("quality_check_report_ai_task_mismatch".to_string());
        }
        let report = load_quality_report(&transaction, &input.report_id)?;
        let items =
            load_quality_items(&transaction, &input.report_id, !has_newer_completed_report)?;
        let statistics = compute_statistics(&items);
        transaction
            .commit()
            .map_err(|error| format!("quality_result_idempotent_commit_failed: {error}"))?;
        return Ok(GetQualityCheckIssuesResult {
            report,
            items,
            statistics,
        });
    }
    if ownership.3 != "pending" {
        return Err("quality_check_report_not_pending".to_string());
    }

    let updates_workflow_state = !has_newer_completed_report;

    let mut seen_issue_keys = HashSet::new();
    let mut prepared_items = Vec::with_capacity(input.result.items.len());
    for (sort_order, new_item) in input.result.items.iter().enumerate() {
        let issue_key = new_item
            .issue_key
            .as_deref()
            .filter(|key| !key.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        if !seen_issue_keys.insert(issue_key.clone()) {
            return Err("quality_check_duplicate_issue_key".to_string());
        }
        prepared_items.push((sort_order, new_item, issue_key));
    }

    for (sort_order, new_item, issue_key) in prepared_items {
        let item_id = uuid::Uuid::new_v4().to_string();
        transaction
            .execute(
                "INSERT INTO quality_check_items
                    (id, report_id, novel_id, chapter_id, draft_id, issue_type, severity, title, description, category, evidence, suggestion, quote, start_offset, end_offset, paragraph_index, issue_key, status, resolution_note, resolved_at, sort_order, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 'pending', NULL, NULL, ?18, ?19, ?19)",
                params![
                    &item_id,
                    &input.report_id,
                    &input.novel_id,
                    &input.chapter_id,
                    &input.draft_id,
                    new_item.issue_type.as_deref().unwrap_or("other"),
                    new_item.severity.as_deref().unwrap_or("medium"),
                    new_item.title.as_deref().unwrap_or_default(),
                    new_item.description.as_deref().unwrap_or_default(),
                    &new_item.category,
                    &new_item.evidence,
                    &new_item.suggestion,
                    &new_item.quote,
                    &new_item.start_offset,
                    &new_item.end_offset,
                    &new_item.paragraph_index,
                    &issue_key,
                    sort_order as i64,
                    &now,
                ],
            )
            .map_err(|error| format!("quality_snapshot_item_insert_failed: {error}"))?;

        if updates_workflow_state {
            transaction
                .execute(
                "INSERT INTO quality_issue_states
                    (id, chapter_id, issue_key, status, resolution_note, resolved_at, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 'pending', NULL, NULL, ?4, ?4)
                 ON CONFLICT(chapter_id, issue_key) DO UPDATE SET
                    status = CASE WHEN quality_issue_states.status = 'ignored' THEN 'ignored' ELSE 'pending' END,
                    resolution_note = CASE WHEN quality_issue_states.status = 'ignored' THEN quality_issue_states.resolution_note ELSE NULL END,
                    resolved_at = CASE WHEN quality_issue_states.status = 'ignored' THEN quality_issue_states.resolved_at ELSE NULL END,
                    updated_at = excluded.updated_at",
                    params![
                        uuid::Uuid::new_v4().to_string(),
                        &input.chapter_id,
                        &issue_key,
                        &now,
                    ],
                )
                .map_err(|error| format!("quality_snapshot_state_write_failed: {error}"))?;
        }
    }

    let affected = transaction
        .execute(
            "UPDATE quality_check_reports
             SET status = 'completed', overall_score = ?1, summary = ?2, draft_version = ?3,
                 model = ?4, ai_task_id = ?5,
                 content_hash = COALESCE(?6, content_hash),
                 content_length = COALESCE(?7, content_length),
                 checked_at = COALESCE(?8, checked_at), updated_at = ?9
             WHERE id = ?10 AND novel_id = ?11 AND chapter_id = ?12 AND draft_id = ?13 AND status = 'pending'",
            params![
                &input.result.overall_score,
                &input.result.summary,
                &input.draft_version,
                &input.model,
                ai_task_id,
                &input.content_hash,
                &input.content_length,
                &input.checked_at,
                &now,
                &input.report_id,
                &input.novel_id,
                &input.chapter_id,
                &input.draft_id,
            ],
        )
        .map_err(|error| format!("quality_report_complete_failed: {error}"))?;
    if affected != 1 {
        return Err("quality_check_report_completion_conflict".to_string());
    }

    let report = load_quality_report(&transaction, &input.report_id)?;
    let items = load_quality_items(&transaction, &input.report_id, updates_workflow_state)?;
    let statistics = compute_statistics(&items);
    transaction
        .commit()
        .map_err(|error| format!("quality_result_commit_failed: {error}"))?;
    Ok(GetQualityCheckIssuesResult {
        report,
        items,
        statistics,
    })
}

#[tauri::command]
pub fn save_quality_check_result(
    input: SaveQualityCheckResultInput,
) -> Result<GetQualityCheckIssuesResult, String> {
    let mut conn = get_connection().lock().map_err(|error| error.to_string())?;
    save_quality_check_result_internal(&mut conn, &input)
}

// ==================== Chapter Summary ====================

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
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

fn map_chapter_summary_row(row: &rusqlite::Row) -> rusqlite::Result<ChapterSummaryDto> {
    Ok(ChapterSummaryDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        chapter_id: row.get(2)?,
        volume_id: row.get(3)?,
        adopted_draft_id: row.get(4)?,
        summary: row.get(5)?,
        key_events: row.get(6)?,
        character_changes: row.get(7)?,
        relationship_changes: row.get(8)?,
        new_foreshadows: row.get(9)?,
        resolved_foreshadows: row.get(10)?,
        next_chapter_hints: row.get(11)?,
        core_events: row.get(12)?,
        protagonist_state_change: row.get(13)?,
        important_character_changes: row.get(14)?,
        setting_changes: row.get(15)?,
        new_locations: row.get(16)?,
        new_items_or_abilities: row.get(17)?,
        foreshadowing: row.get(18)?,
        unresolved_questions: row.get(19)?,
        facts_must_remember: row.get(20)?,
        next_chapter_hook: row.get(21)?,
        validation_status: row.get(22)?,
        validation_result: row.get(23)?,
        enabled: row.get::<_, i64>(24)? != 0,
        content_hash: row.get(25)?,
        draft_version: row.get(26)?,
        is_expired: row.get::<_, i64>(27)? != 0,
        ai_task_id: row.get(28)?,
        created_at: row.get(29)?,
        updated_at: row.get(30)?,
    })
}

fn chapter_summary_select_sql() -> &'static str {
    "SELECT id, novel_id, chapter_id, volume_id, adopted_draft_id, summary, key_events, character_changes, relationship_changes, new_foreshadows, resolved_foreshadows, next_chapter_hints, core_events, protagonist_state_change, important_character_changes, setting_changes, new_locations, new_items_or_abilities, foreshadowing, unresolved_questions, facts_must_remember, next_chapter_hook, validation_status, validation_result, enabled, content_hash, draft_version, is_expired, ai_task_id, created_at, updated_at FROM chapter_summaries"
}

/// 保存章节总结（创建或更新）
#[tauri::command]
pub fn save_chapter_summary(input: SaveChapterSummaryInput) -> Result<ChapterSummaryDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    validate_summary_ownership(&conn, &input, true)?;
    upsert_chapter_summary(&conn, &input, &now)
}

/// 按章节获取总结
fn get_chapter_summary_internal(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Option<ChapterSummaryDto>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "{} WHERE chapter_id=?1 ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1",
            chapter_summary_select_sql()
        ))
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![chapter_id], map_chapter_summary_row)
        .optional()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_chapter_summary(chapter_id: String) -> Result<Option<ChapterSummaryDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    get_chapter_summary_internal(&conn, &chapter_id)
}

/// Return every summary for a novel in chapter order.  The explicit tie-breakers
/// make this stable even for legacy databases that contain duplicate summaries.
fn get_chapter_summaries_by_novel_internal(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<ChapterSummaryDto>, String> {
    let mut statement = conn
        .prepare(
            "SELECT summary.id, summary.novel_id, summary.chapter_id, summary.volume_id,
                    summary.adopted_draft_id, summary.summary, summary.key_events,
                    summary.character_changes, summary.relationship_changes,
                    summary.new_foreshadows, summary.resolved_foreshadows,
                    summary.next_chapter_hints, summary.core_events,
                    summary.protagonist_state_change, summary.important_character_changes,
                    summary.setting_changes, summary.new_locations,
                    summary.new_items_or_abilities, summary.foreshadowing,
                    summary.unresolved_questions, summary.facts_must_remember,
                    summary.next_chapter_hook, summary.validation_status,
                    summary.validation_result, summary.enabled, summary.content_hash,
                    summary.draft_version, summary.is_expired, summary.ai_task_id,
                    summary.created_at, summary.updated_at
             FROM chapter_summaries AS summary
             LEFT JOIN chapters AS chapter ON chapter.id = summary.chapter_id
             WHERE summary.novel_id = ?1
             ORDER BY CASE WHEN chapter.order_index IS NULL THEN 1 ELSE 0 END ASC,
                      chapter.order_index ASC, summary.chapter_id ASC,
                      summary.updated_at DESC, summary.created_at DESC, summary.id DESC",
        )
        .map_err(|error| format!("chapter_summary_list_prepare_failed: {error}"))?;
    let summaries = statement
        .query_map(params![novel_id], map_chapter_summary_row)
        .map_err(|error| format!("chapter_summary_list_query_failed: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("chapter_summary_list_read_failed: {error}"))?;
    Ok(summaries)
}

#[tauri::command]
pub fn get_chapter_summaries_by_novel(novel_id: String) -> Result<Vec<ChapterSummaryDto>, String> {
    let conn = get_connection().lock().map_err(|error| error.to_string())?;
    get_chapter_summaries_by_novel_internal(&conn, &novel_id)
}

/// 标记章节总结过期
fn expire_chapter_context_rows(
    conn: &Connection,
    chapter_id: &str,
    updated_at: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE chapter_summaries SET is_expired = 1, updated_at = ?1 WHERE chapter_id = ?2",
        params![updated_at, chapter_id],
    )
    .map_err(|error| format!("chapter_summary_expire_failed: {error}"))?;
    conn.execute(
        "UPDATE context_records SET is_expired = 1, updated_at = ?1 WHERE chapter_id = ?2",
        params![updated_at, chapter_id],
    )
    .map_err(|error| format!("chapter_context_records_expire_failed: {error}"))?;
    Ok(())
}

fn mark_chapter_context_expired_internal(
    conn: &mut Connection,
    chapter_id: &str,
) -> Result<(), String> {
    validate_uuid("chapter_summary_chapter_id", chapter_id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("chapter_context_expire_transaction_failed: {error}"))?;
    expire_chapter_context_rows(&transaction, chapter_id, &now)?;
    transaction
        .commit()
        .map_err(|error| format!("chapter_context_expire_commit_failed: {error}"))
}

#[tauri::command]
pub fn mark_chapter_summaries_expired(chapter_id: String) -> Result<(), String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    mark_chapter_context_expired_internal(&mut conn, &chapter_id)
}

/// 更新章节总结启用状态
#[tauri::command]
pub fn update_chapter_summary_enabled(id: String, enabled: bool) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE chapter_summaries SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
        params![enabled as i64, chrono::Utc::now().to_rfc3339(), &id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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

fn map_context_record_row(row: &rusqlite::Row) -> rusqlite::Result<ContextRecordDto> {
    Ok(ContextRecordDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        chapter_id: row.get(2)?,
        volume_id: row.get(3)?,
        context_type: row.get(4)?,
        title: row.get(5)?,
        content: row.get(6)?,
        importance: row.get(7)?,
        is_active: row.get::<_, i64>(8)? != 0,
        is_expired: row.get::<_, i64>(9)? != 0,
        content_hash: row.get(10)?,
        draft_version: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

fn context_record_select_sql() -> &'static str {
    "SELECT id, novel_id, chapter_id, volume_id, context_type, title, content, importance, is_active, is_expired, content_hash, draft_version, created_at, updated_at FROM context_records"
}

fn validate_uuid(field: &str, value: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| format!("{field}_invalid_uuid"))
}

fn validate_context_type(context_type: &str) -> Result<(), String> {
    const TYPES: [&str; 8] = [
        "chapter_summary",
        "volume_summary",
        "character_state",
        "foreshadow",
        "rule",
        "relationship",
        "plot_progress",
        "other",
    ];
    if TYPES.contains(&context_type) {
        Ok(())
    } else {
        Err("context_record_type_invalid".to_string())
    }
}

fn validate_context_record_input(
    conn: &Connection,
    input: &SaveContextRecordInput,
) -> Result<(), String> {
    if let Some(id) = input.id.as_deref() {
        validate_uuid("context_record_id", id)?;
    }
    validate_uuid("context_record_novel_id", &input.novel_id)?;
    if let Some(chapter_id) = input.chapter_id.as_deref() {
        validate_uuid("context_record_chapter_id", chapter_id)?;
    }
    if let Some(volume_id) = input.volume_id.as_deref() {
        validate_uuid("context_record_volume_id", volume_id)?;
    }
    validate_context_type(&input.context_type)?;
    if input.title.trim().is_empty() {
        return Err("context_record_title_required".to_string());
    }
    let importance = input.importance.unwrap_or(3);
    if !(1..=5).contains(&importance) {
        return Err("context_record_importance_out_of_range".to_string());
    }
    if input.draft_version.is_some_and(|version| version < 0) {
        return Err("context_record_draft_version_invalid".to_string());
    }

    let novel_exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM novels WHERE id = ?1 AND deleted_at IS NULL)",
            params![&input.novel_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("context_record_novel_read_failed: {error}"))?;
    if !novel_exists {
        return Err("context_record_novel_not_found".to_string());
    }

    let mut chapter_volume_id = None;
    if let Some(chapter_id) = input.chapter_id.as_deref() {
        chapter_volume_id = conn
            .query_row(
                "SELECT volume_id FROM chapters
                 WHERE id = ?1 AND novel_id = ?2 AND deleted_at IS NULL",
                params![chapter_id, &input.novel_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|error| format!("context_record_chapter_read_failed: {error}"))?
            .ok_or_else(|| "context_record_chapter_ownership_mismatch".to_string())?;
    }
    if let Some(volume_id) = input.volume_id.as_deref() {
        let volume_exists = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM volumes
                 WHERE id = ?1 AND novel_id = ?2 AND deleted_at IS NULL)",
                params![volume_id, &input.novel_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| format!("context_record_volume_read_failed: {error}"))?;
        if !volume_exists {
            return Err("context_record_volume_ownership_mismatch".to_string());
        }
        if input.chapter_id.is_some() && chapter_volume_id.as_deref() != Some(volume_id) {
            return Err("context_record_chapter_volume_mismatch".to_string());
        }
    }
    Ok(())
}

fn save_context_records_internal(
    conn: &mut Connection,
    inputs: &[SaveContextRecordInput],
) -> Result<Vec<ContextRecordDto>, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("context_record_transaction_failed: {error}"))?;
    let mut ids = Vec::with_capacity(inputs.len());

    for input in inputs {
        validate_context_record_input(&transaction, input)?;
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let importance = input.importance.unwrap_or(3);
        let is_active = input.is_active.unwrap_or(true);
        transaction
            .execute(
                "INSERT INTO context_records
                 (id, novel_id, chapter_id, volume_id, context_type, title, content,
                  importance, is_active, is_expired, content_hash, draft_version,
                  created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11, ?12, ?12)",
                params![
                    &id,
                    &input.novel_id,
                    &input.chapter_id,
                    &input.volume_id,
                    &input.context_type,
                    &input.title,
                    &input.content,
                    importance,
                    i64::from(is_active),
                    &input.content_hash,
                    &input.draft_version,
                    &now,
                ],
            )
            .map_err(|error| format!("context_record_insert_failed: {error}"))?;
        ids.push(id);
    }

    let mut results = Vec::with_capacity(ids.len());
    for id in &ids {
        results.push(
            transaction
                .query_row(
                    &format!("{} WHERE id = ?1", context_record_select_sql()),
                    params![id],
                    map_context_record_row,
                )
                .map_err(|error| format!("context_record_read_after_insert_failed: {error}"))?,
        );
    }
    transaction
        .commit()
        .map_err(|error| format!("context_record_commit_failed: {error}"))?;
    Ok(results)
}

/// 批量保存上下文记录
#[tauri::command]
pub fn save_context_records(
    inputs: Vec<SaveContextRecordInput>,
) -> Result<Vec<ContextRecordDto>, String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    save_context_records_internal(&mut conn, &inputs)
}

/// 获取作品的所有上下文记录
fn get_context_records_internal(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<ContextRecordDto>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "{} WHERE novel_id=?1 ORDER BY created_at DESC, id DESC",
            context_record_select_sql()
        ))
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![novel_id], map_context_record_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn get_context_records(novel_id: String) -> Result<Vec<ContextRecordDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    get_context_records_internal(&conn, &novel_id)
}

#[tauri::command]
pub fn get_context_record(id: String) -> Result<Option<ContextRecordDto>, String> {
    validate_uuid("context_record_id", &id)?;
    let conn = get_connection().lock().map_err(|error| error.to_string())?;
    conn.query_row(
        &format!("{} WHERE id = ?1", context_record_select_sql()),
        params![id],
        map_context_record_row,
    )
    .optional()
    .map_err(|error| format!("context_record_read_failed: {error}"))
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

fn update_context_record_internal(
    conn: &Connection,
    id: &str,
    input: &UpdateContextRecordInput,
) -> Result<ContextRecordDto, String> {
    validate_uuid("context_record_id", id)?;
    let validation_input = SaveContextRecordInput {
        id: Some(id.to_string()),
        novel_id: input.novel_id.clone(),
        chapter_id: input.chapter_id.clone(),
        volume_id: input.volume_id.clone(),
        context_type: input.context_type.clone(),
        title: input.title.clone(),
        content: input.content.clone(),
        importance: Some(input.importance),
        is_active: Some(input.is_active),
        content_hash: input.content_hash.clone(),
        draft_version: input.draft_version,
    };
    validate_context_record_input(conn, &validation_input)?;
    let owner = conn
        .query_row(
            "SELECT novel_id FROM context_records WHERE id = ?1",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("context_record_ownership_read_failed: {error}"))?
        .ok_or_else(|| "context_record_not_found".to_string())?;
    if owner != input.novel_id {
        return Err("context_record_ownership_mismatch".to_string());
    }
    let affected = conn
        .execute(
            "UPDATE context_records
             SET chapter_id = ?1, volume_id = ?2, context_type = ?3, title = ?4,
                 content = ?5, importance = ?6, is_active = ?7, is_expired = ?8,
                 content_hash = ?9, draft_version = ?10, updated_at = ?11
             WHERE id = ?12 AND novel_id = ?13",
            params![
                &input.chapter_id,
                &input.volume_id,
                &input.context_type,
                &input.title,
                &input.content,
                input.importance,
                i64::from(input.is_active),
                i64::from(input.is_expired),
                &input.content_hash,
                input.draft_version,
                chrono::Utc::now().to_rfc3339(),
                id,
                &input.novel_id,
            ],
        )
        .map_err(|error| format!("context_record_update_failed: {error}"))?;
    if affected != 1 {
        return Err("context_record_update_conflict".to_string());
    }
    conn.query_row(
        &format!("{} WHERE id = ?1", context_record_select_sql()),
        params![id],
        map_context_record_row,
    )
    .map_err(|error| format!("context_record_read_after_update_failed: {error}"))
}

#[tauri::command]
pub fn update_context_record(
    id: String,
    input: UpdateContextRecordInput,
) -> Result<ContextRecordDto, String> {
    let conn = get_connection().lock().map_err(|error| error.to_string())?;
    update_context_record_internal(&conn, &id, &input)
}

/// 更新上下文记录启用状态
#[tauri::command]
pub fn update_context_record_active(id: String, is_active: bool) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    validate_uuid("context_record_id", &id)?;
    let affected = conn
        .execute(
            "UPDATE context_records SET is_active = ?1, updated_at = ?2 WHERE id = ?3",
            params![is_active as i64, chrono::Utc::now().to_rfc3339(), &id],
        )
        .map_err(|e| e.to_string())?;
    if affected != 1 {
        return Err("context_record_not_found".to_string());
    }
    Ok(())
}

/// 删除上下文记录
#[tauri::command]
pub fn delete_context_record(id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    validate_uuid("context_record_id", &id)?;
    let affected = conn
        .execute("DELETE FROM context_records WHERE id = ?1", params![&id])
        .map_err(|error| format!("context_record_delete_failed: {error}"))?;
    if affected != 1 {
        return Err("context_record_not_found".to_string());
    }
    Ok(())
}

// ==================== Chapter Context Persistence ====================

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

fn character_state_select_sql() -> &'static str {
    "SELECT id, novel_id, character_id, chapter_id, state_summary, relationship_changes, goal_changes, location, health_state, knowledge_state, created_at FROM character_states"
}

fn map_character_state_row(row: &rusqlite::Row) -> rusqlite::Result<CharacterStateDto> {
    Ok(CharacterStateDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        character_id: row.get(2)?,
        chapter_id: row.get(3)?,
        state_summary: row.get(4)?,
        relationship_changes: row.get(5)?,
        goal_changes: row.get(6)?,
        location: row.get(7)?,
        health_state: row.get(8)?,
        knowledge_state: row.get(9)?,
        created_at: row.get(10)?,
    })
}

fn validate_summary_ownership(
    conn: &Connection,
    input: &SaveChapterSummaryInput,
    require_current_adopted_draft: bool,
) -> Result<(), String> {
    if let Some(id) = input.id.as_deref() {
        validate_uuid("chapter_summary_id", id)?;
    }
    validate_uuid("chapter_summary_novel_id", &input.novel_id)?;
    validate_uuid("chapter_summary_chapter_id", &input.chapter_id)?;
    validate_uuid("chapter_summary_adopted_draft_id", &input.adopted_draft_id)?;
    if let Some(volume_id) = input.volume_id.as_deref() {
        validate_uuid("chapter_summary_volume_id", volume_id)?;
    }
    if input.summary.trim().is_empty() {
        return Err("chapter_summary_content_required".to_string());
    }
    if input.draft_version.is_some_and(|version| version < 0) {
        return Err("chapter_summary_draft_version_invalid".to_string());
    }
    let novel_exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM novels WHERE id = ?1 AND deleted_at IS NULL)",
            params![&input.novel_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("chapter_summary_novel_read_failed: {error}"))?;
    if !novel_exists {
        return Err("chapter_summary_novel_not_found".to_string());
    }
    let chapter = conn
        .query_row(
            "SELECT volume_id, adopted_draft_id FROM chapters
             WHERE id = ?1 AND novel_id = ?2 AND deleted_at IS NULL",
            params![&input.chapter_id, &input.novel_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("chapter_summary_chapter_read_failed: {error}"))?
        .ok_or_else(|| "chapter_summary_chapter_ownership_mismatch".to_string())?;
    if input.volume_id.is_some() && input.volume_id != chapter.0 {
        return Err("chapter_summary_volume_ownership_mismatch".to_string());
    }
    if require_current_adopted_draft
        && chapter.1.as_deref() != Some(input.adopted_draft_id.as_str())
    {
        return Err("chapter_summary_adopted_draft_mismatch".to_string());
    }
    let draft_is_valid = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM chapter_drafts
                WHERE id = ?1 AND novel_id = ?2 AND chapter_id = ?3
                  AND (?4 = 0 OR is_adopted = 1)
             )",
            params![
                &input.adopted_draft_id,
                &input.novel_id,
                &input.chapter_id,
                i64::from(require_current_adopted_draft)
            ],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("chapter_summary_draft_read_failed: {error}"))?;
    if !draft_is_valid {
        return Err("chapter_summary_adopted_draft_ownership_mismatch".to_string());
    }
    Ok(())
}

fn validate_character_state_input(
    conn: &Connection,
    input: &SaveCharacterStateInput,
) -> Result<(), String> {
    if let Some(id) = input.id.as_deref() {
        validate_uuid("character_state_id", id)?;
    }
    validate_uuid("character_state_novel_id", &input.novel_id)?;
    validate_uuid("character_state_character_id", &input.character_id)?;
    if let Some(chapter_id) = input.chapter_id.as_deref() {
        validate_uuid("character_state_chapter_id", chapter_id)?;
    }
    if input.state_summary.trim().is_empty() {
        return Err("character_state_summary_required".to_string());
    }
    let character_exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM characters
             WHERE id = ?1 AND novel_id = ?2 AND is_active = 1)",
            params![&input.character_id, &input.novel_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("character_state_character_read_failed: {error}"))?;
    if !character_exists {
        return Err("character_state_character_ownership_mismatch".to_string());
    }
    if let Some(chapter_id) = input.chapter_id.as_deref() {
        let chapter_exists = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM chapters
                 WHERE id = ?1 AND novel_id = ?2 AND deleted_at IS NULL)",
                params![chapter_id, &input.novel_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| format!("character_state_chapter_read_failed: {error}"))?;
        if !chapter_exists {
            return Err("character_state_chapter_ownership_mismatch".to_string());
        }
    }
    Ok(())
}

fn upsert_chapter_summary(
    conn: &Connection,
    input: &SaveChapterSummaryInput,
    now: &str,
) -> Result<ChapterSummaryDto, String> {
    let selected_existing_id = if let Some(id) = input.id.as_deref() {
        conn.query_row(
            "SELECT novel_id, chapter_id FROM chapter_summaries WHERE id = ?1",
            params![id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| format!("chapter_summary_existing_read_failed: {error}"))?
        .map(|ownership| {
            if ownership.0 != input.novel_id || ownership.1 != input.chapter_id {
                Err("chapter_summary_ownership_mismatch".to_string())
            } else {
                Ok(id.to_string())
            }
        })
        .transpose()?
    } else {
        conn.query_row(
            "SELECT id FROM chapter_summaries
             WHERE novel_id = ?1 AND chapter_id = ?2
             ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1",
            params![&input.novel_id, &input.chapter_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("chapter_summary_existing_read_failed: {error}"))?
    };
    let id = selected_existing_id
        .or_else(|| input.id.clone())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let enabled = i64::from(input.enabled.unwrap_or(true));

    let exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM chapter_summaries WHERE id = ?1)",
            params![&id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("chapter_summary_exists_read_failed: {error}"))?;
    if exists {
        let affected = conn
            .execute(
                "UPDATE chapter_summaries SET
                    volume_id = ?1, summary = ?2, key_events = ?3,
                    character_changes = ?4, relationship_changes = ?5,
                    new_foreshadows = ?6, resolved_foreshadows = ?7,
                    next_chapter_hints = ?8, core_events = ?9,
                    protagonist_state_change = ?10, important_character_changes = ?11,
                    setting_changes = ?12, new_locations = ?13,
                    new_items_or_abilities = ?14, foreshadowing = ?15,
                    unresolved_questions = ?16, facts_must_remember = ?17,
                    next_chapter_hook = ?18, validation_status = ?19,
                    validation_result = ?20, enabled = ?21, content_hash = ?22,
                    draft_version = ?23, is_expired = 0, ai_task_id = ?24,
                    updated_at = ?25, adopted_draft_id = ?29
                 WHERE id = ?26 AND novel_id = ?27 AND chapter_id = ?28
                ",
                params![
                    &input.volume_id,
                    &input.summary,
                    &input.key_events,
                    &input.character_changes,
                    &input.relationship_changes,
                    &input.new_foreshadows,
                    &input.resolved_foreshadows,
                    &input.next_chapter_hints,
                    &input.core_events,
                    &input.protagonist_state_change,
                    &input.important_character_changes,
                    &input.setting_changes,
                    &input.new_locations,
                    &input.new_items_or_abilities,
                    &input.foreshadowing,
                    &input.unresolved_questions,
                    &input.facts_must_remember,
                    &input.next_chapter_hook,
                    &input.validation_status,
                    &input.validation_result,
                    enabled,
                    &input.content_hash,
                    input.draft_version,
                    &input.ai_task_id,
                    now,
                    &id,
                    &input.novel_id,
                    &input.chapter_id,
                    &input.adopted_draft_id,
                ],
            )
            .map_err(|error| format!("chapter_summary_update_failed: {error}"))?;
        if affected != 1 {
            return Err("chapter_summary_update_conflict".to_string());
        }
    } else {
        conn.execute(
            "INSERT INTO chapter_summaries
             (id, novel_id, chapter_id, volume_id, adopted_draft_id, summary,
              key_events, character_changes, relationship_changes, new_foreshadows,
              resolved_foreshadows, next_chapter_hints, core_events,
              protagonist_state_change, important_character_changes, setting_changes,
              new_locations, new_items_or_abilities, foreshadowing, unresolved_questions,
              facts_must_remember, next_chapter_hook, validation_status, validation_result,
              enabled, content_hash, draft_version, is_expired, ai_task_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                     ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23,
                     ?24, ?25, ?26, ?27, 0, ?28, ?29, ?29)",
            params![
                &id,
                &input.novel_id,
                &input.chapter_id,
                &input.volume_id,
                &input.adopted_draft_id,
                &input.summary,
                &input.key_events,
                &input.character_changes,
                &input.relationship_changes,
                &input.new_foreshadows,
                &input.resolved_foreshadows,
                &input.next_chapter_hints,
                &input.core_events,
                &input.protagonist_state_change,
                &input.important_character_changes,
                &input.setting_changes,
                &input.new_locations,
                &input.new_items_or_abilities,
                &input.foreshadowing,
                &input.unresolved_questions,
                &input.facts_must_remember,
                &input.next_chapter_hook,
                &input.validation_status,
                &input.validation_result,
                enabled,
                &input.content_hash,
                input.draft_version,
                &input.ai_task_id,
                now,
            ],
        )
        .map_err(|error| format!("chapter_summary_insert_failed: {error}"))?;
    }
    conn.query_row(
        &format!("{} WHERE id = ?1", chapter_summary_select_sql()),
        params![id],
        map_chapter_summary_row,
    )
    .map_err(|error| format!("chapter_summary_read_after_write_failed: {error}"))
}

fn upsert_bundle_context_record(
    conn: &Connection,
    input: &SaveContextRecordInput,
    now: &str,
) -> Result<ContextRecordDto, String> {
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let importance = input.importance.unwrap_or(3);
    let is_active = input.is_active.unwrap_or(true);
    let owner = conn
        .query_row(
            "SELECT novel_id, chapter_id FROM context_records WHERE id = ?1",
            params![&id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()
        .map_err(|error| format!("context_record_existing_read_failed: {error}"))?;
    if let Some(owner) = owner {
        if owner.0 != input.novel_id || owner.1 != input.chapter_id {
            return Err("context_record_ownership_mismatch".to_string());
        }
        let affected = conn
            .execute(
                "UPDATE context_records SET volume_id = ?1, context_type = ?2, title = ?3,
                    content = ?4, importance = ?5, is_active = ?6, is_expired = 0,
                    content_hash = ?7, draft_version = ?8, updated_at = ?9
                 WHERE id = ?10 AND novel_id = ?11",
                params![
                    &input.volume_id,
                    &input.context_type,
                    &input.title,
                    &input.content,
                    importance,
                    i64::from(is_active),
                    &input.content_hash,
                    input.draft_version,
                    now,
                    &id,
                    &input.novel_id,
                ],
            )
            .map_err(|error| format!("context_record_bundle_update_failed: {error}"))?;
        if affected != 1 {
            return Err("context_record_bundle_update_conflict".to_string());
        }
    } else {
        conn.execute(
            "INSERT INTO context_records
             (id, novel_id, chapter_id, volume_id, context_type, title, content,
              importance, is_active, is_expired, content_hash, draft_version,
              created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11, ?12, ?12)",
            params![
                &id,
                &input.novel_id,
                &input.chapter_id,
                &input.volume_id,
                &input.context_type,
                &input.title,
                &input.content,
                importance,
                i64::from(is_active),
                &input.content_hash,
                input.draft_version,
                now,
            ],
        )
        .map_err(|error| format!("context_record_bundle_insert_failed: {error}"))?;
    }
    conn.query_row(
        &format!("{} WHERE id = ?1", context_record_select_sql()),
        params![id],
        map_context_record_row,
    )
    .map_err(|error| format!("context_record_bundle_read_failed: {error}"))
}

fn upsert_bundle_character_state(
    conn: &Connection,
    input: &SaveCharacterStateInput,
    now: &str,
) -> Result<CharacterStateDto, String> {
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let owner = conn
        .query_row(
            "SELECT novel_id, character_id, chapter_id FROM character_states WHERE id = ?1",
            params![&id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("character_state_existing_read_failed: {error}"))?;
    if let Some(owner) = owner {
        if owner.0 != input.novel_id || owner.1 != input.character_id || owner.2 != input.chapter_id
        {
            return Err("character_state_ownership_mismatch".to_string());
        }
        let affected = conn
            .execute(
                "UPDATE character_states SET state_summary = ?1, relationship_changes = ?2,
                    goal_changes = ?3, location = ?4, health_state = ?5,
                    knowledge_state = ?6
                 WHERE id = ?7 AND novel_id = ?8 AND character_id = ?9",
                params![
                    &input.state_summary,
                    &input.relationship_changes,
                    &input.goal_changes,
                    &input.location,
                    &input.health_state,
                    &input.knowledge_state,
                    &id,
                    &input.novel_id,
                    &input.character_id,
                ],
            )
            .map_err(|error| format!("character_state_bundle_update_failed: {error}"))?;
        if affected != 1 {
            return Err("character_state_bundle_update_conflict".to_string());
        }
    } else {
        conn.execute(
            "INSERT INTO character_states
             (id, novel_id, character_id, chapter_id, state_summary,
              relationship_changes, goal_changes, location, health_state,
              knowledge_state, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                &id,
                &input.novel_id,
                &input.character_id,
                &input.chapter_id,
                &input.state_summary,
                &input.relationship_changes,
                &input.goal_changes,
                &input.location,
                &input.health_state,
                &input.knowledge_state,
                now,
            ],
        )
        .map_err(|error| format!("character_state_bundle_insert_failed: {error}"))?;
    }
    let character_affected = conn
        .execute(
            "UPDATE characters SET current_state = ?1, updated_at = ?2
             WHERE id = ?3 AND novel_id = ?4 AND is_active = 1",
            params![
                &input.state_summary,
                now,
                &input.character_id,
                &input.novel_id
            ],
        )
        .map_err(|error| format!("character_current_state_update_failed: {error}"))?;
    if character_affected != 1 {
        return Err("character_current_state_update_conflict".to_string());
    }
    conn.query_row(
        &format!("{} WHERE id = ?1", character_state_select_sql()),
        params![id],
        map_character_state_row,
    )
    .map_err(|error| format!("character_state_bundle_read_failed: {error}"))
}

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

fn save_chapter_context_bundle_internal(
    conn: &mut Connection,
    input: &SaveChapterContextBundleInput,
) -> Result<SaveChapterContextBundleResult, String> {
    validate_uuid("chapter_context_novel_id", &input.novel_id)?;
    validate_uuid("chapter_context_chapter_id", &input.chapter_id)?;
    validate_uuid("chapter_context_adopted_draft_id", &input.adopted_draft_id)?;
    if input.summary.novel_id != input.novel_id
        || input.summary.chapter_id != input.chapter_id
        || input.summary.adopted_draft_id != input.adopted_draft_id
    {
        return Err("chapter_context_summary_identity_mismatch".to_string());
    }

    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("chapter_context_transaction_failed: {error}"))?;
    validate_summary_ownership(&transaction, &input.summary, true)?;
    for context in &input.context_records {
        if context.novel_id != input.novel_id
            || context.chapter_id.as_deref() != Some(input.chapter_id.as_str())
        {
            return Err("chapter_context_record_identity_mismatch".to_string());
        }
        validate_context_record_input(&transaction, context)?;
    }
    for state in &input.character_states {
        if state.novel_id != input.novel_id
            || state.chapter_id.as_deref() != Some(input.chapter_id.as_str())
        {
            return Err("chapter_context_character_state_identity_mismatch".to_string());
        }
        validate_character_state_input(&transaction, state)?;
    }

    let summary = upsert_chapter_summary(&transaction, &input.summary, &now)?;
    let mut contexts = Vec::with_capacity(input.context_records.len());
    for context in &input.context_records {
        contexts.push(upsert_bundle_context_record(&transaction, context, &now)?);
    }
    let mut character_states = Vec::with_capacity(input.character_states.len());
    for state in &input.character_states {
        character_states.push(upsert_bundle_character_state(&transaction, state, &now)?);
    }
    let affected = transaction
        .execute(
            "UPDATE chapters SET status = 'summarized', updated_at = ?1
             WHERE id = ?2 AND novel_id = ?3 AND adopted_draft_id = ?4
               AND deleted_at IS NULL",
            params![
                &now,
                &input.chapter_id,
                &input.novel_id,
                &input.adopted_draft_id
            ],
        )
        .map_err(|error| format!("chapter_context_status_update_failed: {error}"))?;
    if affected != 1 {
        return Err("chapter_context_status_update_conflict".to_string());
    }
    transaction
        .commit()
        .map_err(|error| format!("chapter_context_commit_failed: {error}"))?;
    Ok(SaveChapterContextBundleResult {
        summary,
        context_records: contexts,
        character_states,
        chapter_status: "summarized".to_string(),
    })
}

#[tauri::command]
pub fn save_chapter_context_bundle(
    input: SaveChapterContextBundleInput,
) -> Result<SaveChapterContextBundleResult, String> {
    let mut conn = get_connection().lock().map_err(|error| error.to_string())?;
    save_chapter_context_bundle_internal(&mut conn, &input)
}

#[tauri::command]
pub fn get_chapter_summary_by_id(id: String) -> Result<Option<ChapterSummaryDto>, String> {
    validate_uuid("chapter_summary_id", &id)?;
    let conn = get_connection().lock().map_err(|error| error.to_string())?;
    conn.query_row(
        &format!("{} WHERE id = ?1", chapter_summary_select_sql()),
        params![id],
        map_chapter_summary_row,
    )
    .optional()
    .map_err(|error| format!("chapter_summary_read_failed: {error}"))
}

#[tauri::command]
pub fn delete_chapter_summary(id: String) -> Result<(), String> {
    validate_uuid("chapter_summary_id", &id)?;
    let conn = get_connection().lock().map_err(|error| error.to_string())?;
    let affected = conn
        .execute("DELETE FROM chapter_summaries WHERE id = ?1", params![id])
        .map_err(|error| format!("chapter_summary_delete_failed: {error}"))?;
    if affected != 1 {
        return Err("chapter_summary_not_found".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn get_character_states_by_character(
    character_id: String,
) -> Result<Vec<CharacterStateDto>, String> {
    validate_uuid("character_state_character_id", &character_id)?;
    let conn = get_connection().lock().map_err(|error| error.to_string())?;
    let mut statement = conn
        .prepare(&format!(
            "{} WHERE character_id = ?1 ORDER BY created_at DESC, id DESC",
            character_state_select_sql()
        ))
        .map_err(|error| format!("character_state_list_prepare_failed: {error}"))?;
    let states = statement
        .query_map(params![character_id], map_character_state_row)
        .map_err(|error| format!("character_state_list_query_failed: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("character_state_list_read_failed: {error}"))?;
    Ok(states)
}

#[tauri::command]
pub fn get_character_states_by_chapter(
    chapter_id: String,
) -> Result<Vec<CharacterStateDto>, String> {
    validate_uuid("character_state_chapter_id", &chapter_id)?;
    let conn = get_connection().lock().map_err(|error| error.to_string())?;
    let mut statement = conn
        .prepare(&format!(
            "{} WHERE chapter_id = ?1 ORDER BY created_at DESC, id DESC",
            character_state_select_sql()
        ))
        .map_err(|error| format!("character_state_list_prepare_failed: {error}"))?;
    let states = statement
        .query_map(params![chapter_id], map_character_state_row)
        .map_err(|error| format!("character_state_list_query_failed: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("character_state_list_read_failed: {error}"))?;
    Ok(states)
}

#[tauri::command]
pub fn save_character_state(input: SaveCharacterStateInput) -> Result<CharacterStateDto, String> {
    let mut conn = get_connection().lock().map_err(|error| error.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("character_state_transaction_failed: {error}"))?;
    validate_character_state_input(&transaction, &input)?;
    let state = upsert_bundle_character_state(&transaction, &input, &now)?;
    transaction
        .commit()
        .map_err(|error| format!("character_state_commit_failed: {error}"))?;
    Ok(state)
}

#[tauri::command]
pub fn delete_character_state(id: String) -> Result<(), String> {
    validate_uuid("character_state_id", &id)?;
    let mut conn = get_connection().lock().map_err(|error| error.to_string())?;
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("character_state_delete_transaction_failed: {error}"))?;
    let identity = transaction
        .query_row(
            "SELECT novel_id, character_id FROM character_states WHERE id = ?1",
            params![&id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| format!("character_state_delete_read_failed: {error}"))?
        .ok_or_else(|| "character_state_not_found".to_string())?;
    let affected = transaction
        .execute("DELETE FROM character_states WHERE id = ?1", params![&id])
        .map_err(|error| format!("character_state_delete_failed: {error}"))?;
    if affected != 1 {
        return Err("character_state_delete_conflict".to_string());
    }
    let latest_state = transaction
        .query_row(
            "SELECT state_summary FROM character_states
             WHERE novel_id = ?1 AND character_id = ?2
             ORDER BY created_at DESC, id DESC LIMIT 1",
            params![&identity.0, &identity.1],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("character_state_latest_read_failed: {error}"))?;
    let character_affected = transaction
        .execute(
            "UPDATE characters SET current_state = ?1, updated_at = ?2
             WHERE id = ?3 AND novel_id = ?4",
            params![
                &latest_state,
                chrono::Utc::now().to_rfc3339(),
                &identity.1,
                &identity.0
            ],
        )
        .map_err(|error| format!("character_state_current_reconcile_failed: {error}"))?;
    if character_affected != 1 {
        return Err("character_state_character_missing".to_string());
    }
    transaction
        .commit()
        .map_err(|error| format!("character_state_delete_commit_failed: {error}"))?;
    Ok(())
}

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

fn migration_timestamp(value: Option<&str>, fallback: &str) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn table_has_id(conn: &Connection, table: &str, id: &str) -> Result<bool, String> {
    let sql = match table {
        "chapter_summaries" => "SELECT EXISTS(SELECT 1 FROM chapter_summaries WHERE id = ?1)",
        "context_records" => "SELECT EXISTS(SELECT 1 FROM context_records WHERE id = ?1)",
        "character_states" => "SELECT EXISTS(SELECT 1 FROM character_states WHERE id = ?1)",
        _ => return Err("legacy_migration_unknown_table".to_string()),
    };
    conn.query_row(sql, params![id], |row| row.get::<_, bool>(0))
        .map_err(|error| format!("legacy_migration_id_read_failed: {error}"))
}

fn choose_migration_id(
    conn: &Connection,
    table: &str,
    source_id: Option<&str>,
) -> Result<String, String> {
    if let Some(source_id) = source_id {
        if uuid::Uuid::parse_str(source_id).is_ok() && !table_has_id(conn, table, source_id)? {
            return Ok(source_id.to_string());
        }
    }
    Ok(uuid::Uuid::new_v4().to_string())
}

fn select_legacy_candidate(
    candidates: Vec<(String, String, String)>,
    source_id: Option<&str>,
    created_at: Option<&str>,
    updated_at: Option<&str>,
) -> Result<Option<String>, ()> {
    if let Some(source_id) = source_id {
        if let Some(candidate) = candidates.iter().find(|candidate| candidate.0 == source_id) {
            return Ok(Some(candidate.0.clone()));
        }
    }
    match candidates.len() {
        0 => Ok(None),
        1 => Ok(Some(candidates[0].0.clone())),
        _ => {
            let timestamps: Vec<_> = candidates
                .iter()
                .filter(|candidate| {
                    created_at.is_none_or(|value| candidate.1 == value)
                        && updated_at.is_none_or(|value| candidate.2 == value)
                })
                .collect();
            if timestamps.len() == 1 {
                Ok(Some(timestamps[0].0.clone()))
            } else {
                Err(())
            }
        }
    }
}

fn legacy_summary_matches(dto: &ChapterSummaryDto, input: &LegacyChapterSummaryInput) -> bool {
    dto.novel_id == input.data.novel_id
        && dto.chapter_id == input.data.chapter_id
        && dto.volume_id == input.data.volume_id
        && dto.adopted_draft_id == input.data.adopted_draft_id
        && dto.summary == input.data.summary
        && dto.key_events == input.data.key_events
        && dto.character_changes == input.data.character_changes
        && dto.relationship_changes == input.data.relationship_changes
        && dto.new_foreshadows == input.data.new_foreshadows
        && dto.resolved_foreshadows == input.data.resolved_foreshadows
        && dto.next_chapter_hints == input.data.next_chapter_hints
        && dto.core_events == input.data.core_events
        && dto.protagonist_state_change == input.data.protagonist_state_change
        && dto.important_character_changes == input.data.important_character_changes
        && dto.setting_changes == input.data.setting_changes
        && dto.new_locations == input.data.new_locations
        && dto.new_items_or_abilities == input.data.new_items_or_abilities
        && dto.foreshadowing == input.data.foreshadowing
        && dto.unresolved_questions == input.data.unresolved_questions
        && dto.facts_must_remember == input.data.facts_must_remember
        && dto.next_chapter_hook == input.data.next_chapter_hook
        && dto.validation_status == input.data.validation_status
        && dto.validation_result == input.data.validation_result
        && dto.enabled == input.data.enabled.unwrap_or(true)
        && dto.content_hash == input.data.content_hash
        && dto.draft_version == input.data.draft_version
        && dto.is_expired == input.is_expired.unwrap_or(false)
        && dto.ai_task_id == input.data.ai_task_id
}

fn legacy_context_matches(dto: &ContextRecordDto, input: &LegacyContextRecordInput) -> bool {
    dto.novel_id == input.data.novel_id
        && dto.chapter_id == input.data.chapter_id
        && dto.volume_id == input.data.volume_id
        && dto.context_type == input.data.context_type
        && dto.title == input.data.title
        && dto.content == input.data.content
        && dto.importance == input.data.importance.unwrap_or(3)
        && dto.is_active == input.data.is_active.unwrap_or(true)
        && dto.is_expired == input.is_expired.unwrap_or(false)
        && dto.content_hash == input.data.content_hash
        && dto.draft_version == input.data.draft_version
}

fn legacy_character_state_matches(
    dto: &CharacterStateDto,
    input: &LegacyCharacterStateInput,
) -> bool {
    dto.novel_id == input.data.novel_id
        && dto.character_id == input.data.character_id
        && dto.chapter_id == input.data.chapter_id
        && dto.state_summary == input.data.state_summary
        && dto.relationship_changes == input.data.relationship_changes
        && dto.goal_changes == input.data.goal_changes
        && dto.location == input.data.location
        && dto.health_state == input.data.health_state
        && dto.knowledge_state == input.data.knowledge_state
}

fn load_summary_candidates(
    conn: &Connection,
    input: &LegacyChapterSummaryInput,
) -> Result<Vec<(String, String, String)>, String> {
    let mut statement = conn
        .prepare(&format!(
            "{} WHERE novel_id = ?1 AND chapter_id = ?2",
            chapter_summary_select_sql()
        ))
        .map_err(|error| format!("legacy_summary_candidates_prepare_failed: {error}"))?;
    let rows = statement
        .query_map(
            params![&input.data.novel_id, &input.data.chapter_id],
            map_chapter_summary_row,
        )
        .map_err(|error| format!("legacy_summary_candidates_query_failed: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("legacy_summary_candidates_read_failed: {error}"))?;
    Ok(rows
        .into_iter()
        .filter(|row| legacy_summary_matches(row, input))
        .map(|row| (row.id, row.created_at, row.updated_at))
        .collect())
}

fn load_context_candidates(
    conn: &Connection,
    input: &LegacyContextRecordInput,
) -> Result<Vec<(String, String, String)>, String> {
    let mut statement = conn
        .prepare(&format!(
            "{} WHERE novel_id = ?1",
            context_record_select_sql()
        ))
        .map_err(|error| format!("legacy_context_candidates_prepare_failed: {error}"))?;
    let rows = statement
        .query_map(params![&input.data.novel_id], map_context_record_row)
        .map_err(|error| format!("legacy_context_candidates_query_failed: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("legacy_context_candidates_read_failed: {error}"))?;
    Ok(rows
        .into_iter()
        .filter(|row| legacy_context_matches(row, input))
        .map(|row| (row.id, row.created_at, row.updated_at))
        .collect())
}

fn load_character_state_candidates(
    conn: &Connection,
    input: &LegacyCharacterStateInput,
) -> Result<Vec<(String, String, String)>, String> {
    let mut statement = conn
        .prepare(&format!(
            "{} WHERE novel_id = ?1 AND character_id = ?2",
            character_state_select_sql()
        ))
        .map_err(|error| format!("legacy_character_candidates_prepare_failed: {error}"))?;
    let rows = statement
        .query_map(
            params![&input.data.novel_id, &input.data.character_id],
            map_character_state_row,
        )
        .map_err(|error| format!("legacy_character_candidates_query_failed: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("legacy_character_candidates_read_failed: {error}"))?;
    Ok(rows
        .into_iter()
        .filter(|row| legacy_character_state_matches(row, input))
        .map(|row| (row.id, row.created_at.clone(), row.created_at))
        .collect())
}

fn push_migration_warning(
    result: &mut MigrateLegacyChapterContextResult,
    entity: &str,
    index: usize,
    source_id: Option<&str>,
    reason: &str,
) {
    result.warnings.push(format!(
        "{entity}[{index}] id={}: {reason}",
        source_id.unwrap_or("<missing>")
    ));
}

fn migrate_legacy_chapter_context_internal(
    conn: &mut Connection,
    input: &MigrateLegacyChapterContextInput,
) -> Result<MigrateLegacyChapterContextResult, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("legacy_context_transaction_failed: {error}"))?;
    let mut result = MigrateLegacyChapterContextResult::default();
    let mut affected_characters: HashSet<(String, String)> = HashSet::new();

    for (index, item) in input.chapter_summaries.iter().enumerate() {
        let source_id = item.data.id.as_deref();
        let mut validation = item.data.clone();
        validation.id = None;
        if let Err(error) = validate_summary_ownership(&transaction, &validation, false) {
            result.chapter_summaries.skipped += 1;
            push_migration_warning(&mut result, "chapterSummaries", index, source_id, &error);
            continue;
        }
        let candidates = load_summary_candidates(&transaction, item)?;
        match select_legacy_candidate(
            candidates,
            source_id,
            item.created_at.as_deref(),
            item.updated_at.as_deref(),
        ) {
            Ok(Some(id)) => {
                result.chapter_summaries.matched += 1;
                if let Some(source_id) = source_id {
                    result.id_map.insert(source_id.to_string(), id);
                }
            }
            Err(()) => {
                result.chapter_summaries.skipped += 1;
                push_migration_warning(
                    &mut result,
                    "chapterSummaries",
                    index,
                    source_id,
                    "ambiguous_fingerprint_and_timestamps",
                );
            }
            Ok(None) => {
                let id = choose_migration_id(&transaction, "chapter_summaries", source_id)?;
                let created_at = migration_timestamp(item.created_at.as_deref(), &now);
                let updated_at = migration_timestamp(item.updated_at.as_deref(), &created_at);
                transaction
                    .execute(
                        "INSERT INTO chapter_summaries
                     (id, novel_id, chapter_id, volume_id, adopted_draft_id, summary,
                      key_events, character_changes, relationship_changes, new_foreshadows,
                      resolved_foreshadows, next_chapter_hints, core_events,
                      protagonist_state_change, important_character_changes, setting_changes,
                      new_locations, new_items_or_abilities, foreshadowing, unresolved_questions,
                      facts_must_remember, next_chapter_hook, validation_status, validation_result,
                      enabled, content_hash, draft_version, is_expired, ai_task_id,
                      created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                             ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23,
                             ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31)",
                        params![
                            &id,
                            &item.data.novel_id,
                            &item.data.chapter_id,
                            &item.data.volume_id,
                            &item.data.adopted_draft_id,
                            &item.data.summary,
                            &item.data.key_events,
                            &item.data.character_changes,
                            &item.data.relationship_changes,
                            &item.data.new_foreshadows,
                            &item.data.resolved_foreshadows,
                            &item.data.next_chapter_hints,
                            &item.data.core_events,
                            &item.data.protagonist_state_change,
                            &item.data.important_character_changes,
                            &item.data.setting_changes,
                            &item.data.new_locations,
                            &item.data.new_items_or_abilities,
                            &item.data.foreshadowing,
                            &item.data.unresolved_questions,
                            &item.data.facts_must_remember,
                            &item.data.next_chapter_hook,
                            &item.data.validation_status,
                            &item.data.validation_result,
                            i64::from(item.data.enabled.unwrap_or(true)),
                            &item.data.content_hash,
                            item.data.draft_version,
                            i64::from(item.is_expired.unwrap_or(false)),
                            &item.data.ai_task_id,
                            &created_at,
                            &updated_at,
                        ],
                    )
                    .map_err(|error| format!("legacy_summary_insert_failed: {error}"))?;
                result.chapter_summaries.inserted += 1;
                if let Some(source_id) = source_id {
                    result.id_map.insert(source_id.to_string(), id);
                }
            }
        }
    }

    for (index, item) in input.context_records.iter().enumerate() {
        let source_id = item.data.id.as_deref();
        let mut validation = item.data.clone();
        validation.id = None;
        if let Err(error) = validate_context_record_input(&transaction, &validation) {
            result.context_records.skipped += 1;
            push_migration_warning(&mut result, "contextRecords", index, source_id, &error);
            continue;
        }
        let candidates = load_context_candidates(&transaction, item)?;
        match select_legacy_candidate(
            candidates,
            source_id,
            item.created_at.as_deref(),
            item.updated_at.as_deref(),
        ) {
            Ok(Some(id)) => {
                result.context_records.matched += 1;
                if let Some(source_id) = source_id {
                    result.id_map.insert(source_id.to_string(), id);
                }
            }
            Err(()) => {
                result.context_records.skipped += 1;
                push_migration_warning(
                    &mut result,
                    "contextRecords",
                    index,
                    source_id,
                    "ambiguous_fingerprint_and_timestamps",
                );
            }
            Ok(None) => {
                let id = choose_migration_id(&transaction, "context_records", source_id)?;
                let created_at = migration_timestamp(item.created_at.as_deref(), &now);
                let updated_at = migration_timestamp(item.updated_at.as_deref(), &created_at);
                transaction
                    .execute(
                        "INSERT INTO context_records
                     (id, novel_id, chapter_id, volume_id, context_type, title, content,
                      importance, is_active, is_expired, content_hash, draft_version,
                      created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                        params![
                            &id,
                            &item.data.novel_id,
                            &item.data.chapter_id,
                            &item.data.volume_id,
                            &item.data.context_type,
                            &item.data.title,
                            &item.data.content,
                            item.data.importance.unwrap_or(3),
                            i64::from(item.data.is_active.unwrap_or(true)),
                            i64::from(item.is_expired.unwrap_or(false)),
                            &item.data.content_hash,
                            item.data.draft_version,
                            &created_at,
                            &updated_at,
                        ],
                    )
                    .map_err(|error| format!("legacy_context_insert_failed: {error}"))?;
                result.context_records.inserted += 1;
                if let Some(source_id) = source_id {
                    result.id_map.insert(source_id.to_string(), id);
                }
            }
        }
    }

    for (index, item) in input.character_states.iter().enumerate() {
        let source_id = item.data.id.as_deref();
        let mut validation = item.data.clone();
        validation.id = None;
        let ownership_result = (|| {
            validate_uuid("character_state_novel_id", &validation.novel_id)?;
            validate_uuid("character_state_character_id", &validation.character_id)?;
            if let Some(chapter_id) = validation.chapter_id.as_deref() {
                validate_uuid("character_state_chapter_id", chapter_id)?;
            }
            let character_exists = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM characters WHERE id = ?1 AND novel_id = ?2)",
                    params![&validation.character_id, &validation.novel_id],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(|error| format!("legacy_character_ownership_read_failed: {error}"))?;
            if !character_exists {
                return Err("character_state_character_ownership_mismatch".to_string());
            }
            if let Some(chapter_id) = validation.chapter_id.as_deref() {
                let chapter_exists = transaction
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM chapters
                         WHERE id = ?1 AND novel_id = ?2 AND deleted_at IS NULL)",
                        params![chapter_id, &validation.novel_id],
                        |row| row.get::<_, bool>(0),
                    )
                    .map_err(|error| format!("legacy_character_chapter_read_failed: {error}"))?;
                if !chapter_exists {
                    return Err("character_state_chapter_ownership_mismatch".to_string());
                }
            }
            if validation.state_summary.trim().is_empty() {
                return Err("character_state_summary_required".to_string());
            }
            Ok(())
        })();
        if let Err(error) = ownership_result {
            result.character_states.skipped += 1;
            push_migration_warning(&mut result, "characterStates", index, source_id, &error);
            continue;
        }
        let candidates = load_character_state_candidates(&transaction, item)?;
        let reconciled = match select_legacy_candidate(
            candidates,
            source_id,
            item.created_at.as_deref(),
            item.created_at.as_deref(),
        ) {
            Ok(Some(id)) => {
                result.character_states.matched += 1;
                if let Some(source_id) = source_id {
                    result.id_map.insert(source_id.to_string(), id);
                }
                true
            }
            Err(()) => {
                result.character_states.skipped += 1;
                push_migration_warning(
                    &mut result,
                    "characterStates",
                    index,
                    source_id,
                    "ambiguous_fingerprint_and_timestamp",
                );
                false
            }
            Ok(None) => {
                let id = choose_migration_id(&transaction, "character_states", source_id)?;
                let created_at = migration_timestamp(item.created_at.as_deref(), &now);
                transaction
                    .execute(
                        "INSERT INTO character_states
                     (id, novel_id, character_id, chapter_id, state_summary,
                      relationship_changes, goal_changes, location, health_state,
                      knowledge_state, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                        params![
                            &id,
                            &item.data.novel_id,
                            &item.data.character_id,
                            &item.data.chapter_id,
                            &item.data.state_summary,
                            &item.data.relationship_changes,
                            &item.data.goal_changes,
                            &item.data.location,
                            &item.data.health_state,
                            &item.data.knowledge_state,
                            &created_at,
                        ],
                    )
                    .map_err(|error| format!("legacy_character_state_insert_failed: {error}"))?;
                result.character_states.inserted += 1;
                if let Some(source_id) = source_id {
                    result.id_map.insert(source_id.to_string(), id);
                }
                true
            }
        };
        if reconciled {
            affected_characters
                .insert((item.data.novel_id.clone(), item.data.character_id.clone()));
        }
    }

    let mut affected_characters: Vec<_> = affected_characters.into_iter().collect();
    affected_characters.sort();
    for (novel_id, character_id) in affected_characters {
        let latest_state = transaction
            .query_row(
                "SELECT state_summary FROM character_states
                 WHERE novel_id = ?1 AND character_id = ?2
                 ORDER BY created_at DESC, id DESC LIMIT 1",
                params![&novel_id, &character_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("legacy_character_latest_state_read_failed: {error}"))?
            .ok_or_else(|| "legacy_character_latest_state_missing".to_string())?;
        let affected = transaction
            .execute(
                "UPDATE characters SET current_state = ?1, updated_at = ?2
                 WHERE id = ?3 AND novel_id = ?4",
                params![&latest_state, &now, &character_id, &novel_id],
            )
            .map_err(|error| format!("legacy_character_current_state_update_failed: {error}"))?;
        if affected != 1 {
            return Err("legacy_character_current_state_update_conflict".to_string());
        }
    }

    transaction
        .commit()
        .map_err(|error| format!("legacy_context_commit_failed: {error}"))?;
    Ok(result)
}

#[tauri::command]
pub fn migrate_legacy_chapter_context(
    input: MigrateLegacyChapterContextInput,
) -> Result<MigrateLegacyChapterContextResult, String> {
    let mut conn = get_connection().lock().map_err(|error| error.to_string())?;
    migrate_legacy_chapter_context_internal(&mut conn, &input)
}

// ==================== Quality Fix Runs ====================

#[derive(Debug, Serialize, Deserialize)]
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

fn map_fix_run_row(row: &rusqlite::Row) -> rusqlite::Result<QualityFixRunDto> {
    Ok(QualityFixRunDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        chapter_id: row.get(2)?,
        source_draft_id: row.get(3)?,
        source_draft_version: row.get(4)?,
        target_draft_id: row.get(5)?,
        target_draft_version: row.get(6)?,
        source_content_hash: row.get(7)?,
        target_content_hash: row.get(8)?,
        before_report_id: row.get(9)?,
        after_report_id: row.get(10)?,
        before_score: row.get(11)?,
        after_score: row.get(12)?,
        before_pending_count: row.get(13)?,
        after_pending_count: row.get(14)?,
        before_serious_count: row.get(15)?,
        after_serious_count: row.get(16)?,
        fixed_issue_ids: row.get(17)?,
        new_issue_ids: row.get(18)?,
        mode: row.get(19)?,
        status: row.get(20)?,
        model: row.get(21)?,
        revision_summary: row.get(22)?,
        changed_ranges_json: row.get(23)?,
        used_context_ids: row.get(24)?,
        skipped_context_ids: row.get(25)?,
        warnings: row.get(26)?,
        failure_reason: row.get(27)?,
        created_at: row.get(28)?,
        updated_at: row.get(29)?,
    })
}

fn has_other_quality_fix_round(
    conn: &Connection,
    chapter_id: &str,
    source_draft_id: &str,
    run_id: &str,
) -> Result<bool, String> {
    let existing_rounds: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM quality_fix_runs WHERE chapter_id=?1 AND source_draft_id=?2 AND id<>?3",
            params![chapter_id, source_draft_id, run_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(existing_rounds > 0)
}

/// 保存修稿记录（创建或更新）
#[tauri::command]
pub fn save_quality_fix_run(input: SaveQualityFixRunInput) -> Result<QualityFixRunDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let mode = input.mode.unwrap_or_else(|| "conservative".to_string());

    // upsert: try update, then insert
    let updated = conn.execute(
        "UPDATE quality_fix_runs SET target_draft_id=?1, target_draft_version=?2, target_content_hash=?3, after_report_id=?4, after_score=?5, after_pending_count=?6, after_serious_count=?7, fixed_issue_ids=?8, new_issue_ids=?9, status=?10, revision_summary=?11, changed_ranges_json=?12, used_context_ids=?13, skipped_context_ids=?14, warnings=?15, failure_reason=?16, updated_at=?17 WHERE id=?18",
        params![
            &input.target_draft_id, &input.target_draft_version, &input.target_content_hash,
            &input.after_report_id, &input.after_score, &input.after_pending_count,
            &input.after_serious_count, &input.fixed_issue_ids, &input.new_issue_ids,
            &input.status, &input.revision_summary, &input.changed_ranges_json,
            &input.used_context_ids, &input.skipped_context_ids, &input.warnings,
            &input.failure_reason, &now, &input.id,
        ],
    ).map_err(|e| e.to_string())?;

    if updated == 0 {
        if has_other_quality_fix_round(&conn, &input.chapter_id, &input.source_draft_id, &input.id)?
        {
            return Err(
                "quality_fix_round_already_used: source draft already has a repair run".to_string(),
            );
        }
        conn.execute(
            "INSERT INTO quality_fix_runs (id, novel_id, chapter_id, source_draft_id, source_draft_version, target_draft_id, target_draft_version, source_content_hash, target_content_hash, before_report_id, after_report_id, before_score, after_score, before_pending_count, after_pending_count, before_serious_count, after_serious_count, fixed_issue_ids, new_issue_ids, mode, status, model, revision_summary, changed_ranges_json, used_context_ids, skipped_context_ids, warnings, failure_reason, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?29)",
            params![
                &input.id, &input.novel_id, &input.chapter_id, &input.source_draft_id,
                &input.source_draft_version, &input.target_draft_id, &input.target_draft_version,
                &input.source_content_hash, &input.target_content_hash, &input.before_report_id,
                &input.after_report_id, &input.before_score, &input.after_score,
                &input.before_pending_count, &input.after_pending_count,
                &input.before_serious_count, &input.after_serious_count,
                &input.fixed_issue_ids, &input.new_issue_ids, &mode, &input.status,
                &input.model, &input.revision_summary, &input.changed_ranges_json,
                &input.used_context_ids, &input.skipped_context_ids, &input.warnings,
                &input.failure_reason, &now,
            ],
        ).map_err(|e| e.to_string())?;
    }

    let mut stmt = conn.prepare(
        "SELECT id, novel_id, chapter_id, source_draft_id, source_draft_version, target_draft_id, target_draft_version, source_content_hash, target_content_hash, before_report_id, after_report_id, before_score, after_score, before_pending_count, after_pending_count, before_serious_count, after_serious_count, fixed_issue_ids, new_issue_ids, mode, status, model, revision_summary, changed_ranges_json, used_context_ids, skipped_context_ids, warnings, failure_reason, created_at, updated_at FROM quality_fix_runs WHERE id=?1"
    ).map_err(|e| e.to_string())?;
    stmt.query_row(params![&input.id], map_fix_run_row)
        .map_err(|e| e.to_string())
}

/// 获取章节的修稿记录
#[tauri::command]
pub fn get_quality_fix_runs(chapter_id: String) -> Result<Vec<QualityFixRunDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, novel_id, chapter_id, source_draft_id, source_draft_version, target_draft_id, target_draft_version, source_content_hash, target_content_hash, before_report_id, after_report_id, before_score, after_score, before_pending_count, after_pending_count, before_serious_count, after_serious_count, fixed_issue_ids, new_issue_ids, mode, status, model, revision_summary, changed_ranges_json, used_context_ids, skipped_context_ids, warnings, failure_reason, created_at, updated_at FROM quality_fix_runs WHERE chapter_id=?1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![&chapter_id], map_fix_run_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

/// 更新修稿记录状态
#[tauri::command]
pub fn update_quality_fix_run_status(id: String, status: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE quality_fix_runs SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![&status, chrono::Utc::now().to_rfc3339(), &id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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

/// 保存上下文读取日志
#[tauri::command]
pub fn save_context_read_log(input: SaveContextReadLogInput) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO context_read_logs (id, novel_id, task_type, chapter_id, volume_id, used_context_ids, skipped_context_ids, warnings, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![&input.id, &input.novel_id, &input.task_type, &input.chapter_id, &input.volume_id, &input.used_context_ids, &input.skipped_context_ids, &input.warnings, &now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::mpsc;
    use std::time::Duration;

    const RUNTIME_AI_TASK_CHILD_TABLES: [&str; 5] = [
        "chapter_drafts",
        "quality_check_reports",
        "polish_records",
        "chapter_events",
        "chapter_summaries",
    ];

    #[test]
    fn draft_word_count_matches_editor_semantics() {
        assert_eq!(count_words("你好，世界！ Hello world 2026."), 7);
        assert_eq!(count_words("# 标题\nalpha-beta `42`"), 5);
        assert_eq!(count_words(" \n\t，。！？ "), 0);
    }

    fn create_volume_chapter_update_test_schema(conn: &Connection) -> rusqlite::Result<()> {
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;

            CREATE TABLE volumes (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT,
                goal TEXT,
                main_conflict TEXT,
                order_index INTEGER NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE chapters (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                volume_id TEXT,
                title TEXT NOT NULL,
                outline TEXT,
                goal TEXT,
                order_index INTEGER NOT NULL,
                status TEXT NOT NULL,
                adopted_draft_id TEXT,
                word_count INTEGER NOT NULL,
                target_word_count INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (volume_id) REFERENCES volumes(id)
            );

            INSERT INTO volumes
                (id, novel_id, title, summary, goal, main_conflict, order_index, status, created_at, updated_at)
            VALUES
                ('volume-a', 'novel-a', 'volume-original-a', NULL, NULL, NULL, 0, 'planned', 'before', 'before'),
                ('volume-b', 'novel-a', 'volume-original-b', NULL, NULL, NULL, 1, 'planned', 'before', 'before');

            INSERT INTO chapters
                (id, novel_id, volume_id, title, outline, goal, order_index, status, adopted_draft_id, word_count, target_word_count, created_at, updated_at)
            VALUES
                ('chapter-a', 'novel-a', 'volume-a', 'chapter-original-a', NULL, NULL, 0, 'not_started', NULL, 0, 3000, 'before', 'before'),
                ('chapter-b', 'novel-a', 'volume-b', 'chapter-original-b', NULL, NULL, 1, 'not_started', NULL, 0, 3000, 'before', 'before');
            ",
        )
    }

    #[test]
    fn update_volume_binds_ipc_values_and_rejects_invalid_status() {
        let conn = Connection::open_in_memory().unwrap();
        create_volume_chapter_update_test_schema(&conn).unwrap();

        let injection_result = update_volume_internal(
            &conn,
            "volume-a' OR 1=1 --",
            UpdateVolumeInput {
                title: Some("injected".to_string()),
                summary: None,
                goal: None,
                main_conflict: None,
                order_index: None,
                status: None,
            },
            "after-injection",
        );
        assert!(injection_result.is_err());
        let untouched: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM volumes WHERE title LIKE 'volume-original-%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(untouched, 2);

        let updated = update_volume_internal(
            &conn,
            "volume-a",
            UpdateVolumeInput {
                title: Some("Writer's volume".to_string()),
                summary: None,
                goal: None,
                main_conflict: None,
                order_index: Some(2),
                status: Some("writing".to_string()),
            },
            "after-valid-update",
        )
        .unwrap();
        assert_eq!(updated.title, "Writer's volume");
        assert_eq!(updated.status, "writing");
        assert_eq!(updated.order_index, 2);

        let invalid_status = update_volume_internal(
            &conn,
            "volume-a",
            UpdateVolumeInput {
                title: Some("must-not-apply".to_string()),
                summary: None,
                goal: None,
                main_conflict: None,
                order_index: None,
                status: Some("writing', title = 'injected".to_string()),
            },
            "after-invalid-status",
        )
        .unwrap_err();
        assert_eq!(invalid_status, "volume_status_invalid");
        let title: String = conn
            .query_row(
                "SELECT title FROM volumes WHERE id = 'volume-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(title, "Writer's volume");
    }

    #[test]
    fn update_chapter_binds_ipc_values_and_rejects_invalid_status() {
        let conn = Connection::open_in_memory().unwrap();
        create_volume_chapter_update_test_schema(&conn).unwrap();

        let injection_result = update_chapter_internal(
            &conn,
            "chapter-a' OR 1=1 --",
            UpdateChapterInput {
                volume_id: None,
                title: Some("injected".to_string()),
                outline: None,
                goal: None,
                order_index: None,
                status: None,
                target_word_count: None,
            },
            "after-injection",
        );
        assert!(injection_result.is_err());
        let untouched: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chapters WHERE title LIKE 'chapter-original-%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(untouched, 2);

        let injected_volume_id = "volume-b' OR 1=1 --";
        let volume_injection = update_chapter_internal(
            &conn,
            "chapter-a",
            UpdateChapterInput {
                volume_id: Some(injected_volume_id.to_string()),
                title: Some("must-not-apply".to_string()),
                outline: None,
                goal: None,
                order_index: Some(2),
                status: Some("editing".to_string()),
                target_word_count: Some(4500),
            },
            "after-volume-injection",
        );
        assert!(volume_injection.is_err());
        let unchanged_title: String = conn
            .query_row(
                "SELECT title FROM chapters WHERE id = 'chapter-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(unchanged_title, "chapter-original-a");

        let updated = update_chapter_internal(
            &conn,
            "chapter-a",
            UpdateChapterInput {
                volume_id: Some("volume-b".to_string()),
                title: Some("Editor's chapter".to_string()),
                outline: Some("The hero's choice".to_string()),
                goal: None,
                order_index: Some(2),
                status: Some("editing".to_string()),
                target_word_count: Some(4500),
            },
            "after-valid-update",
        )
        .unwrap();
        assert_eq!(updated.volume_id.as_deref(), Some("volume-b"));
        assert_eq!(updated.title, "Editor's chapter");
        assert_eq!(updated.outline.as_deref(), Some("The hero's choice"));
        assert_eq!(updated.status, "editing");
        assert_eq!(updated.target_word_count, Some(4500));
        let other_title: String = conn
            .query_row(
                "SELECT title FROM chapters WHERE id = 'chapter-b'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(other_title, "chapter-original-b");

        let invalid_status = update_chapter_internal(
            &conn,
            "chapter-a",
            UpdateChapterInput {
                volume_id: None,
                title: Some("must-not-apply".to_string()),
                outline: None,
                goal: None,
                order_index: None,
                status: Some("editing', title = 'injected".to_string()),
                target_word_count: None,
            },
            "after-invalid-status",
        )
        .unwrap_err();
        assert_eq!(invalid_status, "chapter_status_invalid");
        let title: String = conn
            .query_row(
                "SELECT title FROM chapters WHERE id = 'chapter-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(title, "Editor's chapter");
    }

    #[test]
    fn create_novel_command_returns_without_relocking_database_mutex() {
        crate::db::init_test_database();
        let (sender, receiver) = mpsc::channel();

        std::thread::spawn(move || {
            let result = create_novel(CreateNovelInput {
                title: "Mutex regression novel".to_string(),
                subtitle: None,
                description: None,
                outline: None,
                genre: None,
                target_word_count: None,
            });
            let _ = sender.send(result);
        });

        let result = receiver
            .recv_timeout(Duration::from_millis(300))
            .expect("create_novel timed out while re-locking the database mutex");
        assert!(result.is_ok(), "create_novel failed: {:?}", result.err());
    }

    #[test]
    fn update_novel_command_returns_without_relocking_database_mutex() {
        crate::db::init_test_database();
        let novel_id = format!("mutex-regression-{}", uuid::Uuid::new_v4());
        let now = chrono::Utc::now().to_rfc3339();
        {
            let conn = crate::db::get_connection()
                .lock()
                .expect("lock test database");
            conn.execute(
                "INSERT INTO novels (id, title, outline, status, total_word_count, protagonist_mode, protagonists_json, dual_protagonist_relation_json, main_character, protagonist_ability, created_at, updated_at) VALUES (?1, 'Before update', '', 'draft', 0, 'single', '[]', '{}', '', '', ?2, ?2)",
                params![&novel_id, &now],
            )
            .expect("seed novel");
        }

        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let result = update_novel(
                novel_id,
                UpdateNovelInput {
                    title: Some("After update".to_string()),
                    subtitle: None,
                    description: None,
                    outline: None,
                    genre: None,
                    status: None,
                    target_word_count: None,
                    current_volume_id: None,
                    current_chapter_id: None,
                    total_word_count: None,
                    protagonist_mode: None,
                    protagonists: None,
                    dual_protagonist_relation: None,
                    main_character: None,
                    protagonist_ability: None,
                },
            );
            let _ = sender.send(result);
        });

        let result = receiver
            .recv_timeout(Duration::from_millis(300))
            .expect("update_novel timed out while re-locking the database mutex")
            .expect("update_novel failed");
        assert_eq!(result.title, "After update");
    }

    fn create_runtime_ai_task_table(conn: &Connection) -> rusqlite::Result<()> {
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;

            CREATE TABLE ai_task_records (
                id TEXT PRIMARY KEY,
                task_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL
            );

            CREATE TABLE chapter_drafts (
                id TEXT PRIMARY KEY,
                ai_task_id TEXT,
                FOREIGN KEY (ai_task_id) REFERENCES ai_task_records(id)
            );

            CREATE TABLE quality_check_reports (
                id TEXT PRIMARY KEY,
                ai_task_id TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                FOREIGN KEY (ai_task_id) REFERENCES ai_task_records(id)
            );

            CREATE TABLE polish_records (
                id TEXT PRIMARY KEY,
                ai_task_id TEXT,
                FOREIGN KEY (ai_task_id) REFERENCES ai_task_records(id)
            );

            CREATE TABLE chapter_events (
                id TEXT PRIMARY KEY,
                ai_task_id TEXT
            );

            CREATE TABLE chapter_summaries (
                id TEXT PRIMARY KEY,
                ai_task_id TEXT
            );
            ",
        )
    }

    fn create_chapter_draft_test_schema(conn: &Connection) -> rusqlite::Result<()> {
        conn.execute_batch(
            "
            CREATE TABLE chapters (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                adopted_draft_id TEXT,
                word_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'not_started',
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );

            CREATE TABLE chapter_drafts (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                title TEXT,
                content TEXT NOT NULL,
                source TEXT NOT NULL,
                version_no INTEGER NOT NULL,
                word_count INTEGER NOT NULL,
                is_adopted INTEGER NOT NULL DEFAULT 0,
                ai_task_id TEXT,
                note TEXT,
                large_text_ref_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE chapter_summaries (
                id TEXT PRIMARY KEY,
                chapter_id TEXT NOT NULL,
                is_expired INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE context_records (
                id TEXT PRIMARY KEY,
                chapter_id TEXT NOT NULL,
                is_expired INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE memory_documents (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                adopted_draft_id TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                invalidated_at TEXT,
                invalidation_reason TEXT,
                updated_at TEXT NOT NULL
            );
            ",
        )
    }

    fn insert_test_chapter(
        conn: &Connection,
        id: &str,
        adopted_draft_id: Option<&str>,
        word_count: i64,
        status: &str,
    ) -> rusqlite::Result<()> {
        insert_test_chapter_for_novel(
            conn,
            id,
            "novel-1",
            adopted_draft_id,
            word_count,
            status,
            None,
        )
    }

    fn insert_test_chapter_for_novel(
        conn: &Connection,
        id: &str,
        novel_id: &str,
        adopted_draft_id: Option<&str>,
        word_count: i64,
        status: &str,
        deleted_at: Option<&str>,
    ) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO chapters (id, novel_id, adopted_draft_id, word_count, status, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, novel_id, adopted_draft_id, word_count, status, "before", deleted_at],
        )?;
        Ok(())
    }

    fn insert_test_draft(
        conn: &Connection,
        id: &str,
        chapter_id: &str,
        content: &str,
        is_adopted: bool,
    ) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO chapter_drafts (id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, created_at, updated_at) VALUES (?1, 'novel-1', ?2, NULL, ?3, 'user_edited', 1, ?4, ?5, 'before', 'before')",
            params![id, chapter_id, content, count_words(content), i64::from(is_adopted)],
        )?;
        Ok(())
    }

    fn attach_test_large_text(
        conn: &Connection,
        document_id: &str,
        draft_id: &str,
    ) -> rusqlite::Result<()> {
        crate::large_text_save::create_large_text_tables(conn)?;
        conn.execute(
            "INSERT INTO large_text_documents (id, target_type, target_id, field_name, total_chars, total_bytes, chunk_count, content_sha256, created_at, updated_at) VALUES (?1, 'draft', ?2, 'content', 4, 4, 1, 'test-hash', 'before', 'before')",
            params![document_id, draft_id],
        )?;
        conn.execute(
            "INSERT INTO large_text_chunks (document_id, chunk_index, content, char_count, byte_count, chunk_sha256, created_at) VALUES (?1, 0, 'text', 4, 4, 'test-hash', 'before')",
            params![document_id],
        )?;
        conn.execute(
            "UPDATE chapter_drafts SET large_text_ref_id = ?1 WHERE id = ?2",
            params![document_id, draft_id],
        )?;
        Ok(())
    }

    fn get_test_draft_adopted(conn: &Connection, id: &str) -> rusqlite::Result<i64> {
        conn.query_row(
            "SELECT is_adopted FROM chapter_drafts WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
    }

    fn get_test_chapter_state(
        conn: &Connection,
        id: &str,
    ) -> rusqlite::Result<(Option<String>, i64, String, String)> {
        conn.query_row(
            "SELECT adopted_draft_id, word_count, status, updated_at FROM chapters WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
    }

    fn insert_test_chapter_context(conn: &Connection, chapter_id: &str) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO chapter_summaries (id, chapter_id, is_expired, updated_at)
             VALUES (?1, ?2, 0, 'before')",
            params![format!("summary-{chapter_id}"), chapter_id],
        )?;
        conn.execute(
            "INSERT INTO context_records (id, chapter_id, is_expired, updated_at)
             VALUES (?1, ?2, 0, 'before')",
            params![format!("context-{chapter_id}"), chapter_id],
        )?;
        Ok(())
    }

    fn get_test_chapter_context_expired(
        conn: &Connection,
        chapter_id: &str,
    ) -> rusqlite::Result<(i64, i64)> {
        conn.query_row(
            "SELECT
                (SELECT is_expired FROM chapter_summaries WHERE chapter_id = ?1),
                (SELECT is_expired FROM context_records WHERE chapter_id = ?1)",
            params![chapter_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    }

    #[test]
    fn db01_adopt_missing_draft_preserves_existing_adoption(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", Some("draft-a-old"), 3, "adopted")?;
        insert_test_draft(&conn, "draft-a-old", "chapter-a", "旧正文", true)?;

        let error = adopt_chapter_draft_internal(&mut conn, "missing-draft", "chapter-a")
            .expect_err("missing draft must be rejected");

        assert!(error.starts_with("target_not_found:"), "{error}");
        assert_eq!(get_test_draft_adopted(&conn, "draft-a-old")?, 1);
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-a")?.0.as_deref(),
            Some("draft-a-old")
        );
        Ok(())
    }

    #[test]
    fn db02_adopt_cross_chapter_draft_preserves_both_chapters(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", Some("draft-a"), 3, "adopted")?;
        insert_test_chapter(&conn, "chapter-b", Some("draft-b"), 3, "adopted")?;
        insert_test_draft(&conn, "draft-a", "chapter-a", "甲正文", true)?;
        insert_test_draft(&conn, "draft-b", "chapter-b", "乙正文", true)?;

        let error = adopt_chapter_draft_internal(&mut conn, "draft-b", "chapter-a")
            .expect_err("cross-chapter draft must be rejected");

        assert!(error.starts_with("target_mismatch:"), "{error}");
        assert_eq!(get_test_draft_adopted(&conn, "draft-a")?, 1);
        assert_eq!(get_test_draft_adopted(&conn, "draft-b")?, 1);
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-a")?.0.as_deref(),
            Some("draft-a")
        );
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-b")?.0.as_deref(),
            Some("draft-b")
        );
        Ok(())
    }

    #[test]
    fn adopt_rejects_corrupted_large_text_without_changing_chapter(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", None, 0, "editing")?;
        insert_test_draft(&conn, "draft-a", "chapter-a", "preview", false)?;
        attach_test_large_text(&conn, "document-a", "draft-a")?;

        let error = adopt_chapter_draft_internal(&mut conn, "draft-a", "chapter-a")
            .expect_err("corrupted large text must not be adopted");

        assert!(
            error.starts_with("adopt_large_text_read_failed:"),
            "{error}"
        );
        assert_eq!(get_test_draft_adopted(&conn, "draft-a")?, 0);
        let chapter = get_test_chapter_state(&conn, "chapter-a")?;
        assert!(chapter.0.is_none());
        assert_eq!(chapter.1, 0);
        assert_eq!(chapter.2, "editing");
        Ok(())
    }

    #[test]
    fn db03_update_zero_rows_returns_conflict_and_preserves_content(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", None, 0, "editing")?;
        insert_test_chapter(&conn, "chapter-b", None, 0, "editing")?;
        insert_test_draft(&conn, "draft-b", "chapter-b", "原正文", false)?;

        let error = update_chapter_draft_internal(
            &conn,
            "draft-b",
            "chapter-a",
            "错误覆盖",
            Some("user_edited"),
            None,
        )
        .expect_err("zero-row update must be rejected");

        assert!(error.starts_with("draft_update_conflict:"), "{error}");
        let missing_error = update_chapter_draft_internal(
            &conn,
            "missing-draft",
            "chapter-a",
            "错误覆盖",
            Some("user_edited"),
            None,
        )
        .expect_err("missing draft update must be rejected");
        assert!(
            missing_error.starts_with("draft_update_conflict:"),
            "{missing_error}"
        );
        let content: String = conn.query_row(
            "SELECT content FROM chapter_drafts WHERE id = 'draft-b'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(content, "原正文");
        Ok(())
    }

    #[test]
    fn updating_large_text_draft_to_small_text_removes_old_document(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", None, 0, "editing")?;
        insert_test_draft(&conn, "draft-a", "chapter-a", "preview", false)?;
        attach_test_large_text(&conn, "document-a", "draft-a")?;

        let updated = update_chapter_draft_with_cleanup_internal(
            &mut conn,
            "draft-a",
            "chapter-a",
            "small replacement",
            Some("user_edited"),
            None,
        )?;

        assert_eq!(updated.content, "small replacement");
        assert!(updated.large_text_ref_id.is_none());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM large_text_documents", [], |row| row
                .get::<_, i64>(
                0
            ))?,
            0
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM large_text_chunks", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        Ok(())
    }

    #[test]
    fn deleting_large_text_draft_removes_old_document() -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", None, 0, "editing")?;
        insert_test_draft(&conn, "draft-a", "chapter-a", "preview", false)?;
        attach_test_large_text(&conn, "document-a", "draft-a")?;

        delete_chapter_draft_internal(&mut conn, "draft-a", "chapter-a")?;

        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM chapter_drafts", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM large_text_documents", [], |row| row
                .get::<_, i64>(
                0
            ))?,
            0
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM large_text_chunks", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        Ok(())
    }

    #[test]
    fn update_rejects_cross_novel_and_soft_deleted_chapters(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter_for_novel(
            &conn,
            "chapter-cross-novel",
            "novel-2",
            None,
            0,
            "editing",
            None,
        )?;
        insert_test_draft(
            &conn,
            "draft-cross-novel",
            "chapter-cross-novel",
            "跨小说原文",
            false,
        )?;
        insert_test_chapter_for_novel(
            &conn,
            "chapter-deleted",
            "novel-1",
            None,
            0,
            "editing",
            Some("2026-07-11T00:00:00Z"),
        )?;
        insert_test_draft(
            &conn,
            "draft-deleted",
            "chapter-deleted",
            "已删除章节原文",
            false,
        )?;

        let cross_novel_error = update_chapter_draft_internal(
            &conn,
            "draft-cross-novel",
            "chapter-cross-novel",
            "不应写入",
            Some("user_edited"),
            None,
        )
        .expect_err("cross-novel draft/chapter pair must be rejected");
        assert!(
            cross_novel_error.starts_with("draft_update_conflict:"),
            "{cross_novel_error}"
        );

        let deleted_error = update_chapter_draft_internal(
            &conn,
            "draft-deleted",
            "chapter-deleted",
            "不应写入",
            Some("user_edited"),
            None,
        )
        .expect_err("soft-deleted chapter must be rejected");
        assert!(
            deleted_error.starts_with("draft_update_conflict:"),
            "{deleted_error}"
        );

        let cross_novel_content: String = conn.query_row(
            "SELECT content FROM chapter_drafts WHERE id = 'draft-cross-novel'",
            [],
            |row| row.get(0),
        )?;
        let deleted_content: String = conn.query_row(
            "SELECT content FROM chapter_drafts WHERE id = 'draft-deleted'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(cross_novel_content, "跨小说原文");
        assert_eq!(deleted_content, "已删除章节原文");
        Ok(())
    }

    #[test]
    fn adopt_rejects_cross_novel_target_without_changes() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter_for_novel(
            &conn,
            "chapter-cross-novel",
            "novel-2",
            Some("draft-old"),
            3,
            "adopted",
            None,
        )?;
        insert_test_draft(&conn, "draft-old", "chapter-cross-novel", "旧正文", true)?;
        insert_test_draft(&conn, "draft-new", "chapter-cross-novel", "新正文", false)?;

        let error = adopt_chapter_draft_internal(&mut conn, "draft-new", "chapter-cross-novel")
            .expect_err("cross-novel draft/chapter pair must be rejected");

        assert!(error.starts_with("target_mismatch:"), "{error}");
        assert_eq!(get_test_draft_adopted(&conn, "draft-old")?, 1);
        assert_eq!(get_test_draft_adopted(&conn, "draft-new")?, 0);
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-cross-novel")?
                .0
                .as_deref(),
            Some("draft-old")
        );
        Ok(())
    }

    #[test]
    fn adopt_rejects_soft_deleted_chapter_without_changes() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter_for_novel(
            &conn,
            "chapter-deleted",
            "novel-1",
            Some("draft-old"),
            3,
            "adopted",
            Some("2026-07-11T00:00:00Z"),
        )?;
        insert_test_draft(&conn, "draft-old", "chapter-deleted", "旧正文", true)?;
        insert_test_draft(&conn, "draft-new", "chapter-deleted", "新正文", false)?;

        let error = adopt_chapter_draft_internal(&mut conn, "draft-new", "chapter-deleted")
            .expect_err("soft-deleted chapter must be rejected");

        assert!(error.starts_with("target_deleted:"), "{error}");
        assert_eq!(get_test_draft_adopted(&conn, "draft-old")?, 1);
        assert_eq!(get_test_draft_adopted(&conn, "draft-new")?, 0);
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-deleted")?
                .0
                .as_deref(),
            Some("draft-old")
        );
        Ok(())
    }

    #[test]
    fn atomic_save_commit_before_adoption_keeps_one_authoritative_draft(
    ) -> Result<(), Box<dyn std::error::Error>> {
        use crate::repositories::large_text_repository;
        use crate::services::draft_service::{
            save_chapter_draft_atomic_with_cleanup, SaveChapterDraftAtomicInput,
            SaveChapterDraftDisposition,
        };

        let mut conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE novels (
                 id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL, deleted_at TEXT
             );
             CREATE TABLE chapters (
                 id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, title TEXT NOT NULL,
                 adopted_draft_id TEXT, word_count INTEGER NOT NULL DEFAULT 0,
                 status TEXT NOT NULL DEFAULT 'editing', created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL, deleted_at TEXT
             );
             CREATE TABLE ai_task_records (id TEXT PRIMARY KEY);
             CREATE TABLE chapter_drafts (
                 id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
                 title TEXT, content TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
                 version_no INTEGER NOT NULL, word_count INTEGER NOT NULL DEFAULT 0,
                 is_adopted INTEGER NOT NULL DEFAULT 0, ai_task_id TEXT, note TEXT,
                 large_text_ref_id TEXT, content_hash TEXT, created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE TABLE chapter_summaries (
                 id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL,
                 is_expired INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
             );
             CREATE TABLE context_records (
                 id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL,
                 is_expired INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
             );
             INSERT INTO novels (id, title, created_at, updated_at)
             VALUES ('novel-a', 'Novel A', 'now', 'now');
             INSERT INTO chapters
                 (id, novel_id, title, adopted_draft_id, word_count, status, created_at, updated_at)
             VALUES ('chapter-a', 'novel-a', 'Chapter A', NULL, 0, 'editing', 'now', 'now');",
        )?;
        crate::migrations::run_migrations(&mut conn)?;
        let base_content = "保存前正文";
        let base_hash = large_text_repository::sha256(base_content);
        conn.execute(
            "INSERT INTO chapter_drafts
                 (id, novel_id, chapter_id, title, content, source, version_no, word_count,
                  is_adopted, content_hash, created_at, updated_at)
             VALUES ('draft-a', 'novel-a', 'chapter-a', 'Draft', ?1, 'user_edited', 1,
                     5, 0, ?2, 'now', 'now')",
            params![base_content, base_hash],
        )?;
        let saved_content = "保存先提交、随后采用的正文".to_string();
        let saved_hash = large_text_repository::sha256(&saved_content);
        let save = save_chapter_draft_atomic_with_cleanup(
            &mut conn,
            SaveChapterDraftAtomicInput {
                operation_id: "op-save-before-adopt".to_string(),
                trace_id: Some("trace-save-before-adopt".to_string()),
                novel_id: "novel-a".to_string(),
                chapter_id: "chapter-a".to_string(),
                draft_id: Some("draft-a".to_string()),
                draft_version: Some(1),
                base_content_hash: Some(base_hash),
                current_content_hash: saved_hash,
                content: saved_content.clone(),
                word_count: None,
                source: "user_edited".to_string(),
                title: Some("Draft".to_string()),
                ai_task_id: None,
                note: None,
                staging_session_id: None,
            },
            || Ok(()),
        )?;

        assert_eq!(
            save.disposition,
            SaveChapterDraftDisposition::UpdatedExisting
        );
        assert_eq!(save.draft.id, "draft-a");
        assert!(!save.draft.is_adopted);
        let adopted = adopt_chapter_draft_internal(&mut conn, &save.draft.id, "chapter-a")?;

        assert_eq!(adopted.id, save.draft.id);
        assert_eq!(adopted.content, saved_content);
        assert!(adopted.is_adopted);
        let (draft_count, adopted_count): (i64, i64) = conn.query_row(
            "SELECT COUNT(*), SUM(CASE WHEN is_adopted = 1 THEN 1 ELSE 0 END)
             FROM chapter_drafts WHERE chapter_id = 'chapter-a'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!((draft_count, adopted_count), (1, 1));
        let chapter = get_test_chapter_state(&conn, "chapter-a")?;
        assert_eq!(chapter.0.as_deref(), Some("draft-a"));
        assert_eq!(chapter.1, count_words(&saved_content));
        assert_eq!(chapter.2, "adopted");
        let (operation_draft_id, operation_status): (String, String) = conn.query_row(
            "SELECT draft_id, status FROM draft_save_operations
             WHERE operation_id = 'op-save-before-adopt'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(operation_draft_id, "draft-a");
        assert_eq!(operation_status, "completed");
        Ok(())
    }

    #[test]
    fn adopt_chapter_draft_updates_pointer_and_chapter_metadata(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", Some("draft-old"), 3, "editing")?;
        insert_test_draft(&conn, "draft-old", "chapter-a", "旧正文", true)?;
        insert_test_draft(&conn, "draft-new", "chapter-a", "新的正式正文", false)?;

        let adopted = adopt_chapter_draft_internal(&mut conn, "draft-new", "chapter-a")?;

        assert_eq!(adopted.id, "draft-new");
        assert_eq!(adopted.chapter_id, "chapter-a");
        assert!(adopted.is_adopted);
        assert_eq!(get_test_draft_adopted(&conn, "draft-old")?, 0);
        assert_eq!(get_test_draft_adopted(&conn, "draft-new")?, 1);
        let adopted_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM chapter_drafts WHERE chapter_id = 'chapter-a' AND is_adopted = 1",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(adopted_count, 1);
        let chapter = get_test_chapter_state(&conn, "chapter-a")?;
        assert_eq!(chapter.0.as_deref(), Some("draft-new"));
        assert_eq!(chapter.1, count_words("新的正式正文"));
        assert_eq!(chapter.2, "adopted");
        assert_ne!(chapter.3, "before");
        Ok(())
    }

    #[test]
    fn adopting_different_draft_expires_summary_and_context_atomically(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", Some("draft-old"), 3, "adopted")?;
        insert_test_draft(&conn, "draft-old", "chapter-a", "old body", true)?;
        insert_test_draft(&conn, "draft-new", "chapter-a", "new body", false)?;
        insert_test_chapter_context(&conn, "chapter-a")?;

        adopt_chapter_draft_internal(&mut conn, "draft-new", "chapter-a")?;

        assert_eq!(get_test_draft_adopted(&conn, "draft-old")?, 0);
        assert_eq!(get_test_draft_adopted(&conn, "draft-new")?, 1);
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-a")?.0.as_deref(),
            Some("draft-new")
        );
        assert_eq!(
            get_test_chapter_context_expired(&conn, "chapter-a")?,
            (1, 1)
        );
        Ok(())
    }

    #[test]
    fn adopting_different_draft_invalidates_old_memory_atomically(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", Some("draft-old"), 3, "adopted")?;
        insert_test_draft(&conn, "draft-old", "chapter-a", "old body", true)?;
        insert_test_draft(&conn, "draft-new", "chapter-a", "new body", false)?;
        conn.execute(
            "INSERT INTO memory_documents
                (id, novel_id, chapter_id, adopted_draft_id, status, updated_at)
             VALUES ('memory-old', 'novel-1', 'chapter-a', 'draft-old', 'active', 'before')",
            [],
        )?;

        adopt_chapter_draft_internal(&mut conn, "draft-new", "chapter-a")?;

        let memory: (String, Option<String>) = conn.query_row(
            "SELECT status, invalidation_reason FROM memory_documents WHERE id = 'memory-old'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(memory.0, "invalidated");
        assert_eq!(memory.1.as_deref(), Some("adopted_draft_changed"));
        Ok(())
    }

    #[test]
    fn memory_invalidation_failure_rolls_back_adoption() -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", Some("draft-old"), 3, "adopted")?;
        insert_test_draft(&conn, "draft-old", "chapter-a", "old body", true)?;
        insert_test_draft(&conn, "draft-new", "chapter-a", "new body", false)?;
        conn.execute(
            "INSERT INTO memory_documents
                (id, novel_id, chapter_id, adopted_draft_id, status, updated_at)
             VALUES ('memory-old', 'novel-1', 'chapter-a', 'draft-old', 'active', 'before')",
            [],
        )?;
        conn.execute_batch(
            "CREATE TRIGGER fail_memory_invalidation
             BEFORE UPDATE OF status ON memory_documents
             BEGIN SELECT RAISE(ABORT, 'forced memory failure'); END;",
        )?;

        let error = adopt_chapter_draft_internal(&mut conn, "draft-new", "chapter-a")
            .expect_err("memory invalidation failure must roll back adoption");

        assert!(
            error.starts_with("adopt_memory_invalidation_failed:"),
            "{error}"
        );
        assert_eq!(get_test_draft_adopted(&conn, "draft-old")?, 1);
        assert_eq!(get_test_draft_adopted(&conn, "draft-new")?, 0);
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-a")?.0.as_deref(),
            Some("draft-old")
        );
        let status: String = conn.query_row(
            "SELECT status FROM memory_documents WHERE id = 'memory-old'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(status, "active");
        Ok(())
    }

    #[test]
    fn readopting_same_draft_keeps_summary_and_context_valid(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", Some("draft-current"), 3, "adopted")?;
        insert_test_draft(&conn, "draft-current", "chapter-a", "same body", true)?;
        insert_test_chapter_context(&conn, "chapter-a")?;
        conn.execute_batch(
            "CREATE TRIGGER reject_unexpected_context_expiration
             BEFORE UPDATE OF is_expired ON context_records
             BEGIN SELECT RAISE(ABORT, 'same draft must not expire context'); END;",
        )?;

        adopt_chapter_draft_internal(&mut conn, "draft-current", "chapter-a")?;

        assert_eq!(get_test_draft_adopted(&conn, "draft-current")?, 1);
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-a")?.0.as_deref(),
            Some("draft-current")
        );
        assert_eq!(
            get_test_chapter_context_expired(&conn, "chapter-a")?,
            (0, 0)
        );
        Ok(())
    }

    #[test]
    fn adoption_and_context_expiration_roll_back_together_on_failure(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", Some("draft-old"), 3, "adopted")?;
        insert_test_draft(&conn, "draft-old", "chapter-a", "old body", true)?;
        insert_test_draft(&conn, "draft-new", "chapter-a", "new body", false)?;
        insert_test_chapter_context(&conn, "chapter-a")?;
        conn.execute_batch(
            "CREATE TRIGGER fail_context_expiration_during_adoption
             BEFORE UPDATE OF is_expired ON context_records WHEN NEW.is_expired = 1
             BEGIN SELECT RAISE(ABORT, 'forced context expiration failure'); END;",
        )?;

        let error = adopt_chapter_draft_internal(&mut conn, "draft-new", "chapter-a")
            .expect_err("context expiration failure must roll back adoption");

        assert!(
            error.starts_with("chapter_context_records_expire_failed:"),
            "{error}"
        );
        assert_eq!(get_test_draft_adopted(&conn, "draft-old")?, 1);
        assert_eq!(get_test_draft_adopted(&conn, "draft-new")?, 0);
        let chapter = get_test_chapter_state(&conn, "chapter-a")?;
        assert_eq!(chapter.0.as_deref(), Some("draft-old"));
        assert_eq!(chapter.1, 3);
        assert_eq!(chapter.2, "adopted");
        assert_eq!(chapter.3, "before");
        assert_eq!(
            get_test_chapter_context_expired(&conn, "chapter-a")?,
            (0, 0)
        );
        Ok(())
    }

    #[test]
    fn adopt_chapter_draft_rolls_back_when_chapter_update_fails(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(
            &conn,
            "chapter-a",
            Some("draft-old"),
            count_words("旧正文"),
            "adopted",
        )?;
        insert_test_draft(&conn, "draft-old", "chapter-a", "旧正文", true)?;
        insert_test_draft(&conn, "draft-new", "chapter-a", "新正文", false)?;
        conn.execute_batch(
            "
            CREATE TRIGGER fail_chapter_adoption
            BEFORE UPDATE OF adopted_draft_id ON chapters
            BEGIN
                SELECT RAISE(ABORT, 'forced chapter update failure');
            END;
            ",
        )?;

        let error = adopt_chapter_draft_internal(&mut conn, "draft-new", "chapter-a")
            .expect_err("chapter update failure must roll back the draft updates");

        assert!(error.starts_with("adopt_chapter_update_failed:"), "{error}");
        assert_eq!(get_test_draft_adopted(&conn, "draft-old")?, 1);
        assert_eq!(get_test_draft_adopted(&conn, "draft-new")?, 0);
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-a")?.0.as_deref(),
            Some("draft-old")
        );
        Ok(())
    }

    fn insert_runtime_ai_task(conn: &Connection, id: &str) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO ai_task_records (id, task_type, status, created_at) VALUES (?1, 'connection_test', 'succeeded', ?2)",
            params![id, chrono::Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    fn insert_runtime_ai_task_children(
        conn: &Connection,
        task_id: &str,
        row_prefix: &str,
    ) -> rusqlite::Result<()> {
        for table in RUNTIME_AI_TASK_CHILD_TABLES {
            let sql = format!("INSERT INTO {} (id, ai_task_id) VALUES (?1, ?2)", table);
            let row_id = format!("{}-{}", row_prefix, table);
            conn.execute(&sql, params![row_id, task_id])?;
        }
        Ok(())
    }

    fn count_runtime_ai_task_child_refs(conn: &Connection, task_id: &str) -> rusqlite::Result<i64> {
        let mut count = 0;
        for table in RUNTIME_AI_TASK_CHILD_TABLES {
            let sql = format!("SELECT COUNT(*) FROM {} WHERE ai_task_id = ?1", table);
            count += conn.query_row(&sql, params![task_id], |row| row.get::<_, i64>(0))?;
        }
        Ok(count)
    }

    fn count_runtime_ai_task_child_rows(conn: &Connection) -> rusqlite::Result<i64> {
        let mut count = 0;
        for table in RUNTIME_AI_TASK_CHILD_TABLES {
            let sql = format!("SELECT COUNT(*) FROM {}", table);
            count += conn.query_row(&sql, [], |row| row.get::<_, i64>(0))?;
        }
        Ok(count)
    }

    fn assert_runtime_child_cleanup(
        result: &DeleteAiTaskRecordsResult,
        expected_rows_per_table: i64,
    ) {
        for table in RUNTIME_AI_TASK_CHILD_TABLES {
            assert_eq!(
                result.deleted_child_rows.get(table),
                Some(&expected_rows_per_table),
                "child cleanup count must be reported for {}",
                table
            );
        }
    }

    fn create_task_recovery_test_schema(conn: &Connection) -> rusqlite::Result<()> {
        conn.execute_batch(
            "
            CREATE TABLE generation_jobs (
                id TEXT PRIMARY KEY,
                world_id TEXT,
                novel_id TEXT NOT NULL DEFAULT 'novel-1',
                volume_id TEXT,
                chapter_id TEXT NOT NULL DEFAULT 'chapter-1',
                job_type TEXT NOT NULL DEFAULT 'chapter_generation',
                status TEXT NOT NULL,
                current_step TEXT,
                progress_percent INTEGER NOT NULL DEFAULT 0,
                provider TEXT,
                model_name TEXT,
                input_token_estimate INTEGER,
                output_token_estimate INTEGER,
                actual_input_tokens INTEGER,
                actual_output_tokens INTEGER,
                cost_estimate REAL,
                error_code TEXT,
                error_message TEXT,
                retry_count INTEGER NOT NULL DEFAULT 0,
                finished_at TEXT,
                created_at TEXT NOT NULL,
                started_at TEXT
            );

            CREATE TABLE generation_step_results (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                step_name TEXT NOT NULL,
                status TEXT NOT NULL,
                input_snapshot_json TEXT,
                output_json TEXT,
                output_text TEXT,
                error_message TEXT,
                created_at TEXT NOT NULL
            );

            ",
        )
    }

    fn generation_job_update_input(id: &str) -> UpdateGenerationJobInput {
        UpdateGenerationJobInput {
            id: id.to_string(),
            status: None,
            current_step: None,
            progress_percent: None,
            provider: None,
            model_name: None,
            input_token_estimate: None,
            output_token_estimate: None,
            actual_input_tokens: None,
            actual_output_tokens: None,
            cost_estimate: None,
            error_code: None,
            error_message: None,
            retry_count: None,
            started_at: None,
            finished_at: None,
        }
    }

    #[test]
    fn generation_job_updates_reject_terminal_revival_and_progress_regression(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        create_task_recovery_test_schema(&conn)?;
        conn.execute_batch(
            "
            INSERT INTO generation_jobs (id, status, current_step, progress_percent, created_at) VALUES
                ('job-running', 'running', 'draft_generation', 40, '2026-01-01T00:00:00Z'),
                ('job-pending', 'pending', NULL, 0, '2026-01-01T00:00:01Z'),
                ('job-cancelled', 'cancelled', 'quality_check', 82, '2026-01-01T00:00:02Z'),
                ('job-retrying', 'retrying', 'draft_generation', 72, '2026-01-01T00:00:03Z');
            ",
        )?;

        let mut running = generation_job_update_input("job-running");
        running.status = Some("running".to_string());
        running.current_step = Some("quality_check".to_string());
        running.progress_percent = Some(82);
        let updated = update_generation_job_internal(&conn, &running)?;
        assert_eq!(updated.status, "running");
        assert_eq!(updated.progress_percent, 82);

        let mut regression = generation_job_update_input("job-running");
        regression.progress_percent = Some(72);
        let regression_error = update_generation_job_internal(&conn, &regression)
            .expect_err("progress must never move backwards");
        assert!(regression_error.starts_with("generation_job_progress_regression:"));

        let mut complete = generation_job_update_input("job-running");
        complete.status = Some("completed".to_string());
        complete.progress_percent = Some(100);
        complete.finished_at = Some("2026-01-01T00:01:00Z".to_string());
        let completed = update_generation_job_internal(&conn, &complete)?;
        assert_eq!(completed.status, "completed");

        let mut revive = generation_job_update_input("job-running");
        revive.status = Some("running".to_string());
        let terminal_error = update_generation_job_internal(&conn, &revive)
            .expect_err("completed task must be immutable");
        assert!(terminal_error.starts_with("generation_job_terminal:"));

        let mut cancelled_to_completed = generation_job_update_input("job-cancelled");
        cancelled_to_completed.status = Some("completed".to_string());
        assert!(
            update_generation_job_internal(&conn, &cancelled_to_completed)
                .expect_err("cancelled task must win over a late completion")
                .starts_with("generation_job_terminal:")
        );

        let mut skip_running = generation_job_update_input("job-pending");
        skip_running.status = Some("completed".to_string());
        assert!(update_generation_job_internal(&conn, &skip_running)
            .expect_err("pending task cannot jump straight to completed")
            .starts_with("generation_job_invalid_transition:"));

        let mut retry = generation_job_update_input("job-retrying");
        retry.status = Some("running".to_string());
        retry.progress_percent = Some(72);
        assert_eq!(
            update_generation_job_internal(&conn, &retry)?.status,
            "running"
        );
        Ok(())
    }

    #[test]
    fn generation_step_ids_are_immutable_and_ordering_is_deterministic(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_task_recovery_test_schema(&conn)?;
        conn.execute(
            "INSERT INTO generation_jobs (id, status, current_step, progress_percent, created_at) VALUES ('job-1', 'running', 'draft_generation', 72, '2026-01-01T00:00:00Z')",
            [],
        )?;
        let first = SaveGenerationStepResultInput {
            id: "step-a".to_string(),
            job_id: "job-1".to_string(),
            step_name: "draft_generation".to_string(),
            status: "succeeded".to_string(),
            input_snapshot_json: None,
            output_json: None,
            output_text: Some("first".to_string()),
            error_message: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
        };
        save_generation_step_result_internal(&mut conn, &first)?;

        let mut duplicate = SaveGenerationStepResultInput {
            output_text: Some("overwritten".to_string()),
            ..first
        };
        let duplicate_error = save_generation_step_result_internal(&mut conn, &duplicate)
            .expect_err("a step id must not overwrite an existing checkpoint");
        assert!(duplicate_error.contains("UNIQUE constraint failed"));
        duplicate.id = "step-b".to_string();
        save_generation_step_result_internal(&mut conn, &duplicate)?;

        let steps = get_generation_step_results_internal(&conn, "job-1")?;
        assert_eq!(
            steps
                .iter()
                .map(|step| step.id.as_str())
                .collect::<Vec<_>>(),
            vec!["step-a", "step-b"]
        );
        assert_eq!(steps[0].output_text.as_deref(), Some("first"));
        Ok(())
    }

    #[test]
    fn generation_job_cancellation_is_atomic_and_rejects_late_success_steps(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_task_recovery_test_schema(&conn)?;
        conn.execute(
            "INSERT INTO generation_jobs (id, status, current_step, progress_percent, created_at) VALUES ('job-cancel-race', 'running', 'draft_generation', 72, '2026-01-01T00:00:00Z')",
            [],
        )?;

        let cancelled =
            cancel_generation_job_internal(&mut conn, "job-cancel-race", "2026-01-01T00:01:00Z")?
                .expect("running job should be cancelled");
        assert_eq!(cancelled.status, "cancelled");
        let cancelled_steps = get_generation_step_results_internal(&conn, "job-cancel-race")?;
        assert_eq!(cancelled_steps.len(), 1);
        assert_eq!(cancelled_steps[0].status, "cancelled");
        assert_eq!(cancelled_steps[0].step_name, "draft_generation");

        cancel_generation_job_internal(&mut conn, "job-cancel-race", "2026-01-01T00:02:00Z")?;
        assert_eq!(
            get_generation_step_results_internal(&conn, "job-cancel-race")?.len(),
            1,
            "repeated cancellation must not add another checkpoint"
        );

        let late_success = SaveGenerationStepResultInput {
            id: "step-late-success".to_string(),
            job_id: "job-cancel-race".to_string(),
            step_name: "draft_generation".to_string(),
            status: "succeeded".to_string(),
            input_snapshot_json: None,
            output_json: Some(r#"{"late":true}"#.to_string()),
            output_text: Some("late output".to_string()),
            error_message: None,
            created_at: "2026-01-01T00:03:00Z".to_string(),
        };
        let error = save_generation_step_result_internal(&mut conn, &late_success)
            .expect_err("terminal parent must reject a late success checkpoint");
        assert!(error.starts_with("generation_step_parent_terminal:"));
        assert_eq!(
            get_generation_step_results_internal(&conn, "job-cancel-race")?.len(),
            1
        );
        Ok(())
    }

    #[test]
    fn startup_task_recovery_is_atomic_and_idempotent() -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_task_recovery_test_schema(&conn)?;
        conn.execute_batch(
            "
            INSERT INTO generation_jobs (id, status, current_step, progress_percent, created_at) VALUES
                ('job-pending', 'pending', NULL, 0, '2026-01-01T00:00:00Z'),
                ('job-running', 'running', 'draft_generation', 72, '2026-01-01T00:00:01Z'),
                ('job-retrying', 'retrying', 'quality_check', 82, '2026-01-01T00:00:02Z'),
                ('job-completed', 'completed', 'save_version', 100, '2026-01-01T00:00:03Z');
            INSERT INTO generation_step_results (id, job_id, step_name, status, output_text, created_at)
                VALUES ('step-existing', 'job-running', 'compile_context', 'succeeded', 'checkpoint', '2026-01-01T00:00:04Z');
            ",
        )?;

        let recovered_at = "2026-07-21T08:00:00Z";
        let result = recover_interrupted_generation_jobs_internal(&mut conn, recovered_at)?;
        assert_eq!(result.recovered_jobs, 3);
        assert_eq!(result.recovered_at, recovered_at);

        for job_id in ["job-pending", "job-running", "job-retrying"] {
            let state: (String, Option<String>, Option<String>, Option<String>) = conn.query_row(
                "SELECT status, error_code, error_message, finished_at FROM generation_jobs WHERE id = ?1",
                params![job_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )?;
            assert_eq!(state.0, "failed");
            assert_eq!(state.1.as_deref(), Some(STARTUP_RECOVERY_ERROR_CODE));
            assert_eq!(state.2.as_deref(), Some(STARTUP_RECOVERY_MESSAGE));
            assert_eq!(state.3.as_deref(), Some(recovered_at));
        }
        let completed: (String, Option<String>) = conn.query_row(
            "SELECT status, error_code FROM generation_jobs WHERE id = 'job-completed'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(completed, ("completed".to_string(), None));
        let preserved_progress: i64 = conn.query_row(
            "SELECT progress_percent FROM generation_jobs WHERE id = 'job-running'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(preserved_progress, 72);

        let recovery_steps: i64 = conn.query_row(
            "SELECT COUNT(*) FROM generation_step_results WHERE status = 'failed'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(recovery_steps, 3);
        let all_steps: i64 =
            conn.query_row("SELECT COUNT(*) FROM generation_step_results", [], |row| {
                row.get(0)
            })?;
        assert_eq!(all_steps, 4);
        let recovery_json: String = conn.query_row(
            "SELECT output_json FROM generation_step_results WHERE job_id = 'job-running' AND status = 'failed'",
            [],
            |row| row.get(0),
        )?;
        let recovery_json: serde_json::Value = serde_json::from_str(&recovery_json)?;
        assert_eq!(recovery_json["previousStatus"], "running");
        assert_eq!(recovery_json["preservedProgressPercent"], 72);

        let second = recover_interrupted_generation_jobs_internal(&mut conn, recovered_at)?;
        assert_eq!(second.recovered_jobs, 0);
        let steps_after_second_start: i64 =
            conn.query_row("SELECT COUNT(*) FROM generation_step_results", [], |row| {
                row.get(0)
            })?;
        assert_eq!(steps_after_second_start, 4);
        Ok(())
    }

    #[test]
    fn startup_task_recovery_rolls_back_when_checkpoint_insert_fails(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_task_recovery_test_schema(&conn)?;
        conn.execute_batch(
            "
            INSERT INTO generation_jobs (id, status, current_step, progress_percent, created_at)
                VALUES ('job-running', 'running', 'draft_generation', 72, '2026-01-01T00:00:00Z');
            CREATE TRIGGER fail_recovery_checkpoint
            BEFORE INSERT ON generation_step_results
            BEGIN
                SELECT RAISE(ABORT, 'forced recovery checkpoint failure');
            END;
            ",
        )?;

        let error = recover_interrupted_generation_jobs_internal(&mut conn, "2026-07-21T08:00:00Z")
            .expect_err("checkpoint failure must roll back every task transition");
        assert!(
            error.starts_with("task_recovery_checkpoint_insert_failed:"),
            "{error}"
        );
        let job_status: String = conn.query_row(
            "SELECT status FROM generation_jobs WHERE id = 'job-running'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(job_status, "running");
        Ok(())
    }

    #[test]
    fn ai_task_delete_runtime_insert_list_delete_clear() -> Result<(), Box<dyn std::error::Error>> {
        let db_path = std::env::temp_dir().join(format!(
            "ai-novel-studio-ai-task-delete-runtime-{}.db",
            uuid::Uuid::new_v4()
        ));
        let db_path_text = db_path.display().to_string();
        let conn = Connection::open(&db_path)?;
        create_runtime_ai_task_table(&conn)?;
        assert!(ai_task_records_table_exists(&conn).expect("table exists check should work"));

        let first_id = format!("runtime-delete-{}", uuid::Uuid::new_v4());
        let second_id = format!("runtime-clear-{}", uuid::Uuid::new_v4());
        insert_runtime_ai_task(&conn, &first_id)?;
        insert_runtime_ai_task(&conn, &second_id)?;
        insert_runtime_ai_task_children(&conn, &first_id, "delete-child")?;
        insert_runtime_ai_task_children(&conn, &second_id, "clear-child")?;

        let before_count = count_ai_task_records_in_conn(&conn)?;
        assert_eq!(before_count, 2);
        assert_eq!(count_runtime_ai_task_child_refs(&conn, &first_id)?, 5);
        assert_eq!(count_runtime_ai_task_child_refs(&conn, &second_id)?, 5);
        assert_eq!(count_runtime_ai_task_child_rows(&conn)?, 10);

        let delete_result = delete_ai_task_records_by_ids_internal(
            &conn,
            vec![first_id.clone()],
            db_path_text.clone(),
        )?;
        assert_eq!(delete_result.requested_count, 1);
        assert_eq!(delete_result.before_count, 2);
        assert_eq!(delete_result.before_match_count, 1);
        assert_eq!(delete_result.deleted_count, 1);
        assert_eq!(delete_result.after_match_count, 0);
        assert_eq!(delete_result.after_count, 1);
        assert_eq!(delete_result.affected_rows, 1);
        assert_runtime_child_cleanup(&delete_result, 1);

        assert_eq!(count_ai_task_records_by_ids(&conn, &[first_id.clone()])?, 0);
        assert_eq!(
            count_ai_task_records_by_ids(&conn, &[second_id.clone()])?,
            1
        );
        assert_eq!(count_runtime_ai_task_child_refs(&conn, &first_id)?, 0);
        assert_eq!(count_runtime_ai_task_child_refs(&conn, &second_id)?, 5);
        assert_eq!(count_runtime_ai_task_child_rows(&conn)?, 10);

        let clear_result = clear_ai_task_records_internal(&conn, db_path_text.clone())?;
        assert_eq!(clear_result.before_count, 1);
        assert_eq!(clear_result.deleted_count, 1);
        assert_eq!(clear_result.after_count, 0);
        assert_eq!(clear_result.affected_rows, 1);
        assert_runtime_child_cleanup(&clear_result, 1);
        assert_eq!(count_ai_task_records_in_conn(&conn)?, 0);
        assert_eq!(count_runtime_ai_task_child_refs(&conn, &second_id)?, 0);
        assert_eq!(count_runtime_ai_task_child_rows(&conn)?, 10);

        drop(conn);
        let _ = fs::remove_file(db_path);
        Ok(())
    }

    #[test]
    fn ai_task_delete_rejects_running_records_without_clearing_provenance(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        create_runtime_ai_task_table(&conn)?;
        insert_runtime_ai_task(&conn, "terminal-task")?;
        conn.execute(
            "INSERT INTO ai_task_records (id, task_type, status, created_at)
             VALUES ('running-task', 'chapter_generate', 'running', '2026-07-29T00:00:00Z')",
            [],
        )?;
        insert_runtime_ai_task_children(&conn, "running-task", "running-child")?;

        for result in [
            delete_ai_task_records_by_ids_internal(
                &conn,
                vec!["running-task".to_string()],
                "memory".to_string(),
            ),
            delete_ai_task_records_by_ids_internal(
                &conn,
                vec!["terminal-task".to_string(), "running-task".to_string()],
                "memory".to_string(),
            ),
            clear_ai_task_records_internal(&conn, "memory".to_string()),
        ] {
            assert_eq!(
                result.expect_err("running AI task must be protected"),
                "ai_task_running_delete_protected"
            );
        }
        assert_eq!(count_ai_task_records_in_conn(&conn)?, 2);
        assert_eq!(count_runtime_ai_task_child_refs(&conn, "running-task")?, 5);
        Ok(())
    }

    #[test]
    fn ai_task_delete_rejects_completed_quality_report_references(
    ) -> Result<(), Box<dyn std::error::Error>> {
        for action in ["single", "batch", "clear"] {
            let conn = Connection::open_in_memory()?;
            create_runtime_ai_task_table(&conn)?;
            for task_id in [
                "quality-task-protected",
                "quality-task-free-a",
                "quality-task-free-b",
            ] {
                insert_runtime_ai_task(&conn, task_id)?;
            }
            conn.execute(
                "INSERT INTO quality_check_reports (id, ai_task_id, status)
                 VALUES ('quality-report-completed', 'quality-task-protected', 'completed')",
                [],
            )?;

            let result = match action {
                "single" => delete_ai_task_records_by_ids_internal(
                    &conn,
                    vec!["quality-task-protected".to_string()],
                    "memory".to_string(),
                ),
                "batch" => delete_ai_task_records_by_ids_internal(
                    &conn,
                    vec![
                        "quality-task-free-a".to_string(),
                        "quality-task-protected".to_string(),
                    ],
                    "memory".to_string(),
                ),
                "clear" => clear_ai_task_records_internal(&conn, "memory".to_string()),
                _ => unreachable!(),
            };

            assert_eq!(
                result.expect_err("completed quality report task must be protected"),
                "quality_check_ai_task_delete_protected"
            );
            assert_eq!(count_ai_task_records_in_conn(&conn)?, 3);
            assert_eq!(
                conn.query_row(
                    "SELECT COUNT(*) FROM quality_check_reports
                     WHERE id = 'quality-report-completed'
                       AND ai_task_id = 'quality-task-protected'",
                    [],
                    |row| row.get::<_, i64>(0),
                )?,
                1
            );
        }
        Ok(())
    }

    fn create_quality_history_test_database() -> Result<Connection, Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        crate::db::create_tables(&mut conn)?;
        conn.execute_batch(
            "
            INSERT INTO novels
                (id, title, created_at, updated_at)
                VALUES ('novel-quality', 'Quality History', '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z');
            INSERT INTO volumes
                (id, novel_id, title, created_at, updated_at)
                VALUES ('volume-quality', 'novel-quality', 'Volume', '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z');
            INSERT INTO chapters
                (id, novel_id, volume_id, title, created_at, updated_at)
                VALUES ('chapter-quality', 'novel-quality', 'volume-quality', 'Chapter', '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z');
            INSERT INTO chapter_drafts
                (id, novel_id, chapter_id, content, created_at, updated_at)
                VALUES ('draft-quality', 'novel-quality', 'chapter-quality', 'Draft', '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z');
            INSERT INTO ai_task_records
                (id, novel_id, chapter_id, task_type, status, created_at)
                VALUES ('quality-task-default', 'novel-quality', 'chapter-quality', 'quality_check', 'succeeded', '2026-07-22T00:00:00Z');
            ",
        )?;
        Ok(conn)
    }

    fn insert_quality_report(
        conn: &Connection,
        report_id: &str,
        status: &str,
        created_at: &str,
    ) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO quality_check_reports
                (id, novel_id, chapter_id, draft_id, status, created_at, updated_at)
             VALUES (?1, 'novel-quality', 'chapter-quality', 'draft-quality', ?2, ?3, ?3)",
            params![report_id, status, created_at],
        )?;
        Ok(())
    }

    fn quality_result_input(
        report_id: &str,
        summary: &str,
        items: &[(&str, &str)],
    ) -> SaveQualityCheckResultInput {
        SaveQualityCheckResultInput {
            report_id: report_id.to_string(),
            novel_id: "novel-quality".to_string(),
            chapter_id: "chapter-quality".to_string(),
            draft_id: "draft-quality".to_string(),
            result: QualityCheckResultDto {
                overall_score: Some(88),
                summary: Some(summary.to_string()),
                items: items
                    .iter()
                    .map(|(issue_key, title)| QualityCheckResultItemDto {
                        issue_type: Some("continuity".to_string()),
                        severity: Some("high".to_string()),
                        category: Some("logic".to_string()),
                        title: Some((*title).to_string()),
                        description: Some(format!("description-{title}")),
                        evidence: Some(format!("evidence-{title}")),
                        suggestion: Some(format!("suggestion-{title}")),
                        quote: Some(format!("quote-{title}")),
                        start_offset: Some(1),
                        end_offset: Some(2),
                        paragraph_index: Some(0),
                        issue_key: Some((*issue_key).to_string()),
                    })
                    .collect(),
            },
            draft_version: Some(1),
            model: Some("test-model".to_string()),
            content_hash: Some("test-hash".to_string()),
            content_length: Some(5),
            checked_at: Some("2026-07-22T00:00:00Z".to_string()),
            ai_task_id: "quality-task-default".to_string(),
        }
    }

    #[test]
    fn quality_reports_keep_immutable_items_and_replay_raw_order(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        insert_quality_report(&conn, "report-old", "pending", "2026-07-22T00:00:01Z")?;
        let first = quality_result_input(
            "report-old",
            "first summary",
            &[("issue-repeat", "old evidence"), ("issue-old", "old only")],
        );
        save_quality_check_result_internal(&mut conn, &first)?;
        let original = get_quality_check_report_snapshot_internal(&conn, "report-old")?;
        assert_eq!(original.items.len(), 2);
        assert_eq!(original.items[0].sort_order, 0);
        assert_eq!(original.items[1].sort_order, 1);
        let original_ids = original
            .items
            .iter()
            .map(|item| item.id.clone())
            .collect::<Vec<_>>();

        update_quality_issue_status_internal(
            &mut conn,
            &original.items[0].id,
            "ignored",
            Some("intentional"),
        )?;
        let raw_after_state_change =
            get_quality_check_report_snapshot_internal(&conn, "report-old")?;
        assert_eq!(raw_after_state_change.items[0].status, "pending");
        assert_eq!(raw_after_state_change.items[0].resolution_note, None);

        insert_quality_report(&conn, "report-new", "pending", "2026-07-22T00:00:02Z")?;
        let second = quality_result_input(
            "report-new",
            "second summary",
            &[("issue-repeat", "new evidence"), ("issue-new", "new only")],
        );
        let newest = save_quality_check_result_internal(&mut conn, &second)?;
        assert_eq!(newest.items[0].status, "ignored");
        assert_eq!(newest.items[0].title, "new evidence");
        let old_idempotent_retry = save_quality_check_result_internal(&mut conn, &first)?;
        assert_eq!(old_idempotent_retry.items[0].status, "pending");
        assert_eq!(old_idempotent_retry.items[0].title, "old evidence");
        assert_eq!(
            update_quality_issue_status_internal(
                &mut conn,
                &original.items[0].id,
                "resolved",
                None,
            )
            .unwrap_err(),
            "quality_issue_history_read_only"
        );

        let replay = get_quality_check_report_snapshot_internal(&conn, "report-old")?;
        assert_eq!(
            replay
                .items
                .iter()
                .map(|item| item.id.clone())
                .collect::<Vec<_>>(),
            original_ids
        );
        assert!(replay
            .items
            .iter()
            .all(|item| item.report_id == "report-old"));
        assert_eq!(replay.items[0].title, "old evidence");
        assert_eq!(replay.items[1].title, "old only");
        assert!(newest
            .items
            .iter()
            .all(|item| !original_ids.contains(&item.id)));
        Ok(())
    }

    #[test]
    fn quality_result_save_rolls_back_report_items_and_states_on_nth_item_failure(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        insert_quality_report(&conn, "report-rollback", "pending", "2026-07-22T00:00:01Z")?;
        conn.execute_batch(
            "CREATE TRIGGER fail_second_quality_item
             BEFORE INSERT ON quality_check_items
             WHEN NEW.sort_order = 1
             BEGIN
                 SELECT RAISE(ABORT, 'forced second item failure');
             END;",
        )?;
        let input = quality_result_input(
            "report-rollback",
            "must rollback",
            &[("issue-one", "one"), ("issue-two", "two")],
        );
        let error = save_quality_check_result_internal(&mut conn, &input)
            .expect_err("the injected second item failure must abort the save");
        assert!(error.starts_with("quality_snapshot_item_insert_failed:"));
        let report_status: String = conn.query_row(
            "SELECT status FROM quality_check_reports WHERE id = 'report-rollback'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(report_status, "pending");
        let item_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM quality_check_items WHERE report_id = 'report-rollback'",
            [],
            |row| row.get(0),
        )?;
        let state_count: i64 =
            conn.query_row("SELECT COUNT(*) FROM quality_issue_states", [], |row| {
                row.get(0)
            })?;
        assert_eq!(item_count, 0);
        assert_eq!(state_count, 0);
        Ok(())
    }

    #[test]
    fn latest_quality_workflow_ignores_newer_incomplete_reports(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        insert_quality_report(&conn, "report-completed", "pending", "2026-07-22T00:00:01Z")?;
        let completed = quality_result_input(
            "report-completed",
            "completed",
            &[("issue-completed", "completed issue")],
        );
        save_quality_check_result_internal(&mut conn, &completed)?;
        insert_quality_report(&conn, "report-pending", "pending", "2026-07-22T00:00:02Z")?;
        insert_quality_report(&conn, "report-failed", "failed", "2026-07-22T00:00:03Z")?;

        let latest = get_quality_check_issues_internal(&conn, "chapter-quality")?;
        assert_eq!(
            latest.report.as_ref().map(|report| report.id.as_str()),
            Some("report-completed")
        );
        assert_eq!(latest.items.len(), 1);
        let history = list_quality_check_reports_internal(&conn, "chapter-quality")?;
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, "report-completed");
        Ok(())
    }

    #[test]
    fn completing_report_refreshes_state_when_only_newer_reports_are_incomplete(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        insert_quality_report(&conn, "report-baseline", "pending", "2026-07-22T00:00:01Z")?;
        let baseline = quality_result_input(
            "report-baseline",
            "baseline",
            &[("issue-repeat", "baseline evidence")],
        );
        let baseline_result = save_quality_check_result_internal(&mut conn, &baseline)?;
        update_quality_issue_status_internal(
            &mut conn,
            &baseline_result.items[0].id,
            "resolved",
            Some("previously resolved"),
        )?;

        insert_quality_report(&conn, "report-current", "pending", "2026-07-22T00:00:02Z")?;
        insert_quality_report(
            &conn,
            "report-newer-pending",
            "pending",
            "2026-07-22T00:00:03Z",
        )?;
        insert_quality_report(
            &conn,
            "report-newer-failed",
            "failed",
            "2026-07-22T00:00:04Z",
        )?;
        let current = quality_result_input(
            "report-current",
            "current complete result",
            &[("issue-repeat", "current evidence")],
        );
        let saved = save_quality_check_result_internal(&mut conn, &current)?;

        assert_eq!(saved.items[0].status, "pending");
        let latest = get_quality_check_issues_internal(&conn, "chapter-quality")?;
        assert_eq!(
            latest.report.as_ref().map(|report| report.id.as_str()),
            Some("report-current")
        );
        assert_eq!(latest.items[0].status, "pending");
        let workflow_state: String = conn.query_row(
            "SELECT status FROM quality_issue_states
             WHERE chapter_id = 'chapter-quality' AND issue_key = 'issue-repeat'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(workflow_state, "pending");
        Ok(())
    }

    #[test]
    fn late_older_report_cannot_overwrite_newer_report_workflow_state(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        conn.execute_batch(
            "INSERT INTO ai_task_records
                (id, novel_id, chapter_id, task_type, status, created_at)
             VALUES
                ('quality-task-tie-a', 'novel-quality', 'chapter-quality', 'quality_check', 'succeeded', '2026-07-22T00:00:00Z'),
                ('quality-task-tie-b', 'novel-quality', 'chapter-quality', 'quality_check', 'succeeded', '2026-07-22T00:00:00Z');",
        )?;
        let tied_created_at = "2026-07-22T00:00:05Z";
        insert_quality_report(&conn, "report-tie-a", "pending", tied_created_at)?;
        insert_quality_report(&conn, "report-tie-b", "pending", tied_created_at)?;

        let mut newer = quality_result_input(
            "report-tie-b",
            "newer by id",
            &[("issue-race", "newer evidence")],
        );
        newer.ai_task_id = "quality-task-tie-b".to_string();
        let newer_result = save_quality_check_result_internal(&mut conn, &newer)?;
        update_quality_issue_status_internal(
            &mut conn,
            &newer_result.items[0].id,
            "resolved",
            Some("keep resolved"),
        )?;

        let mut older = quality_result_input(
            "report-tie-a",
            "late older by id",
            &[("issue-race", "older evidence")],
        );
        older.ai_task_id = "quality-task-tie-a".to_string();
        let late_result = save_quality_check_result_internal(&mut conn, &older)?;
        assert_eq!(late_result.items[0].status, "pending");
        assert_eq!(late_result.items[0].title, "older evidence");

        let workflow_state: (String, Option<String>) = conn.query_row(
            "SELECT status, resolution_note FROM quality_issue_states
             WHERE chapter_id = 'chapter-quality' AND issue_key = 'issue-race'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(
            workflow_state,
            ("resolved".to_string(), Some("keep resolved".to_string()))
        );
        let late_snapshot = get_quality_check_report_snapshot_internal(&conn, "report-tie-a")?;
        assert_eq!(late_snapshot.items.len(), 1);
        assert_eq!(late_snapshot.items[0].title, "older evidence");
        assert_eq!(late_snapshot.items[0].status, "pending");
        let latest = get_quality_check_issues_internal(&conn, "chapter-quality")?;
        assert_eq!(
            latest.report.as_ref().map(|report| report.id.as_str()),
            Some("report-tie-b")
        );
        assert_eq!(latest.items[0].status, "resolved");
        Ok(())
    }

    #[test]
    fn completed_quality_result_save_is_idempotent_and_immutable(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        conn.execute(
            "INSERT INTO ai_task_records
                (id, novel_id, chapter_id, task_type, status, created_at)
             VALUES ('quality-task-other', 'novel-quality', 'chapter-quality', 'quality_check', 'succeeded', '2026-07-22T00:00:00Z')",
            [],
        )?;
        insert_quality_report(
            &conn,
            "report-idempotent",
            "pending",
            "2026-07-22T00:00:01Z",
        )?;
        let first = quality_result_input(
            "report-idempotent",
            "original summary",
            &[("issue-original", "original")],
        );
        let first_result = save_quality_check_result_internal(&mut conn, &first)?;
        let duplicate = quality_result_input(
            "report-idempotent",
            "replacement summary",
            &[("issue-replacement", "replacement")],
        );
        let duplicate_result = save_quality_check_result_internal(&mut conn, &duplicate)?;
        assert_eq!(duplicate_result.items.len(), 1);
        assert_eq!(duplicate_result.items[0].id, first_result.items[0].id);
        assert_eq!(duplicate_result.items[0].title, "original");
        assert_eq!(
            duplicate_result
                .report
                .as_ref()
                .and_then(|report| report.summary.as_deref()),
            Some("original summary")
        );
        let item_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM quality_check_items WHERE report_id = 'report-idempotent'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(item_count, 1);
        let mut wrong_task_duplicate = duplicate;
        wrong_task_duplicate.ai_task_id = "quality-task-other".to_string();
        assert_eq!(
            save_quality_check_result_internal(&mut conn, &wrong_task_duplicate).unwrap_err(),
            "quality_check_report_ai_task_mismatch"
        );
        Ok(())
    }

    #[test]
    fn batch_quality_state_update_is_transactional() -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        insert_quality_report(&conn, "report-batch", "pending", "2026-07-22T00:00:01Z")?;
        let input = quality_result_input(
            "report-batch",
            "batch",
            &[("issue-first", "first"), ("issue-second", "second")],
        );
        let saved = save_quality_check_result_internal(&mut conn, &input)?;
        conn.execute_batch(
            "CREATE TRIGGER fail_second_quality_state
             BEFORE UPDATE OF status ON quality_issue_states
             WHEN OLD.issue_key = 'issue-second'
             BEGIN
                 SELECT RAISE(ABORT, 'forced second state failure');
             END;",
        )?;
        let ids = saved
            .items
            .iter()
            .map(|item| item.id.clone())
            .collect::<Vec<_>>();
        let error = batch_update_quality_issue_status_internal(&mut conn, &ids, "resolved")
            .expect_err("the injected state failure must roll back the batch");
        assert!(error.starts_with("quality_issue_state_write_failed:"));
        let non_pending: i64 = conn.query_row(
            "SELECT COUNT(*) FROM quality_issue_states WHERE status <> 'pending'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(non_pending, 0);
        Ok(())
    }

    #[test]
    fn quality_result_rejects_report_ownership_and_terminal_status_mismatch(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        insert_quality_report(&conn, "report-owned", "pending", "2026-07-22T00:00:01Z")?;
        let mut wrong_owner =
            quality_result_input("report-owned", "wrong owner", &[("issue-one", "one")]);
        wrong_owner.chapter_id = "another-chapter".to_string();
        assert_eq!(
            save_quality_check_result_internal(&mut conn, &wrong_owner).unwrap_err(),
            "quality_check_report_ownership_mismatch"
        );
        insert_quality_report(&conn, "report-failed", "failed", "2026-07-22T00:00:02Z")?;
        let failed = quality_result_input("report-failed", "failed", &[("issue-two", "two")]);
        assert_eq!(
            save_quality_check_result_internal(&mut conn, &failed).unwrap_err(),
            "quality_check_report_not_pending"
        );
        Ok(())
    }

    #[test]
    fn quality_result_validates_and_binds_the_succeeded_ai_task(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        conn.execute_batch(
            "INSERT INTO ai_task_records
                (id, novel_id, chapter_id, task_type, status, created_at)
             VALUES
                ('quality-task-ok', 'novel-quality', 'chapter-quality', 'quality_check', 'succeeded', '2026-07-22T00:00:00Z'),
                ('quality-task-running', 'novel-quality', 'chapter-quality', 'quality_check', 'running', '2026-07-22T00:00:00Z'),
                ('quality-task-wrong-type', 'novel-quality', 'chapter-quality', 'draft_generation', 'succeeded', '2026-07-22T00:00:00Z'),
                ('quality-task-wrong-target', NULL, NULL, 'quality_check', 'succeeded', '2026-07-22T00:00:00Z');",
        )?;
        insert_quality_report(&conn, "report-task-ok", "pending", "2026-07-22T00:00:01Z")?;
        let mut valid = quality_result_input(
            "report-task-ok",
            "bound task",
            &[("issue-task", "task issue")],
        );
        valid.ai_task_id = "quality-task-ok".to_string();
        let saved = save_quality_check_result_internal(&mut conn, &valid)?;
        assert_eq!(
            saved
                .report
                .as_ref()
                .and_then(|report| report.ai_task_id.as_deref()),
            Some("quality-task-ok")
        );

        insert_quality_report(
            &conn,
            "report-task-running",
            "pending",
            "2026-07-22T00:00:02Z",
        )?;
        let mut invalid = quality_result_input(
            "report-task-running",
            "invalid task",
            &[("issue-invalid-task", "invalid task issue")],
        );
        invalid.ai_task_id = "quality-task-running".to_string();
        assert_eq!(
            save_quality_check_result_internal(&mut conn, &invalid).unwrap_err(),
            "quality_check_ai_task_mismatch"
        );
        let failed_report_state: (String, i64) = conn.query_row(
            "SELECT report.status,
                    (SELECT COUNT(*) FROM quality_check_items AS item WHERE item.report_id = report.id)
             FROM quality_check_reports AS report WHERE report.id = 'report-task-running'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(failed_report_state, ("pending".to_string(), 0));

        for (report_id, task_id, expected_error) in [
            ("report-task-required", "", "quality_check_ai_task_required"),
            (
                "report-task-wrong-type",
                "quality-task-wrong-type",
                "quality_check_ai_task_mismatch",
            ),
            (
                "report-task-wrong-target",
                "quality-task-wrong-target",
                "quality_check_ai_task_mismatch",
            ),
        ] {
            insert_quality_report(&conn, report_id, "pending", "2026-07-22T00:00:03Z")?;
            let mut input = quality_result_input(
                report_id,
                "rejected task",
                &[("issue-rejected-task", "rejected task issue")],
            );
            input.ai_task_id = task_id.to_string();
            assert_eq!(
                save_quality_check_result_internal(&mut conn, &input).unwrap_err(),
                expected_error
            );
        }
        let partially_written: i64 = conn.query_row(
            "SELECT COUNT(*) FROM quality_check_items
             WHERE report_id IN ('report-task-required', 'report-task-wrong-type', 'report-task-wrong-target')",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(partially_written, 0);
        Ok(())
    }

    #[test]
    fn quality_result_rejects_duplicate_issue_keys_without_partial_writes(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        insert_quality_report(
            &conn,
            "report-duplicate-key",
            "pending",
            "2026-07-22T00:00:01Z",
        )?;
        let duplicate = quality_result_input(
            "report-duplicate-key",
            "duplicate",
            &[("same-key", "first"), ("same-key", "second")],
        );
        assert_eq!(
            save_quality_check_result_internal(&mut conn, &duplicate).unwrap_err(),
            "quality_check_duplicate_issue_key"
        );
        let state: (String, i64) = conn.query_row(
            "SELECT report.status,
                    (SELECT COUNT(*) FROM quality_check_items AS item WHERE item.report_id = report.id)
             FROM quality_check_reports AS report WHERE report.id = 'report-duplicate-key'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(state, ("pending".to_string(), 0));
        Ok(())
    }

    fn create_chapter_context_test_database() -> rusqlite::Result<Connection> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            CREATE TABLE novels (
                id TEXT PRIMARY KEY,
                deleted_at TEXT
            );
            CREATE TABLE volumes (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                deleted_at TEXT
            );
            CREATE TABLE chapters (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                volume_id TEXT,
                adopted_draft_id TEXT,
                status TEXT NOT NULL,
                order_index INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );
            CREATE TABLE chapter_drafts (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                is_adopted INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE characters (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                current_state TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE character_states (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                character_id TEXT NOT NULL,
                chapter_id TEXT,
                state_summary TEXT NOT NULL DEFAULT '',
                relationship_changes TEXT,
                goal_changes TEXT,
                location TEXT,
                health_state TEXT,
                knowledge_state TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE chapter_summaries (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                volume_id TEXT,
                adopted_draft_id TEXT NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                key_events TEXT,
                character_changes TEXT,
                relationship_changes TEXT,
                new_foreshadows TEXT,
                resolved_foreshadows TEXT,
                next_chapter_hints TEXT,
                core_events TEXT,
                protagonist_state_change TEXT,
                important_character_changes TEXT,
                setting_changes TEXT,
                new_locations TEXT,
                new_items_or_abilities TEXT,
                foreshadowing TEXT,
                unresolved_questions TEXT,
                facts_must_remember TEXT,
                next_chapter_hook TEXT,
                validation_status TEXT,
                validation_result TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                content_hash TEXT,
                draft_version INTEGER,
                is_expired INTEGER NOT NULL DEFAULT 0,
                ai_task_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE context_records (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                chapter_id TEXT,
                volume_id TEXT,
                context_type TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                importance INTEGER NOT NULL DEFAULT 3,
                is_active INTEGER NOT NULL DEFAULT 1,
                is_expired INTEGER NOT NULL DEFAULT 0,
                content_hash TEXT,
                draft_version INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            ",
        )?;
        Ok(conn)
    }

    struct ChapterContextFixture {
        novel_id: String,
        volume_id: String,
        chapter_id: String,
        draft_id: String,
        character_id: String,
    }

    fn seed_chapter_context_fixture(
        conn: &Connection,
        suffix: u128,
        order_index: i64,
    ) -> rusqlite::Result<ChapterContextFixture> {
        let novel_id = uuid::Uuid::from_u128(suffix * 16 + 1).to_string();
        let volume_id = uuid::Uuid::from_u128(suffix * 16 + 2).to_string();
        let chapter_id = uuid::Uuid::from_u128(suffix * 16 + 3).to_string();
        let draft_id = uuid::Uuid::from_u128(suffix * 16 + 4).to_string();
        let character_id = uuid::Uuid::from_u128(suffix * 16 + 5).to_string();
        conn.execute("INSERT INTO novels (id) VALUES (?1)", params![&novel_id])?;
        conn.execute(
            "INSERT INTO volumes (id, novel_id) VALUES (?1, ?2)",
            params![&volume_id, &novel_id],
        )?;
        conn.execute(
            "INSERT INTO chapters
             (id, novel_id, volume_id, adopted_draft_id, status, order_index, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'adopted', ?5, 'before')",
            params![&chapter_id, &novel_id, &volume_id, &draft_id, order_index],
        )?;
        conn.execute(
            "INSERT INTO chapter_drafts (id, novel_id, chapter_id, is_adopted)
             VALUES (?1, ?2, ?3, 1)",
            params![&draft_id, &novel_id, &chapter_id],
        )?;
        conn.execute(
            "INSERT INTO characters (id, novel_id, current_state, updated_at)
             VALUES (?1, ?2, 'before', 'before')",
            params![&character_id, &novel_id],
        )?;
        Ok(ChapterContextFixture {
            novel_id,
            volume_id,
            chapter_id,
            draft_id,
            character_id,
        })
    }

    fn test_summary_input(
        fixture: &ChapterContextFixture,
        id: Option<String>,
        summary: &str,
    ) -> SaveChapterSummaryInput {
        SaveChapterSummaryInput {
            id,
            novel_id: fixture.novel_id.clone(),
            chapter_id: fixture.chapter_id.clone(),
            volume_id: Some(fixture.volume_id.clone()),
            adopted_draft_id: fixture.draft_id.clone(),
            summary: summary.to_string(),
            key_events: None,
            character_changes: None,
            relationship_changes: None,
            new_foreshadows: None,
            resolved_foreshadows: None,
            next_chapter_hints: None,
            core_events: None,
            protagonist_state_change: None,
            important_character_changes: None,
            setting_changes: None,
            new_locations: None,
            new_items_or_abilities: None,
            foreshadowing: None,
            unresolved_questions: None,
            facts_must_remember: None,
            next_chapter_hook: None,
            validation_status: Some("passed".to_string()),
            validation_result: None,
            enabled: Some(true),
            content_hash: Some("hash".to_string()),
            draft_version: Some(1),
            ai_task_id: None,
        }
    }

    fn test_context_input(
        fixture: &ChapterContextFixture,
        id: Option<String>,
        title: &str,
        content: &str,
    ) -> SaveContextRecordInput {
        SaveContextRecordInput {
            id,
            novel_id: fixture.novel_id.clone(),
            chapter_id: Some(fixture.chapter_id.clone()),
            volume_id: Some(fixture.volume_id.clone()),
            context_type: "chapter_summary".to_string(),
            title: title.to_string(),
            content: content.to_string(),
            importance: Some(4),
            is_active: Some(true),
            content_hash: Some("hash".to_string()),
            draft_version: Some(1),
        }
    }

    fn test_character_state_input(
        fixture: &ChapterContextFixture,
        id: Option<String>,
        summary: &str,
    ) -> SaveCharacterStateInput {
        SaveCharacterStateInput {
            id,
            novel_id: fixture.novel_id.clone(),
            character_id: fixture.character_id.clone(),
            chapter_id: Some(fixture.chapter_id.clone()),
            state_summary: summary.to_string(),
            relationship_changes: Some("closer".to_string()),
            goal_changes: None,
            location: Some("harbor".to_string()),
            health_state: None,
            knowledge_state: Some("secret".to_string()),
        }
    }

    #[test]
    fn context_batch_preserves_provided_ids_and_rolls_back_nth_failure(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_chapter_context_test_database()?;
        let fixture = seed_chapter_context_fixture(&conn, 1, 0)?;
        let provided_id = uuid::Uuid::new_v4().to_string();
        let saved = save_context_records_internal(
            &mut conn,
            &[test_context_input(
                &fixture,
                Some(provided_id.clone()),
                "provided",
                "first",
            )],
        )?;
        assert_eq!(saved[0].id, provided_id);

        let invalid_id_error = save_context_records_internal(
            &mut conn,
            &[test_context_input(
                &fixture,
                Some("not-a-uuid".to_string()),
                "invalid",
                "must not persist",
            )],
        )
        .unwrap_err();
        assert_eq!(invalid_id_error, "context_record_id_invalid_uuid");

        conn.execute_batch(
            "CREATE TRIGGER fail_context_insert
             BEFORE INSERT ON context_records WHEN NEW.title = 'explode'
             BEGIN SELECT RAISE(ABORT, 'injected nth failure'); END;",
        )?;
        let before: i64 =
            conn.query_row("SELECT COUNT(*) FROM context_records", [], |row| row.get(0))?;
        let inputs = vec![
            test_context_input(
                &fixture,
                Some(uuid::Uuid::new_v4().to_string()),
                "will rollback",
                "second",
            ),
            test_context_input(
                &fixture,
                Some(uuid::Uuid::new_v4().to_string()),
                "explode",
                "third",
            ),
        ];
        assert!(save_context_records_internal(&mut conn, &inputs).is_err());
        let after: i64 =
            conn.query_row("SELECT COUNT(*) FROM context_records", [], |row| row.get(0))?;
        assert_eq!(after, before);
        Ok(())
    }

    #[test]
    fn context_update_rejects_cross_novel_ownership() -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_chapter_context_test_database()?;
        let owner = seed_chapter_context_fixture(&conn, 2, 0)?;
        let attacker = seed_chapter_context_fixture(&conn, 3, 0)?;
        let id = uuid::Uuid::new_v4().to_string();
        save_context_records_internal(
            &mut conn,
            &[test_context_input(
                &owner,
                Some(id.clone()),
                "original",
                "safe",
            )],
        )?;
        let update = UpdateContextRecordInput {
            novel_id: attacker.novel_id.clone(),
            chapter_id: Some(attacker.chapter_id.clone()),
            volume_id: Some(attacker.volume_id.clone()),
            context_type: "chapter_summary".to_string(),
            title: "hijacked".to_string(),
            content: "unsafe".to_string(),
            importance: 5,
            is_active: false,
            is_expired: true,
            content_hash: None,
            draft_version: None,
        };
        assert_eq!(
            update_context_record_internal(&conn, &id, &update).unwrap_err(),
            "context_record_ownership_mismatch"
        );
        assert_eq!(
            update_context_record_internal(&conn, &uuid::Uuid::new_v4().to_string(), &update)
                .unwrap_err(),
            "context_record_not_found"
        );
        let unchanged: (String, String) = conn.query_row(
            "SELECT novel_id, title FROM context_records WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(unchanged, (owner.novel_id, "original".to_string()));
        Ok(())
    }

    #[test]
    fn chapter_context_bundle_is_atomic_and_updates_all_owned_state(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_chapter_context_test_database()?;
        let fixture = seed_chapter_context_fixture(&conn, 4, 0)?;
        let summary_id = uuid::Uuid::new_v4().to_string();
        let context_id = uuid::Uuid::new_v4().to_string();
        let state_id = uuid::Uuid::new_v4().to_string();
        let input = SaveChapterContextBundleInput {
            novel_id: fixture.novel_id.clone(),
            chapter_id: fixture.chapter_id.clone(),
            adopted_draft_id: fixture.draft_id.clone(),
            summary: test_summary_input(&fixture, Some(summary_id.clone()), "bundle summary"),
            context_records: vec![test_context_input(
                &fixture,
                Some(context_id.clone()),
                "bundle context",
                "remember",
            )],
            character_states: vec![test_character_state_input(
                &fixture,
                Some(state_id.clone()),
                "after chapter",
            )],
        };
        let result = save_chapter_context_bundle_internal(&mut conn, &input)?;
        assert_eq!(result.summary.id, summary_id);
        assert_eq!(result.context_records[0].id, context_id);
        assert_eq!(result.character_states[0].id, state_id);
        assert_eq!(result.chapter_status, "summarized");
        let persisted: (String, String) = conn.query_row(
            "SELECT chapter.status, character.current_state
             FROM chapters AS chapter JOIN characters AS character ON character.novel_id = chapter.novel_id
             WHERE chapter.id = ?1 AND character.id = ?2",
            params![&fixture.chapter_id, &fixture.character_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(
            persisted,
            ("summarized".to_string(), "after chapter".to_string())
        );

        let rollback_fixture = seed_chapter_context_fixture(&conn, 5, 0)?;
        conn.execute_batch(
            "CREATE TRIGGER fail_bundle_second_context
             BEFORE INSERT ON context_records WHEN NEW.title = 'bundle explode'
             BEGIN SELECT RAISE(ABORT, 'injected bundle failure'); END;",
        )?;
        let rollback_input = SaveChapterContextBundleInput {
            novel_id: rollback_fixture.novel_id.clone(),
            chapter_id: rollback_fixture.chapter_id.clone(),
            adopted_draft_id: rollback_fixture.draft_id.clone(),
            summary: test_summary_input(
                &rollback_fixture,
                Some(uuid::Uuid::new_v4().to_string()),
                "must rollback",
            ),
            context_records: vec![
                test_context_input(
                    &rollback_fixture,
                    Some(uuid::Uuid::new_v4().to_string()),
                    "first bundle context",
                    "first",
                ),
                test_context_input(
                    &rollback_fixture,
                    Some(uuid::Uuid::new_v4().to_string()),
                    "bundle explode",
                    "second",
                ),
            ],
            character_states: vec![],
        };
        assert!(save_chapter_context_bundle_internal(&mut conn, &rollback_input).is_err());
        let counts: (i64, i64) = conn.query_row(
            "SELECT
                (SELECT COUNT(*) FROM chapter_summaries WHERE novel_id = ?1),
                (SELECT COUNT(*) FROM context_records WHERE novel_id = ?1)",
            params![&rollback_fixture.novel_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(counts, (0, 0));
        let rollback_status: String = conn.query_row(
            "SELECT status FROM chapters WHERE id = ?1",
            params![&rollback_fixture.chapter_id],
            |row| row.get(0),
        )?;
        assert_eq!(rollback_status, "adopted");
        Ok(())
    }

    #[test]
    fn chapter_context_expiration_rolls_back_summary_when_record_update_fails(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_chapter_context_test_database()?;
        let fixture = seed_chapter_context_fixture(&conn, 9, 0)?;
        upsert_chapter_summary(
            &conn,
            &test_summary_input(
                &fixture,
                Some(uuid::Uuid::new_v4().to_string()),
                "expiration summary",
            ),
            "before",
        )?;
        save_context_records_internal(
            &mut conn,
            &[test_context_input(
                &fixture,
                Some(uuid::Uuid::new_v4().to_string()),
                "expiration context",
                "remember",
            )],
        )?;
        conn.execute_batch(
            "CREATE TRIGGER fail_context_expiration
             BEFORE UPDATE OF is_expired ON context_records WHEN NEW.is_expired = 1
             BEGIN SELECT RAISE(ABORT, 'injected expiration failure'); END;",
        )?;

        assert!(mark_chapter_context_expired_internal(&mut conn, &fixture.chapter_id).is_err());
        let rolled_back: (i64, i64) = conn.query_row(
            "SELECT
                (SELECT is_expired FROM chapter_summaries WHERE chapter_id = ?1),
                (SELECT is_expired FROM context_records WHERE chapter_id = ?1)",
            params![&fixture.chapter_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(rolled_back, (0, 0));

        conn.execute_batch("DROP TRIGGER fail_context_expiration;")?;
        mark_chapter_context_expired_internal(&mut conn, &fixture.chapter_id)?;
        let expired: (i64, i64) = conn.query_row(
            "SELECT
                (SELECT is_expired FROM chapter_summaries WHERE chapter_id = ?1),
                (SELECT is_expired FROM context_records WHERE chapter_id = ?1)",
            params![&fixture.chapter_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(expired, (1, 1));
        Ok(())
    }

    #[test]
    fn legacy_context_migration_is_idempotent_and_reconciles_dual_write_mirror(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_chapter_context_test_database()?;
        let fixture = seed_chapter_context_fixture(&conn, 6, 0)?;
        let summary_id = uuid::Uuid::new_v4().to_string();
        let context_id = uuid::Uuid::new_v4().to_string();
        let mirror_source_id = uuid::Uuid::new_v4().to_string();
        let mirror_database_id = uuid::Uuid::new_v4().to_string();
        let state_id = uuid::Uuid::new_v4().to_string();
        let mirror = test_context_input(
            &fixture,
            Some(mirror_source_id.clone()),
            "dual mirror",
            "same fingerprint",
        );
        conn.execute(
            "INSERT INTO context_records
             (id, novel_id, chapter_id, volume_id, context_type, title, content,
              importance, is_active, is_expired, content_hash, draft_version,
              created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11, 'db-time', 'db-time')",
            params![
                &mirror_database_id,
                &mirror.novel_id,
                &mirror.chapter_id,
                &mirror.volume_id,
                &mirror.context_type,
                &mirror.title,
                &mirror.content,
                mirror.importance,
                i64::from(mirror.is_active.unwrap_or(true)),
                &mirror.content_hash,
                mirror.draft_version,
            ],
        )?;
        let migration = MigrateLegacyChapterContextInput {
            chapter_summaries: vec![LegacyChapterSummaryInput {
                data: test_summary_input(&fixture, Some(summary_id.clone()), "legacy summary"),
                is_expired: Some(false),
                created_at: Some("legacy-time".to_string()),
                updated_at: Some("legacy-time".to_string()),
            }],
            context_records: vec![
                LegacyContextRecordInput {
                    data: test_context_input(
                        &fixture,
                        Some(context_id.clone()),
                        "new legacy context",
                        "new fingerprint",
                    ),
                    is_expired: Some(false),
                    created_at: Some("legacy-time".to_string()),
                    updated_at: Some("legacy-time".to_string()),
                },
                LegacyContextRecordInput {
                    data: mirror,
                    is_expired: Some(false),
                    created_at: Some("local-time".to_string()),
                    updated_at: Some("local-time".to_string()),
                },
            ],
            character_states: vec![LegacyCharacterStateInput {
                data: test_character_state_input(&fixture, Some(state_id.clone()), "legacy state"),
                created_at: Some("legacy-time".to_string()),
            }],
        };
        let first = migrate_legacy_chapter_context_internal(&mut conn, &migration)?;
        assert_eq!(first.chapter_summaries.inserted, 1);
        assert_eq!(first.context_records.inserted, 1);
        assert_eq!(first.context_records.matched, 1);
        assert_eq!(first.character_states.inserted, 1);
        assert_eq!(first.id_map.get(&summary_id), Some(&summary_id));
        assert_eq!(first.id_map.get(&context_id), Some(&context_id));
        assert_eq!(
            first.id_map.get(&mirror_source_id),
            Some(&mirror_database_id)
        );
        assert_eq!(first.id_map.get(&state_id), Some(&state_id));

        let second = migrate_legacy_chapter_context_internal(&mut conn, &migration)?;
        assert_eq!(second.chapter_summaries.matched, 1);
        assert_eq!(second.context_records.matched, 2);
        assert_eq!(second.character_states.matched, 1);
        assert_eq!(second.chapter_summaries.inserted, 0);
        assert_eq!(second.context_records.inserted, 0);
        assert_eq!(second.character_states.inserted, 0);
        let counts: (i64, i64, i64) = conn.query_row(
            "SELECT
                (SELECT COUNT(*) FROM chapter_summaries WHERE novel_id = ?1),
                (SELECT COUNT(*) FROM context_records WHERE novel_id = ?1),
                (SELECT COUNT(*) FROM character_states WHERE novel_id = ?1)",
            params![&fixture.novel_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        assert_eq!(counts, (1, 2, 1));
        Ok(())
    }

    #[test]
    fn legacy_migration_reconciles_character_current_state_using_stable_latest_order(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_chapter_context_test_database()?;
        let fixture = seed_chapter_context_fixture(&conn, 10, 0)?;
        let lower_id = "00000000-0000-0000-0000-00000000ca01".to_string();
        let higher_id = "00000000-0000-0000-0000-00000000ca02".to_string();
        let tied_created_at = "2026-07-26T08:00:00Z";
        conn.execute(
            "INSERT INTO character_states
             (id, novel_id, character_id, chapter_id, state_summary,
              relationship_changes, goal_changes, location, health_state,
              knowledge_state, created_at)
             VALUES (?1, ?2, ?3, ?4, 'stable latest state', NULL, NULL, NULL, NULL, NULL, ?5)",
            params![
                &higher_id,
                &fixture.novel_id,
                &fixture.character_id,
                &fixture.chapter_id,
                tied_created_at
            ],
        )?;
        conn.execute(
            "UPDATE characters SET current_state = 'stale state' WHERE id = ?1",
            params![&fixture.character_id],
        )?;
        let migration = MigrateLegacyChapterContextInput {
            chapter_summaries: vec![],
            context_records: vec![],
            character_states: vec![LegacyCharacterStateInput {
                data: test_character_state_input(
                    &fixture,
                    Some(lower_id.clone()),
                    "lower id state",
                ),
                created_at: Some(tied_created_at.to_string()),
            }],
        };

        let first = migrate_legacy_chapter_context_internal(&mut conn, &migration)?;
        assert_eq!(first.character_states.inserted, 1);
        let current_after_insert: String = conn.query_row(
            "SELECT current_state FROM characters WHERE id = ?1",
            params![&fixture.character_id],
            |row| row.get(0),
        )?;
        assert_eq!(current_after_insert, "stable latest state");

        conn.execute(
            "UPDATE characters SET current_state = 'stale again' WHERE id = ?1",
            params![&fixture.character_id],
        )?;
        let second = migrate_legacy_chapter_context_internal(&mut conn, &migration)?;
        assert_eq!(second.character_states.matched, 1);
        assert_eq!(second.character_states.inserted, 0);
        let current_after_match: String = conn.query_row(
            "SELECT current_state FROM characters WHERE id = ?1",
            params![&fixture.character_id],
            |row| row.get(0),
        )?;
        assert_eq!(current_after_match, "stable latest state");
        let state_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM character_states WHERE character_id = ?1",
            params![&fixture.character_id],
            |row| row.get(0),
        )?;
        assert_eq!(state_count, 2);
        Ok(())
    }

    #[test]
    fn legacy_context_migration_skips_ambiguous_mirrors_without_deletion(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_chapter_context_test_database()?;
        let fixture = seed_chapter_context_fixture(&conn, 7, 0)?;
        let base = test_context_input(&fixture, None, "ambiguous", "same");
        for (id, timestamp) in [
            (uuid::Uuid::new_v4().to_string(), "first"),
            (uuid::Uuid::new_v4().to_string(), "second"),
        ] {
            conn.execute(
                "INSERT INTO context_records
                 (id, novel_id, chapter_id, volume_id, context_type, title, content,
                  importance, is_active, is_expired, content_hash, draft_version,
                  created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 4, 1, 0, ?8, 1, ?9, ?9)",
                params![
                    id,
                    &base.novel_id,
                    &base.chapter_id,
                    &base.volume_id,
                    &base.context_type,
                    &base.title,
                    &base.content,
                    &base.content_hash,
                    timestamp,
                ],
            )?;
        }
        let source_id = uuid::Uuid::new_v4().to_string();
        let mut legacy_data = base;
        legacy_data.id = Some(source_id.clone());
        let migration = MigrateLegacyChapterContextInput {
            chapter_summaries: vec![],
            context_records: vec![LegacyContextRecordInput {
                data: legacy_data,
                is_expired: Some(false),
                created_at: None,
                updated_at: None,
            }],
            character_states: vec![],
        };
        let result = migrate_legacy_chapter_context_internal(&mut conn, &migration)?;
        assert_eq!(result.context_records.skipped, 1);
        assert!(result.warnings[0].contains("ambiguous_fingerprint_and_timestamps"));
        assert!(!result.id_map.contains_key(&source_id));
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM context_records WHERE novel_id = ?1",
            params![fixture.novel_id],
            |row| row.get(0),
        )?;
        assert_eq!(count, 2);
        Ok(())
    }

    #[test]
    fn context_and_summary_queries_have_stable_tie_breakers(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = create_chapter_context_test_database()?;
        let later_chapter = seed_chapter_context_fixture(&conn, 8, 2)?;
        let earlier_chapter = ChapterContextFixture {
            novel_id: later_chapter.novel_id.clone(),
            volume_id: later_chapter.volume_id.clone(),
            chapter_id: uuid::Uuid::new_v4().to_string(),
            draft_id: uuid::Uuid::new_v4().to_string(),
            character_id: later_chapter.character_id.clone(),
        };
        conn.execute(
            "INSERT INTO chapters
             (id, novel_id, volume_id, adopted_draft_id, status, order_index, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'adopted', 1, 'before')",
            params![
                &earlier_chapter.chapter_id,
                &earlier_chapter.novel_id,
                &earlier_chapter.volume_id,
                &earlier_chapter.draft_id
            ],
        )?;
        conn.execute(
            "INSERT INTO chapter_drafts (id, novel_id, chapter_id, is_adopted)
             VALUES (?1, ?2, ?3, 1)",
            params![
                &earlier_chapter.draft_id,
                &earlier_chapter.novel_id,
                &earlier_chapter.chapter_id
            ],
        )?;
        let low_summary_id = "00000000-0000-0000-0000-00000000ff01".to_string();
        let high_summary_id = "00000000-0000-0000-0000-00000000ff02".to_string();
        upsert_chapter_summary(
            &conn,
            &test_summary_input(&later_chapter, Some(low_summary_id.clone()), "lower tie"),
            "same-time",
        )?;
        upsert_chapter_summary(
            &conn,
            &test_summary_input(&later_chapter, Some(high_summary_id.clone()), "higher tie"),
            "same-time",
        )?;
        let early_summary_id = uuid::Uuid::new_v4().to_string();
        upsert_chapter_summary(
            &conn,
            &test_summary_input(
                &earlier_chapter,
                Some(early_summary_id.clone()),
                "earlier chapter",
            ),
            "same-time",
        )?;
        assert_eq!(
            get_chapter_summary_internal(&conn, &later_chapter.chapter_id)?
                .expect("summary")
                .id,
            high_summary_id
        );
        let summaries = get_chapter_summaries_by_novel_internal(&conn, &later_chapter.novel_id)?;
        assert_eq!(summaries[0].id, early_summary_id);
        assert_eq!(summaries[1].id, high_summary_id);
        assert_eq!(summaries[2].id, low_summary_id);

        for id in [
            "00000000-0000-0000-0000-00000000ee01",
            "00000000-0000-0000-0000-00000000ee02",
        ] {
            conn.execute(
                "INSERT INTO context_records
                 (id, novel_id, chapter_id, volume_id, context_type, title, content,
                  importance, is_active, is_expired, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'other', 'tie', 'tie', 3, 1, 0, 'same-time', 'same-time')",
                params![
                    id,
                    &later_chapter.novel_id,
                    &later_chapter.chapter_id,
                    &later_chapter.volume_id
                ],
            )?;
        }
        let contexts = get_context_records_internal(&conn, &later_chapter.novel_id)?;
        assert_eq!(contexts[0].id, "00000000-0000-0000-0000-00000000ee02");
        assert_eq!(contexts[1].id, "00000000-0000-0000-0000-00000000ee01");
        Ok(())
    }

    #[test]
    fn ai_task_projection_replay_preserves_terminal_record_and_draft_foreign_key(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            CREATE TABLE ai_task_records (
                id TEXT PRIMARY KEY,
                novel_id TEXT,
                chapter_id TEXT,
                task_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                runtime_mode TEXT,
                provider TEXT,
                model_name TEXT,
                prompt_template_id TEXT,
                input_summary TEXT,
                prompt_snapshot TEXT,
                result_text TEXT,
                result_json TEXT,
                error_message TEXT,
                token_input INTEGER,
                token_output INTEGER,
                token_total INTEGER,
                input_price_per_million_tokens REAL,
                output_price_per_million_tokens REAL,
                cost_estimate REAL,
                cost_currency TEXT,
                cost_status TEXT,
                pricing_source TEXT,
                duration_ms INTEGER,
                started_at TEXT,
                finished_at TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE chapter_drafts (
                id TEXT PRIMARY KEY,
                ai_task_id TEXT,
                FOREIGN KEY (ai_task_id) REFERENCES ai_task_records(id)
            );
            ",
        )?;
        let input = CreateAiTaskRecordInput {
            id: "formal-task-1".to_string(),
            novel_id: Some("novel-1".to_string()),
            chapter_id: Some("chapter-1".to_string()),
            task_type: "chapter_generate".to_string(),
            status: "running".to_string(),
            runtime_mode: Some("mock".to_string()),
            provider: Some("mock".to_string()),
            model_name: Some("Mock".to_string()),
            input_price_per_million_tokens: Some(0.0),
            output_price_per_million_tokens: Some(0.0),
            cost_currency: Some("USD".to_string()),
            pricing_source: Some("mock".to_string()),
            input_summary: Some("first projection".to_string()),
            started_at: Some("2026-07-29T00:00:00Z".to_string()),
            created_at: "2026-07-29T00:00:00Z".to_string(),
        };
        assert_eq!(
            create_ai_task_record_internal(&conn, &input)?.status,
            "running"
        );
        mark_ai_task_succeeded_internal(
            &conn,
            &input.id,
            &MarkAiTaskSucceededInput {
                result_text: Some("terminal result".to_string()),
                prompt_snapshot: None,
                result_json: None,
                token_input: Some(2),
                token_output: Some(3),
                token_total: Some(5),
                duration_ms: Some(10),
                finished_at: "2026-07-29T00:00:01Z".to_string(),
            },
        )?;
        conn.execute(
            "INSERT INTO chapter_drafts (id, ai_task_id) VALUES ('draft-1', ?1)",
            params![&input.id],
        )?;

        let replayed = create_ai_task_record_internal(
            &conn,
            &CreateAiTaskRecordInput {
                input_summary: Some("replayed projection".to_string()),
                created_at: "2026-07-29T00:00:02Z".to_string(),
                ..input
            },
        )?;
        assert_eq!(replayed.status, "succeeded");
        assert_eq!(replayed.result_text.as_deref(), Some("terminal result"));
        assert_eq!(replayed.input_summary.as_deref(), Some("first projection"));
        let conflict = create_ai_task_record_internal(
            &conn,
            &CreateAiTaskRecordInput {
                id: "formal-task-1".to_string(),
                novel_id: Some("other-novel".to_string()),
                chapter_id: Some("chapter-1".to_string()),
                task_type: "chapter_generate".to_string(),
                status: "running".to_string(),
                runtime_mode: Some("mock".to_string()),
                provider: Some("mock".to_string()),
                model_name: Some("Mock".to_string()),
                input_price_per_million_tokens: Some(0.0),
                output_price_per_million_tokens: Some(0.0),
                cost_currency: Some("USD".to_string()),
                pricing_source: Some("mock".to_string()),
                input_summary: None,
                started_at: Some("2026-07-29T00:00:03Z".to_string()),
                created_at: "2026-07-29T00:00:03Z".to_string(),
            },
        )
        .expect_err("same projection id with different ownership must fail");
        assert_eq!(conflict, "ai_task_projection_identity_conflict");
        let draft_task_id: Option<String> = conn.query_row(
            "SELECT ai_task_id FROM chapter_drafts WHERE id = 'draft-1'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(draft_task_id.as_deref(), Some("formal-task-1"));
        let foreign_key_violations: i64 =
            conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })?;
        assert_eq!(foreign_key_violations, 0);
        Ok(())
    }

    #[test]
    fn ai_task_cancellation_is_terminal_and_idempotent() -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "
            CREATE TABLE ai_task_records (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                error_message TEXT,
                duration_ms INTEGER,
                finished_at TEXT
            );
            INSERT INTO ai_task_records (id, status) VALUES ('running-task', 'running');
            INSERT INTO ai_task_records (id, status) VALUES ('succeeded-task', 'succeeded');
            ",
        )?;

        assert_eq!(
            mark_ai_task_cancelled_internal(
                &conn,
                "running-task",
                "2026-07-21T09:00:00Z",
                Some(125),
            )?,
            1
        );
        assert_eq!(
            mark_ai_task_cancelled_internal(
                &conn,
                "running-task",
                "2026-07-21T09:00:01Z",
                Some(250),
            )?,
            0
        );
        assert_eq!(
            mark_ai_task_cancelled_internal(
                &conn,
                "succeeded-task",
                "2026-07-21T09:00:02Z",
                Some(375),
            )?,
            0
        );

        let cancelled: (String, Option<i64>, Option<String>) = conn.query_row(
            "SELECT status, duration_ms, finished_at FROM ai_task_records WHERE id = 'running-task'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        assert_eq!(cancelled.0, "cancelled");
        assert_eq!(cancelled.1, Some(125));
        assert_eq!(cancelled.2.as_deref(), Some("2026-07-21T09:00:00Z"));

        let succeeded: String = conn.query_row(
            "SELECT status FROM ai_task_records WHERE id = 'succeeded-task'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(succeeded, "succeeded");
        Ok(())
    }

    #[test]
    fn ai_task_retry_reopens_only_failed_compatibility_projection(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "
            CREATE TABLE ai_task_records (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                error_message TEXT,
                duration_ms INTEGER,
                started_at TEXT,
                finished_at TEXT
            );
            INSERT INTO ai_task_records
                (id, status, error_message, duration_ms, started_at, finished_at)
            VALUES
                ('failed-task', 'failed', 'retryable', 10, 'before', 'finished'),
                ('succeeded-task', 'succeeded', NULL, 12, 'before', 'finished');
            ",
        )?;

        assert_eq!(
            mark_ai_task_running_for_retry_internal(&conn, "failed-task", "retry-start")?,
            1
        );
        assert_eq!(
            mark_ai_task_running_for_retry_internal(&conn, "succeeded-task", "must-not-change")?,
            0
        );
        let failed: (String, Option<String>, Option<i64>, String, Option<String>) = conn
            .query_row(
                "SELECT status, error_message, duration_ms, started_at, finished_at
                 FROM ai_task_records WHERE id = 'failed-task'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )?;
        assert_eq!(
            failed,
            (
                "running".to_string(),
                None,
                None,
                "retry-start".to_string(),
                None
            )
        );
        let succeeded: (String, String) = conn.query_row(
            "SELECT status, started_at FROM ai_task_records WHERE id = 'succeeded-task'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(succeeded, ("succeeded".to_string(), "before".to_string()));
        Ok(())
    }

    #[test]
    fn ai_task_success_calculates_cost_from_frozen_pricing(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "
            CREATE TABLE ai_task_records (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                result_text TEXT,
                prompt_snapshot TEXT,
                result_json TEXT,
                error_message TEXT,
                token_input INTEGER,
                token_output INTEGER,
                token_total INTEGER,
                input_price_per_million_tokens REAL,
                output_price_per_million_tokens REAL,
                cost_estimate REAL,
                cost_status TEXT,
                pricing_source TEXT,
                duration_ms INTEGER,
                finished_at TEXT
            );
            INSERT INTO ai_task_records
                (id, status, input_price_per_million_tokens, output_price_per_million_tokens, pricing_source)
            VALUES ('configured', 'running', 2.0, 8.0, 'user_configured');
            INSERT INTO ai_task_records (id, status, pricing_source)
            VALUES ('unpriced', 'running', 'unconfigured');
            INSERT INTO ai_task_records
                (id, status, input_price_per_million_tokens, output_price_per_million_tokens, pricing_source)
            VALUES ('mock', 'running', 0.0, 0.0, 'mock');
            ",
        )?;

        let success = |input_tokens, output_tokens| MarkAiTaskSucceededInput {
            result_text: Some("ok".to_string()),
            prompt_snapshot: None,
            result_json: None,
            token_input: input_tokens,
            token_output: output_tokens,
            token_total: input_tokens
                .zip(output_tokens)
                .map(|(left, right)| left + right),
            duration_ms: Some(10),
            finished_at: "2026-07-28T10:00:00Z".to_string(),
        };
        assert_eq!(
            mark_ai_task_succeeded_internal(
                &conn,
                "configured",
                &success(Some(250_000), Some(125_000)),
            )?,
            1
        );
        assert_eq!(
            mark_ai_task_succeeded_internal(&conn, "unpriced", &success(Some(10), Some(20)),)?,
            1
        );
        assert_eq!(
            mark_ai_task_succeeded_internal(&conn, "mock", &success(None, None))?,
            1
        );

        let configured: (f64, String) = conn.query_row(
            "SELECT cost_estimate, cost_status FROM ai_task_records WHERE id = 'configured'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(configured, (1.5, "complete".to_string()));
        let unpriced: (Option<f64>, String) = conn.query_row(
            "SELECT cost_estimate, cost_status FROM ai_task_records WHERE id = 'unpriced'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(unpriced, (None, "unpriced".to_string()));
        let mock: (f64, String) = conn.query_row(
            "SELECT cost_estimate, cost_status FROM ai_task_records WHERE id = 'mock'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(mock, (0.0, "mock".to_string()));
        Ok(())
    }

    #[test]
    fn ai_task_success_rejects_negative_usage_and_duration() {
        let conn = Connection::open_in_memory().unwrap();
        for (field, token_input, token_output, token_total, duration_ms) in [
            ("tokenInput", Some(-1), Some(0), Some(0), Some(0)),
            ("tokenOutput", Some(0), Some(-1), Some(0), Some(0)),
            ("tokenTotal", Some(0), Some(0), Some(-1), Some(0)),
            ("durationMs", Some(0), Some(0), Some(0), Some(-1)),
        ] {
            let input = MarkAiTaskSucceededInput {
                result_text: Some("must-not-persist".to_string()),
                prompt_snapshot: None,
                result_json: None,
                token_input,
                token_output,
                token_total,
                duration_ms,
                finished_at: "2026-07-28T10:00:00Z".to_string(),
            };
            assert_eq!(
                mark_ai_task_succeeded_internal(&conn, "task", &input).unwrap_err(),
                format!("{field} must be non-negative")
            );
        }
    }

    #[test]
    fn save_style_profile_rejects_cross_novel_reference_binding(
    ) -> Result<(), Box<dyn std::error::Error>> {
        crate::db::init_test_database();
        let suffix = uuid::Uuid::new_v4().to_string();
        let source_novel_id = format!("style-source-novel-{suffix}");
        let target_novel_id = format!("style-target-novel-{suffix}");
        let work_id = format!("style-reference-work-{suffix}");
        let import_id = format!("style-reference-import-{suffix}");
        let profile_name = format!("cross-scope-profile-{suffix}");
        let source_hash = "a".repeat(64);
        {
            let connection = crate::db::get_connection()
                .lock()
                .expect("lock style reference test database");
            connection.execute(
                "INSERT INTO novels (id, title, created_at, updated_at)
                 VALUES (?1, 'source novel', 'now', 'now'), (?2, 'target novel', 'now', 'now')",
                params![source_novel_id, target_novel_id],
            )?;
            connection.execute(
                "INSERT INTO reference_works
                    (id, novel_id, title, purpose, revision, created_at, updated_at)
                 VALUES (?1, ?2, 'reference', 'style', 1, 'now', 'now')",
                params![work_id, source_novel_id],
            )?;
            connection.execute(
                "INSERT INTO reference_imports
                    (id, reference_work_id, novel_id, version_no, is_current, operation_id,
                     request_hash, file_name, source_format, source_sha256, source_byte_count,
                     selected_encoding, encoding_source, decoded_text_sha256,
                     decoded_char_count, decoded_utf8_byte_count, source_text, section_count,
                     parser_version, section_plan_sha256, warnings_json, imported_at)
                 VALUES (?1, ?2, ?3, 1, 1, ?4, ?5, 'reference.txt', 'txt', ?6, 1,
                         'utf-8', 'utf8_valid', ?7, 1, 1, 'x', 1,
                         'reference_txt_parser_v1', ?8, '[]', 'now')",
                params![
                    import_id,
                    work_id,
                    source_novel_id,
                    format!("style-reference-operation-{suffix}"),
                    "b".repeat(64),
                    source_hash,
                    "c".repeat(64),
                    "d".repeat(64),
                ],
            )?;
        }

        let error = save_style_profile(
            None,
            SaveStyleProfileInput {
                project_id: target_novel_id.clone(),
                name: profile_name.clone(),
                description: None,
                narrative_perspective: None,
                tone: None,
                pace: None,
                sentence_style: None,
                dialogue_ratio: None,
                description_ratio: None,
                psychological_ratio: None,
                battle_style: None,
                battle_intensity: None,
                emotion_tendency: None,
                chapter_ending: None,
                forbidden_styles: None,
                style_summary: None,
                raw_config_json: None,
                source_type: Some("ai_analyzed".to_string()),
                source_asset_id: None,
                source_reference_work_id: Some(work_id),
                source_reference_import_id: Some(import_id),
                source_content_sha256: Some(source_hash),
                source_state: Some("available".to_string()),
                analysis_metadata_json: Some("{}".to_string()),
            },
        )
        .expect_err("cross-novel reference binding must fail");
        assert!(error.starts_with("REFERENCE_SCOPE_MISMATCH:"), "{error}");
        let connection = crate::db::get_connection()
            .lock()
            .expect("lock style reference test database");
        let persisted: i64 = connection.query_row(
            "SELECT COUNT(*) FROM style_profiles WHERE novel_id = ?1 AND name = ?2",
            params![target_novel_id, profile_name],
            |row| row.get(0),
        )?;
        assert_eq!(persisted, 0);
        Ok(())
    }

    #[test]
    fn ai_task_count_applies_server_side_type_and_status_filters(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "CREATE TABLE ai_task_records (
                id TEXT PRIMARY KEY,
                task_type TEXT NOT NULL,
                status TEXT NOT NULL
            );
            INSERT INTO ai_task_records (id, task_type, status) VALUES
                ('a', 'chapter_generate', 'succeeded'),
                ('b', 'chapter_generate', 'failed'),
                ('c', 'quality_check', 'succeeded');",
        )?;

        assert_eq!(
            count_ai_task_records_filtered_in_conn(&conn, None, None)?,
            3
        );
        assert_eq!(
            count_ai_task_records_filtered_in_conn(&conn, Some("chapter_generate"), None)?,
            2
        );
        assert_eq!(
            count_ai_task_records_filtered_in_conn(&conn, None, Some("succeeded"))?,
            2
        );
        assert_eq!(
            count_ai_task_records_filtered_in_conn(
                &conn,
                Some("chapter_generate"),
                Some("succeeded"),
            )?,
            1
        );
        assert!(normalize_ai_task_type_filter(Some("unknown".to_string())).is_err());
        assert!(normalize_ai_task_status_filter(Some("unknown".to_string())).is_err());
        Ok(())
    }

    #[test]
    fn quality_fix_round_guard_allows_idempotent_update_but_rejects_second_run(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "CREATE TABLE quality_fix_runs (
                id TEXT PRIMARY KEY,
                chapter_id TEXT NOT NULL,
                source_draft_id TEXT NOT NULL
            );
            INSERT INTO quality_fix_runs (id, chapter_id, source_draft_id)
            VALUES ('run-1', 'chapter-1', 'draft-1');",
        )?;

        assert!(!has_other_quality_fix_round(
            &conn,
            "chapter-1",
            "draft-1",
            "run-1",
        )?);
        assert!(has_other_quality_fix_round(
            &conn,
            "chapter-1",
            "draft-1",
            "run-2",
        )?);
        assert!(!has_other_quality_fix_round(
            &conn,
            "chapter-1",
            "draft-2",
            "run-2",
        )?);
        Ok(())
    }
}
