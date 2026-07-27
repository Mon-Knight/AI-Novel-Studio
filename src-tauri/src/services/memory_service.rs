use crate::domain::memory::{
    MemorySourceType, MEMORY_COMPILER_ID, MEMORY_COMPILER_VERSION, MEMORY_CONTRACT_VERSION,
    MEMORY_KIND,
};
use crate::errors::{codes, AppError};
use crate::repositories::memory_repository::{self, MemorySnapshotBundle, MemorySnapshotRecord};
use crate::services::ai_fact_security;
use chrono::Utc;
use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

const DEFAULT_LOOKBACK_CHAPTERS: i64 = 20;
const DEFAULT_BUDGET_BYTES: i64 = 65_536;
const MIN_BUDGET_BYTES: i64 = 4_096;
const MAX_BUDGET_BYTES: i64 = 262_144;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMemorySnapshotInput {
    pub operation_id: String,
    pub novel_id: String,
    pub target_chapter_id: String,
    pub lookback_chapters: Option<i64>,
    pub budget_bytes: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemorySourceDrift {
    pub source_type: String,
    pub source_id: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnapshotVerification {
    pub snapshot_id: String,
    pub valid: bool,
    pub request_hash_valid: bool,
    pub stored_manifest_valid: bool,
    pub stored_memory_valid: bool,
    pub recompiled_manifest_hash: String,
    pub recompiled_memory_hash: String,
    pub drift: Vec<MemorySourceDrift>,
}

#[derive(Debug, Clone)]
struct ChapterPosition {
    id: String,
    rank: i64,
}

#[derive(Debug, Clone)]
struct MemoryCandidate {
    source_type: MemorySourceType,
    source_id: String,
    novel_id: String,
    chapter_id: Option<String>,
    chapter_rank: Option<i64>,
    source_version: String,
    source_hash: String,
    importance: i64,
    data: Value,
    included: bool,
    omission_reason: Option<String>,
}

#[derive(Debug, Clone)]
struct CompiledMemory {
    target_chapter_rank: i64,
    candidates: Vec<MemoryCandidate>,
    source_manifest: Value,
    source_manifest_hash: String,
    memory: Value,
    memory_hash: String,
    memory_bytes: i64,
    included_count: i64,
    omitted_count: i64,
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::new(codes::MEMORY_INPUT_INVALID, message, false)
}

fn not_found() -> AppError {
    AppError::new(codes::MEMORY_SNAPSHOT_NOT_FOUND, "Memory Snapshot 不存在", false)
}

fn validate_identifier(value: &str, label: &str) -> Result<(), AppError> {
    ai_fact_security::validate_identifier(value, label, 160)
        .map_err(|_| invalid(format!("{label} 无效")))
}

fn normalized_limits(input: &CreateMemorySnapshotInput) -> Result<(i64, i64), AppError> {
    let lookback = input.lookback_chapters.unwrap_or(DEFAULT_LOOKBACK_CHAPTERS);
    let budget = input.budget_bytes.unwrap_or(DEFAULT_BUDGET_BYTES);
    if !(1..=100).contains(&lookback) {
        return Err(invalid("lookbackChapters 必须在 1 到 100 之间"));
    }
    if !(MIN_BUDGET_BYTES..=MAX_BUDGET_BYTES).contains(&budget) {
        return Err(invalid("budgetBytes 必须在 4096 到 262144 之间"));
    }
    Ok((lookback, budget))
}

fn request_value(
    novel_id: &str,
    target_chapter_id: &str,
    lookback_chapters: i64,
    budget_bytes: i64,
) -> Value {
    serde_json::json!({
        "contractVersion": MEMORY_CONTRACT_VERSION,
        "memoryKind": MEMORY_KIND,
        "compilerId": MEMORY_COMPILER_ID,
        "compilerVersion": MEMORY_COMPILER_VERSION,
        "novelId": novel_id,
        "targetChapterId": target_chapter_id,
        "lookbackChapters": lookback_chapters,
        "budgetBytes": budget_bytes,
    })
}

fn chapter_positions(
    connection: &Connection,
    novel_id: &str,
) -> Result<Vec<ChapterPosition>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT c.id
             FROM chapters c
             LEFT JOIN volumes v ON v.id=c.volume_id AND v.novel_id=c.novel_id
             WHERE c.novel_id=?1 AND c.deleted_at IS NULL
             ORDER BY COALESCE(v.order_index, -1) ASC, COALESCE(c.volume_id, '') ASC,
                      c.order_index ASC, c.id ASC",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![novel_id], |row| row.get::<_, String>(0))
        .map_err(AppError::database)?
        .enumerate()
        .map(|(index, row)| {
            row.map(|id| ChapterPosition {
                id,
                rank: (index + 1) as i64,
            })
            .map_err(AppError::database)
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn hash_source(
    source_type: MemorySourceType,
    source_id: &str,
    chapter_id: Option<&str>,
    source_version: &str,
    data: &Value,
) -> Result<String, AppError> {
    ai_fact_security::canonical_hash(&serde_json::json!({
        "sourceType": source_type.as_str(),
        "sourceId": source_id,
        "chapterId": chapter_id,
        "sourceVersion": source_version,
        "data": data,
    }))
}

fn ensure_safe_source(data: &Value) -> Result<(), AppError> {
    if ai_fact_security::contains_secret_value(data) {
        return Err(AppError::new(
            codes::MEMORY_SOURCE_INVALID,
            "连续性来源包含疑似凭据，不能进入 Memory Snapshot",
            false,
        ));
    }
    Ok(())
}

fn load_summary_candidates(
    connection: &Connection,
    novel_id: &str,
    allowed_chapters: &HashMap<String, i64>,
) -> Result<Vec<MemoryCandidate>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT s.id, s.chapter_id, s.adopted_draft_id, s.summary, s.key_events,
                    s.character_changes, s.relationship_changes, s.new_foreshadows,
                    s.resolved_foreshadows, s.next_chapter_hints, s.core_events,
                    s.protagonist_state_change, s.important_character_changes,
                    s.setting_changes, s.new_locations, s.new_items_or_abilities,
                    s.foreshadowing, s.unresolved_questions, s.facts_must_remember,
                    s.next_chapter_hook, s.validation_status, s.draft_version,
                    s.created_at, s.updated_at
             FROM chapter_summaries s
             JOIN chapters c ON c.id=s.chapter_id AND c.novel_id=s.novel_id
             WHERE s.novel_id=?1 AND s.enabled=1 AND s.is_expired=0
               AND c.deleted_at IS NULL AND c.adopted_draft_id=s.adopted_draft_id
             ORDER BY s.updated_at DESC, s.created_at DESC, s.id DESC",
        )
        .map_err(AppError::database)?;
    let mut seen_chapters = HashSet::new();
    let rows = statement
        .query_map(params![novel_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, Option<String>>(12)?,
                row.get::<_, Option<String>>(13)?,
                row.get::<_, Option<String>>(14)?,
                row.get::<_, Option<String>>(15)?,
                row.get::<_, Option<String>>(16)?,
                row.get::<_, Option<String>>(17)?,
                row.get::<_, Option<String>>(18)?,
                row.get::<_, Option<String>>(19)?,
                row.get::<_, Option<String>>(20)?,
                row.get::<_, Option<i64>>(21)?,
                row.get::<_, String>(22)?,
                row.get::<_, String>(23)?,
            ))
        })
        .map_err(AppError::database)?;
    let mut candidates = Vec::new();
    for row in rows {
        let (
            id,
            chapter_id,
            adopted_draft_id,
            summary,
            key_events,
            character_changes,
            relationship_changes,
            new_foreshadows,
            resolved_foreshadows,
            next_chapter_hints,
            core_events,
            protagonist_state_change,
            important_character_changes,
            setting_changes,
            new_locations,
            new_items_or_abilities,
            foreshadowing,
            unresolved_questions,
            facts_must_remember,
            next_chapter_hook,
            validation_status,
            draft_version,
            created_at,
            updated_at,
        ) = row.map_err(AppError::database)?;
        let Some(chapter_rank) = allowed_chapters.get(&chapter_id).copied() else {
            continue;
        };
        if !seen_chapters.insert(chapter_id.clone()) {
            continue;
        }
        let data = serde_json::json!({
            "adoptedDraftId": adopted_draft_id,
            "summary": summary,
            "keyEvents": key_events,
            "characterChanges": character_changes,
            "relationshipChanges": relationship_changes,
            "newForeshadows": new_foreshadows,
            "resolvedForeshadows": resolved_foreshadows,
            "nextChapterHints": next_chapter_hints,
            "coreEvents": core_events,
            "protagonistStateChange": protagonist_state_change,
            "importantCharacterChanges": important_character_changes,
            "settingChanges": setting_changes,
            "newLocations": new_locations,
            "newItemsOrAbilities": new_items_or_abilities,
            "foreshadowing": foreshadowing,
            "unresolvedQuestions": unresolved_questions,
            "factsMustRemember": facts_must_remember,
            "nextChapterHook": next_chapter_hook,
            "validationStatus": validation_status,
            "draftVersion": draft_version,
            "createdAt": created_at,
            "updatedAt": updated_at,
        });
        ensure_safe_source(&data)?;
        let source_hash = hash_source(
            MemorySourceType::ChapterSummary,
            &id,
            Some(&chapter_id),
            &updated_at,
            &data,
        )?;
        candidates.push(MemoryCandidate {
            source_type: MemorySourceType::ChapterSummary,
            source_id: id,
            novel_id: novel_id.to_string(),
            chapter_id: Some(chapter_id),
            chapter_rank: Some(chapter_rank),
            source_version: updated_at,
            source_hash,
            importance: 5,
            data,
            included: false,
            omission_reason: None,
        });
    }
    Ok(candidates)
}

