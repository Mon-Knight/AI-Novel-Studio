use crate::domain::ai_task::AiTaskStatus;
use crate::errors::{codes, AppError};
use crate::repositories::{ai_task_repository, large_text_repository};
use chrono::Utc;
use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputSnapshotInput {
    pub schema_version: i64,
    pub input_type: String,
    pub payload_json: Value,
    pub body: Option<String>,
    pub source_draft_id: Option<String>,
    pub source_draft_version: Option<i64>,
    pub base_content_hash: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSnapshotInput {
    pub schema_version: i64,
    pub source_manifest_json: Value,
    pub compiled_context: Option<String>,
    pub budget_json: Value,
    pub compiler_version: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintSnapshotInput {
    pub schema_version: i64,
    pub payload_json: Value,
    pub prompt_template_id: String,
    pub prompt_template_version: String,
    pub prompt_template_hash: String,
    pub prompt_template_body: Option<String>,
    pub provider_options_json: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAiTaskInput {
    pub operation_id: String,
    pub request_hash: Option<String>,
    pub trace_id: Option<String>,
    pub task_type: String,
    pub novel_id: String,
    pub chapter_id: Option<String>,
    pub draft_id: Option<String>,
    pub scope_type: String,
    pub target_hint_json: Option<Value>,
    pub input_snapshot: InputSnapshotInput,
    pub context_snapshot: ContextSnapshotInput,
    pub constraint_snapshot: ConstraintSnapshotInput,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptResult {
    pub task: ai_task_repository::AiTaskRecord,
    pub attempt_id: String,
    pub attempt_number: i64,
}

fn contains_secret(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.iter().any(|(key, child)| {
            matches!(
                key.to_ascii_lowercase().as_str(),
                "apikey" | "api_key" | "authorization" | "secret"
            ) || contains_secret(child)
        }),
        Value::Array(items) => items.iter().any(contains_secret),
        _ => false,
    }
}

fn canonical_request_hash(input: &CreateAiTaskInput) -> String {
    let canonical = serde_json::json!({
        "taskType": input.task_type,
        "novelId": input.novel_id,
        "chapterId": input.chapter_id,
        "draftId": input.draft_id,
        "scopeType": input.scope_type,
        "targetHint": input.target_hint_json,
        "inputPayload": input.input_snapshot.payload_json,
        "inputBodyHash": input.input_snapshot.body.as_deref().map(large_text_repository::sha256),
        "sourceDraftId": input.input_snapshot.source_draft_id,
        "sourceDraftVersion": input.input_snapshot.source_draft_version,
        "baseContentHash": input.input_snapshot.base_content_hash,
        "contextManifest": input.context_snapshot.source_manifest_json,
        "compiledContextHash": input.context_snapshot.compiled_context.as_deref().map(large_text_repository::sha256),
        "constraints": input.constraint_snapshot.payload_json,
        "templateId": input.constraint_snapshot.prompt_template_id,
        "templateVersion": input.constraint_snapshot.prompt_template_version,
        "templateHash": input.constraint_snapshot.prompt_template_hash,
        "providerOptions": input.constraint_snapshot.provider_options_json,
    });
    large_text_repository::sha256(&canonical.to_string())
}

fn insert_snapshot_document(
    connection: &Connection,
    snapshot_id: &str,
    field_name: &str,
    content: Option<&str>,
    now: &str,
) -> Result<Option<String>, AppError> {
    let Some(content) = content.filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let document_id = uuid::Uuid::new_v4().to_string();
    let hash = large_text_repository::sha256(content);
    large_text_repository::insert_document_for_target(
        connection,
        &document_id,
        "ai_snapshot",
        snapshot_id,
        field_name,
        None,
        content,
        &hash,
        now,
    )?;
    Ok(Some(document_id))
}

pub fn create_task(
    connection: &mut Connection,
    input: CreateAiTaskInput,
) -> Result<ai_task_repository::AiTaskRecord, AppError> {
    if input.operation_id.trim().is_empty() {
        return Err(AppError::new(
            codes::OPERATION_PAYLOAD_CONFLICT,
            "operationId 不能为空",
            false,
        ));
    }
    if contains_secret(&input.input_snapshot.payload_json)
        || contains_secret(&input.context_snapshot.source_manifest_json)
        || contains_secret(&input.constraint_snapshot.payload_json)
        || contains_secret(&input.constraint_snapshot.provider_options_json)
    {
        return Err(AppError::new(
            codes::OPERATION_PAYLOAD_CONFLICT,
            "Snapshot 禁止包含 API Key 或授权信息",
            false,
        ));
    }
    let request_hash = canonical_request_hash(&input);
    if input
        .request_hash
        .as_deref()
        .is_some_and(|provided| provided != request_hash)
    {
        return Err(AppError::new(
            codes::OPERATION_PAYLOAD_CONFLICT,
            "requestHash 与 Task 请求不一致",
            false,
        ));
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    if let Some(existing) =
        ai_task_repository::find_by_operation(&transaction, &input.operation_id)?
    {
        if existing.request_hash != request_hash {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "同一 operationId 对应不同 Task 请求",
                false,
            ));
        }
        transaction.commit().map_err(AppError::database)?;
        return Ok(existing);
    }

    let task_id = uuid::Uuid::new_v4().to_string();
    let trace_id = input
        .trace_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let input_snapshot_id = uuid::Uuid::new_v4().to_string();
    let context_snapshot_id = uuid::Uuid::new_v4().to_string();
    let constraint_snapshot_id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let target_hint = input.target_hint_json.as_ref().map(Value::to_string);
    ai_task_repository::insert(
        &transaction,
        &task_id,
        &input.task_type,
        &input.novel_id,
        input.chapter_id.as_deref(),
        input.draft_id.as_deref(),
        &input.scope_type,
        &trace_id,
        &input.operation_id,
        &request_hash,
        target_hint.as_deref(),
        &now,
    )?;
    AiTaskStatus::Created.validate_transition(AiTaskStatus::PreparingContext)?;
    ai_task_repository::cas_status(
        &transaction,
        &task_id,
        AiTaskStatus::Created.as_str(),
        AiTaskStatus::PreparingContext.as_str(),
        &now,
    )?;

    let input_body_ref = insert_snapshot_document(
        &transaction,
        &input_snapshot_id,
        "input_body",
        input.input_snapshot.body.as_deref(),
        &now,
    )?;
    let compiled_context_ref = insert_snapshot_document(
        &transaction,
        &context_snapshot_id,
        "compiled_context",
        input.context_snapshot.compiled_context.as_deref(),
        &now,
    )?;
    let prompt_template_ref = insert_snapshot_document(
        &transaction,
        &constraint_snapshot_id,
        "prompt_template",
        input.constraint_snapshot.prompt_template_body.as_deref(),
        &now,
    )?;
    let input_payload = input.input_snapshot.payload_json.to_string();
    let input_hash = large_text_repository::sha256(
        &serde_json::json!({
            "payload": input.input_snapshot.payload_json,
            "bodyHash": input.input_snapshot.body.as_deref().map(large_text_repository::sha256),
        })
        .to_string(),
    );
    transaction
        .execute(
            "INSERT INTO ai_input_snapshots
            (snapshot_id, task_id, schema_version, input_type, payload_json, body_ref_id,
             source_draft_id, source_draft_version, base_content_hash, content_hash, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                input_snapshot_id,
                task_id,
                input.input_snapshot.schema_version,
                input.input_snapshot.input_type,
                input_payload,
                input_body_ref,
                input.input_snapshot.source_draft_id,
                input.input_snapshot.source_draft_version,
                input.input_snapshot.base_content_hash,
                input_hash,
                now
            ],
        )
        .map_err(AppError::database)?;

    let context_manifest = input.context_snapshot.source_manifest_json.to_string();
    let budget = input.context_snapshot.budget_json.to_string();
    let context_hash = large_text_repository::sha256(&serde_json::json!({
        "manifest": input.context_snapshot.source_manifest_json,
        "compiledHash": input.context_snapshot.compiled_context.as_deref().map(large_text_repository::sha256),
        "budget": input.context_snapshot.budget_json,
        "compilerVersion": input.context_snapshot.compiler_version,
    }).to_string());
    transaction
        .execute(
            "INSERT INTO ai_context_snapshots
            (snapshot_id, task_id, schema_version, source_manifest_json, compiled_context_ref_id,
             budget_json, compiler_version, content_hash, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                context_snapshot_id,
                task_id,
                input.context_snapshot.schema_version,
                context_manifest,
                compiled_context_ref,
                budget,
                input.context_snapshot.compiler_version,
                context_hash,
                now
            ],
        )
        .map_err(AppError::database)?;

    let constraint_payload = input.constraint_snapshot.payload_json.to_string();
    let provider_options = input.constraint_snapshot.provider_options_json.to_string();
    let constraint_hash = large_text_repository::sha256(
        &serde_json::json!({
            "payload": input.constraint_snapshot.payload_json,
            "templateId": input.constraint_snapshot.prompt_template_id,
            "templateVersion": input.constraint_snapshot.prompt_template_version,
            "templateHash": input.constraint_snapshot.prompt_template_hash,
            "providerOptions": input.constraint_snapshot.provider_options_json,
        })
        .to_string(),
    );
    transaction
        .execute(
            "INSERT INTO ai_constraint_snapshots
            (snapshot_id, task_id, schema_version, payload_json, prompt_template_id,
             prompt_template_version, prompt_template_hash, prompt_template_ref_id,
             provider_options_json, content_hash, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                constraint_snapshot_id,
                task_id,
                input.constraint_snapshot.schema_version,
                constraint_payload,
                input.constraint_snapshot.prompt_template_id,
                input.constraint_snapshot.prompt_template_version,
                input.constraint_snapshot.prompt_template_hash,
                prompt_template_ref,
                provider_options,
                constraint_hash,
                now
            ],
        )
        .map_err(AppError::database)?;
    ai_task_repository::link_snapshots(
        &transaction,
        &task_id,
        &input_snapshot_id,
        &context_snapshot_id,
        &constraint_snapshot_id,
    )?;
    AiTaskStatus::PreparingContext.validate_transition(AiTaskStatus::Ready)?;
    ai_task_repository::cas_status(
        &transaction,
        &task_id,
        AiTaskStatus::PreparingContext.as_str(),
        AiTaskStatus::Ready.as_str(),
        &now,
    )?;
    let created = ai_task_repository::find(&transaction, &task_id)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "AI Task 创建失败", false))?;
    transaction.commit().map_err(AppError::database)?;
    Ok(created)
}

