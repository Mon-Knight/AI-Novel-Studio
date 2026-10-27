//! Rule-apply receipts reuse verified large-text snapshots and append-only decisions.
use super::ApplyStructuredArtifactInput;
use crate::errors::AppError;
use crate::repositories::{conversation_repository::ArtifactDecisionRecord, large_text_repository};
use crate::services::world_rule_governance;
use rusqlite::Connection;
use serde_json::{json, Value};

const FIELD: &str = "world_rule_apply_receipt";
fn invalid() -> AppError {
    AppError::new(
        "STRUCTURED_RULE_REPLAY_CONFLICT",
        "规则应用回执、作者确认或正式目标已经变化",
        false,
    )
}

pub(super) fn save(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    targets: &[(String, String)],
) -> Result<String, AppError> {
    let snapshot = world_rule_governance::rule_set_snapshot(connection, &input.novel_id)?;
    let mut proof = Vec::new();
    for (kind, id) in targets {
        let source = snapshot
            .sources
            .iter()
            .find(|source| source["sourceType"] == *kind && source["sourceId"] == *id)
            .ok_or_else(invalid)?;
        proof.push(json!({"targetType":kind,"targetId":id,"targetHash":source["recordHash"]}));
    }
    let body=json!({"schema":"world-rule-apply-receipt-v1","artifactId":input.artifact_id,
        "artifactHash":input.artifact_hash,"cardId":input.card_id,"conversationId":input.conversation_id,
        "novelId":input.novel_id,"decisionId":input.decision_id,"confirmedBy":input.actor,
        "expectedRuleSetFingerprint":input.expected_rule_set_fingerprint,"changeAuthorization":input.change_authorization,
        "ruleSetAfter":snapshot.fingerprint,"targets":proof}).to_string();
    let id = format!("apply-rule-{}", uuid::Uuid::new_v4());
    large_text_repository::insert_document_for_target(
        connection,
        &id,
        "artifact",
        &input.artifact_id,
        FIELD,
        Some("作者规则变更采用回执"),
        &body,
        &large_text_repository::sha256(&body),
        &input.created_at,
    )?;
    Ok(id)
}

pub(super) fn validate(
    connection: &Connection,
    decision: &ArtifactDecisionRecord,
    input: &ApplyStructuredArtifactInput,
) -> Result<(), AppError> {
    let id = decision
        .apply_transaction_id
        .as_deref()
        .filter(|id| id.starts_with("apply-rule-"))
        .ok_or_else(invalid)?;
    large_text_repository::validate_document_target(
        connection,
        id,
        "artifact",
        &input.artifact_id,
        FIELD,
    )?;
    let body = large_text_repository::read_verified_document(connection, id)?;
    let receipt: Value = serde_json::from_str(&body.content).map_err(|_| invalid())?;
    if receipt["schema"] != "world-rule-apply-receipt-v1"
        || receipt["artifactId"] != input.artifact_id
        || receipt["artifactHash"] != input.artifact_hash
        || receipt["cardId"] != input.card_id
        || receipt["conversationId"] != input.conversation_id
        || receipt["novelId"] != input.novel_id
        || receipt["decisionId"] != decision.decision_id
        || receipt["confirmedBy"] != "user"
        || receipt["expectedRuleSetFingerprint"] != json!(input.expected_rule_set_fingerprint)
        || receipt["changeAuthorization"] != json!(input.change_authorization)
    {
        return Err(AppError::new(
            "STRUCTURED_APPLY_IDEMPOTENCY_CONFLICT",
            "回放不得更换规则采用范围或作者说明",
            false,
        ));
    }
    let targets = receipt["targets"]
        .as_array()
        .filter(|targets| !targets.is_empty())
        .ok_or_else(invalid)?;
    let snapshot = world_rule_governance::rule_set_snapshot(connection, &input.novel_id)?;
    for target in targets {
        let source = snapshot
            .sources
            .iter()
            .find(|source| {
                source["sourceType"] == target["targetType"]
                    && source["sourceId"] == target["targetId"]
            })
            .ok_or_else(invalid)?;
        if source["recordHash"] != target["targetHash"] {
            return Err(invalid());
        }
    }
    Ok(())
}
