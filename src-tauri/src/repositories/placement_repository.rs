use crate::domain::placement::{PlacementProposal, PlacementTarget};
use crate::errors::{codes, AppError};
use rusqlite::{params, Connection, OptionalExtension};

#[derive(Debug, Clone)]
pub struct ArtifactPlacementSource {
    pub artifact_id: String,
    pub artifact_type: String,
    pub schema_version: i64,
    pub processing_status: String,
    pub source_novel_id: String,
    pub source_chapter_id: Option<String>,
    pub source_draft_id: Option<String>,
    pub source_draft_version: Option<i64>,
    pub source_base_content_hash: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PlacementTargetState {
    pub novel_id: String,
    pub chapter_id: String,
    pub chapter_updated_at: String,
    pub chapter_deleted: bool,
    pub draft_id: Option<String>,
    pub draft_version: Option<i64>,
    pub draft_hash: Option<String>,
}

pub fn find_artifact_source(
    connection: &Connection,
    artifact_id: &str,
) -> Result<Option<ArtifactPlacementSource>, AppError> {
    connection
        .query_row(
            "SELECT artifact_id, artifact_type, schema_version, processing_status,
                    source_novel_id, source_chapter_id, source_draft_id,
                    source_draft_version, source_base_content_hash
             FROM result_artifacts WHERE artifact_id = ?1",
            params![artifact_id],
            |row| {
                Ok(ArtifactPlacementSource {
                    artifact_id: row.get(0)?,
                    artifact_type: row.get(1)?,
                    schema_version: row.get(2)?,
                    processing_status: row.get(3)?,
                    source_novel_id: row.get(4)?,
                    source_chapter_id: row.get(5)?,
                    source_draft_id: row.get(6)?,
                    source_draft_version: row.get(7)?,
                    source_base_content_hash: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(AppError::database)
}

pub fn read_target_state(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
    draft_id: Option<&str>,
) -> Result<Option<PlacementTargetState>, AppError> {
    let chapter = connection
        .query_row(
            "SELECT novel_id, id, updated_at, deleted_at IS NOT NULL
             FROM chapters WHERE id = ?1 AND novel_id = ?2",
            params![chapter_id, novel_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)? != 0,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?;
    let Some((novel_id, chapter_id, chapter_updated_at, chapter_deleted)) = chapter else {
        return Ok(None);
    };
    let draft = if let Some(draft_id) = draft_id {
        connection
            .query_row(
                "SELECT id, version_no, COALESCE(content_hash, base_content_hash, '')
                 FROM chapter_drafts WHERE id = ?1 AND novel_id = ?2 AND chapter_id = ?3",
                params![draft_id, novel_id, chapter_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(AppError::database)?
    } else {
        None
    };
    Ok(Some(PlacementTargetState {
        novel_id,
        chapter_id,
        chapter_updated_at,
        chapter_deleted,
        draft_id: draft.as_ref().map(|value| value.0.clone()),
        draft_version: draft.as_ref().map(|value| value.1),
        draft_hash: draft.map(|value| value.2).filter(|value| !value.is_empty()),
    }))
}

pub fn insert_proposal(
    connection: &Connection,
    proposal: &PlacementProposal,
) -> Result<(), AppError> {
    let proposal_rows = connection
        .execute(
            "INSERT INTO artifact_placement_proposals
                (proposal_id, artifact_id, parent_proposal_id, schema_version, confidence,
                 reasons_json, warnings_json, unresolved_items_json, project_revision_hash, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                proposal.proposal_id,
                proposal.artifact_id,
                proposal.parent_proposal_id,
                proposal.schema_version,
                proposal.confidence,
                serde_json::to_string(&proposal.reasons).map_err(|_| AppError::database(rusqlite::Error::InvalidQuery))?,
                serde_json::to_string(&proposal.warnings).map_err(|_| AppError::database(rusqlite::Error::InvalidQuery))?,
                serde_json::to_string(&proposal.unresolved_items).map_err(|_| AppError::database(rusqlite::Error::InvalidQuery))?,
                proposal.project_revision_hash,
                proposal.created_at,
            ],
        )
        .map_err(AppError::database)?;
    if proposal_rows != 1 {
        return Err(AppError::new(
            codes::DATABASE_TRANSACTION_FAILED,
            "PlacementProposal 未写入唯一记录",
            false,
        ));
    }
    for (index, target) in proposal.targets.iter().enumerate() {
        let target_rows = connection
            .execute(
                "INSERT INTO artifact_placement_targets
                    (target_row_id, proposal_id, target_index, target_type, target_id,
                     novel_id, chapter_id, draft_id, action, expected_version, expected_hash,
                     source_priority, confidence, reason, is_ready, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    proposal.proposal_id,
                    index as i64,
                    target.target_type,
                    target.target_id,
                    target.novel_id,
                    target.chapter_id,
                    target.draft_id,
                    target.action,
                    target.expected_version,
                    target.expected_hash,
                    target.source_priority,
                    target.confidence,
                    target.reason,
                    i64::from(target.is_ready),
                    proposal.created_at,
                ],
            )
            .map_err(AppError::database)?;
        if target_rows != 1 {
            return Err(AppError::new(
                codes::DATABASE_TRANSACTION_FAILED,
                "PlacementTarget 未写入唯一记录",
                false,
            ));
        }
    }
    Ok(())
}

pub fn get_proposal(
    connection: &Connection,
    proposal_id: &str,
) -> Result<Option<PlacementProposal>, AppError> {
    let header = connection
        .query_row(
            "SELECT proposal_id, artifact_id, parent_proposal_id, schema_version, confidence,
                    reasons_json, warnings_json, unresolved_items_json, project_revision_hash, created_at
             FROM artifact_placement_proposals WHERE proposal_id = ?1",
            params![proposal_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?, row.get::<_, f64>(4)?, row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?, row.get::<_, String>(7)?, row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                ))
            },
        )
        .optional()
        .map_err(AppError::database)?;
    let Some(header) = header else {
        return Ok(None);
    };
    let mut statement = connection
        .prepare(
            "SELECT target_type, target_id, novel_id, chapter_id, draft_id, action,
                    expected_version, expected_hash, source_priority, confidence, reason, is_ready
             FROM artifact_placement_targets WHERE proposal_id = ?1 ORDER BY target_index",
        )
        .map_err(AppError::database)?;
    let targets = statement
        .query_map(params![proposal_id], |row| {
            Ok(PlacementTarget {
                target_type: row.get(0)?,
                target_id: row.get(1)?,
                novel_id: row.get(2)?,
                chapter_id: row.get(3)?,
                draft_id: row.get(4)?,
                action: row.get(5)?,
                expected_version: row.get(6)?,
                expected_hash: row.get(7)?,
                source_priority: row.get(8)?,
                confidence: row.get(9)?,
                reason: row.get(10)?,
                is_ready: row.get::<_, i64>(11)? != 0,
            })
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(Some(PlacementProposal {
        proposal_id: header.0,
        artifact_id: header.1,
        parent_proposal_id: header.2,
        schema_version: header.3,
        confidence: header.4,
        reasons: serde_json::from_str(&header.5).unwrap_or_default(),
        warnings: serde_json::from_str(&header.6).unwrap_or_default(),
        unresolved_items: serde_json::from_str(&header.7).unwrap_or_default(),
        project_revision_hash: header.8,
        created_at: header.9,
        targets,
    }))
}
