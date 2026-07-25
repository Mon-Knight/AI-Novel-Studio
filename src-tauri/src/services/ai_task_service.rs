use crate::domain::ai_task::{
    is_supported_scope, is_supported_task_type, AiAttemptStatus, AiTaskStatus,
};
use crate::domain::result_artifact::is_supported_artifact_contract;
use crate::errors::{codes, AppError};
use crate::repositories::{ai_task_repository, draft_repository, large_text_repository};
use crate::services::ai_fact_security::{
    self, canonical_hash, canonical_json, REQUEST_HASH_VERSION,
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputSnapshotInput {
    pub schema_version: i64,
    pub input_type: String,
    pub payload_json: Value,
    #[serde(default)]
    pub body: String,
    pub source_draft_id: Option<String>,
    pub source_draft_version: Option<i64>,
    pub base_content_hash: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSnapshotInput {
    pub schema_version: i64,
    pub source_manifest_json: Value,
    #[serde(default)]
    pub compiled_context: String,
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
    #[serde(default)]
    pub prompt_template_body: String,
    pub provider_options_json: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAiTaskInput {
    pub operation_id: String,
    pub request_hash_version: Option<i64>,
    pub request_hash: Option<String>,
    pub trace_id: Option<String>,
    pub task_type: String,
    pub novel_id: String,
    pub chapter_id: Option<String>,
    pub draft_id: Option<String>,
    pub scope_type: String,
    pub expected_artifact_type: String,
    pub expected_artifact_schema_version: i64,
    pub target_hint_json: Option<Value>,
    pub input_snapshot: InputSnapshotInput,
    pub context_snapshot: ContextSnapshotInput,
    pub constraint_snapshot: ConstraintSnapshotInput,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimAiTaskAttemptInput {
    pub task_id: String,
    pub attempt_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub provider_request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskAttemptResult {
    pub task: ai_task_repository::AiTaskRecord,
    pub attempt: ai_task_repository::AiTaskAttemptRecord,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiInputSnapshotBundle {
    #[serde(flatten)]
    pub snapshot: ai_task_repository::AiInputSnapshotRecord,
    pub body: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextSnapshotBundle {
    #[serde(flatten)]
    pub snapshot: ai_task_repository::AiContextSnapshotRecord,
    pub compiled_context: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConstraintSnapshotBundle {
    #[serde(flatten)]
    pub snapshot: ai_task_repository::AiConstraintSnapshotRecord,
    pub prompt_template_body: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskDetail {
    pub task: ai_task_repository::AiTaskRecord,
    pub attempts: Vec<ai_task_repository::AiTaskAttemptRecord>,
    pub input_snapshot: AiInputSnapshotBundle,
    pub context_snapshot: AiContextSnapshotBundle,
    pub constraint_snapshot: AiConstraintSnapshotBundle,
}

fn commit_transaction(
    transaction: rusqlite::Transaction<'_>,
    operation_id: Option<&str>,
) -> Result<(), AppError> {
    transaction.commit().map_err(|error| {
        AppError::new(
            codes::DATABASE_COMMIT_UNKNOWN,
            "AI 执行事实提交状态未知，请按原身份重新读取或重试",
            true,
        )
        .with_context(None, operation_id)
        .with_details(serde_json::json!({ "sqliteError": error.to_string() }))
    })
}

fn input_snapshot_hash(input: &InputSnapshotInput, body_hash: &str) -> Result<String, AppError> {
    canonical_hash(&serde_json::json!({
        "schemaVersion": input.schema_version,
        "inputType": input.input_type,
        "payload": input.payload_json,
        "bodyHash": body_hash,
        "sourceDraftId": input.source_draft_id,
        "sourceDraftVersion": input.source_draft_version,
        "baseContentHash": input.base_content_hash,
    }))
}

fn context_snapshot_hash(
    input: &ContextSnapshotInput,
    compiled_hash: &str,
) -> Result<String, AppError> {
    canonical_hash(&serde_json::json!({
        "schemaVersion": input.schema_version,
        "sourceManifest": input.source_manifest_json,
        "compiledContextHash": compiled_hash,
        "budget": input.budget_json,
        "compilerVersion": input.compiler_version,
    }))
}

fn constraint_snapshot_hash(
    input: &ConstraintSnapshotInput,
    actual_template_hash: &str,
) -> Result<String, AppError> {
    canonical_hash(&serde_json::json!({
        "schemaVersion": input.schema_version,
        "payload": input.payload_json,
        "promptTemplateId": input.prompt_template_id,
        "promptTemplateVersion": input.prompt_template_version,
        "declaredPromptTemplateHash": input.prompt_template_hash,
        "actualPromptTemplateHash": actual_template_hash,
        "providerOptions": input.provider_options_json,
    }))
}

#[allow(clippy::too_many_arguments)]
fn request_hash(
    input: &CreateAiTaskInput,
    input_hash: &str,
    context_hash: &str,
    constraint_hash: &str,
) -> Result<String, AppError> {
    canonical_hash(&serde_json::json!({
        "requestContractVersion": REQUEST_HASH_VERSION,
        "taskType": input.task_type,
        "scopeType": input.scope_type,
        "novelId": input.novel_id,
        "chapterId": input.chapter_id,
        "draftId": input.draft_id,
        "expectedArtifactType": input.expected_artifact_type,
        "expectedArtifactSchemaVersion": input.expected_artifact_schema_version,
        "targetHint": input.target_hint_json,
        "inputSnapshotHash": input_hash,
        "contextSnapshotHash": context_hash,
        "constraintSnapshotHash": constraint_hash,
    }))
}

fn validate_create_input(input: &CreateAiTaskInput) -> Result<(), AppError> {
    ai_fact_security::validate_identifier(&input.operation_id, "operationId", 160)?;
    if input
        .request_hash_version
        .is_some_and(|value| value != REQUEST_HASH_VERSION)
    {
        return Err(AppError::new(
            codes::OPERATION_PAYLOAD_CONFLICT,
            "requestHashVersion 与当前契约不一致",
            false,
        ));
    }
    if !is_supported_task_type(&input.task_type) {
        return Err(AppError::new(
            codes::AI_TASK_TYPE_UNSUPPORTED,
            "当前版本不支持该 AI Task 类型",
            false,
        ));
    }
    if !is_supported_scope(&input.scope_type) {
        return Err(AppError::new(
            codes::AI_TASK_INPUT_INVALID,
            "AI Task scopeType 无效",
            false,
        ));
    }
    if !is_supported_artifact_contract(
        &input.expected_artifact_type,
        input.expected_artifact_schema_version,
    ) {
        return Err(AppError::new(
            codes::ARTIFACT_TYPE_UNSUPPORTED,
            "当前版本不支持该 Artifact 类型或 schemaVersion",
            false,
        ));
    }
    if input.scope_type == "system" {
        if input.task_type != "connection_test"
            || input.novel_id != "system"
            || input.chapter_id.is_some()
            || input.draft_id.is_some()
        {
            return Err(AppError::new(
                codes::AI_TASK_INPUT_INVALID,
                "system scope 仅允许连接测试",
                false,
            ));
        }
    } else {
        ai_fact_security::validate_identifier(&input.novel_id, "novelId", 160)?;
    }
    match input.scope_type.as_str() {
        "system" | "novel" if input.chapter_id.is_some() || input.draft_id.is_some() => {
            return Err(AppError::new(
                codes::AI_TASK_INPUT_INVALID,
                "Task 目标层级不一致",
                false,
            ));
        }
        "chapter" if input.chapter_id.is_none() || input.draft_id.is_some() => {
            return Err(AppError::new(
                codes::AI_TASK_INPUT_INVALID,
                "章节 Task 目标不完整",
                false,
            ));
        }
        "draft" | "selection" if input.chapter_id.is_none() || input.draft_id.is_none() => {
            return Err(AppError::new(
                codes::AI_TASK_INPUT_INVALID,
                "草稿 Task 目标不完整",
                false,
            ));
        }
        _ => {}
    }
    for (version, label) in [
        (input.input_snapshot.schema_version, "Input Snapshot"),
        (input.context_snapshot.schema_version, "Context Snapshot"),
        (
            input.constraint_snapshot.schema_version,
            "Constraint Snapshot",
        ),
    ] {
        if version < 1 {
            return Err(AppError::new(
                codes::AI_TASK_INPUT_INVALID,
                format!("{label} schemaVersion 无效"),
                false,
            ));
        }
    }
    ai_fact_security::validate_identifier(&input.input_snapshot.input_type, "inputType", 96)?;
    ai_fact_security::validate_identifier(
        &input.context_snapshot.compiler_version,
        "compilerVersion",
        96,
    )?;
    ai_fact_security::validate_identifier(
        &input.constraint_snapshot.prompt_template_id,
        "promptTemplateId",
        160,
    )?;
    ai_fact_security::validate_identifier(
        &input.constraint_snapshot.prompt_template_version,
        "promptTemplateVersion",
        96,
    )?;
    ai_fact_security::validate_metadata(&input.input_snapshot.payload_json, "Input Snapshot")?;
    ai_fact_security::validate_metadata(
        &input.context_snapshot.source_manifest_json,
        "Context 来源清单",
    )?;
    ai_fact_security::validate_metadata(&input.context_snapshot.budget_json, "Context 预算")?;
    ai_fact_security::validate_metadata(
        &input.constraint_snapshot.payload_json,
        "Constraint Snapshot",
    )?;
    ai_fact_security::validate_provider_options(&input.constraint_snapshot.provider_options_json)?;
    if let Some(target_hint) = input.target_hint_json.as_ref() {
        ai_fact_security::validate_metadata(target_hint, "Task 目标提示")?;
    }
    ai_fact_security::validate_body(&input.input_snapshot.body, "Input 正文")?;
    ai_fact_security::validate_body(&input.context_snapshot.compiled_context, "编译上下文")?;
    ai_fact_security::validate_body(
        &input.constraint_snapshot.prompt_template_body,
        "Prompt 模板",
    )?;
    Ok(())
}

fn read_draft_content(
    connection: &Connection,
    draft: &draft_repository::DraftRecord,
) -> Result<(String, String), AppError> {
    let verified = if let Some(document_id) = draft.large_text_ref_id.as_deref() {
        large_text_repository::read_verified_for_draft(
            connection,
            document_id,
            &draft.id,
            &draft.chapter_id,
        )?
    } else {
        let hash = large_text_repository::sha256(&draft.content);
        crate::repositories::large_text_repository::VerifiedContent {
            content: draft.content.clone(),
            content_hash: hash,
            content_length: draft.content.chars().count(),
        }
    };
    if draft
        .content_hash
        .as_deref()
        .is_some_and(|expected| !expected.eq_ignore_ascii_case(&verified.content_hash))
    {
        return Err(AppError::new(
            codes::DOCUMENT_HASH_MISMATCH,
            "来源草稿完整性校验失败",
            false,
        ));
    }
    Ok((verified.content, verified.content_hash))
}

fn validate_target(connection: &Connection, input: &CreateAiTaskInput) -> Result<(), AppError> {
    if input.scope_type == "system" {
        return Ok(());
    }
    if input.scope_type == "novel" {
        let exists = connection
            .query_row(
                "SELECT 1 FROM novels WHERE id = ?1 AND deleted_at IS NULL",
                params![input.novel_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(AppError::database)?;
        if exists.is_none() {
            return Err(AppError::new(
                codes::TARGET_NOVEL_NOT_FOUND,
                "目标作品不存在",
                false,
            ));
        }
    } else {
        draft_repository::validate_target(
            connection,
            &input.novel_id,
            input
                .chapter_id
                .as_deref()
                .expect("validated chapter target"),
        )?;
    }
    if matches!(input.scope_type.as_str(), "system" | "novel" | "chapter") {
        if input.input_snapshot.source_draft_id.is_some()
            || input.input_snapshot.source_draft_version.is_some()
            || input.input_snapshot.base_content_hash.is_some()
        {
            return Err(AppError::new(
                codes::AI_TASK_INPUT_INVALID,
                "非草稿 Task 不得伪造草稿基线",
                false,
            ));
        }
        return Ok(());
    }

    let draft_id = input.draft_id.as_deref().expect("validated draft target");
    let draft = draft_repository::find_draft(connection, draft_id)?
        .ok_or_else(|| AppError::new(codes::TARGET_DRAFT_NOT_FOUND, "目标草稿不存在", false))?;
    if draft.novel_id != input.novel_id
        || Some(draft.chapter_id.as_str()) != input.chapter_id.as_deref()
        || input.input_snapshot.source_draft_id.as_deref() != Some(draft_id)
        || input.input_snapshot.source_draft_version != Some(draft.version_no)
    {
        return Err(AppError::new(
            codes::DOCUMENT_VERSION_CONFLICT,
            "Task 草稿来源身份与当前目标不一致",
            false,
        ));
    }
    let (_, actual_hash) = read_draft_content(connection, &draft)?;
    if input
        .input_snapshot
        .base_content_hash
        .as_deref()
        .is_none_or(|expected| expected != actual_hash)
    {
        return Err(AppError::new(
            codes::DOCUMENT_HASH_MISMATCH,
            "Task 草稿基线 hash 与权威正文不一致",
            false,
        ));
    }
    Ok(())
}

fn insert_snapshot_document(
    connection: &Connection,
    snapshot_id: &str,
    field_name: &str,
    content: &str,
    now: &str,
) -> Result<(String, String), AppError> {
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
    Ok((document_id, hash))
}

pub fn create_task(
    connection: &mut Connection,
    input: CreateAiTaskInput,
) -> Result<ai_task_repository::AiTaskRecord, AppError> {
    validate_create_input(&input)?;
    let body_hash = large_text_repository::sha256(&input.input_snapshot.body);
    let compiled_hash = large_text_repository::sha256(&input.context_snapshot.compiled_context);
    let actual_template_hash =
        large_text_repository::sha256(&input.constraint_snapshot.prompt_template_body);
    if input.constraint_snapshot.prompt_template_hash != actual_template_hash {
        return Err(AppError::new(
            codes::DOCUMENT_HASH_MISMATCH,
            "Prompt 模板正文与声明 hash 不一致",
            false,
        ));
    }
    let input_hash = input_snapshot_hash(&input.input_snapshot, &body_hash)?;
    let context_hash = context_snapshot_hash(&input.context_snapshot, &compiled_hash)?;
    let constraint_hash =
        constraint_snapshot_hash(&input.constraint_snapshot, &actual_template_hash)?;
    let calculated_request_hash =
        request_hash(&input, &input_hash, &context_hash, &constraint_hash)?;
    if input
        .request_hash
        .as_deref()
        .is_some_and(|provided| provided != calculated_request_hash)
    {
        return Err(AppError::new(
            codes::OPERATION_PAYLOAD_CONFLICT,
            "requestHash 与服务器规范化请求不一致",
            false,
        ));
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    if let Some(existing) =
        ai_task_repository::find_task_by_operation(&transaction, &input.operation_id)?
    {
        if existing.request_hash_version != REQUEST_HASH_VERSION
            || existing.request_hash != calculated_request_hash
        {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "同一 operationId 对应不同 AI Task 请求",
                false,
            ));
        }
        commit_transaction(transaction, Some(&existing.operation_id))?;
        get_task_detail(connection, &existing.task_id)?;
        return Ok(existing);
    }
    validate_target(&transaction, &input)?;

    let task_id = uuid::Uuid::new_v4().to_string();
    let input_snapshot_id = uuid::Uuid::new_v4().to_string();
    let context_snapshot_id = uuid::Uuid::new_v4().to_string();
    let constraint_snapshot_id = uuid::Uuid::new_v4().to_string();
    let trace_id = input
        .trace_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&task_id)
        .to_string();
    ai_fact_security::validate_identifier(&trace_id, "traceId", 128)?;
    let now = Utc::now().to_rfc3339();
    let (body_ref_id, inserted_body_hash) = insert_snapshot_document(
        &transaction,
        &input_snapshot_id,
        "input_body",
        &input.input_snapshot.body,
        &now,
    )?;
    let (compiled_context_ref_id, inserted_compiled_hash) = insert_snapshot_document(
        &transaction,
        &context_snapshot_id,
        "compiled_context",
        &input.context_snapshot.compiled_context,
        &now,
    )?;
    let (prompt_template_ref_id, inserted_template_hash) = insert_snapshot_document(
        &transaction,
        &constraint_snapshot_id,
        "prompt_template",
        &input.constraint_snapshot.prompt_template_body,
        &now,
    )?;
    debug_assert_eq!(body_hash, inserted_body_hash);
    debug_assert_eq!(compiled_hash, inserted_compiled_hash);
    debug_assert_eq!(actual_template_hash, inserted_template_hash);

    let target_hint_json = input
        .target_hint_json
        .as_ref()
        .map(canonical_json)
        .transpose()?;
    ai_task_repository::insert_task(
        &transaction,
        &ai_task_repository::NewTask {
            task_id: &task_id,
            task_type: &input.task_type,
            novel_id: &input.novel_id,
            chapter_id: input.chapter_id.as_deref(),
            draft_id: input.draft_id.as_deref(),
            scope_type: &input.scope_type,
            input_snapshot_id: &input_snapshot_id,
            context_snapshot_id: &context_snapshot_id,
            constraint_snapshot_id: &constraint_snapshot_id,
            trace_id: &trace_id,
            operation_id: &input.operation_id,
            request_hash_version: REQUEST_HASH_VERSION,
            request_hash: &calculated_request_hash,
            expected_artifact_type: &input.expected_artifact_type,
            expected_artifact_schema_version: input.expected_artifact_schema_version,
            target_hint_json: target_hint_json.as_deref(),
            now: &now,
        },
    )?;
    ai_task_repository::insert_input_snapshot(
        &transaction,
        &input_snapshot_id,
        &task_id,
        input.input_snapshot.schema_version,
        &input.input_snapshot.input_type,
        &canonical_json(&input.input_snapshot.payload_json)?,
        &body_ref_id,
        input.input_snapshot.source_draft_id.as_deref(),
        input.input_snapshot.source_draft_version,
        input.input_snapshot.base_content_hash.as_deref(),
        &input_hash,
        &now,
    )?;
    ai_task_repository::insert_context_snapshot(
        &transaction,
        &context_snapshot_id,
        &task_id,
        input.context_snapshot.schema_version,
        &canonical_json(&input.context_snapshot.source_manifest_json)?,
        &compiled_context_ref_id,
        &canonical_json(&input.context_snapshot.budget_json)?,
        &input.context_snapshot.compiler_version,
        &context_hash,
        &now,
    )?;
    ai_task_repository::insert_constraint_snapshot(
        &transaction,
        &constraint_snapshot_id,
        &task_id,
        input.constraint_snapshot.schema_version,
        &canonical_json(&input.constraint_snapshot.payload_json)?,
        &input.constraint_snapshot.prompt_template_id,
        &input.constraint_snapshot.prompt_template_version,
        &actual_template_hash,
        &prompt_template_ref_id,
        &canonical_json(&input.constraint_snapshot.provider_options_json)?,
        &constraint_hash,
        &now,
    )?;
    let created = ai_task_repository::find_task(&transaction, &task_id)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "AI Task 创建失败", false))?;
    commit_transaction(transaction, Some(&created.operation_id))?;
    Ok(created)
}

pub fn queue_attempt(
    connection: &mut Connection,
    task_id: &str,
) -> Result<AiTaskAttemptResult, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let task = ai_task_repository::find_task(&transaction, task_id)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "AI Task 不存在", false))?;
    let status = AiTaskStatus::parse(&task.status)?;
    if status == AiTaskStatus::Queued {
        let attempt_id = task.current_attempt_id.as_deref().ok_or_else(|| {
            AppError::new(codes::AI_ATTEMPT_NOT_FOUND, "排队 Task 缺少 Attempt", false)
        })?;
        let attempt = ai_task_repository::find_attempt(&transaction, task_id, attempt_id)?
            .filter(|attempt| attempt.status == "queued")
            .ok_or_else(|| {
                AppError::new(codes::AI_ATTEMPT_NOT_FOUND, "排队 Attempt 不可用", false)
            })?;
        commit_transaction(transaction, Some(&task.operation_id))?;
        return Ok(AiTaskAttemptResult { task, attempt });
    }
    if status == AiTaskStatus::Failed {
        let retryable = task
            .error_json
            .as_ref()
            .and_then(|value| value.get("retryable"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !retryable {
            return Err(AppError::new(
                codes::AI_TASK_RETRY_NOT_ALLOWED,
                "该失败不允许直接重试",
                false,
            ));
        }
    } else if status != AiTaskStatus::Ready {
        return Err(AppError::new(
            codes::AI_TASK_ILLEGAL_TRANSITION,
            "Task 当前不能进入队列",
            false,
        ));
    }
    status.validate_transition(AiTaskStatus::Queued)?;
    let attempt_number = ai_task_repository::next_attempt_number(&transaction, task_id)?;
    let attempt_id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    ai_task_repository::insert_queued_attempt(
        &transaction,
        &task,
        &attempt_id,
        attempt_number,
        &now,
    )?;
    let task = ai_task_repository::find_task(&transaction, task_id)?.expect("task exists");
    let attempt = ai_task_repository::find_attempt(&transaction, task_id, &attempt_id)?
        .expect("attempt exists");
    commit_transaction(transaction, Some(&task.operation_id))?;
    Ok(AiTaskAttemptResult { task, attempt })
}

pub fn claim_attempt(
    connection: &mut Connection,
    input: ClaimAiTaskAttemptInput,
) -> Result<AiTaskAttemptResult, AppError> {
    ai_fact_security::validate_identifier(&input.provider_id, "providerId", 160)?;
    ai_fact_security::validate_identifier(&input.model_id, "modelId", 160)?;
    if let Some(provider_request_id) = input.provider_request_id.as_deref() {
        ai_fact_security::validate_identifier(provider_request_id, "providerRequestId", 160)?;
    }
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
    if task.status == "running"
        && attempt.status == "running"
        && task.current_attempt_id.as_deref() == Some(&input.attempt_id)
    {
        let same_claim = attempt.provider_id.as_deref() == Some(input.provider_id.as_str())
            && attempt.model_id.as_deref() == Some(input.model_id.as_str())
            && attempt.provider_request_id == input.provider_request_id;
        if same_claim {
            commit_transaction(transaction, Some(&task.operation_id))?;
            return Ok(AiTaskAttemptResult { task, attempt });
        }
        return Err(AppError::new(
            codes::OPERATION_PAYLOAD_CONFLICT,
            "Attempt 已由不同 Provider 身份领取",
            false,
        ));
    }
    if task.status != "queued"
        || attempt.status != "queued"
        || task.current_attempt_id.as_deref() != Some(&input.attempt_id)
    {
        return Err(AppError::new(
            codes::AI_TASK_CONCURRENT_UPDATE,
            "AI Attempt 已被其他执行者领取",
            true,
        ));
    }
    AiTaskStatus::Queued.validate_transition(AiTaskStatus::Running)?;
    let now = Utc::now().to_rfc3339();
    ai_task_repository::claim_attempt(
        &transaction,
        &task,
        &attempt,
        &input.provider_id,
        &input.model_id,
        input.provider_request_id.as_deref(),
        &now,
    )?;
    let task = ai_task_repository::find_task(&transaction, &input.task_id)?.expect("task exists");
    let attempt =
        ai_task_repository::find_attempt(&transaction, &input.task_id, &input.attempt_id)?
            .expect("attempt exists");
    commit_transaction(transaction, Some(&task.operation_id))?;
    Ok(AiTaskAttemptResult { task, attempt })
}

fn response_identity(metadata: &Value) -> Result<(&str, i64), AppError> {
    ai_fact_security::validate_response_metadata(metadata)?;
    let hash = metadata
        .get("responseHash")
        .and_then(Value::as_str)
        .filter(|value| {
            value.len() == 64
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
        .ok_or_else(|| {
            AppError::new(
                codes::AI_RESPONSE_METADATA_INVALID,
                "Provider 响应缺少有效 responseHash",
                false,
            )
        })?;
    let length = metadata
        .get("responseLength")
        .and_then(Value::as_i64)
        .filter(|value| *value >= 0)
        .ok_or_else(|| {
            AppError::new(
                codes::AI_RESPONSE_METADATA_INVALID,
                "Provider 响应缺少有效 responseLength",
                false,
            )
        })?;
    Ok((hash, length))
}

pub fn mark_provider_succeeded(
    connection: &mut Connection,
    task_id: &str,
    attempt_id: &str,
    response_metadata_json: Value,
) -> Result<AiTaskAttemptResult, AppError> {
    response_identity(&response_metadata_json)?;
    let metadata_json = canonical_json(&response_metadata_json)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let task = ai_task_repository::find_task(&transaction, task_id)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "AI Task 不存在", false))?;
    let attempt = ai_task_repository::find_attempt(&transaction, task_id, attempt_id)?
        .ok_or_else(|| AppError::new(codes::AI_ATTEMPT_NOT_FOUND, "AI Attempt 不存在", false))?;
    let metadata_provider = response_metadata_json
        .get("provider")
        .and_then(Value::as_str);
    let metadata_model = response_metadata_json.get("model").and_then(Value::as_str);
    let metadata_request = response_metadata_json
        .get("providerRequestId")
        .and_then(Value::as_str);
    if metadata_provider != attempt.provider_id.as_deref()
        || metadata_model != attempt.model_id.as_deref()
        || (attempt.provider_request_id.is_some()
            && metadata_request != attempt.provider_request_id.as_deref())
        || (attempt.provider_request_id.is_none() && metadata_request.is_some())
    {
        return Err(AppError::new(
            codes::AI_RESPONSE_METADATA_INVALID,
            "Provider 响应身份与当前 Attempt 不一致",
            false,
        ));
    }
    if task.current_attempt_id.as_deref() != Some(attempt_id) {
        return Err(AppError::new(
            codes::AI_TASK_CONCURRENT_UPDATE,
            "Attempt 不属于 Task 的当前执行",
            false,
        ));
    }
    if matches!(
        attempt.status.as_str(),
        "succeeded" | "late_response_ignored"
    ) {
        if attempt.response_metadata_json.as_ref() != Some(&response_metadata_json) {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "同一 Attempt 对应了不同 Provider 响应身份",
                false,
            ));
        }
        let replay_status_ok = (attempt.status == "succeeded"
            && matches!(task.status.as_str(), "validating" | "completed" | "failed"))
            || (attempt.status == "late_response_ignored" && task.status == "cancelled");
        if replay_status_ok {
            commit_transaction(transaction, Some(&task.operation_id))?;
            return Ok(AiTaskAttemptResult { task, attempt });
        }
    }
    let now = Utc::now().to_rfc3339();
    if matches!(task.status.as_str(), "cancel_requested" | "cancelled") {
        if !matches!(
            attempt.status.as_str(),
            "running" | "cancel_requested" | "cancelled"
        ) {
            return Err(AppError::new(
                codes::AI_TASK_CONCURRENT_UPDATE,
                "Attempt 已进入其他终态",
                false,
            ));
        }
        ai_task_repository::cas_attempt_status(
            &transaction,
            task_id,
            attempt_id,
            &attempt.status,
            attempt.state_revision,
            AiAttemptStatus::LateResponseIgnored.as_str(),
            Some(&metadata_json),
            None,
            &now,
        )?;
        if task.status == "cancel_requested" {
            ai_task_repository::cas_task_status(
                &transaction,
                &task,
                AiTaskStatus::Cancelled.as_str(),
                None,
                &now,
            )?;
        }
    } else {
        if task.status != "running" || attempt.status != "running" {
            return Err(AppError::new(
                codes::AI_TASK_ILLEGAL_TRANSITION,
                "Task 当前不能接收 Provider 成功响应",
                false,
            ));
        }
        ai_task_repository::cas_attempt_status(
            &transaction,
            task_id,
            attempt_id,
            "running",
            attempt.state_revision,
            AiAttemptStatus::Succeeded.as_str(),
            Some(&metadata_json),
            None,
            &now,
        )?;
        ai_task_repository::cas_task_status(
            &transaction,
            &task,
            AiTaskStatus::Validating.as_str(),
            None,
            &now,
        )?;
    }
    let task = ai_task_repository::find_task(&transaction, task_id)?.expect("task exists");
    let attempt = ai_task_repository::find_attempt(&transaction, task_id, attempt_id)?
        .expect("attempt exists");
    commit_transaction(transaction, Some(&task.operation_id))?;
    Ok(AiTaskAttemptResult { task, attempt })
}

pub fn fail_attempt(
    connection: &mut Connection,
    task_id: &str,
    attempt_id: &str,
    error: AppError,
) -> Result<AiTaskAttemptResult, AppError> {
    let safe_error = ai_fact_security::safe_error_json(&error);
    let error_json = canonical_json(&safe_error)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let task = ai_task_repository::find_task(&transaction, task_id)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "AI Task 不存在", false))?;
    let attempt = ai_task_repository::find_attempt(&transaction, task_id, attempt_id)?
        .ok_or_else(|| AppError::new(codes::AI_ATTEMPT_NOT_FOUND, "AI Attempt 不存在", false))?;
    if task.status == "failed" && attempt.status == "failed" {
        if attempt.error_json.as_ref() != Some(&safe_error)
            || task.error_json.as_ref() != Some(&safe_error)
        {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "同一 Attempt 对应了不同失败身份",
                false,
            ));
        }
        commit_transaction(transaction, Some(&task.operation_id))?;
        return Ok(AiTaskAttemptResult { task, attempt });
    }
    if task.status != "running"
        || attempt.status != "running"
        || task.current_attempt_id.as_deref() != Some(attempt_id)
    {
        return Err(AppError::new(
            codes::AI_TASK_CONCURRENT_UPDATE,
            "Task 或 Attempt 已变化",
            true,
        ));
    }
    let now = Utc::now().to_rfc3339();
    ai_task_repository::cas_attempt_status(
        &transaction,
        task_id,
        attempt_id,
        "running",
        attempt.state_revision,
        AiAttemptStatus::Failed.as_str(),
        None,
        Some(&error_json),
        &now,
    )?;
    ai_task_repository::cas_task_status(
        &transaction,
        &task,
        AiTaskStatus::Failed.as_str(),
        Some(&error_json),
        &now,
    )?;
    let task = ai_task_repository::find_task(&transaction, task_id)?.expect("task exists");
    let attempt = ai_task_repository::find_attempt(&transaction, task_id, attempt_id)?
        .expect("attempt exists");
    commit_transaction(transaction, Some(&task.operation_id))?;
    Ok(AiTaskAttemptResult { task, attempt })
}

