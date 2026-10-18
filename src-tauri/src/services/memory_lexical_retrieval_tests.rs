use super::memory_comparison_corpus;
use super::memory_lexical_retrieval::{search_lexical, LexicalSearchRequest};
use crate::errors::codes;
use rusqlite::{params, Connection};
use super::{
    retrieve, MemoryRetrievalFilters, QueryEmbeddingInput, RetrieveMemoryInput,
    RetrieveMemoryOutput,
};

const NO_FTS_ORDER: &[&str] = &[
    "chunk-long",
    "chunk-weak",
    "chunk-tie-a",
    "chunk-tie-b",
    "chunk-summary",
    "chunk-exact",
];

fn open_comparison_db(with_fts: bool) -> Result<Connection, String> {
    let connection = Connection::open_in_memory().map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "CREATE TABLE memory_documents (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_id TEXT NOT NULL,
                source_version INTEGER NOT NULL,
                source_hash TEXT NOT NULL,
                adopted_draft_id TEXT,
                chapter_id TEXT,
                status TEXT NOT NULL,
                metadata_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                invalidated_at TEXT,
                invalidation_reason TEXT
            );
            CREATE TABLE memory_chunks (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                novel_id TEXT NOT NULL,
                chapter_id TEXT,
                ordinal INTEGER NOT NULL,
                text TEXT NOT NULL,
                token_count INTEGER NOT NULL,
                importance REAL NOT NULL,
                chapter_order_index INTEGER,
                temporal_start_chapter INTEGER,
                temporal_end_chapter INTEGER,
                entity_keys_json TEXT NOT NULL,
                metadata_json TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE memory_embeddings (
                id TEXT PRIMARY KEY,
                chunk_id TEXT NOT NULL,
                novel_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                dimension INTEGER NOT NULL,
                vector_json TEXT NOT NULL,
                vector_norm REAL NOT NULL,
                vector_hash TEXT NOT NULL,
                chunk_content_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE memory_retrieval_logs (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                query_hash TEXT NOT NULL,
                query_embedding_hash TEXT,
                filters_json TEXT NOT NULL,
                retrieval_mode TEXT NOT NULL,
                embedding_provider TEXT,
                embedding_model TEXT,
                embedding_dimension INTEGER,
                fts_available INTEGER NOT NULL,
                candidate_count INTEGER NOT NULL,
                selected_chunk_ids_json TEXT NOT NULL,
                score_reasons_json TEXT NOT NULL,
                top_k INTEGER NOT NULL,
                page_offset INTEGER NOT NULL,
                token_budget INTEGER NOT NULL,
                used_tokens INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );",
        )
        .map_err(|error| error.to_string())?;
    memory_comparison_corpus::insert_app(&connection)?;
    if with_fts {
        memory_comparison_corpus::install_fts(&connection)?;
    }
    Ok(connection)
}

fn boundary_filters() -> MemoryRetrievalFilters {
    MemoryRetrievalFilters {
        chapter_end: Some(1),
        temporal_chapter: Some(2),
        ..MemoryRetrievalFilters::default()
    }
}

fn retrieval_input(
    request_id: &str,
    query: &str,
    filters: MemoryRetrievalFilters,
    embedding: Option<QueryEmbeddingInput>,
) -> RetrieveMemoryInput {
    RetrieveMemoryInput {
        trace_id: None,
        request_id: request_id.to_string(),
        novel_id: "novel-1".to_string(),
        query: query.to_string(),
        query_embedding: embedding,
        filters,
        top_k: 20,
        offset: 0,
        candidate_limit: 50,
        token_budget: 10_000,
    }
}

fn lexical_request<'a>(
    query: &'a str,
    source_types: &'a [String],
    min_importance: f64,
) -> LexicalSearchRequest<'a> {
    LexicalSearchRequest {
        novel_id: "novel-1",
        query,
        top_k: 20,
        chapter_id: None,
        chapter_start: None,
        chapter_end: Some(1),
        temporal_chapter: Some(2),
        source_types,
        min_importance,
        candidate_limit: 50,
    }
}

fn item_ids(output: &RetrieveMemoryOutput) -> Vec<String> {
    output
        .items
        .iter()
        .map(|item| item.chunk_id.clone())
        .collect()
}

