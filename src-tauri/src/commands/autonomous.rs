use crate::db::get_connection;
use crate::errors::{codes, AppError};
use crate::repositories::autonomous_repository::{
    AutonomousActionRecord, AutonomousJobRecord, QualityThresholdsRecord,
};
use crate::services::autonomous_service::{
    self, CreateContinuityCheckInput, CreateExpertCollaborationLogInput, CreateJobInput,
    LogActionInput, PauseJobInput, SaveQualityThresholdsInput, UpdateJobProgressInput,
    UpdateJobStatusInput,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobIdInput {
    pub job_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelIdInput {
    pub novel_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcquireChapterLockInput {
    pub chapter_id: String,
    pub job_id: String,
    pub locked_by: String,
    pub lock_duration_seconds: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseChapterLockInput {
    pub chapter_id: String,
    pub job_id: String,
    pub locked_by: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptAutonomousChapterInput {
    pub job_id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub draft_id: String,
    pub quality_report_id: String,
    pub locked_by: String,
}

fn legacy_text_hash(text: &str) -> String {
    let mut hash = 2_166_136_261_u32;
    for code_unit in text.encode_utf16() {
        hash ^= u32::from(code_unit);
        hash = hash.wrapping_mul(16_777_619);
    }
    format!("txt_{hash:08x}")
}

#[tauri::command]
pub fn create_autonomous_job(input: CreateJobInput) -> Result<AutonomousJobRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_service::create_job(&mut connection, input)
}

#[tauri::command]
pub fn get_autonomous_job(input: JobIdInput) -> Result<Option<AutonomousJobRecord>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_service::get_job(&connection, &input.job_id)
}

#[tauri::command]
pub fn list_autonomous_jobs_by_novel(
    input: NovelIdInput,
) -> Result<Vec<AutonomousJobRecord>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_service::list_jobs_by_novel(&connection, &input.novel_id)
}

#[tauri::command]
pub fn update_autonomous_job_status(
    input: UpdateJobStatusInput,
) -> Result<AutonomousJobRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_service::update_job_status(&mut connection, input)
}

#[tauri::command]
pub fn update_autonomous_job_progress(
    input: UpdateJobProgressInput,
) -> Result<AutonomousJobRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_service::update_job_progress(&mut connection, input)
}

#[tauri::command]
pub fn pause_autonomous_job(input: PauseJobInput) -> Result<AutonomousJobRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_service::pause_job(&mut connection, input)
}

#[tauri::command]
pub fn resume_autonomous_job(input: JobIdInput) -> Result<AutonomousJobRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_service::resume_job(&mut connection, &input.job_id)
}

#[tauri::command]
pub fn cancel_autonomous_job(input: JobIdInput) -> Result<AutonomousJobRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_service::cancel_job(&mut connection, &input.job_id)
}

#[tauri::command]
pub fn get_quality_thresholds(
    input: NovelIdInput,
) -> Result<Option<QualityThresholdsRecord>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_service::get_quality_thresholds(&connection, &input.novel_id)
}

#[tauri::command]
pub fn save_quality_thresholds(
    input: SaveQualityThresholdsInput,
) -> Result<QualityThresholdsRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_service::save_quality_thresholds(&mut connection, input)
}

#[tauri::command]
pub fn log_autonomous_action(input: LogActionInput) -> Result<AutonomousActionRecord, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_service::log_action(&mut connection, input)
}

#[tauri::command]
pub fn list_autonomous_actions(input: JobIdInput) -> Result<Vec<AutonomousActionRecord>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_service::list_actions(&connection, &input.job_id)
}

#[tauri::command]
pub fn create_continuity_check(input: CreateContinuityCheckInput) -> Result<String, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_service::create_continuity_check(&mut connection, input)
}

#[tauri::command]
pub fn create_expert_collaboration_log(
    input: CreateExpertCollaborationLogInput,
) -> Result<String, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_service::create_expert_collaboration_log(&mut connection, input)
}

#[tauri::command]
pub fn acquire_chapter_lock(input: AcquireChapterLockInput) -> Result<bool, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_service::acquire_chapter_lock(&mut connection, input)
}

