use super::*;
use rusqlite::Connection;

fn confirm(
    conn: &Connection,
    novel_id: &str,
    change: &RuleChange,
) -> (String, WorldRuleChangeAuthorizationInput) {
    let preview =
        world_rule_governance::preview_rule_change(conn, novel_id, &[change.clone()]).unwrap();
    (
        preview.rule_set_fingerprint,
        WorldRuleChangeAuthorizationInput {
            preview_hash: preview.preview_hash,
            intent: "confirm_change".to_string(),
            notes: None,
        },
    )
}
fn guarded_world_input(
    conn: &Connection,
    id: Option<&str>,
    mut input: SaveWorldSettingInput,
) -> SaveWorldSettingInput {
    let (fingerprint, authorization) = confirm(
        conn,
        &input.novel_id,
        &RuleChange {
            operation: None,
            target_type: "world_setting".to_string(),
            target_id: id.map(str::to_string),
            title: input.title.clone(),
            content: input.content.clone(),
            category: None,
            forbidden_rules: None,
            structured_json: input.structured_json.clone(),
            is_active: input.is_active,
        },
    );
    input.expected_rule_set_fingerprint = Some(fingerprint);
    input.change_authorization = Some(authorization);
    input.expected_updated_at = id
        .and_then(|id| world_setting_repository::find_world_setting_by_id(conn, id).unwrap())
        .map(|r| r.updated_at);
    input
}
// Existing CRUD scenarios now explicitly obtain preview-bound author authorization.
fn save_world_setting(
    conn: &Connection,
    id: Option<String>,
    input: SaveWorldSettingInput,
) -> Result<WorldSettingDto, String> {
    let input = guarded_world_input(conn, id.as_deref(), input);
    super::save_world_setting(conn, id, input)
}
fn save_rule_system(
    conn: &Connection,
    id: Option<String>,
    mut input: SaveRuleSystemInput,
) -> Result<RuleSystemDto, String> {
    let (fingerprint, authorization) = confirm(
        conn,
        &input.novel_id,
        &RuleChange {
            operation: None,
            target_type: "rule_system".to_string(),
            target_id: id.clone(),
            title: input.title.clone(),
            content: input.content.clone(),
            category: input.category.clone(),
            forbidden_rules: input.forbidden_rules.clone(),
            structured_json: input.structured_json.clone(),
            is_active: input.is_active,
        },
    );
    input.expected_rule_set_fingerprint = Some(fingerprint);
    input.change_authorization = Some(authorization);
    input.expected_updated_at = id
        .as_deref()
        .and_then(|id| world_setting_repository::find_rule_system_by_id(conn, id).unwrap())
        .map(|r| r.updated_at);
    super::save_rule_system(conn, id, input)
}
fn delete_rule_system(conn: &Connection, id: &str) -> Result<(), String> {
    let row = world_setting_repository::find_rule_system_by_id(conn, id)?.unwrap();
    let (fingerprint, authorization) = confirm(
        conn,
        &row.novel_id,
        &RuleChange {
            operation: Some("delete".to_string()),
            target_type: "rule_system".to_string(),
            target_id: Some(id.to_string()),
            title: row.title,
            content: row.content,
            category: row.category,
            forbidden_rules: row.forbidden_rules,
            structured_json: row.structured_json,
            is_active: row.is_active,
        },
    );
    super::delete_rule_system(
        conn,
        id,
        Some(DeleteRuleSystemInput {
            novel_id: row.novel_id,
            expected_updated_at: Some(row.updated_at),
            expected_rule_set_fingerprint: Some(fingerprint),
            change_authorization: Some(authorization),
        }),
    )
}

fn setup_test_db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    crate::db::create_tables(&mut conn).unwrap();
    conn.execute(
        "INSERT INTO novels (id, title, created_at, updated_at) VALUES ('novel-1', '测试小说', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        [],
    ).unwrap();
    conn
}

#[test]
fn test_world_setting_crud() {
    let conn = setup_test_db();
    let setting = save_world_setting(
        &conn,
        None,
        SaveWorldSettingInput {
            novel_id: "novel-1".to_string(),
            title: "灵气复苏背景".to_string(),
            content: "公元2040年，天地异变，灵气爆发。".to_string(),
            is_active: true,
            structured_json: None,
            expected_updated_at: None,
            expected_rule_set_fingerprint: None,
            change_authorization: None,
        },
    )
    .unwrap();

    assert_eq!(setting.title, "灵气复苏背景");
    assert!(setting.is_active);

    let list = list_world_settings_by_novel(&conn, "novel-1").unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, setting.id);

    let updated = save_world_setting(
        &conn,
        Some(setting.id.clone()),
        SaveWorldSettingInput {
            novel_id: "novel-1".to_string(),
            title: "灵气复苏新背景".to_string(),
            content: "公元2042年，大灾变之后。".to_string(),
            is_active: false,
            structured_json: None,
            expected_updated_at: None,
            expected_rule_set_fingerprint: None,
            change_authorization: None,
        },
    )
    .unwrap();

    assert_eq!(updated.title, "灵气复苏新背景");
    assert!(!updated.is_active);
}

