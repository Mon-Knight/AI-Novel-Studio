//! Explicit user re-consent for a stale/legacy manual review. Never an automatic apply.
#[path = "task_authorization_review_resume.rs"]
mod resume;
use super::{baseline, error};
use crate::errors::AppError;
use crate::repositories::{conversation_repository as conversation, draft_repository};
use crate::services::{
    ai_fact_security, artifact_service, draft_service, task_authorization_contract::*,
};
use chrono::Utc;
pub use resume::{get_review_renewal, get_review_resume, validate_review_draft_binding};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

fn old_authorization(
    conn: &Connection,
    id: &str,
) -> Result<conversation::ReviewAuthorizationRecord, AppError> {
    conversation::get_review_authorization(conn, id)?
        .ok_or_else(|| error("REVIEW_AUTHORIZATION_NOT_FOUND", "原审阅授权不存在"))
}
fn evidence(preview: &ReviewRenewalPreview) -> Result<Value, AppError> {
    let mut value = serde_json::to_value(preview)
        .map_err(|_| error("REVIEW_RENEWAL_INVALID", "审阅预览无法序列化"))?;
    value
        .as_object_mut()
        .ok_or_else(|| error("REVIEW_RENEWAL_INVALID", "审阅预览无效"))?
        .remove("previewHash");
    Ok(value)
}
fn build_preview(
    conn: &Connection,
    input: &PreviewReviewRenewalInput,
) -> Result<ReviewRenewalPreview, AppError> {
    ai_fact_security::validate_identifier(&input.authorization_id, "authorizationId", 160)?;
    if let Some(id) = input.saved_draft_id.as_deref() {
        ai_fact_security::validate_identifier(id, "savedDraftId", 160)?;
    }
    let old = old_authorization(conn, &input.authorization_id)?;
    if !matches!(old.status.as_str(), "issued" | "expired" | "consumed") {
        return Err(error(
            "REVIEW_AUTHORIZATION_INVALID_STATUS",
            "原审阅授权状态未知，不能默认续用",
        ));
    }
    let decision = conversation::validate_review_decision_scope(
        conn,
        &old.decision_id,
        &old.artifact_id,
        &old.novel_id,
        &old.chapter_id,
    )?;
    conversation::validate_review_rule_baseline(conn, &old.artifact_id, &old.novel_id)?;
    let bundle = artifact_service::get_artifact_bundle(conn, &old.artifact_id)?;
    let chapter_baseline_hash =
        baseline::review_chapter_hash(conn, &old.novel_id, &old.chapter_id)?;
    let (chapter_revision,adopted_draft_id):(String,Option<String>)=conn.query_row("SELECT updated_at,adopted_draft_id FROM chapters WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL",params![old.chapter_id,old.novel_id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(AppError::database)?;
    let adopted_content_hash = if let Some(id) = adopted_draft_id.as_deref() {
        let draft = draft_repository::find_draft(conn, id)?
            .ok_or_else(|| error("REVIEW_RENEWAL_DRAFT_INVALID", "当前采用稿不存在"))?;
        Some(draft_service::load_full_content(conn, &draft)?.content_hash)
    } else {
        None
    };
    let saved_draft = if let Some(id) = input.saved_draft_id.as_deref() {
        let draft = draft_repository::find_draft(conn, id)?.ok_or_else(|| {
            error(
                "REVIEW_RENEWAL_DRAFT_INVALID",
                "已保存的审阅稿不存在，请先保存当前编辑",
            )
        })?;
        if draft.novel_id != old.novel_id || draft.chapter_id != old.chapter_id {
            return Err(error(
                "REVIEW_RENEWAL_SCOPE_CONFLICT",
                "审阅稿不属于原授权的作品与章节",
            ));
        }
        let full = draft_service::load_full_content(conn, &draft)?;
        Some(ReviewSavedDraft {
            draft_id: id.into(),
            draft_version: draft.version_no,
            content_hash: full.content_hash,
        })
    } else {
        None
    };
    let mut preview = ReviewRenewalPreview {
        authorization_id: old.authorization_id,
        card_id: decision.card_id,
        conversation_id: decision.conversation_id,
        novel_id: old.novel_id,
        chapter_id: old.chapter_id,
        artifact_id: old.artifact_id,
        artifact_hash: bundle.artifact.content_hash,
        chapter_baseline_hash,
        chapter_revision,
        adopted_draft_id,
        adopted_content_hash,
        saved_draft,
        preview_hash: String::new(),
    };
    preview.preview_hash = ai_fact_security::canonical_hash(&evidence(&preview)?)?;
    Ok(preview)
}
pub fn preview_review_renewal(
    conn: &mut Connection,
    input: PreviewReviewRenewalInput,
) -> Result<ReviewRenewalPreview, AppError> {
    let tx = conn.transaction().map_err(AppError::database)?;
    let preview = build_preview(&tx, &input)?;
    tx.commit().map_err(AppError::database)?;
    Ok(preview)
}
pub fn renew_review(
    conn: &mut Connection,
    input: RenewReviewInput,
) -> Result<conversation::ReviewAuthorizationRecord, AppError> {
    ai_fact_security::validate_identifier(&input.operation_id, "operationId", 160)?;
    if input.expected_preview_hash.len() != 64
        || !input
            .expected_preview_hash
            .bytes()
            .all(|b| b.is_ascii_hexdigit())
    {
        return Err(error(
            "REVIEW_RENEWAL_INVALID",
            "必须先查看原生审阅预览再明确确认",
        ));
    }
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let key = format!(
        "manual-review-renew-v1:{}",
        crate::repositories::large_text_repository::sha256(&input.operation_id)
    );
    let existing:Option<(String,Option<String>,Option<String>)>=tx.query_row("SELECT a.authorization_id,a.renewed_from_authorization_id,a.renewal_preview_json FROM review_authorizations a JOIN artifact_decisions d ON d.decision_id=a.decision_id WHERE d.idempotency_key=?1 AND d.decision='confirm'",[&key],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(AppError::database)?;
    if let Some((id, source, json)) = existing {
        let stored: ReviewRenewalPreview =
            serde_json::from_str(json.as_deref().ok_or_else(|| {
                error(
                    "REVIEW_RENEWAL_IDEMPOTENCY_CONFLICT",
                    "原操作缺少审阅签发证据",
                )
            })?)
            .map_err(|_| error("REVIEW_RENEWAL_IDEMPOTENCY_CONFLICT", "原操作审阅证据无效"))?;
        if source.as_deref() != Some(&input.authorization_id)
            || stored.authorization_id != input.authorization_id
            || stored.preview_hash != input.expected_preview_hash
            || stored.saved_draft.as_ref().map(|d| d.draft_id.as_str())
                != input.saved_draft_id.as_deref()
            || ai_fact_security::canonical_hash(&evidence(&stored)?)? != input.expected_preview_hash
        {
            return Err(error(
                "REVIEW_RENEWAL_IDEMPOTENCY_CONFLICT",
                "相同签发操作不能更换原授权、预览或审阅稿",
            ));
        }
        let result = old_authorization(&tx, &id)?;
        tx.commit().map_err(AppError::database)?;
        return Ok(result);
    }
    let preview = build_preview(
        &tx,
        &PreviewReviewRenewalInput {
            authorization_id: input.authorization_id.clone(),
            saved_draft_id: input.saved_draft_id.clone(),
        },
    )?;
    if preview.preview_hash != input.expected_preview_hash {
        return Err(error(
            "REVIEW_RENEWAL_BASE_CONFLICT",
            "预览后章节、候选或已保存稿发生变化；请保留编辑并重新查看基线，再明确确认",
        ));
    }
    let decision_id = format!("decision-{}", uuid::Uuid::new_v4());
    let authorization_id = format!("review-renewed-{}", uuid::Uuid::new_v4());
    let now = Utc::now().to_rfc3339();
    let bundle = artifact_service::get_artifact_bundle(&tx, &preview.artifact_id)?;
    tx.execute("INSERT INTO artifact_decisions(decision_id,artifact_id,artifact_hash,card_id,conversation_id,decision,idempotency_key,actor,target_type,target_id,base_revision,created_at)VALUES(?1,?2,?3,?4,?5,'confirm',?6,'user','chapter',?7,?8,?9)",params![decision_id,preview.artifact_id,preview.artifact_hash,preview.card_id,preview.conversation_id,key,preview.chapter_id,bundle.artifact.source_base_content_hash,now]).map_err(AppError::database)?;
    let stored = serde_json::to_value(&preview)
        .map_err(|_| error("REVIEW_RENEWAL_INVALID", "审阅证据无法序列化"))?;
    let result = conversation::issue_review_authorization_in_transaction(
        &tx,
        &authorization_id,
        &decision_id,
        &preview.artifact_id,
        &preview.novel_id,
        &preview.chapter_id,
        &now,
        Some((&input.authorization_id, &stored)),
    )?;
    tx.execute("UPDATE review_authorizations SET status='expired' WHERE authorization_id=?1 AND status='issued'",[&input.authorization_id]).map_err(AppError::database)?;
    conversation::reconcile_conversation_status(
        &tx,
        &preview.conversation_id,
        "waiting_user",
        &now,
    )?;
    tx.commit().map_err(|e| {
        AppError::new(
            "DATABASE_COMMIT_UNKNOWN",
            "新的审阅授权签发结果未知；请使用同一 operationId 核对，不要重复确认或重新生成",
            true,
        )
        .with_details(json!({"sqliteError":e.to_string()}))
    })?;
    Ok(result)
}

#[cfg(test)]
#[path = "task_authorization_review_renewal_tests.rs"]
mod tests;
