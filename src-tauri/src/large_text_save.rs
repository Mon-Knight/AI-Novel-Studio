use crate::db::get_connection;
use rusqlite::params;
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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbortLargeTextSaveInput {
    pub session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
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

// ==================== Cache Directory ====================

fn get_cache_dir() -> PathBuf {
    let base = crate::db::get_data_dir();
    base.join("save_cache")
}

fn session_cache_dir(session_id: &str) -> PathBuf {
    get_cache_dir().join(session_id)
}

fn manifest_path(session_id: &str) -> PathBuf {
    session_cache_dir(session_id).join("manifest.json")
}

fn chunk_path(session_id: &str, chunk_index: usize) -> PathBuf {
    session_cache_dir(session_id).join(format!("chunk_{:06}.json", chunk_index))
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
    let cache_dir = session_cache_dir(&session_id);

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
        total_chunks: input.total_chunks,
        total_chars: input.total_chars,
        total_bytes: input.total_bytes,
        content_sha256,
        created_at: now.clone(),
        updated_at: now,
    };

    let manifest_json = serde_json::to_string_pretty(&session)
        .map_err(|e| format!("序列化 manifest 失败: {}", e))?;

    fs::write(manifest_path(&session_id), manifest_json)
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
    let cache_dir = session_cache_dir(&input.session_id);
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

    // Check for duplicate chunk (don't allow overwrite by default, but allow re-upload)
    let cpath = chunk_path(&input.session_id, input.chunk_index);
    if cpath.exists() {
        // Remove old chunk to allow re-upload
        fs::remove_file(&cpath).map_err(|e| format!("无法移除旧分片: {}", e))?;
    }

    // Verify chunk SHA-256 if provided
    if let Some(ref expected_sha256) = input.chunk_sha256 {
        let actual_sha256 = compute_sha256(&input.content);
        if actual_sha256 != *expected_sha256 {
            return Err(format!(
                "分片 {} SHA-256 校验失败: expected={}, actual={}",
                input.chunk_index, expected_sha256, actual_sha256
            ));
        }
    }

    // Write chunk to temp file
    let chunk_json = serde_json::to_string(&serde_json::json!({
        "session_id": input.session_id,
        "chunk_index": input.chunk_index,
        "content": input.content,
        "char_count": input.char_count,
        "byte_count": input.byte_count,
        "chunk_sha256": input.chunk_sha256,
    }))
    .map_err(|e| format!("序列化分片失败: {}", e))?;

    fs::write(&cpath, chunk_json).map_err(|e| format!("写入分片文件失败: {}", e))?;

    // Count saved chunks
    let saved_count = count_saved_chunks(&cache_dir)?;

    Ok(AppendLargeTextChunkOutput {
        session_id: input.session_id,
        chunk_index: input.chunk_index,
        saved_count,
        total_chunks: manifest.total_chunks,
    })
}

