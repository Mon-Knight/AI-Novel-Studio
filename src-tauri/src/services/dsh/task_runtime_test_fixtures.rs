//! Complete persisted read receipts for legacy protocol/length tests (no Gateway or model).
use super::*;

fn section(projection: &Value, count: usize, max_bytes: usize) -> Value {
    let encoded = projection.to_string();
    json!({"status":"complete","requiredCount":count,"includedCount":count,
        "projectionHash":large_text_repository::sha256(&encoded),"requiredBytes":encoded.len(),
        "projectedBytes":encoded.len(),"maxBytes":max_bytes,"semanticValidation":"not_checked"})
}

pub(super) fn empty_read_payload(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
    tool: &str,
) -> Option<Value> {
    if tool == "novel.read_context" {
        let snapshot =
            crate::services::world_rule_governance::rule_set_snapshot(connection, &input.novel_id)
                .expect("authoritative empty rule snapshot");
        assert!(
            snapshot.sources.is_empty(),
            "fixture must not conceal real rules"
        );
        let mut coverage = section(&json!([]), 0, 131_072);
        coverage["sourceIds"] = json!([]);
        coverage["ruleSetFingerprint"] = json!(snapshot.fingerprint);
        Some(
            json!({"ok":true,"data":{"worldSettings":[],"ruleSystems":[],
            "contextCoverage":{"schemaVersion":"writing_context_coverage_v1","novelId":input.novel_id,
                "worldSettings":coverage,"ruleSystems":coverage}}}),
        )
    } else if tool == "chapter.read_outline" {
        Some(json!({"ok":true,"data":{"engineeringState":null,
            "contextCoverage":{"schemaVersion":"writing_context_coverage_v1","novelId":input.novel_id,
                "chapterId":input.chapter_id,"engineeringState":section(&Value::Null, 0, 65_536)}}}))
    } else {
        None
    }
}

pub(super) fn persist_read_receipt(
    connection: &rusqlite::Connection,
    event_id: &str,
    payload: &Value,
) {
    let content = payload.to_string();
    let hash = large_text_repository::sha256(&content);
    let document_id = format!("coverage-{event_id}-{}", uuid::Uuid::new_v4());
    large_text_repository::insert_document_for_target(
        connection,
        &document_id,
        "tool_event",
        event_id,
        "result",
        None,
        &content,
        &hash,
        &now(),
    )
    .expect("persist complete read material");
    connection
        .execute(
            "UPDATE tool_call_events SET result_json=?1 WHERE event_id=?2",
            rusqlite::params![
                json!({"largeTextRefId":document_id,"contentHash":hash,
            "contentChars":content.chars().count(),"isError":false})
                .to_string(),
                event_id
            ],
        )
        .expect("persist exact read receipt");
}

pub(super) fn seed_legacy_coverage(connection: &rusqlite::Connection, input: &StartTaskTurnInput) {
    // These tiny protocol fixtures intentionally lack business mutations and triggers.
    // Only the real read-validation schema is added; success is not fabricated by a bypass.
    connection.execute_batch("CREATE TABLE novels(id TEXT PRIMARY KEY, deleted_at TEXT);
        CREATE TABLE world_settings(id TEXT, novel_id TEXT, title TEXT, content TEXT, structured_json TEXT,
            is_active INTEGER, created_at TEXT, updated_at TEXT);
        CREATE TABLE rule_systems(id TEXT, novel_id TEXT, title TEXT, category TEXT, content TEXT,
            forbidden_rules TEXT, structured_json TEXT, is_active INTEGER, created_at TEXT, updated_at TEXT);
        CREATE TABLE large_text_documents(id TEXT PRIMARY KEY,target_type TEXT,target_id TEXT,field_name TEXT,
            title TEXT,total_chars INTEGER,total_bytes INTEGER,chunk_count INTEGER,content_sha256 TEXT,
            storage_type TEXT,status TEXT,created_at TEXT,updated_at TEXT);
        CREATE TABLE large_text_chunks(document_id TEXT,chunk_index INTEGER,content TEXT,char_count INTEGER,
            byte_count INTEGER,chunk_sha256 TEXT,created_at TEXT);")
        .expect("complete read evidence fixture schema");
    connection
        .execute(
            "INSERT INTO novels(id) VALUES(?1)",
            rusqlite::params![input.novel_id],
        )
        .expect("scoped fixture novel");
    let mut statement = connection
        .prepare("SELECT event_id,tool_name FROM tool_call_events WHERE status='succeeded'")
        .expect("read fixture events");
    let events = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .expect("query fixture reads")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect fixture reads");
    for (event_id, tool) in events {
        if let Some(payload) = empty_read_payload(connection, input, &tool) {
            persist_read_receipt(connection, &event_id, &payload);
        }
    }
}
