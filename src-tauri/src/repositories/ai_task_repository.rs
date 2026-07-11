use crate::errors::{codes, AppError};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskRecord {
    pub task_id: String,
    pub task_type: String,
    pub novel_id: String,
    pub chapter_id: Option<String>,
    pub draft_id: Option<String>,
    pub scope_type: String,
    pub status: String,
    pub input_snapshot_id: Option<String>,
    pub context_snapshot_id: Option<String>,
    pub constraint_snapshot_id: Option<String>,
    pub current_attempt_id: Option<String>,
    pub result_artifact_id: Option<String>,
    pub trace_id: String,
    pub operation_id: String,
    pub request_hash: String,
    pub error_json: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

fn map_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiTaskRecord> {
    Ok(AiTaskRecord {
        task_id: row.get(0)?,
        task_type: row.get(1)?,
        novel_id: row.get(2)?,
        chapter_id: row.get(3)?,
        draft_id: row.get(4)?,
        scope_type: row.get(5)?,
        status: row.get(6)?,
        input_snapshot_id: row.get(7)?,
        context_snapshot_id: row.get(8)?,
        constraint_snapshot_id: row.get(9)?,
        current_attempt_id: row.get(10)?,
        result_artifact_id: row.get(11)?,
        trace_id: row.get(12)?,
        operation_id: row.get(13)?,
        request_hash: row.get(14)?,
        error_json: row.get(15)?,
        created_at: row.get(16)?,
        started_at: row.get(17)?,
        completed_at: row.get(18)?,
    })
}

const TASK_SELECT: &str = "SELECT task_id, task_type, novel_id, chapter_id, draft_id, scope_type,
    status, input_snapshot_id, context_snapshot_id, constraint_snapshot_id, current_attempt_id,
    result_artifact_id, trace_id, operation_id, request_hash, error_json, created_at, started_at,
    completed_at FROM ai_tasks";

pub fn find(connection: &Connection, task_id: &str) -> Result<Option<AiTaskRecord>, AppError> {
    connection
        .query_row(
            &format!("{TASK_SELECT} WHERE task_id = ?1"),
            params![task_id],
            map_task,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn find_by_operation(
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

#[allow(clippy::too_many_arguments)]
pub fn insert(
    connection: &Connection,
    task_id: &str,
    task_type: &str,
    novel_id: &str,
    chapter_id: Option<&str>,
    draft_id: Option<&str>,
    scope_type: &str,
    trace_id: &str,
    operation_id: &str,
    request_hash: &str,
    target_hint_json: Option<&str>,
    created_at: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO ai_tasks
                (task_id, task_type, novel_id, chapter_id, draft_id, scope_type, status,
                 trace_id, operation_id, request_hash, target_hint_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'created', ?7, ?8, ?9, ?10, ?11)",
            params![
                task_id,
                task_type,
                novel_id,
                chapter_id,
                draft_id,
                scope_type,
                trace_id,
                operation_id,
                request_hash,
                target_hint_json,
                created_at,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

pub fn cas_status(
    connection: &Connection,
    task_id: &str,
    expected: &str,
    next: &str,
    now: &str,
) -> Result<(), AppError> {
    let affected = connection
        .execute(
            "UPDATE ai_tasks SET status = ?1,
                started_at = CASE WHEN ?1 = 'running' AND started_at IS NULL THEN ?2 ELSE started_at END,
                completed_at = CASE WHEN ?1 = 'completed' THEN ?2 ELSE completed_at END
             WHERE task_id = ?3 AND status = ?4",
            params![next, now, task_id, expected],
        )
        .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::AI_TASK_CONCURRENT_UPDATE,
            "AI Task 状态已被其他执行者更新",
            true,
        )
        .with_details(serde_json::json!({
            "taskId": task_id,
            "expectedStatus": expected,
            "nextStatus": next,
        })));
    }
    Ok(())
}

pub fn link_snapshots(
    connection: &Connection,
    task_id: &str,
    input_snapshot_id: &str,
    context_snapshot_id: &str,
    constraint_snapshot_id: &str,
) -> Result<(), AppError> {
    let affected = connection
        .execute(
            "UPDATE ai_tasks SET input_snapshot_id = ?1, context_snapshot_id = ?2,
                constraint_snapshot_id = ?3 WHERE task_id = ?4",
            params![
                input_snapshot_id,
                context_snapshot_id,
                constraint_snapshot_id,
                task_id
            ],
        )
        .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::AI_TASK_NOT_FOUND,
            "AI Task 不存在",
            false,
        ));
    }
    Ok(())
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

pub fn insert_attempt(
    connection: &Connection,
    attempt_id: &str,
    task_id: &str,
    attempt_number: i64,
    provider_id: Option<&str>,
    started_at: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO ai_task_attempts
                (attempt_id, task_id, attempt_number, provider_id, status, started_at)
             VALUES (?1, ?2, ?3, ?4, 'running', ?5)",
            params![attempt_id, task_id, attempt_number, provider_id, started_at],
        )
        .map_err(AppError::database)?;
    connection
        .execute(
            "UPDATE ai_tasks SET current_attempt_id = ?1 WHERE task_id = ?2",
            params![attempt_id, task_id],
        )
        .map_err(AppError::database)?;
    Ok(())
}

pub fn set_attempt_status(
    connection: &Connection,
    attempt_id: &str,
    expected: &[&str],
    next: &str,
    metadata_json: Option<&str>,
    error_json: Option<&str>,
    finished_at: &str,
) -> Result<(), AppError> {
    let placeholders = std::iter::repeat("?")
        .take(expected.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "UPDATE ai_task_attempts SET status = ?1, response_metadata_json = COALESCE(?2, response_metadata_json),
         error_json = COALESCE(?3, error_json), finished_at = ?4
         WHERE attempt_id = ?5 AND status IN ({placeholders})"
    );
    let mut values: Vec<rusqlite::types::Value> = vec![
        next.to_owned().into(),
        metadata_json.map(str::to_owned).into(),
        error_json.map(str::to_owned).into(),
        finished_at.to_owned().into(),
        attempt_id.to_owned().into(),
    ];
    values.extend(expected.iter().map(|value| (*value).to_owned().into()));
    let affected = connection
        .execute(&sql, rusqlite::params_from_iter(values))
        .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::AI_TASK_CONCURRENT_UPDATE,
            "AI Attempt 状态已变化",
            true,
        ));
    }
    Ok(())
}

pub fn set_task_error(
    connection: &Connection,
    task_id: &str,
    error_json: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "UPDATE ai_tasks SET error_json = ?1 WHERE task_id = ?2",
            params![error_json, task_id],
        )
        .map_err(AppError::database)?;
    Ok(())
}

pub fn link_artifact(
    connection: &Connection,
    task_id: &str,
    artifact_id: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "UPDATE ai_tasks SET result_artifact_id = ?1 WHERE task_id = ?2",
            params![artifact_id, task_id],
        )
        .map_err(AppError::database)?;
    Ok(())
}
