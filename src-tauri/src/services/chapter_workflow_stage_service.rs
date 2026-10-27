use crate::errors::{codes, AppError};
use crate::repositories::chapter_workflow_stage_repository as repository;
use crate::repositories::chapter_workflow_stage_repository::{
    ChapterWorkflowStageQuery, ChapterWorkflowStageRecord, NewChapterWorkflowStageRow,
};
use crate::repositories::large_text_repository;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use uuid::Uuid;

#[path = "chapter_workflow_stage_contract.rs"]
mod contract;
#[path = "chapter_workflow_stage_verified_artifact.rs"]
mod verified_artifact;

pub(crate) use contract::{
    assert_active_run, authoritative_model_snapshot_hash, bounded_identifier, conflict_error,
    input_error, load_scope, normalized_hash, optional_identifier, scope_error, terminal_error,
    validate_start_input, validated_error_code, BINDING_CLOSE_MARKER, BINDING_OPEN_MARKER,
    WORKFLOW_BINDING_VERSION, CancelChapterWorkflowStageInput,
    ChapterWorkflowStageOutput, CompleteChapterWorkflowStageInput, FailChapterWorkflowStageInput,
    ListChapterWorkflowStagesInput, StageScope, StartChapterWorkflowStageInput,
};
pub(crate) use verified_artifact::verified_artifact_result;

fn is_unique_stage_violation(error: &AppError) -> bool {
    error
        .details
        .as_ref()
        .and_then(|details| details.get("sqliteError"))
        .and_then(Value::as_str)
        .is_some_and(|message| message.contains("UNIQUE constraint failed"))
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn new_stage_row<'a>(
    input: &'a StartChapterWorkflowStageInput,
    scope: &'a StageScope,
    stage_id: &'a str,
    model_snapshot_hash: &'a str,
    stage_key: &'a str,
    attempt: i64,
    timestamp: &'a str,
) -> NewChapterWorkflowStageRow<'a> {
    NewChapterWorkflowStageRow {
        stage_id,
        workflow_id: input.workflow_id.trim(),
        conversation_id: &scope.conversation_id,
        novel_id: &scope.novel_id,
        chapter_id: &scope.chapter_id,
        run_id: input.run_id.trim(),
        stage_key,
        stage_kind: input.stage_kind.trim(),
        scene_id: input.scene_id.as_deref().map(str::trim),
        beat_id: input.beat_id.as_deref().map(str::trim),
        plan_version: input.plan_version,
        model_snapshot_hash,
        context_hash: input.context_hash.trim(),
        base_hash: input.base_hash.trim(),
        input_hash: input.input_hash.trim(),
        plan_hash: input.plan_hash.trim(),
        attempt,
        created_at: timestamp,
        updated_at: timestamp,
    }
}

fn insert_pending(
    connection: &Connection,
    input: &StartChapterWorkflowStageInput,
    scope: &StageScope,
    stage_key: &str,
    model_snapshot_hash: &str,
    timestamp: &str,
) -> Result<ChapterWorkflowStageRecord, AppError> {
    let stage_id = format!("workflow-stage-{}", Uuid::new_v4());
    let attempt = match input.attempt {
        Some(attempt) if attempt >= 1 => attempt,
        Some(_) => return Err(input_error("attempt 必须是正整数")),
        None => repository::next_attempt(connection, input.workflow_id.trim(), stage_key)?,
    };
    let row = new_stage_row(
        input,
        scope,
        &stage_id,
        model_snapshot_hash,
        stage_key,
        attempt,
        timestamp,
    );
    repository::insert_pending_stage(connection, &row).map_err(|error| {
        if is_unique_stage_violation(&error) {
            conflict_error("同一 stage 的 attempt 已存在，拒绝覆盖")
        } else {
            error
        }
    })?;
    repository::find_stage(connection, &stage_id)?.ok_or_else(|| {
        AppError::new(
            codes::CHAPTER_WORKFLOW_STAGE_NOT_FOUND,
            "章节写作阶段不存在",
            false,
        )
        .with_details(serde_json::json!({ "stageId": stage_id }))
    })
}

