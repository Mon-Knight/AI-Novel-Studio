//! In-process native Agent session and tool-calling loop.
//!
//! Replaces the external Node DSH worker (`ans-task-server.mjs` + `cordis.yml` +
//! `novel-domain-gateway.exe`) while emitting the exact session event frames that
//! `task_runtime` projects into SQLite `task_runs` and `tool_call_events`.

use super::native_agent_transport::{
    build_openai_tools, complete_chat_step, GovernedRequestIdentity, NativeChatStepRequest,
    NativePolicySpec, NativeToolCall,
};
use super::task_runtime::{execution::RootExecution, usage};
use chrono::Utc;
use novel_domain_gateway::{call_tool_in_process, open_readonly_path, InProcessToolSecurity};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const MAX_AGENT_STEPS: u64 = 16;
const MAX_STORED_SESSIONS: usize = 128;
const MAX_STORED_MESSAGES_PER_SESSION: usize = 24;

#[derive(Clone, Default)]
struct StoredNativeSession {
    turn_counter: u64,
    next_seq: i64,
    last_worker_instance: String,
    history: Vec<Value>,
}

static NATIVE_SESSIONS: OnceLock<Mutex<HashMap<String, StoredNativeSession>>> = OnceLock::new();

fn sessions() -> &'static Mutex<HashMap<String, StoredNativeSession>> {
    NATIVE_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone)]
pub(crate) struct NativeTurnOutcome {
    pub lifecycle: String,
    pub last_assistant_text: String,
    pub last_assistant_reasoning: String,
    pub assistant_text: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub tool_call_count: usize,
}

pub(crate) struct NativeTurnParams<'a> {
    pub session_id: &'a str,
    pub worker_instance_id: &'a str,
    pub reset_history: bool,
    pub system_prompt: &'a str,
    pub user_prompt: &'a str,
    pub base_url: &'a str,
    pub api_key: &'a str,
    pub model: &'a str,
    pub max_tokens: u64,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub reasoning_effort: Option<String>,
    pub request_timeout: Duration,
    pub allowed_tools_csv: Option<&'a str>,
    pub novel_id: Option<&'a str>,
    pub chapter_id: Option<&'a str>,
    pub candidate_policy: Option<&'a str>,
    pub db_path: &'a Path,
    pub policy: Option<&'a NativePolicySpec>,
    pub root: Option<&'a RootExecution>,
    pub latest_request_identity: Option<&'a Arc<Mutex<Option<GovernedRequestIdentity>>>>,
    pub cancel: &'a AtomicBool,
    pub deadline: Instant,
}

pub(crate) fn canonical_dispatch_tool_name(wire_or_raw: &str) -> String {
    let stripped = wire_or_raw
        .trim()
        .strip_prefix("mcp__novel__")
        .or_else(|| wire_or_raw.trim().strip_prefix("novel__"))
        .unwrap_or(wire_or_raw.trim());
    let base = match stripped.split_once('@') {
        Some((prefix, ver)) if !prefix.is_empty() && ver.bytes().all(|b| b.is_ascii_digit()) => {
            prefix
        }
        _ => stripped,
    };
    match base {
        "novel_read" | "novel.read" => "novel.read".to_string(),
        "structure_read" | "structure.read" => "structure.read".to_string(),
        "context_read" | "context.read" => "context.read".to_string(),
        "memory_search" | "memory.search" => "memory.search".to_string(),
        "novel_read_context" | "novel.read_context" => "novel.read_context".to_string(),
        "chapter_read_outline" | "chapter.read_outline" => "chapter.read_outline".to_string(),
        "creative_plan_action" | "creative.plan_action" => "creative.plan_action".to_string(),
        "domain_submit_candidate" | "domain.submit_candidate" => {
            "domain.submit_candidate".to_string()
        }
        other if other.starts_with("novel_read_context_") => "novel.read_context".to_string(),
        other if other.starts_with("chapter_read_outline_") => "chapter.read_outline".to_string(),
        other if other.starts_with("creative_plan_action_") => "creative.plan_action".to_string(),
        other if other.starts_with("domain_submit_candidate_") => {
            "domain.submit_candidate".to_string()
        }
        other if other.starts_with("novel_read_") => "novel.read".to_string(),
        other if other.starts_with("structure_read_") => "structure.read".to_string(),
        other if other.starts_with("context_read_") => "context.read".to_string(),
        other if other.starts_with("memory_search_") => "memory.search".to_string(),
        other => other.to_string(),
    }
}

