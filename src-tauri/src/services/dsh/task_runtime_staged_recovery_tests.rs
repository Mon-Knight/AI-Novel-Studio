//! Recovery and hostile-checkpoint behavior; startup never dispatches a model.
use super::*;
use crate::services::chapter_workflow_stage_service as stages;

#[test]
fn staged_crash_resume_reuses_valid_plan_and_prose_without_replanning() {
    let (mut connection, mut input) = fixture(1);
    prepare(&connection, &mut input).unwrap();
    for (index, name) in ["import", "plan", "write"].iter().enumerate() {
        advance(
            &mut connection,
            &mut input,
            &format!("resume-{index}-{name}"),
        );
    }
    assert_eq!(context(&input).unwrap().stage.kind, "beat_state");
    let original_hash = context(&input).unwrap().frozen.plan_hash.clone();
    start_stage_fixture(&mut connection, &input, "crashed-state");
    set_run_status(&mut connection, "crashed-state", "failed");
    assert_eq!(
        stages::recover_interrupted_stages(&mut connection).unwrap(),
        1
    );
    let calls_before: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM tool_call_events WHERE tool_name='submit_chapter_stage'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(calls_before, 2);
    input.execution.as_mut().unwrap().staged = None;
    input.retry_source_run_id = Some("crashed-state".into());
    input.execution = Some(execution::RootExecution::new(&connection, &input).unwrap());
    prepare(&connection, &mut input).unwrap();
    assert_eq!(stage_label(&input), "beat_state:scene-1:1");
    assert_eq!(context(&input).unwrap().frozen.plan_hash, original_hash);
    assert!(input.retry_source_run_id.is_none());
    let calls_after: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM tool_call_events WHERE tool_name='submit_chapter_stage'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        calls_before, calls_after,
        "recovery itself must not call the model"
    );
    let rows = graph::rows(&connection, &input).unwrap();
    assert_eq!(rows.iter().filter(|r| r.status == "succeeded").count(), 3);
    assert_eq!(
        rows.iter()
            .filter(|r| r.error_code.as_deref() == Some("WORKFLOW_INTERRUPTED"))
            .count(),
        1
    );
}

#[test]
fn staged_reentry_requires_explicit_resume_and_never_refreshes_stale_sources() {
    let (mut connection, mut input) = fixture(1);
    prepare(&connection, &mut input).unwrap();
    advance(&mut connection, &mut input, "resume-required-import");
    input.execution.as_mut().unwrap().staged = None;
    assert_eq!(
        prepare(&connection, &mut input).unwrap_err(),
        "CHAPTER_STAGED_EXPLICIT_RESUME_REQUIRED"
    );
    let (mut connection, mut input) = fixture(1);
    prepare(&connection, &mut input).unwrap();
    advance(&mut connection, &mut input, "stale-import");
    start_stage_fixture(&mut connection, &input, "stale-crash");
    set_run_status(&mut connection, "stale-crash", "failed");
    stages::recover_interrupted_stages(&mut connection).unwrap();
    input.execution.as_mut().unwrap().staged = None;
    input.retry_source_run_id = Some("stale-crash".into());
    connection.execute("UPDATE chapter_engineering_states SET chapter_card_json='{\"goal\":\"作者的新目标\"}' WHERE id='staged-plan'",[]).unwrap();
    assert!(prepare(&connection, &mut input)
        .unwrap_err()
        .contains("BASELINE_CHANGED"));
}

#[test]
fn staged_corrupt_durable_result_fails_closed_instead_of_replacing_success() {
    let (mut connection, mut input) = fixture(1);
    prepare(&connection, &mut input).unwrap();
    advance(&mut connection, &mut input, "corrupt-import");
    advance(&mut connection, &mut input, "corrupt-plan");
    let row = graph::rows(&connection, &input)
        .unwrap()
        .into_iter()
        .find(|r| r.stage_kind == "beat_plan")
        .unwrap();
    connection
        .execute(
            "UPDATE large_text_chunks SET content='corrupt result' WHERE document_id=?1",
            [row.result_document_id.unwrap()],
        )
        .unwrap();
    assert!(graph::replay(&connection, &input, &context(&input).unwrap().frozen).is_err());
    assert_eq!(
        graph::rows(&connection, &input)
            .unwrap()
            .iter()
            .filter(|r| r.status == "succeeded")
            .count(),
        2
    );
}

