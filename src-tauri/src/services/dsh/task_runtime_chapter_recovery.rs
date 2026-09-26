//! Chapter candidate length recovery and its single-attempt execution boundary.
//! No IPC budget knobs: one invocation shares three candidate calls, two repairs and 480s.
use super::*;
use std::time::Instant;

const CHAPTER_LENGTH_REJECTED: &str = "DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED";
const MAX_CHAPTER_LENGTH_REPAIRS: usize = 2;
const CHAPTER_WALL_BUDGET_EXHAUSTED: &str =
    "DSH_CHAPTER_WALL_BUDGET_EXHAUSTED: 章节候选与字数修复的 480 秒总预算已耗尽";
const CHAPTER_CALL_BUDGET_EXHAUSTED: &str =
    "DSH_CHAPTER_CANDIDATE_ATTEMPTS_EXHAUSTED: 章节候选调用总数不得超过 3 次";

fn frozen_contract(input: &StartTaskTurnInput) -> Value {
    json!({
        "conversation": input.conversation_id, "turn": input.turn_id,
        "novel": input.novel_id, "chapter": input.chapter_id, "goal": input.goal,
        "kind": input.task_kind, "tool": input.expected_tool,
        "artifact": input.expected_artifact_type, "reads": input.required_read_tools,
        "allowlist": turn_allowed_tools(input), "model": input.model_snapshot,
        "range": input.chapter_word_range.as_ref().map(|r| (r.minimum, r.target, r.maximum))
    })
}

pub(super) struct ChapterLengthRecovery {
    deadline: Option<Instant>,
    contract: Value,
    candidate_calls: usize,
    repair_number: usize,
    rejection: Option<String>,
}

impl ChapterLengthRecovery {
    pub(super) fn new(input: &StartTaskTurnInput) -> Self {
        Self::new_at(input, Instant::now())
    }

    pub(super) fn new_at(input: &StartTaskTurnInput, started: Instant) -> Self {
        Self {
            deadline: is_chapter_writing_turn(input).then_some(started + Duration::from_secs(480)),
            contract: frozen_contract(input),
            candidate_calls: 0,
            repair_number: 0,
            rejection: None,
        }
    }

    pub(super) fn remaining_at(&self, instant: Instant) -> Duration {
        self.deadline
            .map(|end| end.saturating_duration_since(instant))
            .unwrap_or(Duration::from_secs(480))
    }

    pub(super) fn timeout(&self, cap: Duration, cancel: &AtomicBool) -> Result<Duration, String> {
        if self.deadline.is_none() {
            return Ok(cap);
        }
        if cancel.load(Ordering::SeqCst) {
            return Err("DSH_CHAPTER_CANCELLED: 任务已取消".to_string());
        }
        let remaining = self.remaining_at(Instant::now());
        if remaining.is_zero() {
            return Err(CHAPTER_WALL_BUDGET_EXHAUSTED.to_string());
        }
        Ok(cap.min(remaining))
    }

    /// Only the verified host gate may provide length-repair evidence. Tool/provider strings cannot.
    pub(super) fn read_candidate(
        &mut self,
        connection: &rusqlite::Connection,
        input: &StartTaskTurnInput,
        run_id: &str,
    ) -> Result<Option<GeneratedChapterResult>, String> {
        self.rejection = None;
        if self.deadline.is_some() {
            let mut statement = connection
                .prepare("SELECT tool_name FROM tool_call_events WHERE run_id=?1")
                .map_err(|_| "DSH_CHAPTER_RECOVERY_STATE_READ_FAILED".to_string())?;
            let tools = statement
                .query_map(rusqlite::params![run_id], |row| row.get::<_, String>(0))
                .map_err(|_| "DSH_CHAPTER_RECOVERY_STATE_READ_FAILED".to_string())?;
            for tool in tools {
                let tool =
                    tool.map_err(|_| "DSH_CHAPTER_RECOVERY_STATE_READ_FAILED".to_string())?;
                if CANDIDATE_TOOLS
                    .split(',')
                    .any(|candidate| candidate == tool)
                {
                    self.candidate_calls = self.candidate_calls.saturating_add(1);
                }
            }
            if self.candidate_calls > MAX_CANDIDATE_TOOL_ATTEMPTS {
                return Err(CHAPTER_CALL_BUDGET_EXHAUSTED.to_string());
            }
        }
        let event_id = validate_turn_execution_contract(connection, input, run_id)
            .map_err(|error| error.to_string())?;
        read_generated_chapter_result(connection, input, run_id, event_id.as_deref()).map_err(
            |error| {
                let message = error.to_string();
                if self.deadline.is_some() && error.code == CHAPTER_LENGTH_REJECTED {
                    self.rejection = Some(message.clone());
                }
                message
            },
        )
    }

