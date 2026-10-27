// Included inside structured_artifact_apply_service::tests. These fixtures exercise
// the real admission, source CAS, transaction and memory writes without user data.
fn grounded_summary_fixture(mut payload: Value) -> Value {
    // Newly admitted summaries always carry the coverage arrays. Empty means
    // "checked, no change"; the fixture must not rely on omitted fields.
    if payload.get("characterChanges").is_none() {
        payload["characterChanges"] = json!([]);
    }
    if payload.get("contextRecords").is_none() {
        payload["contextRecords"] = json!([]);
    }
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

fn coverage_markers() -> Value {
    json!({"summaryGroundingVersion": 1, "summaryCoverageVersion": 1})
}

#[test]
fn summary_coverage_new_candidates_require_explicit_arrays_at_admission() {
    let mut db = connection();
    // Grounding is complete for the summary itself, so only coverage is missing.
    let payload = json!({
        "summary": "林夏发现隐藏航线。",
        "grounding": {
            "version": 1,
            "claims": [{"path": "/summary", "status": "confirmed", "quotes": [DRAFT_CONTENT]}]
        }
    });
    let (conversation_id, bundle) = publish_draft_artifact_with_snapshot_extra(
        &mut db,
        "coverage-missing",
        "chapter_summary",
        payload,
        coverage_markers(),
    );
    assert_eq!(bundle.artifact.processing_status, "invalid");
    let codes = bundle
        .issues
        .iter()
        .map(|issue| issue.code.as_str())
        .collect::<Vec<_>>();
    assert!(codes.contains(&"SUMMARY_CHARACTER_CHANGES_MISSING"));
    assert!(codes.contains(&"SUMMARY_CONTEXT_RECORDS_MISSING"));
    let error = conversation_service::create_artifact_card(
        &mut db,
        conversation_service::CreateArtifactCardInput {
            card_id: "invalid-coverage".to_string(),
            conversation_id,
            turn_id: None,
            run_id: None,
            artifact_id: Some(bundle.artifact.artifact_id.clone()),
            artifact_type: "chapter_summary".to_string(),
            title: "不完整总结不得进入应用".to_string(),
            summary: "缺少覆盖数组".to_string(),
            content: None,
            status: "candidate".to_string(),
            created_at: NOW.to_string(),
        },
    )
    .expect_err("invalid candidate must not become a card");
    assert_eq!(
        error.code,
        crate::errors::codes::DATABASE_TRANSACTION_FAILED
    );
}

#[test]
fn summary_coverage_explicit_empty_arrays_apply_without_inventing_character_state() {
    let mut db = connection();
    let (card, bundle) = publish_draft_based_with_snapshot_extra(
        &mut db,
        "coverage-empty",
        "chapter_summary",
        grounded_summary_fixture(json!({"summary": "林夏发现隐藏航线。"})),
        coverage_markers(),
    );
    let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
    assert!(decision.conflict_code.is_none());
    assert_eq!(count(&db, "chapter_summaries"), 1);
    // An explicit empty contextRecords still derives exactly one chapter_summary record.
    assert_eq!(count(&db, "context_records"), 1);
    assert_eq!(count(&db, "character_states"), 0);
    let raw: String = db
        .query_row(
            "SELECT validation_result FROM chapter_summaries",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let result: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(result["coverageValidation"], "passed");
    assert_eq!(result["summaryCoverageVersion"], 1);
}

#[test]
fn summary_coverage_explicit_character_change_is_applied_under_new_contract() {
    let mut db = connection();
    db.execute(
        "INSERT INTO characters (id,novel_id,name,is_active,created_at,updated_at)
         VALUES (?1,?2,'林夏',1,?3,?3)",
        params![SUMMARY_CHARACTER_ID, NOVEL_ID, NOW],
    )
    .unwrap();
    let (card, bundle) = publish_draft_based_with_snapshot_extra(
        &mut db,
        "coverage-character",
        "chapter_summary",
        grounded_summary_fixture(json!({
            "summary": "林夏发现隐藏航线。",
            "characterChanges": [{"characterName": "林夏", "stateSummary": "掌握了隐藏航线"}],
            "contextRecords": []
        })),
        coverage_markers(),
    );
    let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
    assert!(decision.conflict_code.is_none());
    assert_eq!(count(&db, "character_states"), 1);
}

#[test]
fn summary_coverage_empty_character_changes_blocks_legacy_state_fallback() {
    let mut db = connection();
    let (card, bundle) = publish_draft_based_with_snapshot_extra(
        &mut db,
        "coverage-no-fallback",
        "chapter_summary",
        grounded_summary_fixture(json!({
            "summary": "林夏发现隐藏航线。",
            "importantCharacterChanges": [{"name": "林夏", "change": "已离开旧港"}],
            "protagonistStateChange": "已离开旧港"
        })),
        coverage_markers(),
    );
    let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
    assert!(decision.conflict_code.is_none());
    assert_eq!(count(&db, "character_states"), 0);
}

#[test]
fn summary_coverage_apply_rejects_incomplete_character_item() {
    let mut db = connection();
    let (card, bundle) = publish_draft_based_with_snapshot_extra(
        &mut db,
        "coverage-bad-character",
        "chapter_summary",
        grounded_summary_fixture(json!({
            "summary": "林夏发现隐藏航线。",
            "characterChanges": [{"characterName": "林夏"}],
            "contextRecords": []
        })),
        coverage_markers(),
    );
    let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
    assert_eq!(
        decision.conflict_code.as_deref(),
        Some("SUMMARY_COVERAGE_INCOMPLETE")
    );
    assert_eq!(count(&db, "chapter_summaries"), 0);
    assert_eq!(count(&db, "character_states"), 0);
}

#[test]
fn summary_coverage_apply_rejects_incomplete_context_record() {
    let mut db = connection();
    let (card, bundle) = publish_draft_based_with_snapshot_extra(
        &mut db,
        "coverage-bad-context",
        "chapter_summary",
        grounded_summary_fixture(json!({
            "summary": "林夏发现隐藏航线。",
            "characterChanges": [],
            "contextRecords": [{"title": "隐藏航线"}]
        })),
        coverage_markers(),
    );
    let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
    assert_eq!(
        decision.conflict_code.as_deref(),
        Some("SUMMARY_COVERAGE_INCOMPLETE")
    );
    assert_eq!(count(&db, "chapter_summaries"), 0);
    assert_eq!(count(&db, "context_records"), 0);
}

#[test]
fn summary_coverage_legacy_marker_absence_keeps_fallback_state_write() {
    let mut db = connection();
    db.execute(
        "INSERT INTO characters (id,novel_id,name,is_active,created_at,updated_at)
         VALUES (?1,?2,'林夏',1,?3,?3)",
        params![SUMMARY_CHARACTER_ID, NOVEL_ID, NOW],
    )
    .unwrap();
    let (card, bundle) = publish_draft_based(
        &mut db,
        "coverage-legacy",
        "chapter_summary",
        grounded_summary_fixture(json!({
            "summary": "林夏发现隐藏航线。",
            "importantCharacterChanges": [{"name": "林夏", "change": "已离开旧港"}]
        })),
    );
    let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
    assert!(decision.conflict_code.is_none());
    assert_eq!(count(&db, "character_states"), 1);
    let raw: String = db
        .query_row(
            "SELECT validation_result FROM chapter_summaries",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let result: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(result["coverageValidation"], "legacy_not_required");
    assert_eq!(result["summaryCoverageVersion"], Value::Null);
}
