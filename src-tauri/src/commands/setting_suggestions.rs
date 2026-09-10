//! 设定建议候选：桌面端以 SQLite `setting_suggestions` 为唯一事实源（migration 037，审计 GAP-15）。
//!
//! 候选只能从 `pending` 一次性推进到 `adopted / edited_adopted / discarded`；采纳目标写入由
//! 前端既有 `adoptTarget` 链路完成，这里只负责候选事实本身与作品归属复验。
use crate::db::get_connection;
use rusqlite::{params, Connection, OptionalExtension, Row, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const SETTING_SUGGESTION_INVALID: &str = "SETTING_SUGGESTION_INVALID";
pub const SETTING_SUGGESTION_ALREADY_DECIDED: &str = "SETTING_SUGGESTION_ALREADY_DECIDED";

const SUGGESTION_TYPES: &[&str] = &["character", "faction", "location", "rule"];
const DECIDED_STATUSES: &[&str] = &["adopted", "edited_adopted", "discarded"];
const TARGET_TYPES: &[&str] = &["character", "world_setting", "rule_system"];
const MAX_BATCH: usize = 50;
const MAX_TEXT_CHARS: usize = 200_000;

fn invalid(detail: &str) -> String {
    format!("{SETTING_SUGGESTION_INVALID}: {detail}")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingSuggestionDto {
    pub id: String,
    pub novel_id: String,
    pub suggestion_type: String,
    pub world_type: String,
    pub reference_style: String,
    pub prompt: String,
    pub result_json: String,
    pub item: Map<String, Value>,
    pub status: String,
    pub adopted_target_id: Option<String>,
    pub adopted_target_type: Option<String>,
    pub user_instruction: Option<String>,
    pub raw_output: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSettingSuggestionInput {
    /// 传入既有 id 表示幂等 upsert（用于 LocalStorage → SQLite 迁移）。
    pub id: Option<String>,
    pub novel_id: String,
    pub suggestion_type: String,
    pub world_type: Option<String>,
    pub reference_style: Option<String>,
    pub prompt: Option<String>,
    pub result_json: Option<String>,
    pub item: Map<String, Value>,
    pub status: Option<String>,
    pub adopted_target_id: Option<String>,
    pub adopted_target_type: Option<String>,
    pub user_instruction: Option<String>,
    pub raw_output: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecideSettingSuggestionInput {
    pub id: String,
    pub status: String,
    pub item: Option<Map<String, Value>>,
    pub adopted_target_id: Option<String>,
    pub adopted_target_type: Option<String>,
}

const SELECT_SUGGESTION: &str =
    "SELECT id, novel_id, suggestion_type, world_type, reference_style, prompt, result_json,
            item_json, status, adopted_target_id, adopted_target_type, user_instruction,
            raw_output, created_at, updated_at
       FROM setting_suggestions";

fn map_row(row: &Row<'_>) -> rusqlite::Result<SettingSuggestionDto> {
    let item_json: String = row.get(7)?;
    let item = serde_json::from_str::<Map<String, Value>>(&item_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(SettingSuggestionDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        suggestion_type: row.get(2)?,
        world_type: row.get(3)?,
        reference_style: row.get(4)?,
        prompt: row.get(5)?,
        result_json: row.get(6)?,
        item,
        status: row.get(8)?,
        adopted_target_id: row.get(9)?,
        adopted_target_type: row.get(10)?,
        user_instruction: row.get(11)?,
        raw_output: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn optional_trimmed(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn bounded(value: &str, label: &str) -> Result<(), String> {
    if value.chars().count() > MAX_TEXT_CHARS {
        return Err(invalid(&format!("{label}超过单条上限")));
    }
    Ok(())
}

/// 候选载荷只允许字符串值，与前端 `normalizePayload` 一致。
fn normalize_item(item: Map<String, Value>) -> Result<Map<String, Value>, String> {
    let mut normalized = Map::new();
    for (key, value) in item {
        let key = key.trim().to_string();
        if key.is_empty() {
            continue;
        }
        let text = match value {
            Value::String(text) => text,
            Value::Null => continue,
            other => other.to_string(),
        };
        bounded(&text, "候选字段")?;
        normalized.insert(key, Value::String(text));
    }
    if normalized.is_empty() {
        return Err(invalid("候选内容为空"));
    }
    Ok(normalized)
}

fn ensure_novel(connection: &Connection, novel_id: &str) -> Result<(), String> {
    let count = connection
        .query_row(
            "SELECT COUNT(*) FROM novels WHERE id = ?1 AND deleted_at IS NULL",
            params![novel_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    if count == 0 {
        return Err(invalid("作品不存在或已删除"));
    }
    Ok(())
}

fn validate_decision(
    status: &str,
    target_type: Option<&str>,
    target_id: Option<&str>,
) -> Result<(), String> {
    if !DECIDED_STATUSES.contains(&status) {
        return Err(invalid("决定状态非法"));
    }
    if let Some(target_type) = target_type {
        if !TARGET_TYPES.contains(&target_type) {
            return Err(invalid("采纳目标类型非法"));
        }
    }
    if status == "discarded" && (target_type.is_some() || target_id.is_some()) {
        return Err(invalid("放弃的候选不能携带采纳目标"));
    }
    if status != "discarded" && (target_type.is_none() || target_id.is_none()) {
        return Err(invalid("采纳的候选必须记录目标类型与目标 id"));
    }
    Ok(())
}

pub fn list_setting_suggestions_with(
    connection: &Connection,
    novel_id: &str,
) -> Result<Vec<SettingSuggestionDto>, String> {
    let mut statement = connection
        .prepare(&format!(
            "{SELECT_SUGGESTION} WHERE novel_id = ?1 ORDER BY created_at DESC, id DESC"
        ))
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![novel_id], map_row)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(rows)
}

pub fn get_setting_suggestion_with(
    connection: &Connection,
    id: &str,
) -> Result<Option<SettingSuggestionDto>, String> {
    connection
        .query_row(
            &format!("{SELECT_SUGGESTION} WHERE id = ?1"),
            params![id],
            map_row,
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn save_one(
    connection: &Connection,
    input: SaveSettingSuggestionInput,
) -> Result<SettingSuggestionDto, String> {
    if !SUGGESTION_TYPES.contains(&input.suggestion_type.as_str()) {
        return Err(invalid("建议类型非法"));
    }
    ensure_novel(connection, &input.novel_id)?;
    let status = input.status.unwrap_or_else(|| "pending".to_string());
    let target_type = optional_trimmed(input.adopted_target_type);
    let target_id = optional_trimmed(input.adopted_target_id);
    if status != "pending" {
        validate_decision(&status, target_type.as_deref(), target_id.as_deref())?;
    } else if target_type.is_some() || target_id.is_some() {
        return Err(invalid("待处理候选不能携带采纳目标"));
    }
    let item = normalize_item(input.item)?;
    let item_json = serde_json::to_string(&item).map_err(|error| error.to_string())?;
    let prompt = input.prompt.unwrap_or_default();
    bounded(&prompt, "提示词快照")?;
    let result_json = input.result_json.unwrap_or_else(|| item_json.clone());
    bounded(&result_json, "结果 JSON")?;
    let raw_output = input.raw_output;
    if let Some(raw_output) = raw_output.as_deref() {
        bounded(raw_output, "原始输出")?;
    }
    let now = chrono::Utc::now().to_rfc3339();
    let id = optional_trimmed(input.id).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let created_at = optional_trimmed(input.created_at).unwrap_or_else(|| now.clone());
    let updated_at = optional_trimmed(input.updated_at).unwrap_or_else(|| created_at.clone());
    connection
        .execute(
            "INSERT INTO setting_suggestions
                (id, novel_id, suggestion_type, world_type, reference_style, prompt, result_json,
                 item_json, status, adopted_target_id, adopted_target_type, user_instruction,
                 raw_output, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT(id) DO NOTHING",
            params![
                id,
                input.novel_id,
                input.suggestion_type,
                input.world_type.unwrap_or_default(),
                input.reference_style.unwrap_or_default(),
                prompt,
                result_json,
                item_json,
                status,
                target_id,
                target_type,
                optional_trimmed(input.user_instruction),
                raw_output,
                created_at,
                updated_at,
            ],
        )
        .map_err(|error| format!("设定建议保存失败: {error}"))?;
    get_setting_suggestion_with(connection, &id)?
        .ok_or_else(|| "设定建议保存后无法读取".to_string())
}

/// 一次生成的多条候选在同一事务内落库，任一条非法则整批回滚。
pub fn save_setting_suggestions_with(
    connection: &mut Connection,
    inputs: Vec<SaveSettingSuggestionInput>,
) -> Result<Vec<SettingSuggestionDto>, String> {
    if inputs.is_empty() {
        return Err(invalid("没有可保存的候选"));
    }
    if inputs.len() > MAX_BATCH {
        return Err(invalid("单次保存的候选数量超过上限"));
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let mut saved = Vec::with_capacity(inputs.len());
    for input in inputs {
        saved.push(save_one(&transaction, input)?);
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(saved)
}

pub fn decide_setting_suggestion_with(
    connection: &Connection,
    input: DecideSettingSuggestionInput,
) -> Result<SettingSuggestionDto, String> {
    let existing = get_setting_suggestion_with(connection, &input.id)?
        .ok_or_else(|| invalid("候选记录不存在"))?;
    if existing.status != "pending" {
        return Err(format!(
            "{SETTING_SUGGESTION_ALREADY_DECIDED}: 该候选已处理"
        ));
    }
    let target_type = optional_trimmed(input.adopted_target_type);
    let target_id = optional_trimmed(input.adopted_target_id);
    validate_decision(&input.status, target_type.as_deref(), target_id.as_deref())?;
    if input.status == "adopted" && input.item.is_some() {
        return Err(invalid("未编辑的采纳不能替换候选内容"));
    }
    let item = match input.item {
        Some(item) => normalize_item(item)?,
        None => existing.item.clone(),
    };
    let item_json = serde_json::to_string(&item).map_err(|error| error.to_string())?;
    let affected = connection
        .execute(
            "UPDATE setting_suggestions
             SET item_json = ?1, status = ?2, adopted_target_id = ?3, adopted_target_type = ?4,
                 updated_at = ?5
             WHERE id = ?6 AND status = 'pending'",
            params![
                item_json,
                input.status,
                target_id,
                target_type,
                chrono::Utc::now().to_rfc3339(),
                input.id,
            ],
        )
        .map_err(|error| format!("设定建议更新失败: {error}"))?;
    if affected != 1 {
        return Err(format!(
            "{SETTING_SUGGESTION_ALREADY_DECIDED}: 该候选已处理"
        ));
    }
    get_setting_suggestion_with(connection, &input.id)?
        .ok_or_else(|| "设定建议更新后无法读取".to_string())
}

#[tauri::command]
pub fn list_setting_suggestions(novel_id: String) -> Result<Vec<SettingSuggestionDto>, String> {
    let connection = get_connection().lock().map_err(|error| error.to_string())?;
    list_setting_suggestions_with(&connection, &novel_id)
}

#[tauri::command]
pub fn get_setting_suggestion(
    suggestion_id: String,
) -> Result<Option<SettingSuggestionDto>, String> {
    let connection = get_connection().lock().map_err(|error| error.to_string())?;
    get_setting_suggestion_with(&connection, &suggestion_id)
}

#[tauri::command]
pub fn save_setting_suggestions(
    inputs: Vec<SaveSettingSuggestionInput>,
) -> Result<Vec<SettingSuggestionDto>, String> {
    let mut connection = get_connection().lock().map_err(|error| error.to_string())?;
    save_setting_suggestions_with(&mut connection, inputs)
}

#[tauri::command]
pub fn decide_setting_suggestion(
    input: DecideSettingSuggestionInput,
) -> Result<SettingSuggestionDto, String> {
    let connection = get_connection().lock().map_err(|error| error.to_string())?;
    decide_setting_suggestion_with(&connection, input)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const NOVEL: &str = "20000000-0000-4000-8000-000000000001";

    fn connection() -> Connection {
        let mut connection = Connection::open_in_memory().expect("connection");
        connection
            .execute_batch("PRAGMA foreign_keys=ON;")
            .expect("foreign keys");
        crate::db::create_tables(&mut connection).expect("schema");
        connection
            .execute(
                "INSERT INTO novels (id, title, outline, created_at, updated_at) VALUES (?1, 'n', '', ?2, ?2)",
                params![NOVEL, "2026-09-08T00:00:00Z"],
            )
            .expect("novel");
        connection
    }

    fn input(name: &str) -> SaveSettingSuggestionInput {
        let mut item = Map::new();
        item.insert("name".to_string(), json!(name));
        item.insert("description".to_string(), json!({"nested": true}));
        SaveSettingSuggestionInput {
            id: None,
            novel_id: NOVEL.to_string(),
            suggestion_type: "character".to_string(),
            world_type: Some("修仙".to_string()),
            reference_style: Some("热血".to_string()),
            prompt: Some("prompt".to_string()),
            result_json: None,
            item,
            status: None,
            adopted_target_id: None,
            adopted_target_type: None,
            user_instruction: None,
            raw_output: Some("raw".to_string()),
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn saves_a_batch_atomically_and_decides_once() {
        let mut connection = connection();
        let saved =
            save_setting_suggestions_with(&mut connection, vec![input("甲"), input("乙")]).unwrap();
        assert_eq!(saved.len(), 2);
        assert_eq!(saved[0].item["description"], json!("{\"nested\":true}"));
        assert_eq!(saved[0].status, "pending");
        assert_eq!(
            list_setting_suggestions_with(&connection, NOVEL)
                .unwrap()
                .len(),
            2
        );

        let adopted = decide_setting_suggestion_with(
            &connection,
            DecideSettingSuggestionInput {
                id: saved[0].id.clone(),
                status: "edited_adopted".to_string(),
                item: Some(Map::from_iter([("name".to_string(), json!("甲·改"))])),
                adopted_target_id: Some("character-1".to_string()),
                adopted_target_type: Some("character".to_string()),
            },
        )
        .unwrap();
        assert_eq!(adopted.status, "edited_adopted");
        assert_eq!(adopted.item["name"], json!("甲·改"));
        assert_eq!(adopted.adopted_target_id.as_deref(), Some("character-1"));

        let again = decide_setting_suggestion_with(
            &connection,
            DecideSettingSuggestionInput {
                id: saved[0].id.clone(),
                status: "discarded".to_string(),
                item: None,
                adopted_target_id: None,
                adopted_target_type: None,
            },
        )
        .unwrap_err();
        assert!(
            again.starts_with(SETTING_SUGGESTION_ALREADY_DECIDED),
            "{again}"
        );

        let discarded = decide_setting_suggestion_with(
            &connection,
            DecideSettingSuggestionInput {
                id: saved[1].id.clone(),
                status: "discarded".to_string(),
                item: None,
                adopted_target_id: None,
                adopted_target_type: None,
            },
        )
        .unwrap();
        assert_eq!(discarded.status, "discarded");

        // The trigger is the last line of defence even for direct SQL.
        let direct = connection.execute(
            "UPDATE setting_suggestions SET status = 'pending' WHERE id = ?1",
            params![saved[1].id],
        );
        assert!(direct.is_err(), "decided suggestions must not reopen");
    }

    #[test]
    fn rejects_invalid_batches_without_partial_writes() {
        let mut connection = connection();
        let mut bad_type = input("丙");
        bad_type.suggestion_type = "weapon".to_string();
        let error = save_setting_suggestions_with(&mut connection, vec![input("甲"), bad_type])
            .unwrap_err();
        assert!(error.starts_with(SETTING_SUGGESTION_INVALID), "{error}");
        assert!(list_setting_suggestions_with(&connection, NOVEL)
            .unwrap()
            .is_empty());

        let mut foreign = input("丁");
        foreign.novel_id = "missing-novel".to_string();
        assert!(
            save_setting_suggestions_with(&mut connection, vec![foreign])
                .unwrap_err()
                .starts_with(SETTING_SUGGESTION_INVALID)
        );

        let saved = save_setting_suggestions_with(&mut connection, vec![input("戊")]).unwrap();
        let missing_target = decide_setting_suggestion_with(
            &connection,
            DecideSettingSuggestionInput {
                id: saved[0].id.clone(),
                status: "adopted".to_string(),
                item: None,
                adopted_target_id: None,
                adopted_target_type: Some("character".to_string()),
            },
        )
        .unwrap_err();
        assert!(
            missing_target.starts_with(SETTING_SUGGESTION_INVALID),
            "{missing_target}"
        );
        assert_eq!(
            get_setting_suggestion_with(&connection, &saved[0].id)
                .unwrap()
                .unwrap()
                .status,
            "pending"
        );
    }
}