fn load_context_candidates(
    connection: &Connection,
    novel_id: &str,
    allowed_chapters: &HashMap<String, i64>,
) -> Result<Vec<MemoryCandidate>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT id, chapter_id, context_type, title, content, importance,
                    content_hash, draft_version, created_at, updated_at
             FROM context_records
             WHERE novel_id=?1 AND is_active=1 AND is_expired=0
             ORDER BY importance DESC, updated_at DESC, created_at DESC, id DESC",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![novel_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<i64>>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
            ))
        })
        .map_err(AppError::database)?;
    let mut candidates = Vec::new();
    for row in rows {
        let (
            id,
            chapter_id,
            context_type,
            title,
            content,
            importance,
            content_hash,
            draft_version,
            created_at,
            updated_at,
        ) = row.map_err(AppError::database)?;
        let chapter_rank = match chapter_id.as_ref() {
            Some(id) => match allowed_chapters.get(id).copied() {
                Some(rank) => Some(rank),
                None => continue,
            },
            None => None,
        };
        let data = serde_json::json!({
            "contextType": context_type,
            "title": title,
            "content": content,
            "importance": importance,
            "declaredContentHash": content_hash,
            "draftVersion": draft_version,
            "createdAt": created_at,
            "updatedAt": updated_at,
        });
        ensure_safe_source(&data)?;
        let source_hash = hash_source(
            MemorySourceType::ContextRecord,
            &id,
            chapter_id.as_deref(),
            &updated_at,
            &data,
        )?;
        candidates.push(MemoryCandidate {
            source_type: MemorySourceType::ContextRecord,
            source_id: id,
            novel_id: novel_id.to_string(),
            chapter_id,
            chapter_rank,
            source_version: updated_at,
            source_hash,
            importance,
            data,
            included: false,
            omission_reason: None,
        });
    }
    Ok(candidates)
}

