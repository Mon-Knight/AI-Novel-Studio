//! Verify the material actually returned by mandatory context reads before accepting a candidate.
//! Coverage proves complete projections and source identity, never arbitrary narrative consistency.
use crate::errors::AppError;
use crate::repositories::large_text_repository;
use crate::services::world_rule_governance::{rule_set_snapshot, RuleSetSnapshot};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

const MATERIAL_LIMIT_BYTES: u64 = 128 * 1024;
const ENGINEERING_LIMIT_BYTES: u64 = 64 * 1024;

fn incomplete(reason: &str) -> AppError {
    AppError::new(
        "DSH_CONTEXT_INCOMPLETE",
        format!("必需上下文覆盖未完成：{}；请补全或缩小相关材料后重新生成", reason),
        false,
    )
}

fn verified_payload(connection: &Connection, event_id: &str, tool: &str) -> Result<Value, AppError> {
    let raw = connection.query_row(
        "SELECT result_json FROM tool_call_events WHERE event_id=?1 AND tool_name=?2 AND status='succeeded'",
        params![event_id, tool],
        |row| row.get::<_, Option<String>>(0),
    ).optional().map_err(AppError::database)?.flatten()
        .ok_or_else(|| incomplete("缺少持久的成功读取结果"))?;
    let receipt: Value = serde_json::from_str(&raw)
        .map_err(|_| incomplete("读取回执格式无效"))?;
    if receipt.get("isError").and_then(Value::as_bool) != Some(false) {
        return Err(incomplete("工具结果包含错误或缺少成功凭据"));
    }
    let document_id = receipt.get("largeTextRefId").and_then(Value::as_str)
        .filter(|value| !value.is_empty()).ok_or_else(|| incomplete("读取结果缺少完整材料引用"))?;
    large_text_repository::validate_document_target(connection, document_id, "tool_event", event_id, "result")?;
    let verified = large_text_repository::read_verified_document(connection, document_id)?;
    if receipt.get("contentHash").and_then(Value::as_str) != Some(verified.content_hash.as_str())
        || receipt.get("contentChars").and_then(Value::as_u64) != Some(verified.content.chars().count() as u64)
    {
        return Err(incomplete("读取材料与持久回执的哈希或长度不一致"));
    }
    let payload: Value = serde_json::from_str(&verified.content)
        .map_err(|_| incomplete("完整读取材料不是有效 JSON"))?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(incomplete("读取工具未返回完整成功结果"));
    }
    Ok(payload)
}

fn scope_coverage<'a>(payload: &'a Value, novel_id: &str) -> Result<&'a Value, AppError> {
    let coverage = payload.pointer("/data/contextCoverage")
        .ok_or_else(|| incomplete("旧读取结果没有覆盖凭据，请重新读取"))?;
    if coverage.get("schemaVersion").and_then(Value::as_str) != Some("writing_context_coverage_v1")
        || coverage.get("novelId").and_then(Value::as_str) != Some(novel_id)
    {
        return Err(incomplete("覆盖协议或作品作用域不一致"));
    }
    Ok(coverage)
}

fn validate_size_and_hash(coverage: &Value, projection: &Value, count: u64, limit: u64) -> Result<(), AppError> {
    if coverage.get("status").and_then(Value::as_str) != Some("complete")
        || coverage.get("requiredCount").and_then(Value::as_u64) != Some(count)
        || coverage.get("includedCount").and_then(Value::as_u64) != Some(count)
        || coverage.get("semanticValidation").and_then(Value::as_str) != Some("not_checked")
    {
        return Err(incomplete("读取只覆盖部分材料，或混淆了覆盖与语义检查状态"));
    }
    let serialized = serde_json::to_string(projection).map_err(|_| incomplete("无法核对上下文投影"))?;
    let bytes = serialized.len() as u64;
    if bytes > limit
        || coverage.get("maxBytes").and_then(Value::as_u64) != Some(limit)
        || coverage.get("requiredBytes").and_then(Value::as_u64) != Some(bytes)
        || coverage.get("projectedBytes").and_then(Value::as_u64) != Some(bytes)
        || coverage.get("projectionHash").and_then(Value::as_str) != Some(large_text_repository::sha256(&serialized).as_str())
    {
        return Err(incomplete("投影被截断、超出预算或内容哈希不匹配"));
    }
    Ok(())
}

fn projected_text_hash(item: &Value, key: &str) -> Result<Option<String>, AppError> {
    match item.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(large_text_repository::sha256(text))),
        _ => Err(incomplete("原始设定文本被转换或损坏，无法证明完整覆盖")),
    }
}

