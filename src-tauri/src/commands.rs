use crate::db::{get_connection, get_database_path};
use rusqlite::{params, Connection, Row, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

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
    let mut sets = vec![format!("updated_at = '{}'", now)];
    if let Some(ref v) = input.title {
        sets.push(format!("title = '{}'", v.replace('\'', "''")));
    }
    if let Some(ref v) = input.summary {
        sets.push(format!("summary = '{}'", v.replace('\'', "''")));
    }
    if let Some(ref v) = input.goal {
        sets.push(format!("goal = '{}'", v.replace('\'', "''")));
    }
    if let Some(ref v) = input.main_conflict {
        sets.push(format!("main_conflict = '{}'", v.replace('\'', "''")));
    }
    if let Some(v) = input.order_index {
        sets.push(format!("order_index = {}", v));
    }
    if let Some(ref v) = input.status {
        sets.push(format!("status = '{}'", v));
    }
    let sql = format!("UPDATE volumes SET {} WHERE id = '{}'", sets.join(", "), id);
    conn.execute(&sql, []).map_err(|e| e.to_string())?;
    get_volume_by_id_internal(&conn, &id)
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
    let mut sets = vec![format!("updated_at = '{}'", now)];
    if let Some(ref v) = input.volume_id {
        sets.push(format!("volume_id = '{}'", v));
    }
    if let Some(ref v) = input.title {
        sets.push(format!("title = '{}'", v.replace('\'', "''")));
    }
    if let Some(ref v) = input.outline {
        sets.push(format!("outline = '{}'", v.replace('\'', "''")));
    }
    if let Some(ref v) = input.goal {
        sets.push(format!("goal = '{}'", v.replace('\'', "''")));
    }
    if let Some(v) = input.order_index {
        sets.push(format!("order_index = {}", v));
    }
    if let Some(ref v) = input.status {
        sets.push(format!("status = '{}'", v));
    }
    if let Some(v) = input.target_word_count {
        sets.push(format!("target_word_count = {}", v));
    }
    let sql = format!(
        "UPDATE chapters SET {} WHERE id = '{}'",
        sets.join(", "),
        id
    );
    conn.execute(&sql, []).map_err(|e| e.to_string())?;
    get_chapter_by_id_internal(&conn, &id)
}

#[tauri::command]
pub fn delete_chapter(id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE chapters SET deleted_at = ?1 WHERE id = ?2",
        params![now, id],
    )
    .map_err(|e| e.to_string())?;
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
pub fn get_drafts_by_chapter_id(chapter_id: String) -> Result<Vec<ChapterDraftDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, ai_task_id, note, large_text_ref_id, created_at, updated_at FROM chapter_drafts WHERE chapter_id = ?1 ORDER BY version_no ASC")
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![chapter_id], map_draft_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
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
        duration_ms: row.get(17)?,
        started_at: row.get(18)?,
        finished_at: row.get(19)?,
        created_at: row.get(20)?,
    })
}

