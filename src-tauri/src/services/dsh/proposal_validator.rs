//! Rust-authoritative proposal validator (design doc §6.3) with planner-enum
//! coercion — the Gate 1 hardening from the spike, ported to Rust.
//!
//! Rules: schemaVersion 1; planner enum (unique near-neighbour coercion,
//! recorded in metrics.plannerCoerced, never silent); targetChapter matches the
//! input; baselineRevisions echoed verbatim; retrievedEvidence revisions equal
//! the baseline; recommendedActions restricted to read_tool/ask_user (any write
//! action rejects the whole proposal); field/whole-document size caps.

use serde_json::Value;

use super::models::ChapterPreparationInput;

pub const PROPOSAL_SOURCES: [&str; 6] = [
    "outline",
    "chapter_context",
    "style_profile",
    "output_control",
    "character_states",
    "memory_index",
];
pub const PLANNERS: [&str; 2] = ["current_chapter_readiness_v1", "dsh_spike_v0"];
pub const ACTION_TYPES: [&str; 2] = ["read_tool", "ask_user"];
pub const SEVERITIES: [&str; 3] = ["low", "medium", "high"];

const PROPOSAL_KEYS: [&str; 13] = [
    "schemaVersion",
    "planner",
    "targetChapter",
    "baselineRevisions",
    "retrievedEvidence",
    "chapterGoals",
    "scenePlan",
    "characterConstraints",
    "continuityRisks",
    "unresolvedQuestions",
    "recommendedActions",
    "producedAt",
    "metrics",
];
const FIELD_MAX_CHARS: usize = 12_000;
const MAX_PROPOSAL_BYTES: usize = 2 * 1024 * 1024;
const COERCION_MAX_DISTANCE: usize = 2;

#[derive(Debug, Clone, PartialEq)]
pub struct PlannerCoercion {
    pub original: String,
    pub distance: usize,
}

#[derive(Debug)]
pub struct ValidationReport {
    pub valid: bool,
    pub errors: Vec<String>,
    /// Set when a near-miss planner enum was normalized.
    pub coerced: Option<PlannerCoercion>,
}

fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut current = vec![i];
        for j in 1..=b.len() {
            current.push(
                (previous[j] + 1)
                    .min(current[j - 1] + 1)
                    .min(previous[j - 1] + usize::from(a[i - 1] != b[j - 1])),
            );
        }
        previous = current;
    }
    previous[b.len()]
}

/// Normalizes a planner enum value: exact match, or unique near-neighbour
/// (distance <= COERCION_MAX_DISTANCE, no tie). None = leave to validation.
pub fn coerce_planner(raw: Option<&str>) -> Option<(String, Option<PlannerCoercion>)> {
    let value = raw?.trim();
    if PLANNERS.contains(&value) {
        return Some((value.to_string(), None));
    }
    let lower = value.to_ascii_lowercase();
    let mut scored: Vec<(usize, &str)> = PLANNERS
        .iter()
        .map(|planner| (levenshtein(&lower, &planner.to_ascii_lowercase()), *planner))
        .collect();
    scored.sort_by_key(|(distance, _)| *distance);
    if scored[0].0 > COERCION_MAX_DISTANCE {
        return None;
    }
    if scored.len() > 1 && scored[1].0 == scored[0].0 {
        return None;
    }
    Some((
        scored[0].1.to_string(),
        Some(PlannerCoercion {
            original: value.to_string(),
            distance: scored[0].0,
        }),
    ))
}

fn is_non_empty_string(value: &Value) -> bool {
    value.as_str().map(|text| !text.trim().is_empty()).unwrap_or(false)
}

fn has_keys(object: &Value, allowed: &[&str], required: &[&str]) -> bool {
    let Some(map) = object.as_object() else {
        return false;
    };
    if !map.keys().all(|key| allowed.contains(&key.as_str())) {
        return false;
    }
    required.iter().all(|key| map.contains_key(*key))
}

fn field_len_ok(value: &Value) -> bool {
    value
        .as_str()
        .map(|text| text.chars().count() <= FIELD_MAX_CHARS)
        .unwrap_or(true)
}

