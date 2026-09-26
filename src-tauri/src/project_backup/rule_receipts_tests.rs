use super::super::*;
use crate::repositories::large_text_repository as large_text;
use crate::services::structured_artifact_apply_service::{
    apply_structured_artifact, preview_structured_rule_change_with, ApplyStructuredArtifactInput,
};
use crate::services::world_rule_governance::RuleChangeAuthorization;
use crate::services::{artifact_service, conversation_service};
use serde_json::json;

const NOW: &str = "2026-09-10T00:00:00Z";

fn connection() -> Connection {
    let mut conn = Connection::open_in_memory().expect("isolated database");
    conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    crate::db::create_tables(&mut conn).expect("real schema including decisions");
    conn
}

fn applied_rule(conn: &mut Connection, novel: &str) -> (ApplyStructuredArtifactInput, String) {
    conn.execute(
        "INSERT INTO novels(id,title,created_at,updated_at) VALUES (?1,?1,?2,?2)",
        params![novel, NOW],
    )
    .unwrap();
    let conversation_id = format!("conversation-{novel}");
    conversation_service::create(
        conn,
        conversation_service::CreateConversationInput {
            conversation_id: conversation_id.clone(),
            novel_id: novel.to_string(),
            title: "规则采用备份".to_string(),
            default_model: None,
            created_at: NOW.to_string(),
        },
    )
    .unwrap();
    let card = conversation_service::publish_structured_candidate(
        conn,
        conversation_service::PublishStructuredCandidateInput {
            conversation_id: conversation_id.clone(),
            novel_id: novel.to_string(),
            chapter_id: None,
            artifact_type: "setting_candidates".to_string(),
            derivation_type: None,
            title: "规则候选".to_string(),
            summary: "只生成候选".to_string(),
            structured_payload_json: json!({"settings":[{
                "name":format!("规则-{novel}"),"targetType":"rule_system","content":"力量须支付代价"
            }]}),
            created_at: NOW.to_string(),
        },
    )
    .unwrap();
    let artifact_id = card.artifact_id.clone().unwrap();
    let bundle = artifact_service::get_artifact_bundle(conn, &artifact_id).unwrap();
    let mut input = ApplyStructuredArtifactInput {
        decision_id: format!("decision-{novel}"),
        artifact_id,
        artifact_hash: bundle.artifact.content_hash,
        card_id: card.card_id,
        conversation_id,
        idempotency_key: format!("apply-{novel}"),
        actor: "user".to_string(),
        target_type: "asset".to_string(),
        target_id: novel.to_string(),
        novel_id: novel.to_string(),
        chapter_id: None,
        base_revision: None,
        expected_rule_set_fingerprint: None,
        change_authorization: None,
        created_at: NOW.to_string(),
    };
    let preview = preview_structured_rule_change_with(conn, &input)
        .unwrap()
        .unwrap();
    input.expected_rule_set_fingerprint = Some(preview.rule_set_fingerprint);
    input.change_authorization = Some(RuleChangeAuthorization {
        preview_hash: preview.preview_hash,
        intent: "confirm_change".to_string(),
        notes: Some("作者明确确认😀".repeat(4096)),
    });
    let decision = apply_structured_artifact(conn, input.clone()).expect("real governed apply");
    assert!(decision.conflict_code.is_none());
    (
        input,
        decision.apply_transaction_id.expect("persisted receipt"),
    )
}

