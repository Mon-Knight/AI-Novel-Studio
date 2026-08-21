use crate::errors::AppError;
use crate::repositories::conversation_repository as repository;
use crate::repositories::large_text_repository;
use crate::services::ai_task_service::{self, ClaimAiTaskAttemptInput, CreateAiTaskInput};
use crate::services::artifact_service;
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishStructuredCandidateInput {
    pub conversation_id: String,
    pub novel_id: String,
    pub artifact_type: String,
    pub derivation_type: Option<String>,
    pub title: String,
    pub summary: String,
    pub structured_payload_json: Value,
    pub created_at: String,
}

pub fn publish_structured_candidate(
    connection: &mut Connection,
    input: PublishStructuredCandidateInput,
) -> Result<ConversationArtifactCardRecord, AppError> {
    required(&input.conversation_id, "conversationId")?;
    required(&input.novel_id, "novelId")?;
    required(&input.artifact_type, "artifactType")?;
    required(&input.title, "title")?;
    required(&input.summary, "summary")?;
    required(&input.created_at, "createdAt")?;
    let raw = serde_json::to_string(&input.structured_payload_json).map_err(|error| {
        AppError::new("TASK_RUNTIME_JSON", error.to_string(), false)
    })?;
    let prompt_body = "只生成可确认候选，不写入正式小说事实。";
    let operation_id = format!("workbench-candidate-{}", uuid::Uuid::new_v4());
    let task = ai_task_service::create_task(
        connection,
        CreateAiTaskInput {
            operation_id: operation_id.clone(),
            request_hash_version: None,
            request_hash: None,
            trace_id: None,
            task_type: "context_summarize".to_string(),
            novel_id: input.novel_id.clone(),
            chapter_id: None,
            draft_id: None,
            scope_type: "novel".to_string(),
            expected_artifact_type: input.artifact_type.clone(),
            expected_artifact_schema_version: 1,
            target_hint_json: Some(json!({
                "conversationId": input.conversation_id,
                "derivationType": input.derivation_type,
                "candidateOnly": true
            })),
            input_snapshot: ai_task_service::InputSnapshotInput {
                schema_version: 1,
                input_type: "workbench_structured_candidate_v1".to_string(),
                payload_json: json!({"conversationId": input.conversation_id}),
                body: raw.clone(),
                source_draft_id: None,
                source_draft_version: None,
                base_content_hash: None,
            },
            context_snapshot: ai_task_service::ContextSnapshotInput {
                schema_version: 1,
                source_manifest_json: json!({"contractVersion":"workbench_candidate_context_v1","sources":[]}),
                compiled_context: String::new(),
                budget_json: json!({"maxChars":0,"compiledContextChars":0,"compiledContextBytes":0,"includedSourceCount":0,"truncatedSourceCount":0,"omittedSourceCount":0}),
                compiler_version: "workbench_candidate_v1".to_string(),
            },
            constraint_snapshot: ai_task_service::ConstraintSnapshotInput {
                schema_version: 1,
                payload_json: json!({"candidateOnly":true,"mayWriteBusinessData":false}),
                prompt_template_id: format!("workbench/{}", input.artifact_type),
                prompt_template_version: "1".to_string(),
                prompt_template_hash: large_text_repository::sha256(prompt_body),
                prompt_template_body: prompt_body.to_string(),
                provider_options_json: json!({}),
            },
        },
    )?;
    let queued = ai_task_service::queue_attempt(connection, &task.task_id)?;
    let attempt = ai_task_service::claim_attempt(
        connection,
        ClaimAiTaskAttemptInput {
            task_id: task.task_id.clone(),
            attempt_id: queued.attempt.attempt_id.clone(),
            provider_id: "ans-workbench".to_string(),
            model_id: "extractive-v1".to_string(),
            provider_request_id: Some(operation_id.clone()),
        },
    )?;
    let response_hash = large_text_repository::sha256(&raw);
    ai_task_service::mark_provider_succeeded(
        connection,
        &task.task_id,
        &attempt.attempt.attempt_id,
        json!({
            "provider": "ans-workbench",
            "model": "extractive-v1",
            "providerRequestId": operation_id,
            "responseHash": response_hash,
            "responseLength": raw.chars().count(),
            "tokenInput": 0,
            "tokenOutput": 0,
            "tokenTotal": 0,
            "finishReason": "tool_result",
            "durationMs": 0
        }),
    )?;
    let artifact = artifact_service::create_artifact(
        connection,
        artifact_service::CreateResultArtifactInput {
            task_id: task.task_id,
            attempt_id: attempt.attempt.attempt_id,
            artifact_type: input.artifact_type.clone(),
            schema_version: 1,
            raw_content: raw,
            display_content: Some(input.summary.clone()),
            structured_payload_json: Some(input.structured_payload_json),
            parent_artifact_id: None,
            derivation_type: input.derivation_type.clone(),
        },
    )?;
    create_artifact_card(
        connection,
        CreateArtifactCardInput {
            card_id: uuid::Uuid::new_v4().to_string(),
            conversation_id: input.conversation_id,
            turn_id: None,
            run_id: None,
            artifact_id: Some(artifact.artifact.artifact_id),
            artifact_type: input.artifact_type,
            title: input.title,
            summary: input.summary,
            content: None,
            status: "candidate".to_string(),
            created_at: input.created_at,
        },
    )
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