fn validate_material_projection(
    payload: &Value,
    novel_id: &str,
    coverage_root: &Value,
    snapshot: &RuleSetSnapshot,
    name: &str,
    source_type: &str,
) -> Result<(), AppError> {
    let projection = payload.get("data").and_then(|data| data.get(name))
        .ok_or_else(|| incomplete("缺少设定投影"))?;
    let items = projection.as_array().ok_or_else(|| incomplete("设定投影不是完整列表"))?;
    let coverage = coverage_root.get(name).ok_or_else(|| incomplete("缺少设定覆盖清单"))?;
    let mut expected = BTreeMap::new();
    for source in &snapshot.sources {
        if source.get("sourceType").and_then(Value::as_str) == Some(source_type)
            && source.get("isActive").and_then(Value::as_bool) == Some(true)
        {
            let id = source.get("sourceId").and_then(Value::as_str)
                .ok_or_else(|| incomplete("权威规则来源缺少身份"))?;
            if expected.insert(id, source).is_some() {
                return Err(incomplete("权威规则来源存在重复身份"));
            }
        }
    }
    validate_size_and_hash(coverage, projection, expected.len() as u64, MATERIAL_LIMIT_BYTES)?;
    if coverage.get("ruleSetFingerprint").and_then(Value::as_str) != Some(snapshot.fingerprint.as_str()) {
        return Err(incomplete("读取后世界或规则基线已变化"));
    }
    let source_ids = coverage.get("sourceIds").and_then(Value::as_array)
        .ok_or_else(|| incomplete("缺少实际读取的来源 ID"))?;
    if items.len() != expected.len() || source_ids.len() != items.len() {
        return Err(incomplete("实际设定数量与权威来源不一致"));
    }
    let mut seen = BTreeSet::new();
    for (index, item) in items.iter().enumerate() {
        let id = item.get("id").and_then(Value::as_str).ok_or_else(|| incomplete("投影条目缺少身份"))?;
        if !seen.insert(id) || source_ids[index].as_str() != Some(id) {
            return Err(incomplete("投影来源重复或与来源清单不一致"));
        }
        let source = expected.get(id).ok_or_else(|| incomplete("投影包含非当前作用域的设定"))?;
        if item.get("novelId").is_some_and(|value| value.as_str() != Some(novel_id))
            || item.get("title") != source.get("title")
        {
            return Err(incomplete("投影的作品或条目身份不匹配"));
        }
        for (field, hash_field) in [
            ("content", "contentHash"),
            ("forbiddenRules", "forbiddenRulesHash"),
            ("structuredJson", "structuredJsonHash"),
        ] {
            if projected_text_hash(item, field)?.as_deref() != source.get(hash_field).and_then(Value::as_str) {
                return Err(incomplete("实际投影未完整保留已确认的正文、禁止项或结构化材料"));
            }
        }
    }
    Ok(())
}

/// Returns the verified read-time fingerprint so task creation can require the same baseline.
/// A rule-less initial project is valid coverage of zero rules, not evidence of semantic checking.
pub(super) fn validate_persisted_rule_coverage(
    connection: &Connection,
    novel_id: &str,
    event_id: &str,
) -> Result<String, AppError> {
    let payload = verified_payload(connection, event_id, "novel.read_context")?;
    let coverage = scope_coverage(&payload, novel_id)?;
    let snapshot = rule_set_snapshot(connection, novel_id)?;
    validate_material_projection(&payload, novel_id, coverage, &snapshot, "worldSettings", "world_setting")?;
    validate_material_projection(&payload, novel_id, coverage, &snapshot, "ruleSystems", "rule_system")?;
    Ok(snapshot.fingerprint)
}

pub(super) fn validate_persisted_engineering_coverage(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
    event_id: &str,
) -> Result<(), AppError> {
    let payload = verified_payload(connection, event_id, "chapter.read_outline")?;
    let coverage = scope_coverage(&payload, novel_id)?;
    if coverage.get("chapterId").and_then(Value::as_str) != Some(chapter_id) {
        return Err(incomplete("章节工程覆盖作用域不一致"));
    }
    let projection = payload.pointer("/data/engineeringState")
        .ok_or_else(|| incomplete("没有章节工程投影"))?;
    if !projection.is_null() && !projection.is_object() {
        return Err(incomplete("章节工程不是完整结构"));
    }
    if projection.get("chapterId").is_some_and(|value| value.as_str() != Some(chapter_id)) {
        return Err(incomplete("章节工程条目不属于当前章节"));
    }
    let section = coverage.get("engineeringState").ok_or_else(|| incomplete("没有章节工程覆盖凭据"))?;
    validate_size_and_hash(section, projection, u64::from(!projection.is_null()), ENGINEERING_LIMIT_BYTES)
}

#[cfg(test)]
#[path = "task_runtime_context_coverage_tests.rs"]
mod tests;
