use crate::domain::co_creation::{
    AppendCoCreationUserMessageInput, BindCoCreationTurnTaskInput, CoCreationDraftRevisionV1,
    CoCreationMessageV1, CoCreationMutationReceiptV1, CoCreationSessionV1, CoCreationTurnContextV1,
    CoCreationWorkspaceV1, CompleteCoCreationTurnInput, FailCoCreationTurnInput,
    OpenCoCreationWorkspaceInput, OpenCoCreationWorkspaceResultV1, ReadCoCreationWorkspaceInput,
    RecoverCoCreationTurnTaskInput, RecoveredCoCreationTurnTaskV1,
    SaveCoCreationDraftRevisionInput, CO_CREATION_SCHEMA_VERSION, CO_CREATION_WORKSPACE_TYPE,
};
use crate::errors::{codes, AppError};
use crate::repositories::{co_creation_repository, large_text_repository};
use chrono::Utc;
use rusqlite::{params, Connection, TransactionBehavior};
use serde_json::{json, Number, Value};

const STATE_CONTRACT: &str = "co_creation_state_v1";
const APPEND_OPERATION: &str = "append_user_message";
const BIND_OPERATION: &str = "bind_turn_task";
const COMPLETE_OPERATION: &str = "complete_turn";
const FAIL_OPERATION: &str = "fail_turn";
const SAVE_DRAFT_OPERATION: &str = "save_stage_draft_revision";

fn invalid(message: impl Into<String>) -> AppError {
    AppError::new(codes::OPERATION_PAYLOAD_CONFLICT, message, false)
}

fn canonical_number(value: &Number) -> String {
    if let Some(value) = value.as_i64() {
        return value.to_string();
    }
    if let Some(value) = value.as_u64() {
        return value.to_string();
    }
    let Some(number) = value.as_f64() else {
        return value.to_string();
    };
    if number == 0.0 {
        return "0".to_string();
    }
    let raw = value.to_string().to_ascii_lowercase();
    let (negative, unsigned) = raw
        .strip_prefix('-')
        .map(|value| (true, value))
        .unwrap_or((false, raw.as_str()));
    let (mantissa, exponent) = unsigned
        .split_once('e')
        .map(|(mantissa, exponent)| (mantissa, exponent.parse::<i32>().unwrap_or_default()))
        .unwrap_or((unsigned, 0));
    let integer_digits = mantissa.find('.').unwrap_or(mantissa.len()) as i32;
    let mut digits = mantissa.replace('.', "");
    while digits.len() > 1 && digits.ends_with('0') {
        digits.pop();
    }
    let decimal_position = integer_digits + exponent;
    let absolute = number.abs();
    let body = if (1e-6..1e21).contains(&absolute) {
        if decimal_position <= 0 {
            format!("0.{}{}", "0".repeat((-decimal_position) as usize), digits)
        } else if decimal_position as usize >= digits.len() {
            format!(
                "{}{}",
                digits,
                "0".repeat(decimal_position as usize - digits.len())
            )
        } else {
            let split = decimal_position as usize;
            format!("{}.{}", &digits[..split], &digits[split..])
        }
    } else {
        let exponent = decimal_position - 1;
        let mantissa = if digits.len() == 1 {
            digits
        } else {
            format!("{}.{}", &digits[..1], &digits[1..])
        };
        format!(
            "{}e{}{}",
            mantissa,
            if exponent >= 0 { "+" } else { "" },
            exponent
        )
    };
    if negative {
        format!("-{body}")
    } else {
        body
    }
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => canonical_number(value),
        Value::String(value) => serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into()),
        Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",")
        ),
        Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort();
            format!(
                "{{{}}}",
                keys.iter()
                    .map(|key| format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap_or_else(|_| "\"\"".into()),
                        canonical_json(&values[*key])
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
    }
}

pub(crate) fn canonical_hash(value: &Value) -> String {
    large_text_repository::sha256(&canonical_json(value))
}

fn text_contains_secret(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    for marker in ["apikey", "api_key", "api-key", "api key", "authorization"] {
        let mut remainder = lower.as_str();
        while let Some(index) = remainder.find(marker) {
            let suffix = remainder[index + marker.len()..].trim_start();
            if suffix.starts_with(':') || suffix.starts_with('=') {
                return true;
            }
            remainder = &remainder[index + marker.len()..];
        }
    }
    for marker in ["bearer ", "sk-"] {
        let mut remainder = lower.as_str();
        while let Some(index) = remainder.find(marker) {
            let token = remainder[index + marker.len()..]
                .chars()
                .take_while(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
                })
                .count();
            if token >= 8 {
                return true;
            }
            remainder = &remainder[index + marker.len()..];
        }
    }
    false
}

pub(crate) fn contains_secret(value: &Value) -> bool {
    match value {
        Value::Object(values) => values.iter().any(|(key, value)| {
            matches!(
                key.to_ascii_lowercase().as_str(),
                "apikey" | "api_key" | "authorization" | "secret"
            ) || contains_secret(value)
        }),
        Value::Array(values) => values.iter().any(contains_secret),
        Value::String(value) => text_contains_secret(value),
        _ => false,
    }
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .chars()
            .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase())
}

fn normalize_identifier(value: &str, field: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() || value.len() > 160 {
        return Err(invalid(format!("{field} 无效")));
    }
    Ok(value.to_string())
}

fn normalize_expected_hash(value: &str) -> Result<String, AppError> {
    let value = value.trim().to_ascii_lowercase();
    if !valid_hash(&value) {
        return Err(invalid("expectedStateHash 无效"));
    }
    Ok(value)
}

fn checked_request_hash(value: &Value, supplied: Option<&str>) -> Result<String, AppError> {
    let actual = canonical_hash(value);
    if let Some(supplied) = supplied {
        let supplied = supplied.trim().to_ascii_lowercase();
        if !valid_hash(&supplied) || supplied != actual {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "共创请求 requestHash 与权威 payload 不一致",
                false,
            ));
        }
    }
    Ok(actual)
}

fn initial_state_hash(session_id: &str, novel_id: &str) -> String {
    canonical_hash(&json!({
        "contract": STATE_CONTRACT,
        "sessionId": session_id,
        "novelId": novel_id,
        "revision": 0,
    }))
}

fn next_state_hash(
    session: &CoCreationSessionV1,
    operation_type: &str,
    operation_id: &str,
    request_hash: &str,
    mutation_hash: &str,
) -> Result<(i64, String), AppError> {
    let revision = session
        .revision
        .checked_add(1)
        .ok_or_else(|| invalid("共创工作区 revision 超出范围"))?;
    Ok((
        revision,
        canonical_hash(&json!({
            "contract": STATE_CONTRACT,
            "sessionId": session.session_id,
            "novelId": session.novel_id,
            "revision": revision,
            "previousStateHash": session.state_hash,
            "operationType": operation_type,
            "operationId": operation_id,
            "requestHash": request_hash,
            "mutationHash": mutation_hash,
        })),
    ))
}

fn validate_novel(connection: &Connection, novel_id: &str) -> Result<(), AppError> {
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM novels WHERE id=?1 AND deleted_at IS NULL",
            params![novel_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if count != 1 {
        return Err(AppError::new(
            codes::TARGET_NOVEL_NOT_FOUND,
            "作品不存在或已删除",
            false,
        ));
    }
    Ok(())
}

fn expected_session(
    connection: &Connection,
    novel_id: &str,
    session_id: &str,
    expected_revision: i64,
    expected_state_hash: &str,
) -> Result<CoCreationSessionV1, AppError> {
    let session = co_creation_repository::find_session(connection, session_id)?
        .ok_or_else(|| AppError::new(codes::TARGET_NOT_FOUND, "共创会话不存在", false))?;
    if session.novel_id != novel_id || session.workspace_type != CO_CREATION_WORKSPACE_TYPE {
        return Err(AppError::new(
            codes::TARGET_SCOPE_MISMATCH,
            "共创会话不属于当前作品",
            false,
        ));
    }
    if session.status != "active" {
        return Err(AppError::new(
            codes::TARGET_NOT_FOUND,
            "共创会话已归档",
            false,
        ));
    }
    if session.revision != expected_revision || session.state_hash != expected_state_hash {
        return Err(AppError::new(
            codes::DOCUMENT_VERSION_CONFLICT,
            "共创工作区已在其他窗口更新，请重新读取",
            false,
        )
        .with_details(json!({
            "expectedRevision": expected_revision,
            "expectedStateHash": expected_state_hash,
            "actualRevision": session.revision,
            "actualStateHash": session.state_hash,
        })));
    }
    Ok(session)
}

fn active_session(
    connection: &Connection,
    novel_id: &str,
    session_id: &str,
) -> Result<CoCreationSessionV1, AppError> {
    let session = co_creation_repository::find_session(connection, session_id)?
        .ok_or_else(|| AppError::new(codes::TARGET_NOT_FOUND, "共创会话不存在", false))?;
    if session.novel_id != novel_id || session.workspace_type != CO_CREATION_WORKSPACE_TYPE {
        return Err(AppError::new(
            codes::TARGET_SCOPE_MISMATCH,
            "共创会话不属于当前作品",
            false,
        ));
    }
    if session.status != "active" {
        return Err(AppError::new(
            codes::AI_TASK_ILLEGAL_TRANSITION,
            "共创会话已归档",
            false,
        ));
    }
    Ok(session)
}

fn replay_receipt(
    connection: &Connection,
    session_id: &str,
    operation_id: &str,
    operation_type: &str,
    request_hash: &str,
) -> Result<Option<CoCreationMutationReceiptV1>, AppError> {
    let Some(operation) = co_creation_repository::find_operation(connection, operation_id)? else {
        return Ok(None);
    };
    if operation.session_id != session_id
        || operation.operation_type != operation_type
        || operation.request_hash != request_hash
    {
        return Err(AppError::new(
            codes::OPERATION_PAYLOAD_CONFLICT,
            "同一共创 operationId 对应不同请求",
            false,
        ));
    }
    let mut receipt: CoCreationMutationReceiptV1 = serde_json::from_str(&operation.result_json)
        .map_err(|_| {
            AppError::new(
                codes::DATABASE_TRANSACTION_FAILED,
                "共创 operation 结果损坏",
                false,
            )
        })?;
    receipt.idempotent_replay = true;
    Ok(Some(receipt))
}

fn persist_receipt(
    connection: &Connection,
    receipt: &CoCreationMutationReceiptV1,
    request_hash: &str,
    now: &str,
) -> Result<(), AppError> {
    let result_json =
        serde_json::to_string(receipt).map_err(|_| invalid("共创 operation 结果无法序列化"))?;
    co_creation_repository::insert_operation(
        connection,
        &receipt.operation_id,
        &receipt.session_id,
        &receipt.operation_type,
        request_hash,
        &result_json,
        now,
    )
}

fn advance_and_receipt(
    connection: &Connection,
    session: &CoCreationSessionV1,
    operation_id: &str,
    operation_type: &str,
    request_hash: &str,
    mutation_hash: &str,
    message_id: Option<String>,
    draft_revision_id: Option<String>,
    now: &str,
) -> Result<CoCreationMutationReceiptV1, AppError> {
    let (revision, state_hash) = next_state_hash(
        session,
        operation_type,
        operation_id,
        request_hash,
        mutation_hash,
    )?;
    co_creation_repository::cas_advance_session(
        connection,
        &session.session_id,
        session.revision,
        &session.state_hash,
        revision,
        &state_hash,
        now,
    )?;
    let receipt = CoCreationMutationReceiptV1 {
        session_id: session.session_id.clone(),
        operation_id: operation_id.to_string(),
        operation_type: operation_type.to_string(),
        revision,
        state_hash,
        message_id,
        draft_revision_id,
        idempotent_replay: false,
    };
    persist_receipt(connection, &receipt, request_hash, now)?;
    Ok(receipt)
}

fn task_scope(
    connection: &Connection,
    novel_id: &str,
    session_id: &str,
    user_message_id: &str,
    task_id: &str,
) -> Result<co_creation_repository::BackgroundTaskScopeRow, AppError> {
    let task = co_creation_repository::find_background_task_scope(connection, task_id)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "后台任务不存在", false))?;
    if task.novel_id != novel_id {
        return Err(AppError::new(
            codes::TARGET_SCOPE_MISMATCH,
            "后台任务不属于当前作品",
            false,
        ));
    }
    if task.task_type != "co_creation_turn" || task.worker_kind.is_none() {
        return Err(AppError::new(
            codes::AI_TASK_ILLEGAL_TRANSITION,
            "任务不是可绑定的后台任务",
            false,
        ));
    }
    let target_hint: Value = task
        .target_hint_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| invalid("共创后台任务 targetHint 无效"))?
        .ok_or_else(|| invalid("共创后台任务缺少 targetHint"))?;
    if target_hint.get("contract").and_then(Value::as_str) != Some("co_creation_turn_v1")
        || target_hint.get("sessionId").and_then(Value::as_str) != Some(session_id)
        || target_hint.get("userMessageId").and_then(Value::as_str) != Some(user_message_id)
    {
        return Err(AppError::new(
            codes::TARGET_SCOPE_MISMATCH,
            "共创后台任务没有绑定当前 Session/Turn",
            false,
        ));
    }
    let input_payload: Value = task
        .input_payload_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| invalid("共创后台任务 Input Snapshot 无效"))?
        .ok_or_else(|| invalid("共创后台任务缺少 Input Snapshot"))?;
    if input_payload.get("contract").and_then(Value::as_str) != Some("co_creation_turn_v1")
        || input_payload.get("sessionId").and_then(Value::as_str) != Some(session_id)
        || input_payload.get("userMessageId").and_then(Value::as_str) != Some(user_message_id)
        || input_payload.get("currentStage").and_then(Value::as_str)
            != target_hint.get("currentStage").and_then(Value::as_str)
        || input_payload
            .get("canonicalDataHash")
            .and_then(Value::as_str)
            != target_hint.get("canonicalDataHash").and_then(Value::as_str)
        || input_payload.get("dataRevision").and_then(Value::as_i64)
            != target_hint.get("dataRevision").and_then(Value::as_i64)
        || !input_payload
            .get("currentStage")
            .and_then(Value::as_str)
            .is_some_and(valid_stage_key)
        || !input_payload
            .get("canonicalDataHash")
            .and_then(Value::as_str)
            .is_some_and(valid_hash)
        || input_payload
            .get("dataRevision")
            .and_then(Value::as_i64)
            .is_none_or(|value| value < 0)
    {
        return Err(AppError::new(
            codes::TARGET_SCOPE_MISMATCH,
            "共创后台任务 Input Snapshot 没有绑定当前 Session/Turn",
            false,
        ));
    }
    Ok(task)
}

