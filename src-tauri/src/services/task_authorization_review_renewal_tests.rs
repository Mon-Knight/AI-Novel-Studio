//! Explicit manual re-consent and read-only recovery tests use isolated SQLite only.
use super::resume::{get_review_renewal, get_review_resume};
use super::*;
use crate::repositories::{conversation_repository as repository, large_text_repository};
use crate::services::{
    conversation_service as conversations,
    draft_service::{self, SaveChapterDraftAtomicInput},
};
use rusqlite::params;
fn fixture() -> (Connection, String, String, String, String) {
    let (mut conn, spec) = super::super::tests::fixture();
    let (_, artifact) = super::super::apply_tests::publish(
        &mut conn,
        &spec,
        "manual-renew",
        "chapter_text",
        "窗外的雨渐渐停了。",
        None,
    );
    let bundle = artifact_service::get_artifact_bundle(&conn, &artifact).unwrap();
    conversations::create_artifact_card(
        &mut conn,
        conversations::CreateArtifactCardInput {
            card_id: "legacy-review-card".into(),
            conversation_id: spec.conversation_id.clone(),
            turn_id: None,
            run_id: None,
            artifact_id: Some(artifact.clone()),
            artifact_type: "chapter_text".into(),
            title: "旧候选".into(),
            summary: "".into(),
            content: None,
            status: "candidate".into(),
            created_at: Utc::now().to_rfc3339(),
        },
    )
    .unwrap();
    conversations::record_artifact_decision(
        &mut conn,
        conversations::RecordArtifactDecisionInput {
            decision_id: "legacy-review-decision".into(),
            artifact_id: artifact.clone(),
            artifact_hash: bundle.artifact.content_hash,
            card_id: "legacy-review-card".into(),
            conversation_id: spec.conversation_id.clone(),
            decision: "confirm".into(),
            idempotency_key: "legacy-confirm".into(),
            actor: "user".into(),
            target_type: "chapter".into(),
            target_id: spec.chapter_ids[0].clone(),
            base_revision: None,
            apply_transaction_id: None,
            conflict_code: None,
            created_at: Utc::now().to_rfc3339(),
        },
    )
    .unwrap();
    // A real pre-041 grant has no native baseline; it is readable but cannot be adopted.
    conn.execute("INSERT INTO review_authorizations(authorization_id,artifact_id,chapter_id,novel_id,decision_id,status,issued_at)VALUES('legacy-review-auth',?1,?2,?3,'legacy-review-decision','issued',?4)",params![artifact,spec.chapter_ids[0],spec.novel_id,Utc::now().to_rfc3339()]).unwrap();
    let saved = save(
        &mut conn,
        &spec.novel_id,
        &spec.chapter_ids[0],
        None,
        "作者已经保存并编辑的正文。",
        "renew-initial-save",
    );
    (
        conn,
        "legacy-review-auth".into(),
        saved.draft.id,
        spec.novel_id,
        spec.chapter_ids[0].clone(),
    )
}
fn save(
    conn: &mut Connection,
    novel: &str,
    chapter: &str,
    draft: Option<(&str, i64, &str)>,
    content: &str,
    operation: &str,
) -> draft_service::SaveChapterDraftAtomicOutput {
    draft_service::save_chapter_draft_atomic_with_cleanup(
        conn,
        SaveChapterDraftAtomicInput {
            operation_id: operation.into(),
            trace_id: None,
            novel_id: novel.into(),
            chapter_id: chapter.into(),
            draft_id: draft.map(|d| d.0.into()),
            draft_version: draft.map(|d| d.1),
            base_content_hash: draft.map(|d| d.2.into()),
            current_content_hash: large_text_repository::sha256(content),
            content: content.into(),
            word_count: None,
            source: "manual".into(),
            title: None,
            ai_task_id: None,
            note: None,
            staging_session_id: None,
        },
        || Ok(()),
    )
    .unwrap()
}
#[test]
fn explicit_renewal_preserves_old_evidence_and_saved_edits_without_adopting() {
    let (mut conn, old, draft, novel, chapter) = fixture();
    let preview = preview_review_renewal(
        &mut conn,
        PreviewReviewRenewalInput {
            authorization_id: old.clone(),
            saved_draft_id: Some(draft.clone()),
        },
    )
    .unwrap();
    let input = RenewReviewInput {
        authorization_id: old.clone(),
        operation_id: "explicit-human-consent".into(),
        expected_preview_hash: preview.preview_hash.clone(),
        saved_draft_id: Some(draft.clone()),
    };
    let new = renew_review(&mut conn, input.clone()).unwrap();
    assert_ne!(new.authorization_id, old);
    assert_eq!(
        new.renewed_from_authorization_id.as_deref(),
        Some(old.as_str())
    );
    assert_eq!(new.review_draft_binding.as_ref().unwrap().draft_id, draft);
    let old_hash: Option<String> = conn
        .query_row(
            "SELECT native_baseline_hash FROM review_authorizations WHERE authorization_id=?1",
            [&old],
            |r| r.get(0),
        )
        .unwrap();
    assert!(old_hash.is_none());
    assert_eq!(old_authorization(&conn, &old).unwrap().status, "expired");
    let adopted: Option<String> = conn
        .query_row(
            "SELECT adopted_draft_id FROM chapters WHERE id=?1",
            [chapter],
            |r| r.get(0),
        )
        .unwrap();
    assert!(adopted.is_none());
    let replay = renew_review(&mut conn, input).unwrap();
    assert_eq!(replay.authorization_id, new.authorization_id);
    let read = get_review_renewal(
        &conn,
        GetReviewRenewalInput {
            authorization_id: old.clone(),
            operation_id: "explicit-human-consent".into(),
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(read.authorization_id, new.authorization_id);
    let resume = get_review_resume(&mut conn, &old).unwrap();
    assert_eq!(resume.authorization.authorization_id, new.authorization_id);
    assert!(!resume.review_draft_binding.unwrap().changed_since_renewal);
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM artifact_decisions", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 2);
    let library_grants: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM task_authorizations WHERE novel_id=?1",
            [novel],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(library_grants, 0);
}
#[test]
fn stale_preview_and_changed_nonce_payload_never_resign() {
    let (mut conn, old, draft, _, chapter) = fixture();
    let preview = preview_review_renewal(
        &mut conn,
        PreviewReviewRenewalInput {
            authorization_id: old.clone(),
            saved_draft_id: Some(draft.clone()),
        },
    )
    .unwrap();
    conn.execute(
        "UPDATE chapters SET title='作者更改标题' WHERE id=?1",
        [chapter],
    )
    .unwrap();
    let mut request = RenewReviewInput {
        authorization_id: old.clone(),
        operation_id: "stable-review-nonce".into(),
        expected_preview_hash: preview.preview_hash,
        saved_draft_id: Some(draft.clone()),
    };
    assert_eq!(
        renew_review(&mut conn, request.clone()).unwrap_err().code,
        "REVIEW_RENEWAL_BASE_CONFLICT"
    );
    assert_eq!(old_authorization(&conn, &old).unwrap().status, "issued");
    let next = preview_review_renewal(
        &mut conn,
        PreviewReviewRenewalInput {
            authorization_id: old.clone(),
            saved_draft_id: Some(draft),
        },
    )
    .unwrap();
    request.expected_preview_hash = next.preview_hash;
    let issued = renew_review(&mut conn, request.clone()).unwrap();
    request.expected_preview_hash = "0".repeat(64);
    assert_eq!(
        renew_review(&mut conn, request).unwrap_err().code,
        "REVIEW_RENEWAL_IDEMPOTENCY_CONFLICT"
    );
    assert_eq!(
        old_authorization(&conn, &issued.authorization_id)
            .unwrap()
            .status,
        "issued"
    );
}
#[test]
fn same_saved_draft_edits_after_renewal_are_recoverable_and_still_require_manual_adoption() {
    let (mut conn, old, draft, novel, chapter) = fixture();
    let preview = preview_review_renewal(
        &mut conn,
        PreviewReviewRenewalInput {
            authorization_id: old.clone(),
            saved_draft_id: Some(draft.clone()),
        },
    )
    .unwrap();
    let snapshot = preview.saved_draft.clone().unwrap();
    let new = renew_review(
        &mut conn,
        RenewReviewInput {
            authorization_id: old.clone(),
            operation_id: "review-edits".into(),
            expected_preview_hash: preview.preview_hash,
            saved_draft_id: Some(draft.clone()),
        },
    )
    .unwrap();
    let edited = save(
        &mut conn,
        &novel,
        &chapter,
        Some((&draft, snapshot.draft_version, &snapshot.content_hash)),
        "重审之后作者又保存了进一步修改。",
        "renew-later-save",
    );
    let resume = get_review_resume(&mut conn, &old).unwrap();
    let current = resume.review_draft_binding.unwrap();
    assert!(current.changed_since_renewal);
    assert_eq!(current.content_hash, edited.content_hash);
    assert_eq!(
        resume
            .authorization
            .review_draft_binding
            .unwrap()
            .content_hash,
        snapshot.content_hash
    );
    let adopted = repository::adopt_review_authorized_draft(
        &mut conn,
        repository::AdoptReviewAuthorizedDraftInput {
            authorization_id: new.authorization_id.clone(),
            draft_id: draft,
            expected_draft_version: edited.draft.version_no,
            expected_content_hash: edited.content_hash,
        },
    )
    .unwrap();
    assert_eq!(adopted.authorization.status, "consumed");
    let read = get_review_renewal(
        &conn,
        GetReviewRenewalInput {
            authorization_id: old,
            operation_id: "review-edits".into(),
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(read.status, "consumed");
}
#[test]
fn renewal_backup_remaps_history_without_nonce_collision_or_fresh_permission() {
    let (mut conn, old, draft, novel, _) = fixture();
    let preview = preview_review_renewal(
        &mut conn,
        PreviewReviewRenewalInput {
            authorization_id: old.clone(),
            saved_draft_id: Some(draft.clone()),
        },
    )
    .unwrap();
    let new = renew_review(
        &mut conn,
        RenewReviewInput {
            authorization_id: old.clone(),
            operation_id: "backup-review-nonce".into(),
            expected_preview_hash: preview.preview_hash,
            saved_draft_id: Some(draft),
        },
    )
    .unwrap();
    let backup = crate::project_backup::export_project_backup_in_conn(&conn, &novel).unwrap();
    let copy = crate::project_backup::restore_project_backup_in_conn(&mut conn, &backup).unwrap();
    let copied_old = copy.id_map.get(&old).unwrap();
    let copied_new = copy.id_map.get(&new.authorization_id).unwrap();
    let saved = get_review_resume(&mut conn, copied_old).unwrap();
    assert_eq!(saved.authorization.authorization_id, *copied_new);
    assert_ne!(
        saved.authorization.review_draft_binding.unwrap().draft_id,
        new.review_draft_binding.unwrap().draft_id
    );
    assert_eq!(
        old_authorization(&conn, copied_new).unwrap().status,
        "issued"
    );
}
