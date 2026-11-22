//! Dynamic integration tests for the pure-Rust native task runtime, Canonical read
//! tools, session continuation/resumption, cancellation, and R4 cloud read guardrails.

use serde::Serialize;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

static START_PATH_LOCK: Mutex<()> = Mutex::new(());

use rusqlite::Connection;
use serde_json::{json, Value};

use super::task_runtime::{
    self, StartTaskTurnInput, TaskRequestPolicyInput, DSH_PROTOCOL, DSH_SOURCE_COMMIT,
};
use crate::services::conversation_service::{self, AppendTurnInput, CreateConversationInput};

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
    fn new(scratch: &ScratchDir) -> Self {
        let gateway_database = scratch.path().join("gateway.sqlite");
        let mut connection =
            Connection::open(&gateway_database).expect("create start-path gateway database");
        crate::db::create_tables(&mut connection).expect("migrate start-path gateway database");
        drop(connection);

        Self {
            _guards: vec![
                EnvironmentGuard::set("ANS_TASK_WORKER_ROOT", scratch.path()),
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
        Self::start_with_scope(mode, delay_ms, INTEGRATION_NOVEL_ID, INTEGRATION_CHAPTER_ID)
    }

    fn start_with_scope(mode: &str, delay_ms: u64, novel_id: &str, chapter_id: &str) -> Self {
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
            .env("MOCK_WORKBENCH_NOVEL_ID", novel_id)
            .env("MOCK_WORKBENCH_CHAPTER_ID", chapter_id)
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

fn request_rows(snapshot: &Value) -> &[Value] {
    snapshot
        .get("requests")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .expect("mock upstream request rows")
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

fn seed_chapter(novel_id: &str, chapter_id: &str) {
    let connection = crate::db::get_connection()
        .lock()
        .expect("test database lock");
    connection
        .execute(
            "INSERT INTO chapters (
                id, novel_id, title, order_index, status, word_count, created_at, updated_at
             ) VALUES (?1, ?2, 'Canonical read chapter', 1, 'not_started', 0, ?3, ?3)",
            rusqlite::params![chapter_id, novel_id, "2026-08-21T00:00:00Z"],
        )
        .expect("seed chapter");
}

fn seed_gateway_scope(scratch: &ScratchDir, novel_id: &str, chapter_id: &str) {
    let connection = Connection::open(scratch.path().join("gateway.sqlite"))
        .expect("open start-path gateway database");
    connection
        .execute(
            "INSERT OR IGNORE INTO novels (id, title, outline, created_at, updated_at)
             VALUES (?1, 'Canonical read novel', '', ?2, ?2)",
            rusqlite::params![novel_id, "2026-08-21T00:00:00Z"],
        )
        .expect("seed gateway novel");
    connection
        .execute(
            "INSERT OR IGNORE INTO chapters (
                id, novel_id, title, order_index, status, word_count, created_at, updated_at
             ) VALUES (?1, ?2, 'Canonical read chapter', 1, 'not_started', 0, ?3, ?3)",
            rusqlite::params![chapter_id, novel_id, "2026-08-21T00:00:00Z"],
        )
        .expect("seed gateway chapter");
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

fn assert_no_model_attestation(run: &conversation_service::TaskRunRecord) {
    assert!(
        run.model_snapshot
            .pointer("/runtime/toolCallingAttestation")
            .is_none(),
        "actual task execution must not manufacture model verification evidence"
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
        novel_id: Some(novel_id.to_string()),
        scope: None,
        turn_id: turn_id.to_string(),
        goal: goal.to_string(),
        chapter_id: None,
        task_kind: "read".to_string(),
        expected_tool: None,
        expected_artifact_type: None,
        required_read_tools: Vec::new(),
        book_word_goal: None,
        chapter_word_range: None,
        revision_source: None,
        verified_revision_source: None,
        model_snapshot: start_task_snapshot(upstream, model),
        request_policy: default_request_policy(),
        api_key: String::new(),
        continuity_claim: None,
        verified_continuity: None,
        continuity_checked: false,
        chapter_host_gate: None,
        retry_source_run_id: None,
        unified_runtime: None,
        execution: None,
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
        novel_id: Some(novel_id.clone()),
        scope: None,
        turn_id: turn_id.clone(),
        goal: "读取其他章节".to_string(),
        chapter_id: Some(other_chapter_id.clone()),
        task_kind: "read".to_string(),
        expected_tool: None,
        expected_artifact_type: None,
        required_read_tools: Vec::new(),
        book_word_goal: None,
        chapter_word_range: None,
        revision_source: None,
        verified_revision_source: None,
        model_snapshot: start_task_snapshot("http://127.0.0.1:9/v1", "scope-model"),
        request_policy: default_request_policy(),
        api_key: String::new(),
        continuity_claim: None,
        verified_continuity: None,
        continuity_checked: false,
        chapter_host_gate: None,
        retry_source_run_id: None,
        unified_runtime: None,
        execution: None,
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
fn creative_dialogue_start_path_initializes_its_narrow_registry_without_an_attestation() {
    let _guard = START_PATH_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let scratch = ScratchDir::new("creative-start");
    let _environment = StartPathEnvironment::new(&scratch);
    let upstream = MockWorkbench::start("text-only", 0);
    let (conversation_id, novel_id, turn_id) = seed_task_turn("creative-start");
    let input: StartTaskTurnInput = serde_json::from_value(json!({
        "conversationId":conversation_id,"novelId":novel_id,"turnId":turn_id,
        "goal":"我想写现实港口悬疑，先讨论设定", "taskKind":"creative_dialogue",
        "modelSnapshot":start_task_snapshot(&upstream.upstream_base_url,"creative-model"),
        "requestPolicy":default_request_policy()
    }))
    .expect("native creative dialogue input");
    let result = task_runtime::start(input).unwrap_or_else(|error| {
        panic!(
            "creative start failed: {error}; upstream={}",
            upstream.snapshot()
        )
    });
    assert_eq!(result.run.status, "completed");
    assert!(result.model_tool_attestation.is_none());
    assert!(result.artifact_id.is_none());
    assert!(result.planned_action.is_none());
    assert_no_model_attestation(&result.run);
    let requests = upstream.snapshot();
    assert_eq!(
        requests["requestCount"], 1,
        "only the real dialogue request is dispatched"
    );
    assert_eq!(requests["requests"][0]["phase"], "text-only");
    task_runtime::debug_kill_worker(&conversation_id);
}

#[test]
fn start_path_missing_exact_credential_is_a_persisted_dialogue_failure() {
    let _guard = START_PATH_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let scratch = ScratchDir::new("direct-credential-fail");
    let _environment = StartPathEnvironment::new(&scratch);
    let (conversation_id, novel_id, turn_id) = seed_task_turn("direct-credential-fail");
    let error = try_start_turn(
        &conversation_id,
        &novel_id,
        &turn_id,
        "https://provider.invalid/v1",
        "configured-but-no-key",
        "读取作品上下文",
    )
    .expect_err("missing exact credentials fail without dispatching to another model");
    assert!(error.contains("Provider API Key"), "{error}");
    let connection = crate::db::get_connection()
        .lock()
        .expect("test database lock");
    let bundle = conversation_service::get(&connection, &conversation_id)
        .expect("read conversation")
        .expect("conversation exists");
    assert_eq!(bundle.runs.len(), 1);
    assert_eq!(bundle.runs[0].status, "failed");
    assert_eq!(
        bundle.runs[0].model_snapshot["modelId"],
        "configured-but-no-key"
    );
    assert_no_model_attestation(&bundle.runs[0]);
    assert!(bundle
        .turns
        .iter()
        .any(|turn| turn.role == "assistant" && turn.content.contains("任务运行失败")));
    assert!(!task_runtime::debug_has_worker_process(&conversation_id));
}

#[test]
fn start_path_records_actual_model_failure_without_a_capability_probe() {
    let _guard = START_PATH_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let scratch = ScratchDir::new("direct-model-fail");
    let _environment = StartPathEnvironment::new(&scratch);
    let upstream = MockWorkbench::start("tool-error", 0);
    let (conversation_id, novel_id, turn_id) = seed_task_turn("direct-model-fail");
    let error = try_start_turn(
        &conversation_id,
        &novel_id,
        &turn_id,
        &upstream.upstream_base_url,
        "model-without-verified-tools",
        "读取作品上下文",
    )
    .expect_err("actual tool execution fails inside the conversation");
    assert!(
        !error.contains("MODEL_TOOL_CALLING_NOT_VERIFIED"),
        "{error}"
    );
    let connection = crate::db::get_connection()
        .lock()
        .expect("test database lock");
    let bundle = conversation_service::get(&connection, &conversation_id)
        .expect("read conversation")
        .expect("conversation exists");
    assert_eq!(bundle.runs.len(), 1);
    assert_eq!(bundle.runs[0].status, "failed");
    assert!(bundle.runs[0].error.is_some());
    assert!(bundle
        .turns
        .iter()
        .any(|turn| turn.role == "assistant" && turn.content.contains("任务运行失败")));
    assert!(bundle.runs[0]
        .model_snapshot
        .pointer("/runtime/toolCallingAttestation")
        .is_none());
    drop(connection);
    let requests = upstream.snapshot();
    assert!(requests["requests"]
        .as_array()
        .unwrap()
        .iter()
        .all(|request| !request["phase"]
            .as_str()
            .unwrap_or("")
            .contains("attestation")));
    task_runtime::debug_kill_worker(&conversation_id);
}

#[test]
fn start_path_cancellation_aborts_actual_request_and_persists_cancelled_run() {
    let _guard = START_PATH_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let scratch = ScratchDir::new("attestation-cancel");
    let _environment = StartPathEnvironment::new(&scratch);
    let upstream = MockWorkbench::start("delayed-text", 20_000);
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
                "取消实际对话请求",
            )
        }
    });

    upstream.wait_for(
        "delayed actual dialogue request",
        Duration::from_secs(30),
        |value| {
            value.get("requestCount").and_then(Value::as_u64) == Some(1)
                && value.pointer("/requests/0/phase").and_then(Value::as_str) == Some("text-only")
        },
    );
    assert!(task_runtime::list_statuses()
        .iter()
        .any(|status| { status.conversation_id == conversation_id && status.status == "running" }));

    let cancel_started = Instant::now();
    let cancelled = task_runtime::cancel(&conversation_id).expect("cancel actual model request");
    assert_eq!(cancelled.status, "cancel_requested");
    let error = start_handle
        .join()
        .expect("actual request thread")
        .expect_err("cancelled actual request must fail");
    assert!(
        !error.contains("MODEL_TOOL_ATTESTATION"),
        "unexpected cancellation error: {error}"
    );
    assert!(
        cancel_started.elapsed() < Duration::from_secs(5),
        "actual cancellation must abort promptly"
    );

    let mut connection = crate::db::get_connection()
        .lock()
        .expect("test database lock");
    let bundle = conversation_service::get(&connection, &conversation_id)
        .expect("read conversation")
        .expect("conversation exists");
    assert_eq!(bundle.runs.len(), 1);
    assert_eq!(bundle.runs[0].status, "cancelled");
    assert_no_model_attestation(&bundle.runs[0]);
    assert_eq!(upstream.snapshot()["requestCount"], 1);
    let policy = crate::services::ai_request_policy_service::get_snapshot(&mut connection)
        .expect("read request policy after actual cancellation");
    assert_eq!(
        policy.active_requests, 0,
        "actual cancellation must settle the governed request lease"
    );
}

#[test]
fn start_path_followup_reuses_session_and_resumes_after_child_exit() {
    let _guard = START_PATH_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let scratch = ScratchDir::new("start-followup");
    let _environment = StartPathEnvironment::new(&scratch);
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
    assert!(first.model_tool_attestation.is_none());
    assert!(first.model_tool_attestation.is_none());
    assert_no_model_attestation(&first.run);
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
    assert_eq!(second.session_lifecycle.as_deref(), Some("resumed"));
    assert!(second.model_tool_attestation.is_none());
    assert_no_model_attestation(&second.run);

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
        assert_no_model_attestation(persisted_first);
        assert_no_model_attestation(persisted_second);
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
    assert!(resumed.model_tool_attestation.is_none());
    assert_no_model_attestation(&resumed.run);
}

#[test]
fn start_path_model_switch_uses_exact_directory_and_preserves_session_history() {
    let _guard = START_PATH_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let scratch = ScratchDir::new("start-model-switch");
    let _environment = StartPathEnvironment::new(&scratch);
    let upstream = MockWorkbench::start("text-only", 0);
    let (conversation_id, novel_id, first_turn_id) = seed_task_turn("model-switch-start");
    let first = start_turn(
        &conversation_id,
        &novel_id,
        &first_turn_id,
        &upstream.upstream_base_url,
        "directory-model-alpha",
        "MODEL_SWITCH_FIRST",
    );
    let first_snapshot = first.run.model_snapshot.clone();
    let next_snapshot = start_task_snapshot(&upstream.upstream_base_url, "directory-model-beta");
    let selected_health = task_runtime::runtime_health_with_probe(
        Some(&conversation_id),
        true,
        Some(&next_snapshot),
        None,
    )
    .expect("refresh the next model's independent directory")
    .expect("selected model directory is available");
    assert_eq!(selected_health["route"]["model"], "directory-model-beta");
    assert!(task_runtime::debug_has_worker_process(&conversation_id));

    let unselected_health =
        task_runtime::runtime_health_with_probe(Some(&conversation_id), false, None, None)
            .expect("a read-only plugin view without selection remains compatible")
            .expect("without a snapshot the idle task worker still provides its directory");
    assert_eq!(unselected_health["route"]["model"], "directory-model-alpha");

    let first_health = task_runtime::runtime_health_with_probe(
        Some(&conversation_id),
        false,
        Some(&first_snapshot),
        None,
    )
    .expect("old idle worker remains readable")
    .expect("old worker has not been stopped by directory refresh");
    assert_eq!(first_health["route"]["model"], "directory-model-alpha");
    let cached_next_health = task_runtime::runtime_health_with_probe(
        Some(&conversation_id),
        false,
        Some(&next_snapshot),
        None,
    )
    .expect("ordinary task refresh must skip the previous model's worker")
    .expect("reuse the exact next-model probe");
    assert_eq!(cached_next_health["route"]["model"], "directory-model-beta");

    let second_turn_id = append_followup_turn(&conversation_id, "MODEL_SWITCH_SECOND");
    let second = start_turn(
        &conversation_id,
        &novel_id,
        &second_turn_id,
        &upstream.upstream_base_url,
        "directory-model-beta",
        "MODEL_SWITCH_SECOND",
    );
    assert_eq!(second.worker_id, first.worker_id);
    assert_eq!(second.session_id, first.session_id);
    assert_eq!(second.session_lifecycle.as_deref(), Some("resumed"));
    assert!(second.model_tool_attestation.is_none());
    let connection = crate::db::get_connection()
        .lock()
        .expect("test database lock");
    let persisted = conversation_service::get(&connection, &conversation_id)
        .expect("read both immutable model runs")
        .expect("conversation still exists");
    assert_eq!(persisted.runs.len(), 2);
    assert_eq!(
        persisted
            .runs
            .iter()
            .find(|run| run.run_id == first.run.run_id)
            .unwrap()
            .model_snapshot,
        first_snapshot,
    );
    assert_eq!(second.run.model_snapshot["modelId"], "directory-model-beta");
    drop(connection);
    let requests = upstream.snapshot();
    assert!(
        request_rows(&requests).iter().any(|row| {
            row.get("model").and_then(Value::as_str) == Some("directory-model-beta")
                && row.pointer("/roles/user").and_then(Value::as_u64) == Some(2)
        }),
        "the new model's request must retain the previous user turn"
    );
    task_runtime::debug_kill_worker(&conversation_id);
}

#[test]
fn start_path_two_conversations_cancel_one_without_stopping_the_other() {
    let _guard = START_PATH_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let started_at = Instant::now();
    let scratch = ScratchDir::new("start-parallel");
    let _environment = StartPathEnvironment::new(&scratch);
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

fn is_canonical_read_tool_name(name: &str) -> bool {
    if name.contains("read_context") || name.contains("generate_") {
        return false;
    }
    [
        ("novel.read", "novel_read"),
        ("structure.read", "structure_read"),
        ("context.read", "context_read"),
        ("memory.search", "memory_search"),
    ]
    .iter()
    .any(|(canonical, underscored)| {
        name == *canonical
            || name == *underscored
            || name.ends_with(canonical)
            || name.contains(&format!("{underscored}_"))
            || name.contains(&format!("__{underscored}"))
    })
}

#[test]
fn canonical_read_turn_uses_canonical_tools_and_writes_no_artifacts() {
    let _guard = START_PATH_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let scratch = ScratchDir::new("canonical-read-turn");
    let _environment = StartPathEnvironment::new(&scratch);
    let (conversation_id, novel_id, turn_id) = seed_task_turn("canonical-read");
    let chapter_id = format!("chapter-canonical-read-{}", uuid::Uuid::new_v4());
    seed_chapter(&novel_id, &chapter_id);
    seed_gateway_scope(&scratch, &novel_id, &chapter_id);
    let upstream = MockWorkbench::start_with_scope("normal", 0, &novel_id, &chapter_id);

    let result = task_runtime::start(StartTaskTurnInput {
        conversation_id: conversation_id.clone(),
        novel_id: Some(novel_id.clone()),
        scope: None,
        turn_id: turn_id.clone(),
        goal: "读取当前作品与章节上下文，给出下一步创作建议".to_string(),
        chapter_id: Some(chapter_id.clone()),
        task_kind: "read".to_string(),
        expected_tool: None,
        expected_artifact_type: None,
        required_read_tools: Vec::new(),
        book_word_goal: None,
        chapter_word_range: None,
        revision_source: None,
        verified_revision_source: None,
        model_snapshot: start_task_snapshot(&upstream.upstream_base_url, "canonical-read-model"),
        request_policy: default_request_policy(),
        api_key: String::new(),
        continuity_claim: None,
        verified_continuity: None,
        continuity_checked: false,
        chapter_host_gate: None,
        retry_source_run_id: None,
        unified_runtime: None,
        execution: None,
    })
    .unwrap_or_else(|error| {
        panic!(
            "canonical_read_turn: {error}; upstream={}; policy={}",
            upstream.snapshot(),
            request_policy_diagnostics()
        )
    });
    assert!(
        result.run.status == "completed" || result.run.status == "failed",
        "canonical read turn must be terminal, got {}",
        result.run.status
    );
    if let Some(error) = &result.run.error {
        assert!(
            !error.contains("DSH_TASK_CONTRACT_INVALID"),
            "canonical read turn failed with contract error: {error}"
        );
    }
    assert_eq!(result.artifact_id, None);
    let run_id = result.run.run_id.clone();

    let connection = crate::db::get_connection()
        .lock()
        .expect("test database lock");
    let tool_names = connection
        .prepare("SELECT tool_name FROM tool_call_events WHERE run_id=?1 ORDER BY sequence")
        .expect("prepare tool events")
        .query_map(rusqlite::params![run_id], |row| row.get::<_, String>(0))
        .expect("query tool events")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect tool events");
    let workbench_tools = tool_names
        .iter()
        .filter(|name| !name.starts_with("dsh."))
        .cloned()
        .collect::<Vec<_>>();
    for expected in [
        "novel.read",
        "structure.read",
        "context.read",
        "memory.search",
    ] {
        assert!(
            workbench_tools.iter().any(|name| {
                name == expected
                    || name.ends_with(expected)
                    || is_canonical_read_tool_name(name)
                        && name.contains(&expected.replace('.', "_"))
            }),
            "canonical_read_turn must record {expected}: {tool_names:?}"
        );
    }
    assert!(
        workbench_tools
            .iter()
            .all(|name| { !name.contains("generate_chapter") && !name.contains("read_context") }),
        "canonical_read_turn must not call generate_chapter or legacy read aliases: {tool_names:?}"
    );
    let artifacts: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM result_artifacts WHERE source_novel_id=?1",
            rusqlite::params![novel_id],
            |row| row.get(0),
        )
        .expect("count result artifacts");
    assert_eq!(artifacts, 0);
    let cards: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM conversation_artifact_cards WHERE conversation_id=?1",
            rusqlite::params![conversation_id],
            |row| row.get(0),
        )
        .expect("count artifact cards");
    assert_eq!(cards, 0);
    let (word_count, adopted_draft_id): (i64, Option<String>) = connection
        .query_row(
            "SELECT word_count, adopted_draft_id FROM chapters WHERE id=?1",
            rusqlite::params![chapter_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("read chapter snapshot");
    assert_eq!(word_count, 0);
    assert_eq!(adopted_draft_id, None);
    let adopted_drafts: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM chapter_drafts WHERE chapter_id=?1 AND is_adopted=1",
            rusqlite::params![chapter_id],
            |row| row.get(0),
        )
        .expect("count adopted drafts");
    assert_eq!(adopted_drafts, 0);
    drop(connection);

    let snapshot = upstream.snapshot();
    let snapshot_text = snapshot.to_string();
    assert!(!snapshot_text.contains("sk-"));
    assert!(!snapshot_text.contains("Bearer"));
    assert!(!snapshot_text.contains("api_key"));
    task_runtime::debug_kill_worker(&conversation_id);
}

const R4_PINNED_COMMIT: &str = "47f943859bef60e4160492346772ded9b24f765a";
const R4_MAX_REQUESTS: i64 = 6;
const R4_RATE_WINDOW: Duration = Duration::from_secs(55);
const R4_ABSOLUTE_DEADLINE: Duration = Duration::from_secs(150);
const R4_GOAL: &str = "读取当前作品与章节上下文，给出下一步创作建议";

fn r4_bounded(name: &str, min: i64, max: i64) -> i64 {
    let Ok(raw) = std::env::var(name) else {
        panic!("{name}_REQUIRED");
    };
    if !raw.bytes().all(|byte| byte.is_ascii_digit()) || raw.len() > 9 {
        panic!("{name}_INVALID");
    }
    let Ok(value) = raw.parse::<i64>() else {
        panic!("{name}_INVALID");
    };
    if !(min..=max).contains(&value) {
        panic!("{name}_OUT_OF_RANGE");
    }
    value
}

fn r4_api_key() -> String {
    let Ok(raw) = std::env::var("ANS_R4_API_KEY") else {
        panic!("ANS_R4_API_KEY_REQUIRED");
    };
    let key = raw.trim();
    if key.len() < 8
        || key.len() > 16_384
        || key.chars().any(char::is_control)
        || key.chars().any(char::is_whitespace)
    {
        panic!("ANS_R4_API_KEY_INVALID");
    }
    let key = key.to_string();
    std::env::remove_var("ANS_R4_API_KEY");
    key
}

fn r4_endpoint() -> String {
    let Ok(raw) = std::env::var("ANS_R4_BASE_URL") else {
        panic!("ANS_R4_BASE_URL_INVALID");
    };
    if raw.len() > 2_048
        || raw != raw.trim()
        || raw.ends_with('/')
        || raw.chars().any(char::is_control)
    {
        panic!("ANS_R4_BASE_URL_INVALID");
    }
    let Ok(parsed) = reqwest::Url::parse(&raw) else {
        panic!("ANS_R4_BASE_URL_INVALID");
    };
    let host = parsed.host_str().unwrap_or("");
    let ip_host = host.trim_matches(|character| character == '[' || character == ']');
    let loopback = host.eq_ignore_ascii_case("localhost")
        || ip_host
            .parse::<std::net::IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false);
    if parsed.scheme() != "https"
        || host.is_empty()
        || loopback
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        panic!("ANS_R4_BASE_URL_INVALID");
    }
    raw
}

