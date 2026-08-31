//! Generic ANS task runtime over the pinned DSH headless carrier.
//!
//! The workbench never talks to Cordis objects directly.  This module owns
//! one child process per active conversation, projects the carrier's session
//! telemetry into ANS conversation facts, and keeps cancellation scoped to the
//! owning worker.  The browser fallback lives in TypeScript; the desktop path
//! fails explicitly when the pinned carrier is unavailable.

use super::commands::{normalize_model_base_url, spawn_governed_proxy, ProxyGuard};
use super::config::{runtime_root, task_cordis_yml, task_server_script};
use super::governed_proxy::{
    start_policy_server, GovernedProxyPolicy, GovernedProxyPolicyGuard,
    GovernedRequestIdentityReader,
};
use super::launcher::{node_compatible_path, DshLaunchConfig, DshRuntimeLauncher, NodeDshRuntime};
use super::supervisor::{RuntimeHandle, SessionEventObserver, SupervisorError};
use crate::errors::AppError;
use crate::repositories::{draft_repository, large_text_repository};
use crate::services::ai_task_service::{ClaimAiTaskAttemptInput, CreateAiTaskInput};
use crate::services::conversation_service::{
    AppendToolEventInput, CreateArtifactCardInput, CreateRunInput, UpdateRunInput,
    UpdateToolEventInput,
};
use crate::services::{ai_task_service, artifact_service, conversation_service};
use chrono::{TimeZone, Utc};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

pub const DSH_SOURCE_COMMIT: &str = "47f943859bef60e4160492346772ded9b24f765a";
pub const DSH_PROTOCOL: &str = "ans_task_session_v2";
pub const DSH_TASK_PROJECTION_EVENT: &str = "ans://task-runtime-projection";
const MODEL_TOOL_ATTESTATION_PROTOCOL: &str = "ans_model_tool_attestation_v1";
const MODEL_TOOL_ATTESTATION_METHOD: &str = "runtime/attest-model-tools";
const MODEL_TOOL_ATTESTATION_TTL_MS: i64 = 10 * 60 * 1_000;
pub(super) const DSH_WORKER_FRAME_CHANNEL_DISCONNECTED: &str =
    "DSH_WORKER_FRAME_CHANNEL_DISCONNECTED";
const MAX_DSH_WORKER_STDERR_TAIL_CHARS: usize = 240;
const DEEPSEEK_HARNESS_PROVIDER: &str = "deepseek-official";
const OPENAI_COMPATIBLE_PROVIDER: &str = "openai_compatible";
pub(super) const ALLOWED_TOOLS: &str =
    "novel.read_context,chapter.read_outline,get_character_states,search_memory,generate_chapter,generate_outline,generate_characters,suggest_events,expand_settings,polish_chapter,check_quality,summarize_chapter";
const CANDIDATE_TOOLS: &str =
    "generate_chapter,generate_outline,generate_characters,suggest_events,expand_settings,polish_chapter,check_quality,summarize_chapter";
const MAX_CANDIDATE_TOOL_ATTEMPTS: usize = 3;
const MAX_AUTOMATIC_PROTOCOL_RECOVERY_RETRIES: usize = 2;
const AUTOMATIC_PROTOCOL_RECOVERY_ERROR_CODES: &[&str] = &[
    "DSH_REQUIRED_CONTEXT_READ_MISSING",
    "DSH_REQUIRED_CANDIDATE_TOOL_MISSING",
];
const AUTOMATIC_SUMMARY_STREAM_CLOSED_RECOVERY_CODE: &str =
    "DSH_SUMMARY_STREAM_CLOSED_AFTER_VERIFIED_TOOL_ATTESTATION";
const AUTOMATIC_SUMMARY_STREAM_CLOSED_RAW_PREFIX: &str = "DSH 回合以错误结束: STREAM_CLOSED | ";
const MODEL_TOOL_ATTESTATION_TOOL_NAME: &str = "ans_runtime_attest_tool_call_v1";
const MODEL_TOOL_ATTESTATION_STREAM_CLOSED_TURN_END: &str = "dsh.turn.end: STREAM_CLOSED";
const AUTOMATIC_SUMMARY_STREAM_CLOSED_PERSISTED_ERROR: &str = concat!(
    "DSH_SUMMARY_STREAM_CLOSED_AFTER_VERIFIED_TOOL_ATTESTATION: ",
    "DSH 回合以错误结束: STREAM_CLOSED | ",
    "probe responseStats status=200 ",
    "toolNames=ans_runtime_attest_tool_call_v1 ",
    "finish=tool_calls done=true | probe done status=200"
);
const CONTEXT_READ_TOOLS: &str =
    "novel.read_context,chapter.read_outline,get_character_states,search_memory";
const WORLD_AND_RULE_SETTINGS_DIRECTIVE: &str = "生成世界与规则设定候选";
const RULE_SYSTEM_SETTINGS_DIRECTIVE: &str = "生成规则设定候选";
const PROTAGONIST_CANDIDATE_DIRECTIVE: &str = "生成主角候选";
const WORKBENCH_SYSTEM_PROMPT: &str = concat!(
    "你是 AI Novel Studio 创作工作台的任务助手。用中文回复，不展示隐藏推理，只使用任务 allowlist 中的工具。",
    "用户通常只提供简短创作意图；必须读取并遵守每轮宿主契约，用指定的只读工具补足已有资产，不要求用户重复提供内容或填写 JSON。",
    "候选由你完整生成且只供人工审阅，不得修改正式小说事实；候选成功后用一句话确认完成并结束，禁止返回空消息；校验失败时只在宿主限定次数内修正。"
);
pub const PLUGIN_PROBE_CONVERSATION_ID: &str = "__ans_plugin_probe__";

fn workbench_task_instruction(input: &StartTaskTurnInput) -> String {
    match input.task_kind.as_str() {
        "read" => concat!(
            "本轮禁止候选工具；宿主列出的必需读取必须成功完成后才能答复；",
            "未列出必需读取时，按用户意图直接答复并仅在确需正式资产时使用只读工具。"
        )
        .to_string(),
        "story_plan_generate" => {
            let mut instruction = concat!(
                "生成 candidate JSON：根含 planKind=story_plan、title、content、正整数 targetWordCount、volumes；",
                "卷含 title、summary、goal、mainConflict、outline、chapters；章含 title、outline、goal、正整数 targetWordCount。",
                "涉及已有正式角色时，characterNames 为精确姓名字符串数组；没有角色线索时省略。",
                "服从用户总字数与章节数；未给章节数时按完整叙事弧决定，根值与章合计一致。",
                "字段精炼，JSON 前后不加说明或 Markdown；小说级调用不传 chapterId。"
            )
            .to_string();
            if let Some(goal) = &input.book_word_goal {
                instruction.push_str(&format!(
                    "冻结全书目标 {} 字：根 targetWordCount={}；每章 500 至 10000 字，校正末章使章节合计={}；根值与合计均须在 {} 至 {} 字。",
                    goal.target_words,
                    goal.target_words,
                    goal.target_words,
                    goal.minimum_words,
                    goal.maximum_words
                ));
            }
            instruction
        }
        "outline_generate" => {
            "由你生成 candidate JSON，至少包含非空 title 与 content，并结合已读正式资产落实用户的简短意图。"
                .to_string()
        }
        "setting_expand" => {
            let mut instruction =
                "由你生成 candidate JSON：{settings:[...]}，每项至少包含非空 name 与 description。"
                    .to_string();
            if requires_world_and_rule_settings(input) {
                instruction.push_str(
                    "本轮 settings 必须同时含普通世界设定和 targetType=rule_system 的规则项；两类 description 都要具体，规则 description 需写清生效条件或限制边界。",
                );
            } else if requires_rule_system_settings(input) {
                instruction.push_str(
                    "本轮 settings 只能包含 targetType=rule_system 的规则项；description 必须写清生效条件、限制边界或禁止事项。",
                );
            }
            instruction
        }
        "character_generate" => {
            let mut instruction =
                "由你生成 candidate JSON：{characters:[...]}，每项至少包含非空 name。"
                    .to_string();
            if requires_primary_protagonist(input) {
                instruction.push_str(
                    "本轮 characters 必须恰好包含一个 roleType=protagonist 的主角；该主角必须包含非空 identity、goal、personality，并按设定提供 motivation、specialAbility、abilityLimits、background、arc 等正式主角字段。behaviorLimits 只表示行为边界，不得代替 specialAbility 或 abilityLimits；可附必要配角。",
                );
            }
            instruction
        }
        "event_suggest" => {
            "由你生成 candidateText JSON 字符串：至少包含 events 数组，且每项有非空 title。"
                .to_string()
        }
        "quality_check" => concat!(
            "由你生成 candidateText JSON 字符串，至少包含 summary 或 issues 数组。",
            "只依据 chapter.read_outline 返回的当前采用正文检查；没有采用正文时停止且不提交候选。"
        )
        .to_string(),
        "chapter_summary" => concat!(
            "由你生成 candidateText JSON 字符串，至少包含 summary，并从采用正文提取 keyEvents 与 factsMustRemember；",
            "存在变化时补充 characterChanges 与 contextRecords。没有采用正文时停止且不提交候选。"
        )
        .to_string(),
        _ => "未知任务类型；停止且不调用候选工具。".to_string(),
    }
}

fn workbench_turn_prompt(input: &StartTaskTurnInput) -> String {
    workbench_turn_prompt_for_attempt(input, 0)
}

fn workbench_turn_prompt_for_attempt(
    input: &StartTaskTurnInput,
    protocol_recovery_retry: usize,
) -> String {
    let chapter = input
        .chapter_id
        .as_deref()
        .filter(|value| !value.is_empty())
        .unwrap_or("未绑定");
    let expected_tool = input.expected_tool.as_deref().unwrap_or("禁止候选工具");
    let expected_artifact = input
        .expected_artifact_type
        .as_deref()
        .unwrap_or("无候选产物");
    let required_reads = if input.required_read_tools.is_empty() {
        "无".to_string()
    } else {
        input.required_read_tools.join(" -> ")
    };
    let execution_rule = if input.expected_tool.is_some() {
        "第一阶段在同一模型响应中并行调用全部必需读取，禁止候选工具；全部必需读取成功后，第二阶段必须调用唯一候选工具提交候选。候选校验失败最多修正 2 次；成功后用一句话确认完成并结束，禁止返回空消息。"
    } else if !input.required_read_tools.is_empty() {
        "本轮不得调用候选工具；全部必需读取成功后，必须基于工具结果答复。"
    } else {
        "本轮不得调用候选工具。"
    };
    let task_instruction = workbench_task_instruction(input);
    let recovery_instruction = if protocol_recovery_retry == 0 {
        String::new()
    } else {
        format!(
            "\n\n协议自动恢复：这是第 {protocol_recovery_retry}/{MAX_AUTOMATIC_PROTOCOL_RECOVERY_RETRIES} 次有限重试。上一 Run 已保留为失败事实，且没有创建候选 Artifact。请保持原用户意图与自动总结语义不变。第一阶段必须在同一模型响应中并行重新调用本轮全部必需读取工具，严禁调用候选工具；等待全部 Tool Result 返回后，第二阶段只调用且必须调用唯一候选工具。"
        )
    };
    format!(
        "小说 ID：{novel}\n章节 ID：{chapter}\n用户意图：{goal}\n\n宿主契约：\n- taskKind：{task_kind}\n- 唯一候选工具：{expected_tool}\n- 预期产物：{expected_artifact}\n- 必需读取：{required_reads}\n{execution_rule}\n宿主将校验工具、读取顺序、调用次数、作用域和产物。\n\n本轮最小要求：{task_instruction}{recovery_instruction}",
        novel = input.novel_id,
        chapter = chapter,
        goal = input.goal,
        task_kind = input.task_kind,
        expected_tool = expected_tool,
        expected_artifact = expected_artifact,
        required_reads = required_reads,
        execution_rule = execution_rule,
        task_instruction = task_instruction,
        recovery_instruction = recovery_instruction,
    )
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskProjectionNotice {
    pub conversation_id: String,
    pub run_id: String,
    pub kind: String,
    pub occurred_at: String,
}

pub type TaskProjectionObserver =
    Arc<dyn Fn(TaskProjectionNotice) -> Result<(), String> + Send + Sync>;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StartTaskTurnInput {
    pub conversation_id: String,
    pub novel_id: String,
    pub turn_id: String,
    pub goal: String,
    pub chapter_id: Option<String>,
    #[serde(default = "default_task_kind")]
    pub task_kind: String,
    #[serde(default)]
    pub expected_tool: Option<String>,
    #[serde(default)]
    pub expected_artifact_type: Option<String>,
    #[serde(default)]
    pub required_read_tools: Vec<String>,
    #[serde(skip)]
    pub(crate) book_word_goal: Option<ai_task_service::BookWordGoal>,
    pub model_snapshot: Value,
    pub request_policy: TaskRequestPolicyInput,
    #[serde(default)]
    pub api_key: String,
}

fn default_task_kind() -> String {
    "read".to_string()
}

fn expected_contract_for_task_kind(
    task_kind: &str,
) -> Result<Option<(&'static str, &'static str)>, String> {
    match task_kind {
        "read" => Ok(None),
        "story_plan_generate" | "outline_generate" => Ok(Some(("generate_outline", "outline"))),
        "setting_expand" => Ok(Some(("expand_settings", "setting_candidates"))),
        "character_generate" => Ok(Some(("generate_characters", "character_candidates"))),
        "event_suggest" => Ok(Some(("suggest_events", "event_candidates"))),
        "quality_check" => Ok(Some(("check_quality", "quality_report"))),
        "chapter_summary" => Ok(Some(("summarize_chapter", "chapter_summary"))),
        _ => Err(format!(
            "DSH_TASK_CONTRACT_INVALID: 未知任务类型 {}",
            task_kind
        )),
    }
}

fn validate_turn_contract(input: &StartTaskTurnInput) -> Result<(), String> {
    let expected = expected_contract_for_task_kind(&input.task_kind)?;
    match expected {
        None => {
            if input.expected_tool.is_some() || input.expected_artifact_type.is_some() {
                return Err(
                    "DSH_TASK_CONTRACT_INVALID: read 任务不得声明候选工具或候选产物".to_string(),
                );
            }
        }
        Some((expected_tool, expected_artifact)) => {
            if input.expected_tool.as_deref() != Some(expected_tool)
                || input.expected_artifact_type.as_deref() != Some(expected_artifact)
            {
                return Err(format!(
                    "DSH_TASK_CONTRACT_INVALID: {} 必须绑定 {} -> {}",
                    input.task_kind, expected_tool, expected_artifact
                ));
            }
            if !input
                .required_read_tools
                .iter()
                .any(|tool| tool == "novel.read_context")
            {
                return Err(
                    "DSH_TASK_CONTRACT_INVALID: 结构化候选必须先读取 novel.read_context"
                        .to_string(),
                );
            }
        }
    }

    if input.task_kind == "story_plan_generate" && input.chapter_id.is_some() {
        return Err(
            "DSH_TASK_CONTRACT_INVALID: 全书规划必须使用小说级作用域且不得绑定 chapterId"
                .to_string(),
        );
    }
    if matches!(
        input.task_kind.as_str(),
        "event_suggest" | "quality_check" | "chapter_summary"
    ) && input.chapter_id.is_none()
    {
        return Err(format!(
            "DSH_TASK_CONTRACT_INVALID: {} 必须绑定章节",
            input.task_kind
        ));
    }

    let mut seen = HashSet::new();
    for tool in &input.required_read_tools {
        if !CONTEXT_READ_TOOLS.split(',').any(|allowed| allowed == tool) {
            return Err(format!(
                "DSH_TASK_CONTRACT_INVALID: 未知上下文读取工具 {}",
                tool
            ));
        }
        if !seen.insert(tool.as_str()) {
            return Err(format!(
                "DSH_TASK_CONTRACT_INVALID: 重复的上下文读取工具 {}",
                tool
            ));
        }
        if tool == "chapter.read_outline" && input.chapter_id.is_none() {
            return Err(
                "DSH_TASK_CONTRACT_INVALID: chapter.read_outline 需要章节作用域".to_string(),
            );
        }
    }
    Ok(())
}

fn allowlisted_protocol_recovery_error_code(error: &str) -> Option<&'static str> {
    AUTOMATIC_PROTOCOL_RECOVERY_ERROR_CODES
        .iter()
        .copied()
        .find(|code| {
            error == *code
                || error
                    .strip_prefix(*code)
                    .is_some_and(|suffix| suffix.starts_with(':'))
        })
}

fn model_proxy_diagnostic_field<'a>(line: &'a str, name: &str) -> Option<&'a str> {
    line.split_ascii_whitespace().find_map(|field| {
        let (field_name, value) = field.split_once('=')?;
        (field_name == name).then_some(value)
    })
}

fn is_verified_attestation_probe_stream_closed_error(error: &str) -> bool {
    let Some(diagnostics) = error.strip_prefix(AUTOMATIC_SUMMARY_STREAM_CLOSED_RAW_PREFIX) else {
        return false;
    };
    let lines = diagnostics.split(" | ").collect::<Vec<_>>();
    let Some(last_request_index) = lines
        .iter()
        .rposition(|line| line.starts_with("[model-proxy] request "))
    else {
        return false;
    };
    let tail = &lines[last_request_index..];
    if tail.len() != 4 {
        return false;
    }
    let request = tail[0];
    let response = tail[1];
    let done = tail[2];
    let turn_end = tail[3];
    request.starts_with("[model-proxy] request ")
        && response.starts_with("[model-proxy] responseStats ")
        && done.starts_with("[model-proxy] done ")
        && model_proxy_diagnostic_field(request, "tools") == Some("1")
        && model_proxy_diagnostic_field(response, "status") == Some("200")
        && model_proxy_diagnostic_field(response, "toolNames")
            == Some(MODEL_TOOL_ATTESTATION_TOOL_NAME)
        && model_proxy_diagnostic_field(response, "finish") == Some("tool_calls")
        && model_proxy_diagnostic_field(response, "done") == Some("true")
        && model_proxy_diagnostic_field(done, "status") == Some("200")
        && turn_end == MODEL_TOOL_ATTESTATION_STREAM_CLOSED_TURN_END
}

fn raw_automatic_protocol_recovery_error_code(error: &str) -> Option<&'static str> {
    allowlisted_protocol_recovery_error_code(error).or_else(|| {
        is_verified_attestation_probe_stream_closed_error(error)
            .then_some(AUTOMATIC_SUMMARY_STREAM_CLOSED_RECOVERY_CODE)
    })
}

fn persisted_automatic_protocol_recovery_error_code(error: &str) -> Option<&'static str> {
    allowlisted_protocol_recovery_error_code(error).or_else(|| {
        (error == AUTOMATIC_SUMMARY_STREAM_CLOSED_PERSISTED_ERROR)
            .then_some(AUTOMATIC_SUMMARY_STREAM_CLOSED_RECOVERY_CODE)
    })
}

fn runtime_error_for_persistence(error: &str) -> String {
    if is_verified_attestation_probe_stream_closed_error(error) {
        AUTOMATIC_SUMMARY_STREAM_CLOSED_PERSISTED_ERROR.to_string()
    } else {
        safe_runtime_error(error)
    }
}

fn is_automatic_protocol_recovery_candidate(input: &StartTaskTurnInput, error: &str) -> bool {
    input.task_kind == "chapter_summary"
        && input.expected_tool.as_deref() == Some("summarize_chapter")
        && input.expected_artifact_type.as_deref() == Some("chapter_summary")
        && raw_automatic_protocol_recovery_error_code(error).is_some()
}

#[derive(Debug)]
struct ChapterSummaryRecoveryScope {
    novel_id: String,
    chapter_id: String,
    adopted_draft_id: String,
}

fn task_session_id(
    input: &StartTaskTurnInput,
    run_id: &str,
    summary_scope: Option<&ChapterSummaryRecoveryScope>,
) -> String {
    let identity = match summary_scope {
        Some(scope) => large_text_repository::sha256(&format!(
            "chapter-summary\0{}\0{}\0{}\0{}\0{}\0{}",
            input.conversation_id,
            input.turn_id,
            scope.novel_id,
            scope.chapter_id,
            scope.adopted_draft_id,
            run_id,
        )),
        None => large_text_repository::sha256(&input.conversation_id),
    };
    if summary_scope.is_some() {
        format!("session-summary-{}", &identity[..32])
    } else {
        format!("session-{}", &identity[..32])
    }
}

fn chapter_summary_recovery_scope(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
) -> Result<ChapterSummaryRecoveryScope, String> {
    let authorization_id = input
        .turn_id
        .strip_prefix("summary-generation-")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "DSH_PROTOCOL_RECOVERY_SCOPE_INVALID".to_string())?;
    let input_chapter_id = input
        .chapter_id
        .as_deref()
        .ok_or_else(|| "DSH_PROTOCOL_RECOVERY_SCOPE_INVALID".to_string())?;
    let authorization = connection
        .query_row(
            "SELECT novel_id,chapter_id,status,consumed_by_draft_id
             FROM review_authorizations WHERE authorization_id=?1",
            rusqlite::params![authorization_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|_| "DSH_PROTOCOL_RECOVERY_STATE_READ_FAILED".to_string())?
        .ok_or_else(|| "DSH_PROTOCOL_RECOVERY_SCOPE_INVALID".to_string())?;
    let adopted_draft_id = authorization
        .3
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "DSH_PROTOCOL_RECOVERY_SCOPE_INVALID".to_string())?;
    if authorization.0 != input.novel_id
        || authorization.1 != input_chapter_id
        || authorization.2 != "consumed"
    {
        return Err("DSH_PROTOCOL_RECOVERY_SCOPE_INVALID".to_string());
    }
    let adoption_matches = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM chapters
                WHERE id=?1 AND novel_id=?2 AND adopted_draft_id=?3 AND deleted_at IS NULL
             )",
            rusqlite::params![input_chapter_id, &input.novel_id, &adopted_draft_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|_| "DSH_PROTOCOL_RECOVERY_STATE_READ_FAILED".to_string())?;
    if !adoption_matches {
        return Err("DSH_PROTOCOL_RECOVERY_SCOPE_INVALID".to_string());
    }
    Ok(ChapterSummaryRecoveryScope {
        novel_id: authorization.0,
        chapter_id: authorization.1,
        adopted_draft_id,
    })
}

fn chapter_summary_recovery_output_exists(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
    scope: &ChapterSummaryRecoveryScope,
) -> Result<bool, String> {
    let (linked_artifact_count, matching_artifact_count) = connection
        .query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(CASE
                        WHEN artifact.source_novel_id=?3
                         AND artifact.source_chapter_id=?4
                         AND artifact.source_draft_id=?5
                        THEN 1 ELSE 0 END),0)
             FROM result_artifacts AS artifact
             WHERE artifact.artifact_type='chapter_summary'
               AND artifact.processing_status IN ('valid','valid_with_warnings')
               AND (
                    EXISTS(
                        SELECT 1 FROM conversation_artifact_cards AS card
                        WHERE card.artifact_id=artifact.artifact_id
                          AND card.conversation_id=?1
                          AND card.turn_id=?2
                          AND card.artifact_type='chapter_summary'
                    )
                    OR EXISTS(
                        SELECT 1
                        FROM ai_tasks AS task
                        JOIN task_runs AS run
                          ON task.operation_id='workbench-' || run.run_id
                        WHERE task.task_id=artifact.task_id
                          AND run.conversation_id=?1
                          AND run.turn_id=?2
                    )
               )",
            rusqlite::params![
                &input.conversation_id,
                &input.turn_id,
                &scope.novel_id,
                &scope.chapter_id,
                &scope.adopted_draft_id,
            ],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|_| "DSH_PROTOCOL_RECOVERY_STATE_READ_FAILED".to_string())?;
    if linked_artifact_count != matching_artifact_count {
        return Err("DSH_PROTOCOL_RECOVERY_SCOPE_INVALID".to_string());
    }
    if matching_artifact_count > 0 {
        return Ok(true);
    }
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM chapter_summaries
                WHERE novel_id=?1 AND chapter_id=?2 AND adopted_draft_id=?3
                  AND enabled=1 AND is_expired=0
             )",
            rusqlite::params![&scope.novel_id, &scope.chapter_id, &scope.adopted_draft_id,],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|_| "DSH_PROTOCOL_RECOVERY_STATE_READ_FAILED".to_string())
}

