// Included inside structured_artifact_apply_service::tests. These fixtures exercise
// the real admission, source CAS, transaction and memory writes without user data.
fn grounded_summary_fixture(mut payload: Value) -> Value {
    let claims = crate::services::summary_grounding::assertion_targets(&payload)
        .keys()
        .map(|path| json!({"path":path,"status":"confirmed","quotes":[DRAFT_CONTENT]}))
        .collect::<Vec<_>>();
    payload["grounding"] = json!({"version":1,"claims":claims});
    payload
}

#[test]
fn summary_grounding_new_unmarked_candidates_cannot_write_uncovered_memory() {
    let mut missing_memory = grounded_summary_fixture(json!({"summary":"林夏发现隐藏航线。"}));
    missing_memory["characterChanges"] =
        json!([{"characterName":"林夏","stateSummary":"已永久定居外省"}]);
    missing_memory["contextRecords"] =
        json!([{"contextType":"plot_progress","content":"已经查明罪名"}]);
    let mut invented = grounded_summary_fixture(json!({"summary":"林夏已永久定居外省。"}));
    invented["grounding"]["claims"][0]["quotes"] = json!(["林夏已永久定居外省。"]);
    for (index, (payload, expected_code)) in [
        (
            json!({"summary":"未提供依据的新总结。"}),
            "SUMMARY_GROUNDING_MISSING",
        ),
        (invented, "SUMMARY_EVIDENCE_NOT_FOUND"),
        (missing_memory, "SUMMARY_ASSERTION_UNGROUNDED"),
    ]
    .into_iter()
    .enumerate()
    {
        let mut db = connection();
        let (conversation_id, bundle) = publish_draft_artifact(
            &mut db,
            &format!("grounding-reject-{index}"),
            "chapter_summary",
            payload,
        );
        // The fixture deliberately omits summaryGroundingVersion. Admission is host-owned.
        let snapshot = crate::repositories::ai_task_repository::find_input_snapshot(
            &db,
            &bundle.artifact.task_id,
        )
        .unwrap()
        .unwrap();
        assert!(snapshot
            .payload_json
            .get("summaryGroundingVersion")
            .is_none());
        assert_eq!(bundle.artifact.processing_status, "invalid");
        assert!(bundle
            .issues
            .iter()
            .any(|issue| issue.severity == "error" && issue.code == expected_code));
        let error = conversation_service::create_artifact_card(
            &mut db,
            conversation_service::CreateArtifactCardInput {
                card_id: format!("invalid-grounding-{index}"),
                conversation_id,
                turn_id: None,
                run_id: None,
                artifact_id: Some(bundle.artifact.artifact_id.clone()),
                artifact_type: "chapter_summary".to_string(),
                title: "无效总结不得进入应用".to_string(),
                summary: "来源检查失败".to_string(),
                content: None,
                status: "candidate".to_string(),
                created_at: NOW.to_string(),
            },
        )
        .expect_err("invalid candidate must never become an actionable card");
        assert_eq!(
            error.code,
            crate::errors::codes::DATABASE_TRANSACTION_FAILED
        );
        assert!(error
            .details
            .as_ref()
            .and_then(|details| details["sqliteError"].as_str())
            .is_some_and(|message| message.contains("valid result artifact")));
        for table in [
            "chapter_summaries",
            "context_records",
            "character_states",
            "memory_documents",
            "memory_chunks",
            "conversation_artifact_cards",
        ] {
            assert_eq!(
                count(&db, table),
                0,
                "invalid summary must not write {table}"
            );
        }
    }
}

#[test]
fn summary_grounding_valid_candidate_is_reviewed_and_applied_once_without_semantic_success_claim() {
    let mut db = connection();
    let (card, bundle) = publish_draft_based(
        &mut db,
        "grounding-reviewed",
        "chapter_summary",
        grounded_summary_fixture(
            json!({"summary":"林夏发现隐藏航线。","keyEvents":["取得航线坐标"]}),
        ),
    );
    let first = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
    assert!(first.conflict_code.is_none());
    let replay = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
    assert_eq!(first.decision_id, replay.decision_id);
    assert_eq!(count(&db, "chapter_summaries"), 1);
    let (status, raw): (String, String) = db
        .query_row(
            "SELECT validation_status,validation_result FROM chapter_summaries",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    let result: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(status, "pending");
    assert_eq!(result["passed"], false);
    assert_eq!(result["semanticValidation"], "not_checked");
    assert_eq!(result["authorReviewed"], true);
    assert_eq!(result["evidenceValidation"], "passed");
    assert_eq!(result["safeToContext"], true);
}

#[test]
fn summary_grounding_apply_rejects_adopted_text_changed_after_candidate_validation() {
    let mut db = connection();
    let (card, bundle) = publish_draft_based(
        &mut db,
        "grounding-source-changed",
        "chapter_summary",
        grounded_summary_fixture(json!({"summary":"林夏发现隐藏航线。"})),
    );
    // A different current source cannot authorize an old candidate, even if its quotes existed.
    let changed = "林夏尚未发现航线。";
    db.execute(
        "UPDATE chapter_drafts SET content=?1,content_hash=?2 WHERE id=?3",
        params![changed, large_text_repository::sha256(changed), DRAFT_ID],
    )
    .unwrap();
    let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle));
    assert!(decision.is_err() || decision.as_ref().unwrap().conflict_code.is_some());
    for table in [
        "chapter_summaries",
        "context_records",
        "character_states",
        "memory_documents",
        "memory_chunks",
    ] {
        assert_eq!(count(&db, table), 0, "stale source must not write {table}");
    }
}
