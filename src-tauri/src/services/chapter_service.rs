use crate::domain::writing::{
    ChapterDraftDto, ChapterDto, CreateChapterDraftInput, CreateChapterInput, UpdateChapterInput,
    CHAPTER_STATUSES,
};
use crate::repositories::chapter_repository;
use rusqlite::{params, Connection, OptionalExtension};

pub fn validate_chapter_update_input(input: &UpdateChapterInput) -> Result<(), String> {
    if let Some(status) = input.status.as_deref() {
        if !CHAPTER_STATUSES.contains(&status) {
            return Err("chapter_status_invalid".to_string());
        }
    }
    Ok(())
}

pub fn list_chapters_by_novel(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<ChapterDto>, String> {
    chapter_repository::find_by_novel_id(conn, novel_id)
}

pub fn list_chapters_by_volume(
    conn: &Connection,
    volume_id: &str,
) -> Result<Vec<ChapterDto>, String> {
    chapter_repository::find_by_volume_id(conn, volume_id)
}

pub fn get_chapter(conn: &Connection, id: &str) -> Result<Option<ChapterDto>, String> {
    chapter_repository::find_by_id(conn, id)
}

pub fn create_chapter(conn: &Connection, input: CreateChapterInput) -> Result<ChapterDto, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let order = input.order_index.unwrap_or(0);
    let status = if input.outline.is_some() {
        "outline_ready"
    } else {
        "not_started"
    };

    chapter_repository::insert(
        conn,
        &id,
        &input.novel_id,
        input.volume_id.as_deref(),
        &input.title,
        input.outline.as_deref(),
        input.goal.as_deref(),
        order,
        status,
        input.target_word_count,
        &now,
    )?;

    chapter_repository::find_by_id(conn, &id)?.ok_or_else(|| "章节创建后无法读取".to_string())
}

pub fn update_chapter(
    conn: &Connection,
    id: &str,
    input: UpdateChapterInput,
) -> Result<ChapterDto, String> {
    validate_chapter_update_input(&input)?;
    let now = chrono::Utc::now().to_rfc3339();
    chapter_repository::update(conn, id, &input, &now)?;
    chapter_repository::find_by_id(conn, id)?.ok_or_else(|| format!("未找到指定章节: {}", id))
}