pub(crate) fn queue_stage(
    connection: &mut Connection,
    input: StartChapterWorkflowStageInput,
) -> Result<ChapterWorkflowStageRecord, AppError> {
    validate_start_input(&input)?;
    let transaction = connection.transaction().map_err(AppError::database)?;
    let scope = load_scope(&transaction, &input)?;
    let model_hash = authoritative_model_snapshot_hash(&scope)?;
    if let Some(claimed) = input.model_snapshot_hash.as_deref() {
        if claimed.trim().to_ascii_lowercase() != model_hash {
            return Err(input_error(
                "modelSnapshotHash 与 TaskRun 的权威模型快照不一致",
            ));
        }
    }
    let stage_key = input.stage_key.trim().to_string();
    let record = insert_pending(
        &transaction,
        &input,
        &scope,
        &stage_key,
        &model_hash,
        &now(),
    )?;
    transaction.commit().map_err(AppError::database)?;
    Ok(record)
}

pub(crate) fn start_stage(
    connection: &mut Connection,
    input: StartChapterWorkflowStageInput,
) -> Result<ChapterWorkflowStageRecord, AppError> {
    validate_start_input(&input)?;
    let transaction = connection.transaction().map_err(AppError::database)?;
    let scope = load_scope(&transaction, &input)?;
    let model_hash = authoritative_model_snapshot_hash(&scope)?;
    if let Some(claimed) = input.model_snapshot_hash.as_deref() {
        if claimed.trim().to_ascii_lowercase() != model_hash {
            return Err(input_error(
                "modelSnapshotHash 与 TaskRun 的权威模型快照不一致",
            ));
        }
    }
    let stage_key = input.stage_key.trim().to_string();
    let pending = insert_pending(
        &transaction,
        &input,
        &scope,
        &stage_key,
        &model_hash,
        &now(),
    )?;
    let updated_at = now();
    let affected = repository::begin_stage(
        &transaction,
        &pending.stage_id,
        pending.revision,
        &updated_at,
    )?;
    if affected != 1 {
        return Err(conflict_error("阶段启动时 revision 已变化"));
    }
    let record = find_or_stage_not_found(&transaction, &pending.stage_id)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(record)
}

pub(crate) fn begin_stage(
    connection: &mut Connection,
    stage_id: &str,
    expected_revision: i64,
) -> Result<ChapterWorkflowStageRecord, AppError> {
    let transaction = connection.transaction().map_err(AppError::database)?;
    let current = find_or_stage_not_found(&transaction, stage_id)?;
    if current.status != "pending" {
        return Err(conflict_error("只有 pending 阶段可以启动"));
    }
    if current.revision != expected_revision {
        return Err(conflict_error("阶段 revision 已变化"));
    }
    assert_active_run(&transaction, &current, false)?;
    let updated_at = now();
    let affected = repository::begin_stage(&transaction, stage_id, expected_revision, &updated_at)?;
    if affected != 1 {
        return Err(conflict_error("阶段启动竞争失败"));
    }
    let record = find_or_stage_not_found(&transaction, stage_id)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(record)
}

fn find_or_stage_not_found(
    connection: &Connection,
    stage_id: &str,
) -> Result<ChapterWorkflowStageRecord, AppError> {
    repository::find_stage(connection, stage_id)?.ok_or_else(|| {
        AppError::new(
            codes::CHAPTER_WORKFLOW_STAGE_NOT_FOUND,
            "章节写作阶段不存在",
            false,
        )
        .with_details(serde_json::json!({ "stageId": stage_id }))
    })
}

fn load_running_stage(
    connection: &Connection,
    stage_id: &str,
    expected_revision: i64,
) -> Result<ChapterWorkflowStageRecord, AppError> {
    let current = find_or_stage_not_found(connection, stage_id)?;
    if matches!(
        current.status.as_str(),
        "succeeded" | "failed" | "cancelled"
    ) {
        return Err(terminal_error(stage_id, &current.status));
    }
    if current.status != "running" {
        return Err(conflict_error("只有 running 阶段可以写入结果"));
    }
    if current.revision != expected_revision {
        return Err(conflict_error("阶段 revision 已变化"));
    }
    Ok(current)
}

