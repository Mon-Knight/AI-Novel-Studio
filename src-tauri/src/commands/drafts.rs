use crate::db::get_connection;
use crate::errors::AppError;
use crate::services::draft_service::{
    self, AdoptChapterDraftAtomicInput, AdoptChapterDraftAtomicOutput,
    ReadChapterDraftContentOutput, SaveChapterDraftAtomicInput, SaveChapterDraftAtomicOutput,
};
use serde::Deserialize;

#[tauri::command]
pub fn save_chapter_draft_atomic(
    input: SaveChapterDraftAtomicInput,
) -> Result<SaveChapterDraftAtomicOutput, AppError> {
    let staging_session_id = input.staging_session_id.clone();
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    draft_service::save_chapter_draft_atomic_with_cleanup(&mut connection, input, || {
        if let Some(session_id) = staging_session_id.as_deref() {
            crate::large_text_save::cleanup_session_cache(session_id)
        } else {
            Ok(())
        }
    })
}

#[tauri::command]
pub fn adopt_chapter_draft_safe(
    input: AdoptChapterDraftAtomicInput,
) -> Result<AdoptChapterDraftAtomicOutput, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    draft_service::adopt_chapter_draft_atomic(&mut connection, input)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadChapterDraftContentInput {
    pub novel_id: String,
    pub chapter_id: String,
    pub draft_id: String,
    #[serde(default)]
    pub trace_id: Option<String>,
}

#[tauri::command]
pub fn read_chapter_draft_content(
    input: ReadChapterDraftContentInput,
) -> Result<ReadChapterDraftContentOutput, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    draft_service::read_chapter_draft_content(
        &connection,
        &input.novel_id,
        &input.chapter_id,
        &input.draft_id,
    )
    .map_err(|error| error.with_context(input.trace_id.as_deref(), None))
}
