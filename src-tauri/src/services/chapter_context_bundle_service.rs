use crate::domain::context::{
    CharacterStateDto, ContextRecordDto, SaveChapterContextBundleInput,
    SaveChapterContextBundleResult, SaveCharacterStateInput, SaveContextRecordInput,
};
use crate::repositories::{
    character_state_repository, context_record_repository, draft_repository,
};
use crate::services::chapter_summary_service::{
    upsert_chapter_summary, validate_summary_ownership, validate_uuid,
};
use crate::services::context_record_service::validate_context_record_input;
use crate::services::draft_service;
use crate::services::memory_service;
use rusqlite::{params, Connection, TransactionBehavior};

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

pub fn upsert_bundle_context_record(
    conn: &Connection,
    input: &SaveContextRecordInput,
    now: &str,
) -> Result<ContextRecordDto, String> {
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let importance = input.importance.unwrap_or(3);
    let is_active = input.is_active.unwrap_or(true);
    let owner = context_record_repository::find_context_record_owner(conn, &id)?;

    if let Some(owner) = owner {
        if owner.0 != input.novel_id || owner.1 != input.chapter_id {
            return Err("context_record_ownership_mismatch".to_string());
        }
        context_record_repository::update_context_record(
            conn,
            &id,
            &input.novel_id,
            input.chapter_id.as_deref(),
            input.volume_id.as_deref(),
            &input.context_type,
            &input.title,
            &input.content,
            importance,
            is_active,
            false,
            input.content_hash.as_deref(),
            input.draft_version,
            now,
        )?;
    } else {
        context_record_repository::insert_context_record(
            conn,
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
            now,
        )?;
    }

    context_record_repository::find_context_record_by_id(conn, &id)?
        .ok_or_else(|| "context_record_bundle_read_failed".to_string())
}

pub fn upsert_bundle_character_state(
    conn: &Connection,
    input: &SaveCharacterStateInput,
    now: &str,
) -> Result<CharacterStateDto, String> {
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let owner = character_state_repository::find_character_state_owner(conn, &id)?;

    if let Some(owner) = owner {
        if owner.0 != input.novel_id || owner.1 != input.character_id || owner.2 != input.chapter_id
        {
            return Err("character_state_ownership_mismatch".to_string());
        }
        character_state_repository::update_character_state(
            conn,
            &id,
            &input.novel_id,
            &input.character_id,
            &input.state_summary,
            input.relationship_changes.as_deref(),
            input.goal_changes.as_deref(),
            input.location.as_deref(),
            input.health_state.as_deref(),
            input.knowledge_state.as_deref(),
        )?;
    } else {
        character_state_repository::insert_character_state(
            conn,
            &id,
            &input.novel_id,
            &input.character_id,
            input.chapter_id.as_deref(),
            &input.state_summary,
            input.relationship_changes.as_deref(),
            input.goal_changes.as_deref(),
            input.location.as_deref(),
            input.health_state.as_deref(),
            input.knowledge_state.as_deref(),
            now,
        )?;
    }

    if input.chapter_id.is_some() {
        let has_state = character_state_repository::reproject_character_current_state(
            conn,
            &input.novel_id,
            &input.character_id,
            now,
        )
        .map_err(|error| error.to_string())?;
        if !has_state {
            return Err("character_state_latest_missing".to_string());
        }
    } else {
        character_state_repository::update_active_character_current_state(
            conn,
            &input.novel_id,
            &input.character_id,
            &input.state_summary,
            now,
        )?;
    }

    character_state_repository::find_character_state_by_id(conn, &id)?
        .ok_or_else(|| "character_state_bundle_read_failed".to_string())
}

