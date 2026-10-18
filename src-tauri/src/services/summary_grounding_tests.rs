use super::*;
use crate::repositories::large_text_repository;
use crate::services::summary_grounding_source;
use rusqlite::{params, Connection};

#[test]
fn summary_grounding_contract_fixtures_match_frontend_cases() {
    let fixtures: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/chapter-summary-grounding.json"
    ))
    .unwrap();
    for fixture in fixtures.as_array().unwrap() {
        let issues = validate(
            fixture["source"].as_str().unwrap(),
            &fixture["payload"],
            fixture["required"].as_bool().unwrap(),
        );
        for (severity, key) in [("error", "errors"), ("warning", "warnings")] {
            let mut actual = issues
                .iter()
                .filter(|issue| issue.severity == severity)
                .map(|issue| issue.code)
                .collect::<Vec<_>>();
            let mut expected = fixture[key]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| item.as_str().unwrap())
                .collect::<Vec<_>>();
            actual.sort();
            expected.sort();
            assert_eq!(actual, expected, "{}: {severity}", fixture["name"]);
        }
    }
}

#[test]
fn summary_grounding_full_source_locations_do_not_truncate_after_preview() {
    let source = format!("{}最后一页仍未找到。", "开篇😀\n".repeat(5000));
    let payload = json!({"summary":"【待查】最后一页仍未找到。","grounding":{"version":1,"claims":[{"path":"/summary","status":"unresolved","quotes":["最后一页仍未找到。"]}]}});
    let issues = validate(&source, &payload, true);
    assert!(!issues.iter().any(|issue| issue.severity == "error"));
    let receipt = issues.last().unwrap().details_json.as_ref().unwrap();
    assert_eq!(
        receipt.pointer("/claims/0/sources/0/line"),
        Some(&json!(5001))
    );
    assert_eq!(
        receipt.pointer("/claims/0/sources/0/startChar"),
        Some(&json!(20000))
    );
}

