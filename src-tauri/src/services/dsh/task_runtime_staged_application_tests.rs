//! Read-only per-application stage provenance checks over isolated SQLite.
use super::*;

fn assembled() -> (Connection, StartTaskTurnInput, Value) {
    let (mut connection, mut input) = fixture(1);
    prepare(&connection, &mut input).unwrap();
    for index in 0..5 {
        advance(&mut connection, &mut input, &format!("application-{index}"));
    }
    step(&mut connection, &input, "application-assembly");
    let frozen = context(&input).unwrap().frozen.clone();
    let replay = graph::replay(&connection, &input, &frozen).unwrap();
    assert!(replay.complete);
    let evidence = evidence_manifest(&input, &frozen, &replay).unwrap();
    input.task_kind = "chapter_write".into();
    input.expected_tool = Some("generate_chapter".into());
    input.expected_artifact_type = Some("chapter_text".into());
    input.chapter_word_range = Some(frozen.range);
    // Application reconstructs native root facts; no ephemeral stage context survives.
    input.execution = Some(execution::RootExecution::new(&connection, &input).unwrap());
    (connection, input, evidence)
}

#[test]
fn staged_application_rechecks_plan_engineering_and_rules_after_assembly() {
    for sql in [
        "UPDATE chapter_engineering_states SET chapter_card_json='{\"goal\":\"作者新目标\"}' WHERE id='staged-plan'",
        "UPDATE chapter_engineering_states SET scene_plan_json=json_set(scene_plan_json,'$[0].goal','另一场景目标') WHERE id='staged-plan'",
        "UPDATE rule_systems SET content='作者已修改正式规则。' WHERE id='staged-rule'",
    ] {
        let (connection, input, evidence) = assembled();
        validate_application_source(&connection, &input, &evidence).unwrap();
        let changes_before: i64 = connection.query_row("SELECT total_changes()", [], |r|r.get(0)).unwrap();
        validate_application_source(&connection, &input, &evidence).unwrap();
        let changes_after: i64 = connection.query_row("SELECT total_changes()", [], |r|r.get(0)).unwrap();
        assert_eq!(changes_before, changes_after, "source validation cannot write a new baseline");
        connection.execute(sql, []).unwrap();
        assert_eq!(validate_application_source(&connection, &input, &evidence).unwrap_err(),
            "CHAPTER_STAGED_APPLICATION_SOURCE_CHANGED", "{sql}");
    }
}

#[test]
fn staged_application_requires_the_exact_complete_ordered_manifest() {
    let (connection, input, evidence) = assembled();
    for field in ["assemblyHash", "workflowId", "chapterId", "schemaVersion"] {
        let mut forged = evidence.clone();
        forged[field] = json!("forged");
        assert!(
            validate_application_source(&connection, &input, &forged).is_err(),
            "{field}"
        );
    }
    for action in ["reverse", "missing", "extra", "hash"] {
        let mut forged = evidence.clone();
        let sources = forged["orderedSourceStages"].as_array_mut().unwrap();
        match action {
            "reverse" => sources.reverse(),
            "missing" => {
                sources.pop();
            }
            "extra" => sources.push(sources[0].clone()),
            _ => sources[0]["resultHash"] = json!("0".repeat(64)),
        }
        assert_eq!(
            validate_application_source(&connection, &input, &forged).unwrap_err(),
            "CHAPTER_STAGED_APPLICATION_MANIFEST_MISMATCH",
            "{action}"
        );
    }
    let mut forged = evidence.clone();
    forged["semanticValidation"] = json!("passed");
    assert!(validate_application_source(&connection, &input, &forged).is_err());
    forged = evidence;
    forged["authorReviewed"] = json!(true);
    assert!(validate_application_source(&connection, &input, &forged).is_err());
}

#[test]
fn staged_application_provenance_does_not_expire_manual_review_or_enable_dispatch() {
    let (connection, mut input, evidence) = assembled();
    let root = input.execution.as_mut().unwrap();
    root.started_at_ms -= root.max_wall_ms + 60_000;
    assert_eq!(root.check().unwrap_err(), "DSH_ROOT_WALL_BUDGET_EXHAUSTED");
    assert!(!root.dispatch_enabled.load(Ordering::SeqCst));
    validate_application_source(&connection, &input, &evidence).unwrap();
    assert!(!input
        .execution
        .as_ref()
        .unwrap()
        .dispatch_enabled
        .load(Ordering::SeqCst));
    assert!(input.execution.as_ref().unwrap().check_dispatch().is_err());
    // This is only immutable provenance proof. Manual/grant authority still has
    // its own native scope, expiry, revocation and per-write transaction gate.
}

#[test]
fn staged_application_production_boundaries_revalidate_the_persisted_candidate() {
    let (mut connection, mut input) = fixture(1);
    prepare(&connection, &mut input).unwrap();
    for index in 0..5 {
        advance(
            &mut connection,
            &mut input,
            &format!("production-application-{index}"),
        );
    }
    let mut assembly_input = input.clone();
    let mut result = step(
        &mut connection,
        &assembly_input,
        "production-application-assembly",
    );
    after_result(&mut connection, &mut assembly_input, &mut result).unwrap();
    let artifact_id = result.artifact_id.clone().unwrap();
    let card_id: String = connection
        .query_row(
            "SELECT card_id FROM conversation_artifact_cards WHERE artifact_id=?1",
            [&artifact_id],
            |row| row.get(0),
        )
        .unwrap();
    let bundle = artifact_service::get_artifact_bundle(&connection, &artifact_id).unwrap();
    validate_application_bundle(&connection, &input.conversation_id, &card_id, &bundle).unwrap();
    validate_application_artifact(&connection, &artifact_id).unwrap();
    crate::services::dsh::task_runtime::validate_candidate_for_application(
        &connection,
        &input.conversation_id,
        &card_id,
        &artifact_id,
    )
    .unwrap();

    connection
        .execute(
            "UPDATE rule_systems SET content='作者已修改正式规则。' WHERE id='staged-rule'",
            [],
        )
        .unwrap();
    for outcome in [
        validate_application_bundle(&connection, &input.conversation_id, &card_id, &bundle)
            .map(|_| "bundle"),
        validate_application_artifact(&connection, &artifact_id).map(|_| "manual"),
        crate::services::dsh::task_runtime::validate_candidate_for_application(
            &connection,
            &input.conversation_id,
            &card_id,
            &artifact_id,
        )
        .map(|_| "preauthorized"),
    ] {
        assert_eq!(
            outcome.unwrap_err().code,
            "CHAPTER_STAGED_APPLICATION_SOURCE_CHANGED"
        );
    }
}
