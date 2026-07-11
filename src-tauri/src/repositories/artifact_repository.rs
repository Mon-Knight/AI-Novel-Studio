use crate::errors::AppError;
use rusqlite::{params, Connection};

#[allow(clippy::too_many_arguments)]
pub fn insert_artifact(
    connection: &Connection,
    artifact_id: &str,
    task_id: &str,
    attempt_id: &str,
    artifact_type: &str,
    schema_version: i64,
    raw_content_ref_id: &str,
    display_content_ref_id: Option<&str>,
    structured_payload_json: Option<&str>,
    source_novel_id: &str,
    source_chapter_id: Option<&str>,
    source_draft_id: Option<&str>,
    source_draft_version: Option<i64>,
    source_base_content_hash: Option<&str>,
    content_hash: &str,
    content_length: i64,
    processing_status: &str,
    parent_artifact_id: Option<&str>,
    derivation_type: Option<&str>,
    created_at: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO result_artifacts
                (artifact_id, task_id, attempt_id, artifact_type, schema_version,
                 raw_content_ref_id, display_content_ref_id, structured_payload_json,
                 source_novel_id, source_chapter_id, source_draft_id, source_draft_version,
                 source_base_content_hash, content_hash, content_length, processing_status,
                 parent_artifact_id, derivation_type, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
            params![
                artifact_id,
                task_id,
                attempt_id,
                artifact_type,
                schema_version,
                raw_content_ref_id,
                display_content_ref_id,
                structured_payload_json,
                source_novel_id,
                source_chapter_id,
                source_draft_id,
                source_draft_version,
                source_base_content_hash,
                content_hash,
                content_length,
                processing_status,
                parent_artifact_id,
                derivation_type,
                created_at,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn insert_issue(
    connection: &Connection,
    issue_id: &str,
    artifact_id: &str,
    validation_run_id: &str,
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
                (issue_id, artifact_id, validation_run_id, severity, code, message,
                 json_path, details_json, validator_version, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                issue_id,
                artifact_id,
                validation_run_id,
                severity,
                code,
                message,
                json_path,
                details_json,
                validator_version,
                created_at,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}
