use crate::domain::placement::{validate_supported_placement, ApplyPlanStatus};
use crate::errors::{codes, AppError};
use crate::repositories::{
    artifact_repository, placement_repository,
    placement_repository::{
        ApplyPlanRecord, ArtifactTargetLinkRecord, NewApplyPlan, NewPlacementProposal,
        PlacementProposalRecord, WorldSettingRecord,
    },
};
use crate::services::{ai_fact_security, artifact_service};
use chrono::Utc;
use rusqlite::{Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const PROPOSAL_TYPE: &str = "create_world_setting";
const TARGET_TYPE: &str = "world_setting";
const MAX_TITLE_CHARS: usize = 200;
const MAX_DESCRIPTION_CHARS: usize = 20_000;
const MAX_OPTIONAL_CHARS: usize = 8_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparePlacementInput {
    pub artifact_id: String,
    pub candidate_index: i64,
    pub expected_artifact_hash: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPlacementInput {
    pub plan_id: String,
    pub operation_id: String,
    pub expected_plan_hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementBundle {
    pub proposal: PlacementProposalRecord,
    pub plan: ApplyPlanRecord,
    pub candidate_json: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPlacementResult {
    pub proposal: PlacementProposalRecord,
    pub plan: ApplyPlanRecord,
    pub link: ArtifactTargetLinkRecord,
    pub world_setting: WorldSettingRecord,
    pub replayed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingCandidate {
    name: String,
    description: String,
    category: Option<String>,
    usage_in_chapter: Option<String>,
    risk: Option<String>,
}

fn commit_transaction(
    transaction: rusqlite::Transaction<'_>,
    operation_id: Option<&str>,
) -> Result<(), AppError> {
    transaction.commit().map_err(|error| {
        AppError::new(
            codes::DATABASE_COMMIT_UNKNOWN,
            "Placement / Apply 提交状态未知，请用相同 operationId 重新读取",
            true,
        )
        .with_context(None, operation_id)
        .with_details(serde_json::json!({ "sqliteError": error.to_string() }))
    })
}

fn bounded_text(value: &str, label: &str, max_chars: usize) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > max_chars {
        return Err(AppError::new(
            codes::PLACEMENT_PROPOSAL_INVALID,
            format!("{label} 为空或超过长度限制"),
            false,
        ));
    }
    ai_fact_security::validate_body(trimmed, label)?;
    Ok(trimmed.to_string())
}

fn optional_bounded_text(
    value: Option<&str>,
    label: &str,
    max_chars: usize,
) -> Result<Option<String>, AppError> {
    value
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| bounded_text(text, label, max_chars))
        .transpose()
}

fn validate_hash(value: &str, label: &str) -> Result<(), AppError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AppError::new(
            codes::PLACEMENT_PROPOSAL_INVALID,
            format!("{label} 无效"),
            false,
        ));
    }
    Ok(())
}

fn parse_candidate(value: &Value) -> Result<(SettingCandidate, Value), AppError> {
    ai_fact_security::validate_metadata(value, "设定候选")?;
    let parsed: SettingCandidate = serde_json::from_value(value.clone())
        .map_err(|_| AppError::new(codes::PLACEMENT_PROPOSAL_INVALID, "设定候选结构无效", false))?;
    let normalized = SettingCandidate {
        name: bounded_text(&parsed.name, "候选名称", MAX_TITLE_CHARS)?,
        description: bounded_text(&parsed.description, "候选描述", MAX_DESCRIPTION_CHARS)?,
        category: optional_bounded_text(parsed.category.as_deref(), "候选分类", MAX_TITLE_CHARS)?,
        usage_in_chapter: optional_bounded_text(
            parsed.usage_in_chapter.as_deref(),
            "本章用途",
            MAX_OPTIONAL_CHARS,
        )?,
        risk: optional_bounded_text(parsed.risk.as_deref(), "风险提示", MAX_OPTIONAL_CHARS)?,
    };
    let canonical_value = serde_json::json!({
        "name": normalized.name,
        "description": normalized.description,
        "category": normalized.category,
        "usageInChapter": normalized.usage_in_chapter,
        "risk": normalized.risk,
    });
    Ok((normalized, canonical_value))
}

