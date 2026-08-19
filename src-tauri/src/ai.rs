use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

#[cfg(debug_assertions)]
use crate::errors::{log_workspace_event, WorkspaceLogEvent};
use crate::services::ai_request_policy_service::{self, AiRequestPolicyLeaseProof};

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
const MAX_SSE_FRAME_BYTES: usize = 2_000_000;
const AI_STREAM_EVENT_NAME: &str = "ai-stream-event";
const AI_STREAM_INVALID: &str = "AI 调用失败：模型服务返回了无效的流式响应，请检查兼容接口或重试。";
const AI_STREAM_INTERRUPTED: &str =
    "AI 调用失败：流式响应在完成标记前中断，当前残片未保存；请重试。";
const OUTPUT_TOKEN_TRUNCATION_ERROR: &str =
    "AI 调用失败：模型在输出 Token 上限处停止，响应内容不完整且未采纳；请缩小单次输出或提高最大输出 Token 后重试。";

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
    pub require_loopback: Option<bool>,
    pub api_key: String,
    pub model_name: String,
    pub messages: Vec<AiChatMessage>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<u32>,
    pub top_p: Option<f64>,
    pub top_k: Option<u32>,
    pub repeat_penalty: Option<f64>,
    pub seed: Option<i64>,
    pub thinking_mode: Option<String>,
    pub allow_truncated_output: Option<bool>,
    pub timeout_seconds: Option<u64>,
    pub request_id: Option<String>,
    pub policy_lease: Option<AiRequestPolicyLeaseProof>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatCompletionResponse {
    pub text: String,
    pub raw: Value,
    pub token_input: Option<i64>,
    pub token_output: Option<i64>,
    pub total_tokens: Option<i64>,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiChatStreamEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub request_id: String,
    pub sequence: Option<u64>,
    pub text: Option<String>,
    pub token_input: Option<i64>,
    pub token_output: Option<i64>,
    pub token_total: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalChapterModelHealthRequest {
    pub base_url: String,
    pub api_key: String,
    pub model_name: String,
    pub timeout_seconds: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalChapterModelHealthResponse {
    pub health_ok: bool,
    pub model_ok: bool,
    pub smoke_ok: bool,
    pub model_name: String,
    pub finish_reason: Option<String>,
    pub text_preview: Option<String>,
    pub message: String,
}

type StreamEmitter = Arc<dyn Fn(AiChatStreamEvent) -> Result<(), String> + Send + Sync + 'static>;

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

fn is_loopback_url(base_url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(base_url.trim()) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_matches(['[', ']']);
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false)
}

fn http_client_builder(base_url: &str, timeout: Duration) -> reqwest::ClientBuilder {
    let builder = Client::builder().timeout(timeout);
    if is_loopback_url(base_url) {
        builder.no_proxy()
    } else {
        builder
    }
}

fn model_catalog_matches(body: &Value, model_name: &str) -> bool {
    ["data", "models"].iter().any(|key| {
        body.get(*key)
            .and_then(Value::as_array)
            .map(|items| {
                items.iter().any(|item| {
                    ["id", "model", "name"].iter().any(|field| {
                        item.get(*field)
                            .and_then(Value::as_str)
                            .map(|value| value == model_name)
                            .unwrap_or(false)
                    })
                })
            })
            .unwrap_or(false)
    })
}

fn validate_request(request: &AiChatCompletionRequest) -> Result<(), String> {
    if request.base_url.trim().is_empty() {
        return Err("当前为 API 模式，但 API Base URL 未配置，请先到设置中心配置。".into());
    }
    if request.api_key.trim().is_empty() {
        return Err("当前为 API 模式，但 API Key 未配置，请先到设置中心配置。".into());
    }
    if request.require_loopback.unwrap_or(false) && !is_loopback_url(&request.base_url) {
        return Err(
            "本地章节模型 Base URL 只允许 localhost、127.0.0.0/8 或 [::1] 回环地址。".into(),
        );
    }
    if request.model_name.trim().is_empty() {
        return Err("当前为 API 模式，但模型名称未配置，请先到设置中心配置。".into());
    }
    let temperature = request.temperature.unwrap_or(0.7);
    if !(0.0..=2.0).contains(&temperature) {
        return Err("temperature 必须在 0 到 2 之间，请检查设置中心配置。".into());
    }
    if let Some(top_p) = request.top_p {
        if !top_p.is_finite() || !(0.0..=1.0).contains(&top_p) {
            return Err("top_p 必须在 0 到 1 之间，请检查设置中心配置。".into());
        }
    }
    if let Some(top_k) = request.top_k {
        if top_k > 4096 {
            return Err("top_k 必须在 0 到 4096 之间，请检查设置中心配置。".into());
        }
    }
    if let Some(repeat_penalty) = request.repeat_penalty {
        if !repeat_penalty.is_finite() || repeat_penalty <= 0.0 || repeat_penalty > 3.0 {
            return Err("repeat_penalty 必须大于 0 且不超过 3，请检查设置中心配置。".into());
        }
    }
    if let Some(thinking_mode) = request.thinking_mode.as_deref() {
        if !matches!(thinking_mode, "enabled" | "disabled") {
            return Err("thinkingMode 只允许 enabled 或 disabled。".into());
        }
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

fn add_optional_sampling_parameters(body: &mut Value, request: &AiChatCompletionRequest) {
    let Some(object) = body.as_object_mut() else {
        return;
    };
    if let Some(top_p) = request.top_p {
        object.insert("top_p".to_string(), json!(top_p));
    }
    if let Some(top_k) = request.top_k {
        object.insert("top_k".to_string(), json!(top_k));
    }
    if let Some(repeat_penalty) = request.repeat_penalty {
        object.insert("repeat_penalty".to_string(), json!(repeat_penalty));
    }
    if let Some(seed) = request.seed {
        object.insert("seed".to_string(), json!(seed));
    }
    if let Some(thinking_mode) = request.thinking_mode.as_deref() {
        object.insert("thinking".to_string(), json!({ "type": thinking_mode }));
    }
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

fn verify_request_policy_lease(request: &AiChatCompletionRequest) -> Result<(), String> {
    let request_id = request
        .request_id
        .as_deref()
        .ok_or_else(|| crate::errors::codes::AI_REQUEST_POLICY_LEASE_REQUIRED.to_string())?;
    let proof = request
        .policy_lease
        .as_ref()
        .ok_or_else(|| crate::errors::codes::AI_REQUEST_POLICY_LEASE_REQUIRED.to_string())?;
    if proof.provider_request_id != request_id {
        return Err(crate::errors::codes::AI_REQUEST_POLICY_LEASE_CONFLICT.to_string());
    }
    let mut connection = crate::db::get_connection()
        .lock()
        .map_err(|_| crate::errors::codes::DATABASE_TRANSACTION_FAILED.to_string())?;
    ai_request_policy_service::verify_provider_dispatch(&mut connection, proof)
        .map_err(|error| error.code)
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
    verify_request_policy_lease(&request)?;
    execute_ai_chat_completion(request, crate::runtime::is_network_blocked()).await
}

#[tauri::command]
pub async fn ai_chat_completion_stream(
    window: tauri::Window,
    request: AiChatCompletionRequest,
) -> Result<AiChatCompletionResponse, String> {
    verify_request_policy_lease(&request)?;
    let emitter: StreamEmitter = Arc::new(move |event| {
        window
            .emit(AI_STREAM_EVENT_NAME, event)
            .map_err(|_| "AI_STREAM_EVENT_EMIT_FAILED".to_string())
    });
    execute_ai_chat_completion_stream(request, crate::runtime::is_network_blocked(), emitter).await
}

fn local_model_root_url(base_url: &str) -> String {
    let clean = base_url.trim().trim_end_matches('/');
    clean.strip_suffix("/v1").unwrap_or(clean).to_string()
}

fn local_model_smoke_prompt() -> &'static str {
    "根据上下文、当前 Beat 目标和限制，续写这一个 Beat 的小说正文。严格保持人物身份、动作主体、因果顺序和既有设定；只完成输入中的一个 Beat，不提前写后续 Beat。只输出连贯小说正文，不要解释、总结、列提纲、输出 JSON 或思考过程。\n\nContext：\n夜雨中的旧车站，沈岚等待一列不该出现的列车。\n\nGoal：\n完成当前 Beat 并确认异常列车已经进站。\n\nBeat：\n听见本不该出现的列车进站。\n\nConstraints：\n- 只输出当前一个 Beat 的连续正文。"
}

async fn check_local_chapter_model_availability_internal(
    request: &LocalChapterModelHealthRequest,
) -> Result<LocalChapterModelHealthResponse, String> {
    ensure_ai_network_allowed(crate::runtime::is_network_blocked())?;
    if request.base_url.trim().is_empty() || request.model_name.trim().is_empty() {
        return Err("本地模型检查缺少 Base URL 或模型名称。".into());
    }
    if !is_loopback_url(&request.base_url) {
        return Err(
            "本地章节模型 Base URL 只允许 localhost、127.0.0.0/8 或 [::1] 回环地址。".into(),
        );
    }
    let timeout_seconds = request.timeout_seconds.unwrap_or(15);
    if timeout_seconds == 0 || timeout_seconds > 1800 {
        return Err("本地模型检查超时时间不合法。".into());
    }
    let client = http_client_builder(&request.base_url, Duration::from_secs(timeout_seconds))
        .build()
        .map_err(|_| "本地模型检查无法初始化 HTTP 客户端。".to_string())?;
    let root_url = local_model_root_url(&request.base_url);
    let auth_key = request.api_key.trim();
    let health_url = format!("{}/health", root_url.trim_end_matches('/'));
    let health = client
        .get(health_url)
        .bearer_auth(auth_key)
        .send()
        .await
        .map_err(|_| "本地模型健康检查连接失败，请确认 llama-server 已启动。".to_string())?;
    if !health.status().is_success() {
        return Err(format!(
            "本地模型 /health 返回 HTTP {}。",
            health.status().as_u16()
        ));
    }

    let models_url = format!("{}/v1/models", root_url.trim_end_matches('/'));
    let models_response = client
        .get(models_url)
        .bearer_auth(auth_key)
        .send()
        .await
        .map_err(|_| "本地模型 /v1/models 连接失败。".to_string())?;
    if !models_response.status().is_success() {
        return Err(format!(
            "本地模型 /v1/models 返回 HTTP {}。",
            models_response.status().as_u16()
        ));
    }
    let models_body: Value = models_response
        .json()
        .await
        .map_err(|_| "本地模型 /v1/models 返回了无效 JSON。".to_string())?;
    let model_name = request.model_name.trim().to_string();
    let model_ok = model_catalog_matches(&models_body, &model_name);
    Ok(LocalChapterModelHealthResponse {
        health_ok: true,
        model_ok,
        smoke_ok: false,
        model_name,
        finish_reason: None,
        text_preview: None,
        message: if model_ok {
            "本地模型服务健康且模型身份匹配。".into()
        } else {
            "服务健康，但 /v1/models 中没有匹配的模型名称。".into()
        },
    })
}

#[tauri::command]
pub async fn check_local_chapter_model_availability(
    request: LocalChapterModelHealthRequest,
) -> Result<LocalChapterModelHealthResponse, String> {
    check_local_chapter_model_availability_internal(&request).await
}

#[tauri::command]
pub async fn check_local_chapter_model(
    request: LocalChapterModelHealthRequest,
) -> Result<LocalChapterModelHealthResponse, String> {
    let availability = check_local_chapter_model_availability_internal(&request).await?;
    if !availability.model_ok {
        return Ok(availability);
    }
    let timeout_seconds = request.timeout_seconds.unwrap_or(15);
    let client = http_client_builder(&request.base_url, Duration::from_secs(timeout_seconds))
        .build()
        .map_err(|_| "本地模型检查无法初始化 HTTP 客户端。".to_string())?;
    let auth_key = request.api_key.trim();
    let model_name = availability.model_name;

    let completion_url = build_chat_completions_url(&request.base_url);
    let smoke = client
        .post(completion_url)
        .bearer_auth(auth_key)
        .header("Content-Type", "application/json")
        .json(&json!({
            "model": model_name,
            "messages": [{ "role": "user", "content": local_model_smoke_prompt() }],
            "temperature": 0.2,
            "max_tokens": 96,
            "top_p": 0.8,
            "top_k": 20,
            "repeat_penalty": 1.08,
            "stream": false,
        }))
        .send()
        .await
        .map_err(|_| "本地模型 Beat smoke 连接失败。".to_string())?;
    if !smoke.status().is_success() {
        return Err(format!(
            "本地模型 Beat smoke 返回 HTTP {}。",
            smoke.status().as_u16()
        ));
    }
    let smoke_body: Value = smoke
        .json()
        .await
        .map_err(|_| "本地模型 Beat smoke 返回了无效 JSON。".to_string())?;
    let text = smoke_body
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let finish_reason = smoke_body
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("finish_reason"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let smoke_ok = !text.is_empty() && !text.contains("<think>");
    Ok(LocalChapterModelHealthResponse {
        health_ok: true,
        model_ok: true,
        smoke_ok,
        model_name,
        finish_reason,
        text_preview: if text.is_empty() {
            None
        } else {
            Some(text.chars().take(240).collect())
        },
        message: if smoke_ok {
            "本地模型健康、模型匹配，Beat smoke 通过。".into()
        } else {
            "服务和模型匹配，但 Beat smoke 未返回可采纳正文。".into()
        },
    })
}

async fn execute_ai_chat_completion_stream(
    request: AiChatCompletionRequest,
    network_blocked: bool,
    emitter: StreamEmitter,
) -> Result<AiChatCompletionResponse, String> {
    ensure_ai_network_allowed(network_blocked)?;
    validate_request(&request)?;
    let request_id = request
        .request_id
        .clone()
        .ok_or_else(|| AI_REQUEST_ID_INVALID.to_string())?;
    validate_request_id(&request_id)?;

    let mut registration = reserve_request(request_id.clone())?;
    let task = tauri::async_runtime::spawn(perform_ai_chat_completion_stream(
        request, request_id, emitter,
    ));
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

#[derive(Default)]
struct OpenAiSseDecoder {
    buffer: Vec<u8>,
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn find_sse_boundary(value: &[u8]) -> Option<(usize, usize)> {
    [
        (b"\r\n\r\n".as_slice(), 4),
        (b"\n\n".as_slice(), 2),
        (b"\r\r".as_slice(), 2),
    ]
    .iter()
    .filter_map(|(needle, length)| find_bytes(value, needle).map(|index| (index, *length)))
    .min_by_key(|(index, _)| *index)
}

fn decode_sse_frame(frame: &[u8]) -> Result<Option<String>, String> {
    let frame = std::str::from_utf8(frame).map_err(|_| AI_STREAM_INVALID.to_string())?;
    let values: Vec<&str> = frame
        .split(|character| character == '\n' || character == '\r')
        .filter_map(|line| {
            let value = line.strip_prefix("data:")?;
            Some(value.strip_prefix(' ').unwrap_or(value))
        })
        .collect();
    if values.is_empty() {
        Ok(None)
    } else {
        Ok(Some(values.join("\n")))
    }
}

impl OpenAiSseDecoder {
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, String> {
        self.buffer.extend_from_slice(chunk);
        self.take_frames(false)
    }

    fn finish(&mut self) -> Result<Vec<String>, String> {
        self.take_frames(true)
    }

    fn take_frames(&mut self, flush: bool) -> Result<Vec<String>, String> {
        if self.buffer.len() > MAX_SSE_FRAME_BYTES {
            return Err(AI_STREAM_INVALID.to_string());
        }
        let mut payloads = Vec::new();
        while let Some((index, boundary_length)) = find_sse_boundary(&self.buffer) {
            let frame = self.buffer[..index].to_vec();
            self.buffer.drain(..index + boundary_length);
            if let Some(payload) = decode_sse_frame(&frame)? {
                payloads.push(payload);
            }
        }
        if flush && !self.buffer.iter().all(u8::is_ascii_whitespace) {
            let frame = std::mem::take(&mut self.buffer);
            if let Some(payload) = decode_sse_frame(&frame)? {
                payloads.push(payload);
            }
        }
        Ok(payloads)
    }
}

#[derive(Default)]
struct StreamAggregate {
    text: String,
    sequence: u64,
    saw_done: bool,
    finish_reason: Option<String>,
    token_input: Option<i64>,
    token_output: Option<i64>,
    token_total: Option<i64>,
}

fn consume_stream_payload(
    payload: String,
    request_id: &str,
    emitter: &StreamEmitter,
    aggregate: &mut StreamAggregate,
    allow_truncated_output: bool,
) -> Result<(), String> {
    if payload.trim() == "[DONE]" {
        aggregate.saw_done = true;
        return Ok(());
    }
    let data: Value = serde_json::from_str(&payload).map_err(|_| AI_STREAM_INVALID.to_string())?;
    if !data.is_object() || data.get("error").is_some() {
        return Err(AI_STREAM_INVALID.to_string());
    }

    if let Some(choice) = data.get("choices").and_then(|choices| choices.get(0)) {
        if let Some(content) = choice.get("delta").and_then(|delta| delta.get("content")) {
            if !content.is_null() {
                let content = content
                    .as_str()
                    .ok_or_else(|| AI_STREAM_INVALID.to_string())?;
                if !content.is_empty() {
                    aggregate.text.push_str(content);
                    aggregate.sequence += 1;
                    emitter(AiChatStreamEvent {
                        event_type: "delta".to_string(),
                        request_id: request_id.to_string(),
                        sequence: Some(aggregate.sequence),
                        text: Some(content.to_string()),
                        token_input: None,
                        token_output: None,
                        token_total: None,
                    })?;
                }
            }
        }
        if let Some(finish_reason) = choice.get("finish_reason") {
            if !finish_reason.is_null() {
                let finish_reason = finish_reason
                    .as_str()
                    .ok_or_else(|| AI_STREAM_INVALID.to_string())?
                    .to_string();
                if finish_reason == "length" && !allow_truncated_output {
                    return Err(OUTPUT_TOKEN_TRUNCATION_ERROR.to_string());
                }
                aggregate.finish_reason = Some(finish_reason);
            }
        }
    }

    if let Some(usage) = data.get("usage") {
        aggregate.token_input = usage.get("prompt_tokens").and_then(Value::as_i64);
        aggregate.token_output = usage.get("completion_tokens").and_then(Value::as_i64);
        aggregate.token_total = usage.get("total_tokens").and_then(Value::as_i64);
        emitter(AiChatStreamEvent {
            event_type: "usage".to_string(),
            request_id: request_id.to_string(),
            sequence: None,
            text: None,
            token_input: aggregate.token_input,
            token_output: aggregate.token_output,
            token_total: aggregate.token_total,
        })?;
    }
    Ok(())
}

async fn perform_ai_chat_completion_stream(
    request: AiChatCompletionRequest,
    request_id: String,
    emitter: StreamEmitter,
) -> Result<AiChatCompletionResponse, String> {
    let url = build_chat_completions_url(&request.base_url);
    let timeout_seconds = request.timeout_seconds.unwrap_or(120);
    let allow_truncated_output = request.allow_truncated_output.unwrap_or(false);
    let client_builder =
        http_client_builder(&request.base_url, Duration::from_secs(timeout_seconds));
    let client = client_builder
        .build()
        .map_err(|_| "AI 调用失败：HTTP 客户端初始化失败。".to_string())?;
    let mut body = json!({
        "model": request.model_name,
        "messages": request.messages,
        "temperature": request.temperature.unwrap_or(0.7),
        "max_tokens": request.max_tokens.unwrap_or(8000),
        "stream": true,
    });
    add_optional_sampling_parameters(&mut body, &request);
    let mut response = client
        .post(url)
        .bearer_auth(request.api_key.trim())
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                format!(
                    "AI 调用失败：请求超时（{} 秒），请检查网络或增加超时时间。",
                    timeout_seconds
                )
            } else if error.is_connect() {
                "AI 调用失败：网络连接失败，请检查 API Base URL、网络连接或代理设置。".to_string()
            } else {
                "AI 调用失败：网络请求失败。".to_string()
            }
        })?;
    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().await.unwrap_or_default();
        return Err(user_error_from_status(
            status,
            &error_body,
            body["model"].as_str().unwrap_or(""),
        ));
    }

    let mut decoder = OpenAiSseDecoder::default();
    let mut aggregate = StreamAggregate::default();
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        if error.is_timeout() {
            format!(
                "AI 调用失败：请求超时（{} 秒），请检查网络或增加超时时间。",
                timeout_seconds
            )
        } else {
            AI_STREAM_INTERRUPTED.to_string()
        }
    })? {
        for payload in decoder.push(&chunk)? {
            consume_stream_payload(
                payload,
                &request_id,
                &emitter,
                &mut aggregate,
                allow_truncated_output,
            )?;
        }
    }
    for payload in decoder.finish()? {
        consume_stream_payload(
            payload,
            &request_id,
            &emitter,
            &mut aggregate,
            allow_truncated_output,
        )?;
    }
    if !aggregate.saw_done && aggregate.finish_reason.is_none() {
        return Err(AI_STREAM_INTERRUPTED.to_string());
    }
    if aggregate.text.trim().is_empty() {
        return Err("AI 调用失败：模型返回空内容，请检查提示词、模型名称或重试。".into());
    }

    Ok(AiChatCompletionResponse {
        text: aggregate.text,
        raw: json!({
            "streamed": true,
            "requestId": request_id,
            "finishReason": aggregate.finish_reason.clone(),
        }),
        token_input: aggregate.token_input,
        token_output: aggregate.token_output,
        total_tokens: aggregate.token_total,
        finish_reason: aggregate.finish_reason,
    })
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
    let allow_truncated_output = request.allow_truncated_output.unwrap_or(false);
    let client_builder =
        http_client_builder(&request.base_url, Duration::from_secs(timeout_seconds));
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
        log_workspace_event(WorkspaceLogEvent {
            level: "debug",
            event: "ai_provider_request_shape",
            trace_id: None,
            operation_id: None,
            novel_id: None,
            chapter_id: None,
            draft_id: None,
            error_code: None,
            metadata: Some(serde_json::json!({
                "messageCount": request.messages.len(),
                "userMessageLength": last_user_message.chars().count(),
                "hasChapterOutline": last_user_message.contains("【当前章节大纲】"),
                "hasOutlineChecklist": last_user_message.contains("【章节大纲执行清单】"),
                "hasRequiredCharacters": last_user_message.contains("【本章必须直接出场角色】"),
            })),
        });
    }

    let mut body = json!({
        "model": request.model_name,
        "messages": request.messages,
        "temperature": request.temperature.unwrap_or(0.7),
        "max_tokens": request.max_tokens.unwrap_or(8000),
    });
    add_optional_sampling_parameters(&mut body, &request);

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
    let text_body = response.text().await.map_err(|error| {
        if error.is_timeout() {
            format!(
                "AI 调用失败：请求超时（{} 秒），请检查网络或增加超时时间。",
                timeout_seconds
            )
        } else {
            "AI 调用失败：上游服务在响应完成前中断连接，请重试；长响应建议缩小单次输出。"
                .to_string()
        }
    })?;

    if !status.is_success() {
        return Err(user_error_from_status(
            status,
            &text_body,
            &body["model"].as_str().unwrap_or(""),
        ));
    }

    let data: Value = serde_json::from_str(&text_body)
        .map_err(|_| "AI 调用失败：响应不是有效 JSON。".to_string())?;

    let first_choice = data.get("choices").and_then(|choices| choices.get(0));
    let content = first_choice
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let finish_reason = first_choice
        .and_then(|choice| choice.get("finish_reason"))
        .and_then(Value::as_str)
        .map(str::to_string);

    if finish_reason.as_deref() == Some("length") && !allow_truncated_output {
        return Err(OUTPUT_TOKEN_TRUNCATION_ERROR.into());
    }

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
        finish_reason,
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
            require_loopback: None,
            api_key: "test-api-key".to_string(),
            model_name: "test-model".to_string(),
            messages: vec![AiChatMessage {
                role: "user".to_string(),
                content: "local loopback test".to_string(),
            }],
            temperature: Some(0.2),
            max_tokens: Some(64),
            top_p: None,
            top_k: None,
            repeat_penalty: None,
            seed: None,
            thinking_mode: None,
            allow_truncated_output: None,
            timeout_seconds: Some(timeout_seconds),
            request_id: request_id.map(str::to_string),
            policy_lease: None,
        }
    }

    #[test]
    fn provider_command_rejects_missing_global_policy_lease_before_dispatch() {
        let request = test_request(
            "https://provider.invalid/v1".to_string(),
            Some("policy-proof-required"),
            1,
        );
        assert_eq!(
            verify_request_policy_lease(&request),
            Err(crate::errors::codes::AI_REQUEST_POLICY_LEASE_REQUIRED.to_string())
        );
    }

    #[test]
    fn sampling_options_are_forwarded_without_null_fields() {
        let mut request = test_request("http://127.0.0.1:8080/v1".to_string(), None, 1);
        request.top_p = Some(0.8);
        request.top_k = Some(20);
        request.repeat_penalty = Some(1.08);
        request.seed = Some(7);
        request.thinking_mode = Some("disabled".to_string());
        let mut body = json!({
            "model": request.model_name,
            "messages": request.messages,
        });
        add_optional_sampling_parameters(&mut body, &request);
        assert_eq!(body["top_p"], json!(0.8));
        assert_eq!(body["top_k"], json!(20));
        assert_eq!(body["repeat_penalty"], json!(1.08));
        assert_eq!(body["seed"], json!(7));
        assert_eq!(body["thinking"], json!({ "type": "disabled" }));
        assert!(body.get("temperature").is_none());
    }

    #[test]
    fn local_only_request_rejects_remote_base_url_before_dispatch() {
        let mut request = test_request("https://provider.example/v1".to_string(), None, 1);
        request.require_loopback = Some(true);

        assert!(validate_request(&request)
            .unwrap_err()
            .contains("只允许 localhost、127.0.0.0/8 或 [::1]"));
    }

    #[test]
    fn local_model_health_accepts_loopback_and_llama_model_catalog_shapes() {
        assert!(is_loopback_url("http://127.0.0.1:8080/v1"));
        assert!(is_loopback_url("http://localhost:8080/v1"));
        assert!(is_loopback_url("http://[::1]:8080/v1"));
        assert!(!is_loopback_url("https://api.example.com/v1"));
        assert!(!is_loopback_url("ftp://127.0.0.1:8080/v1"));

        assert!(model_catalog_matches(
            &json!({ "data": [{ "id": "openai-model" }] }),
            "openai-model"
        ));
        assert!(model_catalog_matches(
            &json!({ "models": [{ "name": "qwen35-9b-novel-v3", "model": "qwen35-9b-novel-v3" }] }),
            "qwen35-9b-novel-v3"
        ));
        assert!(!model_catalog_matches(
            &json!({ "models": [{ "name": "other-model" }] }),
            "qwen35-9b-novel-v3"
        ));
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

    fn spawn_partial_response_server() -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback server");
        let address = listener.local_addr().expect("read loopback address");
        let server_thread = thread::spawn(move || {
            let mut stream =
                accept_with_timeout(&listener, Duration::from_secs(5)).expect("accept request");
            read_http_request(&mut stream).expect("read request");
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 4096\r\nConnection: close\r\n\r\n{",
                )
                .expect("write partial response");
            stream.flush().expect("flush partial response");
            thread::sleep(Duration::from_secs(2));
        });
        (format!("http://{}", address), server_thread)
    }

    fn spawn_truncated_response_server() -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback server");
        let address = listener.local_addr().expect("read loopback address");
        let server_thread = thread::spawn(move || {
            let mut stream =
                accept_with_timeout(&listener, Duration::from_secs(5)).expect("accept request");
            read_http_request(&mut stream).expect("read request");
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 4096\r\nConnection: close\r\n\r\n{",
                )
                .expect("write truncated response");
            stream.flush().expect("flush truncated response");
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
    fn local_scene_request_preserves_truncated_text_for_orchestrator_continuation() {
        let response_body = r#"{"choices":[{"message":{"content":"partial scene"},"finish_reason":"length"}],"usage":{"completion_tokens":64}}"#;
        let (base_url, server_thread) = spawn_response_server(response_body);
        let mut request = test_request(base_url, None, 3);
        request.allow_truncated_output = Some(true);

        let response = tauri::async_runtime::block_on(perform_ai_chat_completion(request)).unwrap();

        server_thread.join().unwrap();
        assert_eq!(response.text, "partial scene");
        assert_eq!(response.finish_reason.as_deref(), Some("length"));
    }

    #[test]
    fn sse_decoder_preserves_multibyte_text_across_transport_chunks() {
        let source = "data: {\"choices\":[{\"delta\":{\"content\":\"你好🌙\"},\"finish_reason\":\"stop\"}]}\r\n\r\ndata: [DONE]\n\n";
        let mut decoder = OpenAiSseDecoder::default();
        let mut payloads = Vec::new();
        for byte in source.as_bytes() {
            payloads.extend(decoder.push(&[*byte]).unwrap());
        }
        payloads.extend(decoder.finish().unwrap());
        assert_eq!(payloads.len(), 2);
        assert!(payloads[0].contains("你好🌙"));
        assert_eq!(payloads[1], "[DONE]");
    }

    #[test]
    fn streaming_response_emits_ordered_deltas_and_returns_exact_aggregate() {
        let _serial = TEST_SERIAL
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reset_registry();
        let response_body = "data: {\"choices\":[{\"delta\":{\"content\":\"你\"},\"finish_reason\":null}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"好🌙\"},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":3,\"total_tokens\":10}}\n\ndata: [DONE]\n\n";
        let (base_url, server_thread) = spawn_response_server(response_body);
        let events = Arc::new(Mutex::new(Vec::<AiChatStreamEvent>::new()));
        let captured_events = events.clone();
        let emitter: StreamEmitter = Arc::new(move |event| {
            captured_events
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .push(event);
            Ok(())
        });

        let response = tauri::async_runtime::block_on(execute_ai_chat_completion_stream(
            test_request(base_url, Some("stream-normal-response"), 3),
            false,
            emitter,
        ))
        .unwrap();
        server_thread.join().unwrap();

        assert_eq!(response.text, "你好🌙");
        assert_eq!(response.finish_reason.as_deref(), Some("stop"));
        assert_eq!(response.total_tokens, Some(10));
        let events = events.lock().unwrap_or_else(|error| error.into_inner());
        let deltas: Vec<&AiChatStreamEvent> = events
            .iter()
            .filter(|event| event.event_type == "delta")
            .collect();
        assert_eq!(deltas.len(), 2);
        assert_eq!(deltas[0].sequence, Some(1));
        assert_eq!(deltas[0].text.as_deref(), Some("你"));
        assert_eq!(deltas[1].sequence, Some(2));
        assert_eq!(deltas[1].text.as_deref(), Some("好🌙"));
        assert!(events
            .iter()
            .any(|event| event.event_type == "usage" && event.token_total == Some(10)));
        assert_eq!(registry_counts(), (0, 0, 1));
    }

    #[test]
    fn streaming_response_rejects_unmarked_eof_without_returning_partial_text() {
        let _serial = TEST_SERIAL
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reset_registry();
        let response_body = "data: {\"choices\":[{\"delta\":{\"content\":\"partial secret\"},\"finish_reason\":null}]}\n\n";
        let (base_url, server_thread) = spawn_response_server(response_body);
        let emitter: StreamEmitter = Arc::new(|_| Ok(()));

        let error = tauri::async_runtime::block_on(execute_ai_chat_completion_stream(
            test_request(base_url, Some("stream-unmarked-eof"), 3),
            false,
            emitter,
        ))
        .unwrap_err();
        server_thread.join().unwrap();

        assert_eq!(error, AI_STREAM_INTERRUPTED);
        assert!(!error.contains("partial secret"));
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
    fn non_empty_output_token_truncation_is_discarded_without_exposing_provider_content() {
        let _serial = TEST_SERIAL
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reset_registry();
        let response_body = r#"{"choices":[{"finish_reason":"length","message":{"content":"partial Bearer private-output","reasoning_content":"Bearer private-reasoning"}}]}"#;
        let (base_url, server_thread) = spawn_response_server(response_body);

        let error = tauri::async_runtime::block_on(execute_ai_chat_completion(
            test_request(base_url, Some("truncated-output"), 3),
            false,
        ))
        .unwrap_err();

        server_thread.join().unwrap();
        assert!(error.contains("输出 Token 上限"));
        assert!(error.contains("内容不完整且未采纳"));
        assert!(!error.contains("private-output"));
        assert!(!error.contains("private-reasoning"));
        assert!(!error.contains("Bearer"));
        assert_eq!(registry_counts(), (0, 0, 1));
    }

    #[test]
    fn response_body_timeout_keeps_timeout_classification() {
        let _serial = TEST_SERIAL
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reset_registry();
        let (base_url, server_thread) = spawn_partial_response_server();

        let error = tauri::async_runtime::block_on(execute_ai_chat_completion(
            test_request(base_url, Some("response-body-timeout"), 1),
            false,
        ))
        .unwrap_err();

        server_thread.join().unwrap();
        assert!(error.contains("请求超时（1 秒）"));
        assert!(!error.contains("读取响应失败"));
        assert_eq!(registry_counts(), (0, 0, 1));
    }

    #[test]
    fn truncated_response_body_reports_upstream_interruption() {
        let _serial = TEST_SERIAL
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reset_registry();
        let (base_url, server_thread) = spawn_truncated_response_server();

        let error = tauri::async_runtime::block_on(execute_ai_chat_completion(
            test_request(base_url, Some("truncated-response-body"), 3),
            false,
        ))
        .unwrap_err();

        server_thread.join().unwrap();
        assert!(error.contains("上游服务在响应完成前中断连接"));
        assert!(!error.contains("Bearer"));
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

    #[test]
    fn recently_settled_request_id_cannot_be_reused_immediately() {
        let _serial = TEST_SERIAL
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        reset_registry();
        let request_id = "recently-settled-reuse";

        let mut registration = reserve_request(request_id.to_string()).unwrap();
        assert!(!registration.finish());

        let error = reserve_request(request_id.to_string()).err().unwrap();
        assert_eq!(error, AI_REQUEST_ID_RECENTLY_SETTLED);
        assert_eq!(registry_counts(), (0, 0, 1));
    }
}
