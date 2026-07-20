use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, TryLockError};
use std::time::{Duration, Instant};

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

const E2E_FLAG: &str = "AI_NOVEL_STUDIO_E2E";
const E2E_DATA_DIR: &str = "AI_NOVEL_STUDIO_E2E_DATA_DIR";
const E2E_RUN_ID: &str = "AI_NOVEL_STUDIO_E2E_RUN_ID";
const E2E_MARKER_FILE: &str = ".ai-novel-studio-e2e-marker";
const WEBVIEW2_DATA_DIR: &str = "WEBVIEW2_USER_DATA_FOLDER";
const DATABASE_FILE: &str = "ai-novel-studio.db";
const DATABASE_LOCK_TIMEOUT: Duration = Duration::from_secs(2);
const DATABASE_LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(25);

const REQUIRED_E2E_TABLES: [&str; 7] = [
    "novels",
    "volumes",
    "chapters",
    "chapter_drafts",
    "ai_task_records",
    "generation_jobs",
    "generation_step_results",
];

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct E2eDiagnosticsCounts {
    pub novels: i64,
    pub volumes: i64,
    pub chapters: i64,
    pub chapter_drafts: i64,
    pub ai_tasks: i64,
    pub generation_jobs: i64,
    pub generation_steps: i64,
    pub adopted_drafts: i64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct E2eDiagnostics {
    pub enabled: bool,
    pub data_dir: String,
    pub database_path: String,
    pub network_blocked: bool,
    pub integrity_check: String,
    pub foreign_keys_enabled: bool,
    pub journal_mode: String,
    pub schema_ready: bool,
    pub counts: E2eDiagnosticsCounts,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct E2eNovelCommitState {
    pub row_count: i64,
    pub title: Option<String>,
    pub updated_at: Option<String>,
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
        format!("failed to resolve the E2E database for commit diagnostics: {}", error)
    })?;
    read_novel_commit_state(&database_path, &novel_id)
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
    append_e2e_log_at(&data_dir, "diagnostics: foreign key pragma");
    let foreign_keys_enabled = conn
        .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
        .map_err(|error| format!("failed to read SQLite foreign_keys pragma: {}", error))?
        == 1;
    append_e2e_log_at(&data_dir, "diagnostics: journal mode pragma");
    let journal_mode = conn
        .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
        .map_err(|error| format!("failed to read SQLite journal_mode pragma: {}", error))?;
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
    Ok(E2eDiagnostics {
        enabled: true,
        data_dir: data_dir.to_string_lossy().into_owned(),
        database_path: database_path.to_string_lossy().into_owned(),
        network_blocked: true,
        integrity_check,
        foreign_keys_enabled,
        journal_mode,
        schema_ready,
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
    if !REQUIRED_E2E_TABLES.contains(&table) {
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
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DIRECTORY_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn create_test_directory(label: &str) -> PathBuf {
        let counter = TEST_DIRECTORY_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "ai-novel-studio-runtime-{}-{}-{}",
            label,
            std::process::id(),
            counter
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_marker(data_dir: &Path, run_id: &str) {
        fs::write(data_dir.join(E2E_MARKER_FILE), run_id.as_bytes()).unwrap();
    }

    fn open_diagnostics_database(data_dir: &Path) -> Connection {
        fs::create_dir_all(data_dir).unwrap();
        Connection::open(data_dir.join(DATABASE_FILE)).unwrap()
    }

    #[test]
    fn e2e_feature_and_runtime_flag_must_agree() {
        assert!(validate_e2e_feature_contract(false, None).is_ok());
        assert!(validate_e2e_feature_contract(false, Some(OsStr::new("1"))).is_err());
        assert!(validate_e2e_feature_contract(true, None).is_err());
        assert!(validate_e2e_feature_contract(true, Some(OsStr::new("0"))).is_err());
        assert!(validate_e2e_feature_contract(true, Some(OsStr::new("1"))).is_ok());
    }

    #[test]
    fn disabled_e2e_mode_does_not_require_a_data_directory_or_run_id() {
        assert_eq!(resolve_e2e_data_dir(None, None, None).unwrap(), None);
        assert_eq!(
            resolve_e2e_data_dir(Some(OsString::from("0")), None, None).unwrap(),
            None
        );
    }

    #[test]
    fn enabled_e2e_mode_requires_an_existing_absolute_directory_and_run_id() {
        let enabled = Some(OsString::from("1"));
        assert!(resolve_e2e_data_dir(enabled.clone(), None, None).is_err());
        assert!(resolve_e2e_data_dir(
            enabled.clone(),
            Some(OsString::from("relative")),
            Some(OsString::from("run-1")),
        )
        .is_err());
        assert!(
            resolve_e2e_data_dir(enabled, Some(std::env::temp_dir().into_os_string()), None,)
                .is_err()
        );
    }

    #[test]
    fn enabled_e2e_mode_requires_a_matching_runner_marker() {
        let data_dir = create_test_directory("marker");
        let enabled = Some(OsString::from("1"));
        let run_id = Some(OsString::from("run-1"));

        assert!(resolve_e2e_data_dir(
            enabled.clone(),
            Some(data_dir.clone().into_os_string()),
            run_id.clone(),
        )
        .is_err());

        write_marker(&data_dir, "another-run");
        assert!(resolve_e2e_data_dir(
            enabled.clone(),
            Some(data_dir.clone().into_os_string()),
            run_id.clone(),
        )
        .is_err());

        write_marker(&data_dir, "run-1\n");
        let resolved =
            resolve_e2e_data_dir(enabled, Some(data_dir.clone().into_os_string()), run_id).unwrap();
        assert_eq!(resolved, Some(fs::canonicalize(&data_dir).unwrap()));

        fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn e2e_directory_must_be_a_dedicated_temp_child_and_not_production_data() {
        let temp_root = PathBuf::from("C:\\Temp");
        let child = temp_root.join("ai-novel-studio-e2e-run");
        let outside = PathBuf::from("C:\\workspace\\ai-novel-studio-e2e-run");
        let production = temp_root.join("AI Novel Studio");

        assert!(validate_canonical_e2e_dir(&child, &temp_root, None).is_ok());
        assert!(validate_canonical_e2e_dir(&temp_root, &temp_root, None).is_err());
        assert!(validate_canonical_e2e_dir(&outside, &temp_root, None).is_err());
        assert!(validate_canonical_e2e_dir(&production, &temp_root, Some(&production)).is_err());
        assert!(validate_canonical_e2e_dir(
            &production.join("nested"),
            &temp_root,
            Some(&production),
        )
        .is_err());
    }

    #[test]
    fn database_lock_wait_is_bounded() {
        let mutex = Mutex::new(());
        let _held_guard = mutex.lock().unwrap();
        let started_at = Instant::now();

        let error = try_lock_with_timeout(&mutex, Duration::from_millis(40)).unwrap_err();

        assert!(error.contains("timed out"));
        assert!(started_at.elapsed() >= Duration::from_millis(30));
        assert!(started_at.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn database_lock_is_returned_when_available() {
        let mutex = Mutex::new(7);
        let guard = try_lock_with_timeout(&mutex, Duration::from_millis(40)).unwrap();
        assert_eq!(*guard, 7);
    }

    #[test]
    fn diagnostics_report_database_health_real_path_and_counts() {
        let data_dir = create_test_directory("diagnostics");
        let conn = open_diagnostics_database(&data_dir);
        conn.execute_batch(
            "
            PRAGMA foreign_keys=ON;
            CREATE TABLE novels (id TEXT PRIMARY KEY);
            CREATE TABLE volumes (id TEXT PRIMARY KEY);
            CREATE TABLE chapters (id TEXT PRIMARY KEY);
            CREATE TABLE chapter_drafts (id TEXT PRIMARY KEY, is_adopted INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE ai_task_records (id TEXT PRIMARY KEY);
            CREATE TABLE generation_jobs (id TEXT PRIMARY KEY);
            CREATE TABLE generation_step_results (id TEXT PRIMARY KEY);
            INSERT INTO novels (id) VALUES ('novel-1');
            INSERT INTO chapter_drafts (id, is_adopted) VALUES ('draft-1', 1), ('draft-2', 0);
            ",
        )
        .unwrap();

        let diagnostics = build_e2e_diagnostics(&conn, data_dir.clone()).unwrap();
        let canonical_data_dir = fs::canonicalize(&data_dir).unwrap();
        let canonical_database = fs::canonicalize(data_dir.join(DATABASE_FILE)).unwrap();

        assert!(diagnostics.enabled);
        assert!(diagnostics.network_blocked);
        assert_eq!(diagnostics.integrity_check, "ok");
        assert!(diagnostics.foreign_keys_enabled);
        assert_eq!(diagnostics.journal_mode, "delete");
        assert!(diagnostics.schema_ready);
        assert_eq!(diagnostics.data_dir, canonical_data_dir.to_string_lossy());
        assert_eq!(
            diagnostics.database_path,
            canonical_database.to_string_lossy()
        );
        assert_eq!(diagnostics.counts.novels, 1);
        assert_eq!(diagnostics.counts.chapter_drafts, 2);
        assert_eq!(diagnostics.counts.adopted_drafts, 1);

        drop(conn);
        fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn commit_probe_reads_from_a_separate_read_only_connection() {
        let data_dir = create_test_directory("commit-probe");
        let database_path = data_dir.join(DATABASE_FILE);
        let mut writer = Connection::open(&database_path).unwrap();
        writer
            .execute_batch(
                "CREATE TABLE novels (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );",
            )
            .unwrap();

        let transaction = writer.transaction().unwrap();
        transaction
            .execute(
                "INSERT INTO novels (id, title, updated_at) VALUES (?1, ?2, ?3)",
                ["novel-1", "Uncommitted", "before"],
            )
            .unwrap();
        let before_commit = read_novel_commit_state(&database_path, "novel-1").unwrap();
        assert_eq!(before_commit.row_count, 0);

        transaction.commit().unwrap();
        let after_commit = read_novel_commit_state(&database_path, "novel-1").unwrap();
        assert_eq!(after_commit.row_count, 1);
        assert_eq!(after_commit.title.as_deref(), Some("Uncommitted"));
        assert_eq!(after_commit.updated_at.as_deref(), Some("before"));

        drop(writer);
        fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn diagnostics_reject_a_database_outside_the_e2e_data_directory() {
        let data_dir = create_test_directory("expected-database");
        let other_dir = create_test_directory("other-database");
        drop(open_diagnostics_database(&data_dir));
        let conn = open_diagnostics_database(&other_dir);

        let error = build_e2e_diagnostics(&conn, data_dir.clone()).unwrap_err();

        assert!(error.contains("path mismatch"));
        drop(conn);
        fs::remove_dir_all(data_dir).unwrap();
        fs::remove_dir_all(other_dir).unwrap();
    }

    #[test]
    fn diagnostics_mark_an_incomplete_schema_as_not_ready() {
        let data_dir = create_test_directory("incomplete-schema");
        let conn = open_diagnostics_database(&data_dir);
        conn.execute_batch(
            "
            CREATE TABLE novels (id TEXT PRIMARY KEY);
            CREATE TABLE volumes (id TEXT PRIMARY KEY);
            CREATE TABLE chapters (id TEXT PRIMARY KEY);
            CREATE TABLE chapter_drafts (id TEXT PRIMARY KEY, is_adopted INTEGER NOT NULL DEFAULT 0);
            ",
        )
        .unwrap();

        let diagnostics = build_e2e_diagnostics(&conn, data_dir.clone()).unwrap();

        assert!(!diagnostics.schema_ready);
        assert_eq!(diagnostics.counts.ai_tasks, 0);
        assert_eq!(diagnostics.counts.generation_jobs, 0);
        assert_eq!(diagnostics.counts.generation_steps, 0);

        drop(conn);
        fs::remove_dir_all(data_dir).unwrap();
    }

    #[test]
    fn diagnostics_are_gated_outside_e2e_mode() {
        assert!(diagnostics_outside_e2e_mode_is_rejected().is_err());
    }
}
