#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod ai;
mod commands;
mod db;
mod domain;
mod errors;
mod large_text_save;
mod migrations;
mod outline_commands;
mod repositories;
mod services;
mod system_accent;
mod window_state;

use errors::{codes, AppError};
use tauri::api::dialog::{blocking::MessageDialogBuilder, MessageDialogButtons, MessageDialogKind};
use tauri::Manager;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DatabaseStartupErrorKind {
    Checksum,
    Compatibility,
    Corruption,
    Migration,
    Busy,
    Initialization,
}

impl DatabaseStartupErrorKind {
    fn support_code(self) -> &'static str {
        match self {
            Self::Checksum => "DB-CHECKSUM",
            Self::Compatibility => "DB-COMPATIBILITY",
            Self::Corruption => "DB-CORRUPT",
            Self::Migration => "DB-MIGRATION",
            Self::Busy => "DB-BUSY",
            Self::Initialization => "DB-STARTUP",
        }
    }
}

struct DatabaseStartupNotice {
    title: &'static str,
    message: &'static str,
}

fn startup_detail<'a>(error: &'a AppError, key: &str) -> Option<&'a str> {
    error
        .details
        .as_ref()
        .and_then(|details| details.as_object())
        .and_then(|details| details.get(key))
        .and_then(|value| value.as_str())
}

fn classify_database_startup_error(error: &AppError) -> DatabaseStartupErrorKind {
    if startup_detail(error, "migrationId").is_some()
        && startup_detail(error, "expectedChecksum").is_some()
        && startup_detail(error, "actualChecksum").is_some()
    {
        return DatabaseStartupErrorKind::Checksum;
    }

    if startup_detail(error, "stage") == Some("legacy_snapshot_compatibility") {
        return DatabaseStartupErrorKind::Compatibility;
    }

    let sqlite_error_code = startup_detail(error, "sqliteErrorCode");
    let sqlite_error = startup_detail(error, "sqliteError")
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(sqlite_error_code, Some("DatabaseCorrupt" | "NotADatabase"))
        || sqlite_error.contains("database disk image is malformed")
        || sqlite_error.contains("file is not a database")
    {
        return DatabaseStartupErrorKind::Corruption;
    }

    if error.code == codes::DATABASE_BUSY {
        return DatabaseStartupErrorKind::Busy;
    }

    if startup_detail(error, "startupStage") == Some("create_schema")
        || startup_detail(error, "stage") == Some("snapshot_delete_guards")
        || startup_detail(error, "migrationId").is_some()
    {
        return DatabaseStartupErrorKind::Migration;
    }

    DatabaseStartupErrorKind::Initialization
}

fn database_startup_notice(error: &AppError) -> DatabaseStartupNotice {
    let title = "AI Novel Studio 无法启动";
    let message = match classify_database_startup_error(error) {
        DatabaseStartupErrorKind::Checksum => {
            "检测到数据库迁移账本校验失败。为保护作品数据，应用已停止启动。\n\n请不要修改或删除数据库文件，并向维护者提供错误编号：DB-CHECKSUM。"
        }
        DatabaseStartupErrorKind::Compatibility => {
            "检测到旧版数据库结构不符合已知兼容基线。为避免错误写入，应用已停止启动。\n\n请保留原数据库文件，并向维护者提供错误编号：DB-COMPATIBILITY。"
        }
        DatabaseStartupErrorKind::Corruption => {
            "数据库文件损坏或格式无法识别。应用未继续写入。\n\n请保留原文件及备份，并向维护者提供错误编号：DB-CORRUPT。"
        }
        DatabaseStartupErrorKind::Migration => {
            "数据库结构升级未能安全完成。应用已停止启动，未绕过校验。\n\n请保留原数据库文件，并向维护者提供错误编号：DB-MIGRATION。"
        }
        DatabaseStartupErrorKind::Busy => {
            "数据库当前被其他程序或另一个 AI Novel Studio 实例占用。应用未继续启动。\n\n请关闭相关实例后重试。错误编号：DB-BUSY。"
        }
        DatabaseStartupErrorKind::Initialization => {
            "无法打开或配置本地数据库。应用未继续启动。\n\n请检查磁盘空间与目录权限，并保留原数据库文件。错误编号：DB-STARTUP。"
        }
    };
    DatabaseStartupNotice { title, message }
}

