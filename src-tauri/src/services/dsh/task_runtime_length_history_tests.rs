use super::*;

pub(super) fn source_read_payload(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
    tool: &str,
) -> Option<Value> {
    let sources = length_sources::projection::current(connection, input).unwrap();
    let mut payload = contract_fixtures::empty_read_payload(connection, input, tool)
        .unwrap_or(json!({"ok":true,"data":{}}));
    let keys: &[&str] = match tool {
        "novel.read_context" => &["novel", "chapters", "volumes"],
        "chapter.read_outline" => &[
            "chapter",
            "masterOutline",
            "volumeOutline",
            "outline",
            "engineeringState",
            "chapterRoles",
            "currentAdoptedDraft",
            "chapterEvents",
            "previousChapterSummaries",
            "targetChapterSummary",
        ],
        "get_character_states" => &["characters", "stateTrack"],
        _ => return None,
    };
    for key in keys {
        payload["data"][key] = sources[key].clone();
    }
    payload["data"]["protagonistSource"] = json!("none");
    payload["data"]["protagonists"] = json!([]);
    if tool == "chapter.read_outline" {
        let encoded = sources["engineeringState"].to_string();
        let count = u64::from(!sources["engineeringState"].is_null());
        payload["data"]["contextCoverage"]["engineeringState"] = json!({"status":"complete","requiredCount":count,"includedCount":count,
                "projectionHash":large_text_repository::sha256(&encoded),"requiredBytes":encoded.len(),"projectedBytes":encoded.len(),"maxBytes":65536,"semanticValidation":"not_checked"});
    }
    Some(payload)
}

fn failed_length_run(
    connection: &mut rusqlite::Connection,
    input: &StartTaskTurnInput,
    id: &str,
    words: usize,
    reads: bool,
    novel: Option<&str>,
) {
    chapter_length_run(connection, input, id, words, reads, 0, novel);
    retry::record_contract(connection, input, id).unwrap();
    let error = validate_chapter_candidate_length(input, &"字".repeat(words))
        .unwrap_err()
        .to_string();
    chapter_length_fail_run(connection, id, &error);
}

