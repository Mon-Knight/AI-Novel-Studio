use rusqlite::Connection;
use std::cmp::Ordering;
use std::collections::HashMap;

#[path = "memory_lexical_scope.rs"]
mod memory_lexical_scope;

pub const DEFAULT_CANDIDATE_LIMIT: i64 = 50;
pub const SUBSTRING_LEXICAL_SCORE: f64 = 0.5;
const MAX_CANDIDATE_LIMIT: i64 = 500;

#[derive(Debug, Clone)]
pub struct LexicalSearchRequest<'a> {
    pub novel_id: &'a str,
    pub query: &'a str,
    pub top_k: i64,
    pub chapter_id: Option<&'a str>,
    pub chapter_start: Option<i64>,
    pub chapter_end: Option<i64>,
    pub temporal_chapter: Option<i64>,
    pub source_types: &'a [String],
    pub min_importance: f64,
    pub candidate_limit: i64,
}

#[derive(Debug, Clone)]
pub struct LexicalHit {
    pub chunk_id: String,
    pub chapter_id: String,
    pub ordinal: i64,
    pub text: String,
    pub importance: f64,
    pub chapter_order_index: Option<i64>,
    pub entity_keys_json: String,
    pub metadata_json: String,
    pub source_type: String,
    pub source_id: String,
    pub source_version: i64,
    pub lexical_score: f64,
    pub importance_score: f64,
    pub recency_score: f64,
    pub final_score: f64,
}

