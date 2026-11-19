use super::{apply_usage, current_clock, policy_error};
use crate::errors::{codes, AppError};
use crate::repositories::large_text_repository;
use rusqlite::{params, Connection, TransactionBehavior};

/// Conservatively settle orphaned `'active'` AI request reservations left behind
/// when a host process terminates mid-request. Runs at database startup before
/// any worker exists so neither global concurrency slots nor root retry
/// accounting stay permanently stranded.
pub fn recover_interrupted_reservations(connection: &mut Connection) -> Result<usize, AppError> {
    let (now_ms, _) = current_clock();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let active = {
        let mut statement = transaction
            .prepare(
                "SELECT reservation_id,day_key,started_at_ms,estimated_input_tokens,
                        estimated_output_tokens,estimated_cost_units
                 FROM ai_request_reservations
                 WHERE status='active'
                 ORDER BY started_at_ms ASC,reservation_id ASC",
            )
            .map_err(AppError::database)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                ))
            })
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        rows
    };

    for (reservation_id, day_key, started_at_ms, token_input, token_output, cost_units) in &active {
        let settled_at_ms = now_ms.max(*started_at_ms);
        let settlement_hash =
            large_text_repository::sha256(&format!("startup-interrupted|{reservation_id}"));
        apply_usage(
            &transaction,
            day_key,
            *token_input,
            *token_output,
            *cost_units,
            true,
            true,
            false,
            settled_at_ms,
        )?;
        let changed = transaction
            .execute(
                "UPDATE ai_request_reservations
                 SET status='failed',settlement_hash=?2,
                     accounted_input_tokens=estimated_input_tokens,
                     accounted_output_tokens=estimated_output_tokens,
                     accounted_cost_units=estimated_cost_units,
                     accounted_cost_status=CASE WHEN estimated_cost_units IS NULL
                                                THEN 'unpriced' ELSE 'complete' END,
                     settled_at_ms=?3
                 WHERE reservation_id=?1 AND status='active'",
                params![reservation_id, settlement_hash, settled_at_ms],
            )
            .map_err(AppError::database)?;
        if changed != 1 {
            return Err(policy_error(
                codes::AI_REQUEST_POLICY_LEASE_CONFLICT,
                "AI 请求中断恢复发生并发冲突。",
                true,
            ));
        }
    }
    transaction.commit().map_err(AppError::database)?;
    Ok(active.len())
}