#[tauri::command]
pub fn release_chapter_lock(input: ReleaseChapterLockInput) -> Result<bool, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_service::release_chapter_lock(
        &mut connection,
        &input.chapter_id,
        &input.job_id,
        &input.locked_by,
    )
}

#[tauri::command]
pub fn adopt_autonomous_chapter_draft(
    input: AdoptAutonomousChapterInput,
) -> Result<super::ChapterDraftDto, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    adopt_autonomous_chapter_draft_in_connection(&mut connection, input)
}

pub(crate) fn adopt_autonomous_chapter_draft_in_connection(
    connection: &mut rusqlite::Connection,
    input: AdoptAutonomousChapterInput,
) -> Result<super::ChapterDraftDto, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = chrono::Utc::now().to_rfc3339();
    let guard_count: i64 = transaction
        .query_row(
            "SELECT COUNT(*)
             FROM autonomous_generation_jobs AS job
             INNER JOIN chapter_generation_locks AS generation_lock
                ON generation_lock.chapter_id = ?1
               AND generation_lock.job_id = job.id
               AND generation_lock.locked_by = ?2
               AND generation_lock.expires_at >= ?3
             INNER JOIN chapters AS chapter
                ON chapter.id = ?1
               AND chapter.novel_id = job.novel_id
               AND chapter.deleted_at IS NULL
             INNER JOIN chapter_drafts AS draft
                ON draft.id = ?4
               AND draft.chapter_id = chapter.id
               AND draft.novel_id = chapter.novel_id
             WHERE job.id = ?5
               AND job.novel_id = ?6
               AND job.status = 'running'",
            params![
                &input.chapter_id,
                &input.locked_by,
                &now,
                &input.draft_id,
                &input.job_id,
                &input.novel_id,
            ],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if guard_count != 1 {
        return Err(AppError::new(
            codes::AUTONOMOUS_LOCK_NOT_OWNED,
            "Job 状态、章节归属或执行锁已变化，拒绝迟到采纳",
            false,
        ));
    }

    let draft = super::get_draft_by_id_and_chapter_internal(
        &transaction,
        &input.draft_id,
        &input.chapter_id,
    )
    .map_err(|message| AppError::new(codes::AUTONOMOUS_ADOPTION_CONFLICT, message, false))?;
    let report: Option<(String, String, Option<i64>, Option<i64>)> = transaction
        .query_row(
            "SELECT draft_id, content_hash, content_length, draft_version
             FROM quality_check_reports
             WHERE id = ?1
               AND novel_id = ?2
               AND chapter_id = ?3
               AND status = 'completed'",
            params![&input.quality_report_id, &input.novel_id, &input.chapter_id,],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(AppError::database)?;
    let authoritative_content = match draft.large_text_ref_id.as_deref() {
        Some(document_id) => {
            crate::large_text_save::read_large_text_document_internal(&transaction, document_id)
                .map_err(|message| {
                    AppError::new(codes::AUTONOMOUS_ADOPTION_CONFLICT, message, false)
                })?
        }
        None => draft.content.clone(),
    };
    let expected_hash = legacy_text_hash(&authoritative_content);
    let expected_length = authoritative_content.encode_utf16().count() as i64;
    let report_matches =
        report.is_some_and(|(draft_id, content_hash, content_length, draft_version)| {
            draft_id == input.draft_id
                && content_hash == expected_hash
                && content_length == Some(expected_length)
                && draft_version == Some(draft.version_no)
        });
    if !report_matches {
        return Err(AppError::new(
            codes::AUTONOMOUS_ADOPTION_CONFLICT,
            "质量报告与当前候选草稿版本或正文 hash 不一致",
            false,
        ));
    }

    let adopted = super::adopt_chapter_draft_in_transaction(
        &transaction,
        &input.draft_id,
        &input.chapter_id,
        &now,
    )
    .map_err(|message| AppError::new(codes::AUTONOMOUS_ADOPTION_CONFLICT, message, false))?;
    transaction.commit().map_err(AppError::database)?;
    Ok(adopted)
}

#[tauri::command]
pub fn cleanup_expired_locks() -> Result<usize, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    autonomous_service::cleanup_expired_locks(&mut connection)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn adoption_connection() -> Result<Connection, Box<dyn std::error::Error>> {
        let connection = Connection::open_in_memory()?;
        connection.execute_batch(
            "CREATE TABLE autonomous_generation_jobs (
                id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, status TEXT NOT NULL
             );
             CREATE TABLE chapter_generation_locks (
                chapter_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, locked_by TEXT NOT NULL,
                locked_at TEXT NOT NULL, expires_at TEXT NOT NULL
             );
             CREATE TABLE chapters (
                id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, title TEXT NOT NULL,
                adopted_draft_id TEXT, word_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                deleted_at TEXT
             );
             CREATE TABLE chapter_drafts (
                id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
                title TEXT, content TEXT NOT NULL, source TEXT NOT NULL,
                version_no INTEGER NOT NULL, word_count INTEGER NOT NULL,
                is_adopted INTEGER NOT NULL DEFAULT 0, ai_task_id TEXT, note TEXT,
                large_text_ref_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
             );
             CREATE TABLE quality_check_reports (
                id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
                draft_id TEXT NOT NULL, status TEXT NOT NULL, content_hash TEXT,
                content_length INTEGER, draft_version INTEGER
             );
             CREATE TABLE chapter_summaries (
                id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL, is_expired INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
             );
             CREATE TABLE context_records (
                id TEXT PRIMARY KEY, chapter_id TEXT, is_expired INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
             );",
        )?;
        let content = "候选正文";
        connection.execute_batch(
            "INSERT INTO autonomous_generation_jobs VALUES ('job-a','novel-a','running');
             INSERT INTO chapter_generation_locks VALUES (
                'chapter-a','job-a','worker-a','2026-07-27T00:00:00Z','2999-01-01T00:00:00Z'
             );
             INSERT INTO chapters (
                id,novel_id,title,status,created_at,updated_at
             ) VALUES ('chapter-a','novel-a','Chapter','editing','now','now');",
        )?;
        connection.execute(
            "INSERT INTO chapter_drafts (
                id,novel_id,chapter_id,content,source,version_no,word_count,is_adopted,
                created_at,updated_at
             ) VALUES ('draft-a','novel-a','chapter-a',?1,'ai_generated',1,4,0,'now','now')",
            params![content],
        )?;
        connection.execute(
            "INSERT INTO quality_check_reports (
                id,novel_id,chapter_id,draft_id,status,content_hash,content_length,draft_version
             ) VALUES ('report-a','novel-a','chapter-a','draft-a','completed',?1,?2,1)",
            params![
                legacy_text_hash(content),
                content.encode_utf16().count() as i64
            ],
        )?;
        Ok(connection)
    }

    fn adoption_input() -> AdoptAutonomousChapterInput {
        AdoptAutonomousChapterInput {
            job_id: "job-a".to_string(),
            novel_id: "novel-a".to_string(),
            chapter_id: "chapter-a".to_string(),
            draft_id: "draft-a".to_string(),
            quality_report_id: "report-a".to_string(),
            locked_by: "worker-a".to_string(),
        }
    }

    #[test]
    fn autonomous_adoption_checks_job_lock_and_quality_in_one_transaction(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = adoption_connection()?;
        let adopted =
            adopt_autonomous_chapter_draft_in_connection(&mut connection, adoption_input())?;
        assert!(adopted.is_adopted);

        connection.execute(
            "UPDATE autonomous_generation_jobs SET status='paused' WHERE id='job-a'",
            [],
        )?;
        let paused_error =
            adopt_autonomous_chapter_draft_in_connection(&mut connection, adoption_input())
                .unwrap_err();
        assert_eq!(paused_error.code, codes::AUTONOMOUS_LOCK_NOT_OWNED);

        connection.execute(
            "UPDATE autonomous_generation_jobs SET status='running' WHERE id='job-a'",
            [],
        )?;
        connection.execute(
            "UPDATE quality_check_reports SET content_hash='txt_00000000' WHERE id='report-a'",
            [],
        )?;
        let report_error =
            adopt_autonomous_chapter_draft_in_connection(&mut connection, adoption_input())
                .unwrap_err();
        assert_eq!(report_error.code, codes::AUTONOMOUS_ADOPTION_CONFLICT);
        Ok(())
    }
}
