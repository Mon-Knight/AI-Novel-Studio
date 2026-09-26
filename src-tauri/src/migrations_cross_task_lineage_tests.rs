// Cross-task artifact lineage compatibility coverage. Included by the migration
// test module so it shares imports/fixtures and runs on isolated in-memory copies.

const LINEAGE_039: &str = "039_result_artifacts_cross_task_lineage";
const LINEAGE_COLUMNS: &[&str] = &[
    "artifact_id",
    "task_id",
    "attempt_id",
    "source_input_snapshot_id",
    "artifact_type",
    "schema_version",
    "raw_content_ref_id",
    "display_content_ref_id",
    "display_content_hash",
    "structured_payload_ref_id",
    "structured_payload_hash",
    "source_novel_id",
    "source_chapter_id",
    "source_draft_id",
    "source_draft_version",
    "source_base_content_hash",
    "content_hash",
    "content_length",
    "processing_status",
    "parent_artifact_id",
    "derivation_type",
    "created_at",
];

fn lineage_expected_columns() -> Vec<String> {
    LINEAGE_COLUMNS
        .iter()
        .map(|column| (*column).to_string())
        .collect()
}

fn lineage_released_migration_count() -> usize {
    EXPECTED_MIGRATION_CHECKSUMS
        .iter()
        .position(|(id, _)| *id == LINEAGE_039)
        .expect("039 is registered in the frozen ledger")
}

fn lineage_hex(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn lineage_error_reason(error: &AppError) -> Option<&str> {
    error
        .details
        .as_ref()
        .and_then(|details| details["reason"].as_str())
}

fn lineage_schema_version(connection: &Connection) -> i64 {
    connection
        .query_row("PRAGMA schema_version", [], |row| row.get(0))
        .expect("schema version")
}

fn lineage_foreign_keys_pragma(connection: &Connection) -> i64 {
    connection
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .expect("foreign_keys pragma")
}

fn lineage_prepare_released_base(connection: &Connection) {
    connection
        .execute_batch("PRAGMA foreign_keys=ON;")
        .expect("foreign keys");
    legacy_schema(connection).expect("legacy schema");
    // Released 005+ triggers reference novels/chapters; those tables come from
    // create_base_tables in production, not from migrations 001-038.
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS novels (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                outline TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT '',
                deleted_at TEXT
            );
            CREATE TABLE IF NOT EXISTS chapters (
                id TEXT PRIMARY KEY,
                novel_id TEXT,
                deleted_at TEXT
            );",
        )
        .expect("novels/chapters fixtures for released triggers");
}

fn lineage_connection() -> Connection {
    let mut connection = Connection::open_in_memory().expect("connection");
    lineage_prepare_released_base(&connection);
    run_migrations_through(&mut connection, lineage_released_migration_count())
        .expect("released migrations");
    connection
}

fn lineage_artifact_sql(connection: &Connection) -> String {
    connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='result_artifacts'",
            [],
            |row| row.get::<_, String>(0),
        )
        .expect("result artifact definition")
}

fn lineage_columns(connection: &Connection) -> Vec<String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(result_artifacts)")
        .expect("table_info");
    statement
        .query_map([], |row| row.get::<_, String>(1))
        .expect("columns")
        .collect::<Result<Vec<_>, _>>()
        .expect("column names")
}

