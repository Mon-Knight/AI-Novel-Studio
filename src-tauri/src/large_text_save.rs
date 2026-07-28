use crate::commands::{
    count_words, get_draft_by_id_and_chapter_internal, get_draft_by_id_internal, ChapterDraftDto,
};
use crate::db::get_connection;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

// ==================== Data Structures ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LargeTextSaveSession {
    pub session_id: String,
    pub target_type: String,
    pub target_id: Option<String>,
    pub field_name: String,
    pub title: Option<String>,
    pub total_chunks: usize,
    pub total_chars: usize,
    pub total_bytes: usize,
    pub content_sha256: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLargeTextSaveSessionInput {
    pub target_type: String,
    pub target_id: Option<String>,
    pub field_name: String,
    pub title: Option<String>,
    pub total_chunks: usize,
    pub total_chars: usize,
    pub total_bytes: usize,
    pub content_sha256: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLargeTextSaveSessionOutput {
    pub session_id: String,
    pub cache_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendLargeTextChunkInput {
    pub session_id: String,
    pub chunk_index: usize,
    pub content: String,
    pub char_count: usize,
    pub byte_count: usize,
    pub chunk_sha256: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendLargeTextChunkOutput {
    pub session_id: String,
    pub chunk_index: usize,
    pub saved_count: usize,
    pub total_chunks: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeLargeTextSaveInput {
    pub session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeLargeTextSaveOutput {
    pub document_id: String,
    pub total_chars: usize,
    pub total_bytes: usize,
    pub chunk_count: usize,
    pub cleanup_warning: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbortLargeTextSaveInput {
    pub session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Stable DTO retained for older desktop integrations.
pub struct LargeTextDocumentDto {
    pub id: String,
    pub target_type: String,
    pub target_id: Option<String>,
    pub field_name: String,
    pub title: Option<String>,
    pub total_chars: usize,
    pub total_bytes: usize,
    pub chunk_count: usize,
    pub content_sha256: Option<String>,
    pub storage_type: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct CommitLargeTextDraftCreateInput {
    pub session_id: String,
    pub draft_id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub title: Option<String>,
    pub source: String,
    pub ai_task_id: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct CommitLargeTextDraftUpdateInput {
    pub session_id: String,
    pub draft_id: String,
    pub chapter_id: String,
    pub source: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct CommitLargeTextDraftOutput {
    pub draft: ChapterDraftDto,
    pub cleanup_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedLargeTextChunk {
    session_id: String,
    chunk_index: usize,
    content: String,
    char_count: usize,
    byte_count: usize,
    chunk_sha256: Option<String>,
}

#[derive(Debug, Clone)]
struct PreparedLargeTextChunk {
    chunk_index: usize,
    content: String,
    char_count: usize,
    byte_count: usize,
    chunk_sha256: String,
}

#[derive(Debug, Clone)]
struct PreparedLargeText {
    session_id: String,
    target_type: String,
    target_id: Option<String>,
    field_name: String,
    title: Option<String>,
    chunks: Vec<PreparedLargeTextChunk>,
    full_content: String,
    total_chars: usize,
    total_bytes: usize,
    content_sha256: String,
}

// ==================== Cache Directory ====================

fn get_cache_dir() -> PathBuf {
    let base = crate::db::get_data_dir();
    base.join("save_cache")
}

fn validate_session_id(session_id: &str) -> Result<String, String> {
    let parsed = uuid::Uuid::parse_str(session_id)
        .map_err(|_| format!("invalid_large_text_session_id: {}", session_id))?;
    Ok(parsed.to_string())
}

fn session_cache_dir(session_id: &str) -> Result<PathBuf, String> {
    Ok(get_cache_dir().join(validate_session_id(session_id)?))
}

fn manifest_path(session_id: &str) -> Result<PathBuf, String> {
    Ok(session_cache_dir(session_id)?.join("manifest.json"))
}

fn chunk_path(session_id: &str, chunk_index: usize) -> Result<PathBuf, String> {
    Ok(session_cache_dir(session_id)?.join(format!("chunk_{:06}.json", chunk_index)))
}

fn compute_sha256(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

// ==================== Tauri Commands ====================

#[tauri::command]
pub fn create_large_text_save_session(
    input: CreateLargeTextSaveSessionInput,
) -> Result<CreateLargeTextSaveSessionOutput, String> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let cache_dir = session_cache_dir(&session_id)?;

    // Create cache directory
    fs::create_dir_all(&cache_dir).map_err(|e| format!("无法创建缓存目录: {}", e))?;

    // Compute SHA-256 if not provided
    let content_sha256 = input.content_sha256.clone();

    // Create session manifest
    let session = LargeTextSaveSession {
        session_id: session_id.clone(),
        target_type: input.target_type,
        target_id: input.target_id,
        field_name: input.field_name,
        title: input.title,
        total_chunks: input.total_chunks,
        total_chars: input.total_chars,
        total_bytes: input.total_bytes,
        content_sha256,
        created_at: now.clone(),
        updated_at: now,
    };

    let manifest_json = serde_json::to_string_pretty(&session)
        .map_err(|e| format!("序列化 manifest 失败: {}", e))?;

    fs::write(manifest_path(&session_id)?, manifest_json)
        .map_err(|e| format!("写入 manifest 失败: {}", e))?;

    Ok(CreateLargeTextSaveSessionOutput {
        session_id,
        cache_dir: cache_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn append_large_text_chunk(
    input: AppendLargeTextChunkInput,
) -> Result<AppendLargeTextChunkOutput, String> {
    validate_session_id(&input.session_id)?;
    let cache_dir = session_cache_dir(&input.session_id)?;
    if !cache_dir.exists() {
        return Err(format!("保存会话不存在: {}", input.session_id));
    }

    // Load manifest to verify
    let manifest = load_manifest(&input.session_id)?;

    // Verify chunk index is within range
    if input.chunk_index >= manifest.total_chunks {
        return Err(format!(
            "分片索引越界: chunk_index={}, total_chunks={}",
            input.chunk_index, manifest.total_chunks
        ));
    }

    let actual_char_count = input.content.chars().count();
    let actual_byte_count = input.content.len();
    if input.char_count != actual_char_count || input.byte_count != actual_byte_count {
        return Err(format!(
            "large_text_chunk_metadata_mismatch: chunk={}, expected_chars={}, actual_chars={}, expected_bytes={}, actual_bytes={}",
            input.chunk_index,
            input.char_count,
            actual_char_count,
            input.byte_count,
            actual_byte_count
        ));
    }

    let actual_sha256 = compute_sha256(&input.content);
    let expected_sha256 = input
        .chunk_sha256
        .as_deref()
        .ok_or_else(|| format!("large_text_chunk_hash_missing: chunk={}", input.chunk_index))?;
    if actual_sha256 != expected_sha256 {
        return Err(format!(
            "large_text_chunk_hash_mismatch: chunk={}, expected={}, actual={}",
            input.chunk_index, expected_sha256, actual_sha256
        ));
    }

    let cached_chunk = CachedLargeTextChunk {
        session_id: input.session_id.clone(),
        chunk_index: input.chunk_index,
        content: input.content,
        char_count: actual_char_count,
        byte_count: actual_byte_count,
        chunk_sha256: Some(actual_sha256),
    };
    let chunk_json =
        serde_json::to_string(&cached_chunk).map_err(|e| format!("序列化分片失败: {}", e))?;

    let cpath = chunk_path(&input.session_id, input.chunk_index)?;
    let temporary_path = cpath.with_extension("json.tmp");
    fs::write(&temporary_path, chunk_json).map_err(|e| format!("写入分片临时文件失败: {}", e))?;
    if cpath.exists() {
        fs::remove_file(&cpath).map_err(|e| format!("无法移除旧分片: {}", e))?;
    }
    fs::rename(&temporary_path, &cpath).map_err(|e| format!("提交分片文件失败: {}", e))?;

    // Count saved chunks
    let saved_count = count_saved_chunks(&cache_dir)?;

    Ok(AppendLargeTextChunkOutput {
        session_id: input.session_id,
        chunk_index: input.chunk_index,
        saved_count,
        total_chunks: manifest.total_chunks,
    })
}

fn validate_cached_large_text(
    manifest: LargeTextSaveSession,
    mut cached_chunks: Vec<CachedLargeTextChunk>,
) -> Result<PreparedLargeText, String> {
    let canonical_session_id = validate_session_id(&manifest.session_id)?;
    if manifest.total_chunks == 0 {
        return Err("large_text_chunk_count_invalid: expected at least one chunk".to_string());
    }
    if cached_chunks.len() != manifest.total_chunks {
        return Err(format!(
            "large_text_chunk_count_mismatch: expected={}, actual={}",
            manifest.total_chunks,
            cached_chunks.len()
        ));
    }

    cached_chunks.sort_by_key(|chunk| chunk.chunk_index);
    let mut prepared_chunks = Vec::with_capacity(cached_chunks.len());
    let mut full_content = String::new();
    for (expected_index, chunk) in cached_chunks.into_iter().enumerate() {
        if chunk.session_id != canonical_session_id {
            return Err(format!(
                "large_text_chunk_session_mismatch: chunk={}, expected={}, actual={}",
                expected_index, canonical_session_id, chunk.session_id
            ));
        }
        if chunk.chunk_index != expected_index {
            return Err(format!(
                "large_text_chunk_index_mismatch: expected={}, actual={}",
                expected_index, chunk.chunk_index
            ));
        }
        let actual_char_count = chunk.content.chars().count();
        let actual_byte_count = chunk.content.len();
        if chunk.char_count != actual_char_count || chunk.byte_count != actual_byte_count {
            return Err(format!(
                "large_text_chunk_metadata_mismatch: chunk={}, expected_chars={}, actual_chars={}, expected_bytes={}, actual_bytes={}",
                expected_index,
                chunk.char_count,
                actual_char_count,
                chunk.byte_count,
                actual_byte_count
            ));
        }
        let actual_sha256 = compute_sha256(&chunk.content);
        let expected_sha256 = chunk
            .chunk_sha256
            .ok_or_else(|| format!("large_text_chunk_hash_missing: chunk={}", expected_index))?;
        if actual_sha256 != expected_sha256 {
            return Err(format!(
                "large_text_chunk_hash_mismatch: chunk={}, expected={}, actual={}",
                expected_index, expected_sha256, actual_sha256
            ));
        }
        full_content.push_str(&chunk.content);
        prepared_chunks.push(PreparedLargeTextChunk {
            chunk_index: expected_index,
            content: chunk.content,
            char_count: actual_char_count,
            byte_count: actual_byte_count,
            chunk_sha256: actual_sha256,
        });
    }

    let actual_total_chars = full_content.chars().count();
    let actual_total_bytes = full_content.len();
    if manifest.total_chars != actual_total_chars || manifest.total_bytes != actual_total_bytes {
        return Err(format!(
            "large_text_total_metadata_mismatch: expected_chars={}, actual_chars={}, expected_bytes={}, actual_bytes={}",
            manifest.total_chars,
            actual_total_chars,
            manifest.total_bytes,
            actual_total_bytes
        ));
    }
    let actual_content_sha256 = compute_sha256(&full_content);
    let expected_content_sha256 = manifest.content_sha256.as_deref().ok_or_else(|| {
        "large_text_content_hash_missing: manifest does not contain SHA-256".to_string()
    })?;
    if actual_content_sha256 != expected_content_sha256 {
        return Err(format!(
            "large_text_content_hash_mismatch: expected={}, actual={}",
            expected_content_sha256, actual_content_sha256
        ));
    }

    Ok(PreparedLargeText {
        session_id: canonical_session_id,
        target_type: manifest.target_type,
        target_id: manifest.target_id,
        field_name: manifest.field_name,
        title: manifest.title,
        chunks: prepared_chunks,
        full_content,
        total_chars: actual_total_chars,
        total_bytes: actual_total_bytes,
        content_sha256: actual_content_sha256,
    })
}

fn prepare_large_text_from_cache(session_id: &str) -> Result<PreparedLargeText, String> {
    let canonical_session_id = validate_session_id(session_id)?;
    let manifest = load_manifest(&canonical_session_id)?;
    if manifest.session_id != canonical_session_id {
        return Err(format!(
            "large_text_manifest_session_mismatch: expected={}, actual={}",
            canonical_session_id, manifest.session_id
        ));
    }
    let cache_dir = session_cache_dir(&canonical_session_id)?;
    let saved_count = count_saved_chunks(&cache_dir)?;
    if saved_count != manifest.total_chunks {
        return Err(format!(
            "large_text_chunk_count_mismatch: expected={}, actual={}",
            manifest.total_chunks, saved_count
        ));
    }
    let mut chunks = Vec::with_capacity(manifest.total_chunks);
    for index in 0..manifest.total_chunks {
        let path = chunk_path(&canonical_session_id, index)?;
        let raw = fs::read_to_string(&path).map_err(|error| {
            format!(
                "large_text_chunk_read_failed: chunk={}, error={}",
                index, error
            )
        })?;
        let chunk = serde_json::from_str::<CachedLargeTextChunk>(&raw).map_err(|error| {
            format!(
                "large_text_chunk_parse_failed: chunk={}, error={}",
                index, error
            )
        })?;
        chunks.push(chunk);
    }
    validate_cached_large_text(manifest, chunks)
}

fn persist_prepared_large_text(
    transaction: &Transaction<'_>,
    prepared: &PreparedLargeText,
    document_id: &str,
    target_id: Option<&str>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    transaction
        .execute(
            "INSERT INTO large_text_documents (id, target_type, target_id, field_name, title, total_chars, total_bytes, chunk_count, content_sha256, storage_type, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'chunked', ?10, ?10)",
            params![
                document_id,
                &prepared.target_type,
                target_id,
                &prepared.field_name,
                &prepared.title,
                prepared.total_chars as i64,
                prepared.total_bytes as i64,
                prepared.chunks.len() as i64,
                &prepared.content_sha256,
                &now,
            ],
        )
        .map_err(|error| format!("large_text_document_insert_failed: {}", error))?;

    for chunk in &prepared.chunks {
        transaction
            .execute(
                "INSERT INTO large_text_chunks (document_id, chunk_index, content, char_count, byte_count, chunk_sha256, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    document_id,
                    chunk.chunk_index as i64,
                    &chunk.content,
                    chunk.char_count as i64,
                    chunk.byte_count as i64,
                    &chunk.chunk_sha256,
                    &now,
                ],
            )
            .map_err(|error| {
                format!(
                    "large_text_chunk_insert_failed: chunk={}, error={}",
                    chunk.chunk_index, error
                )
            })?;
    }
    Ok(())
}

fn cleanup_after_commit(session_id: &str) -> Option<String> {
    cleanup_warning(cleanup_session_cache(session_id))
}

fn cleanup_warning(result: Result<(), String>) -> Option<String> {
    result
        .err()
        .map(|error| format!("large_text_cleanup_warning: {}", error))
}

#[tauri::command]
pub fn finalize_large_text_save(
    input: FinalizeLargeTextSaveInput,
) -> Result<FinalizeLargeTextSaveOutput, String> {
    let prepared = prepare_large_text_from_cache(&input.session_id)?;
    if prepared.target_type == "draft" || prepared.target_type == "chapter_draft" {
        return Err(
            "WORKSPACE_SAVE_FAILED: 草稿正文必须通过 save_chapter_draft_atomic 提交".to_string(),
        );
    }
    let document_id = prepared.session_id.clone();
    let mut conn = get_connection().lock().map_err(|error| error.to_string())?;
    let transaction = conn
        .transaction()
        .map_err(|error| format!("large_text_transaction_begin_failed: {}", error))?;
    persist_prepared_large_text(
        &transaction,
        &prepared,
        &document_id,
        prepared.target_id.as_deref(),
    )?;
    transaction
        .commit()
        .map_err(|error| format!("large_text_transaction_commit_failed: {}", error))?;
    let cleanup_warning = cleanup_after_commit(&input.session_id);

    Ok(FinalizeLargeTextSaveOutput {
        document_id,
        total_chars: prepared.total_chars,
        total_bytes: prepared.total_bytes,
        chunk_count: prepared.chunks.len(),
        cleanup_warning,
    })
}

fn validate_draft_session_binding(
    prepared: &PreparedLargeText,
    draft_id: &str,
) -> Result<(), String> {
    if prepared.target_type != "draft" || prepared.field_name != "content" {
        return Err(format!(
            "large_text_target_mismatch: expected draft/content, actual {}/{}",
            prepared.target_type, prepared.field_name
        ));
    }
    if prepared.target_id.as_deref() != Some(draft_id) {
        return Err(format!(
            "large_text_target_mismatch: expected draft_id={}, actual={}",
            draft_id,
            prepared.target_id.as_deref().unwrap_or("<missing>")
        ));
    }
    Ok(())
}

fn preview_content(content: &str) -> String {
    content.chars().take(500).collect()
}

fn validated_ai_task_id(
    connection: &Connection,
    requested_task_id: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(task_id) = requested_task_id.filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM ai_task_records WHERE id = ?1",
            params![task_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("large_text_ai_task_lookup_failed: {}", error))?;
    Ok((exists == 1).then(|| task_id.to_string()))
}

pub(crate) fn delete_unreferenced_draft_large_text(
    connection: &Connection,
    document_id: &str,
) -> Result<usize, String> {
    connection
        .execute(
            "DELETE FROM large_text_documents WHERE id = ?1 AND target_type = 'draft' AND NOT EXISTS (SELECT 1 FROM chapter_drafts WHERE large_text_ref_id = ?1)",
            params![document_id],
        )
        .map_err(|error| format!("large_text_orphan_cleanup_failed: {}", error))
}

#[allow(dead_code)]
fn commit_large_text_draft_create_internal(
    connection: &mut Connection,
    prepared: &PreparedLargeText,
    input: &CommitLargeTextDraftCreateInput,
) -> Result<ChapterDraftDto, String> {
    validate_draft_session_binding(prepared, &input.draft_id)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("large_text_draft_transaction_begin_failed: {}", error))?;

    let live_chapter: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM chapters WHERE id = ?1 AND novel_id = ?2 AND deleted_at IS NULL",
            params![&input.chapter_id, &input.novel_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("large_text_draft_target_lookup_failed: {}", error))?;
    if live_chapter != 1 {
        return Err(format!(
            "large_text_draft_target_mismatch: novel_id={}, chapter_id={}",
            input.novel_id, input.chapter_id
        ));
    }

    let existing_draft: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM chapter_drafts WHERE id = ?1",
            params![&input.draft_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("large_text_draft_id_lookup_failed: {}", error))?;
    if existing_draft != 0 {
        return Err(format!(
            "large_text_draft_id_conflict: draft_id={}",
            input.draft_id
        ));
    }

    let max_version: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(version_no), 0) FROM chapter_drafts WHERE chapter_id = ?1",
            params![&input.chapter_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("large_text_draft_version_lookup_failed: {}", error))?;
    let ai_task_id = validated_ai_task_id(&transaction, input.ai_task_id.as_deref())?;
    let document_id = prepared.session_id.clone();
    persist_prepared_large_text(&transaction, prepared, &document_id, Some(&input.draft_id))?;

    let now = chrono::Utc::now().to_rfc3339();
    let preview = preview_content(&prepared.full_content);
    let word_count = count_words(&prepared.full_content);
    transaction
        .execute(
            "INSERT INTO chapter_drafts (id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, ai_task_id, note, large_text_ref_id, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,?9,?10,?11,?12,?12)",
            params![
                &input.draft_id,
                &input.novel_id,
                &input.chapter_id,
                &input.title,
                &preview,
                &input.source,
                max_version + 1,
                word_count,
                &ai_task_id,
                &input.note,
                &document_id,
                &now,
            ],
        )
        .map_err(|error| format!("large_text_draft_insert_failed: {}", error))?;

    let mut draft = get_draft_by_id_internal(&transaction, &input.draft_id)
        .map_err(|error| format!("large_text_draft_readback_failed: {}", error))?;
    draft.content = prepared.full_content.clone();
    draft.word_count = word_count;
    transaction
        .commit()
        .map_err(|error| format!("large_text_draft_transaction_commit_failed: {}", error))?;
    Ok(draft)
}

#[allow(dead_code)]
fn commit_large_text_draft_update_internal(
    connection: &mut Connection,
    prepared: &PreparedLargeText,
    input: &CommitLargeTextDraftUpdateInput,
) -> Result<ChapterDraftDto, String> {
    validate_draft_session_binding(prepared, &input.draft_id)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("large_text_draft_transaction_begin_failed: {}", error))?;
    let old_large_text_ref = transaction
        .query_row(
            "SELECT d.large_text_ref_id FROM chapter_drafts AS d INNER JOIN chapters AS c ON c.id = d.chapter_id AND c.novel_id = d.novel_id WHERE d.id = ?1 AND d.chapter_id = ?2 AND c.deleted_at IS NULL",
            params![&input.draft_id, &input.chapter_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| format!("large_text_draft_target_lookup_failed: {}", error))?
        .ok_or_else(|| {
            format!(
                "large_text_draft_update_conflict: draft_id={}, chapter_id={}",
                input.draft_id, input.chapter_id
            )
        })?;

    let document_id = prepared.session_id.clone();
    persist_prepared_large_text(&transaction, prepared, &document_id, Some(&input.draft_id))?;
    let preview = preview_content(&prepared.full_content);
    let source = input.source.as_deref().unwrap_or("user_edited");
    let word_count = count_words(&prepared.full_content);
    let now = chrono::Utc::now().to_rfc3339();
    let updated = transaction
        .execute(
            "UPDATE chapter_drafts SET content = ?1, source = ?2, word_count = ?3, large_text_ref_id = ?4, updated_at = ?5 WHERE id = ?6 AND chapter_id = ?7 AND EXISTS (SELECT 1 FROM chapters AS c WHERE c.id = chapter_drafts.chapter_id AND c.novel_id = chapter_drafts.novel_id AND c.deleted_at IS NULL)",
            params![
                &preview,
                source,
                word_count,
                &document_id,
                &now,
                &input.draft_id,
                &input.chapter_id,
            ],
        )
        .map_err(|error| format!("large_text_draft_update_failed: {}", error))?;
    if updated != 1 {
        return Err(format!(
            "large_text_draft_update_conflict: draft_id={}, chapter_id={}, affected_rows={}",
            input.draft_id, input.chapter_id, updated
        ));
    }

    if let Some(old_document_id) = old_large_text_ref.as_deref() {
        if old_document_id != document_id {
            delete_unreferenced_draft_large_text(&transaction, old_document_id)?;
        }
    }
    let mut draft =
        get_draft_by_id_and_chapter_internal(&transaction, &input.draft_id, &input.chapter_id)
            .map_err(|error| format!("large_text_draft_readback_failed: {}", error))?;
    draft.content = prepared.full_content.clone();
    draft.word_count = word_count;
    transaction
        .commit()
        .map_err(|error| format!("large_text_draft_transaction_commit_failed: {}", error))?;
    Ok(draft)
}

#[tauri::command]
#[allow(dead_code)]
pub fn commit_large_text_draft_create(
    _input: CommitLargeTextDraftCreateInput,
) -> Result<CommitLargeTextDraftOutput, String> {
    let _ = &_input.session_id;
    Err("WORKSPACE_SAVE_FAILED: legacy large-text draft create is disabled; use save_chapter_draft_atomic".to_string())
}

#[tauri::command]
#[allow(dead_code)]
pub fn commit_large_text_draft_update(
    _input: CommitLargeTextDraftUpdateInput,
) -> Result<CommitLargeTextDraftOutput, String> {
    let _ = &_input.session_id;
    Err("WORKSPACE_SAVE_FAILED: legacy large-text draft update is disabled; use save_chapter_draft_atomic".to_string())
}

#[tauri::command]
pub fn abort_large_text_save(input: AbortLargeTextSaveInput) -> Result<(), String> {
    cleanup_session_cache(&input.session_id)
}

#[tauri::command]
pub fn cleanup_expired_large_text_save_sessions() -> Result<usize, String> {
    let cache_dir = get_cache_dir();
    if !cache_dir.exists() {
        return Ok(0);
    }

    let now = chrono::Utc::now();
    let expiration_hours: i64 = 24;
    let mut cleaned = 0usize;

    let entries = fs::read_dir(&cache_dir).map_err(|e| format!("读取缓存目录失败: {}", e))?;

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let manifest_file = path.join("manifest.json");
        if !manifest_file.exists() {
            continue;
        }

        // Check manifest age
        if let Ok(manifest_raw) = fs::read_to_string(&manifest_file) {
            if let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&manifest_raw) {
                if let Some(created_at) = manifest["created_at"].as_str() {
                    if let Ok(created) = chrono::DateTime::parse_from_rfc3339(created_at) {
                        let created_utc = created.with_timezone(&chrono::Utc);
                        let duration = now.signed_duration_since(created_utc);
                        if duration.num_hours() >= expiration_hours {
                            if fs::remove_dir_all(&path).is_ok() {
                                cleaned += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(cleaned)
}

// ==================== Read Functions ====================

/// Read the full content of a large text document by assembling chunks from the database
pub fn read_large_text_document(document_id: &str) -> Result<String, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    read_large_text_document_internal(&conn, document_id)
}

pub(crate) fn read_large_text_document_internal(
    connection: &Connection,
    document_id: &str,
) -> Result<String, String> {
    crate::repositories::large_text_repository::read_verified_document(connection, document_id)
        .map(|verified| verified.content)
        .map_err(|error| serde_json::to_string(&error).unwrap_or_else(|_| error.to_string()))
}

/// Check if content is stored as chunked large text (returns document_id if so)
#[allow(dead_code)] // Retained for compatibility with legacy in-process callers.
pub fn get_large_text_document_id(
    target_type: &str,
    target_id: &str,
    field_name: &str,
) -> Result<Option<String>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id FROM large_text_documents WHERE target_type = ?1 AND target_id = ?2 AND field_name = ?3 ORDER BY updated_at DESC LIMIT 1",
        )
        .map_err(|e| e.to_string())?;

    match stmt.query_row(params![target_type, target_id, field_name], |r| {
        r.get::<_, String>(0)
    }) {
        Ok(id) => Ok(Some(id)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// ==================== Tauri Commands for Reading & Linking ====================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadLargeTextContentInput {
    pub document_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadLargeTextContentOutput {
    pub document_id: String,
    pub content: String,
    pub total_chars: usize,
    pub total_bytes: usize,
}

#[tauri::command]
pub fn read_large_text_content(
    input: ReadLargeTextContentInput,
) -> Result<ReadLargeTextContentOutput, String> {
    let content = read_large_text_document(&input.document_id)?;
    let total_chars = content.chars().count();
    let total_bytes = content.len();

    Ok(ReadLargeTextContentOutput {
        document_id: input.document_id,
        content,
        total_chars,
        total_bytes,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLargeTextRefInput {
    pub target_type: String,
    pub target_id: String,
    pub table_name: String,
    pub large_text_ref_id: Option<String>,
}

#[tauri::command]
pub fn update_large_text_ref(input: UpdateLargeTextRefInput) -> Result<(), String> {
    if input.target_type.trim().is_empty() || input.target_type.len() > 80 {
        return Err("target_type invalid".to_string());
    }
    // Validate table name to prevent SQL injection
    let allowed_tables = [
        "chapter_drafts",
        "chapter_summaries",
        "context_records",
        "style_profiles",
        "output_profiles",
        "world_settings",
        "rule_systems",
    ];

    if !allowed_tables.contains(&input.table_name.as_str()) {
        return Err(format!("不允许的表名: {}", input.table_name));
    }
    if input.table_name == "chapter_drafts" {
        return Err(
            "WORKSPACE_SAVE_FAILED: 草稿大文本引用只能通过 save_chapter_draft_atomic 更新"
                .to_string(),
        );
    }

    let conn = get_connection().lock().map_err(|e| e.to_string())?;

    conn.execute(
        &format!(
            "UPDATE {} SET large_text_ref_id = ?1 WHERE id = ?2",
            input.table_name
        ),
        params![input.large_text_ref_id, input.target_id],
    )
    .map_err(|e| format!("更新 large_text_ref_id 失败: {}", e))?;

    Ok(())
}

// ==================== Helper Functions ====================

fn load_manifest(session_id: &str) -> Result<LargeTextSaveSession, String> {
    let mpath = manifest_path(session_id)?;
    if !mpath.exists() {
        return Err(format!("保存会话不存在: {}", session_id));
    }

    let manifest_raw =
        fs::read_to_string(&mpath).map_err(|e| format!("读取 manifest 失败: {}", e))?;

    serde_json::from_str::<LargeTextSaveSession>(&manifest_raw)
        .map_err(|e| format!("解析 manifest 失败: {}", e))
}

fn count_saved_chunks(cache_dir: &PathBuf) -> Result<usize, String> {
    let mut count = 0usize;
    let entries = fs::read_dir(cache_dir).map_err(|e| format!("读取缓存目录失败: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("chunk_") && name.ends_with(".json") {
            count += 1;
        }
    }

    Ok(count)
}

pub(crate) fn cleanup_session_cache(session_id: &str) -> Result<(), String> {
    let cache_dir = session_cache_dir(session_id)?;
    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir).map_err(|e| format!("清理缓存目录失败: {}", e))?;
    }
    Ok(())
}

// ==================== Database Initialization ====================

/// Create the large_text tables. Called from db::init_database.
#[cfg(test)]
pub fn create_large_text_tables(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS large_text_documents (
            id TEXT PRIMARY KEY,
            target_type TEXT NOT NULL,
            target_id TEXT,
            field_name TEXT NOT NULL,
            title TEXT,
            total_chars INTEGER NOT NULL DEFAULT 0,
            total_bytes INTEGER NOT NULL DEFAULT 0,
            chunk_count INTEGER NOT NULL DEFAULT 0,
            content_sha256 TEXT,
            storage_type TEXT NOT NULL DEFAULT 'chunked',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS large_text_chunks (
            document_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            content TEXT NOT NULL,
            char_count INTEGER NOT NULL DEFAULT 0,
            byte_count INTEGER NOT NULL DEFAULT 0,
            chunk_sha256 TEXT,
            created_at TEXT NOT NULL,
            PRIMARY KEY (document_id, chunk_index),
            FOREIGN KEY (document_id) REFERENCES large_text_documents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_large_text_documents_target
        ON large_text_documents(target_type, target_id, field_name);

        CREATE INDEX IF NOT EXISTS idx_large_text_chunks_document
        ON large_text_chunks(document_id, chunk_index);
        ",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_test_connection() -> Connection {
        let mut connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::db::create_tables(&mut connection).unwrap();
        connection
            .execute_batch(
                "
                INSERT INTO novels (id, title, created_at, updated_at)
                VALUES ('novel-1', 'Test novel', 'now', 'now');
                INSERT INTO chapters (id, novel_id, title, created_at, updated_at)
                VALUES ('chapter-1', 'novel-1', 'Test chapter', 'now', 'now');
                ",
            )
            .unwrap();
        connection
    }

    fn prepared_text(draft_id: &str, parts: &[&str]) -> PreparedLargeText {
        let full_content = parts.concat();
        let chunks = parts
            .iter()
            .enumerate()
            .map(|(chunk_index, content)| PreparedLargeTextChunk {
                chunk_index,
                content: (*content).to_string(),
                char_count: content.chars().count(),
                byte_count: content.len(),
                chunk_sha256: compute_sha256(content),
            })
            .collect::<Vec<_>>();
        PreparedLargeText {
            session_id: uuid::Uuid::new_v4().to_string(),
            target_type: "draft".to_string(),
            target_id: Some(draft_id.to_string()),
            field_name: "content".to_string(),
            title: None,
            chunks,
            total_chars: full_content.chars().count(),
            total_bytes: full_content.len(),
            content_sha256: compute_sha256(&full_content),
            full_content,
        }
    }

    fn manifest_for(
        prepared: &PreparedLargeText,
        total_chunks: usize,
        content_sha256: Option<String>,
    ) -> LargeTextSaveSession {
        LargeTextSaveSession {
            session_id: prepared.session_id.clone(),
            target_type: prepared.target_type.clone(),
            target_id: prepared.target_id.clone(),
            field_name: prepared.field_name.clone(),
            title: prepared.title.clone(),
            total_chunks,
            total_chars: prepared.total_chars,
            total_bytes: prepared.total_bytes,
            content_sha256,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        }
    }

    fn cached_chunks(prepared: &PreparedLargeText) -> Vec<CachedLargeTextChunk> {
        prepared
            .chunks
            .iter()
            .map(|chunk| CachedLargeTextChunk {
                session_id: prepared.session_id.clone(),
                chunk_index: chunk.chunk_index,
                content: chunk.content.clone(),
                char_count: chunk.char_count,
                byte_count: chunk.byte_count,
                chunk_sha256: Some(chunk.chunk_sha256.clone()),
            })
            .collect()
    }

    fn create_input(draft_id: &str) -> CommitLargeTextDraftCreateInput {
        CommitLargeTextDraftCreateInput {
            session_id: String::new(),
            draft_id: draft_id.to_string(),
            novel_id: "novel-1".to_string(),
            chapter_id: "chapter-1".to_string(),
            title: None,
            source: "manual_placeholder".to_string(),
            ai_task_id: None,
            note: None,
        }
    }

    fn table_count(connection: &Connection, table: &str) -> i64 {
        connection
            .query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |row| {
                row.get(0)
            })
            .unwrap()
    }

    #[test]
    fn legacy_large_text_draft_write_commands_fail_closed() {
        let create_error = commit_large_text_draft_create(create_input("draft-disabled"))
            .err()
            .expect("legacy create must be rejected");
        assert!(create_error.contains("WORKSPACE_SAVE_FAILED"));

        let update_error = commit_large_text_draft_update(CommitLargeTextDraftUpdateInput {
            session_id: "session-disabled".to_string(),
            draft_id: "draft-disabled".to_string(),
            chapter_id: "chapter-1".to_string(),
            source: Some("user_edited".to_string()),
        })
        .err()
        .expect("legacy update must be rejected");
        assert!(update_error.contains("WORKSPACE_SAVE_FAILED"));
    }

    #[test]
    fn whole_content_hash_mismatch_is_rejected_before_database_writes() {
        let prepared = prepared_text("draft-1", &["第一片🙂\r\n", "second chunk"]);
        let manifest = manifest_for(
            &prepared,
            prepared.chunks.len(),
            Some("invalid".to_string()),
        );

        let error = validate_cached_large_text(manifest, cached_chunks(&prepared)).unwrap_err();

        assert!(error.contains("large_text_content_hash_mismatch"));
        let connection = open_test_connection();
        assert_eq!(table_count(&connection, "large_text_documents"), 0);
        assert_eq!(table_count(&connection, "large_text_chunks"), 0);
        assert_eq!(table_count(&connection, "chapter_drafts"), 0);
    }

    #[test]
    fn missing_and_invalid_chunks_are_rejected() {
        let prepared = prepared_text("draft-1", &["chunk zero", "分片一🙂"]);
        let manifest = manifest_for(
            &prepared,
            prepared.chunks.len(),
            Some(prepared.content_sha256.clone()),
        );
        let mut missing = cached_chunks(&prepared);
        missing.pop();
        let missing_error = validate_cached_large_text(manifest.clone(), missing).unwrap_err();
        assert!(missing_error.contains("large_text_chunk_count_mismatch"));

        let mut invalid = cached_chunks(&prepared);
        invalid[1].chunk_sha256 = Some("invalid".to_string());
        let invalid_error = validate_cached_large_text(manifest, invalid).unwrap_err();
        assert!(invalid_error.contains("large_text_chunk_hash_mismatch"));
    }

    #[test]
    fn failed_draft_create_rolls_back_document_and_chunks() {
        let mut connection = open_test_connection();
        connection
            .execute_batch(
                "CREATE TRIGGER force_draft_insert_failure BEFORE INSERT ON chapter_drafts BEGIN SELECT RAISE(ABORT, 'forced insert failure'); END;",
            )
            .unwrap();
        let prepared = prepared_text("draft-failed", &["正文", "🙂\r\nrollback"]);

        let error = commit_large_text_draft_create_internal(
            &mut connection,
            &prepared,
            &create_input("draft-failed"),
        )
        .unwrap_err();

        assert!(error.contains("large_text_draft_insert_failed"));
        assert_eq!(table_count(&connection, "large_text_documents"), 0);
        assert_eq!(table_count(&connection, "large_text_chunks"), 0);
        assert_eq!(table_count(&connection, "chapter_drafts"), 0);
    }

    #[test]
    fn failed_draft_update_keeps_the_previous_document_and_reference() {
        let mut connection = open_test_connection();
        let original = prepared_text("draft-1", &["original full text"]);
        commit_large_text_draft_create_internal(
            &mut connection,
            &original,
            &create_input("draft-1"),
        )
        .unwrap();
        connection
            .execute_batch(
                "CREATE TRIGGER force_draft_update_failure BEFORE UPDATE ON chapter_drafts BEGIN SELECT RAISE(ABORT, 'forced update failure'); END;",
            )
            .unwrap();
        let replacement = prepared_text("draft-1", &["replacement full text"]);
        let input = CommitLargeTextDraftUpdateInput {
            session_id: replacement.session_id.clone(),
            draft_id: "draft-1".to_string(),
            chapter_id: "chapter-1".to_string(),
            source: None,
        };

        let error = commit_large_text_draft_update_internal(&mut connection, &replacement, &input)
            .unwrap_err();

        assert!(error.contains("large_text_draft_update_failed"));
        assert_eq!(table_count(&connection, "large_text_documents"), 1);
        assert_eq!(table_count(&connection, "large_text_chunks"), 1);
        let current_ref: Option<String> = connection
            .query_row(
                "SELECT large_text_ref_id FROM chapter_drafts WHERE id = 'draft-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(current_ref.as_deref(), Some(original.session_id.as_str()));
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM large_text_documents WHERE id = ?1",
                    params![&replacement.session_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn successful_update_removes_the_old_unreferenced_document() {
        let mut connection = open_test_connection();
        let original = prepared_text("draft-1", &["original"]);
        commit_large_text_draft_create_internal(
            &mut connection,
            &original,
            &create_input("draft-1"),
        )
        .unwrap();
        let replacement = prepared_text("draft-1", &["新的正文🙂\r\n", "ASCII words"]);
        let input = CommitLargeTextDraftUpdateInput {
            session_id: replacement.session_id.clone(),
            draft_id: "draft-1".to_string(),
            chapter_id: "chapter-1".to_string(),
            source: None,
        };

        let updated =
            commit_large_text_draft_update_internal(&mut connection, &replacement, &input).unwrap();

        assert_eq!(updated.content, replacement.full_content);
        assert_eq!(updated.word_count, count_words(&replacement.full_content));
        assert_eq!(table_count(&connection, "large_text_documents"), 1);
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM large_text_documents WHERE id = ?1",
                    params![&original.session_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        assert_eq!(
            read_large_text_document_internal(&connection, &replacement.session_id).unwrap(),
            replacement.full_content
        );
    }

    #[test]
    fn committed_draft_is_not_reported_failed_when_cache_cleanup_warns() {
        let mut connection = open_test_connection();
        let prepared = prepared_text("draft-1", &["committed full text"]);
        commit_large_text_draft_create_internal(
            &mut connection,
            &prepared,
            &create_input("draft-1"),
        )
        .unwrap();

        let warning = cleanup_warning(Err("forced cleanup failure".to_string()));

        assert_eq!(
            warning.as_deref(),
            Some("large_text_cleanup_warning: forced cleanup failure")
        );
        assert_eq!(table_count(&connection, "chapter_drafts"), 1);
        assert_eq!(table_count(&connection, "large_text_documents"), 1);
        assert_eq!(table_count(&connection, "large_text_chunks"), 1);
    }

    #[test]
    fn corrupt_stored_chunk_fails_closed_on_read() {
        let mut connection = open_test_connection();
        let prepared = prepared_text("draft-1", &["完整正文", "🙂\r\nsecond chunk"]);
        commit_large_text_draft_create_internal(
            &mut connection,
            &prepared,
            &create_input("draft-1"),
        )
        .unwrap();
        connection
            .execute(
                "UPDATE large_text_chunks SET content = content || 'corrupt' WHERE document_id = ?1 AND chunk_index = 0",
                params![&prepared.session_id],
            )
            .unwrap();

        let error =
            read_large_text_document_internal(&connection, &prepared.session_id).unwrap_err();

        assert!(error.contains("LARGE_TEXT_HASH_MISMATCH"), "{error}");
    }

    #[test]
    fn unicode_emoji_and_crlf_use_full_content_totals_and_word_count() {
        let mut connection = open_test_connection();
        let content = "中文🙂\r\nASCII words\r\n".repeat(80);
        let split = content
            .char_indices()
            .nth(700)
            .map(|(index, _)| index)
            .unwrap();
        let prepared = prepared_text("draft-1", &[&content[..split], &content[split..]]);

        let draft = commit_large_text_draft_create_internal(
            &mut connection,
            &prepared,
            &create_input("draft-1"),
        )
        .unwrap();

        assert_eq!(draft.content, content);
        assert_eq!(draft.word_count, count_words(&content));
        assert_eq!(draft.word_count, 320);
        let (preview, word_count, total_chars, total_bytes): (String, i64, i64, i64) = connection
            .query_row(
                "SELECT draft.content, draft.word_count, document.total_chars, document.total_bytes FROM chapter_drafts AS draft INNER JOIN large_text_documents AS document ON document.id = draft.large_text_ref_id WHERE draft.id = 'draft-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(preview.chars().count(), 500);
        assert_eq!(word_count, count_words(&content));
        assert_eq!(total_chars, content.chars().count() as i64);
        assert_eq!(total_bytes, content.len() as i64);
        assert_eq!(
            read_large_text_document_internal(&connection, &prepared.session_id).unwrap(),
            content
        );
    }
}
