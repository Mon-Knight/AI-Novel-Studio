//! Dynamic tests for the persistent ANS bridge over the pinned DSH carrier.
//!
//! Carrier discovery accepts an explicit `DSH_RUNTIME_ROOT`/`DSH_CHECKOUT`,
//! the fixed development checkout, or the staged self-contained payload. Real
//! carrier scenarios never use the official create-only SDK server: they
//! render `ans-task-server-template.mjs`, load the production Cordis graph,
//! and exercise public `agents.create/resume` through the ANS protocol.
//!
//! A carrier-independent controlled child test always runs as well. It proves
//! supervisor timeout, crash, and two-child isolation without silently
//! skipping those failure paths when a developer machine lacks the carrier.

use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

static START_PATH_LOCK: Mutex<()> = Mutex::new(());

use rusqlite::Connection;
use serde_json::{json, Value};

use super::config::{task_cordis_yml, task_server_script};
use super::launcher::{DshLaunchConfig, DshRuntimeLauncher, NodeDshRuntime};
use super::supervisor::{RuntimeHandle, SessionSnapshot, SupervisorError};
use super::task_runtime::{
    self, StartTaskTurnInput, TaskRequestPolicyInput, DSH_PROTOCOL, DSH_SOURCE_COMMIT,
};
use crate::services::conversation_service::{self, AppendTurnInput, CreateConversationInput};

const PROVIDER: &str = "deepseek-official";
const DEFAULT_MODEL: &str = "deepseek-chat";
const SESSION_TIMEOUT: Duration = Duration::from_secs(90);
const ALLOWED_TOOLS: &str =
    "novel.read_context,chapter.read_outline,get_character_states,search_memory,generate_chapter,generate_outline,generate_characters,suggest_events,expand_settings,polish_chapter,check_quality,summarize_chapter";
const EXPECTED_PUBLIC_TOOLS: [&str; 5] = [
    "mcp__novel__chapter_read_outline_68634582eb55",
    "mcp__novel__generate_chapter",
    "mcp__novel__get_character_states",
    "mcp__novel__novel_read_context_1e2b3adf9a19",
    "mcp__novel__search_memory",
];
const INTEGRATION_NOVEL_ID: &str = "integration-novel";
const INTEGRATION_CHAPTER_ID: &str = "integration-chapter";

struct ScratchDir(PathBuf);

impl ScratchDir {
    fn new(tag: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "ans-dsh-{}-{}-{}",
            tag,
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&path).expect("create DSH integration scratch directory");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for ScratchDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct EnvironmentGuard {
    name: &'static str,
    previous: Option<OsString>,
}

impl EnvironmentGuard {
    fn set(name: &'static str, value: impl AsRef<OsStr>) -> Self {
        let previous = std::env::var_os(name);
        std::env::set_var(name, value);
        Self { name, previous }
    }
}

impl Drop for EnvironmentGuard {
    fn drop(&mut self) {
        if let Some(previous) = self.previous.take() {
            std::env::set_var(self.name, previous);
        } else {
            std::env::remove_var(self.name);
        }
    }
}

struct StartPathEnvironment {
    _guards: Vec<EnvironmentGuard>,
}

impl StartPathEnvironment {
    fn new(root: &Path, scratch: &ScratchDir) -> Self {
        let gateway_database = scratch.path().join("gateway.sqlite");
        let mut connection =
            Connection::open(&gateway_database).expect("create start-path gateway database");
        crate::db::create_tables(&mut connection).expect("migrate start-path gateway database");
        drop(connection);

        Self {
            _guards: vec![
                EnvironmentGuard::set("DSH_RUNTIME_ROOT", root),
                EnvironmentGuard::set("ANS_TASK_WORKER_ROOT", scratch.path()),
                EnvironmentGuard::set("DSH_GATEWAY_BIN", gateway_bin()),
                EnvironmentGuard::set("DSH_E2E_GATEWAY_DB_PATH", gateway_database),
            ],
        }
    }
}

struct MockWorkbench {
    child: Child,
    port: u16,
    upstream_base_url: String,
}

impl MockWorkbench {
    fn start(mode: &str, delay_ms: u64) -> Self {
        let script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("workspace root")
            .join("scripts/dsh/mock-workbench-upstream.mjs");
        assert!(
            script.is_file(),
            "mock upstream script missing: {}",
            script.display()
        );
        let mut child = Command::new("node")
            .arg(script)
            .env("MOCK_WORKBENCH_PORT", "0")
            .env("MOCK_WORKBENCH_MODE", mode)
            .env("MOCK_WORKBENCH_DELAY_MS", delay_ms.to_string())
            .env("MOCK_WORKBENCH_NOVEL_ID", "integration-novel")
            .env("MOCK_WORKBENCH_CHAPTER_ID", "integration-chapter")
            .env("MOCK_WORKBENCH_GOAL", "生成只供人工审阅的章节候选")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn deterministic Workbench upstream");
        let stdout = child.stdout.take().expect("mock upstream stdout");
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            let result = reader
                .read_line(&mut line)
                .map(|_| line)
                .map_err(|error| error.to_string());
            let _ = sender.send(result);
        });
        let ready_line = receiver
            .recv_timeout(Duration::from_secs(15))
            .expect("mock upstream did not announce readiness")
            .expect("read mock upstream readiness");
        let ready: Value = serde_json::from_str(ready_line.trim()).unwrap_or_else(|error| {
            panic!("invalid mock upstream readiness ({error}): {ready_line}")
        });
        assert_eq!(
            ready.get("type").and_then(Value::as_str),
            Some("mock-workbench-upstream.ready")
        );
        let port = ready
            .get("port")
            .and_then(Value::as_u64)
            .and_then(|value| u16::try_from(value).ok())
            .expect("mock upstream readiness port");
        let upstream_base_url = ready
            .get("upstreamBaseUrl")
            .and_then(Value::as_str)
            .expect("mock upstream base URL")
            .to_string();
        Self {
            child,
            port,
            upstream_base_url,
        }
    }

    fn snapshot(&self) -> Value {
        http_get_json(self.port, "/requests")
    }

    fn wait_for<F>(&self, description: &str, timeout: Duration, predicate: F) -> Value
    where
        F: Fn(&Value) -> bool,
    {
        let deadline = Instant::now() + timeout;
        loop {
            let snapshot = self.snapshot();
            if predicate(&snapshot) {
                return snapshot;
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for mock upstream {description}: {snapshot}"
            );
            std::thread::sleep(Duration::from_millis(25));
        }
    }
}

impl Drop for MockWorkbench {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn http_get_json(port: u16, path: &str) -> Value {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect mock upstream");
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .expect("set HTTP read timeout");
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    )
    .expect("write mock upstream request");
    stream.flush().expect("flush mock upstream request");
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .expect("read mock upstream response");
    let split = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .expect("HTTP response header terminator");
    let headers = String::from_utf8_lossy(&response[..split]);
    assert!(
        headers.starts_with("HTTP/1.1 200") || headers.starts_with("HTTP/1.0 200"),
        "mock upstream HTTP failure: {headers}"
    );
    serde_json::from_slice(&response[split + 4..]).expect("parse mock upstream JSON")
}

