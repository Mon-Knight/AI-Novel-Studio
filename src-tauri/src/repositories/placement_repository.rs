use crate::errors::AppError;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlacementProposalRecord {
    pub proposal_id: String,
    pub artifact_id: String,
    pub candidate_index: i64,
    pub candidate_hash: String,
    pub proposal_type: String,
    pub target_type: String,
    pub target_novel_id: String,
    pub target_id: String,
    pub expected_target_version: i64,
    pub expected_target_hash: String,
    pub effect_payload_json: Value,
    pub proposal_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPlanRecord {
    pub plan_id: String,
    pub proposal_id: String,
    pub operation_id: String,
    pub plan_hash: String,
    pub target_type: String,
    pub target_id: String,
    pub expected_target_version: i64,
    pub expected_target_hash: String,
    pub effect_payload_json: Value,
    pub status: String,
    pub state_revision: i64,
    pub confirmed_by: Option<String>,
    pub user_confirmed_at: Option<String>,
    pub result_json: Option<Value>,
    pub error_json: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
    pub applied_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactTargetLinkRecord {
    pub link_id: String,
    pub artifact_id: String,
    pub proposal_id: String,
    pub apply_plan_id: String,
    pub target_type: String,
    pub target_id: String,
    pub relationship: String,
    pub target_version: i64,
    pub target_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorldSettingRecord {
    pub id: String,
    pub novel_id: String,
    pub title: String,
    pub content: String,
    pub structured_json: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug)]
pub struct NewPlacementProposal<'a> {
    pub proposal_id: &'a str,
    pub artifact_id: &'a str,
    pub candidate_index: i64,
    pub candidate_hash: &'a str,
    pub proposal_type: &'a str,
    pub target_type: &'a str,
    pub target_novel_id: &'a str,
    pub target_id: &'a str,
    pub expected_target_version: i64,
    pub expected_target_hash: &'a str,
    pub effect_payload_json: &'a str,
    pub proposal_hash: &'a str,
    pub created_at: &'a str,
}

#[derive(Debug)]
pub struct NewApplyPlan<'a> {
    pub plan_id: &'a str,
    pub proposal_id: &'a str,
    pub operation_id: &'a str,
    pub plan_hash: &'a str,
    pub target_type: &'a str,
    pub target_id: &'a str,
    pub expected_target_version: i64,
    pub expected_target_hash: &'a str,
    pub effect_payload_json: &'a str,
    pub created_at: &'a str,
}

fn json_column(row: &Row<'_>, index: usize) -> rusqlite::Result<Value> {
    let raw: String = row.get(index)?;
    serde_json::from_str(&raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn optional_json_column(row: &Row<'_>, index: usize) -> rusqlite::Result<Option<Value>> {
    let raw: Option<String> = row.get(index)?;
    raw.map(|value| {
        serde_json::from_str(&value).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                index,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })
    })
    .transpose()
}

fn map_proposal(row: &Row<'_>) -> rusqlite::Result<PlacementProposalRecord> {
    Ok(PlacementProposalRecord {
        proposal_id: row.get(0)?,
        artifact_id: row.get(1)?,
        candidate_index: row.get(2)?,
        candidate_hash: row.get(3)?,
        proposal_type: row.get(4)?,
        target_type: row.get(5)?,
        target_novel_id: row.get(6)?,
        target_id: row.get(7)?,
        expected_target_version: row.get(8)?,
        expected_target_hash: row.get(9)?,
        effect_payload_json: json_column(row, 10)?,
        proposal_hash: row.get(11)?,
        created_at: row.get(12)?,
    })
}

const PROPOSAL_SELECT: &str = "SELECT proposal_id, artifact_id, candidate_index,
    candidate_hash, proposal_type, target_type, target_novel_id, target_id,
    expected_target_version, expected_target_hash, effect_payload_json, proposal_hash,
    created_at FROM placement_proposals";

