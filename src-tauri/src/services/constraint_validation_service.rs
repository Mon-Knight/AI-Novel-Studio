use crate::errors::{codes, AppError};
use crate::repositories::artifact_repository;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::json;

pub const CHAPTER_CONSTRAINT_VALIDATOR_VERSION: &str = "chapter-constraint-validator-v1";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintValidationItemInput {
    pub constraint_id: String,
    pub severity: String,
    pub code: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordChapterConstraintValidationInput {
    pub artifact_id: String,
    pub task_id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub source_draft_id: String,
    pub source_draft_version: i64,
    pub base_content_hash: String,
    pub validation_run_id: String,
    pub validator_version: String,
    pub items: Vec<ConstraintValidationItemInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintValidationItemDto {
    pub constraint_id: String,
    pub severity: String,
    pub code: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterConstraintValidationSummary {
    pub artifact_id: String,
    pub task_id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub source_draft_id: String,
    pub source_draft_version: i64,
    pub base_content_hash: String,
    pub validation_run_id: String,
    pub status: String,
    pub must: Vec<ConstraintValidationItemDto>,
    pub should: Vec<ConstraintValidationItemDto>,
    pub forbid: Vec<ConstraintValidationItemDto>,
    pub blocking_count: usize,
    pub warning_count: usize,
    pub validator_version: String,
    pub validated_at: String,
}

#[derive(Debug)]
struct ArtifactBinding {
    task_id: String,
    novel_id: String,
    chapter_id: String,
    draft_id: String,
    draft_version: i64,
    base_hash: String,
}

fn is_allowed_severity(value: &str) -> bool {
    matches!(value, "must" | "should" | "forbid")
}
fn is_allowed_status(value: &str) -> bool {
    matches!(value, "passed" | "failed" | "unknown")
}

fn safe_message(value: &str) -> bool {
    value.chars().count() <= 200
        && !value.contains('\n')
        && !value.contains('\r')
        && !value.to_ascii_lowercase().contains("authorization")
        && !value.to_ascii_lowercase().contains("api_key")
        && !value.to_ascii_lowercase().contains("bearer ")
}

fn artifact_binding(
    connection: &Connection,
    artifact_id: &str,
) -> Result<ArtifactBinding, AppError> {
    connection.query_row(
        "SELECT task_id, source_novel_id, source_chapter_id, source_draft_id, source_draft_version, source_base_content_hash
         FROM result_artifacts WHERE artifact_id = ?1 AND artifact_type = 'chapter_text'",
        params![artifact_id],
        |row| Ok(ArtifactBinding {
            task_id: row.get(0)?, novel_id: row.get(1)?,
            chapter_id: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            draft_id: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            draft_version: row.get::<_, Option<i64>>(4)?.unwrap_or_default(),
            base_hash: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
        }),
    ).optional().map_err(AppError::database)?
        .ok_or_else(|| AppError::new(codes::ARTIFACT_VALIDATION_FAILED, "Chapter Artifact is unavailable.", false))
}

fn status_from_items(items: &[ConstraintValidationItemDto]) -> (String, usize, usize) {
    let blocking_count = items
        .iter()
        .filter(|item| {
            (item.severity == "must" || item.severity == "forbid") && item.status != "passed"
        })
        .count();
    let warning_count = items
        .iter()
        .filter(|item| item.severity == "should" && item.status != "passed")
        .count();
    let status = if blocking_count > 0 {
        "blocked"
    } else if warning_count > 0 {
        "passed_with_warnings"
    } else {
        "passed"
    };
    (status.to_string(), blocking_count, warning_count)
}

fn build_summary(
    connection: &Connection,
    artifact_id: &str,
    run_id: &str,
) -> Result<ChapterConstraintValidationSummary, AppError> {
    let binding = artifact_binding(connection, artifact_id)?;
    let mut statement = connection.prepare(
        "SELECT severity, code, message, details_json, created_at FROM artifact_validation_issues
         WHERE artifact_id = ?1 AND validation_run_id = ?2 AND validator_version = ?3 ORDER BY rowid ASC",
    ).map_err(AppError::database)?;
    let rows = statement
        .query_map(
            params![artifact_id, run_id, CHAPTER_CONSTRAINT_VALIDATOR_VERSION],
            |row| {
                let details: Option<String> = row.get(3)?;
                let parsed = details
                    .as_deref()
                    .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok());
                Ok((
                    ConstraintValidationItemDto {
                        constraint_id: parsed
                            .as_ref()
                            .and_then(|value| value.get("constraintId"))
                            .and_then(|value| value.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        severity: parsed
                            .as_ref()
                            .and_then(|value| value.get("constraintSeverity"))
                            .and_then(|value| value.as_str())
                            .unwrap_or("must")
                            .to_string(),
                        code: row.get(1)?,
                        status: parsed
                            .as_ref()
                            .and_then(|value| value.get("status"))
                            .and_then(|value| value.as_str())
                            .unwrap_or("unknown")
                            .to_string(),
                        message: row.get(2)?,
                    },
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    if rows.is_empty() {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "Constraint validation run is empty.",
            false,
        ));
    }
    let validated_at = rows
        .last()
        .map(|(_, created_at)| created_at.clone())
        .unwrap_or_default();
    let items = rows.into_iter().map(|(item, _)| item).collect::<Vec<_>>();
    let (status, blocking_count, warning_count) = status_from_items(&items);
    let mut must = Vec::new();
    let mut should = Vec::new();
    let mut forbid = Vec::new();
    for item in items {
        match item.severity.as_str() {
            "must" => must.push(item),
            "should" => should.push(item),
            "forbid" => forbid.push(item),
            _ => {
                return Err(AppError::new(
                    codes::ARTIFACT_VALIDATION_FAILED,
                    "Constraint validation has an invalid severity.",
                    false,
                ))
            }
        }
    }
    Ok(ChapterConstraintValidationSummary {
        artifact_id: artifact_id.to_string(),
        task_id: binding.task_id,
        novel_id: binding.novel_id,
        chapter_id: binding.chapter_id,
        source_draft_id: binding.draft_id,
        source_draft_version: binding.draft_version,
        base_content_hash: binding.base_hash,
        validation_run_id: run_id.to_string(),
        status,
        must,
        should,
        forbid,
        blocking_count,
        warning_count,
        validator_version: CHAPTER_CONSTRAINT_VALIDATOR_VERSION.to_string(),
        validated_at,
    })
}

pub fn record(
    connection: &mut Connection,
    input: RecordChapterConstraintValidationInput,
) -> Result<ChapterConstraintValidationSummary, AppError> {
    if input.validator_version != CHAPTER_CONSTRAINT_VALIDATOR_VERSION
        || input.validation_run_id.trim().is_empty()
    {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "Constraint validator identity is invalid.",
            false,
        ));
    }
    if input.items.is_empty()
        || !input.items.iter().any(|item| item.severity == "must")
        || !input.items.iter().any(|item| item.severity == "forbid")
    {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "Constraint validation is incomplete.",
            false,
        ));
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let binding = artifact_binding(&transaction, &input.artifact_id)?;
    if binding.task_id != input.task_id
        || binding.novel_id != input.novel_id
        || binding.chapter_id != input.chapter_id
        || binding.draft_id != input.source_draft_id
        || binding.draft_version != input.source_draft_version
        || binding.base_hash != input.base_content_hash
    {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "Constraint validation does not match the Artifact baseline.",
            false,
        ));
    }
    let now = Utc::now().to_rfc3339();
    for item in &input.items {
        if item.constraint_id.trim().is_empty()
            || !is_allowed_severity(&item.severity)
            || !is_allowed_status(&item.status)
            || !item.code.starts_with("CONSTRAINT_")
            || !safe_message(&item.message)
        {
            return Err(AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "Constraint validation item is invalid.",
                false,
            ));
        }
        let issue_severity = if item.severity == "should" {
            "warning"
        } else {
            "error"
        };
        artifact_repository::insert_issue(&transaction, &uuid::Uuid::new_v4().to_string(), &input.artifact_id,
            &input.validation_run_id, issue_severity, &item.code, &item.message, None,
            Some(&json!({ "constraintId": item.constraint_id, "constraintSeverity": item.severity, "status": item.status }).to_string()),
            CHAPTER_CONSTRAINT_VALIDATOR_VERSION, &now)?;
    }
    transaction.commit().map_err(AppError::database)?;
    build_summary(connection, &input.artifact_id, &input.validation_run_id)
}

