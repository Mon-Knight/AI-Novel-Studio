use crate::errors::{codes, AppError};
use crate::repositories::multi_agent_repository::{
    self, MultiAgentRoundRecord, MultiAgentSessionBundle, MultiAgentSessionRecord,
};
use crate::services::ai_fact_security;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use std::collections::HashSet;

const EXPERT_TYPES: [&str; 6] = [
    "outline",
    "character",
    "setting",
    "logic",
    "polish",
    "quality",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMultiAgentSessionInput {
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
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendMultiAgentRoundInput {
    pub session_id: String,
    pub round: MultiAgentRoundRecord,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteMultiAgentSessionInput {
    pub session_id: String,
    pub status: String,
    pub accepted: bool,
    pub final_action: Option<String>,
    pub final_draft_id: Option<String>,
    pub duration_ms: i64,
    pub error_message: Option<String>,
    pub completed_at: String,
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::new(codes::MULTI_AGENT_INPUT_INVALID, message, false)
}

fn not_found() -> AppError {
    AppError::new(
        codes::MULTI_AGENT_NOT_FOUND,
        "Multi-Agent session 不存在",
        false,
    )
}

fn conflict(message: impl Into<String>) -> AppError {
    AppError::new(codes::MULTI_AGENT_STATE_CONFLICT, message, false)
}

fn validate_identifier(value: &str, label: &str, max: usize) -> Result<(), AppError> {
    ai_fact_security::validate_identifier(value, label, max)
        .map_err(|_| invalid(format!("{label} 无效")))
}

fn validate_hash(value: &str, label: &str) -> Result<(), AppError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(invalid(format!("{label} 必须是小写 SHA-256")));
    }
    Ok(())
}

fn validate_experts(experts: &[String]) -> Result<(), AppError> {
    if experts.is_empty() || experts.len() > EXPERT_TYPES.len() {
        return Err(invalid("专家数量必须在 1 到 6 之间"));
    }
    let mut unique = HashSet::new();
    for expert in experts {
        if !EXPERT_TYPES.contains(&expert.as_str()) || !unique.insert(expert.as_str()) {
            return Err(invalid("专家类型无效或重复"));
        }
    }
    Ok(())
}

fn validate_draft(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
    draft_id: &str,
    version: Option<i64>,
) -> Result<(), AppError> {
    let found = connection
        .query_row(
            "SELECT d.version_no FROM chapter_drafts d
             INNER JOIN chapters c ON c.id = d.chapter_id
             WHERE d.id = ?1 AND d.novel_id = ?2 AND d.chapter_id = ?3
               AND c.novel_id = ?2 AND c.deleted_at IS NULL",
            params![draft_id, novel_id, chapter_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(AppError::database)?;
    let Some(actual_version) = found else {
        return Err(invalid("草稿不存在或不属于当前作品与章节"));
    };
    if version.is_some_and(|expected| expected != actual_version) {
        return Err(conflict("草稿版本已经变化"));
    }
    Ok(())
}

fn same_create_identity(
    existing: &MultiAgentSessionRecord,
    input: &CreateMultiAgentSessionInput,
) -> bool {
    existing.operation_id == input.operation_id
        && existing.novel_id == input.novel_id
        && existing.chapter_id == input.chapter_id
        && existing.source_draft_id == input.source_draft_id
        && existing.source_draft_version == input.source_draft_version
        && existing.source_content_hash == input.source_content_hash
        && existing.expert_types == input.expert_types
        && existing.max_rounds == input.max_rounds
        && (existing.acceptance_threshold - input.acceptance_threshold).abs() < f64::EPSILON
        && (existing.minimum_average_score - input.minimum_average_score).abs() < f64::EPSILON
        && existing.minimum_successful_experts == input.minimum_successful_experts
}

fn commit(
    transaction: rusqlite::Transaction<'_>,
    operation_id: Option<&str>,
) -> Result<(), AppError> {
    transaction.commit().map_err(|error| {
        AppError::new(
            codes::DATABASE_COMMIT_UNKNOWN,
            "Multi-Agent 提交状态未知，请按相同 operationId 重新读取",
            true,
        )
        .with_context(None, operation_id)
        .with_details(serde_json::json!({ "sqliteError": error.to_string() }))
    })
}

pub fn create_session(
    connection: &mut Connection,
    input: CreateMultiAgentSessionInput,
) -> Result<MultiAgentSessionBundle, AppError> {
    validate_identifier(&input.session_id, "sessionId", 160)?;
    validate_identifier(&input.operation_id, "operationId", 200)?;
    validate_identifier(&input.novel_id, "novelId", 160)?;
    validate_identifier(&input.chapter_id, "chapterId", 160)?;
    validate_identifier(&input.source_draft_id, "sourceDraftId", 160)?;
    validate_hash(&input.source_content_hash, "sourceContentHash")?;
    validate_experts(&input.expert_types)?;
    if !(1..=3).contains(&input.max_rounds)
        || !(0.0..=1.0).contains(&input.acceptance_threshold)
        || !(0.0..=100.0).contains(&input.minimum_average_score)
        || input.minimum_successful_experts < 1
        || input.minimum_successful_experts > input.expert_types.len() as i64
        || input.created_at.trim().is_empty()
        || input.updated_at.trim().is_empty()
    {
        return Err(invalid("Multi-Agent session 配置无效"));
    }

    let operation_id = input.operation_id.clone();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    if let Some(existing) =
        multi_agent_repository::get_session_by_operation(&transaction, &operation_id)?
    {
        if !same_create_identity(&existing, &input) {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "相同 operationId 对应的 Multi-Agent 请求不一致",
                false,
            )
            .with_context(None, Some(&operation_id)));
        }
        let bundle = multi_agent_repository::get_bundle(&transaction, &existing.session_id)?
            .ok_or_else(not_found)?;
        commit(transaction, Some(&operation_id))?;
        return Ok(bundle);
    }

    validate_draft(
        &transaction,
        &input.novel_id,
        &input.chapter_id,
        &input.source_draft_id,
        Some(input.source_draft_version),
    )?;
    let expert_types_json =
        serde_json::to_string(&input.expert_types).map_err(|_| invalid("专家列表无法序列化"))?;
    transaction
        .execute(
            "INSERT INTO multi_agent_sessions (
                session_id, operation_id, novel_id, chapter_id, source_draft_id,
                source_draft_version, source_content_hash, expert_types_json,
                max_rounds, acceptance_threshold, minimum_average_score,
                minimum_successful_experts, status, current_round, accepted,
                total_tokens_input, total_tokens_output, total_tokens_used,
                duration_ms, created_at, updated_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,
                       'running',0,0,0,0,0,0,?13,?14)",
            params![
                input.session_id,
                input.operation_id,
                input.novel_id,
                input.chapter_id,
                input.source_draft_id,
                input.source_draft_version,
                input.source_content_hash,
                expert_types_json,
                input.max_rounds,
                input.acceptance_threshold,
                input.minimum_average_score,
                input.minimum_successful_experts,
                input.created_at,
                input.updated_at,
            ],
        )
        .map_err(AppError::database)?;
    let bundle = multi_agent_repository::get_bundle(&transaction, &input.session_id)?
        .ok_or_else(not_found)?;
    commit(transaction, Some(&operation_id))?;
    Ok(bundle)
}

