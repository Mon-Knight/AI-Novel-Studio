use crate::errors::{codes, AppError};
use crate::repositories::autonomous_story_repository::{
    self, AutonomousPlanRow, StoreAutonomousPlan,
};
use chrono::Utc;
use rusqlite::{params, Connection, TransactionBehavior};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

const MAX_PLAN_BYTES: usize = 2_000_000;

#[derive(Debug)]
struct PlanMeta {
    plan_id: String,
    operation_id: String,
    novel_id: String,
    request_hash: String,
    schema_version: i64,
    status: String,
    stage: String,
    revision: i64,
    target_chapter_count: i64,
    completed_chapter_count: i64,
    error_message: Option<String>,
    created_at: String,
    updated_at: String,
    completed_at: Option<String>,
    applied_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyAutonomousPlanResult {
    pub plan: Value,
    pub created_volumes: i64,
    pub created_chapters: i64,
    pub created_characters: i64,
    pub created_world_elements: i64,
    pub created_chapter_events: i64,
    pub created_chapter_characters: i64,
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::new(codes::AUTONOMOUS_PLAN_INPUT_INVALID, message, false)
}

fn state_conflict(message: impl Into<String>) -> AppError {
    AppError::new(codes::AUTONOMOUS_PLAN_STATE_CONFLICT, message, false)
}

fn object<'a>(
    value: &'a Value,
    label: &str,
) -> Result<&'a serde_json::Map<String, Value>, AppError> {
    value
        .as_object()
        .ok_or_else(|| invalid(format!("{label} 必须是对象")))
}

fn array<'a>(value: &'a Value, label: &str) -> Result<&'a Vec<Value>, AppError> {
    value
        .as_array()
        .ok_or_else(|| invalid(format!("{label} 必须是数组")))
}

fn field<'a>(value: &'a Value, key: &str) -> Result<&'a Value, AppError> {
    object(value, "计划")?
        .get(key)
        .ok_or_else(|| invalid(format!("计划缺少 {key}")))
}

fn string_field(value: &Value, key: &str, max: usize) -> Result<String, AppError> {
    let text = field(value, key)?
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty() && text.len() <= max)
        .ok_or_else(|| invalid(format!("{key} 必须是长度不超过 {max} 的非空字符串")))?;
    Ok(text.to_string())
}

fn optional_string_field(value: &Value, key: &str, max: usize) -> Result<Option<String>, AppError> {
    let Some(raw) = object(value, "计划")?.get(key) else {
        return Ok(None);
    };
    if raw.is_null() {
        return Ok(None);
    }
    let text = raw
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty() && text.len() <= max)
        .ok_or_else(|| invalid(format!("{key} 格式无效")))?;
    Ok(Some(text.to_string()))
}

fn integer_field(value: &Value, key: &str, min: i64, max: i64) -> Result<i64, AppError> {
    let number = field(value, key)?
        .as_i64()
        .filter(|number| *number >= min && *number <= max)
        .ok_or_else(|| invalid(format!("{key} 必须是 {min} 到 {max} 之间的整数")))?;
    Ok(number)
}

fn array_field<'a>(value: &'a Value, key: &str) -> Result<&'a Vec<Value>, AppError> {
    array(field(value, key)?, key)
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string()),
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
            keys.sort();
            format!(
                "{{{}}}",
                keys.iter()
                    .map(|key| format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap_or_else(|_| "\"\"".to_string()),
                        canonical_json(&values[*key])
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
    }
}

fn hash_value(value: &Value) -> String {
    let mut hasher = Sha256::new();
    hasher.update(canonical_json(value).as_bytes());
    format!("{:x}", hasher.finalize())
}

fn contains_secret(value: &Value) -> bool {
    match value {
        Value::String(text) => {
            let lower = text.to_ascii_lowercase();
            lower.contains("authorization: bearer")
                || lower.contains("api_key=")
                || lower.contains("apikey=")
                || lower
                    .split_whitespace()
                    .any(|word| word.starts_with("sk-") && word.len() > 12)
        }
        Value::Array(values) => values.iter().any(contains_secret),
        Value::Object(values) => values.iter().any(|(key, value)| {
            matches!(
                key.to_ascii_lowercase().as_str(),
                "apikey" | "api_key" | "authorization"
            ) || contains_secret(value)
        }),
        _ => false,
    }
}

fn expected_request_hash(
    plan: &Value,
    novel_id: &str,
    schema_version: i64,
) -> Result<String, AppError> {
    let brief = field(plan, "brief")?.clone();
    Ok(hash_value(&json!({
        "schemaVersion": schema_version,
        "novelId": novel_id,
        "brief": brief,
    })))
}

pub(crate) fn refresh_restored_plan_hashes(plan: &mut Value) -> Result<(String, String), AppError> {
    let novel_id = string_field(plan, "novelId", 160)?;
    let schema_version = integer_field(plan, "schemaVersion", 1, 1)?;
    let request_hash = expected_request_hash(plan, &novel_id, schema_version)?;
    plan.as_object_mut()
        .ok_or_else(|| invalid("restored autonomous plan must be an object"))?
        .insert("requestHash".to_string(), json!(request_hash));

    let meta = validate_plan(plan)?;
    if matches!(meta.status.as_str(), "ready" | "applied") {
        validate_complete_plan(plan, &meta)?;
    }
    let plan_json = canonical_json(plan);
    let plan_hash = hash_value(plan);
    Ok((plan_json, plan_hash))
}

