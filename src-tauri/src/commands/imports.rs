use crate::db::get_connection;
use crate::errors::AppError;
use rusqlite::{params, Connection, TransactionBehavior};

fn rollback_imported_novel_transaction(
    connection: &mut Connection,
    novel_id: &str,
) -> Result<(), AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;

    transaction
        .execute(
            "DELETE FROM large_text_documents
             WHERE id IN (
                SELECT large_text_ref_id FROM chapter_drafts
                 WHERE novel_id = ?1 AND large_text_ref_id IS NOT NULL
                UNION
                SELECT large_text_ref_id FROM style_profiles
                 WHERE novel_id = ?1 AND large_text_ref_id IS NOT NULL
                UNION
                SELECT large_text_ref_id FROM output_profiles
                 WHERE novel_id = ?1 AND large_text_ref_id IS NOT NULL
             )",
            params![novel_id],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "DELETE FROM draft_save_operations WHERE novel_id = ?1",
            params![novel_id],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "DELETE FROM workspace_recovery_snapshots WHERE novel_id = ?1",
            params![novel_id],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "UPDATE chapters SET adopted_draft_id = NULL WHERE novel_id = ?1",
            params![novel_id],
        )
        .map_err(AppError::database)?;
    for table in [
        "chapter_drafts",
        "style_profiles",
        "output_profiles",
        "imported_assets",
        "chapters",
        "volumes",
    ] {
        transaction
            .execute(
                &format!("DELETE FROM {table} WHERE novel_id = ?1"),
                params![novel_id],
            )
            .map_err(AppError::database)?;
    }
    transaction
        .execute("DELETE FROM novels WHERE id = ?1", params![novel_id])
        .map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)
}

#[tauri::command]
pub fn rollback_imported_novel(novel_id: String) -> Result<(), AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    rollback_imported_novel_transaction(&mut connection, &novel_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_database() -> rusqlite::Result<Connection> {
        let connection = Connection::open_in_memory()?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE novels (id TEXT PRIMARY KEY, title TEXT NOT NULL);
             CREATE TABLE volumes (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL);
             CREATE TABLE chapters (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                adopted_draft_id TEXT
             );
             CREATE TABLE chapter_drafts (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                large_text_ref_id TEXT
             );
             CREATE TABLE style_profiles (
                id TEXT PRIMARY KEY,
                novel_id TEXT,
                large_text_ref_id TEXT
             );
             CREATE TABLE output_profiles (
                id TEXT PRIMARY KEY,
                novel_id TEXT,
                large_text_ref_id TEXT
             );
             CREATE TABLE imported_assets (id TEXT PRIMARY KEY, novel_id TEXT);
             CREATE TABLE draft_save_operations (operation_id TEXT PRIMARY KEY, novel_id TEXT NOT NULL);
             CREATE TABLE workspace_recovery_snapshots (novel_id TEXT NOT NULL);
             CREATE TABLE large_text_documents (id TEXT PRIMARY KEY);
             CREATE TABLE large_text_chunks (
                document_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                PRIMARY KEY(document_id, chunk_index),
                FOREIGN KEY(document_id) REFERENCES large_text_documents(id) ON DELETE CASCADE
             );",
        )?;
        Ok(connection)
    }

    fn seed_import(connection: &Connection) -> rusqlite::Result<()> {
        connection.execute_batch(
            "INSERT INTO novels VALUES ('imported', '导入作品');
             INSERT INTO novels VALUES ('existing', '已有作品');
             INSERT INTO volumes VALUES ('volume-imported', 'imported');
             INSERT INTO volumes VALUES ('volume-existing', 'existing');
             INSERT INTO chapters VALUES ('chapter-imported', 'imported', 'draft-imported');
             INSERT INTO chapters VALUES ('chapter-existing', 'existing', NULL);
             INSERT INTO large_text_documents VALUES ('doc-imported');
             INSERT INTO large_text_chunks VALUES ('doc-imported', 0);
             INSERT INTO chapter_drafts VALUES ('draft-imported', 'imported', 'chapter-imported', 'doc-imported');
             INSERT INTO style_profiles VALUES ('style-imported', 'imported', NULL);
             INSERT INTO output_profiles VALUES ('output-imported', 'imported', NULL);
             INSERT INTO imported_assets VALUES ('asset-imported', 'imported');
             INSERT INTO draft_save_operations VALUES ('operation-imported', 'imported');
             INSERT INTO workspace_recovery_snapshots VALUES ('imported');",
        )
    }

    fn count(connection: &Connection, table: &str, novel_id: Option<&str>) -> rusqlite::Result<i64> {
        if let Some(novel_id) = novel_id {
            connection.query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE novel_id = ?1"),
                params![novel_id],
                |row| row.get(0),
            )
        } else {
            connection.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
        }
    }

    #[test]
    fn import01_failed_import_cleanup_removes_all_new_rows_and_keeps_existing_project(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = test_database()?;
        seed_import(&connection)?;

        rollback_imported_novel_transaction(&mut connection, "imported")?;

        for table in [
            "volumes",
            "chapters",
            "chapter_drafts",
            "style_profiles",
            "output_profiles",
            "imported_assets",
            "draft_save_operations",
            "workspace_recovery_snapshots",
        ] {
            assert_eq!(count(&connection, table, Some("imported"))?, 0, "{table}");
        }
        assert_eq!(count(&connection, "large_text_documents", None)?, 0);
        assert_eq!(count(&connection, "large_text_chunks", None)?, 0);
        assert_eq!(count(&connection, "novels", None)?, 1);
        assert_eq!(count(&connection, "volumes", Some("existing"))?, 1);
        assert_eq!(count(&connection, "chapters", Some("existing"))?, 1);
        Ok(())
    }

    #[test]
    fn import02_cleanup_error_rolls_back_every_delete() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = test_database()?;
        seed_import(&connection)?;
        connection.execute_batch(
            "CREATE TRIGGER reject_imported_chapter_delete
             BEFORE DELETE ON chapters
             WHEN OLD.novel_id = 'imported'
             BEGIN SELECT RAISE(ABORT, 'forced cleanup failure'); END;",
        )?;

        assert!(rollback_imported_novel_transaction(&mut connection, "imported").is_err());

        assert_eq!(count(&connection, "novels", None)?, 2);
        assert_eq!(count(&connection, "volumes", Some("imported"))?, 1);
        assert_eq!(count(&connection, "chapters", Some("imported"))?, 1);
        assert_eq!(count(&connection, "chapter_drafts", Some("imported"))?, 1);
        assert_eq!(count(&connection, "draft_save_operations", Some("imported"))?, 1);
        assert_eq!(count(&connection, "large_text_documents", None)?, 1);
        assert_eq!(count(&connection, "large_text_chunks", None)?, 1);
        Ok(())
    }
}
