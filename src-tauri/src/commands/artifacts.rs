use crate::db::get_connection;
use crate::errors::AppError;
use crate::services::artifact_service::{self, CreateResultArtifactInput, ResultArtifactDto};
use crate::services::constraint_validation_service::{
    self, ChapterConstraintValidationSummary, RecordChapterConstraintValidationInput,
};

#[tauri::command]
pub fn create_result_artifact(
    input: CreateResultArtifactInput,
) -> Result<ResultArtifactDto, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    artifact_service::create_artifact(&mut connection, input)
}

#[tauri::command]
pub fn record_chapter_constraint_validation(
    input: RecordChapterConstraintValidationInput,
) -> Result<ChapterConstraintValidationSummary, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    constraint_validation_service::record(&mut connection, input)
}

#[tauri::command]
pub fn get_latest_chapter_constraint_validation(
    artifact_id: String,
) -> Result<Option<ChapterConstraintValidationSummary>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    constraint_validation_service::latest(&connection, &artifact_id)
}

#[tauri::command]
pub fn recover_chapter_candidate(
    novel_id: String,
    chapter_id: String,
) -> Result<artifact_service::ChapterCandidateRecoveryDto, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    artifact_service::recover_chapter_candidate(&connection, &novel_id, &chapter_id)
}
