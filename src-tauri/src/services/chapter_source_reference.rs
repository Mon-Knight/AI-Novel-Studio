use crate::repositories::draft_repository;
use crate::services::draft_service;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeSet;

const PREFIX: &str = "ans-adopted-chapter-v1:";
const CHANGED: &str =
    "CHAPTER_SOURCE_CHANGED: 采用正文已变化或无法完整读取，请重新核对正文并预览影响";

fn references(metadata: Option<&str>) -> BTreeSet<String> {
    metadata
        .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
        .and_then(|value| value["provenance"]["sourceRefs"].as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|value| value.as_str())
        .filter(|value| value.starts_with(PREFIX))
        .map(str::to_string)
        .collect()
}

/// Called inside the existing setting write transaction. Old provenance is historical;
/// only newly attached references and the current author confirmation require a current source.
pub fn validate_change_source(
    connection: &Connection,
    novel_id: &str,
    next_metadata: Option<&str>,
    previous_metadata: Option<&str>,
    notes: Option<&str>,
) -> Result<(), String> {
    let previous = references(previous_metadata);
    let mut current: BTreeSet<_> = references(next_metadata)
        .difference(&previous)
        .cloned()
        .collect();
    current.extend(
        notes
            .unwrap_or_default()
            .lines()
            .map(str::trim)
            .filter(|line| line.starts_with(PREFIX))
            .map(str::to_string),
    );
    for reference in current {
        validate_reference(connection, novel_id, &reference)?;
    }
    Ok(())
}

fn validate_reference(
    connection: &Connection,
    novel_id: &str,
    reference: &str,
) -> Result<(), String> {
    let parts: Vec<_> = reference
        .strip_prefix(PREFIX)
        .unwrap_or_default()
        .split(':')
        .collect();
    if parts.len() != 3
        || parts[0].is_empty()
        || parts[1].is_empty()
        || parts[2].len() != 64
        || !parts[2].bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(CHANGED.to_string());
    }
    let (chapter_id, draft_id, hash) = (parts[0], parts[1], parts[2]);
    draft_repository::validate_target(connection, novel_id, chapter_id)
        .map_err(|_| CHANGED.to_string())?;
    let adopted: Option<String> = connection.query_row(
        "SELECT adopted_draft_id FROM chapters WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL",
        params![chapter_id, novel_id], |row| row.get::<_, Option<String>>(0),
    ).optional().map_err(|error| error.to_string())?.flatten();
    if adopted.as_deref() != Some(draft_id) {
        return Err(CHANGED.to_string());
    }
    let draft = draft_repository::find_draft(connection, draft_id)
        .map_err(|_| CHANGED.to_string())?
        .ok_or(CHANGED)?;
    if draft.novel_id != novel_id || draft.chapter_id != chapter_id || !draft.is_adopted {
        return Err(CHANGED.to_string());
    }
    let full =
        draft_service::load_full_content(connection, &draft).map_err(|_| CHANGED.to_string())?;
    if full.content.trim().is_empty() || !full.content_hash.eq_ignore_ascii_case(hash) {
        return Err(CHANGED.to_string());
    }
    Ok(())
}

#[cfg(test)]
#[path = "chapter_source_reference_tests.rs"]
mod tests;