#[test]
fn project_backup_rule_receipt_is_not_an_orphan_and_same_project_replay_still_succeeds() {
    let mut conn = connection();
    let (input, receipt_id) = applied_rule(&mut conn, "novel-source");
    let original = large_text::read_verified_document(&conn, &receipt_id).unwrap();
    let artifact_refs: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM result_artifacts WHERE raw_content_ref_id=?1
         OR display_content_ref_id=?1 OR structured_payload_ref_id=?1",
            params![receipt_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        artifact_refs, 0,
        "only the decision references this document"
    );
    large_text::delete_if_unreferenced(&conn, &receipt_id).expect("protect decision receipt");
    assert_eq!(
        large_text::read_verified_document(&conn, &receipt_id)
            .unwrap()
            .content,
        original.content
    );
    let decision = apply_structured_artifact(&mut conn, input).expect("same project replay");
    assert_eq!(
        decision.apply_transaction_id.as_deref(),
        Some(receipt_id.as_str())
    );

    large_text::insert_document_for_target(
        &conn,
        "apply-rule-orphan",
        "artifact",
        &decision.artifact_id,
        "world_rule_apply_receipt",
        None,
        "orphan",
        &large_text::sha256("orphan"),
        NOW,
    )
    .unwrap();
    large_text::delete_if_unreferenced(&conn, "apply-rule-orphan").unwrap();
    let remaining: i64 = conn
        .query_row(
            "SELECT (SELECT COUNT(*) FROM large_text_documents WHERE id='apply-rule-orphan') +
                (SELECT COUNT(*) FROM large_text_chunks WHERE document_id='apply-rule-orphan')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        remaining, 0,
        "genuinely unreferenced document and chunks are removed"
    );
}

