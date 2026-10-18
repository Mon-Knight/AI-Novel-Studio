//! Persisted creative dialogue receipts and history boundaries; no Provider or user DB.
use super::*;
use rusqlite::{params, Connection};

fn input() -> StartTaskTurnInput {
    serde_json::from_value(json!({
        "conversationId":"conversation", "novelId":"novel", "turnId":"current",
        "goal":"先交流再按已确认信息执行", "chapterId":"chapter-one",
        "taskKind":"creative_dialogue", "modelSnapshot":{"providerId":"fixture","modelId":"fixture"},
        "requestPolicy":{"maxRequestsPerMinute":12,"maxConcurrentRequests":2,
            "warningPercent":80,"timeoutSeconds":120}
    })).expect("native dialogue input")
}

// Only the columns this read boundary consumes; large-text documents use the real
// repository writer/reader, including complete chunks, metadata and hash checks.
fn fixture() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("CREATE TABLE novels(id TEXT PRIMARY KEY);
        INSERT INTO novels VALUES('novel'),('other-novel');
        CREATE TABLE chapters(id TEXT PRIMARY KEY,novel_id TEXT);
        INSERT INTO chapters VALUES('chapter-one','novel'),('chapter-two','novel'),('foreign-chapter','other-novel');
        CREATE TABLE task_runs(run_id TEXT PRIMARY KEY,conversation_id TEXT,turn_id TEXT);
        INSERT INTO task_runs VALUES('run','conversation','current'),('other-run','other-conversation','foreign-turn');
        CREATE TABLE tool_call_events(event_id TEXT PRIMARY KEY,run_id TEXT,tool_name TEXT,status TEXT,sequence INTEGER,result_json TEXT);
        CREATE TABLE conversation_turns(turn_id TEXT PRIMARY KEY,conversation_id TEXT,sequence INTEGER,role TEXT,content TEXT);
        INSERT INTO conversation_turns VALUES('current','conversation',100,'user','CURRENT_UNTRUSTED_GOAL');
        CREATE TABLE large_text_documents(id TEXT PRIMARY KEY,target_type TEXT,target_id TEXT,field_name TEXT,
            title TEXT,total_chars INTEGER,total_bytes INTEGER,chunk_count INTEGER,content_sha256 TEXT,
            storage_type TEXT,status TEXT,created_at TEXT,updated_at TEXT);
        CREATE TABLE large_text_chunks(document_id TEXT,chunk_index INTEGER,content TEXT,char_count INTEGER,
            byte_count INTEGER,chunk_sha256 TEXT,created_at TEXT);").unwrap();
    db
}

fn payload(action: &str, chapter: Option<&str>) -> Value {
    let mut data = json!({"action":action,"instruction":"已确认现实港口悬疑；从雨前工坊写起"});
    if let Some(chapter) = chapter {
        data["chapterId"] = json!(chapter);
    }
    json!({"ok":true,"workflowRequestOnly":true,"novelId":"novel","data":data})
}

fn receipt(db: &Connection, event: &str, run: &str, status: &str, content: &str) {
    let document = format!("{event}-result");
    let hash = large_text_repository::sha256(content);
    large_text_repository::insert_document_for_target(
        db,
        &document,
        "tool_event",
        event,
        "result",
        None,
        content,
        &hash,
        &now(),
    )
    .expect("real persisted complete tool result");
    let summary = json!({"largeTextRefId":document,"contentHash":hash,"contentChars":content.chars().count(),"isError":status!="succeeded"});
    db.execute("INSERT INTO tool_call_events VALUES(?1,?2,'creative.plan_action',?3,(SELECT COUNT(*)+1 FROM tool_call_events),?4)",params![event,run,status,summary.to_string()]).unwrap();
}

fn action(db: &Connection) -> Result<Option<PlannedAction>, String> {
    read_action(db, &input(), "run")
}

