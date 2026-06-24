use crate::db::{get_connection, get_database_path};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

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

fn get_draft_by_id_internal(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<ChapterDraftDto, String> {
    let mut stmt = conn.prepare("SELECT id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, ai_task_id, note, large_text_ref_id, created_at, updated_at FROM chapter_drafts WHERE id = ?1").map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_draft_row)
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

#[tauri::command]
pub fn update_chapter_draft(
    id: String,
    chapter_id: String,
    content: String,
    source: Option<String>,
    large_text_ref_id: Option<String>,
) -> Result<Option<ChapterDraftDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let source = source.unwrap_or_else(|| "user_edited".to_string());
    let word_count = count_words(&content);
    conn.execute(
        "UPDATE chapter_drafts SET content = ?1, source = ?2, word_count = ?3, large_text_ref_id = ?4, updated_at = ?5 WHERE id = ?6 AND chapter_id = ?7",
        params![content, source, word_count, large_text_ref_id, now, &id, chapter_id],
    ).map_err(|e| e.to_string())?;

    match get_draft_by_id_internal(&conn, &id) {
        Ok(draft) => Ok(Some(draft)),
        Err(err) if err.contains("Query returned no rows") => Ok(None),
        Err(err) => Err(err),
    }
}

#[tauri::command]
pub fn adopt_chapter_draft(
    draft_id: String,
    chapter_id: String,
) -> Result<Option<ChapterDraftDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE chapter_drafts SET is_adopted = 0, updated_at = ?1 WHERE chapter_id = ?2",
        params![&now, &chapter_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE chapter_drafts SET is_adopted = 1, updated_at = ?1 WHERE id = ?2 AND chapter_id = ?3",
        params![&now, &draft_id, &chapter_id],
    ).map_err(|e| e.to_string())?;

    match get_draft_by_id_internal(&conn, &draft_id) {
        Ok(draft) => Ok(Some(draft)),
        Err(err) if err.contains("Query returned no rows") => Ok(None),
        Err(err) => Err(err),
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn create_runtime_ai_task_table(conn: &Connection) -> rusqlite::Result<()> {
        conn.execute_batch(
            "
            CREATE TABLE ai_task_records (
                id TEXT PRIMARY KEY,
                task_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL
            );
            ",
        )
    }

    fn insert_runtime_ai_task(conn: &Connection, id: &str) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO ai_task_records (id, task_type, status, created_at) VALUES (?1, 'connection_test', 'succeeded', ?2)",
            params![id, chrono::Utc::now().to_rfc3339()],
        )?;
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

        let before_count = count_ai_task_records_in_conn(&conn)?;
        println!(
            "[AI_TASK_DELETE_RUNTIME_TEST] inserted db_path={} ids=[{}, {}] before_count={}",
            db_path_text, first_id, second_id, before_count
        );
        assert_eq!(before_count, 2);

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

        assert_eq!(count_ai_task_records_by_ids(&conn, &[first_id.clone()])?, 0);
        assert_eq!(
            count_ai_task_records_by_ids(&conn, &[second_id.clone()])?,
            1
        );

        let clear_result = clear_ai_task_records_internal(&conn, db_path_text.clone())?;
        println!(
            "[AI_TASK_DELETE_RUNTIME_TEST] clear_result={:?}",
            clear_result
        );
        assert_eq!(clear_result.before_count, 1);
        assert_eq!(clear_result.deleted_count, 1);
        assert_eq!(clear_result.after_count, 0);
        assert_eq!(count_ai_task_records_in_conn(&conn)?, 0);

        drop(conn);
        let _ = fs::remove_file(db_path);
        Ok(())
    }
}
