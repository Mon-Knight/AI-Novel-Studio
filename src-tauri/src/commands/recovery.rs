use crate::db::get_connection;
use crate::errors::AppError;
use crate::repositories::recovery_repository::RecoverySnapshot;
use crate::services::recovery_service::{self, UpsertRecoveryInput};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryTargetInput {
    pub novel_id: String,
    pub chapter_id: String,
    #[serde(default)]
    pub trace_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRecoveryOutput {
    pub deleted: bool,
}

#[tauri::command]
pub fn get_workspace_recovery_snapshot(
    input: RecoveryTargetInput,
) -> Result<Option<RecoverySnapshot>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    recovery_service::get(&connection, &input.novel_id, &input.chapter_id)
        .map_err(|error| error.with_context(input.trace_id.as_deref(), None))
}

#[tauri::command]
pub fn upsert_workspace_recovery_snapshot(
    input: UpsertRecoveryInput,
) -> Result<RecoverySnapshot, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    recovery_service::upsert(&mut connection, input)
}

#[tauri::command]
pub fn delete_workspace_recovery_snapshot(
    input: RecoveryTargetInput,
) -> Result<DeleteRecoveryOutput, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    recovery_service::delete(&mut connection, &input.novel_id, &input.chapter_id)
        .map(|affected| DeleteRecoveryOutput {
            deleted: affected == 1,
        })
        .map_err(|error| error.with_context(input.trace_id.as_deref(), None))
}
