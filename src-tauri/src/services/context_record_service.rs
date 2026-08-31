use crate::domain::context::{ContextRecordDto, SaveContextRecordInput, UpdateContextRecordInput};
use crate::repositories::context_record_repository;
use crate::services::memory_service;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};

pub fn validate_uuid(field: &str, value: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| format!("{field}_invalid_uuid"))
}

pub fn validate_context_type(context_type: &str) -> Result<(), String> {
    const TYPES: [&str; 8] = [
        "chapter_summary",
        "volume_summary",
        "character_state",
        "foreshadow",
        "rule",
        "relationship",
        "plot_progress",
        "other",
    ];
    if TYPES.contains(&context_type) {
        Ok(())
    } else {
        Err("context_record_type_invalid".to_string())
    }
}

pub fn validate_context_record_input(
    conn: &Connection,
    input: &SaveContextRecordInput,
) -> Result<(), String> {
    if let Some(id) = input.id.as_deref() {
        validate_uuid("context_record_id", id)?;
    }
    validate_uuid("context_record_novel_id", &input.novel_id)?;
    if let Some(chapter_id) = input.chapter_id.as_deref() {
        validate_uuid("context_record_chapter_id", chapter_id)?;
    }
    if let Some(volume_id) = input.volume_id.as_deref() {
        validate_uuid("context_record_volume_id", volume_id)?;
    }
    validate_context_type(&input.context_type)?;
    if input.title.trim().is_empty() {
        return Err("context_record_title_required".to_string());
    }
    let importance = input.importance.unwrap_or(3);
    if !(1..=5).contains(&importance) {
        return Err("context_record_importance_out_of_range".to_string());
    }
    if input.draft_version.is_some_and(|version| version < 0) {
        return Err("context_record_draft_version_invalid".to_string());
    }

    let novel_exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM novels WHERE id = ?1 AND deleted_at IS NULL)",
            params![&input.novel_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("context_record_novel_read_failed: {error}"))?;
    if !novel_exists {
        return Err("context_record_novel_not_found".to_string());
    }

    let mut chapter_volume_id = None;
    if let Some(chapter_id) = input.chapter_id.as_deref() {
        chapter_volume_id = conn
            .query_row(
                "SELECT volume_id FROM chapters
                 WHERE id = ?1 AND novel_id = ?2 AND deleted_at IS NULL",
                params![chapter_id, &input.novel_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(|error| format!("context_record_chapter_read_failed: {error}"))?
            .ok_or_else(|| "context_record_chapter_ownership_mismatch".to_string())?;
    }
    if let Some(volume_id) = input.volume_id.as_deref() {
        let volume_exists = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM volumes
                 WHERE id = ?1 AND novel_id = ?2 AND deleted_at IS NULL)",
                params![volume_id, &input.novel_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| format!("context_record_volume_read_failed: {error}"))?;
        if !volume_exists {
            return Err("context_record_volume_ownership_mismatch".to_string());
        }
        if input.chapter_id.is_some() && chapter_volume_id.as_deref() != Some(volume_id) {
            return Err("context_record_chapter_volume_mismatch".to_string());
        }
    }
    Ok(())
}

pub fn save_context_records(
    conn: &mut Connection,
    inputs: &[SaveContextRecordInput],
) -> Result<Vec<ContextRecordDto>, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("context_record_transaction_failed: {error}"))?;
    let mut ids = Vec::with_capacity(inputs.len());

    for input in inputs {
        validate_context_record_input(&transaction, input)?;
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let importance = input.importance.unwrap_or(3);
        let is_active = input.is_active.unwrap_or(true);

        context_record_repository::insert_context_record(
            &transaction,
            &id,
            &input.novel_id,
            input.chapter_id.as_deref(),
            input.volume_id.as_deref(),
            &input.context_type,
            &input.title,
            &input.content,
            importance,
            is_active,
            input.content_hash.as_deref(),
            input.draft_version,
            &now,
        )?;
        ids.push(id);
    }

    let mut results = Vec::with_capacity(ids.len());
    for id in &ids {
        results.push(
            context_record_repository::find_context_record_by_id(&transaction, id)?
                .ok_or_else(|| "context_record_read_after_insert_failed".to_string())?,
        );
    }
    transaction
        .commit()
        .map_err(|error| format!("context_record_commit_failed: {error}"))?;
    Ok(results)
}