#[test]
fn creative_receipt_reads_verified_material_without_writing_assets() {
    let db = fixture();
    receipt(
        &db,
        "event",
        "run",
        "succeeded",
        &payload("generate_chapter", Some("chapter-two")).to_string(),
    );
    let changes: i64 = db
        .query_row("SELECT total_changes()", [], |row| row.get(0))
        .unwrap();
    let result = action(&db).unwrap().unwrap();
    assert_eq!(result.action, "generate_chapter");
    assert_eq!(
        result.chapter_id.as_deref(),
        Some("chapter-two"),
        "another chapter in the same novel may be selected"
    );
    assert_eq!(result.instruction, "已确认现实港口悬疑；从雨前工坊写起");
    assert_eq!(
        db.query_row("SELECT total_changes()", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        changes
    );
}

#[test]
fn creative_receipt_requires_exact_result_document_ownership() {
    for (target_type, target_id, field) in [
        ("tool_event", "foreign-event", "result"),
        ("draft", "event", "result"),
        ("tool_event", "event", "content"),
    ] {
        let db = fixture();
        receipt(
            &db,
            "event",
            "run",
            "succeeded",
            &payload("check_quality", Some("chapter-one")).to_string(),
        );
        db.execute("UPDATE large_text_documents SET target_type=?1,target_id=?2,field_name=?3 WHERE id='event-result'",params![target_type,target_id,field]).unwrap();
        assert!(
            action(&db).is_err(),
            "foreign document identity must never hand off: {target_type}/{target_id}/{field}"
        );
    }
}

#[test]
fn creative_receipt_missing_reference_hash_mismatch_or_corrupt_content_cannot_handoff() {
    for mutation in [
        "UPDATE tool_call_events SET result_json='{}'",
        "UPDATE tool_call_events SET result_json='{\"largeTextRefId\":\"missing\",\"contentHash\":\"wrong\"}'",
        "UPDATE tool_call_events SET result_json=json_set(result_json,'$.contentHash','wrong')",
        "UPDATE large_text_chunks SET content='changed without updating its hash'",
    ] {
        let db = fixture();
        receipt(&db,"event","run","succeeded",&payload("check_quality",Some("chapter-one")).to_string());
        db.execute_batch(mutation).unwrap();
        assert!(action(&db).is_err(),"invalid material must not become a workflow: {mutation}");
    }
    let db = fixture();
    receipt(&db, "event", "run", "succeeded", "{invalid-json");
    assert!(action(&db).is_err());
}

#[test]
fn creative_receipt_allows_one_success_after_failure_but_never_two_successes() {
    let db = fixture();
    receipt(
        &db,
        "failed",
        "run",
        "failed",
        &payload("generate_chapter", Some("chapter-one")).to_string(),
    );
    assert!(action(&db).unwrap().is_none());
    receipt(
        &db,
        "foreign",
        "other-run",
        "succeeded",
        &payload("check_quality", Some("chapter-one")).to_string(),
    );
    assert!(
        action(&db).unwrap().is_none(),
        "another run cannot start this workflow"
    );
    receipt(
        &db,
        "ok",
        "run",
        "succeeded",
        &payload("check_quality", Some("chapter-one")).to_string(),
    );
    assert_eq!(action(&db).unwrap().unwrap().action, "check_quality");
    receipt(
        &db,
        "duplicate",
        "run",
        "succeeded",
        &payload("check_quality", Some("chapter-one")).to_string(),
    );
    assert!(action(&db).unwrap_err().contains("每轮只能请求一项工作流"));
}

#[test]
fn creative_receipt_rejects_foreign_novel_chapter_and_illegal_actions() {
    let valid = payload("generate_chapter", Some("chapter-one"));
    let mut wrong_novel = valid.clone();
    wrong_novel["novelId"] = json!("other-novel");
    let mut unknown_field = valid.clone();
    unknown_field["data"]["overwrite"] = json!(true);
    let mut empty_instruction = valid.clone();
    empty_instruction["data"]["instruction"] = json!("  ");
    let mut error_envelope = valid.clone();
    error_envelope["ok"] = json!(false);
    let mut direct_write = valid.clone();
    direct_write["workflowRequestOnly"] = json!(false);
    for (index, body) in [
        wrong_novel,
        unknown_field,
        empty_instruction,
        error_envelope,
        direct_write,
        payload("adopt", Some("chapter-one")),
        payload("generate_chapter", None),
        payload("generate_chapter", Some("foreign-chapter")),
        payload("generate_chapter", Some("missing")),
    ]
    .iter()
    .enumerate()
    {
        let db = fixture();
        receipt(
            &db,
            &format!("event-{index}"),
            "run",
            "succeeded",
            &body.to_string(),
        );
        assert!(
            action(&db).is_err(),
            "illegal or foreign action must not be returned: {body}"
        );
    }
}

fn turn(db: &Connection, id: &str, conversation: &str, sequence: i64, role: &str, content: &str) {
    db.execute(
        "INSERT INTO conversation_turns VALUES(?1,?2,?3,?4,?5)",
        params![id, conversation, sequence, role, content],
    )
    .unwrap();
}
fn history_rows(db: &Connection) -> Vec<Value> {
    let text = history(db, &input()).unwrap();
    serde_json::from_str(text.lines().last().unwrap()).unwrap()
}

#[test]
fn creative_history_is_chronological_and_only_before_current_turn_in_current_conversation() {
    let db = fixture();
    turn(&db, "first", "conversation", 1, "user", "已确定现实悬疑");
    turn(
        &db,
        "second",
        "conversation",
        2,
        "assistant",
        "人物尚未确定",
    );
    turn(&db, "tool", "conversation", 3, "tool", "HIDDEN_TOOL_VALUE");
    turn(
        &db,
        "system",
        "conversation",
        4,
        "system",
        "HIDDEN_SYSTEM_VALUE",
    );
    turn(
        &db,
        "future",
        "conversation",
        101,
        "assistant",
        "FUTURE_REPLY",
    );
    turn(
        &db,
        "foreign",
        "foreign-conversation",
        1,
        "user",
        "OTHER_PRIVATE_NOVEL",
    );
    assert_eq!(
        history_rows(&db),
        vec![
            json!({"role":"user","content":"已确定现实悬疑"}),
            json!({"role":"assistant","content":"人物尚未确定"})
        ]
    );
    let mut wrong = input();
    wrong.turn_id = "foreign".into();
    let text = history(&db, &wrong).unwrap();
    assert_eq!(
        text.lines().last(),
        Some("[]"),
        "foreign turn id cannot provide a sequence boundary"
    );
}

#[test]
fn creative_history_retains_only_32_recent_messages_and_limits_unicode_content() {
    let db = fixture();
    for sequence in 1..=34 {
        turn(
            &db,
            &format!("h-{sequence}"),
            "conversation",
            sequence,
            "user",
            &format!("message-{sequence}"),
        );
    }
    let rows = history_rows(&db);
    assert_eq!(rows.len(), 32);
    assert_eq!(rows[0]["content"], "message-3");
    assert_eq!(rows[31]["content"], "message-34");
    let db = fixture();
    turn(
        &db,
        "oversized",
        "conversation",
        99,
        "user",
        &"字".repeat(24001),
    );
    assert!(
        history_rows(&db).is_empty(),
        "oversized CJK context must not exceed the character budget"
    );
}
