use crate::domain::context::{ChapterSummaryDto, SaveChapterSummaryInput};
use crate::repositories::{chapter_summary_repository, context_record_repository};
use crate::services::memory_service;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};

pub fn validate_uuid(field: &str, value: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| format!("{field}_invalid_uuid"))
}

pub fn validate_summary_ownership(
    conn: &Connection,
    input: &SaveChapterSummaryInput,
    require_current_adopted_draft: bool,
) -> Result<(), String> {
    if let Some(id) = input.id.as_deref() {
        validate_uuid("chapter_summary_id", id)?;
    }
    validate_uuid("chapter_summary_novel_id", &input.novel_id)?;
    validate_uuid("chapter_summary_chapter_id", &input.chapter_id)?;
    validate_uuid("chapter_summary_adopted_draft_id", &input.adopted_draft_id)?;
    if let Some(volume_id) = input.volume_id.as_deref() {
        validate_uuid("chapter_summary_volume_id", volume_id)?;
    }
    if input.summary.trim().is_empty() {
        return Err("chapter_summary_content_required".to_string());
    }
    if input.draft_version.is_some_and(|version| version < 0) {
        return Err("chapter_summary_draft_version_invalid".to_string());
    }
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
    let draft_is_valid = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM chapter_drafts
                WHERE id = ?1 AND novel_id = ?2 AND chapter_id = ?3
                  AND (?4 = 0 OR is_adopted = 1)
             )",
            params![
                &input.adopted_draft_id,
                &input.novel_id,
                &input.chapter_id,
                i64::from(require_current_adopted_draft)
            ],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("chapter_summary_draft_read_failed: {error}"))?;
    if !draft_is_valid {
        return Err("chapter_summary_adopted_draft_ownership_mismatch".to_string());
    }
    Ok(())
}

pub fn upsert_chapter_summary(
    conn: &Connection,
    input: &SaveChapterSummaryInput,
    now: &str,
) -> Result<ChapterSummaryDto, String> {
    let selected_existing_id = if let Some(id) = input.id.as_deref() {
        chapter_summary_repository::find_summary_ownership(conn, id)?
            .map(|ownership| {
                if ownership.0 != input.novel_id || ownership.1 != input.chapter_id {
                    Err("chapter_summary_ownership_mismatch".to_string())
                } else {
                    Ok(id.to_string())
                }
            })
            .transpose()?
    } else {
        chapter_summary_repository::find_existing_summary_id_by_novel_and_chapter(
            conn,
            &input.novel_id,
            &input.chapter_id,
        )?
    };

    let id = selected_existing_id
        .or_else(|| input.id.clone())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let enabled = input.enabled.unwrap_or(true);

    let exists = chapter_summary_repository::summary_exists(conn, &id)?;
    if exists {
        chapter_summary_repository::update_chapter_summary(
            conn,
            &id,
            &input.novel_id,
            &input.chapter_id,
            input.volume_id.as_deref(),
            &input.adopted_draft_id,
            &input.summary,
            input.key_events.as_deref(),
            input.character_changes.as_deref(),
            input.relationship_changes.as_deref(),
            input.new_foreshadows.as_deref(),
            input.resolved_foreshadows.as_deref(),
            input.next_chapter_hints.as_deref(),
            input.core_events.as_deref(),
            input.protagonist_state_change.as_deref(),
            input.important_character_changes.as_deref(),
            input.setting_changes.as_deref(),
            input.new_locations.as_deref(),
            input.new_items_or_abilities.as_deref(),
            input.foreshadowing.as_deref(),
            input.unresolved_questions.as_deref(),
            input.facts_must_remember.as_deref(),
            input.next_chapter_hook.as_deref(),
            input.validation_status.as_deref(),
            input.validation_result.as_deref(),
            enabled,
            input.content_hash.as_deref(),
            input.draft_version,
            input.ai_task_id.as_deref(),
            now,
        )?;
    } else {
        chapter_summary_repository::insert_chapter_summary(
            conn,
            &id,
            &input.novel_id,
            &input.chapter_id,
            input.volume_id.as_deref(),
            &input.adopted_draft_id,
            &input.summary,
            input.key_events.as_deref(),
            input.character_changes.as_deref(),
            input.relationship_changes.as_deref(),
            input.new_foreshadows.as_deref(),
            input.resolved_foreshadows.as_deref(),
            input.next_chapter_hints.as_deref(),
            input.core_events.as_deref(),
            input.protagonist_state_change.as_deref(),
            input.important_character_changes.as_deref(),
            input.setting_changes.as_deref(),
            input.new_locations.as_deref(),
            input.new_items_or_abilities.as_deref(),
            input.foreshadowing.as_deref(),
            input.unresolved_questions.as_deref(),
            input.facts_must_remember.as_deref(),
            input.next_chapter_hook.as_deref(),
            input.validation_status.as_deref(),
            input.validation_result.as_deref(),
            enabled,
            input.content_hash.as_deref(),
            input.draft_version,
            input.ai_task_id.as_deref(),
            now,
        )?;
    }

    chapter_summary_repository::find_chapter_summary_by_id(conn, &id)?
        .ok_or_else(|| "chapter_summary_read_after_write_failed".to_string())
}

