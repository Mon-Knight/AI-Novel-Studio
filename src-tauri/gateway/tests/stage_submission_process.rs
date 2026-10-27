//! Process-level contract tests for the explicit `submit_chapter_stage` tool.
//!
//! These tests spawn the real gateway binary with isolated SQLite files and env
//! allowlists. They cover the frozen schema, explicit opt-in listing, bound task
//! scope, and the argument boundaries that must fail closed before any native
//! persistence.

use rusqlite::Connection;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    mpsc::{self, Receiver, RecvTimeoutError},
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const TOOL: &str = "submit_chapter_stage";
const NOVEL: &str = "novel-stage-scope";
const CHAPTER: &str = "chapter-stage-scope";
const CONTENT: &str = "沈砚在雾城钟楼下停步。\n第二行：铜钥匙。";
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(20);

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TempDatabase {
    path: PathBuf,
}

impl TempDatabase {
    fn new() -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after the Unix epoch")
            .as_nanos();
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "ans-gateway-stage-{}-{timestamp}-{sequence}.sqlite",
            std::process::id()
        ));
        let database = Self { path };
        let connection =
            Connection::open(database.path()).expect("create temporary gateway database");
        connection
            .execute_batch(
                "CREATE TABLE novels (
                    id TEXT PRIMARY KEY,
                    deleted_at TEXT
                );
                CREATE TABLE chapters (
                    id TEXT PRIMARY KEY,
                    novel_id TEXT NOT NULL,
                    deleted_at TEXT
                );
                INSERT INTO novels (id, deleted_at) VALUES ('novel-stage-scope', NULL);
                INSERT INTO chapters (id, novel_id, deleted_at)
                VALUES ('chapter-stage-scope', 'novel-stage-scope', NULL);",
            )
            .expect("create stage fixture");
        drop(connection);
        database
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDatabase {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
        for suffix in ["-journal", "-shm", "-wal"] {
            let mut sidecar = self.path.as_os_str().to_os_string();
            sidecar.push(suffix);
            let _ = fs::remove_file(PathBuf::from(sidecar));
        }
    }
}

struct GatewayProcess {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: Receiver<Result<String, String>>,
    stdout_reader: Option<JoinHandle<()>>,
    next_id: u64,
}

fn spawn_stdout_reader(stdout: ChildStdout) -> (Receiver<Result<String, String>>, JoinHandle<()>) {
    let (sender, receiver) = mpsc::channel();
    let reader = thread::spawn(move || {
        let mut stdout = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match stdout.read_line(&mut line) {
                Ok(0) => {
                    let _ = sender.send(Err("gateway stdout closed".to_string()));
                    break;
                }
                Ok(_) => {
                    if sender.send(Ok(line)).is_err() {
                        break;
                    }
                }
                Err(_) => {
                    let _ = sender.send(Err("gateway stdout read failed".to_string()));
                    break;
                }
            }
        }
    });
    (receiver, reader)
}

impl GatewayProcess {
    fn spawn(
        database: &Path,
        allowed_tools: Option<&str>,
        novel_id: Option<&str>,
        chapter_id: Option<&str>,
    ) -> Self {
        let mut command = Command::new(env!("CARGO_BIN_EXE_novel-domain-gateway"));
        command
            .arg("--db")
            .arg(database)
            .env_remove("ANS_ALLOWED_TOOLS")
            .env_remove("ANS_TASK_NOVEL_ID")
            .env_remove("ANS_TASK_CHAPTER_ID")
            .env_remove("ANS_CANDIDATE_POLICY")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        if let Some(allowed_tools) = allowed_tools {
            command.env("ANS_ALLOWED_TOOLS", allowed_tools);
        }
        if let Some(novel_id) = novel_id {
            command.env("ANS_TASK_NOVEL_ID", novel_id);
        }
        if let Some(chapter_id) = chapter_id {
            command.env("ANS_TASK_CHAPTER_ID", chapter_id);
        }
        let mut child = command.spawn().expect("start novel domain gateway");
        let stdin = child.stdin.take().expect("gateway stdin pipe");
        let stdout = child.stdout.take().expect("gateway stdout pipe");
        let (stdout, stdout_reader) = spawn_stdout_reader(stdout);
        Self {
            child,
            stdin: Some(stdin),
            stdout,
            stdout_reader: Some(stdout_reader),
            next_id: 1,
        }
    }