fn candidate_from_artifact(
    connection: &Connection,
    artifact_id: &str,
    candidate_index: i64,
) -> Result<
    (
        artifact_repository::ResultArtifactRecord,
        SettingCandidate,
        Value,
    ),
    AppError,
> {
    if candidate_index < 0 {
        return Err(AppError::new(
            codes::PLACEMENT_PROPOSAL_INVALID,
            "候选序号无效",
            false,
        ));
    }
    let bundle = artifact_service::get_artifact_bundle(connection, artifact_id)?;
    if bundle.artifact.artifact_type != "setting_candidates"
        || bundle.artifact.schema_version != 1
        || !matches!(
            bundle.artifact.processing_status.as_str(),
            "valid" | "valid_with_warnings"
        )
        || bundle.artifact.source_novel_id == "system"
    {
        return Err(AppError::new(
            codes::PLACEMENT_NOT_SUPPORTED,
            "Artifact 不是可应用的设定候选",
            false,
        ));
    }
    let structured = bundle.structured_payload_json.ok_or_else(|| {
        AppError::new(
            codes::PLACEMENT_PROPOSAL_INVALID,
            "设定候选 Artifact 缺少结构化结果",
            false,
        )
    })?;
    let candidate = structured
        .get("settings")
        .and_then(Value::as_array)
        .and_then(|items| items.get(candidate_index as usize))
        .ok_or_else(|| {
            AppError::new(
                codes::PLACEMENT_PROPOSAL_INVALID,
                "Artifact 中不存在指定候选",
                false,
            )
        })?;
    let (candidate, canonical_candidate) = parse_candidate(candidate)?;
    Ok((bundle.artifact, candidate, canonical_candidate))
}

fn setting_content(candidate: &SettingCandidate) -> String {
    [
        candidate.description.clone(),
        candidate
            .usage_in_chapter
            .as_ref()
            .map(|value| format!("本章用途：{value}"))
            .unwrap_or_default(),
        candidate
            .risk
            .as_ref()
            .map(|value| format!("风险提示：{value}"))
            .unwrap_or_default(),
    ]
    .into_iter()
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join("\n")
}

fn absent_target_hash(target_id: &str) -> Result<String, AppError> {
    ai_fact_security::canonical_hash(&serde_json::json!({
        "exists": false,
        "targetType": TARGET_TYPE,
        "targetId": target_id,
        "version": 0,
    }))
}

fn target_hash(setting: &WorldSettingRecord) -> Result<String, AppError> {
    ai_fact_security::canonical_hash(&serde_json::json!({
        "id": setting.id,
        "novelId": setting.novel_id,
        "title": setting.title,
        "content": setting.content,
        "structuredJson": setting.structured_json,
        "isActive": setting.is_active,
        "createdAt": setting.created_at,
        "updatedAt": setting.updated_at,
        "version": 1,
    }))
}

fn effect_payload(target_id: &str, novel_id: &str, candidate: &SettingCandidate) -> Value {
    serde_json::json!({
        "effectType": "create",
        "targetType": TARGET_TYPE,
        "targetId": target_id,
        "novelId": novel_id,
        "title": candidate.name,
        "content": setting_content(candidate),
        "isActive": true,
    })
}

fn proposal_hash(
    artifact_id: &str,
    candidate_index: i64,
    candidate_hash: &str,
    target_novel_id: &str,
    target_id: &str,
    expected_target_hash: &str,
    effect: &Value,
) -> Result<String, AppError> {
    ai_fact_security::canonical_hash(&serde_json::json!({
        "artifactId": artifact_id,
        "candidateIndex": candidate_index,
        "candidateHash": candidate_hash,
        "proposalType": PROPOSAL_TYPE,
        "targetType": TARGET_TYPE,
        "targetNovelId": target_novel_id,
        "targetId": target_id,
        "expectedTargetVersion": 0,
        "expectedTargetHash": expected_target_hash,
        "effectPayload": effect,
    }))
}

fn plan_hash(
    proposal_id: &str,
    proposal_hash: &str,
    operation_id: &str,
    target_id: &str,
    expected_target_hash: &str,
    effect: &Value,
) -> Result<String, AppError> {
    ai_fact_security::canonical_hash(&serde_json::json!({
        "proposalId": proposal_id,
        "proposalHash": proposal_hash,
        "operationId": operation_id,
        "targetType": TARGET_TYPE,
        "targetId": target_id,
        "expectedTargetVersion": 0,
        "expectedTargetHash": expected_target_hash,
        "effects": [effect],
    }))
}

