use crate::domain::apply_plan::{
    ApplyConflict, ApplyDependency, ApplyOperation, ApplyPlan, ApplyPlanStatus,
};
use crate::errors::{codes, AppError};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

fn parse_status(value: &str) -> Result<ApplyPlanStatus, AppError> {
    match value {
        "draft" => Ok(ApplyPlanStatus::Draft),
        "validated" => Ok(ApplyPlanStatus::Validated),
        "blocked" => Ok(ApplyPlanStatus::Blocked),
        "ready" => Ok(ApplyPlanStatus::Ready),
        "applying" => Ok(ApplyPlanStatus::Applying),
        "completed" => Ok(ApplyPlanStatus::Completed),
        "failed" => Ok(ApplyPlanStatus::Failed),
        "commit_unknown" => Ok(ApplyPlanStatus::CommitUnknown),
        "cancelled" => Ok(ApplyPlanStatus::Cancelled),
        _ => Err(AppError::new(
            codes::APPLY_PLAN_ILLEGAL_TRANSITION,
            "未知 ApplyPlan 状态",
            false,
        )),
    }
}

pub fn insert_plan(connection: &Connection, plan: &ApplyPlan) -> Result<(), AppError> {
    let plan_rows = connection
        .execute(
            "INSERT INTO artifact_apply_plans
            (plan_id, proposal_id, artifact_id, parent_plan_id, schema_version,
             expected_versions_json, expected_hashes_json, conflicts_json,
             operation_id, request_hash, status, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                plan.plan_id,
                plan.proposal_id,
                plan.artifact_id,
                plan.parent_plan_id,
                plan.schema_version,
                plan.expected_versions.to_string(),
                plan.expected_hashes.to_string(),
                serde_json::to_string(&plan.conflicts).unwrap_or_else(|_| "[]".to_string()),
                plan.operation_id,
                plan.request_hash,
                plan.status.as_str(),
                plan.created_at,
            ],
        )
        .map_err(AppError::database)?;
    if plan_rows != 1 {
        return Err(AppError::new(
            codes::DATABASE_TRANSACTION_FAILED,
            "ApplyPlan 未写入唯一记录",
            false,
        ));
    }
    for operation in &plan.operations {
        let operation_rows = connection
            .execute(
                "INSERT INTO artifact_apply_operations
                (apply_operation_id, plan_id, operation_index, target_type, target_id, action,
                 payload_json, payload_hash, expected_version, expected_hash, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                params![
                    operation.apply_operation_id,
                    plan.plan_id,
                    operation.operation_index,
                    operation.target_type,
                    operation.target_id,
                    operation.action,
                    operation.payload.to_string(),
                    operation.payload_hash,
                    operation.expected_version,
                    operation.expected_hash,
                    plan.created_at
                ],
            )
            .map_err(AppError::database)?;
        if operation_rows != 1 {
            return Err(AppError::new(
                codes::DATABASE_TRANSACTION_FAILED,
                "ApplyOperation 未写入唯一记录",
                false,
            ));
        }
    }
    for dependency in &plan.dependencies {
        let dependency_rows = connection
            .execute(
                "INSERT INTO artifact_apply_dependencies
                (dependency_id, plan_id, operation_id, depends_on_operation_id, created_at)
             VALUES (?1,?2,?3,?4,?5)",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    plan.plan_id,
                    dependency.operation_id,
                    dependency.depends_on_operation_id,
                    plan.created_at
                ],
            )
            .map_err(AppError::database)?;
        if dependency_rows != 1 {
            return Err(AppError::new(
                codes::DATABASE_TRANSACTION_FAILED,
                "ApplyDependency 未写入唯一记录",
                false,
            ));
        }
    }
    Ok(())
}

pub fn get_plan(connection: &Connection, plan_id: &str) -> Result<Option<ApplyPlan>, AppError> {
    let header = connection
        .query_row(
            "SELECT plan_id, proposal_id, artifact_id, parent_plan_id, schema_version,
                expected_versions_json, expected_hashes_json, conflicts_json,
                operation_id, request_hash, status, result_json, created_at, completed_at
         FROM artifact_apply_plans WHERE plan_id = ?1",
            params![plan_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, String>(12)?,
                    row.get::<_, Option<String>>(13)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?;
    let Some(h) = header else {
        return Ok(None);
    };
    let mut statement = connection
        .prepare(
            "SELECT apply_operation_id, operation_index, target_type, target_id, action,
                payload_json, payload_hash, expected_version, expected_hash
         FROM artifact_apply_operations WHERE plan_id = ?1 ORDER BY operation_index",
        )
        .map_err(AppError::database)?;
    let operations = statement
        .query_map(params![plan_id], |row| {
            let payload: String = row.get(5)?;
            Ok(ApplyOperation {
                apply_operation_id: row.get(0)?,
                operation_index: row.get(1)?,
                target_type: row.get(2)?,
                target_id: row.get(3)?,
                action: row.get(4)?,
                payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
                payload_hash: row.get(6)?,
                expected_version: row.get(7)?,
                expected_hash: row.get(8)?,
            })
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    let mut dependency_statement = connection
        .prepare(
            "SELECT operation_id, depends_on_operation_id FROM artifact_apply_dependencies
         WHERE plan_id = ?1 ORDER BY operation_id, depends_on_operation_id",
        )
        .map_err(AppError::database)?;
    let dependencies = dependency_statement
        .query_map(params![plan_id], |row| {
            Ok(ApplyDependency {
                operation_id: row.get(0)?,
                depends_on_operation_id: row.get(1)?,
            })
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(Some(ApplyPlan {
        plan_id: h.0,
        proposal_id: h.1,
        artifact_id: h.2,
        parent_plan_id: h.3,
        schema_version: h.4,
        expected_versions: serde_json::from_str(&h.5).unwrap_or(Value::Null),
        expected_hashes: serde_json::from_str(&h.6).unwrap_or(Value::Null),
        conflicts: serde_json::from_str::<Vec<ApplyConflict>>(&h.7).unwrap_or_default(),
        operation_id: h.8,
        request_hash: h.9,
        status: parse_status(&h.10)?,
        result: h.11.and_then(|value| serde_json::from_str(&value).ok()),
        created_at: h.12,
        completed_at: h.13,
        operations,
        dependencies,
    }))
}

pub fn cas_status(
    connection: &Connection,
    plan_id: &str,
    from: &str,
    to: &str,
) -> Result<(), AppError> {
    let affected = connection
        .execute(
            "UPDATE artifact_apply_plans SET status = ?1 WHERE plan_id = ?2 AND status = ?3",
            params![to, plan_id, from],
        )
        .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::APPLY_PLAN_ILLEGAL_TRANSITION,
            "ApplyPlan 状态已变化",
            false,
        ));
    }
    Ok(())
}

pub fn complete(
    connection: &Connection,
    plan_id: &str,
    result: &Value,
    completed_at: &str,
) -> Result<(), AppError> {
    let affected = connection.execute(
        "UPDATE artifact_apply_plans SET status = 'completed', result_json = ?1, completed_at = ?2
         WHERE plan_id = ?3 AND status = 'applying'",
        params![result.to_string(), completed_at, plan_id],
    ).map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::APPLY_PLAN_ILLEGAL_TRANSITION,
            "ApplyPlan 完成状态写入失败",
            false,
        ));
    }
    Ok(())
}
