//! Exact-source checks for chapter-summary assertions. This is not a semantic proof.
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub const VERSION: i64 = 1;
const FIELDS: &[&str] = &[
    "summary",
    "summaryTitle",
    "keyEvents",
    "coreEvents",
    "protagonistStateChange",
    "importantCharacterChanges",
    "characterChanges",
    "relationshipChanges",
    "settingChanges",
    "newLocations",
    "newItemsOrAbilities",
    "newForeshadows",
    "resolvedForeshadows",
    "foreshadowing",
    "unresolvedQuestions",
    "factsMustRemember",
    "nextChapterHints",
    "nextChapterHook",
    "contextRecords",
];
fn metadata(path: &str, key: &str) -> bool {
    ([
        "/characterChanges/",
        "/importantCharacterChanges/",
        "/relationshipChanges/",
    ]
    .iter()
    .any(|prefix| path.starts_with(prefix))
        && [
            "name",
            "characterName",
            "characterId",
            "fromCharacterName",
            "toCharacterName",
        ]
        .contains(&key))
        || (path.starts_with("/contextRecords/") && ["contextType", "importance"].contains(&key))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroundingIssue {
    pub severity: &'static str,
    pub code: &'static str,
    pub message: String,
    pub json_path: String,
    pub details_json: Option<Value>,
}

fn issue(severity: &'static str, code: &'static str, path: &str, message: &str) -> GroundingIssue {
    GroundingIssue {
        severity,
        code,
        message: message.to_string(),
        json_path: path.to_string(),
        details_json: None,
    }
}

fn collect(value: &Value, path: &str, targets: &mut BTreeMap<String, String>) {
    match value {
        Value::String(text) if !text.trim().is_empty() => {
            targets.insert(path.to_string(), text.trim().to_string());
        }
        Value::Array(rows) => {
            for (index, row) in rows.iter().enumerate() {
                collect(row, &format!("{path}/{index}"), targets);
            }
        }
        Value::Object(object) => {
            for (key, row) in object {
                if !metadata(path, key) {
                    collect(
                        row,
                        &format!("{path}/{}", key.replace('~', "~0").replace('/', "~1")),
                        targets,
                    );
                }
            }
        }
        _ => {}
    }
}

pub fn assertion_targets(payload: &Value) -> BTreeMap<String, String> {
    let mut targets = BTreeMap::new();
    for field in FIELDS {
        if let Some(value) = payload.get(*field) {
            collect(value, &format!("/{field}"), &mut targets);
        }
    }
    targets
}

pub fn candidate(raw: &str, structured: Option<&Value>) -> Value {
    if let Ok(value) = serde_json::from_str::<Value>(raw) {
        if value.get("summary").is_some() {
            return value;
        }
    }
    let value = structured.cloned().unwrap_or(Value::Null);
    if value.get("summary").is_some() {
        return value;
    }
    if let Some(text) = value.pointer("/data/text").and_then(Value::as_str) {
        return serde_json::from_str(text).unwrap_or(Value::Null);
    }
    value.get("data").cloned().unwrap_or(value)
}

fn qualifier(text: &str) -> bool {
    [
        "【推测】",
        "【待查】",
        "【计划】",
        "可能",
        "推测",
        "猜测",
        "尚未",
        "未能",
        "未知",
        "不知",
        "无法确认",
        "无法确定",
        "不能确认",
        "计划",
        "准备",
        "拟",
        "打算",
        "将要",
        "有待",
        "待查",
        "尚待",
        "愿意",
        "没有",
        "并未",
        "从未",
        "尚无",
        "无从",
        "未曾",
        "还没",
        "未完成",
        "未确认",
        "并非",
        "不曾",
        "是否",
        "据称",
        "听说",
        "声称",
        "自称",
    ]
    .iter()
    .any(|word| text.contains(word))
}

fn sentence_boundary(ch: char) -> bool {
    matches!(ch, '\n' | '。' | '！' | '？' | '.' | '!' | '?')
}

/// Preserve the surrounding sentence so a matching fragment cannot hide qualifiers.
fn source_sentence(source: &str, start: usize, end: usize) -> (usize, &str) {
    let left = source[..start]
        .char_indices()
        .rev()
        .find(|(_, ch)| sentence_boundary(*ch))
        .map(|(index, ch)| index + ch.len_utf8())
        .unwrap_or(0);
    let right = if source[..end].chars().last().is_some_and(sentence_boundary) {
        end
    } else {
        source[end..]
            .char_indices()
            .find(|(_, ch)| sentence_boundary(*ch))
            .map(|(index, ch)| end + index + ch.len_utf8())
            .unwrap_or(source.len())
    };
    (left, &source[left..right])
}

pub fn validate(source: &str, payload: &Value, required: bool) -> Vec<GroundingIssue> {
    let mut issues = Vec::new();
    let Some(claims) = payload
        .pointer("/grounding/claims")
        .and_then(Value::as_array)
    else {
        issues.push(issue(if required { "error" } else { "warning" }, "SUMMARY_GROUNDING_MISSING", "/grounding",
            "这份总结缺少逐条原文依据。请要求重新总结，并为所有新增断言提供原文与确定性分类；不会把缺失依据当作内容已核实。"));
        return issues;
    };
    if payload
        .pointer("/grounding/version")
        .and_then(Value::as_i64)
        != Some(VERSION)
        || claims.is_empty()
        || claims.len() > 200
    {
        issues.push(issue(
            "error",
            "SUMMARY_GROUNDING_INVALID",
            "/grounding",
            "总结依据格式或版本无效，请重新生成逐条依据。",
        ));
        return issues;
    }
    let targets = assertion_targets(payload);
    let mut covered = BTreeMap::new();
    let mut locations = Vec::new();
    for (index, claim) in claims.iter().enumerate() {
        let path = claim.get("path").and_then(Value::as_str).unwrap_or("");
        let status = claim.get("status").and_then(Value::as_str).unwrap_or("");
        let Some(assertion) = targets.get(path) else {
            issues.push(issue(
                "error",
                "SUMMARY_GROUNDING_TARGET_INVALID",
                &format!("/grounding/claims/{index}"),
                "原文依据指向不存在的总结断言，请修正对应字段。",
            ));
            continue;
        };
        if !["confirmed", "inferred", "unresolved", "planned"].contains(&status)
            || covered.insert(path.to_string(), ()).is_some()
        {
            issues.push(issue(
                "error",
                "SUMMARY_GROUNDING_STATUS_INVALID",
                path,
                "断言分类无效或重复，请为每个断言保留一组依据及一种确定性分类。",
            ));
            continue;
        }
        let prefix = match status {
            "inferred" => "【推测】",
            "unresolved" => "【待查】",
            "planned" => "【计划】",
            _ => "",
        };
        if !prefix.is_empty() && !assertion.starts_with(prefix) {
            issues.push(issue("error", "SUMMARY_QUALIFIER_MISSING", path, &format!("这条断言被标为{prefix}，正文却没有保留该限定。请在对应总结文字前加上{prefix}，避免后续上下文把它当作已发生事实。")));
        }
        let quotes = claim.get("quotes").and_then(Value::as_array);
        if !quotes.is_some_and(|quotes| !quotes.is_empty() && quotes.len() <= 8) {
            issues.push(issue(
                "error",
                "SUMMARY_EVIDENCE_REQUIRED",
                path,
                "这条断言缺少原文引句，请提供当前采用稿中的完整句子。",
            ));
            continue;
        }
        let mut found = Vec::new();
        let mut uncertain_source = false;
        let mut fragment = false;
        for quote in quotes.unwrap() {
            let text = quote.as_str().unwrap_or("");
            let offset = source.find(text);
            if text.trim().chars().count() < 4 || text.chars().count() > 1200 || offset.is_none() {
                issues.push(issue("error", "SUMMARY_EVIDENCE_NOT_FOUND", path, "引句不在当前完整采用稿中或不是有效原文句子。请删除无依据断言或按当前采用稿重新总结。"));
                continue;
            }
            let start = offset.unwrap();
            let (context_start, context) = source_sentence(source, start, start + text.len());
            fragment |= context.trim() != text.trim();
            // Location is generated by the host, never trusted from model output.
            found.push(json!({"quote": text, "startChar": source[..start].chars().count(),
                "line": source[..start].chars().filter(|ch| *ch == '\n').count() + 1,
                "context": context, "contextLine": source[..context_start].chars().filter(|ch| *ch == '\n').count() + 1}));
            uncertain_source |= qualifier(context);
        }
        if fragment {
            issues.push(issue("warning", "SUMMARY_EVIDENCE_FRAGMENT", path,
                "引句只摘取了原文句子的一部分。请对照展示的完整原句，检查被省略的否定、口述、推测或计划限定；有误时要求补齐引句并重做。"));
        }
        if status == "confirmed" && uncertain_source && !qualifier(assertion) {
            issues.push(issue("warning", "SUMMARY_CERTAINTY_ESCALATION", path,
                "原文含推测、未知或计划措辞，这条总结却标为已确认。请核对是否把待查写成定论、计划写成完成；有误时要求定向重做。"));
        }
        locations.push(json!({"path": path, "status": status, "sources": found}));
    }
    for path in targets.keys() {
        if !covered.contains_key(path) {
            issues.push(issue(
                "error",
                "SUMMARY_ASSERTION_UNGROUNDED",
                path,
                "这条将进入后续上下文的断言没有逐条依据。请补充原文与确定性分类，或删除这条断言。",
            ));
        }
    }
    let mut receipt = issue("warning", "SUMMARY_SEMANTICS_REQUIRE_REVIEW", "/grounding",
        "已核对引句与采用稿的位置及字段覆盖；原文是否支持概括仍需作者逐条审阅，未执行完整语义证明。请重点检查新增断言、推测及计划。" );
    receipt.details_json =
        Some(json!({"version": VERSION, "semanticValidation": "not_checked", "claims": locations}));
    issues.push(receipt);
    issues
}

#[cfg(test)]
#[path = "summary_grounding_tests.rs"]
mod tests;