pub fn transition_task(
    connection: &mut Connection,
    task_id: &str,
    expected_status: &str,
    next_status: &str,
) -> Result<ai_task_repository::AiTaskRecord, AppError> {
    let expected = AiTaskStatus::parse(expected_status)?;
    let next = AiTaskStatus::parse(next_status)?;
    expected.validate_transition(next)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    ai_task_repository::cas_status(
        &transaction,
        task_id,
        expected.as_str(),
        next.as_str(),
        &Utc::now().to_rfc3339(),
    )?;
    let task = ai_task_repository::find(&transaction, task_id)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "AI Task 不存在", false))?;
    transaction.commit().map_err(AppError::database)?;
    Ok(task)
}

pub fn start_attempt(
    connection: &mut Connection,
    task_id: &str,
    provider_id: Option<&str>,
) -> Result<AttemptResult, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let task = ai_task_repository::find(&transaction, task_id)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "AI Task 不存在", false))?;
    let current = AiTaskStatus::parse(&task.status)?;
    if current == AiTaskStatus::Failed {
        let retryable = task
            .error_json
            .as_deref()
            .and_then(|value| serde_json::from_str::<Value>(value).ok())
            .and_then(|value| value.get("retryable").and_then(Value::as_bool))
            .unwrap_or(false);
        if !retryable {
            return Err(AppError::new(
                codes::AI_TASK_RETRY_NOT_ALLOWED,
                "该失败不允许重试",
                false,
            ));
        }
    } else if current != AiTaskStatus::Ready {
        return Err(AppError::new(
            codes::AI_TASK_ILLEGAL_TRANSITION,
            "Task 当前不能创建 Attempt",
            false,
        ));
    }
    current.validate_transition(AiTaskStatus::Queued)?;
    let now = Utc::now().to_rfc3339();
    ai_task_repository::cas_status(&transaction, task_id, current.as_str(), "queued", &now)?;
    AiTaskStatus::Queued.validate_transition(AiTaskStatus::Running)?;
    ai_task_repository::cas_status(&transaction, task_id, "queued", "running", &now)?;
    let attempt_number = ai_task_repository::next_attempt_number(&transaction, task_id)?;
    let attempt_id = uuid::Uuid::new_v4().to_string();
    ai_task_repository::insert_attempt(
        &transaction,
        &attempt_id,
        task_id,
        attempt_number,
        provider_id,
        &now,
    )?;
    let task =
        ai_task_repository::find(&transaction, task_id)?.expect("task exists in transaction");
    transaction.commit().map_err(AppError::database)?;
    Ok(AttemptResult {
        task,
        attempt_id,
        attempt_number,
    })
}

