use crate::domain::apply_plan::{
    ApplyExecutionResult, ApplyOperation, ApplyPlan, ApplyPlanStatus, ArtifactTargetLink,
    APPLY_PLAN_SCHEMA_VERSION,
};
use crate::domain::co_creation_apply::{
    CoCreationAffectedTargetV1, CoCreationApplyPreparationV1, PrepareCoCreationApplyInput,
    PrepareCoCreationUndoInput, CO_CREATION_APPLY_CONTRACT, CO_CREATION_APPLY_VALIDATOR_VERSION,
    CO_CREATION_UNDO_CONTRACT,
};
use crate::domain::placement::{PlacementProposal, PlacementTarget, PLACEMENT_SCHEMA_VERSION};
use crate::domain::stage3_prerequisite::{
    CreativeIntentConfirmationInputV1, CreativeIntentKind, CreativeIntentStatementInputV1,
    CreativeKnowledgeClass, EvidenceReferenceV1, FreezeCreativeIntentInput,
};
use crate::errors::{codes, AppError};
use crate::repositories::{
    apply_plan_repository, artifact_target_link_repository, co_creation_repository,
    placement_repository,
};
use crate::services::{co_creation_service, creative_intent_service, initialization_apply_service};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Debug, Clone)]
struct DraftSource {
    session_id: String,
    novel_id: String,
    draft_revision_id: String,
    revision_no: i64,
    content_hash: String,
    payload: Value,
}

#[derive(Debug, Clone)]
struct SelectedSuggestion {
    suggestion_id: String,
    object_type: String,
    object_id: Option<String>,
    field_path: String,
    value: Value,
    original_value: Value,
    base_target_version: Option<i64>,
    base_target_hash: Option<String>,
    candidate_hash: String,
    artifact_id: String,
}

#[derive(Debug, Clone)]
struct CanonSnapshot {
    target_type: String,
    target_id: String,
    version: i64,
    content_hash: Option<String>,
    value: Option<Value>,
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::new(codes::ARTIFACT_VALIDATION_FAILED, message, false)
}

fn stale(message: impl Into<String>) -> AppError {
    AppError::new(codes::APPLY_PLAN_STALE, message, false)
}

fn canonical_hash(value: &Value) -> String {
    initialization_apply_service::canonical_hash(value)
}

fn normalized_text(
    value: Option<&Value>,
    label: &str,
    allow_empty: bool,
) -> Result<String, AppError> {
    let text = value
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("共创建议 {label} 必须是字符串")))?
        .trim()
        .to_string();
    if !allow_empty && text.is_empty() {
        return Err(invalid(format!("共创建议 {label} 不能为空")));
    }
    Ok(text)
}

fn normalized_source_references(value: Option<&Value>) -> Result<Value, AppError> {
    let items = match value {
        None => &[][..],
        Some(Value::Array(items)) => items.as_slice(),
        Some(_) => return Err(invalid("共创建议来源必须是数组")),
    };
    items
        .iter()
        .map(|item| {
            let source = item
                .as_object()
                .ok_or_else(|| invalid("共创建议来源必须是对象"))?;
            let mut normalized = Map::new();
            normalized.insert(
                "sourceType".into(),
                Value::String(normalized_text(
                    source.get("sourceType"),
                    "sourceType",
                    false,
                )?),
            );
            normalized.insert(
                "sourceId".into(),
                Value::String(normalized_text(source.get("sourceId"), "sourceId", false)?),
            );
            if source.contains_key("excerpt") {
                normalized.insert(
                    "excerpt".into(),
                    Value::String(normalized_text(source.get("excerpt"), "excerpt", true)?),
                );
            }
            if source.contains_key("contentHash") {
                normalized.insert(
                    "contentHash".into(),
                    Value::String(normalized_text(
                        source.get("contentHash"),
                        "contentHash",
                        false,
                    )?),
                );
            }
            Ok(Value::Object(normalized))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

fn normalized_conflicts(value: Option<&Value>) -> Result<Value, AppError> {
    let items = match value {
        None => &[][..],
        Some(Value::Array(items)) => items.as_slice(),
        Some(_) => return Err(invalid("共创建议冲突必须是数组")),
    };
    items
        .iter()
        .map(|item| {
            let conflict = item
                .as_object()
                .ok_or_else(|| invalid("共创建议冲突必须是对象"))?;
            Ok(json!({
                "code": normalized_text(conflict.get("code"), "conflict.code", false)?,
                "severity": normalized_text(conflict.get("severity"), "conflict.severity", false)?,
                "message": normalized_text(conflict.get("message"), "conflict.message", false)?,
                "sourceReferences": normalized_source_references(conflict.get("sourceReferences"))?,
            }))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

fn turn_candidate_body(value: &Value, data_revision: i64) -> Result<Value, AppError> {
    let source = value
        .as_object()
        .ok_or_else(|| invalid("共创建议来源不是对象"))?;
    let mut body = Map::new();
    let target = source
        .get("target")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("共创建议来源缺少 target"))?;
    let mut normalized_target = Map::new();
    normalized_target.insert(
        "objectType".into(),
        Value::String(normalized_text(
            target.get("objectType"),
            "target.objectType",
            false,
        )?),
    );
    if target.contains_key("objectId") {
        normalized_target.insert(
            "objectId".into(),
            Value::String(normalized_text(
                target.get("objectId"),
                "target.objectId",
                false,
            )?),
        );
    }
    normalized_target.insert(
        "fieldPath".into(),
        Value::String(normalized_text(
            target.get("fieldPath"),
            "target.fieldPath",
            false,
        )?),
    );
    body.insert("target".into(), Value::Object(normalized_target));
    body.insert(
        "originalValue".into(),
        source.get("originalValue").cloned().unwrap_or(Value::Null),
    );
    body.insert(
        "suggestedValue".into(),
        source.get("suggestedValue").cloned().unwrap_or(Value::Null),
    );
    body.insert(
        "fieldState".into(),
        Value::String(normalized_text(
            source.get("fieldState"),
            "fieldState",
            false,
        )?),
    );
    body.insert(
        "sourceType".into(),
        Value::String(normalized_text(
            source.get("sourceType"),
            "sourceType",
            false,
        )?),
    );
    let confidence = source
        .get("confidence")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && (0.0..=1.0).contains(value))
        .ok_or_else(|| invalid("共创建议 confidence 无效"))?;
    body.insert("confidence".into(), json!(confidence));
    body.insert(
        "sourceReferences".into(),
        normalized_source_references(source.get("sourceReferences"))?,
    );
    body.insert(
        "conflicts".into(),
        normalized_conflicts(source.get("conflicts"))?,
    );
    body.insert("baseDataRevision".into(), json!(data_revision));
    if let Some(version) = source.get("baseTargetVersion").and_then(Value::as_i64) {
        if version.unsigned_abs() > 9_007_199_254_740_991_u64 {
            return Err(invalid(
                "共创建议 baseTargetVersion 超出 JavaScript 安全整数范围",
            ));
        }
        body.insert("baseTargetVersion".into(), json!(version));
    }
    if source
        .get("baseTargetHash")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        body.insert(
            "baseTargetHash".into(),
            Value::String(normalized_text(
                source.get("baseTargetHash"),
                "baseTargetHash",
                false,
            )?),
        );
    }
    Ok(Value::Object(body))
}

fn turn_candidate_hash(value: &Value, data_revision: i64) -> Result<String, AppError> {
    Ok(creative_intent_service::canonical_hash(
        &turn_candidate_body(value, data_revision)?,
    ))
}

fn version_token(updated_at: &str) -> i64 {
    let hash = crate::repositories::large_text_repository::sha256(updated_at);
    i64::from_str_radix(&hash[..15], 16).unwrap_or(1)
}

fn value_object(value: Option<Value>) -> Map<String, Value> {
    value
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, AppError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid(format!("正式采用缺少必填字段：{key}")))
}

fn optional_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn load_draft(
    connection: &Connection,
    novel_id: &str,
    session_id: &str,
    draft_revision_id: &str,
    expected_hash: &str,
) -> Result<DraftSource, AppError> {
    let row: Option<(String, String, String, i64, String, String, i64)> = connection
        .query_row(
            "SELECT s.session_id,s.novel_id,d.draft_revision_id,d.revision_no,d.content_hash,
                    d.payload_json,
                    NOT EXISTS (SELECT 1 FROM co_creation_draft_revisions newer
                                WHERE newer.session_id=d.session_id AND newer.rowid>d.rowid)
             FROM co_creation_draft_revisions d
             JOIN co_creation_sessions s ON s.session_id=d.session_id
             WHERE d.draft_revision_id=?1 AND d.session_id=?2 AND s.novel_id=?3",
            params![draft_revision_id, session_id, novel_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?;
    let Some(row) = row else {
        return Err(AppError::new(
            codes::TARGET_SCOPE_MISMATCH,
            "共创草案不存在或不属于当前作品",
            false,
        ));
    };
    if row.4 != expected_hash || row.6 != 1 {
        return Err(stale("共创草案已变化，请重新读取后再正式采用"));
    }
    let payload: Value =
        serde_json::from_str(&row.5).map_err(|_| invalid("共创草案不是有效的结构化 JSON"))?;
    if co_creation_service::canonical_hash(&payload) != row.4
        || co_creation_service::contains_secret(&payload)
    {
        return Err(invalid("共创草案完整性校验失败"));
    }
    Ok(DraftSource {
        session_id: row.0,
        novel_id: row.1,
        draft_revision_id: row.2,
        revision_no: row.3,
        content_hash: row.4,
        payload,
    })
}

fn artifact_output(
    connection: &Connection,
    artifact_id: &str,
    novel_id: &str,
) -> Result<Value, AppError> {
    let row: Option<(String, Option<String>, Option<String>)> = connection
        .query_row(
            "SELECT processing_status,structured_payload_json,
                    (SELECT triggered_at FROM ai_artifact_stale_events stale
                     WHERE stale.artifact_id=result_artifacts.artifact_id
                     ORDER BY triggered_at DESC LIMIT 1)
             FROM result_artifacts WHERE artifact_id=?1 AND source_novel_id=?2
               AND artifact_type='generic_json'",
            params![artifact_id, novel_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(AppError::database)?;
    let Some((status, payload, stale_at)) = row else {
        return Err(invalid("共创建议来源 Artifact 不存在"));
    };
    if stale_at.is_some() || !matches!(status.as_str(), "valid" | "valid_with_warnings") {
        return Err(stale("共创建议来源 Artifact 已过期或失效"));
    }
    serde_json::from_str(
        payload
            .as_deref()
            .ok_or_else(|| invalid("Artifact 缺少结构化结果"))?,
    )
    .map_err(|_| invalid("Artifact 结构化结果无效"))
}

fn selected_suggestions(
    connection: &Connection,
    draft: &DraftSource,
    suggestion_ids: &[String],
) -> Result<Vec<SelectedSuggestion>, AppError> {
    if suggestion_ids.is_empty() {
        return Err(invalid("至少选择一项已经确认的共创建议"));
    }
    let unique = suggestion_ids.iter().collect::<HashSet<_>>();
    if unique.len() != suggestion_ids.len() {
        return Err(invalid("正式采用列表包含重复建议"));
    }
    let suggestions = draft
        .payload
        .get("suggestions")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("共创草案缺少建议列表"))?;
    let fields = draft
        .payload
        .get("fields")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("共创草案缺少字段列表"))?;
    let mut outputs = HashMap::<String, Value>::new();
    let mut selected = Vec::new();
    for id in suggestion_ids {
        let suggestion = suggestions
            .iter()
            .find(|item| item.get("suggestionId").and_then(Value::as_str) == Some(id.as_str()))
            .ok_or_else(|| invalid(format!("共创建议不存在：{id}")))?;
        if suggestion.get("decision").and_then(Value::as_str) != Some("accepted_to_draft") {
            return Err(invalid(format!("共创建议尚未由作者确认：{id}")));
        }
        let target = suggestion
            .get("target")
            .and_then(Value::as_object)
            .ok_or_else(|| invalid("共创建议缺少目标"))?;
        let object_type = target
            .get("objectType")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("共创建议缺少目标类型"))?
            .to_string();
        if !matches!(
            object_type.as_str(),
            "creative_intent" | "world_setting" | "rule_system" | "protagonist"
        ) {
            return Err(invalid(format!("M5 尚不支持正式采用目标：{object_type}")));
        }
        let field_path = target
            .get("fieldPath")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("共创建议缺少字段路径"))?
            .to_string();
        let field = fields
            .get(&field_path)
            .and_then(Value::as_object)
            .ok_or_else(|| invalid(format!("已确认字段不存在：{field_path}")))?;
        if field.get("state").and_then(Value::as_str) != Some("user_confirmed") {
            return Err(invalid(format!("字段尚未由作者确认：{field_path}")));
        }
        let accepted_value = field.get("value").cloned().unwrap_or(Value::Null);
        let original_value = suggestion
            .get("originalValue")
            .cloned()
            .unwrap_or(Value::Null);
        if !original_value.is_null()
            && accepted_value != original_value
            && suggestion
                .get("confirmedReplacement")
                .and_then(Value::as_bool)
                != Some(true)
        {
            return Err(invalid(format!("建议尚未确认覆盖正式字段：{id}")));
        }
        let blocking_conflict = suggestion
            .get("conflicts")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|conflict| conflict.get("severity").and_then(Value::as_str) == Some("blocking"));
        if blocking_conflict
            && suggestion
                .get("conflictsAcknowledged")
                .and_then(Value::as_bool)
                != Some(true)
        {
            return Err(invalid(format!("建议存在尚未确认的阻断影响：{id}")));
        }
        let artifact_id = suggestion
            .get("sourceArtifactId")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("建议缺少 Artifact 来源"))?
            .to_string();
        let candidate_hash = suggestion
            .get("candidateHash")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("建议缺少 candidateHash"))?
            .to_string();
        let output = if let Some(output) = outputs.get(&artifact_id) {
            output.clone()
        } else {
            let output = artifact_output(connection, &artifact_id, &draft.novel_id)?;
            outputs.insert(artifact_id.clone(), output.clone());
            output
        };
        let draft_data_revision = suggestion
            .get("baseDataRevision")
            .and_then(Value::as_i64)
            .ok_or_else(|| invalid("共创建议缺少 baseDataRevision"))?;
        if turn_candidate_hash(suggestion, draft_data_revision)? != candidate_hash {
            return Err(invalid(format!("草案建议 hash 校验失败：{id}")));
        }
        let artifact_data_revision = output
            .get("dataRevision")
            .and_then(Value::as_i64)
            .ok_or_else(|| invalid("Artifact 缺少 dataRevision"))?;
        if artifact_data_revision != draft_data_revision {
            return Err(stale(format!("建议数据 revision 已失效：{id}")));
        }
        let matching = output
            .get("changeSuggestions")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|item| {
                turn_candidate_hash(item, artifact_data_revision)
                    .ok()
                    .filter(|hash| hash == &candidate_hash)
                    .map(|_| item)
            })
            .collect::<Vec<_>>();
        if matching.len() != 1 {
            return Err(invalid(format!("建议来源校验失败：{id}")));
        }
        let source = matching[0];
        selected.push(SelectedSuggestion {
            suggestion_id: id.clone(),
            object_type,
            object_id: target
                .get("objectId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            field_path,
            value: accepted_value,
            original_value: source.get("originalValue").cloned().unwrap_or(Value::Null),
            base_target_version: source.get("baseTargetVersion").and_then(Value::as_i64),
            base_target_hash: source
                .get("baseTargetHash")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            candidate_hash,
            artifact_id,
        });
    }
    if selected
        .iter()
        .map(|item| item.artifact_id.as_str())
        .collect::<HashSet<_>>()
        .len()
        != 1
    {
        return Err(invalid("一次正式采用只能处理同一个 Artifact 的建议"));
    }
    Ok(selected)
}

