use crate::errors::{codes, AppError};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
#[cfg(test)]
use serde::Serialize;
use sha2::{Digest, Sha256};

const MIGRATION_VERSION: &str = "2.3.0-M2";
const LEGACY_SNAPSHOT_CHECKSUMS: [(&str, &str); 4] = [
    (
        "007_ai_input_snapshots",
        "d24f12e863e238bf7d3b634bddd98439f4b61c3f4c3e5be50e4cb2772736b75b",
    ),
    (
        "008_ai_context_snapshots",
        "6b13f0a1ea289c839cd0ba02b3611f73bade03678f70231ec9e74788619f25cb",
    ),
    (
        "009_ai_constraint_snapshots",
        "6f4c6ba03e5f17c660fa3a00771d7ca35fb262ba5cf66c6799c0c15fcd8539af",
    ),
    (
        "010_result_artifacts",
        "b46fd98923ab5a8acb17725569a96c38efed183f8d7f61c1ad2a52d852264bda",
    ),
];
const SNAPSHOT_DELETE_GUARDS_MIGRATION_ID: &str = "015_snapshot_delete_guards";

struct Migration {
    id: &'static str,
    definition: &'static str,
    apply: fn(&Transaction<'_>) -> Result<(), AppError>,
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AppliedMigration {
    pub migration_id: String,
    pub version: String,
    pub checksum: String,
    pub applied_at: String,
}

fn migrations() -> [Migration; 15] {
    [
        Migration {
            id: "001_schema_migrations",
            definition: "schema_migrations(migration_id,version,checksum,applied_at)",
            apply: |_| Ok(()),
        },
        Migration {
            id: "002_workspace_recovery_snapshots",
            definition: "workspace_recovery_snapshots_v1(novel_id,chapter_id,base_draft_id,base_draft_version,base_content_hash,recovery_content,recovery_content_hash,large_text_ref_id,selection_start,selection_end,created_at,updated_at)",
            apply: apply_workspace_recovery,
        },
        Migration {
            id: "003_draft_save_operations",
            definition: "draft_save_operations_v1(operation_id,trace_id,novel_id,chapter_id,draft_id,request_hash,status,result_json,created_at,completed_at)",
            apply: apply_draft_save_operations,
        },
        Migration {
            id: "004_large_text_integrity",
            definition: "large_text_integrity_v1(documents.status,documents.target,chunks.integrity,chapter_drafts.content_hash)",
            apply: apply_large_text_integrity,
        },
        Migration {
            id: "005_ai_tasks",
            definition: "ai_tasks_v1(identity,scope,status,snapshots,attempt,artifact,trace,operation,request,target,error,timestamps,indexes)",
            apply: apply_ai_tasks,
        },
        Migration {
            id: "006_ai_task_attempts",
            definition: "ai_task_attempts_v1(task,number,provider,request,status,response_metadata,error,timestamps,indexes)",
            apply: apply_ai_task_attempts,
        },
        Migration {
            id: "007_ai_input_snapshots",
            definition: "ai_input_snapshots_v1(task,schema,input,payload,body_ref,source_draft,base_hash,content_hash,created,immutable_update_delete)",
            apply: apply_ai_input_snapshots,
        },
        Migration {
            id: "008_ai_context_snapshots",
            definition: "ai_context_snapshots_v1(task,schema,manifest,compiled_ref,budget,compiler,content_hash,created,immutable_update_delete)",
            apply: apply_ai_context_snapshots,
        },
        Migration {
            id: "009_ai_constraint_snapshots",
            definition: "ai_constraint_snapshots_v1(task,schema,payload,template_identity,template_ref,provider_options,content_hash,created,immutable_update_delete)",
            apply: apply_ai_constraint_snapshots,
        },
        Migration {
            id: "010_result_artifacts",
            definition: "result_artifacts_v1(task,attempt,type,schema,raw_ref,display_ref,payload,source_identity,content_hash,status,parent,derivation,created,immutable_content_delete,draft_and_quality_source_columns)",
            apply: apply_result_artifacts,
        },
        Migration {
            id: "011_artifact_validation_issues",
            definition: "artifact_validation_issues_v1(artifact,run,severity,code,message,path,details,validator,created,indexes,append_only)",
            apply: apply_artifact_validation_issues,
        },
        Migration {
            id: "012_artifact_placement_proposals",
            definition: "artifact_placement_proposals_v1(artifact,parent,schema,confidence,reasons,warnings,unresolved,project_revision,created,targets_identity_priority_expected_ready,immutable_restrict)",
            apply: apply_artifact_placement_proposals,
        },
        Migration {
            id: "013_artifact_apply_plans",
            definition: "artifact_apply_plans_v1(proposal,artifact,parent,schema,expected,conflicts,operation,request,status,result,timestamps,operations,dependencies,immutable_request_restrict)",
            apply: apply_artifact_apply_plans,
        },
        Migration {
            id: "014_artifact_target_links",
            definition: "artifact_target_links_v1(artifact,plan,apply_operation,target,version,hash,operation,result,created,unique,immutable_restrict)",
            apply: apply_artifact_target_links,
        },
        Migration {
            id: SNAPSHOT_DELETE_GUARDS_MIGRATION_ID,
            definition: "snapshot_delete_guards_v1(ai_input_snapshots,ai_context_snapshots,ai_constraint_snapshots,result_artifacts)",
            apply: apply_snapshot_delete_guards,
        },
    ]
}

fn checksum(definition: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(definition.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn create_ledger(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                migration_id TEXT PRIMARY KEY,
                version TEXT NOT NULL,
                checksum TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );",
        )
        .map_err(AppError::database)
}

pub fn run_migrations(connection: &mut Connection) -> Result<(), AppError> {
    let legacy_snapshot_compatibility = validate_legacy_snapshot_compatibility(connection)?;

    for migration in migrations() {
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
            let accepted_legacy_checksum = legacy_snapshot_compatibility
                && is_verified_legacy_snapshot_checksum(migration.id, &actual_checksum);
            if actual_checksum != expected_checksum && !accepted_legacy_checksum {
                return Err(AppError::new(
                    codes::DATABASE_TRANSACTION_FAILED,
                    "数据库迁移校验失败",
                    false,
                )
                .with_details(serde_json::json!({
                    "migrationId": migration.id,
                    "expectedChecksum": expected_checksum,
                    "actualChecksum": actual_checksum,
                })));
            }
            transaction.commit().map_err(AppError::database)?;
            continue;
        }

        (migration.apply)(&transaction)?;
        transaction
            .execute(
                "INSERT INTO schema_migrations (migration_id, version, checksum, applied_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    migration.id,
                    MIGRATION_VERSION,
                    expected_checksum,
                    Utc::now().to_rfc3339()
                ],
            )
            .map_err(AppError::database)?;
        transaction.commit().map_err(AppError::database)?;
    }
    Ok(())
}

#[cfg(test)]
pub fn list_applied(connection: &Connection) -> Result<Vec<AppliedMigration>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT migration_id, version, checksum, applied_at
             FROM schema_migrations ORDER BY migration_id ASC",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map([], |row| {
            Ok(AppliedMigration {
                migration_id: row.get(0)?,
                version: row.get(1)?,
                checksum: row.get(2)?,
                applied_at: row.get(3)?,
            })
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}

fn apply_workspace_recovery(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS workspace_recovery_snapshots (
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                base_draft_id TEXT,
                base_draft_version INTEGER,
                base_content_hash TEXT,
                recovery_content TEXT NOT NULL,
                recovery_content_hash TEXT NOT NULL,
                large_text_ref_id TEXT,
                selection_start INTEGER,
                selection_end INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (novel_id, chapter_id)
            );
            CREATE INDEX IF NOT EXISTS idx_workspace_recovery_updated_at
            ON workspace_recovery_snapshots(updated_at);",
        )
        .map_err(AppError::database)
}

fn apply_draft_save_operations(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS draft_save_operations (
                operation_id TEXT PRIMARY KEY,
                trace_id TEXT,
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                draft_id TEXT,
                request_hash TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
                result_json TEXT,
                created_at TEXT NOT NULL,
                completed_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_draft_save_operations_target
            ON draft_save_operations(novel_id, chapter_id, created_at);",
        )
        .map_err(AppError::database)
}

