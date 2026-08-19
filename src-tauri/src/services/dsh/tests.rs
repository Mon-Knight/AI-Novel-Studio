//! Integration tests against the real DSH runtime on Windows.
//!
//! These tests skip themselves when `DSH_CHECKOUT` is unset. They require the
//! pinned harness checkout to be built and a system Node satisfying
//! `^22.19.0 || >=24.0.0`. Each test spawns its own mock LLM server on a
//! dedicated port, so no provider key is needed and no external state is
//! shared. A test-only cordis template (no MCP gateway row) is used: the
//! production template requires the gateway binary which P2 provides.

use std::fs;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use super::launcher::{DshLaunchConfig, DshRuntimeLauncher, NodeDshRuntime};
use super::supervisor::RuntimeHandle;
use serde_json::json;

const PROVIDER: &str = "deepseek-official";
const MODEL: &str = "deepseek-chat";
const PROMPT: &str =
    "请为长篇小说的第 12 章输出一份章节准备提案要点。只输出提案要点，不要执行任何工具或写文件。";

/// Test-only composition: same five plugins as the production template minus
/// the mcp-novel gateway row (the gateway binary does not exist in P1).
const TEST_TEMPLATE: &str = r#"- id: sdk-jsonrpc-server
  name: 'file:///{CHECKOUT}/packages/sdk/server/lib/index.js'
  config:
    maxTokensAsSuccess: !!js "process.env.DSH_MAX_TOKENS_AS_SUCCESS === undefined ? true : JSON.parse(process.env.DSH_MAX_TOKENS_AS_SUCCESS)"

- id: llm-deepseek
  name: 'file:///{CHECKOUT}/packages/llm/llm-deepseek/lib/index.js'
  config:
    thinking: enabled
    reasoningEffort: max

- id: agent-spine
  name: 'file:///{CHECKOUT}/packages/examples/agent-spine-demo/lib/index.js'
  config:
    persona: !!js process.env.DSH_SYSTEM_PROMPT ?? 'planner'
    workspaceContext: false
    skills:
      enabled: false
    toolBash:
      enableRunInBackground: false
    toolJobs: false

- id: sessions
  name: 'file:///{CHECKOUT}/packages/session/session-persistence-jsonl/lib/index.js'
  config:
    root: !!js process.env.DSH_SESSION_ROOT ?? './.sessions'
    compression: none

- id: token-meter
  name: 'file:///{CHECKOUT}/packages/llm/token-meter/lib/index.js'
"#;

/// Returns the harness checkout when it is usable for these tests.
fn checkout() -> Option<PathBuf> {
    std::env::var("DSH_CHECKOUT")
        .ok()
        .map(PathBuf::from)
        .filter(|path| {
            path.join("packages/examples/jsonrpc-demo/lib/bin.js")
                .exists()
                && path
                    .join("packages/test-support/llm-mock-server/src/bin.ts")
                    .exists()
        })
}

/// Scriptable OpenAI-compatible mock provider on a dedicated port.
struct MockLlm {
    child: Child,
    port: u16,
}

impl MockLlm {
    fn start(checkout: &Path, port: u16, sequence: &str, chunk_delay_ms: Option<u32>) -> Self {
        let mut command = Command::new("node");
        command
            .arg("--import")
            .arg("tsx")
            .arg(checkout.join("packages/test-support/llm-mock-server/src/bin.ts"))
            .arg("--port")
            .arg(port.to_string())
            .arg("--api-key")
            .arg("mock-key")
            .arg("--sequence")
            .arg(sequence)
            .arg("--repeat-last");
        if let Some(delay) = chunk_delay_ms {
            command.arg("--chunk-delay-ms").arg(delay.to_string());
        }
        command
            .current_dir(checkout)
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = command.spawn().expect("spawn mock llm server");
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if TcpStream::connect(("127.0.0.1", port)).is_ok() {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "mock llm server never became ready"
            );
            std::thread::sleep(Duration::from_millis(100));
        }
        Self { child, port }
    }
}

