//! Native-only selection and freezing of an applied Scene-only v2 plan.
//! No renderer-provided checkpoint, context, or success bit is trusted here.
use super::*;
use crate::services::ai_fact_security::canonical_hash;

#[derive(Debug, Clone)]
pub(super) struct FrozenPlan {
    pub scenes: Vec<Value>,
    pub source: Value,
    pub source_hash: String,
    pub plan_hash: String,
    pub base_hash: String,
    pub model_hash: String,
    pub range: ChapterWordRangeInput,
}

pub(super) fn hash(value: &Value) -> Result<String, String> {
    canonical_hash(value).map_err(|e| e.to_string())
}

pub(super) fn load(
    connection: &Connection,
    input: &StartTaskTurnInput,
) -> Result<Option<FrozenPlan>, String> {
    load_inner(connection, input, true)
}

// This only reads immutable candidate provenance and current formal baselines.
// Application authorization/expiry remains the caller's independent write gate;
// a completed generation's wall clock must not expire manual review of its result.
pub(super) fn load_for_application(
    connection: &Connection,
    input: &StartTaskTurnInput,
) -> Result<Option<FrozenPlan>, String> {
    load_inner(connection, input, false)
}

fn load_inner(
    connection: &Connection,
    input: &StartTaskTurnInput,
    require_active_execution: bool,
) -> Result<Option<FrozenPlan>, String> {
    let novel = input.require_novel_id()?;
    let chapter = input
        .chapter_id
        .as_deref()
        .ok_or("CHAPTER_STAGED_SCOPE_REQUIRED")?;
    let state = crate::services::chapter_engineering_service::get_active_chapter_engineering_state(
        connection, chapter,
    )?;
    let Some(state) = state else {
        return Ok(None);
    };
    if state.novel_id != novel || state.chapter_id != chapter || state.status != "active" {
        return Err("CHAPTER_STAGED_PLAN_SCOPE_MISMATCH".into());
    }
    let plan: Value =
        serde_json::from_str(&state.scene_plan_json).map_err(|_| "CHAPTER_STAGED_PLAN_INVALID")?;
    let scenes = plan.as_array().ok_or("CHAPTER_STAGED_PLAN_INVALID")?;
    if scenes.is_empty()
        || !scenes
            .iter()
            .any(|scene| scene.get("planVersion") == Some(&json!(2)))
    {
        return Ok(None);
    }
    validate_scenes(scenes)?;
    let mut writing = input.clone();
    writing.task_kind = "chapter_write".into();
    coordinator::validate_assets(connection, &writing)?;
    let root = input
        .execution
        .as_ref()
        .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    if require_active_execution {
        root.check()?;
    }
    let base = root
        .baseline(connection, &novel, chapter)
        .map_err(|e| e.to_string())?;
    let range = input
        .chapter_word_range
        .clone()
        .or_else(|| root.writing_range.clone())
        .ok_or("CHAPTER_STAGED_WORD_RANGE_REQUIRED")?;
    let total: i64 = scenes
        .iter()
        .map(|s| s["targetCharacters"].as_i64().unwrap_or(0))
        .sum();
    if range.target != total {
        return Err(
            "CHAPTER_STAGED_PLAN_TARGET_CHANGED: 已应用场景总字数与冻结章节目标不一致".into(),
        );
    }
    let projection = length_sources::projection::current(connection, input)?;
    let rows = length_sources::projection::rows;
    let previous = chapter_continuity::load_previous(connection, &novel, chapter)?;
    if let Some(previous) = &previous {
        root.baseline(connection, &novel, &previous.chapter_id)
            .map_err(|e| e.to_string())?;
    }
    let source = json!({
        "schemaVersion":"native_staged_source_v1", "novelId":novel,"chapterId":chapter,
        "engineeringId":state.id,"activeVersion":state.active_version,"draftVersion":state.draft_version,
        "chapter":projection,
        "worlds":rows(connection,"SELECT * FROM world_settings WHERE novel_id=?1 AND is_active=1 ORDER BY id",&[&novel])?,
        "rules":rows(connection,"SELECT * FROM rule_systems WHERE novel_id=?1 AND is_active=1 ORDER BY id",&[&novel])?,
        "profiles":rows(connection,"SELECT * FROM protagonists WHERE novel_id=?1 ORDER BY id",&[&novel])?,
        "previous":previous.map(|p|json!({"chapterId":p.chapter_id,"draftId":p.draft_id,"sourceHash":p.source_hash,"text":p.content})),
        "constraints":serde_json::from_str::<Value>(&state.generation_constraints_json).map_err(|_|"CHAPTER_STAGED_SOURCE_INVALID")?,
        "qualityRules":serde_json::from_str::<Value>(&state.quality_rules_json).map_err(|_|"CHAPTER_STAGED_SOURCE_INVALID")?,
    });
    if source.to_string().len() > 512 * 1024 {
        return Err("CHAPTER_STAGED_SOURCE_TOO_LARGE: 不截断必需上下文".into());
    }
    Ok(Some(FrozenPlan {
        scenes: scenes.clone(),
        source_hash: hash(&source)?,
        source,
        plan_hash: hash(&json!({"schemaVersion":2,"scenes":scenes}))?,
        base_hash: hash(&serde_json::to_value(base).map_err(|e| e.to_string())?)?,
        model_hash: hash(&retry::model_identity(&input.model_snapshot))?,
        range,
    }))
}

