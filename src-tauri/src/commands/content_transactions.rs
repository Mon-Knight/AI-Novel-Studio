use crate::db::get_connection;
use crate::errors::AppError;
use crate::services::content_transaction_service::{
    self, ApplyContentTransactionInput, ApplyContentTransactionResult, ContentTransactionDto,
    FactionDto, LocationDto, PrepareContentTransactionInput,
};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentTransactionIdInput {
    pub transaction_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopedAssetInput {
    pub novel_id: String,
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelListInput {
    pub novel_id: String,
    pub limit: Option<i64>,
}

fn with_connection<T>(
    operation: impl FnOnce(&mut rusqlite::Connection) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    operation(&mut connection)
}

#[tauri::command]
pub fn prepare_content_transaction(
    input: PrepareContentTransactionInput,
) -> Result<ContentTransactionDto, AppError> {
    with_connection(|c| content_transaction_service::prepare_transaction(c, input))
}

#[tauri::command]
pub fn get_content_transaction(
    input: ContentTransactionIdInput,
) -> Result<Option<ContentTransactionDto>, AppError> {
    with_connection(|c| content_transaction_service::get_transaction(c, &input.transaction_id))
}

#[tauri::command]
pub fn list_content_transactions(
    input: NovelListInput,
) -> Result<Vec<ContentTransactionDto>, AppError> {
    with_connection(|c| {
        content_transaction_service::list_transactions(
            c,
            &input.novel_id,
            input.limit.unwrap_or(50),
        )
    })
}

#[tauri::command]
pub fn apply_content_transaction(
    input: ApplyContentTransactionInput,
) -> Result<ApplyContentTransactionResult, AppError> {
    with_connection(|c| content_transaction_service::apply_transaction(c, input))
}

#[tauri::command]
pub fn get_faction_asset(input: ScopedAssetInput) -> Result<Option<FactionDto>, AppError> {
    with_connection(|c| content_transaction_service::get_faction(c, &input.novel_id, &input.id))
}

#[tauri::command]
pub fn list_faction_assets(input: NovelListInput) -> Result<Vec<FactionDto>, AppError> {
    with_connection(|c| content_transaction_service::list_factions(c, &input.novel_id))
}

#[tauri::command]
pub fn get_location_asset(input: ScopedAssetInput) -> Result<Option<LocationDto>, AppError> {
    with_connection(|c| content_transaction_service::get_location(c, &input.novel_id, &input.id))
}

#[tauri::command]
pub fn list_location_assets(input: NovelListInput) -> Result<Vec<LocationDto>, AppError> {
    with_connection(|c| content_transaction_service::list_locations(c, &input.novel_id))
}