fn latest_co_creation_target(
    connection: &Connection,
    novel_id: &str,
    target_type: &str,
) -> Result<Option<String>, AppError> {
    connection
        .query_row(
            "SELECT link.target_id
             FROM artifact_target_links link
             JOIN artifact_apply_plans plan ON plan.plan_id=link.plan_id
             JOIN artifact_placement_proposals proposal ON proposal.proposal_id=plan.proposal_id
             JOIN artifact_placement_targets boundary ON boundary.proposal_id=proposal.proposal_id
                AND boundary.is_ready=1
             WHERE boundary.novel_id=?1 AND link.target_type=?2
               AND link.result_metadata_json LIKE '%\"coCreation\":true%'
             ORDER BY link.created_at DESC,link.rowid DESC LIMIT 1",
            params![novel_id, target_type],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)
}

fn world_snapshot(
    connection: &Connection,
    novel_id: &str,
    target_id: &str,
) -> Result<Option<CanonSnapshot>, AppError> {
    let row: Option<(String, String, Option<String>, i64, String)> = connection
        .query_row(
            "SELECT title,content,structured_json,is_active,updated_at FROM world_settings
             WHERE id=?1 AND novel_id=?2",
            params![target_id, novel_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?;
    Ok(row.map(|row| {
        let value = json!({
            "title": row.0,
            "content": row.1,
            "structuredJson": row.2,
            "isActive": row.3 != 0,
        });
        CanonSnapshot {
            target_type: "world_setting".into(),
            target_id: target_id.into(),
            version: version_token(&row.4),
            content_hash: Some(canonical_hash(&value)),
            value: Some(value),
        }
    }))
}

fn rule_snapshot(
    connection: &Connection,
    novel_id: &str,
    target_id: &str,
) -> Result<Option<CanonSnapshot>, AppError> {
    let row: Option<(
        String,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        i64,
        String,
    )> = connection
        .query_row(
            "SELECT title,category,content,forbidden_rules,structured_json,is_active,updated_at
             FROM rule_systems WHERE id=?1 AND novel_id=?2",
            params![target_id, novel_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?;
    Ok(row.map(|row| {
        let value = json!({
            "title": row.0,
            "category": row.1,
            "content": row.2,
            "forbiddenRules": row.3,
            "structuredJson": row.4,
            "isActive": row.5 != 0,
        });
        CanonSnapshot {
            target_type: "rule_system".into(),
            target_id: target_id.into(),
            version: version_token(&row.6),
            content_hash: Some(canonical_hash(&value)),
            value: Some(value),
        }
    }))
}

fn novel_protagonist_projection(
    connection: &Connection,
    novel_id: &str,
) -> Result<Value, AppError> {
    let row: (String, String, String, String) = connection
        .query_row(
            "SELECT protagonist_mode,protagonists_json,main_character,protagonist_ability
             FROM novels WHERE id=?1 AND deleted_at IS NULL",
            params![novel_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(AppError::database)?;
    let protagonists = serde_json::from_str::<Value>(&row.1)
        .map_err(|_| invalid("作品主角正式数据不是有效 JSON"))?;
    if !protagonists.is_array() {
        return Err(invalid("作品主角正式数据必须是数组"));
    }
    Ok(json!({
        "protagonistMode": row.0,
        "protagonists": protagonists,
        "mainCharacter": row.2,
        "protagonistAbility": row.3,
    }))
}

fn character_snapshot(
    connection: &Connection,
    novel_id: &str,
    target_id: &str,
) -> Result<CanonSnapshot, AppError> {
    let row: Option<(
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
        i64,
        String,
    )> = connection
        .query_row(
            "SELECT name,role_type,identity,faction,relation_to_protagonist,goal,personality,
                    ability,constraints,behavior_limits,current_state,source,source_type,
                    is_protagonist,is_active,updated_at
             FROM characters WHERE id=?1 AND novel_id=?2",
            params![target_id, novel_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                    row.get(10)?,
                    row.get(11)?,
                    row.get(12)?,
                    row.get(13)?,
                    row.get(14)?,
                    row.get(15)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?;
    let projection = novel_protagonist_projection(connection, novel_id)?;
    let value = row.map(|row| {
        let value = json!({
            "name": row.0,
            "roleType": row.1,
            "identity": row.2,
            "faction": row.3,
            "relationToProtagonist": row.4,
            "goal": row.5,
            "personality": row.6,
            "ability": row.7,
            "constraints": row.8,
            "behaviorLimits": row.9,
            "currentState": row.10,
            "source": row.11,
            "sourceType": row.12,
            "isProtagonist": row.13 != 0,
            "isActive": row.14 != 0,
        });
        (value, version_token(&row.15))
    });
    Ok(CanonSnapshot {
        target_type: "character".into(),
        target_id: target_id.into(),
        version: value.as_ref().map(|item| item.1).unwrap_or(0),
        content_hash: Some(canonical_hash(&json!({
            "character": value.as_ref().map(|item| &item.0),
            "novelProjection": projection,
        }))),
        value: value.map(|item| item.0),
    })
}

fn creative_intent_snapshot(
    connection: &Connection,
    novel_id: &str,
) -> Result<CanonSnapshot, AppError> {
    let record = creative_intent_service::get_latest(connection, novel_id)?;
    Ok(match record {
        Some(record) => CanonSnapshot {
            target_type: "creative_intent".into(),
            target_id: record.intent.intent_id,
            version: record.intent.revision,
            content_hash: Some(record.intent.content_hash),
            value: Some(json!({ "statements": record.intent.statements })),
        },
        None => CanonSnapshot {
            target_type: "creative_intent".into(),
            target_id: format!("creative-intent:{novel_id}"),
            version: 0,
            content_hash: None,
            value: None,
        },
    })
}

fn canonical_snapshot(
    connection: &Connection,
    novel_id: &str,
    target_type: &str,
    target_id: &str,
) -> Result<CanonSnapshot, AppError> {
    let snapshot = match target_type {
        "creative_intent" => return creative_intent_snapshot(connection, novel_id),
        "world_setting" => world_snapshot(connection, novel_id, target_id)?,
        "rule_system" => rule_snapshot(connection, novel_id, target_id)?,
        "character" => return character_snapshot(connection, novel_id, target_id),
        _ => return Err(invalid(format!("不支持的 Canon 目标：{target_type}"))),
    };
    Ok(snapshot.unwrap_or(CanonSnapshot {
        target_type: target_type.into(),
        target_id: target_id.into(),
        version: 0,
        content_hash: None,
        value: None,
    }))
}

fn protagonist_target(connection: &Connection, novel_id: &str) -> Result<Option<String>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT id FROM characters WHERE novel_id=?1 AND is_active=1
             AND (is_protagonist=1 OR role_type='protagonist') ORDER BY protagonist_order,id",
        )
        .map_err(AppError::database)?;
    let ids = statement
        .query_map(params![novel_id], |row| row.get::<_, String>(0))
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    if ids.len() > 1 {
        return Err(AppError::new(
            codes::PLACEMENT_TARGET_UNRESOLVED,
            "作品存在多个主角，请先在结构化工作台明确目标对象",
            false,
        ));
    }
    Ok(ids.into_iter().next())
}

fn resolve_target(
    connection: &Connection,
    novel_id: &str,
    object_type: &str,
    explicit_id: Option<&str>,
) -> Result<CanonSnapshot, AppError> {
    if object_type == "creative_intent" {
        return creative_intent_snapshot(connection, novel_id);
    }
    let target_type = if object_type == "protagonist" {
        "character"
    } else {
        object_type
    };
    let target_id = if let Some(id) = explicit_id {
        id.to_string()
    } else if let Some(id) = latest_co_creation_target(connection, novel_id, target_type)? {
        id
    } else if object_type == "protagonist" {
        protagonist_target(connection, novel_id)?
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
    } else {
        uuid::Uuid::new_v4().to_string()
    };
    let snapshot = canonical_snapshot(connection, novel_id, target_type, &target_id)?;
    if explicit_id.is_some() && snapshot.value.is_none() {
        return Err(AppError::new(
            codes::TARGET_NOT_FOUND,
            "指定的正式目标不存在",
            false,
        ));
    }
    if object_type == "protagonist"
        && explicit_id.is_some()
        && snapshot
            .value
            .as_ref()
            .and_then(|value| value.get("isProtagonist"))
            .and_then(Value::as_bool)
            != Some(true)
    {
        return Err(AppError::new(
            codes::TARGET_SCOPE_MISMATCH,
            "指定角色不是当前作品的主角",
            false,
        ));
    }
    Ok(snapshot)
}

fn fields_value(items: &[&SelectedSuggestion]) -> Value {
    Value::Object(
        items
            .iter()
            .map(|item| (item.field_path.clone(), item.value.clone()))
            .collect(),
    )
}

fn canonical_field(snapshot: &CanonSnapshot, field_path: &str) -> Value {
    let Some(value) = snapshot.value.as_ref() else {
        return Value::Null;
    };
    match snapshot.target_type.as_str() {
        "creative_intent" => value
            .get("statements")
            .and_then(Value::as_array)
            .and_then(|statements| {
                let expected_id = statement_id(field_path);
                statements.iter().find(|statement| {
                    statement.get("statementId").and_then(Value::as_str)
                        == Some(expected_id.as_str())
                })
            })
            .and_then(|statement| statement.get("value"))
            .cloned()
            .unwrap_or(Value::Null),
        "world_setting" | "rule_system" => value
            .get("structuredJson")
            .and_then(Value::as_str)
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
            .and_then(|structured| structured.get("coCreationFields").cloned())
            .and_then(|fields| fields.get(field_path).cloned())
            .unwrap_or(Value::Null),
        "character" => {
            let key = match field_path {
                "protagonist.name" => "name",
                "protagonist.identity" => "identity",
                "protagonist.currentGoal" => "goal",
                "protagonist.mainStrength" => "ability",
                "protagonist.coreFlaw" => "constraints",
                "protagonist.mainlineRelation" => "relationToProtagonist",
                _ => return Value::Null,
            };
            value.get(key).cloned().unwrap_or(Value::Null)
        }
        _ => Value::Null,
    }
}

fn human_content(fields: &Value) -> String {
    fields
        .as_object()
        .into_iter()
        .flat_map(|fields| fields.iter())
        .map(|(path, value)| {
            let label = path.rsplit('.').next().unwrap_or(path);
            let rendered = value
                .as_str()
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| value.to_string());
            format!("{label}：{rendered}")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_setting_content(base_content: &str, fields: &Value) -> String {
    let supplement = human_content(fields);
    if base_content.trim().is_empty() {
        supplement
    } else if supplement.trim().is_empty() {
        base_content.to_string()
    } else {
        format!(
            "{}\n\nAI 共创补充：\n{}",
            base_content.trim_end(),
            supplement
        )
    }
}

fn merged_setting_value(before: Option<Value>, target_type: &str, fields: &Value) -> Value {
    let mut value = value_object(before);
    let mut structured = value
        .get("structuredJson")
        .and_then(Value::as_str)
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|item| item.as_object().cloned())
        .unwrap_or_default();
    let previous_fields = structured
        .get("coCreationFields")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut merged_fields = previous_fields.clone();
    if let Some(next_fields) = fields.as_object() {
        merged_fields.extend(next_fields.clone());
    }
    let current_content = value
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let stored_base = structured
        .get("coCreationBaseContent")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let previous_render_hash = structured
        .get("coCreationRenderedContentHash")
        .and_then(Value::as_str);
    let previous_render = stored_base
        .as_deref()
        .map(|base| render_setting_content(base, &Value::Object(previous_fields)));
    let content_was_edited_outside_co_creation = stored_base.is_some()
        && previous_render_hash
            .map(|hash| {
                crate::repositories::large_text_repository::sha256(&current_content) != hash
            })
            .or_else(|| {
                previous_render
                    .as_ref()
                    .map(|rendered| rendered != &current_content)
            })
            .unwrap_or(false);
    let base_content = if content_was_edited_outside_co_creation {
        current_content
    } else {
        stored_base.unwrap_or(current_content)
    };
    structured.insert("schemaVersion".into(), json!(1));
    structured.insert(
        "coCreationBaseContent".into(),
        Value::String(base_content.clone()),
    );
    structured.insert(
        "coCreationFields".into(),
        Value::Object(merged_fields.clone()),
    );
    let prefix = if target_type == "world_setting" {
        "世界背景"
    } else {
        "规则体系"
    };
    value
        .entry("title")
        .or_insert_with(|| Value::String(format!("AI 共创{prefix}")));
    let content = render_setting_content(&base_content, &Value::Object(merged_fields));
    structured.insert(
        "coCreationRenderedContentHash".into(),
        Value::String(crate::repositories::large_text_repository::sha256(&content)),
    );
    value.insert("content".into(), Value::String(content));
    value.insert(
        "structuredJson".into(),
        Value::String(Value::Object(structured).to_string()),
    );
    value.entry("isActive").or_insert(Value::Bool(true));
    if target_type == "rule_system" {
        value
            .entry("category")
            .or_insert(Value::String("other".into()));
        if let Some(boundary) = fields.get("ruleSystem.boundary").and_then(Value::as_str) {
            value.insert("forbiddenRules".into(), Value::String(boundary.to_string()));
        }
    }
    Value::Object(value)
}

fn merged_character_value(before: Option<Value>, fields: &Value) -> Value {
    let mut value = value_object(before);
    let field = |path: &str| fields.get(path).cloned();
    if let Some(name) = field("protagonist.name") {
        value.insert("name".into(), name);
    }
    value.entry("name").or_insert(Value::String("主角".into()));
    if let Some(item) = field("protagonist.identity") {
        value.insert("identity".into(), item);
    }
    if let Some(item) = field("protagonist.currentGoal") {
        value.insert("goal".into(), item);
    }
    if let Some(item) = field("protagonist.mainStrength") {
        value.insert("ability".into(), item);
    }
    if let Some(item) = field("protagonist.coreFlaw") {
        value.insert("constraints".into(), item.clone());
        value.insert("behaviorLimits".into(), item);
    }
    if let Some(item) = field("protagonist.mainlineRelation") {
        value.insert("relationToProtagonist".into(), item);
    }
    value.insert("roleType".into(), Value::String("protagonist".into()));
    value.insert("isProtagonist".into(), Value::Bool(true));
    value.entry("isActive").or_insert(Value::Bool(true));
    Value::Object(value)
}

fn merged_novel_protagonists(
    before: Value,
    target_id: &str,
    character: &Value,
    fields: &Value,
    allow_primary_fallback: bool,
) -> Result<Value, AppError> {
    let mut profiles = before.as_array().cloned().unwrap_or_default();
    let exact_index = profiles
        .iter()
        .position(|item| item.get("id").and_then(Value::as_str) == Some(target_id));
    let index = exact_index.or_else(|| {
        (allow_primary_fallback && profiles.len() <= 1 && !profiles.is_empty()).then_some(0)
    });
    if index.is_none() && !profiles.is_empty() {
        return Err(AppError::new(
            codes::PLACEMENT_TARGET_UNRESOLVED,
            "作品主角投影无法精确对应目标角色，请先在结构化工作台修复",
            false,
        ));
    }
    let mut profile = index
        .and_then(|position| profiles.get(position))
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    profile.insert("id".into(), Value::String(target_id.to_string()));
    if exact_index.is_none() {
        profile.insert("label".into(), Value::String("primary".into()));
    }
    for key in [
        "name",
        "gender",
        "identity",
        "personality",
        "goal",
        "motivation",
        "ability",
        "limitation",
        "background",
        "arc",
        "notes",
    ] {
        profile.entry(key).or_insert(Value::String(String::new()));
    }
    let mut assign = |profile_key: &str, path: &str, character_key: &str| {
        if let Some(value) = fields.get(path).or_else(|| character.get(character_key)) {
            profile.insert(profile_key.into(), value.clone());
        }
    };
    assign("name", "protagonist.name", "name");
    assign("identity", "protagonist.identity", "identity");
    assign("goal", "protagonist.currentGoal", "goal");
    assign("ability", "protagonist.mainStrength", "ability");
    assign("limitation", "protagonist.coreFlaw", "constraints");
    assign(
        "arc",
        "protagonist.mainlineRelation",
        "relationToProtagonist",
    );
    let profile = Value::Object(profile);
    if let Some(position) = index {
        profiles[position] = profile;
    } else {
        profiles.insert(0, profile);
    }
    Ok(Value::Array(profiles))
}

fn merged_novel_projection(
    before: Value,
    target_id: &str,
    character: &Value,
    fields: &Value,
    is_new_character: bool,
) -> Result<Value, AppError> {
    let mut projection = before
        .as_object()
        .cloned()
        .ok_or_else(|| invalid("作品主角投影快照无效"))?;
    let profiles = merged_novel_protagonists(
        projection
            .get("protagonists")
            .cloned()
            .unwrap_or_else(|| json!([])),
        target_id,
        character,
        fields,
        is_new_character,
    )?;
    let items = profiles
        .as_array()
        .ok_or_else(|| invalid("作品主角投影必须是数组"))?;
    let primary = items
        .iter()
        .find(|item| item.get("label").and_then(Value::as_str) == Some("primary"))
        .or_else(|| items.first());
    let main_character = primary
        .and_then(|item| item.get("name"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let protagonist_ability = primary
        .and_then(|item| item.get("ability"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let default_mode = if items.len() > 1 { "dual" } else { "single" };
    projection.insert("protagonists".into(), profiles);
    projection
        .entry("protagonistMode")
        .or_insert_with(|| Value::String(default_mode.into()));
    projection.insert("mainCharacter".into(), Value::String(main_character));
    projection.insert(
        "protagonistAbility".into(),
        Value::String(protagonist_ability),
    );
    Ok(Value::Object(projection))
}

fn action_for(snapshot: &CanonSnapshot) -> String {
    match (snapshot.target_type.as_str(), snapshot.value.is_some()) {
        ("creative_intent", _) => "append_creative_intent_revision",
        ("world_setting", false) => "create_world_setting",
        ("world_setting", true) => "update_world_setting",
        ("rule_system", false) => "create_rule_system",
        ("rule_system", true) => "update_rule_system",
        ("character", false) => "create_character",
        ("character", true) => "update_character",
        _ => "unsupported".into(),
    }
    .into()
}

fn preparation_replay(
    transaction: &Transaction<'_>,
    operation_id: &str,
    request_hash: &str,
) -> Result<Option<CoCreationApplyPreparationV1>, AppError> {
    let Some(existing) = co_creation_repository::find_operation(transaction, operation_id)? else {
        return Ok(None);
    };
    if existing.request_hash != request_hash {
        return Err(AppError::new(
            codes::OPERATION_PAYLOAD_CONFLICT,
            "同一共创采用操作对应不同请求",
            false,
        ));
    }
    serde_json::from_str(&existing.result_json)
        .map(Some)
        .map_err(|_| invalid("共创采用幂等结果已损坏"))
}

pub fn prepare_apply(
    connection: &mut Connection,
    input: PrepareCoCreationApplyInput,
) -> Result<CoCreationApplyPreparationV1, AppError> {
    if input.operation_id.trim().is_empty()
        || input.novel_id.trim().is_empty()
        || input.session_id.trim().is_empty()
        || input.draft_revision_id.trim().is_empty()
        || input.expected_draft_content_hash.trim().is_empty()
    {
        return Err(invalid("共创正式采用请求无效"));
    }
    let request_hash = canonical_hash(&json!({
        "contract": CO_CREATION_APPLY_CONTRACT,
        "novelId": input.novel_id,
        "sessionId": input.session_id,
        "draftRevisionId": input.draft_revision_id,
        "expectedDraftContentHash": input.expected_draft_content_hash,
        "suggestionIds": input.suggestion_ids,
        "parentPlanId": input.parent_plan_id,
    }));
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    if let Some(replay) = preparation_replay(&transaction, &input.operation_id, &request_hash)? {
        transaction.commit().map_err(AppError::database)?;
        return Ok(replay);
    }
    let draft = load_draft(
        &transaction,
        &input.novel_id,
        &input.session_id,
        &input.draft_revision_id,
        &input.expected_draft_content_hash,
    )?;
    let suggestions = selected_suggestions(&transaction, &draft, &input.suggestion_ids)?;
    let artifact_id = suggestions[0].artifact_id.clone();
    let mut grouped: BTreeMap<(String, Option<String>), Vec<&SelectedSuggestion>> = BTreeMap::new();
    for suggestion in &suggestions {
        grouped
            .entry((suggestion.object_type.clone(), suggestion.object_id.clone()))
            .or_default()
            .push(suggestion);
    }
    let mut operations = Vec::new();
    let mut affected_targets = Vec::new();
    let mut impact_warnings = Vec::new();
    for ((object_type, explicit_id), items) in grouped {
        let snapshot = resolve_target(
            &transaction,
            &input.novel_id,
            &object_type,
            explicit_id.as_deref(),
        )?;
        for item in &items {
            if item.base_target_version.is_some()
                && item.base_target_version != Some(snapshot.version)
            {
                return Err(stale(format!(
                    "建议 {} 的目标版本已变化，请重新生成或差异合并",
                    item.suggestion_id
                )));
            }
            if item.base_target_hash.is_some() && item.base_target_hash != snapshot.content_hash {
                return Err(stale(format!(
                    "建议 {} 的目标内容哈希已变化，请重新生成或差异合并",
                    item.suggestion_id
                )));
            }
            if canonical_field(&snapshot, &item.field_path) != item.original_value {
                return Err(stale(format!(
                    "建议 {} 的正式字段基线已变化，请重新生成或差异合并",
                    item.suggestion_id
                )));
            }
        }
        let fields = fields_value(&items);
        let after = match snapshot.target_type.as_str() {
            "creative_intent" => fields.clone(),
            "world_setting" | "rule_system" => {
                merged_setting_value(snapshot.value.clone(), &snapshot.target_type, &fields)
            }
            "character" => merged_character_value(snapshot.value.clone(), &fields),
            _ => return Err(invalid("不支持的共创正式采用目标")),
        };
        let action = action_for(&snapshot);
        let protagonist_projection = if snapshot.target_type == "character" {
            let before = novel_protagonist_projection(&transaction, &input.novel_id)?;
            Some((
                before.clone(),
                merged_novel_projection(
                    before,
                    &snapshot.target_id,
                    &after,
                    &fields,
                    snapshot.value.is_none(),
                )?,
            ))
        } else {
            None
        };
        let mut payload = json!({
            "contract": CO_CREATION_APPLY_CONTRACT,
            "validatorVersion": CO_CREATION_APPLY_VALIDATOR_VERSION,
            "novelId": input.novel_id,
            "sessionId": draft.session_id,
            "draftRevisionId": draft.draft_revision_id,
            "draftRevision": draft.revision_no,
            "draftContentHash": draft.content_hash,
            "artifactId": artifact_id,
            "suggestionIds": items.iter().map(|item| item.suggestion_id.clone()).collect::<Vec<_>>(),
            "candidateHashes": items.iter().map(|item| item.candidate_hash.clone()).collect::<Vec<_>>(),
            "fieldPaths": items.iter().map(|item| item.field_path.clone()).collect::<Vec<_>>(),
            "fieldValues": fields,
            "before": snapshot.value,
            "after": after,
        });
        if let Some((before, after)) = protagonist_projection {
            let payload_object = payload
                .as_object_mut()
                .ok_or_else(|| invalid("共创 ApplyOperation payload 无效"))?;
            payload_object.insert("novelProjectionBefore".into(), before);
            payload_object.insert("novelProjectionAfter".into(), after);
        }
        let operation = ApplyOperation {
            apply_operation_id: uuid::Uuid::new_v4().to_string(),
            operation_index: operations.len() as i64,
            target_type: snapshot.target_type.clone(),
            target_id: snapshot.target_id.clone(),
            action: action.clone(),
            payload_hash: canonical_hash(&payload),
            payload,
            expected_version: Some(snapshot.version),
            expected_hash: snapshot.content_hash.clone(),
        };
        affected_targets.push(CoCreationAffectedTargetV1 {
            target_type: snapshot.target_type.clone(),
            target_id: snapshot.target_id.clone(),
            action: action.clone(),
            field_paths: items.iter().map(|item| item.field_path.clone()).collect(),
        });
        if snapshot.value.is_some() {
            impact_warnings.push(format!(
                "将更新正式 {} {}；执行前会再次校验版本和内容哈希",
                snapshot.target_type, snapshot.target_id
            ));
        }
        if snapshot.target_type == "character" || snapshot.target_type == "rule_system" {
            impact_warnings.push("角色身份或世界规则变化可能影响后续大纲与章节生成".into());
        }
        operations.push(operation);
    }
    let project_revision_hash = canonical_hash(&json!({
        "artifactId": artifact_id,
        "draftRevisionId": draft.draft_revision_id,
        "draftContentHash": draft.content_hash,
        "targets": operations.iter().map(|operation| json!({
            "targetType": operation.target_type,
            "targetId": operation.target_id,
            "expectedVersion": operation.expected_version,
            "expectedHash": operation.expected_hash,
            "payloadHash": operation.payload_hash,
        })).collect::<Vec<_>>(),
    }));
    let parent_proposal_id =
        placement_repository::get_latest_proposal_for_artifact(&transaction, &artifact_id)?
            .map(|proposal| proposal.proposal_id);
    let proposal = PlacementProposal {
        proposal_id: uuid::Uuid::new_v4().to_string(),
        artifact_id: artifact_id.clone(),
        parent_proposal_id,
        schema_version: PLACEMENT_SCHEMA_VERSION,
        targets: vec![PlacementTarget {
            target_type: "co_creation_draft".into(),
            target_id: draft.draft_revision_id.clone(),
            novel_id: draft.novel_id.clone(),
            chapter_id: None,
            draft_id: Some(draft.draft_revision_id.clone()),
            action: "apply_co_creation_fields".into(),
            expected_version: Some(draft.revision_no),
            expected_hash: Some(draft.content_hash.clone()),
            source_priority: 1,
            confidence: 1.0,
            reason: "作者已逐项确认共创建议".into(),
            is_ready: true,
        }],
        confidence: 1.0,
        reasons: vec!["共创草案与 Artifact 来源已通过结构化校验".into()],
        warnings: impact_warnings.clone(),
        unresolved_items: Vec::new(),
        project_revision_hash,
        created_at: Utc::now().to_rfc3339(),
    };
    placement_repository::insert_proposal(&transaction, &proposal)?;
    let plan_operation_id = uuid::Uuid::new_v4().to_string();
    let plan_request_hash = canonical_hash(&json!({
        "contract": CO_CREATION_APPLY_CONTRACT,
        "proposalId": proposal.proposal_id,
        "artifactId": artifact_id,
        "operations": operations,
        "validatorVersion": CO_CREATION_APPLY_VALIDATOR_VERSION,
    }));
    let expected_versions = Value::Object(
        operations
            .iter()
            .map(|operation| {
                (
                    format!("{}:{}", operation.target_type, operation.target_id),
                    json!(operation.expected_version),
                )
            })
            .collect(),
    );
    let expected_hashes = Value::Object(
        operations
            .iter()
            .map(|operation| {
                (
                    format!("{}:{}", operation.target_type, operation.target_id),
                    json!(operation.expected_hash),
                )
            })
            .collect(),
    );
    let plan = ApplyPlan {
        plan_id: uuid::Uuid::new_v4().to_string(),
        proposal_id: proposal.proposal_id.clone(),
        artifact_id,
        parent_plan_id: input.parent_plan_id,
        schema_version: APPLY_PLAN_SCHEMA_VERSION,
        operations,
        dependencies: Vec::new(),
        expected_versions,
        expected_hashes,
        conflicts: Vec::new(),
        operation_id: plan_operation_id,
        request_hash: plan_request_hash,
        status: ApplyPlanStatus::Ready,
        result: None,
        created_at: Utc::now().to_rfc3339(),
        completed_at: None,
    };
    apply_plan_repository::insert_plan(&transaction, &plan)?;
    let preparation = CoCreationApplyPreparationV1 {
        proposal,
        plan,
        affected_targets,
        impact_warnings,
    };
    co_creation_repository::insert_operation(
        &transaction,
        &input.operation_id,
        &input.session_id,
        "prepare_formal_apply",
        &request_hash,
        &serde_json::to_string(&preparation).map_err(|_| invalid("采用准备结果序列化失败"))?,
        &Utc::now().to_rfc3339(),
    )?;
    transaction.commit().map_err(AppError::database)?;
    Ok(preparation)
}

pub fn is_co_creation_plan(plan: &ApplyPlan) -> bool {
    !plan.operations.is_empty()
        && plan.operations.iter().all(|operation| {
            matches!(
                operation.payload.get("contract").and_then(Value::as_str),
                Some(CO_CREATION_APPLY_CONTRACT | CO_CREATION_UNDO_CONTRACT)
            )
        })
}

fn validate_artifact(connection: &Connection, plan: &ApplyPlan) -> Result<(), AppError> {
    artifact_output(
        connection,
        &plan.artifact_id,
        plan.operations[0].payload["novelId"].as_str().unwrap_or(""),
    )?;
    Ok(())
}

pub fn validate_plan(connection: &Connection, plan: &ApplyPlan) -> Result<(), AppError> {
    if !is_co_creation_plan(plan) {
        return Err(invalid("ApplyPlan 不是共创正式采用计划"));
    }
    let undo = plan.operations.iter().all(|operation| {
        operation.payload.get("contract").and_then(Value::as_str) == Some(CO_CREATION_UNDO_CONTRACT)
    });
    if !undo {
        validate_artifact(connection, plan)?;
    }
    for operation in &plan.operations {
        if canonical_hash(&operation.payload) != operation.payload_hash {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "共创 ApplyOperation payloadHash 不一致",
                false,
            ));
        }
        let novel_id = operation
            .payload
            .get("novelId")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("共创 ApplyOperation 缺少 novelId"))?;
        let current = canonical_snapshot(
            connection,
            novel_id,
            &operation.target_type,
            &operation.target_id,
        )?;
        if Some(current.version) != operation.expected_version
            || current.content_hash != operation.expected_hash
        {
            return Err(stale(format!(
                "正式目标 {}:{} 已变化，请重新生成或差异合并",
                operation.target_type, operation.target_id
            )));
        }
        if operation.payload.get("contract").and_then(Value::as_str)
            == Some(CO_CREATION_APPLY_CONTRACT)
        {
            let draft_id = operation
                .payload
                .get("draftRevisionId")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("ApplyOperation 缺少草案来源"))?;
            let draft_hash = operation
                .payload
                .get("draftContentHash")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("ApplyOperation 缺少草案哈希"))?;
            let session_id = operation
                .payload
                .get("sessionId")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("ApplyOperation 缺少会话来源"))?;
            load_draft(connection, novel_id, session_id, draft_id, draft_hash)?;
        }
    }
    Ok(())
}

fn creative_kind(path: &str) -> CreativeIntentKind {
    match path {
        "creativeIntent.primaryGoal" => CreativeIntentKind::Goal,
        "creativeIntent.genre" | "creativeIntent.readerExperience" => {
            CreativeIntentKind::Preference
        }
        _ => CreativeIntentKind::Constraint,
    }
}

fn statement_id(path: &str) -> String {
    format!(
        "co-creation-{}",
        &crate::repositories::large_text_repository::sha256(path)[..24]
    )
}

fn creative_inputs_from_before(value: Option<&Value>) -> Vec<CreativeIntentStatementInputV1> {
    value
        .and_then(|value| value.get("statements"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|statement| {
            Some(CreativeIntentStatementInputV1 {
                statement_id: statement.get("statementId")?.as_str()?.to_string(),
                kind: serde_json::from_value(statement.get("kind")?.clone()).ok()?,
                knowledge_class: serde_json::from_value(statement.get("knowledgeClass")?.clone())
                    .ok()?,
                value: statement.get("value").cloned().unwrap_or(Value::Null),
                confidence: statement
                    .get("confidence")
                    .and_then(Value::as_f64)
                    .unwrap_or(1.0),
                evidence: serde_json::from_value(
                    statement
                        .get("evidence")
                        .cloned()
                        .unwrap_or_else(|| json!([])),
                )
                .unwrap_or_default(),
                confirmation: CreativeIntentConfirmationInputV1 {
                    status: statement
                        .get("confirmation")
                        .and_then(|value| value.get("status"))
                        .and_then(Value::as_str)
                        .unwrap_or("confirmed")
                        .to_string(),
                },
            })
        })
        .collect()
}

fn is_co_creation_undo_tombstone(statement: &CreativeIntentStatementInputV1) -> bool {
    statement.statement_id.starts_with("co-creation-undo-")
        && statement.value.get("reverted").and_then(Value::as_bool) == Some(true)
}

fn apply_creative_intent(
    transaction: &Transaction<'_>,
    operation: &ApplyOperation,
    restore: bool,
) -> Result<CanonSnapshot, AppError> {
    let novel_id = required_string(&operation.payload, "novelId")?;
    let current = creative_intent_service::get_latest(transaction, novel_id)?;
    let mut statements = if restore {
        creative_inputs_from_before(operation.payload.get("before"))
    } else {
        current
            .as_ref()
            .map(|record| {
                creative_inputs_from_before(Some(
                    &json!({ "statements": record.intent.statements }),
                ))
            })
            .unwrap_or_default()
    };
    if !restore {
        statements.retain(|statement| !is_co_creation_undo_tombstone(statement));
        let field_values = operation
            .payload
            .get("fieldValues")
            .and_then(Value::as_object)
            .ok_or_else(|| invalid("创作意图操作缺少字段值"))?;
        let replaced = field_values
            .keys()
            .map(|path| statement_id(path))
            .collect::<HashSet<_>>();
        statements.retain(|statement| !replaced.contains(&statement.statement_id));
        let artifact_id = required_string(&operation.payload, "artifactId")?;
        for (path, value) in field_values {
            statements.push(CreativeIntentStatementInputV1 {
                statement_id: statement_id(path),
                kind: creative_kind(path),
                knowledge_class: CreativeKnowledgeClass::AuthorExplicit,
                value: value.clone(),
                confidence: 1.0,
                evidence: vec![EvidenceReferenceV1 {
                    evidence_id: uuid::Uuid::new_v4().to_string(),
                    source_type: "project_document".into(),
                    source_id: Some(artifact_id.into()),
                    excerpt: None,
                    content_hash: Some(operation.payload_hash.clone()),
                }],
                confirmation: CreativeIntentConfirmationInputV1 {
                    status: "confirmed".into(),
                },
            });
        }
    }
    if statements.is_empty() && restore {
        statements.push(CreativeIntentStatementInputV1 {
            statement_id: format!("co-creation-undo-{}", &operation.apply_operation_id[..8]),
            kind: CreativeIntentKind::Constraint,
            knowledge_class: CreativeKnowledgeClass::RequiresConfirmation,
            value: json!({
                "reverted": true,
                "forwardPlanId": operation.payload.get("forwardPlanId"),
                "note": "此前共创意图已由作者撤销，等待重新确认"
            }),
            confidence: 1.0,
            evidence: vec![EvidenceReferenceV1 {
                evidence_id: uuid::Uuid::new_v4().to_string(),
                source_type: "project_document".into(),
                source_id: operation
                    .payload
                    .get("artifactId")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                excerpt: None,
                content_hash: Some(operation.payload_hash.clone()),
            }],
            confirmation: CreativeIntentConfirmationInputV1 {
                status: "rejected".into(),
            },
        });
    }
    if statements.is_empty() {
        return Err(invalid("创作意图正式版本不能为空"));
    }
    let record = creative_intent_service::freeze_in_transaction(
        transaction,
        FreezeCreativeIntentInput {
            novel_id: novel_id.into(),
            expected_revision: current
                .as_ref()
                .map(|record| record.intent.revision)
                .unwrap_or(0),
            expected_content_hash: current
                .as_ref()
                .map(|record| record.intent.content_hash.clone()),
            statements,
        },
    )?;
    Ok(CanonSnapshot {
        target_type: "creative_intent".into(),
        target_id: record.intent.intent_id,
        version: record.intent.revision,
        content_hash: Some(record.intent.content_hash),
        value: Some(json!({ "statements": record.intent.statements })),
    })
}

fn write_setting(
    transaction: &Transaction<'_>,
    operation: &ApplyOperation,
    value: &Value,
) -> Result<(), AppError> {
    let novel_id = required_string(&operation.payload, "novelId")?;
    let now = Utc::now().to_rfc3339();
    let affected = match operation.target_type.as_str() {
        "world_setting" if operation.action == "create_world_setting" => transaction.execute(
            "INSERT INTO world_settings (id,novel_id,title,content,structured_json,is_active,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
            params![operation.target_id,novel_id,required_string(value,"title")?,required_string(value,"content")?,optional_string(value,"structuredJson"),value.get("isActive").and_then(Value::as_bool).unwrap_or(true) as i64,now],
        ),
        "world_setting" => transaction.execute(
            "UPDATE world_settings SET title=?1,content=?2,structured_json=?3,is_active=?4,updated_at=?5
             WHERE id=?6 AND novel_id=?7",
            params![required_string(value,"title")?,required_string(value,"content")?,optional_string(value,"structuredJson"),value.get("isActive").and_then(Value::as_bool).unwrap_or(true) as i64,now,operation.target_id,novel_id],
        ),
        "rule_system" if operation.action == "create_rule_system" => transaction.execute(
            "INSERT INTO rule_systems (id,novel_id,title,category,content,forbidden_rules,structured_json,is_active,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
            params![operation.target_id,novel_id,required_string(value,"title")?,optional_string(value,"category"),required_string(value,"content")?,optional_string(value,"forbiddenRules"),optional_string(value,"structuredJson"),value.get("isActive").and_then(Value::as_bool).unwrap_or(true) as i64,now],
        ),
        "rule_system" => transaction.execute(
            "UPDATE rule_systems SET title=?1,category=?2,content=?3,forbidden_rules=?4,
                    structured_json=?5,is_active=?6,updated_at=?7 WHERE id=?8 AND novel_id=?9",
            params![required_string(value,"title")?,optional_string(value,"category"),required_string(value,"content")?,optional_string(value,"forbiddenRules"),optional_string(value,"structuredJson"),value.get("isActive").and_then(Value::as_bool).unwrap_or(true) as i64,now,operation.target_id,novel_id],
        ),
        _ => return Err(invalid("设置 ApplyOperation target/action 不受支持")),
    }
    .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::TARGET_VERSION_CONFLICT,
            "正式设置目标已变化",
            false,
        ));
    }
    Ok(())
}

fn write_novel_projection(
    transaction: &Transaction<'_>,
    novel_id: &str,
    projection: &Value,
    now: &str,
) -> Result<(), AppError> {
    let projection = projection
        .as_object()
        .ok_or_else(|| invalid("作品主角投影快照无效"))?;
    let profiles = projection
        .get("protagonists")
        .ok_or_else(|| invalid("作品主角投影缺少主角数组"))?;
    profiles
        .as_array()
        .ok_or_else(|| invalid("作品主角正式数据必须是数组"))?;
    let mode = projection
        .get("protagonistMode")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid("作品主角投影缺少 protagonistMode"))?;
    let main_character = projection
        .get("mainCharacter")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let protagonist_ability = projection
        .get("protagonistAbility")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let affected = transaction
        .execute(
            "UPDATE novels SET protagonist_mode=?1,protagonists_json=?2,
                    main_character=?3,protagonist_ability=?4,updated_at=?5
             WHERE id=?6 AND deleted_at IS NULL",
            params![
                mode,
                profiles.to_string(),
                main_character,
                protagonist_ability,
                now,
                novel_id,
            ],
        )
        .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::TARGET_VERSION_CONFLICT,
            "作品主角目标已变化",
            false,
        ));
    }
    Ok(())
}

