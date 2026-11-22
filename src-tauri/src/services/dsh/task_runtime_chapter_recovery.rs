//! Chapter candidate length recovery and its single-attempt execution boundary.
//! No IPC budget knobs: one invocation shares three candidate calls, two repairs and 480s.
use super::*;
use std::time::Instant;

const CHAPTER_LENGTH_REJECTED: &str = "DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED";
const MAX_CHAPTER_LENGTH_REPAIRS: usize = 2;
pub(crate) const CHAPTER_WALL_BUDGET_EXHAUSTED: &str =
    "DSH_CHAPTER_WALL_BUDGET_EXHAUSTED: 章节候选与字数修复的 480 秒总预算已耗尽";
pub(crate) const CHAPTER_CALL_BUDGET_EXHAUSTED: &str =
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
    revision: super::length_revision::LengthRevision,
    root: Option<execution::RootExecution>,
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
            revision: Default::default(),
            root: input.execution.clone(),
        }
    }

    pub(super) fn new_with_remaining(input: &StartTaskTurnInput, remaining: Duration) -> Self {
        Self {
            deadline: is_chapter_writing_turn(input).then_some(Instant::now() + remaining),
            contract: frozen_contract(input),
            candidate_calls: 0,
            repair_number: 0,
            rejection: None,
            revision: Default::default(),
            root: input.execution.clone(),
        }
    }

    pub(super) fn seed(&mut self, calls: usize, length_repairs: usize) {
        self.candidate_calls = calls;
        self.repair_number = length_repairs;
    }

    pub(super) fn is_repairing(&self) -> bool {
        self.repair_number > 0
    }

    pub(super) fn restore_history(
        &mut self,
        connection: &rusqlite::Connection,
        input: &StartTaskTurnInput,
    ) -> Result<(), String> {
        self.revision.restore_history(connection, input)
    }

    pub(super) fn record_history_notice(
        &mut self,
        connection: &mut rusqlite::Connection,
        input: &StartTaskTurnInput,
        run_id: &str,
    ) -> Result<(), String> {
        self.revision
            .record_history_notice(connection, input, run_id)
    }

    pub(super) fn remaining_at(&self, instant: Instant) -> Duration {
        self.deadline
            .map(|end| end.saturating_duration_since(instant))
            .unwrap_or(Duration::from_secs(480))
    }

    pub(super) fn timeout(&self, cap: Duration, cancel: &AtomicBool) -> Result<Duration, String> {
        let cap = if let Some(root) = &self.root {
            root.timeout(cap)?
        } else {
            cap
        };
        if cancel.load(Ordering::SeqCst) {
            return Err("DSH_TASK_CANCELLED".into());
        }
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
                    // This branch follows the full host scope/read/hash contract. Read the exact
                    // rejected text only as revision material; it never becomes a candidate card.
                    let mut source = input.clone();
                    source.chapter_word_range = None;
                    if let (Some(range), Ok(Some(generated))) = (
                        input.chapter_word_range.as_ref(),
                        read_generated_chapter_result(
                            connection,
                            &source,
                            run_id,
                            event_id.as_deref(),
                        ),
                    ) {
                        self.revision.observe(generated.text, range);
                    }
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
        if let Some(range) = input.chapter_word_range.as_ref() {
            prompt.push_str(&self.revision.prompt(range));
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
        Some(format!("任务运行失败：{}。{}。字数轨迹：{}。失败 Run 与工具事实已保留；未创建候选 Artifact，未写入正式正文。", error, status, self.revision.progress()))
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

#[path = "task_runtime_execute.rs"]
mod stage_execute;
pub(super) use stage_execute::execute;
