use crate::errors::{codes, AppError};
use crate::repositories::large_text_repository;
use crate::services::{ai_fact_security, autonomous_story_service};
use chrono::{Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

const RUN_COLUMNS: &str = "run_id, operation_id, request_hash, novel_id, plan_id, mode,
    policy_json, policy_hash, status, state_revision, next_chapter_number, total_chapters,
    completed_chapters, token_input, token_output, cost_usd, usage_day, daily_token_input,
    daily_token_output, daily_cost_usd, consecutive_failures, pause_reason, error_json,
    created_at, updated_at, started_at, paused_at, completed_at";

const ATTEMPT_COLUMNS: &str = "attempt_id, run_id, novel_id, chapter_id, chapter_number,
    attempt_number, operation_id, lease_id, lease_epoch, status, estimated_tokens,
    estimated_cost_usd, token_input, token_output, cost_usd, candidate_draft_id,
    adopted_draft_id, review_session_id, successful_experts, average_score, acceptance_rate,
    analysis_confirmed, decision_json, decision_hash, error_json, claimed_at, finished_at";

fn scheduler_error(code: &'static str, message: impl Into<String>, retryable: bool) -> AppError {
    AppError::new(code, message, retryable)
}

fn invalid(message: impl Into<String>) -> AppError {
    scheduler_error(codes::AUTONOMOUS_RUN_INPUT_INVALID, message, false)
}

fn conflict(message: impl Into<String>) -> AppError {
    scheduler_error(codes::AUTONOMOUS_RUN_STATE_CONFLICT, message, true)
}

fn require_id(value: &str, label: &str, maximum: usize) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() || value.len() > maximum {
        return Err(invalid(format!("{label} 无效")));
    }
    Ok(value.to_string())
}

fn commit(transaction: Transaction<'_>, operation_id: Option<&str>) -> Result<(), AppError> {
    transaction.commit().map_err(|error| {
        AppError::new(
            codes::DATABASE_COMMIT_UNKNOWN,
            "无人值守调度提交状态未知，请用相同 operationId 重放",
            true,
        )
        .with_context(None, operation_id)
        .with_details(serde_json::json!({ "sqliteError": error.to_string() }))
    })
}

fn parse_optional_json(value: Option<String>) -> Option<Value> {
    value.and_then(|text| serde_json::from_str(&text).ok())
}

