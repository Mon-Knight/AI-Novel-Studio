use crate::errors::{codes, log_workspace_event, AppError, WorkspaceLogEvent};
use crate::repositories::{draft_repository, large_text_repository};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveChapterDraftAtomicInput {
    pub operation_id: String,
    #[serde(default)]
    pub trace_id: Option<String>,
    pub novel_id: String,
    pub chapter_id: String,
    #[serde(default)]
    pub draft_id: Option<String>,
    #[serde(default, alias = "baseDraftVersion")]
    pub draft_version: Option<i64>,
    #[serde(default)]
    pub base_content_hash: Option<String>,
    #[serde(alias = "contentHash")]
    pub current_content_hash: String,
    pub content: String,
    #[serde(default)]
    pub word_count: Option<i64>,
    pub source: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub ai_task_id: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub staging_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AtomicDraftDto {
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
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveChapterDraftAtomicOutput {
    pub operation_id: String,
    pub trace_id: String,
    pub draft: AtomicDraftDto,
    pub content_hash: String,
    pub content_length: usize,
    pub storage_mode: String,
    pub idempotent_replay: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum DraftContentState {
    Ready {
        content: String,
        #[serde(rename = "contentHash")]
        content_hash: String,
        #[serde(rename = "contentLength")]
        content_length: usize,
    },
    Unavailable {
        #[serde(skip_serializing_if = "Option::is_none")]
        preview: Option<String>,
        #[serde(rename = "errorCode")]
        error_code: String,
        retryable: bool,
        #[serde(rename = "expectedHash", skip_serializing_if = "Option::is_none")]
        expected_hash: Option<String>,
        #[serde(rename = "actualHash", skip_serializing_if = "Option::is_none")]
        actual_hash: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadChapterDraftContentOutput {
    pub draft_id: String,
    pub draft_version: i64,
    pub content_state: DraftContentState,
}

fn word_count(content: &str) -> i64 {
    let mut count = 0_i64;
    let mut in_ascii_word = false;
    for character in content.chars() {
        let is_cjk = ('\u{4e00}'..='\u{9fff}').contains(&character)
            || ('\u{3400}'..='\u{4dbf}').contains(&character);
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

fn request_hash(input: &SaveChapterDraftAtomicInput) -> String {
    let canonical = serde_json::json!({
        "novelId": input.novel_id,
        "chapterId": input.chapter_id,
        "draftId": input.draft_id,
        "draftVersion": input.draft_version,
        "baseContentHash": input.base_content_hash,
        "currentContentHash": input.current_content_hash.to_ascii_lowercase(),
        "contentLength": input.content.len(),
        "source": input.source,
        "title": input.title,
        "aiTaskId": input.ai_task_id,
        "note": input.note,
    });
    large_text_repository::sha256(&canonical.to_string())
}

pub(crate) fn load_full_content(
    connection: &Connection,
    draft: &draft_repository::DraftRecord,
) -> Result<large_text_repository::VerifiedContent, AppError> {
    if let Some(document_id) = draft.large_text_ref_id.as_deref() {
        large_text_repository::read_verified_for_draft(
            connection,
            document_id,
            &draft.id,
            &draft.chapter_id,
        )
    } else {
        let content_hash = large_text_repository::sha256(&draft.content);
        if let Some(expected_hash) = draft.content_hash.as_deref() {
            if !content_hash.eq_ignore_ascii_case(expected_hash) {
                return Err(AppError::new(
                    codes::LARGE_TEXT_CONTENT_UNAVAILABLE,
                    "草稿正文完整性校验失败",
                    false,
                )
                .with_details(serde_json::json!({
                    "expectedHash": expected_hash,
                    "actualHash": content_hash,
                })));
            }
        }
        Ok(large_text_repository::VerifiedContent {
            content_length: draft.content.chars().count(),
            content: draft.content.clone(),
            content_hash,
        })
    }
}

fn map_draft(record: draft_repository::DraftRecord, content: String) -> AtomicDraftDto {
    AtomicDraftDto {
        id: record.id,
        novel_id: record.novel_id,
        chapter_id: record.chapter_id,
        title: record.title,
        content,
        source: record.source,
        version_no: record.version_no,
        word_count: record.word_count,
        is_adopted: record.is_adopted,
        ai_task_id: record.ai_task_id,
        note: record.note,
        large_text_ref_id: record.large_text_ref_id,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

pub fn save_chapter_draft_atomic_with_cleanup<F>(
    connection: &mut Connection,
    input: SaveChapterDraftAtomicInput,
    cleanup: F,
) -> Result<SaveChapterDraftAtomicOutput, AppError>
where
    F: FnOnce() -> Result<(), String>,
{
    let trace_id = input
        .trace_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let operation_id = input.operation_id.clone();
    let add_context =
        |error: AppError| error.with_context(Some(trace_id.as_str()), Some(operation_id.as_str()));
    if operation_id.trim().is_empty() {
        return Err(add_context(AppError::new(
            codes::OPERATION_PAYLOAD_CONFLICT,
            "operationId 不能为空",
            false,
        )));
    }
    if input.draft_id.is_some()
        && (input.draft_version.is_none()
            || input
                .base_content_hash
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
                .is_empty())
    {
        return Err(add_context(AppError::new(
            codes::DOCUMENT_VERSION_CONFLICT,
            "更新草稿必须提供基础版本和正文哈希",
            false,
        )));
    }

    let actual_hash = large_text_repository::sha256(&input.content);
    if !actual_hash.eq_ignore_ascii_case(&input.current_content_hash) {
        return Err(add_context(
            AppError::new(codes::LARGE_TEXT_HASH_MISMATCH, "提交正文哈希不一致", false)
                .with_details(serde_json::json!({
                    "expectedHash": input.current_content_hash,
                    "actualHash": actual_hash,
                })),
        ));
    }

    let operation_request_hash = request_hash(&input);
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| add_context(error.into()))?;
    let existing_operation = transaction
        .query_row(
            "SELECT request_hash, status, result_json FROM draft_save_operations WHERE operation_id = ?1",
            params![operation_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| add_context(error.into()))?;
    if let Some((stored_hash, status, result_json)) = existing_operation {
        if stored_hash != operation_request_hash {
            return Err(add_context(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "同一 operationId 对应了不同正文",
                false,
            )));
        }
        if status == "completed" {
            let mut output: SaveChapterDraftAtomicOutput =
                serde_json::from_str(result_json.as_deref().unwrap_or("")).map_err(|_| {
                    add_context(AppError::new(
                        codes::DATABASE_TRANSACTION_FAILED,
                        "已完成操作的结果无法读取",
                        false,
                    ))
                })?;
            output.idempotent_replay = true;
            transaction.commit().map_err(|error| {
                add_context(
                    AppError::new(codes::DATABASE_COMMIT_UNKNOWN, "数据库提交状态未知", true)
                        .with_details(serde_json::json!({ "sqliteError": error.to_string() })),
                )
            })?;
            if let Err(cleanup_error) = cleanup() {
                log_workspace_event(WorkspaceLogEvent {
                    level: "warn",
                    event: "draft_save_post_commit_cleanup_failed",
                    trace_id: Some(&trace_id),
                    operation_id: Some(&operation_id),
                    novel_id: Some(&input.novel_id),
                    chapter_id: Some(&input.chapter_id),
                    draft_id: Some(&output.draft.id),
                    error_code: None,
                    metadata: Some(serde_json::json!({ "maintenanceError": cleanup_error })),
                });
            }
            return Ok(output);
        }
        if status == "started" {
            return Err(add_context(AppError::new(
                codes::OPERATION_IN_PROGRESS,
                "保存操作正在进行",
                true,
            )));
        }
    } else {
        transaction
            .execute(
                "INSERT INTO draft_save_operations
                    (operation_id, trace_id, novel_id, chapter_id, request_hash, status, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'started', ?6)",
                params![
                    operation_id,
                    trace_id,
                    input.novel_id,
                    input.chapter_id,
                    operation_request_hash,
                    Utc::now().to_rfc3339()
                ],
            )
            .map_err(|error| add_context(error.into()))?;
    }

    draft_repository::validate_target(&transaction, &input.novel_id, &input.chapter_id)
        .map_err(add_context)?;
    let existing_draft = if let Some(draft_id) = input.draft_id.as_deref() {
        let draft = draft_repository::find_draft(&transaction, draft_id)
            .map_err(add_context)?
            .ok_or_else(|| {
                add_context(AppError::new(
                    codes::DRAFT_UPDATE_ZERO_ROWS,
                    "目标草稿不存在，更新未命中",
                    false,
                ))
            })?;
        if draft.novel_id != input.novel_id || draft.chapter_id != input.chapter_id {
            return Err(add_context(AppError::new(
                codes::DRAFT_UPDATE_ZERO_ROWS,
                "目标草稿不属于当前章节",
                false,
            )));
        }
        if let Some(expected_version) = input.draft_version {
            if draft.version_no != expected_version {
                return Err(add_context(
                    AppError::new(
                        codes::DOCUMENT_VERSION_CONFLICT,
                        "草稿版本已发生变化",
                        false,
                    )
                    .with_details(serde_json::json!({
                        "expectedVersion": expected_version,
                        "actualVersion": draft.version_no,
                    })),
                ));
            }
        }
        if let Some(expected_hash) = input.base_content_hash.as_deref() {
            let persisted = load_full_content(&transaction, &draft).map_err(add_context)?;
            if !persisted.content_hash.eq_ignore_ascii_case(expected_hash) {
                return Err(add_context(
                    AppError::new(codes::DOCUMENT_HASH_MISMATCH, "草稿正文已发生变化", false)
                        .with_details(serde_json::json!({
                            "expectedHash": expected_hash,
                            "actualHash": persisted.content_hash,
                        })),
                ));
            }
        }
        Some(draft)
    } else {
        None
    };

    // Adopted versions are immutable history. Editing one creates a new candidate version.
    let create_new_version = existing_draft
        .as_ref()
        .map(|draft| draft.is_adopted)
        .unwrap_or(true);
    let draft_id = if create_new_version {
        uuid::Uuid::new_v4().to_string()
    } else {
        existing_draft
            .as_ref()
            .map(|draft| draft.id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
    };
    let now = Utc::now().to_rfc3339();
    let use_large_text = input.content.len() > large_text_repository::LARGE_TEXT_THRESHOLD_BYTES;
    let document_id = use_large_text.then(|| uuid::Uuid::new_v4().to_string());
    if let Some(document_id) = document_id.as_deref() {
        large_text_repository::insert_document(
            &transaction,
            document_id,
            &draft_id,
            input.title.as_deref(),
            &input.content,
            &actual_hash,
            &now,
        )
        .map_err(add_context)?;
    }
    let stored_content = if use_large_text {
        input.content.chars().take(500).collect::<String>()
    } else {
        input.content.clone()
    };
    let server_word_count = word_count(&input.content);
    let calculated_word_count = input
        .word_count
        .filter(|provided| *provided == server_word_count)
        .unwrap_or(server_word_count);
    let ai_task_id = match input
        .ai_task_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        Some(candidate) => transaction
            .query_row(
                "SELECT id FROM ai_task_records WHERE id = ?1",
                params![candidate],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| add_context(error.into()))?,
        None => None,
    };

    if !create_new_version {
        let affected = draft_repository::update_draft(
            &transaction,
            &draft_id,
            &input.novel_id,
            &input.chapter_id,
            input.draft_version,
            input.title.as_deref(),
            &stored_content,
            &input.source,
            calculated_word_count,
            document_id.as_deref(),
            &actual_hash,
            &now,
        )
        .map_err(add_context)?;
        if affected != 1 {
            return Err(add_context(AppError::new(
                codes::DRAFT_UPDATE_ZERO_ROWS,
                "草稿更新未命中唯一目标",
                false,
            )));
        }
    } else {
        let version =
            draft_repository::next_version(&transaction, &input.chapter_id).map_err(add_context)?;
        draft_repository::insert_draft(
            &transaction,
            &draft_id,
            &input.novel_id,
            &input.chapter_id,
            input.title.as_deref(),
            &stored_content,
            &input.source,
            version,
            calculated_word_count,
            ai_task_id.as_deref(),
            input.note.as_deref(),
            document_id.as_deref(),
            &actual_hash,
            &now,
        )
        .map_err(add_context)?;
    }

    if !create_new_version {
        if let Some(old_document_id) = existing_draft
            .as_ref()
            .and_then(|draft| draft.large_text_ref_id.as_deref())
        {
            if Some(old_document_id) != document_id.as_deref() {
                large_text_repository::delete_if_unreferenced(&transaction, old_document_id)
                    .map_err(add_context)?;
            }
        }
    }
    let saved_record = draft_repository::find_draft(&transaction, &draft_id)
        .map_err(add_context)?
        .ok_or_else(|| {
            add_context(AppError::new(
                codes::DRAFT_UPDATE_ZERO_ROWS,
                "保存后的草稿无法读取",
                false,
            ))
        })?;
    let output = SaveChapterDraftAtomicOutput {
        operation_id: operation_id.clone(),
        trace_id: trace_id.clone(),
        draft: map_draft(saved_record, input.content.clone()),
        content_hash: actual_hash,
        content_length: input.content.chars().count(),
        storage_mode: if use_large_text { "chunked" } else { "inline" }.to_string(),
        idempotent_replay: false,
    };
    let result_json = serde_json::to_string(&output).map_err(|_| {
        add_context(AppError::new(
            codes::DATABASE_TRANSACTION_FAILED,
            "保存结果序列化失败",
            false,
        ))
    })?;
    transaction
        .execute(
            "UPDATE draft_save_operations
             SET draft_id = ?1, status = 'completed', result_json = ?2, completed_at = ?3
             WHERE operation_id = ?4 AND status IN ('started', 'failed')",
            params![draft_id, result_json, Utc::now().to_rfc3339(), operation_id],
        )
        .map_err(|error| add_context(error.into()))?;
    transaction.commit().map_err(|error| {
        add_context(
            AppError::new(codes::DATABASE_COMMIT_UNKNOWN, "数据库提交状态未知", true)
                .with_details(serde_json::json!({ "sqliteError": error.to_string() })),
        )
    })?;

    if let Err(cleanup_error) = cleanup() {
        log_workspace_event(WorkspaceLogEvent {
            level: "warn",
            event: "draft_save_post_commit_cleanup_failed",
            trace_id: Some(&trace_id),
            operation_id: Some(&operation_id),
            novel_id: Some(&input.novel_id),
            chapter_id: Some(&input.chapter_id),
            draft_id: Some(&draft_id),
            error_code: None,
            metadata: Some(serde_json::json!({ "maintenanceError": cleanup_error })),
        });
    }
    Ok(output)
}

pub fn read_chapter_draft_content(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
    draft_id: &str,
) -> Result<ReadChapterDraftContentOutput, AppError> {
    draft_repository::validate_target(connection, novel_id, chapter_id)?;
    let draft = draft_repository::find_draft(connection, draft_id)?
        .ok_or_else(|| AppError::new(codes::TARGET_DRAFT_NOT_FOUND, "目标草稿不存在", false))?;
    if draft.novel_id != novel_id || draft.chapter_id != chapter_id {
        return Err(AppError::new(
            codes::LARGE_TEXT_REFERENCE_INVALID,
            "草稿与章节引用关系无效",
            false,
        ));
    }
    let state = match load_full_content(connection, &draft) {
        Ok(verified) => DraftContentState::Ready {
            content: verified.content,
            content_hash: verified.content_hash,
            content_length: verified.content_length,
        },
        Err(error) => {
            let expected_hash = error
                .details
                .as_ref()
                .and_then(|details| details["expectedHash"].as_str().map(ToOwned::to_owned));
            let actual_hash = error
                .details
                .as_ref()
                .and_then(|details| details["actualHash"].as_str().map(ToOwned::to_owned));
            DraftContentState::Unavailable {
                preview: (!draft.content.is_empty()).then(|| draft.content.clone()),
                error_code: codes::LARGE_TEXT_CONTENT_UNAVAILABLE.to_string(),
                retryable: error.retryable,
                expected_hash,
                actual_hash,
            }
        }
    };
    Ok(ReadChapterDraftContentOutput {
        draft_id: draft.id,
        draft_version: draft.version_no,
        content_state: state,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;

    #[test]
    fn word_count_matches_frontend_contract() {
        assert_eq!(word_count("中文 hello-world 123 🙂"), 5);
        assert_eq!(word_count("# 标题\n\n正文"), 4);
    }

    fn test_connection() -> Result<Connection, Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE novels (
                 id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL, deleted_at TEXT
             );
             CREATE TABLE chapters (
                 id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, title TEXT NOT NULL,
                 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
             );
             CREATE TABLE ai_task_records (id TEXT PRIMARY KEY);
             CREATE TABLE chapter_drafts (
                 id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
                 title TEXT, content TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
                 version_no INTEGER NOT NULL, word_count INTEGER NOT NULL DEFAULT 0,
                 is_adopted INTEGER NOT NULL DEFAULT 0, ai_task_id TEXT, note TEXT,
                 large_text_ref_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
             );
             INSERT INTO novels (id, title, created_at, updated_at)
             VALUES ('novel-a', 'Novel A', 'now', 'now'), ('novel-b', 'Novel B', 'now', 'now');
             INSERT INTO chapters (id, novel_id, title, created_at, updated_at)
             VALUES ('chapter-a', 'novel-a', 'A', 'now', 'now'),
                    ('chapter-a2', 'novel-a', 'A2', 'now', 'now'),
                    ('chapter-b', 'novel-b', 'B', 'now', 'now');",
        )?;
        migrations::run_migrations(&mut connection)?;
        Ok(connection)
    }

    fn input(operation_id: &str, content: String) -> SaveChapterDraftAtomicInput {
        SaveChapterDraftAtomicInput {
            operation_id: operation_id.to_string(),
            trace_id: Some(format!("trace-{operation_id}")),
            novel_id: "novel-a".to_string(),
            chapter_id: "chapter-a".to_string(),
            draft_id: None,
            draft_version: None,
            base_content_hash: None,
            current_content_hash: large_text_repository::sha256(&content),
            content,
            word_count: None,
            source: "user_edited".to_string(),
            title: Some("Draft".to_string()),
            ai_task_id: None,
            note: None,
            staging_session_id: None,
        }
    }

    #[test]
    fn ai_task_provenance_and_note_are_preserved_by_atomic_create(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = test_connection()?;
        connection.execute("INSERT INTO ai_task_records (id) VALUES ('task-a')", [])?;
        let mut request = input("op-provenance", "candidate content".to_string());
        request.ai_task_id = Some("task-a".to_string());
        request.note = Some("constraint snapshot".to_string());

        let output =
            save_chapter_draft_atomic_with_cleanup(&mut connection, request, || Ok(()))?;

        assert_eq!(output.draft.ai_task_id.as_deref(), Some("task-a"));
        assert_eq!(output.draft.note.as_deref(), Some("constraint snapshot"));
        let persisted: (Option<String>, Option<String>) = connection.query_row(
            "SELECT ai_task_id, note FROM chapter_drafts WHERE id = ?1",
            params![output.draft.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(persisted.0.as_deref(), Some("task-a"));
        assert_eq!(persisted.1.as_deref(), Some("constraint snapshot"));
        Ok(())
    }

    fn count(connection: &Connection, table: &str) -> rusqlite::Result<i64> {
        connection.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
    }

    #[test]
    fn db04_hash_mismatch_rolls_back_everything() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = test_connection()?;
        let mut request = input("op-hash", "正文".to_string());
        request.current_content_hash = "invalid".to_string();
        let error = save_chapter_draft_atomic_with_cleanup(&mut connection, request, || Ok(()))
            .expect_err("hash mismatch must fail");
        assert_eq!(error.code, codes::LARGE_TEXT_HASH_MISMATCH);
        assert_eq!(count(&connection, "large_text_documents")?, 0);
        assert_eq!(count(&connection, "large_text_chunks")?, 0);
        assert_eq!(count(&connection, "chapter_drafts")?, 0);
        assert_eq!(count(&connection, "draft_save_operations")?, 0);
        Ok(())
    }

    #[test]
    fn db05_chunk_failure_rolls_back_transaction() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = test_connection()?;
        connection.execute_batch(
            "CREATE TRIGGER fail_second_chunk BEFORE INSERT ON large_text_chunks
             WHEN NEW.chunk_index = 1 BEGIN SELECT RAISE(ABORT, 'forced chunk failure'); END;",
        )?;
        let request = input("op-chunk", "长正文".repeat(50_000));
        save_chapter_draft_atomic_with_cleanup(&mut connection, request, || Ok(()))
            .expect_err("chunk failure must fail");
        assert_eq!(count(&connection, "large_text_documents")?, 0);
        assert_eq!(count(&connection, "large_text_chunks")?, 0);
        assert_eq!(count(&connection, "chapter_drafts")?, 0);
        assert_eq!(count(&connection, "draft_save_operations")?, 0);
        Ok(())
    }

    #[test]
    fn db06_missing_update_target_rolls_back() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = test_connection()?;
        let original_hash = large_text_repository::sha256("旧正文");
        connection.execute(
            "INSERT INTO chapter_drafts
             (id, novel_id, chapter_id, content, source, version_no, word_count, is_adopted,
              content_hash, created_at, updated_at)
             VALUES ('draft-zero', 'novel-a', 'chapter-a', '旧正文', 'manual', 1, 3, 0, ?1, 'now', 'now')",
            params![original_hash],
        )?;
        connection.execute_batch(
            "CREATE TRIGGER ignore_draft_update BEFORE UPDATE ON chapter_drafts
             WHEN OLD.id = 'draft-zero' BEGIN SELECT RAISE(IGNORE); END;",
        )?;
        let mut request = input("op-missing", "长正文".repeat(50_000));
        request.draft_id = Some("draft-zero".to_string());
        request.draft_version = Some(1);
        request.base_content_hash = Some(original_hash);
        let error = save_chapter_draft_atomic_with_cleanup(&mut connection, request, || Ok(()))
            .expect_err("zero-row update must fail");
        assert_eq!(error.code, codes::DRAFT_UPDATE_ZERO_ROWS);
        let content: String = connection.query_row(
            "SELECT content FROM chapter_drafts WHERE id = 'draft-zero'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(content, "旧正文");
        assert_eq!(count(&connection, "large_text_documents")?, 0);
        assert_eq!(count(&connection, "large_text_chunks")?, 0);
        assert_eq!(count(&connection, "draft_save_operations")?, 0);
        Ok(())
    }

    #[test]
    fn db07_cross_chapter_update_is_rejected() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = test_connection()?;
        connection.execute(
            "INSERT INTO chapter_drafts
             (id, novel_id, chapter_id, content, source, version_no, word_count, is_adopted,
              content_hash, created_at, updated_at)
             VALUES ('draft-a2', 'novel-a', 'chapter-a2', '旧文', 'manual', 1, 2, 0, ?1, 'now', 'now')",
            params![large_text_repository::sha256("旧文")],
        )?;
        let mut request = input("op-cross", "覆盖".to_string());
        request.draft_id = Some("draft-a2".to_string());
        request.draft_version = Some(1);
        request.base_content_hash = Some(large_text_repository::sha256("旧文"));
        let error = save_chapter_draft_atomic_with_cleanup(&mut connection, request, || Ok(()))
            .expect_err("cross-chapter update must fail");
        assert_eq!(error.code, codes::DRAFT_UPDATE_ZERO_ROWS);
        let content: String = connection.query_row(
            "SELECT content FROM chapter_drafts WHERE id = 'draft-a2'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(content, "旧文");
        Ok(())
    }

    #[test]
    fn db08_operation_retry_returns_one_business_result() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = test_connection()?;
        let request = input("op-retry", "长正文".repeat(50_000));
        let first =
            save_chapter_draft_atomic_with_cleanup(&mut connection, request.clone(), || Ok(()))?;
        let second = save_chapter_draft_atomic_with_cleanup(&mut connection, request, || Ok(()))?;
        assert!(!first.idempotent_replay);
        assert!(second.idempotent_replay);
        assert_eq!(first.draft.id, second.draft.id);
        assert_eq!(count(&connection, "large_text_documents")?, 1);
        assert_eq!(count(&connection, "chapter_drafts")?, 1);
        assert_eq!(count(&connection, "draft_save_operations")?, 1);
        Ok(())
    }

    #[test]
    fn db09_operation_payload_conflict_is_rejected() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = test_connection()?;
        save_chapter_draft_atomic_with_cleanup(
            &mut connection,
            input("op-conflict", "第一份".to_string()),
            || Ok(()),
        )?;
        let error = save_chapter_draft_atomic_with_cleanup(
            &mut connection,
            input("op-conflict", "第二份".to_string()),
            || Ok(()),
        )
        .expect_err("different payload must fail");
        assert_eq!(error.code, codes::OPERATION_PAYLOAD_CONFLICT);
        assert_eq!(count(&connection, "chapter_drafts")?, 1);
        Ok(())
    }

    #[test]
    fn db10_cleanup_failure_after_commit_still_succeeds() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = test_connection()?;
        let request = input("op-cleanup", "正文".to_string());
        let first =
            save_chapter_draft_atomic_with_cleanup(&mut connection, request.clone(), || {
                Err("forced cleanup failure".to_string())
            })?;
        let replay = save_chapter_draft_atomic_with_cleanup(&mut connection, request, || Ok(()))?;
        assert_eq!(first.draft.id, replay.draft.id);
        assert!(replay.idempotent_replay);
        assert_eq!(count(&connection, "chapter_drafts")?, 1);
        Ok(())
    }

    #[test]
    fn db11_corrupt_large_text_returns_unavailable() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = test_connection()?;
        let saved = save_chapter_draft_atomic_with_cleanup(
            &mut connection,
            input("op-read", "长正文".repeat(50_000)),
            || Ok(()),
        )?;
        connection.execute(
            "UPDATE large_text_chunks SET content = 'corrupt' WHERE document_id = ?1 AND chunk_index = 0",
            params![saved.draft.large_text_ref_id],
        )?;
        let read =
            read_chapter_draft_content(&connection, "novel-a", "chapter-a", &saved.draft.id)?;
        match read.content_state {
            DraftContentState::Unavailable { error_code, .. } => {
                assert_eq!(error_code, codes::LARGE_TEXT_CONTENT_UNAVAILABLE)
            }
            DraftContentState::Ready { .. } => panic!("corrupt body must not be editable"),
        }
        Ok(())
    }

    #[test]
    fn adopted_draft_is_never_overwritten_in_place() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = test_connection()?;
        let original_hash = large_text_repository::sha256("已采用正文");
        connection.execute(
            "INSERT INTO chapter_drafts
             (id, novel_id, chapter_id, content, source, version_no, word_count, is_adopted,
              content_hash, created_at, updated_at)
             VALUES ('adopted', 'novel-a', 'chapter-a', '已采用正文', 'manual', 1, 5, 1, ?1, 'now', 'now')",
            params![original_hash],
        )?;
        let mut request = input("op-adopted", "候选修改".to_string());
        request.draft_id = Some("adopted".to_string());
        request.draft_version = Some(1);
        request.base_content_hash = Some(original_hash);
        let saved = save_chapter_draft_atomic_with_cleanup(&mut connection, request, || Ok(()))?;
        assert_ne!(saved.draft.id, "adopted");
        assert_eq!(saved.draft.version_no, 2);
        let original: (String, i64) = connection.query_row(
            "SELECT content, is_adopted FROM chapter_drafts WHERE id = 'adopted'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(original, ("已采用正文".to_string(), 1));
        Ok(())
    }
}
