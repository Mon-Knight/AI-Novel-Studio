use super::*;
use crate::domain::world::CreateCharacterInput;
use crate::services::character_asset_service::create_character;

fn setup() -> (Connection, SaveCharacterProfileInput) {
    let mut conn = Connection::open_in_memory().unwrap();
    crate::db::create_tables(&mut conn).unwrap();
    for id in ["novel-a", "novel-b"] {
        conn.execute(
            "INSERT INTO novels(id,title,created_at,updated_at) VALUES(?1,'测试作品','before','before')",
            [id],
        ).unwrap();
    }
    let character = create_character(
        &conn,
        CreateCharacterInput {
            novel_id: "novel-a".into(),
            name: "人物甲".into(),
            role_type: Some("supporting".into()),
            identity: Some("记录员".into()),
            faction: Some("档案馆".into()),
            relation_to_protagonist: Some("同事".into()),
            goal: Some("整理档案".into()),
            personality: Some("谨慎".into()),
            behavior_limits: Some("旧边界".into()),
            forbidden_behaviors: Some("不得毁损原件".into()),
            current_state: Some("正在调查".into()),
            is_protagonist: false,
        },
    )
    .unwrap();
    conn.execute(
        "UPDATE characters SET ability='独立能力',background='保留背景',source_type='fixture-source' WHERE id=?1",
        [&character.id],
    ).unwrap();
    let input = SaveCharacterProfileInput {
        novel_id: character.novel_id,
        character_id: character.id,
        expected_updated_at: character.updated_at,
        expected_source: character.source,
        name: "人物甲".into(),
        role_type: "supporting".into(),
        identity: "记录员".into(),
        faction: "档案馆".into(),
        relation_to_protagonist: "同事".into(),
        goal: "整理档案".into(),
        personality: "谨慎".into(),
        behavior_limits: "新边界".into(),
        forbidden_behaviors: "不得毁损原件".into(),
    };
    (conn, input)
}

fn row_snapshot(conn: &Connection, id: &str) -> Vec<rusqlite::types::Value> {
    let mut statement = conn
        .prepare("SELECT * FROM characters WHERE id=?1")
        .unwrap();
    let columns = statement.column_count();
    statement
        .query_row([id], |row| (0..columns).map(|i| row.get(i)).collect())
        .unwrap()
}

#[test]
fn guarded_save_updates_existing_profile_and_preserves_other_fields() {
    let (mut conn, input) = setup();
    let saved = save_character_profile(&mut conn, input.clone()).unwrap();
    assert_eq!(saved.id, input.character_id);
    assert_eq!(saved.behavior_limits.as_deref(), Some("新边界"));
    assert_eq!(saved.current_state.as_deref(), Some("正在调查"));
    assert_eq!(saved.protagonist_key, None);
    assert!(!saved.is_protagonist);
    assert_eq!(saved.source, input.expected_source);
    assert_ne!(saved.updated_at, input.expected_updated_at);
    let other: (String, String, String, i64) = conn.query_row(
        "SELECT ability,background,source_type,(SELECT COUNT(*) FROM characters) FROM characters WHERE id=?1",
        [&saved.id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)),
    ).unwrap();
    assert_eq!(
        other,
        (
            "独立能力".into(),
            "保留背景".into(),
            "fixture-source".into(),
            1
        )
    );
}

#[test]
fn stale_updated_at_or_changed_source_cannot_overwrite() {
    for mutation in ["updated_at='new-version'", "source='new-source'"] {
        let (mut conn, input) = setup();
        conn.execute(
            &format!("UPDATE characters SET {mutation} WHERE id=?1"),
            [&input.character_id],
        )
        .unwrap();
        let before = row_snapshot(&conn, &input.character_id);
        assert!(save_character_profile(&mut conn, input.clone())
            .unwrap_err()
            .starts_with("CHARACTER_PROFILE_CONFLICT"));
        assert_eq!(row_snapshot(&conn, &input.character_id), before);
    }
}

#[test]
fn wrong_project_or_deleted_project_cannot_update() {
    for deleted in [false, true] {
        let (mut conn, mut input) = setup();
        if deleted {
            conn.execute(
                "UPDATE novels SET deleted_at='deleted' WHERE id='novel-a'",
                [],
            )
            .unwrap();
        } else {
            input.novel_id = "novel-b".into();
        }
        let before = row_snapshot(&conn, &input.character_id);
        assert!(save_character_profile(&mut conn, input.clone())
            .unwrap_err()
            .starts_with("CHARACTER_PROFILE_CONFLICT"));
        assert_eq!(row_snapshot(&conn, &input.character_id), before);
    }
}

