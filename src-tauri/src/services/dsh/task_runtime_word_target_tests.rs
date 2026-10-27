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