pub fn save_chapter_summary(
    conn: &Connection,
    input: SaveChapterSummaryInput,
) -> Result<ChapterSummaryDto, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|error| format!("chapter_summary_transaction_failed: {error}"))?;
    validate_summary_ownership(&transaction, &input, true)?;
    let summary = upsert_chapter_summary(&transaction, &input, &now)?;
    memory_service::sync_chapter_summary_in_transaction(&transaction, &summary, &now)
        .map_err(|error| format!("chapter_summary_memory_failed: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("chapter_summary_commit_failed: {error}"))?;
    Ok(summary)
}

pub fn get_chapter_summary(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Option<ChapterSummaryDto>, String> {
    chapter_summary_repository::find_chapter_summary_by_chapter(conn, chapter_id)
}

pub fn get_chapter_summaries_by_novel(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<ChapterSummaryDto>, String> {
    chapter_summary_repository::find_chapter_summaries_by_novel(conn, novel_id)
}

pub fn get_chapter_summary_by_id(
    conn: &Connection,
    id: &str,
) -> Result<Option<ChapterSummaryDto>, String> {
    validate_uuid("chapter_summary_id", id)?;
    chapter_summary_repository::find_chapter_summary_by_id(conn, id)
}

pub fn update_chapter_summary_enabled(
    conn: &Connection,
    id: &str,
    enabled: bool,
) -> Result<(), String> {
    validate_uuid("chapter_summary_id", id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|error| format!("chapter_summary_toggle_transaction_failed: {error}"))?;
    chapter_summary_repository::update_chapter_summary_enabled(&transaction, id, enabled, &now)?;
    let summary = chapter_summary_repository::find_chapter_summary_by_id(&transaction, id)?
        .ok_or_else(|| "chapter_summary_not_found".to_string())?;
    memory_service::sync_chapter_summary_in_transaction(&transaction, &summary, &now)
        .map_err(|error| format!("chapter_summary_memory_failed: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("chapter_summary_toggle_commit_failed: {error}"))
}

pub fn expire_chapter_context_rows(
    conn: &Connection,
    chapter_id: &str,
    updated_at: &str,
) -> Result<(), String> {
    chapter_summary_repository::expire_chapter_summaries_by_chapter(conn, chapter_id, updated_at)?;
    context_record_repository::expire_context_records_by_chapter(conn, chapter_id, updated_at)?;
    memory_service::invalidate_chapter_context_in_transaction(
        conn,
        chapter_id,
        updated_at,
        "chapter_context_expired",
    )
    .map_err(|error| format!("chapter_context_memory_failed: {error}"))?;
    Ok(())
}

pub fn mark_chapter_context_expired(conn: &mut Connection, chapter_id: &str) -> Result<(), String> {
    validate_uuid("chapter_summary_chapter_id", chapter_id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("chapter_context_expire_transaction_failed: {error}"))?;
    expire_chapter_context_rows(&transaction, chapter_id, &now)?;
    transaction
        .commit()
        .map_err(|error| format!("chapter_context_expire_commit_failed: {error}"))
}

pub fn delete_chapter_summary(conn: &Connection, id: &str) -> Result<(), String> {
    validate_uuid("chapter_summary_id", id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|error| format!("chapter_summary_delete_transaction_failed: {error}"))?;
    let summary = chapter_summary_repository::find_chapter_summary_by_id(&transaction, id)?
        .ok_or_else(|| "chapter_summary_not_found".to_string())?;
    memory_service::invalidate_source_in_transaction(
        &transaction,
        &summary.novel_id,
        "chapter_summary",
        &summary.id,
        &now,
        "source_deleted",
    )
    .map_err(|error| format!("chapter_summary_memory_failed: {error}"))?;
    chapter_summary_repository::delete_chapter_summary(&transaction, id)?;
    transaction
        .commit()
        .map_err(|error| format!("chapter_summary_delete_commit_failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::large_text_repository;
    use rusqlite::Connection;

    const SUMMARY_ID: &str = "55555555-5555-5555-5555-555555555555";

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::create_tables(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO novels (id, title, created_at, updated_at) VALUES ('11111111-1111-1111-1111-111111111111', '测试小说', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO chapters (id, novel_id, title, order_index, status, adopted_draft_id, word_count, created_at, updated_at) VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '第一章', 1, 'drafted', '33333333-3333-3333-3333-333333333333', 1000, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO chapter_drafts (id, novel_id, chapter_id, title, content, is_adopted, word_count, created_at, updated_at) VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '第一章草稿', '正文内容', 1, 1000, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn
    }

    fn memory_backed_summary_input() -> SaveChapterSummaryInput {
        SaveChapterSummaryInput {
            id: Some(SUMMARY_ID.to_string()),
            novel_id: "11111111-1111-1111-1111-111111111111".to_string(),
            chapter_id: "22222222-2222-2222-2222-222222222222".to_string(),
            volume_id: None,
            adopted_draft_id: "33333333-3333-3333-3333-333333333333".to_string(),
            summary: "主角在测试中获得了关键线索。".to_string(),
            key_events: None,
            character_changes: None,
            relationship_changes: None,
            new_foreshadows: None,
            resolved_foreshadows: None,
            next_chapter_hints: None,
            core_events: None,
            protagonist_state_change: None,
            important_character_changes: None,
            setting_changes: None,
            new_locations: None,
            new_items_or_abilities: None,
            foreshadowing: None,
            unresolved_questions: None,
            facts_must_remember: None,
            next_chapter_hook: None,
            validation_status: None,
            validation_result: None,
            enabled: Some(true),
            content_hash: Some(large_text_repository::sha256("正文内容")),
            draft_version: Some(1),
            ai_task_id: None,
        }
    }

    fn memory_backed_summary(conn: &Connection) -> ChapterSummaryDto {
        save_chapter_summary(conn, memory_backed_summary_input()).unwrap()
    }

    #[test]
    fn test_chapter_summary_crud() {
        let mut conn = setup_test_db();
        let input = SaveChapterSummaryInput {
            id: None,
            novel_id: "11111111-1111-1111-1111-111111111111".to_string(),
            chapter_id: "22222222-2222-2222-2222-222222222222".to_string(),
            volume_id: None,
            adopted_draft_id: "33333333-3333-3333-3333-333333333333".to_string(),
            summary: "主角在测试中获得了关键线索。".to_string(),
            key_events: Some("遭遇挑战，成功克服".to_string()),
            character_changes: None,
            relationship_changes: None,
            new_foreshadows: None,
            resolved_foreshadows: None,
            next_chapter_hints: None,
            core_events: None,
            protagonist_state_change: None,
            important_character_changes: None,
            setting_changes: None,
            new_locations: None,
            new_items_or_abilities: None,
            foreshadowing: None,
            unresolved_questions: None,
            facts_must_remember: None,
            next_chapter_hook: None,
            validation_status: Some("valid".to_string()),
            validation_result: None,
            enabled: Some(true),
            content_hash: None,
            draft_version: Some(1),
            ai_task_id: None,
        };

        let summary = save_chapter_summary(&conn, input).unwrap();
        assert_eq!(summary.summary, "主角在测试中获得了关键线索。");
        assert_eq!(summary.is_expired, false);

        let list =
            get_chapter_summaries_by_novel(&conn, "11111111-1111-1111-1111-111111111111").unwrap();
        assert_eq!(list.len(), 1);

        mark_chapter_context_expired(&mut conn, "22222222-2222-2222-2222-222222222222").unwrap();
        let fetched = get_chapter_summary(&conn, "22222222-2222-2222-2222-222222222222")
            .unwrap()
            .unwrap();
        assert_eq!(fetched.is_expired, true);

        delete_chapter_summary(&conn, &summary.id).unwrap();
        let after_delete =
            get_chapter_summary(&conn, "22222222-2222-2222-2222-222222222222").unwrap();
        assert!(after_delete.is_none());
    }

    #[test]
    fn summary_lifecycle_synchronizes_and_invalidates_memory() {
        let mut conn = setup_test_db();
        let summary = memory_backed_summary(&conn);

        update_chapter_summary_enabled(&conn, &summary.id, false).unwrap();
        let after_disable: (i64, i64) = conn
            .query_row(
                "SELECT enabled,
                        (SELECT COUNT(*) FROM memory_documents
                          WHERE source_type='chapter_summary' AND source_id=?1
                            AND status='active')
                   FROM chapter_summaries WHERE id=?1",
                params![SUMMARY_ID],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(after_disable, (0, 0));

        update_chapter_summary_enabled(&conn, &summary.id, true).unwrap();
        let after_enable: (i64, i64) = conn
            .query_row(
                "SELECT SUM(status='active'), SUM(status='invalidated')
                   FROM memory_documents
                  WHERE source_type='chapter_summary' AND source_id=?1",
                params![SUMMARY_ID],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(after_enable, (1, 1));

        mark_chapter_context_expired(&mut conn, "22222222-2222-2222-2222-222222222222").unwrap();
        update_chapter_summary_enabled(&conn, &summary.id, true).unwrap();
        let after_expire: (i64, i64) = conn
            .query_row(
                "SELECT is_expired,
                        (SELECT COUNT(*) FROM memory_documents
                          WHERE source_type='chapter_summary' AND source_id=?1
                            AND status='active')
                   FROM chapter_summaries WHERE id=?1",
                params![SUMMARY_ID],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(after_expire, (1, 0));

        delete_chapter_summary(&conn, &summary.id).unwrap();
        assert!(get_chapter_summary_by_id(&conn, &summary.id)
            .unwrap()
            .is_none());
        let active_after_delete: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM memory_documents
                  WHERE source_type='chapter_summary' AND source_id=?1 AND status='active'",
                params![SUMMARY_ID],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(active_after_delete, 0);
    }

    #[test]
    fn summary_toggle_rolls_back_when_memory_invalidation_fails() {
        let conn = setup_test_db();
        let summary = memory_backed_summary(&conn);
        conn.execute_batch(
            "CREATE TRIGGER fail_summary_memory_invalidation
             BEFORE UPDATE OF status ON memory_documents
             WHEN OLD.source_type='chapter_summary'
             BEGIN SELECT RAISE(ABORT, 'forced summary memory failure'); END;",
        )
        .unwrap();

        update_chapter_summary_enabled(&conn, &summary.id, false)
            .expect_err("Memory failure must roll back summary toggle");
        let state: (i64, i64) = conn
            .query_row(
                "SELECT enabled,
                        (SELECT COUNT(*) FROM memory_documents
                          WHERE source_type='chapter_summary' AND source_id=?1
                            AND status='active')
                   FROM chapter_summaries WHERE id=?1",
                params![SUMMARY_ID],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(state, (1, 1));
    }

    #[test]
    fn summary_save_rejects_forged_adopted_draft_provenance_and_rolls_back() {
        let conn = setup_test_db();
        let original = memory_backed_summary(&conn);
        let correct_hash = large_text_repository::sha256("正文内容");

        for (content_hash, draft_version) in [("0".repeat(64), 1), (correct_hash, 2)] {
            let mut input = memory_backed_summary_input();
            input.summary = "不得提交的伪来源总结。".to_string();
            input.content_hash = Some(content_hash);
            input.draft_version = Some(draft_version);
            let error = save_chapter_summary(&conn, input)
                .expect_err("forged adopted-draft provenance must fail");
            assert!(error.contains("chapter_summary_memory_failed"));

            let persisted = get_chapter_summary_by_id(&conn, &original.id)
                .unwrap()
                .unwrap();
            assert_eq!(persisted.summary, original.summary);
            let memory_state: (i64, i64) = conn
                .query_row(
                    "SELECT SUM(status='active'), COUNT(*)
                       FROM memory_documents
                      WHERE source_type='chapter_summary' AND source_id=?1",
                    params![SUMMARY_ID],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();
            assert_eq!(memory_state, (1, 1));
        }
    }
}
