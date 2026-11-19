use super::super::{export_project_backup_in_conn, restore_project_backup_in_conn};
use rusqlite::{params, Connection};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};

const TS: &str = "2026-08-21T00:00:00Z";
const SOURCE_NOVEL: &str = "novel-src";
const OTHER_NOVEL: &str = "novel-other";
const GOVERNED_REQUEST: &str = "governed-dsh-request-9f3a";
const ALIAS_ATTEMPT: &str = "attempt-alias";

fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn open_db() -> Connection {
    let mut conn = Connection::open_in_memory().expect("open memory database");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("enable foreign keys");
    crate::db::create_tables(&mut conn).expect("create schema");
    conn
}

fn execute(conn: &Connection, sql: &str, values: impl rusqlite::Params) {
    conn.execute(sql, values)
        .unwrap_or_else(|error| panic!("{sql}\n{error}"));
}

fn insert_document(conn: &Connection, id: &str, target_id: &str, field: &str, content: &str) {
    let hash = digest(content);
    let chars = content.chars().count() as i64;
    let bytes = content.len() as i64;
    execute(
        conn,
        "INSERT INTO large_text_documents
            (id,target_type,target_id,field_name,total_chars,total_bytes,chunk_count,
             content_sha256,status,created_at,updated_at)
         VALUES (?1,'ai_snapshot',?2,?3,?4,?5,1,?6,'ready',?7,?7)",
        params![&id, &target_id, &field, &chars, &bytes, &hash, &TS],
    );
    execute(
        conn,
        "INSERT INTO large_text_chunks
            (document_id,chunk_index,content,char_count,byte_count,chunk_sha256,created_at)
         VALUES (?1,0,?2,?3,?4,?5,?6)",
        params![&id, &content, &chars, &bytes, &hash, &TS],
    );
}

fn insert_artifact_document(
    conn: &Connection,
    id: &str,
    artifact_id: &str,
    content: &str,
) -> (String, i64) {
    let hash = digest(content);
    let chars = content.chars().count() as i64;
    let bytes = content.len() as i64;
    execute(
        conn,
        "INSERT INTO large_text_documents
            (id,target_type,target_id,field_name,total_chars,total_bytes,chunk_count,
             content_sha256,status,created_at,updated_at)
         VALUES (?1,'result_artifact',?2,'raw_content',?3,?4,1,?5,'ready',?6,?6)",
        params![&id, &artifact_id, &chars, &bytes, &hash, &TS],
    );
    execute(
        conn,
        "INSERT INTO large_text_chunks
            (document_id,chunk_index,content,char_count,byte_count,chunk_sha256,created_at)
         VALUES (?1,0,?2,?3,?4,?5,?6)",
        params![&id, &content, &chars, &bytes, &hash, &TS],
    );
    (hash, chars)
}

