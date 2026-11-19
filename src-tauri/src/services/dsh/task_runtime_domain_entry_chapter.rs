//! Candidate chapter capability and isolated expert stage preparation.
use super::{context, scoped_plan, value_string, StartTaskTurnInput, TaskRuntimeResult};
use crate::repositories::{draft_repository, large_text_repository::sha256};
use crate::services::{artifact_service, autonomous_story_service, draft_service};
use rusqlite::Connection;
use serde_json::{json, Value};

#[path = "task_runtime_domain_entry_review.rs"]
mod review;
pub(super) const EXPERTS: [&str; 6] = [
    "outline",
    "character",
    "setting",
    "logic",
    "polish",
    "quality",
];

pub(super) fn save(connection: &mut Connection, mut plan: Value) -> Result<Value, String> {
    let revision = plan["revision"]
        .as_i64()
        .ok_or("DOMAIN_PLAN_REVISION_REQUIRED")?;
    plan["updatedAt"] = json!(chrono::Utc::now().to_rfc3339());
    autonomous_story_service::save_plan(connection, plan, revision)
        .map_err(|error| error.to_string())
}

pub(super) fn prepare(
    connection: &mut Connection,
    input: &mut StartTaskTurnInput,
    plan_id: &str,
    selection: Option<&str>,
) -> Result<Value, String> {
    let mut plan = scoped_plan(connection, input.require_novel_id()?, plan_id)?;
    if plan["status"] != "applied" {
        return Err("AUTONOMOUS_PLAN_NOT_APPLIED".to_string());
    }
    let selected = input
        .unified_runtime
        .as_ref()
        .and_then(|runtime| runtime.entry.as_ref())
        .and_then(|entry| entry.context.as_ref())
        .and_then(|context| context["chapterId"].as_str());
    let chapters = plan["chapters"]
        .as_array()
        .ok_or("DOMAIN_PLAN_CHAPTERS_INVALID")?;
    let runs = plan["chapterRuns"].as_array().cloned().unwrap_or_default();
    let chapter = if let Some(selected) = selected {
        chapters
            .iter()
            .find(|chapter| chapter["id"].as_str() == Some(selected))
    } else {
        chapters.iter().find(|chapter| {
            if chapter["status"] == "adopted" {
                return false;
            }
            if selection == Some("next_missing_candidate") {
                !runs.iter().rev().any(|run| {
                    run["chapterId"] == chapter["id"]
                        && matches!(run["status"].as_str(), Some("candidate_ready" | "adopted"))
                })
            } else {
                true
            }
        })
    }
    .cloned()
    .ok_or("AUTONOMOUS_NO_PENDING_CHAPTER")?;
    let chapter_id = value_string(&chapter, "id")?.to_string();
    if input
        .chapter_id
        .as_deref()
        .is_some_and(|id| id != chapter_id)
    {
        return Err("DOMAIN_ENTRY_SCOPE_MISMATCH".to_string());
    }
    input.chapter_id = Some(chapter_id.clone());
    draft_repository::validate_target(connection, input.require_novel_id()?, &chapter_id)
        .map_err(|error| error.to_string())?;
    let existing = runs
        .iter()
        .rposition(|run| run["chapterId"] == chapter["id"]);
    let index = existing.unwrap_or(runs.len());
    let mut run=existing.map(|index|runs[index].clone()).unwrap_or_else(||{
        let now=chrono::Utc::now().to_rfc3339();
        json!({"runId":input.turn_id,"operationId":format!("domain-chapter:{}:{chapter_id}",input.conversation_id),"chapterId":chapter_id,"chapterNumber":chapter["chapterNumber"],"status":"generating","plannedCharacterBeatIds":chapter["characterBeatIds"],"confirmedCharacterBeatIds":[],"createdAt":now,"updatedAt":now,
            "runtimeConversationId":input.conversation_id,"runtimeModelSnapshot":input.model_snapshot,"runtimeRound":1,"runtimeReviewArtifactIds":{}})
    });
    if matches!(run["status"].as_str(), Some("candidate_ready" | "adopted")) {
        return Ok(
            json!({"completed":true,"chapterId":chapter_id,"projection":{"plan":plan,"chapter":chapter,"run":run}}),
        );
    }
    if let Some(owner) = run["runtimeConversationId"].as_str() {
        if owner != input.conversation_id {
            return Err("DOMAIN_CHAPTER_TASK_CONFLICT".to_string());
        }
    }
    if existing.is_none() {
        plan["chapterRuns"] = json!(runs);
        plan["chapterRuns"]
            .as_array_mut()
            .unwrap()
            .push(run.clone());
        plan = save(connection, plan)?;
    }
    let has_draft = run["sourceDraftId"].is_string();
    if let Some(root) = input.execution.as_mut() {
        root.internal_revision = None;
    }
    let opinions = run["runtimeReviewArtifactIds"]
        .as_object()
        .cloned()
        .unwrap_or_default();
    let round = run["runtimeRound"].as_i64().unwrap_or(1);
    if !(1..=3).contains(&round) {
        return Err("DOMAIN_REVIEW_ROUND_LIMIT".to_string());
    }
    let mut stage = json!({"entryKind":"autonomous_chapter","stageKey":"write_candidate","chapterId":chapter_id,"planId":plan_id,"runIndex":index,"expectedRevision":plan["revision"],"chapter":chapter,"round":round});
    if !has_draft || opinions.len() == 6 {
        if has_draft {
            let draft_id = value_string(&run, "sourceDraftId")?;
            let draft = draft_repository::find_draft(connection, draft_id)
                .map_err(|error| error.to_string())?
                .ok_or("DOMAIN_SOURCE_DRAFT_MISSING")?;
            let verified = draft_service::load_full_content(connection, &draft)
                .map_err(|error| error.to_string())?;
            stage["sourceDraftId"] = json!(draft_id);
            stage["sourceHash"] = json!(verified.content_hash);
            stage["sourceContent"] = json!(verified.content);
            stage["sourceArtifactId"] = run["runtimeSourceArtifactId"].clone();
            if input.execution.is_some() {
                super::super::bind_child_revision(
                    connection,
                    input,
                    value_string(&stage, "sourceArtifactId")?,
                )?;
            }
            stage["review"] = json!(review::opinions(connection, &run)?);
            stage["stageKey"] = json!("revise_candidate");
            stage["taskKind"] = json!("chapter_polish");
        } else {
            stage["taskKind"] = json!("chapter_write");
        }
        stage["instructions"]=json!("按照冻结章节计划生成完整候选。修订时必须以sourceDraftId/sourceHash对应全文为唯一来源并落实review意见。正文仍只供审阅，不得采用或改写正式上下文。");
        input.chapter_host_gate = None;
    } else {
        let expert = EXPERTS
            .iter()
            .find(|expert| !opinions.contains_key(**expert))
            .ok_or("DOMAIN_REVIEW_STAGE_CONFLICT")?;
        let draft_id = value_string(&run, "sourceDraftId")?;
        let draft = draft_repository::find_draft(connection, draft_id)
            .map_err(|error| error.to_string())?
            .ok_or("DOMAIN_SOURCE_DRAFT_MISSING")?;
        let verified = draft_service::load_full_content(connection, &draft)
            .map_err(|error| error.to_string())?;
        stage["stageKey"] = json!(format!("review:{round}:{expert}"));
        stage["expert"] = json!(expert);
        stage["sourceDraftId"] = json!(draft_id);
        stage["sourceHash"] = json!(verified.content_hash);
        stage["sourceContent"] = json!(verified.content);
        stage["schema"] = super::candidate_schema::schema(
            "autonomous_chapter",
            stage["stageKey"].as_str().unwrap(),
        )?;
        stage["instructions"]=json!("只作为expert指定的一名专家独立评审当前sourceHash全文。返回score/accepted/summary/issues/suggestions；不得扮演其他专家、修改正文或采用候选。summary最多500字符，score为0至100整数。结构校验不证明语义正确。");
    }
    run["status"] = json!(if has_draft { "reviewing" } else { "generating" });
    Ok(stage)
}

