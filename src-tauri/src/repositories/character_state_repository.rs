use crate::domain::context::CharacterStateDto;
use rusqlite::{params, Connection, OptionalExtension};

pub fn map_character_state_row(row: &rusqlite::Row) -> rusqlite::Result<CharacterStateDto> {
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

pub const CHARACTER_STATE_SELECT: &str = "SELECT id, novel_id, character_id, chapter_id, state_summary, relationship_changes, goal_changes, location, health_state, knowledge_state, created_at FROM character_states";

pub fn character_state_select_sql() -> &'static str {
    CHARACTER_STATE_SELECT
}

pub fn find_character_state_by_id(
    conn: &Connection,
    id: &str,
) -> Result<Option<CharacterStateDto>, String> {
    let sql = format!("{CHARACTER_STATE_SELECT} WHERE id = ?1");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_character_state_row)
        .optional()
        .map_err(|e| e.to_string())
}

pub fn find_character_state_owner(
    conn: &Connection,
    id: &str,
) -> Result<Option<(String, String, Option<String>)>, String> {
    conn.query_row(
        "SELECT novel_id, character_id, chapter_id FROM character_states WHERE id = ?1",
        params![id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        },
    )
    .optional()
    .map_err(|e| format!("character_state_existing_read_failed: {e}"))
}

pub fn find_character_states_by_character(
    conn: &Connection,
    character_id: &str,
) -> Result<Vec<CharacterStateDto>, String> {
    let sql = format!(
        "{CHARACTER_STATE_SELECT} WHERE character_id = ?1 ORDER BY created_at DESC, id DESC"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("character_state_list_prepare_failed: {e}"))?;
    let states = stmt
        .query_map(params![character_id], map_character_state_row)
        .map_err(|e| format!("character_state_list_query_failed: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("character_state_list_read_failed: {e}"))?;
    Ok(states)
}

pub fn find_character_states_by_chapter(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<CharacterStateDto>, String> {
    let sql =
        format!("{CHARACTER_STATE_SELECT} WHERE chapter_id = ?1 ORDER BY created_at DESC, id DESC");
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("character_state_list_prepare_failed: {e}"))?;
    let states = stmt
        .query_map(params![chapter_id], map_character_state_row)
        .map_err(|e| format!("character_state_list_query_failed: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("character_state_list_read_failed: {e}"))?;
    Ok(states)
}

pub fn find_latest_character_state_summary(
    conn: &Connection,
    novel_id: &str,
    character_id: &str,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT state_summary FROM character_states
         WHERE novel_id = ?1 AND character_id = ?2
         ORDER BY created_at DESC, id DESC LIMIT 1",
        params![novel_id, character_id],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| format!("character_state_latest_read_failed: {e}"))
}

#[allow(clippy::too_many_arguments)]
pub fn insert_character_state(
    conn: &Connection,
    id: &str,
    novel_id: &str,
    character_id: &str,
    chapter_id: Option<&str>,
    state_summary: &str,
    relationship_changes: Option<&str>,
    goal_changes: Option<&str>,
    location: Option<&str>,
    health_state: Option<&str>,
    knowledge_state: Option<&str>,
    created_at: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO character_states
         (id, novel_id, character_id, chapter_id, state_summary,
          relationship_changes, goal_changes, location, health_state,
          knowledge_state, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            id,
            novel_id,
            character_id,
            chapter_id,
            state_summary,
            relationship_changes,
            goal_changes,
            location,
            health_state,
            knowledge_state,
            created_at,
        ],
    )
    .map_err(|e| format!("character_state_bundle_insert_failed: {e}"))?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn update_character_state(
    conn: &Connection,
    id: &str,
    novel_id: &str,
    character_id: &str,
    state_summary: &str,
    relationship_changes: Option<&str>,
    goal_changes: Option<&str>,
    location: Option<&str>,
    health_state: Option<&str>,
    knowledge_state: Option<&str>,
) -> Result<(), String> {
    let affected = conn
        .execute(
            "UPDATE character_states SET state_summary = ?1, relationship_changes = ?2,
                goal_changes = ?3, location = ?4, health_state = ?5,
                knowledge_state = ?6
             WHERE id = ?7 AND novel_id = ?8 AND character_id = ?9",
            params![
                state_summary,
                relationship_changes,
                goal_changes,
                location,
                health_state,
                knowledge_state,
                id,
                novel_id,
                character_id,
            ],
        )
        .map_err(|e| format!("character_state_bundle_update_failed: {e}"))?;

    if affected != 1 {
        return Err("character_state_bundle_update_conflict".to_string());
    }
    Ok(())
}

pub fn update_character_current_state(
    conn: &Connection,
    novel_id: &str,
    character_id: &str,
    current_state: Option<&str>,
    updated_at: &str,
) -> Result<(), String> {
    let affected = conn
        .execute(
            "UPDATE characters SET current_state = ?1, updated_at = ?2
             WHERE id = ?3 AND novel_id = ?4",
            params![current_state, updated_at, character_id, novel_id],
        )
        .map_err(|e| format!("character_state_current_reconcile_failed: {e}"))?;
    if affected != 1 {
        return Err("character_state_character_missing".to_string());
    }
    Ok(())
}

pub fn update_active_character_current_state(
    conn: &Connection,
    novel_id: &str,
    character_id: &str,
    current_state: &str,
    updated_at: &str,
) -> Result<(), String> {
    let affected = conn
        .execute(
            "UPDATE characters SET current_state = ?1, updated_at = ?2
             WHERE id = ?3 AND novel_id = ?4 AND is_active = 1",
            params![current_state, updated_at, character_id, novel_id],
        )
        .map_err(|e| format!("character_current_state_update_failed: {e}"))?;
    if affected != 1 {
        return Err("character_current_state_update_conflict".to_string());
    }
    Ok(())
}

pub fn delete_character_state(conn: &Connection, id: &str) -> Result<(), String> {
    let affected = conn
        .execute("DELETE FROM character_states WHERE id = ?1", params![id])
        .map_err(|e| format!("character_state_delete_failed: {e}"))?;
    if affected != 1 {
        return Err("character_state_delete_conflict".to_string());
    }
    Ok(())
}
