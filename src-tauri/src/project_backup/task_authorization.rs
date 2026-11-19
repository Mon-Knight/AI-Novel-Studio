//! Backup13 keeps authority history but never restores an executable preauthorization.
use super::{
    canonical_value_hash, parsed_json_column, required_backup_str, BackupRow, ProjectBackup,
};
use crate::services::{
    task_authorization_baseline,
    task_authorization_contract::{Action, ApplyInput, IssueInput, ReviewRenewalPreview},
};
use serde_json::{json, Value};

pub(super) fn is_table(table: &str) -> bool {
    matches!(table, "task_authorizations" | "task_authorization_receipts")
}
fn text<'a>(row: &'a BackupRow, key: &str) -> Option<&'a str> {
    row.get(key).and_then(Value::as_str)
}
fn hash(row: &BackupRow, key: &str) -> bool {
    text(row, key).is_some_and(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
}
pub(super) fn validate_row(table: &str, row: &BackupRow) -> bool {
    if table == "task_authorizations" {
        matches!(
            text(row, "status"),
            Some("active" | "revoked" | "expired" | "exhausted")
        ) && hash(row, "spec_hash")
            && hash(row, "model_snapshot_hash")
            && hash(row, "baseline_hash")
            && row
                .get("revision")
                .and_then(Value::as_i64)
                .is_some_and(|n| n >= 1)
            && row
                .get("used_writes")
                .and_then(Value::as_i64)
                .is_some_and(|n| n >= 0)
            && ["issued_at", "expires_at"].iter().all(|key| {
                text(row, key).is_some_and(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok())
            })
    } else {
        ["request_hash", "before_hash", "after_hash"]
            .iter()
            .all(|k| hash(row, k))
            && text(row, "action")
                .is_some_and(|s| serde_json::from_value::<Action>(json!(s)).is_ok())
    }
}
fn owned<'a>(
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
        .find(|r| text(r, column) == Some(id))
        .ok_or_else(|| format!("任务授权备份引用了范围外的 {table}.{column}"))
}
pub(super) fn validate(backup: &ProjectBackup) -> Result<(), String> {
    let novel = required_backup_str(&backup.novel, "id", "novels")?;
    for row in backup
        .tables
        .get("task_authorizations")
        .into_iter()
        .flatten()
    {
        let spec_value = parsed_json_column(row, "task_authorizations", "spec_json")?;
        let spec: IssueInput = serde_json::from_value(spec_value.clone())
            .map_err(|_| "任务授权范围或预算无效".to_string())?;
        if spec.novel_id != novel
            || text(row, "novel_id") != Some(novel)
            || text(row, "conversation_id") != Some(&spec.conversation_id)
            || text(row, "source_turn_id") != Some(&spec.source_turn_id)
            || canonical_value_hash(&spec_value)?
                != required_backup_str(row, "spec_hash", "task_authorizations")?
        {
            return Err("任务授权范围与签发记录不一致".into());
        }
        let conversation = owned(
            backup,
            "task_conversations",
            "conversation_id",
            &spec.conversation_id,
        )?;
        let turn = owned(
            backup,
            "conversation_turns",
            "turn_id",
            &spec.source_turn_id,
        )?;
        if text(conversation, "novel_id") != Some(novel)
            || text(turn, "conversation_id") != Some(&spec.conversation_id)
            || text(turn, "role") != Some("user")
        {
            return Err("任务授权没有对应作品与用户请求".into());
        }
        for id in &spec.chapter_ids {
            if text(owned(backup, "chapters", "id", id)?, "novel_id") != Some(novel) {
                return Err("授权章节不属于备份作品".into());
            }
        }
        let model = parsed_json_column(row, "task_authorizations", "model_snapshot_json")?;
        let identity =
            task_authorization_baseline::model_identity(&model).map_err(|e| e.to_string())?;
        let baseline = parsed_json_column(row, "task_authorizations", "baseline_json")?;
        if canonical_value_hash(&identity)?
            != required_backup_str(row, "model_snapshot_hash", "task_authorizations")?
            || canonical_value_hash(&baseline)?
                != required_backup_str(row, "baseline_hash", "task_authorizations")?
        {
            return Err("任务授权模型或基线 hash 不一致".into());
        }
        if !validate_row("task_authorizations", row) {
            return Err("任务授权状态、期限或额度无效".into());
        }
    }
    for row in backup
        .tables
        .get("task_authorization_receipts")
        .into_iter()
        .flatten()
    {
        if !validate_row("task_authorization_receipts", row) {
            return Err("授权写入回执格式无效".into());
        }
        let grant = owned(
            backup,
            "task_authorizations",
            "authorization_id",
            required_backup_str(row, "authorization_id", "task_authorization_receipts")?,
        )?;
        let card = owned(
            backup,
            "conversation_artifact_cards",
            "card_id",
            required_backup_str(row, "card_id", "task_authorization_receipts")?,
        )?;
        let artifact = owned(
            backup,
            "result_artifacts",
            "artifact_id",
            required_backup_str(row, "artifact_id", "task_authorization_receipts")?,
        )?;
        let action: Action = serde_json::from_value(json!(text(row, "action")))
            .map_err(|_| "回执动作无效".to_string())?;
        if text(row, "novel_id") != Some(novel)
            || text(grant, "novel_id") != Some(novel)
            || text(row, "conversation_id") != text(grant, "conversation_id")
            || text(card, "conversation_id") != text(row, "conversation_id")
            || text(card, "artifact_id") != text(row, "artifact_id")
            || text(artifact, "source_novel_id") != Some(novel)
            || text(artifact, "artifact_type") != Some(action.artifact_type())
        {
            return Err("授权写入回执与任务、候选或作品不匹配".into());
        }
        let input = request(row)?;
        if canonical_value_hash(&json!(input))?
            != required_backup_str(row, "request_hash", "task_authorization_receipts")?
        {
            return Err("授权写入回执请求 hash 不一致".into());
        }
    }
    validate_review_renewals(backup)?;
    Ok(())
}
fn validate_review_renewals(backup: &ProjectBackup) -> Result<(), String> {
    for row in backup
        .tables
        .get("review_authorizations")
        .into_iter()
        .flatten()
    {
        let Some(source) = text(row, "renewed_from_authorization_id") else {
            if row
                .get("renewal_preview_json")
                .is_some_and(|v| !v.is_null())
            {
                return Err("审阅续签证据缺少原授权身份".into());
            }
            continue;
        };
        let original = owned(backup, "review_authorizations", "authorization_id", source)?;
        let mut seen = std::collections::HashSet::new();
        let mut current = Some(source);
        seen.insert(required_backup_str(
            row,
            "authorization_id",
            "review_authorizations",
        )?);
        while let Some(id) = current {
            if !seen.insert(id) {
                return Err("审阅续签来源包含循环引用".into());
            }
            current = text(
                owned(backup, "review_authorizations", "authorization_id", id)?,
                "renewed_from_authorization_id",
            );
        }
        for key in ["novel_id", "chapter_id", "artifact_id"] {
            if text(row, key) != text(original, key) {
                return Err("审阅续签扩大了原授权范围".into());
            }
        }
        let value = parsed_json_column(row, "review_authorizations", "renewal_preview_json")?;
        let preview: ReviewRenewalPreview = serde_json::from_value(value.clone())
            .map_err(|_| "审阅续签预览格式无效".to_string())?;
        let mut evidence = value;
        evidence
            .as_object_mut()
            .ok_or("审阅续签证据无效")?
            .remove("previewHash");
        if canonical_value_hash(&evidence)? != preview.preview_hash
            || preview.authorization_id != source
            || Some(preview.novel_id.as_str()) != text(row, "novel_id")
            || Some(preview.chapter_id.as_str()) != text(row, "chapter_id")
            || Some(preview.artifact_id.as_str()) != text(row, "artifact_id")
            || Some(preview.chapter_baseline_hash.as_str()) != text(row, "native_baseline_hash")
        {
            return Err("审阅续签预览身份或基线 hash 不一致".into());
        }
        let card = owned(
            backup,
            "conversation_artifact_cards",
            "card_id",
            &preview.card_id,
        )?;
        if text(card, "artifact_id") != Some(preview.artifact_id.as_str())
            || text(card, "conversation_id") != Some(preview.conversation_id.as_str())
        {
            return Err("审阅续签卡片与任务范围不一致".into());
        }
        if let Some(saved) = preview.saved_draft {
            let draft = owned(backup, "chapter_drafts", "id", &saved.draft_id)?;
            if text(draft, "novel_id") != text(row, "novel_id")
                || text(draft, "chapter_id") != text(row, "chapter_id")
            {
                return Err("审阅续签已保存稿跨越作品或章节".into());
            }
        }
    }
    Ok(())
}
fn request(row: &BackupRow) -> Result<ApplyInput, String> {
    Ok(ApplyInput {
        authorization_id: required_backup_str(
            row,
            "authorization_id",
            "task_authorization_receipts",
        )?
        .into(),
        operation_id: required_backup_str(row, "operation_id", "task_authorization_receipts")?
            .into(),
        card_id: required_backup_str(row, "card_id", "task_authorization_receipts")?.into(),
        artifact_id: required_backup_str(row, "artifact_id", "task_authorization_receipts")?.into(),
        action: serde_json::from_value(json!(required_backup_str(
            row,
            "action",
            "task_authorization_receipts"
        )?))
        .map_err(|_| "授权回执动作无效".to_string())?,
    })
}
pub(super) fn restore_row(table: &str, mut row: BackupRow) -> Result<BackupRow, String> {
    if table == "task_authorizations" {
        let spec = parsed_json_column(&row, table, "spec_json")?;
        let model = parsed_json_column(&row, table, "model_snapshot_json")?;
        let baseline = parsed_json_column(&row, table, "baseline_json")?;
        row.insert("spec_hash".into(), json!(canonical_value_hash(&spec)?));
        row.insert(
            "model_snapshot_hash".into(),
            json!(canonical_value_hash(
                &task_authorization_baseline::model_identity(&model).map_err(|e| e.to_string())?
            )?),
        );
        row.insert(
            "baseline_hash".into(),
            json!(canonical_value_hash(&baseline)?),
        );
        if text(&row, "status") == Some("active") {
            row.insert("status".into(), json!("expired"));
            row.insert(
                "revision".into(),
                json!(row.get("revision").and_then(Value::as_i64).unwrap_or(1) + 1),
            );
            row.insert(
                "revocation_reason".into(),
                json!("项目副本恢复不继承可执行授权；请明确重新签发"),
            );
        }
    } else if table == "task_authorization_receipts" {
        row.insert(
            "request_hash".into(),
            json!(canonical_value_hash(&json!(request(&row)?))?),
        );
    }
    Ok(row)
}

pub(super) fn restore_manual_review_row(
    table: &str,
    mut row: BackupRow,
) -> Result<BackupRow, String> {
    if table == "artifact_decisions" {
        if let Some(key) =
            text(&row, "idempotency_key").filter(|key| key.starts_with("manual-review-renew-v1:"))
        {
            let identity = format!(
                "{}:{}",
                key,
                required_backup_str(&row, "decision_id", table)?
            );
            row.insert(
                "idempotency_key".into(),
                json!(format!(
                    "manual-review-renew-v1:{}",
                    super::backup_text_hash(&identity)
                )),
            );
        }
    } else if table == "review_authorizations"
        && row
            .get("renewal_preview_json")
            .is_some_and(|v| !v.is_null())
    {
        let mut value = parsed_json_column(&row, table, "renewal_preview_json")?;
        value
            .as_object_mut()
            .ok_or("审阅续签预览不是对象")?
            .remove("previewHash");
        let hash = canonical_value_hash(&value)?;
        value["previewHash"] = json!(hash);
        row.insert("renewal_preview_json".into(), json!(value.to_string()));
    }
    Ok(row)
}