pub fn delete_chapter(conn: &mut Connection, id: &str) -> Result<(), String> {
    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    let novel_id: String = transaction
        .query_row(
            "SELECT novel_id FROM chapters WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let affected = transaction
        .execute(
            "UPDATE chapters SET deleted_at = ?1 WHERE id = ?2",
            params![now, id],
        )
        .map_err(|e| e.to_string())?;
    if affected != 1 {
        return Err("TARGET_CHAPTER_NOT_FOUND: 章节删除未命中唯一目标".to_string());
    }
    let recovery_document_id =
        crate::repositories::recovery_repository::get(&transaction, &novel_id, id)
            .map_err(|error| error.to_string())?
            .and_then(|snapshot| snapshot.large_text_ref_id);
    crate::repositories::recovery_repository::delete_exact(&transaction, &novel_id, id)
        .map_err(|error| error.to_string())?;
    if let Some(document_id) = recovery_document_id {
        crate::repositories::large_text_repository::delete_if_unreferenced(
            &transaction,
            &document_id,
        )
        .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ==================== Draft Operations ====================

pub fn list_drafts_by_chapter(
    conn: &Connection,
    chapter_id: &str,
    page: Option<i64>,
    size: Option<i64>,
) -> Result<Vec<ChapterDraftDto>, String> {
    chapter_repository::find_drafts_by_chapter_id(conn, chapter_id, page, size)
}

pub fn count_drafts_by_chapter(conn: &Connection, chapter_id: &str) -> Result<i64, String> {
    chapter_repository::count_drafts_by_chapter_id(conn, chapter_id)
}

pub fn get_latest_draft(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Option<ChapterDraftDto>, String> {
    chapter_repository::find_latest_draft(conn, chapter_id)
}

pub fn get_adopted_draft(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Option<ChapterDraftDto>, String> {
    chapter_repository::find_adopted_draft(conn, chapter_id)
}

pub fn get_draft_by_chapter_and_id(
    conn: &Connection,
    chapter_id: &str,
    draft_id: &str,
) -> Result<Option<ChapterDraftDto>, String> {
    chapter_repository::find_draft_by_chapter_and_id(conn, chapter_id, draft_id)
}

#[allow(dead_code)]
pub fn create_chapter_draft(
    conn: &Connection,
    input: CreateChapterDraftInput,
) -> Result<ChapterDraftDto, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let max_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version_no), 0) FROM chapter_drafts WHERE chapter_id = ?1",
            params![&input.chapter_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let word_count = chapter_repository::count_words(&input.content);
    let ai_task_id = match input.ai_task_id.as_deref() {
        Some(task_id) if !task_id.is_empty() => {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM ai_task_records WHERE id = ?1",
                    params![task_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if exists > 0 {
                Some(task_id)
            } else {
                None
            }
        }
        _ => None,
    };

    chapter_repository::insert_draft(
        conn,
        &id,
        &input,
        max_version + 1,
        word_count,
        ai_task_id,
        &now,
    )?;

    chapter_repository::find_draft_by_chapter_and_id(conn, &input.chapter_id, &id)?
        .ok_or_else(|| "草稿创建后无法读取".to_string())
}

fn validate_live_draft_target(
    conn: &Connection,
    draft_id: &str,
    chapter_id: &str,
) -> Result<i64, String> {
    let target = conn.query_row(
        "SELECT d.chapter_id, d.novel_id, d.word_count, d.large_text_ref_id, c.id, c.novel_id, c.deleted_at FROM chapter_drafts AS d LEFT JOIN chapters AS c ON c.id = ?2 WHERE d.id = ?1",
        params![draft_id, chapter_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        },
    );

    let (
        actual_chapter_id,
        draft_novel_id,
        word_count,
        large_text_ref_id,
        target_chapter_id,
        chapter_novel_id,
        deleted_at,
    ) = match target {
        Ok(target) => target,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(format!(
                "target_not_found: chapter draft '{}' does not exist",
                draft_id
            ));
        }
        Err(e) => return Err(format!("adopt_target_lookup_failed: {}", e)),
    };

    if actual_chapter_id != chapter_id {
        return Err(format!(
            "target_mismatch: chapter draft '{}' belongs to chapter '{}', not '{}'",
            draft_id, actual_chapter_id, chapter_id
        ));
    }

    if target_chapter_id.is_none() {
        return Err(format!(
            "target_not_found: chapter '{}' does not exist",
            chapter_id
        ));
    }

    if deleted_at.is_some() {
        return Err(format!(
            "target_deleted: chapter '{}' has been deleted",
            chapter_id
        ));
    }

    if chapter_novel_id.as_deref() != Some(draft_novel_id.as_str()) {
        return Err(format!(
            "target_mismatch: chapter draft novel '{}' does not match chapter novel '{:?}'",
            draft_novel_id, chapter_novel_id
        ));
    }

    if let Some(document_id) = large_text_ref_id.as_deref() {
        let full_content =
            crate::large_text_save::read_large_text_document_internal(conn, document_id)
                .map_err(|e| format!("adopt_large_text_read_failed: {}", e))?;
        return Ok(chapter_repository::count_words(&full_content));
    }

    Ok(word_count)
}

fn expire_chapter_context_rows(
    conn: &Connection,
    chapter_id: &str,
    updated_at: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE chapter_summaries SET is_expired = 1, updated_at = ?1 WHERE chapter_id = ?2",
        params![updated_at, chapter_id],
    )
    .map_err(|error| format!("chapter_summary_expire_failed: {error}"))?;
    conn.execute(
        "UPDATE context_records SET is_expired = 1, updated_at = ?1 WHERE chapter_id = ?2",
        params![updated_at, chapter_id],
    )
    .map_err(|error| format!("chapter_context_records_expire_failed: {error}"))?;
    Ok(())
}

pub fn adopt_chapter_draft(
    conn: &mut Connection,
    draft_id: &str,
    chapter_id: &str,
) -> Result<ChapterDraftDto, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction()
        .map_err(|e| format!("adopt_transaction_begin_failed: {}", e))?;

    let word_count = validate_live_draft_target(&transaction, draft_id, chapter_id)?;
    let (chapter_novel_id, previous_adopted_draft_id) = transaction
        .query_row(
            "SELECT novel_id, adopted_draft_id FROM chapters
             WHERE id = ?1 AND deleted_at IS NULL",
            params![chapter_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .map_err(|e| format!("adopt_previous_draft_lookup_failed: {}", e))?;
    let adopted_draft_changed = previous_adopted_draft_id.as_deref() != Some(draft_id);

    transaction
        .execute(
            "UPDATE chapter_drafts SET is_adopted = 0, updated_at = ?1 WHERE chapter_id = ?2",
            params![&now, chapter_id],
        )
        .map_err(|e| format!("adopt_clear_previous_failed: {}", e))?;

    let adopted_rows = transaction.execute(
        "UPDATE chapter_drafts SET is_adopted = 1, updated_at = ?1 WHERE id = ?2 AND chapter_id = ?3 AND EXISTS (SELECT 1 FROM chapters AS c WHERE c.id = chapter_drafts.chapter_id AND c.novel_id = chapter_drafts.novel_id AND c.deleted_at IS NULL)",
        params![&now, draft_id, chapter_id],
    ).map_err(|e| format!("adopt_target_update_failed: {}", e))?;
    if adopted_rows != 1 {
        return Err(format!(
            "adopt_conflict: expected one target draft for id={} chapter_id={}, affected_rows={}",
            draft_id, chapter_id, adopted_rows
        ));
    }

    let chapter_rows = transaction.execute(
        "UPDATE chapters SET adopted_draft_id = ?1, word_count = ?2, status = 'adopted', updated_at = ?3 WHERE id = ?4 AND deleted_at IS NULL AND novel_id = (SELECT novel_id FROM chapter_drafts WHERE id = ?1 AND chapter_id = ?4)",
        params![draft_id, word_count, &now, chapter_id],
    ).map_err(|e| format!("adopt_chapter_update_failed: {}", e))?;
    if chapter_rows != 1 {
        return Err(format!(
            "adopt_chapter_conflict: expected one chapter for id={}, affected_rows={}",
            chapter_id, chapter_rows
        ));
    }

    if adopted_draft_changed {
        expire_chapter_context_rows(&transaction, chapter_id, &now)?;
        crate::services::memory_service::invalidate_for_adopted_draft_change(
            &transaction,
            &chapter_novel_id,
            chapter_id,
            draft_id,
            &now,
        )
        .map_err(|e| format!("adopt_memory_invalidation_failed: {}", e))?;
    }

    let adopted = chapter_repository::get_draft_by_id_and_chapter_internal(
        &transaction,
        draft_id,
        chapter_id,
    )
    .map_err(|e| format!("adopt_readback_failed: {}", e))?;
    if !adopted.is_adopted {
        return Err(format!(
            "adopt_readback_conflict: draft '{}' is not marked adopted",
            draft_id
        ));
    }

    transaction
        .commit()
        .map_err(|e| format!("adopt_transaction_commit_failed: {}", e))?;
    Ok(adopted)
}

pub fn delete_chapter_draft(
    conn: &mut Connection,
    id: &str,
    chapter_id: &str,
) -> Result<(), String> {
    let transaction = conn
        .transaction()
        .map_err(|e| format!("draft_delete_transaction_begin_failed: {}", e))?;
    let old_large_text_ref = transaction
        .query_row(
            "SELECT large_text_ref_id FROM chapter_drafts WHERE id = ?1 AND chapter_id = ?2",
            params![id, chapter_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|e| format!("draft_delete_large_text_lookup_failed: {}", e))?;

    let deleted_rows = transaction
        .execute(
            "DELETE FROM chapter_drafts WHERE id = ?1 AND chapter_id = ?2",
            params![id, chapter_id],
        )
        .map_err(|e| format!("draft_delete_failed: {}", e))?;
    if deleted_rows != 1 {
        return Err(format!(
            "draft_delete_conflict: expected one draft for id={} chapter_id={}",
            id, chapter_id
        ));
    }

    if let Some(Some(old_document_id)) = old_large_text_ref {
        crate::large_text_save::delete_unreferenced_draft_large_text(
            &transaction,
            &old_document_id,
        )?;
    }

    transaction.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_chapter_draft_internal(
    conn: &Connection,
    id: &str,
    chapter_id: &str,
    content: &str,
    source: Option<&str>,
    large_text_ref_id: Option<&str>,
) -> Result<ChapterDraftDto, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let source = source.unwrap_or("user_edited");
    let word_count = chapter_repository::count_words(content);
    let affected_rows = conn.execute(
        "UPDATE chapter_drafts SET content = ?1, source = ?2, word_count = ?3, large_text_ref_id = ?4, updated_at = ?5 WHERE id = ?6 AND chapter_id = ?7 AND EXISTS (SELECT 1 FROM chapters AS c WHERE c.id = chapter_drafts.chapter_id AND c.novel_id = chapter_drafts.novel_id AND c.deleted_at IS NULL)",
        params![content, source, word_count, large_text_ref_id, now, id, chapter_id],
    ).map_err(|e| format!("draft_update_failed: {}", e))?;

    if affected_rows != 1 {
        return Err(format!(
            "draft_update_conflict: expected one draft for id={} chapter_id={}, affected_rows={}",
            id, chapter_id, affected_rows
        ));
    }

    chapter_repository::get_draft_by_id_and_chapter_internal(conn, id, chapter_id)
        .map_err(|e| format!("draft_update_readback_failed: {}", e))
}

pub fn update_chapter_draft_with_cleanup_internal(
    conn: &mut Connection,
    id: &str,
    chapter_id: &str,
    content: &str,
    source: Option<&str>,
    large_text_ref_id: Option<&str>,
) -> Result<ChapterDraftDto, String> {
    let transaction = conn
        .transaction()
        .map_err(|e| format!("draft_update_transaction_begin_failed: {}", e))?;
    let old_large_text_ref = transaction
        .query_row(
            "SELECT large_text_ref_id FROM chapter_drafts WHERE id = ?1 AND chapter_id = ?2",
            params![id, chapter_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|e| format!("draft_update_large_text_lookup_failed: {}", e))?
        .ok_or_else(|| {
            format!(
                "draft_update_conflict: expected one draft for id={} chapter_id={}",
                id, chapter_id
            )
        })?;
    let draft = update_chapter_draft_internal(
        &transaction,
        id,
        chapter_id,
        content,
        source,
        large_text_ref_id,
    )?;
    if let Some(old_document_id) = old_large_text_ref.as_deref() {
        if large_text_ref_id != Some(old_document_id) {
            crate::large_text_save::delete_unreferenced_draft_large_text(
                &transaction,
                old_document_id,
            )?;
        }
    }
    transaction
        .commit()
        .map_err(|e| format!("draft_update_transaction_commit_failed: {}", e))?;
    Ok(draft)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::create_tables(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO novels (id, title, created_at, updated_at) VALUES ('novel-1', '测试小说', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn
    }

    #[test]
    fn test_chapter_and_draft_lifecycle() {
        let mut conn = setup_test_db();
        let chapter = create_chapter(
            &conn,
            CreateChapterInput {
                novel_id: "novel-1".to_string(),
                volume_id: None,
                title: "第一章 测试".to_string(),
                outline: Some("大纲内容".to_string()),
                goal: Some("交代世界观".to_string()),
                target_word_count: Some(3000),
                order_index: Some(1),
            },
        )
        .unwrap();

        assert_eq!(chapter.title, "第一章 测试");
        assert_eq!(chapter.status, "outline_ready");

        let draft = create_chapter_draft(
            &conn,
            CreateChapterDraftInput {
                novel_id: "novel-1".to_string(),
                chapter_id: chapter.id.clone(),
                title: Some("草稿初版".to_string()),
                content: "这是正文第一段，天朗气清。".to_string(),
                source: "ai_generate".to_string(),
                ai_task_id: None,
                note: None,
                large_text_ref_id: None,
            },
        )
        .unwrap();

        assert_eq!(draft.version_no, 1);
        assert!(!draft.is_adopted);

        let adopted = adopt_chapter_draft(&mut conn, &draft.id, &chapter.id).unwrap();
        assert!(adopted.is_adopted);

        let ch = get_chapter(&conn, &chapter.id).unwrap().unwrap();
        assert_eq!(ch.status, "adopted");
        assert_eq!(ch.adopted_draft_id.as_deref(), Some(draft.id.as_str()));

        delete_chapter(&mut conn, &chapter.id).unwrap();
        assert!(get_chapter(&conn, &chapter.id).unwrap().is_none());
    }
}