fn validate_effect(
    effect: &Value,
    proposal: &PlacementProposalRecord,
) -> Result<(String, String), AppError> {
    ai_fact_security::validate_metadata(effect, "ApplyPlan effect")?;
    let object = effect.as_object().ok_or_else(|| {
        AppError::new(
            codes::PLACEMENT_PLAN_INVALID,
            "ApplyPlan effect 不是对象",
            false,
        )
    })?;
    let text = |key: &str| object.get(key).and_then(Value::as_str);
    if text("effectType") != Some("create")
        || text("targetType") != Some(TARGET_TYPE)
        || text("targetId") != Some(proposal.target_id.as_str())
        || text("novelId") != Some(proposal.target_novel_id.as_str())
        || object.get("isActive").and_then(Value::as_bool) != Some(true)
    {
        return Err(AppError::new(
            codes::PLACEMENT_PLAN_INVALID,
            "ApplyPlan effect 与 PlacementProposal 不一致",
            false,
        ));
    }
    let title = bounded_text(
        text("title").unwrap_or_default(),
        "世界设定标题",
        MAX_TITLE_CHARS,
    )?;
    let content = bounded_text(
        text("content").unwrap_or_default(),
        "世界设定正文",
        MAX_DESCRIPTION_CHARS + MAX_OPTIONAL_CHARS * 2,
    )?;
    Ok((title, content))
}

fn validate_bundle(
    connection: &Connection,
    proposal: &PlacementProposalRecord,
    plan: &ApplyPlanRecord,
) -> Result<Value, AppError> {
    validate_supported_placement(&proposal.proposal_type, &proposal.target_type)?;
    if plan.proposal_id != proposal.proposal_id
        || plan.target_type != proposal.target_type
        || plan.target_id != proposal.target_id
        || plan.expected_target_version != proposal.expected_target_version
        || plan.expected_target_hash != proposal.expected_target_hash
        || plan.effect_payload_json != proposal.effect_payload_json
    {
        return Err(AppError::new(
            codes::PLACEMENT_PLAN_INVALID,
            "ApplyPlan 与 PlacementProposal 不一致",
            false,
        ));
    }
    let (artifact, candidate, candidate_json) =
        candidate_from_artifact(connection, &proposal.artifact_id, proposal.candidate_index)?;
    let candidate_hash = ai_fact_security::canonical_hash(&candidate_json)?;
    let expected_absent_hash = absent_target_hash(&proposal.target_id)?;
    let expected_effect =
        effect_payload(&proposal.target_id, &artifact.source_novel_id, &candidate);
    let expected_proposal_hash = proposal_hash(
        &proposal.artifact_id,
        proposal.candidate_index,
        &candidate_hash,
        &artifact.source_novel_id,
        &proposal.target_id,
        &expected_absent_hash,
        &expected_effect,
    )?;
    let expected_plan_hash = plan_hash(
        &proposal.proposal_id,
        &expected_proposal_hash,
        &plan.operation_id,
        &proposal.target_id,
        &expected_absent_hash,
        &expected_effect,
    )?;
    if artifact.source_novel_id != proposal.target_novel_id
        || candidate_hash != proposal.candidate_hash
        || expected_absent_hash != proposal.expected_target_hash
        || expected_effect != proposal.effect_payload_json
        || expected_proposal_hash != proposal.proposal_hash
        || expected_plan_hash != plan.plan_hash
    {
        return Err(AppError::new(
            codes::PLACEMENT_PROPOSAL_INVALID,
            "Placement / Apply hash 验证失败",
            false,
        ));
    }
    Ok(candidate_json)
}

fn bundle_for_existing(
    connection: &Connection,
    proposal: PlacementProposalRecord,
) -> Result<PlacementBundle, AppError> {
    let plan = placement_repository::find_plan_by_proposal(connection, &proposal.proposal_id)?
        .ok_or_else(|| {
            AppError::new(
                codes::PLACEMENT_PLAN_INVALID,
                "PlacementProposal 缺少 ApplyPlan",
                false,
            )
        })?;
    let candidate_json = validate_bundle(connection, &proposal, &plan)?;
    Ok(PlacementBundle {
        proposal,
        plan,
        candidate_json,
    })
}

