#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod ai;
mod commands;
mod crash_reports;
mod db;
mod domain;
mod errors;
mod large_text_save;
mod migrations;
mod outline_commands;
mod project_backup;
mod repositories;
mod runtime;
mod services;
mod system_accent;
mod window_state;

use tauri::Manager;

use crate::errors::{log_workspace_event, WorkspaceLogEvent};

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

#[derive(Debug, PartialEq, Eq)]
enum InstanceStartup {
    Primary,
    Secondary,
}

/// Keeps the single-instance decision ahead of primary database initialization.
///
/// The callbacks make the ordering contract testable without starting a second
/// Tauri window or opening the production database.
fn run_instance_guarded_startup<Acquire, Focus, Initialize>(
    app_data_dir: &std::path::PathBuf,
    acquire_instance_lock: Acquire,
    write_focus_request: Focus,
    initialize_primary_instance: Initialize,
) -> InstanceStartup
where
    Acquire: FnOnce(&std::path::PathBuf) -> bool,
    Focus: FnOnce(&std::path::PathBuf),
    Initialize: FnOnce(),
{
    if !acquire_instance_lock(app_data_dir) {
        write_focus_request(app_data_dir);
        return InstanceStartup::Secondary;
    }

    initialize_primary_instance();
    InstanceStartup::Primary
}

#[cfg(test)]
mod startup_tests {
    use super::{run_instance_guarded_startup, InstanceStartup};
    use std::cell::RefCell;
    use std::path::PathBuf;

    #[test]
    fn secondary_instance_requests_focus_without_initializing_database() {
        let events = RefCell::new(Vec::new());
        let app_data_dir = PathBuf::from("test-app-data");

        let result = run_instance_guarded_startup(
            &app_data_dir,
            |_| {
                events.borrow_mut().push("instance-check");
                false
            },
            |_| events.borrow_mut().push("focus-request"),
            || events.borrow_mut().push("database-initialization"),
        );

        assert_eq!(result, InstanceStartup::Secondary);
        assert_eq!(events.into_inner(), ["instance-check", "focus-request"]);
    }

    #[test]
    fn primary_instance_initializes_database_after_acquiring_lock() {
        let events = RefCell::new(Vec::new());
        let app_data_dir = PathBuf::from("test-app-data");

        let result = run_instance_guarded_startup(
            &app_data_dir,
            |_| {
                events.borrow_mut().push("instance-check");
                true
            },
            |_| events.borrow_mut().push("focus-request"),
            || events.borrow_mut().push("database-initialization"),
        );

        assert_eq!(result, InstanceStartup::Primary);
        assert_eq!(
            events.into_inner(),
            ["instance-check", "database-initialization"]
        );
    }
}

