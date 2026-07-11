use crate::errors::{codes, AppError};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
#[cfg(test)]
use serde::Serialize;
use sha2::{Digest, Sha256};

const MIGRATION_VERSION: &str = "2.3.0-M1";

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

fn migrations() -> [Migration; 11] {
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
            definition: "ai_input_snapshots_v1(task,schema,input,payload,body_ref,source_draft,base_hash,content_hash,created,immutable_update)",
            apply: apply_ai_input_snapshots,
        },
        Migration {
            id: "008_ai_context_snapshots",
            definition: "ai_context_snapshots_v1(task,schema,manifest,compiled_ref,budget,compiler,content_hash,created,immutable_update)",
            apply: apply_ai_context_snapshots,
        },
        Migration {
            id: "009_ai_constraint_snapshots",
            definition: "ai_constraint_snapshots_v1(task,schema,payload,template_identity,template_ref,provider_options,content_hash,created,immutable_update)",
            apply: apply_ai_constraint_snapshots,
        },
        Migration {
            id: "010_result_artifacts",
            definition: "result_artifacts_v1(task,attempt,type,schema,raw_ref,display_ref,payload,source_identity,content_hash,status,parent,derivation,created,immutable_content,draft_and_quality_source_columns)",
            apply: apply_result_artifacts,
        },
        Migration {
            id: "011_artifact_validation_issues",
            definition: "artifact_validation_issues_v1(artifact,run,severity,code,message,path,details,validator,created,indexes,append_only)",
            apply: apply_artifact_validation_issues,
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
            if actual_checksum != expected_checksum {
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
                BEFORE UPDATE ON ai_input_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;",
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
                BEFORE UPDATE ON ai_context_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;",
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
                BEFORE UPDATE ON ai_constraint_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;",
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
                ON result_artifacts BEGIN SELECT RAISE(ABORT, 'immutable artifact'); END;",
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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(migrations.len(), 11);
        assert_eq!(migrations[0].migration_id, "001_schema_migrations");
        assert_eq!(
            migrations[10].migration_id,
            "011_artifact_validation_issues"
        );
        assert!(migrations.iter().all(|item| item.checksum.len() == 64));
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
        Ok(())
    }

    #[test]
    fn db18_failed_migration_rolls_back_only_the_current_item(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        legacy_schema(&connection)?;
        connection.execute_batch(
            "CREATE TABLE ai_task_attempts (broken_column TEXT);",
        )?;
        assert!(run_migrations(&mut connection).is_err());
        let applied = list_applied(&connection)?;
        assert_eq!(applied.last().map(|item| item.migration_id.as_str()), Some("005_ai_tasks"));
        assert!(applied.iter().all(|item| item.migration_id != "006_ai_task_attempts"));
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
}
