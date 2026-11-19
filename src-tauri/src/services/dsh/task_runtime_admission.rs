//! Native admission evidence and revalidation before task-preauthorized formal use.
use super::*;

const POLICY: &str = "ans_chapter_integrity_native_v1";
fn policy_hash() -> String {
    large_text_repository::sha256(&format!(
        "{}{}{}",
        include_str!("../../../../scripts/dsh/chapter-integrity.mjs"),
        include_str!("../../../../scripts/dsh/chapter-integrity-boundary.mjs"),
        include_str!("../../../../scripts/dsh/chapter-integrity-narrative.mjs")
    ))
}

pub(super) fn record(
    connection: &mut rusqlite::Connection,
    input: &StartTaskTurnInput,
    result: &TaskRuntimeResult,
    issues: &[coordinator::integrity::Issue],
) -> Result<(), String> {
    let artifact_id = result
        .artifact_id
        .as_deref()
        .ok_or("DSH_CHAPTER_ADMISSION_EMPTY")?;
    let gate = input
        .chapter_host_gate
        .as_ref()
        .ok_or("DSH_CHAPTER_ADMISSION_IDENTITY_REQUIRED")?;
    let root = input
        .execution
        .as_ref()
        .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    if gate.phase != "admit"
        || result.run.status != "completed"
        || issues.iter().any(|i| i.severity == "error")
    {
        return Err("DSH_CHAPTER_ADMISSION_INVALID".into());
    }
    host_facts::append(connection,AppendToolEventInput{
        event_id:format!("{}-native-admission",result.run.run_id),run_id:result.run.run_id.clone(),tool_name:"dsh.candidate_admission".into(),
        arguments_summary:json!({"source":"ans-native-host","policy":POLICY,"policyHash":policy_hash(),"rootTaskId":input.conversation_id,"rootTurnId":root.root_turn_id,
            "novelId":input.novel_id,"chapterId":input.chapter_id,"artifactId":artifact_id,"contentHash":gate.content_hash,"wordRange":input.chapter_word_range,
            "previousChapterId":input.verified_continuity.as_ref().map(|v|&v.chapter_id),"previousSourceHash":input.verified_continuity.as_ref().map(|v|&v.source_hash)}),
        status:"succeeded".into(),duration_ms:None,error:None,result:Some(json!({"issues":issues,"semanticRules":"not_checked","formalWrite":false})),created_at:now(),finished_at:Some(now()),
    }).map_err(|e|e.to_string())?;
    Ok(())
}

