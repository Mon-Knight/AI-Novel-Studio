//! Legacy candidate adoption uses one IMMEDIATE transaction, never frontend dual writes.
use crate::commands::setting_suggestions::{self as suggestions, SettingSuggestionDto};
use crate::repositories::{character_asset_repository, world_setting_repository};
use crate::services::world_rule_governance::{
    self as governance, RuleChange, RuleChangeAuthorization, RuleChangePreview,
};
use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptSettingSuggestionInput {
    pub id: String,
    pub novel_id: String,
    pub expected_candidate_hash: String,
    pub authorized_item_hash: String,
    pub edited_item: Option<Map<String, Value>>,
    pub actor: String,
    pub expected_rule_set_fingerprint: Option<String>,
    pub change_authorization: Option<RuleChangeAuthorization>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptionResult {
    pub record: SettingSuggestionDto,
    pub target_id: String,
    pub target_type: String,
    pub replayed: bool,
}

fn hash(value: &Value) -> Result<String, String> {
    governance::hash_json(value).map_err(|e| e.to_string())
}
fn failure(code: &str) -> String {
    format!("SETTING_SUGGESTION_{code}: 设定候选作用域、授权或基线无效")
}
fn field<'a>(item: &'a Map<String, Value>, keys: &[&str]) -> &'a str {
    keys.iter()
        .find_map(|key| {
            item.get(*key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|v| !v.is_empty())
        })
        .unwrap_or("")
}
fn envelope(record: &SettingSuggestionDto) -> Value {
    serde_json::from_str::<Value>(&record.result_json)
        .ok()
        .filter(|value| {
            value["format"] == "setting-candidate-v1" || value["format"] == "setting-adoption-v1"
        })
        .unwrap_or_else(
            || json!({"format":"setting-candidate-v1", "originalResultJson":record.result_json}),
        )
}
pub fn candidate_hash(record: &SettingSuggestionDto) -> Result<String, String> {
    let metadata = envelope(record);
    let item = metadata
        .get("originalItem")
        .cloned()
        .unwrap_or_else(|| json!(record.item));
    hash(
        &json!({"id":record.id,"novelId":record.novel_id,"suggestionType":record.suggestion_type,
        "item":item,"prompt":record.prompt,"createdAt":record.created_at}),
    )
}
fn prepared_item(
    record: &SettingSuggestionDto,
    input: &AdoptSettingSuggestionInput,
) -> Result<Map<String, Value>, String> {
    if input.actor != "user"
        || record.novel_id != input.novel_id
        || candidate_hash(record)? != input.expected_candidate_hash
    {
        return Err(failure("AUTHORIZATION_INVALID"));
    }
    let item = match &input.edited_item {
        Some(item) => suggestions::normalize_item(item.clone())?,
        None => envelope(record)
            .get("originalItem")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_else(|| record.item.clone()),
    };
    if field(&item, &["name"]).is_empty() || hash(&json!(item))? != input.authorized_item_hash {
        return Err(failure("ITEM_HASH_MISMATCH"));
    }
    Ok(item)
}
fn target_type(record: &SettingSuggestionDto) -> Result<&'static str, String> {
    match record.suggestion_type.as_str() {
        "character" => Ok("character"),
        "rule" => Ok("rule_system"),
        "faction" | "location" => Ok("world_setting"),
        _ => Err(failure("TYPE_INVALID")),
    }
}
fn rule_change(
    record: &SettingSuggestionDto,
    item: &Map<String, Value>,
) -> Result<Option<RuleChange>, String> {
    let kind = target_type(record)?;
    if kind == "character" {
        return Ok(None);
    }
    let (title, content, category) = if kind == "rule_system" {
        let mut sections = vec![field(item, &["content", "description"]).to_string()];
        for (key, label) in [
            ("limits", "限制条件"),
            ("scope", "影响范围"),
            ("possible_conflict", "可能冲突"),
            ("plot_usage", "剧情用途"),
        ] {
            let value = field(item, &[key]);
            if !value.is_empty() {
                sections.push(format!("{label}：{value}"));
            }
        }
        let raw = field(item, &["type"]).to_lowercase();
        let category = [
            ("magic", "魔法"),
            ("technology", "科技"),
            ("cultivation", "修炼"),
            ("combat", "战斗"),
            ("social", "社会"),
        ]
        .iter()
        .find(|(a, b)| raw.contains(*a) || raw.contains(*b))
        .map(|(a, _)| *a)
        .unwrap_or("other");
        (
            field(item, &["name"]).to_string(),
            sections
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("\n"),
            Some(category.to_string()),
        )
    } else {
        let prefix = if record.suggestion_type == "faction" {
            "势力"
        } else {
            "地点"
        };
        let body = item
            .iter()
            .filter_map(|(key, value)| {
                value
                    .as_str()
                    .filter(|v| !v.trim().is_empty())
                    .map(|v| format!("{key}: {v}"))
            })
            .collect::<Vec<_>>()
            .join("\n");
        (
            format!("{prefix}：{}", field(item, &["name"])),
            format!(
                "来源：设定库 AI 推演候选
类型：{prefix}候选

{body}"
            ),
            None,
        )
    };
    Ok(Some(RuleChange {
        operation: None,
        target_type: kind.to_string(),
        target_id: None,
        title,
        content,
        category,
        forbidden_rules: Some(field(item, &["forbiddenRules", "forbidden_rules"]).to_string())
            .filter(|s| !s.is_empty()),
        structured_json: Some(field(item, &["structuredJson"]).to_string())
            .filter(|s| !s.is_empty()),
        is_active: true,
    }))
}

