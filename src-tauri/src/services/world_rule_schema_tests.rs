use super::*;
use serde_json::json;
fn document() -> Value {
    json!({"schemaVersion":1,"contract":"world_rules_v1","identity":{"id":"rule-1","revision":1},
        "kind":"social_norm","authority":"confirmed","strength":"hard","statement":"夜间不得排水",
        "conditions":["生产期间"],"scope":{"summary":"河港","chapterIds":[],"places":["河港"],"groups":["工厂"],"characters":[]},
        "chronology":{"effectiveFrom":"故事第一日","effectiveUntil":"N/A","revealAt":"第四章"},
        "epistemic":{"status":"belief","knownBy":["巡查员"],"learnedAt":"第一章","evidence":"公示条例"},
        "boundaries":{"limitations":"消防例外另行确认","cost":"罚款","ceiling":"N/A"},"exceptions":[],
        "provenance":{"origin":"user","sourceRefs":[]},"dependencies":[],
        "worldParameters":{"time_history":"近现代","economy_resources":"缺水","technology_infrastructure":"N/A"}})
}
#[test]
fn world_rule_schema_keeps_authority_knowledge_and_strength_separate() {
    let value = document();
    assert!(valid_document(&value));
    validate_world_rule_document(Some(&value.to_string())).unwrap();
    assert!(validate_metadata(Some(&value.to_string()), None, None).is_err());
    validate_metadata(Some(&value.to_string()), None, Some("confirm_change")).unwrap();
}
#[test]
fn world_rule_schema_rejects_revision_and_unapproved_exception_changes() {
    let old = document();
    let mut next = old.clone();
    next["statement"] = json!("修改条例");
    assert!(validate_metadata(
        Some(&next.to_string()),
        Some(&old.to_string()),
        Some("confirm_change")
    )
    .is_err());
    next["identity"] = json!({"id":"rule-1","revision":2,"supersedesRevision":1});
    next["exceptions"] = json!([{"condition":"消防抢险期间","effect":"允许受控排水","reason":"保护生命","approval":"author_approved"}]);
    assert!(validate_metadata(
        Some(&next.to_string()),
        Some(&old.to_string()),
        Some("confirm_change")
    )
    .is_err());
    validate_metadata(
        Some(&next.to_string()),
        Some(&old.to_string()),
        Some("approve_exception"),
    )
    .unwrap();
}
#[test]
fn world_rule_schema_preserves_opaque_legacy_material_without_claiming_v1_validity() {
    let raw = r#"{"schemaVersion":99,"calendar":"旧历"}"#;
    assert!(!valid_document(&serde_json::from_str(raw).unwrap()));
    validate_world_rule_document(Some(raw)).unwrap();
    validate_metadata(Some(raw), Some(raw), Some("confirm_change")).unwrap();
    assert!(validate_metadata(Some(raw), None, Some("confirm_change")).is_err());
}
