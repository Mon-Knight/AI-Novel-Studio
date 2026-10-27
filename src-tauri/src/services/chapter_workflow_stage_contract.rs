//! Frozen input/scope/binding contract for chapter workflow stages.
//!
//! A stage row freezes the user turn, run, plan hashes and stage identity. This
//! module owns the validated DTOs, the active-run scope re-check and the only
//! accepted proof that a real provider request belongs to a stage: an explicit
//! `[CHAPTER_WORKFLOW_BINDING]` object inside decoded `body.messages[].content`.
//! Snapshot metadata and task hints are never accepted as the request proof.

use crate::errors::{codes, AppError};
use crate::repositories::chapter_workflow_stage_repository as repository;
use crate::repositories::chapter_workflow_stage_repository::ChapterWorkflowStageRecord;
use crate::services::ai_fact_security;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::Value;

pub(crate) const WORKFLOW_BINDING_VERSION: i64 = 1;
pub(crate) const BINDING_OPEN_MARKER: &str = "[CHAPTER_WORKFLOW_BINDING]";
pub(crate) const BINDING_CLOSE_MARKER: &str = "[/CHAPTER_WORKFLOW_BINDING]";
pub(crate) const MAX_IDENTITY_UTF8_BYTES: usize = 200;
const MAX_STAGE_KEY_LENGTH: usize = 200;
const ACTIVE_RUN_STATUSES: &[&str] = &["queued", "running"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartChapterWorkflowStageInput {
    pub workflow_id: String,
    pub conversation_id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub run_id: String,
    pub stage_key: String,
    pub stage_kind: String,
    pub scene_id: Option<String>,
    pub beat_id: Option<String>,
    pub plan_version: i64,
    pub context_hash: String,
    pub base_hash: String,
    pub input_hash: String,
    pub plan_hash: String,
    /// Optional assertion checked against the authoritative run model snapshot.
    pub model_snapshot_hash: Option<String>,
    /// Omit to derive `MAX(attempt) + 1` for this workflow and stage key.
    pub attempt: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListChapterWorkflowStagesInput {
    pub novel_id: String,
    pub chapter_id: String,
    pub conversation_id: Option<String>,
    pub workflow_id: Option<String>,
    pub run_id: Option<String>,
    pub stage_key: Option<String>,
    pub stage_kinds: Option<Vec<String>>,
    pub statuses: Option<Vec<String>>,
    pub limit: Option<i64>,
}

#[derive(Debug)]
pub(crate) enum ChapterWorkflowStageOutput {
    /// Exact candidate prose or plan JSON stored in a dedicated large-text document.
    LargeText(String),
    /// Small bounded structured state stored inline.
    BoundedJson(String),
    /// Existing immutable Artifact whose real request proves the workflow binding.
    VerifiedArtifact(String),
}

#[derive(Debug)]
pub(crate) struct CompleteChapterWorkflowStageInput {
    pub stage_id: String,
    pub expected_revision: i64,
    pub expected_result_hash: String,
    pub output: ChapterWorkflowStageOutput,
}

#[derive(Debug)]
pub(crate) struct FailChapterWorkflowStageInput {
    pub stage_id: String,
    pub expected_revision: i64,
    pub error_code: String,
}

#[derive(Debug)]
pub(crate) struct CancelChapterWorkflowStageInput {
    pub stage_id: String,
    pub expected_revision: Option<i64>,
}

pub(crate) struct StageScope {
    pub conversation_id: String,
    pub novel_id: String,
    pub chapter_id: String,
    model_snapshot_json: String,
}

pub(crate) fn input_error(message: impl Into<String>) -> AppError {
    AppError::new(codes::CHAPTER_WORKFLOW_STAGE_INPUT_INVALID, message, false)
}

pub(crate) fn scope_error(message: impl Into<String>) -> AppError {
    AppError::new(codes::CHAPTER_WORKFLOW_STAGE_SCOPE_MISMATCH, message, false)
}

pub(crate) fn conflict_error(message: impl Into<String>) -> AppError {
    AppError::new(codes::CHAPTER_WORKFLOW_STAGE_CONFLICT, message, true)
}

pub(crate) fn terminal_error(stage_id: &str, status: &str) -> AppError {
    AppError::new(
        codes::CHAPTER_WORKFLOW_STAGE_TERMINAL,
        "章节写作阶段已终结，迟到结果不能写入",
        false,
    )
    .with_details(serde_json::json!({ "stageId": stage_id, "status": status }))
}

pub(crate) fn result_invalid(message: impl Into<String>) -> AppError {
    AppError::new(codes::CHAPTER_WORKFLOW_STAGE_RESULT_INVALID, message, false)
}

pub(crate) fn bounded_identifier(value: &str, label: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_IDENTITY_UTF8_BYTES {
        return Err(input_error(format!("{label} 必须是非空且有界的标识")));
    }
    Ok(value.to_string())
}

pub(crate) fn normalized_hash(value: &str, label: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(input_error(format!("{label} 必须是 64 位 SHA-256")));
    }
    Ok(value.to_ascii_lowercase())
}

pub(crate) fn optional_identifier(
    value: Option<&str>,
    label: &str,
) -> Result<Option<String>, AppError> {
    value
        .map(|value| bounded_identifier(value, label))
        .transpose()
}

pub(crate) fn validated_error_code(value: &str) -> Result<String, AppError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > repository::max_error_code_length()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b':'))
    {
        return Err(input_error("阶段错误码必须是有界稳定标识"));
    }
    Ok(value.to_string())
}