fn automatic_protocol_recovery_retry_number(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
    error: &str,
) -> Result<Option<usize>, String> {
    if !is_automatic_protocol_recovery_candidate(input, error) {
        return Ok(None);
    }
    let mut statement = connection
        .prepare(
            "SELECT error,model_snapshot_json
             FROM task_runs
             WHERE conversation_id=?1 AND turn_id=?2 AND status='failed'
             ORDER BY created_at,rowid",
        )
        .map_err(|_| "DSH_PROTOCOL_RECOVERY_STATE_READ_FAILED".to_string())?;
    let rows = statement
        .query_map(
            rusqlite::params![&input.conversation_id, &input.turn_id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|_| "DSH_PROTOCOL_RECOVERY_STATE_READ_FAILED".to_string())?;
    let mut recoverable_failed_runs = 0usize;
    for row in rows {
        let (stored_error, stored_model_snapshot) =
            row.map_err(|_| "DSH_PROTOCOL_RECOVERY_STATE_READ_FAILED".to_string())?;
        if stored_error
            .as_deref()
            .and_then(persisted_automatic_protocol_recovery_error_code)
            .is_none()
        {
            continue;
        }
        let stored_model_snapshot = serde_json::from_str::<Value>(&stored_model_snapshot)
            .map_err(|_| "DSH_PROTOCOL_RECOVERY_STATE_INVALID".to_string())?;
        if stored_model_snapshot != input.model_snapshot {
            return Ok(None);
        }
        recoverable_failed_runs += 1;
    }
    if recoverable_failed_runs == 0
        || recoverable_failed_runs > MAX_AUTOMATIC_PROTOCOL_RECOVERY_RETRIES
    {
        return Ok(None);
    }
    let scope = chapter_summary_recovery_scope(connection, input)?;
    if chapter_summary_recovery_output_exists(connection, input, &scope)? {
        return Ok(None);
    }
    Ok(Some(recoverable_failed_runs))
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskRequestPolicyInput {
    pub max_requests_per_minute: i64,
    pub max_concurrent_requests: i64,
    pub daily_token_budget: Option<i64>,
    pub daily_cost_budget_usd: Option<f64>,
    pub warning_percent: i64,
    pub timeout_seconds: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDescriptor {
    pub source_commit: String,
    pub protocol: String,
    pub status: String,
    pub runtime_root: Option<String>,
    pub node_version: Option<String>,
    pub bundle: String,
    pub isolation: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskRuntimeResult {
    pub run: conversation_service::TaskRunRecord,
    pub session_id: String,
    pub agent_id: String,
    pub worker_id: String,
    pub runtime: String,
    pub assistant_text: Option<String>,
    pub artifact_id: Option<String>,
    pub session_lifecycle: Option<String>,
    pub model_tool_attestation: ModelToolAttestation,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelToolAttestation {
    pub protocol: String,
    pub provider: String,
    pub model: String,
    pub verified: bool,
    pub cached: bool,
    pub verified_at: Option<String>,
    pub expires_at: Option<String>,
    pub cache_ttl_ms: Option<i64>,
    pub finish_kind: Option<String>,
    pub observed_tool_calls: Option<i64>,
    pub failure_code: Option<String>,
    pub provider_failure_code: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskRuntimeStatus {
    pub conversation_id: String,
    pub run_id: String,
    pub session_id: String,
    pub worker_id: String,
    pub status: String,
    pub runtime: String,
    pub error: Option<String>,
}

struct ActiveWorker {
    run_id: String,
    session_id: String,
    worker_id: String,
    cancel: Arc<AtomicBool>,
    process: Arc<Mutex<Option<Arc<WorkerProcess>>>>,
    projection: Arc<Mutex<Option<ProjectionTarget>>>,
    notifier: Option<TaskProjectionObserver>,
    status: String,
    error: Option<String>,
}

struct WorkerProcess {
    runtime: Arc<RuntimeHandle>,
    identity_hash: String,
    model_route: SelectedModelRoute,
    _proxy_guard: ProxyGuard,
    _policy_guard: GovernedProxyPolicyGuard,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SelectedModelRoute {
    logical_provider: String,
    harness_provider: String,
    model: String,
    base_url: String,
}

struct ProviderTransport {
    route: SelectedModelRoute,
    upstream_key: String,
    identity_hash: String,
}

#[derive(Clone)]
struct ProjectionTarget {
    session_id: String,
    run_id: String,
    turn_error: Arc<Mutex<Option<String>>>,
    notifier: Option<TaskProjectionObserver>,
    request_identity: GovernedRequestIdentityReader,
}

static ACTIVE: OnceLock<Mutex<HashMap<String, ActiveWorker>>> = OnceLock::new();
static PLUGIN_PROBE: OnceLock<Mutex<Option<Arc<WorkerProcess>>>> = OnceLock::new();
static PLUGIN_PROBE_REFRESH: OnceLock<Mutex<()>> = OnceLock::new();

fn active() -> &'static Mutex<HashMap<String, ActiveWorker>> {
    ACTIVE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn plugin_probe() -> &'static Mutex<Option<Arc<WorkerProcess>>> {
    PLUGIN_PROBE.get_or_init(|| Mutex::new(None))
}

fn plugin_probe_refresh() -> &'static Mutex<()> {
    PLUGIN_PROBE_REFRESH.get_or_init(|| Mutex::new(()))
}

fn current_plugin_probe() -> Option<Arc<WorkerProcess>> {
    plugin_probe()
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().cloned())
}

fn carrier_files_ready(status: &str) -> bool {
    matches!(status, "available" | "loaded")
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn notify_projection(
    notifier: Option<&TaskProjectionObserver>,
    conversation_id: &str,
    run_id: &str,
    kind: &str,
) -> Result<(), String> {
    let Some(notifier) = notifier else {
        return Ok(());
    };
    notifier(TaskProjectionNotice {
        conversation_id: conversation_id.to_string(),
        run_id: run_id.to_string(),
        kind: kind.to_string(),
        occurred_at: now(),
    })
}

fn required(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{} 不能为空", field))
    } else {
        Ok(())
    }
}

pub(super) fn safe_runtime_error(error: &str) -> String {
    if crate::services::ai_fact_security::contains_secret_text(error) {
        return "DSH 任务失败，敏感详情未写入运行记录".to_string();
    }
    let mut safe = error.chars().take(512).collect::<String>();
    if error.chars().count() > 512 {
        safe.push('…');
    }
    safe
}

fn bounded_stderr_tail(value: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let character_count = normalized.chars().count();
    if character_count <= MAX_DSH_WORKER_STDERR_TAIL_CHARS {
        return normalized;
    }
    let retained = MAX_DSH_WORKER_STDERR_TAIL_CHARS.saturating_sub(1);
    format!(
        "…{}",
        normalized
            .chars()
            .skip(character_count - retained)
            .collect::<String>()
    )
}

fn safe_runtime_stderr_tail(stderr: &str) -> String {
    let trimmed = stderr.trim();
    if trimmed.is_empty() {
        return "<empty>".to_string();
    }
    if crate::services::ai_fact_security::contains_secret_text(trimmed) {
        return safe_runtime_error(trimmed);
    }
    safe_runtime_error(&bounded_stderr_tail(trimmed))
}

pub(super) fn safe_supervisor_error(
    runtime: &RuntimeHandle,
    context: &str,
    error: &SupervisorError,
) -> String {
    if !error.is_frame_channel_disconnected() {
        return safe_runtime_error(&format!("{}: {}", context, error));
    }
    let Some(exit_code) = runtime.diagnostic_child_exit_code() else {
        return DSH_WORKER_FRAME_CHANNEL_DISCONNECTED.to_string();
    };
    let stderr_tail = safe_runtime_stderr_tail(&runtime.diagnostic_stderr_tail());
    safe_runtime_error(&format!(
        "{} [childExitStatus=exit-code:{}; stderrTail={}]",
        DSH_WORKER_FRAME_CHANNEL_DISCONNECTED, exit_code, stderr_tail
    ))
}

pub fn describe_runtime() -> RuntimeDescriptor {
    let root = runtime_root();
    if root.is_none() {
        return RuntimeDescriptor {
            source_commit: DSH_SOURCE_COMMIT.to_string(),
            protocol: DSH_PROTOCOL.to_string(),
            status: "unavailable".to_string(),
            runtime_root: None,
            node_version: None,
            bundle: "scripts/dsh/build-runtime-payload.mjs".to_string(),
            isolation: "one-persistent-worker-per-task".to_string(),
            error: Some("未找到固定 DSH 运行时载体".to_string()),
        };
    }
    let root_value = root.clone().unwrap_or_default();
    match NodeDshRuntime::check_node() {
        Ok(node_version) => {
            let matrix = Path::new(&root_value).join("VERSION_MATRIX.json");
            let matrix_commit = std::fs::read_to_string(matrix)
                .ok()
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                .and_then(|value| {
                    value
                        .get("sourceCommit")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                });
            let checkout_usable = Path::new(&root_value)
                .join("packages/examples/jsonrpc-demo/lib/bin.js")
                .is_file()
                && Path::new(&root_value)
                    .join("packages/sdk/protocol/lib/index.js")
                    .is_file()
                && Path::new(&root_value)
                    .join("packages/core/agent/lib/index.js")
                    .is_file();
            let (status, error) = match matrix_commit.as_deref() {
                Some(DSH_SOURCE_COMMIT) => ("available", None),
                Some(_) => (
                    "failed",
                    Some("载体 VERSION_MATRIX.sourceCommit 与固定基线不符".to_string()),
                ),
                None if checkout_usable => ("available", None),
                None => (
                    "failed",
                    Some("固定载体缺少 VERSION_MATRIX.json，且 checkout 布局不完整".to_string()),
                ),
            };
            RuntimeDescriptor {
                source_commit: DSH_SOURCE_COMMIT.to_string(),
                protocol: DSH_PROTOCOL.to_string(),
                status: status.to_string(),
                runtime_root: Some(root_value),
                node_version: Some(node_version),
                bundle: "scripts/dsh/build-runtime-payload.mjs".to_string(),
                isolation: "one-persistent-worker-per-task".to_string(),
                error,
            }
        }
        Err(error) => RuntimeDescriptor {
            source_commit: DSH_SOURCE_COMMIT.to_string(),
            protocol: DSH_PROTOCOL.to_string(),
            status: "failed".to_string(),
            runtime_root: Some(root_value),
            node_version: None,
            bundle: "scripts/dsh/build-runtime-payload.mjs".to_string(),
            isolation: "one-persistent-worker-per-task".to_string(),
            error: Some(error),
        },
    }
}

fn update_active(conversation_id: &str, status: &str, error: Option<String>) {
    if let Ok(mut workers) = active().lock() {
        if let Some(worker) = workers.get_mut(conversation_id) {
            worker.status = status.to_string();
            worker.error = error;
        }
    }
}

fn event_time(event: &Value) -> String {
    event
        .get("time")
        .and_then(Value::as_i64)
        .and_then(|value| Utc.timestamp_millis_opt(value).single())
        .map(|value| value.to_rfc3339())
        .unwrap_or_else(now)
}

fn stable_projection_id(prefix: &str, run_id: &str, identity: &str) -> String {
    let hash = large_text_repository::sha256(&format!("{}|{}", run_id, identity));
    format!("{}-{}", prefix, &hash[..32])
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DshResponsePosition {
    turn: u64,
    step: u64,
}

impl DshResponsePosition {
    fn response_id(self) -> String {
        format!("turn:{}:step:{}", self.turn, self.step)
    }
}

fn session_event_response_position(
    event: &Value,
    event_type: &str,
) -> Result<DshResponsePosition, String> {
    let turn = event
        .pointer("/data/turn")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .ok_or_else(|| format!("{} 缺少有效 turn", event_type))?;
    let step = event
        .pointer("/data/step")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .ok_or_else(|| format!("{} 缺少有效 step", event_type))?;
    Ok(DshResponsePosition { turn, step })
}

fn persisted_response_position(
    event_id: &str,
    tool_name: &str,
    arguments_summary_json: &str,
) -> Result<DshResponsePosition, AppError> {
    let summary: Value = serde_json::from_str(arguments_summary_json).map_err(|_| {
        AppError::new(
            "DSH_TOOL_RESPONSE_METADATA_INVALID",
            "工具调用缺少可验证的 DSH 响应位置",
            true,
        )
        .with_details(json!({"eventId":event_id,"toolName":tool_name}))
    })?;
    let position = DshResponsePosition {
        turn: summary
            .get("dshTurn")
            .and_then(Value::as_u64)
            .filter(|value| *value > 0)
            .ok_or_else(|| {
                AppError::new(
                    "DSH_TOOL_RESPONSE_METADATA_INVALID",
                    "工具调用缺少可验证的 DSH turn",
                    true,
                )
                .with_details(json!({"eventId":event_id,"toolName":tool_name}))
            })?,
        step: summary
            .get("dshStep")
            .and_then(Value::as_u64)
            .filter(|value| *value > 0)
            .ok_or_else(|| {
                AppError::new(
                    "DSH_TOOL_RESPONSE_METADATA_INVALID",
                    "工具调用缺少可验证的 DSH step",
                    true,
                )
                .with_details(json!({"eventId":event_id,"toolName":tool_name}))
            })?,
    };
    if summary.get("dshResponseId").and_then(Value::as_str) != Some(position.response_id().as_str())
    {
        return Err(AppError::new(
            "DSH_TOOL_RESPONSE_METADATA_INVALID",
            "工具调用的 DSH 响应标识与 turn/step 不一致",
            true,
        )
        .with_details(json!({"eventId":event_id,"toolName":tool_name})));
    }
    Ok(position)
}

fn normalize_tool_name(name: &str) -> String {
    let name = name
        .strip_prefix("mcp__novel__")
        .or_else(|| name.strip_prefix("novel__"))
        .unwrap_or(name);
    if name == "get_metadata"
        || name == "novel.read_context"
        || name.starts_with("novel_read_context_")
    {
        return "novel.read_context".to_string();
    }
    if name == "get_chapter_context"
        || name == "chapter.read_outline"
        || name.starts_with("chapter_read_outline_")
    {
        return "chapter.read_outline".to_string();
    }
    if name == "search_memory" || name.starts_with("search_memory_") {
        return "search_memory".to_string();
    }
    if name == "get_character_states" || name.starts_with("get_character_states_") {
        return "get_character_states".to_string();
    }
    if name == "generate_chapter" || name.starts_with("generate_chapter_") {
        return "generate_chapter".to_string();
    }
    for tool in CANDIDATE_TOOLS.split(',') {
        if name == tool || name.starts_with(&format!("{tool}_")) {
            return tool.to_string();
        }
    }
    name.to_string()
}

fn tool_projection_metadata(
    name: &str,
) -> (&'static str, &'static str, &'static str, &'static str) {
    match name {
        "novel.read_context"
        | "search_memory"
        | "generate_outline"
        | "generate_characters"
        | "expand_settings" => ("1", "novel", "none", "never"),
        "chapter.read_outline"
        | "get_character_states"
        | "generate_chapter"
        | "suggest_events"
        | "polish_chapter"
        | "check_quality"
        | "summarize_chapter" => ("1", "chapter", "none", "never"),
        _ => ("unknown", "runtime", "none", "never"),
    }
}

fn assistant_text(event: &Value) -> String {
    event
        .pointer("/data/message/content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<String>()
}

fn tool_result_text(event: &Value) -> String {
    event
        .pointer("/data/message/content/0/content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<String>()
}

fn tool_error_message(event: &Value, error_code: &str) -> String {
    let content = tool_result_text(event);
    if let Ok(value) = serde_json::from_str::<Value>(&content) {
        if let Some(message) = value.get("error").and_then(Value::as_str) {
            let trimmed = message.trim();
            if !trimmed.is_empty() {
                return trimmed.chars().take(500).collect();
            }
        }
    }
    let trimmed = content.trim();
    if !trimmed.is_empty() {
        return trimmed.chars().take(500).collect();
    }
    error_code.to_string()
}

fn append_generic_projection(
    connection: &mut rusqlite::Connection,
    run_id: &str,
    event: &Value,
    event_type: &str,
    error: Option<String>,
) -> Result<(), AppError> {
    let sequence = event.get("seq").and_then(Value::as_i64).unwrap_or(-1);
    let call_id = format!("event:{}:{}", sequence, event_type);
    let event_id = stable_projection_id("dsh-event", run_id, &call_id);
    if conversation_service::get_tool_event_by_call_id(connection, run_id, &call_id)?.is_some() {
        return Ok(());
    }
    let created_at = event_time(event);
    let record = conversation_service::append_tool_event(
        connection,
        AppendToolEventInput {
            event_id: event_id.clone(),
            run_id: run_id.to_string(),
            tool_name: format!("dsh.{}", event_type.replace('/', ".")),
            arguments_summary: json!({
                "source":"dsh-session.event",
                "callId":call_id,
                "eventType":event_type,
                "dshSequence":sequence
            }),
            status: "queued".to_string(),
            duration_ms: None,
            error: None,
            result: None,
            created_at,
            finished_at: None,
        },
    )?;
    let _ = conversation_service::update_tool_event(
        connection,
        UpdateToolEventInput {
            event_id: record.event_id.clone(),
            status: "running".to_string(),
            duration_ms: None,
            error: None,
            result: None,
            finished_at: None,
        },
    )?;
    let finished_at = event_time(event);
    let _ = conversation_service::update_tool_event(
        connection,
        UpdateToolEventInput {
            event_id,
            status: if error.is_some() {
                "failed"
            } else {
                "succeeded"
            }
            .to_string(),
            duration_ms: Some(0),
            error,
            result: Some(json!({"eventType":event_type,"dshSequence":sequence})),
            finished_at: Some(finished_at),
        },
    )?;
    Ok(())
}

fn project_session_event(
    notification: &Value,
    expected_session_id: &str,
    conversation_id: &str,
    run_id: &str,
    turn_error: &Arc<Mutex<Option<String>>>,
    notifier: Option<&TaskProjectionObserver>,
    request_identity: &GovernedRequestIdentityReader,
) -> Result<(), String> {
    if notification
        .pointer("/params/sessionId")
        .and_then(Value::as_str)
        != Some(expected_session_id)
    {
        return Ok(());
    }
    let event = notification
        .pointer("/params/event")
        .ok_or_else(|| "session.event 缺少 event".to_string())?;
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| "session.event 缺少 type".to_string())?;
    let sequence = event.get("seq").and_then(Value::as_i64).unwrap_or(-1);
    let mut connection = crate::db::get_connection()
        .lock()
        .map_err(|_| "session.event 数据库锁失败".to_string())?;
    let projection_kind = match event_type {
        "tool/call" => {
            let response_position = session_event_response_position(event, event_type)?;
            let response_id = response_position.response_id();
            let call_id = event
                .pointer("/data/callId")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "tool/call 缺少 callId".to_string())?;
            if conversation_service::get_tool_event_by_call_id(&connection, run_id, call_id)
                .map_err(|error| error.to_string())?
                .is_some()
            {
                return Ok(());
            }
            let raw_name = event
                .pointer("/data/name")
                .and_then(Value::as_str)
                .ok_or_else(|| "tool/call 缺少 name".to_string())?;
            let tool_name = normalize_tool_name(raw_name);
            if !ALLOWED_TOOLS.split(',').any(|allowed| allowed == tool_name) {
                return Err(format!("DSH 调用了未授权工具: {}", tool_name));
            }
            let arguments = event
                .pointer("/data/arguments")
                .and_then(Value::as_str)
                .unwrap_or("");
            let (tool_version, scope, side_effect, confirmation_policy) =
                tool_projection_metadata(&tool_name);
            let parsed_arguments = serde_json::from_str::<Value>(arguments).ok();
            let novel_id_hash = parsed_arguments
                .as_ref()
                .and_then(|value| value.get("novelId"))
                .and_then(Value::as_str)
                .map(large_text_repository::sha256);
            let chapter_id_hash = parsed_arguments
                .as_ref()
                .and_then(|value| value.get("chapterId"))
                .and_then(Value::as_str)
                .map(large_text_repository::sha256);
            let governed_identity = request_identity
                .lock()
                .ok()
                .and_then(|identity| identity.clone());
            let event_id = stable_projection_id("dsh-tool", run_id, call_id);
            let created_at = event_time(event);
            let record = conversation_service::append_tool_event(
                &mut connection,
                AppendToolEventInput {
                    event_id: event_id.clone(),
                    run_id: run_id.to_string(),
                    tool_name,
                    arguments_summary: json!({
                        "source":"dsh-session.event",
                        "callId":call_id,
                        "dshSequence":sequence,
                        "dshTurn":response_position.turn,
                        "dshStep":response_position.step,
                        "dshResponseId":response_id,
                        "argumentsBytes":arguments.len(),
                        "argumentsHash":large_text_repository::sha256(arguments),
                        "toolVersion":tool_version,
                        "scope":scope,
                        "sideEffect":side_effect,
                        "confirmationPolicy":confirmation_policy,
                        "novelIdHash":novel_id_hash,
                        "chapterIdHash":chapter_id_hash,
                        "governedProviderRequestId":governed_identity.as_ref().map(|value| value.provider_request_id.as_str()),
                        "governedReservationId":governed_identity.as_ref().map(|value| value.reservation_id.as_str())
                    }),
                    status: "queued".to_string(),
                    duration_ms: None,
                    error: None,
                    result: None,
                    created_at,
                    finished_at: None,
                },
            )
            .map_err(|error| error.to_string())?;
            conversation_service::update_tool_event(
                &mut connection,
                UpdateToolEventInput {
                    event_id: record.event_id,
                    status: "running".to_string(),
                    duration_ms: None,
                    error: None,
                    result: None,
                    finished_at: None,
                },
            )
            .map_err(|error| error.to_string())?;
            Some("tool")
        }
        "tool/result" => {
            let call_id = event
                .pointer("/data/message/source/callId")
                .or_else(|| event.pointer("/data/message/content/0/toolCallId"))
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "tool/result 缺少 callId".to_string())?;
            let record =
                conversation_service::get_tool_event_by_call_id(&connection, run_id, call_id)
                    .map_err(|error| error.to_string())?
                    .ok_or_else(|| format!("tool/result 找不到对应调用: {}", call_id))?;
            if matches!(
                record.status.as_str(),
                "succeeded" | "failed" | "cancelled" | "skipped"
            ) {
                return Ok(());
            }
            let content = tool_result_text(event);
            let is_error = event
                .pointer("/data/message/content/0/isError")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || event.pointer("/data/error").is_some();
            let error_code = event
                .pointer("/data/error/code")
                .and_then(Value::as_str)
                .unwrap_or(if is_error { "DSH_TOOL_FAILED" } else { "" });
            let error_message = if is_error {
                Some(tool_error_message(event, error_code))
            } else {
                None
            };
            let mut result = json!({
                "callId":call_id,
                "dshSequence":sequence,
                "contentChars":content.chars().count(),
                "contentHash":large_text_repository::sha256(&content),
                "isError":is_error,
                "structuredJson":serde_json::from_str::<Value>(&content).is_ok()
            });
            if !content.is_empty() {
                let document_id = format!("{}-result", record.event_id);
                let exists: bool = connection
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM large_text_documents WHERE id=?1)",
                        rusqlite::params![document_id],
                        |row| row.get(0),
                    )
                    .map_err(|error| error.to_string())?;
                if !exists {
                    large_text_repository::insert_document_for_target(
                        &connection,
                        &document_id,
                        "tool_event",
                        &record.event_id,
                        "result",
                        None,
                        &content,
                        &large_text_repository::sha256(&content),
                        &event_time(event),
                    )
                    .map_err(|error| error.to_string())?;
                }
                result["largeTextRefId"] = Value::String(document_id);
            }
            if let Some(generation_context) =
                candidate_generation_context(&connection, run_id, &record.tool_name, is_error)
                    .map_err(|error| error.to_string())?
            {
                result["generationContext"] = generation_context;
            }
            let duration_ms = chrono::DateTime::parse_from_rfc3339(&record.created_at)
                .ok()
                .map(|started| {
                    (Utc::now() - started.with_timezone(&Utc))
                        .num_milliseconds()
                        .max(0)
                });
            conversation_service::update_tool_event(
                &mut connection,
                UpdateToolEventInput {
                    event_id: record.event_id,
                    status: if is_error { "failed" } else { "succeeded" }.to_string(),
                    duration_ms,
                    error: error_message,
                    result: Some(result),
                    finished_at: Some(event_time(event)),
                },
            )
            .map_err(|error| error.to_string())?;
            Some("tool")
        }
        "assistant/message" => {
            let content = assistant_text(event);
            if !content.trim().is_empty() {
                let turn_id =
                    stable_projection_id("dsh-message", run_id, &format!("assistant:{}", sequence));
                conversation_service::append_runtime_assistant_turn(
                    &mut connection,
                    &turn_id,
                    conversation_id,
                    run_id,
                    &content,
                    &event_time(event),
                )
                .map_err(|error| error.to_string())?;
            }
            Some("assistant")
        }
        "turn/end" => {
            if event.pointer("/data/reason/kind").and_then(Value::as_str) == Some("error") {
                let code = event
                    .pointer("/data/reason/error/code")
                    .and_then(Value::as_str)
                    .unwrap_or("DSH_TURN_FAILED");
                *turn_error
                    .lock()
                    .map_err(|_| "DSH 回合错误状态锁失败".to_string())? = Some(code.to_string());
                append_generic_projection(
                    &mut connection,
                    run_id,
                    event,
                    event_type,
                    Some(code.to_string()),
                )
                .map_err(|error| error.to_string())?;
            }
            (event.pointer("/data/reason/kind").and_then(Value::as_str) == Some("error"))
                .then_some("tool")
        }
        "turn/start"
        | "step/start"
        | "step/end"
        | "user/message"
        | "assistant/chunk"
        | "agent/inbox/spliced"
        | "request/header"
        | "request/context" => None,
        _ => {
            append_generic_projection(&mut connection, run_id, event, event_type, None)
                .map_err(|error| error.to_string())?;
            Some("tool")
        }
    };
    drop(connection);
    if let Some(kind) = projection_kind {
        notify_projection(notifier, conversation_id, run_id, kind)?;
    }
    Ok(())
}

struct GeneratedChapterResult {
    text: String,
    structured: Value,
    provider_request_id: String,
}

fn artifact_projection_summary(
    processing_status: &str,
    warning_count: usize,
    error_count: usize,
) -> Result<&'static str, AppError> {
    match processing_status {
        "valid" => Ok("候选已通过产物契约校验，需在对话中确认后才会写入正式事实。"),
        "valid_with_warnings" => Ok("候选已通过产物契约校验，但包含警告；确认前请查看校验详情。"),
        _ => Err(AppError::new(
            "ARTIFACT_VALIDATION_FAILED",
            "候选未通过产物契约校验，原始响应与校验问题已保留",
            true,
        )
        .with_details(json!({
            "processingStatus": processing_status,
            "warningCount": warning_count,
            "errorCount": error_count,
        }))),
    }
}

struct ChapterBaseSnapshot {
    chapter_revision: String,
    draft_id: Option<String>,
    draft_version: Option<i64>,
    content_hash: Option<String>,
}

fn validate_turn_execution_contract(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
    run_id: &str,
) -> Result<Option<String>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT event_id, sequence, tool_name, status, arguments_summary_json
             FROM tool_call_events WHERE run_id=?1 ORDER BY sequence",
        )
        .map_err(AppError::database)?;
    let calls = statement
        .query_map(rusqlite::params![run_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    let candidate_calls = calls
        .iter()
        .filter(|(_, _, tool, _, _)| CANDIDATE_TOOLS.split(',').any(|item| item == tool))
        .collect::<Vec<_>>();

    let Some(expected_tool) = input.expected_tool.as_deref() else {
        if !candidate_calls.is_empty() {
            return Err(AppError::new(
                "DSH_UNEXPECTED_CANDIDATE_TOOL",
                "本轮任务不允许生成候选，但模型调用了候选工具",
                true,
            )
            .with_details(json!({
                "taskKind": input.task_kind,
                "observedCandidateTools": candidate_calls
                    .iter()
                    .map(|(_, _, tool, _, _)| tool.as_str())
                    .collect::<Vec<_>>()
            })));
        }
        for required_tool in &input.required_read_tools {
            let successful_read = calls
                .iter()
                .find(|(_, _, tool, status, _)| tool == required_tool && status == "succeeded");
            let Some((event_id, _, tool, _, arguments_summary_json)) = successful_read else {
                return Err(AppError::new(
                    "DSH_REQUIRED_CONTEXT_READ_MISSING",
                    format!("只读任务必须成功完成上下文读取 {}", required_tool),
                    true,
                )
                .with_details(json!({
                    "taskKind": input.task_kind,
                    "requiredReadTool": required_tool
                })));
            };
            persisted_response_position(event_id, tool, arguments_summary_json)?;
        }
        return Ok(None);
    };

    if candidate_calls.is_empty() {
        return Err(AppError::new(
            "DSH_REQUIRED_CANDIDATE_TOOL_MISSING",
            format!("本轮必须调用候选工具 {}，实际调用 0 次", expected_tool),
            true,
        )
        .with_details(json!({
            "taskKind": input.task_kind,
            "expectedTool": expected_tool,
            "attemptCount": 0
        })));
    }
    if candidate_calls.len() > MAX_CANDIDATE_TOOL_ATTEMPTS {
        return Err(AppError::new(
            "DSH_CANDIDATE_TOOL_COUNT_INVALID",
            format!(
                "本轮候选工具 {} 必须调用 1 到 {} 次，实际调用 {} 次",
                expected_tool,
                MAX_CANDIDATE_TOOL_ATTEMPTS,
                candidate_calls.len()
            ),
            true,
        ));
    }
    if let Some((_, _, candidate_tool, _, _)) = candidate_calls
        .iter()
        .copied()
        .find(|(_, _, tool, _, _)| tool != expected_tool)
    {
        return Err(AppError::new(
            "DSH_UNEXPECTED_CANDIDATE_TOOL",
            format!(
                "本轮预期候选工具 {}，模型实际调用 {}",
                expected_tool, candidate_tool
            ),
            true,
        ));
    }
    let successful_calls = candidate_calls
        .iter()
        .copied()
        .filter(|(_, _, _, status, _)| status == "succeeded")
        .collect::<Vec<_>>();
    if successful_calls.is_empty() {
        return Err(AppError::new(
            "DSH_EXPECTED_CANDIDATE_FAILED",
            format!("预期候选工具 {} 未成功完成", expected_tool),
            true,
        )
        .with_details(json!({
            "taskKind": input.task_kind,
            "expectedTool": expected_tool,
            "attemptCount": candidate_calls.len()
        })));
    }
    if successful_calls.len() != 1 {
        return Err(AppError::new(
            "DSH_CANDIDATE_TOOL_COUNT_INVALID",
            format!("候选工具 {} 必须且只能成功一次", expected_tool),
            true,
        ));
    }
    let (candidate_event_id, _, _, _, _) = successful_calls[0];
    let valid_retry_sequence = candidate_calls
        .iter()
        .take(candidate_calls.len().saturating_sub(1))
        .all(|(_, _, _, status, _)| status == "failed")
        && candidate_calls
            .last()
            .is_some_and(|(event_id, _, _, status, _)| {
                event_id == candidate_event_id && status == "succeeded"
            });
    if !valid_retry_sequence {
        return Err(AppError::new(
            "DSH_CANDIDATE_RETRY_SEQUENCE_INVALID",
            "候选工具只能在失败后重试，成功后不得继续调用",
            true,
        ));
    }

    let first_candidate_sequence = candidate_calls[0].1;
    let candidate_positions = candidate_calls
        .iter()
        .map(|(event_id, _, tool_name, _, arguments_summary_json)| {
            persisted_response_position(event_id, tool_name, arguments_summary_json)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let first_candidate_position = candidate_positions[0];
    for required_tool in &input.required_read_tools {
        let mut read_before_candidate = false;
        for (event_id, sequence, tool, status, arguments_summary_json) in &calls {
            if tool != required_tool || status != "succeeded" {
                continue;
            }
            let read_position =
                persisted_response_position(event_id, tool, arguments_summary_json)?;
            read_before_candidate |= *sequence < first_candidate_sequence
                && read_position.turn == first_candidate_position.turn
                && read_position.step < first_candidate_position.step;
        }
        if !read_before_candidate {
            return Err(AppError::new(
                "DSH_REQUIRED_CONTEXT_READ_MISSING",
                format!(
                    "候选工具 {} 必须在上下文读取 {} 成功后的后续 DSH step 调用",
                    expected_tool, required_tool
                ),
                true,
            )
            .with_details(json!({
                "taskKind": input.task_kind,
                "expectedTool": expected_tool,
                "requiredReadTool": required_tool,
                "candidateTurn": first_candidate_position.turn,
                "candidateStep": first_candidate_position.step
            })));
        }
    }
    Ok(Some(candidate_event_id.clone()))
}

fn read_chapter_base_snapshot(
    connection: &rusqlite::Connection,
    novel_id: &str,
    chapter_id: &str,
) -> Result<ChapterBaseSnapshot, AppError> {
    let (adopted_draft_id, chapter_revision) = connection
        .query_row(
            "SELECT adopted_draft_id, updated_at FROM chapters
             WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL",
            rusqlite::params![chapter_id, novel_id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| {
            AppError::new(
                "DSH_CHAPTER_TARGET_NOT_FOUND",
                "章节候选的目标章节不存在或不属于当前作品",
                false,
            )
        })?;
    let Some(draft_id) = adopted_draft_id else {
        return Ok(ChapterBaseSnapshot {
            chapter_revision,
            draft_id: None,
            draft_version: None,
            content_hash: None,
        });
    };
    let draft = draft_repository::find_draft(connection, &draft_id)?.ok_or_else(|| {
        AppError::new(
            "DSH_CHAPTER_BASE_DRAFT_NOT_FOUND",
            "章节采用草稿引用不存在",
            false,
        )
    })?;
    if draft.novel_id != novel_id || draft.chapter_id != chapter_id || !draft.is_adopted {
        return Err(AppError::new(
            "DSH_CHAPTER_BASE_DRAFT_INVALID",
            "章节采用草稿的作品、章节或采用状态无效",
            false,
        ));
    }
    let content_hash = if let Some(document_id) = draft.large_text_ref_id.as_deref() {
        large_text_repository::read_verified_for_draft(
            connection,
            document_id,
            &draft.id,
            &draft.chapter_id,
        )?
        .content_hash
    } else {
        large_text_repository::sha256(&draft.content)
    };
    if draft
        .content_hash
        .as_deref()
        .is_some_and(|expected| !expected.eq_ignore_ascii_case(&content_hash))
    {
        return Err(AppError::new(
            "DSH_CHAPTER_BASE_HASH_MISMATCH",
            "章节采用草稿完整性校验失败",
            false,
        ));
    }
    Ok(ChapterBaseSnapshot {
        chapter_revision,
        draft_id: Some(draft.id),
        draft_version: Some(draft.version_no),
        content_hash: Some(content_hash),
    })
}

fn requires_world_and_rule_settings(input: &StartTaskTurnInput) -> bool {
    input.task_kind == "setting_expand"
        && input
            .goal
            .trim_start()
            .starts_with(WORLD_AND_RULE_SETTINGS_DIRECTIVE)
}

fn requires_rule_system_settings(input: &StartTaskTurnInput) -> bool {
    input.task_kind == "setting_expand"
        && input
            .goal
            .trim_start()
            .starts_with(RULE_SYSTEM_SETTINGS_DIRECTIVE)
}

fn requires_primary_protagonist(input: &StartTaskTurnInput) -> bool {
    input.task_kind == "character_generate"
        && input
            .goal
            .trim_start()
            .starts_with(PROTAGONIST_CANDIDATE_DIRECTIVE)
}

fn candidate_validation_policy(input: &StartTaskTurnInput) -> Option<String> {
    if input.task_kind == "story_plan_generate" {
        input.book_word_goal.as_ref().map(|goal| {
            format!(
                "book_word_goal_v1:{}:{}:{}:{}",
                goal.target_words,
                goal.minimum_words,
                goal.maximum_words,
                goal.source_content_sha256
            )
        })
    } else if requires_world_and_rule_settings(input) {
        Some("world_rule_bundle_v1".to_string())
    } else if requires_rule_system_settings(input) {
        Some("rule_system_only_v1".to_string())
    } else if requires_primary_protagonist(input) {
        Some("primary_protagonist_v1".to_string())
    } else {
        None
    }
}

fn character_candidate_is_protagonist(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object
        .get("roleType")
        .and_then(Value::as_str)
        .is_some_and(|value| value.trim() == "protagonist")
}

fn validate_primary_protagonist_candidate(candidate_text: &str) -> Result<(), AppError> {
    let parsed: Value = serde_json::from_str(candidate_text).map_err(|_| {
        AppError::new(
            "DSH_PROTAGONIST_CANDIDATE_INVALID",
            "主角候选不是合法 JSON",
            true,
        )
    })?;
    let items = parsed
        .get("characters")
        .or_else(|| parsed.get("candidates"))
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::new(
                "DSH_PROTAGONIST_CANDIDATE_INVALID",
                "主角候选缺少 characters 数组",
                true,
            )
        })?;
    let protagonists = items
        .iter()
        .filter(|item| character_candidate_is_protagonist(item))
        .collect::<Vec<_>>();
    let protagonist_count = protagonists.len();
    if protagonist_count != 1 {
        return Err(AppError::new(
            "DSH_PROTAGONIST_CANDIDATE_INCOMPLETE",
            "自动主角候选必须恰好包含一个 roleType=protagonist 的主角",
            true,
        )
        .with_details(json!({ "protagonistCount": protagonist_count })));
    }
    let protagonist = protagonists[0].as_object().ok_or_else(|| {
        AppError::new(
            "DSH_PROTAGONIST_CANDIDATE_INVALID",
            "主角候选必须是 JSON 对象",
            true,
        )
    })?;
    let has_text = |key: &str| {
        protagonist
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
    };
    let missing_fields = ["name", "identity", "goal", "personality"]
        .into_iter()
        .filter(|key| !has_text(key))
        .collect::<Vec<_>>();
    if !missing_fields.is_empty() {
        return Err(AppError::new(
            "DSH_PROTAGONIST_CANDIDATE_INCOMPLETE",
            "自动主角候选必须包含姓名、身份、目标和性格",
            true,
        )
        .with_details(json!({
            "missingFields": missing_fields,
        })));
    }
    Ok(())
}

fn setting_candidate_is_rule(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let target = object
        .get("targetType")
        .or_else(|| object.get("target"))
        .and_then(Value::as_str)
        .map(|value| value.trim().to_ascii_lowercase());
    if matches!(target.as_deref(), Some("rule_system" | "rule")) {
        return true;
    }
    let category = object
        .get("category")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_ascii_lowercase());
    matches!(
        category.as_deref(),
        Some(
            "world_rules"
                | "world_rule"
                | "rule"
                | "rules"
                | "magic"
                | "technology"
                | "cultivation"
                | "combat"
                | "social"
        )
    )
}

fn validate_world_and_rule_settings_candidate(candidate_text: &str) -> Result<(), AppError> {
    let parsed: Value = serde_json::from_str(candidate_text).map_err(|_| {
        AppError::new(
            "DSH_WORLD_RULE_BUNDLE_INVALID",
            "世界与规则设定候选不是合法 JSON",
            true,
        )
    })?;
    let items = parsed
        .get("settings")
        .or_else(|| parsed.get("candidates"))
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::new(
                "DSH_WORLD_RULE_BUNDLE_INVALID",
                "世界与规则设定候选缺少 settings 数组",
                true,
            )
        })?;
    let has_usable_description = |item: &Value| {
        item.as_object().is_some_and(|object| {
            object
                .get("description")
                .or_else(|| object.get("content"))
                .and_then(Value::as_str)
                .is_some_and(|value| !value.trim().is_empty())
        })
    };
    let has_rule = items
        .iter()
        .filter(|item| setting_candidate_is_rule(item))
        .any(has_usable_description);
    let has_world = items
        .iter()
        .filter(|item| item.as_object().is_some() && !setting_candidate_is_rule(item))
        .any(has_usable_description);
    if !has_world || !has_rule {
        return Err(AppError::new(
            "DSH_WORLD_RULE_BUNDLE_INCOMPLETE",
            "短创意的设定候选必须同时包含有具体描述的世界设定和规则边界",
            true,
        )
        .with_details(json!({
            "hasWorldSetting": has_world,
            "hasRuleSystem": has_rule,
        })));
    }
    Ok(())
}

