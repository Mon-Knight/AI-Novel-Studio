use crate::db::{get_connection, get_database_path};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

pub mod ai_tasks;
pub mod artifacts;
pub mod drafts;
pub mod recovery;

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
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
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

    Ok(novels)
}

#[tauri::command]
pub fn get_novel_by_id(id: String) -> Result<Option<NovelDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
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

    get_novel_by_id(id)?.ok_or_else(|| "作品创建后无法读取".to_string())
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

    get_novel_by_id(id)?.ok_or_else(|| "作品保存后无法读取".to_string())
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
    ).map_err(|e| e.to_string())?;
    if affected != 1 {
        return Err("TARGET_CHAPTER_NOT_FOUND: 章节删除未命中唯一目标".to_string());
    }
    let recovery_document_id = crate::repositories::recovery_repository::get(
        &transaction,
        &novel_id,
        &id,
    )
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

fn count_words(content: &str) -> i64 {
    content.chars().filter(|c| !c.is_whitespace()).count() as i64
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

#[allow(dead_code)]
fn get_draft_by_id_internal(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<ChapterDraftDto, String> {
    let mut stmt = conn.prepare("SELECT id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, ai_task_id, note, large_text_ref_id, created_at, updated_at FROM chapter_drafts WHERE id = ?1").map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_draft_row)
        .map_err(|e| e.to_string())
}

fn get_draft_by_id_and_chapter_internal(
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
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    update_chapter_draft_internal(
        &conn,
        &id,
        &chapter_id,
        &content,
        source.as_deref(),
        large_text_ref_id.as_deref(),
    )
}

fn validate_live_draft_target_internal(
    conn: &Connection,
    draft_id: &str,
    chapter_id: &str,
) -> Result<i64, String> {
    let target = conn.query_row(
        "SELECT d.chapter_id, d.novel_id, d.word_count, c.id, c.novel_id, c.deleted_at FROM chapter_drafts AS d LEFT JOIN chapters AS c ON c.id = ?2 WHERE d.id = ?1",
        params![draft_id, chapter_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        },
    );

    let (
        actual_chapter_id,
        draft_novel_id,
        word_count,
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

    transaction.execute(
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
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM chapter_drafts WHERE id = ?1 AND chapter_id = ?2",
        params![id, chapter_id],
    )
    .map_err(|e| e.to_string())?;
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

fn map_chapter_engineering_state_row(row: &Row<'_>) -> rusqlite::Result<ChapterEngineeringStateDto> {
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

fn map_chapter_generation_snapshot_row(row: &Row<'_>) -> rusqlite::Result<ChapterGenerationSnapshotDto> {
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

fn get_generation_job_by_id_internal(conn: &Connection, id: &str) -> Result<GenerationJobDto, String> {
    let mut stmt = conn.prepare(
        "SELECT id, world_id, novel_id, volume_id, chapter_id, job_type, status, current_step, progress_percent, provider, model_name, input_token_estimate, output_token_estimate, actual_input_tokens, actual_output_tokens, cost_estimate, error_code, error_message, retry_count, created_at, started_at, finished_at FROM generation_jobs WHERE id = ?1",
    ).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_generation_job_row)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_generation_job(input: CreateGenerationJobInput) -> Result<GenerationJobDto, String> {
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
    conn.execute(
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
    ).map_err(|e| e.to_string())?;
    get_generation_job_by_id_internal(&conn, &input.id)
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
pub fn get_generation_jobs_by_chapter_id(chapter_id: String) -> Result<Vec<GenerationJobDto>, String> {
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
pub fn cancel_generation_job(id: String, finished_at: String) -> Result<Option<GenerationJobDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE generation_jobs SET status = 'cancelled', finished_at = ?1 WHERE id = ?2 AND status NOT IN ('completed', 'failed', 'cancelled')",
        params![&finished_at, &id],
    ).map_err(|e| e.to_string())?;
    match get_generation_job_by_id_internal(&conn, &id) {
        Ok(job) => Ok(Some(job)),
        Err(err) if err.contains("Query returned no rows") => Ok(None),
        Err(err) => Err(err),
    }
}

#[tauri::command]
pub fn save_generation_step_result(
    input: SaveGenerationStepResultInput,
) -> Result<GenerationStepResultDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO generation_step_results (id, job_id, step_name, status, input_snapshot_json, output_json, output_text, error_message, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
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
    let mut stmt = conn.prepare(
        "SELECT id, job_id, step_name, status, input_snapshot_json, output_json, output_text, error_message, created_at FROM generation_step_results WHERE id = ?1",
    ).map_err(|e| e.to_string())?;
    stmt.query_row(params![&input.id], map_generation_step_result_row)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_generation_step_results(job_id: String) -> Result<Vec<GenerationStepResultDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, job_id, step_name, status, input_snapshot_json, output_json, output_text, error_message, created_at FROM generation_step_results WHERE job_id = ?1 ORDER BY created_at ASC",
    ).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![job_id], map_generation_step_result_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
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

    // 构建 IN 子句占位符
    let placeholders: Vec<String> = ids.iter().map(|_| "?".to_string()).collect();
    let placeholders_str = placeholders.join(",");

    // 开启事务
    conn.execute_batch("BEGIN TRANSACTION")
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    let mut deleted_child_rows: std::collections::HashMap<String, i64> = std::collections::HashMap::new();

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
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = ids.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();
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

    // 开启事务
    conn.execute_batch("BEGIN TRANSACTION")
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    let mut deleted_child_rows: std::collections::HashMap<String, i64> = std::collections::HashMap::new();

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
        "UPDATE ai_task_records SET status = 'succeeded', result_text = ?1, prompt_snapshot = ?2, result_json = ?3, error_message = NULL, token_input = ?4, token_output = ?5, token_total = ?6, duration_ms = ?7, finished_at = ?8 WHERE id = ?9",
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
        "UPDATE ai_task_records SET status = 'failed', error_message = ?1, duration_ms = ?2, finished_at = ?3 WHERE id = ?4",
        params![error_message, duration_ms, finished_at, id],
    ).map_err(|e| e.to_string())?;
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
pub fn list_style_profiles(project_id: String) -> Result<Vec<StyleProfileDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "{} WHERE novel_id = ?1 ORDER BY is_active DESC, updated_at DESC",
        style_select_sql()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![&project_id], map_style_profile_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
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
    pub artifact_id: Option<String>,
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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityCheckResultDto {
    pub overall_score: Option<i64>,
    pub summary: Option<String>,
    pub items: Vec<QualityCheckResultItemDto>,
    pub ai_task_id: Option<String>,
    pub artifact_id: Option<String>,
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
        artifact_id: row.get(9)?,
        draft_version: row.get(10)?,
        model: row.get(11)?,
        content_hash: row.get(12)?,
        content_length: row.get(13)?,
        checked_at: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
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
    })
}

fn quality_item_select_sql() -> &'static str {
    "SELECT id, report_id, novel_id, chapter_id, draft_id, issue_type, severity, title, description, category, evidence, suggestion, quote, start_offset, end_offset, paragraph_index, issue_key, status, resolution_note, resolved_at, created_at, updated_at FROM quality_check_items"
}

fn quality_report_select_sql() -> &'static str {
    "SELECT id, novel_id, chapter_id, draft_id, scope, status, overall_score, summary, COALESCE(source_task_id, ai_task_id), artifact_id, draft_version, model, content_hash, content_length, checked_at, created_at, updated_at FROM quality_check_reports"
}

