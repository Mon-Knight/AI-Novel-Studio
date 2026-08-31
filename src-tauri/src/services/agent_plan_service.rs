use crate::domain::agent_plan::{
    AgentPlanStatus, AgentPlanStepStatus, AGENT_PLAN_CONTRACT_VERSION,
    CHAPTER_READINESS_PLANNER_ID, CHAPTER_READINESS_PLANNER_VERSION,
};
use crate::errors::{codes, AppError};
use crate::repositories::{
    agent_plan_repository,
    agent_plan_repository::{
        AgentExecutionLeaseRecord, AgentPlanBundle, AgentPlanRecord, AgentPlanStepAttemptRecord,
        AgentPlanStepRecord,
    },
    large_text_repository,
};
use crate::services::ai_fact_security;
use chrono::{Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub const PRODUCTION_TOOL_REGISTRY_HASH: &str =
    "82672d8347a8143a716e590014b9cf61fc576c0556c8683027d51528243c5192";
const GENERAL_OUTPUT_SCHEMA_HASH: &str =
    "b0796da35365057202a2eb62644b0659796fc96fcb055af1bef4d25e5f48378d";
const NOVEL_INPUT_SCHEMA_HASH: &str =
    "161ef7132775c4652bbe3564ca09f97a164cd0014bf4b1594aefcda757db14e3";
const CHAPTER_INPUT_SCHEMA_HASH: &str =
    "e88a42823b85cffce7513811f45b1a7e29a26627cfc23f1acf1cab643d20c189";
const READINESS_OUTPUT_SCHEMA_HASH: &str =
    "e6864e228c7973dec58a3756684fd3412b4c5e001f1703a09ff9bdbe776336ff";
const MAX_TOOL_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone)]
struct StepSpec {
    key: &'static str,
    title: &'static str,
    tool_name: &'static str,
    input_schema_hash: &'static str,
    output_schema_hash: &'static str,
    permissions: &'static [&'static str],
    scope: &'static str,
    dependencies: &'static [usize],
}

