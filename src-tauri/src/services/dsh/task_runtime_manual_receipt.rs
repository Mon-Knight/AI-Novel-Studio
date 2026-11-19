//! A manual adoption remains a real human decision. Its exact committed after-state
//! is pinned in the same native transaction before any automatic follow-up resumes.
use super::*;

pub fn record_manual_adoption(
    connection: &rusqlite::Connection,
    result: &conversation_service::AdoptReviewAuthorizedDraftResult,
) -> Result<(), AppError> {
    let existing:Option<String>=connection.query_row("SELECT event_id FROM tool_call_events WHERE event_id=?1 AND tool_name='dsh.manual_application_receipt'",[format!("manual-adoption-{}",result.authorization.authorization_id)],|r|r.get(0)).optional().map_err(AppError::database)?;
    if existing.is_some() {
        return Ok(());
    }
    let source:Option<(String,String,String)>=connection.query_row("SELECT c.conversation_id,c.run_id,e.arguments_summary_json FROM conversation_artifact_cards c JOIN tool_call_events e ON e.run_id=c.run_id AND e.tool_name='dsh.execution_contract' AND e.status='succeeded' WHERE c.artifact_id=?1",[&result.authorization.artifact_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(AppError::database)?;
    let Some((conversation, run_id, contract)) = source else {
        return Ok(());
    };
    let contract: Value = serde_json::from_str(&contract)
        .map_err(|_| AppError::new("DSH_ROOT_RECEIPT_INVALID", "原生根执行契约不可读", false))?;
    let Some(root_turn) = contract
        .pointer("/execution/rootTurnId")
        .and_then(Value::as_str)
    else {
        return Ok(());
    };
    if contract
        .pointer("/execution/rootTaskId")
        .and_then(Value::as_str)
        != Some(conversation.as_str())
        || result.authorization.status != "consumed"
        || result.authorization.consumed_by_draft_id.as_deref()
            != Some(result.adopted_draft.id.as_str())
    {
        return Err(AppError::new(
            "DSH_ROOT_RECEIPT_INVALID",
            "人工采用回执不匹配原任务",
            false,
        ));
    }
    let after = read_chapter_base_snapshot(
        connection,
        &result.authorization.novel_id,
        &result.authorization.chapter_id,
    )?;
    if after.draft_id.as_deref() != Some(result.adopted_draft.id.as_str())
        || after.draft_version != Some(result.adopted_draft.version_no)
    {
        return Err(AppError::new(
            "DSH_ROOT_RECEIPT_INVALID",
            "人工采用后状态与事务结果不匹配",
            false,
        ));
    }
    let event_id = format!("manual-adoption-{}", result.authorization.authorization_id);
    let args = json!({"source":"ans-native-host","authority":"human_review","rootTaskId":conversation,"rootTurnId":root_turn,"authorizationId":result.authorization.authorization_id,"artifactId":result.authorization.artifact_id,"chapterId":result.authorization.chapter_id,"after":after});
    connection.execute("INSERT INTO tool_call_events(event_id,run_id,sequence,tool_name,arguments_summary_json,status,result_json,created_at,finished_at) VALUES(?1,?2,(SELECT COALESCE(MAX(sequence),-1)+1 FROM tool_call_events WHERE run_id=?2),'dsh.manual_application_receipt',?3,'succeeded',?4,?5,?5)",rusqlite::params![event_id,run_id,args.to_string(),json!({"committedByOwningTransaction":true}).to_string(),now()]).map_err(AppError::database)?;
    Ok(())
}

/// Called only from the successful ManualReview branch inside its existing transaction.
/// The effect set is explicit: one source chapter, or newly-created story-plan chapters.
pub fn record_manual_structured_application(
    connection: &rusqlite::Connection,
    decision: &conversation_service::ArtifactDecisionRecord,
) -> Result<(), AppError> {
    if decision.decision != "request_apply"
        || decision.conflict_code.is_some()
        || decision.apply_transaction_id.is_none()
    {
        return Ok(());
    }
    let invalid = |message: &str| AppError::new("DSH_ROOT_RECEIPT_INVALID", message, false);
    if decision.actor == "task_preauthorized" {
        return Err(invalid("预授权不能伪造人工应用回执"));
    }
    let event_id = format!("manual-structured-{}", decision.decision_id);
    let exists:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM tool_call_events WHERE event_id=?1 AND tool_name='dsh.manual_application_receipt')",[&event_id],|r|r.get(0)).map_err(AppError::database)?;
    if exists {
        return Ok(());
    }
    let source:Option<(String,String)>=connection.query_row("SELECT c.run_id,e.arguments_summary_json FROM conversation_artifact_cards c JOIN tool_call_events e ON e.run_id=c.run_id AND e.tool_name='dsh.execution_contract' AND e.status='succeeded' WHERE c.card_id=?1 AND c.artifact_id=?2 AND c.conversation_id=?3",rusqlite::params![decision.card_id,decision.artifact_id,decision.conversation_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(AppError::database)?;
    let Some((run_id, contract)) = source else {
        return Ok(());
    };
    let contract: Value = serde_json::from_str(&contract).map_err(|_| invalid("执行契约不可读"))?;
    let Some(root_turn) = contract
        .pointer("/execution/rootTurnId")
        .and_then(Value::as_str)
    else {
        return Ok(());
    };
    if contract
        .pointer("/execution/rootTaskId")
        .and_then(Value::as_str)
        != Some(decision.conversation_id.as_str())
    {
        return Err(invalid("应用根任务不匹配"));
    }
    let bundle = artifact_service::get_artifact_bundle(connection, &decision.artifact_id)?;
    if bundle.artifact.content_hash != decision.artifact_hash {
        return Err(invalid("应用候选哈希不匹配"));
    }
    let novel = bundle
        .artifact
        .source_novel_id
        .as_deref()
        .ok_or_else(|| invalid("资料库候选不能写入小说事实"))?;
    let mut after = HashMap::new();
    let mut resume_allowed = true;
    if let Some(chapter) = bundle.artifact.source_chapter_id.as_deref() {
        after.insert(
            chapter.to_string(),
            read_chapter_base_snapshot(connection, novel, chapter)?,
        );
    } else if bundle.artifact.artifact_type == "outline" {
        let payload: Value =
            serde_json::from_str(&bundle.raw_content).map_err(|_| invalid("规划候选不可读"))?;
        if payload.get("planKind").and_then(Value::as_str) == Some("story_plan") {
            let previous: HashMap<String, ChapterBaseSnapshot> = serde_json::from_value(
                contract
                    .pointer("/execution/chapterBaselines")
                    .cloned()
                    .ok_or_else(|| invalid("原根章节范围缺失"))?,
            )
            .map_err(|_| invalid("原根章节范围无效"))?;
            let mut statement = connection
                .prepare("SELECT id FROM chapters WHERE novel_id=?1 AND deleted_at IS NULL")
                .map_err(AppError::database)?;
            let ids = statement
                .query_map([novel], |r| r.get::<_, String>(0))
                .map_err(AppError::database)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::database)?;
            for id in ids {
                if !previous.contains_key(&id) {
                    after.insert(
                        id.clone(),
                        read_chapter_base_snapshot(connection, novel, &id)?,
                    );
                }
            }
            let expected = payload.get("volumes").and_then(Value::as_array).map(|v| {
                v.iter()
                    .filter_map(|v| v.get("chapters").and_then(Value::as_array))
                    .map(Vec::len)
                    .sum::<usize>()
            });
            resume_allowed = expected == Some(after.len());
        } else {
            resume_allowed = false;
        }
    }
    let rules =
        crate::services::world_rule_governance::rule_set_snapshot(connection, novel)?.fingerprint;
    let args = json!({"source":"ans-native-host","authority":"human_review","rootTaskId":decision.conversation_id,"rootTurnId":root_turn,"decisionId":decision.decision_id,"artifactId":decision.artifact_id,
        "applyTransactionId":decision.apply_transaction_id,"afterChapters":after,"rulesAfter":rules,"resumeAllowed":resume_allowed});
    connection.execute("INSERT INTO tool_call_events(event_id,run_id,sequence,tool_name,arguments_summary_json,status,result_json,created_at,finished_at) VALUES(?1,?2,(SELECT COALESCE(MAX(sequence),-1)+1 FROM tool_call_events WHERE run_id=?2),'dsh.manual_application_receipt',?3,'succeeded',?4,?5,?5)",rusqlite::params![event_id,run_id,args.to_string(),json!({"committedByOwningTransaction":true,"resumeAllowed":resume_allowed}).to_string(),now()]).map_err(AppError::database)?;
    Ok(())
}