pub fn get_context_records(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<ContextRecordDto>, String> {
    context_record_repository::find_context_records_by_novel(conn, novel_id)
}

pub fn get_context_record(conn: &Connection, id: &str) -> Result<Option<ContextRecordDto>, String> {
    validate_uuid("context_record_id", id)?;
    context_record_repository::find_context_record_by_id(conn, id)
}

fn sync_context_record_memory(
    conn: &Connection,
    record: &ContextRecordDto,
    now: &str,
) -> Result<(), String> {
    let memory_eligible = record.is_active
        && !record.is_expired
        && record.context_type != "chapter_summary"
        && record.content_hash.is_some()
        && record.draft_version.is_some_and(|version| version >= 1);
    if !memory_eligible {
        memory_service::invalidate_source_in_transaction(
            conn,
            &record.novel_id,
            "context_record",
            &record.id,
            now,
            "source_not_memory_eligible",
        )
        .map_err(|error| format!("context_record_memory_failed: {error}"))?;
        return Ok(());
    }

    let adopted_draft_id = record
        .chapter_id
        .as_deref()
        .map(|chapter_id| {
            conn.query_row(
                "SELECT adopted_draft_id FROM chapters
                 WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL",
                params![chapter_id, &record.novel_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map(|value| value.flatten())
            .map_err(|error| format!("context_record_chapter_read_failed: {error}"))
        })
        .transpose()?
        .flatten();
    let Some(adopted_draft_id) = adopted_draft_id else {
        memory_service::invalidate_source_in_transaction(
            conn,
            &record.novel_id,
            "context_record",
            &record.id,
            now,
            "source_not_memory_eligible",
        )
        .map_err(|error| format!("context_record_memory_failed: {error}"))?;
        return Ok(());
    };
    memory_service::put_context_record_in_transaction(conn, record, &adopted_draft_id, now)
        .map_err(|error| format!("context_record_memory_failed: {error}"))?;
    Ok(())
}

pub fn update_context_record(
    conn: &Connection,
    id: &str,
    input: &UpdateContextRecordInput,
) -> Result<ContextRecordDto, String> {
    validate_uuid("context_record_id", id)?;
    let transaction = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|error| format!("context_record_update_transaction_failed: {error}"))?;
    let validation_input = SaveContextRecordInput {
        id: Some(id.to_string()),
        novel_id: input.novel_id.clone(),
        chapter_id: input.chapter_id.clone(),
        volume_id: input.volume_id.clone(),
        context_type: input.context_type.clone(),
        title: input.title.clone(),
        content: input.content.clone(),
        importance: Some(input.importance),
        is_active: Some(input.is_active),
        content_hash: input.content_hash.clone(),
        draft_version: input.draft_version,
    };
    validate_context_record_input(&transaction, &validation_input)?;
    let owner = context_record_repository::find_context_record_owner(&transaction, id)?
        .ok_or_else(|| "context_record_not_found".to_string())?;
    if owner.0 != input.novel_id {
        return Err("context_record_ownership_mismatch".to_string());
    }
    let now = chrono::Utc::now().to_rfc3339();
    context_record_repository::update_context_record(
        &transaction,
        id,
        &input.novel_id,
        input.chapter_id.as_deref(),
        input.volume_id.as_deref(),
        &input.context_type,
        &input.title,
        &input.content,
        input.importance,
        input.is_active,
        input.is_expired,
        input.content_hash.as_deref(),
        input.draft_version,
        &now,
    )?;

    let record = context_record_repository::find_context_record_by_id(&transaction, id)?
        .ok_or_else(|| "context_record_read_after_update_failed".to_string())?;
    sync_context_record_memory(&transaction, &record, &now)?;
    transaction
        .commit()
        .map_err(|error| format!("context_record_update_commit_failed: {error}"))?;
    Ok(record)
}

pub fn update_context_record_active(
    conn: &Connection,
    id: &str,
    is_active: bool,
) -> Result<(), String> {
    validate_uuid("context_record_id", id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|error| format!("context_record_toggle_transaction_failed: {error}"))?;
    context_record_repository::update_context_record_active(&transaction, id, is_active, &now)?;
    let record = context_record_repository::find_context_record_by_id(&transaction, id)?
        .ok_or_else(|| "context_record_not_found".to_string())?;
    sync_context_record_memory(&transaction, &record, &now)?;
    transaction
        .commit()
        .map_err(|error| format!("context_record_toggle_commit_failed: {error}"))
}

pub fn delete_context_record(conn: &Connection, id: &str) -> Result<(), String> {
    validate_uuid("context_record_id", id)?;
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|error| format!("context_record_delete_transaction_failed: {error}"))?;
    let record = context_record_repository::find_context_record_by_id(&transaction, id)?
        .ok_or_else(|| "context_record_not_found".to_string())?;
    memory_service::invalidate_source_in_transaction(
        &transaction,
        &record.novel_id,
        "context_record",
        &record.id,
        &now,
        "source_deleted",
    )
    .map_err(|error| format!("context_record_memory_failed: {error}"))?;
    context_record_repository::delete_context_record(&transaction, id)?;
    transaction
        .commit()
        .map_err(|error| format!("context_record_delete_commit_failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::large_text_repository;
    use rusqlite::Connection;

    const CONTEXT_ID: &str = "55555555-5555-5555-5555-555555555555";

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

    fn memory_backed_context(conn: &mut Connection) -> ContextRecordDto {
        let saved = save_context_records(
            conn,
            &[SaveContextRecordInput {
                id: Some(CONTEXT_ID.to_string()),
                novel_id: "11111111-1111-1111-1111-111111111111".to_string(),
                chapter_id: Some("22222222-2222-2222-2222-222222222222".to_string()),
                volume_id: None,
                context_type: "foreshadow".to_string(),
                title: "古玉异动".to_string(),
                content: "古玉发出微弱青光。".to_string(),
                importance: Some(4),
                is_active: Some(true),
                content_hash: Some(large_text_repository::sha256("正文内容")),
                draft_version: Some(1),
            }],
        )
        .unwrap()
        .remove(0);
        update_context_record_active(conn, &saved.id, true).unwrap();
        get_context_record(conn, &saved.id).unwrap().unwrap()
    }

    #[test]
    fn test_context_record_crud() {
        let mut conn = setup_test_db();
        let inputs = vec![SaveContextRecordInput {
            id: None,
            novel_id: "11111111-1111-1111-1111-111111111111".to_string(),
            chapter_id: Some("22222222-2222-2222-2222-222222222222".to_string()),
            volume_id: None,
            context_type: "foreshadow".to_string(),
            title: "神秘古玉的异动".to_string(),
            content: "在触碰古玉时发出微弱青光。".to_string(),
            importance: Some(4),
            is_active: Some(true),
            content_hash: None,
            draft_version: Some(1),
        }];

        let saved = save_context_records(&mut conn, &inputs).unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].title, "神秘古玉的异动");
        assert_eq!(saved[0].importance, 4);

        let list = get_context_records(&conn, "11111111-1111-1111-1111-111111111111").unwrap();
        assert_eq!(list.len(), 1);

        let updated = update_context_record(
            &conn,
            &saved[0].id,
            &UpdateContextRecordInput {
                novel_id: "11111111-1111-1111-1111-111111111111".to_string(),
                chapter_id: Some("22222222-2222-2222-2222-222222222222".to_string()),
                volume_id: None,
                context_type: "foreshadow".to_string(),
                title: "神秘古玉的异动（更新）".to_string(),
                content: "在触碰古玉时发出强烈的青光。".to_string(),
                importance: 5,
                is_active: true,
                is_expired: false,
                content_hash: None,
                draft_version: Some(1),
            },
        )
        .unwrap();
        assert_eq!(updated.importance, 5);
        assert_eq!(updated.title, "神秘古玉的异动（更新）");

        delete_context_record(&conn, &saved[0].id).unwrap();
        let after = get_context_record(&conn, &saved[0].id).unwrap();
        assert!(after.is_none());
    }

    #[test]
    fn context_record_lifecycle_synchronizes_and_invalidates_memory() {
        let mut conn = setup_test_db();
        let record = memory_backed_context(&mut conn);

        let updated = update_context_record(
            &conn,
            &record.id,
            &UpdateContextRecordInput {
                novel_id: record.novel_id.clone(),
                chapter_id: record.chapter_id.clone(),
                volume_id: record.volume_id.clone(),
                context_type: record.context_type.clone(),
                title: "古玉异动加剧".to_string(),
                content: "古玉发出强烈青光。".to_string(),
                importance: 5,
                is_active: true,
                is_expired: false,
                content_hash: record.content_hash.clone(),
                draft_version: record.draft_version,
            },
        )
        .unwrap();
        let after_update: (i64, i64) = conn
            .query_row(
                "SELECT SUM(status='active'), SUM(status='invalidated')
                   FROM memory_documents
                  WHERE source_type='context_record' AND source_id=?1",
                params![CONTEXT_ID],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(after_update, (1, 1));

        update_context_record_active(&conn, &updated.id, false).unwrap();
        let active_after_disable: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM memory_documents
                  WHERE source_type='context_record' AND source_id=?1 AND status='active'",
                params![CONTEXT_ID],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(active_after_disable, 0);

        update_context_record_active(&conn, &updated.id, true).unwrap();
        let active_after_enable: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM memory_documents
                  WHERE source_type='context_record' AND source_id=?1 AND status='active'",
                params![CONTEXT_ID],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(active_after_enable, 1);

        delete_context_record(&conn, &updated.id).unwrap();
        assert!(get_context_record(&conn, &updated.id).unwrap().is_none());
        let active_after_delete: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM memory_documents
                  WHERE source_type='context_record' AND source_id=?1 AND status='active'",
                params![CONTEXT_ID],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(active_after_delete, 0);
    }

    #[test]
    fn context_toggle_rolls_back_when_memory_invalidation_fails() {
        let mut conn = setup_test_db();
        let record = memory_backed_context(&mut conn);
        conn.execute_batch(
            "CREATE TRIGGER fail_context_memory_invalidation
             BEFORE UPDATE OF status ON memory_documents
             WHEN OLD.source_type='context_record'
             BEGIN SELECT RAISE(ABORT, 'forced context memory failure'); END;",
        )
        .unwrap();

        update_context_record_active(&conn, &record.id, false)
            .expect_err("Memory failure must roll back context toggle");
        let state: (i64, i64) = conn
            .query_row(
                "SELECT is_active,
                        (SELECT COUNT(*) FROM memory_documents
                          WHERE source_type='context_record' AND source_id=?1
                            AND status='active')
                   FROM context_records WHERE id=?1",
                params![CONTEXT_ID],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(state, (1, 1));
    }

    #[test]
    fn context_update_rejects_forged_adopted_draft_provenance_and_rolls_back() {
        let mut conn = setup_test_db();
        let original = memory_backed_context(&mut conn);
        let correct_hash = large_text_repository::sha256("正文内容");

        for (content_hash, draft_version) in [("0".repeat(64), 1), (correct_hash, 2)] {
            let error = update_context_record(
                &conn,
                &original.id,
                &UpdateContextRecordInput {
                    novel_id: original.novel_id.clone(),
                    chapter_id: original.chapter_id.clone(),
                    volume_id: original.volume_id.clone(),
                    context_type: original.context_type.clone(),
                    title: "不得提交的伪来源记录".to_string(),
                    content: "此更新必须整体回滚。".to_string(),
                    importance: original.importance,
                    is_active: true,
                    is_expired: false,
                    content_hash: Some(content_hash),
                    draft_version: Some(draft_version),
                },
            )
            .expect_err("forged adopted-draft provenance must fail");
            assert!(error.contains("context_record_memory_failed"));

            let persisted = get_context_record(&conn, &original.id).unwrap().unwrap();
            assert_eq!(persisted.title, original.title);
            assert_eq!(persisted.content, original.content);
            let memory_state: (i64, i64) = conn
                .query_row(
                    "SELECT SUM(status='active'), COUNT(*)
                       FROM memory_documents
                      WHERE source_type='context_record' AND source_id=?1",
                    params![CONTEXT_ID],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();
            assert_eq!(memory_state, (1, 1));
        }
    }
}
