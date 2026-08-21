//! Generic ANS task runtime over the pinned DSH headless carrier.
//!
//! The workbench never talks to Cordis objects directly.  This module owns
//! one child process per active conversation, projects the carrier's session
//! telemetry into ANS conversation facts, and keeps cancellation scoped to the
//! owning worker.  The browser fallback lives in TypeScript; the desktop path
//! fails explicitly when the pinned carrier is unavailable.

use super::commands::{spawn_governed_proxy, ProxyGuard};
use super::config::{runtime_root, task_cordis_yml, task_server_script};
use super::governed_proxy::{
    start_policy_server, GovernedProxyPolicy, GovernedProxyPolicyGuard,
    GovernedRequestIdentityReader,
};
use super::launcher::{DshLaunchConfig, DshRuntimeLauncher, NodeDshRuntime};
use super::supervisor::{RuntimeHandle, SessionEventObserver};
use crate::errors::AppError;
use crate::repositories::{draft_repository, large_text_repository};
use crate::services::ai_task_service::{ClaimAiTaskAttemptInput, CreateAiTaskInput};
use crate::services::conversation_service::{
    AppendToolEventInput, CreateArtifactCardInput, CreateRunInput, UpdateRunInput,
    UpdateToolEventInput,
};
use crate::services::{ai_task_service, artifact_service, conversation_service};
use chrono::{TimeZone, Utc};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

pub const DSH_SOURCE_COMMIT: &str = "47f943859bef60e4160492346772ded9b24f765a";
pub const DSH_PROTOCOL: &str = "ans_task_session_v2";
pub const DSH_TASK_PROJECTION_EVENT: &str = "ans://task-runtime-projection";
const ALLOWED_TOOLS: &str =
    "novel.read_context,chapter.read_outline,search_memory,generate_chapter,generate_outline,generate_characters,suggest_events,expand_settings,polish_chapter,check_quality,summarize_chapter";
const CANDIDATE_TOOLS: &str =
    "generate_chapter,generate_outline,generate_characters,suggest_events,expand_settings,polish_chapter,check_quality,summarize_chapter";
pub const PLUGIN_PROBE_CONVERSATION_ID: &str = "__ans_plugin_probe__";

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskProjectionNotice {
    pub conversation_id: String,
    pub run_id: String,
    pub kind: String,
    pub occurred_at: String,
}

