use crate::domain::result_artifact::{
    is_supported_artifact_contract, requires_json, ArtifactProcessingStatus,
};
use crate::errors::{codes, AppError};
use crate::repositories::{ai_task_repository, artifact_repository, large_text_repository};
use crate::services::ai_fact_security::{self, canonical_json};
use chrono::Utc;
use rusqlite::{Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const VALIDATOR_VERSION: &str = "artifact-validator-m1-v2";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateResultArtifactInput {
    pub task_id: String,
    pub attempt_id: String,
    pub artifact_type: String,
    pub schema_version: i64,
    #[serde(default)]
    pub raw_content: String,
    pub display_content: Option<String>,
    pub structured_payload_json: Option<Value>,
    pub parent_artifact_id: Option<String>,
    pub derivation_type: Option<String>,
}

#[derive(Debug, Clone)]
struct ValidationIssue {
    severity: &'static str,
    code: &'static str,
    message: &'static str,
    json_path: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultArtifactBundle {
    pub artifact: artifact_repository::ResultArtifactRecord,
    pub raw_content: String,
    pub display_content: Option<String>,
    pub structured_payload_json: Option<Value>,
    pub issues: Vec<artifact_repository::ArtifactValidationIssueRecord>,
}

fn commit_transaction(
    transaction: rusqlite::Transaction<'_>,
    operation_id: Option<&str>,
) -> Result<(), AppError> {
    transaction.commit().map_err(|error| {
        AppError::new(
            codes::DATABASE_COMMIT_UNKNOWN,
            "Artifact 提交状态未知，请按原 Task/Attempt 重新读取或重试",
            true,
        )
        .with_context(None, operation_id)
        .with_details(serde_json::json!({ "sqliteError": error.to_string() }))
    })
}

fn issue(
    severity: &'static str,
    code: &'static str,
    message: &'static str,
    json_path: Option<&'static str>,
) -> ValidationIssue {
    ValidationIssue {
        severity,
        code,
        message,
        json_path,
    }
}

fn response_identity(
    attempt: &ai_task_repository::AiTaskAttemptRecord,
) -> Result<(&str, i64), AppError> {
    let metadata = attempt.response_metadata_json.as_ref().ok_or_else(|| {
        AppError::new(
            codes::AI_RESPONSE_METADATA_INVALID,
            "Succeeded Attempt 缺少响应元数据",
            false,
        )
    })?;
    ai_fact_security::validate_response_metadata(metadata)?;
    let response_hash = metadata
        .get("responseHash")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::new(
                codes::AI_RESPONSE_METADATA_INVALID,
                "Succeeded Attempt 缺少 responseHash",
                false,
            )
        })?;
    let response_length = metadata
        .get("responseLength")
        .and_then(Value::as_i64)
        .ok_or_else(|| {
            AppError::new(
                codes::AI_RESPONSE_METADATA_INVALID,
                "Succeeded Attempt 缺少 responseLength",
                false,
            )
        })?;
    Ok((response_hash, response_length))
}

fn insert_artifact_document(
    connection: &Connection,
    artifact_id: &str,
    field_name: &str,
    content: &str,
    now: &str,
) -> Result<(String, String), AppError> {
    let document_id = uuid::Uuid::new_v4().to_string();
    let hash = large_text_repository::sha256(content);
    large_text_repository::insert_document_for_target(
        connection,
        &document_id,
        "result_artifact",
        artifact_id,
        field_name,
        None,
        content,
        &hash,
        now,
    )?;
    Ok((document_id, hash))
}

fn validate_structured_target(
    structured: Option<&Value>,
    authoritative_chapter_id: Option<&str>,
    issues: &mut Vec<ValidationIssue>,
) {
    let Some(Value::Object(payload)) = structured else {
        return;
    };
    if payload
        .get("chapterId")
        .and_then(Value::as_str)
        .is_some_and(|provider_id| Some(provider_id) != authoritative_chapter_id)
    {
        issues.push(issue(
            "warning",
            "ARTIFACT_PROVIDER_TARGET_IGNORED",
            "Provider 返回的 chapterId 不是权威目标，已忽略",
            Some("$.chapterId"),
        ));
    }
    if payload.contains_key("targetId") {
        issues.push(issue(
            "warning",
            "ARTIFACT_PROVIDER_TARGET_IGNORED",
            "Provider 返回的 targetId 不是权威目标，已忽略",
            Some("$.targetId"),
        ));
    }
}