#[test]
fn test_world_setting_list_prioritizes_latest_active_update() {
    let conn = setup_test_db();
    conn.execute_batch(
        "INSERT INTO world_settings
            (id, novel_id, title, content, is_active, created_at, updated_at)
         VALUES
            ('world-old', 'novel-1', '旧世界', '旧世界内容', 1,
             '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'),
            ('world-latest', 'novel-1', '最新世界', '最新世界内容', 1,
             '2026-01-03T00:00:00Z', '2026-01-04T00:00:00Z'),
            ('world-inactive', 'novel-1', '停用世界', '停用世界内容', 0,
             '2026-01-05T00:00:00Z', '2026-01-06T00:00:00Z');",
    )
    .unwrap();

    let list = list_world_settings_by_novel(&conn, "novel-1").unwrap();
    let ids = list
        .iter()
        .map(|setting| setting.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(ids, vec!["world-latest", "world-old", "world-inactive"]);
}

#[test]
fn test_rule_system_crud() {
    let conn = setup_test_db();
    let rule = save_rule_system(
        &conn,
        None,
        SaveRuleSystemInput {
            novel_id: "novel-1".to_string(),
            title: "九品修炼体系".to_string(),
            category: Some("power".to_string()),
            content: "一品练气，二品筑基，三品金丹。".to_string(),
            forbidden_rules: Some("不得越级击杀".to_string()),
            is_active: true,
            structured_json: None,
            expected_updated_at: None,
            expected_rule_set_fingerprint: None,
            change_authorization: None,
        },
    )
    .unwrap();

    assert_eq!(rule.title, "九品修炼体系");
    assert_eq!(rule.category.as_deref(), Some("power"));

    let list = list_rule_systems_by_novel(&conn, "novel-1").unwrap();
    assert_eq!(list.len(), 1);

    delete_rule_system(&conn, &rule.id).unwrap();
    let list_after = list_rule_systems_by_novel(&conn, "novel-1").unwrap();
    assert_eq!(list_after.len(), 0);
}

fn minimal_world_input() -> SaveWorldSettingInput {
    serde_json::from_value(serde_json::json!({"novelId":"novel-1", "title":"城市历史", "content":"河港自1970年起使用统一时刻。", "isActive":true})).unwrap()
}
#[test]
fn manual_rule_save_rejects_missing_authorization_and_changed_payload() {
    let conn = setup_test_db();
    assert!(super::save_world_setting(&conn, None, minimal_world_input()).is_err());
    let mut input = guarded_world_input(&conn, None, minimal_world_input());
    input.content = "预览后修改的正文".to_string();
    assert!(super::save_world_setting(&conn, None, input).is_err());
    assert!(list_world_settings_by_novel(&conn, "novel-1")
        .unwrap()
        .is_empty());
}
#[test]
fn manual_rule_metadata_failure_rolls_back_insert() {
    let conn = setup_test_db();
    let input = guarded_world_input(&conn, None, minimal_world_input());
    conn.execute_batch("CREATE TRIGGER fail_rule_metadata BEFORE UPDATE OF structured_json ON world_settings BEGIN SELECT RAISE(ABORT, 'test_failure'); END;").unwrap();
    assert!(super::save_world_setting(&conn, None, input).is_err());
    assert!(list_world_settings_by_novel(&conn, "novel-1")
        .unwrap()
        .is_empty());
}
#[test]
fn manual_rule_save_preserves_unknown_json_and_checks_record_scope() {
    let conn = setup_test_db();
    let saved = save_world_setting(&conn, None, minimal_world_input()).unwrap();
    let legacy = r#"{"legacy_world":{"calendar":"旧历"},"schemaVersion":88}"#;
    conn.execute(
        "UPDATE world_settings SET structured_json=?1 WHERE id=?2",
        params![legacy, saved.id],
    )
    .unwrap();
    let mut changed = minimal_world_input();
    changed.structured_json = Some(legacy.to_string());
    let changed = guarded_world_input(&conn, Some(&saved.id), changed);
    let updated = super::save_world_setting(&conn, Some(saved.id.clone()), changed).unwrap();
    assert_eq!(updated.structured_json.as_deref(), Some(legacy));
    let mut stale = guarded_world_input(&conn, Some(&saved.id), minimal_world_input());
    stale.expected_updated_at = Some("stale".to_string());
    assert!(
        super::save_world_setting(&conn, Some(saved.id.clone()), stale)
            .unwrap_err()
            .contains("RULE_RECORD_BASE_CONFLICT")
    );
    let mut other = minimal_world_input();
    other.novel_id = "another-book".to_string();
    other.expected_updated_at = Some(updated.updated_at);
    assert!(super::save_world_setting(&conn, Some(saved.id), other)
        .unwrap_err()
        .contains("RULE_SET_SCOPE_MISMATCH"));
}

#[test]
fn test_protagonist_crud() {
    let conn = setup_test_db();
    let protag = save_protagonist(
        &conn,
        None,
        SaveProtagonistInput {
            novel_id: "novel-1".to_string(),
            name: "叶凡".to_string(),
            identity: Some("荒古圣体".to_string()),
            personality: Some("坚毅果敢".to_string()),
            goal: Some("成仙".to_string()),
            special_ability: Some("皆字秘".to_string()),
            ability_limits: Some("触发概率低".to_string()),
            forbidden_behaviors: Some("背叛同伴".to_string()),
            current_state: Some("初始练气期".to_string()),
        },
    )
    .unwrap();

    assert_eq!(protag.name, "叶凡");

    let fetched = get_protagonist_by_novel(&conn, "novel-1").unwrap().unwrap();
    assert_eq!(fetched.name, "叶凡");
    assert_eq!(fetched.identity.as_deref(), Some("荒古圣体"));
}
