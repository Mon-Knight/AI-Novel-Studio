//! Decision waits and post-commit continuation remain inside the native root controller.
//! Credentials live only in this process; restart never blindly replays a model call.
use super::*;
use crate::services::task_authorization_contract::Receipt;

#[derive(Clone)]
struct PendingRoot {
    input: StartTaskTurnInput,
    result: TaskRuntimeResult,
    notifier: Option<TaskProjectionObserver>,
    stop_reason: Option<String>,
}
static PENDING: OnceLock<Mutex<HashMap<String, PendingRoot>>> = OnceLock::new();

pub(super) fn candidate_ready(
    input: &StartTaskTurnInput,
    result: &TaskRuntimeResult,
    notifier: Option<TaskProjectionObserver>,
) -> Result<Option<StartTaskTurnInput>, String> {
    let Some(artifact) = result.artifact_id.as_deref() else {
        return Ok(None);
    };
    let root = input
        .execution
        .as_ref()
        .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    root.check()?;
    let mut connection = crate::db::get_connection()
        .lock()
        .map_err(|_| "数据库锁失败".to_string())?;
    let card:String=connection.query_row("SELECT card_id FROM conversation_artifact_cards WHERE artifact_id=?1 AND run_id=?2 AND conversation_id=?3",rusqlite::params![artifact,result.run.run_id,input.conversation_id],|r|r.get(0)).map_err(|e|e.to_string())?;
    let notice = json!({"source":"ans-native-host","rootTurnId":root.root_turn_id,"artifactId":artifact,"cardId":card,"state":"awaiting_decision","restartPolicy":"reconcile_receipts_then_explicit_resume"});
    host_facts::append(
        &mut connection,
        AppendToolEventInput {
            event_id: format!("{}-awaiting-decision", result.run.run_id),
            run_id: result.run.run_id.clone(),
            tool_name: "dsh.awaiting_decision".into(),
            arguments_summary: notice,
            status: "succeeded".into(),
            duration_ms: None,
            error: None,
            result: Some(json!({"formalWrite":false})),
            created_at: now(),
            finished_at: Some(now()),
        },
    )
    .map_err(|e| e.to_string())?;
    PENDING
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "DSH_ROOT_PENDING_LOCK_FAILED")?
        .insert(
            input.conversation_id.clone(),
            PendingRoot {
                input: input.clone(),
                result: result.clone(),
                notifier: notifier.clone(),
                stop_reason: None,
            },
        );
    let receipt = crate::services::task_authorization_service::try_apply_candidate(
        &mut connection,
        &input.conversation_id,
        &root.root_turn_id,
        &card,
        artifact,
    )
    .map_err(|e| e.to_string())?;
    if let Some(receipt) = receipt {
        let mut next = input.clone();
        let followup =
            after_authorized_application(&mut connection, &mut next, &receipt, &result.run.run_id)?;
        PENDING
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "DSH_ROOT_PENDING_LOCK_FAILED")?
            .remove(&input.conversation_id);
        return Ok(followup);
    }
    drop(connection);
    Ok(None)
}

