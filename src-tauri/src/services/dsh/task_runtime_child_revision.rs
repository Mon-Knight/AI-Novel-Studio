//! Exact candidate-to-child revision material, bound to the native parent root.
//! This never changes the author's original turn or grants formal write authority.
use super::*;

pub fn bind_child_revision(
    connection: &rusqlite::Connection,
    input: &mut StartTaskTurnInput,
    parent_artifact_id: &str,
) -> Result<(), String> {
    let root = input
        .execution
        .as_ref()
        .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    let (card_id,title,run_id,execution_json):(String,String,String,String)=connection.query_row(
        "SELECT c.card_id,c.title,c.run_id,e.arguments_summary_json FROM conversation_artifact_cards c
         JOIN tool_call_events e ON e.run_id=c.run_id AND e.tool_name='dsh.execution_contract' AND e.status='succeeded'
         WHERE c.artifact_id=?1 AND c.conversation_id=?2 AND c.status='candidate'",
        rusqlite::params![parent_artifact_id,input.conversation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)),
    ).optional().map_err(|e|e.to_string())?.ok_or("DSH_CHILD_REVISION_SOURCE_INVALID")?;
    let execution: Value =
        serde_json::from_str(&execution_json).map_err(|_| "DSH_CHILD_REVISION_SOURCE_INVALID")?;
    if execution
        .pointer("/execution/rootRunId")
        .and_then(Value::as_str)
        != Some(root.root_run_id.as_str())
        || execution
            .pointer("/execution/rootTurnId")
            .and_then(Value::as_str)
            != Some(root.root_turn_id.as_str())
    {
        return Err("DSH_CHILD_REVISION_ROOT_MISMATCH".into());
    }
    let bundle = artifact_service::get_artifact_bundle(connection, parent_artifact_id)
        .map_err(|e| e.to_string())?;
    if bundle.artifact.artifact_type != "chapter_text"
        || bundle.artifact.source_novel_id != input.novel_id
        || bundle.artifact.source_chapter_id != input.chapter_id
    {
        return Err("DSH_CHILD_REVISION_SOURCE_INVALID".into());
    }
    let source = ArtifactRevisionSource {
        conversation_id: input.conversation_id.clone(),
        novel_id: input.require_novel_id()?.to_string(),
        chapter_id: input.chapter_id.clone(),
        card_id,
        artifact_id: parent_artifact_id.into(),
        artifact_hash: bundle.artifact.content_hash,
        artifact_type: "chapter_text".into(),
        run_id: Some(run_id),
        title,
        source_draft_version: None,
    };
    let verified = crate::services::artifact_service::revision_source::verify_source(
        connection,
        &source,
        input.require_novel_id()?,
        input.chapter_id.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    let root = input
        .execution
        .as_mut()
        .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    root.revision_depth = root.revision_depth.saturating_add(1);
    root.internal_revision = Some(verified);
    Ok(())
}
