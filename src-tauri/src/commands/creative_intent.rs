use crate::db::get_connection;
use crate::domain::stage3_prerequisite::{CreativeIntentRecordV1, FreezeCreativeIntentInput};
use crate::errors::AppError;
use crate::services::creative_intent_service;

#[tauri::command]
pub fn get_latest_creative_intent(
    novel_id: String,
) -> Result<Option<CreativeIntentRecordV1>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    creative_intent_service::get_latest(&connection, &novel_id)
}

#[tauri::command]
pub fn freeze_creative_intent(
    input: FreezeCreativeIntentInput,
) -> Result<CreativeIntentRecordV1, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    creative_intent_service::freeze(&mut connection, input)
}
