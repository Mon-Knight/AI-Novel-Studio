use crate::db::get_connection;
use crate::errors::AppError;
use crate::repositories::chapter_workflow_stage_repository::ChapterWorkflowStageRecord;
use crate::services::chapter_workflow_stage_service as service;

/// Read-only projection of authoritative chapter workflow stage facts.
/// No write command is exposed; stage writes stay `pub(crate)` for the
/// governed Writer/DSH integration.
#[tauri::command]
pub fn list_chapter_workflow_stages(
    input: service::ListChapterWorkflowStagesInput,
) -> Result<Vec<ChapterWorkflowStageRecord>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::list_stages(&connection, input)
}
