use super::*;
use serde_json::json;

fn issue_codes(issues: &[CoverageIssue]) -> Vec<&str> {
    issues.iter().map(|issue| issue.code).collect()
}

#[test]
fn legacy_candidates_without_the_marker_keep_the_previous_contract() {
    assert!(!required_by_snapshot(None));
    assert!(!required_by_snapshot(Some(&json!({}))));
    assert!(!required_by_snapshot(Some(
        &json!({"summaryCoverageVersion": 2})
    )));
    assert!(required_by_snapshot(Some(
        &json!({"summaryCoverageVersion": 1})
    )));
    assert!(validate(&json!({"summary": "旧候选"}), false, Depth::Complete).is_empty());
}

#[test]
fn missing_fields_are_not_the_same_as_explicit_empty_arrays() {
    let explicit = json!({"characterChanges": [], "contextRecords": []});
    assert!(validate(&explicit, true, Depth::Complete).is_empty());

    let missing = validate(&json!({}), true, Depth::Complete);
    let codes = issue_codes(&missing);
    assert!(codes.contains(&"SUMMARY_CHARACTER_CHANGES_MISSING"));
    assert!(codes.contains(&"SUMMARY_CONTEXT_RECORDS_MISSING"));
}

#[test]
fn presence_admission_defers_item_checks_to_apply() {
    let payload = json!({
        "characterChanges": [{}],
        "contextRecords": [{}]
    });
    assert!(validate(&payload, true, Depth::Presence).is_empty());
    let complete = validate(&payload, true, Depth::Complete);
    let codes = issue_codes(&complete);
    assert!(codes.contains(&"SUMMARY_CHARACTER_CHANGES_INCOMPLETE"));
    assert!(codes.contains(&"SUMMARY_CONTEXT_RECORDS_INCOMPLETE"));
}

#[test]
fn descriptive_legacy_fields_do_not_create_coverage_errors() {
    // These are not state-write sources under the new contract. Their text may be
    // non-empty (for example "无明显变化") without contradicting an explicit empty array.
    for payload in [
        json!({
            "characterChanges": [],
            "contextRecords": [],
            "importantCharacterChanges": [{"name": "林夏", "change": "无明显变化"}]
        }),
        json!({
            "characterChanges": [],
            "contextRecords": [],
            "protagonistStateChange": "无明显变化"
        }),
    ] {
        assert!(validate(&payload, true, Depth::Complete).is_empty());
    }
}

#[test]
fn item_shapes_must_match_what_the_transaction_consumes() {
    let invalid = json!({
        "characterChanges": [{"characterName": "林夏", "stateSummary": "   "}],
        "contextRecords": [{"title": "航线", "content": ""}]
    });
    let invalid_issues = validate(&invalid, true, Depth::Complete);
    let codes = issue_codes(&invalid_issues);
    assert!(codes.contains(&"SUMMARY_CHARACTER_CHANGES_INCOMPLETE"));
    assert!(codes.contains(&"SUMMARY_CONTEXT_RECORDS_INCOMPLETE"));

    let wrong_type = json!({"characterChanges": {}, "contextRecords": []});
    let wrong_type_issues = validate(&wrong_type, true, Depth::Complete);
    let codes = issue_codes(&wrong_type_issues);
    assert!(codes.contains(&"SUMMARY_CHARACTER_CHANGES_INVALID_TYPE"));
}
