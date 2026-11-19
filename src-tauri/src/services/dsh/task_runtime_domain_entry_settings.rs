//! Native projection into the existing pending setting candidate pool.
use super::{context, value_string, StartTaskTurnInput};
use crate::commands::setting_suggestions::{
    save_setting_suggestions_with, SaveSettingSuggestionInput,
};
use crate::services::world_rule_governance;
use rusqlite::Connection;
use serde_json::{json, Value};
#[path="task_runtime_domain_entry_settings_context.rs"]
mod sources;

pub(super) fn prepare(
    connection: &Connection,
    input: &StartTaskTurnInput,
    request: &Value,
) -> Result<Value, String> {
    if value_string(request, "novelId")? != input.require_novel_id()? || input.chapter_id.is_some() {
        return Err("DOMAIN_ENTRY_SCOPE_MISMATCH".to_string());
    }
    if request.as_object().is_none_or(|object|object.keys().any(|key|!["novelId","suggestionType","worldType","referenceStyle","count","userInstruction","includeWorldSettings","includeExistingAssets"].contains(&key.as_str()))){return Err("SETTING_SUGGESTION_INPUT_INVALID".to_string());}
    let suggestion_type = value_string(request, "suggestionType")?;
    if !["character", "faction", "location", "rule"].contains(&suggestion_type)
        || !request["count"]
            .as_u64()
            .is_some_and(|count| (1..=50).contains(&count))
        || !request["includeWorldSettings"].is_boolean()
        || !request["includeExistingAssets"].is_boolean()
    {
        return Err("SETTING_SUGGESTION_INPUT_INVALID".to_string());
    }
    for key in ["worldType", "referenceStyle"] {
        if !request
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|text| text.len() <= 10_000)
        {
            return Err("SETTING_SUGGESTION_INPUT_INVALID".to_string());
        }
    }
    let snapshot = world_rule_governance::rule_set_snapshot(connection, input.require_novel_id()?)
        .map_err(|error| error.to_string())?;
    let selected_context=sources::capture(connection,input.require_novel_id()?,request)?;
    let fields=match suggestion_type {
        "character"=>vec!["name","identity","faction","personality","goal","ability","weakness","current_status","plot_role","mainline_relation"],
        "faction"=>vec!["name","type","leader","goal","resources","allies","enemies","territory","internal_conflict","plot_role"],
        "location"=>vec!["name","type","region","controlled_by","description","danger_level","resource","history","plot_trigger"],
        "rule"=>vec!["name","type","content","limits","scope","possible_conflict","plot_usage"],
        _=>return Err("SETTING_SUGGESTION_INPUT_INVALID".to_string()),
    };
    Ok(json!({
        "entryKind":"setting_suggestions", "stageKey":"generate_candidates",
        "request":request, "nativeRuleSet":{"novelId":snapshot.novel_id,"fingerprint":snapshot.fingerprint},"selectedContext":selected_context,"candidateFields":fields,
        "schema":super::candidate_schema::schema("setting_suggestions", "generate_candidates")?,
        "instructions":"payload.items 为非空候选对象数组；数量不得超过 request.count；每项必须有非空 name，字段值均为字符串。角色、势力、地点、规则严格区分。规则与已采用事实始终是约束；includeWorldSettings/includeExistingAssets 仅控制额外提示，不解除已有规则。新候选保持 pending，不能自行声明采纳、授权或人工审阅。"
    }))
}

pub(super) fn accept(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    request: &Value,
    artifact_id: &str,
    payload: &Value,
) -> Result<(), String> {
    if payload.as_object().is_none_or(|object| object.len() != 1) {
        return Err("SETTING_CANDIDATE_SCHEMA_INVALID".to_string());
    }
    let items = payload["items"]
        .as_array()
        .filter(|items| {
            !items.is_empty() && items.len() <= request["count"].as_u64().unwrap_or(0) as usize
        })
        .ok_or("SETTING_CANDIDATE_COUNT_INVALID")?;
    let stage = context(input)?;
    sources::validate_sources(connection,input.require_novel_id()?,&stage["selectedContext"])?;
    let fingerprint = stage
        .pointer("/nativeRuleSet/fingerprint")
        .and_then(Value::as_str)
        .ok_or("SETTING_CANDIDATE_BASELINE_REQUIRED")?;
    let mut batch = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let object = item
            .as_object()
            .filter(|object| !object.is_empty() && object.values().all(Value::is_string))
            .ok_or("SETTING_CANDIDATE_SCHEMA_INVALID")?;
        value_string(item, "name")?;
        let save = json!({
            "id":format!("domain-setting-{artifact_id}-{index}"), "novelId":input.novel_id,
            "suggestionType":request["suggestionType"], "worldType":request["worldType"],
            "referenceStyle":request["referenceStyle"], "prompt":stage.to_string(),
            "resultJson":json!({"runtimeArtifactId":artifact_id,"conversationId":input.conversation_id,"item":item}).to_string(),
            "expectedRuleSetFingerprint":fingerprint,"item":object,"status":"pending",
            "userInstruction":request.get("userInstruction"),"rawOutput":payload.to_string()
        });
        batch.push(
            serde_json::from_value::<SaveSettingSuggestionInput>(save)
                .map_err(|_| "SETTING_CANDIDATE_SCHEMA_INVALID")?,
        );
    }
    // This existing IMMEDIATE transaction revalidates the fingerprint for every
    // candidate and commits the batch atomically. It never adopts a formal asset.
    save_setting_suggestions_with(connection, batch).map(|_| ())
}