fn ai_task_select_sql() -> &'static str {
    "SELECT id, novel_id, chapter_id, task_type, status, runtime_mode, provider, model_name, prompt_template_id, input_summary, prompt_snapshot, result_text, result_json, error_message, token_input, token_output, token_total, duration_ms, started_at, finished_at, created_at FROM ai_task_records"
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
    println!(
        "[AI_TASK_DELETE_RUST] delete_many command_entered db_path={} table_exists={} requested_count={} ids={:?}",
        db_path, table_exists, requested_count, ids
    );
    ensure_ai_task_records_table(conn, &db_path)?;
    let before_count = count_ai_task_records_in_conn(conn)?;

    if ids.is_empty() {
        println!(
            "[AI_TASK_DELETE_RUST] delete_many skipped empty ids db_path={} before_count={}",
            db_path, before_count
        );
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
    println!(
        "[AI_TASK_DELETE_RUST] delete_many called ids={:?} db_path={} before_count={} before_match_count={}",
        ids, db_path, before_count, before_match_count
    );

    if before_match_count == 0 {
        let sample_ids = sample_ai_task_ids(conn, 5)?;
        println!(
            "[AI_TASK_DELETE_RUST] delete_many no matching ids requested={:?} sample_existing_ids={:?}",
            ids, sample_ids
        );
        return Err(format!(
            "No AI task records matched selected ids. requested_ids={:?}, sample_existing_ids={:?}, db_path={}",
            ids, sample_ids, db_path
        ));
    }
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
                    println!(
                        "[AI_TASK_DELETE_RUST] delete_many cleaned child table {} rows={}",
                        table, rows
                    );
                    deleted_child_rows.insert(table.to_string(), rows as i64);
                }
            }
            Err(e) => {
                let msg = format!("Failed to clean child table {}: {}", table, e);
                println!("[AI_TASK_DELETE_RUST] delete_many rollback: {}", msg);
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
                let msg = format!("Failed to delete ai_task_record {}: {}", id, e);
                println!("[AI_TASK_DELETE_RUST] delete_many rollback: {}", msg);
                let _ = conn.execute_batch("ROLLBACK");
                return Err(msg);
            }
        }
    }

    let after_match_count = count_ai_task_records_by_ids(conn, &ids)?;
    let after_count = count_ai_task_records_in_conn(conn)?;
    let deleted_count = before_match_count - after_match_count;

    println!(
        "[AI_TASK_DELETE_RUST] delete_many result db_path={} before_count={} before_match_count={} affected_rows={} after_match_count={} after_count={} deleted_count={} deleted_child_rows={:?}",
        db_path,
        before_count,
        before_match_count,
        affected_rows,
        after_match_count,
        after_count,
        deleted_count,
        deleted_child_rows
    );

    if before_match_count > 0 && after_match_count > 0 {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(format!(
            "AI task records still exist after delete. requested_ids={:?}, after_match_count={}, db_path={}",
            ids, after_match_count, db_path
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
    println!(
        "[AI_TASK_DELETE_RUST] clear_all command_entered db_path={} table_exists={}",
        db_path, table_exists
    );
    ensure_ai_task_records_table(conn, &db_path)?;
    let before_count = count_ai_task_records_in_conn(conn)?;
    println!(
        "[AI_TASK_DELETE_RUST] clear_all called db_path={} before_count={}",
        db_path, before_count
    );
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
                    println!(
                        "[AI_TASK_DELETE_RUST] clear_all cleaned child table {} rows={}",
                        table, rows
                    );
                    deleted_child_rows.insert(table.to_string(), rows as i64);
                }
            }
            Err(e) => {
                let msg = format!("Failed to clean child table {}: {}", table, e);
                println!("[AI_TASK_DELETE_RUST] clear_all rollback: {}", msg);
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
            println!("[AI_TASK_DELETE_RUST] clear_all rollback: {}", msg);
            let _ = conn.execute_batch("ROLLBACK");
            msg
        })? as i64;

    let after_count = count_ai_task_records_in_conn(conn)?;
    let deleted_count = before_count - after_count;
    println!(
        "[AI_TASK_DELETE_RUST] clear_all result db_path={} before_count={} affected_rows={} after_count={} deleted_count={} deleted_child_rows={:?}",
        db_path, before_count, affected_rows, after_count, deleted_count, deleted_child_rows
    );

    if after_count != 0 {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(format!(
            "AI task records still exist after clear. after_count={}, db_path={}",
            after_count, db_path
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

#[tauri::command]
pub fn create_ai_task_record(input: CreateAiTaskRecordInput) -> Result<AiTaskRecordDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let id = input.id.clone();
    conn.execute(
        "INSERT OR REPLACE INTO ai_task_records (id, novel_id, chapter_id, task_type, status, runtime_mode, provider, model_name, input_summary, started_at, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![
            input.id,
            input.novel_id,
            input.chapter_id,
            input.task_type,
            input.status,
            input.runtime_mode,
            input.provider,
            input.model_name,
            input.input_summary,
            input.started_at,
            input.created_at,
        ],
    ).map_err(|e| e.to_string())?;

    get_ai_task_record_by_id_internal(&conn, &id)
}

#[tauri::command]
pub fn mark_ai_task_succeeded(id: String, input: MarkAiTaskSucceededInput) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE ai_task_records SET status = 'succeeded', result_text = ?1, prompt_snapshot = ?2, result_json = ?3, error_message = NULL, token_input = ?4, token_output = ?5, token_total = ?6, duration_ms = ?7, finished_at = ?8 WHERE id = ?9 AND status IN ('pending', 'running')",
        params![
            input.result_text,
            input.prompt_snapshot,
            input.result_json,
            input.token_input,
            input.token_output,
            input.token_total,
            input.duration_ms,
            input.finished_at,
            id,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
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
) -> Result<Vec<AiTaskRecordDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let db_path = ai_task_db_path_for_log();
    let page = page.unwrap_or(1).max(1);
    let size = size.unwrap_or(20).clamp(1, 500);
    let offset = (page - 1) * size;
    let sql = format!(
        "{} ORDER BY created_at DESC LIMIT ?1 OFFSET ?2",
        ai_task_select_sql()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let result = stmt
        .query_map(params![size, offset], map_ai_task_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    if let Ok(items) = &result {
        println!(
            "[AI_TASK_READ_RUST] get_ai_task_records db_path={} page={} size={} returned={}",
            db_path,
            page,
            size,
            items.len()
        );
    }
    result
}

#[tauri::command]
pub fn count_ai_task_records() -> Result<i64, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let db_path = ai_task_db_path_for_log();
    let count = count_ai_task_records_in_conn(&conn)?;
    println!(
        "[AI_TASK_READ_RUST] count_ai_task_records db_path={} count={}",
        db_path, count
    );
    Ok(count)
}

#[tauri::command]
pub fn delete_ai_task_record(id: String) -> Result<DeleteAiTaskRecordsResult, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let db_path = ai_task_db_path_for_log();
    println!(
        "[AI_TASK_DELETE_RUST] delete_one called id={} db_path={}",
        id, db_path
    );
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
    println!(
        "[AI_TASK_DEBUG_RUST] state db_path={} table_exists={} total_count={} matched_count={:?} ids={:?} sample_ids={:?}",
        db_path, table_exists, total_count, matched_count, normalized_ids, sample_ids
    );
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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    })
}

