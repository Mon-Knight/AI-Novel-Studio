use crate::domain::context::{ContextRecordDto, SaveContextRecordInput, UpdateContextRecordInput};
use crate::repositories::context_record_repository;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

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

pub fn update_context_record(
    conn: &Connection,
    id: &str,
    input: &UpdateContextRecordInput,
) -> Result<ContextRecordDto, String> {
    validate_uuid("context_record_id", id)?;
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
    validate_context_record_input(conn, &validation_input)?;
    let owner = context_record_repository::find_context_record_owner(conn, id)?
        .ok_or_else(|| "context_record_not_found".to_string())?;
    if owner.0 != input.novel_id {
        return Err("context_record_ownership_mismatch".to_string());
    }
    let now = chrono::Utc::now().to_rfc3339();
    context_record_repository::update_context_record(
        conn,
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

    context_record_repository::find_context_record_by_id(conn, id)?
        .ok_or_else(|| "context_record_read_after_update_failed".to_string())
}

pub fn update_context_record_active(
    conn: &Connection,
    id: &str,
    is_active: bool,
) -> Result<(), String> {
    validate_uuid("context_record_id", id)?;
    let now = chrono::Utc::now().to_rfc3339();
    context_record_repository::update_context_record_active(conn, id, is_active, &now)
}

pub fn delete_context_record(conn: &Connection, id: &str) -> Result<(), String> {
    validate_uuid("context_record_id", id)?;
    context_record_repository::delete_context_record(conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::create_tables(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO novels (id, title, created_at, updated_at) VALUES ('11111111-1111-1111-1111-111111111111', '测试小说', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO chapters (id, novel_id, title, order_index, status, word_count, created_at, updated_at) VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '第一章', 1, 'drafted', 1000, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn
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
}
