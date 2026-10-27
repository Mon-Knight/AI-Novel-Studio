use super::super::{
    append_tool_event, append_turn, create_artifact_card, create_conversation, create_run,
    get_bundle, update_run, AppendToolEventInput, AppendTurnInput, ConversationWindowInput,
    CreateArtifactCardInput, CreateConversationInput, CreateRunInput, UpdateRunInput,
};
use super::{get_conversation_window, list_running_task_targets};
use rusqlite::Connection;
use serde_json::json;

fn connection() -> Connection {
    let mut connection = Connection::open_in_memory().expect("connection");
    connection
        .execute_batch("PRAGMA foreign_keys=ON;")
        .expect("pragma");
    crate::db::create_tables(&mut connection).expect("schema");
    connection
        .execute(
            "INSERT INTO novels (id, title, outline, created_at, updated_at)
             VALUES ('novel-window', '窗口小说', '', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z')",
            [],
        )
        .expect("novel");
    connection
        .execute(
            "INSERT INTO novels (id, title, outline, created_at, updated_at)
             VALUES ('novel-other', '另一本', '', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z')",
            [],
        )
        .expect("other novel");
    connection
        .execute(
            "INSERT INTO chapters (id, novel_id, title, order_index, status, word_count, created_at, updated_at)
             VALUES ('chapter-1', 'novel-window', '一', 1, 'drafted', 0, 't', 't'),
                     ('chapter-2', 'novel-window', '二', 2, 'drafted', 0, 't', 't')",
            [],
        )
        .expect("chapters");
    connection
}

fn conversation(connection: &mut Connection, id: &str, novel_id: &str) {
    create_conversation(
        connection,
        CreateConversationInput {
            conversation_id: id.to_string(),
            novel_id: novel_id.to_string(),
            title: id.to_string(),
            default_model: None,
            created_at: "2026-08-20T00:00:00Z".to_string(),
        },
    )
    .expect("conversation");
}

fn user_turn(connection: &mut Connection, conversation_id: &str, turn_id: &str, content: &str) {
    append_turn(
        connection,
        AppendTurnInput {
            turn_id: turn_id.to_string(),
            conversation_id: conversation_id.to_string(),
            role: "user".to_string(),
            content: content.to_string(),
            created_at: "2026-08-20T00:00:01Z".to_string(),
        },
    )
    .expect("turn");
}

fn input(conversation_id: &str, limit: i64) -> ConversationWindowInput {
    ConversationWindowInput {
        conversation_id: conversation_id.to_string(),
        limit: Some(limit),
        before_user_sequence: None,
        min_user_sequence: None,
        focus_turn_id: None,
        focus_card_id: None,
    }
}

#[test]
fn rejects_illegal_window_arguments_without_reading_rows() {
    let connection = Connection::open_in_memory().expect("connection");
    let mixed = get_conversation_window(
        &connection,
        ConversationWindowInput {
            conversation_id: "task".to_string(),
            limit: Some(8),
            before_user_sequence: Some(1),
            min_user_sequence: Some(1),
            focus_turn_id: None,
            focus_card_id: None,
        },
    )
    .expect_err("mixed cursors");
    assert_eq!(mixed.code, "CONVERSATION_WINDOW_INVALID");

    let oversized = get_conversation_window(
        &connection,
        ConversationWindowInput {
            conversation_id: "task".to_string(),
            limit: Some(201),
            before_user_sequence: None,
            min_user_sequence: Some(0),
            focus_turn_id: None,
            focus_card_id: None,
        },
    )
    .expect_err("refresh cap");
    assert_eq!(oversized.code, "CONVERSATION_WINDOW_INVALID");

    let page = get_conversation_window(
        &connection,
        ConversationWindowInput {
            conversation_id: "task".to_string(),
            limit: Some(33),
            before_user_sequence: None,
            min_user_sequence: None,
            focus_turn_id: None,
            focus_card_id: None,
        },
    )
    .expect_err("page cap");
    assert_eq!(page.code, "CONVERSATION_WINDOW_INVALID");

    let parsed: ConversationWindowInput = serde_json::from_value(json!({
        "conversationId": "task",
        "focusCardId": "card-1",
        "limit": 8
    }))
    .expect("camelCase contract");
    assert_eq!(parsed.focus_card_id.as_deref(), Some("card-1"));
    assert!(parsed.before_user_sequence.is_none());
}

#[test]
fn window_orders_equal_timestamps_by_sequence_and_keeps_full_get() {
    let mut connection = connection();
    conversation(&mut connection, "task-window", "novel-window");
    user_turn(&mut connection, "task-window", "turn-old", "先写第一章");
    append_turn(
        &mut connection,
        AppendTurnInput {
            turn_id: "turn-automatic".to_string(),
            conversation_id: "task-window".to_string(),
            role: "user".to_string(),
            content: format!("准备资产{}", super::AUTOMATIC_ASSET_SUFFIX),
            created_at: "2026-08-20T00:00:01Z".to_string(),
        },
    )
    .expect("automatic turn");
    user_turn(&mut connection, "task-window", "turn-new", "再写第二章");
    create_run(
        &mut connection,
        CreateRunInput {
            run_id: "run-old".to_string(),
            conversation_id: "task-window".to_string(),
            turn_id: "turn-old".to_string(),
            model_snapshot: json!({ "providerId": "mock", "modelId": "m", "runtimeMode": "mock" }),
            worker_id: "worker".to_string(),
            chapter_id: None,
            created_at: "2026-08-20T00:00:01Z".to_string(),
        },
    )
    .expect("run");
    append_tool_event(
        &mut connection,
        AppendToolEventInput {
            event_id: "event-old".to_string(),
            run_id: "run-old".to_string(),
            tool_name: "generate_chapter".to_string(),
            arguments_summary: json!({ "chapterId": "chapter-1" }),
            status: "pending".to_string(),
            duration_ms: None,
            error: None,
            result: None,
            created_at: "2026-08-20T00:00:01Z".to_string(),
            finished_at: None,
        },
    )
    .expect("tool");
    super::super::tests::insert_valid_chapter_artifact(
        &connection,
        "artifact-old",
        "novel-window",
        "chapter-1",
        "旧候选",
    );
    super::super::tests::insert_valid_chapter_artifact(
        &connection,
        "artifact-new",
        "novel-window",
        "chapter-1",
        "新候选",
    );
    create_artifact_card(
        &mut connection,
        CreateArtifactCardInput {
            card_id: "card-old".to_string(),
            conversation_id: "task-window".to_string(),
            turn_id: Some("turn-old".to_string()),
            run_id: Some("run-old".to_string()),
            artifact_id: Some("artifact-old".to_string()),
            artifact_type: "chapter_candidate".to_string(),
            title: "旧候选".to_string(),
            summary: "旧".to_string(),
            content: None,
            status: "candidate".to_string(),
            created_at: "2026-08-20T00:00:01Z".to_string(),
        },
    )
    .expect("old card");
    create_artifact_card(
        &mut connection,
        CreateArtifactCardInput {
            card_id: "card-new".to_string(),
            conversation_id: "task-window".to_string(),
            turn_id: Some("turn-new".to_string()),
            run_id: None,
            artifact_id: Some("artifact-new".to_string()),
            artifact_type: "chapter_candidate".to_string(),
            title: "新候选".to_string(),
            summary: "新".to_string(),
            content: None,
            status: "candidate".to_string(),
            created_at: "2026-08-20T00:00:01Z".to_string(),
        },
    )
    .expect("new card");

    let latest = get_conversation_window(&connection, input("task-window", 1))
        .expect("window")
        .expect("present");
    let turn_ids: Vec<_> = latest
        .bundle
        .turns
        .iter()
        .map(|turn| turn.turn_id.as_str())
        .collect();
    assert_eq!(turn_ids, ["turn-new"]);
    assert!(latest.bundle.tool_events.is_empty());
    assert_eq!(latest.bundle.artifacts.len(), 1);
    assert_eq!(latest.bundle.artifacts[0].card_id, "card-new");
    assert!(latest.has_older);
    assert!(!latest.has_newer);
    assert_eq!(latest.user_round_count, 1);

    let full = get_bundle(&connection, "task-window")
        .expect("full get")
        .expect("bundle");
    assert_eq!(full.turns.len(), 3);
    assert_eq!(full.tool_events.len(), 1);

    let older = get_conversation_window(
        &connection,
        ConversationWindowInput {
            before_user_sequence: latest.oldest_user_sequence,
            ..input("task-window", 8)
        },
    )
    .expect("older")
    .expect("present");
    assert_eq!(older.bundle.turns[0].turn_id, "turn-old");
    assert_eq!(older.bundle.turns[1].turn_id, "turn-automatic");
    assert!(older
        .bundle
        .turns
        .iter()
        .all(|turn| turn.created_at == "2026-08-20T00:00:01Z"));
    assert!(older.bundle.turns[0].sequence < older.bundle.turns[1].sequence);
    assert_eq!(older.bundle.tool_events.len(), 1);
    assert!(!older.has_older);
    assert!(older.has_newer);
}

#[test]
fn refresh_cap_reports_older_gap_without_claiming_the_tail_is_incomplete() {
    let mut connection = connection();
    conversation(&mut connection, "task-cap", "novel-window");
    for index in 0..12 {
        user_turn(
            &mut connection,
            "task-cap",
            &format!("turn-{index}"),
            "继续写这一章",
        );
    }
    let first: i64 = connection
        .query_row(
            "SELECT MIN(sequence) FROM conversation_turns WHERE conversation_id='task-cap'",
            [],
            |row| row.get(0),
        )
        .expect("first");
    let page = get_conversation_window(
        &connection,
        ConversationWindowInput {
            min_user_sequence: Some(first),
            ..input("task-cap", 8)
        },
    )
    .expect("capped refresh")
    .expect("present");
    assert_eq!(page.user_round_count, 8);
    assert!(page.has_older);
    assert!(!page.has_newer);
    assert_eq!(page.bundle.turns.first().unwrap().turn_id, "turn-4");
    assert_eq!(page.bundle.turns.last().unwrap().turn_id, "turn-11");
    assert!(page.end_sequence_exclusive.is_none());
}

#[test]
fn focus_must_belong_to_the_conversation_and_targets_keep_run_chapters() {
    let mut connection = connection();
    conversation(&mut connection, "task-a", "novel-window");
    conversation(&mut connection, "task-b", "novel-window");
    conversation(&mut connection, "task-other", "novel-other");
    user_turn(&mut connection, "task-a", "turn-a", "继续写第一章正文");
    user_turn(&mut connection, "task-b", "turn-b", "检查本章一致性");
    user_turn(&mut connection, "task-other", "turn-other", "继续写第一章正文");
    let snapshot = json!({ "providerId": "mock", "modelId": "m", "runtimeMode": "mock" });
    create_run(
        &mut connection,
        CreateRunInput {
            run_id: "run-a".to_string(),
            conversation_id: "task-a".to_string(),
            turn_id: "turn-a".to_string(),
            model_snapshot: snapshot.clone(),
            worker_id: "worker".to_string(),
            chapter_id: Some("chapter-1".to_string()),
            created_at: "2026-08-20T00:00:02Z".to_string(),
        },
    )
    .expect("run a");
    create_run(
        &mut connection,
        CreateRunInput {
            run_id: "run-b".to_string(),
            conversation_id: "task-b".to_string(),
            turn_id: "turn-b".to_string(),
            model_snapshot: snapshot,
            worker_id: "worker".to_string(),
            chapter_id: Some("chapter-2".to_string()),
            created_at: "2026-08-20T00:00:03Z".to_string(),
        },
    )
    .expect("run b");
    update_run(
        &mut connection,
        UpdateRunInput {
            run_id: "run-b".to_string(),
            status: "failed".to_string(),
            error: Some("停止".to_string()),
            updated_at: "2026-08-20T00:00:04Z".to_string(),
            started_at: None,
            finished_at: Some("2026-08-20T00:00:04Z".to_string()),
        },
    )
    .expect("terminal run is not a live target");

    let foreign = get_conversation_window(
        &connection,
        ConversationWindowInput {
            focus_turn_id: Some("turn-b".to_string()),
            ..input("task-a", 8)
        },
    )
    .expect_err("foreign focus");
    assert_eq!(foreign.code, "CONVERSATION_WINDOW_INVALID");
    assert!(get_conversation_window(&connection, input("missing-task", 8))
        .expect("missing")
        .is_none());

    let targets = list_running_task_targets(&connection, "novel-window").expect("targets");
    assert_eq!(targets.len(), 1);
    assert_eq!(targets[0].run_id, "run-a");
    assert_eq!(targets[0].chapter_id.as_deref(), Some("chapter-1"));
    assert_eq!(targets[0].latest_goal.as_deref(), Some("继续写第一章正文"));
    create_run(
        &mut connection,
        CreateRunInput {
            run_id: "run-other".to_string(),
            conversation_id: "task-other".to_string(),
            turn_id: "turn-other".to_string(),
            model_snapshot: json!({ "providerId": "mock", "modelId": "m", "runtimeMode": "mock" }),
            worker_id: "worker".to_string(),
            chapter_id: None,
            created_at: "2026-08-20T00:00:05Z".to_string(),
        },
    )
    .expect("other novel run");
    let other = list_running_task_targets(&connection, "novel-other").expect("other");
    assert_eq!(other.len(), 1);
    assert_eq!(other[0].chapter_id, None);
    assert!(list_running_task_targets(&connection, "novel-window")
        .expect("window novel")
        .iter()
        .all(|target| target.conversation_id != "task-other"));
}

#[test]
fn candidate_ordinal_is_stable_across_latest_older_focus_and_refresh() {
    let mut connection = connection();
    conversation(&mut connection, "task-ordinal", "novel-window");
    let early = append_turn(
        &mut connection,
        AppendTurnInput {
            turn_id: "turn-early".to_string(),
            conversation_id: "task-ordinal".to_string(),
            role: "user".to_string(),
            content: "先写第一章".to_string(),
            created_at: "2026-08-20T00:00:01Z".to_string(),
        },
    )
    .expect("early turn");
    let late = append_turn(
        &mut connection,
        AppendTurnInput {
            turn_id: "turn-late".to_string(),
            conversation_id: "task-ordinal".to_string(),
            role: "user".to_string(),
            content: "再写第二章".to_string(),
            created_at: "2026-08-20T00:00:01Z".to_string(),
        },
    )
    .expect("late turn");
    super::super::tests::insert_valid_chapter_artifact(
        &connection,
        "artifact-early",
        "novel-window",
        "chapter-1",
        "早期候选",
    );
    super::super::tests::insert_valid_chapter_artifact(
        &connection,
        "artifact-late",
        "novel-window",
        "chapter-1",
        "最新候选",
    );
    for (card_id, turn_id, artifact_id) in [
        ("card-early", "turn-early", "artifact-early"),
        ("card-late", "turn-late", "artifact-late"),
    ] {
        create_artifact_card(
            &mut connection,
            CreateArtifactCardInput {
                card_id: card_id.to_string(),
                conversation_id: "task-ordinal".to_string(),
                turn_id: Some(turn_id.to_string()),
                run_id: None,
                artifact_id: Some(artifact_id.to_string()),
                artifact_type: "chapter_text".to_string(),
                title: card_id.to_string(),
                summary: "候选".to_string(),
                content: None,
                status: "candidate".to_string(),
                created_at: "2026-08-20T00:00:01Z".to_string(),
            },
        )
        .expect(card_id);
    }
    let latest = get_conversation_window(&connection, input("task-ordinal", 1))
        .expect("latest")
        .expect("present");
    assert_eq!(latest.bundle.artifacts.len(), 1);
    assert_eq!(latest.bundle.artifacts[0].card_id, "card-late");
    assert_eq!(latest.bundle.artifacts[0].candidate_ordinal, Some(2));
    let older = get_conversation_window(
        &connection,
        ConversationWindowInput {
            before_user_sequence: Some(late.sequence),
            ..input("task-ordinal", 8)
        },
    )
    .expect("older")
    .expect("present");
    let early_card = older
        .bundle
        .artifacts
        .iter()
        .find(|card| card.card_id == "card-early")
        .expect("early card");
    assert_eq!(early_card.candidate_ordinal, Some(1));
    let focused = get_conversation_window(
        &connection,
        ConversationWindowInput {
            focus_card_id: Some("card-early".to_string()),
            ..input("task-ordinal", 1)
        },
    )
    .expect("focus")
    .expect("present");
    assert_eq!(focused.bundle.artifacts[0].candidate_ordinal, Some(1));
    let refreshed = get_conversation_window(
        &connection,
        ConversationWindowInput {
            min_user_sequence: Some(early.sequence),
            ..input("task-ordinal", 1)
        },
    )
    .expect("refresh")
    .expect("present");
    assert_eq!(refreshed.bundle.artifacts[0].card_id, "card-late");
    assert_eq!(refreshed.bundle.artifacts[0].candidate_ordinal, Some(2));
    let full = get_bundle(&connection, "task-ordinal").expect("full").expect("bundle");
    assert!(full.artifacts.iter().all(|card| card.candidate_ordinal.is_none()));
}
