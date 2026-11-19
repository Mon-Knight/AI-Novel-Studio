// Included in chapter_summary_service::tests; all data is an in-memory fixture.
#[test]
fn unsafe_summary_save_and_manual_reenable_fail_without_memory_writes() {
    let conn = setup_test_db();
    let mut input = memory_backed_summary_input();
    input.validation_status = Some("failed".to_string());
    input.validation_result = Some(
        serde_json::json!({"passed":false,"score":76,"safeToContext":true,
        "problems":[{"type":"character_error","message":"角色不在原文"}]})
        .to_string(),
    );
    assert_eq!(
        save_chapter_summary(&conn, input.clone()).unwrap_err(),
        "SUMMARY_BLOCKING_VALIDATION_ERROR"
    );
    input.enabled = Some(false);
    let saved = save_chapter_summary(&conn, input).unwrap();
    assert_eq!(
        update_chapter_summary_enabled(&conn, &saved.id, true).unwrap_err(),
        "SUMMARY_BLOCKING_VALIDATION_ERROR"
    );
    let state: (bool, i64) = conn.query_row("SELECT enabled,(SELECT COUNT(*) FROM memory_documents WHERE status='active') FROM chapter_summaries WHERE id=?1",
        [&saved.id], |row| Ok((row.get(0)?,row.get(1)?))).unwrap();
    assert_eq!(state, (false, 0));
}

#[test]
fn reenable_checks_persisted_source_baseline_not_refreshed_text() {
    let conn = setup_test_db();
    let summary = memory_backed_summary(&conn);
    update_chapter_summary_enabled(&conn, &summary.id, false).unwrap();
    let changed = "用户在原稿中修改正文";
    conn.execute(
        "UPDATE chapter_drafts SET content=?1,content_hash=?2 WHERE id=?3",
        params![
            changed,
            large_text_repository::sha256(changed),
            summary.adopted_draft_id
        ],
    )
    .unwrap();
    assert_eq!(
        update_chapter_summary_enabled(&conn, &summary.id, true).unwrap_err(),
        "SUMMARY_SOURCE_CHANGED"
    );
    assert!(
        !get_chapter_summary_by_id(&conn, &summary.id)
            .unwrap()
            .unwrap()
            .enabled
    );
}

#[test]
fn compatible_legacy_manual_receipt_is_not_mislabeled_as_blocking() {
    let conn = setup_test_db();
    let mut input = memory_backed_summary_input();
    input.validation_status = Some("pending".to_string());
    input.validation_result = Some(
        serde_json::json!({"passed":false,"score":0,"safeToContext":true,
        "authorReviewed":true,"evidenceValidation":"passed","semanticValidation":"not_checked",
        "problems":[{"type":"speculation","message":"作者已审阅应用；语义未证明"}]})
        .to_string(),
    );
    let summary = save_chapter_summary(&conn, input).unwrap();
    update_chapter_summary_enabled(&conn, &summary.id, false).unwrap();
    update_chapter_summary_enabled(&conn, &summary.id, true).unwrap();
    let active: i64 = conn.query_row("SELECT COUNT(*) FROM memory_documents WHERE source_type='chapter_summary' AND status='active'", [], |row| row.get(0)).unwrap();
    assert_eq!(active, 1);
}

#[test]
fn existing_unsafe_summary_is_not_rematerialized_into_memory() {
    let conn = setup_test_db();
    let summary = memory_backed_summary(&conn);
    conn.execute("UPDATE chapter_summaries SET validation_status='failed',validation_result=?1 WHERE id=?2",
        params![serde_json::json!({"passed":false,"score":76,"safeToContext":true,"problems":[{"type":"character_error","message":"阻断"}]}).to_string(),summary.id]).unwrap();
    let unsafe_summary = get_chapter_summary_by_id(&conn, &summary.id)
        .unwrap()
        .unwrap();
    let result = memory_service::sync_chapter_summary_in_transaction(
        &conn,
        &unsafe_summary,
        "2026-11-11T00:00:00Z",
    )
    .unwrap();
    assert!(result.is_none());
    let active: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM memory_documents WHERE status='active'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(active, 0);
}

#[test]
fn unsafe_active_summary_memory_is_excluded_on_read_before_any_sync() {
    let mut conn = setup_test_db();
    let summary = memory_backed_summary(&conn);
    conn.execute("UPDATE chapter_summaries SET validation_status='passed',validation_result=?1 WHERE id=?2",
        params![serde_json::json!({"passed":false,"score":76,"safeToContext":true,"problems":[{"type":"character_error","message":"阻断"}]}).to_string(),summary.id]).unwrap();
    for query in ["主角", ""] {
        let result = memory_service::retrieve(
            &mut conn,
            memory_service::RetrieveMemoryInput {
                trace_id: None,
                request_id: format!("summary-read-{}", query.is_empty()),
                novel_id: summary.novel_id.clone(),
                query: query.to_string(),
                query_embedding: None,
                filters: memory_service::MemoryRetrievalFilters {
                    source_types: vec!["chapter_summary".to_string()],
                    ..Default::default()
                },
                top_k: 10,
                offset: 0,
                candidate_limit: 20,
                token_budget: 1000,
            },
        )
        .unwrap();
        assert!(
            result.items.is_empty(),
            "invalid summary entered read path {query}"
        );
    }
    let active: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM memory_documents WHERE status='active'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        active, 1,
        "read safety must not delete or rewrite historical memory"
    );
    assert!(
        get_chapter_summary_by_id(&conn, &summary.id)
            .unwrap()
            .unwrap()
            .enabled
    );
}