fn scoped_preview(
    mut preview: RuleChangePreview,
    record: &SettingSuggestionDto,
    input: &AdoptSettingSuggestionInput,
) -> Result<RuleChangePreview, String> {
    preview.preview_hash = hash(
        &json!({"previewHash":preview.preview_hash,"novelId":record.novel_id,
        "suggestionId":record.id,"candidateHash":input.expected_candidate_hash,"authorizedItemHash":input.authorized_item_hash,
        "edited":input.edited_item.is_some()}),
    )?;
    Ok(preview)
}

pub fn preview_adoption(
    connection: &Connection,
    input: &AdoptSettingSuggestionInput,
) -> Result<Option<RuleChangePreview>, String> {
    let record = suggestions::get_setting_suggestion_with(connection, &input.id)?
        .ok_or_else(|| failure("NOT_FOUND"))?;
    suggestions::ensure_novel(connection, &input.novel_id)?;
    let item = prepared_item(&record, input)?;
    if let Some(frozen) = envelope(&record).get("nativeRuleSet") {
        governance::validate_frozen_rule_set(connection, &input.novel_id, frozen)
            .map_err(|e| e.to_string())?;
    }
    match rule_change(&record, &item)? {
        Some(change) => {
            let mut preview =
                governance::preview_rule_change(connection, &input.novel_id, &[change])
                    .map_err(|e| e.to_string())?;
            if envelope(&record)["baselineOrigin"] == "legacy_import_review"
                || envelope(&record).get("nativeRuleSet").is_none()
            {
                preview.uncertainty.push("旧候选没有可证明的生成时规则基线；当前快照仅供作者重新审查，不代表生成时已核对。".to_string());
            }
            scoped_preview(preview, &record, input).map(Some)
        }
        None => Ok(None),
    }
}

