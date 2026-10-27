use crate::errors::AppError;
use crate::repositories::{draft_repository, large_text_repository};
use crate::services::{draft_service, summary_grounding};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

pub fn validate_candidate(
    connection: &Connection,
    novel_id: &str,
    chapter_id: Option<&str>,
    draft_id: Option<&str>,
    expected_hash: Option<&str>,
    payload: &Value,
    required: bool,
) -> Result<Vec<summary_grounding::GroundingIssue>, AppError> {
    // Older candidates without the evidence contract remain readable with an explicit warning.
    if !required && payload.get("grounding").is_none() {
        return Ok(summary_grounding::validate("", payload, false));
    }
    let invalid = || {
        AppError::new(
            "SUMMARY_SOURCE_CHANGED",
            "总结来源不是当前完整采用稿，请基于当前采用稿重新总结。",
            false,
        )
    };
    let (Some(chapter_id), Some(draft_id), Some(expected_hash)) =
        (chapter_id, draft_id, expected_hash)
    else {
        return Err(invalid());
    };
    let adopted: Option<String> = connection.query_row(
        "SELECT adopted_draft_id FROM chapters WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL",
        params![chapter_id, novel_id], |row| row.get(0),
    ).optional().map_err(AppError::database)?.flatten();
    let draft = draft_repository::find_draft(connection, draft_id)?.ok_or_else(invalid)?;
    if adopted.as_deref() != Some(draft_id)
        || draft.novel_id != novel_id
        || draft.chapter_id != chapter_id
        || !draft.is_adopted
    {
        return Err(invalid());
    }
    let full = draft_service::load_full_content(connection, &draft)?;
    if full.content.trim().is_empty() || !full.content_hash.eq_ignore_ascii_case(expected_hash) {
        return Err(invalid());
    }
    Ok(summary_grounding::validate(
        &full.content,
        payload,
        required,
    ))
}

/// The latest successful outline receipt must expose the whole adopted draft used now.
pub fn validate_runtime_receipt(
    connection: &Connection,
    run_id: &str,
    draft_id: Option<&str>,
    hash: Option<&str>,
) -> Result<(), AppError> {
    let invalid = || {
        AppError::new("DSH_SUMMARY_SOURCE_INCOMPLETE", "总结未完整读取当前采用稿，或生成期间采用稿已变化。请核对完整采用稿后重新总结；读取被截断时，本次总结不能进入上下文。", false)
    };
    let (event_id, raw): (String, String) = connection.query_row(
        "SELECT event_id,result_json FROM tool_call_events WHERE run_id=?1 AND tool_name='chapter.read_outline'
         AND status='succeeded' ORDER BY sequence DESC LIMIT 1", [run_id], |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional().map_err(AppError::database)?.ok_or_else(invalid)?;
    let receipt: Value = serde_json::from_str(&raw).map_err(|_| invalid())?;
    let document_id = receipt
        .get("largeTextRefId")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    large_text_repository::validate_document_target(
        connection,
        document_id,
        "tool_event",
        &event_id,
        "result",
    )
    .map_err(|_| invalid())?;
    let full = large_text_repository::read_verified_document(connection, document_id)?;
    if receipt.get("contentHash").and_then(Value::as_str) != Some(full.content_hash.as_str()) {
        return Err(invalid());
    }
    let body: Value = serde_json::from_str(&full.content).map_err(|_| invalid())?;
    let draft = body
        .pointer("/data/currentAdoptedDraft")
        .ok_or_else(invalid)?;
    let content = draft
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    if draft.get("draftId").and_then(Value::as_str) != draft_id
        || draft.get("contentHash").and_then(Value::as_str) != hash
        || draft.get("truncated").and_then(Value::as_bool) != Some(false)
        || Some(large_text_repository::sha256(content).as_str()) != hash
    {
        return Err(invalid());
    }
    Ok(())
}
