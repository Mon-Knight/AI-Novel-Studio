//! Pure offline summary response, grounded only in the replayed complete tool result.
use serde_json::{json, Value};

pub(super) fn grounded_summary(messages: &[Value]) -> Result<String, String> {
    fn source(value: &Value) -> Option<String> {
        if let Some(adopted) = value.pointer("/data/currentAdoptedDraft") {
            if adopted.get("truncated").and_then(Value::as_bool) == Some(false) {
                if let Some(text) = adopted
                    .get("content")
                    .and_then(Value::as_str)
                    .filter(|s| !s.trim().is_empty())
                {
                    return Some(text.into());
                }
            }
        }
        match value {
            Value::Object(map) => map.values().find_map(source),
            Value::Array(items) => items.iter().find_map(source),
            Value::String(text) => serde_json::from_str::<Value>(text)
                .ok()
                .as_ref()
                .and_then(source),
            _ => None,
        }
    }
    let text = messages
        .iter()
        .rev()
        .filter(|m| m["role"] == "tool")
        .find_map(|m| source(&m["content"]))
        .ok_or("DSH_MOCK_SUMMARY_COMPLETE_SOURCE_REQUIRED")?;
    let quote = text
        .trim()
        .split_inclusive(['。', '！', '？', '!', '?'])
        .find(|s| !s.trim().is_empty())
        .unwrap_or(text.trim())
        .trim()
        .chars()
        .take(1200)
        .collect::<String>();
    if quote.is_empty() {
        return Err("DSH_MOCK_SUMMARY_COMPLETE_SOURCE_REQUIRED".into());
    }
    let mut payload = json!({"summary":quote,"keyEvents":[quote],"factsMustRemember":[quote],"characterChanges":[],"contextRecords":[]});
    let claims = crate::services::summary_grounding::assertion_targets(&payload)
        .into_keys()
        .map(|path| json!({"path":path,"status":"confirmed","quotes":[quote]}))
        .collect::<Vec<_>>();
    payload["grounding"] = json!({"version":1,"claims":claims});
    Ok(payload.to_string())
}