pub fn cancel_task(
    connection: &mut Connection,
    task_id: &str,
) -> Result<ai_task_repository::AiTaskRecord, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let task = ai_task_repository::find_task(&transaction, task_id)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "AI Task 不存在", false))?;
    let now = Utc::now().to_rfc3339();
    match task.status.as_str() {
        "created" | "ready" => {
            ai_task_repository::cas_task_status(&transaction, &task, "cancelled", None, &now)?;
        }
        "queued" => {
            let attempt_id = task.current_attempt_id.as_deref().ok_or_else(|| {
                AppError::new(codes::AI_ATTEMPT_NOT_FOUND, "排队 Task 缺少 Attempt", false)
            })?;
            let attempt = ai_task_repository::find_attempt(&transaction, task_id, attempt_id)?
                .ok_or_else(|| {
                    AppError::new(codes::AI_ATTEMPT_NOT_FOUND, "AI Attempt 不存在", false)
                })?;
            ai_task_repository::cas_attempt_status(
                &transaction,
                task_id,
                attempt_id,
                "queued",
                attempt.state_revision,
                "cancelled",
                None,
                None,
                &now,
            )?;
            ai_task_repository::cas_task_status(&transaction, &task, "cancelled", None, &now)?;
        }
        "running" => {
            let attempt_id = task.current_attempt_id.as_deref().ok_or_else(|| {
                AppError::new(codes::AI_ATTEMPT_NOT_FOUND, "运行 Task 缺少 Attempt", false)
            })?;
            let attempt = ai_task_repository::find_attempt(&transaction, task_id, attempt_id)?
                .ok_or_else(|| {
                    AppError::new(codes::AI_ATTEMPT_NOT_FOUND, "AI Attempt 不存在", false)
                })?;
            ai_task_repository::cas_attempt_status(
                &transaction,
                task_id,
                attempt_id,
                "running",
                attempt.state_revision,
                "cancel_requested",
                None,
                None,
                &now,
            )?;
            ai_task_repository::cas_task_status(
                &transaction,
                &task,
                "cancel_requested",
                None,
                &now,
            )?;
        }
        "validating" => {
            ai_task_repository::cas_task_status(
                &transaction,
                &task,
                "cancel_requested",
                None,
                &now,
            )?;
        }
        "cancel_requested" => {
            if let Some(attempt_id) = task.current_attempt_id.as_deref() {
                if let Some(attempt) =
                    ai_task_repository::find_attempt(&transaction, task_id, attempt_id)?
                {
                    if attempt.status == "cancel_requested" {
                        ai_task_repository::cas_attempt_status(
                            &transaction,
                            task_id,
                            attempt_id,
                            "cancel_requested",
                            attempt.state_revision,
                            "cancelled",
                            None,
                            None,
                            &now,
                        )?;
                    }
                }
            }
            ai_task_repository::cas_task_status(&transaction, &task, "cancelled", None, &now)?;
        }
        "cancelled" => {
            commit_transaction(transaction, Some(&task.operation_id))?;
            return Ok(task);
        }
        _ => {
            return Err(AppError::new(
                codes::AI_TASK_TERMINAL_STATE,
                "Task 当前不能取消",
                false,
            ));
        }
    }
    let task = ai_task_repository::find_task(&transaction, task_id)?.expect("task exists");
    commit_transaction(transaction, Some(&task.operation_id))?;
    Ok(task)
}

