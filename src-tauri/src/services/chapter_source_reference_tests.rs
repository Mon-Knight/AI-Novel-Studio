use super::*;
use crate::domain::world::{SaveWorldSettingInput, WorldRuleChangeAuthorizationInput};
use crate::repositories::large_text_repository::sha256;
use crate::services::{world_rule_governance, world_setting_service};

fn fixture() -> (Connection, String) {
    let mut conn = Connection::open_in_memory().unwrap();
    crate::db::create_tables(&mut conn).unwrap();
    conn.execute_batch("INSERT INTO novels(id,title,created_at,updated_at) VALUES('n','源设定测试','now','now');
        INSERT INTO chapters(id,novel_id,title,order_index,status,adopted_draft_id,created_at,updated_at) VALUES('c','n','第一章',1,'adopted','d','now','now');
        INSERT INTO chapter_drafts(id,novel_id,chapter_id,content,source,version_no,word_count,is_adopted,created_at,updated_at) VALUES('d','n','c','不得喷水或揭裱物证。','manual',1,9,1,'now','now');").unwrap();
    let reference = format!("{PREFIX}c:d:{}", sha256("不得喷水或揭裱物证。"));
    (conn, reference)
}

#[test]
fn chapter_source_reference_requires_exact_current_scope_and_hash() {
    let (conn, reference) = fixture();
    validate_change_source(&conn, "n", None, None, Some(&reference)).unwrap();
    assert!(validate_change_source(&conn, "other", None, None, Some(&reference)).is_err());
    assert!(validate_reference(&conn, "n", &reference.replace(":c:", ":other:")).is_err());
    assert!(validate_reference(&conn, "n", &reference.replace(":d:", ":other:")).is_err());
    assert!(validate_reference(&conn, "n", &format!("{PREFIX}c:d:{}", "0".repeat(64))).is_err());
    assert!(validate_reference(&conn, "n", &format!("{PREFIX}c:d:bad")).is_err());
    conn.execute("UPDATE chapters SET adopted_draft_id=NULL WHERE id='c'", [])
        .unwrap();
    assert!(validate_reference(&conn, "n", &reference).is_err());
}

#[test]
fn chapter_source_reference_preserves_historical_metadata_but_checks_current_confirmation() {
    let (conn, reference) = fixture();
    let metadata = serde_json::json!({"provenance":{"sourceRefs":[reference]}}).to_string();
    validate_change_source(&conn, "n", Some(&metadata), None, None).unwrap();
    conn.execute("UPDATE chapters SET adopted_draft_id=NULL WHERE id='c'", [])
        .unwrap();
    validate_change_source(&conn, "n", Some(&metadata), Some(&metadata), None).unwrap();
    assert!(validate_change_source(&conn, "n", Some(&metadata), None, None).is_err());
    assert!(validate_change_source(
        &conn,
        "n",
        Some(&metadata),
        Some(&metadata),
        Some(&reference)
    )
    .is_err());
}

#[test]
fn chapter_source_reference_rejects_unadopted_deleted_and_unreadable_sources() {
    for mutation in [
        "UPDATE chapter_drafts SET is_adopted=0 WHERE id='d'",
        "UPDATE chapters SET deleted_at='deleted' WHERE id='c'",
        "UPDATE chapter_drafts SET content_hash='invalid' WHERE id='d'",
        "UPDATE chapter_drafts SET large_text_ref_id='missing-full-text' WHERE id='d'",
        "UPDATE chapter_drafts SET content='' WHERE id='d'",
    ] {
        let (conn, reference) = fixture();
        conn.execute(mutation, []).unwrap();
        assert!(
            validate_reference(&conn, "n", &reference)
                .unwrap_err()
                .contains("CHAPTER_SOURCE_CHANGED"),
            "{mutation}"
        );
    }
}

#[test]
fn chapter_source_reference_is_revalidated_inside_setting_save_transaction() {
    for change_source in [false, true] {
        let (conn, reference) = fixture();
        let change = world_rule_governance::RuleChange {
            operation: None,
            target_type: "world_setting".into(),
            target_id: None,
            title: "物证边界".into(),
            content: "只拍照，不喷水。".into(),
            category: None,
            forbidden_rules: None,
            structured_json: None,
            is_active: true,
        };
        let preview =
            world_rule_governance::preview_rule_change(&conn, "n", &[change.clone()]).unwrap();
        if change_source {
            conn.execute("UPDATE chapters SET adopted_draft_id=NULL WHERE id='c'", [])
                .unwrap();
        }
        let result = world_setting_service::save_world_setting(
            &conn,
            None,
            SaveWorldSettingInput {
                novel_id: "n".into(),
                title: change.title,
                content: change.content,
                is_active: true,
                structured_json: None,
                expected_updated_at: None,
                expected_rule_set_fingerprint: Some(preview.rule_set_fingerprint),
                change_authorization: Some(WorldRuleChangeAuthorizationInput {
                    preview_hash: preview.preview_hash,
                    intent: "confirm_change".into(),
                    notes: Some(reference),
                }),
            },
        );
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM world_settings", [], |row| row.get(0))
            .unwrap();
        if change_source {
            assert!(result.unwrap_err().contains("CHAPTER_SOURCE_CHANGED"));
            assert_eq!(count, 0);
        } else {
            result.unwrap();
            assert_eq!(count, 1);
        }
    }
}