const READINESS_STEPS: [StepSpec; 6] = [
    StepSpec {
        key: "read_novel_context",
        title: "读取作品上下文",
        tool_name: "novel.read_context",
        input_schema_hash: NOVEL_INPUT_SCHEMA_HASH,
        output_schema_hash: GENERAL_OUTPUT_SCHEMA_HASH,
        permissions: &["novel.read"],
        scope: "novel",
        dependencies: &[],
    },
    StepSpec {
        key: "read_chapter_outline",
        title: "读取章节大纲",
        tool_name: "chapter.read_outline",
        input_schema_hash: CHAPTER_INPUT_SCHEMA_HASH,
        output_schema_hash: GENERAL_OUTPUT_SCHEMA_HASH,
        permissions: &["chapter.read", "novel.read"],
        scope: "chapter",
        dependencies: &[0],
    },
    StepSpec {
        key: "read_chapter_context",
        title: "读取章节上下文",
        tool_name: "chapter.read_context",
        input_schema_hash: CHAPTER_INPUT_SCHEMA_HASH,
        output_schema_hash: GENERAL_OUTPUT_SCHEMA_HASH,
        permissions: &["chapter.read", "novel.read"],
        scope: "chapter",
        dependencies: &[0],
    },
    StepSpec {
        key: "read_style_profile",
        title: "读取风格方案",
        tool_name: "style.read_profile",
        input_schema_hash: NOVEL_INPUT_SCHEMA_HASH,
        output_schema_hash: GENERAL_OUTPUT_SCHEMA_HASH,
        permissions: &["novel.read", "style.read"],
        scope: "novel",
        dependencies: &[0],
    },
    StepSpec {
        key: "read_output_control",
        title: "读取输出控制",
        tool_name: "style.read_output_control",
        input_schema_hash: NOVEL_INPUT_SCHEMA_HASH,
        output_schema_hash: GENERAL_OUTPUT_SCHEMA_HASH,
        permissions: &["novel.read", "style.read"],
        scope: "novel",
        dependencies: &[0],
    },
    StepSpec {
        key: "check_readiness",
        title: "检查章节准备度",
        tool_name: "verification.check_readiness",
        input_schema_hash: CHAPTER_INPUT_SCHEMA_HASH,
        output_schema_hash: READINESS_OUTPUT_SCHEMA_HASH,
        permissions: &[
            "chapter.read",
            "novel.read",
            "style.read",
            "verification.execute",
        ],
        scope: "chapter",
        dependencies: &[1, 2, 3, 4],
    },
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentPlanInput {
    pub operation_id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub registry_hash: String,
    pub planner_id: Option<String>,
    pub planner_version: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcquireAgentPlanLeaseInput {
    pub plan_id: String,
    pub owner_id: String,
    pub ttl_seconds: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanLeaseProof {
    pub lease_id: String,
    pub epoch: i64,
    pub owner_id: String,
    pub token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimAgentPlanStepInput {
    pub plan_id: String,
    pub step_id: String,
    pub lease: AgentPlanLeaseProof,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteAgentPlanStepInput {
    pub plan_id: String,
    pub step_id: String,
    pub attempt_id: String,
    pub output_json: Value,
    pub lease: AgentPlanLeaseProof,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailAgentPlanStepInput {
    pub plan_id: String,
    pub step_id: String,
    pub attempt_id: String,
    pub error: AppError,
    pub lease: AgentPlanLeaseProof,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizeAgentPlanRetryInput {
    pub plan_id: String,
    pub step_id: String,
    pub operation_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanLeaseGrant {
    pub lease: AgentExecutionLeaseRecord,
    pub token: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanStepClaim {
    pub plan: AgentPlanRecord,
    pub step: AgentPlanStepRecord,
    pub attempt: AgentPlanStepAttemptRecord,
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::new(codes::AGENT_PLAN_INPUT_INVALID, message, false)
}

fn plan_not_found() -> AppError {
    AppError::new(codes::AGENT_PLAN_NOT_FOUND, "Agent Plan 不存在", false)
}

fn validate_identifier(value: &str, label: &str) -> Result<(), AppError> {
    ai_fact_security::validate_identifier(value, label, 160)
        .map_err(|_| invalid(format!("{label} 无效")))
}

fn commit(
    transaction: rusqlite::Transaction<'_>,
    operation_id: Option<&str>,
) -> Result<(), AppError> {
    transaction.commit().map_err(|error| {
        AppError::new(
            codes::DATABASE_COMMIT_UNKNOWN,
            "Agent Plan 提交状态未知，请按相同身份重新读取",
            true,
        )
        .with_context(None, operation_id)
        .with_details(serde_json::json!({ "sqliteError": error.to_string() }))
    })
}

fn arguments_for(spec: &StepSpec, novel_id: &str, chapter_id: &str) -> Value {
    if spec.scope == "novel" {
        serde_json::json!({ "novelId": novel_id })
    } else {
        serde_json::json!({ "novelId": novel_id, "chapterId": chapter_id })
    }
}

fn request_value(input: &CreateAgentPlanInput) -> Result<Value, AppError> {
    let mut steps = Vec::with_capacity(READINESS_STEPS.len());
    for (index, spec) in READINESS_STEPS.iter().enumerate() {
        let arguments = arguments_for(spec, &input.novel_id, &input.chapter_id);
        steps.push(serde_json::json!({
            "stepKey": spec.key,
            "ordinal": index + 1,
            "toolIdentity": format!("{}@1", spec.tool_name),
            "inputSchemaHash": spec.input_schema_hash,
            "outputSchemaHash": spec.output_schema_hash,
            "permissions": spec.permissions,
            "scope": spec.scope,
            "arguments": arguments,
            "argumentsHash": ai_fact_security::canonical_hash(&arguments)?,
            "dependencies": spec.dependencies.iter().map(|dependency| {
                READINESS_STEPS[*dependency].key
            }).collect::<Vec<_>>(),
        }));
    }
    Ok(serde_json::json!({
        "contractVersion": AGENT_PLAN_CONTRACT_VERSION,
        "plannerId": CHAPTER_READINESS_PLANNER_ID,
        "plannerVersion": CHAPTER_READINESS_PLANNER_VERSION,
        "registryHash": input.registry_hash,
        "novelId": input.novel_id,
        "chapterId": input.chapter_id,
        "steps": steps,
    }))
}

fn require_bundle(connection: &Connection, plan_id: &str) -> Result<AgentPlanBundle, AppError> {
    agent_plan_repository::get_bundle(connection, plan_id)?.ok_or_else(plan_not_found)
}

fn insert_checkpoint(
    connection: &Connection,
    plan_id: &str,
    event_type: &str,
    step_id: Option<&str>,
    attempt_id: Option<&str>,
    plan_status: &str,
    step_status: Option<&str>,
    payload: &Value,
    now: &str,
) -> Result<(), AppError> {
    ai_fact_security::validate_metadata(payload, "Agent Plan checkpoint")?;
    let sequence: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM agent_plan_checkpoints
             WHERE plan_id = ?1",
            params![plan_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    let payload_json = ai_fact_security::canonical_json(payload)?;
    let payload_hash = ai_fact_security::canonical_hash(payload)?;
    connection
        .execute(
            "INSERT INTO agent_plan_checkpoints
             (checkpoint_id, plan_id, sequence, event_type, step_id, attempt_id,
              plan_status, step_status, payload_json, payload_hash, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                Uuid::new_v4().to_string(),
                plan_id,
                sequence,
                event_type,
                step_id,
                attempt_id,
                plan_status,
                step_status,
                payload_json,
                payload_hash,
                now,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

pub fn create_plan(
    connection: &mut Connection,
    input: CreateAgentPlanInput,
) -> Result<AgentPlanBundle, AppError> {
    validate_identifier(&input.operation_id, "operationId")?;
    validate_identifier(&input.novel_id, "novelId")?;
    validate_identifier(&input.chapter_id, "chapterId")?;
    if input.registry_hash != PRODUCTION_TOOL_REGISTRY_HASH
        || input
            .planner_id
            .as_deref()
            .unwrap_or(CHAPTER_READINESS_PLANNER_ID)
            != CHAPTER_READINESS_PLANNER_ID
        || input
            .planner_version
            .unwrap_or(CHAPTER_READINESS_PLANNER_VERSION)
            != CHAPTER_READINESS_PLANNER_VERSION
    {
        return Err(invalid("Planner 或 Tool Registry 身份与生产契约不一致"));
    }
    let request_hash = ai_fact_security::canonical_hash(&request_value(&input)?)?;
    if let Some(existing) =
        agent_plan_repository::get_plan_by_operation(connection, &input.operation_id)?
    {
        if existing.request_hash != request_hash {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "相同 operationId 对应不同 Agent Plan 请求",
                false,
            ));
        }
        return require_bundle(connection, &existing.plan_id);
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let scope_exists: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM chapters c JOIN novels n ON n.id = c.novel_id
             WHERE c.id = ?1 AND c.novel_id = ?2
               AND c.deleted_at IS NULL AND n.deleted_at IS NULL",
            params![input.chapter_id, input.novel_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if scope_exists != 1 {
        return Err(invalid("章节不存在或不属于指定作品"));
    }
    if let Some(existing) =
        agent_plan_repository::get_plan_by_operation(&transaction, &input.operation_id)?
    {
        if existing.request_hash != request_hash {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "相同 operationId 对应不同 Agent Plan 请求",
                false,
            ));
        }
        drop(transaction);
        return require_bundle(connection, &existing.plan_id);
    }

    let now = Utc::now().to_rfc3339();
    let plan_id = Uuid::new_v4().to_string();
    transaction
        .execute(
            "INSERT INTO agent_plans
             (plan_id, operation_id, request_hash, contract_version, planner_id,
              planner_version, registry_hash, novel_id, chapter_id, status,
              state_revision, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'ready',0,?10,?10)",
            params![
                plan_id,
                input.operation_id,
                request_hash,
                AGENT_PLAN_CONTRACT_VERSION,
                CHAPTER_READINESS_PLANNER_ID,
                CHAPTER_READINESS_PLANNER_VERSION,
                input.registry_hash,
                input.novel_id,
                input.chapter_id,
                now,
            ],
        )
        .map_err(AppError::database)?;

    let step_ids = (0..READINESS_STEPS.len())
        .map(|_| Uuid::new_v4().to_string())
        .collect::<Vec<_>>();
    for (index, spec) in READINESS_STEPS.iter().enumerate() {
        let arguments = arguments_for(spec, &input.novel_id, &input.chapter_id);
        let arguments_json = ai_fact_security::canonical_json(&arguments)?;
        let arguments_hash = ai_fact_security::canonical_hash(&arguments)?;
        let permissions =
            serde_json::to_value(spec.permissions).map_err(|_| invalid("权限无效"))?;
        let permissions_json = ai_fact_security::canonical_json(&permissions)?;
        transaction
            .execute(
                "INSERT INTO agent_plan_steps
                 (step_id, plan_id, step_key, ordinal, title, tool_name, tool_version,
                  tool_identity, registry_hash, input_schema_hash, output_schema_hash,
                  permissions_json, scope, arguments_json, arguments_hash, status,
                  state_revision, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,'1',?7,?8,?9,?10,?11,?12,?13,?14,
                         'pending',0,?15,?15)",
                params![
                    step_ids[index],
                    plan_id,
                    spec.key,
                    (index + 1) as i64,
                    spec.title,
                    spec.tool_name,
                    format!("{}@1", spec.tool_name),
                    input.registry_hash,
                    spec.input_schema_hash,
                    spec.output_schema_hash,
                    permissions_json,
                    spec.scope,
                    arguments_json,
                    arguments_hash,
                    now,
                ],
            )
            .map_err(AppError::database)?;
        for (dependency_ordinal, dependency_index) in spec.dependencies.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO agent_plan_step_dependencies
                     (plan_id, step_id, depends_on_step_id, dependency_ordinal, created_at)
                     VALUES (?1,?2,?3,?4,?5)",
                    params![
                        plan_id,
                        step_ids[index],
                        step_ids[*dependency_index],
                        (dependency_ordinal + 1) as i64,
                        now,
                    ],
                )
                .map_err(AppError::database)?;
        }
    }
    insert_checkpoint(
        &transaction,
        &plan_id,
        "plan_created",
        None,
        None,
        AgentPlanStatus::Ready.as_str(),
        None,
        &serde_json::json!({
            "requestHash": request_hash,
            "plannerId": CHAPTER_READINESS_PLANNER_ID,
            "plannerVersion": CHAPTER_READINESS_PLANNER_VERSION,
            "registryHash": PRODUCTION_TOOL_REGISTRY_HASH,
        }),
        &now,
    )?;
    commit(transaction, Some(&input.operation_id))?;
    require_bundle(connection, &plan_id)
}

pub fn get_plan_bundle(
    connection: &Connection,
    plan_id: &str,
) -> Result<AgentPlanBundle, AppError> {
    require_bundle(connection, plan_id)
}

pub fn list_plans_by_chapter(
    connection: &Connection,
    chapter_id: &str,
    limit: i64,
) -> Result<Vec<AgentPlanRecord>, AppError> {
    validate_identifier(chapter_id, "chapterId")?;
    agent_plan_repository::list_plans_by_chapter(connection, chapter_id, limit.clamp(1, 100))
}

fn validate_lease(
    connection: &Connection,
    plan_id: &str,
    proof: &AgentPlanLeaseProof,
    now: &str,
) -> Result<(), AppError> {
    let lease = agent_plan_repository::get_stored_lease(connection, &proof.lease_id)?
        .ok_or_else(|| AppError::new(codes::AGENT_PLAN_LEASE_REQUIRED, "执行租约不存在", false))?;
    if lease.plan_id != plan_id
        || lease.epoch != proof.epoch
        || lease.owner_id != proof.owner_id
        || lease.token_hash != large_text_repository::sha256(&proof.token)
    {
        return Err(AppError::new(
            codes::AGENT_PLAN_LEASE_CONFLICT,
            "执行租约身份或 token 不匹配",
            false,
        ));
    }
    if lease.status != "active" {
        return Err(AppError::new(
            codes::AGENT_PLAN_LEASE_EXPIRED,
            "执行租约已释放或过期",
            false,
        ));
    }
    if lease.expires_at.as_str() <= now {
        connection
            .execute(
                "UPDATE agent_execution_leases SET status='expired', released_at=?1
                 WHERE lease_id=?2 AND status='active'",
                params![now, lease.lease_id],
            )
            .map_err(AppError::database)?;
        return Err(AppError::new(
            codes::AGENT_PLAN_LEASE_EXPIRED,
            "执行租约已过期",
            false,
        ));
    }
    Ok(())
}

pub fn acquire_lease(
    connection: &mut Connection,
    input: AcquireAgentPlanLeaseInput,
) -> Result<AgentPlanLeaseGrant, AppError> {
    validate_identifier(&input.plan_id, "planId")?;
    validate_identifier(&input.owner_id, "ownerId")?;
    let ttl = input.ttl_seconds.unwrap_or(120).clamp(5, 300);
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let plan = agent_plan_repository::get_plan(&transaction, &input.plan_id)?
        .ok_or_else(plan_not_found)?;
    if !matches!(plan.status.as_str(), "ready" | "running") {
        return Err(AppError::new(
            codes::AGENT_PLAN_ILLEGAL_TRANSITION,
            "当前计划必须先显式重试，或已经终止",
            false,
        ));
    }
    let now_value = Utc::now();
    let now = now_value.to_rfc3339();
    transaction
        .execute(
            "UPDATE agent_execution_leases SET status='expired', released_at=?1
             WHERE plan_id=?2 AND status='active' AND expires_at<=?1",
            params![now, input.plan_id],
        )
        .map_err(AppError::database)?;
    let active_count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM agent_execution_leases
             WHERE plan_id=?1 AND status='active'",
            params![input.plan_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if active_count != 0 {
        return Err(AppError::new(
            codes::AGENT_PLAN_LEASE_CONFLICT,
            "计划已有活动执行租约",
            true,
        ));
    }
    let epoch: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(epoch), 0) + 1 FROM agent_execution_leases
             WHERE plan_id=?1",
            params![input.plan_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    let lease_id = Uuid::new_v4().to_string();
    let token = format!("{}{}", Uuid::new_v4(), Uuid::new_v4());
    let token_hash = large_text_repository::sha256(&token);
    let expires_at = (now_value + Duration::seconds(ttl)).to_rfc3339();
    transaction
        .execute(
            "INSERT INTO agent_execution_leases
             (lease_id, plan_id, epoch, owner_id, token_hash, expires_at, status, acquired_at)
             VALUES (?1,?2,?3,?4,?5,?6,'active',?7)",
            params![
                lease_id,
                input.plan_id,
                epoch,
                input.owner_id,
                token_hash,
                expires_at,
                now,
            ],
        )
        .map_err(AppError::database)?;
    insert_checkpoint(
        &transaction,
        &input.plan_id,
        "lease_acquired",
        None,
        None,
        &plan.status,
        None,
        &serde_json::json!({
            "leaseId": lease_id,
            "epoch": epoch,
            "ownerId": input.owner_id,
            "expiresAt": expires_at,
        }),
        &now,
    )?;
    commit(transaction, None)?;
    let lease = agent_plan_repository::public_lease(connection, &lease_id)?
        .ok_or_else(|| AppError::new(codes::DATABASE_COMMIT_UNKNOWN, "租约提交后不可读", true))?;
    Ok(AgentPlanLeaseGrant { lease, token })
}

pub fn claim_step(
    connection: &mut Connection,
    input: ClaimAgentPlanStepInput,
) -> Result<AgentPlanStepClaim, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    validate_lease(&transaction, &input.plan_id, &input.lease, &now)?;
    let plan = agent_plan_repository::get_plan(&transaction, &input.plan_id)?
        .ok_or_else(plan_not_found)?;
    if !matches!(plan.status.as_str(), "ready" | "running") {
        return Err(AppError::new(
            codes::AGENT_PLAN_ILLEGAL_TRANSITION,
            "计划当前不可执行",
            false,
        ));
    }
    let step = agent_plan_repository::get_step(&transaction, &input.plan_id, &input.step_id)?
        .ok_or_else(|| invalid("Plan Step 不存在"))?;
    if step.status != "pending" {
        return Err(AppError::new(
            codes::AGENT_PLAN_STEP_NOT_READY,
            "步骤不是 pending 状态",
            false,
        ));
    }
    let incomplete_dependencies: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM agent_plan_step_dependencies d
             JOIN agent_plan_steps parent ON parent.step_id=d.depends_on_step_id
             WHERE d.step_id=?1 AND parent.status<>'completed'",
            params![input.step_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if incomplete_dependencies != 0 {
        return Err(AppError::new(
            codes::AGENT_PLAN_STEP_NOT_READY,
            "步骤依赖尚未完成",
            false,
        ));
    }
    if plan.status == "ready" {
        transaction
            .execute(
                "UPDATE agent_plans SET status='running', state_revision=state_revision+1,
                    updated_at=?1 WHERE plan_id=?2 AND status='ready'",
                params![now, input.plan_id],
            )
            .map_err(AppError::database)?;
    }
    let changed = transaction
        .execute(
            "UPDATE agent_plan_steps SET status='running', state_revision=state_revision+1,
                updated_at=?1 WHERE step_id=?2 AND plan_id=?3 AND status='pending'",
            params![now, input.step_id, input.plan_id],
        )
        .map_err(AppError::database)?;
    if changed != 1 {
        return Err(AppError::new(
            codes::AGENT_PLAN_STEP_NOT_READY,
            "步骤 claim 发生并发冲突",
            true,
        ));
    }
    let attempt_number: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(attempt_number), 0) + 1
             FROM agent_plan_step_attempts WHERE step_id=?1",
            params![input.step_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    let attempt_id = Uuid::new_v4().to_string();
    transaction
        .execute(
            "INSERT INTO agent_plan_step_attempts
             (attempt_id, plan_id, step_id, attempt_number, lease_id, lease_epoch,
              status, started_at)
             VALUES (?1,?2,?3,?4,?5,?6,'running',?7)",
            params![
                attempt_id,
                input.plan_id,
                input.step_id,
                attempt_number,
                input.lease.lease_id,
                input.lease.epoch,
                now,
            ],
        )
        .map_err(AppError::database)?;
    insert_checkpoint(
        &transaction,
        &input.plan_id,
        "step_claimed",
        Some(&input.step_id),
        Some(&attempt_id),
        AgentPlanStatus::Running.as_str(),
        Some(AgentPlanStepStatus::Running.as_str()),
        &serde_json::json!({
            "attemptNumber": attempt_number,
            "leaseId": input.lease.lease_id,
            "leaseEpoch": input.lease.epoch,
            "toolIdentity": step.tool_identity,
            "argumentsHash": step.arguments_hash,
        }),
        &now,
    )?;
    commit(transaction, None)?;
    let bundle = require_bundle(connection, &input.plan_id)?;
    let step = bundle
        .steps
        .into_iter()
        .find(|candidate| candidate.step_id == input.step_id)
        .ok_or_else(|| invalid("claim 后步骤不可读"))?;
    let attempt = bundle
        .attempts
        .into_iter()
        .find(|candidate| candidate.attempt_id == attempt_id)
        .ok_or_else(|| invalid("claim 后 Attempt 不可读"))?;
    Ok(AgentPlanStepClaim {
        plan: bundle.plan,
        step,
        attempt,
    })
}

fn validate_tool_output(output: &Value) -> Result<(String, String), AppError> {
    if ai_fact_security::contains_secret_value(output) {
        return Err(AppError::new(
            codes::AGENT_PLAN_OUTPUT_INVALID,
            "工具输出包含疑似凭据",
            false,
        ));
    }
    let canonical = ai_fact_security::canonical_json(output)?;
    if canonical.len() > MAX_TOOL_OUTPUT_BYTES {
        return Err(AppError::new(
            codes::AGENT_PLAN_OUTPUT_INVALID,
            "工具输出超过持久化大小限制",
            false,
        ));
    }
    let hash = large_text_repository::sha256(&canonical);
    Ok((canonical, hash))
}

fn require_running_attempt(
    connection: &Connection,
    plan_id: &str,
    step_id: &str,
    attempt_id: &str,
) -> Result<AgentPlanStepAttemptRecord, AppError> {
    let attempt = agent_plan_repository::get_attempt(connection, attempt_id)?
        .ok_or_else(|| invalid("Attempt 不存在"))?;
    if attempt.plan_id != plan_id || attempt.step_id != step_id || attempt.status != "running" {
        return Err(AppError::new(
            codes::AGENT_PLAN_ILLEGAL_TRANSITION,
            "Attempt 身份不匹配或已终止",
            false,
        ));
    }
    Ok(attempt)
}

pub fn complete_step(
    connection: &mut Connection,
    input: CompleteAgentPlanStepInput,
) -> Result<AgentPlanBundle, AppError> {
    let (output_json, output_hash) = validate_tool_output(&input.output_json)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    validate_lease(&transaction, &input.plan_id, &input.lease, &now)?;
    require_running_attempt(
        &transaction,
        &input.plan_id,
        &input.step_id,
        &input.attempt_id,
    )?;
    let step = agent_plan_repository::get_step(&transaction, &input.plan_id, &input.step_id)?
        .ok_or_else(|| invalid("Plan Step 不存在"))?;
    if step.status != "running" {
        return Err(AppError::new(
            codes::AGENT_PLAN_ILLEGAL_TRANSITION,
            "步骤不是 running 状态",
            false,
        ));
    }
    transaction
        .execute(
            "UPDATE agent_plan_step_attempts
             SET status='succeeded', output_json=?1, output_hash=?2, finished_at=?3
             WHERE attempt_id=?4 AND status='running'",
            params![output_json, output_hash, now, input.attempt_id],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "UPDATE agent_plan_steps
             SET status='completed', state_revision=state_revision+1, output_json=?1,
                 output_hash=?2, error_json=NULL, updated_at=?3, completed_at=?3
             WHERE step_id=?4 AND status='running'",
            params![output_json, output_hash, now, input.step_id],
        )
        .map_err(AppError::database)?;
    let remaining: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM agent_plan_steps
             WHERE plan_id=?1 AND status<>'completed'",
            params![input.plan_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    let plan_status = if remaining == 0 {
        transaction
            .execute(
                "UPDATE agent_plans
                 SET status='completed', state_revision=state_revision+1,
                     result_json=?1, error_json=NULL, updated_at=?2, completed_at=?2
                 WHERE plan_id=?3 AND status='running'",
                params![output_json, now, input.plan_id],
            )
            .map_err(AppError::database)?;
        transaction
            .execute(
                "UPDATE agent_execution_leases
                 SET status='released', released_at=?1
                 WHERE lease_id=?2 AND status='active'",
                params![now, input.lease.lease_id],
            )
            .map_err(AppError::database)?;
        AgentPlanStatus::Completed.as_str()
    } else {
        AgentPlanStatus::Running.as_str()
    };
    insert_checkpoint(
        &transaction,
        &input.plan_id,
        "step_completed",
        Some(&input.step_id),
        Some(&input.attempt_id),
        plan_status,
        Some(AgentPlanStepStatus::Completed.as_str()),
        &serde_json::json!({ "outputHash": output_hash }),
        &now,
    )?;
    if remaining == 0 {
        insert_checkpoint(
            &transaction,
            &input.plan_id,
            "lease_released",
            None,
            None,
            plan_status,
            None,
            &serde_json::json!({
                "leaseId": input.lease.lease_id,
                "epoch": input.lease.epoch,
                "reason": "plan_completed",
            }),
            &now,
        )?;
    }
    commit(transaction, None)?;
    require_bundle(connection, &input.plan_id)
}

pub fn fail_step(
    connection: &mut Connection,
    input: FailAgentPlanStepInput,
) -> Result<AgentPlanBundle, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    validate_lease(&transaction, &input.plan_id, &input.lease, &now)?;
    require_running_attempt(
        &transaction,
        &input.plan_id,
        &input.step_id,
        &input.attempt_id,
    )?;
    let safe_error = ai_fact_security::safe_error_json(&input.error);
    let safe_error_json = ai_fact_security::canonical_json(&safe_error)?;
    let (step_status, plan_status, completed_at) = if input.error.retryable {
        ("waiting_retry", "waiting_retry", None)
    } else {
        ("failed", "failed", Some(now.as_str()))
    };
    transaction
        .execute(
            "UPDATE agent_plan_step_attempts
             SET status='failed', error_json=?1, finished_at=?2
             WHERE attempt_id=?3 AND status='running'",
            params![safe_error_json, now, input.attempt_id],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "UPDATE agent_plan_steps
             SET status=?1, state_revision=state_revision+1, error_json=?2,
                 updated_at=?3, completed_at=?4
             WHERE step_id=?5 AND status='running'",
            params![
                step_status,
                safe_error_json,
                now,
                completed_at,
                input.step_id
            ],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "UPDATE agent_plans
             SET status=?1, state_revision=state_revision+1, error_json=?2,
                 updated_at=?3, completed_at=?4
             WHERE plan_id=?5 AND status='running'",
            params![
                plan_status,
                safe_error_json,
                now,
                completed_at,
                input.plan_id
            ],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "UPDATE agent_execution_leases SET status='released', released_at=?1
             WHERE lease_id=?2 AND status='active'",
            params![now, input.lease.lease_id],
        )
        .map_err(AppError::database)?;
    insert_checkpoint(
        &transaction,
        &input.plan_id,
        "step_failed",
        Some(&input.step_id),
        Some(&input.attempt_id),
        plan_status,
        Some(step_status),
        &safe_error,
        &now,
    )?;
    commit(transaction, None)?;
    require_bundle(connection, &input.plan_id)
}

pub fn authorize_retry(
    connection: &mut Connection,
    input: AuthorizeAgentPlanRetryInput,
) -> Result<AgentPlanBundle, AppError> {
    validate_identifier(&input.operation_id, "operationId")?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let existing: Option<String> = transaction
        .query_row(
            "SELECT checkpoint_id FROM agent_plan_checkpoints
             WHERE plan_id=?1 AND event_type='retry_authorized'
               AND json_extract(payload_json, '$.operationId')=?2",
            params![input.plan_id, input.operation_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)?;
    if existing.is_some() {
        drop(transaction);
        return require_bundle(connection, &input.plan_id);
    }
    let plan = agent_plan_repository::get_plan(&transaction, &input.plan_id)?
        .ok_or_else(plan_not_found)?;
    let step = agent_plan_repository::get_step(&transaction, &input.plan_id, &input.step_id)?
        .ok_or_else(|| invalid("Plan Step 不存在"))?;
    if plan.status != "waiting_retry" || step.status != "waiting_retry" {
        return Err(AppError::new(
            codes::AGENT_PLAN_ILLEGAL_TRANSITION,
            "只有 waiting_retry 的计划步骤可以显式重试",
            false,
        ));
    }
    let now = Utc::now().to_rfc3339();
    transaction
        .execute(
            "UPDATE agent_plan_steps
             SET status='pending', state_revision=state_revision+1, error_json=NULL,
                 updated_at=?1 WHERE step_id=?2 AND status='waiting_retry'",
            params![now, input.step_id],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "UPDATE agent_plans
             SET status='running', state_revision=state_revision+1, error_json=NULL,
                 updated_at=?1 WHERE plan_id=?2 AND status='waiting_retry'",
            params![now, input.plan_id],
        )
        .map_err(AppError::database)?;
    insert_checkpoint(
        &transaction,
        &input.plan_id,
        "retry_authorized",
        Some(&input.step_id),
        None,
        AgentPlanStatus::Running.as_str(),
        Some(AgentPlanStepStatus::Pending.as_str()),
        &serde_json::json!({
            "operationId": input.operation_id,
            "confirmedBy": "user",
            "userConfirmedAt": now,
        }),
        &now,
    )?;
    commit(transaction, Some(&input.operation_id))?;
    require_bundle(connection, &input.plan_id)
}

pub fn release_lease(
    connection: &mut Connection,
    plan_id: &str,
    proof: AgentPlanLeaseProof,
) -> Result<AgentExecutionLeaseRecord, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    validate_lease(&transaction, plan_id, &proof, &now)?;
    let plan =
        agent_plan_repository::get_plan(&transaction, plan_id)?.ok_or_else(plan_not_found)?;
    transaction
        .execute(
            "UPDATE agent_execution_leases SET status='released', released_at=?1
             WHERE lease_id=?2 AND status='active'",
            params![now, proof.lease_id],
        )
        .map_err(AppError::database)?;
    insert_checkpoint(
        &transaction,
        plan_id,
        "lease_released",
        None,
        None,
        &plan.status,
        None,
        &serde_json::json!({
            "leaseId": proof.lease_id,
            "epoch": proof.epoch,
            "reason": "executor_released",
        }),
        &now,
    )?;
    commit(transaction, None)?;
    agent_plan_repository::public_lease(connection, &proof.lease_id)?
        .ok_or_else(|| invalid("释放后的租约不可读"))
}

pub fn cancel_plan(
    connection: &mut Connection,
    plan_id: &str,
) -> Result<AgentPlanBundle, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let plan =
        agent_plan_repository::get_plan(&transaction, plan_id)?.ok_or_else(plan_not_found)?;
    if plan.status == "cancelled" {
        drop(transaction);
        return require_bundle(connection, plan_id);
    }
    if matches!(plan.status.as_str(), "completed" | "failed") {
        return Err(AppError::new(
            codes::AGENT_PLAN_ILLEGAL_TRANSITION,
            "终态计划不能取消",
            false,
        ));
    }
    let now = Utc::now().to_rfc3339();
    let cancellation = serde_json::json!({
        "code": "AGENT_PLAN_CANCELLED",
        "message": "用户取消 Agent Plan",
        "retryable": false,
    });
    let cancellation_json = ai_fact_security::canonical_json(&cancellation)?;
    transaction
        .execute(
            "UPDATE agent_plan_step_attempts
             SET status='abandoned', error_json=?1, finished_at=?2
             WHERE plan_id=?3 AND status='running'",
            params![cancellation_json, now, plan_id],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "UPDATE agent_plan_steps
             SET status='cancelled', state_revision=state_revision+1, error_json=?1,
                 updated_at=?2, completed_at=?2
             WHERE plan_id=?3 AND status IN ('pending','running','waiting_retry')",
            params![cancellation_json, now, plan_id],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "UPDATE agent_execution_leases SET status='released', released_at=?1
             WHERE plan_id=?2 AND status='active'",
            params![now, plan_id],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "UPDATE agent_plans
             SET status='cancelled', state_revision=state_revision+1, error_json=?1,
                 updated_at=?2, completed_at=?2
             WHERE plan_id=?3 AND status IN ('ready','running','waiting_retry')",
            params![cancellation_json, now, plan_id],
        )
        .map_err(AppError::database)?;
    insert_checkpoint(
        &transaction,
        plan_id,
        "plan_cancelled",
        None,
        None,
        AgentPlanStatus::Cancelled.as_str(),
        None,
        &cancellation,
        &now,
    )?;
    commit(transaction, None)?;
    require_bundle(connection, plan_id)
}

pub fn recover_interrupted_plans(
    connection: &mut Connection,
) -> Result<Vec<AgentPlanBundle>, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    transaction
        .execute(
            "UPDATE agent_execution_leases SET status='expired', released_at=?1
             WHERE status='active'",
            params![now],
        )
        .map_err(AppError::database)?;
    let plan_ids = {
        let mut statement = transaction
            .prepare("SELECT plan_id FROM agent_plans WHERE status='running' ORDER BY created_at")
            .map_err(AppError::database)?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        rows
    };
    let recovery = serde_json::json!({
        "code": "AGENT_PLAN_INTERRUPTED",
        "message": "应用重启后检测到中断执行；工具不会自动重放",
        "retryable": true,
    });
    let recovery_json = ai_fact_security::canonical_json(&recovery)?;
    for plan_id in &plan_ids {
        transaction
            .execute(
                "UPDATE agent_plan_step_attempts
                 SET status='abandoned', error_json=?1, finished_at=?2
                 WHERE plan_id=?3 AND status='running'",
                params![recovery_json, now, plan_id],
            )
            .map_err(AppError::database)?;
        let running_step: Option<String> = transaction
            .query_row(
                "SELECT step_id FROM agent_plan_steps
                 WHERE plan_id=?1 AND status='running' ORDER BY ordinal LIMIT 1",
                params![plan_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::database)?;
        let interrupted_step = if let Some(step_id) = running_step {
            transaction
                .execute(
                    "UPDATE agent_plan_steps
                     SET status='waiting_retry', state_revision=state_revision+1,
                         error_json=?1, updated_at=?2
                     WHERE step_id=?3 AND status='running'",
                    params![recovery_json, now, step_id],
                )
                .map_err(AppError::database)?;
            step_id
        } else {
            let step_id: String = transaction
                .query_row(
                    "SELECT child.step_id FROM agent_plan_steps child
                     WHERE child.plan_id=?1 AND child.status='pending'
                       AND NOT EXISTS (
                         SELECT 1 FROM agent_plan_step_dependencies d
                         JOIN agent_plan_steps parent ON parent.step_id=d.depends_on_step_id
                         WHERE d.step_id=child.step_id AND parent.status<>'completed'
                       )
                     ORDER BY child.ordinal LIMIT 1",
                    params![plan_id],
                    |row| row.get(0),
                )
                .map_err(AppError::database)?;
            transaction
                .execute(
                    "UPDATE agent_plan_steps
                     SET status='waiting_retry', state_revision=state_revision+1,
                         error_json=?1, updated_at=?2
                     WHERE step_id=?3 AND status='pending'",
                    params![recovery_json, now, step_id],
                )
                .map_err(AppError::database)?;
            step_id
        };
        transaction
            .execute(
                "UPDATE agent_plans
                 SET status='waiting_retry', state_revision=state_revision+1,
                     error_json=?1, updated_at=?2
                 WHERE plan_id=?3 AND status='running'",
                params![recovery_json, now, plan_id],
            )
            .map_err(AppError::database)?;
        insert_checkpoint(
            &transaction,
            plan_id,
            "interrupted_recovered",
            Some(&interrupted_step),
            None,
            AgentPlanStatus::WaitingRetry.as_str(),
            Some(AgentPlanStepStatus::WaitingRetry.as_str()),
            &serde_json::json!({
                "reason": "application_restart",
                "automaticReplay": false,
            }),
            &now,
        )?;
    }
    commit(transaction, None)?;
    plan_ids
        .iter()
        .map(|plan_id| require_bundle(connection, plan_id))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Result<Connection, Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch("PRAGMA foreign_keys=ON;")?;
        crate::db::create_tables(&mut connection)?;
        let now = Utc::now().to_rfc3339();
        connection.execute(
            "INSERT INTO novels (id,title,status,created_at,updated_at)
             VALUES ('novel-plan','Planner Test','draft',?1,?1)",
            params![now],
        )?;
        connection.execute(
            "INSERT INTO chapters
             (id,novel_id,title,outline,status,created_at,updated_at)
             VALUES ('chapter-plan','novel-plan','Chapter','outline','outline_ready',?1,?1)",
            params![now],
        )?;
        Ok(connection)
    }

    fn create_input(operation_id: &str) -> CreateAgentPlanInput {
        CreateAgentPlanInput {
            operation_id: operation_id.to_string(),
            novel_id: "novel-plan".to_string(),
            chapter_id: "chapter-plan".to_string(),
            registry_hash: PRODUCTION_TOOL_REGISTRY_HASH.to_string(),
            planner_id: None,
            planner_version: None,
        }
    }

    fn proof(grant: &AgentPlanLeaseGrant) -> AgentPlanLeaseProof {
        AgentPlanLeaseProof {
            lease_id: grant.lease.lease_id.clone(),
            epoch: grant.lease.epoch,
            owner_id: grant.lease.owner_id.clone(),
            token: grant.token.clone(),
        }
    }

    #[test]
    fn planner01_create_is_idempotent_and_freezes_six_step_dag(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let first = create_plan(&mut connection, create_input("create-plan-op"))?;
        let replay = create_plan(&mut connection, create_input("create-plan-op"))?;
        assert_eq!(first.plan.plan_id, replay.plan.plan_id);
        assert_eq!(first.plan.request_hash, replay.plan.request_hash);
        assert_eq!(first.steps.len(), 6);
        assert_eq!(first.dependencies.len(), 8);
        assert_eq!(
            first.steps[5].tool_identity,
            "verification.check_readiness@1"
        );
        assert!(first
            .steps
            .iter()
            .all(|step| step.registry_hash == PRODUCTION_TOOL_REGISTRY_HASH));
        let mut conflict = create_input("create-plan-op");
        conflict.chapter_id = "different".to_string();
        assert_eq!(
            create_plan(&mut connection, conflict).unwrap_err().code,
            codes::OPERATION_PAYLOAD_CONFLICT
        );
        Ok(())
    }

    #[test]
    fn planner02_lease_persists_only_hash_and_plan_completes_in_order(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let mut bundle = create_plan(&mut connection, create_input("complete-plan-op"))?;
        let grant = acquire_lease(
            &mut connection,
            AcquireAgentPlanLeaseInput {
                plan_id: bundle.plan.plan_id.clone(),
                owner_id: "planner-test-owner".to_string(),
                ttl_seconds: Some(300),
            },
        )?;
        let stored_token_hash: String = connection.query_row(
            "SELECT token_hash FROM agent_execution_leases WHERE lease_id=?1",
            params![grant.lease.lease_id],
            |row| row.get(0),
        )?;
        assert_ne!(stored_token_hash, grant.token);
        assert_eq!(
            stored_token_hash,
            large_text_repository::sha256(&grant.token)
        );

        for index in 0..6 {
            let step = bundle.steps[index].clone();
            let claim = claim_step(
                &mut connection,
                ClaimAgentPlanStepInput {
                    plan_id: bundle.plan.plan_id.clone(),
                    step_id: step.step_id.clone(),
                    lease: proof(&grant),
                },
            )?;
            let output = if index == 5 {
                serde_json::json!({
                    "ok": true,
                    "data": {
                        "ready": true,
                        "score": 100,
                        "missing": [],
                        "warnings": [],
                        "summary": "ready"
                    },
                    "source": "database"
                })
            } else {
                serde_json::json!({ "ok": true, "data": {} })
            };
            bundle = complete_step(
                &mut connection,
                CompleteAgentPlanStepInput {
                    plan_id: bundle.plan.plan_id.clone(),
                    step_id: step.step_id,
                    attempt_id: claim.attempt.attempt_id,
                    output_json: output,
                    lease: proof(&grant),
                },
            )?;
        }
        assert_eq!(bundle.plan.status, "completed");
        assert_eq!(bundle.attempts.len(), 6);
        assert!(bundle
            .attempts
            .iter()
            .all(|attempt| attempt.status == "succeeded"));
        assert_eq!(
            agent_plan_repository::public_lease(&connection, &grant.lease.lease_id)?
                .unwrap()
                .status,
            "released"
        );
        Ok(())
    }

    #[test]
    fn planner03_restart_abandons_attempt_and_requires_explicit_retry(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let bundle = create_plan(&mut connection, create_input("recover-plan-op"))?;
        let grant = acquire_lease(
            &mut connection,
            AcquireAgentPlanLeaseInput {
                plan_id: bundle.plan.plan_id.clone(),
                owner_id: "owner-before-restart".to_string(),
                ttl_seconds: Some(300),
            },
        )?;
        let claim = claim_step(
            &mut connection,
            ClaimAgentPlanStepInput {
                plan_id: bundle.plan.plan_id.clone(),
                step_id: bundle.steps[0].step_id.clone(),
                lease: proof(&grant),
            },
        )?;
        let recovered = recover_interrupted_plans(&mut connection)?;
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].plan.status, "waiting_retry");
        assert_eq!(recovered[0].steps[0].status, "waiting_retry");
        assert_eq!(recovered[0].attempts[0].status, "abandoned");
        assert_eq!(
            recovered[0].attempts[0].attempt_id,
            claim.attempt.attempt_id
        );
        assert_eq!(
            recovered[0].attempts.len(),
            1,
            "recovery must not replay tools"
        );

        let authorized = authorize_retry(
            &mut connection,
            AuthorizeAgentPlanRetryInput {
                plan_id: bundle.plan.plan_id.clone(),
                step_id: bundle.steps[0].step_id.clone(),
                operation_id: "explicit-retry-op".to_string(),
            },
        )?;
        assert_eq!(authorized.plan.status, "running");
        assert_eq!(authorized.steps[0].status, "pending");
        assert_eq!(authorized.attempts.len(), 1);
        let second_grant = acquire_lease(
            &mut connection,
            AcquireAgentPlanLeaseInput {
                plan_id: bundle.plan.plan_id,
                owner_id: "owner-after-restart".to_string(),
                ttl_seconds: Some(300),
            },
        )?;
        assert_eq!(second_grant.lease.epoch, grant.lease.epoch + 1);
        Ok(())
    }
}