pub type TaskProjectionObserver =
    Arc<dyn Fn(TaskProjectionNotice) -> Result<(), String> + Send + Sync>;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StartTaskTurnInput {
    pub conversation_id: String,
    pub novel_id: String,
    pub turn_id: String,
    pub goal: String,
    pub chapter_id: Option<String>,
    pub model_snapshot: Value,
    pub request_policy: TaskRequestPolicyInput,
    #[serde(default)]
    pub api_key: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskRequestPolicyInput {
    pub max_requests_per_minute: i64,
    pub max_concurrent_requests: i64,
    pub daily_token_budget: Option<i64>,
    pub daily_cost_budget_usd: Option<f64>,
    pub warning_percent: i64,
    pub timeout_seconds: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDescriptor {
    pub source_commit: String,
    pub protocol: String,
    pub status: String,
    pub runtime_root: Option<String>,
    pub node_version: Option<String>,
    pub bundle: String,
    pub isolation: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskRuntimeResult {
    pub run: conversation_service::TaskRunRecord,
    pub session_id: String,
    pub agent_id: String,
    pub worker_id: String,
    pub runtime: String,
    pub assistant_text: Option<String>,
    pub artifact_id: Option<String>,
    pub session_lifecycle: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskRuntimeStatus {
    pub conversation_id: String,
    pub run_id: String,
    pub session_id: String,
    pub worker_id: String,
    pub status: String,
    pub runtime: String,
    pub error: Option<String>,
}

struct ActiveWorker {
    run_id: String,
    session_id: String,
    worker_id: String,
    cancel: Arc<AtomicBool>,
    process: Arc<Mutex<Option<Arc<WorkerProcess>>>>,
    projection: Arc<Mutex<Option<ProjectionTarget>>>,
    notifier: Option<TaskProjectionObserver>,
    status: String,
    error: Option<String>,
}

struct WorkerProcess {
    runtime: Arc<RuntimeHandle>,
    identity_hash: String,
    _proxy_guard: ProxyGuard,
    _policy_guard: GovernedProxyPolicyGuard,
}

#[derive(Clone)]
struct ProjectionTarget {
    run_id: String,
    turn_error: Arc<Mutex<Option<String>>>,
    notifier: Option<TaskProjectionObserver>,
    request_identity: GovernedRequestIdentityReader,
}

static ACTIVE: OnceLock<Mutex<HashMap<String, ActiveWorker>>> = OnceLock::new();
static PLUGIN_PROBE: OnceLock<Mutex<Option<Arc<WorkerProcess>>>> = OnceLock::new();

fn active() -> &'static Mutex<HashMap<String, ActiveWorker>> {
    ACTIVE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn plugin_probe() -> &'static Mutex<Option<Arc<WorkerProcess>>> {
    PLUGIN_PROBE.get_or_init(|| Mutex::new(None))
}

fn carrier_files_ready(status: &str) -> bool {
    matches!(status, "available" | "loaded")
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn notify_projection(
    notifier: Option<&TaskProjectionObserver>,
    conversation_id: &str,
    run_id: &str,
    kind: &str,
) -> Result<(), String> {
    let Some(notifier) = notifier else {
        return Ok(());
    };
    notifier(TaskProjectionNotice {
        conversation_id: conversation_id.to_string(),
        run_id: run_id.to_string(),
        kind: kind.to_string(),
        occurred_at: now(),
    })
}

fn required(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{} 不能为空", field))
    } else {
        Ok(())
    }
}

fn safe_runtime_error(error: &str) -> String {
    if crate::services::ai_fact_security::contains_secret_text(error) {
        return "DSH 任务失败，敏感详情未写入运行记录".to_string();
    }
    let mut safe = error.chars().take(512).collect::<String>();
    if error.chars().count() > 512 {
        safe.push('…');
    }
    safe
}

fn contains_credential_key(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.iter().any(|(key, value)| {
            let key = key.to_ascii_lowercase();
            matches!(
                key.as_str(),
                "apikey"
                    | "api_key"
                    | "access_token"
                    | "refresh_token"
                    | "authorization"
                    | "bearer"
                    | "secret"
                    | "password"
                    | "credential"
                    | "credentials"
            ) || contains_credential_key(value)
        }),
        Value::Array(values) => values.iter().any(contains_credential_key),
        _ => false,
    }
}

pub fn describe_runtime() -> RuntimeDescriptor {
    let root = runtime_root();
    if root.is_none() {
        return RuntimeDescriptor {
            source_commit: DSH_SOURCE_COMMIT.to_string(),
            protocol: DSH_PROTOCOL.to_string(),
            status: "unavailable".to_string(),
            runtime_root: None,
            node_version: None,
            bundle: "scripts/dsh/build-runtime-payload.mjs".to_string(),
            isolation: "one-persistent-worker-per-task".to_string(),
            error: Some("未找到固定 DSH 运行时载体".to_string()),
        };
    }
    let root_value = root.clone().unwrap_or_default();
    match NodeDshRuntime::check_node() {
        Ok(node_version) => {
            let matrix = Path::new(&root_value).join("VERSION_MATRIX.json");
            let matrix_commit = std::fs::read_to_string(matrix)
                .ok()
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                .and_then(|value| {
                    value
                        .get("sourceCommit")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                });
            let checkout_usable = Path::new(&root_value)
                .join("packages/examples/jsonrpc-demo/lib/bin.js")
                .is_file()
                && Path::new(&root_value)
                    .join("packages/sdk/protocol/lib/index.js")
                    .is_file()
                && Path::new(&root_value)
                    .join("packages/core/agent/lib/index.js")
                    .is_file();
            let (status, error) = match matrix_commit.as_deref() {
                Some(DSH_SOURCE_COMMIT) => ("available", None),
                Some(_) => (
                    "failed",
                    Some("载体 VERSION_MATRIX.sourceCommit 与固定基线不符".to_string()),
                ),
                None if checkout_usable => ("available", None),
                None => (
                    "failed",
                    Some("固定载体缺少 VERSION_MATRIX.json，且 checkout 布局不完整".to_string()),
                ),
            };
            RuntimeDescriptor {
                source_commit: DSH_SOURCE_COMMIT.to_string(),
                protocol: DSH_PROTOCOL.to_string(),
                status: status.to_string(),
                runtime_root: Some(root_value),
                node_version: Some(node_version),
                bundle: "scripts/dsh/build-runtime-payload.mjs".to_string(),
                isolation: "one-persistent-worker-per-task".to_string(),
                error,
            }
        }
        Err(error) => RuntimeDescriptor {
            source_commit: DSH_SOURCE_COMMIT.to_string(),
            protocol: DSH_PROTOCOL.to_string(),
            status: "failed".to_string(),
            runtime_root: Some(root_value),
            node_version: None,
            bundle: "scripts/dsh/build-runtime-payload.mjs".to_string(),
            isolation: "one-persistent-worker-per-task".to_string(),
            error: Some(error),
        },
    }
}

fn update_active(conversation_id: &str, status: &str, error: Option<String>) {
    if let Ok(mut workers) = active().lock() {
        if let Some(worker) = workers.get_mut(conversation_id) {
            worker.status = status.to_string();
            worker.error = error;
        }
    }
}

fn event_time(event: &Value) -> String {
    event
        .get("time")
        .and_then(Value::as_i64)
        .and_then(|value| Utc.timestamp_millis_opt(value).single())
        .map(|value| value.to_rfc3339())
        .unwrap_or_else(now)
}

fn stable_projection_id(prefix: &str, run_id: &str, identity: &str) -> String {
    let hash = large_text_repository::sha256(&format!("{}|{}", run_id, identity));
    format!("{}-{}", prefix, &hash[..32])
}

fn normalize_tool_name(name: &str) -> String {
    let name = name
        .strip_prefix("mcp__novel__")
        .or_else(|| name.strip_prefix("novel__"))
        .unwrap_or(name);
    if name == "get_metadata"
        || name == "novel.read_context"
        || name.starts_with("novel_read_context_")
    {
        return "novel.read_context".to_string();
    }
    if name == "get_chapter_context"
        || name == "chapter.read_outline"
        || name.starts_with("chapter_read_outline_")
    {
        return "chapter.read_outline".to_string();
    }
    if name == "search_memory" || name.starts_with("search_memory_") {
        return "search_memory".to_string();
    }
    if name == "generate_chapter" || name.starts_with("generate_chapter_") {
        return "generate_chapter".to_string();
    }
    for tool in CANDIDATE_TOOLS.split(',') {
        if name == tool || name.starts_with(&format!("{tool}_")) {
            return tool.to_string();
        }
    }
    name.to_string()
}

fn tool_projection_metadata(
    name: &str,
) -> (&'static str, &'static str, &'static str, &'static str) {
    match name {
        "novel.read_context" | "search_memory" | "generate_outline" | "expand_settings" => {
            ("1", "novel", "none", "never")
        }
        "chapter.read_outline"
        | "generate_chapter"
        | "generate_characters"
        | "suggest_events"
        | "polish_chapter"
        | "check_quality"
        | "summarize_chapter" => ("1", "chapter", "none", "never"),
        _ => ("unknown", "runtime", "none", "never"),
    }
}

fn assistant_text(event: &Value) -> String {
    event
        .pointer("/data/message/content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<String>()
}

fn tool_result_text(event: &Value) -> String {
    event
        .pointer("/data/message/content/0/content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<String>()
}

fn append_generic_projection(
    connection: &mut rusqlite::Connection,
    run_id: &str,
    event: &Value,
    event_type: &str,
    error: Option<String>,
) -> Result<(), AppError> {
    let sequence = event.get("seq").and_then(Value::as_i64).unwrap_or(-1);
    let call_id = format!("event:{}:{}", sequence, event_type);
    let event_id = stable_projection_id("dsh-event", run_id, &call_id);
    if conversation_service::get_tool_event_by_call_id(connection, run_id, &call_id)?.is_some() {
        return Ok(());
    }
    let created_at = event_time(event);
    let record = conversation_service::append_tool_event(
        connection,
        AppendToolEventInput {
            event_id: event_id.clone(),
            run_id: run_id.to_string(),
            tool_name: format!("dsh.{}", event_type.replace('/', ".")),
            arguments_summary: json!({
                "source":"dsh-session.event",
                "callId":call_id,
                "eventType":event_type,
                "dshSequence":sequence
            }),
            status: "queued".to_string(),
            duration_ms: None,
            error: None,
            result: None,
            created_at,
            finished_at: None,
        },
    )?;
    let _ = conversation_service::update_tool_event(
        connection,
        UpdateToolEventInput {
            event_id: record.event_id.clone(),
            status: "running".to_string(),
            duration_ms: None,
            error: None,
            result: None,
            finished_at: None,
        },
    )?;
    let finished_at = event_time(event);
    let _ = conversation_service::update_tool_event(
        connection,
        UpdateToolEventInput {
            event_id,
            status: if error.is_some() {
                "failed"
            } else {
                "succeeded"
            }
            .to_string(),
            duration_ms: Some(0),
            error,
            result: Some(json!({"eventType":event_type,"dshSequence":sequence})),
            finished_at: Some(finished_at),
        },
    )?;
    Ok(())
}

fn project_session_event(
    notification: &Value,
    expected_session_id: &str,
    conversation_id: &str,
    run_id: &str,
    turn_error: &Arc<Mutex<Option<String>>>,
    notifier: Option<&TaskProjectionObserver>,
    request_identity: &GovernedRequestIdentityReader,
) -> Result<(), String> {
    if notification
        .pointer("/params/sessionId")
        .and_then(Value::as_str)
        != Some(expected_session_id)
    {
        return Ok(());
    }
    let event = notification
        .pointer("/params/event")
        .ok_or_else(|| "session.event 缺少 event".to_string())?;
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| "session.event 缺少 type".to_string())?;
    let sequence = event.get("seq").and_then(Value::as_i64).unwrap_or(-1);
    let mut connection = crate::db::get_connection()
        .lock()
        .map_err(|_| "session.event 数据库锁失败".to_string())?;
    let projection_kind = match event_type {
        "tool/call" => {
            let call_id = event
                .pointer("/data/callId")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "tool/call 缺少 callId".to_string())?;
            if conversation_service::get_tool_event_by_call_id(&connection, run_id, call_id)
                .map_err(|error| error.to_string())?
                .is_some()
            {
                return Ok(());
            }
            let raw_name = event
                .pointer("/data/name")
                .and_then(Value::as_str)
                .ok_or_else(|| "tool/call 缺少 name".to_string())?;
            let tool_name = normalize_tool_name(raw_name);
            if !ALLOWED_TOOLS.split(',').any(|allowed| allowed == tool_name) {
                return Err(format!("DSH 调用了未授权工具: {}", tool_name));
            }
            let arguments = event
                .pointer("/data/arguments")
                .and_then(Value::as_str)
                .unwrap_or("");
            let (tool_version, scope, side_effect, confirmation_policy) =
                tool_projection_metadata(&tool_name);
            let parsed_arguments = serde_json::from_str::<Value>(arguments).ok();
            let novel_id_hash = parsed_arguments
                .as_ref()
                .and_then(|value| value.get("novelId"))
                .and_then(Value::as_str)
                .map(large_text_repository::sha256);
            let chapter_id_hash = parsed_arguments
                .as_ref()
                .and_then(|value| value.get("chapterId"))
                .and_then(Value::as_str)
                .map(large_text_repository::sha256);
            let governed_identity = request_identity
                .lock()
                .ok()
                .and_then(|identity| identity.clone());
            let event_id = stable_projection_id("dsh-tool", run_id, call_id);
            let created_at = event_time(event);
            let record = conversation_service::append_tool_event(
                &mut connection,
                AppendToolEventInput {
                    event_id: event_id.clone(),
                    run_id: run_id.to_string(),
                    tool_name,
                    arguments_summary: json!({
                        "source":"dsh-session.event",
                        "callId":call_id,
                        "dshSequence":sequence,
                        "argumentsBytes":arguments.len(),
                        "argumentsHash":large_text_repository::sha256(arguments),
                        "toolVersion":tool_version,
                        "scope":scope,
                        "sideEffect":side_effect,
                        "confirmationPolicy":confirmation_policy,
                        "novelIdHash":novel_id_hash,
                        "chapterIdHash":chapter_id_hash,
                        "governedProviderRequestId":governed_identity.as_ref().map(|value| value.provider_request_id.as_str()),
                        "governedReservationId":governed_identity.as_ref().map(|value| value.reservation_id.as_str())
                    }),
                    status: "queued".to_string(),
                    duration_ms: None,
                    error: None,
                    result: None,
                    created_at,
                    finished_at: None,
                },
            )
            .map_err(|error| error.to_string())?;
            conversation_service::update_tool_event(
                &mut connection,
                UpdateToolEventInput {
                    event_id: record.event_id,
                    status: "running".to_string(),
                    duration_ms: None,
                    error: None,
                    result: None,
                    finished_at: None,
                },
            )
            .map_err(|error| error.to_string())?;
            Some("tool")
        }
        "tool/result" => {
            let call_id = event
                .pointer("/data/message/source/callId")
                .or_else(|| event.pointer("/data/message/content/0/toolCallId"))
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "tool/result 缺少 callId".to_string())?;
            let record =
                conversation_service::get_tool_event_by_call_id(&connection, run_id, call_id)
                    .map_err(|error| error.to_string())?
                    .ok_or_else(|| format!("tool/result 找不到对应调用: {}", call_id))?;
            if matches!(
                record.status.as_str(),
                "succeeded" | "failed" | "cancelled" | "skipped"
            ) {
                return Ok(());
            }
            let content = tool_result_text(event);
            let is_error = event
                .pointer("/data/message/content/0/isError")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || event.pointer("/data/error").is_some();
            let error_code = event
                .pointer("/data/error/code")
                .and_then(Value::as_str)
                .unwrap_or(if is_error { "DSH_TOOL_FAILED" } else { "" });
            let mut result = json!({
                "callId":call_id,
                "dshSequence":sequence,
                "contentChars":content.chars().count(),
                "contentHash":large_text_repository::sha256(&content),
                "isError":is_error,
                "structuredJson":serde_json::from_str::<Value>(&content).is_ok()
            });
            if !content.is_empty() {
                let document_id = format!("{}-result", record.event_id);
                let exists: bool = connection
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM large_text_documents WHERE id=?1)",
                        rusqlite::params![document_id],
                        |row| row.get(0),
                    )
                    .map_err(|error| error.to_string())?;
                if !exists {
                    large_text_repository::insert_document_for_target(
                        &connection,
                        &document_id,
                        "tool_event",
                        &record.event_id,
                        "result",
                        None,
                        &content,
                        &large_text_repository::sha256(&content),
                        &event_time(event),
                    )
                    .map_err(|error| error.to_string())?;
                }
                result["largeTextRefId"] = Value::String(document_id);
            }
            let duration_ms = chrono::DateTime::parse_from_rfc3339(&record.created_at)
                .ok()
                .map(|started| {
                    (Utc::now() - started.with_timezone(&Utc))
                        .num_milliseconds()
                        .max(0)
                });
            conversation_service::update_tool_event(
                &mut connection,
                UpdateToolEventInput {
                    event_id: record.event_id,
                    status: if is_error { "failed" } else { "succeeded" }.to_string(),
                    duration_ms,
                    error: is_error.then(|| error_code.to_string()),
                    result: Some(result),
                    finished_at: Some(event_time(event)),
                },
            )
            .map_err(|error| error.to_string())?;
            Some("tool")
        }
        "assistant/message" => {
            let content = assistant_text(event);
            if !content.trim().is_empty() {
                let turn_id =
                    stable_projection_id("dsh-message", run_id, &format!("assistant:{}", sequence));
                conversation_service::append_runtime_assistant_turn(
                    &mut connection,
                    &turn_id,
                    conversation_id,
                    run_id,
                    &content,
                    &event_time(event),
                )
                .map_err(|error| error.to_string())?;
            }
            Some("assistant")
        }
        "turn/end" => {
            if event.pointer("/data/reason/kind").and_then(Value::as_str) == Some("error") {
                let code = event
                    .pointer("/data/reason/error/code")
                    .and_then(Value::as_str)
                    .unwrap_or("DSH_TURN_FAILED");
                *turn_error
                    .lock()
                    .map_err(|_| "DSH 回合错误状态锁失败".to_string())? = Some(code.to_string());
                append_generic_projection(
                    &mut connection,
                    run_id,
                    event,
                    event_type,
                    Some(code.to_string()),
                )
                .map_err(|error| error.to_string())?;
            }
            (event.pointer("/data/reason/kind").and_then(Value::as_str) == Some("error"))
                .then_some("tool")
        }
        "turn/start"
        | "step/start"
        | "step/end"
        | "user/message"
        | "assistant/chunk"
        | "agent/inbox/spliced"
        | "request/header"
        | "request/context" => None,
        _ => {
            append_generic_projection(&mut connection, run_id, event, event_type, None)
                .map_err(|error| error.to_string())?;
            Some("tool")
        }
    };
    drop(connection);
    if let Some(kind) = projection_kind {
        notify_projection(notifier, conversation_id, run_id, kind)?;
    }
    Ok(())
}

