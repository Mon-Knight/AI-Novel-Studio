use crate::db::get_connection;
use crate::errors::AppError;
use crate::repositories::memory_repository::{MemorySnapshotBundle, MemorySnapshotRecord};
use crate::services::memory_service::{
    self, CreateMemorySnapshotInput, MemorySnapshotVerification,
};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnapshotIdInput {
    pub snapshot_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMemorySnapshotsByChapterInput {
    pub chapter_id: String,
    pub limit: Option<i64>,
}

#[tauri::command]
pub fn create_memory_snapshot(
    input: CreateMemorySnapshotInput,
) -> Result<MemorySnapshotBundle, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    memory_service::create_snapshot(&mut connection, input)
}

#[tauri::command]
pub fn get_memory_snapshot(
    input: MemorySnapshotIdInput,
) -> Result<MemorySnapshotBundle, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    memory_service::get_snapshot_bundle(&connection, &input.snapshot_id)
}

#[tauri::command]
pub fn list_memory_snapshots_by_chapter(
    input: ListMemorySnapshotsByChapterInput,
) -> Result<Vec<MemorySnapshotRecord>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    memory_service::list_snapshots_by_chapter(
        &connection,
        &input.chapter_id,
        input.limit.unwrap_or(20),
    )
}

#[tauri::command]
pub fn verify_memory_snapshot(
    input: MemorySnapshotIdInput,
) -> Result<MemorySnapshotVerification, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    memory_service::verify_snapshot(&connection, &input.snapshot_id)
}

