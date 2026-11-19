//! Exact domain projection requires both the frozen runtime contract and full native input receipt.
use super::*;
use crate::services::ai_task_service::CreateAiTaskInput;

pub(crate) fn validate_domain_projection(
    connection: &rusqlite::Connection,
    input: &CreateAiTaskInput,
    run_id: &str,
    turn_id: &str,
    conversation_id: &str,
) -> Result<(), AppError> {
    let invalid = |message: &str| AppError::new("DSH_DOMAIN_PROJECTION_INVALID", message, false);
    if input.task_type != "domain_candidate"
        || input.expected_artifact_type != "generic_json"
        || input.expected_artifact_schema_version != 1
    {
        return Err(invalid("领域 Task/Artifact 对不匹配"));
    }
    let bound:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM task_runs r JOIN task_conversations c ON c.conversation_id=r.conversation_id WHERE r.run_id=?1 AND r.turn_id=?2 AND r.conversation_id=?3 AND c.novel_id=?4 AND r.chapter_id IS ?5 AND r.status='running')",rusqlite::params![run_id,turn_id,conversation_id,input.novel_id,input.chapter_id],|r|r.get(0)).map_err(AppError::database)?;
    if !bound {
        return Err(invalid("领域候选必须来自当前受控运行和精确作品范围"));
    }
    let (event_id,summary):(String,String)=connection.query_row("SELECT event_id,result_json FROM tool_call_events WHERE run_id=?1 AND tool_name='dsh.execution_contract' AND status='succeeded'",[run_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(AppError::database)?.ok_or_else(||invalid("领域候选缺少原生执行契约"))?;
    let contract = verified_receipt(connection, &event_id, &summary, "result")?;
    let contract: retry::ExecutionContract =
        serde_json::from_str(&contract).map_err(|_| invalid("执行契约不可读"))?;
    if contract.task_kind != "domain_candidate"
        || contract.expected_tool.as_deref() != Some("domain.submit_candidate")
        || contract.expected_artifact_type.as_deref() != Some("generic_json")
    {
        return Err(invalid("只有当前领域候选能力可以创建该产物"));
    }
    let (context_event,context_summary,args):(String,String,String)=connection.query_row("SELECT event_id,result_json,arguments_summary_json FROM tool_call_events WHERE run_id=?1 AND tool_name='domain.stage_context' AND status='succeeded'",[run_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(AppError::database)?.ok_or_else(||invalid("缺少真实领域阶段输入快照"))?;
    let context = verified_receipt(
        connection,
        &context_event,
        &context_summary,
        "domain_stage_context",
    )?;
    let stage: Value = serde_json::from_str(&context).map_err(|_| invalid("领域输入快照不可读"))?;
    let args: Value = serde_json::from_str(&args).map_err(|_| invalid("领域来源事实不可读"))?;
    let metadata = &input.input_snapshot.payload_json["controlledDomain"];
    let hash = large_text_repository::sha256(&context);
    if args["source"] != "ans-native-host"
        || args["argumentsHash"] != hash
        || metadata["taskKind"] != "domain_candidate"
        || metadata["tool"] != "domain.submit_candidate"
        || metadata["entryKind"] != stage["entryKind"]
        || metadata["stageKey"] != stage["stageKey"]
        || metadata["contextHash"] != hash
    {
        return Err(invalid("领域来源、动作或阶段输入哈希不匹配"));
    }
    let kind = stage["entryKind"]
        .as_str()
        .ok_or_else(|| invalid("领域类型缺失"))?;
    let key = stage["stageKey"]
        .as_str()
        .ok_or_else(|| invalid("领域阶段缺失"))?;
    domain_entry::candidate_schema::schema(kind, key)
        .map_err(|_| invalid("领域阶段没有显式候选契约"))?;
    let sources = input
        .context_snapshot
        .source_manifest_json
        .get("sources")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("上下文来源证据缺失"))?;
    if !sources.iter().any(|source| {
        source["eventId"] == context_event
            && source["toolName"] == "domain.stage_context"
            && source["contentHash"] == hash
    }) {
        return Err(invalid("Context Snapshot 未包含精确领域阶段输入"));
    }
    Ok(())
}
fn verified_receipt(
    connection: &rusqlite::Connection,
    event_id: &str,
    summary: &str,
    field: &str,
) -> Result<String, AppError> {
    let invalid = || {
        AppError::new(
            "DSH_DOMAIN_PROJECTION_INVALID",
            "领域输入回执正文缺失、串用或损坏",
            false,
        )
    };
    let summary: Value = serde_json::from_str(summary).map_err(|_| invalid())?;
    let document = summary["largeTextRefId"].as_str().ok_or_else(invalid)?;
    let owned:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM large_text_documents WHERE id=?1 AND target_type='tool_event' AND target_id=?2 AND field_name=?3)",rusqlite::params![document,event_id,field],|r|r.get(0)).map_err(AppError::database)?;
    if !owned {
        return Err(invalid());
    }
    let verified = large_text_repository::read_verified_document(connection, document)?;
    if summary["contentHash"] != verified.content_hash {
        return Err(invalid());
    }
    Ok(verified.content)
}