/// Validates (and possibly normalizes) a proposal Value against the input.
pub fn validate(input: &ChapterPreparationInput, proposal: &mut Value) -> ValidationReport {
    let mut errors = Vec::new();
    let mut coerced = None;

    let Some(object) = proposal.as_object() else {
        return ValidationReport {
            valid: false,
            errors: vec!["proposal is not an object".to_string()],
            coerced: None,
        };
    };
    if object.len() != PROPOSAL_KEYS.len() || !PROPOSAL_KEYS.iter().all(|key| object.contains_key(*key)) {
        errors.push(format!(
            "top-level keys must be exactly: {}",
            PROPOSAL_KEYS.join(", ")
        ));
    }
    if let Some(size) = serde_json::to_string(proposal).ok().map(|text| text.len()) {
        if size > MAX_PROPOSAL_BYTES {
            errors.push("proposal exceeds 2 MiB cap".to_string());
        }
    }
    if proposal.get("schemaVersion").and_then(Value::as_i64) != Some(1) {
        errors.push("schemaVersion must be 1".to_string());
    }

    // Planner enum with coercion.
    match coerce_planner(proposal.get("planner").and_then(Value::as_str)) {
        Some((planner, coercion)) => {
            if let Some(coercion) = coercion {
                if let Some(metrics) = proposal.get_mut("metrics").and_then(Value::as_object_mut) {
                    metrics.insert(
                        "plannerCoerced".to_string(),
                        serde_json::json!({
                            "original": coercion.original,
                            "distance": coercion.distance,
                        }),
                    );
                }
                coerced = Some(coercion);
            }
            if let Some(slot) = proposal.get_mut("planner") {
                *slot = Value::String(planner);
            }
        }
        None => {
            errors.push(format!(
                "planner must be one of {}",
                PLANNERS.join("|")
            ));
        }
    }

    if let Some(target) = proposal.get("targetChapter") {
        let novel_ok = target.get("novelId").and_then(Value::as_str) == Some(input.novel_id.as_str());
        let chapter_ok = target.get("chapterId").and_then(Value::as_str) == Some(input.chapter_id.as_str());
        if !novel_ok || !chapter_ok {
            errors.push("targetChapter must match the input novel/chapter ids".to_string());
        }
    } else {
        errors.push("targetChapter missing".to_string());
    }

    let input_revisions: std::collections::HashMap<&str, i64> = input
        .baseline_revisions
        .iter()
        .map(|entry| (entry.source.as_str(), entry.revision))
        .collect();
    match proposal.get("baselineRevisions").and_then(Value::as_array) {
        Some(revisions) if revisions.len() == PROPOSAL_SOURCES.len() => {
            for source in PROPOSAL_SOURCES {
                let entry = revisions.iter().find(|entry| {
                    entry.get("source").and_then(Value::as_str) == Some(source)
                });
                match entry {
                    Some(entry) => {
                        if entry.get("revision").and_then(Value::as_i64) != input_revisions.get(source).copied() {
                            errors.push(format!("baselineRevisions {} revision mismatch", source));
                        }
                    }
                    None => errors.push(format!("baselineRevisions missing source {}", source)),
                }
            }
        }
        _ => errors.push(format!(
            "baselineRevisions must list all {} sources",
            PROPOSAL_SOURCES.len()
        )),
    }

    match proposal.get("retrievedEvidence").and_then(Value::as_array) {
        Some(evidence) => {
            for item in evidence {
                if !has_keys(item, &["source", "revision", "summary", "detailRef"], &["source", "revision", "summary"]) {
                    errors.push("retrievedEvidence item keys invalid".to_string());
                    continue;
                }
                let source = item.get("source").and_then(Value::as_str).unwrap_or("");
                if !PROPOSAL_SOURCES.contains(&source) {
                    errors.push(format!("retrievedEvidence source invalid: {}", source));
                } else if item.get("revision").and_then(Value::as_i64) != input_revisions.get(source).copied() {
                    errors.push(format!("retrievedEvidence {} revision mismatch", source));
                }
                if !is_non_empty_string(item.get("summary").unwrap_or(&Value::Null)) {
                    errors.push("retrievedEvidence summary must be non-empty".to_string());
                }
            }
        }
        None => errors.push("retrievedEvidence must be an array".to_string()),
    }

    let goals = proposal.get("chapterGoals");
    let goals_ok = goals
        .and_then(Value::as_array)
        .map(|items| !items.is_empty() && items.iter().all(is_non_empty_string))
        .unwrap_or(false);
    if !goals_ok {
        errors.push("chapterGoals must be a non-empty array of non-empty strings".to_string());
    }

    let scenes_ok = proposal
        .get("scenePlan")
        .and_then(Value::as_array)
        .map(|items| {
            items.iter().all(|item| {
                has_keys(item, &["title", "purpose", "conflicts"], &["title", "purpose"])
                    && is_non_empty_string(item.get("title").unwrap_or(&Value::Null))
                    && is_non_empty_string(item.get("purpose").unwrap_or(&Value::Null))
                    && field_len_ok(item.get("title").unwrap_or(&Value::Null))
                    && field_len_ok(item.get("purpose").unwrap_or(&Value::Null))
            })
        })
        .unwrap_or(false);
    if !scenes_ok {
        errors.push("scenePlan items must be {title, purpose, conflicts?} with non-empty strings".to_string());
    }

    let constraints_ok = proposal
        .get("characterConstraints")
        .and_then(Value::as_array)
        .map(|items| {
            items.iter().all(|item| {
                has_keys(item, &["characterId", "constraint"], &["characterId", "constraint"])
                    && is_non_empty_string(item.get("characterId").unwrap_or(&Value::Null))
                    && is_non_empty_string(item.get("constraint").unwrap_or(&Value::Null))
            })
        })
        .unwrap_or(false);
    if !constraints_ok {
        errors.push("characterConstraints items must be {characterId, constraint}".to_string());
    }

    let risks_ok = proposal
        .get("continuityRisks")
        .and_then(Value::as_array)
        .map(|items| {
            items.iter().all(|item| {
                has_keys(item, &["kind", "description", "severity"], &["kind", "description", "severity"])
                    && is_non_empty_string(item.get("kind").unwrap_or(&Value::Null))
                    && is_non_empty_string(item.get("description").unwrap_or(&Value::Null))
                    && item
                        .get("severity")
                        .and_then(Value::as_str)
                        .map(|severity| SEVERITIES.contains(&severity))
                        .unwrap_or(false)
            })
        })
        .unwrap_or(false);
    if !risks_ok {
        errors.push("continuityRisks items must be {kind, description, severity in low|medium|high}".to_string());
    }

    let questions_ok = proposal
        .get("unresolvedQuestions")
        .and_then(Value::as_array)
        .map(|items| items.iter().all(is_non_empty_string))
        .unwrap_or(false);
    if !questions_ok {
        errors.push("unresolvedQuestions must be an array of non-empty strings".to_string());
    }

    match proposal.get("recommendedActions").and_then(Value::as_array) {
        Some(actions) if !actions.is_empty() => {
            for action in actions {
                if !has_keys(action, &["type", "target", "description"], &["type", "description"]) {
                    errors.push("recommendedActions item keys invalid".to_string());
                    continue;
                }
                let action_type = action.get("type").and_then(Value::as_str).unwrap_or("");
                if !ACTION_TYPES.contains(&action_type) {
                    errors.push(format!(
                        "recommendedActions type must be read_tool|ask_user, got {}",
                        action_type
                    ));
                }
                if !is_non_empty_string(action.get("description").unwrap_or(&Value::Null)) {
                    errors.push("recommendedActions description must be non-empty".to_string());
                }
                if let Some(target) = action.get("target") {
                    if !is_non_empty_string(target) {
                        errors.push("recommendedActions target must be a string when present".to_string());
                    }
                }
            }
        }
        _ => errors.push("recommendedActions must be a non-empty array".to_string()),
    }

    if !is_non_empty_string(proposal.get("producedAt").unwrap_or(&Value::Null)) {
        errors.push("producedAt must be a non-empty string".to_string());
    }
    if !proposal.get("metrics").map(Value::is_object).unwrap_or(false) {
        errors.push("metrics must be an object".to_string());
    }

    ValidationReport {
        valid: errors.is_empty(),
        errors,
        coerced,
    }
}

