use super::*;

fn running_run(connection: &mut rusqlite::Connection, input: &StartTaskTurnInput, id: &str) {
    conversation_service::create_run(
        connection,
        CreateRunInput {
            run_id: id.into(),
            conversation_id: input.conversation_id.clone(),
            turn_id: input.turn_id.clone(),
            model_snapshot: input.model_snapshot.clone(),
            worker_id: "retry".into(),
            chapter_id: input.chapter_id.clone(),
            created_at: now(),
        },
    )
    .unwrap();
    conversation_service::update_run(
        connection,
        UpdateRunInput {
            run_id: id.into(),
            status: "running".into(),
            error: None,
            updated_at: now(),
            started_at: Some(now()),
            finished_at: None,
        },
    )
    .unwrap();
}

fn finish_run(connection: &mut rusqlite::Connection, id: &str, status: &str) {
    conversation_service::update_run(
        connection,
        UpdateRunInput {
            run_id: id.into(),
            status: status.into(),
            error: (status == "failed").then(|| "SERVER".into()),
            updated_at: now(),
            started_at: None,
            finished_at: Some(now()),
        },
    )
    .unwrap();
}

#[test]
fn retry_restores_verified_full_stage_contract_and_rejects_scope_model_and_range_changes() {
    let input = chapter_write_input();
    let mut connection = chapter_length_connection(&input);
    running_run(&mut connection, &input, "source");
    retry::record_contract(&mut connection, &input, "source").unwrap();
    finish_run(&mut connection, "source", "failed");
    let resolution = retry::resolve_connection(
        &connection,
        &input.conversation_id,
        &input.novel_id,
        "source",
    )
    .unwrap();
    let execution = resolution.execution.unwrap();
    assert_eq!(execution.goal, input.goal);
    assert_eq!(execution.chapter_word_range, input.chapter_word_range);
    let mut changed = input.clone();
    changed.retry_source_run_id = Some("source".into());
    changed.chapter_host_gate.as_mut().unwrap().explicit_retry = true;
    retry::validate_retry(&connection, &changed).unwrap();
    changed.model_snapshot["modelId"] = json!("different");
    assert!(retry::validate_retry(&connection, &changed).is_err());
    changed.model_snapshot = input.model_snapshot.clone();
    changed.chapter_word_range.as_mut().unwrap().minimum = 100;
    assert!(retry::validate_retry(&connection, &changed).is_err());
    assert!(retry::resolve_connection(&connection, "other", &input.novel_id, "source").is_err());
    assert!(
        retry::resolve_connection(&connection, &input.conversation_id, "other", "source").is_err()
    );
    connection.execute("UPDATE large_text_documents SET content_sha256='changed' WHERE id='source-execution-contract-result'",[]).unwrap();
    assert!(retry::resolve_connection(
        &connection,
        &input.conversation_id,
        &input.novel_id,
        "source"
    )
    .is_err());
}

#[test]
fn retry_skips_only_completed_planning_and_refuses_active_unknown_success_or_existing_candidate() {
    for case in ["planner", "unknown", "active", "candidate"] {
        let input = chapter_write_input();
        let mut connection = chapter_length_connection(&input);
        running_run(&mut connection, &input, "source");
        retry::record_contract(&mut connection, &input, "source").unwrap();
        finish_run(&mut connection, "source", "failed");
        running_run(&mut connection, &input, "later");
        if case != "unknown" {
            chapter_length_tool(
                &mut connection,
                "later",
                "creative.plan_action",
                1,
                "plan",
                "succeeded",
                Some(json!({"ok":true})),
            );
        }
        if case == "candidate" {
            chapter_length_tool(
                &mut connection,
                "later",
                "generate_chapter",
                2,
                "candidate",
                "succeeded",
                Some(json!({"ok":true})),
            );
        }
        if case != "active" {
            finish_run(&mut connection, "later", "completed");
        }
        let result = retry::resolve_connection(
            &connection,
            &input.conversation_id,
            &input.novel_id,
            "source",
        );
        assert_eq!(result.is_ok(), case == "planner", "{case}: {result:?}");
    }
}

#[test]
fn creative_and_writing_sessions_do_not_share_tool_transcripts_or_retry_instructions() {
    let writing = chapter_write_input();
    let mut dialogue = writing.clone();
    dialogue.task_kind = "creative_dialogue".into();
    dialogue.expected_tool = None;
    dialogue.expected_artifact_type = None;
    dialogue.required_read_tools.clear();
    dialogue.chapter_word_range = None;
    dialogue.chapter_host_gate = None;
    assert_ne!(
        task_session_id(&writing, "run-1", None),
        task_session_id(&dialogue, "run-2", None)
    );
    let prompt = workbench_turn_prompt_for_attempt(&dialogue, 0, 2);
    assert!(prompt.contains("只允许调用 creative.plan_action"));
    assert!(!prompt.contains("全部 Tool Result 返回后再进入候选阶段"));
    assert_eq!(turn_allowed_tools(&dialogue), creative_dialogue::ALLOWED);
}

