//! Dynamic stage protocol and ordered-assembly tests over real isolated SQLite.
use super::*;
#[path = "task_runtime_staged_test_support.rs"]
mod support;
use support::{advance, fixture, reads, stage_label, step, submit, start as start_stage_fixture, status as set_run_status};
#[path = "task_runtime_staged_application_tests.rs"]
mod application;
#[path = "task_runtime_staged_recovery_tests.rs"]
mod recovery;

#[test]
fn staged_applied_scene_plan_is_reused_without_a_model_call() {
    let (mut connection, mut input) = fixture(2);
    assert!(metadata(&input).is_none());
    prepare(&connection, &mut input).unwrap();
    let projected = metadata(&input).unwrap();
    assert_eq!(projected.as_object().unwrap().len(), 7);
    for key in [
        "workflowId",
        "stageKey",
        "stageKind",
        "inputHash",
        "planHash",
        "sourceContextHash",
        "wordRange",
    ] {
        assert!(projected.get(key).is_some(), "{key}");
    }
    assert_eq!(projected["stageKind"], "scene_plan");
    assert!(!projected.to_string().contains("核对现场线索并承担行动后果"));
    assert!(is_local(&input));
    assert_eq!(context(&input).unwrap().stage.kind, "scene_plan");
    assert_eq!(input.goal, "按已应用计划写章");
    advance(&mut connection, &mut input, "plan-import");
    assert_eq!(stage_label(&input), "beat_plan:scene-1");
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM tool_call_events WHERE tool_name='submit_chapter_stage'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
    assert_eq!(
        graph::rows(&connection, &input)
            .unwrap()
            .iter()
            .filter(|r| r.status == "succeeded")
            .count(),
        1
    );
}