fn validate_plan(plan: &Value) -> Result<PlanMeta, AppError> {
    let serialized = serde_json::to_vec(plan).map_err(|_| invalid("自主创作计划无法序列化"))?;
    if serialized.len() > MAX_PLAN_BYTES {
        return Err(invalid("自主创作计划超过 2MB 安全上限"));
    }
    if contains_secret(plan) {
        return Err(AppError::new(
            codes::AI_TASK_SECRET_DETECTED,
            "自主创作计划包含疑似凭据",
            false,
        ));
    }

    let plan_id = string_field(plan, "planId", 160)?;
    let operation_id = string_field(plan, "operationId", 200)?;
    let novel_id = string_field(plan, "novelId", 160)?;
    let request_hash = string_field(plan, "requestHash", 64)?;
    if request_hash.len() != 64
        || !request_hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(invalid("requestHash 必须是小写 SHA-256"));
    }
    let schema_version = integer_field(plan, "schemaVersion", 1, 1)?;
    if expected_request_hash(plan, &novel_id, schema_version)? != request_hash {
        return Err(invalid("requestHash 与小说创意不一致"));
    }

    let status = string_field(plan, "status", 20)?;
    if !matches!(
        status.as_str(),
        "running" | "ready" | "failed" | "cancelled" | "applied"
    ) {
        return Err(invalid("自主创作计划状态无效"));
    }
    let stage = string_field(plan, "stage", 40)?;
    if !matches!(
        stage.as_str(),
        "foundation" | "creative_dimensions" | "chapter_batches" | "ready" | "applied"
    ) {
        return Err(invalid("自主创作计划阶段无效"));
    }
    if (status == "ready" && stage != "ready") || (status == "applied" && stage != "applied") {
        return Err(invalid("自主创作计划状态与阶段不一致"));
    }
    let revision = integer_field(plan, "revision", 0, i64::MAX)?;
    let brief = field(plan, "brief")?;
    let target_chapter_count = integer_field(brief, "targetChapterCount", 12, 500)?;
    integer_field(brief, "targetWordsPerChapter", 500, 10_000)?;
    let completed_chapter_count = array_field(plan, "chapters")?.len() as i64;
    if completed_chapter_count > target_chapter_count {
        return Err(invalid("已规划章节数超过目标章节数"));
    }
    let error_message = optional_string_field(plan, "errorMessage", 1_000)?;
    if status == "failed" && error_message.is_none() {
        return Err(invalid("failed 计划必须保存错误原因"));
    }
    let created_at = string_field(plan, "createdAt", 80)?;
    let updated_at = string_field(plan, "updatedAt", 80)?;
    let completed_at = optional_string_field(plan, "completedAt", 80)?;
    let applied_at = optional_string_field(plan, "appliedAt", 80)?;

    Ok(PlanMeta {
        plan_id,
        operation_id,
        novel_id,
        request_hash,
        schema_version,
        status,
        stage,
        revision,
        target_chapter_count,
        completed_chapter_count,
        error_message,
        created_at,
        updated_at,
        completed_at,
        applied_at,
    })
}

fn string_id(value: &Value, key: &str, label: &str) -> Result<String, AppError> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty() && id.len() <= 160)
        .map(ToOwned::to_owned)
        .ok_or_else(|| invalid(format!("{label}.{key} 无效")))
}

fn number(value: &Value, key: &str, label: &str, min: i64, max: i64) -> Result<i64, AppError> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(Value::as_i64)
        .filter(|number| *number >= min && *number <= max)
        .ok_or_else(|| invalid(format!("{label}.{key} 无效")))
}

fn id_array(value: &Value, key: &str, label: &str) -> Result<Vec<String>, AppError> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(Value::as_array)
        .ok_or_else(|| invalid(format!("{label}.{key} 必须是数组")))?
        .iter()
        .map(|item| {
            item.as_str()
                .map(str::trim)
                .filter(|id| !id.is_empty() && id.len() <= 160)
                .map(ToOwned::to_owned)
                .ok_or_else(|| invalid(format!("{label}.{key} 包含无效身份")))
        })
        .collect()
}

fn unique_ids(values: &[Value], key: &str, label: &str) -> Result<HashSet<String>, AppError> {
    let mut ids = HashSet::new();
    for value in values {
        let id = string_id(value, key, label)?;
        if !ids.insert(id) {
            return Err(invalid(format!("{label}存在重复身份")));
        }
    }
    Ok(ids)
}