pub fn prepare_placement(
    connection: &mut Connection,
    input: PreparePlacementInput,
) -> Result<PlacementBundle, AppError> {
    ai_fact_security::validate_identifier(&input.artifact_id, "artifactId", 160)?;
    validate_hash(&input.expected_artifact_hash, "expectedArtifactHash")?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let (artifact, candidate, candidate_json) =
        candidate_from_artifact(&transaction, &input.artifact_id, input.candidate_index)?;
    if artifact.content_hash != input.expected_artifact_hash {
        return Err(AppError::new(
            codes::PLACEMENT_PROPOSAL_INVALID,
            "Artifact hash 已变化，不能准备陈旧候选",
            false,
        ));
    }
    if let Some(existing) = placement_repository::find_proposal_by_artifact_candidate(
        &transaction,
        &input.artifact_id,
        input.candidate_index,
    )? {
        let output = bundle_for_existing(&transaction, existing)?;
        commit_transaction(transaction, Some(&output.plan.operation_id))?;
        return Ok(output);
    }
    let novel_exists: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM novels WHERE id=?1 AND deleted_at IS NULL",
            [&artifact.source_novel_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if novel_exists != 1 {
        return Err(AppError::new(
            codes::TARGET_NOVEL_NOT_FOUND,
            "Artifact 所属作品不存在",
            false,
        ));
    }
    let proposal_id = uuid::Uuid::new_v4().to_string();
    let plan_id = uuid::Uuid::new_v4().to_string();
    let target_id = uuid::Uuid::new_v4().to_string();
    let operation_id = format!("apply-placement:{plan_id}");
    let expected_target_hash = absent_target_hash(&target_id)?;
    let effect = effect_payload(&target_id, &artifact.source_novel_id, &candidate);
    ai_fact_security::validate_metadata(&effect, "Placement effect")?;
    let effect_json = ai_fact_security::canonical_json(&effect)?;
    let candidate_hash = ai_fact_security::canonical_hash(&candidate_json)?;
    let proposal_hash = proposal_hash(
        &artifact.artifact_id,
        input.candidate_index,
        &candidate_hash,
        &artifact.source_novel_id,
        &target_id,
        &expected_target_hash,
        &effect,
    )?;
    let plan_hash = plan_hash(
        &proposal_id,
        &proposal_hash,
        &operation_id,
        &target_id,
        &expected_target_hash,
        &effect,
    )?;
    let now = Utc::now().to_rfc3339();
    placement_repository::insert_proposal(
        &transaction,
        &NewPlacementProposal {
            proposal_id: &proposal_id,
            artifact_id: &artifact.artifact_id,
            candidate_index: input.candidate_index,
            candidate_hash: &candidate_hash,
            proposal_type: PROPOSAL_TYPE,
            target_type: TARGET_TYPE,
            target_novel_id: &artifact.source_novel_id,
            target_id: &target_id,
            expected_target_version: 0,
            expected_target_hash: &expected_target_hash,
            effect_payload_json: &effect_json,
            proposal_hash: &proposal_hash,
            created_at: &now,
        },
    )?;
    placement_repository::insert_plan(
        &transaction,
        &NewApplyPlan {
            plan_id: &plan_id,
            proposal_id: &proposal_id,
            operation_id: &operation_id,
            plan_hash: &plan_hash,
            target_type: TARGET_TYPE,
            target_id: &target_id,
            expected_target_version: 0,
            expected_target_hash: &expected_target_hash,
            effect_payload_json: &effect_json,
            created_at: &now,
        },
    )?;
    let proposal =
        placement_repository::find_proposal(&transaction, &proposal_id)?.ok_or_else(|| {
            AppError::new(
                codes::PLACEMENT_PROPOSAL_INVALID,
                "新建 PlacementProposal 无法回读",
                false,
            )
        })?;
    let plan = placement_repository::find_plan(&transaction, &plan_id)?.ok_or_else(|| {
        AppError::new(
            codes::PLACEMENT_PLAN_INVALID,
            "新建 ApplyPlan 无法回读",
            false,
        )
    })?;
    let output = PlacementBundle {
        proposal,
        plan,
        candidate_json,
    };
    commit_transaction(transaction, Some(&operation_id))?;
    Ok(output)
}

pub fn get_placement(
    connection: &Connection,
    proposal_id: &str,
) -> Result<PlacementBundle, AppError> {
    ai_fact_security::validate_identifier(proposal_id, "proposalId", 160)?;
    let proposal =
        placement_repository::find_proposal(connection, proposal_id)?.ok_or_else(|| {
            AppError::new(
                codes::PLACEMENT_PROPOSAL_INVALID,
                "PlacementProposal 不存在",
                false,
            )
        })?;
    bundle_for_existing(connection, proposal)
}

fn replay_applied(
    connection: &Connection,
    proposal: PlacementProposalRecord,
    plan: ApplyPlanRecord,
) -> Result<ApplyPlacementResult, AppError> {
    let link =
        placement_repository::find_link_by_plan(connection, &plan.plan_id)?.ok_or_else(|| {
            AppError::new(
                codes::PLACEMENT_TARGET_CHANGED,
                "已应用 ApplyPlan 缺少 ArtifactTargetLink",
                false,
            )
        })?;
    let world_setting = placement_repository::find_world_setting(connection, &plan.target_id)?
        .ok_or_else(|| {
            AppError::new(
                codes::PLACEMENT_TARGET_CHANGED,
                "已应用的世界设定已不存在",
                false,
            )
        })?;
    if link.artifact_id != proposal.artifact_id
        || link.proposal_id != proposal.proposal_id
        || link.target_id != plan.target_id
        || link.target_hash != target_hash(&world_setting)?
    {
        return Err(AppError::new(
            codes::PLACEMENT_TARGET_CHANGED,
            "已应用目标与 ArtifactTargetLink 不一致",
            false,
        ));
    }
    Ok(ApplyPlacementResult {
        proposal,
        plan,
        link,
        world_setting,
        replayed: true,
    })
}

pub fn apply_placement(
    connection: &mut Connection,
    input: ApplyPlacementInput,
) -> Result<ApplyPlacementResult, AppError> {
    ai_fact_security::validate_identifier(&input.plan_id, "planId", 160)?;
    ai_fact_security::validate_identifier(&input.operation_id, "operationId", 160)?;
    validate_hash(&input.expected_plan_hash, "expectedPlanHash")?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let plan = placement_repository::find_plan(&transaction, &input.plan_id)?
        .ok_or_else(|| AppError::new(codes::PLACEMENT_PLAN_INVALID, "ApplyPlan 不存在", false))?;
    let proposal = placement_repository::find_proposal(&transaction, &plan.proposal_id)?
        .ok_or_else(|| {
            AppError::new(
                codes::PLACEMENT_PROPOSAL_INVALID,
                "ApplyPlan 对应的 PlacementProposal 不存在",
                false,
            )
        })?;
    if plan.operation_id != input.operation_id || plan.plan_hash != input.expected_plan_hash {
        return Err(AppError::new(
            codes::PLACEMENT_PLAN_INVALID,
            "ApplyPlan operationId 或 hash 不匹配",
            false,
        ));
    }
    validate_bundle(&transaction, &proposal, &plan)?;
    let status = ApplyPlanStatus::parse(&plan.status)?;
    if status == ApplyPlanStatus::Applied {
        let output = replay_applied(&transaction, proposal, plan)?;
        commit_transaction(transaction, Some(&input.operation_id))?;
        return Ok(output);
    }
    if status == ApplyPlanStatus::Conflict {
        return Err(AppError::new(
            codes::PLACEMENT_TARGET_CONFLICT,
            "ApplyPlan 已因目标冲突终结",
            false,
        )
        .with_context(None, Some(&input.operation_id)));
    }
    if status != ApplyPlanStatus::AwaitingConfirmation {
        return Err(
            AppError::new(codes::OPERATION_IN_PROGRESS, "ApplyPlan 正在应用", true)
                .with_context(None, Some(&input.operation_id)),
        );
    }
    status.validate_transition(ApplyPlanStatus::Applying)?;
    let now = Utc::now().to_rfc3339();
    if !placement_repository::mark_plan_applying(&transaction, &plan, &now)? {
        return Err(AppError::new(
            codes::OPERATION_IN_PROGRESS,
            "ApplyPlan 已被其他执行占用",
            true,
        ));
    }
    let applying_plan =
        placement_repository::find_plan(&transaction, &plan.plan_id)?.ok_or_else(|| {
            AppError::new(
                codes::PLACEMENT_PLAN_INVALID,
                "Applying 状态的 ApplyPlan 无法回读",
                false,
            )
        })?;
    if placement_repository::find_world_setting(&transaction, &proposal.target_id)?.is_some() {
        let conflict = AppError::new(
            codes::PLACEMENT_TARGET_CONFLICT,
            "预分配世界设定目标已存在，已阻止覆盖",
            false,
        )
        .with_context(None, Some(&input.operation_id));
        let error_json =
            ai_fact_security::canonical_json(&ai_fact_security::safe_error_json(&conflict))?;
        if !placement_repository::mark_plan_conflict(
            &transaction,
            &applying_plan,
            &error_json,
            &now,
        )? {
            return Err(AppError::new(
                codes::PLACEMENT_PLAN_INVALID,
                "ApplyPlan 冲突状态提交失败",
                false,
            ));
        }
        commit_transaction(transaction, Some(&input.operation_id))?;
        return Err(conflict);
    }
    let (title, content) = validate_effect(&plan.effect_payload_json, &proposal)?;
    placement_repository::insert_world_setting(
        &transaction,
        &proposal.target_id,
        &proposal.target_novel_id,
        &title,
        &content,
        &now,
    )?;
    let world_setting =
        placement_repository::find_world_setting(&transaction, &proposal.target_id)?.ok_or_else(
            || {
                AppError::new(
                    codes::DATABASE_TRANSACTION_FAILED,
                    "新建世界设定无法回读",
                    false,
                )
            },
        )?;
    let persisted_target_hash = target_hash(&world_setting)?;
    let link_id = uuid::Uuid::new_v4().to_string();
    placement_repository::insert_link(
        &transaction,
        &link_id,
        &proposal.artifact_id,
        &proposal.proposal_id,
        &plan.plan_id,
        TARGET_TYPE,
        &proposal.target_id,
        &persisted_target_hash,
        &now,
    )?;
    let result_json = ai_fact_security::canonical_json(&serde_json::json!({
        "targetType": TARGET_TYPE,
        "targetId": proposal.target_id,
        "targetVersion": 1,
        "targetHash": persisted_target_hash,
    }))?;
    if !placement_repository::mark_plan_applied(&transaction, &applying_plan, &result_json, &now)? {
        return Err(AppError::new(
            codes::PLACEMENT_PLAN_INVALID,
            "ApplyPlan 完成状态提交失败",
            false,
        ));
    }
    let applied_plan =
        placement_repository::find_plan(&transaction, &plan.plan_id)?.ok_or_else(|| {
            AppError::new(
                codes::PLACEMENT_PLAN_INVALID,
                "Applied 状态的 ApplyPlan 无法回读",
                false,
            )
        })?;
    let link =
        placement_repository::find_link_by_plan(&transaction, &plan.plan_id)?.ok_or_else(|| {
            AppError::new(
                codes::PLACEMENT_TARGET_CHANGED,
                "新建 ArtifactTargetLink 无法回读",
                false,
            )
        })?;
    let output = ApplyPlacementResult {
        proposal,
        plan: applied_plan,
        link,
        world_setting,
        replayed: false,
    };
    commit_transaction(transaction, Some(&input.operation_id))?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::large_text_repository;
    use crate::services::ai_task_service::{
        self, tests::connection, tests::system_task_input, ClaimAiTaskAttemptInput,
    };
    use crate::services::artifact_service::CreateResultArtifactInput;
    use rusqlite::params;

    fn insert_novel(connection: &Connection, novel_id: &str) -> rusqlite::Result<()> {
        connection.execute(
            "INSERT INTO novels (id,title,status,created_at,updated_at)
             VALUES (?1,'Safe Apply 测试','draft','2026-07-26T00:00:00Z','2026-07-26T00:00:00Z')",
            params![novel_id],
        )?;
        Ok(())
    }

    fn setting_artifact(
        connection: &mut Connection,
        operation_id: &str,
        novel_id: &str,
    ) -> Result<artifact_service::ResultArtifactBundle, Box<dyn std::error::Error>> {
        insert_novel(connection, novel_id)?;
        let structured = serde_json::json!({
            "settings": [
                {
                    "name": "雾港宵禁",
                    "category": "social",
                    "description": "每晚十点后港区禁止平民通行。",
                    "usageInChapter": "迫使主角绕行旧水道",
                    "risk": "巡逻密度不能前后矛盾"
                },
                {
                    "name": "潮汐钟",
                    "description": "整点鸣响会短暂干扰感知。"
                }
            ]
        });
        let raw = ai_fact_security::canonical_json(&structured)?;
        let mut task_input = system_task_input(operation_id, "setting_candidates");
        task_input.task_type = "setting_expand".to_string();
        task_input.novel_id = novel_id.to_string();
        task_input.scope_type = "novel".to_string();
        task_input.target_hint_json = Some(serde_json::json!({"candidateOnly": true}));
        let task = ai_task_service::create_task(connection, task_input)?;
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
                "responseHash": large_text_repository::sha256(&raw),
                "responseLength": raw.chars().count(),
                "tokenInput": 1,
                "tokenOutput": 1,
                "tokenTotal": 2,
                "finishReason": "stop",
                "durationMs": 1
            }),
        )?;
        Ok(artifact_service::create_artifact(
            connection,
            CreateResultArtifactInput {
                task_id: task.task_id,
                attempt_id: queued.attempt.attempt_id,
                artifact_type: "setting_candidates".to_string(),
                schema_version: 1,
                raw_content: raw,
                display_content: None,
                structured_payload_json: Some(structured),
                parent_artifact_id: None,
                derivation_type: None,
            },
        )?)
    }

    fn prepare(
        connection: &mut Connection,
        artifact: &artifact_service::ResultArtifactBundle,
        candidate_index: i64,
    ) -> Result<PlacementBundle, AppError> {
        prepare_placement(
            connection,
            PreparePlacementInput {
                artifact_id: artifact.artifact.artifact_id.clone(),
                candidate_index,
                expected_artifact_hash: artifact.artifact.content_hash.clone(),
            },
        )
    }

    fn apply_input(plan: &ApplyPlanRecord) -> ApplyPlacementInput {
        ApplyPlacementInput {
            plan_id: plan.plan_id.clone(),
            operation_id: plan.operation_id.clone(),
            expected_plan_hash: plan.plan_hash.clone(),
        }
    }

    fn count(connection: &Connection, table: &str) -> rusqlite::Result<i64> {
        connection.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
    }

    #[test]
    fn placement01_prepare_is_read_only_and_idempotent() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let artifact = setting_artifact(&mut connection, "placement-prepare", "novel-safe-1")?;
        let first = prepare(&mut connection, &artifact, 0)?;
        let replay = prepare(&mut connection, &artifact, 0)?;
        assert_eq!(first.proposal.proposal_id, replay.proposal.proposal_id);
        assert_eq!(first.plan.plan_id, replay.plan.plan_id);
        assert_eq!(first.plan.status, "awaiting_confirmation");
        assert_eq!(first.proposal.expected_target_version, 0);
        assert_eq!(first.proposal.expected_target_hash.len(), 64);
        assert_eq!(first.proposal.proposal_hash.len(), 64);
        assert_eq!(first.plan.plan_hash.len(), 64);
        assert_eq!(count(&connection, "placement_proposals")?, 1);
        assert_eq!(count(&connection, "apply_plans")?, 1);
        assert_eq!(count(&connection, "artifact_target_links")?, 0);
        assert_eq!(count(&connection, "world_settings")?, 0);

        let stale_hash = prepare_placement(
            &mut connection,
            PreparePlacementInput {
                artifact_id: artifact.artifact.artifact_id,
                candidate_index: 1,
                expected_artifact_hash: "0".repeat(64),
            },
        )
        .expect_err("stale artifact hash must fail");
        assert_eq!(stale_hash.code, codes::PLACEMENT_PROPOSAL_INVALID);
        assert_eq!(count(&connection, "placement_proposals")?, 1);
        Ok(())
    }

    #[test]
    fn placement02_apply_and_replay_write_exactly_one_target(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let artifact = setting_artifact(&mut connection, "placement-apply", "novel-safe-2")?;
        let prepared = prepare(&mut connection, &artifact, 0)?;
        let first = apply_placement(&mut connection, apply_input(&prepared.plan))?;
        assert!(!first.replayed);
        assert_eq!(first.plan.status, "applied");
        assert_eq!(first.plan.confirmed_by.as_deref(), Some("user"));
        assert!(first.plan.user_confirmed_at.is_some());
        assert_eq!(first.link.target_version, 1);
        assert_eq!(first.link.target_hash.len(), 64);
        assert_eq!(first.world_setting.title, "雾港宵禁");
        assert_eq!(count(&connection, "world_settings")?, 1);
        assert_eq!(count(&connection, "artifact_target_links")?, 1);

        let replay = apply_placement(&mut connection, apply_input(&prepared.plan))?;
        assert!(replay.replayed);
        assert_eq!(replay.link.link_id, first.link.link_id);
        assert_eq!(replay.world_setting.id, first.world_setting.id);
        assert_eq!(count(&connection, "world_settings")?, 1);
        assert_eq!(count(&connection, "artifact_target_links")?, 1);

        connection.execute(
            "UPDATE world_settings SET content='tampered', updated_at='later' WHERE id=?1",
            params![first.world_setting.id],
        )?;
        let changed = apply_placement(&mut connection, apply_input(&prepared.plan))
            .expect_err("changed applied target must fail replay");
        assert_eq!(changed.code, codes::PLACEMENT_TARGET_CHANGED);
        Ok(())
    }

    #[test]
    fn placement03_target_collision_records_conflict_without_overwrite(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let artifact = setting_artifact(&mut connection, "placement-conflict", "novel-safe-3")?;
        let prepared = prepare(&mut connection, &artifact, 0)?;
        placement_repository::insert_world_setting(
            &connection,
            &prepared.proposal.target_id,
            &prepared.proposal.target_novel_id,
            "existing",
            "do not overwrite",
            "2026-07-26T00:00:00Z",
        )?;
        let conflict = apply_placement(&mut connection, apply_input(&prepared.plan))
            .expect_err("preallocated target collision must fail");
        assert_eq!(conflict.code, codes::PLACEMENT_TARGET_CONFLICT);
        let plan = placement_repository::find_plan(&connection, &prepared.plan.plan_id)?
            .expect("plan retained");
        assert_eq!(plan.status, "conflict");
        assert_eq!(plan.confirmed_by.as_deref(), Some("user"));
        assert_eq!(count(&connection, "artifact_target_links")?, 0);
        let target =
            placement_repository::find_world_setting(&connection, &prepared.proposal.target_id)?
                .expect("existing target retained");
        assert_eq!(target.content, "do not overwrite");
        Ok(())
    }

    #[test]
    fn placement04_apply_side_effects_roll_back_together() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = connection()?;
        let artifact = setting_artifact(&mut connection, "placement-rollback", "novel-safe-4")?;
        let prepared = prepare(&mut connection, &artifact, 0)?;
        connection.execute_batch(
            "CREATE TRIGGER fail_artifact_target_link
             BEFORE INSERT ON artifact_target_links
             BEGIN SELECT RAISE(ABORT, 'injected link failure'); END;",
        )?;
        assert!(apply_placement(&mut connection, apply_input(&prepared.plan)).is_err());
        let plan = placement_repository::find_plan(&connection, &prepared.plan.plan_id)?
            .expect("plan retained");
        assert_eq!(plan.status, "awaiting_confirmation");
        assert_eq!(plan.confirmed_by, None);
        assert_eq!(count(&connection, "world_settings")?, 0);
        assert_eq!(count(&connection, "artifact_target_links")?, 0);
        connection.execute_batch("DROP TRIGGER fail_artifact_target_link;")?;
        let applied = apply_placement(&mut connection, apply_input(&prepared.plan))?;
        assert_eq!(applied.plan.status, "applied");

        assert!(connection
            .execute(
                "UPDATE placement_proposals SET candidate_index=1 WHERE proposal_id=?1",
                params![prepared.proposal.proposal_id],
            )
            .is_err());
        assert!(connection
            .execute(
                "DELETE FROM artifact_target_links WHERE link_id=?1",
                params![applied.link.link_id],
            )
            .is_err());
        Ok(())
    }
}