#[test]
fn project_backup_round_trips_rule_receipts_without_reauthorizing_new_project() {
    let mut conn = connection();
    let (input, receipt_id) = applied_rule(&mut conn, "novel-source");
    let (other, other_receipt) = applied_rule(&mut conn, "novel-other");
    let original = large_text::read_verified_document(&conn, &receipt_id).unwrap();
    let backup = export_project_backup_in_conn(&conn, &input.novel_id).unwrap();
    assert_eq!(backup.schema_version, 11);
    assert_eq!(backup.tables["artifact_decisions"].len(), 1);
    assert_eq!(backup.tables["rule_systems"].len(), 1);
    assert_eq!(
        backup.tables["artifact_decisions"][0]["apply_transaction_id"],
        receipt_id
    );
    assert!(backup.tables[LARGE_TEXT_DOCUMENTS]
        .iter()
        .any(|row| row["id"] == receipt_id));
    assert!(
        backup.tables[LARGE_TEXT_CHUNKS]
            .iter()
            .filter(|row| row["document_id"] == receipt_id)
            .count()
            > 1
    );
    assert!(!backup.tables[LARGE_TEXT_DOCUMENTS]
        .iter()
        .any(|row| row["id"] == other_receipt));
    assert!(!backup.tables[LARGE_TEXT_CHUNKS]
        .iter()
        .any(|row| row["document_id"] == other_receipt));
    assert!(!backup.tables["artifact_decisions"]
        .iter()
        .any(|row| row["artifact_id"] == other.artifact_id));

    // Real API always imports a new project, even when the source is still in this database.
    let restored =
        restore_project_backup_in_conn(&mut conn, &backup).expect("copy alongside original");
    let new_receipt = &restored.id_map[&receipt_id];
    assert_ne!(new_receipt, &receipt_id);
    assert!(new_receipt.starts_with("apply-rule-"));
    assert_ne!(restored.id_map[&input.decision_id], input.decision_id);
    large_text::validate_document_target(
        &conn,
        new_receipt,
        "artifact",
        &restored.id_map[&input.artifact_id],
        "world_rule_apply_receipt",
    )
    .unwrap();
    let restored_reference: String = conn
        .query_row(
            "SELECT apply_transaction_id FROM artifact_decisions WHERE decision_id=?1
         AND artifact_id=?2 AND card_id=?3 AND conversation_id=?4 AND target_id=?5",
            params![
                restored.id_map[&input.decision_id],
                restored.id_map[&input.artifact_id],
                restored.id_map[&input.card_id],
                restored.id_map[&input.conversation_id],
                restored.novel_id
            ],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(&restored_reference, new_receipt);
    large_text::delete_if_unreferenced(&conn, new_receipt).unwrap();
    let proof = large_text::read_verified_document(&conn, new_receipt).unwrap();
    assert_eq!(
        proof.content, original.content,
        "author scope, notes and hashes remain frozen"
    );
    assert_eq!(proof.content_hash, original.content_hash);
    let original_body: JsonValue = serde_json::from_str(&proof.content).unwrap();
    assert_eq!(original_body["novelId"], input.novel_id);
    let rule_id = backup.tables["rule_systems"][0]["id"].as_str().unwrap();
    let restored_rule: String = conn
        .query_row(
            "SELECT content FROM rule_systems WHERE id=?1 AND novel_id=?2",
            params![restored.id_map[rule_id], restored.novel_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(restored_rule, "力量须支付代价");

    let mut replay = input.clone();
    replay.decision_id = restored.id_map[&input.decision_id].clone();
    replay.artifact_id = restored.id_map[&input.artifact_id].clone();
    replay.card_id = restored.id_map[&input.card_id].clone();
    replay.conversation_id = restored.id_map[&input.conversation_id].clone();
    replay.novel_id = restored.novel_id.clone();
    replay.target_id = restored.novel_id.clone();
    let before: i64 = conn
        .query_row("SELECT total_changes()", [], |row| row.get(0))
        .unwrap();
    let error =
        apply_structured_artifact(&mut conn, replay).expect_err("old consent is not new consent");
    assert_eq!(error.code, "STRUCTURED_APPLY_IDEMPOTENCY_CONFLICT");
    let after: i64 = conn
        .query_row("SELECT total_changes()", [], |row| row.get(0))
        .unwrap();
    assert_eq!(before, after, "failed replay makes no writes");
    assert_eq!(
        apply_structured_artifact(&mut conn, input.clone())
            .unwrap()
            .apply_transaction_id,
        Some(receipt_id.clone())
    );
    assert_eq!(
        apply_structured_artifact(&mut conn, other)
            .unwrap()
            .apply_transaction_id,
        Some(other_receipt)
    );

    // Frozen historical evidence must survive a second backup/import as well.
    let next = export_project_backup_in_conn(&conn, &restored.novel_id).unwrap();
    let mut empty = connection();
    let copied = restore_project_backup_in_conn(&mut empty, &next).unwrap();
    let next_receipt = &copied.id_map[new_receipt];
    assert_eq!(
        large_text::read_verified_document(&empty, next_receipt)
            .unwrap()
            .content,
        original.content
    );
    let foreign_keys: i64 = empty
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(foreign_keys, 0);
}

#[test]
fn project_backup_rejects_missing_tampered_or_foreign_rule_receipts_before_writes() {
    let mut source = connection();
    let (input, receipt_id) = applied_rule(&mut source, "novel-source");
    let backup = export_project_backup_in_conn(&source, &input.novel_id).unwrap();
    let mut target = connection();
    applied_rule(&mut target, "novel-kept");
    let before: i64 = target
        .query_row("SELECT total_changes()", [], |row| row.get(0))
        .unwrap();
    for fault in [
        "document",
        "chunk",
        "tampered",
        "hash",
        "chunk_hash",
        "target",
        "decision_ref",
        "card",
        "scope",
    ] {
        let mut damaged = backup.clone();
        match fault {
            "document" => {
                damaged
                    .tables
                    .get_mut(LARGE_TEXT_DOCUMENTS)
                    .unwrap()
                    .retain(|row| row["id"] != receipt_id);
                damaged
                    .tables
                    .get_mut(LARGE_TEXT_CHUNKS)
                    .unwrap()
                    .retain(|row| row["document_id"] != receipt_id);
            }
            "chunk" => damaged
                .tables
                .get_mut(LARGE_TEXT_CHUNKS)
                .unwrap()
                .retain(|row| row["document_id"] != receipt_id || row["chunk_index"] != 0),
            "tampered" | "chunk_hash" => {
                let row = damaged
                    .tables
                    .get_mut(LARGE_TEXT_CHUNKS)
                    .unwrap()
                    .iter_mut()
                    .find(|row| row["document_id"] == receipt_id)
                    .unwrap();
                if fault == "tampered" {
                    let body = row["content"].as_str().unwrap().replace("作者", "伪造");
                    row.insert("content".to_string(), json!(body));
                } else {
                    row.insert("chunk_sha256".to_string(), JsonValue::Null);
                }
            }
            "hash" | "target" => {
                let row = damaged
                    .tables
                    .get_mut(LARGE_TEXT_DOCUMENTS)
                    .unwrap()
                    .iter_mut()
                    .find(|row| row["id"] == receipt_id)
                    .unwrap();
                let (column, value) = if fault == "hash" {
                    ("content_sha256", JsonValue::Null)
                } else {
                    ("target_id", json!("foreign-artifact"))
                };
                row.insert(column.to_string(), value);
            }
            "decision_ref" => {
                damaged.tables.get_mut("artifact_decisions").unwrap()[0].insert(
                    "apply_transaction_id".to_string(),
                    json!("apply-rule-foreign"),
                );
            }
            "card" => {
                damaged
                    .tables
                    .get_mut("conversation_artifact_cards")
                    .unwrap()[0]
                    .insert("artifact_id".to_string(), json!("foreign-artifact"));
            }
            "scope" => {
                damaged.tables.get_mut("result_artifacts").unwrap()[0]
                    .insert("source_novel_id".to_string(), json!("novel-kept"));
            }
            _ => unreachable!(),
        }
        assert!(
            restore_project_backup_in_conn(&mut target, &damaged).is_err(),
            "fault {fault}"
        );
        let after: i64 = target
            .query_row("SELECT total_changes()", [], |row| row.get(0))
            .unwrap();
        assert_eq!(before, after, "fault {fault} must fail in preflight");
        assert!(target.is_autocommit());
    }

    // Also fail export when the source reference exists but its ownership/document is lost.
    source
        .execute(
            "UPDATE large_text_documents SET target_id='foreign-artifact' WHERE id=?1",
            params![receipt_id],
        )
        .unwrap();
    assert!(export_project_backup_in_conn(&source, &input.novel_id).is_err());
    source
        .execute(
            "DELETE FROM large_text_chunks WHERE document_id=?1",
            params![receipt_id],
        )
        .unwrap();
    source
        .execute(
            "DELETE FROM large_text_documents WHERE id=?1",
            params![receipt_id],
        )
        .unwrap();
    assert!(export_project_backup_in_conn(&source, &input.novel_id).is_err());
}

#[test]
fn project_backup_preserves_legacy_opaque_apply_ids_without_requiring_a_receipt() {
    let mut conn = connection();
    let (input, receipt_id) = applied_rule(&mut conn, "novel-legacy");
    let mut backup = export_project_backup_in_conn(&conn, &input.novel_id).unwrap();
    backup.tables.get_mut("artifact_decisions").unwrap()[0].insert(
        "apply_transaction_id".to_string(),
        json!("apply-legacy-opaque"),
    );
    backup
        .tables
        .get_mut(LARGE_TEXT_DOCUMENTS)
        .unwrap()
        .retain(|row| row["id"] != receipt_id);
    backup
        .tables
        .get_mut(LARGE_TEXT_CHUNKS)
        .unwrap()
        .retain(|row| row["document_id"] != receipt_id);
    let restored = restore_project_backup_in_conn(&mut conn, &backup).unwrap();
    let id: String = conn
        .query_row(
            "SELECT apply_transaction_id FROM artifact_decisions WHERE decision_id=?1",
            params![restored.id_map[&input.decision_id]],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(id, "apply-legacy-opaque");
}
