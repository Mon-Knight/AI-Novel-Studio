//! Bounded native task authority. Model output cannot sign or widen a grant.
use super::task_authorization_baseline::{self as baseline, error};
use super::task_authorization_contract::*;
use crate::{errors::AppError, services::ai_fact_security};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use std::collections::HashSet;
#[path = "task_authorization_apply.rs"]
mod application;
#[cfg(test)]
#[path = "task_authorization_apply_tests.rs"]
mod apply_tests;
#[cfg(test)]
#[path = "task_authorization_policy_tests.rs"]
mod policy_tests;
#[path = "task_authorization_receipts.rs"]
mod receipts;
#[cfg(test)]
#[path = "task_authorization_tests.rs"]
mod tests;
#[cfg(test)]
pub(crate) use {apply_tests::publish as publish_test_candidate, tests::fixture as grant_fixture};
#[path = "task_authorization_review_renewal.rs"]
mod review_renewal;
pub use review_renewal::{preview_review_renewal, renew_review,get_review_renewal,get_review_resume,validate_review_draft_binding};

pub(crate) const COLUMNS: &str = "authorization_id,conversation_id,novel_id,source_turn_id,spec_json,model_snapshot_json,model_snapshot_hash,baseline_hash,status,revision,used_writes,issued_at,expires_at,revoked_at,revocation_reason";
fn from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Authorization> {
    let spec: String = r.get(4)?;
    let model: String = r.get(5)?;
    let parse_error =
        |e| rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e));
    Ok(Authorization {
        authorization_id: r.get(0)?,
        conversation_id: r.get(1)?,
        novel_id: r.get(2)?,
        source_turn_id: r.get(3)?,
        spec: serde_json::from_str(&spec).map_err(parse_error)?,
        model_snapshot: serde_json::from_str(&model).map_err(parse_error)?,
        model_snapshot_hash: r.get(6)?,
        baseline_hash: r.get(7)?,
        status: r.get(8)?,
        revision: r.get(9)?,
        used_writes: r.get(10)?,
        issued_at: r.get(11)?,
        expires_at: r.get(12)?,
        revoked_at: r.get(13)?,
        revocation_reason: r.get(14)?,
    })
}
pub(crate) fn load(conn: &Connection, id: &str) -> Result<Authorization, AppError> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM task_authorizations WHERE authorization_id=?1"),
        [id],
        from_row,
    )
    .optional()
    .map_err(AppError::database)?
    .ok_or_else(|| error("TASK_AUTHORIZATION_NOT_FOUND", "任务预授权不存在"))
}
fn valid_spec(input: &mut IssueInput) -> Result<(), AppError> {
    let invalid = || {
        error(
            "TASK_AUTHORIZATION_INPUT_INVALID",
            "授权必须具有明确作用域、独立动作额度及有限预算和期限",
        )
    };
    for id in [
        &input.conversation_id,
        &input.novel_id,
        &input.source_turn_id,
    ] {
        ai_fact_security::validate_identifier(id, "scope", 160)?;
    }
    input.chapter_ids.sort();
    input.chapter_ids.dedup();
    if input.chapter_ids.len() > 200
        || (input.chapter_ids.is_empty() && !input.allow_novel_planning)
        || !(1..=200).contains(&input.max_writes)
        || input.actions.is_empty()
        || input.actions.len() > 3
    {
        return Err(invalid());
    }
    let mut seen = HashSet::new();
    for action in &input.actions {
        if !seen.insert(action.action.as_str())
            || !(1..=input.max_writes).contains(&action.max_writes)
        {
            return Err(invalid());
        }
    }
    let b = &input.budget;
    if !(1..=10_000).contains(&b.max_requests)
        || !(1..=50_000).contains(&b.max_tool_calls)
        || !(0..=200).contains(&b.max_revisions)
        || !(1..=10_000_000).contains(&b.max_tokens)
        || !b.max_cost_usd.is_finite()
        || b.max_cost_usd <= 0.0
        || b.max_cost_usd > 10_000.0
        || !(1_000..=3_600_000).contains(&b.max_wall_clock_ms)
    {
        return Err(invalid());
    }
    let expires = DateTime::parse_from_rfc3339(&input.expires_at).map_err(|_| invalid())?;
    let remaining = expires.signed_duration_since(Utc::now()).num_milliseconds();
    if remaining <= 0 || remaining > 86_400_000 {
        return Err(invalid());
    }
    if let Some(c) = &input.creation_scope {
        if !input.allow_novel_planning
            || !seen.contains("apply_planning")
            || c.first_volume_index < 1
            || c.last_volume_index < c.first_volume_index
            || c.last_volume_index > 50
            || !(1..=50).contains(&c.max_new_volumes)
            || c.max_new_volumes > c.last_volume_index - c.first_volume_index + 1
            || !(1..=200).contains(&c.max_new_chapters)
        {
            return Err(invalid());
        }
    }
    Ok(())
}
pub fn issue(conn: &mut Connection, mut input: IssueInput) -> Result<Authorization, AppError> {
    valid_spec(&mut input)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let running: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM task_runs WHERE conversation_id=?1 AND status IN ('queued','running','cancel_requested'))",[&input.conversation_id],|row|row.get(0)).map_err(AppError::database)?;
    if running {
        return Err(error("TASK_AUTHORIZATION_TASK_RUNNING", "当前阶段仍在执行；请先停止或等待候选完成，再签发有限授权。授权不会追溯改变已开始请求的预算。"));
    }
    let model = baseline::require_task(&tx, &input)?;
    let identity = baseline::model_identity(&model)?;
    let base = baseline::capture(&tx, &input, &input.chapter_ids)?;
    let id = format!("task-auth-{}", uuid::Uuid::new_v4());
    let now = Utc::now().to_rfc3339();
    tx.execute("INSERT INTO task_authorizations(authorization_id,conversation_id,novel_id,source_turn_id,spec_json,spec_hash,model_snapshot_json,model_snapshot_hash,baseline_json,baseline_hash,status,issued_at,expires_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'active',?11,?12)",params![id,input.conversation_id,input.novel_id,input.source_turn_id,
        serde_json::to_string(&input).map_err(|_|error("TASK_AUTHORIZATION_INPUT_INVALID","授权序列化失败"))?,ai_fact_security::canonical_hash(&json!(input))?,model.to_string(),
        ai_fact_security::canonical_hash(&identity)?,base.to_string(),ai_fact_security::canonical_hash(&base)?,now,input.expires_at]).map_err(AppError::database)?;
    let grant = load(&tx, &id)?;
    tx.commit().map_err(AppError::database)?;
    Ok(grant)
}
pub fn list(conn: &Connection, conversation_id: &str) -> Result<Vec<Authorization>, AppError> {
    let mut grants:Vec<Authorization>=conn.prepare(&format!("SELECT {COLUMNS} FROM task_authorizations WHERE conversation_id=?1 ORDER BY issued_at,authorization_id")).map_err(AppError::database)?
        .query_map([conversation_id],from_row).map_err(AppError::database)?.collect::<Result<_,_>>().map_err(AppError::database)?;
    let now = Utc::now();
    for grant in &mut grants {
        let expired = DateTime::parse_from_rfc3339(&grant.expires_at)
            .map(|v| now >= v)
            .unwrap_or(true)
            || DateTime::parse_from_rfc3339(&grant.issued_at)
                .map(|v| {
                    now.signed_duration_since(v).num_milliseconds()
                        > grant.spec.budget.max_wall_clock_ms
                })
                .unwrap_or(true);
        if grant.status == "active" && expired {
            let changed=conn.execute("UPDATE task_authorizations SET status='expired',revision=revision+1 WHERE authorization_id=?1 AND status='active' AND revision=?2",params![grant.authorization_id,grant.revision]).map_err(AppError::database)?;
            if changed == 1 {
                grant.status = "expired".into();
                grant.revision += 1;
            }
        }
    }
    Ok(grants)
}
pub fn revoke(conn: &mut Connection, input: RevokeInput) -> Result<Authorization, AppError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let grant = load(&tx, &input.authorization_id)?;
    if grant.status == "active" {
        let reason = input.reason.unwrap_or_else(|| "用户撤销".into());
        if reason.chars().count() > 500 {
            return Err(error("TASK_AUTHORIZATION_INPUT_INVALID", "撤销原因过长"));
        }
        tx.execute("UPDATE task_authorizations SET status='revoked',revision=revision+1,revoked_at=?2,revocation_reason=?3 WHERE authorization_id=?1 AND status='active' AND revision=?4",
            params![grant.authorization_id,Utc::now().to_rfc3339(),reason,grant.revision]).map_err(AppError::database)?;
    }
    let result = load(&tx, &grant.authorization_id)?;
    tx.commit().map_err(AppError::database)?;
    Ok(result)
}
pub fn revoke_for_task(
    conn: &Connection,
    conversation_id: &str,
    reason: &str,
) -> Result<(), AppError> {
    conn.execute("UPDATE task_authorizations SET status='revoked',revision=revision+1,revoked_at=?2,revocation_reason=?3 WHERE conversation_id=?1 AND status='active'",
        params![conversation_id,Utc::now().to_rfc3339(),reason]).map_err(AppError::database)?;
    Ok(())
}
pub fn revoke_for_root(
    conn: &Connection,
    conversation_id: &str,
    root_turn_id: &str,
    reason: &str,
) -> Result<(), AppError> {
    conn.execute("UPDATE task_authorizations SET status='revoked',revision=revision+1,revoked_at=?3,revocation_reason=?4 WHERE conversation_id=?1 AND source_turn_id=?2 AND status='active'",params![conversation_id,root_turn_id,Utc::now().to_rfc3339(),reason]).map_err(AppError::database)?;
    Ok(())
}