fn validate_complete_plan(plan: &Value, meta: &PlanMeta) -> Result<(), AppError> {
    if !matches!(meta.status.as_str(), "ready" | "applied") {
        return Err(invalid("只有 ready 或 applied 计划可以执行完整性校验"));
    }
    object(field(plan, "storyBible")?, "storyBible")?;
    let arcs = array_field(plan, "arcs")?;
    let volumes = array_field(plan, "volumes")?;
    let characters = array_field(plan, "characters")?;
    let world = array_field(plan, "worldElements")?;
    let conflicts = array_field(plan, "conflicts")?;
    let pacing_phases = array_field(plan, "pacingPhases")?;
    let pacing = array_field(plan, "pacingCurve")?;
    let chapters = array_field(plan, "chapters")?;
    if arcs.is_empty()
        || volumes.is_empty()
        || characters.len() < 3
        || world.len() < 3
        || conflicts.len() < 2
        || pacing_phases.is_empty()
    {
        return Err(invalid("完整自主创作计划缺少必要创作维度"));
    }
    if chapters.len() as i64 != meta.target_chapter_count
        || pacing.len() as i64 != meta.target_chapter_count
    {
        return Err(invalid("章节计划或节奏曲线没有覆盖目标章节数"));
    }

    let arc_ids = unique_ids(arcs, "id", "故事弧")?;
    let volume_ids = unique_ids(volumes, "id", "分卷")?;
    let character_ids = unique_ids(characters, "id", "角色")?;
    let world_ids = unique_ids(world, "id", "世界元素")?;
    let conflict_ids = unique_ids(conflicts, "id", "冲突")?;
    unique_ids(chapters, "id", "章节")?;

    let mut beat_ids = HashSet::new();
    let mut has_protagonist = false;
    for character in characters {
        if character.get("role").and_then(Value::as_str) == Some("protagonist") {
            has_protagonist = true;
        }
        let beats = character
            .get("beats")
            .and_then(Value::as_array)
            .ok_or_else(|| invalid("角色缺少成长节点"))?;
        if beats.len() < 2 {
            return Err(invalid("每个角色至少需要两个成长节点"));
        }
        for beat in beats {
            let beat_id = string_id(beat, "id", "人物成长节点")?;
            if !beat_ids.insert(beat_id) {
                return Err(invalid("人物成长节点身份重复"));
            }
            number(
                beat,
                "chapterNumber",
                "人物成长节点",
                1,
                meta.target_chapter_count,
            )?;
        }
    }
    if !has_protagonist {
        return Err(invalid("完整计划必须包含主角"));
    }

    for (index, chapter) in chapters.iter().enumerate() {
        let expected = index as i64 + 1;
        if number(
            chapter,
            "chapterNumber",
            "章节",
            1,
            meta.target_chapter_count,
        )? != expected
        {
            return Err(invalid("章节编号必须从 1 连续递增"));
        }
        if !volume_ids.contains(&string_id(chapter, "volumeId", "章节")?)
            || !arc_ids.contains(&string_id(chapter, "arcId", "章节")?)
        {
            return Err(invalid("章节引用了不存在的分卷或故事弧"));
        }
        let character_refs = id_array(chapter, "characterIds", "章节")?;
        if character_refs.is_empty() || character_refs.iter().any(|id| !character_ids.contains(id))
        {
            return Err(invalid("章节角色引用无效"));
        }
        if id_array(chapter, "characterBeatIds", "章节")?
            .iter()
            .any(|id| !beat_ids.contains(id))
            || id_array(chapter, "worldElementIds", "章节")?
                .iter()
                .any(|id| !world_ids.contains(id))
            || id_array(chapter, "conflictThreadIds", "章节")?
                .iter()
                .any(|id| !conflict_ids.contains(id))
        {
            return Err(invalid("章节包含无效的自主创作引用"));
        }
    }
    for (index, point) in pacing.iter().enumerate() {
        if number(
            point,
            "chapterNumber",
            "节奏点",
            1,
            meta.target_chapter_count,
        )? != index as i64 + 1
        {
            return Err(invalid("节奏曲线必须逐章连续"));
        }
    }
    Ok(())
}

fn allowed_transition(from: &str, to: &str) -> bool {
    from == to
        || (from == "running" && matches!(to, "ready" | "failed" | "cancelled"))
        || (matches!(from, "failed" | "cancelled") && to == "running")
        || (from == "ready" && to == "applied")
}

fn ensure_novel(connection: &Connection, novel_id: &str) -> Result<(), AppError> {
    let exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM novels WHERE id=?1 AND deleted_at IS NULL",
            [novel_id],
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
    Ok(())
}

fn set_revision(plan: &mut Value, revision: i64) -> Result<(), AppError> {
    object(plan, "计划")?;
    plan.as_object_mut()
        .ok_or_else(|| invalid("计划必须是对象"))?
        .insert("revision".to_string(), json!(revision));
    Ok(())
}

fn store_data<'a>(
    meta: &'a PlanMeta,
    plan_json: &'a str,
    plan_hash: &'a str,
) -> StoreAutonomousPlan<'a> {
    StoreAutonomousPlan {
        plan_id: &meta.plan_id,
        operation_id: &meta.operation_id,
        novel_id: &meta.novel_id,
        request_hash: &meta.request_hash,
        schema_version: meta.schema_version,
        status: &meta.status,
        stage: &meta.stage,
        revision: meta.revision,
        target_chapter_count: meta.target_chapter_count,
        completed_chapter_count: meta.completed_chapter_count,
        plan_json,
        plan_hash,
        error_message: meta.error_message.as_deref(),
        created_at: &meta.created_at,
        updated_at: &meta.updated_at,
        completed_at: meta.completed_at.as_deref(),
        applied_at: meta.applied_at.as_deref(),
    }
}

pub fn save_plan(
    connection: &mut Connection,
    mut plan: Value,
    expected_revision: i64,
) -> Result<Value, AppError> {
    let input_meta = validate_plan(&plan)?;
    if input_meta.revision != expected_revision {
        return Err(state_conflict("输入 revision 与 expectedRevision 不一致"));
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    ensure_novel(&transaction, &input_meta.novel_id)?;

    let existing_by_plan =
        autonomous_story_repository::get_plan(&transaction, &input_meta.plan_id)?;
    let existing_by_operation =
        autonomous_story_repository::get_plan_by_operation(&transaction, &input_meta.operation_id)?;
    if let Some(operation_plan) = &existing_by_operation {
        if operation_plan.plan_id != input_meta.plan_id
            || operation_plan.request_hash != input_meta.request_hash
            || operation_plan.novel_id != input_meta.novel_id
        {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "相同 operationId 已绑定不同自主创作计划",
                false,
            ));
        }
    }

    let next_revision = expected_revision + 1;
    if let Some(existing) = &existing_by_plan {
        if existing.revision != expected_revision {
            return Err(state_conflict("自主创作计划 revision 已变化"));
        }
        if existing.operation_id != input_meta.operation_id
            || existing.novel_id != input_meta.novel_id
            || existing.request_hash != input_meta.request_hash
            || existing.schema_version != input_meta.schema_version
            || existing.created_at != input_meta.created_at
        {
            return Err(state_conflict("自主创作计划身份不可变"));
        }
        if !allowed_transition(&existing.status, &input_meta.status) {
            return Err(state_conflict("自主创作计划状态转换无效"));
        }
    } else if expected_revision != 0 || input_meta.status != "running" {
        return Err(state_conflict(
            "新计划必须以 revision 0 和 running 状态创建",
        ));
    }

    set_revision(&mut plan, next_revision)?;
    let meta = validate_plan(&plan)?;
    if matches!(meta.status.as_str(), "ready" | "applied") {
        validate_complete_plan(&plan, &meta)?;
    }
    let plan_json = canonical_json(&plan);
    let plan_hash = hash_value(&plan);
    let stored = store_data(&meta, &plan_json, &plan_hash);
    if existing_by_plan.is_some() {
        autonomous_story_repository::update_plan(&transaction, &stored, expected_revision)?;
    } else {
        autonomous_story_repository::insert_plan(&transaction, &stored)?;
    }
    transaction.commit().map_err(AppError::database)?;
    Ok(plan)
}

