#![allow(unused_imports, dead_code)]

use crate::db::{get_connection, get_database_path};

use crate::domain::ai::{
    AiTaskRecordDto, AiTaskRecordsDebugState, ChapterEngineeringStateDto,
    ChapterGenerationSnapshotDto, CreateAiTaskRecordInput, CreateGenerationJobInput,
    CreateQualityReportInput, DeleteAiTaskRecordsInput, DeleteAiTaskRecordsResult,
    GenerationJobDto, GenerationStepResultDto, GetQualityCheckIssuesResult,
    MarkAiTaskSucceededInput, MigrateLegacyChapterContextInput, MigrateLegacyChapterContextResult,
    QualityCheckItemDto, QualityCheckReportDto, QualityFixRunDto, SaveChapterEngineeringDraftInput,
    SaveChapterGenerationSnapshotInput, SaveContextReadLogInput, SaveGenerationStepResultInput,
    SaveQualityCheckResultInput, SaveQualityFixRunInput, SaveStyleProfileInput,
    SetActiveStyleProfileInput, StartupTaskRecoveryDto, StyleProfileDto, UpdateGenerationJobInput,
};
use crate::services::{
    ai_task_record_service, chapter_engineering_service, generation_job_service,
    legacy_migration_service, quality_check_service, style_profile_service,
};
use rusqlite::Connection;

// ==================== Re-exports for Backward Compatibility & Shared Repositories ====================

#[allow(unused_imports, dead_code)]
pub use crate::repositories::ai_task_record_repository::{
    ai_task_records_table_exists, ai_task_select_sql,
    count_ai_task_records as count_ai_task_records_filtered_in_conn, count_ai_task_records_by_ids,
    count_total_ai_task_records as count_ai_task_records_in_conn, find_ai_task_record_by_id,
    find_ai_task_records_by_chapter, find_ai_task_records_by_novel, map_ai_task_row,
    sample_ai_task_ids,
};
pub use crate::repositories::chapter_engineering_repository::{
    map_chapter_engineering_state_row, map_chapter_generation_snapshot_row,
    CHAPTER_ENGINEERING_SELECT, CHAPTER_GENERATION_SNAPSHOT_SELECT,
};
pub use crate::repositories::generation_job_repository::{
    map_generation_job_row, map_generation_step_result_row, GENERATION_JOB_SELECT,
    GENERATION_STEP_RESULT_SELECT,
};
pub use crate::repositories::quality_check_repository::{
    load_quality_items, map_fix_run_row, map_quality_item_row, map_quality_report_row,
    QUALITY_FIX_RUN_SELECT, QUALITY_ITEM_SELECT, QUALITY_REPORT_SELECT,
    QUALITY_WORKFLOW_ITEM_SELECT,
};
pub use crate::repositories::style_profile_repository::{
    map_style_profile_row, style_select_sql, STYLE_PROFILE_SELECT,
};
pub use crate::services::ai_task_record_service::{
    clear_ai_task_records as clear_ai_task_records_internal,
    create_ai_task_record as create_ai_task_record_internal,
    delete_ai_task_records_by_ids as delete_ai_task_records_by_ids_internal,
    ensure_ai_task_records_table, ensure_ai_tasks_are_not_bound_to_completed_quality_reports,
    ensure_ai_tasks_are_terminal, mark_ai_task_cancelled as mark_ai_task_cancelled_internal,
    mark_ai_task_running_for_retry as mark_ai_task_running_for_retry_internal,
    mark_ai_task_succeeded as mark_ai_task_succeeded_internal, normalize_ai_task_filter,
    normalize_ai_task_ids, normalize_ai_task_status_filter, normalize_ai_task_type_filter,
    validate_ai_task_pricing, validate_ai_task_projection_identity,
    validate_mark_ai_task_succeeded_input,
};
pub use crate::services::generation_job_service::{
    cancel_generation_job as cancel_generation_job_internal, generation_job_status_is_terminal,
    generation_job_transition_is_allowed,
    get_generation_step_results as get_generation_step_results_internal,
    normalized_recovery_step_name,
    recover_interrupted_generation_jobs as recover_interrupted_generation_jobs_internal,
    save_generation_step_result as save_generation_step_result_internal,
    update_generation_job as update_generation_job_internal, STARTUP_RECOVERY_ERROR_CODE,
    STARTUP_RECOVERY_MESSAGE,
};
pub use crate::services::legacy_migration_service::migrate_legacy_chapter_context as migrate_legacy_chapter_context_internal;
pub use crate::services::quality_check_service::{
    batch_update_quality_issue_status as batch_update_quality_issue_status_internal,
    compute_statistics, get_mutable_quality_issue_identity,
    get_quality_check_issues as get_quality_check_issues_internal,
    get_quality_check_report_snapshot as get_quality_check_report_snapshot_internal,
    has_newer_completed_quality_report, has_other_quality_fix_round,
    list_quality_check_reports as list_quality_check_reports_internal,
    save_quality_check_result as save_quality_check_result_internal,
    update_quality_issue_status as update_quality_issue_status_internal,
    upsert_quality_issue_state, validate_quality_issue_status,
};
pub use crate::services::style_profile_service::get_active_style_profile as get_style_profile_by_id_internal;

