use crate::domain::apply_plan::{
    ApplyDependency, ApplyExecutionResult, ApplyOperation, ApplyPlan, ApplyPlanStatus,
    ArtifactTargetLink, CreateInitializationApplyPlanInput, APPLY_PLAN_SCHEMA_VERSION,
    INITIALIZATION_APPLY_VALIDATOR_VERSION,
};
use crate::domain::stage3_prerequisite::{
    InitializationCandidateBundleV1, InitializationCandidateV1,
    INITIALIZATION_CANDIDATE_SCHEMA_VERSION,
};
use crate::errors::{codes, AppError};
use crate::repositories::{
    apply_plan_repository, artifact_target_link_repository, large_text_repository,
};
use crate::services::placement_service;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, HashSet};

const INITIALIZATION_PAYLOAD_CONTRACT: &str = "initialization_candidate_apply_v1";

#[derive(Debug)]
struct InitializationArtifact {
    artifact_id: String,
    source_novel_id: String,
    processing_status: String,
    stale_at: Option<String>,
    structured_payload: Value,
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::new(codes::ARTIFACT_VALIDATION_FAILED, message, false)
}

fn read_artifact(
    connection: &Connection,
    artifact_id: &str,
) -> Result<InitializationArtifact, AppError> {
    connection
        .query_row(
            "SELECT artifact_id, source_novel_id, processing_status, structured_payload_json,
                (SELECT triggered_at FROM ai_artifact_stale_events s
                 WHERE s.artifact_id=result_artifacts.artifact_id LIMIT 1)
             FROM result_artifacts WHERE artifact_id=?1",
            params![artifact_id],
            |row| {
                let payload: Option<String> = row.get(3)?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    payload,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| invalid("初始化候选 Artifact 不存在"))
        .and_then(|row| {
            let structured_payload = row
                .3
                .as_deref()
                .ok_or_else(|| invalid("初始化候选 Artifact 缺少结构化内容"))
                .and_then(|value| {
                    serde_json::from_str(value)
                        .map_err(|_| invalid("初始化候选 Artifact 不是有效 JSON"))
                })?;
            Ok(InitializationArtifact {
                artifact_id: row.0,
                source_novel_id: row.1,
                processing_status: row.2,
                structured_payload,
                stale_at: row.4,
            })
        })
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string()),
        Value::Array(items) => format!(
            "[{}]",
            items
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",")
        ),
        Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort();
            let body = keys
                .into_iter()
                .map(|key| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap_or_else(|_| "\"\"".to_string()),
                        canonical_json(&values[key])
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{body}}}")
        }
    }
}

pub(crate) fn canonical_hash(value: &Value) -> String {
    large_text_repository::sha256(&canonical_json(value))
}

fn candidate_body(candidate: &InitializationCandidateV1) -> Value {
    json!({
        "candidateId": candidate.candidate_id,
        "targetType": candidate.target_type,
        "proposedValue": candidate.proposed_value,
        "knowledgeClass": candidate.knowledge_class,
        "confidence": candidate.confidence,
        "evidence": candidate.evidence,
        "explanation": candidate.explanation,
        "conflicts": candidate.conflicts,
        "dependsOnCandidateIds": candidate.depends_on_candidate_ids,
    })
}

