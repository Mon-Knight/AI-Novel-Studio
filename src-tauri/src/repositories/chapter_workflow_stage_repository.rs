use crate::errors::AppError;
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

pub(crate) const STAGE_KINDS: &[&str] = &[
    "scene_plan",
    "beat_plan",
    "beat_write",
    "beat_state",
    "scene_close",
    "chapter_assemble",
];
pub(crate) const STAGE_STATUSES: &[&str] =
    &["pending", "running", "succeeded", "failed", "cancelled"];
pub(crate) const INTERRUPTED_ERROR_CODE: &str = "WORKFLOW_INTERRUPTED";
const MAX_ERROR_CODE_LENGTH: usize = 128;
const MAX_RESULT_JSON_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChapterWorkflowStageRecord {
    pub stage_id: String,
    pub workflow_id: String,
    pub conversation_id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub run_id: String,
    pub stage_key: String,
    pub stage_kind: String,
    pub scene_id: Option<String>,
    pub beat_id: Option<String>,
    pub plan_version: i64,
    pub model_snapshot_hash: String,
    pub context_hash: String,
    pub base_hash: String,
    pub input_hash: String,
    pub plan_hash: String,
    pub status: String,
    pub attempt: i64,
    pub revision: i64,
    pub result_hash: Option<String>,
    pub result_document_id: Option<String>,
    pub result_json: Option<String>,
    pub verified_artifact_id: Option<String>,
    pub error_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub(crate) struct NewChapterWorkflowStageRow<'a> {
    pub stage_id: &'a str,
    pub workflow_id: &'a str,
    pub conversation_id: &'a str,
    pub novel_id: &'a str,
    pub chapter_id: &'a str,
    pub run_id: &'a str,
    pub stage_key: &'a str,
    pub stage_kind: &'a str,
    pub scene_id: Option<&'a str>,
    pub beat_id: Option<&'a str>,
    pub plan_version: i64,
    pub model_snapshot_hash: &'a str,
    pub context_hash: &'a str,
    pub base_hash: &'a str,
    pub input_hash: &'a str,
    pub plan_hash: &'a str,
    pub attempt: i64,
    pub created_at: &'a str,
    pub updated_at: &'a str,
}

#[derive(Debug, Default, Clone)]
pub(crate) struct ChapterWorkflowStageQuery {
    pub novel_id: String,
    pub chapter_id: String,
    pub conversation_id: Option<String>,
    pub workflow_id: Option<String>,
    pub run_id: Option<String>,
    pub stage_key: Option<String>,
    pub stage_kinds: Vec<String>,
    pub statuses: Vec<String>,
    pub limit: i64,
}

pub(crate) fn supported_stage_kind(value: &str) -> bool {
    STAGE_KINDS.contains(&value)
}

pub(crate) fn supported_stage_status(value: &str) -> bool {
    STAGE_STATUSES.contains(&value)
}

pub(crate) fn valid_result_json_size(value: &str) -> bool {
    value.len() <= MAX_RESULT_JSON_BYTES
}

pub(crate) fn max_error_code_length() -> usize {
    MAX_ERROR_CODE_LENGTH
}

fn map_stage(row: &Row<'_>) -> rusqlite::Result<ChapterWorkflowStageRecord> {
    Ok(ChapterWorkflowStageRecord {
        stage_id: row.get(0)?,
        workflow_id: row.get(1)?,
        conversation_id: row.get(2)?,
        novel_id: row.get(3)?,
        chapter_id: row.get(4)?,
        run_id: row.get(5)?,
        stage_key: row.get(6)?,
        stage_kind: row.get(7)?,
        scene_id: row.get(8)?,
        beat_id: row.get(9)?,
        plan_version: row.get(10)?,
        model_snapshot_hash: row.get(11)?,
        context_hash: row.get(12)?,
        base_hash: row.get(13)?,
        input_hash: row.get(14)?,
        plan_hash: row.get(15)?,
        status: row.get(16)?,
        attempt: row.get(17)?,
        revision: row.get(18)?,
        result_hash: row.get(19)?,
        result_document_id: row.get(20)?,
        result_json: row.get(21)?,
        verified_artifact_id: row.get(22)?,
        error_code: row.get(23)?,
        created_at: row.get(24)?,
        updated_at: row.get(25)?,
    })
}

