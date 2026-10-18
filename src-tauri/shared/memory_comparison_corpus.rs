#![allow(dead_code)]

use rusqlite::{params, Connection};

pub const CONTENT_HASH: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

#[derive(Debug, Clone)]
pub struct ComparisonRow {
    pub novel_id: &'static str,
    pub chunk_id: &'static str,
    pub document_id: &'static str,
    pub source_type: &'static str,
    pub source_id: &'static str,
    pub status: &'static str,
    pub chapter_id: &'static str,
    pub text: String,
    pub importance: f64,
    pub chapter_order_index: i64,
    pub temporal_start: Option<i64>,
    pub temporal_end: Option<i64>,
    pub updated_at: &'static str,
    pub ordinal: i64,
}

pub fn comparison_corpus() -> Vec<ComparisonRow> {
    fn row(
        chunk_id: &'static str,
        source_type: &'static str,
        status: &'static str,
        chapter_id: &'static str,
        text: String,
        importance: f64,
        chapter_order_index: i64,
        temporal_start: Option<i64>,
        temporal_end: Option<i64>,
        updated_at: &'static str,
    ) -> ComparisonRow {
        ComparisonRow {
            novel_id: "novel-1",
            chunk_id,
            document_id: chunk_id,
            source_type,
            source_id: chunk_id,
            status,
            chapter_id,
            text,
            importance,
            chapter_order_index,
            temporal_start,
            temporal_end,
            updated_at,
            ordinal: 0,
        }
    }

    let mut rows = vec![
        row(
            "chunk-exact",
            "adopted_draft",
            "active",
            "chapter-1",
            "铜钥匙".to_string(),
            0.15,
            0,
            Some(0),
            None,
            "2026-08-21T00:00:01Z",
        ),
        row(
            "chunk-important-irrelevant",
            "adopted_draft",
            "active",
            "chapter-1",
            "帝国粮草调度与城防礼仪是最高优先级设定".to_string(),
            0.99,
            0,
            Some(0),
            None,
            "2026-08-21T00:00:02Z",
        ),
        row(
            "chunk-weak",
            "adopted_draft",
            "active",
            "chapter-1",
            format!("铜钥匙{}", "的".repeat(800)),
            0.95,
            0,
            Some(0),
            None,
            "2026-08-21T00:00:03Z",
        ),
        row(
            "chunk-long",
            "adopted_draft",
            "active",
            "chapter-2",
            format!("{}铜钥匙{}", "序".repeat(2_500), "尾".repeat(2_500)),
            0.40,
            1,
            Some(1),
            None,
            "2026-08-21T00:00:04Z",
        ),
        row(
            "chunk-summary",
            "chapter_summary",
            "active",
            "chapter-1",
            "铜钥匙写入章节总结".to_string(),
            0.30,
            0,
            Some(0),
            None,
            "2026-08-21T00:00:05Z",
        ),
        row(
            "chunk-tie-a",
            "context_record",
            "active",
            "chapter-1",
            "铜钥匙同文".to_string(),
            0.50,
            0,
            Some(0),
            None,
            "2026-08-21T00:00:06Z",
        ),
        row(
            "chunk-tie-b",
            "context_record",
            "active",
            "chapter-1",
            "铜钥匙同文".to_string(),
            0.50,
            0,
            Some(0),
            None,
            "2026-08-21T00:00:07Z",
        ),
        row(
            "chunk-target",
            "adopted_draft",
            "active",
            "chapter-3",
            "铜钥匙出现在目标章".to_string(),
            0.99,
            2,
            Some(2),
            None,
            "2026-08-21T00:00:08Z",
        ),
        row(
            "chunk-future",
            "adopted_draft",
            "active",
            "chapter-4",
            "铜钥匙出现在后章".to_string(),
            0.99,
            3,
            Some(3),
            None,
            "2026-08-21T00:00:09Z",
        ),
        row(
            "chunk-not-yet",
            "context_record",
            "active",
            "chapter-1",
            "铜钥匙未来才生效".to_string(),
            0.97,
            0,
            Some(3),
            None,
            "2026-08-21T00:00:10Z",
        ),
        row(
            "chunk-expired",
            "context_record",
            "active",
            "chapter-1",
            "铜钥匙已经失效".to_string(),
            0.96,
            0,
            Some(0),
            Some(0),
            "2026-08-21T00:00:11Z",
        ),
        row(
            "chunk-invalid",
            "adopted_draft",
            "invalidated",
            "chapter-1",
            "铜钥匙来自作废稿".to_string(),
            1.0,
            0,
            Some(0),
            None,
            "2026-08-21T00:00:12Z",
        ),
    ];
    let mut other = row(
        "chunk-other-novel",
        "adopted_draft",
        "active",
        "chapter-1",
        "铜钥匙在别的书里".to_string(),
        1.0,
        0,
        Some(0),
        None,
        "2026-08-21T00:00:13Z",
    );
    other.novel_id = "novel-2";
    rows.push(other);
    rows
}

