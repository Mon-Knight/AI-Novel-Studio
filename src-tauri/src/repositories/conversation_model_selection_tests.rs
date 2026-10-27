use super::*;
use serde_json::json;

const TIME: &str = "2026-10-13T00:00:00Z";
const CONVERSATION: &str = "model-selection-task";

fn model(name: &str, endpoint: &str) -> Value {
    json!({
        "providerId": "mock",
        "modelId": name,
        "runtimeMode": "mock",
        "baseUrl": endpoint,
        "capabilities": ["conversation_turn", "chapter_generate"],
        "options": {"temperature": 0.4},
        "capturedAt": TIME
    })
}

fn fixture(default_model: Option<Value>) -> Connection {
    let mut connection = super::tests::connection();
    create_conversation(
        &mut connection,
        CreateConversationInput {
            conversation_id: CONVERSATION.into(),
            novel_id: "novel-conversation-test".into(),
            title: "可切换模型任务".into(),
            default_model,
            created_at: TIME.into(),
        },
    )
    .expect("conversation");
    append_turn(
        &mut connection,
        AppendTurnInput {
            conversation_id: CONVERSATION.into(),
            turn_id: "turn-first".into(),
            role: "user".into(),
            content: "第一回合".into(),
            created_at: TIME.into(),
        },
    )
    .expect("turn");
    connection
}

fn choose(
    connection: &mut Connection,
    default_model: Value,
) -> Result<TaskConversationRecord, AppError> {
    update_conversation_model(
        connection,
        UpdateConversationModelInput {
            conversation_id: CONVERSATION.into(),
            default_model,
            updated_at: "2026-10-13T00:00:01Z".into(),
        },
    )
}

fn start(connection: &mut Connection, id: &str, turn: &str, snapshot: Value) -> TaskRunRecord {
    create_run(
        connection,
        CreateRunInput {
            run_id: id.into(),
            conversation_id: CONVERSATION.into(),
            turn_id: turn.into(),
            model_snapshot: snapshot,
            worker_id: format!("worker-{id}"),
            chapter_id: None,
            created_at: TIME.into(),
        },
    )
    .expect("run")
}

fn transition(connection: &mut Connection, id: &str, status: &str) {
    update_run(
        connection,
        UpdateRunInput {
            run_id: id.into(),
            status: status.into(),
            error: None,
            updated_at: TIME.into(),
            started_at: None,
            finished_at: None,
        },
    )
    .expect("transition");
}

#[test]
fn selection_changes_between_turns_and_retry_preserves_original_model() {
    let first = model("Mock-A", "https://first-provider.invalid/v1");
    let second = model("Mock-B", "https://second-provider.invalid/v1");
    let mut connection = fixture(Some(first.clone()));
    start(&mut connection, "run-a", "turn-first", first.clone());
    transition(&mut connection, "run-a", "cancelled");
    choose(&mut connection, second.clone()).expect("new selection");
    append_turn(
        &mut connection,
        AppendTurnInput {
            conversation_id: CONVERSATION.into(),
            turn_id: "turn-second".into(),
            role: "user".into(),
            content: "第二回合".into(),
            created_at: TIME.into(),
        },
    )
    .expect("second turn");
    start(&mut connection, "run-b", "turn-second", second.clone());
    transition(&mut connection, "run-b", "cancelled");
    start(&mut connection, "run-retry-a", "turn-first", first.clone());
    let bundle = get_bundle(&connection, CONVERSATION)
        .expect("bundle")
        .expect("saved task");
    assert_eq!(bundle.conversation.default_model, Some(second.clone()));
    assert_eq!(bundle.turns.len(), 2);
    for (id, expected) in [
        ("run-a", &first),
        ("run-b", &second),
        ("run-retry-a", &first),
    ] {
        assert_eq!(
            &get_run(&connection, id)
                .expect("run")
                .expect("stored run")
                .model_snapshot,
            expected
        );
    }
    assert!(
        connection
            .execute(
                "UPDATE task_runs SET model_snapshot_json=?1 WHERE run_id='run-a'",
                params![json_text(&second).expect("json")],
            )
            .is_err(),
        "historical run identity remains immutable"
    );
    assert_eq!(
        get_run(&connection, "run-a")
            .expect("run")
            .expect("stored")
            .model_snapshot,
        first
    );
}

