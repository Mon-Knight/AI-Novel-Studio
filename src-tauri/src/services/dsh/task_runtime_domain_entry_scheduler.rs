//! Scheduler state is the existing book Run/Attempt/lease. Only the root host
//! advances chapters; no renderer timer, nested executor or detached worker.
use super::{context, entry, scoped_plan, value_string, StartTaskTurnInput, TaskRuntimeResult};
use crate::services::{autonomous_scheduler_service as scheduler, multi_agent_service};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone)]
pub(crate) struct SchedulerState {
    pub run_id: String,
    pub plan_id: String,
    pub lease: scheduler::AutonomousRunLeaseProof,
    pub attempt_id: String,
    pub chapter_id: String,
    pub start_input: i64,
    pub start_output: i64,
    pub start_cost: f64,
}

fn state(input: &StartTaskTurnInput) -> Result<Arc<Mutex<SchedulerState>>, String> {
    entry(input)
        .and_then(|entry| entry.scheduler.clone())
        .ok_or("DOMAIN_SCHEDULER_STATE_REQUIRED".to_string())
}
fn usage(
    connection: &Connection,
    input: &StartTaskTurnInput,
) -> Result<super::super::RootUsage, String> {
    super::super::usage_for_root(connection, &input.conversation_id, &input.turn_id)
        .map_err(|error| error.to_string())
}