fn advance_receipt(
    connection: &mut rusqlite::Connection,
    input: &mut StartTaskTurnInput,
    receipt: &Receipt,
    run_id: &str,
) -> Result<(), String> {
    let root = input
        .execution
        .as_ref()
        .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    let bound:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM task_authorization_receipts r JOIN task_authorizations a ON a.authorization_id=r.authorization_id WHERE r.receipt_id=?1 AND r.conversation_id=?2 AND a.source_turn_id=?3 AND r.after_hash=?4)",rusqlite::params![receipt.receipt_id,input.conversation_id,root.root_turn_id,receipt.after_hash],|r|r.get(0)).map_err(|e|e.to_string())?;
    if !bound {
        return Err("DSH_ROOT_RECEIPT_INVALID".into());
    }
    let root_turn_id = root.root_turn_id.clone();
    let mut baselines = root.baselines.as_ref().clone();
    let authority_text:String=connection.query_row("SELECT a.baseline_json FROM task_authorizations a JOIN task_authorization_receipts r ON r.authorization_id=a.authorization_id WHERE r.receipt_id=?1 AND a.baseline_hash=r.after_hash",[&receipt.receipt_id],|r|r.get(0)).map_err(|_|"DSH_ROOT_RECEIPT_SUPERSEDED".to_string())?;
    let authority: Value =
        serde_json::from_str(&authority_text).map_err(|_| "DSH_ROOT_RECEIPT_INVALID")?;
    if crate::services::ai_fact_security::canonical_hash(&authority).map_err(|e| e.to_string())?
        != receipt.after_hash
    {
        return Err("DSH_ROOT_RECEIPT_INVALID".into());
    }
    let artifact = artifact_service::get_artifact_bundle(connection, &receipt.artifact_id)
        .map_err(|e| e.to_string())?;
    let target = receipt
        .result
        .get("chapterId")
        .and_then(Value::as_str)
        .or(artifact.artifact.source_chapter_id.as_deref());
    let created = receipt
        .result
        .get("createdNewChapters")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let mut added = 0i64;
    for chapter in authority
        .get("chapters")
        .and_then(Value::as_array)
        .ok_or("DSH_ROOT_RECEIPT_INVALID")?
    {
        let id = chapter
            .get("id")
            .and_then(Value::as_str)
            .ok_or("DSH_ROOT_RECEIPT_INVALID")?;
        let is_new = !baselines.contains_key(id);
        if !is_new && target != Some(id) {
            continue;
        }
        if is_new && created == 0 {
            continue;
        }
        let expected = snapshot_from_authority(chapter)?;
        let current = read_chapter_base_snapshot(connection, input.require_novel_id()?, id)
            .map_err(|e| e.to_string())?;
        if expected != current {
            return Err("DSH_ROOT_BASELINE_CHANGED: 本任务提交后已有其他修改，停止后续阶段".into());
        }
        baselines.insert(id.into(), expected);
        if is_new {
            added += 1;
        }
    }
    if added != created {
        return Err("DSH_ROOT_RECEIPT_CREATION_MISMATCH".into());
    }
    input
        .execution
        .as_mut()
        .ok_or("DSH_ROOT_CONTRACT_MISSING")?
        .baselines = Arc::new(baselines);
    host_facts::append(connection,AppendToolEventInput{event_id:format!("{}-receipt-projection",receipt.receipt_id),run_id:run_id.into(),tool_name:"dsh.application_receipt".into(),arguments_summary:json!({"source":"ans-native-host","rootTurnId":root_turn_id,"authority":"task_preauthorized","receiptId":receipt.receipt_id}),status:"succeeded".into(),duration_ms:None,error:None,result:Some(json!(receipt)),created_at:now(),finished_at:Some(now())}).map_err(|e|e.to_string())?;
    Ok(())
}
fn summary_after_body(
    input: &StartTaskTurnInput,
    parent_run_id: &str,
    result: &Value,
) -> Result<Option<StartTaskTurnInput>, String> {
    let Some(followup) = result.get("summaryFollowUp") else {
        return Ok(None);
    };
    let chapter = followup
        .get("chapterId")
        .and_then(Value::as_str)
        .ok_or("DSH_ROOT_RECEIPT_INVALID")?;
    let mut next = input.clone();
    next.goal = "总结本章".into();
    next.task_kind = "chapter_summary".into();
    next.chapter_id = Some(chapter.into());
    next.expected_tool = Some("summarize_chapter".into());
    next.expected_artifact_type = Some("chapter_summary".into());
    next.required_read_tools = vec!["novel.read_context".into(), "chapter.read_outline".into()];
    next.chapter_word_range = None;
    next.chapter_host_gate = None;
    next.continuity_claim = None;
    next.verified_continuity = None;
    next.continuity_checked = false;
    next.retry_source_run_id = None;
    next.revision_source = None;
    next.verified_revision_source = None;
    if let Some(runtime) = next
        .model_snapshot
        .get_mut("runtime")
        .and_then(Value::as_object_mut)
    {
        runtime.remove("artifactRevision");
    }
    let root = next.execution.as_mut().ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    root.parent_run_id = Some(parent_run_id.to_string());
    root.internal_revision = None;
    root.planned_instruction = Some(
        "正式采用事务已提交；仅对回执绑定的当前完整采用稿生成总结候选，不伪造人工审阅。".into(),
    );
    Ok(Some(next))
}