fn parse_bundle(
    artifact: &InitializationArtifact,
) -> Result<InitializationCandidateBundleV1, AppError> {
    if artifact.stale_at.is_some() {
        return Err(AppError::new(
            codes::APPLY_PLAN_STALE,
            "过期初始化候选不能写入 Canon",
            false,
        ));
    }
    if artifact.processing_status != "valid" && artifact.processing_status != "valid_with_warnings"
    {
        return Err(invalid("初始化候选 Artifact 尚未通过校验"));
    }
    let mut content_without_hash = artifact.structured_payload.clone();
    let content_hash = content_without_hash
        .as_object_mut()
        .and_then(|object| object.remove("contentHash"))
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .ok_or_else(|| invalid("初始化候选包缺少 contentHash"))?;
    if canonical_hash(&content_without_hash) != content_hash {
        return Err(invalid("初始化候选包 contentHash 校验失败"));
    }
    let bundle: InitializationCandidateBundleV1 =
        serde_json::from_value(artifact.structured_payload.clone())
            .map_err(|error| invalid(format!("初始化候选包协议无效: {error}")))?;
    if bundle.schema_version != INITIALIZATION_CANDIDATE_SCHEMA_VERSION {
        return Err(invalid("不支持的初始化候选包 schemaVersion"));
    }
    if bundle.content_hash != content_hash {
        return Err(invalid("初始化候选包 hash 字段不一致"));
    }
    if bundle.novel_id != artifact.source_novel_id {
        return Err(AppError::new(
            codes::TARGET_SCOPE_MISMATCH,
            "初始化候选包与 Artifact 不属于同一作品",
            false,
        ));
    }
    if bundle.items.is_empty() {
        return Err(invalid("初始化候选包不能为空"));
    }
    let mut candidate_ids = HashSet::new();
    for candidate in &bundle.items {
        if !candidate_ids.insert(candidate.candidate_id.clone()) {
            return Err(invalid(format!("候选 ID 重复: {}", candidate.candidate_id)));
        }
        if candidate.evidence.is_empty() || candidate.explanation.trim().is_empty() {
            return Err(invalid(format!(
                "候选缺少证据或解释: {}",
                candidate.candidate_id
            )));
        }
        if canonical_hash(&candidate_body(candidate)) != candidate.candidate_hash {
            return Err(invalid(format!(
                "候选 hash 校验失败: {}",
                candidate.candidate_id
            )));
        }
    }
    Ok(bundle)
}

fn required_string(value: &Value, key: &str) -> Result<String, AppError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| invalid(format!("初始化候选缺少字段: {key}")))
}

fn optional_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn action_for_target(target_type: &str) -> Result<&'static str, AppError> {
    match target_type {
        "world_setting" => Ok("create_world_setting"),
        "rule_system" => Ok("create_rule_system"),
        "character" => Ok("create_character"),
        _ => Err(invalid(format!("不支持的初始化 Canon 目标: {target_type}"))),
    }
}

fn topological_operations<'a>(plan: &'a ApplyPlan) -> Result<Vec<&'a ApplyOperation>, AppError> {
    if plan.operations.is_empty() {
        return Err(invalid("多目标 ApplyPlan 不能为空"));
    }
    let mut operations = HashMap::new();
    let mut indegree = HashMap::new();
    let mut outgoing: HashMap<&str, Vec<&str>> = HashMap::new();
    for operation in &plan.operations {
        if operations
            .insert(operation.apply_operation_id.as_str(), operation)
            .is_some()
        {
            return Err(invalid("ApplyOperation ID 重复"));
        }
        indegree.insert(operation.apply_operation_id.as_str(), 0usize);
    }
    for dependency in &plan.dependencies {
        if dependency.operation_id == dependency.depends_on_operation_id {
            return Err(invalid("ApplyOperation 不能依赖自身"));
        }
        if !operations.contains_key(dependency.operation_id.as_str())
            || !operations.contains_key(dependency.depends_on_operation_id.as_str())
        {
            return Err(invalid("ApplyDependency 引用了未知操作"));
        }
        *indegree
            .get_mut(dependency.operation_id.as_str())
            .expect("operation checked") += 1;
        outgoing
            .entry(dependency.depends_on_operation_id.as_str())
            .or_default()
            .push(dependency.operation_id.as_str());
    }
    let mut ready = BTreeSet::new();
    for operation in &plan.operations {
        if indegree[operation.apply_operation_id.as_str()] == 0 {
            ready.insert((
                operation.operation_index,
                operation.apply_operation_id.as_str(),
            ));
        }
    }
    let mut sorted = Vec::new();
    while let Some((index, id)) = ready.iter().next().copied() {
        ready.remove(&(index, id));
        sorted.push(operations[id]);
        for dependent in outgoing.get(id).into_iter().flatten() {
            let value = indegree.get_mut(dependent).expect("dependency checked");
            *value -= 1;
            if *value == 0 {
                let operation = operations[dependent];
                ready.insert((
                    operation.operation_index,
                    operation.apply_operation_id.as_str(),
                ));
            }
        }
    }
    if sorted.len() != plan.operations.len() {
        return Err(invalid("ApplyPlan 依赖存在循环"));
    }
    Ok(sorted)
}

