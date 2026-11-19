//! Character-state materialization for chapter summaries.
//!
//! Versioned coverage candidates (`summaryCoverageVersion = 1`) may only write
//! character state for references that resolve deterministically to exactly one
//! active character of the same novel. Unknown, cross-novel, disabled, ambiguous,
//! or ID/name-inconsistent references fail closed before the domain transaction
//! writes anything. Historical candidates without the marker keep the previous
//! best-effort resolution. This is reference integrity, not a semantic proof of
//! the reported change.

use super::structured_artifact_apply_service::{
    stored_field, trimmed_text, ApplyStructuredArtifactInput, MAX_FIELD_CHARS, MAX_ITEMS,
    MAX_NAME_CHARS,
};
use crate::domain::context::SaveCharacterStateInput;
use crate::errors::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{Map, Value};
use std::collections::HashSet;

/// Stable conflict returned when a new-contract character reference cannot be
/// resolved unambiguously to one active character of the applied novel.
pub(super) const CHARACTER_REFERENCE_CONFLICT: &str = "SUMMARY_CHARACTER_REFERENCE_CONFLICT";

pub(super) enum CharacterStatesOutcome {
    Ready(Vec<SaveCharacterStateInput>),
    Conflict(&'static str),
}

struct ActiveCharacter {
    id: String,
    name: String,
}

enum ResolvedCharacter {
    Found(String),
    Unresolved,
}

pub(super) fn summary_character_states(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    object: Option<&Map<String, Value>>,
    coverage_required: bool,
) -> Result<CharacterStatesOutcome, AppError> {
    let Some(chapter_id) = input.chapter_id.as_deref() else {
        return Ok(CharacterStatesOutcome::Ready(Vec::new()));
    };
    let mut changes = Vec::<Map<String, Value>>::new();
    if let Some(items) = object
        .and_then(|value| value.get("characterChanges"))
        .and_then(Value::as_array)
    {
        changes.extend(
            items
                .iter()
                .take(MAX_ITEMS)
                .filter_map(Value::as_object)
                .cloned(),
        );
    }
    // Under the coverage contract `characterChanges` is the only state-write source.
    // The descriptive legacy fields remain readable, but must not create states.
    if !coverage_required {
        if let Some(items) = object
            .and_then(|value| value.get("importantCharacterChanges"))
            .and_then(Value::as_array)
        {
            for item in items.iter().take(MAX_ITEMS).filter_map(Value::as_object) {
                let mut normalized = item.clone();
                if normalized.get("characterName").is_none() {
                    if let Some(name) = normalized.get("name").cloned() {
                        normalized.insert("characterName".to_string(), name);
                    }
                }
                if normalized.get("stateSummary").is_none() {
                    if let Some(change) = normalized.get("change").cloned() {
                        normalized.insert("stateSummary".to_string(), change);
                    }
                }
                changes.push(normalized);
            }
        }
        if let Some(protagonist_state) = object
            .and_then(|value| trimmed_text(value.get("protagonistStateChange"), MAX_FIELD_CHARS))
        {
            let protagonist = connection
                .query_row(
                    "SELECT id,name FROM characters
                     WHERE novel_id=?1 AND is_active=1 AND is_protagonist=1
                     ORDER BY protagonist_order, created_at, id LIMIT 1",
                    params![input.novel_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()
                .map_err(AppError::database)?;
            if let Some((character_id, character_name)) = protagonist {
                let mut change = Map::new();
                change.insert("characterId".to_string(), Value::String(character_id));
                change.insert("characterName".to_string(), Value::String(character_name));
                change.insert("stateSummary".to_string(), Value::String(protagonist_state));
                changes.push(change);
            }
        }
    }

    let mut seen = HashSet::new();
    let mut states = Vec::new();
    for change in changes {
        let Some(state_summary) = trimmed_text(change.get("stateSummary"), MAX_FIELD_CHARS) else {
            continue;
        };
        let character_id = if coverage_required {
            match resolve_covered_character_id(connection, &input.novel_id, &change)? {
                ResolvedCharacter::Found(character_id) => character_id,
                ResolvedCharacter::Unresolved => {
                    return Ok(CharacterStatesOutcome::Conflict(
                        CHARACTER_REFERENCE_CONFLICT,
                    ))
                }
            }
        } else {
            let Some(character_id) =
                resolve_legacy_character_id(connection, &input.novel_id, &change)?
            else {
                continue;
            };
            character_id
        };
        if !seen.insert(character_id.clone()) {
            continue;
        }
        let id =
            existing_character_state_id(connection, &input.novel_id, chapter_id, &character_id)?
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        states.push(SaveCharacterStateInput {
            id: Some(id),
            novel_id: input.novel_id.clone(),
            character_id,
            chapter_id: Some(chapter_id.to_string()),
            state_summary,
            relationship_changes: stored_field(&change, "relationshipChanges"),
            goal_changes: stored_field(&change, "goalChanges"),
            location: stored_field(&change, "location"),
            health_state: stored_field(&change, "healthState"),
            knowledge_state: stored_field(&change, "knowledgeState"),
        });
    }
    Ok(CharacterStatesOutcome::Ready(states))
}

/// Deterministic resolver for the versioned coverage contract.
///
/// An ID reference must hit an active character of the same novel. A name-only
/// reference must hit exactly one active character of the same novel. When both are
/// declared, the ID selects and the name is a consistency check. No protagonist
/// preference, fallback lookup, or first-row pick is allowed here.
fn resolve_covered_character_id(
    connection: &Connection,
    novel_id: &str,
    change: &Map<String, Value>,
) -> Result<ResolvedCharacter, AppError> {
    let id_value = change.get("characterId");
    let declared_raw_id = non_empty_text(id_value);
    let declared_id = trimmed_text(id_value, MAX_NAME_CHARS);
    if declared_raw_id && declared_id.is_none() {
        return Ok(ResolvedCharacter::Unresolved);
    }
    // `characterName` wins over `name`, but every declared value that cannot be
    // used (for example an over-long string) must fail closed instead of being
    // silently ignored.
    for key in ["characterName", "name"] {
        if non_empty_text(change.get(key))
            && trimmed_text(change.get(key), MAX_NAME_CHARS).is_none()
        {
            return Ok(ResolvedCharacter::Unresolved);
        }
    }
    let declared_name = trimmed_text(change.get("characterName"), MAX_NAME_CHARS)
        .or_else(|| trimmed_text(change.get("name"), MAX_NAME_CHARS));
    if let Some(character_id) = declared_id {
        let Some(character) = active_character_by_id(connection, novel_id, &character_id)? else {
            return Ok(ResolvedCharacter::Unresolved);
        };
        if declared_name.is_some_and(|name| name != character.name) {
            return Ok(ResolvedCharacter::Unresolved);
        }
        return Ok(ResolvedCharacter::Found(character.id));
    }
    let Some(name) = declared_name else {
        return Ok(ResolvedCharacter::Unresolved);
    };
    let mut matches = active_characters_by_name(connection, novel_id, &name)?;
    if matches.len() != 1 {
        return Ok(ResolvedCharacter::Unresolved);
    }
    Ok(ResolvedCharacter::Found(matches.remove(0).id))
}

/// Best-effort resolver preserved for historical candidates without the coverage
/// marker: missing, inactive, cross-novel, or ambiguous references are skipped, and
/// name-only resolution keeps its protagonist-first ordering.
fn resolve_legacy_character_id(
    connection: &Connection,
    novel_id: &str,
    object: &Map<String, Value>,
) -> Result<Option<String>, AppError> {
    if let Some(character_id) = trimmed_text(object.get("characterId"), MAX_NAME_CHARS) {
        return connection
            .query_row(
                "SELECT id FROM characters
                 WHERE id=?1 AND novel_id=?2 AND is_active=1 LIMIT 1",
                params![character_id, novel_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::database);
    }
    let Some(name) = trimmed_text(
        object.get("characterName").or_else(|| object.get("name")),
        MAX_NAME_CHARS,
    ) else {
        return Ok(None);
    };
    connection
        .query_row(
            "SELECT id FROM characters
             WHERE novel_id=?1 AND name=?2 AND is_active=1
             ORDER BY is_protagonist DESC, protagonist_order, created_at, id LIMIT 1",
            params![novel_id, name],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)
}

fn non_empty_text(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|text| !text.trim().is_empty())
}

fn active_character_by_id(
    connection: &Connection,
    novel_id: &str,
    character_id: &str,
) -> Result<Option<ActiveCharacter>, AppError> {
    connection
        .query_row(
            "SELECT id,name FROM characters
             WHERE id=?1 AND novel_id=?2 AND is_active=1 LIMIT 1",
            params![character_id, novel_id],
            |row| {
                Ok(ActiveCharacter {
                    id: row.get(0)?,
                    name: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(AppError::database)
}

fn active_characters_by_name(
    connection: &Connection,
    novel_id: &str,
    name: &str,
) -> Result<Vec<ActiveCharacter>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT id,name FROM characters
             WHERE novel_id=?1 AND name=?2 AND is_active=1
             ORDER BY id LIMIT 2",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![novel_id, name], |row| {
            Ok(ActiveCharacter {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(AppError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

fn existing_character_state_id(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
    character_id: &str,
) -> Result<Option<String>, AppError> {
    connection
        .query_row(
            "SELECT id FROM character_states
             WHERE novel_id=?1 AND chapter_id=?2 AND character_id=?3
             ORDER BY created_at DESC, id DESC LIMIT 1",
            params![novel_id, chapter_id, character_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)
}
