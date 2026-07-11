use crate::db::get_connection;
use crate::errors::AppError;
use crate::services::artifact_service::{self, CreateResultArtifactInput, ResultArtifactDto};

#[tauri::command]
pub fn create_result_artifact(
    input: CreateResultArtifactInput,
) -> Result<ResultArtifactDto, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    artifact_service::create_artifact(&mut connection, input)
}