pub(super) fn prepare(
    connection: &mut Connection,
    input: &mut StartTaskTurnInput,
    run_id: &str,
    explicit_resume: bool,
) -> Result<Value, String> {
    let mut run = scheduler::get_run(connection, run_id)
        .map_err(|error| error.to_string())?
        .ok_or("AUTONOMOUS_RUN_NOT_FOUND")?;
    if run.novel_id != input.require_novel_id()? {
        return Err("DOMAIN_ENTRY_SCOPE_MISMATCH".to_string());
    }
    run.policy
        .validate(run.total_chapters)
        .map_err(|error| error.to_string())?;
    if explicit_resume && run.status == "paused" {
        run = scheduler::resume_run(
            connection,
            scheduler::ChangeAutonomousRunStateInput {
                operation_id: format!("domain-resume:{}", input.turn_id),
                run_id: run_id.to_string(),
                expected_revision: run.state_revision,
                reason: None,
            },
        )
        .map_err(|error| error.to_string())?;
    }
    if !matches!(run.status.as_str(), "queued" | "running") {
        return Ok(json!({"completed":true,"projection":run}));
    }
    let mut plan = scoped_plan(connection, input.require_novel_id()?, &run.plan_id)?;
    if let Some(bound) = plan["runtimeSchedulerTasks"].as_array().and_then(|tasks|tasks.iter().find(|task|task["runId"].as_str()==Some(run_id))) {
        if bound["conversationId"].as_str() != Some(&input.conversation_id) {
            return Err("DOMAIN_SCHEDULER_TASK_CONFLICT".to_string());
        }
    } else {
        if !plan["runtimeSchedulerTasks"].is_array() {plan["runtimeSchedulerTasks"] = json!([]);}
        plan["runtimeSchedulerTasks"].as_array_mut().unwrap().push(json!({"runId":run_id,"conversationId":input.conversation_id,"modelSnapshot":input.model_snapshot}));
        plan = super::chapter::save(connection, plan)?;
    }
    if let Some(previous) = entry(input).and_then(|entry| entry.scheduler.clone()) {
        let previous = previous
            .lock()
            .map_err(|_| "DOMAIN_SCHEDULER_LOCK_FAILED")?
            .clone();
        let attempt = scheduler::find_attempt(connection, &previous.attempt_id)
            .map_err(|error| error.to_string())?
            .ok_or("DOMAIN_SCHEDULER_ATTEMPT_NOT_FOUND")?;
        if run.status == "queued" && matches!(attempt.status.as_str(), "adopted" | "confirmed") {
            input
                .unified_runtime
                .as_mut()
                .and_then(|runtime| runtime.entry.as_mut())
                .unwrap()
                .scheduler = None;
        }
    }
    if entry(input)
        .and_then(|entry| entry.scheduler.as_ref())
        .is_none()
    {
        let grant = scheduler::acquire_lease(
            connection,
            scheduler::AcquireAutonomousRunLeaseInput {
                run_id: run_id.to_string(),
                owner_id: format!("domain-task:{}", input.conversation_id),
                ttl_seconds: Some(300),
            },
        )
        .map_err(|error| error.to_string())?;
        let lease = scheduler::AutonomousRunLeaseProof {
            lease_id: grant.lease.lease_id,
            epoch: grant.lease.epoch,
            token: grant.token,
        };
        let chapter = plan["chapters"]
            .as_array()
            .and_then(|chapters| {
                chapters.iter().find(|chapter| {
                    chapter["chapterNumber"].as_i64() == Some(run.next_chapter_number)
                })
            })
            .ok_or("DOMAIN_SCHEDULER_CHAPTER_MISSING")?;
        let estimated_tokens = chapter["targetWordCount"]
            .as_i64()
            .unwrap_or(2400)
            .saturating_mul(3)
            .clamp(2000, 10_000_000);
        let claim = scheduler::claim_chapter(
            connection,
            scheduler::ClaimAutonomousRunChapterInput {
                run_id: run_id.to_string(),
                lease: lease.clone(),
                estimated_tokens,
                estimated_cost_usd: estimated_tokens as f64 * 30.0 / 1_000_000.0,
            },
        )
        .map_err(|error| error.to_string())?;
        let usage = usage(connection, input)?;
        let state = SchedulerState {
            run_id: run_id.to_string(),
            plan_id: run.plan_id.clone(),
            lease,
            attempt_id: claim.attempt.attempt_id,
            chapter_id: claim.attempt.chapter_id,
            start_input: usage.token_input,
            start_output: usage.token_output,
            start_cost: usage.cost_usd,
        };
        input
            .unified_runtime
            .as_mut()
            .and_then(|runtime| runtime.entry.as_mut())
            .unwrap()
            .scheduler = Some(Arc::new(Mutex::new(state)));
    }
    let shared = state(input)?;
    let current = shared
        .lock()
        .map_err(|_| "DOMAIN_SCHEDULER_LOCK_FAILED")?
        .clone();
    scheduler::heartbeat(
        connection,
        scheduler::HeartbeatAutonomousRunInput {
            run_id: run_id.to_string(),
            lease: current.lease.clone(),
            ttl_seconds: Some(300),
        },
    )
    .map_err(|error| error.to_string())?;
    input.chapter_id = Some(current.chapter_id.clone());
    input
        .unified_runtime
        .as_mut()
        .and_then(|runtime| runtime.entry.as_mut())
        .unwrap()
        .context = Some(json!({"chapterId":current.chapter_id}));
    let mut stage = super::chapter::prepare(
        connection,
        input,
        &run.plan_id,
        Some("next_missing_candidate"),
    )?;
    stage["schedulerRunId"] = json!(run_id);
    stage["schedulerAttemptId"] = json!(current.attempt_id);
    stage["schedulerPolicy"] =
        serde_json::to_value(&run.policy).map_err(|error| error.to_string())?;
    stage["allowedChapterIds"] = json!(plan["chapters"]
        .as_array_mut()
        .unwrap()
        .iter()
        .take(run.policy.max_chapters as usize)
        .map(|chapter| chapter["id"].clone())
        .collect::<Vec<_>>());
    Ok(stage)
}

pub(super) fn after_candidate(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    result: &TaskRuntimeResult,
) -> Result<(), String> {
    if context(input)?["completed"] != true {
        if context(input)?["entryKind"] == "autonomous_post_chapter" {
            super::post_chapter::accept(connection, input, result)?;
        } else {
            super::chapter::accept(connection, input, result)?;
        }
    }
    Ok(())
}

