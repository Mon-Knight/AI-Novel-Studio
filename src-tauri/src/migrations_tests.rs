use super::*;
use std::fs;
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::Duration;

const EXPECTED_MIGRATION_CHECKSUMS: [(&str, &str); 39] = [
    (
        "001_schema_migrations",
        "65e4591cc3a707e67920683594bc839909a942cab697c15831fa1e1d1a9207b1",
    ),
    (
        "002_workspace_recovery_snapshots",
        "7b3d51eb4fedcdac62b04d427746c8990a43d1ce98a1e80ea2f4b3e2429ee739",
    ),
    (
        "003_draft_save_operations",
        "62d442e75b5bdf0fb1e1149d454cce9611f42221185bb7b5e16eab762c77e1ec",
    ),
    (
        "004_large_text_integrity",
        "6397a9245892ad2b77472f203055f9e1f13ceb90f30b60d4062f4fb007d2d15b",
    ),
    (
        "005_ai_tasks",
        "86f8285a333d77c05ff07556a7d8a35f5d6f28ad0a21ecd9ede45b03a9cb9d9f",
    ),
    (
        "006_ai_task_attempts",
        "9bf5adc5683e5e2c4384c299e30e782ca604f059df2acb244742ae329d1a7406",
    ),
    (
        "007_ai_input_snapshots",
        "096e07deccdd9c6ce202cfefd729f38cf5a6d899aece4cac7dc097028136107c",
    ),
    (
        "008_ai_context_snapshots",
        "38a009d092f26ccb6f6860f1697fdf6b1f6432293b12e975f0980b2f7d270db8",
    ),
    (
        "009_ai_constraint_snapshots",
        "20cff44a9ea326ca0bd05f3c2d1a3bb3d13692754142b6948b22051b0757398d",
    ),
    (
        "010_result_artifacts",
        "10d26a27702fb70b1a22b17bc775f1e17527bd5d431ca6fdd23276596ae79e58",
    ),
    (
        "011_artifact_validation_issues",
        "0232fec8a74c153c5f5aa0004a8a61f823e2b0b6dddf1928eda9e78fab20ec67",
    ),
    (
        "012_placement_proposals",
        "44e81ec6116531691a4e6232e1f41889e0d40328ab3df735eeb48b1c470b937a",
    ),
    (
        "013_apply_plans",
        "d4b213d255d1626648e42e672ffe50fe94793e3b027c406b397fa5a060b634e1",
    ),
    (
        "014_artifact_target_links",
        "168fb1e5d289cd1a1fd0b4fdc01e2e229c54d7634762130789412d190207a4f0",
    ),
    (
        "015_agent_plans",
        "717a12104caaded6d71f868e0ea0b67c80df5a0fea5d43962c5b1449a7895283",
    ),
    (
        "016_agent_plan_steps",
        "4893dbcbbb70025eb567ebe3d1ef6b7cb661c23013dc37b2f72e9dc0c2c57e4e",
    ),
    (
        "017_agent_plan_step_dependencies",
        "8c529cce5b3b8279d5dd20f3c289d654c4e8ff54150b42594dbdba1ef3f52e85",
    ),
    (
        "018_agent_plan_step_attempts",
        "fbd7fec3b8f47eaf0f0f0e3f03771d729d54a3b649328cd78c0fa98bb22e8506",
    ),
    (
        "019_agent_execution_leases",
        "bcf2233f99cc29a124f08d719bbb2c6311e4261e064c43e4b80085f53cafcfc1",
    ),
    (
        "020_agent_plan_checkpoints",
        "4341b1035cd13cf6dca38397377d45575363bee98ffdad746d02862764607045",
    ),
    (
        "021_multi_agent_sessions",
        "e8878c39009e7830db32d3be64dc22e387ea8e96d644ba8a16d0a56c3e705367",
    ),
    (
        "022_multi_agent_rounds",
        "f7421084435da8a403c7178f3bbedfee80fa499be21f7449ffc4cd027cc57919",
    ),
    (
        "023_multi_agent_opinions",
        "d49e6ba3cb7961c35579bd01b9c5dd7e0dda208b54fff6317f16821058e34911",
    ),
    (
        "024_autonomous_story_plans",
        "3a5e391fa6ed9c360472a71cdfd0f09a759112fba283e180d8c3cba113b3eb53",
    ),
    (
        "025_reference_library",
        "8980119b08c81d8b48d986150fa8a835390fb85594677f3c296a37dc740f9293",
    ),
    (
        "026_hybrid_semantic_memory",
        "a8622dab5bf60ec4cc7177437fe2e2c5c5da753045b339cac01b0083ce163b0b",
    ),
    (
        "027_autonomous_book_scheduler",
        "bfe8cc7dd1fbe7d9da6664b611d2f5c2aef97ace02ea768862e74b4a01d085c4",
    ),
    (
        "028_multi_target_transactions_and_story_assets",
        "57a0165d8f5e5f75db523325476a5187763c17ee7eb56c76c9faac767150d3e9",
    ),
    (
        "029_global_ai_request_policy",
        "cc2caf7c92d84eef722b109d67bba83b4c8015f893dedae099cb3662d0d4ebdc",
    ),
    (
        "030_output_profile_fields",
        "b3b5f6759e3d8dd8ff58229b2f0baf3d39295903e474120c598a941d56a067de",
    ),
    (
        "031_dsh_preparation_runs",
        "4ebb60ca4e56603635cbc20f8065a7c0643c9e267d73cf27872fce2ed8b202ff",
    ),
    (
        "032_conversation_workbench",
        "76bb095009183591d951de7ea0e55e1904f12cafe52aaa45623bf8ddea3fdadc",
    ),
    (
        "033_conversation_workbench_guards",
        "74563051c064a4ab5ef571234527b1aef66fea3ef43a77193af598c3c84554fc",
    ),
    (
        "034_conversation_artifact_projection",
        "03521e2becc8ec47c7be95bd63d901478a2677a1448803cb7f4c1e03b10910b1",
    ),
    (
        "035_conversation_tool_call_identity",
        "77079cac687b36bd22c6a000fe55e68ee150017be512337c6df7efe259be41ad",
    ),
    (
        "036_artifact_decisions_and_review_auth",
        "10dbc72d0f9a861972fb21c963ec468935cc3c2106f1c74677edbd499a99783c",
    ),
    (
        "037_user_templates_and_setting_suggestions",
        "014aa444b946d1a6e9f89334441238ffa0ea39992938550592e81b6d9ca0fdea",
    ),
    (
        "038_task_runs_chapter_binding",
        "fc9b8fc49ac1ea8dd5c6ece3f179ab0921a523ee54de99577e0a798658cc749a",
    ),
    (
        "039_result_artifacts_cross_task_lineage",
        "0ccb6cd137c15169baa1e1e9dda456ea17aa9046cd7b3291df72c37b89307105",
    ),
];

