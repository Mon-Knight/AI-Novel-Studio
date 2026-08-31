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
pub struct TaskTurnRunProjection {
    pub turn: ConversationTurnRecord,
    pub runs: Vec<TaskRunRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializedTaskConversation {
    pub conversation: TaskConversationRecord,
    pub turn: ConversationTurnRecord,
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
pub struct CreateInitializedConversationInput {
    pub conversation_id: String,
    pub turn_id: String,
    pub novel_id: String,
    pub title: String,
    pub goal: String,
    pub default_model: Value,
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
pub struct RenameConversationInput {
    pub conversation_id: String,
    pub title: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetConversationArchivedInput {
    pub conversation_id: String,
    pub archived: bool,
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
    pub summary_follow_up: ChapterSummaryFollowUp,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterSummaryFollowUp {
    pub status: String,
    pub next_action: Option<String>,
    pub instruction: Option<String>,
    pub chapter_id: String,
    pub adopted_draft_id: String,
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

fn model_lock_projection(value: &Value) -> Value {
    let provider_id = value
        .get("providerId")
        .and_then(Value::as_str)
        .map(str::trim)
        .map(|provider| match provider {
            "deepseek" | "deepseek-official" => "deepseek-official",
            _ => provider,
        });
    let mut projected = serde_json::json!({
        "providerId": provider_id.map(Value::from).unwrap_or(Value::Null),
        "modelId": value.get("modelId").and_then(Value::as_str).map(str::trim).map(Value::from).unwrap_or(Value::Null),
        "runtimeMode": value.get("runtimeMode").and_then(Value::as_str).map(str::trim).map(Value::from).unwrap_or(Value::Null),
    });
    if let Some(base_url) = value
        .get("baseUrl")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        projected["baseUrl"] = Value::String(base_url.trim_end_matches('/').to_string());
    }
    projected
}

fn model_lock_matches(locked: &Value, candidate: &Value) -> bool {
    let locked = model_lock_projection(locked);
    let candidate = model_lock_projection(candidate);
    for key in ["providerId", "modelId", "runtimeMode"] {
        if locked.get(key) != candidate.get(key) {
            return false;
        }
    }

    match (locked.get("baseUrl"), candidate.get("baseUrl")) {
        (Some(locked_base_url), Some(candidate_base_url)) => locked_base_url == candidate_base_url,
        (Some(_), None) => false,
        // Pre-baseUrl task snapshots can be hydrated only after their provider/model
        // identity matches the current settings. New snapshots remain endpoint-strict.
        (None, _) => true,
    }
}

fn upgrade_legacy_model_lock_endpoint(locked: &Value, candidate: &Value) -> Option<Value> {
    let locked_projection = model_lock_projection(locked);
    if locked_projection.get("baseUrl").is_some() {
        return None;
    }
    let candidate_base_url = model_lock_projection(candidate)
        .get("baseUrl")
        .and_then(Value::as_str)?
        .to_string();
    let mut upgraded = locked.clone();
    upgraded
        .as_object_mut()?
        .insert("baseUrl".to_string(), Value::String(candidate_base_url));
    Some(upgraded)
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

fn has_unresolved_artifact_candidate(
    connection: &Connection,
    conversation_id: &str,
) -> Result<bool, AppError> {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1
                FROM conversation_artifact_cards AS card
                LEFT JOIN artifact_decisions AS decision
                  ON decision.decision_id = (
                    SELECT latest.decision_id
                    FROM artifact_decisions AS latest
                    WHERE latest.card_id = card.card_id
                      AND latest.conversation_id = card.conversation_id
                    ORDER BY latest.created_at DESC, latest.rowid DESC
                    LIMIT 1
                  )
                WHERE card.conversation_id = ?1
                  AND card.status IN ('candidate', 'confirmed')
                  AND (
                    decision.decision_id IS NULL
                    OR (
                      decision.decision = 'confirm'
                      AND NOT EXISTS(
                        SELECT 1
                        FROM review_authorizations AS authorization
                        JOIN chapters AS chapter
                          ON chapter.id = authorization.chapter_id
                         AND chapter.novel_id = authorization.novel_id
                         AND chapter.deleted_at IS NULL
                         AND chapter.adopted_draft_id = authorization.consumed_by_draft_id
                        JOIN chapter_drafts AS draft
                          ON draft.id = authorization.consumed_by_draft_id
                         AND draft.chapter_id = authorization.chapter_id
                         AND draft.novel_id = authorization.novel_id
                         AND draft.is_adopted = 1
                        WHERE authorization.decision_id = decision.decision_id
                          AND authorization.status = 'consumed'
                      )
                    )
                    OR (
                      decision.decision = 'request_apply'
                      AND decision.apply_transaction_id IS NULL
                      AND decision.conflict_code IS NULL
                    )
                  )
            )",
            params![conversation_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)
}

pub(crate) fn reconcile_conversation_status(
    connection: &Connection,
    conversation_id: &str,
    fallback_status: &str,
    updated_at: &str,
) -> Result<(), AppError> {
    let has_unresolved = has_unresolved_artifact_candidate(connection, conversation_id)?;
    let has_active_run: bool = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM task_runs
                WHERE conversation_id=?1
                  AND status IN ('queued', 'running', 'cancel_requested')
            )",
            params![conversation_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    let status = if has_unresolved {
        "waiting_user"
    } else if has_active_run {
        "running"
    } else {
        fallback_status
    };
    let updated = connection
        .execute(
            "UPDATE task_conversations
             SET status=?2, updated_at=?3
             WHERE conversation_id=?1 AND archived_at IS NULL",
            params![conversation_id, status, updated_at],
        )
        .map_err(AppError::database)?;
    if updated == 0 {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM task_conversations WHERE conversation_id=?1)",
                params![conversation_id],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        if !exists {
            return Err(AppError::new(
                "CONVERSATION_NOT_FOUND",
                "任务对话不存在",
                false,
            ));
        }
    }
    Ok(())
}

fn decision_fallback_status(decision: &ArtifactDecisionRecord) -> &'static str {
    if decision.conflict_code.is_some() {
        "failed"
    } else {
        match decision.decision.as_str() {
            "reject" | "request_revision" => "idle",
            "request_apply" if decision.apply_transaction_id.is_some() => "completed",
            "confirm" | "request_apply" => "waiting_user",
            _ => "idle",
        }
    }
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

pub fn create_initialized_conversation(
    connection: &mut Connection,
    input: CreateInitializedConversationInput,
) -> Result<InitializedTaskConversation, AppError> {
    let transaction = connection.transaction().map_err(AppError::database)?;
    let model = json_text(&input.default_model)?;
    transaction
        .execute(
            "INSERT INTO task_conversations (conversation_id, novel_id, title, status, default_model_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'idle', ?4, ?5, ?5)",
            params![
                input.conversation_id,
                input.novel_id,
                input.title,
                model,
                input.created_at
            ],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "INSERT INTO conversation_turns (turn_id, conversation_id, sequence, role, content, created_at)
             VALUES (?1, ?2, 0, 'user', ?3, ?4)",
            params![
                input.turn_id,
                input.conversation_id,
                input.goal,
                input.created_at
            ],
        )
        .map_err(AppError::database)?;
    let conversation = transaction
        .query_row(
            "SELECT conversation_id, novel_id, title, status, default_model_json, created_at, updated_at, archived_at FROM task_conversations WHERE conversation_id=?1",
            params![input.conversation_id],
            conversation_from_row,
        )
        .map_err(AppError::database)?;
    let turn = transaction
        .query_row(
            "SELECT turn_id, conversation_id, sequence, role, content, run_id, created_at FROM conversation_turns WHERE turn_id=?1",
            params![input.turn_id],
            turn_from_row,
        )
        .map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(InitializedTaskConversation { conversation, turn })
}

pub fn list_conversations(
    connection: &Connection,
    novel_id: Option<&str>,
    include_archived: bool,
    limit: i64,
) -> Result<Vec<TaskConversationRecord>, AppError> {
    let archive_filter = if include_archived {
        ""
    } else {
        " AND archived_at IS NULL AND status <> 'archived'"
    };
    let sql = if novel_id.is_some() {
        format!(
            "SELECT conversation_id, novel_id, title, status, default_model_json, created_at, updated_at, archived_at FROM task_conversations WHERE novel_id=?1{archive_filter} ORDER BY updated_at DESC LIMIT ?2"
        )
    } else {
        format!(
            "SELECT conversation_id, novel_id, title, status, default_model_json, created_at, updated_at, archived_at FROM task_conversations WHERE 1=1{archive_filter} ORDER BY updated_at DESC LIMIT ?1"
        )
    };
    let mut statement = connection.prepare(&sql).map_err(AppError::database)?;
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

pub fn validate_task_runtime_scope(
    connection: &Connection,
    conversation_id: &str,
    turn_id: &str,
    novel_id: &str,
    chapter_id: Option<&str>,
) -> Result<String, AppError> {
    let scope_mismatch = || {
        AppError::new(
            "TASK_RUNTIME_SCOPE_MISMATCH",
            "任务运行范围与任务对话不一致",
            false,
        )
    };
    let authoritative_novel_id = connection
        .query_row(
            "SELECT novel_id FROM task_conversations WHERE conversation_id=?1",
            params![conversation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(&scope_mismatch)?;
    if authoritative_novel_id != novel_id {
        return Err(scope_mismatch());
    }
    let authoritative_goal = connection
        .query_row(
            "SELECT content FROM conversation_turns
             WHERE turn_id=?1 AND conversation_id=?2 AND role='user'",
            params![turn_id, conversation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(&scope_mismatch)?;
    if let Some(chapter_id) = chapter_id {
        let scoped_chapter: bool = connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM chapters
                    WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL
                )",
                params![chapter_id, novel_id],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        if !scoped_chapter {
            return Err(scope_mismatch());
        }
    }
    Ok(authoritative_goal)
}

pub fn update_conversation_model(
    connection: &mut Connection,
    input: UpdateConversationModelInput,
) -> Result<TaskConversationRecord, AppError> {
    let current = get_conversation(connection, &input.conversation_id)?
        .ok_or_else(|| AppError::new("CONVERSATION_NOT_FOUND", "任务对话不存在", false))?;
    if let Some(current_model) = current.default_model.as_ref() {
        if current_model == &input.default_model {
            return Ok(current);
        }
        return Err(AppError::new(
            "CONVERSATION_MODEL_LOCKED",
            "任务模型已在创建时固定，当前会话结束前不能更换",
            false,
        ));
    }
    let has_facts: bool = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM conversation_turns WHERE conversation_id=?1
                UNION ALL
                SELECT 1 FROM task_runs WHERE conversation_id=?1
            )",
            params![input.conversation_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if has_facts {
        return Err(AppError::new(
            "CONVERSATION_MODEL_LOCKED",
            "任务模型必须在首个回合前固定",
            false,
        ));
    }
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

pub fn rename_conversation(
    connection: &mut Connection,
    input: RenameConversationInput,
) -> Result<TaskConversationRecord, AppError> {
    let changed = connection
        .execute(
            "UPDATE task_conversations SET title=?2, updated_at=?3 WHERE conversation_id=?1",
            params![input.conversation_id, input.title, input.updated_at],
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
        .ok_or_else(|| AppError::new("CONVERSATION_NOT_FOUND", "任务对话重命名后无法读取", false))
}

pub fn set_conversation_archived(
    connection: &mut Connection,
    input: SetConversationArchivedInput,
) -> Result<TaskConversationRecord, AppError> {
    let transaction = connection.transaction().map_err(AppError::database)?;
    let current = transaction
        .query_row(
            "SELECT conversation_id, novel_id, title, status, default_model_json, created_at, updated_at, archived_at FROM task_conversations WHERE conversation_id=?1",
            params![input.conversation_id],
            conversation_from_row,
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| AppError::new("CONVERSATION_NOT_FOUND", "任务对话不存在", false))?;

    if input.archived {
        let has_active_run: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM task_runs WHERE conversation_id=?1 AND status IN ('queued', 'running', 'cancel_requested'))",
                params![input.conversation_id],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        if has_active_run || current.status == "running" {
            return Err(AppError::new(
                "CONVERSATION_ACTIVE_RUN",
                "运行中的任务不能归档，请先停止任务",
                false,
            ));
        }
        transaction
            .execute(
                "UPDATE task_conversations SET archived_at=?2, updated_at=?2 WHERE conversation_id=?1",
                params![input.conversation_id, input.updated_at],
            )
            .map_err(AppError::database)?;
    } else {
        transaction
            .execute(
                "UPDATE task_conversations SET archived_at=NULL, status=CASE WHEN status='archived' THEN 'idle' ELSE status END, updated_at=?2 WHERE conversation_id=?1",
                params![input.conversation_id, input.updated_at],
            )
            .map_err(AppError::database)?;
    }

    let updated = transaction
        .query_row(
            "SELECT conversation_id, novel_id, title, status, default_model_json, created_at, updated_at, archived_at FROM task_conversations WHERE conversation_id=?1",
            params![input.conversation_id],
            conversation_from_row,
        )
        .map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(updated)
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
    let locked_model = transaction
        .query_row(
            "SELECT default_model_json FROM task_conversations WHERE conversation_id=?1",
            params![input.conversation_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| AppError::new("CONVERSATION_NOT_FOUND", "任务对话不存在", false))?
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    let local_conversational_model = input
        .model_snapshot
        .get("providerId")
        .and_then(Value::as_str)
        == Some("ans-local")
        && input
            .model_snapshot
            .get("runtime")
            .and_then(|runtime| runtime.get("adapterProtocol"))
            .and_then(Value::as_str)
            == Some("ans_local_conversation_v1");
    if let Some(locked_model) = locked_model {
        if !local_conversational_model && !model_lock_matches(&locked_model, &input.model_snapshot)
        {
            return Err(AppError::new(
                "TASK_RUN_MODEL_MISMATCH",
                "运行模型与任务创建时固定的模型不一致",
                false,
            ));
        }
        if !local_conversational_model {
            if let Some(upgraded) =
                upgrade_legacy_model_lock_endpoint(&locked_model, &input.model_snapshot)
            {
                transaction
                    .execute(
                        "UPDATE task_conversations SET default_model_json=?2 WHERE conversation_id=?1",
                        params![input.conversation_id, json_text(&upgraded)?],
                    )
                    .map_err(AppError::database)?;
            }
        }
    }
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

pub fn get_turn_run_projection(
    connection: &Connection,
    conversation_id: &str,
    turn_id: &str,
) -> Result<Option<TaskTurnRunProjection>, AppError> {
    let turn = connection
        .query_row(
            "SELECT turn_id, conversation_id, sequence, role, content, run_id, created_at
             FROM conversation_turns
             WHERE conversation_id=?1 AND turn_id=?2",
            params![conversation_id, turn_id],
            turn_from_row,
        )
        .optional()
        .map_err(AppError::database)?;
    let Some(turn) = turn else {
        return Ok(None);
    };
    let runs = connection
        .prepare(
            "SELECT run_id, conversation_id, turn_id, status, model_snapshot_json, worker_id,
                    error, created_at, updated_at, started_at, finished_at
             FROM task_runs
             WHERE conversation_id=?1 AND turn_id=?2
             ORDER BY created_at, rowid",
        )
        .map_err(AppError::database)?
        .query_map(params![conversation_id, turn_id], run_from_row)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(Some(TaskTurnRunProjection { turn, runs }))
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
        let fallback_status = if run.status == "completed" {
            "completed"
        } else if run.status == "failed" {
            "failed"
        } else {
            "idle"
        };
        reconcile_conversation_status(
            &transaction,
            &run.conversation_id,
            fallback_status,
            &input.updated_at,
        )?;
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
    reconcile_conversation_status(
        &transaction,
        &input.conversation_id,
        if input.status == "rejected" {
            "idle"
        } else {
            "waiting_user"
        },
        &input.created_at,
    )?;
    let artifact = transaction.query_row("SELECT card_id, conversation_id, turn_id, run_id, artifact_id, artifact_type, title, summary, content, status, created_at FROM conversation_artifact_cards WHERE card_id=?1", params![input.card_id], artifact_from_row).map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(artifact)
}

pub fn recover_interrupted_runs(
    connection: &mut Connection,
    input: RecoverRunsInput,
) -> Result<i64, AppError> {
    recover_interrupted_runs_excluding(connection, input, &std::collections::HashSet::new())
}

pub fn recover_interrupted_runs_excluding(
    connection: &mut Connection,
    input: RecoverRunsInput,
    protected_run_ids: &std::collections::HashSet<String>,
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
        rows.into_iter()
            .filter(|(run_id, _)| !protected_run_ids.contains(run_id))
            .collect()
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
        reconcile_conversation_status(&transaction, conversation_id, "failed", &input.finished_at)?;
    }
    transaction.commit().map_err(AppError::database)?;
    Ok(active_runs.len() as i64)
}

pub(crate) fn decision_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<ArtifactDecisionRecord> {
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
    let transaction = connection.transaction().map_err(AppError::database)?;
    let exact_candidate_identity: bool = transaction
        .query_row(
            "SELECT EXISTS(
                SELECT 1
                FROM conversation_artifact_cards AS card
                JOIN result_artifacts AS artifact
                  ON artifact.artifact_id = card.artifact_id
                WHERE card.card_id = ?1
                  AND card.conversation_id = ?2
                  AND card.artifact_id = ?3
                  AND artifact.content_hash = ?4
                  AND artifact.processing_status IN ('valid', 'valid_with_warnings')
            )",
            params![
                &input.card_id,
                &input.conversation_id,
                &input.artifact_id,
                &input.artifact_hash
            ],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if !exact_candidate_identity {
        return Err(AppError::new(
            "ARTIFACT_DECISION_SCOPE_MISMATCH",
            "产物决定与候选卡片、任务或内容哈希不一致",
            false,
        ));
    }
    let existing = transaction
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
        reconcile_conversation_status(
            &transaction,
            &existing.conversation_id,
            decision_fallback_status(&existing),
            &existing.created_at,
        )?;
        transaction.commit().map_err(AppError::database)?;
        return Ok(existing);
    }
    transaction
        .execute(
            "INSERT INTO artifact_decisions (
                decision_id, artifact_id, artifact_hash, card_id, conversation_id, decision,
                idempotency_key, actor, target_type, target_id, base_revision,
                apply_transaction_id, conflict_code, created_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![
                &input.decision_id,
                &input.artifact_id,
                &input.artifact_hash,
                &input.card_id,
                &input.conversation_id,
                &input.decision,
                &input.idempotency_key,
                &input.actor,
                &input.target_type,
                &input.target_id,
                &input.base_revision,
                &input.apply_transaction_id,
                &input.conflict_code,
                &input.created_at
            ],
        )
        .map_err(AppError::database)?;
    let decision = transaction
        .query_row(
            "SELECT decision_id, artifact_id, artifact_hash, card_id, conversation_id, decision, idempotency_key, actor, target_type, target_id, base_revision, apply_transaction_id, conflict_code, created_at
             FROM artifact_decisions WHERE decision_id=?1",
            params![input.decision_id],
            decision_from_row,
        )
        .map_err(AppError::database)?;
    reconcile_conversation_status(
        &transaction,
        &decision.conversation_id,
        decision_fallback_status(&decision),
        &decision.created_at,
    )?;
    transaction.commit().map_err(AppError::database)?;
    Ok(decision)
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
    let conversation_id = transaction
        .query_row(
            "SELECT conversation_id FROM artifact_decisions WHERE decision_id=?1",
            params![decision_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(AppError::database)?;
    reconcile_conversation_status(transaction, &conversation_id, "completed", completed_at)
}

fn ensure_chapter_summary_follow_up(
    transaction: &Transaction<'_>,
    authorization: &ReviewAuthorizationRecord,
    adopted_draft_id: &str,
    created_at: &str,
) -> Result<ChapterSummaryFollowUp, AppError> {
    let summary_ready = transaction
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM chapter_summaries
                WHERE chapter_id=?1 AND adopted_draft_id=?2 AND enabled=1 AND is_expired=0
             )",
            params![authorization.chapter_id, adopted_draft_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(AppError::database)?;
    if summary_ready {
        return Ok(ChapterSummaryFollowUp {
            status: "ready".to_string(),
            next_action: None,
            instruction: None,
            chapter_id: authorization.chapter_id.clone(),
            adopted_draft_id: adopted_draft_id.to_string(),
        });
    }

    let conversation_id = transaction
        .query_row(
            "SELECT conversation_id FROM artifact_decisions WHERE decision_id=?1",
            params![authorization.decision_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(AppError::database)?;
    let turn_id = format!("summary-generation-{}", authorization.authorization_id);
    let turn_content = concat!(
        "总结本章",
        "\n\n[[ANS_WORKBENCH_TURN:v1;origin=workbench_chapter_summary]]",
        "\n工作台说明：这是章节正文采用后发起的自动总结回合，不是用户的新消息。"
    );
    let existing_turn = transaction
        .query_row(
            "SELECT conversation_id,role,content FROM conversation_turns WHERE turn_id=?1",
            params![&turn_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?;
    if let Some((existing_conversation_id, existing_role, existing_content)) = existing_turn {
        if existing_conversation_id != conversation_id
            || existing_role != "user"
            || existing_content != turn_content
        {
            return Err(AppError::new(
                "CHAPTER_SUMMARY_TURN_IDENTITY_CONFLICT",
                "章节总结自动回合与既有回合身份不一致",
                false,
            ));
        }
        return Ok(ChapterSummaryFollowUp {
            status: "pending_generation".to_string(),
            next_action: Some("summarize_chapter".to_string()),
            instruction: Some("总结本章".to_string()),
            chapter_id: authorization.chapter_id.clone(),
            adopted_draft_id: adopted_draft_id.to_string(),
        });
    }
    let sequence = transaction
        .query_row(
            "SELECT COALESCE(MAX(sequence),-1)+1 FROM conversation_turns WHERE conversation_id=?1",
            params![conversation_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "INSERT INTO conversation_turns
             (turn_id,conversation_id,sequence,role,content,run_id,created_at)
             VALUES (?1,?2,?3,'user',?4,NULL,?5)",
            params![turn_id, conversation_id, sequence, turn_content, created_at,],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "UPDATE task_conversations SET status='idle',updated_at=?2 WHERE conversation_id=?1",
            params![conversation_id, created_at],
        )
        .map_err(AppError::database)?;

    Ok(ChapterSummaryFollowUp {
        status: "pending_generation".to_string(),
        next_action: Some("summarize_chapter".to_string()),
        instruction: Some("总结本章".to_string()),
        chapter_id: authorization.chapter_id.clone(),
        adopted_draft_id: adopted_draft_id.to_string(),
    })
}

pub fn ensure_chapter_summary_follow_up_for_authorization(
    connection: &mut Connection,
    authorization_id: &str,
) -> Result<ChapterSummaryFollowUp, AppError> {
    let created_at = chrono::Utc::now().to_rfc3339();
    let transaction = connection.transaction().map_err(AppError::database)?;
    let authorization = transaction
        .query_row(
            "SELECT authorization_id, artifact_id, chapter_id, novel_id, decision_id, status, issued_at, consumed_at, consumed_by_draft_id
             FROM review_authorizations WHERE authorization_id=?1",
            params![authorization_id],
            authorization_from_row,
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| {
            AppError::new(
                "REVIEW_AUTHORIZATION_NOT_FOUND",
                "审阅授权不存在",
                false,
            )
        })?;
    if authorization.status != "consumed" {
        return Err(AppError::new(
            "REVIEW_AUTHORIZATION_NOT_CONSUMED",
            "章节总结只能在审阅授权消费后准备",
            false,
        ));
    }
    let adopted_draft_id = authorization
        .consumed_by_draft_id
        .as_deref()
        .ok_or_else(|| {
            AppError::new(
                "REVIEW_ADOPTED_DRAFT_MISSING",
                "已消费审阅授权缺少采用稿引用",
                false,
            )
        })?;
    let adoption_matches = transaction
        .query_row(
            "SELECT EXISTS(
                SELECT 1
                FROM chapters AS chapter
                JOIN chapter_drafts AS draft
                  ON draft.id=chapter.adopted_draft_id
                 AND draft.chapter_id=chapter.id
                 AND draft.novel_id=chapter.novel_id
                WHERE chapter.id=?1
                  AND chapter.novel_id=?2
                  AND chapter.adopted_draft_id=?3
                  AND chapter.deleted_at IS NULL
                  AND draft.is_adopted=1
             )",
            params![
                &authorization.chapter_id,
                &authorization.novel_id,
                adopted_draft_id
            ],
            |row| row.get::<_, bool>(0),
        )
        .map_err(AppError::database)?;
    if !adoption_matches {
        return Err(AppError::new(
            "REVIEW_ADOPTION_FACT_MISMATCH",
            "审阅授权与章节正式采用事实不一致",
            false,
        ));
    }

    let follow_up = ensure_chapter_summary_follow_up(
        &transaction,
        &authorization,
        adopted_draft_id,
        &created_at,
    )?;
    transaction.commit().map_err(AppError::database)?;
    Ok(follow_up)
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
            crate::services::memory_service::put_review_adopted_draft_in_transaction(
                &transaction,
                &draft,
                &full_content,
                &authorization.authorization_id,
                &now,
            )?;
            complete_review_conversation(&transaction, &authorization.decision_id, &now)?;
            let summary_follow_up =
                ensure_chapter_summary_follow_up(&transaction, &authorization, &draft.id, &now)?;
            transaction.commit().map_err(AppError::database)?;
            return Ok(AdoptReviewAuthorizedDraftResult {
                authorization,
                adopted_draft: draft,
                summary_follow_up,
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

    crate::services::memory_service::put_review_adopted_draft_in_transaction(
        &transaction,
        &adopted_draft,
        &full_content,
        &authorization.authorization_id,
        &now,
    )?;

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
    let summary_follow_up =
        ensure_chapter_summary_follow_up(&transaction, &authorization, &adopted_draft.id, &now)?;

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
        summary_follow_up,
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
    let runs = connection.prepare("SELECT run_id, conversation_id, turn_id, status, model_snapshot_json, worker_id, error, created_at, updated_at, started_at, finished_at FROM task_runs WHERE conversation_id=?1 ORDER BY created_at, rowid").map_err(AppError::database)?.query_map(params![id], run_from_row).map_err(AppError::database)?.collect::<Result<Vec<_>, _>>().map_err(AppError::database)?;
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

    #[test]
    fn legacy_model_lock_accepts_hydrated_endpoint_but_new_locks_remain_strict() {
        let legacy = json!({
            "providerId": "deepseek",
            "modelId": "deepseek-chat",
            "runtimeMode": "api"
        });
        let hydrated = json!({
            "providerId": "deepseek-official",
            "modelId": "deepseek-chat",
            "runtimeMode": "api",
            "baseUrl": "https://api.deepseek.com/v1/"
        });
        assert!(model_lock_matches(&legacy, &hydrated));
        let upgraded = upgrade_legacy_model_lock_endpoint(&legacy, &hydrated)
            .expect("legacy endpoint upgrade");
        assert_eq!(
            upgraded.get("baseUrl").and_then(Value::as_str),
            Some("https://api.deepseek.com/v1")
        );

        let endpoint_locked = json!({
            "providerId": "deepseek-official",
            "modelId": "deepseek-chat",
            "runtimeMode": "api",
            "baseUrl": "https://api.deepseek.com/v1"
        });
        let different_endpoint = json!({
            "providerId": "deepseek-official",
            "modelId": "deepseek-chat",
            "runtimeMode": "api",
            "baseUrl": "https://provider.invalid/v1"
        });
        assert!(!model_lock_matches(&endpoint_locked, &different_endpoint));
        assert!(
            upgrade_legacy_model_lock_endpoint(&endpoint_locked, &different_endpoint).is_none()
        );
        assert!(!model_lock_matches(
            &legacy,
            &json!({
                "providerId": "deepseek-official",
                "modelId": "different-model",
                "runtimeMode": "api",
                "baseUrl": "https://api.deepseek.com/v1"
            })
        ));
        assert!(!model_lock_matches(&endpoint_locked, &legacy));

        let mut connection = connection();
        let conversation = create_conversation(
            &mut connection,
            CreateConversationInput {
                conversation_id: "legacy-model-lock".to_string(),
                novel_id: "novel-conversation-test".to_string(),
                title: "旧任务".to_string(),
                default_model: Some(legacy),
                created_at: "2026-08-20T00:00:01Z".to_string(),
            },
        )
        .expect("legacy conversation");
        let first_turn = append_turn(
            &mut connection,
            AppendTurnInput {
                turn_id: "legacy-turn-1".to_string(),
                conversation_id: conversation.conversation_id.clone(),
                role: "user".to_string(),
                content: "继续".to_string(),
                created_at: "2026-08-20T00:00:02Z".to_string(),
            },
        )
        .expect("legacy turn");
        create_run(
            &mut connection,
            CreateRunInput {
                run_id: "legacy-run-1".to_string(),
                conversation_id: conversation.conversation_id.clone(),
                turn_id: first_turn.turn_id,
                model_snapshot: hydrated,
                worker_id: "legacy-worker-1".to_string(),
                created_at: "2026-08-20T00:00:03Z".to_string(),
            },
        )
        .expect("hydrated legacy run");
        let stored_model: String = connection
            .query_row(
                "SELECT default_model_json FROM task_conversations WHERE conversation_id=?1",
                params![conversation.conversation_id],
                |row| row.get(0),
            )
            .expect("stored upgraded lock");
        assert_eq!(
            serde_json::from_str::<Value>(&stored_model)
                .expect("stored model json")
                .get("baseUrl")
                .and_then(Value::as_str),
            Some("https://api.deepseek.com/v1")
        );
        let second_turn = append_turn(
            &mut connection,
            AppendTurnInput {
                turn_id: "legacy-turn-2".to_string(),
                conversation_id: conversation.conversation_id.clone(),
                role: "user".to_string(),
                content: "再继续".to_string(),
                created_at: "2026-08-20T00:00:04Z".to_string(),
            },
        )
        .expect("second legacy turn");
        let mismatch = create_run(
            &mut connection,
            CreateRunInput {
                run_id: "legacy-run-2".to_string(),
                conversation_id: conversation.conversation_id,
                turn_id: second_turn.turn_id,
                model_snapshot: different_endpoint,
                worker_id: "legacy-worker-2".to_string(),
                created_at: "2026-08-20T00:00:05Z".to_string(),
            },
        )
        .expect_err("upgraded legacy endpoint must remain locked");
        assert_eq!(mismatch.code, "TASK_RUN_MODEL_MISMATCH");
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

    fn conversation_status(connection: &Connection, conversation_id: &str) -> String {
        connection
            .query_row(
                "SELECT status FROM task_conversations WHERE conversation_id=?1",
                params![conversation_id],
                |row| row.get(0),
            )
            .expect("conversation status")
    }

    #[test]
    fn task_runtime_scope_binds_conversation_turn_novel_and_chapter() {
        let mut connection = connection();
        connection
            .execute(
                "INSERT INTO novels (id, title, outline, created_at, updated_at)
                 VALUES ('novel-other', '其他小说', '', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z')",
                [],
            )
            .expect("other novel");
        connection
            .execute(
                "INSERT INTO chapters (id, novel_id, title, order_index, status, word_count, created_at, updated_at)
                 VALUES ('chapter-owned', 'novel-conversation-test', '本书章节', 1, 'drafted', 0, '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z'),
                        ('chapter-other', 'novel-other', '他书章节', 1, 'drafted', 0, '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z')",
                [],
            )
            .expect("chapters");
        create_conversation(
            &mut connection,
            CreateConversationInput {
                conversation_id: "conversation-scope".to_string(),
                novel_id: "novel-conversation-test".to_string(),
                title: "作用域测试".to_string(),
                default_model: None,
                created_at: "2026-08-20T00:00:00Z".to_string(),
            },
        )
        .expect("conversation");
        append_turn(
            &mut connection,
            AppendTurnInput {
                turn_id: "turn-scope-user".to_string(),
                conversation_id: "conversation-scope".to_string(),
                role: "user".to_string(),
                content: "读取本章".to_string(),
                created_at: "2026-08-20T00:00:01Z".to_string(),
            },
        )
        .expect("user turn");
        append_turn(
            &mut connection,
            AppendTurnInput {
                turn_id: "turn-scope-assistant".to_string(),
                conversation_id: "conversation-scope".to_string(),
                role: "assistant".to_string(),
                content: "不可作为运行输入".to_string(),
                created_at: "2026-08-20T00:00:02Z".to_string(),
            },
        )
        .expect("assistant turn");

        let authoritative_goal = validate_task_runtime_scope(
            &connection,
            "conversation-scope",
            "turn-scope-user",
            "novel-conversation-test",
            Some("chapter-owned"),
        )
        .expect("valid scoped task");
        assert_eq!(authoritative_goal, "读取本章");
        let authoritative_goal = validate_task_runtime_scope(
            &connection,
            "conversation-scope",
            "turn-scope-user",
            "novel-conversation-test",
            None,
        )
        .expect("novel-scoped task without chapter");
        assert_eq!(authoritative_goal, "读取本章");

        for error in [
            validate_task_runtime_scope(
                &connection,
                "conversation-scope",
                "turn-scope-user",
                "novel-other",
                None,
            )
            .expect_err("cross-novel input must fail"),
            validate_task_runtime_scope(
                &connection,
                "conversation-scope",
                "turn-scope-user",
                "novel-conversation-test",
                Some("chapter-other"),
            )
            .expect_err("cross-novel chapter must fail"),
            validate_task_runtime_scope(
                &connection,
                "conversation-scope",
                "turn-scope-assistant",
                "novel-conversation-test",
                None,
            )
            .expect_err("non-user turn must fail"),
        ] {
            assert_eq!(error.code, "TASK_RUNTIME_SCOPE_MISMATCH");
            assert!(!error.message.contains("novel-other"));
            assert!(!error.message.contains("chapter-other"));
        }
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
                default_model: None,
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
                    "runtime":{"adapterProtocol":"ans_task_session_v2"},
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
        let locked_error = update_conversation_model(
            &mut connection,
            UpdateConversationModelInput {
                conversation_id: conversation.conversation_id.clone(),
                default_model: json!({"providerId":"mock","modelId":"Mock"}),
                updated_at: "2026-08-20T00:00:01Z".to_string(),
            },
        )
        .expect_err("frozen model replacement must fail");
        assert_eq!(locked_error.code, "CONVERSATION_MODEL_LOCKED");
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
        let mismatch = create_run(
            &mut connection,
            CreateRunInput {
                run_id: "run-model-mismatch".to_string(),
                conversation_id: conversation.conversation_id.clone(),
                turn_id: turn.turn_id.clone(),
                model_snapshot: json!({"providerId":"mock","modelId":"Mock"}),
                worker_id: "worker-model-mismatch".to_string(),
                created_at: "2026-08-20T00:00:03Z".to_string(),
            },
        )
        .expect_err("mismatched run model must fail");
        assert_eq!(mismatch.code, "TASK_RUN_MODEL_MISMATCH");
        let run = create_run(
            &mut connection,
            CreateRunInput {
                run_id: "run-1".to_string(),
                conversation_id: conversation.conversation_id.clone(),
                turn_id: turn.turn_id,
                model_snapshot: conversation.default_model.clone().expect("locked model"),
                worker_id: "worker-1".to_string(),
                created_at: "2026-08-20T00:00:03Z".to_string(),
            },
        )
        .expect("run");
        assert!(run
            .model_snapshot
            .pointer("/runtime/toolCallingAttestation")
            .is_none());
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
    fn candidate_card_atomically_waits_and_terminal_runs_cannot_overwrite_it() {
        let mut connection = connection();
        connection
            .execute(
                "INSERT INTO chapters (id, novel_id, title, order_index, status, word_count, created_at, updated_at)
                 VALUES ('chapter-status', 'novel-conversation-test', '状态章节', 1, 'drafted', 0, '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z')",
                [],
            )
            .expect("status chapter");
        let artifact_hash = insert_valid_chapter_artifact(
            &connection,
            "artifact-status",
            "novel-conversation-test",
            "chapter-status",
            "待确认正文",
        );
        assert!(!artifact_hash.is_empty());
        create_conversation(
            &mut connection,
            CreateConversationInput {
                conversation_id: "conversation-status".to_string(),
                novel_id: "novel-conversation-test".to_string(),
                title: "候选状态".to_string(),
                default_model: None,
                created_at: "2026-08-28T00:00:00Z".to_string(),
            },
        )
        .expect("conversation");
        let turn = append_turn(
            &mut connection,
            AppendTurnInput {
                turn_id: "turn-status-completed".to_string(),
                conversation_id: "conversation-status".to_string(),
                role: "user".to_string(),
                content: "生成候选".to_string(),
                created_at: "2026-08-28T00:00:01Z".to_string(),
            },
        )
        .expect("turn");
        let run = create_run(
            &mut connection,
            CreateRunInput {
                run_id: "run-status-completed".to_string(),
                conversation_id: "conversation-status".to_string(),
                turn_id: turn.turn_id,
                model_snapshot: json!({"providerId":"mock","modelId":"Mock"}),
                worker_id: "worker-status".to_string(),
                created_at: "2026-08-28T00:00:02Z".to_string(),
            },
        )
        .expect("run");
        update_run(
            &mut connection,
            UpdateRunInput {
                run_id: run.run_id.clone(),
                status: "running".to_string(),
                error: None,
                updated_at: "2026-08-28T00:00:03Z".to_string(),
                started_at: Some("2026-08-28T00:00:03Z".to_string()),
                finished_at: None,
            },
        )
        .expect("running");
        create_artifact_card(
            &mut connection,
            CreateArtifactCardInput {
                card_id: "card-status".to_string(),
                conversation_id: "conversation-status".to_string(),
                turn_id: Some("turn-status-completed".to_string()),
                run_id: Some(run.run_id.clone()),
                artifact_id: Some("artifact-status".to_string()),
                artifact_type: "chapter_text".to_string(),
                title: "章节候选".to_string(),
                summary: "等待确认".to_string(),
                content: None,
                status: "candidate".to_string(),
                created_at: "2026-08-28T00:00:04Z".to_string(),
            },
        )
        .expect("candidate card");
        assert_eq!(
            conversation_status(&connection, "conversation-status"),
            "waiting_user"
        );

        update_run(
            &mut connection,
            UpdateRunInput {
                run_id: run.run_id,
                status: "completed".to_string(),
                error: None,
                updated_at: "2026-08-28T00:00:05Z".to_string(),
                started_at: None,
                finished_at: Some("2026-08-28T00:00:05Z".to_string()),
            },
        )
        .expect("completed");
        assert_eq!(
            conversation_status(&connection, "conversation-status"),
            "waiting_user"
        );

        for (suffix, terminal) in [("failed", "failed"), ("cancelled", "cancelled")] {
            let turn_id = format!("turn-status-{suffix}");
            append_turn(
                &mut connection,
                AppendTurnInput {
                    turn_id: turn_id.clone(),
                    conversation_id: "conversation-status".to_string(),
                    role: "user".to_string(),
                    content: format!("{suffix} run"),
                    created_at: format!("2026-08-28T00:01:0{}Z", suffix.len() % 10),
                },
            )
            .expect("terminal turn");
            let run_id = format!("run-status-{suffix}");
            create_run(
                &mut connection,
                CreateRunInput {
                    run_id: run_id.clone(),
                    conversation_id: "conversation-status".to_string(),
                    turn_id,
                    model_snapshot: json!({"providerId":"mock","modelId":"Mock"}),
                    worker_id: "worker-status".to_string(),
                    created_at: format!("2026-08-28T00:02:0{}Z", suffix.len() % 10),
                },
            )
            .expect("terminal run");
            update_run(
                &mut connection,
                UpdateRunInput {
                    run_id,
                    status: terminal.to_string(),
                    error: (terminal == "failed").then(|| "failed".to_string()),
                    updated_at: format!("2026-08-28T00:03:0{}Z", suffix.len() % 10),
                    started_at: None,
                    finished_at: Some(format!("2026-08-28T00:03:0{}Z", suffix.len() % 10)),
                },
            )
            .expect("terminalize run");
            assert_eq!(
                conversation_status(&connection, "conversation-status"),
                "waiting_user"
            );
        }

        let recovery_turn = append_turn(
            &mut connection,
            AppendTurnInput {
                turn_id: "turn-status-recovery".to_string(),
                conversation_id: "conversation-status".to_string(),
                role: "user".to_string(),
                content: "recovery run".to_string(),
                created_at: "2026-08-28T00:04:00Z".to_string(),
            },
        )
        .expect("recovery turn");
        create_run(
            &mut connection,
            CreateRunInput {
                run_id: "run-status-recovery".to_string(),
                conversation_id: "conversation-status".to_string(),
                turn_id: recovery_turn.turn_id,
                model_snapshot: json!({"providerId":"mock","modelId":"Mock"}),
                worker_id: "worker-status".to_string(),
                created_at: "2026-08-28T00:04:01Z".to_string(),
            },
        )
        .expect("recovery run");
        recover_interrupted_runs(
            &mut connection,
            RecoverRunsInput {
                finished_at: "2026-08-28T00:04:02Z".to_string(),
                error: "interrupted".to_string(),
            },
        )
        .expect("recover");
        assert_eq!(
            conversation_status(&connection, "conversation-status"),
            "waiting_user"
        );

        let _ = insert_valid_chapter_artifact(
            &connection,
            "artifact-status-rollback",
            "novel-conversation-test",
            "chapter-status",
            "不应提交的正文",
        );
        create_conversation(
            &mut connection,
            CreateConversationInput {
                conversation_id: "conversation-status-rollback".to_string(),
                novel_id: "novel-conversation-test".to_string(),
                title: "回滚状态".to_string(),
                default_model: None,
                created_at: "2026-08-28T00:05:00Z".to_string(),
            },
        )
        .expect("rollback conversation");
        connection
            .execute_batch(
                "CREATE TRIGGER test_block_waiting_user
                 BEFORE UPDATE OF status ON task_conversations
                 WHEN NEW.conversation_id='conversation-status-rollback'
                  AND NEW.status='waiting_user'
                 BEGIN SELECT RAISE(ABORT, 'blocked waiting state'); END;",
            )
            .expect("block waiting status");
        let blocked = create_artifact_card(
            &mut connection,
            CreateArtifactCardInput {
                card_id: "card-status-rollback".to_string(),
                conversation_id: "conversation-status-rollback".to_string(),
                turn_id: None,
                run_id: None,
                artifact_id: Some("artifact-status-rollback".to_string()),
                artifact_type: "chapter_text".to_string(),
                title: "不应提交".to_string(),
                summary: "回滚".to_string(),
                content: None,
                status: "candidate".to_string(),
                created_at: "2026-08-28T00:05:01Z".to_string(),
            },
        );
        assert!(blocked.is_err());
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM conversation_artifact_cards WHERE card_id='card-status-rollback'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("rolled back card count"),
            0
        );
        assert_eq!(
            conversation_status(&connection, "conversation-status-rollback"),
            "idle"
        );
    }

    #[test]
    fn resolved_candidates_reconcile_without_hiding_other_pending_cards() {
        let mut connection = connection();
        connection
            .execute(
                "INSERT INTO chapters (id, novel_id, title, order_index, status, word_count, created_at, updated_at)
                 VALUES ('chapter-resolution', 'novel-conversation-test', '决定章节', 1, 'drafted', 0, '2026-08-28T01:00:00Z', '2026-08-28T01:00:00Z')",
                [],
            )
            .expect("resolution chapter");
        let first_hash = insert_valid_chapter_artifact(
            &connection,
            "artifact-resolution-1",
            "novel-conversation-test",
            "chapter-resolution",
            "第一份候选",
        );
        let second_hash = insert_valid_chapter_artifact(
            &connection,
            "artifact-resolution-2",
            "novel-conversation-test",
            "chapter-resolution",
            "第二份候选",
        );
        create_conversation(
            &mut connection,
            CreateConversationInput {
                conversation_id: "conversation-resolution".to_string(),
                novel_id: "novel-conversation-test".to_string(),
                title: "多候选决定".to_string(),
                default_model: None,
                created_at: "2026-08-28T01:00:00Z".to_string(),
            },
        )
        .expect("conversation");
        for (card_id, artifact_id) in [
            ("card-resolution-1", "artifact-resolution-1"),
            ("card-resolution-2", "artifact-resolution-2"),
        ] {
            create_artifact_card(
                &mut connection,
                CreateArtifactCardInput {
                    card_id: card_id.to_string(),
                    conversation_id: "conversation-resolution".to_string(),
                    turn_id: None,
                    run_id: None,
                    artifact_id: Some(artifact_id.to_string()),
                    artifact_type: "chapter_text".to_string(),
                    title: "章节候选".to_string(),
                    summary: "待处理".to_string(),
                    content: None,
                    status: "candidate".to_string(),
                    created_at: "2026-08-28T01:00:01Z".to_string(),
                },
            )
            .expect("candidate");
        }
        let mismatch = record_artifact_decision(
            &mut connection,
            RecordArtifactDecisionInput {
                decision_id: "decision-resolution-mismatch".to_string(),
                artifact_id: "artifact-resolution-1".to_string(),
                artifact_hash: second_hash.clone(),
                card_id: "card-resolution-1".to_string(),
                conversation_id: "conversation-resolution".to_string(),
                decision: "reject".to_string(),
                idempotency_key: "card-resolution-1:mismatch".to_string(),
                actor: "user".to_string(),
                target_type: "asset".to_string(),
                target_id: "novel-conversation-test".to_string(),
                base_revision: None,
                apply_transaction_id: None,
                conflict_code: None,
                created_at: "2026-08-28T01:00:02Z".to_string(),
            },
        )
        .expect_err("mismatched hash cannot resolve candidate");
        assert_eq!(mismatch.code, "ARTIFACT_DECISION_SCOPE_MISMATCH");
        assert_eq!(
            conversation_status(&connection, "conversation-resolution"),
            "waiting_user"
        );
        record_artifact_decision(
            &mut connection,
            RecordArtifactDecisionInput {
                decision_id: "decision-resolution-reject".to_string(),
                artifact_id: "artifact-resolution-1".to_string(),
                artifact_hash: first_hash,
                card_id: "card-resolution-1".to_string(),
                conversation_id: "conversation-resolution".to_string(),
                decision: "reject".to_string(),
                idempotency_key: "card-resolution-1:reject".to_string(),
                actor: "user".to_string(),
                target_type: "asset".to_string(),
                target_id: "novel-conversation-test".to_string(),
                base_revision: None,
                apply_transaction_id: None,
                conflict_code: None,
                created_at: "2026-08-28T01:00:02Z".to_string(),
            },
        )
        .expect("reject first");
        assert_eq!(
            conversation_status(&connection, "conversation-resolution"),
            "waiting_user"
        );
        record_artifact_decision(
            &mut connection,
            RecordArtifactDecisionInput {
                decision_id: "decision-resolution-revise".to_string(),
                artifact_id: "artifact-resolution-2".to_string(),
                artifact_hash: second_hash,
                card_id: "card-resolution-2".to_string(),
                conversation_id: "conversation-resolution".to_string(),
                decision: "request_revision".to_string(),
                idempotency_key: "card-resolution-2:request_revision".to_string(),
                actor: "user".to_string(),
                target_type: "asset".to_string(),
                target_id: "novel-conversation-test".to_string(),
                base_revision: None,
                apply_transaction_id: None,
                conflict_code: None,
                created_at: "2026-08-28T01:00:03Z".to_string(),
            },
        )
        .expect("request revision second");
        assert_eq!(
            conversation_status(&connection, "conversation-resolution"),
            "idle"
        );
    }

    #[test]
    fn bundle_orders_same_timestamp_runs_by_insertion() {
        let mut connection = connection();
        create_conversation(
            &mut connection,
            CreateConversationInput {
                conversation_id: "conversation-run-order".to_string(),
                novel_id: "novel-conversation-test".to_string(),
                title: "运行顺序".to_string(),
                default_model: None,
                created_at: "2026-08-28T02:00:00Z".to_string(),
            },
        )
        .expect("conversation");
        let turn = append_turn(
            &mut connection,
            AppendTurnInput {
                turn_id: "turn-run-order".to_string(),
                conversation_id: "conversation-run-order".to_string(),
                role: "user".to_string(),
                content: "重试".to_string(),
                created_at: "2026-08-28T02:00:01Z".to_string(),
            },
        )
        .expect("turn");
        for run_id in ["run-order-first", "run-order-second"] {
            let run = create_run(
                &mut connection,
                CreateRunInput {
                    run_id: run_id.to_string(),
                    conversation_id: "conversation-run-order".to_string(),
                    turn_id: turn.turn_id.clone(),
                    model_snapshot: json!({"providerId":"mock","modelId":"Mock"}),
                    worker_id: "worker-run-order".to_string(),
                    created_at: "2026-08-28T02:00:02.000Z".to_string(),
                },
            )
            .expect("run");
            if run_id == "run-order-first" {
                update_run(
                    &mut connection,
                    UpdateRunInput {
                        run_id: run.run_id,
                        status: "failed".to_string(),
                        error: Some("retry".to_string()),
                        updated_at: "2026-08-28T02:00:03.000Z".to_string(),
                        started_at: None,
                        finished_at: Some("2026-08-28T02:00:03.000Z".to_string()),
                    },
                )
                .expect("terminalize first retry");
            }
        }
        let bundle = get_bundle(&connection, "conversation-run-order")
            .expect("bundle")
            .expect("conversation bundle");
        assert_eq!(
            bundle
                .runs
                .iter()
                .map(|run| run.run_id.as_str())
                .collect::<Vec<_>>(),
            vec!["run-order-first", "run-order-second"]
        );
        let projection =
            get_turn_run_projection(&connection, "conversation-run-order", "turn-run-order")
                .expect("turn run projection")
                .expect("existing turn projection");
        assert_eq!(projection.turn.turn_id, "turn-run-order");
        assert_eq!(projection.turn.content, "重试");
        assert_eq!(
            projection
                .runs
                .iter()
                .map(|run| run.run_id.as_str())
                .collect::<Vec<_>>(),
            vec!["run-order-first", "run-order-second"]
        );
        assert!(get_turn_run_projection(
            &connection,
            "conversation-run-order",
            "missing-turn-run-order",
        )
        .expect("missing projection query")
        .is_none());
        assert!(get_turn_run_projection(
            &connection,
            "missing-conversation-run-order",
            "turn-run-order",
        )
        .expect("cross-conversation projection query")
        .is_none());
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
    fn recovery_preserves_runs_owned_by_a_live_process_runtime() {
        let mut connection = connection();
        for (conversation_id, turn_id, run_id, run_status) in [
            (
                "conversation-live-queued",
                "turn-live-queued",
                "run-live-queued",
                "queued",
            ),
            (
                "conversation-live-running",
                "turn-live-running",
                "run-live-running",
                "running",
            ),
            (
                "conversation-live-cancelling",
                "turn-live-cancelling",
                "run-live-cancelling",
                "cancel_requested",
            ),
            (
                "conversation-dead-runtime",
                "turn-dead-runtime",
                "run-dead-runtime",
                "running",
            ),
        ] {
            create_conversation(
                &mut connection,
                CreateConversationInput {
                    conversation_id: conversation_id.to_string(),
                    novel_id: "novel-conversation-test".to_string(),
                    title: conversation_id.to_string(),
                    default_model: None,
                    created_at: "2026-08-20T01:00:00Z".to_string(),
                },
            )
            .expect("conversation");
            append_turn(
                &mut connection,
                AppendTurnInput {
                    turn_id: turn_id.to_string(),
                    conversation_id: conversation_id.to_string(),
                    role: "user".to_string(),
                    content: "继续任务".to_string(),
                    created_at: "2026-08-20T01:00:01Z".to_string(),
                },
            )
            .expect("turn");
            let run = create_run(
                &mut connection,
                CreateRunInput {
                    run_id: run_id.to_string(),
                    conversation_id: conversation_id.to_string(),
                    turn_id: turn_id.to_string(),
                    model_snapshot: json!({"providerId":"mock","modelId":"Mock"}),
                    worker_id: format!("worker-{run_id}"),
                    created_at: "2026-08-20T01:00:02Z".to_string(),
                },
            )
            .expect("run");
            if run_status != "queued" {
                update_run(
                    &mut connection,
                    UpdateRunInput {
                        run_id: run.run_id,
                        status: run_status.to_string(),
                        error: None,
                        updated_at: "2026-08-20T01:00:03Z".to_string(),
                        started_at: (run_status == "running")
                            .then(|| "2026-08-20T01:00:03Z".to_string()),
                        finished_at: None,
                    },
                )
                .expect("set persisted active state");
            }
        }

        let protected = std::collections::HashSet::from([
            "run-live-queued".to_string(),
            "run-live-running".to_string(),
            "run-live-cancelling".to_string(),
        ]);
        let recovered = recover_interrupted_runs_excluding(
            &mut connection,
            RecoverRunsInput {
                finished_at: "2026-08-20T01:01:00Z".to_string(),
                error: "应用进程已重启，上一轮运行已中断。".to_string(),
            },
            &protected,
        )
        .expect("scoped recovery");

        assert_eq!(recovered, 1);
        for (conversation_id, expected_status) in [
            ("conversation-live-queued", "queued"),
            ("conversation-live-running", "running"),
            ("conversation-live-cancelling", "cancel_requested"),
        ] {
            let live = get_bundle(&connection, conversation_id)
                .expect("live bundle")
                .expect("live conversation");
            assert_eq!(live.conversation.status, "running");
            assert_eq!(live.runs[0].status, expected_status);
        }
        let interrupted = get_bundle(&connection, "conversation-dead-runtime")
            .expect("interrupted bundle")
            .expect("interrupted conversation");
        assert_eq!(interrupted.conversation.status, "failed");
        assert_eq!(interrupted.runs[0].status, "failed");
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
        assert_eq!(
            conversation_status(&connection, "conv-adopt-test"),
            "waiting_user"
        );

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
            .execute(
                "INSERT INTO memory_documents (
                    id, novel_id, source_type, source_id, source_version, source_hash,
                    adopted_draft_id, chapter_id, status, metadata_json, created_at, updated_at
                 ) VALUES (
                    'memory-old-101', 'novel-conversation-test', 'adopted_draft',
                    'draft-101', 2, ?1, 'draft-101', 'chapter-100', 'active', '{}',
                    '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z'
                 )",
                params![crate::repositories::large_text_repository::sha256(
                    "第二版候选正文内容"
                )],
            )
            .expect("insert previous active memory");

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
        let rolled_back_total: i64 = connection
            .query_row(
                "SELECT total_word_count FROM novels WHERE id='novel-conversation-test'",
                [],
                |row| row.get(0),
            )
            .expect("rolled back novel total");
        assert_eq!(rolled_back_total, 0);
        let rolled_back_conversation_status: String = connection
            .query_row(
                "SELECT status FROM task_conversations WHERE conversation_id='conv-adopt-test'",
                [],
                |row| row.get(0),
            )
            .expect("rolled back conversation status");
        assert_eq!(rolled_back_conversation_status, "waiting_user");
        assert_eq!(
            connection
                .query_row(
                    "SELECT status FROM memory_documents WHERE id='memory-old-101'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .expect("old memory rollback status"),
            "active"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM memory_documents WHERE source_id='draft-100'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("new memory rollback count"),
            0
        );
        connection
            .execute_batch("DROP TRIGGER test_block_authorization_consume;")
            .expect("remove consume failure trigger");

        connection
            .execute_batch(
                "CREATE TRIGGER test_block_authorized_memory_insert
                 BEFORE INSERT ON memory_documents
                 WHEN NEW.source_id = 'draft-100'
                 BEGIN SELECT RAISE(ABORT, 'test memory insert failure'); END;",
            )
            .expect("install memory failure trigger");
        let memory_failure = adopt_review_authorized_draft(
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
        assert!(memory_failure.is_err());
        assert_eq!(
            get_review_authorization(&connection, "auth-adopt-100")
                .expect("authorization after memory failure")
                .expect("authorization remains")
                .status,
            "issued"
        );
        assert!(
            !crate::repositories::chapter_repository::get_draft_by_id_and_chapter_internal(
                &connection,
                "draft-100",
                "chapter-100",
            )
            .expect("draft after memory failure")
            .is_adopted
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT adopted_draft_id FROM chapters WHERE id='chapter-100'",
                    [],
                    |row| row.get::<_, Option<String>>(0),
                )
                .expect("chapter pointer after memory failure"),
            None
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT status FROM memory_documents WHERE id='memory-old-101'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .expect("old memory after insertion failure"),
            "active"
        );
        connection
            .execute_batch("DROP TRIGGER test_block_authorized_memory_insert;")
            .expect("remove memory failure trigger");

        connection
            .execute_batch(
                "CREATE TRIGGER test_block_summary_generation_turn
                 BEFORE INSERT ON conversation_turns
                 WHEN NEW.turn_id = 'summary-generation-auth-adopt-100'
                 BEGIN SELECT RAISE(ABORT, 'test summary turn failure'); END;",
            )
            .expect("install summary turn failure trigger");
        let summary_turn_failure = adopt_review_authorized_draft(
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
        assert!(summary_turn_failure.is_err());
        assert_eq!(
            get_review_authorization(&connection, "auth-adopt-100")
                .expect("authorization after summary turn failure")
                .expect("authorization remains")
                .status,
            "issued"
        );
        assert!(
            !crate::repositories::chapter_repository::get_draft_by_id_and_chapter_internal(
                &connection,
                "draft-100",
                "chapter-100",
            )
            .expect("draft after summary turn failure")
            .is_adopted
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT adopted_draft_id FROM chapters WHERE id='chapter-100'",
                    [],
                    |row| row.get::<_, Option<String>>(0),
                )
                .expect("chapter pointer after summary turn failure"),
            None
        );
        connection
            .execute_batch("DROP TRIGGER test_block_summary_generation_turn;")
            .expect("remove summary turn failure trigger");

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
        assert_eq!(result.summary_follow_up.status, "pending_generation");
        assert_eq!(
            result.summary_follow_up.next_action.as_deref(),
            Some("summarize_chapter")
        );
        assert_eq!(
            result.summary_follow_up.instruction.as_deref(),
            Some("总结本章")
        );

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
        let adopted_total: i64 = connection
            .query_row(
                "SELECT total_word_count FROM novels WHERE id='novel-conversation-test'",
                [],
                |row| row.get(0),
            )
            .expect("query adopted novel total");
        assert_eq!(adopted_total, 500);
        let summary_pending_conversation_status: String = connection
            .query_row(
                "SELECT status FROM task_conversations WHERE conversation_id='conv-adopt-test'",
                [],
                |row| row.get(0),
            )
            .expect("summary pending conversation status");
        assert_eq!(summary_pending_conversation_status, "idle");
        let summary_follow_up_turn: (String, String) = connection
            .query_row(
                "SELECT role,content FROM conversation_turns
                 WHERE turn_id='summary-generation-auth-adopt-100'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("summary follow-up turn");
        assert_eq!(summary_follow_up_turn.0, "user");
        assert!(summary_follow_up_turn.1.starts_with("总结本章"));
        assert!(summary_follow_up_turn
            .1
            .contains("origin=workbench_chapter_summary"));
        let recovered_follow_up =
            ensure_chapter_summary_follow_up_for_authorization(&mut connection, "auth-adopt-100")
                .expect("reconcile summary follow-up");
        assert_eq!(recovered_follow_up.status, "pending_generation");
        ensure_chapter_summary_follow_up_for_authorization(&mut connection, "auth-adopt-100")
            .expect("summary follow-up recovery is idempotent");
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM conversation_turns
                     WHERE turn_id='summary-generation-auth-adopt-100'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("recovered summary turn count"),
            1
        );
        let old_memory_status: (String, Option<String>) = connection
            .query_row(
                "SELECT status, invalidation_reason
                 FROM memory_documents WHERE id='memory-old-101'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("old memory invalidated");
        assert_eq!(old_memory_status.0, "invalidated");
        assert_eq!(
            old_memory_status.1.as_deref(),
            Some("adopted_draft_changed")
        );
        let new_memory: (String, String, i64, String) = connection
            .query_row(
                "SELECT status, source_hash, source_version, adopted_draft_id
                 FROM memory_documents
                 WHERE novel_id='novel-conversation-test'
                   AND chapter_id='chapter-100'
                   AND source_id='draft-100'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("new adopted memory document");
        assert_eq!(new_memory.0, "active");
        assert_eq!(
            new_memory.1,
            crate::repositories::large_text_repository::sha256("第一章测试正文内容")
        );
        assert_eq!(new_memory.2, 1);
        assert_eq!(new_memory.3, "draft-100");
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM memory_chunks
                     WHERE novel_id='novel-conversation-test'
                       AND chapter_id='chapter-100'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("new adopted memory chunks"),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT text FROM memory_chunks
                     WHERE novel_id='novel-conversation-test'
                       AND chapter_id='chapter-100'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .expect("new adopted memory text"),
            "第一章测试正文内容"
        );
        let memory_sequence: (Option<i64>, Option<i64>) = connection
            .query_row(
                "SELECT chapter_order_index, temporal_start_chapter
                   FROM memory_chunks
                  WHERE novel_id='novel-conversation-test'
                    AND chapter_id='chapter-100'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("new adopted memory sequence");
        assert_eq!(memory_sequence, (Some(0), Some(0)));

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
        assert_eq!(replay.summary_follow_up.status, "pending_generation");
        let replayed_total: i64 = connection
            .query_row(
                "SELECT total_word_count FROM novels WHERE id='novel-conversation-test'",
                [],
                |row| row.get(0),
            )
            .expect("query replayed novel total");
        assert_eq!(replayed_total, 500);
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM memory_documents WHERE source_id='draft-100'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("replayed memory document count"),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM conversation_turns
                     WHERE turn_id='summary-generation-auth-adopt-100'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("summary follow-up replay count"),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM memory_chunks
                     WHERE document_id=(
                         SELECT id FROM memory_documents WHERE source_id='draft-100'
                     )",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("replayed memory chunk count"),
            1
        );
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

    #[test]
    fn first_user_turn_replaces_default_conversation_title() {
        let mut connection = connection();
        create_conversation(
            &mut connection,
            CreateConversationInput {
                conversation_id: "conversation-auto-title".to_string(),
                novel_id: "novel-conversation-test".to_string(),
                title: "新的创作任务".to_string(),
                default_model: None,
                created_at: "2026-08-23T00:00:00Z".to_string(),
            },
        )
        .expect("conversation");

        append_turn(
            &mut connection,
            AppendTurnInput {
                turn_id: "turn-auto-title".to_string(),
                conversation_id: "conversation-auto-title".to_string(),
                role: "user".to_string(),
                content: "生成第三章候选正文并保持人物一致".to_string(),
                created_at: "2026-08-23T00:00:01Z".to_string(),
            },
        )
        .expect("first user turn");

        let updated = get_conversation(&connection, "conversation-auto-title")
            .expect("read conversation")
            .expect("conversation exists");
        assert_eq!(updated.title, "生成第三章候选正文并保持人物一致");
    }

    #[test]
    fn conversation_management_renames_archives_restores_and_guards_active_runs() {
        let mut connection = connection();
        create_conversation(
            &mut connection,
            CreateConversationInput {
                conversation_id: "conversation-management".to_string(),
                novel_id: "novel-conversation-test".to_string(),
                title: "旧标题".to_string(),
                default_model: None,
                created_at: "2026-08-24T00:00:00Z".to_string(),
            },
        )
        .expect("conversation");

        let renamed = rename_conversation(
            &mut connection,
            RenameConversationInput {
                conversation_id: "conversation-management".to_string(),
                title: "新标题".to_string(),
                updated_at: "2026-08-24T00:00:01Z".to_string(),
            },
        )
        .expect("rename");
        assert_eq!(renamed.title, "新标题");

        let archived = set_conversation_archived(
            &mut connection,
            SetConversationArchivedInput {
                conversation_id: "conversation-management".to_string(),
                archived: true,
                updated_at: "2026-08-24T00:00:02Z".to_string(),
            },
        )
        .expect("archive");
        assert_eq!(
            archived.archived_at.as_deref(),
            Some("2026-08-24T00:00:02Z")
        );
        assert!(list_conversations(&connection, None, false, 100)
            .expect("active list")
            .is_empty());
        assert_eq!(
            list_conversations(&connection, None, true, 100)
                .expect("all list")
                .len(),
            1
        );

        let restored = set_conversation_archived(
            &mut connection,
            SetConversationArchivedInput {
                conversation_id: "conversation-management".to_string(),
                archived: false,
                updated_at: "2026-08-24T00:00:03Z".to_string(),
            },
        )
        .expect("restore");
        assert!(restored.archived_at.is_none());

        append_turn(
            &mut connection,
            AppendTurnInput {
                turn_id: "turn-management".to_string(),
                conversation_id: "conversation-management".to_string(),
                role: "user".to_string(),
                content: "继续创作".to_string(),
                created_at: "2026-08-24T00:00:04Z".to_string(),
            },
        )
        .expect("turn");
        create_run(
            &mut connection,
            CreateRunInput {
                run_id: "run-management".to_string(),
                conversation_id: "conversation-management".to_string(),
                turn_id: "turn-management".to_string(),
                model_snapshot: json!({"providerId":"mock","modelId":"Mock"}),
                worker_id: "worker-management".to_string(),
                created_at: "2026-08-24T00:00:05Z".to_string(),
            },
        )
        .expect("run");

        let archive_error = set_conversation_archived(
            &mut connection,
            SetConversationArchivedInput {
                conversation_id: "conversation-management".to_string(),
                archived: true,
                updated_at: "2026-08-24T00:00:06Z".to_string(),
            },
        )
        .expect_err("active run must block archive");
        assert_eq!(archive_error.code, "CONVERSATION_ACTIVE_RUN");
    }

    #[test]
    fn initialized_conversation_commits_task_and_first_goal_as_one_transaction() {
        let mut connection = connection();
        let initialized = create_initialized_conversation(
            &mut connection,
            CreateInitializedConversationInput {
                conversation_id: "conversation-initialized".to_string(),
                turn_id: "turn-initialized".to_string(),
                novel_id: "novel-conversation-test".to_string(),
                title: "生成下一章".to_string(),
                goal: "生成下一章并延续上一章悬念".to_string(),
                default_model: json!({"providerId":"mock","modelId":"Mock"}),
                created_at: "2026-08-24T01:00:00Z".to_string(),
            },
        )
        .expect("initialized conversation");
        assert_eq!(initialized.conversation.title, "生成下一章");
        assert_eq!(initialized.turn.sequence, 0);
        assert_eq!(initialized.turn.content, "生成下一章并延续上一章悬念");

        let failed = create_initialized_conversation(
            &mut connection,
            CreateInitializedConversationInput {
                conversation_id: "conversation-rolled-back".to_string(),
                turn_id: "turn-rolled-back".to_string(),
                novel_id: "missing-novel".to_string(),
                title: "不应保留".to_string(),
                goal: "这条目标也不应保留".to_string(),
                default_model: json!({"providerId":"mock","modelId":"Mock"}),
                created_at: "2026-08-24T01:00:01Z".to_string(),
            },
        );
        assert!(failed.is_err());
        let leaked_conversations: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM task_conversations WHERE conversation_id='conversation-rolled-back'",
                [],
                |row| row.get(0),
            )
            .expect("conversation count");
        let leaked_turns: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM conversation_turns WHERE turn_id='turn-rolled-back'",
                [],
                |row| row.get(0),
            )
            .expect("turn count");
        assert_eq!(leaked_conversations, 0);
        assert_eq!(leaked_turns, 0);
    }
}
