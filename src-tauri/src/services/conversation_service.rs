use crate::errors::AppError;
use crate::repositories::conversation_repository as repository;
use rusqlite::Connection;

pub use repository::{
    AppendToolEventInput, AppendTurnInput, ArtifactDecisionRecord, ConsumeReviewAuthorizationInput,
    ConversationArtifactCardRecord, ConversationTurnRecord, CreateArtifactCardInput,
    CreateConversationInput, CreateRunInput, RecordArtifactDecisionInput, RecoverRunsInput,
    ReviewAuthorizationRecord, TaskConversationBundle, TaskConversationRecord, TaskRunRecord,
    ToolCallEventRecord, UpdateConversationModelInput, UpdateRunInput, UpdateToolEventInput,
};

fn required(value: &str, field: &str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError::new(
            "CONVERSATION_INPUT_INVALID",
            format!("{} 不能为空", field),
            false,
        ));
    }
    Ok(())
}

pub fn create(
    connection: &mut Connection,
    input: CreateConversationInput,
) -> Result<TaskConversationRecord, AppError> {
    required(&input.conversation_id, "conversationId")?;
    required(&input.novel_id, "novelId")?;
    required(&input.title, "title")?;
    if input.title.chars().count() > 160 {
        return Err(AppError::new(
            "CONVERSATION_INPUT_INVALID",
            "任务标题过长",
            false,
        ));
    }
    repository::create_conversation(connection, input)
}

pub fn list(
    connection: &Connection,
    novel_id: Option<&str>,
    limit: i64,
) -> Result<Vec<TaskConversationRecord>, AppError> {
    repository::list_conversations(connection, novel_id, limit)
}

