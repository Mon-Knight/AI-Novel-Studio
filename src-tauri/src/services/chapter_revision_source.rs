//! Exact chapter-candidate identity shared by DSH startup and the narrow derivation transaction.
//! This is a material reference, never review/adoption authorization.
use crate::errors::AppError;
use crate::repositories::{ai_task_repository, artifact_repository, large_text_repository};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub(crate) const DERIVATION_TYPE: &str = "revision";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactRevisionSource {
    pub conversation_id: String,
    pub novel_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter_id: Option<String>,
    pub card_id: String,
    pub artifact_id: String,
    pub artifact_hash: String,
    pub artifact_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_draft_version: Option<i64>,
}

#[derive(Debug, Clone)]
pub(crate) struct VerifiedRevisionSource {
    pub source: ArtifactRevisionSource,
    pub content: String,
}

pub(crate) fn invalid_source() -> AppError {
    AppError::new(
        "CHAPTER_REVISION_SOURCE_INVALID",
        "修订来源缺失、失效或与精确候选身份不一致；请重新选择候选，不会改用最新候选",
        false,
    )
}

pub(crate) fn validate_identity(source: &ArtifactRevisionSource) -> Result<(), AppError> {
    if [
        &source.conversation_id,
        &source.novel_id,
        &source.card_id,
        &source.artifact_id,
        &source.artifact_type,
        &source.title,
    ]
    .iter()
    .any(|value| value.trim().is_empty())
        || source
            .chapter_id
            .as_deref()
            .is_some_and(|id| id.trim().is_empty())
        || source
            .run_id
            .as_deref()
            .is_some_and(|id| id.trim().is_empty())
        || source
            .source_draft_version
            .is_some_and(|version| !(1..=9_007_199_254_740_991).contains(&version))
        || source.artifact_hash.len() != 64
        || !source
            .artifact_hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid_source());
    }
    Ok(())
}

/// Re-read every authoritative relation and the complete raw document. No latest-candidate queries,
/// display previews, client content, or client "verified" flags can supply this material.
pub(crate) fn verify_source(
    connection: &Connection,
    source: &ArtifactRevisionSource,
    novel_id: &str,
    chapter_id: Option<&str>,
) -> Result<VerifiedRevisionSource, AppError> {
    validate_identity(source)?;
    if source.novel_id != novel_id
        || source.chapter_id.as_deref() != chapter_id
        || chapter_id.is_none()
        || source.artifact_type != "chapter_text"
    {
        return Err(invalid_source());
    }
    let card_matches: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM conversation_artifact_cards card
         JOIN task_conversations conversation ON conversation.conversation_id=card.conversation_id
         JOIN novels novel ON novel.id=conversation.novel_id
         JOIN chapters chapter ON chapter.id=?7 AND chapter.novel_id=novel.id
         WHERE card.card_id=?1 AND card.conversation_id=?2 AND card.artifact_id=?3
           AND card.artifact_type=?4 AND card.run_id IS ?5 AND card.title=?6
           AND card.status='candidate' AND conversation.novel_id=?8
           AND novel.deleted_at IS NULL AND chapter.deleted_at IS NULL
           AND conversation.archived_at IS NULL
           AND (card.turn_id IS NULL OR EXISTS(SELECT 1 FROM conversation_turns turn
                WHERE turn.turn_id=card.turn_id AND turn.conversation_id=card.conversation_id))
           -- Desktop cards persist turn_id as NULL and carry the turn through their run, so a
           -- null card turn must not fail an otherwise exact run/conversation match.
           AND (card.run_id IS NULL OR EXISTS(SELECT 1 FROM task_runs run
                WHERE run.run_id=card.run_id AND run.conversation_id=card.conversation_id
                  AND (card.turn_id IS NULL OR run.turn_id IS card.turn_id))))",
            params![
                source.card_id,
                source.conversation_id,
                source.artifact_id,
                source.artifact_type,
                source.run_id,
                source.title,
                chapter_id,
                novel_id
            ],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if !card_matches {
        return Err(invalid_source());
    }
    // The latest exact decision must still request revision. A rejected, adopted, or
    // re-confirmed source cannot silently reuse an earlier revision request.
    let decision = connection
        .query_row(
            "SELECT artifact_id,artifact_hash,decision,actor,apply_transaction_id,conflict_code
         FROM artifact_decisions WHERE card_id=?1 AND conversation_id=?2
         ORDER BY created_at DESC,rowid DESC LIMIT 1",
            params![source.card_id, source.conversation_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(invalid_source)?;
    if decision.0 != source.artifact_id
        || decision.1 != source.artifact_hash
        || decision.2 != "request_revision"
        || decision.3 != "user"
        || decision.4.is_some()
        || decision.5.is_some()
    {
        return Err(invalid_source());
    }
    let artifact = artifact_repository::find_artifact(connection, &source.artifact_id)?
        .ok_or_else(invalid_source)?;
    let task =
        ai_task_repository::find_task(connection, &artifact.task_id)?.ok_or_else(invalid_source)?;
    let snapshot = ai_task_repository::find_input_snapshot(connection, &artifact.task_id)?
        .ok_or_else(invalid_source)?;
    let attempt =
        ai_task_repository::find_attempt(connection, &artifact.task_id, &artifact.attempt_id)?
            .ok_or_else(invalid_source)?;
    if artifact.artifact_type != source.artifact_type
        || artifact.schema_version != 1
        || artifact.source_novel_id != novel_id
        || artifact.source_chapter_id.as_deref() != chapter_id
        || artifact.source_draft_version != source.source_draft_version
        || artifact.content_hash != source.artifact_hash
        || !matches!(
            artifact.processing_status.as_str(),
            "valid" | "valid_with_warnings"
        )
        || task.expected_artifact_type != artifact.artifact_type
        || task.expected_artifact_schema_version != artifact.schema_version
        || task.novel_id != artifact.source_novel_id
        || task.chapter_id != artifact.source_chapter_id
        || task.input_snapshot_id != snapshot.snapshot_id
        || artifact.source_input_snapshot_id != snapshot.snapshot_id
        || artifact.source_draft_id != snapshot.source_draft_id
        || artifact.source_draft_version != snapshot.source_draft_version
        || artifact.source_base_content_hash != snapshot.base_content_hash
        || attempt.status != "succeeded"
    {
        return Err(invalid_source());
    }
    let reference_matches: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM large_text_documents WHERE id=?1
         AND target_type='result_artifact' AND target_id=?2 AND field_name='raw_content')",
            params![artifact.raw_content_ref_id, artifact.artifact_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if !reference_matches {
        return Err(invalid_source());
    }
    let raw =
        large_text_repository::read_verified_document(connection, &artifact.raw_content_ref_id)
            .map_err(|_| invalid_source())?;
    if raw.content_hash != source.artifact_hash
        || raw.content_length as i64 != artifact.content_length
        || raw.content.trim().is_empty()
    {
        return Err(invalid_source());
    }
    Ok(VerifiedRevisionSource {
        source: source.clone(),
        content: raw.content,
    })
}
