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
        leases: Mutex::new(HashMap::new()),
        latest_request_identity: Arc::new(Mutex::new(None)),
    });
    let thread_stop = stop.clone();
    let thread_state = state.clone();
    let thread = thread::spawn(move || {
        while !thread_stop.load(Ordering::Acquire) {
            match listener.accept() {
                Ok((stream, _)) => handle_connection(stream, &thread_state),
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
    Ok(json!({ "settled": true }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn post(url: &str, path: &str, payload: Value) -> (u16, Value) {
        let address = url.trim_start_matches("http://");
        let body = serde_json::to_vec(&payload).expect("serialize control payload");
        let mut stream = TcpStream::connect(address).expect("connect policy server");
        let request = format!(
            "POST {} HTTP/1.1\r\nhost: {}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
            path,
            address,
            body.len()
        );
        stream
            .write_all(request.as_bytes())
            .expect("write control headers");
        stream.write_all(&body).expect("write control body");
        stream.flush().expect("flush control request");
        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .expect("read control response");
        let response = String::from_utf8(response).expect("utf8 control response");
        let (head, body) = response.split_once("\r\n\r\n").expect("response frame");
        let status = head
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|value| value.parse::<u16>().ok())
            .expect("response status");
        (
            status,
            serde_json::from_str(body).expect("response json body"),
        )
    }

    fn policy(owner_id: String) -> GovernedProxyPolicy {
        GovernedProxyPolicy {
            owner_id,
            max_requests_per_minute: 120,
            max_concurrent_requests: 8,
            daily_token_budget: Some(1_000_000),
            daily_cost_budget_usd: Some(100.0),
            input_price_per_million_tokens: Some(1.0),
            output_price_per_million_tokens: Some(2.0),
            warning_percent: 80,
            ttl_ms: 60_000,
        }
    }

    #[test]
    fn control_server_tracks_real_request_identity_and_conservatively_closes_leases() {
        crate::db::init_test_database();
        let suffix = uuid::Uuid::new_v4().to_string();
        let guard = start_policy_server(policy(format!("dsh-test-owner-{suffix}")))
            .expect("start policy server");
        let first_request = format!("dsh-test-request-{suffix}-1");
        let (status, reserve) = post(
            &guard.url(),
            "/reserve",
            json!({
                "providerRequestId":first_request,
                "estimatedInputTokens":20,
                "estimatedOutputTokens":30
            }),
        );
        assert_eq!(status, 200);
        let ticket = reserve
            .get("ticket")
            .and_then(Value::as_str)
            .expect("opaque ticket")
            .to_string();
        let identity = guard
            .request_identity_reader()
            .lock()
            .expect("identity reader")
            .clone()
            .expect("latest identity");
        assert_eq!(identity.provider_request_id, first_request);
        let (status, settled) = post(
            &guard.url(),
            "/settle",
            json!({
                "ticket":ticket,
                "outcome":"succeeded",
                "tokenInput":11,
                "tokenOutput":7
            }),
        );
        assert_eq!(status, 200);
        assert_eq!(settled.get("settled").and_then(Value::as_bool), Some(true));
        let first_row: (String, i64, i64) = crate::db::get_connection()
            .lock()
            .expect("database")
            .query_row(
                "SELECT status, accounted_input_tokens, accounted_output_tokens
                 FROM ai_request_reservations WHERE reservation_id=?1",
                rusqlite::params![identity.reservation_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("settled reservation");
        assert_eq!(first_row, ("settled".to_string(), 11, 7));

        let second_request = format!("dsh-test-request-{suffix}-2");
        assert_eq!(
            post(
                &guard.url(),
                "/reserve",
                json!({
                    "providerRequestId":second_request,
                    "estimatedInputTokens":40,
                    "estimatedOutputTokens":60
                }),
            )
            .0,
            200
        );
        let second_identity = guard
            .request_identity_reader()
            .lock()
            .expect("identity reader")
            .clone()
            .expect("second identity");
        drop(guard);
        let second_row: (String, i64, i64) = crate::db::get_connection()
            .lock()
            .expect("database")
            .query_row(
                "SELECT status, accounted_input_tokens, accounted_output_tokens
                 FROM ai_request_reservations WHERE reservation_id=?1",
                rusqlite::params![second_identity.reservation_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("conservatively settled reservation");
        assert_eq!(second_row, ("failed".to_string(), 40, 60));
    }
}