include!("migrations_cross_task_lineage_tests.rs");

fn run_migrations_through(connection: &mut Connection, count: usize) -> Result<(), AppError> {
    for migration in migrations().into_iter().take(count) {
        let transaction = connection.transaction().map_err(AppError::database)?;
        create_ledger(&transaction)?;
        let expected_checksum = checksum(migration.definition);
        let existing_checksum = transaction
            .query_row(
                "SELECT checksum FROM schema_migrations WHERE migration_id = ?1",
                params![migration.id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(AppError::database)?;
        if let Some(actual_checksum) = existing_checksum {
            if actual_checksum != expected_checksum {
                return Err(AppError::new(
                    codes::DATABASE_TRANSACTION_FAILED,
                    "数据库迁移校验失败",
                    false,
                ));
            }
        } else {
            (migration.apply)(&transaction)?;
            transaction
                .execute(
                    "INSERT INTO schema_migrations
                        (migration_id, version, checksum, applied_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![
                        migration.id,
                        "2.2.0",
                        expected_checksum,
                        Utc::now().to_rfc3339()
                    ],
                )
                .map_err(AppError::database)?;
        }
        transaction.commit().map_err(AppError::database)?;
    }
    Ok(())
}

fn legacy_schema(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "CREATE TABLE chapter_drafts (
            id TEXT PRIMARY KEY,
            novel_id TEXT NOT NULL,
            chapter_id TEXT NOT NULL,
            content TEXT NOT NULL,
            version_no INTEGER NOT NULL,
            large_text_ref_id TEXT
        );
        INSERT INTO chapter_drafts
            (id, novel_id, chapter_id, content, version_no, large_text_ref_id)
        VALUES ('legacy-draft', 'legacy-novel', 'legacy-chapter', 'legacy content', 1, NULL);",
    )
}

#[test]
fn db01_initializes_ordered_migration_ledger() -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = Connection::open_in_memory()?;
    legacy_schema(&connection)?;
    run_migrations(&mut connection)?;
    let migrations = list_applied(&connection)?;
    assert_eq!(migrations.len(), EXPECTED_MIGRATION_CHECKSUMS.len());
    for (applied, (expected_id, expected_checksum)) in
        migrations.iter().zip(EXPECTED_MIGRATION_CHECKSUMS)
    {
        assert_eq!(applied.migration_id, expected_id);
        assert_eq!(applied.checksum, expected_checksum);
    }
    Ok(())
}

