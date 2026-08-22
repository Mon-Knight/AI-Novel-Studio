use crate::domain::ai::{AiTaskRecordDto, CreateAiTaskRecordInput, MarkAiTaskSucceededInput};
use rusqlite::{params, Connection, Row};

pub const AI_TASK_RECORD_SELECT: &str = "SELECT id, novel_id, chapter_id, task_type, status, runtime_mode, provider, model_name, prompt_template_id, input_summary, prompt_snapshot, result_text, result_json, error_message, token_input, token_output, token_total, input_price_per_million_tokens, output_price_per_million_tokens, cost_estimate, cost_currency, cost_status, pricing_source, duration_ms, started_at, finished_at, created_at FROM ai_task_records";

pub fn ai_task_select_sql() -> &'static str {
    AI_TASK_RECORD_SELECT
}

pub fn map_ai_task_row(row: &Row<'_>) -> rusqlite::Result<AiTaskRecordDto> {
    Ok(AiTaskRecordDto {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        chapter_id: row.get(2)?,
        task_type: row.get(3)?,
        status: row.get(4)?,
        runtime_mode: row.get(5)?,
        provider: row.get(6)?,
        model_name: row.get(7)?,
        prompt_template_id: row.get(8)?,
        input_summary: row.get(9)?,
        prompt_snapshot: row.get(10)?,
        result_text: row.get(11)?,
        result_json: row.get(12)?,
        error_message: row.get(13)?,
        token_input: row.get(14)?,
        token_output: row.get(15)?,
        token_total: row.get(16)?,
        input_price_per_million_tokens: row.get(17)?,
        output_price_per_million_tokens: row.get(18)?,
        cost_estimate: row.get(19)?,
        cost_currency: row.get(20)?,
        cost_status: row.get(21)?,
        pricing_source: row.get(22)?,
        duration_ms: row.get(23)?,
        started_at: row.get(24)?,
        finished_at: row.get(25)?,
        created_at: row.get(26)?,
    })
}

pub fn find_ai_task_record_by_id(conn: &Connection, id: &str) -> Result<AiTaskRecordDto, String> {
    let sql = format!("{AI_TASK_RECORD_SELECT} WHERE id = ?1");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_ai_task_row)
        .map_err(|e| e.to_string())
}

