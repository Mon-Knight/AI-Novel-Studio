use crate::db::get_connection;
use crate::domain::co_creation::{
    AppendCoCreationUserMessageInput, BindCoCreationTurnTaskInput, CoCreationMutationReceiptV1,
    CoCreationWorkspaceV1, CompleteCoCreationTurnInput, FailCoCreationTurnInput,
    OpenCoCreationWorkspaceInput, OpenCoCreationWorkspaceResultV1, ReadCoCreationWorkspaceInput,
    RecoverCoCreationTurnTaskInput, RecoveredCoCreationTurnTaskV1,
    SaveCoCreationDraftRevisionInput,
};
use crate::errors::AppError;
use crate::services::co_creation_service;

#[tauri::command]
pub fn open_co_creation_workspace(
    input: OpenCoCreationWorkspaceInput,
) -> Result<OpenCoCreationWorkspaceResultV1, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    co_creation_service::open_workspace(&mut connection, input)
}

#[tauri::command]
pub fn read_co_creation_workspace(
    input: ReadCoCreationWorkspaceInput,
) -> Result<CoCreationWorkspaceV1, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    co_creation_service::read_workspace(&connection, input)
}

#[tauri::command]
pub fn recover_co_creation_turn_task(
    input: RecoverCoCreationTurnTaskInput,
) -> Result<Option<RecoveredCoCreationTurnTaskV1>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    co_creation_service::recover_turn_task(&connection, input)
}

#[tauri::command]
pub fn append_co_creation_user_message(
    input: AppendCoCreationUserMessageInput,
) -> Result<CoCreationMutationReceiptV1, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    co_creation_service::append_user_message(&mut connection, input)
}

#[tauri::command]
pub fn bind_co_creation_turn_task(
    input: BindCoCreationTurnTaskInput,
) -> Result<CoCreationMutationReceiptV1, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    co_creation_service::bind_turn_task(&mut connection, input)
}

#[tauri::command]
pub fn complete_co_creation_turn(
    input: CompleteCoCreationTurnInput,
) -> Result<CoCreationMutationReceiptV1, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    co_creation_service::complete_turn(&mut connection, input)
}

#[tauri::command]
pub fn fail_co_creation_turn(
    input: FailCoCreationTurnInput,
) -> Result<CoCreationMutationReceiptV1, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    co_creation_service::fail_turn(&mut connection, input)
}

#[tauri::command]
pub fn save_co_creation_draft_revision(
    input: SaveCoCreationDraftRevisionInput,
) -> Result<CoCreationMutationReceiptV1, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    co_creation_service::save_draft_revision(&mut connection, input)
}
