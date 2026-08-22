use crate::domain::ai::{
    CreateGenerationJobInput, GenerationJobDto, GenerationStepResultDto,
    SaveGenerationStepResultInput, UpdateGenerationJobInput,
};
use rusqlite::{params, Connection, Row};

pub const GENERATION_JOB_SELECT: &str = "SELECT id, world_id, novel_id, volume_id, chapter_id, job_type, status, current_step, progress_percent, provider, model_name, input_token_estimate, output_token_estimate, actual_input_tokens, actual_output_tokens, cost_estimate, error_code, error_message, retry_count, created_at, started_at, finished_at FROM generation_jobs";

pub const GENERATION_STEP_RESULT_SELECT: &str = "SELECT id, job_id, step_name, status, input_snapshot_json, output_json, output_text, error_message, created_at FROM generation_step_results";

pub fn map_generation_job_row(row: &Row<'_>) -> rusqlite::Result<GenerationJobDto> {
    Ok(GenerationJobDto {
        id: row.get(0)?,
        world_id: row.get(1)?,
        novel_id: row.get(2)?,
        volume_id: row.get(3)?,
        chapter_id: row.get(4)?,
        job_type: row.get(5)?,
        status: row.get(6)?,
        current_step: row.get(7)?,
        progress_percent: row.get(8)?,
        provider: row.get(9)?,
        model_name: row.get(10)?,
        input_token_estimate: row.get(11)?,
        output_token_estimate: row.get(12)?,
        actual_input_tokens: row.get(13)?,
        actual_output_tokens: row.get(14)?,
        cost_estimate: row.get(15)?,
        error_code: row.get(16)?,
        error_message: row.get(17)?,
        retry_count: row.get(18)?,
        created_at: row.get(19)?,
        started_at: row.get(20)?,
        finished_at: row.get(21)?,
    })
}

pub fn map_generation_step_result_row(row: &Row<'_>) -> rusqlite::Result<GenerationStepResultDto> {
    Ok(GenerationStepResultDto {
        id: row.get(0)?,
        job_id: row.get(1)?,
        step_name: row.get(2)?,
        status: row.get(3)?,
        input_snapshot_json: row.get(4)?,
        output_json: row.get(5)?,
        output_text: row.get(6)?,
        error_message: row.get(7)?,
        created_at: row.get(8)?,
    })
}

pub fn find_generation_job_by_id(conn: &Connection, id: &str) -> Result<GenerationJobDto, String> {
    let sql = format!("{GENERATION_JOB_SELECT} WHERE id = ?1");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_generation_job_row)
        .map_err(|e| e.to_string())
}

pub fn find_generation_jobs_by_chapter(
    conn: &Connection,
    chapter_id: &str,
) -> Result<Vec<GenerationJobDto>, String> {
    let sql = format!("{GENERATION_JOB_SELECT} WHERE chapter_id = ?1 ORDER BY created_at DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![chapter_id], map_generation_job_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}

pub fn insert_generation_job(
    conn: &Connection,
    input: &CreateGenerationJobInput,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO generation_jobs (id, world_id, novel_id, volume_id, chapter_id, job_type, status, current_step, progress_percent, provider, model_name, retry_count, created_at, started_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
        params![
            &input.id,
            &input.world_id,
            &input.novel_id,
            &input.volume_id,
            &input.chapter_id,
            &input.job_type,
            &input.status,
            &input.current_step,
            input.progress_percent,
            &input.provider,
            &input.model_name,
            input.retry_count,
            &input.created_at,
            &input.started_at,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_generation_job_fields(
    conn: &Connection,
    input: &UpdateGenerationJobInput,
) -> Result<usize, String> {
    conn.execute(
        "UPDATE generation_jobs SET status = COALESCE(?1, status), current_step = COALESCE(?2, current_step), progress_percent = COALESCE(?3, progress_percent), provider = COALESCE(?4, provider), model_name = COALESCE(?5, model_name), input_token_estimate = COALESCE(?6, input_token_estimate), output_token_estimate = COALESCE(?7, output_token_estimate), actual_input_tokens = COALESCE(?8, actual_input_tokens), actual_output_tokens = COALESCE(?9, actual_output_tokens), cost_estimate = COALESCE(?10, cost_estimate), error_code = COALESCE(?11, error_code), error_message = COALESCE(?12, error_message), retry_count = COALESCE(?13, retry_count), started_at = COALESCE(?14, started_at), finished_at = COALESCE(?15, finished_at) WHERE id = ?16",
        params![
            &input.status,
            &input.current_step,
            input.progress_percent,
            &input.provider,
            &input.model_name,
            input.input_token_estimate,
            input.output_token_estimate,
            input.actual_input_tokens,
            input.actual_output_tokens,
            input.cost_estimate,
            &input.error_code,
            &input.error_message,
            input.retry_count,
            &input.started_at,
            &input.finished_at,
            &input.id,
        ],
    ).map_err(|e| e.to_string())
}

pub fn insert_generation_step_result(
    conn: &Connection,
    input: &SaveGenerationStepResultInput,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO generation_step_results (id, job_id, step_name, status, input_snapshot_json, output_json, output_text, error_message, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            &input.id,
            &input.job_id,
            &input.step_name,
            &input.status,
            &input.input_snapshot_json,
            &input.output_json,
            &input.output_text,
            &input.error_message,
            &input.created_at,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn find_generation_step_result_by_id(
    conn: &Connection,
    id: &str,
) -> Result<GenerationStepResultDto, String> {
    let sql = format!("{GENERATION_STEP_RESULT_SELECT} WHERE id = ?1");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    stmt.query_row(params![id], map_generation_step_result_row)
        .map_err(|e| e.to_string())
}

pub fn find_generation_step_results_by_job(
    conn: &Connection,
    job_id: &str,
) -> Result<Vec<GenerationStepResultDto>, String> {
    let sql = format!(
        "{GENERATION_STEP_RESULT_SELECT} WHERE job_id = ?1 ORDER BY created_at ASC, id ASC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params![job_id], map_generation_step_result_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(items)
}
