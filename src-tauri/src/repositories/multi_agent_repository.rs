use crate::errors::AppError;
use rusqlite::{Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MultiAgentSessionRecord {
    pub session_id: String,
    pub operation_id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub source_draft_id: String,
    pub source_draft_version: i64,
    pub source_content_hash: String,
    pub expert_types: Vec<String>,
    pub max_rounds: i64,
    pub acceptance_threshold: f64,
    pub minimum_average_score: f64,
    pub minimum_successful_experts: i64,
    pub status: String,
    pub current_round: i64,
    pub accepted: bool,
    pub final_action: Option<String>,
    pub final_draft_id: Option<String>,
    pub total_tokens_input: i64,
    pub total_tokens_output: i64,
    pub total_tokens_used: i64,
    pub duration_ms: i64,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MultiAgentConsensusRecord {
    pub agreed: bool,
    pub acceptance_rate: f64,
    pub average_score: f64,
    pub successful_experts: i64,
    pub failed_experts: i64,
    pub required_successful_experts: i64,
    pub major_concerns: Vec<String>,
    pub merged_suggestions: Vec<String>,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MultiAgentOpinionRecord {
    pub opinion_id: String,
    pub expert: String,
    pub status: String,
    pub score: Option<i64>,
    pub accepted: bool,
    pub summary: String,
    pub issues: Vec<String>,
    pub suggestions: Vec<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub ai_task_id: Option<String>,
    pub tokens_input: i64,
    pub tokens_output: i64,
    pub tokens_used: i64,
    pub duration_ms: i64,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MultiAgentRoundRecord {
    pub round_number: i64,
    pub input_draft_id: String,
    pub input_draft_version: i64,
    pub input_content_hash: String,
    pub output_draft_id: Option<String>,
    pub output_draft_version: Option<i64>,
    pub output_content_hash: Option<String>,
    pub expert_opinions: Vec<MultiAgentOpinionRecord>,
    pub consensus: MultiAgentConsensusRecord,
    pub tokens_input: i64,
    pub tokens_output: i64,
    pub tokens_used: i64,
    pub duration_ms: i64,
    pub started_at: String,
    pub completed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MultiAgentSessionBundle {
    pub session: MultiAgentSessionRecord,
    pub rounds: Vec<MultiAgentRoundRecord>,
}

fn json_vec(row: &Row<'_>, index: usize) -> rusqlite::Result<Vec<String>> {
    let raw: String = row.get(index)?;
    serde_json::from_str(&raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

const SESSION_SELECT: &str = "SELECT session_id, operation_id, novel_id, chapter_id,
    source_draft_id, source_draft_version, source_content_hash, expert_types_json,
    max_rounds, acceptance_threshold, minimum_average_score,
    minimum_successful_experts, status, current_round, accepted, final_action,
    final_draft_id, total_tokens_input, total_tokens_output, total_tokens_used,
    duration_ms, error_message, created_at, updated_at, completed_at
    FROM multi_agent_sessions";

fn map_session(row: &Row<'_>) -> rusqlite::Result<MultiAgentSessionRecord> {
    Ok(MultiAgentSessionRecord {
        session_id: row.get(0)?,
        operation_id: row.get(1)?,
        novel_id: row.get(2)?,
        chapter_id: row.get(3)?,
        source_draft_id: row.get(4)?,
        source_draft_version: row.get(5)?,
        source_content_hash: row.get(6)?,
        expert_types: json_vec(row, 7)?,
        max_rounds: row.get(8)?,
        acceptance_threshold: row.get(9)?,
        minimum_average_score: row.get(10)?,
        minimum_successful_experts: row.get(11)?,
        status: row.get(12)?,
        current_round: row.get(13)?,
        accepted: row.get::<_, i64>(14)? != 0,
        final_action: row.get(15)?,
        final_draft_id: row.get(16)?,
        total_tokens_input: row.get(17)?,
        total_tokens_output: row.get(18)?,
        total_tokens_used: row.get(19)?,
        duration_ms: row.get(20)?,
        error_message: row.get(21)?,
        created_at: row.get(22)?,
        updated_at: row.get(23)?,
        completed_at: row.get(24)?,
    })
}

const ROUND_SELECT: &str = "SELECT round_number, input_draft_id, input_draft_version,
    input_content_hash, output_draft_id, output_draft_version, output_content_hash,
    agreed, acceptance_rate, average_score, successful_experts, failed_experts,
    required_successful_experts, action, major_concerns_json,
    merged_suggestions_json, tokens_input, tokens_output, tokens_used, duration_ms,
    started_at, completed_at FROM multi_agent_rounds";

fn map_round(row: &Row<'_>) -> rusqlite::Result<MultiAgentRoundRecord> {
    Ok(MultiAgentRoundRecord {
        round_number: row.get(0)?,
        input_draft_id: row.get(1)?,
        input_draft_version: row.get(2)?,
        input_content_hash: row.get(3)?,
        output_draft_id: row.get(4)?,
        output_draft_version: row.get(5)?,
        output_content_hash: row.get(6)?,
        expert_opinions: Vec::new(),
        consensus: MultiAgentConsensusRecord {
            agreed: row.get::<_, i64>(7)? != 0,
            acceptance_rate: row.get(8)?,
            average_score: row.get(9)?,
            successful_experts: row.get(10)?,
            failed_experts: row.get(11)?,
            required_successful_experts: row.get(12)?,
            action: row.get(13)?,
            major_concerns: json_vec(row, 14)?,
            merged_suggestions: json_vec(row, 15)?,
        },
        tokens_input: row.get(16)?,
        tokens_output: row.get(17)?,
        tokens_used: row.get(18)?,
        duration_ms: row.get(19)?,
        started_at: row.get(20)?,
        completed_at: row.get(21)?,
    })
}

const OPINION_SELECT: &str = "SELECT opinion_id, expert_type, status, score, accepted,
    summary, issues_json, suggestions_json, provider, model, ai_task_id,
    tokens_input, tokens_output, tokens_used, duration_ms, error_message
    FROM multi_agent_opinions";

fn map_opinion(row: &Row<'_>) -> rusqlite::Result<MultiAgentOpinionRecord> {
    Ok(MultiAgentOpinionRecord {
        opinion_id: row.get(0)?,
        expert: row.get(1)?,
        status: row.get(2)?,
        score: row.get(3)?,
        accepted: row.get::<_, i64>(4)? != 0,
        summary: row.get(5)?,
        issues: json_vec(row, 6)?,
        suggestions: json_vec(row, 7)?,
        provider: row.get(8)?,
        model: row.get(9)?,
        ai_task_id: row.get(10)?,
        tokens_input: row.get(11)?,
        tokens_output: row.get(12)?,
        tokens_used: row.get(13)?,
        duration_ms: row.get(14)?,
        error_message: row.get(15)?,
    })
}

pub fn get_session(
    connection: &Connection,
    session_id: &str,
) -> Result<Option<MultiAgentSessionRecord>, AppError> {
    connection
        .query_row(
            &format!("{SESSION_SELECT} WHERE session_id = ?1"),
            [session_id],
            map_session,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn get_session_by_operation(
    connection: &Connection,
    operation_id: &str,
) -> Result<Option<MultiAgentSessionRecord>, AppError> {
    connection
        .query_row(
            &format!("{SESSION_SELECT} WHERE operation_id = ?1"),
            [operation_id],
            map_session,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn list_sessions_by_chapter(
    connection: &Connection,
    chapter_id: &str,
    limit: i64,
) -> Result<Vec<MultiAgentSessionRecord>, AppError> {
    let mut statement = connection
        .prepare(&format!(
            "{SESSION_SELECT} WHERE chapter_id = ?1 ORDER BY created_at DESC, session_id DESC LIMIT ?2"
        ))
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(rusqlite::params![chapter_id, limit], map_session)
        .map_err(AppError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

fn list_opinions(
    connection: &Connection,
    session_id: &str,
    round_number: i64,
) -> Result<Vec<MultiAgentOpinionRecord>, AppError> {
    let mut statement = connection
        .prepare(&format!(
            "{OPINION_SELECT} WHERE session_id = ?1 AND round_number = ?2 ORDER BY rowid ASC"
        ))
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(rusqlite::params![session_id, round_number], map_opinion)
        .map_err(AppError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

pub fn list_rounds(
    connection: &Connection,
    session_id: &str,
) -> Result<Vec<MultiAgentRoundRecord>, AppError> {
    let mut statement = connection
        .prepare(&format!(
            "{ROUND_SELECT} WHERE session_id = ?1 ORDER BY round_number ASC"
        ))
        .map_err(AppError::database)?;
    let rows = statement
        .query_map([session_id], map_round)
        .map_err(AppError::database)?;
    let mut rounds = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    for round in &mut rounds {
        round.expert_opinions = list_opinions(connection, session_id, round.round_number)?;
    }
    Ok(rounds)
}

pub fn get_bundle(
    connection: &Connection,
    session_id: &str,
) -> Result<Option<MultiAgentSessionBundle>, AppError> {
    let Some(session) = get_session(connection, session_id)? else {
        return Ok(None);
    };
    Ok(Some(MultiAgentSessionBundle {
        rounds: list_rounds(connection, session_id)?,
        session,
    }))
}
