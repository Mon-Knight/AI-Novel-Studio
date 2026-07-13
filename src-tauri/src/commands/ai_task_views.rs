use crate::db::{get_connection, get_database_path};
use crate::errors::AppError;
use crate::repositories::ai_task_view_repository::{self, AiTaskView};
use crate::services::placement_service;
use rusqlite::{Connection, OpenFlags};

fn open_task_view_connection() -> Result<Connection, AppError> {
    Connection::open_with_flags(
        get_database_path(),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(AppError::database)
}

#[tauri::command]
pub fn list_ai_task_views() -> Result<Vec<AiTaskView>, AppError> {
    // The global task bar hydrates at the same time as the home library.  Its
    // audit projection is substantially more expensive than get_all_novels,
    // so running both through the single writer connection used to make the
    // library wait behind task hydration on every cold launch.  WAL permits a
    // dedicated read-only connection without weakening write serialization.
    let connection = open_task_view_connection()?;
    let mut views = ai_task_view_repository::list(&connection)?;
    for view in views.iter_mut().filter(|view| !view.is_legacy) {
        if view.target_link_count == 0 {
            if let Some(proposal_id) = view.proposal_id.as_deref() {
                let validation = placement_service::validate_proposal(&connection, proposal_id)?;
                if validation.stale {
                    view.result_expired = true;
                    if view.error_message.is_none() {
                        view.error_message = validation.reason;
                    }
                    ai_task_view_repository::refresh_user_status(view);
                }
            }
        }
    }
    Ok(views)
}

#[tauri::command]
pub fn archive_ai_task_view(task_id: String) -> Result<usize, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_task_view_repository::archive_unified(&mut connection, &task_id)
}

#[tauri::command]
pub fn delete_legacy_generation_job_record(job_id: String) -> Result<usize, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    ai_task_view_repository::delete_legacy_generation(&mut connection, &job_id)
}
