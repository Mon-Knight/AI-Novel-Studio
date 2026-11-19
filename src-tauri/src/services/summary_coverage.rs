//! Versioned completeness contract for chapter-summary candidates.
//!
//! The contract proves that a candidate explicitly declared `characterChanges` and
//! `contextRecords`. Empty arrays mean "checked, no change"; omitted fields do not.
//! It is not a semantic proof that every change in the adopted prose was captured.

use serde::Serialize;
use serde_json::Value;

pub const VERSION: i64 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Depth {
    /// Admission: require the two top-level arrays but defer item semantics.
    Presence,
    /// Apply: require every field the context transaction consumes.
    Complete,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverageIssue {
    pub severity: &'static str,
    pub code: &'static str,
    pub message: String,
    pub json_path: String,
}

fn error(code: &'static str, path: &str, message: impl Into<String>) -> CoverageIssue {
    CoverageIssue {
        severity: "error",
        code,
        message: message.into(),
        json_path: path.to_string(),
    }
}

/// The host writes this marker into the summary task's immutable Input Snapshot.
/// Historical candidates without the marker stay on the previous contract.
pub fn required_by_snapshot(snapshot: Option<&Value>) -> bool {
    snapshot
        .and_then(|payload| payload.get("summaryCoverageVersion"))
        .and_then(Value::as_i64)
        == Some(VERSION)
}

pub fn validate(payload: &Value, required: bool, depth: Depth) -> Vec<CoverageIssue> {
    if !required {
        return Vec::new();
    }
    let mut issues = Vec::new();
    let character_changes = required_array(
        payload,
        "characterChanges",
        "SUMMARY_CHARACTER_CHANGES_MISSING",
        "SUMMARY_CHARACTER_CHANGES_INVALID_TYPE",
        &mut issues,
    );
    let context_records = required_array(
        payload,
        "contextRecords",
        "SUMMARY_CONTEXT_RECORDS_MISSING",
        "SUMMARY_CONTEXT_RECORDS_INVALID_TYPE",
        &mut issues,
    );
    if depth == Depth::Complete {
        if let Some(items) = character_changes {
            validate_character_items(items, &mut issues);
        }
        if let Some(items) = context_records {
            validate_context_items(items, &mut issues);
        }
    }
    issues
}

fn required_array<'a>(
    payload: &'a Value,
    field: &str,
    missing: &'static str,
    invalid_type: &'static str,
    issues: &mut Vec<CoverageIssue>,
) -> Option<&'a Vec<Value>> {
    match payload.get(field) {
        None => {
            issues.push(error(
                missing,
                &format!("/{field}"),
                format!(
                    "新总结契约要求显式返回 {field} 数组；确认没有对应变化时也必须返回空数组，省略字段不等同于无变化。"
                ),
            ));
            None
        }
        Some(Value::Array(items)) => Some(items),
        Some(_) => {
            issues.push(error(
                invalid_type,
                &format!("/{field}"),
                format!("{field} 必须是数组；空数组表示明确无变化，其他类型不能代替这一声明。"),
            ));
            None
        }
    }
}

fn non_empty_string(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|text| !text.trim().is_empty())
}

fn validate_character_items(items: &[Value], issues: &mut Vec<CoverageIssue>) {
    for (index, item) in items.iter().enumerate() {
        let path = format!("/characterChanges/{index}");
        let Some(object) = item.as_object() else {
            issues.push(error(
                "SUMMARY_CHARACTER_CHANGES_ITEM_INVALID",
                &path,
                "characterChanges 的每一项必须是对象，至少包含角色标识与非空 stateSummary。",
            ));
            continue;
        };
        let has_identity = ["characterId", "characterName", "name"]
            .iter()
            .any(|key| non_empty_string(object.get(*key)));
        let has_state = non_empty_string(object.get("stateSummary"));
        if !has_identity || !has_state {
            issues.push(error(
                "SUMMARY_CHARACTER_CHANGES_INCOMPLETE",
                &path,
                "characterChanges 的每一项必须有角色标识（characterId 或 characterName/name）和非空 stateSummary，才能作为可写入的人物状态。",
            ));
        }
    }
}

fn validate_context_items(items: &[Value], issues: &mut Vec<CoverageIssue>) {
    for (index, item) in items.iter().enumerate() {
        let path = format!("/contextRecords/{index}");
        let Some(object) = item.as_object() else {
            issues.push(error(
                "SUMMARY_CONTEXT_RECORDS_ITEM_INVALID",
                &path,
                "contextRecords 的每一项必须是对象，至少包含非空 title 与 content。",
            ));
            continue;
        };
        if !non_empty_string(object.get("title")) || !non_empty_string(object.get("content")) {
            issues.push(error(
                "SUMMARY_CONTEXT_RECORDS_INCOMPLETE",
                &path,
                "contextRecords 的每一项必须有非空 title 与 content；没有额外记录时返回空数组。",
            ));
        }
    }
}

// `protagonistStateChange` and `importantCharacterChanges` are descriptive legacy
// fields. Under the coverage contract they grant no state-write authority, so their
// text is deliberately not compared with `characterChanges`: a phrase such as
// "无明显变化" is non-empty but does not prove a character-state change.

#[cfg(test)]
#[path = "summary_coverage_tests.rs"]
mod tests;
