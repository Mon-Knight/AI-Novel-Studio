//! Verifies the caller's six-source revision snapshot against current SQLite
//! facts before the DSH process or Provider request starts.

use rusqlite::{params, Connection, OptionalExtension};

use super::models::ChapterPreparationInput;
use super::proposal_validator::PROPOSAL_SOURCES;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalBaselines {
    pub outline: i64,
    pub chapter_context: i64,
    pub style_profile: i64,
    pub output_control: i64,
    pub character_states: i64,
    pub memory_index: i64,
}

impl CanonicalBaselines {
    pub fn revision_of(&self, source: &str) -> i64 {
        match source {
            "outline" => self.outline,
            "chapter_context" => self.chapter_context,
            "style_profile" => self.style_profile,
            "output_control" => self.output_control,
            "character_states" => self.character_states,
            "memory_index" => self.memory_index,
            _ => 0,
        }
    }
}

fn iso_to_unix_ms(value: Option<String>) -> Result<i64, String> {
    match value {
        None => Ok(0),
        Some(text) => chrono::DateTime::parse_from_rfc3339(&text)
            .map(|stamp| stamp.timestamp_millis())
            .map_err(|error| format!("DSH 基线时间戳无效: {} ({})", text, error)),
    }
}

fn query_optional_i64(
    connection: &Connection,
    sql: &str,
    param: &str,
    source: &str,
) -> Result<i64, String> {
    connection
        .query_row(sql, params![param], |row| row.get::<_, i64>(0))
        .optional()
        .map(|value| value.unwrap_or(0))
        .map_err(|error| format!("DSH {} 基线读取失败: {}", source, error))
}

fn query_optional_timestamp(
    connection: &Connection,
    sql: &str,
    param: &str,
    source: &str,
) -> Result<i64, String> {
    let value = connection
        .query_row(sql, params![param], |row| row.get::<_, Option<String>>(0))
        .optional()
        .map_err(|error| format!("DSH {} 基线读取失败: {}", source, error))?
        .flatten();
    iso_to_unix_ms(value).map_err(|error| format!("{} [{}]", error, source))
}

pub fn read_canonical(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
) -> Result<CanonicalBaselines, String> {
    let outline = query_optional_i64(
        connection,
        "SELECT version FROM chapter_outlines WHERE chapter_id = ?1 ORDER BY version DESC LIMIT 1",
        chapter_id,
        "outline",
    )?;
    let chapter_context = query_optional_i64(
        connection,
        "SELECT draft_version FROM chapter_engineering_states WHERE chapter_id = ?1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
        chapter_id,
        "chapter_context",
    )?;
    let style_profile = query_optional_timestamp(
        connection,
        "SELECT updated_at FROM style_profiles WHERE novel_id = ?1 ORDER BY is_active DESC, updated_at DESC LIMIT 1",
        novel_id,
        "style_profile",
    )?;
    let output_control = query_optional_timestamp(
        connection,
        "SELECT updated_at
           FROM output_profiles
          WHERE novel_id IS NULL OR novel_id = ?1
          ORDER BY is_default DESC, updated_at DESC, id ASC
          LIMIT 1",
        novel_id,
        "output_control",
    )?;
    let character_states = query_optional_timestamp(
        connection,
        "SELECT MAX(created_at) FROM character_states WHERE chapter_id = ?1",
        chapter_id,
        "character_states",
    )?;
    let memory_index = query_optional_timestamp(
        connection,
        "SELECT MAX(updated_at) FROM memory_documents WHERE novel_id = ?1 AND status = 'active'",
        novel_id,
        "memory_index",
    )?;

    Ok(CanonicalBaselines {
        outline,
        chapter_context,
        style_profile,
        output_control,
        character_states,
        memory_index,
    })
}

