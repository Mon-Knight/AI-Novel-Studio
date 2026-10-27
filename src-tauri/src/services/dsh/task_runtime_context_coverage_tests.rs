use super::*;
use serde_json::json;

fn row(id: &str, content: &str, rule: bool) -> Value {
    let mut value = json!({
        "id":id,"novelId":"novel-a","title":format!("设定 {}",id),"content":content,
        "structuredJson":null,"isActive":true,"createdAt":"2026-01-01","updatedAt":"2026-01-02"
    });
    if rule {
        value["category"] = json!("social");
        value["forbiddenRules"] = Value::Null;
    }
    value
}

fn section(projection: &Value, fingerprint: &str, limit: u64) -> Value {
    let text = serde_json::to_string(projection).unwrap();
    let count = projection.as_array().map(|items| items.len() as u64)
        .unwrap_or_else(|| u64::from(!projection.is_null()));
    let ids = projection.as_array().map(|items| items.iter().map(|item| item["id"].clone()).collect::<Vec<_>>()).unwrap_or_default();
    json!({"status":"complete","requiredCount":count,"includedCount":count,"sourceIds":ids,
        "projectionHash":large_text_repository::sha256(&text),"ruleSetFingerprint":fingerprint,
        "requiredBytes":text.len(),"projectedBytes":text.len(),"maxBytes":limit,"semanticValidation":"not_checked"})
}

fn fixture(world: Vec<Value>, rules: Vec<Value>) -> (Value, RuleSetSnapshot) {
    let snapshot: RuleSetSnapshot = serde_json::from_value(
        crate::services::world_rule_governance::fingerprint::snapshot_from_records("novel-a", &world, &rules)
    ).unwrap();
    let worlds = json!(world);
    let rules = json!(rules);
    let payload = json!({"ok":true,"data":{
        "worldSettings":worlds,"ruleSystems":rules,
        "contextCoverage":{"schemaVersion":"writing_context_coverage_v1","novelId":"novel-a",
            "worldSettings":section(&worlds,&snapshot.fingerprint,MATERIAL_LIMIT_BYTES),
            "ruleSystems":section(&rules,&snapshot.fingerprint,MATERIAL_LIMIT_BYTES)}
    }});
    (payload,snapshot)
}

fn validate(payload: &Value, snapshot: &RuleSetSnapshot) -> Result<(), AppError> {
    let coverage = scope_coverage(payload,"novel-a")?;
    validate_material_projection(payload,"novel-a",coverage,snapshot,"worldSettings","world_setting")?;
    validate_material_projection(payload,"novel-a",coverage,snapshot,"ruleSystems","rule_system")
}

fn rehash(payload: &mut Value, name: &str, snapshot: &RuleSetSnapshot) {
    let replacement = section(&payload["data"][name], &snapshot.fingerprint, MATERIAL_LIMIT_BYTES);
    payload["data"]["contextCoverage"][name] = replacement;
}

#[test]
fn empty_initial_world_is_complete_material_not_a_semantic_verdict() {
    let (payload,snapshot) = fixture(vec![],vec![]);
    validate(&payload,&snapshot).unwrap();
    assert_eq!(payload["data"]["contextCoverage"]["ruleSystems"]["semanticValidation"],"not_checked");
}

#[test]
fn all_twelve_rules_and_long_forbidden_tail_reach_the_verifier() {
    let mut rules = (0..12).map(|index| row(&format!("rule-{index:02}"),"明确规则",true)).collect::<Vec<_>>();
    rules[9]["forbiddenRules"] = json!(format!("{}关键禁止事项", "前置说明".repeat(450)));
    let world = vec![row("world-z","较新背景",false),row("world-a","较早背景",false)];
    let (payload,snapshot) = fixture(world,rules);
    validate(&payload,&snapshot).unwrap();
    assert_eq!(payload["data"]["contextCoverage"]["ruleSystems"]["includedCount"],12);
}

#[test]
fn a_rehashed_but_missing_rule_still_fails_native_source_coverage() {
    let (mut payload,snapshot) = fixture(vec![],vec![row("a","一",true),row("b","二",true)]);
    payload["data"]["ruleSystems"].as_array_mut().unwrap().pop();
    rehash(&mut payload,"ruleSystems",&snapshot);
    assert!(validate(&payload,&snapshot).is_err());
}

#[test]
fn a_rehashed_changed_body_cannot_borrow_a_valid_rule_fingerprint() {
    let (mut payload,snapshot) = fixture(vec![],vec![row("a","不能凭空恢复资源",true)]);
    payload["data"]["ruleSystems"][0]["content"] = json!("可以无限恢复资源");
    rehash(&mut payload,"ruleSystems",&snapshot);
    assert!(validate(&payload,&snapshot).is_err());
}