pub fn reconcile_task(conversation_id: &str) -> Result<Option<TaskRuntimeResult>, String> {
    let pending = PENDING
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "DSH_ROOT_PENDING_LOCK_FAILED")?
        .get(conversation_id)
        .cloned();
    let Some(mut pending) = pending else {
        return Ok(None);
    };
    let root = pending
        .input
        .execution
        .as_ref()
        .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    root.check()?;
    if let Some(result) = apply_pending_authorization(&mut pending)? {
        return Ok(Some(result));
    }
    let root = pending
        .input
        .execution
        .as_ref()
        .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    let artifact = pending
        .result
        .artifact_id
        .as_deref()
        .ok_or("DSH_ROOT_CANDIDATE_MISSING")?;
    let next = {
        let connection = crate::db::get_connection()
            .lock()
            .map_err(|_| "数据库锁失败".to_string())?;
        let consumed:Option<(String,String,String)>=connection.query_row("SELECT a.authorization_id,a.chapter_id,a.consumed_by_draft_id FROM review_authorizations a JOIN artifact_decisions d ON d.decision_id=a.decision_id WHERE a.artifact_id=?1 AND d.conversation_id=?2 AND a.status='consumed' ORDER BY a.consumed_at DESC LIMIT 1",rusqlite::params![artifact,conversation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|e|e.to_string())?;
        if let Some((authorization, chapter, draft)) = consumed {
            let proof: String = connection.query_row("SELECT arguments_summary_json FROM tool_call_events WHERE event_id=?1 AND tool_name='dsh.manual_application_receipt' AND status='succeeded'", [format!("manual-adoption-{authorization}")], |r| r.get(0)).optional().map_err(|e| e.to_string())?.ok_or("DSH_MANUAL_AFTER_PROOF_REQUIRED")?;
            let proof: Value =
                serde_json::from_str(&proof).map_err(|_| "DSH_MANUAL_AFTER_PROOF_INVALID")?;
            let expected: ChapterBaseSnapshot = serde_json::from_value(proof["after"].clone())
                .map_err(|_| "DSH_MANUAL_AFTER_PROOF_INVALID")?;
            let baseline = read_chapter_base_snapshot(
                &connection,
                pending.input.require_novel_id()?,
                &chapter,
            )
            .map_err(|e| e.to_string())?;
            if baseline != expected
                || baseline.draft_id.as_deref() != Some(draft.as_str())
                || proof["artifactId"] != artifact
                || proof["rootTaskId"] != conversation_id
                || proof["rootTurnId"] != root.root_turn_id
            {
                return Err(
                    "DSH_ROOT_BASELINE_CHANGED: 人工采用后又有修改，原提交后基线失效".into(),
                );
            }
            let mut baselines = root.baselines.as_ref().clone();
            baselines.insert(chapter.clone(), baseline);
            pending
                .input
                .execution
                .as_mut()
                .ok_or("DSH_ROOT_CONTRACT_MISSING")?
                .baselines = Arc::new(baselines);
            summary_after_body(
                &pending.input,
                &pending.result.run.run_id,
                &json!({"summaryFollowUp":{"chapterId":chapter,"adoptedDraftId":draft,"reviewAuthorizationId":authorization}}),
            )?
        } else {
            let applied:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM artifact_decisions WHERE artifact_id=?1 AND conversation_id=?2 AND decision='request_apply' AND apply_transaction_id IS NOT NULL)",rusqlite::params![artifact,conversation_id],|r|r.get(0)).map_err(|e|e.to_string())?;
            if !applied {
                return Ok(None);
            }
            retire_completed_root(&connection, &pending.input)?;
            None
        }
    };
    PENDING
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "DSH_ROOT_PENDING_LOCK_FAILED")?
        .remove(conversation_id);
    match next {
        Some(input) => coordinator::resume(input, pending.notifier).map(Some),
        None => Ok(None),
    }
}

