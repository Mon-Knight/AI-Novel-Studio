use super::{BackupRow, JsonValue};

pub(super) fn collect_reference_ids(rows: &[BackupRow], ids: &mut Vec<String>) {
    for row in rows {
        for column in [
            "large_text_ref_id",
            "body_ref_id",
            "compiled_context_ref_id",
            "prompt_template_ref_id",
            "raw_content_ref_id",
            "display_content_ref_id",
            "structured_payload_ref_id",
        ] {
            if let Some(id) = row.get(column).and_then(JsonValue::as_str) {
                ids.push(id.to_string());
            }
        }
        if let Some(id) = row
            .get("apply_transaction_id")
            .and_then(JsonValue::as_str)
            .filter(|id| id.starts_with("apply-rule-"))
        {
            ids.push(id.to_string());
        }
        if let Some(document_id) = row
            .get("result_json")
            .and_then(JsonValue::as_str)
            .and_then(|raw| serde_json::from_str::<JsonValue>(raw).ok())
            .and_then(|value| value.get("largeTextRefId").cloned())
            .and_then(|value| value.as_str().map(str::to_string))
        {
            ids.push(document_id);
        }
    }
}