#[test]
fn staged_extra_out_of_order_checkpoint_cannot_be_assembled() {
    let (mut connection, mut input) = fixture(1);
    prepare(&connection, &mut input).unwrap();
    advance(&mut connection, &mut input, "extra-import");
    start_stage_fixture(&mut connection, &input, "extra-stage");
    let ctx = context(&input).unwrap();
    let row = stages::start_stage(
        &mut connection,
        stages::StartChapterWorkflowStageInput {
            workflow_id: input.turn_id.clone(),
            conversation_id: input.conversation_id.clone(),
            novel_id: input.require_novel_id().unwrap().to_string(),
            chapter_id: input.chapter_id.clone().unwrap(),
            run_id: "extra-stage".into(),
            stage_key: "beat_write:unexpected:1".into(),
            stage_kind: "beat_write".into(),
            scene_id: Some("unexpected".into()),
            beat_id: Some("extra".into()),
            plan_version: 2,
            context_hash: ctx.frozen.source_hash.clone(),
            base_hash: ctx.frozen.base_hash.clone(),
            input_hash: ctx.stage.input_hash.clone(),
            plan_hash: ctx.stage.plan_hash.clone(),
            model_snapshot_hash: None,
            attempt: None,
        },
    )
    .unwrap();
    stages::complete_stage(
        &mut connection,
        stages::CompleteChapterWorkflowStageInput {
            stage_id: row.stage_id,
            expected_revision: row.revision,
            expected_result_hash: large_text_repository::sha256("多余正文"),
            output: stages::ChapterWorkflowStageOutput::LargeText("多余正文".into()),
        },
    )
    .unwrap();
    assert!(graph::replay(&connection, &input, &ctx.frozen)
        .unwrap_err()
        .contains("ORDER_INVALID"));
}

#[test]
fn staged_final_assembly_rejects_extra_text_and_reconciles_committed_hash() {
    let (mut connection, mut input) = fixture(1);
    prepare(&connection, &mut input).unwrap();
    for index in 0..5 {
        advance(&mut connection, &mut input, &format!("assembly-{index}"));
    }
    assert_eq!(context(&input).unwrap().stage.kind, "chapter_assemble");
    let expected = context(&input).unwrap().stage.local_result.clone().unwrap();
    let mut forged = input.clone();
    forged
        .execution
        .as_mut()
        .unwrap()
        .staged
        .as_mut()
        .unwrap()
        .stage
        .local_result = Some(format!("{expected}\n多余正文"));
    assert!(begin(&mut connection, &forged, "not-created")
        .unwrap_err()
        .contains("ORDER_INVALID"));
    start_stage_fixture(&mut connection, &input, "committed-assembly");
    execute_local(&mut connection, &input, "committed-assembly").unwrap();
    set_run_status(&mut connection, "committed-assembly", "failed");
    input.execution.as_mut().unwrap().staged = None;
    input.retry_source_run_id = Some("committed-assembly".into());
    prepare(&connection, &mut input).unwrap();
    start_stage_fixture(&mut connection, &input, "reconcile-assembly");
    let receipt = execute_local(&mut connection, &input, "reconcile-assembly").unwrap();
    assert_eq!(receipt["reconciled"], true);
    assert_eq!(
        receipt["resultHash"],
        json!(large_text_repository::sha256(&expected))
    );
    assert_eq!(
        graph::rows(&connection, &input)
            .unwrap()
            .iter()
            .filter(|r| r.stage_kind == "chapter_assemble")
            .count(),
        1
    );
}

#[test]
fn staged_assembly_reconciliation_reuses_candidate_and_restores_admission_without_duplicates() {
    let (mut connection, mut input) = fixture(1);
    prepare(&connection, &mut input).unwrap();
    for index in 0..5 {
        advance(&mut connection, &mut input, &format!("idempotent-{index}"));
    }
    let mut first_input = input.clone();
    let mut first = step(&mut connection, &first_input, "idempotent-assembly");
    after_result(&mut connection, &mut first_input, &mut first).unwrap();
    let artifact_id = first.artifact_id.clone().unwrap();

    // Simulate an interrupted final acknowledgement: the candidate is durable,
    // but its native admission receipt still needs deterministic reconciliation.
    connection
        .execute(
            "DELETE FROM tool_call_events WHERE tool_name='dsh.candidate_admission'",
            [],
        )
        .unwrap();
    let mut second = step(&mut connection, &input, "idempotent-reconcile");
    after_result(&mut connection, &mut input, &mut second).unwrap();
    assert_eq!(second.artifact_id.as_deref(), Some(artifact_id.as_str()));
    for (sql, expected) in [
        ("SELECT COUNT(*) FROM conversation_artifact_cards WHERE artifact_type='chapter_text'", 1),
        ("SELECT COUNT(*) FROM result_artifacts WHERE artifact_type='chapter_text'", 1),
        ("SELECT COUNT(*) FROM tool_call_events WHERE tool_name='dsh.candidate_admission'", 1),
        ("SELECT COUNT(*) FROM chapter_workflow_stages WHERE stage_kind='chapter_assemble'", 1),
    ] {
        let actual: i64 = connection.query_row(sql, [], |row| row.get(0)).unwrap();
        assert_eq!(actual, expected, "{sql}");
    }
}

