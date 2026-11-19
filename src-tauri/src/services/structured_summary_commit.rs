//! Shared manual/preauthorized summary commit, with truthful review provenance.
use super::*;

pub(super) fn apply_summary(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    bundle: &artifact_service::ResultArtifactBundle,
    authority: ApplicationAuthority<'_>,
) -> Result<DomainOutcome, AppError> {
    let Some(chapter_id) = input.chapter_id.as_deref() else {
        return Ok(DomainOutcome::Conflict("CHAPTER_TARGET_REQUIRED"));
    };
    let (volume_id, adopted_draft_id) = connection
        .query_row(
            "SELECT volume_id, adopted_draft_id FROM chapters
             WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL",
            params![chapter_id, input.novel_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            },
        )
        .map_err(AppError::database)?;
    let Some(adopted_draft_id) = adopted_draft_id else {
        return Ok(DomainOutcome::Conflict(
            "CHAPTER_SUMMARY_ADOPTED_DRAFT_REQUIRED",
        ));
    };
    if bundle.artifact.source_draft_id.as_deref() != Some(adopted_draft_id.as_str()) {
        return Ok(DomainOutcome::Conflict(
            "CHAPTER_SUMMARY_ADOPTED_DRAFT_MISMATCH",
        ));
    }
    let value = candidate_value(bundle).unwrap_or_else(|| json!({}));
    let summary_snapshot = crate::repositories::ai_task_repository::find_input_snapshot(
        connection,
        &bundle.artifact.task_id,
    )?;
    let automatic = matches!(authority, ApplicationAuthority::TaskPreauthorization { .. });
    let grounding_required = automatic
        || summary_snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.payload_json.get("summaryGroundingVersion"))
            .and_then(Value::as_i64)
            == Some(1)
        || bundle
            .issues
            .iter()
            .any(|issue| issue.validator_version == "artifact-validator-m1-v3-summary-grounding");
    let grounding_issues = crate::services::summary_grounding_source::validate_candidate(
        connection,
        &input.novel_id,
        Some(chapter_id),
        Some(&adopted_draft_id),
        bundle.artifact.source_base_content_hash.as_deref(),
        &value,
        grounding_required,
    )?;
    if grounding_issues
        .iter()
        .any(|issue| issue.severity == "error")
    {
        return Ok(DomainOutcome::Conflict("SUMMARY_GROUNDING_REVIEW_REQUIRED"));
    }
    let coverage_required = automatic
        || crate::services::summary_coverage::required_by_snapshot(
            summary_snapshot
                .as_ref()
                .map(|snapshot| &snapshot.payload_json),
        );
    let coverage_issues = crate::services::summary_coverage::validate(
        &value,
        coverage_required,
        crate::services::summary_coverage::Depth::Complete,
    );
    if coverage_issues
        .iter()
        .any(|issue| issue.severity == "error")
    {
        return Ok(DomainOutcome::Conflict("SUMMARY_COVERAGE_INCOMPLETE"));
    }
    let object = value.as_object();
    let summary = object
        .and_then(|object| trimmed_text(object.get("summary"), MAX_FIELD_CHARS))
        .unwrap_or_else(|| candidate_text(bundle).trim().to_string());
    if summary.is_empty() || summary.chars().count() > MAX_FIELD_CHARS {
        return Ok(DomainOutcome::Conflict("EMPTY_CANDIDATE"));
    }
    let draft =
        draft_repository::find_draft(connection, &adopted_draft_id)?.ok_or_else(scope_mismatch)?;
    let full = crate::services::draft_service::load_full_content(connection, &draft)?;
    let mut validation = crate::services::summary_application_policy::validate_summary(
        &full.content,
        &value,
        grounding_required,
    );
    use crate::services::summary_application_policy::{
        ensure_context_eligible, SummaryApplicationMode,
    };
    let mode = match authority {
        ApplicationAuthority::ManualReview => {
            validation["authorReviewed"] = json!(true);
            validation["applicationProvenance"] = json!({"mode":"manual_review"});
            // A real user may accept advisory confidence after review, not blocking errors.
            if validation["passed"] == true
                && validation["blockingIssues"]
                    .as_array()
                    .is_some_and(|issues| issues.is_empty())
            {
                validation["safeToContext"] = json!(true);
                validation["manualWarningAcceptance"] = json!(true);
            }
            SummaryApplicationMode::ManualReview
        }
        ApplicationAuthority::TaskPreauthorization {
            authorization_id: id,
            ..
        } => {
            validation["authorReviewed"] = json!(false);
            validation["applicationProvenance"] =
                json!({"mode":"task_preauthorization","authorizationId":id});
            SummaryApplicationMode::TaskPreauthorization
        }
    };
    if let Err(code) = ensure_context_eligible(Some(&validation.to_string()), Some("pending"), mode)
    {
        return Err(AppError::new(
            &code,
            "总结存在阻断问题或需要具体人工审阅，未写入正式上下文",
            false,
        ));
    }
    let draft_version = bundle.artifact.source_draft_version;
    let input_summary = SaveChapterSummaryInput {
        id: None,
        novel_id: input.novel_id.clone(),
        chapter_id: chapter_id.to_string(),
        volume_id,
        adopted_draft_id,
        summary,
        key_events: object.and_then(|value| stored_field(value, "keyEvents")),
        character_changes: object.and_then(|value| stored_field(value, "characterChanges")),
        relationship_changes: object.and_then(|value| stored_field(value, "relationshipChanges")),
        new_foreshadows: object.and_then(|value| stored_field(value, "newForeshadows")),
        resolved_foreshadows: object.and_then(|value| stored_field(value, "resolvedForeshadows")),
        next_chapter_hints: object.and_then(|value| stored_field(value, "nextChapterHints")),
        core_events: object.and_then(|value| stored_field(value, "coreEvents")),
        protagonist_state_change: object
            .and_then(|value| stored_field(value, "protagonistStateChange")),
        important_character_changes: object
            .and_then(|value| stored_field(value, "importantCharacterChanges")),
        setting_changes: object.and_then(|value| stored_field(value, "settingChanges")),
        new_locations: object.and_then(|value| stored_field(value, "newLocations")),
        new_items_or_abilities: object.and_then(|value| stored_field(value, "newItemsOrAbilities")),
        foreshadowing: object.and_then(|value| stored_field(value, "foreshadowing")),
        unresolved_questions: object.and_then(|value| stored_field(value, "unresolvedQuestions")),
        facts_must_remember: object.and_then(|value| stored_field(value, "factsMustRemember")),
        next_chapter_hook: object.and_then(|value| stored_field(value, "nextChapterHook")),
        validation_status: Some("pending".to_string()),
        validation_result: Some(validation.to_string()),
        enabled: Some(true),
        content_hash: bundle.artifact.source_base_content_hash.clone(),
        draft_version,
        ai_task_id: Some(bundle.artifact.task_id.clone()),
    };
    let context_records = summary_context_records(
        connection,
        input,
        object,
        input_summary.volume_id.as_deref(),
        &input_summary.summary,
        input_summary.content_hash.as_deref(),
        input_summary.draft_version,
    )?;
    let character_states = match structured_summary_apply::summary_character_states(
        connection,
        input,
        object,
        coverage_required,
    )? {
        structured_summary_apply::CharacterStatesOutcome::Ready(states) => states,
        structured_summary_apply::CharacterStatesOutcome::Conflict(code) => {
            return Ok(DomainOutcome::Conflict(code));
        }
    };
    chapter_context_bundle_service::persist_chapter_context_bundle_in_transaction(
        connection,
        &SaveChapterContextBundleInput {
            novel_id: input.novel_id.clone(),
            chapter_id: chapter_id.to_string(),
            adopted_draft_id: input_summary.adopted_draft_id.clone(),
            summary: input_summary,
            context_records,
            character_states,
        },
        &input.created_at,
    )
    .map_err(|reason| {
        domain_failure("summary_bundle_insert").with_details(json!({
            "stage": "summary_bundle_insert",
            "reason": reason,
        }))
    })?;
    Ok(DomainOutcome::Applied)
}
