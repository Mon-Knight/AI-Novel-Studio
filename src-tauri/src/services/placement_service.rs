use crate::domain::placement::{
    CreatePlacementProposalInput, PlacementProposal, PlacementTarget, ProposalValidation,
    PLACEMENT_SCHEMA_VERSION,
};
use crate::errors::{codes, AppError};
use crate::repositories::{large_text_repository, placement_repository};
use crate::services::constraint_validation_service;
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};

fn project_revision_hash(
    artifact_id: &str,
    state: &placement_repository::PlacementTargetState,
) -> String {
    large_text_repository::sha256(
        &serde_json::json!({
            "artifactId": artifact_id,
            "novelId": state.novel_id,
            "chapterId": state.chapter_id,
            "chapterUpdatedAt": state.chapter_updated_at,
            "chapterDeleted": state.chapter_deleted,
            "draftId": state.draft_id,
            "draftVersion": state.draft_version,
            "draftHash": state.draft_hash,
        })
        .to_string(),
    )
}

fn target_from_state(
    state: &placement_repository::PlacementTargetState,
    source_priority: i64,
    reason: &str,
    is_ready: bool,
) -> PlacementTarget {
    PlacementTarget {
        target_type: "chapter".to_string(),
        target_id: state.chapter_id.clone(),
        novel_id: state.novel_id.clone(),
        chapter_id: Some(state.chapter_id.clone()),
        draft_id: state.draft_id.clone(),
        action: "save_and_adopt_chapter_text".to_string(),
        expected_version: state.draft_version,
        expected_hash: state.draft_hash.clone(),
        source_priority,
        confidence: if source_priority == 1 { 1.0 } else { 0.95 },
        reason: reason.to_string(),
        is_ready,
    }
}

