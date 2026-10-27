// Character-reference gate for the versioned summary coverage contract.
// Included inside structured_artifact_apply_service::tests so the fixtures exercise
// admission, the real apply transaction, and the domain-write boundary together.
const OTHER_NOVEL_ID: &str = "00000000-0000-4000-8000-000000000002";
const OTHER_CHARACTER_ID: &str = "00000000-0000-4000-8000-000000000020";
const SECOND_CHARACTER_ID: &str = "00000000-0000-4000-8000-000000000021";
const UNKNOWN_CHARACTER_ID: &str = "00000000-0000-4000-8000-0000000000ff";

fn insert_summary_character(
    connection: &Connection,
    id: &str,
    novel_id: &str,
    name: &str,
    active: bool,
    protagonist: bool,
) {
    connection
        .execute(
            "INSERT INTO characters
             (id,novel_id,name,role_type,is_protagonist,is_active,created_at,updated_at)
             VALUES (?1,?2,?3,'supporting',?4,?5,?6,?6)",
            params![
                id,
                novel_id,
                name,
                if protagonist { 1 } else { 0 },
                if active { 1 } else { 0 },
                NOW
            ],
        )
        .expect("character");
}

fn publish_covered_summary(
    connection: &mut Connection,
    suffix: &str,
    change: Value,
) -> (
    conversation_service::ConversationArtifactCardRecord,
    artifact_service::ResultArtifactBundle,
) {
    publish_draft_based_with_snapshot_extra(
        connection,
        suffix,
        "chapter_summary",
        grounded_summary_fixture(json!({
            "summary": "林夏发现隐藏航线。",
            "characterChanges": [change],
            "contextRecords": []
        })),
        coverage_markers(),
    )
}

fn assert_reference_conflict(
    decision: &crate::repositories::conversation_repository::ArtifactDecisionRecord,
) {
    assert_eq!(
        decision.conflict_code.as_deref(),
        Some("SUMMARY_CHARACTER_REFERENCE_CONFLICT"),
        "unresolved new-contract character reference must fail with the stable conflict code"
    );
    assert!(
        decision.apply_transaction_id.is_none(),
        "a reference conflict is not an applied transaction"
    );
}

fn assert_zero_domain_writes(connection: &Connection) {
    for table in [
        "chapter_summaries",
        "context_records",
        "character_states",
        "memory_documents",
        "memory_chunks",
    ] {
        assert_eq!(
            count(connection, table),
            0,
            "a failed character reference must not write {table}"
        );
    }
    assert_eq!(
        count(connection, "artifact_decisions"),
        1,
        "the stable conflict decision itself remains auditable"
    );
}

#[test]
fn summary_coverage_unknown_character_id_fails_closed_without_domain_writes() {
    let mut db = connection();
    let (card, bundle) = publish_covered_summary(
        &mut db,
        "reference-unknown-id",
        json!({
            "characterId": UNKNOWN_CHARACTER_ID,
            "stateSummary": "掌握了隐藏航线"
        }),
    );
    let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
    assert_reference_conflict(&decision);
    assert_zero_domain_writes(&db);
}

#[test]
fn summary_coverage_unknown_character_name_fails_closed_without_domain_writes() {
    let mut db = connection();
    let (card, bundle) = publish_covered_summary(
        &mut db,
        "reference-unknown-name",
        json!({
            "characterName": "陌生人",
            "stateSummary": "掌握了隐藏航线"
        }),
    );
    let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
    assert_reference_conflict(&decision);
    assert_zero_domain_writes(&db);
}

#[test]
fn summary_coverage_cross_novel_character_reference_fails_closed() {
    for (suffix, by_id) in [
        ("reference-cross-novel-id", true),
        ("reference-cross-novel-name", false),
    ] {
        let mut db = connection();
        db.execute(
            "INSERT INTO novels (id,title,outline,created_at,updated_at)
             VALUES (?1,'另一部作品','',?2,?2)",
            params![OTHER_NOVEL_ID, NOW],
        )
        .expect("other novel");
        insert_summary_character(&db, OTHER_CHARACTER_ID, OTHER_NOVEL_ID, "林夏", true, false);
        let change = if by_id {
            json!({
                "characterId": OTHER_CHARACTER_ID,
                "stateSummary": "另一作品的人物状态"
            })
        } else {
            json!({
                "characterName": "林夏",
                "stateSummary": "另一作品的人物状态"
            })
        };
        let (card, bundle) = publish_covered_summary(&mut db, suffix, change);
        let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
        assert_reference_conflict(&decision);
        assert_zero_domain_writes(&db);
    }
}

#[test]
fn summary_coverage_disabled_character_reference_fails_closed() {
    for (suffix, by_id) in [
        ("reference-disabled-id", true),
        ("reference-disabled-name", false),
    ] {
        let mut db = connection();
        insert_summary_character(&db, SUMMARY_CHARACTER_ID, NOVEL_ID, "林夏", false, false);
        let change = if by_id {
            json!({
                "characterId": SUMMARY_CHARACTER_ID,
                "stateSummary": "停用人物不得写入"
            })
        } else {
            json!({
                "characterName": "林夏",
                "stateSummary": "停用人物不得写入"
            })
        };
        let (card, bundle) = publish_covered_summary(&mut db, suffix, change);
        let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
        assert_reference_conflict(&decision);
        assert_zero_domain_writes(&db);
    }
}