fn usage_day() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousRunWindow {
    pub start_minute: i64,
    pub end_minute: i64,
    pub utc_offset_minutes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousAutomationPolicy {
    pub schema_version: i64,
    pub mode: String,
    pub max_chapters: i64,
    pub max_consecutive_failures: i64,
    pub max_retries_per_chapter: i64,
    pub minimum_successful_experts: i64,
    pub minimum_average_score: f64,
    pub minimum_acceptance_rate: f64,
    pub auto_confirm_analysis: bool,
    pub daily_token_budget: Option<i64>,
    pub book_token_budget: Option<i64>,
    pub daily_cost_budget_usd: Option<f64>,
    pub book_cost_budget_usd: Option<f64>,
    pub run_window: Option<AutonomousRunWindow>,
}

impl AutonomousAutomationPolicy {
    pub(crate) fn validate(&self, total_chapters: i64) -> Result<(), AppError> {
        if self.schema_version != 1
            || !matches!(
                self.mode.as_str(),
                "draft_night" | "quality_gate" | "full_auto"
            )
            || !(1..=total_chapters).contains(&self.max_chapters)
            || !(1..=20).contains(&self.max_consecutive_failures)
            || !(0..=10).contains(&self.max_retries_per_chapter)
            || !(1..=64).contains(&self.minimum_successful_experts)
            || !self.minimum_average_score.is_finite()
            || !(0.0..=100.0).contains(&self.minimum_average_score)
            || !self.minimum_acceptance_rate.is_finite()
            || !(0.0..=1.0).contains(&self.minimum_acceptance_rate)
        {
            return Err(invalid("无人值守策略阈值无效"));
        }
        if self.mode != "full_auto" && self.auto_confirm_analysis {
            return Err(invalid("只有全自动模式可以自动确认章节分析"));
        }
        for value in [self.daily_token_budget, self.book_token_budget]
            .into_iter()
            .flatten()
        {
            if value <= 0 || value > 100_000_000_000 {
                return Err(invalid("Token 预算无效"));
            }
        }
        for value in [self.daily_cost_budget_usd, self.book_cost_budget_usd]
            .into_iter()
            .flatten()
        {
            if !value.is_finite() || value <= 0.0 || value > 1_000_000.0 {
                return Err(invalid("成本预算无效"));
            }
        }
        if let Some(window) = &self.run_window {
            if !(0..=1439).contains(&window.start_minute)
                || !(0..=1439).contains(&window.end_minute)
                || !(-840..=840).contains(&window.utc_offset_minutes)
            {
                return Err(invalid("允许运行时段无效"));
            }
        }
        Ok(())
    }

    fn quality_passes(
        &self,
        successful_experts: Option<i64>,
        average_score: Option<f64>,
        acceptance_rate: Option<f64>,
    ) -> bool {
        successful_experts.unwrap_or(-1) >= self.minimum_successful_experts
            && average_score
                .filter(|value| value.is_finite())
                .is_some_and(|value| value >= self.minimum_average_score)
            && acceptance_rate
                .filter(|value| value.is_finite())
                .is_some_and(|value| value >= self.minimum_acceptance_rate)
    }

    fn window_open(&self) -> bool {
        let Some(window) = &self.run_window else {
            return true;
        };
        if window.start_minute == window.end_minute {
            return true;
        }
        let local = Utc::now() + Duration::minutes(window.utc_offset_minutes);
        let minute = i64::from(local.format("%H").to_string().parse::<u8>().unwrap_or(0)) * 60
            + i64::from(local.format("%M").to_string().parse::<u8>().unwrap_or(0));
        if window.start_minute < window.end_minute {
            (window.start_minute..window.end_minute).contains(&minute)
        } else {
            minute >= window.start_minute || minute < window.end_minute
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousBookRunDto {
    pub run_id: String,
    pub operation_id: String,
    pub request_hash: String,
    pub novel_id: String,
    pub plan_id: String,
    pub mode: String,
    pub policy: AutonomousAutomationPolicy,
    pub policy_hash: String,
    pub status: String,
    pub state_revision: i64,
    pub next_chapter_number: i64,
    pub total_chapters: i64,
    pub completed_chapters: i64,
    pub token_input: i64,
    pub token_output: i64,
    pub cost_usd: f64,
    pub usage_day: String,
    pub daily_token_input: i64,
    pub daily_token_output: i64,
    pub daily_cost_usd: f64,
    pub consecutive_failures: i64,
    pub pause_reason: Option<String>,
    pub error: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub paused_at: Option<String>,
    pub completed_at: Option<String>,
}

fn map_run(row: &Row<'_>) -> rusqlite::Result<AutonomousBookRunDto> {
    let policy_text: String = row.get(6)?;
    let policy = serde_json::from_str(&policy_text).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            policy_text.len(),
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })?;
    Ok(AutonomousBookRunDto {
        run_id: row.get(0)?,
        operation_id: row.get(1)?,
        request_hash: row.get(2)?,
        novel_id: row.get(3)?,
        plan_id: row.get(4)?,
        mode: row.get(5)?,
        policy,
        policy_hash: row.get(7)?,
        status: row.get(8)?,
        state_revision: row.get(9)?,
        next_chapter_number: row.get(10)?,
        total_chapters: row.get(11)?,
        completed_chapters: row.get(12)?,
        token_input: row.get(13)?,
        token_output: row.get(14)?,
        cost_usd: row.get(15)?,
        usage_day: row.get(16)?,
        daily_token_input: row.get(17)?,
        daily_token_output: row.get(18)?,
        daily_cost_usd: row.get(19)?,
        consecutive_failures: row.get(20)?,
        pause_reason: row.get(21)?,
        error: parse_optional_json(row.get(22)?),
        created_at: row.get(23)?,
        updated_at: row.get(24)?,
        started_at: row.get(25)?,
        paused_at: row.get(26)?,
        completed_at: row.get(27)?,
    })
}

fn find_run(
    connection: &Connection,
    run_id: &str,
) -> Result<Option<AutonomousBookRunDto>, AppError> {
    connection
        .query_row(
            &format!("SELECT {RUN_COLUMNS} FROM autonomous_book_runs WHERE run_id=?1"),
            [run_id],
            map_run,
        )
        .optional()
        .map_err(AppError::database)
}

fn require_run(connection: &Connection, run_id: &str) -> Result<AutonomousBookRunDto, AppError> {
    find_run(connection, run_id)?.ok_or_else(|| {
        scheduler_error(
            codes::AUTONOMOUS_RUN_NOT_FOUND,
            "无人值守书级任务不存在",
            false,
        )
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousRunLeaseDto {
    pub lease_id: String,
    pub run_id: String,
    pub novel_id: String,
    pub epoch: i64,
    pub owner_id: String,
    pub expires_at: String,
    pub status: String,
    pub acquired_at: String,
    pub renewed_at: Option<String>,
    pub released_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousRunLeaseGrant {
    pub lease: AutonomousRunLeaseDto,
    pub token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousRunLeaseProof {
    pub lease_id: String,
    pub epoch: i64,
    pub token: String,
}

fn public_lease(
    connection: &Connection,
    lease_id: &str,
) -> Result<Option<AutonomousRunLeaseDto>, AppError> {
    connection
        .query_row(
            "SELECT lease_id, run_id, novel_id, epoch, owner_id, expires_at, status,
                    acquired_at, renewed_at, released_at
             FROM autonomous_run_leases WHERE lease_id=?1",
            [lease_id],
            |row| {
                Ok(AutonomousRunLeaseDto {
                    lease_id: row.get(0)?,
                    run_id: row.get(1)?,
                    novel_id: row.get(2)?,
                    epoch: row.get(3)?,
                    owner_id: row.get(4)?,
                    expires_at: row.get(5)?,
                    status: row.get(6)?,
                    acquired_at: row.get(7)?,
                    renewed_at: row.get(8)?,
                    released_at: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(AppError::database)
}

fn validate_lease(
    transaction: &Transaction<'_>,
    run_id: &str,
    proof: &AutonomousRunLeaseProof,
    now: &str,
) -> Result<AutonomousRunLeaseDto, AppError> {
    if proof.epoch < 1 || proof.token.len() < 16 || proof.token.len() > 200 {
        return Err(scheduler_error(
            codes::AUTONOMOUS_RUN_LEASE_EXPIRED,
            "调度租约凭据无效",
            false,
        ));
    }
    let token_hash = large_text_repository::sha256(&proof.token);
    let lease = transaction
        .query_row(
            "SELECT lease_id, run_id, novel_id, epoch, owner_id, expires_at, status,
                    acquired_at, renewed_at, released_at, token_hash
             FROM autonomous_run_leases WHERE lease_id=?1",
            [&proof.lease_id],
            |row| {
                Ok((
                    AutonomousRunLeaseDto {
                        lease_id: row.get(0)?,
                        run_id: row.get(1)?,
                        novel_id: row.get(2)?,
                        epoch: row.get(3)?,
                        owner_id: row.get(4)?,
                        expires_at: row.get(5)?,
                        status: row.get(6)?,
                        acquired_at: row.get(7)?,
                        renewed_at: row.get(8)?,
                        released_at: row.get(9)?,
                    },
                    row.get::<_, String>(10)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| {
            scheduler_error(codes::AUTONOMOUS_RUN_LEASE_EXPIRED, "调度租约不存在", false)
        })?;
    if lease.0.run_id != run_id
        || lease.0.epoch != proof.epoch
        || lease.1 != token_hash
        || lease.0.status != "active"
    {
        return Err(scheduler_error(
            codes::AUTONOMOUS_RUN_LEASE_EXPIRED,
            "调度租约身份不匹配或已释放",
            false,
        ));
    }
    if lease.0.expires_at.as_str() <= now {
        transaction
            .execute(
                "UPDATE autonomous_run_leases
                 SET status='expired', released_at=?1
                 WHERE lease_id=?2 AND status='active'",
                params![now, proof.lease_id],
            )
            .map_err(AppError::database)?;
        return Err(scheduler_error(
            codes::AUTONOMOUS_RUN_LEASE_EXPIRED,
            "调度租约已经过期",
            false,
        ));
    }
    Ok(lease.0)
}

fn validate_lease_identity(
    transaction: &Transaction<'_>,
    run_id: &str,
    proof: &AutonomousRunLeaseProof,
) -> Result<(), AppError> {
    if proof.epoch < 1 || proof.token.len() < 16 || proof.token.len() > 200 {
        return Err(scheduler_error(
            codes::AUTONOMOUS_RUN_LEASE_EXPIRED,
            "调度租约凭据无效",
            false,
        ));
    }
    let matches: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM autonomous_run_leases
             WHERE lease_id=?1 AND run_id=?2 AND epoch=?3 AND token_hash=?4",
            params![
                proof.lease_id,
                run_id,
                proof.epoch,
                large_text_repository::sha256(&proof.token)
            ],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if matches != 1 {
        return Err(scheduler_error(
            codes::AUTONOMOUS_RUN_LEASE_EXPIRED,
            "调度租约身份不匹配",
            false,
        ));
    }
    Ok(())
}

fn insert_checkpoint(
    transaction: &Transaction<'_>,
    run: &AutonomousBookRunDto,
    event_type: &str,
    attempt_id: Option<&str>,
    payload: &Value,
    now: &str,
) -> Result<(), AppError> {
    ai_fact_security::validate_metadata(payload, "调度 checkpoint")?;
    let payload_json = ai_fact_security::canonical_json(payload)?;
    let payload_hash = large_text_repository::sha256(&payload_json);
    let sequence: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(sequence), 0) + 1
             FROM autonomous_run_checkpoints WHERE run_id=?1",
            [&run.run_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "INSERT INTO autonomous_run_checkpoints
             (checkpoint_id, run_id, novel_id, sequence, event_type, attempt_id,
              run_status, payload_json, payload_hash, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                Uuid::new_v4().to_string(),
                run.run_id,
                run.novel_id,
                sequence,
                event_type,
                attempt_id,
                run.status,
                payload_json,
                payload_hash,
                now,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAutonomousBookRunInput {
    pub operation_id: String,
    pub novel_id: String,
    pub plan_id: String,
    pub policy: AutonomousAutomationPolicy,
}

pub fn create_run(
    connection: &mut Connection,
    input: CreateAutonomousBookRunInput,
) -> Result<AutonomousBookRunDto, AppError> {
    let operation_id = require_id(&input.operation_id, "operationId", 200)?;
    let novel_id = require_id(&input.novel_id, "novelId", 200)?;
    let plan_id = require_id(&input.plan_id, "planId", 200)?;
    let plan = autonomous_story_service::get_plan(connection, &plan_id)?.ok_or_else(|| {
        scheduler_error(
            codes::AUTONOMOUS_PLAN_NOT_FOUND,
            "自主创作计划不存在",
            false,
        )
    })?;
    if plan.get("novelId").and_then(Value::as_str) != Some(novel_id.as_str())
        || plan.get("status").and_then(Value::as_str) != Some("applied")
    {
        return Err(invalid("自主创作计划未应用或不属于当前作品"));
    }
    let chapters = plan
        .get("chapters")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("自主创作计划缺少章节"))?;
    let total_chapters = chapters.len() as i64;
    if total_chapters < 1 || total_chapters > 10_000 {
        return Err(invalid("自主创作计划章节数量无效"));
    }
    input.policy.validate(total_chapters)?;
    let policy_value =
        serde_json::to_value(&input.policy).map_err(|_| invalid("策略无法序列化"))?;
    ai_fact_security::validate_metadata(&policy_value, "无人值守策略")?;
    let policy_json = ai_fact_security::canonical_json(&policy_value)?;
    let policy_hash = large_text_repository::sha256(&policy_json);
    let request_hash = ai_fact_security::canonical_hash(&serde_json::json!({
        "novelId": novel_id,
        "planId": plan_id,
        "policyHash": policy_hash,
    }))?;

    if let Some(existing) = connection
        .query_row(
            &format!("SELECT {RUN_COLUMNS} FROM autonomous_book_runs WHERE operation_id=?1"),
            [&operation_id],
            map_run,
        )
        .optional()
        .map_err(AppError::database)?
    {
        if existing.request_hash != request_hash {
            return Err(conflict("operationId 已用于不同无人值守策略"));
        }
        return Ok(existing);
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let active_count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM autonomous_book_runs
             WHERE plan_id=?1 AND status IN ('queued','running','paused')",
            [&plan_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if active_count != 0 {
        return Err(conflict("该全书计划已经存在活动无人值守任务"));
    }
    let first_chapter = chapters
        .iter()
        .filter_map(|chapter| chapter.get("chapterNumber").and_then(Value::as_i64))
        .min()
        .ok_or_else(|| invalid("计划章节编号无效"))?;
    let run_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let day = usage_day();
    transaction
        .execute(
            "INSERT INTO autonomous_book_runs
             (run_id, operation_id, request_hash, novel_id, plan_id, mode, policy_json,
              policy_hash, status, state_revision, next_chapter_number, total_chapters,
              completed_chapters, token_input, token_output, cost_usd, usage_day,
              daily_token_input, daily_token_output, daily_cost_usd, consecutive_failures,
              created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'queued',1,?9,?10,0,0,0,0,?11,0,0,0,0,?12,?12)",
            params![
                run_id,
                operation_id,
                request_hash,
                novel_id,
                plan_id,
                input.policy.mode,
                policy_json,
                policy_hash,
                first_chapter,
                total_chapters,
                day,
                now,
            ],
        )
        .map_err(AppError::database)?;
    let run = require_run(&transaction, &run_id)?;
    insert_checkpoint(
        &transaction,
        &run,
        "run_created",
        None,
        &serde_json::json!({ "policyHash": run.policy_hash, "mode": run.mode }),
        &now,
    )?;
    commit(transaction, Some(&operation_id))?;
    require_run(connection, &run_id)
}

pub fn get_run(
    connection: &Connection,
    run_id: &str,
) -> Result<Option<AutonomousBookRunDto>, AppError> {
    find_run(connection, &require_id(run_id, "runId", 200)?)
}

pub fn list_runs(
    connection: &Connection,
    novel_id: &str,
    limit: i64,
) -> Result<Vec<AutonomousBookRunDto>, AppError> {
    let novel_id = require_id(novel_id, "novelId", 200)?;
    if !(1..=200).contains(&limit) {
        return Err(invalid("调度任务分页大小无效"));
    }
    let sql = format!(
        "SELECT {RUN_COLUMNS} FROM autonomous_book_runs
         WHERE novel_id=?1 ORDER BY created_at DESC, run_id DESC LIMIT ?2"
    );
    let mut statement = connection.prepare(&sql).map_err(AppError::database)?;
    let runs = statement
        .query_map(params![novel_id, limit], map_run)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(runs)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcquireAutonomousRunLeaseInput {
    pub run_id: String,
    pub owner_id: String,
    pub ttl_seconds: Option<i64>,
}

pub fn acquire_lease(
    connection: &mut Connection,
    input: AcquireAutonomousRunLeaseInput,
) -> Result<AutonomousRunLeaseGrant, AppError> {
    let run_id = require_id(&input.run_id, "runId", 200)?;
    let owner_id = require_id(&input.owner_id, "ownerId", 200)?;
    let ttl = input.ttl_seconds.unwrap_or(90).clamp(15, 300);
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let mut run = require_run(&transaction, &run_id)?;
    if !matches!(run.status.as_str(), "queued" | "running") {
        return Err(conflict("当前无人值守任务不可获取执行租约"));
    }
    let now_value = Utc::now();
    let now = now_value.to_rfc3339();
    transaction
        .execute(
            "UPDATE autonomous_run_leases SET status='expired', released_at=?1
             WHERE run_id=?2 AND status='active' AND expires_at<=?1",
            params![now, run_id],
        )
        .map_err(AppError::database)?;
    let active: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM autonomous_run_leases WHERE run_id=?1 AND status='active'",
            [&run_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if active != 0 {
        return Err(scheduler_error(
            codes::AUTONOMOUS_RUN_LEASE_CONFLICT,
            "无人值守任务正由另一个进程执行",
            true,
        ));
    }
    let epoch: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(epoch),0)+1 FROM autonomous_run_leases WHERE run_id=?1",
            [&run_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    let lease_id = Uuid::new_v4().to_string();
    let token = format!("{}{}", Uuid::new_v4(), Uuid::new_v4());
    let token_hash = large_text_repository::sha256(&token);
    let expires_at = (now_value + Duration::seconds(ttl)).to_rfc3339();
    transaction
        .execute(
            "INSERT INTO autonomous_run_leases
             (lease_id, run_id, novel_id, epoch, owner_id, token_hash, expires_at,
              status, acquired_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,'active',?8)",
            params![
                lease_id,
                run.run_id,
                run.novel_id,
                epoch,
                owner_id,
                token_hash,
                expires_at,
                now,
            ],
        )
        .map_err(AppError::database)?;
    if run.status == "queued" {
        let changed = transaction
            .execute(
                "UPDATE autonomous_book_runs
                 SET status='running', state_revision=state_revision+1, started_at=COALESCE(started_at,?1),
                     pause_reason=NULL, paused_at=NULL, updated_at=?1
                 WHERE run_id=?2 AND status='queued' AND state_revision=?3",
                params![now, run.run_id, run.state_revision],
            )
            .map_err(AppError::database)?;
        if changed != 1 {
            return Err(conflict("无人值守任务启动发生并发冲突"));
        }
        run = require_run(&transaction, &run_id)?;
    }
    insert_checkpoint(
        &transaction,
        &run,
        "lease_acquired",
        None,
        &serde_json::json!({
            "leaseId": lease_id,
            "epoch": epoch,
            "ownerId": owner_id,
            "expiresAt": expires_at,
        }),
        &now,
    )?;
    commit(transaction, None)?;
    let lease =
        public_lease(connection, &lease_id)?.ok_or_else(|| conflict("租约提交后不可读取"))?;
    Ok(AutonomousRunLeaseGrant { lease, token })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatAutonomousRunInput {
    pub run_id: String,
    pub lease: AutonomousRunLeaseProof,
    pub ttl_seconds: Option<i64>,
}

pub fn heartbeat(
    connection: &mut Connection,
    input: HeartbeatAutonomousRunInput,
) -> Result<AutonomousRunLeaseDto, AppError> {
    let ttl = input.ttl_seconds.unwrap_or(90).clamp(15, 300);
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now_value = Utc::now();
    let now = now_value.to_rfc3339();
    validate_lease(&transaction, &input.run_id, &input.lease, &now)?;
    let expires_at = (now_value + Duration::seconds(ttl)).to_rfc3339();
    let changed = transaction
        .execute(
            "UPDATE autonomous_run_leases SET expires_at=?1, renewed_at=?2
             WHERE lease_id=?3 AND run_id=?4 AND epoch=?5 AND status='active'",
            params![
                expires_at,
                now,
                input.lease.lease_id,
                input.run_id,
                input.lease.epoch,
            ],
        )
        .map_err(AppError::database)?;
    if changed != 1 {
        return Err(scheduler_error(
            codes::AUTONOMOUS_RUN_LEASE_EXPIRED,
            "调度租约续期失败",
            true,
        ));
    }
    commit(transaction, None)?;
    public_lease(connection, &input.lease.lease_id)?.ok_or_else(|| conflict("续期后的租约不可读"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousRunChapterAttemptDto {
    pub attempt_id: String,
    pub run_id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub chapter_number: i64,
    pub attempt_number: i64,
    pub operation_id: String,
    pub lease_id: String,
    pub lease_epoch: i64,
    pub status: String,
    pub estimated_tokens: i64,
    pub estimated_cost_usd: f64,
    pub token_input: Option<i64>,
    pub token_output: Option<i64>,
    pub cost_usd: Option<f64>,
    pub candidate_draft_id: Option<String>,
    pub adopted_draft_id: Option<String>,
    pub review_session_id: Option<String>,
    pub successful_experts: Option<i64>,
    pub average_score: Option<f64>,
    pub acceptance_rate: Option<f64>,
    pub analysis_confirmed: bool,
    pub decision: Option<Value>,
    pub decision_hash: Option<String>,
    pub error: Option<Value>,
    pub claimed_at: String,
    pub finished_at: Option<String>,
}

fn map_attempt(row: &Row<'_>) -> rusqlite::Result<AutonomousRunChapterAttemptDto> {
    Ok(AutonomousRunChapterAttemptDto {
        attempt_id: row.get(0)?,
        run_id: row.get(1)?,
        novel_id: row.get(2)?,
        chapter_id: row.get(3)?,
        chapter_number: row.get(4)?,
        attempt_number: row.get(5)?,
        operation_id: row.get(6)?,
        lease_id: row.get(7)?,
        lease_epoch: row.get(8)?,
        status: row.get(9)?,
        estimated_tokens: row.get(10)?,
        estimated_cost_usd: row.get(11)?,
        token_input: row.get(12)?,
        token_output: row.get(13)?,
        cost_usd: row.get(14)?,
        candidate_draft_id: row.get(15)?,
        adopted_draft_id: row.get(16)?,
        review_session_id: row.get(17)?,
        successful_experts: row.get(18)?,
        average_score: row.get(19)?,
        acceptance_rate: row.get(20)?,
        analysis_confirmed: row.get::<_, i64>(21)? != 0,
        decision: parse_optional_json(row.get(22)?),
        decision_hash: row.get(23)?,
        error: parse_optional_json(row.get(24)?),
        claimed_at: row.get(25)?,
        finished_at: row.get(26)?,
    })
}

fn find_attempt(
    connection: &Connection,
    attempt_id: &str,
) -> Result<Option<AutonomousRunChapterAttemptDto>, AppError> {
    connection
        .query_row(
            &format!(
                "SELECT {ATTEMPT_COLUMNS} FROM autonomous_run_chapter_attempts WHERE attempt_id=?1"
            ),
            [attempt_id],
            map_attempt,
        )
        .optional()
        .map_err(AppError::database)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimAutonomousRunChapterInput {
    pub run_id: String,
    pub lease: AutonomousRunLeaseProof,
    pub estimated_tokens: i64,
    pub estimated_cost_usd: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousRunChapterClaim {
    pub run: AutonomousBookRunDto,
    pub attempt: AutonomousRunChapterAttemptDto,
    pub chapter_plan: Value,
}

fn chapter_plan(plan: &Value, chapter_number: i64) -> Result<Value, AppError> {
    plan.get("chapters")
        .and_then(Value::as_array)
        .and_then(|chapters| {
            chapters.iter().find(|chapter| {
                chapter.get("chapterNumber").and_then(Value::as_i64) == Some(chapter_number)
            })
        })
        .cloned()
        .ok_or_else(|| invalid("全书计划缺少待执行章节"))
}

fn reset_daily_usage(
    transaction: &Transaction<'_>,
    run: &AutonomousBookRunDto,
) -> Result<(), AppError> {
    let day = usage_day();
    if run.usage_day == day {
        return Ok(());
    }
    transaction
        .execute(
            "UPDATE autonomous_book_runs
             SET usage_day=?1, daily_token_input=0, daily_token_output=0,
                 daily_cost_usd=0, state_revision=state_revision+1, updated_at=?2
             WHERE run_id=?3 AND usage_day<>?1",
            params![day, Utc::now().to_rfc3339(), run.run_id],
        )
        .map_err(AppError::database)?;
    Ok(())
}

fn enforce_preflight_budget(
    transaction: &Transaction<'_>,
    run: &AutonomousBookRunDto,
    estimated_tokens: i64,
    estimated_cost_usd: f64,
) -> Result<(), AppError> {
    let (reserved_tokens, reserved_cost): (i64, f64) = transaction
        .query_row(
            "SELECT COALESCE(SUM(estimated_tokens),0), COALESCE(SUM(estimated_cost_usd),0)
             FROM autonomous_run_chapter_attempts WHERE run_id=?1 AND status='claimed'",
            [&run.run_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(AppError::database)?;
    let book_tokens = run.token_input + run.token_output + reserved_tokens + estimated_tokens;
    let daily_tokens =
        run.daily_token_input + run.daily_token_output + reserved_tokens + estimated_tokens;
    let book_cost = run.cost_usd + reserved_cost + estimated_cost_usd;
    let daily_cost = run.daily_cost_usd + reserved_cost + estimated_cost_usd;
    let blocked = run
        .policy
        .book_token_budget
        .is_some_and(|budget| book_tokens > budget)
        || run
            .policy
            .daily_token_budget
            .is_some_and(|budget| daily_tokens > budget)
        || run
            .policy
            .book_cost_budget_usd
            .is_some_and(|budget| book_cost > budget)
        || run
            .policy
            .daily_cost_budget_usd
            .is_some_and(|budget| daily_cost > budget);
    if blocked {
        return Err(scheduler_error(
            codes::AUTONOMOUS_RUN_BUDGET_EXCEEDED,
            "下一章的保守预留会超过冻结预算",
            false,
        ));
    }
    Ok(())
}

pub fn claim_chapter(
    connection: &mut Connection,
    input: ClaimAutonomousRunChapterInput,
) -> Result<AutonomousRunChapterClaim, AppError> {
    if input.estimated_tokens < 0
        || input.estimated_tokens > 10_000_000
        || !input.estimated_cost_usd.is_finite()
        || input.estimated_cost_usd < 0.0
        || input.estimated_cost_usd > 1_000_000.0
    {
        return Err(invalid("章节预算预留无效"));
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    validate_lease(&transaction, &input.run_id, &input.lease, &now)?;
    let mut run = require_run(&transaction, &input.run_id)?;
    if run.status != "running" {
        return Err(conflict("无人值守任务当前不是 running"));
    }
    reset_daily_usage(&transaction, &run)?;
    run = require_run(&transaction, &input.run_id)?;
    if !run.policy.window_open() {
        return Err(scheduler_error(
            codes::AUTONOMOUS_RUN_WINDOW_CLOSED,
            "当前时间不在冻结的允许运行时段内",
            true,
        ));
    }
    if run.completed_chapters >= run.policy.max_chapters {
        return Err(scheduler_error(
            codes::AUTONOMOUS_RUN_POLICY_BLOCKED,
            "已达到策略允许的最大章节数",
            false,
        ));
    }
    enforce_preflight_budget(
        &transaction,
        &run,
        input.estimated_tokens,
        input.estimated_cost_usd,
    )?;

    let plan = autonomous_story_service::get_plan(&transaction, &run.plan_id)?
        .ok_or_else(|| invalid("全书计划不存在"))?;
    let chapter = chapter_plan(&plan, run.next_chapter_number)?;
    let chapter_id = require_id(
        chapter
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        "chapterId",
        200,
    )?;
    let active_claim: Option<String> = transaction
        .query_row(
            "SELECT attempt_id FROM autonomous_run_chapter_attempts
             WHERE run_id=?1 AND chapter_number=?2 AND status='claimed'",
            params![run.run_id, run.next_chapter_number],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)?;
    if active_claim.is_some() {
        return Err(conflict("待执行章节已经被当前租约 claim"));
    }
    let attempt_number: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(attempt_number),0)+1
             FROM autonomous_run_chapter_attempts WHERE run_id=?1 AND chapter_number=?2",
            params![run.run_id, run.next_chapter_number],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if attempt_number > run.policy.max_retries_per_chapter + 1 {
        return Err(scheduler_error(
            codes::AUTONOMOUS_RUN_POLICY_BLOCKED,
            "本章已达到最大尝试次数",
            false,
        ));
    }
    let attempt_id = Uuid::new_v4().to_string();
    let operation_id = format!(
        "autonomous-run:{}:chapter:{}:attempt:{}",
        run.run_id, run.next_chapter_number, attempt_number
    );
    transaction
        .execute(
            "INSERT INTO autonomous_run_chapter_attempts
             (attempt_id, run_id, novel_id, chapter_id, chapter_number, attempt_number,
              operation_id, lease_id, lease_epoch, status, estimated_tokens,
              estimated_cost_usd, claimed_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'claimed',?10,?11,?12)",
            params![
                attempt_id,
                run.run_id,
                run.novel_id,
                chapter_id,
                run.next_chapter_number,
                attempt_number,
                operation_id,
                input.lease.lease_id,
                input.lease.epoch,
                input.estimated_tokens,
                input.estimated_cost_usd,
                now,
            ],
        )
        .map_err(AppError::database)?;
    insert_checkpoint(
        &transaction,
        &run,
        "chapter_claimed",
        Some(&attempt_id),
        &serde_json::json!({
            "chapterId": chapter_id,
            "chapterNumber": run.next_chapter_number,
            "attemptNumber": attempt_number,
            "leaseEpoch": input.lease.epoch,
            "estimatedTokens": input.estimated_tokens,
            "estimatedCostUsd": input.estimated_cost_usd,
        }),
        &now,
    )?;
    commit(transaction, Some(&operation_id))?;
    Ok(AutonomousRunChapterClaim {
        run: require_run(connection, &input.run_id)?,
        attempt: find_attempt(connection, &attempt_id)?
            .ok_or_else(|| conflict("claim 后章节 Attempt 不可读"))?,
        chapter_plan: chapter,
    })
}

fn validate_usage(
    token_input: Option<i64>,
    token_output: Option<i64>,
    cost_usd: Option<f64>,
) -> Result<(), AppError> {
    if token_input.is_some_and(|value| !(0..=100_000_000).contains(&value))
        || token_output.is_some_and(|value| !(0..=100_000_000).contains(&value))
        || cost_usd.is_some_and(|value| !value.is_finite() || !(0.0..=1_000_000.0).contains(&value))
    {
        return Err(invalid("章节实际 Token 或成本无效"));
    }
    Ok(())
}

fn validate_review_metrics(
    successful_experts: Option<i64>,
    average_score: Option<f64>,
    acceptance_rate: Option<f64>,
) -> Result<(), AppError> {
    if successful_experts.is_some_and(|value| !(0..=64).contains(&value))
        || average_score.is_some_and(|value| !value.is_finite() || !(0.0..=100.0).contains(&value))
        || acceptance_rate.is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
    {
        return Err(invalid("专家评审指标无效"));
    }
    Ok(())
}

fn verify_draft(
    transaction: &Transaction<'_>,
    novel_id: &str,
    chapter_id: &str,
    draft_id: &str,
    require_adopted: bool,
) -> Result<(), AppError> {
    let identity: Option<(String, String, i64)> = transaction
        .query_row(
            "SELECT novel_id, chapter_id, is_adopted FROM chapter_drafts WHERE id=?1",
            [draft_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(AppError::database)?;
    let Some((actual_novel, actual_chapter, adopted)) = identity else {
        return Err(scheduler_error(
            codes::AUTONOMOUS_RUN_DECISION_INVALID,
            "调度决策引用的草稿不存在",
            false,
        ));
    };
    if actual_novel != novel_id || actual_chapter != chapter_id || (require_adopted && adopted != 1)
    {
        return Err(scheduler_error(
            codes::AUTONOMOUS_RUN_DECISION_INVALID,
            "调度决策引用的草稿作用域或采用状态无效",
            false,
        ));
    }
    Ok(())
}

fn verify_analysis_confirmed(
    transaction: &Transaction<'_>,
    novel_id: &str,
    chapter_id: &str,
    adopted_draft_id: &str,
) -> Result<(), AppError> {
    let count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM chapter_summaries
             WHERE novel_id=?1 AND chapter_id=?2 AND adopted_draft_id=?3
               AND enabled=1 AND validation_status='passed'",
            params![novel_id, chapter_id, adopted_draft_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if count != 1 {
        return Err(scheduler_error(
            codes::AUTONOMOUS_RUN_DECISION_INVALID,
            "全自动确认缺少与采用稿绑定且校验通过的章节总结",
            false,
        ));
    }
    Ok(())
}

fn expected_success_outcome(
    policy: &AutonomousAutomationPolicy,
    quality_passes: bool,
) -> &'static str {
    match policy.mode.as_str() {
        "draft_night" => "candidate_ready",
        "quality_gate" if quality_passes => "adopted",
        "full_auto" if quality_passes && policy.auto_confirm_analysis => "confirmed",
        "full_auto" if quality_passes => "adopted",
        _ => "candidate_ready",
    }
}

fn release_lease_if_active(
    transaction: &Transaction<'_>,
    lease_id: &str,
    now: &str,
) -> Result<(), AppError> {
    transaction
        .execute(
            "UPDATE autonomous_run_leases SET status='released', released_at=?1
             WHERE lease_id=?2 AND status='active'",
            params![now, lease_id],
        )
        .map_err(AppError::database)?;
    Ok(())
}

fn post_usage_exceeds_budget(run: &AutonomousBookRunDto) -> bool {
    let book_tokens = run.token_input + run.token_output;
    let daily_tokens = run.daily_token_input + run.daily_token_output;
    run.policy
        .book_token_budget
        .is_some_and(|budget| book_tokens >= budget)
        || run
            .policy
            .daily_token_budget
            .is_some_and(|budget| daily_tokens >= budget)
        || run
            .policy
            .book_cost_budget_usd
            .is_some_and(|budget| run.cost_usd >= budget)
        || run
            .policy
            .daily_cost_budget_usd
            .is_some_and(|budget| run.daily_cost_usd >= budget)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishAutonomousRunChapterInput {
    pub run_id: String,
    pub attempt_id: String,
    pub lease: AutonomousRunLeaseProof,
    pub outcome: String,
    pub token_input: Option<i64>,
    pub token_output: Option<i64>,
    pub cost_usd: Option<f64>,
    pub candidate_draft_id: Option<String>,
    pub adopted_draft_id: Option<String>,
    pub review_session_id: Option<String>,
    pub successful_experts: Option<i64>,
    pub average_score: Option<f64>,
    pub acceptance_rate: Option<f64>,
    pub analysis_confirmed: Option<bool>,
    pub error: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishAutonomousRunChapterResult {
    pub run: AutonomousBookRunDto,
    pub attempt: AutonomousRunChapterAttemptDto,
    pub decision: Value,
    pub replayed: bool,
}

pub fn finish_chapter(
    connection: &mut Connection,
    input: FinishAutonomousRunChapterInput,
) -> Result<FinishAutonomousRunChapterResult, AppError> {
    validate_usage(input.token_input, input.token_output, input.cost_usd)?;
    validate_review_metrics(
        input.successful_experts,
        input.average_score,
        input.acceptance_rate,
    )?;
    if !matches!(
        input.outcome.as_str(),
        "candidate_ready" | "adopted" | "confirmed" | "failed" | "cancelled"
    ) {
        return Err(invalid("章节 Attempt 终态无效"));
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    let run = require_run(&transaction, &input.run_id)?;
    let attempt = find_attempt(&transaction, &input.attempt_id)?
        .ok_or_else(|| invalid("章节 Attempt 不存在"))?;
    if attempt.run_id != run.run_id
        || attempt.lease_id != input.lease.lease_id
        || attempt.lease_epoch != input.lease.epoch
    {
        return Err(scheduler_error(
            codes::AUTONOMOUS_RUN_DECISION_INVALID,
            "章节 Attempt 与当前租约不匹配",
            false,
        ));
    }
    if attempt.status != "claimed" {
        validate_lease_identity(&transaction, &input.run_id, &input.lease)?;
        let replay_matches = attempt.status == input.outcome
            && input
                .token_input
                .is_none_or(|value| attempt.token_input == Some(value))
            && input
                .token_output
                .is_none_or(|value| attempt.token_output == Some(value))
            && input
                .cost_usd
                .is_none_or(|value| attempt.cost_usd == Some(value))
            && input.candidate_draft_id == attempt.candidate_draft_id
            && input.adopted_draft_id == attempt.adopted_draft_id
            && input.review_session_id == attempt.review_session_id
            && input.successful_experts == attempt.successful_experts
            && input.average_score == attempt.average_score
            && input.acceptance_rate == attempt.acceptance_rate
            && input.analysis_confirmed.unwrap_or(false) == attempt.analysis_confirmed;
        if !replay_matches {
            return Err(conflict("Attempt 已终结，重放载荷与已提交结果不一致"));
        }
        if let Some(candidate) = attempt.candidate_draft_id.as_deref() {
            verify_draft(
                &transaction,
                &run.novel_id,
                &attempt.chapter_id,
                candidate,
                false,
            )?;
        }
        if let Some(adopted) = attempt.adopted_draft_id.as_deref() {
            verify_draft(
                &transaction,
                &run.novel_id,
                &attempt.chapter_id,
                adopted,
                true,
            )?;
            if attempt.status == "confirmed" {
                verify_analysis_confirmed(
                    &transaction,
                    &run.novel_id,
                    &attempt.chapter_id,
                    adopted,
                )?;
            }
        }
        let decision = attempt
            .decision
            .clone()
            .unwrap_or_else(|| serde_json::json!({ "outcome": attempt.status }));
        drop(transaction);
        return Ok(FinishAutonomousRunChapterResult {
            run,
            attempt,
            decision,
            replayed: true,
        });
    }
    validate_lease(&transaction, &input.run_id, &input.lease, &now)?;
    if run.status != "running" {
        return Err(conflict("无人值守任务不再运行"));
    }

    let is_failure = matches!(input.outcome.as_str(), "failed" | "cancelled");
    let quality_passes = run.policy.quality_passes(
        input.successful_experts,
        input.average_score,
        input.acceptance_rate,
    );
    if !is_failure {
        let expected = expected_success_outcome(&run.policy, quality_passes);
        if input.outcome != expected {
            return Err(scheduler_error(
                codes::AUTONOMOUS_RUN_DECISION_INVALID,
                format!("冻结策略要求本章进入 {expected}，收到 {}", input.outcome),
                false,
            ));
        }
    }

    let candidate_draft_id = input
        .candidate_draft_id
        .as_deref()
        .map(|value| require_id(value, "candidateDraftId", 200))
        .transpose()?;
    let adopted_draft_id = input
        .adopted_draft_id
        .as_deref()
        .map(|value| require_id(value, "adoptedDraftId", 200))
        .transpose()?;
    if !is_failure {
        let candidate = candidate_draft_id.as_deref().ok_or_else(|| {
            scheduler_error(
                codes::AUTONOMOUS_RUN_DECISION_INVALID,
                "成功章节缺少候选草稿",
                false,
            )
        })?;
        verify_draft(
            &transaction,
            &run.novel_id,
            &attempt.chapter_id,
            candidate,
            false,
        )?;
        if matches!(input.outcome.as_str(), "adopted" | "confirmed") {
            let adopted = adopted_draft_id.as_deref().ok_or_else(|| {
                scheduler_error(
                    codes::AUTONOMOUS_RUN_DECISION_INVALID,
                    "自动采用决策缺少采用稿",
                    false,
                )
            })?;
            if adopted != candidate {
                return Err(scheduler_error(
                    codes::AUTONOMOUS_RUN_DECISION_INVALID,
                    "采用稿必须是通过评审的候选稿",
                    false,
                ));
            }
            verify_draft(
                &transaction,
                &run.novel_id,
                &attempt.chapter_id,
                adopted,
                true,
            )?;
            if input.outcome == "confirmed" {
                if input.analysis_confirmed != Some(true) {
                    return Err(scheduler_error(
                        codes::AUTONOMOUS_RUN_DECISION_INVALID,
                        "全自动终态必须显式确认章节分析",
                        false,
                    ));
                }
                verify_analysis_confirmed(
                    &transaction,
                    &run.novel_id,
                    &attempt.chapter_id,
                    adopted,
                )?;
            }
        }
    }

    let safe_error = input
        .error
        .as_ref()
        .map(|value| {
            ai_fact_security::validate_metadata(value, "无人值守章节错误")?;
            Ok::<Value, AppError>(ai_fact_security::canonicalize(value))
        })
        .transpose()?;
    if is_failure && safe_error.is_none() {
        return Err(invalid("失败章节必须提供安全错误元数据"));
    }
    let token_input = input.token_input.unwrap_or(0);
    let token_output = input
        .token_output
        .unwrap_or_else(|| attempt.estimated_tokens.saturating_sub(token_input));
    let cost_usd = input.cost_usd.unwrap_or(attempt.estimated_cost_usd);
    let decision = serde_json::json!({
        "policyHash": run.policy_hash,
        "mode": run.mode,
        "qualityPasses": quality_passes,
        "minimumSuccessfulExperts": run.policy.minimum_successful_experts,
        "minimumAverageScore": run.policy.minimum_average_score,
        "minimumAcceptanceRate": run.policy.minimum_acceptance_rate,
        "successfulExperts": input.successful_experts,
        "averageScore": input.average_score,
        "acceptanceRate": input.acceptance_rate,
        "outcome": input.outcome,
        "reason": if is_failure {
            "execution_failed"
        } else if quality_passes {
            "quality_gate_passed"
        } else if run.mode == "draft_night" {
            "draft_mode_requires_review"
        } else {
            "quality_gate_requires_review"
        },
    });
    let decision_json = ai_fact_security::canonical_json(&decision)?;
    let decision_hash = large_text_repository::sha256(&decision_json);
    let error_json = safe_error
        .as_ref()
        .map(ai_fact_security::canonical_json)
        .transpose()?;
    let changed = transaction
        .execute(
            "UPDATE autonomous_run_chapter_attempts
             SET status=?1, token_input=?2, token_output=?3, cost_usd=?4,
                 candidate_draft_id=?5, adopted_draft_id=?6, review_session_id=?7,
                 successful_experts=?8, average_score=?9, acceptance_rate=?10,
                 analysis_confirmed=?11, decision_json=?12, decision_hash=?13,
                 error_json=?14, finished_at=?15
             WHERE attempt_id=?16 AND run_id=?17 AND status='claimed'",
            params![
                input.outcome,
                token_input,
                token_output,
                cost_usd,
                candidate_draft_id,
                adopted_draft_id,
                input.review_session_id,
                input.successful_experts,
                input.average_score,
                input.acceptance_rate,
                i64::from(input.analysis_confirmed.unwrap_or(false)),
                decision_json,
                decision_hash,
                error_json,
                now,
                input.attempt_id,
                run.run_id,
            ],
        )
        .map_err(AppError::database)?;
    if changed != 1 {
        return Err(conflict("章节 Attempt 终态提交发生并发冲突"));
    }

    let success_counts = input.outcome == "candidate_ready" && run.mode == "draft_night"
        || matches!(input.outcome.as_str(), "adopted" | "confirmed");
    let consecutive_failures = if is_failure {
        run.consecutive_failures + 1
    } else {
        0
    };
    let completed_chapters = run.completed_chapters + i64::from(success_counts);
    let target_chapters = run.total_chapters.min(run.policy.max_chapters);
    let mut next_status = "running";
    let mut pause_reason: Option<&str> = None;
    if is_failure && consecutive_failures >= run.policy.max_consecutive_failures {
        next_status = "paused";
        pause_reason = Some("consecutive_failures");
    } else if !is_failure && !success_counts {
        next_status = "paused";
        pause_reason = Some("review_required");
    } else if completed_chapters >= target_chapters {
        next_status = "completed";
    }
    let completed_at = (next_status == "completed").then_some(now.as_str());
    let paused_at = (next_status == "paused").then_some(now.as_str());
    transaction
        .execute(
            "UPDATE autonomous_book_runs
             SET status=?1, state_revision=state_revision+1,
                 next_chapter_number=next_chapter_number+?2,
                 completed_chapters=?3, token_input=token_input+?4,
                 token_output=token_output+?5, cost_usd=cost_usd+?6,
                 daily_token_input=daily_token_input+?4,
                 daily_token_output=daily_token_output+?5,
                 daily_cost_usd=daily_cost_usd+?6,
                 consecutive_failures=?7, pause_reason=?8, error_json=?9,
                 paused_at=?10, completed_at=?11, updated_at=?12
             WHERE run_id=?13 AND state_revision=?14 AND status='running'",
            params![
                next_status,
                i64::from(success_counts),
                completed_chapters,
                token_input,
                token_output,
                cost_usd,
                consecutive_failures,
                pause_reason,
                error_json,
                paused_at,
                completed_at,
                now,
                run.run_id,
                run.state_revision,
            ],
        )
        .map_err(AppError::database)?;
    let mut updated_run = require_run(&transaction, &run.run_id)?;
    if updated_run.status == "running" && post_usage_exceeds_budget(&updated_run) {
        transaction
            .execute(
                "UPDATE autonomous_book_runs
                 SET status='paused', state_revision=state_revision+1,
                     pause_reason='budget_reached', paused_at=?1, updated_at=?1
                 WHERE run_id=?2 AND status='running'",
                params![now, run.run_id],
            )
            .map_err(AppError::database)?;
        updated_run = require_run(&transaction, &run.run_id)?;
    }
    if updated_run.status != "running" {
        release_lease_if_active(&transaction, &input.lease.lease_id, &now)?;
    }
    insert_checkpoint(
        &transaction,
        &updated_run,
        "chapter_finished",
        Some(&attempt.attempt_id),
        &serde_json::json!({
            "chapterNumber": attempt.chapter_number,
            "outcome": input.outcome,
            "decisionHash": decision_hash,
            "tokenInput": token_input,
            "tokenOutput": token_output,
            "costUsd": cost_usd,
        }),
        &now,
    )?;
    commit(transaction, Some(&attempt.operation_id))?;
    Ok(FinishAutonomousRunChapterResult {
        run: require_run(connection, &input.run_id)?,
        attempt: find_attempt(connection, &input.attempt_id)?
            .ok_or_else(|| conflict("终态 Attempt 不可读"))?,
        decision,
        replayed: false,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteAutonomousRunAttemptInput {
    pub operation_id: String,
    pub run_id: String,
    pub attempt_id: String,
    pub expected_revision: i64,
    pub outcome: String,
    pub adopted_draft_id: String,
    pub analysis_confirmed: Option<bool>,
    pub user_confirmed: bool,
}

pub fn promote_attempt(
    connection: &mut Connection,
    input: PromoteAutonomousRunAttemptInput,
) -> Result<FinishAutonomousRunChapterResult, AppError> {
    let operation_id = require_id(&input.operation_id, "operationId", 200)?;
    if !input.user_confirmed || !matches!(input.outcome.as_str(), "adopted" | "confirmed") {
        return Err(invalid("人工审核晋级必须显式确认 adopted 或 confirmed"));
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    let run = require_run(&transaction, &input.run_id)?;
    let attempt = find_attempt(&transaction, &input.attempt_id)?
        .ok_or_else(|| invalid("章节 Attempt 不存在"))?;
    if attempt.run_id != run.run_id {
        return Err(scheduler_error(
            codes::AUTONOMOUS_RUN_DECISION_INVALID,
            "Attempt 不属于指定的无人值守任务",
            false,
        ));
    }
    if attempt.status == input.outcome {
        let replay_operation = attempt
            .decision
            .as_ref()
            .and_then(|value| value.get("operationId"))
            .and_then(Value::as_str);
        if replay_operation != Some(operation_id.as_str())
            || attempt.adopted_draft_id.as_deref() != Some(input.adopted_draft_id.as_str())
            || attempt.analysis_confirmed != input.analysis_confirmed.unwrap_or(false)
        {
            return Err(conflict("人工审核晋级重放载荷与已提交结果不一致"));
        }
        verify_draft(
            &transaction,
            &run.novel_id,
            &attempt.chapter_id,
            &input.adopted_draft_id,
            true,
        )?;
        if input.outcome == "confirmed" {
            verify_analysis_confirmed(
                &transaction,
                &run.novel_id,
                &attempt.chapter_id,
                &input.adopted_draft_id,
            )?;
        }
        let decision = attempt
            .decision
            .clone()
            .unwrap_or_else(|| serde_json::json!({ "outcome": attempt.status }));
        drop(transaction);
        return Ok(FinishAutonomousRunChapterResult {
            run,
            attempt,
            decision,
            replayed: true,
        });
    }
    let draft_night_already_counted = run.mode == "draft_night";
    if (!draft_night_already_counted && run.status != "paused")
        || run.state_revision != input.expected_revision
        || attempt.status != "candidate_ready"
        || attempt.candidate_draft_id.as_deref() != Some(input.adopted_draft_id.as_str())
    {
        return Err(conflict("人工审核晋级所依据的任务或候选版本已变化"));
    }
    verify_draft(
        &transaction,
        &run.novel_id,
        &attempt.chapter_id,
        &input.adopted_draft_id,
        true,
    )?;
    if input.outcome == "confirmed" {
        if input.analysis_confirmed != Some(true) {
            return Err(invalid("confirmed 晋级必须显式确认章节分析"));
        }
        verify_analysis_confirmed(
            &transaction,
            &run.novel_id,
            &attempt.chapter_id,
            &input.adopted_draft_id,
        )?;
    }
    let decision = serde_json::json!({
        "policyHash": run.policy_hash,
        "outcome": input.outcome,
        "reason": "explicit_user_review",
        "operationId": operation_id,
        "confirmedBy": "user",
    });
    let decision_json = ai_fact_security::canonical_json(&decision)?;
    let decision_hash = large_text_repository::sha256(&decision_json);
    transaction
        .execute(
            "UPDATE autonomous_run_chapter_attempts
             SET status=?1, adopted_draft_id=?2, analysis_confirmed=?3,
                 decision_json=?4, decision_hash=?5
             WHERE attempt_id=?6 AND run_id=?7 AND status='candidate_ready'",
            params![
                input.outcome,
                input.adopted_draft_id,
                i64::from(input.analysis_confirmed.unwrap_or(false)),
                decision_json,
                decision_hash,
                attempt.attempt_id,
                run.run_id,
            ],
        )
        .map_err(AppError::database)?;
    let changed = if draft_night_already_counted {
        transaction
            .execute(
                "UPDATE autonomous_book_runs
                 SET state_revision=state_revision+1, updated_at=?1
                 WHERE run_id=?2 AND state_revision=?3",
                params![now, run.run_id, input.expected_revision],
            )
            .map_err(AppError::database)?
    } else {
        let completed = run.completed_chapters + 1;
        let target = run.total_chapters.min(run.policy.max_chapters);
        let status = if completed >= target {
            "completed"
        } else {
            "queued"
        };
        let completed_at = (status == "completed").then_some(now.as_str());
        transaction
            .execute(
                "UPDATE autonomous_book_runs
                 SET status=?1, state_revision=state_revision+1,
                     completed_chapters=?2, next_chapter_number=next_chapter_number+1,
                     consecutive_failures=0, pause_reason=NULL, paused_at=NULL,
                     completed_at=?3, updated_at=?4
                 WHERE run_id=?5 AND state_revision=?6 AND status='paused'",
                params![
                    status,
                    completed,
                    completed_at,
                    now,
                    run.run_id,
                    input.expected_revision,
                ],
            )
            .map_err(AppError::database)?
    };
    if changed != 1 {
        return Err(conflict("人工审核晋级发生并发冲突"));
    }
    let updated_run = require_run(&transaction, &run.run_id)?;
    insert_checkpoint(
        &transaction,
        &updated_run,
        "attempt_promoted",
        Some(&attempt.attempt_id),
        &serde_json::json!({
            "operationId": operation_id,
            "outcome": input.outcome,
            "decisionHash": decision_hash,
        }),
        &now,
    )?;
    commit(transaction, Some(&operation_id))?;
    Ok(FinishAutonomousRunChapterResult {
        run: require_run(connection, &input.run_id)?,
        attempt: find_attempt(connection, &input.attempt_id)?
            .ok_or_else(|| conflict("晋级后的 Attempt 不可读"))?,
        decision,
        replayed: false,
    })
}

pub fn list_attempts(
    connection: &Connection,
    run_id: &str,
    limit: i64,
) -> Result<Vec<AutonomousRunChapterAttemptDto>, AppError> {
    let run_id = require_id(run_id, "runId", 200)?;
    if !(1..=500).contains(&limit) {
        return Err(invalid("Attempt 分页大小无效"));
    }
    let sql = format!(
        "SELECT {ATTEMPT_COLUMNS} FROM autonomous_run_chapter_attempts
         WHERE run_id=?1 ORDER BY chapter_number, attempt_number LIMIT ?2"
    );
    let mut statement = connection.prepare(&sql).map_err(AppError::database)?;
    let attempts = statement
        .query_map(params![run_id, limit], map_attempt)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(attempts)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeAutonomousRunStateInput {
    pub operation_id: String,
    pub run_id: String,
    pub expected_revision: i64,
    pub reason: Option<String>,
}

fn change_state(
    connection: &mut Connection,
    input: ChangeAutonomousRunStateInput,
    action: &str,
) -> Result<AutonomousBookRunDto, AppError> {
    let operation_id = require_id(&input.operation_id, "operationId", 200)?;
    let reason = input
        .reason
        .as_deref()
        .map(|value| require_id(value, "reason", 240))
        .transpose()?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    let run = require_run(&transaction, &input.run_id)?;
    if run.state_revision != input.expected_revision {
        return Err(conflict("无人值守任务版本已变化"));
    }
    let (target_status, allowed, pause_reason) = match action {
        "pause" => (
            "paused",
            matches!(run.status.as_str(), "queued" | "running"),
            reason.as_deref().or(Some("user_paused")),
        ),
        "resume" => ("queued", run.status == "paused", None),
        "stop" => (
            "stopped",
            matches!(run.status.as_str(), "queued" | "running" | "paused"),
            reason.as_deref().or(Some("user_stopped")),
        ),
        _ => return Err(invalid("未知调度状态操作")),
    };
    if !allowed {
        if run.status == target_status {
            return Ok(run);
        }
        return Err(conflict("当前无人值守任务状态不允许该操作"));
    }
    if matches!(action, "pause" | "stop") {
        let cancellation = ai_fact_security::canonical_json(&serde_json::json!({
            "code": "AUTONOMOUS_RUN_INTERRUPTED_BY_USER",
            "retryable": action == "pause",
        }))?;
        transaction
            .execute(
                "UPDATE autonomous_run_chapter_attempts
                 SET status='cancelled', error_json=?1, finished_at=?2
                 WHERE run_id=?3 AND status='claimed'",
                params![cancellation, now, run.run_id],
            )
            .map_err(AppError::database)?;
        transaction
            .execute(
                "UPDATE autonomous_run_leases SET status='released', released_at=?1
                 WHERE run_id=?2 AND status='active'",
                params![now, run.run_id],
            )
            .map_err(AppError::database)?;
    }
    let completed_at = (action == "stop").then_some(now.as_str());
    let paused_at = (action == "pause").then_some(now.as_str());
    let changed = transaction
        .execute(
            "UPDATE autonomous_book_runs
             SET status=?1, state_revision=state_revision+1, pause_reason=?2,
                 paused_at=?3, completed_at=?4, updated_at=?5
             WHERE run_id=?6 AND state_revision=?7",
            params![
                target_status,
                pause_reason,
                paused_at,
                completed_at,
                now,
                run.run_id,
                input.expected_revision,
            ],
        )
        .map_err(AppError::database)?;
    if changed != 1 {
        return Err(conflict("无人值守任务状态更新发生并发冲突"));
    }
    let updated = require_run(&transaction, &run.run_id)?;
    insert_checkpoint(
        &transaction,
        &updated,
        &format!("run_{action}"),
        None,
        &serde_json::json!({ "operationId": operation_id, "reason": reason }),
        &now,
    )?;
    commit(transaction, Some(&operation_id))?;
    require_run(connection, &input.run_id)
}

pub fn pause_run(
    connection: &mut Connection,
    input: ChangeAutonomousRunStateInput,
) -> Result<AutonomousBookRunDto, AppError> {
    change_state(connection, input, "pause")
}

pub fn resume_run(
    connection: &mut Connection,
    input: ChangeAutonomousRunStateInput,
) -> Result<AutonomousBookRunDto, AppError> {
    change_state(connection, input, "resume")
}

pub fn stop_run(
    connection: &mut Connection,
    input: ChangeAutonomousRunStateInput,
) -> Result<AutonomousBookRunDto, AppError> {
    change_state(connection, input, "stop")
}

pub fn recover_interrupted_runs(
    connection: &mut Connection,
) -> Result<Vec<AutonomousBookRunDto>, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    transaction
        .execute(
            "UPDATE autonomous_run_leases SET status='expired', released_at=?1
             WHERE status='active' AND expires_at<=?1",
            [&now],
        )
        .map_err(AppError::database)?;
    let run_ids = {
        let mut statement = transaction
            .prepare(
                "SELECT run_id FROM autonomous_book_runs r
                 WHERE r.status='running' AND NOT EXISTS (
                     SELECT 1 FROM autonomous_run_leases l
                     WHERE l.run_id=r.run_id AND l.status='active'
                 ) ORDER BY r.created_at",
            )
            .map_err(AppError::database)?;
        let run_ids = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        run_ids
    };
    let recovery_error = ai_fact_security::canonical_json(&serde_json::json!({
        "code": "AUTONOMOUS_RUN_PROCESS_INTERRUPTED",
        "retryable": true,
    }))?;
    for run_id in &run_ids {
        transaction
            .execute(
                "UPDATE autonomous_run_chapter_attempts
                 SET status='abandoned', error_json=?1, finished_at=?2
                 WHERE run_id=?3 AND status='claimed'",
                params![recovery_error, now, run_id],
            )
            .map_err(AppError::database)?;
        transaction
            .execute(
                "UPDATE autonomous_book_runs
                 SET status='queued', state_revision=state_revision+1,
                     pause_reason=NULL, paused_at=NULL, updated_at=?1
                 WHERE run_id=?2 AND status='running'",
                params![now, run_id],
            )
            .map_err(AppError::database)?;
        let run = require_run(&transaction, run_id)?;
        insert_checkpoint(
            &transaction,
            &run,
            "run_recovered",
            None,
            &serde_json::json!({ "reason": "expired_or_missing_lease" }),
            &now,
        )?;
    }
    commit(transaction, None)?;
    run_ids
        .iter()
        .map(|run_id| require_run(connection, run_id))
        .collect()
}

#[cfg(test)]
#[path = "autonomous_scheduler_service_tests.rs"]
mod tests;