#[test]
fn db02_repeated_migration_is_idempotent() -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = Connection::open_in_memory()?;
    legacy_schema(&connection)?;
    run_migrations(&mut connection)?;
    let first = list_applied(&connection)?;
    assert!(first
        .iter()
        .rev()
        .take(2)
        .all(|migration| migration.version == "3.3.0"));
    run_migrations(&mut connection)?;
    assert_eq!(list_applied(&connection)?, first);
    let content: String = connection.query_row(
        "SELECT content FROM chapter_drafts WHERE id = 'legacy-draft'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(content, "legacy content");
    Ok(())
}

#[test]
fn db03_checksum_conflict_stops_migrations() -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = Connection::open_in_memory()?;
    legacy_schema(&connection)?;
    run_migrations(&mut connection)?;
    connection.execute(
        "UPDATE schema_migrations SET checksum = 'tampered' WHERE migration_id = '002_workspace_recovery_snapshots'",
        [],
    )?;
    let error = run_migrations(&mut connection).expect_err("checksum mismatch must fail");
    assert_eq!(error.code, codes::DATABASE_TRANSACTION_FAILED);
    assert_eq!(
        error
            .details
            .as_ref()
            .and_then(|details| details["migrationId"].as_str()),
        Some("002_workspace_recovery_snapshots")
    );
    Ok(())
}

#[test]
fn db15_upgrades_legacy_schema_and_preserves_draft() -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = Connection::open_in_memory()?;
    legacy_schema(&connection)?;
    run_migrations(&mut connection)?;
    let content: String = connection.query_row(
        "SELECT content FROM chapter_drafts WHERE id = 'legacy-draft'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(content, "legacy content");
    assert!(table_has_column(
        &connection.unchecked_transaction()?,
        "chapter_drafts",
        "content_hash"
    )?);
    Ok(())
}

#[test]
fn db17_m1_schema_has_all_tables_indexes_triggers_and_clean_foreign_keys(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = Connection::open_in_memory()?;
    connection.execute_batch("PRAGMA foreign_keys=ON;")?;
    legacy_schema(&connection)?;
    run_migrations(&mut connection)?;
    for table in [
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
    ] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            params![table],
            |row| row.get(0),
        )?;
        assert_eq!(exists, 1, "missing M1 table {table}");
    }
    for index in [
        "idx_ai_tasks_novel_status_created",
        "uq_ai_task_attempts_one_live",
        "idx_ai_input_snapshots_source",
        "idx_result_artifacts_task_created",
        "uq_result_artifacts_attempt_root",
        "idx_artifact_validation_artifact",
        "idx_placement_proposals_artifact",
        "idx_apply_plans_status",
        "idx_artifact_target_links_artifact",
    ] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1",
            params![index],
            |row| row.get(0),
        )?;
        assert_eq!(exists, 1, "missing M1 index {index}");
    }
    for trigger in [
        "trg_ai_tasks_validate_target_insert",
        "trg_ai_task_attempts_status_edges",
        "trg_ai_input_snapshots_immutable_update",
        "trg_ai_context_snapshots_immutable_delete",
        "trg_ai_constraint_snapshots_validate_insert",
        "trg_result_artifacts_validate_insert",
        "trg_ai_large_text_chunks_immutable_update",
        "trg_artifact_validation_issues_append_only_delete",
        "trg_placement_proposals_immutable_update",
        "trg_apply_plans_status_edges",
        "trg_artifact_target_links_validate_insert",
    ] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name=?1",
            params![trigger],
            |row| row.get(0),
        )?;
        assert_eq!(exists, 1, "missing M1 trigger {trigger}");
    }
    let foreign_key_errors = connection
        .prepare("PRAGMA foreign_key_check")?
        .query_map([], |_| Ok(()))?
        .count();
    assert_eq!(foreign_key_errors, 0);
    let integrity: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    assert_eq!(integrity, "ok");
    Ok(())
}

