use crate::errors::AppError;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResultArtifactRecord {
    pub artifact_id: String,
    pub task_id: String,
    pub attempt_id: String,
    pub source_input_snapshot_id: String,
    pub artifact_type: String,
    pub schema_version: i64,
    pub raw_content_ref_id: String,
    pub display_content_ref_id: Option<String>,
    pub display_content_hash: Option<String>,
    pub structured_payload_ref_id: Option<String>,
    pub structured_payload_hash: Option<String>,
    pub source_novel_id: String,
    pub source_chapter_id: Option<String>,
    pub source_draft_id: Option<String>,
    pub source_draft_version: Option<i64>,
    pub source_base_content_hash: Option<String>,
    pub content_hash: String,
    pub content_length: i64,
    pub processing_status: String,
    pub parent_artifact_id: Option<String>,
    pub derivation_type: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactValidationIssueRecord {
    pub issue_id: String,
    pub artifact_id: String,
    pub validation_run_id: String,
    pub issue_index: i64,
    pub severity: String,
    pub code: String,
    pub message: String,
    pub json_path: Option<String>,
    pub details_json: Option<Value>,
    pub validator_version: String,
    pub created_at: String,
}

#[derive(Debug)]
pub struct NewArtifact<'a> {
    pub artifact_id: &'a str,
    pub task_id: &'a str,
    pub attempt_id: &'a str,
    pub source_input_snapshot_id: &'a str,
    pub artifact_type: &'a str,
    pub schema_version: i64,
    pub raw_content_ref_id: &'a str,
    pub display_content_ref_id: Option<&'a str>,
    pub display_content_hash: Option<&'a str>,
    pub structured_payload_ref_id: Option<&'a str>,
    pub structured_payload_hash: Option<&'a str>,
    pub source_novel_id: &'a str,
    pub source_chapter_id: Option<&'a str>,
    pub source_draft_id: Option<&'a str>,
    pub source_draft_version: Option<i64>,
    pub source_base_content_hash: Option<&'a str>,
    pub content_hash: &'a str,
    pub content_length: i64,
    pub processing_status: &'a str,
    pub parent_artifact_id: Option<&'a str>,
    pub derivation_type: Option<&'a str>,
    pub created_at: &'a str,
}

fn map_artifact(row: &Row<'_>) -> rusqlite::Result<ResultArtifactRecord> {
    Ok(ResultArtifactRecord {
        artifact_id: row.get(0)?,
        task_id: row.get(1)?,
        attempt_id: row.get(2)?,
        source_input_snapshot_id: row.get(3)?,
        artifact_type: row.get(4)?,
        schema_version: row.get(5)?,
        raw_content_ref_id: row.get(6)?,
        display_content_ref_id: row.get(7)?,
        display_content_hash: row.get(8)?,
        structured_payload_ref_id: row.get(9)?,
        structured_payload_hash: row.get(10)?,
        source_novel_id: row.get(11)?,
        source_chapter_id: row.get(12)?,
        source_draft_id: row.get(13)?,
        source_draft_version: row.get(14)?,
        source_base_content_hash: row.get(15)?,
        content_hash: row.get(16)?,
        content_length: row.get(17)?,
        processing_status: row.get(18)?,
        parent_artifact_id: row.get(19)?,
        derivation_type: row.get(20)?,
        created_at: row.get(21)?,
    })
}

const ARTIFACT_SELECT: &str = "SELECT artifact_id, task_id, attempt_id,
    source_input_snapshot_id, artifact_type, schema_version, raw_content_ref_id,
    display_content_ref_id, display_content_hash, structured_payload_ref_id,
    structured_payload_hash, source_novel_id, source_chapter_id, source_draft_id,
    source_draft_version, source_base_content_hash, content_hash, content_length,
    processing_status, parent_artifact_id, derivation_type, created_at FROM result_artifacts";

