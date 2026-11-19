//! Reconcile existing scheduler facts only from already committed native task
//! authorization receipts. This module never adopts a draft or applies context.
use super::{entry, DomainEntryRequest, StartTaskTurnInput};
use crate::repositories::large_text_repository::sha256;
use crate::services::{
    ai_fact_security, artifact_service, autonomous_scheduler_service as scheduler,
    task_authorization_contract::{Action, Receipt},
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

pub(crate) fn after_application(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    receipt: &Receipt,
) -> Result<(), String> {
    if let Some(super::DomainEntryInput {request:DomainEntryRequest::AutonomousChapter{plan_id,..}|DomainEntryRequest::AutonomousPostChapter{plan_id,..},..})=entry(input) {
        return project_receipt(connection,input,plan_id,receipt);
    }
    let Some(super::DomainEntryInput {
        request: DomainEntryRequest::AutonomousScheduler { run_id, .. },
        ..
    }) = entry(input)
    else {
        return Ok(());
    };
    if !matches!(
        receipt.action,
        Action::AdoptChapterText | Action::ApplySummary
    ) {
        return Ok(());
    }
    let run = scheduler::get_run(connection, run_id)
        .map_err(|error| error.to_string())?
        .ok_or("AUTONOMOUS_RUN_NOT_FOUND")?;
    if receipt.conversation_id != input.conversation_id
        || receipt.novel_id != run.novel_id
        || receipt.authority != "task_preauthorized"
    {
        return Err("DOMAIN_SCHEDULER_RECEIPT_SCOPE_MISMATCH".to_string());
    }
    let artifact = artifact_service::get_artifact_bundle(connection, &receipt.artifact_id)
        .map_err(|error| error.to_string())?;
    let chapter_id = artifact
        .artifact
        .source_chapter_id
        .as_deref()
        .ok_or("DOMAIN_SCHEDULER_RECEIPT_CHAPTER_REQUIRED")?;
    let raw:Option<String>=connection.query_row("SELECT result_json FROM task_authorization_receipts WHERE receipt_id=?1 AND authorization_id=?2 AND operation_id=?3 AND conversation_id=?4 AND novel_id=?5 AND artifact_id=?6 AND card_id=?7 AND action=?8",params![receipt.receipt_id,receipt.authorization_id,receipt.operation_id,receipt.conversation_id,receipt.novel_id,receipt.artifact_id,receipt.card_id,receipt.action.as_str()],|row|row.get(0)).optional().map_err(|error|error.to_string())?;
    if raw
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .as_ref()
        != Some(&receipt.result)
    {
        return Err("DOMAIN_SCHEDULER_RECEIPT_NOT_COMMITTED".to_string());
    }
    let adopted_draft:String=connection.query_row("SELECT adopted_draft_id FROM chapters WHERE id=?1 AND novel_id=?2 AND adopted_draft_id IS NOT NULL",params![chapter_id,run.novel_id],|row|row.get(0)).map_err(|error|error.to_string())?;
    if receipt.action == Action::AdoptChapterText
        && receipt.result["adoptedDraftId"].as_str() != Some(&adopted_draft)
    {
        return Err("DOMAIN_SCHEDULER_ADOPTION_CHANGED".to_string());
    }
    if receipt.action == Action::ApplySummary
        && artifact.artifact.source_draft_id.as_deref() != Some(&adopted_draft)
    {
        return Err("DOMAIN_SCHEDULER_SUMMARY_BASE_CHANGED".to_string());
    }
    let attempt_id:String=connection.query_row("SELECT attempt_id FROM autonomous_run_chapter_attempts WHERE run_id=?1 AND chapter_id=?2 AND status IN ('candidate_ready','adopted','confirmed') ORDER BY attempt_number DESC LIMIT 1",params![run_id,chapter_id],|row|row.get(0)).map_err(|error|error.to_string())?;
    let attempt = scheduler::find_attempt(connection, &attempt_id)
        .map_err(|error| error.to_string())?
        .ok_or("DOMAIN_SCHEDULER_ATTEMPT_NOT_READY")?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let replay:bool=transaction.query_row("SELECT EXISTS(SELECT 1 FROM autonomous_run_checkpoints WHERE run_id=?1 AND event_type='task_authorization_applied' AND json_extract(payload_json,'$.authorityReceiptId')=?2)",params![run_id,receipt.receipt_id],|row|row.get(0)).map_err(|error|error.to_string())?;
    if !replay {
        let confirmed = receipt.action == Action::ApplySummary;
        let status = if confirmed { "confirmed" } else { "adopted" };
        let decision = json!({"authority":"task_preauthorized","authorityReceiptId":receipt.receipt_id,"authorizationId":receipt.authorization_id,"action":receipt.action.as_str(),"adoptedDraftId":adopted_draft,"analysisConfirmed":confirmed});
        let canonical =
            ai_fact_security::canonical_json(&decision).map_err(|error| error.to_string())?;
        let changed=transaction.execute("UPDATE autonomous_run_chapter_attempts SET status=?1,adopted_draft_id=?2,analysis_confirmed=?3,decision_json=?4,decision_hash=?5 WHERE attempt_id=?6 AND status IN ('candidate_ready','adopted','confirmed')",params![status,adopted_draft,i64::from(confirmed),canonical,sha256(&canonical),attempt.attempt_id]).map_err(|error|error.to_string())?;
        if changed != 1 {
            return Err("DOMAIN_SCHEDULER_ATTEMPT_CONFLICT".to_string());
        }
        let advance = run.mode != "draft_night"
            && (confirmed || !run.policy.auto_confirm_analysis)
            && attempt.status != "confirmed"
            && !(attempt.status == "adopted" && !run.policy.auto_confirm_analysis);
        if advance {
            let updated=transaction.execute("UPDATE autonomous_book_runs SET status='queued',state_revision=state_revision+1,completed_chapters=completed_chapters+1,next_chapter_number=next_chapter_number+1,consecutive_failures=0,pause_reason=NULL,paused_at=NULL,updated_at=?1 WHERE run_id=?2 AND status='paused' AND state_revision=?3",params![receipt.created_at,run_id,run.state_revision]).map_err(|error|error.to_string())?;
            if updated != 1 {
                return Err("DOMAIN_SCHEDULER_RUN_CONFLICT".to_string());
            }
            if run.completed_chapters + 1 >= run.total_chapters.min(run.policy.max_chapters) {
                transaction.execute("UPDATE autonomous_book_runs SET status='running' WHERE run_id=?1 AND status='queued'",[run_id]).map_err(|error|error.to_string())?;
                transaction.execute("UPDATE autonomous_book_runs SET status='completed',completed_at=?1 WHERE run_id=?2 AND status='running'",params![receipt.created_at,run_id]).map_err(|error|error.to_string())?;
            }
        }
        let payload = json!({"authorityReceiptId":receipt.receipt_id,"authorizationId":receipt.authorization_id,"action":receipt.action.as_str(),"analysisConfirmed":confirmed});
        let payload_json =
            ai_fact_security::canonical_json(&payload).map_err(|error| error.to_string())?;
        let actual_status:String=transaction.query_row("SELECT status FROM autonomous_book_runs WHERE run_id=?1",[run_id],|row|row.get(0)).map_err(|error|error.to_string())?;
        transaction.execute("INSERT INTO autonomous_run_checkpoints(checkpoint_id,run_id,novel_id,sequence,event_type,attempt_id,run_status,payload_json,payload_hash,created_at)VALUES(?1,?2,?3,(SELECT COALESCE(MAX(sequence),0)+1 FROM autonomous_run_checkpoints WHERE run_id=?2),'task_authorization_applied',?4,?5,?6,?7,?8)",params![uuid::Uuid::new_v4().to_string(),run_id,run.novel_id,attempt.attempt_id,actual_status,payload_json,sha256(&payload_json),receipt.created_at]).map_err(|error|error.to_string())?;
    }
    transaction.commit().map_err(|_| {
        "DATABASE_COMMIT_UNKNOWN: 调度回执投影需按相同authorityReceiptId核对，不得重新采用"
            .to_string()
    })?;
    // Candidate/adoption checkpoints are domain projections. A CAS conflict here
    // never changes the already committed authorization receipt into cancellation.
    let mut plan = super::scoped_plan(connection, input.require_novel_id()?, &run.plan_id)?;
    if let Some(chapter) = plan["chapters"].as_array_mut().and_then(|chapters| {
        chapters
            .iter_mut()
            .find(|chapter| chapter["id"] == chapter_id)
    }) {
        chapter["status"] = json!("adopted");
    }
    if let Some(chapter_run) = plan["chapterRuns"].as_array_mut().and_then(|runs| {
        runs.iter_mut()
            .rev()
            .find(|run| run["chapterId"] == chapter_id)
    }) {
        chapter_run["status"] = json!("adopted");
        chapter_run["adoptedDraftId"] = json!(adopted_draft);
        if receipt.action == Action::ApplySummary {
            chapter_run["analysis"]["status"] = json!("confirmed");
            chapter_run["analysis"]["adoptedDraftId"] = json!(adopted_draft);
        }
    }
    super::chapter::save(connection, plan).map(|_| ())
}

fn project_receipt(connection:&mut Connection,input:&StartTaskTurnInput,plan_id:&str,receipt:&Receipt)->Result<(),String>{
    if !matches!(receipt.action,Action::AdoptChapterText|Action::ApplySummary){return Ok(());}
    if receipt.conversation_id!=input.conversation_id||receipt.novel_id!=input.require_novel_id()?||receipt.authority!="task_preauthorized"{return Err("DOMAIN_RECEIPT_SCOPE_MISMATCH".to_string());}
    let raw:Option<String>=connection.query_row("SELECT result_json FROM task_authorization_receipts WHERE receipt_id=?1 AND conversation_id=?2 AND artifact_id=?3 AND action=?4",params![receipt.receipt_id,input.conversation_id,receipt.artifact_id,receipt.action.as_str()],|row|row.get(0)).optional().map_err(|error|error.to_string())?;
    if raw.and_then(|raw|serde_json::from_str::<Value>(&raw).ok()).as_ref()!=Some(&receipt.result){return Err("DOMAIN_RECEIPT_NOT_COMMITTED".to_string());}
    let artifact=artifact_service::get_artifact_bundle(connection,&receipt.artifact_id).map_err(|error|error.to_string())?;
    let chapter_id=artifact.artifact.source_chapter_id.as_deref().ok_or("DOMAIN_RECEIPT_CHAPTER_REQUIRED")?;
    let adopted:String=connection.query_row("SELECT adopted_draft_id FROM chapters WHERE id=?1 AND novel_id=?2",params![chapter_id,input.novel_id],|row|row.get(0)).map_err(|error|error.to_string())?;
    if receipt.action==Action::AdoptChapterText&&receipt.result["adoptedDraftId"].as_str()!=Some(&adopted){return Err("DOMAIN_ADOPTED_BASELINE_CHANGED".to_string());}
    if receipt.action==Action::ApplySummary&&artifact.artifact.source_draft_id.as_deref()!=Some(&adopted){return Err("DOMAIN_ADOPTED_BASELINE_CHANGED".to_string());}
    let mut plan=super::scoped_plan(connection,input.require_novel_id()?,plan_id)?;
    if let Some(chapter)=plan["chapters"].as_array_mut().and_then(|chapters|chapters.iter_mut().find(|chapter|chapter["id"]==chapter_id)){chapter["status"]=json!("adopted");}
    if let Some(run)=plan["chapterRuns"].as_array_mut().and_then(|runs|runs.iter_mut().rev().find(|run|run["chapterId"]==chapter_id)){
        run["status"]=json!("adopted");run["adoptedDraftId"]=json!(adopted);
        if receipt.action==Action::ApplySummary{run["analysis"]["status"]=json!("confirmed");run["analysis"]["adoptedDraftId"]=json!(adopted);}
    }
    super::chapter::save(connection,plan).map(|_|())
}
