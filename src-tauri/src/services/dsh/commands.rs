//! Tauri command: `dsh_prepare_chapter` — the DSH planner adapter entry.
//!
//! Drives the out-of-process DSH runtime through the supervisor: initialize,
//! MCP settle, one planning prompt, then up to MAX_REPAIR_TURNS repair turns
//! fed with validation errors. Every parsed output passes the Rust-authoritative
//! validator (enum coercion included); adapter-owned metrics are injected before
//! returning. The runtime tree dies with the handle (Job Object).

use std::io::{BufRead, BufReader};
#[cfg(test)]
use std::net::IpAddr;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::async_runtime;

use super::config::{cordis_yml, runtime_root, RuntimeCompositionSpec, WORKBENCH_COMPOSITION};
use super::launcher::{
    configure_background_process, node_compatible_path, DshLaunchConfig, DshRuntimeLauncher,
    NodeDshRuntime,
};
use super::ledger::{record_run, summary, PreparationRunRecord, PreparationSummary};
use super::models::{ChapterPreparationInput, ChapterPreparationProposal};
use super::proposal_validator::{self, ValidationReport};
use super::supervisor::{RuntimeHandle, SessionSnapshot};
use super::task_runtime::{
    self, RuntimeDescriptor, StartTaskTurnInput, TaskProjectionObserver, TaskRuntimeResult,
    TaskRuntimeStatus, DSH_TASK_PROJECTION_EVENT,
};

#[tauri::command]
pub async fn dsh_start_task_turn(
    window: tauri::Window,
    input: StartTaskTurnInput,
) -> Result<TaskRuntimeResult, String> {
    let observer: TaskProjectionObserver = Arc::new(move |notice| {
        let _ = window.emit(DSH_TASK_PROJECTION_EVENT, notice);
        Ok(())
    });
    async_runtime::spawn_blocking(move || task_runtime::start_with_observer(input, Some(observer)))
        .await
        .map_err(|error| format!("DSH 任务 Worker 失败: {}", error))?
}

#[tauri::command]
pub fn dsh_cancel_task_run(conversation_id: String) -> Result<TaskRuntimeStatus, String> {
    task_runtime::cancel(&conversation_id)
}

#[tauri::command]
pub fn dsh_get_task_runtime_status(conversation_id: String) -> Option<TaskRuntimeStatus> {
    task_runtime::status(&conversation_id)
}

#[tauri::command]
pub fn dsh_list_task_runtime_status() -> Vec<TaskRuntimeStatus> {
    task_runtime::list_statuses()
}

#[tauri::command]
pub fn dsh_describe_runtime() -> RuntimeDescriptor {
    task_runtime::describe_runtime()
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CurrentPluginProjection {
    pub id: String,
    pub name: String,
    pub category: String,
    pub version: String,
    pub description: String,
    pub status: String,
    pub availability: String,
    pub initialization: String,
    pub health: String,
    pub source: String,
    pub capabilities: Vec<String>,
}

fn short_version(value: &str) -> String {
    value.chars().take(8).collect()
}

fn projection(
    id: impl Into<String>,
    name: impl Into<String>,
    category: &str,
    version: impl Into<String>,
    description: impl Into<String>,
    status: &str,
    availability: &str,
    initialization: &str,
    health: &str,
    source: &str,
    capabilities: impl IntoIterator<Item = impl Into<String>>,
) -> CurrentPluginProjection {
    CurrentPluginProjection {
        id: id.into(),
        name: name.into(),
        category: category.to_string(),
        version: version.into(),
        description: description.into(),
        status: status.to_string(),
        availability: availability.to_string(),
        initialization: initialization.to_string(),
        health: health.to_string(),
        source: source.to_string(),
        capabilities: capabilities.into_iter().map(Into::into).collect(),
    }
}

fn safe_catalog_text(value: Option<&str>, fallback: &str) -> String {
    let value = value.unwrap_or(fallback).trim();
    let mut safe = value
        .chars()
        .filter(|character| !character.is_control())
        .take(240)
        .collect::<String>();
    if safe.is_empty() {
        safe = fallback.to_string();
    }
    safe
}

fn canonical_workbench_tool(value: &str) -> Option<&'static str> {
    match value {
        "novel.read_context" | "mcp__novel__novel.read_context" => Some("novel.read_context"),
        "chapter.read_outline" | "mcp__novel__chapter.read_outline" => Some("chapter.read_outline"),
        "get_character_states" | "mcp__novel__get_character_states" => Some("get_character_states"),
        "search_memory" | "mcp__novel__search_memory" => Some("search_memory"),
        "generate_chapter" | "mcp__novel__generate_chapter" => Some("generate_chapter"),
        "generate_outline" | "mcp__novel__generate_outline" => Some("generate_outline"),
        "generate_characters" | "mcp__novel__generate_characters" => Some("generate_characters"),
        "suggest_events" | "mcp__novel__suggest_events" => Some("suggest_events"),
        "expand_settings" | "mcp__novel__expand_settings" => Some("expand_settings"),
        "polish_chapter" | "mcp__novel__polish_chapter" => Some("polish_chapter"),
        "check_quality" | "mcp__novel__check_quality" => Some("check_quality"),
        "summarize_chapter" | "mcp__novel__summarize_chapter" => Some("summarize_chapter"),
        value if value.starts_with("mcp__novel__novel_read_context_") => Some("novel.read_context"),
        value if value.starts_with("mcp__novel__chapter_read_outline_") => {
            Some("chapter.read_outline")
        }
        value if value.starts_with("mcp__novel__get_character_states_") => {
            Some("get_character_states")
        }
        _ => None,
    }
}

fn component_files_available(root: Option<&Path>, spec: &RuntimeCompositionSpec) -> bool {
    root.is_some_and(|root| {
        spec.required_paths
            .iter()
            .all(|relative| root.join(relative).is_file())
    })
}

fn health_is_compatible(health: &Value, runtime: &RuntimeDescriptor) -> bool {
    health.get("sourceCommit").and_then(Value::as_str) == Some(runtime.source_commit.as_str())
        && health.get("protocol").and_then(Value::as_str) == Some(runtime.protocol.as_str())
}

fn composition_health_status<'a>(health: &'a Value, id: &str) -> Option<&'a str> {
    health
        .get("composition")?
        .as_array()?
        .iter()
        .find(|entry| entry.get("id").and_then(Value::as_str) == Some(id))?
        .get("status")?
        .as_str()
}

