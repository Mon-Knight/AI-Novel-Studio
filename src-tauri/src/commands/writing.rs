use crate::db::get_connection;
use crate::domain::writing::{
    ChapterDraftDto, ChapterDto, CreateChapterDraftInput, CreateChapterInput, CreateVolumeInput,
    UpdateChapterInput, UpdateVolumeInput, VolumeDto,
};
use crate::services::{chapter_service, volume_service};
use rusqlite::Connection;

// ==================== Volume Commands ====================

#[tauri::command]
pub fn get_volumes_by_novel_id(novel_id: String) -> Result<Vec<VolumeDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    volume_service::list_volumes_by_novel(&conn, &novel_id)
}

#[tauri::command]
pub fn get_volume_by_id(id: String) -> Result<Option<VolumeDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    volume_service::get_volume(&conn, &id)
}

#[tauri::command]
pub fn create_volume(input: CreateVolumeInput) -> Result<VolumeDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    volume_service::create_volume(&conn, input)
}

#[tauri::command]
pub fn update_volume(id: String, input: UpdateVolumeInput) -> Result<VolumeDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    volume_service::update_volume(&conn, &id, input)
}

#[tauri::command]
pub fn delete_volume(id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    volume_service::delete_volume(&conn, &id)
}

pub fn update_volume_internal(
    conn: &Connection,
    id: &str,
    input: UpdateVolumeInput,
    _now: &str,
) -> Result<VolumeDto, String> {
    volume_service::update_volume(conn, id, input)
}

#[allow(dead_code)]
pub fn get_volume_by_id_internal(conn: &Connection, id: &str) -> Result<VolumeDto, String> {
    volume_service::get_volume(conn, id)?.ok_or_else(|| "Query returned no rows".to_string())
}

#[allow(dead_code)]
pub fn delete_volume_internal(conn: &Connection, id: &str) -> Result<(), String> {
    volume_service::delete_volume(conn, id)
}

// ==================== Chapter Commands ====================

#[tauri::command]
pub fn get_chapters_by_novel_id(novel_id: String) -> Result<Vec<ChapterDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_service::list_chapters_by_novel(&conn, &novel_id)
}

#[tauri::command]
pub fn get_chapters_by_volume_id(volume_id: String) -> Result<Vec<ChapterDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_service::list_chapters_by_volume(&conn, &volume_id)
}

#[tauri::command]
pub fn get_chapter_by_id(id: String) -> Result<Option<ChapterDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_service::get_chapter(&conn, &id)
}

#[tauri::command]
pub fn create_chapter(input: CreateChapterInput) -> Result<ChapterDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_service::create_chapter(&conn, input)
}

#[tauri::command]
pub fn update_chapter(id: String, input: UpdateChapterInput) -> Result<ChapterDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_service::update_chapter(&conn, &id, input)
}

#[tauri::command]
pub fn delete_chapter(id: String) -> Result<(), String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_service::delete_chapter(&mut conn, &id)
}

pub fn update_chapter_internal(
    conn: &Connection,
    id: &str,
    input: UpdateChapterInput,
    _now: &str,
) -> Result<ChapterDto, String> {
    chapter_service::update_chapter(conn, id, input)
}

#[allow(dead_code)]
pub fn get_chapter_by_id_internal(conn: &Connection, id: &str) -> Result<ChapterDto, String> {
    chapter_service::get_chapter(conn, id)?.ok_or_else(|| "Query returned no rows".to_string())
}

#[allow(dead_code)]
pub fn delete_chapter_internal(conn: &mut Connection, id: &str) -> Result<(), String> {
    chapter_service::delete_chapter(conn, id)
}

// ==================== Draft Commands ====================

#[tauri::command]
pub fn get_drafts_by_chapter_id(
    chapter_id: String,
    page: Option<i64>,
    size: Option<i64>,
) -> Result<Vec<ChapterDraftDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_service::list_drafts_by_chapter(&conn, &chapter_id, page, size)
}

#[tauri::command]
pub fn count_drafts_by_chapter_id(chapter_id: String) -> Result<i64, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_service::count_drafts_by_chapter(&conn, &chapter_id)
}

#[tauri::command]
pub fn get_latest_draft_by_chapter_id(
    chapter_id: String,
) -> Result<Option<ChapterDraftDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_service::get_latest_draft(&conn, &chapter_id)
}

#[tauri::command]
pub fn get_adopted_draft_by_chapter_id(
    chapter_id: String,
) -> Result<Option<ChapterDraftDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_service::get_adopted_draft(&conn, &chapter_id)
}

#[tauri::command]
pub fn get_draft_by_chapter_and_id(
    chapter_id: String,
    draft_id: String,
) -> Result<Option<ChapterDraftDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_service::get_draft_by_chapter_and_id(&conn, &chapter_id, &draft_id)
}

#[tauri::command]
#[allow(dead_code)]
pub fn create_chapter_draft(input: CreateChapterDraftInput) -> Result<ChapterDraftDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_service::create_chapter_draft(&conn, input)
}

#[tauri::command]
pub fn adopt_chapter_draft(
    draft_id: String,
    chapter_id: String,
) -> Result<ChapterDraftDto, String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_service::adopt_chapter_draft(&mut conn, &draft_id, &chapter_id)
}

#[tauri::command]
pub fn delete_chapter_draft(id: String, chapter_id: String) -> Result<(), String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_service::delete_chapter_draft(&mut conn, &id, &chapter_id)
}

pub fn adopt_chapter_draft_internal(
    conn: &mut Connection,
    draft_id: &str,
    chapter_id: &str,
) -> Result<ChapterDraftDto, String> {
    chapter_service::adopt_chapter_draft(conn, draft_id, chapter_id)
}

pub fn delete_chapter_draft_internal(
    conn: &mut Connection,
    id: &str,
    chapter_id: &str,
) -> Result<(), String> {
    chapter_service::delete_chapter_draft(conn, id, chapter_id)
}

pub fn update_chapter_draft_internal(
    conn: &Connection,
    id: &str,
    chapter_id: &str,
    content: &str,
    source: Option<&str>,
    large_text_ref_id: Option<&str>,
) -> Result<ChapterDraftDto, String> {
    chapter_service::update_chapter_draft_internal(
        conn,
        id,
        chapter_id,
        content,
        source,
        large_text_ref_id,
    )
}

pub fn update_chapter_draft_with_cleanup_internal(
    conn: &mut Connection,
    id: &str,
    chapter_id: &str,
    content: &str,
    source: Option<&str>,
    large_text_ref_id: Option<&str>,
) -> Result<ChapterDraftDto, String> {
    chapter_service::update_chapter_draft_with_cleanup_internal(
        conn,
        id,
        chapter_id,
        content,
        source,
        large_text_ref_id,
    )
}
