use super::content_transaction_service::{
    self, ApplyContentTransactionInput, ApprovedContentTarget, PrepareContentTargetInput,
    PrepareContentTransactionInput,
};
use crate::errors::codes;
use rusqlite::{params, Connection};
use serde_json::json;

const NOW: &str = "2026-07-28T00:00:00Z";

fn database() -> Connection {
    let mut connection = Connection::open_in_memory().expect("open memory database");
    connection
        .execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    crate::db::create_tables(&mut connection).expect("create schema");
    for id in ["novel-a", "novel-b"] {
        connection
            .execute(
                "INSERT INTO novels(id,title,created_at,updated_at) VALUES(?1,?2,?3,?3)",
                params![id, id, NOW],
            )
            .expect("insert novel");
    }
    connection
        .execute(
            "INSERT INTO chapters(id,novel_id,title,created_at,updated_at) VALUES('chapter-a1','novel-a','A1',?1,?1),('chapter-a2','novel-a','A2',?1,?1),('chapter-b1','novel-b','B1',?1,?1)",
            [NOW],
        )
        .expect("insert chapters");
    connection
        .execute(
            "INSERT INTO characters(id,novel_id,name,created_at,updated_at) VALUES('character-a','novel-a','A',?1,?1),('character-b','novel-b','B',?1,?1)",
            [NOW],
        )
        .expect("insert characters");
    connection
        .execute(
            "INSERT INTO chapter_events(id,novel_id,chapter_id,title,created_at,updated_at) VALUES('event-a','novel-a','chapter-a1','E',?1,?1),('event-b','novel-b','chapter-b1','E',?1,?1)",
            [NOW],
        )
        .expect("insert events");
    connection
}

fn faction(id: &str, name: &str) -> PrepareContentTargetInput {
    PrepareContentTargetInput {
        target_type: "faction".into(),
        target_id: id.into(),
        effect_type: "create".into(),
        payload: json!({"name":name,"kind":"guild","description":"desc","goals":"goal"}),
    }
}

fn location(id: &str, name: &str, parent: Option<&str>) -> PrepareContentTargetInput {
    PrepareContentTargetInput {
        target_type: "location".into(),
        target_id: id.into(),
        effect_type: "create".into(),
        payload: json!({"name":name,"kind":"city","description":"desc","parentLocationId":parent}),
    }
}

fn prepare(
    connection: &mut Connection,
    operation: &str,
    strategy: &str,
    targets: Vec<PrepareContentTargetInput>,
) -> content_transaction_service::ContentTransactionDto {
    content_transaction_service::prepare_transaction(
        connection,
        PrepareContentTransactionInput {
            operation_id: operation.into(),
            novel_id: "novel-a".into(),
            strategy: strategy.into(),
            targets,
        },
    )
    .expect("prepare transaction")
}

fn apply(
    connection: &mut Connection,
    transaction: &content_transaction_service::ContentTransactionDto,
    approved_targets: Vec<ApprovedContentTarget>,
) -> Result<content_transaction_service::ApplyContentTransactionResult, crate::errors::AppError> {
    content_transaction_service::apply_transaction(
        connection,
        ApplyContentTransactionInput {
            transaction_id: transaction.transaction_id.clone(),
            operation_id: transaction.operation_id.clone(),
            expected_transaction_hash: transaction.transaction_hash.clone(),
            approved_targets,
        },
    )
}

#[test]
fn p2_target_set_hash_is_stable_and_order_sensitive() {
    let mut connection = database();
    let first = prepare(
        &mut connection,
        "stable-1",
        "all_or_nothing",
        vec![faction("f-a", "A"), location("l-a", "L", None)],
    );
    let second = prepare(
        &mut connection,
        "stable-2",
        "all_or_nothing",
        vec![faction("f-a", "A"), location("l-a", "L", None)],
    );
    let reversed = prepare(
        &mut connection,
        "stable-3",
        "all_or_nothing",
        vec![location("l-a", "L", None), faction("f-a", "A")],
    );
    assert_eq!(first.target_set_hash, second.target_set_hash);
    assert_ne!(first.target_set_hash, reversed.target_set_hash);
    assert_eq!(first.targets[0].base_revision, 0);
    assert_eq!(first.targets[1].base_revision, 0);
}