fn build_current_plugin_projection_with<F>(
    runtime: &RuntimeDescriptor,
    health: Option<&Value>,
    component_available: F,
    gateway_available: bool,
) -> Vec<CurrentPluginProjection>
where
    F: Fn(&RuntimeCompositionSpec) -> bool,
{
    let version = short_version(&runtime.source_commit);
    let compatible_health = health.filter(|value| health_is_compatible(value, runtime));
    let carrier_available = runtime.runtime_root.is_some();
    let carrier_integrity_ok = matches!(runtime.status.as_str(), "available" | "loaded");
    let initialized = compatible_health
        .and_then(|value| value.get("initialized"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let ready = compatible_health
        .and_then(|value| value.get("ready"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let (carrier_status, carrier_initialization, carrier_health, carrier_description) =
        if !carrier_available {
            (
                "unavailable",
                "not_initialized",
                "unknown",
                "固定 DSH 载体未找到。",
            )
        } else if !carrier_integrity_ok {
            (
                "failed",
                "failed",
                "failed",
                "固定 DSH 载体完整性或 Node 版本校验失败。",
            )
        } else if ready {
            (
                "loaded",
                "initialized",
                "healthy",
                "固定载体已 initialize，Loader、Session、Transport 与 composition 健康。",
            )
        } else if initialized {
            (
                "failed",
                "initialized",
                "failed",
                "固定载体已 initialize，但 runtime/health 未达到 ready。",
            )
        } else {
            (
                "unavailable",
                "not_initialized",
                "unknown",
                "固定载体可用；尚无已 initialize 的任务 Worker 健康证据。",
            )
        };

    let mut rows = vec![projection(
        format!("dsh-carrier:{}", runtime.source_commit),
        "Pinned DSH Carrier",
        "other",
        version.clone(),
        carrier_description,
        carrier_status,
        if carrier_available {
            "available"
        } else {
            "unavailable"
        },
        carrier_initialization,
        carrier_health,
        "dsh-runtime-descriptor",
        ["fixed-source-commit", "headless-worker", "runtime-health"],
    )];

    for spec in WORKBENCH_COMPOSITION {
        let files_available =
            component_available(spec) && (spec.id != "mcp-novel" || gateway_available);
        let runtime_status =
            compatible_health.and_then(|value| composition_health_status(value, spec.id));
        let (status, initialization, component_health, description) = if !carrier_available {
            (
                "unavailable",
                "not_initialized",
                "unknown",
                "固定载体不可用，未检查插件初始化。",
            )
        } else if !carrier_integrity_ok || !files_available {
            (
                "failed",
                "failed",
                "failed",
                "composition 所需载体文件或本地域网关缺失。",
            )
        } else {
            match runtime_status {
                Some("loaded") if ready => (
                    "loaded",
                    "initialized",
                    "healthy",
                    "runtime/health 已确认此 composition 节点加载且健康。",
                ),
                Some("failed") => (
                    "failed",
                    "failed",
                    "failed",
                    "runtime/health 报告此 composition 节点加载失败。",
                ),
                Some("unavailable") => (
                    "unavailable",
                    "not_initialized",
                    "unknown",
                    "载体文件可用，但 runtime/health 尚未确认节点加载。",
                ),
                Some("loaded") => (
                    "loaded",
                    "initialized",
                    "unknown",
                    "节点已加载，但整体 runtime 尚未达到 healthy。",
                ),
                _ => (
                    "unavailable",
                    "not_initialized",
                    "unknown",
                    "载体文件可用；尚无此节点的 runtime/health 证据。",
                ),
            }
        };
        rows.push(projection(
            format!("dsh-composition:{}", spec.id),
            spec.name,
            "other",
            version.clone(),
            description,
            status,
            if files_available {
                "available"
            } else {
                "unavailable"
            },
            initialization,
            component_health,
            "pinned-cordis-composition",
            spec.capabilities.iter().copied(),
        ));
    }

    if let Some(health) = compatible_health {
        if let Some(providers) = health.get("providers").and_then(Value::as_array) {
            for provider in providers {
                let Some(provider_id) = provider.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let provider_status = provider
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("failed");
                let loaded = provider_status == "loaded";
                rows.push(projection(
                    format!("provider:{provider_id}"),
                    safe_catalog_text(provider.get("name").and_then(Value::as_str), provider_id),
                    "model",
                    version.clone(),
                    if loaded {
                        "Provider 已注册且模型目录可读取；未执行额外网络探测。"
                    } else {
                        "Provider 已注册，但模型目录读取失败。"
                    },
                    if loaded { "loaded" } else { "failed" },
                    "available",
                    if loaded { "initialized" } else { "failed" },
                    if loaded { "unknown" } else { "failed" },
                    "dsh-runtime-health",
                    ["provider-directory", "model-directory"],
                ));
            }
        }

        if let Some(models) = health.get("models").and_then(Value::as_array) {
            for model in models {
                let Some(provider_id) = model.get("provider").and_then(Value::as_str) else {
                    continue;
                };
                let Some(model_id) = model.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let tool_calling_attested = health
                    .get("modelToolAttestations")
                    .and_then(Value::as_array)
                    .is_some_and(|attestations| {
                        attestations.iter().any(|attestation| {
                            task_runtime::validate_model_tool_attestation(
                                attestation.clone(),
                                provider_id,
                                model_id,
                            )
                            .is_ok()
                        })
                    });
                let mut capabilities = vec![
                    format!("provider:{provider_id}"),
                    "model-directory".to_string(),
                ];
                if tool_calling_attested {
                    capabilities.push("tool-calling-attested".to_string());
                }
                rows.push(projection(
                    format!("model:{provider_id}:{model_id}"),
                    safe_catalog_text(model.get("name").and_then(Value::as_str), model_id),
                    "model",
                    "catalog",
                    if tool_calling_attested {
                        "Runtime 模型目录条目；原生工具调用已通过当前 Worker nonce 探针验证。"
                    } else {
                        "Runtime 模型目录条目；原生工具调用尚未验证。"
                    },
                    "loaded",
                    "available",
                    "initialized",
                    if tool_calling_attested {
                        "healthy"
                    } else {
                        "unknown"
                    },
                    "dsh-runtime-health",
                    capabilities,
                ));
            }
        }

        if let Some(tools) = health.pointer("/tools/global").and_then(Value::as_array) {
            let mut canonical = tools
                .iter()
                .filter_map(Value::as_str)
                .filter_map(canonical_workbench_tool)
                .collect::<Vec<_>>();
            canonical.sort_unstable();
            canonical.dedup();
            for tool in canonical {
                rows.push(projection(
                    format!("tool:{tool}@1"),
                    tool,
                    "function",
                    "1",
                    "工具已出现在 Harness 公共 scoped Tool Registry；未执行工具调用探测。",
                    "loaded",
                    "available",
                    "initialized",
                    "unknown",
                    "dsh-runtime-health",
                    [tool, "scoped-tool-registry"],
                ));
            }
        }
    }

    rows
}

fn build_current_plugin_projection(
    runtime: &RuntimeDescriptor,
    health: Option<&Value>,
) -> Vec<CurrentPluginProjection> {
    let root = runtime.runtime_root.as_deref().map(Path::new);
    let gateway_available = resolve_gateway_bin().is_ok();
    build_current_plugin_projection_with(
        runtime,
        health,
        |spec| component_files_available(root, spec),
        gateway_available,
    )
}

fn list_current_plugins_projection(
    conversation_id: Option<String>,
    model_snapshot: Option<Value>,
    api_key: Option<String>,
) -> Result<Vec<CurrentPluginProjection>, String> {
    let runtime = task_runtime::describe_runtime();
    let allow_probe =
        conversation_id.as_deref() == Some(task_runtime::PLUGIN_PROBE_CONVERSATION_ID);
    match task_runtime::runtime_health_with_probe(
        conversation_id.as_deref(),
        allow_probe,
        model_snapshot.as_ref(),
        api_key.as_deref(),
    ) {
        Ok(health) => Ok(build_current_plugin_projection(&runtime, health.as_ref())),
        Err(error) => Err(task_runtime::safe_runtime_error(&error)),
    }
}

#[tauri::command]
pub async fn dsh_list_current_plugins(
    conversation_id: Option<String>,
    model_snapshot: Option<Value>,
    api_key: Option<String>,
) -> Result<Vec<CurrentPluginProjection>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        list_current_plugins_projection(conversation_id, model_snapshot, api_key)
    })
    .await
    .map_err(|_| "Runtime 模型目录探针线程异常退出".to_string())?
}

/// The persona the runtime is booted with (asset: prompts/dsh_chapter_preparation.md).
const PERSONA: &str = include_str!("../../../../prompts/dsh_chapter_preparation.md");
/// The local model-gateway proxy script (asset: scripts/dsh/model-proxy.mjs),
/// embedded so the command can write it to the runtime work dir at launch.
const PROXY_SCRIPT: &str = include_str!("../../../../scripts/dsh/model-proxy.mjs");
const MAX_REPAIR_TURNS: usize = 3;
const SETTLE: Duration = Duration::from_millis(3000);
const TURN_TIMEOUT: Duration = Duration::from_secs(480);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_TOKENS: u64 = 8192;
const DEFAULT_MODEL: &str = "deepseek-v4-flash";

/// Normalize the provider base URL before handing it to the pinned DSH
/// provider. The provider appends `/chat/completions` itself, so a trailing
/// slash would otherwise produce a double slash and some OpenAI-compatible
/// servers reject that route. Keep the validation here at the boundary so a
/// malformed test/profile value fails before a worker is started.
pub(super) fn normalize_model_base_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("DSH baseUrl 不能为空".to_string());
    }
    let parsed =
        reqwest::Url::parse(trimmed).map_err(|error| format!("DSH baseUrl 无效: {}", error))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("DSH baseUrl 必须是带主机的 http(s) URL".to_string());
    }
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("DSH baseUrl 不得包含 userinfo、query 或 fragment".to_string());
    }
    Ok(trimmed.trim_end_matches('/').to_string())
}

