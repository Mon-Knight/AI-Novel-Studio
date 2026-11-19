//! Stage leases, late-result rejection and atomic result checkpoints in migration 040.
use super::*;
use crate::repositories::chapter_workflow_stage_repository::ChapterWorkflowStageRecord;
use crate::services::chapter_workflow_stage_service::{
    self as stages, ChapterWorkflowStageOutput, CompleteChapterWorkflowStageInput,
    FailChapterWorkflowStageInput, StartChapterWorkflowStageInput,
};

fn active_row(
    connection: &Connection,
    input: &StartTaskTurnInput,
    run_id: &str,
) -> Result<ChapterWorkflowStageRecord, String> {
    let ctx = context(input).ok_or("CHAPTER_STAGED_CONTEXT_MISSING")?;
    let matches = graph::rows(connection, input)?
        .into_iter()
        .filter(|r| r.run_id == run_id && r.stage_key == ctx.stage.key && r.status == "running")
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err("CHAPTER_STAGED_LEASE_MISSING".into());
    }
    let row = matches.into_iter().next().unwrap();
    if row.input_hash != ctx.stage.input_hash
        || row.context_hash != ctx.frozen.source_hash
        || row.plan_hash != ctx.stage.plan_hash
        || row.base_hash != ctx.frozen.base_hash
        || row.stage_kind != ctx.stage.kind
    {
        return Err("CHAPTER_STAGED_LEASE_MISMATCH".into());
    }
    Ok(row)
}

