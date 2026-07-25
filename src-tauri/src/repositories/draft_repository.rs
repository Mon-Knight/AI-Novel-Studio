use crate::errors::{codes, AppError};
use rusqlite::{params, Connection, OptionalExtension};

#[derive(Debug, Clone)]
pub struct DraftRecord {
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
    pub content_hash: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub fn validate_target(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
) -> Result<(), AppError> {
    let novel_deleted = connection
        .query_row(
            "SELECT deleted_at FROM novels WHERE id = ?1",
            params![novel_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(AppError::database)?;
    if novel_deleted.is_none() || novel_deleted.flatten().is_some() {
        return Err(AppError::new(
            codes::TARGET_NOVEL_NOT_FOUND,
            "目标作品不存在",
            false,
        ));
    }

    let chapter = connection
        .query_row(
            "SELECT novel_id, deleted_at FROM chapters WHERE id = ?1",
            params![chapter_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()
        .map_err(AppError::database)?;
    let Some((chapter_novel_id, deleted_at)) = chapter else {
        return Err(AppError::new(
            codes::TARGET_CHAPTER_NOT_FOUND,
            "目标章节不存在",
            false,
        ));
    };
    if chapter_novel_id != novel_id {
        return Err(AppError::new(
            codes::TARGET_CHAPTER_NOT_FOUND,
            "目标章节不属于当前作品",
            false,
        ));
    }
    if deleted_at.is_some() {
        return Err(AppError::new(
            codes::TARGET_CHAPTER_DELETED,
            "目标章节已删除",
            false,
        ));
    }
    Ok(())
}

pub fn find_draft(
    connection: &Connection,
    draft_id: &str,
) -> Result<Option<DraftRecord>, AppError> {
    connection
        .query_row(
            "SELECT id, novel_id, chapter_id, title, content, source, version_no,
                    word_count, is_adopted, ai_task_id, note, large_text_ref_id, content_hash,
                    created_at, updated_at
             FROM chapter_drafts WHERE id = ?1",
            params![draft_id],
            |row| {
                Ok(DraftRecord {
                    id: row.get(0)?,
                    novel_id: row.get(1)?,
                    chapter_id: row.get(2)?,
                    title: row.get(3)?,
                    content: row.get(4)?,
                    source: row.get(5)?,
                    version_no: row.get(6)?,
                    word_count: row.get(7)?,
                    is_adopted: row.get::<_, i64>(8)? != 0,
                    ai_task_id: row.get(9)?,
                    note: row.get(10)?,
                    large_text_ref_id: row.get(11)?,
                    content_hash: row.get(12)?,
                    created_at: row.get(13)?,
                    updated_at: row.get(14)?,
                })
            },
        )
        .optional()
        .map_err(AppError::database)
}

pub fn next_version(connection: &Connection, chapter_id: &str) -> Result<i64, AppError> {
    connection
        .query_row(
            "SELECT COALESCE(MAX(version_no), 0) + 1 FROM chapter_drafts WHERE chapter_id = ?1",
            params![chapter_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)
}

#[allow(clippy::too_many_arguments)]
pub fn insert_draft(
    connection: &Connection,
    id: &str,
    novel_id: &str,
    chapter_id: &str,
    title: Option<&str>,
    content: &str,
    source: &str,
    version_no: i64,
    word_count: i64,
    ai_task_id: Option<&str>,
    note: Option<&str>,
    large_text_ref_id: Option<&str>,
    content_hash: &str,
    now: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO chapter_drafts
                (id, novel_id, chapter_id, title, content, source, version_no, word_count,
                 is_adopted, ai_task_id, note, large_text_ref_id, content_hash, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10, ?11, ?12, ?13, ?13)",
            params![
                id,
                novel_id,
                chapter_id,
                title,
                content,
                source,
                version_no,
                word_count,
                ai_task_id,
                note,
                large_text_ref_id,
                content_hash,
                now
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn update_draft(
    connection: &Connection,
    id: &str,
    novel_id: &str,
    chapter_id: &str,
    expected_version: Option<i64>,
    title: Option<&str>,
    content: &str,
    source: &str,
    word_count: i64,
    large_text_ref_id: Option<&str>,
    content_hash: &str,
    now: &str,
) -> Result<usize, AppError> {
    let affected = if let Some(version) = expected_version {
        connection.execute(
            "UPDATE chapter_drafts
             SET title = COALESCE(?1, title), content = ?2, source = ?3, word_count = ?4,
                 large_text_ref_id = ?5, content_hash = ?6, updated_at = ?7
             WHERE id = ?8 AND novel_id = ?9 AND chapter_id = ?10 AND version_no = ?11",
            params![
                title,
                content,
                source,
                word_count,
                large_text_ref_id,
                content_hash,
                now,
                id,
                novel_id,
                chapter_id,
                version
            ],
        )
    } else {
        connection.execute(
            "UPDATE chapter_drafts
             SET title = COALESCE(?1, title), content = ?2, source = ?3, word_count = ?4,
                 large_text_ref_id = ?5, content_hash = ?6, updated_at = ?7
             WHERE id = ?8 AND novel_id = ?9 AND chapter_id = ?10",
            params![
                title,
                content,
                source,
                word_count,
                large_text_ref_id,
                content_hash,
                now,
                id,
                novel_id,
                chapter_id
            ],
        )
    }
    .map_err(AppError::database)?;
    Ok(affected)
}