fn load_character_state_candidates(
    connection: &Connection,
    novel_id: &str,
    allowed_chapters: &HashMap<String, i64>,
) -> Result<Vec<MemoryCandidate>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT s.id, s.character_id, s.chapter_id, c.name, s.state_summary,
                    s.relationship_changes, s.goal_changes, s.location, s.health_state,
                    s.knowledge_state, s.created_at
             FROM character_states s
             JOIN characters c ON c.id=s.character_id AND c.novel_id=s.novel_id
             WHERE s.novel_id=?1 AND c.is_active=1
             ORDER BY s.created_at DESC, s.id DESC",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![novel_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, String>(10)?,
            ))
        })
        .map_err(AppError::database)?;
    let mut candidates = Vec::new();
    for row in rows {
        let (
            id,
            character_id,
            chapter_id,
            character_name,
            state_summary,
            relationship_changes,
            goal_changes,
            location,
            health_state,
            knowledge_state,
            created_at,
        ) = row.map_err(AppError::database)?;
        let chapter_rank = match chapter_id.as_ref() {
            Some(id) => match allowed_chapters.get(id).copied() {
                Some(rank) => Some(rank),
                None => continue,
            },
            None => None,
        };
        let data = serde_json::json!({
            "characterId": character_id,
            "characterName": character_name,
            "stateSummary": state_summary,
            "relationshipChanges": relationship_changes,
            "goalChanges": goal_changes,
            "location": location,
            "healthState": health_state,
            "knowledgeState": knowledge_state,
            "createdAt": created_at,
        });
        ensure_safe_source(&data)?;
        let source_hash = hash_source(
            MemorySourceType::CharacterState,
            &id,
            chapter_id.as_deref(),
            &created_at,
            &data,
        )?;
        candidates.push(MemoryCandidate {
            source_type: MemorySourceType::CharacterState,
            source_id: id,
            novel_id: novel_id.to_string(),
            chapter_id,
            chapter_rank,
            source_version: created_at,
            source_hash,
            importance: 4,
            data,
            included: false,
            omission_reason: None,
        });
    }
    Ok(candidates)
}

