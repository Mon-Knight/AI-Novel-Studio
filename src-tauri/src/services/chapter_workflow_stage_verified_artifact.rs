//! Verified-artifact proof for a workflow stage completion.
//!
//! The only accepted request proof is decoded `body.messages[].content` carrying
//! the explicit `[CHAPTER_WORKFLOW_BINDING]` object. Input/Context/Constraints and
//! the request hash are re-derived by `ai_task_service::get_task_detail`; metadata
//! objects, task hints and raw JSON substrings are intentionally not consulted.

use super::contract::{bounded_identifier, result_invalid, verify_request_messages_binding};
use crate::errors::AppError;
use crate::repositories::chapter_workflow_stage_repository::ChapterWorkflowStageRecord;
use crate::services::{ai_task_service, artifact_service};
use rusqlite::Connection;
use serde_json::Value;

pub(crate) fn verified_artifact_result(
    connection: &Connection,
    stage: &ChapterWorkflowStageRecord,
    artifact_id: &str,
    expected_result_hash: &str,
) -> Result<(), AppError> {
    let artifact_id = bounded_identifier(artifact_id, "artifactId")?;
    let bundle = artifact_service::get_artifact_bundle(connection, &artifact_id)?;
    let artifact = &bundle.artifact;
    if !matches!(
        artifact.processing_status.as_str(),
        "valid" | "valid_with_warnings"
    ) || artifact.content_hash != expected_result_hash
        || artifact.source_novel_id != stage.novel_id
        || artifact.source_chapter_id.as_deref() != Some(stage.chapter_id.as_str())
    {
        return Err(result_invalid("验证产物不是当前阶段作用域内的有效结果"));
    }

    // Recompute Input/Context/Constraints snapshot hashes and the request hash.
    // This also proves the persisted body still matches its verified document hash.
    let detail = ai_task_service::get_task_detail(connection, &artifact.task_id).map_err(|_| {
        result_invalid("验证产物无法复验 AI Task 的 Input/Context/Constraints/request hash")
    })?;
    if detail.task.task_id != artifact.task_id
        || detail.task.status != "completed"
        || detail.task.result_artifact_id.as_deref() != Some(artifact.artifact_id.as_str())
        || detail.task.novel_id != stage.novel_id
        || detail.task.chapter_id.as_deref() != Some(stage.chapter_id.as_str())
        || detail.input_snapshot.snapshot.snapshot_id != artifact.source_input_snapshot_id
        || detail.input_snapshot.snapshot.snapshot_id != detail.task.input_snapshot_id
    {
        return Err(result_invalid(
            "验证产物的 Task/InputSnapshot 身份或作用域不一致",
        ));
    }
    let attempt = detail
        .attempts
        .iter()
        .find(|attempt| attempt.attempt_id == artifact.attempt_id)
        .ok_or_else(|| result_invalid("验证产物缺少对应的 Attempt 来源"))?;
    if attempt.status != "succeeded" {
        return Err(result_invalid("验证产物的 Attempt 未成功终结"));
    }

    let body: Value = serde_json::from_str(&detail.input_snapshot.body)
        .map_err(|_| result_invalid("验证产物的真实请求材料不是有效 JSON"))?;
    verify_request_messages_binding(&body, stage)
}