#[cfg(any(debug_assertions, test))]
fn database_startup_diagnostic(error: &AppError) -> serde_json::Value {
    const SAFE_DETAIL_KEYS: [&str; 12] = [
        "startupStage",
        "databasePath",
        "migrationId",
        "expectedChecksum",
        "actualChecksum",
        "stage",
        "reason",
        "sqliteErrorCode",
        "sqliteError",
        "ioErrorKind",
        "ioError",
        "migrationVersion",
    ];

    let mut safe_details = serde_json::Map::new();
    if let Some(details) = error.details.as_ref().and_then(|value| value.as_object()) {
        for key in SAFE_DETAIL_KEYS {
            if let Some(value) = details.get(key) {
                safe_details.insert(key.to_string(), value.clone());
            }
        }
    }

    serde_json::json!({
        "category": classify_database_startup_error(error).support_code(),
        "code": error.code,
        "retryable": error.retryable,
        "details": safe_details,
    })
}

fn report_database_startup_error(error: &AppError) {
    #[cfg(debug_assertions)]
    match serde_json::to_string_pretty(&database_startup_diagnostic(error)) {
        Ok(diagnostic) => eprintln!("[Startup] database initialization failed:\n{diagnostic}"),
        Err(_) => eprintln!(
            "[Startup] database initialization failed: category={}, code={}",
            classify_database_startup_error(error).support_code(),
            error.code
        ),
    }

    #[cfg(not(debug_assertions))]
    eprintln!(
        "[Startup] database initialization failed: category={}, code={}",
        classify_database_startup_error(error).support_code(),
        error.code
    );

    let notice = database_startup_notice(error);
    let _ = MessageDialogBuilder::new(notice.title, notice.message)
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::Ok)
        .show();
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
    if let Err(error) = db::init_database() {
        report_database_startup_error(&error);
        std::process::exit(1);
    }
    println!(
        "[Startup] database initialized: {} ms",
        startup_at.elapsed().as_millis()
    );

    // Native Feel P1.1: 确定应用数据目录
    let app_data_dir = get_app_data_dir();

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
            commands::drafts::save_chapter_draft_atomic,
            commands::drafts::read_chapter_draft_content,
            commands::drafts::adopt_chapter_draft_safe,
            commands::ai_tasks::create_ai_task,
            commands::ai_tasks::get_ai_task,
            commands::ai_tasks::transition_ai_task,
            commands::ai_tasks::start_ai_task_attempt,
            commands::ai_tasks::mark_ai_task_attempt_succeeded,
            commands::ai_tasks::fail_ai_task_attempt,
            commands::ai_tasks::cancel_ai_task,
            commands::ai_tasks::record_ai_task_late_response,
            commands::artifacts::create_result_artifact,
            commands::artifacts::record_chapter_constraint_validation,
            commands::artifacts::get_latest_chapter_constraint_validation,
            commands::apply::create_placement_proposal,
            commands::apply::get_placement_proposal,
            commands::apply::validate_placement_proposal,
            commands::apply::rebuild_placement_proposal,
            commands::apply::create_apply_plan,
            commands::apply::get_apply_plan,
            commands::apply::execute_apply_plan,
            commands::apply::get_artifact_target_links,
            commands::recovery::get_workspace_recovery_snapshot,
            commands::recovery::upsert_workspace_recovery_snapshot,
            commands::recovery::delete_workspace_recovery_snapshot,
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
            commands::create_ai_task_record,
            commands::mark_ai_task_succeeded,
            commands::mark_ai_task_failed,
            commands::get_ai_task_records,
            commands::count_ai_task_records,
            commands::delete_ai_task_record,
            commands::delete_ai_task_records_by_ids,
            commands::clear_ai_task_records,
            commands::get_ai_task_records_debug_state,
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
            commands::create_quality_check_report,
            commands::update_quality_issue_status,
            commands::batch_update_quality_issue_status,
            commands::save_quality_check_result,
            commands::save_chapter_summary,
            commands::get_chapter_summary,
            commands::mark_chapter_summaries_expired,
            commands::update_chapter_summary_enabled,
            commands::save_context_records,
            commands::get_context_records,
            commands::update_context_record_active,
            commands::delete_context_record,
            commands::save_quality_fix_run,
            commands::get_quality_fix_runs,
            commands::update_quality_fix_run_status,
            commands::save_context_read_log,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db32_database_startup_errors_are_classified() {
        let checksum = AppError::new(codes::DATABASE_TRANSACTION_FAILED, "migration", false)
            .with_details(serde_json::json!({
                "startupStage": "create_schema",
                "migrationId": "007_ai_input_snapshots",
                "expectedChecksum": "expected",
                "actualChecksum": "actual",
            }));
        assert_eq!(
            classify_database_startup_error(&checksum),
            DatabaseStartupErrorKind::Checksum
        );

        let compatibility = AppError::new(codes::DATABASE_TRANSACTION_FAILED, "migration", false)
            .with_details(serde_json::json!({
                "startupStage": "create_schema",
                "stage": "legacy_snapshot_compatibility",
                "reason": "audited structure mismatch",
            }));
        assert_eq!(
            classify_database_startup_error(&compatibility),
            DatabaseStartupErrorKind::Compatibility
        );

        let corruption = AppError::new(codes::DATABASE_TRANSACTION_FAILED, "database", false)
            .with_details(serde_json::json!({
                "startupStage": "open_database",
                "sqliteErrorCode": "DatabaseCorrupt",
                "sqliteError": "database disk image is malformed",
            }));
        assert_eq!(
            classify_database_startup_error(&corruption),
            DatabaseStartupErrorKind::Corruption
        );

        let migration = AppError::new(codes::DATABASE_TRANSACTION_FAILED, "migration", false)
            .with_details(serde_json::json!({ "startupStage": "create_schema" }));
        assert_eq!(
            classify_database_startup_error(&migration),
            DatabaseStartupErrorKind::Migration
        );

        let busy = AppError::new(codes::DATABASE_BUSY, "database", true)
            .with_details(serde_json::json!({ "startupStage": "open_database" }));
        assert_eq!(
            classify_database_startup_error(&busy),
            DatabaseStartupErrorKind::Busy
        );

        let initialization = AppError::new(codes::DATABASE_TRANSACTION_FAILED, "database", false)
            .with_details(serde_json::json!({ "startupStage": "configure_database" }));
        assert_eq!(
            classify_database_startup_error(&initialization),
            DatabaseStartupErrorKind::Initialization
        );
    }

    #[test]
    fn db33_database_startup_notice_redacts_internal_details() {
        let work_content = "NOVEL_BODY_MUST_NOT_APPEAR";
        let raw_sql = "SELECT secret_body FROM chapter_drafts";
        let error = AppError::new(codes::DATABASE_TRANSACTION_FAILED, work_content, false)
            .with_details(serde_json::json!({
                "startupStage": "create_schema",
                "databasePath": "C:\\Users\\developer\\ai-novel-studio.db",
                "migrationId": "007_ai_input_snapshots",
                "expectedChecksum": "expected-checksum",
                "actualChecksum": "actual-checksum",
                "payload": work_content,
                "sql": raw_sql,
            }));

        let notice = database_startup_notice(&error);
        let release_text = format!("{} {}", notice.title, notice.message);
        assert!(!release_text.contains(work_content));
        assert!(!release_text.contains(raw_sql));
        assert!(!release_text.contains("expected-checksum"));
        assert!(!release_text.contains("actual-checksum"));
        assert!(!release_text.contains("developer"));
        assert!(release_text.contains("DB-CHECKSUM"));

        let diagnostic = serde_json::to_string(&database_startup_diagnostic(&error))
            .expect("safe diagnostic should serialize");
        assert!(!diagnostic.contains(work_content));
        assert!(!diagnostic.contains(raw_sql));
        assert!(diagnostic.contains("expected-checksum"));
        assert!(diagnostic.contains("actual-checksum"));
    }
}
