//! Read-only recovery of explicit human review consent and native saved-draft lineage.
use super::{evidence, old_authorization};
use crate::{
    errors::AppError,
    repositories::{
        conversation_repository as conversation, draft_repository, large_text_repository,
    },
    services::{ai_fact_security, draft_service, task_authorization_contract::*},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashSet;
fn error(code: &str, message: &str) -> AppError {
    AppError::new(code, message, false)
}
fn stored_preview(conn: &Connection, id: &str) -> Result<Option<ReviewRenewalPreview>, AppError> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT renewal_preview_json FROM review_authorizations WHERE authorization_id=?1",
            [id],
            |r| r.get(0),
        )
        .map_err(AppError::database)?;
    let Some(raw) = raw else { return Ok(None) };
    let preview: ReviewRenewalPreview = serde_json::from_str(&raw)
        .map_err(|_| error("REVIEW_RENEWAL_EVIDENCE_INVALID", "原生重审证据不可读"))?;
    if ai_fact_security::canonical_hash(&evidence(&preview)?)? != preview.preview_hash {
        return Err(error(
            "REVIEW_RENEWAL_EVIDENCE_INVALID",
            "原生重审证据 hash 不一致",
        ));
    }
    Ok(Some(preview))
}
pub fn get_review_renewal(
    conn: &Connection,
    input: GetReviewRenewalInput,
) -> Result<Option<conversation::ReviewAuthorizationRecord>, AppError> {
    ai_fact_security::validate_identifier(&input.authorization_id, "authorizationId", 160)?;
    ai_fact_security::validate_identifier(&input.operation_id, "operationId", 160)?;
    let key = format!(
        "manual-review-renew-v1:{}",
        large_text_repository::sha256(&input.operation_id)
    );
    let id:Option<String>=conn.query_row("SELECT a.authorization_id FROM review_authorizations a JOIN artifact_decisions d ON d.decision_id=a.decision_id WHERE d.idempotency_key=?1 AND d.decision='confirm'",[key],|r|r.get(0)).optional().map_err(AppError::database)?;
    let Some(id) = id else { return Ok(None) };
    let auth = old_authorization(conn, &id)?;
    let preview = stored_preview(conn, &id)?.ok_or_else(|| {
        error(
            "REVIEW_RENEWAL_EVIDENCE_INVALID",
            "签发回执缺少明确重审证据",
        )
    })?;
    if auth.renewed_from_authorization_id.as_deref() != Some(input.authorization_id.as_str())
        || preview.authorization_id != input.authorization_id
    {
        return Err(error(
            "REVIEW_RENEWAL_IDEMPOTENCY_CONFLICT",
            "该操作属于另一份原授权，不能改用或重新签发",
        ));
    }
    Ok(Some(auth))
}
fn owned_draft(
    conn: &Connection,
    auth: &conversation::ReviewAuthorizationRecord,
    id: &str,
) -> Result<
    (
        draft_repository::DraftRecord,
        large_text_repository::VerifiedContent,
    ),
    AppError,
