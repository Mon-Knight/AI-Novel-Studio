//! Creation transaction and frozen execution provenance.
use super::*;
use serde_json::json;

pub(super) fn create_task_after_validation(
    connection: &mut Connection,
    mut input: CreateAiTaskInput,
) -> Result<ai_task_repository::AiTaskRecord, AppError> {
    if input
        .target_hint_json
        .as_ref()
        .is_some_and(|hint| hint.get("nativeRuleSet").is_some())
    {
        return Err(AppError::new(
            codes::AI_TASK_INPUT_INVALID,
            "nativeRuleSet 只能由原生候选事务冻结",
            false,
        ));
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let existing_task =
        ai_task_repository::find_task_by_operation(&transaction, &input.operation_id)?;
    // Freeze before hashing or inserting any new candidate execution facts. On exact
    // replay reuse the original native snapshot, never authorize a fresher rule set.
    let native_rule_set = if let Some(existing) = existing_task.as_ref() {
        existing
            .target_hint_json
            .as_ref()
            .and_then(|hint| hint.get("nativeRuleSet"))
            .cloned()
    } else if input.scope_type == "system" {
        None // Connection probes have no novel/rule-set authority.
    } else {
        validate_target(&transaction, &input)?;
        Some(
            serde_json::to_value(crate::services::world_rule_governance::rule_set_snapshot(
                &transaction,
                &input.novel_id,
            )?)
            .map_err(|_| AppError::new(codes::AI_TASK_INPUT_INVALID, "规则基线无法冻结", false))?,
        )
    };
    if let Some(expected) = input
        .target_hint_json
        .as_ref()
        .and_then(|hint| hint.get("expectedRuleSetFingerprint"))
    {
        if expected.as_str().is_none()
            || native_rule_set
                .as_ref()
                .and_then(|snapshot| snapshot.get("fingerprint"))
                != Some(expected)
        {
            return Err(AppError::new(
                "RULE_SET_BASE_CONFLICT",
                "模型读取规则后规则集已变化，候选不能冻结为新基线",
                false,
            ));
        }
    }
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
    // Preserve the caller hash gate over the exact supplied request before appending
    // server-owned metadata; the persisted authoritative hash includes nativeRuleSet.
    let caller_request_hash = request_hash(&input, &input_hash, &context_hash, &constraint_hash)?;
    if input
        .request_hash
        .as_deref()
        .is_some_and(|provided| provided != caller_request_hash)
    {
        return Err(AppError::new(
            codes::OPERATION_PAYLOAD_CONFLICT,
            "requestHash 与服务器规范化请求不一致",
            false,
        ));
    }

    if let Some(snapshot) = native_rule_set {
        let hint = input.target_hint_json.get_or_insert_with(|| json!({}));
        hint.as_object_mut()
            .ok_or_else(|| {
                AppError::new(
                    codes::AI_TASK_INPUT_INVALID,
                    "任务目标提示必须为对象",
                    false,
                )
            })?
            .insert("nativeRuleSet".to_string(), snapshot);
    }
    let calculated_request_hash =
        request_hash(&input, &input_hash, &context_hash, &constraint_hash)?;
    if let Some(existing) = existing_task {
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
