use crate::domain::world::{ProtagonistDto, RuleSystemDto, WorldSettingDto};
use rusqlite::{params, Connection, OptionalExtension, Row};

// ==================== World Setting ====================

pub fn map_world_setting_row(row: &Row<'_>) -> rusqlite::Result<WorldSettingDto> {
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
}

pub fn find_world_settings_by_novel(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<WorldSettingDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, novel_id, title, content, structured_json, is_active, created_at, updated_at FROM world_settings WHERE novel_id = ?1 ORDER BY is_active DESC, updated_at DESC, created_at DESC, id DESC")
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map(params![novel_id], map_world_setting_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

pub fn find_world_setting_by_id(
    conn: &Connection,
    id: &str,
) -> Result<Option<WorldSettingDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, novel_id, title, content, structured_json, is_active, created_at, updated_at FROM world_settings WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_world_setting_row)
        .optional()
        .map_err(|e| e.to_string())
}

pub fn insert_world_setting(
    conn: &Connection,
    id: &str,
    novel_id: &str,
    title: &str,
    content: &str,
    is_active: bool,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO world_settings (id, novel_id, title, content, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, novel_id, title, content, is_active as i64, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_world_setting(
    conn: &Connection,
    id: &str,
    title: &str,
    content: &str,
    is_active: bool,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE world_settings SET title = ?1, content = ?2, is_active = ?3, updated_at = ?4 WHERE id = ?5",
        params![title, content, is_active as i64, now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ==================== Rule System ====================

pub fn map_rule_system_row(row: &Row<'_>) -> rusqlite::Result<RuleSystemDto> {
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
}

pub fn find_rule_systems_by_novel(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<RuleSystemDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, novel_id, title, category, content, forbidden_rules, structured_json, is_active, created_at, updated_at FROM rule_systems WHERE novel_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map(params![novel_id], map_rule_system_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

pub fn find_rule_system_by_id(
    conn: &Connection,
    id: &str,
) -> Result<Option<RuleSystemDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, novel_id, title, category, content, forbidden_rules, structured_json, is_active, created_at, updated_at FROM rule_systems WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_rule_system_row)
        .optional()
        .map_err(|e| e.to_string())
}

pub fn insert_rule_system(
    conn: &Connection,
    id: &str,
    novel_id: &str,
    title: &str,
    category: Option<&str>,
    content: &str,
    forbidden_rules: Option<&str>,
    is_active: bool,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO rule_systems (id, novel_id, title, category, content, forbidden_rules, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![id, novel_id, title, category, content, forbidden_rules, is_active as i64, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_rule_system(
    conn: &Connection,
    id: &str,
    title: &str,
    category: Option<&str>,
    content: &str,
    forbidden_rules: Option<&str>,
    is_active: bool,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE rule_systems SET title = ?1, category = ?2, content = ?3, forbidden_rules = ?4, is_active = ?5, updated_at = ?6 WHERE id = ?7",
        params![title, category, content, forbidden_rules, is_active as i64, now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_rule_system(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM rule_systems WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ==================== Protagonist ====================

pub fn map_protagonist_row(row: &Row<'_>) -> rusqlite::Result<ProtagonistDto> {
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
}

pub fn find_protagonist_by_novel(
    conn: &Connection,
    novel_id: &str,
) -> Result<Option<ProtagonistDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, novel_id, name, identity, personality, goal, special_ability, ability_limits, forbidden_behaviors, current_state, created_at, updated_at FROM protagonists WHERE novel_id = ?1 LIMIT 1")
        .map_err(|e| e.to_string())?;

    stmt.query_row(params![novel_id], map_protagonist_row)
        .optional()
        .map_err(|e| e.to_string())
}

pub fn find_protagonist_by_id(
    conn: &Connection,
    id: &str,
) -> Result<Option<ProtagonistDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, novel_id, name, identity, personality, goal, special_ability, ability_limits, forbidden_behaviors, current_state, created_at, updated_at FROM protagonists WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_protagonist_row)
        .optional()
        .map_err(|e| e.to_string())
}

pub fn insert_protagonist(
    conn: &Connection,
    id: &str,
    novel_id: &str,
    name: &str,
    identity: Option<&str>,
    personality: Option<&str>,
    goal: Option<&str>,
    special_ability: Option<&str>,
    ability_limits: Option<&str>,
    forbidden_behaviors: Option<&str>,
    current_state: Option<&str>,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO protagonists (id, novel_id, name, identity, personality, goal, special_ability, ability_limits, forbidden_behaviors, current_state, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        params![id, novel_id, name, identity, personality, goal, special_ability, ability_limits, forbidden_behaviors, current_state, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_protagonist(
    conn: &Connection,
    id: &str,
    name: &str,
    identity: Option<&str>,
    personality: Option<&str>,
    goal: Option<&str>,
    special_ability: Option<&str>,
    ability_limits: Option<&str>,
    forbidden_behaviors: Option<&str>,
    current_state: Option<&str>,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE protagonists SET name = ?1, identity = ?2, personality = ?3, goal = ?4, special_ability = ?5, ability_limits = ?6, forbidden_behaviors = ?7, current_state = ?8, updated_at = ?9 WHERE id = ?10",
        params![name, identity, personality, goal, special_ability, ability_limits, forbidden_behaviors, current_state, now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