fn style_select_sql() -> &'static str {
    "SELECT id, novel_id, name, description, narrative_perspective, tone, pace, sentence_style, dialogue_ratio, description_ratio, psychological_ratio, battle_style, battle_intensity, emotion_tendency, chapter_ending, forbidden_styles, style_summary, is_active, raw_config_json, source_type, created_at, updated_at FROM style_profiles"
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

    if let Some(existing_id) = id {
        conn.execute(
            "UPDATE style_profiles SET name = ?1, description = ?2, narrative_perspective = ?3, tone = ?4, pace = ?5, sentence_style = ?6, dialogue_ratio = ?7, description_ratio = ?8, psychological_ratio = ?9, battle_style = ?10, battle_intensity = ?11, emotion_tendency = ?12, chapter_ending = ?13, forbidden_styles = ?14, style_summary = ?15, raw_config_json = ?16, source_type = ?17, updated_at = ?18 WHERE id = ?19 AND novel_id = ?20",
            params![
                &input.name, &input.description,
                &input.narrative_perspective, &input.tone, &input.pace, &input.sentence_style,
                input.dialogue_ratio.unwrap_or(0.35), input.description_ratio.unwrap_or(0.4),
                input.psychological_ratio, &input.battle_style, &input.battle_intensity,
                &input.emotion_tendency, &input.chapter_ending,
                &forbidden_json, &input.style_summary, &input.raw_config_json,
                &source_type, &now, &existing_id, &input.project_id,
            ],
        ).map_err(|e| e.to_string())?;
        get_style_profile_by_id_internal(&conn, &existing_id)
    } else {
        let new_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO style_profiles (id, novel_id, name, description, narrative_perspective, tone, pace, sentence_style, dialogue_ratio, description_ratio, psychological_ratio, battle_style, battle_intensity, emotion_tendency, chapter_ending, forbidden_styles, style_summary, is_active, raw_config_json, source_type, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,0,?18,?19,?20,?20)",
            params![
                &new_id, &input.project_id, &input.name, &input.description,
                &input.narrative_perspective, &input.tone, &input.pace, &input.sentence_style,
                input.dialogue_ratio.unwrap_or(0.35), input.description_ratio.unwrap_or(0.4),
                input.psychological_ratio, &input.battle_style, &input.battle_intensity,
                &input.emotion_tendency, &input.chapter_ending,
                &forbidden_json, &input.style_summary, &input.raw_config_json,
                &source_type, &now,
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
    println!(
        "[QUALITY_CHECK] create_report start id={} novel_id={} chapter_id={} draft_id={}",
        id, input.novel_id, input.chapter_id, input.draft_id
    );

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
    println!(
        "[QUALITY_CHECK] create_report done id={} chapter_id={}",
        id, input.chapter_id
    );

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
    println!(
        "[QUALITY_CHECK] save_result start report_id={} chapter_id={} item_count={}",
        input.report_id,
        input.chapter_id,
        input.result.items.len()
    );
    let mut conn = get_connection().lock().map_err(|error| error.to_string())?;
    let result = save_quality_check_result_internal(&mut conn, &input);
    if result.is_ok() {
        println!(
            "[QUALITY_CHECK] save_result done report_id={} chapter_id={}",
            input.report_id, input.chapter_id
        );
    }
    result
}

// ==================== Chapter Summary ====================

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Deserialize)]
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

