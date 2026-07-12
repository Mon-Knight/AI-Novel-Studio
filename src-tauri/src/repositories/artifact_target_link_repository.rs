use crate::domain::apply_plan::ArtifactTargetLink;
use crate::errors::{codes, AppError};
use rusqlite::{params, Connection};

pub fn insert_link(connection: &Connection, link: &ArtifactTargetLink) -> Result<(), AppError> {
    let affected = connection
        .execute(
            "INSERT INTO artifact_target_links
            (link_id, artifact_id, plan_id, apply_operation_id, target_type, target_id,
             target_version, target_hash, operation_id, result_metadata_json, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                link.link_id,
                link.artifact_id,
                link.plan_id,
                link.apply_operation_id,
                link.target_type,
                link.target_id,
                link.target_version,
                link.target_hash,
                link.operation_id,
                link.result_metadata.as_ref().map(ToString::to_string),
                link.created_at
            ],
        )
        .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::DATABASE_TRANSACTION_FAILED,
            "ArtifactTargetLink 未写入唯一记录",
            false,
        ));
    }
    Ok(())
}

pub fn list_for_plan(
    connection: &Connection,
    plan_id: &str,
) -> Result<Vec<ArtifactTargetLink>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT link_id, artifact_id, plan_id, apply_operation_id, target_type, target_id,
                target_version, target_hash, operation_id, result_metadata_json, created_at
         FROM artifact_target_links WHERE plan_id = ?1 ORDER BY created_at, link_id",
        )
        .map_err(AppError::database)?;
    let links = statement
        .query_map(params![plan_id], |row| {
            let metadata: Option<String> = row.get(9)?;
            Ok(ArtifactTargetLink {
                link_id: row.get(0)?,
                artifact_id: row.get(1)?,
                plan_id: row.get(2)?,
                apply_operation_id: row.get(3)?,
                target_type: row.get(4)?,
                target_id: row.get(5)?,
                target_version: row.get(6)?,
                target_hash: row.get(7)?,
                operation_id: row.get(8)?,
                result_metadata: metadata.and_then(|value| serde_json::from_str(&value).ok()),
                created_at: row.get(10)?,
            })
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(links)
}