pub fn persist_chapter_context_bundle_in_transaction(
    conn: &Connection,
    input: &SaveChapterContextBundleInput,
    now: &str,
) -> Result<SaveChapterContextBundleResult, String> {
    validate_uuid("chapter_context_novel_id", &input.novel_id)?;
    validate_uuid("chapter_context_chapter_id", &input.chapter_id)?;
    validate_uuid("chapter_context_adopted_draft_id", &input.adopted_draft_id)?;
    if input.summary.novel_id != input.novel_id
        || input.summary.chapter_id != input.chapter_id
        || input.summary.adopted_draft_id != input.adopted_draft_id
    {
        return Err("chapter_context_summary_identity_mismatch".to_string());
    }

    let mut summary_input = input.summary.clone();
    validate_summary_ownership(conn, &summary_input, true)?;
    let draft = draft_repository::find_draft(conn, &input.adopted_draft_id)
        .map_err(|error| format!("chapter_context_draft_read_failed: {error}"))?
        .ok_or_else(|| "chapter_context_adopted_draft_not_found".to_string())?;
    let verified = draft_service::load_full_content(conn, &draft)
        .map_err(|error| format!("chapter_context_draft_content_failed: {error}"))?;
    if summary_input
        .content_hash
        .as_deref()
        .is_some_and(|hash| !hash.eq_ignore_ascii_case(&verified.content_hash))
    {
        return Err("chapter_context_summary_hash_mismatch".to_string());
    }
    if summary_input
        .draft_version
        .is_some_and(|version| version != draft.version_no)
    {
        return Err("chapter_context_summary_draft_version_mismatch".to_string());
    }
    summary_input.content_hash = Some(verified.content_hash.clone());
    summary_input.draft_version = Some(draft.version_no);

    let mut context_inputs = Vec::with_capacity(input.context_records.len());
    for context in &input.context_records {
        if context.novel_id != input.novel_id
            || context.chapter_id.as_deref() != Some(input.chapter_id.as_str())
        {
            return Err("chapter_context_record_identity_mismatch".to_string());
        }
        let mut context = context.clone();
        if context
            .content_hash
            .as_deref()
            .is_some_and(|hash| !hash.eq_ignore_ascii_case(&verified.content_hash))
        {
            return Err("chapter_context_record_hash_mismatch".to_string());
        }
        if context
            .draft_version
            .is_some_and(|version| version != draft.version_no)
        {
            return Err("chapter_context_record_draft_version_mismatch".to_string());
        }
        context.content_hash = Some(verified.content_hash.clone());
        context.draft_version = Some(draft.version_no);
        validate_context_record_input(conn, &context)?;
        context_inputs.push(context);
    }
    for state in &input.character_states {
        if state.novel_id != input.novel_id
            || state.chapter_id.as_deref() != Some(input.chapter_id.as_str())
        {
            return Err("chapter_context_character_state_identity_mismatch".to_string());
        }
        validate_character_state_input(conn, state)?;
    }

    let summary = upsert_chapter_summary(conn, &summary_input, now)?;
    let mut contexts = Vec::with_capacity(context_inputs.len());
    for context in &context_inputs {
        contexts.push(upsert_bundle_context_record(conn, context, now)?);
    }
    let mut character_states = Vec::with_capacity(input.character_states.len());
    for state in &input.character_states {
        character_states.push(upsert_bundle_character_state(conn, state, now)?);
    }
    memory_service::sync_chapter_summary_in_transaction(conn, &summary, now)
        .map_err(|error| format!("chapter_context_memory_failed: {error}"))?;
    for context in &contexts {
        memory_service::put_context_record_in_transaction(
            conn,
            context,
            &input.adopted_draft_id,
            now,
        )
        .map_err(|error| format!("chapter_context_memory_failed: {error}"))?;
    }
    let affected = conn
        .execute(
            "UPDATE chapters SET status = 'summarized', updated_at = ?1
             WHERE id = ?2 AND novel_id = ?3 AND adopted_draft_id = ?4
               AND deleted_at IS NULL",
            params![
                now,
                &input.chapter_id,
                &input.novel_id,
                &input.adopted_draft_id
            ],
        )
        .map_err(|error| format!("chapter_context_status_update_failed: {error}"))?;
    if affected != 1 {
        return Err("chapter_context_status_update_conflict".to_string());
    }
    Ok(SaveChapterContextBundleResult {
        summary,
        context_records: contexts,
        character_states,
        chapter_status: "summarized".to_string(),
    })
}

pub fn save_chapter_context_bundle(
    conn: &mut Connection,
    input: &SaveChapterContextBundleInput,
) -> Result<SaveChapterContextBundleResult, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("chapter_context_transaction_failed: {error}"))?;
    let result = persist_chapter_context_bundle_in_transaction(&transaction, input, &now)?;
    transaction
        .commit()
        .map_err(|error| format!("chapter_context_commit_failed: {error}"))?;
    Ok(result)
}

pub fn save_character_state(
    conn: &mut Connection,
    input: SaveCharacterStateInput,
) -> Result<CharacterStateDto, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("character_state_transaction_failed: {error}"))?;
    validate_character_state_input(&transaction, &input)?;
    let state = upsert_bundle_character_state(&transaction, &input, &now)?;
    transaction
        .commit()
        .map_err(|error| format!("character_state_commit_failed: {error}"))?;
    Ok(state)
}