struct GeneratedChapterResult {
    text: String,
    structured: Value,
    provider_request_id: String,
    reservation_id: Option<String>,
}

struct ChapterBaseSnapshot {
    chapter_revision: String,
    draft_id: Option<String>,
    draft_version: Option<i64>,
    content_hash: Option<String>,
}

fn read_chapter_base_snapshot(
    connection: &rusqlite::Connection,
    novel_id: &str,
    chapter_id: &str,
) -> Result<ChapterBaseSnapshot, AppError> {
    let (adopted_draft_id, chapter_revision) = connection
        .query_row(
            "SELECT adopted_draft_id, updated_at FROM chapters
             WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL",
            rusqlite::params![chapter_id, novel_id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| {
            AppError::new(
                "DSH_CHAPTER_TARGET_NOT_FOUND",
                "章节候选的目标章节不存在或不属于当前作品",
                false,
            )
        })?;
    let Some(draft_id) = adopted_draft_id else {
        return Ok(ChapterBaseSnapshot {
            chapter_revision,
            draft_id: None,
            draft_version: None,
            content_hash: None,
        });
    };
    let draft = draft_repository::find_draft(connection, &draft_id)?.ok_or_else(|| {
        AppError::new(
            "DSH_CHAPTER_BASE_DRAFT_NOT_FOUND",
            "章节采用草稿引用不存在",
            false,
        )
    })?;
    if draft.novel_id != novel_id || draft.chapter_id != chapter_id || !draft.is_adopted {
        return Err(AppError::new(
            "DSH_CHAPTER_BASE_DRAFT_INVALID",
            "章节采用草稿的作品、章节或采用状态无效",
            false,
        ));
    }
    let content_hash = if let Some(document_id) = draft.large_text_ref_id.as_deref() {
        large_text_repository::read_verified_for_draft(
            connection,
            document_id,
            &draft.id,
            &draft.chapter_id,
        )?
        .content_hash
    } else {
        large_text_repository::sha256(&draft.content)
    };
    if draft
        .content_hash
        .as_deref()
        .is_some_and(|expected| !expected.eq_ignore_ascii_case(&content_hash))
    {
        return Err(AppError::new(
            "DSH_CHAPTER_BASE_HASH_MISMATCH",
            "章节采用草稿完整性校验失败",
            false,
        ));
    }
    Ok(ChapterBaseSnapshot {
        chapter_revision,
        draft_id: Some(draft.id),
        draft_version: Some(draft.version_no),
        content_hash: Some(content_hash),
    })
}

fn read_generated_chapter_result(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
    run_id: &str,
) -> Result<Option<GeneratedChapterResult>, AppError> {
    let tool_projection = connection
        .query_row(
            "SELECT result_json, arguments_summary_json FROM tool_call_events
             WHERE run_id=?1 AND status='succeeded'
               AND instr(',' || ?2 || ',', ',' || tool_name || ',') > 0
             ORDER BY sequence DESC LIMIT 1",
            rusqlite::params![run_id, CANDIDATE_TOOLS],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(AppError::database)?;
    let Some((Some(result_json), arguments_summary_json)) = tool_projection else {
        return Ok(None);
    };
    let arguments_summary: Value = serde_json::from_str(&arguments_summary_json)
        .map_err(|error| AppError::new("DSH_TOOL_ARGUMENTS_INVALID", error.to_string(), false))?;
    let provider_request_id = arguments_summary
        .get("governedProviderRequestId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AppError::new(
                "DSH_PROVIDER_REQUEST_ID_REQUIRED",
                "generate_chapter 缺少实际治理请求身份",
                false,
            )
        })?;
    let summary: Value = serde_json::from_str(&result_json)
        .map_err(|error| AppError::new("DSH_TOOL_RESULT_INVALID", error.to_string(), false))?;
    let document_id = summary
        .get("largeTextRefId")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::new(
                "DSH_TOOL_RESULT_REFERENCE_REQUIRED",
                "generate_chapter 结果缺少大文本引用",
                false,
            )
        })?;
    let verified = large_text_repository::read_verified_document(connection, document_id)?;
    if summary.get("contentHash").and_then(Value::as_str) != Some(verified.content_hash.as_str()) {
        return Err(AppError::new(
            "DSH_TOOL_RESULT_HASH_MISMATCH",
            "generate_chapter 结果引用哈希不一致",
            false,
        ));
    }
    let structured: Value = serde_json::from_str(&verified.content).map_err(|_| {
        AppError::new(
            "DSH_TOOL_RESULT_INVALID",
            "generate_chapter 结果不是合法 JSON",
            false,
        )
    })?;
    let artifact_type = structured
        .get("artifactType")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let requires_chapter = matches!(
        artifact_type,
        "chapter_text" | "quality_report" | "chapter_summary" | "event_candidates"
    );
    let chapter_id = input.chapter_id.as_deref();
    if requires_chapter && chapter_id.is_none() {
        return Err(AppError::new(
            "DSH_CHAPTER_TARGET_REQUIRED",
            "该候选工具必须绑定目标章节",
            false,
        ));
    }
    let valid_scope = structured.get("ok").and_then(Value::as_bool) == Some(true)
        && structured.get("candidateOnly").and_then(Value::as_bool) == Some(true)
        && CANDIDATE_TOOLS.split(',').any(|tool| {
            matches!(
                (tool, artifact_type),
                ("generate_chapter" | "polish_chapter", "chapter_text")
                    | ("generate_outline", "outline")
                    | ("generate_characters", "character_candidates")
                    | ("suggest_events", "event_candidates")
                    | ("expand_settings", "setting_candidates")
                    | ("check_quality", "quality_report")
                    | ("summarize_chapter", "chapter_summary")
            )
        })
        && structured.pointer("/data/novelId").and_then(Value::as_str)
            == Some(input.novel_id.as_str())
        && (!requires_chapter
            || structured
                .pointer("/data/chapterId")
                .and_then(Value::as_str)
                == chapter_id);
    let text = structured
        .pointer("/data/text")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty());
    if !valid_scope || text.is_none() {
        return Err(AppError::new(
            "DSH_GENERATED_CHAPTER_SCOPE_INVALID",
            "generate_chapter 结果契约或作品/章节归属无效",
            false,
        ));
    }
    Ok(Some(GeneratedChapterResult {
        text: text.unwrap_or_default().to_string(),
        structured,
        provider_request_id: provider_request_id.to_string(),
        reservation_id: arguments_summary
            .get("governedReservationId")
            .and_then(Value::as_str)
            .map(str::to_string),
    }))
}

