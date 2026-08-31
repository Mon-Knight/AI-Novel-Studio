use rusqlite::Connection;
use serde_json::{json, Value};
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

const ALLOWED_TOOL: &str = "generate_chapter";
const SCOPED_NOVEL_ID: &str = "novel-process-scope";
const SCOPED_CHAPTER_ID: &str = "chapter-process-scope";
const MATCHING_BODY: &str = "A matching candidate body for the process test.";
const GATEWAY_RESPONSE_TIMEOUT: Duration = Duration::from_secs(10);

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
            "ans-gateway-scope-{}-{timestamp}-{sequence}.sqlite",
            std::process::id()
        ));
        let database = Self { path };
        let connection =
            Connection::open(database.path()).expect("create temporary gateway database");
        connection
            .execute_batch(
                "CREATE TABLE chapters (
                    id TEXT PRIMARY KEY,
                    novel_id TEXT NOT NULL,
                    deleted_at TEXT
                );
                INSERT INTO chapters (id, novel_id, deleted_at)
                VALUES ('chapter-process-scope', 'novel-process-scope', NULL);",
            )
            .expect("create minimal chapter fixture");
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
    fn spawn(database: &Path, novel_id: Option<&str>, chapter_id: Option<&str>) -> Self {
        let mut command = Command::new(env!("CARGO_BIN_EXE_novel-domain-gateway"));
        command
            .arg("--db")
            .arg(database)
            .env_remove("ANS_ALLOWED_TOOLS")
            .env_remove("ANS_TASK_NOVEL_ID")
            .env_remove("ANS_TASK_CHAPTER_ID")
            .env_remove("ANS_CANDIDATE_POLICY")
            .env("ANS_ALLOWED_TOOLS", ALLOWED_TOOL)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
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

    fn call_generate_chapter(
        &mut self,
        novel_id: &str,
        chapter_id: &str,
        candidate_text: &str,
    ) -> Value {
        let request_id = self.next_id;
        self.next_id += 1;
        let request = json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "tools/call",
            "params": {
                "name": ALLOWED_TOOL,
                "arguments": {
                    "novelId": novel_id,
                    "chapterId": chapter_id,
                    "candidateText": candidate_text
                }
            }
        });
        let stdin = self.stdin.as_mut().expect("gateway stdin remains open");
        writeln!(stdin, "{request}").expect("write JSON-RPC request");
        stdin.flush().expect("flush JSON-RPC request");

        let response_line = match self.stdout.recv_timeout(GATEWAY_RESPONSE_TIMEOUT) {
            Ok(Ok(line)) => line,
            Ok(Err(error)) => panic!("{error}"),
            Err(RecvTimeoutError::Timeout) => panic!("gateway JSON-RPC response timed out"),
            Err(RecvTimeoutError::Disconnected) => {
                panic!("gateway stdout reader disconnected")
            }
        };
        let response: Value =
            serde_json::from_str(&response_line).expect("parse JSON-RPC response");
        assert_eq!(response["id"], request_id);
        response
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

fn assert_sanitized_tool_error(response: &Value, sensitive_values: &[&str]) {
    assert_eq!(response["result"]["isError"], true);
    assert!(response["result"].get("structuredContent").is_none());
    let encoded = serde_json::to_string(response).expect("serialize error response");
    for sensitive in sensitive_values {
        assert!(
            !encoded.contains(sensitive),
            "scope error response leaked protected input"
        );
    }
}

#[test]
fn gateway_process_enforces_authoritative_task_scope() {
    let database = TempDatabase::new();

    {
        let mut gateway = GatewayProcess::spawn(
            database.path(),
            Some(SCOPED_NOVEL_ID),
            Some(SCOPED_CHAPTER_ID),
        );

        let matching =
            gateway.call_generate_chapter(SCOPED_NOVEL_ID, SCOPED_CHAPTER_ID, MATCHING_BODY);
        assert_eq!(matching["result"]["isError"], false);
        assert_eq!(
            matching["result"]["structuredContent"]["data"]["text"],
            MATCHING_BODY
        );

        let cross_novel_id = "novel-cross-process-scope";
        let cross_novel_body = "A cross-novel candidate body that must stay private.";
        let cross_novel =
            gateway.call_generate_chapter(cross_novel_id, SCOPED_CHAPTER_ID, cross_novel_body);
        assert_sanitized_tool_error(
            &cross_novel,
            &[
                SCOPED_NOVEL_ID,
                cross_novel_id,
                SCOPED_CHAPTER_ID,
                cross_novel_body,
            ],
        );

        let cross_chapter_id = "chapter-cross-process-scope";
        let cross_chapter_body = "A cross-chapter candidate body that must stay private.";
        let cross_chapter =
            gateway.call_generate_chapter(SCOPED_NOVEL_ID, cross_chapter_id, cross_chapter_body);
        assert_sanitized_tool_error(
            &cross_chapter,
            &[
                SCOPED_NOVEL_ID,
                SCOPED_CHAPTER_ID,
                cross_chapter_id,
                cross_chapter_body,
            ],
        );
    }

    {
        let missing_scope_body = "A candidate body sent without the required novel scope.";
        let mut gateway = GatewayProcess::spawn(database.path(), None, None);
        let missing_scope =
            gateway.call_generate_chapter(SCOPED_NOVEL_ID, SCOPED_CHAPTER_ID, missing_scope_body);
        assert_sanitized_tool_error(
            &missing_scope,
            &[SCOPED_NOVEL_ID, SCOPED_CHAPTER_ID, missing_scope_body],
        );
    }
}