fn r4_provider() -> String {
    match std::env::var("ANS_R4_PROVIDER").ok().as_deref() {
        Some("deepseek-official" | "openai_compatible") => {
            std::env::var("ANS_R4_PROVIDER").expect("provider")
        }
        _ => panic!("ANS_R4_PROVIDER_INVALID"),
    }
}

fn r4_model() -> String {
    let Ok(model) = std::env::var("ANS_R4_MODEL") else {
        panic!("ANS_R4_MODEL_INVALID");
    };
    let safe = !model.is_empty()
        && model.len() <= 200
        && model == model.trim()
        && model.chars().all(|character| {
            character.is_ascii_alphanumeric()
                || matches!(character, '.' | '_' | ':' | '/' | '+' | '-')
        });
    if !safe {
        panic!("ANS_R4_MODEL_INVALID");
    }
    model
}

fn r4_evidence_path() -> PathBuf {
    let Ok(raw) = std::env::var("ANS_R4_EVIDENCE_PATH") else {
        panic!("ANS_R4_EVIDENCE_PATH_REQUIRED");
    };
    if raw.trim() != raw || raw.is_empty() || raw.len() > 1_024 {
        panic!("ANS_R4_EVIDENCE_PATH_INVALID");
    }
    let path = PathBuf::from(&raw);
    let Some(parent) = path.parent().filter(|parent| parent.is_dir()) else {
        panic!("ANS_R4_EVIDENCE_PATH_INVALID");
    };
    if !path.is_absolute() {
        panic!("ANS_R4_EVIDENCE_PATH_INVALID");
    }
    let parent = parent
        .canonicalize()
        .unwrap_or_else(|_| panic!("ANS_R4_EVIDENCE_PATH_INVALID"));
    let temp = std::env::temp_dir()
        .canonicalize()
        .unwrap_or_else(|_| panic!("ANS_R4_EVIDENCE_PATH_INVALID"));
    let rendered = parent.to_string_lossy().to_ascii_lowercase();
    if !parent.starts_with(&temp) || rendered.contains("com.ainovelstudio.app") || path.exists() {
        panic!("ANS_R4_EVIDENCE_PATH_INVALID");
    }
    path
}