    pub(super) fn try_repair(
        &mut self,
        input: &StartTaskTurnInput,
        error: &str,
        cancelled: bool,
        healthy: bool,
    ) -> bool {
        if cancelled
            || !healthy
            || self.rejection.as_deref() != Some(error)
            || error.split_once(':').map(|(code, _)| code) != Some(CHAPTER_LENGTH_REJECTED)
            || !is_chapter_writing_turn(input)
            || input.chapter_word_range.is_none()
            || validate_turn_contract(input).is_err()
            || frozen_contract(input) != self.contract
            || self.remaining_at(Instant::now()).is_zero()
            || self.repair_number >= MAX_CHAPTER_LENGTH_REPAIRS
            || self.candidate_calls == 0
            || self.candidate_calls >= MAX_CANDIDATE_TOOL_ATTEMPTS
        {
            return false;
        }
        self.repair_number += 1;
        true
    }

    pub(super) fn prompt(
        &self,
        input: &StartTaskTurnInput,
        protocol_retry: usize,
        previous_runs: usize,
    ) -> String {
        let mut prompt = workbench_turn_prompt_for_attempt(
            input,
            protocol_retry,
            if self.repair_number > 0 {
                0
            } else {
                previous_runs
            },
        );
        if self.repair_number > 0 {
            let evidence = self.rejection.as_deref().unwrap_or(CHAPTER_LENGTH_REJECTED);
            prompt.push_str(&format!(
                "\n\n章节字数自动修复：第 {}/{} 次。上一 Run 和工具结果保留为失败证据，没有创建候选 Artifact，也未写入正式正文。宿主实测：{}。保持原 chapterWordRange、目标字数、用户意图、章节、冻结模型与工具 allowlist 不变；禁止放宽区间。过长则精简重复描写，过短则补足有效情节，重新提交完整正文而非补丁。第一阶段必须并行重新调用本轮全部必需读取工具，禁止沿用上一 Run 的读取；等待全部 Tool Result 返回后，第二阶段只调用唯一候选工具。整个任务最多 3 次候选调用，当前剩余 {} 次；成功后立即结束。",
                self.repair_number, MAX_CHAPTER_LENGTH_REPAIRS, evidence,
                MAX_CANDIDATE_TOOL_ATTEMPTS.saturating_sub(self.candidate_calls)
            ));
        }
        prompt
    }

    pub(super) fn failure_message(&self, error: &str, retrying: bool) -> Option<String> {
        if self.deadline.is_none()
            || (self.rejection.is_none()
                && error != CHAPTER_WALL_BUDGET_EXHAUSTED
                && error != CHAPTER_CALL_BUDGET_EXHAUSTED)
        {
            return None;
        }
        let status = if retrying {
            format!(
                "正在使用同一回合、冻结模型和原字数区间自动修复（{}/{}），累计候选调用 {}/3 次",
                self.repair_number, MAX_CHAPTER_LENGTH_REPAIRS, self.candidate_calls
            )
        } else if self.remaining_at(Instant::now()).is_zero() {
            "480 秒总预算已耗尽，已停止自动字数修复".to_string()
        } else if self.repair_number >= MAX_CHAPTER_LENGTH_REPAIRS
            || self.candidate_calls >= MAX_CANDIDATE_TOOL_ATTEMPTS
        {
            "自动字数修复预算已耗尽（最多 2 次修复、3 次候选调用）".to_string()
        } else {
            "未满足安全恢复条件，已停止自动字数修复".to_string()
        };
        Some(format!("任务运行失败：{}。{}。失败 Run 与工具事实已保留；未创建候选 Artifact，未写入正式正文。", error, status))
    }
}

/// 字数统计与 `draft_service::word_count` 同源：CJK 逐字、ASCII 连续字母数字算一个词。
pub(super) fn validate_chapter_candidate_length(
    input: &StartTaskTurnInput,
    text: &str,
) -> Result<(), AppError> {
    if !is_chapter_writing_turn(input) {
        return Ok(());
    }
    let Some(range) = input.chapter_word_range.as_ref() else {
        return Ok(());
    };
    let count = crate::services::draft_service::word_count(text);
    if count < range.minimum || count > range.maximum {
        return Err(AppError::new(
            "DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED",
            format!(
                "章节候选 {} 字，超出宿主区间 {}～{} 字（目标 {} 字）",
                count, range.minimum, range.maximum, range.target
            ),
            false,
        )
        .with_details(serde_json::json!({
            "wordCount": count,
            "minimum": range.minimum,
            "maximum": range.maximum,
            "target": range.target,
        })));
    }
    Ok(())
}