fn current_target_hash(
    connection: &Connection,
    kind: &str,
    id: &str,
    novel_id: &str,
) -> Result<String, String> {
    // Hash the complete persisted row, including fields not projected by legacy DTOs.
    // Table names come only from this closed whitelist; target IDs stay parameters.
    let sql = match kind {
        "character" => "SELECT * FROM characters WHERE id=?1 AND novel_id=?2",
        "world_setting" => "SELECT * FROM world_settings WHERE id=?1 AND novel_id=?2",
        "rule_system" => "SELECT * FROM rule_systems WHERE id=?1 AND novel_id=?2",
        _ => return Err(failure("TYPE_INVALID")),
    };
    let mut statement = connection.prepare(sql).map_err(|e| e.to_string())?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let target = statement
        .query_row(params![id, novel_id], |row| {
            let mut target = Map::new();
            for (index, name) in columns.iter().enumerate() {
                let value = match row.get_ref(index)? {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(value) => json!(value),
                    rusqlite::types::ValueRef::Real(value) => json!(value),
                    rusqlite::types::ValueRef::Text(_) => json!(row.get::<_, String>(index)?),
                    rusqlite::types::ValueRef::Blob(value) => json!(value),
                };
                target.insert(name.clone(), value);
            }
            Ok(Value::Object(target))
        })
        .map_err(|_| failure("TARGET_CHANGED"))?;
    hash(&target)
}