// ==================== Chapter Engineering State & Snapshots ====================

#[tauri::command]
pub fn save_chapter_engineering_draft(
    input: SaveChapterEngineeringDraftInput,
) -> Result<ChapterEngineeringStateDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_engineering_service::save_chapter_engineering_draft(&conn, input)
}

#[tauri::command]
pub fn get_chapter_engineering_state(
    chapter_id: String,
) -> Result<Option<ChapterEngineeringStateDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_engineering_service::get_chapter_engineering_state(&conn, &chapter_id)
}

#[tauri::command]
pub fn get_chapter_engineering_states(
    chapter_id: String,
) -> Result<Vec<ChapterEngineeringStateDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_engineering_service::get_chapter_engineering_states(&conn, &chapter_id)
}

#[tauri::command]
pub fn get_active_chapter_engineering_state(
    chapter_id: String,
) -> Result<Option<ChapterEngineeringStateDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_engineering_service::get_active_chapter_engineering_state(&conn, &chapter_id)
}

#[tauri::command]
pub fn activate_chapter_engineering_state(
    id: String,
    chapter_id: String,
) -> Result<ChapterEngineeringStateDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_engineering_service::activate_chapter_engineering_state(&conn, &id, &chapter_id)
}

#[tauri::command]
pub fn save_chapter_generation_snapshot(
    input: SaveChapterGenerationSnapshotInput,
) -> Result<ChapterGenerationSnapshotDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_engineering_service::save_chapter_generation_snapshot(&conn, input)
}

#[tauri::command]
pub fn get_chapter_generation_snapshots(
    chapter_id: String,
) -> Result<Vec<ChapterGenerationSnapshotDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_engineering_service::get_chapter_generation_snapshots(&conn, &chapter_id)
}

#[tauri::command]
pub fn get_latest_chapter_generation_snapshot(
    chapter_id: String,
) -> Result<Option<ChapterGenerationSnapshotDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    chapter_engineering_service::get_latest_chapter_generation_snapshot(&conn, &chapter_id)
}

// ==================== Generation Jobs & Steps ====================

#[tauri::command]
pub fn create_generation_job(input: CreateGenerationJobInput) -> Result<GenerationJobDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    generation_job_service::create_generation_job(&conn, input)
}

#[tauri::command]
pub fn update_generation_job(input: UpdateGenerationJobInput) -> Result<GenerationJobDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    generation_job_service::update_generation_job(&conn, &input)
}

#[tauri::command]
pub fn get_generation_job(id: String) -> Result<Option<GenerationJobDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    generation_job_service::get_generation_job(&conn, &id)
}

#[tauri::command]
pub fn get_generation_jobs_by_chapter_id(
    chapter_id: String,
) -> Result<Vec<GenerationJobDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    generation_job_service::get_generation_jobs_by_chapter_id(&conn, &chapter_id)
}

#[tauri::command]
pub fn cancel_generation_job(
    id: String,
    finished_at: String,
) -> Result<Option<GenerationJobDto>, String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    generation_job_service::cancel_generation_job(&mut conn, &id, &finished_at)
}

#[tauri::command]
pub fn save_generation_step_result(
    input: SaveGenerationStepResultInput,
) -> Result<GenerationStepResultDto, String> {
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    generation_job_service::save_generation_step_result(&mut conn, &input)
}

#[tauri::command]
pub fn get_generation_step_results(job_id: String) -> Result<Vec<GenerationStepResultDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    generation_job_service::get_generation_step_results(&conn, &job_id)
}

#[tauri::command]
pub fn recover_interrupted_generation_jobs() -> Result<StartupTaskRecoveryDto, String> {
    let recovered_at = chrono::Utc::now().to_rfc3339();
    let mut conn = get_connection().lock().map_err(|e| e.to_string())?;
    generation_job_service::recover_interrupted_generation_jobs(&mut conn, &recovered_at)
}

// ==================== AI Task Records ====================

