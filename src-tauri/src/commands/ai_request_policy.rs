use crate::db::get_connection;
use crate::errors::AppError;
use crate::services::ai_request_policy_service::{
    self, AiRequestBudgetSnapshotDto, AiRequestPolicyDto, AiRequestPolicyLeaseGrant,
    AiRequestPolicySettlement, ConfigureAiRequestPolicyInput, ReserveAiRequestInput,
    SettleAiRequestInput,
};

fn with_connection<T>(
    operation: impl FnOnce(&mut rusqlite::Connection) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    operation(&mut connection)
}

#[tauri::command]
pub fn configure_ai_request_policy(
    input: ConfigureAiRequestPolicyInput,
) -> Result<AiRequestPolicyDto, AppError> {
    with_connection(|connection| ai_request_policy_service::configure_policy(connection, input))
}

#[tauri::command]
pub fn reserve_ai_request(
    input: ReserveAiRequestInput,
) -> Result<AiRequestPolicyLeaseGrant, AppError> {
    with_connection(|connection| ai_request_policy_service::reserve_request(connection, input))
}

#[tauri::command]
pub fn settle_ai_request(
    input: SettleAiRequestInput,
) -> Result<AiRequestPolicySettlement, AppError> {
    with_connection(|connection| ai_request_policy_service::settle_request(connection, input))
}

#[tauri::command]
pub fn get_ai_request_policy_snapshot() -> Result<AiRequestBudgetSnapshotDto, AppError> {
    with_connection(ai_request_policy_service::get_snapshot)
}
