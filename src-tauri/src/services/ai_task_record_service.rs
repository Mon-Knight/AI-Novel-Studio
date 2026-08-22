use crate::db::get_database_path;
use crate::domain::ai::{
    AiTaskRecordDto, AiTaskRecordsDebugState, CreateAiTaskRecordInput, DeleteAiTaskRecordsResult,
    MarkAiTaskSucceededInput,
};
use crate::errors::{log_workspace_event, WorkspaceLogEvent};
use crate::repositories::ai_task_record_repository;
use rusqlite::{params, Connection};
use std::collections::HashMap;

const AI_TASK_TYPE_FILTERS: &[&str] = &[
    "connection_test",
    "setting_expand",
    "setting_suggestion_generate",
    "outline_generate",
    "volume_outline_generate",
    "context_summarize",
    "setting_structure",
    "rule_structure",
    "protagonist_structure",
    "volume_outline_expand",
    "chapter_outline_generate",
    "style_analyze",
    "character_generate",
    "event_suggest",
    "chapter_generate",
    "chapter_beat_repair",
    "chapter_scene_generate",
    "chapter_scene_plan_generate",
    "chapter_rewrite",
    "chapter_polish",
    "quality_check",
    "quality_fix",
    "multi_agent_review",
    "multi_agent_revision",
    "autonomous_plot_plan",
    "autonomous_character_evolution",
    "autonomous_world_build",
    "autonomous_conflict_generate",
    "autonomous_pacing_control",
    "autonomous_chapter_batch",
    "chapter_summarize",
    "context_update",
];
const AI_TASK_STATUS_FILTERS: &[&str] = &["pending", "running", "succeeded", "failed", "cancelled"];

pub fn normalize_ai_task_filter(
    value: Option<String>,
    allowed: &[&str],
    label: &str,
) -> Result<Option<String>, String> {
    let value = value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty());
    if let Some(candidate) = value.as_deref() {
        if !allowed.contains(&candidate) {
            return Err(format!("invalid AI task {} filter", label));
        }
    }
    Ok(value)
}

pub fn normalize_ai_task_type_filter(value: Option<String>) -> Result<Option<String>, String> {
    normalize_ai_task_filter(value, AI_TASK_TYPE_FILTERS, "type")
}

pub fn normalize_ai_task_status_filter(value: Option<String>) -> Result<Option<String>, String> {
    normalize_ai_task_filter(value, AI_TASK_STATUS_FILTERS, "status")
}

pub fn normalize_ai_task_ids(ids: Vec<String>) -> Vec<String> {
    let mut ids = ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    ids
}

pub fn validate_mark_ai_task_succeeded_input(
    input: &MarkAiTaskSucceededInput,
) -> Result<(), String> {
    for (field, value) in [
        ("tokenInput", input.token_input),
        ("tokenOutput", input.token_output),
        ("tokenTotal", input.token_total),
        ("durationMs", input.duration_ms),
    ] {
        if value.is_some_and(|number| number < 0) {
            return Err(format!("{field} must be non-negative"));
        }
    }
    Ok(())
}

pub fn validate_ai_task_pricing(input: &CreateAiTaskRecordInput) -> Result<(), String> {
    const MAX_PRICE_PER_MILLION: f64 = 1_000_000.0;
    let valid_price = |value: Option<f64>| {
        value
            .is_none_or(|price| price.is_finite() && (0.0..=MAX_PRICE_PER_MILLION).contains(&price))
    };
    if !valid_price(input.input_price_per_million_tokens)
        || !valid_price(input.output_price_per_million_tokens)
    {
        return Err("AI task pricing must be finite and non-negative".to_string());
    }

    match input.pricing_source.as_deref() {
        None => {
            if input.input_price_per_million_tokens.is_some()
                || input.output_price_per_million_tokens.is_some()
                || input.cost_currency.is_some()
            {
                return Err(
                    "AI task pricing source is required when pricing is present".to_string()
                );
            }
        }
        Some("mock") => {
            if input.input_price_per_million_tokens != Some(0.0)
                || input.output_price_per_million_tokens != Some(0.0)
                || input.cost_currency.as_deref() != Some("USD")
            {
                return Err("Mock AI task pricing must be zero USD".to_string());
            }
        }
        Some("user_configured") => {
            if input.input_price_per_million_tokens.is_none()
                || input.output_price_per_million_tokens.is_none()
                || input.cost_currency.as_deref() != Some("USD")
            {
                return Err("Configured AI task pricing requires both USD token rates".to_string());
            }
        }
        Some("unconfigured") => {
            if input.input_price_per_million_tokens.is_some()
                || input.output_price_per_million_tokens.is_some()
                || input.cost_currency.as_deref() != Some("USD")
            {
                return Err("Unconfigured AI task pricing cannot contain token rates".to_string());
            }
        }
        Some(_) => return Err("Unsupported AI task pricing source".to_string()),
    }
    Ok(())
}

