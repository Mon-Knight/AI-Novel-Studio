//! Minimal stdio JSON-RPC supervisor for the DSH SDK runtime (v3.1.0 port of
//! spike P1, extended).
//!
//! Wire facts, verified against `packages/sdk/protocol` at rc.5 (`47f9438`):
//!
//! * requests: `initialize`, `session/prompt`, `shutdown` (no params)
//! * notifications: `session.event`, `session.status`, `subagent.*`
//! * **no prompt cancel and no session close** — cancellation = kill the
//!   process; restart resumes the session from its JSONL root
//! * stdout carries only JSON-RPC frames (malformed lines are ignored)
//!
//! v3.1.0 extensions over the spike:
//!
//! * the child (and every descendant, e.g. the MCP gateway) lives in a Windows
//!   Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` — closing the handle
//!   reaps the whole tree (closes spike report bias #6);
//! * per-session telemetry is tracked from `session.event` notifications
//!   (tool calls, assistant text/reasoning, token usage) for the adapter.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// Supervisor failure with a readable message.
#[derive(Debug)]
pub struct SupervisorError(pub String);

impl std::fmt::Display for SupervisorError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.0)
    }
}

impl std::error::Error for SupervisorError {}

impl From<std::io::Error> for SupervisorError {
    fn from(error: std::io::Error) -> Self {
        SupervisorError(error.to_string())
    }
}

impl From<serde_json::Error> for SupervisorError {
    fn from(error: serde_json::Error) -> Self {
        SupervisorError(error.to_string())
    }
}

/// One parsed stdout frame, classified by wire shape.
enum Frame {
    /// A response result for a request id.
    Response(u64, Value),
    /// A response error for a request id.
    Error(u64, Value),
    /// A server-to-client notification, already folded into session state.
    Notification,
}

/// Per-session telemetry (mirrors the spike's lib/runtime.mjs state).
#[derive(Default, Debug, Clone)]
pub struct SessionSnapshot {
    /// Last observed session.status (running / idle).
    pub status: Option<String>,
    /// Number of session.event notifications seen.
    pub events: u64,
    /// Names of tool calls observed (mcp__novel__* etc.).
    pub tool_calls: Vec<String>,
    /// Accumulated assistant text across all messages.
    pub assistant_text: String,
    /// Text blocks of the final assistant message.
    pub last_assistant_text: String,
    /// Reasoning blocks of the final assistant message (thinking models may
    /// put the answer there).
    pub last_assistant_reasoning: String,
    /// Accumulated input tokens (usage events).
    pub prompt_tokens: u64,
    /// Accumulated output tokens (usage events).
    pub completion_tokens: u64,
}

/// Windows Job Object wrapper: closing the handle kills every process in the
/// job (KILL_ON_JOB_CLOSE), i.e. the runtime and its MCP gateway descendants.
#[cfg(windows)]
struct JobObject(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl JobObject {
    fn create_and_assign(pid: u32) -> Result<Self, SupervisorError> {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
        };
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job == 0 {
                return Err(SupervisorError("CreateJobObjectW failed".to_string()));
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let set = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if set == 0 {
                CloseHandle(job);
                return Err(SupervisorError(
                    "SetInformationJobObject failed".to_string(),
                ));
            }
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if process == 0 {
                CloseHandle(job);
                return Err(SupervisorError("OpenProcess failed".to_string()));
            }
            let assigned = AssignProcessToJobObject(job, process);
            CloseHandle(process);
            if assigned == 0 {
                CloseHandle(job);
                return Err(SupervisorError(
                    "AssignProcessToJobObject failed".to_string(),
                ));
            }
            Ok(JobObject(job))
        }
    }
}