fn carrier_root() -> PathBuf {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        std::env::var_os("DSH_RUNTIME_ROOT").map(PathBuf::from),
        std::env::var_os("DSH_CHECKOUT").map(PathBuf::from),
        Some(PathBuf::from(r"F:\dsh-v320-clean")),
        Some(manifest.join(".payload-staging/dsh-runtime")),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|root| {
            root.join("packages/examples/jsonrpc-demo/lib/bin.js")
                .is_file()
                && root
                    .join("packages/sdk/protocol/lib/index.js")
                    .is_file()
                && root.join("packages/core/agent/lib/index.js").is_file()
                && root
                    .join("packages/session/session-persistence-jsonl/lib/index.js")
                    .is_file()
        })
        .unwrap_or_else(|| {
            panic!(
                "pinned DSH carrier unavailable: set DSH_RUNTIME_ROOT/DSH_CHECKOUT, provide F:\\dsh-v320-clean, or build src-tauri/.payload-staging/dsh-runtime; controlled_protocol_child_timeout_crash_and_isolation_never_skips still provides the non-skipping protocol fallback"
            )
        })
}

fn gateway_bin() -> PathBuf {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let executable = if cfg!(windows) {
        "novel-domain-gateway.exe"
    } else {
        "novel-domain-gateway"
    };
    let candidates = [
        std::env::var_os("CARGO_BIN_EXE_novel-domain-gateway").map(PathBuf::from),
        Some(manifest.join("target/debug").join(executable)),
        Some(manifest.join("target/release").join(executable)),
        Some(
            manifest
                .join(".payload-staging/dsh-runtime/gateway")
                .join(executable),
        ),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|path| path.is_file())
        .unwrap_or_else(|| {
            panic!(
                "novel-domain-gateway missing; run `cargo build --locked -p novel-domain-gateway` before the real carrier tests"
            )
        })
}

struct RuntimeFixture {
    config: DshLaunchConfig,
}

impl RuntimeFixture {
    fn new(root: &Path, dir: &Path, gateway: &Path, upstream: &MockWorkbench) -> Self {
        let database = dir.join("novel.sqlite");
        let mut connection = Connection::open(&database).expect("create integration database");
        crate::db::create_tables(&mut connection).expect("migrate integration database");
        connection
            .execute_batch(
                "INSERT OR IGNORE INTO novels (id, title, created_at, updated_at)
                 VALUES ('integration-novel', 'DSH integration novel', '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z');
                 INSERT OR IGNORE INTO chapters (id, novel_id, title, order_index, status, word_count, created_at, updated_at)
                 VALUES ('integration-chapter', 'integration-novel', 'DSH integration chapter', 1, 'not_started', 0, '2026-08-27T00:00:00Z', '2026-08-27T00:00:00Z');",
            )
            .expect("seed authoritative DSH task scope");
        drop(connection);

        let server_path = dir.join("ans-task-server.mjs");
        fs::write(
            &server_path,
            task_server_script(
                root.to_string_lossy().as_ref(),
                DSH_SOURCE_COMMIT,
                DSH_PROTOCOL,
            ),
        )
        .expect("write rendered ANS task server");
        let cordis_config = dir.join("cordis.yml");
        fs::write(
            &cordis_config,
            task_cordis_yml(
                root.to_string_lossy().as_ref(),
                gateway.to_string_lossy().as_ref(),
                database.to_string_lossy().as_ref(),
                &server_path,
            ),
        )
        .expect("write persistent task Cordis composition");
        let config = DshLaunchConfig {
            runtime_bin: root.join("packages/examples/jsonrpc-demo/lib/bin.js"),
            cordis_config,
            session_root: dir.join("sessions"),
            home: dir.join("home"),
            api_key: "mock-key-never-persisted".to_string(),
            base_url: upstream.upstream_base_url.clone(),
            system_prompt: "你是 ANS 固定载体动态测试 Agent。只按用户要求回复，不展示隐藏推理。"
                .to_string(),
            cwd: dir.to_path_buf(),
            allowed_tools: Some(ALLOWED_TOOLS.to_string()),
            task_novel_id: Some(INTEGRATION_NOVEL_ID.to_string()),
            task_chapter_id: Some(INTEGRATION_CHAPTER_ID.to_string()),
            candidate_policy: None,
        };
        Self { config }
    }

    fn spawn(&self) -> RuntimeHandle {
        let child = NodeDshRuntime
            .launch(&self.config)
            .expect("launch pinned DSH carrier");
        RuntimeHandle::new(child).expect("wrap pinned DSH carrier")
    }
}

fn initialize(runtime: &RuntimeHandle, config: &DshLaunchConfig, model: &str) -> Value {
    let result = runtime
        .request(
            "initialize",
            Some(json!({
                "cwd": config.cwd.to_string_lossy().replace('\\', "/"),
                "provider": PROVIDER,
                "model": model,
                "maxTokens": 512,
                "sourceCommit": DSH_SOURCE_COMMIT,
                "protocol": DSH_PROTOCOL
            })),
            Duration::from_secs(30),
        )
        .unwrap_or_else(|error| {
            panic!(
                "initialize persistent carrier: {error}; stderr: {}",
                runtime.stderr_tail()
            )
        });
    assert_eq!(
        result.pointer("/serverInfo/name").and_then(Value::as_str),
        Some("ai-novel-studio-dsh-task-runtime")
    );
    assert_eq!(
        result
            .pointer("/serverInfo/sourceCommit")
            .and_then(Value::as_str),
        Some(DSH_SOURCE_COMMIT)
    );
    assert_eq!(
        result
            .pointer("/serverInfo/protocol")
            .and_then(Value::as_str),
        Some(DSH_PROTOCOL)
    );
    result
}

fn health(runtime: &RuntimeHandle) -> Value {
    runtime
        .request("runtime/health", None, Duration::from_secs(30))
        .unwrap_or_else(|error| {
            panic!(
                "persistent carrier health: {error}; stderr: {}",
                runtime.stderr_tail()
            )
        })
}

fn prompt(runtime: &RuntimeHandle, session_id: &str, text: &str, model: &str) -> (Value, u64) {
    let before = runtime
        .snapshot(session_id)
        .map(|snapshot| snapshot.events)
        .unwrap_or(0);
    let receipt = runtime
        .request(
            "session/prompt",
            Some(json!({
                "sessionId": session_id,
                "contentBlocks": [{"type":"text", "text":text}],
                "route": {
                    "provider": PROVIDER,
                    "model": model,
                    "maxTokens": 512
                }
            })),
            Duration::from_secs(30),
        )
        .unwrap_or_else(|error| {
            panic!(
                "queue persistent prompt: {error}; stderr: {}",
                runtime.stderr_tail()
            )
        });
    assert!(receipt.get("messageId").and_then(Value::as_str).is_some());
    assert_eq!(
        receipt.get("sessionId").and_then(Value::as_str),
        Some(session_id)
    );
    assert_eq!(
        receipt.get("agentId").and_then(Value::as_str),
        Some(session_id)
    );
    (receipt, before)
}

