use crate::db::get_connection;
use crate::errors::AppError;
use crate::services::artifact_service::{self, CreateResultArtifactInput, ResultArtifactBundle};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactIdInput {
    pub artifact_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactTaskIdInput {
    pub task_id: String,
}

#[tauri::command]
pub fn create_result_artifact(
    input: CreateResultArtifactInput,
) -> Result<ResultArtifactBundle, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    artifact_service::create_artifact(&mut connection, input)
}

#[tauri::command]
pub fn get_result_artifact(input: ArtifactIdInput) -> Result<ResultArtifactBundle, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    artifact_service::get_artifact_bundle(&connection, &input.artifact_id)
}

#[tauri::command]
pub fn list_result_artifacts_for_task(
    input: ArtifactTaskIdInput,
) -> Result<Vec<ResultArtifactBundle>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    artifact_service::list_task_artifacts(&connection, &input.task_id)
}