fn create_artifact_projection(
    connection: &mut rusqlite::Connection,
    input: &StartTaskTurnInput,
    run_id: &str,
    generated: &GeneratedChapterResult,
    prompt_tokens: u64,
    completion_tokens: u64,
) -> Result<Option<String>, AppError> {
    let artifact_type = generated
        .structured
        .get("artifactType")
        .and_then(Value::as_str)
        .unwrap_or("chapter_text");
    let chapter_id = input.chapter_id.as_deref();
    let base = if let Some(chapter_id) = chapter_id {
        read_chapter_base_snapshot(connection, &input.novel_id, chapter_id)?
    } else {
        ChapterBaseSnapshot {
            chapter_revision: now(),
            draft_id: None,
            draft_version: None,
            content_hash: None,
        }
    };
    let operation_id = format!("workbench-{}", run_id);
    let prompt_body = "你是 AI Novel Studio 的小说任务执行 Agent。只生成候选，不写入正式事实。";
    let body = serde_json::to_string(&json!({"messages":[{"role":"user","content":input.goal}]}))
        .map_err(|error| AppError::new("TASK_RUNTIME_JSON", error.to_string(), false))?;
    let create = CreateAiTaskInput {
        operation_id,
        request_hash_version: None,
        request_hash: None,
        trace_id: None,
        task_type: match artifact_type {
            "outline" => "outline_generate",
            "character_candidates" => "character_generate",
            "event_candidates" => "event_suggest",
            "setting_candidates" => "setting_expand",
            "quality_report" => "quality_check",
            "chapter_summary" => "chapter_summary",
            _ => "chapter_generate",
        }
        .to_string(),
        novel_id: input.novel_id.clone(),
        chapter_id: chapter_id.map(str::to_string),
        draft_id: base.draft_id.clone(),
        scope_type: if base.draft_id.is_some() {
            "draft"
        } else if chapter_id.is_some() {
            "chapter"
        } else {
            "novel"
        }
        .to_string(),
        expected_artifact_type: artifact_type.to_string(),
        expected_artifact_schema_version: 1,
        target_hint_json: Some(json!({
            "conversationId": input.conversation_id,
            "turnId": input.turn_id,
            "runId": run_id,
            "modelSnapshot": input.model_snapshot,
            "baseChapterRevision":base.chapter_revision,
            "baseDraftId":base.draft_id,
            "baseDraftVersion":base.draft_version,
            "baseContentHash":base.content_hash
        })),
        input_snapshot: ai_task_service::InputSnapshotInput {
            schema_version: 1,
            input_type: "workbench_dsh_messages_v1".to_string(),
            payload_json: json!({"goal": input.goal, "conversationId": input.conversation_id}),
            body,
            source_draft_id: base.draft_id.clone(),
            source_draft_version: base.draft_version,
            base_content_hash: base.content_hash.clone(),
        },
        context_snapshot: ai_task_service::ContextSnapshotInput {
            schema_version: 1,
            source_manifest_json: json!({"contractVersion":"workbench_dsh_context_v1","sources":[]}),
            compiled_context: String::new(),
            budget_json: json!({"maxChars":0,"compiledContextChars":0,"compiledContextBytes":0,"includedSourceCount":0,"truncatedSourceCount":0,"omittedSourceCount":0}),
            compiler_version: "workbench_dsh_v1".to_string(),
        },
        constraint_snapshot: ai_task_service::ConstraintSnapshotInput {
            schema_version: 1,
            payload_json: json!({"candidateOnly":true,"mayWriteBusinessData":false}),
            prompt_template_id: format!("workbench/{artifact_type}"),
            prompt_template_version: "1".to_string(),
            prompt_template_hash: large_text_repository::sha256(prompt_body),
            prompt_template_body: prompt_body.to_string(),
            provider_options_json: input
                .model_snapshot
                .get("options")
                .filter(|value| value.is_object())
                .cloned()
                .unwrap_or_else(|| json!({})),
        },
    };
    let task = ai_task_service::create_task(connection, create)?;
    let queued = ai_task_service::queue_attempt(connection, &task.task_id)?;
    let attempt = ai_task_service::claim_attempt(
        connection,
        ClaimAiTaskAttemptInput {
            task_id: task.task_id.clone(),
            attempt_id: queued.attempt.attempt_id.clone(),
            provider_id: input
                .model_snapshot
                .get("providerId")
                .and_then(Value::as_str)
                .unwrap_or("dsh")
                .to_string(),
            model_id: input
                .model_snapshot
                .get("modelId")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string(),
            provider_request_id: Some(generated.provider_request_id.clone()),
        },
    )?;
    let response_hash = large_text_repository::sha256(&generated.text);
    ai_task_service::mark_provider_succeeded(
        connection,
        &task.task_id,
        &attempt.attempt.attempt_id,
        json!({
            "provider":input.model_snapshot.get("providerId").and_then(Value::as_str).unwrap_or("dsh"),
            "model":input.model_snapshot.get("modelId").and_then(Value::as_str).unwrap_or("unknown"),
            "providerRequestId":generated.provider_request_id.as_str(),
            "governedReservationId":generated.reservation_id.as_deref(),
            "responseHash":response_hash,
            "responseLength":generated.text.chars().count(),
            "tokenInput":prompt_tokens,
            "tokenOutput":completion_tokens,
            "tokenTotal":prompt_tokens.saturating_add(completion_tokens),
            "finishReason":"tool_result",
            "durationMs":0
        }),
    )?;
    let artifact = artifact_service::create_artifact(
        connection,
        artifact_service::CreateResultArtifactInput {
            task_id: task.task_id,
            attempt_id: attempt.attempt.attempt_id,
            artifact_type: artifact_type.to_string(),
            schema_version: 1,
            raw_content: generated.text.clone(),
            display_content: None,
            structured_payload_json: Some(generated.structured.clone()),
            parent_artifact_id: None,
            derivation_type: None,
        },
    )?;
    let card = conversation_service::create_artifact_card(
        connection,
        CreateArtifactCardInput {
            card_id: uuid::Uuid::new_v4().to_string(),
            conversation_id: input.conversation_id.clone(),
            turn_id: Some(input.turn_id.clone()),
            run_id: Some(run_id.to_string()),
            artifact_id: Some(artifact.artifact.artifact_id.clone()),
            artifact_type: artifact_type.to_string(),
            title: match artifact_type {
                "outline" => "大纲候选",
                "character_candidates" => "角色候选",
                "event_candidates" => "事件候选",
                "setting_candidates" => "设定候选",
                "quality_report" => "质量报告",
                "chapter_summary" => "章节总结候选",
                _ => "章节候选",
            }
            .to_string(),
            summary: "候选已通过 ResultArtifact 校验，需在对话中确认后才会写入正式事实。"
                .to_string(),
            content: None,
            status: "candidate".to_string(),
            created_at: now(),
        },
    )?;
    Ok(card.artifact_id)
}

