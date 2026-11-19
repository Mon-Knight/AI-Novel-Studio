//! Durable application receipts and conservative root-task accounting.
use super::super::task_authorization_contract::*;
use super::error;
use crate::{errors::AppError, services::ai_fact_security};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

const SELECT:&str="SELECT receipt_id,authorization_id,operation_id,conversation_id,novel_id,artifact_id,card_id,action,before_hash,after_hash,result_json,created_at FROM task_authorization_receipts";
fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Receipt> {
    let action: String = r.get(7)?;
    let raw: String = r.get(10)?;
    let invalid =
        |e| rusqlite::Error::FromSqlConversionFailure(10, rusqlite::types::Type::Text, Box::new(e));
    Ok(Receipt {
        receipt_id: r.get(0)?,
        authorization_id: r.get(1)?,
        operation_id: r.get(2)?,
        conversation_id: r.get(3)?,
        novel_id: r.get(4)?,
        artifact_id: r.get(5)?,
        card_id: r.get(6)?,
        action: serde_json::from_value(Value::String(action)).map_err(invalid)?,
        authority: "task_preauthorized".into(),
        before_hash: r.get(8)?,
        after_hash: r.get(9)?,
        result: serde_json::from_str(&raw).map_err(invalid)?,
        created_at: r.get(11)?,
        replayed: false,
    })
}
pub(super) fn replay(conn: &Connection, input: &ApplyInput) -> Result<Option<Receipt>, AppError> {
    let hash = ai_fact_security::canonical_hash(
        &serde_json::to_value(input)
            .map_err(|_| error("TASK_AUTHORIZATION_INPUT_INVALID", "应用身份无效"))?,
    )?;
    let existing: Option<String> = conn
        .query_row(
            "SELECT request_hash FROM task_authorization_receipts WHERE operation_id=?1",
            [&input.operation_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(AppError::database)?;
    let Some(stored) = existing else {
        return Ok(None);
    };
    if hash != stored {
        return Err(error(
            "TASK_AUTHORIZATION_IDEMPOTENCY_CONFLICT",
            "相同操作已绑定不同的授权、动作或候选",
        ));
    }
    let mut receipt = conn
        .query_row(
            &format!("{SELECT} WHERE operation_id=?1"),
            [&input.operation_id],
            row,
        )
        .map_err(AppError::database)?;
    // A receipt reports a committed historical fact; revocation never rewrites it.
    receipt.replayed = true;
    Ok(Some(receipt))
}
pub(super) fn list(conn: &Connection, id: &str) -> Result<Vec<Receipt>, AppError> {
    conn.prepare(&format!(
        "{SELECT} WHERE authorization_id=?1 ORDER BY created_at,receipt_id"
    ))
    .map_err(AppError::database)?
    .query_map([id], row)
    .map_err(AppError::database)?
    .collect::<Result<_, _>>()
    .map_err(AppError::database)
}
pub(super) fn validate_budget(conn: &Connection, grant: &Authorization) -> Result<(), AppError> {
    let usage = crate::services::dsh::task_runtime::usage_for_root(
        conn,
        &grant.conversation_id,
        &grant.source_turn_id,
    )?;
    if !usage.usage_known
        || [
            usage.requests,
            usage.tools,
            usage.revisions,
            usage.token_input,
            usage.token_output,
            usage.elapsed_ms,
        ]
        .iter()
        .any(|v| *v < 0)
        || !usage.cost_usd.is_finite()
        || usage.cost_usd < 0.0
    {
        return Err(error(
            "TASK_AUTHORIZATION_BUDGET_UNKNOWN",
            "根任务用量或费用不完整，自动写入已暂停",
        ));
    }
    if ai_fact_security::canonical_hash(&super::baseline::model_identity(&usage.model_snapshot)?)?
        != grant.model_snapshot_hash
    {
        return Err(error(
            "TASK_AUTHORIZATION_MODEL_CONFLICT",
            "根任务累计费用使用的冻结模型与授权不一致",
        ));
    }
    let b = &grant.spec.budget;
    if usage.requests > b.max_requests
        || usage.tools > b.max_tool_calls
        || usage.revisions > b.max_revisions
        || usage.token_input.saturating_add(usage.token_output) > b.max_tokens
        || usage.cost_usd > b.max_cost_usd
        || usage.elapsed_ms > b.max_wall_clock_ms
    {
        return Err(error(
            "TASK_AUTHORIZATION_BUDGET_EXHAUSTED",
            "根任务累计调用、Token、修订、时长或成本已超过授权上限",
        ));
    }
    Ok(())
}
pub(super) fn ensure_quota(
    conn: &Connection,
    grant: &Authorization,
    action: &Action,
) -> Result<(), AppError> {
    let limit = grant
        .spec
        .actions
        .iter()
        .find(|l| l.action == *action)
        .ok_or_else(|| error("TASK_AUTHORIZATION_ACTION_FORBIDDEN", "该动作没有获得授权"))?;
    let used:i64=conn.query_row("SELECT COUNT(*) FROM task_authorization_receipts WHERE authorization_id=?1 AND action=?2",params![grant.authorization_id,action.as_str()],|r|r.get(0)).map_err(AppError::database)?;
    if grant.used_writes >= grant.spec.max_writes || used >= limit.max_writes {
        return Err(error(
            "TASK_AUTHORIZATION_QUOTA_EXHAUSTED",
            "正式写入额度已用尽",
        ));
    }
    Ok(())
}
pub(super) fn insert(
    conn: &Connection,
    input: &ApplyInput,
    receipt: &Receipt,
) -> Result<(), AppError> {
    conn.execute("INSERT INTO task_authorization_receipts(receipt_id,authorization_id,operation_id,conversation_id,novel_id,artifact_id,card_id,action,request_hash,before_hash,after_hash,result_json,created_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",params![receipt.receipt_id,receipt.authorization_id,receipt.operation_id,receipt.conversation_id,receipt.novel_id,receipt.artifact_id,receipt.card_id,receipt.action.as_str(),
        ai_fact_security::canonical_hash(&serde_json::to_value(input).map_err(|_|error("TASK_AUTHORIZATION_INPUT_INVALID","应用身份无效"))?)?,receipt.before_hash,receipt.after_hash,receipt.result.to_string(),receipt.created_at])
        .map_err(AppError::database)?;
    Ok(())
}
pub(super) fn advance(
    conn: &Connection,
    grant: &Authorization,
    base: &Value,
) -> Result<(), AppError> {
    let used = grant.used_writes + 1;
    let all_used=grant.spec.actions.iter().map(|limit|conn.query_row("SELECT COUNT(*) FROM task_authorization_receipts WHERE authorization_id=?1 AND action=?2",params![grant.authorization_id,limit.action.as_str()],|r|r.get::<_,i64>(0)).map(|count|count>=limit.max_writes).map_err(AppError::database)).collect::<Result<Vec<_>,_>>()?.into_iter().all(|v|v);
    let changed=conn.execute("UPDATE task_authorizations SET baseline_json=?2,baseline_hash=?3,used_writes=?4,revision=revision+1,status=?5 WHERE authorization_id=?1 AND revision=?6 AND status='active'",
        params![grant.authorization_id,base.to_string(),ai_fact_security::canonical_hash(base)?,used,if used>=grant.spec.max_writes||all_used{"exhausted"}else{"active"},grant.revision]).map_err(AppError::database)?;
    if changed != 1 {
        return Err(error(
            "TASK_AUTHORIZATION_CONFLICT",
            "授权状态或额度并发变化",
        ));
    }
    Ok(())
}