pub(crate) fn complete_stage(
    connection: &mut Connection,
    input: CompleteChapterWorkflowStageInput,
) -> Result<ChapterWorkflowStageRecord, AppError> {
    let expected_result_hash = normalized_hash(&input.expected_result_hash, "resultHash")?;
    let transaction = connection.transaction().map_err(AppError::database)?;
    let stage = load_running_stage(&transaction, &input.stage_id, input.expected_revision)?;
    // A run may fail or cancel while the stage row is still running; re-check the
    // authoritative run/target immediately before writing any late result.
    assert_active_run(&transaction, &stage, true)?;
    let updated_at = now();
    let mut result_document_id: Option<String> = None;
    let mut result_json: Option<String> = None;
    let mut verified_artifact_id: Option<String> = None;

    match &input.output {
        ChapterWorkflowStageOutput::LargeText(content) => {
            if content.trim().is_empty() {
                return Err(AppError::new(
                    codes::CHAPTER_WORKFLOW_STAGE_RESULT_INVALID,
                    "阶段结果正文不能为空",
                    false,
                ));
            }
            let hash = large_text_repository::sha256(content);
            if hash != expected_result_hash {
                return Err(AppError::new(
                    codes::CHAPTER_WORKFLOW_STAGE_RESULT_INVALID,
                    "阶段结果正文哈希不匹配",
                    false,
                ));
            }
            let document_id = format!("workflow-stage-result-{}", Uuid::new_v4());
            large_text_repository::insert_document_for_target(
                &transaction,
                &document_id,
                "chapter_workflow_stage",
                &stage.stage_id,
                "result",
                Some(&stage.stage_key),
                content,
                &hash,
                &updated_at,
            )?;
            result_document_id = Some(document_id);
        }
        ChapterWorkflowStageOutput::BoundedJson(content) => {
            if !repository::valid_result_json_size(content)
                || serde_json::from_str::<Value>(content)
                    .ok()
                    .filter(Value::is_object)
                    .is_none()
            {
                return Err(AppError::new(
                    codes::CHAPTER_WORKFLOW_STAGE_RESULT_INVALID,
                    "阶段 JSON 结果必须是 16 KiB 内的对象",
                    false,
                ));
            }
            let hash = large_text_repository::sha256(content);
            if hash != expected_result_hash {
                return Err(AppError::new(
                    codes::CHAPTER_WORKFLOW_STAGE_RESULT_INVALID,
                    "阶段 JSON 结果哈希不匹配",
                    false,
                ));
            }
            result_json = Some(content.clone());
        }
        ChapterWorkflowStageOutput::VerifiedArtifact(artifact_id) => {
            verified_artifact_result(&transaction, &stage, artifact_id, &expected_result_hash)?;
            verified_artifact_id = Some(artifact_id.trim().to_string());
        }
    }

    let affected = repository::complete_stage(
        &transaction,
        &stage.stage_id,
        input.expected_revision,
        &expected_result_hash,
        result_document_id.as_deref(),
        result_json.as_deref(),
        verified_artifact_id.as_deref(),
        &updated_at,
    )
    .map_err(|error| {
        if is_unique_stage_violation(&error) {
            conflict_error("同一 workflow/stage 已有成功尝试，不能写入第二个成功结果")
        } else {
            error
        }
    })?;
    if affected != 1 {
        return Err(conflict_error("阶段完成时状态或 revision 已变化"));
    }
    let record = find_or_stage_not_found(&transaction, &stage.stage_id)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(record)
}

pub(crate) fn fail_stage(
    connection: &mut Connection,
    input: FailChapterWorkflowStageInput,
) -> Result<ChapterWorkflowStageRecord, AppError> {
    let error_code = validated_error_code(&input.error_code)?;
    let transaction = connection.transaction().map_err(AppError::database)?;
    load_running_stage(&transaction, &input.stage_id, input.expected_revision)?;
    let affected = repository::fail_stage(
        &transaction,
        &input.stage_id,
        input.expected_revision,
        &error_code,
        &now(),
    )?;
    if affected != 1 {
        return Err(conflict_error("阶段失败时状态或 revision 已变化"));
    }
    let record = find_or_stage_not_found(&transaction, &input.stage_id)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(record)
}

