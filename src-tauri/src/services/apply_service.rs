use crate::domain::apply_plan::{
    ApplyExecutionResult, ApplyOperation, ApplyPlan, ApplyPlanStatus, ArtifactTargetLink,
    CreateApplyPlanInput, ExecuteApplyPlanInput, APPLY_PLAN_SCHEMA_VERSION,
    APPLY_VALIDATOR_VERSION,
};
use crate::errors::{codes, AppError};
use crate::repositories::{
    apply_plan_repository, artifact_target_link_repository, large_text_repository,
};
use crate::services::{draft_service, initialization_apply_service, placement_service};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};

#[derive(Debug)]
struct ArtifactApplySource {
    task_id: String,
    schema_version: i64,
    raw_content_ref_id: String,
    display_content_ref_id: Option<String>,
    structured_payload: Option<Value>,
    content_hash: String,
    source_novel_id: String,
    source_chapter_id: Option<String>,
    source_draft_id: Option<String>,
    source_draft_version: Option<i64>,
    source_base_content_hash: Option<String>,
    processing_status: String,
    stale_at: Option<String>,
}

#[derive(Debug)]
struct CandidateReplacement {
    start: usize,
    end: usize,
    replacement: String,
}

fn json_object_text(value: &str) -> bool {
    let trimmed = value.trim();
    let unfenced = if trimmed.starts_with("```") {
        let body = trimmed
            .find('\n')
            .map(|index| &trimmed[index + 1..])
            .unwrap_or_default();
        body.rfind("```")
            .map(|index| &body[..index])
            .unwrap_or(body)
            .trim()
    } else {
        trimmed
    };
    unfenced.starts_with('{')
        || unfenced.starts_with('[')
        || serde_json::from_str::<Value>(unfenced)
            .is_ok_and(|parsed| parsed.is_object() || parsed.is_array())
}

fn structured_chapter_text(payload: &Value) -> Option<String> {
    [
        "chapterText",
        "chapter_text",
        "revisedContent",
        "revised_content",
        "fullText",
        "full_text",
        "candidateText",
        "candidate_text",
    ]
    .iter()
    .find_map(|key| payload.get(key).and_then(Value::as_str))
    .filter(|value| !value.trim().is_empty())
    .map(str::to_owned)
}

fn char_offset_to_byte(value: &str, offset: usize) -> Option<usize> {
    if offset == value.chars().count() {
        return Some(value.len());
    }
    value.char_indices().nth(offset).map(|(index, _)| index)
}

fn paragraph_ranges(value: &str) -> Vec<(usize, usize)> {
    let bytes = value.as_bytes();
    let mut ranges = Vec::new();
    let mut start = 0;
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'\n' && index + 1 < bytes.len() && bytes[index + 1] == b'\n' {
            ranges.push((start, index));
            index += 2;
            while index < bytes.len() && bytes[index] == b'\n' {
                index += 1;
            }
            start = index;
        } else {
            index += 1;
        }
    }
    ranges.push((start, value.len()));
    ranges
}

fn unique_match(value: &str, needle: &str, start: usize, end: usize) -> Option<usize> {
    if needle.is_empty() || start > end || end > value.len() {
        return None;
    }
    let slice = &value[start..end];
    let first = slice.find(needle)?;
    if slice[first + needle.len()..].contains(needle) {
        return None;
    }
    Some(start + first)
}

fn integer_field(value: &Value, camel: &str, snake: &str) -> Option<usize> {
    value
        .get(camel)
        .or_else(|| value.get(snake))
        .and_then(Value::as_u64)
        .and_then(|number| usize::try_from(number).ok())
}

fn rebuild_targeted_fix(base_content: &str, payload: &Value) -> Result<String, AppError> {
    let ranges = payload
        .get("changedRanges")
        .or_else(|| payload.get("changed_ranges"))
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "候选缺少可用于重建正文的修改片段",
                false,
            )
        })?;
    if ranges.is_empty() || base_content.trim().is_empty() {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "候选无法从冻结正文重建",
            false,
        ));
    }
    let normalized = base_content.replace("\r\n", "\n").replace('\r', "\n");
    let paragraphs = paragraph_ranges(&normalized);
    let mut replacements = Vec::with_capacity(ranges.len());
    for range in ranges {
        let before = range
            .get("before")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let after = range
            .get("after")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if before.is_empty() && after.is_empty() {
            return Err(AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "候选修改片段为空",
                false,
            ));
        }
        let offset_match = integer_field(range, "startOffset", "start_offset")
            .zip(integer_field(range, "endOffset", "end_offset"))
            .and_then(|(start, end)| {
                let start_byte = char_offset_to_byte(&normalized, start)?;
                let end_byte = char_offset_to_byte(&normalized, end)?;
                (start_byte <= end_byte
                    && normalized
                        .get(start_byte..end_byte)
                        .is_some_and(|value| value == before))
                .then_some((start_byte, end_byte))
            });
        let paragraph_match = integer_field(range, "paragraphIndex", "paragraph_index")
            .and_then(|paragraph_index| paragraphs.get(paragraph_index).copied())
            .and_then(|(start, end)| {
                if before.is_empty() {
                    Some((end, end))
                } else {
                    unique_match(&normalized, before, start, end)
                        .map(|position| (position, position + before.len()))
                }
            });
        let global_match = unique_match(&normalized, before, 0, normalized.len())
            .map(|position| (position, position + before.len()));
        let (start, end) = offset_match
            .or(paragraph_match)
            .or(global_match)
            .ok_or_else(|| {
                AppError::new(
                    codes::ARTIFACT_VALIDATION_FAILED,
                    "候选修改片段无法在冻结正文中唯一定位",
                    false,
                )
            })?;
        replacements.push(CandidateReplacement {
            start,
            end,
            replacement: after.to_string(),
        });
    }
    replacements.sort_by(|left, right| right.start.cmp(&left.start));
    for pair in replacements.windows(2) {
        if pair[0].start < pair[1].end {
            return Err(AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "候选修改片段相互重叠",
                false,
            ));
        }
    }
    let mut rebuilt = normalized;
    for replacement in replacements {
        rebuilt.replace_range(replacement.start..replacement.end, &replacement.replacement);
    }
    Ok(rebuilt)
}

fn read_artifact(
    connection: &Connection,
    artifact_id: &str,
) -> Result<ArtifactApplySource, AppError> {
    connection
        .query_row(
            "SELECT task_id, raw_content_ref_id, display_content_ref_id, structured_payload_json,
                content_hash, source_novel_id, source_chapter_id, source_draft_id,
                source_draft_version, source_base_content_hash, processing_status, schema_version,
                (SELECT triggered_at FROM ai_artifact_stale_events s WHERE s.artifact_id=result_artifacts.artifact_id)
         FROM result_artifacts WHERE artifact_id = ?1",
            params![artifact_id],
            |row| {
                let structured: Option<String> = row.get(3)?;
                Ok(ArtifactApplySource {
                    task_id: row.get(0)?,
                    schema_version: row.get(11)?,
                    raw_content_ref_id: row.get(1)?,
                    display_content_ref_id: row.get(2)?,
                    structured_payload: structured
                        .and_then(|value| serde_json::from_str(&value).ok()),
                    content_hash: row.get(4)?,
                    source_novel_id: row.get(5)?,
                    source_chapter_id: row.get(6)?,
                    source_draft_id: row.get(7)?,
                    source_draft_version: row.get(8)?,
                    source_base_content_hash: row.get(9)?,
                    processing_status: row.get(10)?,
                    stale_at: row.get(12)?,
                })
            },
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| {
            AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "ApplyPlan Artifact 不存在",
                false,
            )
        })
}

