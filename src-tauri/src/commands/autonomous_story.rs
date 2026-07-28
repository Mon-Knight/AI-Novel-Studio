use crate::db::get_connection;
use crate::errors::AppError;
use crate::services::autonomous_story_service::{self, ApplyAutonomousPlanResult};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAutonomousStoryPlanInput {
    pub plan: Value,
    pub expected_revision: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousPlanIdInput {
    pub plan_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousOperationIdInput {
    pub operation_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAutonomousPlansInput {
    pub novel_id: String,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyAutonomousPlanInput {
    pub plan_id: String,
    pub expected_revision: i64,
}

#[tauri::command]
pub fn save_autonomous_story_plan(input: SaveAutonomousStoryPlanInput) -> Result<Value, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_story_service::save_plan(&mut connection, input.plan, input.expected_revision)
}

#[tauri::command]
pub fn get_autonomous_story_plan(input: AutonomousPlanIdInput) -> Result<Option<Value>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_story_service::get_plan(&connection, &input.plan_id)
}

#[tauri::command]
pub fn get_autonomous_story_plan_by_operation(
    input: AutonomousOperationIdInput,
) -> Result<Option<Value>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_story_service::get_plan_by_operation(&connection, &input.operation_id)
}

#[tauri::command]
pub fn list_autonomous_story_plans_by_novel(
    input: ListAutonomousPlansInput,
) -> Result<Vec<Value>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_story_service::list_plans_by_novel(
        &connection,
        &input.novel_id,
        input.limit.unwrap_or(20),
    )
}

#[tauri::command]
pub fn apply_autonomous_story_plan(
    input: ApplyAutonomousPlanInput,
) -> Result<ApplyAutonomousPlanResult, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_story_service::apply_plan(&mut connection, &input.plan_id, input.expected_revision)
}
