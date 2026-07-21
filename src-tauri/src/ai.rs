use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

const AI_REQUEST_CANCELLED: &str = "AI_REQUEST_CANCELLED";
const AI_REQUEST_ID_INVALID: &str = "AI_REQUEST_ID_INVALID";
const AI_REQUEST_ID_IN_USE: &str = "AI_REQUEST_ID_IN_USE";
const AI_REQUEST_ID_RECENTLY_SETTLED: &str = "AI_REQUEST_ID_RECENTLY_SETTLED";
const AI_REQUEST_CAPACITY_EXCEEDED: &str = "AI_REQUEST_CAPACITY_EXCEEDED";
const AI_REQUEST_RUNTIME_FAILED: &str = "AI_REQUEST_RUNTIME_FAILED";
const AI_REQUEST_REGISTRY_LOST: &str = "AI_REQUEST_REGISTRY_LOST";
const MAX_ACTIVE_AI_REQUESTS: usize = 64;
const MAX_PENDING_CANCELLATIONS: usize = 128;
const MAX_RECENTLY_SETTLED_REQUESTS: usize = 128;
const REQUEST_STATE_TTL: Duration = Duration::from_secs(30);
const MAX_REQUEST_ID_BYTES: usize = 128;

type AbortCallback = Arc<dyn Fn() + Send + Sync + 'static>;

struct ActiveAiRequest {
    token: u64,
    cancellation_requested: Arc<AtomicBool>,
    abort: Option<AbortCallback>,
}

#[derive(Default)]
struct AiRequestRegistry {
    active: HashMap<String, ActiveAiRequest>,
    pending_cancellations: HashMap<String, Instant>,
    recently_settled: HashMap<String, Instant>,
    next_token: u64,
}

impl AiRequestRegistry {
    fn prune_expired(&mut self, now: Instant) {
        self.pending_cancellations.retain(|_, recorded_at| {
            now.saturating_duration_since(*recorded_at) < REQUEST_STATE_TTL
        });
        self.recently_settled.retain(|_, recorded_at| {
            now.saturating_duration_since(*recorded_at) < REQUEST_STATE_TTL
        });
    }

    fn next_registration_token(&mut self) -> u64 {
        self.next_token = self.next_token.wrapping_add(1);
        if self.next_token == 0 {
            self.next_token = 1;
        }
        self.next_token
    }

    fn record_pending_cancellation(&mut self, request_id: String, now: Instant) {
        if self.pending_cancellations.contains_key(&request_id) {
            return;
        }
        insert_bounded(
            &mut self.pending_cancellations,
            request_id,
            now,
            MAX_PENDING_CANCELLATIONS,
        );
    }

    fn record_settled(&mut self, request_id: String, now: Instant) {
        self.pending_cancellations.remove(&request_id);
        insert_bounded(
            &mut self.recently_settled,
            request_id,
            now,
            MAX_RECENTLY_SETTLED_REQUESTS,
        );
    }
}

fn insert_bounded(
    entries: &mut HashMap<String, Instant>,
    request_id: String,
    now: Instant,
    capacity: usize,
) {
    if !entries.contains_key(&request_id) && entries.len() >= capacity {
        if let Some(oldest_id) = entries
            .iter()
            .min_by(|left, right| left.1.cmp(right.1))
            .map(|(id, _)| id.clone())
        {
            entries.remove(&oldest_id);
        }
    }
    entries.insert(request_id, now);
}

static AI_REQUEST_REGISTRY: Lazy<Mutex<AiRequestRegistry>> =
    Lazy::new(|| Mutex::new(AiRequestRegistry::default()));

fn lock_request_registry() -> MutexGuard<'static, AiRequestRegistry> {
    AI_REQUEST_REGISTRY
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

struct ActiveRequestRegistration {
    request_id: String,
    token: u64,
    cancellation_requested: Arc<AtomicBool>,
    finished: bool,
}

