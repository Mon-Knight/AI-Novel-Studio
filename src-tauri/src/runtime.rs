use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, TryLockError};
use std::time::{Duration, Instant};

#[cfg(feature = "e2e")]
use rusqlite::params;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;

const E2E_FLAG: &str = "AI_NOVEL_STUDIO_E2E";
const E2E_DATA_DIR: &str = "AI_NOVEL_STUDIO_E2E_DATA_DIR";
const E2E_RUN_ID: &str = "AI_NOVEL_STUDIO_E2E_RUN_ID";
const E2E_MARKER_FILE: &str = ".ai-novel-studio-e2e-marker";
const WEBVIEW2_DATA_DIR: &str = "WEBVIEW2_USER_DATA_FOLDER";
const DATABASE_FILE: &str = "ai-novel-studio.db";
const DATABASE_LOCK_TIMEOUT: Duration = Duration::from_secs(2);
const DATABASE_LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(25);

const REQUIRED_E2E_TABLES: [&str; 26] = [
    "novels",
    "volumes",
    "chapters",
    "chapter_drafts",
    "ai_task_records",
    "generation_jobs",
    "generation_step_results",
    "quality_check_items",
    "quality_issue_states",
    "schema_migrations",
    "ai_tasks",
    "ai_task_attempts",
    "ai_input_snapshots",
    "ai_context_snapshots",
    "ai_constraint_snapshots",
    "result_artifacts",
    "artifact_validation_issues",
    "placement_proposals",
    "apply_plans",
    "artifact_target_links",
    "agent_plans",
    "agent_plan_steps",
    "agent_plan_step_dependencies",
    "agent_plan_step_attempts",
    "agent_execution_leases",
    "agent_plan_checkpoints",
];