fn chapter_text(
    connection: &Connection,
    artifact: &ArtifactApplySource,
) -> Result<String, AppError> {
    if let Some(payload) = artifact.structured_payload.as_ref() {
        if let Some(content) = structured_chapter_text(payload) {
            if json_object_text(&content) {
                return Err(AppError::new(
                    codes::ARTIFACT_VALIDATION_FAILED,
                    "候选完整正文仍是结构化数据",
                    false,
                ));
            }
            return Ok(content);
        }
        let source_draft_id = artifact.source_draft_id.as_deref().ok_or_else(|| {
            AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "候选缺少冻结正文身份",
                false,
            )
        })?;
        let (inline_content, large_text_ref_id): (String, Option<String>) = connection
            .query_row(
                "SELECT content,large_text_ref_id FROM chapter_drafts WHERE id=?1",
                params![source_draft_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(|| {
                AppError::new(
                    codes::ARTIFACT_VALIDATION_FAILED,
                    "候选冻结正文不存在",
                    false,
                )
            })?;
        let base_content = large_text_ref_id
            .map(|document_id| {
                large_text_repository::read_verified_document(connection, &document_id)
                    .map(|value| value.content)
            })
            .unwrap_or(Ok(inline_content))?;
        return rebuild_targeted_fix(&base_content, payload);
    }
    let document_id = artifact
        .display_content_ref_id
        .as_deref()
        .unwrap_or(&artifact.raw_content_ref_id);
    let verified = large_text_repository::read_verified_document(connection, document_id)?;
    if verified.content.trim().is_empty() {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "Artifact 正文为空",
            false,
        ));
    }
    if json_object_text(&verified.content) {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "Artifact 正文格式异常，禁止采用原始 JSON",
            false,
        ));
    }
    Ok(verified.content)
}

pub fn create_plan(
    connection: &mut Connection,
    input: CreateApplyPlanInput,
) -> Result<ApplyPlan, AppError> {
    let validation = placement_service::validate_proposal(connection, &input.proposal_id)?;
    if validation.stale {
        return Err(AppError::new(
            codes::APPLY_PLAN_STALE,
            validation
                .reason
                .unwrap_or_else(|| "Proposal 已过期".to_string()),
            false,
        ));
    }
    let proposal = placement_service::get_proposal(connection, &input.proposal_id)?;
    if !proposal.unresolved_items.is_empty() {
        return Err(AppError::new(
            codes::PLACEMENT_TARGET_UNRESOLVED,
            "Proposal 仍有未解决项",
            false,
        ));
    }
    let ready: Vec<_> = proposal
        .targets
        .iter()
        .filter(|target| target.is_ready)
        .collect();
    if ready.len() != 1 {
        return Err(AppError::new(
            codes::PLACEMENT_TARGET_UNRESOLVED,
            "M2 ApplyPlan 必须只有一个 Ready Target",
            false,
        ));
    }
    let target = ready[0];
    let artifact = read_artifact(connection, &proposal.artifact_id)?;
    if artifact.stale_at.is_some() {
        return Err(AppError::new(
            codes::APPLY_PLAN_STALE,
            "过期 Artifact 不能直接采用",
            false,
        ));
    }
    if artifact.processing_status != "valid" && artifact.processing_status != "valid_with_warnings"
    {
        return Err(AppError::new(
            codes::ARTIFACT_VALIDATION_FAILED,
            "Artifact 已失效",
            false,
        ));
    }
    let payload = json!({
        "source": input.source.unwrap_or_else(|| "ai_generated".to_string()),
        "note": input.note,
        "qualityFix": input.quality_fix,
        "artifactContentHash": artifact.content_hash,
        "validatorVersion": APPLY_VALIDATOR_VERSION,
    });
    let payload_hash = large_text_repository::sha256(&payload.to_string());
    let operation = ApplyOperation {
        apply_operation_id: uuid::Uuid::new_v4().to_string(),
        operation_index: 0,
        target_type: target.target_type.clone(),
        target_id: target.target_id.clone(),
        action: target.action.clone(),
        payload,
        payload_hash,
        expected_version: target.expected_version,
        expected_hash: target.expected_hash.clone(),
    };
    let operation_id = uuid::Uuid::new_v4().to_string();
    let canonical = json!({
        "artifactId": proposal.artifact_id,
        "artifactContentHash": artifact.content_hash,
        "artifactSchemaVersion": artifact.schema_version,
        "proposalId": proposal.proposal_id,
        "planSchemaVersion": APPLY_PLAN_SCHEMA_VERSION,
        "novelId": target.novel_id,
        "operation": {
            "operationIndex": operation.operation_index,
            "targetType": operation.target_type,
            "targetId": operation.target_id,
            "action": operation.action,
            "payloadHash": operation.payload_hash,
        },
        "expectedVersion": operation.expected_version,
        "expectedHash": operation.expected_hash,
        "validatorVersion": APPLY_VALIDATOR_VERSION,
    });
    let request_hash = large_text_repository::sha256(&canonical.to_string());
    let plan = ApplyPlan {
        plan_id: uuid::Uuid::new_v4().to_string(),
        proposal_id: proposal.proposal_id,
        artifact_id: proposal.artifact_id,
        parent_plan_id: input.parent_plan_id,
        schema_version: APPLY_PLAN_SCHEMA_VERSION,
        operations: vec![operation],
        dependencies: Vec::new(),
        expected_versions: json!({ target.target_id.clone(): target.expected_version }),
        expected_hashes: json!({ target.target_id.clone(): target.expected_hash.clone() }),
        conflicts: Vec::new(),
        operation_id,
        request_hash,
        status: ApplyPlanStatus::Ready,
        result: None,
        created_at: Utc::now().to_rfc3339(),
        completed_at: None,
    };
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    apply_plan_repository::insert_plan(&transaction, &plan)?;
    transaction.commit().map_err(AppError::database)?;
    Ok(plan)
}