fn write_character(
    transaction: &Transaction<'_>,
    operation: &ApplyOperation,
    value: &Value,
) -> Result<(), AppError> {
    let novel_id = required_string(&operation.payload, "novelId")?;
    let now = Utc::now().to_rfc3339();
    let affected = if operation.action == "create_character" {
        transaction.execute(
            "INSERT INTO characters
             (id,novel_id,name,role_type,identity,faction,relation_to_protagonist,goal,personality,
              ability,constraints,behavior_limits,current_state,source,source_type,is_protagonist,is_active,
              created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,
                     'ai_generated','ai_task_artifact',?14,?15,?16,?16)",
            params![operation.target_id,novel_id,required_string(value,"name")?,optional_string(value,"roleType").unwrap_or_else(||"protagonist".into()),optional_string(value,"identity"),optional_string(value,"faction"),optional_string(value,"relationToProtagonist"),optional_string(value,"goal"),optional_string(value,"personality"),optional_string(value,"ability"),optional_string(value,"constraints"),optional_string(value,"behaviorLimits"),optional_string(value,"currentState"),value.get("isProtagonist").and_then(Value::as_bool).unwrap_or(true) as i64,value.get("isActive").and_then(Value::as_bool).unwrap_or(true) as i64,now],
        )
    } else {
        transaction.execute(
            "UPDATE characters SET name=?1,role_type=?2,identity=?3,faction=?4,
                    relation_to_protagonist=?5,goal=?6,personality=?7,ability=?8,constraints=?9,
                    behavior_limits=?10,current_state=?11,is_protagonist=?12,is_active=?13,updated_at=?14
             WHERE id=?15 AND novel_id=?16",
            params![required_string(value,"name")?,optional_string(value,"roleType").unwrap_or_else(||"protagonist".into()),optional_string(value,"identity"),optional_string(value,"faction"),optional_string(value,"relationToProtagonist"),optional_string(value,"goal"),optional_string(value,"personality"),optional_string(value,"ability"),optional_string(value,"constraints"),optional_string(value,"behaviorLimits"),optional_string(value,"currentState"),value.get("isProtagonist").and_then(Value::as_bool).unwrap_or(true) as i64,value.get("isActive").and_then(Value::as_bool).unwrap_or(true) as i64,now,operation.target_id,novel_id],
        )
    }
    .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::TARGET_VERSION_CONFLICT,
            "正式角色目标已变化",
            false,
        ));
    }
    let projection = if operation.payload.get("contract").and_then(Value::as_str)
        == Some(CO_CREATION_UNDO_CONTRACT)
    {
        operation.payload.get("novelProjectionBefore")
    } else {
        operation.payload.get("novelProjectionAfter")
    }
    .ok_or_else(|| invalid("主角 ApplyOperation 缺少作品主角投影快照"))?;
    write_novel_projection(transaction, novel_id, projection, &now)?;
    Ok(())
}