pub fn adopt_with(
    connection: &mut Connection,
    input: AdoptSettingSuggestionInput,
) -> Result<AdoptionResult, String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let record = suggestions::get_setting_suggestion_with(&transaction, &input.id)?
        .ok_or_else(|| failure("NOT_FOUND"))?;
    suggestions::ensure_novel(&transaction, &input.novel_id)?;
    let item = prepared_item(&record, &input)?;
    let kind = target_type(&record)?;
    let mut metadata = envelope(&record);
    let original_item_json: String = transaction
        .query_row(
            "SELECT item_json FROM setting_suggestions WHERE id=?1",
            params![record.id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let request_hash = hash(
        &json!({"candidateHash":input.expected_candidate_hash,"authorizedItemHash":input.authorized_item_hash,
        "edited":input.edited_item.is_some(),"novelId":input.novel_id,"targetType":kind,
        "expectedRuleSetFingerprint":input.expected_rule_set_fingerprint,"changeAuthorization":input.change_authorization}),
    )?;
    if record.status != "pending" {
        let receipt = &metadata["receipt"];
        let id = record
            .adopted_target_id
            .as_deref()
            .ok_or_else(|| failure("ALREADY_DECIDED"))?;
        if !matches!(record.status.as_str(), "adopted" | "edited_adopted")
            || receipt["requestHash"] != request_hash
            || record.adopted_target_type.as_deref() != Some(kind)
            || receipt["targetHash"]
                != current_target_hash(&transaction, kind, id, &input.novel_id)?
        {
            return Err(failure("REPLAY_CONFLICT"));
        }
        let result = AdoptionResult {
            target_id: id.to_string(),
            target_type: kind.to_string(),
            record,
            replayed: true,
        };
        transaction.commit().map_err(|e| e.to_string())?;
        return Ok(result);
    }
    if let Some(frozen) = metadata.get("nativeRuleSet") {
        governance::validate_frozen_rule_set(&transaction, &input.novel_id, frozen)
            .map_err(|e| e.to_string())?;
    }
    if let Some(change) = rule_change(&record, &item)? {
        let preview =
            governance::preview_rule_change(&transaction, &input.novel_id, &[change.clone()])
                .map_err(|e| e.to_string())?;
        let scoped = scoped_preview(preview.clone(), &record, &input)?;
        let mut authorization = input
            .change_authorization
            .clone()
            .ok_or_else(|| failure("RULE_CHANGE_CONFIRMATION_REQUIRED"))?;
        if authorization.preview_hash != scoped.preview_hash {
            return Err(failure("RULE_CHANGE_AUTHORIZATION_INVALID"));
        }
        authorization.preview_hash = preview.preview_hash;
        governance::authorize_rule_change(
            &transaction,
            &input.novel_id,
            &[change],
            input.expected_rule_set_fingerprint.as_deref(),
            Some(&authorization),
        )
        .map_err(|e| e.to_string())?;
    }
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(change) = rule_change(&record, &item)? {
        if kind == "rule_system" {
            world_setting_repository::insert_rule_system(
                &transaction,
                &id,
                &input.novel_id,
                &change.title,
                change.category.as_deref(),
                &change.content,
                change.forbidden_rules.as_deref(),
                true,
                &now,
            )?;
        } else {
            world_setting_repository::insert_world_setting(
                &transaction,
                &id,
                &input.novel_id,
                &change.title,
                &change.content,
                true,
                &now,
            )?;
        }
        if let Some(structured) = change.structured_json {
            let sql = if kind == "rule_system" {
                "UPDATE rule_systems SET structured_json=?1 WHERE id=?2"
            } else {
                "UPDATE world_settings SET structured_json=?1 WHERE id=?2"
            };
            transaction
                .execute(sql, params![structured, id])
                .map_err(|e| e.to_string())?;
        }
    } else {
        let raw = field(&item, &["roleType", "role_type", "plot_role", "identity"]).to_lowercase();
        let role = if raw.contains("antagonist") || raw.contains("反派") || raw.contains("敌") {
            "antagonist"
        } else if raw.contains("protagonist") || raw.contains("主角") {
            "protagonist"
        } else if raw.contains("neutral") || raw.contains("中立") {
            "neutral"
        } else {
            "supporting"
        };
        let weakness = field(&item, &["weakness"]);
        let limits = if weakness.is_empty() {
            None
        } else {
            Some(format!("弱点：{weakness}"))
        };
        character_asset_repository::insert_character(
            &transaction,
            &id,
            &input.novel_id,
            field(&item, &["name"]),
            role,
            Some(field(&item, &["identity"])),
            Some(field(&item, &["faction"])),
            Some(field(
                &item,
                &["mainline_relation", "relationToProtagonist"],
            )),
            Some(field(&item, &["goal"])),
            Some(field(&item, &["personality"])),
            limits.as_deref(),
            Some(field(&item, &["forbiddenBehaviors"])),
            Some(field(&item, &["current_status", "currentState"])),
            "manual",
            role == "protagonist",
            &now,
        )?;
    }
    if kind != "character" {
        governance::expire_rule_dependent_reviews(&transaction, &input.novel_id)
            .map_err(|e| e.to_string())?;
    }
    metadata["format"] = json!("setting-adoption-v1");
    metadata["originalItem"] = json!(record.item);
    metadata["receipt"] = json!({"requestHash":request_hash,"candidateHash":input.expected_candidate_hash,
        "targetHash":current_target_hash(&transaction,kind,&id,&input.novel_id)?, "targetId":id,"targetType":kind,
        "expectedRuleSetFingerprint":input.expected_rule_set_fingerprint,"changeAuthorization":input.change_authorization});
    let changed = transaction.execute(
        "UPDATE setting_suggestions SET item_json=?1,status=?2,adopted_target_id=?3,adopted_target_type=?4,updated_at=?5,result_json=?6
         WHERE id=?7 AND novel_id=?8 AND status='pending' AND item_json=?9 AND updated_at=?10",
        params![serde_json::to_string(&item).map_err(|e| e.to_string())?,if input.edited_item.is_some(){"edited_adopted"}else{"adopted"},
            id,kind,now,metadata.to_string(),record.id,record.novel_id,original_item_json,record.updated_at]
    ).map_err(|e| format!("设定采用决定失败，事务已回滚: {e}"))?;
    if changed != 1 {
        return Err(failure("CAS_CONFLICT"));
    }
    let saved = suggestions::get_setting_suggestion_with(&transaction, &record.id)?
        .ok_or_else(|| failure("NOT_FOUND"))?;
    transaction
        .commit()
        .map_err(|e| format!("DATABASE_COMMIT_UNKNOWN: {e}"))?;
    Ok(AdoptionResult {
        record: saved,
        target_id: id,
        target_type: kind.to_string(),
        replayed: false,
    })
}
