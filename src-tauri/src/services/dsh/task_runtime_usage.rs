//! Cumulative root accounting over existing immutable Run, ToolCallEvent and request facts.
use super::*;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootUsage {
    pub version: u32,
    pub root_run_id: String,
    pub root_turn_id: String,
    pub budget_epoch: String,
    pub requests: i64,
    pub tools: i64,
    pub revisions: i64,
    pub token_input: i64,
    pub token_output: i64,
    pub cost_usd: f64,
    pub elapsed_ms: i64,
    pub usage_known: bool,
    pub model_snapshot: Value,
}

pub fn owner_id(conversation_id: &str, root_turn_id: &str) -> String {
    let hash = large_text_repository::sha256(&format!("{conversation_id}:{root_turn_id}"));
    format!("dsh-root:{}", &hash[..40])
}

pub fn usage_for_root(
    connection: &rusqlite::Connection,
    conversation_id: &str,
    root_turn_id: &str,
) -> Result<RootUsage, AppError> {
    let mut statement=connection.prepare(
        "SELECT r.run_id,r.model_snapshot_json,e.arguments_summary_json FROM task_runs r
         JOIN tool_call_events e ON e.run_id=r.run_id AND e.tool_name='dsh.execution_contract' AND e.status='succeeded'
         WHERE r.conversation_id=?1 AND (r.turn_id=?2 OR json_extract(e.arguments_summary_json,'$.execution.rootTurnId')=?2)
         ORDER BY r.created_at,e.sequence",
    ).map_err(AppError::database)?;
    let rows = statement
        .query_map(rusqlite::params![conversation_id, root_turn_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    let mut run_ids = HashSet::new();
    let mut revision_depth = 0i64;
    let mut first: Option<Value> = None;
    let mut model = Value::Null;
    for (run_id, snapshot, args) in rows {
        let args: Value =
            serde_json::from_str(&args).map_err(|_| invalid("根任务执行契约不可读"))?;
        let execution = args
            .get("execution")
            .filter(|v| v.is_object())
            .ok_or_else(|| invalid("根任务缺少原生预算契约"))?;
        if execution.get("rootTaskId").and_then(Value::as_str) != Some(conversation_id)
            || execution.get("rootTurnId").and_then(Value::as_str) != Some(root_turn_id)
        {
            return Err(invalid("根任务父子关系不匹配"));
        }
        let depth = execution
            .get("revision")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        if depth < 0 {
            return Err(invalid("修订纪元无效"));
        }
        revision_depth = revision_depth.max(depth);
        if let Some(frozen) = first.as_ref() {
            if frozen.get("rootRunId") != execution.get("rootRunId")
                || frozen.get("budgetEpoch") != execution.get("budgetEpoch")
                || frozen.get("startedAtMs") != execution.get("startedAtMs")
            {
                return Err(invalid("子任务不能切换根预算纪元"));
            }
        } else {
            first = Some(execution.clone());
        }
        let candidate: Value =
            serde_json::from_str(&snapshot).map_err(|_| invalid("运行模型快照不可读"))?;
        if !model.is_null() && retry::model_identity(&model) != retry::model_identity(&candidate) {
            return Err(invalid("子任务模型发生变化"));
        }
        model = candidate;
        run_ids.insert(run_id);
    }
    let metadata = if let Some(first) = first {
        first
    } else {
        let (runs,reservations):(i64,i64)=connection.query_row("SELECT (SELECT COUNT(*) FROM task_runs WHERE conversation_id=?1 AND turn_id=?2),(SELECT COUNT(*) FROM ai_request_reservations WHERE owner_id=?3)",rusqlite::params![conversation_id,root_turn_id,owner_id(conversation_id,root_turn_id)],|r|Ok((r.get(0)?,r.get(1)?))).map_err(AppError::database)?;
        let model_text:Option<String>=connection.query_row("SELECT default_model_json FROM task_conversations WHERE conversation_id=?1 AND EXISTS(SELECT 1 FROM conversation_turns WHERE conversation_id=?1 AND turn_id=?2 AND role='user')",rusqlite::params![conversation_id,root_turn_id],|r|r.get(0)).optional().map_err(AppError::database)?.flatten();
        if runs != 0 || reservations != 0 || model_text.is_none() {
            return Err(invalid("缺少已持久化根运行"));
        }
        return Ok(RootUsage {
            version: 1,
            root_run_id: format!("not-started:{root_turn_id}"),
            root_turn_id: root_turn_id.into(),
            budget_epoch: format!("turn:{root_turn_id}"),
            requests: 0,
            tools: 0,
            revisions: 0,
            token_input: 0,
            token_output: 0,
            cost_usd: 0.0,
            elapsed_ms: 0,
            usage_known: true,
            model_snapshot: serde_json::from_str(&model_text.unwrap_or_default())
                .map_err(|_| invalid("模型快照不可读"))?,
        });
    };
    let mut tools = 0i64;
    let mut dispatches = 0i64;
    let mut attempts: HashMap<(String, String), (i64, i64)> = HashMap::new();
    let mut request_receipts = HashSet::new();
    let mut events=connection.prepare("SELECT run_id,tool_name,arguments_summary_json FROM tool_call_events WHERE run_id IN (SELECT run_id FROM task_runs WHERE conversation_id=?1)").map_err(AppError::database)?;
    for row in events
        .query_map([conversation_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(AppError::database)?
    {
        let (run, tool, args) = row.map_err(AppError::database)?;
        if !run_ids.contains(&run) {
            continue;
        }
        if tool == "dsh.request_usage" {
            let args: Value =
                serde_json::from_str(&args).map_err(|_| invalid("请求用量回执不可读"))?;
            let id = args
                .get("reservationId")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("请求用量回执身份缺失"))?;
            request_receipts.insert(id.to_string());
        }
        if tool == "dsh.tool_dispatch" {
            dispatches += 1;
            let args: Value =
                serde_json::from_str(&args).map_err(|_| invalid("能力预留事实不可读"))?;
            let name = args
                .get("toolName")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("能力预留事实不完整"))?;
            if is_candidate_capability(name) {
                attempts.entry((run.clone(), name.into())).or_default().1 += 1;
            }
        }
        if tool.starts_with("dsh.") {
            continue;
        }
        tools += 1;
        if is_candidate_capability(&tool) {
            attempts.entry((run, tool)).or_default().0 += 1;
        }
    }
    let tool_repairs = attempts
        .values()
        .map(|(actual, reserved)| (*actual).max(*reserved).saturating_sub(1))
        .sum::<i64>();
    let owner = owner_id(conversation_id, root_turn_id);
    let (requests,token_input,token_output,cost,unknown):(i64,i64,i64,i64,i64)=connection.query_row(
        "SELECT COUNT(*),COALESCE(SUM(COALESCE(accounted_input_tokens,estimated_input_tokens)),0),
         COALESCE(SUM(COALESCE(accounted_output_tokens,estimated_output_tokens)),0),
         COALESCE(SUM(COALESCE(accounted_cost_units,estimated_cost_units)),0),
         COALESCE(SUM(CASE
           WHEN status='settled' AND accounted_cost_status IN ('complete','unpriced') AND EXISTS(
             SELECT 1 FROM tool_call_events e
             WHERE e.event_id=ai_request_reservations.reservation_id||'-root-usage'
               AND e.tool_name='dsh.request_usage' AND e.status='succeeded'
               AND json_extract(e.arguments_summary_json,'$.usageKnown')=1
           ) THEN 0
           WHEN status='failed' AND accounted_cost_status IN ('complete','unpriced') THEN 0
           ELSE 1
         END),0)
         FROM ai_request_reservations WHERE owner_id=?1",[owner],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)),
    ).map_err(AppError::database)?;
    let mut ledger_complete = true;
    for reservation in request_receipts {
        let owned:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM ai_request_reservations WHERE reservation_id=?1 AND owner_id=?2)",rusqlite::params![reservation,owner_id(conversation_id,root_turn_id)],|r|r.get(0)).map_err(AppError::database)?;
        if !owned {
            ledger_complete = false;
        }
    }
    let started = metadata
        .get("startedAtMs")
        .and_then(Value::as_i64)
        .ok_or_else(|| invalid("根任务时间边界缺失"))?;
    Ok(RootUsage {
        version: 1,
        root_run_id: metadata
            .get("rootRunId")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("根运行标识缺失"))?
            .into(),
        root_turn_id: root_turn_id.into(),
        budget_epoch: metadata
            .get("budgetEpoch")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("预算纪元缺失"))?
            .into(),
        requests,
        tools: tools.max(dispatches),
        revisions: revision_depth.saturating_add(tool_repairs),
        token_input,
        token_output,
        cost_usd: cost as f64 / 100_000_000.0,
        elapsed_ms: Utc::now().timestamp_millis().saturating_sub(started).max(0),
        usage_known: unknown == 0 && ledger_complete,
        model_snapshot: model,
    })
}