fn delete_target(
    transaction: &Transaction<'_>,
    operation: &ApplyOperation,
) -> Result<(), AppError> {
    let novel_id = required_string(&operation.payload, "novelId")?;
    let table = match operation.target_type.as_str() {
        "world_setting" => "world_settings",
        "rule_system" => "rule_systems",
        "character" => "characters",
        _ => return Err(invalid("撤销删除目标类型不受支持")),
    };
    let affected = transaction
        .execute(
            &format!("DELETE FROM {table} WHERE id=?1 AND novel_id=?2"),
            params![operation.target_id, novel_id],
        )
        .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::TARGET_VERSION_CONFLICT,
            "撤销目标已变化",
            false,
        ));
    }
    if operation.target_type == "character" {
        let projection = operation
            .payload
            .get("novelProjectionBefore")
            .ok_or_else(|| invalid("撤销主角操作缺少作品主角投影快照"))?;
        write_novel_projection(transaction, novel_id, projection, &Utc::now().to_rfc3339())?;
    }
    Ok(())
}

fn execute_operation(
    transaction: &Transaction<'_>,
    operation: &ApplyOperation,
) -> Result<CanonSnapshot, AppError> {
    let contract = operation
        .payload
        .get("contract")
        .and_then(Value::as_str)
        .unwrap_or("");
    let restore = contract == CO_CREATION_UNDO_CONTRACT;
    if operation.target_type == "creative_intent" {
        return apply_creative_intent(transaction, operation, restore);
    }
    if restore
        && operation
            .payload
            .get("before")
            .map(Value::is_null)
            .unwrap_or(true)
    {
        delete_target(transaction, operation)?;
        return canonical_snapshot(
            transaction,
            required_string(&operation.payload, "novelId")?,
            &operation.target_type,
            &operation.target_id,
        );
    }
    let value = if restore {
        operation.payload.get("before")
    } else {
        operation.payload.get("after")
    }
    .filter(|value| value.is_object())
    .ok_or_else(|| invalid("ApplyOperation 缺少正式目标值"))?;
    match operation.target_type.as_str() {
        "world_setting" | "rule_system" => write_setting(transaction, operation, value)?,
        "character" => write_character(transaction, operation, value)?,
        _ => return Err(invalid("共创 ApplyOperation 目标不受支持")),
    }
    canonical_snapshot(
        transaction,
        required_string(&operation.payload, "novelId")?,
        &operation.target_type,
        &operation.target_id,
    )
}