pub fn mark_attempt_succeeded(
    connection: &mut Connection,
    task_id: &str,
    attempt_id: &str,
    response_metadata_json: Value,
) -> Result<ai_task_repository::AiTaskRecord, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    let metadata = response_metadata_json.to_string();
    ai_task_repository::set_attempt_status(
        &transaction,
        attempt_id,
        &["running", "cancel_requested"],
        "succeeded",
        Some(&metadata),
        None,
        &now,
    )?;
    ai_task_repository::cas_status(&transaction, task_id, "running", "validating", &now)?;
    let task = ai_task_repository::find(&transaction, task_id)?.expect("task exists");
    transaction.commit().map_err(AppError::database)?;
    Ok(task)
}

pub fn fail_attempt(
    connection: &mut Connection,
    task_id: &str,
    attempt_id: &str,
    error: AppError,
) -> Result<ai_task_repository::AiTaskRecord, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    let error_json = serde_json::to_string(&error).unwrap_or_else(|_| "{}".to_string());
    ai_task_repository::set_attempt_status(
        &transaction,
        attempt_id,
        &["running", "cancel_requested"],
        "failed",
        None,
        Some(&error_json),
        &now,
    )?;
    ai_task_repository::set_task_error(&transaction, task_id, &error_json)?;
    ai_task_repository::cas_status(&transaction, task_id, "running", "failed", &now)?;
    let task = ai_task_repository::find(&transaction, task_id)?.expect("task exists");
    transaction.commit().map_err(AppError::database)?;
    Ok(task)
}

