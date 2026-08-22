use crate::domain::ai::{
    LegacyChapterSummaryInput, LegacyCharacterStateInput, LegacyContextRecordInput,
    MigrateLegacyChapterContextInput, MigrateLegacyChapterContextResult,
};
use crate::repositories::chapter_summary_repository::{
    chapter_summary_select_sql, map_chapter_summary_row, upsert_chapter_summary,
};
use crate::repositories::character_state_repository::{
    character_state_select_sql, map_character_state_row,
};
use crate::repositories::context_record_repository::{
    context_record_select_sql, map_context_record_row,
};
use crate::services::chapter_summary_service::{validate_summary_ownership, validate_uuid};
use crate::services::context_record_service::validate_context_record_input;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::collections::HashSet;

fn migration_timestamp(value: Option<&str>, fallback: &str) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn table_has_id(conn: &Connection, table: &str, id: &str) -> Result<bool, String> {
    let sql = match table {
        "chapter_summaries" => "SELECT EXISTS(SELECT 1 FROM chapter_summaries WHERE id = ?1)",
        "context_records" => "SELECT EXISTS(SELECT 1 FROM context_records WHERE id = ?1)",
        "character_states" => "SELECT EXISTS(SELECT 1 FROM character_states WHERE id = ?1)",
        _ => return Err("legacy_migration_unknown_table".to_string()),
    };
    conn.query_row(sql, params![id], |row| row.get::<_, bool>(0))
        .map_err(|error| format!("legacy_migration_id_read_failed: {error}"))
}

fn choose_migration_id(
    conn: &Connection,
    table: &str,
    source_id: Option<&str>,
) -> Result<String, String> {
    if let Some(source_id) = source_id {
        if uuid::Uuid::parse_str(source_id).is_ok() && !table_has_id(conn, table, source_id)? {
            return Ok(source_id.to_string());
        }
    }
    Ok(uuid::Uuid::new_v4().to_string())
}

fn select_legacy_candidate(
    candidates: Vec<(String, String, String)>,
    source_id: Option<&str>,
    created_at: Option<&str>,
    updated_at: Option<&str>,
) -> Result<Option<String>, ()> {
    if let Some(source_id) = source_id {
        if let Some(candidate) = candidates.iter().find(|candidate| candidate.0 == source_id) {
            return Ok(Some(candidate.0.clone()));
        }
    }
    match candidates.len() {
        0 => Ok(None),
        1 => Ok(Some(candidates[0].0.clone())),
        _ => {
            let mut matched_candidates = Vec::new();
            if let Some(created_at) = created_at {
                matched_candidates.extend(
                    candidates
                        .iter()
                        .filter(|candidate| candidate.1 == created_at)
                        .map(|candidate| candidate.0.clone()),
                );
            }
            if let Some(updated_at) = updated_at {
                matched_candidates.extend(
                    candidates
                        .iter()
                        .filter(|candidate| candidate.2 == updated_at)
                        .map(|candidate| candidate.0.clone()),
                );
            }
            matched_candidates.sort();
            matched_candidates.dedup();
            if matched_candidates.len() == 1 {
                Ok(Some(matched_candidates.remove(0)))
            } else {
                Err(())
            }
        }
    }
}

fn legacy_summary_matches(
    dto: &crate::domain::context::ChapterSummaryDto,
    input: &LegacyChapterSummaryInput,
) -> bool {
    dto.novel_id == input.data.novel_id
        && dto.chapter_id == input.data.chapter_id
        && dto.volume_id == input.data.volume_id
        && dto.adopted_draft_id == input.data.adopted_draft_id
        && dto.summary == input.data.summary
        && dto.key_events == input.data.key_events
        && dto.character_changes == input.data.character_changes
        && dto.relationship_changes == input.data.relationship_changes
        && dto.new_foreshadows == input.data.new_foreshadows
        && dto.resolved_foreshadows == input.data.resolved_foreshadows
        && dto.next_chapter_hints == input.data.next_chapter_hints
        && dto.core_events == input.data.core_events
        && dto.protagonist_state_change == input.data.protagonist_state_change
        && dto.important_character_changes == input.data.important_character_changes
        && dto.setting_changes == input.data.setting_changes
        && dto.new_locations == input.data.new_locations
        && dto.new_items_or_abilities == input.data.new_items_or_abilities
        && dto.foreshadowing == input.data.foreshadowing
        && dto.unresolved_questions == input.data.unresolved_questions
        && dto.facts_must_remember == input.data.facts_must_remember
        && dto.next_chapter_hook == input.data.next_chapter_hook
        && dto.validation_status == input.data.validation_status
        && dto.validation_result == input.data.validation_result
        && dto.enabled == input.data.enabled.unwrap_or(true)
        && dto.content_hash == input.data.content_hash
        && dto.draft_version == input.data.draft_version
        && dto.is_expired == input.is_expired.unwrap_or(false)
        && dto.ai_task_id == input.data.ai_task_id
}

