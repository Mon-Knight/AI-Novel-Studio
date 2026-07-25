use crate::errors::{codes, AppError};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskRecord {
    pub task_id: String,
    pub task_type: String,
    pub novel_id: String,
    pub chapter_id: Option<String>,
    pub draft_id: Option<String>,
    pub scope_type: String,
    pub status: String,
    pub state_revision: i64,
    pub input_snapshot_id: String,
    pub context_snapshot_id: String,
    pub constraint_snapshot_id: String,
    pub current_attempt_id: Option<String>,
    pub result_artifact_id: Option<String>,
    pub trace_id: String,
    pub operation_id: String,
    pub request_hash_version: i64,
    pub request_hash: String,
    pub expected_artifact_type: String,
    pub expected_artifact_schema_version: i64,
    pub target_hint_json: Option<Value>,
    pub error_json: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub applied_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskAttemptRecord {
    pub attempt_id: String,
    pub task_id: String,
    pub attempt_number: i64,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub provider_request_id: Option<String>,
    pub status: String,
    pub state_revision: i64,
    pub response_metadata_json: Option<Value>,
    pub error_json: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiInputSnapshotRecord {
    pub snapshot_id: String,
    pub task_id: String,
    pub schema_version: i64,
    pub input_type: String,
    pub payload_json: Value,
    pub body_ref_id: String,
    pub source_draft_id: Option<String>,
    pub source_draft_version: Option<i64>,
    pub base_content_hash: Option<String>,
    pub content_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiContextSnapshotRecord {
    pub snapshot_id: String,
    pub task_id: String,
    pub schema_version: i64,
    pub source_manifest_json: Value,
    pub compiled_context_ref_id: String,
    pub budget_json: Value,
    pub compiler_version: String,
    pub content_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiConstraintSnapshotRecord {
    pub snapshot_id: String,
    pub task_id: String,
    pub schema_version: i64,
    pub payload_json: Value,
    pub prompt_template_id: String,
    pub prompt_template_version: String,
    pub prompt_template_hash: String,
    pub prompt_template_ref_id: String,
    pub provider_options_json: Value,
    pub content_hash: String,
    pub created_at: String,
}

#[derive(Debug)]
pub struct NewTask<'a> {
    pub task_id: &'a str,
    pub task_type: &'a str,
    pub novel_id: &'a str,
    pub chapter_id: Option<&'a str>,
    pub draft_id: Option<&'a str>,
    pub scope_type: &'a str,
    pub input_snapshot_id: &'a str,
    pub context_snapshot_id: &'a str,
    pub constraint_snapshot_id: &'a str,
    pub trace_id: &'a str,
    pub operation_id: &'a str,
    pub request_hash_version: i64,
    pub request_hash: &'a str,
    pub expected_artifact_type: &'a str,
    pub expected_artifact_schema_version: i64,
    pub target_hint_json: Option<&'a str>,
    pub now: &'a str,
}

fn json_value(raw: Option<String>, column: usize) -> rusqlite::Result<Option<Value>> {
    raw.map(|value| {
        serde_json::from_str(&value).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                column,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })
    })
    .transpose()
}

fn required_json(raw: String, column: usize) -> rusqlite::Result<Value> {
    json_value(Some(raw), column)?.ok_or(rusqlite::Error::InvalidColumnIndex(column))
}

fn map_task(row: &Row<'_>) -> rusqlite::Result<AiTaskRecord> {
    Ok(AiTaskRecord {
        task_id: row.get(0)?,
        task_type: row.get(1)?,
        novel_id: row.get(2)?,
        chapter_id: row.get(3)?,
        draft_id: row.get(4)?,
        scope_type: row.get(5)?,
        status: row.get(6)?,
        state_revision: row.get(7)?,
        input_snapshot_id: row.get(8)?,
        context_snapshot_id: row.get(9)?,
        constraint_snapshot_id: row.get(10)?,
        current_attempt_id: row.get(11)?,
        result_artifact_id: row.get(12)?,
        trace_id: row.get(13)?,
        operation_id: row.get(14)?,
        request_hash_version: row.get(15)?,
        request_hash: row.get(16)?,
        expected_artifact_type: row.get(17)?,
        expected_artifact_schema_version: row.get(18)?,
        target_hint_json: json_value(row.get(19)?, 19)?,
        error_json: json_value(row.get(20)?, 20)?,
        created_at: row.get(21)?,
        updated_at: row.get(22)?,
        started_at: row.get(23)?,
        completed_at: row.get(24)?,
        applied_at: row.get(25)?,
    })
}

const TASK_SELECT: &str = "SELECT task_id, task_type, novel_id, chapter_id, draft_id,
    scope_type, status, state_revision, input_snapshot_id, context_snapshot_id,
    constraint_snapshot_id, current_attempt_id, result_artifact_id, trace_id,
    operation_id, request_hash_version, request_hash, expected_artifact_type,
    expected_artifact_schema_version, target_hint_json, error_json, created_at, updated_at,
    started_at, completed_at, applied_at FROM ai_tasks";

pub fn find_task(connection: &Connection, task_id: &str) -> Result<Option<AiTaskRecord>, AppError> {
    connection
        .query_row(
            &format!("{TASK_SELECT} WHERE task_id = ?1"),
            params![task_id],
            map_task,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn find_task_by_operation(
    connection: &Connection,
    operation_id: &str,
) -> Result<Option<AiTaskRecord>, AppError> {
    connection
        .query_row(
            &format!("{TASK_SELECT} WHERE operation_id = ?1"),
            params![operation_id],
            map_task,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn list_tasks(
    connection: &Connection,
    novel_id: Option<&str>,
    limit: i64,
) -> Result<Vec<AiTaskRecord>, AppError> {
    let sql = if novel_id.is_some() {
        format!("{TASK_SELECT} WHERE novel_id = ?1 ORDER BY created_at DESC, task_id DESC LIMIT ?2")
    } else {
        format!("{TASK_SELECT} ORDER BY created_at DESC, task_id DESC LIMIT ?2")
    };
    let mut statement = connection.prepare(&sql).map_err(AppError::database)?;
    let rows = if let Some(novel_id) = novel_id {
        statement.query_map(params![novel_id, limit], map_task)
    } else {
        statement.query_map(params![rusqlite::types::Null, limit], map_task)
    }
    .map_err(AppError::database)?
    .collect::<Result<Vec<_>, _>>()
    .map_err(AppError::database)?;
    Ok(rows)
}

pub fn insert_task(connection: &Connection, task: &NewTask<'_>) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO ai_tasks
                (task_id, task_type, novel_id, chapter_id, draft_id, scope_type, status,
                 state_revision, input_snapshot_id, context_snapshot_id, constraint_snapshot_id,
                 trace_id, operation_id, request_hash_version, request_hash,
                 expected_artifact_type, expected_artifact_schema_version,
                 target_hint_json, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,'ready',0,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?17)",
            params![
                task.task_id,
                task.task_type,
                task.novel_id,
                task.chapter_id,
                task.draft_id,
                task.scope_type,
                task.input_snapshot_id,
                task.context_snapshot_id,
                task.constraint_snapshot_id,
                task.trace_id,
                task.operation_id,
                task.request_hash_version,
                task.request_hash,
                task.expected_artifact_type,
                task.expected_artifact_schema_version,
                task.target_hint_json,
                task.now,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn insert_input_snapshot(
    connection: &Connection,
    snapshot_id: &str,
    task_id: &str,
    schema_version: i64,
    input_type: &str,
    payload_json: &str,
    body_ref_id: &str,
    source_draft_id: Option<&str>,
    source_draft_version: Option<i64>,
    base_content_hash: Option<&str>,
    content_hash: &str,
    now: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO ai_input_snapshots
            (snapshot_id, task_id, schema_version, input_type, payload_json, body_ref_id,
             source_draft_id, source_draft_version, base_content_hash, content_hash, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                snapshot_id,
                task_id,
                schema_version,
                input_type,
                payload_json,
                body_ref_id,
                source_draft_id,
                source_draft_version,
                base_content_hash,
                content_hash,
                now
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn insert_context_snapshot(
    connection: &Connection,
    snapshot_id: &str,
    task_id: &str,
    schema_version: i64,
    source_manifest_json: &str,
    compiled_context_ref_id: &str,
    budget_json: &str,
    compiler_version: &str,
    content_hash: &str,
    now: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO ai_context_snapshots
            (snapshot_id, task_id, schema_version, source_manifest_json,
             compiled_context_ref_id, budget_json, compiler_version, content_hash, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                snapshot_id,
                task_id,
                schema_version,
                source_manifest_json,
                compiled_context_ref_id,
                budget_json,
                compiler_version,
                content_hash,
                now
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn insert_constraint_snapshot(
    connection: &Connection,
    snapshot_id: &str,
    task_id: &str,
    schema_version: i64,
    payload_json: &str,
    prompt_template_id: &str,
    prompt_template_version: &str,
    prompt_template_hash: &str,
    prompt_template_ref_id: &str,
    provider_options_json: &str,
    content_hash: &str,
    now: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO ai_constraint_snapshots
            (snapshot_id, task_id, schema_version, payload_json, prompt_template_id,
             prompt_template_version, prompt_template_hash, prompt_template_ref_id,
             provider_options_json, content_hash, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                snapshot_id,
                task_id,
                schema_version,
                payload_json,
                prompt_template_id,
                prompt_template_version,
                prompt_template_hash,
                prompt_template_ref_id,
                provider_options_json,
                content_hash,
                now
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

pub fn find_input_snapshot(
    connection: &Connection,
    task_id: &str,
) -> Result<Option<AiInputSnapshotRecord>, AppError> {
    connection
        .query_row(
            "SELECT snapshot_id, task_id, schema_version, input_type, payload_json, body_ref_id,
                source_draft_id, source_draft_version, base_content_hash, content_hash, created_at
         FROM ai_input_snapshots WHERE task_id = ?1",
            params![task_id],
            |row| {
                Ok(AiInputSnapshotRecord {
                    snapshot_id: row.get(0)?,
                    task_id: row.get(1)?,
                    schema_version: row.get(2)?,
                    input_type: row.get(3)?,
                    payload_json: required_json(row.get(4)?, 4)?,
                    body_ref_id: row.get(5)?,
                    source_draft_id: row.get(6)?,
                    source_draft_version: row.get(7)?,
                    base_content_hash: row.get(8)?,
                    content_hash: row.get(9)?,
                    created_at: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(AppError::database)
}

pub fn find_context_snapshot(
    connection: &Connection,
    task_id: &str,
) -> Result<Option<AiContextSnapshotRecord>, AppError> {
    connection
        .query_row(
            "SELECT snapshot_id, task_id, schema_version, source_manifest_json,
                compiled_context_ref_id, budget_json, compiler_version, content_hash, created_at
         FROM ai_context_snapshots WHERE task_id = ?1",
            params![task_id],
            |row| {
                Ok(AiContextSnapshotRecord {
                    snapshot_id: row.get(0)?,
                    task_id: row.get(1)?,
                    schema_version: row.get(2)?,
                    source_manifest_json: required_json(row.get(3)?, 3)?,
                    compiled_context_ref_id: row.get(4)?,
                    budget_json: required_json(row.get(5)?, 5)?,
                    compiler_version: row.get(6)?,
                    content_hash: row.get(7)?,
                    created_at: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(AppError::database)
}

pub fn find_constraint_snapshot(
    connection: &Connection,
    task_id: &str,
) -> Result<Option<AiConstraintSnapshotRecord>, AppError> {
    connection
        .query_row(
            "SELECT snapshot_id, task_id, schema_version, payload_json, prompt_template_id,
                prompt_template_version, prompt_template_hash, prompt_template_ref_id,
                provider_options_json, content_hash, created_at
         FROM ai_constraint_snapshots WHERE task_id = ?1",
            params![task_id],
            |row| {
                Ok(AiConstraintSnapshotRecord {
                    snapshot_id: row.get(0)?,
                    task_id: row.get(1)?,
                    schema_version: row.get(2)?,
                    payload_json: required_json(row.get(3)?, 3)?,
                    prompt_template_id: row.get(4)?,
                    prompt_template_version: row.get(5)?,
                    prompt_template_hash: row.get(6)?,
                    prompt_template_ref_id: row.get(7)?,
                    provider_options_json: required_json(row.get(8)?, 8)?,
                    content_hash: row.get(9)?,
                    created_at: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(AppError::database)
}

fn map_attempt(row: &Row<'_>) -> rusqlite::Result<AiTaskAttemptRecord> {
    Ok(AiTaskAttemptRecord {
        attempt_id: row.get(0)?,
        task_id: row.get(1)?,
        attempt_number: row.get(2)?,
        provider_id: row.get(3)?,
        model_id: row.get(4)?,
        provider_request_id: row.get(5)?,
        status: row.get(6)?,
        state_revision: row.get(7)?,
        response_metadata_json: json_value(row.get(8)?, 8)?,
        error_json: json_value(row.get(9)?, 9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        started_at: row.get(12)?,
        finished_at: row.get(13)?,
    })
}

const ATTEMPT_SELECT: &str = "SELECT attempt_id, task_id, attempt_number, provider_id,
    model_id, provider_request_id, status, state_revision, response_metadata_json,
    error_json, created_at, updated_at, started_at, finished_at FROM ai_task_attempts";

pub fn find_attempt(
    connection: &Connection,
    task_id: &str,
    attempt_id: &str,
) -> Result<Option<AiTaskAttemptRecord>, AppError> {
    connection
        .query_row(
            &format!("{ATTEMPT_SELECT} WHERE task_id = ?1 AND attempt_id = ?2"),
            params![task_id, attempt_id],
            map_attempt,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn list_attempts(
    connection: &Connection,
    task_id: &str,
) -> Result<Vec<AiTaskAttemptRecord>, AppError> {
    let mut statement = connection
        .prepare(&format!(
            "{ATTEMPT_SELECT} WHERE task_id = ?1 ORDER BY attempt_number ASC"
        ))
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![task_id], map_attempt)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}

pub fn next_attempt_number(connection: &Connection, task_id: &str) -> Result<i64, AppError> {
    connection
        .query_row(
            "SELECT COALESCE(MAX(attempt_number), 0) + 1 FROM ai_task_attempts WHERE task_id = ?1",
            params![task_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)
}

pub fn insert_queued_attempt(
    connection: &Connection,
    task: &AiTaskRecord,
    attempt_id: &str,
    attempt_number: i64,
    now: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO ai_task_attempts
            (attempt_id, task_id, attempt_number, status, state_revision, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'queued', 0, ?4, ?4)",
            params![attempt_id, task.task_id, attempt_number, now],
        )
        .map_err(AppError::database)?;
    let affected = connection
        .execute(
            "UPDATE ai_tasks SET status = 'queued', current_attempt_id = ?1,
                state_revision = state_revision + 1, updated_at = ?2, error_json = NULL
         WHERE task_id = ?3 AND status = ?4 AND state_revision = ?5",
            params![
                attempt_id,
                now,
                task.task_id,
                task.status,
                task.state_revision
            ],
        )
        .map_err(AppError::database)?;
    ensure_cas(affected, &task.task_id, &task.status, "queued")
}

#[allow(clippy::too_many_arguments)]
pub fn claim_attempt(
    connection: &Connection,
    task: &AiTaskRecord,
    attempt: &AiTaskAttemptRecord,
    provider_id: &str,
    model_id: &str,
    provider_request_id: Option<&str>,
    now: &str,
) -> Result<(), AppError> {
    let affected = connection
        .execute(
            "UPDATE ai_task_attempts SET status = 'running', provider_id = ?1, model_id = ?2,
                provider_request_id = ?3, state_revision = state_revision + 1,
                updated_at = ?4, started_at = ?4
         WHERE task_id = ?5 AND attempt_id = ?6 AND status = 'queued' AND state_revision = ?7",
            params![
                provider_id,
                model_id,
                provider_request_id,
                now,
                task.task_id,
                attempt.attempt_id,
                attempt.state_revision
            ],
        )
        .map_err(AppError::database)?;
    ensure_attempt_cas(affected)?;
    let affected = connection
        .execute(
            "UPDATE ai_tasks SET status = 'running', state_revision = state_revision + 1,
                updated_at = ?1, started_at = COALESCE(started_at, ?1)
         WHERE task_id = ?2 AND current_attempt_id = ?3 AND status = 'queued'
               AND state_revision = ?4",
            params![now, task.task_id, attempt.attempt_id, task.state_revision],
        )
        .map_err(AppError::database)?;
    ensure_cas(affected, &task.task_id, "queued", "running")
}

pub fn cas_attempt_status(
    connection: &Connection,
    task_id: &str,
    attempt_id: &str,
    expected_status: &str,
    expected_revision: i64,
    next_status: &str,
    metadata_json: Option<&str>,
    error_json: Option<&str>,
    now: &str,
) -> Result<(), AppError> {
    let affected = connection.execute(
        "UPDATE ai_task_attempts SET status = ?1,
                response_metadata_json = COALESCE(?2, response_metadata_json),
                error_json = COALESCE(?3, error_json), state_revision = state_revision + 1,
                updated_at = ?4,
                finished_at = CASE WHEN ?1 IN ('succeeded','failed','cancelled','late_response_ignored')
                                   THEN ?4 ELSE finished_at END
         WHERE task_id = ?5 AND attempt_id = ?6 AND status = ?7 AND state_revision = ?8",
        params![next_status, metadata_json, error_json, now, task_id, attempt_id,
            expected_status, expected_revision],
    ).map_err(AppError::database)?;
    ensure_attempt_cas(affected)
}

pub fn cas_task_status(
    connection: &Connection,
    task: &AiTaskRecord,
    next_status: &str,
    error_json: Option<&str>,
    now: &str,
) -> Result<(), AppError> {
    let affected = connection.execute(
        "UPDATE ai_tasks SET status = ?1, state_revision = state_revision + 1,
                updated_at = ?2, error_json = ?3,
                completed_at = CASE WHEN ?1 IN ('completed','failed','cancelled') THEN ?2 ELSE completed_at END
         WHERE task_id = ?4 AND status = ?5 AND state_revision = ?6",
        params![next_status, now, error_json, task.task_id, task.status, task.state_revision],
    ).map_err(AppError::database)?;
    ensure_cas(affected, &task.task_id, &task.status, next_status)
}

pub fn finish_task_with_artifact(
    connection: &Connection,
    task: &AiTaskRecord,
    attempt_id: &str,
    artifact_id: &str,
    next_status: &str,
    error_json: Option<&str>,
    now: &str,
) -> Result<(), AppError> {
    let affected = connection
        .execute(
            "UPDATE ai_tasks SET status = ?1, result_artifact_id = ?2,
                state_revision = state_revision + 1, updated_at = ?3,
                completed_at = ?3, error_json = ?4
         WHERE task_id = ?5 AND status = 'validating' AND state_revision = ?6
               AND current_attempt_id = ?7",
            params![
                next_status,
                artifact_id,
                now,
                error_json,
                task.task_id,
                task.state_revision,
                attempt_id
            ],
        )
        .map_err(AppError::database)?;
    ensure_cas(affected, &task.task_id, "validating", next_status)
}

fn ensure_cas(affected: usize, task_id: &str, expected: &str, next: &str) -> Result<(), AppError> {
    if affected == 1 {
        return Ok(());
    }
    Err(AppError::new(
        codes::AI_TASK_CONCURRENT_UPDATE,
        "AI Task 已由另一执行流程更新",
        true,
    )
    .with_details(serde_json::json!({
        "taskId": task_id,
        "expectedStatus": expected,
        "nextStatus": next,
    })))
}

fn ensure_attempt_cas(affected: usize) -> Result<(), AppError> {
    if affected == 1 {
        Ok(())
    } else {
        Err(AppError::new(
            codes::AI_TASK_CONCURRENT_UPDATE,
            "AI Attempt 已由另一执行流程更新",
            true,
        ))
    }
}