pub fn cancel_task(
    connection: &mut Connection,
    task_id: &str,
) -> Result<ai_task_repository::AiTaskRecord, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let task = ai_task_repository::find(&transaction, task_id)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "AI Task 不存在", false))?;
    let status = AiTaskStatus::parse(&task.status)?;
    let now = Utc::now().to_rfc3339();
    match status {
        AiTaskStatus::Created | AiTaskStatus::Ready | AiTaskStatus::Queued => {
            status.validate_transition(AiTaskStatus::Cancelled)?;
            ai_task_repository::cas_status(
                &transaction,
                task_id,
                status.as_str(),
                "cancelled",
                &now,
            )?;
        }
        AiTaskStatus::Running | AiTaskStatus::Validating | AiTaskStatus::PreparingContext => {
            status.validate_transition(AiTaskStatus::CancelRequested)?;
            ai_task_repository::cas_status(
                &transaction,
                task_id,
                status.as_str(),
                "cancel_requested",
                &now,
            )?;
            if let Some(attempt_id) = task.current_attempt_id.as_deref() {
                ai_task_repository::set_attempt_status(
                    &transaction,
                    attempt_id,
                    &["running"],
                    "cancel_requested",
                    None,
                    None,
                    &now,
                )?;
            }
        }
        AiTaskStatus::CancelRequested => {
            status.validate_transition(AiTaskStatus::Cancelled)?;
            if let Some(attempt_id) = task.current_attempt_id.as_deref() {
                ai_task_repository::set_attempt_status(
                    &transaction,
                    attempt_id,
                    &["cancel_requested"],
                    "cancelled",
                    None,
                    None,
                    &now,
                )?;
            }
            ai_task_repository::cas_status(
                &transaction,
                task_id,
                "cancel_requested",
                "cancelled",
                &now,
            )?;
        }
        _ => {
            return Err(AppError::new(
                codes::AI_TASK_TERMINAL_STATE,
                "Task 当前不能取消",
                false,
            ))
        }
    }
    let task = ai_task_repository::find(&transaction, task_id)?.expect("task exists");
    transaction.commit().map_err(AppError::database)?;
    Ok(task)
}