pub fn create_artifact(
    connection: &mut Connection,
    input: CreateResultArtifactInput,
) -> Result<ResultArtifactBundle, AppError> {
    if !is_supported_artifact_contract(&input.artifact_type, input.schema_version) {
        return Err(AppError::new(
            codes::ARTIFACT_TYPE_UNSUPPORTED,
            "当前版本不支持该 Artifact 类型或 schemaVersion",
            false,
        ));
    }
    ai_fact_security::validate_body(&input.raw_content, "Provider 原始响应")?;
    if let Some(display) = input.display_content.as_deref() {
        ai_fact_security::validate_body(display, "Artifact 展示正文")?;
    }
    if let Some(structured) = input.structured_payload_json.as_ref() {
        ai_fact_security::validate_metadata(structured, "Artifact 结构化结果")?;
    }
    if input.parent_artifact_id.is_some() || input.derivation_type.is_some() {
        return Err(AppError::new(
            codes::AI_TASK_INPUT_INVALID,
            "v2.3.0-M1 尚未开放派生 Artifact 写入",
            false,
        ));
    }
    let content_hash = large_text_repository::sha256(&input.raw_content);
    let content_length = input.raw_content.chars().count() as i64;
    let normalized_display = input
        .display_content
        .as_deref()
        .filter(|display| *display != input.raw_content);
    let requested_display_hash = normalized_display.map(large_text_repository::sha256);
    let mut structured = input.structured_payload_json.clone();
    if structured.is_none() && requires_json(&input.artifact_type) {
        structured = serde_json::from_str::<Value>(&input.raw_content)
            .ok()
            .filter(|value| value.is_object() || value.is_array());
    }
    let structured_json = structured.as_ref().map(canonical_json).transpose()?;
    let requested_structured_hash = structured_json
        .as_deref()
        .map(large_text_repository::sha256);

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let task = ai_task_repository::find_task(&transaction, &input.task_id)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "AI Task 不存在", false))?;
    let attempt =
        ai_task_repository::find_attempt(&transaction, &input.task_id, &input.attempt_id)?
            .ok_or_else(|| {
                AppError::new(codes::AI_ATTEMPT_NOT_FOUND, "AI Attempt 不存在", false)
            })?;
    if task.expected_artifact_type != input.artifact_type
        || task.expected_artifact_schema_version != input.schema_version
    {
        return Err(AppError::new(
            codes::ARTIFACT_TYPE_UNSUPPORTED,
            "Artifact 契约与 Task 预期不一致",
            false,
        ));
    }
    let input_snapshot = ai_task_repository::find_input_snapshot(&transaction, &input.task_id)?
        .filter(|snapshot| snapshot.snapshot_id == task.input_snapshot_id)
        .ok_or_else(|| {
            AppError::new(
                codes::ARTIFACT_SOURCE_MISMATCH,
                "Task 的 Input Snapshot 不可用",
                false,
            )
        })?;
    if let Some(existing) = artifact_repository::find_root_artifact_for_attempt(
        &transaction,
        &input.task_id,
        &input.attempt_id,
    )? {
        let same_request = existing.artifact_type == input.artifact_type
            && existing.schema_version == input.schema_version
            && existing.content_hash == content_hash
            && existing.content_length == content_length
            && existing.display_content_hash == requested_display_hash
            && existing.structured_payload_hash == requested_structured_hash
            && existing.source_input_snapshot_id == input_snapshot.snapshot_id;
        if !same_request {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "同一 Attempt 对应了不同 Artifact 请求",
                false,
            ));
        }
        let artifact_id = existing.artifact_id.clone();
        commit_transaction(transaction, Some(&task.operation_id))?;
        return get_artifact_bundle(connection, &artifact_id);
    }
    if task.status == "cancel_requested" || task.status == "cancelled" {
        return Err(AppError::new(
            codes::AI_PROVIDER_CANCELLED,
            "取消后的响应不能创建 Artifact",
            false,
        ));
    }
    if task.status != "validating"
        || attempt.status != "succeeded"
        || task.current_attempt_id.as_deref() != Some(&input.attempt_id)
    {
        return Err(AppError::new(
            codes::AI_TASK_ILLEGAL_TRANSITION,
            "Task 未处于当前 Attempt 的 Artifact 校验阶段",
            false,
        ));
    }

    let (expected_response_hash, expected_response_length) = response_identity(&attempt)?;
    if expected_response_hash != content_hash || expected_response_length != content_length {
        return Err(AppError::new(
            codes::ARTIFACT_SOURCE_MISMATCH,
            "Artifact 原始正文与 Provider 响应身份不一致",
            false,
        )
        .with_details(serde_json::json!({
            "expectedHash": expected_response_hash,
            "actualHash": content_hash,
            "expectedLength": expected_response_length,
            "actualLength": content_length,
        })));
    }

    let mut issues = Vec::new();
    if input.raw_content.trim().is_empty() {
        issues.push(issue("error", "ARTIFACT_EMPTY", "Provider 返回为空", None));
    }
    if requires_json(&input.artifact_type) {
        if structured.is_none() {
            issues.push(issue(
                "error",
                codes::ARTIFACT_PARSE_FAILED,
                "Provider 返回不是预期的 JSON 对象或数组",
                None,
            ));
        } else if !structured
            .as_ref()
            .is_some_and(|value| value.is_object() || value.is_array())
        {
            issues.push(issue(
                "error",
                codes::ARTIFACT_PARSE_FAILED,
                "结构化 Artifact 必须是 JSON 对象或数组",
                None,
            ));
        }
    }
    if task.task_type == "connection_test"
        && task.expected_artifact_type == "generic_text"
        && input.raw_content.trim() != "OK"
    {
        issues.push(issue(
            "error",
            "CONNECTION_TEST_UNEXPECTED_RESPONSE",
            "连接测试未返回预期的 OK",
            None,
        ));
    }
    validate_structured_target(structured.as_ref(), task.chapter_id.as_deref(), &mut issues);
    let has_error = issues.iter().any(|item| item.severity == "error");
    let has_warning = issues.iter().any(|item| item.severity == "warning");
    let processing_status = if has_error {
        ArtifactProcessingStatus::Invalid
    } else if has_warning {
        ArtifactProcessingStatus::ValidWithWarnings
    } else {
        ArtifactProcessingStatus::Valid
    };

    let artifact_id = uuid::Uuid::new_v4().to_string();
    let validation_run_id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let (raw_content_ref_id, raw_hash) = insert_artifact_document(
        &transaction,
        &artifact_id,
        "raw_content",
        &input.raw_content,
        &now,
    )?;
    debug_assert_eq!(raw_hash, content_hash);
    let display_document = normalized_display
        .map(|display| {
            insert_artifact_document(&transaction, &artifact_id, "display_content", display, &now)
        })
        .transpose()?;
    let structured_document = structured_json
        .as_deref()
        .map(|payload| {
            insert_artifact_document(
                &transaction,
                &artifact_id,
                "structured_payload",
                payload,
                &now,
            )
        })
        .transpose()?;
    artifact_repository::insert_artifact(
        &transaction,
        &artifact_repository::NewArtifact {
            artifact_id: &artifact_id,
            task_id: &input.task_id,
            attempt_id: &input.attempt_id,
            source_input_snapshot_id: &input_snapshot.snapshot_id,
            artifact_type: &input.artifact_type,
            schema_version: input.schema_version,
            raw_content_ref_id: &raw_content_ref_id,
            display_content_ref_id: display_document.as_ref().map(|value| value.0.as_str()),
            display_content_hash: display_document.as_ref().map(|value| value.1.as_str()),
            structured_payload_ref_id: structured_document.as_ref().map(|value| value.0.as_str()),
            structured_payload_hash: structured_document.as_ref().map(|value| value.1.as_str()),
            source_novel_id: &task.novel_id,
            source_chapter_id: task.chapter_id.as_deref(),
            source_draft_id: input_snapshot.source_draft_id.as_deref(),
            source_draft_version: input_snapshot.source_draft_version,
            source_base_content_hash: input_snapshot.base_content_hash.as_deref(),
            content_hash: &content_hash,
            content_length,
            processing_status: processing_status.as_str(),
            parent_artifact_id: input.parent_artifact_id.as_deref(),
            derivation_type: input.derivation_type.as_deref(),
            created_at: &now,
        },
    )?;
    for (index, validation_issue) in issues.iter().enumerate() {
        artifact_repository::insert_issue(
            &transaction,
            &uuid::Uuid::new_v4().to_string(),
            &artifact_id,
            &validation_run_id,
            index as i64,
            validation_issue.severity,
            validation_issue.code,
            validation_issue.message,
            validation_issue.json_path,
            None,
            VALIDATOR_VERSION,
            &now,
        )?;
    }
    let task_error = has_error
        .then(|| {
            canonical_json(&ai_fact_security::safe_error_json(&AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "Artifact 校验失败，原始响应已保留",
                true,
            )))
        })
        .transpose()?;
    let next_status = if has_error { "failed" } else { "completed" };
    ai_task_repository::finish_task_with_artifact(
        &transaction,
        &task,
        &input.attempt_id,
        &artifact_id,
        next_status,
        task_error.as_deref(),
        &now,
    )?;
    commit_transaction(transaction, Some(&task.operation_id))?;
    get_artifact_bundle(connection, &artifact_id)
}