pub(super) fn validate_scenes(scenes: &[Value]) -> Result<(), String> {
    if scenes.is_empty() || scenes.len() > 12 {
        return Err("CHAPTER_STAGED_PLAN_INVALID".into());
    }
    let mut ids = HashSet::new();
    let mut count = 0usize;
    for (index, scene) in scenes.iter().enumerate() {
        let id = text(scene, "id", 80)?;
        if !ids.insert(id)
            || scene["sceneNo"].as_u64() != Some(index as u64 + 1)
            || scene["planVersion"] != json!(2)
            || !scene["beats"].as_array().is_some_and(|v| v.is_empty())
        {
            return Err("CHAPTER_STAGED_PLAN_INVALID".into());
        }
        text(scene, "goal", 8_000)?;
        let target = scene["targetCharacters"]
            .as_i64()
            .ok_or("CHAPTER_STAGED_PLAN_INVALID")?;
        count += beat_targets(target)?.len();
    }
    if count > 24 {
        return Err("CHAPTER_STAGED_BEAT_LIMIT_EXCEEDED".into());
    }
    Ok(())
}

/// Same default envelope as chapterBeatPlanPolicy: 650 desired, 500..900, at most six.
pub(super) fn beat_targets(total: i64) -> Result<Vec<i64>, String> {
    if total < 500 || total > 5_400 {
        return Err("CHAPTER_STAGED_BEAT_POLICY_INVALID".into());
    }
    let lower = (total + 899) / 900;
    let upper = (total / 500).min(6);
    if lower > upper {
        return Err("CHAPTER_STAGED_BEAT_POLICY_INVALID".into());
    }
    let count = ((total + 325) / 650).clamp(lower, upper);
    let mut remaining = total;
    let mut targets = Vec::new();
    for index in 0..count {
        let slots = count - index;
        let value = ((remaining * 2 + slots) / (2 * slots)).clamp(
            500.max(remaining - (slots - 1) * 900),
            900.min(remaining - (slots - 1) * 500),
        );
        targets.push(value);
        remaining -= value;
    }
    if remaining != 0 {
        return Err("CHAPTER_STAGED_BEAT_POLICY_INVALID".into());
    }
    Ok(targets)
}

pub(super) fn text<'a>(value: &'a Value, key: &str, limit: usize) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty() && s.len() <= limit)
        .ok_or_else(|| format!("CHAPTER_STAGED_FIELD_INVALID:{key}"))
}
