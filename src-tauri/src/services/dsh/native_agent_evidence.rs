//! Optional upstream budget guard and hash-only Real-E2E request evidence for native dispatch.
//!
//! Preserves exact parity with the test-only budget and canary-hash diagnostics previously
//! enforced inside `model-proxy.mjs`, without spawning an external Node proxy process.

use crate::repositories::large_text_repository;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

const CREATIVE_BRIEF_MARKER: &str = "[[ANS_CREATIVE_BRIEF:v1]]";
const AUTOMATIC_ASSET_TURN_MARKER: &str =
    "[[ANS_WORKBENCH_TURN:v1;origin=workbench_asset_preparation]]";
const AUTOMATIC_CHAPTER_SUMMARY_TURN_MARKER: &str =
    "[[ANS_WORKBENCH_TURN:v1;origin=workbench_chapter_summary]]";
const PROVIDER_EVIDENCE_SCHEMA_VERSION: &str = "real_conversation_provider_request_evidence_v1";

const AUTOMATIC_ASSET_INSTRUCTIONS: &[(&str, &str)] = &[
    ("生成世界与规则设定候选", "world_setting"),
    ("生成世界设定候选", "world_setting"),
    ("生成规则设定候选", "rule_system"),
    ("生成主角候选", "protagonist"),
    ("生成全书规划候选", "story_plan"),
    ("生成本章大纲候选", "chapter_outline"),
];

pub(super) fn enforce_upstream_budget_if_configured(
    target_url: &reqwest::Url,
    upstream_base: &str,
    model: &str,
) -> Result<bool, String> {
    let Ok(raw) = std::env::var("PROXY_UPSTREAM_REQUEST_BUDGET") else {
        return Ok(false);
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(false);
    }
    let file = std::env::var("PROXY_UPSTREAM_BUDGET_FILE")
        .unwrap_or_default()
        .trim()
        .to_string();
    let frozen_upstream = std::env::var("PROXY_FROZEN_UPSTREAM")
        .unwrap_or_default()
        .trim()
        .to_string();
    let frozen_model = std::env::var("PROXY_FROZEN_MODEL")
        .unwrap_or_default()
        .trim()
        .to_string();
    let file_lower = file.to_ascii_lowercase();
    if raw != "6"
        || file.is_empty()
        || !Path::new(&file).is_absolute()
        || file_lower.contains("ai-novel-studio.db")
        || file_lower.contains("com.ainovelstudio.app")
        || frozen_upstream.is_empty()
        || frozen_model.is_empty()
    {
        return Err("UPSTREAM_BUDGET_UNAVAILABLE: 上游测试预算配置不完整".to_string());
    }
    let frozen = reqwest::Url::parse(&frozen_upstream)
        .map_err(|_| "UPSTREAM_IDENTITY_MISMATCH: 冻结上游地址无效".to_string())?;
    let actual = reqwest::Url::parse(upstream_base)
        .map_err(|_| "UPSTREAM_IDENTITY_MISMATCH: 实际上游地址无效".to_string())?;
    let frozen_path = frozen.path().trim_end_matches('/');
    let actual_path = actual.path().trim_end_matches('/');
    if frozen.origin() != actual.origin()
        || !frozen.username().is_empty()
        || frozen.password().is_some()
        || frozen.query().is_some()
        || frozen.fragment().is_some()
        || frozen_path != actual_path
        || target_url.origin() != frozen.origin()
        || !target_url.username().is_empty()
        || target_url.password().is_some()
        || (!frozen_path.is_empty()
            && frozen_path != "/"
            && !target_url.path().starts_with(frozen_path))
    {
        return Err("UPSTREAM_IDENTITY_MISMATCH: 上游请求目标偏离冻结身份".to_string());
    }
    if frozen_model != model {
        return Err("UPSTREAM_MODEL_MISMATCH: 上游请求模型偏离冻结身份".to_string());
    }
    claim_upstream_send(Path::new(&file), 6)?;
    Ok(true)
}