fn worker_root() -> PathBuf {
    std::env::var("ANS_TASK_WORKER_ROOT")
        .ok()
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| crate::db::get_data_dir().join("dsh-task-workers"))
}

fn worker_directory(conversation_id: &str) -> PathBuf {
    let digest = large_text_repository::sha256(conversation_id);
    worker_root().join(&digest[..32])
}

fn provider_transport(input: &StartTaskTurnInput) -> Result<(String, String, String), String> {
    let upstream = input
        .model_snapshot
        .get("baseUrl")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .or_else(|| std::env::var("DSH_PROXY_UPSTREAM").ok())
        .unwrap_or_else(|| "https://api.deepseek.com".to_string());
    let upstream_key = if input.api_key.trim().is_empty() {
        if input
            .model_snapshot
            .get("baseUrl")
            .and_then(Value::as_str)
            .is_some()
        {
            "local-no-key-required".to_string()
        } else {
            return Err("DSH 任务需要 Provider API Key；不会静默降级到前端流水线".to_string());
        }
    } else {
        input.api_key.clone()
    };
    let identity = serde_json::to_string(&json!({
        "upstream":upstream,
        "credentialHash":large_text_repository::sha256(&upstream_key),
        "policy":input.request_policy,
        "pricing":input.model_snapshot.get("pricing"),
        "sourceCommit":DSH_SOURCE_COMMIT,
        "protocol":DSH_PROTOCOL
    }))
    .map_err(|error| error.to_string())?;
    Ok((
        upstream,
        upstream_key,
        large_text_repository::sha256(&identity),
    ))
}

fn harness_adapter_provider(input: &StartTaskTurnInput) -> Result<&str, String> {
    let provider = input
        .model_snapshot
        .pointer("/runtime/adapterProvider")
        .and_then(Value::as_str)
        .unwrap_or("deepseek-official");
    if provider != "deepseek-official" {
        return Err(format!(
            "冻结模型快照的 Harness adapterProvider 不可用: {}",
            provider
        ));
    }
    Ok(provider)
}

fn spawn_worker_process(
    input: &StartTaskTurnInput,
    descriptor: &RuntimeDescriptor,
    worker_id: &str,
    session_id: &str,
    identity_hash: String,
    upstream: &str,
    upstream_key: &str,
    projection: Arc<Mutex<Option<ProjectionTarget>>>,
) -> Result<Arc<WorkerProcess>, String> {
    let root = descriptor
        .runtime_root
        .clone()
        .ok_or_else(|| "DSH runtime root missing".to_string())?;
    let runtime_bin = NodeDshRuntime::runtime_bin(&root)?;
    let gateway_bin = super::commands::resolve_gateway_bin()?;
    let work = worker_directory(&input.conversation_id);
    std::fs::create_dir_all(&work).map_err(|error| error.to_string())?;
    let db_path = crate::db::get_database_path().to_string_lossy().to_string();
    let server_path = work.join("ans-task-server.mjs");
    std::fs::write(
        &server_path,
        task_server_script(&root, DSH_SOURCE_COMMIT, DSH_PROTOCOL),
    )
    .map_err(|error| error.to_string())?;
    let cordis_path = work.join("cordis.yml");
    std::fs::write(
        &cordis_path,
        task_cordis_yml(&root, &gateway_bin, &db_path, &server_path),
    )
    .map_err(|error| error.to_string())?;

    let pricing = input.model_snapshot.get("pricing");
    let owner_hash = large_text_repository::sha256(&input.conversation_id);
    let policy_guard = start_policy_server(GovernedProxyPolicy {
        owner_id: format!("dsh-workbench:{}", &owner_hash[..32]),
        max_requests_per_minute: input.request_policy.max_requests_per_minute,
        max_concurrent_requests: input.request_policy.max_concurrent_requests,
        daily_token_budget: input.request_policy.daily_token_budget,
        daily_cost_budget_usd: input.request_policy.daily_cost_budget_usd,
        input_price_per_million_tokens: pricing
            .and_then(|value| value.get("inputPricePerMillionTokens"))
            .and_then(Value::as_f64),
        output_price_per_million_tokens: pricing
            .and_then(|value| value.get("outputPricePerMillionTokens"))
            .and_then(Value::as_f64),
        warning_percent: input.request_policy.warning_percent,
        ttl_ms: (input.request_policy.timeout_seconds.max(1) * 1_000 + 60_000)
            .clamp(60_000, 2 * 60 * 60_000),
    })?;
    let (proxy_guard, base_url) = spawn_governed_proxy(
        &work,
        upstream_key,
        upstream,
        &policy_guard.url(),
        &format!("dsh:{}", &owner_hash[..32]),
        input.request_policy.timeout_seconds.max(1) * 1_000,
    )?;
    let config = DshLaunchConfig {
        runtime_bin: PathBuf::from(runtime_bin),
        cordis_config: cordis_path,
        session_root: work.join("sessions"),
        home: work.join("home"),
        api_key: "local-proxy".to_string(),
        base_url,
        system_prompt: "你是 AI Novel Studio 的小说任务执行 Agent。只使用任务 allowlist 中的工具。根据用户目标自主决定读取上下文、读取章节大纲、检索记忆和生成章节候选；所有候选只用于人工审阅，不得修改正式小说事实。回复中文，不展示隐藏推理。".to_string(),
        cwd: work,
        allowed_tools: Some(ALLOWED_TOOLS.to_string()),
    };
    let child = NodeDshRuntime
        .launch(&config)
        .map_err(|error| format!("DSH Worker {} 启动失败: {}", worker_id, error))?;
    let observer: SessionEventObserver = {
        let session_id = session_id.to_string();
        let conversation_id = input.conversation_id.clone();
        Arc::new(move |notification| {
            let target = projection
                .lock()
                .map_err(|_| "DSH 事件投影锁失败".to_string())?
                .clone();
            let Some(target) = target else {
                return Ok(());
            };
            project_session_event(
                notification,
                &session_id,
                &conversation_id,
                &target.run_id,
                &target.turn_error,
                target.notifier.as_ref(),
                &target.request_identity,
            )
        })
    };
    let runtime = Arc::new(
        RuntimeHandle::new_with_observer(child, Some(observer))
            .map_err(|error| error.to_string())?,
    );
    Ok(Arc::new(WorkerProcess {
        runtime,
        identity_hash,
        _proxy_guard: proxy_guard,
        _policy_guard: policy_guard,
    }))
}

