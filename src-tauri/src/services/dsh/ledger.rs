use rusqlite::{params, Connection};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparationRunRecord {
    pub id: String,
    pub novel_id: String,
    pub chapter_id: String,
    pub planner: String,
    pub status: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub duration_ms: i64,
    pub planner_coerced: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparationSummary {
    pub runs: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub duration_ms: i64,
}

/// Persists one DSH run and treats a repeated id as an idempotent replay.
/// Reusing an id with different facts is rejected instead of silently updating
/// the historical record.
pub fn record_run(connection: &Connection, record: &PreparationRunRecord) -> Result<(), String> {
    let inserted = connection
        .execute(
            "INSERT INTO dsh_preparation_runs (
                id, novel_id, chapter_id, planner, status, prompt_tokens,
                completion_tokens, duration_ms, planner_coerced, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO NOTHING",
            params![
                record.id,
                record.novel_id,
                record.chapter_id,
                record.planner,
                record.status,
                record.prompt_tokens,
                record.completion_tokens,
                record.duration_ms,
                record.planner_coerced,
                record.created_at,
            ],
        )
        .map_err(|error| format!("DSH 运行记录写入失败: {}", error))?;

    if inserted == 0 {
        let existing = connection
            .query_row(
                "SELECT novel_id, chapter_id, planner, status, prompt_tokens,
                        completion_tokens, duration_ms, planner_coerced, created_at
                   FROM dsh_preparation_runs
                  WHERE id = ?1",
                params![record.id],
                |row| {
                    Ok(PreparationRunRecord {
                        id: record.id.clone(),
                        novel_id: row.get(0)?,
                        chapter_id: row.get(1)?,
                        planner: row.get(2)?,
                        status: row.get(3)?,
                        prompt_tokens: row.get(4)?,
                        completion_tokens: row.get(5)?,
                        duration_ms: row.get(6)?,
                        planner_coerced: row.get(7)?,
                        created_at: row.get(8)?,
                    })
                },
            )
            .map_err(|error| format!("DSH 运行记录重放读取失败: {}", error))?;
        if &existing != record {
            return Err("DSH 运行记录 operation identity 冲突".to_string());
        }
    }
    Ok(())
}

pub fn summary(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
) -> Result<PreparationSummary, String> {
    connection
        .query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(prompt_tokens), 0),
                    COALESCE(SUM(completion_tokens), 0),
                    COALESCE(SUM(duration_ms), 0)
               FROM dsh_preparation_runs
              WHERE novel_id = ?1 AND chapter_id = ?2 AND status = 'completed'",
            params![novel_id, chapter_id],
            |row| {
                Ok(PreparationSummary {
                    runs: row.get(0)?,
                    prompt_tokens: row.get(1)?,
                    completion_tokens: row.get(2)?,
                    duration_ms: row.get(3)?,
                })
            },
        )
        .map_err(|error| format!("DSH 用量汇总读取失败: {}", error))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().expect("open database");
        connection
            .execute_batch(
                "CREATE TABLE dsh_preparation_runs (
                    id TEXT PRIMARY KEY,
                    novel_id TEXT,
                    chapter_id TEXT,
                    planner TEXT NOT NULL,
                    status TEXT NOT NULL,
                    prompt_tokens INTEGER NOT NULL DEFAULT 0,
                    completion_tokens INTEGER NOT NULL DEFAULT 0,
                    duration_ms INTEGER NOT NULL DEFAULT 0,
                    planner_coerced TEXT,
                    created_at TEXT NOT NULL
                );",
            )
            .expect("create ledger");
        connection
    }

    fn record() -> PreparationRunRecord {
        PreparationRunRecord {
            id: "run-1".to_string(),
            novel_id: "novel-1".to_string(),
            chapter_id: "chapter-1".to_string(),
            planner: "dsh_spike_v0".to_string(),
            status: "completed".to_string(),
            prompt_tokens: 12,
            completion_tokens: 34,
            duration_ms: 56,
            planner_coerced: None,
            created_at: "2026-08-19T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn repeated_same_run_is_idempotent_and_summary_counts_once() {
        let connection = connection();
        let record = record();
        record_run(&connection, &record).expect("first write");
        record_run(&connection, &record).expect("replay");
        assert_eq!(
            summary(&connection, "novel-1", "chapter-1").expect("summary"),
            PreparationSummary {
                runs: 1,
                prompt_tokens: 12,
                completion_tokens: 34,
                duration_ms: 56,
            }
        );
    }

    #[test]
    fn repeated_run_id_with_different_facts_is_rejected() {
        let connection = connection();
        let record = record();
        record_run(&connection, &record).expect("first write");
        let mut conflicting = record.clone();
        conflicting.completion_tokens = 35;
        let error = record_run(&connection, &conflicting).expect_err("conflict");
        assert!(error.contains("operation identity 冲突"));
    }

    #[test]
    fn failed_runs_are_retained_but_excluded_from_completed_summary() {
        let connection = connection();
        let mut failed = record();
        failed.id = "run-failed".to_string();
        failed.status = "failed".to_string();
        record_run(&connection, &failed).expect("failed write");
        assert_eq!(
            summary(&connection, "novel-1", "chapter-1").unwrap().runs,
            0
        );
    }
}