pub fn find_ai_task_records_by_chapter(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<AiTaskRecordDto>, String> {
    let sql = format!("{AI_TASK_RECORD_SELECT} WHERE chapter_id = ?1 ORDER BY created_at DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![chapter_id], map_ai_task_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn find_ai_task_records_by_novel(
    conn: &Connection,
    novel_id: &str,
) -> Result<Vec<AiTaskRecordDto>, String> {
    let sql = format!("{AI_TASK_RECORD_SELECT} WHERE novel_id = ?1 ORDER BY created_at DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![novel_id], map_ai_task_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn query_ai_task_records(
    conn: &Connection,
    limit: i64,
    offset: i64,
    task_type: Option<&str>,
    status: Option<&str>,
) -> Result<Vec<AiTaskRecordDto>, String> {
    let sql = format!(
        "{AI_TASK_RECORD_SELECT} WHERE (?3 IS NULL OR task_type = ?3) AND (?4 IS NULL OR status = ?4) ORDER BY created_at DESC LIMIT ?1 OFFSET ?2"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![limit, offset, task_type, status], map_ai_task_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn count_ai_task_records(
    conn: &Connection,
    task_type: Option<&str>,
    status: Option<&str>,
) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM ai_task_records WHERE (?1 IS NULL OR task_type = ?1) AND (?2 IS NULL OR status = ?2)",
        params![task_type, status],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

pub fn count_total_ai_task_records(conn: &Connection) -> Result<i64, String> {
    conn.query_row("SELECT COUNT(*) FROM ai_task_records", [], |row| row.get(0))
        .map_err(|e| e.to_string())
}

pub fn ai_task_records_table_exists(conn: &Connection) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'ai_task_records'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to check ai_task_records table: {}", e))?;
    Ok(count > 0)
}

pub fn count_ai_task_records_by_ids(conn: &Connection, ids: &[String]) -> Result<i64, String> {
    let mut count = 0_i64;
    for id in ids {
        count += conn
            .query_row(
                "SELECT COUNT(*) FROM ai_task_records WHERE id = ?1",
                params![id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(count)
}

pub fn sample_ai_task_ids(conn: &Connection, limit: i64) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM ai_task_records ORDER BY created_at DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;
    let ids = stmt
        .query_map(params![limit], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(ids)
}

pub fn insert_ai_task_record(
    conn: &Connection,
    input: &CreateAiTaskRecordInput,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO ai_task_records (id, novel_id, chapter_id, task_type, status, runtime_mode, provider, model_name, input_price_per_million_tokens, output_price_per_million_tokens, cost_currency, pricing_source, input_summary, started_at, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15) ON CONFLICT(id) DO NOTHING",
        params![
            &input.id,
            &input.novel_id,
            &input.chapter_id,
            &input.task_type,
            &input.status,
            &input.runtime_mode,
            &input.provider,
            &input.model_name,
            input.input_price_per_million_tokens,
            input.output_price_per_million_tokens,
            &input.cost_currency,
            &input.pricing_source,
            &input.input_summary,
            &input.started_at,
            &input.created_at,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_ai_task_running_for_retry(
    conn: &Connection,
    id: &str,
    started_at: &str,
) -> Result<usize, String> {
    conn.execute(
        "UPDATE ai_task_records
         SET status = 'running', error_message = NULL, duration_ms = NULL,
             finished_at = NULL, started_at = ?1
         WHERE id = ?2 AND status = 'failed'",
        params![started_at, id],
    )
    .map_err(|error| error.to_string())
}

pub fn update_ai_task_succeeded(
    conn: &Connection,
    id: &str,
    input: &MarkAiTaskSucceededInput,
) -> Result<usize, String> {
    conn.execute(
        "UPDATE ai_task_records SET status = 'succeeded', result_text = ?1, prompt_snapshot = ?2, result_json = ?3, error_message = NULL, token_input = ?4, token_output = ?5, token_total = ?6,
         cost_estimate = CASE
           WHEN pricing_source = 'mock' THEN 0.0
           WHEN input_price_per_million_tokens IS NOT NULL AND output_price_per_million_tokens IS NOT NULL AND ?4 IS NOT NULL AND ?5 IS NOT NULL
             THEN ROUND(((?4 * input_price_per_million_tokens) + (?5 * output_price_per_million_tokens)) / 1000000.0, 8)
           ELSE NULL
         END,
         cost_status = CASE
           WHEN pricing_source = 'mock' THEN 'mock'
           WHEN input_price_per_million_tokens IS NULL OR output_price_per_million_tokens IS NULL THEN 'unpriced'
           WHEN ?4 IS NULL OR ?5 IS NULL THEN 'usage_missing'
           ELSE 'complete'
         END,
         duration_ms = ?7, finished_at = ?8 WHERE id = ?9 AND status IN ('pending', 'running')",
        params![
            &input.result_text,
            &input.prompt_snapshot,
            &input.result_json,
            input.token_input,
            input.token_output,
            input.token_total,
            input.duration_ms,
            input.finished_at,
            id,
        ],
    ).map_err(|e| e.to_string())
}

pub fn update_ai_task_failed(
    conn: &Connection,
    id: &str,
    error_message: &str,
    finished_at: &str,
    duration_ms: Option<i64>,
) -> Result<usize, String> {
    conn.execute(
        "UPDATE ai_task_records SET status = 'failed', error_message = ?1, duration_ms = ?2, finished_at = ?3 WHERE id = ?4 AND status IN ('pending', 'running')",
        params![error_message, duration_ms, finished_at, id],
    ).map_err(|e| e.to_string())
}

pub fn update_ai_task_cancelled(
    conn: &Connection,
    id: &str,
    finished_at: &str,
    duration_ms: Option<i64>,
) -> Result<usize, String> {
    conn.execute(
        "UPDATE ai_task_records SET status = 'cancelled', error_message = NULL, duration_ms = ?1, finished_at = ?2 WHERE id = ?3 AND status IN ('pending', 'running')",
        params![duration_ms, finished_at, id],
    )
    .map_err(|e| e.to_string())
}