pub fn get_artifact_bundle(
    connection: &Connection,
    artifact_id: &str,
) -> Result<ResultArtifactBundle, AppError> {
    let artifact = artifact_repository::find_artifact(connection, artifact_id)?
        .ok_or_else(|| AppError::new(codes::ARTIFACT_NOT_FOUND, "Artifact 不存在", false))?;
    let task = ai_task_repository::find_task(connection, &artifact.task_id)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "Artifact 的 Task 不存在", false))?;
    let _attempt =
        ai_task_repository::find_attempt(connection, &artifact.task_id, &artifact.attempt_id)?
            .ok_or_else(|| {
                AppError::new(
                    codes::AI_ATTEMPT_NOT_FOUND,
                    "Artifact 的 Attempt 不存在",
                    false,
                )
            })?;
    let input_snapshot = ai_task_repository::find_input_snapshot(connection, &artifact.task_id)?
        .ok_or_else(|| {
            AppError::new(
                codes::ARTIFACT_SOURCE_MISMATCH,
                "Artifact 来源快照不存在",
                false,
            )
        })?;
    if task.expected_artifact_type != artifact.artifact_type
        || task.expected_artifact_schema_version != artifact.schema_version
        || input_snapshot.snapshot_id != artifact.source_input_snapshot_id
        || task.novel_id != artifact.source_novel_id
        || task.chapter_id != artifact.source_chapter_id
        || input_snapshot.source_draft_id != artifact.source_draft_id
        || input_snapshot.source_draft_version != artifact.source_draft_version
        || input_snapshot.base_content_hash != artifact.source_base_content_hash
    {
        return Err(AppError::new(
            codes::ARTIFACT_SOURCE_MISMATCH,
            "Artifact 来源身份校验失败",
            false,
        ));
    }
    let raw =
        large_text_repository::read_verified_document(connection, &artifact.raw_content_ref_id)?;
    if raw.content_hash != artifact.content_hash
        || raw.content_length as i64 != artifact.content_length
    {
        return Err(AppError::new(
            codes::LARGE_TEXT_HASH_MISMATCH,
            "Artifact 原始正文完整性校验失败",
            false,
        ));
    }
    let display_content = artifact
        .display_content_ref_id
        .as_deref()
        .map(|document_id| large_text_repository::read_verified_document(connection, document_id))
        .transpose()?
        .map(|verified| {
            if Some(verified.content_hash.as_str()) != artifact.display_content_hash.as_deref() {
                Err(AppError::new(
                    codes::LARGE_TEXT_HASH_MISMATCH,
                    "Artifact 展示正文完整性校验失败",
                    false,
                ))
            } else {
                Ok(verified.content)
            }
        })
        .transpose()?;
    let structured_payload_json = artifact
        .structured_payload_ref_id
        .as_deref()
        .map(|document_id| large_text_repository::read_verified_document(connection, document_id))
        .transpose()?
        .map(|verified| {
            if Some(verified.content_hash.as_str()) != artifact.structured_payload_hash.as_deref() {
                return Err(AppError::new(
                    codes::LARGE_TEXT_HASH_MISMATCH,
                    "Artifact 结构化结果完整性校验失败",
                    false,
                ));
            }
            serde_json::from_str::<Value>(&verified.content).map_err(|_| {
                AppError::new(
                    codes::ARTIFACT_PARSE_FAILED,
                    "Artifact 结构化结果无法读取",
                    false,
                )
            })
        })
        .transpose()?;
    Ok(ResultArtifactBundle {
        issues: artifact_repository::list_issues_for_artifact(connection, artifact_id)?,
        artifact,
        raw_content: raw.content,
        display_content,
        structured_payload_json,
    })
}