fn validate_rule_system_settings_candidate(candidate_text: &str) -> Result<(), AppError> {
    let parsed: Value = serde_json::from_str(candidate_text).map_err(|_| {
        AppError::new(
            "DSH_RULE_SYSTEM_CANDIDATE_INVALID",
            "规则设定候选不是合法 JSON",
            true,
        )
    })?;
    let items = parsed
        .get("settings")
        .or_else(|| parsed.get("candidates"))
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::new(
                "DSH_RULE_SYSTEM_CANDIDATE_INVALID",
                "规则设定候选缺少 settings 数组",
                true,
            )
        })?;
    let valid = !items.is_empty()
        && items.iter().all(|item| {
            setting_candidate_is_rule(item)
                && item.as_object().is_some_and(|object| {
                    object
                        .get("description")
                        .or_else(|| object.get("content"))
                        .and_then(Value::as_str)
                        .is_some_and(|value| !value.trim().is_empty())
                })
        });
    if !valid {
        return Err(AppError::new(
            "DSH_RULE_SYSTEM_CANDIDATE_INCOMPLETE",
            "规则补齐候选只能包含有具体描述的 targetType=rule_system 规则项",
            true,
        ));
    }
    Ok(())
}

fn read_generated_chapter_result(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
    run_id: &str,
    candidate_event_id: Option<&str>,
) -> Result<Option<GeneratedChapterResult>, AppError> {
    let Some(candidate_event_id) = candidate_event_id else {
        return Ok(None);
    };
    let tool_projection = connection
        .query_row(
            "SELECT tool_name, result_json, arguments_summary_json FROM tool_call_events
             WHERE run_id=?1 AND event_id=?2 AND status='succeeded'",
            rusqlite::params![run_id, candidate_event_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?;
    let Some((candidate_tool, Some(result_json), arguments_summary_json)) = tool_projection else {
        return Err(AppError::new(
            "DSH_EXPECTED_CANDIDATE_RESULT_MISSING",
            "预期候选工具没有可验证的成功结果",
            true,
        ));
    };
    if input.expected_tool.as_deref() != Some(candidate_tool.as_str()) {
        return Err(AppError::new(
            "DSH_UNEXPECTED_CANDIDATE_TOOL",
            "候选结果工具与本轮冻结契约不一致",
            false,
        ));
    }
    let arguments_summary: Value = serde_json::from_str(&arguments_summary_json)
        .map_err(|error| AppError::new("DSH_TOOL_ARGUMENTS_INVALID", error.to_string(), false))?;
    let provider_request_id = arguments_summary
        .get("governedProviderRequestId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AppError::new(
                "DSH_PROVIDER_REQUEST_ID_REQUIRED",
                "generate_chapter 缺少实际治理请求身份",
                false,
            )
        })?;
    let summary: Value = serde_json::from_str(&result_json)
        .map_err(|error| AppError::new("DSH_TOOL_RESULT_INVALID", error.to_string(), false))?;
    let document_id = summary
        .get("largeTextRefId")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::new(
                "DSH_TOOL_RESULT_REFERENCE_REQUIRED",
                "generate_chapter 结果缺少大文本引用",
                false,
            )
        })?;
    let verified = large_text_repository::read_verified_document(connection, document_id)?;
    if summary.get("contentHash").and_then(Value::as_str) != Some(verified.content_hash.as_str()) {
        return Err(AppError::new(
            "DSH_TOOL_RESULT_HASH_MISMATCH",
            "generate_chapter 结果引用哈希不一致",
            false,
        ));
    }
    let structured: Value = serde_json::from_str(&verified.content).map_err(|_| {
        AppError::new(
            "DSH_TOOL_RESULT_INVALID",
            "generate_chapter 结果不是合法 JSON",
            false,
        )
    })?;
    let artifact_type = structured
        .get("artifactType")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if input.expected_artifact_type.as_deref() != Some(artifact_type) {
        return Err(AppError::new(
            "DSH_UNEXPECTED_ARTIFACT_TYPE",
            format!(
                "本轮预期产物 {}，候选工具返回 {}",
                input.expected_artifact_type.as_deref().unwrap_or("无"),
                artifact_type
            ),
            false,
        ));
    }
    let requires_chapter = matches!(
        artifact_type,
        "chapter_text" | "quality_report" | "chapter_summary" | "event_candidates"
    );
    let chapter_id = input.chapter_id.as_deref();
    if requires_chapter && chapter_id.is_none() {
        return Err(AppError::new(
            "DSH_CHAPTER_TARGET_REQUIRED",
            "该候选工具必须绑定目标章节",
            false,
        ));
    }
    let valid_scope = structured.get("ok").and_then(Value::as_bool) == Some(true)
        && structured.get("candidateOnly").and_then(Value::as_bool) == Some(true)
        && matches!(
            (candidate_tool.as_str(), artifact_type),
            ("generate_chapter" | "polish_chapter", "chapter_text")
                | ("generate_outline", "outline")
                | ("generate_characters", "character_candidates")
                | ("suggest_events", "event_candidates")
                | ("expand_settings", "setting_candidates")
                | ("check_quality", "quality_report")
                | ("summarize_chapter", "chapter_summary")
        )
        && structured.pointer("/data/novelId").and_then(Value::as_str)
            == Some(input.novel_id.as_str())
        && (!requires_chapter
            || structured
                .pointer("/data/chapterId")
                .and_then(Value::as_str)
                == chapter_id);
    let text = structured
        .pointer("/data/text")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty());
    if !valid_scope || text.is_none() {
        return Err(AppError::new(
            "DSH_GENERATED_CHAPTER_SCOPE_INVALID",
            "generate_chapter 结果契约或作品/章节归属无效",
            false,
        ));
    }
    if candidate_tool == "expand_settings" && requires_world_and_rule_settings(input) {
        validate_world_and_rule_settings_candidate(text.unwrap_or_default())?;
    }
    if candidate_tool == "expand_settings" && requires_rule_system_settings(input) {
        validate_rule_system_settings_candidate(text.unwrap_or_default())?;
    }
    if candidate_tool == "generate_characters" && requires_primary_protagonist(input) {
        validate_primary_protagonist_candidate(text.unwrap_or_default())?;
    }
    Ok(Some(GeneratedChapterResult {
        text: text.unwrap_or_default().to_string(),
        structured,
        provider_request_id: provider_request_id.to_string(),
    }))
}

fn context_value_present(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::String(value)) => !value.trim().is_empty(),
        Some(Value::Array(values)) => !values.is_empty(),
        Some(Value::Object(values)) => !values.is_empty(),
        Some(Value::Bool(value)) => *value,
        Some(Value::Number(_)) => true,
    }
}

fn push_context_receipt(sources: &mut Vec<Value>, source_type: &str, title: &str, present: bool) {
    let status = if present { "used" } else { "missing" };
    if let Some(existing) = sources
        .iter_mut()
        .find(|source| source.get("type").and_then(Value::as_str) == Some(source_type))
    {
        if present {
            existing["status"] = Value::String(status.to_string());
            existing["title"] = Value::String(title.to_string());
        }
        return;
    }
    sources.push(json!({
        "type": source_type,
        "title": title,
        "status": status
    }));
}

fn collect_context_receipts(tool_name: &str, payload: &Value, sources: &mut Vec<Value>) {
    match tool_name {
        "novel.read_context" => {
            for (source_type, title, pointer) in [
                ("novel", "作品信息", "/data/novel"),
                ("world_setting", "世界设定", "/data/worldSettings"),
                ("rule_system", "规则设定", "/data/ruleSystems"),
                ("protagonist", "主角资料", "/data/protagonists"),
                ("master_outline", "全书总纲", "/data/masterOutline"),
                ("volume_outline", "分卷大纲", "/data/volumeOutlines"),
                ("chapter_outline", "章节大纲", "/data/currentChapterOutline"),
                ("style_profile", "写作风格", "/data/styleProfiles"),
                ("output_profile", "输出方案", "/data/outputProfiles"),
                ("faction", "势力资产", "/data/factions"),
                ("location", "地点资产", "/data/locations"),
                (
                    "reference_material",
                    "参考资料正文摘录",
                    "/data/referenceExcerpts",
                ),
            ] {
                push_context_receipt(
                    sources,
                    source_type,
                    title,
                    context_value_present(payload.pointer(pointer)),
                );
            }
        }
        "chapter.read_outline" => {
            for (source_type, title, pointer) in [
                ("chapter_outline", "章节大纲", "/data/outline"),
                (
                    "engineering_state",
                    "章节工程状态",
                    "/data/engineeringState",
                ),
                ("chapter_character", "本章人物安排", "/data/chapterRoles"),
                (
                    "adopted_chapter",
                    "本章采用正文",
                    "/data/currentAdoptedDraft",
                ),
                ("chapter_event", "本章事件", "/data/chapterEvents"),
                (
                    "chapter_summary",
                    "章节总结",
                    "/data/previousChapterSummaries",
                ),
            ] {
                push_context_receipt(
                    sources,
                    source_type,
                    title,
                    context_value_present(payload.pointer(pointer)),
                );
            }
        }
        "get_character_states" => {
            for (source_type, title, pointer) in [
                ("character", "人物库", "/data/characters"),
                ("character_state", "人物动态状态", "/data/stateTrack"),
                ("chapter_character", "本章人物安排", "/data/chapterRoles"),
            ] {
                push_context_receipt(
                    sources,
                    source_type,
                    title,
                    context_value_present(payload.pointer(pointer)),
                );
            }
        }
        "search_memory" => push_context_receipt(
            sources,
            "memory_context",
            "长期记忆",
            context_value_present(payload.pointer("/data/chunks")),
        ),
        _ => {}
    }
}

fn build_context_evidence(
    connection: &rusqlite::Connection,
    run_id: &str,
) -> Result<(Value, String, Value, Value), AppError> {
    let mut statement = connection
        .prepare(
            "SELECT event_id, tool_name, arguments_summary_json, result_json
             FROM tool_call_events
             WHERE run_id = ?1 AND status = 'succeeded'
               AND instr(',' || ?2 || ',', ',' || tool_name || ',') > 0
             ORDER BY sequence",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(rusqlite::params![run_id, CONTEXT_READ_TOOLS], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    let mut sources = Vec::new();
    let mut context_receipts = Vec::new();
    for (event_id, tool_name, arguments_json, result_json) in rows {
        let arguments: Value = serde_json::from_str(&arguments_json).unwrap_or_else(|_| json!({}));
        let result: Value = result_json
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok())
            .unwrap_or_else(|| json!({}));
        if let Some(document_id) = result.get("largeTextRefId").and_then(Value::as_str) {
            if let Ok(verified) =
                large_text_repository::read_verified_document(connection, document_id)
            {
                if result.get("contentHash").and_then(Value::as_str)
                    == Some(verified.content_hash.as_str())
                {
                    if let Ok(payload) = serde_json::from_str::<Value>(&verified.content) {
                        collect_context_receipts(&tool_name, &payload, &mut context_receipts);
                    }
                }
            }
        }
        sources.push(json!({
            "eventId": event_id,
            "toolName": tool_name,
            "toolVersion": arguments.get("toolVersion").and_then(Value::as_str),
            "argumentsHash": arguments.get("argumentsHash").and_then(Value::as_str),
            "largeTextRefId": result.get("largeTextRefId").and_then(Value::as_str),
            "contentHash": result.get("contentHash").and_then(Value::as_str),
            "contentChars": result.get("contentChars").and_then(Value::as_i64)
        }));
    }
    let generation_context = json!({
        "contractVersion": "workbench_dsh_context_receipt_v1",
        "sources": context_receipts
    });
    let compiled_context = serde_json::to_string(&json!({
        "contractVersion": "workbench_dsh_context_evidence_v1",
        "sources": sources,
        "generationContext": generation_context.clone()
    }))
    .map_err(|error| AppError::new("DSH_CONTEXT_EVIDENCE_INVALID", error.to_string(), false))?;
    let compiled_chars = compiled_context.chars().count();
    let compiled_bytes = compiled_context.len();
    let included_sources = sources.len();
    let manifest = json!({
        "contractVersion": "workbench_dsh_context_evidence_v1",
        "compilerVersion": "workbench_dsh_context_evidence_v1",
        "compiledContextHash": large_text_repository::sha256(&compiled_context),
        "sources": sources
    });
    let budget = json!({
        "maxChars": compiled_chars,
        "estimatedTokens": if compiled_bytes == 0 { 0 } else { (compiled_bytes + 2) / 3 },
        "compiledContextChars": compiled_chars,
        "compiledContextBytes": compiled_bytes,
        "includedSourceCount": included_sources,
        "truncatedSourceCount": 0,
        "omittedSourceCount": 0
    });
    Ok((manifest, compiled_context, budget, generation_context))
}

fn candidate_generation_context(
    connection: &rusqlite::Connection,
    run_id: &str,
    tool_name: &str,
    is_error: bool,
) -> Result<Option<Value>, AppError> {
    if is_error || !CANDIDATE_TOOLS.split(',').any(|tool| tool == tool_name) {
        return Ok(None);
    }
    let (_, _, _, generation_context) = build_context_evidence(connection, run_id)?;
    Ok(Some(generation_context))
}

