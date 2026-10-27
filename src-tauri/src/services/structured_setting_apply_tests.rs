// Setting-candidate parsing coverage; included by the structured apply service tests.

#[test]
fn setting_candidate_parser_keeps_same_name_world_and_rule_as_distinct_assets() {
    let candidates = super::setting_apply::parse_settings(&json!({
        "settings": [
            {"name":"雾城法则","description":"城市每夜删除一段记录"},
            {
                "name":"雾城法则",
                "targetType":"rule_system",
                "description":"已删除记录不得直接恢复"
            }
        ]
    }))
    .expect("world and rule namespaces must remain distinct");
    assert_eq!(candidates.len(), 2);
    assert!(candidates
        .iter()
        .any(|candidate| candidate.target == SettingTarget::World));
    assert!(candidates
        .iter()
        .any(|candidate| candidate.target == SettingTarget::Rule));

    assert_eq!(
        super::setting_apply::parse_settings(&json!({
            "settings": vec![json!({"name":"设定"}); MAX_ITEMS + 1]
        }))
        .err(),
        Some("TOO_MANY_CANDIDATES")
    );
}
