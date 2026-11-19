//! Restore-time identity for review grants and governed provider requests.
//!
//! Authorization status, issue time and consumed time are copied verbatim.
//! Issued and expired grants cannot carry a consumption, a consumed draft must
//! belong to the authorized chapter, and the decision, hash and chapter-text
//! artifact must describe that same chapter. References outside the backup or
//! swapped within the book fail before any row is written.
use super::{BackupRow, ProjectBackup};
use serde_json::Value as JsonValue;
use std::collections::HashMap;

pub(super) fn seal_restore_identities(
    backup: &ProjectBackup,
    ids: &mut HashMap<String, String>,
) -> Result<(), String> {
    register_provider_requests(backup, ids);
    let novel_id = text(&backup.novel, "id").ok_or_else(|| "备份缺少作品 ID".to_string())?;
    for row in backup
        .tables
        .get("review_authorizations")
        .into_iter()
        .flatten()
    {
        require_mapped(row, "authorization_id", ids)?;
        let referenced_novel =
            text(row, "novel_id").ok_or_else(|| "审阅授权缺少novel_id，已阻止恢复".to_string())?;
        if referenced_novel != novel_id {
            return Err("审阅授权引用了备份之外的novel_id，已阻止恢复".to_string());
        }
        require_owned(backup, row, "chapter_id", "chapters", "id", ids)?;
        require_owned(
            backup,
            row,
            "artifact_id",
            "result_artifacts",
            "artifact_id",
            ids,
        )?;
        require_owned(
            backup,
            row,
            "decision_id",
            "artifact_decisions",
            "decision_id",
            ids,
        )?;
        if let Some(draft_id) = text(row, "consumed_by_draft_id") {
            if !owns(backup, "chapter_drafts", "id", draft_id) || !ids.contains_key(draft_id) {
                return Err("审阅授权引用了备份之外的consumed_by_draft_id，已阻止恢复".to_string());
            }
        }
        require_status_shape(backup, row)?;
        require_chapter_body_grant(backup, row)?;
    }
    Ok(())
}

fn require_status_shape(backup: &ProjectBackup, row: &BackupRow) -> Result<(), String> {
    let status = text(row, "status").ok_or_else(|| "审阅授权缺少status，已阻止恢复".to_string())?;
    let consumed_at = text(row, "consumed_at");
    let draft_id = text(row, "consumed_by_draft_id");
    match status {
        "issued" | "expired" => {
            if consumed_at.is_some() || draft_id.is_some() {
                return Err("审阅授权的issued/expired状态不能带消费记录，已阻止恢复".to_string());
            }
        }
        "consumed" => {
            let draft_id = draft_id
                .ok_or_else(|| "已消费审阅授权缺少consumed_by_draft_id，已阻止恢复".to_string())?;
            if consumed_at.is_none() {
                return Err("已消费审阅授权缺少consumed_at，已阻止恢复".to_string());
            }
            let draft = required_row(backup, "chapter_drafts", "id", draft_id)?;
            if text(draft, "chapter_id") != text(row, "chapter_id")
                || text(draft, "novel_id") != text(row, "novel_id")
            {
                return Err("已消费审阅授权的草稿不属于授权章节，已阻止恢复".to_string());
            }
        }
        _ => return Err("审阅授权状态无效，已阻止恢复".to_string()),
    }
    Ok(())
}