#[test]
fn p2_cross_novel_reference_is_rejected() {
    let mut connection = database();
    connection.execute("INSERT INTO factions(id,novel_id,name,revision,created_at,updated_at) VALUES('foreign-faction','novel-b','Foreign',1,?1,?1)",[NOW]).unwrap();
    let transaction = prepare(
        &mut connection,
        "scope-1",
        "all_or_nothing",
        vec![PrepareContentTargetInput {
            target_type: "character_faction".into(),
            target_id: "membership-a".into(),
            effect_type: "create".into(),
            payload: json!({"characterId":"character-a","factionId":"foreign-faction","role":"member"}),
        }],
    );
    let error = apply(&mut connection, &transaction, vec![]).expect_err("scope mismatch");
    assert_eq!(error.code, codes::CONTENT_ASSET_SCOPE_MISMATCH);
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM character_factions", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn p2_any_cas_conflict_rolls_back_all_or_nothing() {
    let mut connection = database();
    let transaction = prepare(
        &mut connection,
        "cas-1",
        "all_or_nothing",
        vec![
            faction("cas-faction", "F"),
            location("cas-location", "L", None),
        ],
    );
    connection.execute("INSERT INTO factions(id,novel_id,name,revision,created_at,updated_at) VALUES('cas-faction','novel-a','manual',1,?1,?1)",[NOW]).unwrap();
    let error = apply(&mut connection, &transaction, vec![]).expect_err("CAS conflict");
    assert_eq!(error.code, codes::CONTENT_TARGET_CONFLICT);
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM locations WHERE id='cas-location'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
    assert_eq!(
        content_transaction_service::get_transaction(&connection, &transaction.transaction_id)
            .unwrap()
            .unwrap()
            .status,
        "prepared"
    );
}

#[test]
fn p2_late_write_failure_rolls_back_earlier_targets() {
    let mut connection = database();
    connection
        .execute(
            "INSERT INTO locations(id,novel_id,name,revision,created_at,updated_at) VALUES('manual-location','novel-a','Duplicate name',1,?1,?1)",
            [NOW],
        )
        .unwrap();
    let transaction = prepare(
        &mut connection,
        "late-failure-1",
        "all_or_nothing",
        vec![
            faction("must-rollback", "Temporary faction"),
            location("duplicate-location", "Duplicate name", None),
        ],
    );
    assert!(apply(&mut connection, &transaction, vec![]).is_err());
    assert!(
        content_transaction_service::get_faction(&connection, "novel-a", "must-rollback")
            .unwrap()
            .is_none()
    );
    assert_eq!(
        content_transaction_service::get_transaction(&connection, &transaction.transaction_id)
            .unwrap()
            .unwrap()
            .status,
        "prepared"
    );
}

#[test]
fn p2_reviewed_partial_applies_only_explicit_approvals() {
    let mut connection = database();
    let transaction = prepare(
        &mut connection,
        "partial-1",
        "reviewed_partial",
        vec![
            faction("approved-f", "Approved"),
            location("rejected-l", "Rejected", None),
        ],
    );
    let result = apply(
        &mut connection,
        &transaction,
        vec![ApprovedContentTarget {
            target_type: "faction".into(),
            target_id: "approved-f".into(),
        }],
    )
    .expect("partial apply");
    assert!(!result.replayed);
    assert!(
        content_transaction_service::get_faction(&connection, "novel-a", "approved-f")
            .unwrap()
            .is_some()
    );
    assert!(
        content_transaction_service::get_location(&connection, "novel-a", "rejected-l")
            .unwrap()
            .is_none()
    );
    assert!(result.transaction.targets[0].applied_hash.is_some());
    assert!(result.transaction.targets[1].applied_hash.is_none());
    let mismatch = apply(
        &mut connection,
        &transaction,
        vec![ApprovedContentTarget {
            target_type: "location".into(),
            target_id: "rejected-l".into(),
        }],
    )
    .expect_err("replay cannot change the approved subset");
    assert_eq!(mismatch.code, codes::OPERATION_PAYLOAD_CONFLICT);
}

#[test]
fn p2_operation_replay_revalidates_materialized_targets_and_detects_drift() {
    let mut connection = database();
    let transaction = prepare(
        &mut connection,
        "replay-1",
        "all_or_nothing",
        vec![faction("replay-f", "Initial")],
    );
    apply(&mut connection, &transaction, vec![]).expect("first apply");
    let replay = apply(&mut connection, &transaction, vec![]).expect("replay");
    assert!(replay.replayed);
    connection.execute("UPDATE factions SET name='Manual change',revision=revision+1,updated_at=?1 WHERE id='replay-f'",[NOW]).unwrap();
    let error = apply(&mut connection, &transaction, vec![]).expect_err("drift must fail replay");
    assert_eq!(error.code, codes::CONTENT_REPLAY_TARGET_CHANGED);
}

#[test]
fn p2_operation_id_replay_requires_identical_request_hash() {
    let mut connection = database();
    let original = prepare(
        &mut connection,
        "operation-1",
        "all_or_nothing",
        vec![faction("same-f", "Same")],
    );
    let replay = prepare(
        &mut connection,
        "operation-1",
        "all_or_nothing",
        vec![faction("same-f", "Same")],
    );
    assert_eq!(original.transaction_id, replay.transaction_id);
    let error = content_transaction_service::prepare_transaction(
        &mut connection,
        PrepareContentTransactionInput {
            operation_id: "operation-1".into(),
            novel_id: "novel-a".into(),
            strategy: "all_or_nothing".into(),
            targets: vec![faction("different-f", "Different")],
        },
    )
    .expect_err("payload conflict");
    assert_eq!(error.code, codes::OPERATION_PAYLOAD_CONFLICT);
}