#[cfg(test)]
mod tests {
    use super::super::models::ChapterBaselineRevision;
    use super::*;

    fn input() -> ChapterPreparationInput {
        ChapterPreparationInput {
            novel_id: "nov-a".to_string(),
            chapter_id: "ch-a1".to_string(),
            baseline_revisions: PROPOSAL_SOURCES
                .iter()
                .map(|source| ChapterBaselineRevision {
                    source: source.to_string(),
                    revision: 3,
                })
                .collect(),
        }
    }

    fn valid_proposal() -> Value {
        let baseline: Vec<Value> = PROPOSAL_SOURCES
            .iter()
            .map(|source| serde_json::json!({"source": source, "revision": 3}))
            .collect();
        serde_json::json!({
            "schemaVersion": 1,
            "planner": "dsh_spike_v0",
            "targetChapter": {"novelId": "nov-a", "chapterId": "ch-a1"},
            "baselineRevisions": baseline,
            "retrievedEvidence": [
                {"source": "outline", "revision": 3, "summary": "已读大纲"}
            ],
            "chapterGoals": ["推进主线"],
            "scenePlan": [{"title": "场景一", "purpose": "揭示线索", "conflicts": ["对峙"]}],
            "characterConstraints": [{"characterId": "char-1", "constraint": "不登场"}],
            "continuityRisks": [{"kind": "时间线", "description": "倒计时衔接", "severity": "medium"}],
            "unresolvedQuestions": ["谁来接应"],
            "recommendedActions": [{"type": "read_tool", "target": "chapter_context", "description": "复核大纲"}],
            "producedAt": "2026-08-14T00:00:00Z",
            "metrics": {"planner": "dsh_spike_v0"}
        })
    }

