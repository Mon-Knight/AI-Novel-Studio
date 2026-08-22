use crate::domain::context::{
    CharacterStateDto, ContextRecordDto, SaveChapterContextBundleInput,
    SaveChapterContextBundleResult, SaveCharacterStateInput, SaveContextRecordInput,
};
use crate::repositories::{character_state_repository, context_record_repository};
use crate::services::chapter_summary_service::{
    upsert_chapter_summary, validate_summary_ownership, validate_uuid,
};
use crate::services::context_record_service::validate_context_record_input;
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

    character_state_repository::update_active_character_current_state(
        conn,
        &input.novel_id,
        &input.character_id,
        &input.state_summary,
        now,
    )?;

    character_state_repository::find_character_state_by_id(conn, &id)?
        .ok_or_else(|| "character_state_bundle_read_failed".to_string())
}

pub fn save_chapter_context_bundle(
    conn: &mut Connection,
    input: &SaveChapterContextBundleInput,
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

    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("chapter_context_transaction_failed: {error}"))?;
    validate_summary_ownership(&transaction, &input.summary, true)?;
    for context in &input.context_records {
        if context.novel_id != input.novel_id
            || context.chapter_id.as_deref() != Some(input.chapter_id.as_str())
        {
            return Err("chapter_context_record_identity_mismatch".to_string());
        }
        validate_context_record_input(&transaction, context)?;
    }
    for state in &input.character_states {
        if state.novel_id != input.novel_id
            || state.chapter_id.as_deref() != Some(input.chapter_id.as_str())
        {
            return Err("chapter_context_character_state_identity_mismatch".to_string());
        }
        validate_character_state_input(&transaction, state)?;
    }

    let summary = upsert_chapter_summary(&transaction, &input.summary, &now)?;
    let mut contexts = Vec::with_capacity(input.context_records.len());
    for context in &input.context_records {
        contexts.push(upsert_bundle_context_record(&transaction, context, &now)?);
    }
    let mut character_states = Vec::with_capacity(input.character_states.len());
    for state in &input.character_states {
        character_states.push(upsert_bundle_character_state(&transaction, state, &now)?);
    }
    let affected = transaction
        .execute(
            "UPDATE chapters SET status = 'summarized', updated_at = ?1
             WHERE id = ?2 AND novel_id = ?3 AND adopted_draft_id = ?4
               AND deleted_at IS NULL",
            params![
                &now,
                &input.chapter_id,
                &input.novel_id,
                &input.adopted_draft_id
            ],
        )
        .map_err(|error| format!("chapter_context_status_update_failed: {error}"))?;
    if affected != 1 {
        return Err("chapter_context_status_update_conflict".to_string());
    }
    transaction
        .commit()
        .map_err(|error| format!("chapter_context_commit_failed: {error}"))?;
    Ok(SaveChapterContextBundleResult {
        summary,
        context_records: contexts,
        character_states,
        chapter_status: "summarized".to_string(),
    })
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

    let latest_state = character_state_repository::find_latest_character_state_summary(
        &transaction,
        &identity.0,
        &identity.1,
    )?;

    character_state_repository::update_character_current_state(
        &transaction,
        &identity.0,
        &identity.1,
        latest_state.as_deref(),
        &chrono::Utc::now().to_rfc3339(),
    )?;

    transaction
        .commit()
        .map_err(|error| format!("character_state_delete_commit_failed: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::context::SaveChapterSummaryInput;
    use rusqlite::Connection;

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

    #[test]
    fn test_save_chapter_context_bundle() {
        let mut conn = setup_test_db();
        let input = SaveChapterContextBundleInput {
            novel_id: "11111111-1111-1111-1111-111111111111".to_string(),
            chapter_id: "22222222-2222-2222-2222-222222222222".to_string(),
            adopted_draft_id: "33333333-3333-3333-3333-333333333333".to_string(),
            summary: SaveChapterSummaryInput {
                id: None,
                novel_id: "11111111-1111-1111-1111-111111111111".to_string(),
                chapter_id: "22222222-2222-2222-2222-222222222222".to_string(),
                volume_id: None,
                adopted_draft_id: "33333333-3333-3333-3333-333333333333".to_string(),
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
                draft_version: Some(1),
                ai_task_id: None,
            },
            context_records: vec![SaveContextRecordInput {
                id: None,
                novel_id: "11111111-1111-1111-1111-111111111111".to_string(),
                chapter_id: Some("22222222-2222-2222-2222-222222222222".to_string()),
                volume_id: None,
                context_type: "plot_progress".to_string(),
                title: "武道实力突破".to_string(),
                content: "身体基因跃迁成功".to_string(),
                importance: Some(5),
                is_active: Some(true),
                content_hash: None,
                draft_version: Some(1),
            }],
            character_states: vec![SaveCharacterStateInput {
                id: None,
                novel_id: "11111111-1111-1111-1111-111111111111".to_string(),
                character_id: "44444444-4444-4444-4444-444444444444".to_string(),
                chapter_id: Some("22222222-2222-2222-2222-222222222222".to_string()),
                state_summary: "初级战将，状态全满".to_string(),
                relationship_changes: None,
                goal_changes: None,
                location: Some("荒野区".to_string()),
                health_state: Some("良好".to_string()),
                knowledge_state: None,
            }],
        };

        let result = save_chapter_context_bundle(&mut conn, &input).unwrap();
        assert_eq!(result.chapter_status, "summarized");
        assert_eq!(result.summary.summary, "林远突破到了初级战将。");
        assert_eq!(result.context_records.len(), 1);
        assert_eq!(result.character_states.len(), 1);

        let char_state = conn.query_row(
            "SELECT current_state FROM characters WHERE id = '44444444-4444-4444-4444-444444444444'",
            [],
            |r| r.get::<_, String>(0),
        ).unwrap();
        assert_eq!(char_state, "初级战将，状态全满");
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