#[test]
fn summary_coverage_ambiguous_active_name_fails_closed_instead_of_picking_protagonist() {
    let mut db = connection();
    insert_summary_character(&db, SUMMARY_CHARACTER_ID, NOVEL_ID, "林夏", true, true);
    insert_summary_character(&db, SECOND_CHARACTER_ID, NOVEL_ID, "林夏", true, false);
    let (card, bundle) = publish_covered_summary(
        &mut db,
        "reference-ambiguous-name",
        json!({
            "characterName": "林夏",
            "stateSummary": "同名歧义不得猜测角色"
        }),
    );
    let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
    assert_reference_conflict(&decision);
    assert_zero_domain_writes(&db);
}

#[test]
fn summary_coverage_character_id_and_name_mismatch_fails_closed() {
    let mut db = connection();
    insert_summary_character(&db, SUMMARY_CHARACTER_ID, NOVEL_ID, "林夏", true, false);
    insert_summary_character(&db, SECOND_CHARACTER_ID, NOVEL_ID, "沈砚", true, false);
    let (card, bundle) = publish_covered_summary(
        &mut db,
        "reference-id-name-mismatch",
        json!({
            "characterId": SUMMARY_CHARACTER_ID,
            "characterName": "沈砚",
            "stateSummary": "ID 与姓名指向不同人物"
        }),
    );
    let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
    assert_reference_conflict(&decision);
    assert_zero_domain_writes(&db);
}

#[test]
fn summary_coverage_unknown_id_does_not_fall_back_to_matching_name() {
    let mut db = connection();
    insert_summary_character(&db, SUMMARY_CHARACTER_ID, NOVEL_ID, "林夏", true, false);
    let (card, bundle) = publish_covered_summary(
        &mut db,
        "reference-unknown-id-fallback",
        json!({
            "characterId": UNKNOWN_CHARACTER_ID,
            "characterName": "林夏",
            "stateSummary": "未知 ID 不得改用同名人物"
        }),
    );
    let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
    assert_reference_conflict(&decision);
    assert_zero_domain_writes(&db);
}

#[test]
fn summary_coverage_consistent_character_id_and_name_applies_once() {
    let mut db = connection();
    insert_summary_character(&db, SUMMARY_CHARACTER_ID, NOVEL_ID, "林夏", true, false);
    let (card, bundle) = publish_covered_summary(
        &mut db,
        "reference-consistent-id-name",
        json!({
            "characterId": SUMMARY_CHARACTER_ID,
            "characterName": "林夏",
            "stateSummary": "掌握了隐藏航线"
        }),
    );
    let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
    assert!(decision.conflict_code.is_none());
    assert_eq!(count(&db, "chapter_summaries"), 1);
    assert_eq!(count(&db, "character_states"), 1);
}

#[test]
fn summary_coverage_empty_character_changes_keep_zero_character_states_and_succeed() {
    let mut db = connection();
    let (card, bundle) = publish_draft_based_with_snapshot_extra(
        &mut db,
        "reference-empty-arrays",
        "chapter_summary",
        grounded_summary_fixture(json!({
            "summary": "林夏发现隐藏航线。",
            "characterChanges": [],
            "contextRecords": []
        })),
        coverage_markers(),
    );
    let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
    assert!(decision.conflict_code.is_none());
    assert_eq!(count(&db, "chapter_summaries"), 1);
    // An explicit empty contextRecords still derives exactly one chapter_summary record.
    assert_eq!(count(&db, "context_records"), 1);
    assert_eq!(count(&db, "character_states"), 0);
}

#[test]
fn summary_coverage_legacy_ambiguous_name_keeps_protagonist_first_resolution() {
    let mut db = connection();
    insert_summary_character(&db, SUMMARY_CHARACTER_ID, NOVEL_ID, "林夏", true, true);
    insert_summary_character(&db, SECOND_CHARACTER_ID, NOVEL_ID, "林夏", true, false);
    // No summaryCoverageVersion marker: the historical resolver still prefers the
    // protagonist instead of failing on the duplicate name.
    let (card, bundle) = publish_draft_based(
        &mut db,
        "reference-legacy-ambiguous",
        "chapter_summary",
        grounded_summary_fixture(json!({
            "summary": "林夏发现隐藏航线。",
            "characterChanges": [{
                "characterName": "林夏",
                "stateSummary": "旧版主角优先"
            }]
        })),
    );
    let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
    assert!(decision.conflict_code.is_none());
    assert_eq!(count(&db, "character_states"), 1);
    let character_id: String = db
        .query_row("SELECT character_id FROM character_states", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(character_id, SUMMARY_CHARACTER_ID);
}

#[test]
fn summary_coverage_legacy_unknown_character_reference_keeps_silent_skip() {
    let mut db = connection();
    // No summaryCoverageVersion marker: historical candidates keep best-effort
    // resolution, so an unknown reference stays skipped instead of failing.
    let (card, bundle) = publish_draft_based(
        &mut db,
        "reference-legacy-unknown",
        "chapter_summary",
        grounded_summary_fixture(json!({
            "summary": "林夏发现隐藏航线。",
            "characterChanges": [{
                "characterName": "陌生人",
                "stateSummary": "旧版静默跳过"
            }]
        })),
    );
    let decision = apply_structured_artifact(&mut db, apply_input(&card, &bundle)).unwrap();
    assert!(decision.conflict_code.is_none());
    assert_eq!(count(&db, "chapter_summaries"), 1);
    assert_eq!(count(&db, "character_states"), 0);
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