fn table_has_column(
    transaction: &Transaction<'_>,
    table_name: &str,
    column_name: &str,
) -> Result<bool, AppError> {
    let quoted = table_name.replace('"', "\"\"");
    let mut statement = transaction
        .prepare(&format!("PRAGMA table_info(\"{quoted}\")"))
        .map_err(AppError::database)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(columns.iter().any(|column| column == column_name))
}

fn table_exists(transaction: &Transaction<'_>, table_name: &str) -> Result<bool, AppError> {
    transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            params![table_name],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value == 1)
        .map_err(AppError::database)
}

fn apply_large_text_integrity(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS large_text_documents (
                id TEXT PRIMARY KEY,
                target_type TEXT NOT NULL,
                target_id TEXT,
                field_name TEXT NOT NULL,
                title TEXT,
                total_chars INTEGER NOT NULL DEFAULT 0,
                total_bytes INTEGER NOT NULL DEFAULT 0,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                content_sha256 TEXT,
                storage_type TEXT NOT NULL DEFAULT 'chunked',
                status TEXT NOT NULL DEFAULT 'ready',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS large_text_chunks (
                document_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                char_count INTEGER NOT NULL DEFAULT 0,
                byte_count INTEGER NOT NULL DEFAULT 0,
                chunk_sha256 TEXT,
                created_at TEXT NOT NULL,
                PRIMARY KEY (document_id, chunk_index),
                FOREIGN KEY (document_id) REFERENCES large_text_documents(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_large_text_documents_target
            ON large_text_documents(target_type, target_id, field_name);
            CREATE INDEX IF NOT EXISTS idx_large_text_chunks_document
            ON large_text_chunks(document_id, chunk_index);",
        )
        .map_err(AppError::database)?;

    if !table_has_column(transaction, "large_text_documents", "status")? {
        transaction
            .execute(
                "ALTER TABLE large_text_documents ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'",
                [],
            )
            .map_err(AppError::database)?;
    }
    if !table_has_column(transaction, "chapter_drafts", "content_hash")? {
        transaction
            .execute(
                "ALTER TABLE chapter_drafts ADD COLUMN content_hash TEXT",
                [],
            )
            .map_err(AppError::database)?;
    }
    // v2.1 large-text drafts were finalized before the draft reference was written.
    // Repair only documents that are already referenced by a draft, preserving all bodies.
    transaction
        .execute_batch(
            "UPDATE large_text_documents
             SET target_type = 'draft',
                 target_id = (SELECT d.id FROM chapter_drafts d
                              WHERE d.large_text_ref_id = large_text_documents.id LIMIT 1),
                 field_name = 'content',
                 status = 'ready'
             WHERE id IN (SELECT large_text_ref_id FROM chapter_drafts
                          WHERE large_text_ref_id IS NOT NULL);",
        )
        .map_err(AppError::database)?;
    Ok(())
}

fn apply_ai_tasks(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS ai_tasks (
                task_id TEXT PRIMARY KEY,
                task_type TEXT NOT NULL,
                novel_id TEXT NOT NULL,
                chapter_id TEXT,
                draft_id TEXT,
                scope_type TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN (
                    'created','preparing_context','ready','queued','running','validating',
                    'completed','applying','applied','failed','cancel_requested','cancelled'
                )),
                input_snapshot_id TEXT,
                context_snapshot_id TEXT,
                constraint_snapshot_id TEXT,
                current_attempt_id TEXT,
                result_artifact_id TEXT,
                trace_id TEXT NOT NULL,
                operation_id TEXT NOT NULL UNIQUE,
                request_hash TEXT NOT NULL,
                target_hint_json TEXT,
                error_json TEXT,
                created_at TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT,
                applied_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_ai_tasks_novel_status_created
                ON ai_tasks(novel_id, status, created_at);
            CREATE INDEX IF NOT EXISTS idx_ai_tasks_chapter_created
                ON ai_tasks(chapter_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_ai_tasks_trace ON ai_tasks(trace_id);",
        )
        .map_err(AppError::database)
}

fn apply_ai_task_attempts(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS ai_task_attempts (
                attempt_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
                provider_id TEXT,
                provider_request_id TEXT,
                status TEXT NOT NULL CHECK (status IN (
                    'queued','running','succeeded','failed','cancel_requested','cancelled','late_response_ignored'
                )),
                response_metadata_json TEXT,
                error_json TEXT,
                started_at TEXT,
                finished_at TEXT,
                FOREIGN KEY (task_id) REFERENCES ai_tasks(task_id) ON DELETE RESTRICT,
                UNIQUE(task_id, attempt_number)
            );
            CREATE INDEX IF NOT EXISTS idx_ai_task_attempts_task_status
                ON ai_task_attempts(task_id, status, attempt_number);
            CREATE INDEX IF NOT EXISTS idx_ai_task_attempts_provider_request
                ON ai_task_attempts(provider_id, provider_request_id);",
        )
        .map_err(AppError::database)
}

fn apply_ai_input_snapshots(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS ai_input_snapshots (
                snapshot_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL UNIQUE,
                schema_version INTEGER NOT NULL,
                input_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                body_ref_id TEXT,
                source_draft_id TEXT,
                source_draft_version INTEGER,
                base_content_hash TEXT,
                content_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (task_id) REFERENCES ai_tasks(task_id) ON DELETE RESTRICT,
                FOREIGN KEY (body_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_ai_input_snapshots_source
                ON ai_input_snapshots(source_draft_id, source_draft_version, base_content_hash);
            CREATE TRIGGER IF NOT EXISTS trg_ai_input_snapshots_immutable_update
                BEFORE UPDATE ON ai_input_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_input_snapshots_immutable_delete
                BEFORE DELETE ON ai_input_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;",
        )
        .map_err(AppError::database)
}

fn apply_ai_context_snapshots(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS ai_context_snapshots (
                snapshot_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL UNIQUE,
                schema_version INTEGER NOT NULL,
                source_manifest_json TEXT NOT NULL,
                compiled_context_ref_id TEXT,
                budget_json TEXT NOT NULL,
                compiler_version TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (task_id) REFERENCES ai_tasks(task_id) ON DELETE RESTRICT,
                FOREIGN KEY (compiled_context_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_ai_context_snapshots_hash
                ON ai_context_snapshots(content_hash, compiler_version);
            CREATE TRIGGER IF NOT EXISTS trg_ai_context_snapshots_immutable_update
                BEFORE UPDATE ON ai_context_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_context_snapshots_immutable_delete
                BEFORE DELETE ON ai_context_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;",
        )
        .map_err(AppError::database)
}

fn apply_ai_constraint_snapshots(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS ai_constraint_snapshots (
                snapshot_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL UNIQUE,
                schema_version INTEGER NOT NULL,
                payload_json TEXT NOT NULL,
                prompt_template_id TEXT NOT NULL,
                prompt_template_version TEXT NOT NULL,
                prompt_template_hash TEXT NOT NULL,
                prompt_template_ref_id TEXT,
                provider_options_json TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (task_id) REFERENCES ai_tasks(task_id) ON DELETE RESTRICT,
                FOREIGN KEY (prompt_template_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_ai_constraint_snapshots_template
                ON ai_constraint_snapshots(prompt_template_id, prompt_template_version, prompt_template_hash);
            CREATE TRIGGER IF NOT EXISTS trg_ai_constraint_snapshots_immutable_update
                BEFORE UPDATE ON ai_constraint_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_constraint_snapshots_immutable_delete
                BEFORE DELETE ON ai_constraint_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;",
        )
        .map_err(AppError::database)
}

fn apply_result_artifacts(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS result_artifacts (
                artifact_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                attempt_id TEXT NOT NULL,
                artifact_type TEXT NOT NULL,
                schema_version INTEGER NOT NULL,
                raw_content_ref_id TEXT NOT NULL,
                display_content_ref_id TEXT,
                structured_payload_json TEXT,
                source_novel_id TEXT NOT NULL,
                source_chapter_id TEXT,
                source_draft_id TEXT,
                source_draft_version INTEGER,
                source_base_content_hash TEXT,
                content_hash TEXT NOT NULL,
                content_length INTEGER NOT NULL,
                processing_status TEXT NOT NULL CHECK (processing_status IN (
                    'raw','parsing','valid','valid_with_warnings','invalid'
                )),
                parent_artifact_id TEXT,
                derivation_type TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (task_id) REFERENCES ai_tasks(task_id) ON DELETE RESTRICT,
                FOREIGN KEY (attempt_id) REFERENCES ai_task_attempts(attempt_id) ON DELETE RESTRICT,
                FOREIGN KEY (raw_content_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT,
                FOREIGN KEY (display_content_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT,
                FOREIGN KEY (parent_artifact_id) REFERENCES result_artifacts(artifact_id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_result_artifacts_task_created
                ON result_artifacts(task_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_result_artifacts_status_hash
                ON result_artifacts(processing_status, content_hash);
            CREATE TRIGGER IF NOT EXISTS trg_result_artifacts_immutable_content
                BEFORE UPDATE OF raw_content_ref_id, display_content_ref_id, structured_payload_json,
                    source_novel_id, source_chapter_id, source_draft_id, source_draft_version,
                    source_base_content_hash, content_hash, schema_version
                ON result_artifacts BEGIN SELECT RAISE(ABORT, 'immutable artifact'); END;
            CREATE TRIGGER IF NOT EXISTS trg_result_artifacts_immutable_delete
                BEFORE DELETE ON result_artifacts BEGIN SELECT RAISE(ABORT, 'immutable artifact'); END;",
        )
        .map_err(AppError::database)?;

    for (column, definition) in [
        ("source_task_id", "TEXT"),
        ("artifact_id", "TEXT"),
        ("source_type", "TEXT"),
        ("source_id", "TEXT"),
        ("source_draft_id", "TEXT"),
        ("source_draft_version", "INTEGER"),
        ("base_content_hash", "TEXT"),
    ] {
        if !table_has_column(transaction, "chapter_drafts", column)? {
            transaction
                .execute(
                    &format!("ALTER TABLE chapter_drafts ADD COLUMN {column} {definition}"),
                    [],
                )
                .map_err(AppError::database)?;
        }
    }
    if table_exists(transaction, "quality_check_reports")? {
        for (column, definition) in [("source_task_id", "TEXT"), ("artifact_id", "TEXT")] {
            if !table_has_column(transaction, "quality_check_reports", column)? {
                transaction
                    .execute(
                        &format!(
                            "ALTER TABLE quality_check_reports ADD COLUMN {column} {definition}"
                        ),
                        [],
                    )
                    .map_err(AppError::database)?;
            }
        }
    }
    transaction
        .execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_chapter_drafts_source_task
                ON chapter_drafts(source_task_id);
             CREATE INDEX IF NOT EXISTS idx_chapter_drafts_artifact
                ON chapter_drafts(artifact_id);
             ",
        )
        .map_err(AppError::database)?;
    if table_exists(transaction, "quality_check_reports")? {
        transaction
            .execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_quality_check_reports_source_task
                    ON quality_check_reports(source_task_id);
                 CREATE INDEX IF NOT EXISTS idx_quality_check_reports_artifact
                    ON quality_check_reports(artifact_id);",
            )
            .map_err(AppError::database)?;
    }
    Ok(())
}

fn apply_snapshot_delete_guards(transaction: &Transaction<'_>) -> Result<(), AppError> {
    for object in &SNAPSHOT_DELETE_GUARD_OBJECTS {
        if let Some(actual_sql) = schema_object_sql(transaction, object.object_type, object.name)? {
            if normalize_sql(&actual_sql) != normalize_sql(object.sql) {
                return Err(AppError::new(
                    codes::DATABASE_TRANSACTION_FAILED,
                    "数据库迁移校验失败",
                    false,
                )
                .with_details(serde_json::json!({
                    "stage": "snapshot_delete_guards",
                    "reason": "existing delete guard does not match its audited definition",
                })));
            }
        }
    }
    transaction
        .execute_batch(
            "CREATE TRIGGER IF NOT EXISTS trg_ai_input_snapshots_immutable_delete
                BEFORE DELETE ON ai_input_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
             CREATE TRIGGER IF NOT EXISTS trg_ai_context_snapshots_immutable_delete
                BEFORE DELETE ON ai_context_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
             CREATE TRIGGER IF NOT EXISTS trg_ai_constraint_snapshots_immutable_delete
                BEFORE DELETE ON ai_constraint_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
             CREATE TRIGGER IF NOT EXISTS trg_result_artifacts_immutable_delete
                BEFORE DELETE ON result_artifacts BEGIN SELECT RAISE(ABORT, 'immutable artifact'); END;",
        )
        .map_err(AppError::database)?;
    for object in &SNAPSHOT_DELETE_GUARD_OBJECTS {
        validate_schema_object(transaction, object)?;
    }
    Ok(())
}

fn apply_artifact_validation_issues(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS artifact_validation_issues (
                issue_id TEXT PRIMARY KEY,
                artifact_id TEXT NOT NULL,
                validation_run_id TEXT NOT NULL,
                severity TEXT NOT NULL CHECK (severity IN ('warning','error')),
                code TEXT NOT NULL,
                message TEXT NOT NULL,
                json_path TEXT,
                details_json TEXT,
                validator_version TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (artifact_id) REFERENCES result_artifacts(artifact_id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_artifact_validation_artifact
                ON artifact_validation_issues(artifact_id, validation_run_id, severity);
            CREATE INDEX IF NOT EXISTS idx_artifact_validation_code
                ON artifact_validation_issues(code, created_at);
            CREATE TRIGGER IF NOT EXISTS trg_artifact_validation_issues_append_only_update
                BEFORE UPDATE ON artifact_validation_issues BEGIN SELECT RAISE(ABORT, 'append-only issue'); END;
            CREATE TRIGGER IF NOT EXISTS trg_artifact_validation_issues_append_only_delete
                BEFORE DELETE ON artifact_validation_issues BEGIN SELECT RAISE(ABORT, 'append-only issue'); END;",
        )
        .map_err(AppError::database)
}

struct LegacySchemaObject {
    object_type: &'static str,
    name: &'static str,
    sql: &'static str,
}

const LEGACY_SNAPSHOT_SCHEMA_OBJECTS: [LegacySchemaObject; 15] = [
    LegacySchemaObject {
        object_type: "table",
        name: "ai_input_snapshots",
        sql: r#"CREATE TABLE ai_input_snapshots (
            snapshot_id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL UNIQUE,
            schema_version INTEGER NOT NULL,
            input_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            body_ref_id TEXT,
            source_draft_id TEXT,
            source_draft_version INTEGER,
            base_content_hash TEXT,
            content_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES ai_tasks(task_id) ON DELETE RESTRICT,
            FOREIGN KEY (body_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT
        )"#,
    },
    LegacySchemaObject {
        object_type: "table",
        name: "ai_context_snapshots",
        sql: r#"CREATE TABLE ai_context_snapshots (
            snapshot_id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL UNIQUE,
            schema_version INTEGER NOT NULL,
            source_manifest_json TEXT NOT NULL,
            compiled_context_ref_id TEXT,
            budget_json TEXT NOT NULL,
            compiler_version TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES ai_tasks(task_id) ON DELETE RESTRICT,
            FOREIGN KEY (compiled_context_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT
        )"#,
    },
    LegacySchemaObject {
        object_type: "table",
        name: "ai_constraint_snapshots",
        sql: r#"CREATE TABLE ai_constraint_snapshots (
            snapshot_id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL UNIQUE,
            schema_version INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            prompt_template_id TEXT NOT NULL,
            prompt_template_version TEXT NOT NULL,
            prompt_template_hash TEXT NOT NULL,
            prompt_template_ref_id TEXT,
            provider_options_json TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES ai_tasks(task_id) ON DELETE RESTRICT,
            FOREIGN KEY (prompt_template_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT
        )"#,
    },
    LegacySchemaObject {
        object_type: "table",
        name: "result_artifacts",
        sql: r#"CREATE TABLE result_artifacts (
            artifact_id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            attempt_id TEXT NOT NULL,
            artifact_type TEXT NOT NULL,
            schema_version INTEGER NOT NULL,
            raw_content_ref_id TEXT NOT NULL,
            display_content_ref_id TEXT,
            structured_payload_json TEXT,
            source_novel_id TEXT NOT NULL,
            source_chapter_id TEXT,
            source_draft_id TEXT,
            source_draft_version INTEGER,
            source_base_content_hash TEXT,
            content_hash TEXT NOT NULL,
            content_length INTEGER NOT NULL,
            processing_status TEXT NOT NULL CHECK (processing_status IN (
                'raw','parsing','valid','valid_with_warnings','invalid'
            )),
            parent_artifact_id TEXT,
            derivation_type TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES ai_tasks(task_id) ON DELETE RESTRICT,
            FOREIGN KEY (attempt_id) REFERENCES ai_task_attempts(attempt_id) ON DELETE RESTRICT,
            FOREIGN KEY (raw_content_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT,
            FOREIGN KEY (display_content_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT,
            FOREIGN KEY (parent_artifact_id) REFERENCES result_artifacts(artifact_id) ON DELETE RESTRICT
        )"#,
    },
    LegacySchemaObject {
        object_type: "index",
        name: "idx_ai_input_snapshots_source",
        sql: "CREATE INDEX idx_ai_input_snapshots_source ON ai_input_snapshots(source_draft_id, source_draft_version, base_content_hash)",
    },
    LegacySchemaObject {
        object_type: "index",
        name: "idx_ai_context_snapshots_hash",
        sql: "CREATE INDEX idx_ai_context_snapshots_hash ON ai_context_snapshots(content_hash, compiler_version)",
    },
    LegacySchemaObject {
        object_type: "index",
        name: "idx_ai_constraint_snapshots_template",
        sql: "CREATE INDEX idx_ai_constraint_snapshots_template ON ai_constraint_snapshots(prompt_template_id, prompt_template_version, prompt_template_hash)",
    },
    LegacySchemaObject {
        object_type: "index",
        name: "idx_result_artifacts_task_created",
        sql: "CREATE INDEX idx_result_artifacts_task_created ON result_artifacts(task_id, created_at)",
    },
    LegacySchemaObject {
        object_type: "index",
        name: "idx_result_artifacts_status_hash",
        sql: "CREATE INDEX idx_result_artifacts_status_hash ON result_artifacts(processing_status, content_hash)",
    },
    LegacySchemaObject {
        object_type: "index",
        name: "idx_chapter_drafts_source_task",
        sql: "CREATE INDEX idx_chapter_drafts_source_task ON chapter_drafts(source_task_id)",
    },
    LegacySchemaObject {
        object_type: "index",
        name: "idx_chapter_drafts_artifact",
        sql: "CREATE INDEX idx_chapter_drafts_artifact ON chapter_drafts(artifact_id)",
    },
    LegacySchemaObject {
        object_type: "trigger",
        name: "trg_ai_input_snapshots_immutable_update",
        sql: "CREATE TRIGGER trg_ai_input_snapshots_immutable_update BEFORE UPDATE ON ai_input_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END",
    },
    LegacySchemaObject {
        object_type: "trigger",
        name: "trg_ai_context_snapshots_immutable_update",
        sql: "CREATE TRIGGER trg_ai_context_snapshots_immutable_update BEFORE UPDATE ON ai_context_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END",
    },
    LegacySchemaObject {
        object_type: "trigger",
        name: "trg_ai_constraint_snapshots_immutable_update",
        sql: "CREATE TRIGGER trg_ai_constraint_snapshots_immutable_update BEFORE UPDATE ON ai_constraint_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END",
    },
    LegacySchemaObject {
        object_type: "trigger",
        name: "trg_result_artifacts_immutable_content",
        sql: "CREATE TRIGGER trg_result_artifacts_immutable_content BEFORE UPDATE OF raw_content_ref_id, display_content_ref_id, structured_payload_json, source_novel_id, source_chapter_id, source_draft_id, source_draft_version, source_base_content_hash, content_hash, schema_version ON result_artifacts BEGIN SELECT RAISE(ABORT, 'immutable artifact'); END",
    },
];

const SNAPSHOT_DELETE_GUARD_OBJECTS: [LegacySchemaObject; 4] = [
    LegacySchemaObject {
        object_type: "trigger",
        name: "trg_ai_input_snapshots_immutable_delete",
        sql: "CREATE TRIGGER trg_ai_input_snapshots_immutable_delete BEFORE DELETE ON ai_input_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END",
    },
    LegacySchemaObject {
        object_type: "trigger",
        name: "trg_ai_context_snapshots_immutable_delete",
        sql: "CREATE TRIGGER trg_ai_context_snapshots_immutable_delete BEFORE DELETE ON ai_context_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END",
    },
    LegacySchemaObject {
        object_type: "trigger",
        name: "trg_ai_constraint_snapshots_immutable_delete",
        sql: "CREATE TRIGGER trg_ai_constraint_snapshots_immutable_delete BEFORE DELETE ON ai_constraint_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END",
    },
    LegacySchemaObject {
        object_type: "trigger",
        name: "trg_result_artifacts_immutable_delete",
        sql: "CREATE TRIGGER trg_result_artifacts_immutable_delete BEFORE DELETE ON result_artifacts BEGIN SELECT RAISE(ABORT, 'immutable artifact'); END",
    },
];

const LEGACY_QUALITY_REPORT_INDEXES: [LegacySchemaObject; 2] = [
    LegacySchemaObject {
        object_type: "index",
        name: "idx_quality_check_reports_source_task",
        sql: "CREATE INDEX idx_quality_check_reports_source_task ON quality_check_reports(source_task_id)",
    },
    LegacySchemaObject {
        object_type: "index",
        name: "idx_quality_check_reports_artifact",
        sql: "CREATE INDEX idx_quality_check_reports_artifact ON quality_check_reports(artifact_id)",
    },
];

fn normalize_sql(sql: &str) -> String {
    sql.chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn legacy_compatibility_failure(reason: &str) -> AppError {
    AppError::new(
        codes::DATABASE_TRANSACTION_FAILED,
        "数据库迁移校验失败",
        false,
    )
    .with_details(serde_json::json!({
        "stage": "legacy_snapshot_compatibility",
        "reason": reason,
    }))
}

fn migration_ledger_exists(connection: &Connection) -> Result<bool, AppError> {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master
                WHERE type = 'table' AND name = 'schema_migrations'
            )",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|exists| exists != 0)
        .map_err(AppError::database)
}

fn applied_checksum(
    connection: &Connection,
    migration_id: &str,
) -> Result<Option<String>, AppError> {
    connection
        .query_row(
            "SELECT checksum FROM schema_migrations WHERE migration_id = ?1",
            params![migration_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(AppError::database)
}

fn expected_migration_checksum(migration_id: &str) -> Option<String> {
    migrations()
        .iter()
        .find(|migration| migration.id == migration_id)
        .map(|migration| checksum(migration.definition))
}

fn schema_object_sql(
    connection: &Connection,
    object_type: &str,
    name: &str,
) -> Result<Option<String>, AppError> {
    connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = ?1 AND name = ?2",
            params![object_type, name],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(AppError::database)
}

fn validate_schema_object(
    connection: &Connection,
    object: &LegacySchemaObject,
) -> Result<(), AppError> {
    let actual_sql = schema_object_sql(connection, object.object_type, object.name)?
        .ok_or_else(|| legacy_compatibility_failure("required legacy schema object is missing"))?;
    if normalize_sql(&actual_sql) != normalize_sql(object.sql) {
        return Err(legacy_compatibility_failure(
            "required legacy schema object does not match its audited definition",
        ));
    }
    Ok(())
}

fn validate_schema_object_absent(
    connection: &Connection,
    object: &LegacySchemaObject,
) -> Result<(), AppError> {
    if schema_object_sql(connection, object.object_type, object.name)?.is_some() {
        return Err(legacy_compatibility_failure(
            "legacy schema unexpectedly contains a forward delete guard",
        ));
    }
    Ok(())
}

fn table_exists_for_legacy_validation(
    connection: &Connection,
    table_name: &str,
) -> Result<bool, AppError> {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1
            )",
            params![table_name],
            |row| row.get::<_, i64>(0),
        )
        .map(|exists| exists != 0)
        .map_err(AppError::database)
}

fn validate_legacy_columns(
    connection: &Connection,
    table_name: &str,
    expected_columns: &[(&str, &str)],
) -> Result<(), AppError> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table_name})"))
        .map_err(AppError::database)?;
    let columns = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })
        .map_err(AppError::database)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(AppError::database)?;

    for (expected_name, expected_type) in expected_columns {
        let actual = columns
            .iter()
            .find(|(actual_name, _, _, _, _)| actual_name == expected_name)
            .ok_or_else(|| legacy_compatibility_failure("required legacy column is missing"))?;
        if actual.1 != *expected_type || actual.2 != 0 || actual.3.is_some() || actual.4 != 0 {
            return Err(legacy_compatibility_failure(
                "required legacy column definition does not match",
            ));
        }
    }
    Ok(())
}

fn validate_legacy_snapshot_schema(
    connection: &Connection,
    delete_guards_applied: bool,
) -> Result<(), AppError> {
    for object in &LEGACY_SNAPSHOT_SCHEMA_OBJECTS {
        validate_schema_object(connection, object)?;
    }

    validate_legacy_columns(
        connection,
        "chapter_drafts",
        &[
            ("source_task_id", "TEXT"),
            ("artifact_id", "TEXT"),
            ("source_type", "TEXT"),
            ("source_id", "TEXT"),
            ("source_draft_id", "TEXT"),
            ("source_draft_version", "INTEGER"),
            ("base_content_hash", "TEXT"),
        ],
    )?;

    if table_exists_for_legacy_validation(connection, "quality_check_reports")? {
        validate_legacy_columns(
            connection,
            "quality_check_reports",
            &[("source_task_id", "TEXT"), ("artifact_id", "TEXT")],
        )?;
        for object in &LEGACY_QUALITY_REPORT_INDEXES {
            validate_schema_object(connection, object)?;
        }
    }

    for object in &SNAPSHOT_DELETE_GUARD_OBJECTS {
        if delete_guards_applied {
            validate_schema_object(connection, object)?;
        } else {
            validate_schema_object_absent(connection, object)?;
        }
    }
    Ok(())
}

fn validate_legacy_forward_progress(connection: &Connection) -> Result<bool, AppError> {
    let mut missing_migration_seen = false;
    let mut delete_guard_migration_applied = false;

    for migration_id in [
        "012_artifact_placement_proposals",
        "013_artifact_apply_plans",
        "014_artifact_target_links",
        SNAPSHOT_DELETE_GUARDS_MIGRATION_ID,
    ] {
        let expected_checksum = expected_migration_checksum(migration_id)
            .ok_or_else(|| legacy_compatibility_failure("forward migration is not registered"))?;
        match applied_checksum(connection, migration_id)? {
            Some(actual_checksum) => {
                if missing_migration_seen || actual_checksum != expected_checksum {
                    return Err(legacy_compatibility_failure(
                        "legacy ledger has an invalid forward migration sequence",
                    ));
                }
                if migration_id == SNAPSHOT_DELETE_GUARDS_MIGRATION_ID {
                    delete_guard_migration_applied = true;
                }
            }
            None => missing_migration_seen = true,
        }
    }

    Ok(delete_guard_migration_applied)
}

fn validate_legacy_ledger_prefix(connection: &Connection) -> Result<(), AppError> {
    for migration_id in [
        "001_schema_migrations",
        "002_workspace_recovery_snapshots",
        "003_draft_save_operations",
        "004_large_text_integrity",
        "005_ai_tasks",
        "006_ai_task_attempts",
        "011_artifact_validation_issues",
    ] {
        let expected_checksum = expected_migration_checksum(migration_id)
            .ok_or_else(|| legacy_compatibility_failure("baseline migration is not registered"))?;
        if applied_checksum(connection, migration_id)?.as_deref()
            != Some(expected_checksum.as_str())
        {
            return Err(legacy_compatibility_failure(
                "legacy ledger prefix is missing or invalid",
            ));
        }
    }
    Ok(())
}

fn validate_legacy_snapshot_compatibility(connection: &Connection) -> Result<bool, AppError> {
    if !migration_ledger_exists(connection)? {
        return Ok(false);
    }

    let checksums = LEGACY_SNAPSHOT_CHECKSUMS
        .iter()
        .map(|(migration_id, expected_checksum)| {
            Ok((
                *migration_id,
                *expected_checksum,
                applied_checksum(connection, migration_id)?,
            ))
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let legacy_count = checksums
        .iter()
        .filter(|(_, expected_checksum, actual_checksum)| {
            actual_checksum.as_deref() == Some(*expected_checksum)
        })
        .count();

    if legacy_count == 0 {
        return Ok(false);
    }
    if legacy_count != LEGACY_SNAPSHOT_CHECKSUMS.len()
        || checksums
            .iter()
            .any(|(_, expected_checksum, actual_checksum)| {
                actual_checksum.as_deref() != Some(*expected_checksum)
            })
    {
        return Err(legacy_compatibility_failure(
            "legacy snapshot checksum set is incomplete or mixed",
        ));
    }

    validate_legacy_ledger_prefix(connection)?;
    let delete_guards_applied = validate_legacy_forward_progress(connection)?;
    validate_legacy_snapshot_schema(connection, delete_guards_applied)?;
    Ok(true)
}

fn is_verified_legacy_snapshot_checksum(migration_id: &str, checksum_value: &str) -> bool {
    LEGACY_SNAPSHOT_CHECKSUMS
        .iter()
        .any(|(expected_id, expected_checksum)| {
            migration_id == *expected_id && checksum_value == *expected_checksum
        })
}

fn apply_artifact_placement_proposals(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS artifact_placement_proposals (
                proposal_id TEXT PRIMARY KEY,
                artifact_id TEXT NOT NULL,
                parent_proposal_id TEXT,
                schema_version INTEGER NOT NULL,
                confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
                reasons_json TEXT NOT NULL,
                warnings_json TEXT NOT NULL,
                unresolved_items_json TEXT NOT NULL,
                project_revision_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (artifact_id) REFERENCES result_artifacts(artifact_id) ON DELETE RESTRICT,
                FOREIGN KEY (parent_proposal_id) REFERENCES artifact_placement_proposals(proposal_id) ON DELETE RESTRICT
            );
            CREATE TABLE IF NOT EXISTS artifact_placement_targets (
                target_row_id TEXT PRIMARY KEY,
                proposal_id TEXT NOT NULL,
                target_index INTEGER NOT NULL,
                target_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                novel_id TEXT NOT NULL,
                chapter_id TEXT,
                draft_id TEXT,
                action TEXT NOT NULL,
                expected_version INTEGER,
                expected_hash TEXT,
                source_priority INTEGER NOT NULL CHECK (source_priority BETWEEN 1 AND 4),
                confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
                reason TEXT NOT NULL,
                is_ready INTEGER NOT NULL CHECK (is_ready IN (0,1)),
                created_at TEXT NOT NULL,
                UNIQUE (proposal_id, target_index),
                FOREIGN KEY (proposal_id) REFERENCES artifact_placement_proposals(proposal_id) ON DELETE RESTRICT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_placement_one_ready_target
                ON artifact_placement_targets(proposal_id) WHERE is_ready = 1;
            CREATE INDEX IF NOT EXISTS idx_placement_proposals_artifact_created
                ON artifact_placement_proposals(artifact_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_placement_targets_identity
                ON artifact_placement_targets(target_type, target_id);
            CREATE TRIGGER IF NOT EXISTS trg_placement_proposals_immutable_update
                BEFORE UPDATE ON artifact_placement_proposals BEGIN SELECT RAISE(ABORT, 'immutable placement proposal'); END;
            CREATE TRIGGER IF NOT EXISTS trg_placement_proposals_immutable_delete
                BEFORE DELETE ON artifact_placement_proposals BEGIN SELECT RAISE(ABORT, 'immutable placement proposal'); END;
            CREATE TRIGGER IF NOT EXISTS trg_placement_targets_immutable_update
                BEFORE UPDATE ON artifact_placement_targets BEGIN SELECT RAISE(ABORT, 'immutable placement target'); END;
            CREATE TRIGGER IF NOT EXISTS trg_placement_targets_immutable_delete
                BEFORE DELETE ON artifact_placement_targets BEGIN SELECT RAISE(ABORT, 'immutable placement target'); END;",
        )
        .map_err(AppError::database)
}

fn apply_artifact_apply_plans(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS artifact_apply_plans (
                plan_id TEXT PRIMARY KEY,
                proposal_id TEXT NOT NULL,
                artifact_id TEXT NOT NULL,
                parent_plan_id TEXT,
                schema_version INTEGER NOT NULL,
                expected_versions_json TEXT NOT NULL,
                expected_hashes_json TEXT NOT NULL,
                conflicts_json TEXT NOT NULL,
                operation_id TEXT NOT NULL UNIQUE,
                request_hash TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('draft','validated','blocked','ready','applying','completed','failed','commit_unknown','cancelled')),
                result_json TEXT,
                error_json TEXT,
                created_at TEXT NOT NULL,
                completed_at TEXT,
                FOREIGN KEY (proposal_id) REFERENCES artifact_placement_proposals(proposal_id) ON DELETE RESTRICT,
                FOREIGN KEY (artifact_id) REFERENCES result_artifacts(artifact_id) ON DELETE RESTRICT,
                FOREIGN KEY (parent_plan_id) REFERENCES artifact_apply_plans(plan_id) ON DELETE RESTRICT
            );
            CREATE TABLE IF NOT EXISTS artifact_apply_operations (
                apply_operation_id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                operation_index INTEGER NOT NULL,
                target_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                action TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                payload_hash TEXT NOT NULL,
                expected_version INTEGER,
                expected_hash TEXT,
                created_at TEXT NOT NULL,
                UNIQUE (plan_id, operation_index),
                FOREIGN KEY (plan_id) REFERENCES artifact_apply_plans(plan_id) ON DELETE RESTRICT
            );
            CREATE TABLE IF NOT EXISTS artifact_apply_dependencies (
                dependency_id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                operation_id TEXT NOT NULL,
                depends_on_operation_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE (plan_id, operation_id, depends_on_operation_id),
                FOREIGN KEY (plan_id) REFERENCES artifact_apply_plans(plan_id) ON DELETE RESTRICT,
                FOREIGN KEY (operation_id) REFERENCES artifact_apply_operations(apply_operation_id) ON DELETE RESTRICT,
                FOREIGN KEY (depends_on_operation_id) REFERENCES artifact_apply_operations(apply_operation_id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_apply_plans_artifact_created
                ON artifact_apply_plans(artifact_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_apply_plans_proposal_created
                ON artifact_apply_plans(proposal_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_apply_operations_plan
                ON artifact_apply_operations(plan_id, operation_index);
            CREATE TRIGGER IF NOT EXISTS trg_apply_plans_immutable_request
                BEFORE UPDATE OF proposal_id, artifact_id, parent_plan_id, schema_version,
                    expected_versions_json, expected_hashes_json, conflicts_json,
                    operation_id, request_hash, created_at
                ON artifact_apply_plans BEGIN SELECT RAISE(ABORT, 'immutable apply plan request'); END;
            CREATE TRIGGER IF NOT EXISTS trg_apply_plans_immutable_delete
                BEFORE DELETE ON artifact_apply_plans BEGIN SELECT RAISE(ABORT, 'immutable apply plan'); END;
            CREATE TRIGGER IF NOT EXISTS trg_apply_operations_immutable_update
                BEFORE UPDATE ON artifact_apply_operations BEGIN SELECT RAISE(ABORT, 'immutable apply operation'); END;
            CREATE TRIGGER IF NOT EXISTS trg_apply_operations_immutable_delete
                BEFORE DELETE ON artifact_apply_operations BEGIN SELECT RAISE(ABORT, 'immutable apply operation'); END;
            CREATE TRIGGER IF NOT EXISTS trg_apply_dependencies_immutable_update
                BEFORE UPDATE ON artifact_apply_dependencies BEGIN SELECT RAISE(ABORT, 'immutable apply dependency'); END;
            CREATE TRIGGER IF NOT EXISTS trg_apply_dependencies_immutable_delete
                BEFORE DELETE ON artifact_apply_dependencies BEGIN SELECT RAISE(ABORT, 'immutable apply dependency'); END;",
        )
        .map_err(AppError::database)
}

fn apply_artifact_target_links(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS artifact_target_links (
                link_id TEXT PRIMARY KEY,
                artifact_id TEXT NOT NULL,
                plan_id TEXT NOT NULL,
                apply_operation_id TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                target_version INTEGER,
                target_hash TEXT,
                operation_id TEXT NOT NULL,
                result_metadata_json TEXT,
                created_at TEXT NOT NULL,
                UNIQUE (apply_operation_id, target_type, target_id),
                FOREIGN KEY (artifact_id) REFERENCES result_artifacts(artifact_id) ON DELETE RESTRICT,
                FOREIGN KEY (plan_id) REFERENCES artifact_apply_plans(plan_id) ON DELETE RESTRICT,
                FOREIGN KEY (apply_operation_id) REFERENCES artifact_apply_operations(apply_operation_id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_artifact_target_links_artifact
                ON artifact_target_links(artifact_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_artifact_target_links_target
                ON artifact_target_links(target_type, target_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_artifact_target_links_operation
                ON artifact_target_links(operation_id);
            CREATE TRIGGER IF NOT EXISTS trg_artifact_target_links_immutable_update
                BEFORE UPDATE ON artifact_target_links BEGIN SELECT RAISE(ABORT, 'immutable artifact target link'); END;
            CREATE TRIGGER IF NOT EXISTS trg_artifact_target_links_immutable_delete
                BEFORE DELETE ON artifact_target_links BEGIN SELECT RAISE(ABORT, 'immutable artifact target link'); END;",
        )
        .map_err(AppError::database)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXPECTED_MIGRATION_CHECKSUMS: [(&str, &str); 15] = [
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
            "6aa9f1131e702cafef46a727b971fcab64c16b840e93999916785dbef870bced",
        ),
        (
            "006_ai_task_attempts",
            "06f06ca020e390f81d040f5b00b0496eeb8decd15242f9dc9d251b88d40ca361",
        ),
        (
            "007_ai_input_snapshots",
            "61350e555e936d8d4d3071a3ac289355c531a93bb944bcb3294af7b5ddd34736",
        ),
        (
            "008_ai_context_snapshots",
            "6b79604e14bb1969ccde53e40a3e3629e4b5ccc4c4041154ded3cf1ffc0ac5fe",
        ),
        (
            "009_ai_constraint_snapshots",
            "6517b0d1cb2605f35d192bb35be4c7aab02e11f5f50fe78f841b2ef13d03494a",
        ),
        (
            "010_result_artifacts",
            "567e8c1463762029bb8393da6eb94c7b4f68c4ec0bc6fcf349fe465d80c94fb6",
        ),
        (
            "011_artifact_validation_issues",
            "3f8e5d59f40bb3722fd6799267e168ec4855321b3049ce68206fe0f62a74fa85",
        ),
        (
            "012_artifact_placement_proposals",
            "2c0261eb1bb9c813dcc9002cd98b40e85c18b6c084035df453825890de748b1e",
        ),
        (
            "013_artifact_apply_plans",
            "d7d61ac2f4e9bd3828959e3e87ab06c3689dba4bae02c061db3304c20bf261af",
        ),
        (
            "014_artifact_target_links",
            "4a4b7d14faeca7f830454d91e0cd71fce62c2128064eadd15e44cd2009e88de8",
        ),
        (
            "015_snapshot_delete_guards",
            "05e7b1124fb4f78a80e46d6e8dff6e727784094aab5e6cb743b2f2eaf972bf9d",
        ),
    ];

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

    fn prepare_pre_acceptance_snapshot_database(
        connection: &mut Connection,
    ) -> Result<(), Box<dyn std::error::Error>> {
        legacy_schema(connection)?;
        connection.execute_batch("CREATE TABLE quality_check_reports (id TEXT PRIMARY KEY);")?;
        run_migrations(connection)?;
        connection.execute_batch(
            "DROP TRIGGER trg_ai_input_snapshots_immutable_delete;
             DROP TRIGGER trg_ai_context_snapshots_immutable_delete;
             DROP TRIGGER trg_ai_constraint_snapshots_immutable_delete;
             DROP TRIGGER trg_result_artifacts_immutable_delete;
             DELETE FROM schema_migrations WHERE migration_id >= '012';
             DROP TABLE artifact_target_links;
             DROP TABLE artifact_apply_dependencies;
             DROP TABLE artifact_apply_operations;
             DROP TABLE artifact_apply_plans;
             DROP TABLE artifact_placement_targets;
             DROP TABLE artifact_placement_proposals;",
        )?;
        for (migration_id, legacy_checksum) in LEGACY_SNAPSHOT_CHECKSUMS {
            let updated = connection.execute(
                "UPDATE schema_migrations
                 SET version = '2.3.0-M1', checksum = ?1
                 WHERE migration_id = ?2",
                params![legacy_checksum, migration_id],
            )?;
            assert_eq!(updated, 1, "missing legacy ledger row {migration_id}");
        }
        Ok(())
    }

    fn assert_legacy_failure_has_no_forward_writes(
        connection: &Connection,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let forward_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE migration_id >= '012'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(forward_count, 0);
        for object in &SNAPSHOT_DELETE_GUARD_OBJECTS {
            let trigger_count: i64 = connection.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = ?1",
                params![object.name],
                |row| row.get(0),
            )?;
            assert_eq!(trigger_count, 0, "unexpected trigger {}", object.name);
        }
        Ok(())
    }

    #[test]
    fn db01_initializes_ordered_migration_ledger() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        legacy_schema(&connection)?;
        run_migrations(&mut connection)?;
        let migrations = list_applied(&connection)?;
        assert_eq!(migrations.len(), 15);
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
    fn db17_m1_schema_has_all_tables_indexes_and_foreign_keys(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
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
        ] {
            let exists: i64 = connection.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                params![table],
                |row| row.get(0),
            )?;
            assert_eq!(exists, 1, "missing table {table}");
        }
        let attempt_foreign_keys: i64 = connection.query_row(
            "SELECT COUNT(*) FROM pragma_foreign_key_list('ai_task_attempts') WHERE \"table\" = 'ai_tasks'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(attempt_foreign_keys, 1);
        let indexes: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN (
                'idx_ai_tasks_novel_status_created','idx_ai_task_attempts_task_status',
                'idx_result_artifacts_task_created','idx_artifact_validation_artifact')",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(indexes, 4);
        for trigger in [
            "trg_ai_input_snapshots_immutable_update",
            "trg_ai_input_snapshots_immutable_delete",
            "trg_ai_context_snapshots_immutable_update",
            "trg_ai_context_snapshots_immutable_delete",
            "trg_ai_constraint_snapshots_immutable_update",
            "trg_ai_constraint_snapshots_immutable_delete",
            "trg_result_artifacts_immutable_content",
            "trg_result_artifacts_immutable_delete",
            "trg_artifact_validation_issues_append_only_update",
            "trg_artifact_validation_issues_append_only_delete",
        ] {
            let exists: i64 = connection.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = ?1",
                params![trigger],
                |row| row.get(0),
            )?;
            assert_eq!(exists, 1, "missing trigger {trigger}");
        }
        Ok(())
    }

    #[test]
    fn db18_failed_migration_rolls_back_only_the_current_item(
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
        let task_table: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'ai_tasks'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(task_table, 1);
        Ok(())
    }

    #[test]
    fn db19_upgrade_preserves_adopted_pointer_and_legacy_ai_rows(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch(
            "CREATE TABLE chapter_drafts (
                id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
                content TEXT NOT NULL, version_no INTEGER NOT NULL, is_adopted INTEGER NOT NULL,
                large_text_ref_id TEXT
             );
             CREATE TABLE chapters (id TEXT PRIMARY KEY, adopted_draft_id TEXT);
             CREATE TABLE ai_task_records (id TEXT PRIMARY KEY, status TEXT, result_text TEXT);
             INSERT INTO chapter_drafts VALUES
                ('draft-a','novel-a','chapter-a','legacy adopted body',3,1,NULL);
             INSERT INTO chapters VALUES ('chapter-a','draft-a');
             INSERT INTO ai_task_records VALUES ('legacy-task','succeeded','legacy result');",
        )?;
        let before_hash = checksum("legacy adopted body");
        run_migrations(&mut connection)?;
        let adopted: String = connection.query_row(
            "SELECT adopted_draft_id FROM chapters WHERE id = 'chapter-a'",
            [],
            |row| row.get(0),
        )?;
        let body: String = connection.query_row(
            "SELECT content FROM chapter_drafts WHERE id = 'draft-a'",
            [],
            |row| row.get(0),
        )?;
        let legacy_result: String = connection.query_row(
            "SELECT result_text FROM ai_task_records WHERE id = 'legacy-task'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(adopted, "draft-a");
        assert_eq!(checksum(&body), before_hash);
        assert_eq!(legacy_result, "legacy result");
        Ok(())
    }

    #[test]
    fn db21_snapshots_reject_update_and_delete() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        legacy_schema(&connection)?;
        run_migrations(&mut connection)?;
        connection.execute_batch(
            "INSERT INTO ai_tasks
                (task_id, task_type, novel_id, scope_type, status, trace_id, operation_id,
                 request_hash, created_at)
             VALUES ('task-immutable', 'quality_check', 'novel-a', 'draft', 'ready',
                     'trace-a', 'operation-a', 'request-a', 'now');
             INSERT INTO ai_input_snapshots
                (snapshot_id, task_id, schema_version, input_type, payload_json, content_hash, created_at)
             VALUES ('input-a', 'task-immutable', 1, 'input', '{}', 'input-hash', 'now');
             INSERT INTO ai_context_snapshots
                (snapshot_id, task_id, schema_version, source_manifest_json, budget_json,
                 compiler_version, content_hash, created_at)
             VALUES ('context-a', 'task-immutable', 1, '{}', '{}', 'v1', 'context-hash', 'now');
             INSERT INTO ai_constraint_snapshots
                (snapshot_id, task_id, schema_version, payload_json, prompt_template_id,
                 prompt_template_version, prompt_template_hash, provider_options_json,
                 content_hash, created_at)
             VALUES ('constraint-a', 'task-immutable', 1, '{}', 'template', '1',
                     'template-hash', '{}', 'constraint-hash', 'now');",
        )?;

        for (table, id) in [
            ("ai_input_snapshots", "input-a"),
            ("ai_context_snapshots", "context-a"),
            ("ai_constraint_snapshots", "constraint-a"),
        ] {
            assert!(connection
                .execute(
                    &format!("UPDATE {table} SET content_hash = 'changed' WHERE snapshot_id = ?1"),
                    params![id],
                )
                .is_err());
            assert!(connection
                .execute(
                    &format!("DELETE FROM {table} WHERE snapshot_id = ?1"),
                    params![id],
                )
                .is_err());
            let count: i64 = connection.query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE snapshot_id = ?1"),
                params![id],
                |row| row.get(0),
            )?;
            assert_eq!(count, 1);
        }
        Ok(())
    }

    #[test]
    fn db22_v220_ledger_upgrades_from_005_and_restarts_idempotently(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        legacy_schema(&connection)?;
        run_migrations(&mut connection)?;
        let original = list_applied(&connection)?;
        connection.execute_batch(
            "DELETE FROM schema_migrations WHERE migration_id >= '005';
             DROP TABLE artifact_validation_issues;
             DROP TABLE result_artifacts;
             DROP TABLE ai_constraint_snapshots;
             DROP TABLE ai_context_snapshots;
             DROP TABLE ai_input_snapshots;
             DROP TABLE ai_task_attempts;
             DROP TABLE ai_tasks;",
        )?;

        run_migrations(&mut connection)?;
        let upgraded = list_applied(&connection)?;
        assert_eq!(upgraded.len(), 15);
        assert_eq!(&upgraded[..4], &original[..4]);
        let once = upgraded.clone();
        run_migrations(&mut connection)?;
        assert_eq!(list_applied(&connection)?, once);
        Ok(())
    }

    #[test]
    fn db23_m2_schema_has_tables_indexes_and_triggers() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        legacy_schema(&connection)?;
        run_migrations(&mut connection)?;
        for table in [
            "artifact_placement_proposals", "artifact_placement_targets",
            "artifact_apply_plans", "artifact_apply_operations",
            "artifact_apply_dependencies", "artifact_target_links",
        ] {
            let exists: i64 = connection.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                params![table], |row| row.get(0),
            )?;
            assert_eq!(exists, 1, "missing table {table}");
        }
        let trigger_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND
             (name LIKE 'trg_placement_%' OR name LIKE 'trg_apply_%' OR name LIKE 'trg_artifact_target_links_%')",
            [], |row| row.get(0),
        )?;
        assert_eq!(trigger_count, 12);
        Ok(())
    }

    #[test]
    fn db24_m2_proposal_plan_and_link_reject_delete() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        legacy_schema(&connection)?;
        run_migrations(&mut connection)?;
        connection.execute_batch("PRAGMA foreign_keys=OFF;")?;
        connection.execute_batch(
            "INSERT INTO artifact_placement_proposals
                (proposal_id,artifact_id,schema_version,confidence,reasons_json,warnings_json,
                 unresolved_items_json,project_revision_hash,created_at)
             VALUES ('proposal-a','artifact-a',1,1,'[]','[]','[]','revision','now');
             INSERT INTO artifact_placement_targets
                (target_row_id,proposal_id,target_index,target_type,target_id,novel_id,action,
                 source_priority,confidence,reason,is_ready,created_at)
             VALUES ('target-a','proposal-a',0,'chapter','chapter-a','novel-a','save',1,1,'user',1,'now');
             INSERT INTO artifact_apply_plans
                (plan_id,proposal_id,artifact_id,schema_version,expected_versions_json,
                 expected_hashes_json,conflicts_json,operation_id,request_hash,status,created_at)
             VALUES ('plan-a','proposal-a','artifact-a',1,'{}','{}','[]','operation-a','request-a','ready','now');
             INSERT INTO artifact_apply_operations
                (apply_operation_id,plan_id,operation_index,target_type,target_id,action,
                 payload_json,payload_hash,created_at)
             VALUES ('apply-operation-a','plan-a',0,'chapter','chapter-a','save','{}','payload','now');
             INSERT INTO artifact_target_links
                (link_id,artifact_id,plan_id,apply_operation_id,target_type,target_id,operation_id,created_at)
             VALUES ('link-a','artifact-a','plan-a','apply-operation-a','chapter_draft','draft-a','operation-a','now');",
        )?;
        for (table, column, id) in [
            ("artifact_placement_proposals", "proposal_id", "proposal-a"),
            ("artifact_apply_plans", "plan_id", "plan-a"),
            ("artifact_target_links", "link_id", "link-a"),
        ] {
            assert!(connection
                .execute(
                    &format!("DELETE FROM {table} WHERE {column}=?1"),
                    params![id]
                )
                .is_err());
        }
        Ok(())
    }

    #[test]
    fn db25_exact_legacy_snapshot_baseline_upgrades_through_015(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        prepare_pre_acceptance_snapshot_database(&mut connection)?;
        let draft_before: String = connection.query_row(
            "SELECT content FROM chapter_drafts WHERE id = 'legacy-draft'",
            [],
            |row| row.get(0),
        )?;

        run_migrations(&mut connection)?;

        for (migration_id, legacy_checksum) in LEGACY_SNAPSHOT_CHECKSUMS {
            let stored_checksum: String = connection.query_row(
                "SELECT checksum FROM schema_migrations WHERE migration_id = ?1",
                params![migration_id],
                |row| row.get(0),
            )?;
            assert_eq!(stored_checksum, legacy_checksum);
        }
        for migration_id in [
            "012_artifact_placement_proposals",
            "013_artifact_apply_plans",
            "014_artifact_target_links",
            SNAPSHOT_DELETE_GUARDS_MIGRATION_ID,
        ] {
            let count: i64 = connection.query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE migration_id = ?1",
                params![migration_id],
                |row| row.get(0),
            )?;
            assert_eq!(count, 1, "missing migration {migration_id}");
        }
        connection.execute_batch(
            "PRAGMA foreign_keys = OFF;
             INSERT INTO ai_input_snapshots
                (snapshot_id,task_id,schema_version,input_type,payload_json,content_hash,created_at)
             VALUES ('legacy-input','task-input',1,'input','{}','hash-input','now');
             INSERT INTO ai_context_snapshots
                (snapshot_id,task_id,schema_version,source_manifest_json,budget_json,
                 compiler_version,content_hash,created_at)
             VALUES ('legacy-context','task-context',1,'{}','{}','v1','hash-context','now');
             INSERT INTO ai_constraint_snapshots
                (snapshot_id,task_id,schema_version,payload_json,prompt_template_id,
                 prompt_template_version,prompt_template_hash,provider_options_json,
                 content_hash,created_at)
             VALUES ('legacy-constraint','task-constraint',1,'{}','template','1',
                     'template-hash','{}','hash-constraint','now');
             INSERT INTO result_artifacts
                (artifact_id,task_id,attempt_id,artifact_type,schema_version,
                 raw_content_ref_id,source_novel_id,content_hash,content_length,
                 processing_status,created_at)
             VALUES ('legacy-artifact','task-artifact','attempt-artifact','chapter',1,
                     'raw-ref','novel-a','hash-artifact',1,'valid','now');",
        )?;
        for (table, id_column, id) in [
            ("ai_input_snapshots", "snapshot_id", "legacy-input"),
            ("ai_context_snapshots", "snapshot_id", "legacy-context"),
            (
                "ai_constraint_snapshots",
                "snapshot_id",
                "legacy-constraint",
            ),
            ("result_artifacts", "artifact_id", "legacy-artifact"),
        ] {
            assert!(connection
                .execute(
                    &format!("DELETE FROM {table} WHERE {id_column} = ?1"),
                    params![id],
                )
                .is_err());
        }
        let draft_after: String = connection.query_row(
            "SELECT content FROM chapter_drafts WHERE id = 'legacy-draft'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(draft_after, draft_before);

        let once = list_applied(&connection)?;
        run_migrations(&mut connection)?;
        assert_eq!(list_applied(&connection)?, once);
        Ok(())
    }

    #[test]
    fn db26_unknown_legacy_snapshot_checksums_fail_closed() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = Connection::open_in_memory()?;
        prepare_pre_acceptance_snapshot_database(&mut connection)?;
        connection.execute(
            "UPDATE schema_migrations SET checksum = 'unknown'
             WHERE migration_id IN (
                '007_ai_input_snapshots','008_ai_context_snapshots',
                '009_ai_constraint_snapshots','010_result_artifacts'
             )",
            [],
        )?;

        let error = run_migrations(&mut connection).expect_err("unknown checksums must fail");
        assert_eq!(error.code, codes::DATABASE_TRANSACTION_FAILED);
        assert_legacy_failure_has_no_forward_writes(&connection)?;
        Ok(())
    }

    #[test]
    fn db27_mixed_legacy_snapshot_checksums_fail_closed() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = Connection::open_in_memory()?;
        prepare_pre_acceptance_snapshot_database(&mut connection)?;
        connection.execute(
            "UPDATE schema_migrations SET checksum = ?1
             WHERE migration_id = '010_result_artifacts'",
            params![EXPECTED_MIGRATION_CHECKSUMS[9].1],
        )?;

        let error = run_migrations(&mut connection).expect_err("mixed checksums must fail");
        assert_eq!(error.code, codes::DATABASE_TRANSACTION_FAILED);
        assert_legacy_failure_has_no_forward_writes(&connection)?;
        Ok(())
    }

    #[test]
    fn db28_fake_legacy_snapshot_schema_fails_closed() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        prepare_pre_acceptance_snapshot_database(&mut connection)?;
        connection.execute_batch("DROP TRIGGER trg_ai_context_snapshots_immutable_update;")?;

        let error = run_migrations(&mut connection).expect_err("fake schema must fail");
        assert_eq!(error.code, codes::DATABASE_TRANSACTION_FAILED);
        assert_legacy_failure_has_no_forward_writes(&connection)?;
        Ok(())
    }

    #[test]
    fn db29_incomplete_legacy_ledger_fails_before_forward_writes(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        prepare_pre_acceptance_snapshot_database(&mut connection)?;
        connection.execute(
            "DELETE FROM schema_migrations WHERE migration_id = '006_ai_task_attempts'",
            [],
        )?;

        let error = run_migrations(&mut connection).expect_err("incomplete ledger must fail");
        assert_eq!(error.code, codes::DATABASE_TRANSACTION_FAILED);
        assert_legacy_failure_has_no_forward_writes(&connection)?;
        Ok(())
    }

    #[test]
    fn db30_fake_existing_delete_guard_blocks_015() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        legacy_schema(&connection)?;
        run_migrations(&mut connection)?;
        connection.execute_batch(
            "DELETE FROM schema_migrations WHERE migration_id = '015_snapshot_delete_guards';
             DROP TRIGGER trg_ai_input_snapshots_immutable_delete;
             CREATE TRIGGER trg_ai_input_snapshots_immutable_delete
                BEFORE DELETE ON ai_input_snapshots BEGIN SELECT 1; END;",
        )?;

        let error = run_migrations(&mut connection).expect_err("fake guard must fail");
        assert_eq!(error.code, codes::DATABASE_TRANSACTION_FAILED);
        let migration_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM schema_migrations
             WHERE migration_id = '015_snapshot_delete_guards'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(migration_count, 0);
        Ok(())
    }
}