#[test]
fn model_changes_reject_every_active_run_status_and_archived_task() {
    let first = model("Mock-A", "https://first-provider.invalid/v1");
    let second = model("Mock-B", "https://second-provider.invalid/v1");
    let mut connection = fixture(Some(first.clone()));
    start(&mut connection, "run-active", "turn-first", first.clone());
    for status in ["queued", "running", "cancel_requested"] {
        if status != "queued" {
            transition(&mut connection, "run-active", status);
        }
        // Prove the Run guard is authoritative even if a stale conversation projection is idle.
        connection
            .execute(
                "UPDATE task_conversations SET status='idle' WHERE conversation_id=?1",
                params![CONVERSATION],
            )
            .expect("stale projection");
        let error = choose(&mut connection, second.clone()).expect_err("active model change");
        assert_eq!(error.code, "CONVERSATION_RUNNING");
        assert_eq!(
            get_conversation(&connection, CONVERSATION)
                .expect("task")
                .expect("saved")
                .default_model,
            Some(first.clone())
        );
    }
    transition(&mut connection, "run-active", "cancelled");
    set_conversation_archived(
        &mut connection,
        SetConversationArchivedInput {
            conversation_id: CONVERSATION.into(),
            archived: true,
            updated_at: TIME.into(),
        },
    )
    .expect("archive");
    assert_eq!(
        choose(&mut connection, second.clone())
            .expect_err("archived change")
            .code,
        "CONVERSATION_ARCHIVED"
    );
    set_conversation_archived(
        &mut connection,
        SetConversationArchivedInput {
            conversation_id: CONVERSATION.into(),
            archived: false,
            updated_at: TIME.into(),
        },
    )
    .expect("restore");
    assert_eq!(
        choose(&mut connection, second.clone())
            .expect("restored choice")
            .default_model,
        Some(second)
    );
}

#[test]
fn legacy_tasks_with_history_can_select_models_and_change_endpoint_next_turn() {
    let first = model("Mock-A", "https://first-provider.invalid/v1");
    let second = model("Mock-A", "https://second-provider.invalid/v1");
    let mut connection = fixture(None);
    start(&mut connection, "run-legacy", "turn-first", first.clone());
    transition(&mut connection, "run-legacy", "cancelled");
    choose(&mut connection, first.clone()).expect("legacy choice with history");
    choose(&mut connection, second.clone()).expect("endpoint selection changes");
    start(
        &mut connection,
        "run-new-endpoint",
        "turn-first",
        second.clone(),
    );
    assert_eq!(
        get_run(&connection, "run-legacy")
            .expect("run")
            .expect("old run")
            .model_snapshot,
        first
    );
    assert_eq!(
        get_run(&connection, "run-new-endpoint")
            .expect("run")
            .expect("new run")
            .model_snapshot,
        second
    );
}

#[test]
fn retry_cannot_hydrate_an_unrelated_legacy_default_model() {
    let first = model("Mock-A", "https://first-provider.invalid/v1");
    let mut current = model("Mock-B", "https://second-provider.invalid/v1");
    current.as_object_mut().expect("model").remove("baseUrl");
    let mut connection = fixture(Some(current.clone()));
    start(
        &mut connection,
        "run-original-model-retry",
        "turn-first",
        first,
    );
    assert_eq!(
        get_conversation(&connection, CONVERSATION)
            .expect("task")
            .expect("saved")
            .default_model,
        Some(current)
    );
}
