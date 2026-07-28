use crate::errors::{codes, AppError};
use crate::services::ai_fact_security;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

const MAX_TARGETS: usize = 500;
const MAX_TEXT: usize = 100_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareContentTransactionInput {
    pub operation_id: String,
    pub novel_id: String,
    pub strategy: String,
    pub targets: Vec<PrepareContentTargetInput>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareContentTargetInput {
    pub target_type: String,
    pub target_id: String,
    pub effect_type: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyContentTransactionInput {
    pub transaction_id: String,
    pub operation_id: String,
    pub expected_transaction_hash: String,
    #[serde(default)]
    pub approved_targets: Vec<ApprovedContentTarget>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct ApprovedContentTarget {
    pub target_type: String,
    pub target_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentTransactionTargetDto {
    pub ordinal: i64,
    pub target_type: String,
    pub target_id: String,
    pub effect_type: String,
    pub base_revision: i64,
    pub base_hash: String,
    pub candidate_payload: Value,
    pub candidate_hash: String,
    pub applied_revision: Option<i64>,
    pub applied_hash: Option<String>,
    pub applied_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentTransactionDto {
    pub transaction_id: String,
    pub operation_id: String,
    pub request_hash: String,
    pub novel_id: String,
    pub strategy: String,
    pub target_set: Value,
    pub target_set_hash: String,
    pub transaction_hash: String,
    pub status: String,
    pub revision: i64,
    pub result: Option<Value>,
    pub created_at: String,
    pub applied_at: Option<String>,
    pub targets: Vec<ContentTransactionTargetDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyContentTransactionResult {
    pub transaction: ContentTransactionDto,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FactionDto {
    pub id: String,
    pub novel_id: String,
    pub name: String,
    pub kind: Option<String>,
    pub description: String,
    pub goals: String,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationDto {
    pub id: String,
    pub novel_id: String,
    pub name: String,
    pub kind: Option<String>,
    pub description: String,
    pub parent_location_id: Option<String>,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone)]
struct TargetSnapshot {
    version: i64,
    hash: String,
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::new(codes::CONTENT_TRANSACTION_INPUT_INVALID, message, false)
}

fn scope_error(message: impl Into<String>) -> AppError {
    AppError::new(codes::CONTENT_ASSET_SCOPE_MISMATCH, message, false)
}

fn bounded_id(value: &str, label: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 240 {
        return Err(invalid(format!("{label} 无效")));
    }
    Ok(value.to_string())
}

fn text_field(
    object: &Map<String, Value>,
    key: &str,
    required: bool,
    max: usize,
) -> Result<Option<String>, AppError> {
    let value = object.get(key).and_then(Value::as_str).map(str::trim);
    if required && value.unwrap_or_default().is_empty() {
        return Err(invalid(format!("payload.{key} 不能为空")));
    }
    if value.map(str::chars).map(Iterator::count).unwrap_or(0) > max {
        return Err(invalid(format!("payload.{key} 超过长度限制")));
    }
    if let Some(value) = value.filter(|value| !value.is_empty()) {
        ai_fact_security::validate_body(value, key)?;
        Ok(Some(value.to_string()))
    } else {
        Ok(None)
    }
}

fn normalize_payload(target_type: &str, payload: &Value) -> Result<Value, AppError> {
    ai_fact_security::validate_metadata(payload, "多目标候选")?;
    let object = payload
        .as_object()
        .ok_or_else(|| invalid("候选 payload 必须是对象"))?;
    let optional = |key: &str, max| text_field(object, key, false, max);
    let required = |key: &str, max| text_field(object, key, true, max);
    let value = match target_type {
        "faction" => json!({
            "name": required("name", 240)?,
            "kind": optional("kind", 120)?,
            "description": optional("description", MAX_TEXT)?.unwrap_or_default(),
            "goals": optional("goals", 50_000)?.unwrap_or_default(),
        }),
        "location" => json!({
            "name": required("name", 240)?,
            "kind": optional("kind", 120)?,
            "description": optional("description", MAX_TEXT)?.unwrap_or_default(),
            "parentLocationId": optional("parentLocationId", 200)?,
        }),
        "faction_relation" => json!({
            "sourceFactionId": required("sourceFactionId", 200)?,
            "targetFactionId": required("targetFactionId", 200)?,
            "relationType": required("relationType", 120)?,
            "description": optional("description", 50_000)?.unwrap_or_default(),
        }),
        "location_link" => json!({
            "sourceLocationId": required("sourceLocationId", 200)?,
            "targetLocationId": required("targetLocationId", 200)?,
            "linkType": required("linkType", 120)?,
            "description": optional("description", 50_000)?.unwrap_or_default(),
        }),
        "character_faction" => json!({
            "characterId": required("characterId", 200)?,
            "factionId": required("factionId", 200)?,
            "role": optional("role", 240)?.unwrap_or_default(),
        }),
        "chapter_faction" => json!({
            "chapterId": required("chapterId", 200)?,
            "factionId": required("factionId", 200)?,
            "role": optional("role", 240)?.unwrap_or_default(),
        }),
        "chapter_location" => json!({
            "chapterId": required("chapterId", 200)?,
            "locationId": required("locationId", 200)?,
            "role": optional("role", 240)?.unwrap_or_default(),
        }),
        "chapter_event_faction" => json!({
            "chapterEventId": required("chapterEventId", 200)?,
            "factionId": required("factionId", 200)?,
            "role": optional("role", 240)?.unwrap_or_default(),
        }),
        "chapter_event_location" => json!({
            "chapterEventId": required("chapterEventId", 200)?,
            "locationId": required("locationId", 200)?,
            "role": optional("role", 240)?.unwrap_or_default(),
        }),
        "chapter_metadata" => {
            let title = optional("title", 500)?;
            let outline = optional("outline", MAX_TEXT)?;
            let goal = optional("goal", 50_000)?;
            let status = optional("status", 80)?;
            if title.is_none() && outline.is_none() && goal.is_none() && status.is_none() {
                return Err(invalid("章节元数据候选没有任何变更字段"));
            }
            if let Some(status) = status.as_deref() {
                if !matches!(
                    status,
                    "not_started" | "outline_ready" | "editing" | "polished"
                ) {
                    return Err(invalid("章节元数据状态不允许自动采用或总结"));
                }
            }
            json!({"title": title, "outline": outline, "goal": goal, "status": status})
        }
        _ => return Err(invalid("不支持的目标类型")),
    };
    Ok(value)
}

fn absent_snapshot(target_type: &str, target_id: &str) -> Result<TargetSnapshot, AppError> {
    Ok(TargetSnapshot {
        version: 0,
        hash: ai_fact_security::canonical_hash(&json!({
            "exists": false, "targetType": target_type, "targetId": target_id, "version": 0
        }))?,
    })
}

fn row_json_snapshot(
    target_type: &str,
    target_id: &str,
    novel_id: &str,
    revision: i64,
    fields: Value,
) -> Result<TargetSnapshot, AppError> {
    Ok(TargetSnapshot {
        version: revision,
        hash: ai_fact_security::canonical_hash(&json!({
            "exists": true, "targetType": target_type, "targetId": target_id,
            "novelId": novel_id, "version": revision, "fields": fields
        }))?,
    })
}

fn read_formal_target(
    connection: &Connection,
    target_type: &str,
    target_id: &str,
    expected_novel_id: &str,
) -> Result<Option<TargetSnapshot>, AppError> {
    let query = match target_type {
        "faction" => "SELECT novel_id, revision, json_object('name',name,'kind',kind,'description',description,'goals',goals) FROM factions WHERE id=?1",
        "location" => "SELECT novel_id, revision, json_object('name',name,'kind',kind,'description',description,'parentLocationId',parent_location_id) FROM locations WHERE id=?1",
        "faction_relation" => "SELECT novel_id, revision, json_object('sourceFactionId',source_faction_id,'targetFactionId',target_faction_id,'relationType',relation_type,'description',description) FROM faction_relations WHERE id=?1",
        "location_link" => "SELECT novel_id, revision, json_object('sourceLocationId',source_location_id,'targetLocationId',target_location_id,'linkType',link_type,'description',description) FROM location_links WHERE id=?1",
        "character_faction" => "SELECT novel_id, revision, json_object('characterId',character_id,'factionId',faction_id,'role',role) FROM character_factions WHERE id=?1",
        "chapter_faction" => "SELECT novel_id, revision, json_object('chapterId',chapter_id,'factionId',faction_id,'role',role) FROM chapter_factions WHERE id=?1",
        "chapter_location" => "SELECT novel_id, revision, json_object('chapterId',chapter_id,'locationId',location_id,'role',role) FROM chapter_locations WHERE id=?1",
        "chapter_event_faction" => "SELECT novel_id, revision, json_object('chapterEventId',chapter_event_id,'factionId',faction_id,'role',role) FROM chapter_event_factions WHERE id=?1",
        "chapter_event_location" => "SELECT novel_id, revision, json_object('chapterEventId',chapter_event_id,'locationId',location_id,'role',role) FROM chapter_event_locations WHERE id=?1",
        _ => return Ok(None),
    };
    let row = connection
        .query_row(query, [target_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .optional()
        .map_err(AppError::database)?;
    let Some((novel_id, revision, fields_json)) = row else {
        return Ok(None);
    };
    if novel_id != expected_novel_id {
        return Err(scope_error("正式资产属于其他作品"));
    }
    let fields: Value =
        serde_json::from_str(&fields_json).map_err(|_| invalid("正式资产 JSON 无效"))?;
    row_json_snapshot(target_type, target_id, &novel_id, revision, fields).map(Some)
}

fn read_chapter_snapshot(
    connection: &Connection,
    target_id: &str,
    expected_novel_id: &str,
) -> Result<Option<TargetSnapshot>, AppError> {
    let row = connection
        .query_row(
            "SELECT novel_id,title,outline,goal,status FROM chapters WHERE id=?1 AND deleted_at IS NULL",
            [target_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?, row.get::<_, Option<String>>(3)?, row.get::<_, String>(4)?)),
        )
        .optional()
        .map_err(AppError::database)?;
    let Some((novel_id, title, outline, goal, status)) = row else {
        return Ok(None);
    };
    if novel_id != expected_novel_id {
        return Err(scope_error("章节属于其他作品"));
    }
    let fields = json!({"title": title, "outline": outline, "goal": goal, "status": status});
    let semantic_hash = ai_fact_security::canonical_hash(&fields)?;
    let revision = connection.query_row(
        "SELECT revision FROM content_target_revisions WHERE target_type='chapter_metadata' AND target_id=?1 AND novel_id=?2 AND content_hash=?3",
        params![target_id, expected_novel_id, semantic_hash], |row| row.get::<_, i64>(0)
    ).optional().map_err(AppError::database)?.unwrap_or(1);
    row_json_snapshot("chapter_metadata", target_id, &novel_id, revision, fields).map(Some)
}

fn read_target(
    connection: &Connection,
    target_type: &str,
    target_id: &str,
    novel_id: &str,
) -> Result<Option<TargetSnapshot>, AppError> {
    if target_type == "chapter_metadata" {
        read_chapter_snapshot(connection, target_id, novel_id)
    } else {
        read_formal_target(connection, target_type, target_id, novel_id)
    }
}

fn target_row(row: &Row<'_>) -> rusqlite::Result<ContentTransactionTargetDto> {
    let payload: String = row.get(6)?;
    Ok(ContentTransactionTargetDto {
        ordinal: row.get(0)?,
        target_type: row.get(1)?,
        target_id: row.get(2)?,
        effect_type: row.get(3)?,
        base_revision: row.get(4)?,
        base_hash: row.get(5)?,
        candidate_payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
        candidate_hash: row.get(7)?,
        applied_revision: row.get(8)?,
        applied_hash: row.get(9)?,
        applied_at: row.get(10)?,
    })
}

fn load_transaction(
    connection: &Connection,
    id: &str,
) -> Result<Option<ContentTransactionDto>, AppError> {
    let base = connection.query_row(
        "SELECT transaction_id,operation_id,request_hash,novel_id,strategy,target_set_json,target_set_hash,transaction_hash,status,revision,result_json,created_at,applied_at FROM content_transactions WHERE transaction_id=?1",
        [id], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?,row.get::<_,String>(4)?,row.get::<_,String>(5)?,row.get::<_,String>(6)?,row.get::<_,String>(7)?,row.get::<_,String>(8)?,row.get::<_,i64>(9)?,row.get::<_,Option<String>>(10)?,row.get::<_,String>(11)?,row.get::<_,Option<String>>(12)?))
    ).optional().map_err(AppError::database)?;
    let Some(base) = base else {
        return Ok(None);
    };
    let mut stmt = connection.prepare("SELECT ordinal,target_type,target_id,effect_type,base_revision,base_hash,candidate_payload_json,candidate_hash,applied_revision,applied_hash,applied_at FROM content_transaction_targets WHERE transaction_id=?1 ORDER BY ordinal").map_err(AppError::database)?;
    let targets = stmt
        .query_map([id], target_row)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(Some(ContentTransactionDto {
        transaction_id: base.0,
        operation_id: base.1,
        request_hash: base.2,
        novel_id: base.3,
        strategy: base.4,
        target_set: serde_json::from_str(&base.5).unwrap_or(Value::Null),
        target_set_hash: base.6,
        transaction_hash: base.7,
        status: base.8,
        revision: base.9,
        result: base.10.and_then(|s| serde_json::from_str(&s).ok()),
        created_at: base.11,
        applied_at: base.12,
        targets,
    }))
}

pub fn get_transaction(
    connection: &Connection,
    id: &str,
) -> Result<Option<ContentTransactionDto>, AppError> {
    load_transaction(connection, id)
}

pub fn list_transactions(
    connection: &Connection,
    novel_id: &str,
    limit: i64,
) -> Result<Vec<ContentTransactionDto>, AppError> {
    let mut stmt=connection.prepare("SELECT transaction_id FROM content_transactions WHERE novel_id=?1 ORDER BY created_at DESC,transaction_id DESC LIMIT ?2").map_err(AppError::database)?;
    let ids = stmt
        .query_map(params![novel_id, limit.clamp(1, 200)], |r| {
            r.get::<_, String>(0)
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    ids.into_iter()
        .map(|id| load_transaction(connection, &id)?.ok_or_else(|| invalid("事务读取失败")))
        .collect()
}

fn validate_novel(connection: &Connection, novel_id: &str) -> Result<(), AppError> {
    let exists = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM novels WHERE id=?1 AND deleted_at IS NULL)",
            [novel_id],
            |r| r.get::<_, bool>(0),
        )
        .map_err(AppError::database)?;
    if !exists {
        return Err(AppError::new(
            codes::TARGET_NOVEL_NOT_FOUND,
            "作品不存在",
            false,
        ));
    }
    Ok(())
}

pub fn prepare_transaction(
    connection: &mut Connection,
    input: PrepareContentTransactionInput,
) -> Result<ContentTransactionDto, AppError> {
    let operation_id = bounded_id(&input.operation_id, "operationId")?;
    let novel_id = bounded_id(&input.novel_id, "novelId")?;
    if !matches!(
        input.strategy.as_str(),
        "all_or_nothing" | "reviewed_partial"
    ) {
        return Err(invalid("事务策略无效"));
    }
    if input.targets.is_empty() || input.targets.len() > MAX_TARGETS {
        return Err(invalid("目标数量必须在 1 到 500 之间"));
    }
    validate_novel(connection, &novel_id)?;
    let mut seen = HashSet::new();
    let mut normalized = Vec::with_capacity(input.targets.len());
    for target in input.targets {
        let target_id = bounded_id(&target.target_id, "targetId")?;
        if !matches!(target.effect_type.as_str(), "create" | "update") {
            return Err(invalid("effectType 无效"));
        }
        if !seen.insert((target.target_type.clone(), target_id.clone())) {
            return Err(invalid("目标集合存在重复身份"));
        }
        let payload = normalize_payload(&target.target_type, &target.payload)?;
        normalized.push(PrepareContentTargetInput {
            target_type: target.target_type,
            target_id,
            effect_type: target.effect_type,
            payload,
        });
    }
    let request_value = json!({"schemaVersion":1,"operationId":operation_id,"novelId":novel_id,"strategy":input.strategy,"targets":normalized});
    let request_hash = ai_fact_security::canonical_hash(&request_value)?;
    let existing_id = connection
        .query_row(
            "SELECT transaction_id,request_hash FROM content_transactions WHERE operation_id=?1",
            [&operation_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(AppError::database)?;
    if let Some((id, hash)) = existing_id {
        if hash != request_hash {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "operationId 已绑定其他请求",
                false,
            )
            .with_context(None, Some(&operation_id)));
        }
        return load_transaction(connection, &id)?.ok_or_else(|| invalid("事务重放事实缺失"));
    }
    let mut frozen = Vec::with_capacity(normalized.len());
    let mut target_set = Vec::with_capacity(normalized.len());
    for (ordinal, target) in normalized.iter().enumerate() {
        let current = read_target(
            connection,
            &target.target_type,
            &target.target_id,
            &novel_id,
        )?;
        match (target.effect_type.as_str(), current.as_ref()) {
            ("create", Some(_)) => {
                return Err(AppError::new(
                    codes::CONTENT_TARGET_CONFLICT,
                    "创建目标已存在",
                    false,
                ))
            }
            ("update", None) => {
                return Err(AppError::new(
                    codes::CONTENT_TARGET_NOT_FOUND,
                    "更新目标不存在",
                    false,
                ))
            }
            _ => {}
        }
        if target.target_type == "chapter_metadata" && target.effect_type != "update" {
            return Err(invalid("章节元数据只支持 update"));
        }
        let base = current.unwrap_or(absent_snapshot(&target.target_type, &target.target_id)?);
        let candidate_hash = ai_fact_security::canonical_hash(&target.payload)?;
        target_set.push(json!({"ordinal":ordinal,"targetType":target.target_type,"targetId":target.target_id,"effectType":target.effect_type}));
        frozen.push((ordinal as i64, target.clone(), base, candidate_hash));
    }
    let target_set_value = Value::Array(target_set);
    let target_set_hash = ai_fact_security::canonical_hash(&target_set_value)?;
    let transaction_hash = ai_fact_security::canonical_hash(
        &json!({"requestHash":request_hash,"targetSetHash":target_set_hash,"bases":frozen.iter().map(|(ordinal,t,b,c)|json!({"ordinal":ordinal,"targetType":t.target_type,"targetId":t.target_id,"baseRevision":b.version,"baseHash":b.hash,"candidateHash":c})).collect::<Vec<_>>() }),
    )?;
    let transaction_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    tx.execute("INSERT INTO content_transactions(transaction_id,operation_id,request_hash,novel_id,strategy,target_set_json,target_set_hash,transaction_hash,status,revision,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'prepared',1,?9)",params![transaction_id,operation_id,request_hash,novel_id,input.strategy,target_set_value.to_string(),target_set_hash,transaction_hash,now]).map_err(AppError::database)?;
    for (ordinal, target, base, candidate_hash) in frozen {
        tx.execute("INSERT INTO content_transaction_targets(transaction_id,novel_id,ordinal,target_type,target_id,effect_type,base_revision,base_hash,candidate_payload_json,candidate_hash) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![transaction_id,novel_id,ordinal,target.target_type,target.target_id,target.effect_type,base.version,base.hash,target.payload.to_string(),candidate_hash]).map_err(AppError::database)?;
    }
    tx.commit().map_err(|e| {
        AppError::new(
            codes::DATABASE_COMMIT_UNKNOWN,
            "多目标准备提交状态未知，请使用相同 operationId 重放",
            true,
        )
        .with_context(None, Some(&operation_id))
        .with_details(json!({"sqliteError":e.to_string()}))
    })?;
    load_transaction(connection, &transaction_id)?.ok_or_else(|| invalid("准备后的事务事实缺失"))
}

fn assert_scoped_reference(
    connection: &Connection,
    table: &str,
    id: &str,
    novel_id: &str,
    planned: &HashSet<(String, String)>,
    planned_type: &str,
) -> Result<(), AppError> {
    if planned.contains(&(planned_type.to_string(), id.to_string())) {
        return Ok(());
    }
    let sql = if table == "chapters" {
        "SELECT novel_id FROM chapters WHERE id=?1 AND deleted_at IS NULL".to_string()
    } else {
        format!("SELECT novel_id FROM {table} WHERE id=?1")
    };
    let owner = connection
        .query_row(&sql, [id], |r| r.get::<_, String>(0))
        .optional()
        .map_err(AppError::database)?;
    match owner {
        Some(owner) if owner == novel_id => Ok(()),
        Some(_) => Err(scope_error("引用对象属于其他作品")),
        None => Err(AppError::new(
            codes::CONTENT_TARGET_NOT_FOUND,
            "候选引用对象不存在",
            false,
        )),
    }
}

fn validate_references(
    connection: &Connection,
    novel_id: &str,
    targets: &[ContentTransactionTargetDto],
) -> Result<(), AppError> {
    let planned = targets
        .iter()
        .filter(|t| t.effect_type == "create")
        .map(|t| (t.target_type.clone(), t.target_id.clone()))
        .collect::<HashSet<_>>();
    for t in targets {
        let s = |key: &str| {
            t.candidate_payload
                .get(key)
                .and_then(Value::as_str)
                .unwrap_or_default()
        };
        match t.target_type.as_str() {
            "location" => {
                if !s("parentLocationId").is_empty() {
                    assert_scoped_reference(
                        connection,
                        "locations",
                        s("parentLocationId"),
                        novel_id,
                        &planned,
                        "location",
                    )?;
                }
            }
            "faction_relation" => {
                assert_scoped_reference(
                    connection,
                    "factions",
                    s("sourceFactionId"),
                    novel_id,
                    &planned,
                    "faction",
                )?;
                assert_scoped_reference(
                    connection,
                    "factions",
                    s("targetFactionId"),
                    novel_id,
                    &planned,
                    "faction",
                )?;
            }
            "location_link" => {
                assert_scoped_reference(
                    connection,
                    "locations",
                    s("sourceLocationId"),
                    novel_id,
                    &planned,
                    "location",
                )?;
                assert_scoped_reference(
                    connection,
                    "locations",
                    s("targetLocationId"),
                    novel_id,
                    &planned,
                    "location",
                )?;
            }
            "character_faction" => {
                assert_scoped_reference(
                    connection,
                    "characters",
                    s("characterId"),
                    novel_id,
                    &planned,
                    "character",
                )?;
                assert_scoped_reference(
                    connection,
                    "factions",
                    s("factionId"),
                    novel_id,
                    &planned,
                    "faction",
                )?;
            }
            "chapter_faction" => {
                assert_scoped_reference(
                    connection,
                    "chapters",
                    s("chapterId"),
                    novel_id,
                    &planned,
                    "chapter",
                )?;
                assert_scoped_reference(
                    connection,
                    "factions",
                    s("factionId"),
                    novel_id,
                    &planned,
                    "faction",
                )?;
            }
            "chapter_location" => {
                assert_scoped_reference(
                    connection,
                    "chapters",
                    s("chapterId"),
                    novel_id,
                    &planned,
                    "chapter",
                )?;
                assert_scoped_reference(
                    connection,
                    "locations",
                    s("locationId"),
                    novel_id,
                    &planned,
                    "location",
                )?;
            }
            "chapter_event_faction" => {
                assert_scoped_reference(
                    connection,
                    "chapter_events",
                    s("chapterEventId"),
                    novel_id,
                    &planned,
                    "chapter_event",
                )?;
                assert_scoped_reference(
                    connection,
                    "factions",
                    s("factionId"),
                    novel_id,
                    &planned,
                    "faction",
                )?;
            }
            "chapter_event_location" => {
                assert_scoped_reference(
                    connection,
                    "chapter_events",
                    s("chapterEventId"),
                    novel_id,
                    &planned,
                    "chapter_event",
                )?;
                assert_scoped_reference(
                    connection,
                    "locations",
                    s("locationId"),
                    novel_id,
                    &planned,
                    "location",
                )?;
            }
            _ => {}
        }
    }
    validate_location_projection(connection, novel_id, targets)
}

fn validate_location_projection(
    connection: &Connection,
    novel_id: &str,
    targets: &[ContentTransactionTargetDto],
) -> Result<(), AppError> {
    let mut parents = HashMap::<String, Option<String>>::new();
    let mut stmt = connection
        .prepare("SELECT id,parent_location_id FROM locations WHERE novel_id=?1")
        .map_err(AppError::database)?;
    for row in stmt
        .query_map([novel_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })
        .map_err(AppError::database)?
    {
        let (id, parent) = row.map_err(AppError::database)?;
        parents.insert(id, parent);
    }
    for target in targets.iter().filter(|t| t.target_type == "location") {
        parents.insert(
            target.target_id.clone(),
            target
                .candidate_payload
                .get("parentLocationId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
        );
    }
    for start in parents.keys() {
        let mut seen = HashSet::new();
        let mut cursor = Some(start.clone());
        while let Some(id) = cursor {
            if !seen.insert(id.clone()) {
                return Err(AppError::new(
                    codes::CONTENT_ASSET_HIERARCHY_CYCLE,
                    "地点层级存在环",
                    false,
                ));
            }
            cursor = parents.get(&id).cloned().flatten();
        }
    }
    Ok(())
}

fn location_depth(
    id: &str,
    parents: &HashMap<String, Option<String>>,
    memo: &mut HashMap<String, usize>,
) -> usize {
    if let Some(depth) = memo.get(id) {
        return *depth;
    }
    let depth = parents
        .get(id)
        .and_then(|parent| parent.as_deref())
        .map(|parent| location_depth(parent, parents, memo).saturating_add(1))
        .unwrap_or(0);
    memo.insert(id.to_string(), depth);
    depth
}

fn order_for_apply(
    connection: &Connection,
    novel_id: &str,
    selected: &[ContentTransactionTargetDto],
) -> Result<Vec<ContentTransactionTargetDto>, AppError> {
    let mut parents = HashMap::<String, Option<String>>::new();
    let mut statement = connection
        .prepare("SELECT id,parent_location_id FROM locations WHERE novel_id=?1")
        .map_err(AppError::database)?;
    for row in statement
        .query_map([novel_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .map_err(AppError::database)?
    {
        let (id, parent) = row.map_err(AppError::database)?;
        parents.insert(id, parent);
    }
    for target in selected
        .iter()
        .filter(|target| target.target_type == "location")
    {
        parents.insert(
            target.target_id.clone(),
            target
                .candidate_payload
                .get("parentLocationId")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
        );
    }
    let mut memo = HashMap::new();
    let mut ordered = selected.to_vec();
    ordered.sort_by_key(|target| {
        let phase = match target.target_type.as_str() {
            "faction" => 0,
            "location" => 1,
            "chapter_metadata" => 2,
            "faction_relation" | "location_link" => 3,
            _ => 4,
        };
        let depth = if target.target_type == "location" {
            location_depth(&target.target_id, &parents, &mut memo)
        } else {
            0
        };
        (phase, depth, target.ordinal)
    });
    Ok(ordered)
}

fn value_text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn apply_formal_target(
    tx: &Transaction<'_>,
    novel_id: &str,
    target: &ContentTransactionTargetDto,
    now: &str,
) -> Result<(), AppError> {
    let p = &target.candidate_payload;
    let next = target.base_revision + 1;
    let count=match (target.target_type.as_str(),target.effect_type.as_str()){
        ("faction","create")=>tx.execute("INSERT INTO factions(id,novel_id,name,kind,description,goals,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,1,?7,?7)",params![target.target_id,novel_id,value_text(p,"name"),value_text(p,"kind"),value_text(p,"description"),value_text(p,"goals"),now]),
        ("faction","update")=>tx.execute("UPDATE factions SET name=?1,kind=?2,description=?3,goals=?4,revision=?5,updated_at=?6 WHERE id=?7 AND novel_id=?8 AND revision=?9",params![value_text(p,"name"),value_text(p,"kind"),value_text(p,"description"),value_text(p,"goals"),next,now,target.target_id,novel_id,target.base_revision]),
        ("location","create")=>tx.execute("INSERT INTO locations(id,novel_id,name,kind,description,parent_location_id,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,1,?7,?7)",params![target.target_id,novel_id,value_text(p,"name"),value_text(p,"kind"),value_text(p,"description"),value_text(p,"parentLocationId"),now]),
        ("location","update")=>tx.execute("UPDATE locations SET name=?1,kind=?2,description=?3,parent_location_id=?4,revision=?5,updated_at=?6 WHERE id=?7 AND novel_id=?8 AND revision=?9",params![value_text(p,"name"),value_text(p,"kind"),value_text(p,"description"),value_text(p,"parentLocationId"),next,now,target.target_id,novel_id,target.base_revision]),
        ("faction_relation",effect)=>apply_relation(tx,"faction_relations",effect,target,novel_id,now,"source_faction_id","target_faction_id","relation_type",("sourceFactionId","targetFactionId","relationType")),
        ("location_link",effect)=>apply_relation(tx,"location_links",effect,target,novel_id,now,"source_location_id","target_location_id","link_type",("sourceLocationId","targetLocationId","linkType")),
        (kind,effect) if matches!(kind,"character_faction"|"chapter_faction"|"chapter_location"|"chapter_event_faction"|"chapter_event_location")=>apply_association(tx,kind,effect,target,novel_id,now),
        ("chapter_metadata","update")=>apply_chapter_metadata(tx,target,novel_id,now),
        _=>return Err(invalid("不支持的 effect")),
    }.map_err(AppError::database)?;
    if count != 1 {
        return Err(AppError::new(
            codes::CONTENT_TARGET_CONFLICT,
            "目标 CAS 写入未命中",
            false,
        ));
    }
    Ok(())
}

fn apply_relation(
    tx: &Transaction<'_>,
    table: &str,
    effect: &str,
    t: &ContentTransactionTargetDto,
    novel: &str,
    now: &str,
    a: &str,
    b: &str,
    kind: &str,
    keys: (&str, &str, &str),
) -> rusqlite::Result<usize> {
    let p = &t.candidate_payload;
    if effect == "create" {
        tx.execute(&format!("INSERT INTO {table}(id,novel_id,{a},{b},{kind},description,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,1,?7,?7)"),params![t.target_id,novel,value_text(p,keys.0),value_text(p,keys.1),value_text(p,keys.2),value_text(p,"description"),now])
    } else {
        tx.execute(&format!("UPDATE {table} SET {a}=?1,{b}=?2,{kind}=?3,description=?4,revision=?5,updated_at=?6 WHERE id=?7 AND novel_id=?8 AND revision=?9"),params![value_text(p,keys.0),value_text(p,keys.1),value_text(p,keys.2),value_text(p,"description"),t.base_revision+1,now,t.target_id,novel,t.base_revision])
    }
}

fn association_meta(
    kind: &str,
) -> (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
) {
    match kind {
        "character_faction" => (
            "character_factions",
            "character_id",
            "faction_id",
            "characterId",
            "factionId",
        ),
        "chapter_faction" => (
            "chapter_factions",
            "chapter_id",
            "faction_id",
            "chapterId",
            "factionId",
        ),
        "chapter_location" => (
            "chapter_locations",
            "chapter_id",
            "location_id",
            "chapterId",
            "locationId",
        ),
        "chapter_event_faction" => (
            "chapter_event_factions",
            "chapter_event_id",
            "faction_id",
            "chapterEventId",
            "factionId",
        ),
        _ => (
            "chapter_event_locations",
            "chapter_event_id",
            "location_id",
            "chapterEventId",
            "locationId",
        ),
    }
}

fn apply_association(
    tx: &Transaction<'_>,
    kind: &str,
    effect: &str,
    t: &ContentTransactionTargetDto,
    novel: &str,
    now: &str,
) -> rusqlite::Result<usize> {
    let (table, a, b, ka, kb) = association_meta(kind);
    let p = &t.candidate_payload;
    if effect == "create" {
        tx.execute(&format!("INSERT INTO {table}(id,novel_id,{a},{b},role,revision,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,1,?6,?6)"),params![t.target_id,novel,value_text(p,ka),value_text(p,kb),value_text(p,"role"),now])
    } else {
        tx.execute(&format!("UPDATE {table} SET {a}=?1,{b}=?2,role=?3,revision=?4,updated_at=?5 WHERE id=?6 AND novel_id=?7 AND revision=?8"),params![value_text(p,ka),value_text(p,kb),value_text(p,"role"),t.base_revision+1,now,t.target_id,novel,t.base_revision])
    }
}

fn apply_chapter_metadata(
    tx: &Transaction<'_>,
    t: &ContentTransactionTargetDto,
    novel: &str,
    now: &str,
) -> rusqlite::Result<usize> {
    let current=tx.query_row("SELECT title,outline,goal,status FROM chapters WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL",params![t.target_id,novel],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,String>(3)?))).optional()?;
    let Some(current) = current else { return Ok(0) };
    let p = &t.candidate_payload;
    let title = value_text(p, "title").unwrap_or(&current.0);
    let outline = p
        .get("outline")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or(current.1);
    let goal = p
        .get("goal")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or(current.2);
    let status = value_text(p, "status").unwrap_or(&current.3);
    let count=tx.execute("UPDATE chapters SET title=?1,outline=?2,goal=?3,status=?4,updated_at=?5 WHERE id=?6 AND novel_id=?7 AND deleted_at IS NULL",params![title,outline,goal,status,now,t.target_id,novel])?;
    if count == 1 {
        let fields = json!({"title":title,"outline":outline,"goal":goal,"status":status});
        let semantic =
            ai_fact_security::canonical_hash(&fields).map_err(|_| rusqlite::Error::InvalidQuery)?;
        tx.execute("INSERT INTO content_target_revisions(target_type,target_id,novel_id,revision,content_hash,updated_at) VALUES('chapter_metadata',?1,?2,?3,?4,?5) ON CONFLICT(target_type,target_id) DO UPDATE SET revision=excluded.revision,content_hash=excluded.content_hash,updated_at=excluded.updated_at",params![t.target_id,novel,t.base_revision+1,semantic,now])?;
    }
    Ok(count)
}

fn selected_targets(
    dto: &ContentTransactionDto,
    approved: &[ApprovedContentTarget],
) -> Result<Vec<ContentTransactionTargetDto>, AppError> {
    if dto.strategy == "all_or_nothing" {
        if !approved.is_empty() {
            let all = dto
                .targets
                .iter()
                .map(|t| (t.target_type.clone(), t.target_id.clone()))
                .collect::<HashSet<_>>();
            let got = approved
                .iter()
                .map(|t| (t.target_type.clone(), t.target_id.clone()))
                .collect::<HashSet<_>>();
            if all != got {
                return Err(invalid("all_or_nothing 必须确认完整目标集合"));
            }
        }
        return Ok(dto.targets.clone());
    }
    let approved_count = approved.len();
    let approved = approved
        .iter()
        .map(|t| (t.target_type.clone(), t.target_id.clone()))
        .collect::<HashSet<_>>();
    if approved.len() != approved_count {
        return Err(invalid("批准集合包含重复身份"));
    }
    if approved.is_empty() {
        return Err(invalid("reviewed_partial 必须显式批准至少一个目标"));
    }
    let known = dto
        .targets
        .iter()
        .map(|t| (t.target_type.clone(), t.target_id.clone()))
        .collect::<HashSet<_>>();
    if !approved.is_subset(&known) {
        return Err(invalid("批准集合包含冻结目标之外的身份"));
    }
    Ok(dto
        .targets
        .iter()
        .filter(|t| approved.contains(&(t.target_type.clone(), t.target_id.clone())))
        .cloned()
        .collect())
}

fn validate_replay_approval(
    dto: &ContentTransactionDto,
    approved: &[ApprovedContentTarget],
) -> Result<(), AppError> {
    let applied = dto
        .targets
        .iter()
        .filter(|target| target.applied_hash.is_some())
        .map(|target| (target.target_type.clone(), target.target_id.clone()))
        .collect::<HashSet<_>>();
    let supplied = approved
        .iter()
        .map(|target| (target.target_type.clone(), target.target_id.clone()))
        .collect::<HashSet<_>>();
    if supplied.len() != approved.len() {
        return Err(invalid("批准集合包含重复身份"));
    }
    if (dto.strategy == "reviewed_partial" && supplied != applied)
        || (dto.strategy == "all_or_nothing" && !supplied.is_empty() && supplied != applied)
    {
        return Err(AppError::new(
            codes::OPERATION_PAYLOAD_CONFLICT,
            "重放批准集合与首次应用不一致",
            false,
        ));
    }
    Ok(())
}

fn replay_validate(connection: &Connection, dto: &ContentTransactionDto) -> Result<(), AppError> {
    for target in dto.targets.iter().filter(|t| t.applied_hash.is_some()) {
        let actual = read_target(
            connection,
            &target.target_type,
            &target.target_id,
            &dto.novel_id,
        )?
        .ok_or_else(|| {
            AppError::new(
                codes::CONTENT_REPLAY_TARGET_CHANGED,
                "已应用目标已删除",
                false,
            )
        })?;
        if Some(actual.version) != target.applied_revision
            || Some(actual.hash.as_str()) != target.applied_hash.as_deref()
        {
            return Err(AppError::new(
                codes::CONTENT_REPLAY_TARGET_CHANGED,
                "已应用目标发生漂移",
                false,
            ));
        }
    }
    Ok(())
}

pub fn apply_transaction(
    connection: &mut Connection,
    input: ApplyContentTransactionInput,
) -> Result<ApplyContentTransactionResult, AppError> {
    let dto = load_transaction(connection, &input.transaction_id)?.ok_or_else(|| {
        AppError::new(
            codes::CONTENT_TRANSACTION_NOT_FOUND,
            "多目标事务不存在",
            false,
        )
    })?;
    if dto.operation_id != input.operation_id
        || dto.transaction_hash != input.expected_transaction_hash
    {
        return Err(AppError::new(
            codes::OPERATION_PAYLOAD_CONFLICT,
            "应用身份或 transactionHash 不匹配",
            false,
        ));
    }
    if dto.status == "applied" {
        validate_replay_approval(&dto, &input.approved_targets)?;
        replay_validate(connection, &dto)?;
        return Ok(ApplyContentTransactionResult {
            transaction: dto,
            replayed: true,
        });
    }
    if dto.status != "prepared" {
        return Err(AppError::new(
            codes::CONTENT_TRANSACTION_STATE_CONFLICT,
            "事务状态不允许应用",
            false,
        ));
    }
    let selected = selected_targets(&dto, &input.approved_targets)?;
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    validate_references(&tx, &dto.novel_id, &selected)?;
    for target in &selected {
        let actual = read_target(&tx, &target.target_type, &target.target_id, &dto.novel_id)?
            .unwrap_or(absent_snapshot(&target.target_type, &target.target_id)?);
        if actual.version != target.base_revision || actual.hash != target.base_hash {
            return Err(AppError::new(
                codes::CONTENT_TARGET_CONFLICT,
                "目标 base revision/hash 已变化",
                false,
            ));
        }
    }
    let now = Utc::now().to_rfc3339();
    let ordered = order_for_apply(&tx, &dto.novel_id, &selected)?;
    for target in &ordered {
        apply_formal_target(&tx, &dto.novel_id, target, &now)?;
        let actual = read_target(&tx, &target.target_type, &target.target_id, &dto.novel_id)?
            .ok_or_else(|| invalid("应用后目标缺失"))?;
        tx.execute("UPDATE content_transaction_targets SET applied_revision=?1,applied_hash=?2,applied_at=?3 WHERE transaction_id=?4 AND ordinal=?5 AND applied_revision IS NULL",params![actual.version,actual.hash,now,dto.transaction_id,target.ordinal]).map_err(AppError::database)?;
    }
    let result = json!({"strategy":dto.strategy,"appliedTargets":selected.iter().map(|t|json!({"targetType":t.target_type,"targetId":t.target_id})).collect::<Vec<_>>()});
    let changed=tx.execute("UPDATE content_transactions SET status='applied',revision=revision+1,result_json=?1,applied_at=?2 WHERE transaction_id=?3 AND status='prepared' AND revision=?4",params![result.to_string(),now,dto.transaction_id,dto.revision]).map_err(AppError::database)?;
    if changed != 1 {
        return Err(AppError::new(
            codes::CONTENT_TRANSACTION_STATE_CONFLICT,
            "事务 CAS 失败",
            true,
        ));
    }
    tx.commit().map_err(|e| {
        AppError::new(
            codes::DATABASE_COMMIT_UNKNOWN,
            "多目标应用提交状态未知，请用相同 operationId 重放",
            true,
        )
        .with_context(None, Some(&input.operation_id))
        .with_details(json!({"sqliteError":e.to_string()}))
    })?;
    let transaction = load_transaction(connection, &input.transaction_id)?
        .ok_or_else(|| invalid("应用后的事务事实缺失"))?;
    replay_validate(connection, &transaction)?;
    Ok(ApplyContentTransactionResult {
        transaction,
        replayed: false,
    })
}

fn faction_row(row: &Row<'_>) -> rusqlite::Result<FactionDto> {
    Ok(FactionDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        name: row.get(2)?,
        kind: row.get(3)?,
        description: row.get(4)?,
        goals: row.get(5)?,
        revision: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}
fn location_row(row: &Row<'_>) -> rusqlite::Result<LocationDto> {
    Ok(LocationDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        name: row.get(2)?,
        kind: row.get(3)?,
        description: row.get(4)?,
        parent_location_id: row.get(5)?,
        revision: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}
pub fn get_faction(
    connection: &Connection,
    novel_id: &str,
    id: &str,
) -> Result<Option<FactionDto>, AppError> {
    connection.query_row("SELECT id,novel_id,name,kind,description,goals,revision,created_at,updated_at FROM factions WHERE id=?1 AND novel_id=?2",params![id,novel_id],faction_row).optional().map_err(AppError::database)
}
pub fn list_factions(connection: &Connection, novel_id: &str) -> Result<Vec<FactionDto>, AppError> {
    let mut s=connection.prepare("SELECT id,novel_id,name,kind,description,goals,revision,created_at,updated_at FROM factions WHERE novel_id=?1 ORDER BY name,id").map_err(AppError::database)?;
    let rows = s
        .query_map([novel_id], faction_row)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}
pub fn get_location(
    connection: &Connection,
    novel_id: &str,
    id: &str,
) -> Result<Option<LocationDto>, AppError> {
    connection.query_row("SELECT id,novel_id,name,kind,description,parent_location_id,revision,created_at,updated_at FROM locations WHERE id=?1 AND novel_id=?2",params![id,novel_id],location_row).optional().map_err(AppError::database)
}
pub fn list_locations(
    connection: &Connection,
    novel_id: &str,
) -> Result<Vec<LocationDto>, AppError> {
    let mut s=connection.prepare("SELECT id,novel_id,name,kind,description,parent_location_id,revision,created_at,updated_at FROM locations WHERE novel_id=?1 ORDER BY name,id").map_err(AppError::database)?;
    let rows = s
        .query_map([novel_id], location_row)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}