pub fn validate_ai_task_projection_identity(
    existing: &AiTaskRecordDto,
    input: &CreateAiTaskRecordInput,
) -> Result<(), String> {
    if existing.task_type != input.task_type
        || existing.novel_id != input.novel_id
        || existing.chapter_id != input.chapter_id
        || existing.runtime_mode != input.runtime_mode
        || existing.provider != input.provider
        || existing.model_name != input.model_name
    {
        return Err("ai_task_projection_identity_conflict".to_string());
    }
    Ok(())
}

pub fn ensure_ai_task_records_table(conn: &Connection, db_path: &str) -> Result<(), String> {
    let table_exists = ai_task_record_repository::ai_task_records_table_exists(conn)?;
    if !table_exists {
        return Err(format!(
            "ai_task_records table does not exist. db_path={}",
            db_path
        ));
    }
    Ok(())
}

pub fn ensure_ai_tasks_are_not_bound_to_completed_quality_reports(
    conn: &Connection,
    ids: Option<&[String]>,
) -> Result<(), String> {
    let protected_count = if let Some(ids) = ids {
        let mut count = 0_i64;
        for id in ids {
            count += conn
                .query_row(
                    "SELECT COUNT(*) FROM quality_check_reports
                     WHERE status = 'completed' AND ai_task_id = ?1",
                    params![id],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|error| error.to_string())?;
        }
        count
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM quality_check_reports
             WHERE status = 'completed' AND ai_task_id IS NOT NULL",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?
    };

    if protected_count > 0 {
        return Err("quality_check_ai_task_delete_protected".to_string());
    }
    Ok(())
}

pub fn ensure_ai_tasks_are_terminal(
    conn: &Connection,
    ids: Option<&[String]>,
) -> Result<(), String> {
    let active_count = if let Some(ids) = ids {
        let mut count = 0_i64;
        for id in ids {
            count += conn
                .query_row(
                    "SELECT COUNT(*) FROM ai_task_records
                     WHERE id = ?1 AND status IN ('pending', 'running')",
                    params![id],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|error| error.to_string())?;
        }
        count
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM ai_task_records WHERE status IN ('pending', 'running')",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?
    };
    if active_count > 0 {
        return Err("ai_task_running_delete_protected".to_string());
    }
    Ok(())
}

