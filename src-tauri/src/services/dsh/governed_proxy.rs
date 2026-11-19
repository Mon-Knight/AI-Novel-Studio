//! Loopback policy authority for model requests emitted by a DSH worker.
//!
//! The Node proxy must obtain a Rust/SQLite reservation immediately before
//! every upstream dispatch.  It receives only an opaque ticket; lease tokens
//! never leave this process.  Dropping the guard conservatively settles every
//! outstanding request, so a proxy or Worker crash cannot strand capacity.

use crate::services::ai_request_policy_service::{
    self, AiRequestPolicyLeaseGrant, AiRequestPolicyLeaseProof, ReserveAiRequestInput,
    SettleAiRequestInput,
};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const MAX_CONTROL_BODY_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone)]
pub struct GovernedProxyPolicy {
    pub owner_id: String,
    pub max_requests_per_minute: i64,
    pub max_concurrent_requests: i64,
    pub daily_token_budget: Option<i64>,
    pub daily_cost_budget_usd: Option<f64>,
    pub input_price_per_million_tokens: Option<f64>,
    pub output_price_per_million_tokens: Option<f64>,
    pub warning_percent: i64,
    pub ttl_ms: i64,
}

#[derive(Debug, Clone)]
pub struct GovernedRequestIdentity {
    pub provider_request_id: String,
    pub reservation_id: String,
}

pub type GovernedRequestIdentityReader = Arc<Mutex<Option<GovernedRequestIdentity>>>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReserveControlRequest {
    provider_request_id: String,
    estimated_input_tokens: i64,
    estimated_output_tokens: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettleControlRequest {
    ticket: String,
    outcome: String,
    token_input: Option<i64>,
    token_output: Option<i64>,
}

struct ServerState {
    policy: GovernedProxyPolicy,
    root: Option<super::task_runtime::execution::RootExecution>,
    leases: Mutex<HashMap<String, AiRequestPolicyLeaseGrant>>,
    latest_request_identity: GovernedRequestIdentityReader,
}

pub struct GovernedProxyPolicyGuard {
    address: String,
    stop: Arc<AtomicBool>,
    state: Arc<ServerState>,
    thread: Option<JoinHandle<()>>,
}

impl GovernedProxyPolicyGuard {
    pub fn url(&self) -> String {
        format!("http://{}", self.address)
    }

    pub fn request_identity_reader(&self) -> GovernedRequestIdentityReader {
        self.state.latest_request_identity.clone()
    }
}

fn settle_grant(
    grant: AiRequestPolicyLeaseGrant,
    outcome: &str,
    input: Option<i64>,
    output: Option<i64>,
) {
    if let Ok(mut connection) = crate::db::get_connection().lock() {
        let _ = ai_request_policy_service::settle_request(
            &mut connection,
            SettleAiRequestInput {
                reservation_id: grant.reservation_id,
                owner_id: grant.owner_id,
                lease_token: grant.lease_token,
                outcome: outcome.to_string(),
                token_input: input,
                token_output: output,
            },
        );
    }
}

impl Drop for GovernedProxyPolicyGuard {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let _ = TcpStream::connect(&self.address);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        let outstanding = self
            .state
            .leases
            .lock()
            .map(|mut leases| leases.drain().map(|(_, lease)| lease).collect::<Vec<_>>())
            .unwrap_or_default();
        for grant in outstanding {
            settle_grant(grant, "failed", None, None);
        }
    }
}

pub fn start_policy_server(
    policy: GovernedProxyPolicy,
) -> Result<GovernedProxyPolicyGuard, String> {
    start_policy_server_with_root(policy, None)
}