pub(super) fn cancel_pending(conversation_id: &str) -> bool {
    let pending = PENDING
        .get_or_init(Default::default)
        .lock()
        .ok()
        .and_then(|mut p| p.remove(conversation_id));
    if let Some(root) = pending {
        if let Some(execution) = root.input.execution {
            execution.cancel.store(true, Ordering::SeqCst);
        }
        return true;
    }
    false
}
pub(super) fn pending_status(conversation_id: &str) -> Option<TaskRuntimeStatus> {
    let pending = PENDING.get_or_init(Default::default).lock().ok()?;
    let pending = pending.get(conversation_id)?;
    Some(TaskRuntimeStatus {
        conversation_id: conversation_id.into(),
        run_id: pending.result.run.run_id.clone(),
        session_id: pending.result.session_id.clone(),
        worker_id: pending.result.worker_id.clone(),
        status: "waiting_decision".into(),
        runtime: "dsh-headless-persistent".into(),
        error: pending.stop_reason.clone(),
    })
}
pub(super) fn pending_statuses() -> Vec<TaskRuntimeStatus> {
    let ids = PENDING
        .get_or_init(Default::default)
        .lock()
        .map(|p| p.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    ids.iter().filter_map(|id| pending_status(id)).collect()
}

fn snapshot_from_authority(value: &Value) -> Result<ChapterBaseSnapshot, String> {
    let draft = value.get("adoptedDraft").filter(|v| !v.is_null());
    Ok(ChapterBaseSnapshot {
        chapter_revision: value
            .get("revision")
            .and_then(Value::as_str)
            .ok_or("DSH_ROOT_RECEIPT_INVALID")?
            .into(),
        draft_id: draft
            .and_then(|v| v.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string),
        draft_version: draft.and_then(|v| v.get("version")).and_then(Value::as_i64),
        content_hash: draft
            .and_then(|v| v.get("hash"))
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

/// Grant issuance after a candidate must apply that exact candidate, never regenerate it.
fn apply_pending_authorization(
    pending: &mut PendingRoot,
) -> Result<Option<TaskRuntimeResult>, String> {
    let root = pending
        .input
        .execution
        .as_ref()
        .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    let artifact = pending
        .result
        .artifact_id
        .as_deref()
        .ok_or("DSH_ROOT_CANDIDATE_MISSING")?;
    let mut connection = crate::db::get_connection()
        .lock()
        .map_err(|_| "数据库锁失败".to_string())?;
    let card:String=connection.query_row("SELECT card_id FROM conversation_artifact_cards WHERE artifact_id=?1 AND conversation_id=?2 AND run_id=?3",rusqlite::params![artifact,pending.input.conversation_id,pending.result.run.run_id],|r|r.get(0)).map_err(|e|e.to_string())?;
    let receipt = crate::services::task_authorization_service::try_apply_candidate(
        &mut connection,
        &pending.input.conversation_id,
        &root.root_turn_id,
        &card,
        artifact,
    )
    .map_err(|e| e.to_string())?;
    let Some(receipt) = receipt else {
        return Ok(None);
    };
    let next = after_authorized_application(
        &mut connection,
        &mut pending.input,
        &receipt,
        &pending.result.run.run_id,
    )?;
    drop(connection);
    PENDING
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "DSH_ROOT_PENDING_LOCK_FAILED")?
        .remove(&pending.input.conversation_id);
    match next {
        Some(input) => coordinator::resume(input, pending.notifier.clone()).map(Some),
        None => Ok(Some(pending.result.clone())),
    }
}

fn after_authorized_application(
    connection: &mut rusqlite::Connection,
    input: &mut StartTaskTurnInput,
    receipt: &Receipt,
    run_id: &str,
) -> Result<Option<StartTaskTurnInput>, String> {
    advance_receipt(connection, input, receipt, run_id)?;
    let next = summary_after_body(input, run_id, &receipt.result)?;
    if next.is_none() {
        retire_completed_root(connection, input)?;
    }
    Ok(next)
}

fn retire_completed_root(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
) -> Result<(), String> {
    let root = input
        .execution
        .as_ref()
        .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    crate::services::task_authorization_service::revoke_for_root(
        connection,
        &input.conversation_id,
        &root.root_turn_id,
        "根任务已完成应用，剩余额度终止",
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "task_runtime_followup_tests.rs"]
mod tests;

pub(super) fn mark_stopped(conversation_id: &str, error: &str) {
    if let Ok(mut pending) = PENDING.get_or_init(Default::default).lock() {
        if let Some(p) = pending.get_mut(conversation_id) {
            p.stop_reason = Some(safe_runtime_error(error));
        }
    }
}
pub(super) fn existing(input: &StartTaskTurnInput) -> Result<Option<TaskRuntimeResult>, String> {
    let pending = PENDING
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "DSH_ROOT_PENDING_LOCK_FAILED")?;
    let Some(p) = pending.get(&input.conversation_id) else {
        return Ok(None);
    };
    if p.input.turn_id != input.turn_id {
        return Ok(None);
    }
    if retry::model_identity(&p.input.model_snapshot)
        != retry::model_identity(&input.model_snapshot)
    {
        return Err("DSH_ROOT_DUPLICATE_IDENTITY_CONFLICT".into());
    }
    Ok(Some(p.result.clone()))
}
pub(super) fn supersede(conversation_id: &str, new_turn_id: &str) -> Option<String> {
    let removed = {
        let mut pending = PENDING.get_or_init(Default::default).lock().ok()?;
        if pending
            .get(conversation_id)
            .is_some_and(|p| p.input.turn_id != new_turn_id)
        {
            pending.remove(conversation_id)
        } else {
            None
        }
    }?;
    let execution = removed.input.execution?;
    execution.cancel.store(true, Ordering::SeqCst);
    Some(execution.root_turn_id)
}

pub(super) fn has_pending(conversation_id: &str, root_turn_id: &str) -> bool {
    PENDING
        .get_or_init(Default::default)
        .lock()
        .map(|p| {
            p.get(conversation_id).is_some_and(|v| {
                v.input
                    .execution
                    .as_ref()
                    .is_some_and(|r| r.root_turn_id == root_turn_id)
            })
        })
        .unwrap_or(false)
}