pub fn insert_gateway(connection: &Connection) -> Result<(), String> {
    for row in comparison_corpus() {
        connection
            .execute(
                "INSERT INTO memory_documents (
                    id, novel_id, source_type, source_id, source_version, status, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)",
                params![
                    row.document_id,
                    row.novel_id,
                    row.source_type,
                    row.source_id,
                    row.status,
                    row.updated_at
                ],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO memory_chunks (
                    id, document_id, novel_id, chapter_id, ordinal, text, importance,
                    chapter_order_index, temporal_start_chapter, temporal_end_chapter,
                    entity_keys_json, metadata_json
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, '[]', '{}')",
                params![
                    row.chunk_id,
                    row.document_id,
                    row.novel_id,
                    row.chapter_id,
                    row.ordinal,
                    row.text,
                    row.importance,
                    row.chapter_order_index,
                    row.temporal_start,
                    row.temporal_end
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn insert_app(connection: &Connection) -> Result<(), String> {
    for row in comparison_corpus() {
        connection
            .execute(
                "INSERT INTO memory_documents (
                    id, novel_id, source_type, source_id, source_version, source_hash,
                    adopted_draft_id, chapter_id, status, metadata_json, created_at, updated_at,
                    invalidated_at, invalidation_reason
                 ) VALUES (?1, ?2, ?3, ?4, 1, ?5, NULL, ?6, ?7, '{}', ?8, ?8, NULL, NULL)",
                params![
                    row.document_id,
                    row.novel_id,
                    row.source_type,
                    row.source_id,
                    CONTENT_HASH,
                    row.chapter_id,
                    row.status,
                    row.updated_at
                ],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO memory_chunks (
                    id, document_id, novel_id, chapter_id, ordinal, text, token_count, importance,
                    chapter_order_index, temporal_start_chapter, temporal_end_chapter,
                    entity_keys_json, metadata_json, content_hash, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 4, ?7, ?8, ?9, ?10, '[]', '{}', ?11, ?12)",
                params![
                    row.chunk_id,
                    row.document_id,
                    row.novel_id,
                    row.chapter_id,
                    row.ordinal,
                    row.text,
                    row.importance,
                    row.chapter_order_index,
                    row.temporal_start,
                    row.temporal_end,
                    CONTENT_HASH,
                    row.updated_at
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn install_fts(connection: &Connection) -> Result<(), String> {
    let trigram = connection.execute_batch(
        "CREATE VIRTUAL TABLE memory_chunks_fts USING fts5(
            chunk_id UNINDEXED, novel_id UNINDEXED, text, tokenize='trigram'
         );",
    );
    if trigram.is_err() {
        connection
            .execute_batch(
                "CREATE VIRTUAL TABLE memory_chunks_fts USING fts5(
                    chunk_id UNINDEXED, novel_id UNINDEXED, text, tokenize='unicode61'
                 );",
            )
            .map_err(|error| error.to_string())?;
    }
    connection
        .execute(
            "INSERT INTO memory_chunks_fts (chunk_id, novel_id, text)
             SELECT id, novel_id, text FROM memory_chunks",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}
