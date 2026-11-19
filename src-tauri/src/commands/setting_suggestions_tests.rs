use super::*;
use serde_json::json;

const NOVEL: &str = "20000000-0000-4000-8000-000000000001";

fn connection() -> Connection {
    let mut connection = Connection::open_in_memory().expect("connection");
    connection
        .execute_batch("PRAGMA foreign_keys=ON;")
        .expect("foreign keys");
    crate::db::create_tables(&mut connection).expect("schema");
    connection
        .execute(
            "INSERT INTO novels (id, title, outline, created_at, updated_at) VALUES (?1, 'n', '', ?2, ?2)",
            params![NOVEL, "2026-09-08T00:00:00Z"],
        )
        .expect("novel");
    connection
}

fn input(name: &str) -> SaveSettingSuggestionInput {
    let mut item = Map::new();
    item.insert("name".to_string(), json!(name));
    item.insert("description".to_string(), json!({"nested": true}));
    SaveSettingSuggestionInput {
        id: None,
        novel_id: NOVEL.to_string(),
        suggestion_type: "character".to_string(),
        world_type: Some("修仙".to_string()),
        reference_style: Some("热血".to_string()),
        prompt: Some("prompt".to_string()),
        result_json: None,
        expected_rule_set_fingerprint: None,
        item,
        status: None,
        adopted_target_id: None,
        adopted_target_type: None,
        user_instruction: None,
        raw_output: Some("raw".to_string()),
        created_at: None,
        updated_at: None,
    }
}

fn adoption_request(
    record: &SettingSuggestionDto,
    edited: Option<Map<String, Value>>,
) -> crate::services::setting_suggestion_adoption_service::AdoptSettingSuggestionInput {
    use crate::services::{
        setting_suggestion_adoption_service as adoption, world_rule_governance as rules,
    };
    adoption::AdoptSettingSuggestionInput {
        id: record.id.clone(),
        novel_id: record.novel_id.clone(),
        actor: "user".to_string(),
        expected_candidate_hash: adoption::candidate_hash(record).unwrap(),
        authorized_item_hash: rules::hash_json(&json!(edited.as_ref().unwrap_or(&record.item)))
            .unwrap(),
        edited_item: edited,
        expected_rule_set_fingerprint: None,
        change_authorization: None,
    }
}

#[test]
fn saves_a_batch_atomically_and_decides_once() {
    let mut connection = connection();
    let saved =
        save_setting_suggestions_with(&mut connection, vec![input("甲"), input("乙")]).unwrap();
    assert_eq!(saved.len(), 2);
    assert_eq!(saved[0].item["description"], json!("{\"nested\":true}"));
    assert_eq!(saved[0].status, "pending");
    assert_eq!(
        list_setting_suggestions_with(&connection, NOVEL)
            .unwrap()
            .len(),
        2
    );

    let edited = Map::from_iter([("name".to_string(), json!("甲·改"))]);
    let request = adoption_request(&saved[0], Some(edited));
    let result = crate::services::setting_suggestion_adoption_service::adopt_with(
        &mut connection,
        request.clone(),
    )
    .unwrap();
    let adopted = result.record;
    assert_eq!(adopted.status, "edited_adopted");
    assert_eq!(adopted.item["name"], json!("甲·改"));
    assert_eq!(
        adopted.adopted_target_id.as_deref(),
        Some(result.target_id.as_str())
    );
    let replay =
        crate::services::setting_suggestion_adoption_service::adopt_with(&mut connection, request)
            .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.target_id, result.target_id);

    let again = decide_setting_suggestion_with(
        &connection,
        DecideSettingSuggestionInput {
            id: saved[0].id.clone(),
            status: "discarded".to_string(),
            item: None,
            adopted_target_id: None,
            adopted_target_type: None,
        },
    )
    .unwrap_err();
    assert!(
        again.starts_with(SETTING_SUGGESTION_ALREADY_DECIDED),
        "{again}"
    );

    let discarded = decide_setting_suggestion_with(
        &connection,
        DecideSettingSuggestionInput {
            id: saved[1].id.clone(),
            status: "discarded".to_string(),
            item: None,
            adopted_target_id: None,
            adopted_target_type: None,
        },
    )
    .unwrap();
    assert_eq!(discarded.status, "discarded");

    // The trigger is the last line of defence even for direct SQL.
    let direct = connection.execute(
        "UPDATE setting_suggestions SET status = 'pending' WHERE id = ?1",
        params![saved[1].id],
    );
    assert!(direct.is_err(), "decided suggestions must not reopen");
}

