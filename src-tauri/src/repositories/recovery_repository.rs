use crate::errors::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshot {
    pub novel_id: String,
    pub chapter_id: String,
    pub base_draft_id: Option<String>,
    pub base_draft_version: Option<i64>,
    pub base_content_hash: Option<String>,
    pub recovery_content: String,
    pub recovery_content_hash: String,
    pub large_text_ref_id: Option<String>,
    pub selection_start: Option<i64>,
    pub selection_end: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

pub fn get(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
) -> Result<Option<RecoverySnapshot>, AppError> {
    connection
        .query_row(
            "SELECT novel_id, chapter_id, base_draft_id, base_draft_version, base_content_hash,
                    recovery_content, recovery_content_hash, large_text_ref_id, selection_start, selection_end,
                    created_at, updated_at
             FROM workspace_recovery_snapshots WHERE novel_id = ?1 AND chapter_id = ?2",
            params![novel_id, chapter_id],
            |row| {
                Ok(RecoverySnapshot {
                    novel_id: row.get(0)?,
                    chapter_id: row.get(1)?,
                    base_draft_id: row.get(2)?,
                    base_draft_version: row.get(3)?,
                    base_content_hash: row.get(4)?,
                    recovery_content: row.get(5)?,
                    recovery_content_hash: row.get(6)?,
                    large_text_ref_id: row.get(7)?,
                    selection_start: row.get(8)?,
                    selection_end: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            },
        )
        .optional()
        .map_err(AppError::database)
}

pub fn upsert(connection: &Connection, snapshot: &RecoverySnapshot) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO workspace_recovery_snapshots
                (novel_id, chapter_id, base_draft_id, base_draft_version, base_content_hash,
                 recovery_content, recovery_content_hash, large_text_ref_id, selection_start, selection_end,
                 created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(novel_id, chapter_id) DO UPDATE SET
                 base_draft_id = excluded.base_draft_id,
                 base_draft_version = excluded.base_draft_version,
                 base_content_hash = excluded.base_content_hash,
                 recovery_content = excluded.recovery_content,
                 recovery_content_hash = excluded.recovery_content_hash,
                 large_text_ref_id = excluded.large_text_ref_id,
                 selection_start = excluded.selection_start,
                 selection_end = excluded.selection_end,
                 updated_at = excluded.updated_at",
            params![
                snapshot.novel_id,
                snapshot.chapter_id,
                snapshot.base_draft_id,
                snapshot.base_draft_version,
                snapshot.base_content_hash,
                snapshot.recovery_content,
                snapshot.recovery_content_hash,
                snapshot.large_text_ref_id,
                snapshot.selection_start,
                snapshot.selection_end,
                snapshot.created_at,
                snapshot.updated_at
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

pub fn delete_exact(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
) -> Result<usize, AppError> {
    connection
        .execute(
            "DELETE FROM workspace_recovery_snapshots WHERE novel_id = ?1 AND chapter_id = ?2",
            params![novel_id, chapter_id],
        )
        .map_err(AppError::database)
}
