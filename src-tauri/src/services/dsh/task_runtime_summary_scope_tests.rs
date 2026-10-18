use super::super::summary_scope::{is_automatic_summary, resolve_session_scope, source_metadata};
use super::*;
use rusqlite::{params, Connection};

fn manual_fixture() -> (Connection, StartTaskTurnInput) {
    manual_fixture_with_fault("")
}

fn manual_fixture_with_fault(fault: &str) -> (Connection, StartTaskTurnInput) {
    let mut input = chapter_write_input();
    input.task_kind = "chapter_summary".to_string();
    input.expected_tool = Some("summarize_chapter".to_string());
    input.expected_artifact_type = Some("chapter_summary".to_string());
    input.chapter_host_gate = None;
    input.continuity_claim = None;
    input.goal = "总结本章，保留记录缺口的不确定性".to_string();
    let connection = chapter_length_connection(&input);
    let content = "正式采用正文。记录存在缺口，流转经过未知。";
    connection.execute(
        "INSERT INTO chapter_drafts
         (id,novel_id,chapter_id,content,source,version_no,word_count,is_adopted,content_hash,created_at,updated_at)
         VALUES ('manual-summary-draft',?1,?2,?3,'manual',1,22,?5,?4,'2026-10-15','2026-10-15')",
        params![&input.novel_id, &input.chapter_id,
            if fault == "hash" { "tampered" } else { content },
            crate::repositories::large_text_repository::sha256(content),
            if fault == "unadopted" { 0 } else { 1 }],
    ).unwrap();
    connection
        .execute(
            "UPDATE chapters SET adopted_draft_id=?2 WHERE id=?1",
            params![
                &input.chapter_id,
                if fault == "missing-base" {
                    None
                } else {
                    Some("manual-summary-draft")
                }
            ],
        )
        .unwrap();
    (connection, input)
}

#[test]
fn manual_summary_scopes_a_persisted_user_request_without_formal_writes() {
    let (connection, input) = manual_fixture();
    let scope = resolve_session_scope(&connection, &input).expect("manual summary candidate scope");
    assert_eq!(scope.novel_id, input.novel_id);
    assert_eq!(Some(scope.chapter_id.as_str()), input.chapter_id.as_deref());
    assert_eq!(scope.adopted_draft_id, "manual-summary-draft");
    assert_ne!(
        task_session_id(&input, "run-1", Some(&scope)),
        task_session_id(&input, "run-2", Some(&scope))
    );
    for table in [
        "review_authorizations",
        "result_artifacts",
        "chapter_summaries",
    ] {
        let count: i64 = connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0, "scope lookup must not write {table}");
    }
    assert!(!is_automatic_summary(&input));
    assert!(!is_automatic_protocol_recovery_candidate(
        &input,
        "DSH_REQUIRED_CONTEXT_READ_MISSING: search_memory"
    ));
}

#[test]
fn manual_summary_rejects_missing_authority_target_adoption_and_hash_drift() {
    for failure in [
        "turn",
        "conversation",
        "novel",
        "chapter",
        "role",
        "unadopted",
        "hash",
        "missing-base",
    ] {
        let (mut connection, mut input) = manual_fixture_with_fault(failure);
        match failure {
            "turn" => input.turn_id = "missing-turn".to_string(),
            "conversation" => input.conversation_id = "other-conversation".to_string(),
            "novel" => input.novel_id = "other-novel".to_string(),
            "chapter" => input.chapter_id = Some("other-chapter".to_string()),
            "role" => {
                input.turn_id = "assistant-turn".to_string();
                conversation_service::append_turn(
                    &mut connection,
                    conversation_service::AppendTurnInput {
                        turn_id: input.turn_id.clone(),
                        conversation_id: input.conversation_id.clone(),
                        role: "assistant".to_string(),
                        content: input.goal.clone(),
                        created_at: now(),
                    },
                )
                .unwrap();
            }
            "unadopted" | "hash" | "missing-base" => {}
            _ => unreachable!(),
        }
        assert!(
            resolve_session_scope(&connection, &input).is_err(),
            "reject {failure}"
        );
    }
}

#[test]
fn automatic_summary_still_requires_its_consumed_review_authorization() {
    let (connection, mut input) = manual_fixture();
    for turn in [
        "summary-generation-missing-authorization",
        "summary-generation-",
    ] {
        input.turn_id = turn.to_string();
        assert!(is_automatic_summary(&input));
        assert_eq!(
            resolve_session_scope(&connection, &input).unwrap_err(),
            "DSH_PROTOCOL_RECOVERY_SCOPE_INVALID"
        );
    }
}

#[test]
fn manual_summary_records_source_before_candidate_tools_or_provider_failure() {
    let (mut connection, input) = manual_fixture();
    conversation_service::create_run(
        &mut connection,
        CreateRunInput {
            run_id: "summary-before-tools".into(),
            conversation_id: input.conversation_id.clone(),
            turn_id: input.turn_id.clone(),
            model_snapshot: input.model_snapshot.clone(),
            worker_id: "summary-navigation".into(),
            chapter_id: input.chapter_id.clone(),
            created_at: now(),
        },
    )
    .unwrap();
    retry::record_contract(&mut connection, &input, "summary-before-tools").unwrap();
    let bundle = conversation_service::get(&connection, &input.conversation_id)
        .unwrap()
        .unwrap();
    assert_eq!(bundle.tool_events.len(), 1);
    let contract = &bundle.tool_events[0];
    assert_eq!(contract.tool_name, "dsh.execution_contract");
    assert_eq!(contract.status, "succeeded");
    let source = &contract.arguments_summary["summarySource"];
    assert_eq!(source["version"], 1);
    assert_eq!(source["novelId"], input.novel_id);
    assert_eq!(source["chapterId"], input.chapter_id.unwrap());
    assert_eq!(source["adoptedDraftId"], "manual-summary-draft");
    assert_eq!(
        source["contentHash"],
        large_text_repository::sha256("正式采用正文。记录存在缺口，流转经过未知。")
    );
    assert!(!source.to_string().contains("正式采用正文"));
    // Navigation uses the frozen source, not a later adoption pointer.
    connection
        .execute("UPDATE chapters SET adopted_draft_id=NULL", [])
        .unwrap();
    let after = conversation_service::get(&connection, &input.conversation_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        after.tool_events[0].arguments_summary["summarySource"],
        *source
    );
}

#[test]
fn summary_navigation_metadata_rejects_invalid_authority_or_adopted_content() {
    for failure in ["hash", "unadopted", "missing-base"] {
        let (connection, input) = manual_fixture_with_fault(failure);
        assert!(
            source_metadata(&connection, &input).is_err(),
            "reject {failure}"
        );
    }
    let (connection, mut input) = manual_fixture();
    input.turn_id = "foreign-turn".into();
    assert!(source_metadata(&connection, &input).is_err());
    input.task_kind = "chapter_write".into();
    assert_eq!(
        source_metadata(&connection, &input).unwrap(),
        serde_json::Value::Null
    );
}