fn invalid(message: &str) -> AppError {
    AppError::new("DSH_ROOT_USAGE_UNKNOWN", message, false)
}

pub(crate) fn before_dispatch(
    connection: &rusqlite::Connection,
    input: &execution::RootExecution,
    estimated_input: i64,
    estimated_output: i64,
    input_price: Option<f64>,
    output_price: Option<f64>,
) -> Result<(), String> {
    input.check_dispatch()?;
    let usage = usage_for_root(connection, &input.conversation_id, &input.root_turn_id)
        .map_err(|e| e.to_string())?;
    if !usage.usage_known {
        return Err("DSH_ROOT_USAGE_UNKNOWN: 前次请求结果不确定，必须先核对权威事实".into());
    }
    let grant = crate::services::task_authorization_service::execution_authorization(
        connection,
        &input.conversation_id,
        &input.root_turn_id,
        &input.model_identity,
    )
    .map_err(|e| e.to_string())?;
    let budget = grant.as_ref().map(|g| &g.spec.budget);
    if usage.requests
        >= budget.map_or(input.max_requests, |b| {
            b.max_requests.min(input.max_requests)
        })
    {
        return Err("DSH_ROOT_REQUEST_BUDGET_EXHAUSTED".into());
    }
    if usage.tools >= budget.map_or(input.max_tools, |b| b.max_tool_calls.min(input.max_tools)) {
        return Err("DSH_ROOT_TOOL_BUDGET_EXHAUSTED".into());
    }
    if usage.revisions
        > budget.map_or(input.max_revisions, |b| {
            b.max_revisions.min(input.max_revisions)
        })
    {
        return Err("DSH_ROOT_REVISION_BUDGET_EXHAUSTED".into());
    }
    let tokens = estimated_input
        .checked_add(estimated_output)
        .filter(|v| *v > 0)
        .ok_or("DSH_ROOT_USAGE_ESTIMATE_INVALID")?;
    if usage
        .token_input
        .saturating_add(usage.token_output)
        .saturating_add(tokens)
        > budget.map_or(input.max_tokens, |b| b.max_tokens.min(input.max_tokens))
    {
        return Err("DSH_ROOT_TOKEN_BUDGET_EXHAUSTED".into());
    }
    if let (Some(ip), Some(op)) = (input_price, output_price) {
        if !ip.is_finite() || !op.is_finite() || ip < 0.0 || op < 0.0 {
            return Err("DSH_ROOT_PRICING_INVALID".into());
        }
        let cost = (ip * estimated_input as f64 + op * estimated_output as f64) / 1_000_000.0;
        if !cost.is_finite()
            || usage.cost_usd + cost
                > budget.map_or(input.max_cost_usd, |b| {
                    b.max_cost_usd.min(input.max_cost_usd)
                })
        {
            return Err("DSH_ROOT_COST_BUDGET_EXHAUSTED".into());
        }
    } else if input_price.is_some() != output_price.is_some() {
        return Err("DSH_ROOT_PRICING_INVALID".into());
    }
    Ok(())
}

