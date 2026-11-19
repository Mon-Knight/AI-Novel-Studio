//! Candidate-only domain stage protocol. No SQL writes and no execution authority.
use rusqlite::{params, Connection};
use serde_json::{json, Value};
#[path = "../../shared/domain_candidate_schema.rs"]
mod domain_candidate_schema;

pub fn tool_schema() -> Value {
    json!({"name":"domain.submit_candidate","description":"提交当前宿主指定领域阶段的结构化候选；不会应用、采用或授权。",
        "inputSchema":{"type":"object","additionalProperties":false,"required":["novelId","entryKind","stageKey","payload"],
            "properties":{"novelId":{"type":"string","minLength":1,"maxLength":160},"chapterId":{"type":"string","minLength":1,"maxLength":160},
                "entryKind":{"enum":["outline_generate","autonomous_plan","setting_suggestions","autonomous_chapter","autonomous_post_chapter"]},
                "stageKey":{"type":"string","minLength":1,"maxLength":200},"payload":{"type":"object"}}}})
}

pub fn submit_candidate(connection: &Connection, arguments: &Value) -> Result<Value, String> {
    let object = arguments
        .as_object()
        .ok_or("DOMAIN_CANDIDATE_INPUT_INVALID")?;
    if object.keys().any(|key| {
        !["novelId", "chapterId", "entryKind", "stageKey", "payload"].contains(&key.as_str())
    }) {
        return Err("DOMAIN_CANDIDATE_INPUT_INVALID".to_string());
    }
    let novel_id = required(arguments, "novelId", 160)?;
    let kind = required(arguments, "entryKind", 80)?;
    let stage = required(arguments, "stageKey", 200)?;
    let payload = arguments
        .get("payload")
        .filter(|value| value.is_object())
        .ok_or("DOMAIN_CANDIDATE_PAYLOAD_INVALID")?;
    if serde_json::to_vec(payload)
        .map_err(|error| error.to_string())?
        .len()
        > 400_000
    {
        return Err("DOMAIN_CANDIDATE_TOO_LARGE".to_string());
    }
    if !valid_stage(kind, stage) {
        return Err("DOMAIN_CANDIDATE_STAGE_UNKNOWN".to_string());
    }
    domain_candidate_schema::validate(&domain_candidate_schema::schema(kind, stage)?, payload)?;
    if crate::secret_guard::contains_secret_value(payload) {
        return Err("DOMAIN_CANDIDATE_SECRET_REJECTED".to_string());
    }
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM novels WHERE id=?1 AND deleted_at IS NULL)",
            params![novel_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !exists {
        return Err("DOMAIN_CANDIDATE_NOVEL_NOT_FOUND".to_string());
    }
    let chapter_id = arguments
        .get("chapterId")
        .map(|_| required(arguments, "chapterId", 160))
        .transpose()?;
    if let Some(chapter_id) = chapter_id {
        let belongs: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM chapters WHERE id=?1 AND novel_id=?2)",
                params![chapter_id, novel_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if !belongs {
            return Err("DOMAIN_CANDIDATE_SCOPE_MISMATCH".to_string());
        }
    }
    if matches!(kind, "autonomous_chapter" | "autonomous_post_chapter") && chapter_id.is_none() {
        return Err("DOMAIN_CANDIDATE_CHAPTER_REQUIRED".to_string());
    }
    let envelope = json!({"entryKind":kind,"stageKey":stage,"payload":payload});
    let mut data = json!({"novelId":novel_id,"text":envelope.to_string()});
    if let Some(chapter_id) = chapter_id {
        data["chapterId"] = json!(chapter_id);
    }
    Ok(
        json!({"ok":true,"toolVersion":"v1","artifactType":"generic_json","candidateOnly":true,"data":data}),
    )
}

fn required<'a>(value: &'a Value, key: &str, max: usize) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty() && text.chars().count() <= max)
        .ok_or_else(|| format!("DOMAIN_CANDIDATE_FIELD_INVALID: {key}"))
}

fn valid_stage(kind: &str, stage: &str) -> bool {
    match kind {
        "outline_generate"=>["editor_text","volume_candidate","chapter_candidates"].contains(&stage),
        "setting_suggestions" => stage == "generate_candidates",
        "autonomous_plan" => {
            ["foundation", "characters", "world", "conflicts", "pacing"].contains(&stage)
                || stage.strip_prefix("chapters:").is_some_and(|range| {
                    range.split_once('-').is_some_and(|(start, end)| {
                        start.parse::<u16>().is_ok() && end.parse::<u16>().is_ok()
                    })
                })
        }
        "autonomous_chapter" => stage.starts_with("review:") || stage == "editor_revision",
        "autonomous_post_chapter" => stage == "analyze_adopted",
        _ => false,
    }
}
