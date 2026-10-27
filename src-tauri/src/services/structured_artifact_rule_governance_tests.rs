fn governed_setting_input(
    connection: &Connection,
    card: &conversation_service::ConversationArtifactCardRecord,
    bundle: &artifact_service::ResultArtifactBundle,
) -> ApplyStructuredArtifactInput {
    let mut input = apply_input(card, bundle);
    if bundle.artifact.artifact_type == "setting_candidates" {
        let preview = preview_structured_rule_change_with(connection, &input)
            .unwrap()
            .unwrap();
        input.expected_rule_set_fingerprint = Some(preview.rule_set_fingerprint);
        input.change_authorization = Some(RuleChangeAuthorization {
            preview_hash: preview.preview_hash,
            intent: "confirm_change".to_string(),
            notes: None,
        });
    }
    input
}

#[test]
fn setting_candidate_rule_change_after_generation_conflicts_without_chapter_id() {
    let mut connection = connection();
    let (card, bundle) = publish_simple(
        &mut connection,
        "rule-base-drift",
        "setting_candidates",
        None,
        json!({"settings":[{"name":"future rule","targetType":"rule_system","content":"cost"}]}),
    );
    let authorized = governed_setting_input(&connection, &card, &bundle);
    connection.execute("INSERT INTO rule_systems(id,novel_id,title,content,is_active,created_at,updated_at) VALUES('late-rule',?1,'law','changed',1,'t','t')",params![NOVEL_ID]).unwrap();
    assert_eq!(
        preview_structured_rule_change_with(&connection, &authorized)
            .unwrap_err()
            .code,
        "RULE_SET_BASE_CONFLICT"
    );
    let decision = apply_structured_artifact(&mut connection, authorized).unwrap();
    assert_eq!(
        decision.conflict_code.as_deref(),
        Some("RULE_SET_BASE_CONFLICT")
    );
    assert!(decision.apply_transaction_id.is_none());
    assert_eq!(count(&connection, "rule_systems"), 1);
}

#[test]
fn setting_impact_authorization_is_candidate_scoped_and_replay_cannot_change_author_intent() {
    let mut connection = connection();
    let payload =
        json!({"settings":[{"name":"confirmed rule","targetType":"rule_system","content":"cost"}]});
    let (card, bundle) = publish_simple(
        &mut connection,
        "rule-author-a",
        "setting_candidates",
        None,
        payload.clone(),
    );
    let (other, other_bundle) = publish_simple(
        &mut connection,
        "rule-author-b",
        "setting_candidates",
        None,
        payload,
    );
    let request = apply_input(&card, &bundle);
    assert_eq!(
        apply_structured_artifact(&mut connection, request)
            .unwrap_err()
            .code,
        "RULE_CHANGE_CONFIRMATION_REQUIRED"
    );
    assert_eq!(count(&connection, "rule_systems"), 0);
    let authorized = governed_setting_input(&connection, &card, &bundle);
    let mut forged = apply_input(&other, &other_bundle);
    forged.expected_rule_set_fingerprint = authorized.expected_rule_set_fingerprint.clone();
    forged.change_authorization = authorized.change_authorization.clone();
    assert_eq!(
        apply_structured_artifact(&mut connection, forged)
            .unwrap_err()
            .code,
        "RULE_CHANGE_AUTHORIZATION_INVALID"
    );
    let first = apply_structured_artifact(&mut connection, authorized.clone()).unwrap();
    let replay = apply_structured_artifact(&mut connection, authorized.clone()).unwrap();
    assert_eq!(first.decision_id, replay.decision_id);
    assert_eq!(count(&connection, "rule_systems"), 1);
    let receipt_id = first.apply_transaction_id.as_deref().unwrap();
    let proof =
        crate::repositories::large_text_repository::read_verified_document(&connection, receipt_id)
            .unwrap();
    let proof: Value = serde_json::from_str(&proof.content).unwrap();
    assert_eq!(proof["changeAuthorization"]["intent"], "confirm_change");
    assert_eq!(proof["targets"].as_array().unwrap().len(), 1);
    let mut changed = authorized.clone();
    changed.change_authorization.as_mut().unwrap().notes = Some("different intent".to_string());
    assert_eq!(
        apply_structured_artifact(&mut connection, changed)
            .unwrap_err()
            .code,
        "STRUCTURED_APPLY_IDEMPOTENCY_CONFLICT"
    );
    connection
        .execute(
            "UPDATE rule_systems SET content='changed after adoption' WHERE novel_id=?1",
            params![NOVEL_ID],
        )
        .unwrap();
    assert_eq!(
        apply_structured_artifact(&mut connection, authorized)
            .unwrap_err()
            .code,
        "STRUCTURED_RULE_REPLAY_CONFLICT"
    );
}