fn apply_quality_fix_side_effects(
    transaction: &rusqlite::Transaction<'_>,
    payload: &Value,
    novel_id: &str,
    chapter_id: &str,
) -> Result<(), AppError> {
    let Some(quality_fix) = payload.get("qualityFix").filter(|value| !value.is_null()) else {
        return Ok(());
    };
    let fix_run_id = quality_fix
        .get("fixRunId")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::new(
                codes::DATABASE_TRANSACTION_FAILED,
                "修稿 ApplyPlan 缺少 fixRunId",
                false,
            )
        })?;
    let affected = transaction.execute(
        "UPDATE quality_fix_runs SET status = 'adopted', updated_at = ?1
         WHERE id = ?2 AND novel_id = ?3 AND chapter_id = ?4 AND status IN ('success','candidate_ready','validated')",
        params![Utc::now().to_rfc3339(), fix_run_id, novel_id, chapter_id],
    ).map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::DRAFT_UPDATE_ZERO_ROWS,
            "修稿记录状态未命中唯一目标",
            false,
        ));
    }
    if let Some(issue_ids) = quality_fix.get("fixedIssueIds").and_then(Value::as_array) {
        for issue_id in issue_ids.iter().filter_map(Value::as_str) {
            let affected = transaction.execute(
                "UPDATE quality_check_items SET status = 'resolved', resolved_at = ?1, updated_at = ?1
                 WHERE id = ?2 AND novel_id = ?3 AND chapter_id = ?4 AND status = 'pending'",
                params![Utc::now().to_rfc3339(), issue_id, novel_id, chapter_id],
            ).map_err(AppError::database)?;
            if affected != 1 {
                return Err(AppError::new(
                    codes::DRAFT_UPDATE_ZERO_ROWS,
                    "质量问题状态未命中唯一目标",
                    false,
                ));
            }
        }
    }
    let summary_count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM chapter_summaries WHERE chapter_id = ?1 AND is_expired = 0",
            params![chapter_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let summary_rows = transaction.execute(
        "UPDATE chapter_summaries SET is_expired = 1, updated_at = ?1 WHERE chapter_id = ?2 AND is_expired = 0",
        params![Utc::now().to_rfc3339(), chapter_id],
    ).unwrap_or(0) as i64;
    if summary_rows != summary_count {
        return Err(AppError::new(
            codes::DATABASE_TRANSACTION_FAILED,
            "章节上下文过期写入数量不一致",
            false,
        ));
    }
    let volume_id: Option<String> = transaction
        .query_row(
            "SELECT volume_id FROM chapters WHERE id = ?1 AND novel_id = ?2",
            params![chapter_id, novel_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)?
        .flatten();
    if let Some(volume_id) = volume_id {
        let context_count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM context_records
             WHERE novel_id = ?1 AND volume_id = ?2 AND context_type = 'volume_summary' AND is_expired = 0",
            params![novel_id, volume_id], |row| row.get(0),
        ).map_err(AppError::database)?;
        let context_rows = transaction.execute(
            "UPDATE context_records SET is_expired = 1, updated_at = ?1
             WHERE novel_id = ?2 AND volume_id = ?3 AND context_type = 'volume_summary' AND is_expired = 0",
            params![Utc::now().to_rfc3339(), novel_id, volume_id],
        ).map_err(AppError::database)? as i64;
        if context_rows != context_count {
            return Err(AppError::new(
                codes::DATABASE_TRANSACTION_FAILED,
                "分卷上下文过期写入数量不一致",
                false,
            ));
        }
    }
    Ok(())
}