fn parse_model_snapshot(raw: &str) -> Result<Value, AppError> {
    let value = serde_json::from_str::<Value>(raw)
        .map_err(|_| input_error("TaskRun 的模型快照不是有效 JSON"))?;
    if !value.is_object() {
        return Err(input_error("TaskRun 的模型快照必须是对象"));
    }
    Ok(value)
}

pub(crate) fn authoritative_model_snapshot_hash(scope: &StageScope) -> Result<String, AppError> {
    let snapshot = parse_model_snapshot(&scope.model_snapshot_json)?;
    ai_fact_security::canonical_hash(&snapshot)
        .map_err(|_| input_error("TaskRun 的模型快照无法生成权威哈希"))
}

fn run_active_error(status: &str) -> AppError {
    match status {
        "cancel_requested" => conflict_error("关联 Run 已请求取消，章节写作阶段不能继续启动或完成"),
        "queued" => conflict_error("关联 Run 尚未进入 running，完成结果必须等待 Run 启动"),
        _ => conflict_error("关联 Run 已终结，章节写作阶段不能继续启动或完成"),
    }
}

fn ensure_run_active(status: &str) -> Result<(), AppError> {
    if ACTIVE_RUN_STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(run_active_error(status))
    }
}

fn conversation_archived(archived_at: Option<&str>, status: &str) -> bool {
    archived_at.is_some() || status == "archived"
}

pub(crate) fn validate_start_input(input: &StartChapterWorkflowStageInput) -> Result<(), AppError> {
    bounded_identifier(&input.workflow_id, "workflowId")?;
    bounded_identifier(&input.conversation_id, "conversationId")?;
    bounded_identifier(&input.novel_id, "novelId")?;
    bounded_identifier(&input.chapter_id, "chapterId")?;
    bounded_identifier(&input.run_id, "runId")?;
    let stage_key = input.stage_key.trim();
    if stage_key.is_empty() || stage_key.len() > MAX_STAGE_KEY_LENGTH {
        return Err(input_error("stageKey 必须是非空且有界的稳定标识"));
    }
    if !repository::supported_stage_kind(input.stage_kind.trim()) {
        return Err(input_error("stageKind 不受支持"));
    }
    optional_identifier(input.scene_id.as_deref(), "sceneId")?;
    optional_identifier(input.beat_id.as_deref(), "beatId")?;
    if input.plan_version < 1 {
        return Err(input_error("planVersion 必须是正整数"));
    }
    normalized_hash(&input.context_hash, "contextHash")?;
    normalized_hash(&input.base_hash, "baseHash")?;
    normalized_hash(&input.input_hash, "inputHash")?;
    normalized_hash(&input.plan_hash, "planHash")?;
    if let Some(hash) = input.model_snapshot_hash.as_deref() {
        normalized_hash(hash, "modelSnapshotHash")?;
    }
    Ok(())
}