const CONVERSATION_E2E_COUNT_TABLES: [&str; 7] = [
    "task_conversations",
    "conversation_turns",
    "task_runs",
    "tool_call_events",
    "conversation_artifact_cards",
    "artifact_decisions",
    "review_authorizations",
];

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct E2eDiagnosticsCounts {
    pub novels: i64,
    pub volumes: i64,
    pub chapters: i64,
    pub chapter_drafts: i64,
    pub ai_tasks: i64,
    pub execution_tasks: i64,
    pub result_artifacts: i64,
    pub placement_proposals: i64,
    pub apply_plans: i64,
    pub artifact_target_links: i64,
    pub agent_plans: i64,
    pub agent_plan_steps: i64,
    pub agent_plan_attempts: i64,
    pub agent_plan_checkpoints: i64,
    pub generation_jobs: i64,
    pub generation_steps: i64,
    pub adopted_drafts: i64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct E2eCanonicalManifestAttestation {
    pub contract_version: String,
    pub projection_version: String,
    pub canonicalization: String,
    pub projection_hash: String,
    pub tool_identities: Vec<String>,
    pub model_visible_tool_identities: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct E2eDiagnostics {
    pub enabled: bool,
    pub process_id: u32,
    pub data_dir: String,
    pub database_path: String,
    pub network_blocked: bool,
    pub integrity_check: String,
    #[serde(flatten)]
    pub database_runtime: crate::db::DatabaseRuntimeDiagnostics,
    pub compile_options: Vec<String>,
    pub json_enabled: bool,
    pub schema_ready: bool,
    pub migration_count: i64,
    pub latest_migration_id: Option<String>,
    pub canonical_manifest: E2eCanonicalManifestAttestation,
    pub counts: E2eDiagnosticsCounts,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct E2eNovelCommitState {
    pub row_count: i64,
    pub title: Option<String>,
    pub updated_at: Option<String>,
}

#[cfg(feature = "e2e")]
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct E2eLargeTextDraftState {
    pub draft_id: String,
    pub chapter_id: String,
    pub large_text_ref_id: Option<String>,
    pub preview: String,
    pub document_count: i64,
    pub chunk_count: i64,
    pub total_chars: i64,
    pub total_bytes: i64,
    pub content_sha256: Option<String>,
    pub adopted: bool,
}

#[cfg(feature = "e2e")]
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct E2eLargeTextCorruptionResult {
    pub draft_id: String,
    pub document_id: String,
    pub chunk_index: i64,
    pub affected_rows: usize,
}

pub fn is_e2e_enabled() -> bool {
    std::env::var_os(E2E_FLAG).as_deref() == Some(OsStr::new("1"))
}

pub fn is_network_blocked() -> bool {
    is_e2e_enabled()
}

#[cfg(feature = "e2e")]
pub fn require_e2e_runtime_flag_for_feature() -> Result<(), String> {
    validate_e2e_feature_contract(true, std::env::var_os(E2E_FLAG).as_deref())
}

pub fn e2e_data_dir() -> Result<Option<PathBuf>, String> {
    let e2e_flag = std::env::var_os(E2E_FLAG);
    validate_e2e_feature_contract(cfg!(feature = "e2e"), e2e_flag.as_deref())?;
    resolve_e2e_data_dir(
        e2e_flag,
        std::env::var_os(E2E_DATA_DIR),
        std::env::var_os(E2E_RUN_ID),
    )
}

pub fn initialize_e2e_environment() -> Result<Option<PathBuf>, String> {
    let Some(data_dir) = e2e_data_dir()? else {
        return Ok(None);
    };

    let webview_data_dir = data_dir.join("webview2");
    fs::create_dir_all(&webview_data_dir).map_err(|error| {
        format!(
            "cannot create isolated WebView2 data directory at {}: {}",
            webview_data_dir.display(),
            error
        )
    })?;
    std::env::set_var(WEBVIEW2_DATA_DIR, &webview_data_dir);
    append_e2e_log_at(
        &data_dir,
        "runtime: E2E marker and isolated directories verified",
    );

    Ok(Some(data_dir))
}

pub fn append_e2e_log(message: &str) {
    if let Ok(Some(data_dir)) = e2e_data_dir() {
        append_e2e_log_at(&data_dir, message);
    }
}

fn append_e2e_log_at(data_dir: &Path, message: &str) {
    if !is_e2e_enabled() {
        return;
    }
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_dir.join("e2e-rust.log"))
    {
        let _ = writeln!(file, "{}", message);
    }
}

#[tauri::command]
pub fn get_e2e_diagnostics() -> Result<E2eDiagnostics, String> {
    let data_dir = e2e_data_dir()?
        .ok_or_else(|| "E2E diagnostics are unavailable outside E2E mode".to_string())?;
    append_e2e_log_at(
        &data_dir,
        "diagnostics: waiting up to 2 seconds for database lock",
    );
    let conn = try_lock_with_timeout(crate::db::get_connection(), DATABASE_LOCK_TIMEOUT)
        .map_err(|error| format!("E2E diagnostics database lock unavailable: {}", error))?;
    append_e2e_log_at(&data_dir, "diagnostics: database lock acquired");

    build_e2e_diagnostics(&conn, data_dir)
}

#[tauri::command]
pub fn get_e2e_novel_commit_state(novel_id: String) -> Result<E2eNovelCommitState, String> {
    let data_dir = e2e_data_dir()?
        .ok_or_else(|| "E2E commit diagnostics are unavailable outside E2E mode".to_string())?;
    let database_path = fs::canonicalize(data_dir.join(DATABASE_FILE)).map_err(|error| {
        format!(
            "failed to resolve the E2E database for commit diagnostics: {}",
            error
        )
    })?;
    read_novel_commit_state(&database_path, &novel_id)
}

#[cfg(feature = "e2e")]
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct E2eAgentClosedLoopState {
    pub process_id: u32,
    pub conversations_count: i64,
    pub turns_count: i64,
    pub runs_count: i64,
    pub tool_events_count: i64,
    pub result_artifacts_count: i64,
    pub artifact_decisions_count: i64,
    pub review_authorizations_count: i64,
    pub consumed_authorizations_count: i64,
    pub drafts_count: i64,
    pub chapters_count: i64,
    pub adopted_drafts_count: i64,
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub fn get_e2e_agent_closed_loop_state() -> Result<E2eAgentClosedLoopState, String> {
    require_e2e_command_data_dir("agent closed loop diagnostics")?;
    let conn = crate::db::get_connection()
        .lock()
        .map_err(|error| error.to_string())?;
    Ok(E2eAgentClosedLoopState {
        process_id: std::process::id(),
        conversations_count: count_rows(&conn, "task_conversations")?,
        turns_count: count_rows(&conn, "conversation_turns")?,
        runs_count: count_rows(&conn, "task_runs")?,
        tool_events_count: count_rows(&conn, "tool_call_events")?,
        result_artifacts_count: count_rows(&conn, "result_artifacts")?,
        artifact_decisions_count: count_rows(&conn, "artifact_decisions")?,
        review_authorizations_count: count_rows(&conn, "review_authorizations")?,
        consumed_authorizations_count: conn
            .query_row(
                "SELECT COUNT(*) FROM review_authorizations WHERE status = 'consumed'",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("count consumed review authorizations failed: {error}"))?,
        drafts_count: count_rows(&conn, "chapter_drafts")?,
        chapters_count: count_rows(&conn, "chapters")?,
        adopted_drafts_count: conn
            .query_row(
                "SELECT COUNT(*) FROM chapter_drafts WHERE is_adopted = 1",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("count adopted drafts failed: {error}"))?,
    })
}

#[cfg(feature = "e2e")]
fn require_e2e_command_data_dir(command: &str) -> Result<PathBuf, String> {
    e2e_data_dir()?.ok_or_else(|| format!("{} is unavailable outside E2E mode", command))
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub fn get_e2e_large_text_draft_state(draft_id: String) -> Result<E2eLargeTextDraftState, String> {
    require_e2e_command_data_dir("large-text draft diagnostics")?;
    let conn = crate::db::get_connection()
        .lock()
        .map_err(|error| error.to_string())?;
    let (chapter_id, large_text_ref_id, preview, adopted) = conn
        .query_row(
            "SELECT chapter_id, large_text_ref_id, content, is_adopted FROM chapter_drafts WHERE id = ?1",
            params![&draft_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)? != 0,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("failed to read E2E large-text draft state: {}", error))?
        .ok_or_else(|| format!("E2E large-text draft does not exist: {}", draft_id))?;

    let mut state = E2eLargeTextDraftState {
        draft_id: draft_id.clone(),
        chapter_id,
        large_text_ref_id: large_text_ref_id.clone(),
        preview,
        document_count: 0,
        chunk_count: 0,
        total_chars: 0,
        total_bytes: 0,
        content_sha256: None,
        adopted,
    };
    let Some(document_id) = large_text_ref_id else {
        return Ok(state);
    };

    state.document_count = conn
        .query_row(
            "SELECT COUNT(*) FROM large_text_documents WHERE id = ?1 AND target_type = 'draft' AND target_id = ?2 AND field_name = 'content'",
            params![&document_id, &draft_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("failed to count E2E large-text documents: {}", error))?;
    if let Some((total_chars, total_bytes, content_sha256)) = conn
        .query_row(
            "SELECT total_chars, total_bytes, content_sha256 FROM large_text_documents WHERE id = ?1",
            params![&document_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("failed to read E2E large-text document metadata: {}", error))?
    {
        state.total_chars = total_chars;
        state.total_bytes = total_bytes;
        state.content_sha256 = content_sha256;
    }
    state.chunk_count = conn
        .query_row(
            "SELECT COUNT(*) FROM large_text_chunks WHERE document_id = ?1",
            params![&document_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("failed to count E2E large-text chunks: {}", error))?;
    Ok(state)
}

#[cfg(feature = "e2e")]
#[tauri::command]
pub fn corrupt_e2e_large_text_chunk(
    draft_id: String,
    chunk_index: i64,
) -> Result<E2eLargeTextCorruptionResult, String> {
    require_e2e_command_data_dir("large-text corruption injection")?;
    if chunk_index < 0 {
        return Err("E2E large-text chunk index must be non-negative".to_string());
    }
    let conn = crate::db::get_connection()
        .lock()
        .map_err(|error| error.to_string())?;
    let document_id = conn
        .query_row(
            "SELECT document.id FROM chapter_drafts AS draft INNER JOIN large_text_documents AS document ON document.id = draft.large_text_ref_id AND document.target_type = 'draft' AND document.target_id = draft.id AND document.field_name = 'content' WHERE draft.id = ?1",
            params![&draft_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("failed to resolve E2E large-text draft binding: {}", error))?
        .ok_or_else(|| format!("E2E draft has no valid large-text binding: {}", draft_id))?;
    let affected_rows = conn
        .execute(
            "UPDATE large_text_chunks SET content = content || '\n[E2E_CORRUPTED_CHUNK]' WHERE document_id = ?1 AND chunk_index = ?2",
            params![&document_id, chunk_index],
        )
        .map_err(|error| format!("failed to corrupt E2E large-text chunk: {}", error))?;
    if affected_rows != 1 {
        return Err(format!(
            "E2E large-text corruption expected one chunk, affected {}",
            affected_rows
        ));
    }
    append_e2e_log("fault-injection: corrupted one isolated large-text chunk");
    Ok(E2eLargeTextCorruptionResult {
        draft_id,
        document_id,
        chunk_index,
        affected_rows,
    })
}

#[cfg(test)]
fn diagnostics_outside_e2e_mode_is_rejected() -> Result<E2eDiagnostics, String> {
    Err("E2E diagnostics are unavailable outside E2E mode".to_string())
}

fn try_lock_with_timeout<T>(
    mutex: &Mutex<T>,
    timeout: Duration,
) -> Result<MutexGuard<'_, T>, String> {
    let started_at = Instant::now();
    loop {
        match mutex.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(TryLockError::Poisoned(error)) => {
                return Err(format!("database lock is poisoned: {}", error));
            }
            Err(TryLockError::WouldBlock) => {
                if started_at.elapsed() >= timeout {
                    return Err(format!("timed out after {} ms", timeout.as_millis()));
                }

                let remaining = timeout.saturating_sub(started_at.elapsed());
                std::thread::sleep(std::cmp::min(DATABASE_LOCK_RETRY_INTERVAL, remaining));
            }
        }
    }
}

fn build_e2e_diagnostics(conn: &Connection, data_dir: PathBuf) -> Result<E2eDiagnostics, String> {
    let data_dir = fs::canonicalize(&data_dir).map_err(|error| {
        format!(
            "failed to canonicalize E2E data directory {}: {}",
            data_dir.display(),
            error
        )
    })?;
    let database_path = verified_main_database_path(conn, &data_dir)?;

    append_e2e_log_at(&data_dir, "diagnostics: integrity check");
    let integrity_check = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
        .map_err(|error| format!("failed to run SQLite integrity check: {}", error))?;
    append_e2e_log_at(&data_dir, "diagnostics: database runtime");
    let database_runtime = crate::db::read_database_runtime_diagnostics(conn)
        .map_err(|error| format!("failed to read SQLite runtime diagnostics: {}", error))?;
    append_e2e_log_at(&data_dir, "diagnostics: compile options");
    let mut compile_options = conn
        .prepare("PRAGMA compile_options")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .map_err(|error| format!("failed to read SQLite compile options: {}", error))?;
    compile_options.sort_unstable();
    let json_enabled = conn
        .query_row("SELECT json_valid('{}')", [], |row| row.get::<_, i64>(0))
        .map_err(|error| format!("failed to verify SQLite JSON support: {}", error))?
        == 1;
    append_e2e_log_at(&data_dir, "diagnostics: schema and row counts");
    let schema_ready = REQUIRED_E2E_TABLES
        .iter()
        .map(|table| table_exists(conn, table))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .all(|exists| exists);

    let counts = E2eDiagnosticsCounts {
        novels: count_rows(conn, "novels")?,
        volumes: count_rows(conn, "volumes")?,
        chapters: count_rows(conn, "chapters")?,
        chapter_drafts: count_rows(conn, "chapter_drafts")?,
        ai_tasks: count_rows(conn, "ai_task_records")?,
        execution_tasks: count_rows(conn, "ai_tasks")?,
        result_artifacts: count_rows(conn, "result_artifacts")?,
        placement_proposals: count_rows(conn, "placement_proposals")?,
        apply_plans: count_rows(conn, "apply_plans")?,
        artifact_target_links: count_rows(conn, "artifact_target_links")?,
        agent_plans: count_rows(conn, "agent_plans")?,
        agent_plan_steps: count_rows(conn, "agent_plan_steps")?,
        agent_plan_attempts: count_rows(conn, "agent_plan_step_attempts")?,
        agent_plan_checkpoints: count_rows(conn, "agent_plan_checkpoints")?,
        generation_jobs: count_rows(conn, "generation_jobs")?,
        generation_steps: count_rows(conn, "generation_step_results")?,
        adopted_drafts: if table_exists(conn, "chapter_drafts")? {
            conn.query_row(
                "SELECT COUNT(*) FROM chapter_drafts WHERE is_adopted = 1",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("failed to count adopted chapter_drafts: {}", error))?
        } else {
            0
        },
    };

    append_e2e_log_at(&data_dir, "diagnostics: complete");
    let migration_count = count_rows(conn, "schema_migrations")?;
    let latest_migration_id = if table_exists(conn, "schema_migrations")? {
        conn.query_row(
            "SELECT migration_id FROM schema_migrations ORDER BY migration_id DESC LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("failed to inspect migration ledger: {error}"))?
    } else {
        None
    };

    let canonical_manifest =
        crate::services::dsh::canonical_manifest::canonical_manifest_attestation()
            .map_err(|error| format!("canonical manifest attestation failed: {}", error.message))?;

    Ok(E2eDiagnostics {
        enabled: true,
        process_id: std::process::id(),
        data_dir: data_dir.to_string_lossy().into_owned(),
        database_path: database_path.to_string_lossy().into_owned(),
        network_blocked: true,
        integrity_check,
        database_runtime,
        compile_options,
        json_enabled,
        schema_ready,
        migration_count,
        latest_migration_id,
        canonical_manifest: E2eCanonicalManifestAttestation {
            contract_version: canonical_manifest.contract_version,
            projection_version: canonical_manifest.projection_version,
            canonicalization: canonical_manifest.canonicalization,
            projection_hash: canonical_manifest.projection_hash,
            tool_identities: canonical_manifest.tool_identities,
            model_visible_tool_identities: canonical_manifest.model_visible_tool_identities,
        },
        counts,
    })
}

fn verified_main_database_path(conn: &Connection, data_dir: &Path) -> Result<PathBuf, String> {
    let mut statement = conn
        .prepare("PRAGMA database_list")
        .map_err(|error| format!("failed to prepare SQLite database_list pragma: {}", error))?;
    let mut rows = statement
        .query([])
        .map_err(|error| format!("failed to read SQLite database_list pragma: {}", error))?;
    let mut main_database_path = None;

    while let Some(row) = rows
        .next()
        .map_err(|error| format!("failed to iterate SQLite database_list pragma: {}", error))?
    {
        let name = row
            .get::<_, String>(1)
            .map_err(|error| format!("failed to read SQLite database name: {}", error))?;
        if name == "main" {
            let path = row
                .get::<_, String>(2)
                .map_err(|error| format!("failed to read SQLite main database path: {}", error))?;
            if path.is_empty() {
                return Err("SQLite main database is not file-backed".to_string());
            }
            main_database_path = Some(PathBuf::from(path));
            break;
        }
    }

    let reported_path = main_database_path
        .ok_or_else(|| "SQLite database_list did not report a main database".to_string())?;
    let reported_path = fs::canonicalize(&reported_path).map_err(|error| {
        format!(
            "failed to canonicalize SQLite main database path {}: {}",
            reported_path.display(),
            error
        )
    })?;
    let expected_path = data_dir.join(DATABASE_FILE);
    let expected_path = fs::canonicalize(&expected_path).map_err(|error| {
        format!(
            "failed to canonicalize expected E2E database path {}: {}",
            expected_path.display(),
            error
        )
    })?;

    if reported_path != expected_path {
        return Err(format!(
            "SQLite main database path mismatch: expected {}, got {}",
            expected_path.display(),
            reported_path.display()
        ));
    }

    Ok(reported_path)
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [table],
        |row| row.get::<_, i64>(0),
    )
    .map(|exists| exists == 1)
    .map_err(|error| format!("failed to inspect SQLite schema for {}: {}", table, error))
}

fn count_rows(conn: &Connection, table: &str) -> Result<i64, String> {
    if !REQUIRED_E2E_TABLES.contains(&table) && !CONVERSATION_E2E_COUNT_TABLES.contains(&table) {
        return Err(format!("unsupported E2E diagnostics table: {}", table));
    }

    if !table_exists(conn, table)? {
        return Ok(0);
    }

    conn.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |row| {
        row.get(0)
    })
    .map_err(|error| format!("failed to count {} rows: {}", table, error))
}

fn read_novel_commit_state(
    database_path: &Path,
    novel_id: &str,
) -> Result<E2eNovelCommitState, String> {
    let connection = Connection::open_with_flags(
        database_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("failed to open the E2E database read-only: {}", error))?;

    connection
        .query_row(
            "SELECT COUNT(*), MAX(title), MAX(updated_at) FROM novels WHERE id = ?1 AND deleted_at IS NULL",
            [novel_id],
            |row| {
                Ok(E2eNovelCommitState {
                    row_count: row.get(0)?,
                    title: row.get(1)?,
                    updated_at: row.get(2)?,
                })
            },
        )
        .map_err(|error| format!("failed to read committed E2E novel state: {}", error))
}

fn validate_e2e_feature_contract(
    feature_enabled: bool,
    e2e_flag: Option<&OsStr>,
) -> Result<(), String> {
    let runtime_enabled = e2e_flag == Some(OsStr::new("1"));
    if feature_enabled && !runtime_enabled {
        return Err(format!(
            "an executable built with the e2e feature requires {}=1",
            E2E_FLAG
        ));
    }
    if !feature_enabled && runtime_enabled {
        return Err(format!(
            "{}=1 requires an executable built with the Cargo e2e feature",
            E2E_FLAG
        ));
    }
    Ok(())
}

fn resolve_e2e_data_dir(
    e2e_flag: Option<OsString>,
    data_dir: Option<OsString>,
    run_id: Option<OsString>,
) -> Result<Option<PathBuf>, String> {
    if e2e_flag.as_deref() != Some(OsStr::new("1")) {
        return Ok(None);
    }

    let value =
        data_dir.ok_or_else(|| format!("{}=1 requires an absolute {}", E2E_FLAG, E2E_DATA_DIR))?;
    if value.is_empty() {
        return Err(format!(
            "{}=1 requires a non-empty absolute {}",
            E2E_FLAG, E2E_DATA_DIR
        ));
    }

    let run_id = run_id.ok_or_else(|| format!("{}=1 requires {}", E2E_FLAG, E2E_RUN_ID))?;
    let run_id = run_id
        .into_string()
        .map_err(|_| format!("{} must contain valid UTF-8", E2E_RUN_ID))?;
    if run_id.is_empty() || run_id.contains(|character| character == '\r' || character == '\n') {
        return Err(format!(
            "{}=1 requires a non-empty single-line {}",
            E2E_FLAG, E2E_RUN_ID
        ));
    }

    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(format!(
            "{} must be an absolute path when {}=1: {}",
            E2E_DATA_DIR,
            E2E_FLAG,
            path.display()
        ));
    }

    let metadata = fs::metadata(&path).map_err(|error| {
        format!(
            "{} must already exist before E2E startup at {}: {}",
            E2E_DATA_DIR,
            path.display(),
            error
        )
    })?;
    if !metadata.is_dir() {
        return Err(format!(
            "{} must point to a directory: {}",
            E2E_DATA_DIR,
            path.display()
        ));
    }

    let path = fs::canonicalize(&path).map_err(|error| {
        format!(
            "cannot canonicalize {} at {}: {}",
            E2E_DATA_DIR,
            path.display(),
            error
        )
    })?;
    let temp_root = fs::canonicalize(std::env::temp_dir()).map_err(|error| {
        format!(
            "cannot canonicalize the operating system temporary directory: {}",
            error
        )
    })?;
    let production_data_dir = canonical_production_data_dir()?;
    validate_canonical_e2e_dir(&path, &temp_root, production_data_dir.as_deref())?;

    let marker_path = path.join(E2E_MARKER_FILE);
    let marker_metadata = fs::metadata(&marker_path).map_err(|error| {
        format!(
            "E2E marker is required at {}: {}",
            marker_path.display(),
            error
        )
    })?;
    if !marker_metadata.is_file() {
        return Err(format!(
            "E2E marker must be a file: {}",
            marker_path.display()
        ));
    }
    let marker_run_id = fs::read_to_string(&marker_path).map_err(|error| {
        format!(
            "cannot read E2E marker at {}: {}",
            marker_path.display(),
            error
        )
    })?;
    let marker_run_id = marker_run_id
        .strip_suffix("\r\n")
        .or_else(|| marker_run_id.strip_suffix('\n'))
        .unwrap_or(&marker_run_id);
    if marker_run_id != run_id {
        return Err(format!(
            "E2E marker at {} does not match {}",
            marker_path.display(),
            E2E_RUN_ID
        ));
    }

    Ok(Some(path))
}

fn canonical_production_data_dir() -> Result<Option<PathBuf>, String> {
    let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") else {
        return Ok(None);
    };
    let production_data_dir = PathBuf::from(local_app_data).join("AI Novel Studio");
    match fs::metadata(&production_data_dir) {
        Ok(_) => fs::canonicalize(&production_data_dir)
            .map(Some)
            .map_err(|error| {
                format!(
                    "cannot canonicalize production data directory {}: {}",
                    production_data_dir.display(),
                    error
                )
            }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "cannot inspect production data directory {}: {}",
            production_data_dir.display(),
            error
        )),
    }
}

fn validate_canonical_e2e_dir(
    data_dir: &Path,
    temp_root: &Path,
    production_data_dir: Option<&Path>,
) -> Result<(), String> {
    if data_dir.parent().is_none() {
        return Err(format!(
            "{} cannot be a filesystem root: {}",
            E2E_DATA_DIR,
            data_dir.display()
        ));
    }
    if let Some(production_data_dir) = production_data_dir {
        if data_dir == production_data_dir || data_dir.starts_with(production_data_dir) {
            return Err(format!(
                "{} cannot use the production data directory: {}",
                E2E_DATA_DIR,
                data_dir.display()
            ));
        }
    }
    if data_dir == temp_root || !data_dir.starts_with(temp_root) {
        return Err(format!(
            "{} must be a dedicated child of the operating system temporary directory {}: {}",
            E2E_DATA_DIR,
            temp_root.display(),
            data_dir.display()
        ));
    }
    Ok(())
}

#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;
