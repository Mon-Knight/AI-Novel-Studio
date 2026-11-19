//! One authoritative transaction: grant/baseline/quality checks, write, receipt and quota CAS.
use super::super::task_authorization_contract::*;
use super::{baseline, error, load, receipts, validate_active};
use crate::{
    errors::AppError,
    services::{
        ai_fact_security, artifact_service, structured_artifact_apply_service as structured,
    },
};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde_json::{json, Value};

fn candidate_root(
    conn: &Connection,
    grant: &Authorization,
    input: &ApplyInput,
) -> Result<(artifact_service::ResultArtifactBundle, Value), AppError> {
    let row=conn.query_row("SELECT c.conversation_id,c.turn_id,r.model_snapshot_json,r.status FROM conversation_artifact_cards c JOIN task_runs r ON r.run_id=c.run_id WHERE c.card_id=?1 AND c.artifact_id=?2",
        params![input.card_id,input.artifact_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?)))
        .optional().map_err(AppError::database)?.ok_or_else(||error("TASK_AUTHORIZATION_CANDIDATE_INVALID","候选缺少权威运行来源"))?;
    let original_turn = row.1.as_deref() == Some(grant.source_turn_id.as_str());
    let linked:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM conversation_artifact_cards c JOIN tool_call_events e ON e.run_id=c.run_id WHERE c.card_id=?1 AND e.tool_name='dsh.execution_contract' AND e.status='succeeded' AND json_extract(e.arguments_summary_json,'$.execution.rootTaskId')=?2 AND json_extract(e.arguments_summary_json,'$.execution.rootTurnId')=?3)",params![input.card_id,grant.conversation_id,grant.source_turn_id],|r|r.get(0)).map_err(AppError::database)?;
    if row.0 != grant.conversation_id || !(original_turn || linked) || row.3 != "completed" {
        return Err(error(
            "TASK_AUTHORIZATION_SCOPE_INVALID",
            "候选不属于授权根任务、运行已取消或失败",
        ));
    }
    let model: Value = serde_json::from_str(&row.2)
        .map_err(|_| error("TASK_AUTHORIZATION_MODEL_INVALID", "运行模型快照不可读"))?;
    let bundle = artifact_service::get_artifact_bundle(conn, &input.artifact_id)?;
    if bundle.artifact.source_novel_id.as_deref() != Some(grant.novel_id.as_str())
        || bundle.artifact.artifact_type != input.action.artifact_type()
        || !matches!(
            bundle.artifact.processing_status.as_str(),
            "valid" | "valid_with_warnings"
        )
        || bundle.issues.iter().any(|i| i.severity == "error")
    {
        return Err(error(
            "TASK_AUTHORIZATION_CANDIDATE_INVALID",
            "候选作品、类型或校验状态不符合授权",
        ));
    }
    Ok((bundle, model))
}
fn plan_creation(
    conn: &Connection,
    grant: &Authorization,
    bundle: &artifact_service::ResultArtifactBundle,
) -> Result<(i64, i64), AppError> {
    let Some(volumes) = structured::preauthorized_plan_chapter_counts(bundle)? else {
        return Ok((0, 0));
    };
    let scope = grant.spec.creation_scope.as_ref().ok_or_else(|| {
        error(
            "TASK_AUTHORIZATION_CREATION_FORBIDDEN",
            "规划涉及新建卷章，但没有明确新建授权",
        )
    })?;
    let mut chapters = 0i64;
    for (index, count) in volumes.iter().enumerate() {
        let ordinal = index as i64 + 1;
        if ordinal < scope.first_volume_index || ordinal > scope.last_volume_index {
            return Err(error(
                "TASK_AUTHORIZATION_CREATION_SCOPE",
                "规划创建的卷超出授权区间",
            ));
        }
        chapters += *count;
    }
    let previous = receipts::list(conn, &grant.authorization_id)?;
    let used_volumes: i64 = previous
        .iter()
        .filter_map(|r| r.result.get("createdNewVolumes").and_then(Value::as_i64))
        .sum();
    let used_chapters: i64 = previous
        .iter()
        .filter_map(|r| r.result.get("createdNewChapters").and_then(Value::as_i64))
        .sum();
    if volumes.len() as i64 + used_volumes > scope.max_new_volumes
        || chapters + used_chapters > scope.max_new_chapters
    {
        return Err(error(
            "TASK_AUTHORIZATION_CREATION_QUOTA",
            "新建章节或卷数量超过授权额度",
        ));
    }
    Ok((volumes.len() as i64, chapters))
}
fn adopt(
    tx: &Transaction<'_>,
    grant: &Authorization,
    bundle: &artifact_service::ResultArtifactBundle,
    receipt_id: &str,
    now: &str,
) -> Result<Value, AppError> {
    let chapter = bundle
        .artifact
        .source_chapter_id
        .as_deref()
        .ok_or_else(|| error("TASK_AUTHORIZATION_SCOPE_INVALID", "正文必须绑定章节"))?;
    if bundle.raw_content.trim().is_empty() {
        return Err(error(
            "TASK_AUTHORIZATION_CANDIDATE_INVALID",
            "正文候选为空",
        ));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let version: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(version_no),0)+1 FROM chapter_drafts WHERE chapter_id=?1",
            [chapter],
            |r| r.get(0),
        )
        .map_err(AppError::database)?;
    let hash = crate::repositories::large_text_repository::sha256(&bundle.raw_content);
    if hash != bundle.artifact.content_hash {
        return Err(error(
            "TASK_AUTHORIZATION_CANDIDATE_INVALID",
            "候选全文哈希不一致",
        ));
    }
    use crate::repositories::{draft_repository, large_text_repository};
    let document_id = (bundle.raw_content.len()
        > large_text_repository::LARGE_TEXT_THRESHOLD_BYTES)
        .then(|| uuid::Uuid::new_v4().to_string());
    if let Some(document) = document_id.as_deref() {
        large_text_repository::insert_document(
            tx,
            document,
            &id,
            None,
            &bundle.raw_content,
            &hash,
            now,
        )?;
    }
    let stored = if document_id.is_some() {
        bundle.raw_content.chars().take(500).collect::<String>()
    } else {
        bundle.raw_content.clone()
    };
    draft_repository::insert_draft(
        tx,
        &id,
        &grant.novel_id,
        chapter,
        None,
        &stored,
        "ai_generated",
        version,
        crate::services::draft_service::word_count(&bundle.raw_content),
        None,
        Some(&format!("task_preauthorized:{receipt_id}")),
        document_id.as_deref(),
        &hash,
        now,
    )?;
    let stored_draft = draft_repository::find_draft(tx, &id)?
        .ok_or_else(|| error("TASK_AUTHORIZATION_ADOPT_FAILED", "持久草稿缺失"))?;
    let verified = crate::services::draft_service::load_full_content(tx, &stored_draft)?;
    if verified.content_hash != hash {
        return Err(error(
            "TASK_AUTHORIZATION_ADOPT_FAILED",
            "持久草稿全文校验失败",
        ));
    }
    let draft =
        crate::services::chapter_service::adopt_chapter_draft_in_transaction(tx, &id, chapter, now)
            .map_err(|m| error("TASK_AUTHORIZATION_ADOPT_FAILED", &m))?;
    crate::services::memory_service::put_task_authorized_draft_in_transaction(
        tx,
        &draft,
        &bundle.raw_content,
        receipt_id,
        now,
    )?;
    Ok(
        json!({"chapterId":chapter,"adoptedDraftId":id,"draftVersion":version,"contentHash":hash,
        "rootTurnId":grant.source_turn_id,"summaryFollowUp":{"status":"pending_generation","nextAction":"summarize_chapter",
        "rootTurnId":grant.source_turn_id,"chapterId":chapter,"adoptedDraftId":id,"authorityReceiptId":receipt_id}}),
    )
}
fn insert_body_decision(
    conn: &Connection,
    grant: &Authorization,
    input: &ApplyInput,
    bundle: &artifact_service::ResultArtifactBundle,
    receipt_id: &str,
    now: &str,
) -> Result<String, AppError> {
    let id = format!("decision-{}", uuid::Uuid::new_v4());
    conn.execute("INSERT INTO artifact_decisions(decision_id,artifact_id,artifact_hash,card_id,conversation_id,decision,idempotency_key,actor,target_type,target_id,base_revision,apply_transaction_id,created_at)
        VALUES(?1,?2,?3,?4,?5,'request_apply',?6,'task_preauthorized','chapter',?7,?8,?9,?10)",params![id,input.artifact_id,bundle.artifact.content_hash,input.card_id,grant.conversation_id,input.operation_id,
        bundle.artifact.source_chapter_id,bundle.artifact.source_base_content_hash,receipt_id,now]).map_err(AppError::database)?;
    Ok(id)
}
pub(super) fn apply(conn: &mut Connection, input: ApplyInput) -> Result<Receipt, AppError> {
    ai_fact_security::validate_identifier(&input.operation_id, "operationId", 160)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    if let Some(receipt) = receipts::replay(&tx, &input)? {
        tx.commit().map_err(AppError::database)?;
        return Ok(receipt);
    }
    let grant = load(&tx, &input.authorization_id)?;
    let (bundle, model) = candidate_root(&tx, &grant, &input)?;
    let base = validate_active(&tx, &grant, &model)?;
    receipts::ensure_quota(&tx, &grant, &input.action)?;
    receipts::validate_budget(&tx, &grant)?;
    let mut tracked = baseline::tracked(&base);
    if let Some(chapter) = bundle.artifact.source_chapter_id.as_ref() {
        if !tracked.contains(chapter) {
            return Err(error(
                "TASK_AUTHORIZATION_SCOPE_INVALID",
                "章节不在授权范围或本任务已提交的新建回执内",
            ));
        }
    } else if input.action != Action::ApplyPlanning || !grant.spec.allow_novel_planning {
        return Err(error(
            "TASK_AUTHORIZATION_SCOPE_INVALID",
            "未授权小说级规划应用",
        ));
    }
    // Shared source gates are native, not a client-supplied refreshed snapshot.
    let static_input = structured::ApplyStructuredArtifactInput {
        decision_id: format!("decision-{}", uuid::Uuid::new_v4()),
        artifact_id: input.artifact_id.clone(),
        artifact_hash: bundle.artifact.content_hash.clone(),
        card_id: input.card_id.clone(),
        conversation_id: grant.conversation_id.clone(),
        idempotency_key: input.operation_id.clone(),
        actor: "task_preauthorized".into(),
        target_type: "asset".into(),
        target_id: bundle
            .artifact
            .source_chapter_id
            .clone()
            .unwrap_or_else(|| grant.novel_id.clone()),
        novel_id: grant.novel_id.clone(),
        chapter_id: bundle.artifact.source_chapter_id.clone(),
        base_revision: bundle.artifact.source_base_content_hash.clone(),
        expected_rule_set_fingerprint: None,
        change_authorization: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    structured::validate_preauthorized_base(&tx, &static_input, &bundle)?;
    if input.action == Action::AdoptChapterText {
        crate::services::dsh::task_runtime::validate_candidate_for_application(
            &tx,
            &grant.conversation_id,
            &input.card_id,
            &input.artifact_id,
        )?;
    }
    let receipt_id = format!("task-write-{}", uuid::Uuid::new_v4());
    let now = static_input.created_at.clone();
    let mut result = if input.action == Action::AdoptChapterText {
        let mut value = adopt(&tx, &grant, &bundle, &receipt_id, &now)?;
        value["decisionId"] = json!(insert_body_decision(
            &tx,
            &grant,
            &input,
            &bundle,
            &receipt_id,
            &now
        )?);
        value
    } else {
        let (volumes, chapters) = if input.action == Action::ApplyPlanning {
            plan_creation(&tx, &grant, &bundle)?
        } else {
            (0, 0)
        };
        let decision = structured::apply_in_transaction(
            &tx,
            static_input,
            structured::ApplicationAuthority::TaskPreauthorization {
                authorization_id: &grant.authorization_id,
                receipt_id: &receipt_id,
            },
        )?;
        if let Some(code) = decision.conflict_code {
            return Err(error(&code, "候选应用发生冲突，未消费授权额度"));
        }
        if chapters > 0 {
            tracked = baseline::all_chapters(&tx, &grant.novel_id)?;
        }
        json!({"decisionId":decision.decision_id,"applyTransactionId":decision.apply_transaction_id,"createdNewVolumes":volumes,"createdNewChapters":chapters,"rootTurnId":grant.source_turn_id})
    };
    result["authority"] = json!("task_preauthorized");
    let after = baseline::capture(&tx, &grant.spec, &tracked)?;
    let receipt = Receipt {
        receipt_id,
        authorization_id: grant.authorization_id.clone(),
        operation_id: input.operation_id.clone(),
        conversation_id: grant.conversation_id.clone(),
        novel_id: grant.novel_id.clone(),
        artifact_id: input.artifact_id.clone(),
        card_id: input.card_id.clone(),
        action: input.action.clone(),
        authority: "task_preauthorized".into(),
        before_hash: grant.baseline_hash.clone(),
        after_hash: ai_fact_security::canonical_hash(&after)?,
        result,
        created_at: now,
        replayed: false,
    };
    receipts::insert(&tx, &input, &receipt)?;
    receipts::advance(&tx, &grant, &after)?;
    crate::repositories::conversation_repository::reconcile_conversation_status(
        &tx,
        &grant.conversation_id,
        "completed",
        &receipt.created_at,
    )?;
    tx.commit().map_err(|e| {
        AppError::new(
            "DATABASE_COMMIT_UNKNOWN",
            "授权应用提交结果未知；请按同一 operationId 核对回执，不能重新生成或换操作身份",
            true,
        )
        .with_details(json!({"sqliteError":e.to_string()}))
    })?;
    Ok(receipt)
}
