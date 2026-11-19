//! Native summary validation and source checks; shared context eligibility is reused by Gateway.
use crate::services::summary_grounding;
use serde_json::{json, Value};
#[path = "../../shared/summary_application_policy.rs"]
mod context_policy;
pub use context_policy::{
    eligible_summary_ids, eligible_summary_ids_json, summary_source_is_eligible,
};
pub use context_policy::{
    ensure_context_eligible, evaluate, SummaryApplicationMode, SummaryApplicationPolicy,
};

fn text_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn keywords(text: &str) -> Vec<&str> {
    text.split(|ch: char| {
        ch.is_whitespace() || "，。！？、；：\"'「」『』【】（）《》,.!?;:()[]{}".contains(ch)
    })
    .filter(|word| text_len(word) >= 2 && !word.bytes().all(|ch| ch.is_ascii_digit()))
    .collect()
}

fn string_rows<'a>(value: &'a Value, key: &str) -> impl Iterator<Item = &'a str> {
    value
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
}

/// Deterministically recheck the verified full adopted text, not model-reported safety flags.
/// Callers stamp manual/preauthorized provenance only after their corresponding authority check.
pub fn validate_summary(source: &str, payload: &Value, grounding_required: bool) -> Value {
    let lower = source.to_lowercase();
    let mut problems = Vec::new();
    let mut blocking_issues = Vec::new();
    let mut advisories = Vec::new();
    let mut block = |kind: &str, code: &str, path: &str, message: String| {
        problems.push(json!({"type":kind,"message":message}));
        blocking_issues.push(json!({"code":code,"path":path,"message":message}));
    };
    for (index, event) in string_rows(payload, "keyEvents").enumerate() {
        let words = keywords(event);
        let missing = words
            .iter()
            .filter(|word| !lower.contains(&word.to_lowercase()))
            .count();
        if words.len() >= 3 && missing * 5 >= words.len() * 3 {
            block(
                "fabrication",
                "SUMMARY_FABRICATION",
                &format!("/keyEvents/{index}"),
                "关键事件中的关键信息可能在正文中不存在。".to_string(),
            );
        }
    }
    for (index, change) in payload["characterChanges"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
    {
        let name = change["characterName"].as_str().unwrap_or("");
        if text_len(name) >= 2 && !lower.contains(&name.to_lowercase()) {
            block(
                "character_error",
                "SUMMARY_CHARACTER_ERROR",
                &format!("/characterChanges/{index}/characterName"),
                format!("角色「{name}」未在正文中出现，但总结中记录了其状态变化。"),
            );
        }
    }
    for (index, setting) in string_rows(payload, "settingChanges").enumerate() {
        let words = keywords(setting);
        let missing = words
            .iter()
            .filter(|word| !lower.contains(&word.to_lowercase()))
            .count();
        if words.len() >= 2 && missing * 2 >= words.len() {
            block(
                "setting_error",
                "SUMMARY_SETTING_ERROR",
                &format!("/settingChanges/{index}"),
                "设定变更在正文中可能缺乏依据。".to_string(),
            );
        }
    }
    if let Some(hook) = payload["nextChapterHook"]
        .as_str()
        .filter(|hook| text_len(hook) > 20)
    {
        let words = keywords(hook);
        let found = words
            .iter()
            .filter(|word| lower.contains(&word.to_lowercase()))
            .count();
        if words.len() >= 3 && found * 10 < words.len() * 3 {
            advisories.push(
                json!({"code":"SUMMARY_NEXT_CHAPTER_HOOK_SPECULATION","path":"/nextChapterHook",
                "message":"下一章衔接建议可能基于推测而非正文已有线索。"}),
            );
        }
    }
    let grounding = summary_grounding::validate(source, payload, grounding_required);
    for issue in &grounding {
        if issue.severity == "error" {
            block(
                "fabrication",
                issue.code,
                &issue.json_path,
                issue.message.clone(),
            );
        } else {
            advisories
                .push(json!({"code":issue.code,"path":issue.json_path,"message":issue.message}));
        }
    }
    let score = 100_usize.saturating_sub((problems.len() + advisories.len()) * 12);
    let passed = problems.is_empty();
    json!({
        "policyVersion":1,"passed":passed,"score":score,"problems":problems,
        "blockingIssues":blocking_issues,"advisories":advisories,"safeToContext":passed && score >= 70,
        "semanticValidation":"not_checked","reviewRequirement":if grounding.iter().any(|issue| context_policy::requires_human_review(issue.code)) {"human_required"} else {"none"},
        "evidenceValidation":if payload.get("grounding").is_none() {"missing"}
            else if grounding.iter().any(|issue| issue.severity == "error") {"failed"} else {"passed"},
        "grounding":payload.get("grounding"),
        "groundingIssues":grounding.iter().map(|issue| json!({"severity":issue.severity,"code":issue.code,
            "path":issue.json_path,"message":issue.message})).collect::<Vec<_>>()
    })
}

/// Reenabling old context cannot refresh its baseline from the current draft.
pub fn ensure_current_source(
    connection: &rusqlite::Connection,
    summary: &crate::domain::context::ChapterSummaryDto,
) -> Result<(), String> {
    use crate::repositories::draft_repository;
    use crate::services::draft_service;
    use rusqlite::{params, OptionalExtension};
    let changed = || "SUMMARY_SOURCE_CHANGED".to_string();
    if summary.is_expired {
        return Err(changed());
    }
    let current = connection.query_row(
        "SELECT adopted_draft_id FROM chapters WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL",
        params![summary.chapter_id, summary.novel_id], |row| row.get::<_, Option<String>>(0),
    ).optional().map_err(|error| error.to_string())?.flatten();
    if current.as_deref() != Some(summary.adopted_draft_id.as_str()) {
        return Err(changed());
    }
    let draft = draft_repository::find_draft(connection, &summary.adopted_draft_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(changed)?;
    if !draft.is_adopted
        || draft.novel_id != summary.novel_id
        || draft.chapter_id != summary.chapter_id
    {
        return Err(changed());
    }
    let full =
        draft_service::load_full_content(connection, &draft).map_err(|error| error.to_string())?;
    if summary
        .content_hash
        .as_deref()
        .is_none_or(|hash| !hash.eq_ignore_ascii_case(&full.content_hash))
        || summary.draft_version != Some(draft.version_no)
    {
        return Err(changed());
    }
    Ok(())
}

#[cfg(test)]
#[path = "summary_application_policy_tests.rs"]
mod tests;
