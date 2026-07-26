use crate::db::get_connection;
use crate::errors::AppError;
use crate::repositories::agent_plan_repository::{
    AgentExecutionLeaseRecord, AgentPlanBundle, AgentPlanRecord,
};
use crate::services::agent_plan_service::{
    self, AcquireAgentPlanLeaseInput, AgentPlanLeaseGrant, AgentPlanLeaseProof, AgentPlanStepClaim,
    AuthorizeAgentPlanRetryInput, ClaimAgentPlanStepInput, CompleteAgentPlanStepInput,
    CreateAgentPlanInput, FailAgentPlanStepInput,
};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanIdInput {
    pub plan_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAgentPlansByChapterInput {
    pub chapter_id: String,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAgentPlanLeaseInput {
    pub plan_id: String,
    pub lease: AgentPlanLeaseProof,
}

#[tauri::command]
pub fn create_agent_plan(input: CreateAgentPlanInput) -> Result<AgentPlanBundle, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    agent_plan_service::create_plan(&mut connection, input)
}

#[tauri::command]
pub fn get_agent_plan(input: AgentPlanIdInput) -> Result<AgentPlanBundle, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    agent_plan_service::get_plan_bundle(&connection, &input.plan_id)
}

#[tauri::command]
pub fn list_agent_plans_by_chapter(
    input: ListAgentPlansByChapterInput,
) -> Result<Vec<AgentPlanRecord>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    agent_plan_service::list_plans_by_chapter(
        &connection,
        &input.chapter_id,
        input.limit.unwrap_or(20),
    )
}

#[tauri::command]
pub fn acquire_agent_plan_lease(
    input: AcquireAgentPlanLeaseInput,
) -> Result<AgentPlanLeaseGrant, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    agent_plan_service::acquire_lease(&mut connection, input)
}

#[tauri::command]
pub fn claim_agent_plan_step(
    input: ClaimAgentPlanStepInput,
) -> Result<AgentPlanStepClaim, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    agent_plan_service::claim_step(&mut connection, input)
}

#[tauri::command]
pub fn complete_agent_plan_step(
    input: CompleteAgentPlanStepInput,
) -> Result<AgentPlanBundle, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    agent_plan_service::complete_step(&mut connection, input)
}

#[tauri::command]
pub fn fail_agent_plan_step(input: FailAgentPlanStepInput) -> Result<AgentPlanBundle, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    agent_plan_service::fail_step(&mut connection, input)
}

#[tauri::command]
pub fn authorize_agent_plan_retry(
    input: AuthorizeAgentPlanRetryInput,
) -> Result<AgentPlanBundle, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    agent_plan_service::authorize_retry(&mut connection, input)
}

#[tauri::command]
pub fn release_agent_plan_lease(
    input: ReleaseAgentPlanLeaseInput,
) -> Result<AgentExecutionLeaseRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    agent_plan_service::release_lease(&mut connection, &input.plan_id, input.lease)
}

#[tauri::command]
pub fn cancel_agent_plan(input: AgentPlanIdInput) -> Result<AgentPlanBundle, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    agent_plan_service::cancel_plan(&mut connection, &input.plan_id)
}

#[tauri::command]
pub fn recover_interrupted_agent_plans() -> Result<Vec<AgentPlanBundle>, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    agent_plan_service::recover_interrupted_plans(&mut connection)
}
