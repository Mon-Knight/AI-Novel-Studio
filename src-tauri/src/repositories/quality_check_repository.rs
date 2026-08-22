use crate::domain::ai::{
    QualityCheckItemDto, QualityCheckReportDto, QualityFixRunDto, SaveContextReadLogInput,
};
use rusqlite::{params, Connection, OptionalExtension, Row};

pub const QUALITY_REPORT_SELECT: &str = "SELECT id, novel_id, chapter_id, draft_id, scope, status, overall_score, summary, ai_task_id, draft_version, model, content_hash, content_length, checked_at, created_at, updated_at FROM quality_check_reports";

pub const QUALITY_ITEM_SELECT: &str = "SELECT id, report_id, novel_id, chapter_id, draft_id, issue_type, severity, title, description, category, evidence, suggestion, quote, start_offset, end_offset, paragraph_index, issue_key, status, resolution_note, resolved_at, created_at, updated_at, sort_order FROM quality_check_items";

pub const QUALITY_WORKFLOW_ITEM_SELECT: &str = "SELECT item.id, item.report_id, item.novel_id, item.chapter_id, item.draft_id, item.issue_type, item.severity, item.title, item.description, item.category, item.evidence, item.suggestion, item.quote, item.start_offset, item.end_offset, item.paragraph_index, item.issue_key, COALESCE(state.status, item.status), CASE WHEN state.id IS NOT NULL THEN state.resolution_note ELSE item.resolution_note END, CASE WHEN state.id IS NOT NULL THEN state.resolved_at ELSE item.resolved_at END, item.created_at, COALESCE(state.updated_at, item.updated_at), item.sort_order FROM quality_check_items AS item LEFT JOIN quality_issue_states AS state ON state.chapter_id = item.chapter_id AND state.issue_key = item.issue_key";

pub const QUALITY_FIX_RUN_SELECT: &str = "SELECT id, novel_id, chapter_id, source_draft_id, source_draft_version, target_draft_id, target_draft_version, source_content_hash, target_content_hash, before_report_id, after_report_id, before_score, after_score, before_pending_count, after_pending_count, before_serious_count, after_serious_count, fixed_issue_ids, new_issue_ids, mode, status, model, revision_summary, changed_ranges_json, used_context_ids, skipped_context_ids, warnings, failure_reason, created_at, updated_at FROM quality_fix_runs";

pub fn map_quality_report_row(row: &Row<'_>) -> rusqlite::Result<QualityCheckReportDto> {
    Ok(QualityCheckReportDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        chapter_id: row.get(2)?,
        draft_id: row.get(3)?,
        scope: row.get(4)?,
        status: row.get(5)?,
        overall_score: row.get(6)?,
        summary: row.get(7)?,
        ai_task_id: row.get(8)?,
        draft_version: row.get(9)?,
        model: row.get(10)?,
        content_hash: row.get(11)?,
        content_length: row.get(12)?,
        checked_at: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

pub fn map_quality_item_row(row: &Row<'_>) -> rusqlite::Result<QualityCheckItemDto> {
    Ok(QualityCheckItemDto {
        id: row.get(0)?,
        report_id: row.get(1)?,
        novel_id: row.get(2)?,
        chapter_id: row.get(3)?,
        draft_id: row.get(4)?,
        issue_type: row.get(5)?,
        severity: row.get(6)?,
        title: row.get(7)?,
        description: row.get(8)?,
        category: row.get(9)?,
        evidence: row.get(10)?,
        suggestion: row.get(11)?,
        quote: row.get(12)?,
        start_offset: row.get(13)?,
        end_offset: row.get(14)?,
        paragraph_index: row.get(15)?,
        issue_key: row.get(16)?,
        status: row.get(17)?,
        resolution_note: row.get(18)?,
        resolved_at: row.get(19)?,
        created_at: row.get(20)?,
        updated_at: row.get(21)?,
        sort_order: row.get(22)?,
    })
}

pub fn map_fix_run_row(row: &Row<'_>) -> rusqlite::Result<QualityFixRunDto> {
    Ok(QualityFixRunDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        chapter_id: row.get(2)?,
        source_draft_id: row.get(3)?,
        source_draft_version: row.get(4)?,
        target_draft_id: row.get(5)?,
        target_draft_version: row.get(6)?,
        source_content_hash: row.get(7)?,
        target_content_hash: row.get(8)?,
        before_report_id: row.get(9)?,
        after_report_id: row.get(10)?,
        before_score: row.get(11)?,
        after_score: row.get(12)?,
        before_pending_count: row.get(13)?,
        after_pending_count: row.get(14)?,
        before_serious_count: row.get(15)?,
        after_serious_count: row.get(16)?,
        fixed_issue_ids: row.get(17)?,
        new_issue_ids: row.get(18)?,
        mode: row.get(19)?,
        status: row.get(20)?,
        model: row.get(21)?,
        revision_summary: row.get(22)?,
        changed_ranges_json: row.get(23)?,
        used_context_ids: row.get(24)?,
        skipped_context_ids: row.get(25)?,
        warnings: row.get(26)?,
        failure_reason: row.get(27)?,
        created_at: row.get(28)?,
        updated_at: row.get(29)?,
    })
}

pub fn find_quality_report_by_id(
    conn: &Connection,
    report_id: &str,
) -> Result<Option<QualityCheckReportDto>, String> {
    conn.query_row(
        &format!("{QUALITY_REPORT_SELECT} WHERE id = ?1"),
        params![report_id],
        map_quality_report_row,
    )
    .optional()
    .map_err(|error| format!("quality_report_read_failed: {error}"))
}

pub fn find_latest_completed_quality_report(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Option<QualityCheckReportDto>, String> {
    conn.query_row(
        &format!(
            "{QUALITY_REPORT_SELECT} WHERE chapter_id = ?1 AND status = 'completed' ORDER BY created_at DESC, id DESC LIMIT 1"
        ),
        params![chapter_id],
        map_quality_report_row,
    )
    .optional()
    .map_err(|error| format!("quality_latest_report_read_failed: {error}"))
}

pub fn list_completed_quality_reports_by_chapter(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<QualityCheckReportDto>, String> {
    let sql = format!(
        "{QUALITY_REPORT_SELECT} WHERE chapter_id = ?1 AND status = 'completed' ORDER BY created_at DESC, id DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![chapter_id], map_quality_report_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn load_quality_items(
    conn: &Connection,
    report_id: &str,
    overlay_workflow_state: bool,
) -> Result<Vec<QualityCheckItemDto>, String> {
    let (select, qualifier, item_id) = if overlay_workflow_state {
        (QUALITY_WORKFLOW_ITEM_SELECT, "item.report_id", "item.id")
    } else {
        (QUALITY_ITEM_SELECT, "report_id", "id")
    };
    let sql = format!("{select} WHERE {qualifier} = ?1 ORDER BY sort_order ASC, {item_id} ASC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![report_id], map_quality_item_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn find_quality_fix_runs_by_chapter(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<QualityFixRunDto>, String> {
    let sql = format!("{QUALITY_FIX_RUN_SELECT} WHERE chapter_id = ?1 ORDER BY created_at DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![chapter_id], map_fix_run_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn insert_context_read_log(
    conn: &Connection,
    input: &SaveContextReadLogInput,
    now: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO context_read_logs (id, novel_id, task_type, chapter_id, volume_id, used_context_ids, skipped_context_ids, warnings, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            &input.id,
            &input.novel_id,
            &input.task_type,
            &input.chapter_id,
            &input.volume_id,
            &input.used_context_ids,
            &input.skipped_context_ids,
            &input.warnings,
            now,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
