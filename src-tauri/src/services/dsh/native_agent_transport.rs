//! In-process OpenAI-compatible SSE + tool-calling transport with SQLite policy governance.
//!
//! Replaces both `governed_proxy.rs` and `model-proxy.mjs` with direct Rust reservation,
//! lease verification, cancellable SSE streaming, tool-call delta assembly, and settlement.

use super::native_agent_evidence::{
    enforce_upstream_budget_if_configured, write_real_e2e_provider_evidence_if_enabled,
};
pub(crate) use super::native_agent_sse::build_openai_tools;
use super::native_agent_sse::{
    is_loopback_base_url, parse_chat_response_body, resolve_chat_completions_url,
};
use super::task_runtime::{execution::RootExecution, usage};
use crate::services::ai_request_policy_service::{
    self, AiRequestPolicyLeaseGrant, AiRequestPolicyLeaseProof, ReserveAiRequestInput,
    SettleAiRequestInput,
};
use reqwest::redirect::Policy as RedirectPolicy;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct GovernedRequestIdentity {
    pub provider_request_id: String,
    pub reservation_id: String,
}

pub type GovernedRequestIdentityReader = Arc<Mutex<Option<GovernedRequestIdentity>>>;

const MAX_SSE_BUFFER_BYTES: usize = 4 * 1024 * 1024;
const TRANSIENT_RETRY_LIMIT: usize = 1;

#[derive(Debug, Clone)]
pub(crate) struct NativePolicySpec {
    pub owner_id: String,
    pub request_prefix: String,
    pub max_requests_per_minute: i64,
    pub max_concurrent_requests: i64,
    pub daily_token_budget: Option<i64>,
    pub daily_cost_budget_usd: Option<f64>,
    pub input_price_per_million_tokens: Option<f64>,
    pub output_price_per_million_tokens: Option<f64>,
    pub warning_percent: i64,
    pub ttl_ms: i64,
    pub root: Option<RootExecution>,
}

#[derive(Debug, Clone)]
pub(crate) struct NativeToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone)]
pub(crate) struct NativeChatStepOutput {
    pub content: String,
    pub reasoning: String,
    pub tool_calls: Vec<NativeToolCall>,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub finish_reason: Option<String>,
    pub governed_identity: Option<GovernedRequestIdentity>,
}

#[derive(Debug, Clone)]
pub(crate) struct NativeChatStepRequest {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub messages: Vec<Value>,
    pub tools: Vec<Value>,
    pub max_tokens: u64,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
    pub reasoning_effort: Option<String>,
    pub request_timeout: Duration,
}

struct AutoSettleLeaseGuard {
    grant: Option<AiRequestPolicyLeaseGrant>,
    root: Option<RootExecution>,
}

impl AutoSettleLeaseGuard {
    fn reserve(
        policy: &NativePolicySpec,
        provider_request_id: String,
        estimated_input_tokens: i64,
        estimated_output_tokens: i64,
    ) -> Result<(Self, GovernedRequestIdentity), String> {
        let mut connection = crate::db::get_connection()
            .lock()
            .map_err(|_| "AI 请求治理数据库锁失败".to_string())?;
        if let Some(root) = policy.root.as_ref() {
            usage::before_dispatch(
                &connection,
                root,
                estimated_input_tokens,
                estimated_output_tokens,
                policy.input_price_per_million_tokens,
                policy.output_price_per_million_tokens,
            )?;
        }
        let grant = ai_request_policy_service::reserve_request(
            &mut connection,
            ReserveAiRequestInput {
                owner_id: policy.owner_id.clone(),
                provider_request_id,
                max_requests_per_minute: policy.max_requests_per_minute,
                max_concurrent_requests: policy.max_concurrent_requests,
                daily_token_budget: policy.daily_token_budget,
                daily_cost_budget_usd: policy.daily_cost_budget_usd,
                estimated_input_tokens,
                estimated_output_tokens,
                input_price_per_million_tokens: policy.input_price_per_million_tokens,
                output_price_per_million_tokens: policy.output_price_per_million_tokens,
                warning_percent: policy.warning_percent,
                ttl_ms: policy.ttl_ms,
            },
        )
        .map_err(|e| format!("{}: {}", e.code, e.message))?;
        let proof = AiRequestPolicyLeaseProof {
            reservation_id: grant.reservation_id.clone(),
            owner_id: grant.owner_id.clone(),
            provider_request_id: grant.provider_request_id.clone(),
            lease_token: grant.lease_token.clone(),
        };
        let guard = Self {
            grant: Some(grant.clone()),
            root: policy.root.clone(),
        };
        ai_request_policy_service::verify_provider_dispatch(&mut connection, &proof)
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
        let identity = GovernedRequestIdentity {
            provider_request_id: grant.provider_request_id,
            reservation_id: grant.reservation_id,
        };
        Ok((guard, identity))
    }

