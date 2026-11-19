//! Authoritative rule-set identity and conservative author-governed impact review.
//! No semantic solver: adopted chapters are potential impacts, not proven contradictions.
use crate::errors::AppError;
use crate::repositories::{large_text_repository, world_setting_repository};
use crate::services::ai_fact_security;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[path = "../../shared/world_rule_fingerprint.rs"]
pub mod fingerprint;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuleSetSnapshot {
    pub novel_id: String,
    pub fingerprint: String,
    pub sources: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuleChange {
    pub operation: Option<String>,
    pub target_type: String,
    pub target_id: Option<String>,
    pub title: String,
    pub content: String,
    pub category: Option<String>,
    pub forbidden_rules: Option<String>,
    pub structured_json: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuleChangeAuthorization {
    pub preview_hash: String,
    pub intent: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuleChangePreview {
    pub novel_id: String,
    pub rule_set_fingerprint: String,
    pub sources: Vec<Value>,
    pub preview_hash: String,
    pub affected_chapters: Vec<Value>,
    pub dependent_rules: Vec<Value>,
    pub uncertainty: Vec<String>,
    pub blocking_conflicts: Vec<Value>,
    pub requires_confirmation: bool,
}

pub fn hash_json(value: &Value) -> Result<String, AppError> {
    Ok(large_text_repository::sha256(
        &ai_fact_security::canonical_json(value)?,
    ))
}

fn error(code: &str, message: &str) -> AppError {
    AppError::new(code, message, false)
}

/// Public deterministic projection also usable by read-context adapters. IDs, inactive
/// rows, exact structured JSON and forbidden text participate, not just timestamps.
pub fn rule_set_snapshot(
    connection: &Connection,
    novel_id: &str,
) -> Result<RuleSetSnapshot, AppError> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM novels WHERE id=?1 AND deleted_at IS NULL)",
            params![novel_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if !exists {
        return Err(error("RULE_SET_SCOPE_MISMATCH", "作品不存在或已删除"));
    }
    let world = world_setting_repository::find_world_settings_by_novel(connection, novel_id)
        .map_err(|_| error("RULE_SET_READ_FAILED", "无法读取世界基线"))?
        .into_iter()
        .map(|row| json!(row))
        .collect::<Vec<_>>();
    let rules = world_setting_repository::find_rule_systems_by_novel(connection, novel_id)
        .map_err(|_| error("RULE_SET_READ_FAILED", "无法读取规则基线"))?
        .into_iter()
        .map(|row| json!(row))
        .collect::<Vec<_>>();
    serde_json::from_value(fingerprint::snapshot_from_records(novel_id, &world, &rules))
        .map_err(|_| error("RULE_SET_READ_FAILED", "规则来源投影失败"))
}

/// Call after an actual rule/world mutation, inside that same IMMEDIATE transaction.
/// Consumed authorizations and adopted history are never reopened or removed.
pub fn expire_rule_dependent_reviews(
    connection: &Connection,
    novel_id: &str,
) -> Result<(), AppError> {
    let current = rule_set_snapshot(connection, novel_id)?;
    connection.execute(
        "UPDATE review_authorizations SET status='expired'
         WHERE novel_id=?1 AND status='issued' AND NOT EXISTS (
             SELECT 1 FROM result_artifacts artifact JOIN ai_tasks task ON task.task_id=artifact.task_id
             WHERE artifact.artifact_id=review_authorizations.artifact_id AND artifact.source_novel_id=?1
               AND json_extract(task.target_hint_json,'$.nativeRuleSet.fingerprint')=?2
         )", params![novel_id,current.fingerprint],
    ).map_err(AppError::database)?;
    Ok(())
}

pub fn validate_frozen_rule_set(
    connection: &Connection,
    novel_id: &str,
    frozen: &Value,
) -> Result<(), AppError> {
    let supplied: RuleSetSnapshot = serde_json::from_value(frozen.clone()).map_err(|_| {
        error(
            "RULE_SET_SNAPSHOT_REQUIRED",
            "候选缺少可信规则来源快照，请重新生成或显式重新审查",
        )
    })?;
    let actual = rule_set_snapshot(connection, novel_id)?;
    if supplied != actual {
        return Err(error(
            "RULE_SET_BASE_CONFLICT",
            "候选产生后世界或规则已变化，请重新生成候选",
        ));
    }
    Ok(())
}

pub fn preview_rule_change(
    connection: &Connection,
    novel_id: &str,
    changes: &[RuleChange],
) -> Result<RuleChangePreview, AppError> {
    if changes.is_empty() || changes.len() > 200 {
        return Err(error("RULE_CHANGE_INPUT_INVALID", "没有合法的规则变更"));
    }
    let snapshot = rule_set_snapshot(connection, novel_id)?;
    let mut blocking = Vec::new();
    let mut evidence = Vec::new();
    let deleted_ids = changes
        .iter()
        .filter(|change| change.operation.as_deref() == Some("delete"))
        .filter_map(|change| change.target_id.as_deref())
        .collect::<Vec<_>>();
    let world = world_setting_repository::find_world_settings_by_novel(connection, novel_id)
        .map_err(|_| error("RULE_SET_READ_FAILED", "无法读取依赖来源"))?;
    let rules = world_setting_repository::find_rule_systems_by_novel(connection, novel_id)
        .map_err(|_| error("RULE_SET_READ_FAILED", "无法读取依赖来源"))?;
    for (id, raw) in world
        .iter()
        .map(|row| (&row.id, &row.structured_json))
        .chain(rules.iter().map(|row| (&row.id, &row.structured_json)))
    {
        if deleted_ids.contains(&id.as_str()) {
            continue;
        }
        if let Some(value) = raw
            .as_deref()
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
            .filter(crate::services::world_rule_schema::valid_document)
        {
            if let Some(dependencies) = value.get("dependencies").and_then(Value::as_array) {
                for dependency in dependencies.iter().filter_map(Value::as_str) {
                    if deleted_ids.contains(&dependency) {
                        blocking.push(json!({"code":"RULE_DELETE_HAS_DEPENDENTS","sourceId":id,"ruleId":dependency,
                            "certainty":"verified_reference","reason":"已有规则明确依赖该条目，请先修订依赖或选择停用"}));
                    }
                }
            }
        }
    }
    for change in changes {
        if change
            .operation
            .as_deref()
            .is_some_and(|operation| !matches!(operation, "upsert" | "delete"))
            || (change.operation.as_deref() == Some("delete") && change.target_id.is_none())
        {
            return Err(error("RULE_CHANGE_INPUT_INVALID", "规则变更操作无效"));
        }
        crate::services::world_rule_schema::validate_world_rule_document(
            change.structured_json.as_deref(),
        )?;
        if !matches!(change.target_type.as_str(), "world_setting" | "rule_system")
            || change.title.trim().is_empty()
            || change.content.trim().is_empty()
        {
            return Err(error("RULE_CHANGE_INPUT_INVALID", "规则变更类型或内容无效"));
        }
        if let Some(id) = change.target_id.as_deref() {
            if !snapshot.sources.iter().any(|source| {
                source["sourceId"] == id && source["sourceType"] == change.target_type
            }) {
                return Err(error(
                    "RULE_SET_SCOPE_MISMATCH",
                    "变更目标不属于当前作品或类型",
                ));
            }
        }
        for source in &snapshot.sources {
            if source["isActive"] == true
                && source["sourceId"].as_str() != change.target_id.as_deref()
            {
                evidence.push(json!({"kind":"existing_rule", "source":source,
                    "certainty":"author_review_required", "reason":"既有启用规则可能约束本次变更，未进行自动语义证明"}));
            }
        }
        // Explicit dependency IDs are factual references. A missing/cross-novel ID is
        // deterministically invalid; prose similarities are deliberately not blockers.
        if let Some(raw) = change.structured_json.as_deref() {
            if let Some(value) = serde_json::from_str::<Value>(raw)
                .ok()
                .filter(crate::services::world_rule_schema::valid_document)
            {
                if let Some(dependencies) = value.get("dependencies").and_then(Value::as_array) {
                    for dependency in dependencies {
                        let id = dependency
                            .as_str()
                            .or_else(|| dependency.get("ruleId").and_then(Value::as_str));
                        if let Some(id) = id {
                            if !snapshot
                                .sources
                                .iter()
                                .any(|source| source["sourceId"] == id)
                            {
                                blocking.push(json!({"code":"RULE_DEPENDENCY_MISSING", "ruleId":id,
                                    "certainty":"verified_reference", "reason":"依赖规则不属于当前作品；请先修订依赖，不可用作者确认覆盖"}));
                            }
                        }
                    }
                }
            }
        }
    }
    let missing_evidence:bool=connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM chapters c LEFT JOIN chapter_drafts d ON d.id=c.adopted_draft_id AND d.chapter_id=c.id AND d.novel_id=c.novel_id
         WHERE c.novel_id=?1 AND c.deleted_at IS NULL AND c.adopted_draft_id IS NOT NULL AND (d.id IS NULL OR d.is_adopted<>1))",
        params![novel_id],|row| row.get(0),
    ).map_err(AppError::database)?;
    if missing_evidence {
        return Err(error(
            "RULE_IMPACT_EVIDENCE_UNAVAILABLE",
            "采用章证据不可用，请恢复来源后重新预览，不能按无影响继续",
        ));
    }
    let mut statement = connection.prepare(
        "SELECT c.id, c.title, c.adopted_draft_id, c.updated_at, d.version_no, d.content_hash, d.updated_at
         FROM chapters c JOIN chapter_drafts d ON d.id=c.adopted_draft_id AND d.chapter_id=c.id AND d.novel_id=c.novel_id
         WHERE c.novel_id=?1 AND c.deleted_at IS NULL AND d.is_adopted=1 ORDER BY c.id"
    ).map_err(AppError::database)?;
    let affected_chapters = statement.query_map(params![novel_id], |row| Ok(json!({
        "chapterId":row.get::<_, String>(0)?, "title":row.get::<_, String>(1)?,
        "adoptedDraftId":row.get::<_, String>(2)?, "chapterRevision":row.get::<_, String>(3)?,
        "draftVersion":row.get::<_, i64>(4)?, "contentHash":row.get::<_, Option<String>>(5)?,
        "draftRevision":row.get::<_, String>(6)?, "certainty":"potential_impact",
        "evidence":"该章已有采用稿；世界规则变更可能影响正史，需要作者核对，不代表已证明矛盾"
    }))).map_err(AppError::database)?.collect::<Result<Vec<_>, _>>().map_err(AppError::database)?;
    let mut statement = connection
        .prepare(
            "SELECT a.artifact_id, a.artifact_type, a.content_hash FROM result_artifacts a
         WHERE a.source_novel_id=?1 ORDER BY a.artifact_id",
        )
        .map_err(AppError::database)?;
    let affected_artifacts = statement
        .query_map(params![novel_id], |row| {
            Ok(json!({
                "artifactId":row.get::<_, String>(0)?, "artifactType":row.get::<_, String>(1)?,
                "artifactHash":row.get::<_, String>(2)?, "certainty":"potentially_stale",
                "evidence":"变更会使依赖旧规则集的候选失效；未声称候选存在语义矛盾"
            }))
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    let warnings =
        vec!["影响范围采用保守估计；自然语言矛盾、例外适用与正史一致性仍需作者判断。".to_string()];
    let requires_acknowledgement = true; // Draft/inactive writes also cannot forge author authority via JSON.
    let preview_hash = hash_json(&json!({"schema":"world-rule-change-v1", "novelId":novel_id,
        "changes":changes.iter().map(|change| { let mut value=json!(change); value["operation"]=json!(change.operation.as_deref().unwrap_or("upsert")); value }).collect::<Vec<_>>(), "ruleSet":snapshot, "affectedChapters":affected_chapters,
        "affectedArtifacts":affected_artifacts, "blockingConflicts":blocking}))?;
    Ok(RuleChangePreview {
        novel_id: novel_id.to_string(),
        rule_set_fingerprint: snapshot.fingerprint,
        sources: snapshot.sources,
        preview_hash,
        affected_chapters,
        dependent_rules: evidence,
        uncertainty: warnings,
        blocking_conflicts: blocking,
        requires_confirmation: requires_acknowledgement,
    })
}

#[cfg(test)]
#[path = "world_rule_governance_tests.rs"]
mod tests;

pub fn authorize_rule_change(
    connection: &Connection,
    novel_id: &str,
    changes: &[RuleChange],
    expected_fingerprint: Option<&str>,
    authorization: Option<&RuleChangeAuthorization>,
) -> Result<RuleChangePreview, AppError> {
    let preview = preview_rule_change(connection, novel_id, changes)?;
    if expected_fingerprint != Some(preview.rule_set_fingerprint.as_str()) {
        return Err(error(
            "RULE_SET_BASE_CONFLICT",
            "规则集基线失效，请重新预览变更影响",
        )
        .with_details(json!(preview)));
    }
    if !preview.blocking_conflicts.is_empty() {
        return Err(error(
            "RULE_CHANGE_BLOCKED",
            "存在确定的引用冲突，请先修订候选或正史",
        )
        .with_details(json!(preview)));
    }
    for change in changes {
        if change.operation.as_deref() == Some("delete") {
            continue;
        }
        let previous = if let Some(id) = change.target_id.as_deref() {
            if change.target_type == "rule_system" {
                world_setting_repository::find_rule_system_by_id(connection, id)
                    .map_err(|_| error("RULE_SET_READ_FAILED", "规则目标不可读取"))?
                    .and_then(|row| row.structured_json)
            } else {
                world_setting_repository::find_world_setting_by_id(connection, id)
                    .map_err(|_| error("RULE_SET_READ_FAILED", "世界目标不可读取"))?
                    .and_then(|row| row.structured_json)
            }
        } else {
            None
        };
        crate::services::world_rule_schema::validate_metadata(
            change.structured_json.as_deref(),
            previous.as_deref(),
            authorization.map(|value| value.intent.as_str()),
        )
        .map_err(|message| {
            error(
                message
                    .split(':')
                    .next()
                    .unwrap_or("WORLD_RULE_SCHEMA_INVALID"),
                &message,
            )
        })?;
    }
    if preview.requires_confirmation {
        let authorization = authorization.ok_or_else(|| {
            error(
                "RULE_CHANGE_CONFIRMATION_REQUIRED",
                "请查看影响并明确确认规则变更",
            )
            .with_details(json!(preview))
        })?;
        if authorization.preview_hash != preview.preview_hash
            || !matches!(
                authorization.intent.as_str(),
                "confirm_change" | "retcon" | "approve_exception"
            )
        {
            return Err(error(
                "RULE_CHANGE_AUTHORIZATION_INVALID",
                "确认不属于本次内容或影响预览",
            ));
        }
        if matches!(
            authorization.intent.as_str(),
            "retcon" | "approve_exception"
        ) && authorization
            .notes
            .as_deref()
            .is_none_or(|notes| notes.trim().is_empty())
        {
            return Err(error(
                "RULE_CHANGE_NOTES_REQUIRED",
                "正史修订或例外必须说明理由与适用边界",
            ));
        }
        if authorization.intent == "approve_exception"
            && !changes.iter().all(|change| {
                change
                    .structured_json
                    .as_deref()
                    .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                    .and_then(|value| value.get("exceptions").and_then(Value::as_array).cloned())
                    .is_some_and(|exceptions| !exceptions.is_empty())
            })
        {
            return Err(error(
                "RULE_EXCEPTION_SCOPE_REQUIRED",
                "例外必须有显式结构化范围；不能仅用确认按钮跳过规则",
            ));
        }
    }
    Ok(preview)
}