fn legacy_planner(connection: &mut rusqlite::Connection, input: &StartTaskTurnInput, id: &str) {
    running_run(connection, input, id);
    chapter_length_tool(
        connection,
        id,
        "creative.plan_action",
        1,
        "plan",
        "succeeded",
        Some(
            json!({"ok":true,"workflowRequestOnly":true,"novelId":input.novel_id,
            "data":{"action":"generate_chapter","chapterId":input.chapter_id,
                "instruction":"规划中的说明不可替换原用户回合"}}),
        ),
    );
    finish_run(connection, id, "completed");
}

#[test]
fn retry_legacy_failed_replanning_restores_original_goal_and_consistent_prior_native_range() {
    let input = chapter_write_input();
    let mut connection = chapter_length_connection(&input);
    legacy_planner(&mut connection, &input, "planner");
    for id in ["length-one", "length-two"] {
        running_run(&mut connection, &input, id);
        let error = validate_chapter_candidate_length(&input, &"字".repeat(2)).unwrap_err();
        chapter_length_fail_run(&mut connection, id, &error.to_string());
    }
    running_run(&mut connection, &input, "source");
    finish_run(&mut connection, "source", "failed");
    let restored = retry::resolve_connection(
        &connection,
        &input.conversation_id,
        &input.novel_id,
        "source",
    )
    .unwrap()
    .execution
    .unwrap();
    assert_eq!(restored.goal, input.goal);
    assert_eq!(restored.task_kind, "chapter_write");
    assert_eq!(restored.chapter_word_range, input.chapter_word_range);
    assert_eq!(restored.required_read_tools, input.required_read_tools);
    let mut retry_input = input.clone();
    retry_input.retry_source_run_id = Some("source".into());
    retry_input
        .chapter_host_gate
        .as_mut()
        .unwrap()
        .explicit_retry = true;
    retry::validate_retry(&connection, &retry_input).unwrap();
}

#[test]
fn retry_legacy_never_guesses_missing_range_or_borrows_other_model_or_later_planning() {
    for case in ["missing", "other-model", "conflicting"] {
        let input = chapter_write_input();
        let mut connection = chapter_length_connection(&input);
        legacy_planner(&mut connection, &input, "planner");
        if case != "missing" {
            let mut earlier = input.clone();
            if case == "other-model" {
                earlier.model_snapshot["modelId"] = json!("another-model");
            }
            running_run(&mut connection, &earlier, "length-one");
            let error = validate_chapter_candidate_length(&earlier, &"字".repeat(2)).unwrap_err();
            chapter_length_fail_run(&mut connection, "length-one", &error.to_string());
            if case == "conflicting" {
                earlier.chapter_word_range.as_mut().unwrap().maximum += 1;
                running_run(&mut connection, &earlier, "length-two");
                let error =
                    validate_chapter_candidate_length(&earlier, &"字".repeat(2)).unwrap_err();
                chapter_length_fail_run(&mut connection, "length-two", &error.to_string());
            }
        }
        running_run(&mut connection, &input, "source");
        finish_run(&mut connection, "source", "failed");
        legacy_planner(&mut connection, &input, "later-planner");
        let error = retry::resolve_connection(
            &connection,
            &input.conversation_id,
            &input.novel_id,
            "source",
        )
        .expect_err(case);
        assert!(
            error.contains(if case == "conflicting" {
                "SOURCE_INVALID"
            } else {
                "LEGACY_RANGE_MISSING"
            }),
            "{case}: {error}"
        );
    }
}

#[test]
fn retry_legacy_setting_revision_uses_verified_turn_source_without_replanning() {
    use super::revision_tests::{
        append_revision_turn, candidate_source, completed_candidate, decide, fixture,
    };
    let (mut connection, mut input) = fixture();
    input.chapter_id = None;
    input.chapter_host_gate = None;
    input.continuity_claim = None;
    input.task_kind = "setting_expand".into();
    input.expected_tool = Some("expand_settings".into());
    input.expected_artifact_type = Some("setting_candidates".into());
    input.required_read_tools = vec!["novel.read_context".into()];
    let raw =
        json!({"settings":[{"name":"地名","targetType":"world_setting","content":"临汀市。"}]})
            .to_string();
    let original = completed_candidate(&mut connection, &input, "original", &raw);
    let source = candidate_source(&connection, &input, &original);
    decide(&mut connection, &source, "request_revision");
    append_revision_turn(
        &mut connection,
        &mut input,
        Some(&source),
        "修订设定，第2章只引用时间线，不生成正文",
    );
    revision_source::freeze_turn_revision(&connection, &mut input).unwrap();
    running_run(&mut connection, &input, "interrupted");
    finish_run(&mut connection, "interrupted", "failed");
    let resolved = retry::resolve_connection(
        &connection,
        &input.conversation_id,
        &input.novel_id,
        "interrupted",
    )
    .unwrap();
    assert_eq!(resolved.chapter_id, None);
    let execution = resolved.execution.unwrap();
    assert_eq!(execution.goal, input.goal);
    assert_eq!(execution.task_kind, "setting_expand");
    assert_eq!(execution.expected_tool.as_deref(), Some("expand_settings"));
    decide(&mut connection, &source, "reject");
    assert!(retry::resolve_connection(
        &connection,
        &input.conversation_id,
        &input.novel_id,
        "interrupted"
    )
    .is_err());
}