pub fn create_proposal(
    connection: &mut Connection,
    input: CreatePlacementProposalInput,
) -> Result<PlacementProposal, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let artifact = placement_repository::find_artifact_source(&transaction, &input.artifact_id)?
        .ok_or_else(|| {
            AppError::new(codes::ARTIFACT_VALIDATION_FAILED, "Artifact 不存在", false)
        })?;
    if artifact.processing_status != "valid" && artifact.processing_status != "valid_with_warnings"
    {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "Artifact 尚未通过校验",
            false,
        ));
    }
    constraint_validation_service::ensure_latest_allows_apply(&transaction, &input.artifact_id)?;
    if artifact.artifact_type != "chapter_text" {
        if !matches!(
            artifact.artifact_type.as_str(),
            "quality_report"
                | "chapter_summary"
                | "volume_summary"
                | "outline_text"
                | "volume_outline"
                | "chapter_outlines"
                | "generic_json"
        ) {
            return Err(AppError::new(
                codes::PLACEMENT_TARGET_UNRESOLVED,
                "Artifact 类型不能进入审查确认",
                false,
            ));
        }
        let project_revision_hash = large_text_repository::sha256(
            &serde_json::json!({
                "artifactId": artifact.artifact_id,
                "artifactType": artifact.artifact_type,
                "processingStatus": artifact.processing_status,
            })
            .to_string(),
        );
        let target = PlacementTarget {
            target_type: "artifact_review".into(),
            target_id: artifact.artifact_id.clone(),
            novel_id: artifact.source_novel_id.clone(),
            chapter_id: artifact.source_chapter_id.clone(),
            draft_id: artifact.source_draft_id.clone(),
            action: "confirm_artifact_review".into(),
            expected_version: artifact.source_draft_version,
            expected_hash: artifact.source_base_content_hash.clone(),
            source_priority: 1,
            confidence: 1.0,
            reason: "AI 候选等待用户审查确认".into(),
            is_ready: true,
        };
        let proposal = PlacementProposal {
            proposal_id: uuid::Uuid::new_v4().to_string(),
            artifact_id: artifact.artifact_id,
            parent_proposal_id: input.parent_proposal_id,
            schema_version: PLACEMENT_SCHEMA_VERSION,
            targets: vec![target],
            confidence: 1.0,
            reasons: vec!["用户确认只记录审查证据，不自动写入作品".into()],
            warnings: Vec::new(),
            unresolved_items: Vec::new(),
            project_revision_hash,
            created_at: Utc::now().to_rfc3339(),
        };
        placement_repository::insert_proposal(&transaction, &proposal)?;
        transaction.commit().map_err(AppError::database)?;
        return Ok(proposal);
    }
    let source_chapter_id = artifact.source_chapter_id.as_deref().ok_or_else(|| {
        AppError::new(
            codes::PLACEMENT_TARGET_UNRESOLVED,
            "Artifact 缺少来源章节",
            false,
        )
    })?;
    let source_state = placement_repository::read_target_state(
        &transaction,
        &artifact.source_novel_id,
        source_chapter_id,
        artifact.source_draft_id.as_deref(),
    )?
    .ok_or_else(|| AppError::new(codes::TARGET_NOT_FOUND, "Task scope 章节不存在", false))?;
    if source_state.chapter_deleted
        || (artifact.source_draft_id.is_some() && source_state.draft_id.is_none())
    {
        return Err(AppError::new(
            codes::TARGET_NOT_FOUND,
            "Task scope 目标已删除",
            false,
        ));
    }
    if artifact.source_draft_version != source_state.draft_version
        || artifact.source_base_content_hash.as_deref() != source_state.draft_hash.as_deref()
    {
        return Err(AppError::new(
            codes::PLACEMENT_PROPOSAL_STALE,
            "Artifact 来源版本或正文哈希已变化",
            false,
        ));
    }
    if artifact.schema_version < 1 {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "Artifact schemaVersion 无效",
            false,
        ));
    }

    let mut targets = Vec::new();
    let selected_state = if let Some(target) = input.target.as_ref() {
        if target.novel_id != artifact.source_novel_id {
            return Err(AppError::new(
                codes::TARGET_SCOPE_MISMATCH,
                "用户目标不属于 Artifact 作品",
                false,
            ));
        }
        let state = placement_repository::read_target_state(
            &transaction,
            &target.novel_id,
            &target.chapter_id,
            target.draft_id.as_deref(),
        )?
        .ok_or_else(|| AppError::new(codes::TARGET_NOT_FOUND, "用户指定目标不存在", false))?;
        if state.chapter_deleted {
            return Err(AppError::new(
                codes::TARGET_NOT_FOUND,
                "用户指定目标已删除",
                false,
            ));
        }
        targets.push(target_from_state(&state, 1, "用户显式指定目标", true));
        if state.chapter_id != source_state.chapter_id || state.draft_id != source_state.draft_id {
            targets.push(target_from_state(
                &source_state,
                2,
                "Task scope 候选目标",
                false,
            ));
        }
        state
    } else {
        targets.push(target_from_state(
            &source_state,
            2,
            "Task scope 权威目标",
            true,
        ));
        source_state
    };
    let project_revision_hash = project_revision_hash(&artifact.artifact_id, &selected_state);
    let proposal = PlacementProposal {
        proposal_id: uuid::Uuid::new_v4().to_string(),
        artifact_id: artifact.artifact_id,
        parent_proposal_id: input.parent_proposal_id,
        schema_version: PLACEMENT_SCHEMA_VERSION,
        confidence: targets
            .first()
            .map(|target| target.confidence)
            .unwrap_or(0.0),
        reasons: vec![targets
            .first()
            .map(|target| target.reason.clone())
            .unwrap_or_default()],
        warnings: if artifact.processing_status == "valid_with_warnings" {
            vec!["Artifact 带有校验警告，应用前已再次校验目标".to_string()]
        } else {
            Vec::new()
        },
        unresolved_items: Vec::new(),
        project_revision_hash,
        created_at: Utc::now().to_rfc3339(),
        targets,
    };
    placement_repository::insert_proposal(&transaction, &proposal)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(proposal)
}

pub fn get_proposal(
    connection: &Connection,
    proposal_id: &str,
) -> Result<PlacementProposal, AppError> {
    placement_repository::get_proposal(connection, proposal_id)?.ok_or_else(|| {
        AppError::new(
            codes::PLACEMENT_PROPOSAL_NOT_FOUND,
            "PlacementProposal 不存在",
            false,
        )
    })
}