fn provider_options_from_model_snapshot(model_snapshot: &Value) -> Value {
    const INFERENCE_OPTION_FIELDS: &[&str] = &[
        "temperature",
        "topP",
        "topK",
        "repeatPenalty",
        "maxTokens",
        "responseFormat",
        "seed",
        "stop",
        "frequencyPenalty",
        "presencePenalty",
        "reasoningEffort",
        "thinkingMode",
    ];

    let mut provider_options = serde_json::Map::new();
    if let Some(provider_id) = model_snapshot.get("providerId") {
        provider_options.insert("providerId".to_string(), provider_id.clone());
    }
    if let Some(model_id) = model_snapshot.get("modelId") {
        provider_options.insert("model".to_string(), model_id.clone());
    }
    if let Some(options) = model_snapshot.get("options").and_then(Value::as_object) {
        for key in INFERENCE_OPTION_FIELDS {
            if let Some(value) = options.get(*key) {
                provider_options.insert((*key).to_string(), value.clone());
            }
        }
    }
    Value::Object(provider_options)
}

fn provider_response_metadata(
    model_snapshot: &Value,
    provider_request_id: &str,
    response_hash: &str,
    response_length: usize,
    prompt_tokens: u64,
    completion_tokens: u64,
) -> Value {
    json!({
        "provider": model_snapshot
            .get("providerId")
            .and_then(Value::as_str)
            .unwrap_or("dsh"),
        "model": model_snapshot
            .get("modelId")
            .and_then(Value::as_str)
            .unwrap_or("unknown"),
        "providerRequestId": provider_request_id,
        "responseHash": response_hash,
        "responseLength": response_length,
        "tokenInput": prompt_tokens,
        "tokenOutput": completion_tokens,
        "tokenTotal": prompt_tokens.saturating_add(completion_tokens),
        "finishReason": "tool_result",
        "durationMs": 0
    })
}

fn create_artifact_projection(
    connection: &mut rusqlite::Connection,
    input: &StartTaskTurnInput,
    run_id: &str,
    generated: &GeneratedChapterResult,
    prompt_tokens: u64,
    completion_tokens: u64,
) -> Result<Option<String>, AppError> {
    let artifact_type = generated
        .structured
        .get("artifactType")
        .and_then(Value::as_str)
        .unwrap_or("chapter_text");
    let chapter_id = input.chapter_id.as_deref();
    let base = if let Some(chapter_id) = chapter_id {
        read_chapter_base_snapshot(connection, &input.novel_id, chapter_id)?
    } else {
        ChapterBaseSnapshot {
            chapter_revision: now(),
            draft_id: None,
            draft_version: None,
            content_hash: None,
        }
    };
    let operation_id = format!("workbench-{}", run_id);
    let prompt_body = "你是 AI Novel Studio 的小说任务执行 Agent。只生成候选，不写入正式事实。";
    let body = serde_json::to_string(&json!({"messages":[{"role":"user","content":input.goal}]}))
        .map_err(|error| AppError::new("TASK_RUNTIME_JSON", error.to_string(), false))?;
    let (context_manifest, compiled_context, context_budget, _generation_context) =
        build_context_evidence(connection, run_id)?;
    let create = CreateAiTaskInput {
        operation_id,
        request_hash_version: None,
        request_hash: None,
        trace_id: None,
        task_type: match artifact_type {
            "outline" => "outline_generate",
            "character_candidates" => "character_generate",
            "event_candidates" => "event_suggest",
            "setting_candidates" => "setting_expand",
            "quality_report" => "quality_check",
            "chapter_summary" => "chapter_summary",
            _ => "chapter_generate",
        }
        .to_string(),
        novel_id: input.novel_id.clone(),
        chapter_id: chapter_id.map(str::to_string),
        draft_id: base.draft_id.clone(),
        scope_type: if base.draft_id.is_some() {
            "draft"
        } else if chapter_id.is_some() {
            "chapter"
        } else {
            "novel"
        }
        .to_string(),
        expected_artifact_type: artifact_type.to_string(),
        expected_artifact_schema_version: 1,
        target_hint_json: Some(json!({
            "conversationId": input.conversation_id,
            "turnId": input.turn_id,
            "runId": run_id,
            "modelSnapshot": input.model_snapshot,
            "baseChapterRevision":base.chapter_revision,
            "baseDraftId":base.draft_id,
            "baseDraftVersion":base.draft_version,
            "baseContentHash":base.content_hash
        })),
        input_snapshot: ai_task_service::InputSnapshotInput {
            schema_version: 1,
            input_type: "workbench_dsh_messages_v1".to_string(),
            payload_json: json!({"goal": input.goal, "conversationId": input.conversation_id}),
            body,
            source_draft_id: base.draft_id.clone(),
            source_draft_version: base.draft_version,
            base_content_hash: base.content_hash.clone(),
        },
        context_snapshot: ai_task_service::ContextSnapshotInput {
            schema_version: 1,
            source_manifest_json: context_manifest,
            compiled_context,
            budget_json: context_budget,
            compiler_version: "workbench_dsh_context_evidence_v1".to_string(),
        },
        constraint_snapshot: ai_task_service::ConstraintSnapshotInput {
            schema_version: 1,
            payload_json: json!({"candidateOnly":true,"mayWriteBusinessData":false}),
            prompt_template_id: format!("workbench/{artifact_type}"),
            prompt_template_version: "1".to_string(),
            prompt_template_hash: large_text_repository::sha256(prompt_body),
            prompt_template_body: prompt_body.to_string(),
            provider_options_json: provider_options_from_model_snapshot(&input.model_snapshot),
        },
    };
    let task = ai_task_service::create_dsh_projected_task(
        connection,
        create,
        run_id,
        &input.turn_id,
        &input.conversation_id,
    )?;
    let queued = ai_task_service::queue_attempt(connection, &task.task_id)?;
    let attempt = ai_task_service::claim_attempt(
        connection,
        ClaimAiTaskAttemptInput {
            task_id: task.task_id.clone(),
            attempt_id: queued.attempt.attempt_id.clone(),
            provider_id: input
                .model_snapshot
                .get("providerId")
                .and_then(Value::as_str)
                .unwrap_or("dsh")
                .to_string(),
            model_id: input
                .model_snapshot
                .get("modelId")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string(),
            provider_request_id: Some(generated.provider_request_id.clone()),
        },
    )?;
    let response_hash = large_text_repository::sha256(&generated.text);
    ai_task_service::mark_provider_succeeded(
        connection,
        &task.task_id,
        &attempt.attempt.attempt_id,
        provider_response_metadata(
            &input.model_snapshot,
            &generated.provider_request_id,
            &response_hash,
            generated.text.chars().count(),
            prompt_tokens,
            completion_tokens,
        ),
    )?;
    let artifact = artifact_service::create_artifact(
        connection,
        artifact_service::CreateResultArtifactInput {
            task_id: task.task_id,
            attempt_id: attempt.attempt.attempt_id,
            artifact_type: artifact_type.to_string(),
            schema_version: 1,
            raw_content: generated.text.clone(),
            display_content: None,
            structured_payload_json: Some(generated.structured.clone()),
            parent_artifact_id: None,
            derivation_type: None,
        },
    )?;
    let warning_count = artifact
        .issues
        .iter()
        .filter(|issue| issue.severity == "warning")
        .count();
    let error_count = artifact
        .issues
        .iter()
        .filter(|issue| issue.severity == "error")
        .count();
    let summary = artifact_projection_summary(
        &artifact.artifact.processing_status,
        warning_count,
        error_count,
    )?;
    let card = conversation_service::create_artifact_card(
        connection,
        CreateArtifactCardInput {
            card_id: uuid::Uuid::new_v4().to_string(),
            conversation_id: input.conversation_id.clone(),
            turn_id: Some(input.turn_id.clone()),
            run_id: Some(run_id.to_string()),
            artifact_id: Some(artifact.artifact.artifact_id.clone()),
            artifact_type: artifact_type.to_string(),
            title: match artifact_type {
                "outline" => "大纲候选",
                "character_candidates" => "角色候选",
                "event_candidates" => "事件候选",
                "setting_candidates" => "设定候选",
                "quality_report" => "质量报告",
                "chapter_summary" => "章节总结候选",
                _ => "章节候选",
            }
            .to_string(),
            summary: summary.to_string(),
            content: None,
            status: "candidate".to_string(),
            created_at: now(),
        },
    )?;
    Ok(card.artifact_id)
}

fn worker_root() -> PathBuf {
    let root = std::env::var("ANS_TASK_WORKER_ROOT")
        .ok()
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| crate::db::get_data_dir().join("dsh-task-workers"));
    node_compatible_path(&root)
}

fn worker_directory(conversation_id: &str) -> PathBuf {
    let digest = large_text_repository::sha256(conversation_id);
    worker_root().join(&digest[..32])
}

fn provider_transport(input: &StartTaskTurnInput) -> Result<ProviderTransport, String> {
    let route = selected_model_route(input)?;
    let upstream_key = if input.api_key.trim().is_empty() {
        if input
            .model_snapshot
            .get("baseUrl")
            .and_then(Value::as_str)
            .is_some()
        {
            "local-no-key-required".to_string()
        } else {
            return Err("DSH 任务需要 Provider API Key；不会静默降级到前端流水线".to_string());
        }
    } else {
        input.api_key.clone()
    };
    let identity = serde_json::to_string(&json!({
        "upstream":route.base_url,
        "logicalProvider":route.logical_provider,
        "harnessProvider":route.harness_provider,
        "model":route.model,
        "credentialHash":large_text_repository::sha256(&upstream_key),
        "policy":input.request_policy,
        "pricing":input.model_snapshot.get("pricing"),
        "taskScope": {
            "novelId": input.novel_id,
            "chapterId": input.chapter_id,
        },
        "candidatePolicy": candidate_validation_policy(input),
        "sourceCommit":DSH_SOURCE_COMMIT,
        "protocol":DSH_PROTOCOL
    }))
    .map_err(|error| error.to_string())?;
    Ok(ProviderTransport {
        route,
        upstream_key,
        identity_hash: large_text_repository::sha256(&identity),
    })
}

fn exact_model_identity(value: &str, field: &str, max_len: usize) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed != value
        || trimmed.len() > max_len
        || trimmed.chars().any(char::is_control)
    {
        return Err(format!("冻结模型快照的 {} 无效", field));
    }
    Ok(trimmed.to_string())
}

fn selected_model_route(input: &StartTaskTurnInput) -> Result<SelectedModelRoute, String> {
    if input
        .model_snapshot
        .get("runtimeMode")
        .and_then(Value::as_str)
        != Some("api")
    {
        return Err("冻结模型快照 runtimeMode 必须是 api".to_string());
    }
    let logical_provider = exact_model_identity(
        input
            .model_snapshot
            .get("providerId")
            .and_then(Value::as_str)
            .ok_or_else(|| "冻结模型快照缺少精确 providerId".to_string())?,
        "providerId",
        128,
    )?;
    let logical_provider = if logical_provider == "deepseek" {
        DEEPSEEK_HARNESS_PROVIDER.to_string()
    } else {
        logical_provider
    };
    let model = exact_model_identity(
        input
            .model_snapshot
            .get("modelId")
            .and_then(Value::as_str)
            .ok_or_else(|| "冻结模型快照缺少精确 modelId".to_string())?,
        "modelId",
        256,
    )?;
    let adapter_protocol = match input
        .model_snapshot
        .pointer("/runtime/adapterProtocol")
        .and_then(Value::as_str)
    {
        Some(value) => exact_model_identity(value, "adapterProtocol", 128)?,
        None => DSH_PROTOCOL.to_string(),
    };
    if adapter_protocol != DSH_PROTOCOL {
        return Err(format!(
            "冻结模型快照的 Harness adapterProtocol 不可用: {}",
            adapter_protocol
        ));
    }
    let adapter_provider = match input
        .model_snapshot
        .pointer("/runtime/adapterProvider")
        .and_then(Value::as_str)
    {
        Some(value) => {
            let value = exact_model_identity(value, "adapterProvider", 128)?;
            if value == "deepseek" {
                DEEPSEEK_HARNESS_PROVIDER.to_string()
            } else {
                value
            }
        }
        None => logical_provider.clone(),
    };
    if logical_provider != adapter_provider {
        return Err(format!(
            "冻结模型快照 providerId 与 Harness adapterProvider 不一致: {} != {}",
            logical_provider, adapter_provider
        ));
    }
    let harness_provider = match logical_provider.as_str() {
        DEEPSEEK_HARNESS_PROVIDER | OPENAI_COMPATIBLE_PROVIDER => {
            DEEPSEEK_HARNESS_PROVIDER.to_string()
        }
        _ => {
            return Err(format!(
                "冻结模型快照的 Harness adapterProvider 不可用: {}",
                logical_provider
            ))
        }
    };
    let configured_base_url = match input.model_snapshot.get("baseUrl") {
        Some(Value::String(value)) => Some(value.trim()).filter(|value| !value.is_empty()),
        Some(_) => return Err("冻结模型快照 baseUrl 必须是字符串".to_string()),
        None => None,
    };
    let base_url = match configured_base_url {
        Some(value) => normalize_model_base_url(value)?,
        None if logical_provider == DEEPSEEK_HARNESS_PROVIDER => {
            std::env::var("DSH_PROXY_UPSTREAM")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .map(|value| normalize_model_base_url(&value))
                .transpose()?
                .unwrap_or_else(|| "https://api.deepseek.com".to_string())
        }
        None => return Err("冻结模型快照缺少 OpenAI-compatible baseUrl".to_string()),
    };
    Ok(SelectedModelRoute {
        logical_provider,
        harness_provider,
        model,
        base_url,
    })
}

fn workbench_reasoning_effort(input: &StartTaskTurnInput) -> &str {
    input
        .model_snapshot
        .pointer("/options/reasoningEffort")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("off")
}

fn spawn_worker_process(
    input: &StartTaskTurnInput,
    descriptor: &RuntimeDescriptor,
    worker_id: &str,
    identity_hash: String,
    model_route: &SelectedModelRoute,
    upstream_key: &str,
    projection: Arc<Mutex<Option<ProjectionTarget>>>,
) -> Result<Arc<WorkerProcess>, String> {
    let root = descriptor
        .runtime_root
        .clone()
        .ok_or_else(|| "DSH runtime root missing".to_string())?;
    let runtime_bin = NodeDshRuntime::runtime_bin(&root)?;
    let gateway_bin = super::commands::resolve_gateway_bin()?;
    let work = worker_directory(&input.conversation_id);
    std::fs::create_dir_all(&work).map_err(|error| error.to_string())?;
    let db_path = node_compatible_path(&super::commands::gateway_database_path())
        .to_string_lossy()
        .to_string();
    let server_path = work.join("ans-task-server.mjs");
    std::fs::write(
        &server_path,
        task_server_script(&root, DSH_SOURCE_COMMIT, DSH_PROTOCOL),
    )
    .map_err(|error| error.to_string())?;
    let cordis_path = work.join("cordis.yml");
    std::fs::write(
        &cordis_path,
        task_cordis_yml(&root, &gateway_bin, &db_path, &server_path),
    )
    .map_err(|error| error.to_string())?;

    let pricing = input.model_snapshot.get("pricing");
    let owner_hash = large_text_repository::sha256(&input.conversation_id);
    let transport_instance_id = uuid::Uuid::new_v4().simple().to_string();
    let policy_guard = start_policy_server(GovernedProxyPolicy {
        owner_id: format!("dsh-workbench:{}", &owner_hash[..32]),
        max_requests_per_minute: input.request_policy.max_requests_per_minute,
        max_concurrent_requests: input.request_policy.max_concurrent_requests,
        daily_token_budget: input.request_policy.daily_token_budget,
        daily_cost_budget_usd: input.request_policy.daily_cost_budget_usd,
        input_price_per_million_tokens: pricing
            .and_then(|value| value.get("inputPricePerMillionTokens"))
            .and_then(Value::as_f64),
        output_price_per_million_tokens: pricing
            .and_then(|value| value.get("outputPricePerMillionTokens"))
            .and_then(Value::as_f64),
        warning_percent: input.request_policy.warning_percent,
        ttl_ms: (input.request_policy.timeout_seconds.max(1) * 1_000 + 60_000)
            .clamp(60_000, 2 * 60 * 60_000),
    })?;
    let (proxy_guard, base_url) = spawn_governed_proxy(
        &work,
        upstream_key,
        &model_route.base_url,
        &model_route.model,
        &policy_guard.url(),
        &format!("dsh:{}:{}", &owner_hash[..32], transport_instance_id),
        input.request_policy.timeout_seconds.max(1) * 1_000,
    )?;
    let config = DshLaunchConfig {
        runtime_bin: PathBuf::from(runtime_bin),
        cordis_config: cordis_path,
        session_root: work.join("sessions"),
        home: work.join("home"),
        api_key: "local-proxy".to_string(),
        base_url,
        system_prompt: WORKBENCH_SYSTEM_PROMPT.to_string(),
        cwd: work,
        allowed_tools: Some(ALLOWED_TOOLS.to_string()),
        task_novel_id: Some(input.novel_id.clone()),
        task_chapter_id: input.chapter_id.clone(),
        candidate_policy: candidate_validation_policy(input),
    };
    let child = NodeDshRuntime
        .launch(&config)
        .map_err(|error| format!("DSH Worker {} 启动失败: {}", worker_id, error))?;
    let observer: SessionEventObserver = {
        let conversation_id = input.conversation_id.clone();
        Arc::new(move |notification| {
            let target = projection
                .lock()
                .map_err(|_| "DSH 事件投影锁失败".to_string())?
                .clone();
            let Some(target) = target else {
                return Ok(());
            };
            project_session_event(
                notification,
                &target.session_id,
                &conversation_id,
                &target.run_id,
                &target.turn_error,
                target.notifier.as_ref(),
                &target.request_identity,
            )
        })
    };
    let runtime = Arc::new(
        RuntimeHandle::new_with_observer(child, Some(observer))
            .map_err(|error| error.to_string())?,
    );
    Ok(Arc::new(WorkerProcess {
        runtime,
        identity_hash,
        model_route: model_route.clone(),
        _proxy_guard: proxy_guard,
        _policy_guard: policy_guard,
    }))
}

fn ensure_worker_process(
    input: &StartTaskTurnInput,
    worker_id: &str,
    process_holder: &Arc<Mutex<Option<Arc<WorkerProcess>>>>,
    projection: Arc<Mutex<Option<ProjectionTarget>>>,
) -> Result<Arc<WorkerProcess>, String> {
    let descriptor = describe_runtime();
    if !carrier_files_ready(&descriptor.status) {
        return Err(descriptor
            .error
            .unwrap_or_else(|| "DSH 运行时不可用".to_string()));
    }
    let transport = provider_transport(input)?;
    let mut holder = process_holder
        .lock()
        .map_err(|_| "Worker 进程锁失败".to_string())?;
    if let Some(existing) = holder.as_ref() {
        let healthy = existing.identity_hash == transport.identity_hash
            && existing
                .runtime
                .request("runtime/health", None, Duration::from_secs(3))
                .ok()
                .and_then(|health| health.get("sourceCommit").cloned())
                .and_then(|value| value.as_str().map(str::to_string))
                .as_deref()
                == Some(DSH_SOURCE_COMMIT);
        if healthy {
            return Ok(existing.clone());
        }
        if let Some(previous) = holder.take() {
            let _ = previous.runtime.shutdown_and_wait(Duration::from_secs(10));
        }
    }
    let process = spawn_worker_process(
        input,
        &descriptor,
        worker_id,
        transport.identity_hash,
        &transport.route,
        &transport.upstream_key,
        projection,
    )?;
    *holder = Some(process.clone());
    Ok(process)
}

fn ensure_runtime_initialized(
    input: &StartTaskTurnInput,
    runtime: &RuntimeHandle,
) -> Result<(), String> {
    let route = selected_model_route(input)?;
    let max_tokens = input
        .model_snapshot
        .pointer("/options/maxTokens")
        .and_then(Value::as_u64)
        .unwrap_or(8000);
    let current_health = match runtime.request("runtime/health", None, Duration::from_secs(5)) {
        Ok(health) => Some(health),
        Err(error) if error.is_frame_channel_disconnected() => {
            return Err(safe_supervisor_error(
                runtime,
                "runtime/health 失败",
                &error,
            ));
        }
        Err(_) => None,
    };
    let already_ready = current_health.as_ref().is_some_and(|health| {
        health.get("ready").and_then(Value::as_bool) == Some(true)
            && health.get("sourceCommit").and_then(Value::as_str) == Some(DSH_SOURCE_COMMIT)
            && health.pointer("/route/provider").and_then(Value::as_str)
                == Some(route.harness_provider.as_str())
            && health.pointer("/route/model").and_then(Value::as_str) == Some(route.model.as_str())
    });
    if already_ready {
        return Ok(());
    }
    runtime
        .request(
            "initialize",
            Some(json!({
                "cwd":worker_directory(&input.conversation_id).to_string_lossy().replace('\\',"/"),
                "provider":route.harness_provider,
                "model":route.model,
                "maxTokens":max_tokens,
                "sourceCommit":DSH_SOURCE_COMMIT,
                "protocol":DSH_PROTOCOL
            })),
            Duration::from_secs(30),
        )
        .map_err(|error| safe_supervisor_error(runtime, "initialize 失败", &error))?;
    let health = runtime
        .request("runtime/health", None, Duration::from_secs(30))
        .map_err(|error| safe_supervisor_error(runtime, "runtime/health 失败", &error))?;
    if health.get("ready").and_then(Value::as_bool) != Some(true)
        || health.get("sourceCommit").and_then(Value::as_str) != Some(DSH_SOURCE_COMMIT)
        || health.pointer("/route/provider").and_then(Value::as_str)
            != Some(route.harness_provider.as_str())
        || health.pointer("/route/model").and_then(Value::as_str) != Some(route.model.as_str())
    {
        return Err("DSH Runtime 初始化、固定载体或精确模型路由健康校验失败".to_string());
    }
    Ok(())
}

pub(super) fn validate_model_tool_attestation(
    value: Value,
    expected_provider: &str,
    expected_model: &str,
) -> Result<ModelToolAttestation, String> {
    let attestation = serde_json::from_value::<ModelToolAttestation>(value)
        .map_err(|_| "MODEL_TOOL_CALLING_NOT_VERIFIED: INVALID_ATTESTATION_EVIDENCE".to_string())?;
    if attestation.protocol != MODEL_TOOL_ATTESTATION_PROTOCOL
        || attestation.provider != expected_provider
        || attestation.model != expected_model
    {
        return Err("MODEL_TOOL_CALLING_NOT_VERIFIED: ATTESTATION_IDENTITY_MISMATCH".to_string());
    }
    if !attestation.verified {
        let reason = attestation
            .failure_code
            .as_deref()
            .unwrap_or("PROBE_DID_NOT_VERIFY");
        let provider_reason = attestation
            .provider_failure_code
            .as_deref()
            .map(|value| format!(" ({})", value))
            .unwrap_or_default();
        return Err(format!(
            "MODEL_TOOL_CALLING_NOT_VERIFIED: {}{}",
            reason, provider_reason
        ));
    }
    let verified_at = attestation
        .verified_at
        .as_deref()
        .filter(|value| !value.is_empty())
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc));
    let expires_at = attestation
        .expires_at
        .as_deref()
        .filter(|value| !value.is_empty())
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc));
    let exact_live_window =
        verified_at
            .as_ref()
            .zip(expires_at.as_ref())
            .is_some_and(|(verified_at, expires_at)| {
                expires_at
                    .signed_duration_since(verified_at)
                    .num_milliseconds()
                    == MODEL_TOOL_ATTESTATION_TTL_MS
                    && *verified_at <= Utc::now() + chrono::Duration::seconds(5)
                    && *expires_at > Utc::now()
            });
    if verified_at.is_none()
        || expires_at.is_none()
        || !exact_live_window
        || attestation.cache_ttl_ms != Some(MODEL_TOOL_ATTESTATION_TTL_MS)
        || attestation.finish_kind.as_deref() != Some("tool-calls")
        || attestation.observed_tool_calls != Some(1)
        || attestation.failure_code.is_some()
        || attestation.provider_failure_code.is_some()
    {
        return Err("MODEL_TOOL_CALLING_NOT_VERIFIED: INVALID_POSITIVE_EVIDENCE".to_string());
    }
    Ok(attestation)
}

fn model_snapshot_with_tool_attestation(
    snapshot: &Value,
    attestation: &ModelToolAttestation,
) -> Result<Value, String> {
    let mut frozen = snapshot.clone();
    let snapshot_object = frozen
        .as_object_mut()
        .ok_or_else(|| "modelSnapshot 必须是对象".to_string())?;
    let runtime = snapshot_object
        .get_mut("runtime")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "modelSnapshot.runtime 必须是对象".to_string())?;
    runtime.insert(
        "toolCallingAttestation".to_string(),
        json!({
            "protocol": attestation.protocol,
            "provider": attestation.provider,
            "model": attestation.model,
            "verified": true,
            "cached": attestation.cached,
            "verifiedAt": attestation.verified_at,
            "expiresAt": attestation.expires_at,
            "cacheTtlMs": attestation.cache_ttl_ms,
            "finishKind": attestation.finish_kind,
            "observedToolCalls": attestation.observed_tool_calls,
        }),
    );
    Ok(frozen)
}