pub fn verify_fresh(
    input: &ChapterPreparationInput,
    canonical: &CanonicalBaselines,
) -> Result<(), String> {
    let mut drift = Vec::new();
    for source in PROPOSAL_SOURCES {
        let snapshot = input
            .baseline_revisions
            .iter()
            .find(|entry| entry.source == source)
            .map(|entry| entry.revision);
        let current = canonical.revision_of(source);
        if snapshot != Some(current) {
            drift.push(format!(
                "{}: 快照 {} != 当前 {}",
                source,
                snapshot
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "缺失".to_string()),
                current
            ));
        }
    }
    if drift.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "基线修订号已漂移，请刷新后重试：{}",
            drift.join("；")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::super::models::ChapterBaselineRevision;
    use super::*;

    fn input(revisions: &[(&str, i64)]) -> ChapterPreparationInput {
        ChapterPreparationInput {
            novel_id: "novel-1".to_string(),
            chapter_id: "chapter-1".to_string(),
            baseline_revisions: revisions
                .iter()
                .map(|(source, revision)| ChapterBaselineRevision {
                    source: source.to_string(),
                    revision: *revision,
                })
                .collect(),
        }
    }

    fn canonical() -> CanonicalBaselines {
        CanonicalBaselines {
            outline: 7,
            chapter_context: 3,
            style_profile: 1_000,
            output_control: 2_000,
            character_states: 3_000,
            memory_index: 4_000,
        }
    }

    fn fresh_input() -> ChapterPreparationInput {
        input(&[
            ("outline", 7),
            ("chapter_context", 3),
            ("style_profile", 1_000),
            ("output_control", 2_000),
            ("character_states", 3_000),
            ("memory_index", 4_000),
        ])
    }

    #[test]
    fn fresh_snapshot_passes_and_drift_reports_the_source() {
        assert!(verify_fresh(&fresh_input(), &canonical()).is_ok());
        let mut stale = fresh_input();
        stale.baseline_revisions[0].revision = 6;
        let error = verify_fresh(&stale, &canonical()).expect_err("stale outline");
        assert!(error.contains("outline: 快照 6 != 当前 7"));
    }

    #[test]
    fn missing_source_is_rejected() {
        let mut missing = fresh_input();
        missing.baseline_revisions.pop();
        assert!(verify_fresh(&missing, &canonical())
            .expect_err("missing memory")
            .contains("memory_index: 快照 缺失"));
    }

    #[test]
    fn canonical_reader_returns_all_six_database_revisions() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE chapter_outlines (chapter_id TEXT, version INTEGER);
                 CREATE TABLE chapter_engineering_states (chapter_id TEXT, draft_version INTEGER, status TEXT, updated_at TEXT);
                 CREATE TABLE style_profiles (novel_id TEXT, is_active INTEGER, updated_at TEXT);
                 CREATE TABLE output_profiles (id TEXT, novel_id TEXT, is_default INTEGER, updated_at TEXT);
                 CREATE TABLE character_states (chapter_id TEXT, created_at TEXT);
                 CREATE TABLE memory_documents (novel_id TEXT, status TEXT, updated_at TEXT);
                 INSERT INTO chapter_outlines VALUES ('chapter-1', 7);
                 INSERT INTO chapter_engineering_states VALUES ('chapter-1', 3, 'active', '2026-08-19T00:00:00Z');
                 INSERT INTO style_profiles VALUES ('novel-1', 1, '2026-08-19T00:00:01Z');
                 INSERT INTO output_profiles VALUES ('shared', NULL, 1, '2026-08-19T00:00:02Z');
                 INSERT INTO output_profiles VALUES ('project', 'novel-1', 0, '2026-08-19T00:00:05Z');
                 INSERT INTO character_states VALUES ('chapter-1', '2026-08-19T00:00:03Z');
                 INSERT INTO memory_documents VALUES ('novel-1', 'active', '2026-08-19T00:00:04Z');",
            )
            .unwrap();
        let baselines = read_canonical(&connection, "novel-1", "chapter-1").unwrap();
        assert_eq!(baselines.outline, 7);
        assert_eq!(baselines.chapter_context, 3);
        assert!(baselines.style_profile < baselines.output_control);
        assert!(baselines.output_control < baselines.character_states);
        assert!(baselines.character_states < baselines.memory_index);
    }

    #[test]
    fn canonical_reader_fails_closed_when_schema_is_unavailable() {
        let connection = Connection::open_in_memory().unwrap();
        let error = read_canonical(&connection, "novel-1", "chapter-1")
            .expect_err("missing schema must fail");
        assert!(error.contains("outline 基线读取失败"));
    }
}
