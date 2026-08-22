use crate::domain::writing::{
    ChapterDraftDto, ChapterDto, CreateChapterDraftInput, UpdateChapterInput,
};
use rusqlite::{params, Connection, OptionalExtension, Row};

pub fn count_words(content: &str) -> i64 {
    let mut count = 0_i64;
    let mut in_ascii_word = false;

    for character in content.chars() {
        let is_cjk = ('\u{3400}'..='\u{4dbf}').contains(&character)
            || ('\u{4e00}'..='\u{9fff}').contains(&character);
        if is_cjk {
            count += 1;
            in_ascii_word = false;
        } else if character.is_ascii_alphanumeric() {
            if !in_ascii_word {
                count += 1;
                in_ascii_word = true;
            }
        } else {
            in_ascii_word = false;
        }
    }

    count
}

pub fn map_chapter_row(row: &Row<'_>) -> rusqlite::Result<ChapterDto> {
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
}

pub fn map_draft_row(row: &Row<'_>) -> rusqlite::Result<ChapterDraftDto> {
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

pub fn find_by_novel_id(conn: &Connection, novel_id: &str) -> Result<Vec<ChapterDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, novel_id, volume_id, title, outline, goal, order_index, status, adopted_draft_id, word_count, target_word_count, created_at, updated_at FROM chapters WHERE novel_id = ?1 AND deleted_at IS NULL ORDER BY order_index ASC")
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![novel_id], map_chapter_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn find_by_volume_id(conn: &Connection, volume_id: &str) -> Result<Vec<ChapterDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, novel_id, volume_id, title, outline, goal, order_index, status, adopted_draft_id, word_count, target_word_count, created_at, updated_at FROM chapters WHERE volume_id = ?1 AND deleted_at IS NULL ORDER BY order_index ASC")
        .map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![volume_id], map_chapter_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn find_by_id(conn: &Connection, id: &str) -> Result<Option<ChapterDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, novel_id, volume_id, title, outline, goal, order_index, status, adopted_draft_id, word_count, target_word_count, created_at, updated_at FROM chapters WHERE id = ?1 AND deleted_at IS NULL")
        .map_err(|e| e.to_string())?;
    match stmt.query_row(params![id], map_chapter_row) {
        Ok(chapter) => Ok(Some(chapter)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn insert(
    conn: &Connection,
    id: &str,
    novel_id: &str,
    volume_id: Option<&str>,
    title: &str,
    outline: Option<&str>,
    goal: Option<&str>,
    order_index: i64,
    status: &str,
    target_word_count: Option<i64>,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO chapters (id, novel_id, volume_id, title, outline, goal, order_index, status, word_count, target_word_count, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,?9,?10,?10)",
        params![id, novel_id, volume_id, title, outline, goal, order_index, status, target_word_count, now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update(
    conn: &Connection,
    id: &str,
    input: &UpdateChapterInput,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE chapters
         SET volume_id = COALESCE(?1, volume_id),
             title = COALESCE(?2, title),
             outline = COALESCE(?3, outline),
             goal = COALESCE(?4, goal),
             order_index = COALESCE(?5, order_index),
             status = COALESCE(?6, status),
             target_word_count = COALESCE(?7, target_word_count),
             updated_at = ?8
         WHERE id = ?9",
        params![
            input.volume_id.as_deref(),
            input.title.as_deref(),
            input.outline.as_deref(),
            input.goal.as_deref(),
            input.order_index,
            input.status.as_deref(),
            input.target_word_count,
            now,
            id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn find_drafts_by_chapter_id(
    conn: &Connection,
    chapter_id: &str,
    page: Option<i64>,
    size: Option<i64>,
) -> Result<Vec<ChapterDraftDto>, String> {
    let paged = page.is_some() || size.is_some();
    let page = page.unwrap_or(1).max(1);
    let size = size.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * size;
    let sql = if paged {
        "SELECT id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, ai_task_id, note, large_text_ref_id, created_at, updated_at FROM chapter_drafts WHERE chapter_id = ?1 ORDER BY version_no DESC LIMIT ?2 OFFSET ?3"
    } else {
        "SELECT id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, ai_task_id, note, large_text_ref_id, created_at, updated_at FROM chapter_drafts WHERE chapter_id = ?1 ORDER BY version_no ASC"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let items = if paged {
        stmt.query_map(params![chapter_id, size, offset], map_draft_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    } else {
        stmt.query_map(params![chapter_id], map_draft_row)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    Ok(items)
}

pub fn count_drafts_by_chapter_id(conn: &Connection, chapter_id: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM chapter_drafts WHERE chapter_id = ?1",
        params![chapter_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

pub fn find_latest_draft(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Option<ChapterDraftDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, ai_task_id, note, large_text_ref_id, created_at, updated_at FROM chapter_drafts WHERE chapter_id = ?1 ORDER BY version_no DESC LIMIT 1")
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![chapter_id], map_draft_row)
        .optional()
        .map_err(|e| e.to_string())
}

pub fn find_adopted_draft(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Option<ChapterDraftDto>, String> {
    let mut stmt = conn
        .prepare("SELECT id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, ai_task_id, note, large_text_ref_id, created_at, updated_at FROM chapter_drafts WHERE chapter_id = ?1 AND is_adopted = 1 ORDER BY version_no DESC LIMIT 1")
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![chapter_id], map_draft_row)
        .optional()
        .map_err(|e| e.to_string())
}

pub fn find_draft_by_chapter_and_id(
    conn: &Connection,
    chapter_id: &str,
    draft_id: &str,
) -> Result<Option<ChapterDraftDto>, String> {
    let mut stmt = conn
        .prepare("SELECT d.id, d.novel_id, d.chapter_id, d.title, d.content, d.source, d.version_no, d.word_count, d.is_adopted, d.ai_task_id, d.note, d.large_text_ref_id, d.created_at, d.updated_at FROM chapter_drafts AS d INNER JOIN chapters AS c ON c.id = d.chapter_id AND c.novel_id = d.novel_id WHERE d.id = ?1 AND d.chapter_id = ?2 AND c.deleted_at IS NULL")
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![draft_id, chapter_id], map_draft_row)
        .optional()
        .map_err(|e| e.to_string())
}

#[allow(dead_code)]
pub fn insert_draft(
    conn: &Connection,
    id: &str,
    input: &CreateChapterDraftInput,
    version_no: i64,
    word_count: i64,
    ai_task_id: Option<&str>,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO chapter_drafts (id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, ai_task_id, note, large_text_ref_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10, ?11, ?12, ?12)",
        params![
            id,
            input.novel_id,
            input.chapter_id,
            input.title.as_deref(),
            input.content,
            input.source,
            version_no,
            word_count,
            ai_task_id,
            input.note.as_deref(),
            input.large_text_ref_id.as_deref(),
            now,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_draft_by_id_internal(conn: &Connection, id: &str) -> Result<ChapterDraftDto, String> {
    let mut stmt = conn.prepare("SELECT id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, ai_task_id, note, large_text_ref_id, created_at, updated_at FROM chapter_drafts WHERE id = ?1").map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_draft_row)
        .map_err(|e| e.to_string())
}

pub fn get_draft_by_id_and_chapter_internal(
    conn: &Connection,
    id: &str,
    chapter_id: &str,
) -> Result<ChapterDraftDto, String> {
    let mut stmt = conn
        .prepare("SELECT d.id, d.novel_id, d.chapter_id, d.title, d.content, d.source, d.version_no, d.word_count, d.is_adopted, d.ai_task_id, d.note, d.large_text_ref_id, d.created_at, d.updated_at FROM chapter_drafts AS d INNER JOIN chapters AS c ON c.id = d.chapter_id AND c.novel_id = d.novel_id WHERE d.id = ?1 AND d.chapter_id = ?2 AND c.deleted_at IS NULL")
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![id, chapter_id], map_draft_row)
        .map_err(|e| e.to_string())
}
