//! Manual advisory acceptance and scope/quota regressions use the real authority fixture.
use super::apply_tests::{input, publish};
use super::tests::fixture;
use super::*;
use crate::repositories::large_text_repository;
use crate::services::structured_artifact_apply_service as structured;
use rusqlite::params;
use serde_json::{json, Value};
#[test]
fn independent_grants_cannot_authorize_a_stale_same_chapter_baseline() {
    let (mut conn, mut spec) = fixture();
    spec.actions = vec![ActionLimit {
        action: Action::ApplyPlanning,
        max_writes: 1,
    }];
    spec.max_writes = 1;
    let a = issue(&mut conn, spec.clone()).unwrap();
    let b = issue(&mut conn, spec.clone()).unwrap();
    let (card, artifact) = publish(
        &mut conn,
        &spec,
        "grant-race",
        "outline",
        r#"{"title":"章纲","content":"首次规划。"}"#,
        Some(json!({"title":"章纲","content":"首次规划。"})),
    );
    let receipt = apply(
        &mut conn,
        input(&a, card.clone(), artifact.clone(), Action::ApplyPlanning),
    )
    .unwrap();
    let mut stale = input(&b, card, artifact, Action::ApplyPlanning);
    stale.operation_id = "apply:grant-race:independent-b".into();
    let failure = apply(&mut conn, stale).unwrap_err();
    assert_eq!(failure.code, "TASK_AUTHORIZATION_BASE_CONFLICT");
    assert_eq!(
        load(&conn, &a.authorization_id).unwrap().status,
        "exhausted"
    );
    assert_eq!(load(&conn, &b.authorization_id).unwrap().used_writes, 0);
    assert_eq!(
        receipts::list(&conn, &a.authorization_id).unwrap()[0].receipt_id,
        receipt.receipt_id
    );
}
#[test]
fn manual_review_can_accept_advisory_confidence_but_preauthorization_cannot() {
    for manual in [true, false] {
        let (mut conn, mut spec) = fixture();
        let source = "林夏可能已经离开图书馆，记录仍未核实。";
        conn.execute("INSERT INTO chapter_drafts(id,novel_id,chapter_id,content,source,version_no,word_count,is_adopted,content_hash,created_at,updated_at)VALUES('00000000-0000-4000-8000-000000000103',?1,?2,?3,'manual',1,20,0,?4,'t','t')",params![spec.novel_id,spec.chapter_ids[0],source,large_text_repository::sha256(source)]).unwrap();
        crate::services::chapter_service::adopt_chapter_draft(
            &mut conn,
            "00000000-0000-4000-8000-000000000103",
            &spec.chapter_ids[0],
        )
        .unwrap();
        spec.actions = vec![ActionLimit {
            action: Action::ApplySummary,
            max_writes: 1,
        }];
        spec.max_writes = 1;
        let grant = issue(&mut conn, spec.clone()).unwrap();
        let quote = "林夏可能已经离开图书馆";
        let payload = json!({"summary":"林夏已经离开图书馆。","keyEvents":["林夏已经离开图书馆。"],"characterChanges":[],"contextRecords":[],"grounding":{"version":1,"claims":[{"path":"/summary","status":"confirmed","quotes":[quote]},{"path":"/keyEvents/0","status":"confirmed","quotes":[quote]}]}});
        let raw = payload.to_string();
        let (card, artifact) = publish(
            &mut conn,
            &spec,
            "warning-summary",
            "chapter_summary",
            &raw,
            Some(payload),
        );
        if manual {
            let bundle =
                crate::services::artifact_service::get_artifact_bundle(&conn, &artifact).unwrap();
            let decision = structured::apply_structured_artifact(
                &mut conn,
                structured::ApplyStructuredArtifactInput {
                    decision_id: "manual-warning-decision".into(),
                    artifact_id: artifact,
                    artifact_hash: bundle.artifact.content_hash,
                    card_id: card,
                    conversation_id: spec.conversation_id,
                    idempotency_key: "manual-warning-apply".into(),
                    actor: "user".into(),
                    target_type: "asset".into(),
                    target_id: spec.chapter_ids[0].clone(),
                    novel_id: spec.novel_id,
                    chapter_id: Some(spec.chapter_ids[0].clone()),
                    base_revision: bundle.artifact.source_base_content_hash,
                    expected_rule_set_fingerprint: None,
                    change_authorization: None,
                    created_at: Utc::now().to_rfc3339(),
                },
            )
            .unwrap();
            assert!(decision.apply_transaction_id.is_some());
            let validation: String = conn
                .query_row("SELECT validation_result FROM chapter_summaries", [], |r| {
                    r.get(0)
                })
                .unwrap();
            let value: Value = serde_json::from_str(&validation).unwrap();
            assert!(value["score"].as_i64().unwrap() < 70);
            assert_eq!(value["authorReviewed"], true);
            assert_eq!(value["safeToContext"], true);
            assert_eq!(value["semanticValidation"], "not_checked");
        } else {
            assert_eq!(
                apply(
                    &mut conn,
                    input(&grant, card, artifact, Action::ApplySummary)
                )
                .unwrap_err()
                .code,
                "SUMMARY_HUMAN_REVIEW_REQUIRED"
            );
        }
    }
}
