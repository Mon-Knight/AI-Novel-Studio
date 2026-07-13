use crate::errors::AppError;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskView {
    pub source: String,
    pub id: String,
    pub task_type: String,
    pub status: String,
    pub user_status: String,
    pub is_legacy: bool,
    pub novel_id: Option<String>,
    pub novel_title: Option<String>,
    pub chapter_id: Option<String>,
    pub chapter_title: Option<String>,
    pub progress_percent: Option<i64>,
    pub progress_stage: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub latest_attempt_id: Option<String>,
    pub latest_attempt_number: Option<i64>,
    pub latest_attempt_status: Option<String>,
    pub provider_id: Option<String>,
    pub response_metadata_json: Option<String>,
    pub artifact_id: Option<String>,
    pub artifact_type: Option<String>,
    pub artifact_status: Option<String>,
    pub artifact_content_hash: Option<String>,
    pub artifact_content_length: Option<i64>,
    pub artifact_issue: Option<String>,
    pub proposal_id: Option<String>,
    pub apply_plan_id: Option<String>,
    pub apply_plan_status: Option<String>,
    pub target_link_count: i64,
    pub requires_review: bool,
    pub result_expired: bool,
    pub trace_id: Option<String>,
    pub operation_id: Option<String>,
    pub request_hash: Option<String>,
    pub input_summary: Option<String>,
    pub result_summary: Option<String>,
    pub workflow_id: Option<String>,
    pub workflow_name: Option<String>,
    pub root_task_id: Option<String>,
    pub parent_task_id: Option<String>,
    pub agent_role: Option<String>,
    pub step_key: Option<String>,
    pub priority: i64,
    pub concurrency_group: Option<String>,
    pub required_for_parent: bool,
    pub dependency_count: i64,
    pub completed_dependency_count: i64,
    pub child_count: i64,
    pub completed_child_count: i64,
    pub failed_child_count: i64,
    pub stale_child_count: i64,
    pub stale_reason: Option<String>,
    pub stale_source_task_id: Option<String>,
}

fn error_parts(raw: Option<&str>) -> (Option<String>, Option<String>) {
    let Some(raw) = raw.filter(|value| !value.trim().is_empty()) else {
        return (None, None);
    };
    if let Ok(value) = serde_json::from_str::<Value>(raw) {
        let code = value
            .get("code")
            .and_then(Value::as_str)
            .map(str::to_string);
        let message = value
            .get("message")
            .or_else(|| value.get("reason"))
            .and_then(Value::as_str)
            .map(str::to_string);
        if code.is_some() || message.is_some() {
            return (code, message);
        }
    }
    (None, Some(raw.to_string()))
}

fn derive_user_status(view: &AiTaskView) -> &'static str {
    if view.result_expired {
        return "expired";
    }
    match view.status.as_str() {
        "created" | "preparing_context" | "ready" | "queued" | "pending" => "preparing",
        "running" | "applying" | "cancel_requested" => "working",
        "validating" => "checking",
        "failed" => "failed",
        "cancelled" => "cancelled",
        "applied" => "completed",
        "completed" | "succeeded" => {
            if view.requires_review && view.target_link_count == 0 {
                "awaiting_confirmation"
            } else {
                "completed"
            }
        }
        _ => "preparing",
    }
}

pub fn refresh_user_status(view: &mut AiTaskView) {
    view.user_status = derive_user_status(view).to_string();
}