fn emit_session_event<F>(
    on_event: &mut F,
    session_id: &str,
    seq: &mut i64,
    event_type: &str,
    data: Value,
) -> Result<(), String>
where
    F: FnMut(&Value) -> Result<(), String>,
{
    *seq = seq.saturating_add(1);
    let notification = json!({
        "jsonrpc": "2.0",
        "method": "session.event",
        "params": {
            "sessionId": session_id,
            "event": {
                "seq": *seq,
                "time": Utc::now().timestamp_millis(),
                "type": event_type,
                "data": data,
            }
        }
    });
    on_event(&notification)
}

pub(crate) fn run_native_turn<F>(
    params: NativeTurnParams<'_>,
    mut on_event: F,
) -> Result<NativeTurnOutcome, String>
where
    F: FnMut(&Value) -> Result<(), String>,
{
    let (turn_number, mut seq, lifecycle, prior_history) = {
        let mut guard = sessions()
            .lock()
            .map_err(|_| "原生会话状态锁失败".to_string())?;
        if guard.len() >= MAX_STORED_SESSIONS && !guard.contains_key(params.session_id) {
            if let Some(first_key) = guard.keys().next().cloned() {
                guard.remove(&first_key);
            }
        }
        let exists = guard.contains_key(params.session_id);
        let entry = guard.entry(params.session_id.to_string()).or_default();
        if params.reset_history {
            entry.history.clear();
        }
        entry.turn_counter = entry.turn_counter.saturating_add(1);
        let lifecycle = if !exists {
            "created"
        } else if entry.last_worker_instance == params.worker_instance_id {
            "continued"
        } else {
            "resumed"
        }
        .to_string();
        entry.last_worker_instance = params.worker_instance_id.to_string();
        (
            entry.turn_counter,
            entry.next_seq,
            lifecycle,
            entry.history.clone(),
        )
    };

    let mut messages = Vec::with_capacity(prior_history.len() + 8);
    if !params.system_prompt.trim().is_empty() {
        messages.push(json!({
            "role": "system",
            "content": params.system_prompt,
        }));
    }
    messages.extend(prior_history);
    messages.push(json!({
        "role": "user",
        "content": params.user_prompt,
    }));

    let tools = build_openai_tools(params.allowed_tools_csv);
    let mut request_seq = 0u64;
    let mut total_prompt_tokens = 0u64;
    let mut total_completion_tokens = 0u64;
    let mut total_tool_calls = 0usize;
    let mut combined_assistant_text = String::new();
    let mut last_assistant_text;
    let mut last_assistant_reasoning;

    emit_session_event(
        &mut on_event,
        params.session_id,
        &mut seq,
        "turn/start",
        json!({ "turn": turn_number }),
    )?;

    for step in 1..=MAX_AGENT_STEPS {
        let step_req = NativeChatStepRequest {
            base_url: params.base_url.to_string(),
            api_key: params.api_key.to_string(),
            model: params.model.to_string(),
            messages: messages.clone(),
            tools: tools.clone(),
            max_tokens: params.max_tokens,
            temperature: params.temperature,
            top_p: params.top_p,
            reasoning_effort: params.reasoning_effort.clone(),
            request_timeout: params.request_timeout,
        };
        let step_out = complete_chat_step(
            &step_req,
            params.policy,
            &mut request_seq,
            params.cancel,
            params.deadline,
        )?;
        if let (Some(holder), Some(identity)) = (
            params.latest_request_identity,
            step_out.governed_identity.clone(),
        ) {
            if let Ok(mut guard) = holder.lock() {
                *guard = Some(identity);
            }
        }
        total_prompt_tokens = total_prompt_tokens.saturating_add(step_out.prompt_tokens);
        total_completion_tokens =
            total_completion_tokens.saturating_add(step_out.completion_tokens);
        last_assistant_text = step_out.content.clone();
        last_assistant_reasoning = step_out.reasoning.clone();
        if !step_out.content.is_empty() {
            combined_assistant_text.push_str(&step_out.content);
        }

        if step_out.tool_calls.is_empty() {
            if !step_out.content.trim().is_empty() {
                emit_session_event(
                    &mut on_event,
                    params.session_id,
                    &mut seq,
                    "assistant/message",
                    json!({
                        "turn": turn_number,
                        "step": step,
                        "message": {
                            "role": "assistant",
                            "content": [{ "type": "text", "text": step_out.content }]
                        }
                    }),
                )?;
            }
            emit_session_event(
                &mut on_event,
                params.session_id,
                &mut seq,
                "turn/end",
                json!({ "turn": turn_number, "reason": { "kind": "complete" } }),
            )?;
            persist_completed_session_turn(
                params.session_id,
                seq,
                params.user_prompt,
                &last_assistant_text,
            );
            return Ok(NativeTurnOutcome {
                lifecycle,
                last_assistant_text,
                last_assistant_reasoning,
                assistant_text: combined_assistant_text,
                prompt_tokens: total_prompt_tokens,
                completion_tokens: total_completion_tokens,
                tool_call_count: total_tool_calls,
            });
        }

        if !step_out.content.trim().is_empty() {
            emit_session_event(
                &mut on_event,
                params.session_id,
                &mut seq,
                "assistant/message",
                json!({
                    "turn": turn_number,
                    "step": step,
                    "message": {
                        "role": "assistant",
                        "content": [{ "type": "text", "text": step_out.content }]
                    }
                }),
            )?;
        }

        let assistant_tool_calls: Vec<Value> = step_out
            .tool_calls
            .iter()
            .map(|c| {
                json!({
                    "id": c.id,
                    "type": "function",
                    "function": { "name": c.name, "arguments": c.arguments }
                })
            })
            .collect();
        messages.push(json!({
            "role": "assistant",
            "content": if step_out.content.is_empty() { Value::Null } else { Value::String(step_out.content.clone()) },
            "tool_calls": assistant_tool_calls,
        }));

        for call in &step_out.tool_calls {
            total_tool_calls = total_tool_calls.saturating_add(1);
            let result_text = execute_and_project_tool_call(
                &params,
                call,
                turn_number,
                step,
                &mut seq,
                &mut on_event,
            )?;
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call.id,
                "content": result_text,
            }));
        }
    }

    Err(format!(
        "DSH_AGENT_STEP_BUDGET_EXHAUSTED: 单回合工具步骤超过 {} 步上限",
        MAX_AGENT_STEPS
    ))
}