impl Drop for MockLlm {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Fresh, isolated scratch directory per test run.
fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("dsh-v310-{}-{}", tag, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create scratch dir");
    dir
}

fn launch_config(checkout: &Path, dir: &Path, port: u16) -> DshLaunchConfig {
    let cordis_config = dir.join("cordis.yml");
    let rendered = TEST_TEMPLATE.replace(
        "{CHECKOUT}",
        &checkout
            .to_string_lossy()
            .replace(' ', "%20")
            .replace('\\', "/"),
    );
    fs::write(&cordis_config, rendered).expect("write test cordis.yml");
    DshLaunchConfig {
        runtime_bin: checkout.join("packages/examples/jsonrpc-demo/lib/bin.js"),
        cordis_config,
        session_root: dir.join("sessions"),
        home: dir.join("home"),
        api_key: "mock-key".to_string(),
        base_url: format!("http://127.0.0.1:{}/v1", port),
        system_prompt: "你是小说章节准备规划员。用中文回答。只根据提供的事实输出提案要点。"
            .to_string(),
        cwd: dir.to_path_buf(),
    }
}

fn spawn_runtime(config: &DshLaunchConfig) -> RuntimeHandle {
    let child = NodeDshRuntime.launch(config).expect("launch dsh runtime");
    RuntimeHandle::new(child).expect("wrap dsh runtime")
}

fn initialize(handle: &RuntimeHandle, config: &DshLaunchConfig) {
    let result = handle
        .request(
            "initialize",
            Some(json!({
                "cwd": config.cwd.to_string_lossy().replace('\\', "/"),
                "provider": PROVIDER,
                "model": MODEL,
                "maxTokens": 1024
            })),
            Duration::from_secs(30),
        )
        .expect("initialize request");
    assert_eq!(result["serverInfo"]["name"], "deepseek-harness-sdk-runtime");
}

fn prompt(handle: &RuntimeHandle, session_id: &str, text: &str) {
    let receipt = handle
        .request(
            "session/prompt",
            Some(json!({
                "sessionId": session_id,
                "contentBlocks": [{ "type": "text", "text": text }]
            })),
            Duration::from_secs(30),
        )
        .expect("session/prompt request");
    assert!(
        receipt["messageId"].is_string(),
        "missing messageId receipt"
    );
}

#[test]
fn node_runtime_meets_version_requirement() {
    let version = NodeDshRuntime::check_node().expect("node version check");
    assert!(version.starts_with('v'), "unexpected node version string");
}

#[test]
fn scenario_a_normal_lifecycle() {
    let checkout = match checkout() {
        Some(path) => path,
        None => {
            crate::errors::log_workspace_event(crate::errors::WorkspaceLogEvent {
                level: "warn",
                event: "dsh_test_skipped",
                trace_id: None,
                operation_id: None,
                novel_id: None,
                chapter_id: None,
                draft_id: None,
                error_code: None,
                metadata: Some(
                    serde_json::json!({ "reason": "DSH_CHECKOUT unset or checkout not built" }),
                ),
            });
            return;
        }
    };
    let mock = MockLlm::start(&checkout, 12765, "success", None);
    let dir = temp_dir("a");
    let config = launch_config(&checkout, &dir, mock.port);
    let runtime = spawn_runtime(&config);
    initialize(&runtime, &config);
    prompt(&runtime, "rust-a", PROMPT);
    assert!(
        runtime.wait_idle("rust-a", Duration::from_secs(120)),
        "turn did not reach idle; stderr: {}",
        runtime.stderr_tail()
    );
    let snapshot = runtime.snapshot("rust-a").expect("session snapshot");
    assert!(
        !snapshot.last_assistant_text.is_empty(),
        "assistant text missing; stderr: {}",
        runtime.stderr_tail()
    );
    assert!(snapshot.prompt_tokens > 0, "usage not recorded");
    let code = runtime
        .shutdown_and_wait(Duration::from_secs(30))
        .expect("shutdown");
    assert_eq!(
        code,
        0,
        "shutdown exit code; stderr: {}",
        runtime.stderr_tail()
    );
}

#[test]
fn scenario_c_midstream_kill_restart_resume() {
    let checkout = match checkout() {
        Some(path) => path,
        None => {
            crate::errors::log_workspace_event(crate::errors::WorkspaceLogEvent {
                level: "warn",
                event: "dsh_test_skipped",
                trace_id: None,
                operation_id: None,
                novel_id: None,
                chapter_id: None,
                draft_id: None,
                error_code: None,
                metadata: Some(
                    serde_json::json!({ "reason": "DSH_CHECKOUT unset or checkout not built" }),
                ),
            });
            return;
        }
    };
    let mock = MockLlm::start(&checkout, 12766, "slow_success", Some(2000));
    let dir = temp_dir("c");
    let config = launch_config(&checkout, &dir, mock.port);

    let first = spawn_runtime(&config);
    initialize(&first, &config);
    prompt(&first, "rust-c", PROMPT);
    std::thread::sleep(Duration::from_millis(2500));
    assert_eq!(
        first.status_of("rust-c").as_deref(),
        Some("running"),
        "expected mid-stream running state before kill; stderr: {}",
        first.stderr_tail()
    );
    first.kill();
    std::thread::sleep(Duration::from_millis(300));

    let second = spawn_runtime(&config);
    initialize(&second, &config);
    prompt(&second, "rust-c", "继续完成提案。");
    assert!(
        second.wait_idle("rust-c", Duration::from_secs(120)),
        "restarted turn did not reach idle; stderr: {}",
        second.stderr_tail()
    );
    let code = second
        .shutdown_and_wait(Duration::from_secs(30))
        .expect("shutdown after restart");
    assert_eq!(
        code,
        0,
        "restart shutdown exit code; stderr: {}",
        second.stderr_tail()
    );
}
