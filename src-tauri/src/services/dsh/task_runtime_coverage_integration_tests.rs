//! Persisted SQLite receipts through both required-read paths; pure coverage math is tested separately.
use super::*;

fn fixture() -> (rusqlite::Connection, StartTaskTurnInput) {
    let input = chapter_write_input();
    let connection = rusqlite::Connection::open_in_memory().expect("isolated coverage DB");
    connection.execute_batch(r#"CREATE TABLE tool_call_events (
        event_id TEXT PRIMARY KEY,run_id TEXT,sequence INTEGER,tool_name TEXT,status TEXT,
        arguments_summary_json TEXT,result_json TEXT);
        INSERT INTO tool_call_events(event_id,run_id,sequence,tool_name,status,arguments_summary_json) VALUES
        ('read-novel','coverage-run',0,'novel.read_context','succeeded','{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
        ('read-chapter','coverage-run',1,'chapter.read_outline','succeeded','{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
        ('read-characters','coverage-run',2,'get_character_states','succeeded','{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
        ('read-memory','coverage-run',3,'search_memory','succeeded','{"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1"}'),
        ('candidate','coverage-run',4,'generate_chapter','succeeded','{"dshTurn":1,"dshStep":2,"dshResponseId":"turn:1:step:2"}');"#)
        .expect("real required-read event rows");
    contract_fixtures::seed_legacy_coverage(&connection, &input);
    (connection, input)
}

#[test]
fn persisted_complete_coverage_accepts_candidate_and_legacy_read_only_paths() {
    let (connection, mut input) = fixture();
    assert_eq!(
        validate_turn_execution_contract(&connection, &input, "coverage-run")
            .expect("complete candidate gate"),
        Some("candidate".to_string())
    );
    connection
        .execute(
            "DELETE FROM tool_call_events WHERE event_id='candidate'",
            [],
        )
        .expect("read-only fixture");
    input.expected_tool = None;
    input.expected_artifact_type = None;
    input.chapter_word_range = None;
    input.task_kind = "read".to_string();
    input.conversation_id = PLUGIN_PROBE_CONVERSATION_ID.to_string();
    validate_turn_contract(&input).expect("legacy probe read contract");
    assert_eq!(
        validate_turn_execution_contract(&connection, &input, "coverage-run")
            .expect("complete legacy read gate"),
        None
    );
    connection
        .execute(
            "UPDATE tool_call_events SET result_json=NULL WHERE event_id='read-novel'",
            [],
        )
        .expect("missing read material");
    assert_eq!(
        validate_turn_execution_contract(&connection, &input, "coverage-run")
            .expect_err("succeeded is not complete evidence")
            .code,
        "DSH_CONTEXT_INCOMPLETE"
    );
}

#[test]
fn persisted_receipt_missing_wrong_target_hash_length_or_chunk_is_rejected() {
    for change in [
        "UPDATE tool_call_events SET result_json=NULL WHERE event_id='read-novel'",
        "UPDATE tool_call_events SET result_json=json_set(result_json,'$.contentHash','wrong') WHERE event_id='read-novel'",
        "UPDATE tool_call_events SET result_json=json_set(result_json,'$.contentChars',0) WHERE event_id='read-novel'",
        "UPDATE tool_call_events SET result_json=json_set(result_json,'$.isError',json('true')) WHERE event_id='read-novel'",
        "UPDATE large_text_documents SET target_id='another-event' WHERE target_id='read-novel'",
        "UPDATE large_text_chunks SET content='corrupted' WHERE document_id=(SELECT id FROM large_text_documents WHERE target_id='read-novel')",
        "DELETE FROM large_text_chunks WHERE document_id=(SELECT id FROM large_text_documents WHERE target_id='read-novel')",
    ] {
        let (connection, input) = fixture();
        connection.execute(change, []).expect("isolated corrupt receipt injection");
        let error = validate_turn_execution_contract(&connection, &input, "coverage-run")
            .expect_err("a successful tool status cannot replace verified complete coverage");
        assert!(allowlisted_protocol_recovery_error_code(&error.to_string()).is_none(), "coverage failures must not trigger protocol retries");
    }
}

#[test]
fn candidate_gate_rejects_changed_rules_and_incomplete_engineering_material() {
    let (connection, input) = fixture();
    connection
        .execute(
            "INSERT INTO rule_systems(id,novel_id,title,content,is_active,created_at,updated_at)
        VALUES('late-rule',?1,'后改规则','不能穿墙',1,'now','now')",
            rusqlite::params![input.novel_id],
        )
        .expect("rule changes after model read");
    assert_eq!(
        validate_turn_execution_contract(&connection, &input, "coverage-run")
            .expect_err("read-time rules are stale")
            .code,
        "DSH_CONTEXT_INCOMPLETE"
    );
    let (connection, input) = fixture();
    let mut payload =
        contract_fixtures::empty_read_payload(&connection, &input, "chapter.read_outline")
            .expect("chapter payload");
    payload["data"]["contextCoverage"]["engineeringState"]["status"] = json!("context_incomplete");
    contract_fixtures::persist_read_receipt(&connection, "read-chapter", &payload);
    assert_eq!(
        validate_turn_execution_contract(&connection, &input, "coverage-run")
            .expect_err("engineering coverage is mandatory")
            .code,
        "DSH_CONTEXT_INCOMPLETE"
    );
}
