use crate::db::get_connection;
use crate::errors::AppError;
use crate::services::autonomous_scheduler_service::{
    self, AcquireAutonomousRunLeaseInput, AuthorizeFullAutoAttemptInput,
    AuthorizeFullAutoAttemptResult, AutonomousBookRunDto, AutonomousRunChapterAttemptDto,
    AutonomousRunChapterClaim, AutonomousRunLeaseDto, AutonomousRunLeaseGrant,
    ChangeAutonomousRunStateInput, ClaimAutonomousRunChapterInput, CreateAutonomousBookRunInput,
    FinishAutonomousRunChapterInput, FinishAutonomousRunChapterResult, HeartbeatAutonomousRunInput,
    PromoteAutonomousRunAttemptInput,
};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousRunIdInput {
    pub run_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAutonomousRunsInput {
    pub novel_id: String,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListAutonomousRunAttemptsInput {
    pub run_id: String,
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
pub fn create_autonomous_book_run(
    input: CreateAutonomousBookRunInput,
) -> Result<AutonomousBookRunDto, AppError> {
    with_connection(|connection| autonomous_scheduler_service::create_run(connection, input))
}

#[tauri::command]
pub fn get_autonomous_book_run(
    input: AutonomousRunIdInput,
) -> Result<Option<AutonomousBookRunDto>, AppError> {
    with_connection(|connection| autonomous_scheduler_service::get_run(connection, &input.run_id))
}

#[tauri::command]
pub fn list_autonomous_book_runs(
    input: ListAutonomousRunsInput,
) -> Result<Vec<AutonomousBookRunDto>, AppError> {
    with_connection(|connection| {
        autonomous_scheduler_service::list_runs(
            connection,
            &input.novel_id,
            input.limit.unwrap_or(50),
        )
    })
}

#[tauri::command]
pub fn acquire_autonomous_run_lease(
    input: AcquireAutonomousRunLeaseInput,
) -> Result<AutonomousRunLeaseGrant, AppError> {
    with_connection(|connection| autonomous_scheduler_service::acquire_lease(connection, input))
}

#[tauri::command]
pub fn heartbeat_autonomous_run(
    input: HeartbeatAutonomousRunInput,
) -> Result<AutonomousRunLeaseDto, AppError> {
    with_connection(|connection| autonomous_scheduler_service::heartbeat(connection, input))
}

#[tauri::command]
pub fn claim_autonomous_run_chapter(
    input: ClaimAutonomousRunChapterInput,
) -> Result<AutonomousRunChapterClaim, AppError> {
    with_connection(|connection| autonomous_scheduler_service::claim_chapter(connection, input))
}

#[tauri::command]
pub fn finish_autonomous_run_chapter(
    input: FinishAutonomousRunChapterInput,
) -> Result<FinishAutonomousRunChapterResult, AppError> {
    with_connection(|connection| autonomous_scheduler_service::finish_chapter(connection, input))
}

#[tauri::command]
pub fn authorize_full_auto_run_attempt(
    input: AuthorizeFullAutoAttemptInput,
) -> Result<AuthorizeFullAutoAttemptResult, AppError> {
    with_connection(|connection| {
        autonomous_scheduler_service::authorize_full_auto_attempt(connection, input)
    })
}

#[tauri::command]
pub fn promote_autonomous_run_attempt(
    input: PromoteAutonomousRunAttemptInput,
) -> Result<FinishAutonomousRunChapterResult, AppError> {
    with_connection(|connection| autonomous_scheduler_service::promote_attempt(connection, input))
}

#[tauri::command]
pub fn list_autonomous_run_attempts(
    input: ListAutonomousRunAttemptsInput,
) -> Result<Vec<AutonomousRunChapterAttemptDto>, AppError> {
    with_connection(|connection| {
        autonomous_scheduler_service::list_attempts(
            connection,
            &input.run_id,
            input.limit.unwrap_or(100),
        )
    })
}

#[tauri::command]
pub fn pause_autonomous_book_run(
    input: ChangeAutonomousRunStateInput,
) -> Result<AutonomousBookRunDto, AppError> {
    with_connection(|connection| autonomous_scheduler_service::pause_run(connection, input))
}

#[tauri::command]
pub fn resume_autonomous_book_run(
    input: ChangeAutonomousRunStateInput,
) -> Result<AutonomousBookRunDto, AppError> {
    with_connection(|connection| autonomous_scheduler_service::resume_run(connection, input))
}

#[tauri::command]
pub fn stop_autonomous_book_run(
    input: ChangeAutonomousRunStateInput,
) -> Result<AutonomousBookRunDto, AppError> {
    with_connection(|connection| autonomous_scheduler_service::stop_run(connection, input))
}

#[tauri::command]
pub fn recover_interrupted_autonomous_runs() -> Result<Vec<AutonomousBookRunDto>, AppError> {
    with_connection(autonomous_scheduler_service::recover_interrupted_runs)
}