fn source_type_priority(source_type: MemorySourceType) -> i64 {
    match source_type {
        MemorySourceType::ChapterSummary => 0,
        MemorySourceType::ContextRecord => 1,
        MemorySourceType::CharacterState => 2,
    }
}

fn memory_item(candidate: &MemoryCandidate) -> Value {
    serde_json::json!({
        "sourceType": candidate.source_type.as_str(),
        "sourceId": candidate.source_id,
        "chapterId": candidate.chapter_id,
        "chapterRank": candidate.chapter_rank,
        "sourceVersion": candidate.source_version,
        "sourceHash": candidate.source_hash,
        "data": candidate.data,
    })
}

fn manifest_entry(candidate: &MemoryCandidate, ordinal: i64) -> Value {
    serde_json::json!({
        "ordinal": ordinal,
        "sourceType": candidate.source_type.as_str(),
        "sourceId": candidate.source_id,
        "novelId": candidate.novel_id,
        "chapterId": candidate.chapter_id,
        "chapterRank": candidate.chapter_rank,
        "sourceVersion": candidate.source_version,
        "sourceHash": candidate.source_hash,
        "included": candidate.included,
        "omissionReason": candidate.omission_reason,
    })
}

fn memory_value(
    novel_id: &str,
    target_chapter_id: &str,
    target_chapter_rank: i64,
    lookback_chapters: i64,
    budget_bytes: i64,
    candidate_count: usize,
    items: &[Value],
) -> Value {
    serde_json::json!({
        "schemaVersion": 1,
        "kind": MEMORY_KIND,
        "compiler": {
            "id": MEMORY_COMPILER_ID,
            "version": MEMORY_COMPILER_VERSION,
        },
        "novelId": novel_id,
        "targetChapterId": target_chapter_id,
        "targetChapterRank": target_chapter_rank,
        "lookbackChapters": lookback_chapters,
        "budgetBytes": budget_bytes,
        "stats": {
            "candidateCount": candidate_count,
            "includedCount": items.len(),
            "omittedCount": candidate_count.saturating_sub(items.len()),
        },
        "items": items,
    })
}

fn compile_memory(
    connection: &Connection,
    novel_id: &str,
    target_chapter_id: &str,
    lookback_chapters: i64,
    budget_bytes: i64,
) -> Result<CompiledMemory, AppError> {
    let positions = chapter_positions(connection, novel_id)?;
    let target_index = positions
        .iter()
        .position(|position| position.id == target_chapter_id)
        .ok_or_else(|| invalid("目标章节不存在或不属于指定作品"))?;
    let target_rank = positions[target_index].rank;
    let start = target_index.saturating_sub(lookback_chapters as usize);
    let allowed_chapters = positions[start..target_index]
        .iter()
        .map(|position| (position.id.clone(), position.rank))
        .collect::<HashMap<_, _>>();

    let mut candidates = load_summary_candidates(connection, novel_id, &allowed_chapters)?;
    candidates.extend(load_context_candidates(
        connection,
        novel_id,
        &allowed_chapters,
    )?);
    candidates.extend(load_character_state_candidates(
        connection,
        novel_id,
        &allowed_chapters,
    )?);
    candidates.sort_by(|left, right| {
        let left_global = left.chapter_rank.is_none();
        let right_global = right.chapter_rank.is_none();
        right_global
            .cmp(&left_global)
            .then_with(|| right.chapter_rank.unwrap_or(0).cmp(&left.chapter_rank.unwrap_or(0)))
            .then_with(|| right.importance.cmp(&left.importance))
            .then_with(|| {
                source_type_priority(left.source_type)
                    .cmp(&source_type_priority(right.source_type))
            })
            .then_with(|| left.source_id.cmp(&right.source_id))
    });

    let candidate_count = candidates.len();
    let mut items = Vec::new();
    for candidate in &mut candidates {
        let item = memory_item(candidate);
        let mut tentative = items.clone();
        tentative.push(item.clone());
        let value = memory_value(
            novel_id,
            target_chapter_id,
            target_rank,
            lookback_chapters,
            budget_bytes,
            candidate_count,
            &tentative,
        );
        let canonical = ai_fact_security::canonical_json(&value)?;
        if canonical.len() <= budget_bytes as usize {
            candidate.included = true;
            items.push(item);
        } else {
            candidate.omission_reason = Some("budget".to_string());
        }
    }
    let memory = memory_value(
        novel_id,
        target_chapter_id,
        target_rank,
        lookback_chapters,
        budget_bytes,
        candidate_count,
        &items,
    );
    let memory_json = ai_fact_security::canonical_json(&memory)?;
    if memory_json.len() > budget_bytes as usize {
        return Err(AppError::new(
            codes::MEMORY_BUDGET_EXCEEDED,
            "Memory Snapshot 固定元数据超过预算",
            false,
        ));
    }
    let source_manifest = Value::Array(
        candidates
            .iter()
            .enumerate()
            .map(|(index, candidate)| manifest_entry(candidate, (index + 1) as i64))
            .collect(),
    );
    let included_count = items.len() as i64;
    Ok(CompiledMemory {
        target_chapter_rank: target_rank,
        source_manifest_hash: ai_fact_security::canonical_hash(&source_manifest)?,
        memory_hash: ai_fact_security::canonical_hash(&memory)?,
        memory_bytes: memory_json.len() as i64,
        omitted_count: candidate_count as i64 - included_count,
        included_count,
        candidates,
        source_manifest,
        memory,
    })
}