/// 保存章节总结（创建或更新）
#[tauri::command]
pub fn save_chapter_summary(input: SaveChapterSummaryInput) -> Result<ChapterSummaryDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let enabled = input.enabled.unwrap_or(true) as i64;

    if let Some(ref existing_id) = input.id {
        conn.execute(
            "UPDATE chapter_summaries SET volume_id=?1, summary=?2, key_events=?3, character_changes=?4, relationship_changes=?5, new_foreshadows=?6, resolved_foreshadows=?7, next_chapter_hints=?8, core_events=?9, protagonist_state_change=?10, important_character_changes=?11, setting_changes=?12, new_locations=?13, new_items_or_abilities=?14, foreshadowing=?15, unresolved_questions=?16, facts_must_remember=?17, next_chapter_hook=?18, validation_status=?19, validation_result=?20, enabled=?21, content_hash=?22, draft_version=?23, is_expired=0, updated_at=?24 WHERE id=?25",
            params![
                &input.volume_id, &input.summary, &input.key_events, &input.character_changes,
                &input.relationship_changes, &input.new_foreshadows, &input.resolved_foreshadows,
                &input.next_chapter_hints, &input.core_events, &input.protagonist_state_change,
                &input.important_character_changes, &input.setting_changes, &input.new_locations,
                &input.new_items_or_abilities, &input.foreshadowing, &input.unresolved_questions,
                &input.facts_must_remember, &input.next_chapter_hook, &input.validation_status,
                &input.validation_result, &enabled, &input.content_hash, &input.draft_version,
                &now, existing_id,
            ],
        ).map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT id, novel_id, chapter_id, volume_id, adopted_draft_id, summary, key_events, character_changes, relationship_changes, new_foreshadows, resolved_foreshadows, next_chapter_hints, core_events, protagonist_state_change, important_character_changes, setting_changes, new_locations, new_items_or_abilities, foreshadowing, unresolved_questions, facts_must_remember, next_chapter_hook, validation_status, validation_result, enabled, content_hash, draft_version, is_expired, ai_task_id, created_at, updated_at FROM chapter_summaries WHERE id=?1").map_err(|e| e.to_string())?;
        stmt.query_row(params![existing_id], map_chapter_summary_row)
            .map_err(|e| e.to_string())
    } else {
        let new_id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO chapter_summaries (id, novel_id, chapter_id, volume_id, adopted_draft_id, summary, key_events, character_changes, relationship_changes, new_foreshadows, resolved_foreshadows, next_chapter_hints, core_events, protagonist_state_change, important_character_changes, setting_changes, new_locations, new_items_or_abilities, foreshadowing, unresolved_questions, facts_must_remember, next_chapter_hook, validation_status, validation_result, enabled, content_hash, draft_version, is_expired, ai_task_id, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,0,?28,?29,?29)",
            params![
                &new_id, &input.novel_id, &input.chapter_id, &input.volume_id,
                &input.adopted_draft_id, &input.summary, &input.key_events, &input.character_changes,
                &input.relationship_changes, &input.new_foreshadows, &input.resolved_foreshadows,
                &input.next_chapter_hints, &input.core_events, &input.protagonist_state_change,
                &input.important_character_changes, &input.setting_changes, &input.new_locations,
                &input.new_items_or_abilities, &input.foreshadowing, &input.unresolved_questions,
                &input.facts_must_remember, &input.next_chapter_hook, &input.validation_status,
                &input.validation_result, &enabled, &input.content_hash, &input.draft_version,
                &input.ai_task_id, &now,
            ],
        ).map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT id, novel_id, chapter_id, volume_id, adopted_draft_id, summary, key_events, character_changes, relationship_changes, new_foreshadows, resolved_foreshadows, next_chapter_hints, core_events, protagonist_state_change, important_character_changes, setting_changes, new_locations, new_items_or_abilities, foreshadowing, unresolved_questions, facts_must_remember, next_chapter_hook, validation_status, validation_result, enabled, content_hash, draft_version, is_expired, ai_task_id, created_at, updated_at FROM chapter_summaries WHERE id=?1").map_err(|e| e.to_string())?;
        stmt.query_row(params![&new_id], map_chapter_summary_row)
            .map_err(|e| e.to_string())
    }
}

/// 按章节获取总结
#[tauri::command]
pub fn get_chapter_summary(chapter_id: String) -> Result<Option<ChapterSummaryDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, novel_id, chapter_id, volume_id, adopted_draft_id, summary, key_events, character_changes, relationship_changes, new_foreshadows, resolved_foreshadows, next_chapter_hints, core_events, protagonist_state_change, important_character_changes, setting_changes, new_locations, new_items_or_abilities, foreshadowing, unresolved_questions, facts_must_remember, next_chapter_hook, validation_status, validation_result, enabled, content_hash, draft_version, is_expired, ai_task_id, created_at, updated_at FROM chapter_summaries WHERE chapter_id=?1 LIMIT 1").map_err(|e| e.to_string())?;
    stmt.query_row(params![&chapter_id], map_chapter_summary_row)
        .optional()
        .map_err(|e| e.to_string())
}

