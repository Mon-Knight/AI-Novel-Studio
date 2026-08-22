use crate::domain::ai::{
    CreateGenerationJobInput, GenerationJobDto, GenerationStepResultDto,
    SaveGenerationStepResultInput, StartupTaskRecoveryDto, UpdateGenerationJobInput,
};
use crate::repositories::generation_job_repository;
use rusqlite::{params, Connection, TransactionBehavior};

pub const STARTUP_RECOVERY_ERROR_CODE: &str = "APP_RESTART_INTERRUPTED";
pub const STARTUP_RECOVERY_MESSAGE: &str =
    "应用在任务完成前退出；已保留完成步骤和草稿，请确认后手动重新开始。";

pub fn generation_job_status_is_terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled")
}

pub fn generation_job_transition_is_allowed(current: &str, next: &str) -> bool {
    current == next
        || matches!(
            (current, next),
            ("pending", "running")
                | ("pending", "retrying")
                | ("pending", "failed")
                | ("pending", "cancelled")
                | ("running", "retrying")
                | ("running", "completed")
                | ("running", "failed")
                | ("running", "cancelled")
                | ("retrying", "running")
                | ("retrying", "completed")
                | ("retrying", "failed")
                | ("retrying", "cancelled")
        )
}

pub fn normalized_recovery_step_name(current_step: Option<String>) -> String {
    const STEPS: [&str; 9] = [
        "preflight",
        "compile_context",
        "chapter_card",
        "scene_plan",
        "draft_generation",
        "quality_check",
        "patch_generation",
        "patch_apply",
        "save_version",
    ];
    current_step
        .filter(|step| STEPS.contains(&step.as_str()))
        .unwrap_or_else(|| "preflight".to_string())
}

pub fn create_generation_job(
    conn: &Connection,
    input: CreateGenerationJobInput,
) -> Result<GenerationJobDto, String> {
    if input.status != "pending" || input.progress_percent != 0 {
        return Err("generation_job_invalid_initial_state: expected pending at 0%".to_string());
    }
    generation_job_repository::insert_generation_job(conn, &input)?;
    generation_job_repository::find_generation_job_by_id(conn, &input.id)
}

pub fn update_generation_job(
    conn: &Connection,
    input: &UpdateGenerationJobInput,
) -> Result<GenerationJobDto, String> {
    let current = generation_job_repository::find_generation_job_by_id(conn, &input.id)
        .map_err(|error| format!("generation_job_not_found: {}", error))?;
    if generation_job_status_is_terminal(&current.status) {
        return Err(format!(
            "generation_job_terminal: {} is already {}",
            input.id, current.status
        ));
    }
    if let Some(next_status) = input.status.as_deref() {
        if !generation_job_transition_is_allowed(&current.status, next_status) {
            return Err(format!(
                "generation_job_invalid_transition: {} -> {}",
                current.status, next_status
            ));
        }
    }
    if let Some(progress) = input.progress_percent {
        if !(0..=100).contains(&progress) {
            return Err(format!(
                "generation_job_invalid_progress: {} is outside 0..100",
                progress
            ));
        }
        if progress < current.progress_percent {
            return Err(format!(
                "generation_job_progress_regression: {} -> {}",
                current.progress_percent, progress
            ));
        }
    }

    let affected = generation_job_repository::update_generation_job_fields(conn, input)?;
    if affected != 1 {
        return Err(format!(
            "generation_job_update_conflict: expected one row, affected {}",
            affected
        ));
    }
    generation_job_repository::find_generation_job_by_id(conn, &input.id)
}

pub fn get_generation_job(conn: &Connection, id: &str) -> Result<Option<GenerationJobDto>, String> {
    match generation_job_repository::find_generation_job_by_id(conn, id) {
        Ok(job) => Ok(Some(job)),
        Err(err) if err.contains("Query returned no rows") => Ok(None),
        Err(err) => Err(err),
    }
}