pub fn create_plan(
    connection: &mut Connection,
    input: CreateInitializationApplyPlanInput,
) -> Result<ApplyPlan, AppError> {
    if input.selected_candidates.is_empty() {
        return Err(invalid("至少选择一个已确认初始化候选"));
    }
    let validation = placement_service::validate_proposal(connection, &input.proposal_id)?;
    if validation.stale {
        return Err(AppError::new(
            codes::APPLY_PLAN_STALE,
            validation
                .reason
                .unwrap_or_else(|| "Proposal 已过期".to_string()),
            false,
        ));
    }
    let proposal = placement_service::get_proposal(connection, &input.proposal_id)?;
    let ready = proposal
        .targets
        .iter()
        .filter(|target| target.is_ready)
        .collect::<Vec<_>>();
    if ready.len() != 1 || ready[0].action != "confirm_artifact_review" {
        return Err(AppError::new(
            codes::PLACEMENT_TARGET_UNRESOLVED,
            "初始化 ApplyPlan 必须来自唯一的 Artifact 审查目标",
            false,
        ));
    }
    let artifact = read_artifact(connection, &proposal.artifact_id)?;
    let bundle = parse_bundle(&artifact)?;
    if bundle.content_hash != input.expected_bundle_hash {
        return Err(AppError::new(
            codes::APPLY_PLAN_STALE,
            "候选包已变化，请重新审查",
            false,
        ));
    }
    if ready[0].novel_id != bundle.novel_id {
        return Err(AppError::new(
            codes::TARGET_SCOPE_MISMATCH,
            "审查目标跨作品",
            false,
        ));
    }

    let mut selection_ids = HashSet::new();
    let selections = input
        .selected_candidates
        .iter()
        .map(|selection| {
            if !selection_ids.insert(selection.candidate_id.as_str()) {
                return Err(invalid(format!("候选重复选择: {}", selection.candidate_id)));
            }
            let candidate = bundle
                .items
                .iter()
                .find(|candidate| candidate.candidate_id == selection.candidate_id)
                .ok_or_else(|| invalid(format!("候选不存在: {}", selection.candidate_id)))?;
            if selection.expected_candidate_hash != candidate.candidate_hash {
                return Err(AppError::new(
                    codes::APPLY_PLAN_STALE,
                    format!("候选已变化: {}", candidate.candidate_id),
                    false,
                ));
            }
            if candidate.confirmation.status != "confirmed"
                || candidate.confirmation.confirmed_by.as_deref() != Some("author")
                || candidate.confirmation.confirmed_at.is_none()
            {
                return Err(invalid(format!(
                    "候选未经作者逐项确认: {}",
                    candidate.candidate_id
                )));
            }
            if !candidate.conflicts.is_empty()
                && (!candidate.conflict_acknowledged || !selection.conflict_acknowledged)
            {
                return Err(invalid(format!(
                    "候选冲突尚未确认: {}",
                    candidate.candidate_id
                )));
            }
            Ok(candidate)
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    let mut operation_by_candidate = HashMap::new();
    let mut operations = Vec::new();
    for (index, candidate) in selections.iter().enumerate() {
        let apply_operation_id = uuid::Uuid::new_v4().to_string();
        operation_by_candidate.insert(candidate.candidate_id.as_str(), apply_operation_id.clone());
        let payload = json!({
            "contract": INITIALIZATION_PAYLOAD_CONTRACT,
            "validatorVersion": INITIALIZATION_APPLY_VALIDATOR_VERSION,
            "bundleId": bundle.bundle_id,
            "bundleHash": bundle.content_hash,
            "candidateId": candidate.candidate_id,
            "candidateHash": candidate.candidate_hash,
            "novelId": bundle.novel_id,
            "value": candidate.proposed_value,
        });
        operations.push(ApplyOperation {
            apply_operation_id,
            operation_index: index as i64,
            target_type: candidate.target_type.clone(),
            target_id: uuid::Uuid::new_v4().to_string(),
            action: action_for_target(&candidate.target_type)?.to_string(),
            payload_hash: canonical_hash(&payload),
            payload,
            expected_version: None,
            expected_hash: None,
        });
    }
    let mut dependencies = Vec::new();
    for candidate in &selections {
        for dependency_id in &candidate.depends_on_candidate_ids {
            let depends_on_operation_id = operation_by_candidate
                .get(dependency_id.as_str())
                .ok_or_else(|| {
                    invalid(format!(
                        "候选 {} 依赖的 {} 未包含在本次确认计划中",
                        candidate.candidate_id, dependency_id
                    ))
                })?;
            dependencies.push(ApplyDependency {
                operation_id: operation_by_candidate[candidate.candidate_id.as_str()].clone(),
                depends_on_operation_id: depends_on_operation_id.clone(),
            });
        }
    }
    let operation_id = uuid::Uuid::new_v4().to_string();
    let canonical = json!({
        "artifactId": artifact.artifact_id,
        "proposalId": proposal.proposal_id,
        "bundleId": bundle.bundle_id,
        "bundleHash": bundle.content_hash,
        "novelId": bundle.novel_id,
        "operations": operations.iter().map(|operation| json!({
            "operationId": operation.apply_operation_id,
            "operationIndex": operation.operation_index,
            "targetType": operation.target_type,
            "targetId": operation.target_id,
            "action": operation.action,
            "payloadHash": operation.payload_hash,
        })).collect::<Vec<_>>(),
        "dependencies": dependencies,
        "validatorVersion": INITIALIZATION_APPLY_VALIDATOR_VERSION,
    });
    let plan = ApplyPlan {
        plan_id: uuid::Uuid::new_v4().to_string(),
        proposal_id: proposal.proposal_id,
        artifact_id: artifact.artifact_id,
        parent_plan_id: input.parent_plan_id,
        schema_version: APPLY_PLAN_SCHEMA_VERSION,
        operations,
        dependencies,
        expected_versions: json!({}),
        expected_hashes: json!({}),
        conflicts: Vec::new(),
        operation_id,
        request_hash: canonical_hash(&canonical),
        status: ApplyPlanStatus::Ready,
        result: None,
        created_at: Utc::now().to_rfc3339(),
        completed_at: None,
    };
    topological_operations(&plan)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    apply_plan_repository::insert_plan(&transaction, &plan)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(plan)
}

pub fn is_initialization_plan(plan: &ApplyPlan) -> bool {
    !plan.operations.is_empty()
        && plan.operations.iter().all(|operation| {
            operation.payload.get("contract").and_then(Value::as_str)
                == Some(INITIALIZATION_PAYLOAD_CONTRACT)
        })
}

fn count_named_target(
    transaction: &Transaction<'_>,
    table: &str,
    novel_id: &str,
    column: &str,
    value: &str,
) -> Result<i64, AppError> {
    let sql =
        format!("SELECT COUNT(*) FROM {table} WHERE novel_id=?1 AND {column}=?2 AND is_active=1");
    transaction
        .query_row(&sql, params![novel_id, value], |row| row.get(0))
        .map_err(AppError::database)
}

fn apply_operation(
    transaction: &Transaction<'_>,
    operation: &ApplyOperation,
    novel_id: &str,
) -> Result<(), AppError> {
    let value = operation
        .payload
        .get("value")
        .filter(|value| value.is_object())
        .ok_or_else(|| invalid("初始化 ApplyOperation value 无效"))?;
    let now = Utc::now().to_rfc3339();
    let affected = match operation.action.as_str() {
        "create_world_setting" if operation.target_type == "world_setting" => {
            let title = required_string(value, "title")?;
            if count_named_target(transaction, "world_settings", novel_id, "title", &title)? > 0 {
                return Err(AppError::new(codes::TARGET_VERSION_CONFLICT, "世界设定标题已存在", false));
            }
            transaction.execute(
                "INSERT INTO world_settings
                 (id,novel_id,title,content,structured_json,is_active,created_at,updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
                params![
                    operation.target_id,
                    novel_id,
                    title,
                    optional_string(value, "content").unwrap_or_default(),
                    value.to_string(),
                    value.get("isActive").and_then(Value::as_bool).unwrap_or(true) as i64,
                    now,
                ],
            )
        }
        "create_rule_system" if operation.target_type == "rule_system" => {
            let title = required_string(value, "title")?;
            if count_named_target(transaction, "rule_systems", novel_id, "title", &title)? > 0 {
                return Err(AppError::new(codes::TARGET_VERSION_CONFLICT, "规则系统标题已存在", false));
            }
            transaction.execute(
                "INSERT INTO rule_systems
                 (id,novel_id,title,category,content,forbidden_rules,structured_json,is_active,created_at,updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
                params![
                    operation.target_id,
                    novel_id,
                    title,
                    optional_string(value, "category"),
                    optional_string(value, "content").unwrap_or_default(),
                    optional_string(value, "forbiddenRules"),
                    value.to_string(),
                    value.get("isActive").and_then(Value::as_bool).unwrap_or(true) as i64,
                    now,
                ],
            )
        }
        "create_character" if operation.target_type == "character" => {
            let name = required_string(value, "name")?;
            if count_named_target(transaction, "characters", novel_id, "name", &name)? > 0 {
                return Err(AppError::new(codes::TARGET_VERSION_CONFLICT, "角色名称已存在", false));
            }
            transaction.execute(
                "INSERT INTO characters
                 (id,novel_id,name,role_type,identity,faction,relation_to_protagonist,goal,
                  personality,behavior_limits,forbidden_behaviors,current_state,source,source_type,
                  is_protagonist,is_active,created_at,updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,
                         'ai_initialization','ai_task_artifact',?13,?14,?15,?15)",
                params![
                    operation.target_id,
                    novel_id,
                    name,
                    optional_string(value, "roleType").unwrap_or_else(|| "supporting".to_string()),
                    optional_string(value, "identity"),
                    optional_string(value, "faction"),
                    optional_string(value, "relationToProtagonist"),
                    optional_string(value, "goal"),
                    optional_string(value, "personality"),
                    optional_string(value, "behaviorLimits"),
                    optional_string(value, "forbiddenBehaviors"),
                    optional_string(value, "currentState"),
                    value.get("isProtagonist").and_then(Value::as_bool).unwrap_or(false) as i64,
                    value.get("isActive").and_then(Value::as_bool).unwrap_or(true) as i64,
                    now,
                ],
            )
        }
        _ => return Err(invalid("初始化 ApplyOperation 的 target/action 不受支持")),
    }
    .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::DRAFT_UPDATE_ZERO_ROWS,
            "初始化 Canon 写入未命中唯一目标",
            false,
        ));
    }
    Ok(())
}

pub fn execute_in_transaction(
    transaction: &Transaction<'_>,
    plan: ApplyPlan,
) -> Result<ApplyExecutionResult, AppError> {
    apply_plan_repository::cas_status(transaction, &plan.plan_id, "ready", "applying")?;
    let proposal = placement_service::get_proposal(transaction, &plan.proposal_id)?;
    let artifact = read_artifact(transaction, &plan.artifact_id)?;
    let bundle = parse_bundle(&artifact)?;
    if bundle.novel_id != artifact.source_novel_id
        || proposal
            .targets
            .iter()
            .filter(|target| target.is_ready)
            .count()
            != 1
        || proposal
            .targets
            .iter()
            .find(|target| target.is_ready)
            .map(|target| target.novel_id.as_str())
            != Some(bundle.novel_id.as_str())
    {
        return Err(AppError::new(
            codes::TARGET_SCOPE_MISMATCH,
            "初始化 ApplyPlan 跨作品",
            false,
        ));
    }
    let exists: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM novels WHERE id=?1 AND deleted_at IS NULL",
            params![bundle.novel_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if exists != 1 {
        return Err(AppError::new(
            codes::TARGET_NOVEL_NOT_FOUND,
            "目标作品不存在",
            false,
        ));
    }

    let sorted = topological_operations(&plan)?;
    let mut links = Vec::new();
    let mut applied_candidates = Vec::new();
    for operation in sorted {
        if canonical_hash(&operation.payload) != operation.payload_hash {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "ApplyOperation payloadHash 不一致",
                false,
            ));
        }
        let bundle_hash = operation.payload.get("bundleHash").and_then(Value::as_str);
        let candidate_id = operation
            .payload
            .get("candidateId")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("ApplyOperation 缺少 candidateId"))?;
        let candidate_hash = operation
            .payload
            .get("candidateHash")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("ApplyOperation 缺少 candidateHash"))?;
        if bundle_hash != Some(bundle.content_hash.as_str())
            || operation.payload.get("novelId").and_then(Value::as_str)
                != Some(bundle.novel_id.as_str())
        {
            return Err(AppError::new(
                codes::APPLY_PLAN_STALE,
                "ApplyOperation 候选包身份已失效",
                false,
            ));
        }
        let candidate = bundle
            .items
            .iter()
            .find(|candidate| candidate.candidate_id == candidate_id)
            .ok_or_else(|| invalid("ApplyOperation 引用的候选不存在"))?;
        if candidate.candidate_hash != candidate_hash
            || candidate.target_type != operation.target_type
            || operation.payload.get("value") != Some(&candidate.proposed_value)
            || candidate.confirmation.status != "confirmed"
            || candidate.confirmation.confirmed_by.as_deref() != Some("author")
            || (!candidate.conflicts.is_empty() && !candidate.conflict_acknowledged)
        {
            return Err(AppError::new(
                codes::APPLY_PLAN_STALE,
                "初始化候选确认或内容已失效",
                false,
            ));
        }
        apply_operation(transaction, operation, &bundle.novel_id)?;
        let now = Utc::now().to_rfc3339();
        let link = ArtifactTargetLink {
            link_id: uuid::Uuid::new_v4().to_string(),
            artifact_id: plan.artifact_id.clone(),
            plan_id: plan.plan_id.clone(),
            apply_operation_id: operation.apply_operation_id.clone(),
            target_type: operation.target_type.clone(),
            target_id: operation.target_id.clone(),
            target_version: Some(1),
            target_hash: Some(candidate.candidate_hash.clone()),
            operation_id: plan.operation_id.clone(),
            result_metadata: Some(json!({
                "candidateId": candidate.candidate_id,
                "bundleId": bundle.bundle_id,
                "authorConfirmed": true,
            })),
            created_at: now,
        };
        artifact_target_link_repository::insert_link(transaction, &link)?;
        applied_candidates.push(json!({
            "candidateId": candidate.candidate_id,
            "targetType": operation.target_type,
            "targetId": operation.target_id,
        }));
        links.push(link);
    }
    let now = Utc::now().to_rfc3339();
    let result = json!({
        "contract": INITIALIZATION_PAYLOAD_CONTRACT,
        "bundleId": bundle.bundle_id,
        "bundleHash": bundle.content_hash,
        "canonWritten": true,
        "appliedCandidates": applied_candidates,
    });
    apply_plan_repository::complete(transaction, &plan.plan_id, &result, &now)?;
    Ok(ApplyExecutionResult {
        plan_id: plan.plan_id,
        operation_id: plan.operation_id,
        status: ApplyPlanStatus::Completed,
        target_links: links,
        result,
        idempotent_replay: false,
    })
}