#[test]
fn p2_relations_enforce_foreign_keys_scope_and_location_cycles() {
    let mut connection = database();
    connection.execute("INSERT INTO factions(id,novel_id,name,revision,created_at,updated_at) VALUES('fa','novel-a','FA',1,?1,?1),('fb','novel-b','FB',1,?1,?1)",[NOW]).unwrap();
    assert!(connection.execute("INSERT INTO faction_relations(id,novel_id,source_faction_id,target_faction_id,relation_type,revision,created_at,updated_at) VALUES('bad','novel-a','fa','fb','ally',1,?1,?1)",[NOW]).is_err());
    let cycle = prepare(
        &mut connection,
        "cycle-1",
        "all_or_nothing",
        vec![
            location("location-child", "Child", Some("location-parent")),
            location("location-parent", "Parent", Some("location-child")),
        ],
    );
    let error = apply(&mut connection, &cycle, vec![]).expect_err("hierarchy cycle");
    assert_eq!(error.code, codes::CONTENT_ASSET_HIERARCHY_CYCLE);
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM locations WHERE id IN ('location-child','location-parent')",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        0
    );
}

#[test]
fn p2_formal_assets_and_character_chapter_conflict_relations_apply_together() {
    let mut connection = database();
    let transaction = prepare(
        &mut connection,
        "assets-1",
        "all_or_nothing",
        vec![
            location("child-l", "Child", Some("parent-l")),
            location("parent-l", "Parent", None),
            faction("asset-f1", "F1"),
            faction("asset-f2", "F2"),
            PrepareContentTargetInput {
                target_type: "faction_relation".into(),
                target_id: "relation-f1-f2".into(),
                effect_type: "create".into(),
                payload: json!({"sourceFactionId":"asset-f1","targetFactionId":"asset-f2","relationType":"rival","description":"formal relation"}),
            },
            PrepareContentTargetInput {
                target_type: "character_faction".into(),
                target_id: "character-faction-a".into(),
                effect_type: "create".into(),
                payload: json!({"characterId":"character-a","factionId":"asset-f1","role":"leader"}),
            },
            PrepareContentTargetInput {
                target_type: "chapter_location".into(),
                target_id: "chapter-location-a".into(),
                effect_type: "create".into(),
                payload: json!({"chapterId":"chapter-a1","locationId":"child-l","role":"scene"}),
            },
            PrepareContentTargetInput {
                target_type: "chapter_event_faction".into(),
                target_id: "conflict-faction-a".into(),
                effect_type: "create".into(),
                payload: json!({"chapterEventId":"event-a","factionId":"asset-f2","role":"opponent"}),
            },
        ],
    );
    apply(&mut connection, &transaction, vec![]).expect("apply formal assets");
    let parent: String = connection
        .query_row(
            "SELECT parent_location_id FROM locations WHERE id='child-l'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(parent, "parent-l");
    for table in [
        "faction_relations",
        "character_factions",
        "chapter_locations",
        "chapter_event_factions",
    ] {
        let count: i64 = connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1, "missing applied relation in {table}");
    }
}

#[test]
fn p2_cross_chapter_metadata_batch_uses_one_atomic_transaction() {
    let mut connection = database();
    let target = |id: &str, title: &str| PrepareContentTargetInput {
        target_type: "chapter_metadata".into(),
        target_id: id.into(),
        effect_type: "update".into(),
        payload: json!({"title":title,"outline":format!("outline-{id}"),"status":"outline_ready"}),
    };
    let transaction = prepare(
        &mut connection,
        "chapters-1",
        "all_or_nothing",
        vec![
            target("chapter-a1", "Updated 1"),
            target("chapter-a2", "Updated 2"),
        ],
    );
    apply(&mut connection, &transaction, vec![]).expect("chapter batch");
    let titles = connection
        .prepare("SELECT title FROM chapters WHERE id IN ('chapter-a1','chapter-a2') ORDER BY id")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(titles, vec!["Updated 1", "Updated 2"]);
    let adopted: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM chapters WHERE adopted_draft_id IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(adopted, 0, "batch metadata must not adopt chapter body");
}

#[test]
fn p2_schema_contains_durable_assets_transactions_and_scope_guards() {
    let connection = database();
    for table in [
        "factions",
        "locations",
        "faction_relations",
        "location_links",
        "character_factions",
        "chapter_factions",
        "chapter_locations",
        "chapter_event_factions",
        "chapter_event_locations",
        "content_transactions",
        "content_transaction_targets",
    ] {
        let exists: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1, "missing migration 028 table {table}");
    }
    for trigger in [
        "trg_locations_no_hierarchy_cycle_update",
        "trg_content_transactions_immutable_identity",
        "trg_content_transaction_targets_immutable_candidate",
        "trg_chapter_locations_scope_insert",
        "trg_factions_revision_cas",
    ] {
        let exists: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name=?1",
                [trigger],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 1, "missing migration 028 trigger {trigger}");
    }
    assert_eq!(
        connection
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query_map([], |_| Ok(()))
            .unwrap()
            .count(),
        0
    );
}
