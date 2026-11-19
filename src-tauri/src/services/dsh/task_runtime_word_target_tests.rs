use super::*;

#[test]
fn word_target_parser_accepts_author_directives_but_ignores_quotes_questions_and_book_targets() {
    for (text, expected) in [
        ("本任务目标字数设为3200字", Some((3200, true))),
        ("每章目标3.2千字", Some((3200, true))),
        ("生成下一章，目标3500字", Some((3500, false))),
        ("生成本章，当前章目标字数：3500", Some((3500, false))),
        ("生成本章，目标0.35万字", Some((3500, false))),
        ("生成本章，引用“目标9999字”", None),
        ("生成本章\n```\n目标9999字\n```", None),
        ("生成本章\n原文：\n目标9999字", None),
        ("生成本章\n> 目标9999字", None),
        ("全书目标30000字", None),
        ("不要调整目标3500字", None),
        ("目标3500字可以吗？", None),
    ] {
        assert_eq!(word_target::parse(text).unwrap(), expected, "{text}");
    }
    for text in [
        "目标0字",
        "本章目标3500字",
        "生成本章，目标3500字，目标3600字",
        "目标3000～4000字",
    ] {
        assert!(word_target::parse(text).is_err(), "{text}");
    }
}

#[test]
fn native_word_target_uses_persisted_current_author_and_earlier_task_scope() {
    let mut input = chapter_write_input();
    input.goal = "本任务目标字数设为3200字".into();
    let mut connection = chapter_length_connection(&input);
    let mut append = |id: &str, text: &str| {
        conversation_service::append_turn(
            &mut connection,
            conversation_service::AppendTurnInput {
                turn_id: id.into(),
                conversation_id: input.conversation_id.clone(),
                role: "user".into(),
                content: text.into(),
                created_at: now(),
            },
        )
        .unwrap();
    };
    append("other-chapter-local", "生成上章，目标4800字");
    append("current", "生成本章，目标3500字");
    append("next", "生成下一章");
    input.turn_id = "current".into();
    input.goal = "模型规划遗漏或擅改了目标".into();
    input.chapter_word_range = Some(ChapterWordRangeInput {
        target: 3500,
        minimum: 3150,
        maximum: 3850,
    });
    word_target::validate(&connection, &input).unwrap();
    input.chapter_word_range.as_mut().unwrap().target = 3200;
    assert!(word_target::validate(&connection, &input)
        .unwrap_err()
        .contains("WORD_TARGET_MISMATCH"));
    input.turn_id = "next".into();
    input.chapter_word_range = Some(ChapterWordRangeInput {
        target: 3200,
        minimum: 2880,
        maximum: 3520,
    });
    word_target::validate(&connection, &input).unwrap();
    input.chapter_word_range.as_mut().unwrap().target = 3500;
    assert!(
        word_target::validate(&connection, &input).is_err(),
        "chapter-local override must not leak"
    );
}

#[test]
fn native_word_setting_persists_a_completed_local_run_and_range_without_a_provider() {
    let (mut connection, input) = native_word_setting_fixture();
    let selected_model = input.model_snapshot.clone();
    let outcome = coordinator::dispatch::persist_local_command(&mut connection, &input).unwrap();
    let bundle = crate::repositories::conversation_repository::get_bundle(
        &connection,
        &input.conversation_id,
    )
    .unwrap()
    .unwrap();
    assert_eq!(outcome.runtime, "ans-native-local-command");
    assert_eq!(bundle.runs.len(), 1);
    assert_eq!(outcome.run.status, "completed");
    assert_eq!(outcome.run.model_snapshot["providerId"], "ans-local");
    assert_eq!(bundle.conversation.default_model, Some(selected_model));
    let settings = bundle
        .tool_events
        .iter()
        .find(|event| event.tool_name == "task.configure_word_target")
        .unwrap();
    assert_eq!(settings.status, "succeeded");
    assert_eq!(
        settings.arguments_summary["wordRange"],
        json!({"target":3200,"minimum":2560,"maximum":3680})
    );
    assert_eq!(settings.result.as_ref().unwrap()["modelCalled"], false);
    assert!(bundle.artifacts.is_empty());
    assert_eq!(bundle.turns.len(), 2);
    for value in ["3200", "2560", "3680"] {
        assert!(bundle.turns[1].content.contains(value));
    }
    let requests: i64 = connection
        .query_row("SELECT COUNT(*) FROM ai_request_reservations", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(requests, 0);
}

#[test]
fn native_word_setting_fails_closed_if_its_fact_does_not_commit() {
    let (mut connection, input) = native_word_setting_fixture();
    connection
        .execute_batch(
            "CREATE TEMP TRIGGER reject_word_setting_fact
         BEFORE INSERT ON tool_call_events
         WHEN NEW.tool_name='task.configure_word_target'
         BEGIN SELECT RAISE(ABORT, 'isolated word-setting failure'); END;",
        )
        .unwrap();
    assert!(coordinator::dispatch::persist_local_command(&mut connection, &input).is_err());
    let bundle = crate::repositories::conversation_repository::get_bundle(
        &connection,
        &input.conversation_id,
    )
    .unwrap()
    .unwrap();
    assert_eq!(bundle.runs.len(), 1);
    assert_eq!(bundle.runs[0].status, "failed");
    assert!(bundle.runs[0].error.is_some());
    assert_eq!(bundle.conversation.status, "failed");
    assert_eq!(bundle.turns.len(), 1);
    assert!(bundle.artifacts.is_empty());
    assert!(bundle
        .tool_events
        .iter()
        .all(|event| event.status == "succeeded"));
}

fn native_word_setting_fixture() -> (rusqlite::Connection, StartTaskTurnInput) {
    let mut input = api_input(
        "openai_compatible",
        "fixture-model",
        "http://127.0.0.1:8080",
    );
    input.goal = "本任务目标字数设为3200字".into();
    input.chapter_word_range = None;
    input.unified_runtime = Some(
        serde_json::from_value(json!({
            "version": 1,
            "localCommand": {
                "kind": "task_word_target",
                "targetWordCount": 3200,
                "wordRange": { "target": 3200, "minimum": 2560, "maximum": 3680 }
            }
        }))
        .unwrap(),
    );
    let connection = chapter_length_connection(&input);
    input.execution = Some(execution::RootExecution::new(&connection, &input).unwrap());
    (connection, input)
}