fn r4_verify_carrier() {
    let descriptor = task_runtime::describe_runtime();
    if descriptor.source_commit != R4_PINNED_COMMIT || descriptor.source_commit != DSH_SOURCE_COMMIT {
        panic!("ANS_R4_CARRIER_PIN_MISMATCH");
    }
    if descriptor.status != "available" {
        panic!("ANS_R4_RUNTIME_UNAVAILABLE");
    }
}

fn r4_hash(value: &str) -> String {
    crate::repositories::large_text_repository::sha256(value)
}

fn r4_reservation_count() -> i64 {
    let Ok(connection) = crate::db::get_connection().lock() else {
        return i64::MAX;
    };
    connection
        .query_row("SELECT COUNT(*) FROM ai_request_reservations", [], |row| {
            row.get(0)
        })
        .unwrap_or(i64::MAX)
}

fn r4_exact_canonical_tool(name: &str) -> bool {
    matches!(
        name,
        "novel.read" | "structure.read" | "context.read" | "memory.search"
    )
}

fn r4_public_tool_name(name: &str) -> String {
    if !name.is_empty()
        && name.len() <= 96
        && name.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | ':' | '-')
        })
    {
        name.to_string()
    } else {
        "invalid".to_string()
    }
}

fn r4_public_status(status: &str) -> String {
    if matches!(
        status,
        "succeeded" | "failed" | "cancelled" | "skipped" | "running"
    ) {
        status.to_string()
    } else {
        "invalid".to_string()
    }
}

