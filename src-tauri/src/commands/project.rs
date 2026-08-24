use crate::db::get_connection;
use crate::domain::project::{CreateNovelInput, NovelDto, UpdateNovelInput};
use crate::services::project_service;

#[tauri::command]
pub fn get_all_novels() -> Result<Vec<NovelDto>, String> {
    crate::runtime::append_e2e_log("get_all_novels: waiting for database lock");
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    crate::runtime::append_e2e_log("get_all_novels: database lock acquired");
    let novels = project_service::list_novels(&conn)?;
    crate::runtime::append_e2e_log("get_all_novels: complete");
    Ok(novels)
}

#[tauri::command]
pub fn get_novel_by_id(id: String) -> Result<Option<NovelDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    project_service::get_novel(&conn, &id)
}

#[tauri::command]
pub fn create_novel(input: CreateNovelInput) -> Result<NovelDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    project_service::create_novel(&conn, input)
}

#[tauri::command]
pub fn update_novel(id: String, input: UpdateNovelInput) -> Result<NovelDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    project_service::update_novel(&conn, &id, input)
}

#[tauri::command]
pub fn delete_novel(id: String) -> Result<(), String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    project_service::delete_novel(&mut conn, &id)
}

#[tauri::command]
pub fn delete_novel_cascade(id: String) -> Result<(), String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    project_service::delete_novel_cascade(&mut conn, &id)
}

#[tauri::command]
pub fn repair_database() -> Result<crate::domain::project::DatabaseRepairResult, String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    project_service::repair_database(&mut conn)
}
