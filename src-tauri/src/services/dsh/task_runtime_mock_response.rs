//! Offline model-response transport. It speaks the same structured tool-call protocol;
//! it owns no task loop, domain write, test control endpoint, or external connection.
use super::*;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread::{self, JoinHandle};
#[path = "task_runtime_mock_chapter.rs"]
mod chapter;
#[path = "task_runtime_mock_summary.rs"]
mod summary;

pub(super) struct MockResponseGuard {
    address: String,
    input: Arc<Mutex<StartTaskTurnInput>>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}
impl MockResponseGuard {
    pub fn base_url(&self) -> String {
        format!("http://{}/v1", self.address)
    }

    pub fn set_input(&self, next: &StartTaskTurnInput) -> Result<(), String> {
        let mut sanitized = next.clone();
        sanitized.api_key.clear();
        let mut guard = self
            .input
            .lock()
            .map_err(|_| "DSH_MOCK_STATE_LOCK_FAILED".to_string())?;
        *guard = sanitized;
        Ok(())
    }
}
impl Drop for MockResponseGuard {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(&self.address);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

pub(super) fn start(input: &StartTaskTurnInput) -> Result<MockResponseGuard, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|_| "DSH_MOCK_TRANSPORT_BIND_FAILED".to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "DSH_MOCK_TRANSPORT_BIND_FAILED".to_string())?;
    let address = listener
        .local_addr()
        .map_err(|_| "DSH_MOCK_TRANSPORT_BIND_FAILED".to_string())?
        .to_string();
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let mut initial = input.clone();
    initial.api_key.clear();
    let shared_input = Arc::new(Mutex::new(initial));
    let thread_input = shared_input.clone();
    let thread = thread::spawn(move || {
        while !thread_stop.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    if thread_stop.load(Ordering::SeqCst) {
                        break;
                    }
                    let _ = stream.set_nonblocking(false);
                    if let Ok(config) = thread_input.lock().map(|guard| guard.clone()) {
                        handle(&mut stream, &config);
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(10))
                }
                Err(_) => break,
            }
        }
    });
    Ok(MockResponseGuard {
        address,
        input: shared_input,
        stop,
        thread: Some(thread),
    })
}
fn handle(stream: &mut TcpStream, input: &StartTaskTurnInput) {
    #[cfg(feature = "e2e")]
    e2e_stage_gate(input);
    let response = read_request(stream).and_then(|request| response(&request, input));
    match response {
        Ok(value) => {
            let text = sse(value);
            let _=write!(stream,"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",text.len(),text);
        }
        Err(error) => {
            let text =
                json!({"error":{"type":"mock_response_unsupported","message":error}}).to_string();
            let _=write!(stream,"HTTP/1.1 422 Unprocessable Entity\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",text.len(),text);
        }
    }
    let _ = stream.flush();
}
/// E2E-only deterministic pause at one native stage. Compiled only behind the
/// `e2e` Cargo feature and additionally gated by the isolated runtime marker
/// plus an explicit stage-kind variable. It is never reachable in a release app.
#[cfg(feature = "e2e")]
fn e2e_stage_gate(input: &StartTaskTurnInput) {
    const STAGE_GATE: &str = "AI_NOVEL_STUDIO_E2E_HOLD_STAGE_KEY";
    let Ok(wanted) = std::env::var(STAGE_GATE) else {
        return;
    };
    if wanted.trim().is_empty() || wanted.len() > 200 {
        return;
    }
    let Some(stage) = staged::metadata(input) else {
        return;
    };
    if !stage["stageKey"]
        .as_str()
        .is_some_and(|key| key.ends_with(&wanted))
    {
        return;
    }
    if crate::runtime::e2e_data_dir().ok().flatten().is_none() {
        return;
    }
    let gate = std::path::PathBuf::from(
        crate::runtime::e2e_data_dir()
            .ok()
            .flatten()
            .expect("checked"),
    )
    .join("stage-gate");
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(format!("{}.waiting", gate.display()))
        .map(|mut file| {
            use std::io::Write;
            let _ = writeln!(file, "{}", stage["stageKey"].as_str().unwrap_or(""));
        });
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    while !gate.exists() && std::time::Instant::now() < deadline {
        if input
            .execution
            .as_ref()
            .is_some_and(|root| root.cancel.load(Ordering::SeqCst))
        {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = std::fs::remove_file(format!("{}.waiting", gate.display()));
}

fn read_request(stream: &mut TcpStream) -> Result<Value, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| "DSH_MOCK_REQUEST_TIMEOUT")?;
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 4096];
    let boundary = loop {
        let count = stream
            .read(&mut chunk)
            .map_err(|_| "DSH_MOCK_REQUEST_INVALID")?;
        if count == 0 {
            return Err("DSH_MOCK_REQUEST_INCOMPLETE".into());
        }
        bytes.extend_from_slice(&chunk[..count]);
        if bytes.len() > 8 * 1024 * 1024 {
            return Err("DSH_MOCK_REQUEST_TOO_LARGE".into());
        }
        if let Some(index) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
            break index + 4;
        }
    };
    let header = std::str::from_utf8(&bytes[..boundary]).map_err(|_| "DSH_MOCK_REQUEST_INVALID")?;
    if !header.lines().next().is_some_and(|line| {
        line == "POST /v1/chat/completions HTTP/1.1" || line == "POST /chat/completions HTTP/1.1"
    }) {
        return Err("DSH_MOCK_ENDPOINT_UNSUPPORTED".into());
    }
    let length = header
        .lines()
        .find_map(|line| {
            line.split_once(':')
                .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                .and_then(|(_, v)| v.trim().parse::<usize>().ok())
        })
        .filter(|n| *n <= 8 * 1024 * 1024)
        .ok_or("DSH_MOCK_REQUEST_INVALID")?;
    while bytes.len() < boundary + length {
        let count = stream
            .read(&mut chunk)
            .map_err(|_| "DSH_MOCK_REQUEST_INVALID")?;
        if count == 0 {
            return Err("DSH_MOCK_REQUEST_INCOMPLETE".into());
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
    serde_json::from_slice(&bytes[boundary..boundary + length])
        .map_err(|_| "DSH_MOCK_REQUEST_JSON_INVALID".into())
}
fn canonical(name: &str) -> String {
    let name = name.strip_prefix("mcp__novel__").unwrap_or(name);
    for tool in [
        "domain.submit_candidate",
        "creative.plan_action",
        "novel.read_context",
        "chapter.read_outline",
        "get_character_states",
        "search_memory",
        "novel.read",
        "structure.read",
        "context.read",
        "memory.search",
        "generate_chapter",
        "polish_chapter",
        "generate_outline",
        "generate_characters",
        "expand_settings",
        "check_quality",
        "summarize_chapter",
        "suggest_events",
        "submit_chapter_stage",
    ] {
        if name == tool
            || name == tool.replace('.', "_")
            || name.starts_with(&format!("{}_", tool.replace('.', "_")))
        {
            return tool.into();
        }
    }
    name.to_string()
}
fn response(request: &Value, input: &StartTaskTurnInput) -> Result<Value, String> {
    let tools = request
        .get("tools")
        .and_then(Value::as_array)
        .ok_or("DSH_MOCK_TOOL_PROTOCOL_REQUIRED")?;
    let roster: Vec<(String, String)> = tools
        .iter()
        .filter_map(|tool| {
            tool.pointer("/function/name")
                .and_then(Value::as_str)
                .map(|name| (canonical(name), name.into()))
        })
        .collect();
    let messages = request
        .get("messages")
        .and_then(Value::as_array)
        .ok_or("DSH_MOCK_MESSAGES_REQUIRED")?;
    let last_user = messages
        .iter()
        .rposition(|m| m["role"] == "user")
        .unwrap_or(0);
    let seen: HashSet<String> = messages[last_user..]
        .iter()
        .filter_map(|m| m.get("tool_calls").and_then(Value::as_array))
        .flatten()
        .filter_map(|call| call.pointer("/function/name").and_then(Value::as_str))
        .map(canonical)
        .collect();
    let readonly: Vec<_> = roster
        .iter()
        .filter(|(name, _)| ALL_CONTEXT_READ_TOOLS.split(',').any(|t| t == name))
        .filter(|(name, _)| !seen.contains(name))
        .collect();
    if !readonly.is_empty() {
        let calls = readonly
            .iter()
            .map(|(name, wire)| {
                let mut args = json!({"novelId":input.novel_id});
                if matches!(
                    name.as_str(),
                    "chapter.read_outline"
                        | "get_character_states"
                        | "structure.read"
                        | "context.read"
                ) {
                    if let Some(chapter) = input.chapter_id.as_ref() {
                        args["chapterId"] = json!(chapter);
                    } else {
                        return None;
                    }
                }
                if matches!(name.as_str(), "search_memory" | "memory.search") {
                    args["query"] = json!("已有剧情与人物状态");
                }
                Some(call(wire, args))
            })
            .flatten()
            .collect::<Vec<_>>();
        if !calls.is_empty() {
            return Ok(json!({"toolCalls":calls}));
        }
    }
    if let Some((_, wire)) = roster
        .iter()
        .find(|(name, _)| name == "creative.plan_action" && !seen.contains(name))
    {
        let goal = &input.goal;
        let action = if goal.contains("总结") {
            Some("summarize_chapter")
        } else if goal.contains("检查") || goal.contains("质量") {
            Some("check_quality")
        } else if goal.contains("润色") || goal.contains("修订") {
            Some("polish_chapter")
        } else if (goal.contains("写") && goal.contains("章"))
            || (goal.contains("生成")
                && goal.contains("章")
                && goal.contains("正文")
                && !goal.contains("大纲")
                && !goal.contains("规划"))
        {
            Some("generate_chapter")
        } else if goal.contains("角色") || goal.contains("主角") {
            Some("prepare_characters")
        } else if goal.contains("设定") || goal.contains("世界") {
            Some("prepare_settings")
        } else if goal.contains("规划") || goal.contains("大纲") {
            Some("generate_outline")
        } else {
            None
        };
        let Some(action) = action else {
            return Ok(
                json!({"text":"请说明希望讨论的创作目标，或明确需要生成、修订、检查或总结的内容。离线 Mock 不代表文学效果验证。"}),
            );
        };
        let chapter = input.chapter_id.clone().or_else(|| find_chapter(messages));
        if matches!(
            action,
            "generate_chapter" | "polish_chapter" | "summarize_chapter" | "check_quality"
        ) && chapter.is_none()
        {
            return Ok(json!({"text":"当前任务缺少明确章节，请先准备规划并选择章节。"}));
        }
        let mut args = json!({"novelId":input.novel_id,"action":action,"instruction":input.goal});
        if matches!(
            action,
            "generate_chapter" | "polish_chapter" | "summarize_chapter" | "check_quality"
        ) {
            args["chapterId"] = json!(chapter);
        }
        return Ok(json!({"toolCalls":[call(wire,args)]}));
    }
    if let Some((_, wire)) = roster
        .iter()
        .find(|(name, _)| name == "submit_chapter_stage" && !seen.contains(name))
    {
        let args = staged::mock_arguments(input)?;
        return Ok(json!({"toolCalls":[call(wire,args)]}));
    }
    if let Some((name, wire)) = roster
        .iter()
        .find(|(name, _)| CANDIDATE_TOOLS.split(',').any(|t| t == name) && !seen.contains(name))
    {
        let mut args = json!({"novelId":input.novel_id});
        if let Some(chapter) = &input.chapter_id {
            args["chapterId"] = json!(chapter);
        }
        if name == "domain.submit_candidate" {
            let stage = domain_entry::context(input)?;
            args["entryKind"] = stage["entryKind"].clone();
            args["stageKey"] = stage["stageKey"].clone();
            args["payload"] = domain_entry::candidate_schema::mock_payload(stage)?;
        } else {
            let text = candidate(name, input, messages)?;
            if matches!(
                name.as_str(),
                "generate_chapter"
                    | "polish_chapter"
                    | "check_quality"
                    | "summarize_chapter"
                    | "suggest_events"
            ) {
                args["candidateText"] = json!(text);
            } else {
                args["candidate"] =
                    serde_json::from_str(&text).map_err(|_| "DSH_MOCK_CANDIDATE_INVALID")?;
            }
        }
        return Ok(json!({"toolCalls":[call(wire,args)]}));
    }
    Ok(
        json!({"text":"本阶段已返回结构化结果，等待原生校验及适用的用户决定；未自行写入正式小说事实。"}),
    )
}
fn call(name: &str, args: Value) -> Value {
    json!({"id":format!("mock-call-{}",uuid::Uuid::new_v4().simple()),"type":"function","function":{"name":name,"arguments":args.to_string()}})
}
fn find_chapter(messages: &[Value]) -> Option<String> {
    fn walk(value: &Value) -> Option<String> {
        match value {
            Value::Object(map) => map
                .get("currentChapterId")
                .or_else(|| map.get("chapterId"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .or_else(|| {
                    map.get("chapters")
                        .and_then(Value::as_array)
                        .and_then(|c| c.first())
                        .and_then(|c| c.get("id"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .or_else(|| map.values().find_map(walk)),
            Value::Array(items) => items.iter().find_map(walk),
            _ => None,
        }
    }
    messages
        .iter()
        .rev()
        .filter(|m| m["role"] == "tool")
        .find_map(|m| {
            m["content"]
                .as_str()
                .and_then(|s| serde_json::from_str::<Value>(s).ok())
                .as_ref()
                .and_then(walk)
        })
}
fn candidate(tool: &str, input: &StartTaskTurnInput, messages: &[Value]) -> Result<String, String> {
    let text = match tool {
        "generate_chapter" | "polish_chapter" => return chapter::chapter(input),
        "generate_outline" if input.task_kind == "story_plan_generate" => {
            let target = input
                .book_word_goal
                .as_ref()
                .map(|g| g.target_words)
                .unwrap_or(6000);
            let chapters = (target + 2999) / 3000;
            let chapter_values=(0..chapters).map(|n|json!({"title":format!("第{}章",n+1),"outline":"人物发现线索并作出选择，造成新的行动后果。","goal":"推进核心矛盾","targetWordCount":target/chapters+if n<target%chapters{1}else{0}})).collect::<Vec<_>>();
            json!({"planKind":"story_plan","title":"离线规划候选","content":"围绕核心人物的选择逐步展开冲突。","targetWordCount":target,"volumes":[{"title":"第一卷","summary":"建立目标并推进冲突","goal":"完成主要行动","mainConflict":"线索与现实的冲突","outline":"准备、行动与后果","chapters":chapter_values}]})
        }
        "generate_outline" => {
            json!({"title":"章节大纲候选","content":"人物接到线索，核对已有事实，采取行动并面对后果。"})
        }
        "generate_characters" => {
            json!({"characters":[{"name":"沈砚","roleType":"protagonist","identity":"地方档案员","goal":"查清旧案","personality":"谨慎且愿意承担责任","motivation":"保护身边的人","specialAbility":"观察与整理线索","abilityLimits":"只能依赖实际取得的证据","background":"长期整理地方档案","arc":"从回避到主动选择"}]})
        }
        "expand_settings" => {
            json!({"settings":[{"name":"城镇背景","description":"故事发生在一座依河而建的旧城，人物行动受既有法律和现实条件约束。"},{"name":"行动规则","targetType":"rule_system","description":"任何推断都必须经过可取得证据的检验，未核实的消息不能成为正式事实。"}]})
        }
        "check_quality" => {
            json!({"summary":"离线结构检查候选；语义质量尚未核验，需作者审阅。","issues":[]})
        }
        "suggest_events" => {
            json!({"events":[{"title":"新的线索","description":"人物核对一条可验证线索并承担选择的后果。"}]})
        }
        "summarize_chapter" => return summary::grounded_summary(messages),
        _ => return Err("DSH_MOCK_CAPABILITY_UNSUPPORTED".into()),
    };
    Ok(text.to_string())
}
fn sse(value: Value) -> String {
    let tool_calls = value
        .get("toolCalls")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let finish = if tool_calls.is_empty() {
        "stop"
    } else {
        "tool_calls"
    };
    let delta = if tool_calls.is_empty() {
        json!({"role":"assistant","content":value.get("text").and_then(Value::as_str).unwrap_or("")})
    } else {
        json!({"role":"assistant","tool_calls":tool_calls.into_iter().enumerate().map(|(n,mut v)|{v["index"]=json!(n);v}).collect::<Vec<_>>()})
    };
    let first = json!({"id":"ans-offline-mock","object":"chat.completion.chunk","model":"Mock","choices":[{"index":0,"delta":delta,"finish_reason":null}]});
    let tokens = value.to_string().chars().count() as i64;
    let last = json!({"id":"ans-offline-mock","object":"chat.completion.chunk","model":"Mock","choices":[{"index":0,"delta":{},"finish_reason":finish}],"usage":{"prompt_tokens":128,"completion_tokens":tokens.max(1),"total_tokens":128+tokens.max(1)}});
    format!("data: {first}\n\ndata: {last}\n\ndata: [DONE]\n\n")
}

#[cfg(test)]
#[path = "task_runtime_mock_response_tests.rs"]
mod tests;
