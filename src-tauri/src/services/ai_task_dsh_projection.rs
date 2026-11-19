//! Exact native task/artifact projection contract shared by governed desktop entries.
use super::*;

pub(super) fn validate_dsh_projection_input(
    input: &CreateAiTaskInput,
    run_id: &str,
    turn_id: &str,
    conversation_id: &str,
) -> Result<(), AppError> {
    let expected_pair = match input.task_type.as_str() {
        "chapter_generate" => "chapter_text",
        "outline_generate" => "outline",
        "character_generate" => "character_candidates",
        "event_suggest" => "event_candidates",
        "setting_expand" => "setting_candidates",
        "quality_check" => "quality_report",
        "chapter_summary" => "chapter_summary",
        "domain_candidate" => "generic_json",
        "style_analyze" => "style_analysis",
        _ => return Err(compilation_error("DSH 投影包含未授权 Task 类型")),
    };
    if input.expected_artifact_type != expected_pair || input.expected_artifact_schema_version != 1
    {
        return Err(compilation_error("DSH 投影的 Task/Artifact 契约不匹配"));
    }
    if run_id.trim().is_empty()
        || turn_id.trim().is_empty()
        || conversation_id.trim().is_empty()
        || input.operation_id != format!("workbench-{run_id}")
    {
        return Err(compilation_error(
            "DSH 投影 operation/run/turn/conversation 身份无效",
        ));
    }

    let target_hint = input
        .target_hint_json
        .as_ref()
        .and_then(Value::as_object)
        .ok_or_else(|| compilation_error("DSH 投影缺少 target hint"))?;
    if target_hint.get("runId").and_then(Value::as_str) != Some(run_id)
        || target_hint.get("turnId").and_then(Value::as_str) != Some(turn_id)
        || target_hint.get("conversationId").and_then(Value::as_str) != Some(conversation_id)
    {
        return Err(compilation_error("DSH 投影 target hint 身份不匹配"));
    }

    let input_snapshot = &input.input_snapshot;
    if input_snapshot.schema_version != 1
        || input_snapshot.input_type != "workbench_dsh_messages_v1"
        || input_snapshot
            .payload_json
            .get("conversationId")
            .and_then(Value::as_str)
            != Some(conversation_id)
        || input_snapshot
            .payload_json
            .get("goal")
            .and_then(Value::as_str)
            .map_or(true, |goal| goal.trim().is_empty())
    {
        return Err(compilation_error("DSH 投影 Input Snapshot 身份无效"));
    }

    let context = &input.context_snapshot;
    let manifest = context
        .source_manifest_json
        .as_object()
        .ok_or_else(|| compilation_error("DSH 投影 Context manifest 必须是对象"))?;
    let sources = manifest
        .get("sources")
        .and_then(Value::as_array)
        .ok_or_else(|| compilation_error("DSH 投影 Context sources 必须是数组"))?;
    if input.task_type == "style_analyze" {
        if input.chapter_id.is_some() || input.draft_id.is_some()
            || sources.iter().any(|source| !matches!(source.get("toolName").and_then(Value::as_str), Some("library.read_source" | "domain.stage_context")))
            || !sources.iter().any(|source| source.get("toolName").and_then(Value::as_str)==Some("library.read_source"))
            || !sources.iter().any(|source| source.get("toolName").and_then(Value::as_str)==Some("domain.stage_context"))
        { return Err(compilation_error("风格候选只能引用本阶段快照读取证据")); }
        if input.scope_type == "library" {
            let source_id=target_hint.get("librarySourceId").and_then(Value::as_str).ok_or_else(||compilation_error("library 缺少来源身份"))?;
            ai_fact_security::validate_identifier(source_id,"librarySourceId",160)?;
            if input.novel_id.is_some() || !target_hint.get("librarySourceHash").and_then(Value::as_str).is_some_and(valid_sha256) {
                return Err(compilation_error("library 不得借用作品身份或缺失完整来源哈希"));
            }
        }
    }
    let compiled_hash = manifest
        .get("compiledContextHash")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if context.schema_version != 1
        || context.compiler_version != "workbench_dsh_context_evidence_v1"
        || manifest.get("contractVersion").and_then(Value::as_str)
            != Some("workbench_dsh_context_evidence_v1")
        || manifest.get("compilerVersion").and_then(Value::as_str)
            != Some("workbench_dsh_context_evidence_v1")
        || !valid_sha256(compiled_hash)
        || large_text_repository::sha256(&context.compiled_context) != compiled_hash
    {
        return Err(compilation_error(
            "DSH 投影 Context evidence 身份或 hash 无效",
        ));
    }
    let budget = context
        .budget_json
        .as_object()
        .ok_or_else(|| compilation_error("DSH 投影 Context budget 必须是对象"))?;
    if budget.get("compiledContextChars").and_then(Value::as_i64)
        != Some(context.compiled_context.chars().count() as i64)
        || budget.get("compiledContextBytes").and_then(Value::as_i64)
            != Some(context.compiled_context.len() as i64)
        || budget.get("includedSourceCount").and_then(Value::as_i64) != Some(sources.len() as i64)
        || budget.get("truncatedSourceCount").and_then(Value::as_i64) != Some(0)
        || budget.get("omittedSourceCount").and_then(Value::as_i64) != Some(0)
    {
        return Err(compilation_error(
            "DSH 投影 Context budget 与 evidence 不一致",
        ));
    }

    let constraint = &input.constraint_snapshot;
    if constraint.schema_version != 1
        || constraint.prompt_template_id != format!("workbench/{}", input.expected_artifact_type)
        || constraint.prompt_template_version != "1"
        || constraint
            .payload_json
            .get("candidateOnly")
            .and_then(Value::as_bool)
            != Some(true)
        || constraint
            .payload_json
            .get("mayWriteBusinessData")
            .and_then(Value::as_bool)
            != Some(false)
    {
        return Err(compilation_error("DSH 投影 Constraint 身份或候选边界无效"));
    }
    Ok(())
}