pub(in super::super) fn begin(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    run_id: &str,
) -> Result<(), String> {
    let Some(ctx) = context(input) else {
        return Ok(());
    };
    check_frozen(connection, input)?;
    let replay = graph::replay(connection, input, &ctx.frozen)?;
    if replay.next.key != ctx.stage.key
        || replay.next.input_hash != ctx.stage.input_hash
        || replay.next.local_result != ctx.stage.local_result
    {
        return Err("CHAPTER_STAGED_DISPATCH_ORDER_INVALID".into());
    }
    // Explicit resume after a committed assembly only reconciles that immutable result.
    if replay.complete && ctx.stage.kind == "chapter_assemble" {
        return Ok(());
    }
    let same = graph::rows(connection, input)?
        .into_iter()
        .filter(|r| r.stage_key == ctx.stage.key)
        .collect::<Vec<_>>();
    if same
        .iter()
        .any(|r| matches!(r.status.as_str(), "pending" | "running" | "succeeded"))
    {
        return Err("CHAPTER_STAGED_LEASE_CONFLICT".into());
    }
    if same.len() >= 3 {
        return Err("CHAPTER_STAGED_ATTEMPT_BUDGET_EXHAUSTED".into());
    }
    stages::start_stage(
        connection,
        StartChapterWorkflowStageInput {
            workflow_id: input.turn_id.clone(),
            conversation_id: input.conversation_id.clone(),
            novel_id: input.require_novel_id()?.to_string(),
            chapter_id: input
                .chapter_id
                .clone()
                .ok_or("CHAPTER_STAGED_SCOPE_REQUIRED")?,
            run_id: run_id.into(),
            stage_key: ctx.stage.key.clone(),
            stage_kind: ctx.stage.kind.clone(),
            scene_id: ctx.stage.scene_id.clone(),
            beat_id: ctx.stage.beat_id.clone(),
            plan_version: 2,
            context_hash: ctx.frozen.source_hash.clone(),
            base_hash: ctx.frozen.base_hash.clone(),
            input_hash: ctx.stage.input_hash.clone(),
            plan_hash: ctx.stage.plan_hash.clone(),
            model_snapshot_hash: None,
            attempt: None,
        },
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

fn complete(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    run_id: &str,
    body: String,
) -> Result<Value, String> {
    check_frozen(connection, input)?;
    let row = active_row(connection, input, run_id)?;
    let hash = large_text_repository::sha256(&body);
    let complete = stages::complete_stage(
        connection,
        CompleteChapterWorkflowStageInput {
            stage_id: row.stage_id,
            expected_revision: row.revision,
            expected_result_hash: hash.clone(),
            output: ChapterWorkflowStageOutput::LargeText(body),
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(
        json!({"stageId":complete.stage_id,"stageKey":complete.stage_key,"resultHash":hash,"candidateOnly":true}),
    )
}

pub(in super::super) fn execute_local(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    run_id: &str,
) -> Result<Value, String> {
    check_frozen(connection, input)?;
    let ctx = context(input).ok_or("CHAPTER_STAGED_CONTEXT_MISSING")?;
    let replay = graph::replay(connection, input, &ctx.frozen)?;
    if replay.next.key != ctx.stage.key
        || replay.next.input_hash != ctx.stage.input_hash
        || replay.next.local_result != ctx.stage.local_result
    {
        return Err("CHAPTER_STAGED_DISPATCH_ORDER_INVALID".into());
    }
    if replay.complete {
        if ctx.stage.kind != "chapter_assemble" {
            return Err("CHAPTER_STAGED_ALREADY_SUCCEEDED".into());
        }
        let row = replay
            .ordered
            .last()
            .ok_or("CHAPTER_STAGED_ASSEMBLY_INCOMPLETE")?;
        return Ok(
            json!({"stageId":row.stage_id,"stageKey":row.stage_key,"resultHash":row.result_hash,"reconciled":true,"candidateOnly":true}),
        );
    }
    let body = ctx
        .stage
        .local_result
        .clone()
        .ok_or("CHAPTER_STAGED_LOCAL_STAGE_INVALID")?;
    complete(connection, input, run_id, body)
}

pub(in super::super) fn accept_submission(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    run_id: &str,
    event_id: &str,
    gateway_result: &str,
) -> Result<(), String> {
    check_frozen(connection, input)?;
    let ctx = context(input).ok_or("CHAPTER_STAGED_CONTEXT_MISSING")?;
    if ctx.stage.local_result.is_some() {
        return Err("CHAPTER_STAGED_MODEL_STAGE_INVALID".into());
    }
    active_row(connection, input, run_id)?;
    let document = graph::owned_document(
        connection,
        &format!("{event_id}-stage-arguments"),
        "tool_event",
        event_id,
        "stage_arguments",
    )?;
    let args: Value =
        serde_json::from_str(&document).map_err(|_| "CHAPTER_STAGED_ARGUMENTS_INVALID")?;
    let gateway: Value =
        serde_json::from_str(gateway_result).map_err(|_| "CHAPTER_STAGED_GATEWAY_INVALID")?;
    let raw = source::text(&args, "content", 512 * 1024)?;
    if args.as_object().map(|v| v.len()) != Some(5)
        || args["novelId"] != json!(input.require_novel_id()?)
        || args["chapterId"] != json!(input.chapter_id)
        || args["stageKey"] != json!(ctx.stage.key)
        || args["stageKind"] != json!(ctx.stage.kind)
        || gateway["ok"] != json!(true)
        || gateway["stageSubmissionVersion"] != json!(1)
        || gateway["stageKey"] != args["stageKey"]
        || gateway["stageKind"] != args["stageKind"]
        || gateway["contentHash"] != json!(large_text_repository::sha256(raw))
        || gateway["contentChars"] != json!(raw.chars().count())
    {
        return Err("CHAPTER_STAGED_SUBMISSION_MISMATCH".into());
    }
    let sequence:i64=connection.query_row("SELECT sequence FROM tool_call_events WHERE event_id=?1 AND run_id=?2 AND tool_name='submit_chapter_stage' AND status='running'",
        params![event_id,run_id],|r|r.get(0)).map_err(|_|"CHAPTER_STAGED_TOOL_EVENT_INVALID")?;
    for tool in &input.required_read_tools {
        let read:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM tool_call_events WHERE run_id=?1 AND tool_name=?2 AND status='succeeded' AND sequence<?3)",params![run_id,tool,sequence],|r|r.get(0)).map_err(|e|e.to_string())?;
        if !read {
            return Err("DSH_REQUIRED_CONTEXT_READ_MISSING".into());
        }
    }
    validate_turn_execution_contract(connection, input, run_id).map_err(|e| e.to_string())?;
    let binding = json!({"schemaVersion":1,"workflowId":input.turn_id,"stageKey":ctx.stage.key,
        "inputHash":ctx.stage.input_hash,"planHash":ctx.stage.plan_hash});
    let body = validation::split_binding(raw, &binding)?;
    let normalized = validation::normalize(&ctx.stage.kind, body, &ctx.stage.payload)?;
    complete(connection, input, run_id, normalized).map(|_| ())
}

/// Called by the root for terminal failures; no stage is retried here.
pub(in super::super) fn finish_failed(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    run_id: &str,
) -> Result<(), String> {
    if context(input).is_none() {
        return Ok(());
    }
    for row in graph::rows(connection, input)?
        .into_iter()
        .filter(|r| r.run_id == run_id && r.status == "running")
    {
        stages::fail_stage(
            connection,
            FailChapterWorkflowStageInput {
                stage_id: row.stage_id,
                expected_revision: row.revision,
                error_code: "CHAPTER_STAGED_RUN_FAILED".into(),
            },
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
