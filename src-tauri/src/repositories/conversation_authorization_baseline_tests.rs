//! Dynamic reproduction of issued-review baselines, isolated SQLite only.
use super::tests::{connection, insert_valid_chapter_artifact};
use super::*;

fn fixture() -> Connection {
    let mut conn = connection();
    conn.execute("INSERT INTO chapters(id,novel_id,title,order_index,status,word_count,created_at,updated_at)VALUES('baseline-chapter','novel-conversation-test','基线章节',1,'drafted',0,'t','t')",[]).unwrap();
    create_conversation(
        &mut conn,
        CreateConversationInput {
            conversation_id: "baseline-conversation".into(),
            novel_id: "novel-conversation-test".into(),
            title: "授权基线".into(),
            default_model: None,
            created_at: "t".into(),
        },
    )
    .unwrap();
    for suffix in ["a", "b"] {
        let artifact = format!("baseline-artifact-{suffix}");
        let card = format!("baseline-card-{suffix}");
        let decision = format!("baseline-decision-{suffix}");
        let hash = insert_valid_chapter_artifact(
            &conn,
            &artifact,
            "novel-conversation-test",
            "baseline-chapter",
            "原候选正文。",
        );
        conn.execute("INSERT INTO conversation_artifact_cards(card_id,conversation_id,artifact_id,artifact_type,title,summary,content,status,created_at)VALUES(?1,'baseline-conversation',?2,'chapter_text','候选','','','candidate','t')",params![card,artifact]).unwrap();
        record_artifact_decision(
            &mut conn,
            RecordArtifactDecisionInput {
                decision_id: decision.clone(),
                artifact_id: artifact.clone(),
                artifact_hash: hash,
                card_id: card,
                conversation_id: "baseline-conversation".into(),
                decision: "confirm".into(),
                idempotency_key: format!("confirm-{suffix}"),
                actor: "user".into(),
                target_type: "chapter".into(),
                target_id: "baseline-chapter".into(),
                base_revision: None,
                apply_transaction_id: None,
                conflict_code: None,
                created_at: "t".into(),
            },
        )
        .unwrap();
        issue_review_authorization(
            &mut conn,
            &format!("baseline-auth-{suffix}"),
            &decision,
            &artifact,
            "novel-conversation-test",
            "baseline-chapter",
            "t",
        )
        .unwrap();
        conn.execute("INSERT INTO chapter_drafts(id,novel_id,chapter_id,content,version_no,word_count,is_adopted,created_at,updated_at)VALUES(?1,'novel-conversation-test','baseline-chapter',?2,?3,8,0,'t','t')",params![format!("baseline-draft-{suffix}"),format!("作者审阅并编辑的正文{suffix}。"),if suffix=="a"{1}else{2}]).unwrap();
    }
    conn
}
fn adopt(
    conn: &mut Connection,
    suffix: &str,
) -> Result<AdoptReviewAuthorizedDraftResult, AppError> {
    adopt_review_authorized_draft(
        conn,
        AdoptReviewAuthorizedDraftInput {
            authorization_id: format!("baseline-auth-{suffix}"),
            draft_id: format!("baseline-draft-{suffix}"),
            expected_draft_version: if suffix == "a" { 1 } else { 2 },
            expected_content_hash: crate::repositories::large_text_repository::sha256(&format!(
                "作者审阅并编辑的正文{suffix}。"
            )),
        },
    )
}
#[test]
fn old_issued_review_after_another_adoption_is_blocked_without_losing_author_edits() {
    let mut conn = fixture();
    adopt(&mut conn, "a").unwrap();
    let second = adopt(&mut conn, "b");
    assert_eq!(
        second.unwrap_err().code,
        "REVIEW_AUTHORIZATION_BASE_CONFLICT"
    );
    let pointer: String = conn
        .query_row(
            "SELECT adopted_draft_id FROM chapters WHERE id='baseline-chapter'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(pointer, "baseline-draft-a");
}
#[test]
fn legacy_ipc_issued_consume_after_another_adoption_is_blocked_without_mutation() {
    let mut conn = fixture();
    adopt(&mut conn, "a").unwrap();
    let pointer_before: String = conn
        .query_row(
            "SELECT adopted_draft_id FROM chapters WHERE id='baseline-chapter'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let chapter_updated_before: String = conn
        .query_row(
            "SELECT updated_at FROM chapters WHERE id='baseline-chapter'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let draft_before: (String, i64, bool) = conn
        .query_row(
            "SELECT content,version_no,is_adopted FROM chapter_drafts WHERE id='baseline-draft-b'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    let error = consume_review_authorization(
        &mut conn,
        ConsumeReviewAuthorizationInput {
            authorization_id: "baseline-auth-b".into(),
            draft_id: "baseline-draft-b".into(),
            consumed_at: "t2".into(),
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "REVIEW_AUTHORIZATION_BASE_CONFLICT");
    let (status, consumed_at, consumed_by): (String, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT status,consumed_at,consumed_by_draft_id FROM review_authorizations WHERE authorization_id='baseline-auth-b'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(status, "issued");
    assert_eq!(consumed_at, None);
    assert_eq!(consumed_by, None);
    let pointer_after: String = conn
        .query_row(
            "SELECT adopted_draft_id FROM chapters WHERE id='baseline-chapter'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let chapter_updated_after: String = conn
        .query_row(
            "SELECT updated_at FROM chapters WHERE id='baseline-chapter'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let draft_after: (String, i64, bool) = conn
        .query_row(
            "SELECT content,version_no,is_adopted FROM chapter_drafts WHERE id='baseline-draft-b'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(pointer_after, pointer_before);
    assert_eq!(chapter_updated_after, chapter_updated_before);
    assert_eq!(draft_after, draft_before);
    assert_eq!(
        draft_before,
        ("作者审阅并编辑的正文b。".to_string(), 2, false)
    );
}
#[test]
fn consumed_review_replay_after_manual_alternate_adoption_is_already_blocked() {
    let mut conn = fixture();
    adopt(&mut conn, "a").unwrap();
    crate::services::chapter_service::adopt_chapter_draft(
        &mut conn,
        "baseline-draft-b",
        "baseline-chapter",
    )
    .unwrap();
    assert_eq!(
        adopt(&mut conn, "a").unwrap_err().code,
        "REVIEW_AUTHORIZATION_CONSUMED"
    );
}

#[test]
fn unadopted_author_edits_after_issue_are_still_allowed_and_baseline_cannot_be_rewritten() {
    let mut conn = fixture();
    let edited = "作者明确审阅后重新编辑的最终正文。";
    let hash = crate::repositories::large_text_repository::sha256(edited);
    conn.execute(
        "UPDATE chapter_drafts SET content=?1,content_hash=?2 WHERE id='baseline-draft-a'",
        params![edited, hash],
    )
    .unwrap();
    assert!(conn.execute("UPDATE review_authorizations SET native_baseline_hash=?1 WHERE authorization_id='baseline-auth-a'",["0".repeat(64)]).is_err());
    let result = adopt_review_authorized_draft(
        &mut conn,
        AdoptReviewAuthorizedDraftInput {
            authorization_id: "baseline-auth-a".into(),
            draft_id: "baseline-draft-a".into(),
            expected_draft_version: 1,
            expected_content_hash: hash,
        },
    )
    .unwrap();
    assert_eq!(result.authorization.status, "consumed");
    assert_eq!(result.adopted_draft.content, edited);
}
#[test]
fn legacy_unbound_review_requires_explicit_new_review_without_silent_rebase() {
    let mut conn = fixture();
    conn.execute("INSERT INTO review_authorizations(authorization_id,artifact_id,chapter_id,novel_id,decision_id,status,issued_at)VALUES('legacy-unbound','baseline-artifact-a','baseline-chapter','novel-conversation-test','baseline-decision-a','issued','t')",[]).unwrap();
    let error = adopt_review_authorized_draft(
        &mut conn,
        AdoptReviewAuthorizedDraftInput {
            authorization_id: "legacy-unbound".into(),
            draft_id: "baseline-draft-a".into(),
            expected_draft_version: 1,
            expected_content_hash: crate::repositories::large_text_repository::sha256(
                "作者审阅并编辑的正文a。",
            ),
        },
    )
    .unwrap_err();
    assert_eq!(error.code, "REVIEW_AUTHORIZATION_BASELINE_REQUIRED");
    let pointer: Option<String> = conn
        .query_row(
            "SELECT adopted_draft_id FROM chapters WHERE id='baseline-chapter'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(pointer.is_none());
}