fn map_plan(row: &Row<'_>) -> rusqlite::Result<ApplyPlanRecord> {
    Ok(ApplyPlanRecord {
        plan_id: row.get(0)?,
        proposal_id: row.get(1)?,
        operation_id: row.get(2)?,
        plan_hash: row.get(3)?,
        target_type: row.get(4)?,
        target_id: row.get(5)?,
        expected_target_version: row.get(6)?,
        expected_target_hash: row.get(7)?,
        effect_payload_json: json_column(row, 8)?,
        status: row.get(9)?,
        state_revision: row.get(10)?,
        confirmed_by: row.get(11)?,
        user_confirmed_at: row.get(12)?,
        result_json: optional_json_column(row, 13)?,
        error_json: optional_json_column(row, 14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
        applied_at: row.get(17)?,
    })
}

const PLAN_SELECT: &str = "SELECT plan_id, proposal_id, operation_id, plan_hash,
    target_type, target_id, expected_target_version, expected_target_hash,
    effect_payload_json, status, state_revision, confirmed_by, user_confirmed_at,
    result_json, error_json, created_at, updated_at, applied_at FROM apply_plans";

fn map_link(row: &Row<'_>) -> rusqlite::Result<ArtifactTargetLinkRecord> {
    Ok(ArtifactTargetLinkRecord {
        link_id: row.get(0)?,
        artifact_id: row.get(1)?,
        proposal_id: row.get(2)?,
        apply_plan_id: row.get(3)?,
        target_type: row.get(4)?,
        target_id: row.get(5)?,
        relationship: row.get(6)?,
        target_version: row.get(7)?,
        target_hash: row.get(8)?,
        created_at: row.get(9)?,
    })
}

const LINK_SELECT: &str = "SELECT link_id, artifact_id, proposal_id, apply_plan_id,
    target_type, target_id, relationship, target_version, target_hash, created_at
    FROM artifact_target_links";

fn map_world_setting(row: &Row<'_>) -> rusqlite::Result<WorldSettingRecord> {
    Ok(WorldSettingRecord {
        id: row.get(0)?,
        novel_id: row.get(1)?,
        title: row.get(2)?,
        content: row.get(3)?,
        structured_json: row.get(4)?,
        is_active: row.get::<_, i64>(5)? != 0,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

pub fn insert_proposal(
    connection: &Connection,
    proposal: &NewPlacementProposal<'_>,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO placement_proposals
             (proposal_id, artifact_id, candidate_index, candidate_hash, proposal_type,
              target_type, target_novel_id, target_id, expected_target_version,
              expected_target_hash, effect_payload_json, proposal_hash, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![
                proposal.proposal_id,
                proposal.artifact_id,
                proposal.candidate_index,
                proposal.candidate_hash,
                proposal.proposal_type,
                proposal.target_type,
                proposal.target_novel_id,
                proposal.target_id,
                proposal.expected_target_version,
                proposal.expected_target_hash,
                proposal.effect_payload_json,
                proposal.proposal_hash,
                proposal.created_at,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

pub fn insert_plan(connection: &Connection, plan: &NewApplyPlan<'_>) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO apply_plans
             (plan_id, proposal_id, operation_id, plan_hash, target_type, target_id,
              expected_target_version, expected_target_hash, effect_payload_json, status,
              state_revision, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'awaiting_confirmation',0,?10,?10)",
            params![
                plan.plan_id,
                plan.proposal_id,
                plan.operation_id,
                plan.plan_hash,
                plan.target_type,
                plan.target_id,
                plan.expected_target_version,
                plan.expected_target_hash,
                plan.effect_payload_json,
                plan.created_at,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

pub fn find_proposal(
    connection: &Connection,
    proposal_id: &str,
) -> Result<Option<PlacementProposalRecord>, AppError> {
    connection
        .query_row(
            &format!("{PROPOSAL_SELECT} WHERE proposal_id=?1"),
            params![proposal_id],
            map_proposal,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn find_proposal_by_artifact_candidate(
    connection: &Connection,
    artifact_id: &str,
    candidate_index: i64,
) -> Result<Option<PlacementProposalRecord>, AppError> {
    connection
        .query_row(
            &format!("{PROPOSAL_SELECT} WHERE artifact_id=?1 AND candidate_index=?2"),
            params![artifact_id, candidate_index],
            map_proposal,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn find_plan(
    connection: &Connection,
    plan_id: &str,
) -> Result<Option<ApplyPlanRecord>, AppError> {
    connection
        .query_row(
            &format!("{PLAN_SELECT} WHERE plan_id=?1"),
            params![plan_id],
            map_plan,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn find_plan_by_proposal(
    connection: &Connection,
    proposal_id: &str,
) -> Result<Option<ApplyPlanRecord>, AppError> {
    connection
        .query_row(
            &format!("{PLAN_SELECT} WHERE proposal_id=?1"),
            params![proposal_id],
            map_plan,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn find_link_by_plan(
    connection: &Connection,
    plan_id: &str,
) -> Result<Option<ArtifactTargetLinkRecord>, AppError> {
    connection
        .query_row(
            &format!("{LINK_SELECT} WHERE apply_plan_id=?1"),
            params![plan_id],
            map_link,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn find_world_setting(
    connection: &Connection,
    target_id: &str,
) -> Result<Option<WorldSettingRecord>, AppError> {
    connection
        .query_row(
            "SELECT id, novel_id, title, content, structured_json, is_active, created_at,
                    updated_at FROM world_settings WHERE id=?1",
            params![target_id],
            map_world_setting,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn mark_plan_applying(
    connection: &Connection,
    plan: &ApplyPlanRecord,
    confirmed_at: &str,
) -> Result<bool, AppError> {
    let affected = connection
        .execute(
            "UPDATE apply_plans
             SET status='applying', state_revision=state_revision+1, confirmed_by='user',
                 user_confirmed_at=?1, updated_at=?1
             WHERE plan_id=?2 AND status='awaiting_confirmation' AND state_revision=?3",
            params![confirmed_at, plan.plan_id, plan.state_revision],
        )
        .map_err(AppError::database)?;
    Ok(affected == 1)
}

pub fn mark_plan_applied(
    connection: &Connection,
    plan: &ApplyPlanRecord,
    result_json: &str,
    applied_at: &str,
) -> Result<bool, AppError> {
    let affected = connection
        .execute(
            "UPDATE apply_plans
             SET status='applied', state_revision=state_revision+1, result_json=?1,
                 error_json=NULL, updated_at=?2, applied_at=?2
             WHERE plan_id=?3 AND status='applying' AND state_revision=?4",
            params![result_json, applied_at, plan.plan_id, plan.state_revision],
        )
        .map_err(AppError::database)?;
    Ok(affected == 1)
}

pub fn mark_plan_conflict(
    connection: &Connection,
    plan: &ApplyPlanRecord,
    error_json: &str,
    updated_at: &str,
) -> Result<bool, AppError> {
    let affected = connection
        .execute(
            "UPDATE apply_plans
             SET status='conflict', state_revision=state_revision+1, error_json=?1,
                 updated_at=?2
             WHERE plan_id=?3 AND status='applying' AND state_revision=?4",
            params![error_json, updated_at, plan.plan_id, plan.state_revision],
        )
        .map_err(AppError::database)?;
    Ok(affected == 1)
}

pub fn insert_world_setting(
    connection: &Connection,
    target_id: &str,
    novel_id: &str,
    title: &str,
    content: &str,
    now: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO world_settings
             (id, novel_id, title, content, structured_json, is_active, created_at, updated_at)
             VALUES (?1,?2,?3,?4,NULL,1,?5,?5)",
            params![target_id, novel_id, title, content, now],
        )
        .map_err(AppError::database)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn insert_link(
    connection: &Connection,
    link_id: &str,
    artifact_id: &str,
    proposal_id: &str,
    plan_id: &str,
    target_type: &str,
    target_id: &str,
    target_hash: &str,
    created_at: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO artifact_target_links
             (link_id, artifact_id, proposal_id, apply_plan_id, target_type, target_id,
              relationship, target_version, target_hash, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,'created_from',1,?7,?8)",
            params![
                link_id,
                artifact_id,
                proposal_id,
                plan_id,
                target_type,
                target_id,
                target_hash,
                created_at,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}