fn expected_action(
    session: &MultiAgentSessionRecord,
    successful: i64,
    accepted_count: i64,
    average_score: f64,
) -> &'static str {
    let acceptance_rate = if successful > 0 {
        accepted_count as f64 / successful as f64
    } else {
        0.0
    };
    if successful >= session.minimum_successful_experts
        && acceptance_rate >= session.acceptance_threshold
        && average_score >= session.minimum_average_score
    {
        "accept"
    } else if successful >= session.minimum_successful_experts && average_score >= 60.0 {
        "revise"
    } else {
        "regenerate"
    }
}

fn validate_round(
    connection: &Connection,
    session: &MultiAgentSessionRecord,
    round: &MultiAgentRoundRecord,
) -> Result<(), AppError> {
    if round.round_number != session.current_round + 1 || round.round_number > session.max_rounds {
        return Err(conflict("评审轮次必须单调递增且不能超过 maxRounds"));
    }
    validate_hash(&round.input_content_hash, "inputContentHash")?;
    validate_draft(
        connection,
        &session.novel_id,
        &session.chapter_id,
        &round.input_draft_id,
        Some(round.input_draft_version),
    )?;
    if round.round_number == 1 && round.input_draft_id != session.source_draft_id {
        return Err(conflict("第一轮必须评审 session 的源草稿"));
    }
    if round.round_number > 1 {
        let expected_input: Option<String> = connection
            .query_row(
                "SELECT output_draft_id FROM multi_agent_rounds
                 WHERE session_id = ?1 AND round_number = ?2",
                params![session.session_id, round.round_number - 1],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::database)?
            .flatten();
        if expected_input.as_deref() != Some(round.input_draft_id.as_str()) {
            return Err(conflict("下一轮输入必须是上一轮生成的候选草稿"));
        }
    }

    let has_output = round.output_draft_id.is_some()
        && round.output_draft_version.is_some()
        && round.output_content_hash.is_some();
    if round.output_draft_id.is_some() != round.output_draft_version.is_some()
        || round.output_draft_id.is_some() != round.output_content_hash.is_some()
        || (round.consensus.action == "accept" && has_output)
        || (round.consensus.action != "accept"
            && has_output != (round.round_number < session.max_rounds))
    {
        return Err(invalid("候选草稿字段与共识动作不一致"));
    }
    if let (Some(draft_id), Some(version), Some(content_hash)) = (
        round.output_draft_id.as_deref(),
        round.output_draft_version,
        round.output_content_hash.as_deref(),
    ) {
        validate_hash(content_hash, "outputContentHash")?;
        validate_draft(
            connection,
            &session.novel_id,
            &session.chapter_id,
            draft_id,
            Some(version),
        )?;
    }

    if round.expert_opinions.len() != session.expert_types.len() {
        return Err(invalid("每轮必须包含所有已配置专家的结果"));
    }
    let mut opinion_experts = HashSet::new();
    let mut successful = 0_i64;
    let mut failed = 0_i64;
    let mut accepted_count = 0_i64;
    let mut score_total = 0_f64;
    let mut opinion_tokens_input = 0_i64;
    let mut opinion_tokens_output = 0_i64;
    let mut opinion_tokens_used = 0_i64;
    for opinion in &round.expert_opinions {
        validate_identifier(&opinion.opinion_id, "opinionId", 160)?;
        if !session.expert_types.contains(&opinion.expert)
            || !opinion_experts.insert(opinion.expert.as_str())
            || opinion.summary.trim().is_empty()
            || opinion.summary.len() > 500
            || opinion
                .error_message
                .as_ref()
                .is_some_and(|value| value.len() > 500)
        {
            return Err(invalid("专家意见身份或内容无效"));
        }
        match opinion.status.as_str() {
            "succeeded" => {
                let score = opinion.score.ok_or_else(|| invalid("成功意见缺少 score"))?;
                if !(0..=100).contains(&score) || opinion.error_message.is_some() {
                    return Err(invalid("成功意见的 score 或 errorMessage 无效"));
                }
                successful += 1;
                score_total += score as f64;
                if opinion.accepted {
                    accepted_count += 1;
                }
            }
            "failed" => {
                if opinion.score.is_some() || opinion.accepted {
                    return Err(invalid("失败意见不能包含 score 或接受票"));
                }
                failed += 1;
            }
            _ => return Err(invalid("专家意见状态无效")),
        }
        opinion_tokens_input += opinion.tokens_input;
        opinion_tokens_output += opinion.tokens_output;
        opinion_tokens_used += opinion.tokens_used;
    }
    let acceptance_rate = if successful > 0 {
        accepted_count as f64 / successful as f64
    } else {
        0.0
    };
    let average_score = if successful > 0 {
        score_total / successful as f64
    } else {
        0.0
    };
    let action = expected_action(session, successful, accepted_count, average_score);
    let consensus = &round.consensus;
    if consensus.successful_experts != successful
        || consensus.failed_experts != failed
        || consensus.required_successful_experts != session.minimum_successful_experts
        || (consensus.acceptance_rate - acceptance_rate).abs() > 0.011
        || (consensus.average_score - average_score).abs() > 0.011
        || consensus.action != action
        || consensus.agreed != (action == "accept")
        || round.tokens_input < opinion_tokens_input
        || round.tokens_output < opinion_tokens_output
        || round.tokens_used < opinion_tokens_used
    {
        return Err(invalid("共识或 token 汇总与专家意见不一致"));
    }
    Ok(())
}

