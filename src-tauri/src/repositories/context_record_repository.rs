use crate::domain::context::ContextRecordDto;
use rusqlite::{params, Connection, OptionalExtension};

pub fn map_context_record_row(row: &rusqlite::Row) -> rusqlite::Result<ContextRecordDto> {
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

pub const CONTEXT_RECORD_SELECT: &str = "SELECT id, novel_id, chapter_id, volume_id, context_type, title, content, importance, is_active, is_expired, content_hash, draft_version, created_at, updated_at FROM context_records";

pub fn context_record_select_sql() -> &'static str {
    CONTEXT_RECORD_SELECT
}

pub fn find_context_record_by_id(
    conn: &Connection,
    id: &str,
) -> Result<Option<ContextRecordDto>, String> {
    let sql = format!("{CONTEXT_RECORD_SELECT} WHERE id = ?1");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_context_record_row)
        .optional()
        .map_err(|e| format!("context_record_read_failed: {e}"))
}

pub fn find_context_records_by_novel(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<ContextRecordDto>, String> {
    let sql =
        format!("{CONTEXT_RECORD_SELECT} WHERE novel_id = ?1 ORDER BY created_at DESC, id DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![novel_id], map_context_record_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

#[allow(dead_code)]
pub fn find_context_records_by_chapter(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<ContextRecordDto>, String> {
    let sql =
        format!("{CONTEXT_RECORD_SELECT} WHERE chapter_id = ?1 ORDER BY created_at DESC, id DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![chapter_id], map_context_record_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn find_context_record_owner(
    conn: &Connection,
    id: &str,
) -> Result<Option<(String, Option<String>)>, String> {
    conn.query_row(
        "SELECT novel_id, chapter_id FROM context_records WHERE id = ?1",
        params![id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
    )
    .optional()
    .map_err(|e| format!("context_record_ownership_read_failed: {e}"))
}

#[allow(clippy::too_many_arguments)]
pub fn insert_context_record(
    conn: &Connection,
    id: &str,
    novel_id: &str,
    chapter_id: Option<&str>,
    volume_id: Option<&str>,
    context_type: &str,
    title: &str,
    content: &str,
    importance: i64,
    is_active: bool,
    content_hash: Option<&str>,
    draft_version: Option<i64>,
    created_at: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO context_records
         (id, novel_id, chapter_id, volume_id, context_type, title, content,
          importance, is_active, is_expired, content_hash, draft_version,
          created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11, ?12, ?12)",
        params![
            id,
            novel_id,
            chapter_id,
            volume_id,
            context_type,
            title,
            content,
            importance,
            is_active as i64,
            content_hash,
            draft_version,
            created_at,
        ],
    )
    .map_err(|e| format!("context_record_insert_failed: {e}"))?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn update_context_record(
    conn: &Connection,
    id: &str,
    novel_id: &str,
    chapter_id: Option<&str>,
    volume_id: Option<&str>,
    context_type: &str,
    title: &str,
    content: &str,
    importance: i64,
    is_active: bool,
    is_expired: bool,
    content_hash: Option<&str>,
    draft_version: Option<i64>,
    updated_at: &str,
) -> Result<(), String> {
    let affected = conn
        .execute(
            "UPDATE context_records
             SET chapter_id = ?1, volume_id = ?2, context_type = ?3, title = ?4,
                 content = ?5, importance = ?6, is_active = ?7, is_expired = ?8,
                 content_hash = ?9, draft_version = ?10, updated_at = ?11
             WHERE id = ?12 AND novel_id = ?13",
            params![
                chapter_id,
                volume_id,
                context_type,
                title,
                content,
                importance,
                is_active as i64,
                is_expired as i64,
                content_hash,
                draft_version,
                updated_at,
                id,
                novel_id,
            ],
        )
        .map_err(|e| format!("context_record_update_failed: {e}"))?;

    if affected != 1 {
        return Err("context_record_update_conflict".to_string());
    }
    Ok(())
}

pub fn update_context_record_active(
    conn: &Connection,
    id: &str,
    is_active: bool,
    updated_at: &str,
) -> Result<(), String> {
    let affected = conn
        .execute(
            "UPDATE context_records SET is_active = ?1, updated_at = ?2 WHERE id = ?3",
            params![is_active as i64, updated_at, id],
        )
        .map_err(|e| e.to_string())?;

    if affected != 1 {
        return Err("context_record_not_found".to_string());
    }
    Ok(())
}

pub fn expire_context_records_by_chapter(
    conn: &Connection,
    chapter_id: &str,
    updated_at: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE context_records SET is_expired = 1, updated_at = ?1 WHERE chapter_id = ?2",
        params![updated_at, chapter_id],
    )
    .map_err(|e| format!("chapter_context_records_expire_failed: {e}"))?;
    Ok(())
}

pub fn delete_context_record(conn: &Connection, id: &str) -> Result<(), String> {
    let affected = conn
        .execute("DELETE FROM context_records WHERE id = ?1", params![id])
        .map_err(|e| format!("context_record_delete_failed: {e}"))?;
    if affected != 1 {
        return Err("context_record_not_found".to_string());
    }
    Ok(())
}