    fn settle(
        mut self,
        outcome: &str,
        token_input: Option<i64>,
        token_output: Option<i64>,
    ) -> Result<(), String> {
        let Some(grant) = self.grant.take() else {
            return Ok(());
        };
        let mut connection = crate::db::get_connection()
            .lock()
            .map_err(|_| "AI 请求治理数据库锁失败".to_string())?;
        let reservation_id = grant.reservation_id.clone();
        let known = outcome == "succeeded"
            && token_input.is_some_and(|v| v >= 0)
            && token_output.is_some_and(|v| v >= 0);
        ai_request_policy_service::settle_request(
            &mut connection,
            SettleAiRequestInput {
                reservation_id: grant.reservation_id,
                owner_id: grant.owner_id,
                lease_token: grant.lease_token,
                outcome: outcome.to_string(),
                token_input,
                token_output,
            },
        )
        .map_err(|e| format!("{}: {}", e.code, e.message))?;
        if let Some(root) = self.root.as_ref() {
            usage::record_request_usage(&mut connection, root, &reservation_id, known)?;
        }
        Ok(())
    }
}

impl Drop for AutoSettleLeaseGuard {
    fn drop(&mut self) {
        let Some(grant) = self.grant.take() else {
            return;
        };
        if let Ok(mut connection) = crate::db::get_connection().lock() {
            let reservation_id = grant.reservation_id.clone();
            let _ = ai_request_policy_service::settle_request(
                &mut connection,
                SettleAiRequestInput {
                    reservation_id: grant.reservation_id,
                    owner_id: grant.owner_id,
                    lease_token: grant.lease_token,
                    outcome: "failed".to_string(),
                    token_input: None,
                    token_output: None,
                },
            );
            if let Some(root) = self.root.as_ref() {
                let _ = usage::record_request_usage(&mut connection, root, &reservation_id, false);
            }
        }
    }
}

#[derive(Debug)]
enum AttemptError {
    Transient(String),
    Fatal(String),
}

pub(crate) fn complete_chat_step(
    request: &NativeChatStepRequest,
    policy: Option<&NativePolicySpec>,
    sequence: &mut u64,
    cancel: &AtomicBool,
    deadline: Instant,
) -> Result<NativeChatStepOutput, String> {
    if crate::runtime::is_network_blocked() && !is_loopback_base_url(&request.base_url) {
        return Err("AI network requests are disabled in E2E mode".to_string());
    }
    let mut attempt = 0usize;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("DSH_TASK_CANCELLED".to_string());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("AI_REQUEST_TIMEOUT: 模型调用超时".to_string());
        }
        *sequence = sequence.saturating_add(1);
        match execute_single_attempt(request, policy, *sequence, cancel, deadline) {
            Ok(output) => return Ok(output),
            Err(AttemptError::Transient(err)) if attempt < TRANSIENT_RETRY_LIMIT => {
                attempt += 1;
                let sleep_until = Instant::now() + Duration::from_millis(200);
                while Instant::now() < sleep_until {
                    if cancel.load(Ordering::SeqCst) {
                        return Err("DSH_TASK_CANCELLED".to_string());
                    }
                    if Instant::now() >= deadline {
                        return Err(err);
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
            }
            Err(AttemptError::Transient(err) | AttemptError::Fatal(err)) => return Err(err),
        }
    }
}

