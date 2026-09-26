//! Review identity and world-rule gates; writes stay inside authoritative SQLite transactions.
use super::*;

pub(super) fn validate_review_rule_baseline(connection: &Connection, artifact_id: &str, novel_id: &str) -> Result<(), AppError> {
    let raw: Option<String> = connection.query_row(
        "SELECT task.target_hint_json FROM result_artifacts AS artifact
         JOIN ai_tasks AS task ON task.task_id=artifact.task_id
         WHERE artifact.artifact_id=?1 AND task.novel_id=?2",
        params![artifact_id, novel_id], |row| row.get(0),
    ).optional().map_err(AppError::database)?.flatten();
    let hint = raw.as_deref().and_then(|value| serde_json::from_str::<Value>(value).ok());
    let frozen = hint.as_ref().and_then(|value| value.get("nativeRuleSet")).ok_or_else(|| AppError::new(
        "RULE_SET_SNAPSHOT_REQUIRED", "章节候选缺少生成时世界规则基线，请重新生成候选后审阅", false,
    ))?;
    crate::services::world_rule_governance::validate_frozen_rule_set(connection, novel_id, frozen)
}
pub fn issue_review_authorization(
    connection: &mut Connection, authorization_id: &str, decision_id: &str, artifact_id: &str,
    novel_id: &str, chapter_id: &str, issued_at: &str,
) -> Result<ReviewAuthorizationRecord, AppError> {
    let transaction = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(AppError::database)?;
    let result = issue_review_authorization_in_transaction(&transaction, authorization_id, decision_id, artifact_id, novel_id, chapter_id, issued_at)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(result)
}

fn issue_review_authorization_in_transaction(
    connection: &Connection,
    authorization_id: &str,
    decision_id: &str,
    artifact_id: &str,
    novel_id: &str,
    chapter_id: &str,
    issued_at: &str,
) -> Result<ReviewAuthorizationRecord, AppError> {
    let existing = connection
        .query_row(
            "SELECT authorization_id, artifact_id, chapter_id, novel_id, decision_id, status, issued_at, consumed_at, consumed_by_draft_id
             FROM review_authorizations WHERE decision_id=?1",
            params![decision_id],
            authorization_from_row,
        )
        .optional()
        .map_err(AppError::database)?;
    if let Some(existing) = existing {
        if existing.authorization_id != authorization_id
            || existing.artifact_id != artifact_id
            || existing.novel_id != novel_id
            || existing.chapter_id != chapter_id
        {
            return Err(AppError::new(
                "REVIEW_AUTHORIZATION_IDENTITY_CONFLICT",
                "既有审阅授权与当前请求身份不一致",
                false,
            ));
        }
        validate_review_decision_scope(connection, decision_id, artifact_id, novel_id, chapter_id)?;
        if existing.status == "expired" {
            return Err(AppError::new("REVIEW_AUTHORIZATION_EXPIRED", "审阅授权已失效，请重新生成候选", false));
        }
        if existing.status == "issued" { validate_review_rule_baseline(connection, artifact_id, novel_id)?; }
        return Ok(existing);
    }
    validate_review_decision_scope(connection, decision_id, artifact_id, novel_id, chapter_id)?;
    validate_review_rule_baseline(connection, artifact_id, novel_id)?;
    connection
        .execute(
            "INSERT INTO review_authorizations (
                authorization_id, artifact_id, chapter_id, novel_id, decision_id, status, issued_at
             ) VALUES (?1,?2,?3,?4,?5,'issued',?6)",
            params![
                authorization_id,
                artifact_id,
                chapter_id,
                novel_id,
                decision_id,
                issued_at
            ],
        )
        .map_err(AppError::database)?;
    connection
        .query_row(
            "SELECT authorization_id, artifact_id, chapter_id, novel_id, decision_id, status, issued_at, consumed_at, consumed_by_draft_id
             FROM review_authorizations WHERE authorization_id=?1",
            params![authorization_id],
            authorization_from_row,
        )
        .map_err(AppError::database)
}

pub fn consume_review_authorization(
    connection: &mut Connection, input: ConsumeReviewAuthorizationInput,
) -> Result<ReviewAuthorizationRecord, AppError> {
    let transaction = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(AppError::database)?;
    let result = consume_review_authorization_in_transaction(&transaction, input)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(result)
}

fn consume_review_authorization_in_transaction(
    connection: &Connection,
    input: ConsumeReviewAuthorizationInput,
) -> Result<ReviewAuthorizationRecord, AppError> {
    let current = connection
        .query_row(
            "SELECT authorization_id, artifact_id, chapter_id, novel_id, decision_id, status, issued_at, consumed_at, consumed_by_draft_id
             FROM review_authorizations WHERE authorization_id=?1",
            params![input.authorization_id],
            authorization_from_row,
        )
        .map_err(AppError::database)?;
    if current.status == "consumed" {
        if current.consumed_by_draft_id.as_deref() == Some(input.draft_id.as_str()) {
            return Ok(current);
        }
        return Err(AppError::new(
            "REVIEW_AUTHORIZATION_CONSUMED",
            "审阅授权已被其他草稿消费",
            false,
        ));
    }
    if current.status != "issued" {
        return Err(AppError::new(
            "REVIEW_AUTHORIZATION_EXPIRED",
            "审阅授权已失效",
            false,
        ));
    }
    validate_review_decision_scope(connection, &current.decision_id, &current.artifact_id, &current.novel_id, &current.chapter_id)?;
    validate_review_rule_baseline(connection, &current.artifact_id, &current.novel_id)?;
    let updated = connection
        .execute(
            "UPDATE review_authorizations
             SET status='consumed', consumed_at=?2, consumed_by_draft_id=?3
             WHERE authorization_id=?1 AND status='issued'",
            params![input.authorization_id, input.consumed_at, input.draft_id],
        )
        .map_err(AppError::database)?;
    if updated != 1 {
        return Err(AppError::new(
            "REVIEW_AUTHORIZATION_CONFLICT",
            "审阅授权消费冲突",
            false,
        ));
    }
    connection
        .query_row(
            "SELECT authorization_id, artifact_id, chapter_id, novel_id, decision_id, status, issued_at, consumed_at, consumed_by_draft_id
             FROM review_authorizations WHERE authorization_id=?1",
            params![input.authorization_id],
            authorization_from_row,
        )
        .map_err(AppError::database)
}

pub fn get_review_authorization(
    connection: &Connection,
    authorization_id: &str,
) -> Result<Option<ReviewAuthorizationRecord>, AppError> {
    let result = connection.query_row(
        "SELECT authorization_id, artifact_id, chapter_id, novel_id, decision_id, status, issued_at, consumed_at, consumed_by_draft_id
         FROM review_authorizations WHERE authorization_id=?1",
        params![authorization_id],
        authorization_from_row,
    );
    match result {
        Ok(record) => Ok(Some(record)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(err) => Err(AppError::database(err)),
    }
}
