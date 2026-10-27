//! Dedicated stage-submission sink for chapter workflow stages.
//!
//! `submit_chapter_stage` validates one model-authored stage payload and returns
//! only a digest envelope. The native chapter workflow host re-reads the real
//! tool arguments, verifies the content again, and persists the stage result
//! through its own service. This module never writes SQLite, never creates an
//! Artifact, and is deliberately not part of the chapter-candidate tools.
//!
//! Availability is explicit and additive: the task allowlist must literally
//! contain `submit_chapter_stage`. A missing `ANS_ALLOWED_TOOLS`, a Canonical-only
//! allowlist, and every legacy candidate allowlist neither list nor dispatch it.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

pub(crate) const TOOL_NAME: &str = "submit_chapter_stage";
pub(crate) const STAGE_SUBMISSION_VERSION: u64 = 1;

/// Mirrors the gateway identifier ceiling used by the legacy tools.
const ID_MAX: usize = 160;
const STAGE_KEY_MAX_BYTES: usize = 200;
/// 256 KiB measured as UTF-8 bytes, not Unicode scalar values.
const CONTENT_MAX_BYTES: usize = 256 * 1024;
/// Only stages authored by the model. `scene_close` and `chapter_assemble` are
/// host-owned stages and must stay unavailable to the model.
const STAGE_KINDS: &[&str] = &["scene_plan", "beat_plan", "beat_write", "beat_state"];
const INPUT_FIELDS: &[&str] = &["novelId", "chapterId", "stageKey", "stageKind", "content"];
const NOT_ENABLED: &str = "submit_chapter_stage is not enabled for this task";

pub(crate) fn is_tool(name: &str) -> bool {
    name == TOOL_NAME
}

pub(crate) fn is_explicitly_allowed(allowed: &HashSet<String>) -> bool {
    allowed.contains(TOOL_NAME)
}

/// Appends the schema only when the task allowlist names this tool explicitly.
/// Callers keep their existing filters, so no other tool becomes visible.
pub(crate) fn append_listed(tools: &mut Vec<Value>, allowed: &HashSet<String>) {
    if is_explicitly_allowed(allowed) {
        tools.push(schema());
    }
}

pub(crate) fn schema() -> Value {
    json!({
        "name": TOOL_NAME,
        "description": "提交当前章节一个写作阶段的完整内容，返回原生宿主复验用的摘要。仅当任务显式授权时可用；不是章节候选，不生成 Artifact，不写数据库或正式数据，也不代表自动采用。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "novelId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                "chapterId": {"type": "string", "minLength": 1, "maxLength": ID_MAX},
                "stageKey": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": STAGE_KEY_MAX_BYTES,
                    "description": "宿主契约中的稳定阶段键；UTF-8 字节数不超过 200。"
                },
                "stageKind": {
                    "type": "string",
                    "enum": STAGE_KINDS,
                    "description": "仅模型可产出的四个阶段；scene_close 与 chapter_assemble 由宿主完成，不能提交。"
                },
                "content": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": CONTENT_MAX_BYTES,
                    "description": "本阶段完整内容；非空，UTF-8 字节数不超过 262144（256 KiB）。原样参与 SHA-256。"
                }
            },
            "required": INPUT_FIELDS,
            "additionalProperties": false
        },
        "outputSchema": {
            "type": "object",
            "properties": {
                "ok": {"type": "boolean", "enum": [true]},
                "stageSubmissionVersion": {"type": "integer", "enum": [STAGE_SUBMISSION_VERSION]},
                "stageKey": {"type": "string", "minLength": 1, "maxLength": STAGE_KEY_MAX_BYTES},
                "stageKind": {"type": "string", "enum": STAGE_KINDS},
                "contentHash": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                "contentChars": {"type": "integer", "minimum": 1}
            },
            "required": [
                "ok",
                "stageSubmissionVersion",
                "stageKey",
                "stageKind",
                "contentHash",
                "contentChars"
            ],
            "additionalProperties": false
        }
    })
}

/// Borrowed DTO for one validated stage submission.
struct StageSubmission<'a> {
    novel_id: &'a str,
    chapter_id: &'a str,
    stage_key: &'a str,
    stage_kind: &'a str,
    content: &'a str,
}

fn parse(arguments: &Value) -> Result<StageSubmission<'_>, String> {
    let fields = arguments
        .as_object()
        .ok_or_else(|| "submit_chapter_stage arguments must be a JSON object".to_string())?;
    if fields
        .keys()
        .any(|key| !INPUT_FIELDS.contains(&key.as_str()))
    {
        return Err("submit_chapter_stage rejected unknown arguments".to_string());
    }
    if fields.len() != INPUT_FIELDS.len() {
        return Err(
            "submit_chapter_stage requires novelId, chapterId, stageKey, stageKind and content"
                .to_string(),
        );
    }
    Ok(StageSubmission {
        novel_id: string_field(fields, "novelId")?,
        chapter_id: string_field(fields, "chapterId")?,
        stage_key: string_field(fields, "stageKey")?,
        stage_kind: string_field(fields, "stageKind")?,
        content: string_field(fields, "content")?,
    })
}

fn string_field<'a>(
    fields: &'a serde_json::Map<String, Value>,
    name: &str,
) -> Result<&'a str, String> {
    fields
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("submit_chapter_stage requires string field: {name}"))
}

fn validate(submission: &StageSubmission<'_>) -> Result<(), String> {
    if submission.novel_id.trim().is_empty() || submission.novel_id.len() > ID_MAX {
        return Err("novelId must be a non-empty bounded identifier".to_string());
    }
    if submission.chapter_id.trim().is_empty() || submission.chapter_id.len() > ID_MAX {
        return Err("chapterId must be a non-empty bounded identifier".to_string());
    }
    let stage_key = submission.stage_key.trim();
    if stage_key.is_empty() || stage_key.len() > STAGE_KEY_MAX_BYTES {
        return Err(
            "stageKey must be a non-empty UTF-8 identifier of at most 200 bytes".to_string(),
        );
    }
    if !STAGE_KINDS.contains(&submission.stage_kind) {
        return Err("stageKind is not a supported model stage".to_string());
    }
    if submission.content.trim().is_empty() {
        return Err("content must be a non-empty UTF-8 string".to_string());
    }
    if submission.content.len() > CONTENT_MAX_BYTES {
        return Err("content must not exceed 262144 UTF-8 bytes".to_string());
    }
    Ok(())
}

/// Validates and digests one stage submission.
///
/// The allowlist is required and re-checked here so a direct dispatch can never
/// bypass the task gate. Scope binding is enforced by the caller before this
/// function runs because a stage requires an authoritative novel/chapter task
/// scope.
pub(crate) fn call(
    arguments: &Value,
    allowed_tools: Option<&HashSet<String>>,
) -> Result<Value, String> {
    let allowed = allowed_tools.ok_or_else(|| NOT_ENABLED.to_string())?;
    if !is_explicitly_allowed(allowed) {
        return Err(NOT_ENABLED.to_string());
    }
    let submission = parse(arguments)?;
    validate(&submission)?;
    Ok(json!({
        "ok": true,
        "stageSubmissionVersion": STAGE_SUBMISSION_VERSION,
        "stageKey": submission.stage_key.trim(),
        "stageKind": submission.stage_kind,
        "contentHash": sha256_hex(submission.content),
        "contentChars": submission.content.chars().count()
    }))
}

fn sha256_hex(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}