/// Finite checks and continuity are re-evaluated at the authoritative application boundary.
/// Neither a renderer issue list nor a model's declaration of completion is a proof.
pub fn validate_candidate_for_application(
    connection: &rusqlite::Connection,
    conversation_id: &str,
    card_id: &str,
    artifact_id: &str,
) -> Result<(), AppError> {
    let invalid = |message: &str| AppError::new("DSH_CHAPTER_ADMISSION_REQUIRED", message, false);
    let (run_id,chapter_id,status,model_text):(String,String,String,String)=connection.query_row(
        "SELECT r.run_id,r.chapter_id,r.status,r.model_snapshot_json FROM conversation_artifact_cards c JOIN task_runs r ON r.run_id=c.run_id
         WHERE c.card_id=?1 AND c.artifact_id=?2 AND c.conversation_id=?3 AND c.artifact_type='chapter_text'",
        rusqlite::params![card_id,artifact_id,conversation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)),
    ).optional().map_err(AppError::database)?.ok_or_else(||invalid("正文候选缺少本任务原生运行来源"))?;
    if status != "completed" {
        return Err(invalid("正文候选尚未完成原生准入"));
    }
    let metadata:String=connection.query_row("SELECT arguments_summary_json FROM tool_call_events WHERE event_id=?1 AND run_id=?2 AND tool_name='dsh.candidate_admission' AND status='succeeded'",rusqlite::params![format!("{run_id}-native-admission"),run_id],|r|r.get(0)).optional().map_err(AppError::database)?.ok_or_else(||invalid("缺少原生完整性检查回执"))?;
    let metadata: Value =
        serde_json::from_str(&metadata).map_err(|_| invalid("原生准入回执不可读"))?;
    domain_entry::validate_application(connection, conversation_id, card_id, artifact_id)?;
    let execution:String=connection.query_row("SELECT arguments_summary_json FROM tool_call_events WHERE run_id=?1 AND tool_name='dsh.execution_contract' AND status='succeeded'",[&run_id],|r|r.get(0)).map_err(AppError::database)?;
    let execution: Value =
        serde_json::from_str(&execution).map_err(|_| invalid("执行领域策略不可读"))?;
    if execution
        .pointer("/execution/requiresDomainPolicy")
        .and_then(Value::as_bool)
        == Some(true)
        && !execution
            .pointer("/execution/domainPolicy")
            .is_some_and(Value::is_object)
    {
        return Err(invalid("领域写章缺少冻结的强制评审策略"));
    }
    let bundle = artifact_service::get_artifact_bundle(connection, artifact_id)?;
    if metadata["source"] != "ans-native-host"
        || metadata["policy"] != POLICY
        || metadata["policyHash"] != policy_hash()
        || metadata["artifactId"] != artifact_id
        || metadata["chapterId"] != chapter_id
        || metadata["rootTaskId"] != conversation_id
        || metadata["novelId"] != json!(bundle.artifact.source_novel_id)
        || metadata["contentHash"] != bundle.artifact.content_hash
        || bundle.artifact.source_chapter_id.as_deref() != Some(chapter_id.as_str())
        || large_text_repository::sha256(&bundle.raw_content) != bundle.artifact.content_hash
    {
        return Err(invalid("原生准入回执与候选范围、全文哈希或检查版本不匹配"));
    }
    let previous = chapter_continuity::load_previous(
        connection,
        bundle
            .artifact
            .source_novel_id
            .as_deref()
            .ok_or_else(|| invalid("资料库候选不能进入正文采用门禁"))?,
        &chapter_id,
    )
    .map_err(|e| invalid(&e))?;
    if metadata.get("previousChapterId").and_then(Value::as_str)
        != previous.as_ref().map(|v| v.chapter_id.as_str())
        || metadata.get("previousSourceHash").and_then(Value::as_str)
            != previous.as_ref().map(|v| v.source_hash.as_str())
    {
        return Err(invalid("前章采用稿已变化，原候选准入基线失效"));
    }
    let range: ChapterWordRangeInput = serde_json::from_value(metadata["wordRange"].clone())
        .map_err(|_| invalid("缺少原冻结字数区间"))?;
    let count = crate::services::draft_service::word_count(&bundle.raw_content);
    if range.minimum <= 0
        || range.minimum > range.target
        || range.target > range.maximum
        || !(range.minimum..=range.maximum).contains(&count)
    {
        return Err(invalid("正文不再满足冻结字数区间"));
    }
    staged::validate_application_bundle(connection, conversation_id, card_id, &bundle)?;
    let pending = chapter_gate::PendingChapterCandidate {
        run_id,
        content_hash: bundle.artifact.content_hash.clone(),
        text: bundle.raw_content,
        word_count: count,
        previous_chapter_text: previous.as_ref().map(|v| v.content.clone()),
        previous_chapter_id: previous.as_ref().map(|v| v.chapter_id.clone()),
        previous_source_hash: previous.map(|v| v.source_hash),
    };
    let issues = coordinator::integrity::inspect(None, &pending).map_err(|e| invalid(&e))?;
    if issues.iter().any(|i| i.severity == "error") {
        return Err(invalid(
            "正文有限完整性检查存在阻断错误；必须人工处理，不能预授权代替审阅",
        ));
    }
    let _: Value = serde_json::from_str(&model_text).map_err(|_| invalid("运行模型快照不可读"))?;
    Ok(())
}
