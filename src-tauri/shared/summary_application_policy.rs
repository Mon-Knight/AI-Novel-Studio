//! Shared summary context policy. Structural checks never establish semantic truth.
//! Authorization to write is checked separately by the authoritative application service.
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SummaryApplicationMode {
    ManualReview,
    TaskPreauthorization,
    Context,
}

#[derive(Debug, PartialEq, Eq)]
pub struct SummaryApplicationPolicy {
    pub eligible: bool,
    pub blocking: bool,
    pub human_review_required: bool,
    pub legacy_manual_review: bool,
    pub stop_reason: Option<&'static str>,
}

impl SummaryApplicationPolicy {
    fn stop(mut self, reason: &'static str, blocking: bool) -> Self {
        self.stop_reason = Some(reason);
        self.blocking = blocking;
        self
    }
}

fn legacy_manual_review(value: &Value) -> bool {
    value.get("policyVersion").is_none()
        && value["passed"] == false
        && value["safeToContext"] == true
        && value["authorReviewed"] == true
        && value["semanticValidation"] == "not_checked"
        && matches!(
            value["evidenceValidation"].as_str(),
            Some("passed" | "missing")
        )
        && value["problems"].as_array().is_some_and(|problems| {
            problems
                .iter()
                .all(|problem| problem["type"] == "speculation")
        })
}

pub fn evaluate(
    validation_result: Option<&str>,
    validation_status: Option<&str>,
    mode: SummaryApplicationMode,
) -> SummaryApplicationPolicy {
    let mut policy = SummaryApplicationPolicy {
        eligible: false,
        blocking: false,
        human_review_required: false,
        legacy_manual_review: false,
        stop_reason: None,
    };
    let value = match validation_result
        .map(serde_json::from_str::<Value>)
        .transpose()
    {
        Ok(value) => value,
        Err(_) => return policy.stop("SUMMARY_VALIDATION_INVALID", false),
    };
    let empty = value
        .as_ref()
        .is_none_or(|value| value.as_object().is_some_and(|object| object.is_empty()));
    if empty {
        if mode == SummaryApplicationMode::TaskPreauthorization {
            return policy.stop("SUMMARY_VALIDATION_INVALID", false);
        }
        if validation_status == Some("failed") {
            return policy.stop("SUMMARY_BLOCKING_VALIDATION_ERROR", true);
        }
        policy.eligible = true;
        return policy;
    }
    let value = value.as_ref().unwrap();
    if !value.is_object()
        || !value["passed"].is_boolean()
        || !value["safeToContext"].is_boolean()
        || !value["problems"].is_array()
        || value
            .get("policyVersion")
            .is_some_and(|version| version.as_i64() != Some(1))
        || ["blockingIssues", "groundingIssues"]
            .iter()
            .any(|key| value.get(*key).is_some_and(|issues| !issues.is_array()))
        || value
            .get("authorReviewed")
            .is_some_and(|reviewed| !reviewed.is_boolean())
        || value
            .get("semanticValidation")
            .is_some_and(|semantic| semantic != "not_checked")
        || value["groundingIssues"].as_array().is_some_and(|issues| {
            issues
                .iter()
                .any(|issue| !matches!(issue["severity"].as_str(), Some("warning" | "error")))
        })
        || value.get("reviewRequirement").is_some_and(|requirement| {
            !matches!(requirement.as_str(), Some("none" | "human_required"))
        })
        || value
            .get("applicationProvenance")
            .is_some_and(|provenance| {
                !matches!(
                    provenance["mode"].as_str(),
                    Some("manual_review" | "task_preauthorization")
                )
            })
    {
        return policy.stop("SUMMARY_VALIDATION_INVALID", false);
    }
    policy.legacy_manual_review = legacy_manual_review(value);
    let blocking = validation_status == Some("failed")
        || value["blockingIssues"]
            .as_array()
            .is_some_and(|issues| !issues.is_empty())
        || value["groundingIssues"]
            .as_array()
            .is_some_and(|issues| issues.iter().any(|issue| issue["severity"] == "error"))
        || (!policy.legacy_manual_review
            && (value["passed"] != true || !value["problems"].as_array().unwrap().is_empty()));
    if blocking {
        return policy.stop("SUMMARY_BLOCKING_VALIDATION_ERROR", true);
    }
    if value
        .pointer("/applicationProvenance/mode")
        .and_then(Value::as_str)
        == Some("task_preauthorization")
        && (value["authorReviewed"] == true
            || value
                .pointer("/applicationProvenance/authorizationId")
                .and_then(Value::as_str)
                .is_none_or(|id| id.trim().is_empty()))
    {
        return policy.stop("SUMMARY_VALIDATION_INVALID", false);
    }
    policy.human_review_required = value["reviewRequirement"] == "human_required";
    if policy.human_review_required
        && (mode == SummaryApplicationMode::TaskPreauthorization || value["authorReviewed"] != true)
    {
        return policy.stop("SUMMARY_HUMAN_REVIEW_REQUIRED", false);
    }
    if mode == SummaryApplicationMode::TaskPreauthorization && value["policyVersion"] != 1 {
        return policy.stop("SUMMARY_VALIDATION_INVALID", false);
    }
    if value["safeToContext"] != true {
        return policy.stop("SUMMARY_CONTEXT_UNSAFE", false);
    }
    policy.eligible = true;
    policy
}

pub fn ensure_context_eligible(
    validation_result: Option<&str>,
    validation_status: Option<&str>,
    mode: SummaryApplicationMode,
) -> Result<(), String> {
    let policy = evaluate(validation_result, validation_status, mode);
    if policy.eligible {
        Ok(())
    } else {
        Err(policy
            .stop_reason
            .unwrap_or("SUMMARY_CONTEXT_UNSAFE")
            .to_string())
    }
}

pub fn requires_human_review(code: &str) -> bool {
    matches!(
        code,
        "SUMMARY_CERTAINTY_ESCALATION" | "SUMMARY_EVIDENCE_FRAGMENT"
    )
}

/// Authoritative summary-source IDs eligible for context, computed without changing history.
/// Missing source tables/rows grant no eligibility to chapter-summary memory documents.
pub fn eligible_summary_ids(
    connection: &rusqlite::Connection,
    novel_id: &str,
) -> rusqlite::Result<Vec<String>> {
    let exists: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='chapter_summaries')", [], |row| row.get(0))?;
    if !exists {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare("SELECT id,validation_result,validation_status,enabled,is_expired FROM chapter_summaries WHERE novel_id=?1")?;
    let rows = statement.query_map([novel_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, bool>(3)?,
            row.get::<_, bool>(4)?,
        ))
    })?;
    let mut ids = Vec::new();
    for row in rows {
        let (id, validation, status, enabled, expired) = row?;
        if enabled
            && !expired
            && evaluate(
                validation.as_deref(),
                status.as_deref(),
                SummaryApplicationMode::Context,
            )
            .eligible
        {
            ids.push(id);
        }
    }
    Ok(ids)
}

pub fn eligible_summary_ids_json(
    connection: &rusqlite::Connection,
    novel_id: &str,
) -> rusqlite::Result<String> {
    serde_json::to_string(&eligible_summary_ids(connection, novel_id)?)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
}

pub fn summary_source_is_eligible(
    connection: &rusqlite::Connection,
    novel_id: &str,
    summary_id: &str,
) -> rusqlite::Result<bool> {
    Ok(eligible_summary_ids(connection, novel_id)?
        .iter()
        .any(|id| id == summary_id))
}