#[test]
fn retrieve_matches_shared_lexical_search_on_isolated_sqlite() -> Result<(), String> {
    for with_fts in [false, true] {
        let mut connection = open_comparison_db(with_fts)?;
        let before = connection.total_changes();
        let shared = search_lexical(&connection, &lexical_request("铜钥匙", &[], 0.0))?;
        assert_eq!(connection.total_changes(), before);
        let found = retrieve(
            &mut connection,
            retrieval_input(
                &format!("cmp-{with_fts}"),
                "铜钥匙",
                boundary_filters(),
                None,
            ),
        )
        .map_err(|error| error.to_string())?;
        let ids = item_ids(&found);
        let shared_ids: Vec<_> = shared
            .hits
            .iter()
            .map(|hit| hit.chunk_id.clone())
            .collect::<Vec<_>>();
        assert_eq!(ids, shared_ids);
        for banned in [
            "chunk-important-irrelevant",
            "chunk-target",
            "chunk-future",
            "chunk-not-yet",
            "chunk-expired",
            "chunk-invalid",
            "chunk-other-novel",
        ] {
            assert!(!ids.iter().any(|id| id == banned), "{banned} leaked");
        }
        assert_eq!(
            found.retrieval_mode,
            if with_fts {
                "fts_structured"
            } else {
                "lexical_structured"
            }
        );
        if !with_fts {
            assert_eq!(ids, NO_FTS_ORDER);
            assert_ne!(ids.first().map(String::as_str), Some("chunk-weak"));
        }
        let long = found
            .items
            .iter()
            .find(|item| item.chunk_id == "chunk-long")
            .expect("long chinese chunk");
        assert!(long.text.contains("铜钥匙"));
        assert!(long.text.chars().count() > 2_000);
    }
    Ok(())
}

#[test]
fn empty_query_stays_structured_and_is_not_a_lexical_miss() -> Result<(), String> {
    let mut connection = open_comparison_db(false)?;
    let empty = retrieve(
        &mut connection,
        retrieval_input(
            "empty-filter",
            "   ",
            MemoryRetrievalFilters {
                min_importance: Some(0.9),
                ..MemoryRetrievalFilters::default()
            },
            None,
        ),
    )
    .map_err(|error| error.to_string())?;
    assert_eq!(empty.retrieval_mode, "structured");
    assert!(item_ids(&empty).iter().any(|id| id == "chunk-important-irrelevant"));
    assert!(search_lexical(&connection, &lexical_request("   ", &[], 0.0)).is_err());

    let missing_filter = retrieve(
        &mut connection,
        retrieval_input("empty-none", "", MemoryRetrievalFilters::default(), None),
    )
    .expect_err("an empty query without a filter is invalid, not a no-hit");
    assert_eq!(missing_filter.code, codes::MEMORY_RETRIEVAL_INVALID);
    Ok(())
}

#[test]
fn hybrid_embedding_keeps_semantic_evidence_without_lexical_text() -> Result<(), String> {
    let mut connection = open_comparison_db(false)?;
    connection
        .execute(
            "INSERT INTO memory_embeddings (
                id, chunk_id, novel_id, provider, model, dimension, vector_json, vector_norm,
                vector_hash, chunk_content_hash, created_at
             ) VALUES (
                'emb-irrelevant', 'chunk-important-irrelevant', 'novel-1', 'embedder', 'm1', 3,
                '[1.0,0.0,0.0]', 1.0, ?1, ?1, '2026-08-21T00:00:00Z'
             )",
            params![memory_comparison_corpus::CONTENT_HASH],
        )
        .map_err(|error| error.to_string())?;
    let lexical_only = retrieve(
        &mut connection,
        retrieval_input("hybrid-off", "铜钥匙", boundary_filters(), None),
    )
    .map_err(|error| error.to_string())?;
    assert!(!item_ids(&lexical_only)
        .iter()
        .any(|id| id == "chunk-important-irrelevant"));

    let hybrid = retrieve(
        &mut connection,
        retrieval_input(
            "hybrid-on",
            "铜钥匙",
            boundary_filters(),
            Some(QueryEmbeddingInput {
                provider: "embedder".to_string(),
                model: "m1".to_string(),
                dimension: 3,
                vector: vec![1.0, 0.0, 0.0],
            }),
        ),
    )
    .map_err(|error| error.to_string())?;
    assert_eq!(hybrid.retrieval_mode, "hybrid");
    let semantic = hybrid
        .items
        .iter()
        .find(|item| item.chunk_id == "chunk-important-irrelevant")
        .expect("semantic evidence must keep a non-lexical chunk");
    assert!(semantic.score.lexical_score.is_none());
    assert!(semantic.score.semantic_score.is_some());
    assert!(hybrid
        .items
        .iter()
        .any(|item| item.chunk_id == "chunk-exact"));
    Ok(())
}

