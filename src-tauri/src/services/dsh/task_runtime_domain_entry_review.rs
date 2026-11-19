//! Multi-agent facts are projected from immutable per-expert artifacts.
use super::{value_string, EXPERTS};
use crate::repositories::{
    ai_task_repository, artifact_repository, draft_repository,
    large_text_repository::sha256,
    multi_agent_repository::{
        MultiAgentConsensusRecord, MultiAgentOpinionRecord, MultiAgentRoundRecord,
    },
};
use crate::services::{artifact_service, draft_service, multi_agent_service as review};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

pub(super) fn ensure_session(
    connection: &mut Connection,
    input: &super::StartTaskTurnInput,
    run: &mut Value,
    draft: &draft_service::AtomicDraftDto,
) -> Result<(), String> {
    if run["reviewSessionId"].is_string() {
        return Ok(());
    }
    let now = chrono::Utc::now().to_rfc3339();
    let result = review::create_session(
        connection,
        review::CreateMultiAgentSessionInput {
            session_id: uuid::Uuid::new_v4().to_string(),
            operation_id: format!("{}:review", value_string(run, "operationId")?),
            novel_id: input.require_novel_id()?.to_string(),
            chapter_id: draft.chapter_id.clone(),
            source_draft_id: draft.id.clone(),
            source_draft_version: draft.version_no,
            source_content_hash: sha256(&draft.content),
            expert_types: EXPERTS.iter().map(|expert| expert.to_string()).collect(),
            max_rounds: 3,
            acceptance_threshold: 0.75,
            minimum_average_score: 80.0,
            minimum_successful_experts: 4,
            created_at: now.clone(),
            updated_at: now,
        },
    )
    .map_err(|error| error.to_string())?;
    run["reviewSessionId"] = json!(result.session.session_id);
    Ok(())
}

pub(super) fn opinions(
    connection: &Connection,
    run: &Value,
) -> Result<Vec<MultiAgentOpinionRecord>, String> {
    let references = run["runtimeReviewArtifactIds"]
        .as_object()
        .ok_or("DOMAIN_REVIEW_ARTIFACTS_REQUIRED")?;
    let mut result = Vec::new();
    let round = run["runtimeRound"].as_i64().unwrap_or(1);
    for expert in EXPERTS {
        let Some(id) = references.get(expert).and_then(Value::as_str) else {
            continue;
        };
        let artifact = artifact_service::get_artifact_bundle(connection, id)
            .map_err(|error| error.to_string())?;
        verify_scope(connection, &artifact.artifact, run)?;
        let envelope: Value = serde_json::from_str(&artifact.raw_content)
            .map_err(|_| "DOMAIN_REVIEW_ARTIFACT_INVALID")?;
        if envelope["entryKind"] != "autonomous_chapter"
            || envelope["stageKey"] != format!("review:{round}:{expert}")
        {
            return Err("DOMAIN_REVIEW_ARTIFACT_INVALID".to_string());
        }
        let payload = &envelope["payload"];
        super::super::candidate_schema::validate(
            &super::super::candidate_schema::schema(
                "autonomous_chapter",
                envelope["stageKey"].as_str().unwrap(),
            )?,
            payload,
        )?;
        let attempt = ai_task_repository::find_attempt(
            connection,
            &artifact.artifact.task_id,
            &artifact.artifact.attempt_id,
        )
        .map_err(|error| error.to_string())?
        .ok_or("DOMAIN_REVIEW_ATTEMPT_REQUIRED")?;
        let metadata = attempt.response_metadata_json.unwrap_or(json!({}));
        let get_number = |key: &str| metadata[key].as_i64().unwrap_or(0).max(0);
        result.push(MultiAgentOpinionRecord {
            opinion_id: format!("opinion-{id}"),
            expert: expert.to_string(),
            status: "succeeded".to_string(),
            score: payload["score"].as_i64(),
            accepted: payload["accepted"].as_bool().unwrap(),
            summary: payload["summary"].as_str().unwrap().to_string(),
            issues: strings(payload, "issues")?,
            suggestions: strings(payload, "suggestions")?,
            provider: metadata["provider"].as_str().map(str::to_string),
            model: metadata["model"].as_str().map(str::to_string),
            ai_task_id: Some(artifact.artifact.task_id),
            tokens_input: get_number("tokenInput"),
            tokens_output: get_number("tokenOutput"),
            tokens_used: get_number("tokenTotal"),
            duration_ms: get_number("durationMs"),
            error_message: None,
        });
    }
    Ok(result)
}
fn strings(value: &Value, key: &str) -> Result<Vec<String>, String> {
    value[key]
        .as_array()
        .ok_or("DOMAIN_REVIEW_SCHEMA_INVALID")?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_string)
                .ok_or("DOMAIN_REVIEW_SCHEMA_INVALID".to_string())
        })
        .collect()
}
fn verify_scope(
    connection: &Connection,
    artifact: &artifact_repository::ResultArtifactRecord,
    run: &Value,
) -> Result<(), String> {
    if artifact.source_chapter_id.as_deref() != run["chapterId"].as_str()
        || !matches!(
            artifact.processing_status.as_str(),
            "valid" | "valid_with_warnings"
        )
    {
        return Err("DOMAIN_REVIEW_ARTIFACT_SCOPE_INVALID".to_string());
    }
    let linked:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM conversation_artifact_cards WHERE artifact_id=?1 AND conversation_id=?2)",params![artifact.artifact_id,value_string(run,"runtimeConversationId")?],|row|row.get(0)).map_err(|error|error.to_string())?;
    if !linked {
        return Err("DOMAIN_REVIEW_ARTIFACT_SCOPE_INVALID".to_string());
    }
    Ok(())
}