    fn request(&mut self, method: &str, params: Value) -> Value {
        let request_id = self.next_id;
        self.next_id += 1;
        let request = json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params
        });
        let stdin = self.stdin.as_mut().expect("gateway stdin remains open");
        writeln!(stdin, "{request}").expect("write JSON-RPC request");
        stdin.flush().expect("flush JSON-RPC request");

        let response_line = match self.stdout.recv_timeout(RESPONSE_TIMEOUT) {
            Ok(Ok(line)) => line,
            Ok(Err(error)) => panic!("{error}"),
            Err(RecvTimeoutError::Timeout) => panic!("gateway JSON-RPC response timed out"),
            Err(RecvTimeoutError::Disconnected) => panic!("gateway stdout reader disconnected"),
        };
        let response: Value =
            serde_json::from_str(&response_line).expect("parse JSON-RPC response");
        assert_eq!(response["id"], request_id);
        response
    }

    fn list_tools(&mut self) -> Vec<Value> {
        let response = self.request("tools/list", json!({}));
        assert!(response.get("error").is_none(), "{response}");
        response["result"]["tools"]
            .as_array()
            .expect("tools/list result")
            .clone()
    }

    fn call_tool(&mut self, arguments: Value) -> Value {
        self.request(
            "tools/call",
            json!({"name": TOOL, "arguments": arguments}),
        )
    }
}

impl Drop for GatewayProcess {
    fn drop(&mut self) {
        drop(self.stdin.take());
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
        if let Some(reader) = self.stdout_reader.take() {
            let _ = reader.join();
        }
    }
}

fn valid_arguments() -> Value {
    json!({
        "novelId": NOVEL,
        "chapterId": CHAPTER,
        "stageKey": "scene-1/beat-2",
        "stageKind": "beat_write",
        "content": CONTENT
    })
}

fn tool_names(tools: &[Value]) -> Vec<String> {
    tools
        .iter()
        .filter_map(|tool| tool.get("name").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

fn listed_tool<'a>(tools: &'a [Value], name: &str) -> &'a Value {
    tools
        .iter()
        .find(|tool| tool.get("name").and_then(Value::as_str) == Some(name))
        .unwrap_or_else(|| panic!("missing tool schema: {name}"))
}

