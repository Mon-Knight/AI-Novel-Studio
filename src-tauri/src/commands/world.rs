use crate::db::get_connection;
use crate::domain::world::{
    AddChapterCharacterInput, ChapterCharacterDto, ChapterEventDto, CharacterDto,
    CreateChapterEventInput, CreateCharacterInput, ProtagonistDto, RuleSystemDto,
    SaveProtagonistInput, SaveRuleSystemInput, SaveWorldSettingInput, UpdateChapterEventInput,
    UpdateCharacterInput, WorldSettingDto,
};
use crate::services::{chapter_event_service, character_asset_service, world_setting_service};

// ==================== World Setting ====================

#[tauri::command]
pub fn get_world_settings(novel_id: String) -> Result<Vec<WorldSettingDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    world_setting_service::list_world_settings_by_novel(&conn, &novel_id)
}

#[tauri::command]
pub fn save_world_setting(
    id: Option<String>,
    input: SaveWorldSettingInput,
) -> Result<WorldSettingDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    world_setting_service::save_world_setting(&conn, id, input)
}

// ==================== Rule System ====================

#[tauri::command]
pub fn get_rule_systems(novel_id: String) -> Result<Vec<RuleSystemDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    world_setting_service::list_rule_systems_by_novel(&conn, &novel_id)
}

#[tauri::command]
pub fn save_rule_system(
    id: Option<String>,
    input: SaveRuleSystemInput,
) -> Result<RuleSystemDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    world_setting_service::save_rule_system(&conn, id, input)
}

#[tauri::command]
pub fn delete_rule_system(id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    world_setting_service::delete_rule_system(&conn, &id)
}

// ==================== Protagonist ====================

#[tauri::command]
pub fn get_protagonist(novel_id: String) -> Result<Option<ProtagonistDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    world_setting_service::get_protagonist_by_novel(&conn, &novel_id)
}

#[tauri::command]
pub fn save_protagonist(
    id: Option<String>,
    input: SaveProtagonistInput,
) -> Result<ProtagonistDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    world_setting_service::save_protagonist(&conn, id, input)
}

// ==================== Character Library ====================

#[tauri::command]
pub fn sync_protagonist_to_character_library(
    novel_id: String,
) -> Result<Option<CharacterDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let all = character_asset_service::sync_protagonists_to_character_library(&conn, &novel_id)?;
    Ok(all.into_iter().next())
}

#[tauri::command]
pub fn sync_protagonists_to_character_library(
    novel_id: String,
) -> Result<Vec<CharacterDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    character_asset_service::sync_protagonists_to_character_library(&conn, &novel_id)
}

#[tauri::command]
pub fn get_protagonist_character(novel_id: String) -> Result<Option<CharacterDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    character_asset_service::get_single_protagonist_character(&conn, &novel_id)
}

#[tauri::command]
pub fn get_protagonist_characters(novel_id: String) -> Result<Vec<CharacterDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    character_asset_service::get_protagonist_characters(&conn, &novel_id)
}

#[tauri::command]
pub fn list_characters(novel_id: String) -> Result<Vec<CharacterDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    character_asset_service::list_characters_by_novel(&conn, &novel_id)
}

#[tauri::command]
pub fn create_character(input: CreateCharacterInput) -> Result<CharacterDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    character_asset_service::create_character(&conn, input)
}

#[tauri::command]
pub fn update_character(id: String, input: UpdateCharacterInput) -> Result<CharacterDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    character_asset_service::update_character(&conn, &id, input)
}

#[tauri::command]
pub fn delete_character(id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    character_asset_service::delete_character(&conn, &id)
}

// ==================== Chapter Character ====================

#[tauri::command]
pub fn add_chapter_character(
    input: AddChapterCharacterInput,
) -> Result<ChapterCharacterDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    character_asset_service::add_chapter_character(&conn, input)
}

#[tauri::command]
pub fn list_chapter_characters(chapter_id: String) -> Result<Vec<ChapterCharacterDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    character_asset_service::list_chapter_characters(&conn, &chapter_id)
}

#[tauri::command]
pub fn remove_chapter_character(chapter_id: String, character_id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    character_asset_service::remove_chapter_character(&conn, &chapter_id, &character_id)
}

// ==================== Chapter Event ====================

#[tauri::command]
pub fn list_chapter_events(chapter_id: String) -> Result<Vec<ChapterEventDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_event_service::list_chapter_events(&conn, &chapter_id)
}

#[tauri::command]
pub fn create_chapter_event(input: CreateChapterEventInput) -> Result<ChapterEventDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_event_service::create_chapter_event(&conn, input)
}

#[tauri::command]
pub fn update_chapter_event(
    id: String,
    input: UpdateChapterEventInput,
) -> Result<ChapterEventDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_event_service::update_chapter_event(&conn, &id, input)
}

#[tauri::command]
pub fn set_chapter_event_status(id: String, status: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_event_service::set_chapter_event_status(&conn, &id, &status)
}

#[tauri::command]
pub fn delete_chapter_event(id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_event_service::delete_chapter_event(&conn, &id)
}
