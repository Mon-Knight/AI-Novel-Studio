use crate::ai_worker::{self, AiWorkerManager, WorkerProviderConfig};
use crate::db::get_connection;
use crate::errors::{codes, AppError};
use crate::repositories::large_text_repository;
use crate::services::constraint_validation_service::{self, ChapterConstraintValidationSummary};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerTaskActionResult {
    pub task_id: String,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskArtifactContent {
    pub artifact_id: String,
    pub task_id: String,
    pub artifact_type: String,
    pub processing_status: String,
    pub content: String,
    pub raw_content: String,
    pub base_content: Option<String>,
    pub structured_payload: Option<Value>,
    pub constraint_validation: Option<ChapterConstraintValidationSummary>,
}

#[tauri::command]
pub fn configure_ai_worker_provider(
    input: WorkerProviderConfig,
    manager: State<'_, AiWorkerManager>,
) -> Result<(), AppError> {
    manager.configure(input)
}

#[tauri::command]
pub fn enqueue_ai_worker_task(task_id: String) -> Result<WorkerTaskActionResult, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_worker::enqueue_task(&mut connection, &task_id)?;
    Ok(WorkerTaskActionResult {
        task_id,
        status: "queued".into(),
    })
}

#[tauri::command]
pub fn request_ai_worker_cancel(
    task_id: String,
    manager: State<'_, AiWorkerManager>,
) -> Result<WorkerTaskActionResult, AppError> {
    let status = {
        let mut connection = get_connection()
            .lock()
            .map_err(|_| AppError::poisoned_lock())?;
        ai_worker::request_cancel(&mut connection, &task_id)?
    };
    manager.cancel(&task_id);
    Ok(WorkerTaskActionResult { task_id, status })
}

#[tauri::command]
pub fn retry_ai_worker_task(task_id: String) -> Result<WorkerTaskActionResult, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_worker::retry_task(&mut connection, &task_id)?;
    Ok(WorkerTaskActionResult {
        task_id,
        status: "queued".into(),
    })
}

#[tauri::command]
pub fn get_ai_task_artifact_content(artifact_id: String) -> Result<TaskArtifactContent, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    let row: Option<(
        String,
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = connection
        .query_row(
            "SELECT artifact_id,task_id,artifact_type,processing_status,
                    raw_content_ref_id,display_content_ref_id,source_draft_id,structured_payload_json
             FROM result_artifacts WHERE artifact_id=?1",
            params![artifact_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?;
    let (
        artifact_id,
        task_id,
        artifact_type,
        processing_status,
        raw_document_id,
        display_document_id,
        source_draft_id,
        structured_raw,
    ) = row
        .ok_or_else(|| AppError::new(codes::ARTIFACT_VALIDATION_FAILED, "AI 结果不存在", false))?;
    let raw_content =
        large_text_repository::read_verified_document(&connection, &raw_document_id)?.content;
    let content = if let Some(document_id) = display_document_id {
        large_text_repository::read_verified_document(&connection, &document_id)?.content
    } else {
        raw_content.clone()
    };
    let base_content = source_draft_id
        .as_deref()
        .map(|draft_id| {
            connection
                .query_row(
                    "SELECT content,large_text_ref_id FROM chapter_drafts WHERE id=?1",
                    params![draft_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .optional()
                .map_err(AppError::database)
        })
        .transpose()?
        .flatten()
        .map(|(inline_content, large_text_ref_id)| {
            large_text_ref_id
                .map(|document_id| {
                    large_text_repository::read_verified_document(&connection, &document_id)
                        .map(|value| value.content)
                })
                .unwrap_or(Ok(inline_content))
        })
        .transpose()?;
    let structured_payload = structured_raw.and_then(|value| serde_json::from_str(&value).ok());
    let constraint_validation = if artifact_type == "chapter_text" {
        constraint_validation_service::latest(&connection, &artifact_id)?
    } else {
        None
    };
    Ok(TaskArtifactContent {
        artifact_id,
        task_id,
        artifact_type,
        processing_status,
        content,
        raw_content,
        base_content,
        structured_payload,
        constraint_validation,
    })
}
