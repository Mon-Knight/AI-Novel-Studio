use super::*;

fn connection() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    crate::db::create_tables(&mut connection).unwrap();
    connection.execute("INSERT INTO novels(id,title,outline,created_at,updated_at) VALUES('n','test','','t','t')",[]).unwrap();
    connection
}
fn change() -> RuleChange {
    RuleChange {
        operation: None,
        target_type: "rule_system".to_string(),
        target_id: None,
        title: "law".to_string(),
        content: "施法有代价".to_string(),
        category: Some("magic".to_string()),
        forbidden_rules: Some("不可免费".to_string()),
        structured_json: None,
        is_active: true,
    }
}
fn authorization(preview: &RuleChangePreview) -> RuleChangeAuthorization {
    RuleChangeAuthorization {
        preview_hash: preview.preview_hash.clone(),
        intent: "confirm_change".to_string(),
        notes: None,
    }
}
#[test]
fn rule_governance_content_forbidden_structure_and_activation_change_fingerprint_without_clock_change(
) {
    let connection = connection();
    connection.execute("INSERT INTO rule_systems(id,novel_id,title,content,forbidden_rules,structured_json,is_active,created_at,updated_at) VALUES('r','n','law','cost','forbidden','{}',1,'t','t')",[]).unwrap();
    for sql in [
        "UPDATE rule_systems SET content='new'",
        "UPDATE rule_systems SET forbidden_rules='changed'",
        r#"UPDATE rule_systems SET structured_json='{"legacy":1}'"#,
        "UPDATE rule_systems SET is_active=0",
    ] {
        let before = rule_set_snapshot(&connection, "n").unwrap();
        connection.execute(sql, []).unwrap();
        assert_ne!(
            before.fingerprint,
            rule_set_snapshot(&connection, "n").unwrap().fingerprint
        );
        assert_eq!(
            validate_frozen_rule_set(&connection, "n", &json!(before))
                .unwrap_err()
                .code,
            "RULE_SET_BASE_CONFLICT"
        );
    }
}
#[test]
fn rule_governance_confirmation_is_bound_to_payload_and_adopted_evidence_not_boolean() {
    let connection = connection();
    let mut changes = vec![change()];
    let preview = preview_rule_change(&connection, "n", &changes).unwrap();
    assert!(preview.requires_confirmation);
    assert_eq!(
        authorize_rule_change(
            &connection,
            "n",
            &changes,
            Some(&preview.rule_set_fingerprint),
            None
        )
        .unwrap_err()
        .code,
        "RULE_CHANGE_CONFIRMATION_REQUIRED"
    );
    assert!(authorize_rule_change(
        &connection,
        "n",
        &changes,
        Some(&preview.rule_set_fingerprint),
        Some(&authorization(&preview))
    )
    .is_ok());
    changes[0].content.push_str("但是免费");
    assert_eq!(
        authorize_rule_change(
            &connection,
            "n",
            &changes,
            Some(&preview.rule_set_fingerprint),
            Some(&authorization(&preview))
        )
        .unwrap_err()
        .code,
        "RULE_CHANGE_AUTHORIZATION_INVALID"
    );
    changes[0] = change();
    connection.execute("INSERT INTO chapters(id,novel_id,title,order_index,status,adopted_draft_id,created_at,updated_at) VALUES('c','n','adopted',1,'adopted','d','t','t')",[]).unwrap();
    connection.execute("INSERT INTO chapter_drafts(id,novel_id,chapter_id,title,content,source,version_no,word_count,is_adopted,created_at,updated_at) VALUES('d','n','c','chapter','adopted text','manual',1,12,1,'t','t')",[]).unwrap();
    let current = preview_rule_change(&connection, "n", &changes).unwrap();
    assert_eq!(
        current.affected_chapters[0]["certainty"],
        "potential_impact"
    );
    assert!(
        current.blocking_conflicts.is_empty(),
        "adoption is evidence, not automatic semantic contradiction"
    );
    assert_ne!(preview.preview_hash, current.preview_hash);
    assert!(authorize_rule_change(
        &connection,
        "n",
        &changes,
        Some(&preview.rule_set_fingerprint),
        Some(&authorization(&preview))
    )
    .is_err());
}
#[test]
fn rule_governance_deletion_never_orphans_explicit_dependencies() {
    let connection = connection();
    connection.execute("INSERT INTO rule_systems(id,novel_id,title,content,is_active,created_at,updated_at) VALUES('r','n','law','cost',1,'t','t')",[]).unwrap();
    let document = json!({"contract":"world_rules_v1","schemaVersion":1,"identity":{"id":"dependent","revision":1},
        "kind":"world_fact","authority":"draft","strength":"descriptive","statement":"depends","conditions":[],
        "scope":{"summary":"all","chapterIds":[],"places":[],"groups":[],"characters":[]},
        "chronology":{"effectiveFrom":"","effectiveUntil":"","revealAt":""},"epistemic":{"status":"uncertain","knownBy":[],"learnedAt":"","evidence":""},
        "boundaries":{"limitations":"","cost":"","ceiling":""},"exceptions":[],"provenance":{"origin":"user","sourceRefs":[]},
        "dependencies":["r"],"worldParameters":{}});
    connection.execute("INSERT INTO world_settings(id,novel_id,title,content,structured_json,is_active,created_at,updated_at) VALUES('dependent','n','world','text',?1,1,'t','t')",params![document.to_string()]).unwrap();
    let mut delete = change();
    delete.operation = Some("delete".to_string());
    delete.target_id = Some("r".to_string());
    let preview = preview_rule_change(&connection, "n", &[delete.clone()]).unwrap();
    assert_eq!(
        preview.blocking_conflicts[0]["code"],
        "RULE_DELETE_HAS_DEPENDENTS"
    );
    assert_eq!(
        authorize_rule_change(
            &connection,
            "n",
            &[delete],
            Some(&preview.rule_set_fingerprint),
            Some(&authorization(&preview))
        )
        .unwrap_err()
        .code,
        "RULE_CHANGE_BLOCKED"
    );
}
#[test]
fn rule_mutation_expires_issued_reviews_transactionally_but_preserves_consumed_history() {
    let mut connection = Connection::open_in_memory().unwrap();
    // Isolated minimal schema includes every table/column the production queries use.
    connection.execute_batch("CREATE TABLE novels(id TEXT,deleted_at TEXT);
        INSERT INTO novels VALUES('n',NULL);
        CREATE TABLE world_settings(id TEXT,novel_id TEXT,title TEXT,content TEXT,structured_json TEXT,is_active INTEGER,created_at TEXT,updated_at TEXT);
        CREATE TABLE rule_systems(id TEXT,novel_id TEXT,title TEXT,category TEXT,content TEXT,forbidden_rules TEXT,structured_json TEXT,is_active INTEGER,created_at TEXT,updated_at TEXT);
        CREATE TABLE ai_tasks(task_id TEXT,target_hint_json TEXT);
        CREATE TABLE result_artifacts(artifact_id TEXT,task_id TEXT,source_novel_id TEXT);
        CREATE TABLE review_authorizations(authorization_id TEXT,artifact_id TEXT,novel_id TEXT,status TEXT);
        INSERT INTO result_artifacts VALUES('artifact','task','n');
        INSERT INTO review_authorizations VALUES('issued','artifact','n','issued'),('consumed','artifact','n','consumed');").unwrap();
    let before = rule_set_snapshot(&connection, "n").unwrap();
    connection
        .execute(
            "INSERT INTO ai_tasks VALUES('task',?1)",
            params![json!({"nativeRuleSet":before}).to_string()],
        )
        .unwrap();
    expire_rule_dependent_reviews(&connection, "n").unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT status FROM review_authorizations WHERE authorization_id='issued'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        "issued"
    );
    {
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .unwrap();
        transaction
            .execute(
                "INSERT INTO rule_systems VALUES('r','n','law',NULL,'cost',NULL,NULL,1,'t','t')",
                [],
            )
            .unwrap();
        expire_rule_dependent_reviews(&transaction, "n").unwrap();
        assert_eq!(
            transaction
                .query_row(
                    "SELECT status FROM review_authorizations WHERE authorization_id='issued'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "expired"
        );
        // Dropping an uncommitted transaction models a later decision-write failure.
    }
    assert_eq!(
        connection
            .query_row(
                "SELECT status FROM review_authorizations WHERE authorization_id='issued'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        "issued"
    );
    connection
        .execute(
            "INSERT INTO rule_systems VALUES('r','n','law',NULL,'cost',NULL,NULL,1,'t','t')",
            [],
        )
        .unwrap();
    expire_rule_dependent_reviews(&connection, "n").unwrap();
    assert_eq!(
        connection
            .query_row(
                "SELECT status FROM review_authorizations WHERE authorization_id='issued'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        "expired"
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT status FROM review_authorizations WHERE authorization_id='consumed'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        "consumed"
    );
}

#[test]
fn rule_governance_retcon_and_exception_require_explicit_reason_and_scope() {
    let connection = connection();
    let changes = vec![change()];
    let preview = preview_rule_change(&connection, "n", &changes).unwrap();
    let mut auth = authorization(&preview);
    auth.intent = "retcon".to_string();
    assert_eq!(
        authorize_rule_change(
            &connection,
            "n",
            &changes,
            Some(&preview.rule_set_fingerprint),
            Some(&auth)
        )
        .unwrap_err()
        .code,
        "RULE_CHANGE_NOTES_REQUIRED"
    );
    auth.intent = "approve_exception".to_string();
    auth.notes = Some("作者理由".to_string());
    assert_eq!(
        authorize_rule_change(
            &connection,
            "n",
            &changes,
            Some(&preview.rule_set_fingerprint),
            Some(&auth)
        )
        .unwrap_err()
        .code,
        "RULE_EXCEPTION_SCOPE_REQUIRED"
    );
}