pub(crate) fn record_request_usage(
    connection: &mut rusqlite::Connection,
    root: &execution::RootExecution,
    reservation_id: &str,
    known: bool,
) -> Result<(), String> {
    let run:String=connection.query_row("SELECT r.run_id FROM task_runs r JOIN tool_call_events e ON e.run_id=r.run_id AND e.tool_name='dsh.execution_contract' WHERE r.conversation_id=?1 AND json_extract(e.arguments_summary_json,'$.execution.rootTurnId')=?2 ORDER BY r.created_at DESC LIMIT 1",
        rusqlite::params![root.conversation_id,root.root_turn_id],|r|r.get(0)).map_err(|e|e.to_string())?;
    host_facts::append(connection,AppendToolEventInput{event_id:format!("{reservation_id}-root-usage"),run_id:run,tool_name:"dsh.request_usage".into(),arguments_summary:json!({"source":"ans-host","usageKnown":known,"reservationId":reservation_id,"rootTurnId":root.root_turn_id}),
        status:"succeeded".into(),duration_ms:None,error:None,result:Some(json!({"usageKnown":known})),created_at:now(),finished_at:Some(now())}).map_err(|e|e.to_string())?;
    Ok(())
}

/// Reserve a capability invocation before the read-only Gateway executes it.
pub(crate) fn authorize_tool(
    connection: &mut rusqlite::Connection,
    root: &execution::RootExecution,
    name: &str,
) -> Result<(), String> {
    root.check_dispatch()?;
    let count:i64=connection.query_row("SELECT COUNT(*) FROM tool_call_events e JOIN task_runs r ON r.run_id=e.run_id WHERE r.conversation_id=?1 AND e.tool_name='dsh.tool_dispatch' AND json_extract(e.arguments_summary_json,'$.rootTurnId')=?2",rusqlite::params![root.conversation_id,root.root_turn_id],|r|r.get(0)).map_err(|e|e.to_string())?;
    let grants =
        crate::services::task_authorization_service::list(connection, &root.conversation_id)
            .map_err(|e| e.to_string())?;
    let budget = grants
        .iter()
        .find(|g| g.source_turn_id == root.root_turn_id && g.status == "active")
        .map(|g| &g.spec.budget);
    if count >= budget.map_or(root.max_tools, |b| b.max_tool_calls.min(root.max_tools)) {
        return Err("DSH_ROOT_TOOL_BUDGET_EXHAUSTED".into());
    }
    let run:String=connection.query_row("SELECT r.run_id FROM task_runs r JOIN tool_call_events e ON e.run_id=r.run_id AND e.tool_name='dsh.execution_contract' WHERE r.conversation_id=?1 AND r.status='running' AND json_extract(e.arguments_summary_json,'$.execution.rootTurnId')=?2 ORDER BY r.created_at DESC LIMIT 1",rusqlite::params![root.conversation_id,root.root_turn_id],|r|r.get(0)).map_err(|_|"DSH_ROOT_RUN_NOT_ACTIVE".to_string())?;
    if is_candidate_capability(name) {
        let prior:i64=connection.query_row("SELECT COUNT(*) FROM tool_call_events WHERE run_id=?1 AND tool_name='dsh.tool_dispatch' AND json_extract(arguments_summary_json,'$.toolName')=?2",rusqlite::params![run,name],|r|r.get(0)).map_err(|e|e.to_string())?;
        if prior > 0 {
            let used = usage_for_root(connection, &root.conversation_id, &root.root_turn_id)
                .map_err(|e| e.to_string())?
                .revisions;
            let cap = budget.map_or(root.max_revisions, |b| {
                b.max_revisions.min(root.max_revisions)
            });
            if used.saturating_add(1) > cap {
                return Err("DSH_ROOT_REVISION_BUDGET_EXHAUSTED".into());
            }
        }
    }

    host_facts::append(connection,AppendToolEventInput{event_id:format!("dispatch-{}",uuid::Uuid::new_v4()),run_id:run,tool_name:"dsh.tool_dispatch".into(),arguments_summary:json!({"source":"ans-host","toolName":name,"rootTurnId":root.root_turn_id}),status:"succeeded".into(),duration_ms:None,error:None,result:Some(json!({"reserved":true})),created_at:now(),finished_at:Some(now())}).map_err(|e|e.to_string())?;
    Ok(())
}

fn is_candidate_capability(name: &str) -> bool {
    CANDIDATE_TOOLS.split(',').any(|t| t == name) || name == "submit_chapter_stage"
}