pub fn insert_artifact(
    connection: &Connection,
    artifact: &NewArtifact<'_>,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO result_artifacts
            (artifact_id, task_id, attempt_id, source_input_snapshot_id, artifact_type,
             schema_version, raw_content_ref_id, display_content_ref_id, display_content_hash,
             structured_payload_ref_id, structured_payload_hash, source_novel_id,
             source_chapter_id, source_draft_id, source_draft_version,
             source_base_content_hash, content_hash, content_length, processing_status,
             parent_artifact_id, derivation_type, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
            params![
                artifact.artifact_id,
                artifact.task_id,
                artifact.attempt_id,
                artifact.source_input_snapshot_id,
                artifact.artifact_type,
                artifact.schema_version,
                artifact.raw_content_ref_id,
                artifact.display_content_ref_id,
                artifact.display_content_hash,
                artifact.structured_payload_ref_id,
                artifact.structured_payload_hash,
                artifact.source_novel_id,
                artifact.source_chapter_id,
                artifact.source_draft_id,
                artifact.source_draft_version,
                artifact.source_base_content_hash,
                artifact.content_hash,
                artifact.content_length,
                artifact.processing_status,
                artifact.parent_artifact_id,
                artifact.derivation_type,
                artifact.created_at,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

pub fn find_artifact(
    connection: &Connection,
    artifact_id: &str,
) -> Result<Option<ResultArtifactRecord>, AppError> {
    connection
        .query_row(
            &format!("{ARTIFACT_SELECT} WHERE artifact_id = ?1"),
            params![artifact_id],
            map_artifact,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn find_root_artifact_for_attempt(
    connection: &Connection,
    task_id: &str,
    attempt_id: &str,
) -> Result<Option<ResultArtifactRecord>, AppError> {
    connection
        .query_row(
            &format!(
                "{ARTIFACT_SELECT} WHERE task_id = ?1 AND attempt_id = ?2
                 AND parent_artifact_id IS NULL"
            ),
            params![task_id, attempt_id],
            map_artifact,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn list_artifacts_for_task(
    connection: &Connection,
    task_id: &str,
) -> Result<Vec<ResultArtifactRecord>, AppError> {
    let mut statement = connection
        .prepare(&format!(
            "{ARTIFACT_SELECT} WHERE task_id = ?1 ORDER BY created_at ASC, artifact_id ASC"
        ))
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![task_id], map_artifact)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}

#[allow(clippy::too_many_arguments)]
pub fn insert_issue(
    connection: &Connection,
    issue_id: &str,
    artifact_id: &str,
    validation_run_id: &str,
    issue_index: i64,
    severity: &str,
    code: &str,
    message: &str,
    json_path: Option<&str>,
    details_json: Option<&str>,
    validator_version: &str,
    created_at: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO artifact_validation_issues
            (issue_id, artifact_id, validation_run_id, issue_index, severity, code, message,
             json_path, details_json, validator_version, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                issue_id,
                artifact_id,
                validation_run_id,
                issue_index,
                severity,
                code,
                message,
                json_path,
                details_json,
                validator_version,
                created_at
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

fn map_issue(row: &Row<'_>) -> rusqlite::Result<ArtifactValidationIssueRecord> {
    let details: Option<String> = row.get(8)?;
    let details_json = details
        .map(|raw| {
            serde_json::from_str(&raw).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    8,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })
        })
        .transpose()?;
    Ok(ArtifactValidationIssueRecord {
        issue_id: row.get(0)?,
        artifact_id: row.get(1)?,
        validation_run_id: row.get(2)?,
        issue_index: row.get(3)?,
        severity: row.get(4)?,
        code: row.get(5)?,
        message: row.get(6)?,
        json_path: row.get(7)?,
        details_json,
        validator_version: row.get(9)?,
        created_at: row.get(10)?,
    })
}

const ISSUE_SELECT: &str = "SELECT issue_id, artifact_id, validation_run_id, issue_index, severity,
    code, message, json_path, details_json, validator_version, created_at
    FROM artifact_validation_issues";

pub fn list_issues_for_artifact(
    connection: &Connection,
    artifact_id: &str,
) -> Result<Vec<ArtifactValidationIssueRecord>, AppError> {
    let mut statement = connection.prepare(
        &format!("{ISSUE_SELECT} WHERE artifact_id = ?1 ORDER BY validation_run_id ASC, issue_index ASC, issue_id ASC"),
    ).map_err(AppError::database)?;
    let rows = statement
        .query_map(params![artifact_id], map_issue)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}
