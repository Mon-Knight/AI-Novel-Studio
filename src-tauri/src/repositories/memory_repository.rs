use crate::errors::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDocument {
    pub id: String,
    pub novel_id: String,
    pub source_type: String,
    pub source_id: String,
    pub source_version: i64,
    pub source_hash: String,
    pub adopted_draft_id: Option<String>,
    pub chapter_id: Option<String>,
    pub status: String,
    pub metadata_json: String,
    pub created_at: String,
    pub updated_at: String,
    pub invalidated_at: Option<String>,
    pub invalidation_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryChunk {
    pub id: String,
    pub document_id: String,
    pub novel_id: String,
    pub chapter_id: Option<String>,
    pub ordinal: i64,
    pub text: String,
    pub token_count: i64,
    pub importance: f64,
    pub chapter_order_index: Option<i64>,
    pub temporal_start_chapter: Option<i64>,
    pub temporal_end_chapter: Option<i64>,
    pub entity_keys_json: String,
    pub metadata_json: String,
    pub content_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEmbedding {
    pub id: String,
    pub chunk_id: String,
    pub novel_id: String,
    pub provider: String,
    pub model: String,
    pub dimension: i64,
    pub vector_json: String,
    pub vector_norm: f64,
    pub vector_hash: String,
    pub chunk_content_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct MemoryCandidate {
    pub chunk: MemoryChunk,
    pub document: MemoryDocument,
    pub embedding: Option<MemoryEmbedding>,
}

fn map_document(row: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryDocument> {
    Ok(MemoryDocument {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        source_type: row.get(2)?,
        source_id: row.get(3)?,
        source_version: row.get(4)?,
        source_hash: row.get(5)?,
        adopted_draft_id: row.get(6)?,
        chapter_id: row.get(7)?,
        status: row.get(8)?,
        metadata_json: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        invalidated_at: row.get(12)?,
        invalidation_reason: row.get(13)?,
    })
}

const DOCUMENT_SELECT: &str =
    "SELECT id, novel_id, source_type, source_id, source_version, source_hash,
            adopted_draft_id, chapter_id, status, metadata_json, created_at, updated_at,
            invalidated_at, invalidation_reason
     FROM memory_documents";

fn map_chunk(row: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryChunk> {
    Ok(MemoryChunk {
        id: row.get(0)?,
        document_id: row.get(1)?,
        novel_id: row.get(2)?,
        chapter_id: row.get(3)?,
        ordinal: row.get(4)?,
        text: row.get(5)?,
        token_count: row.get(6)?,
        importance: row.get(7)?,
        chapter_order_index: row.get(8)?,
        temporal_start_chapter: row.get(9)?,
        temporal_end_chapter: row.get(10)?,
        entity_keys_json: row.get(11)?,
        metadata_json: row.get(12)?,
        content_hash: row.get(13)?,
        created_at: row.get(14)?,
    })
}

const CHUNK_SELECT: &str =
    "SELECT id, document_id, novel_id, chapter_id, ordinal, text, token_count,
            importance, chapter_order_index, temporal_start_chapter, temporal_end_chapter,
            entity_keys_json, metadata_json, content_hash, created_at
     FROM memory_chunks";

fn map_embedding_at(
    row: &rusqlite::Row<'_>,
    offset: usize,
) -> rusqlite::Result<Option<MemoryEmbedding>> {
    let id = row.get::<_, Option<String>>(offset)?;
    match id {
        None => Ok(None),
        Some(id) => Ok(Some(MemoryEmbedding {
            id,
            chunk_id: row.get(offset + 1)?,
            novel_id: row.get(offset + 2)?,
            provider: row.get(offset + 3)?,
            model: row.get(offset + 4)?,
            dimension: row.get(offset + 5)?,
            vector_json: row.get(offset + 6)?,
            vector_norm: row.get(offset + 7)?,
            vector_hash: row.get(offset + 8)?,
            chunk_content_hash: row.get(offset + 9)?,
            created_at: row.get(offset + 10)?,
        })),
    }
}

pub fn find_document(
    connection: &Connection,
    novel_id: &str,
    document_id: &str,
) -> Result<Option<MemoryDocument>, AppError> {
    connection
        .query_row(
            &format!("{DOCUMENT_SELECT} WHERE novel_id = ?1 AND id = ?2"),
            params![novel_id, document_id],
            map_document,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn find_document_by_identity(
    connection: &Connection,
    novel_id: &str,
    source_type: &str,
    source_id: &str,
    source_version: i64,
    source_hash: &str,
) -> Result<Option<MemoryDocument>, AppError> {
    connection
        .query_row(
            &format!(
                "{DOCUMENT_SELECT}
                 WHERE novel_id = ?1 AND source_type = ?2 AND source_id = ?3
                   AND source_version = ?4 AND source_hash = ?5 AND status = 'active'
                 ORDER BY updated_at DESC, id DESC
                 LIMIT 1"
            ),
            params![
                novel_id,
                source_type,
                source_id,
                source_version,
                source_hash
            ],
            map_document,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn insert_document(connection: &Connection, document: &MemoryDocument) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO memory_documents
                (id, novel_id, source_type, source_id, source_version, source_hash,
                 adopted_draft_id, chapter_id, status, metadata_json, created_at, updated_at,
                 invalidated_at, invalidation_reason)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                document.id,
                document.novel_id,
                document.source_type,
                document.source_id,
                document.source_version,
                document.source_hash,
                document.adopted_draft_id,
                document.chapter_id,
                document.status,
                document.metadata_json,
                document.created_at,
                document.updated_at,
                document.invalidated_at,
                document.invalidation_reason,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

pub fn invalidate_active_source_versions(
    connection: &Connection,
    novel_id: &str,
    source_type: &str,
    source_id: &str,
    except_document_id: &str,
    now: &str,
    reason: &str,
) -> Result<usize, AppError> {
    connection
        .execute(
            "UPDATE memory_documents
             SET status = 'invalidated', invalidated_at = ?1, invalidation_reason = ?2,
                 updated_at = ?1
             WHERE novel_id = ?3 AND source_type = ?4 AND source_id = ?5
               AND status = 'active' AND id <> ?6",
            params![
                now,
                reason,
                novel_id,
                source_type,
                source_id,
                except_document_id
            ],
        )
        .map_err(AppError::database)
}

pub fn invalidate_for_adopted_draft_change(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
    new_adopted_draft_id: &str,
    now: &str,
) -> Result<usize, AppError> {
    connection
        .execute(
            "UPDATE memory_documents
             SET status = 'invalidated', invalidated_at = ?1,
                 invalidation_reason = 'adopted_draft_changed', updated_at = ?1
             WHERE novel_id = ?2 AND chapter_id = ?3 AND status = 'active'
               AND (adopted_draft_id IS NULL OR adopted_draft_id <> ?4)",
            params![now, novel_id, chapter_id, new_adopted_draft_id],
        )
        .map_err(AppError::database)
}

pub fn invalidate_document(
    connection: &Connection,
    novel_id: &str,
    document_id: &str,
    expected_source_hash: &str,
    reason: &str,
    now: &str,
) -> Result<usize, AppError> {
    connection
        .execute(
            "UPDATE memory_documents
             SET status = 'invalidated', invalidated_at = ?1, invalidation_reason = ?2,
                 updated_at = ?1
             WHERE novel_id = ?3 AND id = ?4 AND source_hash = ?5 AND status = 'active'",
            params![now, reason, novel_id, document_id, expected_source_hash],
        )
        .map_err(AppError::database)
}

pub fn insert_chunk(connection: &Connection, chunk: &MemoryChunk) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO memory_chunks
                (id, document_id, novel_id, chapter_id, ordinal, text, token_count, importance,
                 chapter_order_index, temporal_start_chapter, temporal_end_chapter,
                 entity_keys_json, metadata_json, content_hash, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                chunk.id,
                chunk.document_id,
                chunk.novel_id,
                chunk.chapter_id,
                chunk.ordinal,
                chunk.text,
                chunk.token_count,
                chunk.importance,
                chunk.chapter_order_index,
                chunk.temporal_start_chapter,
                chunk.temporal_end_chapter,
                chunk.entity_keys_json,
                chunk.metadata_json,
                chunk.content_hash,
                chunk.created_at,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

pub fn list_chunks(
    connection: &Connection,
    novel_id: &str,
    document_id: &str,
) -> Result<Vec<MemoryChunk>, AppError> {
    let mut statement = connection
        .prepare(&format!(
            "{CHUNK_SELECT} WHERE novel_id = ?1 AND document_id = ?2 ORDER BY ordinal ASC"
        ))
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![novel_id, document_id], map_chunk)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}

pub fn find_chunk_scope(
    connection: &Connection,
    novel_id: &str,
    chunk_id: &str,
) -> Result<Option<(String, String)>, AppError> {
    connection
        .query_row(
            "SELECT document_id, content_hash FROM memory_chunks
             WHERE novel_id = ?1 AND id = ?2",
            params![novel_id, chunk_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(AppError::database)
}

pub fn embedding_dimension_for_model(
    connection: &Connection,
    novel_id: &str,
    provider: &str,
    model: &str,
) -> Result<Option<i64>, AppError> {
    connection
        .query_row(
            "SELECT dimension FROM memory_embeddings
             WHERE novel_id = ?1 AND provider = ?2 AND model = ?3
             ORDER BY created_at ASC, id ASC LIMIT 1",
            params![novel_id, provider, model],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)
}

#[allow(clippy::too_many_arguments)]
pub fn upsert_embedding(
    connection: &Connection,
    id: &str,
    chunk_id: &str,
    novel_id: &str,
    provider: &str,
    model: &str,
    dimension: i64,
    vector_json: &str,
    vector_norm: f64,
    vector_hash: &str,
    chunk_content_hash: &str,
    now: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO memory_embeddings
                (id, chunk_id, novel_id, provider, model, dimension, vector_json, vector_norm,
                 vector_hash, chunk_content_hash, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(chunk_id, provider, model) DO UPDATE SET
                 dimension = excluded.dimension,
                 vector_json = excluded.vector_json,
                 vector_norm = excluded.vector_norm,
                 vector_hash = excluded.vector_hash,
                 chunk_content_hash = excluded.chunk_content_hash,
                 created_at = excluded.created_at",
            params![
                id,
                chunk_id,
                novel_id,
                provider,
                model,
                dimension,
                vector_json,
                vector_norm,
                vector_hash,
                chunk_content_hash,
                now,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

pub fn find_embedding(
    connection: &Connection,
    novel_id: &str,
    chunk_id: &str,
    provider: &str,
    model: &str,
) -> Result<Option<MemoryEmbedding>, AppError> {
    connection
        .query_row(
            "SELECT id, chunk_id, novel_id, provider, model, dimension, vector_json,
                    vector_norm, vector_hash, chunk_content_hash, created_at
             FROM memory_embeddings
             WHERE novel_id = ?1 AND chunk_id = ?2 AND provider = ?3 AND model = ?4",
            params![novel_id, chunk_id, provider, model],
            |row| {
                Ok(MemoryEmbedding {
                    id: row.get(0)?,
                    chunk_id: row.get(1)?,
                    novel_id: row.get(2)?,
                    provider: row.get(3)?,
                    model: row.get(4)?,
                    dimension: row.get(5)?,
                    vector_json: row.get(6)?,
                    vector_norm: row.get(7)?,
                    vector_hash: row.get(8)?,
                    chunk_content_hash: row.get(9)?,
                    created_at: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(AppError::database)
}

pub fn fts_available(connection: &Connection) -> Result<bool, AppError> {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master
                WHERE type = 'table' AND name = 'memory_chunks_fts'
             )",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value == 1)
        .map_err(AppError::database)
}

pub fn lexical_chunk_ids(
    connection: &Connection,
    novel_id: &str,
    escaped_match_query: &str,
    limit: i64,
) -> Result<Vec<String>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT chunk_id FROM memory_chunks_fts
             WHERE memory_chunks_fts MATCH ?1 AND novel_id = ?2
             ORDER BY bm25(memory_chunks_fts), chunk_id ASC LIMIT ?3",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![escaped_match_query, novel_id, limit], |row| {
            row.get(0)
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}

fn map_candidate(row: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryCandidate> {
    let chunk = map_chunk(row)?;
    let document = MemoryDocument {
        id: row.get(15)?,
        novel_id: row.get(16)?,
        source_type: row.get(17)?,
        source_id: row.get(18)?,
        source_version: row.get(19)?,
        source_hash: row.get(20)?,
        adopted_draft_id: row.get(21)?,
        chapter_id: row.get(22)?,
        status: row.get(23)?,
        metadata_json: row.get(24)?,
        created_at: row.get(25)?,
        updated_at: row.get(26)?,
        invalidated_at: row.get(27)?,
        invalidation_reason: row.get(28)?,
    };
    Ok(MemoryCandidate {
        chunk,
        document,
        embedding: map_embedding_at(row, 29)?,
    })
}

const CANDIDATE_SELECT: &str = "SELECT
        c.id, c.document_id, c.novel_id, c.chapter_id, c.ordinal, c.text, c.token_count,
        c.importance, c.chapter_order_index, c.temporal_start_chapter, c.temporal_end_chapter,
        c.entity_keys_json, c.metadata_json, c.content_hash, c.created_at,
        d.id, d.novel_id, d.source_type, d.source_id, d.source_version, d.source_hash,
        d.adopted_draft_id, d.chapter_id, d.status, d.metadata_json, d.created_at,
        d.updated_at, d.invalidated_at, d.invalidation_reason,
        e.id, e.chunk_id, e.novel_id, e.provider, e.model, e.dimension, e.vector_json,
        e.vector_norm, e.vector_hash, e.chunk_content_hash, e.created_at
     FROM memory_chunks c
     INNER JOIN memory_documents d
       ON d.id = c.document_id AND d.novel_id = c.novel_id
     LEFT JOIN memory_embeddings e
       ON e.chunk_id = c.id AND e.novel_id = c.novel_id
      AND e.provider = ?6 AND e.model = ?7";

#[allow(clippy::too_many_arguments)]
pub fn fetch_candidates(
    connection: &Connection,
    novel_id: &str,
    chapter_start: Option<i64>,
    chapter_end: Option<i64>,
    chapter_id: Option<&str>,
    min_importance: Option<f64>,
    embedding_provider: Option<&str>,
    embedding_model: Option<&str>,
    limit: i64,
) -> Result<Vec<MemoryCandidate>, AppError> {
    let sql = format!(
        "{CANDIDATE_SELECT}
         WHERE d.novel_id = ?1 AND d.status = 'active'
           AND (?2 IS NULL OR c.chapter_order_index >= ?2)
           AND (?3 IS NULL OR c.chapter_order_index <= ?3)
           AND (?4 IS NULL OR c.chapter_id = ?4)
           AND (?5 IS NULL OR c.importance >= ?5)
         ORDER BY c.importance DESC, COALESCE(c.chapter_order_index, -1) DESC,
                  d.updated_at DESC, c.ordinal ASC, c.id ASC
         LIMIT ?8"
    );
    let mut statement = connection.prepare(&sql).map_err(AppError::database)?;
    let rows = statement
        .query_map(
            params![
                novel_id,
                chapter_start,
                chapter_end,
                chapter_id,
                min_importance,
                embedding_provider.unwrap_or(""),
                embedding_model.unwrap_or(""),
                limit,
            ],
            map_candidate,
        )
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}

pub fn fetch_candidate_by_id(
    connection: &Connection,
    novel_id: &str,
    chunk_id: &str,
    embedding_provider: Option<&str>,
    embedding_model: Option<&str>,
) -> Result<Option<MemoryCandidate>, AppError> {
    let sql = format!(
        "{CANDIDATE_SELECT}
         WHERE d.novel_id = ?1 AND d.status = 'active' AND c.id = ?2"
    );
    connection
        .query_row(
            &sql,
            params![
                novel_id,
                chunk_id,
                Option::<i64>::None,
                Option::<i64>::None,
                Option::<f64>::None,
                embedding_provider.unwrap_or(""),
                embedding_model.unwrap_or("")
            ],
            map_candidate,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn list_documents(
    connection: &Connection,
    novel_id: &str,
    status: Option<&str>,
    offset: i64,
    limit: i64,
) -> Result<(i64, Vec<MemoryDocument>), AppError> {
    let total = connection
        .query_row(
            "SELECT COUNT(*) FROM memory_documents
             WHERE novel_id = ?1 AND (?2 IS NULL OR status = ?2)",
            params![novel_id, status],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    let mut statement = connection
        .prepare(&format!(
            "{DOCUMENT_SELECT}
             WHERE novel_id = ?1 AND (?2 IS NULL OR status = ?2)
             ORDER BY updated_at DESC, id DESC LIMIT ?3 OFFSET ?4"
        ))
        .map_err(AppError::database)?;
    let documents = statement
        .query_map(params![novel_id, status, limit, offset], map_document)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok((total, documents))
}

#[allow(clippy::too_many_arguments)]
pub fn insert_retrieval_log(
    connection: &Connection,
    id: &str,
    novel_id: &str,
    query_hash: &str,
    query_embedding_hash: Option<&str>,
    filters_json: &str,
    retrieval_mode: &str,
    embedding_provider: Option<&str>,
    embedding_model: Option<&str>,
    embedding_dimension: Option<i64>,
    fts_available: bool,
    candidate_count: i64,
    selected_chunk_ids_json: &str,
    score_reasons_json: &str,
    top_k: i64,
    page_offset: i64,
    token_budget: i64,
    used_tokens: i64,
    created_at: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO memory_retrieval_logs
                (id, novel_id, query_hash, query_embedding_hash, filters_json, retrieval_mode,
                 embedding_provider, embedding_model, embedding_dimension, fts_available,
                 candidate_count, selected_chunk_ids_json, score_reasons_json, top_k,
                 page_offset, token_budget, used_tokens, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                     ?14, ?15, ?16, ?17, ?18)",
            params![
                id,
                novel_id,
                query_hash,
                query_embedding_hash,
                filters_json,
                retrieval_mode,
                embedding_provider,
                embedding_model,
                embedding_dimension,
                i64::from(fts_available),
                candidate_count,
                selected_chunk_ids_json,
                score_reasons_json,
                top_k,
                page_offset,
                token_budget,
                used_tokens,
                created_at,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}