fn preflight_model_tool_attestation(
    input: &StartTaskTurnInput,
    worker_id: &str,
    process_holder: &Arc<Mutex<Option<Arc<WorkerProcess>>>>,
    projection: Arc<Mutex<Option<ProjectionTarget>>>,
    cancel: &AtomicBool,
) -> Result<(Arc<WorkerProcess>, ModelToolAttestation), String> {
    if cancel.load(Ordering::SeqCst) {
        return Err("MODEL_TOOL_ATTESTATION_CANCELLED".to_string());
    }
    let process = ensure_worker_process(input, worker_id, process_holder, projection)?;
    if cancel.load(Ordering::SeqCst) {
        process.runtime.kill();
        return Err("MODEL_TOOL_ATTESTATION_CANCELLED".to_string());
    }
    ensure_runtime_initialized(input, &process.runtime).map_err(|error| {
        if cancel.load(Ordering::SeqCst) {
            "MODEL_TOOL_ATTESTATION_CANCELLED".to_string()
        } else {
            error
        }
    })?;
    if cancel.load(Ordering::SeqCst) {
        process.runtime.kill();
        return Err("MODEL_TOOL_ATTESTATION_CANCELLED".to_string());
    }
    let route = selected_model_route(input)?;
    let evidence = process
        .runtime
        .request(
            MODEL_TOOL_ATTESTATION_METHOD,
            Some(json!({
                "provider": route.harness_provider,
                "model": route.model,
                "nonce": uuid::Uuid::new_v4().simple().to_string(),
            })),
            Duration::from_secs(40),
        )
        .map_err(|error| {
            if cancel.load(Ordering::SeqCst) {
                "MODEL_TOOL_ATTESTATION_CANCELLED".to_string()
            } else if error.is_frame_channel_disconnected() {
                safe_supervisor_error(
                    &process.runtime,
                    "MODEL_TOOL_ATTESTATION_TRANSPORT_FAILED",
                    &error,
                )
            } else {
                "MODEL_TOOL_CALLING_NOT_VERIFIED: PROBE_TRANSPORT_FAILED".to_string()
            }
        })?;
    if cancel.load(Ordering::SeqCst) {
        return Err("MODEL_TOOL_ATTESTATION_CANCELLED".to_string());
    }
    let mut attestation =
        validate_model_tool_attestation(evidence, &route.harness_provider, &route.model).map_err(
            |error| {
                process
                    ._proxy_guard
                    .last_policy_error_code()
                    .map(|policy_code| format!("{} [{}]", error, policy_code))
                    .unwrap_or(error)
            },
        )?;
    attestation.provider = route.logical_provider;
    Ok((process, attestation))
}

fn execute(
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
    });
    ensure_runtime_initialized(&input, &runtime)?;
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
                "contentBlocks":[{"type":"text","text":workbench_turn_prompt_for_attempt(
                    &input,
                    protocol_recovery_retry,
                )}],
                "route":{
                    "provider":route.harness_provider,
                    "model":route.model,
                    "maxTokens":max_tokens,
                    "reasoningEffort":workbench_reasoning_effort(&input)
                }
            })),
            Duration::from_secs(30),
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
        .wait_idle_checked_with_cancel(&session_id, Duration::from_secs(480), Some(&cancel))
        .map_err(|error| safe_supervisor_error(&runtime, "DSH 回合失败", &error))?;
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
    let candidate_event_id = validate_turn_execution_contract(&connection, &input, &run_id)
        .map_err(|error| error.to_string())?;
    let generated =
        read_generated_chapter_result(&connection, &input, &run_id, candidate_event_id.as_deref())
            .map_err(|error| error.to_string())?;
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

pub fn start(input: StartTaskTurnInput) -> Result<TaskRuntimeResult, String> {
    start_with_observer(input, None)
}

pub fn start_with_observer(
    mut input: StartTaskTurnInput,
    notifier: Option<TaskProjectionObserver>,
) -> Result<TaskRuntimeResult, String> {
    required(&input.conversation_id, "conversationId")?;
    required(&input.novel_id, "novelId")?;
    required(&input.turn_id, "turnId")?;
    required(&input.goal, "goal")?;
    if !input.model_snapshot.is_object()
        || crate::services::ai_fact_security::contains_secret_value(&input.model_snapshot)
    {
        return Err("modelSnapshot 无效或包含凭据字段".to_string());
    }
    selected_model_route(&input)?;
    let (authoritative_goal, book_word_goal) = {
        let connection = crate::db::get_connection()
            .lock()
            .map_err(|_| "数据库锁失败".to_string())?;
        let authoritative_goal = conversation_service::validate_task_runtime_scope(
            &connection,
            &input.conversation_id,
            &input.turn_id,
            &input.novel_id,
            input.chapter_id.as_deref(),
        )
        .map_err(|error| error.to_string())?;
        let book_word_goal = if input.task_kind == "story_plan_generate" {
            ai_task_service::authoritative_book_word_goal(&connection, &input.conversation_id)
                .map_err(|error| error.to_string())?
        } else {
            None
        };
        (authoritative_goal, book_word_goal)
    };
    input.goal = authoritative_goal;
    input.book_word_goal = book_word_goal;
    validate_turn_contract(&input)?;
    let summary_session_scope = if input.task_kind == "chapter_summary" {
        let connection = crate::db::get_connection()
            .lock()
            .map_err(|_| "数据库锁失败".to_string())?;
        Some(chapter_summary_recovery_scope(&connection, &input)?)
    } else {
        None
    };
    let mut run_id = uuid::Uuid::new_v4().to_string();
    let identity = large_text_repository::sha256(&input.conversation_id);
    let stable_worker_id = format!("worker-{}", &identity[..32]);
    let initial_session_id = task_session_id(&input, &run_id, summary_session_scope.as_ref());
    let cancel = Arc::new(AtomicBool::new(false));
    let (worker_id, process, projection) = {
        let mut workers = active()
            .lock()
            .map_err(|_| "Worker 状态锁失败".to_string())?;
        if let Some(worker) = workers.get_mut(&input.conversation_id) {
            if matches!(
                worker.status.as_str(),
                "attesting" | "running" | "cancel_requested"
            ) {
                return Err("当前任务已有活动运行".to_string());
            }
            worker.run_id = run_id.clone();
            worker.cancel = cancel.clone();
            worker.status = "attesting".to_string();
            worker.error = None;
            worker.notifier = notifier.clone();
            worker.session_id = initial_session_id.clone();
            (
                worker.worker_id.clone(),
                worker.process.clone(),
                worker.projection.clone(),
            )
        } else {
            let process = Arc::new(Mutex::new(None));
            let projection = Arc::new(Mutex::new(None));
            workers.insert(
                input.conversation_id.clone(),
                ActiveWorker {
                    run_id: run_id.clone(),
                    session_id: initial_session_id.clone(),
                    worker_id: stable_worker_id.clone(),
                    cancel: cancel.clone(),
                    process: process.clone(),
                    projection: projection.clone(),
                    notifier: notifier.clone(),
                    status: "attesting".to_string(),
                    error: None,
                },
            );
            (stable_worker_id, process, projection)
        }
    };
    let (attested_process, model_tool_attestation) = match preflight_model_tool_attestation(
        &input,
        &worker_id,
        &process,
        projection.clone(),
        &cancel,
    ) {
        Ok(evidence) => evidence,
        Err(raw_error) => {
            let error = safe_runtime_error(&raw_error);
            update_active(&input.conversation_id, "idle", Some(error.clone()));
            return Err(error);
        }
    };
    input.model_snapshot = match model_snapshot_with_tool_attestation(
        &input.model_snapshot,
        &model_tool_attestation,
    ) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            update_active(&input.conversation_id, "idle", Some(error.clone()));
            return Err(error);
        }
    };
    let mut protocol_recovery_retry = 0usize;
    loop {
        let run_session_id = task_session_id(&input, &run_id, summary_session_scope.as_ref());
        let run_created = (|| {
            let mut workers = active()
                .lock()
                .map_err(|_| "Worker 状态锁失败".to_string())?;
            let worker = workers
                .get_mut(&input.conversation_id)
                .ok_or_else(|| "当前任务没有活动运行".to_string())?;
            if cancel.load(Ordering::SeqCst) || worker.status == "cancel_requested" {
                worker.status = "idle".to_string();
                worker.error = Some("MODEL_TOOL_ATTESTATION_CANCELLED".to_string());
                return Err("MODEL_TOOL_ATTESTATION_CANCELLED".to_string());
            }
            worker.run_id = run_id.clone();
            worker.session_id = run_session_id.clone();
            worker.error = None;
            let mut connection = crate::db::get_connection()
                .lock()
                .map_err(|_| "数据库锁失败".to_string())?;
            conversation_service::create_run(
                &mut connection,
                CreateRunInput {
                    run_id: run_id.clone(),
                    conversation_id: input.conversation_id.clone(),
                    turn_id: input.turn_id.clone(),
                    model_snapshot: input.model_snapshot.clone(),
                    worker_id: worker_id.clone(),
                    created_at: now(),
                },
            )
            .map_err(|error| error.to_string())?;
            conversation_service::update_run(
                &mut connection,
                UpdateRunInput {
                    run_id: run_id.clone(),
                    status: "running".to_string(),
                    error: None,
                    updated_at: now(),
                    started_at: Some(now()),
                    finished_at: None,
                },
            )
            .map_err(|error| error.to_string())?;
            worker.status = "running".to_string();
            Ok::<(), String>(())
        })();
        if let Err(error) = run_created {
            update_active(&input.conversation_id, "idle", Some(error.clone()));
            return Err(error);
        }
        notify_projection(notifier.as_ref(), &input.conversation_id, &run_id, "run")?;
        let result = execute(
            input.clone(),
            run_id.clone(),
            worker_id.clone(),
            run_session_id,
            attested_process.clone(),
            projection.clone(),
            cancel.clone(),
            notifier.clone(),
            model_tool_attestation.clone(),
            protocol_recovery_retry,
        );
        let raw_error = match result {
            Ok(outcome) => {
                update_active(&input.conversation_id, "idle", None);
                return Ok(outcome);
            }
            Err(raw_error) => raw_error,
        };
        let error = runtime_error_for_persistence(&raw_error);
        let cancelled = active()
            .lock()
            .ok()
            .and_then(|workers| {
                workers
                    .get(&input.conversation_id)
                    .map(|worker| worker.cancel.load(Ordering::SeqCst))
            })
            .unwrap_or(false);
        let process_healthy = process
            .lock()
            .ok()
            .and_then(|holder| holder.as_ref().cloned())
            .is_some_and(|process| {
                process
                    .runtime
                    .request("runtime/health", None, Duration::from_secs(3))
                    .is_ok()
            });
        let recovery_candidate = !cancelled
            && process_healthy
            && is_automatic_protocol_recovery_candidate(&input, &raw_error);
        let terminal_status = if cancelled { "cancelled" } else { "failed" };
        let mut next_protocol_recovery_retry = None;
        if let Ok(mut connection) = crate::db::get_connection().lock() {
            let finished_at = now();
            let tools_terminalized = conversation_service::terminalize_open_tool_events(
                &mut connection,
                &run_id,
                if cancelled { "cancelled" } else { "failed" },
                if cancelled {
                    "DSH Worker 已取消，工具调用未完成。"
                } else {
                    "DSH Worker 故障，工具调用未完成。"
                },
                &finished_at,
            )
            .is_ok();
            let run_terminalized = conversation_service::update_run(
                &mut connection,
                UpdateRunInput {
                    run_id: run_id.clone(),
                    status: terminal_status.to_string(),
                    error: Some(error.clone()),
                    updated_at: finished_at.clone(),
                    started_at: None,
                    finished_at: Some(finished_at.clone()),
                },
            )
            .is_ok();
            if recovery_candidate && tools_terminalized && run_terminalized {
                next_protocol_recovery_retry =
                    automatic_protocol_recovery_retry_number(&connection, &input, &raw_error)
                        .ok()
                        .flatten();
            }
            let failure_turn_id = stable_projection_id(
                "dsh-message",
                &run_id,
                if cancelled {
                    "assistant:cancelled"
                } else {
                    "assistant:failed"
                },
            );
            let failure_message = if cancelled {
                "任务已取消。".to_string()
            } else if let Some(retry_number) = next_protocol_recovery_retry {
                format!(
                    "任务运行失败：{}。检测到可恢复的自动总结运行错误，正在使用同一回合与冻结模型自动重试（{}/{}）。",
                    error,
                    retry_number,
                    MAX_AUTOMATIC_PROTOCOL_RECOVERY_RETRIES
                )
            } else {
                format!("任务运行失败：{}", error)
            };
            let _ = conversation_service::append_runtime_assistant_turn(
                &mut connection,
                &failure_turn_id,
                &input.conversation_id,
                &run_id,
                &failure_message,
                &finished_at,
            );
        }
        let _ = notify_projection(
            notifier.as_ref(),
            &input.conversation_id,
            &run_id,
            "terminal",
        );
        if let Ok(mut target) = projection.lock() {
            *target = None;
        }
        if !process_healthy {
            if let Ok(mut holder) = process.lock() {
                if let Some(dead) = holder.take() {
                    dead.runtime.kill();
                }
            }
        }
        if let Some(retry_number) = next_protocol_recovery_retry {
            protocol_recovery_retry = retry_number;
            run_id = uuid::Uuid::new_v4().to_string();
            continue;
        }
        update_active(&input.conversation_id, "idle", Some(error.clone()));
        return Err(error);
    }
}

pub fn cancel(conversation_id: &str) -> Result<TaskRuntimeStatus, String> {
    let mut workers = active()
        .lock()
        .map_err(|_| "Worker 状态锁失败".to_string())?;
    let worker = workers
        .get_mut(conversation_id)
        .ok_or_else(|| "当前任务没有活动运行".to_string())?;
    if !matches!(worker.status.as_str(), "attesting" | "running") {
        return Err("当前任务没有活动运行".to_string());
    }
    let attesting = worker.status == "attesting";
    worker.cancel.store(true, Ordering::SeqCst);
    let run_id = worker.run_id.clone();
    let session_id = worker.session_id.clone();
    let worker_id = worker.worker_id.clone();
    let notifier = worker.notifier.clone();
    let process = worker.process.clone();
    worker.status = "cancel_requested".to_string();
    drop(workers);
    if attesting {
        if let Ok(mut holder) = process.lock() {
            if let Some(process) = holder.take() {
                process.runtime.kill();
            }
        }
        return Ok(TaskRuntimeStatus {
            conversation_id: conversation_id.to_string(),
            run_id,
            session_id,
            worker_id,
            status: "cancel_requested".to_string(),
            runtime: "dsh-headless-persistent".to_string(),
            error: None,
        });
    }
    if let Ok(mut connection) = crate::db::get_connection().lock() {
        let _ = conversation_service::update_run(
            &mut connection,
            UpdateRunInput {
                run_id: run_id.clone(),
                status: "cancel_requested".to_string(),
                error: None,
                updated_at: now(),
                started_at: None,
                finished_at: None,
            },
        );
    }
    notify_projection(notifier.as_ref(), conversation_id, &run_id, "run")?;
    Ok(TaskRuntimeStatus {
        conversation_id: conversation_id.to_string(),
        run_id,
        session_id,
        worker_id,
        status: "cancel_requested".to_string(),
        runtime: "dsh-headless-persistent".to_string(),
        error: None,
    })
}

pub fn status(conversation_id: &str) -> Option<TaskRuntimeStatus> {
    active()
        .lock()
        .ok()?
        .get(conversation_id)
        .map(|worker| TaskRuntimeStatus {
            conversation_id: conversation_id.to_string(),
            run_id: worker.run_id.clone(),
            session_id: worker.session_id.clone(),
            worker_id: worker.worker_id.clone(),
            status: worker.status.clone(),
            runtime: "dsh-headless-persistent".to_string(),
            error: worker.error.clone(),
        })
}