#[test]
fn staged_two_scenes_follow_six_kinds_and_assemble_only_exact_ordered_prose() {
    let (mut connection, mut input) = fixture(2);
    prepare(&connection, &mut input).unwrap();
    let mut keys = Vec::new();
    let mut result = None;
    for index in 0..20 {
        keys.push(stage_label(&input).clone());
        let run = format!("ordered-{index}");
        let current = step(&mut connection, &input, &run);
        match next_stage(&connection, &input, &current).unwrap() {
            Some(mut next) => {
                next.execution.as_mut().unwrap().parent_run_id = Some(run);
                input = next;
            }
            None => {
                result = Some(current);
                break;
            }
        }
    }
    assert!(result.is_some(), "bounded stages must finish");
    assert_eq!(
        keys,
        vec![
            "scene_plan",
            "beat_plan:scene-1",
            "beat_write:scene-1:1",
            "beat_state:scene-1:1",
            "scene_close:scene-1",
            "beat_plan:scene-2",
            "beat_write:scene-2:1",
            "beat_state:scene-2:1",
            "scene_close:scene-2",
            "chapter_assemble"
        ]
    );
    let replay = graph::replay(&connection, &input, &context(&input).unwrap().frozen).unwrap();
    assert!(replay.complete);
    let bodies = replay
        .ordered
        .iter()
        .filter(|r| r.stage_kind == "beat_write")
        .map(|r| graph::content(&connection, r).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(replay.text, bodies.join("\n\n"));
    assert!(!replay.text.contains("CHAPTER_WORKFLOW_BINDING"));
    assert_eq!(
        crate::services::draft_service::word_count(&replay.text),
        1300
    );
    let official: i64 = connection
        .query_row("SELECT COUNT(*) FROM chapter_drafts", [], |r| r.get(0))
        .unwrap();
    let artifacts: i64 = connection
        .query_row("SELECT COUNT(*) FROM result_artifacts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        (official, artifacts),
        (0, 0),
        "checkpoint capability does not adopt or bypass admission"
    );
}

#[test]
fn staged_second_scene_uses_actual_states_not_planned_outcomes() {
    let (mut connection, mut input) = fixture(2);
    prepare(&connection, &mut input).unwrap();
    for index in 0..5 {
        advance(&mut connection, &mut input, &format!("actual-{index}"));
    }
    let ctx = context(&input).unwrap();
    assert_eq!(stage_label(&input), "beat_plan:scene-2");
    let states = ctx.stage.payload["actualEntryState"]["priorStates"]
        .as_array()
        .unwrap();
    assert_eq!(states.len(), 1);
    assert_eq!(states[0]["semanticValidation"], "not_checked");
    assert_eq!(
        states[0]["sourceTextHash"],
        json!(large_text_repository::sha256(
            ctx.stage.payload["acceptedProse"].as_str().unwrap()
        ))
    );
    assert!(!states[0].to_string().contains("计划目标不是实际结果"));
}

#[test]
fn staged_structured_submission_rejects_scope_binding_and_missing_read_proofs() {
    let (mut connection, mut input) = fixture(1);
    prepare(&connection, &mut input).unwrap();
    advance(&mut connection, &mut input, "contract-import");
    start_stage_fixture(&mut connection, &input, "missing-reads");
    let error = submit(
        &mut connection,
        &input,
        "missing-reads",
        mock_arguments(&input).unwrap(),
    )
    .unwrap_err();
    assert!(error.contains("REQUIRED_CONTEXT_READ_MISSING"), "{error}");
    finish_failed(&mut connection, &input, "missing-reads").unwrap();
    set_run_status(&mut connection, "missing-reads", "failed");
    start_stage_fixture(&mut connection, &input, "wrong-scope");
    reads(&mut connection, &input, "wrong-scope");
    let mut args = mock_arguments(&input).unwrap();
    args["novelId"] = json!("foreign-novel");
    assert!(submit(&mut connection, &input, "wrong-scope", args)
        .unwrap_err()
        .contains("SUBMISSION_MISMATCH"));
    finish_failed(&mut connection, &input, "wrong-scope").unwrap();
    set_run_status(&mut connection, "wrong-scope", "failed");
    start_stage_fixture(&mut connection, &input, "wrong-binding");
    reads(&mut connection, &input, "wrong-binding");
    let mut args = mock_arguments(&input).unwrap();
    args["content"] = json!(args["content"]
        .as_str()
        .unwrap()
        .replace("staged-turn", "foreign-turn"));
    assert!(submit(&mut connection, &input, "wrong-binding", args)
        .unwrap_err()
        .contains("BINDING_MISMATCH"));
    assert_eq!(
        graph::rows(&connection, &input)
            .unwrap()
            .iter()
            .filter(|r| r.status == "succeeded")
            .count(),
        1
    );
}

#[test]
fn staged_ordinary_assistant_prose_cannot_advance_without_a_checkpoint() {
    let (mut connection, mut input) = fixture(1);
    prepare(&connection, &mut input).unwrap();
    advance(&mut connection, &mut input, "prose-import");
    start_stage_fixture(&mut connection, &input, "ordinary-prose");
    let result = TaskRuntimeResult {
        run: set_run_status(&mut connection, "ordinary-prose", "completed"),
        session_id: "isolated".into(),
        agent_id: "isolated".into(),
        worker_id: "isolated".into(),
        runtime: "controlled".into(),
        assistant_text: Some("我已完成，立即采用正文".into()),
        artifact_id: None,
        planned_action: None,
        session_lifecycle: None,
        model_tool_attestation: None,
        pending_chapter_candidate: None,
    };
    assert_eq!(
        next_stage(&connection, &input, &result).unwrap_err(),
        "CHAPTER_STAGED_REQUIRED_SUBMISSION_MISSING"
    );
}

#[test]
fn staged_cancelled_parent_rejects_late_tool_result_and_preserves_prior_success() {
    let (mut connection, mut input) = fixture(1);
    prepare(&connection, &mut input).unwrap();
    advance(&mut connection, &mut input, "cancel-import");
    start_stage_fixture(&mut connection, &input, "cancel-plan");
    reads(&mut connection, &input, "cancel-plan");
    let parent = input.execution.as_ref().unwrap().clone();
    parent.cancel.store(true, Ordering::SeqCst);
    assert_eq!(
        submit(
            &mut connection,
            &input,
            "cancel-plan",
            mock_arguments(&input).unwrap()
        )
        .unwrap_err(),
        "DSH_TASK_CANCELLED"
    );
    assert!(input
        .execution
        .as_ref()
        .unwrap()
        .cancel
        .load(Ordering::SeqCst));
    assert_eq!(
        graph::rows(&connection, &input)
            .unwrap()
            .iter()
            .filter(|r| r.status == "succeeded")
            .count(),
        1
    );
}

#[test]
fn staged_child_keeps_root_budget_and_narrows_tools_and_context() {
    let (mut connection, mut input) = fixture(1);
    connection.execute("INSERT INTO conversation_turns(turn_id,conversation_id,sequence,role,content,created_at)VALUES('unrelated-turn','staged-conversation',1,'assistant','OTHER_TASK_HIDDEN_MATERIAL',?1)",[now()]).unwrap();
    prepare(&connection, &mut input).unwrap();
    let root = input.execution.clone().unwrap();
    advance(&mut connection, &mut input, "budget-import");
    let child = input.execution.as_ref().unwrap();
    assert_eq!(child.root_run_id, root.root_run_id);
    assert_eq!(child.owner_id, root.owner_id);
    assert_eq!(
        (child.max_requests, child.max_tools, child.max_wall_ms),
        (root.max_requests, root.max_tools, root.max_wall_ms)
    );
    assert!(Arc::ptr_eq(&child.cancel, &root.cancel));
    assert_eq!(turn_allowed_tools(&input), chapter_stage::ALLOWED_TOOLS);
    assert!(!turn_allowed_tools(&input).contains("generate_chapter"));
    assert!(!child
        .planned_instruction
        .as_deref()
        .unwrap()
        .contains("OTHER_TASK_HIDDEN_MATERIAL"));
    assert_ne!(
        task_session_id(&input, "child-a", None),
        task_session_id(&input, "child-b", None)
    );
    input.execution.as_mut().unwrap().max_stages = 1;
    assert_eq!(
        input
            .execution
            .as_ref()
            .unwrap()
            .check_stage(&connection, &input)
            .unwrap_err(),
        "DSH_ROOT_STAGE_BUDGET_EXHAUSTED"
    );
}

#[test]
fn staged_receipts_recheck_plan_and_manual_outline_changes() {
    let (mut connection, mut input) = fixture(1);
    prepare(&connection, &mut input).unwrap();
    advance(&mut connection, &mut input, "baseline-import");
    connection
        .execute(
            "UPDATE chapters SET outline='作者已修改章纲' WHERE id=?1",
            [input.chapter_id.as_deref().unwrap()],
        )
        .unwrap();
    assert!(prepare(&connection, &mut input)
        .unwrap_err()
        .contains("BASELINE_CHANGED"));
    let (mut connection, mut input) = fixture(1);
    prepare(&connection, &mut input).unwrap();
    advance(&mut connection, &mut input, "plan-baseline-import");
    connection
        .execute(
            "UPDATE chapter_engineering_states SET active_version=2 WHERE id='staged-plan'",
            [],
        )
        .unwrap();
    assert!(prepare(&connection, &mut input)
        .unwrap_err()
        .contains("BASELINE_CHANGED"));
}

#[test]
fn staged_no_plan_retains_whole_chapter_and_invalid_v2_never_falls_back() {
    let (connection, mut input) = fixture(1);
    connection
        .execute(
            "UPDATE chapter_engineering_states SET scene_plan_json='[]' WHERE id='staged-plan'",
            [],
        )
        .unwrap();
    prepare(&connection, &mut input).unwrap();
    assert!(context(&input).is_none());
    assert_eq!(input.task_kind, "chapter_write");
    connection.execute("UPDATE chapter_engineering_states SET scene_plan_json='[{\"planVersion\":2,\"beats\":[]}]' WHERE id='staged-plan'",[]).unwrap();
    assert!(prepare(&connection, &mut input).is_err());
}

#[test]
fn staged_initial_plan_bounds_are_finite_and_owned_by_the_root() {
    let (connection, input) = fixture(2);
    let bounds: StagedBudgetBounds = budget_bounds(&connection, &input).unwrap().unwrap();
    assert!(bounds.stages >= 10 && bounds.stages <= 64);
    assert!(bounds.requests >= 18 && bounds.requests <= 192);
    assert!(bounds.tools >= 30 && bounds.tools <= 512);
    let root = input.execution.as_ref().unwrap();
    assert_eq!(
        (root.max_stages, root.max_requests, root.max_tools),
        (bounds.stages, bounds.requests, bounds.tools)
    );
    let wire:StartTaskTurnInput=serde_json::from_value(json!({"conversationId":input.conversation_id,"turnId":input.turn_id,
        "novelId":input.novel_id,"chapterId":input.chapter_id,"goal":input.goal,"taskKind":"chapter_stage_write",
        "modelSnapshot":input.model_snapshot,"requestPolicy":{"maxRequestsPerMinute":120,"maxConcurrentRequests":2,"warningPercent":80,"timeoutSeconds":120},
        "execution":{"staged":{"stage":{"kind":"chapter_assemble"}},"maxStages":999999}})).unwrap();
    assert!(wire.execution.is_none());
    assert!(context(&wire).is_none());
}

#[test]
fn staged_library_and_missing_novel_scopes_fail_without_placeholder_or_writes() {
    let (mut connection,mut original)=fixture(1);
    assert!(original.scope.is_none());
    assert!(original.novel_id.is_some());
    prepare(&connection,&mut original).unwrap();
    let changes_before:i64=connection.query_row("SELECT total_changes()",[],|r|r.get(0)).unwrap();
    for mode in ["missing","library","forged_library"] {
        let mut input=original.clone();
        input.chapter_id=None;
        if mode!="forged_library" { input.novel_id=None; }
        input.scope=if mode=="missing" {None} else {Some(TaskScope::Library {
            source_id:"isolated-library-source".into(),source_hash:"a".repeat(64),
        })};
        assert!(metadata(&input).is_none());
        assert!(!is_local(&input));
        for error in [
            prepare(&connection,&mut input).unwrap_err(),
            budget_bounds(&connection,&input).unwrap_err(),
            source::load(&connection,&input).unwrap_err(),
            graph::rows(&connection,&input).unwrap_err(),
            mock_arguments(&input).unwrap_err(),
            begin(&mut connection,&input,"not-created").unwrap_err(),
            validate_application_source(&connection,&input,&json!({})).unwrap_err(),
        ] { assert!(error.starts_with("DSH_NOVEL_SCOPE_REQUIRED"),"{mode}: {error}"); }
    }
    let changes_after:i64=connection.query_row("SELECT total_changes()",[],|r|r.get(0)).unwrap();
    assert_eq!(changes_before,changes_after);
}

#[test]
fn staged_state_evidence_is_utf16_exact_and_never_semantically_verified() {
    let prose = "沈砚😀停在桥边。";
    let mut value = json!({"schemaVersion":1,"sourceTextHash":large_text_repository::sha256(prose),"actualStateChange":[],
        "endState":{"text":"停在桥边","epistemic":"explicit","evidence":[{"start":4,"end":9,"quote":"停在桥边。"}]},
        "unknowns":[],"semanticValidation":"not_checked"});
    validation::validate_state(&value, prose).unwrap();
    value["endState"]["evidence"][0]["start"] = json!(3);
    assert!(validation::validate_state(&value, prose).is_err());
    value["endState"] = Value::Null;
    assert!(validation::validate_state(&value, prose)
        .unwrap_err()
        .contains("UNKNOWN_REQUIRED"));
    value["unknowns"] = json!(["结束位置未能确认"]);
    validation::validate_state(&value, prose).unwrap();
    value["semanticValidation"] = json!("passed");
    assert!(validation::validate_state(&value, prose).is_err());
}