fn claim_upstream_send(file: &Path, limit: u64) -> Result<(), String> {
    let lock_path = PathBuf::from(format!("{}.lock", file.display()));
    for _ in 0..100 {
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(lock_file) => {
                drop(lock_file);
                let result = (|| {
                    let current = if file.exists() {
                        let text = fs::read_to_string(file)
                            .map_err(|_| "UPSTREAM_BUDGET_UNAVAILABLE".to_string())?;
                        let trimmed = text.trim();
                        if trimmed.is_empty()
                            || trimmed.len() > 9
                            || !trimmed.bytes().all(|b| b.is_ascii_digit())
                        {
                            return Err("UPSTREAM_BUDGET_UNAVAILABLE".to_string());
                        }
                        trimmed
                            .parse::<u64>()
                            .map_err(|_| "UPSTREAM_BUDGET_UNAVAILABLE".to_string())?
                    } else {
                        0
                    };
                    if current >= limit {
                        return Err("UPSTREAM_BUDGET_EXCEEDED: 已达到测试上游发送上限".to_string());
                    }
                    fs::write(file, (current + 1).to_string())
                        .map_err(|_| "UPSTREAM_BUDGET_UNAVAILABLE".to_string())
                })();
                let _ = fs::remove_file(&lock_path);
                return result;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let until = Instant::now() + Duration::from_millis(5);
                while Instant::now() < until {
                    thread::yield_now();
                }
            }
            Err(_) => return Err("UPSTREAM_BUDGET_UNAVAILABLE".to_string()),
        }
    }
    Err("UPSTREAM_BUDGET_UNAVAILABLE".to_string())
}

fn collect_string_leaves<'a>(value: &'a Value, target: &mut Vec<&'a str>) {
    match value {
        Value::String(text) => target.push(text.as_str()),
        Value::Array(items) => {
            for item in items {
                collect_string_leaves(item, target);
            }
        }
        Value::Object(map) => {
            for item in map.values() {
                collect_string_leaves(item, target);
            }
        }
        _ => {}
    }
}

fn parse_creative_brief(latest_user: &str) -> (&'static str, Value) {
    let Some(index) = latest_user.rfind(CREATIVE_BRIEF_MARKER) else {
        return ("absent", Value::Null);
    };
    let tail = latest_user[index + CREATIVE_BRIEF_MARKER.len()..].trim_start();
    let line = tail.lines().next().unwrap_or("");
    let Ok(parsed) = serde_json::from_str::<Value>(line) else {
        return ("invalid", Value::Null);
    };
    let content = parsed.get("content").and_then(Value::as_str).unwrap_or("");
    if parsed.get("schema").and_then(Value::as_str) != Some("ans_core_asset_creative_brief_v1")
        || parsed.get("source").and_then(Value::as_str) != Some("original_user_goal")
        || content.trim().is_empty()
    {
        return ("invalid", Value::Null);
    }
    (
        "valid",
        json!({
            "schema": "ans_core_asset_creative_brief_v1",
            "source": "original_user_goal",
            "contentSha256": large_text_repository::sha256(content),
            "contentLength": content.encode_utf16().count(),
        }),
    )
}