#[test]
fn null_forbidden_text_is_not_interchangeable_with_empty_text() {
    let (mut payload,snapshot) = fixture(vec![],vec![row("a","规则",true)]);
    payload["data"]["ruleSystems"][0]["forbiddenRules"] = json!("");
    rehash(&mut payload,"ruleSystems",&snapshot);
    assert!(validate(&payload,&snapshot).is_err());
}

#[test]
fn structured_source_json_must_remain_the_exact_original_material() {
    let mut rule = row("a","限制",true);
    rule["structuredJson"] = json!("{ \"unknownVersion\": true }");
    let (mut payload,snapshot) = fixture(vec![],vec![rule]);
    validate(&payload,&snapshot).unwrap();
    payload["data"]["ruleSystems"][0]["structuredJson"] = json!({"unknownVersion":true});
    rehash(&mut payload,"ruleSystems",&snapshot);
    assert!(validate(&payload,&snapshot).is_err());
}

#[test]
fn duplicate_or_foreign_source_ids_fail_even_with_matching_counts() {
    let (mut payload,snapshot) = fixture(vec![],vec![row("a","一",true),row("b","二",true)]);
    payload["data"]["ruleSystems"][1] = payload["data"]["ruleSystems"][0].clone();
    rehash(&mut payload,"ruleSystems",&snapshot);
    assert!(validate(&payload,&snapshot).is_err());
    let (mut payload,snapshot) = fixture(vec![row("w","背景",false)],vec![]);
    payload["data"]["worldSettings"][0]["novelId"] = json!("another-novel");
    rehash(&mut payload,"worldSettings",&snapshot);
    assert!(validate(&payload,&snapshot).is_err());
}

#[test]
fn stale_rule_set_and_wrong_protocol_or_scope_fail_closed() {
    let (payload,snapshot) = fixture(vec![],vec![row("a","一",true)]);
    for (key,value) in [("schemaVersion","unknown-v2"),("novelId","another-novel")] {
        let mut changed = payload.clone();
        changed["data"]["contextCoverage"][key] = json!(value);
        assert!(validate(&changed,&snapshot).is_err());
    }
    let mut changed = payload;
    changed["data"]["contextCoverage"]["ruleSystems"]["ruleSetFingerprint"] = json!("0".repeat(64));
    assert!(validate(&changed,&snapshot).is_err());
}

#[test]
fn incomplete_world_is_not_masked_by_complete_rules() {
    let (mut payload,snapshot) = fixture(vec![row("w","背景",false)],vec![row("a","规则",true)]);
    payload["data"]["contextCoverage"]["worldSettings"]["status"] = json!("context_incomplete");
    assert!(validate(&payload,&snapshot).is_err());
}

#[test]
fn forged_byte_limits_and_semantic_pass_do_not_satisfy_coverage() {
    let (payload,snapshot) = fixture(vec![],vec![row("a","规则",true)]);
    for (key,value) in [("projectedBytes",json!(1)),("maxBytes",json!(999999)),("semanticValidation",json!("passed")),("projectionHash",json!("0".repeat(64)))] {
        let mut changed = payload.clone();
        changed["data"]["contextCoverage"]["ruleSystems"][key] = value;
        assert!(validate(&changed,&snapshot).is_err(),"{key}");
    }
    let (payload,snapshot) = fixture(vec![],vec![row("huge",&"规".repeat(50000),true)]);
    assert!(validate(&payload,&snapshot).is_err());
}

#[test]
fn engineering_allows_explicit_absence_and_verifies_complete_json() {
    let projection = Value::Null;
    validate_size_and_hash(&section(&projection,"",ENGINEERING_LIMIT_BYTES),&projection,0,ENGINEERING_LIMIT_BYTES).unwrap();
    let projection = json!({"chapterId":"chapter-a","chapterCard":{"viewpointCharacter":"限知视角","knownInformation":["已知"],"unknownInformation":["不可提前获知"]}});
    let coverage = section(&projection,"",ENGINEERING_LIMIT_BYTES);
    validate_size_and_hash(&coverage,&projection,1,ENGINEERING_LIMIT_BYTES).unwrap();
    let mut changed = projection.clone();
    changed["chapterCard"]["unknownInformation"] = json!([]);
    assert!(validate_size_and_hash(&coverage,&changed,1,ENGINEERING_LIMIT_BYTES).is_err());
}