pub(super) fn start_policy_server_with_root(
    policy: GovernedProxyPolicy,
    root: Option<super::task_runtime::execution::RootExecution>,
) -> Result<GovernedProxyPolicyGuard, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("AI 请求治理端口分配失败: {}", error))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("AI 请求治理端口配置失败: {}", error))?;
    let address = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .to_string();
    let stop = Arc::new(AtomicBool::new(false));
    let state = Arc::new(ServerState {
        policy,
        root,
        leases: Mutex::new(HashMap::new()),
        latest_request_identity: Arc::new(Mutex::new(None)),
    });
    let thread_stop = stop.clone();
    let thread_state = state.clone();
    let thread = thread::spawn(move || {
        while !thread_stop.load(Ordering::Acquire) {
            match listener.accept() {
                Ok((stream, _)) => {
                    if stream.set_nonblocking(false).is_ok() {
                        handle_connection(stream, &thread_state);
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(20));
                }
                Err(_) => break,
            }
        }
    });
    Ok(GovernedProxyPolicyGuard {
        address,
        stop,
        state,
        thread: Some(thread),
    })
}

fn read_request(stream: &mut TcpStream) -> Result<(String, Vec<u8>), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|error| error.to_string())?;
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    let header_end = loop {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("AI 请求治理控制连接提前关闭".to_string());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_CONTROL_BODY_BYTES {
            return Err("AI 请求治理控制载荷过大".to_string());
        }
        if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            break index + 4;
        }
    };
    let header = std::str::from_utf8(&buffer[..header_end])
        .map_err(|_| "AI 请求治理控制请求头无效".to_string())?;
    let first_line = header
        .lines()
        .next()
        .ok_or_else(|| "AI 请求治理控制请求行缺失".to_string())?;
    let mut request_parts = first_line.split_whitespace();
    if request_parts.next() != Some("POST") {
        return Err("AI 请求治理控制接口只接受 POST".to_string());
    }
    let path = request_parts
        .next()
        .ok_or_else(|| "AI 请求治理控制路径缺失".to_string())?
        .to_string();
    let content_length = header
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .ok_or_else(|| "AI 请求治理控制请求缺少 Content-Length".to_string())?;
    if content_length > MAX_CONTROL_BODY_BYTES {
        return Err("AI 请求治理控制载荷过大".to_string());
    }
    while buffer.len() < header_end + content_length {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("AI 请求治理控制请求正文不完整".to_string());
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    Ok((
        path,
        buffer[header_end..header_end + content_length].to_vec(),
    ))
}