/// 标记章节总结过期
#[tauri::command]
pub fn mark_chapter_summaries_expired(chapter_id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE chapter_summaries SET is_expired = 1, updated_at = ?1 WHERE chapter_id = ?2",
        params![chrono::Utc::now().to_rfc3339(), &chapter_id],
    )
    .map_err(|e| e.to_string())?;
    // 同时标记关联的 context_records 过期
    conn.execute(
        "UPDATE context_records SET is_expired = 1, updated_at = ?1 WHERE chapter_id = ?2",
        params![chrono::Utc::now().to_rfc3339(), &chapter_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Deserialize)]
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

/// 批量保存上下文记录
#[tauri::command]
pub fn save_context_records(
    inputs: Vec<SaveContextRecordInput>,
) -> Result<Vec<ContextRecordDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let mut results = Vec::new();

    for input in inputs {
        let new_id = uuid::Uuid::new_v4().to_string();
        let importance = input.importance.unwrap_or(3);
        let is_active = input.is_active.unwrap_or(true);

        conn.execute(
            "INSERT INTO context_records (id, novel_id, chapter_id, volume_id, context_type, title, content, importance, is_active, is_expired, content_hash, draft_version, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,0,?10,?11,?12,?12)",
            params![
                &new_id, &input.novel_id, &input.chapter_id, &input.volume_id,
                &input.context_type, &input.title, &input.content, &importance,
                &(is_active as i64), &input.content_hash, &input.draft_version, &now,
            ],
        ).map_err(|e| e.to_string())?;

        let mut stmt = conn.prepare("SELECT id, novel_id, chapter_id, volume_id, context_type, title, content, importance, is_active, is_expired, content_hash, draft_version, created_at, updated_at FROM context_records WHERE id=?1").map_err(|e| e.to_string())?;
        results.push(
            stmt.query_row(params![&new_id], map_context_record_row)
                .map_err(|e| e.to_string())?,
        );
    }
    Ok(results)
}

/// 获取作品的所有上下文记录
#[tauri::command]
pub fn get_context_records(novel_id: String) -> Result<Vec<ContextRecordDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, novel_id, chapter_id, volume_id, context_type, title, content, importance, is_active, is_expired, content_hash, draft_version, created_at, updated_at FROM context_records WHERE novel_id=?1 ORDER BY created_at DESC").map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![&novel_id], map_context_record_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

/// 更新上下文记录启用状态
#[tauri::command]
pub fn update_context_record_active(id: String, is_active: bool) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE context_records SET is_active = ?1, updated_at = ?2 WHERE id = ?3",
        params![is_active as i64, chrono::Utc::now().to_rfc3339(), &id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 删除上下文记录
#[tauri::command]
pub fn delete_context_record(id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM context_records WHERE id = ?1", params![&id])
        .map_err(|e| e.to_string())?;
    Ok(())
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
        println!(
            "[AI_TASK_DELETE_RUNTIME_TEST] inserted db_path={} ids=[{}, {}] before_count={}",
            db_path_text, first_id, second_id, before_count
        );
        assert_eq!(before_count, 2);
        assert_eq!(count_runtime_ai_task_child_refs(&conn, &first_id)?, 5);
        assert_eq!(count_runtime_ai_task_child_refs(&conn, &second_id)?, 5);
        assert_eq!(count_runtime_ai_task_child_rows(&conn)?, 10);

        let delete_result = delete_ai_task_records_by_ids_internal(
            &conn,
            vec![first_id.clone()],
            db_path_text.clone(),
        )?;
        println!(
            "[AI_TASK_DELETE_RUNTIME_TEST] delete_result={:?}",
            delete_result
        );
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
        println!(
            "[AI_TASK_DELETE_RUNTIME_TEST] clear_result={:?}",
            clear_result
        );
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
    fn ai_task_delete_rejects_completed_quality_report_references(
    ) -> Result<(), Box<dyn std::error::Error>> {
        for action in ["single", "batch", "clear"] {
            let conn = Connection::open_in_memory()?;
            create_runtime_ai_task_table(&conn)?;
            for task_id in ["quality-task-protected", "quality-task-free-a", "quality-task-free-b"] {
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
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        crate::db::create_tables(&conn)?;
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
}
