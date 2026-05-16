#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod commands;
mod db;

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
            commands::create_volume,
            commands::update_volume,
            commands::delete_volume,
            commands::get_chapters_by_novel_id,
            commands::create_chapter,
            commands::update_chapter,
            commands::delete_chapter,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