fn r4_error_code(error: &str) -> Option<String> {
    let token = error
        .split(|character: char| character == ':' || character.is_whitespace())
        .next()
        .unwrap_or("");
    if (3..=80).contains(&token.len())
        && token.chars().all(|character| {
            character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
        })
    {
        Some(token.to_string())
    } else {
        Some("R4_UNCLASSIFIED".to_string())
    }
}

fn r4_file_contains(path: &Path, needle: &str) -> bool {
    let needle = needle.as_bytes();
    if needle.is_empty() {
        return false;
    }
    let Ok(file) = std::fs::File::open(path) else {
        return true;
    };
    let mut reader = std::io::BufReader::new(file);
    let mut carry = Vec::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let Ok(read) = std::io::Read::read(&mut reader, &mut buffer) else {
            return true;
        };
        if read == 0 {
            return false;
        }
        carry.extend_from_slice(&buffer[..read]);
        if carry.windows(needle.len()).any(|window| window == needle) {
            return true;
        }
        if carry.len() > needle.len() {
            let keep = needle.len() - 1;
            carry = carry[carry.len() - keep..].to_vec();
        }
    }
}

fn r4_tree_contains(root: &Path, needle: &str) -> bool {
    let Ok(root_canon) = root.canonicalize() else {
        return true;
    };
    let mut stack = vec![root.to_path_buf()];
    let mut seen = 0usize;
    while let Some(path) = stack.pop() {
        seen += 1;
        if seen > 4_000 {
            return true;
        }
        let Ok(entries) = std::fs::read_dir(&path) else {
            return true;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(canon) = path.canonicalize() else {
                return true;
            };
            if !canon.starts_with(&root_canon) {
                return true;
            }
            let Ok(metadata) = entry.metadata() else {
                return true;
            };
            if metadata.is_dir() {
                stack.push(path);
            } else if metadata.is_file() && r4_file_contains(&path, needle) {
                return true;
            }
        }
    }
    false
}