> {
    let draft = draft_repository::find_draft(conn, id)?.ok_or_else(|| {
        error(
            "REVIEW_RESUME_DRAFT_MISSING",
            "重审绑定的已保存稿已不存在；不会改载候选覆盖编辑",
        )
    })?;
    if draft.novel_id != auth.novel_id || draft.chapter_id != auth.chapter_id {
        return Err(error(
            "REVIEW_RESUME_SCOPE_CONFLICT",
            "已保存稿不属于这份审阅授权的作品和章节",
        ));
    }
    let full = draft_service::load_full_content(conn, &draft)?;
    Ok((draft, full))
}
fn native_save_matches(
    conn: &Connection,
    auth: &conversation::ReviewAuthorizationRecord,
    draft: &draft_repository::DraftRecord,
    full: &large_text_repository::VerifiedContent,
) -> Result<bool, AppError> {
    let mut statement=conn.prepare("SELECT result_json FROM draft_save_operations WHERE novel_id=?1 AND chapter_id=?2 AND draft_id=?3 AND status='completed' AND julianday(completed_at)>=julianday(?4) ORDER BY completed_at DESC,rowid DESC").map_err(AppError::database)?;
    let rows = statement
        .query_map(
            params![draft.novel_id, draft.chapter_id, draft.id, auth.issued_at],
            |r| r.get::<_, Option<String>>(0),
        )
        .map_err(AppError::database)?;
    for row in rows {
        let Some(raw) = row.map_err(AppError::database)? else {
            continue;
        };
        let value: Value = serde_json::from_str(&raw).map_err(|_| {
            error(
                "REVIEW_RESUME_SAVE_UNKNOWN",
                "保存回执不可读，无法核对编辑来源",
            )
        })?;
        if value["draft"]["id"] == draft.id
            && value["draft"]["novelId"] == draft.novel_id
            && value["draft"]["chapterId"] == draft.chapter_id
            && value["draft"]["versionNo"].as_i64() == Some(draft.version_no)
            && value["contentHash"]
                .as_str()
                .is_some_and(|hash| hash.eq_ignore_ascii_case(&full.content_hash))
        {
            return Ok(true);
        }
    }
    Ok(false)
}
fn fork_matches(
    source: &draft_repository::DraftRecord,
    source_hash: &str,
    request_hash: &str,
    value: &Value,
) -> bool {
    if value["disposition"] != "forked_from_adopted"
        || value["draft"]["novelId"] != source.novel_id
        || value["draft"]["chapterId"] != source.chapter_id
    {
        return false;
    }
    let Some(body) = value["draft"]["content"].as_str() else {
        return false;
    };
    let Some(hash) = value["contentHash"].as_str() else {
        return false;
    };
    if large_text_repository::sha256(body) != hash.to_ascii_lowercase() {
        return false;
    }
    for version in [Some(source.version_no), None] {
        for base_hash in [Some(source_hash), None] {
            let request = json!({"novelId":source.novel_id,"chapterId":source.chapter_id,"draftId":source.id,"draftVersion":version,
            "baseContentHash":base_hash,"currentContentHash":hash.to_ascii_lowercase(),"contentLength":body.len(),"source":value["draft"]["source"],
            "title":value["draft"]["title"],"aiTaskId":value["draft"]["aiTaskId"],"note":value["draft"]["note"]});
            if large_text_repository::sha256(&request.to_string()) == request_hash {
                return true;
            }
        }
    }
    false
}
fn resolve_binding(
    conn: &Connection,
    auth: &conversation::ReviewAuthorizationRecord,
    snapshot: &ReviewSavedDraft,
) -> Result<ReviewResumeDraft, AppError> {
    let (mut current, mut full) = owned_draft(conn, auth, &snapshot.draft_id)?;
    let mut seen = HashSet::new();
    for _ in 0..32 {
        if !seen.insert(current.id.clone()) {
            return Err(error(
                "REVIEW_RESUME_LINEAGE_INVALID",
                "保存稿来源含循环，已停止自动恢复",
            ));
        }
        // The approved resume policy trusts the exact bound draft after native scope and
        // full-content verification. Operational save receipts are not exported in backups
        // and must not make legitimate edits unreopenable.
        if current.id == snapshot.draft_id {
            return Ok(ReviewResumeDraft {
                draft_id: current.id.clone(),
                draft_version: current.version_no,
                content_hash: full.content_hash.clone(),
                changed_since_renewal: current.version_no != snapshot.draft_version
                    || full.content_hash != snapshot.content_hash,
            });
        }
        let mut statement=conn.prepare("SELECT draft_id,request_hash,result_json FROM draft_save_operations WHERE novel_id=?1 AND chapter_id=?2 AND draft_id<>?3 AND status='completed' AND julianday(completed_at)>=julianday(?4) ORDER BY completed_at,rowid").map_err(AppError::database)?;
        let rows = statement
            .query_map(
                params![auth.novel_id, auth.chapter_id, current.id, auth.issued_at],
                |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        let mut descendants = Vec::new();
        let mut unknown_fork = false;
        for (id, request_hash, raw) in rows {
            let (Some(id), Some(raw)) = (id, raw) else {
                continue;
            };
            let value: Value = serde_json::from_str(&raw)
                .map_err(|_| error("REVIEW_RESUME_SAVE_UNKNOWN", "保存回执不可读"))?;
            if fork_matches(&current, &full.content_hash, &request_hash, &value) {
                if !descendants.contains(&id) {
                    descendants.push(id);
                }
            } else if value["disposition"] == "forked_from_adopted" {
                unknown_fork = true;
            }
        }
        if descendants.len() > 1 {
            return Err(error(
                "REVIEW_RESUME_AMBIGUOUS",
                "这份稿有多个真实保存分支；请明确选择已保存稿并重新确认，不会猜测或覆盖编辑",
            ));
        }
        let Some(next) = descendants.pop() else {
            if unknown_fork {
                return Err(error("REVIEW_RESUME_SAVE_UNKNOWN","存在续签后新保存的分支但无法证明属于绑定稿；请保留编辑并明确重新确认，不能改载旧稿"));
            }
            return Ok(ReviewResumeDraft {
                draft_id: current.id.clone(),
                draft_version: current.version_no,
                content_hash: full.content_hash.clone(),
                changed_since_renewal: current.id != snapshot.draft_id
                    || current.version_no != snapshot.draft_version
                    || full.content_hash != snapshot.content_hash,
            });
        };
        let (next_draft, next_full) = owned_draft(conn, auth, &next)?;
        if !native_save_matches(conn, auth, &next_draft, &next_full)? {
            return Err(error(
                "REVIEW_RESUME_SAVE_UNKNOWN",
                "后续稿缺少当前全文匹配的原生保存回执",
            ));
        }
        current = next_draft;
        full = next_full;
    }
    Err(error(
        "REVIEW_RESUME_LINEAGE_LIMIT",
        "保存来源过长，请明确选择当前已保存稿并重新确认",
    ))
}
pub fn validate_review_draft_binding(
    conn: &Connection,
    auth: &conversation::ReviewAuthorizationRecord,
    draft_id: &str,
) -> Result<(), AppError> {
    let Some(binding) = auth.review_draft_binding.as_ref() else {
        return Ok(());
    };
    if binding.draft_id == draft_id {
        return Ok(());
    }
    let current = resolve_binding(conn, auth, binding)?;
    if current.draft_id != draft_id {
        return Err(error(
            "REVIEW_DRAFT_BINDING_CONFLICT",
            "最终稿不是这份重审授权绑定的稿或可核对保存后继；请保留稿件并明确重新审阅",
        ));
    }
    Ok(())
}
pub fn get_review_resume(
    conn: &mut Connection,
    authorization_id: &str,
) -> Result<ReviewResume, AppError> {
    ai_fact_security::validate_identifier(authorization_id, "authorizationId", 160)?;
    let tx = conn.transaction().map_err(AppError::database)?;
    let mut auth = old_authorization(&tx, authorization_id)?;
    let mut seen = HashSet::new();
    for _ in 0..200 {
        if !seen.insert(auth.authorization_id.clone()) {
            return Err(error("REVIEW_RESUME_LINEAGE_INVALID", "审阅授权来源有循环"));
        }
        let next:Option<String>=tx.query_row("SELECT authorization_id FROM review_authorizations WHERE renewed_from_authorization_id=?1 ORDER BY issued_at DESC,rowid DESC LIMIT 1",[&auth.authorization_id],|r|r.get(0)).optional().map_err(AppError::database)?;
        let Some(id) = next else {
            let binding = auth
                .review_draft_binding
                .as_ref()
                .map(|binding| resolve_binding(&tx, &auth, binding))
                .transpose()?;
            let result = ReviewResume {
                requested_authorization_id: authorization_id.into(),
                authorization: auth,
                review_draft_binding: binding,
            };
            tx.commit().map_err(AppError::database)?;
            return Ok(result);
        };
        let next = old_authorization(&tx, &id)?;
        let proof = stored_preview(&tx, &id)?.ok_or_else(|| {
            error(
                "REVIEW_RENEWAL_EVIDENCE_INVALID",
                "续签授权缺少用户确认预览",
            )
        })?;
        if proof.authorization_id != auth.authorization_id
            || next.renewed_from_authorization_id.as_deref() != Some(auth.authorization_id.as_str())
            || next.novel_id != auth.novel_id
            || next.chapter_id != auth.chapter_id
            || next.artifact_id != auth.artifact_id
        {
            return Err(error(
                "REVIEW_RESUME_SCOPE_CONFLICT",
                "续签不能跨作品、章节或候选",
            ));
        }
        auth = next;
    }
    Err(error(
        "REVIEW_RESUME_LINEAGE_LIMIT",
        "重审链过长，请人工核对历史记录",
    ))
}
