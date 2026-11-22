//! Tauri command: `dsh_prepare_chapter` — the DSH planner adapter entry.
//!
//! Drives the out-of-process DSH runtime through the supervisor: initialize,
//! MCP settle, one planning prompt, then up to MAX_REPAIR_TURNS repair turns
//! fed with validation errors. Every parsed output passes the Rust-authoritative
//! validator (enum coercion included); adapter-owned metrics are injected before
//! returning. The runtime tree dies with the handle (Job Object).

#[cfg(test)]
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{async_runtime, Emitter};

use super::config::{RuntimeCompositionSpec, WORKBENCH_COMPOSITION};
use super::ledger::{record_run, summary, PreparationRunRecord, PreparationSummary};
use super::models::{ChapterPreparationInput, ChapterPreparationProposal};
use super::proposal_validator::{self, ValidationReport};
use super::task_runtime::{
    self, RuntimeDescriptor, StartTaskTurnInput, TaskProjectionObserver, TaskRuntimeResult,
    TaskRuntimeStatus, DSH_TASK_PROJECTION_EVENT,
};

#[tauri::command]
pub async fn dsh_start_task_turn(
    window: tauri::WebviewWindow,
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
pub fn dsh_resolve_task_retry(
    conversation_id: String,
    novel_id: String,
    source_run_id: String,
) -> Result<task_runtime::retry::RetryResolution, String> {
    task_runtime::retry::resolve(&conversation_id, &novel_id, &source_run_id)
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

#[path = "commands_tool_projection.rs"]
mod tool_projection;
use tool_projection::canonical_workbench_tool;

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
    build_current_plugin_projection_with(runtime, health, |_| true, true)
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
        Ok(Some(health)) => Ok(build_current_plugin_projection(&runtime, Some(&health))),
        Ok(None) => {
            let catalog_health = task_runtime::native_catalog_only_health();
            Ok(build_current_plugin_projection(&runtime, Some(&catalog_health)))
        }
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
const MAX_REPAIR_TURNS: usize = 3;
const TURN_TIMEOUT: Duration = Duration::from_secs(480);
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

pub(super) fn gateway_database_path() -> PathBuf {
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

fn prepare(
    input: ChapterPreparationInput,
    options: DshPrepareOptions,
) -> Result<ChapterPreparationProposal, String> {
    if options.api_key.trim().is_empty() {
        return Err("apiKey 不能为空（从设置中的 Provider 读取）".to_string());
    }
    verify_baseline_freshness(&input)?;
    let model = options
        .model
        .or_else(|| std::env::var("DSH_MODEL").ok())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let base_url = match options.base_url {
        Some(url) if !url.trim().is_empty() => normalize_model_base_url(&url)?,
        _ => std::env::var("DSH_PROXY_UPSTREAM")
            .unwrap_or_else(|_| "https://api.deepseek.com".to_string()),
    };

    let run_id = uuid::Uuid::new_v4().to_string();
    let run_started = Instant::now();
    let mut failed_prompt_tokens = 0i64;
    let mut failed_completion_tokens = 0i64;
    let result = run_preparation_native(
        &input,
        &base_url,
        &options.api_key,
        &model,
        &mut failed_prompt_tokens,
        &mut failed_completion_tokens,
    );
    let failed_duration_ms = run_started.elapsed().as_millis() as i64;

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
            prompt_tokens: failed_prompt_tokens,
            completion_tokens: failed_completion_tokens,
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

fn run_preparation_native(
    input: &ChapterPreparationInput,
    base_url: &str,
    api_key: &str,
    model: &str,
    total_prompt_tokens: &mut i64,
    total_completion_tokens: &mut i64,
) -> Result<ChapterPreparationProposal, String> {
    use super::native_agent_loop::{run_native_turn, NativeTurnParams};
    use std::sync::atomic::AtomicBool;

    let session_id = format!(
        "prepare-{}-{}-{}",
        input.novel_id,
        input.chapter_id,
        uuid::Uuid::new_v4()
    );
    let started = Instant::now();
    let deadline = started + TURN_TIMEOUT;
    let cancel = AtomicBool::new(false);
    let db_path = gateway_database_path();
    let allowed = "get_metadata,get_chapter_context,get_character_states,search_memory";

    verify_baseline_freshness(input)?;
    let mut current_prompt = planning_prompt(input);
    let mut repair_turns = 0usize;
    let mut total_tool_calls = 0i64;
    let parsed_value: Option<Value>;
    let coercion;

    loop {
        let outcome = run_native_turn(
            NativeTurnParams {
                session_id: &session_id,
                worker_instance_id: &session_id,
                reset_history: repair_turns == 0,
                system_prompt: PERSONA,
                user_prompt: &current_prompt,
                base_url,
                api_key,
                model,
                max_tokens: MAX_TOKENS,
                temperature: None,
                top_p: None,
                reasoning_effort: None,
                request_timeout: Duration::from_secs(120),
                allowed_tools_csv: Some(allowed),
                novel_id: Some(input.novel_id.as_str()),
                chapter_id: Some(input.chapter_id.as_str()),
                candidate_policy: None,
                db_path: &db_path,
                policy: None,
                root: None,
                latest_request_identity: None,
                cancel: &cancel,
                deadline,
            },
            |_| Ok(()),
        )?;
        *total_prompt_tokens =
            total_prompt_tokens.saturating_add(outcome.prompt_tokens as i64);
        *total_completion_tokens =
            total_completion_tokens.saturating_add(outcome.completion_tokens as i64);
        total_tool_calls = total_tool_calls.saturating_add(outcome.tool_call_count as i64);

        let last_errors = match extract_proposal_json_candidates(
            &outcome.last_assistant_text,
            &outcome.last_assistant_reasoning,
            &outcome.assistant_text,
        ) {
            Some(mut value) => {
                let report: ValidationReport = proposal_validator::validate(input, &mut value);
                if report.valid {
                    parsed_value = Some(value);
                    coercion = report.coerced;
                    break;
                }
                if repair_turns >= MAX_REPAIR_TURNS {
                    return Err(format!(
                        "提案校验在 {} 次修复回合后仍失败: {}",
                        repair_turns,
                        report.errors.join(" | ")
                    ));
                }
                report.errors
            }
            None => {
                if repair_turns >= MAX_REPAIR_TURNS {
                    return Err("模型输出不含 JSON 对象且修复回合已耗尽".to_string());
                }
                vec!["模型输出不含 JSON 对象".to_string()]
            }
        };
        verify_baseline_freshness(input)?;
        current_prompt = build_repair_prompt(&last_errors);
        repair_turns += 1;
    }

    let mut value = parsed_value.expect("valid proposal value");
    let duration_ms = started.elapsed().as_millis() as i64;
    value["metrics"] = json!({
        "planner": value["planner"],
        "durationMs": duration_ms,
        "promptTokens": *total_prompt_tokens,
        "completionTokens": *total_completion_tokens,
        "toolCallCount": total_tool_calls,
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
    #[ignore = "real api + native runtime stack; run explicitly with DSH_E2E_API_KEY (optional DSH_E2E_BASE_URL/DSH_E2E_MODEL)"]
    fn e2e_prepare_via_local_proxy() {
        let api_key = std::env::var("DSH_E2E_API_KEY").expect("set DSH_E2E_API_KEY");
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
