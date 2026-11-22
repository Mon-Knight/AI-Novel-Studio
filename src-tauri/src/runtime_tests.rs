use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

static TEST_DIRECTORY_COUNTER: AtomicU64 = AtomicU64::new(0);

#[test]
fn conversation_e2e_count_tables_are_explicitly_allowlisted() {
    let connection = Connection::open_in_memory().unwrap();
    for table in CONVERSATION_E2E_COUNT_TABLES {
        assert_eq!(count_rows(&connection, table).unwrap(), 0, "{table}");
    }
    assert!(count_rows(&connection, "sqlite_master")
        .unwrap_err()
        .contains("unsupported E2E diagnostics table"));
}

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
        CREATE TABLE quality_check_items (id TEXT PRIMARY KEY);
        CREATE TABLE quality_issue_states (id TEXT PRIMARY KEY);
        CREATE TABLE schema_migrations (
            migration_id TEXT PRIMARY KEY,
            version TEXT NOT NULL,
            checksum TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );
        CREATE TABLE ai_tasks (task_id TEXT PRIMARY KEY);
        CREATE TABLE ai_task_attempts (attempt_id TEXT PRIMARY KEY);
        CREATE TABLE ai_input_snapshots (snapshot_id TEXT PRIMARY KEY);
        CREATE TABLE ai_context_snapshots (snapshot_id TEXT PRIMARY KEY);
        CREATE TABLE ai_constraint_snapshots (snapshot_id TEXT PRIMARY KEY);
        CREATE TABLE result_artifacts (artifact_id TEXT PRIMARY KEY);
        CREATE TABLE artifact_validation_issues (issue_id TEXT PRIMARY KEY);
        CREATE TABLE placement_proposals (proposal_id TEXT PRIMARY KEY);
        CREATE TABLE apply_plans (plan_id TEXT PRIMARY KEY);
        CREATE TABLE artifact_target_links (link_id TEXT PRIMARY KEY);
        CREATE TABLE agent_plans (plan_id TEXT PRIMARY KEY);
        CREATE TABLE agent_plan_steps (step_id TEXT PRIMARY KEY);
        CREATE TABLE agent_plan_step_dependencies (step_id TEXT PRIMARY KEY);
        CREATE TABLE agent_plan_step_attempts (attempt_id TEXT PRIMARY KEY);
        CREATE TABLE agent_execution_leases (lease_id TEXT PRIMARY KEY);
        CREATE TABLE agent_plan_checkpoints (checkpoint_id TEXT PRIMARY KEY);
        INSERT INTO schema_migrations (migration_id, version, checksum, applied_at) VALUES
            ('001_generation_checkpoint_facts', '2.0.4', 'checksum-001', '2026-07-26T00:00:00Z'),
            ('002_workspace_recovery_snapshots', '2.2.0', 'checksum-002', '2026-07-26T00:00:00Z'),
            ('003_draft_operation_results', '2.2.0', 'checksum-003', '2026-07-26T00:00:00Z'),
            ('004_draft_operation_dispositions', '2.2.1', 'checksum-004', '2026-07-26T00:00:00Z'),
            ('005_ai_tasks', '2.3.0', 'checksum-005', '2026-07-26T00:00:00Z'),
            ('006_ai_task_attempts', '2.3.0', 'checksum-006', '2026-07-26T00:00:00Z'),
            ('007_ai_input_snapshots', '2.3.0', 'checksum-007', '2026-07-26T00:00:00Z'),
            ('008_ai_context_snapshots', '2.3.0', 'checksum-008', '2026-07-26T00:00:00Z'),
            ('009_ai_constraint_snapshots', '2.3.0', 'checksum-009', '2026-07-26T00:00:00Z'),
            ('010_result_artifacts', '2.3.0', 'checksum-010', '2026-07-26T00:00:00Z'),
            ('011_artifact_validation_issues', '2.3.0', 'checksum-011', '2026-07-26T00:00:00Z'),
            ('012_placement_proposals', '2.3.2', 'checksum-012', '2026-07-26T00:00:00Z'),
            ('013_apply_plans', '2.3.2', 'checksum-013', '2026-07-26T00:00:00Z'),
            ('014_artifact_target_links', '2.3.2', 'checksum-014', '2026-07-26T00:00:00Z'),
            ('015_agent_plans', '2.5.0', 'checksum-015', '2026-07-26T00:00:00Z'),
            ('016_agent_plan_steps', '2.5.0', 'checksum-016', '2026-07-26T00:00:00Z'),
            ('017_agent_plan_step_dependencies', '2.5.0', 'checksum-017', '2026-07-26T00:00:00Z'),
            ('018_agent_plan_step_attempts', '2.5.0', 'checksum-018', '2026-07-26T00:00:00Z'),
            ('019_agent_execution_leases', '2.5.0', 'checksum-019', '2026-07-26T00:00:00Z'),
            ('020_agent_plan_checkpoints', '2.5.0', 'checksum-020', '2026-07-26T00:00:00Z');
        INSERT INTO novels (id) VALUES ('novel-1');
        INSERT INTO chapter_drafts (id, is_adopted) VALUES ('draft-1', 1), ('draft-2', 0);
        ",
    )
    .unwrap();

    let expected_sqlite_identity: (String, String) = conn
        .query_row("SELECT sqlite_version(), sqlite_source_id()", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .unwrap();
    let diagnostics = build_e2e_diagnostics(&conn, data_dir.clone()).unwrap();
    let canonical_data_dir = fs::canonicalize(&data_dir).unwrap();
    let canonical_database = fs::canonicalize(data_dir.join(DATABASE_FILE)).unwrap();

    assert!(diagnostics.enabled);
    assert!(diagnostics.network_blocked);
    assert_eq!(diagnostics.integrity_check, "ok");
    assert!(diagnostics.database_runtime.foreign_keys_enabled);
    assert_eq!(diagnostics.database_runtime.journal_mode, "delete");
    assert_eq!(
        diagnostics.database_runtime.sqlite_version,
        expected_sqlite_identity.0
    );
    assert_eq!(
        diagnostics.database_runtime.sqlite_source_id,
        expected_sqlite_identity.1
    );
    assert_eq!(diagnostics.database_runtime.busy_timeout_ms, 5_000);
    assert_eq!(diagnostics.database_runtime.synchronous, "full");
    assert!(diagnostics
        .compile_options
        .windows(2)
        .all(|pair| pair[0] <= pair[1]));
    assert!(diagnostics
        .compile_options
        .iter()
        .any(|option| option == "ENABLE_FTS5"));
    assert!(diagnostics.json_enabled);
    assert!(diagnostics.schema_ready);
    assert_eq!(diagnostics.data_dir, canonical_data_dir.to_string_lossy());
    assert_eq!(
        diagnostics.database_path,
        canonical_database.to_string_lossy()
    );
    assert_eq!(diagnostics.counts.novels, 1);
    assert_eq!(diagnostics.counts.chapter_drafts, 2);
    assert_eq!(diagnostics.counts.adopted_drafts, 1);
    assert_eq!(diagnostics.migration_count, 20);
    assert_eq!(
        diagnostics.latest_migration_id.as_deref(),
        Some("020_agent_plan_checkpoints")
    );
    assert_eq!(diagnostics.counts.execution_tasks, 0);
    assert_eq!(diagnostics.counts.result_artifacts, 0);
    assert_eq!(diagnostics.counts.placement_proposals, 0);
    assert_eq!(diagnostics.counts.apply_plans, 0);
    assert_eq!(diagnostics.counts.artifact_target_links, 0);
    assert_eq!(diagnostics.counts.agent_plans, 0);
    assert_eq!(diagnostics.counts.agent_plan_steps, 0);
    assert_eq!(diagnostics.counts.agent_plan_attempts, 0);
    assert_eq!(diagnostics.counts.agent_plan_checkpoints, 0);

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
