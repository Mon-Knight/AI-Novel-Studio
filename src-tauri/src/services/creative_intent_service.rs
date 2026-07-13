use crate::domain::ai_task::AiTaskStatus;
use crate::domain::stage3_prerequisite::{
    AuthorConfirmationV1, CreativeIntentRecordV1, CreativeIntentSnapshotV1,
    CreativeIntentStatementInputV1, CreativeIntentStatementV1, CreativeKnowledgeClass,
    FreezeCreativeIntentInput, CREATIVE_INTENT_SCHEMA_VERSION,
};
use crate::errors::{codes, AppError};
use crate::repositories::{ai_task_repository, large_text_repository};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::Serialize;
use serde_json::{json, Number, Value};
use std::collections::HashSet;

const TASK_TYPE: &str = "creative_intent_freeze";
const INPUT_CONTRACT: &str = "creative_intent_v1";
const FREEZE_CONTRACT: &str = "creative_intent_freeze_v1";
const COMPILER_VERSION: &str = "creative-intent-freeze-v1";
const LOCAL_PROVIDER_ID: &str = "local-author";

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
            keys.sort_by(|left, right| left.encode_utf16().cmp(right.encode_utf16()));
            format!(
                "{{{}}}",
                keys.into_iter()
                    .map(|key| format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap_or_else(|_| "\"\"".into()),
                        canonical_json(&values[key])
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

fn contains_secret(value: &Value) -> bool {
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

fn serialized<T: Serialize>(value: &T) -> Result<Value, AppError> {
    serde_json::to_value(value).map_err(|_| invalid("创作意图无法序列化"))
}

fn without_hash<T: Serialize>(value: &T, field: &str) -> Result<Value, AppError> {
    let mut result = serialized(value)?;
    result
        .as_object_mut()
        .ok_or_else(|| invalid("创作意图协议必须为 JSON 对象"))?
        .remove(field);
    Ok(result)
}

fn evidence_validation_error(
    knowledge_class: &CreativeKnowledgeClass,
    evidence: &[crate::domain::stage3_prerequisite::EvidenceReferenceV1],
) -> Option<String> {
    if !matches!(knowledge_class, CreativeKnowledgeClass::AuthorExplicit) && evidence.is_empty() {
        return Some("推断偏好和待确认信息必须提供证据".to_string());
    }
    let mut ids = HashSet::new();
    for item in evidence {
        if item.evidence_id.trim().is_empty() {
            return Some("证据 ID 不能为空".to_string());
        }
        if !ids.insert(item.evidence_id.trim()) {
            return Some(format!("证据 ID 重复: {}", item.evidence_id));
        }
        if !matches!(
            item.source_type.as_str(),
            "author_input" | "project_document" | "canon" | "ai_inference"
        ) {
            return Some("证据来源类型无效".to_string());
        }
    }
    None
}

fn value_is_empty(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(value) => value.trim().is_empty(),
        Value::Array(value) => value.is_empty(),
        Value::Object(value) => value.is_empty(),
        _ => false,
    }
}

fn build_statement(
    input: &CreativeIntentStatementInputV1,
    now: &str,
) -> Result<CreativeIntentStatementV1, AppError> {
    if input.statement_id.trim().is_empty() {
        return Err(invalid("创作意图陈述 ID 不能为空"));
    }
    if value_is_empty(&input.value) {
        return Err(invalid("创作意图内容不能为空"));
    }
    if !input.confidence.is_finite() || !(0.0..=1.0).contains(&input.confidence) {
        return Err(invalid("创作意图 confidence 必须位于 0 到 1"));
    }
    if let Some(message) = evidence_validation_error(&input.knowledge_class, &input.evidence) {
        return Err(invalid(message));
    }
    let status = input.confirmation.status.as_str();
    if !matches!(status, "pending" | "confirmed" | "rejected") {
        return Err(invalid("创作意图确认状态无效"));
    }
    if matches!(
        input.knowledge_class,
        CreativeKnowledgeClass::AuthorExplicit
    ) && status != "confirmed"
    {
        return Err(invalid("作者明确输入必须逐项确认后才能冻结"));
    }
    let confirmation = AuthorConfirmationV1 {
        status: status.to_string(),
        confirmed_by: (status != "pending").then(|| "author".to_string()),
        confirmed_at: (status != "pending").then(|| now.to_string()),
    };
    let mut statement = CreativeIntentStatementV1 {
        statement_id: input.statement_id.trim().to_string(),
        kind: input.kind.clone(),
        knowledge_class: input.knowledge_class.clone(),
        value: input.value.clone(),
        confidence: input.confidence,
        evidence: input.evidence.clone(),
        confirmation,
        statement_hash: String::new(),
    };
    statement.statement_hash = canonical_hash(&without_hash(&statement, "statementHash")?);
    Ok(statement)
}

fn validate_snapshot(
    intent: &CreativeIntentSnapshotV1,
    expected_novel_id: &str,
) -> Result<(), AppError> {
    if intent.schema_version != CREATIVE_INTENT_SCHEMA_VERSION
        || intent.status != "frozen"
        || intent.revision < 1
        || intent.intent_id.trim().is_empty()
        || intent.created_at.trim().is_empty()
        || intent.frozen_at.trim().is_empty()
    {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "创作意图快照协议无效",
            false,
        ));
    }
    if intent.novel_id != expected_novel_id {
        return Err(AppError::new(
            codes::TARGET_SCOPE_MISMATCH,
            "创作意图快照与任务不属于同一作品",
            false,
        ));
    }
    if intent.statements.is_empty() {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "创作意图快照不能为空",
            false,
        ));
    }
    let mut statement_ids = HashSet::new();
    for statement in &intent.statements {
        if statement.statement_id.trim().is_empty()
            || !statement_ids.insert(statement.statement_id.trim())
        {
            return Err(AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "创作意图快照包含空或重复陈述 ID",
                false,
            ));
        }
        if value_is_empty(&statement.value) {
            return Err(AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "创作意图快照包含空内容",
                false,
            ));
        }
        if !statement.confidence.is_finite() || !(0.0..=1.0).contains(&statement.confidence) {
            return Err(AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "创作意图快照 confidence 无效",
                false,
            ));
        }
        if let Some(message) =
            evidence_validation_error(&statement.knowledge_class, &statement.evidence)
        {
            return Err(AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                message,
                false,
            ));
        }
        if canonical_hash(&without_hash(statement, "statementHash")?) != statement.statement_hash {
            return Err(AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "创作意图陈述 hash 校验失败",
                false,
            ));
        }
        let confirmed = statement.confirmation.status == "confirmed";
        if !matches!(
            statement.confirmation.status.as_str(),
            "pending" | "confirmed" | "rejected"
        ) {
            return Err(AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "创作意图确认状态无效",
                false,
            ));
        }
        if matches!(
            statement.knowledge_class,
            CreativeKnowledgeClass::AuthorExplicit
        ) && !confirmed
        {
            return Err(AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "作者明确输入缺少确认",
                false,
            ));
        }
        if statement.confirmation.status != "pending"
            && (statement.confirmation.confirmed_by.as_deref() != Some("author")
                || statement.confirmation.confirmed_at.is_none())
        {
            return Err(AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "创作意图确认记录无效",
                false,
            ));
        }
        if statement.confirmation.status == "pending"
            && (statement.confirmation.confirmed_by.is_some()
                || statement.confirmation.confirmed_at.is_some())
        {
            return Err(AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "待确认信息不得携带作者确认记录",
                false,
            ));
        }
    }
    if contains_secret(&serialized(intent)?) {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "创作意图快照包含凭据或授权信息",
            false,
        ));
    }
    if canonical_hash(&without_hash(intent, "contentHash")?) != intent.content_hash {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "创作意图快照 contentHash 校验失败",
            false,
        ));
    }
    Ok(())
}

