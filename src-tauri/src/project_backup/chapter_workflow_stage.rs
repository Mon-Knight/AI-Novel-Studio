use serde_json::Value as JsonValue;

use super::BackupRow;

pub(super) fn is_stage_table(table: &str) -> bool {
    table == "chapter_workflow_stages"
}

pub(super) fn validate_row(row: &BackupRow) -> bool {
    let has_non_empty_text = |column: &str| {
        row.get(column)
            .and_then(JsonValue::as_str)
            .is_some_and(|id| !id.trim().is_empty())
    };
    let text_is_one_of = |column: &str, allowed: &[&str]| {
        row.get(column)
            .and_then(JsonValue::as_str)
            .is_some_and(|value| allowed.contains(&value))
    };
    let optional_non_empty_text = |column: &str| match row.get(column) {
        None | Some(JsonValue::Null) => true,
        Some(JsonValue::String(value)) => !value.trim().is_empty(),
        Some(_) => false,
    };
    let optional_valid_json = |column: &str| match row.get(column) {
        None | Some(JsonValue::Null) => true,
        Some(JsonValue::String(value)) => serde_json::from_str::<JsonValue>(value).is_ok(),
        Some(_) => false,
    };

    has_non_empty_text("workflow_id")
        && has_non_empty_text("conversation_id")
        && has_non_empty_text("novel_id")
        && has_non_empty_text("chapter_id")
        && has_non_empty_text("run_id")
        && has_non_empty_text("stage_key")
        && text_is_one_of(
            "stage_kind",
            &[
                "scene_plan",
                "beat_plan",
                "beat_write",
                "beat_state",
                "scene_close",
                "chapter_assemble",
            ],
        )
        && text_is_one_of(
            "status",
            &["pending", "running", "succeeded", "failed", "cancelled"],
        )
        && row
            .get("plan_version")
            .and_then(JsonValue::as_i64)
            .is_some_and(|value| value >= 1)
        && row
            .get("attempt")
            .and_then(JsonValue::as_i64)
            .is_some_and(|value| value >= 1)
        && row
            .get("revision")
            .and_then(JsonValue::as_i64)
            .is_some_and(|value| value >= 1)
        && optional_non_empty_text("scene_id")
        && optional_non_empty_text("beat_id")
        && optional_non_empty_text("result_hash")
        && optional_non_empty_text("result_document_id")
        && optional_non_empty_text("verified_artifact_id")
        && optional_non_empty_text("error_code")
        && optional_valid_json("result_json")
}
