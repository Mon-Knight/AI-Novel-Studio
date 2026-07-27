use crate::errors::AppError;
use crate::repositories::autonomous_repository::{
    self as autonomous_repository, AutonomousActionRecord, AutonomousJobRecord, QualityThresholdsRecord,
};
use rusqlite::Connection;
use serde::Deserialize;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateJobInput {
    pub novel_id: String,
    pub operation_id: String,
    pub total_chapters: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateJobStatusInput {
    pub job_id: String,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateJobProgressInput {
    pub job_id: String,
    pub completed_chapters: i64,
    pub current_chapter_id: Option<String>,
    pub current_chapter_attempt: Option<i64>,
    pub tokens_input: Option<i64>,
    pub tokens_output: Option<i64>,
    pub estimated_cost_usd: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseJobInput {
    pub job_id: String,
    pub reason: String,
    pub chapter_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveQualityThresholdsInput {
    pub novel_id: String,
    pub min_total_score: i64,
    pub min_logic_score: i64,
    pub min_setting_score: i64,
    pub min_character_score: i64,
    pub min_continuity_score: i64,
    pub min_language_score: i64,
    pub min_pacing_score: i64,
    pub max_retry_attempts: i64,
    pub max_critical_issues: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogActionInput {
    pub job_id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub action_type: String,
    pub decision_reason: String,
    pub success: bool,
    pub quality_score: Option<i64>,
    pub quality_report_id: Option<String>,
    pub error_message: Option<String>,
    pub tokens_used: Option<i64>,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateContinuityCheckInput {
    pub id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub check_type: String,
    pub score: i64,
    pub status: String,
    pub issues_json: Option<String>,
    pub previous_chapter_ids: Option<String>,
    pub operation_id: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateExpertCollaborationLogInput {
    pub id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub draft_id: String,
    pub round_number: i64,
    pub expert_type: String,
    pub score: i64,
    pub issues_json: Option<String>,
    pub suggestions_json: Option<String>,
    pub operation_id: Option<String>,
    pub created_at: Option<String>,
}

pub fn create_job(
    connection: &mut Connection,
    input: CreateJobInput,
) -> Result<AutonomousJobRecord, AppError> {
    let job_id = Uuid::new_v4().to_string();

    autonomous_repository::create_job(
        connection,
        &job_id,
        &input.novel_id,
        &input.operation_id,
        input.total_chapters,
    )
}

pub fn get_job(
    connection: &Connection,
    job_id: &str,
) -> Result<Option<AutonomousJobRecord>, AppError> {
    autonomous_repository::get_job(connection, job_id)
}

pub fn list_jobs_by_novel(
    connection: &Connection,
    novel_id: &str,
) -> Result<Vec<AutonomousJobRecord>, AppError> {
    autonomous_repository::list_jobs_by_novel(connection, novel_id)
}

pub fn update_job_status(
    connection: &mut Connection,
    input: UpdateJobStatusInput,
) -> Result<AutonomousJobRecord, AppError> {
    if input.status == "completed" {
        let current = autonomous_repository::get_job(connection, &input.job_id)?
            .ok_or_else(|| AppError::new(
                crate::errors::codes::AUTONOMOUS_JOB_NOT_FOUND,
                "自主生成任务不存在",
                false,
            ))?;
        if current.completed_chapters != current.total_chapters {
            return Err(AppError::new(
                crate::errors::codes::AUTONOMOUS_JOB_PROGRESS_CONFLICT,
                "任务尚有未完成章节，不能标记为完成",
                false,
            ));
        }
    }
    autonomous_repository::update_job_status(connection, &input.job_id, &input.status)
}

pub fn update_job_progress(
    connection: &mut Connection,
    input: UpdateJobProgressInput,
) -> Result<AutonomousJobRecord, AppError> {
    autonomous_repository::update_job_progress(
        connection,
        &input.job_id,
        input.completed_chapters,
        input.current_chapter_id.as_deref(),
        input.current_chapter_attempt,
        input.tokens_input,
        input.tokens_output,
        input.estimated_cost_usd,
    )
}

pub fn pause_job(
    connection: &mut Connection,
    input: PauseJobInput,
) -> Result<AutonomousJobRecord, AppError> {
    autonomous_repository::pause_job(
        connection,
        &input.job_id,
        &input.reason,
        input.chapter_id.as_deref(),
    )
}

pub fn resume_job(
    connection: &mut Connection,
    job_id: &str,
) -> Result<AutonomousJobRecord, AppError> {
    autonomous_repository::update_job_status(connection, job_id, "running")
}

pub fn cancel_job(
    connection: &mut Connection,
    job_id: &str,
) -> Result<AutonomousJobRecord, AppError> {
    autonomous_repository::update_job_status(connection, job_id, "cancelled")
}

pub fn get_quality_thresholds(
    connection: &Connection,
    novel_id: &str,
) -> Result<Option<QualityThresholdsRecord>, AppError> {
    autonomous_repository::get_quality_thresholds(connection, novel_id)
}

pub fn save_quality_thresholds(
    connection: &mut Connection,
    input: SaveQualityThresholdsInput,
) -> Result<QualityThresholdsRecord, AppError> {
    let record = QualityThresholdsRecord {
        novel_id: input.novel_id,
        min_total_score: input.min_total_score,
        min_logic_score: input.min_logic_score,
        min_setting_score: input.min_setting_score,
        min_character_score: input.min_character_score,
        min_continuity_score: input.min_continuity_score,
        min_language_score: input.min_language_score,
        min_pacing_score: input.min_pacing_score,
        max_retry_attempts: input.max_retry_attempts,
        max_critical_issues: input.max_critical_issues,
        created_at: String::new(), // Will be set by repository
        updated_at: String::new(),
    };

    autonomous_repository::upsert_quality_thresholds(connection, &record)
}

pub fn log_action(
    connection: &mut Connection,
    input: LogActionInput,
) -> Result<AutonomousActionRecord, AppError> {
    let record = AutonomousActionRecord {
        id: Uuid::new_v4().to_string(),
        job_id: input.job_id,
        novel_id: input.novel_id,
        chapter_id: input.chapter_id,
        action_type: input.action_type,
        quality_score: input.quality_score,
        quality_report_id: input.quality_report_id,
        decision_reason: input.decision_reason,
        success: input.success,
        error_message: input.error_message,
        tokens_used: input.tokens_used,
        duration_ms: input.duration_ms,
        created_at: String::new(), // Will be set by repository
    };

    autonomous_repository::log_action(connection, &record)
}

pub fn create_continuity_check(
    connection: &mut Connection,
    input: CreateContinuityCheckInput,
) -> Result<String, AppError> {
    autonomous_repository::create_continuity_check(
        connection,
        &input.id,
        &input.novel_id,
        &input.chapter_id,
        &input.check_type,
        input.score,
        &input.status,
        input.issues_json.as_deref(),
        input.previous_chapter_ids.as_deref(),
        input.operation_id.as_deref(),
        input.created_at.as_deref(),
    )
}

pub fn create_expert_collaboration_log(
    connection: &mut Connection,
    input: CreateExpertCollaborationLogInput,
) -> Result<String, AppError> {
    autonomous_repository::create_expert_collaboration_log(
        connection,
        &input.id,
        &input.novel_id,
        &input.chapter_id,
        &input.draft_id,
        input.round_number,
        &input.expert_type,
        input.score,
        input.issues_json.as_deref(),
        input.suggestions_json.as_deref(),
        input.operation_id.as_deref(),
        input.created_at.as_deref(),
    )
}

pub fn list_actions(
    connection: &Connection,
    job_id: &str,
) -> Result<Vec<AutonomousActionRecord>, AppError> {
    autonomous_repository::list_actions(connection, job_id)
}

pub fn acquire_chapter_lock(
    connection: &mut Connection,
    input: crate::commands::autonomous::AcquireChapterLockInput,
) -> Result<bool, AppError> {
    autonomous_repository::acquire_chapter_lock(
        connection,
        &input.chapter_id,
        &input.job_id,
        &input.locked_by,
        input.lock_duration_seconds,
    )
}

pub fn release_chapter_lock(
    connection: &mut Connection,
    chapter_id: &str,
    job_id: &str,
    locked_by: &str,
) -> Result<bool, AppError> {
    autonomous_repository::release_chapter_lock(connection, chapter_id, job_id, locked_by)
}

pub fn cleanup_expired_locks(connection: &mut Connection) -> Result<usize, AppError> {
    autonomous_repository::cleanup_expired_locks(connection)
}

pub fn recover_interrupted_jobs(connection: &mut Connection) -> Result<usize, AppError> {
    autonomous_repository::recover_interrupted_jobs(connection)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::autonomous::AcquireChapterLockInput;
    use crate::errors::codes;
    use rusqlite::{params, Connection};

    fn setup() -> Result<Connection, AppError> {
        let mut connection = Connection::open_in_memory().map_err(AppError::database)?;
        connection
            .execute_batch("PRAGMA foreign_keys=ON;")
            .map_err(AppError::database)?;
        crate::db::create_tables(&mut connection)?;
        connection
            .execute(
                "INSERT INTO novels (id, title, created_at, updated_at)
                 VALUES ('novel-auto', 'Autonomous test', '2026-01-01', '2026-01-01')",
                [],
            )
            .map_err(AppError::database)?;
        connection
            .execute(
                "INSERT INTO chapters (id, novel_id, title, order_index, created_at, updated_at)
                 VALUES ('chapter-auto', 'novel-auto', 'Chapter', 1, '2026-01-01', '2026-01-01')",
                [],
            )
            .map_err(AppError::database)?;
        Ok(connection)
    }

    fn running_job(connection: &mut Connection, operation: &str) -> Result<AutonomousJobRecord, AppError> {
        let created = create_job(
            connection,
            CreateJobInput {
                novel_id: "novel-auto".to_string(),
                operation_id: operation.to_string(),
                total_chapters: 2,
            },
        )?;
        update_job_status(
            connection,
            UpdateJobStatusInput {
                job_id: created.id,
                status: "running".to_string(),
            },
        )
    }

    #[test]
    fn autonomous_progress_is_monotonic_and_rejects_terminal_updates() -> Result<(), AppError> {
        let mut connection = setup()?;
        let job = running_job(&mut connection, "auto-progress")?;
        let progressed = update_job_progress(
            &mut connection,
            UpdateJobProgressInput {
                job_id: job.id.clone(),
                completed_chapters: 1,
                current_chapter_id: Some("chapter-auto".to_string()),
                current_chapter_attempt: Some(1),
                tokens_input: Some(10),
                tokens_output: Some(20),
                estimated_cost_usd: Some(0.01),
            },
        )?;
        assert_eq!(progressed.completed_chapters, 1);
        assert_eq!(progressed.total_tokens_input, 10);

        let regression = update_job_progress(
            &mut connection,
            UpdateJobProgressInput {
                job_id: job.id.clone(),
                completed_chapters: 0,
                current_chapter_id: None,
                current_chapter_attempt: None,
                tokens_input: None,
                tokens_output: None,
                estimated_cost_usd: None,
            },
        )
        .expect_err("progress regression must fail");
        assert_eq!(regression.code, codes::AUTONOMOUS_JOB_PROGRESS_CONFLICT);

        cancel_job(&mut connection, &job.id)?;
        let late = update_job_progress(
            &mut connection,
            UpdateJobProgressInput {
                job_id: job.id,
                completed_chapters: 2,
                current_chapter_id: None,
                current_chapter_attempt: None,
                tokens_input: Some(1),
                tokens_output: Some(1),
                estimated_cost_usd: Some(0.02),
            },
        )
        .expect_err("terminal update must fail");
        assert_eq!(late.code, codes::AUTONOMOUS_JOB_PROGRESS_CONFLICT);
        Ok(())
    }

    #[test]
    fn chapter_lock_release_requires_the_exact_owner() -> Result<(), AppError> {
        let mut connection = setup()?;
        let job = running_job(&mut connection, "auto-lock")?;
        assert!(acquire_chapter_lock(
            &mut connection,
            AcquireChapterLockInput {
                chapter_id: "chapter-auto".to_string(),
                job_id: job.id.clone(),
                locked_by: "worker-a".to_string(),
                lock_duration_seconds: 30,
            },
        )?);
        // Same owner renews the lease.
        assert!(acquire_chapter_lock(
            &mut connection,
            AcquireChapterLockInput {
                chapter_id: "chapter-auto".to_string(),
                job_id: job.id.clone(),
                locked_by: "worker-a".to_string(),
                lock_duration_seconds: 60,
            },
        )?);
        assert!(!release_chapter_lock(
            &mut connection,
            "chapter-auto",
            &job.id,
            "worker-b",
        )?);
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM chapter_generation_locks WHERE chapter_id = ?1",
                params!["chapter-auto"],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        assert_eq!(count, 1);
        assert!(release_chapter_lock(
            &mut connection,
            "chapter-auto",
            &job.id,
            "worker-a",
        )?);
        Ok(())
    }

    #[test]
    fn startup_recovery_pauses_running_jobs_and_clears_locks_idempotently() -> Result<(), AppError> {
        let mut connection = setup()?;
        let job = running_job(&mut connection, "auto-recover")?;
        acquire_chapter_lock(
            &mut connection,
            AcquireChapterLockInput {
                chapter_id: "chapter-auto".to_string(),
                job_id: job.id.clone(),
                locked_by: "worker-a".to_string(),
                lock_duration_seconds: 60,
            },
        )?;
        assert_eq!(recover_interrupted_jobs(&mut connection)?, 1);
        let recovered = get_job(&connection, &job.id)?.expect("recovered job");
        assert_eq!(recovered.status, "paused");
        assert_eq!(recovered.paused_reason.as_deref(), Some("APP_RESTART_INTERRUPTED"));
        let lock_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM chapter_generation_locks", [], |row| row.get(0))
            .map_err(AppError::database)?;
        assert_eq!(lock_count, 0);
        assert_eq!(recover_interrupted_jobs(&mut connection)?, 0);
        Ok(())
    }
}