fn require_bundle(
    connection: &Connection,
    snapshot_id: &str,
) -> Result<MemorySnapshotBundle, AppError> {
    memory_repository::get_bundle(connection, snapshot_id)?.ok_or_else(not_found)
}

pub fn create_snapshot(
    connection: &mut Connection,
    input: CreateMemorySnapshotInput,
) -> Result<MemorySnapshotBundle, AppError> {
    validate_identifier(&input.operation_id, "operationId")?;
    validate_identifier(&input.novel_id, "novelId")?;
    validate_identifier(&input.target_chapter_id, "targetChapterId")?;
    let (lookback_chapters, budget_bytes) = normalized_limits(&input)?;
    let request_hash = ai_fact_security::canonical_hash(&request_value(
        &input.novel_id,
        &input.target_chapter_id,
        lookback_chapters,
        budget_bytes,
    ))?;
    if let Some(existing) =
        memory_repository::get_snapshot_by_operation(connection, &input.operation_id)?
    {
        if existing.request_hash != request_hash {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "相同 operationId 对应不同 Memory Snapshot 请求",
                false,
            ));
        }
        return require_bundle(connection, &existing.snapshot_id);
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    if let Some(existing) =
        memory_repository::get_snapshot_by_operation(&transaction, &input.operation_id)?
    {
        if existing.request_hash != request_hash {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "相同 operationId 对应不同 Memory Snapshot 请求",
                false,
            ));
        }
        drop(transaction);
        return require_bundle(connection, &existing.snapshot_id);
    }

    let compiled = compile_memory(
        &transaction,
        &input.novel_id,
        &input.target_chapter_id,
        lookback_chapters,
        budget_bytes,
    )?;
    let snapshot_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let source_manifest_json = ai_fact_security::canonical_json(&compiled.source_manifest)?;
    let memory_json = ai_fact_security::canonical_json(&compiled.memory)?;
    transaction
        .execute(
            "INSERT INTO memory_snapshots
             (snapshot_id, operation_id, request_hash, contract_version, memory_kind,
              compiler_id, compiler_version, novel_id, target_chapter_id,
              target_chapter_rank, lookback_chapters, budget_bytes, source_manifest_json,
              source_manifest_hash, memory_json, memory_hash, candidate_count,
              included_count, omitted_count, memory_bytes, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,
                     ?17,?18,?19,?20,?21)",
            params![
                snapshot_id,
                input.operation_id,
                request_hash,
                MEMORY_CONTRACT_VERSION,
                MEMORY_KIND,
                MEMORY_COMPILER_ID,
                MEMORY_COMPILER_VERSION,
                input.novel_id,
                input.target_chapter_id,
                compiled.target_chapter_rank,
                lookback_chapters,
                budget_bytes,
                source_manifest_json,
                compiled.source_manifest_hash,
                memory_json,
                compiled.memory_hash,
                compiled.candidates.len() as i64,
                compiled.included_count,
                compiled.omitted_count,
                compiled.memory_bytes,
                now,
            ],
        )
        .map_err(AppError::database)?;
    for (index, source) in compiled.candidates.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO memory_snapshot_sources
                 (snapshot_id, source_ordinal, source_type, source_id, novel_id,
                  chapter_id, chapter_rank, source_version, source_hash, included,
                  omission_reason, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                params![
                    snapshot_id,
                    (index + 1) as i64,
                    source.source_type.as_str(),
                    source.source_id,
                    source.novel_id,
                    source.chapter_id,
                    source.chapter_rank,
                    source.source_version,
                    source.source_hash,
                    i64::from(source.included),
                    source.omission_reason,
                    now,
                ],
            )
            .map_err(AppError::database)?;
    }
    transaction.commit().map_err(|error| {
        AppError::new(
            codes::DATABASE_COMMIT_UNKNOWN,
            "Memory Snapshot 提交状态未知，请按相同 operationId 重放",
            true,
        )
        .with_context(None, Some(&input.operation_id))
        .with_details(serde_json::json!({ "sqliteError": error.to_string() }))
    })?;
    require_bundle(connection, &snapshot_id)
}

