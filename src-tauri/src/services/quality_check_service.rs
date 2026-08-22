use crate::domain::ai::{
    CreateQualityReportInput, GetQualityCheckIssuesResult, QualityCheckItemDto,
    QualityCheckReportDto, QualityCheckStatisticsDto, QualityFixRunDto, SaveContextReadLogInput,
    SaveQualityCheckResultInput, SaveQualityFixRunInput,
};
use crate::repositories::quality_check_repository::{
    self, find_latest_completed_quality_report, find_quality_report_by_id, load_quality_items,
    map_fix_run_row, map_quality_item_row, map_quality_report_row, QUALITY_FIX_RUN_SELECT,
    QUALITY_REPORT_SELECT, QUALITY_WORKFLOW_ITEM_SELECT,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::collections::HashSet;

pub fn compute_statistics(items: &[QualityCheckItemDto]) -> QualityCheckStatisticsDto {
    let total = items.len() as i64;
    let pending = items.iter().filter(|i| i.status == "pending").count() as i64;
    let resolved = items.iter().filter(|i| i.status == "resolved").count() as i64;
    let ignored = items.iter().filter(|i| i.status == "ignored").count() as i64;
    let critical = items.iter().filter(|i| i.severity == "critical").count() as i64;
    let high = items.iter().filter(|i| i.severity == "high").count() as i64;
    let medium = items.iter().filter(|i| i.severity == "medium").count() as i64;
    let low = items.iter().filter(|i| i.severity == "low").count() as i64;

    QualityCheckStatisticsDto {
        total,
        pending,
        resolved,
        ignored,
        critical,
        high,
        medium,
        low,
    }
}

pub fn validate_quality_issue_status(status: &str) -> Result<(), String> {
    if matches!(status, "pending" | "resolved" | "ignored") {
        Ok(())
    } else {
        Err("quality_issue_status_invalid".to_string())
    }
}

pub fn upsert_quality_issue_state(
    conn: &Connection,
    chapter_id: &str,
    issue_key: &str,
    status: &str,
    resolution_note: Option<&str>,
    resolved_at: Option<&str>,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO quality_issue_states
            (id, chapter_id, issue_key, status, resolution_note, resolved_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(chapter_id, issue_key) DO UPDATE SET
            status = excluded.status,
            resolution_note = excluded.resolution_note,
            resolved_at = excluded.resolved_at,
            updated_at = excluded.updated_at",
        params![
            uuid::Uuid::new_v4().to_string(),
            chapter_id,
            issue_key,
            status,
            resolution_note,
            resolved_at,
            now,
        ],
    )
    .map_err(|error| format!("quality_issue_state_write_failed: {error}"))?;
    Ok(())
}

pub fn get_mutable_quality_issue_identity(
    conn: &Connection,
    issue_id: &str,
) -> Result<(String, String), String> {
    let identity = conn
        .query_row(
            "SELECT item.report_id, item.chapter_id, item.issue_key,
                    (SELECT report.id
                     FROM quality_check_reports AS report
                     WHERE report.chapter_id = item.chapter_id AND report.status = 'completed'
                     ORDER BY report.created_at DESC, report.id DESC
                     LIMIT 1)
             FROM quality_check_items AS item
             WHERE item.id = ?1",
            params![issue_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("quality_issue_identity_read_failed: {error}"))?
        .ok_or_else(|| "quality_issue_not_found".to_string())?;
    if identity.3.as_deref() != Some(identity.0.as_str()) {
        return Err("quality_issue_history_read_only".to_string());
    }
    Ok((identity.1, identity.2))
}

pub fn has_newer_completed_quality_report(
    conn: &Connection,
    chapter_id: &str,
    created_at: &str,
    report_id: &str,
) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM quality_check_reports
            WHERE chapter_id = ?1 AND status = 'completed'
              AND (created_at > ?2 OR (created_at = ?2 AND id > ?3))
         )",
        params![chapter_id, created_at, report_id],
        |row| row.get(0),
    )
    .map_err(|error| format!("quality_latest_report_identity_read_failed: {error}"))
}

