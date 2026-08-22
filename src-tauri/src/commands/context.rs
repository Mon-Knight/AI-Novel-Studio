#![allow(unused_imports, dead_code)]

use crate::db::get_connection;

use crate::domain::context::{
    ChapterSummaryDto, CharacterStateDto, ContextRecordDto, SaveChapterContextBundleInput,
    SaveChapterContextBundleResult, SaveChapterSummaryInput, SaveCharacterStateInput,
    SaveContextRecordInput, UpdateContextRecordInput,
};
use crate::services::{
    chapter_context_bundle_service, chapter_summary_service, context_record_service,
};
use rusqlite::Connection;

#[allow(unused_imports, dead_code)]
pub use crate::repositories::chapter_summary_repository::{
    chapter_summary_select_sql, map_chapter_summary_row,
};
pub use crate::repositories::character_state_repository::{
    character_state_select_sql, map_character_state_row,
};
pub use crate::repositories::context_record_repository::{
    context_record_select_sql, map_context_record_row,
};
pub use crate::services::chapter_summary_service::{
    upsert_chapter_summary, validate_summary_ownership, validate_uuid,
};
pub use crate::services::context_record_service::{
    update_context_record as update_context_record_internal, validate_context_record_input,
};

// ==================== Chapter Summary ====================

#[tauri::command]
pub fn save_chapter_summary(input: SaveChapterSummaryInput) -> Result<ChapterSummaryDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_summary_service::save_chapter_summary(&conn, input)
}

#[tauri::command]
pub fn get_chapter_summary(chapter_id: String) -> Result<Option<ChapterSummaryDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_summary_service::get_chapter_summary(&conn, &chapter_id)
}

#[tauri::command]
pub fn get_chapter_summaries_by_novel(novel_id: String) -> Result<Vec<ChapterSummaryDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_summary_service::get_chapter_summaries_by_novel(&conn, &novel_id)
}

#[tauri::command]
pub fn mark_chapter_summaries_expired(chapter_id: String) -> Result<(), String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_summary_service::mark_chapter_context_expired(&mut conn, &chapter_id)
}

#[tauri::command]
pub fn update_chapter_summary_enabled(id: String, enabled: bool) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_summary_service::update_chapter_summary_enabled(&conn, &id, enabled)
}

#[tauri::command]
pub fn get_chapter_summary_by_id(id: String) -> Result<Option<ChapterSummaryDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_summary_service::get_chapter_summary_by_id(&conn, &id)
}

#[tauri::command]
pub fn delete_chapter_summary(id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_summary_service::delete_chapter_summary(&conn, &id)
}

// ==================== Context Records ====================

#[tauri::command]
pub fn save_context_records(
    inputs: Vec<SaveContextRecordInput>,
) -> Result<Vec<ContextRecordDto>, String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    context_record_service::save_context_records(&mut conn, &inputs)
}

#[tauri::command]
pub fn get_context_records(novel_id: String) -> Result<Vec<ContextRecordDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    context_record_service::get_context_records(&conn, &novel_id)
}

#[tauri::command]
pub fn get_context_record(id: String) -> Result<Option<ContextRecordDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    context_record_service::get_context_record(&conn, &id)
}

#[tauri::command]
pub fn update_context_record(
    id: String,
    input: UpdateContextRecordInput,
) -> Result<ContextRecordDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    context_record_service::update_context_record(&conn, &id, &input)
}

#[tauri::command]
pub fn update_context_record_active(id: String, is_active: bool) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    context_record_service::update_context_record_active(&conn, &id, is_active)
}

#[tauri::command]
pub fn delete_context_record(id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    context_record_service::delete_context_record(&conn, &id)
}

// ==================== Chapter Context Bundle ====================

#[tauri::command]
pub fn save_chapter_context_bundle(
    input: SaveChapterContextBundleInput,
) -> Result<SaveChapterContextBundleResult, String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_context_bundle_service::save_chapter_context_bundle(&mut conn, &input)
}

// ==================== Character State ====================

#[tauri::command]
pub fn save_character_state(input: SaveCharacterStateInput) -> Result<CharacterStateDto, String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_context_bundle_service::save_character_state(&mut conn, input)
}

#[tauri::command]
pub fn get_character_states_by_character(
    character_id: String,
) -> Result<Vec<CharacterStateDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_context_bundle_service::get_character_states_by_character(&conn, &character_id)
}

#[tauri::command]
pub fn get_character_states_by_chapter(
    chapter_id: String,
) -> Result<Vec<CharacterStateDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_context_bundle_service::get_character_states_by_chapter(&conn, &chapter_id)
}

#[tauri::command]
pub fn delete_character_state(id: String) -> Result<(), String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_context_bundle_service::delete_character_state(&mut conn, &id)
}

// ==================== Backward-Compatible Internal Helpers ====================

pub fn get_chapter_summaries_by_novel_internal(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<ChapterSummaryDto>, String> {
    chapter_summary_service::get_chapter_summaries_by_novel(conn, novel_id)
}

pub fn get_chapter_summary_internal(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Option<ChapterSummaryDto>, String> {
    chapter_summary_service::get_chapter_summary(conn, chapter_id)
}

pub fn mark_chapter_context_expired_internal(
    conn: &mut Connection,
    chapter_id: &str,
) -> Result<(), String> {
    chapter_summary_service::mark_chapter_context_expired(conn, chapter_id)
}

#[allow(dead_code)]
pub fn expire_chapter_context_rows(
    conn: &Connection,
    chapter_id: &str,
    updated_at: &str,
) -> Result<(), String> {
    chapter_summary_service::expire_chapter_context_rows(conn, chapter_id, updated_at)
}

pub fn get_context_records_internal(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<ContextRecordDto>, String> {
    context_record_service::get_context_records(conn, novel_id)
}

pub fn save_context_records_internal(
    conn: &mut Connection,
    inputs: &[SaveContextRecordInput],
) -> Result<Vec<ContextRecordDto>, String> {
    context_record_service::save_context_records(conn, inputs)
}

pub fn save_chapter_context_bundle_internal(
    conn: &mut Connection,
    input: &SaveChapterContextBundleInput,
) -> Result<SaveChapterContextBundleResult, String> {
    chapter_context_bundle_service::save_chapter_context_bundle(conn, input)
}
