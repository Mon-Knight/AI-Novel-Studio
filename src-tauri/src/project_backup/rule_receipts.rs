//! Persist receipt evidence, but never re-authorize it for a restored project.
use super::{
    backup_string, BackupRow, JsonValue, ProjectBackup, LARGE_TEXT_CHUNKS, LARGE_TEXT_DOCUMENTS,
};

fn record<'a>(
    backup: &'a ProjectBackup,
    table: &str,
    column: &str,
    id: &str,
) -> Result<&'a BackupRow, String> {
    let mut matches = backup
        .tables
        .get(table)
        .into_iter()
        .flatten()
        .filter(|row| row.get(column).and_then(JsonValue::as_str) == Some(id));
    let row = matches
        .next()
        .ok_or_else(|| format!("规则采用回执缺少关联记录：{table}"))?;
    if matches.next().is_some() {
        return Err(format!("规则采用回执关联记录重复：{table}"));
    }
    Ok(row)
}

// apply_transaction_id is not a SQLite foreign key. Validate it before export
// succeeds or restore starts writing. Legacy apply-* IDs are opaque, not documents.
// Receipt bodies stay byte-for-byte frozen (including original scope, author guard
// and target hashes); new project IDs must not turn old evidence into fresh consent.
pub(super) fn validate_references(backup: &ProjectBackup) -> Result<(), String> {
    let novel_id = backup_string(&backup.novel, "novels", "id")?;
    for decision in backup
        .tables
        .get("artifact_decisions")
        .into_iter()
        .flatten()
    {
        let Some(id) = decision
            .get("apply_transaction_id")
            .and_then(JsonValue::as_str)
            .filter(|id| id.starts_with("apply-rule-"))
        else {
            continue;
        };
        let artifact_id = backup_string(decision, "artifact_decisions", "artifact_id")?;
        let card_id = backup_string(decision, "artifact_decisions", "card_id")?;
        let conversation_id = backup_string(decision, "artifact_decisions", "conversation_id")?;
        let document = record(backup, LARGE_TEXT_DOCUMENTS, "id", id)?;
        let artifact = record(backup, "result_artifacts", "artifact_id", artifact_id)?;
        let card = record(backup, "conversation_artifact_cards", "card_id", card_id)?;
        let conversation = record(
            backup,
            "task_conversations",
            "conversation_id",
            conversation_id,
        )?;
        if backup_string(document, LARGE_TEXT_DOCUMENTS, "target_type")? != "artifact"
            || backup_string(document, LARGE_TEXT_DOCUMENTS, "target_id")? != artifact_id
            || backup_string(document, LARGE_TEXT_DOCUMENTS, "field_name")?
                != "world_rule_apply_receipt"
            || backup_string(document, LARGE_TEXT_DOCUMENTS, "status")? != "ready"
            || backup_string(artifact, "result_artifacts", "source_novel_id")? != novel_id
            || backup_string(artifact, "result_artifacts", "content_hash")?
                != backup_string(decision, "artifact_decisions", "artifact_hash")?
            || backup_string(card, "conversation_artifact_cards", "artifact_id")? != artifact_id
            || backup_string(card, "conversation_artifact_cards", "conversation_id")?
                != conversation_id
            || backup_string(conversation, "task_conversations", "novel_id")? != novel_id
        {
            return Err("规则采用回执归属或决定关联无效".to_string());
        }
        // Generic legacy large-text backups permit absent hashes; new receipts do not.
        if backup_string(document, LARGE_TEXT_DOCUMENTS, "content_sha256")?.is_empty() {
            return Err("规则采用回执缺少完整性哈希".to_string());
        }
        for chunk in backup
            .tables
            .get(LARGE_TEXT_CHUNKS)
            .into_iter()
            .flatten()
            .filter(|row| row.get("document_id").and_then(JsonValue::as_str) == Some(id))
        {
            if backup_string(chunk, LARGE_TEXT_CHUNKS, "chunk_sha256")?.is_empty() {
                return Err("规则采用回执分片缺少完整性哈希".to_string());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "rule_receipts_tests.rs"]
mod tests;
