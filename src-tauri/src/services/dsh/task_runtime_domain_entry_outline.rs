//! One bounded outline candidate stage. The native root remains the dispatcher;
//! no outline version, active selection, volume or chapter is written here.
use super::{context, DomainEntryRequest, StartTaskTurnInput, TaskRuntimeResult};
use crate::services::{outline_candidate_apply, world_rule_governance};
use outline_candidate_apply::OutlineRequest;
use rusqlite::Connection;
use serde_json::{json, Value};

pub(super) fn prepare(
    connection: &mut Connection,
    input: &mut StartTaskTurnInput,
    request: &DomainEntryRequest,
) -> Result<Value, String> {
    let novel_id = input.require_novel_id()?.to_string();
    let DomainEntryRequest::OutlineGenerate { outline_type, format, target_id, volume_id, target_title, target_index, parent_outline_id, chapter_goal, chapter_count } = request else { return Err("OUTLINE_ENTRY_KIND_INVALID".into()); };
    let request = OutlineRequest {
        kind: "outline_generate".into(), outline_type: outline_type.clone(), format: format.clone(),
        target_id: target_id.clone(), volume_id: volume_id.clone(), target_title: target_title.clone(),
        target_index: *target_index, parent_outline_id: parent_outline_id.clone(),
        chapter_goal: chapter_goal.clone(), chapter_count: *chapter_count,
    };
    outline_candidate_apply::validate_request(connection, &novel_id, input.chapter_id.as_deref(), &request)?;
    if request.format=="chapter_candidates" && request.volume_id.is_none() {
        let count:i64=connection.query_row("SELECT COUNT(*) FROM volumes WHERE novel_id=?1 AND deleted_at IS NULL",[&novel_id],|row|row.get(0)).map_err(|error|error.to_string())?;
        if count>0 { return Err("OUTLINE_VOLUME_SCOPE_REQUIRED: 已有分卷时必须明确目标卷".into()); }
    }
    let baseline = outline_candidate_apply::capture_baseline(connection, &novel_id)?;
    let rules = world_rule_governance::rule_set_snapshot(connection, &novel_id).map_err(|error|error.to_string())?.fingerprint;
    let schema=super::candidate_schema::schema("outline_generate", &request.format)?;
    Ok(json!({"entryKind":"outline_generate","stageKey":request.format,"request":request,
        "outlineBaselineHash":baseline,"outlineRulesFingerprint":rules,"schema":schema,
        "instructions":"生成本次指定层级的大纲候选，必须先读取本作品原生上下文，遵守当前世界规则和明确选定的上级大纲。editor_text 的 content 是作者可编辑的完整大纲文字；volume_candidate 返回 title/summary/goal/mainConflict；chapter_candidates 返回 chapters 数组，不超过 request.chapterCount（默认6），每项有 title/outline，可选 goal/targetWordCount。不得创建章节、卷、正式版本、采用状态、人工决定或授权。结构校验不是语义正确证明，候选等待作者明确保存或采用。"}))
}

pub(super) fn accept(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    _result: &TaskRuntimeResult,
    payload: &Value,
) -> Result<(), String> {
    let stage=context(input)?;
    super::candidate_schema::validate(&stage["schema"], payload)?;
    if stage["stageKey"]=="chapter_candidates" {
        let count=stage.pointer("/request/chapterCount").and_then(Value::as_u64).unwrap_or(6);
        if payload["chapters"].as_array().is_none_or(|items|items.is_empty() || items.len()>count as usize) { return Err("OUTLINE_CANDIDATE_COUNT_INVALID".into()); }
    }
    // Deliberately no save, adopt, update, create, decision, or receipt here.
    let _=connection;
    Ok(())
}

pub(super) fn admission_policy(input: &StartTaskTurnInput) -> Option<Value> {
    let stage=context(input).ok()?;
    if stage["entryKind"]!="outline_generate" { return None; }
    Some(json!({"kind":"outline_generate","outlineRequest":stage["request"],
        "outlineBaselineHash":stage["outlineBaselineHash"],
        "outlineRulesFingerprint":stage["outlineRulesFingerprint"]}))
}
