use super::*;
use rusqlite::Connection;

fn run_with_status(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    id: &str,
    status: &str,
) {
    conversation_service::create_run(
        connection,
        CreateRunInput {
            run_id: id.to_string(),
            conversation_id: input.conversation_id.clone(),
            turn_id: input.turn_id.clone(),
            model_snapshot: input.model_snapshot.clone(),
            worker_id: "retry-budget-fixture".to_string(),
            chapter_id: input.chapter_id.clone(),
            created_at: now(),
        },
    )
    .unwrap();
    conversation_service::update_run(
        connection,
        UpdateRunInput {
            run_id: id.to_string(),
            status: "running".to_string(),
            error: None,
            updated_at: now(),
            started_at: Some(now()),
            finished_at: None,
        },
    )
    .unwrap();
    if status != "running" {
        conversation_service::update_run(
            connection,
            UpdateRunInput {
                run_id: id.to_string(),
                status: status.to_string(),
                error: (status == "failed")
                    .then(|| "SERVER: upstream request timed out".to_string()),
                updated_at: now(),
                started_at: None,
                finished_at: Some(now()),
            },
        )
        .unwrap();
    }
}

fn complete_run(connection: &mut Connection, id: &str) {
    conversation_service::update_run(
        connection,
        UpdateRunInput {
            run_id: id.to_string(),
            status: "completed".to_string(),
            error: None,
            updated_at: now(),
            started_at: None,
            finished_at: Some(now()),
        },
    )
    .unwrap();
}

#[test]
fn explicit_chapter_retry_after_a_completed_planner_uses_the_failed_draft_outcome() {
    let input = chapter_write_input();
    let mut connection = chapter_length_connection(&input);
    run_with_status(&mut connection, &input, "a-server-failed", "failed");
    run_with_status(&mut connection, &input, "z-completed-planner", "running");
    chapter_length_tool(
        &mut connection,
        "z-completed-planner",
        "creative.plan_action",
        1,
        "plan",
        "succeeded",
        Some(json!({"ok":true,"data":{"action":"generate_chapter"}})),
    );
    complete_run(&mut connection, "z-completed-planner");
    let mut retry = input.clone();
    retry.chapter_host_gate.as_mut().unwrap().explicit_retry = true;
    let budget = chapter_budget::bind_draft_attempt_connection(&connection, &mut retry)
        .expect("a successful planner must not hide the failed writing attempt");
    assert_eq!(budget.calls, 0);
    assert!(!budget.remaining.is_zero());
    assert!(retry
        .model_snapshot
        .pointer("/runtime/chapterBudgetEpoch")
        .and_then(Value::as_str)
        .unwrap()
        .starts_with("attempt:"));
}

#[test]
fn explicit_chapter_retry_keeps_completed_candidate_unknown_and_active_runs_blocked() {
    for case in ["unknown-completed", "mixed-candidate", "active-planner"] {
        let input = chapter_write_input();
        let mut connection = chapter_length_connection(&input);
        run_with_status(&mut connection, &input, "a-server-failed", "failed");
        run_with_status(&mut connection, &input, "z-latest", "running");
        if case != "unknown-completed" {
            chapter_length_tool(
                &mut connection,
                "z-latest",
                "creative.plan_action",
                1,
                "plan",
                "succeeded",
                Some(json!({"ok":true})),
            );
        }
        if case == "mixed-candidate" {
            chapter_length_tool(
                &mut connection,
                "z-latest",
                "generate_chapter",
                2,
                "candidate",
                "succeeded",
                Some(json!({"ok":true,"data":{"text":"正文"}})),
            );
        }
        if case != "active-planner" {
            complete_run(&mut connection, "z-latest");
        }
        let mut retry = input.clone();
        retry.chapter_host_gate.as_mut().unwrap().explicit_retry = true;
        assert!(
            chapter_budget::bind_draft_attempt_connection(&connection, &mut retry).is_err(),
            "must still block {case}"
        );
    }
}