fn ensure_worker_process(
    input: &StartTaskTurnInput,
    worker_id: &str,
    session_id: &str,
    process_holder: &Arc<Mutex<Option<Arc<WorkerProcess>>>>,
    projection: Arc<Mutex<Option<ProjectionTarget>>>,
) -> Result<Arc<WorkerProcess>, String> {
    let descriptor = describe_runtime();
    if !carrier_files_ready(&descriptor.status) {
        return Err(descriptor
            .error
            .unwrap_or_else(|| "DSH 运行时不可用".to_string()));
    }
    let (upstream, upstream_key, identity_hash) = provider_transport(input)?;
    let mut holder = process_holder
        .lock()
        .map_err(|_| "Worker 进程锁失败".to_string())?;
    if let Some(existing) = holder.as_ref() {
        let healthy = existing.identity_hash == identity_hash
            && existing
                .runtime
                .request("runtime/health", None, Duration::from_secs(3))
                .ok()
                .and_then(|health| health.get("sourceCommit").cloned())
                .and_then(|value| value.as_str().map(str::to_string))
                .as_deref()
                == Some(DSH_SOURCE_COMMIT);
        if healthy {
            return Ok(existing.clone());
        }
        let previous = holder.take().expect("existing worker process");
        let _ = previous.runtime.shutdown_and_wait(Duration::from_secs(10));
    }
    let process = spawn_worker_process(
        input,
        &descriptor,
        worker_id,
        session_id,
        identity_hash,
        &upstream,
        &upstream_key,
        projection,
    )?;
    *holder = Some(process.clone());
    Ok(process)
}

