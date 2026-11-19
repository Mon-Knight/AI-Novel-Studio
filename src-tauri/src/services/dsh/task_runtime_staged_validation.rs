//! Host validation of model-authored Beat plans, prose and grounded actual state.
//! Matching source excerpts proves integrity only, never semantic truth.
use super::*;
use source::{beat_targets, hash, text};

pub(super) fn normalize(kind: &str, body: &str, payload: &Value) -> Result<String, String> {
    match kind {
        "beat_plan" => normalize_plan(body, payload).map(|v| v.to_string()),
        "beat_write" => {
            let target = payload["beat"]["targetCharacters"]
                .as_i64()
                .ok_or("CHAPTER_STAGED_BEAT_TARGET_INVALID")?;
            let count = crate::services::draft_service::word_count(body);
            if body.trim() != body || count < 500.max(target - 150) || count > 900.min(target + 150)
            {
                return Err("CHAPTER_STAGED_BEAT_TEXT_REJECTED".into());
            }
            Ok(body.to_string())
        }
        "beat_state" => {
            let prose = text(payload, "prose", 64 * 1024)?;
            let value: Value =
                serde_json::from_str(body).map_err(|_| "CHAPTER_STAGED_STATE_INVALID")?;
            validate_state(&value, prose)?;
            Ok(value.to_string())
        }
        _ => Err("CHAPTER_STAGED_MODEL_STAGE_INVALID".into()),
    }
}

fn normalize_plan(body: &str, payload: &Value) -> Result<Value, String> {
    let raw: Value = serde_json::from_str(body).map_err(|_| "CHAPTER_STAGED_BEAT_PLAN_INVALID")?;
    if raw.as_object().map(|v| v.len()) != Some(1) {
        return Err("CHAPTER_STAGED_BEAT_PLAN_INVALID".into());
    }
    let beats = raw["beats"]
        .as_array()
        .ok_or("CHAPTER_STAGED_BEAT_PLAN_INVALID")?;
    let scene = &payload["scene"];
    let id = text(scene, "id", 80)?;
    let targets = beat_targets(
        scene["targetCharacters"]
            .as_i64()
            .ok_or("CHAPTER_STAGED_PLAN_INVALID")?,
    )?;
    if beats.len() != targets.len() {
        return Err("CHAPTER_STAGED_BEAT_PLAN_COUNT_INVALID".into());
    }
    let mut normalized = Vec::new();
    for (index, beat) in beats.iter().enumerate() {
        let fields = beat.as_object().ok_or("CHAPTER_STAGED_BEAT_PLAN_INVALID")?;
        if fields.keys().any(|key| {
            ![
                "id",
                "order",
                "text",
                "required",
                "startState",
                "stateChange",
                "targetCharacters",
            ]
            .contains(&key.as_str())
        }) || beat["order"].as_u64() != Some(index as u64 + 1)
            || !beat["required"].is_boolean()
        {
            return Err("CHAPTER_STAGED_BEAT_PLAN_INVALID".into());
        }
        let beat_id = format!("{id}:beat:{}", index + 1);
        if fields.get("id").is_some_and(|v| v != &json!(beat_id))
            || fields
                .get("targetCharacters")
                .is_some_and(|v| v != &json!(targets[index]))
        {
            return Err("CHAPTER_STAGED_BEAT_PLAN_IDENTITY_INVALID".into());
        }
        normalized.push(
            json!({"id":beat_id,"order":index+1,"text":text(beat,"text",8_000)?,
            "required":beat["required"],"startState":text(beat,"startState",16_000)?,
            "stateChange":text(beat,"stateChange",8_000)?,"targetCharacters":targets[index]}),
        );
    }
    let mut plan = json!({"schemaVersion":1,"sceneId":id,"sourceContextHash":payload["sourceContextHash"],
        "previousTextHash":payload["previousTextHash"],"inputStateHash":payload["inputStateHash"],"beats":normalized});
    let plan_hash = hash(
        &json!({"schemaVersion":1,"scene":scene,"sourceContextHash":plan["sourceContextHash"],
        "previousTextHash":plan["previousTextHash"],"inputStateHash":plan["inputStateHash"],"beats":plan["beats"]}),
    )?;
    plan["planHash"] = json!(plan_hash);
    Ok(plan)
}

pub(super) fn validate_plan(stored: &str, payload: &Value) -> Result<Value, String> {
    let plan: Value =
        serde_json::from_str(stored).map_err(|_| "CHAPTER_STAGED_BEAT_PLAN_INVALID")?;
    let rebuilt = normalize_plan(&json!({"beats":plan["beats"]}).to_string(), payload)?;
    if plan != rebuilt {
        return Err("CHAPTER_STAGED_BEAT_PLAN_SOURCE_CHANGED".into());
    }
    Ok(plan)
}

