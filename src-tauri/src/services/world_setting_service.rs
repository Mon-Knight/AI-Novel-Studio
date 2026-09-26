use crate::domain::world::{DeleteRuleSystemInput, WorldRuleChangeAuthorizationInput};
use crate::domain::world::{
    ProtagonistDto, RuleSystemDto, SaveProtagonistInput, SaveRuleSystemInput,
    SaveWorldSettingInput, WorldSettingDto,
};
use crate::repositories::world_setting_repository;
use crate::services::world_rule_governance::{self, RuleChange, RuleChangeAuthorization};
use rusqlite::{params, Connection, Transaction, TransactionBehavior};

use crate::services::world_rule_schema as metadata;

fn expire_changed_rule_reviews(
    conn: &Connection,
    novel_id: &str,
    previous: Option<&str>,
) -> Result<(), String> {
    let current = world_rule_governance::rule_set_snapshot(conn, novel_id)
        .map_err(|e| format!("{}: {}", e.code, e.message))?;
    if previous != Some(current.fingerprint.as_str()) {
        world_rule_governance::expire_rule_dependent_reviews(conn, novel_id)
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
    }
    Ok(())
}

fn save_governed_change(
    conn: &Connection,
    novel_id: &str,
    mut change: RuleChange,
    expected_updated_at: Option<&str>,
    expected_fingerprint: Option<&str>,
    authorization: Option<&WorldRuleChangeAuthorizationInput>,
) -> Result<String, String> {
    let transaction = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let mut previous_json = None;
    if let Some(id) = change.target_id.as_deref() {
        let (owner, updated_at, structured) = if change.target_type == "world_setting" {
            let row = world_setting_repository::find_world_setting_by_id(&transaction, id)?
                .ok_or("RULE_SET_SCOPE_MISMATCH: 目标背景不存在")?;
            (row.novel_id, row.updated_at, row.structured_json)
        } else {
            let row = world_setting_repository::find_rule_system_by_id(&transaction, id)?
                .ok_or("RULE_SET_SCOPE_MISMATCH: 目标规则不存在")?;
            (row.novel_id, row.updated_at, row.structured_json)
        };
        if owner != novel_id {
            return Err("RULE_SET_SCOPE_MISMATCH: 目标不属于此作品".to_string());
        }
        if expected_updated_at != Some(updated_at.as_str()) {
            return Err(
                "RULE_RECORD_BASE_CONFLICT: 设定已变化，请保留草稿并重新读取基线".to_string(),
            );
        }
        previous_json = structured;
        if change.structured_json.is_none() {
            change.structured_json = previous_json.clone();
        }
    } else if expected_updated_at.is_some() {
        return Err("RULE_RECORD_BASE_CONFLICT: 新建目标不能携带旧版本".to_string());
    }
    let auth = authorization.map(|a| RuleChangeAuthorization {
        preview_hash: a.preview_hash.clone(),
        intent: a.intent.clone(),
        notes: a.notes.clone(),
    });
    metadata::validate_metadata(
        change.structured_json.as_deref(),
        previous_json.as_deref(),
        auth.as_ref().map(|a| a.intent.as_str()),
    )?;
    world_rule_governance::authorize_rule_change(
        &transaction,
        novel_id,
        &[change.clone()],
        expected_fingerprint,
        auth.as_ref(),
    )
    .map_err(|e| format!("{}: {}", e.code, e.message))?;
    if change.operation.as_deref() == Some("delete") {
        let id = change
            .target_id
            .as_deref()
            .ok_or("RULE_SET_SCOPE_MISMATCH: 删除目标缺失")?;
        if change.target_type != "rule_system" {
            return Err("RULE_CHANGE_INPUT_INVALID: 未开放此删除类型".to_string());
        }
        world_setting_repository::delete_rule_system(&transaction, id)?;
        let id = id.to_string();
        expire_changed_rule_reviews(&transaction, novel_id, expected_fingerprint)?;
        transaction.commit().map_err(|e| e.to_string())?;
        return Ok(id);
    }
    let now = chrono::Utc::now().to_rfc3339();
    let target_id = change
        .target_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    match (change.target_type.as_str(), change.target_id.is_some()) {
        ("world_setting", true) => world_setting_repository::update_world_setting(
            &transaction,
            &target_id,
            &change.title,
            &change.content,
            change.is_active,
            &now,
        )?,
        ("world_setting", false) => world_setting_repository::insert_world_setting(
            &transaction,
            &target_id,
            novel_id,
            &change.title,
            &change.content,
            change.is_active,
            &now,
        )?,
        ("rule_system", true) => world_setting_repository::update_rule_system(
            &transaction,
            &target_id,
            &change.title,
            change.category.as_deref(),
            &change.content,
            change.forbidden_rules.as_deref(),
            change.is_active,
            &now,
        )?,
        ("rule_system", false) => world_setting_repository::insert_rule_system(
            &transaction,
            &target_id,
            novel_id,
            &change.title,
            change.category.as_deref(),
            &change.content,
            change.forbidden_rules.as_deref(),
            change.is_active,
            &now,
        )?,
        _ => return Err("RULE_CHANGE_INPUT_INVALID: 未知目标类型".to_string()),
    }
    let sql = if change.target_type == "world_setting" {
        "UPDATE world_settings SET structured_json=?1 WHERE id=?2 AND novel_id=?3"
    } else {
        "UPDATE rule_systems SET structured_json=?1 WHERE id=?2 AND novel_id=?3"
    };
    let affected = transaction
        .execute(sql, params![change.structured_json, target_id, novel_id])
        .map_err(|e| e.to_string())?;
    if affected != 1 {
        return Err("RULE_SET_SCOPE_MISMATCH: 结构化写入目标失效".to_string());
    }
    expire_changed_rule_reviews(&transaction, novel_id, expected_fingerprint)?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(target_id)
}

