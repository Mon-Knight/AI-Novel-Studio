#![allow(unused_imports, dead_code)]

use crate::db::{get_connection, get_database_path};

use crate::errors::{log_workspace_event, WorkspaceLogEvent};
use rusqlite::{params, Connection, Row, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

pub mod agent_plans;
pub mod ai;
pub mod ai_request_policy;
pub mod ai_tasks;
pub mod app_update;
pub mod artifacts;
pub mod autonomous_scheduler;
pub mod autonomous_story;
pub mod content_transactions;
pub mod context;
pub mod conversations;
pub mod drafts;
pub mod memory;
pub mod multi_agent;
pub mod output_profiles;
pub mod placements;
pub mod project;
pub mod recovery;
pub mod reference_library;
pub mod world;
pub mod writing;

#[allow(unused_imports, dead_code)]
pub use crate::domain::ai::*;

pub use self::ai::*;
pub use self::context::*;
pub use self::project::*;
pub use self::world::*;
pub use self::writing::*;
pub use crate::domain::context::*;
pub use crate::domain::project::*;
pub use crate::domain::world::*;
pub use crate::domain::writing::*;
pub use crate::repositories::chapter_repository::{
    count_words, get_draft_by_id_and_chapter_internal, get_draft_by_id_internal,
};

// ==================== World Domain (Settings, Rules, Protagonists) migrated to commands/world.rs ====================

// ==================== Writing Domain (Volume, Chapter, Drafts) migrated to commands/writing.rs ====================

// ==================== AI Engine Domain migrated to commands/ai.rs ====================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::mpsc;
    use std::time::Duration;

    const RUNTIME_AI_TASK_CHILD_TABLES: [&str; 5] = [
        "chapter_drafts",
        "quality_check_reports",
        "polish_records",
        "chapter_events",
        "chapter_summaries",
    ];

    #[test]
    fn draft_word_count_matches_editor_semantics() {
        assert_eq!(count_words("你好，世界！ Hello world 2026."), 7);
        assert_eq!(count_words("# 标题\nalpha-beta `42`"), 5);
        assert_eq!(count_words(" \n\t，。！？ "), 0);
    }

    fn create_volume_chapter_update_test_schema(conn: &Connection) -> rusqlite::Result<()> {
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;

            CREATE TABLE volumes (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT,
                goal TEXT,
                main_conflict TEXT,
                order_index INTEGER NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );

            CREATE TABLE chapters (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                volume_id TEXT,
                title TEXT NOT NULL,
                outline TEXT,
                goal TEXT,
                order_index INTEGER NOT NULL,
                status TEXT NOT NULL,
                adopted_draft_id TEXT,
                word_count INTEGER NOT NULL,
                target_word_count INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT,
                FOREIGN KEY (volume_id) REFERENCES volumes(id)
            );


            INSERT INTO volumes
                (id, novel_id, title, summary, goal, main_conflict, order_index, status, created_at, updated_at)
            VALUES
                ('volume-a', 'novel-a', 'volume-original-a', NULL, NULL, NULL, 0, 'planned', 'before', 'before'),
                ('volume-b', 'novel-a', 'volume-original-b', NULL, NULL, NULL, 1, 'planned', 'before', 'before');

            INSERT INTO chapters
                (id, novel_id, volume_id, title, outline, goal, order_index, status, adopted_draft_id, word_count, target_word_count, created_at, updated_at)
            VALUES
                ('chapter-a', 'novel-a', 'volume-a', 'chapter-original-a', NULL, NULL, 0, 'not_started', NULL, 0, 3000, 'before', 'before'),
                ('chapter-b', 'novel-a', 'volume-b', 'chapter-original-b', NULL, NULL, 1, 'not_started', NULL, 0, 3000, 'before', 'before');
            ",
        )
    }

    #[test]
    fn update_volume_binds_ipc_values_and_rejects_invalid_status() {
        let conn = Connection::open_in_memory().unwrap();
        create_volume_chapter_update_test_schema(&conn).unwrap();

        let injection_result = update_volume_internal(
            &conn,
            "volume-a' OR 1=1 --",
            UpdateVolumeInput {
                title: Some("injected".to_string()),
                summary: None,
                goal: None,
                main_conflict: None,
                order_index: None,
                status: None,
            },
            "after-injection",
        );
        assert!(injection_result.is_err());
        let untouched: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM volumes WHERE title LIKE 'volume-original-%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(untouched, 2);

        let updated = update_volume_internal(
            &conn,
            "volume-a",
            UpdateVolumeInput {
                title: Some("Writer's volume".to_string()),
                summary: None,
                goal: None,
                main_conflict: None,
                order_index: Some(2),
                status: Some("writing".to_string()),
            },
            "after-valid-update",
        )
        .unwrap();
        assert_eq!(updated.title, "Writer's volume");
        assert_eq!(updated.status, "writing");
        assert_eq!(updated.order_index, 2);

        let invalid_status = update_volume_internal(
            &conn,
            "volume-a",
            UpdateVolumeInput {
                title: Some("must-not-apply".to_string()),
                summary: None,
                goal: None,
                main_conflict: None,
                order_index: None,
                status: Some("writing', title = 'injected".to_string()),
            },
            "after-invalid-status",
        )
        .unwrap_err();
        assert_eq!(invalid_status, "volume_status_invalid");
        let title: String = conn
            .query_row(
                "SELECT title FROM volumes WHERE id = 'volume-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(title, "Writer's volume");
    }

    #[test]
    fn update_chapter_binds_ipc_values_and_rejects_invalid_status() {
        let conn = Connection::open_in_memory().unwrap();
        create_volume_chapter_update_test_schema(&conn).unwrap();

        let injection_result = update_chapter_internal(
            &conn,
            "chapter-a' OR 1=1 --",
            UpdateChapterInput {
                volume_id: None,
                title: Some("injected".to_string()),
                outline: None,
                goal: None,
                order_index: None,
                status: None,
                target_word_count: None,
            },
            "after-injection",
        );
        assert!(injection_result.is_err());
        let untouched: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chapters WHERE title LIKE 'chapter-original-%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(untouched, 2);

        let injected_volume_id = "volume-b' OR 1=1 --";
        let volume_injection = update_chapter_internal(
            &conn,
            "chapter-a",
            UpdateChapterInput {
                volume_id: Some(injected_volume_id.to_string()),
                title: Some("must-not-apply".to_string()),
                outline: None,
                goal: None,
                order_index: Some(2),
                status: Some("editing".to_string()),
                target_word_count: Some(4500),
            },
            "after-volume-injection",
        );
        assert!(volume_injection.is_err());
        let unchanged_title: String = conn
            .query_row(
                "SELECT title FROM chapters WHERE id = 'chapter-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(unchanged_title, "chapter-original-a");

        let updated = update_chapter_internal(
            &conn,
            "chapter-a",
            UpdateChapterInput {
                volume_id: Some("volume-b".to_string()),
                title: Some("Editor's chapter".to_string()),
                outline: Some("The hero's choice".to_string()),
                goal: None,
                order_index: Some(2),
                status: Some("editing".to_string()),
                target_word_count: Some(4500),
            },
            "after-valid-update",
        )
        .unwrap();
        assert_eq!(updated.volume_id.as_deref(), Some("volume-b"));
        assert_eq!(updated.title, "Editor's chapter");
        assert_eq!(updated.outline.as_deref(), Some("The hero's choice"));
        assert_eq!(updated.status, "editing");
        assert_eq!(updated.target_word_count, Some(4500));
        let other_title: String = conn
            .query_row(
                "SELECT title FROM chapters WHERE id = 'chapter-b'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(other_title, "chapter-original-b");

        let invalid_status = update_chapter_internal(
            &conn,
            "chapter-a",
            UpdateChapterInput {
                volume_id: None,
                title: Some("must-not-apply".to_string()),
                outline: None,
                goal: None,
                order_index: None,
                status: Some("editing', title = 'injected".to_string()),
                target_word_count: None,
            },
            "after-invalid-status",
        )
        .unwrap_err();
        assert_eq!(invalid_status, "chapter_status_invalid");
        let title: String = conn
            .query_row(
                "SELECT title FROM chapters WHERE id = 'chapter-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(title, "Editor's chapter");
    }

    #[test]
    fn create_novel_command_returns_without_relocking_database_mutex() {
        crate::db::init_test_database();
        let (sender, receiver) = mpsc::channel();

        std::thread::spawn(move || {
            let result = create_novel(CreateNovelInput {
                title: "Mutex regression novel".to_string(),
                subtitle: None,
                description: None,
                outline: None,
                genre: None,
                target_word_count: None,
            });
            let _ = sender.send(result);
        });

        let result = receiver
            .recv_timeout(Duration::from_millis(300))
            .expect("create_novel timed out while re-locking the database mutex");
        assert!(result.is_ok(), "create_novel failed: {:?}", result.err());
    }

    #[test]
    fn update_novel_command_returns_without_relocking_database_mutex() {
        crate::db::init_test_database();
        let novel_id = format!("mutex-regression-{}", uuid::Uuid::new_v4());
        let now = chrono::Utc::now().to_rfc3339();
        {
            let conn = crate::db::get_connection()
                .lock()
                .expect("lock test database");
            conn.execute(
                "INSERT INTO novels (id, title, outline, status, total_word_count, protagonist_mode, protagonists_json, dual_protagonist_relation_json, main_character, protagonist_ability, created_at, updated_at) VALUES (?1, 'Before update', '', 'draft', 0, 'single', '[]', '{}', '', '', ?2, ?2)",
                params![&novel_id, &now],
            )
            .expect("seed novel");
        }

        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let result = update_novel(
                novel_id,
                UpdateNovelInput {
                    title: Some("After update".to_string()),
                    subtitle: None,
                    description: None,
                    outline: None,
                    genre: None,
                    status: None,
                    target_word_count: None,
                    current_volume_id: None,
                    current_chapter_id: None,
                    total_word_count: None,
                    protagonist_mode: None,
                    protagonists: None,
                    dual_protagonist_relation: None,
                    main_character: None,
                    protagonist_ability: None,
                },
            );
            let _ = sender.send(result);
        });

        let result = receiver
            .recv_timeout(Duration::from_millis(300))
            .expect("update_novel timed out while re-locking the database mutex")
            .expect("update_novel failed");
        assert_eq!(result.title, "After update");
    }

    fn create_runtime_ai_task_table(conn: &Connection) -> rusqlite::Result<()> {
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;

            CREATE TABLE ai_task_records (
                id TEXT PRIMARY KEY,
                task_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL
            );

            CREATE TABLE chapter_drafts (
                id TEXT PRIMARY KEY,
                ai_task_id TEXT,
                FOREIGN KEY (ai_task_id) REFERENCES ai_task_records(id)
            );

            CREATE TABLE quality_check_reports (
                id TEXT PRIMARY KEY,
                ai_task_id TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                FOREIGN KEY (ai_task_id) REFERENCES ai_task_records(id)
            );

            CREATE TABLE polish_records (
                id TEXT PRIMARY KEY,
                ai_task_id TEXT,
                FOREIGN KEY (ai_task_id) REFERENCES ai_task_records(id)
            );

            CREATE TABLE chapter_events (
                id TEXT PRIMARY KEY,
                ai_task_id TEXT
            );

            CREATE TABLE chapter_summaries (
                id TEXT PRIMARY KEY,
                ai_task_id TEXT
            );
            ",
        )
    }

    fn create_chapter_draft_test_schema(conn: &Connection) -> rusqlite::Result<()> {
        conn.execute_batch(
            "
            CREATE TABLE novels (
                id TEXT PRIMARY KEY,
                total_word_count INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );

            CREATE TABLE chapters (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                adopted_draft_id TEXT,
                word_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'not_started',
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );

            CREATE TABLE chapter_drafts (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                title TEXT,
                content TEXT NOT NULL,
                source TEXT NOT NULL,
                version_no INTEGER NOT NULL,
                word_count INTEGER NOT NULL,
                is_adopted INTEGER NOT NULL DEFAULT 0,
                ai_task_id TEXT,
                note TEXT,
                large_text_ref_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE chapter_summaries (
                id TEXT PRIMARY KEY,
                chapter_id TEXT NOT NULL,
                is_expired INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE context_records (
                id TEXT PRIMARY KEY,
                chapter_id TEXT NOT NULL,
                is_expired INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE memory_documents (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                adopted_draft_id TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                invalidated_at TEXT,
                invalidation_reason TEXT,
                updated_at TEXT NOT NULL
            );
            ",
        )
    }

    fn insert_test_chapter(
        conn: &Connection,
        id: &str,
        adopted_draft_id: Option<&str>,
        word_count: i64,
        status: &str,
    ) -> rusqlite::Result<()> {
        insert_test_chapter_for_novel(
            conn,
            id,
            "novel-1",
            adopted_draft_id,
            word_count,
            status,
            None,
        )
    }

    fn insert_test_chapter_for_novel(
        conn: &Connection,
        id: &str,
        novel_id: &str,
        adopted_draft_id: Option<&str>,
        word_count: i64,
        status: &str,
        deleted_at: Option<&str>,
    ) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT OR IGNORE INTO novels (id, total_word_count, updated_at)
             VALUES (?1, 0, 'before')",
            params![novel_id],
        )?;
        conn.execute(
            "INSERT INTO chapters (id, novel_id, adopted_draft_id, word_count, status, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, novel_id, adopted_draft_id, word_count, status, "before", deleted_at],
        )?;
        Ok(())
    }

    fn insert_test_draft(
        conn: &Connection,
        id: &str,
        chapter_id: &str,
        content: &str,
        is_adopted: bool,
    ) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO chapter_drafts (id, novel_id, chapter_id, title, content, source, version_no, word_count, is_adopted, created_at, updated_at) VALUES (?1, 'novel-1', ?2, NULL, ?3, 'user_edited', 1, ?4, ?5, 'before', 'before')",
            params![id, chapter_id, content, count_words(content), i64::from(is_adopted)],
        )?;
        Ok(())
    }

    fn attach_test_large_text(
        conn: &Connection,
        document_id: &str,
        draft_id: &str,
    ) -> rusqlite::Result<()> {
        crate::large_text_save::create_large_text_tables(conn)?;
        conn.execute(
            "INSERT INTO large_text_documents (id, target_type, target_id, field_name, total_chars, total_bytes, chunk_count, content_sha256, created_at, updated_at) VALUES (?1, 'draft', ?2, 'content', 4, 4, 1, 'test-hash', 'before', 'before')",
            params![document_id, draft_id],
        )?;
        conn.execute(
            "INSERT INTO large_text_chunks (document_id, chunk_index, content, char_count, byte_count, chunk_sha256, created_at) VALUES (?1, 0, 'text', 4, 4, 'test-hash', 'before')",
            params![document_id],
        )?;
        conn.execute(
            "UPDATE chapter_drafts SET large_text_ref_id = ?1 WHERE id = ?2",
            params![document_id, draft_id],
        )?;
        Ok(())
    }

    fn get_test_draft_adopted(conn: &Connection, id: &str) -> rusqlite::Result<i64> {
        conn.query_row(
            "SELECT is_adopted FROM chapter_drafts WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
    }

    fn get_test_chapter_state(
        conn: &Connection,
        id: &str,
    ) -> rusqlite::Result<(Option<String>, i64, String, String)> {
        conn.query_row(
            "SELECT adopted_draft_id, word_count, status, updated_at FROM chapters WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
    }

    fn insert_test_chapter_context(conn: &Connection, chapter_id: &str) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO chapter_summaries (id, chapter_id, is_expired, updated_at)
             VALUES (?1, ?2, 0, 'before')",
            params![format!("summary-{chapter_id}"), chapter_id],
        )?;
        conn.execute(
            "INSERT INTO context_records (id, chapter_id, is_expired, updated_at)
             VALUES (?1, ?2, 0, 'before')",
            params![format!("context-{chapter_id}"), chapter_id],
        )?;
        Ok(())
    }

    fn get_test_chapter_context_expired(
        conn: &Connection,
        chapter_id: &str,
    ) -> rusqlite::Result<(i64, i64)> {
        conn.query_row(
            "SELECT
                (SELECT is_expired FROM chapter_summaries WHERE chapter_id = ?1),
                (SELECT is_expired FROM context_records WHERE chapter_id = ?1)",
            params![chapter_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
    }

    #[test]
    fn db01_adopt_missing_draft_preserves_existing_adoption(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", Some("draft-a-old"), 3, "adopted")?;
        insert_test_draft(&conn, "draft-a-old", "chapter-a", "旧正文", true)?;

        let error = adopt_chapter_draft_internal(&mut conn, "missing-draft", "chapter-a")
            .expect_err("missing draft must be rejected");

        assert!(error.starts_with("target_not_found:"), "{error}");
        assert_eq!(get_test_draft_adopted(&conn, "draft-a-old")?, 1);
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-a")?.0.as_deref(),
            Some("draft-a-old")
        );
        Ok(())
    }

    #[test]
    fn db02_adopt_cross_chapter_draft_preserves_both_chapters(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", Some("draft-a"), 3, "adopted")?;
        insert_test_chapter(&conn, "chapter-b", Some("draft-b"), 3, "adopted")?;
        insert_test_draft(&conn, "draft-a", "chapter-a", "甲正文", true)?;
        insert_test_draft(&conn, "draft-b", "chapter-b", "乙正文", true)?;

        let error = adopt_chapter_draft_internal(&mut conn, "draft-b", "chapter-a")
            .expect_err("cross-chapter draft must be rejected");

        assert!(error.starts_with("target_mismatch:"), "{error}");
        assert_eq!(get_test_draft_adopted(&conn, "draft-a")?, 1);
        assert_eq!(get_test_draft_adopted(&conn, "draft-b")?, 1);
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-a")?.0.as_deref(),
            Some("draft-a")
        );
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-b")?.0.as_deref(),
            Some("draft-b")
        );
        Ok(())
    }

    #[test]
    fn adopt_rejects_corrupted_large_text_without_changing_chapter(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", None, 0, "editing")?;
        insert_test_draft(&conn, "draft-a", "chapter-a", "preview", false)?;
        attach_test_large_text(&conn, "document-a", "draft-a")?;

        let error = adopt_chapter_draft_internal(&mut conn, "draft-a", "chapter-a")
            .expect_err("corrupted large text must not be adopted");

        assert!(
            error.starts_with("adopt_large_text_read_failed:"),
            "{error}"
        );
        assert_eq!(get_test_draft_adopted(&conn, "draft-a")?, 0);
        let chapter = get_test_chapter_state(&conn, "chapter-a")?;
        assert!(chapter.0.is_none());
        assert_eq!(chapter.1, 0);
        assert_eq!(chapter.2, "editing");
        Ok(())
    }

    #[test]
    fn db03_update_zero_rows_returns_conflict_and_preserves_content(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", None, 0, "editing")?;
        insert_test_chapter(&conn, "chapter-b", None, 0, "editing")?;
        insert_test_draft(&conn, "draft-b", "chapter-b", "原正文", false)?;

        let error = update_chapter_draft_internal(
            &conn,
            "draft-b",
            "chapter-a",
            "错误覆盖",
            Some("user_edited"),
            None,
        )
        .expect_err("zero-row update must be rejected");

        assert!(error.starts_with("draft_update_conflict:"), "{error}");
        let missing_error = update_chapter_draft_internal(
            &conn,
            "missing-draft",
            "chapter-a",
            "错误覆盖",
            Some("user_edited"),
            None,
        )
        .expect_err("missing draft update must be rejected");
        assert!(
            missing_error.starts_with("draft_update_conflict:"),
            "{missing_error}"
        );
        let content: String = conn.query_row(
            "SELECT content FROM chapter_drafts WHERE id = 'draft-b'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(content, "原正文");
        Ok(())
    }

    #[test]
    fn updating_large_text_draft_to_small_text_removes_old_document(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", None, 0, "editing")?;
        insert_test_draft(&conn, "draft-a", "chapter-a", "preview", false)?;
        attach_test_large_text(&conn, "document-a", "draft-a")?;

        let updated = update_chapter_draft_with_cleanup_internal(
            &mut conn,
            "draft-a",
            "chapter-a",
            "small replacement",
            Some("user_edited"),
            None,
        )?;

        assert_eq!(updated.content, "small replacement");
        assert!(updated.large_text_ref_id.is_none());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM large_text_documents", [], |row| row
                .get::<_, i64>(
                0
            ))?,
            0
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM large_text_chunks", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        Ok(())
    }

    #[test]
    fn deleting_large_text_draft_removes_old_document() -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", None, 0, "editing")?;
        insert_test_draft(&conn, "draft-a", "chapter-a", "preview", false)?;
        attach_test_large_text(&conn, "document-a", "draft-a")?;

        delete_chapter_draft_internal(&mut conn, "draft-a", "chapter-a")?;

        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM chapter_drafts", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM large_text_documents", [], |row| row
                .get::<_, i64>(
                0
            ))?,
            0
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM large_text_chunks", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        Ok(())
    }

    #[test]
    fn update_rejects_cross_novel_and_soft_deleted_chapters(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter_for_novel(
            &conn,
            "chapter-cross-novel",
            "novel-2",
            None,
            0,
            "editing",
            None,
        )?;
        insert_test_draft(
            &conn,
            "draft-cross-novel",
            "chapter-cross-novel",
            "跨小说原文",
            false,
        )?;
        insert_test_chapter_for_novel(
            &conn,
            "chapter-deleted",
            "novel-1",
            None,
            0,
            "editing",
            Some("2026-07-11T00:00:00Z"),
        )?;
        insert_test_draft(
            &conn,
            "draft-deleted",
            "chapter-deleted",
            "已删除章节原文",
            false,
        )?;

        let cross_novel_error = update_chapter_draft_internal(
            &conn,
            "draft-cross-novel",
            "chapter-cross-novel",
            "不应写入",
            Some("user_edited"),
            None,
        )
        .expect_err("cross-novel draft/chapter pair must be rejected");
        assert!(
            cross_novel_error.starts_with("draft_update_conflict:"),
            "{cross_novel_error}"
        );

        let deleted_error = update_chapter_draft_internal(
            &conn,
            "draft-deleted",
            "chapter-deleted",
            "不应写入",
            Some("user_edited"),
            None,
        )
        .expect_err("soft-deleted chapter must be rejected");
        assert!(
            deleted_error.starts_with("draft_update_conflict:"),
            "{deleted_error}"
        );

        let cross_novel_content: String = conn.query_row(
            "SELECT content FROM chapter_drafts WHERE id = 'draft-cross-novel'",
            [],
            |row| row.get(0),
        )?;
        let deleted_content: String = conn.query_row(
            "SELECT content FROM chapter_drafts WHERE id = 'draft-deleted'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(cross_novel_content, "跨小说原文");
        assert_eq!(deleted_content, "已删除章节原文");
        Ok(())
    }

    #[test]
    fn adopt_rejects_cross_novel_target_without_changes() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter_for_novel(
            &conn,
            "chapter-cross-novel",
            "novel-2",
            Some("draft-old"),
            3,
            "adopted",
            None,
        )?;
        insert_test_draft(&conn, "draft-old", "chapter-cross-novel", "旧正文", true)?;
        insert_test_draft(&conn, "draft-new", "chapter-cross-novel", "新正文", false)?;

        let error = adopt_chapter_draft_internal(&mut conn, "draft-new", "chapter-cross-novel")
            .expect_err("cross-novel draft/chapter pair must be rejected");

        assert!(error.starts_with("target_mismatch:"), "{error}");
        assert_eq!(get_test_draft_adopted(&conn, "draft-old")?, 1);
        assert_eq!(get_test_draft_adopted(&conn, "draft-new")?, 0);
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-cross-novel")?
                .0
                .as_deref(),
            Some("draft-old")
        );
        Ok(())
    }

    #[test]
    fn adopt_rejects_soft_deleted_chapter_without_changes() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter_for_novel(
            &conn,
            "chapter-deleted",
            "novel-1",
            Some("draft-old"),
            3,
            "adopted",
            Some("2026-07-11T00:00:00Z"),
        )?;
        insert_test_draft(&conn, "draft-old", "chapter-deleted", "旧正文", true)?;
        insert_test_draft(&conn, "draft-new", "chapter-deleted", "新正文", false)?;

        let error = adopt_chapter_draft_internal(&mut conn, "draft-new", "chapter-deleted")
            .expect_err("soft-deleted chapter must be rejected");

        assert!(error.starts_with("target_deleted:"), "{error}");
        assert_eq!(get_test_draft_adopted(&conn, "draft-old")?, 1);
        assert_eq!(get_test_draft_adopted(&conn, "draft-new")?, 0);
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-deleted")?
                .0
                .as_deref(),
            Some("draft-old")
        );
        Ok(())
    }

    #[test]
    fn atomic_save_commit_before_adoption_keeps_one_authoritative_draft(
    ) -> Result<(), Box<dyn std::error::Error>> {
        use crate::repositories::large_text_repository;
        use crate::services::draft_service::{
            save_chapter_draft_atomic_with_cleanup, SaveChapterDraftAtomicInput,
            SaveChapterDraftDisposition,
        };

        let mut conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE novels (
                 id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL,
                 total_word_count INTEGER NOT NULL DEFAULT 0,
                 updated_at TEXT NOT NULL, deleted_at TEXT
             );
             CREATE TABLE chapters (
                 id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, title TEXT NOT NULL,
                 adopted_draft_id TEXT, word_count INTEGER NOT NULL DEFAULT 0,
                 status TEXT NOT NULL DEFAULT 'editing', created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL, deleted_at TEXT
             );
             CREATE TABLE ai_task_records (id TEXT PRIMARY KEY);
             CREATE TABLE chapter_drafts (
                 id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
                 title TEXT, content TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
                 version_no INTEGER NOT NULL, word_count INTEGER NOT NULL DEFAULT 0,
                 is_adopted INTEGER NOT NULL DEFAULT 0, ai_task_id TEXT, note TEXT,
                 large_text_ref_id TEXT, content_hash TEXT, created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE TABLE chapter_summaries (
                 id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL,
                 is_expired INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
             );
             CREATE TABLE context_records (
                 id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL,
                 is_expired INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
             );
             INSERT INTO novels (id, title, created_at, updated_at)
             VALUES ('novel-a', 'Novel A', 'now', 'now');
             INSERT INTO chapters
                 (id, novel_id, title, adopted_draft_id, word_count, status, created_at, updated_at)
             VALUES ('chapter-a', 'novel-a', 'Chapter A', NULL, 0, 'editing', 'now', 'now');",
        )?;
        crate::migrations::run_migrations(&mut conn)?;
        let base_content = "保存前正文";
        let base_hash = large_text_repository::sha256(base_content);
        conn.execute(
            "INSERT INTO chapter_drafts
                 (id, novel_id, chapter_id, title, content, source, version_no, word_count,
                  is_adopted, content_hash, created_at, updated_at)
             VALUES ('draft-a', 'novel-a', 'chapter-a', 'Draft', ?1, 'user_edited', 1,
                     5, 0, ?2, 'now', 'now')",
            params![base_content, base_hash],
        )?;
        let saved_content = "保存先提交、随后采用的正文".to_string();
        let saved_hash = large_text_repository::sha256(&saved_content);
        let save = save_chapter_draft_atomic_with_cleanup(
            &mut conn,
            SaveChapterDraftAtomicInput {
                operation_id: "op-save-before-adopt".to_string(),
                trace_id: Some("trace-save-before-adopt".to_string()),
                novel_id: "novel-a".to_string(),
                chapter_id: "chapter-a".to_string(),
                draft_id: Some("draft-a".to_string()),
                draft_version: Some(1),
                base_content_hash: Some(base_hash),
                current_content_hash: saved_hash,
                content: saved_content.clone(),
                word_count: None,
                source: "user_edited".to_string(),
                title: Some("Draft".to_string()),
                ai_task_id: None,
                note: None,
                staging_session_id: None,
            },
            || Ok(()),
        )?;

        assert_eq!(
            save.disposition,
            SaveChapterDraftDisposition::UpdatedExisting
        );
        assert_eq!(save.draft.id, "draft-a");
        assert!(!save.draft.is_adopted);
        let adopted = adopt_chapter_draft_internal(&mut conn, &save.draft.id, "chapter-a")?;

        assert_eq!(adopted.id, save.draft.id);
        assert_eq!(adopted.content, saved_content);
        assert!(adopted.is_adopted);
        let (draft_count, adopted_count): (i64, i64) = conn.query_row(
            "SELECT COUNT(*), SUM(CASE WHEN is_adopted = 1 THEN 1 ELSE 0 END)
             FROM chapter_drafts WHERE chapter_id = 'chapter-a'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!((draft_count, adopted_count), (1, 1));
        let chapter = get_test_chapter_state(&conn, "chapter-a")?;
        assert_eq!(chapter.0.as_deref(), Some("draft-a"));
        assert_eq!(chapter.1, count_words(&saved_content));
        assert_eq!(chapter.2, "adopted");
        let (operation_draft_id, operation_status): (String, String) = conn.query_row(
            "SELECT draft_id, status FROM draft_save_operations
             WHERE operation_id = 'op-save-before-adopt'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(operation_draft_id, "draft-a");
        assert_eq!(operation_status, "completed");
        Ok(())
    }

    #[test]
    fn adopt_chapter_draft_updates_pointer_and_chapter_metadata(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", Some("draft-old"), 3, "editing")?;
        insert_test_draft(&conn, "draft-old", "chapter-a", "旧正文", true)?;
        insert_test_draft(&conn, "draft-new", "chapter-a", "新的正式正文", false)?;

        let adopted = adopt_chapter_draft_internal(&mut conn, "draft-new", "chapter-a")?;

        assert_eq!(adopted.id, "draft-new");
        assert_eq!(adopted.chapter_id, "chapter-a");
        assert!(adopted.is_adopted);
        assert_eq!(get_test_draft_adopted(&conn, "draft-old")?, 0);
        assert_eq!(get_test_draft_adopted(&conn, "draft-new")?, 1);
        let adopted_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM chapter_drafts WHERE chapter_id = 'chapter-a' AND is_adopted = 1",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(adopted_count, 1);
        let chapter = get_test_chapter_state(&conn, "chapter-a")?;
        assert_eq!(chapter.0.as_deref(), Some("draft-new"));
        assert_eq!(chapter.1, count_words("新的正式正文"));
        assert_eq!(chapter.2, "adopted");
        assert_ne!(chapter.3, "before");
        Ok(())
    }

    #[test]
    fn adopting_different_draft_expires_summary_and_context_atomically(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", Some("draft-old"), 3, "adopted")?;
        insert_test_draft(&conn, "draft-old", "chapter-a", "old body", true)?;
        insert_test_draft(&conn, "draft-new", "chapter-a", "new body", false)?;
        insert_test_chapter_context(&conn, "chapter-a")?;

        adopt_chapter_draft_internal(&mut conn, "draft-new", "chapter-a")?;

        assert_eq!(get_test_draft_adopted(&conn, "draft-old")?, 0);
        assert_eq!(get_test_draft_adopted(&conn, "draft-new")?, 1);
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-a")?.0.as_deref(),
            Some("draft-new")
        );
        assert_eq!(
            get_test_chapter_context_expired(&conn, "chapter-a")?,
            (1, 1)
        );
        Ok(())
    }

    #[test]
    fn adopting_different_draft_invalidates_old_memory_atomically(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", Some("draft-old"), 3, "adopted")?;
        insert_test_draft(&conn, "draft-old", "chapter-a", "old body", true)?;
        insert_test_draft(&conn, "draft-new", "chapter-a", "new body", false)?;
        conn.execute(
            "INSERT INTO memory_documents
                (id, novel_id, chapter_id, adopted_draft_id, status, updated_at)
             VALUES ('memory-old', 'novel-1', 'chapter-a', 'draft-old', 'active', 'before')",
            [],
        )?;

        adopt_chapter_draft_internal(&mut conn, "draft-new", "chapter-a")?;

        let memory: (String, Option<String>) = conn.query_row(
            "SELECT status, invalidation_reason FROM memory_documents WHERE id = 'memory-old'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(memory.0, "invalidated");
        assert_eq!(memory.1.as_deref(), Some("adopted_draft_changed"));
        Ok(())
    }

    #[test]
    fn memory_invalidation_failure_rolls_back_adoption() -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", Some("draft-old"), 3, "adopted")?;
        insert_test_draft(&conn, "draft-old", "chapter-a", "old body", true)?;
        insert_test_draft(&conn, "draft-new", "chapter-a", "new body", false)?;
        conn.execute(
            "INSERT INTO memory_documents
                (id, novel_id, chapter_id, adopted_draft_id, status, updated_at)
             VALUES ('memory-old', 'novel-1', 'chapter-a', 'draft-old', 'active', 'before')",
            [],
        )?;
        conn.execute_batch(
            "CREATE TRIGGER fail_memory_invalidation
             BEFORE UPDATE OF status ON memory_documents
             BEGIN SELECT RAISE(ABORT, 'forced memory failure'); END;",
        )?;

        let error = adopt_chapter_draft_internal(&mut conn, "draft-new", "chapter-a")
            .expect_err("memory invalidation failure must roll back adoption");

        assert!(
            error.starts_with("adopt_memory_invalidation_failed:"),
            "{error}"
        );
        assert_eq!(get_test_draft_adopted(&conn, "draft-old")?, 1);
        assert_eq!(get_test_draft_adopted(&conn, "draft-new")?, 0);
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-a")?.0.as_deref(),
            Some("draft-old")
        );
        let status: String = conn.query_row(
            "SELECT status FROM memory_documents WHERE id = 'memory-old'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(status, "active");
        Ok(())
    }

    #[test]
    fn readopting_same_draft_keeps_summary_and_context_valid(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", Some("draft-current"), 3, "adopted")?;
        insert_test_draft(&conn, "draft-current", "chapter-a", "same body", true)?;
        insert_test_chapter_context(&conn, "chapter-a")?;
        conn.execute_batch(
            "CREATE TRIGGER reject_unexpected_context_expiration
             BEFORE UPDATE OF is_expired ON context_records
             BEGIN SELECT RAISE(ABORT, 'same draft must not expire context'); END;",
        )?;

        adopt_chapter_draft_internal(&mut conn, "draft-current", "chapter-a")?;

        assert_eq!(get_test_draft_adopted(&conn, "draft-current")?, 1);
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-a")?.0.as_deref(),
            Some("draft-current")
        );
        assert_eq!(
            get_test_chapter_context_expired(&conn, "chapter-a")?,
            (0, 0)
        );
        Ok(())
    }

    #[test]
    fn adoption_and_context_expiration_roll_back_together_on_failure(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(&conn, "chapter-a", Some("draft-old"), 3, "adopted")?;
        insert_test_draft(&conn, "draft-old", "chapter-a", "old body", true)?;
        insert_test_draft(&conn, "draft-new", "chapter-a", "new body", false)?;
        insert_test_chapter_context(&conn, "chapter-a")?;
        conn.execute_batch(
            "CREATE TRIGGER fail_context_expiration_during_adoption
             BEFORE UPDATE OF is_expired ON context_records WHEN NEW.is_expired = 1
             BEGIN SELECT RAISE(ABORT, 'forced context expiration failure'); END;",
        )?;

        let error = adopt_chapter_draft_internal(&mut conn, "draft-new", "chapter-a")
            .expect_err("context expiration failure must roll back adoption");

        assert!(
            error.starts_with("chapter_context_records_expire_failed:"),
            "{error}"
        );
        assert_eq!(get_test_draft_adopted(&conn, "draft-old")?, 1);
        assert_eq!(get_test_draft_adopted(&conn, "draft-new")?, 0);
        let chapter = get_test_chapter_state(&conn, "chapter-a")?;
        assert_eq!(chapter.0.as_deref(), Some("draft-old"));
        assert_eq!(chapter.1, 3);
        assert_eq!(chapter.2, "adopted");
        assert_eq!(chapter.3, "before");
        assert_eq!(
            get_test_chapter_context_expired(&conn, "chapter-a")?,
            (0, 0)
        );
        Ok(())
    }

    #[test]
    fn adopt_chapter_draft_rolls_back_when_chapter_update_fails(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_chapter_draft_test_schema(&conn)?;
        insert_test_chapter(
            &conn,
            "chapter-a",
            Some("draft-old"),
            count_words("旧正文"),
            "adopted",
        )?;
        insert_test_draft(&conn, "draft-old", "chapter-a", "旧正文", true)?;
        insert_test_draft(&conn, "draft-new", "chapter-a", "新正文", false)?;
        conn.execute_batch(
            "
            CREATE TRIGGER fail_chapter_adoption
            BEFORE UPDATE OF adopted_draft_id ON chapters
            BEGIN
                SELECT RAISE(ABORT, 'forced chapter update failure');
            END;
            ",
        )?;

        let error = adopt_chapter_draft_internal(&mut conn, "draft-new", "chapter-a")
            .expect_err("chapter update failure must roll back the draft updates");

        assert!(error.starts_with("adopt_chapter_update_failed:"), "{error}");
        assert_eq!(get_test_draft_adopted(&conn, "draft-old")?, 1);
        assert_eq!(get_test_draft_adopted(&conn, "draft-new")?, 0);
        assert_eq!(
            get_test_chapter_state(&conn, "chapter-a")?.0.as_deref(),
            Some("draft-old")
        );
        Ok(())
    }

    fn insert_runtime_ai_task(conn: &Connection, id: &str) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO ai_task_records (id, task_type, status, created_at) VALUES (?1, 'connection_test', 'succeeded', ?2)",
            params![id, chrono::Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    fn insert_runtime_ai_task_children(
        conn: &Connection,
        task_id: &str,
        row_prefix: &str,
    ) -> rusqlite::Result<()> {
        for table in RUNTIME_AI_TASK_CHILD_TABLES {
            let sql = format!("INSERT INTO {} (id, ai_task_id) VALUES (?1, ?2)", table);
            let row_id = format!("{}-{}", row_prefix, table);
            conn.execute(&sql, params![row_id, task_id])?;
        }
        Ok(())
    }

    fn count_runtime_ai_task_child_refs(conn: &Connection, task_id: &str) -> rusqlite::Result<i64> {
        let mut count = 0;
        for table in RUNTIME_AI_TASK_CHILD_TABLES {
            let sql = format!("SELECT COUNT(*) FROM {} WHERE ai_task_id = ?1", table);
            count += conn.query_row(&sql, params![task_id], |row| row.get::<_, i64>(0))?;
        }
        Ok(count)
    }

    fn count_runtime_ai_task_child_rows(conn: &Connection) -> rusqlite::Result<i64> {
        let mut count = 0;
        for table in RUNTIME_AI_TASK_CHILD_TABLES {
            let sql = format!("SELECT COUNT(*) FROM {}", table);
            count += conn.query_row(&sql, [], |row| row.get::<_, i64>(0))?;
        }
        Ok(count)
    }

    fn assert_runtime_child_cleanup(
        result: &DeleteAiTaskRecordsResult,
        expected_rows_per_table: i64,
    ) {
        for table in RUNTIME_AI_TASK_CHILD_TABLES {
            assert_eq!(
                result.deleted_child_rows.get(table),
                Some(&expected_rows_per_table),
                "child cleanup count must be reported for {}",
                table
            );
        }
    }

    fn create_task_recovery_test_schema(conn: &Connection) -> rusqlite::Result<()> {
        conn.execute_batch(
            "
            CREATE TABLE generation_jobs (
                id TEXT PRIMARY KEY,
                world_id TEXT,
                novel_id TEXT NOT NULL DEFAULT 'novel-1',
                volume_id TEXT,
                chapter_id TEXT NOT NULL DEFAULT 'chapter-1',
                job_type TEXT NOT NULL DEFAULT 'chapter_generation',
                status TEXT NOT NULL,
                current_step TEXT,
                progress_percent INTEGER NOT NULL DEFAULT 0,
                provider TEXT,
                model_name TEXT,
                input_token_estimate INTEGER,
                output_token_estimate INTEGER,
                actual_input_tokens INTEGER,
                actual_output_tokens INTEGER,
                cost_estimate REAL,
                error_code TEXT,
                error_message TEXT,
                retry_count INTEGER NOT NULL DEFAULT 0,
                finished_at TEXT,
                created_at TEXT NOT NULL,
                started_at TEXT
            );

            CREATE TABLE generation_step_results (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                step_name TEXT NOT NULL,
                status TEXT NOT NULL,
                input_snapshot_json TEXT,
                output_json TEXT,
                output_text TEXT,
                error_message TEXT,
                created_at TEXT NOT NULL
            );

            ",
        )
    }

    fn generation_job_update_input(id: &str) -> UpdateGenerationJobInput {
        UpdateGenerationJobInput {
            id: id.to_string(),
            status: None,
            current_step: None,
            progress_percent: None,
            provider: None,
            model_name: None,
            input_token_estimate: None,
            output_token_estimate: None,
            actual_input_tokens: None,
            actual_output_tokens: None,
            cost_estimate: None,
            error_code: None,
            error_message: None,
            retry_count: None,
            started_at: None,
            finished_at: None,
        }
    }

    #[test]
    fn generation_job_updates_reject_terminal_revival_and_progress_regression(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        create_task_recovery_test_schema(&conn)?;
        conn.execute_batch(
            "
            INSERT INTO generation_jobs (id, status, current_step, progress_percent, created_at) VALUES
                ('job-running', 'running', 'draft_generation', 40, '2026-01-01T00:00:00Z'),
                ('job-pending', 'pending', NULL, 0, '2026-01-01T00:00:01Z'),
                ('job-cancelled', 'cancelled', 'quality_check', 82, '2026-01-01T00:00:02Z'),
                ('job-retrying', 'retrying', 'draft_generation', 72, '2026-01-01T00:00:03Z');
            ",
        )?;

        let mut running = generation_job_update_input("job-running");
        running.status = Some("running".to_string());
        running.current_step = Some("quality_check".to_string());
        running.progress_percent = Some(82);
        let updated = update_generation_job_internal(&conn, &running)?;
        assert_eq!(updated.status, "running");
        assert_eq!(updated.progress_percent, 82);

        let mut regression = generation_job_update_input("job-running");
        regression.progress_percent = Some(72);
        let regression_error = update_generation_job_internal(&conn, &regression)
            .expect_err("progress must never move backwards");
        assert!(regression_error.starts_with("generation_job_progress_regression:"));

        let mut complete = generation_job_update_input("job-running");
        complete.status = Some("completed".to_string());
        complete.progress_percent = Some(100);
        complete.finished_at = Some("2026-01-01T00:01:00Z".to_string());
        let completed = update_generation_job_internal(&conn, &complete)?;
        assert_eq!(completed.status, "completed");

        let mut revive = generation_job_update_input("job-running");
        revive.status = Some("running".to_string());
        let terminal_error = update_generation_job_internal(&conn, &revive)
            .expect_err("completed task must be immutable");
        assert!(terminal_error.starts_with("generation_job_terminal:"));

        let mut cancelled_to_completed = generation_job_update_input("job-cancelled");
        cancelled_to_completed.status = Some("completed".to_string());
        assert!(
            update_generation_job_internal(&conn, &cancelled_to_completed)
                .expect_err("cancelled task must win over a late completion")
                .starts_with("generation_job_terminal:")
        );

        let mut skip_running = generation_job_update_input("job-pending");
        skip_running.status = Some("completed".to_string());
        assert!(update_generation_job_internal(&conn, &skip_running)
            .expect_err("pending task cannot jump straight to completed")
            .starts_with("generation_job_invalid_transition:"));

        let mut retry = generation_job_update_input("job-retrying");
        retry.status = Some("running".to_string());
        retry.progress_percent = Some(72);
        assert_eq!(
            update_generation_job_internal(&conn, &retry)?.status,
            "running"
        );
        Ok(())
    }

    #[test]
    fn generation_step_ids_are_immutable_and_ordering_is_deterministic(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_task_recovery_test_schema(&conn)?;
        conn.execute(
            "INSERT INTO generation_jobs (id, status, current_step, progress_percent, created_at) VALUES ('job-1', 'running', 'draft_generation', 72, '2026-01-01T00:00:00Z')",
            [],
        )?;
        let first = SaveGenerationStepResultInput {
            id: "step-a".to_string(),
            job_id: "job-1".to_string(),
            step_name: "draft_generation".to_string(),
            status: "succeeded".to_string(),
            input_snapshot_json: None,
            output_json: None,
            output_text: Some("first".to_string()),
            error_message: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
        };
        save_generation_step_result_internal(&mut conn, &first)?;

        let mut duplicate = SaveGenerationStepResultInput {
            output_text: Some("overwritten".to_string()),
            ..first
        };
        let duplicate_error = save_generation_step_result_internal(&mut conn, &duplicate)
            .expect_err("a step id must not overwrite an existing checkpoint");
        assert!(duplicate_error.contains("UNIQUE constraint failed"));
        duplicate.id = "step-b".to_string();
        save_generation_step_result_internal(&mut conn, &duplicate)?;

        let steps = get_generation_step_results_internal(&conn, "job-1")?;
        assert_eq!(
            steps
                .iter()
                .map(|step| step.id.as_str())
                .collect::<Vec<_>>(),
            vec!["step-a", "step-b"]
        );
        assert_eq!(steps[0].output_text.as_deref(), Some("first"));
        Ok(())
    }

    #[test]
    fn generation_job_cancellation_is_atomic_and_rejects_late_success_steps(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_task_recovery_test_schema(&conn)?;
        conn.execute(
            "INSERT INTO generation_jobs (id, status, current_step, progress_percent, created_at) VALUES ('job-cancel-race', 'running', 'draft_generation', 72, '2026-01-01T00:00:00Z')",
            [],
        )?;

        let cancelled =
            cancel_generation_job_internal(&mut conn, "job-cancel-race", "2026-01-01T00:01:00Z")?
                .expect("running job should be cancelled");
        assert_eq!(cancelled.status, "cancelled");
        let cancelled_steps = get_generation_step_results_internal(&conn, "job-cancel-race")?;
        assert_eq!(cancelled_steps.len(), 1);
        assert_eq!(cancelled_steps[0].status, "cancelled");
        assert_eq!(cancelled_steps[0].step_name, "draft_generation");

        cancel_generation_job_internal(&mut conn, "job-cancel-race", "2026-01-01T00:02:00Z")?;
        assert_eq!(
            get_generation_step_results_internal(&conn, "job-cancel-race")?.len(),
            1,
            "repeated cancellation must not add another checkpoint"
        );

        let late_success = SaveGenerationStepResultInput {
            id: "step-late-success".to_string(),
            job_id: "job-cancel-race".to_string(),
            step_name: "draft_generation".to_string(),
            status: "succeeded".to_string(),
            input_snapshot_json: None,
            output_json: Some(r#"{"late":true}"#.to_string()),
            output_text: Some("late output".to_string()),
            error_message: None,
            created_at: "2026-01-01T00:03:00Z".to_string(),
        };
        let error = save_generation_step_result_internal(&mut conn, &late_success)
            .expect_err("terminal parent must reject a late success checkpoint");
        assert!(error.starts_with("generation_step_parent_terminal:"));
        assert_eq!(
            get_generation_step_results_internal(&conn, "job-cancel-race")?.len(),
            1
        );
        Ok(())
    }

    #[test]
    fn startup_task_recovery_is_atomic_and_idempotent() -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_task_recovery_test_schema(&conn)?;
        conn.execute_batch(
            "
            INSERT INTO generation_jobs (id, status, current_step, progress_percent, created_at) VALUES
                ('job-pending', 'pending', NULL, 0, '2026-01-01T00:00:00Z'),
                ('job-running', 'running', 'draft_generation', 72, '2026-01-01T00:00:01Z'),
                ('job-retrying', 'retrying', 'quality_check', 82, '2026-01-01T00:00:02Z'),
                ('job-completed', 'completed', 'save_version', 100, '2026-01-01T00:00:03Z');
            INSERT INTO generation_step_results (id, job_id, step_name, status, output_text, created_at)
                VALUES ('step-existing', 'job-running', 'compile_context', 'succeeded', 'checkpoint', '2026-01-01T00:00:04Z');
            ",
        )?;

        let recovered_at = "2026-07-21T08:00:00Z";
        let result = recover_interrupted_generation_jobs_internal(&mut conn, recovered_at)?;
        assert_eq!(result.recovered_jobs, 3);
        assert_eq!(result.recovered_at, recovered_at);

        for job_id in ["job-pending", "job-running", "job-retrying"] {
            let state: (String, Option<String>, Option<String>, Option<String>) = conn.query_row(
                "SELECT status, error_code, error_message, finished_at FROM generation_jobs WHERE id = ?1",
                params![job_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )?;
            assert_eq!(state.0, "failed");
            assert_eq!(state.1.as_deref(), Some(STARTUP_RECOVERY_ERROR_CODE));
            assert_eq!(state.2.as_deref(), Some(STARTUP_RECOVERY_MESSAGE));
            assert_eq!(state.3.as_deref(), Some(recovered_at));
        }
        let completed: (String, Option<String>) = conn.query_row(
            "SELECT status, error_code FROM generation_jobs WHERE id = 'job-completed'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(completed, ("completed".to_string(), None));
        let preserved_progress: i64 = conn.query_row(
            "SELECT progress_percent FROM generation_jobs WHERE id = 'job-running'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(preserved_progress, 72);

        let recovery_steps: i64 = conn.query_row(
            "SELECT COUNT(*) FROM generation_step_results WHERE status = 'failed'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(recovery_steps, 3);
        let all_steps: i64 =
            conn.query_row("SELECT COUNT(*) FROM generation_step_results", [], |row| {
                row.get(0)
            })?;
        assert_eq!(all_steps, 4);
        let recovery_json: String = conn.query_row(
            "SELECT output_json FROM generation_step_results WHERE job_id = 'job-running' AND status = 'failed'",
            [],
            |row| row.get(0),
        )?;
        let recovery_json: serde_json::Value = serde_json::from_str(&recovery_json)?;
        assert_eq!(recovery_json["previousStatus"], "running");
        assert_eq!(recovery_json["preservedProgressPercent"], 72);

        let second = recover_interrupted_generation_jobs_internal(&mut conn, recovered_at)?;
        assert_eq!(second.recovered_jobs, 0);
        let steps_after_second_start: i64 =
            conn.query_row("SELECT COUNT(*) FROM generation_step_results", [], |row| {
                row.get(0)
            })?;
        assert_eq!(steps_after_second_start, 4);
        Ok(())
    }

    #[test]
    fn startup_task_recovery_rolls_back_when_checkpoint_insert_fails(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        create_task_recovery_test_schema(&conn)?;
        conn.execute_batch(
            "
            INSERT INTO generation_jobs (id, status, current_step, progress_percent, created_at)
                VALUES ('job-running', 'running', 'draft_generation', 72, '2026-01-01T00:00:00Z');
            CREATE TRIGGER fail_recovery_checkpoint
            BEFORE INSERT ON generation_step_results
            BEGIN
                SELECT RAISE(ABORT, 'forced recovery checkpoint failure');
            END;
            ",
        )?;

        let error = recover_interrupted_generation_jobs_internal(&mut conn, "2026-07-21T08:00:00Z")
            .expect_err("checkpoint failure must roll back every task transition");
        assert!(
            error.starts_with("task_recovery_checkpoint_insert_failed:"),
            "{error}"
        );
        let job_status: String = conn.query_row(
            "SELECT status FROM generation_jobs WHERE id = 'job-running'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(job_status, "running");
        Ok(())
    }

    #[test]
    fn ai_task_delete_runtime_insert_list_delete_clear() -> Result<(), Box<dyn std::error::Error>> {
        let db_path = std::env::temp_dir().join(format!(
            "ai-novel-studio-ai-task-delete-runtime-{}.db",
            uuid::Uuid::new_v4()
        ));
        let db_path_text = db_path.display().to_string();
        let conn = Connection::open(&db_path)?;
        create_runtime_ai_task_table(&conn)?;
        assert!(ai_task_records_table_exists(&conn).expect("table exists check should work"));

        let first_id = format!("runtime-delete-{}", uuid::Uuid::new_v4());
        let second_id = format!("runtime-clear-{}", uuid::Uuid::new_v4());
        insert_runtime_ai_task(&conn, &first_id)?;
        insert_runtime_ai_task(&conn, &second_id)?;
        insert_runtime_ai_task_children(&conn, &first_id, "delete-child")?;
        insert_runtime_ai_task_children(&conn, &second_id, "clear-child")?;

        let before_count = count_ai_task_records_in_conn(&conn)?;
        assert_eq!(before_count, 2);
        assert_eq!(count_runtime_ai_task_child_refs(&conn, &first_id)?, 5);
        assert_eq!(count_runtime_ai_task_child_refs(&conn, &second_id)?, 5);
        assert_eq!(count_runtime_ai_task_child_rows(&conn)?, 10);

        let delete_result = delete_ai_task_records_by_ids_internal(
            &conn,
            vec![first_id.clone()],
            db_path_text.clone(),
        )?;
        assert_eq!(delete_result.requested_count, 1);
        assert_eq!(delete_result.before_count, 2);
        assert_eq!(delete_result.before_match_count, 1);
        assert_eq!(delete_result.deleted_count, 1);
        assert_eq!(delete_result.after_match_count, 0);
        assert_eq!(delete_result.after_count, 1);
        assert_eq!(delete_result.affected_rows, 1);
        assert_runtime_child_cleanup(&delete_result, 1);

        assert_eq!(count_ai_task_records_by_ids(&conn, &[first_id.clone()])?, 0);
        assert_eq!(
            count_ai_task_records_by_ids(&conn, &[second_id.clone()])?,
            1
        );
        assert_eq!(count_runtime_ai_task_child_refs(&conn, &first_id)?, 0);
        assert_eq!(count_runtime_ai_task_child_refs(&conn, &second_id)?, 5);
        assert_eq!(count_runtime_ai_task_child_rows(&conn)?, 10);

        let clear_result = clear_ai_task_records_internal(&conn, db_path_text.clone())?;
        assert_eq!(clear_result.before_count, 1);
        assert_eq!(clear_result.deleted_count, 1);
        assert_eq!(clear_result.after_count, 0);
        assert_eq!(clear_result.affected_rows, 1);
        assert_runtime_child_cleanup(&clear_result, 1);
        assert_eq!(count_ai_task_records_in_conn(&conn)?, 0);
        assert_eq!(count_runtime_ai_task_child_refs(&conn, &second_id)?, 0);
        assert_eq!(count_runtime_ai_task_child_rows(&conn)?, 10);

        drop(conn);
        let _ = fs::remove_file(db_path);
        Ok(())
    }

    #[test]
    fn ai_task_delete_rejects_running_records_without_clearing_provenance(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        create_runtime_ai_task_table(&conn)?;
        insert_runtime_ai_task(&conn, "terminal-task")?;
        conn.execute(
            "INSERT INTO ai_task_records (id, task_type, status, created_at)
             VALUES ('running-task', 'chapter_generate', 'running', '2026-07-29T00:00:00Z')",
            [],
        )?;
        insert_runtime_ai_task_children(&conn, "running-task", "running-child")?;

        for result in [
            delete_ai_task_records_by_ids_internal(
                &conn,
                vec!["running-task".to_string()],
                "memory".to_string(),
            ),
            delete_ai_task_records_by_ids_internal(
                &conn,
                vec!["terminal-task".to_string(), "running-task".to_string()],
                "memory".to_string(),
            ),
            clear_ai_task_records_internal(&conn, "memory".to_string()),
        ] {
            assert_eq!(
                result.expect_err("running AI task must be protected"),
                "ai_task_running_delete_protected"
            );
        }
        assert_eq!(count_ai_task_records_in_conn(&conn)?, 2);
        assert_eq!(count_runtime_ai_task_child_refs(&conn, "running-task")?, 5);
        Ok(())
    }

    #[test]
    fn ai_task_delete_rejects_completed_quality_report_references(
    ) -> Result<(), Box<dyn std::error::Error>> {
        for action in ["single", "batch", "clear"] {
            let conn = Connection::open_in_memory()?;
            create_runtime_ai_task_table(&conn)?;
            for task_id in [
                "quality-task-protected",
                "quality-task-free-a",
                "quality-task-free-b",
            ] {
                insert_runtime_ai_task(&conn, task_id)?;
            }
            conn.execute(
                "INSERT INTO quality_check_reports (id, ai_task_id, status)
                 VALUES ('quality-report-completed', 'quality-task-protected', 'completed')",
                [],
            )?;

            let result = match action {
                "single" => delete_ai_task_records_by_ids_internal(
                    &conn,
                    vec!["quality-task-protected".to_string()],
                    "memory".to_string(),
                ),
                "batch" => delete_ai_task_records_by_ids_internal(
                    &conn,
                    vec![
                        "quality-task-free-a".to_string(),
                        "quality-task-protected".to_string(),
                    ],
                    "memory".to_string(),
                ),
                "clear" => clear_ai_task_records_internal(&conn, "memory".to_string()),
                _ => unreachable!(),
            };

            assert_eq!(
                result.expect_err("completed quality report task must be protected"),
                "quality_check_ai_task_delete_protected"
            );
            assert_eq!(count_ai_task_records_in_conn(&conn)?, 3);
            assert_eq!(
                conn.query_row(
                    "SELECT COUNT(*) FROM quality_check_reports
                     WHERE id = 'quality-report-completed'
                       AND ai_task_id = 'quality-task-protected'",
                    [],
                    |row| row.get::<_, i64>(0),
                )?,
                1
            );
        }
        Ok(())
    }

    fn create_quality_history_test_database() -> Result<Connection, Box<dyn std::error::Error>> {
        let mut conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        crate::db::create_tables(&mut conn)?;
        conn.execute_batch(
            "
            INSERT INTO novels
                (id, title, created_at, updated_at)
                VALUES ('novel-quality', 'Quality History', '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z');
            INSERT INTO volumes
                (id, novel_id, title, created_at, updated_at)
                VALUES ('volume-quality', 'novel-quality', 'Volume', '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z');
            INSERT INTO chapters
                (id, novel_id, volume_id, title, created_at, updated_at)
                VALUES ('chapter-quality', 'novel-quality', 'volume-quality', 'Chapter', '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z');
            INSERT INTO chapter_drafts
                (id, novel_id, chapter_id, content, created_at, updated_at)
                VALUES ('draft-quality', 'novel-quality', 'chapter-quality', 'Draft', '2026-07-22T00:00:00Z', '2026-07-22T00:00:00Z');
            INSERT INTO ai_task_records
                (id, novel_id, chapter_id, task_type, status, created_at)
                VALUES ('quality-task-default', 'novel-quality', 'chapter-quality', 'quality_check', 'succeeded', '2026-07-22T00:00:00Z');
            ",
        )?;
        Ok(conn)
    }

    fn insert_quality_report(
        conn: &Connection,
        report_id: &str,
        status: &str,
        created_at: &str,
    ) -> rusqlite::Result<()> {
        conn.execute(
            "INSERT INTO quality_check_reports
                (id, novel_id, chapter_id, draft_id, status, created_at, updated_at)
             VALUES (?1, 'novel-quality', 'chapter-quality', 'draft-quality', ?2, ?3, ?3)",
            params![report_id, status, created_at],
        )?;
        Ok(())
    }

    fn quality_result_input(
        report_id: &str,
        summary: &str,
        items: &[(&str, &str)],
    ) -> SaveQualityCheckResultInput {
        SaveQualityCheckResultInput {
            report_id: report_id.to_string(),
            novel_id: "novel-quality".to_string(),
            chapter_id: "chapter-quality".to_string(),
            draft_id: "draft-quality".to_string(),
            result: QualityCheckResultDto {
                overall_score: Some(88),
                summary: Some(summary.to_string()),
                items: items
                    .iter()
                    .map(|(issue_key, title)| QualityCheckResultItemDto {
                        issue_type: Some("continuity".to_string()),
                        severity: Some("high".to_string()),
                        category: Some("logic".to_string()),
                        title: Some((*title).to_string()),
                        description: Some(format!("description-{title}")),
                        evidence: Some(format!("evidence-{title}")),
                        suggestion: Some(format!("suggestion-{title}")),
                        quote: Some(format!("quote-{title}")),
                        start_offset: Some(1),
                        end_offset: Some(2),
                        paragraph_index: Some(0),
                        issue_key: Some((*issue_key).to_string()),
                    })
                    .collect(),
            },
            draft_version: Some(1),
            model: Some("test-model".to_string()),
            content_hash: Some("test-hash".to_string()),
            content_length: Some(5),
            checked_at: Some("2026-07-22T00:00:00Z".to_string()),
            ai_task_id: "quality-task-default".to_string(),
        }
    }

    #[test]
    fn quality_reports_keep_immutable_items_and_replay_raw_order(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        insert_quality_report(&conn, "report-old", "pending", "2026-07-22T00:00:01Z")?;
        let first = quality_result_input(
            "report-old",
            "first summary",
            &[("issue-repeat", "old evidence"), ("issue-old", "old only")],
        );
        save_quality_check_result_internal(&mut conn, &first)?;
        let original = get_quality_check_report_snapshot_internal(&conn, "report-old")?;
        assert_eq!(original.items.len(), 2);
        assert_eq!(original.items[0].sort_order, 0);
        assert_eq!(original.items[1].sort_order, 1);
        let original_ids = original
            .items
            .iter()
            .map(|item| item.id.clone())
            .collect::<Vec<_>>();

        update_quality_issue_status_internal(
            &mut conn,
            &original.items[0].id,
            "ignored",
            Some("intentional"),
        )?;
        let raw_after_state_change =
            get_quality_check_report_snapshot_internal(&conn, "report-old")?;
        assert_eq!(raw_after_state_change.items[0].status, "pending");
        assert_eq!(raw_after_state_change.items[0].resolution_note, None);

        insert_quality_report(&conn, "report-new", "pending", "2026-07-22T00:00:02Z")?;
        let second = quality_result_input(
            "report-new",
            "second summary",
            &[("issue-repeat", "new evidence"), ("issue-new", "new only")],
        );
        let newest = save_quality_check_result_internal(&mut conn, &second)?;
        assert_eq!(newest.items[0].status, "ignored");
        assert_eq!(newest.items[0].title, "new evidence");
        let old_idempotent_retry = save_quality_check_result_internal(&mut conn, &first)?;
        assert_eq!(old_idempotent_retry.items[0].status, "pending");
        assert_eq!(old_idempotent_retry.items[0].title, "old evidence");
        assert_eq!(
            update_quality_issue_status_internal(
                &mut conn,
                &original.items[0].id,
                "resolved",
                None,
            )
            .unwrap_err(),
            "quality_issue_history_read_only"
        );

        let replay = get_quality_check_report_snapshot_internal(&conn, "report-old")?;
        assert_eq!(
            replay
                .items
                .iter()
                .map(|item| item.id.clone())
                .collect::<Vec<_>>(),
            original_ids
        );
        assert!(replay
            .items
            .iter()
            .all(|item| item.report_id == "report-old"));
        assert_eq!(replay.items[0].title, "old evidence");
        assert_eq!(replay.items[1].title, "old only");
        assert!(newest
            .items
            .iter()
            .all(|item| !original_ids.contains(&item.id)));
        Ok(())
    }

    #[test]
    fn quality_result_save_rolls_back_report_items_and_states_on_nth_item_failure(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        insert_quality_report(&conn, "report-rollback", "pending", "2026-07-22T00:00:01Z")?;
        conn.execute_batch(
            "CREATE TRIGGER fail_second_quality_item
             BEFORE INSERT ON quality_check_items
             WHEN NEW.sort_order = 1
             BEGIN
                 SELECT RAISE(ABORT, 'forced second item failure');
             END;",
        )?;
        let input = quality_result_input(
            "report-rollback",
            "must rollback",
            &[("issue-one", "one"), ("issue-two", "two")],
        );
        let error = save_quality_check_result_internal(&mut conn, &input)
            .expect_err("the injected second item failure must abort the save");
        assert!(error.starts_with("quality_snapshot_item_insert_failed:"));
        let report_status: String = conn.query_row(
            "SELECT status FROM quality_check_reports WHERE id = 'report-rollback'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(report_status, "pending");
        let item_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM quality_check_items WHERE report_id = 'report-rollback'",
            [],
            |row| row.get(0),
        )?;
        let state_count: i64 =
            conn.query_row("SELECT COUNT(*) FROM quality_issue_states", [], |row| {
                row.get(0)
            })?;
        assert_eq!(item_count, 0);
        assert_eq!(state_count, 0);
        Ok(())
    }

    #[test]
    fn latest_quality_workflow_ignores_newer_incomplete_reports(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        insert_quality_report(&conn, "report-completed", "pending", "2026-07-22T00:00:01Z")?;
        let completed = quality_result_input(
            "report-completed",
            "completed",
            &[("issue-completed", "completed issue")],
        );
        save_quality_check_result_internal(&mut conn, &completed)?;
        insert_quality_report(&conn, "report-pending", "pending", "2026-07-22T00:00:02Z")?;
        insert_quality_report(&conn, "report-failed", "failed", "2026-07-22T00:00:03Z")?;

        let latest = get_quality_check_issues_internal(&conn, "chapter-quality")?;
        assert_eq!(
            latest.report.as_ref().map(|report| report.id.as_str()),
            Some("report-completed")
        );
        assert_eq!(latest.items.len(), 1);
        let history = list_quality_check_reports_internal(&conn, "chapter-quality")?;
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, "report-completed");
        Ok(())
    }

    #[test]
    fn completing_report_refreshes_state_when_only_newer_reports_are_incomplete(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        insert_quality_report(&conn, "report-baseline", "pending", "2026-07-22T00:00:01Z")?;
        let baseline = quality_result_input(
            "report-baseline",
            "baseline",
            &[("issue-repeat", "baseline evidence")],
        );
        let baseline_result = save_quality_check_result_internal(&mut conn, &baseline)?;
        update_quality_issue_status_internal(
            &mut conn,
            &baseline_result.items[0].id,
            "resolved",
            Some("previously resolved"),
        )?;

        insert_quality_report(&conn, "report-current", "pending", "2026-07-22T00:00:02Z")?;
        insert_quality_report(
            &conn,
            "report-newer-pending",
            "pending",
            "2026-07-22T00:00:03Z",
        )?;
        insert_quality_report(
            &conn,
            "report-newer-failed",
            "failed",
            "2026-07-22T00:00:04Z",
        )?;
        let current = quality_result_input(
            "report-current",
            "current complete result",
            &[("issue-repeat", "current evidence")],
        );
        let saved = save_quality_check_result_internal(&mut conn, &current)?;

        assert_eq!(saved.items[0].status, "pending");
        let latest = get_quality_check_issues_internal(&conn, "chapter-quality")?;
        assert_eq!(
            latest.report.as_ref().map(|report| report.id.as_str()),
            Some("report-current")
        );
        assert_eq!(latest.items[0].status, "pending");
        let workflow_state: String = conn.query_row(
            "SELECT status FROM quality_issue_states
             WHERE chapter_id = 'chapter-quality' AND issue_key = 'issue-repeat'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(workflow_state, "pending");
        Ok(())
    }

    #[test]
    fn late_older_report_cannot_overwrite_newer_report_workflow_state(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        conn.execute_batch(
            "INSERT INTO ai_task_records
                (id, novel_id, chapter_id, task_type, status, created_at)
             VALUES
                ('quality-task-tie-a', 'novel-quality', 'chapter-quality', 'quality_check', 'succeeded', '2026-07-22T00:00:00Z'),
                ('quality-task-tie-b', 'novel-quality', 'chapter-quality', 'quality_check', 'succeeded', '2026-07-22T00:00:00Z');",
        )?;
        let tied_created_at = "2026-07-22T00:00:05Z";
        insert_quality_report(&conn, "report-tie-a", "pending", tied_created_at)?;
        insert_quality_report(&conn, "report-tie-b", "pending", tied_created_at)?;

        let mut newer = quality_result_input(
            "report-tie-b",
            "newer by id",
            &[("issue-race", "newer evidence")],
        );
        newer.ai_task_id = "quality-task-tie-b".to_string();
        let newer_result = save_quality_check_result_internal(&mut conn, &newer)?;
        update_quality_issue_status_internal(
            &mut conn,
            &newer_result.items[0].id,
            "resolved",
            Some("keep resolved"),
        )?;

        let mut older = quality_result_input(
            "report-tie-a",
            "late older by id",
            &[("issue-race", "older evidence")],
        );
        older.ai_task_id = "quality-task-tie-a".to_string();
        let late_result = save_quality_check_result_internal(&mut conn, &older)?;
        assert_eq!(late_result.items[0].status, "pending");
        assert_eq!(late_result.items[0].title, "older evidence");

        let workflow_state: (String, Option<String>) = conn.query_row(
            "SELECT status, resolution_note FROM quality_issue_states
             WHERE chapter_id = 'chapter-quality' AND issue_key = 'issue-race'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(
            workflow_state,
            ("resolved".to_string(), Some("keep resolved".to_string()))
        );
        let late_snapshot = get_quality_check_report_snapshot_internal(&conn, "report-tie-a")?;
        assert_eq!(late_snapshot.items.len(), 1);
        assert_eq!(late_snapshot.items[0].title, "older evidence");
        assert_eq!(late_snapshot.items[0].status, "pending");
        let latest = get_quality_check_issues_internal(&conn, "chapter-quality")?;
        assert_eq!(
            latest.report.as_ref().map(|report| report.id.as_str()),
            Some("report-tie-b")
        );
        assert_eq!(latest.items[0].status, "resolved");
        Ok(())
    }

    #[test]
    fn completed_quality_result_save_is_idempotent_and_immutable(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        conn.execute(
            "INSERT INTO ai_task_records
                (id, novel_id, chapter_id, task_type, status, created_at)
             VALUES ('quality-task-other', 'novel-quality', 'chapter-quality', 'quality_check', 'succeeded', '2026-07-22T00:00:00Z')",
            [],
        )?;
        insert_quality_report(
            &conn,
            "report-idempotent",
            "pending",
            "2026-07-22T00:00:01Z",
        )?;
        let first = quality_result_input(
            "report-idempotent",
            "original summary",
            &[("issue-original", "original")],
        );
        let first_result = save_quality_check_result_internal(&mut conn, &first)?;
        let duplicate = quality_result_input(
            "report-idempotent",
            "replacement summary",
            &[("issue-replacement", "replacement")],
        );
        let duplicate_result = save_quality_check_result_internal(&mut conn, &duplicate)?;
        assert_eq!(duplicate_result.items.len(), 1);
        assert_eq!(duplicate_result.items[0].id, first_result.items[0].id);
        assert_eq!(duplicate_result.items[0].title, "original");
        assert_eq!(
            duplicate_result
                .report
                .as_ref()
                .and_then(|report| report.summary.as_deref()),
            Some("original summary")
        );
        let item_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM quality_check_items WHERE report_id = 'report-idempotent'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(item_count, 1);
        let mut wrong_task_duplicate = duplicate;
        wrong_task_duplicate.ai_task_id = "quality-task-other".to_string();
        assert_eq!(
            save_quality_check_result_internal(&mut conn, &wrong_task_duplicate).unwrap_err(),
            "quality_check_report_ai_task_mismatch"
        );
        Ok(())
    }

    #[test]
    fn batch_quality_state_update_is_transactional() -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        insert_quality_report(&conn, "report-batch", "pending", "2026-07-22T00:00:01Z")?;
        let input = quality_result_input(
            "report-batch",
            "batch",
            &[("issue-first", "first"), ("issue-second", "second")],
        );
        let saved = save_quality_check_result_internal(&mut conn, &input)?;
        conn.execute_batch(
            "CREATE TRIGGER fail_second_quality_state
             BEFORE UPDATE OF status ON quality_issue_states
             WHEN OLD.issue_key = 'issue-second'
             BEGIN
                 SELECT RAISE(ABORT, 'forced second state failure');
             END;",
        )?;
        let ids = saved
            .items
            .iter()
            .map(|item| item.id.clone())
            .collect::<Vec<_>>();
        let error = batch_update_quality_issue_status_internal(&mut conn, &ids, "resolved")
            .expect_err("the injected state failure must roll back the batch");
        assert!(error.starts_with("quality_issue_state_write_failed:"));
        let non_pending: i64 = conn.query_row(
            "SELECT COUNT(*) FROM quality_issue_states WHERE status <> 'pending'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(non_pending, 0);
        Ok(())
    }

    #[test]
    fn quality_result_rejects_report_ownership_and_terminal_status_mismatch(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        insert_quality_report(&conn, "report-owned", "pending", "2026-07-22T00:00:01Z")?;
        let mut wrong_owner =
            quality_result_input("report-owned", "wrong owner", &[("issue-one", "one")]);
        wrong_owner.chapter_id = "another-chapter".to_string();
        assert_eq!(
            save_quality_check_result_internal(&mut conn, &wrong_owner).unwrap_err(),
            "quality_check_report_ownership_mismatch"
        );
        insert_quality_report(&conn, "report-failed", "failed", "2026-07-22T00:00:02Z")?;
        let failed = quality_result_input("report-failed", "failed", &[("issue-two", "two")]);
        assert_eq!(
            save_quality_check_result_internal(&mut conn, &failed).unwrap_err(),
            "quality_check_report_not_pending"
        );
        Ok(())
    }

    #[test]
    fn quality_result_validates_and_binds_the_succeeded_ai_task(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        conn.execute_batch(
            "INSERT INTO ai_task_records
                (id, novel_id, chapter_id, task_type, status, created_at)
             VALUES
                ('quality-task-ok', 'novel-quality', 'chapter-quality', 'quality_check', 'succeeded', '2026-07-22T00:00:00Z'),
                ('quality-task-running', 'novel-quality', 'chapter-quality', 'quality_check', 'running', '2026-07-22T00:00:00Z'),
                ('quality-task-wrong-type', 'novel-quality', 'chapter-quality', 'draft_generation', 'succeeded', '2026-07-22T00:00:00Z'),
                ('quality-task-wrong-target', NULL, NULL, 'quality_check', 'succeeded', '2026-07-22T00:00:00Z');",
        )?;
        insert_quality_report(&conn, "report-task-ok", "pending", "2026-07-22T00:00:01Z")?;
        let mut valid = quality_result_input(
            "report-task-ok",
            "bound task",
            &[("issue-task", "task issue")],
        );
        valid.ai_task_id = "quality-task-ok".to_string();
        let saved = save_quality_check_result_internal(&mut conn, &valid)?;
        assert_eq!(
            saved
                .report
                .as_ref()
                .and_then(|report| report.ai_task_id.as_deref()),
            Some("quality-task-ok")
        );

        insert_quality_report(
            &conn,
            "report-task-running",
            "pending",
            "2026-07-22T00:00:02Z",
        )?;
        let mut invalid = quality_result_input(
            "report-task-running",
            "invalid task",
            &[("issue-invalid-task", "invalid task issue")],
        );
        invalid.ai_task_id = "quality-task-running".to_string();
        assert_eq!(
            save_quality_check_result_internal(&mut conn, &invalid).unwrap_err(),
            "quality_check_ai_task_mismatch"
        );
        let failed_report_state: (String, i64) = conn.query_row(
            "SELECT report.status,
                    (SELECT COUNT(*) FROM quality_check_items AS item WHERE item.report_id = report.id)
             FROM quality_check_reports AS report WHERE report.id = 'report-task-running'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(failed_report_state, ("pending".to_string(), 0));

        for (report_id, task_id, expected_error) in [
            ("report-task-required", "", "quality_check_ai_task_required"),
            (
                "report-task-wrong-type",
                "quality-task-wrong-type",
                "quality_check_ai_task_mismatch",
            ),
            (
                "report-task-wrong-target",
                "quality-task-wrong-target",
                "quality_check_ai_task_mismatch",
            ),
        ] {
            insert_quality_report(&conn, report_id, "pending", "2026-07-22T00:00:03Z")?;
            let mut input = quality_result_input(
                report_id,
                "rejected task",
                &[("issue-rejected-task", "rejected task issue")],
            );
            input.ai_task_id = task_id.to_string();
            assert_eq!(
                save_quality_check_result_internal(&mut conn, &input).unwrap_err(),
                expected_error
            );
        }
        let partially_written: i64 = conn.query_row(
            "SELECT COUNT(*) FROM quality_check_items
             WHERE report_id IN ('report-task-required', 'report-task-wrong-type', 'report-task-wrong-target')",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(partially_written, 0);
        Ok(())
    }

    #[test]
    fn quality_result_rejects_duplicate_issue_keys_without_partial_writes(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_quality_history_test_database()?;
        insert_quality_report(
            &conn,
            "report-duplicate-key",
            "pending",
            "2026-07-22T00:00:01Z",
        )?;
        let duplicate = quality_result_input(
            "report-duplicate-key",
            "duplicate",
            &[("same-key", "first"), ("same-key", "second")],
        );
        assert_eq!(
            save_quality_check_result_internal(&mut conn, &duplicate).unwrap_err(),
            "quality_check_duplicate_issue_key"
        );
        let state: (String, i64) = conn.query_row(
            "SELECT report.status,
                    (SELECT COUNT(*) FROM quality_check_items AS item WHERE item.report_id = report.id)
             FROM quality_check_reports AS report WHERE report.id = 'report-duplicate-key'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(state, ("pending".to_string(), 0));
        Ok(())
    }

    fn create_chapter_context_test_database() -> rusqlite::Result<Connection> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            CREATE TABLE novels (
                id TEXT PRIMARY KEY,
                deleted_at TEXT
            );
            CREATE TABLE volumes (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                deleted_at TEXT
            );
            CREATE TABLE chapters (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                volume_id TEXT,
                adopted_draft_id TEXT,
                status TEXT NOT NULL,
                order_index INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );
            CREATE TABLE chapter_drafts (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                is_adopted INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE characters (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                current_state TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE character_states (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                character_id TEXT NOT NULL,
                chapter_id TEXT,
                state_summary TEXT NOT NULL DEFAULT '',
                relationship_changes TEXT,
                goal_changes TEXT,
                location TEXT,
                health_state TEXT,
                knowledge_state TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE chapter_summaries (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                volume_id TEXT,
                adopted_draft_id TEXT NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                key_events TEXT,
                character_changes TEXT,
                relationship_changes TEXT,
                new_foreshadows TEXT,
                resolved_foreshadows TEXT,
                next_chapter_hints TEXT,
                core_events TEXT,
                protagonist_state_change TEXT,
                important_character_changes TEXT,
                setting_changes TEXT,
                new_locations TEXT,
                new_items_or_abilities TEXT,
                foreshadowing TEXT,
                unresolved_questions TEXT,
                facts_must_remember TEXT,
                next_chapter_hook TEXT,
                validation_status TEXT,
                validation_result TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                content_hash TEXT,
                draft_version INTEGER,
                is_expired INTEGER NOT NULL DEFAULT 0,
                ai_task_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE context_records (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                chapter_id TEXT,
                volume_id TEXT,
                context_type TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                importance INTEGER NOT NULL DEFAULT 3,
                is_active INTEGER NOT NULL DEFAULT 1,
                is_expired INTEGER NOT NULL DEFAULT 0,
                content_hash TEXT,
                draft_version INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            ",
        )?;
        Ok(conn)
    }

    struct ChapterContextFixture {
        novel_id: String,
        volume_id: String,
        chapter_id: String,
        draft_id: String,
        character_id: String,
    }

    fn seed_chapter_context_fixture(
        conn: &Connection,
        suffix: u128,
        order_index: i64,
    ) -> rusqlite::Result<ChapterContextFixture> {
        let novel_id = uuid::Uuid::from_u128(suffix * 16 + 1).to_string();
        let volume_id = uuid::Uuid::from_u128(suffix * 16 + 2).to_string();
        let chapter_id = uuid::Uuid::from_u128(suffix * 16 + 3).to_string();
        let draft_id = uuid::Uuid::from_u128(suffix * 16 + 4).to_string();
        let character_id = uuid::Uuid::from_u128(suffix * 16 + 5).to_string();
        conn.execute("INSERT INTO novels (id) VALUES (?1)", params![&novel_id])?;
        conn.execute(
            "INSERT INTO volumes (id, novel_id) VALUES (?1, ?2)",
            params![&volume_id, &novel_id],
        )?;
        conn.execute(
            "INSERT INTO chapters
             (id, novel_id, volume_id, adopted_draft_id, status, order_index, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'adopted', ?5, 'before')",
            params![&chapter_id, &novel_id, &volume_id, &draft_id, order_index],
        )?;
        conn.execute(
            "INSERT INTO chapter_drafts (id, novel_id, chapter_id, is_adopted)
             VALUES (?1, ?2, ?3, 1)",
            params![&draft_id, &novel_id, &chapter_id],
        )?;
        conn.execute(
            "INSERT INTO characters (id, novel_id, current_state, updated_at)
             VALUES (?1, ?2, 'before', 'before')",
            params![&character_id, &novel_id],
        )?;
        Ok(ChapterContextFixture {
            novel_id,
            volume_id,
            chapter_id,
            draft_id,
            character_id,
        })
    }

    fn test_summary_input(
        fixture: &ChapterContextFixture,
        id: Option<String>,
        summary: &str,
    ) -> SaveChapterSummaryInput {
        SaveChapterSummaryInput {
            id,
            novel_id: fixture.novel_id.clone(),
            chapter_id: fixture.chapter_id.clone(),
            volume_id: Some(fixture.volume_id.clone()),
            adopted_draft_id: fixture.draft_id.clone(),
            summary: summary.to_string(),
            key_events: None,
            character_changes: None,
            relationship_changes: None,
            new_foreshadows: None,
            resolved_foreshadows: None,
            next_chapter_hints: None,
            core_events: None,
            protagonist_state_change: None,
            important_character_changes: None,
            setting_changes: None,
            new_locations: None,
            new_items_or_abilities: None,
            foreshadowing: None,
            unresolved_questions: None,
            facts_must_remember: None,
            next_chapter_hook: None,
            validation_status: Some("passed".to_string()),
            validation_result: None,
            enabled: Some(true),
            content_hash: Some("hash".to_string()),
            draft_version: Some(1),
            ai_task_id: None,
        }
    }

    fn test_context_input(
        fixture: &ChapterContextFixture,
        id: Option<String>,
        title: &str,
        content: &str,
    ) -> SaveContextRecordInput {
        SaveContextRecordInput {
            id,
            novel_id: fixture.novel_id.clone(),
            chapter_id: Some(fixture.chapter_id.clone()),
            volume_id: Some(fixture.volume_id.clone()),
            context_type: "chapter_summary".to_string(),
            title: title.to_string(),
            content: content.to_string(),
            importance: Some(4),
            is_active: Some(true),
            content_hash: Some("hash".to_string()),
            draft_version: Some(1),
        }
    }

    fn test_character_state_input(
        fixture: &ChapterContextFixture,
        id: Option<String>,
        summary: &str,
    ) -> SaveCharacterStateInput {
        SaveCharacterStateInput {
            id,
            novel_id: fixture.novel_id.clone(),
            character_id: fixture.character_id.clone(),
            chapter_id: Some(fixture.chapter_id.clone()),
            state_summary: summary.to_string(),
            relationship_changes: Some("closer".to_string()),
            goal_changes: None,
            location: Some("harbor".to_string()),
            health_state: None,
            knowledge_state: Some("secret".to_string()),
        }
    }

    #[test]
    fn context_batch_preserves_provided_ids_and_rolls_back_nth_failure(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_chapter_context_test_database()?;
        let fixture = seed_chapter_context_fixture(&conn, 1, 0)?;
        let provided_id = uuid::Uuid::new_v4().to_string();
        let saved = save_context_records_internal(
            &mut conn,
            &[test_context_input(
                &fixture,
                Some(provided_id.clone()),
                "provided",
                "first",
            )],
        )?;
        assert_eq!(saved[0].id, provided_id);

        let invalid_id_error = save_context_records_internal(
            &mut conn,
            &[test_context_input(
                &fixture,
                Some("not-a-uuid".to_string()),
                "invalid",
                "must not persist",
            )],
        )
        .unwrap_err();
        assert_eq!(invalid_id_error, "context_record_id_invalid_uuid");

        conn.execute_batch(
            "CREATE TRIGGER fail_context_insert
             BEFORE INSERT ON context_records WHEN NEW.title = 'explode'
             BEGIN SELECT RAISE(ABORT, 'injected nth failure'); END;",
        )?;
        let before: i64 =
            conn.query_row("SELECT COUNT(*) FROM context_records", [], |row| row.get(0))?;
        let inputs = vec![
            test_context_input(
                &fixture,
                Some(uuid::Uuid::new_v4().to_string()),
                "will rollback",
                "second",
            ),
            test_context_input(
                &fixture,
                Some(uuid::Uuid::new_v4().to_string()),
                "explode",
                "third",
            ),
        ];
        assert!(save_context_records_internal(&mut conn, &inputs).is_err());
        let after: i64 =
            conn.query_row("SELECT COUNT(*) FROM context_records", [], |row| row.get(0))?;
        assert_eq!(after, before);
        Ok(())
    }

    #[test]
    fn context_update_rejects_cross_novel_ownership() -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_chapter_context_test_database()?;
        let owner = seed_chapter_context_fixture(&conn, 2, 0)?;
        let attacker = seed_chapter_context_fixture(&conn, 3, 0)?;
        let id = uuid::Uuid::new_v4().to_string();
        save_context_records_internal(
            &mut conn,
            &[test_context_input(
                &owner,
                Some(id.clone()),
                "original",
                "safe",
            )],
        )?;
        let update = UpdateContextRecordInput {
            novel_id: attacker.novel_id.clone(),
            chapter_id: Some(attacker.chapter_id.clone()),
            volume_id: Some(attacker.volume_id.clone()),
            context_type: "chapter_summary".to_string(),
            title: "hijacked".to_string(),
            content: "unsafe".to_string(),
            importance: 5,
            is_active: false,
            is_expired: true,
            content_hash: None,
            draft_version: None,
        };
        assert_eq!(
            update_context_record_internal(&conn, &id, &update).unwrap_err(),
            "context_record_ownership_mismatch"
        );
        assert_eq!(
            update_context_record_internal(&conn, &uuid::Uuid::new_v4().to_string(), &update)
                .unwrap_err(),
            "context_record_not_found"
        );
        let unchanged: (String, String) = conn.query_row(
            "SELECT novel_id, title FROM context_records WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(unchanged, (owner.novel_id, "original".to_string()));
        Ok(())
    }

    #[test]
    fn chapter_context_bundle_is_atomic_and_updates_all_owned_state(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_chapter_context_test_database()?;
        let fixture = seed_chapter_context_fixture(&conn, 4, 0)?;
        let summary_id = uuid::Uuid::new_v4().to_string();
        let context_id = uuid::Uuid::new_v4().to_string();
        let state_id = uuid::Uuid::new_v4().to_string();
        let input = SaveChapterContextBundleInput {
            novel_id: fixture.novel_id.clone(),
            chapter_id: fixture.chapter_id.clone(),
            adopted_draft_id: fixture.draft_id.clone(),
            summary: test_summary_input(&fixture, Some(summary_id.clone()), "bundle summary"),
            context_records: vec![test_context_input(
                &fixture,
                Some(context_id.clone()),
                "bundle context",
                "remember",
            )],
            character_states: vec![test_character_state_input(
                &fixture,
                Some(state_id.clone()),
                "after chapter",
            )],
        };
        let result = save_chapter_context_bundle_internal(&mut conn, &input)?;
        assert_eq!(result.summary.id, summary_id);
        assert_eq!(result.context_records[0].id, context_id);
        assert_eq!(result.character_states[0].id, state_id);
        assert_eq!(result.chapter_status, "summarized");
        let persisted: (String, String) = conn.query_row(
            "SELECT chapter.status, character.current_state
             FROM chapters AS chapter JOIN characters AS character ON character.novel_id = chapter.novel_id
             WHERE chapter.id = ?1 AND character.id = ?2",
            params![&fixture.chapter_id, &fixture.character_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(
            persisted,
            ("summarized".to_string(), "after chapter".to_string())
        );

        let rollback_fixture = seed_chapter_context_fixture(&conn, 5, 0)?;
        conn.execute_batch(
            "CREATE TRIGGER fail_bundle_second_context
             BEFORE INSERT ON context_records WHEN NEW.title = 'bundle explode'
             BEGIN SELECT RAISE(ABORT, 'injected bundle failure'); END;",
        )?;
        let rollback_input = SaveChapterContextBundleInput {
            novel_id: rollback_fixture.novel_id.clone(),
            chapter_id: rollback_fixture.chapter_id.clone(),
            adopted_draft_id: rollback_fixture.draft_id.clone(),
            summary: test_summary_input(
                &rollback_fixture,
                Some(uuid::Uuid::new_v4().to_string()),
                "must rollback",
            ),
            context_records: vec![
                test_context_input(
                    &rollback_fixture,
                    Some(uuid::Uuid::new_v4().to_string()),
                    "first bundle context",
                    "first",
                ),
                test_context_input(
                    &rollback_fixture,
                    Some(uuid::Uuid::new_v4().to_string()),
                    "bundle explode",
                    "second",
                ),
            ],
            character_states: vec![],
        };
        assert!(save_chapter_context_bundle_internal(&mut conn, &rollback_input).is_err());
        let counts: (i64, i64) = conn.query_row(
            "SELECT
                (SELECT COUNT(*) FROM chapter_summaries WHERE novel_id = ?1),
                (SELECT COUNT(*) FROM context_records WHERE novel_id = ?1)",
            params![&rollback_fixture.novel_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(counts, (0, 0));
        let rollback_status: String = conn.query_row(
            "SELECT status FROM chapters WHERE id = ?1",
            params![&rollback_fixture.chapter_id],
            |row| row.get(0),
        )?;
        assert_eq!(rollback_status, "adopted");
        Ok(())
    }

    #[test]
    fn chapter_context_expiration_rolls_back_summary_when_record_update_fails(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_chapter_context_test_database()?;
        let fixture = seed_chapter_context_fixture(&conn, 9, 0)?;
        upsert_chapter_summary(
            &conn,
            &test_summary_input(
                &fixture,
                Some(uuid::Uuid::new_v4().to_string()),
                "expiration summary",
            ),
            "before",
        )?;
        save_context_records_internal(
            &mut conn,
            &[test_context_input(
                &fixture,
                Some(uuid::Uuid::new_v4().to_string()),
                "expiration context",
                "remember",
            )],
        )?;
        conn.execute_batch(
            "CREATE TRIGGER fail_context_expiration
             BEFORE UPDATE OF is_expired ON context_records WHEN NEW.is_expired = 1
             BEGIN SELECT RAISE(ABORT, 'injected expiration failure'); END;",
        )?;

        assert!(mark_chapter_context_expired_internal(&mut conn, &fixture.chapter_id).is_err());
        let rolled_back: (i64, i64) = conn.query_row(
            "SELECT
                (SELECT is_expired FROM chapter_summaries WHERE chapter_id = ?1),
                (SELECT is_expired FROM context_records WHERE chapter_id = ?1)",
            params![&fixture.chapter_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(rolled_back, (0, 0));

        conn.execute_batch("DROP TRIGGER fail_context_expiration;")?;
        mark_chapter_context_expired_internal(&mut conn, &fixture.chapter_id)?;
        let expired: (i64, i64) = conn.query_row(
            "SELECT
                (SELECT is_expired FROM chapter_summaries WHERE chapter_id = ?1),
                (SELECT is_expired FROM context_records WHERE chapter_id = ?1)",
            params![&fixture.chapter_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(expired, (1, 1));
        Ok(())
    }

    #[test]
    fn legacy_context_migration_is_idempotent_and_reconciles_dual_write_mirror(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_chapter_context_test_database()?;
        let fixture = seed_chapter_context_fixture(&conn, 6, 0)?;
        let summary_id = uuid::Uuid::new_v4().to_string();
        let context_id = uuid::Uuid::new_v4().to_string();
        let mirror_source_id = uuid::Uuid::new_v4().to_string();
        let mirror_database_id = uuid::Uuid::new_v4().to_string();
        let state_id = uuid::Uuid::new_v4().to_string();
        let mirror = test_context_input(
            &fixture,
            Some(mirror_source_id.clone()),
            "dual mirror",
            "same fingerprint",
        );
        conn.execute(
            "INSERT INTO context_records
             (id, novel_id, chapter_id, volume_id, context_type, title, content,
              importance, is_active, is_expired, content_hash, draft_version,
              created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11, 'db-time', 'db-time')",
            params![
                &mirror_database_id,
                &mirror.novel_id,
                &mirror.chapter_id,
                &mirror.volume_id,
                &mirror.context_type,
                &mirror.title,
                &mirror.content,
                mirror.importance,
                i64::from(mirror.is_active.unwrap_or(true)),
                &mirror.content_hash,
                mirror.draft_version,
            ],
        )?;
        let migration = MigrateLegacyChapterContextInput {
            chapter_summaries: vec![LegacyChapterSummaryInput {
                data: test_summary_input(&fixture, Some(summary_id.clone()), "legacy summary"),
                is_expired: Some(false),
                created_at: Some("legacy-time".to_string()),
                updated_at: Some("legacy-time".to_string()),
            }],
            context_records: vec![
                LegacyContextRecordInput {
                    data: test_context_input(
                        &fixture,
                        Some(context_id.clone()),
                        "new legacy context",
                        "new fingerprint",
                    ),
                    is_expired: Some(false),
                    created_at: Some("legacy-time".to_string()),
                    updated_at: Some("legacy-time".to_string()),
                },
                LegacyContextRecordInput {
                    data: mirror,
                    is_expired: Some(false),
                    created_at: Some("local-time".to_string()),
                    updated_at: Some("local-time".to_string()),
                },
            ],
            character_states: vec![LegacyCharacterStateInput {
                data: test_character_state_input(&fixture, Some(state_id.clone()), "legacy state"),
                created_at: Some("legacy-time".to_string()),
            }],
        };
        let first = migrate_legacy_chapter_context_internal(&mut conn, &migration)?;
        assert_eq!(first.chapter_summaries.inserted, 1);
        assert_eq!(first.context_records.inserted, 1);
        assert_eq!(first.context_records.matched, 1);
        assert_eq!(first.character_states.inserted, 1);
        assert_eq!(first.id_map.get(&summary_id), Some(&summary_id));
        assert_eq!(first.id_map.get(&context_id), Some(&context_id));
        assert_eq!(
            first.id_map.get(&mirror_source_id),
            Some(&mirror_database_id)
        );
        assert_eq!(first.id_map.get(&state_id), Some(&state_id));

        let second = migrate_legacy_chapter_context_internal(&mut conn, &migration)?;
        assert_eq!(second.chapter_summaries.matched, 1);
        assert_eq!(second.context_records.matched, 2);
        assert_eq!(second.character_states.matched, 1);
        assert_eq!(second.chapter_summaries.inserted, 0);
        assert_eq!(second.context_records.inserted, 0);
        assert_eq!(second.character_states.inserted, 0);
        let counts: (i64, i64, i64) = conn.query_row(
            "SELECT
                (SELECT COUNT(*) FROM chapter_summaries WHERE novel_id = ?1),
                (SELECT COUNT(*) FROM context_records WHERE novel_id = ?1),
                (SELECT COUNT(*) FROM character_states WHERE novel_id = ?1)",
            params![&fixture.novel_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        assert_eq!(counts, (1, 2, 1));
        Ok(())
    }

    #[test]
    fn legacy_migration_reconciles_character_current_state_using_stable_latest_order(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_chapter_context_test_database()?;
        let fixture = seed_chapter_context_fixture(&conn, 10, 0)?;
        let lower_id = "00000000-0000-0000-0000-00000000ca01".to_string();
        let higher_id = "00000000-0000-0000-0000-00000000ca02".to_string();
        let tied_created_at = "2026-07-26T08:00:00Z";
        conn.execute(
            "INSERT INTO character_states
             (id, novel_id, character_id, chapter_id, state_summary,
              relationship_changes, goal_changes, location, health_state,
              knowledge_state, created_at)
             VALUES (?1, ?2, ?3, ?4, 'stable latest state', NULL, NULL, NULL, NULL, NULL, ?5)",
            params![
                &higher_id,
                &fixture.novel_id,
                &fixture.character_id,
                &fixture.chapter_id,
                tied_created_at
            ],
        )?;
        conn.execute(
            "UPDATE characters SET current_state = 'stale state' WHERE id = ?1",
            params![&fixture.character_id],
        )?;
        let migration = MigrateLegacyChapterContextInput {
            chapter_summaries: vec![],
            context_records: vec![],
            character_states: vec![LegacyCharacterStateInput {
                data: test_character_state_input(
                    &fixture,
                    Some(lower_id.clone()),
                    "lower id state",
                ),
                created_at: Some(tied_created_at.to_string()),
            }],
        };

        let first = migrate_legacy_chapter_context_internal(&mut conn, &migration)?;
        assert_eq!(first.character_states.inserted, 1);
        let current_after_insert: String = conn.query_row(
            "SELECT current_state FROM characters WHERE id = ?1",
            params![&fixture.character_id],
            |row| row.get(0),
        )?;
        assert_eq!(current_after_insert, "stable latest state");

        conn.execute(
            "UPDATE characters SET current_state = 'stale again' WHERE id = ?1",
            params![&fixture.character_id],
        )?;
        let second = migrate_legacy_chapter_context_internal(&mut conn, &migration)?;
        assert_eq!(second.character_states.matched, 1);
        assert_eq!(second.character_states.inserted, 0);
        let current_after_match: String = conn.query_row(
            "SELECT current_state FROM characters WHERE id = ?1",
            params![&fixture.character_id],
            |row| row.get(0),
        )?;
        assert_eq!(current_after_match, "stable latest state");
        let state_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM character_states WHERE character_id = ?1",
            params![&fixture.character_id],
            |row| row.get(0),
        )?;
        assert_eq!(state_count, 2);
        Ok(())
    }

    #[test]
    fn legacy_context_migration_skips_ambiguous_mirrors_without_deletion(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut conn = create_chapter_context_test_database()?;
        let fixture = seed_chapter_context_fixture(&conn, 7, 0)?;
        let base = test_context_input(&fixture, None, "ambiguous", "same");
        for (id, timestamp) in [
            (uuid::Uuid::new_v4().to_string(), "first"),
            (uuid::Uuid::new_v4().to_string(), "second"),
        ] {
            conn.execute(
                "INSERT INTO context_records
                 (id, novel_id, chapter_id, volume_id, context_type, title, content,
                  importance, is_active, is_expired, content_hash, draft_version,
                  created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 4, 1, 0, ?8, 1, ?9, ?9)",
                params![
                    id,
                    &base.novel_id,
                    &base.chapter_id,
                    &base.volume_id,
                    &base.context_type,
                    &base.title,
                    &base.content,
                    &base.content_hash,
                    timestamp,
                ],
            )?;
        }
        let source_id = uuid::Uuid::new_v4().to_string();
        let mut legacy_data = base;
        legacy_data.id = Some(source_id.clone());
        let migration = MigrateLegacyChapterContextInput {
            chapter_summaries: vec![],
            context_records: vec![LegacyContextRecordInput {
                data: legacy_data,
                is_expired: Some(false),
                created_at: None,
                updated_at: None,
            }],
            character_states: vec![],
        };
        let result = migrate_legacy_chapter_context_internal(&mut conn, &migration)?;
        assert_eq!(result.context_records.skipped, 1);
        assert!(result.warnings[0].contains("ambiguous_fingerprint_and_timestamps"));
        assert!(!result.id_map.contains_key(&source_id));
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM context_records WHERE novel_id = ?1",
            params![fixture.novel_id],
            |row| row.get(0),
        )?;
        assert_eq!(count, 2);
        Ok(())
    }

    #[test]
    fn context_and_summary_queries_have_stable_tie_breakers(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = create_chapter_context_test_database()?;
        let later_chapter = seed_chapter_context_fixture(&conn, 8, 2)?;
        let earlier_chapter = ChapterContextFixture {
            novel_id: later_chapter.novel_id.clone(),
            volume_id: later_chapter.volume_id.clone(),
            chapter_id: uuid::Uuid::new_v4().to_string(),
            draft_id: uuid::Uuid::new_v4().to_string(),
            character_id: later_chapter.character_id.clone(),
        };
        conn.execute(
            "INSERT INTO chapters
             (id, novel_id, volume_id, adopted_draft_id, status, order_index, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'adopted', 1, 'before')",
            params![
                &earlier_chapter.chapter_id,
                &earlier_chapter.novel_id,
                &earlier_chapter.volume_id,
                &earlier_chapter.draft_id
            ],
        )?;
        conn.execute(
            "INSERT INTO chapter_drafts (id, novel_id, chapter_id, is_adopted)
             VALUES (?1, ?2, ?3, 1)",
            params![
                &earlier_chapter.draft_id,
                &earlier_chapter.novel_id,
                &earlier_chapter.chapter_id
            ],
        )?;
        let low_summary_id = "00000000-0000-0000-0000-00000000ff01".to_string();
        let high_summary_id = "00000000-0000-0000-0000-00000000ff02".to_string();
        upsert_chapter_summary(
            &conn,
            &test_summary_input(&later_chapter, Some(low_summary_id.clone()), "lower tie"),
            "same-time",
        )?;
        upsert_chapter_summary(
            &conn,
            &test_summary_input(&later_chapter, Some(high_summary_id.clone()), "higher tie"),
            "same-time",
        )?;
        let early_summary_id = uuid::Uuid::new_v4().to_string();
        upsert_chapter_summary(
            &conn,
            &test_summary_input(
                &earlier_chapter,
                Some(early_summary_id.clone()),
                "earlier chapter",
            ),
            "same-time",
        )?;
        assert_eq!(
            get_chapter_summary_internal(&conn, &later_chapter.chapter_id)?
                .expect("summary")
                .id,
            high_summary_id
        );
        let summaries = get_chapter_summaries_by_novel_internal(&conn, &later_chapter.novel_id)?;
        assert_eq!(summaries[0].id, early_summary_id);
        assert_eq!(summaries[1].id, high_summary_id);
        assert_eq!(summaries[2].id, low_summary_id);

        for id in [
            "00000000-0000-0000-0000-00000000ee01",
            "00000000-0000-0000-0000-00000000ee02",
        ] {
            conn.execute(
                "INSERT INTO context_records
                 (id, novel_id, chapter_id, volume_id, context_type, title, content,
                  importance, is_active, is_expired, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 'other', 'tie', 'tie', 3, 1, 0, 'same-time', 'same-time')",
                params![
                    id,
                    &later_chapter.novel_id,
                    &later_chapter.chapter_id,
                    &later_chapter.volume_id
                ],
            )?;
        }
        let contexts = get_context_records_internal(&conn, &later_chapter.novel_id)?;
        assert_eq!(contexts[0].id, "00000000-0000-0000-0000-00000000ee02");
        assert_eq!(contexts[1].id, "00000000-0000-0000-0000-00000000ee01");
        Ok(())
    }

    #[test]
    fn ai_task_projection_replay_preserves_terminal_record_and_draft_foreign_key(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            CREATE TABLE ai_task_records (
                id TEXT PRIMARY KEY,
                novel_id TEXT,
                chapter_id TEXT,
                task_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                runtime_mode TEXT,
                provider TEXT,
                model_name TEXT,
                prompt_template_id TEXT,
                input_summary TEXT,
                prompt_snapshot TEXT,
                result_text TEXT,
                result_json TEXT,
                error_message TEXT,
                token_input INTEGER,
                token_output INTEGER,
                token_total INTEGER,
                input_price_per_million_tokens REAL,
                output_price_per_million_tokens REAL,
                cost_estimate REAL,
                cost_currency TEXT,
                cost_status TEXT,
                pricing_source TEXT,
                duration_ms INTEGER,
                started_at TEXT,
                finished_at TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE chapter_drafts (
                id TEXT PRIMARY KEY,
                ai_task_id TEXT,
                FOREIGN KEY (ai_task_id) REFERENCES ai_task_records(id)
            );
            ",
        )?;
        let input = CreateAiTaskRecordInput {
            id: "formal-task-1".to_string(),
            novel_id: Some("novel-1".to_string()),
            chapter_id: Some("chapter-1".to_string()),
            task_type: "chapter_generate".to_string(),
            status: "running".to_string(),
            runtime_mode: Some("mock".to_string()),
            provider: Some("mock".to_string()),
            model_name: Some("Mock".to_string()),
            input_price_per_million_tokens: Some(0.0),
            output_price_per_million_tokens: Some(0.0),
            cost_currency: Some("USD".to_string()),
            pricing_source: Some("mock".to_string()),
            input_summary: Some("first projection".to_string()),
            started_at: Some("2026-07-29T00:00:00Z".to_string()),
            created_at: "2026-07-29T00:00:00Z".to_string(),
        };
        assert_eq!(
            create_ai_task_record_internal(&conn, &input)?.status,
            "running"
        );
        mark_ai_task_succeeded_internal(
            &conn,
            &input.id,
            &MarkAiTaskSucceededInput {
                result_text: Some("terminal result".to_string()),
                prompt_snapshot: None,
                result_json: None,
                token_input: Some(2),
                token_output: Some(3),
                token_total: Some(5),
                duration_ms: Some(10),
                finished_at: "2026-07-29T00:00:01Z".to_string(),
            },
        )?;
        conn.execute(
            "INSERT INTO chapter_drafts (id, ai_task_id) VALUES ('draft-1', ?1)",
            params![&input.id],
        )?;

        let replayed = create_ai_task_record_internal(
            &conn,
            &CreateAiTaskRecordInput {
                input_summary: Some("replayed projection".to_string()),
                created_at: "2026-07-29T00:00:02Z".to_string(),
                ..input
            },
        )?;
        assert_eq!(replayed.status, "succeeded");
        assert_eq!(replayed.result_text.as_deref(), Some("terminal result"));
        assert_eq!(replayed.input_summary.as_deref(), Some("first projection"));
        let conflict = create_ai_task_record_internal(
            &conn,
            &CreateAiTaskRecordInput {
                id: "formal-task-1".to_string(),
                novel_id: Some("other-novel".to_string()),
                chapter_id: Some("chapter-1".to_string()),
                task_type: "chapter_generate".to_string(),
                status: "running".to_string(),
                runtime_mode: Some("mock".to_string()),
                provider: Some("mock".to_string()),
                model_name: Some("Mock".to_string()),
                input_price_per_million_tokens: Some(0.0),
                output_price_per_million_tokens: Some(0.0),
                cost_currency: Some("USD".to_string()),
                pricing_source: Some("mock".to_string()),
                input_summary: None,
                started_at: Some("2026-07-29T00:00:03Z".to_string()),
                created_at: "2026-07-29T00:00:03Z".to_string(),
            },
        )
        .expect_err("same projection id with different ownership must fail");
        assert_eq!(conflict, "ai_task_projection_identity_conflict");
        let draft_task_id: Option<String> = conn.query_row(
            "SELECT ai_task_id FROM chapter_drafts WHERE id = 'draft-1'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(draft_task_id.as_deref(), Some("formal-task-1"));
        let foreign_key_violations: i64 =
            conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })?;
        assert_eq!(foreign_key_violations, 0);
        Ok(())
    }

    #[test]
    fn ai_task_cancellation_is_terminal_and_idempotent() -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "
            CREATE TABLE ai_task_records (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                error_message TEXT,
                duration_ms INTEGER,
                finished_at TEXT
            );
            INSERT INTO ai_task_records (id, status) VALUES ('running-task', 'running');
            INSERT INTO ai_task_records (id, status) VALUES ('succeeded-task', 'succeeded');
            ",
        )?;

        assert_eq!(
            mark_ai_task_cancelled_internal(
                &conn,
                "running-task",
                "2026-07-21T09:00:00Z",
                Some(125),
            )?,
            1
        );
        assert_eq!(
            mark_ai_task_cancelled_internal(
                &conn,
                "running-task",
                "2026-07-21T09:00:01Z",
                Some(250),
            )?,
            0
        );
        assert_eq!(
            mark_ai_task_cancelled_internal(
                &conn,
                "succeeded-task",
                "2026-07-21T09:00:02Z",
                Some(375),
            )?,
            0
        );

        let cancelled: (String, Option<i64>, Option<String>) = conn.query_row(
            "SELECT status, duration_ms, finished_at FROM ai_task_records WHERE id = 'running-task'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        assert_eq!(cancelled.0, "cancelled");
        assert_eq!(cancelled.1, Some(125));
        assert_eq!(cancelled.2.as_deref(), Some("2026-07-21T09:00:00Z"));

        let succeeded: String = conn.query_row(
            "SELECT status FROM ai_task_records WHERE id = 'succeeded-task'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(succeeded, "succeeded");
        Ok(())
    }

    #[test]
    fn ai_task_retry_reopens_only_failed_compatibility_projection(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "
            CREATE TABLE ai_task_records (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                error_message TEXT,
                duration_ms INTEGER,
                started_at TEXT,
                finished_at TEXT
            );
            INSERT INTO ai_task_records
                (id, status, error_message, duration_ms, started_at, finished_at)
            VALUES
                ('failed-task', 'failed', 'retryable', 10, 'before', 'finished'),
                ('succeeded-task', 'succeeded', NULL, 12, 'before', 'finished');
            ",
        )?;

        assert_eq!(
            mark_ai_task_running_for_retry_internal(&conn, "failed-task", "retry-start")?,
            1
        );
        assert_eq!(
            mark_ai_task_running_for_retry_internal(&conn, "succeeded-task", "must-not-change")?,
            0
        );
        let failed: (String, Option<String>, Option<i64>, String, Option<String>) = conn
            .query_row(
                "SELECT status, error_message, duration_ms, started_at, finished_at
                 FROM ai_task_records WHERE id = 'failed-task'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )?;
        assert_eq!(
            failed,
            (
                "running".to_string(),
                None,
                None,
                "retry-start".to_string(),
                None
            )
        );
        let succeeded: (String, String) = conn.query_row(
            "SELECT status, started_at FROM ai_task_records WHERE id = 'succeeded-task'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(succeeded, ("succeeded".to_string(), "before".to_string()));
        Ok(())
    }

    #[test]
    fn ai_task_success_calculates_cost_from_frozen_pricing(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "
            CREATE TABLE ai_task_records (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                result_text TEXT,
                prompt_snapshot TEXT,
                result_json TEXT,
                error_message TEXT,
                token_input INTEGER,
                token_output INTEGER,
                token_total INTEGER,
                input_price_per_million_tokens REAL,
                output_price_per_million_tokens REAL,
                cost_estimate REAL,
                cost_status TEXT,
                pricing_source TEXT,
                duration_ms INTEGER,
                finished_at TEXT
            );
            INSERT INTO ai_task_records
                (id, status, input_price_per_million_tokens, output_price_per_million_tokens, pricing_source)
            VALUES ('configured', 'running', 2.0, 8.0, 'user_configured');
            INSERT INTO ai_task_records (id, status, pricing_source)
            VALUES ('unpriced', 'running', 'unconfigured');
            INSERT INTO ai_task_records
                (id, status, input_price_per_million_tokens, output_price_per_million_tokens, pricing_source)
            VALUES ('mock', 'running', 0.0, 0.0, 'mock');
            ",
        )?;

        let success = |input_tokens, output_tokens| MarkAiTaskSucceededInput {
            result_text: Some("ok".to_string()),
            prompt_snapshot: None,
            result_json: None,
            token_input: input_tokens,
            token_output: output_tokens,
            token_total: input_tokens
                .zip(output_tokens)
                .map(|(left, right)| left + right),
            duration_ms: Some(10),
            finished_at: "2026-07-28T10:00:00Z".to_string(),
        };
        assert_eq!(
            mark_ai_task_succeeded_internal(
                &conn,
                "configured",
                &success(Some(250_000), Some(125_000)),
            )?,
            1
        );
        assert_eq!(
            mark_ai_task_succeeded_internal(&conn, "unpriced", &success(Some(10), Some(20)),)?,
            1
        );
        assert_eq!(
            mark_ai_task_succeeded_internal(&conn, "mock", &success(None, None))?,
            1
        );

        let configured: (f64, String) = conn.query_row(
            "SELECT cost_estimate, cost_status FROM ai_task_records WHERE id = 'configured'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(configured, (1.5, "complete".to_string()));
        let unpriced: (Option<f64>, String) = conn.query_row(
            "SELECT cost_estimate, cost_status FROM ai_task_records WHERE id = 'unpriced'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(unpriced, (None, "unpriced".to_string()));
        let mock: (f64, String) = conn.query_row(
            "SELECT cost_estimate, cost_status FROM ai_task_records WHERE id = 'mock'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(mock, (0.0, "mock".to_string()));
        Ok(())
    }

    #[test]
    fn ai_task_success_rejects_negative_usage_and_duration() {
        let conn = Connection::open_in_memory().unwrap();
        for (field, token_input, token_output, token_total, duration_ms) in [
            ("tokenInput", Some(-1), Some(0), Some(0), Some(0)),
            ("tokenOutput", Some(0), Some(-1), Some(0), Some(0)),
            ("tokenTotal", Some(0), Some(0), Some(-1), Some(0)),
            ("durationMs", Some(0), Some(0), Some(0), Some(-1)),
        ] {
            let input = MarkAiTaskSucceededInput {
                result_text: Some("must-not-persist".to_string()),
                prompt_snapshot: None,
                result_json: None,
                token_input,
                token_output,
                token_total,
                duration_ms,
                finished_at: "2026-07-28T10:00:00Z".to_string(),
            };
            assert_eq!(
                mark_ai_task_succeeded_internal(&conn, "task", &input).unwrap_err(),
                format!("{field} must be non-negative")
            );
        }
    }

    #[test]
    fn save_style_profile_rejects_cross_novel_reference_binding(
    ) -> Result<(), Box<dyn std::error::Error>> {
        crate::db::init_test_database();
        let suffix = uuid::Uuid::new_v4().to_string();
        let source_novel_id = format!("style-source-novel-{suffix}");
        let target_novel_id = format!("style-target-novel-{suffix}");
        let work_id = format!("style-reference-work-{suffix}");
        let import_id = format!("style-reference-import-{suffix}");
        let profile_name = format!("cross-scope-profile-{suffix}");
        let source_hash = "a".repeat(64);
        {
            let connection = crate::db::get_connection()
                .lock()
                .expect("lock style reference test database");
            connection.execute(
                "INSERT INTO novels (id, title, created_at, updated_at)
                 VALUES (?1, 'source novel', 'now', 'now'), (?2, 'target novel', 'now', 'now')",
                params![source_novel_id, target_novel_id],
            )?;
            connection.execute(
                "INSERT INTO reference_works
                    (id, novel_id, title, purpose, revision, created_at, updated_at)
                 VALUES (?1, ?2, 'reference', 'style', 1, 'now', 'now')",
                params![work_id, source_novel_id],
            )?;
            connection.execute(
                "INSERT INTO reference_imports
                    (id, reference_work_id, novel_id, version_no, is_current, operation_id,
                     request_hash, file_name, source_format, source_sha256, source_byte_count,
                     selected_encoding, encoding_source, decoded_text_sha256,
                     decoded_char_count, decoded_utf8_byte_count, source_text, section_count,
                     parser_version, section_plan_sha256, warnings_json, imported_at)
                 VALUES (?1, ?2, ?3, 1, 1, ?4, ?5, 'reference.txt', 'txt', ?6, 1,
                         'utf-8', 'utf8_valid', ?7, 1, 1, 'x', 1,
                         'reference_txt_parser_v1', ?8, '[]', 'now')",
                params![
                    import_id,
                    work_id,
                    source_novel_id,
                    format!("style-reference-operation-{suffix}"),
                    "b".repeat(64),
                    source_hash,
                    "c".repeat(64),
                    "d".repeat(64),
                ],
            )?;
        }

        let error = save_style_profile(
            None,
            SaveStyleProfileInput {
                project_id: target_novel_id.clone(),
                name: profile_name.clone(),
                description: None,
                narrative_perspective: None,
                tone: None,
                pace: None,
                sentence_style: None,
                dialogue_ratio: None,
                description_ratio: None,
                psychological_ratio: None,
                battle_style: None,
                battle_intensity: None,
                emotion_tendency: None,
                chapter_ending: None,
                forbidden_styles: None,
                style_summary: None,
                raw_config_json: None,
                source_type: Some("ai_analyzed".to_string()),
                source_asset_id: None,
                source_reference_work_id: Some(work_id),
                source_reference_import_id: Some(import_id),
                source_content_sha256: Some(source_hash),
                source_state: Some("available".to_string()),
                analysis_metadata_json: Some("{}".to_string()),
            },
        )
        .expect_err("cross-novel reference binding must fail");
        assert!(error.starts_with("REFERENCE_SCOPE_MISMATCH:"), "{error}");
        let connection = crate::db::get_connection()
            .lock()
            .expect("lock style reference test database");
        let persisted: i64 = connection.query_row(
            "SELECT COUNT(*) FROM style_profiles WHERE novel_id = ?1 AND name = ?2",
            params![target_novel_id, profile_name],
            |row| row.get(0),
        )?;
        assert_eq!(persisted, 0);
        Ok(())
    }

    #[test]
    fn ai_task_count_applies_server_side_type_and_status_filters(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "CREATE TABLE ai_task_records (
                id TEXT PRIMARY KEY,
                task_type TEXT NOT NULL,
                status TEXT NOT NULL
            );
            INSERT INTO ai_task_records (id, task_type, status) VALUES
                ('a', 'chapter_generate', 'succeeded'),
                ('b', 'chapter_generate', 'failed'),
                ('c', 'quality_check', 'succeeded');",
        )?;

        assert_eq!(
            count_ai_task_records_filtered_in_conn(&conn, None, None)?,
            3
        );
        assert_eq!(
            count_ai_task_records_filtered_in_conn(&conn, Some("chapter_generate"), None)?,
            2
        );
        assert_eq!(
            count_ai_task_records_filtered_in_conn(&conn, None, Some("succeeded"))?,
            2
        );
        assert_eq!(
            count_ai_task_records_filtered_in_conn(
                &conn,
                Some("chapter_generate"),
                Some("succeeded"),
            )?,
            1
        );
        assert!(normalize_ai_task_type_filter(Some("unknown".to_string())).is_err());
        assert!(normalize_ai_task_status_filter(Some("unknown".to_string())).is_err());
        Ok(())
    }

    #[test]
    fn quality_fix_round_guard_allows_idempotent_update_but_rejects_second_run(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "CREATE TABLE quality_fix_runs (
                id TEXT PRIMARY KEY,
                chapter_id TEXT NOT NULL,
                source_draft_id TEXT NOT NULL
            );
            INSERT INTO quality_fix_runs (id, chapter_id, source_draft_id)
            VALUES ('run-1', 'chapter-1', 'draft-1');",
        )?;

        assert!(!has_other_quality_fix_round(
            &conn,
            "chapter-1",
            "draft-1",
            "run-1",
        )?);
        assert!(has_other_quality_fix_round(
            &conn,
            "chapter-1",
            "draft-1",
            "run-2",
        )?);
        assert!(!has_other_quality_fix_round(
            &conn,
            "chapter-1",
            "draft-2",
            "run-2",
        )?);
        Ok(())
    }
}