pub fn append_round(
    connection: &mut Connection,
    input: AppendMultiAgentRoundInput,
) -> Result<MultiAgentSessionBundle, AppError> {
    validate_identifier(&input.session_id, "sessionId", 160)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let session = multi_agent_repository::get_session(&transaction, &input.session_id)?
        .ok_or_else(not_found)?;
    if session.status != "running" {
        return Err(conflict("只有 running session 可以追加轮次"));
    }
    if let Some(existing) = multi_agent_repository::list_rounds(&transaction, &input.session_id)?
        .into_iter()
        .find(|round| round.round_number == input.round.round_number)
    {
        if existing != input.round {
            return Err(conflict("相同轮次重放内容不一致"));
        }
        let bundle = multi_agent_repository::get_bundle(&transaction, &input.session_id)?
            .ok_or_else(not_found)?;
        commit(transaction, Some(&session.operation_id))?;
        return Ok(bundle);
    }
    validate_round(&transaction, &session, &input.round)?;
    let concerns = serde_json::to_string(&input.round.consensus.major_concerns)
        .map_err(|_| invalid("主要问题无法序列化"))?;
    let suggestions = serde_json::to_string(&input.round.consensus.merged_suggestions)
        .map_err(|_| invalid("合并建议无法序列化"))?;
    transaction
        .execute(
            "INSERT INTO multi_agent_rounds (
                session_id, round_number, input_draft_id, input_draft_version,
                input_content_hash, output_draft_id, output_draft_version,
                output_content_hash, agreed, acceptance_rate, average_score,
                successful_experts, failed_experts, required_successful_experts,
                action, major_concerns_json, merged_suggestions_json,
                tokens_input, tokens_output, tokens_used, duration_ms,
                started_at, completed_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,
                       ?15,?16,?17,?18,?19,?20,?21,?22,?23)",
            params![
                input.session_id,
                input.round.round_number,
                input.round.input_draft_id,
                input.round.input_draft_version,
                input.round.input_content_hash,
                input.round.output_draft_id,
                input.round.output_draft_version,
                input.round.output_content_hash,
                i64::from(input.round.consensus.agreed),
                input.round.consensus.acceptance_rate,
                input.round.consensus.average_score,
                input.round.consensus.successful_experts,
                input.round.consensus.failed_experts,
                input.round.consensus.required_successful_experts,
                input.round.consensus.action,
                concerns,
                suggestions,
                input.round.tokens_input,
                input.round.tokens_output,
                input.round.tokens_used,
                input.round.duration_ms,
                input.round.started_at,
                input.round.completed_at,
            ],
        )
        .map_err(AppError::database)?;
    for opinion in &input.round.expert_opinions {
        transaction
            .execute(
                "INSERT INTO multi_agent_opinions (
                    opinion_id, session_id, round_number, expert_type, status,
                    score, accepted, summary, issues_json, suggestions_json,
                    provider, model, ai_task_id, tokens_input, tokens_output,
                    tokens_used, duration_ms, error_message
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,
                           ?15,?16,?17,?18)",
                params![
                    opinion.opinion_id,
                    input.session_id,
                    input.round.round_number,
                    opinion.expert,
                    opinion.status,
                    opinion.score,
                    i64::from(opinion.accepted),
                    opinion.summary,
                    serde_json::to_string(&opinion.issues)
                        .map_err(|_| invalid("问题列表无法序列化"))?,
                    serde_json::to_string(&opinion.suggestions)
                        .map_err(|_| invalid("建议列表无法序列化"))?,
                    opinion.provider,
                    opinion.model,
                    opinion.ai_task_id,
                    opinion.tokens_input,
                    opinion.tokens_output,
                    opinion.tokens_used,
                    opinion.duration_ms,
                    opinion.error_message,
                ],
            )
            .map_err(AppError::database)?;
    }
    transaction
        .execute(
            "UPDATE multi_agent_sessions SET
                current_round = ?1,
                total_tokens_input = total_tokens_input + ?2,
                total_tokens_output = total_tokens_output + ?3,
                total_tokens_used = total_tokens_used + ?4,
                updated_at = ?5
             WHERE session_id = ?6 AND status = 'running'",
            params![
                input.round.round_number,
                input.round.tokens_input,
                input.round.tokens_output,
                input.round.tokens_used,
                input.round.completed_at,
                input.session_id,
            ],
        )
        .map_err(AppError::database)?;
    let bundle = multi_agent_repository::get_bundle(&transaction, &input.session_id)?
        .ok_or_else(not_found)?;
    commit(transaction, Some(&session.operation_id))?;
    Ok(bundle)
}

