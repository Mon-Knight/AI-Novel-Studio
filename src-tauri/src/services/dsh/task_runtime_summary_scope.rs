//! Scope manual summary candidates to a persisted user turn and verified adopted draft.
use super::{
    chapter_summary_recovery_scope, read_chapter_base_snapshot, ChapterSummaryRecoveryScope,
    StartTaskTurnInput,
};
use crate::repositories::draft_repository;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

/// Navigation evidence is captured before any Provider/tool failure; it grants no write authority.
pub(super) fn source_metadata(
    connection: &Connection,
    input: &StartTaskTurnInput,
) -> Result<Value, String> {
    if input.task_kind != "chapter_summary" {
        return Ok(Value::Null);
    }
    let scope = resolve_session_scope(connection, input)?;
    let baseline = read_chapter_base_snapshot(connection, &scope.novel_id, &scope.chapter_id)
        .map_err(|error| error.to_string())?;
    Ok(
        json!({"version":1,"novelId":scope.novel_id,"chapterId":scope.chapter_id,
        "adoptedDraftId":scope.adopted_draft_id,"contentHash":baseline.content_hash}),
    )
}

pub(super) fn is_automatic_summary(input: &StartTaskTurnInput) -> bool {
    input.task_kind == "chapter_summary" && input.turn_id.starts_with("summary-generation-")
}

pub(super) fn resolve_session_scope(
    connection: &Connection,
    input: &StartTaskTurnInput,
) -> Result<ChapterSummaryRecoveryScope, String> {
    if is_automatic_summary(input) {
        // Automatic follow-ups retain the consumed review authorization gate in full.
        return chapter_summary_recovery_scope(connection, input);
    }
    if input.task_kind != "chapter_summary"
        || input.expected_tool.as_deref() != Some("summarize_chapter")
        || input.expected_artifact_type.as_deref() != Some("chapter_summary")
    {
        return Err("DSH_MANUAL_SUMMARY_SCOPE_INVALID".to_string());
    }
    let user_turn_matches = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM conversation_turns AS turn
                JOIN task_conversations AS conversation
                  ON conversation.conversation_id=turn.conversation_id
                WHERE turn.turn_id=?1 AND turn.conversation_id=?2 AND turn.role='user'
                  AND conversation.novel_id=?3
             )",
            params![&input.turn_id, &input.conversation_id, &input.novel_id],
            |row| row.get::<_, bool>(0),
        )
        .optional()
        .map_err(|_| "DSH_MANUAL_SUMMARY_SCOPE_READ_FAILED".to_string())?
        .unwrap_or(false);
    if !user_turn_matches {
        return Err("DSH_MANUAL_SUMMARY_SCOPE_INVALID".to_string());
    }
    let chapter_id = input
        .chapter_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "DSH_MANUAL_SUMMARY_SCOPE_INVALID".to_string())?;
    draft_repository::validate_target(connection, &input.novel_id, chapter_id)
        .map_err(|error| error.to_string())?;
    // This verifies ownership, adoption state, large-text integrity and the content hash.
    let baseline = read_chapter_base_snapshot(connection, &input.novel_id, chapter_id)
        .map_err(|error| error.to_string())?;
    let adopted_draft_id = baseline
        .draft_id
        .ok_or_else(|| "DSH_MANUAL_SUMMARY_ADOPTED_DRAFT_REQUIRED".to_string())?;
    Ok(ChapterSummaryRecoveryScope {
        novel_id: input.novel_id.clone(),
        chapter_id: chapter_id.to_string(),
        adopted_draft_id,
    })
}
