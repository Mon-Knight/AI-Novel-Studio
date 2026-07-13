use crate::db::get_connection;
use crate::domain::apply_plan::{
    ApplyExecutionResult, ApplyPlan, ArtifactTargetLink, CreateApplyPlanInput,
    CreateInitializationApplyPlanInput, ExecuteApplyPlanInput,
};
use crate::domain::co_creation_apply::{
    CoCreationApplyPreparationV1, PrepareCoCreationApplyInput, PrepareCoCreationUndoInput,
};
use crate::domain::placement::{
    CreatePlacementProposalInput, PlacementProposal, PlacementTargetOverride, ProposalValidation,
};
use crate::errors::AppError;
use crate::repositories::artifact_target_link_repository;
use crate::services::{
    apply_service, co_creation_apply_service, initialization_apply_service, placement_service,
};

#[tauri::command]
pub fn create_placement_proposal(
    input: CreatePlacementProposalInput,
) -> Result<PlacementProposal, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    placement_service::create_proposal(&mut connection, input)
}

#[tauri::command]
pub fn get_placement_proposal(proposal_id: String) -> Result<PlacementProposal, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    placement_service::get_proposal(&connection, &proposal_id)
}

#[tauri::command]
pub fn validate_placement_proposal(proposal_id: String) -> Result<ProposalValidation, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    placement_service::validate_proposal(&connection, &proposal_id)
}

#[tauri::command]
pub fn rebuild_placement_proposal(
    proposal_id: String,
    target: Option<PlacementTargetOverride>,
) -> Result<PlacementProposal, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    placement_service::rebuild_proposal(&mut connection, &proposal_id, target)
}

#[tauri::command]
pub fn create_apply_plan(input: CreateApplyPlanInput) -> Result<ApplyPlan, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    apply_service::create_plan(&mut connection, input)
}

#[tauri::command]
pub fn create_initialization_apply_plan(
    input: CreateInitializationApplyPlanInput,
) -> Result<ApplyPlan, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    initialization_apply_service::create_plan(&mut connection, input)
}

#[tauri::command]
pub fn prepare_co_creation_apply(
    input: PrepareCoCreationApplyInput,
) -> Result<CoCreationApplyPreparationV1, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    co_creation_apply_service::prepare_apply(&mut connection, input)
}

#[tauri::command]
pub fn prepare_co_creation_undo(
    input: PrepareCoCreationUndoInput,
) -> Result<CoCreationApplyPreparationV1, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    co_creation_apply_service::prepare_undo(&mut connection, input)
}

#[tauri::command]
pub fn get_apply_plan(plan_id: String) -> Result<ApplyPlan, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    crate::repositories::apply_plan_repository::get_plan(&connection, &plan_id)?.ok_or_else(|| {
        AppError::new(
            crate::errors::codes::APPLY_PLAN_NOT_FOUND,
            "ApplyPlan 不存在",
            false,
        )
    })
}

#[tauri::command]
pub fn execute_apply_plan(input: ExecuteApplyPlanInput) -> Result<ApplyExecutionResult, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    apply_service::execute_plan(&mut connection, input)
}

#[tauri::command]
pub fn get_artifact_target_links(plan_id: String) -> Result<Vec<ArtifactTargetLink>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    artifact_target_link_repository::list_for_plan(&connection, &plan_id)
}
