//! Native setting-candidate parsing, rule preview and governed setting effects.
use super::*;
use crate::services::world_rule_governance::RuleChange;

pub(super) fn parse_settings(value: &Value) -> Result<Vec<SettingCandidate>, &'static str> {
    let rows = candidate_items(value, &["settings", "candidates"], "name");
    if rows.is_empty() {
        return Err("EMPTY_CANDIDATE");
    }
    if rows.len() > MAX_ITEMS {
        return Err("TOO_MANY_CANDIDATES");
    }
    let mut seen = HashSet::new();
    let mut candidates = Vec::new();
    for row in rows {
        let object = row.as_object().ok_or("STRUCTURED_PAYLOAD_INVALID")?;
        let name = trimmed_text(object.get("name"), MAX_NAME_CHARS)
            .or_else(|| trimmed_text(object.get("title"), MAX_NAME_CHARS))
            .ok_or("STRUCTURED_PAYLOAD_INVALID")?;
        let raw_category = trimmed_text(object.get("category"), MAX_NAME_CHARS)
            .map(|value| value.to_ascii_lowercase());
        let explicit_target = trimmed_text(
            object.get("targetType").or_else(|| object.get("target")),
            MAX_NAME_CHARS,
        )
        .map(|value| value.to_ascii_lowercase());
        if explicit_target.as_deref().is_some_and(|target| {
            !matches!(target, "rule_system" | "rule" | "world_setting" | "world")
        }) {
            return Err("SETTING_TARGET_TYPE_INVALID");
        }
        let target = if explicit_target.as_deref() == Some("rule_system")
            || explicit_target.as_deref() == Some("rule")
            || matches!(
                raw_category.as_deref(),
                Some(
                    "world_rules"
                        | "world_rule"
                        | "rule"
                        | "rules"
                        | "magic"
                        | "technology"
                        | "cultivation"
                        | "combat"
                        | "social"
                )
            ) {
            SettingTarget::Rule
        } else {
            SettingTarget::World
        };
        let target_key = match target {
            SettingTarget::World => "world",
            SettingTarget::Rule => "rule",
        };
        if !seen.insert((target_key, name.clone())) {
            continue;
        }
        let category = match raw_category.as_deref() {
            Some("magic") => Some("magic".to_string()),
            Some("technology") => Some("technology".to_string()),
            Some("cultivation") => Some("cultivation".to_string()),
            Some("combat") => Some("combat".to_string()),
            Some("social") => Some("social".to_string()),
            Some(_) if target == SettingTarget::Rule => Some("other".to_string()),
            _ => None,
        };
        let mut sections = Vec::new();
        if let Some(description) = trimmed_text(
            object.get("description").or_else(|| object.get("content")),
            MAX_FIELD_CHARS,
        ) {
            sections.push(description);
        }
        if let Some(usage) = optional_field(object, "usageInChapter") {
            sections.push(format!("本章用途：{usage}"));
        }
        if let Some(risk) = optional_field(object, "risk") {
            sections.push(format!("风险提示：{risk}"));
        }
        candidates.push(SettingCandidate {
            content: if sections.is_empty() {
                name.clone()
            } else {
                sections.join("\n")
            },
            name,
            target,
            category,
            forbidden_rules: stored_field(object, "forbiddenRules"),
            structured_json: stored_field(object, "structuredJson"),
        });
    }
    if candidates.is_empty() {
        Err("EMPTY_CANDIDATE")
    } else {
        Ok(candidates)
    }
}

fn scoped_rule_preview(
    mut preview: RuleChangePreview,
    input: &ApplyStructuredArtifactInput,
) -> Result<RuleChangePreview, AppError> {
    preview.preview_hash = rule_governance::hash_json(&json!({"previewHash":preview.preview_hash,
        "artifactId":input.artifact_id,"artifactHash":input.artifact_hash,
        "cardId":input.card_id,"conversationId":input.conversation_id,"novelId":input.novel_id}))?;
    Ok(preview)
}

fn setting_rule_changes(candidates: &[SettingCandidate]) -> Vec<RuleChange> {
    candidates
        .iter()
        .map(|candidate| RuleChange {
            operation: None,
            target_type: if candidate.target == SettingTarget::Rule {
                "rule_system"
            } else {
                "world_setting"
            }
            .to_string(),
            target_id: None,
            title: candidate.name.clone(),
            content: candidate.content.clone(),
            category: candidate.category.clone(),
            forbidden_rules: candidate.forbidden_rules.clone(),
            structured_json: candidate.structured_json.clone(),
            is_active: true,
        })
        .collect()
}

