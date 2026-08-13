//! Tauri command: `dsh_prepare_chapter` — the DSH planner adapter entry.
//!
//! Drives the out-of-process DSH runtime through the supervisor: initialize,
//! MCP settle, one planning prompt, then up to MAX_REPAIR_TURNS repair turns
//! fed with validation errors. Every parsed output passes the Rust-authoritative
//! validator (enum coercion included); adapter-owned metrics are injected before
//! returning. The runtime tree dies with the handle (Job Object).

use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::async_runtime;

use super::config::{checkout_from_env, cordis_yml};
use super::launcher::{DshLaunchConfig, DshRuntimeLauncher, NodeDshRuntime};
use super::models::{ChapterPreparationInput, ChapterPreparationProposal};
use super::proposal_validator::{self, ValidationReport};
use super::supervisor::RuntimeHandle;

/// The persona the runtime is booted with (asset: prompts/dsh_chapter_preparation.md).
const PERSONA: &str = include_str!("../../../../prompts/dsh_chapter_preparation.md");
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

fn prepare(
    input: ChapterPreparationInput,
    options: DshPrepareOptions,
) -> Result<ChapterPreparationProposal, String> {
    if options.api_key.trim().is_empty() {
        return Err("apiKey 不能为空（从设置中的 DeepSeek Provider 读取）".to_string());
    }
    let _node_version = NodeDshRuntime::check_node()?;
    let checkout = checkout_from_env().ok_or_else(|| {
        "DSH_CHECKOUT 未设置或不存在（需要已构建的 DSH harness checkout，或设 DSH_RUNTIME_BIN）".to_string()
    })?;
    let runtime_bin = NodeDshRuntime::runtime_bin(&checkout)?;
    let gateway_bin = resolve_gateway_bin()?;
    let db_path = crate::db::get_database_path().to_string_lossy().to_string();

    let work = std::env::temp_dir().join(format!("dsh-v310-{}", std::process::id()));
    std::fs::create_dir_all(&work).map_err(|error| format!("工作目录创建失败: {}", error))?;
    let cordis_path = work.join("cordis.yml");
    std::fs::write(&cordis_path, cordis_yml(&checkout, &gateway_bin, &db_path))
        .map_err(|error| format!("cordis 渲染失败: {}", error))?;

    let base_url = options
        .base_url
        .or_else(|| std::env::var("DEEPSEEK_BASE_URL").ok())
        .unwrap_or_else(|| "https://api.deepseek.com".to_string());
    let model = options
        .model
        .or_else(|| std::env::var("DSH_MODEL").ok())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string());

    let config = DshLaunchConfig {
        runtime_bin: PathBuf::from(runtime_bin),
        cordis_config: cordis_path,
        session_root: work.join("sessions"),
        home: work.join("home"),
        api_key: options.api_key,
        base_url,
        system_prompt: PERSONA.to_string(),
        cwd: work.clone(),
    };

    let child = NodeDshRuntime
        .launch(&config)
        .map_err(|error| format!("DSH 运行时启动失败: {}", error))?;
    let runtime = RuntimeHandle::new(child).map_err(|error| error.to_string())?;

    let result = run_preparation(&runtime, &config, &input, &model);
    let _ = runtime.shutdown_and_wait(SHUTDOWN_TIMEOUT);
    result
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
    lines.push("1. 字符串内部引用原文只能使用中文引号「」；数组元素之间必须用英文逗号分隔。".to_string());
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
    let candidate = exe_dir.join("novel-domain-gateway.exe");
    if candidate.is_file() {
        return Ok(candidate.to_string_lossy().to_string());
    }
    Err(format!(
        "novel-domain-gateway 未找到（可设 DSH_GATEWAY_BIN 指定）；查找位置: {}",
        candidate.display()
    ))
}