pub fn execute_plan(
    connection: &mut Connection,
    input: ExecuteApplyPlanInput,
) -> Result<ApplyExecutionResult, AppError> {
    let existing = apply_plan_repository::get_plan(connection, &input.plan_id)?
        .ok_or_else(|| AppError::new(codes::APPLY_PLAN_NOT_FOUND, "ApplyPlan 不存在", false))?;
    if existing.operation_id != input.operation_id || existing.request_hash != input.request_hash {
        return Err(AppError::new(
            codes::OPERATION_PAYLOAD_CONFLICT,
            "operationId 或 requestHash 与 ApplyPlan 不一致",
            false,
        ));
    }
    if existing.status == ApplyPlanStatus::Completed {
        let links = artifact_target_link_repository::list_for_plan(connection, &input.plan_id)?;
        return Ok(ApplyExecutionResult {
            plan_id: existing.plan_id,
            operation_id: existing.operation_id,
            status: ApplyPlanStatus::Completed,
            target_links: links,
            result: existing.result.unwrap_or(Value::Null),
            idempotent_replay: true,
        });
    }
    if existing.status != ApplyPlanStatus::Ready {
        return Err(AppError::new(
            codes::APPLY_PLAN_ILLEGAL_TRANSITION,
            "ApplyPlan 当前不可执行",
            false,
        ));
    }
    let validation = placement_service::validate_proposal(connection, &existing.proposal_id)?;
    if validation.stale {
        let stale_reason = validation
            .reason
            .unwrap_or_else(|| "Proposal 已过期".to_string());
        let affected = connection
            .execute(
                "UPDATE artifact_apply_plans SET status = 'blocked', error_json = ?1
             WHERE plan_id = ?2 AND status = 'ready'",
                params![
                    json!({ "code": codes::APPLY_PLAN_STALE, "reason": stale_reason }).to_string(),
                    input.plan_id
                ],
            )
            .map_err(AppError::database)?;
        if affected != 1 {
            return Err(AppError::new(
                codes::APPLY_PLAN_ILLEGAL_TRANSITION,
                "过期 ApplyPlan 状态已变化",
                false,
            ));
        }
        return Err(AppError::new(codes::APPLY_PLAN_STALE, stale_reason, false));
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let result = (|| -> Result<ApplyExecutionResult, AppError> {
        let plan = apply_plan_repository::get_plan(&transaction, &input.plan_id)?
            .ok_or_else(|| AppError::new(codes::APPLY_PLAN_NOT_FOUND, "ApplyPlan 不存在", false))?;
        if plan.operation_id != input.operation_id || plan.request_hash != input.request_hash {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "事务内 requestHash 校验失败",
                false,
            ));
        }
        if placement_service::validate_proposal(&transaction, &plan.proposal_id)?.stale {
            return Err(AppError::new(
                codes::APPLY_PLAN_STALE,
                "事务内目标复检失败",
                false,
            ));
        }
        if initialization_apply_service::is_initialization_plan(&plan) {
            return initialization_apply_service::execute_in_transaction(&transaction, plan);
        }
        if plan.operations.len() != 1 || !plan.dependencies.is_empty() {
            return Err(AppError::new(
                codes::PLACEMENT_TARGET_UNRESOLVED,
                "M2 只允许单目标无依赖 ApplyPlan",
                false,
            ));
        }
        apply_plan_repository::cas_status(&transaction, &plan.plan_id, "ready", "applying")?;
        let operation = &plan.operations[0];
        let proposal = placement_service::get_proposal(&transaction, &plan.proposal_id)?;
        let target = proposal
            .targets
            .iter()
            .find(|target| target.is_ready)
            .ok_or_else(|| {
                AppError::new(
                    codes::PLACEMENT_TARGET_UNRESOLVED,
                    "Ready Target 不存在",
                    false,
                )
            })?;
        let artifact = read_artifact(&transaction, &plan.artifact_id)?;
        if artifact.stale_at.is_some() {
            return Err(AppError::new(
                codes::APPLY_PLAN_STALE,
                "过期 Artifact 不能执行采用",
                false,
            ));
        }
        if artifact.processing_status != "valid"
            && artifact.processing_status != "valid_with_warnings"
        {
            return Err(AppError::new(
                codes::ARTIFACT_VALIDATION_FAILED,
                "Artifact 已失效",
                false,
            ));
        }
        if artifact.source_novel_id != target.novel_id {
            return Err(AppError::new(
                codes::TARGET_SCOPE_MISMATCH,
                "Artifact 与 Apply Target 不属于同一作品",
                false,
            ));
        }
        if artifact.source_chapter_id.as_deref() == Some(target.target_id.as_str())
            && (artifact.source_draft_version != operation.expected_version
                || artifact.source_base_content_hash.as_deref()
                    != operation.expected_hash.as_deref())
        {
            return Err(AppError::new(
                codes::APPLY_PLAN_STALE,
                "Artifact 来源基线与 ApplyPlan 不一致",
                false,
            ));
        }
        if operation.action == "confirm_artifact_review" {
            let now = Utc::now().to_rfc3339();
            let link = ArtifactTargetLink {
                link_id: uuid::Uuid::new_v4().to_string(),
                artifact_id: plan.artifact_id.clone(),
                plan_id: plan.plan_id.clone(),
                apply_operation_id: operation.apply_operation_id.clone(),
                target_type: "artifact_review".into(),
                target_id: plan.artifact_id.clone(),
                target_version: Some(artifact.schema_version),
                target_hash: Some(artifact.content_hash.clone()),
                operation_id: plan.operation_id.clone(),
                result_metadata: Some(json!({ "reviewConfirmed": true, "canonWritten": false })),
                created_at: now.clone(),
            };
            artifact_target_link_repository::insert_link(&transaction, &link)?;
            let result_value = json!({
                "artifactId": plan.artifact_id,
                "reviewConfirmed": true,
                "canonWritten": false,
            });
            apply_plan_repository::complete(&transaction, &plan.plan_id, &result_value, &now)?;
            return Ok(ApplyExecutionResult {
                plan_id: plan.plan_id,
                operation_id: plan.operation_id,
                status: ApplyPlanStatus::Completed,
                target_links: vec![link],
                result: result_value,
                idempotent_replay: false,
            });
        }
        let content = chapter_text(&transaction, &artifact)?;
        let content_hash = large_text_repository::sha256(&content);
        let trace_id = uuid::Uuid::new_v4().to_string();
        let save_input = draft_service::SaveChapterDraftAtomicInput {
            operation_id: plan.operation_id.clone(),
            trace_id: Some(trace_id.clone()),
            novel_id: target.novel_id.clone(),
            chapter_id: target.target_id.clone(),
            draft_id: None,
            draft_version: None,
            base_content_hash: None,
            current_content_hash: content_hash.clone(),
            content,
            word_count: None,
            source: operation
                .payload
                .get("source")
                .and_then(Value::as_str)
                .unwrap_or("ai_generated")
                .to_string(),
            title: None,
            staging_session_id: None,
            ai_task_id: Some(artifact.task_id.clone()),
            artifact_id: Some(plan.artifact_id.clone()),
            note: operation
                .payload
                .get("note")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            source_type: Some("ai_task_artifact".to_string()),
            source_id: Some(plan.artifact_id.clone()),
            source_draft_id: artifact.source_draft_id.clone(),
            source_draft_version: artifact.source_draft_version,
            request_hash: None,
        };
        let saved = draft_service::save_chapter_draft_in_transaction(
            &transaction,
            &save_input,
            &trace_id,
            &plan.operation_id,
        )?;
        let adopted = draft_service::adopt_chapter_draft_in_transaction(
            &transaction,
            &draft_service::AdoptChapterDraftAtomicInput {
                operation_id: plan.operation_id.clone(),
                request_hash: None,
                trace_id: Some(trace_id.clone()),
                novel_id: target.novel_id.clone(),
                chapter_id: target.target_id.clone(),
                draft_id: saved.draft.id.clone(),
                draft_version: saved.draft.version_no,
                content_hash: saved.content_hash.clone(),
            },
            &trace_id,
            &plan.operation_id,
        )?;
        apply_quality_fix_side_effects(
            &transaction,
            &operation.payload,
            &target.novel_id,
            &target.target_id,
        )?;
        let now = Utc::now().to_rfc3339();
        let link = ArtifactTargetLink {
            link_id: uuid::Uuid::new_v4().to_string(),
            artifact_id: plan.artifact_id.clone(),
            plan_id: plan.plan_id.clone(),
            apply_operation_id: operation.apply_operation_id.clone(),
            target_type: "chapter_draft".to_string(),
            target_id: adopted.draft.id.clone(),
            target_version: Some(adopted.draft.version_no),
            target_hash: Some(adopted.content_hash.clone()),
            operation_id: plan.operation_id.clone(),
            result_metadata: Some(json!({ "adopted": true })),
            created_at: now.clone(),
        };
        artifact_target_link_repository::insert_link(&transaction, &link)?;
        let result_value = serde_json::to_value(&adopted).map_err(|_| {
            AppError::new(
                codes::DATABASE_TRANSACTION_FAILED,
                "Apply 结果序列化失败",
                false,
            )
        })?;
        apply_plan_repository::complete(&transaction, &plan.plan_id, &result_value, &now)?;
        Ok(ApplyExecutionResult {
            plan_id: plan.plan_id,
            operation_id: plan.operation_id,
            status: ApplyPlanStatus::Completed,
            target_links: vec![link],
            result: result_value,
            idempotent_replay: false,
        })
    })();
    match result {
        Ok(output) => {
            transaction.commit().map_err(|error| {
                AppError::new(
                    codes::DATABASE_COMMIT_UNKNOWN,
                    "ApplyPlan 提交状态未知",
                    true,
                )
                .with_details(json!({ "sqliteError": error.to_string() }))
            })?;
            Ok(output)
        }
        Err(error) => {
            drop(transaction);
            let failure_rows = connection
                .execute(
                    "UPDATE artifact_apply_plans SET status = 'failed', error_json = ?1
                 WHERE plan_id = ?2 AND status = 'ready'",
                    params![
                        serde_json::to_string(&error).unwrap_or_else(|_| "{}".to_string()),
                        input.plan_id
                    ],
                )
                .map_err(AppError::database)?;
            if failure_rows != 1 {
                return Err(AppError::new(
                    codes::APPLY_PLAN_ILLEGAL_TRANSITION,
                    "ApplyPlan 回滚后的失败状态写入未命中唯一目标",
                    false,
                )
                .with_details(json!({ "originalError": error })));
            }
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::apply_plan::{
        CreateApplyPlanInput, CreateInitializationApplyPlanInput, ExecuteApplyPlanInput,
        InitializationCandidateSelection, QualityFixApplyPayload,
    };
    use crate::domain::placement::{CreatePlacementProposalInput, PlacementTargetOverride};
    use crate::migrations;
    use crate::services::{initialization_apply_service, placement_service};

    fn setup() -> Result<Connection, Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE novels (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL, deleted_at TEXT);
             CREATE TABLE chapters (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, volume_id TEXT, title TEXT NOT NULL,
                 adopted_draft_id TEXT, word_count INTEGER NOT NULL DEFAULT 0,
                 status TEXT NOT NULL DEFAULT 'not_started', created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL, deleted_at TEXT);
             CREATE TABLE chapter_drafts (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL,
                 chapter_id TEXT NOT NULL, title TEXT, content TEXT NOT NULL DEFAULT '',
                 source TEXT NOT NULL, version_no INTEGER NOT NULL, word_count INTEGER NOT NULL DEFAULT 0,
                 is_adopted INTEGER NOT NULL DEFAULT 0, ai_task_id TEXT, note TEXT,
                 large_text_ref_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE quality_fix_runs (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL,
                 chapter_id TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE quality_check_items (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL,
                 chapter_id TEXT NOT NULL, status TEXT NOT NULL, resolved_at TEXT, updated_at TEXT NOT NULL);
             CREATE TABLE chapter_summaries (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL,
                 is_expired INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
             CREATE TABLE context_records (id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, volume_id TEXT,
                  context_type TEXT NOT NULL, is_expired INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
             CREATE TABLE world_settings (
                  id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, title TEXT NOT NULL,
                  content TEXT NOT NULL DEFAULT '', structured_json TEXT,
                  is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE rule_systems (
                  id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, title TEXT NOT NULL, category TEXT,
                  content TEXT NOT NULL DEFAULT '', forbidden_rules TEXT, structured_json TEXT,
                  is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE characters (
                  id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, name TEXT NOT NULL,
                  role_type TEXT NOT NULL DEFAULT 'supporting', identity TEXT, faction TEXT,
                  relation_to_protagonist TEXT, goal TEXT, personality TEXT, behavior_limits TEXT,
                  forbidden_behaviors TEXT, current_state TEXT, source TEXT NOT NULL DEFAULT 'manual',
                  source_type TEXT NOT NULL DEFAULT 'manual', is_protagonist INTEGER NOT NULL DEFAULT 0,
                  is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             INSERT INTO novels (id,title,created_at,updated_at) VALUES
                ('novel-a','A','now','now'),('novel-b','B','now','now');
             INSERT INTO chapters (id,novel_id,volume_id,title,created_at,updated_at) VALUES
                ('chapter-a','novel-a','volume-a','A','now','now'),
                ('chapter-a2','novel-a','volume-a','A2','now','now'),
                ('chapter-b','novel-b','volume-b','B','now','now');",
        )?;
        migrations::run_migrations(&mut connection)?;
        let source = "source chapter";
        let source_hash = large_text_repository::sha256(source);
        connection.execute(
            "INSERT INTO chapter_drafts
                (id,novel_id,chapter_id,title,content,source,version_no,word_count,is_adopted,
                 content_hash,created_at,updated_at)
             VALUES ('source-draft','novel-a','chapter-a','A',?1,'user_edited',1,2,1,?2,'now','now')",
            params![source, source_hash],
        )?;
        connection.execute(
            "UPDATE chapters SET adopted_draft_id='source-draft' WHERE id='chapter-a'",
            [],
        )?;
        connection.execute(
            "INSERT INTO ai_tasks
                (task_id,task_type,novel_id,chapter_id,draft_id,scope_type,status,trace_id,
                 operation_id,request_hash,created_at,completed_at)
             VALUES ('task-a','chapter_generate','novel-a','chapter-a','source-draft','draft',
                 'completed','trace-a','task-op-a','task-hash-a','now','now')",
            [],
        )?;
        connection.execute(
            "INSERT INTO ai_task_attempts
                (attempt_id,task_id,attempt_number,status,started_at,finished_at)
             VALUES ('attempt-a','task-a',1,'succeeded','now','now')",
            [],
        )?;
        let artifact_content = "new chapter text";
        let artifact_hash = large_text_repository::sha256(artifact_content);
        large_text_repository::insert_document_for_target(
            &connection,
            "artifact-doc",
            "result_artifact",
            "artifact-a",
            "raw_content",
            None,
            artifact_content,
            &artifact_hash,
            "now",
        )?;
        connection.execute(
            "INSERT INTO result_artifacts
                (artifact_id,task_id,attempt_id,artifact_type,schema_version,raw_content_ref_id,
                 source_novel_id,source_chapter_id,source_draft_id,source_draft_version,
                 source_base_content_hash,content_hash,content_length,processing_status,created_at)
             VALUES ('artifact-a','task-a','attempt-a','chapter_text',1,'artifact-doc','novel-a',
                 'chapter-a','source-draft',1,?1,?2,?3,'valid','now')",
            params![
                source_hash,
                artifact_hash,
                artifact_content.chars().count() as i64
            ],
        )?;
        Ok(connection)
    }

    fn proposal(
        connection: &mut Connection,
    ) -> Result<crate::domain::placement::PlacementProposal, AppError> {
        placement_service::create_proposal(
            connection,
            CreatePlacementProposalInput {
                artifact_id: "artifact-a".to_string(),
                target: None,
                parent_proposal_id: None,
            },
        )
    }

    fn plan(connection: &mut Connection) -> Result<ApplyPlan, AppError> {
        let proposal = proposal(connection)?;
        create_plan(
            connection,
            CreateApplyPlanInput {
                proposal_id: proposal.proposal_id,
                parent_plan_id: None,
                source: Some("ai_generated".to_string()),
                note: None,
                quality_fix: None,
            },
        )
    }

    fn execute_input(plan: &ApplyPlan) -> ExecuteApplyPlanInput {
        ExecuteApplyPlanInput {
            plan_id: plan.plan_id.clone(),
            operation_id: plan.operation_id.clone(),
            request_hash: plan.request_hash.clone(),
        }
    }

    fn initialization_candidate(
        candidate_id: &str,
        target_type: &str,
        proposed_value: Value,
        depends_on: Vec<&str>,
        confirmed: bool,
        with_conflict: bool,
    ) -> Value {
        let conflicts = if with_conflict {
            json!([{
                "code": "POSSIBLE_DUPLICATE",
                "severity": "warning",
                "message": "可能与已有设定重叠",
                "evidenceRefs": ["evidence-1"]
            }])
        } else {
            json!([])
        };
        let body = json!({
            "candidateId": candidate_id,
            "targetType": target_type,
            "proposedValue": proposed_value,
            "knowledgeClass": "requires_confirmation",
            "confidence": 0.9,
            "evidence": [{
                "evidenceId": "evidence-1",
                "sourceType": "author_input",
                "excerpt": "作者初始化输入"
            }],
            "explanation": "由作者输入生成的初始化候选",
            "conflicts": conflicts,
            "dependsOnCandidateIds": depends_on,
        });
        let candidate_hash = initialization_apply_service::canonical_hash(&body);
        let mut candidate = body;
        let object = candidate.as_object_mut().expect("candidate object");
        object.insert("conflictAcknowledged".into(), Value::Bool(with_conflict));
        object.insert(
            "confirmation".into(),
            if confirmed {
                json!({ "status": "confirmed", "confirmedBy": "author", "confirmedAt": "now" })
            } else {
                json!({ "status": "pending" })
            },
        );
        object.insert("candidateHash".into(), Value::String(candidate_hash));
        candidate
    }

    fn initialization_fixture(
        connection: &mut Connection,
        confirmed: bool,
        cycle: bool,
        with_conflict: bool,
    ) -> Result<(String, String, Vec<InitializationCandidateSelection>), Box<dyn std::error::Error>>
    {
        let world_dependencies = if cycle {
            vec!["candidate-character"]
        } else {
            vec![]
        };
        let character_dependencies = if cycle {
            vec!["candidate-world"]
        } else {
            vec!["candidate-rule"]
        };
        let items = vec![
            initialization_candidate(
                "candidate-world",
                "world_setting",
                json!({ "title": "天空城", "content": "浮空城市群", "isActive": true }),
                world_dependencies,
                confirmed,
                with_conflict,
            ),
            initialization_candidate(
                "candidate-rule",
                "rule_system",
                json!({ "title": "魔法规则", "category": "力量体系", "content": "施法需要代价" }),
                vec!["candidate-world"],
                confirmed,
                false,
            ),
            initialization_candidate(
                "candidate-character",
                "character",
                json!({ "name": "林澈", "roleType": "protagonist", "identity": "见习术士" }),
                character_dependencies,
                confirmed,
                false,
            ),
        ];
        let mut bundle = json!({
            "schemaVersion": 1,
            "bundleId": "bundle-a",
            "novelId": "novel-a",
            "revision": 1,
            "intent": { "intentId": "intent-a", "revision": 1, "contentHash": "intent-hash" },
            "items": items,
            "createdAt": "now"
        });
        let bundle_hash = initialization_apply_service::canonical_hash(&bundle);
        bundle
            .as_object_mut()
            .expect("bundle object")
            .insert("contentHash".into(), Value::String(bundle_hash.clone()));
        connection.execute("INSERT INTO ai_tasks (task_id,task_type,novel_id,scope_type,status,trace_id,operation_id,request_hash,created_at,completed_at) VALUES ('task-init','project_initialization','novel-a','novel','completed','trace-init','op-init','hash-init','now','now')", [])?;
        connection.execute("INSERT INTO ai_task_attempts (attempt_id,task_id,attempt_number,status,started_at,finished_at) VALUES ('attempt-init','task-init',1,'succeeded','now','now')", [])?;
        let raw = bundle.to_string();
        let raw_hash = large_text_repository::sha256(&raw);
        large_text_repository::insert_document_for_target(
            connection,
            "artifact-init-doc",
            "result_artifact",
            "artifact-init",
            "raw_content",
            None,
            &raw,
            &raw_hash,
            "now",
        )?;
        connection.execute(
            "INSERT INTO result_artifacts
             (artifact_id,task_id,attempt_id,artifact_type,schema_version,raw_content_ref_id,
              structured_payload_json,source_novel_id,content_hash,content_length,processing_status,created_at)
             VALUES ('artifact-init','task-init','attempt-init','generic_json',1,'artifact-init-doc',
                     ?1,'novel-a',?2,?3,'valid','now')",
            params![raw, raw_hash, raw.chars().count() as i64],
        )?;
        let proposal = placement_service::create_proposal(
            connection,
            CreatePlacementProposalInput {
                artifact_id: "artifact-init".into(),
                target: None,
                parent_proposal_id: None,
            },
        )?;
        let selections = bundle["items"]
            .as_array()
            .expect("items")
            .iter()
            .map(|candidate| InitializationCandidateSelection {
                candidate_id: candidate["candidateId"].as_str().unwrap().to_string(),
                expected_candidate_hash: candidate["candidateHash"].as_str().unwrap().to_string(),
                conflict_acknowledged: candidate["conflicts"]
                    .as_array()
                    .map(|conflicts| !conflicts.is_empty())
                    .unwrap_or(false),
            })
            .collect();
        Ok((proposal.proposal_id, bundle_hash, selections))
    }

    #[test]
    fn workflow_stale_artifact_cannot_create_apply_plan() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut db = setup()?;
        let created = proposal(&mut db)?;
        db.execute("INSERT INTO ai_artifact_stale_events(artifact_id,source_task_id,reason,triggered_at) VALUES ('artifact-a','task-a','upstream changed','now')",[])?;
        let error = create_plan(
            &mut db,
            CreateApplyPlanInput {
                proposal_id: created.proposal_id,
                parent_plan_id: None,
                source: Some("ai_generated".into()),
                note: None,
                quality_fix: None,
            },
        )
        .expect_err("stale artifact must be blocked");
        assert_eq!(error.code, codes::APPLY_PLAN_STALE);
        Ok(())
    }

    #[test]
    fn plc01_creates_one_ready_task_scope_target() -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let created = proposal(&mut db)?;
        assert_eq!(
            created
                .targets
                .iter()
                .filter(|target| target.is_ready)
                .count(),
            1
        );
        assert_eq!(created.targets[0].source_priority, 2);
        Ok(())
    }

    #[test]
    fn plc02_user_target_has_priority_and_keeps_scope_candidate(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let created = placement_service::create_proposal(
            &mut db,
            CreatePlacementProposalInput {
                artifact_id: "artifact-a".into(),
                parent_proposal_id: None,
                target: Some(PlacementTargetOverride {
                    novel_id: "novel-a".into(),
                    chapter_id: "chapter-a2".into(),
                    draft_id: None,
                }),
            },
        )?;
        assert_eq!(created.targets.len(), 2);
        assert_eq!(created.targets[0].source_priority, 1);
        assert!(created.targets[0].is_ready);
        assert!(!created.targets[1].is_ready);
        Ok(())
    }

    #[test]
    fn plc03_invalid_artifact_is_rejected() -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        db.execute("UPDATE result_artifacts SET processing_status='invalid' WHERE artifact_id='artifact-a'", [])?;
        let error = proposal(&mut db).unwrap_err();
        assert_eq!(error.code, codes::ARTIFACT_VALIDATION_FAILED);
        Ok(())
    }

    #[test]
    fn plc04_cross_novel_user_target_is_rejected() -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let error = placement_service::create_proposal(
            &mut db,
            CreatePlacementProposalInput {
                artifact_id: "artifact-a".into(),
                parent_proposal_id: None,
                target: Some(PlacementTargetOverride {
                    novel_id: "novel-b".into(),
                    chapter_id: "chapter-b".into(),
                    draft_id: None,
                }),
            },
        )
        .unwrap_err();
        assert_eq!(error.code, codes::TARGET_SCOPE_MISMATCH);
        Ok(())
    }

    #[test]
    fn plc05_chapter_revision_change_makes_proposal_stale() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut db = setup()?;
        let created = proposal(&mut db)?;
        db.execute(
            "UPDATE chapters SET updated_at='later' WHERE id='chapter-a'",
            [],
        )?;
        assert!(placement_service::validate_proposal(&db, &created.proposal_id)?.stale);
        Ok(())
    }

    #[test]
    fn plc06_draft_hash_change_makes_proposal_stale() -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let created = proposal(&mut db)?;
        db.execute(
            "UPDATE chapter_drafts SET content_hash='changed' WHERE id='source-draft'",
            [],
        )?;
        assert!(placement_service::validate_proposal(&db, &created.proposal_id)?.stale);
        Ok(())
    }

    #[test]
    fn plc07_rebuild_creates_new_immutable_child() -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let first = proposal(&mut db)?;
        let rebuilt = placement_service::rebuild_proposal(&mut db, &first.proposal_id, None)?;
        assert_ne!(rebuilt.proposal_id, first.proposal_id);
        assert_eq!(
            rebuilt.parent_proposal_id.as_deref(),
            Some(first.proposal_id.as_str())
        );
        Ok(())
    }

    #[test]
    fn plc08_proposal_delete_is_protected() -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let created = proposal(&mut db)?;
        assert!(db
            .execute(
                "DELETE FROM artifact_placement_proposals WHERE proposal_id=?1",
                params![created.proposal_id]
            )
            .is_err());
        Ok(())
    }

    #[test]
    fn plc09_target_delete_is_protected() -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let created = proposal(&mut db)?;
        assert!(db
            .execute(
                "DELETE FROM artifact_placement_targets WHERE proposal_id=?1",
                params![created.proposal_id]
            )
            .is_err());
        Ok(())
    }

    #[test]
    fn plc10_deleted_target_is_stale() -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let created = proposal(&mut db)?;
        db.execute(
            "UPDATE chapters SET deleted_at='gone' WHERE id='chapter-a'",
            [],
        )?;
        assert!(placement_service::validate_proposal(&db, &created.proposal_id)?.stale);
        Ok(())
    }

    #[test]
    fn apply01_plan_is_ready_and_single_target() -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let created = plan(&mut db)?;
        assert_eq!(created.status, ApplyPlanStatus::Ready);
        assert_eq!(created.operations.len(), 1);
        Ok(())
    }

    #[test]
    fn apply02_plan_request_is_immutable() -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let created = plan(&mut db)?;
        assert!(db
            .execute(
                "UPDATE artifact_apply_plans SET request_hash='changed' WHERE plan_id=?1",
                params![created.plan_id]
            )
            .is_err());
        Ok(())
    }

    #[test]
    fn apply03_plan_delete_is_protected() -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let created = plan(&mut db)?;
        assert!(db
            .execute(
                "DELETE FROM artifact_apply_plans WHERE plan_id=?1",
                params![created.plan_id]
            )
            .is_err());
        Ok(())
    }

    #[test]
    fn apply04_request_hash_mismatch_fails_closed() -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let created = plan(&mut db)?;
        let mut input = execute_input(&created);
        input.request_hash = "wrong".into();
        assert_eq!(
            execute_plan(&mut db, input).unwrap_err().code,
            codes::OPERATION_PAYLOAD_CONFLICT
        );
        Ok(())
    }

    #[test]
    fn apply05_operation_id_mismatch_fails_closed() -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let created = plan(&mut db)?;
        let mut input = execute_input(&created);
        input.operation_id = "wrong".into();
        assert_eq!(
            execute_plan(&mut db, input).unwrap_err().code,
            codes::OPERATION_PAYLOAD_CONFLICT
        );
        Ok(())
    }

    #[test]
    fn apply06_stale_version_prevents_business_write() -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let created = plan(&mut db)?;
        db.execute(
            "UPDATE chapter_drafts SET content_hash='changed' WHERE id='source-draft'",
            [],
        )?;
        assert_eq!(
            execute_plan(&mut db, execute_input(&created))
                .unwrap_err()
                .code,
            codes::APPLY_PLAN_STALE
        );
        let count: i64 = db.query_row("SELECT COUNT(*) FROM artifact_target_links", [], |row| {
            row.get(0)
        })?;
        assert_eq!(count, 0);
        Ok(())
    }

    #[test]
    fn apply07_execute_creates_adopted_draft_and_link() -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let created = plan(&mut db)?;
        let output = execute_plan(&mut db, execute_input(&created))?;
        assert_eq!(output.status, ApplyPlanStatus::Completed);
        assert_eq!(output.target_links.len(), 1);
        let adopted: i64 = db.query_row(
            "SELECT COUNT(*) FROM chapter_drafts WHERE is_adopted=1 AND artifact_id='artifact-a'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(adopted, 1);
        Ok(())
    }

    #[test]
    fn apply08_replay_returns_first_result_without_second_write(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let created = plan(&mut db)?;
        execute_plan(&mut db, execute_input(&created))?;
        let replay = execute_plan(&mut db, execute_input(&created))?;
        assert!(replay.idempotent_replay);
        let count: i64 =
            db.query_row("SELECT COUNT(*) FROM chapter_drafts", [], |row| row.get(0))?;
        assert_eq!(count, 2);
        Ok(())
    }

    #[test]
    fn apply09_target_link_delete_is_protected() -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let created = plan(&mut db)?;
        execute_plan(&mut db, execute_input(&created))?;
        assert!(db.execute("DELETE FROM artifact_target_links", []).is_err());
        Ok(())
    }

    #[test]
    fn apply10_link_failure_rolls_back_draft_and_adoption() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut db = setup()?;
        let created = plan(&mut db)?;
        db.execute_batch("CREATE TRIGGER fail_link BEFORE INSERT ON artifact_target_links BEGIN SELECT RAISE(ABORT,'forced'); END;")?;
        assert!(execute_plan(&mut db, execute_input(&created)).is_err());
        let drafts: i64 =
            db.query_row("SELECT COUNT(*) FROM chapter_drafts", [], |row| row.get(0))?;
        assert_eq!(drafts, 1);
        let adopted: String = db.query_row(
            "SELECT adopted_draft_id FROM chapters WHERE id='chapter-a'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(adopted, "source-draft");
        Ok(())
    }

    #[test]
    fn apply11_quality_fix_side_effects_commit_together() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut db = setup()?;
        let proposal = proposal(&mut db)?;
        db.execute(
            "INSERT INTO quality_fix_runs VALUES ('fix-a','novel-a','chapter-a','validated','now')",
            [],
        )?;
        db.execute("INSERT INTO quality_check_items VALUES ('issue-a','novel-a','chapter-a','pending',NULL,'now')", [])?;
        db.execute(
            "INSERT INTO chapter_summaries VALUES ('summary-a','chapter-a',0,'now')",
            [],
        )?;
        db.execute("INSERT INTO context_records VALUES ('context-a','novel-a','volume-a','volume_summary',0,'now')", [])?;
        let created = create_plan(
            &mut db,
            CreateApplyPlanInput {
                proposal_id: proposal.proposal_id,
                parent_plan_id: None,
                source: Some("ai_fix".into()),
                note: None,
                quality_fix: Some(QualityFixApplyPayload {
                    fix_run_id: "fix-a".into(),
                    fixed_issue_ids: vec!["issue-a".into()],
                }),
            },
        )?;
        execute_plan(&mut db, execute_input(&created))?;
        let status: String = db.query_row(
            "SELECT status FROM quality_fix_runs WHERE id='fix-a'",
            [],
            |row| row.get(0),
        )?;
        let issue: String = db.query_row(
            "SELECT status FROM quality_check_items WHERE id='issue-a'",
            [],
            |row| row.get(0),
        )?;
        let context_expired: i64 = db.query_row(
            "SELECT is_expired FROM context_records WHERE id='context-a'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(status, "adopted");
        assert_eq!(issue, "resolved");
        assert_eq!(context_expired, 1);
        Ok(())
    }

    #[test]
    fn apply12_missing_quality_issue_rolls_back_everything(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let proposal = proposal(&mut db)?;
        db.execute(
            "INSERT INTO quality_fix_runs VALUES ('fix-a','novel-a','chapter-a','validated','now')",
            [],
        )?;
        let created = create_plan(
            &mut db,
            CreateApplyPlanInput {
                proposal_id: proposal.proposal_id,
                parent_plan_id: None,
                source: Some("ai_fix".into()),
                note: None,
                quality_fix: Some(QualityFixApplyPayload {
                    fix_run_id: "fix-a".into(),
                    fixed_issue_ids: vec!["missing".into()],
                }),
            },
        )?;
        assert!(execute_plan(&mut db, execute_input(&created)).is_err());
        let status: String = db.query_row(
            "SELECT status FROM quality_fix_runs WHERE id='fix-a'",
            [],
            |row| row.get(0),
        )?;
        let count: i64 =
            db.query_row("SELECT COUNT(*) FROM chapter_drafts", [], |row| row.get(0))?;
        assert_eq!(status, "validated");
        assert_eq!(count, 1);
        Ok(())
    }

    #[test]
    fn apply13_review_only_plan_records_confirmation_without_canon_write(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        db.execute("INSERT INTO ai_tasks (task_id,task_type,novel_id,chapter_id,draft_id,scope_type,status,trace_id,operation_id,request_hash,created_at,completed_at) VALUES ('task-review','chapter_summary','novel-a','chapter-a','source-draft','draft','completed','trace-review','op-review','hash-review','now','now')",[])?;
        db.execute("INSERT INTO ai_task_attempts (attempt_id,task_id,attempt_number,status,started_at,finished_at) VALUES ('attempt-review','task-review',1,'succeeded','now','now')",[])?;
        let body = "{\"summary\":\"review me\"}";
        let body_hash = large_text_repository::sha256(body);
        large_text_repository::insert_document_for_target(
            &db,
            "artifact-review-doc",
            "result_artifact",
            "artifact-review",
            "raw_content",
            None,
            body,
            &body_hash,
            "now",
        )?;
        db.execute("INSERT INTO result_artifacts (artifact_id,task_id,attempt_id,artifact_type,schema_version,raw_content_ref_id,source_novel_id,source_chapter_id,source_draft_id,source_draft_version,source_base_content_hash,content_hash,content_length,processing_status,created_at) VALUES ('artifact-review','task-review','attempt-review','chapter_summary',1,'artifact-review-doc','novel-a','chapter-a','source-draft',1,(SELECT content_hash FROM chapter_drafts WHERE id='source-draft'),?1,?2,'valid','now')",params![body_hash,body.chars().count() as i64])?;
        let proposal = placement_service::create_proposal(
            &mut db,
            CreatePlacementProposalInput {
                artifact_id: "artifact-review".into(),
                target: None,
                parent_proposal_id: None,
            },
        )?;
        assert_eq!(proposal.targets[0].action, "confirm_artifact_review");
        let review_plan = create_plan(
            &mut db,
            CreateApplyPlanInput {
                proposal_id: proposal.proposal_id,
                parent_plan_id: None,
                source: Some("ai_review".into()),
                note: Some("reviewed".into()),
                quality_fix: None,
            },
        )?;
        let executed = execute_plan(&mut db, execute_input(&review_plan))?;
        assert_eq!(executed.status, ApplyPlanStatus::Completed);
        assert_eq!(executed.target_links[0].target_type, "artifact_review");
        assert_eq!(
            executed.result.get("canonWritten").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM chapter_drafts", [], |row| row
                .get::<_, i64>(0))?,
            1
        );
        assert_eq!(
            db.query_row(
                "SELECT adopted_draft_id FROM chapters WHERE id='chapter-a'",
                [],
                |row| row.get::<_, String>(0)
            )?,
            "source-draft"
        );
        Ok(())
    }

    #[test]
    fn stage3_init01_confirmed_candidates_create_multi_target_plan(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let (proposal_id, bundle_hash, selected_candidates) =
            initialization_fixture(&mut db, true, false, false)?;
        let created = initialization_apply_service::create_plan(
            &mut db,
            CreateInitializationApplyPlanInput {
                proposal_id,
                expected_bundle_hash: bundle_hash,
                selected_candidates,
                parent_plan_id: None,
            },
        )?;
        assert_eq!(created.status, ApplyPlanStatus::Ready);
        assert_eq!(created.operations.len(), 3);
        assert_eq!(created.dependencies.len(), 2);
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM world_settings", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        Ok(())
    }

    #[test]
    fn stage3_init02_atomic_apply_writes_three_targets_and_replays_idempotently(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let (proposal_id, bundle_hash, selected_candidates) =
            initialization_fixture(&mut db, true, false, false)?;
        let created = initialization_apply_service::create_plan(
            &mut db,
            CreateInitializationApplyPlanInput {
                proposal_id,
                expected_bundle_hash: bundle_hash,
                selected_candidates,
                parent_plan_id: None,
            },
        )?;
        let executed = execute_plan(&mut db, execute_input(&created))?;
        assert_eq!(executed.status, ApplyPlanStatus::Completed);
        assert_eq!(executed.target_links.len(), 3);
        assert_eq!(
            executed.result.get("canonWritten").and_then(Value::as_bool),
            Some(true)
        );
        let replay = execute_plan(&mut db, execute_input(&created))?;
        assert!(replay.idempotent_replay);
        for table in ["world_settings", "rule_systems", "characters"] {
            let count: i64 = db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })?;
            assert_eq!(count, 1, "{table} should contain one target");
        }
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM artifact_target_links", [], |row| row
                .get::<_, i64>(
                0
            ))?,
            3
        );
        Ok(())
    }

    #[test]
    fn stage3_init03_late_conflict_rolls_back_all_prior_canon_writes(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut db = setup()?;
        let (proposal_id, bundle_hash, selected_candidates) =
            initialization_fixture(&mut db, true, false, false)?;
        let created = initialization_apply_service::create_plan(
            &mut db,
            CreateInitializationApplyPlanInput {
                proposal_id,
                expected_bundle_hash: bundle_hash,
                selected_candidates,
                parent_plan_id: None,
            },
        )?;
        db.execute("INSERT INTO rule_systems (id,novel_id,title,content,is_active,created_at,updated_at) VALUES ('existing-rule','novel-a','魔法规则','existing',1,'now','now')", [])?;
        let error = execute_plan(&mut db, execute_input(&created)).unwrap_err();
        assert_eq!(error.code, codes::TARGET_VERSION_CONFLICT);
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM world_settings", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM characters", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM artifact_target_links", [], |row| row
                .get::<_, i64>(
                0
            ))?,
            0
        );
        assert_eq!(
            db.query_row(
                "SELECT status FROM artifact_apply_plans WHERE plan_id=?1",
                params![created.plan_id],
                |row| row.get::<_, String>(0)
            )?,
            "failed"
        );
        Ok(())
    }

    #[test]
    fn stage3_init04_unconfirmed_candidate_and_cycle_fail_closed(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut unconfirmed_db = setup()?;
        let (proposal_id, bundle_hash, selected_candidates) =
            initialization_fixture(&mut unconfirmed_db, false, false, false)?;
        let error = initialization_apply_service::create_plan(
            &mut unconfirmed_db,
            CreateInitializationApplyPlanInput {
                proposal_id,
                expected_bundle_hash: bundle_hash,
                selected_candidates,
                parent_plan_id: None,
            },
        )
        .unwrap_err();
        assert_eq!(error.code, codes::ARTIFACT_VALIDATION_FAILED);

        let mut cycle_db = setup()?;
        let (proposal_id, bundle_hash, selected_candidates) =
            initialization_fixture(&mut cycle_db, true, true, false)?;
        let error = initialization_apply_service::create_plan(
            &mut cycle_db,
            CreateInitializationApplyPlanInput {
                proposal_id,
                expected_bundle_hash: bundle_hash,
                selected_candidates,
                parent_plan_id: None,
            },
        )
        .unwrap_err();
        assert_eq!(error.code, codes::ARTIFACT_VALIDATION_FAILED);
        Ok(())
    }

    #[test]
    fn apply14_targeted_fix_fragments_rebuild_complete_prose_before_apply(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let db = setup()?;
        let artifact = ArtifactApplySource {
            task_id: "task-a".into(),
            schema_version: 1,
            raw_content_ref_id: "artifact-doc".into(),
            display_content_ref_id: None,
            structured_payload: Some(json!({
                "mode": "targeted_fix",
                "revision_summary": "只修改一处",
                "changed_ranges": [{ "before": "source", "after": "revised" }]
            })),
            content_hash: "raw-hash".into(),
            source_novel_id: "novel-a".into(),
            source_chapter_id: Some("chapter-a".into()),
            source_draft_id: Some("source-draft".into()),
            source_draft_version: Some(1),
            source_base_content_hash: None,
            processing_status: "valid".into(),
            stale_at: None,
        };
        let content = chapter_text(&db, &artifact)?;
        assert_eq!(content, "revised chapter");
        assert!(!content.contains("changed_ranges"));
        Ok(())
    }

    #[test]
    fn apply15_raw_or_nested_json_can_never_become_chapter_body(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let db = setup()?;
        let nested = ArtifactApplySource {
            task_id: "task-a".into(),
            schema_version: 1,
            raw_content_ref_id: "artifact-doc".into(),
            display_content_ref_id: None,
            structured_payload: Some(json!({
                "mode": "full_rewrite",
                "revised_content": "{\"mode\":\"not prose\"}"
            })),
            content_hash: "raw-hash".into(),
            source_novel_id: "novel-a".into(),
            source_chapter_id: Some("chapter-a".into()),
            source_draft_id: Some("source-draft".into()),
            source_draft_version: Some(1),
            source_base_content_hash: None,
            processing_status: "valid".into(),
            stale_at: None,
        };
        let error = chapter_text(&db, &nested).expect_err("nested JSON must be rejected");
        assert_eq!(error.code, codes::ARTIFACT_VALIDATION_FAILED);
        Ok(())
    }
}
