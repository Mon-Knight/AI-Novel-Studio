#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod commands;
mod ai;
mod db;
mod large_text_save;
mod outline_commands;

fn main() {
    db::init_database();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::get_all_novels,
            commands::get_novel_by_id,
            commands::create_novel,
            commands::update_novel,
            commands::delete_novel,
            commands::get_world_settings,
            commands::save_world_setting,
            commands::get_rule_systems,
            commands::save_rule_system,
            commands::delete_rule_system,
            commands::get_protagonist,
            commands::save_protagonist,
            commands::get_volumes_by_novel_id,
            commands::get_volume_by_id,
            commands::create_volume,
            commands::update_volume,
            commands::delete_volume,
            commands::get_chapters_by_novel_id,
            commands::get_chapters_by_volume_id,
            commands::get_chapter_by_id,
            commands::create_chapter,
            commands::update_chapter,
            commands::delete_chapter,
            commands::get_drafts_by_chapter_id,
            commands::get_latest_draft_by_chapter_id,
            commands::create_chapter_draft,
            commands::update_chapter_draft,
            commands::adopt_chapter_draft,
            commands::delete_chapter_draft,
            commands::create_ai_task_record,
            commands::mark_ai_task_succeeded,
            commands::mark_ai_task_failed,
            commands::get_ai_task_records,
            commands::count_ai_task_records,
            commands::get_ai_task_records_by_chapter_id,
            commands::get_ai_task_records_by_novel_id,
            ai::ai_chat_completion,
            large_text_save::create_large_text_save_session,
            large_text_save::append_large_text_chunk,
            large_text_save::finalize_large_text_save,
            large_text_save::abort_large_text_save,
            large_text_save::cleanup_expired_large_text_save_sessions,
            large_text_save::read_large_text_content,
            large_text_save::update_large_text_ref,
            outline_commands::save_master_outline,
            outline_commands::get_master_outline,
            outline_commands::get_master_outline_versions,
            outline_commands::set_active_master_outline,
            outline_commands::save_volume_outline,
            outline_commands::get_volume_outline,
            outline_commands::get_volume_outline_versions,
            outline_commands::set_active_volume_outline,
            outline_commands::save_chapter_outline,
            outline_commands::get_chapter_outline,
            outline_commands::get_chapter_outline_versions,
            outline_commands::set_active_chapter_outline,
            outline_commands::build_outline_context,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