fn wait_for_status(runtime: &RuntimeHandle, session_id: &str, status: &str, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    loop {
        if runtime.status_of(session_id).as_deref() == Some(status) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "session {session_id} never reached {status}; snapshot={:?}; stderr={}",
            runtime.snapshot(session_id),
            runtime.stderr_tail()
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn wait_for_turn(
    runtime: &RuntimeHandle,
    session_id: &str,
    before_events: u64,
    timeout: Duration,
) -> SessionSnapshot {
    wait_for_settled_turn(runtime, session_id, before_events, timeout, true)
}

fn wait_for_cancelled_turn(
    runtime: &RuntimeHandle,
    session_id: &str,
    before_events: u64,
    timeout: Duration,
) -> SessionSnapshot {
    wait_for_settled_turn(runtime, session_id, before_events, timeout, false)
}

fn wait_for_settled_turn(
    runtime: &RuntimeHandle,
    session_id: &str,
    before_events: u64,
    timeout: Duration,
    require_turn_end: bool,
) -> SessionSnapshot {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(snapshot) = runtime.snapshot(session_id) {
            let new_kinds = snapshot
                .event_kinds
                .get((before_events as usize)..)
                .unwrap_or(&[]);
            let has_new_end =
                snapshot.events > before_events && new_kinds.iter().any(|kind| kind == "turn/end");
            let cancelled_idle = snapshot.events > before_events
                && snapshot.status.as_deref() == Some("idle")
                && new_kinds.iter().any(|kind| {
                    kind == "turn/start" || kind == "step/end" || kind == "agent/inbox/spliced"
                });
            if snapshot.status.as_deref() == Some("idle")
                && (has_new_end || (!require_turn_end && cancelled_idle))
            {
                return snapshot;
            }
        }
        assert!(
            Instant::now() < deadline,
            "session {session_id} turn did not settle; snapshot={:?}; stderr={}",
            runtime.snapshot(session_id),
            runtime.stderr_tail()
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn cancel_session(runtime: &RuntimeHandle, session_id: &str) -> Value {
    runtime
        .request(
            "session/cancel",
            Some(json!({"sessionId":session_id})),
            Duration::from_secs(10),
        )
        .unwrap_or_else(|error| {
            panic!(
                "cancel persistent session: {error}; stderr: {}",
                runtime.stderr_tail()
            )
        })
}

fn shutdown(runtime: &RuntimeHandle) {
    let code = runtime
        .shutdown_and_wait(Duration::from_secs(30))
        .unwrap_or_else(|error| {
            panic!(
                "persistent carrier shutdown: {error}; stderr: {}",
                runtime.stderr_tail()
            )
        });
    assert_eq!(code, 0, "runtime stderr: {}", runtime.stderr_tail());
}

fn request_rows(snapshot: &Value) -> &[Value] {
    snapshot
        .get("requests")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .expect("mock upstream request rows")
}

#[test]
fn node_runtime_meets_version_requirement() {
    let version = NodeDshRuntime::check_node().expect("node version check");
    assert!(
        version.starts_with('v'),
        "unexpected Node version: {version}"
    );
}

#[test]
fn persistent_carrier_gateway_inherits_authoritative_task_scope() {
    let root = carrier_root();
    let gateway = gateway_bin();
    let scratch = ScratchDir::new("task-scope");
    let upstream = MockWorkbench::start("normal", 0);
    let fixture = RuntimeFixture::new(&root, scratch.path(), &gateway, &upstream);
    let runtime = fixture.spawn();

    initialize(&runtime, &fixture.config, DEFAULT_MODEL);
    let (_, before) = prompt(
        &runtime,
        "task-scope-session",
        "请读取上下文并生成本章候选正文。",
        DEFAULT_MODEL,
    );
    let snapshot = wait_for_turn(&runtime, "task-scope-session", before, SESSION_TIMEOUT);

    assert_eq!(snapshot.tool_calls.len(), EXPECTED_PUBLIC_TOOLS.len());
    for expected in EXPECTED_PUBLIC_TOOLS {
        assert!(
            snapshot.tool_calls.iter().any(|tool| tool == expected),
            "missing scoped gateway call {expected}: {:?}",
            snapshot.tool_calls
        );
    }
    assert_eq!(snapshot.tool_results.len(), EXPECTED_PUBLIC_TOOLS.len());
    let tool_results = snapshot
        .tool_results
        .iter()
        .map(|(_, text)| text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(tool_results.contains("\"artifactType\":\"chapter_text\""));
    assert!(tool_results.contains("\"candidateOnly\":true"));
    assert!(!tool_results.contains("TASK_SCOPE"));
    assert!(!tool_results.contains("scope mismatch"));
    assert!(snapshot.last_assistant_text.contains("尚未写入正式正文"));

    let requests = upstream.wait_for(
        "scoped context, generation, and final model calls",
        Duration::from_secs(10),
        |value| value.get("requestCount").and_then(Value::as_u64) == Some(3),
    );
    let rows = request_rows(&requests);
    assert_eq!(
        rows[1].get("toolResultCount").and_then(Value::as_u64),
        Some(4)
    );
    assert_eq!(
        rows[2].get("toolResultCount").and_then(Value::as_u64),
        Some(5)
    );
    shutdown(&runtime);
}

#[test]
fn persistent_carrier_same_process_followup_model_switch_and_allowlist() {
    let root = carrier_root();
    let gateway = gateway_bin();
    let scratch = ScratchDir::new("followup");
    let upstream = MockWorkbench::start("text-only", 0);
    let fixture = RuntimeFixture::new(&root, scratch.path(), &gateway, &upstream);
    let runtime = fixture.spawn();

    let first_initialize = initialize(&runtime, &fixture.config, DEFAULT_MODEL);
    assert_eq!(
        first_initialize
            .get("reinitialized")
            .and_then(Value::as_bool),
        Some(false)
    );
    let runtime_health = health(&runtime);
    assert_eq!(
        runtime_health.get("ready").and_then(Value::as_bool),
        Some(true),
        "runtime health: {runtime_health}"
    );
    assert_eq!(
        runtime_health.get("protocol").and_then(Value::as_str),
        Some(DSH_PROTOCOL)
    );
    let composition = runtime_health
        .get("composition")
        .and_then(Value::as_array)
        .expect("health composition");
    assert_eq!(composition.len(), 7);
    assert!(composition
        .iter()
        .all(|entry| entry.get("status").and_then(Value::as_str) == Some("loaded")));

    let tools = runtime_health
        .pointer("/tools/global")
        .and_then(Value::as_array)
        .expect("global tool directory")
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    for expected in EXPECTED_PUBLIC_TOOLS {
        assert!(
            tools.iter().any(|tool| *tool == expected),
            "missing public tool {expected}: {tools:?}"
        );
    }
    for tool in &tools {
        let lowered = tool.to_ascii_lowercase();
        assert!(
            tool.starts_with("mcp__novel__"),
            "unexpected MCP namespace: {tool}"
        );
        assert!(
            ![
                "bash",
                "jobs",
                "read_file",
                "write_file",
                "shell",
                "git",
                "sql"
            ]
            .iter()
            .any(|forbidden| lowered.contains(forbidden)),
            "forbidden model-facing capability: {tool}"
        );
    }

    let first_prompt = "FOLLOWUP_PRIVATE_FIRST_7f5a";
    let (first_receipt, before_first) =
        prompt(&runtime, "persistent-session", first_prompt, "model-alpha");
    assert_eq!(
        first_receipt.get("lifecycle").and_then(Value::as_str),
        Some("created")
    );
    let first = wait_for_turn(
        &runtime,
        "persistent-session",
        before_first,
        SESSION_TIMEOUT,
    );
    assert!(!first.last_assistant_text.is_empty());

    let second_initialize = initialize(&runtime, &fixture.config, "model-beta");
    assert_eq!(
        second_initialize
            .get("reinitialized")
            .and_then(Value::as_bool),
        Some(true)
    );
    let (second_receipt, before_second) = prompt(
        &runtime,
        "persistent-session",
        "FOLLOWUP_PRIVATE_SECOND_91ca",
        "model-beta",
    );
    assert_eq!(
        second_receipt.get("lifecycle").and_then(Value::as_str),
        Some("continued")
    );
    wait_for_turn(
        &runtime,
        "persistent-session",
        before_second,
        SESSION_TIMEOUT,
    );
    assert_eq!(
        health(&runtime).get("liveSessions").and_then(Value::as_u64),
        Some(1)
    );

    let requests = upstream.wait_for(
        "two follow-up model calls",
        Duration::from_secs(10),
        |value| value.get("requestCount").and_then(Value::as_u64) == Some(2),
    );
    let rows = request_rows(&requests);
    assert_eq!(
        rows.iter()
            .map(|row| row.get("model").and_then(Value::as_str).unwrap_or(""))
            .collect::<Vec<_>>(),
        ["model-alpha", "model-beta"]
    );
    assert_eq!(
        rows[1].pointer("/roles/user").and_then(Value::as_u64),
        Some(2),
        "second request must replay the first user turn"
    );
    for row in rows {
        let advertised = row
            .get("advertisedToolNames")
            .and_then(Value::as_array)
            .expect("advertised tool names")
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>();
        for expected in EXPECTED_PUBLIC_TOOLS {
            assert!(
                advertised.iter().any(|tool| *tool == expected),
                "missing advertised tool {expected}: {advertised:?}"
            );
        }
    }
    let safe_snapshot = requests.to_string();
    assert!(!safe_snapshot.contains(first_prompt));
    assert!(!safe_snapshot.contains("mock-key-never-persisted"));
    shutdown(&runtime);
}

#[test]
fn persistent_carrier_restart_resumes_interrupted_session() {
    let root = carrier_root();
    let gateway = gateway_bin();
    let scratch = ScratchDir::new("restart");
    let interrupted_upstream = MockWorkbench::start("delay", 75);
    let first_fixture = RuntimeFixture::new(&root, scratch.path(), &gateway, &interrupted_upstream);
    let first = first_fixture.spawn();
    initialize(&first, &first_fixture.config, "model-before-crash");
    let (receipt, before_durable) = prompt(
        &first,
        "restart-session",
        "RESTART_PRIVATE_DURABLE_TURN_148d",
        "model-before-crash",
    );
    assert_eq!(
        receipt.get("lifecycle").and_then(Value::as_str),
        Some("created")
    );
    wait_for_turn(&first, "restart-session", before_durable, SESSION_TIMEOUT);
    let (interrupted_receipt, _) = prompt(
        &first,
        "restart-session",
        "RESTART_PRIVATE_INTERRUPTED_TURN_0cb2",
        "model-before-crash",
    );
    assert_eq!(
        interrupted_receipt.get("lifecycle").and_then(Value::as_str),
        Some("continued")
    );
    wait_for_status(
        &first,
        "restart-session",
        "running",
        Duration::from_secs(10),
    );
    interrupted_upstream.wait_for("in-flight request", Duration::from_secs(10), |value| {
        value.get("activeRequests").and_then(Value::as_u64) == Some(1)
            && value
                .get("requestCount")
                .and_then(Value::as_u64)
                .is_some_and(|count| count >= 4)
    });
    first.kill();
    interrupted_upstream.wait_for("crashed client closure", Duration::from_secs(10), |value| {
        value
            .get("requests")
            .and_then(Value::as_array)
            .is_some_and(|requests| {
                requests.iter().any(|request| {
                    request.get("outcome").and_then(Value::as_str) == Some("client_closed")
                })
            })
    });

    let resumed_upstream = MockWorkbench::start("text-only", 0);
    let resumed_fixture = RuntimeFixture::new(&root, scratch.path(), &gateway, &resumed_upstream);
    let resumed = resumed_fixture.spawn();
    initialize(&resumed, &resumed_fixture.config, "model-after-restart");
    let (resumed_receipt, before) = prompt(
        &resumed,
        "restart-session",
        "RESTART_PRIVATE_AFTER_CRASH_90c1",
        "model-after-restart",
    );
    assert_eq!(
        resumed_receipt.get("lifecycle").and_then(Value::as_str),
        Some("resumed")
    );
    let snapshot = wait_for_turn(&resumed, "restart-session", before, SESSION_TIMEOUT);
    assert!(!snapshot.last_assistant_text.is_empty());
    let requests =
        resumed_upstream.wait_for("resumed model call", Duration::from_secs(10), |value| {
            value.get("requestCount").and_then(Value::as_u64) == Some(1)
        });
    assert_eq!(
        requests
            .pointer("/requests/0/roles/user")
            .and_then(Value::as_u64),
        Some(2),
        "resumed request must reconstruct the completed durable user turn before accepting the new one; the crash-orphaned tail is repaired"
    );
    assert_eq!(
        requests
            .pointer("/requests/0/model")
            .and_then(Value::as_str),
        Some("model-after-restart")
    );
    shutdown(&resumed);
}

#[test]
fn persistent_carrier_cancel_and_timeout_are_session_scoped() {
    let root = carrier_root();
    let gateway = gateway_bin();
    let scratch = ScratchDir::new("cancel");
    let upstream = MockWorkbench::start("delay", 400);
    let fixture = RuntimeFixture::new(&root, scratch.path(), &gateway, &upstream);
    let runtime = fixture.spawn();
    initialize(&runtime, &fixture.config, DEFAULT_MODEL);

    let (_, before_cancelled) = prompt(
        &runtime,
        "cancelled-session",
        "CANCEL_PRIVATE_8aa1",
        DEFAULT_MODEL,
    );
    let (_, before_survivor) = prompt(
        &runtime,
        "survivor-session",
        "SURVIVOR_PRIVATE_52e3",
        DEFAULT_MODEL,
    );
    wait_for_status(
        &runtime,
        "cancelled-session",
        "running",
        Duration::from_secs(10),
    );
    wait_for_status(
        &runtime,
        "survivor-session",
        "running",
        Duration::from_secs(10),
    );
    let overlap = upstream.wait_for(
        "two sessions in one child to overlap",
        Duration::from_secs(10),
        |value| {
            value
                .get("peakActiveRequests")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                >= 2
        },
    );
    assert!(
        overlap
            .get("peakActiveRequests")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            >= 2
    );
    let cancelled = cancel_session(&runtime, "cancelled-session");
    assert_eq!(
        cancelled.get("cancelled").and_then(Value::as_bool),
        Some(true)
    );
    let cancelled_snapshot = wait_for_cancelled_turn(
        &runtime,
        "cancelled-session",
        before_cancelled,
        SESSION_TIMEOUT,
    );
    assert!(cancelled_snapshot.last_assistant_text.is_empty());
    let survivor = wait_for_turn(
        &runtime,
        "survivor-session",
        before_survivor,
        SESSION_TIMEOUT,
    );
    assert!(
        !survivor.last_assistant_text.is_empty(),
        "cancelling one Agent must not stop the sibling Agent"
    );
    assert_eq!(
        health(&runtime).get("ready").and_then(Value::as_bool),
        Some(true)
    );

    let (_, before_timeout) = prompt(
        &runtime,
        "timeout-session",
        "TIMEOUT_PRIVATE_f77e",
        DEFAULT_MODEL,
    );
    wait_for_status(
        &runtime,
        "timeout-session",
        "running",
        Duration::from_secs(10),
    );
    let timeout = runtime
        .wait_idle_checked("timeout-session", Duration::from_millis(25))
        .expect_err("bounded idle wait must time out while upstream is delayed");
    assert!(timeout.to_string().contains("timeout"));
    assert_eq!(
        cancel_session(&runtime, "timeout-session")
            .get("cancelled")
            .and_then(Value::as_bool),
        Some(true)
    );
    wait_for_cancelled_turn(&runtime, "timeout-session", before_timeout, SESSION_TIMEOUT);
    shutdown(&runtime);
}

#[test]
fn persistent_carrier_two_children_run_concurrently_and_isolate_failure() {
    let root = carrier_root();
    let gateway = gateway_bin();
    let scratch_a = ScratchDir::new("parallel-a");
    let scratch_b = ScratchDir::new("parallel-b");
    let upstream = MockWorkbench::start("delay", 150);
    let fixture_a = RuntimeFixture::new(&root, scratch_a.path(), &gateway, &upstream);
    let fixture_b = RuntimeFixture::new(&root, scratch_b.path(), &gateway, &upstream);
    let runtime_a = fixture_a.spawn();
    let runtime_b = fixture_b.spawn();
    initialize(&runtime_a, &fixture_a.config, "parallel-model-a");
    initialize(&runtime_b, &fixture_b.config, "parallel-model-b");

    let (_, before_a) = prompt(
        &runtime_a,
        "parallel-session-a",
        "PARALLEL_PRIVATE_A_c233",
        "parallel-model-a",
    );
    let (_, before_b) = prompt(
        &runtime_b,
        "parallel-session-b",
        "PARALLEL_PRIVATE_B_a7c4",
        "parallel-model-b",
    );
    let overlap = upstream.wait_for(
        "two real child requests to overlap",
        Duration::from_secs(15),
        |value| {
            value
                .get("peakActiveRequests")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                >= 2
        },
    );
    assert!(
        overlap
            .get("peakActiveRequests")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            >= 2
    );

    runtime_a.kill();
    let survivor = wait_for_turn(&runtime_b, "parallel-session-b", before_b, SESSION_TIMEOUT);
    assert!(!survivor.last_assistant_text.is_empty());
    assert_eq!(
        health(&runtime_b).get("ready").and_then(Value::as_bool),
        Some(true)
    );
    assert!(
        runtime_a
            .request("runtime/health", None, Duration::from_secs(5))
            .is_err(),
        "killed child must fail independently"
    );
    assert!(runtime_a
        .snapshot("parallel-session-a")
        .is_some_and(|snapshot| snapshot.events >= before_a));
    shutdown(&runtime_b);
}

fn spawn_controlled_protocol_child(dir: &Path, worker: &str) -> RuntimeHandle {
    let script = dir.join(format!("controlled-{worker}.mjs"));
    fs::write(
        &script,
        r#"import fs from 'node:fs';
import process from 'node:process';
import readline from 'node:readline';
const worker = process.argv[2];
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', line => {
  const frame = JSON.parse(line);
  if (frame.method === 'timeout') return;
  if (frame.method === 'crash') {
    fs.writeSync(2, 'CONTROLLED_CRASH_STDERR\n');
    process.exit(23);
  }
  if (frame.method === 'crash-secret') {
    const secret = ['agt', '_', 'fixture', '_', 'only', '_', '0000000000000000'].join('');
    fs.writeSync(2, `Authorization: Bearer ${secret} ${'s'.repeat(400)} SECRET_STDERR_TAIL\n`);
    process.exit(24);
  }
  if (frame.method === 'crash-long') {
    fs.writeSync(2, `LONG_STDERR_HEAD_${'诊断'.repeat(1500)}_LONG_STDERR_TAIL\n`);
    process.exit(25);
  }
  const respond = () => {
    const result = frame.method.endsWith('health') ? { worker, ready: true, method: frame.method } : {};
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) + '\n');
  };
  if (frame.method === 'delayed-health') {
    setTimeout(respond, 60);
    return;
  }
  respond();
  if (frame.method === 'shutdown') setImmediate(() => process.exit(0));
});
"#,
    )
    .expect("write controlled protocol child");
    let child = Command::new("node")
        .arg(script)
        .arg(worker)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn controlled protocol child");
    RuntimeHandle::new(child).expect("wrap controlled protocol child")
}

#[test]
fn controlled_protocol_child_timeout_crash_and_isolation_never_skips() {
    let scratch = ScratchDir::new("controlled-protocol");
    let first = spawn_controlled_protocol_child(scratch.path(), "first");
    let second = spawn_controlled_protocol_child(scratch.path(), "second");
    assert_eq!(
        first
            .request("health", None, Duration::from_secs(5))
            .expect("first child health")["worker"],
        "first"
    );
    assert_eq!(
        second
            .request("health", None, Duration::from_secs(5))
            .expect("second child health")["worker"],
        "second"
    );
    let timeout = first
        .request("timeout", None, Duration::from_millis(40))
        .expect_err("controlled request must time out");
    assert!(timeout.to_string().contains("timeout waiting for timeout"));
    let crash = first
        .request("crash", None, Duration::from_secs(5))
        .expect_err("controlled child crash must disconnect");
    assert!(crash.is_frame_channel_disconnected());
    let crash_diagnostic = task_runtime::safe_supervisor_error(&first, "DSH 回合失败", &crash);
    assert!(crash_diagnostic.starts_with(task_runtime::DSH_WORKER_FRAME_CHANNEL_DISCONNECTED));
    assert!(crash_diagnostic.contains("childExitStatus=exit-code:23"));
    assert!(crash_diagnostic.contains("stderrTail=CONTROLLED_CRASH_STDERR"));
    assert!(crash_diagnostic.chars().count() <= 512);

    let unavailable_diagnostic = task_runtime::safe_supervisor_error(
        &second,
        "DSH 回合失败",
        &SupervisorError("frame channel disconnected".to_string()),
    );
    assert_eq!(
        unavailable_diagnostic,
        task_runtime::DSH_WORKER_FRAME_CHANNEL_DISCONNECTED
    );
    assert_eq!(
        second
            .request("health", None, Duration::from_secs(5))
            .expect("second child survives first crash")["ready"],
        true
    );
    shutdown(&second);
}

#[test]
fn disconnected_worker_diagnostics_redact_secrets_and_bound_stderr_tail() {
    let scratch = ScratchDir::new("controlled-disconnect-diagnostics");

    let secret_worker = spawn_controlled_protocol_child(scratch.path(), "secret");
    let secret_error = secret_worker
        .request("crash-secret", None, Duration::from_secs(5))
        .expect_err("secret worker must disconnect");
    let secret_diagnostic =
        task_runtime::safe_supervisor_error(&secret_worker, "DSH 回合失败", &secret_error);
    let fixture_secret = ["agt", "_", "fixture", "_", "only", "_", "0000000000000000"].concat();
    assert!(secret_diagnostic.starts_with(task_runtime::DSH_WORKER_FRAME_CHANNEL_DISCONNECTED));
    assert!(secret_diagnostic.contains("childExitStatus=exit-code:24"));
    assert!(secret_diagnostic.contains("敏感详情未写入运行记录"));
    assert!(!secret_diagnostic.contains(&fixture_secret));
    assert!(!secret_diagnostic.contains("Authorization"));
    assert!(!secret_diagnostic.contains("Bearer"));
    assert!(secret_diagnostic.chars().count() <= 512);

    let long_worker = spawn_controlled_protocol_child(scratch.path(), "long");
    let long_error = long_worker
        .request("crash-long", None, Duration::from_secs(5))
        .expect_err("long stderr worker must disconnect");
    let long_diagnostic =
        task_runtime::safe_supervisor_error(&long_worker, "DSH 回合失败", &long_error);
    assert!(long_diagnostic.starts_with(task_runtime::DSH_WORKER_FRAME_CHANNEL_DISCONNECTED));
    assert!(long_diagnostic.contains("childExitStatus=exit-code:25"));
    assert!(long_diagnostic.contains("LONG_STDERR_TAIL"));
    assert!(!long_diagnostic.contains("LONG_STDERR_HEAD"));
    assert!(long_diagnostic.chars().count() <= 512);
    let bounded_tail = long_diagnostic
        .split_once("stderrTail=")
        .expect("stderr tail diagnostic field")
        .1
        .trim_end_matches(']');
    assert!(bounded_tail.chars().count() <= 240);
}

#[test]
fn concurrent_requests_on_one_runtime_keep_response_ownership() {
    let scratch = ScratchDir::new("controlled-concurrent-requests");
    let runtime = Arc::new(spawn_controlled_protocol_child(scratch.path(), "shared"));
    let delayed_runtime = runtime.clone();
    let delayed = std::thread::spawn(move || {
        delayed_runtime.request("delayed-health", None, Duration::from_secs(2))
    });
    std::thread::sleep(Duration::from_millis(15));
    let fast_runtime = runtime.clone();
    let fast = std::thread::spawn(move || {
        fast_runtime.request("fast-health", None, Duration::from_secs(2))
    });

    assert_eq!(
        delayed
            .join()
            .expect("join delayed request")
            .expect("delayed response")["method"],
        "delayed-health"
    );
    assert_eq!(
        fast.join()
            .expect("join fast request")
            .expect("fast response")["method"],
        "fast-health"
    );
    runtime.kill();
}

fn default_request_policy() -> TaskRequestPolicyInput {
    TaskRequestPolicyInput {
        max_requests_per_minute: 12,
        max_concurrent_requests: 2,
        daily_token_budget: None,
        daily_cost_budget_usd: None,
        warning_percent: 80,
        timeout_seconds: 90,
    }
}

fn seed_task_turn(tag: &str) -> (String, String, String) {
    crate::db::init_test_database();
    let novel_id = format!("novel-{tag}-{}", uuid::Uuid::new_v4());
    let conversation_id = format!("conversation-{tag}-{}", uuid::Uuid::new_v4());
    let turn_id = format!("turn-{tag}-{}", uuid::Uuid::new_v4());
    let now = "2026-08-21T00:00:00Z";
    let mut connection = crate::db::get_connection()
        .lock()
        .expect("test database lock");
    connection
        .execute(
            "INSERT INTO novels (id, title, outline, created_at, updated_at) VALUES (?1, ?2, '', ?3, ?3)",
            rusqlite::params![novel_id, tag, now],
        )
        .expect("seed novel");
    conversation_service::create(
        &mut connection,
        CreateConversationInput {
            conversation_id: conversation_id.clone(),
            novel_id: novel_id.clone(),
            title: tag.to_string(),
            default_model: None,
            created_at: now.to_string(),
        },
    )
    .expect("seed conversation");
    conversation_service::append_turn(
        &mut connection,
        AppendTurnInput {
            turn_id: turn_id.clone(),
            conversation_id: conversation_id.clone(),
            role: "user".to_string(),
            content: "生成只供人工审阅的章节候选".to_string(),
            created_at: now.to_string(),
        },
    )
    .expect("seed turn");
    (conversation_id, novel_id, turn_id)
}

fn start_task_snapshot(upstream: &str, model: &str) -> Value {
    json!({
        "providerId": "deepseek-official",
        "modelId": model,
        "runtimeMode": "api",
        "baseUrl": upstream,
        "capabilities": ["conversation_turn", "chapter_generate"],
        "options": { "maxTokens": 512 },
        "runtime": {
            "adapterProtocol": DSH_PROTOCOL,
            "adapterProvider": "deepseek-official",
            "dshSourceCommit": DSH_SOURCE_COMMIT,
            "bundle": "pinned-dsh-carrier",
            "profile": "conversational-workbench-v2"
        }
    })
}

fn assert_frozen_tool_attestation(run: &conversation_service::TaskRunRecord, cached: bool) {
    let evidence = run
        .model_snapshot
        .pointer("/runtime/toolCallingAttestation")
        .and_then(Value::as_object)
        .expect("run freezes validated tool-calling attestation");
    let keys = evidence
        .keys()
        .map(String::as_str)
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(
        keys,
        std::collections::HashSet::from([
            "protocol",
            "provider",
            "model",
            "verified",
            "cached",
            "verifiedAt",
            "expiresAt",
            "cacheTtlMs",
            "finishKind",
            "observedToolCalls",
        ])
    );
    assert_eq!(
        evidence.get("verified").and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(
        evidence.get("cached").and_then(Value::as_bool),
        Some(cached)
    );
    assert_eq!(
        evidence.get("finishKind").and_then(Value::as_str),
        Some("tool-calls")
    );
    assert_eq!(
        evidence.get("observedToolCalls").and_then(Value::as_u64),
        Some(1)
    );
}

fn request_policy_diagnostics() -> Value {
    let mut connection = crate::db::get_connection()
        .lock()
        .expect("test database lock");
    let snapshot = crate::services::ai_request_policy_service::get_snapshot(&mut connection)
        .expect("request policy snapshot");
    let reservations = connection
        .prepare(
            "SELECT provider_request_id,status FROM ai_request_reservations ORDER BY started_at_ms",
        )
        .expect("prepare request diagnostics")
        .query_map([], |row| {
            Ok(json!({
                "providerRequestId": row.get::<_, String>(0)?,
                "status": row.get::<_, String>(1)?,
            }))
        })
        .expect("query request diagnostics")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect request diagnostics");
    json!({ "snapshot": snapshot, "reservations": reservations })
}

fn try_start_turn(
    conversation_id: &str,
    novel_id: &str,
    turn_id: &str,
    upstream: &str,
    model: &str,
    goal: &str,
) -> Result<task_runtime::TaskRuntimeResult, String> {
    task_runtime::start(StartTaskTurnInput {
        conversation_id: conversation_id.to_string(),
        novel_id: novel_id.to_string(),
        turn_id: turn_id.to_string(),
        goal: goal.to_string(),
        chapter_id: None,
        task_kind: "read".to_string(),
        expected_tool: None,
        expected_artifact_type: None,
        required_read_tools: Vec::new(),
        book_word_goal: None,
        model_snapshot: start_task_snapshot(upstream, model),
        request_policy: default_request_policy(),
        api_key: String::new(),
    })
}

fn start_turn(
    conversation_id: &str,
    novel_id: &str,
    turn_id: &str,
    upstream: &str,
    model: &str,
    goal: &str,
) -> task_runtime::TaskRuntimeResult {
    try_start_turn(conversation_id, novel_id, turn_id, upstream, model, goal).unwrap_or_else(
        |error| {
            panic!(
                "dsh_start_task_turn {goal}: {error}; policy={}",
                request_policy_diagnostics()
            )
        },
    )
}

fn append_followup_turn(conversation_id: &str, content: &str) -> String {
    let turn_id = format!("turn-{}", uuid::Uuid::new_v4());
    let mut connection = crate::db::get_connection()
        .lock()
        .expect("test database lock");
    conversation_service::append_turn(
        &mut connection,
        AppendTurnInput {
            turn_id: turn_id.clone(),
            conversation_id: conversation_id.to_string(),
            role: "user".to_string(),
            content: content.to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
        },
    )
    .expect("follow-up turn");
    turn_id
}

#[test]
fn start_path_rejects_cross_scope_before_creating_a_run_or_worker() {
    let _guard = START_PATH_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (conversation_id, novel_id, turn_id) = seed_task_turn("scope-guard");
    let other_novel_id = format!("novel-other-{}", uuid::Uuid::new_v4());
    let other_chapter_id = format!("chapter-other-{}", uuid::Uuid::new_v4());
    {
        let connection = crate::db::get_connection()
            .lock()
            .expect("test database lock");
        connection
            .execute(
                "INSERT INTO novels (id, title, outline, created_at, updated_at)
                 VALUES (?1, '其他小说', '', '2026-08-21T00:00:00Z', '2026-08-21T00:00:00Z')",
                rusqlite::params![other_novel_id],
            )
            .expect("seed other novel");
        connection
            .execute(
                "INSERT INTO chapters (id, novel_id, title, order_index, status, word_count, created_at, updated_at)
                 VALUES (?1, ?2, '其他章节', 1, 'drafted', 0, '2026-08-21T00:00:00Z', '2026-08-21T00:00:00Z')",
                rusqlite::params![other_chapter_id, other_novel_id],
            )
            .expect("seed other chapter");
    }
    let cross_novel = try_start_turn(
        &conversation_id,
        &other_novel_id,
        &turn_id,
        "http://127.0.0.1:9/v1",
        "scope-model",
        "读取其他作品",
    )
    .expect_err("cross-novel task must fail before launch");
    assert!(cross_novel.contains("TASK_RUNTIME_SCOPE_MISMATCH"));
    assert!(!cross_novel.contains(&other_novel_id));

    let cross_chapter = task_runtime::start(StartTaskTurnInput {
        conversation_id: conversation_id.clone(),
        novel_id: novel_id.clone(),
        turn_id: turn_id.clone(),
        goal: "读取其他章节".to_string(),
        chapter_id: Some(other_chapter_id.clone()),
        task_kind: "read".to_string(),
        expected_tool: None,
        expected_artifact_type: None,
        required_read_tools: Vec::new(),
        book_word_goal: None,
        model_snapshot: start_task_snapshot("http://127.0.0.1:9/v1", "scope-model"),
        request_policy: default_request_policy(),
        api_key: String::new(),
    })
    .expect_err("cross-novel chapter must fail before launch");
    assert!(cross_chapter.contains("TASK_RUNTIME_SCOPE_MISMATCH"));
    assert!(!cross_chapter.contains(&other_chapter_id));

    let connection = crate::db::get_connection()
        .lock()
        .expect("test database lock");
    let bundle = conversation_service::get(&connection, &conversation_id)
        .expect("read conversation")
        .expect("conversation exists");
    assert!(bundle.runs.is_empty());
    assert!(!task_runtime::list_statuses()
        .iter()
        .any(|status| status.conversation_id == conversation_id));
}

#[test]
fn start_path_requires_model_tool_attestation_before_creating_a_run() {
    let _guard = START_PATH_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let root = carrier_root();
    let scratch = ScratchDir::new("attestation-fail");
    let _environment = StartPathEnvironment::new(&root, &scratch);
    let upstream = MockWorkbench::start("attestation-fail", 0);
    let (conversation_id, novel_id, turn_id) = seed_task_turn("attestation-fail");

    let error = try_start_turn(
        &conversation_id,
        &novel_id,
        &turn_id,
        &upstream.upstream_base_url,
        "model-without-verified-tools",
        "生成只供人工审阅的章节候选",
    )
    .expect_err("a text-only attestation response must fail closed");
    let policy_after_probe = {
        let mut connection = crate::db::get_connection()
            .lock()
            .expect("test database lock");
        crate::services::ai_request_policy_service::get_snapshot(&mut connection)
            .expect("request policy after rejected attestation")
    };
    assert!(
        error.contains("MODEL_TOOL_CALLING_NOT_VERIFIED"),
        "unexpected preflight error: {error}; upstream={}; policy={policy_after_probe:?}",
        upstream.snapshot()
    );
    assert!(
        error.contains("NO_TOOL_CALL"),
        "unexpected preflight error: {error}; upstream={}; policy={policy_after_probe:?}",
        upstream.snapshot()
    );

    let connection = crate::db::get_connection()
        .lock()
        .expect("test database lock");
    let bundle = conversation_service::get(&connection, &conversation_id)
        .expect("read conversation")
        .expect("conversation exists");
    assert!(
        bundle.runs.is_empty(),
        "preflight failure must not leave a run"
    );
    drop(connection);
    assert!(task_runtime::list_statuses().iter().any(|status| {
        status.conversation_id == conversation_id
            && status.status == "idle"
            && status
                .error
                .as_deref()
                .is_some_and(|value| value.contains("MODEL_TOOL_CALLING_NOT_VERIFIED"))
    }));

    let requests = upstream.snapshot();
    assert_eq!(
        requests.get("requestCount").and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        requests
            .pointer("/requests/0/phase")
            .and_then(Value::as_str),
        Some("attestation-fail")
    );
    task_runtime::debug_kill_worker(&conversation_id);
}

#[test]
fn start_path_cancellation_aborts_attestation_without_creating_a_run() {
    let _guard = START_PATH_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let root = carrier_root();
    let scratch = ScratchDir::new("attestation-cancel");
    let _environment = StartPathEnvironment::new(&root, &scratch);
    let upstream = MockWorkbench::start("attestation-delay", 20_000);
    let (conversation_id, novel_id, turn_id) = seed_task_turn("attestation-cancel");
    let start_handle = std::thread::spawn({
        let conversation_id = conversation_id.clone();
        let novel_id = novel_id.clone();
        let upstream = upstream.upstream_base_url.clone();
        move || {
            try_start_turn(
                &conversation_id,
                &novel_id,
                &turn_id,
                &upstream,
                "attestation-cancel-model",
                "取消模型能力预检",
            )
        }
    });

    upstream.wait_for(
        "delayed model attestation request",
        Duration::from_secs(30),
        |value| {
            value.get("requestCount").and_then(Value::as_u64) == Some(1)
                && value.pointer("/requests/0/phase").and_then(Value::as_str)
                    == Some("model-tool-attestation")
        },
    );
    assert!(task_runtime::list_statuses().iter().any(|status| {
        status.conversation_id == conversation_id && status.status == "attesting"
    }));

    let cancel_started = Instant::now();
    let cancelled = task_runtime::cancel(&conversation_id).expect("cancel model attestation");
    assert_eq!(cancelled.status, "cancel_requested");
    let error = start_handle
        .join()
        .expect("attestation start thread")
        .expect_err("cancelled attestation must not start a task run");
    assert!(
        error.contains("MODEL_TOOL_ATTESTATION_CANCELLED"),
        "unexpected cancellation error: {error}"
    );
    assert!(
        cancel_started.elapsed() < Duration::from_secs(5),
        "attestation cancellation must abort the worker instead of waiting for the probe timeout"
    );

    let mut connection = crate::db::get_connection()
        .lock()
        .expect("test database lock");
    let bundle = conversation_service::get(&connection, &conversation_id)
        .expect("read conversation")
        .expect("conversation exists");
    assert!(bundle.runs.is_empty());
    assert!(!task_runtime::debug_has_worker_process(&conversation_id));
    let policy = crate::services::ai_request_policy_service::get_snapshot(&mut connection)
        .expect("read request policy after attestation cancellation");
    assert_eq!(
        policy.active_requests, 0,
        "attestation cancellation must settle the governed request lease"
    );
}

#[test]
fn start_path_followup_reuses_session_and_resumes_after_child_exit() {
    let _guard = START_PATH_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let root = carrier_root();
    let scratch = ScratchDir::new("start-followup");
    let _environment = StartPathEnvironment::new(&root, &scratch);
    let upstream = MockWorkbench::start("text-only", 0);
    let (conversation_id, novel_id, first_turn_id) = seed_task_turn("followup-start");

    let first = start_turn(
        &conversation_id,
        &novel_id,
        &first_turn_id,
        &upstream.upstream_base_url,
        "model-alpha",
        "FOLLOWUP_START_FIRST",
    );
    assert_eq!(first.session_lifecycle.as_deref(), Some("created"));
    assert_eq!(first.runtime, "dsh-headless-persistent");
    assert!(first.model_tool_attestation.verified);
    assert!(!first.model_tool_attestation.cached);
    assert_frozen_tool_attestation(&first.run, false);
    let first_worker = first.worker_id.clone();
    let first_session = first.session_id.clone();

    let second_turn_id = append_followup_turn(&conversation_id, "FOLLOWUP_START_SECOND");
    let second = start_turn(
        &conversation_id,
        &novel_id,
        &second_turn_id,
        &upstream.upstream_base_url,
        "model-alpha",
        "FOLLOWUP_START_SECOND",
    );
    assert_eq!(second.worker_id, first_worker);
    assert_eq!(second.session_id, first_session);
    assert_eq!(second.session_lifecycle.as_deref(), Some("continued"));
    assert!(second.model_tool_attestation.cached);
    assert_frozen_tool_attestation(&second.run, true);

    task_runtime::debug_kill_worker(&conversation_id);
    {
        let connection = crate::db::get_connection()
            .lock()
            .expect("test database lock");
        let bundle = conversation_service::get(&connection, &conversation_id)
            .expect("read conversation after worker exit")
            .expect("conversation exists");
        let persisted_first = bundle
            .runs
            .iter()
            .find(|run| run.run_id == first.run.run_id)
            .expect("first attested run persists");
        let persisted_second = bundle
            .runs
            .iter()
            .find(|run| run.run_id == second.run.run_id)
            .expect("cached attested run persists");
        assert_frozen_tool_attestation(persisted_first, false);
        assert_frozen_tool_attestation(persisted_second, true);
    }
    let third_turn_id = append_followup_turn(&conversation_id, "FOLLOWUP_START_RESUME");
    let resumed = try_start_turn(
        &conversation_id,
        &novel_id,
        &third_turn_id,
        &upstream.upstream_base_url,
        "model-alpha",
        "FOLLOWUP_START_RESUME",
    )
    .unwrap_or_else(|error| {
        panic!(
            "dsh_start_task_turn FOLLOWUP_START_RESUME: {error}; upstream={}; policy={}",
            upstream.snapshot(),
            request_policy_diagnostics()
        )
    });
    assert_eq!(resumed.worker_id, first_worker);
    assert_eq!(resumed.session_id, first_session);
    assert_eq!(resumed.session_lifecycle.as_deref(), Some("resumed"));
    assert!(!resumed.model_tool_attestation.cached);
    assert_frozen_tool_attestation(&resumed.run, false);
}

#[test]
fn start_path_two_conversations_cancel_one_without_stopping_the_other() {
    let _guard = START_PATH_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let started_at = Instant::now();
    let root = carrier_root();
    let scratch = ScratchDir::new("start-parallel");
    let _environment = StartPathEnvironment::new(&root, &scratch);
    let upstream = MockWorkbench::start("delayed-text", 2500);
    let (first_id, first_novel, first_turn) = seed_task_turn("parallel-a");
    let (second_id, second_novel, second_turn) = seed_task_turn("parallel-b");

    let first_goal = "PARALLEL_START_A".to_string();
    let second_goal = "PARALLEL_START_B".to_string();
    let first_upstream = upstream.upstream_base_url.clone();
    let second_upstream = upstream.upstream_base_url.clone();
    let first_handle = std::thread::spawn({
        let first_id = first_id.clone();
        let first_novel = first_novel.clone();
        let first_turn = first_turn.clone();
        move || {
            try_start_turn(
                &first_id,
                &first_novel,
                &first_turn,
                &first_upstream,
                "parallel-model-a",
                &first_goal,
            )
        }
    });
    let second_handle = std::thread::spawn({
        let second_id = second_id.clone();
        let second_novel = second_novel.clone();
        let second_turn = second_turn.clone();
        move || {
            try_start_turn(
                &second_id,
                &second_novel,
                &second_turn,
                &second_upstream,
                "parallel-model-b",
                &second_goal,
            )
        }
    });

    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let running = task_runtime::list_statuses()
            .into_iter()
            .filter(|item| item.status == "running" || item.status == "cancel_requested")
            .count();
        if running >= 2 {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "two start() workers did not become running: {:?}",
            task_runtime::list_statuses()
        );
        std::thread::sleep(Duration::from_millis(50));
    }
    task_runtime::cancel(&first_id).expect("cancel first start path");
    let second = second_handle
        .join()
        .expect("second start thread")
        .expect("second conversation must complete");
    assert_eq!(second.run.status, "completed");
    let first = first_handle.join().expect("first start thread");
    match first {
        Ok(result) => assert!(
            result.run.status == "cancelled" || result.run.status == "failed",
            "cancelled worker terminal status: {}",
            result.run.status
        ),
        Err(error) => assert!(
            error.contains("取消") || error.contains("cancel") || error.contains("DSH"),
            "unexpected cancel error: {error}"
        ),
    }
    let statuses = task_runtime::list_statuses();
    assert!(statuses
        .iter()
        .any(|item| item.conversation_id == second_id));
    assert!(
        started_at.elapsed() < Duration::from_secs(60),
        "scoped cancellation must not wait for the 480-second session timeout"
    );
}