fn artifact_scope(
    connection: &Connection,
    novel_id: &str,
    task_id: &str,
    artifact_id: &str,
) -> Result<co_creation_repository::ArtifactScopeRow, AppError> {
    let artifact = co_creation_repository::find_artifact_scope(connection, artifact_id)?
        .ok_or_else(|| {
            AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "共创结果 Artifact 不存在",
                false,
            )
        })?;
    if artifact.task_id != task_id || artifact.source_novel_id != novel_id {
        return Err(AppError::new(
            codes::TARGET_SCOPE_MISMATCH,
            "共创 Artifact 与作品或任务范围不一致",
            false,
        ));
    }
    if artifact.artifact_type != "generic_json"
        || artifact.schema_version != CO_CREATION_SCHEMA_VERSION
        || artifact.stale
        || !matches!(
            artifact.processing_status.as_str(),
            "valid" | "valid_with_warnings"
        )
    {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "共创 Artifact 已失效或未通过校验",
            false,
        ));
    }
    Ok(artifact)
}

fn validated_turn_output(
    task: &co_creation_repository::BackgroundTaskScopeRow,
    artifact: &co_creation_repository::ArtifactScopeRow,
) -> Result<Value, AppError> {
    let payload: Value = artifact
        .structured_payload_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| {
            AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "共创 Artifact 结构化结果无效",
                false,
            )
        })?
        .ok_or_else(|| {
            AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "共创 Artifact 缺少结构化结果",
                false,
            )
        })?;
    let input: Value = task
        .input_payload_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| invalid("共创任务 Input Snapshot 无效"))?
        .ok_or_else(|| invalid("共创任务缺少 Input Snapshot"))?;
    let current_stage = payload.get("currentStage").and_then(Value::as_str);
    let natural_reply = payload
        .get("naturalLanguageReply")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let intent = payload.get("intent").and_then(Value::as_str);
    let completion = payload.get("stageCompletion").and_then(Value::as_object);
    let valid_intent = intent.is_some_and(|value| {
        matches!(
            value,
            "answer_current_question"
                | "free_discussion"
                | "modify_setting"
                | "request_ai_completion"
                | "generate_outline"
                | "generate_chapter"
                | "revise_existing_content"
                | "accept_suggestion"
                | "reject_suggestion"
                | "undo_change"
                | "navigate_to_page"
        )
    });
    if !payload.is_object()
        || payload.get("schemaVersion").and_then(Value::as_i64) != Some(CO_CREATION_SCHEMA_VERSION)
        || natural_reply.is_none()
        || !valid_intent
        || !current_stage.is_some_and(valid_stage_key)
        || current_stage != input.get("currentStage").and_then(Value::as_str)
        || payload.get("dataRevision").and_then(Value::as_i64)
            != input.get("dataRevision").and_then(Value::as_i64)
        || !payload
            .get("extractedInformation")
            .is_some_and(Value::is_array)
        || !payload
            .get("pendingConfirmations")
            .is_some_and(Value::is_array)
        || !payload.get("quickReplies").is_some_and(Value::is_array)
        || !payload
            .get("changeSuggestions")
            .is_some_and(Value::is_array)
        || completion
            .and_then(|value| value.get("stage"))
            .and_then(Value::as_str)
            != current_stage
        || contains_secret(&payload)
    {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "共创 Artifact 不符合 CoCreationTurnOutputV1",
            false,
        ));
    }
    let expected_user_message_id = input
        .get("userMessageId")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("共创任务缺少 userMessageId"))?;
    let valid_source_type = |value: &str| {
        matches!(
            value,
            "author_message"
                | "formal_project_data"
                | "adopted_chapter_text"
                | "pending_draft"
                | "ai_inference"
        )
    };
    for extracted in payload["extractedInformation"]
        .as_array()
        .expect("validated array")
    {
        let references = extracted
            .get("sourceReferences")
            .and_then(Value::as_array)
            .filter(|references| !references.is_empty())
            .ok_or_else(|| {
                AppError::new(
                    codes::ARTIFACT_VALIDATION_FAILED,
                    "共创提取信息缺少来源引用",
                    false,
                )
            })?;
        if references.iter().any(|reference| {
            !reference
                .get("sourceType")
                .and_then(Value::as_str)
                .is_some_and(valid_source_type)
                || reference
                    .get("sourceId")
                    .and_then(Value::as_str)
                    .is_none_or(|value| value.trim().is_empty())
        }) {
            return Err(AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "共创提取信息来源无效",
                false,
            ));
        }
        if extracted.get("fieldState").and_then(Value::as_str) == Some("user_confirmed")
            && !references.iter().any(|reference| {
                reference.get("sourceType").and_then(Value::as_str) == Some("author_message")
                    && reference.get("sourceId").and_then(Value::as_str)
                        == Some(expected_user_message_id)
            })
        {
            return Err(AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "user_confirmed 缺少本轮作者来源",
                false,
            ));
        }
    }
    for suggestion in payload["changeSuggestions"]
        .as_array()
        .expect("validated array")
    {
        if !suggestion
            .get("sourceType")
            .and_then(Value::as_str)
            .is_some_and(valid_source_type)
        {
            return Err(AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "共创建议来源类型无效",
                false,
            ));
        }
    }
    Ok(payload)
}