pub fn get_plan(connection: &Connection, plan_id: &str) -> Result<Option<Value>, AppError> {
    Ok(autonomous_story_repository::get_plan(connection, plan_id)?.map(|row| row.plan))
}

pub fn get_plan_by_operation(
    connection: &Connection,
    operation_id: &str,
) -> Result<Option<Value>, AppError> {
    Ok(
        autonomous_story_repository::get_plan_by_operation(connection, operation_id)?
            .map(|row| row.plan),
    )
}

pub fn list_plans_by_novel(
    connection: &Connection,
    novel_id: &str,
    limit: i64,
) -> Result<Vec<Value>, AppError> {
    if !(1..=100).contains(&limit) {
        return Err(invalid("计划列表 limit 必须在 1 到 100 之间"));
    }
    Ok(
        autonomous_story_repository::list_plans_by_novel(connection, novel_id, limit)?
            .into_iter()
            .map(|row| row.plan)
            .collect(),
    )
}

fn text(value: &Value, key: &str, label: &str, max: usize) -> Result<String, AppError> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty() && text.len() <= max)
        .map(ToOwned::to_owned)
        .ok_or_else(|| invalid(format!("{label}.{key} 无效")))
}

fn optional_text(value: &Value, key: &str, max: usize) -> Result<Option<String>, AppError> {
    let Some(raw) = value.as_object().and_then(|object| object.get(key)) else {
        return Ok(None);
    };
    if raw.is_null() {
        return Ok(None);
    }
    raw.as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty() && text.len() <= max)
        .map(|text| Some(text.to_string()))
        .ok_or_else(|| invalid(format!("{key} 格式无效")))
}

fn string_list(value: &Value, key: &str, max: usize) -> Result<Vec<String>, AppError> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(Value::as_array)
        .ok_or_else(|| invalid(format!("{key} 必须是数组")))?
        .iter()
        .map(|item| {
            item.as_str()
                .map(str::trim)
                .filter(|text| !text.is_empty() && text.len() <= max)
                .map(ToOwned::to_owned)
                .ok_or_else(|| invalid(format!("{key} 包含无效文本")))
        })
        .collect()
}

fn count_by_ids(
    connection: &Connection,
    table: &str,
    ids: &[String],
    novel_id: &str,
) -> Result<i64, AppError> {
    let mut count = 0_i64;
    for id in ids {
        let query = format!("SELECT COUNT(*) FROM {table} WHERE id=?1 AND novel_id=?2");
        count += connection
            .query_row(&query, params![id, novel_id], |row| row.get::<_, i64>(0))
            .map_err(AppError::database)?;
    }
    Ok(count)
}