#[test]
fn db18_failed_current_migration_rolls_back_without_forging_ledger(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = Connection::open_in_memory()?;
    legacy_schema(&connection)?;
    connection.execute_batch("CREATE TABLE ai_task_attempts (broken_column TEXT);")?;
    assert!(run_migrations(&mut connection).is_err());
    let applied = list_applied(&connection)?;
    assert_eq!(
        applied.last().map(|item| item.migration_id.as_str()),
        Some("005_ai_tasks")
    );
    assert!(applied
        .iter()
        .all(|item| item.migration_id != "006_ai_task_attempts"));
    let malformed_columns: i64 = connection.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('ai_task_attempts')",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(malformed_columns, 1);
    Ok(())
}

fn table_columns(connection: &Connection, table: &str) -> rusqlite::Result<Vec<String>> {
    let quoted = table.replace('"', "\"\"");
    let mut statement = connection.prepare(&format!("PRAGMA table_info(\"{quoted}\")"))?;
    let columns = statement
        .query_map([], |row| row.get(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(columns)
}

#[test]
fn db19_upgrade_preserves_legacy_rows_and_business_table_shapes(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = Connection::open_in_memory()?;
    connection.execute_batch(
        "CREATE TABLE chapter_drafts (
            id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
            content TEXT NOT NULL, version_no INTEGER NOT NULL, is_adopted INTEGER NOT NULL,
            large_text_ref_id TEXT, content_hash TEXT
         );
         CREATE TABLE chapters (id TEXT PRIMARY KEY, adopted_draft_id TEXT);
         CREATE TABLE quality_check_reports (id TEXT PRIMARY KEY, report_json TEXT);
         CREATE TABLE ai_task_records (id TEXT PRIMARY KEY, status TEXT, result_text TEXT);
         CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, status TEXT);
         INSERT INTO chapter_drafts VALUES
            ('draft-a','novel-a','chapter-a','legacy adopted body',3,1,NULL,'hash-a');
         INSERT INTO chapters VALUES ('chapter-a','draft-a');
         INSERT INTO quality_check_reports VALUES ('report-a','legacy report');
         INSERT INTO ai_task_records VALUES ('legacy-task','succeeded','legacy result');
         INSERT INTO generation_jobs VALUES ('legacy-job','completed');",
    )?;
    let draft_columns_before = table_columns(&connection, "chapter_drafts")?;
    let report_columns_before = table_columns(&connection, "quality_check_reports")?;
    run_migrations(&mut connection)?;
    assert_eq!(
        table_columns(&connection, "chapter_drafts")?,
        draft_columns_before
    );
    assert_eq!(
        table_columns(&connection, "quality_check_reports")?,
        report_columns_before
    );
    let adopted: String = connection.query_row(
        "SELECT adopted_draft_id FROM chapters WHERE id='chapter-a'",
        [],
        |row| row.get(0),
    )?;
    let legacy_result: String = connection.query_row(
        "SELECT result_text FROM ai_task_records WHERE id='legacy-task'",
        [],
        |row| row.get(0),
    )?;
    let legacy_job: String = connection.query_row(
        "SELECT status FROM generation_jobs WHERE id='legacy-job'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(adopted, "draft-a");
    assert_eq!(legacy_result, "legacy result");
    assert_eq!(legacy_job, "completed");
    Ok(())
}

#[test]
fn db20_new_migration_checksum_conflict_fails_closed() -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = Connection::open_in_memory()?;
    legacy_schema(&connection)?;
    run_migrations(&mut connection)?;
    connection.execute(
        "UPDATE schema_migrations SET checksum='tampered' WHERE migration_id='010_result_artifacts'",
        [],
    )?;
    let error = run_migrations(&mut connection).expect_err("new checksum mismatch must fail");
    assert_eq!(error.code, codes::DATABASE_TRANSACTION_FAILED);
    assert_eq!(
        error
            .details
            .as_ref()
            .and_then(|value| value["migrationId"].as_str()),
        Some("010_result_artifacts")
    );
    Ok(())
}

#[test]
fn db21_full_empty_database_initializes_and_restarts_idempotently(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = Connection::open_in_memory()?;
    connection.execute_batch("PRAGMA foreign_keys=ON;")?;
    crate::db::create_tables(&mut connection)?;
    let first = list_applied(&connection)?;
    crate::db::create_tables(&mut connection)?;
    assert_eq!(list_applied(&connection)?, first);
    assert_eq!(first.len(), migrations().len());
    Ok(())
}