#[test]
fn summary_grounding_revalidates_current_adoption_scope_and_full_content_hash() {
    let connection = crate::services::ai_task_service::tests::connection().unwrap();
    let source = "唐棠收到一封旧信。";
    connection.execute_batch("INSERT INTO novels(id,title,created_at,updated_at) VALUES('n','隔离总结测试','now','now');
        INSERT INTO chapters(id,novel_id,title,order_index,status,adopted_draft_id,created_at,updated_at) VALUES('c','n','第一章',1,'adopted','d','now','now');").unwrap();
    let hash = large_text_repository::sha256(source);
    connection.execute("INSERT INTO chapter_drafts(id,novel_id,chapter_id,title,content,source,version_no,word_count,is_adopted,created_at,updated_at,content_hash) VALUES('d','n','c','稿',?1,'manual',1,10,1,'now','now',?2)", params![source, hash]).unwrap();
    let payload = json!({"summary":"唐棠收到旧信。","grounding":{"version":1,"claims":[{"path":"/summary","status":"confirmed","quotes":[source]}]}});
    let valid = summary_grounding_source::validate_candidate(
        &connection,
        "n",
        Some("c"),
        Some("d"),
        Some(&hash),
        &payload,
        true,
    )
    .unwrap();
    assert!(!valid.iter().any(|issue| issue.severity == "error"));
    assert!(summary_grounding_source::validate_candidate(
        &connection,
        "wrong-novel",
        Some("c"),
        Some("d"),
        Some(&hash),
        &payload,
        true
    )
    .is_err());
    assert!(summary_grounding_source::validate_candidate(
        &connection,
        "n",
        Some("c"),
        Some("d"),
        Some("wrong-hash"),
        &payload,
        true
    )
    .is_err());
    connection
        .execute("UPDATE chapters SET adopted_draft_id=NULL WHERE id='c'", [])
        .unwrap();
    assert!(summary_grounding_source::validate_candidate(
        &connection,
        "n",
        Some("c"),
        Some("d"),
        Some(&hash),
        &payload,
        true
    )
    .is_err());
}

#[test]
fn summary_grounding_reads_verified_chunks_instead_of_the_draft_preview() {
    let db = crate::services::ai_task_service::tests::connection().unwrap();
    let source = format!("{}最后一页仍未找到。", "开篇😀\n".repeat(5000));
    let hash = large_text_repository::sha256(&source);
    db.execute_batch("INSERT INTO novels(id,title,created_at,updated_at) VALUES('n','隔离总结测试','now','now');
        INSERT INTO chapters(id,novel_id,title,order_index,status,adopted_draft_id,created_at,updated_at) VALUES('c','n','第一章',1,'adopted','d','now','now');").unwrap();
    large_text_repository::insert_document(&db, "full-source", "d", None, &source, &hash, "now")
        .unwrap();
    db.execute("INSERT INTO chapter_drafts(id,novel_id,chapter_id,title,content,source,version_no,word_count,is_adopted,created_at,updated_at,content_hash,large_text_ref_id) VALUES('d','n','c','稿','仅供展示的预览','manual',1,20000,1,'now','now',?1,'full-source')", [&hash]).unwrap();
    let payload = json!({"summary":"【待查】最后一页仍未找到。","grounding":{"version":1,"claims":[{"path":"/summary","status":"unresolved","quotes":["最后一页仍未找到。"]}]}});
    let issues = summary_grounding_source::validate_candidate(
        &db,
        "n",
        Some("c"),
        Some("d"),
        Some(&hash),
        &payload,
        true,
    )
    .unwrap();
    assert!(!issues.iter().any(|issue| issue.severity == "error"));
    assert_eq!(
        issues
            .last()
            .unwrap()
            .details_json
            .as_ref()
            .unwrap()
            .pointer("/claims/0/sources/0/line"),
        Some(&json!(5001))
    );
    db.execute("UPDATE large_text_chunks SET content='损坏内容' WHERE document_id='full-source' AND chunk_index=0", []).unwrap();
    assert!(summary_grounding_source::validate_candidate(
        &db,
        "n",
        Some("c"),
        Some("d"),
        Some(&hash),
        &payload,
        true
    )
    .is_err());
}

fn receipt_fixture() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch("CREATE TABLE tool_call_events(event_id TEXT PRIMARY KEY,run_id TEXT,tool_name TEXT,status TEXT,sequence INTEGER,result_json TEXT);
        CREATE TABLE large_text_documents(id TEXT PRIMARY KEY,target_type TEXT,target_id TEXT,field_name TEXT,
            title TEXT,total_chars INTEGER,total_bytes INTEGER,chunk_count INTEGER,content_sha256 TEXT,
            storage_type TEXT,status TEXT,created_at TEXT,updated_at TEXT);
        CREATE TABLE large_text_chunks(document_id TEXT,chunk_index INTEGER,content TEXT,char_count INTEGER,
            byte_count INTEGER,chunk_sha256 TEXT,created_at TEXT);").unwrap();
    db
}

fn insert_outline_receipt(db: &Connection, event: &str, sequence: i64, body: &Value) {
    let raw = body.to_string();
    let hash = large_text_repository::sha256(&raw);
    let document = format!("result-{event}");
    large_text_repository::insert_document_for_target(
        db,
        &document,
        "tool_event",
        event,
        "result",
        None,
        &raw,
        &hash,
        "now",
    )
    .unwrap();
    let receipt = json!({"largeTextRefId":document,"contentHash":hash});
    db.execute(
        "INSERT INTO tool_call_events VALUES(?1,'run','chapter.read_outline','succeeded',?2,?3)",
        params![event, sequence, receipt.to_string()],
    )
    .unwrap();
}

#[test]
fn summary_grounding_runtime_receipt_requires_latest_complete_source_and_verified_reference() {
    let source = "唐棠收到一封旧信。";
    let hash = large_text_repository::sha256(source);
    let complete = json!({"ok":true,"data":{"currentAdoptedDraft":{"draftId":"d","contentHash":hash,"content":source,"truncated":false}}});
    for fault in [
        "none",
        "missing",
        "truncated",
        "stale",
        "wrong-draft",
        "preview",
        "reference",
    ] {
        let db = receipt_fixture();
        if fault != "missing" {
            insert_outline_receipt(&db, "first", 1, &complete);
            let mut latest = complete.clone();
            match fault {
                "truncated" => latest["data"]["currentAdoptedDraft"]["truncated"] = json!(true),
                "stale" => latest["data"]["currentAdoptedDraft"]["contentHash"] = json!("stale"),
                "wrong-draft" => {
                    latest["data"]["currentAdoptedDraft"]["draftId"] = json!("other-draft")
                }
                "preview" => latest["data"]["currentAdoptedDraft"]["content"] = json!("唐棠收到"),
                _ => (),
            }
            insert_outline_receipt(&db, "latest", 2, &latest);
            if fault == "reference" {
                db.execute("UPDATE large_text_documents SET target_id='unrelated-event' WHERE id='result-latest'", []).unwrap();
            }
        }
        let result =
            summary_grounding_source::validate_runtime_receipt(&db, "run", Some("d"), Some(&hash));
        if fault == "none" {
            result.unwrap();
        } else {
            assert!(
                result.is_err(),
                "{fault} must reject the latest receipt instead of using the older one"
            );
        }
    }
}
