use crate::db::get_connection;
use crate::errors::{codes, AppError};
use rusqlite::{params, Connection, TransactionBehavior};
use serde_json::json;
use std::fs::File;
use std::io::Read;
use std::path::Path;

const MAX_IMPORT_FILE_BYTES: u64 = 64 * 1024 * 1024;

fn expected_import_extension(kind: &str) -> Result<&'static str, AppError> {
    match kind {
        "txt" => Ok("txt"),
        "json" => Ok("json"),
        _ => Err(
            AppError::new(codes::IMPORT_FILE_INVALID, "不支持的导入文件类型", false)
                .with_details(json!({ "kind": kind })),
        ),
    }
}

fn read_import_text_file_from_path(path: &Path, kind: &str) -> Result<String, AppError> {
    let expected_extension = expected_import_extension(kind)?;
    let actual_extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if actual_extension != expected_extension {
        return Err(AppError::new(
            codes::IMPORT_FILE_INVALID,
            format!("文件格式不受支持，请选择 .{expected_extension} 文件"),
            false,
        )
        .with_details(json!({
            "expectedExtension": expected_extension,
            "actualExtension": actual_extension,
        })));
    }

    let metadata = std::fs::symlink_metadata(path).map_err(|error| {
        AppError::new(
            codes::IMPORT_FILE_READ_FAILED,
            "无法读取所选文件，请确认文件仍然存在且可访问",
            false,
        )
        .with_details(json!({ "ioErrorKind": format!("{:?}", error.kind()) }))
    })?;
    if !metadata.file_type().is_file() {
        return Err(AppError::new(
            codes::IMPORT_FILE_INVALID,
            "所选路径不是可导入的普通文件",
            false,
        ));
    }
    if metadata.len() > MAX_IMPORT_FILE_BYTES {
        return Err(AppError::new(
            codes::IMPORT_FILE_TOO_LARGE,
            "导入文件过大，当前最多支持 64 MB",
            false,
        )
        .with_details(json!({
            "maxBytes": MAX_IMPORT_FILE_BYTES,
            "actualBytes": metadata.len(),
        })));
    }

    let file = File::open(path).map_err(|error| {
        AppError::new(
            codes::IMPORT_FILE_READ_FAILED,
            "无法打开所选文件，请确认文件未被占用",
            error.kind() == std::io::ErrorKind::Interrupted,
        )
        .with_details(json!({ "ioErrorKind": format!("{:?}", error.kind()) }))
    })?;
    let mut bytes = Vec::with_capacity(metadata.len().min(MAX_IMPORT_FILE_BYTES) as usize);
    file.take(MAX_IMPORT_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            AppError::new(
                codes::IMPORT_FILE_READ_FAILED,
                "读取所选文件失败，请重新选择后重试",
                error.kind() == std::io::ErrorKind::Interrupted,
            )
            .with_details(json!({ "ioErrorKind": format!("{:?}", error.kind()) }))
        })?;
    if bytes.len() as u64 > MAX_IMPORT_FILE_BYTES {
        return Err(AppError::new(
            codes::IMPORT_FILE_TOO_LARGE,
            "导入文件过大，当前最多支持 64 MB",
            false,
        )
        .with_details(json!({ "maxBytes": MAX_IMPORT_FILE_BYTES })));
    }

    String::from_utf8(bytes).map_err(|_| {
        AppError::new(
            codes::IMPORT_FILE_ENCODING_INVALID,
            "文件不是有效的 UTF-8 文本，请转换编码后重试",
            false,
        )
    })
}

#[tauri::command]
pub async fn read_import_text_file(path: String, kind: String) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        read_import_text_file_from_path(Path::new(&path), &kind)
    })
    .await
    .map_err(|error| {
        AppError::new(
            codes::IMPORT_FILE_READ_FAILED,
            "读取导入文件的后台任务失败",
            true,
        )
        .with_details(json!({ "joinError": error.to_string() }))
    })?
}

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
    use std::fs;
    use uuid::Uuid;

    fn temp_import_path(extension: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "ai-novel-studio-import-{}.{}",
            Uuid::new_v4(),
            extension
        ))
    }

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

    fn count(
        connection: &Connection,
        table: &str,
        novel_id: Option<&str>,
    ) -> rusqlite::Result<i64> {
        if let Some(novel_id) = novel_id {
            connection.query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE novel_id = ?1"),
                params![novel_id],
                |row| row.get(0),
            )
        } else {
            connection.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
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
        assert_eq!(
            count(&connection, "draft_save_operations", Some("imported"))?,
            1
        );
        assert_eq!(count(&connection, "large_text_documents", None)?, 1);
        assert_eq!(count(&connection, "large_text_chunks", None)?, 1);
        Ok(())
    }

    #[test]
    fn import03_reads_supported_utf8_file_outside_tauri_fs_scope(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let path = temp_import_path("txt");
        fs::write(&path, "第一章 初见\n这是导入正文。")?;

        let content = read_import_text_file_from_path(&path, "txt")?;
        let _ = fs::remove_file(&path);

        assert_eq!(content, "第一章 初见\n这是导入正文。");
        Ok(())
    }

    #[test]
    fn import04_rejects_wrong_extension_and_non_utf8_content(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let wrong_extension = temp_import_path("json");
        fs::write(&wrong_extension, "{}")?;
        let wrong_error = read_import_text_file_from_path(&wrong_extension, "txt")
            .expect_err("a JSON file must not pass TXT validation");
        let _ = fs::remove_file(&wrong_extension);
        assert_eq!(wrong_error.code, codes::IMPORT_FILE_INVALID);

        let invalid_utf8 = temp_import_path("txt");
        fs::write(&invalid_utf8, [0xff, 0xfe, 0xfd])?;
        let encoding_error = read_import_text_file_from_path(&invalid_utf8, "txt")
            .expect_err("invalid UTF-8 must be rejected");
        let _ = fs::remove_file(&invalid_utf8);
        assert_eq!(encoding_error.code, codes::IMPORT_FILE_ENCODING_INVALID);
        Ok(())
    }

    #[test]
    fn import05_rejects_file_larger_than_the_bounded_reader_limit(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let path = temp_import_path("txt");
        let file = File::create(&path)?;
        file.set_len(MAX_IMPORT_FILE_BYTES + 1)?;
        drop(file);

        let error = read_import_text_file_from_path(&path, "txt")
            .expect_err("oversized import file must be rejected");
        let _ = fs::remove_file(&path);

        assert_eq!(error.code, codes::IMPORT_FILE_TOO_LARGE);
        Ok(())
    }
}