fn seed_task(
    conn: &Connection,
    suffix: &str,
    attempt_id: &str,
    provider_request_id: &str,
) -> (String, String) {
    let task_id = format!("task-{suffix}");
    let artifact_id = format!("artifact-{suffix}");
    let input_id = format!("snapshot-input-{suffix}");
    let context_id = format!("snapshot-context-{suffix}");
    let constraint_id = format!("snapshot-constraint-{suffix}");
    let input_body = format!("input-{suffix}");
    let compiled = format!("compiled-{suffix}");
    let template = format!("template-{suffix}");
    let body = format!("候选正文 {suffix}");
    let template_hash = digest(&template);
    insert_document(
        conn,
        &format!("document-input-{suffix}"),
        &input_id,
        "input_body",
        &input_body,
    );
    insert_document(
        conn,
        &format!("document-context-{suffix}"),
        &context_id,
        "compiled_context",
        &compiled,
    );
    insert_document(
        conn,
        &format!("document-constraint-{suffix}"),
        &constraint_id,
        "prompt_template",
        &template,
    );
    let (content_hash, content_length) =
        insert_artifact_document(conn, &format!("document-raw-{suffix}"), &artifact_id, &body);
    let operation_id = format!("operation-{suffix}");
    let request_hash = digest(&format!("request-{suffix}"));
    execute(
        conn,
        "INSERT INTO ai_tasks
            (task_id,task_type,novel_id,chapter_id,scope_type,status,input_snapshot_id,context_snapshot_id,
             constraint_snapshot_id,current_attempt_id,trace_id,operation_id,request_hash_version,
             request_hash,expected_artifact_type,expected_artifact_schema_version,created_at,updated_at)
         VALUES (?1,'chapter_draft',?2,'chapter-src','chapter','validating',?3,?4,?5,?6,?1,?7,1,?8,
                 'chapter_text',1,?9,?9)",
        params![
            &task_id,
            &SOURCE_NOVEL,
            &input_id,
            &context_id,
            &constraint_id,
            &attempt_id,
            &operation_id,
            &request_hash,
            &TS,
        ],
    );
    execute(
        conn,
        "INSERT INTO ai_input_snapshots
            (snapshot_id,task_id,schema_version,input_type,payload_json,body_ref_id,content_hash,created_at)
         VALUES (?1,?2,1,'compiled_provider_messages_v1','{}',?3,?4,?5)",
        params![
            &input_id,
            &task_id,
            &format!("document-input-{suffix}"),
            &digest(&input_body),
            &TS,
        ],
    );
    execute(
        conn,
        "INSERT INTO ai_context_snapshots
            (snapshot_id,task_id,schema_version,source_manifest_json,compiled_context_ref_id,
             budget_json,compiler_version,content_hash,created_at)
         VALUES (?1,?2,1,'[]',?3,'{}','context_compiler_v1',?4,?5)",
        params![
            &context_id,
            &task_id,
            &format!("document-context-{suffix}"),
            &digest(&compiled),
            &TS,
        ],
    );
    execute(
        conn,
        "INSERT INTO ai_constraint_snapshots
            (snapshot_id,task_id,schema_version,payload_json,prompt_template_id,prompt_template_version,
             prompt_template_hash,prompt_template_ref_id,provider_options_json,content_hash,created_at)
         VALUES (?1,?2,1,'{}','restore/prompt','1',?3,?4,'{}',?5,?6)",
        params![
            &constraint_id,
            &task_id,
            &template_hash,
            &format!("document-constraint-{suffix}"),
            &digest(&format!("constraint-{suffix}")),
            &TS,
        ],
    );
    let metadata = format!(r#"{{"providerRequestId":"{provider_request_id}"}}"#);
    execute(
        conn,
        "INSERT INTO ai_task_attempts
            (attempt_id,task_id,attempt_number,provider_id,model_id,provider_request_id,status,
             response_metadata_json,created_at,updated_at,finished_at)
         VALUES (?1,?2,1,'governed-provider','governed-model',?3,'succeeded',?4,?5,?5,?6)",
        params![
            &attempt_id,
            &task_id,
            &provider_request_id,
            &metadata,
            &TS,
            &"2026-08-21T00:00:01Z"
        ],
    );
    execute(
        conn,
        "INSERT INTO result_artifacts
            (artifact_id,task_id,attempt_id,source_input_snapshot_id,artifact_type,schema_version,
             raw_content_ref_id,source_novel_id,source_chapter_id,content_hash,content_length,
             processing_status,created_at)
         VALUES (?1,?2,?3,?4,'chapter_text',1,?5,?6,'chapter-src',?7,?8,'valid',?9)",
        params![
            &artifact_id,
            &task_id,
            &attempt_id,
            &input_id,
            &format!("document-raw-{suffix}"),
            &SOURCE_NOVEL,
            &content_hash,
            &content_length,
            &TS,
        ],
    );
    (artifact_id, content_hash)
}

fn seed_library() -> Connection {
    let mut conn = open_db();
    let tx = conn.transaction().expect("seed transaction");
    execute(
        &tx,
        "INSERT INTO novels (id,title,created_at,updated_at) VALUES (?1,'源作品',?2,?2)",
        params![&SOURCE_NOVEL, &TS],
    );
    execute(
        &tx,
        "INSERT INTO novels (id,title,created_at,updated_at) VALUES (?1,'另一作品',?2,?2)",
        params![&OTHER_NOVEL, &TS],
    );
    execute(
        &tx,
        "INSERT INTO setting_suggestions (id,novel_id,suggestion_type,item_json,status,created_at,updated_at)
         VALUES ('suggestion-other',?1,'location','{}','pending',?2,?2)",
        params![&OTHER_NOVEL, &TS],
    );
    execute(
        &tx,
        "INSERT INTO volumes (id,novel_id,title,created_at,updated_at) VALUES ('volume-src',?1,'卷一',?2,?2)",
        params![&SOURCE_NOVEL, &TS],
    );
    execute(
        &tx,
        "INSERT INTO chapters (id,novel_id,volume_id,title,created_at,updated_at)
         VALUES ('chapter-src',?1,'volume-src','第一章',?2,?2)",
        params![&SOURCE_NOVEL, &TS],
    );
    execute(
        &tx,
        "INSERT INTO chapter_drafts (id,novel_id,chapter_id,title,content,is_adopted,created_at,updated_at)
         VALUES ('draft-src',?1,'chapter-src','第一章','已采用正文',1,?2,?2)",
        params![&SOURCE_NOVEL, &TS],
    );
    execute(
        &tx,
        "UPDATE chapters SET adopted_draft_id='draft-src' WHERE id='chapter-src'",
        params![],
    );
    execute(
        &tx,
        "INSERT INTO chapters (id,novel_id,volume_id,title,created_at,updated_at)
         VALUES ('chapter-other',?1,'volume-src','第二章',?2,?2)",
        params![&SOURCE_NOVEL, &TS],
    );
    execute(
        &tx,
        "INSERT INTO chapter_drafts (id,novel_id,chapter_id,title,content,is_adopted,created_at,updated_at)
         VALUES ('draft-other',?1,'chapter-other','第二章','另一章草稿',0,?2,?2)",
        params![&SOURCE_NOVEL, &TS],
    );
    execute(
        &tx,
        "INSERT INTO task_conversations (conversation_id,novel_id,title,status,created_at,updated_at)
         VALUES ('conversation-src',?1,'审阅','idle',?2,?2)",
        params![&SOURCE_NOVEL, &TS],
    );
    let (artifact_id, content_hash) =
        seed_task(&tx, "governed", "attempt-governed", GOVERNED_REQUEST);
    seed_task(&tx, "alias", ALIAS_ATTEMPT, ALIAS_ATTEMPT);
    execute(
        &tx,
        "INSERT INTO conversation_artifact_cards
            (card_id,conversation_id,artifact_id,artifact_type,title,summary,content,status,created_at)
         VALUES ('card-src','conversation-src',?1,'chapter_text','候选','摘要','','candidate',?2)",
        params![&artifact_id, &TS],
    );
    for (decision_id, key, status, consumed_at, draft_id) in [
        (
            "authz-decision-consumed",
            "consumed",
            "consumed",
            Some(TS),
            Some("draft-src"),
        ),
        ("authz-decision-issued", "issued", "issued", None, None),
        ("authz-decision-expired", "expired", "expired", None, None),
    ] {
        execute(
            &tx,
            "INSERT INTO artifact_decisions
                (decision_id,artifact_id,artifact_hash,card_id,conversation_id,decision,idempotency_key,
                 actor,target_type,target_id,created_at)
             VALUES (?1,?2,?3,'card-src','conversation-src','confirm',?4,'user','chapter','chapter-src',?5)",
            params![&decision_id, &artifact_id, &content_hash, &key, &TS],
        );
        let authorization_id = decision_id.replace("authz-decision", "authz");
        execute(
            &tx,
            "INSERT INTO review_authorizations
                (authorization_id,artifact_id,chapter_id,novel_id,decision_id,status,issued_at,consumed_at,consumed_by_draft_id)
             VALUES (?1,?2,'chapter-src',?3,?4,?5,?6,?7,?8)",
            params![
                &authorization_id,
                &artifact_id,
                &SOURCE_NOVEL,
                &decision_id,
                &status,
                &TS,
                &consumed_at,
                &draft_id,
            ],
        );
    }
    tx.commit().expect("seed commit");
    conn
}

struct AuthorizationRow {
    id: String,
    novel_id: String,
    chapter_id: String,
    artifact_id: String,
    decision_id: String,
    status: String,
    consumed_by_draft_id: Option<String>,
}

fn authorizations(conn: &Connection) -> Vec<AuthorizationRow> {
    let mut statement = conn
        .prepare(
            "SELECT authorization_id,novel_id,chapter_id,artifact_id,decision_id,status,consumed_by_draft_id
             FROM review_authorizations ORDER BY authorization_id",
        )
        .expect("prepare authorizations");
    statement
        .query_map([], |row| {
            Ok(AuthorizationRow {
                id: row.get(0)?,
                novel_id: row.get(1)?,
                chapter_id: row.get(2)?,
                artifact_id: row.get(3)?,
                decision_id: row.get(4)?,
                status: row.get(5)?,
                consumed_by_draft_id: row.get(6)?,
            })
        })
        .expect("query authorizations")
        .collect::<Result<Vec<_>, _>>()
        .expect("authorization rows")
}

fn count(conn: &Connection, sql: &str, id: &str) -> i64 {
    conn.query_row(sql, params![id], |row| row.get(0))
        .unwrap_or_else(|error| panic!("{sql}\n{error}"))
}

fn assert_source_grants_unchanged(conn: &Connection) {
    let source: Vec<_> = authorizations(conn)
        .into_iter()
        .filter(|row| row.novel_id == SOURCE_NOVEL)
        .collect();
    assert_eq!(source.len(), 3);
    for row in &source {
        assert_eq!(row.chapter_id, "chapter-src");
        assert_eq!(row.artifact_id, "artifact-governed");
        assert!(row.decision_id.starts_with("authz-decision-"));
    }
    let consumed = source
        .iter()
        .find(|row| row.id == "authz-consumed")
        .expect("source consumed");
    assert_eq!(consumed.status, "consumed");
    assert_eq!(consumed.consumed_by_draft_id.as_deref(), Some("draft-src"));
    let issued = source
        .iter()
        .find(|row| row.id == "authz-issued")
        .expect("source issued");
    assert_eq!(issued.status, "issued");
    assert_eq!(issued.consumed_by_draft_id, None);
    let expired = source
        .iter()
        .find(|row| row.id == "authz-expired")
        .expect("source expired");
    assert_eq!(expired.status, "expired");
    assert_eq!(expired.consumed_by_draft_id, None);
    let adopted: String = conn
        .query_row(
            "SELECT adopted_draft_id FROM chapters WHERE id='chapter-src'",
            [],
            |row| row.get(0),
        )
        .expect("source adopted draft");
    assert_eq!(adopted, "draft-src");
}

fn assert_copy_does_not_widen(conn: &Connection, novel_id: &str) {
    let rows: Vec<_> = authorizations(conn)
        .into_iter()
        .filter(|row| row.novel_id == novel_id)
        .collect();
    assert_eq!(rows.len(), 3, "copy novel {novel_id} lost a review grant");
    assert!(rows.iter().all(|row| row.chapter_id != "chapter-src"));
    assert!(rows
        .iter()
        .all(|row| row.artifact_id != "artifact-governed"));
    assert!(rows
        .iter()
        .all(|row| !row.decision_id.starts_with("authz-decision-")));
    let consumed = rows
        .iter()
        .find(|row| row.status == "consumed")
        .expect("consumed copy");
    let issued = rows
        .iter()
        .find(|row| row.status == "issued")
        .expect("issued copy");
    let expired = rows
        .iter()
        .find(|row| row.status == "expired")
        .expect("expired copy");
    assert_eq!(issued.consumed_by_draft_id, None);
    assert_eq!(expired.consumed_by_draft_id, None);
    assert_ne!(consumed.id, "authz-consumed");
    assert_ne!(issued.id, "authz-issued");
    assert_ne!(expired.id, "authz-expired");
    let draft_id = consumed
        .consumed_by_draft_id
        .clone()
        .expect("consumed draft");
    let (draft_novel, adopted): (String, i64) = conn
        .query_row(
            "SELECT novel_id, is_adopted FROM chapter_drafts WHERE id=?1",
            params![draft_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("copied consumed draft");
    assert_eq!(draft_novel, novel_id);
    assert_eq!(adopted, 1);
    let chapter_draft: String = conn
        .query_row(
            "SELECT adopted_draft_id FROM chapters WHERE id=?1 AND novel_id=?2",
            params![consumed.chapter_id, novel_id],
            |row| row.get(0),
        )
        .expect("copied chapter");
    assert_eq!(chapter_draft, draft_id);
    let issued_novel: String = conn
        .query_row(
            "SELECT novel_id FROM chapters WHERE id=?1",
            params![issued.chapter_id],
            |row| row.get(0),
        )
        .expect("issued chapter");
    assert_eq!(issued_novel, novel_id);

    let mut statement = conn
        .prepare(
            "SELECT attempt_id, provider_request_id, response_metadata_json
             FROM ai_task_attempts WHERE task_id IN (SELECT task_id FROM ai_tasks WHERE novel_id=?1)
             ORDER BY attempt_id",
        )
        .expect("prepare attempts");
    let attempts: Vec<(String, String, String)> = statement
        .query_map(params![novel_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .expect("query attempts")
        .collect::<Result<Vec<_>, _>>()
        .expect("attempt rows");
    assert_eq!(attempts.len(), 2);
    for (attempt_id, request_id, metadata) in &attempts {
        let parsed: JsonValue = serde_json::from_str(metadata).expect("metadata json");
        assert_eq!(
            parsed["providerRequestId"].as_str(),
            Some(request_id.as_str())
        );
        assert_ne!(request_id, GOVERNED_REQUEST);
        if attempt_id == ALIAS_ATTEMPT || request_id == attempt_id {
            assert_eq!(request_id, attempt_id);
        }
    }
    assert_eq!(
        attempts
            .iter()
            .filter(|(attempt_id, request_id, _)| request_id == attempt_id)
            .count(),
        1
    );
    assert!(attempts
        .iter()
        .all(|(_, request_id, _)| request_id != GOVERNED_REQUEST));
}

#[test]
fn same_library_repeat_import_keeps_source_grant_and_remaps_consumed_receipt() {
    let mut conn = seed_library();
    let backup = export_project_backup_in_conn(&conn, SOURCE_NOVEL).expect("export source");
    let mut outside_draft = backup.clone();
    outside_draft
        .tables
        .get_mut("review_authorizations")
        .expect("authorizations")
        .iter_mut()
        .find(|row| row.get("status").and_then(JsonValue::as_str) == Some("consumed"))
        .expect("consumed row")
        .insert(
            "consumed_by_draft_id".to_string(),
            JsonValue::String("draft-outside".to_string()),
        );
    let blocked =
        restore_project_backup_in_conn(&mut conn, &outside_draft).expect_err("outside draft");
    assert!(blocked.contains("consumed_by_draft_id"), "{blocked}");
    let mut outside_artifact = backup.clone();
    outside_artifact
        .tables
        .get_mut("review_authorizations")
        .expect("authorizations")
        .iter_mut()
        .find(|row| row.get("status").and_then(JsonValue::as_str) == Some("issued"))
        .expect("issued row")
        .insert(
            "artifact_id".to_string(),
            JsonValue::String("artifact-outside".to_string()),
        );
    let blocked =
        restore_project_backup_in_conn(&mut conn, &outside_artifact).expect_err("outside artifact");
    assert!(blocked.contains("artifact_id"), "{blocked}");
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM novels WHERE id=?1",
            SOURCE_NOVEL
        ),
        1
    );
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM novels WHERE id=?1",
            OTHER_NOVEL
        ),
        1
    );
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT COUNT(*) FROM novels", [], |row| row.get(0))
            .expect("novel count"),
        2
    );

    let first = restore_project_backup_in_conn(&mut conn, &backup).expect("first import");
    let second = restore_project_backup_in_conn(&mut conn, &backup).expect("second import");
    assert_ne!(first.novel_id, SOURCE_NOVEL);
    assert_ne!(second.novel_id, SOURCE_NOVEL);
    assert_ne!(first.novel_id, second.novel_id);
    assert_ne!(first.novel_id, OTHER_NOVEL);
    assert_source_grants_unchanged(&conn);
    assert_copy_does_not_widen(&conn, &first.novel_id);
    assert_copy_does_not_widen(&conn, &second.novel_id);
    let first_consumed = first
        .id_map
        .get("authz-consumed")
        .expect("mapped authorization")
        .clone();
    let first_draft = first.id_map.get("draft-src").expect("mapped draft").clone();
    let (status, draft): (String, Option<String>) = conn
        .query_row(
            "SELECT status, consumed_by_draft_id FROM review_authorizations WHERE authorization_id=?1",
            params![first_consumed],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("first copy still present");
    assert_eq!(status, "consumed");
    assert_eq!(draft.as_deref(), Some(first_draft.as_str()));
    assert_ne!(second.id_map.get("authz-consumed"), Some(&first_consumed));
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM ai_task_attempts WHERE provider_request_id=?1",
            GOVERNED_REQUEST
        ),
        1
    );
    let duplicates: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM (
                SELECT 1 FROM ai_task_attempts
                WHERE provider_request_id IS NOT NULL
                GROUP BY provider_id, provider_request_id
                HAVING COUNT(*) > 1
             )",
            [],
            |row| row.get(0),
        )
        .expect("duplicate provider requests");
    assert_eq!(duplicates, 0);
    assert_eq!(
        count(
            &conn,
            "SELECT status='pending' FROM setting_suggestions WHERE id=?1",
            "suggestion-other"
        ),
        1
    );
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM review_authorizations WHERE novel_id=?1",
            OTHER_NOVEL
        ),
        0
    );
}