#[test]
fn source_filter_and_importance_floor_agree_with_shared_search() -> Result<(), String> {
    let mut connection = open_comparison_db(false)?;
    let summary_only = vec!["chapter_summary".to_string()];
    let shared = search_lexical(&connection, &lexical_request("铜钥匙", &summary_only, 0.0))?;
    let found = retrieve(
        &mut connection,
        retrieval_input(
            "source-summary",
            "铜钥匙",
            MemoryRetrievalFilters {
                chapter_end: Some(1),
                temporal_chapter: Some(2),
                source_types: summary_only,
                ..MemoryRetrievalFilters::default()
            },
            None,
        ),
    )
    .map_err(|error| error.to_string())?;
    assert_eq!(item_ids(&found), vec!["chunk-summary".to_string()]);
    assert_eq!(
        shared
            .hits
            .iter()
            .map(|hit| hit.chunk_id.as_str())
            .collect::<Vec<_>>(),
        vec!["chunk-summary"]
    );

    let important = search_lexical(&connection, &lexical_request("铜钥匙", &[], 0.9))?;
    assert_eq!(
        important
            .hits
            .iter()
            .map(|hit| hit.chunk_id.as_str())
            .collect::<Vec<_>>(),
        vec!["chunk-weak"]
    );
    Ok(())
}

fn insert_crowd_chunk(
    connection: &Connection,
    id: &str,
    status: &str,
    text: &str,
    importance: f64,
    chapter_order_index: i64,
    temporal_start: i64,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO memory_documents (
                id, novel_id, source_type, source_id, source_version, source_hash,
                adopted_draft_id, chapter_id, status, metadata_json, created_at, updated_at,
                invalidated_at, invalidation_reason
             ) VALUES (?1, 'novel-1', 'adopted_draft', ?1, 1, ?2, NULL, 'chapter-1', ?3, '{}',
                       '2026-08-21T00:00:00Z', '2026-08-21T00:00:00Z', NULL, NULL)",
            params![id, memory_comparison_corpus::CONTENT_HASH, status],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT INTO memory_chunks (
                id, document_id, novel_id, chapter_id, ordinal, text, token_count, importance,
                chapter_order_index, temporal_start_chapter, temporal_end_chapter,
                entity_keys_json, metadata_json, content_hash, created_at
             ) VALUES (?1, ?1, 'novel-1', 'chapter-1', 0, ?2, 4, ?3, ?4, ?5, NULL, '[]', '{}', ?6,
                       '2026-08-21T00:00:00Z')",
            params![
                id,
                text,
                importance,
                chapter_order_index,
                temporal_start,
                memory_comparison_corpus::CONTENT_HASH
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[test]
fn scoped_lexical_search_keeps_a_past_hit_beyond_the_candidate_window() -> Result<(), String> {
    let mut connection = open_comparison_db(false)?;
    for index in 0..60 {
        insert_crowd_chunk(
            &connection,
            &format!("noise-{index:02}"),
            "active",
            "粮草调度优先级",
            0.99,
            0,
            0,
        )?;
        insert_crowd_chunk(
            &connection,
            &format!("invalid-{index:02}"),
            "invalidated",
            "过去铜印已作废",
            1.0,
            0,
            0,
        )?;
        insert_crowd_chunk(
            &connection,
            &format!("temporal-{index:02}"),
            "active",
            "过去铜印尚未生效",
            0.97,
            0,
            3,
        )?;
        insert_crowd_chunk(
            &connection,
            &format!("future-{index:02}"),
            "active",
            "过去铜印在后章",
            0.98,
            3,
            0,
        )?;
    }
    insert_crowd_chunk(&connection, "past-hit", "active", "过去铜印在前章", 0.05, 0, 0)?;
    let request = LexicalSearchRequest {
        query: "过去铜印",
        candidate_limit: 50,
        top_k: 20,
        ..lexical_request("过去铜印", &[], 0.0)
    };
    let shared = search_lexical(&connection, &request)?;
    assert!(!shared.coverage_incomplete);
    assert_eq!(
        shared
            .hits
            .iter()
            .map(|hit| hit.chunk_id.as_str())
            .collect::<Vec<_>>(),
        vec!["past-hit"]
    );
    let found = retrieve(
        &mut connection,
        retrieval_input(
            "crowd-past",
            "过去铜印",
            boundary_filters(),
            None,
        ),
    )
    .map_err(|error| error.to_string())?;
    assert_eq!(item_ids(&found), vec!["past-hit".to_string()]);
    Ok(())
}
