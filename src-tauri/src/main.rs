#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod ai;
mod commands;
mod db;
mod large_text_save;
mod outline_commands;
mod project_backup;
mod runtime;
mod system_accent;
mod window_state;

use tauri::Manager;

#[cfg(feature = "e2e")]
macro_rules! generate_app_handler {
    ($($command:path),* $(,)?) => {
        tauri::generate_handler![
            $($command,)*
            runtime::get_e2e_large_text_draft_state,
            runtime::corrupt_e2e_large_text_chunk,
        ]
    };
}

#[cfg(not(feature = "e2e"))]
macro_rules! generate_app_handler {
    ($($command:path),* $(,)?) => {
        tauri::generate_handler![$($command),*]
    };
}

/// Native Feel P1: 获取应用数据目录
fn get_app_data_dir() -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let dir = std::path::PathBuf::from(appdata).join("com.ainovelstudio.app");
            let _ = std::fs::create_dir_all(&dir);
            return dir;
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(home) = std::env::var("HOME") {
            let dir = std::path::PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("com.ainovelstudio.app");
            let _ = std::fs::create_dir_all(&dir);
            return dir;
        }
    }
    std::path::PathBuf::from(".")
}

fn main() {
    let startup_at = std::time::Instant::now();
    println!("[Startup] tauri main start");
    #[cfg(feature = "e2e")]
    runtime::require_e2e_runtime_flag_for_feature().unwrap_or_else(|error| {
        eprintln!("[E2E] startup rejected: {}", error);
        std::process::exit(2);
    });
    let e2e_data_dir = runtime::initialize_e2e_environment().unwrap_or_else(|error| {
        eprintln!("[E2E] startup rejected: {}", error);
        std::process::exit(2);
    });
    db::init_database();
    runtime::append_e2e_log("startup: database initialized");
    println!(
        "[Startup] database initialized: {} ms",
        startup_at.elapsed().as_millis()
    );

    // Native Feel P1.1: 确定应用数据目录
    let app_data_dir = e2e_data_dir.unwrap_or_else(get_app_data_dir);

    // 单实例检测
    if !window_state::try_acquire_instance_lock(&app_data_dir) {
        // 已有实例在运行，写入聚焦请求后退出
        window_state::write_focus_request(&app_data_dir);
        std::process::exit(0);
    }

    // 提前加载窗口状态
    let saved_state = window_state::load_window_state(&app_data_dir);
    let state_for_close = app_data_dir.clone();
    let focus_watch_dir = app_data_dir.clone();

    tauri::Builder::default()
        .invoke_handler(generate_app_handler![
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
            commands::get_chapter_engineering_states,
            commands::save_chapter_engineering_draft,
            commands::activate_chapter_engineering_state,
            commands::save_chapter_generation_snapshot,
            commands::get_chapter_generation_snapshots,
            commands::get_latest_chapter_generation_snapshot,
            commands::create_generation_job,
            commands::update_generation_job,
            commands::get_generation_job,
            commands::get_generation_jobs_by_chapter_id,
            commands::cancel_generation_job,
            commands::save_generation_step_result,
            commands::get_generation_step_results,
            commands::recover_interrupted_generation_jobs,
            commands::create_ai_task_record,
            commands::mark_ai_task_succeeded,
            commands::mark_ai_task_failed,
            commands::mark_ai_task_cancelled,
            commands::get_ai_task_records,
            commands::count_ai_task_records,
            commands::delete_ai_task_record,
            commands::delete_ai_task_records_by_ids,
            commands::clear_ai_task_records,
            commands::get_ai_task_records_debug_state,
            commands::get_ai_task_records_by_chapter_id,
            commands::get_ai_task_records_by_novel_id,
            ai::ai_chat_completion,
            ai::cancel_ai_request,
            runtime::get_e2e_diagnostics,
            runtime::get_e2e_novel_commit_state,
            large_text_save::create_large_text_save_session,
            large_text_save::append_large_text_chunk,
            large_text_save::finalize_large_text_save,
            large_text_save::commit_large_text_draft_create,
            large_text_save::commit_large_text_draft_update,
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
            commands::list_style_profiles,
            commands::get_active_style_profile,
            commands::save_style_profile,
            commands::set_active_style_profile,
            commands::delete_style_profile,
            commands::sync_protagonist_to_character_library,
            commands::sync_protagonists_to_character_library,
            commands::get_protagonist_character,
            commands::get_protagonist_characters,
            commands::list_characters,
            commands::create_character,
            commands::update_character,
            commands::delete_character,
            commands::add_chapter_character,
            commands::list_chapter_characters,
            commands::remove_chapter_character,
            commands::get_quality_check_issues,
            commands::list_quality_check_reports,
            commands::get_quality_check_report_snapshot,
            commands::create_quality_check_report,
            commands::update_quality_issue_status,
            commands::batch_update_quality_issue_status,
            commands::save_quality_check_result,
            commands::save_chapter_summary,
            commands::get_chapter_summary,
            commands::get_chapter_summary_by_id,
            commands::get_chapter_summaries_by_novel,
            commands::mark_chapter_summaries_expired,
            commands::update_chapter_summary_enabled,
            commands::delete_chapter_summary,
            commands::save_context_records,
            commands::get_context_records,
            commands::get_context_record,
            commands::update_context_record,
            commands::update_context_record_active,
            commands::delete_context_record,
            commands::get_character_states_by_character,
            commands::get_character_states_by_chapter,
            commands::save_character_state,
            commands::delete_character_state,
            commands::save_chapter_context_bundle,
            commands::migrate_legacy_chapter_context,
            commands::save_quality_fix_run,
            commands::get_quality_fix_runs,
            commands::update_quality_fix_run_status,
            commands::save_context_read_log,
            project_backup::export_project_backup,
            project_backup::import_project_backup,
            project_backup::discard_imported_project_backup,
            system_accent::get_system_accent_color,
        ])
        .setup(move |app| {
            println!(
                "[Startup] tauri setup reached: {} ms",
                startup_at.elapsed().as_millis()
            );
            // Native Feel P1.1: 恢复窗口状态
            if let Some(window) = app.get_window("main") {
                window_state::apply_window_state(&window, &saved_state);
            }

            // Native Feel P1.1: 后台监听聚焦请求（单实例第二启动时聚焦已有窗口）
            let handle = app.handle();
            let watch_dir = focus_watch_dir.clone();
            std::thread::spawn(move || {
                let focus_req_path = watch_dir.join("focus.request");
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    if focus_req_path.exists() {
                        // 聚焦已有窗口
                        if let Some(window) = handle.get_window("main") {
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                        let _ = std::fs::remove_file(&focus_req_path);
                    }
                }
            });

            Ok(())
        })
        .on_window_event(move |event| {
            // Native Feel P1: 关闭时保存窗口状态并释放单实例锁
            if let tauri::WindowEvent::Destroyed = event.event() {
                window_state::save_window_state(event.window(), &state_for_close);
                window_state::release_instance_lock(&state_for_close);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