fn preparation_gateway_database_path() -> PathBuf {
    #[cfg(test)]
    if let Some(path) = std::env::var_os("DSH_E2E_GATEWAY_DB_PATH") {
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }
    crate::db::get_database_path()
}

#[cfg(test)]
fn normalize_loopback_test_base_url(value: &str) -> Result<String, String> {
    let normalized = normalize_model_base_url(value)?;
    let parsed = reqwest::Url::parse(&normalized)
        .map_err(|error| format!("DSH test baseUrl 无效: {}", error))?;
    let is_loopback = parsed.host_str().is_some_and(|host| {
        let host = host.trim_matches(|character| character == '[' || character == ']');
        host.eq_ignore_ascii_case("localhost")
            || host
                .parse::<IpAddr>()
                .map(|address| address.is_loopback())
                .unwrap_or(false)
    });
    if !is_loopback {
        return Err("DSH test baseUrl 只能使用 loopback 主机".to_string());
    }
    Ok(normalized)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DshPrepareOptions {
    /// DeepSeek credential passed from the frontend provider settings; injected
    /// into the runtime child env only, never persisted by this command.
    pub api_key: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[tauri::command]
pub async fn dsh_prepare_chapter(
    input: ChapterPreparationInput,
    options: DshPrepareOptions,
) -> Result<ChapterPreparationProposal, String> {
    async_runtime::spawn_blocking(move || prepare(input, options))
        .await
        .map_err(|error| format!("DSH 准备任务失败: {}", error))?
}

#[tauri::command]
pub fn get_dsh_preparation_summary(
    novel_id: String,
    chapter_id: String,
) -> Result<PreparationSummary, String> {
    let connection = crate::db::get_connection()
        .lock()
        .map_err(|error| format!("DSH 用量汇总数据库锁失败: {}", error))?;
    summary(&connection, &novel_id, &chapter_id)
}

/// Owns the local model-gateway proxy process; killed on drop.
pub(crate) struct ProxyGuard {
    child: Mutex<Option<Child>>,
    log: Arc<Mutex<String>>,
    #[cfg(windows)]
    job: Mutex<Option<super::supervisor::JobObject>>,
}

impl ProxyGuard {
    fn log_tail(&self) -> String {
        let buffer = self.log.lock().unwrap();
        if buffer.len() > 4000 {
            buffer[buffer.len() - 4000..].to_string()
        } else {
            buffer.clone()
        }
    }

    pub(crate) fn last_policy_error_code(&self) -> Option<String> {
        self.log
            .lock()
            .ok()?
            .lines()
            .rev()
            .find_map(|line| line.strip_prefix("[model-proxy] policyReject code="))
            .filter(|code| {
                !code.is_empty()
                    && code.len() <= 96
                    && code.bytes().all(|byte| {
                        byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_'
                    })
            })
            .map(str::to_string)
    }

    pub(crate) fn safe_diagnostics(&self) -> Option<String> {
        let buffer = self.log.lock().ok()?;
        let lines = buffer
            .lines()
            .filter(|line| {
                line.starts_with("[model-proxy] request ")
                    || line.starts_with("[model-proxy] responseStats ")
                    || line.starts_with("[model-proxy] done ")
            })
            .rev()
            .take(9)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" | ");
        (!lines.is_empty()).then_some(lines.chars().take(3600).collect())
    }
}

impl Drop for ProxyGuard {
    fn drop(&mut self) {
        #[cfg(windows)]
        if let Ok(mut job) = self.job.lock() {
            job.take();
        }
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Spawns the local proxy on a free port with the upstream key; returns the
/// guard plus the base URL. The downstream (DSH) side gets a dummy key: the
/// upstream credential lives only in the proxy process.
pub(crate) fn spawn_proxy(
    work: &Path,
    upstream_key: &str,
    model: &str,
) -> Result<(ProxyGuard, String), String> {
    let upstream = std::env::var("DSH_PROXY_UPSTREAM")
        .unwrap_or_else(|_| "https://api.deepseek.com".to_string());
    spawn_proxy_with_policy(work, upstream_key, &upstream, model, None, None, None)
}

pub(crate) fn spawn_governed_proxy(
    work: &Path,
    upstream_key: &str,
    upstream: &str,
    model: &str,
    policy_url: &str,
    request_prefix: &str,
    request_timeout_ms: i64,
) -> Result<(ProxyGuard, String), String> {
    spawn_proxy_with_policy(
        work,
        upstream_key,
        upstream,
        model,
        Some(policy_url),
        Some(request_prefix),
        Some(request_timeout_ms),
    )
}

fn spawn_proxy_with_policy(
    work: &Path,
    upstream_key: &str,
    upstream: &str,
    model: &str,
    policy_url: Option<&str>,
    request_prefix: Option<&str>,
    request_timeout_ms: Option<i64>,
) -> Result<(ProxyGuard, String), String> {
    let port = {
        let listener =
            TcpListener::bind("127.0.0.1:0").map_err(|error| format!("端口分配失败: {}", error))?;
        listener
            .local_addr()
            .map(|address| address.port())
            .map_err(|error| error.to_string())?
    };
    let script_path = work.join("model-proxy.mjs");
    std::fs::write(&script_path, PROXY_SCRIPT)
        .map_err(|error| format!("代理脚本写入失败: {}", error))?;

    let mut command = Command::new("node");
    configure_background_process(&mut command);
    command
        .arg(node_compatible_path(&script_path))
        .env("PROXY_PORT", port.to_string())
        .env("PROXY_UPSTREAM", upstream)
        .env("PROXY_UPSTREAM_KEY", upstream_key)
        .env("PROXY_MODEL", model)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(policy_url) = policy_url {
        command.env("PROXY_POLICY_URL", policy_url);
    }
    if let Some(request_prefix) = request_prefix {
        command.env("PROXY_REQUEST_PREFIX", request_prefix);
    }
    if let Some(request_timeout_ms) = request_timeout_ms {
        command.env(
            "PROXY_REQUEST_TIMEOUT_MS",
            request_timeout_ms.clamp(1_000, 30 * 60_000).to_string(),
        );
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("代理启动失败: {}", error))?;
    #[cfg(windows)]
    let job = match super::supervisor::JobObject::create_and_assign(child.id()) {
        Ok(job) => Mutex::new(Some(job)),
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("代理进程树隔离失败: {}", error));
        }
    };

    let log = Arc::new(Mutex::new(String::new()));
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "代理 stdout 未接管".to_string())?;
    {
        let log = log.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let mut buffer = log.lock().unwrap();
                        buffer.push_str(&line);
                        if buffer.len() > 1_000_000 {
                            *buffer = buffer[buffer.len() - 600_000..].to_string();
                        }
                    }
                }
            }
        });
    }
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "代理 stderr 未接管".to_string())?;
    {
        let log = log.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let mut buffer = log.lock().unwrap();
                        buffer.push_str(&line);
                        if buffer.len() > 1_000_000 {
                            *buffer = buffer[buffer.len() - 600_000..].to_string();
                        }
                    }
                }
            }
        });
    }

    // Health: wait until the server accepts connections.
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "代理未在 10 秒内就绪；日志: {}",
                log.lock().unwrap()
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    let base_url = format!("http://127.0.0.1:{}", port);
    Ok((
        ProxyGuard {
            child: Mutex::new(Some(child)),
            log,
            #[cfg(windows)]
            job,
        },
        base_url,
    ))
}