pub fn list_statuses() -> Vec<TaskRuntimeStatus> {
    active()
        .lock()
        .ok()
        .map(|workers| {
            workers
                .iter()
                .map(|(conversation_id, worker)| TaskRuntimeStatus {
                    conversation_id: conversation_id.clone(),
                    run_id: worker.run_id.clone(),
                    session_id: worker.session_id.clone(),
                    worker_id: worker.worker_id.clone(),
                    status: worker.status.clone(),
                    runtime: "dsh-headless-persistent".to_string(),
                    error: worker.error.clone(),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn runtime_status_owns_active_run(status: &str) -> bool {
    matches!(
        status,
        "attesting" | "queued" | "running" | "cancel_requested"
    )
}

/// Runs startup reconciliation while holding the process-authoritative worker
/// registry. A renderer reload keeps this registry alive, while a full process
/// restart starts with it empty. Holding the guard through the callback also
/// prevents a new DSH run from being inserted between the liveness snapshot
/// and the SQLite recovery transaction.
pub fn with_active_runtime_run_ids<T>(
    operation: impl FnOnce(&HashSet<String>) -> T,
) -> Result<T, String> {
    let workers = active()
        .lock()
        .map_err(|_| "Worker 状态锁失败".to_string())?;
    let protected_run_ids = workers
        .values()
        .filter(|worker| {
            runtime_status_owns_active_run(&worker.status) && !worker.run_id.trim().is_empty()
        })
        .map(|worker| worker.run_id.clone())
        .collect::<HashSet<_>>();
    Ok(operation(&protected_run_ids))
}

#[cfg(test)]
mod workbench_prompt_tests {
    use super::*;

    fn api_input(provider: &str, model: &str, base_url: &str) -> StartTaskTurnInput {
        StartTaskTurnInput {
            conversation_id: "c1".to_string(),
            novel_id: "n1".to_string(),
            turn_id: "t1".to_string(),
            goal: "test".to_string(),
            chapter_id: Some("ch-1".to_string()),
            task_kind: default_task_kind(),
            expected_tool: None,
            expected_artifact_type: None,
            required_read_tools: Vec::new(),
            book_word_goal: None,
            model_snapshot: json!({
                "providerId": provider,
                "modelId": model,
                "runtimeMode": "api",
                "baseUrl": base_url,
                "options": { "maxTokens": 1024 },
                "runtime": {
                    "adapterProtocol": DSH_PROTOCOL,
                    "adapterProvider": provider
                }
            }),
            request_policy: TaskRequestPolicyInput {
                max_requests_per_minute: 1,
                max_concurrent_requests: 1,
                daily_token_budget: None,
                daily_cost_budget_usd: None,
                warning_percent: 80,
                timeout_seconds: 30,
            },
            api_key: "fixture-key".to_string(),
        }
    }

    #[test]
    fn startup_recovery_protects_only_process_owned_active_runtime_states() {
        for status in ["attesting", "queued", "running", "cancel_requested"] {
            assert!(
                runtime_status_owns_active_run(status),
                "{status} must protect its persisted run during a renderer reload"
            );
        }
        for status in ["idle", "completed", "failed", "cancelled", ""] {
            assert!(
                !runtime_status_owns_active_run(status),
                "{status} must not survive full-process startup recovery"
            );
        }
    }

    fn sparse_sixty_thousand_word_goal(source_hash: char) -> ai_task_service::BookWordGoal {
        ai_task_service::BookWordGoal {
            contract_version: "ans_book_word_goal_v1".to_string(),
            parser_version: "zh_book_words_v1".to_string(),
            source_turn_id: "turn-sparse-idea".to_string(),
            source_turn_sequence: 1,
            source_content_sha256: source_hash.to_string().repeat(64),
            target_words: 60_000,
            comparison: "approximate".to_string(),
            tolerance_bps: 1_000,
            minimum_words: 54_000,
            maximum_words: 66_000,
        }
    }

    #[test]
    fn client_payload_cannot_inject_the_host_owned_book_word_goal() {
        let input: StartTaskTurnInput = serde_json::from_value(json!({
            "conversationId": "conversation-client",
            "novelId": "novel-client",
            "turnId": "turn-client",
            "goal": "写个六万字左右的悬疑故事。",
            "chapterId": null,
            "taskKind": "story_plan_generate",
            "expectedTool": "generate_outline",
            "expectedArtifactType": "outline",
            "requiredReadTools": ["novel.read_context"],
            "bookWordGoal": {
                "targetWords": 1,
                "minimumWords": 1,
                "maximumWords": 1,
                "sourceContentSha256": "malicious-client-value"
            },
            "modelSnapshot": {
                "providerId": OPENAI_COMPATIBLE_PROVIDER,
                "modelId": "gpt-5.6-luna",
                "runtimeMode": "api",
                "baseUrl": "http://127.0.0.1:12074/v1/"
            },
            "requestPolicy": {
                "maxRequestsPerMinute": 1,
                "maxConcurrentRequests": 1,
                "warningPercent": 80,
                "timeoutSeconds": 30
            },
            "apiKey": "fixture-key"
        }))
        .expect("valid client payload");

        assert_eq!(input.book_word_goal, None);
        assert_eq!(candidate_validation_policy(&input), None);
    }

    fn chapter_summary_input() -> StartTaskTurnInput {
        let mut input = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1/",
        );
        input.conversation_id = "conversation-summary".to_string();
        input.novel_id = "novel-summary".to_string();
        input.turn_id = "summary-generation-authorization-summary".to_string();
        input.chapter_id = Some("chapter-summary".to_string());
        input.goal = "总结本章".to_string();
        input.task_kind = "chapter_summary".to_string();
        input.expected_tool = Some("summarize_chapter".to_string());
        input.expected_artifact_type = Some("chapter_summary".to_string());
        input.required_read_tools = vec![
            "novel.read_context".to_string(),
            "chapter.read_outline".to_string(),
            "get_character_states".to_string(),
            "search_memory".to_string(),
        ];
        input
    }

    fn chapter_summary_recovery_connection() -> rusqlite::Connection {
        let connection = rusqlite::Connection::open_in_memory().expect("recovery database");
        connection
            .execute_batch(
                r#"CREATE TABLE task_runs (
                    run_id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    turn_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    error TEXT,
                    model_snapshot_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE review_authorizations (
                    authorization_id TEXT PRIMARY KEY,
                    novel_id TEXT NOT NULL,
                    chapter_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    consumed_by_draft_id TEXT
                );
                CREATE TABLE chapters (
                    id TEXT PRIMARY KEY,
                    novel_id TEXT NOT NULL,
                    adopted_draft_id TEXT,
                    deleted_at TEXT
                );
                CREATE TABLE result_artifacts (
                    artifact_id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    artifact_type TEXT NOT NULL,
                    processing_status TEXT NOT NULL,
                    source_novel_id TEXT NOT NULL,
                    source_chapter_id TEXT,
                    source_draft_id TEXT
                );
                CREATE TABLE conversation_artifact_cards (
                    card_id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    turn_id TEXT,
                    artifact_id TEXT,
                    artifact_type TEXT NOT NULL
                );
                CREATE TABLE ai_tasks (
                    task_id TEXT PRIMARY KEY,
                    operation_id TEXT NOT NULL
                );
                CREATE TABLE chapter_summaries (
                    id TEXT PRIMARY KEY,
                    novel_id TEXT NOT NULL,
                    chapter_id TEXT NOT NULL,
                    adopted_draft_id TEXT NOT NULL,
                    enabled INTEGER NOT NULL,
                    is_expired INTEGER NOT NULL
                );
                INSERT INTO review_authorizations VALUES
                    ('authorization-summary','novel-summary','chapter-summary','consumed','draft-summary');
                INSERT INTO chapters VALUES
                    ('chapter-summary','novel-summary','draft-summary',NULL);"#,
            )
            .expect("seed recovery scope");
        connection
    }

    #[test]
    fn automatic_summary_sessions_rotate_without_changing_ordinary_task_sessions() {
        let input = chapter_summary_input();
        let connection = chapter_summary_recovery_connection();
        let scope = chapter_summary_recovery_scope(&connection, &input)
            .expect("authoritative adopted summary scope");
        let first = task_session_id(&input, "run-summary-1", Some(&scope));
        let same = task_session_id(&input, "run-summary-1", Some(&scope));
        let retry = task_session_id(&input, "run-summary-2", Some(&scope));

        assert_eq!(first, same);
        assert_ne!(first, retry, "a recovery Run must start with clean history");
        assert!(first.starts_with("session-summary-"));
        assert!(first
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-'));

        let mut changed_scope = ChapterSummaryRecoveryScope {
            novel_id: scope.novel_id.clone(),
            chapter_id: scope.chapter_id.clone(),
            adopted_draft_id: "different-adopted-draft".to_string(),
        };
        assert_ne!(
            first,
            task_session_id(&input, "run-summary-1", Some(&changed_scope))
        );
        changed_scope.adopted_draft_id = scope.adopted_draft_id.clone();
        changed_scope.chapter_id = "different-chapter".to_string();
        assert_ne!(
            first,
            task_session_id(&input, "run-summary-1", Some(&changed_scope))
        );

        let mut ordinary = input.clone();
        ordinary.task_kind = "read".to_string();
        ordinary.expected_tool = None;
        ordinary.expected_artifact_type = None;
        assert_eq!(
            task_session_id(&ordinary, "run-ordinary-1", None),
            task_session_id(&ordinary, "run-ordinary-2", None),
            "ordinary task dialogue remains conversation-persistent"
        );
    }

    fn insert_recoverable_summary_failure(
        connection: &rusqlite::Connection,
        input: &StartTaskTurnInput,
        attempt: usize,
    ) {
        connection
            .execute(
                "INSERT INTO task_runs
                 (run_id,conversation_id,turn_id,status,error,model_snapshot_json,created_at)
                 VALUES (?1,?2,?3,'failed',?4,?5,?6)",
                rusqlite::params![
                    format!("run-{attempt}"),
                    &input.conversation_id,
                    &input.turn_id,
                    "DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states must be earlier",
                    serde_json::to_string(&input.model_snapshot).expect("model snapshot"),
                    format!("2026-08-29T00:00:0{attempt}Z"),
                ],
            )
            .expect("insert failed summary run");
    }

    fn verified_attestation_stream_closed_error() -> String {
        concat!(
            "DSH 回合以错误结束: STREAM_CLOSED | ",
            "[model-proxy] request model=gpt-5.6-luna stream=true promptChars=808 ",
            "messages=2 tools=1 invalidToolNames=0 thinking=disabled effort=unspecified | ",
            "[model-proxy] responseStats status=200 payloads=24 choices=24 contentChars=0 ",
            "reasoningChars=0 alternateReasoningChars=0 toolCallParts=23 ",
            "legacyFunctionCallParts=0 toolNames=ans_runtime_attest_tool_call_v1 ",
            "messageKeys=role,tool_calls finish=tool_calls done=true | ",
            "[model-proxy] done model=gpt-5.6-luna status=200 ms=1812 ",
            "usage={\"tokenInput\":42} | ",
            "dsh.turn.end: STREAM_CLOSED"
        )
        .to_string()
    }

    #[test]
    fn workbench_turn_defaults_reasoning_off_and_keeps_an_explicit_effort() {
        let mut input = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1",
        );
        assert_eq!(workbench_reasoning_effort(&input), "off");

        input.model_snapshot["options"]["reasoningEffort"] = json!("high");
        assert_eq!(workbench_reasoning_effort(&input), "high");
    }

    #[test]
    fn sparse_setting_bundle_requires_world_and_rule_entries() {
        let mut input = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1/",
        );
        input.task_kind = "setting_expand".to_string();
        input.goal = format!(
            "{}。创意依据：近未来悬疑。",
            WORLD_AND_RULE_SETTINGS_DIRECTIVE
        );
        assert!(workbench_task_instruction(&input).contains("targetType=rule_system"));
        assert!(!WORKBENCH_SYSTEM_PROMPT.contains(WORLD_AND_RULE_SETTINGS_DIRECTIVE));
        let valid = json!({
            "settings": [
                {"name":"雾港背景","description":"潮雾会吞没旧城区的声音。","category":"location"},
                {"name":"退潮钟规则","description":"钟响后记忆不可篡改。","targetType":"rule_system"}
            ]
        })
        .to_string();
        validate_world_and_rule_settings_candidate(&valid).expect("complete setting bundle");

        let world_only = json!({
            "settings": [
                {"name":"雾港背景","description":"潮雾会吞没旧城区的声音。","category":"location"}
            ]
        })
        .to_string();
        assert!(validate_world_and_rule_settings_candidate(&world_only).is_err());

        let rules_only = json!({
            "settings": [
                {"name":"退潮钟规则","description":"钟响后记忆不可篡改。","category":"world_rules"}
            ]
        })
        .to_string();
        assert!(validate_world_and_rule_settings_candidate(&rules_only).is_err());

        let empty_descriptions = json!({
            "settings": [
                {"name":"雾港背景","description":"  ","category":"location"},
                {"name":"退潮钟规则","description":"","targetType":"rule_system"}
            ]
        })
        .to_string();
        assert!(validate_world_and_rule_settings_candidate(&empty_descriptions).is_err());
    }

    #[test]
    fn rule_only_asset_preparation_rejects_world_candidates() {
        let mut input = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1/",
        );
        input.task_kind = "setting_expand".to_string();
        input.goal = format!("{}。创意依据：近未来悬疑。", RULE_SYSTEM_SETTINGS_DIRECTIVE);
        let instruction = workbench_task_instruction(&input);
        assert!(instruction.contains("只能包含 targetType=rule_system"));

        let rules_only = json!({
            "settings": [
                {
                    "name":"退潮钟规则",
                    "description":"钟响后记忆不可篡改。",
                    "targetType":"rule_system"
                }
            ]
        })
        .to_string();
        validate_rule_system_settings_candidate(&rules_only).expect("rule-only candidate");

        let world_candidate = json!({
            "settings": [
                {"name":"雾港背景","description":"潮雾会吞没旧城区的声音。"}
            ]
        })
        .to_string();
        assert!(validate_rule_system_settings_candidate(&world_candidate).is_err());
    }

    #[test]
    fn automatic_protagonist_candidate_requires_exactly_one_primary_role() {
        let mut input = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1/",
        );
        input.task_kind = "character_generate".to_string();
        input.goal = format!(
            "{}。创意依据：近未来悬疑。",
            PROTAGONIST_CANDIDATE_DIRECTIVE
        );
        let instruction = workbench_task_instruction(&input);
        assert!(instruction.contains("roleType=protagonist"));
        for formal_field in [
            "motivation",
            "specialAbility",
            "abilityLimits",
            "background",
            "arc",
        ] {
            assert!(instruction.contains(formal_field));
        }
        assert!(instruction.contains("behaviorLimits 只表示行为边界"));
        assert!(!WORKBENCH_SYSTEM_PROMPT.contains(PROTAGONIST_CANDIDATE_DIRECTIVE));
        let valid = json!({
            "characters": [
                {
                    "name":"林默",
                    "roleType":"protagonist",
                    "identity":"钟楼修复师",
                    "goal":"找回失窃的时间",
                    "personality":"审慎而执着",
                    "behaviorLimits":"不会用他人的记忆交换线索"
                },
                {"name":"季衡","roleType":"supporting","goal":"守住钟楼"}
            ]
        })
        .to_string();
        validate_primary_protagonist_candidate(&valid).expect("one primary protagonist");

        let shallow = json!({
            "characters": [
                {"name":"林默","roleType":"protagonist","goal":"找回失窃的时间"}
            ]
        })
        .to_string();
        assert!(validate_primary_protagonist_candidate(&shallow).is_err());

        let supporting_only = json!({
            "characters": [{"name":"季衡","roleType":"supporting"}]
        })
        .to_string();
        assert!(validate_primary_protagonist_candidate(&supporting_only).is_err());

        let multiple = json!({
            "characters": [
                {"name":"林默","roleType":"protagonist"},
                {"name":"沈夜","isProtagonist":true}
            ]
        })
        .to_string();
        assert!(validate_primary_protagonist_candidate(&multiple).is_err());
    }

    #[test]
    fn greeting_turn_prompt_forbids_empty_generate_chapter() {
        let input = StartTaskTurnInput {
            conversation_id: "c1".to_string(),
            novel_id: "n1".to_string(),
            turn_id: "t1".to_string(),
            goal: "你好".to_string(),
            chapter_id: Some("ch-1".to_string()),
            task_kind: default_task_kind(),
            expected_tool: None,
            expected_artifact_type: None,
            required_read_tools: Vec::new(),
            book_word_goal: None,
            model_snapshot: json!({}),
            request_policy: TaskRequestPolicyInput {
                max_requests_per_minute: 1,
                max_concurrent_requests: 1,
                daily_token_budget: None,
                daily_cost_budget_usd: None,
                warning_percent: 80,
                timeout_seconds: 30,
            },
            api_key: String::new(),
        };
        let prompt = workbench_turn_prompt(&input);
        assert!(prompt.contains("用户意图：你好"));
        assert!(prompt.contains("本轮禁止候选工具"));
        assert!(prompt.contains("本轮不得调用候选工具"));
        assert!(!prompt.contains("generate_chapter"));
        assert!(!prompt.contains("请按需使用工具并形成候选"));
        assert!(WORKBENCH_SYSTEM_PROMPT.contains("简短创作意图"));
        assert!(WORKBENCH_SYSTEM_PROMPT.contains("每轮宿主契约"));
        assert!(WORKBENCH_SYSTEM_PROMPT.chars().count() < 260);
        for tool in CANDIDATE_TOOLS.split(',') {
            assert!(!WORKBENCH_SYSTEM_PROMPT.contains(tool));
        }
    }

    #[test]
    fn short_structured_turn_requires_persisted_context_before_candidate() {
        let mut input = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1/",
        );
        input.goal = "完善大纲".to_string();
        input.task_kind = "outline_generate".to_string();
        input.expected_tool = Some("generate_outline".to_string());
        input.expected_artifact_type = Some("outline".to_string());
        input.required_read_tools = vec![
            "novel.read_context".to_string(),
            "chapter.read_outline".to_string(),
        ];
        validate_turn_contract(&input).expect("valid outline contract");

        let prompt = workbench_turn_prompt(&input);
        assert!(prompt.contains("用户意图：完善大纲"));
        assert!(prompt.contains("必需读取：novel.read_context -> chapter.read_outline"));
        assert!(prompt.contains("全部必需读取成功后"));
        assert!(prompt.contains("成功后用一句话确认完成并结束"));
        assert!(prompt.contains("禁止返回空消息"));
        assert!(prompt.contains("唯一候选工具：generate_outline"));
        assert!(prompt.contains("至少包含非空 title 与 content"));
        assert!(!prompt.contains("search_memory"));
        assert!(!prompt.contains("planKind=story_plan"));
        assert!(WORKBENCH_SYSTEM_PROMPT.contains("用指定的只读工具补足已有资产"));
        assert!(WORKBENCH_SYSTEM_PROMPT.contains("不要求用户重复提供内容或填写 JSON"));
    }

    #[test]
    fn short_story_plan_goal_gets_only_its_turn_schema() {
        let mut input = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1/",
        );
        input.chapter_id = None;
        input.goal = "生成全书规划候选。创意依据：写一部约6万字的近未来悬疑小说。".to_string();
        input.task_kind = "story_plan_generate".to_string();
        input.expected_tool = Some("generate_outline".to_string());
        input.expected_artifact_type = Some("outline".to_string());
        input.required_read_tools = vec!["novel.read_context".to_string()];
        input.book_word_goal = Some(sparse_sixty_thousand_word_goal('a'));
        validate_turn_contract(&input).expect("valid story plan contract");

        let prompt = workbench_turn_prompt(&input);
        assert!(prompt.contains(&format!("用户意图：{}", input.goal)));
        assert!(prompt.contains("planKind=story_plan"));
        assert!(prompt.contains("targetWordCount"));
        assert!(prompt.contains("mainConflict"));
        assert!(prompt.contains("characterNames"));
        assert!(prompt.contains("没有角色线索时省略"));
        assert!(prompt.contains("未给章节数时"));
        assert!(prompt.contains("冻结全书目标 60000 字"));
        assert!(prompt.contains("根 targetWordCount=60000"));
        assert!(prompt.contains("校正末章"));
        assert!(prompt.contains("章节合计=60000"));
        assert!(prompt.contains("均须在 54000 至 66000 字"));
        assert!(prompt.contains("不加说明或 Markdown"));
        assert!(prompt.contains("不传 chapterId"));
        assert!(!prompt.contains("settings:["));
        assert!(!prompt.contains("characters:["));
        assert!(!WORKBENCH_SYSTEM_PROMPT.contains("planKind"));
        assert!(!WORKBENCH_SYSTEM_PROMPT.contains("targetWordCount"));
        assert!(!WORKBENCH_SYSTEM_PROMPT.contains("61500"));
        assert!(!WORKBENCH_SYSTEM_PROMPT.contains("4100"));
        assert!(prompt.chars().count() < 700);
    }

    #[test]
    fn task_prompts_expose_only_the_current_candidate_tool_and_schema() {
        let cases = [
            (
                "outline_generate",
                Some("generate_outline"),
                Some("outline"),
                "完善本章大纲",
                Some("ch-1"),
                vec!["novel.read_context", "chapter.read_outline"],
                "至少包含非空 title 与 content",
            ),
            (
                "setting_expand",
                Some("expand_settings"),
                Some("setting_candidates"),
                "扩展城市设定",
                Some("ch-1"),
                vec!["novel.read_context", "chapter.read_outline"],
                "{settings:[...]}",
            ),
            (
                "character_generate",
                Some("generate_characters"),
                Some("character_candidates"),
                "补充角色",
                Some("ch-1"),
                vec!["novel.read_context", "chapter.read_outline"],
                "{characters:[...]}",
            ),
            (
                "event_suggest",
                Some("suggest_events"),
                Some("event_candidates"),
                "建议本章事件",
                Some("ch-1"),
                vec![
                    "novel.read_context",
                    "chapter.read_outline",
                    "get_character_states",
                    "search_memory",
                ],
                "events 数组",
            ),
            (
                "quality_check",
                Some("check_quality"),
                Some("quality_report"),
                "检查本章质量",
                Some("ch-1"),
                vec![
                    "novel.read_context",
                    "chapter.read_outline",
                    "get_character_states",
                    "search_memory",
                ],
                "summary 或 issues 数组",
            ),
            (
                "chapter_summary",
                Some("summarize_chapter"),
                Some("chapter_summary"),
                "总结本章",
                Some("ch-1"),
                vec![
                    "novel.read_context",
                    "chapter.read_outline",
                    "get_character_states",
                    "search_memory",
                ],
                "factsMustRemember",
            ),
            (
                "read",
                None,
                None,
                "你好",
                Some("ch-1"),
                vec![],
                "本轮禁止候选工具",
            ),
        ];
        let schema_markers = [
            "至少包含非空 title 与 content",
            "{settings:[...]}",
            "{characters:[...]}",
            "events 数组",
            "summary 或 issues 数组",
            "factsMustRemember",
        ];

        for (task_kind, expected_tool, artifact_type, goal, chapter_id, reads, marker) in cases {
            let mut input = api_input(
                OPENAI_COMPATIBLE_PROVIDER,
                "gpt-5.6-luna",
                "http://127.0.0.1:12074/v1/",
            );
            input.task_kind = task_kind.to_string();
            input.expected_tool = expected_tool.map(str::to_string);
            input.expected_artifact_type = artifact_type.map(str::to_string);
            input.goal = goal.to_string();
            input.chapter_id = chapter_id.map(str::to_string);
            input.required_read_tools = reads.into_iter().map(str::to_string).collect();
            validate_turn_contract(&input).expect("valid task-specific contract");

            let prompt = workbench_turn_prompt(&input);
            for tool in CANDIDATE_TOOLS.split(',') {
                assert_eq!(
                    prompt.contains(tool),
                    expected_tool == Some(tool),
                    "{task_kind} leaked candidate tool {tool}: {prompt}"
                );
            }
            for schema_marker in schema_markers {
                assert_eq!(
                    prompt.contains(schema_marker),
                    schema_marker == marker,
                    "{task_kind} leaked schema marker {schema_marker}: {prompt}"
                );
            }
            assert!(prompt.chars().count() < 700, "oversized {task_kind} prompt");
        }
    }

    #[test]
    fn automatic_asset_prompts_add_only_their_special_constraint() {
        let mut settings = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1/",
        );
        settings.task_kind = "setting_expand".to_string();
        settings.expected_tool = Some("expand_settings".to_string());
        settings.expected_artifact_type = Some("setting_candidates".to_string());
        settings.required_read_tools = vec!["novel.read_context".to_string()];
        settings.goal = "扩展世界设定".to_string();
        assert!(!workbench_turn_prompt(&settings).contains("targetType=rule_system"));
        settings.goal = "生成世界与规则设定候选。创意依据：近未来悬疑。".to_string();
        assert!(workbench_turn_prompt(&settings).contains("targetType=rule_system"));
        settings.goal = "生成规则设定候选。创意依据：近未来悬疑。".to_string();
        assert!(workbench_turn_prompt(&settings).contains("只能包含 targetType=rule_system"));

        let mut characters = settings;
        characters.task_kind = "character_generate".to_string();
        characters.expected_tool = Some("generate_characters".to_string());
        characters.expected_artifact_type = Some("character_candidates".to_string());
        characters.goal = "补充配角".to_string();
        assert!(!workbench_turn_prompt(&characters).contains("恰好包含一个"));
        characters.goal = "生成主角候选。创意依据：近未来悬疑。".to_string();
        assert!(workbench_turn_prompt(&characters).contains("恰好包含一个 roleType=protagonist"));
    }

    #[test]
    fn automatic_candidate_policy_changes_worker_identity_and_remains_host_owned() {
        let mut input = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1/",
        );
        input.task_kind = "character_generate".to_string();
        input.expected_tool = Some("generate_characters".to_string());
        input.expected_artifact_type = Some("character_candidates".to_string());
        input.goal = "补充配角".to_string();

        assert_eq!(candidate_validation_policy(&input), None);
        let ordinary_identity = provider_transport(&input)
            .expect("ordinary character transport")
            .identity_hash;

        input.goal = "生成主角候选。创意依据：近未来悬疑。".to_string();
        assert_eq!(
            candidate_validation_policy(&input),
            Some("primary_protagonist_v1".to_string())
        );
        let automatic_identity = provider_transport(&input)
            .expect("automatic protagonist transport")
            .identity_hash;
        assert_ne!(ordinary_identity, automatic_identity);

        input.task_kind = "setting_expand".to_string();
        input.expected_tool = Some("expand_settings".to_string());
        input.expected_artifact_type = Some("setting_candidates".to_string());
        input.goal = "生成世界与规则设定候选。创意依据：近未来悬疑。".to_string();
        assert_eq!(
            candidate_validation_policy(&input),
            Some("world_rule_bundle_v1".to_string())
        );
        input.goal = "生成规则设定候选。创意依据：近未来悬疑。".to_string();
        assert_eq!(
            candidate_validation_policy(&input),
            Some("rule_system_only_v1".to_string())
        );

        input.task_kind = "story_plan_generate".to_string();
        input.expected_tool = Some("generate_outline".to_string());
        input.expected_artifact_type = Some("outline".to_string());
        input.chapter_id = None;
        input.book_word_goal = Some(sparse_sixty_thousand_word_goal('a'));
        assert_eq!(
            candidate_validation_policy(&input),
            Some(format!(
                "book_word_goal_v1:60000:54000:66000:{}",
                "a".repeat(64)
            ))
        );
        let first_word_goal_identity = provider_transport(&input)
            .expect("first word goal transport")
            .identity_hash;
        input.book_word_goal = Some(sparse_sixty_thousand_word_goal('b'));
        let changed_source_identity = provider_transport(&input)
            .expect("changed word goal source transport")
            .identity_hash;
        assert_ne!(first_word_goal_identity, changed_source_identity);
    }

    #[test]
    fn chapter_summary_recovery_is_exact_allowlisted_and_summary_only() {
        let mut input = chapter_summary_input();
        assert!(is_automatic_protocol_recovery_candidate(
            &input,
            "DSH_REQUIRED_CONTEXT_READ_MISSING"
        ));
        assert!(is_automatic_protocol_recovery_candidate(
            &input,
            "DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states"
        ));
        assert!(is_automatic_protocol_recovery_candidate(
            &input,
            "DSH_REQUIRED_CANDIDATE_TOOL_MISSING: summarize_chapter"
        ));
        let stream_closed = verified_attestation_stream_closed_error();
        assert!(is_automatic_protocol_recovery_candidate(
            &input,
            &stream_closed
        ));
        assert_eq!(
            runtime_error_for_persistence(&stream_closed),
            AUTOMATIC_SUMMARY_STREAM_CLOSED_PERSISTED_ERROR
        );
        for error in [
            "DSH_REQUIRED_CONTEXT_READ_MISSING_EXTRA: get_character_states",
            "DSH_REQUIRED_CANDIDATE_TOOL_MISSING_EXTRA: summarize_chapter",
            "prefix DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states",
            "DSH_TOOL_RESPONSE_METADATA_INVALID: missing step",
            "DSH 回合以错误结束: STREAM_CLOSED",
            AUTOMATIC_SUMMARY_STREAM_CLOSED_PERSISTED_ERROR,
        ] {
            assert!(!is_automatic_protocol_recovery_candidate(&input, error));
        }

        for (from, to) in [
            ("responseStats status=200", "responseStats status=500"),
            (
                "toolNames=ans_runtime_attest_tool_call_v1",
                "toolNames=summarize_chapter",
            ),
            ("finish=tool_calls", "finish=stop"),
            ("done=true", "done=false"),
            ("status=200 ms=1812", "status=500 ms=1812"),
        ] {
            let invalid = stream_closed.replacen(from, to, 1);
            assert!(
                !is_automatic_protocol_recovery_candidate(&input, &invalid),
                "mutated probe evidence must fail closed: {from}"
            );
        }
        let prefixed = format!("prefix {stream_closed}");
        assert!(!is_automatic_protocol_recovery_candidate(&input, &prefixed));
        let missing_turn_end = stream_closed
            .strip_suffix(" | dsh.turn.end: STREAM_CLOSED")
            .expect("fixture turn/end suffix");
        assert!(!is_automatic_protocol_recovery_candidate(
            &input,
            missing_turn_end
        ));
        let altered_turn_end = stream_closed.replace(
            "dsh.turn.end: STREAM_CLOSED",
            "dsh.turn.end: STREAM_COMPLETED",
        );
        assert!(!is_automatic_protocol_recovery_candidate(
            &input,
            &altered_turn_end
        ));
        let extra_tail = format!("{stream_closed} | unexpected-tail");
        assert!(!is_automatic_protocol_recovery_candidate(
            &input,
            &extra_tail
        ));
        let later_request = format!(
            "{stream_closed} | [model-proxy] request model=gpt-5.6-luna stream=true tools=8"
        );
        assert!(!is_automatic_protocol_recovery_candidate(
            &input,
            &later_request
        ));
        let post_probe_request = format!(
            "{stream_closed}{} | [model-proxy] request model=gpt-5.6-luna stream=true tools=8",
            "x".repeat(600)
        );
        let truncated = runtime_error_for_persistence(&post_probe_request);
        assert_ne!(truncated, AUTOMATIC_SUMMARY_STREAM_CLOSED_PERSISTED_ERROR);
        assert!(persisted_automatic_protocol_recovery_error_code(&truncated).is_none());

        input.task_kind = "quality_check".to_string();
        input.expected_tool = Some("check_quality".to_string());
        input.expected_artifact_type = Some("quality_report".to_string());
        assert!(!is_automatic_protocol_recovery_candidate(
            &input,
            "DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states"
        ));
        assert!(!is_automatic_protocol_recovery_candidate(
            &input,
            &stream_closed
        ));
    }

    #[test]
    fn chapter_summary_recovery_prompt_repeats_reads_in_a_later_step() {
        let input = chapter_summary_input();
        let ordinary = workbench_turn_prompt_for_attempt(&input, 0);
        assert!(!ordinary.contains("协议自动恢复"));
        assert!(ordinary.contains(
            "必需读取：novel.read_context -> chapter.read_outline -> get_character_states -> search_memory"
        ));
        assert!(ordinary.contains("第一阶段在同一模型响应中并行调用全部必需读取"));
        assert!(ordinary.contains("第二阶段必须调用唯一候选工具"));

        let recovery = workbench_turn_prompt_for_attempt(&input, 1);
        assert!(recovery.contains("第 1/2 次有限重试"));
        assert!(recovery.contains("上一 Run 已保留为失败事实"));
        assert!(recovery.contains("没有创建候选 Artifact"));
        assert!(recovery.contains("重新调用本轮全部必需读取工具"));
        assert!(recovery.contains("等待全部 Tool Result 返回后"));
        assert!(recovery.contains("第二阶段只调用且必须调用唯一候选工具"));
    }

    #[test]
    fn chapter_summary_missing_candidate_recovery_is_persisted_and_bounded() {
        let input = chapter_summary_input();
        let connection = chapter_summary_recovery_connection();
        connection
            .execute(
                "INSERT INTO task_runs
                 (run_id,conversation_id,turn_id,status,error,model_snapshot_json,created_at)
                 VALUES ('run-missing',?1,?2,'failed',?3,?4,'2026-08-29T00:00:01Z')",
                rusqlite::params![
                    &input.conversation_id,
                    &input.turn_id,
                    "DSH_REQUIRED_CANDIDATE_TOOL_MISSING: summarize_chapter",
                    serde_json::to_string(&input.model_snapshot).expect("model snapshot"),
                ],
            )
            .expect("insert missing candidate summary run");

        assert_eq!(
            automatic_protocol_recovery_retry_number(
                &connection,
                &input,
                "DSH_REQUIRED_CANDIDATE_TOOL_MISSING: summarize_chapter",
            )
            .expect("missing candidate is recoverable"),
            Some(1)
        );
    }

    #[test]
    fn chapter_summary_recovery_budget_is_persisted_and_bounded() {
        let input = chapter_summary_input();
        let connection = chapter_summary_recovery_connection();
        let error = "DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states";

        insert_recoverable_summary_failure(&connection, &input, 1);
        assert_eq!(
            automatic_protocol_recovery_retry_number(&connection, &input, error)
                .expect("first persisted retry"),
            Some(1)
        );
        insert_recoverable_summary_failure(&connection, &input, 2);
        assert_eq!(
            automatic_protocol_recovery_retry_number(&connection, &input, error)
                .expect("second persisted retry"),
            Some(2)
        );
        insert_recoverable_summary_failure(&connection, &input, 3);
        assert_eq!(
            automatic_protocol_recovery_retry_number(&connection, &input, error)
                .expect("retry budget exhausted"),
            None
        );
    }

    #[test]
    fn chapter_summary_verified_attestation_stream_closed_recovery_is_persisted_and_bounded() {
        let input = chapter_summary_input();
        let connection = chapter_summary_recovery_connection();
        let raw_error = verified_attestation_stream_closed_error();

        for attempt in 1..=3 {
            connection
                .execute(
                    "INSERT INTO task_runs
                     (run_id,conversation_id,turn_id,status,error,model_snapshot_json,created_at)
                     VALUES (?1,?2,?3,'failed',?4,?5,?6)",
                    rusqlite::params![
                        format!("run-stream-closed-{attempt}"),
                        &input.conversation_id,
                        &input.turn_id,
                        AUTOMATIC_SUMMARY_STREAM_CLOSED_PERSISTED_ERROR,
                        serde_json::to_string(&input.model_snapshot).expect("model snapshot"),
                        format!("2026-08-29T00:01:0{attempt}Z"),
                    ],
                )
                .expect("insert verified stream-closed summary run");
            let expected = (attempt <= MAX_AUTOMATIC_PROTOCOL_RECOVERY_RETRIES).then_some(attempt);
            assert_eq!(
                automatic_protocol_recovery_retry_number(&connection, &input, &raw_error)
                    .expect("verified stream-closed retry decision"),
                expected
            );
            if attempt == 1 {
                let mut model_drift = input.clone();
                model_drift.model_snapshot["modelId"] = json!("different-model");
                assert_eq!(
                    automatic_protocol_recovery_retry_number(
                        &connection,
                        &model_drift,
                        &raw_error,
                    )
                    .expect("model drift must fail closed"),
                    None
                );

                let mut turn_drift = input.clone();
                turn_drift.turn_id = "summary-generation-different-authorization".to_string();
                assert_eq!(
                    automatic_protocol_recovery_retry_number(&connection, &turn_drift, &raw_error,)
                        .expect("turn drift must fail closed"),
                    None
                );

                let mut chapter_drift = input.clone();
                chapter_drift.chapter_id = Some("different-chapter".to_string());
                assert_eq!(
                    automatic_protocol_recovery_retry_number(
                        &connection,
                        &chapter_drift,
                        &raw_error,
                    )
                    .expect_err("chapter drift must fail closed"),
                    "DSH_PROTOCOL_RECOVERY_SCOPE_INVALID"
                );
            }
        }
    }

    #[test]
    fn chapter_summary_recovery_stops_for_an_existing_valid_artifact() {
        let input = chapter_summary_input();
        let connection = chapter_summary_recovery_connection();
        insert_recoverable_summary_failure(&connection, &input, 1);
        connection
            .execute_batch(
                r#"INSERT INTO result_artifacts VALUES
                    ('artifact-summary','task-summary','chapter_summary','valid',
                     'novel-summary','chapter-summary','draft-summary');
                   INSERT INTO conversation_artifact_cards VALUES
                    ('card-summary','conversation-summary',
                     'summary-generation-authorization-summary','artifact-summary','chapter_summary');"#,
            )
            .expect("seed valid summary artifact card");

        assert_eq!(
            automatic_protocol_recovery_retry_number(
                &connection,
                &input,
                "DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states",
            )
            .expect("valid artifact blocks recovery"),
            None
        );

        let artifact_only_connection = chapter_summary_recovery_connection();
        insert_recoverable_summary_failure(&artifact_only_connection, &input, 1);
        artifact_only_connection
            .execute_batch(
                r#"INSERT INTO ai_tasks VALUES ('task-summary','workbench-run-1');
                   INSERT INTO result_artifacts VALUES
                    ('artifact-summary','task-summary','chapter_summary','valid',
                     'novel-summary','chapter-summary','draft-summary');"#,
            )
            .expect("seed valid summary artifact without a projected card");
        assert_eq!(
            automatic_protocol_recovery_retry_number(
                &artifact_only_connection,
                &input,
                "DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states",
            )
            .expect("orphaned valid artifact blocks recovery"),
            None
        );
    }

    #[test]
    fn chapter_summary_recovery_stops_for_an_existing_formal_summary() {
        let input = chapter_summary_input();
        let connection = chapter_summary_recovery_connection();
        insert_recoverable_summary_failure(&connection, &input, 1);
        connection
            .execute(
                "INSERT INTO chapter_summaries VALUES
                 ('summary-formal','novel-summary','chapter-summary','draft-summary',1,1)",
                [],
            )
            .expect("seed expired formal summary");

        assert_eq!(
            automatic_protocol_recovery_retry_number(
                &connection,
                &input,
                "DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states",
            )
            .expect("expired summary does not block recovery"),
            Some(1)
        );
        connection
            .execute(
                "UPDATE chapter_summaries SET is_expired=0 WHERE id='summary-formal'",
                [],
            )
            .expect("enable current formal summary");

        assert_eq!(
            automatic_protocol_recovery_retry_number(
                &connection,
                &input,
                "DSH_REQUIRED_CONTEXT_READ_MISSING: get_character_states",
            )
            .expect("formal summary blocks recovery"),
            None
        );
    }

    #[test]
    fn chapter_summary_contract_still_rejects_same_step_character_state_read() {
        let input = chapter_summary_input();
        validate_turn_contract(&input).expect("valid chapter summary contract");
        let connection = rusqlite::Connection::open_in_memory().expect("contract database");
        connection
            .execute_batch(
                r#"CREATE TABLE tool_call_events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    tool_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    arguments_summary_json TEXT NOT NULL
                );
                INSERT INTO tool_call_events VALUES
                    ('read-novel', 'run-1', 0, 'novel.read_context', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
                    ('read-chapter', 'run-1', 1, 'chapter.read_outline', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
                    ('read-memory', 'run-1', 2, 'search_memory', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
                    ('read-characters', 'run-1', 3, 'get_character_states', 'succeeded',
                     '{"dshTurn":1,"dshStep":2,"dshResponseId":"turn:1:step:2"}'),
                    ('candidate-summary', 'run-1', 4, 'summarize_chapter', 'succeeded',
                     '{"dshTurn":1,"dshStep":2,"dshResponseId":"turn:1:step:2"}');"#,
            )
            .expect("seed real failure ordering");

        let same_step = validate_turn_execution_contract(&connection, &input, "run-1")
            .expect_err("same-step character state read must remain rejected");
        assert_eq!(same_step.code, "DSH_REQUIRED_CONTEXT_READ_MISSING");

        connection
            .execute(
                r#"UPDATE tool_call_events
                   SET arguments_summary_json=
                       '{"dshTurn":1,"dshStep":3,"dshResponseId":"turn:1:step:3"}'
                   WHERE event_id='candidate-summary'"#,
                [],
            )
            .expect("move summary candidate to later step");
        assert_eq!(
            validate_turn_execution_contract(&connection, &input, "run-1")
                .expect("later-step summary candidate"),
            Some("candidate-summary".to_string())
        );
    }

    #[test]
    fn chapter_summary_contract_keeps_character_and_memory_reads_optional() {
        let mut input = chapter_summary_input();
        input.required_read_tools = vec![
            "novel.read_context".to_string(),
            "chapter.read_outline".to_string(),
        ];
        validate_turn_contract(&input).expect("valid minimally grounded chapter summary");
        let connection = rusqlite::Connection::open_in_memory().expect("contract database");
        connection
            .execute_batch(
                r#"CREATE TABLE tool_call_events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    tool_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    arguments_summary_json TEXT NOT NULL
                );
                INSERT INTO tool_call_events VALUES
                    ('read-novel', 'run-1', 0, 'novel.read_context', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
                    ('read-chapter', 'run-1', 1, 'chapter.read_outline', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
                    ('read-characters', 'run-1', 2, 'get_character_states', 'succeeded',
                     '{"dshTurn":1,"dshStep":2,"dshResponseId":"turn:1:step:2"}'),
                    ('read-memory', 'run-1', 3, 'search_memory', 'succeeded',
                     '{"dshTurn":1,"dshStep":2,"dshResponseId":"turn:1:step:2"}'),
                    ('candidate-summary', 'run-1', 4, 'summarize_chapter', 'succeeded',
                     '{"dshTurn":1,"dshStep":2,"dshResponseId":"turn:1:step:2"}');"#,
            )
            .expect("seed optional context reads beside the summary candidate");

        assert_eq!(
            validate_turn_execution_contract(&connection, &input, "run-1")
                .expect("adopted prose and novel context are grounded in an earlier step"),
            Some("candidate-summary".to_string())
        );
    }

    #[test]
    fn read_turn_contract_requires_every_declared_context_read_to_succeed() {
        let mut input = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1/",
        );
        input.goal = "分析本作品现有世界背景".to_string();
        input.task_kind = "read".to_string();
        input.expected_tool = None;
        input.expected_artifact_type = None;
        input.required_read_tools = vec!["novel.read_context".to_string()];
        validate_turn_contract(&input).expect("valid grounded read contract");
        let prompt = workbench_turn_prompt(&input);
        assert!(prompt.contains("必需读取：novel.read_context"));
        assert!(prompt.contains("全部必需读取成功后"));

        let connection = rusqlite::Connection::open_in_memory().expect("contract database");
        connection
            .execute_batch(
                r#"CREATE TABLE tool_call_events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    tool_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    arguments_summary_json TEXT NOT NULL
                );"#,
            )
            .expect("tool event schema");

        let missing = validate_turn_execution_contract(&connection, &input, "run-1")
            .expect_err("a read-only answer without its declared source must fail");
        assert_eq!(missing.code, "DSH_REQUIRED_CONTEXT_READ_MISSING");

        connection
            .execute(
                "INSERT INTO tool_call_events VALUES
                 ('read-1', 'run-1', 0, 'novel.read_context', 'failed', '{}')",
                [],
            )
            .expect("failed read");
        let failed = validate_turn_execution_contract(&connection, &input, "run-1")
            .expect_err("a failed required read must not satisfy the contract");
        assert_eq!(failed.code, "DSH_REQUIRED_CONTEXT_READ_MISSING");

        connection
            .execute(
                "UPDATE tool_call_events SET status='succeeded' WHERE event_id='read-1'",
                [],
            )
            .expect("successful legacy read");
        let metadata = validate_turn_execution_contract(&connection, &input, "run-1")
            .expect_err("a required read without DSH response evidence must fail closed");
        assert_eq!(metadata.code, "DSH_TOOL_RESPONSE_METADATA_INVALID");

        connection
            .execute(
                r#"UPDATE tool_call_events
                   SET arguments_summary_json=
                       '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'
                   WHERE event_id='read-1'"#,
                [],
            )
            .expect("grounded read metadata");
        assert_eq!(
            validate_turn_execution_contract(&connection, &input, "run-1")
                .expect("successful grounded read"),
            None
        );
    }

    #[test]
    fn turn_contract_rejects_same_step_grounding_and_accepts_the_next_step() {
        let mut input = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1/",
        );
        input.chapter_id = None;
        input.task_kind = "story_plan_generate".to_string();
        input.expected_tool = Some("generate_outline".to_string());
        input.expected_artifact_type = Some("outline".to_string());
        input.required_read_tools = vec!["novel.read_context".to_string()];
        validate_turn_contract(&input).expect("valid story plan contract");
        let prompt = workbench_turn_prompt(&input);
        assert!(prompt.contains("taskKind：story_plan_generate"));
        assert!(prompt.contains("唯一候选工具：generate_outline"));
        assert!(prompt.contains("必需读取：novel.read_context"));

        let connection = rusqlite::Connection::open_in_memory().expect("contract database");
        connection
            .execute_batch(
                r#"CREATE TABLE tool_call_events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    tool_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    arguments_summary_json TEXT NOT NULL
                );
                INSERT INTO tool_call_events VALUES
                    ('read-1', 'run-1', 0, 'novel.read_context', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
                    ('candidate-1', 'run-1', 1, 'generate_outline', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}');"#,
            )
            .expect("seed calls from one model response");
        let same_step = validate_turn_execution_contract(&connection, &input, "run-1")
            .expect_err("a read and candidate from the same model step must fail");
        assert_eq!(same_step.code, "DSH_REQUIRED_CONTEXT_READ_MISSING");

        connection
            .execute(
                r#"UPDATE tool_call_events
                   SET arguments_summary_json=
                       '{"dshTurn":1,"dshStep":2,"dshResponseId":"turn:1:step:2"}'
                   WHERE event_id='candidate-1'"#,
                [],
            )
            .expect("move candidate to the response after the read result");
        assert_eq!(
            validate_turn_execution_contract(&connection, &input, "run-1")
                .expect("next-step candidate contract"),
            Some("candidate-1".to_string())
        );

        connection
            .execute(
                "UPDATE tool_call_events SET sequence=2 WHERE event_id='read-1'",
                [],
            )
            .expect("move read after candidate");
        let missing = validate_turn_execution_contract(&connection, &input, "run-1")
            .expect_err("late read must fail");
        assert_eq!(missing.code, "DSH_REQUIRED_CONTEXT_READ_MISSING");
    }

    #[test]
    fn turn_contract_rejects_legacy_calls_without_response_metadata() {
        let mut input = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1/",
        );
        input.chapter_id = None;
        input.task_kind = "story_plan_generate".to_string();
        input.expected_tool = Some("generate_outline".to_string());
        input.expected_artifact_type = Some("outline".to_string());
        input.required_read_tools = vec!["novel.read_context".to_string()];

        let connection = rusqlite::Connection::open_in_memory().expect("contract database");
        connection
            .execute_batch(
                r#"CREATE TABLE tool_call_events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    tool_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    arguments_summary_json TEXT NOT NULL
                );
                INSERT INTO tool_call_events VALUES
                    ('read-1', 'run-1', 0, 'novel.read_context', 'succeeded', '{}'),
                    ('candidate-1', 'run-1', 1, 'generate_outline', 'succeeded',
                     '{"dshTurn":1,"dshStep":2,"dshResponseId":"turn:1:step:2"}');"#,
            )
            .expect("seed a legacy read without response metadata");
        let legacy_read = validate_turn_execution_contract(&connection, &input, "run-1")
            .expect_err("legacy read metadata must fail closed");
        assert_eq!(legacy_read.code, "DSH_TOOL_RESPONSE_METADATA_INVALID");

        connection
            .execute_batch(
                r#"UPDATE tool_call_events
                    SET arguments_summary_json=
                        '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'
                    WHERE event_id='read-1';
                   UPDATE tool_call_events SET arguments_summary_json='{}'
                    WHERE event_id='candidate-1';"#,
            )
            .expect("move missing metadata to the candidate");
        let legacy_candidate = validate_turn_execution_contract(&connection, &input, "run-1")
            .expect_err("legacy candidate metadata must fail closed");
        assert_eq!(legacy_candidate.code, "DSH_TOOL_RESPONSE_METADATA_INVALID");
    }

    #[test]
    fn turn_contract_distinguishes_a_missing_required_candidate() {
        let input = chapter_summary_input();
        let connection = rusqlite::Connection::open_in_memory().expect("contract database");
        connection
            .execute_batch(
                r#"CREATE TABLE tool_call_events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    tool_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    arguments_summary_json TEXT NOT NULL
                );
                INSERT INTO tool_call_events VALUES
                    ('read-1', 'run-1', 0, 'novel.read_context', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}');"#,
            )
            .expect("seed a summary run without a candidate call");

        let missing = validate_turn_execution_contract(&connection, &input, "run-1")
            .expect_err("a required candidate tool call cannot be omitted");
        assert_eq!(missing.code, "DSH_REQUIRED_CANDIDATE_TOOL_MISSING");
    }

    #[test]
    fn turn_contract_allows_failed_repairs_and_rejects_wrong_or_duplicate_candidates() {
        let mut input = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1/",
        );
        input.task_kind = "setting_expand".to_string();
        input.expected_tool = Some("expand_settings".to_string());
        input.expected_artifact_type = Some("setting_candidates".to_string());
        input.required_read_tools = vec![
            "novel.read_context".to_string(),
            "chapter.read_outline".to_string(),
        ];
        validate_turn_contract(&input).expect("valid setting contract");

        let connection = rusqlite::Connection::open_in_memory().expect("contract database");
        connection
            .execute_batch(
                r#"CREATE TABLE tool_call_events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    tool_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    arguments_summary_json TEXT NOT NULL
                );
                INSERT INTO tool_call_events VALUES
                    ('read-1', 'run-1', 0, 'novel.read_context', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
                    ('read-2', 'run-1', 1, 'chapter.read_outline', 'succeeded',
                     '{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
                    ('candidate-1', 'run-1', 2, 'generate_characters', 'succeeded',
                     '{"dshTurn":1,"dshStep":2,"dshResponseId":"turn:1:step:2"}');"#,
            )
            .expect("seed wrong candidate");
        let wrong = validate_turn_execution_contract(&connection, &input, "run-1")
            .expect_err("wrong candidate must fail");
        assert_eq!(wrong.code, "DSH_UNEXPECTED_CANDIDATE_TOOL");

        connection
            .execute(
                "UPDATE tool_call_events
                 SET tool_name='expand_settings', status='failed'
                 WHERE event_id='candidate-1'",
                [],
            )
            .expect("turn the first candidate into a failed validation attempt");
        connection
            .execute(
                r#"INSERT INTO tool_call_events VALUES
                    ('candidate-2', 'run-1', 3, 'expand_settings', 'succeeded',
                     '{"dshTurn":1,"dshStep":3,"dshResponseId":"turn:1:step:3"}')"#,
                [],
            )
            .expect("insert a corrected candidate");
        assert_eq!(
            validate_turn_execution_contract(&connection, &input, "run-1")
                .expect("a failed candidate followed by one success is valid"),
            Some("candidate-2".to_string())
        );

        connection
            .execute(
                "UPDATE tool_call_events SET status='succeeded' WHERE event_id='candidate-1'",
                [],
            )
            .expect("forge a second successful candidate");
        let duplicate = validate_turn_execution_contract(&connection, &input, "run-1")
            .expect_err("two successful candidates must fail");
        assert_eq!(duplicate.code, "DSH_CANDIDATE_TOOL_COUNT_INVALID");

        connection
            .execute_batch(
                r#"UPDATE tool_call_events SET status='failed' WHERE event_id='candidate-1';
                 INSERT INTO tool_call_events VALUES
                    ('candidate-3', 'run-1', 4, 'expand_settings', 'failed',
                     '{"dshTurn":1,"dshStep":4,"dshResponseId":"turn:1:step:4"}')"#,
            )
            .expect("append a call after success");
        let late_retry = validate_turn_execution_contract(&connection, &input, "run-1")
            .expect_err("a candidate call after success must fail");
        assert_eq!(late_retry.code, "DSH_CANDIDATE_RETRY_SEQUENCE_INVALID");

        connection
            .execute(
                "UPDATE tool_call_events SET status='failed' WHERE event_id='candidate-2'",
                [],
            )
            .expect("make all bounded attempts fail");
        let exhausted = validate_turn_execution_contract(&connection, &input, "run-1")
            .expect_err("three failed attempts must terminate without an artifact");
        assert_eq!(exhausted.code, "DSH_EXPECTED_CANDIDATE_FAILED");

        connection
            .execute(
                r#"INSERT INTO tool_call_events VALUES
                    ('candidate-4', 'run-1', 5, 'expand_settings', 'failed',
                     '{"dshTurn":1,"dshStep":5,"dshResponseId":"turn:1:step:5"}')"#,
                [],
            )
            .expect("exceed the candidate attempt limit");
        let over_limit = validate_turn_execution_contract(&connection, &input, "run-1")
            .expect_err("a fourth candidate attempt must fail closed");
        assert_eq!(over_limit.code, "DSH_CANDIDATE_TOOL_COUNT_INVALID");

        input.task_kind = "read".to_string();
        input.expected_tool = None;
        input.expected_artifact_type = None;
        input.required_read_tools.clear();
        let unexpected = validate_turn_execution_contract(&connection, &input, "run-1")
            .expect_err("read turn candidate must fail");
        assert_eq!(unexpected.code, "DSH_UNEXPECTED_CANDIDATE_TOOL");
    }

    #[test]
    fn openai_compatible_snapshot_uses_exact_model_on_the_pinned_harness() {
        let input = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1/",
        );
        let route = selected_model_route(&input).expect("compatible route");
        assert_eq!(route.logical_provider, OPENAI_COMPATIBLE_PROVIDER);
        assert_eq!(route.harness_provider, DEEPSEEK_HARNESS_PROVIDER);
        assert_eq!(route.model, "gpt-5.6-luna");
        assert_eq!(route.base_url, "http://127.0.0.1:12074/v1");

        let probe = probe_input(Some(&input.model_snapshot), Some("session-only-probe-key"))
            .expect("dynamic probe input");
        let probe_route = selected_model_route(&probe).expect("dynamic probe route");
        assert_eq!(probe_route, route);
        assert_eq!(probe.api_key, "session-only-probe-key");

        let mut legacy = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1",
        );
        legacy
            .model_snapshot
            .as_object_mut()
            .unwrap()
            .remove("runtime");
        let legacy_route =
            selected_model_route(&legacy).expect("legacy snapshots default adapterProtocol");
        assert_eq!(legacy_route.model, "gpt-5.6-luna");
        let mut missing_url = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1",
        );
        missing_url
            .model_snapshot
            .as_object_mut()
            .expect("object snapshot")
            .remove("baseUrl");
        assert!(selected_model_route(&missing_url)
            .expect_err("openai_compatible still requires baseUrl to start")
            .contains("baseUrl"),);
        assert!(
            read_matching_plugin_probe_health(Some(&missing_url.model_snapshot), None)
                .expect("catalog matching must not fail closed")
                .is_none()
        );
        assert!(!probe
            .model_snapshot
            .to_string()
            .contains("session-only-probe-key"));

        let transport = provider_transport(&input).expect("provider transport");
        let other = provider_transport(&api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "another-model",
            "http://127.0.0.1:12074/v1",
        ))
        .expect("other provider transport");
        assert_ne!(transport.identity_hash, other.identity_hash);
    }

    #[test]
    fn snapshot_provider_model_and_base_url_mismatches_fail_closed() {
        let mut provider_mismatch = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1",
        );
        provider_mismatch.model_snapshot["runtime"]["adapterProvider"] =
            json!(DEEPSEEK_HARNESS_PROVIDER);
        assert!(selected_model_route(&provider_mismatch)
            .expect_err("provider mismatch")
            .contains("不一致"));

        let model_mismatch = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            " gpt-5.6-luna",
            "http://127.0.0.1:12074/v1",
        );
        assert!(selected_model_route(&model_mismatch)
            .expect_err("non-exact model")
            .contains("modelId 无效"));

        let invalid_base = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1?credential=forbidden",
        );
        assert!(selected_model_route(&invalid_base).is_err());

        let mut mock_snapshot = provider_mismatch.model_snapshot.clone();
        mock_snapshot["runtimeMode"] = json!("mock");
        assert!(probe_input(Some(&mock_snapshot), None).is_err());
        let mut secret_snapshot = api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1",
        )
        .model_snapshot;
        secret_snapshot["apiKey"] = json!("fixture-only");
        assert!(probe_input(Some(&secret_snapshot), None).is_err());
    }

    #[test]
    fn runtime_health_identity_is_checked_before_logical_projection() {
        let route = selected_model_route(&api_input(
            OPENAI_COMPATIBLE_PROVIDER,
            "gpt-5.6-luna",
            "http://127.0.0.1:12074/v1",
        ))
        .expect("compatible route");
        let verified_at = Utc::now();
        let health = json!({
            "route": {
                "provider": DEEPSEEK_HARNESS_PROVIDER,
                "model": "gpt-5.6-luna"
            },
            "providers": [{
                "id": DEEPSEEK_HARNESS_PROVIDER,
                "name": "DeepSeek",
                "status": "loaded",
                "models": [{
                    "provider": DEEPSEEK_HARNESS_PROVIDER,
                    "id": "deepseek-v4-flash"
                }]
            }],
            "models": [{
                "provider": DEEPSEEK_HARNESS_PROVIDER,
                "id": "deepseek-v4-flash"
            }],
            "modelToolAttestations": [{
                "protocol": MODEL_TOOL_ATTESTATION_PROTOCOL,
                "provider": DEEPSEEK_HARNESS_PROVIDER,
                "model": "gpt-5.6-luna",
                "verified": true,
                "cached": false,
                "verifiedAt": verified_at.to_rfc3339(),
                "expiresAt": (verified_at + chrono::Duration::milliseconds(MODEL_TOOL_ATTESTATION_TTL_MS)).to_rfc3339(),
                "cacheTtlMs": MODEL_TOOL_ATTESTATION_TTL_MS,
                "finishKind": "tool-calls",
                "observedToolCalls": 1
            }]
        });
        validate_runtime_health_identity(&health, &route).expect("exact harness health");
        let projected = project_runtime_health_identity(health, &route);
        assert_eq!(
            projected.pointer("/route/provider").and_then(Value::as_str),
            Some(OPENAI_COMPATIBLE_PROVIDER)
        );
        assert_eq!(
            projected.pointer("/providers/0/id").and_then(Value::as_str),
            Some(OPENAI_COMPATIBLE_PROVIDER)
        );
        assert_eq!(
            projected
                .pointer("/models/0/provider")
                .and_then(Value::as_str),
            Some(OPENAI_COMPATIBLE_PROVIDER)
        );
        assert_eq!(
            projected.pointer("/models/0/id").and_then(Value::as_str),
            Some("gpt-5.6-luna")
        );
        assert_eq!(
            projected
                .pointer("/providers/0/models/0/id")
                .and_then(Value::as_str),
            Some("gpt-5.6-luna")
        );
        assert_eq!(
            projected
                .pointer("/modelToolAttestations/0/provider")
                .and_then(Value::as_str),
            Some(OPENAI_COMPATIBLE_PROVIDER)
        );

        let wrong_provider = json!({
            "route": { "provider": OPENAI_COMPATIBLE_PROVIDER, "model": "gpt-5.6-luna" }
        });
        assert!(validate_runtime_health_identity(&wrong_provider, &route).is_err());
        let wrong_model = json!({
            "route": { "provider": DEEPSEEK_HARNESS_PROVIDER, "model": "other-model" }
        });
        assert!(validate_runtime_health_identity(&wrong_model, &route).is_err());
    }

    #[test]
    fn tool_error_prefers_gateway_message_over_generic_code() {
        let event = json!({
            "data": {
                "message": {
                    "content": [{
                        "content": [{
                            "type": "text",
                            "text": "{\"error\":\"candidateText must be a non-empty string\"}"
                        }]
                    }]
                }
            }
        });
        assert_eq!(
            tool_error_message(&event, "DSH_TOOL_FAILED"),
            "candidateText must be a non-empty string"
        );
    }

    #[test]
    fn artifact_projection_only_exposes_validated_candidates() {
        assert_eq!(
            artifact_projection_summary("valid", 0, 0).expect("valid summary"),
            "候选已通过产物契约校验，需在对话中确认后才会写入正式事实。"
        );
        assert!(artifact_projection_summary("valid_with_warnings", 2, 0)
            .expect("warning summary")
            .contains("包含警告"));
        let invalid = artifact_projection_summary("invalid", 0, 1)
            .expect_err("invalid artifact must not become a candidate card");
        assert_eq!(invalid.code, "ARTIFACT_VALIDATION_FAILED");
    }

    #[test]
    fn provider_options_projection_excludes_runtime_only_snapshot_fields() {
        let projected = provider_options_from_model_snapshot(&json!({
            "providerId": OPENAI_COMPATIBLE_PROVIDER,
            "modelId": "gpt-5.6-luna",
            "options": {
                "temperature": 0.6,
                "maxTokens": 12_000,
                "timeoutSeconds": 600,
                "contextCompression": {
                    "novelProviderId": "ans.novel-context.extractive-v1",
                    "sessionCompaction": "dsh-compaction-basic"
                }
            }
        }));

        assert_eq!(
            projected,
            json!({
                "providerId": OPENAI_COMPATIBLE_PROVIDER,
                "model": "gpt-5.6-luna",
                "temperature": 0.6,
                "maxTokens": 12_000
            })
        );
        crate::services::ai_fact_security::validate_provider_options(&projected)
            .expect("projected provider options should satisfy the durable fact allowlist");
    }

    #[test]
    fn provider_response_projection_excludes_request_governance_metadata() {
        let metadata = provider_response_metadata(
            &json!({
                "providerId": OPENAI_COMPATIBLE_PROVIDER,
                "modelId": "gpt-5.6-luna"
            }),
            "provider-request-1",
            "response-hash",
            4096,
            1200,
            800,
        );

        assert_eq!(metadata["provider"], OPENAI_COMPATIBLE_PROVIDER);
        assert_eq!(metadata["model"], "gpt-5.6-luna");
        assert_eq!(metadata["tokenTotal"], 2000);
        assert!(metadata.get("governedReservationId").is_none());
        crate::services::ai_fact_security::validate_response_metadata(&metadata)
            .expect("projected response metadata should satisfy the durable fact allowlist");
    }

    #[test]
    fn novel_scoped_outline_projection_can_create_its_durable_ai_task() {
        let mut connection = ai_task_service::tests::connection().expect("task database");
        connection
            .execute(
                "INSERT INTO novels (id, title, created_at, updated_at)
                 VALUES ('novel-1', '测试作品', '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z')",
                [],
            )
            .expect("seed novel");
        let prompt_body = "你是 AI Novel Studio 的小说任务执行 Agent。只生成候选，不写入正式事实。";
        let input = CreateAiTaskInput {
            operation_id: "workbench-run-story-plan".to_string(),
            request_hash_version: None,
            request_hash: None,
            trace_id: None,
            task_type: "outline_generate".to_string(),
            novel_id: "novel-1".to_string(),
            chapter_id: None,
            draft_id: None,
            scope_type: "novel".to_string(),
            expected_artifact_type: "outline".to_string(),
            expected_artifact_schema_version: 1,
            target_hint_json: Some(json!({
                "conversationId": "conversation-1",
                "turnId": "turn-1",
                "runId": "run-1",
                "modelSnapshot": {
                    "providerId": OPENAI_COMPATIBLE_PROVIDER,
                    "modelId": "gpt-5.6-luna",
                    "runtimeMode": "api",
                    "baseUrl": "http://127.0.0.1:12074/v1",
                    "options": {"maxTokens": 8000}
                },
                "baseChapterRevision": "2026-08-28T00:00:00Z",
                "baseDraftId": null,
                "baseDraftVersion": null,
                "baseContentHash": null
            })),
            input_snapshot: ai_task_service::InputSnapshotInput {
                schema_version: 1,
                input_type: "workbench_dsh_messages_v1".to_string(),
                payload_json: json!({
                    "goal": "生成全书规划候选。创意依据：写一部约6万字的悬疑小说。",
                    "conversationId": "conversation-1"
                }),
                body: json!({"messages":[{"role":"user","content":"生成全书规划候选"}]})
                    .to_string(),
                source_draft_id: None,
                source_draft_version: None,
                base_content_hash: None,
            },
            context_snapshot: ai_task_service::ContextSnapshotInput {
                schema_version: 1,
                source_manifest_json: json!({
                    "contractVersion": "workbench_dsh_context_evidence_v1",
                    "compilerVersion": "workbench_dsh_context_evidence_v1",
                    "compiledContextHash": large_text_repository::sha256("{}"),
                    "sources": []
                }),
                compiled_context: "{}".to_string(),
                budget_json: json!({
                    "maxChars": 2,
                    "estimatedTokens": 1,
                    "compiledContextChars": 2,
                    "compiledContextBytes": 2,
                    "includedSourceCount": 0,
                    "truncatedSourceCount": 0,
                    "omittedSourceCount": 0
                }),
                compiler_version: "workbench_dsh_context_evidence_v1".to_string(),
            },
            constraint_snapshot: ai_task_service::ConstraintSnapshotInput {
                schema_version: 1,
                payload_json: json!({"candidateOnly":true,"mayWriteBusinessData":false}),
                prompt_template_id: "workbench/outline".to_string(),
                prompt_template_version: "1".to_string(),
                prompt_template_hash: large_text_repository::sha256(prompt_body),
                prompt_template_body: prompt_body.to_string(),
                provider_options_json: json!({"maxTokens": 8000}),
            },
        };

        let task = ai_task_service::create_task(&mut connection, input)
            .expect("novel-scoped outline task should persist");
        assert_eq!(task.task_type, "outline_generate");
        assert_eq!(task.scope_type, "novel");
        assert_eq!(task.expected_artifact_type, "outline");
    }

    #[test]
    fn chapter_scoped_setting_projection_uses_the_trusted_dsh_creation_boundary() {
        let mut connection = ai_task_service::tests::connection().expect("task database");
        connection
            .execute(
                "INSERT INTO novels (id, title, created_at, updated_at)
                 VALUES ('novel-1', '测试作品', '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z')",
                [],
            )
            .expect("seed novel");
        connection
            .execute(
                "INSERT INTO chapters
                 (id, novel_id, title, order_index, status, created_at, updated_at)
                 VALUES ('chapter-1', 'novel-1', '第一章', 1, 'outline_ready',
                         '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z')",
                [],
            )
            .expect("seed chapter");
        let prompt_body = "你是 AI Novel Studio 的小说任务执行 Agent。只生成候选，不写入正式事实。";
        let compiled_context = "{}".to_string();
        let input = CreateAiTaskInput {
            operation_id: "workbench-run-setting".to_string(),
            request_hash_version: None,
            request_hash: None,
            trace_id: None,
            task_type: "setting_expand".to_string(),
            novel_id: "novel-1".to_string(),
            chapter_id: Some("chapter-1".to_string()),
            draft_id: None,
            scope_type: "chapter".to_string(),
            expected_artifact_type: "setting_candidates".to_string(),
            expected_artifact_schema_version: 1,
            target_hint_json: Some(json!({
                "conversationId": "conversation-1",
                "turnId": "turn-setting",
                "runId": "run-setting",
                "modelSnapshot": {
                    "providerId": OPENAI_COMPATIBLE_PROVIDER,
                    "modelId": "gpt-5.6-luna",
                    "runtimeMode": "api",
                    "baseUrl": "http://127.0.0.1:12074/v1",
                    "options": {"maxTokens": 8000}
                },
                "baseChapterRevision": "2026-08-28T00:00:00Z",
                "baseDraftId": null,
                "baseDraftVersion": null,
                "baseContentHash": null
            })),
            input_snapshot: ai_task_service::InputSnapshotInput {
                schema_version: 1,
                input_type: "workbench_dsh_messages_v1".to_string(),
                payload_json: json!({
                    "goal": "生成世界设定候选。创意依据：写一部约6万字的悬疑小说。",
                    "conversationId": "conversation-1"
                }),
                body: json!({"messages":[{"role":"user","content":"生成世界设定候选"}]})
                    .to_string(),
                source_draft_id: None,
                source_draft_version: None,
                base_content_hash: None,
            },
            context_snapshot: ai_task_service::ContextSnapshotInput {
                schema_version: 1,
                source_manifest_json: json!({
                    "contractVersion": "workbench_dsh_context_evidence_v1",
                    "compilerVersion": "workbench_dsh_context_evidence_v1",
                    "compiledContextHash": large_text_repository::sha256(&compiled_context),
                    "sources": []
                }),
                compiled_context,
                budget_json: json!({
                    "maxChars": 2,
                    "estimatedTokens": 1,
                    "compiledContextChars": 2,
                    "compiledContextBytes": 2,
                    "includedSourceCount": 0,
                    "truncatedSourceCount": 0,
                    "omittedSourceCount": 0
                }),
                compiler_version: "workbench_dsh_context_evidence_v1".to_string(),
            },
            constraint_snapshot: ai_task_service::ConstraintSnapshotInput {
                schema_version: 1,
                payload_json: json!({"candidateOnly":true,"mayWriteBusinessData":false}),
                prompt_template_id: "workbench/setting_candidates".to_string(),
                prompt_template_version: "1".to_string(),
                prompt_template_hash: large_text_repository::sha256(prompt_body),
                prompt_template_body: prompt_body.to_string(),
                provider_options_json: json!({"maxTokens": 8000}),
            },
        };

        let task = ai_task_service::create_dsh_projected_task(
            &mut connection,
            input,
            "run-setting",
            "turn-setting",
            "conversation-1",
        )
        .expect("trusted DSH setting projection should persist");
        assert_eq!(task.task_type, "setting_expand");
        assert_eq!(task.scope_type, "chapter");
        assert_eq!(task.expected_artifact_type, "setting_candidates");
    }

    #[test]
    fn artifact_context_evidence_records_only_read_tool_summaries() {
        let connection = rusqlite::Connection::open_in_memory().expect("open evidence database");
        connection
            .execute_batch(
                "CREATE TABLE tool_call_events (
                    event_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    tool_name TEXT NOT NULL,
                    arguments_summary_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    result_json TEXT
                );",
            )
            .expect("create evidence schema");
        connection
            .execute(
                "INSERT INTO tool_call_events VALUES (?1, 'run-1', 1,
                    'novel.read_context', ?2, 'succeeded', ?3)",
                rusqlite::params![
                    "event-read-1",
                    json!({
                        "toolVersion": "1",
                        "argumentsHash": "argument-hash",
                        "hiddenPrompt": "must-not-survive"
                    })
                    .to_string(),
                    json!({
                        "largeTextRefId": "result-ref-1",
                        "contentHash": "content-hash",
                        "contentChars": 321,
                        "rawContent": "must-not-survive"
                    })
                    .to_string()
                ],
            )
            .expect("insert read evidence");
        connection
            .execute(
                "INSERT INTO tool_call_events VALUES (?1, 'run-1', 2,
                    'generate_chapter', '{}', 'succeeded', '{}')",
                rusqlite::params!["event-candidate-1"],
            )
            .expect("insert candidate event");

        let (manifest, compiled, budget, generation_context) =
            build_context_evidence(&connection, "run-1").expect("compile evidence");
        assert_eq!(manifest["sources"].as_array().map(Vec::len), Some(1));
        assert_eq!(manifest["sources"][0]["eventId"], "event-read-1");
        assert_eq!(manifest["sources"][0]["argumentsHash"], "argument-hash");
        assert_eq!(manifest["sources"][0]["largeTextRefId"], "result-ref-1");
        assert_eq!(budget["includedSourceCount"], 1);
        assert_eq!(
            generation_context["contractVersion"],
            "workbench_dsh_context_receipt_v1"
        );
        assert_eq!(
            manifest["compiledContextHash"],
            large_text_repository::sha256(&compiled)
        );
        assert!(!compiled.contains("must-not-survive"));
        assert!(!compiled.contains("generate_chapter"));

        let candidate_receipt =
            candidate_generation_context(&connection, "run-1", "generate_chapter", false)
                .expect("candidate receipt")
                .expect("candidate tools receive a context receipt before terminalization");
        assert_eq!(
            candidate_receipt["contractVersion"],
            "workbench_dsh_context_receipt_v1"
        );
        assert!(
            candidate_generation_context(&connection, "run-1", "novel.read_context", false)
                .expect("read tool projection")
                .is_none()
        );
        assert!(
            candidate_generation_context(&connection, "run-1", "generate_chapter", true)
                .expect("failed candidate projection")
                .is_none()
        );
    }

    #[test]
    fn dsh_context_receipt_reports_formal_assets_without_exposing_content() {
        let mut sources = Vec::new();
        collect_context_receipts(
            "novel.read_context",
            &json!({
                "data": {
                    "novel": {"id": "novel-1"},
                    "worldSettings": [{"content": "secret-world-body"}],
                    "ruleSystems": [],
                    "protagonists": [{"name": "林默"}],
                    "masterOutline": {"content": "secret-outline-body"},
                    "volumeOutlines": [],
                    "currentChapterOutline": null,
                    "styleProfiles": [{"name": "克制悬疑"}],
                    "outputProfiles": [{"name": "长篇正文"}],
                    "factions": [],
                    "locations": [],
                    "referenceWorks": [{"title": "研究资料"}],
                    "referenceExcerpts": [{"content": "secret-reference-body"}]
                }
            }),
            &mut sources,
        );
        collect_context_receipts(
            "search_memory",
            &json!({"data":{"chunks":[{"text":"secret-memory-body"}]}}),
            &mut sources,
        );
        assert!(sources
            .iter()
            .any(|source| { source["type"] == "world_setting" && source["status"] == "used" }));
        assert!(sources
            .iter()
            .any(|source| { source["type"] == "rule_system" && source["status"] == "missing" }));
        assert!(sources
            .iter()
            .any(|source| { source["type"] == "memory_context" && source["status"] == "used" }));
        assert!(sources.iter().any(|source| {
            source["type"] == "reference_material" && source["status"] == "used"
        }));
        let serialized = serde_json::to_string(&sources).expect("serialize safe receipt");
        assert!(!serialized.contains("secret-world-body"));
        assert!(!serialized.contains("secret-outline-body"));
        assert!(!serialized.contains("secret-memory-body"));
        assert!(!serialized.contains("secret-reference-body"));
    }

    #[test]
    fn model_tool_attestation_requires_exact_live_positive_evidence() {
        let verified_at = Utc::now();
        let evidence = json!({
            "protocol": MODEL_TOOL_ATTESTATION_PROTOCOL,
            "provider": "deepseek-official",
            "model": "deepseek-chat",
            "verified": true,
            "cached": false,
            "verifiedAt": verified_at.to_rfc3339(),
            "expiresAt": (verified_at + chrono::Duration::milliseconds(MODEL_TOOL_ATTESTATION_TTL_MS)).to_rfc3339(),
            "cacheTtlMs": MODEL_TOOL_ATTESTATION_TTL_MS,
            "finishKind": "tool-calls",
            "observedToolCalls": 1
        });
        let parsed =
            validate_model_tool_attestation(evidence.clone(), "deepseek-official", "deepseek-chat")
                .expect("exact positive evidence");
        assert!(parsed.verified);
        let frozen = model_snapshot_with_tool_attestation(
            &json!({
                "providerId": "deepseek-official",
                "modelId": "deepseek-chat",
                "runtime": {
                    "toolCallingAttestation": {
                        "verified": true,
                        "nonce": "untrusted-client-claim",
                        "usage": { "inputTokens": 1 }
                    }
                }
            }),
            &parsed,
        )
        .expect("freeze validated evidence");
        let frozen_evidence = frozen
            .pointer("/runtime/toolCallingAttestation")
            .and_then(Value::as_object)
            .expect("frozen evidence object");
        assert_eq!(frozen_evidence.len(), 10);
        assert!(!frozen_evidence.contains_key("nonce"));
        assert!(!frozen_evidence.contains_key("usage"));

        assert!(validate_model_tool_attestation(
            evidence.clone(),
            "deepseek-official",
            "other-model"
        )
        .expect_err("model mismatch must fail")
        .contains("ATTESTATION_IDENTITY_MISMATCH"));

        assert!(validate_model_tool_attestation(
            evidence.clone(),
            "openai_compatible",
            "deepseek-chat"
        )
        .expect_err("provider mismatch must fail")
        .contains("ATTESTATION_IDENTITY_MISMATCH"));

        let mut expired = evidence;
        expired["expiresAt"] = json!((Utc::now() - chrono::Duration::seconds(1)).to_rfc3339());
        assert!(
            validate_model_tool_attestation(expired, "deepseek-official", "deepseek-chat")
                .expect_err("expired evidence must fail")
                .contains("INVALID_POSITIVE_EVIDENCE")
        );

        let rejected = json!({
            "protocol": MODEL_TOOL_ATTESTATION_PROTOCOL,
            "provider": "deepseek-official",
            "model": "deepseek-chat",
            "verified": false,
            "cached": false,
            "failureCode": "NO_TOOL_CALL"
        });
        assert!(
            validate_model_tool_attestation(rejected, "deepseek-official", "deepseek-chat")
                .expect_err("negative evidence must fail closed")
                .contains("NO_TOOL_CALL")
        );
    }
}