#[test]
fn db22_m1_sql_schema_fingerprint_is_frozen() -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = Connection::open_in_memory()?;
    legacy_schema(&connection)?;
    // Freeze released 001-038 M1 SQL, including the composite parent FK.
    // 039 rebuilds that one constraint; lineage tests cover the post-upgrade schema.
    run_migrations_through(&mut connection, lineage_released_migration_count())?;
    let mut statement = connection.prepare(
        "SELECT type, name, sql FROM sqlite_master
         WHERE sql IS NOT NULL AND (
            name IN ('ai_tasks','ai_task_attempts','ai_input_snapshots',
                     'ai_context_snapshots','ai_constraint_snapshots',
                     'result_artifacts','artifact_validation_issues')
            OR name GLOB 'idx_ai_*'
            OR name GLOB 'uq_ai_*'
            OR name GLOB 'idx_result_artifacts_*'
            OR name GLOB 'uq_result_artifacts_*'
            OR name GLOB 'idx_artifact_validation_*'
            OR name GLOB 'trg_ai_*'
            OR name GLOB 'trg_result_artifacts_*'
          OR name GLOB 'trg_artifact_validation_*'
         )
         AND name NOT GLOB '*ai_request*'
         ORDER BY type ASC, name ASC",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok(format!(
                "{}\n{}\n{}\n",
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let fingerprint = checksum(&rows.concat());
    assert_eq!(
        fingerprint,
        "8e34fe774ff2490325eab1654e5118230e77279e58beed325a5e09c4f320835e"
    );
    Ok(())
}

#[test]
#[ignore = "requires AI_NOVEL_STUDIO_MIGRATION_DB to point at an isolated database copy"]
fn db23_external_v221_copy_upgrades_without_business_row_or_shape_changes(
) -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::var("AI_NOVEL_STUDIO_MIGRATION_DB")?;
    let mut connection = Connection::open(path)?;
    connection.execute_batch("PRAGMA foreign_keys=ON;")?;
    run_migrations_through(&mut connection, 4)?;
    let business_tables = [
        "novels",
        "chapters",
        "chapter_drafts",
        "quality_check_reports",
        "ai_task_records",
        "generation_jobs",
    ];
    let before = business_tables
        .iter()
        .map(|table| {
            let quoted = table.replace('"', "\"\"");
            let count =
                connection.query_row(&format!("SELECT COUNT(*) FROM \"{quoted}\""), [], |row| {
                    row.get::<_, i64>(0)
                })?;
            Ok::<_, rusqlite::Error>((*table, count, table_columns(&connection, table)?))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let fk_before = connection
        .prepare("PRAGMA foreign_key_check")?
        .query_map([], |_| Ok(()))?
        .count();
    run_migrations(&mut connection)?;
    let once = list_applied(&connection)?;
    run_migrations(&mut connection)?;
    assert_eq!(list_applied(&connection)?, once);
    assert_eq!(once.len(), migrations().len());
    for (table, expected_count, expected_columns) in before {
        let quoted = table.replace('"', "\"\"");
        let actual_count =
            connection.query_row(&format!("SELECT COUNT(*) FROM \"{quoted}\""), [], |row| {
                row.get::<_, i64>(0)
            })?;
        assert_eq!(
            actual_count, expected_count,
            "row count changed for {table}"
        );
        assert_eq!(table_columns(&connection, table)?, expected_columns);
    }
    let fk_after = connection
        .prepare("PRAGMA foreign_key_check")?
        .query_map([], |_| Ok(()))?
        .count();
    assert_eq!(fk_after, fk_before);
    let integrity: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    assert_eq!(integrity, "ok");
    Ok(())
}

#[test]
fn db24_planner_schema_has_durable_facts_and_no_plaintext_lease_token(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = Connection::open_in_memory()?;
    connection.execute_batch("PRAGMA foreign_keys=ON;")?;
    crate::db::create_tables(&mut connection)?;
    for table in [
        "agent_plans",
        "agent_plan_steps",
        "agent_plan_step_dependencies",
        "agent_plan_step_attempts",
        "agent_execution_leases",
        "agent_plan_checkpoints",
    ] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            params![table],
            |row| row.get(0),
        )?;
        assert_eq!(exists, 1, "missing planner table {table}");
    }
    for index in [
        "idx_agent_plans_chapter_created",
        "idx_agent_plan_steps_plan_status",
        "uq_agent_plan_attempts_one_running",
        "uq_agent_execution_leases_one_active",
        "idx_agent_plan_checkpoints_plan_sequence",
    ] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1",
            params![index],
            |row| row.get(0),
        )?;
        assert_eq!(exists, 1, "missing planner index {index}");
    }
    for trigger in [
        "trg_agent_plans_status_edges",
        "trg_agent_plan_steps_immutable_identity",
        "trg_agent_plan_dependencies_append_only_delete",
        "trg_agent_plan_attempts_status_edges",
        "trg_agent_execution_leases_monotonic_epoch",
        "trg_agent_plan_checkpoints_append_only_update",
    ] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name=?1",
            params![trigger],
            |row| row.get(0),
        )?;
        assert_eq!(exists, 1, "missing planner trigger {trigger}");
    }
    let columns = table_columns(&connection, "agent_execution_leases")?;
    assert!(columns.iter().any(|column| column == "token_hash"));
    assert!(!columns.iter().any(|column| column == "token"));
    assert_eq!(
        connection
            .prepare("PRAGMA foreign_key_check")?
            .query_map([], |_| Ok(()))?
            .count(),
        0
    );
    Ok(())
}

