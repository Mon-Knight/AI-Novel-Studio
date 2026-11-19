//! Application gates read immutable execution contracts and real review facts.
use super::{
    context, entry, scoped_plan, value_string, DomainEntryRequest, StartTaskTurnInput,
    TaskRuntimeResult,
};
use crate::errors::AppError;
use crate::repositories::draft_repository;
use crate::services::{artifact_service, draft_service, multi_agent_service};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
fn denied() -> AppError {
    AppError::new(
        "DOMAIN_REVIEW_REQUIRED",
        "该章节必须完成任务限定的专家评审且达到冻结策略；预授权不能跳过该门禁",
        false,
    )
}

pub(crate) fn admission_policy(input: &StartTaskTurnInput) -> Option<Value> {
    let entry = entry(input)?;
    if matches!(entry.request,DomainEntryRequest::OutlineGenerate{..}) {return super::outline::admission_policy(input);}
    let kind = match entry.request {
        DomainEntryRequest::StyleAnalyze { .. } => "style_analyze",
        DomainEntryRequest::OutlineGenerate { .. } => "outline_generate",
        DomainEntryRequest::AutonomousChapter { .. } => "autonomous_chapter",
        DomainEntryRequest::AutonomousScheduler { .. } => "autonomous_scheduler",
        DomainEntryRequest::AutonomousPlan { .. } => "autonomous_plan",
        DomainEntryRequest::ChapterReadiness { .. } => "chapter_readiness",
        DomainEntryRequest::SettingSuggestions { .. } => "setting_suggestions",
        DomainEntryRequest::AutonomousPostChapter { .. } => "autonomous_post_chapter",
    };
    let stage = context(input).ok()?;
    Some(
        json!({"kind":kind,"planId":stage.get("planId"),"chapterId":input.chapter_id,"schedulerRunId":stage.get("schedulerRunId"),"requiredExperts":["outline","character","setting","logic","polish","quality"],
        "minimumSuccessfulExperts":stage.pointer("/schedulerPolicy/minimumSuccessfulExperts").and_then(Value::as_i64).unwrap_or(4),"minimumAverageScore":stage.pointer("/schedulerPolicy/minimumAverageScore").and_then(Value::as_f64).unwrap_or(80.0),"minimumAcceptanceRate":stage.pointer("/schedulerPolicy/minimumAcceptanceRate").and_then(Value::as_f64).unwrap_or(0.75)}),
    )
}