fn message_dto(
    connection: &Connection,
    row: co_creation_repository::CoCreationMessageRow,
) -> Result<CoCreationMessageV1, AppError> {
    large_text_repository::validate_document_target(
        connection,
        &row.body_ref_id,
        "co_creation_message",
        &row.message_id,
        "body",
    )?;
    let verified = large_text_repository::read_verified_document(connection, &row.body_ref_id)?;
    if verified.content_hash != row.content_hash
        || verified.content_length as i64 != row.content_length
    {
        return Err(AppError::new(
            codes::LARGE_TEXT_HASH_MISMATCH,
            "共创消息正文完整性校验失败",
            false,
        ));
    }
    let error = row
        .error_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| {
            AppError::new(
                codes::DATABASE_TRANSACTION_FAILED,
                "共创 turn 错误记录损坏",
                false,
            )
        })?;
    let turn_context = if row.role == "user" {
        row.task_id
            .as_deref()
            .map(|task_id| {
                let task = co_creation_repository::find_background_task_scope(connection, task_id)?
                    .ok_or_else(|| {
                        AppError::new(
                            codes::AI_TASK_NOT_FOUND,
                            "共创消息绑定的后台任务不存在",
                            false,
                        )
                    })?;
                let payload: Value = task
                    .input_payload_json
                    .as_deref()
                    .map(serde_json::from_str)
                    .transpose()
                    .map_err(|_| {
                        AppError::new(
                            codes::ARTIFACT_VALIDATION_FAILED,
                            "共创任务输入快照损坏",
                            false,
                        )
                    })?
                    .ok_or_else(|| {
                        AppError::new(
                            codes::ARTIFACT_VALIDATION_FAILED,
                            "共创任务缺少输入快照",
                            false,
                        )
                    })?;
                let current_stage = payload
                    .get("currentStage")
                    .and_then(Value::as_str)
                    .filter(|value| valid_stage_key(value))
                    .ok_or_else(|| invalid("共创任务 currentStage 无效"))?;
                let canonical_data_hash = payload
                    .get("canonicalDataHash")
                    .and_then(Value::as_str)
                    .filter(|value| valid_hash(value))
                    .ok_or_else(|| invalid("共创任务 canonicalDataHash 无效"))?;
                let data_revision = payload
                    .get("dataRevision")
                    .and_then(Value::as_i64)
                    .filter(|value| *value >= 0)
                    .ok_or_else(|| invalid("共创任务 dataRevision 无效"))?;
                if task.task_type != "co_creation_turn"
                    || payload.get("contract").and_then(Value::as_str)
                        != Some("co_creation_turn_v1")
                    || payload.get("sessionId").and_then(Value::as_str)
                        != Some(row.session_id.as_str())
                    || payload.get("userMessageId").and_then(Value::as_str)
                        != Some(row.message_id.as_str())
                {
                    return Err(AppError::new(
                        codes::TARGET_SCOPE_MISMATCH,
                        "共创消息与任务输入快照不一致",
                        false,
                    ));
                }
                Ok(CoCreationTurnContextV1 {
                    current_stage: current_stage.to_string(),
                    canonical_data_hash: canonical_data_hash.to_string(),
                    data_revision,
                })
            })
            .transpose()?
    } else {
        None
    };
    Ok(CoCreationMessageV1 {
        message_id: row.message_id,
        session_id: row.session_id,
        turn_id: row.turn_id,
        sequence_no: row.sequence_no,
        role: row.role,
        status: row.status,
        content: verified.content,
        content_hash: verified.content_hash,
        content_length: verified.content_length as i64,
        reply_to_message_id: row.reply_to_message_id,
        task_id: row.task_id,
        artifact_id: row.artifact_id,
        turn_context,
        error,
        created_at: row.created_at,
        completed_at: row.completed_at,
    })
}

fn draft_dto(
    row: co_creation_repository::CoCreationDraftRow,
) -> Result<CoCreationDraftRevisionV1, AppError> {
    let payload: Value = serde_json::from_str(&row.payload_json).map_err(|_| {
        AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "共创阶段草案不是有效 JSON",
            false,
        )
    })?;
    if canonical_hash(&payload) != row.content_hash || contains_secret(&payload) {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "共创阶段草案完整性或凭据校验失败",
            false,
        ));
    }
    Ok(CoCreationDraftRevisionV1 {
        draft_revision_id: row.draft_revision_id,
        session_id: row.session_id,
        stage_key: row.stage_key,
        revision_no: row.revision_no,
        parent_revision_id: row.parent_revision_id,
        schema_version: row.schema_version,
        payload,
        content_hash: row.content_hash,
        origin: row.origin,
        source_message_id: row.source_message_id,
        source_task_id: row.source_task_id,
        source_artifact_id: row.source_artifact_id,
        created_at: row.created_at,
    })
}

fn read_workspace_from_connection(
    connection: &Connection,
    novel_id: &str,
    session_id: &str,
) -> Result<CoCreationWorkspaceV1, AppError> {
    let session = co_creation_repository::find_session(connection, session_id)?
        .ok_or_else(|| AppError::new(codes::TARGET_NOT_FOUND, "共创会话不存在", false))?;
    if session.novel_id != novel_id || session.workspace_type != CO_CREATION_WORKSPACE_TYPE {
        return Err(AppError::new(
            codes::TARGET_SCOPE_MISMATCH,
            "共创会话不属于当前作品",
            false,
        ));
    }
    let messages = co_creation_repository::list_messages(connection, session_id)?
        .into_iter()
        .map(|row| message_dto(connection, row))
        .collect::<Result<Vec<_>, _>>()?;
    let draft_revisions = co_creation_repository::list_drafts(connection, session_id)?
        .into_iter()
        .map(draft_dto)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(CoCreationWorkspaceV1 {
        schema_version: CO_CREATION_SCHEMA_VERSION,
        session,
        messages,
        draft_revisions,
    })
}

pub fn open_workspace(
    connection: &mut Connection,
    input: OpenCoCreationWorkspaceInput,
) -> Result<OpenCoCreationWorkspaceResultV1, AppError> {
    let novel_id = normalize_identifier(&input.novel_id, "novelId")?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    validate_novel(&transaction, &novel_id)?;
    let (session, created) = if let Some(session) = co_creation_repository::find_active_session(
        &transaction,
        &novel_id,
        CO_CREATION_WORKSPACE_TYPE,
    )? {
        (session, false)
    } else {
        let now = Utc::now().to_rfc3339();
        let session_id = uuid::Uuid::new_v4().to_string();
        let session = CoCreationSessionV1 {
            session_id: session_id.clone(),
            novel_id: novel_id.clone(),
            workspace_type: CO_CREATION_WORKSPACE_TYPE.to_string(),
            status: "active".into(),
            revision: 0,
            state_hash: initial_state_hash(&session_id, &novel_id),
            created_at: now.clone(),
            updated_at: now,
            archived_at: None,
        };
        co_creation_repository::insert_session(&transaction, &session)?;
        (session, true)
    };
    let workspace = read_workspace_from_connection(&transaction, &novel_id, &session.session_id)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(OpenCoCreationWorkspaceResultV1 { created, workspace })
}

pub fn read_workspace(
    connection: &Connection,
    input: ReadCoCreationWorkspaceInput,
) -> Result<CoCreationWorkspaceV1, AppError> {
    let novel_id = normalize_identifier(&input.novel_id, "novelId")?;
    let session_id = normalize_identifier(&input.session_id, "sessionId")?;
    validate_novel(connection, &novel_id)?;
    read_workspace_from_connection(connection, &novel_id, &session_id)
}

pub fn recover_turn_task(
    connection: &Connection,
    input: RecoverCoCreationTurnTaskInput,
) -> Result<Option<RecoveredCoCreationTurnTaskV1>, AppError> {
    let novel_id = normalize_identifier(&input.novel_id, "novelId")?;
    let session_id = normalize_identifier(&input.session_id, "sessionId")?;
    let user_message_id = normalize_identifier(&input.user_message_id, "userMessageId")?;
    validate_novel(connection, &novel_id)?;
    active_session(connection, &novel_id, &session_id)?;
    let message = co_creation_repository::find_message(connection, &user_message_id)?
        .ok_or_else(|| AppError::new(codes::TARGET_NOT_FOUND, "共创用户消息不存在", false))?;
    if message.session_id != session_id
        || message.role != "user"
        || message.status != "submitted"
        || message.task_id.is_some()
    {
        return Err(AppError::new(
            codes::AI_TASK_ILLEGAL_TRANSITION,
            "共创消息当前不需要恢复 Task 绑定",
            false,
        ));
    }
    let operation_id =
        format!("co-creation:{session_id}:message:{user_message_id}:conversation_turn");
    let Some(task_id) =
        co_creation_repository::find_task_id_by_operation(connection, &operation_id)?
    else {
        return Ok(None);
    };
    let task = task_scope(
        connection,
        &novel_id,
        &session_id,
        &user_message_id,
        &task_id,
    )?;
    let payload: Value = task
        .input_payload_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| invalid("共创任务 Input Snapshot 无效"))?
        .ok_or_else(|| invalid("共创任务缺少 Input Snapshot"))?;
    let current_stage = payload
        .get("currentStage")
        .and_then(Value::as_str)
        .filter(|value| valid_stage_key(value))
        .ok_or_else(|| invalid("共创任务 currentStage 无效"))?;
    let canonical_data_hash = payload
        .get("canonicalDataHash")
        .and_then(Value::as_str)
        .filter(|value| valid_hash(value))
        .ok_or_else(|| invalid("共创任务 canonicalDataHash 无效"))?;
    let data_revision = payload
        .get("dataRevision")
        .and_then(Value::as_i64)
        .filter(|value| *value >= 0)
        .ok_or_else(|| invalid("共创任务 dataRevision 无效"))?;
    Ok(Some(RecoveredCoCreationTurnTaskV1 {
        task_id,
        current_stage: current_stage.to_string(),
        canonical_data_hash: canonical_data_hash.to_string(),
        data_revision,
    }))
}

pub fn append_user_message(
    connection: &mut Connection,
    input: AppendCoCreationUserMessageInput,
) -> Result<CoCreationMutationReceiptV1, AppError> {
    let novel_id = normalize_identifier(&input.novel_id, "novelId")?;
    let session_id = normalize_identifier(&input.session_id, "sessionId")?;
    let operation_id = normalize_identifier(&input.operation_id, "operationId")?;
    let expected_state_hash = normalize_expected_hash(&input.expected_state_hash)?;
    if input.expected_revision < 0 || input.content.trim().is_empty() {
        return Err(invalid("追加共创消息请求无效"));
    }
    if text_contains_secret(&input.content) {
        return Err(invalid("共创消息禁止包含 API Key 或授权凭据"));
    }
    let content_hash = large_text_repository::sha256(&input.content);
    let request_value = json!({
        "contract": "co_creation_append_user_message_v1",
        "novelId": novel_id,
        "sessionId": session_id,
        "expectedRevision": input.expected_revision,
        "expectedStateHash": expected_state_hash,
        "contentHash": content_hash,
        "contentLength": input.content.chars().count(),
    });
    let request_hash = checked_request_hash(&request_value, input.request_hash.as_deref())?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    if let Some(receipt) = replay_receipt(
        &transaction,
        &session_id,
        &operation_id,
        APPEND_OPERATION,
        &request_hash,
    )? {
        transaction.commit().map_err(AppError::database)?;
        return Ok(receipt);
    }
    let session = expected_session(
        &transaction,
        &novel_id,
        &session_id,
        input.expected_revision,
        &expected_state_hash,
    )?;
    let now = Utc::now().to_rfc3339();
    let message_id = uuid::Uuid::new_v4().to_string();
    let body_ref_id = uuid::Uuid::new_v4().to_string();
    let sequence_no = co_creation_repository::next_message_sequence(&transaction, &session_id)?;
    large_text_repository::insert_document_for_target(
        &transaction,
        &body_ref_id,
        "co_creation_message",
        &message_id,
        "body",
        None,
        &input.content,
        &content_hash,
        &now,
    )?;
    co_creation_repository::insert_message(
        &transaction,
        &message_id,
        &session_id,
        &message_id,
        sequence_no,
        "user",
        "submitted",
        &body_ref_id,
        &content_hash,
        input.content.chars().count() as i64,
        None,
        None,
        None,
        &operation_id,
        &request_hash,
        &now,
        None,
    )?;
    let mutation_hash = canonical_hash(&json!({
        "messageId": message_id,
        "turnId": message_id,
        "sequenceNo": sequence_no,
        "role": "user",
        "contentHash": content_hash,
    }));
    let receipt = advance_and_receipt(
        &transaction,
        &session,
        &operation_id,
        APPEND_OPERATION,
        &request_hash,
        &mutation_hash,
        Some(message_id),
        None,
        &now,
    )?;
    transaction.commit().map_err(AppError::database)?;
    Ok(receipt)
}