pub fn get_snapshot_bundle(
    connection: &Connection,
    snapshot_id: &str,
) -> Result<MemorySnapshotBundle, AppError> {
    validate_identifier(snapshot_id, "snapshotId")?;
    require_bundle(connection, snapshot_id)
}

pub fn list_snapshots_by_chapter(
    connection: &Connection,
    chapter_id: &str,
    limit: i64,
) -> Result<Vec<MemorySnapshotRecord>, AppError> {
    validate_identifier(chapter_id, "chapterId")?;
    memory_repository::list_snapshots_by_chapter(connection, chapter_id, limit.clamp(1, 100))
}

fn request_hash_for_record(snapshot: &MemorySnapshotRecord) -> Result<String, AppError> {
    ai_fact_security::canonical_hash(&request_value(
        &snapshot.novel_id,
        &snapshot.target_chapter_id,
        snapshot.lookback_chapters,
        snapshot.budget_bytes,
    ))
}

pub fn verify_snapshot(
    connection: &Connection,
    snapshot_id: &str,
) -> Result<MemorySnapshotVerification, AppError> {
    let bundle = get_snapshot_bundle(connection, snapshot_id)?;
    let snapshot = &bundle.snapshot;
    let request_hash_valid = request_hash_for_record(snapshot)? == snapshot.request_hash;
    let stored_manifest_valid =
        ai_fact_security::canonical_hash(&snapshot.source_manifest_json)?
            == snapshot.source_manifest_hash;
    let stored_memory_valid = ai_fact_security::canonical_hash(&snapshot.memory_json)?
        == snapshot.memory_hash
        && ai_fact_security::canonical_json(&snapshot.memory_json)?.len() as i64
            == snapshot.memory_bytes;
    let recompiled = compile_memory(
        connection,
        &snapshot.novel_id,
        &snapshot.target_chapter_id,
        snapshot.lookback_chapters,
        snapshot.budget_bytes,
    )?;
    let stored_sources = bundle
        .sources
        .iter()
        .map(|source| {
            (
                format!("{}:{}", source.source_type, source.source_id),
                source,
            )
        })
        .collect::<HashMap<_, _>>();
    let current_sources = recompiled
        .candidates
        .iter()
        .map(|source| {
            (
                format!("{}:{}", source.source_type.as_str(), source.source_id),
                source,
            )
        })
        .collect::<HashMap<_, _>>();
    let mut drift = Vec::new();
    for (identity, stored) in &stored_sources {
        match current_sources.get(identity) {
            None => drift.push(MemorySourceDrift {
                source_type: stored.source_type.clone(),
                source_id: stored.source_id.clone(),
                kind: "missing".to_string(),
            }),
            Some(current)
                if stored.source_hash != current.source_hash
                    || stored.source_version != current.source_version
                    || stored.included != current.included
                    || stored.omission_reason != current.omission_reason =>
            {
                drift.push(MemorySourceDrift {
                    source_type: stored.source_type.clone(),
                    source_id: stored.source_id.clone(),
                    kind: "changed".to_string(),
                });
            }
            Some(_) => {}
        }
    }
    for (identity, current) in &current_sources {
        if !stored_sources.contains_key(identity) {
            drift.push(MemorySourceDrift {
                source_type: current.source_type.as_str().to_string(),
                source_id: current.source_id.clone(),
                kind: "unexpected".to_string(),
            });
        }
    }
    drift.sort_by(|left, right| {
        left.source_type
            .cmp(&right.source_type)
            .then_with(|| left.source_id.cmp(&right.source_id))
            .then_with(|| left.kind.cmp(&right.kind))
    });
    let hashes_match = recompiled.source_manifest_hash == snapshot.source_manifest_hash
        && recompiled.memory_hash == snapshot.memory_hash;
    Ok(MemorySnapshotVerification {
        snapshot_id: snapshot.snapshot_id.clone(),
        valid: request_hash_valid
            && stored_manifest_valid
            && stored_memory_valid
            && hashes_match
            && drift.is_empty(),
        request_hash_valid,
        stored_manifest_valid,
        stored_memory_valid,
        recompiled_manifest_hash: recompiled.source_manifest_hash,
        recompiled_memory_hash: recompiled.memory_hash,
        drift,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Result<Connection, Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch("PRAGMA foreign_keys=ON;")?;
        crate::db::create_tables(&mut connection)?;
        connection.execute_batch(
            "INSERT INTO novels (id,title,status,created_at,updated_at)
             VALUES ('novel-memory','Memory','draft','2026-01-01','2026-01-01');
             INSERT INTO volumes (id,novel_id,title,order_index,status,created_at,updated_at)
             VALUES ('volume-memory','novel-memory','V',1,'planned','2026-01-01','2026-01-01');
             INSERT INTO chapters
               (id,novel_id,volume_id,title,order_index,status,created_at,updated_at)
             VALUES
               ('chapter-1','novel-memory','volume-memory','C1',1,'summarized','2026-01-01','2026-01-01'),
               ('chapter-2','novel-memory','volume-memory','C2',2,'summarized','2026-01-02','2026-01-02'),
               ('chapter-3','novel-memory','volume-memory','C3',3,'not_started','2026-01-03','2026-01-03'),
               ('chapter-4','novel-memory','volume-memory','C4',4,'not_started','2026-01-04','2026-01-04');
             INSERT INTO chapter_drafts
               (id,novel_id,chapter_id,content,source,version_no,is_adopted,created_at,updated_at)
             VALUES
               ('draft-1','novel-memory','chapter-1','one','manual',1,1,'2026-01-01','2026-01-01'),
               ('draft-2','novel-memory','chapter-2','two','manual',1,1,'2026-01-02','2026-01-02'),
               ('draft-4','novel-memory','chapter-4','future','manual',1,1,'2026-01-04','2026-01-04');
             UPDATE chapters SET adopted_draft_id='draft-1' WHERE id='chapter-1';
             UPDATE chapters SET adopted_draft_id='draft-2' WHERE id='chapter-2';
             UPDATE chapters SET adopted_draft_id='draft-4' WHERE id='chapter-4';
             INSERT INTO chapter_summaries
               (id,novel_id,chapter_id,adopted_draft_id,summary,enabled,is_expired,created_at,updated_at)
             VALUES
               ('summary-1','novel-memory','chapter-1','draft-1','summary one',1,0,'2026-01-01','2026-01-01'),
               ('summary-2','novel-memory','chapter-2','draft-2','summary two',1,0,'2026-01-02','2026-01-02'),
               ('summary-future','novel-memory','chapter-4','draft-4','future summary',1,0,'2026-01-04','2026-01-04');
             INSERT INTO context_records
               (id,novel_id,chapter_id,context_type,title,content,importance,is_active,is_expired,created_at,updated_at)
             VALUES
               ('context-global','novel-memory',NULL,'rule','global','global rule',5,1,0,'2026-01-01','2026-01-01'),
               ('context-2','novel-memory','chapter-2','plot_progress','plot','plot two',4,1,0,'2026-01-02','2026-01-02'),
               ('context-expired','novel-memory','chapter-1','other','old','expired',5,1,1,'2026-01-01','2026-01-01'),
               ('context-future','novel-memory','chapter-4','other','future','future',5,1,0,'2026-01-04','2026-01-04');
             INSERT INTO characters
               (id,novel_id,name,role_type,is_active,created_at,updated_at)
             VALUES ('character-1','novel-memory','Hero','main',1,'2026-01-01','2026-01-01');
             INSERT INTO character_states
               (id,novel_id,character_id,chapter_id,state_summary,created_at)
             VALUES
               ('state-1','novel-memory','character-1','chapter-1','healthy','2026-01-01'),
               ('state-future','novel-memory','character-1','chapter-4','future state','2026-01-04');",
        )?;
        Ok(connection)
    }

    fn input(operation_id: &str, budget_bytes: i64) -> CreateMemorySnapshotInput {
        CreateMemorySnapshotInput {
            operation_id: operation_id.to_string(),
            novel_id: "novel-memory".to_string(),
            target_chapter_id: "chapter-3".to_string(),
            lookback_chapters: Some(20),
            budget_bytes: Some(budget_bytes),
        }
    }

    #[test]
    fn memory01_create_is_deterministic_idempotent_and_excludes_invalid_time_scope(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = fixture()?;
        let created = create_snapshot(&mut connection, input("memory-op-1", 65_536))?;
        let replay = create_snapshot(&mut connection, input("memory-op-1", 65_536))?;
        assert_eq!(created, replay);
        assert_eq!(created.snapshot.target_chapter_rank, 3);
        assert_eq!(created.snapshot.candidate_count, 5);
        assert!(created.sources.iter().all(|source| source.included));
        let ids = created
            .sources
            .iter()
            .map(|source| source.source_id.as_str())
            .collect::<HashSet<_>>();
        for expected in [
            "summary-1",
            "summary-2",
            "context-global",
            "context-2",
            "state-1",
        ] {
            assert!(ids.contains(expected), "missing {expected}");
        }
        for excluded in [
            "summary-future",
            "context-expired",
            "context-future",
            "state-future",
        ] {
            assert!(!ids.contains(excluded), "included {excluded}");
        }
        assert!(verify_snapshot(&connection, &created.snapshot.snapshot_id)?.valid);
        Ok(())
    }

    #[test]
    fn memory02_budget_omits_whole_sources_and_source_drift_is_explicit(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = fixture()?;
        connection.execute(
            "UPDATE context_records SET content=?1 WHERE id='context-2'",
            params!["x".repeat(12_000)],
        )?;
        let created = create_snapshot(&mut connection, input("memory-op-budget", 4_096))?;
        assert!(created.snapshot.omitted_count >= 1);
        assert!(created
            .sources
            .iter()
            .any(|source| source.omission_reason.as_deref() == Some("budget")));
        assert!(created.snapshot.memory_bytes <= created.snapshot.budget_bytes);
        connection.execute(
            "UPDATE context_records SET content='changed', updated_at='2026-02-01'
             WHERE id='context-global'",
            [],
        )?;
        let verification = verify_snapshot(&connection, &created.snapshot.snapshot_id)?;
        assert!(!verification.valid);
        assert!(verification.drift.iter().any(|item| {
            item.source_id == "context-global" && item.kind == "changed"
        }));
        Ok(())
    }

    #[test]
    fn memory03_operation_conflict_and_immutable_rows_fail_closed(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = fixture()?;
        let created = create_snapshot(&mut connection, input("memory-op-conflict", 65_536))?;
        let mut changed = input("memory-op-conflict", 65_536);
        changed.lookback_chapters = Some(1);
        let conflict = create_snapshot(&mut connection, changed).expect_err("must conflict");
        assert_eq!(conflict.code, codes::OPERATION_PAYLOAD_CONFLICT);
        assert!(connection
            .execute(
                "UPDATE memory_snapshots SET memory_hash=?1 WHERE snapshot_id=?2",
                params!["0".repeat(64), created.snapshot.snapshot_id],
            )
            .is_err());
        assert!(connection
            .execute(
                "DELETE FROM memory_snapshot_sources WHERE snapshot_id=?1",
                params![created.snapshot.snapshot_id],
            )
            .is_err());
        assert!(connection
            .execute(
                "INSERT INTO memory_snapshot_sources
                 (snapshot_id,source_ordinal,source_type,source_id,novel_id,chapter_id,
                  chapter_rank,source_version,source_hash,included,omission_reason,created_at)
                 VALUES (?1,?2,'context_record','forged','novel-memory',NULL,NULL,
                         'forged',?3,1,NULL,'forged')",
                params![
                    created.snapshot.snapshot_id,
                    created.snapshot.candidate_count + 1,
                    "0".repeat(64),
                ],
            )
            .is_err());
        Ok(())
    }
}