pub fn latest(
    connection: &Connection,
    artifact_id: &str,
) -> Result<Option<ChapterConstraintValidationSummary>, AppError> {
    let run_id = connection.query_row(
        "SELECT validation_run_id FROM artifact_validation_issues WHERE artifact_id = ?1 AND validator_version = ?2 ORDER BY rowid DESC LIMIT 1",
        params![artifact_id, CHAPTER_CONSTRAINT_VALIDATOR_VERSION], |row| row.get::<_, String>(0),
    ).optional().map_err(AppError::database)?;
    run_id
        .map(|run_id| build_summary(connection, artifact_id, &run_id))
        .transpose()
}

pub fn ensure_latest_allows_apply(
    connection: &Connection,
    artifact_id: &str,
) -> Result<(), AppError> {
    let task: Option<(String, Option<String>)> = connection.query_row(
        "SELECT task_type, constraint_snapshot_id FROM ai_tasks WHERE task_id = (SELECT task_id FROM result_artifacts WHERE artifact_id = ?1)",
        params![artifact_id], |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional().map_err(AppError::database)?;
    let Some((task_type, constraint_snapshot_id)) = task else {
        return Ok(());
    };
    if task_type != "chapter_generate" || constraint_snapshot_id.is_none() {
        return Ok(());
    }
    let summary = latest(connection, artifact_id)?.ok_or_else(|| {
        AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "Chapter constraint validation is required before placement.",
            false,
        )
    })?;
    if summary.status == "blocked" {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "Chapter constraint validation blocked this Artifact.",
            false,
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::apply_plan::{CreateApplyPlanInput, ExecuteApplyPlanInput};
    use crate::domain::placement::CreatePlacementProposalInput;
    use crate::migrations;
    use crate::services::{apply_service, placement_service};

    fn setup() -> Result<Connection, Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch(
            "CREATE TABLE novels (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
             CREATE TABLE chapters (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
             CREATE TABLE chapter_drafts (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, version_no INTEGER NOT NULL, word_count INTEGER NOT NULL DEFAULT 0, is_adopted INTEGER NOT NULL DEFAULT 0, large_text_ref_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
        )?;
        migrations::run_migrations(&mut connection)?;
        crate::repositories::large_text_repository::insert_document_for_target(
            &connection,
            "raw-a",
            "result_artifact",
            "artifact-a",
            "raw_content",
            None,
            "artifact body",
            &crate::repositories::large_text_repository::sha256("artifact body"),
            "now",
        )?;
        connection.execute_batch(
            "INSERT INTO novels VALUES ('novel-a','A','now','now',NULL);
             INSERT INTO chapters VALUES ('chapter-a','novel-a','A','now','now',NULL);
             INSERT INTO chapter_drafts (id,novel_id,chapter_id,content,source,version_no,word_count,is_adopted,content_hash,created_at,updated_at) VALUES ('draft-a','novel-a','chapter-a','base','user_edited',1,1,1,'base-hash','now','now');
             INSERT INTO ai_tasks (task_id,task_type,novel_id,chapter_id,draft_id,scope_type,status,trace_id,operation_id,request_hash,constraint_snapshot_id,created_at) VALUES ('task-a','chapter_generate','novel-a','chapter-a','draft-a','chapter','completed','trace','operation','hash','constraint-a','now');
             INSERT INTO ai_task_attempts (attempt_id,task_id,attempt_number,status,started_at,finished_at) VALUES ('attempt-a','task-a',1,'succeeded','now','now');
             INSERT INTO result_artifacts (artifact_id,task_id,attempt_id,artifact_type,schema_version,raw_content_ref_id,source_novel_id,source_chapter_id,source_draft_id,source_draft_version,source_base_content_hash,content_hash,content_length,processing_status,created_at) VALUES ('artifact-a','task-a','attempt-a','chapter_text',1,'raw-a','novel-a','chapter-a','draft-a',1,'base-hash','artifact-hash',80,'valid','now');",
        )?;
        Ok(connection)
    }

    fn record_input(status: &str) -> RecordChapterConstraintValidationInput {
        RecordChapterConstraintValidationInput {
            artifact_id: "artifact-a".to_string(),
            task_id: "task-a".to_string(),
            novel_id: "novel-a".to_string(),
            chapter_id: "chapter-a".to_string(),
            source_draft_id: "draft-a".to_string(),
            source_draft_version: 1,
            base_content_hash: "base-hash".to_string(),
            validation_run_id: uuid::Uuid::new_v4().to_string(),
            validator_version: CHAPTER_CONSTRAINT_VALIDATOR_VERSION.to_string(),
            items: vec![
                ConstraintValidationItemInput {
                    constraint_id: "must-a".to_string(),
                    severity: "must".to_string(),
                    code: "CONSTRAINT_MUST_MISSING".to_string(),
                    status: status.to_string(),
                    message: "Must summary.".to_string(),
                },
                ConstraintValidationItemInput {
                    constraint_id: "forbid-a".to_string(),
                    severity: "forbid".to_string(),
                    code: "CONSTRAINT_FORBID_MATCHED".to_string(),
                    status: "passed".to_string(),
                    message: "Forbid summary.".to_string(),
                },
            ],
        }
    }

    #[test]
    fn cv01_runs_are_append_only_and_latest_block_controls_authority_gate(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        record(&mut connection, record_input("passed"))?;
        assert!(ensure_latest_allows_apply(&connection, "artifact-a").is_ok());
        let proposal = placement_service::create_proposal(
            &mut connection,
            CreatePlacementProposalInput {
                artifact_id: "artifact-a".to_string(),
                target: None,
                parent_proposal_id: None,
            },
        )?;
        let plan = apply_service::create_plan(
            &mut connection,
            CreateApplyPlanInput {
                proposal_id: proposal.proposal_id,
                parent_plan_id: None,
                source: None,
                note: None,
                quality_fix: None,
            },
        )?;
        record(&mut connection, record_input("failed"))?;
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM artifact_validation_issues WHERE artifact_id='artifact-a' AND validator_version=?1",
            params![CHAPTER_CONSTRAINT_VALIDATOR_VERSION], |row| row.get(0),
        )?;
        assert_eq!(count, 4);
        assert_eq!(
            latest(&connection, "artifact-a")?
                .expect("latest result")
                .status,
            "blocked"
        );
        assert!(ensure_latest_allows_apply(&connection, "artifact-a").is_err());
        assert!(apply_service::execute_plan(
            &mut connection,
            ExecuteApplyPlanInput {
                plan_id: plan.plan_id,
                operation_id: plan.operation_id,
                request_hash: plan.request_hash,
            },
        )
        .is_err());
        Ok(())
    }
}