#[test]
fn length_history_explicit_retry_recovers_best_full_draft_after_database_reopen() {
    let mut input = chapter_write_input();
    input.chapter_word_range = Some(ChapterWordRangeInput {
        minimum: 3060,
        target: 3400,
        maximum: 3740,
    });
    let mut connection = chapter_length_connection(&input);
    for (id, words) in [("long", 4019), ("short", 2562), ("closest", 3051)] {
        failed_length_run(&mut connection, &input, id, words, true, None);
    }
    let path = std::env::temp_dir().join(format!(
        "ans-length-history-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    connection
        .execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()])
        .unwrap();
    drop(connection);
    let mut connection = rusqlite::Connection::open(&path).unwrap();
    input.retry_source_run_id = Some("closest".into());
    let mut recovery = ChapterLengthRecovery::new(&input);
    recovery.restore_history(&connection, &input).unwrap();
    let prompt = recovery.prompt(&input, 0, 3);
    assert!(prompt.contains("3051 字版本"));
    assert!(prompt.contains("4019字 → 2562字 → 3051字"));
    assert!(prompt.contains(&format!(
        "<length_revision_source>\n{}\n</length_revision_source>",
        "字".repeat(3051)
    )));
    assert!(prompt.contains("允许补充 9～689 字"));
    // Reading a historical draft consumes no new candidate budget and creates no formal result.
    assert_chapter_length_no_outputs(&connection);
    chapter_length_run(&mut connection, &input, "new-attempt", 3400, true, 0, None);
    recovery
        .record_history_notice(&mut connection, &input, "new-attempt")
        .unwrap();
    let notice:String=connection.query_row("SELECT content FROM conversation_turns WHERE role='assistant' ORDER BY sequence DESC LIMIT 1",[],|row|row.get(0)).unwrap();
    assert!(notice.contains("恢复最接近目标的完整失败稿（3051字）"));
    let generated = recovery
        .read_candidate(&connection, &input, "new-attempt")
        .unwrap()
        .unwrap();
    assert_eq!(generated.text.chars().count(), 3400);
    assert_chapter_length_no_outputs(&connection);
    drop(connection);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn length_history_refuses_missing_corrupt_foreign_or_stale_full_material_and_explains_it() {
    for case in [
        "missing-reads",
        "foreign-scope",
        "hash",
        "ownership",
        "missing-document",
    ] {
        let mut input = chapter_write_input();
        let mut connection = chapter_length_connection(&input);
        failed_length_run(
            &mut connection,
            &input,
            "old",
            3586,
            case != "missing-reads",
            (case == "foreign-scope").then_some("foreign"),
        );
        match case {
            "hash" => {
                connection.execute("UPDATE large_text_documents SET content_sha256='changed' WHERE id='old-candidate-result'",[]).unwrap();
            }
            "ownership" => {
                connection.execute("UPDATE large_text_documents SET target_id='another-event' WHERE id='old-candidate-result'",[]).unwrap();
            }
            "missing-document" => {
                connection
                    .execute(
                        "DELETE FROM large_text_documents WHERE id='old-candidate-result'",
                        [],
                    )
                    .unwrap();
            }
            _ => {}
        }
        input.retry_source_run_id = Some("old".into());
        let mut recovery = ChapterLengthRecovery::new(&input);
        recovery.restore_history(&connection, &input).unwrap();
        assert!(
            !recovery
                .prompt(&input, 0, 1)
                .contains("<length_revision_source>"),
            "{case}"
        );
        chapter_length_run(&mut connection, &input, "new", 3000, true, 0, None);
        recovery
            .record_history_notice(&mut connection, &input, "new")
            .unwrap();
        let notice:String=connection.query_row("SELECT content FROM conversation_turns WHERE role='assistant' ORDER BY sequence DESC LIMIT 1",[],|row|row.get(0)).unwrap();
        assert!(notice.contains("没有可复用的完整字数失败稿"), "{case}");
        assert_chapter_length_no_outputs(&connection);
    }
}

#[test]
fn length_history_never_borrows_other_model_range_turn_or_later_run() {
    for case in ["model", "range", "turn", "later"] {
        let mut input = chapter_write_input();
        let mut connection = chapter_length_connection(&input);
        failed_length_run(&mut connection, &input, "source", 3586, false, None);
        let mut other = input.clone();
        if case == "model" {
            other.model_snapshot["modelId"] = json!("other");
        }
        if case == "range" {
            other.chapter_word_range.as_mut().unwrap().maximum = 3451;
        }
        if case == "turn" {
            other.turn_id = "another-turn".into();
            conversation_service::append_turn(
                &mut connection,
                conversation_service::AppendTurnInput {
                    turn_id: other.turn_id.clone(),
                    conversation_id: input.conversation_id.clone(),
                    role: "user".into(),
                    content: input.goal.clone(),
                    created_at: now(),
                },
            )
            .unwrap();
        }
        failed_length_run(&mut connection, &other, "other", 3586, true, None);
        input.retry_source_run_id = Some(if case == "later" { "source" } else { "other" }.into());
        let mut recovery = ChapterLengthRecovery::new(&input);
        recovery.restore_history(&connection, &input).unwrap();
        assert!(
            !recovery
                .prompt(&input, 0, 2)
                .contains("<length_revision_source>"),
            "{case}"
        );
        assert_chapter_length_no_outputs(&connection);
    }
}

#[test]
#[ignore = "read-only recovery audit requires an explicit database under this repository's test-results"]
fn length_history_existing_isolated_failure_is_read_only_recoverable() {
    let path = std::path::PathBuf::from(
        std::env::var_os("ANS_LENGTH_HISTORY_AUDIT_DB").expect("isolated audit database"),
    );
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../test-results")
        .canonicalize()
        .unwrap();
    assert!(
        path.canonicalize().unwrap().starts_with(root),
        "audit database must be under test-results"
    );
    let connection =
        rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
    connection.execute_batch("PRAGMA query_only=ON;").unwrap();
    let source = std::env::var("ANS_LENGTH_HISTORY_AUDIT_RUN").expect("source failed Run");
    let (conversation,novel):(String,String)=connection.query_row("SELECT r.conversation_id,c.novel_id FROM task_runs r JOIN task_conversations c ON c.conversation_id=r.conversation_id WHERE r.run_id=?1",[&source],|row|Ok((row.get(0)?,row.get(1)?))).unwrap();
    let resolution =
        retry::resolve_connection(&connection, &conversation, &novel, &source).unwrap();
    let execution = resolution.execution.unwrap();
    let mut input = chapter_write_input();
    input.conversation_id = conversation;
    input.novel_id = novel;
    input.turn_id = resolution.turn_id;
    input.chapter_id = resolution.chapter_id;
    input.model_snapshot = resolution.model_snapshot;
    input.goal = execution.goal;
    input.task_kind = execution.task_kind;
    input.expected_tool = execution.expected_tool;
    input.expected_artifact_type = execution.expected_artifact_type;
    input.required_read_tools = execution.required_read_tools;
    input.chapter_word_range = execution.chapter_word_range;
    input.retry_source_run_id = Some(source);
    let mut recovery = ChapterLengthRecovery::new(&input);
    recovery.restore_history(&connection, &input).unwrap();
    let prompt = recovery.prompt(&input, 0, 1);
    let expected =
        std::env::var("ANS_LENGTH_HISTORY_AUDIT_EXPECT").unwrap_or_else(|_| "recovered".into());
    if expected == "discarded" {
        assert!(
            !prompt.contains("<length_revision_source>"),
            "stale historical draft must not be injected"
        );
        if let Ok(expected_reason) = std::env::var("ANS_LENGTH_HISTORY_AUDIT_REASON") {
            let (run,event):(String,String)=connection.query_row(
                "SELECT r.run_id,e.event_id FROM task_runs r JOIN tool_call_events e ON e.run_id=r.run_id
                 WHERE r.turn_id=?1 AND r.error LIKE 'DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED:%'
                   AND e.tool_name=?2 AND e.status='succeeded' ORDER BY r.created_at DESC,e.sequence DESC LIMIT 1",
                rusqlite::params![input.turn_id,input.expected_tool],|row|Ok((row.get(0)?,row.get(1)?)),
            ).unwrap();
            let reason = length_sources::validate(&connection, &input, &run, &event).unwrap_err();
            assert!(
                reason.contains(&expected_reason),
                "source rejection reason differs from audit expectation: {reason}"
            );
        }
        return;
    }
    assert_eq!(expected, "recovered", "unknown audit expectation");
    assert!(
        prompt.contains("<length_revision_source>"),
        "historical full draft could not be safely recovered"
    );
    if let Ok(expected) = std::env::var("ANS_LENGTH_HISTORY_AUDIT_WORDS") {
        assert!(
            prompt.contains(&format!("{expected} 字版本")),
            "recovered word count differs from expected audit metadata"
        );
    }
}

#[test]
fn length_history_source_changes_are_rejected_even_without_timestamp_changes() {
    for case in [
        "outline",
        "active-outline",
        "master-outline",
        "volume-outline",
        "engineering",
        "character",
        "character-profile",
        "protagonist-profile",
        "state",
        "role",
        "summary",
        "chapter-position",
    ] {
        let mut input = chapter_write_input();
        let mut connection = chapter_length_connection(&input);
        connection.execute("INSERT INTO volumes(id,novel_id,title,created_at,updated_at) VALUES('volume',?1,'本卷',?2,?2)",rusqlite::params![input.novel_id,now()]).unwrap();
        connection
            .execute("UPDATE chapters SET volume_id='volume'", [])
            .unwrap();
        connection.execute("INSERT INTO master_outlines(id,project_id,title,content,is_active,created_at,updated_at) VALUES('master',?1,'总纲','原故事方向',1,?2,?2)",rusqlite::params![input.novel_id,now()]).unwrap();
        connection.execute("INSERT INTO volume_outlines(id,project_id,volume_id,title,content,is_active,created_at,updated_at) VALUES('volume-outline',?1,'volume','卷纲','本卷原剧情',1,?2,?2)",rusqlite::params![input.novel_id,now()]).unwrap();
        connection.execute("INSERT INTO chapter_outlines(id,project_id,chapter_id,title,content,is_active,created_at,updated_at) VALUES('outline',?1,?2,'章纲','本章原剧情',1,?3,?3)",rusqlite::params![input.novel_id,input.chapter_id,now()]).unwrap();
        connection.execute("INSERT INTO characters(id,novel_id,name,role_type,is_active,created_at,updated_at) VALUES('person',?1,'人物','supporting',1,?2,?2)",rusqlite::params![input.novel_id,now()]).unwrap();
        connection.execute("INSERT INTO chapter_characters(id,novel_id,chapter_id,character_id,role_in_chapter,must_appear,created_at,updated_at) VALUES('role',?1,?2,'person','supporting',1,?3,?3)",rusqlite::params![input.novel_id,input.chapter_id,now()]).unwrap();
        connection.execute("INSERT INTO character_states(id,novel_id,character_id,state_summary,created_at) VALUES('state',?1,'person','尚未知情',?2)",rusqlite::params![input.novel_id,now()]).unwrap();
        seed_adopted_source(&connection, &input, false);
        connection.execute("INSERT INTO chapter_summaries(id,novel_id,chapter_id,adopted_draft_id,summary,created_at,updated_at) VALUES('summary',?1,?2,'source-draft','尚待查证',?3,?3)",rusqlite::params![input.novel_id,input.chapter_id,now()]).unwrap();
        connection.execute("INSERT INTO chapter_engineering_states(id,novel_id,chapter_id,chapter_card_json,scene_plan_json,generation_constraints_json,quality_rules_json,draft_version,active_version,status,created_at,updated_at) VALUES('engineering',?1,?2,'{}','[]','{}','{}',1,1,'active',?3,?3)",rusqlite::params![input.novel_id,input.chapter_id,now()]).unwrap();
        failed_length_run(&mut connection, &input, "old", 3586, true, None);
        input.retry_source_run_id = Some("old".into());
        let mut unchanged = ChapterLengthRecovery::new(&input);
        unchanged.restore_history(&connection, &input).unwrap();
        assert!(
            unchanged
                .prompt(&input, 0, 3)
                .contains("<length_revision_source>"),
            "baseline must be reusable: {case}"
        );
        let sql = match case {
            "outline" => "UPDATE chapters SET outline='新的章节情节'",
            "active-outline" => "UPDATE chapter_outlines SET content='采用章纲已调整'",
            "master-outline" => "UPDATE master_outlines SET content='总纲方向已调整'",
            "volume-outline" => "UPDATE volume_outlines SET content='卷纲事件已调整'",
            "engineering" => {
                "UPDATE chapter_engineering_states SET chapter_card_json='{\"goal\":\"changed\"}'"
            }
            "character" => "UPDATE characters SET personality='谨慎'",
            "character-profile" => "UPDATE characters SET behavior_limits='不得进入禁区'",
            "protagonist-profile" => {
                "UPDATE novels SET protagonists_json='[{\"name\":\"新主角\"}]'"
            }
            "state" => "UPDATE character_states SET state_summary='已经知情'",
            "role" => "UPDATE chapter_characters SET note='本章不可出现'",
            "summary" => "UPDATE chapter_summaries SET summary='已查明'",
            _ => "UPDATE chapters SET order_index=9",
        };
        connection.execute(sql, []).unwrap();
        input.retry_source_run_id = Some("old".into());
        let mut recovery = ChapterLengthRecovery::new(&input);
        recovery.restore_history(&connection, &input).unwrap();
        assert!(
            !recovery
                .prompt(&input, 0, 3)
                .contains("<length_revision_source>"),
            "{case}"
        );
        chapter_length_run(&mut connection, &input, "new", 3000, true, 0, None);
        recovery
            .record_history_notice(&mut connection, &input, "new")
            .unwrap();
        let notice:String=connection.query_row("SELECT content FROM conversation_turns WHERE role='assistant' ORDER BY sequence DESC LIMIT 1",[],|r|r.get(0)).unwrap();
        assert!(
            notice.contains("未复用原因：") && notice.contains("本轮重新读取的正式材料"),
            "{case}"
        );
        let counts:(i64,i64)=connection.query_row("SELECT (SELECT COUNT(*) FROM chapter_drafts),(SELECT COUNT(*) FROM result_artifacts)",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(counts, (1, 0));
    }
}

#[test]
fn length_history_ignores_runtime_updates_and_accepts_complete_legacy_receipts() {
    let input = chapter_write_input();
    let mut connection = chapter_length_connection(&input);
    chapter_length_run(&mut connection, &input, "old", 3586, true, 0, None);
    connection
        .execute(
            "UPDATE chapters SET status='editing',updated_at='2099-01-01T00:00:00Z'",
            [],
        )
        .unwrap();
    connection
        .execute("UPDATE novels SET updated_at='2099-01-01T00:00:00Z'", [])
        .unwrap();
    length_sources::validate(&connection, &input, "old", "old-candidate").unwrap();
    assert_chapter_length_no_outputs(&connection);
}

fn seed_adopted_source(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
    previous: bool,
) {
    let chapter = if previous {
        "previous"
    } else {
        input.chapter_id.as_deref().unwrap()
    };
    if previous {
        connection.execute("INSERT INTO chapters(id,novel_id,title,order_index,status,word_count,created_at,updated_at) VALUES(?1,?2,'前章',0,'adopted',0,?3,?3)",rusqlite::params![chapter,input.novel_id,now()]).unwrap();
    }
    let body = "正式采用的来源正文";
    connection.execute("INSERT INTO chapter_drafts(id,novel_id,chapter_id,content,content_hash,source,version_no,word_count,is_adopted,created_at,updated_at) VALUES('source-draft',?1,?2,?3,?4,'manual',1,10,1,?5,?5)",rusqlite::params![input.novel_id,chapter,body,large_text_repository::sha256(body),now()]).unwrap();
    connection
        .execute(
            "UPDATE chapters SET adopted_draft_id='source-draft' WHERE id=?1",
            [chapter],
        )
        .unwrap();
}

#[test]
fn length_history_rechecks_current_and_previous_adopted_full_body_hashes() {
    for previous in [false, true] {
        let mut input = chapter_write_input();
        let mut connection = chapter_length_connection(&input);
        seed_adopted_source(&connection, &input, previous);
        failed_length_run(&mut connection, &input, "old", 3586, true, None);
        input.retry_source_run_id = Some("old".into());
        let mut unchanged = ChapterLengthRecovery::new(&input);
        unchanged.restore_history(&connection, &input).unwrap();
        assert!(unchanged
            .prompt(&input, 0, 3)
            .contains("<length_revision_source>"));
        // Even an internally coherent altered body with the same draft identity and timestamp
        // must not inherit the old length-repair text.
        let changed = "正式来源中的情节已经改变";
        connection
            .execute(
                "UPDATE chapter_drafts SET content=?1,content_hash=?2 WHERE id='source-draft'",
                rusqlite::params![changed, large_text_repository::sha256(changed)],
            )
            .unwrap();
        let mut stale = ChapterLengthRecovery::new(&input);
        stale.restore_history(&connection, &input).unwrap();
        assert!(
            !stale
                .prompt(&input, 0, 3)
                .contains("<length_revision_source>"),
            "previous={previous}"
        );
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM chapter_drafts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
