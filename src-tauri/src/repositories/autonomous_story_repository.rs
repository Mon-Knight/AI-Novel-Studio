use crate::errors::{codes, AppError};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct AutonomousPlanRow {
    pub plan_id: String,
    pub operation_id: String,
    pub novel_id: String,
    pub request_hash: String,
    pub schema_version: i64,
    pub status: String,
    pub revision: i64,
    pub plan: Value,
    pub created_at: String,
}

pub struct StoreAutonomousPlan<'a> {
    pub plan_id: &'a str,
    pub operation_id: &'a str,
    pub novel_id: &'a str,
    pub request_hash: &'a str,
    pub schema_version: i64,
    pub status: &'a str,
    pub stage: &'a str,
    pub revision: i64,
    pub target_chapter_count: i64,
    pub completed_chapter_count: i64,
    pub plan_json: &'a str,
    pub plan_hash: &'a str,
    pub error_message: Option<&'a str>,
    pub created_at: &'a str,
    pub updated_at: &'a str,
    pub completed_at: Option<&'a str>,
    pub applied_at: Option<&'a str>,
}

const PLAN_SELECT: &str = "SELECT plan_id, operation_id, novel_id, request_hash,
    schema_version, status, revision, plan_json, created_at
    FROM autonomous_story_plans";

fn map_plan(row: &Row<'_>) -> rusqlite::Result<AutonomousPlanRow> {
    let plan_json: String = row.get(7)?;
    let plan = serde_json::from_str(&plan_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(AutonomousPlanRow {
        plan_id: row.get(0)?,
        operation_id: row.get(1)?,
        novel_id: row.get(2)?,
        request_hash: row.get(3)?,
        schema_version: row.get(4)?,
        status: row.get(5)?,
        revision: row.get(6)?,
        plan,
        created_at: row.get(8)?,
    })
}

pub fn get_plan(
    connection: &Connection,
    plan_id: &str,
) -> Result<Option<AutonomousPlanRow>, AppError> {
    connection
        .query_row(
            &format!("{PLAN_SELECT} WHERE plan_id = ?1"),
            [plan_id],
            map_plan,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn get_plan_by_operation(
    connection: &Connection,
    operation_id: &str,
) -> Result<Option<AutonomousPlanRow>, AppError> {
    connection
        .query_row(
            &format!("{PLAN_SELECT} WHERE operation_id = ?1"),
            [operation_id],
            map_plan,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn list_plans_by_novel(
    connection: &Connection,
    novel_id: &str,
    limit: i64,
) -> Result<Vec<AutonomousPlanRow>, AppError> {
    let mut statement = connection
        .prepare(&format!(
            "{PLAN_SELECT} WHERE novel_id = ?1 ORDER BY created_at DESC, plan_id DESC LIMIT ?2"
        ))
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![novel_id, limit], map_plan)
        .map_err(AppError::database)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)
}

pub fn insert_plan(
    transaction: &Transaction<'_>,
    plan: &StoreAutonomousPlan<'_>,
) -> Result<(), AppError> {
    transaction
        .execute(
            "INSERT INTO autonomous_story_plans (
                plan_id, operation_id, novel_id, request_hash, schema_version,
                status, stage, revision, target_chapter_count, completed_chapter_count,
                plan_json, plan_hash, error_message, created_at, updated_at,
                completed_at, applied_at
             ) VALUES (
                ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17
             )",
            params![
                plan.plan_id,
                plan.operation_id,
                plan.novel_id,
                plan.request_hash,
                plan.schema_version,
                plan.status,
                plan.stage,
                plan.revision,
                plan.target_chapter_count,
                plan.completed_chapter_count,
                plan.plan_json,
                plan.plan_hash,
                plan.error_message,
                plan.created_at,
                plan.updated_at,
                plan.completed_at,
                plan.applied_at,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

pub fn update_plan(
    transaction: &Transaction<'_>,
    plan: &StoreAutonomousPlan<'_>,
    expected_revision: i64,
) -> Result<(), AppError> {
    let affected = transaction
        .execute(
            "UPDATE autonomous_story_plans SET
                status=?1, stage=?2, revision=?3,
                target_chapter_count=?4, completed_chapter_count=?5,
                plan_json=?6, plan_hash=?7, error_message=?8,
                updated_at=?9, completed_at=?10, applied_at=?11
             WHERE plan_id=?12 AND revision=?13",
            params![
                plan.status,
                plan.stage,
                plan.revision,
                plan.target_chapter_count,
                plan.completed_chapter_count,
                plan.plan_json,
                plan.plan_hash,
                plan.error_message,
                plan.updated_at,
                plan.completed_at,
                plan.applied_at,
                plan.plan_id,
                expected_revision,
            ],
        )
        .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::AUTONOMOUS_PLAN_STATE_CONFLICT,
            "自主创作计划 revision 已变化",
            true,
        ));
    }
    Ok(())
}