#[tauri::command]
pub fn finalize_large_text_save(
    input: FinalizeLargeTextSaveInput,
) -> Result<FinalizeLargeTextSaveOutput, String> {
    let manifest = load_manifest(&input.session_id)?;
    if manifest.target_type == "draft" || manifest.target_type == "chapter_draft" {
        return Err(
            "WORKSPACE_SAVE_FAILED: 草稿正文必须通过 save_chapter_draft_atomic 提交".to_string(),
        );
    }

    // Verify all chunks exist and are valid
    let _cache_dir = session_cache_dir(&input.session_id);
    let mut chunks_content: Vec<(usize, String)> = Vec::new();

    for i in 0..manifest.total_chunks {
        let cpath = chunk_path(&input.session_id, i);
        if !cpath.exists() {
            return Err(format!(
                "分片 {} 缺失，无法完成保存。已保存 {}/{} 个分片",
                i,
                chunks_content.len(),
                manifest.total_chunks
            ));
        }

        let chunk_raw =
            fs::read_to_string(&cpath).map_err(|e| format!("读取分片 {} 失败: {}", i, e))?;

        let chunk_json: serde_json::Value = serde_json::from_str(&chunk_raw)
            .map_err(|e| format!("解析分片 {} JSON 失败: {}", i, e))?;

        let content = chunk_json["content"]
            .as_str()
            .ok_or_else(|| format!("分片 {} 缺少 content 字段", i))?
            .to_string();

        chunks_content.push((i, content));
    }

    // Sort by chunk_index
    chunks_content.sort_by_key(|(idx, _)| *idx);

    // Concatenate all chunks
    let full_content: String = chunks_content
        .into_iter()
        .map(|(_, content)| content)
        .collect();

    // Verify full content SHA-256 if provided
    if let Some(ref expected_sha256) = manifest.content_sha256 {
        let actual_sha256 = compute_sha256(&full_content);
        if actual_sha256 != *expected_sha256 {
            return Err(format!(
                "LARGE_TEXT_HASH_MISMATCH: expected={}, actual={}",
                expected_sha256, actual_sha256
            ));
        }
    }

    // Write to database in a blocking transaction
    let document_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    // Insert large_text_documents (error -> rollback)
    if let Err(e) = tx.execute(
        "INSERT INTO large_text_documents (id, target_type, target_id, field_name, title, total_chars, total_bytes, chunk_count, content_sha256, storage_type, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'chunked', ?10, ?10)",
        params![
            &document_id,
            &manifest.target_type,
            &manifest.target_id,
            &manifest.field_name,
            &None::<String>,
            manifest.total_chars as i64,
            manifest.total_bytes as i64,
            manifest.total_chunks as i64,
            &manifest.content_sha256,
            &now,
        ],
    ) {
        let _ = tx.rollback();
        return Err(format!("写入 large_text_documents 失败: {}", e));
    }

    // Re-read chunks from files to insert into DB
    for i in 0..manifest.total_chunks {
        let cpath = chunk_path(&input.session_id, i);
        let chunk_raw = match fs::read_to_string(&cpath) {
            Ok(raw) => raw,
            Err(e) => {
                let _ = tx.rollback();
                return Err(format!("读取分片 {} 进行数据库写入失败: {}", i, e));
            }
        };

        let chunk_json: serde_json::Value = match serde_json::from_str(&chunk_raw) {
            Ok(json) => json,
            Err(e) => {
                let _ = tx.rollback();
                return Err(format!("解析分片 {} JSON 进行数据库写入失败: {}", i, e));
            }
        };

        let content = chunk_json["content"].as_str().unwrap_or("").to_string();
        let char_count = chunk_json["char_count"].as_u64().unwrap_or(0) as i64;
        let byte_count = chunk_json["byte_count"].as_u64().unwrap_or(0) as i64;
        let chunk_sha256 = chunk_json["chunk_sha256"].as_str().map(|s| s.to_string());

        if let Err(e) = tx.execute(
            "INSERT INTO large_text_chunks (document_id, chunk_index, content, char_count, byte_count, chunk_sha256, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                &document_id,
                i as i64,
                &content,
                char_count,
                byte_count,
                &chunk_sha256,
                &now,
            ],
        ) {
            let _ = tx.rollback();
            return Err(format!("写入分片 {} 到数据库失败: {}", i, e));
        }
    }

    // Commit transaction
    tx.commit().map_err(|e| format!("提交事务失败: {}", e))?;

    // Clean up cache directory
    if let Err(error) = cleanup_session_cache(&input.session_id) {
        crate::errors::log_workspace_event(crate::errors::WorkspaceLogEvent {
            level: "warn",
            event: "legacy_large_text_post_commit_cleanup_failed",
            trace_id: None,
            operation_id: None,
            novel_id: None,
            chapter_id: None,
            draft_id: None,
            error_code: None,
            metadata: Some(serde_json::json!({ "maintenanceError": error })),
        });
    }

    Ok(FinalizeLargeTextSaveOutput {
        document_id,
        total_chars: manifest.total_chars,
        total_bytes: manifest.total_bytes,
        chunk_count: manifest.total_chunks,
    })
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
    crate::repositories::large_text_repository::read_verified_document(&conn, document_id)
        .map(|verified| verified.content)
        .map_err(|error| serde_json::to_string(&error).unwrap_or_else(|_| error.to_string()))
}

/// Check if content is stored as chunked large text (returns document_id if so)
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
    let mpath = manifest_path(session_id);
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
    let cache_dir = session_cache_dir(session_id);
    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir).map_err(|e| format!("清理缓存目录失败: {}", e))?;
    }
    Ok(())
}

// ==================== Database Initialization ====================