#[test]
fn db29_global_ai_policy_schema_has_hashed_leases_and_durable_status_guards(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = Connection::open_in_memory()?;
    connection.execute_batch("PRAGMA foreign_keys=ON;")?;
    crate::db::create_tables(&mut connection)?;
    for table in [
        "ai_request_policy",
        "ai_request_daily_usage",
        "ai_request_reservations",
    ] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            params![table],
            |row| row.get(0),
        )?;
        assert_eq!(exists, 1, "missing global AI policy table {table}");
    }
    for index in [
        "idx_ai_request_reservations_started",
        "idx_ai_request_reservations_day_status",
        "idx_ai_request_reservations_active_expiry",
    ] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1",
            params![index],
            |row| row.get(0),
        )?;
        assert_eq!(exists, 1, "missing global AI policy index {index}");
    }
    for trigger in [
        "trg_ai_request_reservations_immutable_identity",
        "trg_ai_request_reservations_dispatch_once",
        "trg_ai_request_reservations_terminal_accounting_immutable",
        "trg_ai_request_reservations_status_edges",
        "trg_ai_request_reservations_no_delete",
        "trg_ai_request_policy_revision_cas",
        "trg_ai_request_policy_no_delete",
    ] {
        let exists: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name=?1",
            params![trigger],
            |row| row.get(0),
        )?;
        assert_eq!(exists, 1, "missing global AI policy trigger {trigger}");
    }
    let columns = table_columns(&connection, "ai_request_reservations")?;
    assert!(columns.iter().any(|column| column == "lease_token_hash"));
    assert!(!columns.iter().any(|column| column == "lease_token"));

    let grant = crate::services::ai_request_policy_service::reserve_request(
        &mut connection,
        crate::services::ai_request_policy_service::ReserveAiRequestInput {
            owner_id: "migration-trigger-owner".to_string(),
            provider_request_id: "migration-trigger-request".to_string(),
            max_requests_per_minute: 12,
            max_concurrent_requests: 2,
            daily_token_budget: Some(10_000),
            daily_cost_budget_usd: Some(10.0),
            estimated_input_tokens: 100,
            estimated_output_tokens: 200,
            input_price_per_million_tokens: Some(1.0),
            output_price_per_million_tokens: Some(2.0),
            warning_percent: 80,
            ttl_ms: 120_000,
        },
    )?;
    crate::services::ai_request_policy_service::verify_provider_dispatch(
        &mut connection,
        &crate::services::ai_request_policy_service::AiRequestPolicyLeaseProof {
            reservation_id: grant.reservation_id.clone(),
            owner_id: grant.owner_id.clone(),
            provider_request_id: grant.provider_request_id.clone(),
            lease_token: grant.lease_token.clone(),
        },
    )?;
    assert!(connection
        .execute(
            "UPDATE ai_request_reservations
             SET dispatched_at_ms=dispatched_at_ms+1 WHERE reservation_id=?1",
            params![&grant.reservation_id],
        )
        .is_err());
    crate::services::ai_request_policy_service::settle_request(
        &mut connection,
        crate::services::ai_request_policy_service::SettleAiRequestInput {
            reservation_id: grant.reservation_id.clone(),
            owner_id: grant.owner_id,
            lease_token: grant.lease_token,
            outcome: "succeeded".to_string(),
            token_input: Some(40),
            token_output: Some(60),
        },
    )?;
    assert!(connection
        .execute(
            "UPDATE ai_request_reservations
             SET accounted_input_tokens=accounted_input_tokens+1
             WHERE reservation_id=?1",
            params![&grant.reservation_id],
        )
        .is_err());
    assert_eq!(
        connection
            .prepare("PRAGMA foreign_key_check")?
            .query_map([], |_| Ok(()))?
            .count(),
        0
    );
    Ok(())
}

