use crate::domain::result_artifact::ArtifactProcessingStatus;
use crate::errors::{codes, AppError};
use crate::repositories::{ai_task_repository, artifact_repository, large_text_repository};
use chrono::Utc;
use rusqlite::{Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const VALIDATOR_VERSION: &str = "artifact-validator-m1-v1";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSourceInput {
    pub novel_id: String,
    pub chapter_id: Option<String>,
    pub draft_id: Option<String>,
    pub draft_version: Option<i64>,
    pub base_content_hash: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateResultArtifactInput {
    pub task_id: String,
    pub attempt_id: String,
    pub artifact_type: String,
    pub schema_version: i64,
    pub raw_content: String,
    pub parse_content: Option<String>,
    pub display_content: Option<String>,
    pub structured_payload_json: Option<Value>,
    pub source: ArtifactSourceInput,
    pub expected_ok: Option<bool>,
    pub parent_artifact_id: Option<String>,
    pub derivation_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssueDto {
    pub severity: String,
    pub code: String,
    pub message: String,
    pub json_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultArtifactDto {
    pub artifact_id: String,
    pub task_id: String,
    pub attempt_id: String,
    pub artifact_type: String,
    pub schema_version: i64,
    pub raw_content_ref_id: String,
    pub display_content_ref_id: Option<String>,
    pub content_hash: String,
    pub content_length: usize,
    pub processing_status: String,
    pub issues: Vec<ValidationIssueDto>,
    pub created_at: String,
}

fn issue(severity: &str, code: &str, message: &str, json_path: Option<&str>) -> ValidationIssueDto {
    ValidationIssueDto {
        severity: severity.to_string(),
        code: code.to_string(),
        message: message.to_string(),
        json_path: json_path.map(str::to_owned),
    }
}

fn requires_json(artifact_type: &str) -> bool {
    matches!(
        artifact_type,
        "quality_report"
            | "generic_json"
            | "character_candidates"
            | "event_candidates"
            | "setting_candidates"
            | "style_analysis"
            | "chapter_summary"
            | "volume_summary"
    )
}

fn requires_draft_source(artifact_type: &str) -> bool {
    matches!(artifact_type, "chapter_text" | "quality_report")
}

pub fn create_artifact(
    connection: &mut Connection,
    input: CreateResultArtifactInput,
) -> Result<ResultArtifactDto, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let task = ai_task_repository::find(&transaction, &input.task_id)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "AI Task 不存在", false))?;
    if task.status == "cancel_requested" || task.status == "cancelled" {
        return Err(AppError::new(
            codes::AI_PROVIDER_CANCELLED,
            "取消后的响应不能创建 Artifact",
            false,
        ));
    }
    if task.status != "validating" || task.current_attempt_id.as_deref() != Some(&input.attempt_id)
    {
        return Err(AppError::new(
            codes::AI_TASK_ILLEGAL_TRANSITION,
            "Task 未处于 Artifact 校验阶段",
            false,
        ));
    }
    if task.novel_id != input.source.novel_id || task.chapter_id != input.source.chapter_id {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "Artifact 来源身份与 Task 不一致",
            false,
        ));
    }

    let artifact_id = uuid::Uuid::new_v4().to_string();
    let validation_run_id = uuid::Uuid::new_v4().to_string();
    let raw_content_ref_id = uuid::Uuid::new_v4().to_string();
    let display_content_ref_id = input
        .display_content
        .as_deref()
        .filter(|display| *display != input.raw_content)
        .map(|_| uuid::Uuid::new_v4().to_string());
    let now = Utc::now().to_rfc3339();
    let content_hash = large_text_repository::sha256(&input.raw_content);
    let validation_content = input.parse_content.as_deref().unwrap_or(&input.raw_content);
    large_text_repository::insert_document_for_target(
        &transaction,
        &raw_content_ref_id,
        "result_artifact",
        &artifact_id,
        "raw_content",
        None,
        &input.raw_content,
        &content_hash,
        &now,
    )?;
    if let (Some(document_id), Some(display)) = (
        display_content_ref_id.as_deref(),
        input.display_content.as_deref(),
    ) {
        large_text_repository::insert_document_for_target(
            &transaction,
            document_id,
            "result_artifact",
            &artifact_id,
            "display_content",
            None,
            display,
            &large_text_repository::sha256(display),
            &now,
        )?;
    }

    let mut issues = Vec::new();
    if validation_content.trim().is_empty() {
        issues.push(issue("error", "ARTIFACT_EMPTY", "Provider 返回为空", None));
    }
    let mut structured = input.structured_payload_json.clone();
    if requires_json(&input.artifact_type) && structured.is_none() {
        match serde_json::from_str::<Value>(validation_content) {
            Ok(value) if value.is_object() || value.is_array() => structured = Some(value),
            _ => issues.push(issue(
                "error",
                codes::ARTIFACT_PARSE_FAILED,
                "Provider 返回不是预期 JSON",
                None,
            )),
        }
    }
    if requires_draft_source(&input.artifact_type)
        && (input.source.draft_id.as_deref().unwrap_or("").is_empty()
            || input.source.draft_version.is_none()
            || input
                .source
                .base_content_hash
                .as_deref()
                .unwrap_or("")
                .is_empty())
    {
        issues.push(issue(
            "error",
            "ARTIFACT_SOURCE_INCOMPLETE",
            "正文类 Artifact 缺少 source draft/version/hash",
            None,
        ));
    }
    if input.expected_ok == Some(true) && validation_content.trim() != "OK" {
        issues.push(issue(
            "error",
            "CONNECTION_TEST_UNEXPECTED_RESPONSE",
            "连接测试未返回预期 OK",
            None,
        ));
    }
    if let Some(Value::Object(payload)) = structured.as_ref() {
        if let Some(provider_chapter_id) = payload.get("chapterId").and_then(Value::as_str) {
            if input.source.chapter_id.as_deref() != Some(provider_chapter_id) {
                issues.push(issue(
                    "warning",
                    "ARTIFACT_PROVIDER_TARGET_IGNORED",
                    "Provider 返回的 chapterId 已忽略",
                    Some("$.chapterId"),
                ));
            }
        }
        if payload.contains_key("targetId") {
            issues.push(issue(
                "warning",
                "ARTIFACT_PROVIDER_TARGET_IGNORED",
                "Provider 返回的 targetId 仅作为非权威提示",
                Some("$.targetId"),
            ));
        }
    }
    let has_error = issues.iter().any(|item| item.severity == "error");
    let has_warning = issues.iter().any(|item| item.severity == "warning");
    let processing_status = if has_error {
        ArtifactProcessingStatus::Invalid
    } else if has_warning {
        ArtifactProcessingStatus::ValidWithWarnings
    } else {
        ArtifactProcessingStatus::Valid
    };
    let structured_json = structured.as_ref().map(Value::to_string);
    artifact_repository::insert_artifact(
        &transaction,
        &artifact_id,
        &input.task_id,
        &input.attempt_id,
        &input.artifact_type,
        input.schema_version,
        &raw_content_ref_id,
        display_content_ref_id.as_deref(),
        structured_json.as_deref(),
        &input.source.novel_id,
        input.source.chapter_id.as_deref(),
        input.source.draft_id.as_deref(),
        input.source.draft_version,
        input.source.base_content_hash.as_deref(),
        &content_hash,
        input.raw_content.chars().count() as i64,
        processing_status.as_str(),
        input.parent_artifact_id.as_deref(),
        input.derivation_type.as_deref(),
        &now,
    )?;
    for validation_issue in &issues {
        artifact_repository::insert_issue(
            &transaction,
            &uuid::Uuid::new_v4().to_string(),
            &artifact_id,
            &validation_run_id,
            &validation_issue.severity,
            &validation_issue.code,
            &validation_issue.message,
            validation_issue.json_path.as_deref(),
            None,
            VALIDATOR_VERSION,
            &now,
        )?;
    }
    ai_task_repository::link_artifact(&transaction, &input.task_id, &artifact_id)?;
    if has_error {
        let error = AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "Artifact 校验失败",
            false,
        );
        ai_task_repository::set_task_error(
            &transaction,
            &input.task_id,
            &serde_json::to_string(&error).unwrap_or_else(|_| "{}".to_string()),
        )?;
        ai_task_repository::cas_status(&transaction, &input.task_id, "validating", "failed", &now)?;
    } else {
        ai_task_repository::cas_status(
            &transaction,
            &input.task_id,
            "validating",
            "completed",
            &now,
        )?;
    }
    transaction.commit().map_err(AppError::database)?;
    Ok(ResultArtifactDto {
        artifact_id,
        task_id: input.task_id,
        attempt_id: input.attempt_id,
        artifact_type: input.artifact_type,
        schema_version: input.schema_version,
        raw_content_ref_id,
        display_content_ref_id,
        content_hash,
        content_length: input.raw_content.chars().count(),
        processing_status: processing_status.as_str().to_string(),
        issues,
        created_at: now,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::ai_task_service::{self, tests::connection, tests::task_input};

    fn validating_task(
        connection: &mut Connection,
        operation_id: &str,
    ) -> Result<(String, String), Box<dyn std::error::Error>> {
        let task = ai_task_service::create_task(connection, task_input(operation_id))?;
        let attempt = ai_task_service::start_attempt(connection, &task.task_id, Some("fake"))?;
        ai_task_service::mark_attempt_succeeded(
            connection,
            &task.task_id,
            &attempt.attempt_id,
            serde_json::json!({"responseHash": "hash", "responseLength": 2}),
        )?;
        Ok((task.task_id, attempt.attempt_id))
    }

    fn artifact_input(task_id: String, attempt_id: String, raw: &str) -> CreateResultArtifactInput {
        CreateResultArtifactInput {
            task_id,
            attempt_id,
            artifact_type: "generic_json".to_string(),
            schema_version: 1,
            raw_content: raw.to_string(),
            parse_content: None,
            display_content: None,
            structured_payload_json: None,
            source: ArtifactSourceInput {
                novel_id: "system".to_string(),
                chapter_id: None,
                draft_id: None,
                draft_version: None,
                base_content_hash: None,
            },
            expected_ok: None,
            parent_artifact_id: None,
            derivation_type: None,
        }
    }

    #[test]
    fn art01_malformed_json_keeps_raw_artifact_and_fails_task(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let (task_id, attempt_id) = validating_task(&mut connection, "artifact-malformed")?;
        let artifact = create_artifact(
            &mut connection,
            artifact_input(task_id.clone(), attempt_id, "not-json"),
        )?;
        assert_eq!(artifact.processing_status, "invalid");
        assert!(artifact
            .issues
            .iter()
            .any(|item| item.code == codes::ARTIFACT_PARSE_FAILED));
        let raw = large_text_repository::read_verified_document(
            &connection,
            &artifact.raw_content_ref_id,
        )?;
        assert_eq!(raw.content, "not-json");
        assert_eq!(
            ai_task_repository::find(&connection, &task_id)?
                .unwrap()
                .status,
            "failed"
        );
        Ok(())
    }

    #[test]
    fn art02_large_raw_response_round_trips_without_preview_truncation(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let (task_id, attempt_id) = validating_task(&mut connection, "artifact-large")?;
        let payload = serde_json::json!({"body": "长正文".repeat(60_000)}).to_string();
        let artifact = create_artifact(
            &mut connection,
            artifact_input(task_id, attempt_id, &payload),
        )?;
        assert_eq!(artifact.processing_status, "valid");
        let raw = large_text_repository::read_verified_document(
            &connection,
            &artifact.raw_content_ref_id,
        )?;
        assert_eq!(raw.content, payload);
        assert_eq!(raw.content_hash, artifact.content_hash);
        Ok(())
    }

    #[test]
    fn art03_provider_target_is_non_authoritative_warning() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = connection()?;
        let (task_id, attempt_id) = validating_task(&mut connection, "artifact-target")?;
        let artifact = create_artifact(
            &mut connection,
            artifact_input(task_id, attempt_id, r#"{"targetId":"forged"}"#),
        )?;
        assert_eq!(artifact.processing_status, "valid_with_warnings");
        assert!(artifact
            .issues
            .iter()
            .any(|item| item.code == "ARTIFACT_PROVIDER_TARGET_IGNORED"));
        Ok(())
    }

    #[test]
    fn art04_repository_rejects_in_place_content_update(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let (task_id, attempt_id) = validating_task(&mut connection, "artifact-immutable")?;
        let artifact = create_artifact(
            &mut connection,
            artifact_input(task_id, attempt_id, r#"{"ok":true}"#),
        )?;
        let update = connection.execute(
            "UPDATE result_artifacts SET content_hash = 'forged' WHERE artifact_id = ?1",
            rusqlite::params![artifact.artifact_id],
        );
        assert!(update.is_err());
        let stored_hash: String = connection.query_row(
            "SELECT content_hash FROM result_artifacts WHERE artifact_id = ?1",
            rusqlite::params![artifact.artifact_id],
            |row| row.get(0),
        )?;
        assert_eq!(stored_hash, artifact.content_hash);
        Ok(())
    }

    #[test]
    fn art05_schema_version_is_persisted_as_identity() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let (task_id, attempt_id) = validating_task(&mut connection, "artifact-schema")?;
        let mut input = artifact_input(task_id, attempt_id, r#"{"ok":true}"#);
        input.schema_version = 7;
        let artifact = create_artifact(&mut connection, input)?;
        let stored: i64 = connection.query_row(
            "SELECT schema_version FROM result_artifacts WHERE artifact_id = ?1",
            rusqlite::params![artifact.artifact_id],
            |row| row.get(0),
        )?;
        assert_eq!(stored, 7);
        Ok(())
    }

    #[test]
    fn art07_chapter_artifact_without_source_baseline_is_invalid(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let (task_id, attempt_id) = validating_task(&mut connection, "artifact-source")?;
        let mut input = artifact_input(task_id, attempt_id, "chapter body");
        input.artifact_type = "chapter_text".to_string();
        let artifact = create_artifact(&mut connection, input)?;
        assert_eq!(artifact.processing_status, "invalid");
        assert!(artifact
            .issues
            .iter()
            .any(|item| item.code == "ARTIFACT_SOURCE_INCOMPLETE"));
        Ok(())
    }

    #[test]
    fn art08_empty_response_is_invalid_but_raw_reference_exists(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let (task_id, attempt_id) = validating_task(&mut connection, "artifact-empty")?;
        let artifact = create_artifact(&mut connection, artifact_input(task_id, attempt_id, ""))?;
        assert_eq!(artifact.processing_status, "invalid");
        assert!(large_text_repository::read_verified_document(
            &connection,
            &artifact.raw_content_ref_id,
        )
        .is_ok());
        Ok(())
    }

    #[test]
    fn art09_cancelled_task_rejects_artifact_creation() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let task = ai_task_service::create_task(&mut connection, task_input("artifact-cancelled"))?;
        let attempt = ai_task_service::start_attempt(&mut connection, &task.task_id, Some("fake"))?;
        ai_task_service::cancel_task(&mut connection, &task.task_id)?;
        let error = create_artifact(
            &mut connection,
            artifact_input(task.task_id.clone(), attempt.attempt_id, r#"{"ok":true}"#),
        )
        .expect_err("cancelled response cannot create artifact");
        assert_eq!(error.code, codes::AI_PROVIDER_CANCELLED);
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM result_artifacts WHERE task_id = ?1",
            rusqlite::params![task.task_id],
            |row| row.get(0),
        )?;
        assert_eq!(count, 0);
        Ok(())
    }

    #[test]
    fn art10_connection_test_requires_exact_ok_semantics() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = connection()?;
        let (task_id, attempt_id) = validating_task(&mut connection, "artifact-ok")?;
        let mut input = artifact_input(task_id, attempt_id, "NOT OK");
        input.artifact_type = "generic_text".to_string();
        input.expected_ok = Some(true);
        let artifact = create_artifact(&mut connection, input)?;
        assert_eq!(artifact.processing_status, "invalid");
        assert!(artifact
            .issues
            .iter()
            .any(|item| item.code == "CONNECTION_TEST_UNEXPECTED_RESPONSE"));
        Ok(())
    }

    #[test]
    fn art11_validation_issue_never_contains_full_provider_body(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let (task_id, attempt_id) = validating_task(&mut connection, "artifact-redaction")?;
        let body = "sensitive novel body ".repeat(1000);
        let artifact =
            create_artifact(&mut connection, artifact_input(task_id, attempt_id, &body))?;
        let messages: String = connection.query_row(
            "SELECT GROUP_CONCAT(message, ' ') FROM artifact_validation_issues WHERE artifact_id = ?1",
            rusqlite::params![artifact.artifact_id],
            |row| row.get(0),
        )?;
        assert!(!messages.contains("sensitive novel body"));
        Ok(())
    }
}
