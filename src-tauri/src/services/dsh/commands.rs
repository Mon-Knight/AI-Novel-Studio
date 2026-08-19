//! Tauri command: `dsh_prepare_chapter` — the DSH planner adapter entry.
//!
//! Drives the out-of-process DSH runtime through the supervisor: initialize,
//! MCP settle, one planning prompt, then up to MAX_REPAIR_TURNS repair turns
//! fed with validation errors. Every parsed output passes the Rust-authoritative
//! validator (enum coercion included); adapter-owned metrics are injected before
//! returning. The runtime tree dies with the handle (Job Object).

use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::async_runtime;

use super::config::{cordis_yml, runtime_root};
use super::launcher::{DshLaunchConfig, DshRuntimeLauncher, NodeDshRuntime};
use super::ledger::{record_run, summary, PreparationRunRecord, PreparationSummary};
use super::models::{ChapterPreparationInput, ChapterPreparationProposal};
use super::proposal_validator::{self, ValidationReport};
use super::supervisor::RuntimeHandle;

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
struct ProxyGuard {
    child: Mutex<Option<Child>>,
    log: Arc<Mutex<String>>,
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
}

impl Drop for ProxyGuard {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Spawns the local proxy on a free port with the upstream key; returns the
/// guard plus the base URL. The downstream (DSH) side gets a dummy key: the
/// upstream credential lives only in the proxy process.
fn spawn_proxy(work: &Path, upstream_key: &str) -> Result<(ProxyGuard, String), String> {
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

    let upstream = std::env::var("DSH_PROXY_UPSTREAM")
        .unwrap_or_else(|_| "https://api.deepseek.com".to_string());
    let mut command = Command::new("node");
    command
        .arg(&script_path)
        .env("PROXY_PORT", port.to_string())
        .env("PROXY_UPSTREAM", &upstream)
        .env("PROXY_UPSTREAM_KEY", upstream_key)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("代理启动失败: {}", error))?;

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
    let db_path = crate::db::get_database_path().to_string_lossy().to_string();

    let work = std::env::temp_dir().join(format!("dsh-v310-{}", std::process::id()));
    std::fs::create_dir_all(&work).map_err(|error| format!("工作目录创建失败: {}", error))?;
    let cordis_path = work.join("cordis.yml");
    std::fs::write(&cordis_path, cordis_yml(&root, &gateway_bin, &db_path))
        .map_err(|error| format!("cordis 渲染失败: {}", error))?;

    // Model gateway (option A): explicit baseUrl wins; otherwise spawn the local
    // proxy and hand the DSH child a dummy downstream key (key isolation).
    let (proxy_guard, base_url, downstream_key) = match options.base_url {
        Some(url) => (None, url, options.api_key.clone()),
        None => {
            let (guard, url) = spawn_proxy(&work, &options.api_key)?;
            (Some(guard), url, "local-proxy".to_string())
        }
    };
    let model = options
        .model
        .or_else(|| std::env::var("DSH_MODEL").ok())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());

    let config = DshLaunchConfig {
        runtime_bin: PathBuf::from(runtime_bin),
        cordis_config: cordis_path,
        session_root: work.join("sessions"),
        home: work.join("home"),
        api_key: downstream_key,
        base_url,
        system_prompt: PERSONA.to_string(),
        cwd: work.clone(),
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
    let canonical = super::baseline_freshness::read_canonical(
        &connection,
        &input.novel_id,
        &input.chapter_id,
    )?;
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
        let candidate = if !snapshot.last_assistant_text.trim().is_empty() {
            snapshot.last_assistant_text.as_str()
        } else if !snapshot.last_assistant_reasoning.trim().is_empty() {
            snapshot.last_assistant_reasoning.as_str()
        } else {
            snapshot.assistant_text.as_str()
        };

        match extract_json(candidate) {
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
    lines.join("\n")
}

/// Extracts the first JSON object from a model answer (fences stripped).
fn extract_json(text: &str) -> Option<Value> {
    const FENCE_JSON: &str = "```json";
    const FENCE: &str = "```";
    let cleaned = text.replace(FENCE_JSON, "").replace(FENCE, "");
    let start = cleaned.find('{')?;
    let end = cleaned.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str(&cleaned[start..=end]).ok()
}

/// Locates the gateway binary: DSH_GATEWAY_BIN env, then next to the app exe.
fn resolve_gateway_bin() -> Result<String, String> {
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
mod e2e_tests {
    use super::super::models::ChapterBaselineRevision;
    use super::super::proposal_validator::PROPOSAL_SOURCES;
    use super::*;

    #[test]
    #[ignore = "real api + full dsh stack; run explicitly with DSH_RUNTIME_ROOT/DSH_E2E_API_KEY/DSH_GATEWAY_BIN"]
    fn e2e_prepare_via_local_proxy() {
        let api_key = std::env::var("DSH_E2E_API_KEY").expect("set DSH_E2E_API_KEY");
        let gateway_bin = std::env::var("DSH_GATEWAY_BIN").expect("set DSH_GATEWAY_BIN");
        std::env::set_var("DSH_GATEWAY_BIN", gateway_bin);
        crate::db::init_test_database();
        let novel_id = std::env::var("DSH_E2E_NOVEL_ID")
            .unwrap_or_else(|_| "fed8183e-f40f-4b68-8291-fe0f1a4c82b2".to_string());
        let chapter_id = std::env::var("DSH_E2E_CHAPTER_ID")
            .unwrap_or_else(|_| "bbf1d4e6-df6d-470f-b8ea-ba70b71ae67b".to_string());
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
        let options = DshPrepareOptions {
            api_key,
            base_url: None,
            model: Some("deepseek-v4-flash".to_string()),
        };
        let proposal = prepare(input, options).expect("prepare e2e failed");
        assert_eq!(proposal.schema_version, 1);
        assert_eq!(proposal.planner, "dsh_spike_v0");
        assert!(!proposal.chapter_goals.is_empty());
        assert!(proposal.metrics.prompt_tokens.unwrap_or(0) > 0);
        assert!(proposal.metrics.tool_call_count.unwrap_or(0) > 0);
    }
}