pub fn get(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Option<TaskConversationBundle>, AppError> {
    required(conversation_id, "conversationId")?;
    repository::get_bundle(connection, conversation_id)
}

pub fn update_model(
    connection: &mut Connection,
    input: UpdateConversationModelInput,
) -> Result<TaskConversationRecord, AppError> {
    required(&input.conversation_id, "conversationId")?;
    required(&input.updated_at, "updatedAt")?;
    repository::update_conversation_model(connection, input)
}

pub fn append_turn(
    connection: &mut Connection,
    input: AppendTurnInput,
) -> Result<ConversationTurnRecord, AppError> {
    required(&input.turn_id, "turnId")?;
    required(&input.conversation_id, "conversationId")?;
    required(&input.content, "content")?;
    if !["user", "assistant", "system"].contains(&input.role.as_str()) {
        return Err(AppError::new(
            "CONVERSATION_ROLE_INVALID",
            "任务消息角色无效",
            false,
        ));
    }
    repository::append_turn(connection, input)
}

pub fn append_runtime_assistant_turn(
    connection: &mut Connection,
    turn_id: &str,
    conversation_id: &str,
    run_id: &str,
    content: &str,
    created_at: &str,
) -> Result<ConversationTurnRecord, AppError> {
    required(turn_id, "turnId")?;
    required(conversation_id, "conversationId")?;
    required(run_id, "runId")?;
    required(content, "content")?;
    required(created_at, "createdAt")?;
    repository::append_runtime_assistant_turn(
        connection,
        turn_id,
        conversation_id,
        run_id,
        content,
        created_at,
    )
}

pub fn create_run(
    connection: &mut Connection,
    input: CreateRunInput,
) -> Result<TaskRunRecord, AppError> {
    required(&input.run_id, "runId")?;
    required(&input.conversation_id, "conversationId")?;
    required(&input.turn_id, "turnId")?;
    required(&input.worker_id, "workerId")?;
    repository::create_run(connection, input)
}

pub fn update_run(
    connection: &mut Connection,
    input: UpdateRunInput,
) -> Result<TaskRunRecord, AppError> {
    required(&input.run_id, "runId")?;
    repository::update_run(connection, input)
}

pub fn append_tool_event(
    connection: &mut Connection,
    input: AppendToolEventInput,
) -> Result<ToolCallEventRecord, AppError> {
    required(&input.event_id, "eventId")?;
    required(&input.run_id, "runId")?;
    required(&input.tool_name, "toolName")?;
    required(&input.status, "status")?;
    repository::append_tool_event(connection, input)
}

pub fn update_tool_event(
    connection: &mut Connection,
    input: UpdateToolEventInput,
) -> Result<ToolCallEventRecord, AppError> {
    required(&input.event_id, "eventId")?;
    required(&input.status, "status")?;
    repository::update_tool_event(connection, input)
}

pub fn get_tool_event_by_call_id(
    connection: &Connection,
    run_id: &str,
    call_id: &str,
) -> Result<Option<ToolCallEventRecord>, AppError> {
    required(run_id, "runId")?;
    required(call_id, "callId")?;
    repository::get_tool_event_by_call_id(connection, run_id, call_id)
}

pub fn terminalize_open_tool_events(
    connection: &mut Connection,
    run_id: &str,
    status: &str,
    error: &str,
    finished_at: &str,
) -> Result<i64, AppError> {
    required(run_id, "runId")?;
    required(error, "error")?;
    required(finished_at, "finishedAt")?;
    if !["failed", "cancelled", "skipped"].contains(&status) {
        return Err(AppError::new(
            "TOOL_EVENT_STATUS_INVALID",
            "工具调用收敛状态无效",
            false,
        ));
    }
    repository::terminalize_open_tool_events(connection, run_id, status, error, finished_at)
}

pub fn create_artifact_card(
    connection: &mut Connection,
    input: CreateArtifactCardInput,
) -> Result<ConversationArtifactCardRecord, AppError> {
    required(&input.card_id, "cardId")?;
    required(&input.conversation_id, "conversationId")?;
    required(&input.title, "title")?;
    if let Some(content) = input.content.as_deref() {
        required(content, "content")?;
    }
    repository::create_artifact_card(connection, input)
}

pub fn recover_interrupted_runs(
    connection: &mut Connection,
    input: RecoverRunsInput,
) -> Result<i64, AppError> {
    required(&input.finished_at, "finishedAt")?;
    required(&input.error, "error")?;
    repository::recover_interrupted_runs(connection, input)
}

pub fn record_artifact_decision(
    connection: &mut Connection,
    input: RecordArtifactDecisionInput,
) -> Result<ArtifactDecisionRecord, AppError> {
    required(&input.decision_id, "decisionId")?;
    required(&input.artifact_id, "artifactId")?;
    required(&input.artifact_hash, "artifactHash")?;
    required(&input.card_id, "cardId")?;
    required(&input.conversation_id, "conversationId")?;
    required(&input.idempotency_key, "idempotencyKey")?;
    required(&input.target_id, "targetId")?;
    if !["confirm", "reject", "request_revision", "request_apply"].contains(&input.decision.as_str())
    {
        return Err(AppError::new(
            "ARTIFACT_DECISION_INVALID",
            "产物决定类型无效",
            false,
        ));
    }
    repository::record_artifact_decision(connection, input)
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
    required(authorization_id, "authorizationId")?;
    required(decision_id, "decisionId")?;
    required(artifact_id, "artifactId")?;
    required(novel_id, "novelId")?;
    required(chapter_id, "chapterId")?;
    repository::issue_review_authorization(
        connection,
        authorization_id,
        decision_id,
        artifact_id,
        novel_id,
        chapter_id,
        issued_at,
    )
}

pub fn consume_review_authorization(
    connection: &mut Connection,
    input: ConsumeReviewAuthorizationInput,
) -> Result<ReviewAuthorizationRecord, AppError> {
    required(&input.authorization_id, "authorizationId")?;
    required(&input.draft_id, "draftId")?;
    repository::consume_review_authorization(connection, input)
}