pub fn create_quality_check_report(
    conn: &Connection,
    input: CreateQualityReportInput,
) -> Result<QualityCheckReportDto, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let scope = input.scope.unwrap_or_else(|| "current_draft".to_string());
    if !matches!(scope.as_str(), "current_draft" | "adopted_draft") {
        return Err("quality_check_scope_invalid".to_string());
    }
    let draft_target = conn
        .query_row(
            "SELECT novel_id, chapter_id FROM chapter_drafts WHERE id = ?1",
            params![&input.draft_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| format!("quality_check_draft_read_failed: {error}"))?
        .ok_or_else(|| "quality_check_draft_missing".to_string())?;
    if draft_target.0 != input.novel_id || draft_target.1 != input.chapter_id {
        return Err("quality_check_draft_ownership_mismatch".to_string());
    }
    conn.execute(
        "INSERT INTO quality_check_reports (id, novel_id, chapter_id, draft_id, scope, status, content_hash, content_length, checked_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8, ?9, ?9)",
        params![
            &id,
            &input.novel_id,
            &input.chapter_id,
            &input.draft_id,
            &scope,
            &input.content_hash,
            &input.content_length,
            &input.checked_at,
            &now,
        ],
    )
    .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!("{} WHERE id = ?1", QUALITY_REPORT_SELECT))
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![&id], map_quality_report_row)
        .map_err(|e| e.to_string())
}

pub fn get_quality_check_issues(
    conn: &Connection,
    chapter_id: &str,
) -> Result<GetQualityCheckIssuesResult, String> {
    let report = find_latest_completed_quality_report(conn, chapter_id)?;
    let items = match report.as_ref() {
        Some(report) => load_quality_items(conn, &report.id, true)?,
        None => Vec::new(),
    };
    let statistics = compute_statistics(&items);
    Ok(GetQualityCheckIssuesResult {
        report,
        items,
        statistics,
    })
}