#[test]
fn staged_same_root_two_chapters_keep_distinct_checkpoint_keys() {
    let (mut connection, mut first) = fixture(1);
    let second_id = "00000000-0000-4000-8000-000000000503";
    connection.execute("INSERT INTO chapters(id,novel_id,title,outline,order_index,status,target_word_count,created_at,updated_at)VALUES(?1,?2,'第二章','第二章已应用章纲',2,'outline_ready',650,?3,?3)",params![second_id,first.require_novel_id().unwrap(),now()]).unwrap();
    connection.execute("INSERT INTO chapter_engineering_states(id,novel_id,chapter_id,chapter_card_json,scene_plan_json,generation_constraints_json,quality_rules_json,draft_version,active_version,status,created_at,updated_at) SELECT 'staged-plan-2',novel_id,?1,chapter_card_json,scene_plan_json,generation_constraints_json,quality_rules_json,1,1,'active',created_at,updated_at FROM chapter_engineering_states WHERE id='staged-plan'",[second_id]).unwrap();
    connection.execute("INSERT INTO chapter_drafts(id,novel_id,chapter_id,content,is_adopted,created_at,updated_at)VALUES('prior-adopted',?1,?2,'他走过旧城，决定下一章只核对眼前证据。',1,?3,?3)",params![first.require_novel_id().unwrap(),first.chapter_id,now()]).unwrap();
    connection
        .execute(
            "UPDATE chapters SET adopted_draft_id='prior-adopted' WHERE id=?1",
            [first.chapter_id.as_deref().unwrap()],
        )
        .unwrap();
    first.execution = Some(execution::RootExecution::new(&connection, &first).unwrap());
    let mut second = first.clone();
    second.chapter_id = Some(second_id.into());
    second.continuity_claim = Some(chapter_gate::ContinuityClaim {
        previous_chapter_id: first.chapter_id.clone().unwrap(),
        source_hash: large_text_repository::sha256("他走过旧城，决定下一章只核对眼前证据。"),
    });
    chapter_continuity::freeze_continuity(&connection, &mut second).unwrap();
    let verified = second.verified_continuity.clone();
    let baselines = second.execution.as_ref().unwrap().baselines.clone();
    prepare(&connection, &mut first).unwrap();
    prepare(&connection, &mut second).unwrap();
    assert!(second.continuity_claim.is_none());
    assert_eq!(second.verified_continuity, verified);
    assert!(second.continuity_checked);
    assert!(Arc::ptr_eq(
        &second.execution.as_ref().unwrap().baselines,
        &baselines
    ));
    assert_ne!(
        context(&first).unwrap().stage.key,
        context(&second).unwrap().stage.key
    );
    step(&mut connection, &first, "first-chapter-plan");
    second.execution.as_mut().unwrap().parent_run_id = Some("first-chapter-plan".into());
    step(&mut connection, &second, "second-chapter-plan");
    let count:i64=connection.query_row("SELECT COUNT(*) FROM chapter_workflow_stages WHERE workflow_id='staged-turn' AND stage_kind='scene_plan' AND status='succeeded'",[],|r|r.get(0)).unwrap();
    assert_eq!(count, 2);
}

#[test]
fn staged_successful_tool_result_is_not_reexecuted_on_duplicate_callback() {
    let (mut connection, mut input) = fixture(1);
    prepare(&connection, &mut input).unwrap();
    advance(&mut connection, &mut input, "duplicate-import");
    start_stage_fixture(&mut connection, &input, "duplicate-plan");
    reads(&mut connection, &input, "duplicate-plan");
    let args = mock_arguments(&input).unwrap();
    submit(&mut connection, &input, "duplicate-plan", args.clone()).unwrap();
    let body = args["content"].as_str().unwrap();
    let gateway = json!({"ok":true,"stageSubmissionVersion":1,"stageKey":args["stageKey"],"stageKind":args["stageKind"],
        "contentHash":large_text_repository::sha256(body),"contentChars":body.chars().count()});
    assert_eq!(
        accept_submission(
            &mut connection,
            &input,
            "duplicate-plan",
            "duplicate-plan-submit",
            &gateway.to_string()
        )
        .unwrap_err(),
        "CHAPTER_STAGED_LEASE_MISSING"
    );
    assert_eq!(
        graph::rows(&connection, &input)
            .unwrap()
            .iter()
            .filter(|r| r.stage_kind == "beat_plan" && r.status == "succeeded")
            .count(),
        1
    );
}
