use crate::db::get_connection;
use rusqlite::params;
use serde::{Deserialize, Serialize};

// ==================== Novel ====================

#[derive(Debug, Serialize, Deserialize)]
pub struct NovelDto {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub genre: Option<String>,
    pub description: Option<String>,
    pub cover_path: Option<String>,
    pub status: String,
    pub current_volume_id: Option<String>,
    pub current_chapter_id: Option<String>,
    pub total_word_count: i64,
    pub target_word_count: Option<i64>,
    pub last_opened_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateNovelInput {
    pub title: String,
    pub subtitle: Option<String>,
    pub description: Option<String>,
    pub genre: Option<String>,
    pub target_word_count: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateNovelInput {
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub description: Option<String>,
    pub genre: Option<String>,
    pub status: Option<String>,
    pub target_word_count: Option<i64>,
    pub current_volume_id: Option<String>,
    pub current_chapter_id: Option<String>,
    pub total_word_count: Option<i64>,
}

#[tauri::command]
pub fn get_all_novels() -> Result<Vec<NovelDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, subtitle, genre, description, cover_path, status, current_volume_id, current_chapter_id, total_word_count, target_word_count, last_opened_at, created_at, updated_at FROM novels WHERE deleted_at IS NULL ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;

    let novels = stmt
        .query_map([], |row| {
            Ok(NovelDto {
                id: row.get(0)?,
                title: row.get(1)?,
                subtitle: row.get(2)?,
                genre: row.get(3)?,
                description: row.get(4)?,
                cover_path: row.get(5)?,
                status: row.get(6)?,
                current_volume_id: row.get(7)?,
                current_chapter_id: row.get(8)?,
                total_word_count: row.get(9)?,
                target_word_count: row.get(10)?,
                last_opened_at: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(novels)
}

#[tauri::command]
pub fn get_novel_by_id(id: String) -> Result<NovelDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, subtitle, genre, description, cover_path, status, current_volume_id, current_chapter_id, total_word_count, target_word_count, last_opened_at, created_at, updated_at FROM novels WHERE id = ?1 AND deleted_at IS NULL")
        .map_err(|e| e.to_string())?;

    stmt.query_row(params![id], |row| {
        Ok(NovelDto {
            id: row.get(0)?,
            title: row.get(1)?,
            subtitle: row.get(2)?,
            genre: row.get(3)?,
            description: row.get(4)?,
            cover_path: row.get(5)?,
            status: row.get(6)?,
            current_volume_id: row.get(7)?,
            current_chapter_id: row.get(8)?,
            total_word_count: row.get(9)?,
            target_word_count: row.get(10)?,
            last_opened_at: row.get(11)?,
            created_at: row.get(12)?,
            updated_at: row.get(13)?,
        })
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_novel(input: CreateNovelInput) -> Result<NovelDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO novels (id, title, subtitle, genre, description, status, total_word_count, target_word_count, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'draft', 0, ?6, ?7, ?7)",
        params![id, input.title, input.subtitle, input.genre, input.description, input.target_word_count, now],
    )
    .map_err(|e| e.to_string())?;

    get_novel_by_id(id)
}

#[tauri::command]
pub fn update_novel(id: String, input: UpdateNovelInput) -> Result<NovelDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let mut updates: Vec<String> = vec![format!("updated_at = '{}'", now)];
    if let Some(ref title) = input.title {
        updates.push(format!("title = '{}'", title.replace('\'', "''")));
    }
    if let Some(ref subtitle) = input.subtitle {
        updates.push(format!("subtitle = '{}'", subtitle.replace('\'', "''")));
    }
    if let Some(ref description) = input.description {
        updates.push(format!("description = '{}'", description.replace('\'', "''")));
    }
    if let Some(ref genre) = input.genre {
        updates.push(format!("genre = '{}'", genre.replace('\'', "''")));
    }
    if let Some(ref status) = input.status {
        updates.push(format!("status = '{}'", status));
    }
    if let Some(target) = input.target_word_count {
        updates.push(format!("target_word_count = {}", target));
    }
    if let Some(ref vid) = input.current_volume_id {
        updates.push(format!("current_volume_id = '{}'", vid));
    }
    if let Some(ref cid) = input.current_chapter_id {
        updates.push(format!("current_chapter_id = '{}'", cid));
    }
    if let Some(twc) = input.total_word_count {
        updates.push(format!("total_word_count = {}", twc));
    }

    let sql = format!("UPDATE novels SET {} WHERE id = '{}'", updates.join(", "), id);
    conn.execute(&sql, []).map_err(|e| e.to_string())?;

    get_novel_by_id(id)
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
pub fn save_world_setting(id: Option<String>, input: SaveWorldSettingInput) -> Result<WorldSettingDto, String> {
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
pub fn save_rule_system(id: Option<String>, input: SaveRuleSystemInput) -> Result<RuleSystemDto, String> {
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
pub fn save_protagonist(id: Option<String>, input: SaveProtagonistInput) -> Result<ProtagonistDto, String> {
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
pub struct CreateVolumeInput {
    pub novel_id: String,
    pub title: String,
    pub summary: Option<String>,
    pub goal: Option<String>,
    pub main_conflict: Option<String>,
    pub order_index: Option<i64>,
}

#[derive(Debug, Deserialize)]
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
    let items = stmt.query_map(params![novel_id], |row| {
        Ok(VolumeDto {
            id: row.get(0)?, novel_id: row.get(1)?, title: row.get(2)?,
            summary: row.get(3)?, goal: row.get(4)?, main_conflict: row.get(5)?,
            order_index: row.get(6)?, status: row.get(7)?,
            created_at: row.get(8)?, updated_at: row.get(9)?,
        })
    }).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(items)
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
    if let Some(ref v) = input.title { sets.push(format!("title = '{}'", v.replace('\'', "''"))); }
    if let Some(ref v) = input.summary { sets.push(format!("summary = '{}'", v.replace('\'', "''"))); }
    if let Some(ref v) = input.goal { sets.push(format!("goal = '{}'", v.replace('\'', "''"))); }
    if let Some(ref v) = input.main_conflict { sets.push(format!("main_conflict = '{}'", v.replace('\'', "''"))); }
    if let Some(v) = input.order_index { sets.push(format!("order_index = {}", v)); }
    if let Some(ref v) = input.status { sets.push(format!("status = '{}'", v)); }
    let sql = format!("UPDATE volumes SET {} WHERE id = '{}'", sets.join(", "), id);
    conn.execute(&sql, []).map_err(|e| e.to_string())?;
    get_volume_by_id_internal(&conn, &id)
}

#[tauri::command]
pub fn delete_volume(id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM chapters WHERE volume_id = ?1 AND deleted_at IS NULL", params![id], |r| r.get(0)).map_err(|e| e.to_string())?;
    if count > 0 { return Err("该分卷下仍有章节，请先移动或删除章节".into()); }
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute("UPDATE volumes SET deleted_at = ?1 WHERE id = ?2", params![now, id]).map_err(|e| e.to_string())?;
    Ok(())
}

fn get_volume_by_id_internal(conn: &rusqlite::Connection, id: &str) -> Result<VolumeDto, String> {
    let mut stmt = conn.prepare("SELECT id, novel_id, title, summary, goal, main_conflict, order_index, status, created_at, updated_at FROM volumes WHERE id = ?1").map_err(|e| e.to_string())?;
    stmt.query_row(params![id], |row| Ok(VolumeDto {
        id: row.get(0)?, novel_id: row.get(1)?, title: row.get(2)?,
        summary: row.get(3)?, goal: row.get(4)?, main_conflict: row.get(5)?,
        order_index: row.get(6)?, status: row.get(7)?,
        created_at: row.get(8)?, updated_at: row.get(9)?,
    })).map_err(|e| e.to_string())
}

// ==================== Chapter ====================

#[derive(Debug, Serialize, Deserialize)]
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
    let items = stmt.query_map(params![novel_id], |row| Ok(ChapterDto {
        id: row.get(0)?, novel_id: row.get(1)?, volume_id: row.get(2)?,
        title: row.get(3)?, outline: row.get(4)?, goal: row.get(5)?,
        order_index: row.get(6)?, status: row.get(7)?,
        adopted_draft_id: row.get(8)?, word_count: row.get(9)?,
        target_word_count: row.get(10)?, created_at: row.get(11)?, updated_at: row.get(12)?,
    })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn create_chapter(input: CreateChapterInput) -> Result<ChapterDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let order = input.order_index.unwrap_or(0);
    let status = if input.outline.is_some() { "outline_ready" } else { "not_started" };
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
    if let Some(ref v) = input.volume_id { sets.push(format!("volume_id = '{}'", v)); }
    if let Some(ref v) = input.title { sets.push(format!("title = '{}'", v.replace('\'', "''"))); }
    if let Some(ref v) = input.outline { sets.push(format!("outline = '{}'", v.replace('\'', "''"))); }
    if let Some(ref v) = input.goal { sets.push(format!("goal = '{}'", v.replace('\'', "''"))); }
    if let Some(v) = input.order_index { sets.push(format!("order_index = {}", v)); }
    if let Some(ref v) = input.status { sets.push(format!("status = '{}'", v)); }
    if let Some(v) = input.target_word_count { sets.push(format!("target_word_count = {}", v)); }
    let sql = format!("UPDATE chapters SET {} WHERE id = '{}'", sets.join(", "), id);
    conn.execute(&sql, []).map_err(|e| e.to_string())?;
    get_chapter_by_id_internal(&conn, &id)
}

#[tauri::command]
pub fn delete_chapter(id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute("UPDATE chapters SET deleted_at = ?1 WHERE id = ?2", params![now, id]).map_err(|e| e.to_string())?;
    Ok(())
}

fn get_chapter_by_id_internal(conn: &rusqlite::Connection, id: &str) -> Result<ChapterDto, String> {
    let mut stmt = conn.prepare("SELECT id, novel_id, volume_id, title, outline, goal, order_index, status, adopted_draft_id, word_count, target_word_count, created_at, updated_at FROM chapters WHERE id = ?1").map_err(|e| e.to_string())?;
    stmt.query_row(params![id], |row| Ok(ChapterDto {
        id: row.get(0)?, novel_id: row.get(1)?, volume_id: row.get(2)?,
        title: row.get(3)?, outline: row.get(4)?, goal: row.get(5)?,
        order_index: row.get(6)?, status: row.get(7)?,
        adopted_draft_id: row.get(8)?, word_count: row.get(9)?,
        target_word_count: row.get(10)?, created_at: row.get(11)?, updated_at: row.get(12)?,
    })).map_err(|e| e.to_string())
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
