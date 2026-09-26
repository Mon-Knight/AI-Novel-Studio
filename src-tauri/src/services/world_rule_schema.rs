//! Validation of the opt-in structuredJson contract. Unknown stored payloads remain readable.
use serde_json::Value;

fn object(value: &Value) -> bool {
    value.is_object()
}
fn text(value: &Value) -> bool {
    value.as_str().is_some_and(|v| v.chars().count() <= 20_000)
}
fn texts(value: &Value) -> bool {
    value
        .as_array()
        .is_some_and(|rows| rows.len() <= 128 && rows.iter().all(text))
}
fn fields(value: &Value, keys: &[&str]) -> bool {
    object(value) && keys.iter().all(|key| text(&value[*key]))
}
fn choice(value: &Value, allowed: &[&str]) -> bool {
    value.as_str().is_some_and(|v| allowed.contains(&v))
}
fn positive(value: &Value) -> bool {
    value
        .as_u64()
        .is_some_and(|v| v > 0 && v <= 9_007_199_254_740_991)
}

pub fn valid_document(value: &Value) -> bool {
    value["contract"] == "world_rules_v1"
        && value["schemaVersion"] == 1
        && object(&value["identity"])
        && text(&value["identity"]["id"])
        && value["identity"]["id"]
            .as_str()
            .is_some_and(|id| !id.trim().is_empty())
        && positive(&value["identity"]["revision"])
        && (value["identity"].get("supersedesRevision").is_none()
            || (positive(&value["identity"]["supersedesRevision"])
                && value["identity"]["supersedesRevision"].as_u64()
                    < value["identity"]["revision"].as_u64()))
        && choice(
            &value["kind"],
            &[
                "world_fact",
                "causal_rule",
                "social_norm",
                "character_belief",
                "author_constraint",
                "narrative_preference",
            ],
        )
        && choice(
            &value["authority"],
            &["draft", "candidate", "confirmed", "superseded"],
        )
        && choice(&value["strength"], &["hard", "soft", "descriptive"])
        && text(&value["statement"])
        && texts(&value["conditions"])
        && fields(&value["scope"], &["summary"])
        && ["chapterIds", "places", "groups", "characters"]
            .iter()
            .all(|key| texts(&value["scope"][*key]))
        && fields(
            &value["chronology"],
            &["effectiveFrom", "effectiveUntil", "revealAt"],
        )
        && fields(&value["epistemic"], &["learnedAt", "evidence"])
        && choice(
            &value["epistemic"]["status"],
            &["established", "uncertain", "disputed", "belief"],
        )
        && texts(&value["epistemic"]["knownBy"])
        && fields(&value["boundaries"], &["limitations", "cost", "ceiling"])
        && value["exceptions"].as_array().is_some_and(|rows| {
            rows.len() <= 128
                && rows.iter().all(|row| {
                    fields(row, &["condition", "effect", "reason"])
                        && choice(&row["approval"], &["proposed", "author_approved"])
                })
        })
        && object(&value["provenance"])
        && choice(
            &value["provenance"]["origin"],
            &["user", "ai_candidate", "adopted_text", "legacy"],
        )
        && texts(&value["provenance"]["sourceRefs"])
        && texts(&value["dependencies"])
        && value["worldParameters"]
            .as_object()
            .is_some_and(|rows| rows.values().all(text))
}

pub fn validate_metadata(
    next: Option<&str>,
    previous: Option<&str>,
    intent: Option<&str>,
) -> Result<(), String> {
    let Some(raw) = next else {
        return Ok(());
    };
    let value: Value = match serde_json::from_str(raw) {
        Ok(value) => value,
        Err(_) if previous == next => return Ok(()),
        Err(_) => return Err("WORLD_RULE_SCHEMA_INVALID: 无效结构化JSON".to_string()),
    };
    if !valid_document(&value) {
        if previous == next {
            return Ok(());
        }
        return Err(
            "WORLD_RULE_SCHEMA_INVALID: 不支持的规则结构；既有数据只能原样保留".to_string(),
        );
    }
    if value["authority"] == "confirmed" && intent.is_none() {
        return Err("RULE_CHANGE_CONFIRMATION_REQUIRED: 作者确认不能由JSON字段替代".to_string());
    }
    let old = previous
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .filter(valid_document);
    if let Some(old) = old.as_ref() {
        if raw != previous.unwrap_or_default()
            && (value["identity"]["id"] != old["identity"]["id"]
                || value["identity"]["revision"].as_u64()
                    != old["identity"]["revision"]
                        .as_u64()
                        .and_then(|v| v.checked_add(1))
                || value["identity"]["supersedesRevision"] != old["identity"]["revision"])
        {
            return Err("WORLD_RULE_REVISION_CONFLICT: 规则身份或修订前置条件已变化".to_string());
        }
    }
    for exception in value["exceptions"].as_array().into_iter().flatten() {
        if exception["approval"] != "author_approved" {
            continue;
        }
        let already_approved = old
            .as_ref()
            .and_then(|v| v["exceptions"].as_array())
            .is_some_and(|rows| rows.contains(exception));
        if !already_approved
            && (intent != Some("approve_exception")
                || ["condition", "effect", "reason"]
                    .iter()
                    .any(|key| exception[*key].as_str().is_none_or(|v| v.trim().is_empty())))
        {
            return Err(
                "RULE_EXCEPTION_CONFIRMATION_REQUIRED: 新增或修改的例外需明确批准、条件与理由"
                    .to_string(),
            );
        }
    }
    Ok(())
}

/// Validate recognized v1 payloads without upgrading unknown legacy formats into authority.
pub fn validate_world_rule_document(
    structured_json: Option<&str>,
) -> Result<(), crate::errors::AppError> {
    let Some(raw) = structured_json else {
        return Ok(());
    };
    if raw.trim().is_empty() {
        return Ok(());
    }
    let value: Value = serde_json::from_str(raw).map_err(|_| {
        crate::errors::AppError::new("WORLD_RULE_SCHEMA_INVALID", "规则JSON无效", false)
    })?;
    if value["contract"] != "world_rules_v1" || value["schemaVersion"] != 1 {
        return Ok(());
    }
    if !valid_document(&value) {
        return Err(crate::errors::AppError::new(
            "WORLD_RULE_SCHEMA_INVALID",
            "规则字段不符合world_rules_v1",
            false,
        ));
    }
    Ok(())
}

#[cfg(test)]
#[path = "world_rule_schema_tests.rs"]
mod tests;
