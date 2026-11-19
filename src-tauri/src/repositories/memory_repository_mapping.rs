//! Row-to-domain mapping shared by memory repository queries.
use super::{MemoryChunk, MemoryDocument, MemoryEmbedding};
use rusqlite::Row;

pub(super) fn map_document(row: &Row<'_>) -> rusqlite::Result<MemoryDocument> {
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

pub(super) const DOCUMENT_SELECT: &str =
    "SELECT id, novel_id, source_type, source_id, source_version, source_hash,
            adopted_draft_id, chapter_id, status, metadata_json, created_at, updated_at,
            invalidated_at, invalidation_reason
     FROM memory_documents";

pub(super) fn map_chunk(row: &Row<'_>) -> rusqlite::Result<MemoryChunk> {
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

pub(super) const CHUNK_SELECT: &str =
    "SELECT id, document_id, novel_id, chapter_id, ordinal, text, token_count,
            importance, chapter_order_index, temporal_start_chapter, temporal_end_chapter,
            entity_keys_json, metadata_json, content_hash, created_at
     FROM memory_chunks";

pub(super) fn map_embedding_at(
    row: &Row<'_>,
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