#[test]
fn legacy_adoption_rolls_back_target_when_decision_insert_fails_and_retries_once() {
    use crate::services::setting_suggestion_adoption_service::adopt_with;
    let mut connection = connection();
    let record = save_setting_suggestions_with(&mut connection, vec![input("rollback")])
        .unwrap()
        .remove(0);
    let request = adoption_request(&record, None);
    connection.execute_batch("CREATE TEMP TRIGGER inject_decision_failure BEFORE UPDATE OF status ON setting_suggestions
        WHEN NEW.status='adopted' BEGIN SELECT RAISE(ABORT,'injected decision failure'); END;").unwrap();
    assert!(adopt_with(&mut connection, request.clone()).is_err());
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM characters", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        get_setting_suggestion_with(&connection, &record.id)
            .unwrap()
            .unwrap()
            .status,
        "pending"
    );
    connection
        .execute_batch("DROP TRIGGER inject_decision_failure")
        .unwrap();
    let first = adopt_with(&mut connection, request.clone()).unwrap();
    let replay = adopt_with(&mut connection, request.clone()).unwrap();
    assert!(replay.replayed);
    assert_eq!(first.target_id, replay.target_id);
    connection
        .execute(
            "UPDATE characters SET name='changed' WHERE id=?1",
            params![first.target_id],
        )
        .unwrap();
    assert!(adopt_with(&mut connection, request)
        .unwrap_err()
        .contains("REPLAY_CONFLICT"));
}

#[test]
fn legacy_adoption_two_sqlite_connections_commit_one_target() {
    use crate::services::setting_suggestion_adoption_service::adopt_with;
    use std::sync::{Arc, Barrier};
    let path =
        std::env::temp_dir().join(format!("setting-adoption-{}.sqlite", uuid::Uuid::new_v4()));
    let mut connection = Connection::open(&path).unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    crate::db::create_tables(&mut connection).unwrap();
    connection.execute("INSERT INTO novels(id,title,outline,created_at,updated_at) VALUES(?1,'test','','t','t')",params![NOVEL]).unwrap();
    let record = save_setting_suggestions_with(&mut connection, vec![input("parallel")])
        .unwrap()
        .remove(0);
    let request = adoption_request(&record, None);
    drop(connection);
    let barrier = Arc::new(Barrier::new(3));
    let handles = (0..2)
        .map(|_| {
            let path = path.clone();
            let barrier = barrier.clone();
            let request = request.clone();
            std::thread::spawn(move || {
                let mut connection = Connection::open(path).unwrap();
                connection
                    .busy_timeout(std::time::Duration::from_secs(5))
                    .unwrap();
                connection.execute_batch("PRAGMA foreign_keys=ON").unwrap();
                barrier.wait();
                adopt_with(&mut connection, request).unwrap()
            })
        })
        .collect::<Vec<_>>();
    barrier.wait();
    let results = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(results[0].target_id, results[1].target_id);
    assert_eq!(results.iter().filter(|result| result.replayed).count(), 1);
    let connection = Connection::open(&path).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM characters", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    drop(connection);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn legacy_adoption_rejects_changed_rules_scope_and_edited_hash() {
    use crate::services::setting_suggestion_adoption_service::adopt_with;
    let mut connection = connection();
    let record = save_setting_suggestions_with(&mut connection, vec![input("gates")])
        .unwrap()
        .remove(0);
    let mut request = adoption_request(&record, None);
    request.novel_id = "other".to_string();
    assert!(adopt_with(&mut connection, request).is_err());
    let mut request = adoption_request(
        &record,
        Some(Map::from_iter([("name".to_string(), json!("edited"))])),
    );
    request.authorized_item_hash = "wrong".to_string();
    assert!(adopt_with(&mut connection, request)
        .unwrap_err()
        .contains("ITEM_HASH_MISMATCH"));
    connection.execute("INSERT INTO rule_systems(id,novel_id,title,content,is_active,created_at,updated_at) VALUES('new-rule',?1,'rule','content',1,'t','t')",params![NOVEL]).unwrap();
    assert!(adopt_with(&mut connection, adoption_request(&record, None))
        .unwrap_err()
        .contains("RULE_SET_BASE_CONFLICT"));
    assert_eq!(
        get_setting_suggestion_with(&connection, &record.id)
            .unwrap()
            .unwrap()
            .status,
        "pending"
    );
}