fn sha256_hex(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

fn assert_tool_error(response: &Value, fragments: &[&str]) -> String {
    assert_eq!(response["result"]["isError"], true, "{response}");
    assert!(
        response["result"].get("structuredContent").is_none(),
        "{response}"
    );
    let text = response["result"]["content"][0]["text"]
        .as_str()
        .expect("tool error text")
        .to_string();
    for fragment in fragments {
        assert!(
            text.contains(fragment),
            "missing error fragment {fragment:?} in {text}"
        );
    }
    text
}

fn assert_success(response: &Value, stage_key: &str, stage_kind: &str, content: &str) {
    assert_eq!(response["result"]["isError"], false, "{response}");
    let structured = &response["result"]["structuredContent"];
    assert_eq!(structured["ok"], true);
    assert_eq!(structured["stageSubmissionVersion"], 1);
    assert_eq!(structured["stageKey"], stage_key);
    assert_eq!(structured["stageKind"], stage_kind);
    assert_eq!(structured["contentHash"], sha256_hex(content));
    assert_eq!(
        structured["contentChars"].as_u64(),
        Some(content.chars().count() as u64)
    );
    let mut keys = structured
        .as_object()
        .expect("structured stage response")
        .keys()
        .map(String::as_str)
        .collect::<Vec<_>>();
    keys.sort_unstable();
    assert_eq!(
        keys,
        vec![
            "contentChars",
            "contentHash",
            "ok",
            "stageKey",
            "stageKind",
            "stageSubmissionVersion"
        ]
    );
    let text_payload: Value = serde_json::from_str(
        response["result"]["content"][0]["text"]
            .as_str()
            .expect("success text must be JSON"),
    )
    .expect("success text must encode structured content");
    assert_eq!(&text_payload, structured);
}

fn assert_rejected(gateway: &mut GatewayProcess, arguments: Value, fragments: &[&str]) -> String {
    let response = gateway.call_tool(arguments);
    assert_tool_error(&response, fragments)
}

#[test]
fn explicit_allowlist_lists_frozen_schema_and_accepts_every_model_stage() {
    let database = TempDatabase::new();
    let mut gateway = GatewayProcess::spawn(
        database.path(),
        Some(TOOL),
        Some(NOVEL),
        Some(CHAPTER),
    );

    let tools = gateway.list_tools();
    assert_eq!(tool_names(&tools), vec![TOOL.to_string()]);
    let schema = listed_tool(&tools, TOOL);
    assert!(schema["description"]
        .as_str()
        .expect("stage tool description")
        .contains("不是章节候选"));
    assert_eq!(schema["inputSchema"]["additionalProperties"], false);
    assert_eq!(
        schema["inputSchema"]["required"],
        json!(["novelId", "chapterId", "stageKey", "stageKind", "content"])
    );
    assert_eq!(
        schema["inputSchema"]["properties"]["stageKind"]["enum"],
        json!(["scene_plan", "beat_plan", "beat_write", "beat_state"])
    );
    assert_eq!(
        schema["inputSchema"]["properties"]["stageKey"]["maxLength"],
        json!(200)
    );
    assert_eq!(
        schema["inputSchema"]["properties"]["content"]["maxLength"],
        json!(262_144)
    );
    assert_eq!(schema["outputSchema"]["additionalProperties"], false);
    assert_eq!(
        schema["outputSchema"]["required"],
        json!([
            "ok",
            "stageSubmissionVersion",
            "stageKey",
            "stageKind",
            "contentHash",
            "contentChars"
        ])
    );
    assert_eq!(
        schema["outputSchema"]["properties"]["stageSubmissionVersion"]["enum"],
        json!([1])
    );
    for forbidden in ["candidateOnly", "artifactType"] {
        assert!(
            schema["outputSchema"]["properties"].get(forbidden).is_none(),
            "stage response must not expose {forbidden}"
        );
    }

    for (index, stage_kind) in ["scene_plan", "beat_plan", "beat_write", "beat_state"]
        .into_iter()
        .enumerate()
    {
        let content = format!(
            "{stage_kind} 阶段内容：沈砚在雾城钟楼下停步。\n第二段：铜钥匙。"
        );
        let response = gateway.call_tool(json!({
            "novelId": NOVEL,
            "chapterId": CHAPTER,
            "stageKey": format!("scene-{index}/beat-{index}"),
            "stageKind": stage_kind,
            "content": content
        }));
        assert_success(
            &response,
            &format!("scene-{index}/beat-{index}"),
            stage_kind,
            &content,
        );
    }

    let raw_content = "  沈砚停步。  \n";
    let response = gateway.call_tool(json!({
        "novelId": NOVEL,
        "chapterId": CHAPTER,
        "stageKey": "raw-content",
        "stageKind": "beat_write",
        "content": raw_content
    }));
    assert_success(&response, "raw-content", "beat_write", raw_content);
}

#[test]
fn successful_stage_submission_does_not_touch_the_database() {
    let database = TempDatabase::new();
    let before = fs::read(database.path()).expect("read fixture database before submission");
    {
        let mut gateway = GatewayProcess::spawn(
            database.path(),
            Some(TOOL),
            Some(NOVEL),
            Some(CHAPTER),
        );
        let response = gateway.call_tool(valid_arguments());
        assert_success(
            &response,
            "scene-1/beat-2",
            "beat_write",
            CONTENT,
        );
    }
    let after = fs::read(database.path()).expect("read fixture database after submission");
    assert_eq!(before, after, "stage submission must not write SQLite");
}

#[test]
fn missing_allowlist_env_hides_tool_and_rejects_calls() {
    let database = TempDatabase::new();
    let mut gateway = GatewayProcess::spawn(database.path(), None, None, None);

    let names = tool_names(&gateway.list_tools());
    assert!(
        !names.contains(&TOOL.to_string()),
        "unrestricted legacy list must not expose the stage tool: {names:?}"
    );
    assert!(names.contains(&"generate_chapter".to_string()));

    let text = assert_rejected(&mut gateway, valid_arguments(), &["not enabled"]);
    assert!(!text.contains(CONTENT));
}

#[test]
fn canonical_only_and_legacy_candidate_allowlists_never_expose_or_call_stage() {
    let database = TempDatabase::new();
    for allowed_tools in [
        "novel.read,structure.read,context.read,memory.search",
        "generate_chapter",
        "generate_outline,generate_characters",
    ] {
        let mut gateway = GatewayProcess::spawn(
            database.path(),
            Some(allowed_tools),
            Some(NOVEL),
            Some(CHAPTER),
        );
        let names = tool_names(&gateway.list_tools());
        assert!(
            !names.contains(&TOOL.to_string()),
            "{allowed_tools} leaked the stage tool: {names:?}"
        );
        assert_rejected(
            &mut gateway,
            valid_arguments(),
            &["tool not allowed for this task"],
        );
    }
}

#[test]
fn explicit_stage_in_mixed_allowlists_is_additive_without_other_legacy_tools() {
    let database = TempDatabase::new();

    let mut canonical = GatewayProcess::spawn(
        database.path(),
        Some("novel.read,submit_chapter_stage"),
        Some(NOVEL),
        Some(CHAPTER),
    );
    assert_eq!(
        tool_names(&canonical.list_tools()),
        vec!["novel.read".to_string(), TOOL.to_string()]
    );
    assert_success(
        &canonical.call_tool(valid_arguments()),
        "scene-1/beat-2",
        "beat_write",
        CONTENT,
    );

    let mut legacy = GatewayProcess::spawn(
        database.path(),
        Some("chapter.read_outline,submit_chapter_stage"),
        Some(NOVEL),
        Some(CHAPTER),
    );
    assert_eq!(
        tool_names(&legacy.list_tools()),
        vec!["chapter.read_outline".to_string(), TOOL.to_string()]
    );
    assert_success(
        &legacy.call_tool(valid_arguments()),
        "scene-1/beat-2",
        "beat_write",
        CONTENT,
    );
}

#[test]
fn stage_calls_require_a_bound_novel_and_chapter_scope() {
    let database = TempDatabase::new();
    let mut gateway = GatewayProcess::spawn(
        database.path(),
        Some(TOOL),
        Some(NOVEL),
        Some(CHAPTER),
    );

    let cross_novel_id = "novel-cross-scope";
    let cross_novel_body = "cross-novel stage body that must stay private";
    let response = gateway.call_tool(json!({
        "novelId": cross_novel_id,
        "chapterId": CHAPTER,
        "stageKey": "scene-1/beat-2",
        "stageKind": "beat_write",
        "content": cross_novel_body
    }));
    assert_tool_error(&response, &["novel scope"]);
    let encoded = serde_json::to_string(&response).expect("serialize scope error");
    for sensitive in [NOVEL, cross_novel_id, CHAPTER, cross_novel_body] {
        assert!(!encoded.contains(sensitive));
    }

    let cross_chapter_id = "chapter-cross-scope";
    let response = gateway.call_tool(json!({
        "novelId": NOVEL,
        "chapterId": cross_chapter_id,
        "stageKey": "scene-1/beat-2",
        "stageKind": "beat_write",
        "content": CONTENT
    }));
    assert_tool_error(&response, &["chapter scope"]);

    let mut unbound_chapter = GatewayProcess::spawn(
        database.path(),
        Some(TOOL),
        Some(NOVEL),
        None,
    );
    assert_rejected(
        &mut unbound_chapter,
        valid_arguments(),
        &["chapter scope"],
    );

    let mut missing_novel = GatewayProcess::spawn(
        database.path(),
        Some(TOOL),
        None,
        Some(CHAPTER),
    );
    assert_rejected(
        &mut missing_novel,
        valid_arguments(),
        &["task scope unavailable"],
    );
}

#[test]
fn stage_arguments_reject_empty_overbytes_unknown_fields_and_host_stages() {
    let database = TempDatabase::new();
    let mut gateway = GatewayProcess::spawn(
        database.path(),
        Some(TOOL),
        Some(NOVEL),
        Some(CHAPTER),
    );

    let mut arguments = valid_arguments();
    arguments["content"] = json!("");
    assert_rejected(&mut gateway, arguments, &["content must be a non-empty"]);

    let mut arguments = valid_arguments();
    arguments["content"] = json!(" \n\t ");
    assert_rejected(&mut gateway, arguments, &["content must be a non-empty"]);

    let mut arguments = valid_arguments();
    arguments["stageKey"] = json!("");
    assert_rejected(&mut gateway, arguments, &["stageKey"]);

    let mut arguments = valid_arguments();
    arguments["stageKey"] = json!("k".repeat(201));
    assert_rejected(&mut gateway, arguments, &["stageKey"]);

    let mut arguments = valid_arguments();
    arguments["content"] = json!("x".repeat(262_145));
    assert_rejected(
        &mut gateway,
        arguments,
        &["content must not exceed 262144 UTF-8 bytes"],
    );

    let mut arguments = valid_arguments();
    arguments["content"] = json!("汉".repeat(87_382));
    assert_rejected(
        &mut gateway,
        arguments,
        &["content must not exceed 262144 UTF-8 bytes"],
    );

    for host_stage in ["scene_close", "chapter_assemble"] {
        let mut arguments = valid_arguments();
        arguments["stageKind"] = json!(host_stage);
        assert_rejected(&mut gateway, arguments, &["stageKind"]);
    }

    let mut arguments = valid_arguments();
    arguments["candidateOnly"] = json!(true);
    assert_rejected(&mut gateway, arguments, &["unknown arguments"]);

    let mut arguments = valid_arguments();
    arguments["novel_id"] = json!(NOVEL);
    assert_rejected(&mut gateway, arguments, &["unknown arguments"]);

    let mut arguments = valid_arguments();
    arguments
        .as_object_mut()
        .expect("valid arguments object")
        .remove("content");
    assert_rejected(&mut gateway, arguments, &["requires novelId"]);

    let mut arguments = valid_arguments();
    arguments["content"] = json!(42);
    assert_rejected(&mut gateway, arguments, &["string field: content"]);

    let mut arguments = valid_arguments();
    let boundary_key = "k".repeat(200);
    arguments["stageKey"] = json!(boundary_key);
    let response = gateway.call_tool(arguments);
    assert_success(&response, &boundary_key, "beat_write", CONTENT);

    let mut arguments = valid_arguments();
    let boundary_ascii = "x".repeat(262_144);
    arguments["content"] = json!(boundary_ascii);
    let response = gateway.call_tool(arguments);
    assert_success(&response, "scene-1/beat-2", "beat_write", &boundary_ascii);

    let boundary_content = "汉".repeat(87_381);
    let mut arguments = valid_arguments();
    arguments["content"] = json!(boundary_content);
    let response = gateway.call_tool(arguments);
    assert_success(
        &response,
        "scene-1/beat-2",
        "beat_write",
        boundary_content.as_str(),
    );
}