pub fn get_task_detail(connection: &Connection, task_id: &str) -> Result<AiTaskDetail, AppError> {
    let task = ai_task_repository::find_task(connection, task_id)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "AI Task 不存在", false))?;
    let input = ai_task_repository::find_input_snapshot(connection, task_id)?
        .filter(|snapshot| snapshot.snapshot_id == task.input_snapshot_id)
        .ok_or_else(|| {
            AppError::new(
                codes::OPERATION_REPLAY_TARGET_INVALID,
                "Input Snapshot 缺失",
                false,
            )
        })?;
    let context = ai_task_repository::find_context_snapshot(connection, task_id)?
        .filter(|snapshot| snapshot.snapshot_id == task.context_snapshot_id)
        .ok_or_else(|| {
            AppError::new(
                codes::OPERATION_REPLAY_TARGET_INVALID,
                "Context Snapshot 缺失",
                false,
            )
        })?;
    let constraint = ai_task_repository::find_constraint_snapshot(connection, task_id)?
        .filter(|snapshot| snapshot.snapshot_id == task.constraint_snapshot_id)
        .ok_or_else(|| {
            AppError::new(
                codes::OPERATION_REPLAY_TARGET_INVALID,
                "Constraint Snapshot 缺失",
                false,
            )
        })?;
    let body = large_text_repository::read_verified_document(connection, &input.body_ref_id)?;
    let compiled = large_text_repository::read_verified_document(
        connection,
        &context.compiled_context_ref_id,
    )?;
    let template = large_text_repository::read_verified_document(
        connection,
        &constraint.prompt_template_ref_id,
    )?;
    if template.content_hash != constraint.prompt_template_hash {
        return Err(AppError::new(
            codes::DOCUMENT_HASH_MISMATCH,
            "Prompt 模板快照完整性校验失败",
            false,
        ));
    }
    let input_for_hash = InputSnapshotInput {
        schema_version: input.schema_version,
        input_type: input.input_type.clone(),
        payload_json: input.payload_json.clone(),
        body: body.content.clone(),
        source_draft_id: input.source_draft_id.clone(),
        source_draft_version: input.source_draft_version,
        base_content_hash: input.base_content_hash.clone(),
    };
    let context_for_hash = ContextSnapshotInput {
        schema_version: context.schema_version,
        source_manifest_json: context.source_manifest_json.clone(),
        compiled_context: compiled.content.clone(),
        budget_json: context.budget_json.clone(),
        compiler_version: context.compiler_version.clone(),
    };
    let constraint_for_hash = ConstraintSnapshotInput {
        schema_version: constraint.schema_version,
        payload_json: constraint.payload_json.clone(),
        prompt_template_id: constraint.prompt_template_id.clone(),
        prompt_template_version: constraint.prompt_template_version.clone(),
        prompt_template_hash: constraint.prompt_template_hash.clone(),
        prompt_template_body: template.content.clone(),
        provider_options_json: constraint.provider_options_json.clone(),
    };
    let calculated_input_hash = input_snapshot_hash(&input_for_hash, &body.content_hash)?;
    let calculated_context_hash = context_snapshot_hash(&context_for_hash, &compiled.content_hash)?;
    let calculated_constraint_hash =
        constraint_snapshot_hash(&constraint_for_hash, &template.content_hash)?;
    if calculated_input_hash != input.content_hash
        || calculated_context_hash != context.content_hash
        || calculated_constraint_hash != constraint.content_hash
    {
        return Err(AppError::new(
            codes::OPERATION_REPLAY_TARGET_INVALID,
            "AI Task Snapshot 身份校验失败",
            false,
        ));
    }
    let replay_input = CreateAiTaskInput {
        operation_id: task.operation_id.clone(),
        request_hash_version: Some(task.request_hash_version),
        request_hash: None,
        trace_id: Some(task.trace_id.clone()),
        task_type: task.task_type.clone(),
        novel_id: task.novel_id.clone(),
        chapter_id: task.chapter_id.clone(),
        draft_id: task.draft_id.clone(),
        scope_type: task.scope_type.clone(),
        expected_artifact_type: task.expected_artifact_type.clone(),
        expected_artifact_schema_version: task.expected_artifact_schema_version,
        target_hint_json: task.target_hint_json.clone(),
        input_snapshot: input_for_hash,
        context_snapshot: context_for_hash,
        constraint_snapshot: constraint_for_hash,
    };
    let calculated_request = request_hash(
        &replay_input,
        &calculated_input_hash,
        &calculated_context_hash,
        &calculated_constraint_hash,
    )?;
    if task.request_hash_version != REQUEST_HASH_VERSION || calculated_request != task.request_hash
    {
        return Err(AppError::new(
            codes::OPERATION_REPLAY_TARGET_INVALID,
            "AI Task requestHash 校验失败",
            false,
        ));
    }
    Ok(AiTaskDetail {
        attempts: ai_task_repository::list_attempts(connection, task_id)?,
        task,
        input_snapshot: AiInputSnapshotBundle {
            snapshot: input,
            body: body.content,
        },
        context_snapshot: AiContextSnapshotBundle {
            snapshot: context,
            compiled_context: compiled.content,
        },
        constraint_snapshot: AiConstraintSnapshotBundle {
            snapshot: constraint,
            prompt_template_body: template.content,
        },
    })
}