    #[test]
    fn accepts_valid_proposal() {
        let input = input();
        let mut proposal = valid_proposal();
        let report = validate(&input, &mut proposal);
        assert!(report.valid, "errors: {:?}", report.errors);
        assert!(report.coerced.is_none());
    }

    #[test]
    fn coerces_the_spike_failure_sample() {
        let input = input();
        let mut proposal = valid_proposal();
        proposal["planner"] = Value::String("dsp_spike_v0".to_string());
        let report = validate(&input, &mut proposal);
        assert!(report.valid, "errors: {:?}", report.errors);
        assert_eq!(proposal["planner"], "dsh_spike_v0");
        let coercion = report.coerced.unwrap();
        assert_eq!(coercion.original, "dsp_spike_v0");
        assert_eq!(coercion.distance, 1);
        assert_eq!(proposal["metrics"]["plannerCoerced"]["original"], "dsp_spike_v0");
    }

    #[test]
    fn rejects_too_far_or_ambiguous_planner() {
        let input = input();
        let mut proposal = valid_proposal();
        proposal["planner"] = Value::String("chatgpt".to_string());
        let report = validate(&input, &mut proposal);
        assert!(!report.valid);
        assert!(report.errors.iter().any(|error| error.contains("planner")));
    }

    #[test]
    fn rejects_write_actions() {
        let input = input();
        let mut proposal = valid_proposal();
        proposal["recommendedActions"] = serde_json::json!([
            {"type": "write_draft", "description": "越权写正文"}
        ]);
        let report = validate(&input, &mut proposal);
        assert!(!report.valid);
        assert!(report.errors.iter().any(|error| error.contains("read_tool|ask_user")));
    }

    #[test]
    fn rejects_revision_drift() {
        let input = input();
        let mut proposal = valid_proposal();
        proposal["retrievedEvidence"] = serde_json::json!([
            {"source": "outline", "revision": 99, "summary": "过期事实"}
        ]);
        let report = validate(&input, &mut proposal);
        assert!(!report.valid);
        assert!(report.errors.iter().any(|error| error.contains("revision mismatch")));
    }

    #[test]
    fn rejects_extra_top_level_keys() {
        let input = input();
        let mut proposal = valid_proposal();
        proposal["extra"] = Value::String("nope".to_string());
        let report = validate(&input, &mut proposal);
        assert!(!report.valid);
        assert!(report.errors.iter().any(|error| error.contains("top-level keys")));
    }

    #[test]
    fn rejects_missing_metrics() {
        let input = input();
        let mut proposal = valid_proposal();
        proposal.as_object_mut().unwrap().remove("metrics");
        let report = validate(&input, &mut proposal);
        assert!(!report.valid);
        assert!(report.errors.iter().any(|error| error.contains("metrics")));
    }
}