fn verify_materialized_relations(
    connection: &Connection,
    plan: &Value,
    novel_id: &str,
) -> Result<bool, AppError> {
    for chapter in array_field(plan, "chapters")? {
        let chapter_id = string_id(chapter, "id", "章节")?;
        for character_id in id_array(chapter, "characterIds", "章节")? {
            let relation_id = format!("{chapter_id}:{character_id}");
            let count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM chapter_characters
                     WHERE id=?1 AND novel_id=?2 AND chapter_id=?3 AND character_id=?4",
                    params![relation_id, novel_id, chapter_id, character_id],
                    |row| row.get(0),
                )
                .map_err(AppError::database)?;
            if count != 1 {
                return Ok(false);
            }
        }
        for conflict_id in id_array(chapter, "conflictThreadIds", "章节")? {
            let event_id = format!("{chapter_id}:{conflict_id}");
            let count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM chapter_events
                     WHERE id=?1 AND novel_id=?2 AND chapter_id=?3",
                    params![event_id, novel_id, chapter_id],
                    |row| row.get(0),
                )
                .map_err(AppError::database)?;
            if count != 1 {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

fn expected_materialized_counts(plan: &Value) -> Result<(i64, i64, i64, i64, i64, i64), AppError> {
    let volumes = array_field(plan, "volumes")?.len() as i64;
    let chapters = array_field(plan, "chapters")?;
    let characters = array_field(plan, "characters")?.len() as i64;
    let world = array_field(plan, "worldElements")?.len() as i64;
    let events = chapters
        .iter()
        .map(|chapter| id_array(chapter, "conflictThreadIds", "章节").map(|ids| ids.len() as i64))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .sum();
    let chapter_characters = chapters
        .iter()
        .map(|chapter| id_array(chapter, "characterIds", "章节").map(|ids| ids.len() as i64))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .sum();
    Ok((
        volumes,
        chapters.len() as i64,
        characters,
        world,
        events,
        chapter_characters,
    ))
}

fn verify_applied(
    connection: &Connection,
    row: &AutonomousPlanRow,
) -> Result<ApplyAutonomousPlanResult, AppError> {
    let volumes = array_field(&row.plan, "volumes")?;
    let chapters = array_field(&row.plan, "chapters")?;
    let characters = array_field(&row.plan, "characters")?;
    let world = array_field(&row.plan, "worldElements")?;
    let volume_ids = volumes
        .iter()
        .map(|item| string_id(item, "id", "分卷"))
        .collect::<Result<Vec<_>, _>>()?;
    let chapter_ids = chapters
        .iter()
        .map(|item| string_id(item, "id", "章节"))
        .collect::<Result<Vec<_>, _>>()?;
    let character_ids = characters
        .iter()
        .map(|item| string_id(item, "id", "角色"))
        .collect::<Result<Vec<_>, _>>()?;
    let world_ids = world
        .iter()
        .map(|item| string_id(item, "id", "世界元素"))
        .collect::<Result<Vec<_>, _>>()?;
    if count_by_ids(connection, "volumes", &volume_ids, &row.novel_id)? != volume_ids.len() as i64
        || count_by_ids(connection, "chapters", &chapter_ids, &row.novel_id)?
            != chapter_ids.len() as i64
        || count_by_ids(connection, "characters", &character_ids, &row.novel_id)?
            != character_ids.len() as i64
        || count_by_ids(connection, "world_settings", &world_ids, &row.novel_id)?
            != world_ids.len() as i64
        || !verify_materialized_relations(connection, &row.plan, &row.novel_id)?
    {
        return Err(AppError::new(
            codes::OPERATION_REPLAY_TARGET_INVALID,
            "已应用自主创作计划的正式目标缺失或归属变化",
            false,
        ));
    }
    let counts = expected_materialized_counts(&row.plan)?;
    Ok(ApplyAutonomousPlanResult {
        plan: row.plan.clone(),
        created_volumes: counts.0,
        created_chapters: counts.1,
        created_characters: counts.2,
        created_world_elements: counts.3,
        created_chapter_events: counts.4,
        created_chapter_characters: counts.5,
    })
}

pub fn apply_plan(
    connection: &mut Connection,
    plan_id: &str,
    expected_revision: i64,
) -> Result<ApplyAutonomousPlanResult, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let row = autonomous_story_repository::get_plan(&transaction, plan_id)?.ok_or_else(|| {
        AppError::new(
            codes::AUTONOMOUS_PLAN_NOT_FOUND,
            "自主创作计划不存在",
            false,
        )
    })?;
    if row.status == "applied" {
        let result = verify_applied(&transaction, &row)?;
        transaction.commit().map_err(AppError::database)?;
        return Ok(result);
    }
    if row.status != "ready" || row.revision != expected_revision {
        return Err(state_conflict("自主创作计划尚未 ready 或 revision 已变化"));
    }
    let meta = validate_plan(&row.plan)?;
    validate_complete_plan(&row.plan, &meta)?;
    ensure_novel(&transaction, &row.novel_id)?;
    let existing_volumes: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM volumes WHERE novel_id=?1 AND deleted_at IS NULL",
            [&row.novel_id],
            |record| record.get(0),
        )
        .map_err(AppError::database)?;
    let existing_chapters: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM chapters WHERE novel_id=?1 AND deleted_at IS NULL",
            [&row.novel_id],
            |record| record.get(0),
        )
        .map_err(AppError::database)?;
    if existing_volumes != 0 || existing_chapters != 0 {
        return Err(AppError::new(
            codes::AUTONOMOUS_PLAN_TARGET_CONFLICT,
            "目标作品已有分卷或章节，不能覆盖式应用自主创作计划",
            false,
        ));
    }

    let now = Utc::now().to_rfc3339();
    let volumes = array_field(&row.plan, "volumes")?;
    for volume in volumes {
        transaction
            .execute(
                "INSERT INTO volumes (
                    id, novel_id, title, summary, goal, main_conflict,
                    order_index, status, created_at, updated_at
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,'planned',?8,?8)",
                params![
                    string_id(volume, "id", "分卷")?,
                    &row.novel_id,
                    text(volume, "title", "分卷", 120)?,
                    text(volume, "summary", "分卷", 2_000)?,
                    text(volume, "goal", "分卷", 1_000)?,
                    text(volume, "mainConflict", "分卷", 1_000)?,
                    number(volume, "index", "分卷", 0, 23)?,
                    &now,
                ],
            )
            .map_err(AppError::database)?;
    }

    let mut characters_by_id = HashMap::<String, Value>::new();
    let characters = array_field(&row.plan, "characters")?;
    for character in characters {
        let id = string_id(character, "id", "角色")?;
        let behavior_limits = string_list(character, "behaviorLimits", 300)?.join("\n");
        let forbidden = string_list(character, "forbiddenBehaviors", 300)?.join("\n");
        let role = text(character, "role", "角色", 30)?;
        transaction
            .execute(
                "INSERT INTO characters (
                    id, novel_id, name, role_type, identity, faction,
                    relation_to_protagonist, goal, personality, behavior_limits,
                    forbidden_behaviors, current_state, source, source_type,
                    is_protagonist, is_active, created_at, updated_at
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,
                           'ai_generated','ai_generated',?13,1,?14,?14)",
                params![
                    &id,
                    &row.novel_id,
                    text(character, "name", "角色", 80)?,
                    &role,
                    text(character, "identity", "角色", 500)?,
                    optional_text(character, "faction", 500)?,
                    optional_text(character, "relationToProtagonist", 500)?,
                    text(character, "coreNeed", "角色", 1_000)?,
                    text(character, "personality", "角色", 1_000)?,
                    behavior_limits,
                    forbidden,
                    text(character, "initialState", "角色", 1_000)?,
                    if role == "protagonist" { 1 } else { 0 },
                    &now,
                ],
            )
            .map_err(AppError::database)?;
        characters_by_id.insert(id, character.clone());
    }

    let world = array_field(&row.plan, "worldElements")?;
    for element in world {
        let structured = json!({
            "autonomousPlanId": row.plan_id,
            "type": text(element, "type", "世界元素", 30)?,
            "firstChapter": number(element, "firstChapter", "世界元素", 1, meta.target_chapter_count)?,
            "dependencies": field(element, "dependencies")?,
            "constraints": field(element, "constraints")?,
        });
        transaction
            .execute(
                "INSERT INTO world_settings (
                    id, novel_id, title, content, structured_json,
                    is_active, created_at, updated_at
                 ) VALUES (?1,?2,?3,?4,?5,1,?6,?6)",
                params![
                    string_id(element, "id", "世界元素")?,
                    &row.novel_id,
                    text(element, "name", "世界元素", 120)?,
                    text(element, "summary", "世界元素", 2_000)?,
                    canonical_json(&structured),
                    &now,
                ],
            )
            .map_err(AppError::database)?;
    }

    let conflicts = array_field(&row.plan, "conflicts")?;
    let mut conflicts_by_id = HashMap::<String, Value>::new();
    for conflict in conflicts {
        conflicts_by_id.insert(string_id(conflict, "id", "冲突")?, conflict.clone());
    }

    let chapters = array_field(&row.plan, "chapters")?;
    let mut event_count = 0_i64;
    let mut chapter_character_count = 0_i64;
    for chapter in chapters {
        let chapter_id = string_id(chapter, "id", "章节")?;
        let outline = format!(
            "{}\n\n【自主节奏】{}，张力 {}/100\n\n【章节钩子】{}",
            text(chapter, "outline", "章节", 3_000)?,
            text(chapter, "pacingMode", "章节", 30)?,
            number(chapter, "tension", "章节", 0, 100)?,
            text(chapter, "endingHook", "章节", 1_000)?,
        );
        let chapter_number = number(
            chapter,
            "chapterNumber",
            "章节",
            1,
            meta.target_chapter_count,
        )?;
        transaction
            .execute(
                "INSERT INTO chapters (
                    id, novel_id, volume_id, title, outline, goal, order_index,
                    status, word_count, target_word_count, created_at, updated_at
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,'outline_ready',0,?8,?9,?9)",
                params![
                    &chapter_id,
                    &row.novel_id,
                    string_id(chapter, "volumeId", "章节")?,
                    text(chapter, "title", "章节", 120)?,
                    outline,
                    text(chapter, "goal", "章节", 1_000)?,
                    chapter_number - 1,
                    number(chapter, "targetWordCount", "章节", 500, 10_000)?,
                    &now,
                ],
            )
            .map_err(AppError::database)?;

        let character_ids = id_array(chapter, "characterIds", "章节")?;
        for character_id in &character_ids {
            let character = characters_by_id
                .get(character_id)
                .ok_or_else(|| invalid("章节角色引用不存在"))?;
            let role = text(character, "role", "角色", 30)?;
            transaction
                .execute(
                    "INSERT INTO chapter_characters (
                        id, novel_id, chapter_id, character_id, character_name,
                        role_in_chapter, must_appear, note, created_at, updated_at
                     ) VALUES (?1,?2,?3,?4,?5,?6,1,'由自主创作计划准备',?7,?7)",
                    params![
                        format!("{}:{}", chapter_id, character_id),
                        &row.novel_id,
                        &chapter_id,
                        character_id,
                        text(character, "name", "角色", 80)?,
                        if role == "protagonist" {
                            "main"
                        } else {
                            "supporting"
                        },
                        &now,
                    ],
                )
                .map_err(AppError::database)?;
            chapter_character_count += 1;
        }

        for conflict_id in id_array(chapter, "conflictThreadIds", "章节")? {
            let conflict = conflicts_by_id
                .get(&conflict_id)
                .ok_or_else(|| invalid("章节冲突引用不存在"))?;
            let description = format!(
                "{}\n本章目标：{}",
                text(conflict, "summary", "冲突", 1_000)?,
                text(chapter, "goal", "章节", 1_000)?,
            );
            transaction
                .execute(
                    "INSERT INTO chapter_events (
                        id, novel_id, chapter_id, title, description,
                        involved_character_ids, impact, risk, status, source,
                        created_at, updated_at
                     ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'required','ai_suggested',?9,?9)",
                    params![
                        format!("{}:{}", chapter_id, conflict_id),
                        &row.novel_id,
                        &chapter_id,
                        text(conflict, "title", "冲突", 120)?,
                        description,
                        canonical_json(&json!(character_ids)),
                        text(conflict, "stakes", "冲突", 1_000)?,
                        text(chapter, "endingHook", "章节", 1_000)?,
                        &now,
                    ],
                )
                .map_err(AppError::database)?;
            event_count += 1;
        }
    }

    let mut applied_plan = row.plan.clone();
    {
        let plan_object = applied_plan
            .as_object_mut()
            .ok_or_else(|| invalid("计划必须是对象"))?;
        plan_object.insert("status".to_string(), json!("applied"));
        plan_object.insert("stage".to_string(), json!("applied"));
        plan_object.insert("revision".to_string(), json!(expected_revision + 1));
        plan_object.insert("updatedAt".to_string(), json!(&now));
        plan_object.insert("appliedAt".to_string(), json!(&now));
        let chapter_values = plan_object
            .get_mut("chapters")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| invalid("计划章节格式无效"))?;
        for chapter in chapter_values {
            chapter
                .as_object_mut()
                .ok_or_else(|| invalid("计划章节格式无效"))?
                .insert("status".to_string(), json!("materialized"));
        }
    }
    let applied_meta = validate_plan(&applied_plan)?;
    validate_complete_plan(&applied_plan, &applied_meta)?;
    let applied_json = canonical_json(&applied_plan);
    let applied_hash = hash_value(&applied_plan);
    let stored = store_data(&applied_meta, &applied_json, &applied_hash);
    autonomous_story_repository::update_plan(&transaction, &stored, expected_revision)?;
    transaction.commit().map_err(AppError::database)?;

    Ok(ApplyAutonomousPlanResult {
        plan: applied_plan,
        created_volumes: volumes.len() as i64,
        created_chapters: chapters.len() as i64,
        created_characters: characters.len() as i64,
        created_world_elements: world.len() as i64,
        created_chapter_events: event_count,
        created_chapter_characters: chapter_character_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn database() -> Result<Connection, Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch("PRAGMA foreign_keys=ON;")?;
        crate::db::create_tables(&mut connection)?;
        connection.execute(
            "INSERT INTO novels (
                id,title,outline,protagonist_mode,protagonists_json,
                dual_protagonist_relation_json,main_character,protagonist_ability,
                status,total_word_count,created_at,updated_at
             ) VALUES ('novel-1','测试作品','','single','[]','{}','','','draft',0,?1,?1)",
            [Utc::now().to_rfc3339()],
        )?;
        Ok(connection)
    }

    fn test_plan(status: &str, stage: &str, revision: i64) -> Value {
        let brief = json!({
            "premise": "一名调查员收到来自未来自己的录音，并发现城市记忆正在被系统性改写。",
            "genre": "近未来悬疑",
            "targetChapterCount": 12,
            "targetWordsPerChapter": 2400,
            "readerPromise": "谜题升级与人物成长",
            "endingPreference": "主角公开真相并承担代价",
            "constraints": ["胜利必须付出代价"]
        });
        let request_hash = hash_value(&json!({
            "schemaVersion": 1,
            "novelId": "novel-1",
            "brief": brief.clone(),
        }));
        let arcs = (0..3)
            .map(|index| {
                let start = index * 4 + 1;
                json!({
                    "id": format!("arc-{index}"), "index": index,
                    "title": format!("故事弧 {}", index + 1),
                    "chapterStart": start, "chapterEnd": start + 3,
                    "goal": "推进真相", "turningPoint": "证据反转",
                    "climax": "正面对抗", "outcome": "形成后果"
                })
            })
            .collect::<Vec<_>>();
        let characters = [
            ("char-1", "林序", "protagonist"),
            ("char-2", "苏弥", "supporting"),
            ("char-3", "周策", "antagonist"),
        ]
        .into_iter()
        .map(|(id, name, role)| {
            json!({
                "id": id, "name": name, "role": role, "identity": "调查相关人员",
                "personality": "克制而执着", "coreNeed": "确认真实", "flaw": "过度依赖证据",
                "initialState": "只掌握局部事实", "desiredEndState": "能够承担选择后果",
                "behaviorLimits": ["重大决定需要证据"],
                "forbiddenBehaviors": ["无理由背叛目标"],
                "beats": [
                    {"id": format!("{id}-beat-1"), "characterId": id, "chapterNumber": 1, "stage": "建立", "change": "建立初始立场"},
                    {"id": format!("{id}-beat-2"), "characterId": id, "chapterNumber": 12, "stage": "兑现", "change": "完成终局选择"}
                ]
            })
        })
        .collect::<Vec<_>>();
        let world = (0..3)
            .map(|index| {
                json!({
                    "id": format!("world-{index}"), "type": "location",
                    "name": format!("场域 {index}"), "summary": "承载行动并限制选择",
                    "firstChapter": index + 1, "dependencies": [], "constraints": ["规则不可绕过"]
                })
            })
            .collect::<Vec<_>>();
        let conflicts = [
            json!({
                "id": "conflict-1", "title": "失真记忆", "type": "mystery",
                "participants": ["林序", "苏弥"], "stakes": "失去关键证据",
                "summary": "追查被改写的记忆", "introducedChapter": 1,
                "escalationChapters": [4], "climaxChapter": 6, "resolutionChapter": 6
            }),
            json!({
                "id": "conflict-2", "title": "秩序封锁", "type": "faction",
                "participants": ["林序", "周策"], "stakes": "失去行动自由",
                "summary": "突破委员会封锁", "introducedChapter": 7,
                "escalationChapters": [9], "climaxChapter": 11, "resolutionChapter": 12
            }),
        ];
        let pacing_phases = (0..3)
            .map(|index| {
                json!({
                    "id": format!("phase-{index}"), "title": format!("阶段 {index}"),
                    "chapterStart": index * 4 + 1, "chapterEnd": index * 4 + 4,
                    "mode": if index == 2 { "resolution" } else { "build" },
                    "tensionStart": 30 + index * 10, "tensionEnd": 60 + index * 10,
                    "purpose": "推进与兑现交替"
                })
            })
            .collect::<Vec<_>>();
        let pacing = (1..=12)
            .map(|chapter| {
                json!({
                    "chapterNumber": chapter, "phaseId": format!("phase-{}", (chapter - 1) / 4),
                    "mode": if chapter > 8 { "resolution" } else { "build" },
                    "tension": 30 + chapter * 4, "dialogueRatio": 0.35,
                    "descriptionRatio": 0.35, "cliffhanger": chapter % 4 == 0
                })
            })
            .collect::<Vec<_>>();
        let chapters = (1..=12)
            .map(|chapter| {
                let conflict = if chapter <= 6 { "conflict-1" } else { "conflict-2" };
                json!({
                    "id": format!("chapter-{chapter}"), "chapterNumber": chapter,
                    "volumeId": "volume-1", "arcId": format!("arc-{}", (chapter - 1) / 4),
                    "title": format!("第 {chapter} 章"),
                    "outline": format!("第 {chapter} 章通过具体行动推进线索，并使结尾局势发生明确变化。"),
                    "goal": "推进冲突和人物选择", "targetWordCount": 2400,
                    "pacingMode": if chapter > 8 { "resolution" } else { "build" },
                    "tension": 30 + chapter * 4, "endingHook": "出现一条反证",
                    "conflictThreadIds": [conflict], "characterIds": ["char-1"],
                    "characterBeatIds": [], "worldElementIds": [],
                    "status": if status == "applied" { "materialized" } else { "planned" }
                })
            })
            .collect::<Vec<_>>();
        json!({
            "schemaVersion": 1, "planId": "plan-1", "operationId": "operation-1",
            "requestHash": request_hash, "novelId": "novel-1", "status": status,
            "stage": stage, "revision": revision, "brief": brief,
            "storyBible": {
                "title": "回声边界", "logline": "调查员追查城市记忆改写事件",
                "themes": ["身份", "选择"], "protagonistPromise": "主动承担真相",
                "centralQuestion": "真实是否值得代价", "endingVision": "公开真相",
                "narrativeRules": ["线索可回溯"]
            },
            "arcs": arcs,
            "volumes": [{
                "id": "volume-1", "index": 0, "title": "第一卷", "chapterStart": 1,
                "chapterEnd": 12, "summary": "追查失真记忆并突破封锁",
                "goal": "找到核心证据", "mainConflict": "调查与封锁",
                "arcIds": ["arc-0", "arc-1", "arc-2"]
            }],
            "characters": characters, "worldElements": world, "conflicts": conflicts,
            "pacingPhases": pacing_phases, "pacingCurve": pacing, "chapters": chapters,
            "agentRuns": [],
            "progress": {
                "completedVolumeIds": ["volume-1"], "currentVolumeIndex": 1,
                "adoptedChapterNumbers": [], "lastCheckpoint": "完成"
            },
            "createdAt": "2026-07-27T12:00:00Z", "updatedAt": "2026-07-27T12:00:00Z",
            "completedAt": if status == "ready" || status == "applied" { json!("2026-07-27T12:00:00Z") } else { Value::Null },
            "appliedAt": if status == "applied" { json!("2026-07-27T12:00:00Z") } else { Value::Null }
        })
    }

    #[test]
    fn autonomous_plan_save_enforces_revision_and_operation_identity(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = database()?;
        let saved = save_plan(
            &mut connection,
            test_plan("running", "chapter_batches", 0),
            0,
        )?;
        assert_eq!(saved["revision"], 1);
        assert_eq!(
            get_plan_by_operation(&connection, "operation-1")?,
            Some(saved.clone())
        );

        let conflict = save_plan(
            &mut connection,
            test_plan("running", "chapter_batches", 0),
            0,
        )
        .expect_err("stale revision must fail");
        assert_eq!(conflict.code, codes::AUTONOMOUS_PLAN_STATE_CONFLICT);

        let mut drift = saved;
        drift["brief"]["premise"] = json!("被篡改的请求");
        let drift_error = save_plan(&mut connection, drift, 1).expect_err("hash drift must fail");
        assert_eq!(drift_error.code, codes::AUTONOMOUS_PLAN_INPUT_INVALID);
        Ok(())
    }

    #[test]
    fn autonomous_plan_apply_is_atomic_and_replay_safe() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = database()?;
        let running = save_plan(
            &mut connection,
            test_plan("running", "chapter_batches", 0),
            0,
        )?;
        let mut ready = test_plan("ready", "ready", 1);
        ready["createdAt"] = running["createdAt"].clone();
        let ready = save_plan(&mut connection, ready, 1)?;
        assert_eq!(ready["revision"], 2);

        let applied = apply_plan(&mut connection, "plan-1", 2)?;
        assert_eq!(applied.created_volumes, 1);
        assert_eq!(applied.created_chapters, 12);
        assert_eq!(applied.created_characters, 3);
        assert_eq!(applied.created_world_elements, 3);
        assert_eq!(applied.created_chapter_events, 12);
        assert_eq!(applied.created_chapter_characters, 12);
        assert_eq!(applied.plan["status"], "applied");
        assert_eq!(applied.plan["revision"], 3);

        let replay = apply_plan(&mut connection, "plan-1", 2)?;
        assert_eq!(replay.plan, applied.plan);
        let volume_count: i64 =
            connection.query_row("SELECT COUNT(*) FROM volumes", [], |row| row.get(0))?;
        let chapter_count: i64 =
            connection.query_row("SELECT COUNT(*) FROM chapters", [], |row| row.get(0))?;
        assert_eq!(volume_count, 1);
        assert_eq!(chapter_count, 12);
        assert_eq!(
            connection
                .prepare("PRAGMA foreign_key_check")?
                .query_map([], |_| Ok(()))?
                .count(),
            0
        );

        connection.execute(
            "DELETE FROM chapter_events WHERE id = 'chapter-1:conflict-1'",
            [],
        )?;
        let replay_error = apply_plan(&mut connection, "plan-1", 2)
            .expect_err("replay must detect a missing materialized event");
        assert_eq!(replay_error.code, codes::OPERATION_REPLAY_TARGET_INVALID);
        Ok(())
    }

    #[test]
    fn autonomous_plan_apply_rejects_existing_outline_without_partial_writes(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = database()?;
        let running = save_plan(
            &mut connection,
            test_plan("running", "chapter_batches", 0),
            0,
        )?;
        let mut ready = test_plan("ready", "ready", 1);
        ready["createdAt"] = running["createdAt"].clone();
        save_plan(&mut connection, ready, 1)?;
        connection.execute(
            "INSERT INTO volumes (id,novel_id,title,order_index,status,created_at,updated_at)
             VALUES ('manual-volume','novel-1','手工分卷',0,'planned',?1,?1)",
            [Utc::now().to_rfc3339()],
        )?;

        let error = apply_plan(&mut connection, "plan-1", 2)
            .expect_err("existing outline must block apply");
        assert_eq!(error.code, codes::AUTONOMOUS_PLAN_TARGET_CONFLICT);
        let chapters: i64 =
            connection.query_row("SELECT COUNT(*) FROM chapters", [], |row| row.get(0))?;
        let characters: i64 =
            connection.query_row("SELECT COUNT(*) FROM characters", [], |row| row.get(0))?;
        assert_eq!(chapters, 0);
        assert_eq!(characters, 0);
        assert_eq!(get_plan(&connection, "plan-1")?.unwrap()["status"], "ready");
        Ok(())
    }

    #[test]
    fn autonomous_plan_rejects_secret_material_before_insert(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = database()?;
        let mut plan = test_plan("running", "chapter_batches", 0);
        let fake_secret = ["sk", "this-must-never-persist"].join("-");
        plan["brief"]["constraints"] = json!(["apiKey", fake_secret]);
        let error = save_plan(&mut connection, plan, 0).expect_err("secret must fail closed");
        assert_eq!(error.code, codes::AI_TASK_SECRET_DETECTED);
        let count: i64 =
            connection.query_row("SELECT COUNT(*) FROM autonomous_story_plans", [], |row| {
                row.get(0)
            })?;
        assert_eq!(count, 0);
        Ok(())
    }
}