pub fn list_quality_check_reports(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<QualityCheckReportDto>, String> {
    quality_check_repository::list_completed_quality_reports_by_chapter(conn, chapter_id)
}

pub fn get_quality_check_report_snapshot(
    conn: &Connection,
    report_id: &str,
) -> Result<GetQualityCheckIssuesResult, String> {
    let report = find_quality_report_by_id(conn, report_id)?
        .ok_or_else(|| "quality_check_report_missing".to_string())?;
    if report.status != "completed" {
        return Err("quality_check_report_not_completed".to_string());
    }
    let items = load_quality_items(conn, report_id, false)?;
    let statistics = compute_statistics(&items);
    Ok(GetQualityCheckIssuesResult {
        report: Some(report),
        items,
        statistics,
    })
}

pub fn update_quality_issue_status(
    conn: &mut Connection,
    issue_id: &str,
    status: &str,
    resolution_note: Option<&str>,
) -> Result<QualityCheckItemDto, String> {
    validate_quality_issue_status(status)?;
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("quality_issue_transaction_failed: {error}"))?;
    let identity = get_mutable_quality_issue_identity(&transaction, issue_id)?;
    let resolved_at = (status == "resolved").then_some(now.as_str());
    upsert_quality_issue_state(
        &transaction,
        &identity.0,
        &identity.1,
        status,
        resolution_note,
        resolved_at,
        &now,
    )?;
    let item = transaction
        .query_row(
            &format!("{} WHERE item.id = ?1", QUALITY_WORKFLOW_ITEM_SELECT),
            params![issue_id],
            map_quality_item_row,
        )
        .map_err(|error| format!("quality_issue_read_after_update_failed: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("quality_issue_commit_failed: {error}"))?;
    Ok(item)
}

pub fn batch_update_quality_issue_status(
    conn: &mut Connection,
    issue_ids: &[String],
    status: &str,
) -> Result<Vec<QualityCheckItemDto>, String> {
    validate_quality_issue_status(status)?;
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("quality_issue_batch_transaction_failed: {error}"))?;
    let resolved_at = (status == "resolved").then_some(now.as_str());

    for issue_id in issue_ids {
        let identity = get_mutable_quality_issue_identity(&transaction, issue_id)?;
        upsert_quality_issue_state(
            &transaction,
            &identity.0,
            &identity.1,
            status,
            None,
            resolved_at,
            &now,
        )?;
    }

    let mut items = Vec::with_capacity(issue_ids.len());
    for issue_id in issue_ids {
        let item = transaction
            .query_row(
                &format!("{} WHERE item.id = ?1", QUALITY_WORKFLOW_ITEM_SELECT),
                params![issue_id],
                map_quality_item_row,
            )
            .map_err(|error| format!("quality_issue_batch_read_failed: {error}"))?;
        items.push(item);
    }
    transaction
        .commit()
        .map_err(|error| format!("quality_issue_batch_commit_failed: {error}"))?;
    Ok(items)
}

pub fn save_quality_check_result(
    conn: &mut Connection,
    input: &SaveQualityCheckResultInput,
) -> Result<GetQualityCheckIssuesResult, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("quality_result_transaction_failed: {error}"))?;
    let ownership = transaction
        .query_row(
            "SELECT novel_id, chapter_id, draft_id, status, ai_task_id, created_at FROM quality_check_reports WHERE id = ?1",
            params![&input.report_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("quality_report_ownership_read_failed: {error}"))?
        .ok_or_else(|| "quality_check_report_missing".to_string())?;

    if ownership.0 != input.novel_id
        || ownership.1 != input.chapter_id
        || ownership.2 != input.draft_id
    {
        return Err("quality_check_report_ownership_mismatch".to_string());
    }
    let ai_task_id = input.ai_task_id.trim();
    if ai_task_id.is_empty() {
        return Err("quality_check_ai_task_required".to_string());
    }
    let task = transaction
        .query_row(
            "SELECT novel_id, chapter_id, task_type, status FROM ai_task_records WHERE id = ?1",
            params![ai_task_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("quality_check_ai_task_read_failed: {error}"))?
        .ok_or_else(|| "quality_check_ai_task_missing".to_string())?;
    if task.0.as_deref() != Some(input.novel_id.as_str())
        || task.1.as_deref() != Some(input.chapter_id.as_str())
        || task.2 != "quality_check"
        || task.3 != "succeeded"
    {
        return Err("quality_check_ai_task_mismatch".to_string());
    }
    let has_newer_completed_report = has_newer_completed_quality_report(
        &transaction,
        &input.chapter_id,
        &ownership.5,
        &input.report_id,
    )?;
    if ownership.3 == "completed" {
        if ownership.4.as_deref() != Some(ai_task_id) {
            return Err("quality_check_report_ai_task_mismatch".to_string());
        }
        let report = find_quality_report_by_id(&transaction, &input.report_id)?;
        let items =
            load_quality_items(&transaction, &input.report_id, !has_newer_completed_report)?;
        let statistics = compute_statistics(&items);
        transaction
            .commit()
            .map_err(|error| format!("quality_result_idempotent_commit_failed: {error}"))?;
        return Ok(GetQualityCheckIssuesResult {
            report,
            items,
            statistics,
        });
    }
    if ownership.3 != "pending" {
        return Err("quality_check_report_not_pending".to_string());
    }

    let updates_workflow_state = !has_newer_completed_report;

    let mut seen_issue_keys = HashSet::new();
    let mut prepared_items = Vec::with_capacity(input.result.items.len());
    for (sort_order, new_item) in input.result.items.iter().enumerate() {
        let issue_key = new_item
            .issue_key
            .as_deref()
            .filter(|key| !key.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        if !seen_issue_keys.insert(issue_key.clone()) {
            return Err("quality_check_duplicate_issue_key".to_string());
        }
        prepared_items.push((sort_order, new_item, issue_key));
    }

    for (sort_order, new_item, issue_key) in prepared_items {
        let item_id = uuid::Uuid::new_v4().to_string();
        transaction
            .execute(
                "INSERT INTO quality_check_items
                    (id, report_id, novel_id, chapter_id, draft_id, issue_type, severity, title, description, category, evidence, suggestion, quote, start_offset, end_offset, paragraph_index, issue_key, status, resolution_note, resolved_at, sort_order, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 'pending', NULL, NULL, ?18, ?19, ?19)",
                params![
                    &item_id,
                    &input.report_id,
                    &input.novel_id,
                    &input.chapter_id,
                    &input.draft_id,
                    new_item.issue_type.as_deref().unwrap_or("other"),
                    new_item.severity.as_deref().unwrap_or("medium"),
                    new_item.title.as_deref().unwrap_or_default(),
                    new_item.description.as_deref().unwrap_or_default(),
                    &new_item.category,
                    &new_item.evidence,
                    &new_item.suggestion,
                    &new_item.quote,
                    &new_item.start_offset,
                    &new_item.end_offset,
                    &new_item.paragraph_index,
                    &issue_key,
                    sort_order as i64,
                    &now,
                ],
            )
            .map_err(|error| format!("quality_snapshot_item_insert_failed: {error}"))?;

        if updates_workflow_state {
            transaction
                .execute(
                "INSERT INTO quality_issue_states
                    (id, chapter_id, issue_key, status, resolution_note, resolved_at, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 'pending', NULL, NULL, ?4, ?4)
                 ON CONFLICT(chapter_id, issue_key) DO UPDATE SET
                    status = CASE WHEN quality_issue_states.status = 'ignored' THEN 'ignored' ELSE 'pending' END,
                    resolution_note = CASE WHEN quality_issue_states.status = 'ignored' THEN quality_issue_states.resolution_note ELSE NULL END,
                    resolved_at = CASE WHEN quality_issue_states.status = 'ignored' THEN quality_issue_states.resolved_at ELSE NULL END,
                    updated_at = excluded.updated_at",
                    params![
                        uuid::Uuid::new_v4().to_string(),
                        &input.chapter_id,
                        &issue_key,
                        &now,
                    ],
                )
                .map_err(|error| format!("quality_snapshot_state_write_failed: {error}"))?;
        }
    }

    let affected = transaction
        .execute(
            "UPDATE quality_check_reports
             SET status = 'completed', overall_score = ?1, summary = ?2, draft_version = ?3,
                 model = ?4, ai_task_id = ?5,
                 content_hash = COALESCE(?6, content_hash),
                 content_length = COALESCE(?7, content_length),
                 checked_at = COALESCE(?8, checked_at), updated_at = ?9
             WHERE id = ?10 AND novel_id = ?11 AND chapter_id = ?12 AND draft_id = ?13 AND status = 'pending'",
            params![
                &input.result.overall_score,
                &input.result.summary,
                &input.draft_version,
                &input.model,
                ai_task_id,
                &input.content_hash,
                &input.content_length,
                &input.checked_at,
                &now,
                &input.report_id,
                &input.novel_id,
                &input.chapter_id,
                &input.draft_id,
            ],
        )
        .map_err(|error| format!("quality_report_complete_failed: {error}"))?;
    if affected != 1 {
        return Err("quality_check_report_completion_conflict".to_string());
    }

    let report = find_quality_report_by_id(&transaction, &input.report_id)?;
    let items = load_quality_items(&transaction, &input.report_id, updates_workflow_state)?;
    let statistics = compute_statistics(&items);
    transaction
        .commit()
        .map_err(|error| format!("quality_result_commit_failed: {error}"))?;
    Ok(GetQualityCheckIssuesResult {
        report,
        items,
        statistics,
    })
}

pub fn has_other_quality_fix_round(
    conn: &Connection,
    chapter_id: &str,
    source_draft_id: &str,
    run_id: &str,
) -> Result<bool, String> {
    let existing_rounds: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM quality_fix_runs WHERE chapter_id=?1 AND source_draft_id=?2 AND id<>?3",
            params![chapter_id, source_draft_id, run_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(existing_rounds > 0)
}

pub fn save_quality_fix_run(
    conn: &Connection,
    input: SaveQualityFixRunInput,
) -> Result<QualityFixRunDto, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let mode = input.mode.unwrap_or_else(|| "conservative".to_string());

    let updated = conn.execute(
        "UPDATE quality_fix_runs SET target_draft_id=?1, target_draft_version=?2, target_content_hash=?3, after_report_id=?4, after_score=?5, after_pending_count=?6, after_serious_count=?7, fixed_issue_ids=?8, new_issue_ids=?9, status=?10, revision_summary=?11, changed_ranges_json=?12, used_context_ids=?13, skipped_context_ids=?14, warnings=?15, failure_reason=?16, updated_at=?17 WHERE id=?18",
        params![
            &input.target_draft_id, &input.target_draft_version, &input.target_content_hash,
            &input.after_report_id, &input.after_score, &input.after_pending_count,
            &input.after_serious_count, &input.fixed_issue_ids, &input.new_issue_ids,
            &input.status, &input.revision_summary, &input.changed_ranges_json,
            &input.used_context_ids, &input.skipped_context_ids, &input.warnings,
            &input.failure_reason, &now, &input.id,
        ],
    ).map_err(|e| e.to_string())?;

    if updated == 0 {
        if has_other_quality_fix_round(conn, &input.chapter_id, &input.source_draft_id, &input.id)?
        {
            return Err(
                "quality_fix_round_already_used: source draft already has a repair run".to_string(),
            );
        }
        conn.execute(
            "INSERT INTO quality_fix_runs (id, novel_id, chapter_id, source_draft_id, source_draft_version, target_draft_id, target_draft_version, source_content_hash, target_content_hash, before_report_id, after_report_id, before_score, after_score, before_pending_count, after_pending_count, before_serious_count, after_serious_count, fixed_issue_ids, new_issue_ids, mode, status, model, revision_summary, changed_ranges_json, used_context_ids, skipped_context_ids, warnings, failure_reason, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?29)",
            params![
                &input.id, &input.novel_id, &input.chapter_id, &input.source_draft_id,
                &input.source_draft_version, &input.target_draft_id, &input.target_draft_version,
                &input.source_content_hash, &input.target_content_hash, &input.before_report_id,
                &input.after_report_id, &input.before_score, &input.after_score,
                &input.before_pending_count, &input.after_pending_count,
                &input.before_serious_count, &input.after_serious_count,
                &input.fixed_issue_ids, &input.new_issue_ids, &mode, &input.status,
                &input.model, &input.revision_summary, &input.changed_ranges_json,
                &input.used_context_ids, &input.skipped_context_ids, &input.warnings,
                &input.failure_reason, &now,
            ],
        ).map_err(|e| e.to_string())?;
    }

    let mut stmt = conn
        .prepare(&format!("{QUALITY_FIX_RUN_SELECT} WHERE id=?1"))
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![&input.id], map_fix_run_row)
        .map_err(|e| e.to_string())
}

pub fn get_quality_fix_runs(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<QualityFixRunDto>, String> {
    quality_check_repository::find_quality_fix_runs_by_chapter(conn, chapter_id)
}

pub fn update_quality_fix_run_status(
    conn: &Connection,
    id: &str,
    status: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE quality_fix_runs SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![status, chrono::Utc::now().to_rfc3339(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_context_read_log(
    conn: &Connection,
    input: SaveContextReadLogInput,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    quality_check_repository::insert_context_read_log(conn, &input, &now)
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
        conn.execute(
            "INSERT INTO chapter_drafts (id, novel_id, chapter_id, title, content, is_adopted, word_count, created_at, updated_at) VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '第一章草稿', '正文内容', 1, 1000, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO ai_task_records (id, novel_id, chapter_id, task_type, status, created_at) VALUES ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'quality_check', 'succeeded', '2026-01-01T00:00:00Z')",
            [],
        ).unwrap();
        conn
    }

    #[test]
    fn test_quality_check_report_and_issues() {
        let mut conn = setup_test_db();
        let report = create_quality_check_report(
            &conn,
            CreateQualityReportInput {
                novel_id: "11111111-1111-1111-1111-111111111111".to_string(),
                chapter_id: "22222222-2222-2222-2222-222222222222".to_string(),
                draft_id: "33333333-3333-3333-3333-333333333333".to_string(),
                scope: Some("current_draft".to_string()),
                content_hash: None,
                content_length: Some(1000),
                checked_at: Some("2026-01-01T00:00:00Z".to_string()),
            },
        )
        .unwrap();

        assert_eq!(report.status, "pending");

        let saved = save_quality_check_result(
            &mut conn,
            &SaveQualityCheckResultInput {
                report_id: report.id.clone(),
                novel_id: "11111111-1111-1111-1111-111111111111".to_string(),
                chapter_id: "22222222-2222-2222-2222-222222222222".to_string(),
                draft_id: "33333333-3333-3333-3333-333333333333".to_string(),
                result: crate::domain::ai::QualityCheckResultDto {
                    overall_score: Some(85),
                    summary: Some("整体质量良好，有轻微错字".to_string()),
                    items: vec![crate::domain::ai::QualityCheckResultItemDto {
                        issue_type: Some("typo".to_string()),
                        severity: Some("low".to_string()),
                        category: Some("text".to_string()),
                        title: Some("错别字".to_string()),
                        description: Some("第一段有错字".to_string()),
                        evidence: None,
                        suggestion: None,
                        quote: None,
                        start_offset: None,
                        end_offset: None,
                        paragraph_index: None,
                        issue_key: Some("issue-1".to_string()),
                    }],
                },
                draft_version: Some(1),
                model: Some("deepseek-chat".to_string()),
                content_hash: None,
                content_length: Some(1000),
                checked_at: Some("2026-01-01T00:01:00Z".to_string()),
                ai_task_id: "55555555-5555-5555-5555-555555555555".to_string(),
            },
        )
        .unwrap();

        assert_eq!(saved.items.len(), 1);
        assert_eq!(saved.statistics.total, 1);
        assert_eq!(saved.statistics.pending, 1);

        let updated_item = update_quality_issue_status(
            &mut conn,
            &saved.items[0].id,
            "resolved",
            Some("已修复错字"),
        )
        .unwrap();
        assert_eq!(updated_item.status, "resolved");
    }
}
