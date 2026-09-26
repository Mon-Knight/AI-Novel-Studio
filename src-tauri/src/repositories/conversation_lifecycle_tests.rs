use super::*;
use super::tests::{connection, conversation_status, insert_valid_artifact_with_type, insert_valid_chapter_artifact};

#[test]
fn changed_world_rules_expire_review_and_block_every_first_adoption_gate() {
    let mut connection = connection();
    let novel = "novel-conversation-test";
    connection.execute("INSERT INTO chapters(id,novel_id,title,order_index,status,word_count,created_at,updated_at) VALUES('rule-chapter',?1,'章',1,'drafted',0,'t','t')", params![novel]).expect("chapter");
    let hash = insert_valid_chapter_artifact(&connection, "rule-artifact", novel, "rule-chapter", "完整候选正文");
    create_conversation(&mut connection, CreateConversationInput { conversation_id: "rule-review-task".into(), novel_id: novel.into(),
        title: "规则审阅".into(), default_model: None, created_at: "t".into() }).expect("task");
    create_artifact_card(&mut connection, CreateArtifactCardInput { card_id: "rule-card".into(), conversation_id: "rule-review-task".into(),
        turn_id: None, run_id: None, artifact_id: Some("rule-artifact".into()), artifact_type: "chapter_text".into(), title: "候选".into(),
        summary: "待审阅".into(), content: None, status: "candidate".into(), created_at: "t".into() }).expect("card");
    record_artifact_decision(&mut connection, RecordArtifactDecisionInput { decision_id: "rule-confirm".into(), artifact_id: "rule-artifact".into(),
        artifact_hash: hash.clone(), card_id: "rule-card".into(), conversation_id: "rule-review-task".into(), decision: "confirm".into(),
        idempotency_key: "rule-card:confirm".into(), actor: "user".into(), target_type: "chapter".into(), target_id: "rule-chapter".into(),
        base_revision: None, apply_transaction_id: None, conflict_code: None, created_at: "t".into() }).expect("confirm");
    issue_review_authorization(&mut connection, "rule-auth", "rule-confirm", "rule-artifact", novel, "rule-chapter", "t").expect("issue");
    connection.execute("INSERT INTO chapter_drafts(id,novel_id,chapter_id,title,content,source,version_no,word_count,is_adopted,created_at,updated_at) VALUES('rule-draft',?1,'rule-chapter','草稿','完整候选正文','user_edited',1,6,0,'t','t')",params![novel]).expect("draft");
    {
        let tx = connection.transaction().expect("rule transaction");
        tx.execute("INSERT INTO rule_systems(id,novel_id,title,content,is_active,created_at,updated_at) VALUES('new-rule',?1,'新规则','施法必须付代价',1,'t','t')",params![novel]).expect("rule mutation");
        crate::services::world_rule_governance::expire_rule_dependent_reviews(&tx, novel).expect("expire in transaction");
        tx.commit().expect("commit rule mutation");
    }
    assert_eq!(get_review_authorization(&connection, "rule-auth").unwrap().unwrap().status, "expired");
    assert_eq!(issue_review_authorization(&mut connection, "rule-auth", "rule-confirm", "rule-artifact", novel, "rule-chapter", "t").unwrap_err().code, "REVIEW_AUTHORIZATION_EXPIRED");
    assert_eq!(consume_review_authorization(&mut connection, ConsumeReviewAuthorizationInput { authorization_id: "rule-auth".into(), draft_id: "rule-draft".into(), consumed_at: "t".into() }).unwrap_err().code, "REVIEW_AUTHORIZATION_EXPIRED");
    assert!(adopt_review_authorized_draft(&mut connection, AdoptReviewAuthorizedDraftInput { authorization_id: "rule-auth".into(), draft_id: "rule-draft".into(), expected_draft_version: 1, expected_content_hash: hash }).is_err());
    let adopted: bool = connection.query_row("SELECT is_adopted FROM chapter_drafts WHERE id='rule-draft'", [], |row| row.get(0)).unwrap();
    assert!(!adopted);
    assert_eq!(validate_review_rule_baseline(&connection, "rule-artifact", novel).unwrap_err().code, "RULE_SET_BASE_CONFLICT");
    assert_eq!(validate_review_rule_baseline(&connection, "missing-legacy-artifact", novel).unwrap_err().code, "RULE_SET_SNAPSHOT_REQUIRED");
}
#[test]
fn acknowledged_reports_complete_without_review_authorization_and_keep_other_candidates_pending() {
    for report_type in ["quality_report", "style_analysis"] {
        let mut connection = connection();
        let novel = "novel-conversation-test";
        let hash = insert_valid_artifact_with_type(&connection, "report-artifact", novel, "chapter-report", "报告", report_type);
        create_conversation(&mut connection, CreateConversationInput {
            conversation_id: "report-task".into(), novel_id: novel.into(), title: "只读报告".into(),
            default_model: None, created_at: "2026-09-10T00:00:00Z".into(),
        }).expect("conversation");
        create_artifact_card(&mut connection, CreateArtifactCardInput {
            card_id: "report-card".into(), conversation_id: "report-task".into(), turn_id: None, run_id: None,
            artifact_id: Some("report-artifact".into()), artifact_type: report_type.into(), title: "报告".into(),
            summary: "待阅读".into(), content: None, status: "candidate".into(), created_at: "2026-09-10T00:00:01Z".into(),
        }).expect("report card");
        let acknowledge = || RecordArtifactDecisionInput {
            decision_id: "report-read".into(), artifact_id: "report-artifact".into(), artifact_hash: hash.clone(),
            card_id: "report-card".into(), conversation_id: "report-task".into(), decision: "confirm".into(),
            idempotency_key: "report-card:confirm".into(), actor: "user".into(), target_type: "asset".into(), target_id: novel.into(),
            base_revision: None, apply_transaction_id: None, conflict_code: None, created_at: "2026-09-10T00:00:02Z".into(),
        };
        record_artifact_decision(&mut connection, acknowledge()).expect("acknowledge");
        assert_eq!(conversation_status(&connection, "report-task"), "completed");
        let authorizations: i64 = connection.query_row("SELECT COUNT(*) FROM review_authorizations", [], |row| row.get(0)).expect("authorizations");
        assert_eq!(authorizations, 0);
        insert_valid_chapter_artifact(&connection, "chapter-artifact", novel, "chapter-report", "未采用正文");
        create_artifact_card(&mut connection, CreateArtifactCardInput {
            card_id: "chapter-card".into(), conversation_id: "report-task".into(), turn_id: None, run_id: None,
            artifact_id: Some("chapter-artifact".into()), artifact_type: "chapter_text".into(), title: "正文候选".into(),
            summary: "待处理".into(), content: None, status: "candidate".into(), created_at: "2026-09-10T00:00:03Z".into(),
        }).expect("chapter card");
        record_artifact_decision(&mut connection, acknowledge()).expect("acknowledge replay");
        assert_eq!(conversation_status(&connection, "report-task"), "waiting_user");
        let adopted: i64 = connection.query_row("SELECT COUNT(*) FROM chapter_drafts WHERE is_adopted=1", [], |row| row.get(0)).expect("adopted drafts");
        assert_eq!(adopted, 0);
    }
}