pub fn create_ai_task_record(
    conn: &Connection,
    input: &CreateAiTaskRecordInput,
) -> Result<AiTaskRecordDto, String> {
    validate_ai_task_pricing(input)?;
    let id = input.id.clone();
    let existing_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ai_task_records WHERE id = ?1",
            params![&input.id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if existing_count > 0 {
        let existing = ai_task_record_repository::find_ai_task_record_by_id(conn, &id)?;
        validate_ai_task_projection_identity(&existing, input)?;
        return Ok(existing);
    }
    ai_task_record_repository::insert_ai_task_record(conn, input)?;
    let created = ai_task_record_repository::find_ai_task_record_by_id(conn, &id)?;
    validate_ai_task_projection_identity(&created, input)?;
    Ok(created)
}

pub fn mark_ai_task_running_for_retry(
    conn: &Connection,
    id: &str,
    started_at: &str,
) -> Result<usize, String> {
    ai_task_record_repository::update_ai_task_running_for_retry(conn, id, started_at)
}

pub fn mark_ai_task_succeeded(
    conn: &Connection,
    id: &str,
    input: &MarkAiTaskSucceededInput,
) -> Result<usize, String> {
    validate_mark_ai_task_succeeded_input(input)?;
    ai_task_record_repository::update_ai_task_succeeded(conn, id, input)
}

pub fn mark_ai_task_failed(
    conn: &Connection,
    id: &str,
    error_message: &str,
    finished_at: &str,
    duration_ms: Option<i64>,
) -> Result<usize, String> {
    ai_task_record_repository::update_ai_task_failed(
        conn,
        id,
        error_message,
        finished_at,
        duration_ms,
    )
}

pub fn mark_ai_task_cancelled(
    conn: &Connection,
    id: &str,
    finished_at: &str,
    duration_ms: Option<i64>,
) -> Result<usize, String> {
    ai_task_record_repository::update_ai_task_cancelled(conn, id, finished_at, duration_ms)
}

pub fn get_ai_task_records(
    conn: &Connection,
    page: Option<i64>,
    size: Option<i64>,
    task_type: Option<String>,
    status: Option<String>,
) -> Result<Vec<AiTaskRecordDto>, String> {
    let page = page.unwrap_or(1).max(1);
    let size = size.unwrap_or(20).clamp(1, 500);
    let offset = (page - 1) * size;
    let task_type = normalize_ai_task_type_filter(task_type)?;
    let status = normalize_ai_task_status_filter(status)?;
    ai_task_record_repository::query_ai_task_records(
        conn,
        size,
        offset,
        task_type.as_deref(),
        status.as_deref(),
    )
}

pub fn count_ai_task_records(
    conn: &Connection,
    task_type: Option<String>,
    status: Option<String>,
) -> Result<i64, String> {
    let task_type = normalize_ai_task_type_filter(task_type)?;
    let status = normalize_ai_task_status_filter(status)?;
    ai_task_record_repository::count_ai_task_records(conn, task_type.as_deref(), status.as_deref())
}

pub fn get_ai_task_records_by_chapter_id(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<AiTaskRecordDto>, String> {
    ai_task_record_repository::find_ai_task_records_by_chapter(conn, chapter_id)
}

pub fn get_ai_task_records_by_novel_id(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<AiTaskRecordDto>, String> {
    ai_task_record_repository::find_ai_task_records_by_novel(conn, novel_id)
}

pub fn delete_ai_task_records_by_ids(
    conn: &Connection,
    ids: Vec<String>,
    db_path: String,
) -> Result<DeleteAiTaskRecordsResult, String> {
    let ids = normalize_ai_task_ids(ids);
    let requested_count = ids.len() as i64;
    let table_exists = ai_task_record_repository::ai_task_records_table_exists(conn)?;
    log_workspace_event(WorkspaceLogEvent {
        level: "info",
        event: "ai_task_delete_many_started",
        trace_id: None,
        operation_id: None,
        novel_id: None,
        chapter_id: None,
        draft_id: None,
        error_code: None,
        metadata: Some(serde_json::json!({
            "tableExists": table_exists,
            "requestedCount": requested_count,
        })),
    });
    ensure_ai_task_records_table(conn, &db_path)?;
    let before_count = ai_task_record_repository::count_total_ai_task_records(conn)?;

    if ids.is_empty() {
        log_workspace_event(WorkspaceLogEvent {
            level: "info",
            event: "ai_task_delete_many_empty",
            trace_id: None,
            operation_id: None,
            novel_id: None,
            chapter_id: None,
            draft_id: None,
            error_code: None,
            metadata: Some(serde_json::json!({ "beforeCount": before_count })),
        });
        return Ok(DeleteAiTaskRecordsResult {
            deleted_count: 0,
            requested_count,
            before_count,
            after_count: before_count,
            before_match_count: 0,
            after_match_count: 0,
            affected_rows: 0,
            db_path,
            deleted_child_rows: HashMap::new(),
        });
    }

    let before_match_count = ai_task_record_repository::count_ai_task_records_by_ids(conn, &ids)?;
    if before_match_count == 0 {
        let sample_ids = ai_task_record_repository::sample_ai_task_ids(conn, 5)?;
        log_workspace_event(WorkspaceLogEvent {
            level: "warn",
            event: "ai_task_delete_many_no_match",
            trace_id: None,
            operation_id: None,
            novel_id: None,
            chapter_id: None,
            draft_id: None,
            error_code: Some("AI_TASK_NOT_FOUND"),
            metadata: Some(serde_json::json!({
                "requestedCount": requested_count,
                "sampleCount": sample_ids.len(),
                "beforeCount": before_count,
            })),
        });
        return Err("No AI task records matched selected ids.".to_string());
    }
    ensure_ai_tasks_are_terminal(conn, Some(&ids))?;
    ensure_ai_tasks_are_not_bound_to_completed_quality_reports(conn, Some(&ids))?;

    let placeholders: Vec<String> = ids.iter().map(|_| "?".to_string()).collect();
    let placeholders_str = placeholders.join(",");

    conn.execute_batch("BEGIN TRANSACTION")
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    let mut deleted_child_rows: HashMap<String, i64> = HashMap::new();

    let child_tables: &[&str] = &[
        "chapter_drafts",
        "quality_check_reports",
        "polish_records",
        "chapter_events",
        "chapter_summaries",
    ];

    for table in child_tables {
        let sql = format!(
            "UPDATE {} SET ai_task_id = NULL WHERE ai_task_id IN ({})",
            table, placeholders_str
        );
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = ids
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        match conn.execute(&sql, rusqlite::params_from_iter(params_refs.iter())) {
            Ok(rows) => {
                if rows > 0 {
                    log_workspace_event(WorkspaceLogEvent {
                        level: "info",
                        event: "ai_task_delete_many_child_cleanup",
                        trace_id: None,
                        operation_id: None,
                        novel_id: None,
                        chapter_id: None,
                        draft_id: None,
                        error_code: None,
                        metadata: Some(serde_json::json!({ "table": table, "rows": rows })),
                    });
                    deleted_child_rows.insert(table.to_string(), rows as i64);
                }
            }
            Err(e) => {
                let msg = format!("Failed to clean child table {}: {}", table, e);
                log_workspace_event(WorkspaceLogEvent {
                    level: "error",
                    event: "ai_task_delete_many_child_cleanup_failed",
                    trace_id: None,
                    operation_id: None,
                    novel_id: None,
                    chapter_id: None,
                    draft_id: None,
                    error_code: Some("DATABASE_TRANSACTION_FAILED"),
                    metadata: Some(serde_json::json!({ "table": table })),
                });
                let _ = conn.execute_batch("ROLLBACK");
                return Err(msg);
            }
        }
    }

    let mut affected_rows = 0_i64;
    for id in &ids {
        match conn.execute("DELETE FROM ai_task_records WHERE id = ?1", params![id]) {
            Ok(rows) => affected_rows += rows as i64,
            Err(e) => {
                let msg = format!("Failed to delete ai_task_record: {}", e);
                log_workspace_event(WorkspaceLogEvent {
                    level: "error",
                    event: "ai_task_delete_many_parent_delete_failed",
                    trace_id: None,
                    operation_id: None,
                    novel_id: None,
                    chapter_id: None,
                    draft_id: None,
                    error_code: Some("DATABASE_TRANSACTION_FAILED"),
                    metadata: None,
                });
                let _ = conn.execute_batch("ROLLBACK");
                return Err(msg);
            }
        }
    }

    let after_match_count = ai_task_record_repository::count_ai_task_records_by_ids(conn, &ids)?;
    let after_count = ai_task_record_repository::count_total_ai_task_records(conn)?;
    let deleted_count = before_match_count - after_match_count;

    log_workspace_event(WorkspaceLogEvent {
        level: "info",
        event: "ai_task_delete_many_completed",
        trace_id: None,
        operation_id: None,
        novel_id: None,
        chapter_id: None,
        draft_id: None,
        error_code: None,
        metadata: Some(serde_json::json!({
            "beforeCount": before_count,
            "matchedCount": before_match_count,
            "affectedRows": affected_rows,
            "afterMatchCount": after_match_count,
            "afterCount": after_count,
            "deletedCount": deleted_count,
            "childTableCount": deleted_child_rows.len(),
        })),
    });

    if before_match_count > 0 && after_match_count > 0 {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(format!(
            "AI task records still exist after delete. after_match_count={}",
            after_match_count
        ));
    }

    conn.execute_batch("COMMIT")
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;

    Ok(DeleteAiTaskRecordsResult {
        deleted_count,
        requested_count,
        before_count,
        after_count,
        before_match_count,
        after_match_count,
        affected_rows,
        db_path,
        deleted_child_rows,
    })
}

pub fn clear_ai_task_records(
    conn: &Connection,
    db_path: String,
) -> Result<DeleteAiTaskRecordsResult, String> {
    let table_exists = ai_task_record_repository::ai_task_records_table_exists(conn)?;
    log_workspace_event(WorkspaceLogEvent {
        level: "info",
        event: "ai_task_clear_all_started",
        trace_id: None,
        operation_id: None,
        novel_id: None,
        chapter_id: None,
        draft_id: None,
        error_code: None,
        metadata: Some(serde_json::json!({ "tableExists": table_exists })),
    });
    ensure_ai_task_records_table(conn, &db_path)?;
    let before_count = ai_task_record_repository::count_total_ai_task_records(conn)?;
    ensure_ai_tasks_are_terminal(conn, None)?;
    ensure_ai_tasks_are_not_bound_to_completed_quality_reports(conn, None)?;

    conn.execute_batch("BEGIN TRANSACTION")
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    let mut deleted_child_rows: HashMap<String, i64> = HashMap::new();

    let child_tables: &[&str] = &[
        "chapter_drafts",
        "quality_check_reports",
        "polish_records",
        "chapter_events",
        "chapter_summaries",
    ];

    for table in child_tables {
        let sql = format!(
            "UPDATE {} SET ai_task_id = NULL WHERE ai_task_id IN (SELECT id FROM ai_task_records)",
            table
        );
        match conn.execute(&sql, []) {
            Ok(rows) => {
                if rows > 0 {
                    log_workspace_event(WorkspaceLogEvent {
                        level: "info",
                        event: "ai_task_clear_all_child_cleanup",
                        trace_id: None,
                        operation_id: None,
                        novel_id: None,
                        chapter_id: None,
                        draft_id: None,
                        error_code: None,
                        metadata: Some(serde_json::json!({ "table": table, "rows": rows })),
                    });
                    deleted_child_rows.insert(table.to_string(), rows as i64);
                }
            }
            Err(e) => {
                let msg = format!("Failed to clean child table {}: {}", table, e);
                log_workspace_event(WorkspaceLogEvent {
                    level: "error",
                    event: "ai_task_clear_all_child_cleanup_failed",
                    trace_id: None,
                    operation_id: None,
                    novel_id: None,
                    chapter_id: None,
                    draft_id: None,
                    error_code: Some("DATABASE_TRANSACTION_FAILED"),
                    metadata: Some(serde_json::json!({ "table": table })),
                });
                let _ = conn.execute_batch("ROLLBACK");
                return Err(msg);
            }
        }
    }

    let affected_rows = conn
        .execute("DELETE FROM ai_task_records", [])
        .map_err(|e| {
            let msg = format!("Failed to delete ai_task_records: {}", e);
            log_workspace_event(WorkspaceLogEvent {
                level: "error",
                event: "ai_task_clear_all_parent_delete_failed",
                trace_id: None,
                operation_id: None,
                novel_id: None,
                chapter_id: None,
                draft_id: None,
                error_code: Some("DATABASE_TRANSACTION_FAILED"),
                metadata: None,
            });
            let _ = conn.execute_batch("ROLLBACK");
            msg
        })? as i64;

    let after_count = ai_task_record_repository::count_total_ai_task_records(conn)?;
    let deleted_count = before_count - after_count;
    log_workspace_event(WorkspaceLogEvent {
        level: "info",
        event: "ai_task_clear_all_completed",
        trace_id: None,
        operation_id: None,
        novel_id: None,
        chapter_id: None,
        draft_id: None,
        error_code: None,
        metadata: Some(serde_json::json!({
            "beforeCount": before_count,
            "affectedRows": affected_rows,
            "afterCount": after_count,
            "deletedCount": deleted_count,
            "childTableCount": deleted_child_rows.len(),
        })),
    });

    if after_count != 0 {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(format!(
            "AI task records still exist after clear. after_count={}",
            after_count
        ));
    }

    conn.execute_batch("COMMIT")
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;

    Ok(DeleteAiTaskRecordsResult {
        deleted_count,
        requested_count: before_count,
        before_count,
        after_count,
        before_match_count: before_count,
        after_match_count: after_count,
        affected_rows,
        db_path,
        deleted_child_rows,
    })
}

pub fn get_ai_task_records_debug_state(
    conn: &Connection,
    ids: Option<Vec<String>>,
) -> Result<AiTaskRecordsDebugState, String> {
    let db_path = get_database_path().display().to_string();
    let normalized_ids = ids.map(normalize_ai_task_ids);
    let table_exists = ai_task_record_repository::ai_task_records_table_exists(conn)?;
    let matched_count = if table_exists {
        match &normalized_ids {
            Some(ids) if !ids.is_empty() => Some(
                ai_task_record_repository::count_ai_task_records_by_ids(conn, ids)?,
            ),
            Some(_) => Some(0),
            None => None,
        }
    } else {
        normalized_ids.as_ref().map(|_| 0)
    };
    let total_count = if table_exists {
        ai_task_record_repository::count_total_ai_task_records(conn)?
    } else {
        0
    };
    let sample_ids = if table_exists {
        ai_task_record_repository::sample_ai_task_ids(conn, 10)?
    } else {
        Vec::new()
    };
    Ok(AiTaskRecordsDebugState {
        db_path,
        table_exists,
        total_count,
        matched_count,
        sample_ids,
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
        conn
    }

    #[test]
    fn test_ai_task_record_lifecycle_and_pricing() {
        let conn = setup_test_db();
        let task_id = uuid::Uuid::new_v4().to_string();
        let created = create_ai_task_record(
            &conn,
            &CreateAiTaskRecordInput {
                id: task_id.clone(),
                novel_id: Some("11111111-1111-1111-1111-111111111111".to_string()),
                chapter_id: None,
                task_type: "chapter_generate".to_string(),
                status: "pending".to_string(),
                runtime_mode: Some("standard".to_string()),
                provider: Some("deepseek".to_string()),
                model_name: Some("deepseek-chat".to_string()),
                input_price_per_million_tokens: Some(0.14),
                output_price_per_million_tokens: Some(0.28),
                cost_currency: Some("USD".to_string()),
                pricing_source: Some("user_configured".to_string()),
                input_summary: Some("生成第一章".to_string()),
                started_at: None,
                created_at: "2026-01-01T00:00:00Z".to_string(),
            },
        )
        .unwrap();

        assert_eq!(created.status, "pending");
        assert_eq!(created.task_type, "chapter_generate");

        mark_ai_task_succeeded(
            &conn,
            &task_id,
            &MarkAiTaskSucceededInput {
                result_text: Some("已完成章节生成".to_string()),
                prompt_snapshot: None,
                result_json: None,
                token_input: Some(1000),
                token_output: Some(2000),
                token_total: Some(3000),
                duration_ms: Some(1500),
                finished_at: "2026-01-01T00:01:00Z".to_string(),
            },
        )
        .unwrap();

        let list = get_ai_task_records(
            &conn,
            Some(1),
            Some(10),
            Some("chapter_generate".to_string()),
            Some("succeeded".to_string()),
        )
        .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].cost_status.as_deref(), Some("complete"));

        let delete_res =
            delete_ai_task_records_by_ids(&conn, vec![task_id.clone()], "test.db".to_string())
                .unwrap();
        assert_eq!(delete_res.deleted_count, 1);
    }
}