/// 创建质量检查报告占位记录
#[tauri::command]
pub fn create_quality_check_report(
    input: CreateQualityReportInput,
) -> Result<QualityCheckReportDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let scope = input
        .scope
        .unwrap_or_else(|| "current_draft".to_string());
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
    let conn = get_connection().lock().map_err(|e| e.to_string())?;

    // 获取最新报告
    let report = conn
        .query_row(
            &format!(
                "{} WHERE chapter_id = ?1 ORDER BY created_at DESC LIMIT 1",
                quality_report_select_sql()
            ),
            params![&chapter_id],
            map_quality_report_row,
        )
        .optional()
        .map_err(|e| e.to_string())?;

    // 获取问题列表
    let items: Vec<QualityCheckItemDto> = if let Some(ref rpt) = report {
        let sql = format!(
            "{} WHERE report_id = ?1 ORDER BY severity DESC, created_at ASC",
            quality_item_select_sql()
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![&rpt.id], map_quality_item_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    } else {
        Vec::new()
    };

    // 计算统计
    let statistics = compute_statistics(&items);

    Ok(GetQualityCheckIssuesResult {
        report,
        items,
        statistics,
    })
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
#[tauri::command]
pub fn update_quality_issue_status(
    issue_id: String,
    status: String,
    resolution_note: Option<String>,
) -> Result<QualityCheckItemDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let resolved_at = if status == "resolved" {
        Some(now.clone())
    } else {
        None
    };

    conn.execute(
        "UPDATE quality_check_items SET status = ?1, resolution_note = ?2, resolved_at = ?3, updated_at = ?4 WHERE id = ?5",
        params![&status, &resolution_note, &resolved_at, &now, &issue_id],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(&format!("{} WHERE id = ?1", quality_item_select_sql()))
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![&issue_id], map_quality_item_row)
        .map_err(|e| e.to_string())
}