pub(crate) fn load_scope(
    connection: &Connection,
    input: &StartChapterWorkflowStageInput,
) -> Result<StageScope, AppError> {
    let workflow_id = bounded_identifier(&input.workflow_id, "workflowId")?;
    let conversation_id = bounded_identifier(&input.conversation_id, "conversationId")?;
    let novel_id = bounded_identifier(&input.novel_id, "novelId")?;
    let chapter_id = bounded_identifier(&input.chapter_id, "chapterId")?;
    let run_id = bounded_identifier(&input.run_id, "runId")?;

    let (turn_conversation, role, conversation_novel, archived_at, conversation_status): (
        String,
        String,
        String,
        Option<String>,
        String,
    ) = connection
        .query_row(
            "SELECT t.conversation_id, t.role, c.novel_id, c.archived_at, c.status
             FROM conversation_turns t
             JOIN task_conversations c ON c.conversation_id = t.conversation_id
             WHERE t.turn_id = ?1",
            params![workflow_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| scope_error("workflowId 必须指向既有任务回合"))?;
    if turn_conversation != conversation_id || role != "user" || conversation_novel != novel_id {
        return Err(scope_error(
            "workflowId、conversationId、novelId 的作用域不一致",
        ));
    }
    if conversation_archived(archived_at.as_deref(), &conversation_status) {
        return Err(scope_error("任务对话已归档，不能新启动章节写作阶段"));
    }

    let (chapter_novel, chapter_deleted): (String, Option<String>) = connection
        .query_row(
            "SELECT novel_id, deleted_at FROM chapters WHERE id = ?1",
            params![chapter_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| scope_error("chapterId 必须指向既有章节"))?;
    if chapter_novel != novel_id || chapter_deleted.is_some() {
        return Err(scope_error("章节不属于该作品或已删除"));
    }
    let novel_deleted: Option<Option<String>> = connection
        .query_row(
            "SELECT deleted_at FROM novels WHERE id = ?1",
            params![novel_id],
            |row| Ok(row.get(0)?),
        )
        .optional()
        .map_err(AppError::database)?;
    match novel_deleted {
        Some(None) => {}
        _ => return Err(scope_error("作品不存在或已删除")),
    }

    let (run_turn, run_conversation, run_chapter, run_status, model_snapshot_json): (
        String,
        String,
        Option<String>,
        String,
        String,
    ) = connection
        .query_row(
            "SELECT turn_id, conversation_id, chapter_id, status, model_snapshot_json
             FROM task_runs WHERE run_id = ?1",
            params![run_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| scope_error("runId 必须指向既有运行"))?;
    if run_turn != workflow_id
        || run_conversation != conversation_id
        || run_chapter.as_deref() != Some(chapter_id.as_str())
    {
        return Err(scope_error("runId 不是该用户回合在目标章节的一次尝试"));
    }
    ensure_run_active(&run_status)?;

    Ok(StageScope {
        conversation_id,
        novel_id,
        chapter_id,
        model_snapshot_json,
    })
}

/// Stage writes may only proceed while the authoritative run is active and its
/// conversation/targets still exist. Start/begin accept a prepared `queued` or
/// `running` run; completion requires `running` and therefore rejects a run
/// that failed, was cancelled, or only requested cancellation while the stage
/// row still says `running`.
pub(crate) fn assert_active_run(
    connection: &Connection,
    stage: &ChapterWorkflowStageRecord,
    require_running: bool,
) -> Result<(), AppError> {
    let (run_status, archived_at, conversation_status, chapter_deleted, novel_deleted): (
        String,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
    ) = connection
        .query_row(
            "SELECT r.status, c.archived_at, c.status, ch.deleted_at, n.deleted_at
             FROM task_runs r
             JOIN task_conversations c
               ON c.conversation_id = r.conversation_id AND c.novel_id = ?1
             JOIN chapters ch ON ch.id = ?5 AND ch.novel_id = ?1
             JOIN novels n ON n.id = ?1
             WHERE r.run_id = ?2 AND r.turn_id = ?3
               AND r.conversation_id = ?4 AND r.chapter_id = ?5",
            params![
                stage.novel_id,
                stage.run_id,
                stage.workflow_id,
                stage.conversation_id,
                stage.chapter_id,
            ],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| conflict_error("章节写作阶段关联的 Run 或目标已不存在"))?;
    let active = if require_running {
        run_status == "running"
    } else {
        ACTIVE_RUN_STATUSES.contains(&run_status.as_str())
    };
    if !active {
        return Err(run_active_error(&run_status));
    }
    if conversation_archived(archived_at.as_deref(), &conversation_status) {
        return Err(conflict_error("任务对话已归档，章节写作阶段不能继续"));
    }
    if chapter_deleted.is_some() || novel_deleted.is_some() {
        return Err(conflict_error("章节写作阶段的目标章节或作品已删除"));
    }
    Ok(())
}

pub(crate) fn binding_matches(binding: &Value, stage: &ChapterWorkflowStageRecord) -> bool {
    binding.as_object().is_some_and(|fields| {
        fields.len() == 5
            && fields.contains_key("schemaVersion")
            && fields.contains_key("workflowId")
            && fields.contains_key("stageKey")
            && fields.contains_key("inputHash")
            && fields.contains_key("planHash")
    }) && binding.get("schemaVersion").and_then(Value::as_i64) == Some(WORKFLOW_BINDING_VERSION)
        && binding.get("workflowId").and_then(Value::as_str) == Some(stage.workflow_id.as_str())
        && binding.get("stageKey").and_then(Value::as_str) == Some(stage.stage_key.as_str())
        && binding.get("inputHash").and_then(Value::as_str) == Some(stage.input_hash.as_str())
        && binding.get("planHash").and_then(Value::as_str) == Some(stage.plan_hash.as_str())
}

/// Extract the single explicit binding block from one decoded message content.
///
/// Marker tokens are literal. Escaped JSON, a missing/duplicated marker, or a
/// non-object segment fails closed rather than falling back to a text search.
fn binding_from_message(content: &str) -> Result<Option<Value>, AppError> {
    let opens = content.matches(BINDING_OPEN_MARKER).count();
    let closes = content.matches(BINDING_CLOSE_MARKER).count();
    if opens == 0 && closes == 0 {
        return Ok(None);
    }
    if opens != 1 || closes != 1 {
        return Err(result_invalid(
            "真实请求中出现不完整或重复的 CHAPTER_WORKFLOW_BINDING 标记",
        ));
    }
    let start = content
        .find(BINDING_OPEN_MARKER)
        .map(|index| index + BINDING_OPEN_MARKER.len())
        .ok_or_else(|| result_invalid("真实请求缺少 CHAPTER_WORKFLOW_BINDING 起始标记"))?;
    let end = content
        .find(BINDING_CLOSE_MARKER)
        .ok_or_else(|| result_invalid("真实请求缺少 CHAPTER_WORKFLOW_BINDING 结束标记"))?;
    if end < start {
        return Err(result_invalid(
            "真实请求的 CHAPTER_WORKFLOW_BINDING 标记顺序无效",
        ));
    }
    let binding = serde_json::from_str::<Value>(content[start..end].trim()).map_err(|_| {
        result_invalid("真实请求的 CHAPTER_WORKFLOW_BINDING 段不是解码后的 JSON 对象")
    })?;
    if !binding.is_object() {
        return Err(result_invalid(
            "真实请求的 CHAPTER_WORKFLOW_BINDING 段必须是 JSON 对象",
        ));
    }
    Ok(Some(binding))
}

/// Verify the decoded real request messages. Only `body.messages[].content` is
/// inspected: metadata, task hints and arbitrary nested objects are not proof.
pub(crate) fn verify_request_messages_binding(
    body: &Value,
    stage: &ChapterWorkflowStageRecord,
) -> Result<(), AppError> {
    let messages = body
        .get("messages")
        .and_then(Value::as_array)
        .ok_or_else(|| result_invalid("真实请求材料缺少解码后的 messages 数组"))?;
    let mut matched = false;
    for message in messages {
        let Some(content) = message.get("content").and_then(Value::as_str) else {
            continue;
        };
        let Some(binding) = binding_from_message(content)? else {
            continue;
        };
        if !binding_matches(&binding, stage) {
            return Err(result_invalid(
                "真实请求中的 CHAPTER_WORKFLOW_BINDING 与当前阶段不一致",
            ));
        }
        matched = true;
    }
    if !matched {
        return Err(result_invalid(
            "真实请求 messages 未包含当前阶段的 CHAPTER_WORKFLOW_BINDING",
        ));
    }
    Ok(())
}