pub(super) fn execute(
    input: StartTaskTurnInput,
    run_id: String,
    worker_id: String,
    session_id: String,
    process: Arc<WorkerProcess>,
    projection: Arc<Mutex<Option<ProjectionTarget>>>,
    cancel: Arc<AtomicBool>,
    notifier: Option<TaskProjectionObserver>,
    model_tool_attestation: ModelToolAttestation,
    protocol_recovery_retry: usize,
    previous_terminal_runs: usize,
    chapter_recovery: &mut ChapterLengthRecovery,
) -> Result<TaskRuntimeResult, String> {
    let turn_error = Arc::new(Mutex::new(None));
    let runtime = process.runtime.clone();
    *projection
        .lock()
        .map_err(|_| "DSH 事件投影锁失败".to_string())? = Some(ProjectionTarget {
        session_id: session_id.clone(),
        run_id: run_id.clone(),
        turn_error: turn_error.clone(),
        notifier: notifier.clone(),
        request_identity: process._policy_guard.request_identity_reader(),
        allowed_tools: turn_allowed_tools(&input).to_string(),
    });
    ensure_runtime_initialized_with_timeout(&input, &runtime, |cap| {
        chapter_recovery.timeout(cap, &cancel)
    })?;
    let route = selected_model_route(&input)?;
    let max_tokens = input
        .model_snapshot
        .pointer("/options/maxTokens")
        .and_then(Value::as_u64)
        .unwrap_or(8000);
    let before = runtime.snapshot(&session_id).unwrap_or_default();
    let prompt_result = runtime
        .request(
            "session/prompt",
            Some(json!({
                "sessionId":session_id,
                "contentBlocks":[{"type":"text","text":chapter_recovery.prompt(&input, protocol_recovery_retry, previous_terminal_runs)}],
                "route":{
                    "provider":route.harness_provider,
                    "model":route.model,
                    "maxTokens":max_tokens,
                    "reasoningEffort":workbench_reasoning_effort(&input)
                }
            })),
            chapter_recovery.timeout(Duration::from_secs(30), &cancel)?,
        )
        .map_err(|error| safe_supervisor_error(&runtime, "session/prompt 失败", &error))?;
    if prompt_result.get("sessionId").and_then(Value::as_str) != Some(session_id.as_str())
        || prompt_result.get("agentId").and_then(Value::as_str) != Some(session_id.as_str())
    {
        return Err("DSH 持久 Session/Agent 身份响应不匹配".to_string());
    }
    let session_lifecycle = prompt_result
        .get("lifecycle")
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(lifecycle) = session_lifecycle.as_deref() {
        if !matches!(lifecycle, "created" | "continued" | "resumed") {
            return Err(format!("DSH Session 生命周期无效: {}", lifecycle));
        }
    }
    runtime
        .wait_idle_checked_with_cancel(
            &session_id,
            chapter_recovery.timeout(Duration::from_secs(480), &cancel)?,
            Some(&cancel),
        )
        .map_err(|error| {
            if chapter_recovery.remaining_at(Instant::now()).is_zero() {
                runtime.kill();
                CHAPTER_WALL_BUDGET_EXHAUSTED.to_string()
            } else {
                safe_supervisor_error(&runtime, "DSH 回合失败", &error)
            }
        })?;
    let snapshot = runtime.snapshot(&session_id).unwrap_or_default();
    if let Some(error) = turn_error.lock().ok().and_then(|error| error.clone()) {
        let diagnostics = process._proxy_guard.safe_diagnostics();
        return Err(match diagnostics {
            Some(diagnostics) => format!("DSH 回合以错误结束: {} | {}", error, diagnostics),
            None => format!("DSH 回合以错误结束: {}", error),
        });
    }
    let assistant_text = snapshot.last_assistant_text.clone();
    let mut connection = crate::db::get_connection()
        .lock()
        .map_err(|_| "数据库锁失败".to_string())?;
    let open_tools: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM tool_call_events
             WHERE run_id=?1 AND status IN ('pending','queued','running')",
            rusqlite::params![run_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if open_tools != 0 {
        return Err(format!(
            "DSH 回合结束时仍有 {} 个工具调用未收敛",
            open_tools
        ));
    }
    chapter_recovery.timeout(Duration::from_secs(480), &cancel)?;
    let generated = chapter_recovery.read_candidate(&connection, &input, &run_id)?;
    chapter_recovery.timeout(Duration::from_secs(480), &cancel)?;
    let artifact_id = generated
        .as_ref()
        .map(|generated| {
            create_artifact_projection(
                &mut connection,
                &input,
                &run_id,
                generated,
                snapshot.prompt_tokens.saturating_sub(before.prompt_tokens),
                snapshot
                    .completion_tokens
                    .saturating_sub(before.completion_tokens),
            )
        })
        .transpose()
        .map_err(|error| error.to_string())?
        .flatten();
    if artifact_id.is_some() {
        notify_projection(
            notifier.as_ref(),
            &input.conversation_id,
            &run_id,
            "artifact",
        )?;
    }
    let finished_at = now();
    let run = conversation_service::update_run(
        &mut connection,
        UpdateRunInput {
            run_id: run_id.clone(),
            status: "completed".to_string(),
            error: None,
            updated_at: finished_at.clone(),
            started_at: None,
            finished_at: Some(finished_at),
        },
    )
    .map_err(|error| error.to_string())?;
    drop(connection);
    notify_projection(
        notifier.as_ref(),
        &input.conversation_id,
        &run_id,
        "terminal",
    )?;
    *projection
        .lock()
        .map_err(|_| "DSH 事件投影锁失败".to_string())? = None;
    let agent_id = session_id.clone();
    Ok(TaskRuntimeResult {
        run,
        session_id,
        agent_id,
        worker_id,
        runtime: "dsh-headless-persistent".to_string(),
        assistant_text: (!assistant_text.trim().is_empty()).then_some(assistant_text),
        artifact_id,
        session_lifecycle,
        model_tool_attestation,
    })
}