fn lineage_self_parent_fk(connection: &Connection) -> (Vec<String>, Vec<String>, String) {
    let mut statement = connection
        .prepare(
            "SELECT id, \"from\", COALESCE(\"to\", ''), on_delete
             FROM pragma_foreign_key_list(?1)
             WHERE \"table\"='result_artifacts'
             ORDER BY id, seq",
        )
        .expect("foreign_key_list");
    let rows = statement
        .query_map(params!["result_artifacts"], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .expect("fk rows")
        .collect::<Result<Vec<_>, _>>()
        .expect("fk values");
    assert!(
        !rows.is_empty(),
        "result_artifacts must have a self parent FK"
    );
    let id = rows[0].0;
    assert!(
        rows.iter().all(|row| row.0 == id),
        "exactly one self parent FK expected, got {rows:?}"
    );
    (
        rows.iter().map(|row| row.1.clone()).collect(),
        rows.iter().map(|row| row.2.clone()).collect(),
        rows[0].3.clone(),
    )
}

fn lineage_assert_parent_fk(connection: &Connection, from: &[&str], to: &[&str]) {
    let (actual_from, actual_to, on_delete) = lineage_self_parent_fk(connection);
    assert_eq!(actual_from, from);
    assert_eq!(actual_to, to);
    assert_eq!(on_delete, "RESTRICT");
}

fn lineage_object_names(connection: &Connection) -> Vec<(String, String)> {
    let names = [
        "idx_result_artifacts_task_created",
        "idx_result_artifacts_attempt",
        "idx_result_artifacts_status_hash",
        "uq_result_artifacts_attempt_root",
        "trg_result_artifacts_immutable_content",
        "trg_result_artifacts_immutable_delete",
        "trg_result_artifacts_status_edges",
        "trg_result_artifacts_validate_insert",
        "trg_ai_tasks_result_artifact_link",
        "trg_ai_tasks_completed_artifact",
        "trg_ai_large_text_documents_immutable_update",
        "trg_ai_large_text_chunks_immutable_delete",
        "trg_placement_proposals_validate_artifact",
        "trg_conversation_artifact_cards_projection_insert",
    ];
    names
        .into_iter()
        .map(|name| {
            let kind: String = connection
                .query_row(
                    "SELECT type FROM sqlite_master WHERE name=?1",
                    params![name],
                    |row| row.get(0),
                )
                .unwrap_or_default();
            (kind, name.to_string())
        })
        .collect()
}

fn lineage_schema_signature(
    connection: &Connection,
) -> (
    Vec<String>,
    (Vec<String>, Vec<String>, String),
    Vec<(String, String)>,
) {
    (
        lineage_columns(connection),
        lineage_self_parent_fk(connection),
        lineage_object_names(connection),
    )
}

fn lineage_object_sql(connection: &Connection, name: &str) -> String {
    connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE name=?1",
            params![name],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_default()
}

fn lineage_insert_document(
    connection: &Connection,
    id: &str,
    target_type: &str,
    target_id: &str,
    field: &str,
    content: &str,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO large_text_documents
            (id,target_type,target_id,field_name,total_chars,total_bytes,chunk_count,
             content_sha256,status,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,1,?7,'ready','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
        params![
            id,
            target_type,
            target_id,
            field,
            content.chars().count() as i64,
            content.len() as i64,
            lineage_hex(content)
        ],
    )?;
    Ok(())
}

fn lineage_try_seed_artifact(
    connection: &Connection,
    task: &str,
    artifact: &str,
    content: &str,
    parent: Option<&str>,
) -> rusqlite::Result<()> {
    let input_snapshot = format!("snapshot-input-{task}");
    let context_snapshot = format!("snapshot-context-{task}");
    let constraint_snapshot = format!("snapshot-constraint-{task}");
    let attempt = format!("attempt-{task}");
    let input_body = format!("body-{task}");
    let compiled = format!("compiled-{task}");
    let template = format!("template-{task}");
    let task_exists: i64 = connection.query_row(
        "SELECT COUNT(*) FROM ai_tasks WHERE task_id=?1",
        params![task],
        |row| row.get(0),
    )?;
    if task_exists == 0 {
    lineage_insert_document(
        connection,
        &format!("document-input-{task}"),
        "ai_snapshot",
        &input_snapshot,
        "input_body",
        &input_body,
    )?;
    lineage_insert_document(
        connection,
        &format!("document-context-{task}"),
        "ai_snapshot",
        &context_snapshot,
        "compiled_context",
        &compiled,
    )?;
    lineage_insert_document(
        connection,
        &format!("document-constraint-{task}"),
        "ai_snapshot",
        &constraint_snapshot,
        "prompt_template",
        &template,
    )?;
    connection.execute(
        "INSERT INTO ai_tasks
            (task_id,task_type,novel_id,scope_type,status,input_snapshot_id,context_snapshot_id,
             constraint_snapshot_id,current_attempt_id,trace_id,operation_id,request_hash_version,
             request_hash,expected_artifact_type,expected_artifact_schema_version,created_at,updated_at)
         VALUES (?1,'setting_expand','system','system','validating',?2,?3,?4,?5,?1,?1,1,?6,
                 'setting_candidates',1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
        params![
            task,
            input_snapshot,
            context_snapshot,
            constraint_snapshot,
            attempt,
            lineage_hex(&format!("request-{task}"))
        ],
    )?;
    connection.execute(
        "INSERT INTO ai_input_snapshots
            (snapshot_id,task_id,schema_version,input_type,payload_json,body_ref_id,content_hash,created_at)
         VALUES (?1,?2,1,'compiled_provider_messages_v1','{}',?3,?4,'2026-01-01T00:00:00Z')",
        params![
            input_snapshot,
            task,
            format!("document-input-{task}"),
            lineage_hex(&input_body)
        ],
    )?;
    connection.execute(
        "INSERT INTO ai_context_snapshots
            (snapshot_id,task_id,schema_version,source_manifest_json,compiled_context_ref_id,
             budget_json,compiler_version,content_hash,created_at)
         VALUES (?1,?2,1,'[]',?3,'{}','context_compiler_v1',?4,'2026-01-01T00:00:00Z')",
        params![
            context_snapshot,
            task,
            format!("document-context-{task}"),
            lineage_hex(&compiled)
        ],
    )?;
    connection.execute(
        "INSERT INTO ai_constraint_snapshots
            (snapshot_id,task_id,schema_version,payload_json,prompt_template_id,
             prompt_template_version,prompt_template_hash,prompt_template_ref_id,
             provider_options_json,content_hash,created_at)
         VALUES (?1,?2,1,'{}','lineage/prompt','1',?3,?4,'{}',?5,'2026-01-01T00:00:00Z')",
        params![
            constraint_snapshot,
            task,
            lineage_hex(&template),
            format!("document-constraint-{task}"),
            lineage_hex(&format!("constraint-{task}"))
        ],
    )?;
    connection.execute(
        "INSERT INTO ai_task_attempts
            (attempt_id,task_id,attempt_number,status,created_at,updated_at)
         VALUES (?1,?2,1,'running','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
        params![attempt, task],
    )?;
    }
    lineage_insert_document(
        connection,
        &format!("document-raw-{artifact}"),
        "result_artifact",
        artifact,
        "raw_content",
        content,
    )?;
    connection.execute(
        "INSERT INTO result_artifacts
            (artifact_id,task_id,attempt_id,source_input_snapshot_id,artifact_type,schema_version,
             raw_content_ref_id,source_novel_id,content_hash,content_length,processing_status,
             parent_artifact_id,derivation_type,created_at)
         VALUES (?1,?2,?3,?4,'setting_candidates',1,?5,'system',?6,?7,'valid',?8,?9,
                 '2026-01-01T00:00:00Z')",
        params![
            artifact,
            task,
            attempt,
            input_snapshot,
            format!("document-raw-{artifact}"),
            lineage_hex(content),
            content.chars().count() as i64,
            parent,
            parent.map(|_| "chapter_revision".to_string())
        ],
    )?;
    Ok(())
}

fn lineage_seed_artifact(
    connection: &Connection,
    task: &str,
    artifact: &str,
    content: &str,
    parent: Option<&str>,
) {
    lineage_try_seed_artifact(connection, task, artifact, content, parent).expect("seed artifact");
}

fn lineage_seed_released_rows(connection: &mut Connection) {
    let transaction = connection.transaction().expect("seed transaction");
    lineage_seed_artifact(
        &transaction,
        "task-released",
        "artifact-released",
        "已采用候选正文",
        None,
    );
    lineage_seed_artifact(
        &transaction,
        "task-released",
        "artifact-same-task-child",
        "同任务派生产物",
        Some("artifact-released"),
    );
    transaction
        .execute(
            "INSERT INTO placement_proposals
                (proposal_id,artifact_id,candidate_index,candidate_hash,proposal_type,target_type,
                 target_novel_id,target_id,expected_target_version,expected_target_hash,
                 effect_payload_json,proposal_hash,created_at)
             VALUES ('proposal-lineage','artifact-released',0,?1,'create_world_setting','world_setting',
                     'system','target-lineage',0,?1,'{}',?1,'2026-01-01T00:00:00Z')",
            params![lineage_hex("proposal")],
        )
        .expect("placement proposal");
    transaction
        .execute(
            "INSERT INTO artifact_validation_issues
                (issue_id,artifact_id,validation_run_id,issue_index,severity,code,message,json_path,
                 details_json,validator_version,created_at)
             VALUES ('issue-lineage','artifact-released','run-lineage',0,'warning','LINEAGE_WARNING',
                     '保留的既有校验问题','/settings/0',NULL,'validator-v1','2026-01-01T00:00:00Z')",
            [],
        )
        .expect("validation issue");
    lineage_insert_document(
        &transaction,
        "apply-rule-receipt-lineage",
        "artifact",
        "artifact-released",
        "world_rule_apply_receipt",
        "{\"schema\":\"world-rule-apply-receipt-v1\"}",
    )
    .expect("rule receipt document");
    transaction.commit().expect("seed commit");
}

fn lineage_artifact_rows(connection: &Connection) -> Vec<Vec<String>> {
    let mut statement = connection
        .prepare("SELECT * FROM result_artifacts ORDER BY artifact_id")
        .expect("artifact select");
    let columns = statement.column_count();
    statement
        .query_map([], |row| {
            let mut values = Vec::with_capacity(columns);
            for index in 0..columns {
                values.push(match row.get_ref(index)? {
                    rusqlite::types::ValueRef::Null => String::new(),
                    rusqlite::types::ValueRef::Integer(value) => value.to_string(),
                    rusqlite::types::ValueRef::Real(value) => value.to_string(),
                    rusqlite::types::ValueRef::Text(value) => {
                        String::from_utf8_lossy(value).into_owned()
                    }
                    rusqlite::types::ValueRef::Blob(_) => "<blob>".to_string(),
                });
            }
            Ok(values)
        })
        .expect("artifact rows")
        .collect::<Result<Vec<_>, _>>()
        .expect("artifact row values")
}

fn lineage_count(connection: &Connection, table: &str) -> i64 {
    connection
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .expect("count")
}

fn lineage_apply_rebuild(connection: &mut Connection) {
    connection
        .execute_batch("PRAGMA foreign_keys=OFF;")
        .expect("fk off");
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .expect("transaction");
    cross_task_lineage::apply(&transaction).expect("rebuild");
    transaction.commit().expect("commit");
    connection
        .execute_batch("PRAGMA foreign_keys=ON;")
        .expect("fk on");
}

#[test]
fn lineage_upgrade_keeps_rows_ledger_dependents_and_enables_cross_task_revision() {
    let mut connection = lineage_connection();
    lineage_assert_parent_fk(
        &connection,
        &["task_id", "parent_artifact_id"],
        &["task_id", "artifact_id"],
    );
    assert_eq!(lineage_columns(&connection), lineage_expected_columns());
    assert_eq!(
        list_applied(&connection).expect("ledger").len(),
        lineage_released_migration_count()
    );
    lineage_seed_released_rows(&mut connection);
    let rows_before = lineage_artifact_rows(&connection);
    let trigger_sql_before = [
        "trg_result_artifacts_validate_insert",
        "trg_ai_tasks_result_artifact_link",
        "trg_ai_tasks_completed_artifact",
        "trg_placement_proposals_validate_artifact",
        "trg_conversation_artifact_cards_projection_insert",
        "trg_ai_large_text_documents_immutable_update",
    ]
    .map(|name| (name, lineage_object_sql(&connection, name)));

    run_migrations(&mut connection).expect("upgrade to 039");
    assert_eq!(lineage_foreign_keys_pragma(&connection), 1);
    let applied = list_applied(&connection).expect("ledger");
    let lineage_index = lineage_released_migration_count();
    assert_eq!(applied.len(), lineage_index + 1);
    assert_eq!(applied[lineage_index].migration_id, LINEAGE_039);
    assert_eq!(
        applied[lineage_index].checksum,
        EXPECTED_MIGRATION_CHECKSUMS[lineage_index].1
    );
    assert_eq!(applied[lineage_index].version, "3.3.0");
    lineage_assert_parent_fk(&connection, &["parent_artifact_id"], &["artifact_id"]);
    assert_eq!(lineage_columns(&connection), lineage_expected_columns());
    assert_eq!(lineage_artifact_rows(&connection), rows_before);
    assert_eq!(lineage_count(&connection, "result_artifacts"), 2);
    assert_eq!(lineage_count(&connection, "large_text_documents"), 6);
    assert_eq!(lineage_count(&connection, "placement_proposals"), 1);
    assert_eq!(lineage_count(&connection, "artifact_validation_issues"), 1);
    for (name, sql) in trigger_sql_before {
        assert_eq!(lineage_object_sql(&connection, name), sql, "{name}");
        assert!(!sql.is_empty(), "{name} missing");
    }
    let fk_errors = connection
        .prepare("PRAGMA foreign_key_check")
        .expect("fk check")
        .query_map([], |_| Ok(()))
        .expect("fk rows")
        .count();
    assert_eq!(fk_errors, 0);

    let transaction = connection.transaction().expect("cross task transaction");
    lineage_seed_artifact(
        &transaction,
        "task-revision",
        "artifact-cross-task-revision",
        "跨任务修订候选",
        Some("artifact-released"),
    );
    transaction.commit().expect("cross task commit");
    assert_eq!(lineage_artifact_rows(&connection).len(), 3);
}

#[test]
fn lineage_released_schema_rejects_cross_task_parents_before_the_migration() {
    let mut connection = lineage_connection();
    lineage_seed_released_rows(&mut connection);
    let rows_before = lineage_artifact_rows(&connection);
    let transaction = connection.transaction().expect("released transaction");
    let error = lineage_try_seed_artifact(
        &transaction,
        "task-revision",
        "artifact-cross-task-revision",
        "跨任务修订候选",
        Some("artifact-released"),
    )
    .expect_err("released composite foreign key must reject a cross-task parent");
    assert!(error.to_string().contains("FOREIGN KEY"), "{error}");
    drop(transaction);
    assert_eq!(lineage_artifact_rows(&connection), rows_before);
}

#[test]
fn lineage_upgrade_is_idempotent_and_never_rewrites_the_ledger() {
    let mut connection = lineage_connection();
    lineage_seed_released_rows(&mut connection);
    run_migrations(&mut connection).expect("first upgrade");
    let applied = list_applied(&connection).expect("ledger");
    let rows = lineage_artifact_rows(&connection);
    let sql = lineage_artifact_sql(&connection);
    let signature = lineage_schema_signature(&connection);
    run_migrations(&mut connection).expect("second upgrade");
    assert_eq!(list_applied(&connection).expect("ledger"), applied);
    assert_eq!(lineage_artifact_rows(&connection), rows);
    assert_eq!(lineage_artifact_sql(&connection), sql);
    assert_eq!(lineage_schema_signature(&connection), signature);
    assert_eq!(lineage_foreign_keys_pragma(&connection), 1);
}

#[test]
fn lineage_new_empty_and_prerelease_match_upgraded_fk_structure() {
    let mut upgraded = lineage_connection();
    run_migrations(&mut upgraded).expect("upgrade");
    let expected = lineage_schema_signature(&upgraded);

    let mut empty = Connection::open_in_memory().expect("empty");
    empty
        .execute_batch("PRAGMA foreign_keys=ON;")
        .expect("foreign keys");
    legacy_schema(&empty).expect("legacy schema");
    run_migrations(&mut empty).expect("empty upgrade");
    assert_eq!(lineage_schema_signature(&empty), expected);
    assert_eq!(
        list_applied(&empty).expect("ledger").len(),
        EXPECTED_MIGRATION_CHECKSUMS.len()
    );

    let mut pre_release = lineage_connection();
    lineage_apply_rebuild(&mut pre_release);
    assert_eq!(
        list_applied(&pre_release).expect("ledger").len(),
        lineage_released_migration_count()
    );
    let sql_before = lineage_artifact_sql(&pre_release);
    let version_before = lineage_schema_version(&pre_release);
    run_migrations(&mut pre_release).expect("no-op 039 ledger insert");
    assert_eq!(lineage_artifact_sql(&pre_release), sql_before);
    assert_eq!(lineage_schema_version(&pre_release), version_before);
    assert_eq!(lineage_schema_signature(&pre_release), expected);
}

#[test]
fn lineage_apply_fails_closed_without_touching_unexpected_schemas() {
    let mut empty = Connection::open_in_memory().expect("connection");
    let transaction = empty
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .expect("immediate transaction");
    let error = cross_task_lineage::apply(&transaction).expect_err("missing table must fail");
    assert_eq!(
        error.message,
        "结果产物跨任务血缘迁移未完成，数据库保持原状"
    );
    assert_eq!(lineage_error_reason(&error), Some("released_table_missing"));
    drop(transaction);

    empty
        .execute_batch(
            "CREATE TABLE result_artifacts (artifact_id TEXT PRIMARY KEY, parent_artifact_id TEXT);",
        )
        .expect("unexpected schema");
    let transaction = empty.transaction().expect("transaction");
    let error = cross_task_lineage::apply(&transaction).expect_err("unexpected schema must fail");
    assert_eq!(lineage_error_reason(&error), Some("unexpected_columns"));
    drop(transaction);
    assert_eq!(lineage_columns(&empty).len(), 2);

    let mut released = lineage_connection();
    let transaction = released.transaction().expect("fk on transaction");
    let error = cross_task_lineage::apply(&transaction)
        .expect_err("rebuild must refuse to run with foreign_keys ON");
    assert_eq!(
        lineage_error_reason(&error),
        Some("foreign_keys_must_be_off")
    );
    drop(transaction);
    lineage_assert_parent_fk(
        &released,
        &["task_id", "parent_artifact_id"],
        &["task_id", "artifact_id"],
    );
}

#[test]
fn lineage_rebuild_is_transactional_and_restores_old_fk_on_rollback() {
    let mut connection = lineage_connection();
    lineage_seed_released_rows(&mut connection);
    let released_sql = lineage_artifact_sql(&connection);
    let version_before = lineage_schema_version(&connection);
    let rows_before = lineage_artifact_rows(&connection);
    connection
        .execute_batch("PRAGMA foreign_keys=OFF;")
        .expect("fk off");
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .expect("transaction");
    cross_task_lineage::apply(&transaction).expect("rebuild inside transaction");
    lineage_assert_parent_fk(&transaction, &["parent_artifact_id"], &["artifact_id"]);
    transaction.rollback().expect("rollback");
    connection
        .execute_batch("PRAGMA foreign_keys=ON;")
        .expect("fk on");
    assert_eq!(lineage_artifact_sql(&connection), released_sql);
    assert_eq!(lineage_schema_version(&connection), version_before);
    lineage_assert_parent_fk(
        &connection,
        &["task_id", "parent_artifact_id"],
        &["task_id", "artifact_id"],
    );
    assert_eq!(
        list_applied(&connection).expect("ledger").len(),
        lineage_released_migration_count()
    );
    assert_eq!(lineage_artifact_rows(&connection), rows_before);
}

#[test]
fn lineage_orphan_parent_fails_closed_and_keeps_released_fk() {
    let mut connection = lineage_connection();
    lineage_seed_released_rows(&mut connection);
    let released_sql = lineage_artifact_sql(&connection);
    connection
        .execute_batch("PRAGMA foreign_keys=OFF;")
        .expect("fk off");
    lineage_seed_artifact(
        &connection,
        "task-orphan",
        "artifact-orphan",
        "孤儿修订",
        Some("missing-parent"),
    );
    connection
        .execute_batch("PRAGMA foreign_keys=ON;")
        .expect("fk on");
    let error = run_migrations(&mut connection).expect_err("orphan must fail closed");
    assert_eq!(lineage_error_reason(&error), Some("foreign_key_violation"));
    assert_eq!(lineage_artifact_sql(&connection), released_sql);
    lineage_assert_parent_fk(
        &connection,
        &["task_id", "parent_artifact_id"],
        &["task_id", "artifact_id"],
    );
    assert_eq!(
        list_applied(&connection).expect("ledger").len(),
        lineage_released_migration_count()
    );
    assert_eq!(lineage_foreign_keys_pragma(&connection), 1);
}

#[test]
fn lineage_post_upgrade_rejects_orphan_inserts_and_keeps_validate_trigger() {
    let mut connection = lineage_connection();
    lineage_seed_released_rows(&mut connection);
    run_migrations(&mut connection).expect("upgrade");
    let rows_before = lineage_artifact_rows(&connection);
    let transaction = connection.transaction().expect("orphan insert");
    let error = lineage_try_seed_artifact(
        &transaction,
        "task-missing-parent",
        "artifact-missing-parent",
        "不存在的父产物",
        Some("missing-parent"),
    )
    .expect_err("single-column FK must reject an orphan parent");
    assert!(error.to_string().contains("FOREIGN KEY"), "{error}");
    drop(transaction);
    assert_eq!(lineage_artifact_rows(&connection), rows_before);
    assert!(connection
        .execute(
            "INSERT INTO result_artifacts
                (artifact_id,task_id,attempt_id,source_input_snapshot_id,artifact_type,schema_version,
                 raw_content_ref_id,source_novel_id,content_hash,content_length,processing_status,created_at)
             VALUES ('bogus','no-task','no-attempt','no-snap','setting_candidates',1,'missing','system',
                     'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',0,'valid',
                     '2026-01-01T00:00:00Z')",
            [],
        )
        .is_err());
}

#[test]
fn lineage_reopen_keeps_lineage_fk_rows_and_allows_deterministic_parent() {
    let path = std::env::temp_dir().join(format!(
        "ai-novel-studio-lineage-reopen-{}.db",
        uuid::Uuid::new_v4()
    ));
    let rows;
    {
        let mut connection = Connection::open(&path).expect("open");
        lineage_prepare_released_base(&connection);
        run_migrations_through(&mut connection, lineage_released_migration_count())
            .expect("released migrations");
        lineage_seed_released_rows(&mut connection);
        rows = lineage_artifact_rows(&connection);
        run_migrations(&mut connection).expect("upgrade");
    }
    let mut reopened = Connection::open(&path).expect("reopen");
    reopened
        .execute_batch("PRAGMA foreign_keys=ON;")
        .expect("foreign keys");
    lineage_assert_parent_fk(&reopened, &["parent_artifact_id"], &["artifact_id"]);
    assert_eq!(lineage_columns(&reopened), lineage_expected_columns());
    assert_eq!(lineage_artifact_rows(&reopened), rows);
    let fk_errors = reopened
        .prepare("PRAGMA foreign_key_check")
        .expect("fk check")
        .query_map([], |_| Ok(()))
        .expect("fk rows")
        .count();
    assert_eq!(fk_errors, 0);
    let transaction = reopened.transaction().expect("revision");
    lineage_seed_artifact(
        &transaction,
        "task-revision",
        "artifact-cross-task-revision",
        "重开后的跨任务修订",
        Some("artifact-released"),
    );
    transaction.commit().expect("revision commit");
    assert_eq!(lineage_artifact_rows(&reopened).len(), 3);
    drop(reopened);
    for candidate in [
        path.clone(),
        path.with_extension("db-wal"),
        path.with_extension("db-shm"),
    ] {
        fs::remove_file(candidate).ok();
    }
}

#[test]
fn lineage_checksum_tamper_stops_startup_and_preserves_the_rebuild() {
    let mut connection = lineage_connection();
    lineage_seed_released_rows(&mut connection);
    run_migrations(&mut connection).expect("upgrade");
    connection
        .execute(
            "UPDATE schema_migrations SET checksum='tampered' WHERE migration_id=?1",
            params![LINEAGE_039],
        )
        .expect("tamper");
    let error = run_migrations(&mut connection).expect_err("checksum mismatch must fail");
    assert_eq!(error.code, codes::DATABASE_TRANSACTION_FAILED);
    assert_eq!(
        error
            .details
            .as_ref()
            .and_then(|details| details["migrationId"].as_str()),
        Some(LINEAGE_039)
    );
    lineage_assert_parent_fk(&connection, &["parent_artifact_id"], &["artifact_id"]);
    assert_eq!(lineage_artifact_rows(&connection).len(), 2);
    assert_eq!(lineage_foreign_keys_pragma(&connection), 1);
}
