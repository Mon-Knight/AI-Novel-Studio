use super::*;

#[test]
fn cleanup_missing_decision_schema_fails_closed_without_deleting_document() {
    let mut connection = Connection::open_in_memory().expect("isolated database");
    crate::db::create_tables(&mut connection).expect("real schema including artifact_decisions");
    let body = "作者规则采用回执";
    insert_document_for_target(
        &connection,
        "apply-rule-schema",
        "artifact",
        "artifact-schema",
        "world_rule_apply_receipt",
        None,
        body,
        &sha256(body),
        "2026-09-10T00:00:00Z",
    )
    .expect("receipt document");
    connection
        .execute_batch("DROP TABLE artifact_decisions;")
        .expect("inject incomplete schema");
    assert!(delete_if_unreferenced(&connection, "apply-rule-schema").is_err());
    assert_eq!(
        read_verified_document(&connection, "apply-rule-schema")
            .unwrap()
            .content,
        body
    );
}

#[test]
fn receipt_chunks_reject_missing_or_tampered_content() {
    let mut connection = Connection::open_in_memory().expect("isolated database");
    crate::db::create_tables(&mut connection).expect("real schema");
    let body = "作者确认😀".repeat(CHUNK_BYTES);
    for id in ["apply-rule-missing", "apply-rule-tampered"] {
        insert_document_for_target(
            &connection,
            id,
            "artifact",
            "artifact-test",
            "world_rule_apply_receipt",
            None,
            &body,
            &sha256(&body),
            "2026-09-10T00:00:00Z",
        )
        .expect("multi-chunk receipt");
        assert_eq!(
            read_verified_document(&connection, id).unwrap().content,
            body
        );
    }
    connection
        .execute(
            "DELETE FROM large_text_chunks WHERE document_id=?1 AND chunk_index=1",
            params!["apply-rule-missing"],
        )
        .unwrap();
    assert_eq!(
        read_verified_document(&connection, "apply-rule-missing")
            .unwrap_err()
            .code,
        codes::LARGE_TEXT_CHUNK_MISSING
    );
    connection
        .execute(
            "UPDATE large_text_chunks SET content='篡改' WHERE document_id=?1 AND chunk_index=0",
            params!["apply-rule-tampered"],
        )
        .unwrap();
    assert_eq!(
        read_verified_document(&connection, "apply-rule-tampered")
            .unwrap_err()
            .code,
        codes::LARGE_TEXT_HASH_MISMATCH
    );
}