const SELECT_STAGE: &str = "SELECT stage_id, workflow_id, conversation_id, novel_id, chapter_id,
    run_id, stage_key, stage_kind, scene_id, beat_id, plan_version, model_snapshot_hash,
    context_hash, base_hash, input_hash, plan_hash, status, attempt, revision, result_hash,
    result_document_id, result_json, verified_artifact_id, error_code, created_at, updated_at
    FROM chapter_workflow_stages";

pub(crate) fn find_stage(
    connection: &Connection,
    stage_id: &str,
) -> Result<Option<ChapterWorkflowStageRecord>, AppError> {
    connection
        .query_row(
            &format!("{SELECT_STAGE} WHERE stage_id = ?1"),
            params![stage_id],
            map_stage,
        )
        .optional()
        .map_err(AppError::database)
}

pub(crate) fn next_attempt(
    connection: &Connection,
    workflow_id: &str,
    stage_key: &str,
) -> Result<i64, AppError> {
    connection
        .query_row(
            "SELECT COALESCE(MAX(attempt), 0) + 1
             FROM chapter_workflow_stages
             WHERE workflow_id = ?1 AND stage_key = ?2",
            params![workflow_id, stage_key],
            |row| row.get::<_, i64>(0),
        )
        .map_err(AppError::database)
}

pub(crate) fn insert_pending_stage(
    connection: &Connection,
    row: &NewChapterWorkflowStageRow<'_>,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO chapter_workflow_stages (
                stage_id, workflow_id, conversation_id, novel_id, chapter_id, run_id,
                stage_key, stage_kind, scene_id, beat_id, plan_version, model_snapshot_hash,
                context_hash, base_hash, input_hash, plan_hash, attempt, status, revision,
                result_hash, result_document_id, result_json, verified_artifact_id, error_code,
                created_at, updated_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                ?17, 'pending', 1, NULL, NULL, NULL, NULL, NULL, ?18, ?19
             )",
            params![
                row.stage_id,
                row.workflow_id,
                row.conversation_id,
                row.novel_id,
                row.chapter_id,
                row.run_id,
                row.stage_key,
                row.stage_kind,
                row.scene_id,
                row.beat_id,
                row.plan_version,
                row.model_snapshot_hash,
                row.context_hash,
                row.base_hash,
                row.input_hash,
                row.plan_hash,
                row.attempt,
                row.created_at,
                row.updated_at,
            ],
        )
        .map_err(AppError::database)
        .map(|_| ())
}

pub(crate) fn begin_stage(
    connection: &Connection,
    stage_id: &str,
    expected_revision: i64,
    updated_at: &str,
) -> Result<usize, AppError> {
    connection
        .execute(
            "UPDATE chapter_workflow_stages
             SET status = 'running', revision = revision + 1, updated_at = ?3
             WHERE stage_id = ?1 AND status = 'pending' AND revision = ?2",
            params![stage_id, expected_revision, updated_at],
        )
        .map_err(AppError::database)
}

pub(crate) fn complete_stage(
    connection: &Connection,
    stage_id: &str,
    expected_revision: i64,
    result_hash: &str,
    result_document_id: Option<&str>,
    result_json: Option<&str>,
    verified_artifact_id: Option<&str>,
    updated_at: &str,
) -> Result<usize, AppError> {
    connection
        .execute(
            "UPDATE chapter_workflow_stages
             SET status = 'succeeded', revision = revision + 1, result_hash = ?3,
                 result_document_id = ?4, result_json = ?5, verified_artifact_id = ?6,
                 error_code = NULL, updated_at = ?7
             WHERE stage_id = ?1 AND status = 'running' AND revision = ?2
               AND result_hash IS NULL AND result_document_id IS NULL
               AND result_json IS NULL AND verified_artifact_id IS NULL
               AND error_code IS NULL",
            params![
                stage_id,
                expected_revision,
                result_hash,
                result_document_id,
                result_json,
                verified_artifact_id,
                updated_at,
            ],
        )
        .map_err(AppError::database)
}