#[derive(Debug, Clone)]
pub struct LexicalSearchResult {
    pub hits: Vec<LexicalHit>,
    pub candidate_count: usize,
    pub fts_available: bool,
    pub lexical_path: &'static str,
    pub coverage_incomplete: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextSnippet {
    pub text: String,
    pub truncated: bool,
    pub text_chars: usize,
    pub snippet_start: usize,
    pub snippet_chars: usize,
}

struct Candidate {
    row: memory_lexical_scope::ScopedChunk,
    lexical: Option<f64>,
    from_fts: bool,
}

pub fn fts_phrase_query(query: &str) -> String {
    format!("\"{}\"", query.trim().replace('"', "\"\""))
}

pub fn fts_rank_score(index: usize) -> f64 {
    1.0 / (1.0 + index as f64)
}

pub fn combine_score(
    semantic: Option<f64>,
    lexical: Option<f64>,
    importance: f64,
    recency: f64,
) -> f64 {
    match (semantic, lexical) {
        (Some(semantic), Some(lexical)) => {
            semantic * 0.60 + lexical * 0.20 + importance * 0.10 + recency * 0.10
        }
        (Some(semantic), None) => semantic * 0.75 + importance * 0.15 + recency * 0.10,
        (None, Some(lexical)) => lexical * 0.65 + importance * 0.20 + recency * 0.15,
        (None, None) => importance * 0.60 + recency * 0.40,
    }
}

pub fn recency_score(chapter_order_index: Option<i64>, max_chapter: i64) -> f64 {
    let max_chapter = max_chapter.max(1);
    chapter_order_index
        .map(|value| (value.max(0) as f64 / max_chapter as f64).clamp(0.0, 1.0))
        .unwrap_or(0.5)
}

pub fn cmp_ranked(
    left_final: f64,
    left_chapter: Option<i64>,
    left_id: &str,
    right_final: f64,
    right_chapter: Option<i64>,
    right_id: &str,
) -> Ordering {
    right_final
        .partial_cmp(&left_final)
        .unwrap_or(Ordering::Equal)
        .then_with(|| right_chapter.cmp(&left_chapter))
        .then_with(|| left_id.cmp(right_id))
}

#[allow(dead_code)] // App retrieve still applies this after the shared SQL scope.
pub fn passes_temporal(
    temporal_start: Option<i64>,
    temporal_end: Option<i64>,
    temporal_chapter: Option<i64>,
) -> bool {
    temporal_chapter.is_none_or(|temporal| {
        !temporal_start.is_some_and(|start| temporal < start)
            && !temporal_end.is_some_and(|end| temporal > end)
    })
}

#[allow(dead_code)] // App retrieve still applies this after the shared SQL scope.
pub fn passes_chapter_bounds(
    chapter_id: Option<&str>,
    chapter_order_index: Option<i64>,
    exact_chapter_id: Option<&str>,
    chapter_start: Option<i64>,
    chapter_end: Option<i64>,
) -> bool {
    exact_chapter_id.is_none_or(|expected| chapter_id == Some(expected))
        && chapter_start.is_none_or(|start| chapter_order_index.is_some_and(|value| value >= start))
        && chapter_end.is_none_or(|end| chapter_order_index.is_some_and(|value| value <= end))
}

#[allow(dead_code)] // App retrieve still applies this after the shared SQL scope.
pub fn fts_candidate_in_scope(
    chapter_id: Option<&str>,
    chapter_order_index: Option<i64>,
    importance: f64,
    exact_chapter_id: Option<&str>,
    chapter_start: Option<i64>,
    chapter_end: Option<i64>,
    min_importance: Option<f64>,
) -> bool {
    passes_chapter_bounds(
        chapter_id,
        chapter_order_index,
        exact_chapter_id,
        chapter_start,
        chapter_end,
    ) && min_importance.is_none_or(|min| importance >= min)
}

pub fn snippet_around_match(text: &str, query: &str, limit: usize) -> TextSnippet {
    let chars: Vec<char> = text.chars().collect();
    let text_chars = chars.len();
    if limit == 0 || text_chars <= limit {
        return pack_snippet(text.to_string(), false, text_chars, 0, text_chars);
    }
    let query_lower = query.trim().to_lowercase();
    let text_lower = text.to_lowercase();
    let start = if text_lower.chars().count() == text_chars && !query_lower.is_empty() {
        text_lower
            .find(&query_lower)
            .map(|byte| text_lower[..byte].chars().count())
            .map(|match_start| {
                if match_start < limit {
                    0
                } else {
                    let match_len = query_lower.chars().count();
                    let centered = match_start.saturating_sub(limit.saturating_sub(match_len) / 2);
                    centered.min(text_chars - limit)
                }
            })
            .unwrap_or(0)
    } else {
        0
    };
    let slice: String = chars.iter().skip(start).take(limit).collect();
    let snippet_chars = slice.chars().count();
    let mut shown = String::new();
    if start > 0 {
        shown.push('…');
    }
    shown.push_str(&slice);
    if start + snippet_chars < text_chars {
        shown.push_str("…[truncated]");
    }
    pack_snippet(shown, true, text_chars, start, snippet_chars)
}

fn pack_snippet(
    text: String,
    truncated: bool,
    text_chars: usize,
    snippet_start: usize,
    snippet_chars: usize,
) -> TextSnippet {
    TextSnippet {
        text,
        truncated,
        text_chars,
        snippet_start,
        snippet_chars,
    }
}

pub fn search_lexical(
    connection: &Connection,
    request: &LexicalSearchRequest<'_>,
) -> Result<LexicalSearchResult, String> {
    let query = request.query.trim();
    if query.is_empty() {
        return Err("query must be non-empty".to_string());
    }
    let candidate_limit = request.candidate_limit.clamp(1, MAX_CANDIDATE_LIMIT);
    let probe_limit = candidate_limit.saturating_add(1);
    let min_importance = (request.min_importance.is_finite() && request.min_importance > 0.0)
        .then_some(request.min_importance);
    let scope = memory_lexical_scope::Scope {
        novel_id: request.novel_id,
        chapter_id: request.chapter_id,
        chapter_start: request.chapter_start,
        chapter_end: request.chapter_end,
        temporal_chapter: request.temporal_chapter,
        source_types: request.source_types,
        min_importance,
    };
    let fts_available = memory_lexical_scope::fts_available(connection)?;
    let mut coverage_incomplete = false;
    let mut rows = HashMap::<String, Candidate>::new();
    if fts_available {
        let found = memory_lexical_scope::scoped_chunks(
            connection,
            &scope,
            probe_limit,
            None,
            Some(&fts_phrase_query(query)),
        )?;
        if found.len() as i64 > candidate_limit {
            coverage_incomplete = true;
        }
        for (index, row) in found.into_iter().take(candidate_limit as usize).enumerate() {
            remember(&mut rows, row, Some(fts_rank_score(index)), true);
        }
    }
    let substrings =
        memory_lexical_scope::scoped_chunks(connection, &scope, probe_limit, Some(query), None)?;
    if substrings.len() as i64 > candidate_limit {
        coverage_incomplete = true;
    }
    for row in substrings.into_iter().take(candidate_limit as usize) {
        if rows.contains_key(&row.id) {
            continue;
        }
        if rows.len() >= candidate_limit as usize {
            coverage_incomplete = true;
            break;
        }
        remember(&mut rows, row, Some(SUBSTRING_LEXICAL_SCORE), false);
    }
    let max_chapter = rows
        .values()
        .filter_map(|candidate| candidate.row.chapter_order_index)
        .max()
        .unwrap_or(1)
        .max(1);
    let mut ranked = rows
        .into_iter()
        .map(|(_, candidate)| rank_candidate(candidate, max_chapter))
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        cmp_ranked(
            left.0.final_score,
            left.0.chapter_order_index,
            &left.0.chunk_id,
            right.0.final_score,
            right.0.chapter_order_index,
            &right.0.chunk_id,
        )
    });
    let candidate_count = ranked.len();
    let fts_hits = ranked.iter().filter(|(_, from_fts)| *from_fts).count();
    let lexical_path = match (fts_hits, candidate_count.saturating_sub(fts_hits)) {
        (0, 0) => "none",
        (_, 0) => "fts",
        (0, _) => "substring",
        _ => "mixed",
    };
    let top_k = request.top_k.max(0) as usize;
    ranked.truncate(top_k);
    Ok(LexicalSearchResult {
        hits: ranked.into_iter().map(|(hit, _)| hit).collect(),
        candidate_count,
        fts_available,
        lexical_path,
        coverage_incomplete,
    })
}

fn remember(
    rows: &mut HashMap<String, Candidate>,
    row: memory_lexical_scope::ScopedChunk,
    lexical: Option<f64>,
    from_fts: bool,
) {
    let id = row.id.clone();
    rows.insert(
        id,
        Candidate {
            row,
            lexical,
            from_fts,
        },
    );
}

fn rank_candidate(candidate: Candidate, max_chapter: i64) -> (LexicalHit, bool) {
    let importance = candidate.row.importance.clamp(0.0, 1.0);
    let recency = recency_score(candidate.row.chapter_order_index, max_chapter);
    let lexical = candidate
        .lexical
        .expect("retained candidate has a lexical score");
    let final_score = combine_score(None, Some(lexical), importance, recency);
    (
        LexicalHit {
            chunk_id: candidate.row.id,
            chapter_id: candidate.row.chapter_id,
            ordinal: candidate.row.ordinal,
            text: candidate.row.text,
            importance: candidate.row.importance,
            chapter_order_index: candidate.row.chapter_order_index,
            entity_keys_json: candidate.row.entity_keys_json,
            metadata_json: candidate.row.metadata_json,
            source_type: candidate.row.source_type,
            source_id: candidate.row.source_id,
            source_version: candidate.row.source_version,
            lexical_score: lexical,
            importance_score: importance,
            recency_score: recency,
            final_score,
        },
        candidate.from_fts,
    )
}
