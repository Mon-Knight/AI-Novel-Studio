// Included in chapter_context_bundle_service::tests; all data is an in-memory fixture.
#[test]
fn unsafe_summary_payload_cannot_write_context_state_or_memory() {
    for disabled in [false, true] {
        let mut conn = setup_test_db();
        let mut input = bundle_input();
        input.summary.enabled = Some(!disabled);
        input.summary.validation_status = Some("failed".to_string());
        input.summary.validation_result = Some(
            serde_json::json!({
                "passed":false,"score":76,"safeToContext":true,
                "problems":[{"type":"character_error","message":"角色不在原文"}]
            })
            .to_string(),
        );
        let error = save_chapter_context_bundle(&mut conn, &input).unwrap_err();
        assert_eq!(error, "SUMMARY_BLOCKING_VALIDATION_ERROR");
        for table in [
            "chapter_summaries",
            "context_records",
            "character_states",
            "memory_documents",
            "memory_chunks",
        ] {
            let count: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "unsafe summary must not write {table}");
        }
        input.summary.enabled = Some(false);
        input
            .context_records
            .iter_mut()
            .for_each(|record| record.is_active = Some(false));
        // A disabled summary cannot smuggle character-state updates through a sibling array.
        assert!(save_chapter_context_bundle(&mut conn, &input).is_err());
        input.character_states.clear();
        let saved = save_chapter_context_bundle(&mut conn, &input).unwrap();
        assert!(!saved.summary.enabled);
        assert!(active_memory_chunks(&conn, "chapter_summary", SUMMARY_ID).is_empty());
        assert!(active_memory_chunks(&conn, "context_record", CONTEXT_ID).is_empty());
    }
}
