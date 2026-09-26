//! Narrow derived-artifact gate, evaluated inside the existing Artifact IMMEDIATE transaction.
use super::revision_source::{
    invalid_source, verify_source, ArtifactRevisionSource, DERIVATION_TYPE,
};
use super::CreateResultArtifactInput;
use crate::errors::AppError;
use crate::repositories::ai_task_repository::AiTaskRecord;
use crate::services::ai_task_service;
use rusqlite::Connection;
use serde_json::Value;

fn normalize_compilation_text(value: &str) -> String {
    // ECMAScript String.trim(), matching src/services/ai/compilation/canonical.ts.
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim_matches(|c| {
            matches!(c,
                '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
                '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' |
                '\u{205f}' | '\u{3000}' | '\u{feff}'
            )
        })
        .to_string()
}

fn request_contains_source(body: &Value, raw: &str) -> bool {
    let normalized = normalize_compilation_text(raw);
    !normalized.is_empty()
        && body
            .get("messages")
            .and_then(Value::as_array)
            .is_some_and(|messages| {
                messages.iter().any(|message| {
                    message
                        .get("content")
                        .and_then(Value::as_str)
                        .is_some_and(|text| normalize_compilation_text(text).contains(&normalized))
                })
            })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn original_hash_material_allows_only_compiler_whitespace_normalization() {
        let raw = " \r\n甲\r\n乙\r丙\n ";
        assert!(request_contains_source(
            &json!({"messages":[{"role":"user","content":"材料：\n甲\n乙\n丙\n结束"}]}),
            raw
        ));
        assert!(!request_contains_source(
            &json!({"messages":[{"role":"user","content":"甲\n乙"}]}),
            raw
        ));
        assert!(!request_contains_source(
            &json!({"source":raw,"messages":[{"content":"only an artifact id"}]}),
            raw
        ));
        assert!(!request_contains_source(
            &json!({"messages":[{"content":serde_json::to_string(raw).expect("JSON")}]}),
            raw
        ));
        assert_eq!(normalize_compilation_text("\u{feff}A\u{feff}"), "A");
        assert_eq!(
            normalize_compilation_text("\u{0085}A\u{0085}"),
            "\u{0085}A\u{0085}"
        );
    }
}

pub(super) fn validate(
    connection: &Connection,
    input: &CreateResultArtifactInput,
    task: &AiTaskRecord,
) -> Result<(), AppError> {
    if input.artifact_type != "chapter_text"
        || input.schema_version != 1
        || input.derivation_type.as_deref() != Some(DERIVATION_TYPE)
        || input.parent_artifact_id.is_none()
    {
        return Err(invalid_source());
    }
    // This re-hashes input/context/constraints and the request identity, not only JSON fields.
    let detail = ai_task_service::get_task_detail(connection, &task.task_id)?;
    let payload = &detail.input_snapshot.snapshot.payload_json;
    let metadata = match detail.input_snapshot.snapshot.input_type.as_str() {
        "workbench_dsh_messages_v1" => payload,
        "compiled_provider_messages_v1" => payload.get("taskInput").ok_or_else(invalid_source)?,
        _ => return Err(invalid_source()),
    };
    let source: ArtifactRevisionSource = serde_json::from_value(
        metadata
            .get("revisionSource")
            .ok_or_else(invalid_source)?
            .clone(),
    )
    .map_err(|_| invalid_source())?;
    let context_source: ArtifactRevisionSource = serde_json::from_value(
        detail
            .context_snapshot
            .snapshot
            .source_manifest_json
            .get("revisionSource")
            .ok_or_else(invalid_source)?
            .clone(),
    )
    .map_err(|_| invalid_source())?;
    if source != context_source
        || input.parent_artifact_id.as_deref() != Some(source.artifact_id.as_str())
        || metadata.get("parentArtifactId").and_then(Value::as_str)
            != Some(source.artifact_id.as_str())
        || metadata.get("sourceArtifactId").and_then(Value::as_str)
            != Some(source.artifact_id.as_str())
        || metadata.get("sourceContentHash").and_then(Value::as_str)
            != Some(source.artifact_hash.as_str())
        || metadata.get("derivationType").and_then(Value::as_str) != Some(DERIVATION_TYPE)
    {
        return Err(invalid_source());
    }
    let verified = verify_source(
        connection,
        &source,
        &task.novel_id,
        task.chapter_id.as_deref(),
    )?;
    // Inspect decoded actual request messages, not an escaped JSON substring or a
    // manifest-only promise. The provider compiler normalizes CRLF/CR and outer whitespace.
    let body: Value =
        serde_json::from_str(&detail.input_snapshot.body).map_err(|_| invalid_source())?;
    if !request_contains_source(&body, &verified.content) {
        return Err(invalid_source());
    }
    Ok(())
}