pub(super) fn validate_state(value: &Value, prose: &str) -> Result<(), String> {
    const FIELDS: &[&str] = &[
        "schemaVersion",
        "sourceTextHash",
        "actualStateChange",
        "endState",
        "unknowns",
        "semanticValidation",
    ];
    let fields = value.as_object().ok_or("CHAPTER_STAGED_STATE_INVALID")?;
    if fields.len() != FIELDS.len()
        || fields.keys().any(|key| !FIELDS.contains(&key.as_str()))
        || value["schemaVersion"] != json!(1)
        || value["sourceTextHash"] != json!(large_text_repository::sha256(prose))
        || value["semanticValidation"] != json!("not_checked")
    {
        return Err("CHAPTER_STAGED_STATE_SOURCE_INVALID".into());
    }
    let changes = value["actualStateChange"]
        .as_array()
        .filter(|a| a.len() <= 32)
        .ok_or("CHAPTER_STAGED_STATE_INVALID")?;
    let unknowns = value["unknowns"]
        .as_array()
        .filter(|a| a.len() <= 32)
        .ok_or("CHAPTER_STAGED_STATE_INVALID")?;
    for item in unknowns {
        if !item
            .as_str()
            .is_some_and(|s| !s.trim().is_empty() && s.encode_utf16().count() <= 2_000)
        {
            return Err("CHAPTER_STAGED_STATE_INVALID".into());
        }
    }
    for fact in changes {
        validate_fact(fact, prose)?;
    }
    if value["endState"].is_null() {
        if unknowns.is_empty() {
            return Err("CHAPTER_STAGED_STATE_UNKNOWN_REQUIRED".into());
        }
    } else {
        validate_fact(&value["endState"], prose)?;
    }
    Ok(())
}

fn validate_fact(value: &Value, prose: &str) -> Result<(), String> {
    let fields = value
        .as_object()
        .ok_or("CHAPTER_STAGED_STATE_FACT_INVALID")?;
    if fields.len() != 3
        || !fields.contains_key("text")
        || !fields.contains_key("epistemic")
        || !fields.contains_key("evidence")
        || !["explicit", "uncertain"].contains(&value["epistemic"].as_str().unwrap_or(""))
    {
        return Err("CHAPTER_STAGED_STATE_FACT_INVALID".into());
    }
    let fact = text(value, "text", 8_000)?;
    if fact.encode_utf16().count() > 2_000 {
        return Err("CHAPTER_STAGED_STATE_FACT_INVALID".into());
    }
    let spans = value["evidence"]
        .as_array()
        .filter(|v| !v.is_empty() && v.len() <= 8)
        .ok_or("CHAPTER_STAGED_STATE_EVIDENCE_INVALID")?;
    let utf16: Vec<u16> = prose.encode_utf16().collect();
    for span in spans {
        let start = span["start"]
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or("CHAPTER_STAGED_STATE_EVIDENCE_INVALID")?;
        let end = span["end"]
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or("CHAPTER_STAGED_STATE_EVIDENCE_INVALID")?;
        let quote = text(span, "quote", 16_000)?;
        if span.as_object().map(|v| v.len()) != Some(3)
            || start >= end
            || end > utf16.len()
            || end - start > 4_000
            || String::from_utf16(&utf16[start..end]).ok().as_deref() != Some(quote)
        {
            return Err("CHAPTER_STAGED_STATE_EVIDENCE_INVALID".into());
        }
    }
    Ok(())
}

pub(super) fn split_binding<'a>(content: &'a str, expected: &Value) -> Result<&'a str, String> {
    use crate::services::chapter_workflow_stage_service::{
        BINDING_CLOSE_MARKER as CLOSE, BINDING_OPEN_MARKER as OPEN,
    };
    if content.matches(OPEN).count() != 1 || content.matches(CLOSE).count() != 1 {
        return Err("CHAPTER_STAGED_BINDING_INVALID".into());
    }
    let (body, rest) = content
        .split_once(OPEN)
        .ok_or("CHAPTER_STAGED_BINDING_INVALID")?;
    let (raw, tail) = rest
        .split_once(CLOSE)
        .ok_or("CHAPTER_STAGED_BINDING_INVALID")?;
    if !tail.trim().is_empty()
        || body.trim().is_empty()
        || serde_json::from_str::<Value>(raw.trim()).ok().as_ref() != Some(expected)
    {
        return Err("CHAPTER_STAGED_BINDING_MISMATCH".into());
    }
    Ok(body.trim())
}