pub fn get_generation_jobs_by_chapter_id(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<GenerationJobDto>, String> {
    generation_job_repository::find_generation_jobs_by_chapter(conn, chapter_id)
}

pub fn cancel_generation_job(
    conn: &mut Connection,
    id: &str,
    finished_at: &str,
) -> Result<Option<GenerationJobDto>, String> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("generation_job_cancel_begin_failed: {}", error))?;
    let current = match generation_job_repository::find_generation_job_by_id(&tx, id) {
        Ok(job) => job,
        Err(error) if error.contains("Query returned no rows") => return Ok(None),
        Err(error) => return Err(error),
    };
    if generation_job_status_is_terminal(&current.status) {
        tx.commit()
            .map_err(|error| format!("generation_job_cancel_commit_failed: {}", error))?;
        return Ok(Some(current));
    }

    let step_name = normalized_recovery_step_name(current.current_step.clone());
    tx.execute(
        "UPDATE generation_jobs SET status = 'cancelled', finished_at = ?1 WHERE id = ?2 AND status NOT IN ('completed', 'failed', 'cancelled')",
        params![finished_at, id],
    )
    .map_err(|error| format!("generation_job_cancel_update_failed: {}", error))?;
    tx.execute(
        "INSERT INTO generation_step_results (id, job_id, step_name, status, output_text, created_at) VALUES (?1, ?2, ?3, 'cancelled', ?4, ?5)",
        params![
            uuid::Uuid::new_v4().to_string(),
            id,
            step_name,
            "任务已取消。",
            finished_at,
        ],
    )
    .map_err(|error| format!("generation_job_cancel_checkpoint_failed: {}", error))?;
    let cancelled = generation_job_repository::find_generation_job_by_id(&tx, id)?;
    tx.commit()
        .map_err(|error| format!("generation_job_cancel_commit_failed: {}", error))?;
    Ok(Some(cancelled))
}

pub fn save_generation_step_result(
    conn: &mut Connection,
    input: &SaveGenerationStepResultInput,
) -> Result<GenerationStepResultDto, String> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("generation_step_begin_failed: {}", error))?;
    let parent = generation_job_repository::find_generation_job_by_id(&tx, &input.job_id)
        .map_err(|error| format!("generation_step_parent_not_found: {}", error))?;
    if generation_job_status_is_terminal(&parent.status) {
        return Err(format!(
            "generation_step_parent_terminal: {} is already {}",
            input.job_id, parent.status
        ));
    }
    generation_job_repository::insert_generation_step_result(&tx, input)?;
    let result = generation_job_repository::find_generation_step_result_by_id(&tx, &input.id)?;
    tx.commit()
        .map_err(|error| format!("generation_step_commit_failed: {}", error))?;
    Ok(result)
}

pub fn get_generation_step_results(
    conn: &Connection,
    job_id: &str,
) -> Result<Vec<GenerationStepResultDto>, String> {
    generation_job_repository::find_generation_step_results_by_job(conn, job_id)
}

#[derive(Debug)]
struct InterruptedGenerationJob {
    id: String,
    previous_status: String,
    current_step: Option<String>,
    progress_percent: i64,
}