pub fn bind_turn_task(
    connection: &mut Connection,
    input: BindCoCreationTurnTaskInput,
) -> Result<CoCreationMutationReceiptV1, AppError> {
    let novel_id = normalize_identifier(&input.novel_id, "novelId")?;
    let session_id = normalize_identifier(&input.session_id, "sessionId")?;
    let user_message_id = normalize_identifier(&input.user_message_id, "userMessageId")?;
    let task_id = normalize_identifier(&input.task_id, "taskId")?;
    let operation_id = normalize_identifier(&input.operation_id, "operationId")?;
    let expected_state_hash = normalize_expected_hash(&input.expected_state_hash)?;
    let request_value = json!({
        "contract": "co_creation_bind_turn_task_v1",
        "novelId": novel_id,
        "sessionId": session_id,
        "userMessageId": user_message_id,
        "taskId": task_id,
        "expectedRevision": input.expected_revision,
        "expectedStateHash": expected_state_hash,
    });
    let request_hash = checked_request_hash(&request_value, input.request_hash.as_deref())?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    if let Some(receipt) = replay_receipt(
        &transaction,
        &session_id,
        &operation_id,
        BIND_OPERATION,
        &request_hash,
    )? {
        transaction.commit().map_err(AppError::database)?;
        return Ok(receipt);
    }
    let session = expected_session(
        &transaction,
        &novel_id,
        &session_id,
        input.expected_revision,
        &expected_state_hash,
    )?;
    let message = co_creation_repository::find_message(&transaction, &user_message_id)?
        .ok_or_else(|| AppError::new(codes::TARGET_NOT_FOUND, "共创用户消息不存在", false))?;
    if message.session_id != session_id || message.role != "user" {
        return Err(AppError::new(
            codes::TARGET_SCOPE_MISMATCH,
            "共创 turn 不属于当前会话",
            false,
        ));
    }
    let task = task_scope(
        &transaction,
        &novel_id,
        &session_id,
        &user_message_id,
        &task_id,
    )?;
    if !matches!(
        task.status.as_str(),
        "created"
            | "preparing_context"
            | "ready"
            | "queued"
            | "running"
            | "validating"
            | "completed"
            | "failed"
            | "cancelled"
    ) {
        return Err(AppError::new(
            codes::AI_TASK_ILLEGAL_TRANSITION,
            "后台任务当前不能绑定共创 turn",
            false,
        ));
    }
    co_creation_repository::bind_message_task(
        &transaction,
        &user_message_id,
        &session_id,
        &task_id,
    )?;
    let now = Utc::now().to_rfc3339();
    let mutation_hash = canonical_hash(&json!({
        "messageId": user_message_id,
        "taskId": task_id,
        "status": "running",
    }));
    let receipt = advance_and_receipt(
        &transaction,
        &session,
        &operation_id,
        BIND_OPERATION,
        &request_hash,
        &mutation_hash,
        Some(user_message_id),
        None,
        &now,
    )?;
    transaction.commit().map_err(AppError::database)?;
    Ok(receipt)
}

pub fn complete_turn(
    connection: &mut Connection,
    input: CompleteCoCreationTurnInput,
) -> Result<CoCreationMutationReceiptV1, AppError> {
    let novel_id = normalize_identifier(&input.novel_id, "novelId")?;
    let session_id = normalize_identifier(&input.session_id, "sessionId")?;
    let user_message_id = normalize_identifier(&input.user_message_id, "userMessageId")?;
    let task_id = normalize_identifier(&input.task_id, "taskId")?;
    let artifact_id = normalize_identifier(&input.artifact_id, "artifactId")?;
    let operation_id = normalize_identifier(&input.operation_id, "operationId")?;
    normalize_expected_hash(&input.expected_state_hash)?;
    if input.expected_revision < 0 {
        return Err(invalid("共创 turn expectedRevision 无效"));
    }
    let request_value = json!({
        "contract": "co_creation_complete_turn_v1",
        "novelId": novel_id,
        "sessionId": session_id,
        "userMessageId": user_message_id,
        "taskId": task_id,
        "artifactId": artifact_id,
    });
    let request_hash = checked_request_hash(&request_value, input.request_hash.as_deref())?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    if let Some(receipt) = replay_receipt(
        &transaction,
        &session_id,
        &operation_id,
        COMPLETE_OPERATION,
        &request_hash,
    )? {
        transaction.commit().map_err(AppError::database)?;
        return Ok(receipt);
    }
    let session = active_session(&transaction, &novel_id, &session_id)?;
    let user_message = co_creation_repository::find_message(&transaction, &user_message_id)?
        .ok_or_else(|| AppError::new(codes::TARGET_NOT_FOUND, "共创用户消息不存在", false))?;
    if user_message.session_id != session_id
        || user_message.role != "user"
        || user_message.task_id.as_deref() != Some(task_id.as_str())
    {
        return Err(AppError::new(
            codes::TARGET_SCOPE_MISMATCH,
            "共创 turn 与后台任务范围不一致",
            false,
        ));
    }
    let task = task_scope(
        &transaction,
        &novel_id,
        &session_id,
        &user_message_id,
        &task_id,
    )?;
    if task.status != "completed" {
        return Err(AppError::new(
            codes::AI_TASK_ILLEGAL_TRANSITION,
            "后台任务尚未完成，不能完成共创 turn",
            false,
        ));
    }
    let artifact = artifact_scope(&transaction, &novel_id, &task_id, &artifact_id)?;
    let structured_output = validated_turn_output(&task, &artifact)?;
    let artifact_ref = artifact
        .display_content_ref_id
        .as_deref()
        .unwrap_or(&artifact.raw_content_ref_id);
    let artifact_content =
        large_text_repository::read_verified_document(&transaction, artifact_ref)?;
    if artifact_content.content.trim().is_empty() || text_contains_secret(&artifact_content.content)
    {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "共创回复为空或包含授权凭据",
            false,
        ));
    }
    let now = Utc::now().to_rfc3339();
    let assistant_content = canonical_json(&structured_output);
    let assistant_content_hash = large_text_repository::sha256(&assistant_content);
    let assistant_content_length = assistant_content.chars().count() as i64;
    let assistant_message_id = uuid::Uuid::new_v4().to_string();
    let body_ref_id = uuid::Uuid::new_v4().to_string();
    let sequence_no = co_creation_repository::next_message_sequence(&transaction, &session_id)?;
    large_text_repository::insert_document_for_target(
        &transaction,
        &body_ref_id,
        "co_creation_message",
        &assistant_message_id,
        "body",
        None,
        &assistant_content,
        &assistant_content_hash,
        &now,
    )?;
    co_creation_repository::finish_user_turn(
        &transaction,
        &user_message_id,
        &session_id,
        &task_id,
        "completed",
        None,
        &now,
    )?;
    co_creation_repository::insert_message(
        &transaction,
        &assistant_message_id,
        &session_id,
        &user_message.turn_id,
        sequence_no,
        "assistant",
        "completed",
        &body_ref_id,
        &assistant_content_hash,
        assistant_content_length,
        Some(&user_message_id),
        Some(&task_id),
        Some(&artifact_id),
        &operation_id,
        &request_hash,
        &now,
        Some(&now),
    )?;
    let mutation_hash = canonical_hash(&json!({
        "messageId": assistant_message_id,
        "turnId": user_message.turn_id,
        "sequenceNo": sequence_no,
        "role": "assistant",
        "taskId": task_id,
        "artifactId": artifact_id,
        "contentHash": assistant_content_hash,
    }));
    let receipt = advance_and_receipt(
        &transaction,
        &session,
        &operation_id,
        COMPLETE_OPERATION,
        &request_hash,
        &mutation_hash,
        Some(assistant_message_id),
        None,
        &now,
    )?;
    transaction.commit().map_err(AppError::database)?;
    Ok(receipt)
}

pub fn fail_turn(
    connection: &mut Connection,
    input: FailCoCreationTurnInput,
) -> Result<CoCreationMutationReceiptV1, AppError> {
    let novel_id = normalize_identifier(&input.novel_id, "novelId")?;
    let session_id = normalize_identifier(&input.session_id, "sessionId")?;
    let user_message_id = normalize_identifier(&input.user_message_id, "userMessageId")?;
    let task_id = normalize_identifier(&input.task_id, "taskId")?;
    let operation_id = normalize_identifier(&input.operation_id, "operationId")?;
    let error_code = normalize_identifier(&input.error_code, "errorCode")?;
    let error_message = input.error_message.trim();
    normalize_expected_hash(&input.expected_state_hash)?;
    if input.expected_revision < 0 {
        return Err(invalid("共创 turn expectedRevision 无效"));
    }
    if error_message.is_empty()
        || error_message.chars().count() > 1000
        || text_contains_secret(error_message)
    {
        return Err(invalid("共创 turn 错误摘要无效或包含凭据"));
    }
    let error_value = json!({ "code": error_code, "message": error_message });
    let request_value = json!({
        "contract": "co_creation_fail_turn_v1",
        "novelId": novel_id,
        "sessionId": session_id,
        "userMessageId": user_message_id,
        "taskId": task_id,
        "error": error_value,
    });
    let request_hash = checked_request_hash(&request_value, input.request_hash.as_deref())?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    if let Some(receipt) = replay_receipt(
        &transaction,
        &session_id,
        &operation_id,
        FAIL_OPERATION,
        &request_hash,
    )? {
        transaction.commit().map_err(AppError::database)?;
        return Ok(receipt);
    }
    let session = active_session(&transaction, &novel_id, &session_id)?;
    let user_message = co_creation_repository::find_message(&transaction, &user_message_id)?
        .ok_or_else(|| AppError::new(codes::TARGET_NOT_FOUND, "共创用户消息不存在", false))?;
    if user_message.session_id != session_id
        || user_message.role != "user"
        || user_message.task_id.as_deref() != Some(task_id.as_str())
    {
        return Err(AppError::new(
            codes::TARGET_SCOPE_MISMATCH,
            "共创 turn 与后台任务范围不一致",
            false,
        ));
    }
    let task = task_scope(
        &transaction,
        &novel_id,
        &session_id,
        &user_message_id,
        &task_id,
    )?;
    let completed_validation_failure = task.status == "completed"
        && matches!(
            error_code.as_str(),
            "CO_CREATION_OUTPUT_INVALID"
                | "ARTIFACT_VALIDATION_FAILED"
                | "CO_CREATION_RESULT_STALE"
        );
    if !matches!(task.status.as_str(), "failed" | "cancelled") && !completed_validation_failure {
        return Err(AppError::new(
            codes::AI_TASK_ILLEGAL_TRANSITION,
            "后台任务不是失败或取消状态",
            false,
        ));
    }
    let now = Utc::now().to_rfc3339();
    let turn_status = if task.status == "cancelled" {
        "cancelled"
    } else {
        "failed"
    };
    let error_json = error_value.to_string();
    co_creation_repository::finish_user_turn(
        &transaction,
        &user_message_id,
        &session_id,
        &task_id,
        turn_status,
        Some(&error_json),
        &now,
    )?;
    let mutation_hash = canonical_hash(&json!({
        "messageId": user_message_id,
        "taskId": task_id,
        "status": turn_status,
        "errorHash": canonical_hash(&error_value),
    }));
    let receipt = advance_and_receipt(
        &transaction,
        &session,
        &operation_id,
        FAIL_OPERATION,
        &request_hash,
        &mutation_hash,
        Some(user_message_id),
        None,
        &now,
    )?;
    transaction.commit().map_err(AppError::database)?;
    Ok(receipt)
}

