use crate::errors::{codes, AppError};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

pub const LARGE_TEXT_THRESHOLD_BYTES: usize = 100 * 1024;
const CHUNK_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone)]
pub struct VerifiedContent {
    pub content: String,
    pub content_hash: String,
    pub content_length: usize,
}

pub fn sha256(content: &str) -> String {
    sha256_bytes(content.as_bytes())
}

pub fn sha256_bytes(content: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content);
    format!("{:x}", hasher.finalize())
}

fn chunks(content: &str) -> Vec<&str> {
    if content.is_empty() {
        return vec![""];
    }
    let mut result = Vec::new();
    let mut start = 0;
    let mut bytes = 0;
    for (index, character) in content.char_indices() {
        let character_bytes = character.len_utf8();
        if bytes > 0 && bytes + character_bytes > CHUNK_BYTES {
            result.push(&content[start..index]);
            start = index;
            bytes = 0;
        }
        bytes += character_bytes;
    }
    result.push(&content[start..]);
    result
}

pub fn insert_document(
    connection: &Connection,
    document_id: &str,
    draft_id: &str,
    title: Option<&str>,
    content: &str,
    content_hash: &str,
    now: &str,
) -> Result<(), AppError> {
    insert_document_for_target(
        connection,
        document_id,
        "draft",
        draft_id,
        "content",
        title,
        content,
        content_hash,
        now,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn insert_document_for_target(
    connection: &Connection,
    document_id: &str,
    target_type: &str,
    target_id: &str,
    field_name: &str,
    title: Option<&str>,
    content: &str,
    content_hash: &str,
    now: &str,
) -> Result<(), AppError> {
    let parts = chunks(content);
    connection
        .execute(
            "INSERT INTO large_text_documents
                (id, target_type, target_id, field_name, title, total_chars, total_bytes,
                 chunk_count, content_sha256, storage_type, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'chunked', 'ready', ?10, ?10)",
            params![
                document_id,
                target_type,
                target_id,
                field_name,
                title,
                content.chars().count() as i64,
                content.len() as i64,
                parts.len() as i64,
                content_hash,
                now
            ],
        )
        .map_err(AppError::database)?;

    for (index, part) in parts.into_iter().enumerate() {
        connection
            .execute(
                "INSERT INTO large_text_chunks
                    (document_id, chunk_index, content, char_count, byte_count, chunk_sha256, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    document_id,
                    index as i64,
                    part,
                    part.chars().count() as i64,
                    part.len() as i64,
                    sha256(part),
                    now
                ],
            )
            .map_err(AppError::database)?;
    }
    Ok(())
}

fn read_verified_internal(
    connection: &Connection,
    document_id: &str,
    draft_target: Option<(&str, &str)>,
) -> Result<VerifiedContent, AppError> {
    let document = connection
        .query_row(
            "SELECT target_type, target_id, field_name, total_chars, total_bytes,
                    chunk_count, content_sha256, status
             FROM large_text_documents WHERE id = ?1",
            params![document_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, String>(7)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?;
    let Some((
        target_type,
        target_id,
        field_name,
        total_chars,
        total_bytes,
        chunk_count,
        expected_hash,
        status,
    )) = document
    else {
        return Err(AppError::new(
            codes::LARGE_TEXT_REFERENCE_INVALID,
            "大文本引用不存在",
            true,
        ));
    };
    // v2.1 used draft-id, chapter-id, or NULL depending on when the draft was created.
    // The authoritative relationship remains chapter_drafts.large_text_ref_id=document_id.
    let compatible_target = draft_target.map(|(draft_id, chapter_id)| {
        target_type == "draft"
            && (target_id.is_none()
                || target_id.as_deref() == Some(draft_id)
                || target_id.as_deref() == Some(chapter_id))
            && field_name == "content"
    });
    if compatible_target == Some(false) || status != "ready" {
        return Err(AppError::new(
            codes::LARGE_TEXT_REFERENCE_INVALID,
            "大文本引用关系无效",
            false,
        ));
    }
    let expected_hash = expected_hash.ok_or_else(|| {
        AppError::new(
            codes::LARGE_TEXT_CONTENT_UNAVAILABLE,
            "大文本缺少完整性哈希",
            false,
        )
    })?;

    let mut statement = connection
        .prepare(
            "SELECT chunk_index, content, char_count, byte_count, chunk_sha256
             FROM large_text_chunks WHERE document_id = ?1 ORDER BY chunk_index ASC",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![document_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    if rows.len() as i64 != chunk_count {
        return Err(AppError::new(
            codes::LARGE_TEXT_CHUNK_MISSING,
            "大文本分片数量不完整",
            true,
        )
        .with_details(serde_json::json!({
            "expectedChunkCount": chunk_count,
            "actualChunkCount": rows.len(),
        })));
    }

    let mut content = String::with_capacity(total_bytes.max(0) as usize);
    for (expected_index, (index, chunk, char_count, byte_count, chunk_hash)) in
        rows.into_iter().enumerate()
    {
        if index != expected_index as i64 {
            return Err(AppError::new(
                codes::LARGE_TEXT_CHUNK_MISSING,
                "大文本分片顺序不完整",
                true,
            ));
        }
        let actual_chunk_hash = sha256(&chunk);
        if char_count != chunk.chars().count() as i64
            || byte_count != chunk.len() as i64
            || chunk_hash.as_deref() != Some(actual_chunk_hash.as_str())
        {
            return Err(AppError::new(
                codes::LARGE_TEXT_HASH_MISMATCH,
                "大文本分片完整性校验失败",
                false,
            ));
        }
        content.push_str(&chunk);
    }

    let actual_hash = sha256(&content);
    if content.chars().count() as i64 != total_chars
        || content.len() as i64 != total_bytes
        || !actual_hash.eq_ignore_ascii_case(&expected_hash)
    {
        return Err(AppError::new(
            codes::LARGE_TEXT_HASH_MISMATCH,
            "大文本完整性校验失败",
            false,
        )
        .with_details(serde_json::json!({
            "expectedHash": expected_hash,
            "actualHash": actual_hash,
        })));
    }
    Ok(VerifiedContent {
        content_length: content.chars().count(),
        content,
        content_hash: actual_hash,
    })
}

pub fn read_verified_for_draft(
    connection: &Connection,
    document_id: &str,
    draft_id: &str,
    chapter_id: &str,
) -> Result<VerifiedContent, AppError> {
    read_verified_internal(connection, document_id, Some((draft_id, chapter_id)))
}

pub fn read_verified_document(
    connection: &Connection,
    document_id: &str,
) -> Result<VerifiedContent, AppError> {
    read_verified_internal(connection, document_id, None)
}

pub fn validate_document_target(
    connection: &Connection,
    document_id: &str,
    expected_target_type: &str,
    expected_target_id: &str,
    expected_field_name: &str,
) -> Result<(), AppError> {
    let matches: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM large_text_documents
             WHERE id = ?1 AND target_type = ?2 AND target_id = ?3 AND field_name = ?4",
            params![
                document_id,
                expected_target_type,
                expected_target_id,
                expected_field_name
            ],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if matches != 1 {
        return Err(AppError::new(
            codes::LARGE_TEXT_REFERENCE_INVALID,
            "大文本引用关系无效",
            false,
        ));
    }
    Ok(())
}

pub fn delete_if_unreferenced(connection: &Connection, document_id: &str) -> Result<(), AppError> {
    let draft_references: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM chapter_drafts WHERE large_text_ref_id = ?1",
            params![document_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    let recovery_references: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM workspace_recovery_snapshots WHERE large_text_ref_id = ?1",
            params![document_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    let ai_references: i64 = connection
        .query_row(
            "SELECT
                (SELECT COUNT(*) FROM ai_input_snapshots WHERE body_ref_id = ?1) +
                (SELECT COUNT(*) FROM ai_context_snapshots WHERE compiled_context_ref_id = ?1) +
                (SELECT COUNT(*) FROM ai_constraint_snapshots WHERE prompt_template_ref_id = ?1) +
                (SELECT COUNT(*) FROM result_artifacts
                 WHERE raw_content_ref_id = ?1 OR display_content_ref_id = ?1
                    OR structured_payload_ref_id = ?1)",
            params![document_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    let reference_library_references: i64 = connection
        .query_row(
            "SELECT
                (SELECT COUNT(*) FROM reference_imports WHERE large_text_ref_id = ?1) +
                (SELECT COUNT(*) FROM reference_sections WHERE large_text_ref_id = ?1)",
            params![document_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if draft_references == 0
        && recovery_references == 0
        && ai_references == 0
        && reference_library_references == 0
    {
        connection
            .execute(
                "DELETE FROM large_text_documents WHERE id = ?1",
                params![document_id],
            )
            .map_err(AppError::database)?;
    }
    Ok(())
}
