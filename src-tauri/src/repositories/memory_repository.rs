use crate::errors::AppError;
use rusqlite::types::Type;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnapshotRecord {
    pub snapshot_id: String,
    pub operation_id: String,
    pub request_hash: String,
    pub contract_version: String,
    pub memory_kind: String,
    pub compiler_id: String,
    pub compiler_version: i64,
    pub novel_id: String,
    pub target_chapter_id: String,
    pub target_chapter_rank: i64,
    pub lookback_chapters: i64,
    pub budget_bytes: i64,
    pub source_manifest_json: Value,
    pub source_manifest_hash: String,
    pub memory_json: Value,
    pub memory_hash: String,
    pub candidate_count: i64,
    pub included_count: i64,
    pub omitted_count: i64,
    pub memory_bytes: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnapshotSourceRecord {
    pub snapshot_id: String,
    pub source_ordinal: i64,
    pub source_type: String,
    pub source_id: String,
    pub novel_id: String,
    pub chapter_id: Option<String>,
    pub chapter_rank: Option<i64>,
    pub source_version: String,
    pub source_hash: String,
    pub included: bool,
    pub omission_reason: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnapshotBundle {
    pub snapshot: MemorySnapshotRecord,
    pub sources: Vec<MemorySnapshotSourceRecord>,
}

fn json_column(row: &Row<'_>, index: usize) -> rusqlite::Result<Value> {
    let raw: String = row.get(index)?;
    serde_json::from_str(&raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(raw.len(), Type::Text, Box::new(error))
    })
}

fn map_snapshot(row: &Row<'_>) -> rusqlite::Result<MemorySnapshotRecord> {
    Ok(MemorySnapshotRecord {
        snapshot_id: row.get(0)?,
        operation_id: row.get(1)?,
        request_hash: row.get(2)?,
        contract_version: row.get(3)?,
        memory_kind: row.get(4)?,
        compiler_id: row.get(5)?,
        compiler_version: row.get(6)?,
        novel_id: row.get(7)?,
        target_chapter_id: row.get(8)?,
        target_chapter_rank: row.get(9)?,
        lookback_chapters: row.get(10)?,
        budget_bytes: row.get(11)?,
        source_manifest_json: json_column(row, 12)?,
        source_manifest_hash: row.get(13)?,
        memory_json: json_column(row, 14)?,
        memory_hash: row.get(15)?,
        candidate_count: row.get(16)?,
        included_count: row.get(17)?,
        omitted_count: row.get(18)?,
        memory_bytes: row.get(19)?,
        created_at: row.get(20)?,
    })
}

const SNAPSHOT_SELECT: &str = "SELECT snapshot_id, operation_id, request_hash,
    contract_version, memory_kind, compiler_id, compiler_version, novel_id,
    target_chapter_id, target_chapter_rank, lookback_chapters, budget_bytes,
    source_manifest_json, source_manifest_hash, memory_json, memory_hash,
    candidate_count, included_count, omitted_count, memory_bytes, created_at
    FROM memory_snapshots";

fn map_source(row: &Row<'_>) -> rusqlite::Result<MemorySnapshotSourceRecord> {
    Ok(MemorySnapshotSourceRecord {
        snapshot_id: row.get(0)?,
        source_ordinal: row.get(1)?,
        source_type: row.get(2)?,
        source_id: row.get(3)?,
        novel_id: row.get(4)?,
        chapter_id: row.get(5)?,
        chapter_rank: row.get(6)?,
        source_version: row.get(7)?,
        source_hash: row.get(8)?,
        included: row.get::<_, i64>(9)? != 0,
        omission_reason: row.get(10)?,
        created_at: row.get(11)?,
    })
}

pub fn get_snapshot(
    connection: &Connection,
    snapshot_id: &str,
) -> Result<Option<MemorySnapshotRecord>, AppError> {
    connection
        .query_row(
            &format!("{SNAPSHOT_SELECT} WHERE snapshot_id=?1"),
            params![snapshot_id],
            map_snapshot,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn get_snapshot_by_operation(
    connection: &Connection,
    operation_id: &str,
) -> Result<Option<MemorySnapshotRecord>, AppError> {
    connection
        .query_row(
            &format!("{SNAPSHOT_SELECT} WHERE operation_id=?1"),
            params![operation_id],
            map_snapshot,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn list_snapshots_by_chapter(
    connection: &Connection,
    chapter_id: &str,
    limit: i64,
) -> Result<Vec<MemorySnapshotRecord>, AppError> {
    let mut statement = connection
        .prepare(&format!(
            "{SNAPSHOT_SELECT} WHERE target_chapter_id=?1
             ORDER BY created_at DESC, snapshot_id DESC LIMIT ?2"
        ))
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![chapter_id, limit], map_snapshot)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}

pub fn list_sources(
    connection: &Connection,
    snapshot_id: &str,
) -> Result<Vec<MemorySnapshotSourceRecord>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT snapshot_id, source_ordinal, source_type, source_id, novel_id,
                chapter_id, chapter_rank, source_version, source_hash, included,
                omission_reason, created_at
             FROM memory_snapshot_sources WHERE snapshot_id=?1 ORDER BY source_ordinal ASC",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![snapshot_id], map_source)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}

pub fn get_bundle(
    connection: &Connection,
    snapshot_id: &str,
) -> Result<Option<MemorySnapshotBundle>, AppError> {
    let Some(snapshot) = get_snapshot(connection, snapshot_id)? else {
        return Ok(None);
    };
    Ok(Some(MemorySnapshotBundle {
        sources: list_sources(connection, snapshot_id)?,
        snapshot,
    }))
}