#[test]
fn inactive_or_removed_character_cannot_be_resurrected() {
    for remove in [false, true] {
        let (mut conn, input) = setup();
        conn.execute(
            if remove {
                "DELETE FROM characters WHERE id=?1"
            } else {
                "UPDATE characters SET is_active=0 WHERE id=?1"
            },
            [&input.character_id],
        )
        .unwrap();
        assert!(save_character_profile(&mut conn, input.clone())
            .unwrap_err()
            .starts_with("CHARACTER_PROFILE_CONFLICT"));
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM characters WHERE is_active=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }
}

#[test]
fn edited_fields_can_be_cleared_without_coalesce_restoring_old_text() {
    let (mut conn, mut input) = setup();
    input.name = " 人物乙 ".into();
    input.role_type = "neutral".into();
    input.identity.clear();
    input.faction.clear();
    input.relation_to_protagonist.clear();
    input.goal.clear();
    input.personality.clear();
    input.behavior_limits.clear();
    input.forbidden_behaviors.clear();
    let saved = save_character_profile(&mut conn, input).unwrap();
    assert_eq!(saved.name, "人物乙");
    assert_eq!(saved.role_type.as_deref(), Some("neutral"));
    assert_eq!(
        [
            saved.identity,
            saved.faction,
            saved.relation_to_protagonist,
            saved.goal,
            saved.personality,
            saved.behavior_limits,
            saved.forbidden_behaviors
        ],
        [
            Some(String::new()),
            Some(String::new()),
            Some(String::new()),
            Some(String::new()),
            Some(String::new()),
            Some(String::new()),
            Some(String::new())
        ]
    );
}

#[test]
fn invalid_fields_fail_without_changing_row() {
    let (mut conn, mut input) = setup();
    let before = row_snapshot(&conn, &input.character_id);
    input.name = "  ".into();
    assert!(save_character_profile(&mut conn, input.clone())
        .unwrap_err()
        .starts_with("CHARACTER_PROFILE_INVALID"));
    input.name = "人物".into();
    input.role_type = "unknown".into();
    assert!(save_character_profile(&mut conn, input.clone())
        .unwrap_err()
        .starts_with("CHARACTER_PROFILE_INVALID"));
    assert_eq!(row_snapshot(&conn, &input.character_id), before);
}

#[test]
fn readback_failure_rolls_back_entire_profile_update() {
    let (mut conn, input) = setup();
    conn.execute_batch("CREATE TRIGGER remove_character_after_profile AFTER UPDATE OF behavior_limits ON characters BEGIN DELETE FROM characters WHERE id=NEW.id; END;").unwrap();
    let before = row_snapshot(&conn, &input.character_id);
    assert!(save_character_profile(&mut conn, input.clone()).is_err());
    assert_eq!(row_snapshot(&conn, &input.character_id), before);
}

#[test]
fn role_changes_keep_protagonist_flag_consistent_without_inventing_bindings() {
    let (mut conn, mut input) = setup();
    input.role_type = "protagonist".into();
    let promoted = save_character_profile(&mut conn, input.clone()).unwrap();
    assert!(promoted.is_protagonist);
    assert_eq!(promoted.protagonist_key, None);
    input.expected_updated_at = promoted.updated_at;
    input.role_type = "supporting".into();
    let demoted = save_character_profile(&mut conn, input).unwrap();
    assert!(!demoted.is_protagonist);
    assert_eq!(demoted.protagonist_key, None);
}

#[test]
fn bound_protagonist_cannot_be_demoted_but_can_edit_profile() {
    let (mut conn, mut input) = setup();
    conn.execute("UPDATE characters SET role_type='protagonist',is_protagonist=1,protagonist_key='bound',protagonist_label='主角一' WHERE id=?1", [&input.character_id]).unwrap();
    let before = row_snapshot(&conn, &input.character_id);
    assert!(save_character_profile(&mut conn, input.clone())
        .unwrap_err()
        .starts_with("CHARACTER_PROFILE_BOUND_ROLE"));
    assert_eq!(row_snapshot(&conn, &input.character_id), before);
    input.role_type = "protagonist".into();
    let saved = save_character_profile(&mut conn, input).unwrap();
    assert!(saved.is_protagonist);
    assert_eq!(saved.protagonist_key.as_deref(), Some("bound"));
    assert_eq!(saved.protagonist_label.as_deref(), Some("主角一"));
    assert_eq!(saved.behavior_limits.as_deref(), Some("新边界"));
}