pub(super) fn advance(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
) -> Result<bool, String> {
    let shared = state(input)?;
    let current = shared
        .lock()
        .map_err(|_| "DOMAIN_SCHEDULER_LOCK_FAILED")?
        .clone();
    if !super::chapter::completed(connection, &current.plan_id, &current.chapter_id)? {
        return Ok(false);
    }
    let run = scheduler::get_run(connection, &current.run_id)
        .map_err(|error| error.to_string())?
        .ok_or("AUTONOMOUS_RUN_NOT_FOUND")?;
    if !matches!(run.status.as_str(), "queued" | "running") {
        return Ok(true);
    }
    let persisted = scheduler::find_attempt(connection, &current.attempt_id)
        .map_err(|error| error.to_string())?
        .ok_or("DOMAIN_SCHEDULER_ATTEMPT_NOT_FOUND")?;
    if persisted.status != "claimed" {
        return Ok(run.status != "queued");
    }
    let plan = scoped_plan(connection, input.require_novel_id()?, &current.plan_id)?;
    let chapter_run = plan["chapterRuns"]
        .as_array()
        .and_then(|runs| {
            runs.iter()
                .rev()
                .find(|run| run["chapterId"] == current.chapter_id)
        })
        .ok_or("DOMAIN_CHAPTER_RUN_MISSING")?;
    let session = multi_agent_service::get_session_bundle(
        connection,
        value_string(chapter_run, "reviewSessionId")?,
    )
    .map_err(|error| error.to_string())?;
    let consensus = session
        .rounds
        .last()
        .map(|round| &round.consensus)
        .ok_or("DOMAIN_REVIEW_ROUND_MISSING")?;
    let usage = usage(connection, input)?;
    if !usage.usage_known {
        return Err("DOMAIN_SCHEDULER_USAGE_UNKNOWN".to_string());
    }
    let result = scheduler::finish_chapter(
        connection,
        scheduler::FinishAutonomousRunChapterInput {
            run_id: current.run_id.clone(),
            attempt_id: current.attempt_id.clone(),
            lease: current.lease.clone(),
            outcome: "candidate_ready".to_string(),
            token_input: Some(usage.token_input - current.start_input),
            token_output: Some(usage.token_output - current.start_output),
            cost_usd: Some((usage.cost_usd - current.start_cost).max(0.0)),
            candidate_draft_id: chapter_run["candidateDraftId"].as_str().map(str::to_string),
            adopted_draft_id: None,
            review_session_id: chapter_run["reviewSessionId"].as_str().map(str::to_string),
            successful_experts: Some(consensus.successful_experts),
            average_score: Some(consensus.average_score),
            acceptance_rate: Some(consensus.acceptance_rate),
            analysis_confirmed: Some(false),
            authorization_id: None,
            error: None,
        },
    )
    .map_err(|error| error.to_string())?;
    if result.run.status != "running" {
        return Ok(true);
    }
    let reservation = plan["chapters"]
        .as_array()
        .and_then(|chapters| {
            chapters.iter().find(|chapter| {
                chapter["chapterNumber"].as_i64() == Some(result.run.next_chapter_number)
            })
        })
        .ok_or("DOMAIN_SCHEDULER_CHAPTER_MISSING")?;
    let estimated_tokens = reservation["targetWordCount"]
        .as_i64()
        .unwrap_or(2400)
        .saturating_mul(3)
        .clamp(2000, 10_000_000);
    let claim = scheduler::claim_chapter(
        connection,
        scheduler::ClaimAutonomousRunChapterInput {
            run_id: current.run_id.clone(),
            lease: current.lease.clone(),
            estimated_tokens,
            estimated_cost_usd: estimated_tokens as f64 * 30.0 / 1_000_000.0,
        },
    )
    .map_err(|error| error.to_string())?;
    *shared.lock().map_err(|_| "DOMAIN_SCHEDULER_LOCK_FAILED")? = SchedulerState {
        attempt_id: claim.attempt.attempt_id,
        chapter_id: claim.attempt.chapter_id,
        start_input: usage.token_input,
        start_output: usage.token_output,
        start_cost: usage.cost_usd,
        ..current
    };
    Ok(false)
}

pub(crate) fn cleanup(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    reason: &str,
) -> Result<(), String> {
    let Some(super::DomainEntryInput {request:super::DomainEntryRequest::AutonomousScheduler{run_id,..},..})=entry(input)else{return Ok(());};
    let Some(run)=scheduler::get_run(connection,run_id).map_err(|error|error.to_string())?else{return Ok(());};
    if run.status!="running"{return Ok(());}
    let owned:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM autonomous_run_leases WHERE run_id=?1 AND owner_id=?2 AND status='active')",params![run_id,format!("domain-task:{}",input.conversation_id)],|row|row.get(0)).map_err(|error|error.to_string())?;
    if !owned{return Ok(());}
    scheduler::pause_run(
        connection,
        scheduler::ChangeAutonomousRunStateInput {
            operation_id: format!("domain-stop:{}", input.turn_id),
            run_id: run_id.clone(),
            expected_revision: run.state_revision,
            reason: Some(reason.chars().take(60).collect()),
        },
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}
