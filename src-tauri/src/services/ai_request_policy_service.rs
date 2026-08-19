use crate::errors::{codes, AppError};
use crate::repositories::large_text_repository;
use chrono::{Local, TimeZone};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const MINUTE_MS: i64 = 60_000;
const MIN_TTL_MS: i64 = 60_000;
const MAX_TTL_MS: i64 = 2 * 60 * 60_000;
const MAX_TOKEN_VALUE: i64 = 10_000_000_000;
const COST_UNITS_PER_USD: f64 = 100_000_000.0;
const MAX_COST_BUDGET_USD: f64 = 1_000_000.0;
const MAX_PRICE_PER_MILLION_TOKENS: f64 = 1_000_000.0;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReserveAiRequestInput {
    pub owner_id: String,
    pub provider_request_id: String,
    pub max_requests_per_minute: i64,
    pub max_concurrent_requests: i64,
    pub daily_token_budget: Option<i64>,
    pub daily_cost_budget_usd: Option<f64>,
    pub estimated_input_tokens: i64,
    pub estimated_output_tokens: i64,
    pub input_price_per_million_tokens: Option<f64>,
    pub output_price_per_million_tokens: Option<f64>,
    pub warning_percent: i64,
    pub ttl_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureAiRequestPolicyInput {
    pub expected_revision: Option<i64>,
    pub max_requests_per_minute: i64,
    pub max_concurrent_requests: i64,
    pub daily_token_budget: Option<i64>,
    pub daily_cost_budget_usd: Option<f64>,
    pub input_price_per_million_tokens: Option<f64>,
    pub output_price_per_million_tokens: Option<f64>,
    pub warning_percent: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiRequestPolicyDto {
    pub revision: i64,
    pub policy_hash: String,
    pub max_requests_per_minute: i64,
    pub max_concurrent_requests: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_token_budget: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub daily_cost_budget_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_price_per_million_tokens: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_price_per_million_tokens: Option<f64>,
    pub warning_percent: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequestPolicyLeaseGrant {
    pub reservation_id: String,
    pub owner_id: String,
    pub provider_request_id: String,
    pub lease_token: String,
    pub expires_at_ms: i64,
    pub policy_revision: i64,
    pub estimated_input_tokens: i64,
    pub estimated_output_tokens: i64,
    pub estimated_tokens: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_cost_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_price_per_million_tokens: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_price_per_million_tokens: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequestPolicyLeaseProof {
    pub reservation_id: String,
    pub owner_id: String,
    pub provider_request_id: String,
    pub lease_token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettleAiRequestInput {
    pub reservation_id: String,
    pub owner_id: String,
    pub lease_token: String,
    pub outcome: String,
    pub token_input: Option<i64>,
    pub token_output: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequestPolicySettlement {
    pub reservation_id: String,
    pub status: String,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiRequestBudgetSnapshotDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub policy: Option<AiRequestPolicyDto>,
    pub day: String,
    pub requests_last_minute: i64,
    pub active_requests: i64,
    pub token_used: i64,
    pub reserved_tokens: i64,
    pub cost_used_usd: f64,
    pub reserved_cost_usd: f64,
    pub usage_missing_count: i64,
    pub unpriced_request_count: i64,
    pub failed_request_count: i64,
    pub expired_request_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_budget: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_budget_usd: Option<f64>,
    pub warning_percent: i64,
    pub warning: bool,
}

#[derive(Debug)]
struct ReservationRow {
    owner_id: String,
    lease_token_hash: String,
    day_key: String,
    estimated_input_tokens: i64,
    estimated_output_tokens: i64,
    estimated_cost_units: Option<i64>,
    input_price_per_million_tokens: Option<f64>,
    output_price_per_million_tokens: Option<f64>,
    status: String,
    settlement_hash: Option<String>,
}

#[derive(Debug, Clone)]
struct PolicyRow {
    revision: i64,
    policy_hash: String,
    max_requests_per_minute: i64,
    max_concurrent_requests: i64,
    daily_token_budget: Option<i64>,
    daily_cost_budget_usd: Option<f64>,
    input_price_per_million_tokens: Option<f64>,
    output_price_per_million_tokens: Option<f64>,
    warning_percent: i64,
}

fn policy_error(code: &str, message: &str, retryable: bool) -> AppError {
    AppError::new(code, message, retryable)
}

fn invalid_input(message: &str) -> AppError {
    policy_error(codes::AI_REQUEST_POLICY_INPUT_INVALID, message, false)
}

fn current_clock() -> (i64, String) {
    let now = Local::now();
    (now.timestamp_millis(), now.format("%Y-%m-%d").to_string())
}

fn day_key_for_timestamp(timestamp_ms: i64) -> Result<String, AppError> {
    let value = Local
        .timestamp_millis_opt(timestamp_ms)
        .single()
        .ok_or_else(|| invalid_input("AI 请求治理时间戳无效。"))?;
    Ok(value.format("%Y-%m-%d").to_string())
}

fn valid_finite_non_negative(value: f64) -> bool {
    value.is_finite() && value >= 0.0
}

fn validate_optional_budget(value: Option<f64>, name: &str) -> Result<(), AppError> {
    if let Some(value) = value {
        if !value.is_finite() || value <= 0.0 || value > MAX_COST_BUDGET_USD {
            return Err(invalid_input(name));
        }
    }
    Ok(())
}

fn validate_policy_fields(
    max_requests_per_minute: i64,
    max_concurrent_requests: i64,
    daily_token_budget: Option<i64>,
    daily_cost_budget_usd: Option<f64>,
    input_price_per_million_tokens: Option<f64>,
    output_price_per_million_tokens: Option<f64>,
    warning_percent: i64,
) -> Result<(), AppError> {
    if !(1..=10_000).contains(&max_requests_per_minute) {
        return Err(invalid_input("AI 每分钟请求上限无效。"));
    }
    if !(1..=1_024).contains(&max_concurrent_requests) {
        return Err(invalid_input("AI 并发请求上限无效。"));
    }
    if let Some(budget) = daily_token_budget {
        if !(1..=MAX_TOKEN_VALUE).contains(&budget) {
            return Err(invalid_input("AI 每日 Token 预算无效。"));
        }
    }
    validate_optional_budget(daily_cost_budget_usd, "AI 每日成本预算无效。")?;
    match (
        input_price_per_million_tokens,
        output_price_per_million_tokens,
    ) {
        (Some(input_price), Some(output_price))
            if valid_finite_non_negative(input_price)
                && valid_finite_non_negative(output_price)
                && input_price <= MAX_PRICE_PER_MILLION_TOKENS
                && output_price <= MAX_PRICE_PER_MILLION_TOKENS => {}
        (None, None) => {}
        _ => return Err(invalid_input("AI 冻结单价必须成对提供。")),
    }
    if daily_cost_budget_usd.is_some() && input_price_per_million_tokens.is_none() {
        return Err(policy_error(
            codes::AI_BUDGET_PRICING_REQUIRED,
            "启用每日成本预算前必须配置输入与输出单价。",
            false,
        ));
    }
    if !(1..=100).contains(&warning_percent) {
        return Err(invalid_input("AI 预算提醒阈值无效。"));
    }
    Ok(())
}

fn validate_reservation_input(input: &ReserveAiRequestInput) -> Result<(), AppError> {
    let owner = input.owner_id.trim();
    if owner.is_empty() || owner.len() > 128 {
        return Err(invalid_input("AI 请求 owner 无效。"));
    }
    let provider_request_id = input.provider_request_id.trim();
    if provider_request_id.is_empty() || provider_request_id.len() > 128 {
        return Err(invalid_input("Provider request ID 无效。"));
    }
    validate_policy_fields(
        input.max_requests_per_minute,
        input.max_concurrent_requests,
        input.daily_token_budget,
        input.daily_cost_budget_usd,
        input.input_price_per_million_tokens,
        input.output_price_per_million_tokens,
        input.warning_percent,
    )?;
    if !(MIN_TTL_MS..=MAX_TTL_MS).contains(&input.ttl_ms) {
        return Err(invalid_input("AI 请求 reservation TTL 无效。"));
    }
    for value in [input.estimated_input_tokens, input.estimated_output_tokens] {
        if !(0..=MAX_TOKEN_VALUE).contains(&value) {
            return Err(invalid_input("AI 请求 Token 预估无效。"));
        }
    }
    if input.estimated_input_tokens == 0 && input.estimated_output_tokens == 0 {
        return Err(invalid_input("AI 请求 Token 预估不得同时为零。"));
    }
    Ok(())
}

fn checked_token_total(input: i64, output: i64) -> Result<i64, AppError> {
    input
        .checked_add(output)
        .ok_or_else(|| invalid_input("AI Token 数量溢出。"))
}

fn cost_units_to_usd(units: i64) -> f64 {
    units as f64 / COST_UNITS_PER_USD
}

fn budget_usd_to_units(value: Option<f64>) -> Result<Option<i64>, AppError> {
    value
        .map(|value| {
            let units = (value * COST_UNITS_PER_USD).floor();
            if !units.is_finite() || units < 1.0 || units > i64::MAX as f64 {
                return Err(invalid_input("AI 每日成本预算精度无效。"));
            }
            Ok(units as i64)
        })
        .transpose()
}

fn calculate_cost_units(
    input_price: Option<f64>,
    output_price: Option<f64>,
    token_input: i64,
    token_output: i64,
) -> Result<Option<i64>, AppError> {
    let (input_price, output_price) = match (input_price, output_price) {
        (Some(input_price), Some(output_price)) => (input_price, output_price),
        (None, None) => return Ok(None),
        _ => return Err(invalid_input("AI 冻结单价不完整。")),
    };
    let cost_units =
        input_price * token_input as f64 * 100.0 + output_price * token_output as f64 * 100.0;
    if !valid_finite_non_negative(cost_units) || cost_units > i64::MAX as f64 {
        return Err(invalid_input("AI 成本预估溢出。"));
    }
    Ok(Some(cost_units.ceil() as i64))
}

impl PolicyRow {
    fn dto(&self) -> AiRequestPolicyDto {
        AiRequestPolicyDto {
            revision: self.revision,
            policy_hash: self.policy_hash.clone(),
            max_requests_per_minute: self.max_requests_per_minute,
            max_concurrent_requests: self.max_concurrent_requests,
            daily_token_budget: self.daily_token_budget,
            daily_cost_budget_usd: self.daily_cost_budget_usd,
            input_price_per_million_tokens: self.input_price_per_million_tokens,
            output_price_per_million_tokens: self.output_price_per_million_tokens,
            warning_percent: self.warning_percent,
        }
    }
}

fn policy_hash(policy: &PolicyRow) -> Result<String, AppError> {
    let payload = serde_json::json!({
        "schemaVersion": 1,
        "maxRequestsPerMinute": policy.max_requests_per_minute,
        "maxConcurrentRequests": policy.max_concurrent_requests,
        "dailyTokenBudget": policy.daily_token_budget,
        "dailyCostBudgetUsd": policy.daily_cost_budget_usd,
        "inputPricePerMillionTokens": policy.input_price_per_million_tokens,
        "outputPricePerMillionTokens": policy.output_price_per_million_tokens,
        "warningPercent": policy.warning_percent,
    });
    let canonical =
        serde_json::to_string(&payload).map_err(|_| invalid_input("AI 请求策略序列化失败。"))?;
    Ok(large_text_repository::sha256(&canonical))
}

fn normalize_policy_cost_budget(mut policy: PolicyRow) -> Result<PolicyRow, AppError> {
    policy.daily_cost_budget_usd =
        budget_usd_to_units(policy.daily_cost_budget_usd)?.map(cost_units_to_usd);
    Ok(policy)
}

fn read_policy(transaction: &Transaction<'_>) -> Result<Option<PolicyRow>, AppError> {
    transaction
        .query_row(
            "SELECT revision,policy_hash,max_requests_per_minute,max_concurrent_requests,
                    daily_token_budget,daily_cost_budget_units,input_price_per_million_tokens,
                    output_price_per_million_tokens,warning_percent
             FROM ai_request_policy WHERE policy_id=1",
            [],
            |row| {
                Ok(PolicyRow {
                    revision: row.get(0)?,
                    policy_hash: row.get(1)?,
                    max_requests_per_minute: row.get(2)?,
                    max_concurrent_requests: row.get(3)?,
                    daily_token_budget: row.get(4)?,
                    daily_cost_budget_usd: row.get::<_, Option<i64>>(5)?.map(cost_units_to_usd),
                    input_price_per_million_tokens: row.get(6)?,
                    output_price_per_million_tokens: row.get(7)?,
                    warning_percent: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(AppError::database)
}

fn insert_policy(
    transaction: &Transaction<'_>,
    policy: PolicyRow,
    now_ms: i64,
) -> Result<PolicyRow, AppError> {
    let mut policy = normalize_policy_cost_budget(policy)?;
    policy.revision = 1;
    policy.policy_hash = policy_hash(&policy)?;
    let daily_cost_budget_units = budget_usd_to_units(policy.daily_cost_budget_usd)?;
    transaction
        .execute(
            "INSERT INTO ai_request_policy
                (policy_id,revision,policy_hash,max_requests_per_minute,max_concurrent_requests,
                 daily_token_budget,daily_cost_budget_units,input_price_per_million_tokens,
                 output_price_per_million_tokens,warning_percent,updated_at_ms)
             VALUES (1,?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                policy.revision,
                policy.policy_hash,
                policy.max_requests_per_minute,
                policy.max_concurrent_requests,
                policy.daily_token_budget,
                daily_cost_budget_units,
                policy.input_price_per_million_tokens,
                policy.output_price_per_million_tokens,
                policy.warning_percent,
                now_ms
            ],
        )
        .map_err(AppError::database)?;
    Ok(policy)
}

fn reservation_bootstrap_policy(input: &ReserveAiRequestInput) -> PolicyRow {
    PolicyRow {
        revision: 1,
        policy_hash: String::new(),
        max_requests_per_minute: input.max_requests_per_minute,
        max_concurrent_requests: input.max_concurrent_requests,
        daily_token_budget: input.daily_token_budget,
        daily_cost_budget_usd: input.daily_cost_budget_usd,
        input_price_per_million_tokens: input.input_price_per_million_tokens,
        output_price_per_million_tokens: input.output_price_per_million_tokens,
        warning_percent: input.warning_percent,
    }
}

fn configure_input_policy(input: &ConfigureAiRequestPolicyInput) -> PolicyRow {
    PolicyRow {
        revision: input.expected_revision.unwrap_or(1),
        policy_hash: String::new(),
        max_requests_per_minute: input.max_requests_per_minute,
        max_concurrent_requests: input.max_concurrent_requests,
        daily_token_budget: input.daily_token_budget,
        daily_cost_budget_usd: input.daily_cost_budget_usd,
        input_price_per_million_tokens: input.input_price_per_million_tokens,
        output_price_per_million_tokens: input.output_price_per_million_tokens,
        warning_percent: input.warning_percent,
    }
}

pub fn configure_policy(
    connection: &mut Connection,
    input: ConfigureAiRequestPolicyInput,
) -> Result<AiRequestPolicyDto, AppError> {
    validate_policy_fields(
        input.max_requests_per_minute,
        input.max_concurrent_requests,
        input.daily_token_budget,
        input.daily_cost_budget_usd,
        input.input_price_per_million_tokens,
        input.output_price_per_million_tokens,
        input.warning_percent,
    )?;
    let (now_ms, _) = current_clock();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let requested = normalize_policy_cost_budget(configure_input_policy(&input))?;
    let requested_hash = policy_hash(&requested)?;
    let policy = match read_policy(&transaction)? {
        None if input.expected_revision.is_some() => {
            return Err(policy_error(
                codes::AI_REQUEST_POLICY_CONFIG_CONFLICT,
                "AI 请求全局策略不存在，陈旧 revision 不能创建新策略。",
                true,
            ));
        }
        None => insert_policy(&transaction, requested, now_ms)?,
        Some(existing) if existing.policy_hash == requested_hash => existing,
        Some(existing) => {
            if input.expected_revision != Some(existing.revision) {
                return Err(policy_error(
                    codes::AI_REQUEST_POLICY_CONFIG_CONFLICT,
                    "AI 请求全局策略已被其他进程更新，请刷新后重试。",
                    true,
                )
                .with_details(serde_json::json!({
                    "expectedRevision": input.expected_revision,
                    "actualRevision": existing.revision,
                })));
            }
            let mut updated = requested;
            updated.revision = existing
                .revision
                .checked_add(1)
                .ok_or_else(|| invalid_input("AI 请求策略 revision 溢出。"))?;
            updated.policy_hash = requested_hash;
            let daily_cost_budget_units = budget_usd_to_units(updated.daily_cost_budget_usd)?;
            let changed = transaction
                .execute(
                    "UPDATE ai_request_policy
                     SET revision=?1,policy_hash=?2,max_requests_per_minute=?3,
                         max_concurrent_requests=?4,daily_token_budget=?5,
                         daily_cost_budget_units=?6,input_price_per_million_tokens=?7,
                         output_price_per_million_tokens=?8,warning_percent=?9,updated_at_ms=?10
                     WHERE policy_id=1 AND revision=?11",
                    params![
                        updated.revision,
                        updated.policy_hash,
                        updated.max_requests_per_minute,
                        updated.max_concurrent_requests,
                        updated.daily_token_budget,
                        daily_cost_budget_units,
                        updated.input_price_per_million_tokens,
                        updated.output_price_per_million_tokens,
                        updated.warning_percent,
                        now_ms,
                        existing.revision,
                    ],
                )
                .map_err(AppError::database)?;
            if changed != 1 {
                return Err(policy_error(
                    codes::AI_REQUEST_POLICY_CONFIG_CONFLICT,
                    "AI 请求全局策略 CAS 更新失败。",
                    true,
                ));
            }
            updated
        }
    };
    transaction.commit().map_err(AppError::database)?;
    Ok(policy.dto())
}

fn ensure_day(transaction: &Transaction<'_>, day_key: &str, now_ms: i64) -> Result<(), AppError> {
    transaction
        .execute(
            "INSERT INTO ai_request_daily_usage
                (day_key,token_input,token_output,cost_units,usage_missing_count,
                 unpriced_request_count,failed_request_count,expired_request_count,
                 settled_request_count,updated_at_ms)
             VALUES (?1,0,0,0,0,0,0,0,0,?2)
             ON CONFLICT(day_key) DO NOTHING",
            params![day_key, now_ms],
        )
        .map_err(AppError::database)?;
    Ok(())
}

fn apply_usage(
    transaction: &Transaction<'_>,
    day_key: &str,
    token_input: i64,
    token_output: i64,
    cost_units: Option<i64>,
    usage_missing: bool,
    failed: bool,
    expired: bool,
    now_ms: i64,
) -> Result<(), AppError> {
    ensure_day(transaction, day_key, now_ms)?;
    transaction
        .execute(
            "UPDATE ai_request_daily_usage
             SET token_input=token_input+?2,
                 token_output=token_output+?3,
                 cost_units=cost_units+?4,
                 usage_missing_count=usage_missing_count+?5,
                 unpriced_request_count=unpriced_request_count+?6,
                 failed_request_count=failed_request_count+?7,
                 expired_request_count=expired_request_count+?8,
                 settled_request_count=settled_request_count+1,
                 updated_at_ms=?9
             WHERE day_key=?1",
            params![
                day_key,
                token_input,
                token_output,
                cost_units.unwrap_or(0),
                i64::from(usage_missing),
                i64::from(cost_units.is_none()),
                i64::from(failed),
                i64::from(expired),
                now_ms
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

fn expiration_hash(reservation_id: &str) -> String {
    large_text_repository::sha256(&format!("ttl-expired|{reservation_id}"))
}

fn expire_stale_reservations(
    transaction: &Transaction<'_>,
    now_ms: i64,
) -> Result<usize, AppError> {
    let expired = {
        let mut statement = transaction
            .prepare(
                "SELECT reservation_id,day_key,estimated_input_tokens,
                        estimated_output_tokens,estimated_cost_units
                 FROM ai_request_reservations
                 WHERE status='active' AND expires_at_ms<=?1
                 ORDER BY expires_at_ms ASC,reservation_id ASC",
            )
            .map_err(AppError::database)?;
        let rows = statement
            .query_map(params![now_ms], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            })
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        rows
    };

    for (reservation_id, day_key, token_input, token_output, cost_units) in &expired {
        apply_usage(
            transaction,
            day_key,
            *token_input,
            *token_output,
            *cost_units,
            true,
            false,
            true,
            now_ms,
        )?;
        let changed = transaction
            .execute(
                "UPDATE ai_request_reservations
                 SET status='expired',settlement_hash=?2,
                     accounted_input_tokens=estimated_input_tokens,
                     accounted_output_tokens=estimated_output_tokens,
                     accounted_cost_units=estimated_cost_units,
                     accounted_cost_status=CASE WHEN estimated_cost_units IS NULL
                                                THEN 'unpriced' ELSE 'complete' END,
                     settled_at_ms=?3
                 WHERE reservation_id=?1 AND status='active'",
                params![reservation_id, expiration_hash(reservation_id), now_ms],
            )
            .map_err(AppError::database)?;
        if changed != 1 {
            return Err(policy_error(
                codes::AI_REQUEST_POLICY_LEASE_CONFLICT,
                "AI 请求 reservation 过期回收发生并发冲突。",
                true,
            ));
        }
    }
    Ok(expired.len())
}

pub fn reserve_request(
    connection: &mut Connection,
    input: ReserveAiRequestInput,
) -> Result<AiRequestPolicyLeaseGrant, AppError> {
    let (now_ms, day_key) = current_clock();
    reserve_request_at(connection, input, now_ms, &day_key)
}

fn reserve_request_at(
    connection: &mut Connection,
    input: ReserveAiRequestInput,
    now_ms: i64,
    day_key: &str,
) -> Result<AiRequestPolicyLeaseGrant, AppError> {
    validate_reservation_input(&input)?;
    if day_key_for_timestamp(now_ms)? != day_key {
        return Err(invalid_input("AI 请求治理日期与时间戳不一致。"));
    }
    let estimated_tokens =
        checked_token_total(input.estimated_input_tokens, input.estimated_output_tokens)?;
    let expires_at_ms = now_ms
        .checked_add(input.ttl_ms)
        .ok_or_else(|| invalid_input("AI 请求 reservation 到期时间溢出。"))?;

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let policy = match read_policy(&transaction)? {
        Some(policy) => policy,
        None => insert_policy(&transaction, reservation_bootstrap_policy(&input), now_ms)?,
    };
    let estimated_cost_units = calculate_cost_units(
        policy.input_price_per_million_tokens,
        policy.output_price_per_million_tokens,
        input.estimated_input_tokens,
        input.estimated_output_tokens,
    )?;
    ensure_day(&transaction, day_key, now_ms)?;
    expire_stale_reservations(&transaction, now_ms)?;

    let requests_last_minute: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM ai_request_reservations WHERE started_at_ms>?1",
            params![now_ms - MINUTE_MS],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if requests_last_minute >= policy.max_requests_per_minute {
        return Err(policy_error(
            codes::AI_RATE_LIMIT_EXCEEDED,
            "最近一分钟 AI 请求数已达到上限。",
            true,
        ));
    }

    let active_requests: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM ai_request_reservations WHERE status='active'",
            [],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if active_requests >= policy.max_concurrent_requests {
        return Err(policy_error(
            codes::AI_CONCURRENCY_LIMIT_EXCEEDED,
            "全局 AI 并发请求数已达到上限。",
            true,
        ));
    }

    let (token_input, token_output, cost_used_units): (i64, i64, i64) = transaction
        .query_row(
            "SELECT token_input,token_output,cost_units
             FROM ai_request_daily_usage WHERE day_key=?1",
            params![day_key],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(AppError::database)?;
    let (reserved_tokens, reserved_cost_units): (i64, i64) = transaction
        .query_row(
            "SELECT COALESCE(SUM(estimated_input_tokens+estimated_output_tokens),0),
                    COALESCE(SUM(estimated_cost_units),0)
             FROM ai_request_reservations WHERE day_key=?1 AND status='active'",
            params![day_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(AppError::database)?;
    let used_tokens = checked_token_total(token_input, token_output)?;
    let projected_tokens = used_tokens
        .checked_add(reserved_tokens)
        .and_then(|value| value.checked_add(estimated_tokens))
        .ok_or_else(|| invalid_input("AI 每日 Token 计数溢出。"))?;
    if policy
        .daily_token_budget
        .map(|budget| projected_tokens > budget)
        .unwrap_or(false)
    {
        return Err(policy_error(
            codes::AI_DAILY_TOKEN_BUDGET_EXCEEDED,
            "本次请求的保守 Token 预留会超过今日硬预算。",
            false,
        ));
    }
    let projected_cost_units = cost_used_units
        .checked_add(reserved_cost_units)
        .and_then(|value| value.checked_add(estimated_cost_units.unwrap_or(0)))
        .ok_or_else(|| invalid_input("AI 每日成本计数溢出。"))?;
    if budget_usd_to_units(policy.daily_cost_budget_usd)?
        .map(|budget| projected_cost_units > budget)
        .unwrap_or(false)
    {
        return Err(policy_error(
            codes::AI_DAILY_COST_BUDGET_EXCEEDED,
            "本次请求的保守成本预留会超过今日硬预算。",
            false,
        ));
    }

    let reservation_id = Uuid::new_v4().to_string();
    let lease_token = Uuid::new_v4().to_string();
    let lease_token_hash = large_text_repository::sha256(&lease_token);
    transaction
        .execute(
            "INSERT INTO ai_request_reservations
                (reservation_id,owner_id,provider_request_id,lease_token_hash,policy_revision,policy_hash,
                 day_key,started_at_ms,expires_at_ms,
                 estimated_input_tokens,estimated_output_tokens,estimated_cost_units,
                 input_price_per_million_tokens,output_price_per_million_tokens,status)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'active')",
            params![
                reservation_id,
                input.owner_id.trim(),
                input.provider_request_id.trim(),
                lease_token_hash,
                policy.revision,
                policy.policy_hash,
                day_key,
                now_ms,
                expires_at_ms,
                input.estimated_input_tokens,
                input.estimated_output_tokens,
                estimated_cost_units,
                policy.input_price_per_million_tokens,
                policy.output_price_per_million_tokens,
            ],
        )
        .map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)?;

    Ok(AiRequestPolicyLeaseGrant {
        reservation_id,
        owner_id: input.owner_id.trim().to_string(),
        provider_request_id: input.provider_request_id.trim().to_string(),
        lease_token,
        expires_at_ms,
        policy_revision: policy.revision,
        estimated_input_tokens: input.estimated_input_tokens,
        estimated_output_tokens: input.estimated_output_tokens,
        estimated_tokens,
        estimated_cost_usd: estimated_cost_units.map(cost_units_to_usd),
        input_price_per_million_tokens: policy.input_price_per_million_tokens,
        output_price_per_million_tokens: policy.output_price_per_million_tokens,
    })
}

pub fn verify_provider_dispatch(
    connection: &mut Connection,
    proof: &AiRequestPolicyLeaseProof,
) -> Result<(), AppError> {
    let (now_ms, _) = current_clock();
    verify_provider_dispatch_at(connection, proof, now_ms)
}

fn verify_provider_dispatch_at(
    connection: &mut Connection,
    proof: &AiRequestPolicyLeaseProof,
    now_ms: i64,
) -> Result<(), AppError> {
    for (value, name) in [
        (proof.reservation_id.trim(), "AI reservation ID 无效。"),
        (proof.owner_id.trim(), "AI reservation owner 无效。"),
        (
            proof.provider_request_id.trim(),
            "Provider request ID 无效。",
        ),
        (proof.lease_token.trim(), "AI reservation token 无效。"),
    ] {
        if value.is_empty() || value.len() > 128 {
            return Err(invalid_input(name));
        }
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    expire_stale_reservations(&transaction, now_ms)?;
    let row = transaction
        .query_row(
            "SELECT owner_id,provider_request_id,lease_token_hash,status,dispatched_at_ms
             FROM ai_request_reservations WHERE reservation_id=?1",
            params![proof.reservation_id.trim()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| {
            policy_error(
                codes::AI_REQUEST_POLICY_LEASE_NOT_FOUND,
                "AI 请求 reservation 不存在。",
                false,
            )
        })?;
    if row.0 != proof.owner_id.trim()
        || row.1 != proof.provider_request_id.trim()
        || row.2 != large_text_repository::sha256(proof.lease_token.trim())
        || row.3 != "active"
        || row.4.is_some()
    {
        return Err(policy_error(
            codes::AI_REQUEST_POLICY_LEASE_CONFLICT,
            "AI 请求 reservation 无效、已过期或已派发。",
            false,
        ));
    }
    let changed = transaction
        .execute(
            "UPDATE ai_request_reservations SET dispatched_at_ms=?2
             WHERE reservation_id=?1 AND status='active' AND dispatched_at_ms IS NULL",
            params![proof.reservation_id.trim(), now_ms],
        )
        .map_err(AppError::database)?;
    if changed != 1 {
        return Err(policy_error(
            codes::AI_REQUEST_POLICY_LEASE_CONFLICT,
            "AI 请求 reservation 派发发生并发冲突。",
            true,
        ));
    }
    transaction.commit().map_err(AppError::database)
}

fn validate_settlement_input(input: &SettleAiRequestInput) -> Result<String, AppError> {
    for (value, name) in [
        (input.reservation_id.trim(), "AI reservation ID 无效。"),
        (input.owner_id.trim(), "AI reservation owner 无效。"),
        (input.lease_token.trim(), "AI reservation token 无效。"),
    ] {
        if value.is_empty() || value.len() > 128 {
            return Err(invalid_input(name));
        }
    }
    match input.outcome.as_str() {
        "succeeded" => match (input.token_input, input.token_output) {
            (Some(token_input), Some(token_output))
                if (0..=MAX_TOKEN_VALUE).contains(&token_input)
                    && (0..=MAX_TOKEN_VALUE).contains(&token_output) => {}
            (None, None) => {}
            _ => return Err(invalid_input("Provider Token 用量必须成对提供。")),
        },
        "failed" if input.token_input.is_none() && input.token_output.is_none() => {}
        "failed" => return Err(invalid_input("失败结算不得携带未验证的 Token 用量。")),
        _ => return Err(invalid_input("AI reservation 结算结果无效。")),
    }
    Ok(large_text_repository::sha256(&format!(
        "{}|{}|{}",
        input.outcome,
        input
            .token_input
            .map(|value| value.to_string())
            .unwrap_or_else(|| "none".to_string()),
        input
            .token_output
            .map(|value| value.to_string())
            .unwrap_or_else(|| "none".to_string())
    )))
}

fn read_reservation(
    transaction: &Transaction<'_>,
    reservation_id: &str,
) -> Result<Option<ReservationRow>, AppError> {
    transaction
        .query_row(
            "SELECT owner_id,lease_token_hash,day_key,estimated_input_tokens,
                    estimated_output_tokens,estimated_cost_units,
                    input_price_per_million_tokens,output_price_per_million_tokens,
                    status,settlement_hash
             FROM ai_request_reservations WHERE reservation_id=?1",
            params![reservation_id],
            |row| {
                Ok(ReservationRow {
                    owner_id: row.get(0)?,
                    lease_token_hash: row.get(1)?,
                    day_key: row.get(2)?,
                    estimated_input_tokens: row.get(3)?,
                    estimated_output_tokens: row.get(4)?,
                    estimated_cost_units: row.get(5)?,
                    input_price_per_million_tokens: row.get(6)?,
                    output_price_per_million_tokens: row.get(7)?,
                    status: row.get(8)?,
                    settlement_hash: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(AppError::database)
}

pub fn settle_request(
    connection: &mut Connection,
    input: SettleAiRequestInput,
) -> Result<AiRequestPolicySettlement, AppError> {
    let (now_ms, _) = current_clock();
    settle_request_at(connection, input, now_ms)
}

fn settle_request_at(
    connection: &mut Connection,
    input: SettleAiRequestInput,
    now_ms: i64,
) -> Result<AiRequestPolicySettlement, AppError> {
    let settlement_hash = validate_settlement_input(&input)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    expire_stale_reservations(&transaction, now_ms)?;
    let reservation =
        read_reservation(&transaction, input.reservation_id.trim())?.ok_or_else(|| {
            policy_error(
                codes::AI_REQUEST_POLICY_LEASE_NOT_FOUND,
                "AI 请求 reservation 不存在。",
                false,
            )
        })?;
    if reservation.owner_id != input.owner_id.trim()
        || reservation.lease_token_hash != large_text_repository::sha256(input.lease_token.trim())
    {
        return Err(policy_error(
            codes::AI_REQUEST_POLICY_LEASE_CONFLICT,
            "AI 请求 reservation 所有权校验失败。",
            false,
        ));
    }
    if reservation.status != "active" {
        if reservation.status != "expired"
            && reservation.settlement_hash.as_deref() != Some(settlement_hash.as_str())
        {
            return Err(policy_error(
                codes::AI_REQUEST_POLICY_LEASE_CONFLICT,
                "AI 请求 reservation 已使用不同结算载荷完成。",
                false,
            ));
        }
        transaction.commit().map_err(AppError::database)?;
        return Ok(AiRequestPolicySettlement {
            reservation_id: input.reservation_id,
            status: reservation.status,
            replayed: true,
        });
    }

    let (status, token_input, token_output, cost_units, usage_missing, failed) = if input.outcome
        == "failed"
    {
        (
            "failed",
            reservation.estimated_input_tokens,
            reservation.estimated_output_tokens,
            reservation.estimated_cost_units,
            true,
            true,
        )
    } else if let (Some(token_input), Some(token_output)) = (input.token_input, input.token_output)
    {
        let cost = calculate_cost_units(
            reservation.input_price_per_million_tokens,
            reservation.output_price_per_million_tokens,
            token_input,
            token_output,
        )?;
        ("settled", token_input, token_output, cost, false, false)
    } else {
        (
            "settled",
            reservation.estimated_input_tokens,
            reservation.estimated_output_tokens,
            reservation.estimated_cost_units,
            true,
            false,
        )
    };
    apply_usage(
        &transaction,
        &reservation.day_key,
        token_input,
        token_output,
        cost_units,
        usage_missing,
        failed,
        false,
        now_ms,
    )?;
    let changed = transaction
        .execute(
            "UPDATE ai_request_reservations
             SET status=?2,settlement_hash=?3,accounted_input_tokens=?4,
                 accounted_output_tokens=?5,accounted_cost_units=?6,
                 accounted_cost_status=?7,settled_at_ms=?8
             WHERE reservation_id=?1 AND status='active'",
            params![
                input.reservation_id.trim(),
                status,
                settlement_hash,
                token_input,
                token_output,
                cost_units,
                if cost_units.is_some() {
                    "complete"
                } else {
                    "unpriced"
                },
                now_ms
            ],
        )
        .map_err(AppError::database)?;
    if changed != 1 {
        return Err(policy_error(
            codes::AI_REQUEST_POLICY_LEASE_CONFLICT,
            "AI 请求 reservation 结算发生并发冲突。",
            true,
        ));
    }
    transaction.commit().map_err(AppError::database)?;
    Ok(AiRequestPolicySettlement {
        reservation_id: input.reservation_id,
        status: status.to_string(),
        replayed: false,
    })
}

pub fn get_snapshot(connection: &mut Connection) -> Result<AiRequestBudgetSnapshotDto, AppError> {
    let (now_ms, day_key) = current_clock();
    get_snapshot_at(connection, now_ms, &day_key)
}

fn get_snapshot_at(
    connection: &mut Connection,
    now_ms: i64,
    day_key: &str,
) -> Result<AiRequestBudgetSnapshotDto, AppError> {
    if day_key_for_timestamp(now_ms)? != day_key {
        return Err(invalid_input("AI 请求治理日期与时间戳不一致。"));
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let policy = read_policy(&transaction)?;
    ensure_day(&transaction, day_key, now_ms)?;
    expire_stale_reservations(&transaction, now_ms)?;
    let requests_last_minute = transaction
        .query_row(
            "SELECT COUNT(*) FROM ai_request_reservations WHERE started_at_ms>?1",
            params![now_ms - MINUTE_MS],
            |row| row.get::<_, i64>(0),
        )
        .map_err(AppError::database)?;
    let active_requests = transaction
        .query_row(
            "SELECT COUNT(*) FROM ai_request_reservations WHERE status='active'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(AppError::database)?;
    let (
        token_input,
        token_output,
        cost_used_units,
        usage_missing_count,
        unpriced_request_count,
        failed_request_count,
        expired_request_count,
    ) = transaction
        .query_row(
            "SELECT token_input,token_output,cost_units,usage_missing_count,
                    unpriced_request_count,failed_request_count,expired_request_count
             FROM ai_request_daily_usage WHERE day_key=?1",
            params![day_key],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            },
        )
        .map_err(AppError::database)?;
    let (reserved_tokens, reserved_cost_units) = transaction
        .query_row(
            "SELECT COALESCE(SUM(estimated_input_tokens+estimated_output_tokens),0),
                    COALESCE(SUM(estimated_cost_units),0)
             FROM ai_request_reservations WHERE day_key=?1 AND status='active'",
            params![day_key],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)?;

    let token_used = checked_token_total(token_input, token_output)?;
    let token_ratio = policy
        .as_ref()
        .and_then(|policy| policy.daily_token_budget)
        .map(|budget| (token_used + reserved_tokens) as f64 / budget as f64)
        .unwrap_or(0.0);
    let cost_ratio = budget_usd_to_units(
        policy
            .as_ref()
            .and_then(|policy| policy.daily_cost_budget_usd),
    )?
    .map(|budget| (cost_used_units + reserved_cost_units) as f64 / budget as f64)
    .unwrap_or(0.0);
    let warning_percent = policy
        .as_ref()
        .map(|policy| policy.warning_percent)
        .unwrap_or(80);
    Ok(AiRequestBudgetSnapshotDto {
        policy: policy.as_ref().map(PolicyRow::dto),
        day: day_key.to_string(),
        requests_last_minute,
        active_requests,
        token_used,
        reserved_tokens,
        cost_used_usd: cost_units_to_usd(cost_used_units),
        reserved_cost_usd: cost_units_to_usd(reserved_cost_units),
        usage_missing_count,
        unpriced_request_count,
        failed_request_count,
        expired_request_count,
        token_budget: policy.as_ref().and_then(|policy| policy.daily_token_budget),
        cost_budget_usd: policy
            .as_ref()
            .and_then(|policy| policy.daily_cost_budget_usd),
        warning_percent,
        warning: token_ratio.max(cost_ratio) * 100.0 >= warning_percent as f64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::thread;
    use std::time::{Duration, Instant};

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().expect("open policy database");
        connection
            .execute_batch("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
            .expect("configure policy database");
        crate::db::create_tables(&mut connection).expect("create policy schema");
        connection
    }

    fn reserve_input(owner_id: &str) -> ReserveAiRequestInput {
        ReserveAiRequestInput {
            owner_id: owner_id.to_string(),
            provider_request_id: format!("provider-{owner_id}"),
            max_requests_per_minute: 12,
            max_concurrent_requests: 2,
            daily_token_budget: Some(10_000),
            daily_cost_budget_usd: Some(10.0),
            estimated_input_tokens: 100,
            estimated_output_tokens: 200,
            input_price_per_million_tokens: Some(1.0),
            output_price_per_million_tokens: Some(2.0),
            warning_percent: 80,
            ttl_ms: 120_000,
        }
    }

    fn day(now_ms: i64) -> String {
        day_key_for_timestamp(now_ms).expect("valid test day")
    }

    #[test]
    fn reserves_and_idempotently_settles_actual_usage_once() {
        let mut connection = database();
        let now = 1_785_361_200_000;
        let grant = reserve_request_at(&mut connection, reserve_input("owner-a"), now, &day(now))
            .expect("reserve request");
        let settlement = SettleAiRequestInput {
            reservation_id: grant.reservation_id.clone(),
            owner_id: grant.owner_id.clone(),
            lease_token: grant.lease_token.clone(),
            outcome: "succeeded".to_string(),
            token_input: Some(40),
            token_output: Some(60),
        };
        assert!(
            !settle_request_at(&mut connection, settlement.clone(), now + 1_000)
                .expect("first settlement")
                .replayed
        );
        assert!(
            settle_request_at(&mut connection, settlement, now + 2_000)
                .expect("idempotent settlement")
                .replayed
        );
        let snapshot = get_snapshot_at(&mut connection, now + 2_000, &day(now)).expect("snapshot");
        assert_eq!(snapshot.token_used, 100);
        assert_eq!(snapshot.active_requests, 0);
        assert_eq!(snapshot.usage_missing_count, 0);
        assert!((snapshot.cost_used_usd - 0.00016).abs() < 1e-12);
    }

    #[test]
    fn actual_usage_above_reservation_is_fully_accounted_and_blocks_the_next_request() {
        let mut connection = database();
        let now = 1_785_361_200_000;
        let mut first = reserve_input("actual-overage-owner");
        first.daily_token_budget = Some(1_000);
        let grant = reserve_request_at(&mut connection, first, now, &day(now))
            .expect("reserve bounded request");
        settle_request_at(
            &mut connection,
            SettleAiRequestInput {
                reservation_id: grant.reservation_id,
                owner_id: grant.owner_id,
                lease_token: grant.lease_token,
                outcome: "succeeded".to_string(),
                token_input: Some(400),
                token_output: Some(500),
            },
            now + 1_000,
        )
        .expect("account actual overage");
        let snapshot =
            get_snapshot_at(&mut connection, now + 1_000, &day(now)).expect("overage snapshot");
        assert_eq!(snapshot.token_used, 900);

        let error = reserve_request_at(
            &mut connection,
            reserve_input("blocked-after-overage"),
            now + 2_000,
            &day(now),
        )
        .expect_err("next reservation must observe actual usage");
        assert_eq!(error.code, codes::AI_DAILY_TOKEN_BUDGET_EXCEEDED);
    }

    #[test]
    fn conflicting_settlement_payload_and_wrong_owner_fail_closed() {
        let mut connection = database();
        let now = 1_785_361_200_000;
        let grant = reserve_request_at(&mut connection, reserve_input("owner-a"), now, &day(now))
            .expect("reserve request");
        let wrong_owner = settle_request_at(
            &mut connection,
            SettleAiRequestInput {
                reservation_id: grant.reservation_id.clone(),
                owner_id: "owner-b".to_string(),
                lease_token: grant.lease_token.clone(),
                outcome: "failed".to_string(),
                token_input: None,
                token_output: None,
            },
            now + 1_000,
        )
        .expect_err("wrong owner must fail");
        assert_eq!(wrong_owner.code, codes::AI_REQUEST_POLICY_LEASE_CONFLICT);

        settle_request_at(
            &mut connection,
            SettleAiRequestInput {
                reservation_id: grant.reservation_id.clone(),
                owner_id: grant.owner_id.clone(),
                lease_token: grant.lease_token.clone(),
                outcome: "succeeded".to_string(),
                token_input: Some(10),
                token_output: Some(20),
            },
            now + 2_000,
        )
        .expect("settle request");
        let conflict = settle_request_at(
            &mut connection,
            SettleAiRequestInput {
                reservation_id: grant.reservation_id,
                owner_id: grant.owner_id,
                lease_token: grant.lease_token,
                outcome: "succeeded".to_string(),
                token_input: Some(11),
                token_output: Some(20),
            },
            now + 3_000,
        )
        .expect_err("different replay must fail");
        assert_eq!(conflict.code, codes::AI_REQUEST_POLICY_LEASE_CONFLICT);
    }

    #[test]
    fn provider_dispatch_requires_matching_owner_token_request_and_is_single_use() {
        let mut connection = database();
        let now = 1_785_361_200_000;
        let grant = reserve_request_at(
            &mut connection,
            reserve_input("dispatch-owner"),
            now,
            &day(now),
        )
        .expect("reserve dispatch request");
        let proof = AiRequestPolicyLeaseProof {
            reservation_id: grant.reservation_id,
            owner_id: grant.owner_id,
            provider_request_id: grant.provider_request_id,
            lease_token: grant.lease_token,
        };
        verify_provider_dispatch_at(&mut connection, &proof, now + 1_000)
            .expect("first dispatch proof");
        let replay = verify_provider_dispatch_at(&mut connection, &proof, now + 2_000)
            .expect_err("dispatch proof must be single use");
        assert_eq!(replay.code, codes::AI_REQUEST_POLICY_LEASE_CONFLICT);
    }

    #[test]
    fn ttl_reclaims_owner_and_conservatively_accounts_reservation() {
        let mut connection = database();
        let now = 1_785_361_200_000;
        let mut first = reserve_input("crashed-owner");
        first.max_concurrent_requests = 1;
        first.ttl_ms = MIN_TTL_MS;
        reserve_request_at(&mut connection, first, now, &day(now)).expect("first reservation");

        let mut second = reserve_input("replacement-owner");
        second.max_concurrent_requests = 1;
        let replacement =
            reserve_request_at(&mut connection, second, now + MIN_TTL_MS + 1, &day(now))
                .expect("replacement reservation");
        let snapshot =
            get_snapshot_at(&mut connection, now + MIN_TTL_MS + 1, &day(now)).expect("snapshot");
        assert_eq!(snapshot.active_requests, 1);
        assert_eq!(snapshot.token_used, 300);
        assert_eq!(snapshot.reserved_tokens, replacement.estimated_tokens);
        assert_eq!(snapshot.usage_missing_count, 1);
    }

    #[test]
    fn global_rolling_rate_and_cost_budget_fail_before_provider_dispatch() {
        let now = 1_785_361_200_000;
        let mut rate_connection = database();
        let mut first = reserve_input("rate-owner-a");
        first.max_requests_per_minute = 1;
        let grant = reserve_request_at(&mut rate_connection, first, now, &day(now))
            .expect("first rate reservation");
        settle_request_at(
            &mut rate_connection,
            SettleAiRequestInput {
                reservation_id: grant.reservation_id,
                owner_id: grant.owner_id,
                lease_token: grant.lease_token,
                outcome: "failed".to_string(),
                token_input: None,
                token_output: None,
            },
            now + 1,
        )
        .expect("settle first rate reservation");
        let rate_error = reserve_request_at(
            &mut rate_connection,
            reserve_input("rate-owner-b"),
            now + 2,
            &day(now),
        )
        .expect_err("rolling rate must reject second request");
        assert_eq!(rate_error.code, codes::AI_RATE_LIMIT_EXCEEDED);

        let mut cost_connection = database();
        let mut cost = reserve_input("cost-owner");
        cost.daily_cost_budget_usd = Some(0.00049);
        let cost_error = reserve_request_at(&mut cost_connection, cost, now, &day(now))
            .expect_err("cost reservation must reject over-budget request");
        assert_eq!(cost_error.code, codes::AI_DAILY_COST_BUDGET_EXCEEDED);
    }

    #[test]
    fn policy_updates_use_revision_cas_and_same_payload_replays() {
        let mut connection = database();
        let first = configure_policy(
            &mut connection,
            ConfigureAiRequestPolicyInput {
                expected_revision: None,
                max_requests_per_minute: 12,
                max_concurrent_requests: 2,
                daily_token_budget: Some(10_000),
                daily_cost_budget_usd: Some(10.0),
                input_price_per_million_tokens: Some(1.0),
                output_price_per_million_tokens: Some(2.0),
                warning_percent: 80,
            },
        )
        .expect("initialize global policy");
        assert_eq!(first.revision, 1);

        let changed = ConfigureAiRequestPolicyInput {
            expected_revision: Some(first.revision),
            max_requests_per_minute: 20,
            max_concurrent_requests: 3,
            daily_token_budget: Some(20_000),
            daily_cost_budget_usd: Some(20.0),
            input_price_per_million_tokens: Some(1.0),
            output_price_per_million_tokens: Some(2.0),
            warning_percent: 75,
        };
        let second = configure_policy(&mut connection, changed.clone()).expect("CAS policy update");
        assert_eq!(second.revision, 2);
        assert_eq!(
            configure_policy(&mut connection, changed)
                .expect("same policy replay")
                .revision,
            2
        );
        let conflict = configure_policy(
            &mut connection,
            ConfigureAiRequestPolicyInput {
                expected_revision: Some(1),
                max_requests_per_minute: 21,
                max_concurrent_requests: 3,
                daily_token_budget: Some(20_000),
                daily_cost_budget_usd: Some(20.0),
                input_price_per_million_tokens: Some(1.0),
                output_price_per_million_tokens: Some(2.0),
                warning_percent: 75,
            },
        )
        .expect_err("stale policy revision must fail");
        assert_eq!(conflict.code, codes::AI_REQUEST_POLICY_CONFIG_CONFLICT);
    }

    #[test]
    fn snapshot_does_not_create_policy_and_stale_revision_cannot_initialize_one() {
        let mut connection = database();
        let now = 1_785_361_200_000;
        let snapshot = get_snapshot_at(&mut connection, now, &day(now)).expect("empty snapshot");
        assert!(snapshot.policy.is_none());
        let policy_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM ai_request_policy", [], |row| {
                row.get(0)
            })
            .expect("count policies");
        assert_eq!(policy_count, 0);

        let error = configure_policy(
            &mut connection,
            ConfigureAiRequestPolicyInput {
                expected_revision: Some(9),
                max_requests_per_minute: 12,
                max_concurrent_requests: 2,
                daily_token_budget: Some(10_000),
                daily_cost_budget_usd: Some(10.0),
                input_price_per_million_tokens: Some(1.0),
                output_price_per_million_tokens: Some(2.0),
                warning_percent: 80,
            },
        )
        .expect_err("stale revision must not initialize an absent policy");
        assert_eq!(error.code, codes::AI_REQUEST_POLICY_CONFIG_CONFLICT);
        let policy_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM ai_request_policy", [], |row| {
                row.get(0)
            })
            .expect("recount policies");
        assert_eq!(policy_count, 0);
    }

    #[test]
    fn settlement_after_local_midnight_stays_on_the_reservation_day() {
        let mut connection = database();
        let started = Local
            .with_ymd_and_hms(2026, 7, 28, 23, 59, 0)
            .single()
            .expect("unambiguous local start")
            .timestamp_millis();
        let settled = Local
            .with_ymd_and_hms(2026, 7, 29, 0, 1, 0)
            .single()
            .expect("unambiguous local settlement")
            .timestamp_millis();
        let reservation_day = day(started);
        let current_day = day(settled);
        assert_ne!(reservation_day, current_day);

        let mut input = reserve_input("midnight-owner");
        input.ttl_ms = 5 * 60_000;
        let grant = reserve_request_at(&mut connection, input, started, &reservation_day)
            .expect("reserve before midnight");
        settle_request_at(
            &mut connection,
            SettleAiRequestInput {
                reservation_id: grant.reservation_id,
                owner_id: grant.owner_id,
                lease_token: grant.lease_token,
                outcome: "succeeded".to_string(),
                token_input: Some(40),
                token_output: Some(60),
            },
            settled,
        )
        .expect("settle after midnight");

        let prior_tokens: i64 = connection
            .query_row(
                "SELECT token_input+token_output FROM ai_request_daily_usage WHERE day_key=?1",
                params![reservation_day],
                |row| row.get(0),
            )
            .expect("read reservation-day usage");
        assert_eq!(prior_tokens, 100);
        let current =
            get_snapshot_at(&mut connection, settled, &current_day).expect("current-day snapshot");
        assert_eq!(current.token_used, 0);
    }

    #[test]
    fn failed_and_unpriced_requests_remain_explicit_conservative_facts() {
        let mut priced = database();
        let now = 1_785_361_200_000;
        let grant = reserve_request_at(&mut priced, reserve_input("failed-owner"), now, &day(now))
            .expect("reserve failed provider request");
        settle_request_at(
            &mut priced,
            SettleAiRequestInput {
                reservation_id: grant.reservation_id,
                owner_id: grant.owner_id,
                lease_token: grant.lease_token,
                outcome: "failed".to_string(),
                token_input: None,
                token_output: None,
            },
            now + 1_000,
        )
        .expect("conservative failed settlement");
        let failed = get_snapshot_at(&mut priced, now + 1_000, &day(now)).expect("failed snapshot");
        assert_eq!(failed.token_used, 300);
        assert_eq!(failed.failed_request_count, 1);
        assert_eq!(failed.usage_missing_count, 1);

        let mut unpriced = database();
        let mut input = reserve_input("unpriced-owner");
        input.daily_cost_budget_usd = None;
        input.input_price_per_million_tokens = None;
        input.output_price_per_million_tokens = None;
        let grant = reserve_request_at(&mut unpriced, input, now, &day(now))
            .expect("reserve unpriced request");
        settle_request_at(
            &mut unpriced,
            SettleAiRequestInput {
                reservation_id: grant.reservation_id,
                owner_id: grant.owner_id,
                lease_token: grant.lease_token,
                outcome: "succeeded".to_string(),
                token_input: Some(20),
                token_output: Some(30),
            },
            now + 1_000,
        )
        .expect("settle unpriced request");
        let snapshot =
            get_snapshot_at(&mut unpriced, now + 1_000, &day(now)).expect("unpriced snapshot");
        assert_eq!(snapshot.token_used, 50);
        assert_eq!(snapshot.cost_used_usd, 0.0);
        assert_eq!(snapshot.unpriced_request_count, 1);
    }

    #[test]
    fn immediate_transaction_prevents_two_connections_from_over_admitting() {
        let path = temp_database_path("two-connections");
        initialize_file_database(&path);
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let handles = ["connection-a", "connection-b"].map(|owner| {
            let path = path.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                let mut connection = Connection::open(path).expect("open concurrent database");
                connection
                    .busy_timeout(Duration::from_secs(5))
                    .expect("set busy timeout");
                let mut input = reserve_input(owner);
                input.max_concurrent_requests = 1;
                barrier.wait();
                reserve_request(&mut connection, input).map(|_| ())
            })
        });
        let results = handles.map(|handle| handle.join().expect("join concurrent reservation"));
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter_map(|result| result.as_ref().err())
                .filter(|error| error.code == codes::AI_CONCURRENCY_LIMIT_EXCEEDED)
                .count(),
            1
        );
        fs::remove_file(path).ok();
    }

    #[test]
    fn immediate_transaction_prevents_two_connections_from_over_reserving_daily_budget() {
        let path = temp_database_path("two-connection-budget");
        initialize_file_database(&path);
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let handles = ["budget-a", "budget-b"].map(|owner| {
            let path = path.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                let mut connection = Connection::open(path).expect("open budget database");
                connection
                    .busy_timeout(Duration::from_secs(5))
                    .expect("set budget busy timeout");
                let mut input = reserve_input(owner);
                input.max_concurrent_requests = 2;
                input.daily_token_budget = Some(300);
                barrier.wait();
                reserve_request(&mut connection, input).map(|_| ())
            })
        });
        let results = handles.map(|handle| handle.join().expect("join budget reservation"));
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter_map(|result| result.as_ref().err())
                .filter(|error| error.code == codes::AI_DAILY_TOKEN_BUDGET_EXCEEDED)
                .count(),
            1
        );
        fs::remove_file(path).ok();
    }

    fn temp_database_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ai-novel-studio-policy-{label}-{}.db",
            Uuid::new_v4()
        ))
    }

    fn initialize_file_database(path: &Path) {
        let mut connection = Connection::open(path).expect("open file policy database");
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
            )
            .expect("configure file policy database");
        crate::db::create_tables(&mut connection).expect("create file policy schema");
    }

    #[test]
    fn child_process_reservation_worker() {
        let database_path = match std::env::var("AI_REQUEST_POLICY_CHILD_DB") {
            Ok(value) => value,
            Err(_) => return,
        };
        let output_path =
            std::env::var("AI_REQUEST_POLICY_CHILD_OUTPUT").expect("child output path is required");
        let owner =
            std::env::var("AI_REQUEST_POLICY_CHILD_OWNER").expect("child owner is required");
        let gate = std::env::var("AI_REQUEST_POLICY_CHILD_GATE").expect("child gate is required");
        let deadline = Instant::now() + Duration::from_secs(10);
        while !Path::new(&gate).exists() {
            assert!(Instant::now() < deadline, "child start gate timed out");
            thread::sleep(Duration::from_millis(5));
        }
        let mut connection = Connection::open(database_path).expect("child opens policy database");
        connection
            .busy_timeout(Duration::from_secs(5))
            .expect("child busy timeout");
        let mut input = reserve_input(&owner);
        input.max_concurrent_requests = 1;
        let result = reserve_request(&mut connection, input)
            .map(|_| "ok".to_string())
            .unwrap_or_else(|error| error.code);
        fs::write(output_path, result).expect("write child result");
    }

    #[test]
    fn two_processes_share_one_global_concurrency_budget() {
        if std::env::var("AI_REQUEST_POLICY_CHILD_DB").is_ok() {
            return;
        }
        let database_path = temp_database_path("two-processes");
        initialize_file_database(&database_path);
        let gate = database_path.with_extension("gate");
        let outputs = [
            database_path.with_extension("child-a"),
            database_path.with_extension("child-b"),
        ];
        let executable = std::env::current_exe().expect("current test executable");
        let test_name =
            "services::ai_request_policy_service::tests::child_process_reservation_worker";
        let mut children = outputs
            .iter()
            .enumerate()
            .map(|(index, output)| {
                Command::new(&executable)
                    .arg("--exact")
                    .arg(test_name)
                    .arg("--nocapture")
                    .env("AI_REQUEST_POLICY_CHILD_DB", &database_path)
                    .env("AI_REQUEST_POLICY_CHILD_OUTPUT", output)
                    .env("AI_REQUEST_POLICY_CHILD_OWNER", format!("process-{index}"))
                    .env("AI_REQUEST_POLICY_CHILD_GATE", &gate)
                    .spawn()
                    .expect("spawn policy child process")
            })
            .collect::<Vec<_>>();
        thread::sleep(Duration::from_millis(100));
        fs::write(&gate, b"start").expect("open child start gate");
        for child in &mut children {
            assert!(child.wait().expect("wait for policy child").success());
        }
        let results = outputs
            .iter()
            .map(|path| fs::read_to_string(path).expect("read child result"))
            .collect::<Vec<_>>();
        assert_eq!(
            results
                .iter()
                .filter(|value| value.as_str() == "ok")
                .count(),
            1
        );
        assert_eq!(
            results
                .iter()
                .filter(|value| value.as_str() == codes::AI_CONCURRENCY_LIMIT_EXCEEDED)
                .count(),
            1
        );
        for path in outputs.iter().chain([&gate, &database_path]) {
            fs::remove_file(path).ok();
        }
    }
}
