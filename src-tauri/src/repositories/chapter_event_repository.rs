use crate::domain::world::ChapterEventDto;
use rusqlite::{params, Connection, OptionalExtension, Row};

pub const CHAPTER_EVENT_SELECT: &str = "SELECT id, novel_id, chapter_id, title, description, involved_character_ids, impact, risk, status, source, ai_task_id, created_at, updated_at FROM chapter_events";

pub fn map_chapter_event_row(row: &Row<'_>) -> rusqlite::Result<ChapterEventDto> {
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

pub fn find_chapter_events_by_chapter(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<ChapterEventDto>, String> {
    let sql = format!("{CHAPTER_EVENT_SELECT} WHERE chapter_id = ?1 ORDER BY created_at ASC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![chapter_id], map_chapter_event_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn find_chapter_event_by_id(
    conn: &Connection,
    id: &str,
) -> Result<Option<ChapterEventDto>, String> {
    let sql = format!("{CHAPTER_EVENT_SELECT} WHERE id = ?1");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_chapter_event_row)
        .optional()
        .map_err(|e| e.to_string())
}

pub fn insert_chapter_event(
    conn: &Connection,
    id: &str,
    novel_id: &str,
    chapter_id: &str,
    title: &str,
    description: &str,
    involved_character_ids: Option<&str>,
    impact: Option<&str>,
    risk: Option<&str>,
    status: &str,
    source: &str,
    ai_task_id: Option<&str>,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO chapter_events (id, novel_id, chapter_id, title, description, involved_character_ids, impact, risk, status, source, ai_task_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
        params![
            id,
            novel_id,
            chapter_id,
            title,
            description,
            involved_character_ids,
            impact,
            risk,
            status,
            source,
            ai_task_id,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_chapter_event_fields(
    conn: &Connection,
    id: &str,
    title: Option<&str>,
    description: Option<&str>,
    involved_character_ids: Option<&str>,
    impact: Option<&str>,
    risk: Option<&str>,
    status: Option<&str>,
    now: &str,
) -> Result<(), String> {
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
            title,
            description,
            involved_character_ids,
            impact,
            risk,
            status,
            now,
            id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_chapter_event_status(
    conn: &Connection,
    id: &str,
    status: &str,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE chapter_events SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![status, now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_chapter_event(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM chapter_events WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