fn r4_send_count(path: &Path) -> Result<i64, ()> {
    match std::fs::read_to_string(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(_) => Err(()),
        Ok(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return Ok(0);
            }
            if !trimmed.bytes().all(|byte| byte.is_ascii_digit()) || trimmed.len() > 9 {
                return Err(());
            }
            trimmed.parse().map_err(|_| ())
        }
    }
}

struct R4CloudEnvironment {
    _guards: Vec<EnvironmentGuard>,
}

impl R4CloudEnvironment {
    fn new(scratch: &ScratchDir, endpoint: &str, model: &str) -> Self {
        let gateway_database = scratch.path().join("gateway.sqlite");
        let mut connection = Connection::open(&gateway_database)
            .unwrap_or_else(|_| panic!("ANS_R4_GATEWAY_DB_FAILED"));
        crate::db::create_tables(&mut connection)
            .unwrap_or_else(|_| panic!("ANS_R4_GATEWAY_DB_FAILED"));
        drop(connection);
        let local_app = scratch.path().join("local-app-data");
        let roaming = scratch.path().join("app-data");
        std::fs::create_dir_all(&local_app).unwrap_or_else(|_| panic!("ANS_R4_ISOLATION_FAILED"));
        std::fs::create_dir_all(&roaming).unwrap_or_else(|_| panic!("ANS_R4_ISOLATION_FAILED"));
        Self {
            _guards: vec![
                EnvironmentGuard::set("ANS_TASK_WORKER_ROOT", scratch.path()),
                EnvironmentGuard::set("DSH_E2E_GATEWAY_DB_PATH", &gateway_database),
                EnvironmentGuard::set("LOCALAPPDATA", &local_app),
                EnvironmentGuard::set("APPDATA", &roaming),
                EnvironmentGuard::set("PROXY_UPSTREAM_REQUEST_BUDGET", "6"),
                EnvironmentGuard::set(
                    "PROXY_UPSTREAM_BUDGET_FILE",
                    scratch.path().join("upstream-sends.txt"),
                ),
                EnvironmentGuard::set("PROXY_FROZEN_UPSTREAM", endpoint),
                EnvironmentGuard::set("PROXY_FROZEN_MODEL", model),
            ],
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct R4EvidenceTool {
    name: String,
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct R4EvidenceSecrets {
    api_key_persisted: bool,
    api_key_in_evidence: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct R4Evidence {
    schema: &'static str,
    profile: &'static str,
    provider: String,
    model: String,
    endpoint_hash: String,
    source_commit: String,
    run_status: String,
    error_code: Option<String>,
    tools: Vec<R4EvidenceTool>,
    tool_count: usize,
    runtime_event_count: usize,
    upstream_requests: i64,
    upstream_reservations: i64,
    prompt_tokens: i64,
    completion_tokens: i64,
    result_artifact_writes: i64,
    artifact_cards: i64,
    adopted_draft_writes: i64,
    chapter_draft_writes: i64,
    chapter_word_count: i64,
    goal_hash: String,
    novel_id_hash: String,
    chapter_id_hash: String,
    worker_id_hash: Option<String>,
    session_id_hash: Option<String>,
    arguments_hash: String,
    result_hash: String,
    cancelled: bool,
    secrets: R4EvidenceSecrets,
}

/// Ignored cloud Canonical read. Default `cargo test` must not reach a provider.
/// The non-resettable send cap lives in the governed proxy, before `fetch`.
#[test]
#[ignore = "R4 cloud canonical read; explicit ANS_R4_CLOUD_PROFILE=1 only"]
fn canonical_read_turn_cloud_profile() {
    if std::env::var("ANS_R4_CLOUD_PROFILE").ok().as_deref() != Some("1") {
        panic!("ANS_R4_CLOUD_PROFILE_REQUIRED");
    }
    if std::env::var("AI_NOVEL_STUDIO_E2E").ok().as_deref() == Some("1") {
        panic!("ANS_R4_E2E_BLOCKED");
    }
    let provider = r4_provider();
    let model = r4_model();
    let endpoint = r4_endpoint();
    let evidence_path = r4_evidence_path();
    r4_verify_carrier();
    let api_key = r4_api_key();
    let max_requests = r4_bounded("ANS_R4_MAX_REQUESTS", R4_MAX_REQUESTS, R4_MAX_REQUESTS);
    let timeout_seconds = r4_bounded("ANS_R4_TIMEOUT_SECONDS", 10, 20);
    let max_output_tokens = r4_bounded("ANS_R4_MAX_OUTPUT_TOKENS", 256, 4_096);
    let token_budget = r4_bounded("ANS_R4_TOKEN_BUDGET", 4_096, 200_000);
    assert_eq!(max_requests, R4_MAX_REQUESTS);

    let _guard = START_PATH_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let scratch = ScratchDir::new("r4-cloud-read");
    let _environment = R4CloudEnvironment::new(&scratch, &endpoint, &model);
    let database_path = crate::db::get_database_path();
    let rendered = database_path.to_string_lossy().to_ascii_lowercase();
    if !database_path.starts_with(scratch.path()) || rendered.contains("com.ainovelstudio.app") {
        panic!("ANS_R4_DATABASE_NOT_ISOLATED");
    }
    let (conversation_id, novel_id, turn_id) = seed_task_turn("r4-cloud");
    let chapter_id = format!("chapter-r4-cloud-{}", uuid::Uuid::new_v4());
    seed_chapter(&novel_id, &chapter_id);
    seed_gateway_scope(&scratch, &novel_id, &chapter_id);

    let stop = Arc::new(AtomicBool::new(false));
    let cancel_requested = Arc::new(AtomicBool::new(false));
    let watcher = {
        let stop = Arc::clone(&stop);
        let cancel_requested = Arc::clone(&cancel_requested);
        let conversation_id = conversation_id.clone();
        std::thread::spawn(move || {
            let started = Instant::now();
            let mut first_request: Option<Instant> = None;
            loop {
                if stop.load(Ordering::SeqCst) {
                    return;
                }
                let count = r4_reservation_count();
                if count > 0 && first_request.is_none() {
                    first_request = Some(Instant::now());
                }
                let window_elapsed = first_request
                    .map(|instant| instant.elapsed() >= R4_RATE_WINDOW)
                    .unwrap_or(false);
                if count > R4_MAX_REQUESTS
                    || window_elapsed
                    || started.elapsed() >= R4_ABSOLUTE_DEADLINE
                {
                    if !stop.load(Ordering::SeqCst)
                        && task_runtime::cancel(&conversation_id).is_ok()
                    {
                        cancel_requested.store(true, Ordering::SeqCst);
                    }
                    return;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        })
    };

    let result = task_runtime::start(StartTaskTurnInput {
        conversation_id: conversation_id.clone(),
        novel_id: Some(novel_id.clone()),
        scope: None,
        turn_id,
        goal: R4_GOAL.to_string(),
        chapter_id: None,
        task_kind: "read".to_string(),
        expected_tool: None,
        expected_artifact_type: None,
        required_read_tools: Vec::new(),
        book_word_goal: None,
        chapter_word_range: None,
        revision_source: None,
        verified_revision_source: None,
        continuity_claim: None,
        verified_continuity: None,
        continuity_checked: false,
        chapter_host_gate: None,
        retry_source_run_id: None,
        unified_runtime: None,
        execution: None,
        model_snapshot: json!({
            "providerId": provider,
            "modelId": model,
            "runtimeMode": "api",
            "baseUrl": endpoint,
            "capabilities": ["conversation_turn", "chapter_generate"],
            "options": { "maxTokens": max_output_tokens },
            "runtime": {
                "adapterProtocol": DSH_PROTOCOL,
                "adapterProvider": provider,
                "dshSourceCommit": DSH_SOURCE_COMMIT,
                "bundle": "pinned-dsh-carrier",
                "profile": "conversational-workbench-v2"
            }
        }),
        request_policy: TaskRequestPolicyInput {
            max_requests_per_minute: R4_MAX_REQUESTS,
            max_concurrent_requests: 1,
            daily_token_budget: Some(token_budget),
            daily_cost_budget_usd: None,
            warning_percent: 80,
            timeout_seconds,
        },
        api_key: api_key.clone(),
    });
    stop.store(true, Ordering::SeqCst);
    let _ = watcher.join();

    let (mut run_status, mut worker_id, session_id, error_code) = match &result {
        Ok(value) => (
            value.run.status.clone(),
            value.run.worker_id.clone(),
            Some(value.session_id.clone()),
            None,
        ),
        Err(error) => (
            "not_started".to_string(),
            String::new(),
            None,
            r4_error_code(error),
        ),
    };
    let run_id = result.as_ref().ok().map(|value| value.run.run_id.clone());
    let artifact_present = matches!(&result, Ok(value) if value.artifact_id.is_some());
    let chapter_candidate =
        matches!(&result, Ok(value) if value.pending_chapter_candidate.is_some());
    drop(result);

    let connection = crate::db::get_connection()
        .lock()
        .unwrap_or_else(|_| panic!("ANS_R4_EVIDENCE_QUERY_FAILED"));
    let mut secret_in_db = false;
    match connection.query_row(
        "SELECT run_id, status, worker_id, COALESCE(error, ''), model_snapshot_json
         FROM task_runs WHERE conversation_id=?1 ORDER BY rowid DESC LIMIT 1",
        rusqlite::params![conversation_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        },
    ) {
        Ok(row) => {
            if run_id.is_none() {
                run_status = row.1.clone();
                worker_id = row.2.clone();
            }
            secret_in_db = row.3.contains(&api_key) || row.4.contains(&api_key);
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => {}
        Err(_) => panic!("ANS_R4_EVIDENCE_QUERY_FAILED"),
    }
    let queried_run = run_id.unwrap_or_default();
    let tool_rows = {
        let mut tool_statement = connection
            .prepare(
                "SELECT tool_name, status, arguments_summary_json, COALESCE(result_json, '')
                 FROM tool_call_events WHERE run_id=?1 ORDER BY sequence",
            )
            .unwrap_or_else(|_| panic!("ANS_R4_EVIDENCE_QUERY_FAILED"));
        tool_statement
            .query_map(rusqlite::params![queried_run], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .unwrap_or_else(|_| panic!("ANS_R4_EVIDENCE_QUERY_FAILED"))
            .collect::<Result<Vec<_>, _>>()
            .unwrap_or_else(|_| panic!("ANS_R4_EVIDENCE_QUERY_FAILED"))
    };
    let reservations: i64 = connection
        .query_row("SELECT COUNT(*) FROM ai_request_reservations", [], |row| {
            row.get(0)
        })
        .unwrap_or(i64::MAX);
    let (prompt_tokens, completion_tokens) = connection
        .query_row(
            "SELECT COALESCE(SUM(token_input), 0), COALESCE(SUM(token_output), 0)
             FROM ai_request_daily_usage",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .unwrap_or_else(|_| panic!("ANS_R4_EVIDENCE_QUERY_FAILED"));
    let artifacts: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM result_artifacts WHERE source_novel_id=?1",
            rusqlite::params![novel_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| panic!("ANS_R4_EVIDENCE_QUERY_FAILED"));
    let cards: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM conversation_artifact_cards WHERE conversation_id=?1",
            rusqlite::params![conversation_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| panic!("ANS_R4_EVIDENCE_QUERY_FAILED"));
    let (word_count, adopted_draft_id): (i64, Option<String>) = connection
        .query_row(
            "SELECT word_count, adopted_draft_id FROM chapters WHERE id=?1",
            rusqlite::params![chapter_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap_or_else(|_| panic!("ANS_R4_EVIDENCE_QUERY_FAILED"));
    let adopted_drafts: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM chapter_drafts WHERE chapter_id=?1 AND is_adopted=1",
            rusqlite::params![chapter_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| panic!("ANS_R4_EVIDENCE_QUERY_FAILED"));
    let chapter_drafts: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM chapter_drafts WHERE chapter_id=?1",
            rusqlite::params![chapter_id],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| panic!("ANS_R4_EVIDENCE_QUERY_FAILED"));
    drop(connection);

    let mut evidence_tools = Vec::new();
    let mut runtime_events = 0usize;
    let mut argument_blob = String::new();
    let mut result_blob = String::new();
    let mut secret_in_rows = false;
    for (name, status, arguments, result_json) in &tool_rows {
        if arguments.contains(&api_key) || result_json.contains(&api_key) {
            secret_in_rows = true;
        }
        if name.starts_with("dsh.") {
            runtime_events += 1;
            continue;
        }
        argument_blob.push_str(arguments);
        argument_blob.push('\n');
        result_blob.push_str(result_json);
        result_blob.push('\n');
        let public_name = if r4_exact_canonical_tool(name) {
            name.clone()
        } else {
            r4_public_tool_name(name)
        };
        evidence_tools.push(R4EvidenceTool {
            name: public_name,
            status: r4_public_status(status),
        });
    }
    let sends = r4_send_count(&scratch.path().join("upstream-sends.txt")).unwrap_or(-1);
    let persisted = secret_in_db
        || secret_in_rows
        || worker_id.contains(&api_key)
        || r4_tree_contains(scratch.path(), &api_key);
    let cancelled = cancel_requested.load(Ordering::SeqCst) || run_status == "cancelled";
    let mut evidence = R4Evidence {
        schema: "r4-canonical-read-evidence-v1",
        profile: "cloud",
        provider,
        model,
        endpoint_hash: r4_hash(&endpoint),
        source_commit: R4_PINNED_COMMIT.to_string(),
        run_status: run_status.clone(),
        error_code,
        tools: evidence_tools,
        tool_count: 0,
        runtime_event_count: runtime_events,
        upstream_requests: sends,
        upstream_reservations: reservations,
        prompt_tokens,
        completion_tokens,
        result_artifact_writes: artifacts,
        artifact_cards: cards,
        adopted_draft_writes: adopted_drafts,
        chapter_draft_writes: chapter_drafts,
        chapter_word_count: word_count,
        goal_hash: r4_hash(R4_GOAL),
        novel_id_hash: r4_hash(&novel_id),
        chapter_id_hash: r4_hash(&chapter_id),
        worker_id_hash: if worker_id.is_empty() {
            None
        } else {
            Some(r4_hash(&worker_id))
        },
        session_id_hash: session_id.as_deref().map(r4_hash),
        arguments_hash: r4_hash(&argument_blob),
        result_hash: r4_hash(&result_blob),
        cancelled,
        secrets: R4EvidenceSecrets {
            api_key_persisted: persisted,
            api_key_in_evidence: false,
        },
    };
    evidence.tool_count = evidence.tools.len();
    let body = serde_json::to_vec_pretty(&evidence)
        .unwrap_or_else(|_| panic!("ANS_R4_EVIDENCE_WRITE_FAILED"));
    let body_text =
        String::from_utf8(body.clone()).unwrap_or_else(|_| panic!("ANS_R4_EVIDENCE_SECRET"));
    if body_text.contains(&api_key)
        || body_text.contains("Bearer ")
        || body_text.to_ascii_lowercase().contains("api_key")
    {
        panic!("ANS_R4_EVIDENCE_SECRET");
    }
    std::fs::write(&evidence_path, body).unwrap_or_else(|_| panic!("ANS_R4_EVIDENCE_WRITE_FAILED"));
    task_runtime::debug_kill_worker(&conversation_id);

    let names = evidence
        .tools
        .iter()
        .map(|tool| tool.name.as_str())
        .collect::<Vec<_>>();
    let canonical_ok = [
        "novel.read",
        "structure.read",
        "context.read",
        "memory.search",
    ]
    .iter()
    .all(|required| names.contains(required))
        && evidence
            .tools
            .iter()
            .all(|tool| r4_exact_canonical_tool(&tool.name) && tool.status == "succeeded");
    let pass = run_status == "completed"
        && !cancelled
        && adopted_draft_id.is_none()
        && canonical_ok
        && sends >= 1
        && sends <= R4_MAX_REQUESTS
        && reservations >= sends
        && reservations != i64::MAX
        && !artifact_present
        && !chapter_candidate
        && artifacts == 0
        && cards == 0
        && word_count == 0
        && adopted_drafts == 0
        && chapter_drafts == 0
        && !persisted;
    if !pass {
        panic!(
            "R4_CLOUD_READ_FAILED status={run_status} sends={sends} reservations={reservations} tools={} artifacts={artifacts} cancelled={cancelled}",
            names.join(",")
        );
    }
}

#[test]
fn native_upstream_budget_rejects_seventh_send_redirect_and_identity_drift() {
    let _guard = START_PATH_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let scratch = ScratchDir::new("native-budget-boundary");
    let budget_file = scratch.path().join("sends.txt");
    let steal_listener =
        std::net::TcpListener::bind("127.0.0.1:0").expect("bind steal target listener");
    let steal_port = steal_listener.local_addr().unwrap().port();
    let stolen = Arc::new(AtomicBool::new(false));
    let stolen_flag = Arc::clone(&stolen);
    std::thread::spawn(move || {
        steal_listener.set_nonblocking(true).ok();
        for _ in 0..40 {
            if let Ok((mut stream, _)) = steal_listener.accept() {
                stolen_flag.store(true, Ordering::SeqCst);
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}");
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    });

    let redirect_listener =
        std::net::TcpListener::bind("127.0.0.1:0").expect("bind redirect upstream");
    let redirect_port = redirect_listener.local_addr().unwrap().port();
    let hits = Arc::new(Mutex::new(0u64));
    let hits_counter = Arc::clone(&hits);
    std::thread::spawn(move || {
        for index in 0..6 {
            let Ok((mut stream, _)) = redirect_listener.accept() else {
                return;
            };
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf);
            *hits_counter.lock().unwrap() += 1;
            if index == 0 {
                let header = format!(
                    "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{steal_port}/stolen\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                );
                let _ = stream.write_all(header.as_bytes());
            } else {
                let body = r#"{"choices":[{"message":{"content":"ok"}}]}"#;
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(header.as_bytes());
            }
        }
    });

    let frozen = format!("http://127.0.0.1:{redirect_port}/v1");
    let _g1 = EnvironmentGuard::set("PROXY_UPSTREAM_REQUEST_BUDGET", "6");
    let _g2 = EnvironmentGuard::set("PROXY_UPSTREAM_BUDGET_FILE", &budget_file);
    let _g3 = EnvironmentGuard::set("PROXY_FROZEN_UPSTREAM", &frozen);
    let _g4 = EnvironmentGuard::set("PROXY_FROZEN_MODEL", "frozen-model");

    let cancel = AtomicBool::new(false);
    let seq = Mutex::new(0u64);
    let call_step = |model: &str| {
        let mut guard = seq.lock().unwrap();
        super::native_agent_transport::complete_chat_step(
            &super::native_agent_transport::NativeChatStepRequest {
                base_url: frozen.clone(),
                api_key: "sk-test-key-never-logged".to_string(),
                model: model.to_string(),
                messages: vec![json!({"role": "user", "content": "ping"})],
                tools: Vec::new(),
                max_tokens: 64,
                temperature: None,
                top_p: None,
                reasoning_effort: None,
                request_timeout: Duration::from_secs(5),
            },
            None,
            &mut guard,
            &cancel,
            Instant::now() + Duration::from_secs(10),
        )
    };

    let redirected = call_step("frozen-model").expect_err("302 redirect must fail closed");
    assert!(redirected.contains("HTTP 302"), "{redirected}");
    assert!(!stolen.load(Ordering::SeqCst), "must never follow redirect");

    for _ in 0..5 {
        let ok = call_step("frozen-model").expect("within 6-send cap");
        assert_eq!(ok.content, "ok");
    }
    assert_eq!(*hits.lock().unwrap(), 6);
    assert_eq!(fs::read_to_string(&budget_file).unwrap().trim(), "6");

    let wrong_model = call_step("other-model").expect_err("model drift must fail closed");
    assert!(
        wrong_model.contains("UPSTREAM_MODEL_MISMATCH"),
        "{wrong_model}"
    );
    let seventh = call_step("frozen-model").expect_err("seventh request must fail closed");
    assert!(
        seventh.contains("UPSTREAM_BUDGET_EXCEEDED"),
        "{seventh}"
    );
    assert_eq!(*hits.lock().unwrap(), 6);
}