pub fn execute_in_transaction(
    transaction: &Transaction<'_>,
    plan: ApplyPlan,
) -> Result<ApplyExecutionResult, AppError> {
    validate_plan(transaction, &plan)?;
    apply_plan_repository::cas_status(transaction, &plan.plan_id, "ready", "applying")?;
    let mut links = Vec::new();
    let mut applied = Vec::new();
    for operation in &plan.operations {
        let snapshot = execute_operation(transaction, operation)?;
        let now = Utc::now().to_rfc3339();
        let link = ArtifactTargetLink {
            link_id: uuid::Uuid::new_v4().to_string(),
            artifact_id: plan.artifact_id.clone(),
            plan_id: plan.plan_id.clone(),
            apply_operation_id: operation.apply_operation_id.clone(),
            target_type: snapshot.target_type.clone(),
            target_id: snapshot.target_id.clone(),
            target_version: Some(snapshot.version),
            target_hash: snapshot.content_hash.clone(),
            operation_id: plan.operation_id.clone(),
            result_metadata: Some(json!({
                "coCreation": true,
                "action": operation.action,
                "canonWritten": true,
                "deleted": snapshot.value.is_none(),
                "authorConfirmed": true,
                "sessionId": operation.payload.get("sessionId"),
                "draftRevisionId": operation.payload.get("draftRevisionId"),
                "suggestionIds": operation.payload.get("suggestionIds"),
                "forwardPlanId": operation.payload.get("forwardPlanId"),
            })),
            created_at: now,
        };
        artifact_target_link_repository::insert_link(transaction, &link)?;
        applied.push(json!({
            "targetType": snapshot.target_type,
            "targetId": snapshot.target_id,
            "targetVersion": snapshot.version,
            "targetHash": snapshot.content_hash,
        }));
        links.push(link);
    }
    let novel_id = required_string(&plan.operations[0].payload, "novelId")?;
    let stale_reason = format!("共创正式数据已由 ApplyPlan {} 更新", plan.plan_id);
    transaction
        .execute(
            "INSERT OR IGNORE INTO ai_artifact_stale_events
                (artifact_id,source_task_id,reason,triggered_at)
             SELECT artifact.artifact_id,artifact.task_id,?1,?2
             FROM result_artifacts artifact
             JOIN ai_tasks task ON task.task_id=artifact.task_id
             WHERE artifact.source_novel_id=?3 AND task.task_type='co_creation_turn'",
            params![stale_reason, Utc::now().to_rfc3339(), novel_id],
        )
        .map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    let result = json!({
        "contract": plan.operations[0].payload.get("contract"),
        "canonWritten": true,
        "appliedTargets": applied,
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

pub fn prepare_undo(
    connection: &mut Connection,
    input: PrepareCoCreationUndoInput,
) -> Result<CoCreationApplyPreparationV1, AppError> {
    if input.operation_id.trim().is_empty() || input.completed_plan_id.trim().is_empty() {
        return Err(invalid("共创撤销请求无效"));
    }
    let request_hash = canonical_hash(&json!({
        "contract": CO_CREATION_UNDO_CONTRACT,
        "novelId": input.novel_id,
        "completedPlanId": input.completed_plan_id,
    }));
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    if let Some(replay) = preparation_replay(&transaction, &input.operation_id, &request_hash)? {
        transaction.commit().map_err(AppError::database)?;
        return Ok(replay);
    }
    let original = apply_plan_repository::get_plan(&transaction, &input.completed_plan_id)?
        .ok_or_else(|| AppError::new(codes::APPLY_PLAN_NOT_FOUND, "原 ApplyPlan 不存在", false))?;
    if original.status != ApplyPlanStatus::Completed || !is_co_creation_plan(&original) {
        return Err(invalid("只能撤销已经完成的共创正式采用计划"));
    }
    if original.operations[0]
        .payload
        .get("contract")
        .and_then(Value::as_str)
        != Some(CO_CREATION_APPLY_CONTRACT)
    {
        return Err(invalid("撤销计划不能再次反向撤销"));
    }
    let session_id = required_string(&original.operations[0].payload, "sessionId")?.to_string();
    let original_links =
        artifact_target_link_repository::list_for_plan(&transaction, &original.plan_id)?;
    if original_links.len() != original.operations.len() {
        return Err(invalid("原 ApplyPlan 的 TargetLink 不完整"));
    }
    let mut operations = Vec::new();
    let mut affected_targets = Vec::new();
    for operation in original.operations.iter().rev() {
        let current = canonical_snapshot(
            &transaction,
            &input.novel_id,
            &operation.target_type,
            &operation.target_id,
        )?;
        let link = original_links
            .iter()
            .find(|link| link.apply_operation_id == operation.apply_operation_id)
            .ok_or_else(|| invalid("原 ApplyOperation 缺少 TargetLink"))?;
        if link.target_version != Some(current.version) || link.target_hash != current.content_hash
        {
            return Err(stale(
                "正式数据在采用后又被修改，不能直接撤销；请先差异合并",
            ));
        }
        let before = operation
            .payload
            .get("before")
            .cloned()
            .unwrap_or(Value::Null);
        let reverse_action = match (operation.target_type.as_str(), before.is_null()) {
            ("creative_intent", _) => "restore_creative_intent_revision",
            ("world_setting", true) => "delete_world_setting",
            ("world_setting", false) => "restore_world_setting",
            ("rule_system", true) => "delete_rule_system",
            ("rule_system", false) => "restore_rule_system",
            ("character", true) => "delete_character",
            ("character", false) => "restore_character",
            _ => return Err(invalid("原 ApplyOperation 无法撤销")),
        };
        let payload = json!({
            "contract": CO_CREATION_UNDO_CONTRACT,
            "validatorVersion": CO_CREATION_APPLY_VALIDATOR_VERSION,
            "novelId": input.novel_id,
            "sessionId": session_id,
            "artifactId": original.artifact_id,
            "forwardPlanId": original.plan_id,
            "before": before,
            "after": operation.payload.get("after"),
            "fieldPaths": operation.payload.get("fieldPaths"),
            "novelProjectionBefore": operation.payload.get("novelProjectionBefore"),
            "novelProjectionAfter": operation.payload.get("novelProjectionAfter"),
        });
        operations.push(ApplyOperation {
            apply_operation_id: uuid::Uuid::new_v4().to_string(),
            operation_index: operations.len() as i64,
            target_type: operation.target_type.clone(),
            target_id: operation.target_id.clone(),
            action: reverse_action.into(),
            payload_hash: canonical_hash(&payload),
            payload,
            expected_version: Some(current.version),
            expected_hash: current.content_hash.clone(),
        });
        affected_targets.push(CoCreationAffectedTargetV1 {
            target_type: operation.target_type.clone(),
            target_id: operation.target_id.clone(),
            action: reverse_action.into(),
            field_paths: operation
                .payload
                .get("fieldPaths")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect(),
        });
    }
    let original_proposal =
        placement_repository::get_proposal(&transaction, &original.proposal_id)?
            .ok_or_else(|| invalid("原 PlacementProposal 不存在"))?;
    let proposal = PlacementProposal {
        proposal_id: uuid::Uuid::new_v4().to_string(),
        artifact_id: original.artifact_id.clone(),
        parent_proposal_id: Some(original_proposal.proposal_id),
        schema_version: PLACEMENT_SCHEMA_VERSION,
        targets: vec![PlacementTarget {
            target_type: "co_creation_undo".into(),
            target_id: original.plan_id.clone(),
            novel_id: input.novel_id.clone(),
            chapter_id: None,
            draft_id: None,
            action: "undo_co_creation_apply".into(),
            expected_version: Some(1),
            expected_hash: Some(original.request_hash.clone()),
            source_priority: 1,
            confidence: 1.0,
            reason: "作者明确请求撤销共创正式写入".into(),
            is_ready: true,
        }],
        confidence: 1.0,
        reasons: vec!["反向 Proposal 保留原计划和目标版本链".into()],
        warnings: vec!["撤销也会创建新的不可变 ApplyPlan，不会删除历史审计记录".into()],
        unresolved_items: Vec::new(),
        project_revision_hash: canonical_hash(
            &json!({ "forwardPlanId": original.plan_id, "operations": operations }),
        ),
        created_at: Utc::now().to_rfc3339(),
    };
    placement_repository::insert_proposal(&transaction, &proposal)?;
    let plan = ApplyPlan {
        plan_id: uuid::Uuid::new_v4().to_string(),
        proposal_id: proposal.proposal_id.clone(),
        artifact_id: original.artifact_id,
        parent_plan_id: Some(original.plan_id),
        schema_version: APPLY_PLAN_SCHEMA_VERSION,
        operations,
        dependencies: Vec::new(),
        expected_versions: json!({}),
        expected_hashes: json!({}),
        conflicts: Vec::new(),
        operation_id: uuid::Uuid::new_v4().to_string(),
        request_hash: canonical_hash(
            &json!({ "contract": CO_CREATION_UNDO_CONTRACT, "proposalId": proposal.proposal_id, "requestHash": request_hash }),
        ),
        status: ApplyPlanStatus::Ready,
        result: None,
        created_at: Utc::now().to_rfc3339(),
        completed_at: None,
    };
    apply_plan_repository::insert_plan(&transaction, &plan)?;
    let preparation = CoCreationApplyPreparationV1 {
        proposal,
        plan,
        affected_targets,
        impact_warnings: vec!["撤销将在同一事务内执行；任一目标冲突都会整体回滚".into()],
    };
    co_creation_repository::insert_operation(
        &transaction,
        &input.operation_id,
        &session_id,
        "prepare_formal_undo",
        &request_hash,
        &serde_json::to_string(&preparation).map_err(|_| invalid("撤销准备结果序列化失败"))?,
        &Utc::now().to_rfc3339(),
    )?;
    transaction.commit().map_err(AppError::database)?;
    Ok(preparation)
}

#[cfg(test)]
mod additional_tests {
    use super::*;
    use crate::domain::apply_plan::ExecuteApplyPlanInput;
    use crate::domain::co_creation::{
        CoCreationSessionV1, CO_CREATION_SCHEMA_VERSION, CO_CREATION_WORKSPACE_TYPE,
    };
    use crate::repositories::{artifact_repository, large_text_repository};
    use crate::services::{ai_task_service, apply_service};

    #[derive(Clone)]
    struct SuggestionSpec {
        id: &'static str,
        object_type: &'static str,
        field_path: &'static str,
        original: Value,
        suggested: Value,
        accepted: Value,
    }

    fn connection() -> Result<Connection, Box<dyn std::error::Error>> {
        let connection = ai_task_service::tests::connection()?;
        connection.execute_batch(
            "CREATE TABLE novels (
                id TEXT PRIMARY KEY,title TEXT NOT NULL,genre TEXT,description TEXT,
                outline TEXT NOT NULL DEFAULT '',protagonist_mode TEXT NOT NULL DEFAULT 'single',
                protagonists_json TEXT NOT NULL DEFAULT '[]',
                dual_protagonist_relation_json TEXT NOT NULL DEFAULT '{}',
                main_character TEXT NOT NULL DEFAULT '',protagonist_ability TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT
             );
             CREATE TABLE world_settings (
                id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',
                structured_json TEXT,is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,updated_at TEXT NOT NULL
             );
             CREATE TABLE rule_systems (
                id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,title TEXT NOT NULL,category TEXT,
                content TEXT NOT NULL DEFAULT '',forbidden_rules TEXT,structured_json TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
             );
             CREATE TABLE characters (
                id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,name TEXT NOT NULL,
                role_type TEXT NOT NULL DEFAULT 'supporting',identity TEXT,faction TEXT,
                relation_to_protagonist TEXT,goal TEXT,personality TEXT,ability TEXT,constraints TEXT,
                behavior_limits TEXT,forbidden_behaviors TEXT,current_state TEXT,
                source TEXT NOT NULL DEFAULT 'manual',source_type TEXT NOT NULL DEFAULT 'manual',
                is_protagonist INTEGER NOT NULL DEFAULT 0,protagonist_order INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
             );
             INSERT INTO novels
                (id,title,genre,description,outline,protagonist_mode,protagonists_json,
                 dual_protagonist_relation_json,main_character,protagonist_ability,created_at,updated_at)
             VALUES ('novel-a','A','','','','single','[]','{}','','','now','now');",
        )?;
        Ok(connection)
    }

    fn raw_suggestion(spec: &SuggestionSpec) -> Value {
        json!({
            "target": { "objectType": spec.object_type, "fieldPath": spec.field_path },
            "originalValue": spec.original,
            "suggestedValue": spec.suggested,
            "fieldState": "ai_suggested",
            "sourceType": "ai_inference",
            "sourceReferences": [],
            "confidence": 0.8,
            "conflicts": [],
        })
    }

    fn setup_workspace(
        connection: &Connection,
        specs: &[SuggestionSpec],
    ) -> Result<(String, String), Box<dyn std::error::Error>> {
        let session = CoCreationSessionV1 {
            session_id: "session-a".into(),
            novel_id: "novel-a".into(),
            workspace_type: CO_CREATION_WORKSPACE_TYPE.into(),
            status: "active".into(),
            revision: 1,
            state_hash: large_text_repository::sha256("session"),
            created_at: "now".into(),
            updated_at: "now".into(),
            archived_at: None,
        };
        co_creation_repository::insert_session(connection, &session)?;
        connection.execute(
            "INSERT INTO ai_tasks
                (task_id,task_type,novel_id,scope_type,status,trace_id,operation_id,
                 request_hash,created_at,completed_at)
             VALUES ('turn-task','co_creation_turn','novel-a','novel','completed','trace',
                     'turn-op',lower(hex(zeroblob(32))),'now','now')",
            [],
        )?;
        connection.execute(
            "INSERT INTO ai_task_attempts
                (attempt_id,task_id,attempt_number,status,started_at,finished_at)
             VALUES ('turn-attempt','turn-task',1,'succeeded','now','now')",
            [],
        )?;
        let raw_items = specs.iter().map(raw_suggestion).collect::<Vec<_>>();
        let artifact_output = json!({
            "schemaVersion": 1,
            "naturalLanguageReply": "建议已生成",
            "intent": "request_ai_completion",
            "currentStage": "world_background",
            "extractedInformation": [],
            "pendingConfirmations": [],
            "quickReplies": [],
            "changeSuggestions": raw_items,
            "stageCompletion": {
                "stage": "world_background", "status": "minimum_complete",
                "completedRequiredFields": [], "missingRequiredFields": [], "percentage": 100
            },
            "dataRevision": 1
        });
        let artifact_raw = artifact_output.to_string();
        let artifact_hash = large_text_repository::sha256(&artifact_raw);
        large_text_repository::insert_document_for_target(
            connection,
            "turn-document",
            "result_artifact",
            "turn-artifact",
            "raw",
            None,
            &artifact_raw,
            &artifact_hash,
            "now",
        )?;
        artifact_repository::insert_artifact(
            connection,
            "turn-artifact",
            "turn-task",
            "turn-attempt",
            "generic_json",
            1,
            "turn-document",
            None,
            Some(&artifact_raw),
            "novel-a",
            None,
            None,
            None,
            None,
            &artifact_hash,
            artifact_raw.chars().count() as i64,
            "valid",
            None,
            None,
            "now",
        )?;
        let mut fields = Map::new();
        let mut suggestions = Vec::new();
        for spec in specs {
            let raw = raw_suggestion(spec);
            let candidate_hash = turn_candidate_hash(&raw, 1)?;
            fields.insert(
                spec.field_path.into(),
                json!({ "value": spec.accepted, "state": "user_confirmed" }),
            );
            let mut accepted = raw.as_object().cloned().expect("suggestion object");
            accepted.insert("suggestionId".into(), json!(spec.id));
            accepted.insert("baseDataRevision".into(), json!(1));
            accepted.insert("decision".into(), json!("accepted_to_draft"));
            accepted.insert("candidateHash".into(), json!(candidate_hash));
            accepted.insert("sourceArtifactId".into(), json!("turn-artifact"));
            suggestions.push(Value::Object(accepted));
        }
        let payload = json!({
            "currentStage": "world_background",
            "fields": fields,
            "suggestions": suggestions,
        });
        let draft_hash = co_creation_service::canonical_hash(&payload);
        co_creation_repository::insert_draft(
            connection,
            "draft-a",
            "session-a",
            "world_background",
            1,
            None,
            CO_CREATION_SCHEMA_VERSION,
            &payload.to_string(),
            &draft_hash,
            "author_edit",
            None,
            None,
            None,
            "draft-op",
            &large_text_repository::sha256("draft-request"),
            "now",
        )?;
        Ok((draft_hash, "turn-artifact".into()))
    }

    fn prepare(
        connection: &mut Connection,
        draft_hash: &str,
        ids: Vec<&str>,
    ) -> Result<CoCreationApplyPreparationV1, AppError> {
        prepare_apply(
            connection,
            PrepareCoCreationApplyInput {
                operation_id: "prepare-op".into(),
                novel_id: "novel-a".into(),
                session_id: "session-a".into(),
                draft_revision_id: "draft-a".into(),
                expected_draft_content_hash: draft_hash.into(),
                suggestion_ids: ids.into_iter().map(ToOwned::to_owned).collect(),
                parent_plan_id: None,
            },
        )
    }

    fn execute(
        connection: &mut Connection,
        plan: &ApplyPlan,
    ) -> Result<ApplyExecutionResult, AppError> {
        apply_service::execute_plan(
            connection,
            ExecuteApplyPlanInput {
                plan_id: plan.plan_id.clone(),
                operation_id: plan.operation_id.clone(),
                request_hash: plan.request_hash.clone(),
            },
        )
    }

    #[test]
    fn co_apply01_edited_world_value_uses_artifact_provenance_and_replays(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let specs = [SuggestionSpec {
            id: "suggestion-world",
            object_type: "world_setting",
            field_path: "worldSetting.era",
            original: Value::Null,
            suggested: json!("蒸汽纪元"),
            accepted: json!("柴油纪元"),
        }];
        let (draft_hash, _) = setup_workspace(&connection, &specs)?;
        let preparation = prepare(&mut connection, &draft_hash, vec!["suggestion-world"])?;
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM world_settings", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        let first = execute(&mut connection, &preparation.plan)?;
        assert_eq!(first.status, ApplyPlanStatus::Completed);
        let content: String =
            connection.query_row("SELECT content FROM world_settings", [], |row| row.get(0))?;
        assert!(content.contains("柴油纪元"));
        assert_eq!(first.target_links.len(), 1);
        let replay = execute(&mut connection, &preparation.plan)?;
        assert!(replay.idempotent_replay);
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM world_settings", [], |row| row
                .get::<_, i64>(0))?,
            1
        );
        Ok(())
    }

    #[test]
    fn co_apply02_late_target_conflict_blocks_without_write(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let specs = [SuggestionSpec {
            id: "suggestion-world",
            object_type: "world_setting",
            field_path: "worldSetting.era",
            original: Value::Null,
            suggested: json!("蒸汽纪元"),
            accepted: json!("蒸汽纪元"),
        }];
        let (draft_hash, _) = setup_workspace(&connection, &specs)?;
        let preparation = prepare(&mut connection, &draft_hash, vec!["suggestion-world"])?;
        let target = &preparation.affected_targets[0].target_id;
        connection.execute(
            "INSERT INTO world_settings (id,novel_id,title,content,is_active,created_at,updated_at)
             VALUES (?1,'novel-a','并发设定','changed',1,'now','later')",
            params![target],
        )?;
        let error = execute(&mut connection, &preparation.plan).expect_err("stale target");
        assert_eq!(error.code, codes::APPLY_PLAN_STALE);
        assert_eq!(
            connection.query_row(
                "SELECT status FROM artifact_apply_plans WHERE plan_id=?1",
                params![preparation.plan.plan_id],
                |row| row.get::<_, String>(0)
            )?,
            "blocked"
        );
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM artifact_target_links", [], |row| row
                .get::<_, i64>(
                0
            ))?,
            0
        );
        Ok(())
    }

    #[test]
    fn co_apply03_multi_target_failure_rolls_back_every_canon_write(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let specs = [
            SuggestionSpec {
                id: "suggestion-world",
                object_type: "world_setting",
                field_path: "worldSetting.era",
                original: Value::Null,
                suggested: json!("蒸汽纪元"),
                accepted: json!("蒸汽纪元"),
            },
            SuggestionSpec {
                id: "suggestion-rule",
                object_type: "rule_system",
                field_path: "ruleSystem.cost",
                original: Value::Null,
                suggested: json!("失去记忆"),
                accepted: json!("失去记忆"),
            },
        ];
        let (draft_hash, _) = setup_workspace(&connection, &specs)?;
        let preparation = prepare(
            &mut connection,
            &draft_hash,
            vec!["suggestion-world", "suggestion-rule"],
        )?;
        connection.execute_batch(
            "CREATE TRIGGER fail_co_creation_rule BEFORE INSERT ON rule_systems
             BEGIN SELECT RAISE(ABORT,'injected failure'); END;",
        )?;
        assert!(execute(&mut connection, &preparation.plan).is_err());
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM world_settings", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM rule_systems", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM artifact_target_links", [], |row| row
                .get::<_, i64>(
                0
            ))?,
            0
        );
        Ok(())
    }

    #[test]
    fn co_apply04_protagonist_updates_character_and_structured_profile_then_undoes(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let specs = [SuggestionSpec {
            id: "suggestion-protagonist",
            object_type: "protagonist",
            field_path: "protagonist.identity",
            original: Value::Null,
            suggested: json!("边城医师"),
            accepted: json!("流亡的边城医师"),
        }];
        let (draft_hash, _) = setup_workspace(&connection, &specs)?;
        let preparation = prepare(&mut connection, &draft_hash, vec!["suggestion-protagonist"])?;
        let applied = execute(&mut connection, &preparation.plan)?;
        let identity: String =
            connection.query_row("SELECT identity FROM characters", [], |row| row.get(0))?;
        assert_eq!(identity, "流亡的边城医师");
        let profiles: String = connection.query_row(
            "SELECT protagonists_json FROM novels WHERE id='novel-a'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(
            serde_json::from_str::<Value>(&profiles)?[0]["identity"],
            json!("流亡的边城医师")
        );
        let undo = prepare_undo(
            &mut connection,
            PrepareCoCreationUndoInput {
                operation_id: "undo-op".into(),
                novel_id: "novel-a".into(),
                completed_plan_id: applied.plan_id,
            },
        )?;
        execute(&mut connection, &undo.plan)?;
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM characters", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        let restored: String = connection.query_row(
            "SELECT protagonists_json FROM novels WHERE id='novel-a'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(serde_json::from_str::<Value>(&restored)?, json!([]));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::apply_plan::ExecuteApplyPlanInput;
    use crate::domain::co_creation::{
        AppendCoCreationUserMessageInput, BindCoCreationTurnTaskInput, CompleteCoCreationTurnInput,
        OpenCoCreationWorkspaceInput, ReadCoCreationWorkspaceInput,
        SaveCoCreationDraftRevisionInput,
    };
    use crate::repositories::{artifact_repository, large_text_repository};
    use crate::services::{apply_service, co_creation_service};

    fn connection() -> Result<Connection, Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE novels (
                id TEXT PRIMARY KEY,title TEXT NOT NULL DEFAULT '',genre TEXT,description TEXT,
                outline TEXT,protagonist_mode TEXT NOT NULL DEFAULT 'single',
                protagonists_json TEXT NOT NULL DEFAULT '[]',
                dual_protagonist_relation_json TEXT NOT NULL DEFAULT '{}',
                main_character TEXT NOT NULL DEFAULT '',protagonist_ability TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',deleted_at TEXT
             );
             CREATE TABLE chapter_drafts (
                id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,chapter_id TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',version_no INTEGER NOT NULL DEFAULT 1,
                ai_task_id TEXT,note TEXT,large_text_ref_id TEXT
             );
             CREATE TABLE quality_check_reports (
                id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,chapter_id TEXT NOT NULL,
                draft_id TEXT NOT NULL,ai_task_id TEXT
             );
             CREATE TABLE world_settings (
                id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',
                structured_json TEXT,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
             );
             CREATE TABLE rule_systems (
                id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,title TEXT NOT NULL,category TEXT,content TEXT NOT NULL DEFAULT '',
                forbidden_rules TEXT,structured_json TEXT,is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,updated_at TEXT NOT NULL
             );
             CREATE TABLE characters (
                id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,name TEXT NOT NULL,role_type TEXT NOT NULL DEFAULT 'supporting',
                identity TEXT,faction TEXT,relation_to_protagonist TEXT,goal TEXT,personality TEXT,
                ability TEXT,constraints TEXT,behavior_limits TEXT,current_state TEXT,
                source TEXT NOT NULL DEFAULT 'manual',source_type TEXT NOT NULL DEFAULT 'manual',
                is_protagonist INTEGER NOT NULL DEFAULT 0,protagonist_order INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
             );",
        )?;
        crate::migrations::run_migrations(&mut connection)?;
        connection.execute(
            "INSERT INTO novels (id,title,protagonists_json,updated_at)
             VALUES ('novel-a','Novel A','[]','2026-01-01T00:00:00Z')",
            [],
        )?;
        Ok(connection)
    }

    fn insert_task(
        connection: &Connection,
        task_id: &str,
        session_id: &str,
        message_id: &str,
        stage: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let target_hint = json!({
            "contract": "co_creation_turn_v1",
            "sessionId": session_id,
            "userMessageId": message_id,
            "currentStage": stage,
            "canonicalDataHash": large_text_repository::sha256("canonical"),
            "dataRevision": 1,
        });
        connection.execute(
            "INSERT INTO ai_tasks
                (task_id,task_type,novel_id,scope_type,status,trace_id,operation_id,
                 request_hash,created_at,worker_kind,target_hint_json)
             VALUES (?1,'co_creation_turn','novel-a','novel','queued',?2,?3,?4,?5,'provider',?6)",
            params![
                task_id,
                format!("trace-{task_id}"),
                format!("operation-{task_id}"),
                large_text_repository::sha256(task_id),
                "2026-07-13T00:00:00Z",
                target_hint.to_string(),
            ],
        )?;
        let payload = json!({
            "contract": "co_creation_turn_v1",
            "sessionId": session_id,
            "userMessageId": message_id,
            "currentStage": stage,
            "canonicalDataHash": large_text_repository::sha256("canonical"),
            "dataRevision": 1,
        });
        connection.execute(
            "INSERT INTO ai_input_snapshots
                (snapshot_id,task_id,schema_version,input_type,payload_json,content_hash,created_at)
             VALUES (?1,?2,1,'co_creation_turn_input',?3,?4,?5)",
            params![
                format!("input-{task_id}"),
                task_id,
                payload.to_string(),
                canonical_hash(&payload),
                "2026-07-13T00:00:00Z",
            ],
        )?;
        connection.execute(
            "UPDATE ai_tasks SET input_snapshot_id=?1 WHERE task_id=?2",
            params![format!("input-{task_id}"), task_id],
        )?;
        Ok(())
    }

    fn insert_artifact(
        connection: &Connection,
        task_id: &str,
        artifact_id: &str,
        output: &Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let content = output.to_string();
        let attempt_id = format!("attempt-{task_id}");
        let document_id = format!("document-{artifact_id}");
        let hash = large_text_repository::sha256(&content);
        connection.execute(
            "INSERT INTO ai_task_attempts
                (attempt_id,task_id,attempt_number,provider_id,status,started_at,finished_at)
             VALUES (?1,?2,1,'mock','succeeded',?3,?3)",
            params![attempt_id, task_id, "2026-07-13T00:01:00Z"],
        )?;
        large_text_repository::insert_document_for_target(
            connection,
            &document_id,
            "result_artifact",
            artifact_id,
            "raw",
            None,
            &content,
            &hash,
            "2026-07-13T00:01:00Z",
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
            Some(&content),
            "novel-a",
            None,
            None,
            None,
            None,
            &hash,
            content.chars().count() as i64,
            "valid",
            None,
            None,
            "2026-07-13T00:01:00Z",
        )?;
        connection.execute(
            "UPDATE ai_tasks SET status='completed',current_attempt_id=?1,
                result_artifact_id=?2,completed_at=?3 WHERE task_id=?4",
            params![attempt_id, artifact_id, "2026-07-13T00:01:00Z", task_id],
        )?;
        Ok(())
    }

    fn suggestion(
        id: &str,
        object_type: &str,
        field_path: &str,
        original: Value,
        suggested: Value,
        artifact_id: Option<&str>,
    ) -> Value {
        let mut value = json!({
            "suggestionId": id,
            "target": { "objectType": object_type, "fieldPath": field_path },
            "originalValue": original,
            "suggestedValue": suggested,
            "fieldState": "ai_suggested",
            "sourceType": "ai_inference",
            "sourceReferences": [{ "sourceType": "ai_inference", "sourceId": format!("inference-{id}") }],
            "confidence": 0.9,
            "conflicts": [],
            "baseDataRevision": 1,
            "decision": "pending"
        });
        value["candidateHash"] = json!(turn_candidate_hash(&value, 1).expect("candidate hash"));
        if let Some(artifact_id) = artifact_id {
            value["sourceMessageId"] = json!("assistant-a");
            value["sourceTaskId"] = json!("task-a");
            value["sourceArtifactId"] = json!(artifact_id);
            value["decision"] = json!("accepted_to_draft");
            value["conflictsAcknowledged"] = json!(false);
            value["confirmedReplacement"] = json!(false);
        }
        value
    }

    fn output(stage: &str, suggestions: Vec<Value>) -> Value {
        let missing = match stage {
            "creative_intent" => "creativeIntent.primaryGoal",
            "protagonist" => "protagonist.identity",
            "rule_system" => "ruleSystem.coreMechanism",
            _ => "worldSetting.era",
        };
        json!({
            "schemaVersion": 1,
            "naturalLanguageReply": "已生成可审查建议",
            "intent": "request_ai_completion",
            "currentStage": stage,
            "extractedInformation": [],
            "pendingConfirmations": [],
            "quickReplies": [],
            "changeSuggestions": suggestions,
            "stageCompletion": {
                "stage": stage,
                "status": "in_progress",
                "completedRequiredFields": [],
                "missingRequiredFields": [missing],
                "percentage": 0
            },
            "dataRevision": 1
        })
    }

    fn accepted_fixture(
        connection: &mut Connection,
        source_suggestions: Vec<Value>,
        accepted_fields: Vec<(&str, Value)>,
    ) -> Result<(String, String, String), Box<dyn std::error::Error>> {
        let stage = source_suggestions
            .first()
            .and_then(|item| item.get("target"))
            .and_then(|target| target.get("objectType"))
            .and_then(Value::as_str)
            .map(|object_type| match object_type {
                "creative_intent" => "creative_intent",
                "protagonist" => "protagonist",
                "rule_system" => "rule_system",
                _ => "world_background",
            })
            .unwrap_or("world_background");
        let opened = co_creation_service::open_workspace(
            connection,
            OpenCoCreationWorkspaceInput {
                novel_id: "novel-a".into(),
            },
        )?;
        let appended = co_creation_service::append_user_message(
            connection,
            AppendCoCreationUserMessageInput {
                novel_id: "novel-a".into(),
                session_id: opened.workspace.session.session_id.clone(),
                content: "请补全世界设定".into(),
                expected_revision: opened.workspace.session.revision,
                expected_state_hash: opened.workspace.session.state_hash.clone(),
                operation_id: "append-a".into(),
                request_hash: None,
            },
        )?;
        let user_message_id = appended.message_id.expect("user message");
        insert_task(
            connection,
            "task-a",
            &opened.workspace.session.session_id,
            &user_message_id,
            stage,
        )?;
        let workspace = co_creation_service::read_workspace(
            connection,
            ReadCoCreationWorkspaceInput {
                novel_id: "novel-a".into(),
                session_id: opened.workspace.session.session_id.clone(),
            },
        )?;
        co_creation_service::bind_turn_task(
            connection,
            BindCoCreationTurnTaskInput {
                novel_id: "novel-a".into(),
                session_id: workspace.session.session_id.clone(),
                user_message_id: user_message_id.clone(),
                task_id: "task-a".into(),
                expected_revision: workspace.session.revision,
                expected_state_hash: workspace.session.state_hash.clone(),
                operation_id: "bind-a".into(),
                request_hash: None,
            },
        )?;
        let artifact_suggestions = source_suggestions
            .iter()
            .cloned()
            .map(|mut item| {
                if let Some(object) = item.as_object_mut() {
                    for key in [
                        "suggestionId",
                        "candidateHash",
                        "baseDataRevision",
                        "decision",
                        "sourceMessageId",
                        "sourceTaskId",
                        "sourceArtifactId",
                        "conflictsAcknowledged",
                        "confirmedReplacement",
                    ] {
                        object.remove(key);
                    }
                }
                item
            })
            .collect();
        let artifact_output = output(stage, artifact_suggestions);
        insert_artifact(connection, "task-a", "artifact-a", &artifact_output)?;
        let workspace = co_creation_service::read_workspace(
            connection,
            ReadCoCreationWorkspaceInput {
                novel_id: "novel-a".into(),
                session_id: opened.workspace.session.session_id.clone(),
            },
        )?;
        co_creation_service::complete_turn(
            connection,
            CompleteCoCreationTurnInput {
                novel_id: "novel-a".into(),
                session_id: workspace.session.session_id.clone(),
                user_message_id: user_message_id.clone(),
                task_id: "task-a".into(),
                artifact_id: "artifact-a".into(),
                expected_revision: workspace.session.revision,
                expected_state_hash: workspace.session.state_hash.clone(),
                operation_id: "complete-a".into(),
                request_hash: None,
            },
        )?;
        let workspace = co_creation_service::read_workspace(
            connection,
            ReadCoCreationWorkspaceInput {
                novel_id: "novel-a".into(),
                session_id: opened.workspace.session.session_id.clone(),
            },
        )?;
        let assistant = workspace
            .messages
            .iter()
            .find(|message| message.role == "assistant")
            .expect("assistant");
        let accepted_suggestions = source_suggestions
            .into_iter()
            .map(|mut item| {
                item["sourceMessageId"] = json!(assistant.message_id);
                item["sourceTaskId"] = json!("task-a");
                item["sourceArtifactId"] = json!("artifact-a");
                item["decision"] = json!("accepted_to_draft");
                if item.get("conflictsAcknowledged").is_none() {
                    item["conflictsAcknowledged"] = json!(false);
                }
                if item.get("confirmedReplacement").is_none() {
                    item["confirmedReplacement"] = json!(false);
                }
                item
            })
            .collect::<Vec<_>>();
        let fields = Value::Object(
            accepted_fields
                .into_iter()
                .map(|(path, value)| {
                    (
                        path.into(),
                        json!({ "value": value, "state": "user_confirmed" }),
                    )
                })
                .collect(),
        );
        let receipt = co_creation_service::save_draft_revision(
            connection,
            SaveCoCreationDraftRevisionInput {
                novel_id: "novel-a".into(),
                session_id: workspace.session.session_id.clone(),
                stage_key: stage.into(),
                schema_version: 1,
                payload: json!({
                    "currentStage": stage,
                    "fields": fields,
                    "suggestions": accepted_suggestions,
                }),
                origin: "assistant_proposal_accepted".into(),
                source_message_id: Some(assistant.message_id.clone()),
                source_task_id: Some("task-a".into()),
                source_artifact_id: Some("artifact-a".into()),
                expected_revision: workspace.session.revision,
                expected_state_hash: workspace.session.state_hash.clone(),
                expected_draft_revision: 0,
                expected_draft_content_hash: None,
                operation_id: "draft-a".into(),
                request_hash: None,
            },
        )?;
        let workspace = co_creation_service::read_workspace(
            connection,
            ReadCoCreationWorkspaceInput {
                novel_id: "novel-a".into(),
                session_id: workspace.session.session_id,
            },
        )?;
        Ok((
            workspace.session.session_id,
            receipt.draft_revision_id.expect("draft"),
            workspace
                .draft_revisions
                .last()
                .expect("draft row")
                .content_hash
                .clone(),
        ))
    }

    fn prepare_input(
        session_id: &str,
        draft_id: &str,
        draft_hash: &str,
        suggestion_ids: Vec<&str>,
        operation_id: &str,
    ) -> PrepareCoCreationApplyInput {
        PrepareCoCreationApplyInput {
            operation_id: operation_id.into(),
            novel_id: "novel-a".into(),
            session_id: session_id.into(),
            draft_revision_id: draft_id.into(),
            expected_draft_content_hash: draft_hash.into(),
            suggestion_ids: suggestion_ids.into_iter().map(ToOwned::to_owned).collect(),
            parent_plan_id: None,
        }
    }

    fn execute(
        connection: &mut Connection,
        plan: &ApplyPlan,
    ) -> Result<ApplyExecutionResult, AppError> {
        apply_service::execute_plan(
            connection,
            ExecuteApplyPlanInput {
                plan_id: plan.plan_id.clone(),
                operation_id: plan.operation_id.clone(),
                request_hash: plan.request_hash.clone(),
            },
        )
    }

    #[test]
    fn co_apply01_creates_proposal_plan_canon_link_and_replays(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let source = suggestion(
            "suggestion-world",
            "world_setting",
            "worldSetting.era",
            Value::Null,
            json!("蒸汽时代"),
            None,
        );
        let (session, draft, hash) = accepted_fixture(
            &mut connection,
            vec![source],
            vec![("worldSetting.era", json!("蒸汽时代"))],
        )?;
        let prepared = prepare_apply(
            &mut connection,
            prepare_input(
                &session,
                &draft,
                &hash,
                vec!["suggestion-world"],
                "prepare-a",
            ),
        )?;
        assert_eq!(prepared.plan.status, ApplyPlanStatus::Ready);
        assert_eq!(prepared.proposal.artifact_id, "artifact-a");
        assert_eq!(prepared.affected_targets.len(), 1);
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM world_settings", [], |row| row
                .get::<_, i64>(0))?,
            0
        );

        let executed = execute(&mut connection, &prepared.plan)?;
        assert_eq!(executed.status, ApplyPlanStatus::Completed);
        assert_eq!(executed.target_links.len(), 1);
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM world_settings", [], |row| row
                .get::<_, i64>(0))?,
            1
        );
        let replay = execute(&mut connection, &prepared.plan)?;
        assert!(replay.idempotent_replay);
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM world_settings", [], |row| row
                .get::<_, i64>(0))?,
            1
        );

        let prepared_replay = prepare_apply(
            &mut connection,
            prepare_input(
                &session,
                &draft,
                &hash,
                vec!["suggestion-world"],
                "prepare-a",
            ),
        )?;
        assert_eq!(prepared_replay.plan.plan_id, prepared.plan.plan_id);
        Ok(())
    }

    #[test]
    fn co_apply02_stale_target_blocks_without_canon_write() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = connection()?;
        let source = suggestion(
            "suggestion-world",
            "world_setting",
            "worldSetting.era",
            Value::Null,
            json!("蒸汽时代"),
            None,
        );
        let (session, draft, hash) = accepted_fixture(
            &mut connection,
            vec![source],
            vec![("worldSetting.era", json!("蒸汽时代"))],
        )?;
        let prepared = prepare_apply(
            &mut connection,
            prepare_input(
                &session,
                &draft,
                &hash,
                vec!["suggestion-world"],
                "prepare-stale",
            ),
        )?;
        let target_id = &prepared.plan.operations[0].target_id;
        connection.execute(
            "INSERT INTO world_settings (id,novel_id,title,content,is_active,created_at,updated_at)
             VALUES (?1,'novel-a','并发设定','changed',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
            params![target_id],
        )?;
        let error = execute(&mut connection, &prepared.plan).expect_err("stale plan");
        assert_eq!(error.code, codes::APPLY_PLAN_STALE);
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM world_settings", [], |row| row
                .get::<_, i64>(0))?,
            1
        );
        assert_eq!(
            connection.query_row(
                "SELECT status FROM artifact_apply_plans WHERE plan_id=?1",
                params![prepared.plan.plan_id],
                |row| row.get::<_, String>(0)
            )?,
            "blocked"
        );
        Ok(())
    }

    #[test]
    fn co_apply03_batch_failure_rolls_back_every_target() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = connection()?;
        let world = suggestion(
            "suggestion-world",
            "world_setting",
            "worldSetting.era",
            Value::Null,
            json!("蒸汽时代"),
            None,
        );
        let rule = suggestion(
            "suggestion-rule",
            "rule_system",
            "ruleSystem.coreMechanism",
            Value::Null,
            json!("以记忆交换力量"),
            None,
        );
        let (session, draft, hash) = accepted_fixture(
            &mut connection,
            vec![world, rule],
            vec![
                ("worldSetting.era", json!("蒸汽时代")),
                ("ruleSystem.coreMechanism", json!("以记忆交换力量")),
            ],
        )?;
        let prepared = prepare_apply(
            &mut connection,
            prepare_input(
                &session,
                &draft,
                &hash,
                vec!["suggestion-world", "suggestion-rule"],
                "prepare-batch",
            ),
        )?;
        connection.execute_batch(
            "CREATE TRIGGER fail_rule_insert BEFORE INSERT ON rule_systems
             BEGIN SELECT RAISE(ABORT,'injected rule failure'); END;",
        )?;
        execute(&mut connection, &prepared.plan).expect_err("batch rollback");
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM world_settings", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM rule_systems", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM artifact_target_links WHERE plan_id=?1",
                params![prepared.plan.plan_id],
                |row| row.get::<_, i64>(0)
            )?,
            0
        );
        Ok(())
    }

    #[test]
    fn co_apply04_reverse_proposal_undoes_create_and_replays(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let source = suggestion(
            "suggestion-world",
            "world_setting",
            "worldSetting.era",
            Value::Null,
            json!("蒸汽时代"),
            None,
        );
        let (session, draft, hash) = accepted_fixture(
            &mut connection,
            vec![source],
            vec![("worldSetting.era", json!("蒸汽时代"))],
        )?;
        let prepared = prepare_apply(
            &mut connection,
            prepare_input(
                &session,
                &draft,
                &hash,
                vec!["suggestion-world"],
                "prepare-forward",
            ),
        )?;
        execute(&mut connection, &prepared.plan)?;
        let undo = prepare_undo(
            &mut connection,
            PrepareCoCreationUndoInput {
                operation_id: "prepare-undo".into(),
                novel_id: "novel-a".into(),
                completed_plan_id: prepared.plan.plan_id.clone(),
            },
        )?;
        assert_eq!(
            undo.plan.parent_plan_id.as_deref(),
            Some(prepared.plan.plan_id.as_str())
        );
        assert_eq!(
            undo.proposal.parent_proposal_id.as_deref(),
            Some(prepared.proposal.proposal_id.as_str())
        );
        let undone = execute(&mut connection, &undo.plan)?;
        assert_eq!(undone.status, ApplyPlanStatus::Completed);
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM world_settings", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        assert!(execute(&mut connection, &undo.plan)?.idempotent_replay);
        Ok(())
    }

    #[test]
    fn co_apply05_freezes_creative_intent_through_the_same_plan(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let source = suggestion(
            "suggestion-intent",
            "creative_intent",
            "creativeIntent.primaryGoal",
            Value::Null,
            json!("写一部关于选择代价的成长故事"),
            None,
        );
        let (session, draft, hash) = accepted_fixture(
            &mut connection,
            vec![source],
            vec![(
                "creativeIntent.primaryGoal",
                json!("写一部关于选择代价的成长故事"),
            )],
        )?;
        let prepared = prepare_apply(
            &mut connection,
            prepare_input(
                &session,
                &draft,
                &hash,
                vec!["suggestion-intent"],
                "prepare-intent",
            ),
        )?;
        execute(&mut connection, &prepared.plan)?;
        let latest = creative_intent_service::get_latest(&connection, "novel-a")?.expect("intent");
        assert_eq!(latest.intent.revision, 1);
        assert_eq!(latest.intent.statements.len(), 1);
        assert_eq!(
            latest.intent.statements[0].value,
            json!("写一部关于选择代价的成长故事")
        );
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM artifact_target_links WHERE target_type='creative_intent'",
                [],
                |row| row.get::<_, i64>(0)
            )?,
            1
        );
        let undo = prepare_undo(
            &mut connection,
            PrepareCoCreationUndoInput {
                operation_id: "undo-intent".into(),
                novel_id: "novel-a".into(),
                completed_plan_id: prepared.plan.plan_id,
            },
        )?;
        execute(&mut connection, &undo.plan)?;
        let reverted =
            creative_intent_service::get_latest(&connection, "novel-a")?.expect("reverted intent");
        assert_eq!(reverted.intent.revision, 2);
        assert_eq!(reverted.intent.statements[0].value["reverted"], true);
        assert_eq!(
            reverted.intent.statements[0].knowledge_class,
            CreativeKnowledgeClass::RequiresConfirmation
        );
        assert_eq!(
            reverted.intent.statements[0].confirmation.status,
            "rejected"
        );
        Ok(())
    }

    #[test]
    fn co_apply06_character_write_updates_shared_protagonist_projection(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let identity = suggestion(
            "suggestion-identity",
            "protagonist",
            "protagonist.identity",
            Value::Null,
            json!("流亡档案师"),
            None,
        );
        let goal = suggestion(
            "suggestion-goal",
            "protagonist",
            "protagonist.currentGoal",
            Value::Null,
            json!("找回被抹除的城市记忆"),
            None,
        );
        let (session, draft, hash) = accepted_fixture(
            &mut connection,
            vec![identity, goal],
            vec![
                ("protagonist.identity", json!("流亡档案师")),
                ("protagonist.currentGoal", json!("找回被抹除的城市记忆")),
            ],
        )?;
        let prepared = prepare_apply(
            &mut connection,
            prepare_input(
                &session,
                &draft,
                &hash,
                vec!["suggestion-identity", "suggestion-goal"],
                "prepare-character",
            ),
        )?;
        execute(&mut connection, &prepared.plan)?;
        let row: (String, String, i64) = connection.query_row(
            "SELECT identity,goal,is_protagonist FROM characters WHERE novel_id='novel-a'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        assert_eq!(row, ("流亡档案师".into(), "找回被抹除的城市记忆".into(), 1));
        let protagonists: String = connection.query_row(
            "SELECT protagonists_json FROM novels WHERE id='novel-a'",
            [],
            |row| row.get(0),
        )?;
        let protagonists: Value = serde_json::from_str(&protagonists)?;
        assert_eq!(protagonists[0]["identity"], "流亡档案师");
        assert_eq!(protagonists[0]["goal"], "找回被抹除的城市记忆");
        Ok(())
    }

    #[test]
    fn co_apply07_setting_merge_preserves_later_structured_workspace_content() {
        let first = merged_setting_value(
            Some(json!({
                "title": "原始世界",
                "content": "作者原始正文 A",
                "structuredJson": null,
                "isActive": true,
            })),
            "world_setting",
            &json!({ "worldSetting.era": "蒸汽纪元" }),
        );
        let mut edited = first;
        edited["content"] = json!("结构化工作台保存的正文 B");
        let second = merged_setting_value(
            Some(edited),
            "world_setting",
            &json!({ "worldSetting.socialStructure": "浮空城邦" }),
        );
        let content = second["content"].as_str().expect("content");
        assert!(content.starts_with("结构化工作台保存的正文 B"));
        assert!(!content.contains("作者原始正文 A"));
        assert!(content.contains("蒸汽纪元"));
        assert!(content.contains("浮空城邦"));
        let structured: Value =
            serde_json::from_str(second["structuredJson"].as_str().expect("structured"))
                .expect("structured json");
        assert_eq!(
            structured["coCreationBaseContent"],
            "结构化工作台保存的正文 B"
        );
        assert_eq!(
            structured["coCreationRenderedContentHash"],
            large_text_repository::sha256(content)
        );
    }

    #[test]
    fn co_apply08_candidate_hash_normalizes_provider_whitespace_and_extra_keys() {
        let raw = json!({
            "target": {
                "objectType": " world_setting ",
                "objectId": " world-a ",
                "fieldPath": " worldSetting.era ",
                "ignored": true,
            },
            "originalValue": null,
            "suggestedValue": "蒸汽纪元",
            "fieldState": " ai_suggested ",
            "sourceType": " ai_inference ",
            "sourceReferences": [{
                "sourceType": " ai_inference ",
                "sourceId": " inference-a ",
                "excerpt": "  证据  ",
                "ignored": "drop-me",
            }],
            "confidence": 0.9,
            "conflicts": [{
                "code": " conflict-a ",
                "severity": " warning ",
                "message": "  需要注意  ",
                "sourceReferences": [],
                "ignored": 1,
            }],
            "ignored": "drop-me",
        });
        let normalized = json!({
            "target": {
                "objectType": "world_setting",
                "objectId": "world-a",
                "fieldPath": "worldSetting.era",
            },
            "originalValue": null,
            "suggestedValue": "蒸汽纪元",
            "fieldState": "ai_suggested",
            "sourceType": "ai_inference",
            "sourceReferences": [{
                "sourceType": "ai_inference",
                "sourceId": "inference-a",
                "excerpt": "证据",
            }],
            "confidence": 0.9,
            "conflicts": [{
                "code": "conflict-a",
                "severity": "warning",
                "message": "需要注意",
                "sourceReferences": [],
            }],
        });
        assert_eq!(
            turn_candidate_hash(&raw, 1),
            turn_candidate_hash(&normalized, 1)
        );
    }

    #[test]
    fn co_apply09_updates_exact_secondary_protagonist_and_restores_all_projection_columns(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let original_profiles = json!([
            { "id": "character-a", "label": "primary", "name": "主角甲", "ability": "火" },
            { "id": "character-b", "label": "secondary", "name": "主角乙", "identity": "旧身份", "ability": "水" }
        ]);
        connection.execute(
            "UPDATE novels SET protagonist_mode='dual',protagonists_json=?1,
                    main_character='主角甲',protagonist_ability='火' WHERE id='novel-a'",
            params![original_profiles.to_string()],
        )?;
        connection.execute_batch(
            "INSERT INTO characters
                (id,novel_id,name,role_type,identity,source,source_type,is_protagonist,
                 protagonist_order,is_active,created_at,updated_at)
             VALUES
                ('character-a','novel-a','主角甲','protagonist','甲身份','manual','manual',1,0,1,'now','now'),
                ('character-b','novel-a','主角乙','protagonist','旧身份','manual','manual',1,1,1,'now','now');",
        )?;
        let mut source = suggestion(
            "suggestion-secondary",
            "protagonist",
            "protagonist.identity",
            json!("旧身份"),
            json!("新身份"),
            None,
        );
        source["target"]["objectId"] = json!("character-b");
        source["candidateHash"] = json!(turn_candidate_hash(&source, 1)?);
        source["confirmedReplacement"] = json!(true);
        let (session, draft, hash) = accepted_fixture(
            &mut connection,
            vec![source],
            vec![("protagonist.identity", json!("新身份"))],
        )?;
        let prepared = prepare_apply(
            &mut connection,
            prepare_input(
                &session,
                &draft,
                &hash,
                vec!["suggestion-secondary"],
                "prepare-secondary",
            ),
        )?;
        execute(&mut connection, &prepared.plan)?;
        let updated: (String, String, String) = connection.query_row(
            "SELECT identity,source,source_type FROM characters WHERE id='character-b'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        assert_eq!(updated, ("新身份".into(), "manual".into(), "manual".into()));
        let projection: (String, String, String, String) = connection.query_row(
            "SELECT protagonist_mode,protagonists_json,main_character,protagonist_ability
             FROM novels WHERE id='novel-a'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        let profiles: Value = serde_json::from_str(&projection.1)?;
        assert_eq!(profiles[0]["identity"], Value::Null);
        assert_eq!(profiles[1]["identity"], "新身份");
        assert_eq!(projection.0, "dual");
        assert_eq!(projection.2, "主角甲");
        assert_eq!(projection.3, "火");

        let undo = prepare_undo(
            &mut connection,
            PrepareCoCreationUndoInput {
                operation_id: "undo-secondary".into(),
                novel_id: "novel-a".into(),
                completed_plan_id: prepared.plan.plan_id,
            },
        )?;
        execute(&mut connection, &undo.plan)?;
        let restored_identity: String = connection.query_row(
            "SELECT identity FROM characters WHERE id='character-b'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(restored_identity, "旧身份");
        let restored: (String, String, String, String) = connection.query_row(
            "SELECT protagonist_mode,protagonists_json,main_character,protagonist_ability
             FROM novels WHERE id='novel-a'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        assert_eq!(restored.0, "dual");
        assert_eq!(
            serde_json::from_str::<Value>(&restored.1)?,
            original_profiles
        );
        assert_eq!(restored.2, "主角甲");
        assert_eq!(restored.3, "火");
        Ok(())
    }

    #[test]
    fn co_apply10_stales_remaining_suggestions_from_the_applied_artifact(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let era = suggestion(
            "suggestion-era",
            "world_setting",
            "worldSetting.era",
            Value::Null,
            json!("蒸汽时代"),
            None,
        );
        let location = suggestion(
            "suggestion-location",
            "world_setting",
            "worldSetting.primaryLocation",
            Value::Null,
            json!("雾港"),
            None,
        );
        let (session, draft, hash) = accepted_fixture(
            &mut connection,
            vec![era, location],
            vec![
                ("worldSetting.era", json!("蒸汽时代")),
                ("worldSetting.primaryLocation", json!("雾港")),
            ],
        )?;
        let first = prepare_apply(
            &mut connection,
            prepare_input(
                &session,
                &draft,
                &hash,
                vec!["suggestion-era"],
                "prepare-era",
            ),
        )?;
        execute(&mut connection, &first.plan)?;
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM ai_artifact_stale_events WHERE artifact_id='artifact-a'",
                [],
                |row| row.get::<_, i64>(0),
            )?,
            1
        );
        let error = prepare_apply(
            &mut connection,
            prepare_input(
                &session,
                &draft,
                &hash,
                vec!["suggestion-location"],
                "prepare-location-after-canon-change",
            ),
        )
        .expect_err("the remaining suggestion must be rebased");
        assert_eq!(error.code, codes::APPLY_PLAN_STALE);
        Ok(())
    }

    #[test]
    fn co_apply11_preserves_integrity_error_code_and_marks_plan_failed(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = connection()?;
        let source = suggestion(
            "suggestion-world",
            "world_setting",
            "worldSetting.era",
            Value::Null,
            json!("蒸汽时代"),
            None,
        );
        let (session, draft, hash) = accepted_fixture(
            &mut connection,
            vec![source],
            vec![("worldSetting.era", json!("蒸汽时代"))],
        )?;
        let prepared = prepare_apply(
            &mut connection,
            prepare_input(
                &session,
                &draft,
                &hash,
                vec!["suggestion-world"],
                "prepare-integrity-error",
            ),
        )?;
        let mut invalid_plan = prepared.plan.clone();
        invalid_plan.plan_id = uuid::Uuid::new_v4().to_string();
        invalid_plan.operation_id = uuid::Uuid::new_v4().to_string();
        invalid_plan.request_hash = uuid::Uuid::new_v4().to_string();
        for operation in &mut invalid_plan.operations {
            operation.apply_operation_id = uuid::Uuid::new_v4().to_string();
            operation.payload["tamperedAfterHash"] = json!(true);
        }
        apply_plan_repository::insert_plan(&connection, &invalid_plan)?;
        let error = execute(&mut connection, &invalid_plan).expect_err("payload hash mismatch");
        assert_eq!(error.code, codes::OPERATION_PAYLOAD_CONFLICT);
        assert_eq!(
            connection.query_row(
                "SELECT status FROM artifact_apply_plans WHERE plan_id=?1",
                params![invalid_plan.plan_id],
                |row| row.get::<_, String>(0),
            )?,
            "failed"
        );
        Ok(())
    }
}
