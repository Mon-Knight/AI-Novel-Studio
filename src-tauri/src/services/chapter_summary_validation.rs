//! Chapter summary source ownership queries.
use crate::domain::context::SaveChapterSummaryInput;
use rusqlite::{params, Connection, OptionalExtension};

pub(super) fn validate_summary_references(
    conn: &Connection,
    input: &SaveChapterSummaryInput,
    require_current_adopted_draft: bool,
) -> Result<(), String> {
    let novel_exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM novels WHERE id = ?1 AND deleted_at IS NULL)",
            params![&input.novel_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("chapter_summary_novel_read_failed: {error}"))?;
    if !novel_exists {
        return Err("chapter_summary_novel_not_found".to_string());
    }
    let chapter = conn
        .query_row(
            "SELECT volume_id, adopted_draft_id FROM chapters
             WHERE id = ?1 AND novel_id = ?2 AND deleted_at IS NULL",
            params![&input.chapter_id, &input.novel_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("chapter_summary_chapter_read_failed: {error}"))?
        .ok_or_else(|| "chapter_summary_chapter_ownership_mismatch".to_string())?;
    if input.volume_id.is_some() && input.volume_id != chapter.0 {
        return Err("chapter_summary_volume_ownership_mismatch".to_string());
    }
    if require_current_adopted_draft
        && chapter.1.as_deref() != Some(input.adopted_draft_id.as_str())
    {
        return Err("chapter_summary_adopted_draft_mismatch".to_string());
    }
    Ok(())
}