pub fn list_tasks(
    connection: &Connection,
    novel_id: Option<&str>,
    limit: i64,
) -> Result<Vec<ai_task_repository::AiTaskRecord>, AppError> {
    ai_task_repository::list_tasks(connection, novel_id, limit.clamp(1, 200))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn connection() -> Result<Connection, Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch("PRAGMA foreign_keys=ON;")?;
        crate::db::create_tables(&mut connection)?;
        Ok(connection)
    }

    pub(crate) fn system_task_input(operation_id: &str, artifact_type: &str) -> CreateAiTaskInput {
        let template = "Return the requested result.";
        CreateAiTaskInput {
            operation_id: operation_id.to_string(),
            request_hash_version: Some(REQUEST_HASH_VERSION),
            request_hash: None,
            trace_id: Some(format!("trace-{operation_id}")),
            task_type: "connection_test".to_string(),
            novel_id: "system".to_string(),
            chapter_id: None,
            draft_id: None,
            scope_type: "system".to_string(),
            expected_artifact_type: artifact_type.to_string(),
            expected_artifact_schema_version: 1,
            target_hint_json: Some(serde_json::json!({"purpose": "test"})),
            input_snapshot: InputSnapshotInput {
                schema_version: 1,
                input_type: "connection_test_input".to_string(),
                payload_json: serde_json::json!({"expected": "OK"}),
                body: String::new(),
                source_draft_id: None,
                source_draft_version: None,
                base_content_hash: None,
            },
            context_snapshot: ContextSnapshotInput {
                schema_version: 1,
                source_manifest_json: serde_json::json!([]),
                compiled_context: "connection-test-context".to_string(),
                budget_json: serde_json::json!({"maxTokens": 32}),
                compiler_version: "m1-test-v1".to_string(),
            },
            constraint_snapshot: ConstraintSnapshotInput {
                schema_version: 1,
                payload_json: serde_json::json!({"response": "OK"}),
                prompt_template_id: "connection-test".to_string(),
                prompt_template_version: "1".to_string(),
                prompt_template_hash: large_text_repository::sha256(template),
                prompt_template_body: template.to_string(),
                provider_options_json: serde_json::json!({"providerId": "mock", "model": "mock-v1", "maxTokens": 32}),
            },
        }
    }

    #[test]
    fn task03_create_is_atomic_idempotent_and_hashes_the_full_contract(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let first = create_task(
            &mut connection,
            system_task_input("operation-create", "generic_json"),
        )?;
        let replay = create_task(
            &mut connection,
            system_task_input("operation-create", "generic_json"),
        )?;
        assert_eq!(first.task_id, replay.task_id);
        assert_eq!(first.status, "ready");
        assert_eq!(first.request_hash_version, REQUEST_HASH_VERSION);
        assert_eq!(first.request_hash.len(), 64);
        let mut changed = system_task_input("operation-create", "generic_json");
        changed.context_snapshot.schema_version = 2;
        let error =
            create_task(&mut connection, changed).expect_err("contract change must conflict");
        assert_eq!(error.code, codes::OPERATION_PAYLOAD_CONFLICT);
        let task_count: i64 =
            connection.query_row("SELECT COUNT(*) FROM ai_tasks", [], |row| row.get(0))?;
        let snapshot_count: i64 = connection.query_row(
            "SELECT (SELECT COUNT(*) FROM ai_input_snapshots)
                  + (SELECT COUNT(*) FROM ai_context_snapshots)
                  + (SELECT COUNT(*) FROM ai_constraint_snapshots)",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(task_count, 1);
        assert_eq!(snapshot_count, 3);
        get_task_detail(&connection, &first.task_id)?;
        assert_eq!(list_tasks(&connection, None, 10)?.len(), 1);
        Ok(())
    }

    #[test]
    fn task04_secret_or_snapshot_failure_leaves_no_partial_facts(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let mut secret = system_task_input("operation-secret", "generic_json");
        secret.input_snapshot.body = "Authorization: Bearer hidden-value".to_string();
        let error = create_task(&mut connection, secret).expect_err("secret must be rejected");
        assert_eq!(error.code, codes::AI_TASK_SECRET_DETECTED);
        connection.execute_batch(
            "CREATE TRIGGER fail_context_snapshot
             BEFORE INSERT ON ai_context_snapshots
             BEGIN SELECT RAISE(ABORT, 'injected snapshot failure'); END;",
        )?;
        assert!(create_task(
            &mut connection,
            system_task_input("operation-rollback", "generic_json"),
        )
        .is_err());
        let task_count: i64 =
            connection.query_row("SELECT COUNT(*) FROM ai_tasks", [], |row| row.get(0))?;
        let document_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM large_text_documents WHERE target_type='ai_snapshot'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(task_count, 0);
        assert_eq!(document_count, 0);
        Ok(())
    }

    #[test]
    fn task05_queue_claim_cas_prevents_double_or_cross_task_workers(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let task_a = create_task(
            &mut connection,
            system_task_input("operation-worker-a", "generic_json"),
        )?;
        let task_b = create_task(
            &mut connection,
            system_task_input("operation-worker-b", "generic_json"),
        )?;
        let queued_a = queue_attempt(&mut connection, &task_a.task_id)?;
        let queued_b = queue_attempt(&mut connection, &task_b.task_id)?;
        let queued_replay = queue_attempt(&mut connection, &task_a.task_id)?;
        assert_eq!(
            queued_replay.attempt.attempt_id,
            queued_a.attempt.attempt_id
        );
        let cross = claim_attempt(
            &mut connection,
            ClaimAiTaskAttemptInput {
                task_id: task_a.task_id.clone(),
                attempt_id: queued_b.attempt.attempt_id.clone(),
                provider_id: "mock".to_string(),
                model_id: "mock-v1".to_string(),
                provider_request_id: Some("request-cross".to_string()),
            },
        )
        .expect_err("cross-task attempt must fail");
        assert_eq!(cross.code, codes::AI_ATTEMPT_NOT_FOUND);
        let claimed = claim_attempt(
            &mut connection,
            ClaimAiTaskAttemptInput {
                task_id: task_a.task_id.clone(),
                attempt_id: queued_a.attempt.attempt_id.clone(),
                provider_id: "mock".to_string(),
                model_id: "mock-v1".to_string(),
                provider_request_id: Some("request-a".to_string()),
            },
        )?;
        assert_eq!(claimed.task.status, "running");
        assert_eq!(claimed.attempt.status, "running");
        let claim_replay = claim_attempt(
            &mut connection,
            ClaimAiTaskAttemptInput {
                task_id: task_a.task_id,
                attempt_id: queued_a.attempt.attempt_id,
                provider_id: "mock".to_string(),
                model_id: "mock-v1".to_string(),
                provider_request_id: Some("request-a".to_string()),
            },
        )?;
        assert_eq!(claim_replay.attempt.status, "running");
        Ok(())
    }

    #[test]
    fn task06_retry_cancel_and_late_response_preserve_attempt_history(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let task = create_task(
            &mut connection,
            system_task_input("operation-retry", "generic_json"),
        )?;
        let queued = queue_attempt(&mut connection, &task.task_id)?;
        claim_attempt(
            &mut connection,
            ClaimAiTaskAttemptInput {
                task_id: task.task_id.clone(),
                attempt_id: queued.attempt.attempt_id.clone(),
                provider_id: "mock".to_string(),
                model_id: "mock-v1".to_string(),
                provider_request_id: None,
            },
        )?;
        fail_attempt(
            &mut connection,
            &task.task_id,
            &queued.attempt.attempt_id,
            AppError::new(codes::AI_PROVIDER_TIMEOUT, "timeout", true),
        )?;
        let failure_replay = fail_attempt(
            &mut connection,
            &task.task_id,
            &queued.attempt.attempt_id,
            AppError::new(codes::AI_PROVIDER_TIMEOUT, "timeout", true),
        )?;
        assert_eq!(failure_replay.attempt.status, "failed");
        let retry = queue_attempt(&mut connection, &task.task_id)?;
        assert_eq!(retry.attempt.attempt_number, 2);
        claim_attempt(
            &mut connection,
            ClaimAiTaskAttemptInput {
                task_id: task.task_id.clone(),
                attempt_id: retry.attempt.attempt_id.clone(),
                provider_id: "mock".to_string(),
                model_id: "mock-v1".to_string(),
                provider_request_id: None,
            },
        )?;
        assert_eq!(
            cancel_task(&mut connection, &task.task_id)?.status,
            "cancel_requested"
        );
        let raw = r#"{"ok":true}"#;
        let late = mark_provider_succeeded(
            &mut connection,
            &task.task_id,
            &retry.attempt.attempt_id,
            serde_json::json!({
                "responseHash": large_text_repository::sha256(raw),
                "responseLength": raw.chars().count(),
                "provider": "mock",
                "model": "mock-v1"
            }),
        )?;
        assert_eq!(late.task.status, "cancelled");
        assert_eq!(late.attempt.status, "late_response_ignored");
        let late_replay = mark_provider_succeeded(
            &mut connection,
            &task.task_id,
            &retry.attempt.attempt_id,
            serde_json::json!({
                "responseHash": large_text_repository::sha256(raw),
                "responseLength": raw.chars().count(),
                "provider": "mock",
                "model": "mock-v1"
            }),
        )?;
        assert_eq!(late_replay.attempt.status, "late_response_ignored");
        assert_eq!(
            cancel_task(&mut connection, &task.task_id)?.status,
            "cancelled"
        );
        assert_eq!(
            ai_task_repository::list_attempts(&connection, &task.task_id)?.len(),
            2
        );
        let artifacts: i64 = connection.query_row(
            "SELECT COUNT(*) FROM result_artifacts WHERE task_id=?1",
            params![task.task_id],
            |row| row.get(0),
        )?;
        assert_eq!(artifacts, 0);
        Ok(())
    }

    #[test]
    fn task07_draft_scope_binds_real_owner_version_and_hash(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let body = "authoritative draft body";
        let body_hash = large_text_repository::sha256(body);
        connection.execute_batch(
            "INSERT INTO novels (id,title,created_at,updated_at)
             VALUES ('novel-a','Novel','now','now');
             INSERT INTO chapters (id,novel_id,title,created_at,updated_at)
             VALUES ('chapter-a','novel-a','Chapter','now','now');",
        )?;
        connection.execute(
            "INSERT INTO chapter_drafts
                (id,novel_id,chapter_id,content,source,version_no,word_count,is_adopted,
                 content_hash,created_at,updated_at)
             VALUES ('draft-a','novel-a','chapter-a',?1,'manual',3,3,0,?2,'now','now')",
            params![body, body_hash],
        )?;
        let mut input = system_task_input("operation-draft", "chapter_text");
        input.task_type = "chapter_rewrite".to_string();
        input.novel_id = "novel-a".to_string();
        input.chapter_id = Some("chapter-a".to_string());
        input.draft_id = Some("draft-a".to_string());
        input.scope_type = "draft".to_string();
        input.input_snapshot.body = body.to_string();
        input.input_snapshot.source_draft_id = Some("draft-a".to_string());
        input.input_snapshot.source_draft_version = Some(3);
        input.input_snapshot.base_content_hash = Some(body_hash.clone());
        let task = create_task(&mut connection, input.clone())?;
        assert_eq!(task.draft_id.as_deref(), Some("draft-a"));
        input.operation_id = "operation-draft-stale".to_string();
        input.input_snapshot.source_draft_version = Some(2);
        let error = create_task(&mut connection, input).expect_err("stale draft must fail");
        assert_eq!(error.code, codes::DOCUMENT_VERSION_CONFLICT);
        Ok(())
    }
}