fn parse_payload(
    task_id: &str,
    novel_id: &str,
    payload: &str,
    idempotent_replay: bool,
) -> Result<CreativeIntentRecordV1, AppError> {
    let value: Value = serde_json::from_str(payload).map_err(|_| {
        AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "创作意图 Snapshot 不是有效 JSON",
            false,
        )
    })?;
    if value.get("contract").and_then(Value::as_str) != Some(INPUT_CONTRACT) {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "创作意图 Snapshot contract 无效",
            false,
        ));
    }
    let intent: CreativeIntentSnapshotV1 = serde_json::from_value(
        value
            .get("intent")
            .cloned()
            .ok_or_else(|| invalid("创作意图 Snapshot 缺少 intent"))?,
    )
    .map_err(|_| {
        AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "创作意图 Snapshot 结构无效",
            false,
        )
    })?;
    validate_snapshot(&intent, novel_id)?;
    Ok(CreativeIntentRecordV1 {
        task_id: task_id.to_string(),
        intent,
        idempotent_replay,
    })
}

fn get_latest_from_connection(
    connection: &Connection,
    novel_id: &str,
) -> Result<Option<CreativeIntentRecordV1>, AppError> {
    let row: Option<(String, String)> = connection
        .query_row(
            "SELECT t.task_id, s.payload_json
             FROM ai_tasks t
             JOIN ai_input_snapshots s ON s.snapshot_id=t.input_snapshot_id
             WHERE t.novel_id=?1 AND t.task_type=?2 AND t.status='completed'
             ORDER BY t.rowid DESC LIMIT 1",
            params![novel_id, TASK_TYPE],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(AppError::database)?;
    row.map(|(task_id, payload)| parse_payload(&task_id, novel_id, &payload, false))
        .transpose()
}

fn get_for_task(
    connection: &Connection,
    task_id: &str,
    novel_id: &str,
    idempotent_replay: bool,
) -> Result<CreativeIntentRecordV1, AppError> {
    let row: Option<(String, String)> = connection
        .query_row(
            "SELECT t.status, s.payload_json
             FROM ai_tasks t
             JOIN ai_input_snapshots s ON s.snapshot_id=t.input_snapshot_id
             WHERE t.task_id=?1 AND t.novel_id=?2 AND t.task_type=?3",
            params![task_id, novel_id, TASK_TYPE],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(AppError::database)?;
    let Some((status, payload)) = row else {
        return Err(AppError::new(
            codes::AI_TASK_NOT_FOUND,
            "创作意图冻结任务不存在",
            false,
        ));
    };
    if status != "completed" {
        return Err(AppError::new(
            codes::OPERATION_IN_PROGRESS,
            "创作意图冻结任务尚未完成",
            true,
        ));
    }
    parse_payload(task_id, novel_id, &payload, idempotent_replay)
}

pub fn get_latest(
    connection: &Connection,
    novel_id: &str,
) -> Result<Option<CreativeIntentRecordV1>, AppError> {
    let novel_id = novel_id.trim();
    if novel_id.is_empty() {
        return Err(invalid("作品 ID 不能为空"));
    }
    get_latest_from_connection(connection, novel_id)
}

fn transition(
    transaction: &Transaction<'_>,
    task_id: &str,
    from: AiTaskStatus,
    to: AiTaskStatus,
    now: &str,
) -> Result<(), AppError> {
    from.validate_transition(to)?;
    ai_task_repository::cas_status(transaction, task_id, from.as_str(), to.as_str(), now)
}

fn insert_snapshots(
    transaction: &Transaction<'_>,
    task_id: &str,
    intent: &CreativeIntentSnapshotV1,
    now: &str,
) -> Result<(), AppError> {
    let input_snapshot_id = uuid::Uuid::new_v4().to_string();
    let context_snapshot_id = uuid::Uuid::new_v4().to_string();
    let constraint_snapshot_id = uuid::Uuid::new_v4().to_string();
    let input_payload = json!({ "contract": INPUT_CONTRACT, "intent": intent });
    let input_hash = canonical_hash(&json!({ "payload": input_payload, "bodyHash": Value::Null }));
    transaction
        .execute(
            "INSERT INTO ai_input_snapshots
         (snapshot_id,task_id,schema_version,input_type,payload_json,body_ref_id,
          source_draft_id,source_draft_version,base_content_hash,content_hash,created_at)
         VALUES (?1,?2,?3,?4,?5,NULL,NULL,NULL,NULL,?6,?7)",
            params![
                input_snapshot_id,
                task_id,
                CREATIVE_INTENT_SCHEMA_VERSION,
                INPUT_CONTRACT,
                input_payload.to_string(),
                input_hash,
                now
            ],
        )
        .map_err(AppError::database)?;

    let source_manifest = json!([{
        "type": "creative_intent",
        "intentId": intent.intent_id,
        "revision": intent.revision,
        "hash": intent.content_hash,
    }]);
    let budget = json!({
        "limits": {
            "maxProviderCalls": 0,
            "maxInputTokens": 0,
            "maxOutputTokens": 0,
            "maxCostUsd": 0,
            "maxDurationMs": 0
        },
        "used": {
            "providerCalls": 0,
            "inputTokens": 0,
            "outputTokens": 0,
            "costUsd": 0,
            "durationMs": 0
        },
        "onExceeded": "block"
    });
    let context_hash = canonical_hash(&json!({
        "manifest": source_manifest,
        "compiledHash": Value::Null,
        "budget": budget,
        "compilerVersion": COMPILER_VERSION,
    }));
    transaction
        .execute(
            "INSERT INTO ai_context_snapshots
         (snapshot_id,task_id,schema_version,source_manifest_json,compiled_context_ref_id,
          budget_json,compiler_version,content_hash,created_at)
         VALUES (?1,?2,?3,?4,NULL,?5,?6,?7,?8)",
            params![
                context_snapshot_id,
                task_id,
                CREATIVE_INTENT_SCHEMA_VERSION,
                source_manifest.to_string(),
                budget.to_string(),
                COMPILER_VERSION,
                context_hash,
                now
            ],
        )
        .map_err(AppError::database)?;

    let constraint_payload = json!({
        "contract": FREEZE_CONTRACT,
        "autoApply": false,
        "permissions": {
            "canReadCanon": false,
            "canSubmitTasks": false,
            "canProposeCanonChanges": false,
            "canApplyCanonChanges": false,
            "canChangeProviderConfig": false
        }
    });
    let provider_options = json!({});
    let template_hash = large_text_repository::sha256("");
    let constraint_hash = canonical_hash(&json!({
        "payload": constraint_payload,
        "templateId": "creative-intent-local-author",
        "templateVersion": "1",
        "templateHash": template_hash,
        "providerOptions": provider_options,
    }));
    transaction
        .execute(
            "INSERT INTO ai_constraint_snapshots
         (snapshot_id,task_id,schema_version,payload_json,prompt_template_id,
          prompt_template_version,prompt_template_hash,prompt_template_ref_id,
          provider_options_json,content_hash,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,NULL,?8,?9,?10)",
            params![
                constraint_snapshot_id,
                task_id,
                CREATIVE_INTENT_SCHEMA_VERSION,
                constraint_payload.to_string(),
                "creative-intent-local-author",
                "1",
                template_hash,
                provider_options.to_string(),
                constraint_hash,
                now
            ],
        )
        .map_err(AppError::database)?;
    ai_task_repository::link_snapshots(
        transaction,
        task_id,
        &input_snapshot_id,
        &context_snapshot_id,
        &constraint_snapshot_id,
    )
}

fn conflict(
    input: &FreezeCreativeIntentInput,
    latest: Option<&CreativeIntentRecordV1>,
) -> AppError {
    AppError::new(
        codes::DOCUMENT_VERSION_CONFLICT,
        "创作意图已在其他窗口更新，请重新读取",
        false,
    )
    .with_details(json!({
        "expectedRevision": input.expected_revision,
        "expectedContentHash": input.expected_content_hash,
        "actualRevision": latest.map(|item| item.intent.revision).unwrap_or(0),
        "actualContentHash": latest.map(|item| item.intent.content_hash.as_str()),
    }))
}

pub(crate) fn freeze_in_transaction(
    transaction: &Transaction<'_>,
    mut input: FreezeCreativeIntentInput,
) -> Result<CreativeIntentRecordV1, AppError> {
    input.novel_id = input.novel_id.trim().to_string();
    input.expected_content_hash = input
        .expected_content_hash
        .take()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if input.novel_id.is_empty() || input.expected_revision < 0 || input.statements.is_empty() {
        return Err(invalid("创作意图冻结请求无效"));
    }
    let target_revision = input
        .expected_revision
        .checked_add(1)
        .ok_or_else(|| invalid("创作意图 revision 超出范围"))?;
    if input.expected_revision == 0 && input.expected_content_hash.is_some() {
        return Err(invalid("首次冻结不能携带旧 contentHash"));
    }
    if input.expected_revision > 0 && input.expected_content_hash.is_none() {
        return Err(invalid("后续 revision 必须携带旧 contentHash"));
    }
    let mut ids = HashSet::new();
    for statement in &input.statements {
        if !ids.insert(statement.statement_id.trim()) {
            return Err(invalid(format!(
                "创作意图陈述 ID 重复: {}",
                statement.statement_id
            )));
        }
    }
    let request_value = json!({
        "contract": FREEZE_CONTRACT,
        "novelId": input.novel_id,
        "expectedRevision": input.expected_revision,
        "expectedContentHash": input.expected_content_hash,
        "statements": input.statements,
    });
    if contains_secret(&request_value) {
        return Err(invalid("创作意图 Snapshot 禁止包含 API Key 或授权信息"));
    }
    let request_hash = canonical_hash(&request_value);
    let operation_id = format!(
        "creative-intent:{}:revision:{}",
        input.novel_id, target_revision
    );
    if let Some(existing) = ai_task_repository::find_by_operation(&transaction, &operation_id)? {
        if existing.request_hash != request_hash {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "同一创作意图 revision 对应不同内容",
                false,
            ));
        }
        let replay = get_for_task(&transaction, &existing.task_id, &input.novel_id, true)?;
        return Ok(replay);
    }

    let novel_exists: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM novels WHERE id=?1 AND deleted_at IS NULL",
            params![input.novel_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if novel_exists != 1 {
        return Err(AppError::new(
            codes::TARGET_NOVEL_NOT_FOUND,
            "作品不存在或已删除",
            false,
        ));
    }
    let latest = get_latest_from_connection(&transaction, &input.novel_id)?;
    match latest.as_ref() {
        None if input.expected_revision != 0 => return Err(conflict(&input, None)),
        Some(current)
            if current.intent.revision != input.expected_revision
                || input.expected_content_hash.as_deref()
                    != Some(current.intent.content_hash.as_str()) =>
        {
            return Err(conflict(&input, latest.as_ref()));
        }
        Some(_) if input.expected_revision == 0 => {
            return Err(conflict(&input, latest.as_ref()));
        }
        _ => {}
    }

    let now = Utc::now().to_rfc3339();
    let statements = input
        .statements
        .iter()
        .map(|statement| build_statement(statement, &now))
        .collect::<Result<Vec<_>, _>>()?;
    let mut intent = CreativeIntentSnapshotV1 {
        schema_version: CREATIVE_INTENT_SCHEMA_VERSION,
        intent_id: uuid::Uuid::new_v4().to_string(),
        novel_id: input.novel_id.clone(),
        revision: target_revision,
        parent_intent_id: latest.as_ref().map(|item| item.intent.intent_id.clone()),
        status: "frozen".to_string(),
        statements,
        created_at: now.clone(),
        frozen_at: now.clone(),
        content_hash: String::new(),
    };
    intent.content_hash = canonical_hash(&without_hash(&intent, "contentHash")?);
    validate_snapshot(&intent, &input.novel_id)?;

    let task_id = uuid::Uuid::new_v4().to_string();
    let trace_id = uuid::Uuid::new_v4().to_string();
    ai_task_repository::insert(
        &transaction,
        &task_id,
        TASK_TYPE,
        &input.novel_id,
        None,
        None,
        "novel",
        &trace_id,
        &operation_id,
        &request_hash,
        None,
        &now,
    )?;
    transition(
        &transaction,
        &task_id,
        AiTaskStatus::Created,
        AiTaskStatus::PreparingContext,
        &now,
    )?;
    insert_snapshots(&transaction, &task_id, &intent, &now)?;
    transition(
        &transaction,
        &task_id,
        AiTaskStatus::PreparingContext,
        AiTaskStatus::Ready,
        &now,
    )?;
    transition(
        &transaction,
        &task_id,
        AiTaskStatus::Ready,
        AiTaskStatus::Queued,
        &now,
    )?;
    transition(
        &transaction,
        &task_id,
        AiTaskStatus::Queued,
        AiTaskStatus::Running,
        &now,
    )?;
    let attempt_id = uuid::Uuid::new_v4().to_string();
    ai_task_repository::insert_attempt(
        &transaction,
        &attempt_id,
        &task_id,
        1,
        Some(LOCAL_PROVIDER_ID),
        &now,
    )?;
    ai_task_repository::set_attempt_status(
        &transaction,
        &task_id,
        &attempt_id,
        &["running"],
        "succeeded",
        Some(
            &json!({
                "execution": "local_author",
                "providerCalls": 0,
                "inputTokens": 0,
                "outputTokens": 0,
                "durationMs": 0
            })
            .to_string(),
        ),
        None,
        &now,
    )?;
    transition(
        &transaction,
        &task_id,
        AiTaskStatus::Running,
        AiTaskStatus::Validating,
        &now,
    )?;
    transition(
        &transaction,
        &task_id,
        AiTaskStatus::Validating,
        AiTaskStatus::Completed,
        &now,
    )?;
    let record = CreativeIntentRecordV1 {
        task_id,
        intent,
        idempotent_replay: false,
    };
    Ok(record)
}

pub fn freeze(
    connection: &mut Connection,
    input: FreezeCreativeIntentInput,
) -> Result<CreativeIntentRecordV1, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let record = freeze_in_transaction(&transaction, input)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(record)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::ai_task_service;

    fn connection() -> Result<Connection, Box<dyn std::error::Error>> {
        let connection = ai_task_service::tests::connection()?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS novels (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                deleted_at TEXT
             );
             INSERT INTO novels (id,title,deleted_at) VALUES
                ('novel-a','A',NULL),('novel-b','B',NULL);",
        )?;
        Ok(connection)
    }

    fn input(novel_id: &str) -> FreezeCreativeIntentInput {
        FreezeCreativeIntentInput {
            novel_id: novel_id.to_string(),
            expected_revision: 0,
            expected_content_hash: None,
            statements: vec![CreativeIntentStatementInputV1 {
                statement_id: "goal-1".to_string(),
                kind: crate::domain::stage3_prerequisite::CreativeIntentKind::Goal,
                knowledge_class: CreativeKnowledgeClass::AuthorExplicit,
                value: json!("写一部长篇东方奇幻小说"),
                confidence: 1.0,
                evidence: vec![],
                confirmation:
                    crate::domain::stage3_prerequisite::CreativeIntentConfirmationInputV1 {
                        status: "confirmed".to_string(),
                    },
            }],
        }
    }

    #[test]
    fn intent01_freezes_reads_and_replays_without_provider_or_artifact(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let request = input("novel-a");
        let first = freeze(&mut connection, request.clone())?;
        assert_eq!(first.intent.revision, 1);
        assert!(!first.idempotent_replay);
        let latest = get_latest(&connection, "novel-a")?.expect("latest intent");
        assert_eq!(latest.intent.content_hash, first.intent.content_hash);
        let replay = freeze(&mut connection, request)?;
        assert!(replay.idempotent_replay);
        assert_eq!(replay.task_id, first.task_id);
        let counts: (i64, i64, i64, i64) = connection.query_row(
            "SELECT
                (SELECT COUNT(*) FROM ai_tasks WHERE task_type='creative_intent_freeze'),
                (SELECT COUNT(*) FROM ai_task_attempts),
                (SELECT COUNT(*) FROM ai_input_snapshots) +
                    (SELECT COUNT(*) FROM ai_context_snapshots) +
                    (SELECT COUNT(*) FROM ai_constraint_snapshots),
                (SELECT COUNT(*) FROM result_artifacts)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        assert_eq!(counts, (1, 1, 3, 0));
        let status: (String, String) = connection.query_row(
            "SELECT t.status,a.provider_id FROM ai_tasks t JOIN ai_task_attempts a
             ON a.task_id=t.task_id WHERE t.task_id=?1",
            params![first.task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(status, ("completed".into(), LOCAL_PROVIDER_ID.into()));
        Ok(())
    }

    #[test]
    fn intent02_versions_immutably_and_rejects_stale_cas() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = connection()?;
        let first = freeze(&mut connection, input("novel-a"))?;
        let mut stale = input("novel-a");
        stale.expected_revision = 1;
        stale.expected_content_hash = Some("stale".into());
        let error = freeze(&mut connection, stale).expect_err("stale hash must fail");
        assert_eq!(error.code, codes::DOCUMENT_VERSION_CONFLICT);

        let mut second_input = input("novel-a");
        second_input.expected_revision = 1;
        second_input.expected_content_hash = Some(first.intent.content_hash.clone());
        second_input.statements[0].value = json!("写一部长篇东方奇幻成长小说");
        let second = freeze(&mut connection, second_input)?;
        assert_eq!(second.intent.revision, 2);
        assert_eq!(
            second.intent.parent_intent_id.as_deref(),
            Some(first.intent.intent_id.as_str())
        );
        let payloads: Vec<String> = {
            let mut statement = connection.prepare(
                "SELECT s.payload_json FROM ai_tasks t JOIN ai_input_snapshots s
                 ON s.snapshot_id=t.input_snapshot_id
                 WHERE t.task_type='creative_intent_freeze' ORDER BY t.rowid",
            )?;
            let payloads = statement
                .query_map([], |row| row.get(0))?
                .collect::<Result<Vec<_>, _>>()?;
            payloads
        };
        assert_eq!(payloads.len(), 2);
        assert!(payloads[0].contains(&first.intent.content_hash));
        assert!(!payloads[0].contains("成长小说"));
        assert!(payloads[1].contains("成长小说"));
        Ok(())
    }

    #[test]
    fn intent03_changed_payload_for_same_revision_is_rejected(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        freeze(&mut connection, input("novel-a"))?;
        let mut changed = input("novel-a");
        changed.statements[0].value = json!("不同目标");
        let error = freeze(&mut connection, changed).expect_err("same operation must conflict");
        assert_eq!(error.code, codes::OPERATION_PAYLOAD_CONFLICT);
        Ok(())
    }

    #[test]
    fn intent04_transaction_failure_leaves_no_partial_task_or_snapshot(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        connection.execute_batch(
            "CREATE TRIGGER fail_creative_intent_context
             BEFORE INSERT ON ai_context_snapshots
             BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
        )?;
        freeze(&mut connection, input("novel-a")).expect_err("injected failure");
        let counts: (i64, i64, i64) = connection.query_row(
            "SELECT
                (SELECT COUNT(*) FROM ai_tasks),
                (SELECT COUNT(*) FROM ai_task_attempts),
                (SELECT COUNT(*) FROM ai_input_snapshots) +
                    (SELECT COUNT(*) FROM ai_context_snapshots) +
                    (SELECT COUNT(*) FROM ai_constraint_snapshots)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        assert_eq!(counts, (0, 0, 0));
        Ok(())
    }

    #[test]
    fn intent05_pending_inference_is_not_author_confirmation(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let mut request = input("novel-a");
        request.statements.push(CreativeIntentStatementInputV1 {
            statement_id: "preference-1".into(),
            kind: crate::domain::stage3_prerequisite::CreativeIntentKind::Preference,
            knowledge_class: CreativeKnowledgeClass::InferredPreference,
            value: json!("偏好克制感情线"),
            confidence: 0.7,
            evidence: vec![crate::domain::stage3_prerequisite::EvidenceReferenceV1 {
                evidence_id: "evidence-1".into(),
                source_type: "author_input".into(),
                source_id: None,
                excerpt: Some("作者强调克制".into()),
                content_hash: None,
            }],
            confirmation: crate::domain::stage3_prerequisite::CreativeIntentConfirmationInputV1 {
                status: "pending".into(),
            },
        });
        let result = freeze(&mut connection, request)?;
        let inference = &result.intent.statements[1];
        assert_eq!(inference.confirmation.status, "pending");
        assert!(inference.confirmation.confirmed_by.is_none());
        assert!(inference.confirmation.confirmed_at.is_none());
        Ok(())
    }

    #[test]
    fn intent06_hashes_match_the_shared_typescript_vector() -> Result<(), Box<dyn std::error::Error>>
    {
        let now = "2026-07-13T00:00:00.000Z";
        let statement = build_statement(&input("novel-a").statements[0], now)?;
        assert_eq!(
            statement.statement_hash,
            "7b6c2ee789159e1b5f370bdbc3a798d304bf007b2dfc9b19dafc012e16170e3e"
        );
        let mut intent = CreativeIntentSnapshotV1 {
            schema_version: CREATIVE_INTENT_SCHEMA_VERSION,
            intent_id: "intent-fixed".into(),
            novel_id: "novel-a".into(),
            revision: 1,
            parent_intent_id: None,
            status: "frozen".into(),
            statements: vec![statement],
            created_at: now.into(),
            frozen_at: now.into(),
            content_hash: String::new(),
        };
        intent.content_hash = canonical_hash(&without_hash(&intent, "contentHash")?);
        assert_eq!(
            intent.content_hash,
            "bfca2c4714852edf3f1f3f992f59929e4a8728941f7f2264ea3fed96c9004229"
        );
        Ok(())
    }

    #[test]
    fn intent07_canonical_json_matches_javascript_number_and_key_rules(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let lower: Value = serde_json::from_str("9007199254740992")?;
        let higher: Value = serde_json::from_str("9007199254740993")?;
        assert_eq!(canonical_json(&lower), "9007199254740992");
        assert_eq!(canonical_json(&higher), "9007199254740993");
        assert_ne!(canonical_hash(&lower), canonical_hash(&higher));

        let vector: Value = serde_json::from_str(
            r#"{"\uE000":"bmp","\uD800\uDC00":"astral","large":1e21,"small":1e-6,"negativeZero":-0}"#,
        )?;
        assert_eq!(
            canonical_json(&vector),
            "{\"large\":1e+21,\"negativeZero\":0,\"small\":0.000001,\"𐀀\":\"astral\",\"\":\"bmp\"}"
        );
        Ok(())
    }

    #[test]
    fn intent08_revalidates_semantics_and_rejects_credential_text(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let now = "2026-07-13T00:00:00.000Z";
        let mut statement = build_statement(&input("novel-a").statements[0], now)?;
        statement.confidence = 2.0;
        statement.statement_hash = canonical_hash(&without_hash(&statement, "statementHash")?);
        let mut intent = CreativeIntentSnapshotV1 {
            schema_version: CREATIVE_INTENT_SCHEMA_VERSION,
            intent_id: "intent-invalid".into(),
            novel_id: "novel-a".into(),
            revision: 1,
            parent_intent_id: None,
            status: "frozen".into(),
            statements: vec![statement],
            created_at: now.into(),
            frozen_at: now.into(),
            content_hash: String::new(),
        };
        intent.content_hash = canonical_hash(&without_hash(&intent, "contentHash")?);
        let validation_error =
            validate_snapshot(&intent, "novel-a").expect_err("invalid confidence");
        assert_eq!(validation_error.code, codes::ARTIFACT_VALIDATION_FAILED);

        let mut connection = connection()?;
        let mut secret = input("novel-a");
        secret.statements[0].value = json!("Authorization: Bearer abcdefghijklmnop");
        let secret_error = freeze(&mut connection, secret).expect_err("credential text");
        assert_eq!(secret_error.code, codes::OPERATION_PAYLOAD_CONFLICT);
        let task_count: i64 =
            connection.query_row("SELECT COUNT(*) FROM ai_tasks", [], |row| row.get(0))?;
        assert_eq!(task_count, 0);
        Ok(())
    }
}