#[cfg(windows)]
impl Drop for JobObject {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

/// Folds one `session.event` notification into the per-session snapshot.
fn apply_session_event(sessions: &mut HashMap<String, SessionSnapshot>, value: &Value) {
    let params = match value.get("params") {
        Some(params) => params,
        None => return,
    };
    let session_id = match params.get("sessionId").and_then(Value::as_str) {
        Some(session_id) => session_id,
        None => return,
    };
    let event = match params.get("event") {
        Some(event) => event,
        None => return,
    };
    let snapshot = sessions.entry(session_id.to_string()).or_default();
    snapshot.events += 1;
    let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
    let data = event.get("data");
    match event_type {
        "tool/call" => {
            let name = data
                .and_then(|data| data.get("name"))
                .or_else(|| data.and_then(|data| data.get("toolName")))
                .or_else(|| data.and_then(|data| data.get("tool")))
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            snapshot.tool_calls.push(name.to_string());
        }
        "assistant/message" => {
            snapshot.last_assistant_text.clear();
            snapshot.last_assistant_reasoning.clear();
            if let Some(blocks) = data
                .and_then(|data| data.get("message"))
                .and_then(|message| message.get("content"))
                .and_then(Value::as_array)
            {
                for block in blocks {
                    match block.get("type").and_then(Value::as_str) {
                        Some("text") => {
                            let text = block.get("text").and_then(Value::as_str).unwrap_or("");
                            snapshot.last_assistant_text.push_str(text);
                            snapshot.assistant_text.push_str(text);
                        }
                        Some("reasoning") => {
                            let text = block.get("text").and_then(Value::as_str).unwrap_or("");
                            snapshot.last_assistant_reasoning.push_str(text);
                        }
                        _ => {}
                    }
                }
            }
            if let Some(usage) = data.and_then(|data| data.get("usage")) {
                snapshot.prompt_tokens += usage
                    .get("inputTokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                snapshot.completion_tokens += usage
                    .get("outputTokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
            }
        }
        _ => {}
    }
}

/// A live runtime child plus its protocol plumbing.
pub struct RuntimeHandle {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    rx: Receiver<Frame>,
    next_id: AtomicU64,
    stderr_tail: Arc<Mutex<String>>,
    sessions: Arc<Mutex<HashMap<String, SessionSnapshot>>>,
    #[cfg(windows)]
    job: Mutex<Option<JobObject>>,
}

impl RuntimeHandle {
    /// Wraps a spawned runtime child; takes ownership of its pipes and puts the
    /// process into a kill-on-close Windows Job Object (tree-wide cleanup).
    pub fn new(mut child: Child) -> Result<Self, SupervisorError> {
        #[cfg(windows)]
        let job = Mutex::new(Some(JobObject::create_and_assign(child.id())?));

        let stdout: ChildStdout = child
            .stdout
            .take()
            .ok_or_else(|| SupervisorError("child stdout not piped".to_string()))?;
        let stdin: ChildStdin = child
            .stdin
            .take()
            .ok_or_else(|| SupervisorError("child stdin not piped".to_string()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| SupervisorError("child stderr not piped".to_string()))?;

        let (tx, rx) = mpsc::channel::<Frame>();
        let sessions = Arc::new(Mutex::new(HashMap::<String, SessionSnapshot>::new()));
        let stderr_tail = Arc::new(Mutex::new(String::new()));

        // stdout reader: line-framed JSON-RPC frames; exits when the pipe EOFs
        // (the child died), which is the natural teardown signal.
        {
            let sessions = sessions.clone();
            let tx = tx.clone();
            std::thread::spawn(move || {
                let mut reader = BufReader::new(stdout);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line) {
                        Ok(0) => break,
                        Ok(_) => {
                            let trimmed = line.trim();
                            if trimmed.is_empty() {
                                continue;
                            }
                            match serde_json::from_str::<Value>(trimmed) {
                                Ok(value) => {
                                    let id = value.get("id").and_then(Value::as_u64);
                                    match (value.get("method").and_then(Value::as_str), id) {
                                        (Some(_method), Some(_request_id)) => {
                                            // Server->client request: dead capability; treat as notification.
                                            let _ = tx.send(Frame::Notification);
                                        }
                                        (Some(method), None) => {
                                            if method == "session.status" {
                                                if let (Some(session), Some(status)) = (
                                                    value
                                                        .pointer("/params/sessionId")
                                                        .and_then(Value::as_str),
                                                    value
                                                        .pointer("/params/status")
                                                        .and_then(Value::as_str),
                                                ) {
                                                    sessions
                                                        .lock()
                                                        .unwrap()
                                                        .entry(session.to_string())
                                                        .or_default()
                                                        .status = Some(status.to_string());
                                                }
                                            } else if method == "session.event" {
                                                apply_session_event(
                                                    &mut sessions.lock().unwrap(),
                                                    &value,
                                                );
                                            }
                                            let _ = tx.send(Frame::Notification);
                                        }
                                        (None, Some(response_id)) => {
                                            if let Some(error) = value.get("error") {
                                                let _ = tx
                                                    .send(Frame::Error(response_id, error.clone()));
                                            } else if let Some(result) = value.get("result") {
                                                let _ = tx.send(Frame::Response(
                                                    response_id,
                                                    result.clone(),
                                                ));
                                            }
                                        }
                                        (None, None) => {
                                            // Malformed JSON-RPC frame; protocol says ignore.
                                        }
                                    }
                                }
                                Err(_) => {
                                    // Non-JSON stdout line; protocol says ignore.
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        // stderr reader: diagnostics buffer (tail-capped).
        {
            let stderr_tail = stderr_tail.clone();
            std::thread::spawn(move || {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line) {
                        Ok(0) => break,
                        Ok(_) => {
                            let mut buffer = stderr_tail.lock().unwrap();
                            buffer.push_str(&line);
                            if buffer.len() > 1_000_000 {
                                *buffer = buffer[buffer.len() - 600_000..].to_string();
                            }
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        Ok(Self {
            child: Mutex::new(Some(child)),
            stdin: Mutex::new(Some(stdin)),
            rx,
            next_id: AtomicU64::new(1),
            stderr_tail,
            sessions,
            #[cfg(windows)]
            job,
        })
    }

    /// Sends one JSON-RPC request and waits for its matching response.
    ///
    /// `params` is `None` for `shutdown` (the wire sends no params field).
    pub fn request(
        &self,
        method: &str,
        params: Option<Value>,
        timeout: Duration,
    ) -> Result<Value, SupervisorError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let mut payload = json!({ "jsonrpc": "2.0", "id": id, "method": method });
        if let Some(params) = params {
            payload["params"] = params;
        }
        let mut line = serde_json::to_string(&payload)?;
        line.push('\n');
        {
            let mut guard = self.stdin.lock().unwrap();
            let pipe = guard
                .as_mut()
                .ok_or_else(|| SupervisorError("stdin closed".to_string()))?;
            pipe.write_all(line.as_bytes())?;
            pipe.flush()?;
        }
        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(SupervisorError(format!("timeout waiting for {}", method)));
            }
            match self.rx.recv_timeout(remaining) {
                Ok(Frame::Response(response_id, result)) if response_id == id => return Ok(result),
                Ok(Frame::Error(response_id, error)) if response_id == id => {
                    return Err(SupervisorError(
                        serde_json::to_string(&error)
                            .unwrap_or_else(|_| "unknown error".to_string()),
                    ))
                }
                Ok(_) => continue,
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(SupervisorError("frame channel disconnected".to_string()))
                }
            }
        }
    }

    /// Waits until `session.status` shows `running` then `idle` for the session.
    pub fn wait_idle(&self, session_id: &str, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut saw_running = false;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return false;
            }
            {
                let sessions = self.sessions.lock().unwrap();
                let current = sessions
                    .get(session_id)
                    .and_then(|snapshot| snapshot.status.as_deref());
                if current == Some("running") {
                    saw_running = true;
                }
                if saw_running && current == Some("idle") {
                    return true;
                }
            }
            match self.rx.recv_timeout(Duration::from_millis(100)) {
                Ok(_) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return false,
            }
        }
    }

    /// Telemetry snapshot for a session (final answer, tool calls, usage).
    pub fn snapshot(&self, session_id: &str) -> Option<SessionSnapshot> {
        self.sessions.lock().unwrap().get(session_id).cloned()
    }

    /// The last observed `session.status` for a session.
    #[allow(dead_code)] // exercised by tests; wire to a future cancel command
    pub fn status_of(&self, session_id: &str) -> Option<String> {
        self.sessions
            .lock()
            .unwrap()
            .get(session_id)
            .and_then(|snapshot| snapshot.status.clone())
    }

    /// Hard-terminates the runtime tree. Cancellation = kill + restart by
    /// design: the wire has no prompt-cancel method. Closing the Job Object
    /// first reaps the whole tree (runtime + MCP gateway descendants).
    #[allow(dead_code)] // exercised by tests; wire to a future cancel command
    pub fn kill(&self) {
        #[cfg(windows)]
        if let Ok(mut guard) = self.job.lock() {
            guard.take();
        }
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Sends `shutdown`, then waits for process exit; returns the exit code.
    pub fn shutdown_and_wait(&self, timeout: Duration) -> Result<i32, SupervisorError> {
        let _ = self.request("shutdown", None, Duration::from_secs(30));
        let deadline = Instant::now() + timeout;
        let mut guard = self.child.lock().unwrap();
        let child = guard
            .as_mut()
            .ok_or_else(|| SupervisorError("child already reaped".to_string()))?;
        loop {
            if let Some(status) = child.try_wait()? {
                return Ok(status.code().unwrap_or(-1));
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                return Err(SupervisorError("shutdown wait timeout".to_string()));
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    /// Tail of the runtime's stderr diagnostics.
    pub fn stderr_tail(&self) -> String {
        let buffer = self.stderr_tail.lock().unwrap();
        if buffer.len() > 2000 {
            buffer[buffer.len() - 2000..].to_string()
        } else {
            buffer.clone()
        }
    }
}

impl Drop for RuntimeHandle {
    fn drop(&mut self) {
        #[cfg(windows)]
        if let Ok(mut guard) = self.job.lock() {
            guard.take();
        }
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
