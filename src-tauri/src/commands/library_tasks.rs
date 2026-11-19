//! Trusted desktop admission only; this command grants no application authority.
use crate::errors::AppError;
use crate::services::{conversation_service::InitializedTaskConversation, library_task_service};

#[tauri::command]
pub fn create_initialized_library_task(
    input: library_task_service::CreateLibraryTaskInput,
) -> Result<InitializedTaskConversation, AppError> {
    let mut connection = crate::db::get_connection().lock().map_err(|_| AppError::poisoned_lock())?;
    library_task_service::create_initialized(&mut connection, input)
}
