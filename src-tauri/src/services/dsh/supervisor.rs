//! Minimal stdio JSON-RPC supervisor for the DSH SDK runtime (v3.1.0 port of
//! spike P1, extended).
//!
//! Wire facts, verified against `packages/sdk/protocol` at rc.5 (`47f9438`):
//!
//! * requests: `initialize`, `session/prompt`, `session/cancel`, `runtime/health`, `shutdown`
//! * notifications: `session.event`, `session.status`, `subagent.*`
//! * ANS owns a thin server plugin over public Harness Agent APIs; cancellation
//!   uses `Agent.cancel`, while a failed protocol cancel still falls back to
//!   killing the scoped Job Object and resuming the JSONL session.
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

pub type SessionEventObserver = Arc<dyn Fn(&Value) -> Result<(), String> + Send + Sync>;

/// Per-session telemetry (mirrors the spike's lib/runtime.mjs state).
#[derive(Default, Debug, Clone)]
pub struct SessionSnapshot {
    /// Last observed session.status (running / idle).
    pub status: Option<String>,
    /// Number of session.event notifications seen.
    pub events: u64,
    /// Names of tool calls observed (mcp__novel__* etc.).
    pub tool_calls: Vec<String>,
    tool_names_by_call: HashMap<String, String>,
    /// Stable event kinds observed in arrival order. Unknown kinds are kept
    /// for a generic ANS fallback projection instead of being dropped.
    pub event_kinds: Vec<String>,
    /// Accumulated assistant text across all messages.
    pub assistant_text: String,
    /// Text blocks of the final assistant message.
    pub last_assistant_text: String,
    /// Reasoning blocks of the final assistant message (thinking models may
    /// put the answer there).
    pub last_assistant_reasoning: String,
    /// Candidate text returned by the domain gateway, when the carrier emits
    /// a tool result payload containing a text block.
    pub tool_results: Vec<(String, String)>,
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
    snapshot.event_kinds.push(event_type.to_string());
    let data = event.get("data");
    match event_type {
        "tool/call" => {
            let name = data
                .and_then(|data| data.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            snapshot.tool_calls.push(name.to_string());
            if let Some(call_id) = data
                .and_then(|data| data.get("callId"))
                .and_then(Value::as_str)
            {
                snapshot
                    .tool_names_by_call
                    .insert(call_id.to_string(), name.to_string());
            }
        }
        "tool/result" => {
            let call_id = data
                .and_then(|data| data.pointer("/message/source/callId"))
                .or_else(|| data.and_then(|data| data.pointer("/message/content/0/toolCallId")))
                .and_then(Value::as_str)
                .unwrap_or("");
            let name = snapshot
                .tool_names_by_call
                .get(call_id)
                .cloned()
                .unwrap_or_else(|| "unknown".to_string());
            let text = data
                .and_then(|data| data.pointer("/message/content/0/content"))
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<String>();
            if !text.is_empty() {
                snapshot.tool_results.push((name, text));
            }
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
    observer_error: Arc<Mutex<Option<String>>>,
    #[cfg(windows)]
    job: Mutex<Option<JobObject>>,
}

// The handle's receiver is consumed by the single worker request loop.  The
// other shared operations (status snapshots and kill) only touch mutex/atomic
// fields, so the handle can be held by the scoped Worker registry while the
// worker thread owns the protocol loop.
unsafe impl Send for RuntimeHandle {}
unsafe impl Sync for RuntimeHandle {}

impl RuntimeHandle {
    /// Wraps a spawned runtime child; takes ownership of its pipes and puts the
    /// process into a kill-on-close Windows Job Object (tree-wide cleanup).
    pub fn new(child: Child) -> Result<Self, SupervisorError> {
        Self::new_with_observer(child, None)
    }

    pub fn new_with_observer(
        mut child: Child,
        observer: Option<SessionEventObserver>,
    ) -> Result<Self, SupervisorError> {
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
        let observer_error = Arc::new(Mutex::new(None));

        // stdout reader: line-framed JSON-RPC frames; exits when the pipe EOFs
        // (the child died), which is the natural teardown signal.
        {
            let sessions = sessions.clone();
            let tx = tx.clone();
            let observer_error = observer_error.clone();
            let observer = observer.clone();
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
                                                let persisted = observer
                                                    .as_ref()
                                                    .map(|observer| observer(&value))
                                                    .transpose();
                                                match persisted {
                                                    Ok(_) => apply_session_event(
                                                        &mut sessions.lock().unwrap(),
                                                        &value,
                                                    ),
                                                    Err(error) => {
                                                        *observer_error.lock().unwrap() =
                                                            Some(error);
                                                    }
                                                }
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
            observer_error,
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
            if let Some(error) = self.observer_error.lock().unwrap().clone() {
                return Err(SupervisorError(format!(
                    "session.event persistence failed: {}",
                    error
                )));
            }
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
        self.wait_idle_checked(session_id, timeout).is_ok()
    }

    pub fn wait_idle_checked(
        &self,
        session_id: &str,
        timeout: Duration,
    ) -> Result<(), SupervisorError> {
        self.wait_idle_checked_with_cancel(session_id, timeout, None)
    }

    /// Wait for one running→idle edge and, when requested by the owning ANS
    /// task, deliver a scoped Harness `Agent.cancel` through the thin carrier.
    /// This method owns the receiver loop, so no second thread races JSON-RPC
    /// responses for the same process.
    pub fn wait_idle_checked_with_cancel(
        &self,
        session_id: &str,
        timeout: Duration,
        cancel: Option<&std::sync::atomic::AtomicBool>,
    ) -> Result<(), SupervisorError> {
        let deadline = Instant::now() + timeout;
        let mut saw_running = false;
        let mut cancel_sent = false;
        loop {
            if let Some(error) = self.observer_error.lock().unwrap().clone() {
                return Err(SupervisorError(format!(
                    "session.event persistence failed: {}",
                    error
                )));
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(SupervisorError("session idle wait timeout".to_string()));
            }
            if !cancel_sent
                && cancel.is_some_and(|flag| flag.load(std::sync::atomic::Ordering::SeqCst))
            {
                cancel_sent = true;
                if let Err(error) = self.request(
                    "session/cancel",
                    Some(json!({ "sessionId": session_id })),
                    Duration::from_secs(10),
                ) {
                    self.kill();
                    return Err(SupervisorError(format!(
                        "session cancel failed; worker terminated: {}",
                        error
                    )));
                }
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
                    return if cancel_sent {
                        Err(SupervisorError("session cancelled".to_string()))
                    } else {
                        Ok(())
                    };
                }
            }
            match self.rx.recv_timeout(Duration::from_millis(100)) {
                Ok(_) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(SupervisorError("frame channel disconnected".to_string()))
                }
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
