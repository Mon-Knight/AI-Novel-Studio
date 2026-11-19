//! Candidate admission for deterministic assembly of verified native stage results.
//! This adapter is not a second host: the caller supplies an already completed root Run.
use super::*;

/// A reconciled assembly may only reuse the exact candidate and admission facts
/// committed by an earlier attempt. Ambiguous history fails closed.
fn existing_candidate(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
    content_hash: &str,
    evidence_hash: &str,
) -> Result<Option<(String, conversation_service::TaskRunRecord)>, String> {
    let mut statement = connection
        .prepare(
            "SELECT c.artifact_id,c.run_id FROM tool_call_events e
             JOIN conversation_artifact_cards c ON c.run_id=e.run_id
             JOIN task_runs r ON r.run_id=e.run_id
             WHERE r.conversation_id=?1 AND r.turn_id=?2 AND c.conversation_id=?1
               AND c.artifact_type='chapter_text'
               AND e.tool_name='dsh.assembled_candidate' AND e.status='succeeded'
               AND json_extract(e.arguments_summary_json,'$.rootTaskId')=?1
               AND json_extract(e.arguments_summary_json,'$.rootTurnId')=?2
               AND json_extract(e.arguments_summary_json,'$.contentHash')=?3
               AND json_extract(e.arguments_summary_json,'$.evidenceHash')=?4",
        )
        .map_err(|e| e.to_string())?;
    let matches = statement
        .query_map(
            rusqlite::params![input.conversation_id, input.turn_id, content_hash, evidence_hash],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if matches.is_empty() {
        return Ok(None);
    }
    if matches.len() != 1 {
        return Err("DSH_ASSEMBLY_RECONCILIATION_AMBIGUOUS".into());
    }
    let (artifact_id, run_id) = matches.into_iter().next().unwrap();
    let run = crate::repositories::conversation_repository::get_run(connection, &run_id)
        .map_err(|e| e.to_string())?
        .filter(|run| run.status == "completed")
        .ok_or("DSH_ASSEMBLY_RECONCILIATION_RUN_INVALID")?;
    Ok(Some((artifact_id, run)))
}

pub(crate) fn admit_host_candidate(
    connection: &mut rusqlite::Connection,
    input: &StartTaskTurnInput,
    result: &TaskRuntimeResult,
    text: &str,
    evidence: &Value,
) -> Result<TaskRuntimeResult, String> {
    let root = input
        .execution
        .as_ref()
        .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    root.check()?;
    if result.run.conversation_id != input.conversation_id
        || result.run.turn_id != input.turn_id
        || result.run.chapter_id != input.chapter_id
        || result.run.status != "completed"
        || result.artifact_id.is_some()
    {
        return Err("DSH_ASSEMBLY_SOURCE_RUN_INVALID".into());
    }
    if !evidence.is_object() || text.trim().is_empty() || text.len() > 4 * 1024 * 1024 {
        return Err("DSH_ASSEMBLY_EVIDENCE_INVALID".into());
    }
    let sources = assembly_evidence::verify(connection, input, text, evidence)?;
    let chapter = input
        .chapter_id
        .as_deref()
        .ok_or("DSH_CHAPTER_TARGET_REQUIRED")?;
    root.baseline(connection, input.require_novel_id()?, chapter)
        .map_err(|e| e.to_string())?;
    let mut admission = input.clone();
    admission.task_kind = "chapter_write".into();
    admission.expected_tool = Some("generate_chapter".into());
    admission.expected_artifact_type = Some("chapter_text".into());
    admission.chapter_word_range = input
        .chapter_word_range
        .clone()
        .or_else(|| root.writing_range.clone());
    if admission.chapter_word_range.is_none() {
        return Err("DSH_ASSEMBLY_WORD_RANGE_REQUIRED".into());
    }
    chapter_continuity::freeze_continuity(connection, &mut admission)?;
    if let Some(previous) = admission.verified_continuity.as_ref() {
        root.baseline(connection, input.require_novel_id()?, &previous.chapter_id)
            .map_err(|e| e.to_string())?;
    }
    validate_chapter_candidate_length(&admission, text).map_err(|e| e.to_string())?;
    let previous = admission.verified_continuity.as_ref();
    let pending = chapter_gate::PendingChapterCandidate {
        run_id: result.run.run_id.clone(),
        content_hash: large_text_repository::sha256(text),
        text: text.into(),
        word_count: crate::services::draft_service::word_count(text),
        previous_chapter_text: previous.map(|p| p.content.clone()),
        previous_chapter_id: previous.map(|p| p.chapter_id.clone()),
        previous_source_hash: previous.map(|p| p.source_hash.clone()),
    };
    let issues = coordinator::integrity::inspect(Some(root), &pending)?;
    if issues.iter().any(|i| i.severity == "error") {
        return Err("DSH_ASSEMBLY_INTEGRITY_ERROR_WITHHELD".into());
    }
    let hash = large_text_repository::sha256(text);
    let evidence_hash = large_text_repository::sha256(&evidence.to_string());
    let admission_gate = chapter_gate::ChapterHostGate {
        phase: "admit".into(),
        source_run_id: Some(result.run.run_id.clone()),
        content_hash: Some(hash.clone()),
        issue_codes: issues.iter().map(|i| i.code.clone()).collect(),
        issue_severities: issues.iter().map(|i| i.severity.clone()).collect(),
        max_integrity_repairs: Some(2),
        continues_run_id: None,
        explicit_retry: false,
    };
    if let Some((artifact_id, source_run)) =
        existing_candidate(connection, input, &hash, &evidence_hash)?
    {
        let bundle = artifact_service::get_artifact_bundle(connection, &artifact_id)
            .map_err(|e| e.to_string())?;
        if bundle.raw_content != text
            || bundle.artifact.content_hash != hash
            || bundle.artifact.source_novel_id.as_deref() != input.novel_id.as_deref()
            || bundle.artifact.source_chapter_id != input.chapter_id
        {
            return Err("DSH_ASSEMBLY_RECONCILIATION_ARTIFACT_MISMATCH".into());
        }
        let mut source_result = result.clone();
        source_result.run = source_run;
        source_result.artifact_id = Some(artifact_id.clone());
        admission.chapter_host_gate = Some(chapter_gate::ChapterHostGate {
            source_run_id: Some(source_result.run.run_id.clone()),
            ..admission_gate.clone()
        });
        let admitted: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tool_call_events WHERE event_id=?1 AND run_id=?2 AND tool_name='dsh.candidate_admission' AND status='succeeded')",
                rusqlite::params![format!("{}-native-admission", source_result.run.run_id), source_result.run.run_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !admitted {
            admission::record(connection, &admission, &source_result, &issues)?;
        }
        let mut reconciled = result.clone();
        reconciled.artifact_id = Some(artifact_id);
        reconciled.pending_chapter_candidate = None;
        reconciled.assistant_text = Some("已核对并复用原装配候选，没有重复创建候选或调用模型。未保存或采用正式正文。".into());
        return Ok(reconciled);
    }
    let generated = GeneratedChapterResult {
        host_assembly: Some(sources),
        text: text.into(),
        structured: json!({"ok":true,"candidateOnly":true,"artifactType":"chapter_text","data":{"novelId":input.novel_id,"chapterId":input.chapter_id,"text":text},"hostAssemblyEvidence":evidence}),
        provider_request_id: String::new(),
    };
    host_facts::append(connection,AppendToolEventInput{event_id:format!("{}-assembled-candidate",result.run.run_id),run_id:result.run.run_id.clone(),tool_name:"dsh.assembled_candidate".into(),arguments_summary:json!({"source":"ans-native-host","rootTaskId":input.conversation_id,"rootTurnId":root.root_turn_id,"contentHash":hash,"evidenceHash":evidence_hash}),status:"succeeded".into(),duration_ms:None,error:None,result:Some(json!({"candidateOnly":true,"evidence":evidence})),created_at:now(),finished_at:Some(now())}).map_err(|e|e.to_string())?;
    let artifact =
        create_artifact_projection(connection, &admission, &result.run.run_id, &generated, 0, 0)
            .map_err(|e| e.to_string())?
            .ok_or("DSH_ASSEMBLY_ARTIFACT_EMPTY")?;
    let mut result = result.clone();
    result.artifact_id = Some(artifact);
    result.pending_chapter_candidate = None;
    result.assistant_text=Some("已按核验阶段的真实顺序确定性组装候选；此组装步骤未调用模型，源调用用量保留在任务累计与来源清单中。未保存或采用正式正文。".into());
    admission.chapter_host_gate = Some(admission_gate);
    admission::record(connection, &admission, &result, &issues)?;
    Ok(result)
}