fn load_summary_candidates(
    conn: &Connection,
    item: &LegacyChapterSummaryInput,
) -> Result<Vec<(String, String, String)>, String> {
    let sql = format!(
        "{} WHERE novel_id = ?1 AND chapter_id = ?2",
        chapter_summary_select_sql()
    );
    let mut statement = conn
        .prepare(&sql)
        .map_err(|error| format!("legacy_summary_candidate_prepare_failed: {error}"))?;
    let candidates = statement
        .query_map(
            params![&item.data.novel_id, &item.data.chapter_id],
            map_chapter_summary_row,
        )
        .map_err(|error| format!("legacy_summary_candidate_query_failed: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("legacy_summary_candidate_decode_failed: {error}"))?;

    Ok(candidates
        .into_iter()
        .filter(|dto| legacy_summary_matches(dto, item))
        .map(|dto| (dto.id, dto.created_at, dto.updated_at))
        .collect())
}

fn legacy_context_record_matches(
    dto: &crate::domain::context::ContextRecordDto,
    item: &LegacyContextRecordInput,
) -> bool {
    dto.novel_id == item.data.novel_id
        && dto.chapter_id == item.data.chapter_id
        && dto.volume_id == item.data.volume_id
        && dto.context_type == item.data.context_type
        && dto.title == item.data.title
        && dto.content == item.data.content
        && dto.importance == item.data.importance.unwrap_or(3)
        && dto.is_active == item.data.is_active.unwrap_or(true)
        && dto.is_expired == item.is_expired.unwrap_or(false)
        && dto.content_hash == item.data.content_hash
        && dto.draft_version == item.data.draft_version
}

fn load_context_record_candidates(
    conn: &Connection,
    item: &LegacyContextRecordInput,
) -> Result<Vec<(String, String, String)>, String> {
    let sql = format!(
        "{} WHERE novel_id = ?1 AND context_type = ?2 AND title = ?3 AND content = ?4",
        context_record_select_sql()
    );
    let mut statement = conn
        .prepare(&sql)
        .map_err(|error| format!("legacy_context_record_candidate_prepare_failed: {error}"))?;
    let candidates = statement
        .query_map(
            params![
                &item.data.novel_id,
                &item.data.context_type,
                &item.data.title,
                &item.data.content
            ],
            map_context_record_row,
        )
        .map_err(|error| format!("legacy_context_record_candidate_query_failed: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("legacy_context_record_candidate_decode_failed: {error}"))?;

    Ok(candidates
        .into_iter()
        .filter(|dto| legacy_context_record_matches(dto, item))
        .map(|dto| (dto.id, dto.created_at, dto.updated_at))
        .collect())
}

fn legacy_character_state_matches(
    dto: &crate::domain::context::CharacterStateDto,
    item: &LegacyCharacterStateInput,
) -> bool {
    dto.novel_id == item.data.novel_id
        && dto.character_id == item.data.character_id
        && dto.chapter_id == item.data.chapter_id
        && dto.state_summary == item.data.state_summary
        && dto.relationship_changes == item.data.relationship_changes
        && dto.goal_changes == item.data.goal_changes
        && dto.location == item.data.location
        && dto.health_state == item.data.health_state
        && dto.knowledge_state == item.data.knowledge_state
}

fn load_character_state_candidates(
    conn: &Connection,
    item: &LegacyCharacterStateInput,
) -> Result<Vec<(String, String, String)>, String> {
    let sql = format!(
        "{} WHERE novel_id = ?1 AND character_id = ?2",
        character_state_select_sql()
    );
    let mut statement = conn
        .prepare(&sql)
        .map_err(|error| format!("legacy_character_state_candidate_prepare_failed: {error}"))?;
    let candidates = statement
        .query_map(
            params![&item.data.novel_id, &item.data.character_id],
            map_character_state_row,
        )
        .map_err(|error| format!("legacy_character_state_candidate_query_failed: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("legacy_character_state_candidate_decode_failed: {error}"))?;

    Ok(candidates
        .into_iter()
        .filter(|dto| legacy_character_state_matches(dto, item))
        .map(|dto| (dto.id.clone(), dto.created_at.clone(), dto.created_at))
        .collect())
}

fn push_migration_warning(
    result: &mut MigrateLegacyChapterContextResult,
    entity: &str,
    index: usize,
    source_id: Option<&str>,
    reason: &str,
) {
    let identifier = source_id
        .map(|id| format!("id={id}"))
        .unwrap_or_else(|| format!("index={index}"));
    result
        .warnings
        .push(format!("{entity} skipped ({identifier}): {reason}"));
}

pub fn migrate_legacy_chapter_context(
    conn: &mut Connection,
    input: &MigrateLegacyChapterContextInput,
) -> Result<MigrateLegacyChapterContextResult, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("legacy_context_transaction_failed: {error}"))?;
    let mut result = MigrateLegacyChapterContextResult::default();
    let mut affected_characters: HashSet<(String, String)> = HashSet::new();

    for (index, item) in input.chapter_summaries.iter().enumerate() {
        let source_id = item.data.id.as_deref();
        let mut validation = item.data.clone();
        validation.id = None;
        if let Err(error) = validate_summary_ownership(&transaction, &validation, false) {
            result.chapter_summaries.skipped += 1;
            push_migration_warning(&mut result, "chapterSummaries", index, source_id, &error);
            continue;
        }
        let candidates = load_summary_candidates(&transaction, item)?;
        match select_legacy_candidate(
            candidates,
            source_id,
            item.created_at.as_deref(),
            item.updated_at.as_deref(),
        ) {
            Ok(Some(id)) => {
                result.chapter_summaries.matched += 1;
                if let Some(source_id) = source_id {
                    result.id_map.insert(source_id.to_string(), id);
                }
            }
            Err(()) => {
                result.chapter_summaries.skipped += 1;
                push_migration_warning(
                    &mut result,
                    "chapterSummaries",
                    index,
                    source_id,
                    "ambiguous_fingerprint_and_timestamps",
                );
            }
            Ok(None) => {
                let id = choose_migration_id(&transaction, "chapter_summaries", source_id)?;
                let created_at = migration_timestamp(item.created_at.as_deref(), &now);
                let updated_at = migration_timestamp(item.updated_at.as_deref(), &created_at);
                upsert_chapter_summary(
                    &transaction,
                    &id,
                    &item.data,
                    item.is_expired.unwrap_or(false),
                    &created_at,
                    &updated_at,
                )?;
                result.chapter_summaries.inserted += 1;
                if let Some(source_id) = source_id {
                    result.id_map.insert(source_id.to_string(), id);
                }
            }
        }
    }

    for (index, item) in input.context_records.iter().enumerate() {
        let source_id = item.data.id.as_deref();
        let mut validation = item.data.clone();
        validation.id = None;
        if let Err(error) = validate_context_record_input(&transaction, &validation) {
            result.context_records.skipped += 1;
            push_migration_warning(&mut result, "contextRecords", index, source_id, &error);
            continue;
        }
        let candidates = load_context_record_candidates(&transaction, item)?;
        match select_legacy_candidate(
            candidates,
            source_id,
            item.created_at.as_deref(),
            item.updated_at.as_deref(),
        ) {
            Ok(Some(id)) => {
                result.context_records.matched += 1;
                if let Some(source_id) = source_id {
                    result.id_map.insert(source_id.to_string(), id);
                }
            }
            Err(()) => {
                result.context_records.skipped += 1;
                push_migration_warning(
                    &mut result,
                    "contextRecords",
                    index,
                    source_id,
                    "ambiguous_fingerprint_and_timestamps",
                );
            }
            Ok(None) => {
                let id = choose_migration_id(&transaction, "context_records", source_id)?;
                let created_at = migration_timestamp(item.created_at.as_deref(), &now);
                let updated_at = migration_timestamp(item.updated_at.as_deref(), &created_at);
                transaction
                    .execute(
                        "INSERT INTO context_records
                     (id, novel_id, chapter_id, volume_id, context_type, title,
                      content, importance, is_active, is_expired, content_hash,
                      draft_version, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                        params![
                            &id,
                            &item.data.novel_id,
                            &item.data.chapter_id,
                            &item.data.volume_id,
                            &item.data.context_type,
                            &item.data.title,
                            &item.data.content,
                            item.data.importance.unwrap_or(3),
                            if item.data.is_active.unwrap_or(true) {
                                1
                            } else {
                                0
                            },
                            if item.is_expired.unwrap_or(false) {
                                1
                            } else {
                                0
                            },
                            &item.data.content_hash,
                            item.data.draft_version,
                            &created_at,
                            &updated_at,
                        ],
                    )
                    .map_err(|error| format!("legacy_context_record_insert_failed: {error}"))?;
                result.context_records.inserted += 1;
                if let Some(source_id) = source_id {
                    result.id_map.insert(source_id.to_string(), id);
                }
            }
        }
    }

    for (index, item) in input.character_states.iter().enumerate() {
        let source_id = item.data.id.as_deref();
        let validation = item.data.clone();
        let ownership_result = (|| -> Result<(), String> {
            validate_uuid("character_state_novel_id", &validation.novel_id)?;
            validate_uuid("character_state_character_id", &validation.character_id)?;
            if let Some(chapter_id) = validation.chapter_id.as_deref() {
                validate_uuid("character_state_chapter_id", chapter_id)?;
            }
            let character_exists = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM characters
                     WHERE id = ?1 AND novel_id = ?2)",
                    params![&validation.character_id, &validation.novel_id],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(|error| format!("legacy_character_ownership_read_failed: {error}"))?;
            if !character_exists {
                return Err("character_state_character_ownership_mismatch".to_string());
            }
            if let Some(chapter_id) = validation.chapter_id.as_deref() {
                let chapter_exists = transaction
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM chapters
                         WHERE id = ?1 AND novel_id = ?2)",
                        params![chapter_id, &validation.novel_id],
                        |row| row.get::<_, bool>(0),
                    )
                    .map_err(|error| format!("legacy_character_chapter_read_failed: {error}"))?;
                if !chapter_exists {
                    return Err("character_state_chapter_ownership_mismatch".to_string());
                }
            }
            if validation.state_summary.trim().is_empty() {
                return Err("character_state_summary_required".to_string());
            }
            Ok(())
        })();
        if let Err(error) = ownership_result {
            result.character_states.skipped += 1;
            push_migration_warning(&mut result, "characterStates", index, source_id, &error);
            continue;
        }
        let candidates = load_character_state_candidates(&transaction, item)?;
        let reconciled = match select_legacy_candidate(
            candidates,
            source_id,
            item.created_at.as_deref(),
            item.created_at.as_deref(),
        ) {
            Ok(Some(id)) => {
                result.character_states.matched += 1;
                if let Some(source_id) = source_id {
                    result.id_map.insert(source_id.to_string(), id);
                }
                true
            }
            Err(()) => {
                result.character_states.skipped += 1;
                push_migration_warning(
                    &mut result,
                    "characterStates",
                    index,
                    source_id,
                    "ambiguous_fingerprint_and_timestamps",
                );
                false
            }

            Ok(None) => {
                let id = choose_migration_id(&transaction, "character_states", source_id)?;
                let created_at = migration_timestamp(item.created_at.as_deref(), &now);
                transaction
                    .execute(
                        "INSERT INTO character_states
                     (id, novel_id, character_id, chapter_id, state_summary,
                      relationship_changes, goal_changes, location, health_state,
                      knowledge_state, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                        params![
                            &id,
                            &item.data.novel_id,
                            &item.data.character_id,
                            &item.data.chapter_id,
                            &item.data.state_summary,
                            &item.data.relationship_changes,
                            &item.data.goal_changes,
                            &item.data.location,
                            &item.data.health_state,
                            &item.data.knowledge_state,
                            &created_at,
                        ],
                    )
                    .map_err(|error| format!("legacy_character_state_insert_failed: {error}"))?;
                result.character_states.inserted += 1;
                if let Some(source_id) = source_id {
                    result.id_map.insert(source_id.to_string(), id);
                }
                true
            }
        };
        if reconciled {
            affected_characters
                .insert((item.data.novel_id.clone(), item.data.character_id.clone()));
        }
    }

    let mut affected_characters: Vec<_> = affected_characters.into_iter().collect();
    affected_characters.sort();
    for (novel_id, character_id) in affected_characters {
        let latest_state = transaction
            .query_row(
                "SELECT state_summary FROM character_states
                 WHERE novel_id = ?1 AND character_id = ?2
                 ORDER BY created_at DESC, id DESC LIMIT 1",
                params![&novel_id, &character_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("legacy_character_latest_state_read_failed: {error}"))?
            .ok_or_else(|| "legacy_character_latest_state_missing".to_string())?;
        let affected = transaction
            .execute(
                "UPDATE characters SET current_state = ?1, updated_at = ?2
                 WHERE id = ?3 AND novel_id = ?4",
                params![&latest_state, &now, &character_id, &novel_id],
            )
            .map_err(|error| format!("legacy_character_current_state_update_failed: {error}"))?;
        if affected != 1 {
            return Err("legacy_character_current_state_update_conflict".to_string());
        }
    }

    transaction
        .commit()
        .map_err(|error| format!("legacy_context_commit_failed: {error}"))?;
    Ok(result)
}