#[test]
fn db30_and_db31_upgrade_missing_base_tables_and_replay_idempotently(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = Connection::open_in_memory()?;
    legacy_schema(&connection)?;

    run_migrations(&mut connection)?;
    for column in ["description", "paragraph_length", "pov_type", "tense_type"] {
        assert!(table_columns(&connection, "output_profiles")?.contains(&column.to_string()));
    }
    assert!(table_columns(&connection, "dsh_preparation_runs")?.contains(&"planner".to_string()));

    let first = list_applied(&connection)?;
    run_migrations(&mut connection)?;
    assert_eq!(list_applied(&connection)?, first);

    let mut legacy_output_profile = Connection::open_in_memory()?;
    legacy_output_profile.execute_batch(
        "CREATE TABLE output_profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    )?;
    legacy_schema(&legacy_output_profile)?;
    run_migrations(&mut legacy_output_profile)?;
    for column in ["description", "paragraph_length", "pov_type", "tense_type"] {
        assert!(
            table_columns(&legacy_output_profile, "output_profiles")?.contains(&column.to_string())
        );
    }
    Ok(())
}

#[test]
fn db33_conversation_guards_enforce_scope_status_and_immutability(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = Connection::open_in_memory()?;
    connection.execute_batch("PRAGMA foreign_keys=ON;")?;
    crate::db::create_tables(&mut connection)?;
    connection.execute_batch(
        "INSERT INTO novels (id, title, outline, created_at, updated_at)
         VALUES ('novel-guard-a', 'A', '', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z'),
                ('novel-guard-b', 'B', '', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z');
         INSERT INTO task_conversations
            (conversation_id, novel_id, title, status, created_at, updated_at)
         VALUES ('conversation-guard-a', 'novel-guard-a', '任务 A', 'idle', '2026-08-20T00:00:01Z', '2026-08-20T00:00:01Z'),
                ('conversation-guard-b', 'novel-guard-b', '任务 B', 'idle', '2026-08-20T00:00:01Z', '2026-08-20T00:00:01Z');
         INSERT INTO conversation_turns
            (turn_id, conversation_id, sequence, role, content, created_at)
         VALUES ('turn-guard-a', 'conversation-guard-a', 0, 'user', '生成', '2026-08-20T00:00:02Z'),
                ('turn-guard-b', 'conversation-guard-b', 0, 'user', '审计', '2026-08-20T00:00:02Z');",
    )?;

    assert!(connection
        .execute(
            "INSERT INTO task_runs
                (run_id, conversation_id, turn_id, status, model_snapshot_json, worker_id, created_at, updated_at)
             VALUES ('run-guard-cross', 'conversation-guard-a', 'turn-guard-b', 'queued', '{}', 'worker', '2026-08-20T00:00:03Z', '2026-08-20T00:00:03Z')",
            [],
        )
        .is_err());
    connection.execute(
        "INSERT INTO task_runs
            (run_id, conversation_id, turn_id, status, model_snapshot_json, worker_id, created_at, updated_at)
         VALUES ('run-guard-a', 'conversation-guard-a', 'turn-guard-a', 'queued', '{\"modelId\":\"Mock\"}', 'worker', '2026-08-20T00:00:03Z', '2026-08-20T00:00:03Z')",
        [],
    )?;
    assert!(connection
        .execute(
            "INSERT INTO task_runs
                (run_id, conversation_id, turn_id, status, model_snapshot_json, worker_id, created_at, updated_at)
             VALUES ('run-guard-invalid', 'conversation-guard-a', 'turn-guard-a', 'invalid', '{}', 'worker', '2026-08-20T00:00:04Z', '2026-08-20T00:00:04Z')",
            [],
        )
        .is_err());
    assert!(connection
        .execute(
            "INSERT INTO task_runs
                (run_id, conversation_id, turn_id, status, model_snapshot_json, worker_id, created_at, updated_at)
             VALUES ('run-guard-second', 'conversation-guard-a', 'turn-guard-a', 'queued', '{}', 'worker', '2026-08-20T00:00:04Z', '2026-08-20T00:00:04Z')",
            [],
        )
        .is_err());

    connection.execute(
        "UPDATE task_runs SET status='running', started_at='2026-08-20T00:00:05Z', updated_at='2026-08-20T00:00:05Z' WHERE run_id='run-guard-a'",
        [],
    )?;
    connection.execute(
        "INSERT INTO tool_call_events
            (event_id, run_id, sequence, tool_name, arguments_summary_json, status, created_at)
         VALUES ('event-guard-a', 'run-guard-a', 0, 'novel.read_context', '{}', 'queued', '2026-08-20T00:00:07Z')",
        [],
    )?;
    connection.execute(
        "UPDATE tool_call_events SET status='running' WHERE event_id='event-guard-a'",
        [],
    )?;
    connection.execute(
        "UPDATE tool_call_events SET status='succeeded', finished_at='2026-08-20T00:00:07Z' WHERE event_id='event-guard-a'",
        [],
    )?;
    assert!(connection
        .execute(
            "UPDATE tool_call_events SET status='succeeded' WHERE event_id='event-guard-a'",
            [],
        )
        .is_err());
    connection.execute(
        "UPDATE task_runs SET status='completed', finished_at='2026-08-20T00:00:06Z', updated_at='2026-08-20T00:00:06Z' WHERE run_id='run-guard-a'",
        [],
    )?;
    assert!(connection
        .execute(
            "UPDATE task_runs SET status='running' WHERE run_id='run-guard-a'",
            [],
        )
        .is_err());

    assert!(connection
        .execute(
            "INSERT INTO conversation_artifact_cards
                (card_id, conversation_id, turn_id, run_id, artifact_type, title, summary, content, status, created_at)
             VALUES ('card-guard-cross', 'conversation-guard-a', 'turn-guard-b', 'run-guard-a', 'chapter_text', '候选', '摘要', '正文', 'candidate', '2026-08-20T00:00:08Z')",
            [],
        )
        .is_err());
    connection.execute(
        "INSERT INTO conversation_artifact_cards
            (card_id, conversation_id, turn_id, run_id, artifact_type, title, summary, content, status, created_at)
         VALUES ('card-guard-a', 'conversation-guard-a', 'turn-guard-a', 'run-guard-a', 'chapter_text', '候选', '摘要', '正文', 'candidate', '2026-08-20T00:00:08Z')",
        [],
    )?;
    assert!(connection
        .execute(
            "UPDATE conversation_artifact_cards SET title='改写' WHERE card_id='card-guard-a'",
            [],
        )
        .is_err());
    Ok(())
}

#[test]
fn concurrent_startup_migrations_serialize_before_reading_the_ledger(
) -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::temp_dir().join(format!(
        "ai-novel-studio-concurrent-migrations-{}.db",
        uuid::Uuid::new_v4()
    ));
    {
        let mut connection = Connection::open(&path)?;
        connection.busy_timeout(Duration::from_secs(10))?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        // The single-instance fence serializes the legacy pre-ledger schema bootstrap in
        // production. Seed that base once here, then remove only the ledger rows so the two
        // connections below exercise the cross-connection migration ledger race itself.
        crate::db::create_tables(&mut connection)?;
        connection.execute("DELETE FROM schema_migrations", [])?;
    }

    let barrier = Arc::new(Barrier::new(2));
    let handles = (0..2)
        .map(|_| {
            let path = path.clone();
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || -> Result<(), String> {
                let mut connection = Connection::open(path).map_err(|error| error.to_string())?;
                connection
                    .busy_timeout(Duration::from_secs(10))
                    .map_err(|error| error.to_string())?;
                connection
                    .execute_batch("PRAGMA foreign_keys=ON;")
                    .map_err(|error| error.to_string())?;
                barrier.wait();
                run_migrations(&mut connection).map_err(|error| error.to_string())
            })
        })
        .collect::<Vec<_>>();
    for handle in handles {
        handle
            .join()
            .map_err(|_| "concurrent migration thread panicked")??;
    }

    let connection = Connection::open(&path)?;
    let migration_count: i64 =
        connection.query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
            row.get(0)
        })?;
    assert_eq!(migration_count, EXPECTED_MIGRATION_CHECKSUMS.len() as i64);
    let duplicate_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM (SELECT migration_id FROM schema_migrations GROUP BY migration_id HAVING COUNT(*)<>1)",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(duplicate_count, 0);
    drop(connection);
    for candidate in [
        path.clone(),
        path.with_extension("db-wal"),
        path.with_extension("db-shm"),
    ] {
        fs::remove_file(candidate).ok();
    }
    Ok(())
}
