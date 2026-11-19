//! Character-state input validation kept separate from chapter context persistence.
use crate::domain::context::SaveCharacterStateInput;
use crate::services::chapter_summary_service::validate_uuid;
use rusqlite::{params, Connection};

pub fn validate_character_state_input(
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