/// 批量更新问题状态
#[tauri::command]
pub fn batch_update_quality_issue_status(
    issue_ids: Vec<String>,
    status: String,
) -> Result<Vec<QualityCheckItemDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let resolved_at = if status == "resolved" {
        Some(now.clone())
    } else {
        None
    };

    for issue_id in &issue_ids {
        conn.execute(
            "UPDATE quality_check_items SET status = ?1, resolved_at = ?2, updated_at = ?3 WHERE id = ?4",
            params![&status, &resolved_at, &now, issue_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // 返回更新后的所有问题
    let mut result = Vec::new();
    for issue_id in &issue_ids {
        let mut stmt = conn
            .prepare(&format!("{} WHERE id = ?1", quality_item_select_sql()))
            .map_err(|e| e.to_string())?;
        if let Ok(item) = stmt.query_row(params![issue_id], map_quality_item_row) {
            result.push(item);
        }
    }
    Ok(result)
}

/// 保存质量检查结果（创建 run + 合并 issues）
#[tauri::command]
pub fn save_quality_check_result(
    input: SaveQualityCheckResultInput,
) -> Result<GetQualityCheckIssuesResult, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    println!(
        "[QUALITY_CHECK] save_result start report_id={} novel_id={} chapter_id={} draft_id={} item_count={}",
        input.report_id,
        input.novel_id,
        input.chapter_id,
        input.draft_id,
        input.result.items.len()
    );

    // 1. 更新报告状态
    let affected = conn
        .execute(
            "UPDATE quality_check_reports SET status = 'completed', overall_score = ?1, summary = ?2, draft_version = ?3, model = ?4, content_hash = COALESCE(?5, content_hash), content_length = COALESCE(?6, content_length), checked_at = COALESCE(?7, checked_at), source_task_id = COALESCE(?8, source_task_id), artifact_id = COALESCE(?9, artifact_id), updated_at = ?10 WHERE id = ?11",
            params![
                &input.result.overall_score,
                &input.result.summary,
                &input.draft_version,
                &input.model,
                &input.content_hash,
                &input.content_length,
                &input.checked_at,
                &input.result.ai_task_id,
                &input.result.artifact_id,
                &now,
                &input.report_id,
            ],
        )
        .map_err(|e| e.to_string())?;

    if affected == 0 {
        let chapter_report_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM quality_check_reports WHERE chapter_id = ?1",
                params![&input.chapter_id],
                |row| row.get(0),
            )
            .unwrap_or(-1);
        eprintln!(
            "[QUALITY_CHECK] save_result missing report report_id={} chapter_id={} chapter_report_count={}",
            input.report_id, input.chapter_id, chapter_report_count
        );
        return Err(format!(
            "报告不存在: report_id={}, chapter_id={}, chapter_report_count={}",
            input.report_id, input.chapter_id, chapter_report_count
        ));
    }

    // 2. 查询历史问题（用于合并）
    let mut old_stmt = conn
        .prepare(&format!(
            "{} WHERE chapter_id = ?1",
            quality_item_select_sql()
        ))
        .map_err(|e| e.to_string())?;
    let old_items: Vec<QualityCheckItemDto> = old_stmt
        .query_map(params![&input.chapter_id], map_quality_item_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // 3. 处理新问题列表
    let new_items = &input.result.items;
    let mut saved_items: Vec<QualityCheckItemDto> = Vec::new();

    for new_item in new_items {
        let issue_key = new_item.issue_key.clone().unwrap_or_else(|| {
            uuid::Uuid::new_v4().to_string()
        });
        let title = new_item.title.clone().unwrap_or_default();
        let description = new_item.description.clone().unwrap_or_default();
        let severity = new_item.severity.clone().unwrap_or_else(|| "medium".to_string());
        let issue_type = new_item.issue_type.clone().unwrap_or_else(|| "other".to_string());
        let category = new_item.category.clone();
        let evidence = new_item.evidence.clone();
        let suggestion = new_item.suggestion.clone();
        let quote = new_item.quote.clone();
        let start_offset = new_item.start_offset;
        let end_offset = new_item.end_offset;
        let paragraph_index = new_item.paragraph_index;

        // 查找历史匹配项
        let old_match = old_items.iter().find(|old| old.issue_key == issue_key);

        if let Some(old) = old_match {
            // 合并：保留用户处理状态
            let keep_status = if old.status == "ignored" {
                "ignored".to_string()
            } else if old.status == "resolved" {
                // 已处理的问题如果仍被检测到，恢复为 pending
                "pending".to_string()
            } else {
                "pending".to_string()
            };

            conn.execute(
                "UPDATE quality_check_items SET report_id = ?1, severity = ?2, title = ?3, description = ?4, category = ?5, evidence = ?6, suggestion = ?7, quote = ?8, start_offset = ?9, end_offset = ?10, paragraph_index = ?11, status = ?12, updated_at = ?13 WHERE id = ?14",
                params![
                    &input.report_id,
                    &severity,
                    &title,
                    &description,
                    &category,
                    &evidence,
                    &suggestion,
                    &quote,
                    &start_offset,
                    &end_offset,
                    &paragraph_index,
                    &keep_status,
                    &now,
                    &old.id,
                ],
            )
            .map_err(|e| e.to_string())?;

            let mut stmt = conn
                .prepare(&format!("{} WHERE id = ?1", quality_item_select_sql()))
                .map_err(|e| e.to_string())?;
            if let Ok(item) = stmt.query_row(params![&old.id], map_quality_item_row) {
                saved_items.push(item);
            }
        } else {
            // 新增问题
            let new_id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO quality_check_items (id, report_id, novel_id, chapter_id, draft_id, issue_type, severity, title, description, category, evidence, suggestion, quote, start_offset, end_offset, paragraph_index, issue_key, status, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,'pending',?18,?18)",
                params![
                    &new_id,
                    &input.report_id,
                    &input.novel_id,
                    &input.chapter_id,
                    &input.draft_id,
                    &issue_type,
                    &severity,
                    &title,
                    &description,
                    &category,
                    &evidence,
                    &suggestion,
                    &quote,
                    &start_offset,
                    &end_offset,
                    &paragraph_index,
                    &issue_key,
                    &now,
                ],
            )
            .map_err(|e| e.to_string())?;

            let mut stmt = conn
                .prepare(&format!("{} WHERE id = ?1", quality_item_select_sql()))
                .map_err(|e| e.to_string())?;
            if let Ok(item) = stmt.query_row(params![&new_id], map_quality_item_row) {
                saved_items.push(item);
            }
        }
    }

    // 4. 获取最终报告
    let report = conn
        .query_row(
            &format!("{} WHERE id = ?1", quality_report_select_sql()),
            params![&input.report_id],
            map_quality_report_row,
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let statistics = compute_statistics(&saved_items);
    println!(
        "[QUALITY_CHECK] save_result done report_id={} chapter_id={} saved_item_count={}",
        input.report_id,
        input.chapter_id,
        saved_items.len()
    );

    Ok(GetQualityCheckIssuesResult {
        report,
        items: saved_items,
        statistics,
    })
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
        stmt.query_row(params![existing_id], map_chapter_summary_row).map_err(|e| e.to_string())
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
        stmt.query_row(params![&new_id], map_chapter_summary_row).map_err(|e| e.to_string())
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
    ).map_err(|e| e.to_string())?;
    // 同时标记关联的 context_records 过期
    conn.execute(
        "UPDATE context_records SET is_expired = 1, updated_at = ?1 WHERE chapter_id = ?2",
        params![chrono::Utc::now().to_rfc3339(), &chapter_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// 更新章节总结启用状态
#[tauri::command]
pub fn update_chapter_summary_enabled(id: String, enabled: bool) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE chapter_summaries SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
        params![enabled as i64, chrono::Utc::now().to_rfc3339(), &id],
    ).map_err(|e| e.to_string())?;
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
pub fn save_context_records(inputs: Vec<SaveContextRecordInput>) -> Result<Vec<ContextRecordDto>, String> {
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
        results.push(stmt.query_row(params![&new_id], map_context_record_row).map_err(|e| e.to_string())?);
    }
    Ok(results)
}

/// 获取作品的所有上下文记录
#[tauri::command]
pub fn get_context_records(novel_id: String) -> Result<Vec<ContextRecordDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, novel_id, chapter_id, volume_id, context_type, title, content, importance, is_active, is_expired, content_hash, draft_version, created_at, updated_at FROM context_records WHERE novel_id=?1 ORDER BY created_at DESC").map_err(|e| e.to_string())?;
    let items = stmt.query_map(params![&novel_id], map_context_record_row)
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
    ).map_err(|e| e.to_string())?;
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
    stmt.query_row(params![&input.id], map_fix_run_row).map_err(|e| e.to_string())
}