pub(crate) fn fail_stage(
    connection: &Connection,
    stage_id: &str,
    expected_revision: i64,
    error_code: &str,
    updated_at: &str,
) -> Result<usize, AppError> {
    connection
        .execute(
            "UPDATE chapter_workflow_stages
             SET status = 'failed', revision = revision + 1, error_code = ?3, updated_at = ?4
             WHERE stage_id = ?1 AND status = 'running' AND revision = ?2
               AND result_hash IS NULL AND result_document_id IS NULL
               AND result_json IS NULL AND verified_artifact_id IS NULL",
            params![stage_id, expected_revision, error_code, updated_at],
        )
        .map_err(AppError::database)
}

pub(crate) fn cancel_stage(
    connection: &Connection,
    stage_id: &str,
    expected_revision: Option<i64>,
    updated_at: &str,
) -> Result<usize, AppError> {
    connection
        .execute(
            "UPDATE chapter_workflow_stages
             SET status = 'cancelled', revision = revision + 1, updated_at = ?3
             WHERE stage_id = ?1
               AND status IN ('pending', 'running')
               AND (?2 IS NULL OR revision = ?2)
               AND result_hash IS NULL AND result_document_id IS NULL
               AND result_json IS NULL AND verified_artifact_id IS NULL
               AND error_code IS NULL",
            params![stage_id, expected_revision, updated_at],
        )
        .map_err(AppError::database)
}

pub(crate) fn cancel_active_stages_for_run(
    connection: &Connection,
    run_id: &str,
    updated_at: &str,
) -> Result<usize, AppError> {
    connection
        .execute(
            "UPDATE chapter_workflow_stages
             SET status = 'cancelled', revision = revision + 1, updated_at = ?2
             WHERE run_id = ?1 AND status IN ('pending', 'running')",
            params![run_id, updated_at],
        )
        .map_err(AppError::database)
}

pub(crate) fn recover_running_stages(
    connection: &Connection,
    updated_at: &str,
) -> Result<usize, AppError> {
    connection
        .execute(
            "UPDATE chapter_workflow_stages
             SET status = 'failed', revision = revision + 1, error_code = ?1, updated_at = ?2
             WHERE status = 'running'",
            params![INTERRUPTED_ERROR_CODE, updated_at],
        )
        .map_err(AppError::database)
}

pub(crate) fn list_stages(
    connection: &Connection,
    query: &ChapterWorkflowStageQuery,
) -> Result<Vec<ChapterWorkflowStageRecord>, AppError> {
    let mut sql = format!("{SELECT_STAGE} WHERE novel_id = ?1 AND chapter_id = ?2");
    let mut values: Vec<Value> = vec![
        Value::Text(query.novel_id.clone()),
        Value::Text(query.chapter_id.clone()),
    ];
    let bind = |sql: &mut String, values: &mut Vec<Value>, clause: &str, value: String| {
        values.push(Value::Text(value));
        sql.push_str(&format!(" AND {clause} = ?{}", values.len()));
    };
    if let Some(value) = query.conversation_id.as_ref() {
        bind(&mut sql, &mut values, "conversation_id", value.clone());
    }
    if let Some(value) = query.workflow_id.as_ref() {
        bind(&mut sql, &mut values, "workflow_id", value.clone());
    }
    if let Some(value) = query.run_id.as_ref() {
        bind(&mut sql, &mut values, "run_id", value.clone());
    }
    if let Some(value) = query.stage_key.as_ref() {
        bind(&mut sql, &mut values, "stage_key", value.clone());
    }
    if !query.stage_kinds.is_empty() {
        let placeholders = (0..query.stage_kinds.len())
            .map(|index| format!("?{}", values.len() + index + 1))
            .collect::<Vec<_>>();
        sql.push_str(&format!(" AND stage_kind IN ({})", placeholders.join(", ")));
        values.extend(query.stage_kinds.iter().cloned().map(Value::Text));
    }
    if !query.statuses.is_empty() {
        let placeholders = (0..query.statuses.len())
            .map(|index| format!("?{}", values.len() + index + 1))
            .collect::<Vec<_>>();
        sql.push_str(&format!(" AND status IN ({})", placeholders.join(", ")));
        values.extend(query.statuses.iter().cloned().map(Value::Text));
    }
    values.push(Value::Integer(query.limit));
    sql.push_str(&format!(
        " ORDER BY created_at DESC, stage_id DESC LIMIT ?{}",
        values.len()
    ));
    let mut statement = connection.prepare(&sql).map_err(AppError::database)?;
    let rows = statement
        .query_map(params_from_iter(values), map_stage)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}
