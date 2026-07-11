use crate::errors::{codes, AppError};
use crate::repositories::{draft_repository, large_text_repository, recovery_repository};
use chrono::Utc;
use rusqlite::{Connection, TransactionBehavior};
use serde::Deserialize;

use super::draft_service;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertRecoveryInput {
    #[serde(default)]
    pub trace_id: Option<String>,
    pub novel_id: String,
    pub chapter_id: String,
    #[serde(default)]
    pub base_draft_id: Option<String>,
    #[serde(default)]
    pub base_draft_version: Option<i64>,
    #[serde(default)]
    pub base_content_hash: Option<String>,
    pub recovery_content: String,
    pub recovery_content_hash: String,
    #[serde(default)]
    pub selection_start: Option<i64>,
    #[serde(default)]
    pub selection_end: Option<i64>,
}

pub fn upsert(
    connection: &mut Connection,
    input: UpsertRecoveryInput,
) -> Result<recovery_repository::RecoverySnapshot, AppError> {
    let actual_hash = large_text_repository::sha256(&input.recovery_content);
    if !actual_hash.eq_ignore_ascii_case(&input.recovery_content_hash) {
        return Err(
            AppError::new(codes::RECOVERY_CONTENT_INVALID, "恢复快照哈希不一致", false)
                .with_context(input.trace_id.as_deref(), None)
                .with_details(serde_json::json!({
                    "expectedHash": input.recovery_content_hash,
                    "actualHash": actual_hash,
                })),
        );
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    draft_repository::validate_target(&transaction, &input.novel_id, &input.chapter_id)?;
    if let Some(base_draft_id) = input.base_draft_id.as_deref() {
        let base = draft_repository::find_draft(&transaction, base_draft_id)?.ok_or_else(|| {
            AppError::new(
                codes::RECOVERY_BASE_CONFLICT,
                "恢复快照的基础草稿不存在",
                false,
            )
        })?;
        if base.novel_id != input.novel_id || base.chapter_id != input.chapter_id {
            return Err(AppError::new(
                codes::RECOVERY_BASE_CONFLICT,
                "恢复快照的基础草稿不属于当前章节",
                false,
            ));
        }
        if input.base_draft_version.is_some_and(|version| version != base.version_no) {
            return Err(AppError::new(
                codes::RECOVERY_BASE_CONFLICT,
                "恢复快照的基础草稿版本已变化",
                false,
            ));
        }
        if let Some(expected_hash) = input.base_content_hash.as_deref() {
            let persisted = draft_service::load_full_content(&transaction, &base)?;
            if !persisted.content_hash.eq_ignore_ascii_case(expected_hash) {
                return Err(AppError::new(
                    codes::RECOVERY_BASE_CONFLICT,
                    "恢复快照的基础正文已变化",
                    false,
                ));
            }
        }
    } else if input.base_draft_version.is_some() || input.base_content_hash.is_some() {
        return Err(AppError::new(
            codes::RECOVERY_BASE_CONFLICT,
            "恢复快照缺少基础草稿身份",
            false,
        ));
    }
    let existing = recovery_repository::get(&transaction, &input.novel_id, &input.chapter_id)?;
    let now = Utc::now().to_rfc3339();
    let created_at = existing
        .as_ref()
        .map(|snapshot| snapshot.created_at.clone())
        .unwrap_or_else(|| now.clone());
    let use_large_text = input.recovery_content.len()
        > large_text_repository::LARGE_TEXT_THRESHOLD_BYTES;
    let document_id = use_large_text.then(|| uuid::Uuid::new_v4().to_string());
    let recovery_target_id = format!("{}:{}", input.novel_id, input.chapter_id);
    if let Some(document_id) = document_id.as_deref() {
        large_text_repository::insert_document_for_target(
            &transaction,
            document_id,
            "recovery",
            &recovery_target_id,
            "recovery_content",
            None,
            &input.recovery_content,
            &actual_hash,
            &now,
        )?;
    }
    let stored_content = if use_large_text {
        input.recovery_content.chars().take(500).collect()
    } else {
        input.recovery_content.clone()
    };
    let stored_snapshot = recovery_repository::RecoverySnapshot {
        novel_id: input.novel_id,
        chapter_id: input.chapter_id,
        base_draft_id: input.base_draft_id,
        base_draft_version: input.base_draft_version,
        base_content_hash: input.base_content_hash,
        recovery_content: stored_content,
        recovery_content_hash: actual_hash.clone(),
        large_text_ref_id: document_id.clone(),
        selection_start: input.selection_start,
        selection_end: input.selection_end,
        created_at,
        updated_at: now,
    };
    recovery_repository::upsert(&transaction, &stored_snapshot)?;
    if let Some(old_document_id) = existing.and_then(|snapshot| snapshot.large_text_ref_id) {
        if Some(old_document_id.as_str()) != document_id.as_deref() {
            large_text_repository::delete_if_unreferenced(&transaction, &old_document_id)?;
        }
    }
    transaction.commit().map_err(|error| {
        AppError::new(
            codes::DATABASE_COMMIT_UNKNOWN,
            "恢复快照提交状态未知",
            true,
        )
        .with_details(serde_json::json!({ "sqliteError": error.to_string() }))
    })?;
    let mut output = stored_snapshot;
    output.recovery_content = input.recovery_content;
    Ok(output)
}

pub fn get(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
) -> Result<Option<recovery_repository::RecoverySnapshot>, AppError> {
    let Some(mut snapshot) = recovery_repository::get(connection, novel_id, chapter_id)? else {
        return Ok(None);
    };
    if let Some(document_id) = snapshot.large_text_ref_id.as_deref() {
        let recovery_target_id = format!("{novel_id}:{chapter_id}");
        large_text_repository::validate_document_target(
            connection,
            document_id,
            "recovery",
            &recovery_target_id,
            "recovery_content",
        )?;
        let verified = large_text_repository::read_verified_document(connection, document_id)?;
        if !verified
            .content_hash
            .eq_ignore_ascii_case(&snapshot.recovery_content_hash)
        {
            return Err(AppError::new(
                codes::RECOVERY_CONTENT_INVALID,
                "恢复快照完整性校验失败",
                false,
            ));
        }
        snapshot.recovery_content = verified.content;
    } else {
        let actual_hash = large_text_repository::sha256(&snapshot.recovery_content);
        if !actual_hash.eq_ignore_ascii_case(&snapshot.recovery_content_hash) {
            return Err(AppError::new(
                codes::RECOVERY_CONTENT_INVALID,
                "恢复快照完整性校验失败",
                false,
            ));
        }
    }
    Ok(Some(snapshot))
}

pub fn delete(
    connection: &mut Connection,
    novel_id: &str,
    chapter_id: &str,
) -> Result<usize, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let document_id = recovery_repository::get(&transaction, novel_id, chapter_id)?
        .and_then(|snapshot| snapshot.large_text_ref_id);
    let affected = recovery_repository::delete_exact(&transaction, novel_id, chapter_id)?;
    if let Some(document_id) = document_id {
        large_text_repository::delete_if_unreferenced(&transaction, &document_id)?;
    }
    transaction.commit().map_err(AppError::database)?;
    Ok(affected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;
    use crate::repositories::recovery_repository;

    fn test_connection() -> Result<Connection, Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch(
            "CREATE TABLE novels (id TEXT PRIMARY KEY, deleted_at TEXT);
             CREATE TABLE chapters (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, deleted_at TEXT);
             CREATE TABLE chapter_drafts (
                 id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
                 content TEXT NOT NULL, source TEXT NOT NULL, version_no INTEGER NOT NULL,
                 word_count INTEGER NOT NULL DEFAULT 0, is_adopted INTEGER NOT NULL DEFAULT 0,
                 title TEXT, large_text_ref_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
             );
             INSERT INTO novels (id) VALUES ('novel-a'), ('novel-b');
             INSERT INTO chapters (id, novel_id) VALUES
                 ('chapter-a1', 'novel-a'), ('chapter-a2', 'novel-a'), ('chapter-b1', 'novel-b');",
        )?;
        migrations::run_migrations(&mut connection)?;
        Ok(connection)
    }

    fn recovery(novel: &str, chapter: &str, content: &str) -> UpsertRecoveryInput {
        UpsertRecoveryInput {
            trace_id: Some("trace-recovery".to_string()),
            novel_id: novel.to_string(),
            chapter_id: chapter.to_string(),
            base_draft_id: None,
            base_draft_version: None,
            base_content_hash: None,
            recovery_content: content.to_string(),
            recovery_content_hash: large_text_repository::sha256(content),
            selection_start: Some(0),
            selection_end: Some(content.chars().count() as i64),
        }
    }

    #[test]
    fn db12_recovery_upsert_keeps_latest_snapshot() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = test_connection()?;
        let latest = "恢复正文".repeat(30_000);
        upsert(&mut connection, recovery("novel-a", "chapter-a1", "first"))?;
        upsert(&mut connection, recovery("novel-a", "chapter-a1", &latest))?;
        let stored = get(&connection, "novel-a", "chapter-a1")?
            .expect("snapshot exists");
        assert_eq!(stored.recovery_content, latest);
        assert!(stored.large_text_ref_id.is_some());
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM workspace_recovery_snapshots",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(count, 1);
        let document_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM large_text_documents",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(document_count, 1);
        Ok(())
    }

    #[test]
    fn db13_recovery_cleanup_is_exact() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = test_connection()?;
        upsert(&mut connection, recovery("novel-a", "chapter-a1", "A1"))?;
        upsert(&mut connection, recovery("novel-a", "chapter-a2", "A2"))?;
        upsert(&mut connection, recovery("novel-b", "chapter-b1", "B1"))?;
        assert_eq!(delete(&mut connection, "novel-a", "chapter-a1")?, 1);
        assert!(recovery_repository::get(&connection, "novel-a", "chapter-a2")?.is_some());
        assert!(recovery_repository::get(&connection, "novel-b", "chapter-b1")?.is_some());
        Ok(())
    }

    #[test]
    fn db14_recovery_is_isolated_from_draft_history() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = test_connection()?;
        upsert(&mut connection, recovery("novel-a", "chapter-a1", "unsaved"))?;
        let draft_count: i64 =
            connection.query_row("SELECT COUNT(*) FROM chapter_drafts", [], |row| row.get(0))?;
        assert_eq!(draft_count, 0);
        Ok(())
    }
}