pub(super) fn write_real_e2e_provider_evidence_if_enabled(
    provider_request_id: &str,
    serialized_body: &str,
    parsed_body: &Value,
) -> Result<(), String> {
    if std::env::var("AI_NOVEL_STUDIO_REAL_E2E").as_deref() != Ok("1") {
        return Ok(());
    }
    let directory = std::env::var("AI_NOVEL_STUDIO_REAL_E2E_PROVIDER_EVIDENCE_DIR")
        .unwrap_or_default()
        .trim()
        .to_string();
    let raw_canaries = std::env::var("AI_NOVEL_STUDIO_REAL_E2E_PREPARED_FIXTURE_CANARIES_JSON")
        .unwrap_or_default()
        .trim()
        .to_string();
    if directory.is_empty() || raw_canaries.is_empty() {
        return Ok(());
    }
    let canaries_json: Vec<Value> = serde_json::from_str(&raw_canaries)
        .map_err(|_| "real-E2E prepared-fixture canaries are not valid JSON".to_string())?;
    let mut configured_ids = Vec::new();
    let mut seen = HashSet::new();
    let mut canaries = Vec::new();
    for item in canaries_json {
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let value = item
            .get("value")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if id.is_empty() || value.trim().is_empty() || !seen.insert(id.clone()) {
            return Err("real-E2E prepared-fixture canary has an invalid shape".to_string());
        }
        configured_ids.push(id.clone());
        canaries.push((id, value));
    }
    let empty_messages = Vec::new();
    let messages = parsed_body
        .get("messages")
        .and_then(Value::as_array)
        .unwrap_or(&empty_messages);
    let mut message_strings = Vec::new();
    for msg in messages {
        collect_string_leaves(msg, &mut message_strings);
    }
    let latest_user = messages
        .iter()
        .rev()
        .find(|m| m.get("role").and_then(Value::as_str) == Some("user"))
        .and_then(|m| m.get("content"))
        .map(|content| {
            let mut parts = Vec::new();
            collect_string_leaves(content, &mut parts);
            parts.join("\n")
        })
        .unwrap_or_default();
    let asset_kind = AUTOMATIC_ASSET_INSTRUCTIONS
        .iter()
        .find(|(instruction, _)| latest_user.contains(&format!("用户意图：{instruction}")))
        .map(|(_, kind)| *kind);
    let (brief_status, brief_value) = parse_creative_brief(&latest_user);
    let turn_origin = if latest_user.contains(AUTOMATIC_CHAPTER_SUMMARY_TURN_MARKER) {
        Some("workbench_chapter_summary")
    } else if latest_user.contains(AUTOMATIC_ASSET_TURN_MARKER) {
        Some("workbench_asset_preparation")
    } else {
        None
    };
    let matched_ids: Vec<String> = canaries
        .iter()
        .filter(|(_, canary)| message_strings.iter().any(|text| text.contains(canary)))
        .map(|(id, _)| id.clone())
        .collect();
    let request_sha = large_text_repository::sha256(provider_request_id);
    let messages_serialized = serde_json::to_string(messages).unwrap_or_else(|_| "[]".into());
    let strings_serialized =
        serde_json::to_string(&message_strings).unwrap_or_else(|_| "[]".into());
    let marker_count: usize = message_strings
        .iter()
        .map(|text| text.matches(CREATIVE_BRIEF_MARKER).count())
        .sum();
    let classification = if turn_origin == Some("workbench_chapter_summary") {
        "automatic_chapter_summary"
    } else if asset_kind.is_some() && brief_status == "valid" && turn_origin.is_some() {
        "automatic_asset_preparation"
    } else {
        "other"
    };
    let evidence = json!({
        "schemaVersion": PROVIDER_EVIDENCE_SCHEMA_VERSION,
        "captureMode": "hash_only",
        "hashAlgorithm": "sha256",
        "messagesSerialization": "json_stringify_messages_v1",
        "providerRequestIdSha256": request_sha,
        "requestBodySha256": large_text_repository::sha256(serialized_body),
        "messagesSha256": large_text_repository::sha256(&messages_serialized),
        "messageCount": messages.len(),
        "messageTextSha256": large_text_repository::sha256(&strings_serialized),
        "messageTextCount": message_strings.len(),
        "latestUserMessageSha256": large_text_repository::sha256(&latest_user),
        "latestUserMessageLength": latest_user.encode_utf16().count(),
        "classification": classification,
        "turnOrigin": turn_origin,
        "assetKind": asset_kind,
        "creativeBriefParseStatus": brief_status,
        "creativeBrief": brief_value,
        "creativeBriefMarkerCount": marker_count,
        "latestUserCreativeBriefMarkerCount": latest_user.matches(CREATIVE_BRIEF_MARKER).count(),
        "configuredPreparedFixtureCanaryIds": configured_ids,
        "matchedPreparedFixtureCanaryIds": matched_ids,
        "rawMessageContentPersisted": false,
    });
    let target = Path::new(&directory).join(format!("{request_sha}.json"));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|e| format!("real-E2E evidence write failed: {e}"))?;
    let payload = serde_json::to_string_pretty(&evidence).map_err(|e| e.to_string())?;
    file.write_all(payload.as_bytes())
        .map_err(|e| format!("real-E2E evidence flush failed: {e}"))
}