#[test]
fn legacy_all_supported_setting_types_require_explicit_impact_confirmation() {
    use crate::services::{
        setting_suggestion_adoption_service as adoption,
        world_rule_governance::RuleChangeAuthorization,
    };
    for kind in ["rule", "faction", "location"] {
        let mut connection = connection();
        let mut candidate = input("candidate");
        candidate.suggestion_type = kind.to_string();
        candidate
            .item
            .insert("content".to_string(), json!("规则内容"));
        candidate
            .item
            .insert("forbiddenRules".to_string(), json!("不得免费施法"));
        let record = save_setting_suggestions_with(&mut connection, vec![candidate])
            .unwrap()
            .remove(0);
        let mut request = adoption_request(&record, None);
        let preview = adoption::preview_adoption(&connection, &request)
            .unwrap()
            .unwrap();
        assert!(adoption::adopt_with(&mut connection, request.clone()).is_err());
        request.expected_rule_set_fingerprint = Some(preview.rule_set_fingerprint);
        request.change_authorization = Some(RuleChangeAuthorization {
            preview_hash: preview.preview_hash,
            intent: "confirm_change".to_string(),
            notes: None,
        });
        let result = adoption::adopt_with(&mut connection, request.clone()).unwrap();
        assert_eq!(
            result.target_type,
            if kind == "rule" {
                "rule_system"
            } else {
                "world_setting"
            }
        );
        assert!(
            adoption::adopt_with(&mut connection, request)
                .unwrap()
                .replayed
        );
    }
}

#[test]
fn rejects_invalid_batches_without_partial_writes() {
    let mut connection = connection();
    let mut bad_type = input("丙");
    bad_type.suggestion_type = "weapon".to_string();
    let error =
        save_setting_suggestions_with(&mut connection, vec![input("甲"), bad_type]).unwrap_err();
    assert!(error.starts_with(SETTING_SUGGESTION_INVALID), "{error}");
    assert!(list_setting_suggestions_with(&connection, NOVEL)
        .unwrap()
        .is_empty());

    let mut foreign = input("丁");
    foreign.novel_id = "missing-novel".to_string();
    assert!(
        save_setting_suggestions_with(&mut connection, vec![foreign])
            .unwrap_err()
            .starts_with(SETTING_SUGGESTION_INVALID)
    );

    let saved = save_setting_suggestions_with(&mut connection, vec![input("戊")]).unwrap();
    let missing_target = decide_setting_suggestion_with(
        &connection,
        DecideSettingSuggestionInput {
            id: saved[0].id.clone(),
            status: "adopted".to_string(),
            item: None,
            adopted_target_id: None,
            adopted_target_type: Some("character".to_string()),
        },
    )
    .unwrap_err();
    assert!(
        missing_target.starts_with(SETTING_SUGGESTION_INVALID),
        "{missing_target}"
    );
    assert_eq!(
        get_setting_suggestion_with(&connection, &saved[0].id)
            .unwrap()
            .unwrap()
            .status,
        "pending"
    );
}