#[tauri::command]
pub fn create_ai_task_record(input: CreateAiTaskRecordInput) -> Result<AiTaskRecordDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    ai_task_record_service::create_ai_task_record(&conn, &input)
}

#[tauri::command]
pub fn mark_ai_task_running_for_retry(id: String, started_at: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    ai_task_record_service::mark_ai_task_running_for_retry(&conn, &id, &started_at)?;
    Ok(())
}

#[tauri::command]
pub fn mark_ai_task_succeeded(id: String, input: MarkAiTaskSucceededInput) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    ai_task_record_service::mark_ai_task_succeeded(&conn, &id, &input)?;
    Ok(())
}

#[tauri::command]
pub fn mark_ai_task_failed(
    id: String,
    error_message: String,
    finished_at: String,
    duration_ms: Option<i64>,
) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    ai_task_record_service::mark_ai_task_failed(
        &conn,
        &id,
        &error_message,
        &finished_at,
        duration_ms,
    )?;
    Ok(())
}

#[tauri::command]
pub fn mark_ai_task_cancelled(
    id: String,
    finished_at: String,
    duration_ms: Option<i64>,
) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    ai_task_record_service::mark_ai_task_cancelled(&conn, &id, &finished_at, duration_ms)?;
    Ok(())
}

#[tauri::command]
pub fn get_ai_task_records(
    page: Option<i64>,
    size: Option<i64>,
    task_type: Option<String>,
    status: Option<String>,
) -> Result<Vec<AiTaskRecordDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    ai_task_record_service::get_ai_task_records(&conn, page, size, task_type, status)
}

#[tauri::command]
pub fn count_ai_task_records(
    task_type: Option<String>,
    status: Option<String>,
) -> Result<i64, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    ai_task_record_service::count_ai_task_records(&conn, task_type, status)
}

#[tauri::command]
pub fn delete_ai_task_record(id: String) -> Result<DeleteAiTaskRecordsResult, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let db_path = get_database_path().display().to_string();
    ai_task_record_service::delete_ai_task_records_by_ids(&conn, vec![id], db_path)
}

#[tauri::command]
pub fn delete_ai_task_records_by_ids(
    input: DeleteAiTaskRecordsInput,
) -> Result<DeleteAiTaskRecordsResult, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let db_path = get_database_path().display().to_string();
    ai_task_record_service::delete_ai_task_records_by_ids(&conn, input.ids, db_path)
}

#[tauri::command]
pub fn clear_ai_task_records() -> Result<DeleteAiTaskRecordsResult, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    let db_path = get_database_path().display().to_string();
    ai_task_record_service::clear_ai_task_records(&conn, db_path)
}

#[tauri::command]
pub fn get_ai_task_records_debug_state(
    ids: Option<Vec<String>>,
) -> Result<AiTaskRecordsDebugState, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    ai_task_record_service::get_ai_task_records_debug_state(&conn, ids)
}

#[tauri::command]
pub fn get_ai_task_records_by_chapter_id(
    chapter_id: String,
) -> Result<Vec<AiTaskRecordDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    ai_task_record_service::get_ai_task_records_by_chapter_id(&conn, &chapter_id)
}

#[tauri::command]
pub fn get_ai_task_records_by_novel_id(novel_id: String) -> Result<Vec<AiTaskRecordDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    ai_task_record_service::get_ai_task_records_by_novel_id(&conn, &novel_id)
}

// ==================== Style Profiles ====================

#[tauri::command]
pub fn list_style_profiles(project_id: Option<String>) -> Result<Vec<StyleProfileDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    style_profile_service::list_style_profiles(&conn, project_id.as_deref())
}

#[tauri::command]
pub fn get_active_style_profile(project_id: String) -> Result<Option<StyleProfileDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    style_profile_service::get_active_style_profile(&conn, &project_id)
}

#[tauri::command]
pub fn save_style_profile(
    id: Option<String>,
    input: SaveStyleProfileInput,
) -> Result<StyleProfileDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    style_profile_service::save_style_profile(&conn, id, input)
}

#[tauri::command]
pub fn set_active_style_profile(input: SetActiveStyleProfileInput) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    style_profile_service::set_active_style_profile(&conn, input)
}

#[tauri::command]
pub fn delete_style_profile(project_id: String, style_profile_id: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    style_profile_service::delete_style_profile(&conn, &project_id, &style_profile_id)
}

// ==================== Quality Check ====================

#[tauri::command]
pub fn create_quality_check_report(
    input: CreateQualityReportInput,
) -> Result<QualityCheckReportDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    quality_check_service::create_quality_check_report(&conn, input)
}

