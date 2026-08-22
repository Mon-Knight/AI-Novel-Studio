use crate::domain::world::{ChapterCharacterDto, CharacterDto};
use rusqlite::{params, Connection, OptionalExtension, Row};

pub fn map_character_row(row: &Row<'_>) -> rusqlite::Result<CharacterDto> {
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

pub fn character_select_sql() -> &'static str {
    "SELECT id, novel_id, name, role_type, identity, faction, relation_to_protagonist, goal, personality, behavior_limits, forbidden_behaviors, first_appearance_chapter_id, current_state, source, is_protagonist, is_active, created_at, updated_at, protagonist_key, protagonist_label, protagonist_order FROM characters"
}

pub fn find_characters_by_novel(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<CharacterDto>, String> {
    let sql = format!(
        "{} WHERE novel_id = ?1 AND is_active = 1 ORDER BY is_protagonist DESC, updated_at DESC",
        character_select_sql()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![novel_id], map_character_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn find_character_by_id(conn: &Connection, id: &str) -> Result<Option<CharacterDto>, String> {
    let sql = format!("{} WHERE id = ?1", character_select_sql());
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_character_row)
        .optional()
        .map_err(|e| e.to_string())
}

pub fn find_single_protagonist_character(
    conn: &Connection,
    novel_id: &str,
) -> Result<Option<CharacterDto>, String> {
    let sql = format!(
        "{} WHERE novel_id = ?1 AND is_protagonist = 1 ORDER BY protagonist_order ASC LIMIT 1",
        character_select_sql()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![novel_id], map_character_row)
        .optional()
        .map_err(|e| e.to_string())
}

pub fn find_protagonist_characters(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<CharacterDto>, String> {
    let sql = format!(
        "{} WHERE novel_id = ?1 AND is_protagonist = 1 AND is_active = 1 ORDER BY protagonist_order ASC, updated_at DESC",
        character_select_sql()
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![novel_id], map_character_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn insert_character(
    conn: &Connection,
    id: &str,
    novel_id: &str,
    name: &str,
    role_type: &str,
    identity: Option<&str>,
    faction: Option<&str>,
    relation_to_protagonist: Option<&str>,
    goal: Option<&str>,
    personality: Option<&str>,
    behavior_limits: Option<&str>,
    forbidden_behaviors: Option<&str>,
    current_state: Option<&str>,
    source: &str,
    is_protagonist: bool,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO characters (id, novel_id, name, role_type, identity, faction, relation_to_protagonist, goal, personality, behavior_limits, forbidden_behaviors, current_state, source, is_protagonist, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 1, ?15, ?15)",
        params![
            id,
            novel_id,
            name,
            role_type,
            identity,
            faction,
            relation_to_protagonist,
            goal,
            personality,
            behavior_limits,
            forbidden_behaviors,
            current_state,
            source,
            if is_protagonist { 1 } else { 0 },
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_character_fields(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    role_type: Option<&str>,
    identity: Option<&str>,
    faction: Option<&str>,
    relation_to_protagonist: Option<&str>,
    goal: Option<&str>,
    personality: Option<&str>,
    behavior_limits: Option<&str>,
    forbidden_behaviors: Option<&str>,
    current_state: Option<&str>,
    is_protagonist: Option<bool>,
    is_active: Option<bool>,
    now: &str,
) -> Result<(), String> {
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
            name,
            role_type,
            identity,
            faction,
            relation_to_protagonist,
            goal,
            personality,
            behavior_limits,
            forbidden_behaviors,
            current_state,
            is_protagonist.map(|b| b as i64),
            is_active.map(|b| b as i64),
            now,
            id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn soft_delete_character(conn: &Connection, id: &str, now: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE characters SET is_active = 0, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ==================== Chapter Character ====================

pub fn map_chapter_character_row(row: &Row<'_>) -> rusqlite::Result<ChapterCharacterDto> {
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

pub fn find_chapter_characters_by_chapter(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<ChapterCharacterDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, novel_id, chapter_id, character_id, character_name, role_in_chapter, must_appear, note, created_at, updated_at FROM chapter_characters WHERE chapter_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![chapter_id], map_chapter_character_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn find_chapter_character_by_id(
    conn: &Connection,
    id: &str,
) -> Result<Option<ChapterCharacterDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, novel_id, chapter_id, character_id, character_name, role_in_chapter, must_appear, note, created_at, updated_at FROM chapter_characters WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_chapter_character_row)
        .optional()
        .map_err(|e| e.to_string())
}

pub fn find_chapter_character_id_by_chapter_and_character(
    conn: &Connection,
    chapter_id: &str,
    character_id: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT id FROM chapter_characters WHERE chapter_id = ?1 AND character_id = ?2 LIMIT 1",
        params![chapter_id, character_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn insert_chapter_character(
    conn: &Connection,
    id: &str,
    novel_id: &str,
    chapter_id: &str,
    character_id: &str,
    character_name: Option<&str>,
    role_in_chapter: &str,
    must_appear: bool,
    note: Option<&str>,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO chapter_characters (id, novel_id, chapter_id, character_id, character_name, role_in_chapter, must_appear, note, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            novel_id,
            chapter_id,
            character_id,
            character_name,
            role_in_chapter,
            must_appear as i64,
            note,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_chapter_character(
    conn: &Connection,
    id: &str,
    character_name: Option<&str>,
    role_in_chapter: &str,
    must_appear: bool,
    note: Option<&str>,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE chapter_characters SET role_in_chapter = ?1, must_appear = ?2, note = ?3, character_name = ?4, updated_at = ?5 WHERE id = ?6",
        params![
            role_in_chapter,
            must_appear as i64,
            note,
            character_name,
            now,
            id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_chapter_character(
    conn: &Connection,
    chapter_id: &str,
    character_id: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM chapter_characters WHERE chapter_id = ?1 AND character_id = ?2",
        params![chapter_id, character_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