pub(super) fn consensus(
    connection: &Connection,
    run: &Value,
) -> Result<MultiAgentConsensusRecord, String> {
    let opinions = opinions(connection, run)?;
    let successful = opinions.len() as i64;
    let accepted = opinions.iter().filter(|opinion| opinion.accepted).count() as f64;
    let rate = if successful > 0 {
        accepted / successful as f64
    } else {
        0.0
    };
    let score = if successful > 0 {
        opinions
            .iter()
            .filter_map(|opinion| opinion.score)
            .sum::<i64>() as f64
            / successful as f64
    } else {
        0.0
    };
    let action = if successful >= 4 && rate >= 0.75 && score >= 80.0 {
        "accept"
    } else if successful >= 4 && score >= 60.0 {
        "revise"
    } else {
        "regenerate"
    };
    Ok(MultiAgentConsensusRecord {
        agreed: action == "accept",
        acceptance_rate: rate,
        average_score: score,
        successful_experts: successful,
        failed_experts: 0,
        required_successful_experts: 4,
        major_concerns: opinions
            .iter()
            .flat_map(|opinion| opinion.issues.clone())
            .collect(),
        merged_suggestions: opinions
            .iter()
            .flat_map(|opinion| opinion.suggestions.clone())
            .collect(),
        action: action.to_string(),
    })
}

pub(super) fn commit_round(
    connection: &mut Connection,
    run: &mut Value,
    output: Option<&draft_service::AtomicDraftDto>,
) -> Result<(), String> {
    let opinions = opinions(connection, run)?;
    if opinions.len() != 6 {
        return Err("DOMAIN_REVIEW_EXPERTS_INCOMPLETE".to_string());
    }
    let consensus = consensus(connection, run)?;
    let draft_id = value_string(run, "sourceDraftId")?;
    let draft = draft_repository::find_draft(connection, draft_id)
        .map_err(|error| error.to_string())?
        .ok_or("DOMAIN_SOURCE_DRAFT_MISSING")?;
    let verified =
        draft_service::load_full_content(connection, &draft).map_err(|error| error.to_string())?;
    let session_id = value_string(run, "reviewSessionId")?.to_string();
    let completed_at = run["runtimeReviewArtifactIds"]
        .as_object()
        .unwrap()
        .values()
        .filter_map(Value::as_str)
        .map(|id| {
            artifact_service::get_artifact_bundle(connection, id)
                .map(|bundle| bundle.artifact.created_at)
                .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .max()
        .ok_or("DOMAIN_REVIEW_ARTIFACTS_REQUIRED")?;
    let record = MultiAgentRoundRecord {
        round_number: run["runtimeRound"].as_i64().unwrap_or(1),
        input_draft_id: draft.id,
        input_draft_version: draft.version_no,
        input_content_hash: verified.content_hash,
        output_draft_id: output.map(|draft| draft.id.clone()),
        output_draft_version: output.map(|draft| draft.version_no),
        output_content_hash: output.map(|draft| sha256(&draft.content)),
        tokens_input: opinions.iter().map(|opinion| opinion.tokens_input).sum(),
        tokens_output: opinions.iter().map(|opinion| opinion.tokens_output).sum(),
        tokens_used: opinions.iter().map(|opinion| opinion.tokens_used).sum(),
        duration_ms: opinions.iter().map(|opinion| opinion.duration_ms).sum(),
        expert_opinions: opinions,
        consensus,
        started_at: value_string(run, "createdAt")?.to_string(),
        completed_at,
    };
    review::append_round(
        connection,
        review::AppendMultiAgentRoundInput {
            session_id,
            round: record,
        },
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub(super) fn complete(
    connection: &mut Connection,
    run: &mut Value,
    consensus: &MultiAgentConsensusRecord,
) -> Result<(), String> {
    let draft_id = value_string(run, "sourceDraftId")?.to_string();
    let bundle = review::complete_session(
        connection,
        review::CompleteMultiAgentSessionInput {
            session_id: value_string(run, "reviewSessionId")?.to_string(),
            status: "completed".to_string(),
            accepted: consensus.agreed,
            final_action: Some(consensus.action.clone()),
            final_draft_id: Some(draft_id.clone()),
            duration_ms: 0,
            error_message: None,
            completed_at: chrono::Utc::now().to_rfc3339(),
        },
    )
    .map_err(|error| error.to_string())?;
    run["status"] = json!("candidate_ready");
    run["candidateDraftId"] = json!(draft_id);
    run["reviewAccepted"] = json!(bundle.session.accepted);
    run["reviewAction"] = json!(consensus.action);
    run["averageScore"] = json!(consensus.average_score);
    run["acceptanceRate"] = json!(consensus.acceptance_rate);
    Ok(())
}
