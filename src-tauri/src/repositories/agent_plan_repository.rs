use crate::errors::AppError;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanRecord {
    pub plan_id: String,
    pub operation_id: String,
    pub request_hash: String,
    pub contract_version: String,
    pub planner_id: String,
    pub planner_version: i64,
    pub registry_hash: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub status: String,
    pub state_revision: i64,
    pub result_json: Option<Value>,
    pub error_json: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanStepRecord {
    pub step_id: String,
    pub plan_id: String,
    pub step_key: String,
    pub ordinal: i64,
    pub title: String,
    pub tool_name: String,
    pub tool_version: String,
    pub tool_identity: String,
    pub registry_hash: String,
    pub input_schema_hash: String,
    pub output_schema_hash: String,
    pub permissions_json: Value,
    pub scope: String,
    pub arguments_json: Value,
    pub arguments_hash: String,
    pub status: String,
    pub state_revision: i64,
    pub output_json: Option<Value>,
    pub output_hash: Option<String>,
    pub error_json: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanStepDependencyRecord {
    pub plan_id: String,
    pub step_id: String,
    pub depends_on_step_id: String,
    pub dependency_ordinal: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanStepAttemptRecord {
    pub attempt_id: String,
    pub plan_id: String,
    pub step_id: String,
    pub attempt_number: i64,
    pub lease_id: String,
    pub lease_epoch: i64,
    pub status: String,
    pub output_json: Option<Value>,
    pub output_hash: Option<String>,
    pub error_json: Option<Value>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecutionLeaseRecord {
    pub lease_id: String,
    pub plan_id: String,
    pub epoch: i64,
    pub owner_id: String,
    pub expires_at: String,
    pub status: String,
    pub acquired_at: String,
    pub released_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredAgentExecutionLease {
    pub lease_id: String,
    pub plan_id: String,
    pub epoch: i64,
    pub owner_id: String,
    pub token_hash: String,
    pub expires_at: String,
    pub status: String,
    pub acquired_at: String,
    pub released_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanCheckpointRecord {
    pub checkpoint_id: String,
    pub plan_id: String,
    pub sequence: i64,
    pub event_type: String,
    pub step_id: Option<String>,
    pub attempt_id: Option<String>,
    pub plan_status: String,
    pub step_status: Option<String>,
    pub payload_json: Value,
    pub payload_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanBundle {
    pub plan: AgentPlanRecord,
    pub steps: Vec<AgentPlanStepRecord>,
    pub dependencies: Vec<AgentPlanStepDependencyRecord>,
    pub attempts: Vec<AgentPlanStepAttemptRecord>,
    pub checkpoints: Vec<AgentPlanCheckpointRecord>,
}

fn json_column(row: &Row<'_>, index: usize) -> rusqlite::Result<Value> {
    let raw: String = row.get(index)?;
    serde_json::from_str(&raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn optional_json_column(row: &Row<'_>, index: usize) -> rusqlite::Result<Option<Value>> {
    row.get::<_, Option<String>>(index)?
        .map(|raw| {
            serde_json::from_str(&raw).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    index,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })
        })
        .transpose()
}

fn map_plan(row: &Row<'_>) -> rusqlite::Result<AgentPlanRecord> {
    Ok(AgentPlanRecord {
        plan_id: row.get(0)?,
        operation_id: row.get(1)?,
        request_hash: row.get(2)?,
        contract_version: row.get(3)?,
        planner_id: row.get(4)?,
        planner_version: row.get(5)?,
        registry_hash: row.get(6)?,
        novel_id: row.get(7)?,
        chapter_id: row.get(8)?,
        status: row.get(9)?,
        state_revision: row.get(10)?,
        result_json: optional_json_column(row, 11)?,
        error_json: optional_json_column(row, 12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
        completed_at: row.get(15)?,
    })
}

const PLAN_SELECT: &str = "SELECT plan_id, operation_id, request_hash, contract_version,
    planner_id, planner_version, registry_hash, novel_id, chapter_id, status,
    state_revision, result_json, error_json, created_at, updated_at, completed_at
    FROM agent_plans";

fn map_step(row: &Row<'_>) -> rusqlite::Result<AgentPlanStepRecord> {
    Ok(AgentPlanStepRecord {
        step_id: row.get(0)?,
        plan_id: row.get(1)?,
        step_key: row.get(2)?,
        ordinal: row.get(3)?,
        title: row.get(4)?,
        tool_name: row.get(5)?,
        tool_version: row.get(6)?,
        tool_identity: row.get(7)?,
        registry_hash: row.get(8)?,
        input_schema_hash: row.get(9)?,
        output_schema_hash: row.get(10)?,
        permissions_json: json_column(row, 11)?,
        scope: row.get(12)?,
        arguments_json: json_column(row, 13)?,
        arguments_hash: row.get(14)?,
        status: row.get(15)?,
        state_revision: row.get(16)?,
        output_json: optional_json_column(row, 17)?,
        output_hash: row.get(18)?,
        error_json: optional_json_column(row, 19)?,
        created_at: row.get(20)?,
        updated_at: row.get(21)?,
        completed_at: row.get(22)?,
    })
}

const STEP_SELECT: &str = "SELECT step_id, plan_id, step_key, ordinal, title,
    tool_name, tool_version, tool_identity, registry_hash, input_schema_hash,
    output_schema_hash, permissions_json, scope, arguments_json, arguments_hash,
    status, state_revision, output_json, output_hash, error_json, created_at,
    updated_at, completed_at FROM agent_plan_steps";

fn map_attempt(row: &Row<'_>) -> rusqlite::Result<AgentPlanStepAttemptRecord> {
    Ok(AgentPlanStepAttemptRecord {
        attempt_id: row.get(0)?,
        plan_id: row.get(1)?,
        step_id: row.get(2)?,
        attempt_number: row.get(3)?,
        lease_id: row.get(4)?,
        lease_epoch: row.get(5)?,
        status: row.get(6)?,
        output_json: optional_json_column(row, 7)?,
        output_hash: row.get(8)?,
        error_json: optional_json_column(row, 9)?,
        started_at: row.get(10)?,
        finished_at: row.get(11)?,
    })
}

const ATTEMPT_SELECT: &str = "SELECT attempt_id, plan_id, step_id, attempt_number,
    lease_id, lease_epoch, status, output_json, output_hash, error_json,
    started_at, finished_at FROM agent_plan_step_attempts";

fn map_checkpoint(row: &Row<'_>) -> rusqlite::Result<AgentPlanCheckpointRecord> {
    Ok(AgentPlanCheckpointRecord {
        checkpoint_id: row.get(0)?,
        plan_id: row.get(1)?,
        sequence: row.get(2)?,
        event_type: row.get(3)?,
        step_id: row.get(4)?,
        attempt_id: row.get(5)?,
        plan_status: row.get(6)?,
        step_status: row.get(7)?,
        payload_json: json_column(row, 8)?,
        payload_hash: row.get(9)?,
        created_at: row.get(10)?,
    })
}

pub fn get_plan(
    connection: &Connection,
    plan_id: &str,
) -> Result<Option<AgentPlanRecord>, AppError> {
    connection
        .query_row(
            &format!("{PLAN_SELECT} WHERE plan_id = ?1"),
            params![plan_id],
            map_plan,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn get_plan_by_operation(
    connection: &Connection,
    operation_id: &str,
) -> Result<Option<AgentPlanRecord>, AppError> {
    connection
        .query_row(
            &format!("{PLAN_SELECT} WHERE operation_id = ?1"),
            params![operation_id],
            map_plan,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn list_plans_by_chapter(
    connection: &Connection,
    chapter_id: &str,
    limit: i64,
) -> Result<Vec<AgentPlanRecord>, AppError> {
    let mut statement = connection
        .prepare(&format!(
            "{PLAN_SELECT} WHERE chapter_id = ?1 ORDER BY created_at DESC LIMIT ?2"
        ))
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![chapter_id, limit], map_plan)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}

pub fn get_step(
    connection: &Connection,
    plan_id: &str,
    step_id: &str,
) -> Result<Option<AgentPlanStepRecord>, AppError> {
    connection
        .query_row(
            &format!("{STEP_SELECT} WHERE plan_id = ?1 AND step_id = ?2"),
            params![plan_id, step_id],
            map_step,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn list_steps(
    connection: &Connection,
    plan_id: &str,
) -> Result<Vec<AgentPlanStepRecord>, AppError> {
    let mut statement = connection
        .prepare(&format!(
            "{STEP_SELECT} WHERE plan_id = ?1 ORDER BY ordinal ASC"
        ))
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![plan_id], map_step)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}

pub fn list_dependencies(
    connection: &Connection,
    plan_id: &str,
) -> Result<Vec<AgentPlanStepDependencyRecord>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT plan_id, step_id, depends_on_step_id, dependency_ordinal, created_at
             FROM agent_plan_step_dependencies WHERE plan_id = ?1
             ORDER BY step_id ASC, dependency_ordinal ASC",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![plan_id], |row| {
            Ok(AgentPlanStepDependencyRecord {
                plan_id: row.get(0)?,
                step_id: row.get(1)?,
                depends_on_step_id: row.get(2)?,
                dependency_ordinal: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}

pub fn get_attempt(
    connection: &Connection,
    attempt_id: &str,
) -> Result<Option<AgentPlanStepAttemptRecord>, AppError> {
    connection
        .query_row(
            &format!("{ATTEMPT_SELECT} WHERE attempt_id = ?1"),
            params![attempt_id],
            map_attempt,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn list_attempts(
    connection: &Connection,
    plan_id: &str,
) -> Result<Vec<AgentPlanStepAttemptRecord>, AppError> {
    let mut statement = connection
        .prepare(&format!(
            "{ATTEMPT_SELECT} WHERE plan_id = ?1 ORDER BY started_at ASC, attempt_number ASC"
        ))
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![plan_id], map_attempt)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}

pub fn list_checkpoints(
    connection: &Connection,
    plan_id: &str,
) -> Result<Vec<AgentPlanCheckpointRecord>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT checkpoint_id, plan_id, sequence, event_type, step_id, attempt_id,
                plan_status, step_status, payload_json, payload_hash, created_at
             FROM agent_plan_checkpoints WHERE plan_id = ?1 ORDER BY sequence ASC",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![plan_id], map_checkpoint)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}

pub fn get_bundle(
    connection: &Connection,
    plan_id: &str,
) -> Result<Option<AgentPlanBundle>, AppError> {
    let Some(plan) = get_plan(connection, plan_id)? else {
        return Ok(None);
    };
    Ok(Some(AgentPlanBundle {
        plan,
        steps: list_steps(connection, plan_id)?,
        dependencies: list_dependencies(connection, plan_id)?,
        attempts: list_attempts(connection, plan_id)?,
        checkpoints: list_checkpoints(connection, plan_id)?,
    }))
}

pub fn get_stored_lease(
    connection: &Connection,
    lease_id: &str,
) -> Result<Option<StoredAgentExecutionLease>, AppError> {
    connection
        .query_row(
            "SELECT lease_id, plan_id, epoch, owner_id, token_hash, expires_at,
                status, acquired_at, released_at
             FROM agent_execution_leases WHERE lease_id = ?1",
            params![lease_id],
            |row| {
                Ok(StoredAgentExecutionLease {
                    lease_id: row.get(0)?,
                    plan_id: row.get(1)?,
                    epoch: row.get(2)?,
                    owner_id: row.get(3)?,
                    token_hash: row.get(4)?,
                    expires_at: row.get(5)?,
                    status: row.get(6)?,
                    acquired_at: row.get(7)?,
                    released_at: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(AppError::database)
}

pub fn public_lease(
    connection: &Connection,
    lease_id: &str,
) -> Result<Option<AgentExecutionLeaseRecord>, AppError> {
    connection
        .query_row(
            "SELECT lease_id, plan_id, epoch, owner_id, expires_at, status,
                acquired_at, released_at
             FROM agent_execution_leases WHERE lease_id = ?1",
            params![lease_id],
            |row| {
                Ok(AgentExecutionLeaseRecord {
                    lease_id: row.get(0)?,
                    plan_id: row.get(1)?,
                    epoch: row.get(2)?,
                    owner_id: row.get(3)?,
                    expires_at: row.get(4)?,
                    status: row.get(5)?,
                    acquired_at: row.get(6)?,
                    released_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(AppError::database)
}