#[cfg(test)]
pub fn debug_kill_worker(conversation_id: &str) {
    if let Ok(mut workers) = active().lock() {
        if let Some(worker) = workers.get_mut(conversation_id) {
            if let Ok(mut holder) = worker.process.lock() {
                if let Some(process) = holder.take() {
                    let _ = process.runtime.shutdown_and_wait(Duration::from_secs(10));
                    process.runtime.kill();
                }
            }
            worker.status = "idle".to_string();
        }
    }
}

#[cfg(test)]
pub fn debug_has_worker_process(conversation_id: &str) -> bool {
    active()
        .lock()
        .ok()
        .and_then(|workers| {
            workers
                .get(conversation_id)
                .map(|worker| worker.process.clone())
        })
        .and_then(|holder| holder.lock().ok().and_then(|process| process.clone()))
        .is_some()
}

fn validate_runtime_health_identity(
    health: &Value,
    route: &SelectedModelRoute,
) -> Result<(), String> {
    if health.pointer("/route/provider").and_then(Value::as_str)
        != Some(route.harness_provider.as_str())
        || health.pointer("/route/model").and_then(Value::as_str) != Some(route.model.as_str())
    {
        return Err("DSH runtime/health 精确 Provider/Model 身份不匹配".to_string());
    }
    Ok(())
}

