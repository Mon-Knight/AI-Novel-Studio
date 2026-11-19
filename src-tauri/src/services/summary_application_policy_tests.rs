use super::*;

fn valid() -> Value {
    json!({"policyVersion":1,"passed":true,"score":88,"problems":[],"blockingIssues":[],
        "safeToContext":true,"semanticValidation":"not_checked","reviewRequirement":"none",
        "advisories":[{"code":"SUMMARY_SEMANTICS_REQUIRE_REVIEW","path":"/grounding","message":"语义未核验"}]})
}

fn check(value: &Value, mode: SummaryApplicationMode) -> SummaryApplicationPolicy {
    evaluate(Some(&value.to_string()), None, mode)
}

#[test]
fn high_score_and_human_flag_never_override_blocking_summary_errors() {
    for kind in ["character_error", "setting_error", "fabrication"] {
        let mut value = valid();
        value["passed"] = json!(false);
        value["score"] = json!(76);
        value["authorReviewed"] = json!(true);
        value["problems"] = json!([{"type":kind,"message":"阻断"}]);
        for mode in [
            SummaryApplicationMode::Context,
            SummaryApplicationMode::ManualReview,
            SummaryApplicationMode::TaskPreauthorization,
        ] {
            let result = check(&value, mode);
            assert!(!result.eligible);
            assert!(result.blocking);
            assert_eq!(
                result.stop_reason,
                Some("SUMMARY_BLOCKING_VALIDATION_ERROR")
            );
        }
    }
}

#[test]
fn semantic_unchecked_and_concrete_human_required_are_distinct() {
    let mut value = valid();
    assert!(check(&value, SummaryApplicationMode::TaskPreauthorization).eligible);
    value["reviewRequirement"] = json!("human_required");
    assert!(!check(&value, SummaryApplicationMode::Context).eligible);
    value["authorReviewed"] = json!(true);
    assert!(check(&value, SummaryApplicationMode::ManualReview).eligible);
    assert_eq!(
        check(&value, SummaryApplicationMode::TaskPreauthorization).stop_reason,
        Some("SUMMARY_HUMAN_REVIEW_REQUIRED")
    );
}

#[test]
fn legacy_manual_semantics_remain_readable_but_not_automatic() {
    let mut value = json!({"passed":false,"score":0,"safeToContext":true,"authorReviewed":true,
        "semanticValidation":"not_checked","evidenceValidation":"passed",
        "problems":[{"type":"speculation","message":"作者已审阅应用；未执行语义证明"}]});
    let result = evaluate(
        Some(&value.to_string()),
        Some("pending"),
        SummaryApplicationMode::Context,
    );
    assert!(result.eligible && result.legacy_manual_review);
    assert!(!check(&value, SummaryApplicationMode::TaskPreauthorization).eligible);
    value["problems"][0]["type"] = json!("character_error");
    assert!(!check(&value, SummaryApplicationMode::Context).eligible);
}

#[test]
fn automatic_receipts_cannot_claim_author_review_or_omit_grant() {
    let mut value = valid();
    value["applicationProvenance"] =
        json!({"mode":"task_preauthorization","authorizationId":"grant"});
    assert!(check(&value, SummaryApplicationMode::Context).eligible);
    value["authorReviewed"] = json!(true);
    assert_eq!(
        check(&value, SummaryApplicationMode::Context).stop_reason,
        Some("SUMMARY_VALIDATION_INVALID")
    );
    value["authorReviewed"] = json!(false);
    value["applicationProvenance"] = json!({"mode":"task_preauthorization"});
    assert!(!check(&value, SummaryApplicationMode::Context).eligible);
}

#[test]
fn malformed_unknown_and_failed_validation_fail_closed() {
    assert!(evaluate(None, None, SummaryApplicationMode::Context).eligible);
    assert!(!evaluate(None, None, SummaryApplicationMode::TaskPreauthorization).eligible);
    assert!(!evaluate(None, Some("failed"), SummaryApplicationMode::Context).eligible);
    for raw in ["not-json", "[]", "null", r#"{"passed":true}"#] {
        assert_eq!(
            evaluate(Some(raw), None, SummaryApplicationMode::Context).stop_reason,
            Some("SUMMARY_VALIDATION_INVALID")
        );
    }
    for (key, invalid) in [
        ("policyVersion", json!(2)),
        ("reviewRequirement", json!("model_approved")),
        ("groundingIssues", json!("not-an-array")),
        ("groundingIssues", json!([null])),
        ("semanticValidation", json!("passed")),
        ("applicationProvenance", Value::Null),
    ] {
        let mut value = valid();
        value[key] = invalid;
        assert!(!check(&value, SummaryApplicationMode::Context).eligible);
    }
}

#[test]
fn concrete_certainty_warning_stops_auto_but_actual_manual_review_is_allowed() {
    let source = "警员计划下周调取账册。";
    let payload = json!({"summary":"账册已调取。","characterChanges":[],"contextRecords":[],
        "grounding":{"version":1,"claims":[{"path":"/summary","status":"confirmed","quotes":[source]}]}});
    let mut validation = validate_summary(source, &payload, true);
    assert_eq!(validation["passed"], true);
    assert_eq!(validation["score"], 76);
    assert_eq!(validation["reviewRequirement"], "human_required");
    assert_eq!(
        check(&validation, SummaryApplicationMode::TaskPreauthorization).stop_reason,
        Some("SUMMARY_HUMAN_REVIEW_REQUIRED")
    );
    validation["authorReviewed"] = json!(true);
    validation["applicationProvenance"] = json!({"mode":"manual_review"});
    assert!(check(&validation, SummaryApplicationMode::ManualReview).eligible);
}

#[test]
fn concrete_fragment_warning_cannot_be_substituted_by_preauthorization() {
    let payload = json!({"summary":"她去过外省。","characterChanges":[],"contextRecords":[],
        "grounding":{"version":1,"claims":[{"path":"/summary","status":"confirmed","quotes":["去过外省"]}]}});
    let validation = validate_summary("她从未去过外省。", &payload, true);
    assert_eq!(validation["passed"], true);
    assert_eq!(validation["reviewRequirement"], "human_required");
    assert_eq!(
        check(&validation, SummaryApplicationMode::TaskPreauthorization).stop_reason,
        Some("SUMMARY_HUMAN_REVIEW_REQUIRED")
    );
}

#[test]
fn native_source_validation_reproduces_score76_but_keeps_context_unsafe() {
    let source = "唐棠收到一封旧信。";
    let mut payload = json!({"summary":source,"keyEvents":[source],"characterChanges":[
        {"characterName":"陌生角色","stateSummary":source}],"contextRecords":[]});
    let claims = summary_grounding::assertion_targets(&payload)
        .keys()
        .map(|path| json!({"path":path,"status":"confirmed","quotes":[source]}))
        .collect::<Vec<_>>();
    payload["grounding"] = json!({"version":1,"claims":claims});
    let result = validate_summary(source, &payload, true);
    assert_eq!(result["passed"], false);
    assert_eq!(result["score"], 76);
    assert_eq!(result["safeToContext"], false);
    assert_eq!(result["problems"][0]["type"], "character_error");
    assert_eq!(result["semanticValidation"], "not_checked");
    assert!(!check(&result, SummaryApplicationMode::ManualReview).eligible);
    assert!(!check(&result, SummaryApplicationMode::TaskPreauthorization).eligible);
}