fn prepare(
    input: ChapterPreparationInput,
    options: DshPrepareOptions,
) -> Result<ChapterPreparationProposal, String> {
    if options.api_key.trim().is_empty() {
        return Err("apiKey 不能为空（从设置中的 DeepSeek Provider 读取）".to_string());
    }
    verify_baseline_freshness(&input)?;
    let _node_version = NodeDshRuntime::check_node()?;
    let root = runtime_root().ok_or_else(|| {
        "未找到 DSH 运行时载体：请设置 DSH_RUNTIME_ROOT / DSH_CHECKOUT，或在应用目录放置 dsh-runtime/ 载荷（用 scripts/dsh/build-runtime-payload.mjs 构建）".to_string()
    })?;
    let runtime_bin = NodeDshRuntime::runtime_bin(&root)?;
    let gateway_bin = resolve_gateway_bin()?;
    let db_path = node_compatible_path(&preparation_gateway_database_path())
        .to_string_lossy()
        .to_string();

    let work = std::env::temp_dir().join(format!("dsh-v310-{}", std::process::id()));
    std::fs::create_dir_all(&work).map_err(|error| format!("工作目录创建失败: {}", error))?;
    let cordis_path = work.join("cordis.yml");
    std::fs::write(&cordis_path, cordis_yml(&root, &gateway_bin, &db_path))
        .map_err(|error| format!("cordis 渲染失败: {}", error))?;

    let model = options
        .model
        .or_else(|| std::env::var("DSH_MODEL").ok())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());
    // Keep every upstream behind the process-local compatibility proxy. Besides
    // isolating the credential from the carrier, this normalizes conservative
    // OpenAI-compatible SSE variants before they reach the pinned DSH adapter.
    let (proxy_guard, base_url) = match options.base_url {
        Some(url) => {
            let upstream = normalize_model_base_url(&url)?;
            let (guard, proxy_url) = spawn_proxy_with_policy(
                &work,
                &options.api_key,
                &upstream,
                &model,
                None,
                None,
                None,
            )?;
            (Some(guard), proxy_url)
        }
        None => {
            let (guard, proxy_url) = spawn_proxy(&work, &options.api_key, &model)?;
            (Some(guard), proxy_url)
        }
    };
    let downstream_key = "local-proxy".to_string();

    let config = DshLaunchConfig {
        runtime_bin: PathBuf::from(runtime_bin),
        cordis_config: cordis_path,
        session_root: work.join("sessions"),
        home: work.join("home"),
        api_key: downstream_key,
        base_url,
        system_prompt: PERSONA.to_string(),
        cwd: work.clone(),
        allowed_tools: None,
        task_novel_id: Some(input.novel_id.clone()),
        task_chapter_id: Some(input.chapter_id.clone()),
        candidate_policy: None,
    };

    let run_id = uuid::Uuid::new_v4().to_string();
    let child = NodeDshRuntime
        .launch(&config)
        .map_err(|error| format!("DSH 运行时启动失败: {}", error))?;
    let runtime = RuntimeHandle::new(child).map_err(|error| error.to_string())?;

    let run_started = Instant::now();
    let result = run_preparation(&runtime, &config, &input, &model);
    let failed_session = format!("prepare-{}-{}", input.novel_id, input.chapter_id);
    let failed_snapshot = runtime.snapshot(&failed_session).unwrap_or_default();
    let failed_duration_ms = run_started.elapsed().as_millis() as i64;
    let _ = runtime.shutdown_and_wait(SHUTDOWN_TIMEOUT);
    drop(runtime);
    if let Some(guard) = proxy_guard {
        let tail = guard.log_tail();
        crate::errors::log_workspace_event(crate::errors::WorkspaceLogEvent {
            level: "info",
            event: "dsh_model_proxy_accounting",
            trace_id: None,
            operation_id: None,
            novel_id: Some(input.novel_id.as_str()),
            chapter_id: Some(input.chapter_id.as_str()),
            draft_id: None,
            error_code: None,
            metadata: Some(serde_json::json!({ "logTail": tail })),
        });
    }

    let ledger_record = match &result {
        Ok(proposal) => PreparationRunRecord {
            id: run_id,
            novel_id: input.novel_id.clone(),
            chapter_id: input.chapter_id.clone(),
            planner: proposal.planner.clone(),
            status: "completed".to_string(),
            prompt_tokens: proposal.metrics.prompt_tokens.unwrap_or(0),
            completion_tokens: proposal.metrics.completion_tokens.unwrap_or(0),
            duration_ms: proposal.metrics.duration_ms,
            planner_coerced: proposal
                .metrics
                .planner_coerced
                .as_ref()
                .and_then(|value| serde_json::to_string(value).ok()),
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        Err(_) => PreparationRunRecord {
            id: run_id,
            novel_id: input.novel_id.clone(),
            chapter_id: input.chapter_id.clone(),
            planner: "dsh_spike_v0".to_string(),
            status: "failed".to_string(),
            prompt_tokens: failed_snapshot.prompt_tokens as i64,
            completion_tokens: failed_snapshot.completion_tokens as i64,
            duration_ms: failed_duration_ms,
            planner_coerced: None,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
    };
    let ledger_result = crate::db::get_connection()
        .lock()
        .map_err(|error| format!("DSH 运行记录数据库锁失败: {}", error))
        .and_then(|connection| record_run(&connection, &ledger_record));
    if let Err(ledger_error) = ledger_result {
        return Err(match result {
            Ok(_) => format!("DSH 提案已生成，但运行记录未持久化：{}", ledger_error),
            Err(original_error) => format!(
                "DSH 准备失败，且失败记录未持久化：{}；原始错误：{}",
                ledger_error, original_error
            ),
        });
    }
    result
}

fn verify_baseline_freshness(input: &ChapterPreparationInput) -> Result<(), String> {
    let connection = crate::db::get_connection()
        .lock()
        .map_err(|error| format!("DSH 基线复验数据库锁失败: {}", error))?;
    let canonical =
        super::baseline_freshness::read_canonical(&connection, &input.novel_id, &input.chapter_id)?;
    super::baseline_freshness::verify_fresh(input, &canonical)
}

fn run_preparation(
    runtime: &RuntimeHandle,
    config: &DshLaunchConfig,
    input: &ChapterPreparationInput,
    model: &str,
) -> Result<ChapterPreparationProposal, String> {
    let cwd = config.cwd.to_string_lossy().replace('\\', "/");
    runtime
        .request(
            "initialize",
            Some(json!({
                "cwd": cwd,
                "provider": "deepseek-official",
                "model": model,
                "maxTokens": MAX_TOKENS
            })),
            Duration::from_secs(30),
        )
        .map_err(|error| format!("initialize 失败: {}", error))?;
    // P2 finding: MCP tool sync has no readiness notification; settle first.
    std::thread::sleep(SETTLE);

    let session_id = format!("prepare-{}-{}", input.novel_id, input.chapter_id);
    let started = Instant::now();
    verify_baseline_freshness(input)?;
    runtime
        .request(
            "session/prompt",
            Some(json!({
                "sessionId": session_id,
                "contentBlocks": [{"type": "text", "text": planning_prompt(input)}]
            })),
            Duration::from_secs(30),
        )
        .map_err(|error| format!("session/prompt 失败: {}", error))?;

    let parsed_value: Option<Value>;
    let coercion;
    let mut repair_turns = 0usize;
    let mut last_errors: Vec<String>;

    loop {
        if !runtime.wait_idle(&session_id, TURN_TIMEOUT) {
            return Err(format!(
                "DSH 回合未在 {} 秒内完成；stderr: {}",
                TURN_TIMEOUT.as_secs(),
                runtime.stderr_tail()
            ));
        }
        let snapshot = runtime
            .snapshot(&session_id)
            .ok_or_else(|| "会话快照缺失".to_string())?;
        ensure_model_turn_succeeded(&snapshot)?;
        match extract_proposal_json(&snapshot) {
            Some(mut value) => {
                let report: ValidationReport = proposal_validator::validate(input, &mut value);
                if report.valid {
                    parsed_value = Some(value);
                    coercion = report.coerced;
                    break;
                }
                last_errors = report.errors;
                if repair_turns >= MAX_REPAIR_TURNS {
                    return Err(format!(
                        "提案校验在 {} 次修复回合后仍失败: {}",
                        repair_turns,
                        last_errors.join(" | ")
                    ));
                }
            }
            None => {
                last_errors = vec!["模型输出不含 JSON 对象".to_string()];
                if repair_turns >= MAX_REPAIR_TURNS {
                    return Err("模型输出不含 JSON 对象且修复回合已耗尽".to_string());
                }
            }
        }
        verify_baseline_freshness(input)?;
        runtime
            .request(
                "session/prompt",
                Some(json!({
                    "sessionId": session_id,
                    "contentBlocks": [{"type": "text", "text": build_repair_prompt(&last_errors)}]
                })),
                Duration::from_secs(30),
            )
            .map_err(|error| format!("修复回合请求失败: {}", error))?;
        repair_turns += 1;
    }

    let mut value = parsed_value.expect("valid proposal value");
    let duration_ms = started.elapsed().as_millis() as i64;
    let snapshot = runtime.snapshot(&session_id).unwrap_or_default();
    // Adapter-owned runtime metrics replace whatever the model produced.
    value["metrics"] = json!({
        "planner": value["planner"],
        "durationMs": duration_ms,
        "promptTokens": snapshot.prompt_tokens as i64,
        "completionTokens": snapshot.completion_tokens as i64,
        "toolCallCount": snapshot.tool_calls.len() as i64,
        "processRestarts": 0,
    });
    if let Some(coercion) = coercion {
        value["metrics"]["plannerCoerced"] = json!({
            "original": coercion.original,
            "distance": coercion.distance,
        });
    }
    serde_json::from_value::<ChapterPreparationProposal>(value)
        .map_err(|error| format!("提案类型化失败: {}", error))
}

fn ensure_model_turn_succeeded(snapshot: &SessionSnapshot) -> Result<(), String> {
    match snapshot.last_turn_error_code.as_deref() {
        Some(code) => Err(format!("DSH 模型回合失败: {}", code)),
        None => Ok(()),
    }
}

fn planning_prompt(input: &ChapterPreparationInput) -> String {
    let revision_lines = proposal_validator::PROPOSAL_SOURCES
        .iter()
        .map(|source| {
            let revision = input
                .baseline_revisions
                .iter()
                .find(|entry| entry.source == *source)
                .map(|entry| entry.revision);
            format!("{}={}", source, revision.unwrap_or(-1))
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "本案例：novelId={}，chapterId={}。\n请先并行调用只读工具 get_metadata、get_chapter_context、get_character_states，并用 search_memory 检索与本章相关的记忆（query 可用章节标题或关键人物），必要时补充检索，然后按系统提示的 JSON 结构输出章节准备提案。\n给定修订号（baselineRevisions 与 retrievedEvidence 的 revision 必须逐字使用以下值，不得编造）：\n{}",
        input.novel_id, input.chapter_id, revision_lines
    )
}

fn build_repair_prompt(errors: &[String]) -> String {
    let mut lines = vec!["你的输出未通过校验，错误如下：".to_string()];
    for error in errors.iter().take(8) {
        lines.push(format!("- {}", error));
    }
    lines.push("请只输出修正后的完整 JSON 对象，并遵守以下硬性规则：".to_string());
    lines.push(
        "1. 字符串内部引用原文只能使用中文引号「」；数组元素之间必须用英文逗号分隔。".to_string(),
    );
    lines.push("2. planner 字段只有两个合法值，必须逐字符一致：current_chapter_readiness_v1 或 dsh_spike_v0（拼写注意：d-s-h，不是 d-s-p；用下划线 _ 连接，不是连字符 -）。".to_string());
    lines.push("3. revision 逐字使用提示中给定的值，不得编造。".to_string());
    lines.push("4. 除 JSON 对象外不要输出任何解释文字。".to_string());
    lines.push(
        "5. 工具调用完成后必须继续输出完整 JSON；即使上一轮已有自然语言，也要重新输出完整对象。"
            .to_string(),
    );
    lines.join("\n")
}

fn extract_proposal_json(snapshot: &SessionSnapshot) -> Option<Value> {
    extract_proposal_json_candidates(
        &snapshot.last_assistant_text,
        &snapshot.last_assistant_reasoning,
        &snapshot.assistant_text,
    )
}

fn extract_proposal_json_candidates(
    last_assistant_text: &str,
    last_assistant_reasoning: &str,
    assistant_text: &str,
) -> Option<Value> {
    [
        last_assistant_text,
        last_assistant_reasoning,
        assistant_text,
    ]
    .into_iter()
    .filter(|candidate| !candidate.trim().is_empty())
    .find_map(extract_json)
}

/// Extracts the last complete JSON object from a model answer.
///
/// Models may wrap the object in fences or explanatory text, and a repair
/// session may contain more than one answer. Scan balanced object spans while
/// respecting JSON strings, then keep the latest syntactically valid object.
fn extract_json(text: &str) -> Option<Value> {
    let bytes = text.as_bytes();
    let mut latest: Option<(usize, Value)> = None;

    for start in bytes
        .iter()
        .enumerate()
        .filter_map(|(index, byte)| (*byte == b'{').then_some(index))
    {
        let mut depth = 0usize;
        let mut in_string = false;
        let mut escaped = false;
        for (offset, byte) in bytes[start..].iter().copied().enumerate() {
            if in_string {
                if escaped {
                    escaped = false;
                } else if byte == b'\\' {
                    escaped = true;
                } else if byte == b'"' {
                    in_string = false;
                }
                continue;
            }
            match byte {
                b'"' => in_string = true,
                b'{' => depth += 1,
                b'}' => {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        let end = start + offset;
                        if let Ok(value) = serde_json::from_slice::<Value>(&bytes[start..=end]) {
                            if value.is_object()
                                && latest
                                    .as_ref()
                                    .is_none_or(|(latest_end, _)| end > *latest_end)
                            {
                                latest = Some((end, value));
                            }
                        }
                        break;
                    }
                }
                _ => {}
            }
        }
    }

    latest.map(|(_, value)| value)
}

#[cfg(test)]
mod response_json_tests {
    use super::*;

    #[test]
    fn falls_back_to_reasoning_when_public_text_has_no_json() {
        assert_eq!(
            extract_proposal_json_candidates(
                "已完成。",
                "```json\n{\"planner\":\"dsh_spike_v0\"}\n```",
                "已完成。",
            )
            .and_then(|value| value
                .get("planner")
                .and_then(Value::as_str)
                .map(str::to_string)),
            Some("dsh_spike_v0".to_string())
        );
    }

    #[test]
    fn extracts_latest_complete_object_amid_fences_and_invalid_braces() {
        let value =
            extract_json("说明 {not-json}\n{\"earlier\":1}\n```json\n{\"selected\":2}\n``` 完成")
                .expect("latest JSON object");
        assert_eq!(value["selected"], json!(2));
        assert!(value.get("earlier").is_none());
    }

    #[test]
    fn balanced_scanner_ignores_braces_inside_json_strings() {
        let value = extract_json(r#"prefix {"text":"literal } and { plus \"quote\""} suffix"#)
            .expect("JSON with brace characters in a string");
        assert_eq!(value["text"], json!(r#"literal } and { plus "quote""#));
    }

    #[test]
    fn missing_complete_json_stays_none_and_repair_prompt_requires_full_object() {
        assert!(extract_json("plain text { unfinished").is_none());
        assert!(build_repair_prompt(&["模型输出不含 JSON 对象".to_string()])
            .contains("工具调用完成后必须继续输出完整 JSON"));
    }

    #[test]
    fn model_turn_failure_is_reported_before_json_repair() {
        let mut snapshot = SessionSnapshot::default();
        snapshot.last_turn_error_code = Some("STREAM_CLOSED".to_string());
        assert_eq!(
            ensure_model_turn_succeeded(&snapshot).expect_err("turn must fail"),
            "DSH 模型回合失败: STREAM_CLOSED"
        );
    }
}

/// Locates the gateway binary: DSH_GATEWAY_BIN env, then next to the app exe.
pub(crate) fn resolve_gateway_bin() -> Result<String, String> {
    if let Ok(bin) = std::env::var("DSH_GATEWAY_BIN") {
        if !bin.trim().is_empty() && std::path::Path::new(&bin).is_file() {
            return Ok(bin);
        }
    }
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        .ok_or_else(|| "无法定位应用可执行目录".to_string())?;
    let candidates = [
        crate::db::get_data_dir().join("dsh-runtime/gateway/novel-domain-gateway.exe"),
        exe_dir.join("dsh-runtime/gateway/novel-domain-gateway.exe"),
        exe_dir.join("novel-domain-gateway.exe"),
    ];
    if let Some(candidate) = candidates.iter().find(|candidate| candidate.is_file()) {
        return Ok(candidate.to_string_lossy().to_string());
    }
    Err(format!(
        "novel-domain-gateway 未找到（可设 DSH_GATEWAY_BIN 指定）；已检查应用数据和安装目录"
    ))
}

#[cfg(test)]
mod current_plugin_projection_tests {
    use super::*;

    fn runtime(status: &str) -> RuntimeDescriptor {
        RuntimeDescriptor {
            source_commit: task_runtime::DSH_SOURCE_COMMIT.to_string(),
            protocol: task_runtime::DSH_PROTOCOL.to_string(),
            status: status.to_string(),
            runtime_root: Some("F:\\pinned-runtime".to_string()),
            node_version: Some("v22.0.0".to_string()),
            bundle: "scripts/dsh/build-runtime-payload.mjs".to_string(),
            isolation: "one-persistent-worker-per-task".to_string(),
            error: None,
        }
    }

    fn healthy_runtime() -> Value {
        json!({
            "ready": true,
            "initialized": true,
            "sourceCommit": task_runtime::DSH_SOURCE_COMMIT,
            "protocol": task_runtime::DSH_PROTOCOL,
            "providers": [{
                "id": "deepseek-official",
                "name": "DeepSeek",
                "status": "loaded"
            }],
            "models": [{
                "provider": "deepseek-official",
                "id": "deepseek-chat",
                "name": "DeepSeek Chat"
            }],
            "composition": WORKBENCH_COMPOSITION.iter().map(|spec| json!({
                "id": spec.id,
                "status": "loaded"
            })).collect::<Vec<_>>(),
            "tools": {
                "global": [
                    "mcp__novel__novel_read_context_4f9d",
                    "mcp__novel__chapter_read_outline_4f9d",
                    "mcp__novel__get_character_states_4f9d",
                    "mcp__novel__search_memory",
                    "mcp__novel__generate_chapter",
                    "bash"
                ],
                "sessions": []
            }
        })
    }

    #[test]
    fn available_carrier_is_not_reported_loaded_before_runtime_health() {
        let rows =
            build_current_plugin_projection_with(&runtime("available"), None, |_| true, true);
        assert_eq!(rows.len(), WORKBENCH_COMPOSITION.len() + 1);
        assert!(rows.iter().all(|row| row.status == "unavailable"));
        assert!(rows.iter().all(|row| row.availability == "available"));
        assert!(rows
            .iter()
            .all(|row| row.initialization == "not_initialized"));
        assert!(rows.iter().all(|row| row.health == "unknown"));
    }

    #[test]
    fn compatible_health_projects_composition_provider_models_and_scoped_tools() {
        let health = healthy_runtime();
        let rows = build_current_plugin_projection_with(
            &runtime("available"),
            Some(&health),
            |_| true,
            true,
        );
        assert_eq!(
            rows.iter()
                .find(|row| row.id.starts_with("dsh-carrier:"))
                .map(|row| (row.status.as_str(), row.health.as_str())),
            Some(("loaded", "healthy"))
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.id.starts_with("dsh-composition:"))
                .filter(|row| row.status == "loaded" && row.health == "healthy")
                .count(),
            WORKBENCH_COMPOSITION.len()
        );
        assert!(rows
            .iter()
            .any(|row| row.id == "provider:deepseek-official" && row.status == "loaded"));
        assert!(rows.iter().any(|row| {
            row.id == "model:deepseek-official:deepseek-chat"
                && row.status == "loaded"
                && row.health == "unknown"
        }));
        let tool_rows = rows
            .iter()
            .filter(|row| row.category == "function")
            .collect::<Vec<_>>();
        assert_eq!(tool_rows.len(), 5);
        assert!(tool_rows.iter().all(|row| row.status == "loaded"));
        assert!(tool_rows
            .iter()
            .any(|row| row.id == "tool:get_character_states@1"));
        assert!(!rows.iter().any(|row| row.name == "bash"));
    }

    #[test]
    fn model_projection_only_claims_tool_calling_after_exact_attestation() {
        let mut health = healthy_runtime();
        let verified_at = chrono::Utc::now();
        health["modelToolAttestations"] = json!([{
            "protocol": "ans_model_tool_attestation_v1",
            "provider": "deepseek-official",
            "model": "deepseek-chat",
            "verified": true,
            "cached": false,
            "verifiedAt": verified_at.to_rfc3339(),
            "expiresAt": (verified_at + chrono::Duration::minutes(10)).to_rfc3339(),
            "cacheTtlMs": 600000,
            "finishKind": "tool-calls",
            "observedToolCalls": 1
        }]);
        let rows = build_current_plugin_projection_with(
            &runtime("available"),
            Some(&health),
            |_| true,
            true,
        );
        let model = rows
            .iter()
            .find(|row| row.id == "model:deepseek-official:deepseek-chat")
            .expect("model projection");
        assert_eq!(model.health, "healthy");
        assert!(model
            .capabilities
            .iter()
            .any(|value| value == "tool-calling-attested"));
        assert!(model.description.contains("已通过"));
    }

    #[test]
    fn incompatible_health_cannot_upgrade_available_files_to_loaded() {
        let mut health = healthy_runtime();
        health["sourceCommit"] = json!("wrong-commit");
        let rows = build_current_plugin_projection_with(
            &runtime("available"),
            Some(&health),
            |_| true,
            true,
        );
        assert!(rows.iter().all(|row| row.status == "unavailable"));
        assert!(!rows.iter().any(|row| row.category == "model"));
        assert!(!rows.iter().any(|row| row.category == "function"));
    }

    #[test]
    fn missing_composition_file_fails_closed() {
        let rows = build_current_plugin_projection_with(
            &runtime("available"),
            None,
            |spec| spec.id != "sessions",
            true,
        );
        let sessions = rows
            .iter()
            .find(|row| row.id == "dsh-composition:sessions")
            .expect("sessions projection");
        assert_eq!(sessions.status, "failed");
        assert_eq!(sessions.availability, "unavailable");
        assert_eq!(sessions.health, "failed");
    }
}

#[cfg(test)]
mod e2e_tests {
    use super::super::models::ChapterBaselineRevision;
    use super::super::proposal_validator::PROPOSAL_SOURCES;
    use super::*;

    const FIXTURE_TIME: &str = "2026-08-28T00:00:00Z";

    fn seed_preparation_fixture(
        connection: &rusqlite::Connection,
        novel_id: &str,
        chapter_id: &str,
    ) {
        let volume_id = format!("{}-volume", novel_id);
        let character_id = format!("{}-character", novel_id);
        connection
            .execute(
                "INSERT INTO novels (
                    id, title, genre, description, outline, main_character,
                    protagonist_ability, status, current_volume_id, current_chapter_id,
                    target_word_count, created_at, updated_at
                 ) VALUES (?1, 'DSH 隔离测试作品', '悬疑', '仅供真实模型 smoke 的最小事实集',
                    '主角调查港口失踪案，不得虚构工具之外的事实。', '林默', '根据潮汐记录辨认异常',
                    'draft', ?2, ?3, 60000, ?4, ?4)",
                rusqlite::params![novel_id, volume_id, chapter_id, FIXTURE_TIME],
            )
            .expect("seed isolated novel");
        connection
            .execute(
                "INSERT INTO volumes (
                    id, novel_id, title, summary, goal, main_conflict, order_index,
                    status, created_at, updated_at
                 ) VALUES (?1, ?2, '第一卷 潮声', '调查从旧灯塔开始', '确认失踪者留下的线索',
                    '公开调查会惊动幕后人物', 1, 'planned', ?3, ?3)",
                rusqlite::params![volume_id, novel_id, FIXTURE_TIME],
            )
            .expect("seed isolated volume");
        connection
            .execute(
                "INSERT INTO chapters (
                    id, novel_id, volume_id, title, outline, goal, order_index, status,
                    target_word_count, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, '第一章 雾中灯塔',
                    '林默在退潮后进入旧灯塔，找到一页被海水浸过的值班记录。',
                    '取得记录并意识到潮汐时间存在矛盾', 1, 'not_started', 4000, ?4, ?4)",
                rusqlite::params![chapter_id, novel_id, volume_id, FIXTURE_TIME],
            )
            .expect("seed isolated chapter");
        connection
            .execute(
                "INSERT INTO chapter_outlines (
                    id, project_id, chapter_id, chapter_index, title, content, status,
                    version, is_active, source_type, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 1, '雾中灯塔章纲',
                    '进入灯塔；发现值班记录；比较潮汐时间；听见楼上传来脚步声。',
                    'active', 1, 1, 'manual', ?4, ?4)",
                rusqlite::params![
                    format!("{}-outline", chapter_id),
                    novel_id,
                    chapter_id,
                    FIXTURE_TIME
                ],
            )
            .expect("seed isolated outline");
        connection
            .execute(
                "INSERT INTO chapter_engineering_states (
                    id, novel_id, volume_id, chapter_id, chapter_card_json, scene_plan_json,
                    generation_constraints_json, draft_version, active_version, status,
                    created_at, updated_at, activated_at
                 ) VALUES (?1, ?2, ?3, ?4,
                    '{\"goal\":\"取得值班记录\",\"endingHook\":\"楼上传来脚步声\"}',
                    '[{\"title\":\"旧灯塔\",\"purpose\":\"取得线索\"}]',
                    '{\"pov\":\"第三人称限知\",\"doNotInvent\":true}',
                    1, 1, 'active', ?5, ?5, ?5)",
                rusqlite::params![
                    format!("{}-engineering", chapter_id),
                    novel_id,
                    volume_id,
                    chapter_id,
                    FIXTURE_TIME
                ],
            )
            .expect("seed isolated engineering state");
        connection
            .execute(
                "INSERT INTO style_profiles (
                    id, novel_id, name, narrative_perspective, tone, pace, style_summary,
                    is_active, created_at, updated_at
                 ) VALUES (?1, ?2, '克制悬疑', '第三人称限知', '冷静', '中等',
                    '用可验证细节推进悬疑，不提前解释真相。', 1, ?3, ?3)",
                rusqlite::params![format!("{}-style", novel_id), novel_id, FIXTURE_TIME],
            )
            .expect("seed isolated style profile");
        connection
            .execute(
                "INSERT INTO output_profiles (
                    id, novel_id, name, target_word_count, min_word_count, max_word_count,
                    pace_level, ending_hook_required, is_default, created_at, updated_at
                 ) VALUES (?1, ?2, '默认章节输出', 4000, 3200, 4800, 'medium', 1, 1, ?3, ?3)",
                rusqlite::params![format!("{}-output", novel_id), novel_id, FIXTURE_TIME],
            )
            .expect("seed isolated output profile");
        connection
            .execute(
                "INSERT INTO characters (
                    id, novel_id, name, role_type, identity, goals, personality, constraints,
                    current_state, is_protagonist, is_active, created_at, updated_at
                 ) VALUES (?1, ?2, '林默', 'protagonist', '港口档案员', '查明失踪案',
                    '谨慎、重证据', '不能无依据指控他人', '独自进入旧灯塔', 1, 1, ?3, ?3)",
                rusqlite::params![character_id, novel_id, FIXTURE_TIME],
            )
            .expect("seed isolated character");
        connection
            .execute(
                "INSERT INTO protagonists (
                    id, novel_id, name, identity, personality, goal, special_ability,
                    ability_limits, forbidden_behaviors, current_state, created_at, updated_at
                 ) VALUES (?1, ?2, '林默', '港口档案员', '谨慎、重证据', '查明失踪案',
                    '根据潮汐记录辨认异常', '必须取得原始记录', '无依据指控他人',
                    '独自进入旧灯塔', ?3, ?3)",
                rusqlite::params![format!("{}-protagonist", novel_id), novel_id, FIXTURE_TIME],
            )
            .expect("seed isolated protagonist");
        connection
            .execute(
                "INSERT INTO character_states (
                    id, novel_id, character_id, chapter_id, state_summary, location,
                    health_state, knowledge_state, created_at
                 ) VALUES (?1, ?2, ?3, ?4, '刚进入灯塔，尚未取得值班记录', '旧灯塔一层',
                    '正常', '知道失踪案与异常潮汐有关', ?5)",
                rusqlite::params![
                    format!("{}-state", character_id),
                    novel_id,
                    character_id,
                    chapter_id,
                    FIXTURE_TIME
                ],
            )
            .expect("seed isolated character state");
        connection
            .execute(
                "INSERT INTO chapter_characters (
                    id, novel_id, chapter_id, character_id, character_name, role_in_chapter,
                    must_appear, note, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, '林默', 'protagonist', 1,
                    '本章行动必须围绕取得值班记录', ?5, ?5)",
                rusqlite::params![
                    format!("{}-role", character_id),
                    novel_id,
                    chapter_id,
                    character_id,
                    FIXTURE_TIME
                ],
            )
            .expect("seed isolated chapter role");
        connection
            .execute(
                "INSERT INTO chapter_events (
                    id, novel_id, chapter_id, title, description, impact, risk, status,
                    source, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, '发现值班记录', '记录中的潮汐时间与官方表不一致',
                    '调查获得第一个可核验线索', '楼上的未知人物可能夺走记录',
                    'candidate', 'manual', ?4, ?4)",
                rusqlite::params![
                    format!("{}-event", chapter_id),
                    novel_id,
                    chapter_id,
                    FIXTURE_TIME
                ],
            )
            .expect("seed isolated chapter event");
    }

    struct IsolatedGatewayDatabase {
        path: PathBuf,
        previous_override: Option<std::ffi::OsString>,
    }

    impl IsolatedGatewayDatabase {
        fn new(novel_id: &str, chapter_id: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "ans-dsh-real-smoke-{}-{}.db",
                std::process::id(),
                uuid::Uuid::new_v4()
            ));
            let mut connection =
                rusqlite::Connection::open(&path).expect("create isolated DSH smoke database");
            crate::db::create_tables(&mut connection).expect("create isolated DSH smoke schema");
            seed_preparation_fixture(&connection, novel_id, chapter_id);
            drop(connection);
            let previous_override = std::env::var_os("DSH_E2E_GATEWAY_DB_PATH");
            std::env::set_var("DSH_E2E_GATEWAY_DB_PATH", &path);
            Self {
                path,
                previous_override,
            }
        }
    }

    impl Drop for IsolatedGatewayDatabase {
        fn drop(&mut self) {
            if let Some(previous) = self.previous_override.take() {
                std::env::set_var("DSH_E2E_GATEWAY_DB_PATH", previous);
            } else {
                std::env::remove_var("DSH_E2E_GATEWAY_DB_PATH");
            }
            let _ = std::fs::remove_file(&self.path);
        }
    }

    #[test]
    fn real_smoke_fixture_contains_required_planning_facts() {
        let mut connection = rusqlite::Connection::open_in_memory().expect("open fixture database");
        crate::db::create_tables(&mut connection).expect("create fixture schema");
        seed_preparation_fixture(&connection, "fixture-novel", "fixture-chapter");
        let canonical = super::super::baseline_freshness::read_canonical(
            &connection,
            "fixture-novel",
            "fixture-chapter",
        )
        .expect("read fixture baselines");
        assert_eq!(canonical.outline, 1);
        assert_eq!(canonical.chapter_context, 1);
        assert!(canonical.style_profile > 0);
        assert!(canonical.output_control > 0);
        assert!(canonical.character_states > 0);
        assert_eq!(canonical.memory_index, 0);
        let facts: i64 = connection
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM novels WHERE id = 'fixture-novel') +
                    (SELECT COUNT(*) FROM chapters WHERE id = 'fixture-chapter') +
                    (SELECT COUNT(*) FROM characters WHERE novel_id = 'fixture-novel')",
                [],
                |row| row.get(0),
            )
            .expect("count fixture facts");
        assert_eq!(facts, 3);
    }

    #[test]
    #[ignore = "real api + full dsh stack; run explicitly with DSH_RUNTIME_ROOT/DSH_E2E_API_KEY/DSH_GATEWAY_BIN (optional DSH_E2E_BASE_URL/DSH_E2E_MODEL)"]
    fn e2e_prepare_via_local_proxy() {
        let api_key = std::env::var("DSH_E2E_API_KEY").expect("set DSH_E2E_API_KEY");
        let gateway_bin = std::env::var("DSH_GATEWAY_BIN").expect("set DSH_GATEWAY_BIN");
        std::env::set_var("DSH_GATEWAY_BIN", gateway_bin);
        let novel_id = std::env::var("DSH_E2E_NOVEL_ID")
            .unwrap_or_else(|_| "fed8183e-f40f-4b68-8291-fe0f1a4c82b2".to_string());
        let chapter_id = std::env::var("DSH_E2E_CHAPTER_ID")
            .unwrap_or_else(|_| "bbf1d4e6-df6d-470f-b8ea-ba70b71ae67b".to_string());
        crate::db::init_test_database();
        seed_preparation_fixture(
            &crate::db::get_connection().lock().unwrap(),
            &novel_id,
            &chapter_id,
        );
        let _gateway_database = IsolatedGatewayDatabase::new(&novel_id, &chapter_id);
        let canonical = super::super::baseline_freshness::read_canonical(
            &crate::db::get_connection().lock().unwrap(),
            &novel_id,
            &chapter_id,
        )
        .expect("read canonical baselines");
        let input = ChapterPreparationInput {
            novel_id,
            chapter_id,
            baseline_revisions: PROPOSAL_SOURCES
                .iter()
                .map(|source| ChapterBaselineRevision {
                    source: source.to_string(),
                    revision: canonical.revision_of(source),
                })
                .collect(),
        };
        // The default exercises the connected DeepSeek account.  An explicit
        // base URL/model lets the same DSH test drive a loopback OpenAI-
        // compatible model while retaining the exact proxy, tool-call and
        // proposal-validation path.  The API key remains process-only; the
        // model snapshot and test output never contain it.
        let base_url = std::env::var("DSH_E2E_BASE_URL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|value| {
                normalize_loopback_test_base_url(&value)
                    .expect("DSH_E2E_BASE_URL must be a loopback http(s) URL")
            });
        let model = std::env::var("DSH_E2E_MODEL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "deepseek-v4-flash".to_string());
        let logical_provider = if base_url.is_some() {
            "openai_compatible"
        } else {
            "deepseek-official"
        };
        let model_snapshot = json!({
            "providerId": logical_provider,
            "modelId": model.clone(),
            "runtimeMode": "api",
            "baseUrl": base_url.clone(),
            "capabilities": ["conversation_turn", "chapter_generate"],
            "options": { "maxTokens": 12000 },
            "runtime": {
                "adapterProtocol": task_runtime::DSH_PROTOCOL,
                "adapterProvider": logical_provider
            }
        });
        let expected_model_id = format!("model:{logical_provider}:{model}");
        let options = DshPrepareOptions {
            api_key: api_key.clone(),
            base_url: base_url.clone(),
            model: Some(model.clone()),
        };
        let plugins = list_current_plugins_projection(
            Some(task_runtime::PLUGIN_PROBE_CONVERSATION_ID.to_string()),
            Some(model_snapshot),
            Some(api_key),
        )
        .expect("real model Runtime directory probe");
        let directory_summary = plugins
            .iter()
            .map(|row| {
                format!(
                    "{}={}/{}/{}",
                    row.id, row.status, row.initialization, row.health
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        let model_projection = plugins
            .iter()
            .find(|row| row.id == expected_model_id)
            .unwrap_or_else(|| {
                panic!("real model must appear in the Runtime directory: {directory_summary}")
            });
        assert_eq!(model_projection.status, "loaded");
        assert_eq!(model_projection.initialization, "initialized");

        let proposal = prepare(input, options).expect("prepare e2e failed");
        assert_eq!(proposal.schema_version, 1);
        assert_eq!(proposal.planner, "dsh_spike_v0");
        assert!(!proposal.chapter_goals.is_empty());
        assert!(proposal.metrics.prompt_tokens.unwrap_or(0) > 0);
        assert!(proposal.metrics.tool_call_count.unwrap_or(0) > 0);
    }
}

#[cfg(test)]
mod base_url_tests {
    use super::{normalize_loopback_test_base_url, normalize_model_base_url};

    #[test]
    fn normalizes_whitespace_and_trailing_slashes() {
        assert_eq!(
            normalize_model_base_url("  http://127.0.0.1:8080/v1///  ").unwrap(),
            "http://127.0.0.1:8080/v1"
        );
        assert_eq!(
            normalize_model_base_url("https://api.deepseek.com/").unwrap(),
            "https://api.deepseek.com"
        );
    }

    #[test]
    fn rejects_empty_or_non_http_urls() {
        assert!(normalize_model_base_url(" ").is_err());
        assert!(normalize_model_base_url("file:///tmp/model").is_err());
        assert!(normalize_model_base_url("not-a-url").is_err());
        assert!(normalize_model_base_url("https://user:secret@example.com").is_err());
        assert!(normalize_model_base_url("https://example.com/v1?token=secret").is_err());
    }

    #[test]
    fn loopback_test_urls_are_enforced() {
        assert!(normalize_loopback_test_base_url("http://127.0.0.1:8080/v1/").is_ok());
        assert!(normalize_loopback_test_base_url("http://[::1]:8080/v1").is_ok());
        assert!(normalize_loopback_test_base_url("https://example.com/v1").is_err());
    }
}