#[tauri::command]
pub fn get_quality_check_issues(chapter_id: String) -> Result<GetQualityCheckIssuesResult, String> {
    let conn = get_connection().lock().map_err(|error| error.to_string())?;
    quality_check_service::get_quality_check_issues(&conn, &chapter_id)
}

#[tauri::command]
pub fn list_quality_check_reports(
    chapter_id: String,
) -> Result<Vec<QualityCheckReportDto>, String> {
    let conn = get_connection().lock().map_err(|error| error.to_string())?;
    quality_check_service::list_quality_check_reports(&conn, &chapter_id)
}

#[tauri::command]
pub fn get_quality_check_report_snapshot(
    report_id: String,
) -> Result<GetQualityCheckIssuesResult, String> {
    let conn = get_connection().lock().map_err(|error| error.to_string())?;
    quality_check_service::get_quality_check_report_snapshot(&conn, &report_id)
}

#[tauri::command]
pub fn update_quality_issue_status(
    issue_id: String,
    status: String,
    resolution_note: Option<String>,
) -> Result<QualityCheckItemDto, String> {
    let mut conn = get_connection().lock().map_err(|error| error.to_string())?;
    quality_check_service::update_quality_issue_status(
        &mut conn,
        &issue_id,
        &status,
        resolution_note.as_deref(),
    )
}

#[tauri::command]
pub fn batch_update_quality_issue_status(
    issue_ids: Vec<String>,
    status: String,
) -> Result<Vec<QualityCheckItemDto>, String> {
    let mut conn = get_connection().lock().map_err(|error| error.to_string())?;
    quality_check_service::batch_update_quality_issue_status(&mut conn, &issue_ids, &status)
}

#[tauri::command]
pub fn save_quality_check_result(
    input: SaveQualityCheckResultInput,
) -> Result<GetQualityCheckIssuesResult, String> {
    let mut conn = get_connection().lock().map_err(|error| error.to_string())?;
    quality_check_service::save_quality_check_result(&mut conn, &input)
}

// ==================== Quality Fix Runs & Context Read Logs ====================

#[tauri::command]
pub fn save_quality_fix_run(input: SaveQualityFixRunInput) -> Result<QualityFixRunDto, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    quality_check_service::save_quality_fix_run(&conn, input)
}

#[tauri::command]
pub fn get_quality_fix_runs(chapter_id: String) -> Result<Vec<QualityFixRunDto>, String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    quality_check_service::get_quality_fix_runs(&conn, &chapter_id)
}

#[tauri::command]
pub fn update_quality_fix_run_status(id: String, status: String) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    quality_check_service::update_quality_fix_run_status(&conn, &id, &status)
}

#[tauri::command]
pub fn save_context_read_log(input: SaveContextReadLogInput) -> Result<(), String> {
    let conn = get_connection().lock().map_err(|e| e.to_string())?;
    quality_check_service::save_context_read_log(&conn, input)
}

// ==================== Legacy Chapter Context Migration ====================

#[tauri::command]
pub fn migrate_legacy_chapter_context(
    input: MigrateLegacyChapterContextInput,
) -> Result<MigrateLegacyChapterContextResult, String> {
    let mut conn = get_connection().lock().map_err(|error| error.to_string())?;
    legacy_migration_service::migrate_legacy_chapter_context(&mut conn, &input)
}

// ==================== Backward-Compatible Internal Helpers ====================

pub fn get_chapter_engineering_state_by_id_internal(
    conn: &Connection,
    id: &str,
) -> Result<ChapterEngineeringStateDto, String> {
    chapter_engineering_service::activate_chapter_engineering_state(conn, id, "").or_else(|_| {
        crate::repositories::chapter_engineering_repository::find_engineering_state_by_id(conn, id)
    })
}

pub fn get_chapter_generation_snapshot_by_id_internal(
    conn: &Connection,
    id: &str,
) -> Result<ChapterGenerationSnapshotDto, String> {
    crate::repositories::chapter_engineering_repository::find_chapter_generation_snapshot_by_id(
        conn, id,
    )
}

pub fn get_generation_job_by_id_internal(
    conn: &Connection,
    id: &str,
) -> Result<GenerationJobDto, String> {
    crate::repositories::generation_job_repository::find_generation_job_by_id(conn, id)
}

pub fn get_ai_task_record_by_id_internal(
    conn: &Connection,
    id: &str,
) -> Result<AiTaskRecordDto, String> {
    crate::repositories::ai_task_record_repository::find_ai_task_record_by_id(conn, id)
}