fn require_chapter_body_grant(backup: &ProjectBackup, row: &BackupRow) -> Result<(), String> {
    let chapter_id =
        text(row, "chapter_id").ok_or_else(|| "审阅授权缺少chapter_id，已阻止恢复".to_string())?;
    let artifact_id = text(row, "artifact_id")
        .ok_or_else(|| "审阅授权缺少artifact_id，已阻止恢复".to_string())?;
    let decision_id = text(row, "decision_id")
        .ok_or_else(|| "审阅授权缺少decision_id，已阻止恢复".to_string())?;
    let novel_id =
        text(row, "novel_id").ok_or_else(|| "审阅授权缺少novel_id，已阻止恢复".to_string())?;
    let decision = required_row(backup, "artifact_decisions", "decision_id", decision_id)?;
    if text(decision, "decision") != Some("confirm")
        || text(decision, "actor") != Some("user")
        || text(decision, "target_type") != Some("chapter")
        || text(decision, "target_id") != Some(chapter_id)
        || text(decision, "artifact_id") != Some(artifact_id)
    {
        return Err("审阅授权与产物决策的章节或确认不一致，已阻止恢复".to_string());
    }
    let hash = text(decision, "artifact_hash")
        .ok_or_else(|| "审阅授权的产物决策缺少artifact_hash，已阻止恢复".to_string())?;
    let artifact = required_row(backup, "result_artifacts", "artifact_id", artifact_id)?;
    let processing = text(artifact, "processing_status");
    if text(artifact, "artifact_type") != Some("chapter_text")
        || !matches!(processing, Some("valid" | "valid_with_warnings"))
        || text(artifact, "source_novel_id") != Some(novel_id)
        || text(artifact, "source_chapter_id") != Some(chapter_id)
        || text(artifact, "content_hash") != Some(hash)
    {
        return Err("审阅授权的产物不是该章正文，已阻止恢复".to_string());
    }
    let card_id = text(decision, "card_id")
        .ok_or_else(|| "审阅授权的产物决策缺少card_id，已阻止恢复".to_string())?;
    let conversation_id = text(decision, "conversation_id")
        .ok_or_else(|| "审阅授权的产物决策缺少conversation_id，已阻止恢复".to_string())?;
    let card = required_row(backup, "conversation_artifact_cards", "card_id", card_id)?;
    if text(card, "artifact_id") != Some(artifact_id)
        || text(card, "conversation_id") != Some(conversation_id)
    {
        return Err("审阅授权的产物卡片与决策不一致，已阻止恢复".to_string());
    }
    let conversation = required_row(
        backup,
        "task_conversations",
        "conversation_id",
        conversation_id,
    )?;
    if text(conversation, "novel_id") != Some(novel_id) {
        return Err("审阅授权的任务会话不属于该作品，已阻止恢复".to_string());
    }
    let chapter = required_row(backup, "chapters", "id", chapter_id)?;
    if text(chapter, "novel_id") != Some(novel_id) || text(chapter, "deleted_at").is_some() {
        return Err("审阅授权的章节不存在或不属于该作品，已阻止恢复".to_string());
    }
    Ok(())
}

fn required_row<'a>(
    backup: &'a ProjectBackup,
    table: &str,
    column: &str,
    id: &str,
) -> Result<&'a BackupRow, String> {
    backup
        .tables
        .get(table)
        .into_iter()
        .flatten()
        .find(|row| text(row, column) == Some(id))
        .ok_or_else(|| format!("审阅授权引用了备份之外的{column}，已阻止恢复"))
}

fn require_owned(
    backup: &ProjectBackup,
    row: &BackupRow,
    column: &str,
    table: &str,
    owner_column: &str,
    ids: &HashMap<String, String>,
) -> Result<(), String> {
    let value = text(row, column).ok_or_else(|| format!("审阅授权缺少{column}，已阻止恢复"))?;
    if owns(backup, table, owner_column, value) && ids.contains_key(value) {
        Ok(())
    } else {
        Err(format!("审阅授权引用了备份之外的{column}，已阻止恢复"))
    }
}

fn owns(backup: &ProjectBackup, table: &str, column: &str, id: &str) -> bool {
    backup
        .tables
        .get(table)
        .into_iter()
        .flatten()
        .any(|row| text(row, column) == Some(id))
}

fn register_provider_requests(backup: &ProjectBackup, ids: &mut HashMap<String, String>) {
    let mut fresh = Vec::new();
    for row in backup.tables.get("ai_task_attempts").into_iter().flatten() {
        let Some(request_id) = text(row, "provider_request_id") else {
            continue;
        };
        // Deterministic attempts store their own attempt id here, and older
        // fixtures reuse a run id. Those already have a mapping. A governed
        // request id is not an exported identity, so the copy needs its own.
        if ids.contains_key(request_id) {
            continue;
        }
        fresh.push(request_id.to_string());
    }
    for request_id in fresh {
        let id = fresh_id(ids);
        ids.insert(request_id, id);
    }
}

fn require_mapped(
    row: &BackupRow,
    column: &str,
    ids: &HashMap<String, String>,
) -> Result<(), String> {
    let value = text(row, column).ok_or_else(|| format!("审阅授权缺少{column}，已阻止恢复"))?;
    if ids.contains_key(value) {
        Ok(())
    } else {
        Err(format!("审阅授权引用了备份之外的{column}，已阻止恢复"))
    }
}

fn text<'a>(row: &'a BackupRow, column: &str) -> Option<&'a str> {
    row.get(column)
        .and_then(JsonValue::as_str)
        .filter(|value| !value.is_empty())
}

fn fresh_id(ids: &HashMap<String, String>) -> String {
    loop {
        let id = uuid::Uuid::new_v4().to_string();
        if !ids.contains_key(&id) && ids.values().all(|value| value != &id) {
            return id;
        }
    }
}

#[cfg(test)]
#[path = "restore_identity_tests.rs"]
mod tests;
