use serde_json::json;

#[test]
fn native_rule_set_freezes_before_request_and_rejects_stale_read_projection_without_changing_replay(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = connection()?;
    let novel = "00000000-0000-4000-8000-000000001234";
    connection.execute("INSERT INTO novels(id,title,outline,created_at,updated_at) VALUES(?1,'native rule test','','t','t')",params![novel])?;
    let initial = crate::services::world_rule_governance::rule_set_snapshot(&connection, novel)?;
    let mut input = formal_setting_task_input("native-rule-freeze", novel);
    input.target_hint_json = Some(
        json!({"expectedRuleSetFingerprint":initial.fingerprint,"revisionSource":{"artifactId":"preserved-source"}}),
    );
    let created = create_task(&mut connection, input.clone())?;
    assert_eq!(
        created.target_hint_json.as_ref().unwrap()["nativeRuleSet"],
        json!(initial)
    );
    assert_eq!(
        created.target_hint_json.as_ref().unwrap()["revisionSource"]["artifactId"],
        "preserved-source"
    );
    get_task_detail(&connection, &created.task_id)?; // persisted request hash covers nativeRuleSet
    connection.execute("INSERT INTO rule_systems(id,novel_id,title,content,is_active,created_at,updated_at) VALUES('new-rule',?1,'law','changed after read',1,'t','t')",params![novel])?;
    let replay = create_task(&mut connection, input.clone())?;
    assert_eq!(replay.task_id, created.task_id);
    assert_eq!(replay.target_hint_json, created.target_hint_json);
    input.operation_id = "native-rule-stale-new-projection".to_string();
    assert_eq!(
        create_task(&mut connection, input.clone())
            .unwrap_err()
            .code,
        "RULE_SET_BASE_CONFLICT"
    );
    input.target_hint_json.as_mut().unwrap()["nativeRuleSet"] = json!(initial);
    assert_eq!(
        create_task(&mut connection, input).unwrap_err().code,
        codes::AI_TASK_INPUT_INVALID
    );
    Ok(())
}