pub(super) fn completed(
    connection: &Connection,
    plan_id: &str,
    chapter_id: &str,
) -> Result<bool, String> {
    let plan = autonomous_story_service::get_plan(connection, plan_id)
        .map_err(|error| error.to_string())?
        .ok_or("AUTONOMOUS_PLAN_NOT_FOUND")?;
    Ok(plan["chapterRuns"].as_array().is_some_and(|runs| {
        runs.iter()
            .rev()
            .find(|run| run["chapterId"].as_str() == Some(chapter_id))
            .is_some_and(|run| {
                matches!(run["status"].as_str(), Some("candidate_ready" | "adopted"))
            })
    }))
}

pub(super) fn accept(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    result: &TaskRuntimeResult,
) -> Result<(), String> {
    let stage = context(input)?;
    let plan_id = value_string(stage, "planId")?;
    let mut plan = scoped_plan(connection, input.require_novel_id()?, plan_id)?;
    if plan["revision"] != stage["expectedRevision"] {
        return Err("AUTONOMOUS_PLAN_STATE_CONFLICT".to_string());
    }
    let index = stage["runIndex"]
        .as_u64()
        .ok_or("DOMAIN_CHAPTER_RUN_MISSING")? as usize;
    let mut run = plan["chapterRuns"][index].clone();
    let artifact_id = result
        .artifact_id
        .as_deref()
        .ok_or("DOMAIN_CANDIDATE_REQUIRED")?;
    if matches!(input.task_kind.as_str(), "chapter_write" | "chapter_polish") {
        let artifact = artifact_service::get_artifact_bundle(connection, artifact_id)
            .map_err(|error| error.to_string())?;
        if artifact.artifact.source_novel_id != input.novel_id
            || artifact.artifact.source_chapter_id != input.chapter_id
            || artifact.artifact.artifact_type != "chapter_text"
            || !matches!(
                artifact.artifact.processing_status.as_str(),
                "valid" | "valid_with_warnings"
            )
        {
            return Err("DOMAIN_CANDIDATE_SCOPE_OR_VALIDATION_INVALID".to_string());
        }
        let draft = draft_service::save_chapter_draft_atomic_with_cleanup(
            connection,
            draft_service::SaveChapterDraftAtomicInput {
                operation_id: format!("domain-candidate:{artifact_id}"),
                trace_id: None,
                novel_id: input.require_novel_id()?.to_string(),
                chapter_id: input.chapter_id.clone().ok_or("DOMAIN_CHAPTER_REQUIRED")?,
                draft_id: None,
                draft_version: None,
                base_content_hash: None,
                current_content_hash: sha256(&artifact.raw_content),
                content: artifact.raw_content,
                word_count: None,
                source: "ai_generated".to_string(),
                title: stage["chapter"]["title"].as_str().map(str::to_string),
                ai_task_id: None,
                note: Some(format!("统一任务候选：{artifact_id}")),
                staging_session_id: None,
            },
            || Ok(()),
        )
        .map_err(|error| error.to_string())?
        .draft;
        if run["runtimeReviewArtifactIds"]
            .as_object()
            .is_some_and(|opinions| opinions.len() == 6)
        {
            review::commit_round(connection, &mut run, Some(&draft))?;
            run["runtimeRound"] = json!(run["runtimeRound"].as_i64().unwrap_or(1) + 1);
        }
        run["runtimeReviewArtifactIds"] = json!({});
        run["runtimeSourceArtifactId"] = json!(artifact_id);
        run["sourceDraftId"] = json!(draft.id);
        run["status"] = json!("reviewing");
        review::ensure_session(connection, input, &mut run, &draft)?;
    } else {
        let payload = super::candidate_payload(connection, input, result)?;
        super::candidate_schema::validate(&stage["schema"], &payload)?;
        let expert = value_string(stage, "expert")?;
        if !run["runtimeReviewArtifactIds"].is_object() {
            run["runtimeReviewArtifactIds"] = json!({});
        }
        run["runtimeReviewArtifactIds"][expert] = json!(artifact_id);
        if run["runtimeReviewArtifactIds"].as_object().unwrap().len() == 6 {
            let consensus = review::consensus(connection, &run)?;
            if consensus.action == "accept" || run["runtimeRound"].as_i64().unwrap_or(1) >= 3 {
                review::commit_round(connection, &mut run, None)?;
                review::complete(connection, &mut run, &consensus)?;
            }
        }
    }
    run["updatedAt"] = json!(chrono::Utc::now().to_rfc3339());
    plan["chapterRuns"][index] = run;
    plan["progress"]["lastCheckpoint"] = json!("章节受控阶段已保存；候选仍待人工采用");
    save(connection, plan).map(|_| ())
}