fn write_response(stream: &mut TcpStream, status: u16, body: serde_json::Value) {
    let body = serde_json::to_vec(&body).unwrap_or_else(|_| b"{}".to_vec());
    let reason = if status == 200 {
        "OK"
    } else {
        "Too Many Requests"
    };
    let header = format!(
        "HTTP/1.1 {} {}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        status,
        reason,
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(&body);
    let _ = stream.flush();
}

fn handle_connection(mut stream: TcpStream, state: &Arc<ServerState>) {
    let result = read_request(&mut stream).and_then(|(path, body)| match path.as_str() {
        "/reserve" => reserve(state, &body),
        "/settle" => settle(state, &body),
        "/tool" => authorize_tool(state, &body),
        _ => Err("未知的 AI 请求治理控制接口".to_string()),
    });
    match result {
        Ok(body) => write_response(&mut stream, 200, body),
        Err(error) => write_response(&mut stream, 429, json!({ "error": error })),
    }
}

fn reserve(state: &Arc<ServerState>, body: &[u8]) -> Result<serde_json::Value, String> {
    let request: ReserveControlRequest =
        serde_json::from_slice(body).map_err(|_| "AI 请求治理预留载荷无效".to_string())?;
    let policy = &state.policy;
    let mut connection = crate::db::get_connection()
        .lock()
        .map_err(|_| "AI 请求治理数据库锁失败".to_string())?;
    if let Some(root) = state.root.as_ref() {
        super::task_runtime::usage::before_dispatch(
            &connection,
            root,
            request.estimated_input_tokens,
            request.estimated_output_tokens,
            policy.input_price_per_million_tokens,
            policy.output_price_per_million_tokens,
        )?;
    }
    let grant = ai_request_policy_service::reserve_request(
        &mut connection,
        ReserveAiRequestInput {
            owner_id: policy.owner_id.clone(),
            provider_request_id: request.provider_request_id,
            max_requests_per_minute: policy.max_requests_per_minute,
            max_concurrent_requests: policy.max_concurrent_requests,
            daily_token_budget: policy.daily_token_budget,
            daily_cost_budget_usd: policy.daily_cost_budget_usd,
            estimated_input_tokens: request.estimated_input_tokens,
            estimated_output_tokens: request.estimated_output_tokens,
            input_price_per_million_tokens: policy.input_price_per_million_tokens,
            output_price_per_million_tokens: policy.output_price_per_million_tokens,
            warning_percent: policy.warning_percent,
            ttl_ms: policy.ttl_ms,
        },
    )
    .map_err(|error| format!("{}: {}", error.code, error.message))?;
    let proof = AiRequestPolicyLeaseProof {
        reservation_id: grant.reservation_id.clone(),
        owner_id: grant.owner_id.clone(),
        provider_request_id: grant.provider_request_id.clone(),
        lease_token: grant.lease_token.clone(),
    };
    if let Err(error) = ai_request_policy_service::verify_provider_dispatch(&mut connection, &proof)
    {
        drop(connection);
        settle_grant(grant, "failed", None, None);
        return Err(format!("{}: {}", error.code, error.message));
    }
    drop(connection);
    *state
        .latest_request_identity
        .lock()
        .map_err(|_| "AI 请求治理身份锁失败".to_string())? = Some(GovernedRequestIdentity {
        provider_request_id: grant.provider_request_id.clone(),
        reservation_id: grant.reservation_id.clone(),
    });
    let ticket = uuid::Uuid::new_v4().to_string();
    state
        .leases
        .lock()
        .map_err(|_| "AI 请求治理租约锁失败".to_string())?
        .insert(ticket.clone(), grant);
    Ok(json!({ "ticket": ticket }))
}

fn settle(state: &Arc<ServerState>, body: &[u8]) -> Result<serde_json::Value, String> {
    let request: SettleControlRequest =
        serde_json::from_slice(body).map_err(|_| "AI 请求治理结算载荷无效".to_string())?;
    let grant = state
        .leases
        .lock()
        .map_err(|_| "AI 请求治理租约锁失败".to_string())?
        .remove(&request.ticket)
        .ok_or_else(|| "AI 请求治理 ticket 不存在或已结算".to_string())?;
    let mut connection = crate::db::get_connection()
        .lock()
        .map_err(|_| "AI 请求治理数据库锁失败".to_string())?;
    let reservation_id = grant.reservation_id.clone();
    let known = request.outcome == "succeeded"
        && request.token_input.is_some_and(|v| v >= 0)
        && request.token_output.is_some_and(|v| v >= 0);
    ai_request_policy_service::settle_request(
        &mut connection,
        SettleAiRequestInput {
            reservation_id: grant.reservation_id,
            owner_id: grant.owner_id,
            lease_token: grant.lease_token,
            outcome: request.outcome,
            token_input: request.token_input,
            token_output: request.token_output,
        },
    )
    .map_err(|error| format!("{}: {}", error.code, error.message))?;
    if let Some(root) = state.root.as_ref() {
        super::task_runtime::usage::record_request_usage(
            &mut connection,
            root,
            &reservation_id,
            known,
        )?;
    }
    Ok(json!({ "settled": true }))
}

fn authorize_tool(state: &Arc<ServerState>, body: &[u8]) -> Result<serde_json::Value, String> {
    let root = state.root.as_ref().ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    root.check()?;
    let value: serde_json::Value =
        serde_json::from_slice(body).map_err(|_| "DSH_TOOL_BUDGET_INPUT_INVALID")?;
    let name = value
        .get("toolName")
        .and_then(serde_json::Value::as_str)
        .filter(|v| !v.is_empty() && v.len() <= 160)
        .ok_or("DSH_TOOL_BUDGET_INPUT_INVALID")?;
    let mut connection = crate::db::get_connection()
        .lock()
        .map_err(|_| "DSH_TOOL_BUDGET_DATABASE_FAILED")?;
    super::task_runtime::usage::authorize_tool(&mut connection, root, name)?;
    Ok(json!({"allowed":true}))
}

#[cfg(test)]
#[path = "governed_proxy_tests.rs"]
mod tests;