fn execute_and_project_tool_call<F>(
    params: &NativeTurnParams<'_>,
    call: &NativeToolCall,
    turn_number: u64,
    step: u64,
    seq: &mut i64,
    on_event: &mut F,
) -> Result<String, String>
where
    F: FnMut(&Value) -> Result<(), String>,
{
    emit_session_event(
        on_event,
        params.session_id,
        seq,
        "tool/call",
        json!({
            "turn": turn_number,
            "step": step,
            "callId": call.id,
            "name": call.name,
            "arguments": call.arguments,
        }),
    )?;

    let dispatch_name = canonical_dispatch_tool_name(&call.name);
    let parsed_args = match serde_json::from_str::<Value>(&call.arguments) {
        Ok(value) => Ok(value),
        Err(err) => Err(format!("tool arguments are not valid JSON: {err}")),
    };

    let (result_text, is_error) = match parsed_args {
        Ok(arguments) => {
            let readonly = open_readonly_path(params.db_path)?;
            let security = InProcessToolSecurity {
                allowed_tools_csv: params.allowed_tools_csv,
                novel_id: params.novel_id,
                chapter_id: params.chapter_id,
                candidate_policy: params.candidate_policy,
            };
            let root = params.root;
            let authorize = |tool_name: &str| -> Result<(), String> {
                let Some(root_exec) = root else {
                    return Ok(());
                };
                root_exec.check()?;
                let mut conn = crate::db::get_connection()
                    .lock()
                    .map_err(|_| "DSH_TOOL_BUDGET_DATABASE_FAILED".to_string())?;
                usage::authorize_tool(&mut conn, root_exec, tool_name)
            };
            call_tool_in_process(&readonly, &dispatch_name, &arguments, security, &authorize)?
        }
        Err(err_msg) => (json!({ "error": err_msg }).to_string(), true),
    };

    emit_session_event(
        on_event,
        params.session_id,
        seq,
        "tool/result",
        json!({
            "turn": turn_number,
            "step": step,
            "message": {
                "source": { "callId": call.id },
                "content": [{
                    "type": "tool_result",
                    "toolCallId": call.id,
                    "isError": is_error,
                    "content": [{ "type": "text", "text": result_text }]
                }]
            }
        }),
    )?;

    Ok(result_text)
}

fn persist_completed_session_turn(
    session_id: &str,
    seq: i64,
    user_prompt: &str,
    assistant_text: &str,
) {
    if let Ok(mut guard) = sessions().lock() {
        let entry = guard.entry(session_id.to_string()).or_default();
        entry.next_seq = seq;
        if !assistant_text.trim().is_empty() {
            entry.history.push(json!({
                "role": "user",
                "content": user_prompt,
            }));
            entry.history.push(json!({
                "role": "assistant",
                "content": assistant_text,
            }));
            while entry.history.len() > MAX_STORED_MESSAGES_PER_SESSION {
                entry.history.drain(..2.min(entry.history.len()));
            }
        }
    }
}