fn execute(
    input: StartTaskTurnInput,
    run_id: String,
    worker_id: String,
    session_id: String,
    process_holder: Arc<Mutex<Option<Arc<WorkerProcess>>>>,
    projection: Arc<Mutex<Option<ProjectionTarget>>>,
    cancel: Arc<AtomicBool>,
    notifier: Option<TaskProjectionObserver>,
) -> Result<TaskRuntimeResult, String> {
    let turn_error = Arc::new(Mutex::new(None));
    let process = ensure_worker_process(
        &input,
        &worker_id,
        &session_id,
        &process_holder,
        projection.clone(),
    )?;
    let runtime = process.runtime.clone();
    *projection
        .lock()
        .map_err(|_| "DSH 事件投影锁失败".to_string())? = Some(ProjectionTarget {
        run_id: run_id.clone(),
        turn_error: turn_error.clone(),
        notifier: notifier.clone(),
        request_identity: process._policy_guard.request_identity_reader(),
    });
    let model = input
        .model_snapshot
        .get("modelId")
        .and_then(Value::as_str)
        .unwrap_or("deepseek-chat");
    let adapter_provider = harness_adapter_provider(&input)?;
    let max_tokens = input
        .model_snapshot
        .pointer("/options/maxTokens")
        .and_then(Value::as_u64)
        .unwrap_or(8000);
    let current_health = runtime
        .request("runtime/health", None, Duration::from_secs(5))
        .ok();
    let already_ready = current_health.as_ref().is_some_and(|health| {
        health.get("ready").and_then(Value::as_bool) == Some(true)
            && health.get("sourceCommit").and_then(Value::as_str) == Some(DSH_SOURCE_COMMIT)
    });
    let current_model = current_health
        .as_ref()
        .and_then(|health| {
            health
                .pointer("/route/model")
                .or_else(|| health.get("model"))
        })
        .and_then(Value::as_str);
    if !already_ready || current_model.is_some_and(|value| value != model) {
        runtime
            .request(
                "initialize",
                Some(json!({
                    "cwd":worker_directory(&input.conversation_id).to_string_lossy().replace('\\',"/"),
                    "provider":adapter_provider,
                    "model":model,
                    "maxTokens":max_tokens,
                    "sourceCommit":DSH_SOURCE_COMMIT,
                    "protocol":DSH_PROTOCOL
                })),
                Duration::from_secs(30),
            )
            .map_err(|error| format!("initialize 失败: {}", error))?;
        let health = runtime
            .request("runtime/health", None, Duration::from_secs(30))
            .map_err(|error| format!("runtime/health 失败: {}", error))?;
        if health.get("ready").and_then(Value::as_bool) != Some(true)
            || health.get("sourceCommit").and_then(Value::as_str) != Some(DSH_SOURCE_COMMIT)
        {
            return Err("DSH Runtime 初始化或固定载体健康校验失败".to_string());
        }
    }
    let before = runtime.snapshot(&session_id).unwrap_or_default();
    let prompt_result = runtime
        .request(
            "session/prompt",
            Some(json!({
                "sessionId":session_id,
                "contentBlocks":[{"type":"text","text":format!("小说 ID：{}\n章节 ID：{}\n用户目标：{}\n请按需使用工具并形成候选。",input.novel_id,input.chapter_id.as_deref().unwrap_or(""),input.goal)}],
                "route":{
                    "provider":adapter_provider,
                    "model":model,
                    "maxTokens":max_tokens,
                    "reasoningEffort":input.model_snapshot.pointer("/options/reasoningEffort")
                }
            })),
            Duration::from_secs(30),
        )
        .map_err(|error| format!("session/prompt 失败: {}", error))?;
    if prompt_result.get("sessionId").and_then(Value::as_str) != Some(session_id.as_str())
        || prompt_result.get("agentId").and_then(Value::as_str) != Some(session_id.as_str())
    {
        return Err("DSH 持久 Session/Agent 身份响应不匹配".to_string());
    }
    let session_lifecycle = prompt_result
        .get("lifecycle")
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(lifecycle) = session_lifecycle.as_deref() {
        if !matches!(lifecycle, "created" | "continued" | "resumed") {
            return Err(format!("DSH Session 生命周期无效: {}", lifecycle));
        }
    }
    runtime
        .wait_idle_checked_with_cancel(&session_id, Duration::from_secs(480), Some(&cancel))
        .map_err(|error| format!("DSH 回合失败: {}", error))?;
    let snapshot = runtime.snapshot(&session_id).unwrap_or_default();
    if let Some(error) = turn_error.lock().ok().and_then(|error| error.clone()) {
        return Err(format!("DSH 回合以错误结束: {}", error));
    }
    let assistant_text = snapshot.last_assistant_text.clone();
    let mut connection = crate::db::get_connection()
        .lock()
        .map_err(|_| "数据库锁失败".to_string())?;
    let open_tools: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM tool_call_events
             WHERE run_id=?1 AND status IN ('pending','queued','running')",
            rusqlite::params![run_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if open_tools != 0 {
        return Err(format!(
            "DSH 回合结束时仍有 {} 个工具调用未收敛",
            open_tools
        ));
    }
    let generated = read_generated_chapter_result(&connection, &input, &run_id)
        .map_err(|error| error.to_string())?;
    let artifact_id = generated
        .as_ref()
        .map(|generated| {
            create_artifact_projection(
                &mut connection,
                &input,
                &run_id,
                generated,
                snapshot.prompt_tokens.saturating_sub(before.prompt_tokens),
                snapshot
                    .completion_tokens
                    .saturating_sub(before.completion_tokens),
            )
        })
        .transpose()
        .map_err(|error| error.to_string())?
        .flatten();
    if artifact_id.is_some() {
        notify_projection(
            notifier.as_ref(),
            &input.conversation_id,
            &run_id,
            "artifact",
        )?;
    }
    let finished_at = now();
    let run = conversation_service::update_run(
        &mut connection,
        UpdateRunInput {
            run_id: run_id.clone(),
            status: "completed".to_string(),
            error: None,
            updated_at: finished_at.clone(),
            started_at: None,
            finished_at: Some(finished_at),
        },
    )
    .map_err(|error| error.to_string())?;
    drop(connection);
    notify_projection(
        notifier.as_ref(),
        &input.conversation_id,
        &run_id,
        "terminal",
    )?;
    *projection
        .lock()
        .map_err(|_| "DSH 事件投影锁失败".to_string())? = None;
    let agent_id = session_id.clone();
    Ok(TaskRuntimeResult {
        run,
        session_id,
        agent_id,
        worker_id,
        runtime: "dsh-headless-persistent".to_string(),
        assistant_text: (!assistant_text.trim().is_empty()).then_some(assistant_text),
        artifact_id,
        session_lifecycle,
    })
}

pub fn start(input: StartTaskTurnInput) -> Result<TaskRuntimeResult, String> {
    start_with_observer(input, None)
}

pub fn start_with_observer(
    input: StartTaskTurnInput,
    notifier: Option<TaskProjectionObserver>,
) -> Result<TaskRuntimeResult, String> {
    required(&input.conversation_id, "conversationId")?;
    required(&input.novel_id, "novelId")?;
    required(&input.turn_id, "turnId")?;
    required(&input.goal, "goal")?;
    if !input.model_snapshot.is_object() || contains_credential_key(&input.model_snapshot) {
        return Err("modelSnapshot 无效或包含凭据字段".to_string());
    }
    let supports_tool_calling = input
        .model_snapshot
        .get("capabilities")
        .and_then(Value::as_array)
        .is_some_and(|capabilities| {
            capabilities
                .iter()
                .any(|capability| capability.as_str() == Some("tool_calling"))
        });
    if !supports_tool_calling {
        return Err("所选任务模型未声明 tool_calling 能力".to_string());
    }
    let run_id = uuid::Uuid::new_v4().to_string();
    let identity = large_text_repository::sha256(&input.conversation_id);
    let stable_worker_id = format!("worker-{}", &identity[..32]);
    let stable_session_id = format!("session-{}", &identity[..32]);
    let cancel = Arc::new(AtomicBool::new(false));
    let (worker_id, session_id, process, projection) = {
        let mut workers = active()
            .lock()
            .map_err(|_| "Worker 状态锁失败".to_string())?;
        if let Some(worker) = workers.get_mut(&input.conversation_id) {
            if matches!(worker.status.as_str(), "running" | "cancel_requested") {
                return Err("当前任务已有活动运行".to_string());
            }
            worker.run_id = run_id.clone();
            worker.cancel = cancel.clone();
            worker.status = "running".to_string();
            worker.error = None;
            worker.notifier = notifier.clone();
            (
                worker.worker_id.clone(),
                worker.session_id.clone(),
                worker.process.clone(),
                worker.projection.clone(),
            )
        } else {
            let process = Arc::new(Mutex::new(None));
            let projection = Arc::new(Mutex::new(None));
            workers.insert(
                input.conversation_id.clone(),
                ActiveWorker {
                    run_id: run_id.clone(),
                    session_id: stable_session_id.clone(),
                    worker_id: stable_worker_id.clone(),
                    cancel: cancel.clone(),
                    process: process.clone(),
                    projection: projection.clone(),
                    notifier: notifier.clone(),
                    status: "running".to_string(),
                    error: None,
                },
            );
            (stable_worker_id, stable_session_id, process, projection)
        }
    };
    let run_created = (|| {
        let mut connection = crate::db::get_connection()
            .lock()
            .map_err(|_| "数据库锁失败".to_string())?;
        conversation_service::create_run(
            &mut connection,
            CreateRunInput {
                run_id: run_id.clone(),
                conversation_id: input.conversation_id.clone(),
                turn_id: input.turn_id.clone(),
                model_snapshot: input.model_snapshot.clone(),
                worker_id: worker_id.clone(),
                created_at: now(),
            },
        )
        .map_err(|error| error.to_string())?;
        conversation_service::update_run(
            &mut connection,
            UpdateRunInput {
                run_id: run_id.clone(),
                status: "running".to_string(),
                error: None,
                updated_at: now(),
                started_at: Some(now()),
                finished_at: None,
            },
        )
        .map_err(|error| error.to_string())?;
        Ok::<(), String>(())
    })();
    if let Err(error) = run_created {
        update_active(&input.conversation_id, "idle", Some(error.clone()));
        return Err(error);
    }
    notify_projection(notifier.as_ref(), &input.conversation_id, &run_id, "run")?;
    let result = execute(
        input.clone(),
        run_id.clone(),
        worker_id.clone(),
        session_id.clone(),
        process.clone(),
        projection.clone(),
        cancel.clone(),
        notifier.clone(),
    );
    let outcome = match result {
        Ok(value) => value,
        Err(raw_error) => {
            let error = safe_runtime_error(&raw_error);
            let cancelled = active()
                .lock()
                .ok()
                .and_then(|workers| {
                    workers
                        .get(&input.conversation_id)
                        .map(|worker| worker.cancel.load(Ordering::SeqCst))
                })
                .unwrap_or(false);
            let terminal_status = if cancelled { "cancelled" } else { "failed" };
            if let Ok(mut connection) = crate::db::get_connection().lock() {
                let finished_at = now();
                let _ = conversation_service::terminalize_open_tool_events(
                    &mut connection,
                    &run_id,
                    if cancelled { "cancelled" } else { "failed" },
                    if cancelled {
                        "DSH Worker 已取消，工具调用未完成。"
                    } else {
                        "DSH Worker 故障，工具调用未完成。"
                    },
                    &finished_at,
                );
                let _ = conversation_service::update_run(
                    &mut connection,
                    UpdateRunInput {
                        run_id: run_id.clone(),
                        status: terminal_status.to_string(),
                        error: Some(error.clone()),
                        updated_at: finished_at.clone(),
                        started_at: None,
                        finished_at: Some(finished_at.clone()),
                    },
                );
                let failure_turn_id = stable_projection_id(
                    "dsh-message",
                    &run_id,
                    if cancelled {
                        "assistant:cancelled"
                    } else {
                        "assistant:failed"
                    },
                );
                let failure_message = if cancelled {
                    "任务已取消。".to_string()
                } else {
                    format!("任务运行失败：{}", error)
                };
                let _ = conversation_service::append_runtime_assistant_turn(
                    &mut connection,
                    &failure_turn_id,
                    &input.conversation_id,
                    &run_id,
                    &failure_message,
                    &finished_at,
                );
            }
            let _ = notify_projection(
                notifier.as_ref(),
                &input.conversation_id,
                &run_id,
                "terminal",
            );
            if let Ok(mut target) = projection.lock() {
                *target = None;
            }
            let process_healthy = process
                .lock()
                .ok()
                .and_then(|holder| holder.as_ref().cloned())
                .is_some_and(|process| {
                    process
                        .runtime
                        .request("runtime/health", None, Duration::from_secs(3))
                        .is_ok()
                });
            if !process_healthy {
                if let Ok(mut holder) = process.lock() {
                    if let Some(dead) = holder.take() {
                        dead.runtime.kill();
                    }
                }
            }
            update_active(&input.conversation_id, "idle", Some(error.clone()));
            return Err(error);
        }
    };
    update_active(&input.conversation_id, "idle", None);
    Ok(outcome)
}

pub fn cancel(conversation_id: &str) -> Result<TaskRuntimeStatus, String> {
    let mut workers = active()
        .lock()
        .map_err(|_| "Worker 状态锁失败".to_string())?;
    let worker = workers
        .get_mut(conversation_id)
        .ok_or_else(|| "当前任务没有活动运行".to_string())?;
    if worker.status != "running" {
        return Err("当前任务没有活动运行".to_string());
    }
    worker.cancel.store(true, Ordering::SeqCst);
    let run_id = worker.run_id.clone();
    let session_id = worker.session_id.clone();
    let worker_id = worker.worker_id.clone();
    let notifier = worker.notifier.clone();
    worker.status = "cancel_requested".to_string();
    drop(workers);
    if let Ok(mut connection) = crate::db::get_connection().lock() {
        let _ = conversation_service::update_run(
            &mut connection,
            UpdateRunInput {
                run_id: run_id.clone(),
                status: "cancel_requested".to_string(),
                error: None,
                updated_at: now(),
                started_at: None,
                finished_at: None,
            },
        );
    }
    notify_projection(notifier.as_ref(), conversation_id, &run_id, "run")?;
    Ok(TaskRuntimeStatus {
        conversation_id: conversation_id.to_string(),
        run_id,
        session_id,
        worker_id,
        status: "cancel_requested".to_string(),
        runtime: "dsh-headless-persistent".to_string(),
        error: None,
    })
}

pub fn status(conversation_id: &str) -> Option<TaskRuntimeStatus> {
    active()
        .lock()
        .ok()?
        .get(conversation_id)
        .map(|worker| TaskRuntimeStatus {
            conversation_id: conversation_id.to_string(),
            run_id: worker.run_id.clone(),
            session_id: worker.session_id.clone(),
            worker_id: worker.worker_id.clone(),
            status: worker.status.clone(),
            runtime: "dsh-headless-persistent".to_string(),
            error: worker.error.clone(),
        })
}

pub fn list_statuses() -> Vec<TaskRuntimeStatus> {
    active()
        .lock()
        .ok()
        .map(|workers| {
            workers
                .iter()
                .map(|(conversation_id, worker)| TaskRuntimeStatus {
                    conversation_id: conversation_id.clone(),
                    run_id: worker.run_id.clone(),
                    session_id: worker.session_id.clone(),
                    worker_id: worker.worker_id.clone(),
                    status: worker.status.clone(),
                    runtime: "dsh-headless-persistent".to_string(),
                    error: worker.error.clone(),
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
pub fn debug_kill_worker(conversation_id: &str) {
    if let Ok(mut workers) = active().lock() {
        if let Some(worker) = workers.get_mut(conversation_id) {
            if let Ok(mut holder) = worker.process.lock() {
                if let Some(process) = holder.take() {
                    let _ = process.runtime.shutdown_and_wait(Duration::from_secs(10));
                    process.runtime.kill();
                }
            }
            worker.status = "idle".to_string();
        }
    }
}

fn read_process_health(process: &WorkerProcess) -> Result<Value, String> {
    let health = process
        .runtime
        .request("runtime/health", None, Duration::from_secs(5))
        .map_err(|_| "DSH runtime/health 查询失败".to_string())?;
    if !health.is_object() {
        return Err("DSH runtime/health 响应无效".to_string());
    }
    Ok(health)
}

fn probe_input() -> StartTaskTurnInput {
    let upstream =
        std::env::var("DSH_PROXY_UPSTREAM").unwrap_or_else(|_| "http://127.0.0.1:9".to_string());
    StartTaskTurnInput {
        conversation_id: PLUGIN_PROBE_CONVERSATION_ID.to_string(),
        novel_id: "plugin-probe".to_string(),
        turn_id: "plugin-probe".to_string(),
        goal: "plugin-probe".to_string(),
        chapter_id: None,
        model_snapshot: json!({
            "providerId": "deepseek-official",
            "modelId": "deepseek-chat",
            "runtimeMode": "api",
            "baseUrl": upstream,
            "capabilities": ["tool_calling"],
            "options": { "maxTokens": 512 },
            "runtime": {
                "adapterProtocol": DSH_PROTOCOL,
                "adapterProvider": "deepseek-official"
            }
        }),
        request_policy: TaskRequestPolicyInput {
            max_requests_per_minute: 12,
            max_concurrent_requests: 1,
            daily_token_budget: None,
            daily_cost_budget_usd: None,
            warning_percent: 80,
            timeout_seconds: 30,
        },
        api_key: String::new(),
    }
}

fn ensure_plugin_probe_health() -> Result<Option<Value>, String> {
    let descriptor = describe_runtime();
    if !carrier_files_ready(&descriptor.status) {
        return Ok(None);
    }
    if let Some(existing) = plugin_probe().lock().ok().and_then(|guard| guard.clone()) {
        if let Ok(health) = read_process_health(&existing) {
            return Ok(Some(health));
        }
        if let Ok(mut guard) = plugin_probe().lock() {
            if let Some(dead) = guard.take() {
                dead.runtime.kill();
            }
        }
    }
    let input = probe_input();
    let identity_hash = match provider_transport(&input) {
        Ok((_, _, hash)) => hash,
        Err(_) => return Ok(None),
    };
    let dummy_projection = Arc::new(Mutex::new(None));
    let process = match spawn_worker_process(
        &input,
        &descriptor,
        "worker-plugin-probe",
        "session-plugin-probe",
        identity_hash,
        input
            .model_snapshot
            .get("baseUrl")
            .and_then(Value::as_str)
            .unwrap_or("http://127.0.0.1:9"),
        "local-no-key-required",
        dummy_projection,
    ) {
        Ok(process) => process,
        Err(_) => return Ok(None),
    };
    let model = "deepseek-chat";
    if process
        .runtime
        .request(
            "initialize",
            Some(json!({
                "cwd": worker_directory(PLUGIN_PROBE_CONVERSATION_ID).to_string_lossy().replace('\\', "/"),
                "provider": "deepseek-official",
                "model": model,
                "maxTokens": 512,
                "sourceCommit": DSH_SOURCE_COMMIT,
                "protocol": DSH_PROTOCOL
            })),
            Duration::from_secs(30),
        )
        .is_err()
    {
        process.runtime.kill();
        return Ok(None);
    }
    let health = match read_process_health(&process) {
        Ok(health) => health,
        Err(_) => {
            process.runtime.kill();
            return Ok(None);
        }
    };
    if let Ok(mut guard) = plugin_probe().lock() {
        *guard = Some(process);
    }
    Ok(Some(health))
}

/// Reads the public health projection from an idle task worker, or a dedicated
/// plugin-probe worker when the user has not started a task yet.
///
/// A running/cancelling worker is never probed. Callers must treat `None` as
/// "not initialized", not as healthy. Probe spawn failures stay `None` so the
/// plugin view can remain unavailable instead of guessing loaded.
pub fn runtime_health_with_probe(
    conversation_id: Option<&str>,
    allow_probe: bool,
) -> Result<Option<Value>, String> {
    if let Some(conversation_id) = conversation_id
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != PLUGIN_PROBE_CONVERSATION_ID)
    {
        let workers = active()
            .lock()
            .map_err(|_| "Worker 状态锁失败".to_string())?;
        if let Some(worker) = workers.get(conversation_id) {
            if worker.status == "idle" {
                let process = worker
                    .process
                    .lock()
                    .map_err(|_| "Worker 进程锁失败".to_string())?
                    .clone();
                drop(workers);
                if let Some(process) = process {
                    return Ok(Some(read_process_health(&process)?));
                }
            }
        }
    }
    if let Some(existing) = plugin_probe().lock().ok().and_then(|guard| guard.clone()) {
        if let Ok(health) = read_process_health(&existing) {
            return Ok(Some(health));
        }
    }
    if allow_probe {
        return ensure_plugin_probe_health();
    }
    Ok(None)
}