pub(crate) fn validate_active(
    conn: &Connection,
    grant: &Authorization,
    model: &Value,
) -> Result<Value, AppError> {
    if grant.status != "active" {
        return Err(error(
            "TASK_AUTHORIZATION_INACTIVE",
            "任务授权已撤销、过期或额度用尽",
        ));
    }
    let now = Utc::now();
    let expires = DateTime::parse_from_rfc3339(&grant.expires_at)
        .map_err(|_| error("TASK_AUTHORIZATION_INPUT_INVALID", "授权期限损坏"))?;
    let issued = DateTime::parse_from_rfc3339(&grant.issued_at)
        .map_err(|_| error("TASK_AUTHORIZATION_INPUT_INVALID", "授权时间损坏"))?;
    if now >= expires
        || now.signed_duration_since(issued).num_milliseconds()
            > grant.spec.budget.max_wall_clock_ms
    {
        return Err(error(
            "TASK_AUTHORIZATION_EXPIRED",
            "授权期限或执行时限已到，已停止自动写入",
        ));
    }
    let selected = baseline::require_task(conn, &grant.spec)?;
    for candidate in [model, &selected] {
        if ai_fact_security::canonical_hash(&baseline::model_identity(candidate)?)?
            != grant.model_snapshot_hash
        {
            return Err(error(
                "TASK_AUTHORIZATION_MODEL_CONFLICT",
                "模型或请求配置已变化，请重新授权",
            ));
        }
    }
    let base_text: String = conn
        .query_row(
            "SELECT baseline_json FROM task_authorizations WHERE authorization_id=?1",
            [&grant.authorization_id],
            |r| r.get(0),
        )
        .map_err(AppError::database)?;
    let base: Value = serde_json::from_str(&base_text)
        .map_err(|_| error("TASK_AUTHORIZATION_BASELINE_INVALID", "授权基线损坏"))?;
    let current = baseline::capture(conn, &grant.spec, &baseline::tracked(&base))?;
    if ai_fact_security::canonical_hash(&base)? != grant.baseline_hash || current != base {
        return Err(error(
            "TASK_AUTHORIZATION_BASE_CONFLICT",
            "作品或章节已被修改，原授权基线失效；请人工处理",
        ));
    }
    Ok(base)
}
pub fn execution_authorization(
    conn: &Connection,
    conversation_id: &str,
    root_turn_id: &str,
    model: &Value,
) -> Result<Option<Authorization>, AppError> {
    let active: Vec<_> = list(conn, conversation_id)?
        .into_iter()
        .filter(|g| g.status == "active" && g.source_turn_id == root_turn_id)
        .collect();
    if active.len() > 1 {
        return Err(error(
            "TASK_AUTHORIZATION_AMBIGUOUS",
            "同一任务有多份活动授权，请先撤销旧授权",
        ));
    }
    let Some(grant) = active.into_iter().next() else {
        return Ok(None);
    };
    validate_active(conn, &grant, model)?;
    Ok(Some(grant))
}
pub fn apply(conn: &mut Connection, input: ApplyInput) -> Result<Receipt, AppError> {
    application::apply(conn, input)
}
pub fn list_receipts(conn: &Connection, id: &str) -> Result<Vec<Receipt>, AppError> {
    receipts::list(conn, id)
}
pub fn try_apply_candidate(
    conn: &mut Connection,
    conversation_id: &str,
    root_turn_id: &str,
    card_id: &str,
    artifact_id: &str,
) -> Result<Option<Receipt>, AppError> {
    let bundle = crate::services::artifact_service::get_artifact_bundle(conn, artifact_id)?;
    let action = match bundle.artifact.artifact_type.as_str() {
        "outline" => Action::ApplyPlanning,
        "chapter_text" => Action::AdoptChapterText,
        "chapter_summary" => Action::ApplySummary,
        _ => return Ok(None),
    };
    let grants: Vec<_> = list(conn, conversation_id)?
        .into_iter()
        .filter(|g| {
            g.status == "active"
                && g.source_turn_id == root_turn_id
                && g.spec.actions.iter().any(|a| a.action == action)
        })
        .collect();
    if grants.len() > 1 {
        return Err(error(
            "TASK_AUTHORIZATION_AMBIGUOUS",
            "存在多份可覆盖本动作的授权，请先撤销旧授权",
        ));
    }
    let Some(grant) = grants.into_iter().next() else {
        return Ok(None);
    };
    apply(
        conn,
        ApplyInput {
            authorization_id: grant.authorization_id,
            operation_id: format!("auto:{card_id}:{}", action.as_str()),
            card_id: card_id.into(),
            artifact_id: artifact_id.into(),
            action,
        },
    )
    .map(Some)
}
