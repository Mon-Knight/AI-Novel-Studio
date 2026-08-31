use crate::domain::{
    context::{ChapterSummaryDto, ContextRecordDto},
    writing::ChapterDraftDto,
};
use crate::errors::{codes, AppError};
use crate::repositories::{draft_repository, large_text_repository, memory_repository};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

const MAX_DOCUMENT_CHUNKS: usize = 10_000;
const MAX_CHUNK_BYTES: usize = 128 * 1024;
const MAX_TOTAL_DOCUMENT_BYTES: usize = 64 * 1024 * 1024;
const MAX_EMBEDDING_DIMENSION: usize = 8192;
const MAX_CANDIDATES: i64 = 500;
const MAX_FETCH_CANDIDATES: i64 = 2000;
const MAX_TOP_K: i64 = 50;
const MAX_TOKEN_BUDGET: i64 = 100_000;
const MATERIALIZED_CHUNK_UTF16_UNITS: usize = 1_800;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryChunkInput {
    pub id: String,
    pub ordinal: i64,
    pub text: String,
    pub token_count: i64,
    pub importance: f64,
    #[serde(default)]
    pub chapter_order_index: Option<i64>,
    #[serde(default)]
    pub temporal_start_chapter: Option<i64>,
    #[serde(default)]
    pub temporal_end_chapter: Option<i64>,
    #[serde(default)]
    pub entity_keys: Vec<String>,
    #[serde(default = "empty_object")]
    pub metadata: Value,
    pub content_hash: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutMemoryDocumentInput {
    #[serde(default)]
    pub trace_id: Option<String>,
    pub document_id: String,
    pub novel_id: String,
    pub source_type: String,
    pub source_id: String,
    pub source_version: i64,
    pub source_hash: String,
    #[serde(default)]
    pub adopted_draft_id: Option<String>,
    #[serde(default)]
    pub chapter_id: Option<String>,
    #[serde(default = "empty_object")]
    pub metadata: Value,
    pub chunks: Vec<MemoryChunkInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PutMemoryDocumentOutput {
    pub document: memory_repository::MemoryDocument,
    pub chunks: Vec<memory_repository::MemoryChunk>,
    pub created: bool,
    pub invalidated_document_count: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEmbeddingItemInput {
    pub chunk_id: String,
    pub vector: Vec<f32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutMemoryEmbeddingsInput {
    #[serde(default)]
    pub trace_id: Option<String>,
    pub novel_id: String,
    pub provider: String,
    pub model: String,
    pub dimension: i64,
    pub items: Vec<MemoryEmbeddingItemInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEmbeddingOutput {
    pub id: String,
    pub chunk_id: String,
    pub provider: String,
    pub model: String,
    pub dimension: i64,
    pub vector_hash: String,
    pub chunk_content_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PutMemoryEmbeddingsOutput {
    pub embeddings: Vec<MemoryEmbeddingOutput>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRetrievalFilters {
    #[serde(default)]
    pub chapter_id: Option<String>,
    #[serde(default)]
    pub chapter_start: Option<i64>,
    #[serde(default)]
    pub chapter_end: Option<i64>,
    #[serde(default)]
    pub source_types: Vec<String>,
    #[serde(default)]
    pub entity_keys: Vec<String>,
    #[serde(default)]
    pub min_importance: Option<f64>,
    #[serde(default)]
    pub temporal_chapter: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryEmbeddingInput {
    pub provider: String,
    pub model: String,
    pub dimension: i64,
    pub vector: Vec<f32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrieveMemoryInput {
    #[serde(default)]
    pub trace_id: Option<String>,
    pub request_id: String,
    pub novel_id: String,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub query_embedding: Option<QueryEmbeddingInput>,
    #[serde(default)]
    pub filters: MemoryRetrievalFilters,
    #[serde(default = "default_top_k")]
    pub top_k: i64,
    #[serde(default)]
    pub offset: i64,
    #[serde(default = "default_candidate_limit")]
    pub candidate_limit: i64,
    #[serde(default = "default_token_budget")]
    pub token_budget: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryScoreReason {
    pub matched_by: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lexical_score: Option<f64>,
    pub importance_score: f64,
    pub recency_score: f64,
    pub final_score: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRetrievalItem {
    pub chunk_id: String,
    pub document_id: String,
    pub text: String,
    pub token_count: i64,
    pub content_hash: String,
    pub source_type: String,
    pub source_id: String,
    pub source_version: i64,
    pub source_hash: String,
    pub adopted_draft_id: Option<String>,
    pub chapter_id: Option<String>,
    pub chapter_order_index: Option<i64>,
    pub entity_keys: Vec<String>,
    pub metadata: Value,
    pub score: MemoryScoreReason,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrieveMemoryOutput {
    pub request_id: String,
    pub retrieval_mode: String,
    pub fts_available: bool,
    pub semantic_candidate_count: usize,
    pub candidate_count: usize,
    pub used_tokens: i64,
    pub token_budget: i64,
    pub offset: i64,
    pub next_offset: i64,
    pub has_more: bool,
    pub items: Vec<MemoryRetrievalItem>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMemoryDocumentsInput {
    pub novel_id: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub offset: i64,
    #[serde(default = "default_page_limit")]
    pub limit: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDocumentPage {
    pub total: i64,
    pub offset: i64,
    pub limit: i64,
    pub items: Vec<memory_repository::MemoryDocument>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvalidateMemoryDocumentInput {
    #[serde(default)]
    pub trace_id: Option<String>,
    pub novel_id: String,
    pub document_id: String,
    pub expected_source_hash: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvalidateMemoryDocumentOutput {
    pub invalidated: bool,
}

#[derive(Debug)]
struct RankedCandidate {
    candidate: memory_repository::MemoryCandidate,
    entity_keys: Vec<String>,
    metadata: Value,
    reason: MemoryScoreReason,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PersistDocumentMode {
    Strict,
    ReplaceActiveSource,
}

fn empty_object() -> Value {
    json!({})
}

fn default_top_k() -> i64 {
    10
}

fn default_candidate_limit() -> i64 {
    200
}

fn default_token_budget() -> i64 {
    8_000
}

fn default_page_limit() -> i64 {
    50
}

fn memory_error(code: &'static str, message: &'static str) -> AppError {
    AppError::new(code, message, false)
}

fn with_trace(error: AppError, trace_id: Option<&str>) -> AppError {
    error.with_context(trace_id, None)
}

fn validate_id(label: &str, value: &str) -> Result<(), AppError> {
    if value.trim().is_empty() || value.len() > 200 {
        return Err(memory_error(codes::MEMORY_INPUT_INVALID, "Memory 标识无效")
            .with_details(json!({ "field": label })));
    }
    Ok(())
}

fn validate_hash(label: &str, value: &str) -> Result<(), AppError> {
    if value.len() != 64
        || !value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(
            memory_error(codes::MEMORY_HASH_MISMATCH, "Memory 内容哈希无效")
                .with_details(json!({ "field": label })),
        );
    }
    Ok(())
}

fn validate_json_object(label: &str, value: &Value, max_bytes: usize) -> Result<String, AppError> {
    if !value.is_object() {
        return Err(
            memory_error(codes::MEMORY_INPUT_INVALID, "Memory 元数据必须是 JSON 对象")
                .with_details(json!({ "field": label })),
        );
    }
    let serialized = serde_json::to_string(value)
        .map_err(|_| memory_error(codes::MEMORY_INPUT_INVALID, "Memory 元数据序列化失败"))?;
    if serialized.len() > max_bytes {
        return Err(
            memory_error(codes::MEMORY_INPUT_INVALID, "Memory 元数据超过大小限制")
                .with_details(json!({ "field": label, "maxBytes": max_bytes })),
        );
    }
    Ok(serialized)
}

fn validate_source_type(source_type: &str) -> Result<(), AppError> {
    if matches!(
        source_type,
        "adopted_draft" | "chapter_summary" | "context_record"
    ) {
        Ok(())
    } else {
        Err(
            memory_error(codes::MEMORY_SOURCE_INVALID, "Memory 来源类型尚未注册")
                .with_details(json!({ "sourceType": source_type })),
        )
    }
}

fn validate_model_identity(provider: &str, model: &str, dimension: i64) -> Result<(), AppError> {
    if provider.trim().is_empty()
        || provider.len() > 80
        || model.trim().is_empty()
        || model.len() > 160
        || dimension < 1
        || dimension as usize > MAX_EMBEDDING_DIMENSION
    {
        return Err(memory_error(
            codes::MEMORY_EMBEDDING_INVALID,
            "Embedding 模型身份或维度无效",
        ));
    }
    Ok(())
}

fn vector_norm(vector: &[f32], dimension: i64) -> Result<f64, AppError> {
    if vector.len() != dimension as usize {
        return Err(memory_error(
            codes::MEMORY_EMBEDDING_DIMENSION_MISMATCH,
            "Embedding 向量维度与模型身份不一致",
        )
        .with_details(json!({
            "expectedDimension": dimension,
            "actualDimension": vector.len(),
        })));
    }
    let mut squared = 0.0f64;
    for value in vector {
        if !value.is_finite() {
            return Err(memory_error(
                codes::MEMORY_EMBEDDING_INVALID,
                "Embedding 向量包含非有限数值",
            ));
        }
        let value = f64::from(*value);
        squared += value * value;
    }
    let norm = squared.sqrt();
    if !norm.is_finite() || norm <= f64::EPSILON {
        return Err(memory_error(
            codes::MEMORY_EMBEDDING_INVALID,
            "Embedding 向量范数无效",
        ));
    }
    Ok(norm)
}

fn vector_hash(vector: &[f32]) -> String {
    let mut hasher = Sha256::new();
    hasher.update((vector.len() as u64).to_le_bytes());
    for value in vector {
        hasher.update(value.to_le_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn validate_current_adopted_draft(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
    adopted_draft_id: &str,
) -> Result<(), AppError> {
    let pointer = connection
        .query_row(
            "SELECT adopted_draft_id FROM chapters
             WHERE id = ?1 AND novel_id = ?2 AND deleted_at IS NULL",
            params![chapter_id, novel_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(AppError::database)?
        .flatten();
    if pointer.as_deref() != Some(adopted_draft_id) {
        return Err(memory_error(
            codes::MEMORY_SOURCE_STALE,
            "Memory 来源已不是章节当前采用稿",
        )
        .with_details(json!({
            "chapterId": chapter_id,
            "expectedAdoptedDraftId": adopted_draft_id,
            "actualAdoptedDraftId": pointer,
        })));
    }
    Ok(())
}

fn validate_derived_source_provenance(
    connection: &Connection,
    input: &PutMemoryDocumentInput,
    chapter_id: &str,
    adopted_draft_id: &str,
) -> Result<(), AppError> {
    let draft = draft_repository::find_draft(connection, adopted_draft_id)?
        .ok_or_else(|| memory_error(codes::MEMORY_SOURCE_INVALID, "Memory 来源采用稿不存在"))?;
    if draft.novel_id != input.novel_id
        || draft.chapter_id != chapter_id
        || !draft.is_adopted
        || draft.version_no != input.source_version
    {
        return Err(memory_error(
            codes::MEMORY_SOURCE_STALE,
            "Memory 来源采用稿归属或版本已变化",
        ));
    }
    let verified = crate::services::draft_service::load_full_content(connection, &draft)?;
    if !verified
        .content_hash
        .eq_ignore_ascii_case(&input.source_hash)
    {
        return Err(
            memory_error(codes::MEMORY_HASH_MISMATCH, "Memory 来源采用稿哈希已变化").with_details(
                json!({
                    "expectedHash": input.source_hash,
                    "actualHash": verified.content_hash,
                }),
            ),
        );
    }
    Ok(())
}

fn validate_source(
    connection: &Connection,
    input: &PutMemoryDocumentInput,
) -> Result<(), AppError> {
    validate_source_type(&input.source_type)?;
    let chapter_id = input
        .chapter_id
        .as_deref()
        .ok_or_else(|| memory_error(codes::MEMORY_SOURCE_INVALID, "Memory 来源缺少章节身份"))?;
    let adopted_draft_id = input
        .adopted_draft_id
        .as_deref()
        .ok_or_else(|| memory_error(codes::MEMORY_SOURCE_INVALID, "Memory 来源缺少采用稿身份"))?;

    match input.source_type.as_str() {
        "adopted_draft" => {
            if input.source_id != adopted_draft_id {
                return Err(memory_error(
                    codes::MEMORY_SOURCE_INVALID,
                    "采用稿 Memory 的来源身份不一致",
                ));
            }
            let draft =
                draft_repository::find_draft(connection, &input.source_id)?.ok_or_else(|| {
                    memory_error(codes::MEMORY_SOURCE_INVALID, "Memory 来源草稿不存在")
                })?;
            if draft.novel_id != input.novel_id
                || draft.chapter_id != chapter_id
                || !draft.is_adopted
                || draft.version_no != input.source_version
            {
                return Err(memory_error(
                    codes::MEMORY_SOURCE_INVALID,
                    "Memory 来源草稿归属或版本无效",
                ));
            }
            let verified = crate::services::draft_service::load_full_content(connection, &draft)?;
            if !verified
                .content_hash
                .eq_ignore_ascii_case(&input.source_hash)
            {
                return Err(
                    memory_error(codes::MEMORY_HASH_MISMATCH, "Memory 来源草稿哈希已变化")
                        .with_details(json!({
                            "expectedHash": input.source_hash,
                            "actualHash": verified.content_hash,
                        })),
                );
            }
        }
        "chapter_summary" => {
            let source = connection
                .query_row(
                    "SELECT novel_id, chapter_id, adopted_draft_id, content_hash,
                            draft_version, is_expired, enabled
                     FROM chapter_summaries WHERE id = ?1",
                    params![input.source_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, Option<i64>>(4)?,
                            row.get::<_, i64>(5)?,
                            row.get::<_, i64>(6)?,
                        ))
                    },
                )
                .optional()
                .map_err(AppError::database)?
                .ok_or_else(|| {
                    memory_error(codes::MEMORY_SOURCE_INVALID, "Memory 来源章节总结不存在")
                })?;
            if source.0 != input.novel_id
                || source.1 != chapter_id
                || source.2 != adopted_draft_id
                || source.3.as_deref() != Some(input.source_hash.as_str())
                || source.4 != Some(input.source_version)
                || source.5 != 0
                || source.6 != 1
            {
                return Err(memory_error(
                    codes::MEMORY_SOURCE_STALE,
                    "Memory 来源章节总结已失效或版本不一致",
                ));
            }
        }
        "context_record" => {
            let source = connection
                .query_row(
                    "SELECT novel_id, chapter_id, content_hash, draft_version,
                            is_expired, is_active
                     FROM context_records WHERE id = ?1",
                    params![input.source_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, Option<i64>>(3)?,
                            row.get::<_, i64>(4)?,
                            row.get::<_, i64>(5)?,
                        ))
                    },
                )
                .optional()
                .map_err(AppError::database)?
                .ok_or_else(|| {
                    memory_error(codes::MEMORY_SOURCE_INVALID, "Memory 来源上下文不存在")
                })?;
            if source.0 != input.novel_id
                || source.1.as_deref() != Some(chapter_id)
                || source.2.as_deref() != Some(input.source_hash.as_str())
                || source.3 != Some(input.source_version)
                || source.4 != 0
                || source.5 != 1
            {
                return Err(memory_error(
                    codes::MEMORY_SOURCE_STALE,
                    "Memory 来源上下文已失效或版本不一致",
                ));
            }
        }
        _ => unreachable!(),
    }
    validate_current_adopted_draft(connection, &input.novel_id, chapter_id, adopted_draft_id)?;
    if input.source_type != "adopted_draft" {
        validate_derived_source_provenance(connection, input, chapter_id, adopted_draft_id)?;
    }
    Ok(())
}

fn build_chunks(
    input: &PutMemoryDocumentInput,
    now: &str,
) -> Result<Vec<memory_repository::MemoryChunk>, AppError> {
    if input.chunks.is_empty() || input.chunks.len() > MAX_DOCUMENT_CHUNKS {
        return Err(memory_error(
            codes::MEMORY_INPUT_INVALID,
            "Memory 分块数量无效",
        ));
    }
    let mut ids = HashSet::new();
    let mut total_bytes = 0usize;
    let mut chunks = Vec::with_capacity(input.chunks.len());
    for (expected_ordinal, item) in input.chunks.iter().enumerate() {
        validate_id("chunkId", &item.id)?;
        if !ids.insert(item.id.as_str()) || item.ordinal != expected_ordinal as i64 {
            return Err(memory_error(
                codes::MEMORY_INPUT_INVALID,
                "Memory 分块标识重复或序号不连续",
            ));
        }
        if item.text.trim().is_empty() || item.text.len() > MAX_CHUNK_BYTES {
            return Err(memory_error(
                codes::MEMORY_INPUT_INVALID,
                "Memory 分块正文为空或超过大小限制",
            ));
        }
        total_bytes = total_bytes.saturating_add(item.text.len());
        if total_bytes > MAX_TOTAL_DOCUMENT_BYTES
            || item.token_count < 1
            || item.token_count > MAX_TOKEN_BUDGET
            || !item.importance.is_finite()
            || !(0.0..=1.0).contains(&item.importance)
            || item.chapter_order_index.is_some_and(|value| value < 0)
            || item.temporal_start_chapter.is_some_and(|value| value < 0)
            || item.temporal_end_chapter.is_some_and(|value| value < 0)
            || matches!(
                (item.temporal_start_chapter, item.temporal_end_chapter),
                (Some(start), Some(end)) if end < start
            )
        {
            return Err(memory_error(
                codes::MEMORY_INPUT_INVALID,
                "Memory 分块范围、权重或 Token 统计无效",
            ));
        }
        validate_hash("chunk.contentHash", &item.content_hash)?;
        let actual_hash = large_text_repository::sha256(&item.text);
        if actual_hash != item.content_hash {
            return Err(
                memory_error(codes::MEMORY_HASH_MISMATCH, "Memory 分块正文哈希不一致")
                    .with_details(json!({
                        "chunkId": item.id,
                        "expectedHash": item.content_hash,
                        "actualHash": actual_hash,
                    })),
            );
        }
        if item.entity_keys.len() > 64
            || item
                .entity_keys
                .iter()
                .any(|key| key.trim().is_empty() || key.len() > 160)
        {
            return Err(memory_error(
                codes::MEMORY_INPUT_INVALID,
                "Memory 实体键无效",
            ));
        }
        let mut entity_keys = item
            .entity_keys
            .iter()
            .map(|key| key.trim().to_string())
            .collect::<Vec<_>>();
        entity_keys.sort();
        entity_keys.dedup();
        let entity_keys_json = serde_json::to_string(&entity_keys)
            .map_err(|_| memory_error(codes::MEMORY_INPUT_INVALID, "Memory 实体键序列化失败"))?;
        let metadata_json = validate_json_object("chunk.metadata", &item.metadata, 32 * 1024)?;
        chunks.push(memory_repository::MemoryChunk {
            id: item.id.clone(),
            document_id: input.document_id.clone(),
            novel_id: input.novel_id.clone(),
            chapter_id: input.chapter_id.clone(),
            ordinal: item.ordinal,
            text: item.text.clone(),
            token_count: item.token_count,
            importance: item.importance,
            chapter_order_index: item.chapter_order_index,
            temporal_start_chapter: item.temporal_start_chapter,
            temporal_end_chapter: item.temporal_end_chapter,
            entity_keys_json,
            metadata_json,
            content_hash: item.content_hash.clone(),
            created_at: now.to_string(),
        });
    }
    Ok(chunks)
}

fn split_by_utf16_limit(text: &str, limit: usize) -> Vec<String> {
    let mut pieces = Vec::new();
    let mut start = 0usize;
    let mut units = 0usize;
    for (index, character) in text.char_indices() {
        let character_units = character.len_utf16();
        if units > 0 && units + character_units > limit {
            pieces.push(text[start..index].to_string());
            start = index;
            units = 0;
        }
        units += character_units;
    }
    if start < text.len() {
        pieces.push(text[start..].to_string());
    }
    pieces
}

fn chunk_adopted_draft_content(content: &str) -> Vec<String> {
    let normalized = content.replace("\r\n", "\n");
    let normalized = normalized.trim();
    if normalized.is_empty() {
        return Vec::new();
    }

    let paragraphs = normalized
        .split("\n\n")
        .map(str::trim)
        .filter(|paragraph| !paragraph.is_empty());
    let mut chunks = Vec::new();
    let mut buffer = String::new();
    for paragraph in paragraphs {
        for (piece_index, piece) in split_by_utf16_limit(paragraph, MATERIALIZED_CHUNK_UTF16_UNITS)
            .into_iter()
            .enumerate()
        {
            let separator = if piece_index == 0 && !buffer.is_empty() {
                "\n\n"
            } else {
                ""
            };
            let combined_len = buffer.encode_utf16().count()
                + separator.encode_utf16().count()
                + piece.encode_utf16().count();
            if !buffer.is_empty() && combined_len > MATERIALIZED_CHUNK_UTF16_UNITS {
                chunks.push(std::mem::take(&mut buffer));
            } else {
                buffer.push_str(separator);
            }
            buffer.push_str(&piece);
        }
    }
    if !buffer.is_empty() {
        chunks.push(buffer);
    }
    chunks
}

fn chunk_derived_memory_content(content: &str) -> Vec<String> {
    let content = content.trim();
    if content.is_empty() {
        Vec::new()
    } else {
        split_by_utf16_limit(content, MATERIALIZED_CHUNK_UTF16_UNITS)
    }
}

fn memory_token_count(text: &str) -> i64 {
    let counted_words = crate::repositories::chapter_repository::count_words(text);
    if counted_words > 0 {
        counted_words
    } else {
        text.chars().count().max(1) as i64
    }
}

fn materialization_hash(
    connection: &Connection,
    novel_id: &str,
    source_type: &str,
    source_id: &str,
    document_prefix: &str,
    identity_hash: String,
) -> Result<String, AppError> {
    let base_document_id = format!("{document_prefix}{identity_hash}");
    match memory_repository::find_document(connection, novel_id, &base_document_id)? {
        Some(document) if document.status == "invalidated" => {
            let prior_document_count = connection
                .query_row(
                    "SELECT COUNT(*) FROM memory_documents
                     WHERE novel_id=?1 AND source_type=?2 AND source_id=?3",
                    params![novel_id, source_type, source_id],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(AppError::database)?;
            Ok(large_text_repository::sha256(&format!(
                "{identity_hash}\nmaterialization:{}",
                prior_document_count.max(1)
            )))
        }
        _ => Ok(identity_hash),
    }
}

fn chapter_sequence_index(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
) -> Result<i64, AppError> {
    connection
        .query_row(
            "WITH ordered AS (
                SELECT c.id,
                       ROW_NUMBER() OVER (
                           ORDER BY
                               CASE
                                   WHEN c.volume_id IS NULL THEN -1
                                   ELSE COALESCE(v.order_index, 2147483647)
                               END,
                               COALESCE(v.id, ''),
                               c.order_index,
                               c.created_at,
                               c.id
                       ) - 1 AS sequence_index
                  FROM chapters c
             LEFT JOIN volumes v
                    ON v.id = c.volume_id
                   AND v.novel_id = c.novel_id
                   AND v.deleted_at IS NULL
                 WHERE c.novel_id = ?1
                   AND c.deleted_at IS NULL
            )
            SELECT sequence_index FROM ordered WHERE id = ?2",
            params![novel_id, chapter_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)
}

pub(crate) fn put_review_adopted_draft_in_transaction(
    connection: &Connection,
    draft: &ChapterDraftDto,
    full_content: &str,
    authorization_id: &str,
    now: &str,
) -> Result<PutMemoryDocumentOutput, AppError> {
    validate_id("authorizationId", authorization_id)?;
    let chapter_sequence_index =
        chapter_sequence_index(connection, &draft.novel_id, &draft.chapter_id)?;
    let identity_hash = large_text_repository::sha256(&format!(
        "review_authorization:{authorization_id}\ndraft:{}",
        draft.id
    ));
    let document_id = format!("mem-adopted-review-{identity_hash}");
    let pieces = chunk_adopted_draft_content(full_content);
    let chunks = pieces
        .into_iter()
        .enumerate()
        .map(|(ordinal, text)| MemoryChunkInput {
            id: format!("chk-review-{}-{ordinal}", &identity_hash[..32]),
            ordinal: ordinal as i64,
            token_count: memory_token_count(&text),
            content_hash: large_text_repository::sha256(&text),
            text,
            importance: 0.85,
            chapter_order_index: Some(chapter_sequence_index),
            temporal_start_chapter: Some(chapter_sequence_index),
            temporal_end_chapter: None,
            entity_keys: Vec::new(),
            metadata: json!({ "source": "adopted_draft" }),
        })
        .collect();
    let input = PutMemoryDocumentInput {
        trace_id: None,
        document_id,
        novel_id: draft.novel_id.clone(),
        source_type: "adopted_draft".to_string(),
        source_id: draft.id.clone(),
        source_version: draft.version_no,
        source_hash: large_text_repository::sha256(full_content),
        adopted_draft_id: Some(draft.id.clone()),
        chapter_id: Some(draft.chapter_id.clone()),
        metadata: json!({
            "title": draft.title.clone().unwrap_or_default(),
            "versionNo": draft.version_no,
        }),
        chunks,
    };
    persist_document_in_transaction(connection, input, now, PersistDocumentMode::Strict)
}

fn chapter_summary_memory_text(summary: &ChapterSummaryDto) -> String {
    let mut sections = vec![format!("章节摘要：{}", summary.summary.trim())];
    for (label, value) in [
        ("关键事件", summary.key_events.as_deref()),
        ("人物变化", summary.character_changes.as_deref()),
        ("关系变化", summary.relationship_changes.as_deref()),
        ("新增伏笔", summary.new_foreshadows.as_deref()),
        ("已回收伏笔", summary.resolved_foreshadows.as_deref()),
        ("核心事件", summary.core_events.as_deref()),
        ("主角状态", summary.protagonist_state_change.as_deref()),
        (
            "重要人物变化",
            summary.important_character_changes.as_deref(),
        ),
        ("设定变化", summary.setting_changes.as_deref()),
        ("新地点", summary.new_locations.as_deref()),
        ("新物品或能力", summary.new_items_or_abilities.as_deref()),
        ("伏笔", summary.foreshadowing.as_deref()),
        ("未决问题", summary.unresolved_questions.as_deref()),
        ("必须记住", summary.facts_must_remember.as_deref()),
        ("下一章提示", summary.next_chapter_hints.as_deref()),
        ("下一章钩子", summary.next_chapter_hook.as_deref()),
    ] {
        if let Some(value) = value
            .map(str::trim)
            .filter(|value| !value.is_empty() && !matches!(*value, "[]" | "{}" | "null"))
        {
            sections.push(format!("{label}：{value}"));
        }
    }
    sections.join("\n")
}

pub(crate) fn invalidate_source_in_transaction(
    connection: &Connection,
    novel_id: &str,
    source_type: &str,
    source_id: &str,
    now: &str,
    reason: &str,
) -> Result<usize, AppError> {
    validate_source_type(source_type)?;
    memory_repository::invalidate_active_source_versions(
        connection,
        novel_id,
        source_type,
        source_id,
        "",
        now,
        reason,
    )
}

pub(crate) fn invalidate_chapter_context_in_transaction(
    connection: &Connection,
    chapter_id: &str,
    now: &str,
    reason: &str,
) -> Result<usize, AppError> {
    connection
        .execute(
            "UPDATE memory_documents
             SET status='invalidated', invalidated_at=?1, invalidation_reason=?2, updated_at=?1
             WHERE chapter_id=?3 AND source_type IN ('chapter_summary','context_record')
               AND status='active'",
            params![now, reason, chapter_id],
        )
        .map_err(AppError::database)
}

pub(crate) fn sync_chapter_summary_in_transaction(
    connection: &Connection,
    summary: &ChapterSummaryDto,
    now: &str,
) -> Result<Option<PutMemoryDocumentOutput>, AppError> {
    if !summary.enabled || summary.is_expired {
        invalidate_source_in_transaction(
            connection,
            &summary.novel_id,
            "chapter_summary",
            &summary.id,
            now,
            "source_not_memory_eligible",
        )?;
        return Ok(None);
    }
    let (Some(source_hash), Some(source_version)) =
        (summary.content_hash.as_deref(), summary.draft_version)
    else {
        invalidate_source_in_transaction(
            connection,
            &summary.novel_id,
            "chapter_summary",
            &summary.id,
            now,
            "source_not_memory_eligible",
        )?;
        return Ok(None);
    };
    if source_version < 1 {
        invalidate_source_in_transaction(
            connection,
            &summary.novel_id,
            "chapter_summary",
            &summary.id,
            now,
            "source_not_memory_eligible",
        )?;
        return Ok(None);
    }
    put_chapter_summary_in_transaction(
        connection,
        &summary.novel_id,
        &summary.chapter_id,
        &summary.adopted_draft_id,
        &summary.id,
        source_version,
        source_hash,
        &chapter_summary_memory_text(summary),
        "章节总结",
        now,
    )
    .map(Some)
}

pub(crate) fn put_chapter_summary_in_transaction(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
    adopted_draft_id: &str,
    summary_id: &str,
    source_version: i64,
    source_hash: &str,
    summary_text: &str,
    title: &str,
    now: &str,
) -> Result<PutMemoryDocumentOutput, AppError> {
    let summary_text = summary_text.trim();
    if summary_text.is_empty() {
        return Err(memory_error(
            codes::MEMORY_INPUT_INVALID,
            "章节总结 Memory 不能为空",
        ));
    }
    let chapter_sequence_index = chapter_sequence_index(connection, novel_id, chapter_id)?;
    let summary_content_hash = large_text_repository::sha256(summary_text);
    let identity_hash = materialization_hash(
        connection,
        novel_id,
        "chapter_summary",
        summary_id,
        "mem-summary-",
        large_text_repository::sha256(&format!(
            "chapter_summary:{summary_id}\nversion:{}\nsource_hash:{source_hash}\ncontent_hash:{summary_content_hash}\ntitle_hash:{}",
            source_version.max(1),
            large_text_repository::sha256(title.trim()),
        )),
    )?;
    let chunks = chunk_derived_memory_content(summary_text)
        .into_iter()
        .enumerate()
        .map(|(ordinal, text)| MemoryChunkInput {
            id: format!("chk-summary-{}-{ordinal}", &identity_hash[..32]),
            ordinal: ordinal as i64,
            token_count: memory_token_count(&text),
            content_hash: large_text_repository::sha256(&text),
            text,
            importance: 0.95,
            chapter_order_index: Some(chapter_sequence_index),
            temporal_start_chapter: Some(chapter_sequence_index),
            temporal_end_chapter: None,
            entity_keys: Vec::new(),
            metadata: json!({ "source": "chapter_summary" }),
        })
        .collect();
    let input = PutMemoryDocumentInput {
        trace_id: None,
        document_id: format!("mem-summary-{identity_hash}"),
        novel_id: novel_id.to_string(),
        source_type: "chapter_summary".to_string(),
        source_id: summary_id.to_string(),
        source_version: source_version.max(1),
        source_hash: source_hash.to_string(),
        adopted_draft_id: Some(adopted_draft_id.to_string()),
        chapter_id: Some(chapter_id.to_string()),
        metadata: json!({
            "title": title,
            "source": "chapter_summary",
        }),
        chunks,
    };
    persist_document_in_transaction(
        connection,
        input,
        now,
        PersistDocumentMode::ReplaceActiveSource,
    )
}

pub(crate) fn put_context_record_in_transaction(
    connection: &Connection,
    record: &ContextRecordDto,
    adopted_draft_id: &str,
    now: &str,
) -> Result<Option<PutMemoryDocumentOutput>, AppError> {
    if !record.is_active || record.is_expired || record.context_type == "chapter_summary" {
        invalidate_source_in_transaction(
            connection,
            &record.novel_id,
            "context_record",
            &record.id,
            now,
            "source_not_memory_eligible",
        )?;
        return Ok(None);
    }

    let chapter_id = record
        .chapter_id
        .as_deref()
        .ok_or_else(|| memory_error(codes::MEMORY_SOURCE_INVALID, "上下文 Memory 缺少来源章节"))?;
    let source_hash = record.content_hash.as_deref().ok_or_else(|| {
        memory_error(codes::MEMORY_SOURCE_INVALID, "上下文 Memory 缺少采用稿哈希")
    })?;
    let source_version = record.draft_version.ok_or_else(|| {
        memory_error(codes::MEMORY_SOURCE_INVALID, "上下文 Memory 缺少采用稿版本")
    })?;
    let context_text = record.content.trim();
    if context_text.is_empty() {
        return Err(memory_error(
            codes::MEMORY_INPUT_INVALID,
            "上下文 Memory 不能为空",
        ));
    }

    let chapter_sequence_index = chapter_sequence_index(connection, &record.novel_id, chapter_id)?;
    let context_content_hash = large_text_repository::sha256(context_text);
    let identity_hash = large_text_repository::sha256(&format!(
        "context_record:{}\nadopted_draft:{adopted_draft_id}\nversion:{}\nsource_hash:{source_hash}\ncontext_type:{}\ntitle_hash:{}\ncontent_hash:{context_content_hash}\nimportance:{}",
        record.id,
        source_version.max(1),
        record.context_type,
        large_text_repository::sha256(record.title.trim()),
        record.importance,
    ));
    let materialization_hash = materialization_hash(
        connection,
        &record.novel_id,
        "context_record",
        &record.id,
        "mem-context-",
        identity_hash,
    )?;
    let importance = f64::from(record.importance.clamp(1, 5) as i32) / 5.0;
    let metadata = json!({
        "source": "context_record",
        "contextType": record.context_type,
        "title": record.title,
    });
    let chunks = chunk_derived_memory_content(context_text)
        .into_iter()
        .enumerate()
        .map(|(ordinal, text)| MemoryChunkInput {
            id: format!("chk-context-{}-{ordinal}", &materialization_hash[..32]),
            ordinal: ordinal as i64,
            token_count: memory_token_count(&text),
            content_hash: large_text_repository::sha256(&text),
            text,
            importance,
            chapter_order_index: Some(chapter_sequence_index),
            temporal_start_chapter: Some(chapter_sequence_index),
            temporal_end_chapter: None,
            entity_keys: Vec::new(),
            metadata: metadata.clone(),
        })
        .collect();
    let input = PutMemoryDocumentInput {
        trace_id: None,
        document_id: format!("mem-context-{materialization_hash}"),
        novel_id: record.novel_id.clone(),
        source_type: "context_record".to_string(),
        source_id: record.id.clone(),
        source_version: source_version.max(1),
        source_hash: source_hash.to_string(),
        adopted_draft_id: Some(adopted_draft_id.to_string()),
        chapter_id: Some(chapter_id.to_string()),
        metadata: metadata.clone(),
        chunks,
    };
    persist_document_in_transaction(
        connection,
        input,
        now,
        PersistDocumentMode::ReplaceActiveSource,
    )
    .map(Some)
}

fn replay_matches(
    persisted: &memory_repository::MemoryDocument,
    persisted_chunks: &[memory_repository::MemoryChunk],
    input: &PutMemoryDocumentInput,
    chunks: &[memory_repository::MemoryChunk],
    metadata_json: &str,
) -> bool {
    persisted.novel_id == input.novel_id
        && persisted.source_type == input.source_type
        && persisted.source_id == input.source_id
        && persisted.source_version == input.source_version
        && persisted.source_hash == input.source_hash
        && persisted.adopted_draft_id == input.adopted_draft_id
        && persisted.chapter_id == input.chapter_id
        && persisted.status == "active"
        && persisted.metadata_json == metadata_json
        && persisted_chunks.len() == chunks.len()
        && persisted_chunks.iter().zip(chunks).all(|(left, right)| {
            left.ordinal == right.ordinal
                && left.text == right.text
                && left.token_count == right.token_count
                && (left.importance - right.importance).abs() <= f64::EPSILON
                && left.chapter_order_index == right.chapter_order_index
                && left.temporal_start_chapter == right.temporal_start_chapter
                && left.temporal_end_chapter == right.temporal_end_chapter
                && left.entity_keys_json == right.entity_keys_json
                && left.metadata_json == right.metadata_json
                && left.content_hash == right.content_hash
        })
}

fn persist_document_in_transaction(
    connection: &Connection,
    input: PutMemoryDocumentInput,
    now: &str,
    mode: PersistDocumentMode,
) -> Result<PutMemoryDocumentOutput, AppError> {
    validate_id("documentId", &input.document_id)?;
    validate_id("novelId", &input.novel_id)?;
    validate_id("sourceId", &input.source_id)?;
    validate_hash("sourceHash", &input.source_hash)?;
    validate_source_type(&input.source_type)?;
    if input.source_version < 1 {
        return Err(memory_error(
            codes::MEMORY_INPUT_INVALID,
            "Memory 来源版本无效",
        ));
    }
    let existing_by_id =
        memory_repository::find_document(connection, &input.novel_id, &input.document_id)?;
    if existing_by_id
        .as_ref()
        .is_some_and(|document| document.status == "invalidated")
    {
        return Err(memory_error(
            codes::MEMORY_DOCUMENT_CONFLICT,
            "Memory 文档身份已绑定不同内容",
        ));
    }
    let metadata_json = validate_json_object("document.metadata", &input.metadata, 64 * 1024)?;
    let chunks = build_chunks(&input, now)?;
    validate_source(connection, &input)?;

    if let Some(existing) = existing_by_id {
        let persisted_chunks =
            memory_repository::list_chunks(connection, &input.novel_id, &existing.id)?;
        if replay_matches(
            &existing,
            &persisted_chunks,
            &input,
            &chunks,
            &metadata_json,
        ) {
            return Ok(PutMemoryDocumentOutput {
                document: existing,
                chunks: persisted_chunks,
                created: false,
                invalidated_document_count: 0,
            });
        }
        return Err(memory_error(
            codes::MEMORY_DOCUMENT_CONFLICT,
            "Memory 文档身份已绑定不同内容",
        ));
    }

    if let Some(existing) = memory_repository::find_document_by_identity(
        connection,
        &input.novel_id,
        &input.source_type,
        &input.source_id,
        input.source_version,
        &input.source_hash,
    )? {
        let persisted_chunks =
            memory_repository::list_chunks(connection, &input.novel_id, &existing.id)?;
        if replay_matches(
            &existing,
            &persisted_chunks,
            &input,
            &chunks,
            &metadata_json,
        ) {
            return Ok(PutMemoryDocumentOutput {
                document: existing,
                chunks: persisted_chunks,
                created: false,
                invalidated_document_count: 0,
            });
        }
        if mode == PersistDocumentMode::Strict {
            return Err(memory_error(
                codes::MEMORY_DOCUMENT_CONFLICT,
                "Memory 文档身份已绑定不同内容",
            ));
        }
    }

    let document = memory_repository::MemoryDocument {
        id: input.document_id.clone(),
        novel_id: input.novel_id.clone(),
        source_type: input.source_type.clone(),
        source_id: input.source_id.clone(),
        source_version: input.source_version,
        source_hash: input.source_hash.clone(),
        adopted_draft_id: input.adopted_draft_id.clone(),
        chapter_id: input.chapter_id.clone(),
        status: "active".to_string(),
        metadata_json,
        created_at: now.to_string(),
        updated_at: now.to_string(),
        invalidated_at: None,
        invalidation_reason: None,
    };
    let invalidated = memory_repository::invalidate_active_source_versions(
        connection,
        &input.novel_id,
        &input.source_type,
        &input.source_id,
        &input.document_id,
        now,
        "source_rebuilt",
    )?;
    memory_repository::insert_document(connection, &document)?;
    for chunk in &chunks {
        memory_repository::insert_chunk(connection, chunk)?;
    }
    Ok(PutMemoryDocumentOutput {
        document,
        chunks,
        created: true,
        invalidated_document_count: invalidated,
    })
}

pub fn put_document(
    connection: &mut Connection,
    input: PutMemoryDocumentInput,
) -> Result<PutMemoryDocumentOutput, AppError> {
    let trace_id = input.trace_id.clone();
    let result = (|| {
        let now = Utc::now().to_rfc3339();
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(AppError::database)?;
        let output = persist_document_in_transaction(
            &transaction,
            input,
            &now,
            PersistDocumentMode::Strict,
        )?;
        transaction.commit().map_err(|error| {
            AppError::new(
                codes::DATABASE_COMMIT_UNKNOWN,
                "Memory 文档提交状态未知",
                true,
            )
            .with_details(json!({ "sqliteError": error.to_string() }))
        })?;
        Ok(output)
    })();
    result.map_err(|error| with_trace(error, trace_id.as_deref()))
}

pub fn put_embeddings(
    connection: &mut Connection,
    input: PutMemoryEmbeddingsInput,
) -> Result<PutMemoryEmbeddingsOutput, AppError> {
    let trace_id = input.trace_id.as_deref();
    let result = (|| {
        validate_id("novelId", &input.novel_id)?;
        validate_model_identity(&input.provider, &input.model, input.dimension)?;
        if input.items.is_empty() || input.items.len() > MAX_CANDIDATES as usize {
            return Err(memory_error(
                codes::MEMORY_EMBEDDING_INVALID,
                "Embedding 批次数量无效",
            ));
        }
        let mut chunk_ids = HashSet::new();
        let prepared = input
            .items
            .iter()
            .map(|item| {
                validate_id("chunkId", &item.chunk_id)?;
                if !chunk_ids.insert(item.chunk_id.as_str()) {
                    return Err(memory_error(
                        codes::MEMORY_EMBEDDING_INVALID,
                        "Embedding 批次包含重复分块",
                    ));
                }
                let norm = vector_norm(&item.vector, input.dimension)?;
                let hash = vector_hash(&item.vector);
                let vector_json = serde_json::to_string(&item.vector).map_err(|_| {
                    memory_error(codes::MEMORY_EMBEDDING_INVALID, "Embedding 向量序列化失败")
                })?;
                Ok((item, norm, hash, vector_json))
            })
            .collect::<Result<Vec<_>, AppError>>()?;

        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(AppError::database)?;
        if let Some(existing_dimension) = memory_repository::embedding_dimension_for_model(
            &transaction,
            &input.novel_id,
            &input.provider,
            &input.model,
        )? {
            if existing_dimension != input.dimension {
                return Err(memory_error(
                    codes::MEMORY_EMBEDDING_DIMENSION_MISMATCH,
                    "同一 Embedding 模型身份已绑定其他维度",
                )
                .with_details(json!({
                    "provider": input.provider,
                    "model": input.model,
                    "expectedDimension": existing_dimension,
                    "actualDimension": input.dimension,
                })));
            }
        }
        let now = Utc::now().to_rfc3339();
        let mut outputs = Vec::with_capacity(prepared.len());
        for (item, norm, vector_hash, vector_json) in prepared {
            let (_, chunk_content_hash) =
                memory_repository::find_chunk_scope(&transaction, &input.novel_id, &item.chunk_id)?
                    .ok_or_else(|| {
                        memory_error(
                            codes::MEMORY_CHUNK_NOT_FOUND,
                            "Embedding 目标 Memory 分块不存在或跨作品",
                        )
                    })?;
            let existing = memory_repository::find_embedding(
                &transaction,
                &input.novel_id,
                &item.chunk_id,
                &input.provider,
                &input.model,
            )?;
            let id = existing
                .as_ref()
                .map(|record| record.id.clone())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            memory_repository::upsert_embedding(
                &transaction,
                &id,
                &item.chunk_id,
                &input.novel_id,
                input.provider.trim(),
                input.model.trim(),
                input.dimension,
                &vector_json,
                norm,
                &vector_hash,
                &chunk_content_hash,
                &now,
            )?;
            outputs.push(MemoryEmbeddingOutput {
                id,
                chunk_id: item.chunk_id.clone(),
                provider: input.provider.trim().to_string(),
                model: input.model.trim().to_string(),
                dimension: input.dimension,
                vector_hash,
                chunk_content_hash,
                created_at: now.clone(),
            });
        }
        transaction.commit().map_err(|error| {
            AppError::new(
                codes::DATABASE_COMMIT_UNKNOWN,
                "Embedding 提交状态未知",
                true,
            )
            .with_details(json!({ "sqliteError": error.to_string() }))
        })?;
        Ok(PutMemoryEmbeddingsOutput {
            embeddings: outputs,
        })
    })();
    result.map_err(|error| with_trace(error, trace_id))
}

fn validate_retrieval_filters(filters: &MemoryRetrievalFilters) -> Result<(), AppError> {
    if filters.chapter_start.is_some_and(|value| value < 0)
        || filters.chapter_end.is_some_and(|value| value < 0)
        || matches!(
            (filters.chapter_start, filters.chapter_end),
            (Some(start), Some(end)) if end < start
        )
        || filters
            .min_importance
            .is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
        || filters.temporal_chapter.is_some_and(|value| value < 0)
        || filters.source_types.len() > 16
        || filters.entity_keys.len() > 64
    {
        return Err(memory_error(
            codes::MEMORY_RETRIEVAL_INVALID,
            "Memory 检索过滤条件无效",
        ));
    }
    for source_type in &filters.source_types {
        validate_source_type(source_type)?;
    }
    if filters
        .entity_keys
        .iter()
        .any(|key| key.trim().is_empty() || key.len() > 160)
    {
        return Err(memory_error(
            codes::MEMORY_RETRIEVAL_INVALID,
            "Memory 检索实体键无效",
        ));
    }
    Ok(())
}

fn parse_entity_keys(value: &str) -> Result<Vec<String>, AppError> {
    serde_json::from_str::<Vec<String>>(value).map_err(|_| {
        memory_error(
            codes::MEMORY_CONTENT_INVALID,
            "Memory 分块实体键持久化内容无效",
        )
    })
}

fn parse_metadata(value: &str) -> Result<Value, AppError> {
    let parsed = serde_json::from_str::<Value>(value).map_err(|_| {
        memory_error(
            codes::MEMORY_CONTENT_INVALID,
            "Memory 分块元数据持久化内容无效",
        )
    })?;
    if !parsed.is_object() {
        return Err(memory_error(
            codes::MEMORY_CONTENT_INVALID,
            "Memory 分块元数据不是对象",
        ));
    }
    Ok(parsed)
}

fn candidate_matches_filters(
    candidate: &memory_repository::MemoryCandidate,
    entity_keys: &[String],
    filters: &MemoryRetrievalFilters,
) -> bool {
    if !filters.source_types.is_empty()
        && !filters
            .source_types
            .iter()
            .any(|source_type| source_type == &candidate.document.source_type)
    {
        return false;
    }
    if !filters.entity_keys.is_empty()
        && !filters
            .entity_keys
            .iter()
            .all(|required| entity_keys.iter().any(|actual| actual == required))
    {
        return false;
    }
    if let Some(temporal) = filters.temporal_chapter {
        if candidate
            .chunk
            .temporal_start_chapter
            .is_some_and(|start| temporal < start)
            || candidate
                .chunk
                .temporal_end_chapter
                .is_some_and(|end| temporal > end)
        {
            return false;
        }
    }
    true
}

fn fts_match_query(query: &str) -> String {
    format!("\"{}\"", query.trim().replace('"', "\"\""))
}

fn cosine_similarity(
    query: &[f32],
    query_norm: f64,
    stored_json: &str,
    stored_norm: f64,
    dimension: i64,
) -> Result<f64, AppError> {
    let stored = serde_json::from_str::<Vec<f32>>(stored_json).map_err(|_| {
        memory_error(
            codes::MEMORY_EMBEDDING_INVALID,
            "持久化 Embedding 向量格式无效",
        )
    })?;
    if stored.len() != dimension as usize
        || query.len() != dimension as usize
        || !stored_norm.is_finite()
        || stored_norm <= f64::EPSILON
    {
        return Err(memory_error(
            codes::MEMORY_EMBEDDING_DIMENSION_MISMATCH,
            "持久化 Embedding 维度或范数无效",
        ));
    }
    let mut dot = 0.0f64;
    for (left, right) in query.iter().zip(stored.iter()) {
        if !right.is_finite() {
            return Err(memory_error(
                codes::MEMORY_EMBEDDING_INVALID,
                "持久化 Embedding 包含非有限数值",
            ));
        }
        dot += f64::from(*left) * f64::from(*right);
    }
    let cosine = (dot / (query_norm * stored_norm)).clamp(-1.0, 1.0);
    Ok((cosine + 1.0) / 2.0)
}

pub fn retrieve(
    connection: &mut Connection,
    input: RetrieveMemoryInput,
) -> Result<RetrieveMemoryOutput, AppError> {
    let trace_id = input.trace_id.as_deref();
    let result = (|| {
        validate_id("requestId", &input.request_id)?;
        validate_id("novelId", &input.novel_id)?;
        validate_retrieval_filters(&input.filters)?;
        if input.query.len() > 8_000
            || input.top_k < 1
            || input.top_k > MAX_TOP_K
            || input.offset < 0
            || input.offset > 100_000
            || input.candidate_limit < input.top_k
            || input.candidate_limit > MAX_CANDIDATES
            || input.token_budget < 1
            || input.token_budget > MAX_TOKEN_BUDGET
        {
            return Err(memory_error(
                codes::MEMORY_RETRIEVAL_INVALID,
                "Memory 检索分页、候选或预算参数无效",
            ));
        }
        let has_structured_filter = input.filters.chapter_id.is_some()
            || input.filters.chapter_start.is_some()
            || input.filters.chapter_end.is_some()
            || !input.filters.source_types.is_empty()
            || !input.filters.entity_keys.is_empty()
            || input.filters.min_importance.is_some()
            || input.filters.temporal_chapter.is_some();
        if input.query.trim().is_empty()
            && input.query_embedding.is_none()
            && !has_structured_filter
        {
            return Err(memory_error(
                codes::MEMORY_RETRIEVAL_INVALID,
                "Memory 检索至少需要查询文本、Embedding 或结构化过滤条件",
            ));
        }

        let (embedding_provider, embedding_model, embedding_dimension, query_norm, query_hash) =
            if let Some(embedding) = input.query_embedding.as_ref() {
                validate_model_identity(
                    &embedding.provider,
                    &embedding.model,
                    embedding.dimension,
                )?;
                let norm = vector_norm(&embedding.vector, embedding.dimension)?;
                (
                    Some(embedding.provider.as_str()),
                    Some(embedding.model.as_str()),
                    Some(embedding.dimension),
                    Some(norm),
                    Some(vector_hash(&embedding.vector)),
                )
            } else {
                (None, None, None, None, None)
            };

        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Deferred)
            .map_err(AppError::database)?;
        if let (Some(provider), Some(model), Some(dimension)) =
            (embedding_provider, embedding_model, embedding_dimension)
        {
            if let Some(existing_dimension) = memory_repository::embedding_dimension_for_model(
                &transaction,
                &input.novel_id,
                provider,
                model,
            )? {
                if existing_dimension != dimension {
                    return Err(memory_error(
                        codes::MEMORY_EMBEDDING_DIMENSION_MISMATCH,
                        "查询 Embedding 与持久化模型维度不一致",
                    ));
                }
            }
        }

        let fts_available = memory_repository::fts_available(&transaction)?;
        let fetch_limit = (input.candidate_limit * 4).min(MAX_FETCH_CANDIDATES);
        let structured = memory_repository::fetch_candidates(
            &transaction,
            &input.novel_id,
            input.filters.chapter_start,
            input.filters.chapter_end,
            input.filters.chapter_id.as_deref(),
            input.filters.min_importance,
            embedding_provider,
            embedding_model,
            fetch_limit,
        )?;

        let mut candidates =
            HashMap::<String, (memory_repository::MemoryCandidate, Vec<String>, Value)>::new();
        for candidate in structured {
            let entity_keys = parse_entity_keys(&candidate.chunk.entity_keys_json)?;
            if candidate_matches_filters(&candidate, &entity_keys, &input.filters) {
                let metadata = parse_metadata(&candidate.chunk.metadata_json)?;
                candidates.insert(
                    candidate.chunk.id.clone(),
                    (candidate, entity_keys, metadata),
                );
                if candidates.len() >= input.candidate_limit as usize {
                    break;
                }
            }
        }

        let mut lexical_scores = HashMap::<String, f64>::new();
        let query = input.query.trim();
        if !query.is_empty() && fts_available {
            let lexical_ids = memory_repository::lexical_chunk_ids(
                &transaction,
                &input.novel_id,
                &fts_match_query(query),
                input.candidate_limit,
            )?;
            for (index, chunk_id) in lexical_ids.iter().enumerate() {
                lexical_scores.insert(chunk_id.clone(), 1.0 / (1.0 + index as f64));
                if !candidates.contains_key(chunk_id) {
                    if let Some(candidate) = memory_repository::fetch_candidate_by_id(
                        &transaction,
                        &input.novel_id,
                        chunk_id,
                        embedding_provider,
                        embedding_model,
                    )? {
                        let entity_keys = parse_entity_keys(&candidate.chunk.entity_keys_json)?;
                        if candidate_matches_filters(&candidate, &entity_keys, &input.filters) {
                            let metadata = parse_metadata(&candidate.chunk.metadata_json)?;
                            candidates.insert(chunk_id.clone(), (candidate, entity_keys, metadata));
                        }
                    }
                }
            }
        }
        if !query.is_empty() {
            let query_lower = query.to_lowercase();
            for (chunk_id, (candidate, _, _)) in &candidates {
                if !lexical_scores.contains_key(chunk_id)
                    && candidate.chunk.text.to_lowercase().contains(&query_lower)
                {
                    lexical_scores.insert(chunk_id.clone(), 0.5);
                }
            }
        }

        let max_chapter = candidates
            .values()
            .filter_map(|(candidate, _, _)| candidate.chunk.chapter_order_index)
            .max()
            .unwrap_or(1)
            .max(1);
        let mut semantic_candidate_count = 0usize;
        let mut ranked = Vec::with_capacity(candidates.len());
        for (_, (candidate, entity_keys, metadata)) in candidates {
            let importance = candidate.chunk.importance.clamp(0.0, 1.0);
            let recency = candidate
                .chunk
                .chapter_order_index
                .map(|value| (value.max(0) as f64 / max_chapter as f64).clamp(0.0, 1.0))
                .unwrap_or(0.5);
            let lexical = lexical_scores.get(&candidate.chunk.id).copied();
            let semantic = if let (Some(query_embedding), Some(query_norm), Some(dimension)) = (
                input.query_embedding.as_ref(),
                query_norm,
                embedding_dimension,
            ) {
                if let Some(embedding) = candidate.embedding.as_ref() {
                    if embedding.dimension != dimension
                        || embedding.chunk_content_hash != candidate.chunk.content_hash
                    {
                        return Err(memory_error(
                            codes::MEMORY_EMBEDDING_DIMENSION_MISMATCH,
                            "Memory Embedding 与分块版本或维度不一致",
                        ));
                    }
                    semantic_candidate_count += 1;
                    Some(cosine_similarity(
                        &query_embedding.vector,
                        query_norm,
                        &embedding.vector_json,
                        embedding.vector_norm,
                        dimension,
                    )?)
                } else {
                    None
                }
            } else {
                None
            };
            let final_score = match (semantic, lexical) {
                (Some(semantic), Some(lexical)) => {
                    semantic * 0.60 + lexical * 0.20 + importance * 0.10 + recency * 0.10
                }
                (Some(semantic), None) => semantic * 0.75 + importance * 0.15 + recency * 0.10,
                (None, Some(lexical)) => lexical * 0.65 + importance * 0.20 + recency * 0.15,
                (None, None) => importance * 0.60 + recency * 0.40,
            };
            let mut matched_by = Vec::new();
            if semantic.is_some() {
                matched_by.push("semantic".to_string());
            }
            if lexical.is_some() {
                matched_by.push(if fts_available {
                    "fts_or_substring".to_string()
                } else {
                    "substring".to_string()
                });
            }
            if matched_by.is_empty() {
                matched_by.push("structured".to_string());
            }
            ranked.push(RankedCandidate {
                candidate,
                entity_keys,
                metadata,
                reason: MemoryScoreReason {
                    matched_by,
                    semantic_score: semantic,
                    lexical_score: lexical,
                    importance_score: importance,
                    recency_score: recency,
                    final_score,
                },
            });
        }
        ranked.sort_by(|left, right| {
            right
                .reason
                .final_score
                .partial_cmp(&left.reason.final_score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| {
                    right
                        .candidate
                        .chunk
                        .chapter_order_index
                        .cmp(&left.candidate.chunk.chapter_order_index)
                })
                .then_with(|| left.candidate.chunk.id.cmp(&right.candidate.chunk.id))
        });

        let candidate_count = ranked.len();
        let mut cursor = input.offset.min(candidate_count as i64) as usize;
        let mut used_tokens = 0i64;
        let mut items = Vec::new();
        while cursor < ranked.len() && items.len() < input.top_k as usize {
            let ranked_item = &ranked[cursor];
            cursor += 1;
            if used_tokens + ranked_item.candidate.chunk.token_count > input.token_budget {
                continue;
            }
            used_tokens += ranked_item.candidate.chunk.token_count;
            items.push(MemoryRetrievalItem {
                chunk_id: ranked_item.candidate.chunk.id.clone(),
                document_id: ranked_item.candidate.document.id.clone(),
                text: ranked_item.candidate.chunk.text.clone(),
                token_count: ranked_item.candidate.chunk.token_count,
                content_hash: ranked_item.candidate.chunk.content_hash.clone(),
                source_type: ranked_item.candidate.document.source_type.clone(),
                source_id: ranked_item.candidate.document.source_id.clone(),
                source_version: ranked_item.candidate.document.source_version,
                source_hash: ranked_item.candidate.document.source_hash.clone(),
                adopted_draft_id: ranked_item.candidate.document.adopted_draft_id.clone(),
                chapter_id: ranked_item.candidate.chunk.chapter_id.clone(),
                chapter_order_index: ranked_item.candidate.chunk.chapter_order_index,
                entity_keys: ranked_item.entity_keys.clone(),
                metadata: ranked_item.metadata.clone(),
                score: ranked_item.reason.clone(),
            });
        }
        let retrieval_mode = if semantic_candidate_count > 0 && !lexical_scores.is_empty() {
            "hybrid"
        } else if semantic_candidate_count > 0 {
            "semantic_structured"
        } else if !lexical_scores.is_empty() {
            if fts_available {
                "fts_structured"
            } else {
                "lexical_structured"
            }
        } else {
            "structured"
        }
        .to_string();
        let filters_json = serde_json::to_string(&input.filters).map_err(|_| {
            memory_error(
                codes::MEMORY_RETRIEVAL_INVALID,
                "Memory 检索过滤条件序列化失败",
            )
        })?;
        let selected_chunk_ids_json =
            serde_json::to_string(&items.iter().map(|item| &item.chunk_id).collect::<Vec<_>>())
                .map_err(|_| {
                    memory_error(codes::MEMORY_CONTENT_INVALID, "Memory 检索结果序列化失败")
                })?;
        let score_reasons_json = serde_json::to_string(
            &items
                .iter()
                .map(|item| json!({ "chunkId": item.chunk_id, "score": item.score }))
                .collect::<Vec<_>>(),
        )
        .map_err(|_| memory_error(codes::MEMORY_CONTENT_INVALID, "Memory 评分原因序列化失败"))?;
        memory_repository::insert_retrieval_log(
            &transaction,
            &input.request_id,
            &input.novel_id,
            &large_text_repository::sha256(query),
            query_hash.as_deref(),
            &filters_json,
            &retrieval_mode,
            embedding_provider,
            embedding_model,
            embedding_dimension,
            fts_available,
            candidate_count as i64,
            &selected_chunk_ids_json,
            &score_reasons_json,
            input.top_k,
            input.offset,
            input.token_budget,
            used_tokens,
            &Utc::now().to_rfc3339(),
        )?;
        transaction.commit().map_err(|error| {
            AppError::new(
                codes::DATABASE_COMMIT_UNKNOWN,
                "Memory 检索日志提交状态未知",
                true,
            )
            .with_details(json!({ "sqliteError": error.to_string() }))
        })?;

        Ok(RetrieveMemoryOutput {
            request_id: input.request_id,
            retrieval_mode,
            fts_available,
            semantic_candidate_count,
            candidate_count,
            used_tokens,
            token_budget: input.token_budget,
            offset: input.offset,
            next_offset: cursor as i64,
            has_more: cursor < candidate_count,
            items,
        })
    })();
    result.map_err(|error| with_trace(error, trace_id))
}

pub fn list_documents(
    connection: &Connection,
    input: ListMemoryDocumentsInput,
) -> Result<MemoryDocumentPage, AppError> {
    validate_id("novelId", &input.novel_id)?;
    if input.offset < 0 || input.limit < 1 || input.limit > 100 {
        return Err(memory_error(
            codes::MEMORY_INPUT_INVALID,
            "Memory 文档分页参数无效",
        ));
    }
    if input
        .status
        .as_deref()
        .is_some_and(|status| !matches!(status, "active" | "invalidated"))
    {
        return Err(memory_error(
            codes::MEMORY_INPUT_INVALID,
            "Memory 文档状态过滤无效",
        ));
    }
    let (total, items) = memory_repository::list_documents(
        connection,
        &input.novel_id,
        input.status.as_deref(),
        input.offset,
        input.limit,
    )?;
    Ok(MemoryDocumentPage {
        total,
        offset: input.offset,
        limit: input.limit,
        items,
    })
}

pub fn invalidate_document(
    connection: &mut Connection,
    input: InvalidateMemoryDocumentInput,
) -> Result<InvalidateMemoryDocumentOutput, AppError> {
    let trace_id = input.trace_id.as_deref();
    let result = (|| {
        validate_id("novelId", &input.novel_id)?;
        validate_id("documentId", &input.document_id)?;
        validate_hash("expectedSourceHash", &input.expected_source_hash)?;
        let reason = input.reason.trim();
        if reason.is_empty() || reason.len() > 160 {
            return Err(memory_error(
                codes::MEMORY_INPUT_INVALID,
                "Memory 失效原因无效",
            ));
        }
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(AppError::database)?;
        let exists =
            memory_repository::find_document(&transaction, &input.novel_id, &input.document_id)?;
        if exists.is_none() {
            return Err(memory_error(
                codes::MEMORY_DOCUMENT_NOT_FOUND,
                "Memory 文档不存在或跨作品",
            ));
        }
        let affected = memory_repository::invalidate_document(
            &transaction,
            &input.novel_id,
            &input.document_id,
            &input.expected_source_hash,
            reason,
            &Utc::now().to_rfc3339(),
        )?;
        if affected == 0
            && exists
                .as_ref()
                .is_some_and(|document| document.status == "active")
        {
            return Err(memory_error(
                codes::MEMORY_DOCUMENT_CONFLICT,
                "Memory 文档来源哈希已变化",
            ));
        }
        transaction.commit().map_err(AppError::database)?;
        Ok(InvalidateMemoryDocumentOutput {
            invalidated: affected == 1,
        })
    })();
    result.map_err(|error| with_trace(error, trace_id))
}

pub fn invalidate_for_adopted_draft_change(
    transaction: &Transaction<'_>,
    novel_id: &str,
    chapter_id: &str,
    new_adopted_draft_id: &str,
    now: &str,
) -> Result<usize, AppError> {
    memory_repository::invalidate_for_adopted_draft_change(
        transaction,
        novel_id,
        chapter_id,
        new_adopted_draft_id,
        now,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> Result<Connection, Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE novels (
                 id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL, deleted_at TEXT
             );
             CREATE TABLE chapters (
                 id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, title TEXT NOT NULL,
                 adopted_draft_id TEXT, order_index INTEGER NOT NULL DEFAULT 0,
                 word_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'adopted',
                 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
             );
             CREATE TABLE ai_task_records (id TEXT PRIMARY KEY);
             CREATE TABLE chapter_drafts (
                 id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
                 title TEXT, content TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
                 version_no INTEGER NOT NULL, word_count INTEGER NOT NULL DEFAULT 0,
                 is_adopted INTEGER NOT NULL DEFAULT 0, ai_task_id TEXT, note TEXT,
                 large_text_ref_id TEXT, content_hash TEXT, created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE TABLE chapter_summaries (
                 id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
                 adopted_draft_id TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
                 content_hash TEXT, draft_version INTEGER, is_expired INTEGER NOT NULL DEFAULT 0,
                 enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
             );
             CREATE TABLE context_records (
                 id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT,
                 context_type TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
                 importance INTEGER NOT NULL DEFAULT 3, is_active INTEGER NOT NULL DEFAULT 1,
                 content_hash TEXT, draft_version INTEGER, is_expired INTEGER NOT NULL DEFAULT 0,
                 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
             );
             INSERT INTO novels (id, title, created_at, updated_at)
             VALUES ('novel-a', 'A', 'now', 'now'), ('novel-b', 'B', 'now', 'now');
             INSERT INTO chapters
                 (id, novel_id, title, adopted_draft_id, order_index, created_at, updated_at)
             VALUES ('chapter-a', 'novel-a', 'A1', 'draft-a', 1, 'now', 'now'),
                    ('chapter-b', 'novel-b', 'B1', 'draft-b', 1, 'now', 'now');",
        )?;
        let body_a = "林舟在雨夜发现旧塔下的铜钥匙。";
        let body_b = "另一本书中的秘密。";
        connection.execute(
            "INSERT INTO chapter_drafts
                (id, novel_id, chapter_id, content, source, version_no, word_count, is_adopted,
                 content_hash, created_at, updated_at)
             VALUES ('draft-a', 'novel-a', 'chapter-a', ?1, 'user_edited', 2, 15, 1, ?2, 'now', 'now'),
                    ('draft-b', 'novel-b', 'chapter-b', ?3, 'user_edited', 1, 9, 1, ?4, 'now', 'now')",
            params![
                body_a,
                large_text_repository::sha256(body_a),
                body_b,
                large_text_repository::sha256(body_b)
            ],
        )?;
        crate::migrations::run_migrations(&mut connection)?;
        Ok(connection)
    }

    fn document_input(novel_id: &str, document_id: &str, chunk_id: &str) -> PutMemoryDocumentInput {
        let body = "林舟在雨夜发现旧塔下的铜钥匙。";
        let chunk_text = "旧塔下藏着铜钥匙";
        PutMemoryDocumentInput {
            trace_id: Some("trace-memory".to_string()),
            document_id: document_id.to_string(),
            novel_id: novel_id.to_string(),
            source_type: "adopted_draft".to_string(),
            source_id: "draft-a".to_string(),
            source_version: 2,
            source_hash: large_text_repository::sha256(body),
            adopted_draft_id: Some("draft-a".to_string()),
            chapter_id: Some("chapter-a".to_string()),
            metadata: json!({ "kind": "scene" }),
            chunks: vec![MemoryChunkInput {
                id: chunk_id.to_string(),
                ordinal: 0,
                text: chunk_text.to_string(),
                token_count: 12,
                importance: 0.9,
                chapter_order_index: Some(1),
                temporal_start_chapter: Some(1),
                temporal_end_chapter: None,
                entity_keys: vec!["character:linzhou".to_string(), "item:key".to_string()],
                metadata: json!({ "factType": "discovery" }),
                content_hash: large_text_repository::sha256(chunk_text),
            }],
        }
    }

    #[test]
    fn memory_document_is_source_bound_and_idempotent() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let first = put_document(
            &mut connection,
            document_input("novel-a", "memory-doc-a", "memory-chunk-a"),
        )?;
        assert!(first.created);
        let replay = put_document(
            &mut connection,
            document_input("novel-a", "memory-doc-a", "memory-chunk-a"),
        )?;
        assert!(!replay.created);
        assert_eq!(replay.document.source_version, 2);
        assert_eq!(replay.chunks.len(), 1);
        Ok(())
    }

    #[test]
    fn public_put_rejects_reuse_of_invalidated_document_id_with_stable_conflict(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let input = document_input("novel-a", "memory-doc-a", "memory-chunk-a");
        put_document(&mut connection, input.clone())?;
        invalidate_document(
            &mut connection,
            InvalidateMemoryDocumentInput {
                trace_id: None,
                novel_id: "novel-a".to_string(),
                document_id: "memory-doc-a".to_string(),
                expected_source_hash: input.source_hash.clone(),
                reason: "test_invalidation".to_string(),
            },
        )?;

        let error = put_document(&mut connection, input)
            .expect_err("invalidated document id must remain immutable");
        assert_eq!(error.code, codes::MEMORY_DOCUMENT_CONFLICT);
        Ok(())
    }

    #[test]
    fn oversized_single_adopted_paragraph_is_split_into_bounded_chunks() {
        let paragraph = "界".repeat((MAX_CHUNK_BYTES / "界".len()) + 1);
        assert!(paragraph.len() > MAX_CHUNK_BYTES);

        let chunks = chunk_adopted_draft_content(&paragraph);
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|chunk| {
            chunk.len() <= MAX_CHUNK_BYTES
                && chunk.encode_utf16().count() <= MATERIALIZED_CHUNK_UTF16_UNITS
        }));
        assert_eq!(chunks.concat(), paragraph);
    }

    #[test]
    fn memory_rejects_cross_novel_source() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let error = put_document(
            &mut connection,
            document_input("novel-b", "memory-doc-cross", "memory-chunk-cross"),
        )
        .expect_err("cross novel source must fail");
        assert_eq!(error.code, codes::MEMORY_SOURCE_INVALID);
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM memory_documents", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        Ok(())
    }

    #[test]
    fn embedding_dimension_identity_and_hybrid_retrieval_are_enforced(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        put_document(
            &mut connection,
            document_input("novel-a", "memory-doc-a", "memory-chunk-a"),
        )?;
        put_embeddings(
            &mut connection,
            PutMemoryEmbeddingsInput {
                trace_id: None,
                novel_id: "novel-a".to_string(),
                provider: "provider-a".to_string(),
                model: "embed-v1".to_string(),
                dimension: 3,
                items: vec![MemoryEmbeddingItemInput {
                    chunk_id: "memory-chunk-a".to_string(),
                    vector: vec![1.0, 0.0, 0.0],
                }],
            },
        )?;
        let mismatch = put_embeddings(
            &mut connection,
            PutMemoryEmbeddingsInput {
                trace_id: None,
                novel_id: "novel-a".to_string(),
                provider: "provider-a".to_string(),
                model: "embed-v1".to_string(),
                dimension: 2,
                items: vec![MemoryEmbeddingItemInput {
                    chunk_id: "memory-chunk-a".to_string(),
                    vector: vec![1.0, 0.0],
                }],
            },
        )
        .expect_err("same model identity must keep one dimension");
        assert_eq!(mismatch.code, codes::MEMORY_EMBEDDING_DIMENSION_MISMATCH);

        let output = retrieve(
            &mut connection,
            RetrieveMemoryInput {
                trace_id: None,
                request_id: "memory-request-a".to_string(),
                novel_id: "novel-a".to_string(),
                query: "铜钥匙".to_string(),
                query_embedding: Some(QueryEmbeddingInput {
                    provider: "provider-a".to_string(),
                    model: "embed-v1".to_string(),
                    dimension: 3,
                    vector: vec![1.0, 0.0, 0.0],
                }),
                filters: MemoryRetrievalFilters::default(),
                top_k: 5,
                offset: 0,
                candidate_limit: 20,
                token_budget: 20,
            },
        )?;
        assert_eq!(output.items.len(), 1);
        assert_eq!(output.items[0].chunk_id, "memory-chunk-a");
        assert_eq!(output.semantic_candidate_count, 1);
        assert!(output.items[0].score.semantic_score.is_some());
        assert!(output.used_tokens <= output.token_budget);
        Ok(())
    }

    #[test]
    fn retrieval_without_embedding_uses_lexical_or_structured_and_logs_reason(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        put_document(
            &mut connection,
            document_input("novel-a", "memory-doc-a", "memory-chunk-a"),
        )?;
        let output = retrieve(
            &mut connection,
            RetrieveMemoryInput {
                trace_id: None,
                request_id: "memory-request-lexical".to_string(),
                novel_id: "novel-a".to_string(),
                query: "铜钥匙".to_string(),
                query_embedding: None,
                filters: MemoryRetrievalFilters::default(),
                top_k: 5,
                offset: 0,
                candidate_limit: 20,
                token_budget: 20,
            },
        )?;
        assert_eq!(output.semantic_candidate_count, 0);
        assert_eq!(output.items.len(), 1);
        assert!(output.items[0].score.semantic_score.is_none());
        let logged: String = connection.query_row(
            "SELECT score_reasons_json FROM memory_retrieval_logs WHERE id = 'memory-request-lexical'",
            [],
            |row| row.get(0),
        )?;
        assert!(logged.contains("memory-chunk-a"));
        Ok(())
    }

    #[test]
    fn adopted_draft_change_invalidates_old_memory_inside_transaction(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        put_document(
            &mut connection,
            document_input("novel-a", "memory-doc-a", "memory-chunk-a"),
        )?;
        let transaction = connection.transaction()?;
        let affected = invalidate_for_adopted_draft_change(
            &transaction,
            "novel-a",
            "chapter-a",
            "draft-new",
            "later",
        )?;
        assert_eq!(affected, 1);
        transaction.commit()?;
        let status: (String, Option<String>) = connection.query_row(
            "SELECT status, invalidation_reason FROM memory_documents WHERE id = 'memory-doc-a'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(status.0, "invalidated");
        assert_eq!(status.1.as_deref(), Some("adopted_draft_changed"));
        Ok(())
    }
}