impl ActiveRequestRegistration {
    fn attach_abort(&self, abort: AbortCallback) -> Result<(), String> {
        let attach_result = {
            let mut registry = lock_request_registry();
            registry.prune_expired(Instant::now());
            match registry.active.get_mut(&self.request_id) {
                Some(active) if active.token == self.token => {
                    active.abort = Some(abort.clone());
                    Some(active.cancellation_requested.load(Ordering::Acquire))
                }
                _ => None,
            }
        };

        match attach_result {
            Some(true) => {
                abort();
                Ok(())
            }
            Some(false) => Ok(()),
            None => {
                abort();
                Err(AI_REQUEST_REGISTRY_LOST.to_string())
            }
        }
    }

    fn finish(&mut self) -> bool {
        let removed = remove_registration(&self.request_id, self.token);
        self.finished = true;
        removed
            .map(|active| active.cancellation_requested.load(Ordering::Acquire))
            .unwrap_or_else(|| self.cancellation_requested.load(Ordering::Acquire))
    }
}

impl Drop for ActiveRequestRegistration {
    fn drop(&mut self) {
        if self.finished {
            return;
        }

        self.cancellation_requested.store(true, Ordering::Release);
        let abort =
            remove_registration(&self.request_id, self.token).and_then(|active| active.abort);
        self.finished = true;
        if let Some(abort) = abort {
            abort();
        }
    }
}

fn remove_registration(request_id: &str, token: u64) -> Option<ActiveAiRequest> {
    let now = Instant::now();
    let mut registry = lock_request_registry();
    registry.prune_expired(now);
    let matches = registry
        .active
        .get(request_id)
        .map(|active| active.token == token)
        .unwrap_or(false);
    if !matches {
        return None;
    }

    let removed = registry.active.remove(request_id);
    registry.record_settled(request_id.to_string(), now);
    removed
}