fn execute_single_attempt(
    request: &NativeChatStepRequest,
    policy: Option<&NativePolicySpec>,
    seq: u64,
    cancel: &AtomicBool,
    deadline: Instant,
) -> Result<NativeChatStepOutput, AttemptError> {
    let target_url = resolve_chat_completions_url(&request.base_url).map_err(AttemptError::Fatal)?;
    let mut body = json!({
        "model": request.model,
        "messages": request.messages,
        "max_tokens": request.max_tokens,
        "stream": true,
        "stream_options": { "include_usage": true },
    });
    if !request.tools.is_empty() {
        body["tools"] = Value::Array(request.tools.clone());
    }
    if let Some(temp) = request.temperature {
        body["temperature"] = json!(temp);
    }
    if let Some(top_p) = request.top_p {
        body["top_p"] = json!(top_p);
    }
    if let Some(effort) = request
        .reasoning_effort
        .as_deref()
        .filter(|v| !v.is_empty() && *v != "off")
    {
        body["reasoning_effort"] = json!(effort);
    }
    let serialized = serde_json::to_string(&body).map_err(|e| AttemptError::Fatal(e.to_string()))?;
    let estimated_in = ((serialized.len() as i64) + 3) / 4;
    let estimated_out = i64::try_from(request.max_tokens).unwrap_or(8_192).max(1);

    let (lease_guard, governed_identity) = match policy {
        Some(spec) => {
            let req_id = format!("{}:{seq}", spec.request_prefix);
            let (guard, id) =
                AutoSettleLeaseGuard::reserve(spec, req_id, estimated_in.max(1), estimated_out)
                    .map_err(AttemptError::Fatal)?;
            (Some(guard), Some(id))
        }
        None => (None, None),
    };

    let _budget_active =
        enforce_upstream_budget_if_configured(&target_url, &request.base_url, &request.model)
            .map_err(AttemptError::Fatal)?;
    let req_id_for_evidence = governed_identity
        .as_ref()
        .map(|g| g.provider_request_id.clone())
        .unwrap_or_else(|| format!("native:{seq}"));

    let timeout = request
        .request_timeout
        .min(deadline.saturating_duration_since(Instant::now()))
        .max(Duration::from_millis(100));
    let api_key = request.api_key.clone();
    let is_loopback = is_loopback_base_url(&request.base_url);
    let serialized_clone = serialized.clone();
    let (tx, rx) = mpsc::channel();
    let task = tauri::async_runtime::spawn(async move {
        let result =
            send_and_collect_stream(target_url, api_key, serialized_clone, timeout, is_loopback)
                .await;
        let _ = tx.send(result);
    });
    let abort_handle = task.inner().abort_handle();

    let raw_result = loop {
        if cancel.load(Ordering::SeqCst) {
            abort_handle.abort();
            return Err(AttemptError::Fatal("DSH_TASK_CANCELLED".to_string()));
        }
        if Instant::now() >= deadline {
            abort_handle.abort();
            return Err(AttemptError::Fatal(
                "AI_REQUEST_TIMEOUT: 模型调用超过回合时间上限".to_string(),
            ));
        }
        match rx.recv_timeout(Duration::from_millis(25)) {
            Ok(outcome) => break outcome,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(AttemptError::Fatal(
                    "AI_REQUEST_RUNTIME_FAILED: 异步请求通道异常中断".to_string(),
                ));
            }
        }
    };

    match raw_result {
        Ok(mut step) => {
            write_real_e2e_provider_evidence_if_enabled(&req_id_for_evidence, &serialized, &body)
                .map_err(AttemptError::Fatal)?;
            let prompt_i64 = i64::try_from(step.prompt_tokens).unwrap_or(estimated_in.max(1));
            let completion_i64 = i64::try_from(step.completion_tokens).unwrap_or(1);
            if let Some(guard) = lease_guard {
                guard
                    .settle("succeeded", Some(prompt_i64), Some(completion_i64))
                    .map_err(AttemptError::Fatal)?;
            }
            step.governed_identity = governed_identity;
            Ok(step)
        }
        Err(err) => {
            if let Some(guard) = lease_guard {
                let _ = guard.settle("failed", None, None);
            }
            Err(err)
        }
    }
}

async fn send_and_collect_stream(
    url: reqwest::Url,
    api_key: String,
    serialized_body: String,
    timeout: Duration,
    is_loopback: bool,
) -> Result<NativeChatStepOutput, AttemptError> {
    let mut builder = reqwest::Client::builder()
        .timeout(timeout)
        .redirect(RedirectPolicy::none());
    if is_loopback {
        builder = builder.no_proxy();
    }
    let client = builder
        .build()
        .map_err(|e| AttemptError::Fatal(format!("HTTP 客户端初始化失败: {e}")))?;
    let mut response = client
        .post(url)
        .bearer_auth(api_key.trim())
        .header("content-type", "application/json")
        .body(serialized_body)
        .send()
        .await
        .map_err(|e| {
            let msg = if e.is_timeout() {
                "AI_PROVIDER_TIMEOUT: 模型服务连接或响应超时".to_string()
            } else {
                format!("AI_PROVIDER_CONNECT_FAILED: 无法连接模型服务 ({e})")
            };
            if e.is_connect() || e.is_timeout() {
                AttemptError::Transient(msg)
            } else {
                AttemptError::Fatal(msg)
            }
        })?;

    let status = response.status();
    if !status.is_success() {
        let body_text = response.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<Value>(&body_text)
            .ok()
            .and_then(|v| {
                v.pointer("/error/message")
                    .or_else(|| v.get("error"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| body_text.chars().take(240).collect());
        let formatted = format!("AI 模型服务返回 HTTP {}: {}", status.as_u16(), detail.trim());
        return if matches!(status.as_u16(), 429 | 500 | 502 | 503 | 504) {
            Err(AttemptError::Transient(formatted))
        } else {
            Err(AttemptError::Fatal(formatted))
        };
    }

    let mut raw_bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| {
        AttemptError::Transient(format!("AI_PROVIDER_TRANSPORT_INTERRUPTED: 流式读取中断 ({e})"))
    })? {
        if raw_bytes.len().saturating_add(chunk.len()) > MAX_SSE_BUFFER_BYTES {
            return Err(AttemptError::Fatal("AI 响应体积超过安全上限".to_string()));
        }
        raw_bytes.extend_from_slice(&chunk);
    }
    let raw_text = std::str::from_utf8(&raw_bytes)
        .map_err(|_| AttemptError::Fatal("AI 响应包含非法 UTF-8 字节".to_string()))?;
    parse_chat_response_body(raw_text).map_err(AttemptError::Fatal)
}