pub(crate) fn validate_application(
    connection: &Connection,
    conversation_id: &str,
    card_id: &str,
    artifact_id: &str,
) -> Result<(), AppError> {
    let row:Option<(String,String)>=connection.query_row("SELECT e.arguments_summary_json,r.chapter_id FROM conversation_artifact_cards c JOIN task_runs r ON r.run_id=c.run_id JOIN tool_call_events e ON e.run_id=r.run_id AND e.tool_name='dsh.execution_contract' WHERE c.card_id=?1 AND c.artifact_id=?2 AND c.conversation_id=?3",params![card_id,artifact_id,conversation_id],|row|Ok((row.get(0)?,row.get::<_,Option<String>>(1)?.unwrap_or_default()))).optional().map_err(AppError::database)?;
    let Some((contract, chapter_id)) = row else {
        return Err(denied());
    };
    let contract: Value = serde_json::from_str(&contract).map_err(|_| denied())?;
    let Some(policy) = contract
        .pointer("/execution/domainPolicy")
        .filter(|value| !value.is_null())
    else {
        return Ok(());
    };
    if !matches!(
        policy["kind"].as_str(),
        Some("autonomous_chapter" | "autonomous_scheduler")
    ) {
        return Ok(());
    }
    let novel=contract.get("novelId").and_then(Value::as_str).or_else(||contract.pointer("/execution/scope/novelId").and_then(Value::as_str)).filter(|novel|!novel.trim().is_empty()).ok_or_else(denied)?;
    let plan = scoped_plan(
        connection,
        novel,
        value_string(policy, "planId").map_err(|_| denied())?,
    )
    .map_err(|_| denied())?;
    let run = plan["chapterRuns"]
        .as_array()
        .and_then(|runs| {
            runs.iter().rev().find(|run| {
                run["chapterId"].as_str() == Some(&chapter_id)
                    && run["runtimeSourceArtifactId"].as_str() == Some(artifact_id)
            })
        })
        .ok_or_else(denied)?;
    if !matches!(run["status"].as_str(), Some("candidate_ready" | "adopted")) {
        return Err(denied());
    }
    let draft_id = value_string(run, "candidateDraftId").map_err(|_| denied())?;
    let session = multi_agent_service::get_session_bundle(
        connection,
        value_string(run, "reviewSessionId").map_err(|_| denied())?,
    )?;
    let round = session.rounds.last().ok_or_else(denied)?;
    let consensus = &round.consensus;
    if session.session.status != "completed"
        || session.session.final_draft_id.as_deref() != Some(draft_id)
        || round.expert_opinions.len() != 6
        || !super::chapter::EXPERTS.iter().all(|expert| {
            round
                .expert_opinions
                .iter()
                .any(|opinion| opinion.expert == *expert && opinion.status == "succeeded")
        })
        || consensus.successful_experts < policy["minimumSuccessfulExperts"].as_i64().unwrap_or(4)
        || consensus.average_score < policy["minimumAverageScore"].as_f64().unwrap_or(80.0)
        || consensus.acceptance_rate < policy["minimumAcceptanceRate"].as_f64().unwrap_or(0.75)
    {
        return Err(denied());
    }
    let artifact = artifact_service::get_artifact_bundle(connection, artifact_id)?;
    let draft = draft_repository::find_draft(connection, draft_id)?.ok_or_else(denied)?;
    let verified = draft_service::load_full_content(connection, &draft)?;
    if artifact.artifact.content_hash != verified.content_hash
        || artifact.artifact.source_chapter_id.as_deref() != Some(&chapter_id)
        || artifact.artifact.source_novel_id.as_deref() != plan["novelId"].as_str()
    {
        return Err(denied());
    }
    Ok(())
}

pub(crate) fn application_candidate(
    connection: &Connection,
    input: &StartTaskTurnInput,
    result: &TaskRuntimeResult,
) -> Result<Option<(String, String)>, String> {
    let Some(entry) = entry(input) else {
        return Ok(None);
    };
    if context(input)?["entryKind"] == "autonomous_post_chapter" {
        return Ok(None);
    }
    if !matches!(
        entry.request,
        DomainEntryRequest::AutonomousChapter { .. }
            | DomainEntryRequest::AutonomousScheduler { .. }
    ) {
        return Ok(None);
    }
    let stage = context(input)?;
    let plan_id = value_string(stage, "planId")?;
    let plan = scoped_plan(connection, input.require_novel_id()?, plan_id)?;
    let run = plan["chapterRuns"]
        .as_array()
        .and_then(|runs| {
            runs.iter()
                .rev()
                .find(|run| run["chapterId"].as_str() == input.chapter_id.as_deref())
        })
        .ok_or("DOMAIN_CHAPTER_RUN_MISSING")?;
    if !matches!(run["status"].as_str(), Some("candidate_ready" | "adopted")) {
        return Ok(None);
    }
    let artifact_id = value_string(run, "runtimeSourceArtifactId")?;
    let card_id=connection.query_row("SELECT card_id FROM conversation_artifact_cards WHERE conversation_id=?1 AND artifact_id=?2 ORDER BY created_at LIMIT 1",params![input.conversation_id,artifact_id],|row|row.get::<_,String>(0)).optional().map_err(|error|error.to_string())?.ok_or("DOMAIN_CANDIDATE_CARD_MISSING")?;
    validate_application(connection, &input.conversation_id, &card_id, artifact_id)
        .map_err(|error| error.to_string())?;
    let _ = result;
    Ok(Some((card_id, artifact_id.to_string())))
}