pub fn recover_interrupted_generation_jobs(
    conn: &mut Connection,
    recovered_at: &str,
) -> Result<StartupTaskRecoveryDto, String> {
    let tx = conn
        .transaction()
        .map_err(|error| format!("task_recovery_begin_failed: {}", error))?;
    let jobs = {
        let mut stmt = tx
            .prepare(
                "SELECT id, status, current_step, progress_percent FROM generation_jobs WHERE status IN ('pending', 'running', 'retrying') ORDER BY created_at ASC, id ASC",
            )
            .map_err(|error| format!("task_recovery_query_failed: {}", error))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(InterruptedGenerationJob {
                    id: row.get(0)?,
                    previous_status: row.get(1)?,
                    current_step: row.get(2)?,
                    progress_percent: row.get(3)?,
                })
            })
            .map_err(|error| format!("task_recovery_query_failed: {}", error))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("task_recovery_query_failed: {}", error))?;
        rows
    };

    let mut recovered_jobs = 0_i64;
    for job in jobs {
        let affected = tx
            .execute(
                "UPDATE generation_jobs SET status = 'failed', error_code = ?1, error_message = ?2, finished_at = ?3 WHERE id = ?4 AND status IN ('pending', 'running', 'retrying')",
                params![
                    STARTUP_RECOVERY_ERROR_CODE,
                    STARTUP_RECOVERY_MESSAGE,
                    recovered_at,
                    &job.id,
                ],
            )
            .map_err(|error| format!("task_recovery_job_update_failed: {}", error))?;
        if affected == 0 {
            continue;
        }

        let step_name = normalized_recovery_step_name(job.current_step);
        let output_json = serde_json::json!({
            "recoveryReason": STARTUP_RECOVERY_ERROR_CODE,
            "previousStatus": job.previous_status,
            "preservedProgressPercent": job.progress_percent,
        })
        .to_string();
        tx.execute(
            "INSERT INTO generation_step_results (id, job_id, step_name, status, output_json, output_text, error_message, created_at) VALUES (?1, ?2, ?3, 'failed', ?4, ?5, ?5, ?6)",
            params![
                uuid::Uuid::new_v4().to_string(),
                &job.id,
                step_name,
                output_json,
                STARTUP_RECOVERY_MESSAGE,
                recovered_at,
            ],
        )
        .map_err(|error| format!("task_recovery_checkpoint_insert_failed: {}", error))?;
        recovered_jobs += 1;
    }

    tx.commit()
        .map_err(|error| format!("task_recovery_commit_failed: {}", error))?;
    Ok(StartupTaskRecoveryDto {
        recovered_jobs,
        recovered_at: recovered_at.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::create_tables(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO novels (id, title, created_at, updated_at) VALUES ('11111111-1111-1111-1111-111111111111', '测试小说', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO chapters (id, novel_id, title, order_index, status, word_count, created_at, updated_at) VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '第一章', 1, 'drafted', 1000, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn
    }

    #[test]
    fn test_generation_job_transitions_and_steps() {
        let mut conn = setup_test_db();
        let job_id = uuid::Uuid::new_v4().to_string();
        let created = create_generation_job(
            &conn,
            CreateGenerationJobInput {
                id: job_id.clone(),
                world_id: None,
                novel_id: "11111111-1111-1111-1111-111111111111".to_string(),
                volume_id: None,
                chapter_id: "22222222-2222-2222-2222-222222222222".to_string(),
                job_type: "chapter_generation".to_string(),
                status: "pending".to_string(),
                current_step: Some("preflight".to_string()),
                progress_percent: 0,
                provider: Some("deepseek".to_string()),
                model_name: Some("deepseek-chat".to_string()),
                retry_count: 0,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                started_at: None,
            },
        )
        .unwrap();

        assert_eq!(created.status, "pending");

        let running = update_generation_job(
            &conn,
            &UpdateGenerationJobInput {
                id: job_id.clone(),
                status: Some("running".to_string()),
                current_step: Some("draft_generation".to_string()),
                progress_percent: Some(50),
                provider: None,
                model_name: None,
                input_token_estimate: None,
                output_token_estimate: None,
                actual_input_tokens: None,
                actual_output_tokens: None,
                cost_estimate: None,
                error_code: None,
                error_message: None,
                retry_count: None,
                started_at: Some("2026-01-01T00:01:00Z".to_string()),
                finished_at: None,
            },
        )
        .unwrap();
        assert_eq!(running.status, "running");
        assert_eq!(running.progress_percent, 50);

        let step_id = uuid::Uuid::new_v4().to_string();
        let step = save_generation_step_result(
            &mut conn,
            &SaveGenerationStepResultInput {
                id: step_id,
                job_id: job_id.clone(),
                step_name: "draft_generation".to_string(),
                status: "completed".to_string(),
                input_snapshot_json: None,
                output_json: None,
                output_text: Some("生成了正文".to_string()),
                error_message: None,
                created_at: "2026-01-01T00:02:00Z".to_string(),
            },
        )
        .unwrap();
        assert_eq!(step.status, "completed");

        let steps = get_generation_step_results(&conn, &job_id).unwrap();
        assert_eq!(steps.len(), 1);

        let cancelled = cancel_generation_job(&mut conn, &job_id, "2026-01-01T00:03:00Z")
            .unwrap()
            .unwrap();
        assert_eq!(cancelled.status, "cancelled");
    }
}