pub fn complete_session(
    connection: &mut Connection,
    input: CompleteMultiAgentSessionInput,
) -> Result<MultiAgentSessionBundle, AppError> {
    validate_identifier(&input.session_id, "sessionId", 160)?;
    if !matches!(input.status.as_str(), "completed" | "failed" | "cancelled")
        || input.duration_ms < 0
        || input.completed_at.trim().is_empty()
        || input
            .error_message
            .as_ref()
            .is_some_and(|value| value.len() > 500)
    {
        return Err(invalid("Multi-Agent 终态输入无效"));
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let session = multi_agent_repository::get_session(&transaction, &input.session_id)?
        .ok_or_else(not_found)?;
    if session.status != "running" {
        let same_terminal = session.status == input.status
            && session.accepted == input.accepted
            && session.final_action == input.final_action
            && session.final_draft_id == input.final_draft_id;
        if !same_terminal {
            return Err(conflict("session 终态重放不一致"));
        }
        let bundle = multi_agent_repository::get_bundle(&transaction, &input.session_id)?
            .ok_or_else(not_found)?;
        commit(transaction, Some(&session.operation_id))?;
        return Ok(bundle);
    }

    let rounds = multi_agent_repository::list_rounds(&transaction, &input.session_id)?;
    if input.status == "completed" {
        let final_round = rounds
            .last()
            .ok_or_else(|| invalid("completed session 必须包含轮次"))?;
        let expected_final_draft_id = final_round
            .output_draft_id
            .as_deref()
            .unwrap_or(final_round.input_draft_id.as_str());
        if input.final_action.as_deref() != Some(final_round.consensus.action.as_str())
            || input.accepted != (final_round.consensus.action == "accept")
            || input.final_draft_id.as_deref() != Some(expected_final_draft_id)
            || (final_round.consensus.action != "accept"
                && final_round.round_number < session.max_rounds)
        {
            return Err(invalid("session 终态与最终共识不一致"));
        }
    } else if input.accepted || input.final_action.is_some() {
        return Err(invalid("失败或取消 session 不能声明接受或最终动作"));
    }
    if let Some(final_draft_id) = input.final_draft_id.as_deref() {
        validate_draft(
            &transaction,
            &session.novel_id,
            &session.chapter_id,
            final_draft_id,
            None,
        )?;
    }
    transaction
        .execute(
            "UPDATE multi_agent_sessions SET status = ?1, accepted = ?2,
                final_action = ?3, final_draft_id = ?4, duration_ms = ?5,
                error_message = ?6, updated_at = ?7, completed_at = ?7
             WHERE session_id = ?8 AND status = 'running'",
            params![
                input.status,
                i64::from(input.accepted),
                input.final_action,
                input.final_draft_id,
                input.duration_ms,
                input.error_message,
                input.completed_at,
                input.session_id,
            ],
        )
        .map_err(AppError::database)?;
    let bundle = multi_agent_repository::get_bundle(&transaction, &input.session_id)?
        .ok_or_else(not_found)?;
    commit(transaction, Some(&session.operation_id))?;
    Ok(bundle)
}

pub fn get_session_bundle(
    connection: &Connection,
    session_id: &str,
) -> Result<MultiAgentSessionBundle, AppError> {
    validate_identifier(session_id, "sessionId", 160)?;
    multi_agent_repository::get_bundle(connection, session_id)?.ok_or_else(not_found)
}

pub fn list_sessions_by_chapter(
    connection: &Connection,
    chapter_id: &str,
    limit: i64,
) -> Result<Vec<MultiAgentSessionRecord>, AppError> {
    validate_identifier(chapter_id, "chapterId", 160)?;
    multi_agent_repository::list_sessions_by_chapter(connection, chapter_id, limit.clamp(1, 100))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;
    use crate::repositories::multi_agent_repository::{
        MultiAgentConsensusRecord, MultiAgentOpinionRecord,
    };

    fn setup() -> Result<Connection, Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE chapters (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                deleted_at TEXT
             );
             CREATE TABLE chapter_drafts (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                content TEXT NOT NULL,
                version_no INTEGER NOT NULL,
                large_text_ref_id TEXT
             );",
        )?;
        migrations::run_migrations(&mut connection)?;
        connection.execute_batch(
            "INSERT INTO chapters (id, novel_id, deleted_at)
                VALUES ('chapter-1', 'novel-1', NULL);
             INSERT INTO chapter_drafts (
                 id, novel_id, chapter_id, content, version_no, large_text_ref_id
             ) VALUES ('draft-1', 'novel-1', 'chapter-1', '正文', 1, NULL);
             INSERT INTO chapter_drafts (
                 id, novel_id, chapter_id, content, version_no, large_text_ref_id
             ) VALUES ('draft-2', 'novel-1', 'chapter-1', '候选正文', 2, NULL);",
        )?;
        Ok(connection)
    }

    fn create_input() -> CreateMultiAgentSessionInput {
        CreateMultiAgentSessionInput {
            session_id: "session-1".into(),
            operation_id: "operation-1".into(),
            novel_id: "novel-1".into(),
            chapter_id: "chapter-1".into(),
            source_draft_id: "draft-1".into(),
            source_draft_version: 1,
            source_content_hash: "a".repeat(64),
            expert_types: vec!["outline".into(), "quality".into()],
            max_rounds: 1,
            acceptance_threshold: 0.7,
            minimum_average_score: 75.0,
            minimum_successful_experts: 2,
            created_at: "2026-07-27T00:00:00Z".into(),
            updated_at: "2026-07-27T00:00:00Z".into(),
        }
    }

    fn succeeded_opinion(id: &str, expert: &str, score: i64) -> MultiAgentOpinionRecord {
        MultiAgentOpinionRecord {
            opinion_id: id.into(),
            expert: expert.into(),
            status: "succeeded".into(),
            score: Some(score),
            accepted: true,
            summary: format!("{expert} 通过"),
            issues: Vec::new(),
            suggestions: Vec::new(),
            provider: Some("test".into()),
            model: Some("test-model".into()),
            ai_task_id: None,
            tokens_input: 10,
            tokens_output: 5,
            tokens_used: 15,
            duration_ms: 1,
            error_message: None,
        }
    }

    fn accepted_round() -> MultiAgentRoundRecord {
        MultiAgentRoundRecord {
            round_number: 1,
            input_draft_id: "draft-1".into(),
            input_draft_version: 1,
            input_content_hash: "a".repeat(64),
            output_draft_id: None,
            output_draft_version: None,
            output_content_hash: None,
            expert_opinions: vec![
                succeeded_opinion("opinion-1", "outline", 80),
                succeeded_opinion("opinion-2", "quality", 84),
            ],
            consensus: MultiAgentConsensusRecord {
                agreed: true,
                acceptance_rate: 1.0,
                average_score: 82.0,
                successful_experts: 2,
                failed_experts: 0,
                required_successful_experts: 2,
                major_concerns: Vec::new(),
                merged_suggestions: Vec::new(),
                action: "accept".into(),
            },
            tokens_input: 20,
            tokens_output: 10,
            tokens_used: 30,
            duration_ms: 10,
            started_at: "2026-07-27T00:00:01Z".into(),
            completed_at: "2026-07-27T00:00:02Z".into(),
        }
    }

    #[test]
    fn lifecycle_persists_rounds_opinions_and_terminal_state(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let created = create_session(&mut connection, create_input())?;
        assert_eq!(created.session.status, "running");
        assert!(created.rounds.is_empty());

        let appended = append_round(
            &mut connection,
            AppendMultiAgentRoundInput {
                session_id: "session-1".into(),
                round: accepted_round(),
            },
        )?;
        assert_eq!(appended.rounds.len(), 1);
        assert_eq!(appended.rounds[0].expert_opinions.len(), 2);
        assert_eq!(appended.session.total_tokens_used, 30);

        let completed = complete_session(
            &mut connection,
            CompleteMultiAgentSessionInput {
                session_id: "session-1".into(),
                status: "completed".into(),
                accepted: true,
                final_action: Some("accept".into()),
                final_draft_id: Some("draft-1".into()),
                duration_ms: 25,
                error_message: None,
                completed_at: "2026-07-27T00:00:03Z".into(),
            },
        )?;
        assert_eq!(completed.session.status, "completed");
        assert!(completed.session.accepted);
        assert_eq!(completed.session.final_draft_id.as_deref(), Some("draft-1"));
        Ok(())
    }

    #[test]
    fn operation_replay_is_idempotent_and_payload_drift_is_rejected(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        create_session(&mut connection, create_input())?;
        let mut replay = create_input();
        replay.session_id = "new-client-session-id".into();
        let replayed = create_session(&mut connection, replay)?;
        assert_eq!(replayed.session.session_id, "session-1");

        let mut conflict_input = create_input();
        conflict_input.minimum_average_score = 90.0;
        let error =
            create_session(&mut connection, conflict_input).expect_err("payload drift must fail");
        assert_eq!(error.code, codes::OPERATION_PAYLOAD_CONFLICT);
        Ok(())
    }

    #[test]
    fn forged_consensus_and_wrong_draft_ownership_fail_closed(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        create_session(&mut connection, create_input())?;
        let mut forged = accepted_round();
        forged.consensus.action = "revise".into();
        forged.consensus.agreed = false;
        let error = append_round(
            &mut connection,
            AppendMultiAgentRoundInput {
                session_id: "session-1".into(),
                round: forged,
            },
        )
        .expect_err("forged consensus must fail");
        assert_eq!(error.code, codes::MULTI_AGENT_INPUT_INVALID);
        assert_eq!(
            get_session_bundle(&connection, "session-1")?
                .session
                .current_round,
            0
        );

        let mut wrong_scope = create_input();
        wrong_scope.operation_id = "operation-wrong-scope".into();
        wrong_scope.session_id = "session-wrong-scope".into();
        wrong_scope.novel_id = "another-novel".into();
        let error =
            create_session(&mut connection, wrong_scope).expect_err("cross-novel draft must fail");
        assert_eq!(error.code, codes::MULTI_AGENT_INPUT_INVALID);
        Ok(())
    }

    #[test]
    fn terminal_state_must_reference_the_last_reviewed_draft(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        create_session(&mut connection, create_input())?;
        append_round(
            &mut connection,
            AppendMultiAgentRoundInput {
                session_id: "session-1".into(),
                round: accepted_round(),
            },
        )?;

        let error = complete_session(
            &mut connection,
            CompleteMultiAgentSessionInput {
                session_id: "session-1".into(),
                status: "completed".into(),
                accepted: true,
                final_action: Some("accept".into()),
                final_draft_id: Some("draft-2".into()),
                duration_ms: 25,
                error_message: None,
                completed_at: "2026-07-27T00:00:03Z".into(),
            },
        )
        .expect_err("unreviewed final draft must fail");
        assert_eq!(error.code, codes::MULTI_AGENT_INPUT_INVALID);
        assert_eq!(
            get_session_bundle(&connection, "session-1")?.session.status,
            "running"
        );
        Ok(())
    }

    #[test]
    fn non_accept_round_cannot_finish_early_or_emit_unreviewed_final_output(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let mut input = create_input();
        input.max_rounds = 2;
        create_session(&mut connection, input)?;

        let mut revision_round = accepted_round();
        for opinion in &mut revision_round.expert_opinions {
            opinion.score = Some(68);
            opinion.accepted = false;
            opinion.issues = vec!["需要修订".into()];
            opinion.suggestions = vec!["收紧节奏".into()];
        }
        revision_round.output_draft_id = Some("draft-2".into());
        revision_round.output_draft_version = Some(2);
        revision_round.output_content_hash = Some("b".repeat(64));
        revision_round.consensus.agreed = false;
        revision_round.consensus.acceptance_rate = 0.0;
        revision_round.consensus.average_score = 68.0;
        revision_round.consensus.action = "revise".into();
        revision_round.consensus.major_concerns = vec!["需要修订".into()];
        revision_round.consensus.merged_suggestions = vec!["收紧节奏".into()];
        append_round(
            &mut connection,
            AppendMultiAgentRoundInput {
                session_id: "session-1".into(),
                round: revision_round,
            },
        )?;

        let error = complete_session(
            &mut connection,
            CompleteMultiAgentSessionInput {
                session_id: "session-1".into(),
                status: "completed".into(),
                accepted: false,
                final_action: Some("revise".into()),
                final_draft_id: Some("draft-2".into()),
                duration_ms: 25,
                error_message: None,
                completed_at: "2026-07-27T00:00:03Z".into(),
            },
        )
        .expect_err("non-accept round with remaining budget must continue");
        assert_eq!(error.code, codes::MULTI_AGENT_INPUT_INVALID);

        let mut final_round_with_output = accepted_round();
        final_round_with_output.round_number = 2;
        final_round_with_output.input_draft_id = "draft-2".into();
        final_round_with_output.input_draft_version = 2;
        final_round_with_output.input_content_hash = "b".repeat(64);
        for opinion in &mut final_round_with_output.expert_opinions {
            opinion.opinion_id = format!("{}-round-2", opinion.opinion_id);
            opinion.score = Some(68);
            opinion.accepted = false;
        }
        final_round_with_output.output_draft_id = Some("draft-1".into());
        final_round_with_output.output_draft_version = Some(1);
        final_round_with_output.output_content_hash = Some("a".repeat(64));
        final_round_with_output.consensus.agreed = false;
        final_round_with_output.consensus.acceptance_rate = 0.0;
        final_round_with_output.consensus.average_score = 68.0;
        final_round_with_output.consensus.action = "revise".into();
        let error = append_round(
            &mut connection,
            AppendMultiAgentRoundInput {
                session_id: "session-1".into(),
                round: final_round_with_output,
            },
        )
        .expect_err("last round cannot emit an unreviewed candidate");
        assert_eq!(error.code, codes::MULTI_AGENT_INPUT_INVALID);
        Ok(())
    }
}