fn project_runtime_health_identity(mut health: Value, route: &SelectedModelRoute) -> Value {
    let projected_model = json!({
        "provider": route.logical_provider,
        "id": route.model,
        "name": route.model
    });
    if let Some(route_value) = health.get_mut("route").and_then(Value::as_object_mut) {
        route_value.insert(
            "provider".to_string(),
            Value::String(route.logical_provider.clone()),
        );
    }
    if let Some(providers) = health.get_mut("providers").and_then(Value::as_array_mut) {
        providers.retain(|provider| {
            provider.get("id").and_then(Value::as_str) == Some(route.harness_provider.as_str())
        });
        for provider in providers {
            if let Some(provider) = provider.as_object_mut() {
                provider.insert(
                    "id".to_string(),
                    Value::String(route.logical_provider.clone()),
                );
                if route.logical_provider != route.harness_provider {
                    provider.insert(
                        "name".to_string(),
                        Value::String("OpenAI-compatible".to_string()),
                    );
                }
                provider.insert("models".to_string(), json!([projected_model.clone()]));
            }
        }
    }
    if let Some(health_object) = health.as_object_mut() {
        health_object.insert("models".to_string(), json!([projected_model]));
    }
    if let Some(attestations) = health
        .get_mut("modelToolAttestations")
        .and_then(Value::as_array_mut)
    {
        attestations.retain(|attestation| {
            attestation.get("provider").and_then(Value::as_str)
                == Some(route.harness_provider.as_str())
                && attestation.get("model").and_then(Value::as_str) == Some(route.model.as_str())
        });
        for attestation in attestations {
            attestation["provider"] = Value::String(route.logical_provider.clone());
        }
    }
    health
}

fn read_process_health(process: &WorkerProcess) -> Result<Value, String> {
    let health = process
        .runtime
        .request("runtime/health", None, Duration::from_secs(5))
        .map_err(|_| "DSH runtime/health 查询失败".to_string())?;
    if !health.is_object() {
        return Err("DSH runtime/health 响应无效".to_string());
    }
    validate_runtime_health_identity(&health, &process.model_route)?;
    Ok(project_runtime_health_identity(
        health,
        &process.model_route,
    ))
}

fn probe_input(
    model_snapshot: Option<&Value>,
    api_key: Option<&str>,
) -> Result<StartTaskTurnInput, String> {
    let snapshot = match model_snapshot {
        Some(snapshot) => {
            if !snapshot.is_object()
                || crate::services::ai_fact_security::contains_secret_value(snapshot)
            {
                return Err("modelSnapshot 无效或包含凭据字段".to_string());
            }
            snapshot.clone()
        }
        None => {
            let upstream = std::env::var("DSH_PROXY_UPSTREAM")
                .unwrap_or_else(|_| "http://127.0.0.1:9".to_string());
            json!({
                "providerId": "deepseek-official",
                "modelId": "deepseek-chat",
                "runtimeMode": "api",
                "baseUrl": upstream,
                "capabilities": [],
                "options": { "maxTokens": 512 },
                "runtime": {
                    "adapterProtocol": DSH_PROTOCOL,
                    "adapterProvider": "deepseek-official"
                }
            })
        }
    };
    let input = StartTaskTurnInput {
        conversation_id: PLUGIN_PROBE_CONVERSATION_ID.to_string(),
        novel_id: "plugin-probe".to_string(),
        turn_id: "plugin-probe".to_string(),
        goal: "plugin-probe".to_string(),
        chapter_id: None,
        task_kind: default_task_kind(),
        expected_tool: None,
        expected_artifact_type: None,
        required_read_tools: Vec::new(),
        book_word_goal: None,
        model_snapshot: snapshot,
        request_policy: TaskRequestPolicyInput {
            max_requests_per_minute: 12,
            max_concurrent_requests: 1,
            daily_token_budget: None,
            daily_cost_budget_usd: None,
            warning_percent: 80,
            timeout_seconds: 30,
        },
        api_key: api_key.unwrap_or_default().to_string(),
    };
    selected_model_route(&input)?;
    Ok(input)
}

fn ensure_plugin_probe_health(
    model_snapshot: Option<&Value>,
    api_key: Option<&str>,
) -> Result<Option<Value>, String> {
    let input = match probe_input(model_snapshot, api_key) {
        Ok(input) => input,
        Err(_) if model_snapshot.is_some() => match probe_input(None, api_key) {
            Ok(input) => input,
            Err(_) => return Ok(None),
        },
        Err(_) => return Ok(None),
    };
    let transport = match provider_transport(&input) {
        Ok(transport) => transport,
        Err(error) if model_snapshot.is_some() => return Err(error),
        Err(_) => return Ok(None),
    };
    let descriptor = describe_runtime();
    if !carrier_files_ready(&descriptor.status) {
        return Ok(None);
    }
    let _refresh_guard = plugin_probe_refresh()
        .lock()
        .map_err(|_| "Runtime 模型目录刷新锁失败".to_string())?;
    if let Some(existing) = current_plugin_probe() {
        if existing.identity_hash == transport.identity_hash {
            if let Ok(health) = read_process_health(&existing) {
                return Ok(Some(health));
            }
        }
        let stale = plugin_probe()
            .lock()
            .ok()
            .and_then(|mut guard| guard.take());
        if let Some(stale) = stale {
            // A probe never owns user work, so replace an unhealthy or
            // differently routed carrier immediately.
            stale.runtime.kill();
        }
    }
    let dummy_projection = Arc::new(Mutex::new(None));
    let process = match spawn_worker_process(
        &input,
        &descriptor,
        "worker-plugin-probe",
        transport.identity_hash,
        &transport.route,
        &transport.upstream_key,
        dummy_projection,
    ) {
        Ok(process) => process,
        Err(error) => {
            if model_snapshot.is_some() {
                return Err(safe_runtime_error(&error));
            }
            return Ok(None);
        }
    };
    if let Err(error) = ensure_runtime_initialized(&input, &process.runtime) {
        process.runtime.kill();
        if model_snapshot.is_some() {
            return Err(safe_runtime_error(&error));
        }
        return Ok(None);
    }
    let health = match read_process_health(&process) {
        Ok(health) => health,
        Err(error) => {
            process.runtime.kill();
            if model_snapshot.is_some() {
                return Err(safe_runtime_error(&error));
            }
            return Ok(None);
        }
    };
    if let Ok(mut guard) = plugin_probe().lock() {
        *guard = Some(process);
    }
    Ok(Some(health))
}

fn read_matching_plugin_probe_health(
    model_snapshot: Option<&Value>,
    api_key: Option<&str>,
) -> Result<Option<Value>, String> {
    let desired_identity = match model_snapshot {
        Some(snapshot) => probe_input(Some(snapshot), api_key)
            .and_then(|input| provider_transport(&input))
            .ok()
            .map(|transport| transport.identity_hash),
        None => None,
    };
    if let Some(existing) = current_plugin_probe() {
        if desired_identity
            .as_deref()
            .is_none_or(|identity| identity == existing.identity_hash)
        {
            if let Ok(health) = read_process_health(&existing) {
                return Ok(Some(health));
            }
        }
    }
    Ok(None)
}

/// Reads the public health projection from an idle task worker, or a dedicated
/// plugin-probe worker when the user has not started a task yet.
///
/// A running/cancelling worker is never probed. Callers must treat `None` as
/// "not initialized", not as healthy. Probe spawn failures stay `None` so the
/// plugin view can remain unavailable instead of guessing loaded.
pub fn runtime_health_with_probe(
    conversation_id: Option<&str>,
    allow_probe: bool,
    model_snapshot: Option<&Value>,
    api_key: Option<&str>,
) -> Result<Option<Value>, String> {
    if let Some(conversation_id) = conversation_id
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != PLUGIN_PROBE_CONVERSATION_ID)
    {
        let workers = active()
            .lock()
            .map_err(|_| "Worker 状态锁失败".to_string())?;
        if let Some(worker) = workers.get(conversation_id) {
            if worker.status == "idle" {
                let process = worker
                    .process
                    .lock()
                    .map_err(|_| "Worker 进程锁失败".to_string())?
                    .clone();
                drop(workers);
                if let Some(process) = process {
                    return Ok(Some(read_process_health(&process)?));
                }
            }
        }
    }
    if let Some(health) = read_matching_plugin_probe_health(model_snapshot, api_key)? {
        return Ok(Some(health));
    }
    if allow_probe {
        return ensure_plugin_probe_health(model_snapshot, api_key);
    }
    Ok(None)
}