pub(crate) fn cancel_stage(
    connection: &mut Connection,
    input: CancelChapterWorkflowStageInput,
) -> Result<ChapterWorkflowStageRecord, AppError> {
    let transaction = connection.transaction().map_err(AppError::database)?;
    let current = find_or_stage_not_found(&transaction, &input.stage_id)?;
    if matches!(
        current.status.as_str(),
        "succeeded" | "failed" | "cancelled"
    ) {
        return Err(terminal_error(&input.stage_id, &current.status));
    }
    if let Some(expected) = input.expected_revision {
        if current.revision != expected {
            return Err(conflict_error("阶段 revision 已变化"));
        }
    }
    let affected = repository::cancel_stage(
        &transaction,
        &input.stage_id,
        input.expected_revision,
        &now(),
    )?;
    if affected != 1 {
        return Err(conflict_error("阶段取消竞争失败"));
    }
    let record = find_or_stage_not_found(&transaction, &input.stage_id)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(record)
}

pub(crate) fn cancel_active_stages_for_run(
    connection: &mut Connection,
    run_id: &str,
) -> Result<usize, AppError> {
    let run_id = bounded_identifier(run_id, "runId")?;
    let transaction = connection.transaction().map_err(AppError::database)?;
    let cancelled = repository::cancel_active_stages_for_run(&transaction, &run_id, &now())?;
    transaction.commit().map_err(AppError::database)?;
    Ok(cancelled)
}

/// Startup recovery only changes persisted state. It must never dispatch a
/// Provider call or replay a failed stage automatically.
pub(crate) fn recover_interrupted_stages(connection: &mut Connection) -> Result<usize, AppError> {
    let transaction = connection.transaction().map_err(AppError::database)?;
    let recovered = repository::recover_running_stages(&transaction, &now())?;
    transaction.commit().map_err(AppError::database)?;
    Ok(recovered)
}

pub(crate) fn list_stages(
    connection: &Connection,
    input: ListChapterWorkflowStagesInput,
) -> Result<Vec<ChapterWorkflowStageRecord>, AppError> {
    let novel_id = bounded_identifier(&input.novel_id, "novelId")?;
    let chapter_id = bounded_identifier(&input.chapter_id, "chapterId")?;
    let chapter_scope: Option<(String, Option<String>)> = connection
        .query_row(
            "SELECT novel_id, deleted_at FROM chapters WHERE id = ?1",
            params![chapter_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(AppError::database)?;
    match chapter_scope {
        Some((scope_novel, deleted)) if scope_novel == novel_id && deleted.is_none() => {}
        _ => return Err(scope_error("本轮查询的章节不属于该作品或已删除")),
    }

    let conversation_id = optional_identifier(input.conversation_id.as_deref(), "conversationId")?;
    let workflow_id = optional_identifier(input.workflow_id.as_deref(), "workflowId")?;
    let run_id = optional_identifier(input.run_id.as_deref(), "runId")?;
    let stage_key = optional_identifier(input.stage_key.as_deref(), "stageKey")?;
    let stage_kinds = input.stage_kinds.unwrap_or_default();
    let statuses = input.statuses.unwrap_or_default();
    if stage_kinds.len() > repository::STAGE_KINDS.len()
        || stage_kinds
            .iter()
            .any(|kind| !repository::supported_stage_kind(kind.trim()))
    {
        return Err(input_error("stageKinds 含不受支持的阶段类型"));
    }
    if statuses.len() > repository::STAGE_STATUSES.len()
        || statuses
            .iter()
            .any(|status| !repository::supported_stage_status(status.trim()))
    {
        return Err(input_error("statuses 含不受支持的状态"));
    }
    let limit = input.limit.unwrap_or(50).clamp(1, 200);
    repository::list_stages(
        connection,
        &ChapterWorkflowStageQuery {
            novel_id,
            chapter_id,
            conversation_id,
            workflow_id,
            run_id,
            stage_key,
            stage_kinds: stage_kinds
                .into_iter()
                .map(|kind| kind.trim().to_string())
                .collect(),
            statuses: statuses
                .into_iter()
                .map(|status| status.trim().to_string())
                .collect(),
            limit,
        },
    )
}

#[cfg(test)]
#[path = "chapter_workflow_stage_tests.rs"]
mod tests;
