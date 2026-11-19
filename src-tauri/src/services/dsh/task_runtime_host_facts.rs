//! Narrow native-only append-only control facts, including facts after a Run ends.
//! Public tool APIs keep their running/terminal protections unchanged.
use super::*;

pub(super) fn append(
    connection: &rusqlite::Connection,
    input: AppendToolEventInput,
) -> Result<(), AppError> {
    let invalid = |message: &str| AppError::new("DSH_HOST_FACT_INVALID", message, false);
    if ![
        "dsh.execution_contract",
        "dsh.request_usage",
        "dsh.tool_dispatch",
        "dsh.candidate_admission",
        "dsh.application_receipt",
        "dsh.awaiting_decision",
        "dsh.root_stop",
        "dsh.assembled_candidate",
    ]
    .contains(&input.tool_name.as_str())
        || !["succeeded", "failed", "cancelled"].contains(&input.status.as_str())
        || !input.arguments_summary.is_object()
        || !matches!(
            input
                .arguments_summary
                .get("source")
                .and_then(Value::as_str),
            Some("ans-host" | "ans-native-host")
        )
        || input.event_id.is_empty()
        || input.event_id.len() > 200
        || input.finished_at.is_none()
        || input.duration_ms.is_some_and(|v| v < 0)
        || crate::services::ai_fact_security::contains_secret_value(&input.arguments_summary)
        || input
            .result
            .as_ref()
            .is_some_and(crate::services::ai_fact_security::contains_secret_value)
        || input
            .error
            .as_deref()
            .is_some_and(crate::services::ai_fact_security::contains_secret_text)
    {
        return Err(invalid("主机事实名称、状态或内容不符合内部契约"));
    }
    let (conversation, turn, chapter, status): (String, String, Option<String>, String) =
        connection
            .query_row(
                "SELECT conversation_id,turn_id,chapter_id,status FROM task_runs WHERE run_id=?1",
                [&input.run_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| invalid("主机事实缺少真实运行"))?;
    let execution = if input.tool_name == "dsh.execution_contract" {
        if input.arguments_summary["preflightFailure"] != true
            || !matches!(status.as_str(), "queued" | "running")
        {
            return Err(invalid("仅预检失败可以创建原生停止契约"));
        }
        input.arguments_summary["execution"].clone()
    } else {
        let contract:String=connection.query_row("SELECT arguments_summary_json FROM tool_call_events WHERE run_id=?1 AND tool_name='dsh.execution_contract' AND status='succeeded' ORDER BY sequence LIMIT 1",[&input.run_id],|r|r.get(0)).optional().map_err(AppError::database)?.ok_or_else(||invalid("主机事实缺少已验证执行契约"))?;
        serde_json::from_str::<Value>(&contract).map_err(|_| invalid("执行契约不可读"))?
            ["execution"]
            .clone()
    };
    let root_turn = execution["rootTurnId"]
        .as_str()
        .ok_or_else(|| invalid("原生根回合缺失"))?;
    if execution["rootTaskId"] != conversation
        || input
            .arguments_summary
            .get("rootTaskId")
            .is_some_and(|v| v != &json!(conversation))
        || input
            .arguments_summary
            .get("rootTurnId")
            .is_some_and(|v| v.as_str() != Some(root_turn))
        || input
            .arguments_summary
            .get("novelId")
            .is_some_and(|v| v != &execution["scope"]["novelId"])
        || input
            .arguments_summary
            .get("chapterId")
            .is_some_and(|v| v != &json!(chapter))
    {
        return Err(invalid("主机事实不能改变根任务或章节作用域"));
    }
    let user_root:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM conversation_turns WHERE conversation_id=?1 AND turn_id=?2 AND role='user')",rusqlite::params![conversation,root_turn],|r|r.get(0)).map_err(AppError::database)?;
    if !user_root || (turn != root_turn && execution["parentRunId"].is_null()) {
        return Err(invalid("原生控制事实必须有真实用户根目标和可追踪父关系"));
    }
    match input.tool_name.as_str() {
        "dsh.tool_dispatch" if status != "running" => {
            return Err(invalid("非活动运行不能预留能力"))
        }
        "dsh.candidate_admission" | "dsh.awaiting_decision" => {
            if status != "completed" {
                return Err(invalid("候选控制事实要求已完成原生运行"));
            }
            let artifact = input.arguments_summary["artifactId"]
                .as_str()
                .ok_or_else(|| invalid("候选事实缺少精确产物"))?;
            let bound:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM conversation_artifact_cards WHERE conversation_id=?1 AND run_id=?2 AND artifact_id=?3)",rusqlite::params![conversation,input.run_id,artifact],|r|r.get(0)).map_err(AppError::database)?;
            if !bound {
                return Err(invalid("候选控制事实不属于该运行"));
            }
        }
        "dsh.application_receipt" => {
            let receipt = input.arguments_summary["receiptId"]
                .as_str()
                .ok_or_else(|| invalid("应用事实缺少权威回执"))?;
            let bound:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM task_authorization_receipts r JOIN task_authorizations a ON a.authorization_id=r.authorization_id WHERE r.receipt_id=?1 AND r.conversation_id=?2 AND a.source_turn_id=?3)",rusqlite::params![receipt,conversation,root_turn],|r|r.get(0)).map_err(AppError::database)?;
            if !bound {
                return Err(invalid("应用事实没有对应根任务已提交回执"));
            }
        }
        _ => {}
    }
    let previous:Option<(String,String,String,String,Option<String>,Option<String>)>=connection.query_row("SELECT run_id,tool_name,arguments_summary_json,status,result_json,error FROM tool_call_events WHERE event_id=?1",[&input.event_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).optional().map_err(AppError::database)?;
    if let Some((run, tool, args, status, result, error)) = previous {
        let args: Value = serde_json::from_str(&args).map_err(|_| invalid("既有事实不可读"))?;
        let result = result
            .map(|r| serde_json::from_str::<Value>(&r))
            .transpose()
            .map_err(|_| invalid("既有事实不可读"))?;
        return if run == input.run_id
            && tool == input.tool_name
            && args == input.arguments_summary
            && status == input.status
            && result == input.result
            && error == input.error
        {
            Ok(())
        } else {
            Err(invalid("原生事实身份已绑定不同内容，禁止覆盖"))
        };
    }
    let args = input.arguments_summary.to_string();
    let result = input.result.map(|v| v.to_string());
    if args.len() > 512 * 1024 || result.as_ref().is_some_and(|v| v.len() > 2 * 1024 * 1024) {
        return Err(invalid("主机事实超过固定记录预算"));
    }
    connection.execute("INSERT INTO tool_call_events(event_id,run_id,sequence,tool_name,arguments_summary_json,status,duration_ms,error,result_json,created_at,finished_at)VALUES(?1,?2,(SELECT COALESCE(MAX(sequence),-1)+1 FROM tool_call_events WHERE run_id=?2),?3,?4,?5,?6,?7,?8,?9,?10)",rusqlite::params![input.event_id,input.run_id,input.tool_name,args,input.status,input.duration_ms,input.error,result,input.created_at,input.finished_at]).map_err(AppError::database)?;
    Ok(())
}