// ==================== World Setting ====================

pub fn list_world_settings_by_novel(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<WorldSettingDto>, String> {
    world_setting_repository::find_world_settings_by_novel(conn, novel_id)
}

#[allow(dead_code)]
pub fn get_world_setting(conn: &Connection, id: &str) -> Result<Option<WorldSettingDto>, String> {
    world_setting_repository::find_world_setting_by_id(conn, id)
}

pub fn save_world_setting(
    conn: &Connection,
    id: Option<String>,
    input: SaveWorldSettingInput,
) -> Result<WorldSettingDto, String> {
    let target_id = save_governed_change(
        conn,
        &input.novel_id,
        RuleChange {
            operation: None,
            target_type: "world_setting".to_string(),
            target_id: id,
            title: input.title,
            content: input.content,
            category: None,
            forbidden_rules: None,
            structured_json: input.structured_json,
            is_active: input.is_active,
        },
        input.expected_updated_at.as_deref(),
        input.expected_rule_set_fingerprint.as_deref(),
        input.change_authorization.as_ref(),
    )?;
    world_setting_repository::find_world_setting_by_id(conn, &target_id)?
        .ok_or_else(|| "无法读取保存后的世界观设定".to_string())
}

// ==================== Rule System ====================

pub fn list_rule_systems_by_novel(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<RuleSystemDto>, String> {
    world_setting_repository::find_rule_systems_by_novel(conn, novel_id)
}

#[allow(dead_code)]
pub fn get_rule_system(conn: &Connection, id: &str) -> Result<Option<RuleSystemDto>, String> {
    world_setting_repository::find_rule_system_by_id(conn, id)
}

pub fn save_rule_system(
    conn: &Connection,
    id: Option<String>,
    input: SaveRuleSystemInput,
) -> Result<RuleSystemDto, String> {
    let target_id = save_governed_change(
        conn,
        &input.novel_id,
        RuleChange {
            operation: None,
            target_type: "rule_system".to_string(),
            target_id: id,
            title: input.title,
            content: input.content,
            category: input.category,
            forbidden_rules: input.forbidden_rules,
            structured_json: input.structured_json,
            is_active: input.is_active,
        },
        input.expected_updated_at.as_deref(),
        input.expected_rule_set_fingerprint.as_deref(),
        input.change_authorization.as_ref(),
    )?;
    world_setting_repository::find_rule_system_by_id(conn, &target_id)?
        .ok_or_else(|| "无法读取保存后的规则系统".to_string())
}

pub fn delete_rule_system(
    conn: &Connection,
    id: &str,
    input: Option<DeleteRuleSystemInput>,
) -> Result<(), String> {
    let input = input.ok_or(
        "RULE_CHANGE_CONFIRMATION_REQUIRED: 请先预览并明确确认永久删除；建议停用以保留来源",
    )?;
    let row = world_setting_repository::find_rule_system_by_id(conn, id)?
        .ok_or("RULE_SET_SCOPE_MISMATCH")?;
    save_governed_change(
        conn,
        &input.novel_id,
        RuleChange {
            operation: Some("delete".to_string()),
            target_type: "rule_system".to_string(),
            target_id: Some(id.to_string()),
            title: row.title,
            content: row.content,
            category: row.category,
            forbidden_rules: row.forbidden_rules,
            structured_json: row.structured_json,
            is_active: row.is_active,
        },
        input.expected_updated_at.as_deref(),
        input.expected_rule_set_fingerprint.as_deref(),
        input.change_authorization.as_ref(),
    )?;
    Ok(())
}

// ==================== Protagonist ====================

pub fn get_protagonist_by_novel(
    conn: &Connection,
    novel_id: &str,
) -> Result<Option<ProtagonistDto>, String> {
    world_setting_repository::find_protagonist_by_novel(conn, novel_id)
}

pub fn save_protagonist(
    conn: &Connection,
    id: Option<String>,
    input: SaveProtagonistInput,
) -> Result<ProtagonistDto, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let target_id = match id {
        Some(existing_id) => {
            world_setting_repository::update_protagonist(
                conn,
                &existing_id,
                &input.name,
                input.identity.as_deref(),
                input.personality.as_deref(),
                input.goal.as_deref(),
                input.special_ability.as_deref(),
                input.ability_limits.as_deref(),
                input.forbidden_behaviors.as_deref(),
                input.current_state.as_deref(),
                &now,
            )?;
            existing_id
        }
        None => {
            let new_id = uuid::Uuid::new_v4().to_string();
            world_setting_repository::insert_protagonist(
                conn,
                &new_id,
                &input.novel_id,
                &input.name,
                input.identity.as_deref(),
                input.personality.as_deref(),
                input.goal.as_deref(),
                input.special_ability.as_deref(),
                input.ability_limits.as_deref(),
                input.forbidden_behaviors.as_deref(),
                input.current_state.as_deref(),
                &now,
            )?;
            new_id
        }
    };

    world_setting_repository::find_protagonist_by_id(conn, &target_id)?
        .ok_or_else(|| "无法读取保存后的主角设定".to_string())
}

#[cfg(test)]
#[path = "world_setting_service_tests.rs"]
mod tests;
