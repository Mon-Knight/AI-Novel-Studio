use crate::errors::{codes, AppError};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousJobRecord {
    pub id: String,
    pub novel_id: String,
    pub operation_id: String,
    pub status: String,
    pub total_chapters: i64,
    pub completed_chapters: i64,
    pub current_chapter_id: Option<String>,
    pub current_chapter_attempt: i64,
    pub total_tokens_input: i64,
    pub total_tokens_output: i64,
    pub estimated_cost_usd: f64,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub paused_at: Option<String>,
    pub paused_reason: Option<String>,
    pub paused_chapter_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QualityThresholdsRecord {
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
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousActionRecord {
    pub id: String,
    pub job_id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub action_type: String,
    pub quality_score: Option<i64>,
    pub quality_report_id: Option<String>,
    pub decision_reason: String,
    pub success: bool,
    pub error_message: Option<String>,
    pub tokens_used: Option<i64>,
    pub duration_ms: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChapterGenerationLockRecord {
    pub chapter_id: String,
    pub job_id: String,
    pub locked_by: String,
    pub locked_at: String,
    pub expires_at: String,
}

fn map_job_row(row: &Row) -> Result<AutonomousJobRecord, rusqlite::Error> {
    Ok(AutonomousJobRecord {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        operation_id: row.get(2)?,
        status: row.get(3)?,
        total_chapters: row.get(4)?,
        completed_chapters: row.get(5)?,
        current_chapter_id: row.get(6)?,
        current_chapter_attempt: row.get(7)?,
        total_tokens_input: row.get(8)?,
        total_tokens_output: row.get(9)?,
        estimated_cost_usd: row.get(10)?,
        started_at: row.get(11)?,
        completed_at: row.get(12)?,
        paused_at: row.get(13)?,
        paused_reason: row.get(14)?,
        paused_chapter_id: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}

fn map_thresholds_row(row: &Row) -> Result<QualityThresholdsRecord, rusqlite::Error> {
    Ok(QualityThresholdsRecord {
        novel_id: row.get(0)?,
        min_total_score: row.get(1)?,
        min_logic_score: row.get(2)?,
        min_setting_score: row.get(3)?,
        min_character_score: row.get(4)?,
        min_continuity_score: row.get(5)?,
        min_language_score: row.get(6)?,
        min_pacing_score: row.get(7)?,
        max_retry_attempts: row.get(8)?,
        max_critical_issues: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn map_action_row(row: &Row) -> Result<AutonomousActionRecord, rusqlite::Error> {
    Ok(AutonomousActionRecord {
        id: row.get(0)?,
        job_id: row.get(1)?,
        novel_id: row.get(2)?,
        chapter_id: row.get(3)?,
        action_type: row.get(4)?,
        quality_score: row.get(5)?,
        quality_report_id: row.get(6)?,
        decision_reason: row.get(7)?,
        success: row.get::<_, i64>(8)? != 0,
        error_message: row.get(9)?,
        tokens_used: row.get(10)?,
        duration_ms: row.get(11)?,
        created_at: row.get(12)?,
    })
}

pub fn create_job(
    connection: &mut Connection,
    id: &str,
    novel_id: &str,
    operation_id: &str,
    total_chapters: i64,
) -> Result<AutonomousJobRecord, AppError> {
    if total_chapters <= 0 {
        return Err(AppError::new(
            codes::AUTONOMOUS_JOB_PROGRESS_CONFLICT,
            "自主生成任务必须至少包含一个章节",
            false,
        ));
    }
    let transaction = connection.transaction().map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();

    let replay = transaction
        .query_row(
            "SELECT id, novel_id, operation_id, status, total_chapters,
                    completed_chapters, current_chapter_id, current_chapter_attempt,
                    total_tokens_input, total_tokens_output, estimated_cost_usd,
                    started_at, completed_at, paused_at, paused_reason, paused_chapter_id,
                    created_at, updated_at
             FROM autonomous_generation_jobs WHERE operation_id = ?1",
            params![operation_id],
            map_job_row,
        )
        .optional()
        .map_err(AppError::database)?;
    if let Some(existing) = replay {
        if existing.novel_id == novel_id && existing.total_chapters == total_chapters {
            return Ok(existing);
        }
        return Err(AppError::new(
            codes::OPERATION_PAYLOAD_CONFLICT,
            "相同 operationId 对应的自主生成任务参数不同",
            false,
        ));
    }

    let active_count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM autonomous_generation_jobs
             WHERE novel_id = ?1 AND status IN ('pending','running','paused')",
            params![novel_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if active_count > 0 {
        return Err(AppError::new(
            codes::AUTONOMOUS_JOB_ALREADY_ACTIVE,
            "该作品已有活动的自主生成任务",
            false,
        ));
    }

    transaction
        .execute(
            "INSERT INTO autonomous_generation_jobs (
                id, novel_id, operation_id, status, total_chapters,
                completed_chapters, current_chapter_attempt,
                total_tokens_input, total_tokens_output, estimated_cost_usd,
                created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, 0, 0, 0.0, ?6, ?6)",
            params![id, novel_id, operation_id, "pending", total_chapters, now],
        )
        .map_err(AppError::database)?;

    let record = transaction
        .query_row(
            "SELECT id, novel_id, operation_id, status, total_chapters,
                    completed_chapters, current_chapter_id, current_chapter_attempt,
                    total_tokens_input, total_tokens_output, estimated_cost_usd,
                    started_at, completed_at, paused_at, paused_reason, paused_chapter_id,
                    created_at, updated_at
             FROM autonomous_generation_jobs WHERE id = ?1",
            params![id],
            map_job_row,
        )
        .map_err(AppError::database)?;

    transaction.commit().map_err(AppError::database)?;
    Ok(record)
}

pub fn get_job(connection: &Connection, id: &str) -> Result<Option<AutonomousJobRecord>, AppError> {
    connection
        .query_row(
            "SELECT id, novel_id, operation_id, status, total_chapters,
                    completed_chapters, current_chapter_id, current_chapter_attempt,
                    total_tokens_input, total_tokens_output, estimated_cost_usd,
                    started_at, completed_at, paused_at, paused_reason, paused_chapter_id,
                    created_at, updated_at
             FROM autonomous_generation_jobs WHERE id = ?1",
            params![id],
            map_job_row,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn list_jobs_by_novel(
    connection: &Connection,
    novel_id: &str,
) -> Result<Vec<AutonomousJobRecord>, AppError> {
    let mut stmt = connection
        .prepare(
            "SELECT id, novel_id, operation_id, status, total_chapters,
                    completed_chapters, current_chapter_id, current_chapter_attempt,
                    total_tokens_input, total_tokens_output, estimated_cost_usd,
                    started_at, completed_at, paused_at, paused_reason, paused_chapter_id,
                    created_at, updated_at
             FROM autonomous_generation_jobs
             WHERE novel_id = ?1
             ORDER BY created_at DESC",
        )
        .map_err(AppError::database)?;

    let rows = stmt
        .query_map(params![novel_id], map_job_row)
        .map_err(AppError::database)?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

pub fn update_job_status(
    connection: &mut Connection,
    id: &str,
    status: &str,
) -> Result<AutonomousJobRecord, AppError> {
    let transaction = connection.transaction().map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();

    let rows_affected = transaction
        .execute(
            "UPDATE autonomous_generation_jobs
             SET status = ?1,
                 started_at = CASE
                     WHEN ?1 = 'running' AND started_at IS NULL THEN ?2
                     ELSE started_at
                 END,
                 completed_at = CASE
                     WHEN ?1 IN ('completed', 'failed', 'cancelled') THEN COALESCE(completed_at, ?2)
                     WHEN ?1 IN ('pending', 'running', 'paused') THEN NULL
                     ELSE completed_at
                 END,
                 paused_at = CASE
                     WHEN ?1 = 'paused' THEN COALESCE(paused_at, ?2)
                     WHEN ?1 IN ('pending', 'running', 'completed', 'failed', 'cancelled') THEN NULL
                     ELSE paused_at
                 END,
                 paused_reason = CASE
                     WHEN ?1 <> 'paused' THEN NULL
                     ELSE paused_reason
                 END,
                 paused_chapter_id = CASE
                     WHEN ?1 <> 'paused' THEN NULL
                     ELSE paused_chapter_id
                 END,
                 updated_at = ?2
             WHERE id = ?3",
            params![status, now, id],
        )
        .map_err(AppError::database)?;

    if rows_affected == 0 {
        return Err(AppError::new(
            codes::TARGET_NOT_FOUND,
            "自主生成任务不存在",
            false,
        ));
    }

    let record = transaction
        .query_row(
            "SELECT id, novel_id, operation_id, status, total_chapters,
                    completed_chapters, current_chapter_id, current_chapter_attempt,
                    total_tokens_input, total_tokens_output, estimated_cost_usd,
                    started_at, completed_at, paused_at, paused_reason, paused_chapter_id,
                    created_at, updated_at
             FROM autonomous_generation_jobs WHERE id = ?1",
            params![id],
            map_job_row,
        )
        .map_err(AppError::database)?;

    transaction.commit().map_err(AppError::database)?;
    Ok(record)
}

pub fn update_job_progress(
    connection: &mut Connection,
    id: &str,
    completed_chapters: i64,
    current_chapter_id: Option<&str>,
    current_chapter_attempt: Option<i64>,
    tokens_input: Option<i64>,
    tokens_output: Option<i64>,
    estimated_cost_usd: Option<f64>,
) -> Result<AutonomousJobRecord, AppError> {
    if completed_chapters < 0
        || tokens_input.unwrap_or(0) < 0
        || tokens_output.unwrap_or(0) < 0
        || matches!(estimated_cost_usd, Some(value) if value < 0.0)
    {
        return Err(AppError::new(
            codes::AUTONOMOUS_JOB_PROGRESS_CONFLICT,
            "自主生成进度或用量不能为负数",
            false,
        ));
    }
    let transaction = connection.transaction().map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();

    let rows_affected = transaction
        .execute(
            "UPDATE autonomous_generation_jobs
             SET completed_chapters = ?1,
                 current_chapter_id = COALESCE(?2, current_chapter_id),
                 current_chapter_attempt = COALESCE(?3, current_chapter_attempt),
                 total_tokens_input = total_tokens_input + COALESCE(?4, 0),
                 total_tokens_output = total_tokens_output + COALESCE(?5, 0),
                 estimated_cost_usd = COALESCE(?6, estimated_cost_usd),
                 updated_at = ?7
             WHERE id = ?8
               AND status = 'running'
               AND completed_chapters <= ?1",
            params![
                completed_chapters,
                current_chapter_id,
                current_chapter_attempt,
                tokens_input,
                tokens_output,
                estimated_cost_usd,
                now,
                id
            ],
        )
        .map_err(AppError::database)?;

    if rows_affected == 0 {
        let existing = transaction
            .query_row(
                "SELECT status, completed_chapters FROM autonomous_generation_jobs WHERE id = ?1",
                params![id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(AppError::database)?;
        return match existing {
            None => Err(AppError::new(
                codes::AUTONOMOUS_JOB_NOT_FOUND,
                "自主生成任务不存在",
                false,
            )),
            Some((status, current)) => Err(AppError::new(
                codes::AUTONOMOUS_JOB_PROGRESS_CONFLICT,
                format!(
                    "任务状态或完成进度已变化（status={}, current={}, requested={}）",
                    status, current, completed_chapters
                ),
                false,
            )),
        };
    }

    let record = transaction
        .query_row(
            "SELECT id, novel_id, operation_id, status, total_chapters,
                    completed_chapters, current_chapter_id, current_chapter_attempt,
                    total_tokens_input, total_tokens_output, estimated_cost_usd,
                    started_at, completed_at, paused_at, paused_reason, paused_chapter_id,
                    created_at, updated_at
             FROM autonomous_generation_jobs WHERE id = ?1",
            params![id],
            map_job_row,
        )
        .map_err(AppError::database)?;

    transaction.commit().map_err(AppError::database)?;
    Ok(record)
}

pub fn pause_job(
    connection: &mut Connection,
    id: &str,
    reason: &str,
    chapter_id: Option<&str>,
) -> Result<AutonomousJobRecord, AppError> {
    let transaction = connection.transaction().map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();

    let rows_affected = transaction
        .execute(
            "UPDATE autonomous_generation_jobs
             SET status = 'paused',
                 paused_at = ?1,
                 paused_reason = ?2,
                 paused_chapter_id = ?3,
                 updated_at = ?1
             WHERE id = ?4 AND status = 'running'",
            params![now, reason, chapter_id, id],
        )
        .map_err(AppError::database)?;

    if rows_affected == 0 {
        return Err(AppError::new(
            codes::AI_TASK_ILLEGAL_TRANSITION,
            "只能暂停运行中的任务",
            false,
        ));
    }

    let record = transaction
        .query_row(
            "SELECT id, novel_id, operation_id, status, total_chapters,
                    completed_chapters, current_chapter_id, current_chapter_attempt,
                    total_tokens_input, total_tokens_output, estimated_cost_usd,
                    started_at, completed_at, paused_at, paused_reason, paused_chapter_id,
                    created_at, updated_at
             FROM autonomous_generation_jobs WHERE id = ?1",
            params![id],
            map_job_row,
        )
        .map_err(AppError::database)?;

    transaction.commit().map_err(AppError::database)?;
    Ok(record)
}

pub fn get_quality_thresholds(
    connection: &Connection,
    novel_id: &str,
) -> Result<Option<QualityThresholdsRecord>, AppError> {
    connection
        .query_row(
            "SELECT novel_id, min_total_score, min_logic_score, min_setting_score,
                    min_character_score, min_continuity_score, min_language_score,
                    min_pacing_score, max_retry_attempts, max_critical_issues,
                    created_at, updated_at
             FROM quality_thresholds WHERE novel_id = ?1",
            params![novel_id],
            map_thresholds_row,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn upsert_quality_thresholds(
    connection: &mut Connection,
    record: &QualityThresholdsRecord,
) -> Result<QualityThresholdsRecord, AppError> {
    let transaction = connection.transaction().map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();

    transaction
        .execute(
            "INSERT INTO quality_thresholds (
                novel_id, min_total_score, min_logic_score, min_setting_score,
                min_character_score, min_continuity_score, min_language_score,
                min_pacing_score, max_retry_attempts, max_critical_issues,
                created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
            ON CONFLICT(novel_id) DO UPDATE SET
                min_total_score = ?2,
                min_logic_score = ?3,
                min_setting_score = ?4,
                min_character_score = ?5,
                min_continuity_score = ?6,
                min_language_score = ?7,
                min_pacing_score = ?8,
                max_retry_attempts = ?9,
                max_critical_issues = ?10,
                updated_at = ?11",
            params![
                record.novel_id,
                record.min_total_score,
                record.min_logic_score,
                record.min_setting_score,
                record.min_character_score,
                record.min_continuity_score,
                record.min_language_score,
                record.min_pacing_score,
                record.max_retry_attempts,
                record.max_critical_issues,
                now
            ],
        )
        .map_err(AppError::database)?;

    let result = transaction
        .query_row(
            "SELECT novel_id, min_total_score, min_logic_score, min_setting_score,
                    min_character_score, min_continuity_score, min_language_score,
                    min_pacing_score, max_retry_attempts, max_critical_issues,
                    created_at, updated_at
             FROM quality_thresholds WHERE novel_id = ?1",
            params![record.novel_id],
            map_thresholds_row,
        )
        .map_err(AppError::database)?;

    transaction.commit().map_err(AppError::database)?;
    Ok(result)
}

pub fn log_action(
    connection: &mut Connection,
    record: &AutonomousActionRecord,
) -> Result<AutonomousActionRecord, AppError> {
    let transaction = connection.transaction().map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();

    transaction
        .execute(
            "INSERT INTO autonomous_actions (
                id, job_id, novel_id, chapter_id, action_type,
                quality_score, quality_report_id, decision_reason,
                success, error_message, tokens_used, duration_ms, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                record.id,
                record.job_id,
                record.novel_id,
                record.chapter_id,
                record.action_type,
                record.quality_score,
                record.quality_report_id,
                record.decision_reason,
                if record.success { 1 } else { 0 },
                record.error_message,
                record.tokens_used,
                record.duration_ms,
                now
            ],
        )
        .map_err(AppError::database)?;

    let result = transaction
        .query_row(
            "SELECT id, job_id, novel_id, chapter_id, action_type,
                    quality_score, quality_report_id, decision_reason,
                    success, error_message, tokens_used, duration_ms, created_at
             FROM autonomous_actions WHERE id = ?1",
            params![record.id],
            map_action_row,
        )
        .map_err(AppError::database)?;

    transaction.commit().map_err(AppError::database)?;
    Ok(result)
}

pub fn list_actions(
    connection: &Connection,
    job_id: &str,
) -> Result<Vec<AutonomousActionRecord>, AppError> {
    let mut stmt = connection
        .prepare(
            "SELECT id, job_id, novel_id, chapter_id, action_type,
                    quality_score, quality_report_id, decision_reason,
                    success, error_message, tokens_used, duration_ms, created_at
             FROM autonomous_actions
             WHERE job_id = ?1
             ORDER BY created_at ASC",
        )
        .map_err(AppError::database)?;

    let rows = stmt
        .query_map(params![job_id], map_action_row)
        .map_err(AppError::database)?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

pub fn create_continuity_check(
    connection: &mut Connection,
    id: &str,
    novel_id: &str,
    chapter_id: &str,
    check_type: &str,
    score: i64,
    status: &str,
    issues_json: Option<&str>,
    previous_chapter_ids: Option<&str>,
    operation_id: Option<&str>,
    created_at: Option<&str>,
) -> Result<String, AppError> {
    let transaction = connection.transaction().map_err(AppError::database)?;
    let now = created_at.unwrap_or_else(|| "");
    let timestamp = if now.is_empty() {
        Utc::now().to_rfc3339()
    } else {
        now.to_string()
    };
    transaction
        .execute(
            "INSERT INTO continuity_checks (
                id, novel_id, chapter_id, check_type, score, status,
                issues_json, previous_chapter_ids, operation_id, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO NOTHING",
            params![
                id,
                novel_id,
                chapter_id,
                check_type,
                score,
                status,
                issues_json,
                previous_chapter_ids,
                operation_id,
                timestamp,
            ],
        )
        .map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(id.to_string())
}

pub fn create_expert_collaboration_log(
    connection: &mut Connection,
    id: &str,
    novel_id: &str,
    chapter_id: &str,
    draft_id: &str,
    round_number: i64,
    expert_type: &str,
    score: i64,
    issues_json: Option<&str>,
    suggestions_json: Option<&str>,
    operation_id: Option<&str>,
    created_at: Option<&str>,
) -> Result<String, AppError> {
    let transaction = connection.transaction().map_err(AppError::database)?;
    let now = created_at.unwrap_or_else(|| "");
    let timestamp = if now.is_empty() {
        Utc::now().to_rfc3339()
    } else {
        now.to_string()
    };
    transaction
        .execute(
            "INSERT INTO expert_collaboration_logs (
                id, novel_id, chapter_id, draft_id, round_number, expert_type,
                score, issues_json, suggestions_json, operation_id, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO NOTHING",
            params![
                id,
                novel_id,
                chapter_id,
                draft_id,
                round_number,
                expert_type,
                score,
                issues_json,
                suggestions_json,
                operation_id,
                timestamp,
            ],
        )
        .map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(id.to_string())
}

pub fn acquire_chapter_lock(
    connection: &mut Connection,
    chapter_id: &str,
    job_id: &str,
    locked_by: &str,
    lock_duration_seconds: i64,
) -> Result<bool, AppError> {
    let transaction = connection.transaction().map_err(AppError::database)?;
    let now = Utc::now();
    let expires_at = (now + chrono::Duration::seconds(lock_duration_seconds)).to_rfc3339();
    let now_str = now.to_rfc3339();

    // 先清理过期锁
    transaction
        .execute(
            "DELETE FROM chapter_generation_locks WHERE expires_at < ?1",
            params![now_str],
        )
        .map_err(AppError::database)?;

    // 尝试获取锁。同一 job/owner 可幂等续租；其他持有者不能覆盖。
    let result = transaction.execute(
        "INSERT INTO chapter_generation_locks (
            chapter_id, job_id, locked_by, locked_at, expires_at
        ) VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(chapter_id) DO UPDATE SET
            expires_at = excluded.expires_at
        WHERE chapter_generation_locks.job_id = excluded.job_id
          AND chapter_generation_locks.locked_by = excluded.locked_by",
        params![chapter_id, job_id, locked_by, now_str, expires_at],
    );

    match result {
        Ok(rows) => {
            transaction.commit().map_err(AppError::database)?;
            Ok(rows > 0)
        }
        Err(_) => Ok(false),
    }
}

pub fn release_chapter_lock(
    connection: &mut Connection,
    chapter_id: &str,
    job_id: &str,
    locked_by: &str,
) -> Result<bool, AppError> {
    let transaction = connection.transaction().map_err(AppError::database)?;

    let rows = transaction
        .execute(
            "DELETE FROM chapter_generation_locks
             WHERE chapter_id = ?1 AND job_id = ?2 AND locked_by = ?3",
            params![chapter_id, job_id, locked_by],
        )
        .map_err(AppError::database)?;

    transaction.commit().map_err(AppError::database)?;
    Ok(rows > 0)
}

pub fn cleanup_expired_locks(connection: &mut Connection) -> Result<usize, AppError> {
    let transaction = connection.transaction().map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();

    let rows = transaction
        .execute(
            "DELETE FROM chapter_generation_locks WHERE expires_at < ?1",
            params![now],
        )
        .map_err(AppError::database)?;

    transaction.commit().map_err(AppError::database)?;
    Ok(rows)
}

pub fn recover_interrupted_jobs(connection: &mut Connection) -> Result<usize, AppError> {
    let transaction = connection.transaction().map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    let recovered = transaction
        .execute(
            "UPDATE autonomous_generation_jobs
             SET status = 'paused',
                 paused_at = ?1,
                 paused_reason = 'APP_RESTART_INTERRUPTED',
                 paused_chapter_id = current_chapter_id,
                 updated_at = ?1
             WHERE status = 'running'",
            params![now],
        )
        .map_err(AppError::database)?;
    // No worker survives application restart, so every chapter lock is stale.
    transaction
        .execute("DELETE FROM chapter_generation_locks", [])
        .map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(recovered)
}