fn valid_stage_key(value: &str) -> bool {
    matches!(
        value,
        "story_seed"
            | "creative_intent"
            | "world_background"
            | "rule_system"
            | "protagonist"
            | "core_conflict"
            | "story_arc"
            | "outline"
            | "chapter_plan"
            | "chapter_generation"
    )
}

pub fn save_draft_revision(
    connection: &mut Connection,
    input: SaveCoCreationDraftRevisionInput,
) -> Result<CoCreationMutationReceiptV1, AppError> {
    let novel_id = normalize_identifier(&input.novel_id, "novelId")?;
    let session_id = normalize_identifier(&input.session_id, "sessionId")?;
    let stage_key = input.stage_key.trim().to_string();
    let operation_id = normalize_identifier(&input.operation_id, "operationId")?;
    let expected_state_hash = normalize_expected_hash(&input.expected_state_hash)?;
    let expected_draft_content_hash = input
        .expected_draft_content_hash
        .as_deref()
        .map(normalize_expected_hash)
        .transpose()?;
    if !valid_stage_key(&stage_key)
        || input.schema_version != CO_CREATION_SCHEMA_VERSION
        || input.expected_draft_revision < 0
        || (input.expected_draft_revision == 0 && expected_draft_content_hash.is_some())
        || (input.expected_draft_revision > 0 && expected_draft_content_hash.is_none())
        || !matches!(
            input.origin.as_str(),
            "author_edit" | "assistant_proposal_accepted" | "assistant_turn"
        )
        || !input.payload.is_object()
        || input.payload.get("currentStage").and_then(Value::as_str) != Some(stage_key.as_str())
    {
        return Err(invalid("共创阶段草案请求无效"));
    }
    if contains_secret(&input.payload) {
        return Err(invalid("共创阶段草案禁止包含 API Key 或授权凭据"));
    }
    if input.origin == "author_edit"
        && (input.source_message_id.is_some()
            || input.source_task_id.is_some()
            || input.source_artifact_id.is_some())
    {
        return Err(invalid("作者直接编辑草案不能伪造 AI 来源"));
    }
    if matches!(
        input.origin.as_str(),
        "assistant_proposal_accepted" | "assistant_turn"
    ) && (input.source_message_id.is_none()
        || input.source_task_id.is_none()
        || input.source_artifact_id.is_none())
    {
        return Err(invalid(
            "采用 AI 建议的草案必须保留 Message/Task/Artifact 来源",
        ));
    }
    let payload_hash = canonical_hash(&input.payload);
    let request_value = json!({
        "contract": "co_creation_save_stage_draft_v1",
        "novelId": novel_id,
        "sessionId": session_id,
        "stageKey": stage_key,
        "schemaVersion": input.schema_version,
        "payloadHash": payload_hash,
        "origin": input.origin,
        "sourceMessageId": input.source_message_id,
        "sourceTaskId": input.source_task_id,
        "sourceArtifactId": input.source_artifact_id,
        "expectedDraftRevision": input.expected_draft_revision,
        "expectedDraftContentHash": expected_draft_content_hash,
        "expectedRevision": input.expected_revision,
        "expectedStateHash": expected_state_hash,
    });
    let request_hash = checked_request_hash(&request_value, input.request_hash.as_deref())?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    if let Some(receipt) = replay_receipt(
        &transaction,
        &session_id,
        &operation_id,
        SAVE_DRAFT_OPERATION,
        &request_hash,
    )? {
        transaction.commit().map_err(AppError::database)?;
        return Ok(receipt);
    }
    let session = expected_session(
        &transaction,
        &novel_id,
        &session_id,
        input.expected_revision,
        &expected_state_hash,
    )?;
    let latest = co_creation_repository::latest_draft(&transaction, &session_id, &stage_key)?;
    match latest.as_ref() {
        None if input.expected_draft_revision != 0 => {
            return Err(AppError::new(
                codes::DOCUMENT_VERSION_CONFLICT,
                "共创阶段草案已变化，请重新读取",
                false,
            ))
        }
        Some(draft)
            if draft.revision_no != input.expected_draft_revision
                || expected_draft_content_hash.as_deref() != Some(draft.content_hash.as_str()) =>
        {
            return Err(AppError::new(
                codes::DOCUMENT_VERSION_CONFLICT,
                "共创阶段草案已变化，请重新读取",
                false,
            )
            .with_details(json!({
                "expectedDraftRevision": input.expected_draft_revision,
                "expectedDraftContentHash": expected_draft_content_hash,
                "actualDraftRevision": draft.revision_no,
                "actualDraftContentHash": draft.content_hash,
            })))
        }
        Some(_) if input.expected_draft_revision == 0 => {
            return Err(AppError::new(
                codes::DOCUMENT_VERSION_CONFLICT,
                "共创阶段草案已变化，请重新读取",
                false,
            ))
        }
        _ => {}
    }
    let mut source_turn_user_message_id = None;
    if let Some(message_id) = input.source_message_id.as_deref() {
        let message = co_creation_repository::find_message(&transaction, message_id)?
            .ok_or_else(|| AppError::new(codes::TARGET_NOT_FOUND, "草案来源消息不存在", false))?;
        if message.session_id != session_id
            || message.role != "assistant"
            || message.status != "completed"
            || message.task_id.as_deref() != input.source_task_id.as_deref()
            || message.artifact_id.as_deref() != input.source_artifact_id.as_deref()
        {
            return Err(AppError::new(
                codes::TARGET_SCOPE_MISMATCH,
                "草案来源消息与会话或 AI 结果不一致",
                false,
            ));
        }
        source_turn_user_message_id = message.reply_to_message_id;
    }
    if let Some(task_id) = input.source_task_id.as_deref() {
        let user_message_id = source_turn_user_message_id.as_deref().ok_or_else(|| {
            AppError::new(
                codes::TARGET_SCOPE_MISMATCH,
                "草案来源缺少原始用户 turn",
                false,
            )
        })?;
        let task = task_scope(
            &transaction,
            &novel_id,
            &session_id,
            user_message_id,
            task_id,
        )?;
        if task.status != "completed" {
            return Err(AppError::new(
                codes::AI_TASK_ILLEGAL_TRANSITION,
                "草案来源任务尚未完成",
                false,
            ));
        }
    }
    if let (Some(task_id), Some(artifact_id)) = (
        input.source_task_id.as_deref(),
        input.source_artifact_id.as_deref(),
    ) {
        let artifact = artifact_scope(&transaction, &novel_id, task_id, artifact_id)?;
        let structured_payload: Value = artifact
            .structured_payload_json
            .as_deref()
            .map(serde_json::from_str)
            .transpose()
            .map_err(|_| {
                AppError::new(
                    codes::ARTIFACT_VALIDATION_FAILED,
                    "草案来源 Artifact 的结构化内容无效",
                    false,
                )
            })?
            .ok_or_else(|| {
                AppError::new(
                    codes::ARTIFACT_VALIDATION_FAILED,
                    "草案来源 Artifact 缺少结构化内容",
                    false,
                )
            })?;
        if !structured_payload.is_object() || contains_secret(&structured_payload) {
            return Err(AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "草案来源 Artifact 的结构化内容不安全",
                false,
            ));
        }
    }
    let revision_no = latest
        .as_ref()
        .map(|draft| draft.revision_no)
        .unwrap_or(0)
        .checked_add(1)
        .ok_or_else(|| invalid("阶段草案 revision 超出范围"))?;
    let draft_revision_id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let payload_json = canonical_json(&input.payload);
    co_creation_repository::insert_draft(
        &transaction,
        &draft_revision_id,
        &session_id,
        &stage_key,
        revision_no,
        latest
            .as_ref()
            .map(|draft| draft.draft_revision_id.as_str()),
        input.schema_version,
        &payload_json,
        &payload_hash,
        &input.origin,
        input.source_message_id.as_deref(),
        input.source_task_id.as_deref(),
        input.source_artifact_id.as_deref(),
        &operation_id,
        &request_hash,
        &now,
    )?;
    let mutation_hash = canonical_hash(&json!({
        "draftRevisionId": draft_revision_id,
        "stageKey": stage_key,
        "revisionNo": revision_no,
        "parentRevisionId": latest.as_ref().map(|draft| draft.draft_revision_id.as_str()),
        "contentHash": payload_hash,
        "origin": input.origin,
    }));
    let receipt = advance_and_receipt(
        &transaction,
        &session,
        &operation_id,
        SAVE_DRAFT_OPERATION,
        &request_hash,
        &mutation_hash,
        None,
        Some(draft_revision_id),
        &now,
    )?;
    transaction.commit().map_err(AppError::database)?;
    Ok(receipt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::artifact_repository;
    use crate::services::ai_task_service;
    use rusqlite::OptionalExtension;

    fn connection() -> Result<Connection, Box<dyn std::error::Error>> {
        let connection = ai_task_service::tests::connection()?;
        connection.execute_batch(
            "CREATE TABLE novels (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                deleted_at TEXT
             );
             INSERT INTO novels (id,title,deleted_at) VALUES
                ('novel-a','A',NULL),('novel-b','B',NULL);",
        )?;
        Ok(connection)
    }

    fn open(connection: &mut Connection, novel_id: &str) -> OpenCoCreationWorkspaceResultV1 {
        open_workspace(
            connection,
            OpenCoCreationWorkspaceInput {
                novel_id: novel_id.to_string(),
            },
        )
        .expect("open workspace")
    }

    fn append_input(
        workspace: &CoCreationWorkspaceV1,
        operation_id: &str,
        content: &str,
    ) -> AppendCoCreationUserMessageInput {
        AppendCoCreationUserMessageInput {
            novel_id: workspace.session.novel_id.clone(),
            session_id: workspace.session.session_id.clone(),
            expected_revision: workspace.session.revision,
            expected_state_hash: workspace.session.state_hash.clone(),
            operation_id: operation_id.to_string(),
            request_hash: None,
            content: content.to_string(),
        }
    }

    fn read(connection: &Connection, novel_id: &str, session_id: &str) -> CoCreationWorkspaceV1 {
        read_workspace(
            connection,
            ReadCoCreationWorkspaceInput {
                novel_id: novel_id.to_string(),
                session_id: session_id.to_string(),
            },
        )
        .expect("read workspace")
    }

    fn insert_background_task(
        connection: &Connection,
        task_id: &str,
        novel_id: &str,
        status: &str,
        worker: bool,
        session_id: &str,
        user_message_id: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let target_hint = json!({
            "contract": "co_creation_turn_v1",
            "sessionId": session_id,
            "userMessageId": user_message_id,
            "currentStage": "story_seed",
            "canonicalDataHash": large_text_repository::sha256("canonical-data"),
            "dataRevision": 1,
        })
        .to_string();
        connection.execute(
            "INSERT INTO ai_tasks
                (task_id,task_type,novel_id,scope_type,status,trace_id,operation_id,
                 request_hash,created_at,worker_kind,target_hint_json)
             VALUES (?1,'co_creation_turn',?2,'novel',?3,?4,?5,?6,?7,?8,?9)",
            params![
                task_id,
                novel_id,
                status,
                format!("trace-{task_id}"),
                format!("task-operation-{task_id}"),
                large_text_repository::sha256(task_id),
                "2026-07-13T00:00:00Z",
                worker.then_some("provider"),
                target_hint,
            ],
        )?;
        let snapshot_id = format!("input-{task_id}");
        let input_payload = json!({
            "contract": "co_creation_turn_v1",
            "sessionId": session_id,
            "userMessageId": user_message_id,
            "currentStage": "story_seed",
            "canonicalDataHash": large_text_repository::sha256("canonical-data"),
            "dataRevision": 1,
        })
        .to_string();
        connection.execute(
            "INSERT INTO ai_input_snapshots
                (snapshot_id,task_id,schema_version,input_type,payload_json,content_hash,created_at)
             VALUES (?1,?2,1,'co_creation_turn_input',?3,?4,?5)",
            params![
                snapshot_id,
                task_id,
                input_payload,
                large_text_repository::sha256(task_id),
                "2026-07-13T00:00:00Z",
            ],
        )?;
        connection.execute(
            "UPDATE ai_tasks SET input_snapshot_id=?1 WHERE task_id=?2",
            params![snapshot_id, task_id],
        )?;
        Ok(())
    }

    fn finish_task_with_artifact(
        connection: &Connection,
        task_id: &str,
        novel_id: &str,
        artifact_id: &str,
        content: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let now = "2026-07-13T00:01:00Z";
        let attempt_id = format!("attempt-{task_id}");
        let document_id = format!("document-{artifact_id}");
        let hash = large_text_repository::sha256(content);
        let structured_payload_json = serde_json::from_str::<Value>(content).ok().map(|_| content);
        connection.execute(
            "INSERT INTO ai_task_attempts
                (attempt_id,task_id,attempt_number,provider_id,status,started_at,finished_at)
             VALUES (?1,?2,1,'mock','succeeded',?3,?3)",
            params![attempt_id, task_id, now],
        )?;
        large_text_repository::insert_document_for_target(
            connection,
            &document_id,
            "result_artifact",
            artifact_id,
            "raw",
            None,
            content,
            &hash,
            now,
        )?;
        artifact_repository::insert_artifact(
            connection,
            artifact_id,
            task_id,
            &attempt_id,
            "generic_json",
            1,
            &document_id,
            None,
            structured_payload_json,
            novel_id,
            None,
            None,
            None,
            None,
            &hash,
            content.chars().count() as i64,
            "valid",
            None,
            None,
            now,
        )?;
        connection.execute(
            "UPDATE ai_tasks SET status='completed',current_attempt_id=?1,
                result_artifact_id=?2,completed_at=?3 WHERE task_id=?4",
            params![attempt_id, artifact_id, now, task_id],
        )?;
        Ok(())
    }

    fn valid_turn_output(natural_language_reply: &str) -> String {
        json!({
            "schemaVersion": 1,
            "naturalLanguageReply": natural_language_reply,
            "intent": "answer_current_question",
            "currentStage": "story_seed",
            "extractedInformation": [],
            "pendingConfirmations": [],
            "quickReplies": [],
            "changeSuggestions": [],
            "stageCompletion": {
                "stage": "story_seed",
                "status": "in_progress",
                "completedRequiredFields": [],
                "missingRequiredFields": ["storySeed.premise"],
                "percentage": 0
            },
            "dataRevision": 1
        })
        .to_string()
    }

    fn bind_input(
        workspace: &CoCreationWorkspaceV1,
        user_message_id: &str,
        task_id: &str,
        operation_id: &str,
    ) -> BindCoCreationTurnTaskInput {
        BindCoCreationTurnTaskInput {
            novel_id: workspace.session.novel_id.clone(),
            session_id: workspace.session.session_id.clone(),
            user_message_id: user_message_id.to_string(),
            task_id: task_id.to_string(),
            expected_revision: workspace.session.revision,
            expected_state_hash: workspace.session.state_hash.clone(),
            operation_id: operation_id.to_string(),
            request_hash: None,
        }
    }

    #[test]
    fn co_creation01_open_append_and_restore_from_file() -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!(
            "ai-novel-studio-co-creation-{}.db",
            uuid::Uuid::new_v4()
        ));
        let (session_id, message_hash) = {
            let mut connection = Connection::open(&path)?;
            connection.execute_batch("PRAGMA foreign_keys=ON;")?;
            connection.execute_batch(
                "CREATE TABLE chapter_drafts (
                    id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,chapter_id TEXT NOT NULL,
                    content TEXT NOT NULL DEFAULT '',version_no INTEGER NOT NULL DEFAULT 1,
                    ai_task_id TEXT,note TEXT,large_text_ref_id TEXT
                 );
                 CREATE TABLE quality_check_reports (
                    id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,chapter_id TEXT NOT NULL,
                    draft_id TEXT NOT NULL,ai_task_id TEXT
                 );
                 CREATE TABLE novels (id TEXT PRIMARY KEY,title TEXT NOT NULL,deleted_at TEXT);
                 INSERT INTO novels VALUES ('novel-a','A',NULL);",
            )?;
            crate::migrations::run_migrations(&mut connection)?;
            let opened = open(&mut connection, "novel-a");
            assert!(opened.created);
            let input = append_input(&opened.workspace, "append-restart", "一起确定成长主题");
            let receipt = append_user_message(&mut connection, input)?;
            assert_eq!(receipt.revision, 1);
            (
                opened.workspace.session.session_id,
                large_text_repository::sha256("一起确定成长主题"),
            )
        };
        {
            let mut connection = Connection::open(&path)?;
            connection.execute_batch("PRAGMA foreign_keys=ON;")?;
            crate::migrations::run_migrations(&mut connection)?;
            let restored = open(&mut connection, "novel-a");
            assert!(!restored.created);
            assert_eq!(restored.workspace.session.session_id, session_id);
            assert_eq!(restored.workspace.session.revision, 1);
            assert_eq!(restored.workspace.messages.len(), 1);
            assert_eq!(restored.workspace.messages[0].content_hash, message_hash);
            assert_eq!(restored.workspace.messages[0].content, "一起确定成长主题");
        }
        std::fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn co_creation02_append_uses_cas_and_persistent_idempotency(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let opened = open(&mut connection, "novel-a");
        let input = append_input(&opened.workspace, "append-1", "保留克制的感情线");
        let first = append_user_message(&mut connection, input.clone())?;
        let replay = append_user_message(&mut connection, input.clone())?;
        assert!(replay.idempotent_replay);
        assert_eq!(replay.message_id, first.message_id);
        assert_eq!(replay.state_hash, first.state_hash);

        let mut changed = input;
        changed.content = "换成热烈感情线".into();
        let conflict = append_user_message(&mut connection, changed).expect_err("payload conflict");
        assert_eq!(conflict.code, codes::OPERATION_PAYLOAD_CONFLICT);

        let stale = append_input(&opened.workspace, "append-2", "第二条消息");
        let stale_error = append_user_message(&mut connection, stale).expect_err("stale cas");
        assert_eq!(stale_error.code, codes::DOCUMENT_VERSION_CONFLICT);
        let count: i64 =
            connection.query_row("SELECT COUNT(*) FROM co_creation_messages", [], |row| {
                row.get(0)
            })?;
        assert_eq!(count, 1);
        Ok(())
    }

    #[test]
    fn co_creation03_rejects_credentials_and_rolls_back_partial_large_text(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let opened = open(&mut connection, "novel-a");
        let secret = append_input(
            &opened.workspace,
            "append-secret",
            "authorization: Bearer abcdefghijklmnop",
        );
        let error = append_user_message(&mut connection, secret).expect_err("credential");
        assert_eq!(error.code, codes::OPERATION_PAYLOAD_CONFLICT);

        connection.execute_batch(
            "CREATE TRIGGER fail_co_creation_message
             BEFORE INSERT ON co_creation_messages
             BEGIN SELECT RAISE(ABORT,'injected message failure'); END;",
        )?;
        let failed = append_input(&opened.workspace, "append-fail", "事务必须完整回滚");
        append_user_message(&mut connection, failed).expect_err("injected failure");
        let counts: (i64, i64, i64) = connection.query_row(
            "SELECT
                (SELECT COUNT(*) FROM co_creation_messages),
                (SELECT COUNT(*) FROM large_text_documents),
                (SELECT COUNT(*) FROM co_creation_operations)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        assert_eq!(counts, (0, 0, 0));
        let session = co_creation_repository::find_session(
            &connection,
            &opened.workspace.session.session_id,
        )?
        .expect("session");
        assert_eq!(session.revision, 0);
        Ok(())
    }

    #[test]
    fn co_creation04_bind_validates_task_scope_and_worker() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = connection()?;
        let opened = open(&mut connection, "novel-a");
        let append = append_user_message(
            &mut connection,
            append_input(&opened.workspace, "append-bind", "请给出三个方向"),
        )?;
        let workspace = read(&connection, "novel-a", &opened.workspace.session.session_id);
        let message_id = append.message_id.expect("message");
        insert_background_task(
            &connection,
            "task-b",
            "novel-b",
            "queued",
            true,
            &workspace.session.session_id,
            &message_id,
        )?;
        let cross = bind_input(&workspace, &message_id, "task-b", "bind-cross");
        let error = bind_turn_task(&mut connection, cross).expect_err("cross novel task");
        assert_eq!(error.code, codes::TARGET_SCOPE_MISMATCH);

        insert_background_task(
            &connection,
            "task-no-worker",
            "novel-a",
            "queued",
            false,
            &workspace.session.session_id,
            &message_id,
        )?;
        let no_worker = bind_input(&workspace, &message_id, "task-no-worker", "bind-no-worker");
        let error = bind_turn_task(&mut connection, no_worker).expect_err("not background");
        assert_eq!(error.code, codes::AI_TASK_ILLEGAL_TRANSITION);

        insert_background_task(
            &connection,
            "task-a",
            "novel-a",
            "queued",
            true,
            &workspace.session.session_id,
            &message_id,
        )?;
        let valid = bind_input(&workspace, &message_id, "task-a", "bind-valid");
        let bound = bind_turn_task(&mut connection, valid.clone())?;
        let replay = bind_turn_task(&mut connection, valid)?;
        assert!(replay.idempotent_replay);
        assert_eq!(replay.revision, bound.revision);
        let workspace = read(&connection, "novel-a", &opened.workspace.session.session_id);
        assert_eq!(workspace.messages[0].status, "running");
        assert_eq!(workspace.messages[0].task_id.as_deref(), Some("task-a"));
        let turn_context = workspace.messages[0]
            .turn_context
            .as_ref()
            .expect("frozen turn context");
        assert_eq!(turn_context.current_stage, "story_seed");
        assert_eq!(turn_context.data_revision, 1);
        assert!(valid_hash(&turn_context.canonical_data_hash));
        Ok(())
    }

    #[test]
    fn co_creation05_complete_turn_validates_artifact_and_rolls_back_then_replays(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let opened = open(&mut connection, "novel-a");
        let appended = append_user_message(
            &mut connection,
            append_input(&opened.workspace, "append-complete", "继续细化主题"),
        )?;
        let user_message_id = appended.message_id.expect("message");
        insert_background_task(
            &connection,
            "task-a",
            "novel-a",
            "queued",
            true,
            &opened.workspace.session.session_id,
            &user_message_id,
        )?;
        let workspace = read(&connection, "novel-a", &opened.workspace.session.session_id);
        bind_turn_task(
            &mut connection,
            bind_input(&workspace, &user_message_id, "task-a", "bind-complete"),
        )?;
        insert_background_task(
            &connection,
            "task-b",
            "novel-b",
            "queued",
            true,
            &opened.workspace.session.session_id,
            &user_message_id,
        )?;
        finish_task_with_artifact(
            &connection,
            "task-b",
            "novel-b",
            "artifact-b",
            &valid_turn_output("其他作品回复"),
        )?;
        finish_task_with_artifact(
            &connection,
            "task-a",
            "novel-a",
            "artifact-a",
            &valid_turn_output("建议围绕代价与选择展开。"),
        )?;
        let workspace = read(&connection, "novel-a", &opened.workspace.session.session_id);
        let cross = CompleteCoCreationTurnInput {
            novel_id: "novel-a".into(),
            session_id: workspace.session.session_id.clone(),
            user_message_id: user_message_id.clone(),
            task_id: "task-a".into(),
            artifact_id: "artifact-b".into(),
            expected_revision: workspace.session.revision,
            expected_state_hash: workspace.session.state_hash.clone(),
            operation_id: "complete-cross".into(),
            request_hash: None,
        };
        let error = complete_turn(&mut connection, cross).expect_err("cross artifact");
        assert_eq!(error.code, codes::TARGET_SCOPE_MISMATCH);

        connection.execute_batch(
            "CREATE TRIGGER fail_assistant_message
             BEFORE INSERT ON co_creation_messages WHEN NEW.role='assistant'
             BEGIN SELECT RAISE(ABORT,'injected assistant failure'); END;",
        )?;
        let complete = CompleteCoCreationTurnInput {
            artifact_id: "artifact-a".into(),
            operation_id: "complete-a".into(),
            ..CompleteCoCreationTurnInput {
                novel_id: "novel-a".into(),
                session_id: workspace.session.session_id.clone(),
                user_message_id: user_message_id.clone(),
                task_id: "task-a".into(),
                artifact_id: String::new(),
                expected_revision: workspace.session.revision,
                expected_state_hash: workspace.session.state_hash.clone(),
                operation_id: String::new(),
                request_hash: None,
            }
        };
        complete_turn(&mut connection, complete.clone()).expect_err("rollback completion");
        let after_failure = read(&connection, "novel-a", &workspace.session.session_id);
        assert_eq!(after_failure.session.revision, workspace.session.revision);
        assert_eq!(after_failure.messages.len(), 1);
        assert_eq!(after_failure.messages[0].status, "running");
        connection.execute_batch("DROP TRIGGER fail_assistant_message;")?;

        let completed = complete_turn(&mut connection, complete.clone())?;
        let replay = complete_turn(&mut connection, complete)?;
        assert!(replay.idempotent_replay);
        assert_eq!(completed.message_id, replay.message_id);
        let final_workspace = read(&connection, "novel-a", &workspace.session.session_id);
        assert_eq!(final_workspace.messages.len(), 2);
        assert_eq!(final_workspace.messages[0].status, "completed");
        assert_eq!(final_workspace.messages[1].role, "assistant");
        let assistant_payload: Value = serde_json::from_str(&final_workspace.messages[1].content)?;
        assert_eq!(
            assistant_payload["naturalLanguageReply"].as_str(),
            Some("建议围绕代价与选择展开。")
        );

        let assistant_id = completed.message_id.expect("assistant");
        let body_ref: String = connection.query_row(
            "SELECT body_ref_id FROM co_creation_messages WHERE message_id=?1",
            params![assistant_id],
            |row| row.get(0),
        )?;
        large_text_repository::delete_if_unreferenced(&connection, &body_ref)?;
        let still_exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM large_text_documents WHERE id=?1",
            params![body_ref],
            |row| row.get(0),
        )?;
        assert_eq!(still_exists, 1);
        Ok(())
    }

    #[test]
    fn co_creation06_fail_turn_is_terminal_and_redacts_credentials(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let opened = open(&mut connection, "novel-a");
        let appended = append_user_message(
            &mut connection,
            append_input(&opened.workspace, "append-fail-turn", "尝试生成方案"),
        )?;
        let message_id = appended.message_id.expect("message");
        insert_background_task(
            &connection,
            "task-fail",
            "novel-a",
            "queued",
            true,
            &opened.workspace.session.session_id,
            &message_id,
        )?;
        let workspace = read(&connection, "novel-a", &opened.workspace.session.session_id);
        bind_turn_task(
            &mut connection,
            bind_input(&workspace, &message_id, "task-fail", "bind-fail"),
        )?;
        connection.execute(
            "UPDATE ai_tasks SET status='failed' WHERE task_id='task-fail'",
            [],
        )?;
        let workspace = read(&connection, "novel-a", &opened.workspace.session.session_id);
        let fail = FailCoCreationTurnInput {
            novel_id: "novel-a".into(),
            session_id: workspace.session.session_id.clone(),
            user_message_id: message_id.clone(),
            task_id: "task-fail".into(),
            error_code: "AI_PROVIDER_TIMEOUT".into(),
            error_message: "服务暂时超时".into(),
            expected_revision: workspace.session.revision,
            expected_state_hash: workspace.session.state_hash.clone(),
            operation_id: "fail-turn".into(),
            request_hash: None,
        };
        let mut secret = fail.clone();
        secret.operation_id = "fail-secret".into();
        secret.error_message = "api_key=abcdefghijk".into();
        fail_turn(&mut connection, secret).expect_err("credential error detail");
        let failed = fail_turn(&mut connection, fail.clone())?;
        let replay = fail_turn(&mut connection, fail.clone())?;
        assert!(replay.idempotent_replay);
        assert_eq!(failed.revision, replay.revision);
        let workspace = read(&connection, "novel-a", &fail.session_id);
        assert_eq!(workspace.messages.len(), 1);
        assert_eq!(workspace.messages[0].status, "failed");
        assert_eq!(
            workspace.messages[0]
                .error
                .as_ref()
                .and_then(|v| v["code"].as_str()),
            Some("AI_PROVIDER_TIMEOUT")
        );
        Ok(())
    }

    #[test]
    fn co_creation07_draft_revisions_are_append_only_cas_and_secret_safe(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let opened = open(&mut connection, "novel-a");
        let first_input = SaveCoCreationDraftRevisionInput {
            novel_id: "novel-a".into(),
            session_id: opened.workspace.session.session_id.clone(),
            stage_key: "creative_intent".into(),
            schema_version: 1,
            payload: json!({"currentStage":"creative_intent","goal":"写成长故事"}),
            origin: "author_edit".into(),
            source_message_id: None,
            source_task_id: None,
            source_artifact_id: None,
            expected_draft_revision: 0,
            expected_draft_content_hash: None,
            expected_revision: 0,
            expected_state_hash: opened.workspace.session.state_hash.clone(),
            operation_id: "draft-r1".into(),
            request_hash: None,
        };
        let first = save_draft_revision(&mut connection, first_input.clone())?;
        let replay = save_draft_revision(&mut connection, first_input.clone())?;
        assert!(replay.idempotent_replay);
        assert_eq!(first.draft_revision_id, replay.draft_revision_id);

        let stale = SaveCoCreationDraftRevisionInput {
            operation_id: "draft-stale".into(),
            payload: json!({"currentStage":"creative_intent","goal":"不同"}),
            ..first_input.clone()
        };
        let error = save_draft_revision(&mut connection, stale).expect_err("stale draft cas");
        assert_eq!(error.code, codes::DOCUMENT_VERSION_CONFLICT);

        let workspace = read(&connection, "novel-a", &opened.workspace.session.session_id);
        let second = SaveCoCreationDraftRevisionInput {
            payload: json!({"currentStage":"creative_intent","goal":"写有代价的成长故事"}),
            expected_draft_revision: 1,
            expected_draft_content_hash: Some(workspace.draft_revisions[0].content_hash.clone()),
            expected_revision: workspace.session.revision,
            expected_state_hash: workspace.session.state_hash.clone(),
            operation_id: "draft-r2".into(),
            ..first_input
        };
        save_draft_revision(&mut connection, second)?;
        let workspace = read(&connection, "novel-a", &opened.workspace.session.session_id);
        assert_eq!(workspace.draft_revisions.len(), 2);
        assert_eq!(workspace.draft_revisions[0].revision_no, 1);
        assert_eq!(workspace.draft_revisions[1].revision_no, 2);
        assert_eq!(
            workspace.draft_revisions[1].parent_revision_id,
            Some(workspace.draft_revisions[0].draft_revision_id.clone())
        );
        let immutable = connection.execute(
            "UPDATE co_creation_draft_revisions SET payload_json='{}' WHERE revision_no=1",
            [],
        );
        assert!(immutable.is_err());

        let secret = SaveCoCreationDraftRevisionInput {
            payload: json!({"currentStage":"creative_intent","apiKey":"abcdefghijk"}),
            expected_revision: workspace.session.revision,
            expected_state_hash: workspace.session.state_hash,
            operation_id: "draft-secret".into(),
            novel_id: "novel-a".into(),
            session_id: opened.workspace.session.session_id,
            stage_key: "creative_intent".into(),
            schema_version: 1,
            origin: "author_edit".into(),
            source_message_id: None,
            source_task_id: None,
            source_artifact_id: None,
            expected_draft_revision: 2,
            expected_draft_content_hash: Some(workspace.draft_revisions[1].content_hash.clone()),
            request_hash: None,
        };
        save_draft_revision(&mut connection, secret).expect_err("secret draft");
        Ok(())
    }

    #[test]
    fn co_creation08_accepted_assistant_draft_requires_exact_provenance(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let opened = open(&mut connection, "novel-a");
        let appended = append_user_message(
            &mut connection,
            append_input(&opened.workspace, "append-provenance", "生成创作意图草案"),
        )?;
        let user_id = appended.message_id.expect("user");
        insert_background_task(
            &connection,
            "task-a",
            "novel-a",
            "queued",
            true,
            &opened.workspace.session.session_id,
            &user_id,
        )?;
        let workspace = read(&connection, "novel-a", &opened.workspace.session.session_id);
        bind_turn_task(
            &mut connection,
            bind_input(&workspace, &user_id, "task-a", "bind-provenance"),
        )?;
        finish_task_with_artifact(
            &connection,
            "task-a",
            "novel-a",
            "artifact-a",
            &valid_turn_output("聚焦选择的代价"),
        )?;
        let workspace = read(&connection, "novel-a", &opened.workspace.session.session_id);
        let completed = complete_turn(
            &mut connection,
            CompleteCoCreationTurnInput {
                novel_id: "novel-a".into(),
                session_id: workspace.session.session_id.clone(),
                user_message_id: user_id,
                task_id: "task-a".into(),
                artifact_id: "artifact-a".into(),
                expected_revision: workspace.session.revision,
                expected_state_hash: workspace.session.state_hash,
                operation_id: "complete-provenance".into(),
                request_hash: None,
            },
        )?;
        let assistant_id = completed.message_id.expect("assistant");
        let workspace = read(&connection, "novel-a", &opened.workspace.session.session_id);
        let accepted = SaveCoCreationDraftRevisionInput {
            novel_id: "novel-a".into(),
            session_id: workspace.session.session_id.clone(),
            stage_key: "creative_intent".into(),
            schema_version: 1,
            payload: json!({"currentStage":"creative_intent","goal":"聚焦选择的代价"}),
            origin: "assistant_proposal_accepted".into(),
            source_message_id: Some(assistant_id),
            source_task_id: Some("task-a".into()),
            source_artifact_id: Some("artifact-a".into()),
            expected_draft_revision: 0,
            expected_draft_content_hash: None,
            expected_revision: workspace.session.revision,
            expected_state_hash: workspace.session.state_hash,
            operation_id: "draft-ai-accepted".into(),
            request_hash: None,
        };
        save_draft_revision(&mut connection, accepted)?;
        let workspace = read(&connection, "novel-a", &opened.workspace.session.session_id);
        assert_eq!(workspace.draft_revisions.len(), 1);
        assert_eq!(
            workspace.draft_revisions[0].source_artifact_id.as_deref(),
            Some("artifact-a")
        );
        assert_eq!(
            workspace.draft_revisions[0].origin,
            "assistant_proposal_accepted"
        );
        Ok(())
    }

    #[test]
    fn co_creation09_cross_novel_read_and_database_tamper_fail_closed(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let opened = open(&mut connection, "novel-a");
        let cross = read_workspace(
            &connection,
            ReadCoCreationWorkspaceInput {
                novel_id: "novel-b".into(),
                session_id: opened.workspace.session.session_id.clone(),
            },
        )
        .expect_err("cross novel read");
        assert_eq!(cross.code, codes::TARGET_SCOPE_MISMATCH);

        append_user_message(
            &mut connection,
            append_input(&opened.workspace, "append-tamper", "原始消息"),
        )?;
        connection.execute_batch(
            "DROP TRIGGER trg_co_creation_message_content_immutable;
             UPDATE co_creation_messages SET content_hash='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';",
        )?;
        let error = read_workspace(
            &connection,
            ReadCoCreationWorkspaceInput {
                novel_id: "novel-a".into(),
                session_id: opened.workspace.session.session_id,
            },
        )
        .expect_err("tampered message");
        assert_eq!(error.code, codes::LARGE_TEXT_HASH_MISMATCH);
        Ok(())
    }

    #[test]
    fn co_creation11_terminal_task_binds_and_invalid_output_terminalizes_after_session_change(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let opened = open(&mut connection, "novel-a");
        let appended = append_user_message(
            &mut connection,
            append_input(&opened.workspace, "append-terminal", "请生成一个候选"),
        )?;
        let message_id = appended.message_id.expect("message");
        insert_background_task(
            &connection,
            "task-terminal",
            "novel-a",
            "completed",
            true,
            &opened.workspace.session.session_id,
            &message_id,
        )?;
        let workspace = read(&connection, "novel-a", &opened.workspace.session.session_id);
        bind_turn_task(
            &mut connection,
            bind_input(&workspace, &message_id, "task-terminal", "bind-terminal"),
        )?;
        finish_task_with_artifact(
            &connection,
            "task-terminal",
            "novel-a",
            "artifact-invalid",
            "只有自然语言，没有结构化协议",
        )?;
        let stale_terminal_base =
            read(&connection, "novel-a", &opened.workspace.session.session_id);
        save_draft_revision(
            &mut connection,
            SaveCoCreationDraftRevisionInput {
                novel_id: "novel-a".into(),
                session_id: stale_terminal_base.session.session_id.clone(),
                stage_key: "story_seed".into(),
                schema_version: 1,
                payload: json!({"currentStage":"story_seed","fields": {}}),
                origin: "author_edit".into(),
                source_message_id: None,
                source_task_id: None,
                source_artifact_id: None,
                expected_draft_revision: 0,
                expected_draft_content_hash: None,
                expected_revision: stale_terminal_base.session.revision,
                expected_state_hash: stale_terminal_base.session.state_hash.clone(),
                operation_id: "edit-while-terminalizing".into(),
                request_hash: None,
            },
        )?;
        let invalid_artifact = complete_turn(
            &mut connection,
            CompleteCoCreationTurnInput {
                novel_id: "novel-a".into(),
                session_id: stale_terminal_base.session.session_id.clone(),
                user_message_id: message_id.clone(),
                task_id: "task-terminal".into(),
                artifact_id: "artifact-invalid".into(),
                expected_revision: stale_terminal_base.session.revision,
                expected_state_hash: stale_terminal_base.session.state_hash.clone(),
                operation_id: "complete-invalid-output".into(),
                request_hash: None,
            },
        )
        .expect_err("natural-language-only artifact");
        assert_eq!(invalid_artifact.code, codes::ARTIFACT_VALIDATION_FAILED);
        let receipt = fail_turn(
            &mut connection,
            FailCoCreationTurnInput {
                novel_id: "novel-a".into(),
                session_id: stale_terminal_base.session.session_id.clone(),
                user_message_id: message_id,
                task_id: "task-terminal".into(),
                error_code: "CO_CREATION_OUTPUT_INVALID".into(),
                error_message: "AI 共创结构化结果未通过校验".into(),
                expected_revision: stale_terminal_base.session.revision,
                expected_state_hash: stale_terminal_base.session.state_hash,
                operation_id: "terminal-invalid-output".into(),
                request_hash: None,
            },
        )?;
        let final_workspace = read(&connection, "novel-a", &receipt.session_id);
        assert_eq!(final_workspace.messages[0].status, "failed");
        assert_eq!(final_workspace.session.revision, receipt.revision);
        Ok(())
    }

    #[test]
    fn co_creation12_recovers_pre_bind_task_after_session_context_changes(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let opened = open(&mut connection, "novel-a");
        let appended = append_user_message(
            &mut connection,
            append_input(&opened.workspace, "append-pre-bind", "先创建任务再模拟退出"),
        )?;
        let message_id = appended.message_id.expect("message");
        insert_background_task(
            &connection,
            "task-pre-bind",
            "novel-a",
            "queued",
            true,
            &opened.workspace.session.session_id,
            &message_id,
        )?;
        let task_operation = format!(
            "co-creation:{}:message:{}:conversation_turn",
            opened.workspace.session.session_id, message_id
        );
        connection.execute(
            "UPDATE ai_tasks SET operation_id=?1 WHERE task_id='task-pre-bind'",
            params![task_operation],
        )?;

        let before_edit = read(&connection, "novel-a", &opened.workspace.session.session_id);
        save_draft_revision(
            &mut connection,
            SaveCoCreationDraftRevisionInput {
                novel_id: "novel-a".into(),
                session_id: before_edit.session.session_id.clone(),
                stage_key: "story_seed".into(),
                schema_version: 1,
                payload: json!({"currentStage":"story_seed","fields": {
                    "storySeed.premise": {"value":"结构化页已变化","state":"user_confirmed"}
                }}),
                origin: "author_edit".into(),
                source_message_id: None,
                source_task_id: None,
                source_artifact_id: None,
                expected_draft_revision: 0,
                expected_draft_content_hash: None,
                expected_revision: before_edit.session.revision,
                expected_state_hash: before_edit.session.state_hash,
                operation_id: "context-change-before-bind".into(),
                request_hash: None,
            },
        )?;

        let recovered = recover_turn_task(
            &connection,
            RecoverCoCreationTurnTaskInput {
                novel_id: "novel-a".into(),
                session_id: opened.workspace.session.session_id.clone(),
                user_message_id: message_id.clone(),
            },
        )?
        .expect("existing deterministic task");
        assert_eq!(recovered.task_id, "task-pre-bind");
        assert_eq!(recovered.current_stage, "story_seed");
        assert_eq!(recovered.data_revision, 1);

        let latest = read(&connection, "novel-a", &opened.workspace.session.session_id);
        bind_turn_task(
            &mut connection,
            bind_input(&latest, &message_id, &recovered.task_id, "bind-recovered"),
        )?;
        let final_workspace = read(&connection, "novel-a", &opened.workspace.session.session_id);
        assert_eq!(final_workspace.messages[0].status, "running");
        assert_eq!(
            final_workspace.messages[0]
                .turn_context
                .as_ref()
                .map(|context| context.canonical_data_hash.as_str()),
            Some(recovered.canonical_data_hash.as_str())
        );
        Ok(())
    }

    #[test]
    fn co_creation10_forward_migration_is_latest_and_keeps_old_checksums(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let connection = connection()?;
        let latest: String = connection.query_row(
            "SELECT migration_id FROM schema_migrations ORDER BY migration_id DESC LIMIT 1",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(latest, "020_co_creation_workspace");
        let count: i64 =
            connection.query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })?;
        assert_eq!(count, 19);
        let old_checksum_missing: Option<String> = connection
            .query_row(
                "SELECT checksum FROM schema_migrations WHERE migration_id='019_ai_task_archival'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        assert!(old_checksum_missing.is_some());
        Ok(())
    }
}