pub fn record_late_response(
    connection: &mut Connection,
    task_id: &str,
    attempt_id: &str,
    response_metadata_json: Value,
) -> Result<ai_task_repository::AiTaskRecord, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let task = ai_task_repository::find(&transaction, task_id)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "AI Task 不存在", false))?;
    if task.status != "cancel_requested" && task.status != "cancelled" {
        return Err(AppError::new(
            codes::AI_TASK_ILLEGAL_TRANSITION,
            "非取消 Task 不能记录迟到响应",
            false,
        ));
    }
    let now = Utc::now().to_rfc3339();
    let metadata = response_metadata_json.to_string();
    ai_task_repository::set_attempt_status(
        &transaction,
        attempt_id,
        &["running", "cancel_requested"],
        "late_response_ignored",
        Some(&metadata),
        None,
        &now,
    )?;
    if task.status == "cancel_requested" {
        ai_task_repository::cas_status(
            &transaction,
            task_id,
            "cancel_requested",
            "cancelled",
            &now,
        )?;
    }
    let task = ai_task_repository::find(&transaction, task_id)?.expect("task exists");
    transaction.commit().map_err(AppError::database)?;
    Ok(task)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::migrations;

    pub(crate) fn connection() -> Result<Connection, Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE chapter_drafts (
                id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '', version_no INTEGER NOT NULL DEFAULT 1,
                ai_task_id TEXT, note TEXT, large_text_ref_id TEXT
             );
             CREATE TABLE quality_check_reports (
                id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
                draft_id TEXT NOT NULL, ai_task_id TEXT
             );",
        )?;
        migrations::run_migrations(&mut connection)?;
        Ok(connection)
    }

    pub(crate) fn task_input(operation_id: &str) -> CreateAiTaskInput {
        CreateAiTaskInput {
            operation_id: operation_id.to_string(),
            request_hash: None,
            trace_id: Some(format!("trace-{operation_id}")),
            task_type: "connection_test".to_string(),
            novel_id: "system".to_string(),
            chapter_id: None,
            draft_id: None,
            scope_type: "system".to_string(),
            target_hint_json: None,
            input_snapshot: InputSnapshotInput {
                schema_version: 1,
                input_type: "connection_test_input".to_string(),
                payload_json: serde_json::json!({"expected": "OK"}),
                body: None,
                source_draft_id: None,
                source_draft_version: None,
                base_content_hash: None,
            },
            context_snapshot: ContextSnapshotInput {
                schema_version: 1,
                source_manifest_json: serde_json::json!([]),
                compiled_context: Some("compiled prompt".to_string()),
                budget_json: serde_json::json!({"maxTokens": 100}),
                compiler_version: "test-v1".to_string(),
            },
            constraint_snapshot: ConstraintSnapshotInput {
                schema_version: 1,
                payload_json: serde_json::json!({"response": "OK"}),
                prompt_template_id: "connection-test".to_string(),
                prompt_template_version: "1".to_string(),
                prompt_template_hash: large_text_repository::sha256("template"),
                prompt_template_body: Some("template".to_string()),
                provider_options_json: serde_json::json!({"model": "fake"}),
            },
        }
    }

    #[test]
    fn task03_create_is_idempotent_and_conflicts_on_changed_payload(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let first = create_task(&mut connection, task_input("operation-1"))?;
        let replay = create_task(&mut connection, task_input("operation-1"))?;
        assert_eq!(first.task_id, replay.task_id);
        assert_eq!(first.status, "ready");
        let mut changed = task_input("operation-1");
        changed.input_snapshot.payload_json = serde_json::json!({"expected": "DIFFERENT"});
        let error = create_task(&mut connection, changed).expect_err("payload conflict");
        assert_eq!(error.code, codes::OPERATION_PAYLOAD_CONFLICT);
        Ok(())
    }

    #[test]
    fn task04_snapshots_are_persisted_once_without_secrets(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let task = create_task(&mut connection, task_input("operation-snapshots"))?;
        assert!(task.input_snapshot_id.is_some());
        assert!(task.context_snapshot_id.is_some());
        assert!(task.constraint_snapshot_id.is_some());
        let count: i64 = connection.query_row(
            "SELECT (SELECT COUNT(*) FROM ai_input_snapshots) +
                    (SELECT COUNT(*) FROM ai_context_snapshots) +
                    (SELECT COUNT(*) FROM ai_constraint_snapshots)",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(count, 3);
        let mut secret = task_input("operation-secret");
        secret.constraint_snapshot.provider_options_json = serde_json::json!({"apiKey": "secret"});
        assert!(create_task(&mut connection, secret).is_err());
        Ok(())
    }

    #[test]
    fn task05_cas_rejects_stale_worker_and_illegal_transition(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let task = create_task(&mut connection, task_input("operation-cas"))?;
        let attempt = start_attempt(&mut connection, &task.task_id, Some("fake"))?;
        assert_eq!(attempt.task.status, "running");
        let stale = transition_task(&mut connection, &task.task_id, "ready", "queued")
            .expect_err("stale CAS must fail");
        assert_eq!(stale.code, codes::AI_TASK_CONCURRENT_UPDATE);
        let illegal = transition_task(&mut connection, &task.task_id, "running", "completed")
            .expect_err("running cannot complete without validation");
        assert_eq!(illegal.code, codes::AI_TASK_ILLEGAL_TRANSITION);
        Ok(())
    }

    #[test]
    fn task06_double_worker_creates_only_one_attempt() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let task = create_task(&mut connection, task_input("operation-worker"))?;
        start_attempt(&mut connection, &task.task_id, Some("fake"))?;
        assert!(start_attempt(&mut connection, &task.task_id, Some("fake")).is_err());
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM ai_task_attempts WHERE task_id = ?1",
            params![task.task_id],
            |row| row.get(0),
        )?;
        assert_eq!(count, 1);
        Ok(())
    }

    #[test]
    fn task07_retry_creates_new_attempt_only_for_retryable_error(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let task = create_task(&mut connection, task_input("operation-retry"))?;
        let first = start_attempt(&mut connection, &task.task_id, Some("fake"))?;
        fail_attempt(
            &mut connection,
            &task.task_id,
            &first.attempt_id,
            AppError::new(codes::AI_PROVIDER_TIMEOUT, "timeout", true),
        )?;
        let second = start_attempt(&mut connection, &task.task_id, Some("fake"))?;
        assert_eq!(second.attempt_number, 2);
        assert_ne!(first.attempt_id, second.attempt_id);
        Ok(())
    }

    #[test]
    fn task08_cancelled_late_response_never_creates_artifact(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let task = create_task(&mut connection, task_input("operation-cancel"))?;
        let attempt = start_attempt(&mut connection, &task.task_id, Some("fake"))?;
        let cancelling = cancel_task(&mut connection, &task.task_id)?;
        assert_eq!(cancelling.status, "cancel_requested");
        let cancelled = record_late_response(
            &mut connection,
            &task.task_id,
            &attempt.attempt_id,
            serde_json::json!({"responseHash": "hash", "responseLength": 42}),
        )?;
        assert_eq!(cancelled.status, "cancelled");
        let artifact_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM result_artifacts WHERE task_id = ?1",
            params![task.task_id],
            |row| row.get(0),
        )?;
        assert_eq!(artifact_count, 0);
        Ok(())
    }

    #[test]
    fn task09_queued_cancel_creates_no_provider_attempt() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = connection()?;
        let task = create_task(&mut connection, task_input("operation-queued-cancel"))?;
        transition_task(&mut connection, &task.task_id, "ready", "queued")?;
        let cancelled = cancel_task(&mut connection, &task.task_id)?;
        assert_eq!(cancelled.status, "cancelled");
        let attempts: i64 = connection.query_row(
            "SELECT COUNT(*) FROM ai_task_attempts WHERE task_id = ?1",
            params![task.task_id],
            |row| row.get(0),
        )?;
        assert_eq!(attempts, 0);
        Ok(())
    }

    #[test]
    fn task10_non_retryable_failure_cannot_create_second_attempt(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let task = create_task(&mut connection, task_input("operation-no-retry"))?;
        let attempt = start_attempt(&mut connection, &task.task_id, Some("fake"))?;
        fail_attempt(
            &mut connection,
            &task.task_id,
            &attempt.attempt_id,
            AppError::new(codes::AI_PROVIDER_MALFORMED_RESPONSE, "bad response", false),
        )?;
        let error = start_attempt(&mut connection, &task.task_id, Some("fake"))
            .expect_err("non-retryable failure");
        assert_eq!(error.code, codes::AI_TASK_RETRY_NOT_ALLOWED);
        Ok(())
    }

    #[test]
    fn task11_late_response_metadata_excludes_response_body(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let task = create_task(&mut connection, task_input("operation-late-metadata"))?;
        let attempt = start_attempt(&mut connection, &task.task_id, Some("fake"))?;
        cancel_task(&mut connection, &task.task_id)?;
        record_late_response(
            &mut connection,
            &task.task_id,
            &attempt.attempt_id,
            serde_json::json!({"responseHash": "hash", "responseLength": 999}),
        )?;
        let metadata: String = connection.query_row(
            "SELECT response_metadata_json FROM ai_task_attempts WHERE attempt_id = ?1",
            params![attempt.attempt_id],
            |row| row.get(0),
        )?;
        assert!(metadata.contains("responseHash"));
        assert!(!metadata.contains("full response"));
        Ok(())
    }

    #[test]
    fn task12_snapshot_update_is_rejected_by_immutable_boundary(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let task = create_task(&mut connection, task_input("operation-immutable"))?;
        let result = connection.execute(
            "UPDATE ai_input_snapshots SET payload_json = '{}' WHERE task_id = ?1",
            params![task.task_id],
        );
        assert!(result.is_err());
        Ok(())
    }

    #[test]
    fn task13_completed_task_cannot_be_restarted() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let task = create_task(&mut connection, task_input("operation-completed"))?;
        let attempt = start_attempt(&mut connection, &task.task_id, Some("fake"))?;
        mark_attempt_succeeded(
            &mut connection,
            &task.task_id,
            &attempt.attempt_id,
            serde_json::json!({"responseHash": "hash", "responseLength": 2}),
        )?;
        transition_task(&mut connection, &task.task_id, "validating", "completed")?;
        assert!(start_attempt(&mut connection, &task.task_id, Some("fake")).is_err());
        Ok(())
    }

    #[test]
    fn task14_client_request_hash_mismatch_fails_closed() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = connection()?;
        let mut input = task_input("operation-request-hash");
        input.request_hash = Some("wrong".to_string());
        let error = create_task(&mut connection, input).expect_err("request hash mismatch");
        assert_eq!(error.code, codes::OPERATION_PAYLOAD_CONFLICT);
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM ai_tasks", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        Ok(())
    }

    #[test]
    fn task15_abort_acknowledgement_finalizes_cancellation(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let task = create_task(&mut connection, task_input("operation-cancel-ack"))?;
        let attempt = start_attempt(&mut connection, &task.task_id, Some("fake"))?;
        let requested = cancel_task(&mut connection, &task.task_id)?;
        assert_eq!(requested.status, "cancel_requested");
        let cancelled = cancel_task(&mut connection, &task.task_id)?;
        assert_eq!(cancelled.status, "cancelled");
        let attempt_status: String = connection.query_row(
            "SELECT status FROM ai_task_attempts WHERE attempt_id = ?1",
            params![attempt.attempt_id],
            |row| row.get(0),
        )?;
        assert_eq!(attempt_status, "cancelled");
        Ok(())
    }
}
