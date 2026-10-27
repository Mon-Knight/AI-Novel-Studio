use super::{
    candidate_matches_filters, parse_entity_keys, parse_metadata, RetrieveMemoryInput,
    MAX_FETCH_CANDIDATES,
};
use crate::errors::{codes, AppError};
use crate::repositories::memory_repository;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::HashMap;

pub(super) struct LoadedCandidates {
    pub candidates: HashMap<String, (memory_repository::MemoryCandidate, Vec<String>, Value)>,
    pub lexical_scores: HashMap<String, f64>,
    pub fts_available: bool,
}

pub(super) fn load_candidates(
    connection: &Connection,
    input: &RetrieveMemoryInput,
    embedding_provider: Option<&str>,
    embedding_model: Option<&str>,
) -> Result<LoadedCandidates, AppError> {
    let query = input.query.trim();
    if !query.is_empty() && input.query_embedding.is_none() {
        return load_scoped_lexical(
            connection,
            input,
            query,
            embedding_provider,
            embedding_model,
        );
    }
    load_structured_window(
        connection,
        input,
        query,
        embedding_provider,
        embedding_model,
    )
}

fn load_scoped_lexical(
    connection: &Connection,
    input: &RetrieveMemoryInput,
    query: &str,
    embedding_provider: Option<&str>,
    embedding_model: Option<&str>,
) -> Result<LoadedCandidates, AppError> {
    let found = super::memory_lexical_retrieval::search_lexical(
        connection,
        &super::memory_lexical_retrieval::LexicalSearchRequest {
            novel_id: &input.novel_id,
            query,
            top_k: input.candidate_limit,
            chapter_id: input.filters.chapter_id.as_deref(),
            chapter_start: input.filters.chapter_start,
            chapter_end: input.filters.chapter_end,
            temporal_chapter: input.filters.temporal_chapter,
            source_types: &input.filters.source_types,
            min_importance: input.filters.min_importance.unwrap_or(0.0),
            candidate_limit: input.candidate_limit,
        },
    )
    .map_err(|message| {
        AppError::new(
            codes::MEMORY_RETRIEVAL_INVALID,
            "Memory 词法检索失败",
            false,
        )
        .with_details(json!({ "reason": message }))
    })?;
    let mut candidates = HashMap::new();
    let mut lexical_scores = HashMap::new();
    for hit in found.hits {
        let Some(candidate) = memory_repository::fetch_candidate_by_id(
            connection,
            &input.novel_id,
            &hit.chunk_id,
            embedding_provider,
            embedding_model,
        )?
        else {
            continue;
        };
        let entity_keys = parse_entity_keys(&candidate.chunk.entity_keys_json)?;
        if !candidate_matches_filters(&candidate, &entity_keys, &input.filters) {
            continue;
        }
        lexical_scores.insert(hit.chunk_id.clone(), hit.lexical_score);
        let metadata = parse_metadata(&candidate.chunk.metadata_json)?;
        candidates.insert(hit.chunk_id, (candidate, entity_keys, metadata));
    }
    Ok(LoadedCandidates {
        candidates,
        lexical_scores,
        fts_available: found.fts_available,
    })
}

fn load_structured_window(
    connection: &Connection,
    input: &RetrieveMemoryInput,
    query: &str,
    embedding_provider: Option<&str>,
    embedding_model: Option<&str>,
) -> Result<LoadedCandidates, AppError> {
    let fts_available = memory_repository::fts_available(connection)?;
    let fetch_limit = (input.candidate_limit * 4).min(MAX_FETCH_CANDIDATES);
    let structured = memory_repository::fetch_candidates(
        connection,
        &input.novel_id,
        input.filters.chapter_start,
        input.filters.chapter_end,
        input.filters.chapter_id.as_deref(),
        input.filters.min_importance,
        embedding_provider,
        embedding_model,
        fetch_limit,
    )?;
    let mut candidates = HashMap::new();
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
    let mut lexical_scores = HashMap::new();
    if !query.is_empty() && fts_available {
        let lexical_ids = memory_repository::lexical_chunk_ids(
            connection,
            &input.novel_id,
            &super::memory_lexical_retrieval::fts_phrase_query(query),
            input.candidate_limit,
        )?;
        for (index, chunk_id) in lexical_ids.iter().enumerate() {
            lexical_scores.insert(
                chunk_id.clone(),
                super::memory_lexical_retrieval::fts_rank_score(index),
            );
            if !candidates.contains_key(chunk_id) {
                if let Some(candidate) = memory_repository::fetch_candidate_by_id(
                    connection,
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
                lexical_scores.insert(
                    chunk_id.clone(),
                    super::memory_lexical_retrieval::SUBSTRING_LEXICAL_SCORE,
                );
            }
        }
    }
    Ok(LoadedCandidates {
        candidates,
        lexical_scores,
        fts_available,
    })
}