fn reserve_request(request_id: String) -> Result<ActiveRequestRegistration, String> {
    let now = Instant::now();
    let cancellation_requested = Arc::new(AtomicBool::new(false));
    let token = {
        let mut registry = lock_request_registry();
        registry.prune_expired(now);

        if registry.pending_cancellations.remove(&request_id).is_some() {
            registry.record_settled(request_id, now);
            return Err(AI_REQUEST_CANCELLED.to_string());
        }
        if registry.active.contains_key(&request_id) {
            return Err(AI_REQUEST_ID_IN_USE.to_string());
        }
        if registry.recently_settled.contains_key(&request_id) {
            return Err(AI_REQUEST_ID_RECENTLY_SETTLED.to_string());
        }
        if registry.active.len() >= MAX_ACTIVE_AI_REQUESTS {
            return Err(AI_REQUEST_CAPACITY_EXCEEDED.to_string());
        }

        let token = registry.next_registration_token();
        registry.active.insert(
            request_id.clone(),
            ActiveAiRequest {
                token,
                cancellation_requested: cancellation_requested.clone(),
                abort: None,
            },
        );
        token
    };

    Ok(ActiveRequestRegistration {
        request_id,
        token,
        cancellation_requested,
        finished: false,
    })
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatCompletionRequest {
    pub base_url: String,
    pub api_key: String,
    pub model_name: String,
    pub messages: Vec<AiChatMessage>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<u32>,
    pub timeout_seconds: Option<u64>,
    pub request_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatCompletionResponse {
    pub text: String,
    pub raw: Value,
    pub token_input: Option<i64>,
    pub token_output: Option<i64>,
    pub total_tokens: Option<i64>,
}

fn build_chat_completions_url(base_url: &str) -> String {
    let clean = base_url.trim().trim_end_matches('/').to_string();
    if clean.ends_with("/chat/completions") {
        return clean;
    }
    if clean.ends_with("/v1") {
        return format!("{}/chat/completions", clean);
    }
    format!("{}/v1/chat/completions", clean)
}

fn validate_request(request: &AiChatCompletionRequest) -> Result<(), String> {
    if request.base_url.trim().is_empty() {
        return Err("当前为 API 模式，但 API Base URL 未配置，请先到设置中心配置。".into());
    }
    if request.api_key.trim().is_empty() {
        return Err("当前为 API 模式，但 API Key 未配置，请先到设置中心配置。".into());
    }
    if request.model_name.trim().is_empty() {
        return Err("当前为 API 模式，但模型名称未配置，请先到设置中心配置。".into());
    }
    let temperature = request.temperature.unwrap_or(0.7);
    if !(0.0..=2.0).contains(&temperature) {
        return Err("temperature 必须在 0 到 2 之间，请检查设置中心配置。".into());
    }
    let max_tokens = request.max_tokens.unwrap_or(8000);
    if max_tokens == 0 || max_tokens > 200_000 {
        return Err("max_tokens 配置不合法，请检查设置中心的最大输出 Token。".into());
    }
    let timeout_seconds = request.timeout_seconds.unwrap_or(120);
    if timeout_seconds == 0 || timeout_seconds > 1800 {
        return Err("timeoutSeconds 配置不合法，请检查设置中心的超时时间。".into());
    }
    if request.messages.is_empty() {
        return Err("AI 请求缺少 messages。".into());
    }
    Ok(())
}

fn validate_request_id(request_id: &str) -> Result<(), String> {
    if request_id.is_empty()
        || request_id.len() > MAX_REQUEST_ID_BYTES
        || !request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(AI_REQUEST_ID_INVALID.to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn cancel_ai_request(request_id: String) -> bool {
    if validate_request_id(&request_id).is_err() {
        return false;
    }

    let now = Instant::now();
    let abort = {
        let mut registry = lock_request_registry();
        registry.prune_expired(now);

        if let Some(active) = registry.active.get(&request_id) {
            if active.cancellation_requested.swap(true, Ordering::AcqRel) {
                return false;
            }
            active.abort.clone()
        } else {
            if !registry.recently_settled.contains_key(&request_id) {
                registry.record_pending_cancellation(request_id, now);
            }
            return false;
        }
    };

    if let Some(abort) = abort {
        abort();
    }
    true
}

fn ensure_ai_network_allowed(network_blocked: bool) -> Result<(), String> {
    if network_blocked {
        return Err("AI network requests are disabled in E2E mode".to_string());
    }

    Ok(())
}

fn user_error_from_status(status: reqwest::StatusCode, body: &str, model_name: &str) -> String {
    match status.as_u16() {
        400 => "AI 调用失败：请求参数不合法（400 Bad Request）。请检查模型名称、max_tokens 和提示词格式。".into(),
        401 => "AI 调用失败：API Key 无效或已过期（401 Unauthorized），请检查设置中心的 API Key。".into(),
        403 => {
            let lower = body.to_lowercase();
            if lower.contains("model") || lower.contains("permission") || lower.contains("access") {
                format!("AI 调用失败：当前 API Key 无权访问模型「{}」，请检查设置中心的模型名称或平台授权。", model_name)
            } else {
                "AI 调用失败：服务拒绝访问（403 Forbidden），请检查 API Key 权限。".into()
            }
        }
        429 => "AI 调用失败：请求过于频繁或额度不足（429 Rate Limit），请稍后重试或检查账户额度。".into(),
        500..=599 => {
            let lower = body.to_lowercase();
            if lower.contains("overloaded") || lower.contains("overload") {
                "AI 调用失败：模型服务当前过载（overloaded_error），请稍后重试。".into()
            } else {
                format!("AI 调用失败：模型服务错误（{}），请稍后重试。", status.as_u16())
            }
        }
        _ => format!("AI 调用失败：HTTP {}。", status.as_u16()),
    }
}

#[tauri::command]
pub async fn ai_chat_completion(
    request: AiChatCompletionRequest,
) -> Result<AiChatCompletionResponse, String> {
    execute_ai_chat_completion(request, crate::runtime::is_network_blocked()).await
}

async fn execute_ai_chat_completion(
    request: AiChatCompletionRequest,
    network_blocked: bool,
) -> Result<AiChatCompletionResponse, String> {
    ensure_ai_network_allowed(network_blocked)?;
    validate_request(&request)?;

    let request_id = request.request_id.clone();
    let Some(request_id) = request_id else {
        return perform_ai_chat_completion(request).await;
    };
    validate_request_id(&request_id)?;

    let mut registration = reserve_request(request_id)?;
    let task = tauri::async_runtime::spawn(perform_ai_chat_completion(request));
    let abort_handle = task.inner().abort_handle();
    let abort: AbortCallback = Arc::new(move || abort_handle.abort());
    registration.attach_abort(abort)?;

    let task_result = task.await;
    if registration.finish() {
        return Err(AI_REQUEST_CANCELLED.to_string());
    }

    match task_result {
        Ok(result) => result,
        Err(_) => Err(AI_REQUEST_RUNTIME_FAILED.to_string()),
    }
}

async fn perform_ai_chat_completion(
    request: AiChatCompletionRequest,
) -> Result<AiChatCompletionResponse, String> {
    let url = build_chat_completions_url(&request.base_url);
    let timeout_seconds = request.timeout_seconds.unwrap_or(120);
    let client_builder = Client::builder().timeout(Duration::from_secs(timeout_seconds));
    #[cfg(test)]
    let client_builder = client_builder.no_proxy();
    let client = client_builder
        .build()
        .map_err(|_| "AI 调用失败：HTTP 客户端初始化失败。".to_string())?;

    #[cfg(debug_assertions)]
    {
        let last_user_message = request
            .messages
            .iter()
            .rev()
            .find(|message| message.role == "user")
            .map(|message| message.content.as_str())
            .unwrap_or("");
        println!(
            "[ai_chat_completion] messages count={}",
            request.messages.len()
        );
        println!(
            "[ai_chat_completion] user message length={}",
            last_user_message.chars().count()
        );
        println!(
            "[ai_chat_completion] contains chapter outline marker={}",
            last_user_message.contains("【当前章节大纲】")
        );
        println!(
            "[ai_chat_completion] contains outline checklist marker={}",
            last_user_message.contains("【章节大纲执行清单】")
        );
        println!(
            "[ai_chat_completion] contains required characters marker={}",
            last_user_message.contains("【本章必须直接出场角色】")
        );
    }

    let body = json!({
        "model": request.model_name,
        "messages": request.messages,
        "temperature": request.temperature.unwrap_or(0.7),
        "max_tokens": request.max_tokens.unwrap_or(8000),
    });

    let response = client
        .post(url)
        .bearer_auth(request.api_key.trim())
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                format!(
                    "AI 调用失败：请求超时（{} 秒），请检查网络或增加超时时间。",
                    timeout_seconds
                )
            } else if e.is_connect() {
                "AI 调用失败：网络连接失败，请检查 API Base URL、网络连接或代理设置。".to_string()
            } else {
                "AI 调用失败：网络请求失败。".to_string()
            }
        })?;

    let status = response.status();
    let text_body = response
        .text()
        .await
        .map_err(|_| "AI 调用失败：读取响应失败。".to_string())?;

    if !status.is_success() {
        return Err(user_error_from_status(
            status,
            &text_body,
            &body["model"].as_str().unwrap_or(""),
        ));
    }

    let data: Value = serde_json::from_str(&text_body)
        .map_err(|_| "AI 调用失败：响应不是有效 JSON。".to_string())?;

    let content = data
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    if content.trim().is_empty() {
        return Err("AI 调用失败：模型返回空内容，请检查提示词、模型名称或重试。".into());
    }

    let usage = data.get("usage");
    Ok(AiChatCompletionResponse {
        text: content,
        token_input: usage
            .and_then(|u| u.get("prompt_tokens"))
            .and_then(Value::as_i64),
        token_output: usage
            .and_then(|u| u.get("completion_tokens"))
            .and_then(Value::as_i64),
        total_tokens: usage
            .and_then(|u| u.get("total_tokens"))
            .and_then(Value::as_i64),
        raw: data,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::mpsc::{self, Receiver};
    use std::thread;

    static TEST_SERIAL: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    struct HangingServer {
        base_url: String,
        accepted: Receiver<()>,
        connection_closed: Receiver<bool>,
        thread: thread::JoinHandle<()>,
    }

    fn reset_registry() {
        let active = {
            let mut registry = lock_request_registry();
            let active = std::mem::take(&mut registry.active);
            registry.pending_cancellations.clear();
            registry.recently_settled.clear();
            active
        };

        for (_, request) in active {
            request
                .cancellation_requested
                .store(true, Ordering::Release);
            if let Some(abort) = request.abort {
                abort();
            }
        }
    }

    fn registry_counts() -> (usize, usize, usize) {
        let mut registry = lock_request_registry();
        registry.prune_expired(Instant::now());
        (
            registry.active.len(),
            registry.pending_cancellations.len(),
            registry.recently_settled.len(),
        )
    }

    fn test_request(
        base_url: String,
        request_id: Option<&str>,
        timeout_seconds: u64,
    ) -> AiChatCompletionRequest {
        AiChatCompletionRequest {
            base_url,
            api_key: "test-api-key".to_string(),
            model_name: "test-model".to_string(),
            messages: vec![AiChatMessage {
                role: "user".to_string(),
                content: "local loopback test".to_string(),
            }],
            temperature: Some(0.2),
            max_tokens: Some(64),
            timeout_seconds: Some(timeout_seconds),
            request_id: request_id.map(str::to_string),
        }
    }

    fn accept_with_timeout(listener: &TcpListener, timeout: Duration) -> io::Result<TcpStream> {
        listener.set_nonblocking(true)?;
        let deadline = Instant::now() + timeout;
        loop {
            match listener.accept() {
                Ok((stream, _)) => {
                    stream.set_nonblocking(false)?;
                    return Ok(stream);
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    if Instant::now() >= deadline {
                        return Err(io::Error::new(
                            io::ErrorKind::TimedOut,
                            "loopback server accept timed out",
                        ));
                    }
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => return Err(error),
            }
        }
    }

    fn read_http_request(stream: &mut TcpStream) -> io::Result<()> {
        stream.set_read_timeout(Some(Duration::from_secs(3)))?;
        let mut request = Vec::new();
        let mut buffer = [0_u8; 2048];

        loop {
            if let Some(header_end) = request
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .map(|index| index + 4)
            {
                let headers = String::from_utf8_lossy(&request[..header_end]);
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        if name.eq_ignore_ascii_case("content-length") {
                            value.trim().parse::<usize>().ok()
                        } else {
                            None
                        }
                    })
                    .unwrap_or(0);
                if request.len() >= header_end + content_length {
                    return Ok(());
                }
            }

            let read = stream.read(&mut buffer)?;
            if read == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "client closed before sending the full request",
                ));
            }
            request.extend_from_slice(&buffer[..read]);
            if request.len() > 1_048_576 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "loopback request exceeded the test limit",
                ));
            }
        }
    }

    fn spawn_hanging_server() -> HangingServer {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback server");
        let address = listener.local_addr().expect("read loopback address");
        let (accepted_tx, accepted) = mpsc::sync_channel(1);
        let (closed_tx, connection_closed) = mpsc::sync_channel(1);
        let server_thread = thread::spawn(move || {
            let Ok(mut stream) = accept_with_timeout(&listener, Duration::from_secs(5)) else {
                return;
            };
            if read_http_request(&mut stream).is_err() {
                return;
            }
            let _ = accepted_tx.send(());
            let _ = stream.set_read_timeout(Some(Duration::from_secs(4)));
            let mut buffer = [0_u8; 256];
            let closed = loop {
                match stream.read(&mut buffer) {
                    Ok(0) => break true,
                    Ok(_) => continue,
                    Err(error)
                        if matches!(
                            error.kind(),
                            io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                        ) =>
                    {
                        break false;
                    }
                    Err(_) => break true,
                }
            };
            let _ = closed_tx.send(closed);
        });

        HangingServer {
            base_url: format!("http://{}", address),
            accepted,
            connection_closed,
            thread: server_thread,
        }
    }

    fn spawn_response_server(response_body: &'static str) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback server");
        let address = listener.local_addr().expect("read loopback address");
        let server_thread = thread::spawn(move || {
            let mut stream =
                accept_with_timeout(&listener, Duration::from_secs(5)).expect("accept request");
            read_http_request(&mut stream).expect("read request");
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write response");
            stream.flush().expect("flush response");
        });
        (format!("http://{}", address), server_thread)
    }

    fn assert_listener_has_no_connection(listener: &TcpListener) {
        listener.set_nonblocking(true).unwrap();
        match listener.accept() {
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
            Ok(_) => panic!("a network request was dispatched unexpectedly"),
            Err(error) => panic!("failed to inspect loopback listener: {error}"),
        }
    }

    #[test]
    fn e2e_mode_blocks_ai_network_requests_before_dispatch() {
        let _serial = TEST_SERIAL
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reset_registry();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());

        let error = tauri::async_runtime::block_on(execute_ai_chat_completion(
            test_request(base_url, Some("e2e-blocked"), 1),
            true,
        ))
        .unwrap_err();

        assert_eq!(error, "AI network requests are disabled in E2E mode");
        assert_listener_has_no_connection(&listener);
        assert_eq!(registry_counts(), (0, 0, 0));
    }

    #[test]
    fn active_request_is_cancelled_promptly_and_connection_is_closed() {
        let _serial = TEST_SERIAL
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reset_registry();
        let server = spawn_hanging_server();
        let request_id = "cancel-active";
        let task = tauri::async_runtime::spawn(execute_ai_chat_completion(
            test_request(server.base_url.clone(), Some(request_id), 10),
            false,
        ));
        server
            .accepted
            .recv_timeout(Duration::from_secs(3))
            .expect("server did not receive request");

        let cancelled_at = Instant::now();
        assert!(cancel_ai_request(request_id.to_string()));
        assert!(!cancel_ai_request(request_id.to_string()));
        let error = tauri::async_runtime::block_on(task)
            .expect("request task panicked")
            .unwrap_err();

        assert_eq!(error, AI_REQUEST_CANCELLED);
        assert!(cancelled_at.elapsed() < Duration::from_secs(2));
        assert!(server
            .connection_closed
            .recv_timeout(Duration::from_secs(3))
            .expect("server did not observe connection closure"));
        server.thread.join().unwrap();
        assert_eq!(registry_counts(), (0, 0, 1));
        assert!(!cancel_ai_request(request_id.to_string()));
        assert_eq!(registry_counts(), (0, 0, 1));
    }

    #[test]
    fn duplicate_active_request_id_is_rejected_without_second_dispatch() {
        let _serial = TEST_SERIAL
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reset_registry();
        let server = spawn_hanging_server();
        let request_id = "duplicate-active";
        let first = tauri::async_runtime::spawn(execute_ai_chat_completion(
            test_request(server.base_url.clone(), Some(request_id), 10),
            false,
        ));
        server
            .accepted
            .recv_timeout(Duration::from_secs(3))
            .expect("server did not receive first request");

        let duplicate_error = tauri::async_runtime::block_on(execute_ai_chat_completion(
            test_request(server.base_url.clone(), Some(request_id), 10),
            false,
        ))
        .unwrap_err();
        assert_eq!(duplicate_error, AI_REQUEST_ID_IN_USE);

        assert!(cancel_ai_request(request_id.to_string()));
        assert_eq!(
            tauri::async_runtime::block_on(first)
                .expect("request task panicked")
                .unwrap_err(),
            AI_REQUEST_CANCELLED
        );
        assert!(server
            .connection_closed
            .recv_timeout(Duration::from_secs(3))
            .unwrap());
        server.thread.join().unwrap();
        assert_eq!(registry_counts(), (0, 0, 1));
    }

    #[test]
    fn cancellation_before_registration_prevents_network_dispatch() {
        let _serial = TEST_SERIAL
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reset_registry();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let request_id = "cancel-before-register";

        assert!(!cancel_ai_request(request_id.to_string()));
        assert_eq!(registry_counts(), (0, 1, 0));
        let error = tauri::async_runtime::block_on(execute_ai_chat_completion(
            test_request(base_url, Some(request_id), 1),
            false,
        ))
        .unwrap_err();

        assert_eq!(error, AI_REQUEST_CANCELLED);
        assert_listener_has_no_connection(&listener);
        assert_eq!(registry_counts(), (0, 0, 1));
        assert!(!cancel_ai_request(request_id.to_string()));
        assert_eq!(registry_counts(), (0, 0, 1));
    }

    #[test]
    fn normal_response_is_returned_and_registry_is_cleaned() {
        let _serial = TEST_SERIAL
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reset_registry();
        let response_body = r#"{"choices":[{"message":{"content":"loopback ok"}}],"usage":{"prompt_tokens":7,"completion_tokens":5,"total_tokens":12}}"#;
        let (base_url, server_thread) = spawn_response_server(response_body);
        let request_id = "normal-response";

        let response = tauri::async_runtime::block_on(execute_ai_chat_completion(
            test_request(base_url, Some(request_id), 3),
            false,
        ))
        .unwrap();

        server_thread.join().unwrap();
        assert_eq!(response.text, "loopback ok");
        assert_eq!(response.token_input, Some(7));
        assert_eq!(response.token_output, Some(5));
        assert_eq!(response.total_tokens, Some(12));
        assert_eq!(registry_counts(), (0, 0, 1));
        assert!(!cancel_ai_request(request_id.to_string()));
        assert_eq!(registry_counts(), (0, 0, 1));
    }

    #[test]
    fn malformed_success_response_does_not_expose_provider_body() {
        let _serial = TEST_SERIAL
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reset_registry();
        let response_body = "Bearer secret-token full sensitive prompt";
        let (base_url, server_thread) = spawn_response_server(response_body);
        let request_id = "malformed-response";

        let error = tauri::async_runtime::block_on(execute_ai_chat_completion(
            test_request(base_url, Some(request_id), 3),
            false,
        ))
        .unwrap_err();

        server_thread.join().unwrap();
        assert_eq!(error, "AI 调用失败：响应不是有效 JSON。");
        assert!(!error.contains(response_body));
        assert!(!error.contains("secret-token"));
        assert_eq!(registry_counts(), (0, 0, 1));
    }

    #[test]
    fn timeout_remains_distinct_from_cancellation_and_cleans_registry() {
        let _serial = TEST_SERIAL
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reset_registry();
        let server = spawn_hanging_server();
        let request_id = "request-timeout";
        let task = tauri::async_runtime::spawn(execute_ai_chat_completion(
            test_request(server.base_url.clone(), Some(request_id), 1),
            false,
        ));
        server
            .accepted
            .recv_timeout(Duration::from_secs(3))
            .expect("server did not receive request");

        let error = tauri::async_runtime::block_on(task)
            .expect("request task panicked")
            .unwrap_err();

        assert!(error.contains("请求超时"));
        assert_ne!(error, AI_REQUEST_CANCELLED);
        assert!(server
            .connection_closed
            .recv_timeout(Duration::from_secs(3))
            .expect("server did not observe timeout closure"));
        server.thread.join().unwrap();
        assert_eq!(registry_counts(), (0, 0, 1));
        assert!(!cancel_ai_request(request_id.to_string()));
    }

    #[test]
    fn dropped_command_future_aborts_http_and_cleans_registry() {
        let _serial = TEST_SERIAL
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reset_registry();
        let server = spawn_hanging_server();
        let request_id = "drop-command-future";
        let task = tauri::async_runtime::spawn(execute_ai_chat_completion(
            test_request(server.base_url.clone(), Some(request_id), 10),
            false,
        ));
        server
            .accepted
            .recv_timeout(Duration::from_secs(3))
            .expect("server did not receive request");

        task.abort();
        assert!(tauri::async_runtime::block_on(task).is_err());
        assert!(server
            .connection_closed
            .recv_timeout(Duration::from_secs(3))
            .expect("server did not observe dropped future closure"));
        server.thread.join().unwrap();
        assert_eq!(registry_counts(), (0, 0, 1));
        assert!(!cancel_ai_request(request_id.to_string()));
    }

    #[test]
    fn pending_cancellation_registry_is_bounded() {
        let _serial = TEST_SERIAL
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reset_registry();

        for index in 0..(MAX_PENDING_CANCELLATIONS + 32) {
            assert!(!cancel_ai_request(format!("bounded-{index}")));
        }

        assert_eq!(registry_counts(), (0, MAX_PENDING_CANCELLATIONS, 0));
    }

    #[test]
    fn recently_settled_registry_is_bounded() {
        let _serial = TEST_SERIAL
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reset_registry();

        {
            let now = Instant::now();
            let mut registry = lock_request_registry();
            for index in 0..(MAX_RECENTLY_SETTLED_REQUESTS + 32) {
                registry.record_settled(format!("settled-{index}"), now);
            }
        }

        assert_eq!(registry_counts(), (0, 0, MAX_RECENTLY_SETTLED_REQUESTS));
    }
}
