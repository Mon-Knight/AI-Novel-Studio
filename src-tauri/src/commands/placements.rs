use crate::db::get_connection;
use crate::errors::AppError;
use crate::services::placement_service::{
    self, ApplyPlacementInput, ApplyPlacementResult, PlacementBundle, PreparePlacementInput,
};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementIdInput {
    pub proposal_id: String,
}

#[tauri::command]
pub fn prepare_placement_proposal(
    input: PreparePlacementInput,
) -> Result<PlacementBundle, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    placement_service::prepare_placement(&mut connection, input)
}

#[tauri::command]
pub fn get_placement_proposal(input: PlacementIdInput) -> Result<PlacementBundle, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    placement_service::get_placement(&connection, &input.proposal_id)
}

#[tauri::command]
pub fn apply_placement_plan(input: ApplyPlacementInput) -> Result<ApplyPlacementResult, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    placement_service::apply_placement(&mut connection, input)
}