/// 获取章节的修稿记录
#[tauri::command]
pub fn get_quality_fix_runs(chapter_id: String) -> Result<Vec<QualityFixRunDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, novel_id, chapter_id, source_draft_id, source_draft_version, target_draft_id, target_draft_version, source_content_hash, target_content_hash, before_report_id, after_report_id, before_score, after_score, before_pending_count, after_pending_count, before_serious_count, after_serious_count, fixed_issue_ids, new_issue_ids, mode, status, model, revision_summary, changed_ranges_json, used_context_ids, skipped_context_ids, warnings, failure_reason, created_at, updated_at FROM quality_fix_runs WHERE chapter_id=?1 ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;
    let items = stmt.query_map(params![&chapter_id], map_fix_run_row)
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
    ).map_err(|e| e.to_string())?;
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

    const RUNTIME_AI_TASK_CHILD_TABLES: [&str; 5] = [
        "chapter_drafts",
        "quality_check_reports",
        "polish_records",
        "chapter_events",
        "chapter_summaries",
    ];

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
    fn adopt_rejects_cross_novel_target_without_changes(
    ) -> Result<(), Box<dyn std::error::Error>> {
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

        let error = adopt_chapter_draft_internal(
            &mut conn,
            "draft-new",
            "chapter-cross-novel",
        )
        .expect_err("cross-novel draft/chapter pair must be rejected");

        assert!(error.starts_with("target_mismatch:"), "{error}");
        assert_eq!(get_test_draft_adopted(&conn, "draft-old")?, 1);
        assert_eq!(get_test_draft_adopted(&conn, "draft-new")?, 0);
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-cross-novel")?.0.as_deref(),
            Some("draft-old")
        );
        Ok(())
    }

    #[test]
    fn adopt_rejects_soft_deleted_chapter_without_changes(
    ) -> Result<(), Box<dyn std::error::Error>> {
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
            get_test_chapter_state(&conn, "chapter-deleted")?.0.as_deref(),
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

    fn count_runtime_ai_task_child_refs(
        conn: &Connection,
        task_id: &str,
    ) -> rusqlite::Result<i64> {
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
}