pub(crate) fn preview_structured_rule_change_with(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
) -> Result<Option<RuleChangePreview>, AppError> {
    let bundle = validate_static_scope(connection, input)?;
    if bundle.artifact.artifact_type != "setting_candidates" {
        return Ok(None);
    }
    if let Some(conflict) = validate_dynamic_base(connection, input, &bundle)? {
        return Err(AppError::new(
            conflict,
            "规则候选基线已失效，请重新生成",
            false,
        ));
    }
    let value = candidate_value(&bundle).ok_or_else(|| domain_failure("setting_payload"))?;
    let candidates =
        parse_settings(&value).map_err(|code| AppError::new(code, "设定候选内容无效", false))?;
    let preview = rule_governance::preview_rule_change(
        connection,
        &input.novel_id,
        &setting_rule_changes(&candidates),
    )?;
    scoped_rule_preview(preview, input).map(Some)
}

pub(super) fn apply_settings(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    bundle: &artifact_service::ResultArtifactBundle,
) -> Result<DomainOutcome, AppError> {
    let value = candidate_value(bundle).ok_or_else(|| domain_failure("setting_payload"))?;
    let candidates = match parse_settings(&value) {
        Ok(candidates) => candidates,
        Err(code) => return Ok(DomainOutcome::Conflict(code)),
    };
    let changes = setting_rule_changes(&candidates);
    let preview = rule_governance::preview_rule_change(connection, &input.novel_id, &changes)?;
    let scoped = scoped_rule_preview(preview.clone(), input)?;
    let mut authorization = input.change_authorization.clone().ok_or_else(|| {
        AppError::new(
            "RULE_CHANGE_CONFIRMATION_REQUIRED",
            "请先审查规则候选影响并明确确认",
            false,
        )
        .with_details(json!(scoped))
    })?;
    if authorization.preview_hash != scoped.preview_hash {
        return Err(AppError::new(
            "RULE_CHANGE_AUTHORIZATION_INVALID",
            "确认不属于该候选、作品或当前影响预览",
            false,
        ));
    }
    authorization.preview_hash = preview.preview_hash;
    rule_governance::authorize_rule_change(
        connection,
        &input.novel_id,
        &changes,
        input.expected_rule_set_fingerprint.as_deref(),
        Some(&authorization),
    )?;
    let existing_world =
        world_setting_repository::find_world_settings_by_novel(connection, &input.novel_id)
            .map_err(|_| domain_failure("setting_read"))?;
    let existing_world_names = existing_world
        .into_iter()
        .map(|setting| setting.title)
        .collect::<HashSet<_>>();
    let existing_rule_names =
        world_setting_repository::find_rule_systems_by_novel(connection, &input.novel_id)
            .map_err(|_| domain_failure("rule_setting_read"))?
            .into_iter()
            .map(|setting| setting.title)
            .collect::<HashSet<_>>();
    let candidates = candidates
        .into_iter()
        .filter(|candidate| match candidate.target {
            SettingTarget::World => !existing_world_names.contains(&candidate.name),
            SettingTarget::Rule => !existing_rule_names.contains(&candidate.name),
        })
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        return Ok(DomainOutcome::Conflict(
            "SETTING_CANDIDATES_ALREADY_APPLIED",
        ));
    }
    let mut created_targets = Vec::new();
    for candidate in candidates {
        let target_id = uuid::Uuid::new_v4().to_string();
        created_targets.push((
            if candidate.target == SettingTarget::Rule {
                "rule_system"
            } else {
                "world_setting"
            }
            .to_string(),
            target_id.clone(),
        ));
        match candidate.target {
            SettingTarget::World => world_setting_repository::insert_world_setting(
                connection,
                &target_id,
                &input.novel_id,
                &candidate.name,
                &candidate.content,
                true,
                &input.created_at,
            )
            .map_err(|_| domain_failure("setting_insert"))?,
            SettingTarget::Rule => world_setting_repository::insert_rule_system(
                connection,
                &target_id,
                &input.novel_id,
                &candidate.name,
                candidate.category.as_deref(),
                &candidate.content,
                candidate.forbidden_rules.as_deref(),
                true,
                &input.created_at,
            )
            .map_err(|_| domain_failure("rule_setting_insert"))?,
        }
        if let Some(structured) = candidate.structured_json {
            let sql = if candidate.target == SettingTarget::Rule {
                "UPDATE rule_systems SET structured_json=?1 WHERE id=?2 AND novel_id=?3"
            } else {
                "UPDATE world_settings SET structured_json=?1 WHERE id=?2 AND novel_id=?3"
            };
            connection
                .execute(sql, params![structured, target_id, input.novel_id])
                .map_err(AppError::database)?;
        }
    }
    rule_governance::expire_rule_dependent_reviews(connection, &input.novel_id)?;
    Ok(DomainOutcome::AppliedWithReceipt(rule_receipt::save(
        connection,
        input,
        &created_targets,
    )?))
}