pub fn get_character_states_by_character(
    conn: &Connection,
    character_id: &str,
) -> Result<Vec<CharacterStateDto>, String> {
    validate_uuid("character_state_character_id", character_id)?;
    character_state_repository::find_character_states_by_character(conn, character_id)
}

pub fn get_character_states_by_chapter(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<CharacterStateDto>, String> {
    validate_uuid("character_state_chapter_id", chapter_id)?;
    character_state_repository::find_character_states_by_chapter(conn, chapter_id)
}

pub fn delete_character_state(conn: &mut Connection, id: &str) -> Result<(), String> {
    validate_uuid("character_state_id", id)?;
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("character_state_delete_transaction_failed: {error}"))?;
    let identity = character_state_repository::find_character_state_owner(&transaction, id)?
        .ok_or_else(|| "character_state_not_found".to_string())?;

    character_state_repository::delete_character_state(&transaction, id)?;

    character_state_repository::reproject_character_current_state(
        &transaction,
        &identity.0,
        &identity.1,
        &chrono::Utc::now().to_rfc3339(),
    )
    .map_err(|error| error.to_string())?;

    transaction
        .commit()
        .map_err(|error| format!("character_state_delete_commit_failed: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::context::SaveChapterSummaryInput;
    use crate::repositories::large_text_repository;
    use crate::services::memory_service::{MemoryRetrievalFilters, RetrieveMemoryInput};
    use rusqlite::Connection;

    const NOVEL_ID: &str = "11111111-1111-1111-1111-111111111111";
    const CHAPTER_ID: &str = "22222222-2222-2222-2222-222222222222";
    const DRAFT_ID: &str = "33333333-3333-3333-3333-333333333333";
    const CHARACTER_ID: &str = "44444444-4444-4444-4444-444444444444";
    const SUMMARY_ID: &str = "55555555-5555-5555-5555-555555555555";
    const CONTEXT_ID: &str = "66666666-6666-6666-6666-666666666666";

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
        conn.execute(
            "INSERT INTO characters (id, novel_id, name, is_active, created_at, updated_at) VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '林远', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn
    }

    fn bundle_input() -> SaveChapterContextBundleInput {
        SaveChapterContextBundleInput {
            novel_id: NOVEL_ID.to_string(),
            chapter_id: CHAPTER_ID.to_string(),
            adopted_draft_id: DRAFT_ID.to_string(),
            summary: SaveChapterSummaryInput {
                id: Some(SUMMARY_ID.to_string()),
                novel_id: NOVEL_ID.to_string(),
                chapter_id: CHAPTER_ID.to_string(),
                volume_id: None,
                adopted_draft_id: DRAFT_ID.to_string(),
                summary: "林远突破到了初级战将。".to_string(),
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
                content_hash: None,
                draft_version: None,
                ai_task_id: None,
            },
            context_records: vec![SaveContextRecordInput {
                id: Some(CONTEXT_ID.to_string()),
                novel_id: NOVEL_ID.to_string(),
                chapter_id: Some(CHAPTER_ID.to_string()),
                volume_id: None,
                context_type: "plot_progress".to_string(),
                title: "武道实力突破".to_string(),
                content: "身体基因跃迁成功".to_string(),
                importance: Some(5),
                is_active: Some(true),
                content_hash: None,
                draft_version: None,
            }],
            character_states: vec![SaveCharacterStateInput {
                id: None,
                novel_id: NOVEL_ID.to_string(),
                character_id: CHARACTER_ID.to_string(),
                chapter_id: Some(CHAPTER_ID.to_string()),
                state_summary: "初级战将，状态全满".to_string(),
                relationship_changes: None,
                goal_changes: None,
                location: Some("荒野区".to_string()),
                health_state: Some("良好".to_string()),
                knowledge_state: None,
            }],
        }
    }

    fn active_memory_chunks(conn: &Connection, source_type: &str, source_id: &str) -> Vec<String> {
        let mut statement = conn
            .prepare(
                "SELECT chunk.text
                   FROM memory_chunks chunk
                   JOIN memory_documents document ON document.id=chunk.document_id
                  WHERE document.source_type=?1 AND document.source_id=?2
                    AND document.status='active'
                  ORDER BY chunk.ordinal",
            )
            .unwrap();
        statement
            .query_map(params![source_type, source_id], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<String>, _>>()
            .unwrap()
    }

    #[test]
    fn test_save_chapter_context_bundle() {
        let mut conn = setup_test_db();
        let input = bundle_input();

        let result = save_chapter_context_bundle(&mut conn, &input).unwrap();
        assert_eq!(result.chapter_status, "summarized");
        assert_eq!(result.summary.summary, "林远突破到了初级战将。");
        assert_eq!(result.context_records.len(), 1);
        assert_eq!(result.character_states.len(), 1);
        let adopted_hash = large_text_repository::sha256("正文内容");
        assert_eq!(
            result.summary.content_hash.as_deref(),
            Some(adopted_hash.as_str())
        );
        assert_eq!(result.summary.draft_version, Some(1));
        assert_eq!(
            result.context_records[0].content_hash.as_deref(),
            Some(adopted_hash.as_str())
        );
        assert_eq!(result.context_records[0].draft_version, Some(1));

        let char_state = conn.query_row(
            "SELECT current_state FROM characters WHERE id = '44444444-4444-4444-4444-444444444444'",
            [],
            |r| r.get::<_, String>(0),
        ).unwrap();
        assert_eq!(char_state, "初级战将，状态全满");

        let (document_metadata, chunk_metadata, importance, chapter_order): (
            String,
            String,
            f64,
            i64,
        ) = conn
            .query_row(
                "SELECT document.metadata_json, chunk.metadata_json, chunk.importance,
                        chunk.chapter_order_index
                   FROM memory_documents document
                   JOIN memory_chunks chunk ON chunk.document_id = document.id
                  WHERE document.source_type = 'context_record'
                    AND document.source_id = ?1 AND document.status = 'active'",
                params![CONTEXT_ID],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        for metadata in [document_metadata, chunk_metadata] {
            let metadata: serde_json::Value = serde_json::from_str(&metadata).unwrap();
            assert_eq!(metadata["contextType"], "plot_progress");
            assert_eq!(metadata["title"], "武道实力突破");
        }
        assert!((importance - 1.0).abs() <= f64::EPSILON);
        assert_eq!(chapter_order, 0);

        let retrieved = memory_service::retrieve(
            &mut conn,
            RetrieveMemoryInput {
                trace_id: None,
                request_id: "bundle-context-retrieval".to_string(),
                novel_id: NOVEL_ID.to_string(),
                query: "身体基因跃迁".to_string(),
                query_embedding: None,
                filters: MemoryRetrievalFilters {
                    source_types: vec!["context_record".to_string()],
                    ..MemoryRetrievalFilters::default()
                },
                top_k: 10,
                offset: 0,
                candidate_limit: 20,
                token_budget: 1_000,
            },
        )
        .unwrap();
        assert_eq!(retrieved.items.len(), 1);
        assert_eq!(retrieved.items[0].source_type, "context_record");
        assert_eq!(retrieved.items[0].source_id, CONTEXT_ID);
        assert_eq!(retrieved.items[0].text, "身体基因跃迁成功");
    }

    #[test]
    fn oversized_summary_and_context_are_materialized_as_bounded_chunks() {
        let mut conn = setup_test_db();
        let mut input = bundle_input();
        input.character_states.clear();
        let large_summary = format!("{}\r\n\r\n  {}", "章".repeat(25_000), "节".repeat(25_000));
        let large_context = format!(
            "{}\r\n\r\n    {}",
            "线索".repeat(12_500),
            "伏笔".repeat(12_500)
        );
        input.summary.summary = large_summary.clone();
        input.context_records[0].content = large_context.clone();

        save_chapter_context_bundle(&mut conn, &input).unwrap();

        let summary_chunks = active_memory_chunks(&conn, "chapter_summary", SUMMARY_ID);
        let context_chunks = active_memory_chunks(&conn, "context_record", CONTEXT_ID);
        assert!(summary_chunks.len() > 1);
        assert!(context_chunks.len() > 1);
        assert!(summary_chunks.iter().all(|chunk| chunk.len() <= 128 * 1024));
        assert!(context_chunks.iter().all(|chunk| chunk.len() <= 128 * 1024));
        assert_eq!(
            summary_chunks.concat(),
            format!("章节摘要：{large_summary}")
        );
        assert_eq!(context_chunks.concat(), large_context);
    }

    #[test]
    fn context_memory_replay_is_idempotent_and_update_invalidates_old_document() {
        let mut conn = setup_test_db();
        let mut input = bundle_input();
        input.character_states.clear();

        save_chapter_context_bundle(&mut conn, &input).unwrap();
        save_chapter_context_bundle(&mut conn, &input).unwrap();
        let replay_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM memory_documents", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(replay_count, 2);

        input.context_records[0].content = "身体基因完成二次跃迁".to_string();
        input.context_records[0].importance = Some(3);
        save_chapter_context_bundle(&mut conn, &input).unwrap();

        let (active, invalidated): (i64, i64) = conn
            .query_row(
                "SELECT SUM(status='active'), SUM(status='invalidated')
                   FROM memory_documents
                  WHERE source_type='context_record' AND source_id=?1",
                params![CONTEXT_ID],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((active, invalidated), (1, 1));
        let (text, importance): (String, f64) = conn
            .query_row(
                "SELECT chunk.text, chunk.importance
                   FROM memory_chunks chunk
                   JOIN memory_documents document ON document.id=chunk.document_id
                  WHERE document.source_type='context_record'
                    AND document.source_id=?1 AND document.status='active'",
                params![CONTEXT_ID],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(text, "身体基因完成二次跃迁");
        assert!((importance - 0.6).abs() <= f64::EPSILON);
    }

    #[test]
    fn summary_edit_rebuilds_memory_and_invalidates_old_document() {
        let mut conn = setup_test_db();
        let mut input = bundle_input();
        input.context_records.clear();
        input.character_states.clear();

        save_chapter_context_bundle(&mut conn, &input).unwrap();
        input.summary.summary = "林远突破后决定深入荒野区。".to_string();
        save_chapter_context_bundle(&mut conn, &input).unwrap();

        let states: (i64, i64) = conn
            .query_row(
                "SELECT SUM(status='active'), SUM(status='invalidated')
                   FROM memory_documents
                  WHERE source_type='chapter_summary' AND source_id=?1",
                params![SUMMARY_ID],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(states, (1, 1));
        let active_text: String = conn
            .query_row(
                "SELECT chunk.text
                   FROM memory_chunks chunk
                   JOIN memory_documents document ON document.id=chunk.document_id
                  WHERE document.source_type='chapter_summary'
                    AND document.source_id=?1 AND document.status='active'",
                params![SUMMARY_ID],
                |row| row.get(0),
            )
            .unwrap();
        assert!(active_text.contains("林远突破后决定深入荒野区。"));
    }

    #[test]
    fn disabled_summary_saves_bundle_and_invalidates_summary_memory() {
        let mut conn = setup_test_db();
        let mut input = bundle_input();
        input.context_records.clear();
        input.character_states.clear();
        save_chapter_context_bundle(&mut conn, &input).unwrap();

        input.summary.enabled = Some(false);
        let result = save_chapter_context_bundle(&mut conn, &input).unwrap();
        assert!(!result.summary.enabled);
        let states: (i64, i64) = conn
            .query_row(
                "SELECT SUM(status='active'), SUM(status='invalidated')
                   FROM memory_documents
                  WHERE source_type='chapter_summary' AND source_id=?1",
                params![SUMMARY_ID],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(states, (0, 1));
    }

    #[test]
    fn inactive_and_chapter_summary_context_records_do_not_create_duplicate_memory() {
        let mut conn = setup_test_db();
        let mut input = bundle_input();
        input.character_states.clear();
        input.context_records.push(SaveContextRecordInput {
            id: Some("77777777-7777-7777-7777-777777777777".to_string()),
            novel_id: NOVEL_ID.to_string(),
            chapter_id: Some(CHAPTER_ID.to_string()),
            volume_id: None,
            context_type: "chapter_summary".to_string(),
            title: "章节总结副本".to_string(),
            content: "不应重复进入 Memory".to_string(),
            importance: Some(5),
            is_active: Some(true),
            content_hash: None,
            draft_version: None,
        });
        input.context_records.push(SaveContextRecordInput {
            id: Some("88888888-8888-8888-8888-888888888888".to_string()),
            novel_id: NOVEL_ID.to_string(),
            chapter_id: Some(CHAPTER_ID.to_string()),
            volume_id: None,
            context_type: "foreshadow".to_string(),
            title: "停用伏笔".to_string(),
            content: "停用记录不应进入 Memory".to_string(),
            importance: Some(4),
            is_active: Some(false),
            content_hash: None,
            draft_version: None,
        });

        save_chapter_context_bundle(&mut conn, &input).unwrap();
        let sources: (i64, i64) = conn
            .query_row(
                "SELECT SUM(source_type='chapter_summary'),
                        SUM(source_type='context_record')
                   FROM memory_documents WHERE status='active'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(sources, (1, 1));

        input.context_records[0].is_active = Some(false);
        save_chapter_context_bundle(&mut conn, &input).unwrap();
        let active_context_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM memory_documents
                  WHERE source_type='context_record' AND status='active'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(active_context_count, 0);

        input.context_records[0].is_active = Some(true);
        save_chapter_context_bundle(&mut conn, &input).unwrap();
        let reenabled: (i64, i64) = conn
            .query_row(
                "SELECT SUM(status='active'), SUM(status='invalidated')
                   FROM memory_documents
                  WHERE source_type='context_record' AND source_id=?1",
                params![CONTEXT_ID],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(reenabled, (1, 1));
    }

    #[test]
    fn context_memory_uses_formal_volume_and_chapter_sequence() {
        let mut conn = setup_test_db();
        conn.execute_batch(
            "INSERT INTO volumes
                (id,novel_id,title,order_index,status,created_at,updated_at)
             VALUES
                ('77777777-7777-7777-7777-777777777777',
                 '11111111-1111-1111-1111-111111111111','前卷',10,'planned','now','now'),
                ('88888888-8888-8888-8888-888888888888',
                 '11111111-1111-1111-1111-111111111111','后卷',20,'planned','now','now');
             INSERT INTO chapters
                (id,novel_id,volume_id,title,order_index,status,word_count,created_at,updated_at)
             VALUES
                ('99999999-9999-9999-9999-999999999999',
                 '11111111-1111-1111-1111-111111111111',
                 '77777777-7777-7777-7777-777777777777','前卷末章',99,'not_started',0,'now','now');
             UPDATE chapters
                SET volume_id='88888888-8888-8888-8888-888888888888', order_index=1
              WHERE id='22222222-2222-2222-2222-222222222222';",
        )
        .unwrap();
        let mut input = bundle_input();
        input.character_states.clear();
        save_chapter_context_bundle(&mut conn, &input).unwrap();

        let sequence: (i64, i64) = conn
            .query_row(
                "SELECT chunk.chapter_order_index, chunk.temporal_start_chapter
                   FROM memory_chunks chunk
                   JOIN memory_documents document ON document.id=chunk.document_id
                  WHERE document.source_type='context_record' AND document.status='active'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(sequence, (1, 1));
    }

    #[test]
    fn context_memory_failure_rolls_back_complete_bundle() {
        let mut conn = setup_test_db();
        conn.execute_batch(
            "CREATE TRIGGER fail_context_memory_chunk
             BEFORE INSERT ON memory_chunks
             WHEN NEW.text='身体基因跃迁成功'
             BEGIN SELECT RAISE(ABORT, 'forced context memory failure'); END;",
        )
        .unwrap();
        let mut input = bundle_input();
        input.character_states.clear();

        let error = save_chapter_context_bundle(&mut conn, &input)
            .expect_err("context Memory failure must roll back bundle");
        assert!(error.contains("chapter_context_memory_failed"));
        for table in [
            "chapter_summaries",
            "context_records",
            "memory_documents",
            "memory_chunks",
        ] {
            let count: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table} must roll back");
        }
        let chapter_status: String = conn
            .query_row(
                "SELECT status FROM chapters WHERE id=?1",
                params![CHAPTER_ID],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(chapter_status, "drafted");
    }

    #[test]
    fn test_character_state_lifecycle() {
        let mut conn = setup_test_db();
        let state = save_character_state(
            &mut conn,
            SaveCharacterStateInput {
                id: None,
                novel_id: "11111111-1111-1111-1111-111111111111".to_string(),
                character_id: "44444444-4444-4444-4444-444444444444".to_string(),
                chapter_id: Some("22222222-2222-2222-2222-222222222222".to_string()),
                state_summary: "受伤初愈".to_string(),
                relationship_changes: None,
                goal_changes: None,
                location: None,
                health_state: Some("虚弱".to_string()),
                knowledge_state: None,
            },
        )
        .unwrap();

        assert_eq!(state.state_summary, "受伤初愈");
        let states =
            get_character_states_by_character(&conn, "44444444-4444-4444-4444-444444444444")
                .unwrap();
        assert_eq!(states.len(), 1);

        delete_character_state(&mut conn, &state.id).unwrap();
        let states_after =
            get_character_states_by_character(&conn, "44444444-4444-4444-4444-444444444444")
                .unwrap();
        assert_eq!(states_after.len(), 0);
    }
}