fn main() {
    let startup_at = std::time::Instant::now();
    log_workspace_event(WorkspaceLogEvent {
        level: "info",
        event: "application_starting",
        trace_id: None,
        operation_id: None,
        novel_id: None,
        chapter_id: None,
        draft_id: None,
        error_code: None,
        metadata: None,
    });
    #[cfg(feature = "e2e")]
    runtime::require_e2e_runtime_flag_for_feature().unwrap_or_else(|_error| {
        log_workspace_event(WorkspaceLogEvent {
            level: "error",
            event: "e2e_startup_rejected",
            trace_id: None,
            operation_id: None,
            novel_id: None,
            chapter_id: None,
            draft_id: None,
            error_code: Some("E2E_RUNTIME_REJECTED"),
            metadata: Some(serde_json::json!({ "stage": "feature_flag" })),
        });
        std::process::exit(2);
    });
    let e2e_data_dir = runtime::initialize_e2e_environment().unwrap_or_else(|_error| {
        log_workspace_event(WorkspaceLogEvent {
            level: "error",
            event: "e2e_startup_rejected",
            trace_id: None,
            operation_id: None,
            novel_id: None,
            chapter_id: None,
            draft_id: None,
            error_code: Some("E2E_RUNTIME_REJECTED"),
            metadata: Some(serde_json::json!({ "stage": "environment" })),
        });
        std::process::exit(2);
    });
    let app_data_dir = e2e_data_dir.clone().unwrap_or_else(get_app_data_dir);
    crash_reports::install_native_crash_report_hook(&app_data_dir);
    let instance_startup = run_instance_guarded_startup(
        &app_data_dir,
        window_state::try_acquire_instance_lock,
        window_state::write_focus_request,
        || {
            db::init_database();
            runtime::append_e2e_log("startup: database initialized");
            log_workspace_event(WorkspaceLogEvent {
                level: "info",
                event: "startup_database_ready",
                trace_id: None,
                operation_id: None,
                novel_id: None,
                chapter_id: None,
                draft_id: None,
                error_code: None,
                metadata: Some(serde_json::json!({
                    "elapsedMs": startup_at.elapsed().as_millis(),
                })),
            });
        },
    );
    if instance_startup == InstanceStartup::Secondary {
        std::process::exit(0);
    }

    // 提前加载窗口状态
    let saved_state = window_state::load_window_state(&app_data_dir);
    let state_for_close = app_data_dir.clone();
    let focus_watch_dir = app_data_dir.clone();

    tauri::Builder::default()
        .invoke_handler(generate_app_handler![
            commands::get_all_novels,
            commands::app_update::get_app_update_capabilities,
            commands::app_update::check_app_update,
            commands::app_update::install_app_update,
            crash_reports::get_native_crash_reports,
            crash_reports::clear_native_crash_reports,
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
            commands::count_drafts_by_chapter_id,
            commands::get_latest_draft_by_chapter_id,
            commands::get_adopted_draft_by_chapter_id,
            commands::get_draft_by_chapter_and_id,
            commands::ai_tasks::create_ai_task,
            commands::ai_tasks::get_ai_task,
            commands::ai_tasks::list_ai_tasks,
            commands::ai_tasks::queue_ai_task_attempt,
            commands::ai_tasks::claim_ai_task_attempt,
            commands::ai_tasks::mark_ai_task_provider_succeeded,
            commands::ai_tasks::fail_ai_task_attempt,
            commands::ai_tasks::cancel_ai_task,
            commands::ai_request_policy::configure_ai_request_policy,
            commands::ai_request_policy::reserve_ai_request,
            commands::ai_request_policy::settle_ai_request,
            commands::ai_request_policy::get_ai_request_policy_snapshot,
            commands::agent_plans::create_agent_plan,
            commands::agent_plans::get_agent_plan,
            commands::agent_plans::list_agent_plans_by_chapter,
            commands::agent_plans::acquire_agent_plan_lease,
            commands::agent_plans::claim_agent_plan_step,
            commands::agent_plans::complete_agent_plan_step,
            commands::agent_plans::fail_agent_plan_step,
            commands::agent_plans::authorize_agent_plan_retry,
            commands::agent_plans::release_agent_plan_lease,
            commands::agent_plans::cancel_agent_plan,
            commands::agent_plans::recover_interrupted_agent_plans,
            commands::artifacts::create_result_artifact,
            commands::artifacts::get_result_artifact,
            commands::artifacts::list_result_artifacts_for_task,
            commands::placements::prepare_placement_proposal,
            commands::placements::get_placement_proposal,
            commands::placements::apply_placement_plan,
            commands::drafts::save_chapter_draft_atomic,
            commands::drafts::read_chapter_draft_content,
            commands::multi_agent::create_multi_agent_session,
            commands::multi_agent::append_multi_agent_round,
            commands::multi_agent::complete_multi_agent_session,
            commands::multi_agent::get_multi_agent_session,
            commands::multi_agent::list_multi_agent_sessions_by_chapter,
            commands::autonomous_story::save_autonomous_story_plan,
            commands::autonomous_story::get_autonomous_story_plan,
            commands::autonomous_story::get_autonomous_story_plan_by_operation,
            commands::autonomous_story::list_autonomous_story_plans_by_novel,
            commands::autonomous_story::get_autonomous_planning_baseline,
            commands::autonomous_story::apply_autonomous_story_plan,
            commands::autonomous_scheduler::create_autonomous_book_run,
            commands::autonomous_scheduler::get_autonomous_book_run,
            commands::autonomous_scheduler::list_autonomous_book_runs,
            commands::autonomous_scheduler::acquire_autonomous_run_lease,
            commands::autonomous_scheduler::heartbeat_autonomous_run,
            commands::autonomous_scheduler::claim_autonomous_run_chapter,
            commands::autonomous_scheduler::authorize_full_auto_run_attempt,
            commands::autonomous_scheduler::finish_autonomous_run_chapter,
            commands::autonomous_scheduler::promote_autonomous_run_attempt,
            commands::autonomous_scheduler::list_autonomous_run_attempts,
            commands::autonomous_scheduler::pause_autonomous_book_run,
            commands::autonomous_scheduler::resume_autonomous_book_run,
            commands::autonomous_scheduler::stop_autonomous_book_run,
            commands::autonomous_scheduler::recover_interrupted_autonomous_runs,
            commands::content_transactions::prepare_content_transaction,
            commands::content_transactions::get_content_transaction,
            commands::content_transactions::list_content_transactions,
            commands::content_transactions::apply_content_transaction,
            commands::content_transactions::get_faction_asset,
            commands::content_transactions::list_faction_assets,
            commands::content_transactions::get_location_asset,
            commands::content_transactions::list_location_assets,
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
            commands::recover_interrupted_generation_jobs,
            commands::create_ai_task_record,
            commands::mark_ai_task_running_for_retry,
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
            ai::ai_chat_completion_stream,
            ai::check_local_chapter_model,
            ai::check_local_chapter_model_availability,
            ai::cancel_ai_request,
            runtime::get_e2e_diagnostics,
            runtime::get_e2e_novel_commit_state,
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
            commands::reference_library::inspect_reference_duplicates,
            commands::reference_library::commit_reference_import,
            commands::reference_library::list_reference_works,
            commands::reference_library::get_reference_work_bundle,
            commands::reference_library::get_reference_work_bundle_legacy,
            commands::reference_library::list_reference_sections,
            commands::reference_library::get_reference_section_content,
            commands::reference_library::activate_reference_import,
            commands::reference_library::delete_reference_work,
            commands::memory::put_memory_document,
            commands::memory::put_memory_embeddings,
            commands::memory::retrieve_memory,
            commands::memory::list_memory_documents,
            commands::memory::invalidate_memory_document,
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
            services::dsh::commands::dsh_prepare_chapter,
        ])
        .setup(move |app| {
            log_workspace_event(WorkspaceLogEvent {
                level: "info",
                event: "tauri_setup_ready",
                trace_id: None,
                operation_id: None,
                novel_id: None,
                chapter_id: None,
                draft_id: None,
                error_code: None,
                metadata: Some(serde_json::json!({
                    "elapsedMs": startup_at.elapsed().as_millis(),
                })),
            });
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
