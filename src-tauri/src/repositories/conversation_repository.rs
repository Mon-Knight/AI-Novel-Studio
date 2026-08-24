use crate::errors::AppError;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskConversationRecord {
    pub conversation_id: String,
    pub novel_id: String,
    pub title: String,
    pub status: String,
    pub default_model: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationTurnRecord {
    pub turn_id: String,
    pub conversation_id: String,
    pub sequence: i64,
    pub role: String,
    pub content: String,
    pub run_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunRecord {
    pub run_id: String,
    pub conversation_id: String,
    pub turn_id: String,
    pub status: String,
    pub model_snapshot: Value,
    pub worker_id: String,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallEventRecord {
    pub event_id: String,
    pub run_id: String,
    pub call_id: Option<String>,
    pub sequence: i64,
    pub tool_name: String,
    pub arguments_summary: Value,
    pub status: String,
    pub duration_ms: Option<i64>,
    pub error: Option<String>,
    pub result: Option<Value>,
    pub created_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationArtifactCardRecord {
    pub card_id: String,
    pub conversation_id: String,
    pub turn_id: Option<String>,
    pub run_id: Option<String>,
    pub artifact_id: Option<String>,
    pub artifact_type: String,
    pub title: String,
    pub summary: String,
    pub content: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskConversationBundle {
    pub conversation: TaskConversationRecord,
    pub turns: Vec<ConversationTurnRecord>,
    pub runs: Vec<TaskRunRecord>,
    pub tool_events: Vec<ToolCallEventRecord>,
    pub artifacts: Vec<ConversationArtifactCardRecord>,
    pub decisions: Vec<ArtifactDecisionRecord>,
    pub authorizations: Vec<ReviewAuthorizationRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactDecisionRecord {
    pub decision_id: String,
    pub artifact_id: String,
    pub artifact_hash: String,
    pub card_id: String,
    pub conversation_id: String,
    pub decision: String,
    pub idempotency_key: String,
    pub actor: String,
    pub target_type: String,
    pub target_id: String,
    pub base_revision: Option<String>,
    pub apply_transaction_id: Option<String>,
    pub conflict_code: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewAuthorizationRecord {
    pub authorization_id: String,
    pub artifact_id: String,
    pub chapter_id: String,
    pub novel_id: String,
    pub decision_id: String,
    pub status: String,
    pub issued_at: String,
    pub consumed_at: Option<String>,
    pub consumed_by_draft_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConversationInput {
    pub conversation_id: String,
    pub novel_id: String,
    pub title: String,
    pub default_model: Option<Value>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendTurnInput {
    pub turn_id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConversationModelInput {
    pub conversation_id: String,
    pub default_model: Value,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRunInput {
    pub run_id: String,
    pub conversation_id: String,
    pub turn_id: String,
    pub model_snapshot: Value,
    pub worker_id: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRunInput {
    pub run_id: String,
    pub status: String,
    pub error: Option<String>,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendToolEventInput {
    pub event_id: String,
    pub run_id: String,
    pub tool_name: String,
    pub arguments_summary: Value,
    pub status: String,
    pub duration_ms: Option<i64>,
    pub error: Option<String>,
    pub result: Option<Value>,
    pub created_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateToolEventInput {
    pub event_id: String,
    pub status: String,
    pub duration_ms: Option<i64>,
    pub error: Option<String>,
    pub result: Option<Value>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateArtifactCardInput {
    pub card_id: String,
    pub conversation_id: String,
    pub turn_id: Option<String>,
    pub run_id: Option<String>,
    pub artifact_id: Option<String>,
    pub artifact_type: String,
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub content: Option<String>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverRunsInput {
    pub finished_at: String,
    pub error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordArtifactDecisionInput {
    pub decision_id: String,
    pub artifact_id: String,
    pub artifact_hash: String,
    pub card_id: String,
    pub conversation_id: String,
    pub decision: String,
    pub idempotency_key: String,
    pub actor: String,
    pub target_type: String,
    pub target_id: String,
    pub base_revision: Option<String>,
    #[serde(default)]
    pub apply_transaction_id: Option<String>,
    #[serde(default)]
    pub conflict_code: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsumeReviewAuthorizationInput {
    pub authorization_id: String,
    pub draft_id: String,
    pub consumed_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptReviewAuthorizedDraftInput {
    pub authorization_id: String,
    pub draft_id: String,
    pub expected_draft_version: i64,
    pub expected_content_hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptReviewAuthorizedDraftResult {
    pub authorization: ReviewAuthorizationRecord,
    pub adopted_draft: crate::domain::writing::ChapterDraftDto,
}

fn parse_json(raw: Option<String>) -> Option<Value> {
    raw.and_then(|value| serde_json::from_str(&value).ok())
}

fn json_text(value: &Value) -> Result<String, AppError> {
    serde_json::to_string(value).map_err(|_| {
        AppError::new(
            "CONVERSATION_JSON_INVALID",
            "任务对话 JSON 无法序列化",
            false,
        )
    })
}

fn task_run_transition_allowed(from: &str, to: &str) -> bool {
    from == to
        || matches!(
            (from, to),
            (
                "queued",
                "running" | "failed" | "cancel_requested" | "cancelled"
            ) | (
                "running",
                "completed" | "failed" | "cancel_requested" | "cancelled"
            ) | ("cancel_requested", "completed" | "failed" | "cancelled")
        )
}

fn tool_event_transition_allowed(from: &str, to: &str) -> bool {
    from == to
        || matches!(
            (from, to),
            (
                "pending" | "queued",
                "queued" | "running" | "succeeded" | "failed" | "cancelled" | "skipped"
            ) | ("running", "succeeded" | "failed" | "cancelled" | "skipped")
        )
}

fn terminal_task_run(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled")
}

fn terminal_tool_event(status: &str) -> bool {
    matches!(status, "succeeded" | "failed" | "cancelled" | "skipped")
}

fn conversation_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskConversationRecord> {
    Ok(TaskConversationRecord {
        conversation_id: row.get(0)?,
        novel_id: row.get(1)?,
        title: row.get(2)?,
        status: row.get(3)?,
        default_model: parse_json(row.get(4)?),
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        archived_at: row.get(7)?,
    })
}

fn turn_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConversationTurnRecord> {
    Ok(ConversationTurnRecord {
        turn_id: row.get(0)?,
        conversation_id: row.get(1)?,
        sequence: row.get(2)?,
        role: row.get(3)?,
        content: row.get(4)?,
        run_id: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn run_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskRunRecord> {
    let raw: String = row.get(4)?;
    Ok(TaskRunRecord {
        run_id: row.get(0)?,
        conversation_id: row.get(1)?,
        turn_id: row.get(2)?,
        status: row.get(3)?,
        model_snapshot: serde_json::from_str(&raw).unwrap_or(Value::Null),
        worker_id: row.get(5)?,
        error: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        started_at: row.get(9)?,
        finished_at: row.get(10)?,
    })
}

fn event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ToolCallEventRecord> {
    let args: String = row.get(4)?;
    let result: Option<String> = row.get(8)?;
    Ok(ToolCallEventRecord {
        event_id: row.get(0)?,
        run_id: row.get(1)?,
        call_id: row.get(11)?,
        sequence: row.get(2)?,
        tool_name: row.get(3)?,
        arguments_summary: serde_json::from_str(&args).unwrap_or(Value::Null),
        status: row.get(5)?,
        duration_ms: row.get(6)?,
        error: row.get(7)?,
        result: result.and_then(|value| serde_json::from_str(&value).ok()),
        created_at: row.get(9)?,
        finished_at: row.get(10)?,
    })
}

fn artifact_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConversationArtifactCardRecord> {
    Ok(ConversationArtifactCardRecord {
        card_id: row.get(0)?,
        conversation_id: row.get(1)?,
        turn_id: row.get(2)?,
        run_id: row.get(3)?,
        artifact_id: row.get(4)?,
        artifact_type: row.get(5)?,
        title: row.get(6)?,
        summary: row.get(7)?,
        content: row.get(8)?,
        status: row.get(9)?,
        created_at: row.get(10)?,
    })
}

pub fn create_conversation(
    connection: &mut Connection,
    input: CreateConversationInput,
) -> Result<TaskConversationRecord, AppError> {
    connection.execute(
        "INSERT INTO task_conversations (conversation_id, novel_id, title, status, default_model_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'idle', ?4, ?5, ?5)",
        params![input.conversation_id, input.novel_id, input.title, input.default_model.map(|v| json_text(&v)).transpose()?, input.created_at],
    ).map_err(AppError::database)?;
    get_conversation(connection, &input.conversation_id)?
        .ok_or_else(|| AppError::new("CONVERSATION_NOT_FOUND", "任务对话创建后无法读取", false))
}

pub fn list_conversations(
    connection: &Connection,
    novel_id: Option<&str>,
    limit: i64,
) -> Result<Vec<TaskConversationRecord>, AppError> {
    let mut statement = if novel_id.is_some() {
        connection.prepare("SELECT conversation_id, novel_id, title, status, default_model_json, created_at, updated_at, archived_at FROM task_conversations WHERE novel_id=?1 AND status <> 'archived' ORDER BY updated_at DESC LIMIT ?2")
    } else {
        connection.prepare("SELECT conversation_id, novel_id, title, status, default_model_json, created_at, updated_at, archived_at FROM task_conversations WHERE status <> 'archived' ORDER BY updated_at DESC LIMIT ?1")
    }.map_err(AppError::database)?;
    let rows = if let Some(novel_id) = novel_id {
        statement.query_map(
            params![novel_id, limit.clamp(1, 500)],
            conversation_from_row,
        )
    } else {
        statement.query_map(params![limit.clamp(1, 500)], conversation_from_row)
    }
    .map_err(AppError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

pub fn get_conversation(
    connection: &Connection,
    id: &str,
) -> Result<Option<TaskConversationRecord>, AppError> {
    connection.query_row("SELECT conversation_id, novel_id, title, status, default_model_json, created_at, updated_at, archived_at FROM task_conversations WHERE conversation_id=?1", params![id], conversation_from_row).optional().map_err(AppError::database)
}

pub fn update_conversation_model(
    connection: &mut Connection,
    input: UpdateConversationModelInput,
) -> Result<TaskConversationRecord, AppError> {
    let model = json_text(&input.default_model)?;
    let changed = connection
        .execute(
            "UPDATE task_conversations SET default_model_json=?2, updated_at=?3 WHERE conversation_id=?1",
            params![input.conversation_id, model, input.updated_at],
        )
        .map_err(AppError::database)?;
    if changed == 0 {
        return Err(AppError::new(
            "CONVERSATION_NOT_FOUND",
            "任务对话不存在",
            false,
        ));
    }
    get_conversation(connection, &input.conversation_id)?
        .ok_or_else(|| AppError::new("CONVERSATION_NOT_FOUND", "任务对话更新后无法读取", false))
}

pub fn append_turn(
    connection: &mut Connection,
    input: AppendTurnInput,
) -> Result<ConversationTurnRecord, AppError> {
    let tx = connection.transaction().map_err(AppError::database)?;
    let sequence: i64 = tx.query_row("SELECT COALESCE(MAX(sequence), -1) + 1 FROM conversation_turns WHERE conversation_id=?1", params![input.conversation_id], |row| row.get(0)).map_err(AppError::database)?;
    tx.execute("INSERT INTO conversation_turns (turn_id, conversation_id, sequence, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params![input.turn_id, input.conversation_id, sequence, input.role, input.content, input.created_at]).map_err(AppError::database)?;
    let current_title: String = tx
        .query_row(
            "SELECT title FROM task_conversations WHERE conversation_id=?1",
            params![input.conversation_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    let next_title = if input.role == "user"
        && matches!(current_title.as_str(), "新的创作任务" | "未命名任务")
    {
        let trimmed = input.content.trim();
        let title: String = trimmed.chars().take(40).collect();
        if title.is_empty() {
            current_title
        } else {
            title
        }
    } else {
        current_title
    };
    tx.execute(
        "UPDATE task_conversations SET updated_at=?2, status=CASE WHEN ?3='user' THEN 'idle' ELSE status END, title=?4 WHERE conversation_id=?1",
        params![input.conversation_id, input.created_at, input.role, next_title],
    )
    .map_err(AppError::database)?;
    let row = tx.query_row("SELECT turn_id, conversation_id, sequence, role, content, run_id, created_at FROM conversation_turns WHERE turn_id=?1", params![input.turn_id], turn_from_row).map_err(AppError::database)?;
    tx.commit().map_err(AppError::database)?;
    Ok(row)
}

pub fn append_runtime_assistant_turn(
    connection: &mut Connection,
    turn_id: &str,
    conversation_id: &str,
    run_id: &str,
    content: &str,
    created_at: &str,
) -> Result<ConversationTurnRecord, AppError> {
    let transaction = connection.transaction().map_err(AppError::database)?;
    if let Some(existing) = transaction
        .query_row(
            "SELECT turn_id, conversation_id, sequence, role, content, run_id, created_at
             FROM conversation_turns WHERE turn_id=?1",
            params![turn_id],
            turn_from_row,
        )
        .optional()
        .map_err(AppError::database)?
    {
        if existing.conversation_id == conversation_id
            && existing.run_id.as_deref() == Some(run_id)
            && existing.role == "assistant"
            && existing.content == content
        {
            transaction.commit().map_err(AppError::database)?;
            return Ok(existing);
        }
        return Err(AppError::new(
            "CONVERSATION_TURN_ID_CONFLICT",
            "DSH 消息事件与已有回合身份冲突",
            false,
        ));
    }
    let scoped_run: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM task_runs WHERE run_id=?1 AND conversation_id=?2)",
            params![run_id, conversation_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if !scoped_run {
        return Err(AppError::new(
            "TASK_RUN_SCOPE_MISMATCH",
            "DSH 消息事件不属于当前任务运行",
            false,
        ));
    }
    let sequence: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(sequence), -1) + 1 FROM conversation_turns WHERE conversation_id=?1",
            params![conversation_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "INSERT INTO conversation_turns
                (turn_id, conversation_id, sequence, role, content, run_id, created_at)
             VALUES (?1, ?2, ?3, 'assistant', ?4, ?5, ?6)",
            params![
                turn_id,
                conversation_id,
                sequence,
                content,
                run_id,
                created_at
            ],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "UPDATE task_conversations SET updated_at=?2 WHERE conversation_id=?1",
            params![conversation_id, created_at],
        )
        .map_err(AppError::database)?;
    let record = transaction
        .query_row(
            "SELECT turn_id, conversation_id, sequence, role, content, run_id, created_at
             FROM conversation_turns WHERE turn_id=?1",
            params![turn_id],
            turn_from_row,
        )
        .map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(record)
}

pub fn create_run(
    connection: &mut Connection,
    input: CreateRunInput,
) -> Result<TaskRunRecord, AppError> {
    if !input.model_snapshot.is_object() {
        return Err(AppError::new(
            "TASK_RUN_MODEL_INVALID",
            "任务运行模型快照必须是对象",
            false,
        ));
    }
    let snapshot = json_text(&input.model_snapshot)?;
    let transaction = connection.transaction().map_err(AppError::database)?;
    let scoped_turn: bool = transaction
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM conversation_turns
                WHERE turn_id=?1 AND conversation_id=?2 AND role='user'
            )",
            params![input.turn_id, input.conversation_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if !scoped_turn {
        return Err(AppError::new(
            "TASK_RUN_SCOPE_MISMATCH",
            "任务运行必须绑定同一任务中的用户回合",
            false,
        ));
    }
    transaction
        .execute("INSERT INTO task_runs (run_id, conversation_id, turn_id, status, model_snapshot_json, worker_id, created_at, updated_at) VALUES (?1, ?2, ?3, 'queued', ?4, ?5, ?6, ?6)", params![input.run_id, input.conversation_id, input.turn_id, snapshot, input.worker_id, input.created_at])
        .map_err(AppError::database)?;
    transaction
        .execute("UPDATE task_conversations SET status='running', updated_at=?2 WHERE conversation_id=?1", params![input.conversation_id, input.created_at])
        .map_err(AppError::database)?;
    let run = get_run(&transaction, &input.run_id)?
        .ok_or_else(|| AppError::new("TASK_RUN_NOT_FOUND", "运行创建后无法读取", false))?;
    transaction.commit().map_err(AppError::database)?;
    Ok(run)
}

pub fn get_run(connection: &Connection, id: &str) -> Result<Option<TaskRunRecord>, AppError> {
    connection.query_row("SELECT run_id, conversation_id, turn_id, status, model_snapshot_json, worker_id, error, created_at, updated_at, started_at, finished_at FROM task_runs WHERE run_id=?1", params![id], run_from_row).optional().map_err(AppError::database)
}

pub fn update_run(
    connection: &mut Connection,
    input: UpdateRunInput,
) -> Result<TaskRunRecord, AppError> {
    if ![
        "queued",
        "running",
        "completed",
        "failed",
        "cancel_requested",
        "cancelled",
    ]
    .contains(&input.status.as_str())
    {
        return Err(AppError::new(
            "TASK_RUN_STATUS_INVALID",
            "任务运行状态无效",
            false,
        ));
    }
    let transaction = connection.transaction().map_err(AppError::database)?;
    let current = get_run(&transaction, &input.run_id)?
        .ok_or_else(|| AppError::new("TASK_RUN_NOT_FOUND", "任务运行不存在", false))?;
    if terminal_task_run(&current.status) {
        if current.status == input.status
            && input.error.is_none()
            && input.started_at.is_none()
            && input.finished_at.is_none()
        {
            transaction.commit().map_err(AppError::database)?;
            return Ok(current);
        }
        return Err(AppError::new(
            "TASK_RUN_TERMINAL",
            "已结束的任务运行不可改写",
            false,
        ));
    }
    if !task_run_transition_allowed(&current.status, &input.status) {
        return Err(AppError::new(
            "TASK_RUN_STATUS_EDGE_INVALID",
            "任务运行状态迁移无效",
            false,
        ));
    }
    transaction
        .execute("UPDATE task_runs SET status=?2, error=?3, updated_at=?4, started_at=COALESCE(?5, started_at), finished_at=?6 WHERE run_id=?1", params![input.run_id, input.status, input.error, input.updated_at, input.started_at, input.finished_at])
        .map_err(AppError::database)?;
    let run = get_run(&transaction, &input.run_id)?
        .ok_or_else(|| AppError::new("TASK_RUN_NOT_FOUND", "任务运行不存在", false))?;
    if terminal_task_run(&run.status) {
        transaction
            .execute(
                "UPDATE task_conversations SET status=?2, updated_at=?3 WHERE conversation_id=?1",
                params![
                    run.conversation_id,
                    if run.status == "completed" {
                        "completed"
                    } else if run.status == "failed" {
                        "failed"
                    } else {
                        "idle"
                    },
                    input.updated_at
                ],
            )
            .map_err(AppError::database)?;
    }
    transaction.commit().map_err(AppError::database)?;
    Ok(run)
}

pub fn append_tool_event(
    connection: &mut Connection,
    input: AppendToolEventInput,
) -> Result<ToolCallEventRecord, AppError> {
    if !["pending", "queued", "running"].contains(&input.status.as_str()) {
        return Err(AppError::new(
            "TOOL_EVENT_STATUS_INVALID",
            "工具调用初始状态无效",
            false,
        ));
    }
    if !input.arguments_summary.is_object() {
        return Err(AppError::new(
            "TOOL_EVENT_ARGUMENTS_INVALID",
            "工具调用参数摘要必须是对象",
            false,
        ));
    }
    if input.duration_ms.is_some_and(|value| value < 0) {
        return Err(AppError::new(
            "TOOL_EVENT_DURATION_INVALID",
            "工具调用耗时不能为负数",
            false,
        ));
    }
    let transaction = connection.transaction().map_err(AppError::database)?;
    let run_status: Option<String> = transaction
        .query_row(
            "SELECT status FROM task_runs WHERE run_id=?1",
            params![input.run_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)?;
    let Some(run_status) = run_status else {
        return Err(AppError::new("TASK_RUN_NOT_FOUND", "任务运行不存在", false));
    };
    if terminal_task_run(&run_status) {
        return Err(AppError::new(
            "TASK_RUN_TERMINAL",
            "已结束的任务运行不能追加工具调用",
            false,
        ));
    }
    let sequence: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(sequence), -1) + 1 FROM tool_call_events WHERE run_id=?1",
            params![input.run_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    let args = json_text(&input.arguments_summary)?;
    let result = input.result.as_ref().map(json_text).transpose()?;
    let call_id = input
        .arguments_summary
        .get("callId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    transaction.execute("INSERT INTO tool_call_events (event_id, run_id, sequence, tool_name, arguments_summary_json, status, duration_ms, error, result_json, created_at, finished_at, call_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)", params![input.event_id, input.run_id, sequence, input.tool_name, args, input.status, input.duration_ms, input.error, result, input.created_at, input.finished_at, call_id]).map_err(AppError::database)?;
    transaction.execute("UPDATE task_conversations SET updated_at=?2 WHERE conversation_id=(SELECT conversation_id FROM task_runs WHERE run_id=?1)", params![input.run_id, input.created_at]).map_err(AppError::database)?;
    let event = transaction.query_row("SELECT event_id, run_id, sequence, tool_name, arguments_summary_json, status, duration_ms, error, result_json, created_at, finished_at, call_id FROM tool_call_events WHERE event_id=?1", params![input.event_id], event_from_row).map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(event)
}

pub fn update_tool_event(
    connection: &mut Connection,
    input: UpdateToolEventInput,
) -> Result<ToolCallEventRecord, AppError> {
    if ![
        "pending",
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
        "skipped",
    ]
    .contains(&input.status.as_str())
    {
        return Err(AppError::new(
            "TOOL_EVENT_STATUS_INVALID",
            "工具调用状态无效",
            false,
        ));
    }
    if input.duration_ms.is_some_and(|value| value < 0) {
        return Err(AppError::new(
            "TOOL_EVENT_DURATION_INVALID",
            "工具调用耗时不能为负数",
            false,
        ));
    }
    let result = input.result.as_ref().map(json_text).transpose()?;
    let transaction = connection.transaction().map_err(AppError::database)?;
    let current = transaction
        .query_row("SELECT event_id, run_id, sequence, tool_name, arguments_summary_json, status, duration_ms, error, result_json, created_at, finished_at, call_id FROM tool_call_events WHERE event_id=?1", params![input.event_id], event_from_row)
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| AppError::new("TOOL_EVENT_NOT_FOUND", "工具调用事件不存在", false))?;
    if terminal_tool_event(&current.status) {
        if current.status == input.status
            && input.duration_ms.is_none()
            && input.error.is_none()
            && input.result.is_none()
            && input.finished_at.is_none()
        {
            transaction.commit().map_err(AppError::database)?;
            return Ok(current);
        }
        return Err(AppError::new(
            "TOOL_EVENT_TERMINAL",
            "已结束的工具调用不可改写",
            false,
        ));
    }
    if !tool_event_transition_allowed(&current.status, &input.status) {
        return Err(AppError::new(
            "TOOL_EVENT_STATUS_EDGE_INVALID",
            "工具调用状态迁移无效",
            false,
        ));
    }
    if terminal_tool_event(&input.status) && input.finished_at.is_none() {
        return Err(AppError::new(
            "TOOL_EVENT_FINISH_TIME_REQUIRED",
            "工具调用终态必须记录完成时间",
            false,
        ));
    }
    transaction.execute("UPDATE tool_call_events SET status=?2, duration_ms=COALESCE(?3, duration_ms), error=COALESCE(?4, error), result_json=COALESCE(?5, result_json), finished_at=COALESCE(?6, finished_at) WHERE event_id=?1", params![input.event_id, input.status, input.duration_ms, input.error, result, input.finished_at]).map_err(AppError::database)?;
    let event = transaction.query_row("SELECT event_id, run_id, sequence, tool_name, arguments_summary_json, status, duration_ms, error, result_json, created_at, finished_at, call_id FROM tool_call_events WHERE event_id=?1", params![input.event_id], event_from_row).map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(event)
}

pub fn get_tool_event_by_call_id(
    connection: &Connection,
    run_id: &str,
    call_id: &str,
) -> Result<Option<ToolCallEventRecord>, AppError> {
    connection
        .query_row(
            "SELECT event_id, run_id, sequence, tool_name, arguments_summary_json, status,
                    duration_ms, error, result_json, created_at, finished_at, call_id
             FROM tool_call_events WHERE run_id=?1 AND call_id=?2",
            params![run_id, call_id],
            event_from_row,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn terminalize_open_tool_events(
    connection: &mut Connection,
    run_id: &str,
    status: &str,
    error: &str,
    finished_at: &str,
) -> Result<i64, AppError> {
    let changed = connection
        .execute(
            "UPDATE tool_call_events
             SET status=?2, error=COALESCE(error, ?3), finished_at=?4
             WHERE run_id=?1 AND status IN ('pending','queued','running')",
            params![run_id, status, error, finished_at],
        )
        .map_err(AppError::database)?;
    Ok(changed as i64)
}

pub fn create_artifact_card(
    connection: &mut Connection,
    input: CreateArtifactCardInput,
) -> Result<ConversationArtifactCardRecord, AppError> {
    if !["candidate", "confirmed", "rejected"].contains(&input.status.as_str()) {
        return Err(AppError::new(
            "ARTIFACT_STATUS_INVALID",
            "候选产物状态无效",
            false,
        ));
    }
    if input.artifact_id.is_none() {
        return Err(AppError::new(
            "ARTIFACT_REFERENCE_REQUIRED",
            "对话产物卡片必须引用 ResultArtifact",
            false,
        ));
    }
    if input
        .content
        .as_deref()
        .is_some_and(|content| !content.is_empty())
    {
        return Err(AppError::new(
            "ARTIFACT_PROJECTION_CONTENT_FORBIDDEN",
            "对话产物卡片不得保存候选正文",
            false,
        ));
    }
    let transaction = connection.transaction().map_err(AppError::database)?;
    let conversation_exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM task_conversations WHERE conversation_id=?1)",
            params![input.conversation_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if !conversation_exists {
        return Err(AppError::new(
            "CONVERSATION_NOT_FOUND",
            "任务对话不存在",
            false,
        ));
    }
    if let Some(turn_id) = input.turn_id.as_deref() {
        let valid: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM conversation_turns WHERE turn_id=?1 AND conversation_id=?2)",
                params![turn_id, input.conversation_id],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        if !valid {
            return Err(AppError::new(
                "ARTIFACT_SCOPE_MISMATCH",
                "产物卡片回合不属于当前任务",
                false,
            ));
        }
    }
    if let Some(run_id) = input.run_id.as_deref() {
        let valid: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM task_runs WHERE run_id=?1 AND conversation_id=?2)",
                params![run_id, input.conversation_id],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        if !valid {
            return Err(AppError::new(
                "ARTIFACT_SCOPE_MISMATCH",
                "产物卡片运行不属于当前任务",
                false,
            ));
        }
        if let Some(turn_id) = input.turn_id.as_deref() {
            let valid: bool = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM task_runs WHERE run_id=?1 AND turn_id=?2)",
                    params![run_id, turn_id],
                    |row| row.get(0),
                )
                .map_err(AppError::database)?;
            if !valid {
                return Err(AppError::new(
                    "ARTIFACT_SCOPE_MISMATCH",
                    "产物卡片回合与运行不匹配",
                    false,
                ));
            }
        }
    }
    transaction.execute("INSERT INTO conversation_artifact_cards (card_id, conversation_id, turn_id, run_id, artifact_id, artifact_type, title, summary, content, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, '', ?9, ?10)", params![input.card_id, input.conversation_id, input.turn_id, input.run_id, input.artifact_id, input.artifact_type, input.title, input.summary, input.status, input.created_at]).map_err(AppError::database)?;
    transaction
        .execute(
            "UPDATE task_conversations SET updated_at=?2 WHERE conversation_id=?1",
            params![input.conversation_id, input.created_at],
        )
        .map_err(AppError::database)?;
    let artifact = transaction.query_row("SELECT card_id, conversation_id, turn_id, run_id, artifact_id, artifact_type, title, summary, content, status, created_at FROM conversation_artifact_cards WHERE card_id=?1", params![input.card_id], artifact_from_row).map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(artifact)
}

pub fn recover_interrupted_runs(
    connection: &mut Connection,
    input: RecoverRunsInput,
) -> Result<i64, AppError> {
    let transaction = connection.transaction().map_err(AppError::database)?;
    let active_runs: Vec<(String, String)> = {
        let mut statement = transaction
            .prepare(
                "SELECT run_id, conversation_id FROM task_runs
                 WHERE status IN ('queued', 'running', 'cancel_requested')",
            )
            .map_err(AppError::database)?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        rows
    };
    let mut conversations = std::collections::BTreeSet::new();
    for (run_id, conversation_id) in &active_runs {
        transaction
            .execute(
                "UPDATE task_runs SET status='failed', error=?2, updated_at=?3, finished_at=?3
                 WHERE run_id=?1",
                params![run_id, input.error, input.finished_at],
            )
            .map_err(AppError::database)?;
        transaction
            .execute(
                "UPDATE tool_call_events
                 SET status='cancelled', error='应用重新启动，工具调用未完成。', finished_at=?2
                 WHERE run_id=?1 AND status IN ('pending', 'queued', 'running')",
                params![run_id, input.finished_at],
            )
            .map_err(AppError::database)?;
        conversations.insert(conversation_id);
    }
    for conversation_id in conversations {
        transaction
            .execute(
                "UPDATE task_conversations SET status='failed', updated_at=?2 WHERE conversation_id=?1",
                params![conversation_id, input.finished_at],
            )
            .map_err(AppError::database)?;
    }
    transaction.commit().map_err(AppError::database)?;
    Ok(active_runs.len() as i64)
}

fn decision_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ArtifactDecisionRecord> {
    Ok(ArtifactDecisionRecord {
        decision_id: row.get(0)?,
        artifact_id: row.get(1)?,
        artifact_hash: row.get(2)?,
        card_id: row.get(3)?,
        conversation_id: row.get(4)?,
        decision: row.get(5)?,
        idempotency_key: row.get(6)?,
        actor: row.get(7)?,
        target_type: row.get(8)?,
        target_id: row.get(9)?,
        base_revision: row.get(10)?,
        apply_transaction_id: row.get(11)?,
        conflict_code: row.get(12)?,
        created_at: row.get(13)?,
    })
}

fn authorization_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReviewAuthorizationRecord> {
    Ok(ReviewAuthorizationRecord {
        authorization_id: row.get(0)?,
        artifact_id: row.get(1)?,
        chapter_id: row.get(2)?,
        novel_id: row.get(3)?,
        decision_id: row.get(4)?,
        status: row.get(5)?,
        issued_at: row.get(6)?,
        consumed_at: row.get(7)?,
        consumed_by_draft_id: row.get(8)?,
    })
}

pub fn record_artifact_decision(
    connection: &mut Connection,
    input: RecordArtifactDecisionInput,
) -> Result<ArtifactDecisionRecord, AppError> {
    let existing = connection
        .query_row(
            "SELECT decision_id, artifact_id, artifact_hash, card_id, conversation_id, decision, idempotency_key, actor, target_type, target_id, base_revision, apply_transaction_id, conflict_code, created_at
             FROM artifact_decisions
             WHERE artifact_id=?1 AND decision=?2 AND idempotency_key=?3",
            params![input.artifact_id, input.decision, input.idempotency_key],
            decision_from_row,
        )
        .optional()
        .map_err(AppError::database)?;
    if let Some(existing) = existing {
        return Ok(existing);
    }
    connection
        .execute(
            "INSERT INTO artifact_decisions (
                decision_id, artifact_id, artifact_hash, card_id, conversation_id, decision,
                idempotency_key, actor, target_type, target_id, base_revision,
                apply_transaction_id, conflict_code, created_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![
                input.decision_id,
                input.artifact_id,
                input.artifact_hash,
                input.card_id,
                input.conversation_id,
                input.decision,
                input.idempotency_key,
                input.actor,
                input.target_type,
                input.target_id,
                input.base_revision,
                input.apply_transaction_id,
                input.conflict_code,
                input.created_at
            ],
        )
        .map_err(AppError::database)?;
    if input.decision == "confirm"
        || input.decision == "reject"
        || input.decision == "request_apply"
    {
        let status = if input.conflict_code.is_some() {
            "failed"
        } else if input.decision == "reject" {
            "idle"
        } else if input.apply_transaction_id.is_some() {
            "completed"
        } else {
            "waiting_user"
        };
        let _ = connection.execute(
            "UPDATE task_conversations SET status=?2, updated_at=?3 WHERE conversation_id=?1",
            params![input.conversation_id, status, input.created_at],
        );
    }
    connection
        .query_row(
            "SELECT decision_id, artifact_id, artifact_hash, card_id, conversation_id, decision, idempotency_key, actor, target_type, target_id, base_revision, apply_transaction_id, conflict_code, created_at
             FROM artifact_decisions WHERE decision_id=?1",
            params![input.decision_id],
            decision_from_row,
        )
        .map_err(AppError::database)
}

fn validate_review_decision_scope(
    connection: &Connection,
    decision_id: &str,
    artifact_id: &str,
    novel_id: &str,
    chapter_id: &str,
) -> Result<ArtifactDecisionRecord, AppError> {
    let decision = connection
        .query_row(
            "SELECT decision_id, artifact_id, artifact_hash, card_id, conversation_id, decision, idempotency_key, actor, target_type, target_id, base_revision, apply_transaction_id, conflict_code, created_at
             FROM artifact_decisions WHERE decision_id=?1",
            params![decision_id],
            decision_from_row,
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| {
            AppError::new(
                "ARTIFACT_DECISION_NOT_FOUND",
                "关联的产物决策不存在",
                false,
            )
        })?;

    if decision.decision != "confirm"
        || decision.actor != "user"
        || decision.target_type != "chapter"
        || decision.target_id != chapter_id
        || decision.artifact_id != artifact_id
    {
        return Err(AppError::new(
            "REVIEW_DECISION_SCOPE_MISMATCH",
            "产物决策不是当前章节的有效用户确认",
            false,
        ));
    }

    let (card_artifact_id, card_conversation_id, conversation_novel_id) = connection
        .query_row(
            "SELECT card.artifact_id, card.conversation_id, conversation.novel_id
             FROM conversation_artifact_cards AS card
             INNER JOIN task_conversations AS conversation
                ON conversation.conversation_id = card.conversation_id
             WHERE card.card_id=?1",
            params![&decision.card_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| {
            AppError::new(
                "REVIEW_ARTIFACT_CARD_NOT_FOUND",
                "确认决定关联的产物卡片不存在",
                false,
            )
        })?;
    if card_artifact_id.as_deref() != Some(artifact_id)
        || card_conversation_id != decision.conversation_id
        || conversation_novel_id != novel_id
    {
        return Err(AppError::new(
            "REVIEW_ARTIFACT_CARD_SCOPE_MISMATCH",
            "产物卡片、任务会话或作品归属不一致",
            false,
        ));
    }

    let artifact =
        crate::repositories::artifact_repository::find_artifact(connection, artifact_id)?
            .ok_or_else(|| {
                AppError::new(
                    "RESULT_ARTIFACT_NOT_FOUND",
                    "确认决定关联的章节产物不存在",
                    false,
                )
            })?;
    if artifact.artifact_type != "chapter_text"
        || !matches!(
            artifact.processing_status.as_str(),
            "valid" | "valid_with_warnings"
        )
        || artifact.source_novel_id != novel_id
        || artifact.source_chapter_id.as_deref() != Some(chapter_id)
        || artifact.content_hash != decision.artifact_hash
    {
        return Err(AppError::new(
            "RESULT_ARTIFACT_SCOPE_MISMATCH",
            "章节产物类型、状态、归属或内容哈希不一致",
            false,
        ));
    }

    let chapter_matches = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM chapters
                WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL
             )",
            params![chapter_id, novel_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(AppError::database)?;
    if !chapter_matches {
        return Err(AppError::new(
            "REVIEW_CHAPTER_SCOPE_MISMATCH",
            "确认决定关联的章节不存在或不属于当前作品",
            false,
        ));
    }

    Ok(decision)
}

fn complete_review_conversation(
    transaction: &Transaction<'_>,
    decision_id: &str,
    completed_at: &str,
) -> Result<(), AppError> {
    let updated = transaction
        .execute(
            "UPDATE task_conversations
             SET status='completed', updated_at=?1
             WHERE conversation_id=(
                 SELECT conversation_id FROM artifact_decisions WHERE decision_id=?2
             ) AND status <> 'archived'",
            params![completed_at, decision_id],
        )
        .map_err(AppError::database)?;
    if updated != 1 {
        return Err(AppError::new(
            "REVIEW_CONVERSATION_COMPLETE_FAILED",
            "审阅采用成功但任务会话未能收敛为完成状态",
            false,
        ));
    }
    Ok(())
}

pub fn issue_review_authorization(
    connection: &mut Connection,
    authorization_id: &str,
    decision_id: &str,
    artifact_id: &str,
    novel_id: &str,
    chapter_id: &str,
    issued_at: &str,
) -> Result<ReviewAuthorizationRecord, AppError> {
    let existing = connection
        .query_row(
            "SELECT authorization_id, artifact_id, chapter_id, novel_id, decision_id, status, issued_at, consumed_at, consumed_by_draft_id
             FROM review_authorizations WHERE decision_id=?1",
            params![decision_id],
            authorization_from_row,
        )
        .optional()
        .map_err(AppError::database)?;
    if let Some(existing) = existing {
        if existing.authorization_id != authorization_id
            || existing.artifact_id != artifact_id
            || existing.novel_id != novel_id
            || existing.chapter_id != chapter_id
        {
            return Err(AppError::new(
                "REVIEW_AUTHORIZATION_IDENTITY_CONFLICT",
                "既有审阅授权与当前请求身份不一致",
                false,
            ));
        }
        validate_review_decision_scope(connection, decision_id, artifact_id, novel_id, chapter_id)?;
        return Ok(existing);
    }
    validate_review_decision_scope(connection, decision_id, artifact_id, novel_id, chapter_id)?;
    connection
        .execute(
            "INSERT INTO review_authorizations (
                authorization_id, artifact_id, chapter_id, novel_id, decision_id, status, issued_at
             ) VALUES (?1,?2,?3,?4,?5,'issued',?6)",
            params![
                authorization_id,
                artifact_id,
                chapter_id,
                novel_id,
                decision_id,
                issued_at
            ],
        )
        .map_err(AppError::database)?;
    connection
        .query_row(
            "SELECT authorization_id, artifact_id, chapter_id, novel_id, decision_id, status, issued_at, consumed_at, consumed_by_draft_id
             FROM review_authorizations WHERE authorization_id=?1",
            params![authorization_id],
            authorization_from_row,
        )
        .map_err(AppError::database)
}

pub fn consume_review_authorization(
    connection: &mut Connection,
    input: ConsumeReviewAuthorizationInput,
) -> Result<ReviewAuthorizationRecord, AppError> {
    let current = connection
        .query_row(
            "SELECT authorization_id, artifact_id, chapter_id, novel_id, decision_id, status, issued_at, consumed_at, consumed_by_draft_id
             FROM review_authorizations WHERE authorization_id=?1",
            params![input.authorization_id],
            authorization_from_row,
        )
        .map_err(AppError::database)?;
    if current.status == "consumed" {
        if current.consumed_by_draft_id.as_deref() == Some(input.draft_id.as_str()) {
            return Ok(current);
        }
        return Err(AppError::new(
            "REVIEW_AUTHORIZATION_CONSUMED",
            "审阅授权已被其他草稿消费",
            false,
        ));
    }
    if current.status != "issued" {
        return Err(AppError::new(
            "REVIEW_AUTHORIZATION_EXPIRED",
            "审阅授权已失效",
            false,
        ));
    }
    let updated = connection
        .execute(
            "UPDATE review_authorizations
             SET status='consumed', consumed_at=?2, consumed_by_draft_id=?3
             WHERE authorization_id=?1 AND status='issued'",
            params![input.authorization_id, input.consumed_at, input.draft_id],
        )
        .map_err(AppError::database)?;
    if updated != 1 {
        return Err(AppError::new(
            "REVIEW_AUTHORIZATION_CONFLICT",
            "审阅授权消费冲突",
            false,
        ));
    }
    connection
        .query_row(
            "SELECT authorization_id, artifact_id, chapter_id, novel_id, decision_id, status, issued_at, consumed_at, consumed_by_draft_id
             FROM review_authorizations WHERE authorization_id=?1",
            params![input.authorization_id],
            authorization_from_row,
        )
        .map_err(AppError::database)
}

pub fn get_review_authorization(
    connection: &Connection,
    authorization_id: &str,
) -> Result<Option<ReviewAuthorizationRecord>, AppError> {
    let result = connection.query_row(
        "SELECT authorization_id, artifact_id, chapter_id, novel_id, decision_id, status, issued_at, consumed_at, consumed_by_draft_id
         FROM review_authorizations WHERE authorization_id=?1",
        params![authorization_id],
        authorization_from_row,
    );
    match result {
        Ok(record) => Ok(Some(record)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(err) => Err(AppError::database(err)),
    }
}

pub fn adopt_review_authorized_draft(
    connection: &mut Connection,
    input: AdoptReviewAuthorizedDraftInput,
) -> Result<AdoptReviewAuthorizedDraftResult, AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = connection.transaction().map_err(AppError::database)?;

    let authorization = match transaction.query_row(
        "SELECT authorization_id, artifact_id, chapter_id, novel_id, decision_id, status, issued_at, consumed_at, consumed_by_draft_id
         FROM review_authorizations WHERE authorization_id=?1",
        params![&input.authorization_id],
        authorization_from_row,
    ) {
        Ok(auth) => auth,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(AppError::new(
                "REVIEW_AUTHORIZATION_NOT_FOUND",
                "审阅授权不存在",
                false,
            ));
        }
        Err(err) => return Err(AppError::database(err)),
    };

    validate_review_decision_scope(
        &transaction,
        &authorization.decision_id,
        &authorization.artifact_id,
        &authorization.novel_id,
        &authorization.chapter_id,
    )?;

    let draft = crate::repositories::chapter_repository::get_draft_by_id_and_chapter_internal(
        &transaction,
        &input.draft_id,
        &authorization.chapter_id,
    )
    .map_err(|_| {
        AppError::new(
            "DRAFT_NOT_FOUND",
            "目标采用草稿不存在或不属于授权章节",
            false,
        )
    })?;
    if draft.novel_id != authorization.novel_id || draft.chapter_id != authorization.chapter_id {
        return Err(AppError::new(
            "DRAFT_SCOPE_MISMATCH",
            "草稿所属作品或章节与审阅授权不一致",
            false,
        ));
    }
    if draft.version_no != input.expected_draft_version {
        return Err(AppError::new(
            "DRAFT_VERSION_CONFLICT",
            "草稿版本冲突",
            false,
        ));
    }
    let full_content = if let Some(document_id) = draft.large_text_ref_id.as_deref() {
        crate::large_text_save::read_large_text_document_internal(&transaction, document_id)
            .map_err(|error| {
                AppError::new(
                    "DRAFT_CONTENT_UNAVAILABLE",
                    format!("完整草稿正文无法读取：{error}"),
                    false,
                )
            })?
    } else {
        draft.content.clone()
    };
    let actual_content_hash = crate::repositories::large_text_repository::sha256(&full_content);
    if actual_content_hash != input.expected_content_hash {
        return Err(AppError::new(
            "DRAFT_CONTENT_HASH_MISMATCH",
            "草稿完整正文哈希不匹配",
            false,
        ));
    }

    if authorization.status == "consumed" {
        let adopted_pointer = transaction
            .query_row(
                "SELECT adopted_draft_id FROM chapters WHERE id=?1 AND deleted_at IS NULL",
                params![&authorization.chapter_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(AppError::database)?
            .flatten();
        if authorization.consumed_by_draft_id.as_deref() == Some(input.draft_id.as_str())
            && adopted_pointer.as_deref() == Some(input.draft_id.as_str())
            && draft.is_adopted
        {
            complete_review_conversation(&transaction, &authorization.decision_id, &now)?;
            transaction.commit().map_err(AppError::database)?;
            return Ok(AdoptReviewAuthorizedDraftResult {
                authorization,
                adopted_draft: draft,
            });
        }
        return Err(AppError::new(
            "REVIEW_AUTHORIZATION_CONSUMED",
            "审阅授权已经消费且采用状态与当前草稿不一致",
            false,
        ));
    }
    if authorization.status != "issued" {
        return Err(AppError::new(
            "REVIEW_AUTHORIZATION_INVALID_STATUS",
            "审阅授权已失效",
            false,
        ));
    }

    let adopted_draft = crate::services::chapter_service::adopt_chapter_draft_in_transaction(
        &transaction,
        &input.draft_id,
        &authorization.chapter_id,
        &now,
    )
    .map_err(|error| AppError::new("AUTHORIZED_DRAFT_ADOPT_FAILED", error, false))?;

    let auth_updated = transaction
        .execute(
            "UPDATE review_authorizations
             SET status='consumed', consumed_at=?1, consumed_by_draft_id=?2
             WHERE authorization_id=?3 AND status='issued'",
            params![&now, &input.draft_id, &input.authorization_id],
        )
        .map_err(AppError::database)?;

    if auth_updated != 1 {
        return Err(AppError::new(
            "REVIEW_AUTHORIZATION_CONSUME_FAILED",
            "审阅授权消费失败",
            false,
        ));
    }

    complete_review_conversation(&transaction, &authorization.decision_id, &now)?;

    let updated_auth = transaction
        .query_row(
            "SELECT authorization_id, artifact_id, chapter_id, novel_id, decision_id, status, issued_at, consumed_at, consumed_by_draft_id
             FROM review_authorizations WHERE authorization_id=?1",
            params![&input.authorization_id],
            authorization_from_row,
        )
        .map_err(AppError::database)?;

    transaction.commit().map_err(AppError::database)?;

    Ok(AdoptReviewAuthorizedDraftResult {
        authorization: updated_auth,
        adopted_draft,
    })
}

pub fn get_bundle(
    connection: &Connection,
    id: &str,
) -> Result<Option<TaskConversationBundle>, AppError> {
    let conversation = match get_conversation(connection, id)? {
        Some(value) => value,
        None => return Ok(None),
    };
    let mut turns = connection.prepare("SELECT turn_id, conversation_id, sequence, role, content, run_id, created_at FROM conversation_turns WHERE conversation_id=?1 ORDER BY sequence").map_err(AppError::database)?.query_map(params![id], turn_from_row).map_err(AppError::database)?.collect::<Result<Vec<_>, _>>().map_err(AppError::database)?;
    let runs = connection.prepare("SELECT run_id, conversation_id, turn_id, status, model_snapshot_json, worker_id, error, created_at, updated_at, started_at, finished_at FROM task_runs WHERE conversation_id=?1 ORDER BY created_at").map_err(AppError::database)?.query_map(params![id], run_from_row).map_err(AppError::database)?.collect::<Result<Vec<_>, _>>().map_err(AppError::database)?;
    let mut tool_events = Vec::new();
    for run in &runs {
        let events = connection.prepare("SELECT event_id, run_id, sequence, tool_name, arguments_summary_json, status, duration_ms, error, result_json, created_at, finished_at, call_id FROM tool_call_events WHERE run_id=?1 ORDER BY sequence").map_err(AppError::database)?.query_map(params![run.run_id], event_from_row).map_err(AppError::database)?.collect::<Result<Vec<_>, _>>().map_err(AppError::database)?;
        tool_events.extend(events);
    }
    let artifacts = connection.prepare("SELECT card_id, conversation_id, turn_id, run_id, artifact_id, artifact_type, title, summary, content, status, created_at FROM conversation_artifact_cards WHERE conversation_id=?1 ORDER BY created_at").map_err(AppError::database)?.query_map(params![id], artifact_from_row).map_err(AppError::database)?.collect::<Result<Vec<_>, _>>().map_err(AppError::database)?;
    let decisions = connection.prepare("SELECT decision_id, artifact_id, artifact_hash, card_id, conversation_id, decision, idempotency_key, actor, target_type, target_id, base_revision, apply_transaction_id, conflict_code, created_at FROM artifact_decisions WHERE conversation_id=?1 ORDER BY created_at").map_err(AppError::database)?.query_map(params![id], decision_from_row).map_err(AppError::database)?.collect::<Result<Vec<_>, _>>().map_err(AppError::database)?;
    let authorizations = connection.prepare("SELECT authorization_id, artifact_id, chapter_id, novel_id, decision_id, status, issued_at, consumed_at, consumed_by_draft_id FROM review_authorizations WHERE decision_id IN (SELECT decision_id FROM artifact_decisions WHERE conversation_id=?1) ORDER BY issued_at").map_err(AppError::database)?.query_map(params![id], authorization_from_row).map_err(AppError::database)?.collect::<Result<Vec<_>, _>>().map_err(AppError::database)?;
    turns.shrink_to_fit();
    Ok(Some(TaskConversationBundle {
        conversation,
        turns,
        runs,
        tool_events,
        artifacts,
        decisions,
        authorizations,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use serde_json::json;

    fn connection() -> Connection {
        let mut connection = Connection::open_in_memory().expect("connection");
        connection
            .execute_batch("PRAGMA foreign_keys=ON;")
            .expect("pragma");
        crate::db::create_tables(&mut connection).expect("schema");
        connection.execute(
            "INSERT INTO novels (id, title, outline, created_at, updated_at) VALUES ('novel-conversation-test', '测试小说', '', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z')",
            [],
        ).expect("novel");
        connection
    }

    fn insert_valid_chapter_artifact(
        connection: &Connection,
        artifact_id: &str,
        novel_id: &str,
        chapter_id: &str,
        content: &str,
    ) -> String {
        let content_hash = crate::repositories::large_text_repository::sha256(content);
        let task_id = format!("task-{artifact_id}");
        connection
            .execute_batch(
                "PRAGMA foreign_keys=OFF;
                 DROP TRIGGER IF EXISTS trg_result_artifacts_validate_insert;",
            )
            .expect("disable fixture foreign keys");
        connection
            .execute(
                "INSERT INTO ai_tasks (
                task_id, task_type, novel_id, chapter_id, scope_type, status,
                input_snapshot_id, context_snapshot_id, constraint_snapshot_id,
                trace_id, operation_id, request_hash_version, request_hash,
                expected_artifact_type, expected_artifact_schema_version, created_at, updated_at
             ) VALUES (?1, 'chapter_generate', ?2, ?3, 'chapter', 'completed', ?4, ?5, ?6,
                ?7, ?8, 1, ?9, 'chapter_text', 1, '2026-08-21T00:00:00Z', '2026-08-21T00:00:00Z')",
                params![
                    &task_id,
                    novel_id,
                    chapter_id,
                    format!("input-{artifact_id}"),
                    format!("context-{artifact_id}"),
                    format!("constraint-{artifact_id}"),
                    format!("trace-{artifact_id}"),
                    format!("operation-{artifact_id}"),
                    "0".repeat(64),
                ],
            )
            .expect("insert artifact task fixture");
        connection
            .execute(
                "INSERT INTO result_artifacts (
                artifact_id, task_id, attempt_id, source_input_snapshot_id, artifact_type,
                schema_version, raw_content_ref_id, source_novel_id, source_chapter_id,
                content_hash, content_length, processing_status, created_at
             ) VALUES (?1, ?2, ?3, ?4, 'chapter_text', 1, ?5, ?6, ?7, ?8, ?9, 'valid',
                '2026-08-21T00:00:00Z')",
                params![
                    artifact_id,
                    &task_id,
                    format!("attempt-{artifact_id}"),
                    format!("input-{artifact_id}"),
                    format!("raw-{artifact_id}"),
                    novel_id,
                    chapter_id,
                    &content_hash,
                    content.chars().count() as i64,
                ],
            )
            .expect("insert result artifact fixture");
        connection
            .execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable fixture foreign keys");
        content_hash
    }

    #[test]
    fn conversation_facts_round_trip_and_terminal_event_is_immutable() {
        let mut connection = connection();
        let conversation = create_conversation(
            &mut connection,
            CreateConversationInput {
                conversation_id: "conversation-1".to_string(),
                novel_id: "novel-conversation-test".to_string(),
                title: "生成下一章".to_string(),
                default_model: Some(json!({"providerId":"mock","modelId":"Mock"})),
                created_at: "2026-08-20T00:00:01Z".to_string(),
            },
        )
        .expect("conversation");
        let conversation = update_conversation_model(
            &mut connection,
            UpdateConversationModelInput {
                conversation_id: conversation.conversation_id,
                default_model: json!({
                    "providerId":"deepseek",
                    "modelId":"deepseek-chat",
                    "runtimeMode":"api",
                    "capabilities":["conversation_turn","chapter_generate"],
                    "options":{"temperature":0.4},
                    "capturedAt":"2026-08-20T00:00:01Z"
                }),
                updated_at: "2026-08-20T00:00:01Z".to_string(),
            },
        )
        .expect("model update");
        assert_eq!(
            conversation
                .default_model
                .as_ref()
                .and_then(|value| value.get("modelId"))
                .and_then(Value::as_str),
            Some("deepseek-chat")
        );
        let turn = append_turn(
            &mut connection,
            AppendTurnInput {
                turn_id: "turn-1".to_string(),
                conversation_id: conversation.conversation_id.clone(),
                role: "user".to_string(),
                content: "生成下一章".to_string(),
                created_at: "2026-08-20T00:00:02Z".to_string(),
            },
        )
        .expect("turn");
        let run = create_run(
            &mut connection,
            CreateRunInput {
                run_id: "run-1".to_string(),
                conversation_id: conversation.conversation_id.clone(),
                turn_id: turn.turn_id,
                model_snapshot: json!({"providerId":"mock","modelId":"Mock"}),
                worker_id: "worker-1".to_string(),
                created_at: "2026-08-20T00:00:03Z".to_string(),
            },
        )
        .expect("run");
        let event = append_tool_event(
            &mut connection,
            AppendToolEventInput {
                event_id: "event-1".to_string(),
                run_id: run.run_id,
                tool_name: "novel.read_context".to_string(),
                arguments_summary: json!({"novelId":"novel-conversation-test"}),
                status: "running".to_string(),
                duration_ms: None,
                error: None,
                result: None,
                created_at: "2026-08-20T00:00:04Z".to_string(),
                finished_at: None,
            },
        )
        .expect("event");
        let terminal = update_tool_event(
            &mut connection,
            UpdateToolEventInput {
                event_id: event.event_id,
                status: "succeeded".to_string(),
                duration_ms: Some(12),
                error: None,
                result: Some(json!({"ok":true})),
                finished_at: Some("2026-08-20T00:00:05Z".to_string()),
            },
        )
        .expect("terminal");
        assert_eq!(terminal.status, "succeeded");
        assert!(connection
            .execute(
                "UPDATE tool_call_events SET status='failed' WHERE event_id='event-1'",
                []
            )
            .is_err());
        assert!(create_artifact_card(
            &mut connection,
            CreateArtifactCardInput {
                card_id: "card-1".to_string(),
                conversation_id: conversation.conversation_id.clone(),
                turn_id: Some("turn-1".to_string()),
                run_id: Some("run-1".to_string()),
                artifact_id: None,
                artifact_type: "chapter_text".to_string(),
                title: "候选正文".to_string(),
                summary: "候选".to_string(),
                content: Some("正文".to_string()),
                status: "candidate".to_string(),
                created_at: "2026-08-20T00:00:06Z".to_string(),
            },
        )
        .is_err());
        let bundle = get_bundle(&connection, "conversation-1")
            .expect("bundle")
            .expect("present");
        assert_eq!(bundle.turns.len(), 1);
        assert_eq!(bundle.runs.len(), 1);
        assert_eq!(bundle.tool_events.len(), 1);
        assert_eq!(bundle.artifacts.len(), 0);
    }

    #[test]
    fn recovery_closes_interrupted_runs_and_pending_events() {
        let mut connection = connection();
        let conversation = create_conversation(
            &mut connection,
            CreateConversationInput {
                conversation_id: "conversation-recovery".to_string(),
                novel_id: "novel-conversation-test".to_string(),
                title: "恢复任务".to_string(),
                default_model: None,
                created_at: "2026-08-20T00:01:00Z".to_string(),
            },
        )
        .expect("conversation");
        let turn = append_turn(
            &mut connection,
            AppendTurnInput {
                turn_id: "turn-recovery".to_string(),
                conversation_id: conversation.conversation_id.clone(),
                role: "user".to_string(),
                content: "继续任务".to_string(),
                created_at: "2026-08-20T00:01:01Z".to_string(),
            },
        )
        .expect("turn");
        let run = create_run(
            &mut connection,
            CreateRunInput {
                run_id: "run-recovery".to_string(),
                conversation_id: conversation.conversation_id,
                turn_id: turn.turn_id,
                model_snapshot: json!({"providerId":"mock","modelId":"Mock"}),
                worker_id: "worker-recovery".to_string(),
                created_at: "2026-08-20T00:01:02Z".to_string(),
            },
        )
        .expect("run");
        append_tool_event(
            &mut connection,
            AppendToolEventInput {
                event_id: "event-recovery".to_string(),
                run_id: run.run_id,
                tool_name: "novel.read_context".to_string(),
                arguments_summary: json!({"novelId":"novel-conversation-test"}),
                status: "running".to_string(),
                duration_ms: None,
                error: None,
                result: None,
                created_at: "2026-08-20T00:01:03Z".to_string(),
                finished_at: None,
            },
        )
        .expect("event");

        let recovered = recover_interrupted_runs(
            &mut connection,
            RecoverRunsInput {
                finished_at: "2026-08-20T00:02:00Z".to_string(),
                error: "应用重新启动，上一轮运行已中断。".to_string(),
            },
        )
        .expect("recovery");
        assert_eq!(recovered, 1);
        let bundle = get_bundle(&connection, "conversation-recovery")
            .expect("bundle")
            .expect("present");
        assert_eq!(bundle.conversation.status, "failed");
        assert_eq!(bundle.runs[0].status, "failed");
        assert_eq!(bundle.tool_events[0].status, "cancelled");
        assert_eq!(
            recover_interrupted_runs(
                &mut connection,
                RecoverRunsInput {
                    finished_at: "2026-08-20T00:03:00Z".to_string(),
                    error: "再次恢复".to_string(),
                },
            )
            .expect("idempotent recovery"),
            0
        );
    }

    #[test]
    fn artifact_decision_is_idempotent_and_authorization_consumes_once() {
        let mut connection = connection();
        connection.execute(
            "INSERT INTO chapters (id, novel_id, title, order_index, status, word_count, created_at, updated_at)
             VALUES ('chapter-1', 'novel-conversation-test', '第一章', 1, 'drafted', 0, '2026-08-21T00:00:00Z', '2026-08-21T00:00:00Z')",
            [],
        ).expect("chapter");
        let artifact_hash = insert_valid_chapter_artifact(
            &connection,
            "artifact-decision-hash",
            "novel-conversation-test",
            "chapter-1",
            "候选正文",
        );
        let conversation = create_conversation(
            &mut connection,
            CreateConversationInput {
                conversation_id: "conversation-decision".to_string(),
                novel_id: "novel-conversation-test".to_string(),
                title: "确认任务".to_string(),
                default_model: None,
                created_at: "2026-08-21T00:00:00Z".to_string(),
            },
        )
        .expect("conversation");
        let turn = append_turn(
            &mut connection,
            AppendTurnInput {
                turn_id: "turn-decision".to_string(),
                conversation_id: conversation.conversation_id.clone(),
                role: "user".to_string(),
                content: "生成下一章".to_string(),
                created_at: "2026-08-21T00:00:01Z".to_string(),
            },
        )
        .expect("turn");
        let run = create_run(
            &mut connection,
            CreateRunInput {
                run_id: "run-decision".to_string(),
                conversation_id: conversation.conversation_id.clone(),
                turn_id: turn.turn_id,
                model_snapshot: json!({"providerId":"mock","modelId":"Mock"}),
                worker_id: "worker-decision".to_string(),
                created_at: "2026-08-21T00:00:02Z".to_string(),
            },
        )
        .expect("run");
        connection
            .execute(
                "INSERT INTO conversation_artifact_cards
                    (card_id, conversation_id, turn_id, run_id, artifact_id, artifact_type, title, summary, content, status, created_at)
                 VALUES ('card-decision', ?1, ?2, ?3, 'artifact-decision-hash', 'chapter_text', '候选', '摘要', '', 'candidate', '2026-08-21T00:00:03Z')",
                params![conversation.conversation_id, run.turn_id, run.run_id],
            )
            .expect("card");
        let card_id = "card-decision".to_string();
        let first = record_artifact_decision(
            &mut connection,
            RecordArtifactDecisionInput {
                decision_id: "decision-1".to_string(),
                artifact_id: "artifact-decision-hash".to_string(),
                artifact_hash: artifact_hash.clone(),
                card_id: card_id.clone(),
                conversation_id: conversation.conversation_id.clone(),
                decision: "confirm".to_string(),
                idempotency_key: "card-decision:confirm".to_string(),
                actor: "user".to_string(),
                target_type: "chapter".to_string(),
                target_id: "chapter-1".to_string(),
                base_revision: None,
                apply_transaction_id: None,
                conflict_code: None,
                created_at: "2026-08-21T00:00:04Z".to_string(),
            },
        )
        .expect("decision");
        let replay = record_artifact_decision(
            &mut connection,
            RecordArtifactDecisionInput {
                decision_id: "decision-2".to_string(),
                artifact_id: "artifact-decision-hash".to_string(),
                artifact_hash,
                card_id: card_id,
                conversation_id: conversation.conversation_id.clone(),
                decision: "confirm".to_string(),
                idempotency_key: "card-decision:confirm".to_string(),
                actor: "user".to_string(),
                target_type: "chapter".to_string(),
                target_id: "chapter-1".to_string(),
                base_revision: None,
                apply_transaction_id: None,
                conflict_code: None,
                created_at: "2026-08-21T00:00:05Z".to_string(),
            },
        )
        .expect("replay");
        assert_eq!(first.decision_id, replay.decision_id);
        let authorization = issue_review_authorization(
            &mut connection,
            "auth-1",
            &first.decision_id,
            "artifact-decision-hash",
            "novel-conversation-test",
            "chapter-1",
            "2026-08-21T00:00:06Z",
        )
        .expect("authorization");
        let consumed = consume_review_authorization(
            &mut connection,
            ConsumeReviewAuthorizationInput {
                authorization_id: authorization.authorization_id.clone(),
                draft_id: "draft-1".to_string(),
                consumed_at: "2026-08-21T00:00:07Z".to_string(),
            },
        )
        .expect("consume");
        assert_eq!(consumed.status, "consumed");
        let replayed = consume_review_authorization(
            &mut connection,
            ConsumeReviewAuthorizationInput {
                authorization_id: authorization.authorization_id,
                draft_id: "draft-1".to_string(),
                consumed_at: "2026-08-21T00:00:08Z".to_string(),
            },
        )
        .expect("consume replay");
        assert_eq!(replayed.status, "consumed");
        assert_eq!(replayed.consumed_by_draft_id.as_deref(), Some("draft-1"));
    }

    #[test]
    fn test_adopt_review_authorized_draft_atomic_transaction() {
        let mut connection = connection();

        // 1. 初始化作品、章节与草稿
        connection.execute(
            "INSERT INTO chapters (id, novel_id, title, order_index, status, word_count, created_at, updated_at)
             VALUES ('chapter-100', 'novel-conversation-test', '第一章', 1, 'drafted', 500, '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z')",
            [],
        ).expect("insert chapter");

        connection.execute(
            "INSERT INTO chapter_drafts (id, novel_id, chapter_id, content, version_no, is_adopted, word_count, created_at, updated_at)
             VALUES ('draft-100', 'novel-conversation-test', 'chapter-100', '第一章测试正文内容', 1, 0, 500, '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z')",
            [],
        ).expect("insert draft 100");

        connection.execute(
            "INSERT INTO chapter_drafts (id, novel_id, chapter_id, content, version_no, is_adopted, word_count, created_at, updated_at)
             VALUES ('draft-101', 'novel-conversation-test', 'chapter-100', '第二版候选正文内容', 2, 0, 600, '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z')",
            [],
        ).expect("insert draft 101");
        let artifact_hash = insert_valid_chapter_artifact(
            &connection,
            "art-100",
            "novel-conversation-test",
            "chapter-100",
            "章节候选正文",
        );

        // 2. 初始化会话、决策与授权
        create_conversation(
            &mut connection,
            CreateConversationInput {
                conversation_id: "conv-adopt-test".to_string(),
                novel_id: "novel-conversation-test".to_string(),
                title: "采用测试会话".to_string(),
                default_model: None,
                created_at: "2026-08-21T00:00:00Z".to_string(),
            },
        )
        .expect("conversation");

        connection.execute(
            "INSERT INTO conversation_artifact_cards
                (card_id, conversation_id, turn_id, run_id, artifact_id, artifact_type, title, summary, content, status, created_at)
             VALUES ('card-100', 'conv-adopt-test', NULL, NULL, 'art-100', 'chapter_text', '候选', '摘要', '', 'candidate', '2026-08-21T00:00:01Z')",
            [],
        ).expect("insert card");

        record_artifact_decision(
            &mut connection,
            RecordArtifactDecisionInput {
                decision_id: "dec-adopt-100".to_string(),
                artifact_id: "art-100".to_string(),
                artifact_hash: artifact_hash.clone(),
                card_id: "card-100".to_string(),
                conversation_id: "conv-adopt-test".to_string(),
                decision: "confirm".to_string(),
                idempotency_key: "card-100:confirm".to_string(),
                actor: "user".to_string(),
                target_type: "chapter".to_string(),
                target_id: "chapter-100".to_string(),
                base_revision: None,
                apply_transaction_id: None,
                conflict_code: None,
                created_at: "2026-08-21T00:00:01Z".to_string(),
            },
        )
        .expect("record decision");

        let auth = issue_review_authorization(
            &mut connection,
            "auth-adopt-100",
            "dec-adopt-100",
            "art-100",
            "novel-conversation-test",
            "chapter-100",
            "2026-08-21T00:00:02Z",
        )
        .expect("issue auth");

        assert_eq!(auth.status, "issued");

        // 3. 校验失败路径必须无副作用
        let missing_authorization = adopt_review_authorized_draft(
            &mut connection,
            AdoptReviewAuthorizedDraftInput {
                authorization_id: "missing-auth".to_string(),
                draft_id: "draft-100".to_string(),
                expected_draft_version: 1,
                expected_content_hash: crate::repositories::large_text_repository::sha256(
                    "第一章测试正文内容",
                ),
            },
        );
        assert_eq!(
            missing_authorization.unwrap_err().code,
            "REVIEW_AUTHORIZATION_NOT_FOUND"
        );

        let err_draft = adopt_review_authorized_draft(
            &mut connection,
            AdoptReviewAuthorizedDraftInput {
                authorization_id: "auth-adopt-100".to_string(),
                draft_id: "non-existent-draft".to_string(),
                expected_draft_version: 1,
                expected_content_hash: crate::repositories::large_text_repository::sha256("正文"),
            },
        );
        assert_eq!(err_draft.unwrap_err().code, "DRAFT_NOT_FOUND");

        let version_conflict = adopt_review_authorized_draft(
            &mut connection,
            AdoptReviewAuthorizedDraftInput {
                authorization_id: "auth-adopt-100".to_string(),
                draft_id: "draft-100".to_string(),
                expected_draft_version: 2,
                expected_content_hash: crate::repositories::large_text_repository::sha256(
                    "第一章测试正文内容",
                ),
            },
        );
        assert_eq!(version_conflict.unwrap_err().code, "DRAFT_VERSION_CONFLICT");

        let hash_conflict = adopt_review_authorized_draft(
            &mut connection,
            AdoptReviewAuthorizedDraftInput {
                authorization_id: "auth-adopt-100".to_string(),
                draft_id: "draft-100".to_string(),
                expected_draft_version: 1,
                expected_content_hash: "f".repeat(64),
            },
        );
        assert_eq!(
            hash_conflict.unwrap_err().code,
            "DRAFT_CONTENT_HASH_MISMATCH"
        );

        // 验证失败后无任何副作用（授权仍为 issued，草稿仍为未采用）
        let auth_check = get_review_authorization(&connection, "auth-adopt-100")
            .expect("get auth")
            .expect("found");
        assert_eq!(auth_check.status, "issued");

        connection
            .execute_batch(
                "CREATE TRIGGER test_block_authorization_consume
                 BEFORE UPDATE OF status ON review_authorizations
                 WHEN NEW.status = 'consumed'
                 BEGIN SELECT RAISE(ABORT, 'test consume failure'); END;",
            )
            .expect("install consume failure trigger");
        let consume_failure = adopt_review_authorized_draft(
            &mut connection,
            AdoptReviewAuthorizedDraftInput {
                authorization_id: "auth-adopt-100".to_string(),
                draft_id: "draft-100".to_string(),
                expected_draft_version: 1,
                expected_content_hash: crate::repositories::large_text_repository::sha256(
                    "第一章测试正文内容",
                ),
            },
        );
        assert!(consume_failure.is_err());
        let rolled_back_auth = get_review_authorization(&connection, "auth-adopt-100")
            .expect("get rolled back auth")
            .expect("rolled back auth present");
        assert_eq!(rolled_back_auth.status, "issued");
        let rolled_back_draft =
            crate::repositories::chapter_repository::get_draft_by_id_and_chapter_internal(
                &connection,
                "draft-100",
                "chapter-100",
            )
            .expect("rolled back draft");
        assert!(!rolled_back_draft.is_adopted);
        let rolled_back_pointer: Option<String> = connection
            .query_row(
                "SELECT adopted_draft_id FROM chapters WHERE id='chapter-100'",
                [],
                |row| row.get(0),
            )
            .expect("rolled back chapter pointer");
        assert_eq!(rolled_back_pointer, None);
        let rolled_back_conversation_status: String = connection
            .query_row(
                "SELECT status FROM task_conversations WHERE conversation_id='conv-adopt-test'",
                [],
                |row| row.get(0),
            )
            .expect("rolled back conversation status");
        assert_eq!(rolled_back_conversation_status, "waiting_user");
        connection
            .execute_batch("DROP TRIGGER test_block_authorization_consume;")
            .expect("remove consume failure trigger");

        // 4. 正常采用事务执行
        let result = adopt_review_authorized_draft(
            &mut connection,
            AdoptReviewAuthorizedDraftInput {
                authorization_id: "auth-adopt-100".to_string(),
                draft_id: "draft-100".to_string(),
                expected_draft_version: 1,
                expected_content_hash: crate::repositories::large_text_repository::sha256(
                    "第一章测试正文内容",
                ),
            },
        )
        .expect("adopt success");

        assert_eq!(result.authorization.status, "consumed");
        assert_eq!(
            result.authorization.consumed_by_draft_id.as_deref(),
            Some("draft-100")
        );
        assert!(result.adopted_draft.is_adopted);
        assert_eq!(result.adopted_draft.id, "draft-100");

        // 5. 校验 SQLite 数据库实际状态
        let adopted_draft_in_db =
            crate::repositories::chapter_repository::get_draft_by_id_and_chapter_internal(
                &connection,
                "draft-100",
                "chapter-100",
            )
            .expect("get draft in db");
        assert!(adopted_draft_in_db.is_adopted);

        let chapter_in_db: Option<String> = connection
            .query_row(
                "SELECT adopted_draft_id FROM chapters WHERE id='chapter-100'",
                [],
                |r| r.get(0),
            )
            .expect("query chapter");
        assert_eq!(chapter_in_db.as_deref(), Some("draft-100"));
        let completed_conversation_status: String = connection
            .query_row(
                "SELECT status FROM task_conversations WHERE conversation_id='conv-adopt-test'",
                [],
                |row| row.get(0),
            )
            .expect("completed conversation status");
        assert_eq!(completed_conversation_status, "completed");

        // 6. 重放幂等性
        let replay = adopt_review_authorized_draft(
            &mut connection,
            AdoptReviewAuthorizedDraftInput {
                authorization_id: "auth-adopt-100".to_string(),
                draft_id: "draft-100".to_string(),
                expected_draft_version: 1,
                expected_content_hash: crate::repositories::large_text_repository::sha256(
                    "第一章测试正文内容",
                ),
            },
        )
        .expect("replay success");
        assert_eq!(replay.authorization.status, "consumed");
        assert_eq!(replay.adopted_draft.id, "draft-100");
        assert_eq!(
            connection
                .query_row(
                    "SELECT status FROM task_conversations WHERE conversation_id='conv-adopt-test'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .expect("replayed conversation status"),
            "completed"
        );

        // 7. 已被其他草稿消费报错
        let err_consumed = adopt_review_authorized_draft(
            &mut connection,
            AdoptReviewAuthorizedDraftInput {
                authorization_id: "auth-adopt-100".to_string(),
                draft_id: "draft-101".to_string(),
                expected_draft_version: 2,
                expected_content_hash: crate::repositories::large_text_repository::sha256(
                    "第二版候选正文内容",
                ),
            },
        );
        assert!(err_consumed.is_err());
        assert_eq!(
            err_consumed.unwrap_err().code,
            "REVIEW_AUTHORIZATION_CONSUMED"
        );
    }
}
