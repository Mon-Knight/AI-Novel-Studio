use crate::errors::{codes, AppError};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
#[cfg(test)]
use serde::Serialize;
use sha2::{Digest, Sha256};

const MIGRATION_VERSION: &str = "2.2.0";

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

fn migrations() -> [Migration; 4] {
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
        assert_eq!(migrations.len(), 4);
        assert_eq!(migrations[0].migration_id, "001_schema_migrations");
        assert_eq!(migrations[3].migration_id, "004_large_text_integrity");
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
}