#[test]
fn empty_library_restore_keeps_consumed_receipt_on_the_remapped_draft() {
    let source = seed_library();
    let backup = export_project_backup_in_conn(&source, SOURCE_NOVEL).expect("export source");
    let mut empty = open_db();
    let restored =
        restore_project_backup_in_conn(&mut empty, &backup).expect("restore into empty library");
    assert_eq!(
        empty
            .query_row::<i64, _, _>("SELECT COUNT(*) FROM novels", [], |row| row.get(0))
            .expect("restored novel count"),
        1
    );
    assert_eq!(
        count(
            &empty,
            "SELECT COUNT(*) FROM novels WHERE id=?1",
            SOURCE_NOVEL
        ),
        0
    );
    assert_copy_does_not_widen(&empty, &restored.novel_id);
    let consumed = restored.id_map.get("authz-consumed").expect("consumed id");
    let draft = restored.id_map.get("draft-src").expect("draft id");
    let (status, consumed_draft): (String, String) = empty
        .query_row(
            "SELECT status, consumed_by_draft_id FROM review_authorizations WHERE authorization_id=?1",
            params![consumed],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("restored consumed authorization");
    assert_eq!(status, "consumed");
    assert_eq!(consumed_draft, *draft);
    assert_ne!(consumed_draft, "draft-src");
}

fn rewrite_cell(
    backup: &mut super::super::ProjectBackup,
    table: &str,
    key_column: &str,
    key: &str,
    column: &str,
    value: &str,
) {
    backup
        .tables
        .get_mut(table)
        .unwrap_or_else(|| panic!("missing {table}"))
        .iter_mut()
        .find(|row| row.get(key_column).and_then(JsonValue::as_str) == Some(key))
        .unwrap_or_else(|| panic!("missing {table}.{key}"))
        .insert(column.to_string(), JsonValue::String(value.to_string()));
}

#[test]
fn same_book_swapped_chapter_grant_is_rejected_before_write() {
    let mut conn = seed_library();
    let backup = export_project_backup_in_conn(&conn, SOURCE_NOVEL).expect("export source");
    let novels_before: i64 = conn
        .query_row("SELECT COUNT(*) FROM novels", [], |row| row.get(0))
        .expect("novel count");
    let mut issued_chapter = backup.clone();
    rewrite_cell(
        &mut issued_chapter,
        "review_authorizations",
        "authorization_id",
        "authz-issued",
        "chapter_id",
        "chapter-other",
    );
    let blocked =
        restore_project_backup_in_conn(&mut conn, &issued_chapter).expect_err("swapped chapter");
    assert!(blocked.contains("不一致"), "{blocked}");
    let mut consumed_draft = backup.clone();
    rewrite_cell(
        &mut consumed_draft,
        "review_authorizations",
        "authorization_id",
        "authz-consumed",
        "consumed_by_draft_id",
        "draft-other",
    );
    let blocked =
        restore_project_backup_in_conn(&mut conn, &consumed_draft).expect_err("swapped draft");
    assert!(blocked.contains("不属于授权章节"), "{blocked}");
    let mut decision_target = backup.clone();
    rewrite_cell(
        &mut decision_target,
        "artifact_decisions",
        "decision_id",
        "authz-decision-issued",
        "target_id",
        "chapter-other",
    );
    let blocked =
        restore_project_backup_in_conn(&mut conn, &decision_target).expect_err("swapped decision");
    assert!(blocked.contains("不一致"), "{blocked}");
    let mut issued_with_draft = backup.clone();
    rewrite_cell(
        &mut issued_with_draft,
        "review_authorizations",
        "authorization_id",
        "authz-issued",
        "consumed_by_draft_id",
        "draft-src",
    );
    let blocked = restore_project_backup_in_conn(&mut conn, &issued_with_draft)
        .expect_err("issued with draft");
    assert!(blocked.contains("不能带消费记录"), "{blocked}");
    let novels_after: i64 = conn
        .query_row("SELECT COUNT(*) FROM novels", [], |row| row.get(0))
        .expect("novel count");
    assert_eq!(novels_after, novels_before);
}