pub fn validate_proposal(
    connection: &Connection,
    proposal_id: &str,
) -> Result<ProposalValidation, AppError> {
    let proposal = get_proposal(connection, proposal_id)?;
    if let Err(error) =
        constraint_validation_service::ensure_latest_allows_apply(connection, &proposal.artifact_id)
    {
        return Ok(ProposalValidation {
            proposal_id: proposal.proposal_id,
            stale: true,
            reason: Some(error.message),
            current_project_revision_hash: String::new(),
        });
    }
    let ready_targets: Vec<_> = proposal
        .targets
        .iter()
        .filter(|target| target.is_ready)
        .collect();
    if ready_targets.len() != 1 {
        return Ok(ProposalValidation {
            proposal_id: proposal.proposal_id,
            stale: true,
            reason: Some("Proposal 必须且只能有一个 Ready Target".to_string()),
            current_project_revision_hash: String::new(),
        });
    }
    let target = ready_targets[0];
    if target.action == "confirm_artifact_review" {
        let current: Option<(String, String, Option<String>)> = connection
            .query_row(
                "SELECT artifact_type,processing_status,
                    (SELECT triggered_at FROM ai_artifact_stale_events s WHERE s.artifact_id=result_artifacts.artifact_id ORDER BY triggered_at DESC LIMIT 1)
                 FROM result_artifacts WHERE artifact_id=?1 AND source_novel_id=?2",
                rusqlite::params![proposal.artifact_id,target.novel_id],
                |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)),
            )
            .optional()
            .map_err(AppError::database)?;
        let Some((artifact_type, processing_status, stale_at)) = current else {
            return Ok(ProposalValidation {
                proposal_id: proposal.proposal_id,
                stale: true,
                reason: Some("审查 Artifact 已不存在".into()),
                current_project_revision_hash: String::new(),
            });
        };
        let current_hash = large_text_repository::sha256(
            &serde_json::json!({
                "artifactId": proposal.artifact_id,
                "artifactType": artifact_type,
                "processingStatus": processing_status,
            })
            .to_string(),
        );
        let stale = stale_at.is_some()
            || !matches!(processing_status.as_str(), "valid" | "valid_with_warnings")
            || current_hash != proposal.project_revision_hash;
        return Ok(ProposalValidation {
            proposal_id: proposal.proposal_id,
            stale,
            reason: stale.then(|| "审查结果已失效或过期".into()),
            current_project_revision_hash: current_hash,
        });
    }
    let current = placement_repository::read_target_state(
        connection,
        &target.novel_id,
        target.chapter_id.as_deref().unwrap_or(&target.target_id),
        target.draft_id.as_deref(),
    )?;
    let Some(current) = current else {
        return Ok(ProposalValidation {
            proposal_id: proposal.proposal_id,
            stale: true,
            reason: Some("目标已删除".to_string()),
            current_project_revision_hash: String::new(),
        });
    };
    let current_hash = project_revision_hash(&proposal.artifact_id, &current);
    let stale = current.chapter_deleted
        || (target.draft_id.is_some() && current.draft_id.is_none())
        || target.expected_version != current.draft_version
        || target.expected_hash != current.draft_hash
        || current_hash != proposal.project_revision_hash;
    Ok(ProposalValidation {
        proposal_id: proposal.proposal_id,
        stale,
        reason: stale.then(|| "目标版本、正文哈希或项目 revision 已变化".to_string()),
        current_project_revision_hash: current_hash,
    })
}

pub fn rebuild_proposal(
    connection: &mut Connection,
    proposal_id: &str,
    target: Option<crate::domain::placement::PlacementTargetOverride>,
) -> Result<PlacementProposal, AppError> {
    let previous = get_proposal(connection, proposal_id)?;
    create_proposal(
        connection,
        CreatePlacementProposalInput {
            artifact_id: previous.artifact_id,
            target,
            parent_proposal_id: Some(previous.proposal_id),
        },
    )
}