fn list_unified(connection: &Connection) -> Result<Vec<AiTaskView>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT
                t.task_id, t.task_type, t.status, t.novel_id, n.title,
                t.chapter_id, c.title, t.created_at, t.started_at, t.completed_at,
                t.error_json, t.trace_id, t.operation_id, t.request_hash,
                a.attempt_id, a.attempt_number, a.status, a.provider_id,
                a.response_metadata_json, a.error_json,
                r.artifact_id, r.artifact_type, r.processing_status, r.content_hash,
                r.content_length,
                (SELECT message FROM artifact_validation_issues i
                 WHERE i.artifact_id = r.artifact_id
                 ORDER BY CASE i.severity WHEN 'error' THEN 0 ELSE 1 END, i.created_at DESC
                 LIMIT 1),
                p.proposal_id, ap.plan_id, ap.status, ap.error_json,
                (SELECT COUNT(*) FROM artifact_target_links l WHERE l.artifact_id = r.artifact_id),
                t.progress_percent, t.progress_stage,
                t.workflow_id,t.workflow_name,t.root_task_id,t.parent_task_id,t.agent_role,t.step_key,
                t.priority,t.concurrency_group,t.required_for_parent,t.stale_at,t.stale_reason,t.stale_source_task_id,
                (SELECT triggered_at FROM ai_artifact_stale_events s WHERE s.artifact_id=r.artifact_id),
                (SELECT COUNT(*) FROM ai_task_dependencies d WHERE d.task_id=t.task_id),
                (SELECT COUNT(*) FROM ai_task_dependencies d JOIN ai_tasks u ON u.task_id=d.depends_on_task_id
                 WHERE d.task_id=t.task_id AND u.status IN ('completed','applied') AND u.stale_at IS NULL),
                (SELECT COUNT(*) FROM ai_tasks child WHERE child.parent_task_id=t.task_id),
                (SELECT COUNT(*) FROM ai_tasks child WHERE child.parent_task_id=t.task_id
                 AND child.status IN ('completed','applied') AND child.stale_at IS NULL),
                (SELECT COUNT(*) FROM ai_tasks child WHERE child.parent_task_id=t.task_id AND child.status='failed'),
                (SELECT COUNT(*) FROM ai_tasks child WHERE child.parent_task_id=t.task_id AND child.stale_at IS NOT NULL)
             FROM ai_tasks t
             LEFT JOIN novels n ON n.id = t.novel_id
             LEFT JOIN chapters c ON c.id = t.chapter_id
             LEFT JOIN ai_task_attempts a ON a.attempt_id = COALESCE(
                 t.current_attempt_id,
                 (SELECT attempt_id FROM ai_task_attempts ax
                  WHERE ax.task_id = t.task_id ORDER BY ax.attempt_number DESC LIMIT 1)
             )
             LEFT JOIN result_artifacts r ON r.artifact_id = COALESCE(
                 t.result_artifact_id,
                 (SELECT artifact_id FROM result_artifacts rx
                  WHERE rx.task_id = t.task_id ORDER BY rx.created_at DESC LIMIT 1)
             )
             LEFT JOIN artifact_placement_proposals p ON p.proposal_id = (
                 SELECT proposal_id FROM artifact_placement_proposals px
                 WHERE px.artifact_id = r.artifact_id ORDER BY px.created_at DESC LIMIT 1
             )
              LEFT JOIN artifact_apply_plans ap ON ap.plan_id = (
                 SELECT plan_id FROM artifact_apply_plans apx
                 WHERE apx.artifact_id = r.artifact_id ORDER BY apx.created_at DESC LIMIT 1
              )
              WHERE t.archived_at IS NULL
              ORDER BY t.created_at DESC",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map([], |row| {
            let task_error: Option<String> = row.get(10)?;
            let attempt_error: Option<String> = row.get(19)?;
            let plan_error: Option<String> = row.get(29)?;
            let (mut error_code, mut error_message) = error_parts(task_error.as_deref());
            if error_message.is_none() {
                (error_code, error_message) = error_parts(attempt_error.as_deref());
            }
            if error_message.is_none() {
                (error_code, error_message) = error_parts(plan_error.as_deref());
            }
            let task_type: String = row.get(1)?;
            let artifact_status: Option<String> = row.get(22)?;
            let link_count: i64 = row.get(30)?;
            let plan_status: Option<String> = row.get(28)?;
            let workflow_id: Option<String> = row.get(33)?;
            let step_key: Option<String> = row.get(38)?;
            let requires_review = task_type != "connection_test"
                && matches!(
                    artifact_status.as_deref(),
                    Some("valid" | "valid_with_warnings")
                )
                && link_count == 0
                && (workflow_id.is_none() || step_key.as_deref() == Some("workflow_root"));
            let result_expired = row.get::<_, Option<String>>(42)?.is_some()
                || row.get::<_, Option<String>>(45)?.is_some()
                || plan_status.as_deref() == Some("blocked")
                    && plan_error.as_deref().is_some_and(|value| {
                        value.contains("STALE") || value.contains("过期") || value.contains("变化")
                    });
            let mut view = AiTaskView {
                source: "unified".to_string(),
                id: row.get(0)?,
                task_type,
                status: row.get(2)?,
                user_status: String::new(),
                is_legacy: false,
                novel_id: row.get(3)?,
                novel_title: row.get(4)?,
                chapter_id: row.get(5)?,
                chapter_title: row.get(6)?,
                progress_percent: row.get(31)?,
                progress_stage: row.get(32)?,
                error_code,
                error_message,
                created_at: row.get(7)?,
                started_at: row.get(8)?,
                finished_at: row.get(9)?,
                latest_attempt_id: row.get(14)?,
                latest_attempt_number: row.get(15)?,
                latest_attempt_status: row.get(16)?,
                provider_id: row.get(17)?,
                response_metadata_json: row.get(18)?,
                artifact_id: row.get(20)?,
                artifact_type: row.get(21)?,
                artifact_status,
                artifact_content_hash: row.get(23)?,
                artifact_content_length: row.get(24)?,
                artifact_issue: row.get(25)?,
                proposal_id: row.get(26)?,
                apply_plan_id: row.get(27)?,
                apply_plan_status: plan_status,
                target_link_count: link_count,
                requires_review,
                result_expired,
                trace_id: row.get(11)?,
                operation_id: row.get(12)?,
                request_hash: row.get(13)?,
                input_summary: None,
                result_summary: None,
                workflow_id,
                workflow_name: row.get(34)?,
                root_task_id: row.get(35)?,
                parent_task_id: row.get(36)?,
                agent_role: row.get(37)?,
                step_key,
                priority: row.get(39)?,
                concurrency_group: row.get(40)?,
                required_for_parent: row.get::<_, i64>(41)? != 0,
                dependency_count: row.get(46)?,
                completed_dependency_count: row.get(47)?,
                child_count: row.get(48)?,
                completed_child_count: row.get(49)?,
                failed_child_count: row.get(50)?,
                stale_child_count: row.get(51)?,
                stale_reason: row.get(43)?,
                stale_source_task_id: row.get(44)?,
            };
            refresh_user_status(&mut view);
            Ok(view)
        })
        .map_err(AppError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

fn list_legacy_tasks(connection: &Connection) -> Result<Vec<AiTaskView>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT r.id, r.task_type, r.status, r.novel_id, n.title, r.chapter_id, c.title,
                r.provider, r.model_name, r.input_summary, r.result_text, r.error_message,
                r.created_at, r.started_at, r.finished_at
         FROM ai_task_records r
         LEFT JOIN novels n ON n.id = r.novel_id
         LEFT JOIN chapters c ON c.id = r.chapter_id
         ORDER BY r.created_at DESC",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map([], |row| {
            let status: String = row.get(2)?;
            let mut view = AiTaskView {
                source: "legacy_task".into(),
                id: row.get(0)?,
                task_type: row.get(1)?,
                status,
                user_status: String::new(),
                is_legacy: true,
                novel_id: row.get(3)?,
                novel_title: row.get(4)?,
                chapter_id: row.get(5)?,
                chapter_title: row.get(6)?,
                progress_percent: None,
                progress_stage: None,
                error_code: None,
                error_message: row.get(11)?,
                created_at: row.get(12)?,
                started_at: row.get(13)?,
                finished_at: row.get(14)?,
                latest_attempt_id: None,
                latest_attempt_number: None,
                latest_attempt_status: None,
                provider_id: row.get::<_, Option<String>>(7)?.or(row.get(8)?),
                response_metadata_json: None,
                artifact_id: None,
                artifact_type: None,
                artifact_status: None,
                artifact_content_hash: None,
                artifact_content_length: None,
                artifact_issue: None,
                proposal_id: None,
                apply_plan_id: None,
                apply_plan_status: None,
                target_link_count: 0,
                requires_review: false,
                result_expired: false,
                trace_id: None,
                operation_id: None,
                request_hash: None,
                input_summary: row.get(9)?,
                result_summary: row.get(10)?,
                workflow_id: None,
                workflow_name: None,
                root_task_id: None,
                parent_task_id: None,
                agent_role: None,
                step_key: None,
                priority: 0,
                concurrency_group: None,
                required_for_parent: false,
                dependency_count: 0,
                completed_dependency_count: 0,
                child_count: 0,
                completed_child_count: 0,
                failed_child_count: 0,
                stale_child_count: 0,
                stale_reason: None,
                stale_source_task_id: None,
            };
            refresh_user_status(&mut view);
            Ok(view)
        })
        .map_err(AppError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

fn list_generation_jobs(connection: &Connection) -> Result<Vec<AiTaskView>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT g.id, g.job_type, g.status, g.novel_id, n.title, g.chapter_id, c.title,
                g.progress_percent, g.current_step, g.provider, g.model_name,
                g.error_code, g.error_message, g.created_at, g.started_at, g.finished_at
         FROM generation_jobs g
         LEFT JOIN novels n ON n.id = g.novel_id
         LEFT JOIN chapters c ON c.id = g.chapter_id
         ORDER BY g.created_at DESC",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map([], |row| {
            let status: String = row.get(2)?;
            let mut view = AiTaskView {
                source: "legacy_generation".into(),
                id: row.get(0)?,
                task_type: row.get(1)?,
                status,
                user_status: String::new(),
                is_legacy: true,
                novel_id: row.get(3)?,
                novel_title: row.get(4)?,
                chapter_id: row.get(5)?,
                chapter_title: row.get(6)?,
                progress_percent: row.get(7)?,
                progress_stage: row.get(8)?,
                error_code: row.get(11)?,
                error_message: row.get(12)?,
                created_at: row.get(13)?,
                started_at: row.get(14)?,
                finished_at: row.get(15)?,
                latest_attempt_id: None,
                latest_attempt_number: None,
                latest_attempt_status: None,
                provider_id: row.get::<_, Option<String>>(9)?.or(row.get(10)?),
                response_metadata_json: None,
                artifact_id: None,
                artifact_type: None,
                artifact_status: None,
                artifact_content_hash: None,
                artifact_content_length: None,
                artifact_issue: None,
                proposal_id: None,
                apply_plan_id: None,
                apply_plan_status: None,
                target_link_count: 0,
                requires_review: false,
                result_expired: false,
                trace_id: None,
                operation_id: None,
                request_hash: None,
                input_summary: None,
                result_summary: None,
                workflow_id: None,
                workflow_name: None,
                root_task_id: None,
                parent_task_id: None,
                agent_role: None,
                step_key: None,
                priority: 0,
                concurrency_group: None,
                required_for_parent: false,
                dependency_count: 0,
                completed_dependency_count: 0,
                child_count: 0,
                completed_child_count: 0,
                failed_child_count: 0,
                stale_child_count: 0,
                stale_reason: None,
                stale_source_task_id: None,
            };
            refresh_user_status(&mut view);
            Ok(view)
        })
        .map_err(AppError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

pub fn list(connection: &Connection) -> Result<Vec<AiTaskView>, AppError> {
    let mut combined = Vec::new();
    let mut seen = HashSet::new();
    for view in list_unified(connection)?
        .into_iter()
        .chain(list_legacy_tasks(connection)?)
        .chain(list_generation_jobs(connection)?)
    {
        if seen.insert(view.id.clone()) {
            combined.push(view);
        }
    }
    combined.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(combined)
}

fn terminal_status(status: &str) -> bool {
    matches!(
        status,
        "completed" | "applied" | "failed" | "cancelled" | "succeeded" | "interrupted" | "stale"
    )
}

pub fn archive_unified(connection: &mut Connection, task_id: &str) -> Result<usize, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let task = transaction
        .query_row(
            "SELECT workflow_id,status,archived_at FROM ai_tasks WHERE task_id=?1",
            params![task_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| {
            AppError::new(
                crate::errors::codes::AI_TASK_NOT_FOUND,
                "AI 任务记录不存在",
                false,
            )
        })?;
    if task.2.is_some() {
        transaction.commit().map_err(AppError::database)?;
        return Ok(0);
    }
    let active_count: i64 = if let Some(workflow_id) = task.0.as_deref() {
        transaction
            .query_row(
                 "SELECT COUNT(*) FROM ai_tasks WHERE workflow_id=?1 AND archived_at IS NULL
                 AND status NOT IN ('completed','applied','failed','cancelled','succeeded','interrupted','stale')",
                params![workflow_id],
                |row| row.get(0),
            )
            .map_err(AppError::database)?
    } else if terminal_status(&task.1) {
        0
    } else {
        1
    };
    if active_count > 0 {
        return Err(AppError::new(
            crate::errors::codes::AI_TASK_TERMINAL_STATE,
            "任务仍在运行，请先取消或等待完成后再删除记录",
            false,
        ));
    }
    let archived_at = chrono::Utc::now().to_rfc3339();
    let changed = if let Some(workflow_id) = task.0 {
        transaction
            .execute(
                "UPDATE ai_tasks SET archived_at=?1 WHERE workflow_id=?2 AND archived_at IS NULL",
                params![archived_at, workflow_id],
            )
            .map_err(AppError::database)?
    } else {
        transaction
            .execute(
                "UPDATE ai_tasks SET archived_at=?1 WHERE task_id=?2 AND archived_at IS NULL",
                params![archived_at, task_id],
            )
            .map_err(AppError::database)?
    };
    transaction.commit().map_err(AppError::database)?;
    Ok(changed)
}

pub fn delete_legacy_generation(
    connection: &mut Connection,
    job_id: &str,
) -> Result<usize, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let status = transaction
        .query_row(
            "SELECT status FROM generation_jobs WHERE id=?1",
            params![job_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| {
            AppError::new(
                crate::errors::codes::AI_TASK_NOT_FOUND,
                "历史生成记录不存在",
                false,
            )
        })?;
    if !terminal_status(&status) {
        return Err(AppError::new(
            crate::errors::codes::AI_TASK_TERMINAL_STATE,
            "生成任务仍在运行，请先取消后再删除记录",
            false,
        ));
    }
    transaction
        .execute(
            "DELETE FROM generation_step_results WHERE job_id=?1",
            params![job_id],
        )
        .map_err(AppError::database)?;
    let changed = transaction
        .execute("DELETE FROM generation_jobs WHERE id=?1", params![job_id])
        .map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;
    use crate::repositories::large_text_repository;

    fn initialize(connection: &mut Connection) -> Result<(), Box<dyn std::error::Error>> {
        connection.execute_batch(
            "CREATE TABLE novels (id TEXT PRIMARY KEY,title TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
             CREATE TABLE chapters (id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,title TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
             CREATE TABLE chapter_drafts (id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,chapter_id TEXT NOT NULL,content TEXT NOT NULL,version_no INTEGER NOT NULL,large_text_ref_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
             CREATE TABLE ai_task_records (
                id TEXT PRIMARY KEY,novel_id TEXT,chapter_id TEXT,task_type TEXT NOT NULL,status TEXT NOT NULL,
                runtime_mode TEXT,provider TEXT,model_name TEXT,prompt_template_id TEXT,input_summary TEXT,
                prompt_snapshot TEXT,result_text TEXT,result_json TEXT,error_message TEXT,token_input INTEGER,
                token_output INTEGER,token_total INTEGER,duration_ms INTEGER,started_at TEXT,finished_at TEXT,created_at TEXT NOT NULL
             );
             CREATE TABLE generation_jobs (
                id TEXT PRIMARY KEY,world_id TEXT,novel_id TEXT,volume_id TEXT,chapter_id TEXT,job_type TEXT NOT NULL,
                status TEXT NOT NULL,current_step TEXT,progress_percent INTEGER,provider TEXT,model_name TEXT,
                input_token_estimate INTEGER,output_token_estimate INTEGER,actual_input_tokens INTEGER,
                actual_output_tokens INTEGER,cost_estimate REAL,error_code TEXT,error_message TEXT,retry_count INTEGER,
                created_at TEXT NOT NULL,started_at TEXT,finished_at TEXT
             );
             CREATE TABLE generation_step_results (
                id TEXT PRIMARY KEY,job_id TEXT NOT NULL,step_name TEXT,status TEXT,output_data TEXT,created_at TEXT
             );
             INSERT INTO novels VALUES ('novel-a','Novel','now','now',NULL);
             INSERT INTO chapters VALUES ('chapter-a','novel-a','Chapter','now','now',NULL);"
        )?;
        migrations::run_migrations(connection)?;
        Ok(())
    }

    fn setup() -> Result<Connection, Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        initialize(&mut connection)?;
        Ok(connection)
    }

    #[test]
    fn task_center01_unified_source_wins_exact_id_dedup() -> Result<(), Box<dyn std::error::Error>>
    {
        let connection = setup()?;
        connection.execute(
            "INSERT INTO ai_tasks(task_id,task_type,novel_id,chapter_id,scope_type,status,trace_id,operation_id,request_hash,created_at)
             VALUES ('same','connection_test','novel-a','chapter-a','system','completed','trace','op','hash','2026-01-03')",
            [],
        )?;
        connection.execute(
            "INSERT INTO ai_task_records(id,novel_id,chapter_id,task_type,status,created_at)
             VALUES ('same','novel-a','chapter-a','quality_check','failed','2026-01-02')",
            [],
        )?;
        connection.execute(
            "INSERT INTO generation_jobs(id,novel_id,chapter_id,job_type,status,created_at)
             VALUES ('job-a','novel-a','chapter-a','chapter_generation','completed','2026-01-01')",
            [],
        )?;
        let items = list(&connection)?;
        assert_eq!(items.len(), 2);
        assert_eq!(
            items.iter().find(|item| item.id == "same").unwrap().source,
            "unified"
        );
        assert!(
            items
                .iter()
                .find(|item| item.id == "job-a")
                .unwrap()
                .is_legacy
        );
        Ok(())
    }

    #[test]
    fn task_center02_completed_candidate_waits_for_review() -> Result<(), Box<dyn std::error::Error>>
    {
        let connection = setup()?;
        connection.execute(
            "INSERT INTO ai_tasks(task_id,task_type,novel_id,chapter_id,draft_id,scope_type,status,trace_id,operation_id,request_hash,created_at,completed_at)
             VALUES ('task-a','quality_check','novel-a','chapter-a','draft-a','draft','completed','trace','op','hash','2026-01-03','2026-01-03')",
            [],
        )?;
        connection.execute(
            "INSERT INTO ai_task_attempts(attempt_id,task_id,attempt_number,status,started_at,finished_at)
             VALUES ('attempt-a','task-a',1,'succeeded','now','now')",
            [],
        )?;
        large_text_repository::insert_document_for_target(
            &connection,
            "doc-a",
            "result_artifact",
            "artifact-a",
            "raw_content",
            None,
            "{}",
            &large_text_repository::sha256("{}"),
            "now",
        )?;
        connection.execute(
            "INSERT INTO result_artifacts(artifact_id,task_id,attempt_id,artifact_type,schema_version,raw_content_ref_id,
             source_novel_id,source_chapter_id,source_draft_id,source_draft_version,source_base_content_hash,
             content_hash,content_length,processing_status,created_at)
             VALUES ('artifact-a','task-a','attempt-a','quality_report',1,'doc-a','novel-a','chapter-a','draft-a',1,
             'base','content',2,'valid','now')",
            [],
        )?;
        connection.execute("UPDATE ai_tasks SET current_attempt_id='attempt-a',result_artifact_id='artifact-a' WHERE task_id='task-a'", [])?;
        let item = list(&connection)?
            .into_iter()
            .find(|item| item.id == "task-a")
            .unwrap();
        assert_eq!(item.user_status, "awaiting_confirmation");
        assert_eq!(item.latest_attempt_number, Some(1));
        assert_eq!(item.artifact_id.as_deref(), Some("artifact-a"));
        Ok(())
    }

    #[test]
    fn task_center03_query_failure_is_an_error_not_empty() -> Result<(), Box<dyn std::error::Error>>
    {
        let connection = Connection::open_in_memory()?;
        assert!(list(&connection).is_err());
        Ok(())
    }

    #[test]
    fn task_center04_reopens_sqlite_and_restores_persisted_task(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!(
            "ai-novel-studio-task-center-{}.db",
            uuid::Uuid::new_v4()
        ));
        {
            let mut connection = Connection::open(&path)?;
            initialize(&mut connection)?;
            connection.execute(
                "INSERT INTO ai_tasks(task_id,task_type,novel_id,chapter_id,scope_type,status,trace_id,operation_id,request_hash,created_at)
                 VALUES ('persisted','quality_check','novel-a','chapter-a','chapter','queued','trace','op','hash','2026-01-03')",
                [],
            )?;
        }

        let reopened = Connection::open(&path)?;
        let items = list(&reopened)?;
        drop(reopened);
        std::fs::remove_file(&path)?;
        let item = items
            .iter()
            .find(|item| item.id == "persisted")
            .expect("persisted task");
        assert_eq!(item.source, "unified");
        assert_eq!(item.user_status, "preparing");
        Ok(())
    }

    #[test]
    fn task_center05_archive_hides_terminal_task_but_keeps_audit_row(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        connection.execute(
            "INSERT INTO ai_tasks(task_id,task_type,novel_id,chapter_id,scope_type,status,trace_id,operation_id,request_hash,created_at)
             VALUES ('archive-me','quality_check','novel-a','chapter-a','chapter','completed','trace','op','hash','2026-01-03')",
            [],
        )?;

        assert_eq!(archive_unified(&mut connection, "archive-me")?, 1);
        assert!(!list(&connection)?
            .iter()
            .any(|item| item.id == "archive-me"));
        let archived_at: Option<String> = connection.query_row(
            "SELECT archived_at FROM ai_tasks WHERE task_id='archive-me'",
            [],
            |row| row.get(0),
        )?;
        assert!(archived_at.is_some());
        assert_eq!(archive_unified(&mut connection, "archive-me")?, 0);
        Ok(())
    }

    #[test]
    fn task_center06_active_task_cannot_be_archived() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        connection.execute(
            "INSERT INTO ai_tasks(task_id,task_type,novel_id,chapter_id,scope_type,status,trace_id,operation_id,request_hash,created_at)
             VALUES ('still-running','quality_check','novel-a','chapter-a','chapter','running','trace','op','hash','2026-01-03')",
            [],
        )?;

        assert!(archive_unified(&mut connection, "still-running").is_err());
        assert!(list(&connection)?
            .iter()
            .any(|item| item.id == "still-running"));
        Ok(())
    }

    #[test]
    fn task_center07_archiving_workflow_hides_all_nodes() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = setup()?;
        connection.execute(
            "INSERT INTO ai_tasks(task_id,task_type,novel_id,scope_type,status,trace_id,operation_id,request_hash,workflow_id,root_task_id,created_at)
             VALUES ('workflow-root','workflow','novel-a','novel','completed','trace-root','op-root','hash-root','workflow-a','workflow-root','2026-01-03')",
            [],
        )?;
        connection.execute(
            "INSERT INTO ai_tasks(task_id,task_type,novel_id,chapter_id,scope_type,status,trace_id,operation_id,request_hash,workflow_id,root_task_id,parent_task_id,created_at)
             VALUES ('workflow-child','quality_check','novel-a','chapter-a','chapter','completed','trace-child','op-child','hash-child','workflow-a','workflow-root','workflow-root','2026-01-03')",
            [],
        )?;

        assert_eq!(archive_unified(&mut connection, "workflow-root")?, 2);
        let visible = list(&connection)?;
        assert!(!visible
            .iter()
            .any(|item| item.workflow_id.as_deref() == Some("workflow-a")));
        let archived_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM ai_tasks WHERE workflow_id='workflow-a' AND archived_at IS NOT NULL",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(archived_count, 2);
        Ok(())
    }

    #[test]
    fn task_center08_deletes_terminal_legacy_generation_and_steps(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        connection.execute(
            "INSERT INTO generation_jobs(id,novel_id,chapter_id,job_type,status,created_at)
             VALUES ('legacy-delete','novel-a','chapter-a','chapter_generation','completed','2026-01-01')",
            [],
        )?;
        connection.execute(
            "INSERT INTO generation_step_results(id,job_id,step_name,status,created_at)
             VALUES ('legacy-step','legacy-delete','generate','completed','2026-01-01')",
            [],
        )?;

        assert_eq!(
            delete_legacy_generation(&mut connection, "legacy-delete")?,
            1
        );
        let job_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM generation_jobs WHERE id='legacy-delete'",
            [],
            |row| row.get(0),
        )?;
        let step_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM generation_step_results WHERE job_id='legacy-delete'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!((job_count, step_count), (0, 0));
        Ok(())
    }
}