pub fn list_task_artifacts(
    connection: &Connection,
    task_id: &str,
) -> Result<Vec<ResultArtifactBundle>, AppError> {
    artifact_repository::list_artifacts_for_task(connection, task_id)?
        .into_iter()
        .map(|artifact| get_artifact_bundle(connection, &artifact.artifact_id))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::ai_task_service::{
        self, tests::connection, tests::system_task_input, ClaimAiTaskAttemptInput,
    };
    use rusqlite::params;

    fn validating_task(
        connection: &mut Connection,
        operation_id: &str,
        artifact_type: &str,
        raw: &str,
    ) -> Result<(String, String), Box<dyn std::error::Error>> {
        let task = ai_task_service::create_task(
            connection,
            system_task_input(operation_id, artifact_type),
        )?;
        let queued = ai_task_service::queue_attempt(connection, &task.task_id)?;
        ai_task_service::claim_attempt(
            connection,
            ClaimAiTaskAttemptInput {
                task_id: task.task_id.clone(),
                attempt_id: queued.attempt.attempt_id.clone(),
                provider_id: "mock".to_string(),
                model_id: "mock-v1".to_string(),
                provider_request_id: Some(format!("request-{operation_id}")),
            },
        )?;
        ai_task_service::mark_provider_succeeded(
            connection,
            &task.task_id,
            &queued.attempt.attempt_id,
            serde_json::json!({
                "provider": "mock",
                "model": "mock-v1",
                "providerRequestId": format!("request-{operation_id}"),
                "responseHash": large_text_repository::sha256(raw),
                "responseLength": raw.chars().count(),
                "tokenInput": 1,
                "tokenOutput": 1,
                "tokenTotal": 2,
                "finishReason": "stop",
                "durationMs": 1
            }),
        )?;
        Ok((task.task_id, queued.attempt.attempt_id))
    }

    fn artifact_input(
        task_id: String,
        attempt_id: String,
        artifact_type: &str,
        raw: &str,
    ) -> CreateResultArtifactInput {
        CreateResultArtifactInput {
            task_id,
            attempt_id,
            artifact_type: artifact_type.to_string(),
            schema_version: 1,
            raw_content: raw.to_string(),
            display_content: None,
            structured_payload_json: None,
            parent_artifact_id: None,
            derivation_type: None,
        }
    }

    #[test]
    fn art01_valid_artifact_completes_task_and_round_trips_all_content(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let raw = r#"{"ok":true,"targetId":"provider-hint"}"#;
        let (task_id, attempt_id) =
            validating_task(&mut connection, "artifact-valid", "generic_json", raw)?;
        let bundle = create_artifact(
            &mut connection,
            artifact_input(task_id.clone(), attempt_id.clone(), "generic_json", raw),
        )?;
        assert_eq!(bundle.artifact.processing_status, "valid_with_warnings");
        assert_eq!(bundle.raw_content, raw);
        assert_eq!(
            bundle.structured_payload_json,
            Some(serde_json::from_str(raw)?)
        );
        assert_eq!(bundle.issues.len(), 1);
        let task = ai_task_repository::find_task(&connection, &task_id)?.unwrap();
        assert_eq!(task.status, "completed");
        assert_eq!(
            task.result_artifact_id.as_deref(),
            Some(bundle.artifact.artifact_id.as_str())
        );
        assert_eq!(list_task_artifacts(&connection, &task_id)?.len(), 1);
        let replay = create_artifact(
            &mut connection,
            artifact_input(task_id.clone(), attempt_id.clone(), "generic_json", raw),
        )?;
        assert_eq!(replay.artifact.artifact_id, bundle.artifact.artifact_id);
        let mut changed_replay =
            artifact_input(task_id.clone(), attempt_id.clone(), "generic_json", raw);
        changed_replay.display_content = Some("different display".to_string());
        let conflict = create_artifact(&mut connection, changed_replay)
            .expect_err("changed artifact replay must conflict");
        assert_eq!(conflict.code, codes::OPERATION_PAYLOAD_CONFLICT);
        let provider_replay = ai_task_service::mark_provider_succeeded(
            &mut connection,
            &task_id,
            &attempt_id,
            serde_json::json!({
                "provider": "mock",
                "model": "mock-v1",
                "providerRequestId": "request-artifact-valid",
                "responseHash": large_text_repository::sha256(raw),
                "responseLength": raw.chars().count(),
                "tokenInput": 1,
                "tokenOutput": 1,
                "tokenTotal": 2,
                "finishReason": "stop",
                "durationMs": 1
            }),
        )?;
        assert_eq!(provider_replay.task.status, "completed");
        Ok(())
    }

    #[test]
    fn art02_malformed_and_large_responses_keep_complete_verified_raw_body(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let malformed = "sensitive novel body ".repeat(8_000);
        let (task_id, attempt_id) = validating_task(
            &mut connection,
            "artifact-malformed",
            "generic_json",
            &malformed,
        )?;
        let invalid = create_artifact(
            &mut connection,
            artifact_input(task_id.clone(), attempt_id, "generic_json", &malformed),
        )?;
        assert_eq!(invalid.artifact.processing_status, "invalid");
        assert_eq!(invalid.raw_content, malformed);
        assert!(invalid
            .issues
            .iter()
            .any(|item| item.code == codes::ARTIFACT_PARSE_FAILED));
        assert!(invalid
            .issues
            .iter()
            .all(|item| !item.message.contains("sensitive novel body")));
        assert_eq!(
            ai_task_repository::find_task(&connection, &task_id)?
                .unwrap()
                .status,
            "failed"
        );

        let large = serde_json::json!({"body": "长正文".repeat(60_000)}).to_string();
        let (large_task, large_attempt) =
            validating_task(&mut connection, "artifact-large", "generic_json", &large)?;
        let valid = create_artifact(
            &mut connection,
            artifact_input(large_task, large_attempt, "generic_json", &large),
        )?;
        assert_eq!(valid.artifact.processing_status, "valid");
        assert_eq!(valid.raw_content, large);
        assert_eq!(
            valid.artifact.content_hash,
            large_text_repository::sha256(&large)
        );
        Ok(())
    }

    #[test]
    fn art03_cross_attempt_unknown_contract_and_raw_mismatch_leave_no_documents(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let raw_a = r#"{"a":1}"#;
        let raw_b = r#"{"b":2}"#;
        let (task_a, attempt_a) =
            validating_task(&mut connection, "artifact-cross-a", "generic_json", raw_a)?;
        let (_task_b, attempt_b) =
            validating_task(&mut connection, "artifact-cross-b", "generic_json", raw_b)?;
        let before: i64 = connection.query_row(
            "SELECT COUNT(*) FROM large_text_documents WHERE target_type='result_artifact'",
            [],
            |row| row.get(0),
        )?;
        let cross = create_artifact(
            &mut connection,
            artifact_input(task_a.clone(), attempt_b, "generic_json", raw_a),
        )
        .expect_err("cross-task attempt must fail");
        assert_eq!(cross.code, codes::AI_ATTEMPT_NOT_FOUND);
        let unknown = create_artifact(
            &mut connection,
            artifact_input(task_a.clone(), attempt_a.clone(), "future_unknown", raw_a),
        )
        .expect_err("unknown artifact contract must fail");
        assert_eq!(unknown.code, codes::ARTIFACT_TYPE_UNSUPPORTED);
        let mismatch = create_artifact(
            &mut connection,
            artifact_input(task_a, attempt_a, "generic_json", r#"{"forged":true}"#),
        )
        .expect_err("raw response identity mismatch must fail");
        assert_eq!(mismatch.code, codes::ARTIFACT_SOURCE_MISMATCH);
        let after: i64 = connection.query_row(
            "SELECT COUNT(*) FROM large_text_documents WHERE target_type='result_artifact'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(after, before);
        Ok(())
    }

    #[test]
    fn art04_snapshots_artifacts_issues_and_referenced_large_text_are_immutable(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let raw = "not-json";
        let (task_id, attempt_id) =
            validating_task(&mut connection, "artifact-immutable", "generic_json", raw)?;
        let bundle = create_artifact(
            &mut connection,
            artifact_input(task_id.clone(), attempt_id, "generic_json", raw),
        )?;
        assert!(!bundle.issues.is_empty());
        assert!(connection
            .execute(
                "UPDATE ai_input_snapshots SET payload_json='{}' WHERE task_id=?1",
                params![task_id],
            )
            .is_err());
        assert!(connection
            .execute(
                "DELETE FROM ai_context_snapshots WHERE task_id=?1",
                params![task_id],
            )
            .is_err());
        assert!(connection
            .execute(
                "UPDATE result_artifacts SET content_length=0 WHERE artifact_id=?1",
                params![bundle.artifact.artifact_id],
            )
            .is_err());
        assert!(connection
            .execute(
                "DELETE FROM result_artifacts WHERE artifact_id=?1",
                params![bundle.artifact.artifact_id],
            )
            .is_err());
        assert!(connection
            .execute(
                "UPDATE artifact_validation_issues SET message='changed' WHERE artifact_id=?1",
                params![bundle.artifact.artifact_id],
            )
            .is_err());
        assert!(connection
            .execute(
                "DELETE FROM artifact_validation_issues WHERE artifact_id=?1",
                params![bundle.artifact.artifact_id],
            )
            .is_err());
        assert!(connection
            .execute(
                "UPDATE large_text_documents SET title='changed' WHERE id=?1",
                params![bundle.artifact.raw_content_ref_id],
            )
            .is_err());
        assert!(connection.execute(
            "UPDATE large_text_chunks SET content='changed' WHERE document_id=?1 AND chunk_index=0",
            params![bundle.artifact.raw_content_ref_id],
        ).is_err());
        assert!(connection
            .execute(
                "INSERT INTO large_text_chunks
                (document_id,chunk_index,content,char_count,byte_count,chunk_sha256,created_at)
             VALUES (?1,999,'x',1,1,'hash','now')",
                params![bundle.artifact.raw_content_ref_id],
            )
            .is_err());
        Ok(())
    }

    #[test]
    fn art05_file_database_restart_reads_task_attempt_snapshots_artifact_and_issues(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!(
            "ai-novel-studio-m1-restart-{}.db",
            uuid::Uuid::new_v4()
        ));
        let (task_id, artifact_id) = {
            let mut connection = Connection::open(&path)?;
            connection.execute_batch("PRAGMA foreign_keys=ON;")?;
            crate::db::create_tables(&mut connection)?;
            let raw = r#"{"ok":true,"targetId":"hint"}"#;
            let (task_id, attempt_id) =
                validating_task(&mut connection, "artifact-restart", "generic_json", raw)?;
            let bundle = create_artifact(
                &mut connection,
                artifact_input(task_id.clone(), attempt_id, "generic_json", raw),
            )?;
            (task_id, bundle.artifact.artifact_id)
        };
        {
            let mut reopened = Connection::open(&path)?;
            reopened.execute_batch("PRAGMA foreign_keys=ON;")?;
            crate::db::create_tables(&mut reopened)?;
            let detail = ai_task_service::get_task_detail(&reopened, &task_id)?;
            assert_eq!(detail.task.status, "completed");
            assert_eq!(detail.attempts.len(), 1);
            assert!(!detail.context_snapshot.compiled_context.is_empty());
            let artifact = get_artifact_bundle(&reopened, &artifact_id)?;
            assert_eq!(artifact.artifact.task_id, task_id);
            assert_eq!(artifact.issues.len(), 1);
            assert!(artifact.structured_payload_json.is_some());
        }
        std::fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn art06_response_metadata_whitelist_rejects_raw_body_without_state_change(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let task = ai_task_service::create_task(
            &mut connection,
            system_task_input("metadata-whitelist", "generic_json"),
        )?;
        let queued = ai_task_service::queue_attempt(&mut connection, &task.task_id)?;
        ai_task_service::claim_attempt(
            &mut connection,
            ClaimAiTaskAttemptInput {
                task_id: task.task_id.clone(),
                attempt_id: queued.attempt.attempt_id.clone(),
                provider_id: "mock".to_string(),
                model_id: "mock-v1".to_string(),
                provider_request_id: None,
            },
        )?;
        let raw = r#"{"ok":true}"#;
        let error = ai_task_service::mark_provider_succeeded(
            &mut connection,
            &task.task_id,
            &queued.attempt.attempt_id,
            serde_json::json!({
                "responseHash": large_text_repository::sha256(raw),
                "responseLength": raw.chars().count(),
                "rawBody": raw
            }),
        )
        .expect_err("raw response body metadata must fail");
        assert_eq!(error.code, codes::AI_RESPONSE_METADATA_INVALID);
        let persisted = ai_task_repository::find_task(&connection, &task.task_id)?.unwrap();
        assert_eq!(persisted.status, "running");
        Ok(())
    }

    #[test]
    fn art07_retry_keeps_prior_invalid_artifact_readable() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = connection()?;
        let invalid_raw = "not-json";
        let (task_id, first_attempt) = validating_task(
            &mut connection,
            "artifact-history",
            "generic_json",
            invalid_raw,
        )?;
        let invalid = create_artifact(
            &mut connection,
            artifact_input(task_id.clone(), first_attempt, "generic_json", invalid_raw),
        )?;
        let queued = ai_task_service::queue_attempt(&mut connection, &task_id)?;
        ai_task_service::claim_attempt(
            &mut connection,
            ClaimAiTaskAttemptInput {
                task_id: task_id.clone(),
                attempt_id: queued.attempt.attempt_id.clone(),
                provider_id: "mock".to_string(),
                model_id: "mock-v1".to_string(),
                provider_request_id: Some("request-history-retry".to_string()),
            },
        )?;
        let valid_raw = r#"{"ok":true}"#;
        ai_task_service::mark_provider_succeeded(
            &mut connection,
            &task_id,
            &queued.attempt.attempt_id,
            serde_json::json!({
                "provider": "mock",
                "model": "mock-v1",
                "providerRequestId": "request-history-retry",
                "responseHash": large_text_repository::sha256(valid_raw),
                "responseLength": valid_raw.chars().count()
            }),
        )?;
        let valid = create_artifact(
            &mut connection,
            artifact_input(
                task_id.clone(),
                queued.attempt.attempt_id,
                "generic_json",
                valid_raw,
            ),
        )?;
        assert_eq!(
            get_artifact_bundle(&connection, &invalid.artifact.artifact_id)?.raw_content,
            invalid_raw
        );
        assert_eq!(
            get_artifact_bundle(&connection, &valid.artifact.artifact_id)?.raw_content,
            valid_raw
        );
        assert_eq!(list_task_artifacts(&connection, &task_id)?.len(), 2);
        Ok(())
    }
}
