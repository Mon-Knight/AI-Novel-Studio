use crate::domain::context::{
    SaveChapterContextBundleInput, SaveChapterSummaryInput, SaveCharacterStateInput,
    SaveContextRecordInput,
};
use crate::errors::AppError;
use crate::repositories::{
    chapter_event_repository, chapter_repository, chapter_summary_repository,
    character_asset_repository, context_record_repository, draft_repository, novel_repository,
    world_setting_repository,
};
use crate::services::{ai_task_service, artifact_service, chapter_context_bundle_service};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

const MAX_ITEMS: usize = 200;
const MAX_NAME_CHARS: usize = 240;
const MAX_FIELD_CHARS: usize = 400_000;
const MAX_STORY_PLAN_BYTES: usize = 2_000_000;
const MAX_STORY_PLAN_VOLUMES: usize = 50;
const MAX_STORY_PLAN_CHAPTERS: usize = 200;
const MAX_STORY_PLAN_WORDS: i64 = 10_000_000;
const MIN_CHAPTER_TARGET_WORDS: i64 = 500;
const MAX_CHAPTER_TARGET_WORDS: i64 = 10_000;
const CONTEXT_COMPRESSION_PROVIDER_ID: &str = "ans.novel-context.extractive-v1";
const CONTEXT_COMPRESSION_PROVIDER_VERSION: &str = "1.1.0";
const CONTEXT_COMPRESSION_DERIVATION_TYPE: &str = "context_compression";
const CONTEXT_COMPRESSION_TITLE_PREFIX: &str = "小说上下文压缩";
const MIN_CONTEXT_COMPRESSION_BUDGET: u64 = 200;
const MAX_CONTEXT_COMPRESSION_BUDGET: u64 = 20_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyStructuredArtifactInput {
    pub decision_id: String,
    pub artifact_id: String,
    pub artifact_hash: String,
    pub card_id: String,
    pub conversation_id: String,
    pub idempotency_key: String,
    pub actor: String,
    pub target_type: String,
    pub target_id: String,
    pub novel_id: String,
    #[serde(default)]
    pub chapter_id: Option<String>,
    #[serde(default)]
    pub base_revision: Option<String>,
    pub created_at: String,
}

enum DomainOutcome {
    Applied,
    Conflict(&'static str),
}

#[derive(Clone)]
struct CharacterCandidate {
    name: String,
    role_type: String,
    gender: Option<String>,
    identity: Option<String>,
    faction: Option<String>,
    relation_to_protagonist: Option<String>,
    goal: Option<String>,
    personality: Option<String>,
    motivation: Option<String>,
    ability: Option<String>,
    limitation: Option<String>,
    background: Option<String>,
    arc: Option<String>,
    notes: Option<String>,
    special_ability: Option<String>,
    ability_limits: Option<String>,
    behavior_limits: Option<String>,
    forbidden_behaviors: Option<String>,
    current_state: Option<String>,
}

struct ExistingProtagonists {
    has_any: bool,
    names: HashSet<String>,
}

#[derive(Clone)]
struct EventCandidate {
    title: String,
    description: String,
    involved_character_ids: Option<String>,
    impact: Option<String>,
    risk: Option<String>,
}

#[derive(Clone)]
struct SettingCandidate {
    name: String,
    content: String,
    target: SettingTarget,
    category: Option<String>,
    forbidden_rules: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SettingTarget {
    World,
    Rule,
}

struct StoryPlan {
    title: String,
    content: String,
    target_word_count: i64,
    chapter_target_total: i64,
    volumes: Vec<StoryPlanVolume>,
}

struct StoryPlanVolume {
    title: String,
    summary: String,
    goal: String,
    main_conflict: String,
    outline: String,
    chapters: Vec<StoryPlanChapter>,
}

struct StoryPlanChapter {
    title: String,
    outline: String,
    goal: String,
    target_word_count: i64,
    character_names: Vec<String>,
}

struct ChapterBindingTarget {
    id: String,
    title: String,
    outline: String,
    goal: String,
    character_names: Vec<String>,
}

struct BindableCharacter {
    id: String,
    name: String,
    goal: String,
    is_protagonist: bool,
}

struct ContextCompressionSource {
    revision: String,
    character_names: Vec<String>,
    chapter_titles: Vec<String>,
    foreshadow_titles: Vec<String>,
    timeline_titles: Vec<String>,
    world_titles: Vec<String>,
    rule_titles: Vec<String>,
    outline_titles: Vec<String>,
    style_names: Vec<String>,
    output_names: Vec<String>,
}

struct ContextCompressionCandidate {
    source_revision: String,
    compressed_text: String,
}

fn invalid_input(field: &'static str) -> AppError {
    AppError::new(
        "STRUCTURED_APPLY_INPUT_INVALID",
        "结构化产物应用参数无效",
        false,
    )
    .with_details(json!({ "field": field }))
}

fn scope_mismatch() -> AppError {
    AppError::new(
        "STRUCTURED_APPLY_SCOPE_MISMATCH",
        "产物卡片、任务、作品、章节或内容身份不一致",
        false,
    )
}

fn domain_failure(stage: &'static str) -> AppError {
    AppError::new(
        "STRUCTURED_APPLY_DOMAIN_WRITE_FAILED",
        "结构化产物未能写入正式小说事实",
        false,
    )
    .with_details(json!({ "stage": stage }))
}

fn required(value: &str, field: &'static str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        Err(invalid_input(field))
    } else {
        Ok(())
    }
}

fn parse_loose_json(raw: &str) -> Option<Value> {
    let trimmed = raw.trim();
    serde_json::from_str(trimmed).ok().or_else(|| {
        trimmed
            .find(['{', '['])
            .and_then(|start| serde_json::from_str(&trimmed[start..]).ok())
    })
}

fn trimmed_text(value: Option<&Value>, max_chars: usize) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty() && text.chars().count() <= max_chars)
        .map(str::to_string)
}

fn candidate_text(bundle: &artifact_service::ResultArtifactBundle) -> String {
    let structured = bundle.structured_payload_json.as_ref();
    for pointer in ["/data/text", "/text", "/content", "/summary"] {
        if let Some(text) = structured
            .and_then(|value| value.pointer(pointer))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            return text.to_string();
        }
    }
    bundle
        .display_content
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .unwrap_or(bundle.raw_content.trim())
        .to_string()
}

fn candidate_value(bundle: &artifact_service::ResultArtifactBundle) -> Option<Value> {
    let structured = bundle.structured_payload_json.as_ref();
    if let Some(value) = structured {
        let has_candidate_fields = value.is_array()
            || [
                "characters",
                "candidates",
                "events",
                "suggestions",
                "settings",
                "summary",
                "content",
                "title",
            ]
            .iter()
            .any(|key| value.get(key).is_some());
        if has_candidate_fields {
            return Some(value.clone());
        }
        if let Some(data) = value.get("data") {
            let has_nested_fields = data.is_array()
                || [
                    "characters",
                    "candidates",
                    "events",
                    "suggestions",
                    "settings",
                    "summary",
                    "content",
                    "title",
                ]
                .iter()
                .any(|key| data.get(key).is_some());
            if has_nested_fields && data.get("text").is_none() {
                return Some(data.clone());
            }
        }
    }
    parse_loose_json(&candidate_text(bundle)).or_else(|| structured.cloned())
}

fn candidate_items(value: &Value, keys: &[&str], identity_key: &str) -> Vec<Value> {
    if let Some(items) = value.as_array() {
        return items.clone();
    }
    for owner in [Some(value), value.get("data")] {
        let Some(owner) = owner else { continue };
        for key in keys {
            if let Some(items) = owner.get(key).and_then(Value::as_array) {
                return items.clone();
            }
        }
    }
    if value.get(identity_key).is_some() {
        vec![value.clone()]
    } else {
        Vec::new()
    }
}

fn optional_field(object: &Map<String, Value>, key: &str) -> Option<String> {
    trimmed_text(object.get(key), MAX_FIELD_CHARS)
}

fn stored_field(object: &Map<String, Value>, key: &str) -> Option<String> {
    match object.get(key) {
        Some(Value::String(value)) => {
            let value = value.trim();
            (!value.is_empty() && value.chars().count() <= MAX_FIELD_CHARS)
                .then(|| value.to_string())
        }
        Some(value @ (Value::Array(_) | Value::Object(_))) => serde_json::to_string(value)
            .ok()
            .filter(|value| value.chars().count() <= MAX_FIELD_CHARS),
        _ => None,
    }
}

fn exact_object<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Map<String, Value>> {
    let object = value.as_object()?;
    (object.len() == keys.len() && keys.iter().all(|key| object.contains_key(*key)))
        .then_some(object)
}

fn strict_string_list(value: &Value) -> Option<Vec<String>> {
    let rows = value.as_array()?;
    let mut seen = HashSet::new();
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let text = row.as_str()?;
        if text.is_empty()
            || text.trim() != text
            || text.chars().count() > MAX_FIELD_CHARS
            || !seen.insert(text.to_string())
        {
            return None;
        }
        result.push(text.to_string());
    }
    Some(result)
}

fn push_unique(values: &mut Vec<String>, seen: &mut HashSet<String>, value: &str) {
    let value = value.trim();
    if !value.is_empty() && seen.insert(value.to_string()) {
        values.push(value.to_string());
    }
}

fn normalized_novel_revision_timestamp(value: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|timestamp| {
            timestamp
                .with_timezone(&chrono::Utc)
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string()
        })
        .unwrap_or_else(|_| value.to_string())
}

fn context_compression_source(
    connection: &Connection,
    novel_id: &str,
) -> Result<ContextCompressionSource, AppError> {
    let novel = novel_repository::find_by_id(connection, novel_id)
        .map_err(|_| domain_failure("context_compression_novel_read"))?
        .ok_or_else(scope_mismatch)?;
    let mut characters = character_asset_repository::find_characters_by_novel(connection, novel_id)
        .map_err(|_| domain_failure("context_compression_character_read"))?;
    characters.sort_by(|left, right| {
        right
            .is_protagonist
            .cmp(&left.is_protagonist)
            .then_with(|| right.updated_at.cmp(&left.updated_at))
            .then_with(|| left.id.cmp(&right.id))
    });
    let mut chapters = chapter_repository::find_by_novel_id(connection, novel_id)
        .map_err(|_| domain_failure("context_compression_chapter_read"))?;
    let mut volume_orders = HashMap::new();
    {
        let mut statement = connection
            .prepare(
                "SELECT id, order_index FROM volumes
                 WHERE novel_id=?1 AND deleted_at IS NULL ORDER BY order_index ASC, id ASC",
            )
            .map_err(|_| domain_failure("context_compression_volume_read"))?;
        let rows = statement
            .query_map(params![novel_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|_| domain_failure("context_compression_volume_read"))?;
        for row in rows {
            let (id, order) = row.map_err(|_| domain_failure("context_compression_volume_read"))?;
            volume_orders.insert(id, order);
        }
    }
    chapters.sort_by(|left, right| {
        let left_volume = left
            .volume_id
            .as_ref()
            .and_then(|id| volume_orders.get(id))
            .copied()
            .unwrap_or(i64::MAX);
        let right_volume = right
            .volume_id
            .as_ref()
            .and_then(|id| volume_orders.get(id))
            .copied()
            .unwrap_or(i64::MAX);
        left_volume
            .cmp(&right_volume)
            .then_with(|| left.order_index.cmp(&right.order_index))
            .then_with(|| left.id.cmp(&right.id))
    });
    let mut records =
        context_record_repository::find_context_records_by_novel(connection, novel_id)
            .map_err(|_| domain_failure("context_compression_context_read"))?;
    records.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.id.cmp(&left.id))
    });
    let summaries =
        chapter_summary_repository::find_chapter_summaries_by_novel(connection, novel_id)
            .map_err(|_| domain_failure("context_compression_summary_read"))?;
    let mut world_settings =
        world_setting_repository::find_world_settings_by_novel(connection, novel_id)
            .map_err(|_| domain_failure("context_compression_world_read"))?
            .into_iter()
            .filter(|setting| setting.is_active)
            .collect::<Vec<_>>();
    world_settings.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    let mut rule_systems =
        world_setting_repository::find_rule_systems_by_novel(connection, novel_id)
            .map_err(|_| domain_failure("context_compression_rule_read"))?
            .into_iter()
            .filter(|rule| rule.is_active)
            .collect::<Vec<_>>();
    rule_systems.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    let master_outline = connection
        .query_row(
            "SELECT id,title,version,updated_at FROM master_outlines
             WHERE project_id=?1 AND is_active=1 LIMIT 1",
            params![novel_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|_| domain_failure("context_compression_master_outline_read"))?;
    let volume_outlines = {
        let mut statement = connection
            .prepare(
                "SELECT outline.id,outline.title,outline.version,outline.updated_at
                 FROM volume_outlines AS outline
                 JOIN volumes AS volume ON volume.id=outline.volume_id
                 WHERE outline.project_id=?1 AND outline.is_active=1
                   AND volume.novel_id=?1 AND volume.deleted_at IS NULL
                 ORDER BY volume.order_index ASC, volume.id ASC, outline.id ASC",
            )
            .map_err(|_| domain_failure("context_compression_volume_outline_read"))?;
        let rows = statement
            .query_map(params![novel_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|_| domain_failure("context_compression_volume_outline_read"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| domain_failure("context_compression_volume_outline_read"))?;
        rows
    };
    let chapter_outlines = {
        let mut statement = connection
            .prepare(
                "SELECT outline.id,outline.title,outline.version,outline.updated_at
                 FROM chapter_outlines AS outline
                 JOIN chapters AS chapter ON chapter.id=outline.chapter_id
                 LEFT JOIN volumes AS volume ON volume.id=chapter.volume_id
                 WHERE outline.project_id=?1 AND outline.is_active=1
                   AND chapter.novel_id=?1 AND chapter.deleted_at IS NULL
                 ORDER BY COALESCE(volume.order_index,9223372036854775807) ASC,
                          chapter.order_index ASC, chapter.id ASC, outline.id ASC",
            )
            .map_err(|_| domain_failure("context_compression_chapter_outline_read"))?;
        let rows = statement
            .query_map(params![novel_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|_| domain_failure("context_compression_chapter_outline_read"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| domain_failure("context_compression_chapter_outline_read"))?;
        rows
    };
    let style_profile = connection
        .query_row(
            "SELECT id,name,updated_at FROM style_profiles
             WHERE is_active=1 AND (novel_id=?1 OR novel_id IS NULL OR novel_id='')
             ORDER BY CASE
                        WHEN novel_id=?1 THEN 0
                        WHEN source_type='system_default' AND name='默认小说风格' THEN 1
                        ELSE 2
                      END,
                      updated_at DESC, id ASC LIMIT 1",
            params![novel_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|_| domain_failure("context_compression_style_read"))?;
    let output_profile = connection
        .query_row(
            "SELECT id,name,updated_at FROM output_profiles
             WHERE (novel_id=?1 OR novel_id IS NULL) AND is_default=1
             ORDER BY CASE WHEN novel_id=?1 THEN 0 ELSE 1 END,
                      updated_at DESC, id ASC LIMIT 1",
            params![novel_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|_| domain_failure("context_compression_output_read"))?;

    let mut character_names = Vec::new();
    let mut seen_characters = HashSet::new();
    let primary_name = novel
        .protagonists
        .first()
        .map(|profile| profile.name.as_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(novel.main_character.as_str());
    push_unique(&mut character_names, &mut seen_characters, primary_name);
    for character in &characters {
        push_unique(&mut character_names, &mut seen_characters, &character.name);
    }

    let mut chapter_titles = Vec::new();
    let mut seen_chapters = HashSet::new();
    for chapter in &chapters {
        push_unique(&mut chapter_titles, &mut seen_chapters, &chapter.title);
    }

    let mut foreshadow_titles = Vec::new();
    let mut seen_foreshadows = HashSet::new();
    let mut world_titles = Vec::new();
    let mut seen_world = HashSet::new();
    for setting in &world_settings {
        push_unique(&mut world_titles, &mut seen_world, &setting.title);
    }
    let mut rule_titles = Vec::new();
    let mut seen_rules = HashSet::new();
    for rule in &rule_systems {
        push_unique(&mut rule_titles, &mut seen_rules, &rule.title);
    }
    for record in &records {
        if record.title.starts_with(CONTEXT_COMPRESSION_TITLE_PREFIX) {
            continue;
        }
        if record.context_type == "foreshadow" {
            push_unique(&mut foreshadow_titles, &mut seen_foreshadows, &record.title);
        } else if record.context_type == "rule" {
            push_unique(&mut rule_titles, &mut seen_rules, &record.title);
        }
    }

    let mut outline_titles = Vec::new();
    let mut seen_outlines = HashSet::new();
    if let Some((_, title, _, _)) = &master_outline {
        push_unique(&mut outline_titles, &mut seen_outlines, title);
    }
    for (_, title, _, _) in &volume_outlines {
        push_unique(&mut outline_titles, &mut seen_outlines, title);
    }
    for (_, title, _, _) in &chapter_outlines {
        push_unique(&mut outline_titles, &mut seen_outlines, title);
    }
    let style_names = style_profile
        .as_ref()
        .map(|(_, name, _)| vec![name.clone()])
        .unwrap_or_default();
    let output_names = output_profile
        .as_ref()
        .map(|(_, name, _)| vec![name.clone()])
        .unwrap_or_default();

    let mut revision_parts = vec![
        novel_id.to_string(),
        normalized_novel_revision_timestamp(&novel.updated_at),
    ];
    revision_parts.extend(character_names.iter().cloned());
    revision_parts.extend(chapter_titles.iter().cloned());
    revision_parts.extend(records.iter().map(|record| {
        format!(
            "context:{}:{}",
            record.id,
            normalized_novel_revision_timestamp(&record.updated_at)
        )
    }));
    let mut seen_summary_chapters = HashSet::new();
    revision_parts.extend(
        summaries
            .iter()
            .filter(|summary| seen_summary_chapters.insert(summary.chapter_id.clone()))
            .map(|summary| {
                format!(
                    "summary:{}:{}",
                    summary.id,
                    normalized_novel_revision_timestamp(&summary.updated_at)
                )
            }),
    );
    revision_parts.extend(world_settings.iter().map(|setting| {
        format!(
            "world:{}:{}",
            setting.id,
            normalized_novel_revision_timestamp(&setting.updated_at)
        )
    }));
    revision_parts.extend(rule_systems.iter().map(|rule| {
        format!(
            "rule:{}:{}",
            rule.id,
            normalized_novel_revision_timestamp(&rule.updated_at)
        )
    }));
    if let Some((id, _, version, updated_at)) = &master_outline {
        revision_parts.push(format!(
            "master_outline:{}:{}:{}",
            id,
            version,
            normalized_novel_revision_timestamp(updated_at)
        ));
    }
    revision_parts.extend(volume_outlines.iter().map(|(id, _, version, updated_at)| {
        format!(
            "volume_outline:{}:{}:{}",
            id,
            version,
            normalized_novel_revision_timestamp(updated_at)
        )
    }));
    revision_parts.extend(chapter_outlines.iter().map(|(id, _, version, updated_at)| {
        format!(
            "chapter_outline:{}:{}:{}",
            id,
            version,
            normalized_novel_revision_timestamp(updated_at)
        )
    }));
    if let Some((id, _, updated_at)) = &style_profile {
        revision_parts.push(format!(
            "style:{}:{}",
            id,
            normalized_novel_revision_timestamp(updated_at)
        ));
    }
    if let Some((id, _, updated_at)) = &output_profile {
        revision_parts.push(format!(
            "output:{}:{}",
            id,
            normalized_novel_revision_timestamp(updated_at)
        ));
    }
    let revision_body = revision_parts.join("|");
    let utf16 = revision_body.encode_utf16().collect::<Vec<_>>();
    let revision_hash = utf16.iter().fold(0_u32, |hash, unit| {
        hash.wrapping_mul(33).wrapping_add(u32::from(*unit))
    });

    Ok(ContextCompressionSource {
        revision: format!("rev-{revision_hash:08x}-{}", utf16.len()),
        character_names,
        chapter_titles: chapter_titles.clone(),
        foreshadow_titles,
        timeline_titles: chapter_titles,
        world_titles,
        rule_titles,
        outline_titles,
        style_names,
        output_names,
    })
}

fn validate_context_compression_bucket(
    coverage: &Map<String, Value>,
    key: &str,
    expected_required: &[String],
    compressed_text: &str,
) -> bool {
    let Some(bucket) = coverage
        .get(key)
        .and_then(|value| exact_object(value, &["required", "present", "missing"]))
    else {
        return false;
    };
    let (Some(required), Some(present), Some(missing)) = (
        bucket.get("required").and_then(strict_string_list),
        bucket.get("present").and_then(strict_string_list),
        bucket.get("missing").and_then(strict_string_list),
    ) else {
        return false;
    };
    required == expected_required
        && present == required
        && missing.is_empty()
        && required.iter().all(|item| compressed_text.contains(item))
}

fn parse_context_compression_candidate(
    value: &Value,
    input: &ApplyStructuredArtifactInput,
    source: &ContextCompressionSource,
) -> Result<ContextCompressionCandidate, &'static str> {
    let object = exact_object(
        value,
        &[
            "providerId",
            "version",
            "config",
            "novelId",
            "sourceRevision",
            "compressedText",
            "coverage",
            "valid",
        ],
    )
    .ok_or("CONTEXT_COMPRESSION_PAYLOAD_INVALID")?;
    if object.get("providerId").and_then(Value::as_str) != Some(CONTEXT_COMPRESSION_PROVIDER_ID)
        || object.get("version").and_then(Value::as_str)
            != Some(CONTEXT_COMPRESSION_PROVIDER_VERSION)
    {
        return Err("CONTEXT_COMPRESSION_PROVIDER_UNSUPPORTED");
    }
    if object.get("novelId").and_then(Value::as_str) != Some(input.novel_id.as_str()) {
        return Err("CONTEXT_COMPRESSION_SCOPE_MISMATCH");
    }
    if object.get("valid").and_then(Value::as_bool) != Some(true) {
        return Err("CONTEXT_COMPRESSION_VALIDATION_FAILED");
    }
    let config = object
        .get("config")
        .and_then(|value| exact_object(value, &["tokenBudget"]))
        .ok_or("CONTEXT_COMPRESSION_PAYLOAD_INVALID")?;
    let budget = config
        .get("tokenBudget")
        .and_then(Value::as_u64)
        .filter(|budget| {
            (MIN_CONTEXT_COMPRESSION_BUDGET..=MAX_CONTEXT_COMPRESSION_BUDGET).contains(budget)
        })
        .ok_or("CONTEXT_COMPRESSION_PAYLOAD_INVALID")?;
    let source_revision = object
        .get("sourceRevision")
        .and_then(Value::as_str)
        .filter(|revision| !revision.is_empty() && revision.len() <= 96)
        .ok_or("CONTEXT_COMPRESSION_PAYLOAD_INVALID")?;
    if source_revision != source.revision {
        return Err("CONTEXT_COMPRESSION_SOURCE_REVISION_CONFLICT");
    }
    let compressed_text = object
        .get("compressedText")
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty() && text.chars().count() <= MAX_FIELD_CHARS)
        .ok_or("CONTEXT_COMPRESSION_PAYLOAD_INVALID")?;
    let coverage = object
        .get("coverage")
        .and_then(|value| {
            exact_object(
                value,
                &[
                    "characters",
                    "plot",
                    "foreshadow",
                    "timeline",
                    "world",
                    "rules",
                    "outlines",
                    "style",
                    "output",
                    "tokens",
                ],
            )
        })
        .ok_or("CONTEXT_COMPRESSION_PAYLOAD_INVALID")?;
    let tokens = coverage
        .get("tokens")
        .and_then(|value| exact_object(value, &["budget", "used", "withinBudget"]))
        .ok_or("CONTEXT_COMPRESSION_PAYLOAD_INVALID")?;
    let used = tokens
        .get("used")
        .and_then(Value::as_u64)
        .ok_or("CONTEXT_COMPRESSION_PAYLOAD_INVALID")?;
    if tokens.get("budget").and_then(Value::as_u64) != Some(budget)
        || tokens.get("withinBudget").and_then(Value::as_bool) != Some(true)
        || used != compressed_text.chars().count() as u64
        || used > budget
        || !validate_context_compression_bucket(
            coverage,
            "characters",
            &source.character_names,
            compressed_text,
        )
        || !validate_context_compression_bucket(
            coverage,
            "plot",
            &source.chapter_titles,
            compressed_text,
        )
        || !validate_context_compression_bucket(
            coverage,
            "foreshadow",
            &source.foreshadow_titles,
            compressed_text,
        )
        || !validate_context_compression_bucket(
            coverage,
            "timeline",
            &source.timeline_titles,
            compressed_text,
        )
        || !validate_context_compression_bucket(
            coverage,
            "world",
            &source.world_titles,
            compressed_text,
        )
        || !validate_context_compression_bucket(
            coverage,
            "rules",
            &source.rule_titles,
            compressed_text,
        )
        || !validate_context_compression_bucket(
            coverage,
            "outlines",
            &source.outline_titles,
            compressed_text,
        )
        || !validate_context_compression_bucket(
            coverage,
            "style",
            &source.style_names,
            compressed_text,
        )
        || !validate_context_compression_bucket(
            coverage,
            "output",
            &source.output_names,
            compressed_text,
        )
    {
        return Err("CONTEXT_COMPRESSION_VALIDATION_FAILED");
    }
    Ok(ContextCompressionCandidate {
        source_revision: source_revision.to_string(),
        compressed_text: compressed_text.to_string(),
    })
}

fn insert_decision(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    apply_transaction_id: Option<&str>,
    conflict_code: Option<&str>,
) -> Result<crate::repositories::conversation_repository::ArtifactDecisionRecord, AppError> {
    connection
        .execute(
            "INSERT INTO artifact_decisions (
                decision_id, artifact_id, artifact_hash, card_id, conversation_id, decision,
                idempotency_key, actor, target_type, target_id, base_revision,
                apply_transaction_id, conflict_code, created_at
             ) VALUES (?1,?2,?3,?4,?5,'request_apply',?6,?7,?8,?9,?10,?11,?12,?13)",
            params![
                input.decision_id,
                input.artifact_id,
                input.artifact_hash,
                input.card_id,
                input.conversation_id,
                input.idempotency_key,
                input.actor,
                input.target_type,
                input.target_id,
                input.base_revision,
                apply_transaction_id,
                conflict_code,
                input.created_at,
            ],
        )
        .map_err(AppError::database)?;
    connection
        .query_row(
            "SELECT decision_id, artifact_id, artifact_hash, card_id, conversation_id, decision,
                    idempotency_key, actor, target_type, target_id, base_revision,
                    apply_transaction_id, conflict_code, created_at
             FROM artifact_decisions WHERE decision_id=?1",
            params![input.decision_id],
            crate::repositories::conversation_repository::decision_from_row,
        )
        .map_err(AppError::database)
}

fn existing_decision(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
) -> Result<Option<crate::repositories::conversation_repository::ArtifactDecisionRecord>, AppError>
{
    connection
        .query_row(
            "SELECT decision_id, artifact_id, artifact_hash, card_id, conversation_id, decision,
                    idempotency_key, actor, target_type, target_id, base_revision,
                    apply_transaction_id, conflict_code, created_at
             FROM artifact_decisions
             WHERE artifact_id=?1 AND decision='request_apply' AND idempotency_key=?2",
            params![input.artifact_id, input.idempotency_key],
            crate::repositories::conversation_repository::decision_from_row,
        )
        .optional()
        .map_err(AppError::database)
}

fn validate_static_scope(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
) -> Result<artifact_service::ResultArtifactBundle, AppError> {
    for (value, field) in [
        (&input.decision_id, "decisionId"),
        (&input.artifact_id, "artifactId"),
        (&input.artifact_hash, "artifactHash"),
        (&input.card_id, "cardId"),
        (&input.conversation_id, "conversationId"),
        (&input.idempotency_key, "idempotencyKey"),
        (&input.target_id, "targetId"),
        (&input.novel_id, "novelId"),
        (&input.created_at, "createdAt"),
    ] {
        required(value, field)?;
    }
    if input.actor != "user" || input.target_type != "asset" {
        return Err(invalid_input("actorOrTargetType"));
    }

    let (card_artifact_id, card_conversation_id, card_artifact_type, conversation_novel_id) =
        connection
            .query_row(
                "SELECT card.artifact_id, card.conversation_id, card.artifact_type,
                        conversation.novel_id
                 FROM conversation_artifact_cards AS card
                 JOIN task_conversations AS conversation
                   ON conversation.conversation_id=card.conversation_id
                 WHERE card.card_id=?1",
                params![input.card_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(AppError::database)?
            .ok_or_else(scope_mismatch)?;
    let bundle = artifact_service::get_artifact_bundle(connection, &input.artifact_id)?;
    let artifact = &bundle.artifact;
    if card_artifact_id.as_deref() != Some(input.artifact_id.as_str())
        || card_conversation_id != input.conversation_id
        || card_artifact_type != artifact.artifact_type
        || conversation_novel_id != input.novel_id
        || artifact.source_novel_id != input.novel_id
        || artifact.source_chapter_id != input.chapter_id
        || artifact.content_hash != input.artifact_hash
        || artifact.schema_version != 1
        || !matches!(
            artifact.processing_status.as_str(),
            "valid" | "valid_with_warnings"
        )
    {
        return Err(scope_mismatch());
    }
    if matches!(
        artifact.artifact_type.as_str(),
        "quality_report" | "style_analysis"
    ) {
        return Err(AppError::new(
            "ARTIFACT_APPLY_FORBIDDEN",
            "质量或风格报告不能写入正式小说事实",
            false,
        ));
    }
    let expected_target = match artifact.artifact_type.as_str() {
        "outline" if input.chapter_id.is_some() => input.chapter_id.as_deref(),
        "event_candidates" | "chapter_summary" => input.chapter_id.as_deref(),
        _ => Some(input.novel_id.as_str()),
    };
    if expected_target != Some(input.target_id.as_str()) {
        return Err(scope_mismatch());
    }
    Ok(bundle)
}

fn validate_existing_identity(
    existing: &crate::repositories::conversation_repository::ArtifactDecisionRecord,
    input: &ApplyStructuredArtifactInput,
) -> Result<(), AppError> {
    if existing.artifact_hash != input.artifact_hash
        || existing.card_id != input.card_id
        || existing.conversation_id != input.conversation_id
        || existing.actor != input.actor
        || existing.target_type != input.target_type
        || existing.target_id != input.target_id
        || existing.base_revision != input.base_revision
    {
        return Err(AppError::new(
            "STRUCTURED_APPLY_IDEMPOTENCY_CONFLICT",
            "结构化产物应用幂等身份已绑定其他请求",
            false,
        ));
    }
    Ok(())
}

fn validate_dynamic_base(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    bundle: &artifact_service::ResultArtifactBundle,
) -> Result<Option<&'static str>, AppError> {
    let artifact = &bundle.artifact;
    if input.base_revision.as_deref() != artifact.source_base_content_hash.as_deref() {
        return Ok(Some("STRUCTURED_BASE_REVISION_CONFLICT"));
    }
    let Some(chapter_id) = input.chapter_id.as_deref() else {
        return Ok(None);
    };
    let (adopted_draft_id, chapter_revision) = connection
        .query_row(
            "SELECT adopted_draft_id, updated_at FROM chapters
             WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL",
            params![chapter_id, input.novel_id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(scope_mismatch)?;
    let target_hint = connection
        .query_row(
            "SELECT target_hint_json FROM ai_tasks WHERE task_id=?1",
            params![artifact.task_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(AppError::database)?
        .flatten()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    if target_hint
        .as_ref()
        .and_then(|value| value.get("baseChapterRevision"))
        .and_then(Value::as_str)
        .is_some_and(|expected| expected != chapter_revision)
    {
        return Ok(Some("STRUCTURED_CHAPTER_BASE_CONFLICT"));
    }
    match (
        artifact.source_draft_id.as_deref(),
        artifact.source_draft_version,
        artifact.source_base_content_hash.as_deref(),
    ) {
        (None, None, None) => Ok(None),
        (Some(draft_id), Some(draft_version), Some(expected_hash)) => {
            if adopted_draft_id.as_deref() != Some(draft_id) {
                return Ok(Some("STRUCTURED_CHAPTER_BASE_CONFLICT"));
            }
            let draft =
                draft_repository::find_draft(connection, draft_id)?.ok_or_else(scope_mismatch)?;
            if draft.novel_id != input.novel_id
                || draft.chapter_id != chapter_id
                || !draft.is_adopted
                || draft.version_no != draft_version
            {
                return Ok(Some("STRUCTURED_CHAPTER_BASE_CONFLICT"));
            }
            let verified = crate::services::draft_service::load_full_content(connection, &draft)?;
            if !verified.content_hash.eq_ignore_ascii_case(expected_hash) {
                return Ok(Some("STRUCTURED_CHAPTER_BASE_CONFLICT"));
            }
            Ok(None)
        }
        _ => Err(scope_mismatch()),
    }
}

fn required_story_text(
    object: &Map<String, Value>,
    key: &str,
    max_chars: usize,
) -> Result<String, &'static str> {
    let value = object
        .get(key)
        .and_then(Value::as_str)
        .ok_or("STRUCTURED_PAYLOAD_INVALID")?
        .trim();
    if value.is_empty() {
        return Err("STRUCTURED_PAYLOAD_INVALID");
    }
    if value.chars().count() > max_chars {
        return Err("STRUCTURED_PAYLOAD_LIMIT_EXCEEDED");
    }
    Ok(value.to_string())
}

fn bounded_story_number(
    object: &Map<String, Value>,
    key: &str,
    min: i64,
    max: i64,
) -> Result<i64, &'static str> {
    let value = object
        .get(key)
        .and_then(Value::as_i64)
        .ok_or("STRUCTURED_PAYLOAD_INVALID")?;
    if value < min {
        return Err("STRUCTURED_PAYLOAD_INVALID");
    }
    if value > max {
        return Err("STRUCTURED_PAYLOAD_LIMIT_EXCEEDED");
    }
    Ok(value)
}

fn story_plan_character_names(object: &Map<String, Value>) -> Result<Vec<String>, &'static str> {
    let Some(value) = object.get("characterNames") else {
        return Ok(Vec::new());
    };
    let rows = value.as_array().ok_or("STRUCTURED_PAYLOAD_INVALID")?;
    if rows.len() > MAX_ITEMS {
        return Err("STRUCTURED_PAYLOAD_LIMIT_EXCEEDED");
    }
    let mut seen = HashSet::new();
    let mut names = Vec::with_capacity(rows.len());
    for row in rows {
        let name = trimmed_text(Some(row), MAX_NAME_CHARS).ok_or("STRUCTURED_PAYLOAD_INVALID")?;
        if !seen.insert(name.clone()) {
            return Err("STRUCTURED_PAYLOAD_INVALID");
        }
        names.push(name);
    }
    Ok(names)
}

fn story_plan_character_names_from_snapshot(raw: Option<String>) -> Vec<String> {
    raw.and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| {
            value
                .as_object()
                .and_then(|object| story_plan_character_names(object).ok())
        })
        .unwrap_or_default()
}

fn parse_story_plan(value: &Value) -> Result<StoryPlan, &'static str> {
    if serde_json::to_vec(value)
        .map_err(|_| "STRUCTURED_PAYLOAD_INVALID")?
        .len()
        > MAX_STORY_PLAN_BYTES
    {
        return Err("STRUCTURED_PAYLOAD_LIMIT_EXCEEDED");
    }
    let object = value.as_object().ok_or("STRUCTURED_PAYLOAD_INVALID")?;
    if object.get("planKind").and_then(Value::as_str) != Some("story_plan") {
        return Err("STRUCTURED_PAYLOAD_INVALID");
    }
    let rows = object
        .get("volumes")
        .and_then(Value::as_array)
        .ok_or("STRUCTURED_PAYLOAD_INVALID")?;
    if rows.is_empty() {
        return Err("STRUCTURED_PAYLOAD_INVALID");
    }
    if rows.len() > MAX_STORY_PLAN_VOLUMES {
        return Err("STRUCTURED_PAYLOAD_LIMIT_EXCEEDED");
    }

    let mut chapter_count = 0_usize;
    let mut chapter_target_total = 0_i64;
    let mut volumes = Vec::with_capacity(rows.len());
    for row in rows {
        let volume = row.as_object().ok_or("STRUCTURED_PAYLOAD_INVALID")?;
        let chapter_rows = volume
            .get("chapters")
            .and_then(Value::as_array)
            .ok_or("STRUCTURED_PAYLOAD_INVALID")?;
        if chapter_rows.is_empty() {
            return Err("STRUCTURED_PAYLOAD_INVALID");
        }
        chapter_count = chapter_count
            .checked_add(chapter_rows.len())
            .ok_or("STRUCTURED_PAYLOAD_LIMIT_EXCEEDED")?;
        if chapter_count > MAX_STORY_PLAN_CHAPTERS {
            return Err("STRUCTURED_PAYLOAD_LIMIT_EXCEEDED");
        }

        let mut chapters = Vec::with_capacity(chapter_rows.len());
        for chapter_row in chapter_rows {
            let chapter = chapter_row
                .as_object()
                .ok_or("STRUCTURED_PAYLOAD_INVALID")?;
            let target_word_count = bounded_story_number(
                chapter,
                "targetWordCount",
                MIN_CHAPTER_TARGET_WORDS,
                MAX_CHAPTER_TARGET_WORDS,
            )?;
            chapter_target_total = chapter_target_total
                .checked_add(target_word_count)
                .ok_or("STRUCTURED_PAYLOAD_LIMIT_EXCEEDED")?;
            chapters.push(StoryPlanChapter {
                title: required_story_text(chapter, "title", MAX_NAME_CHARS)?,
                outline: required_story_text(chapter, "outline", MAX_FIELD_CHARS)?,
                goal: required_story_text(chapter, "goal", MAX_FIELD_CHARS)?,
                target_word_count,
                character_names: story_plan_character_names(chapter)?,
            });
        }
        volumes.push(StoryPlanVolume {
            title: required_story_text(volume, "title", MAX_NAME_CHARS)?,
            summary: required_story_text(volume, "summary", MAX_FIELD_CHARS)?,
            goal: required_story_text(volume, "goal", MAX_FIELD_CHARS)?,
            main_conflict: required_story_text(volume, "mainConflict", MAX_FIELD_CHARS)?,
            outline: required_story_text(volume, "outline", MAX_FIELD_CHARS)?,
            chapters,
        });
    }

    let target_word_count =
        bounded_story_number(object, "targetWordCount", 1, MAX_STORY_PLAN_WORDS)?;
    if target_word_count < chapter_target_total * 80 / 100
        || target_word_count > chapter_target_total * 120 / 100
    {
        return Err("STRUCTURED_PAYLOAD_INVALID");
    }
    Ok(StoryPlan {
        title: required_story_text(object, "title", MAX_NAME_CHARS)?,
        content: required_story_text(object, "content", MAX_FIELD_CHARS)?,
        target_word_count,
        chapter_target_total,
        volumes,
    })
}

fn story_plan_matches_book_word_goal(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    task_id: &str,
    plan: &StoryPlan,
) -> Result<bool, AppError> {
    let raw_hint = connection
        .query_row(
            "SELECT target_hint_json FROM ai_tasks WHERE task_id=?1",
            params![task_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(AppError::database)?
        .flatten();
    let Some(raw_hint) = raw_hint else {
        return Ok(true);
    };
    let hint: Value = match serde_json::from_str(&raw_hint) {
        Ok(hint) => hint,
        Err(_) => return Ok(false),
    };
    let Some(raw_goal) = hint.get("bookWordGoal") else {
        return Ok(true);
    };
    let goal: ai_task_service::BookWordGoal = match serde_json::from_value(raw_goal.clone()) {
        Ok(goal) => goal,
        Err(_) => return Ok(false),
    };
    if !ai_task_service::verify_book_word_goal(connection, &input.conversation_id, &goal)? {
        return Ok(false);
    }
    Ok(
        (goal.minimum_words..=goal.maximum_words).contains(&plan.target_word_count)
            && (goal.minimum_words..=goal.maximum_words).contains(&plan.chapter_target_total),
    )
}

fn chapter_text_requires_protagonist(chapter_text: &str) -> bool {
    chapter_text.contains("主角")
        || chapter_text.contains("主人公")
        || chapter_text.to_ascii_lowercase().contains("protagonist")
}

fn bind_characters_to_planned_chapters(
    connection: &Connection,
    novel_id: &str,
    created_at: &str,
) -> Result<(), AppError> {
    let chapters = connection
        .prepare(
            "SELECT chapter.id,chapter.title,chapter.outline,chapter.goal,
                    (SELECT outline.context_snapshot
                       FROM chapter_outlines AS outline
                      WHERE outline.project_id=chapter.novel_id
                        AND outline.chapter_id=chapter.id
                        AND outline.is_active=1
                   ORDER BY outline.version DESC,outline.updated_at DESC,outline.id DESC
                      LIMIT 1)
               FROM chapters AS chapter
              WHERE chapter.novel_id=?1 AND chapter.deleted_at IS NULL
           ORDER BY chapter.order_index,chapter.created_at,chapter.id",
        )
        .map_err(AppError::database)?
        .query_map(params![novel_id], |row| {
            Ok(ChapterBindingTarget {
                id: row.get(0)?,
                title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                outline: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                goal: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                character_names: story_plan_character_names_from_snapshot(row.get(4)?),
            })
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    if chapters.is_empty() {
        return Ok(());
    }

    let characters = connection
        .prepare(
            "SELECT id,name,goal,
                    CASE WHEN is_protagonist=1 OR role_type='protagonist' THEN 1 ELSE 0 END
             FROM characters WHERE novel_id=?1 AND is_active=1 ORDER BY created_at,id",
        )
        .map_err(AppError::database)?
        .query_map(params![novel_id], |row| {
            Ok(BindableCharacter {
                id: row.get(0)?,
                name: row.get(1)?,
                goal: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                is_protagonist: row.get::<_, i64>(3)? == 1,
            })
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    if characters.is_empty() {
        return Ok(());
    }

    let mut existing = connection
        .prepare("SELECT chapter_id,character_id FROM chapter_characters WHERE novel_id=?1")
        .map_err(AppError::database)?
        .query_map(params![novel_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(AppError::database)?
        .collect::<Result<HashSet<_>, _>>()
        .map_err(AppError::database)?;

    for character in characters {
        for chapter in &chapters {
            let chapter_text = format!("{}\n{}\n{}", chapter.title, chapter.outline, chapter.goal);
            let explicitly_planned = chapter
                .character_names
                .iter()
                .any(|name| name == &character.name);
            let mentioned_in_text =
                character.name.chars().count() >= 2 && chapter_text.contains(&character.name);
            let mentioned_by_role =
                character.is_protagonist && chapter_text_requires_protagonist(&chapter_text);
            let mentioned_by_goal = character.is_protagonist
                && character.goal.trim().chars().count() >= 4
                && chapter_text.contains(character.goal.trim());
            if !explicitly_planned && !mentioned_in_text && !mentioned_by_role && !mentioned_by_goal
            {
                continue;
            }
            let key = (chapter.id.clone(), character.id.clone());
            if existing.contains(&key) {
                continue;
            }
            let (role_in_chapter, must_appear, note) = if character.is_protagonist {
                (
                    "main",
                    true,
                    if explicitly_planned {
                        "全书规划将主角列入本章；按章纲要求直接出场"
                    } else if mentioned_in_text {
                        "章纲按姓名要求主角参与本章；按章纲要求直接出场"
                    } else if mentioned_by_goal {
                        "章节内容与主角目标一致；按章纲要求直接出场"
                    } else {
                        "章纲以主角职能要求其参与本章；按章纲要求直接出场"
                    },
                )
            } else {
                (
                    "mentioned",
                    false,
                    if explicitly_planned {
                        "全书规划将该角色列入本章；待人工确认是否需要直接出场"
                    } else {
                        "章纲按姓名引用；待人工确认是否需要直接出场"
                    },
                )
            };
            character_asset_repository::insert_chapter_character(
                connection,
                &uuid::Uuid::new_v4().to_string(),
                novel_id,
                &chapter.id,
                &character.id,
                Some(&character.name),
                role_in_chapter,
                must_appear,
                Some(note),
                created_at,
            )
            .map_err(|_| domain_failure("chapter_character_binding_insert"))?;
            existing.insert(key);
        }
    }
    Ok(())
}

fn apply_story_plan(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    task_id: &str,
    value: &Value,
) -> Result<DomainOutcome, AppError> {
    if input.chapter_id.is_some() {
        return Ok(DomainOutcome::Conflict("STORY_PLAN_NOVEL_TARGET_REQUIRED"));
    }
    let plan = match parse_story_plan(value) {
        Ok(plan) => plan,
        Err(code) => return Ok(DomainOutcome::Conflict(code)),
    };
    if !story_plan_matches_book_word_goal(connection, input, task_id, &plan)? {
        return Ok(DomainOutcome::Conflict("STORY_PLAN_WORD_GOAL_CONFLICT"));
    }
    let novel_exists = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM novels WHERE id=?1 AND deleted_at IS NULL)",
            params![input.novel_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(AppError::database)?;
    if novel_exists != 1 {
        return Err(scope_mismatch());
    }
    let existing_structure = connection
        .query_row(
            "SELECT
                (SELECT COUNT(*) FROM volumes WHERE novel_id=?1) +
                (SELECT COUNT(*) FROM chapters WHERE novel_id=?1)",
            params![input.novel_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(AppError::database)?;
    if existing_structure != 0 {
        return Ok(DomainOutcome::Conflict("STORY_PLAN_TARGET_CONFLICT"));
    }

    let context_snapshot = serde_json::to_string(&json!({
        "artifactId": input.artifact_id,
        "artifactHash": input.artifact_hash,
        "planKind": "story_plan",
    }))
    .map_err(|_| domain_failure("story_plan_context"))?;
    let master_outline_id = uuid::Uuid::new_v4().to_string();
    let master_version = connection
        .query_row(
            "SELECT COALESCE(MAX(version),0) FROM master_outlines WHERE project_id=?1",
            params![input.novel_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(AppError::database)?;
    connection
        .execute(
            "UPDATE master_outlines SET is_active=0 WHERE project_id=?1",
            params![input.novel_id],
        )
        .map_err(AppError::database)?;
    connection
        .execute(
            "INSERT INTO master_outlines
             (id,project_id,title,content,status,version,is_active,source_type,
              context_snapshot,created_at,updated_at)
             VALUES (?1,?2,?3,?4,'active',?5,1,'workbench_apply',?6,?7,?7)",
            params![
                master_outline_id,
                input.novel_id,
                plan.title,
                plan.content,
                master_version + 1,
                context_snapshot,
                input.created_at,
            ],
        )
        .map_err(AppError::database)?;

    let mut first_volume_id = None;
    let mut first_chapter_id = None;
    let mut chapter_order = 0_i64;
    for (volume_offset, volume) in plan.volumes.iter().enumerate() {
        let volume_id = uuid::Uuid::new_v4().to_string();
        let volume_outline_id = uuid::Uuid::new_v4().to_string();
        if first_volume_id.is_none() {
            first_volume_id = Some(volume_id.clone());
        }
        connection
            .execute(
                "INSERT INTO volumes
                 (id,novel_id,title,summary,goal,main_conflict,order_index,status,created_at,updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,'planned',?8,?8)",
                params![
                    volume_id,
                    input.novel_id,
                    volume.title,
                    volume.summary,
                    volume.goal,
                    volume.main_conflict,
                    volume_offset as i64,
                    input.created_at,
                ],
            )
            .map_err(AppError::database)?;
        connection
            .execute(
                "INSERT INTO volume_outlines
                 (id,project_id,master_outline_id,volume_id,volume_index,title,content,status,
                  version,is_active,source_type,context_snapshot,created_at,updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,'active',1,1,'workbench_apply',?8,?9,?9)",
                params![
                    volume_outline_id,
                    input.novel_id,
                    master_outline_id,
                    volume_id,
                    volume_offset as i64 + 1,
                    volume.title,
                    volume.outline,
                    context_snapshot,
                    input.created_at,
                ],
            )
            .map_err(AppError::database)?;

        for chapter in &volume.chapters {
            let chapter_id = uuid::Uuid::new_v4().to_string();
            let chapter_outline_id = uuid::Uuid::new_v4().to_string();
            let chapter_context_snapshot = serde_json::to_string(&json!({
                "artifactId": input.artifact_id,
                "artifactHash": input.artifact_hash,
                "planKind": "story_plan",
                "characterNames": chapter.character_names,
            }))
            .map_err(|_| domain_failure("story_plan_chapter_context"))?;
            if first_chapter_id.is_none() {
                first_chapter_id = Some(chapter_id.clone());
            }
            connection
                .execute(
                    "INSERT INTO chapters
                     (id,novel_id,volume_id,title,outline,goal,order_index,status,word_count,
                      target_word_count,created_at,updated_at)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,'outline_ready',0,?8,?9,?9)",
                    params![
                        chapter_id,
                        input.novel_id,
                        volume_id,
                        chapter.title,
                        chapter.outline,
                        chapter.goal,
                        chapter_order,
                        chapter.target_word_count,
                        input.created_at,
                    ],
                )
                .map_err(AppError::database)?;
            connection
                .execute(
                    "INSERT INTO chapter_outlines
                     (id,project_id,volume_outline_id,chapter_id,chapter_index,title,content,status,
                      version,is_active,source_type,context_snapshot,created_at,updated_at)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,'active',1,1,'workbench_apply',?8,?9,?9)",
                    params![
                        chapter_outline_id,
                        input.novel_id,
                        volume_outline_id,
                        chapter_id,
                        chapter_order + 1,
                        chapter.title,
                        chapter.outline,
                        chapter_context_snapshot,
                        input.created_at,
                    ],
                )
                .map_err(AppError::database)?;
            chapter_order += 1;
        }
    }

    bind_characters_to_planned_chapters(connection, &input.novel_id, &input.created_at)?;

    let updated = connection
        .execute(
            "UPDATE novels
             SET outline=?1,target_word_count=?2,current_volume_id=?3,current_chapter_id=?4,
                 updated_at=?5
             WHERE id=?6 AND deleted_at IS NULL",
            params![
                plan.content,
                plan.target_word_count,
                first_volume_id,
                first_chapter_id,
                input.created_at,
                input.novel_id,
            ],
        )
        .map_err(AppError::database)?;
    if updated != 1 {
        return Err(domain_failure("story_plan_novel_update"));
    }
    Ok(DomainOutcome::Applied)
}

fn apply_outline(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    bundle: &artifact_service::ResultArtifactBundle,
) -> Result<DomainOutcome, AppError> {
    let candidate = candidate_value(bundle);
    if candidate
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|object| object.get("planKind"))
        .and_then(Value::as_str)
        == Some("story_plan")
    {
        return apply_story_plan(
            connection,
            input,
            &bundle.artifact.task_id,
            candidate.as_ref().expect("story plan candidate exists"),
        );
    }
    let object = candidate.as_ref().and_then(Value::as_object);
    let title = object
        .and_then(|object| trimmed_text(object.get("title"), MAX_NAME_CHARS))
        .unwrap_or_else(|| "工作台大纲候选".to_string());
    let content = object
        .and_then(|object| {
            trimmed_text(object.get("content"), MAX_FIELD_CHARS)
                .or_else(|| trimmed_text(object.get("outline"), MAX_FIELD_CHARS))
                .or_else(|| trimmed_text(object.get("text"), MAX_FIELD_CHARS))
        })
        .unwrap_or_else(|| candidate_text(bundle));
    if content.trim().is_empty() || content.chars().count() > MAX_FIELD_CHARS {
        return Ok(DomainOutcome::Conflict("EMPTY_CANDIDATE"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let context_snapshot = serde_json::to_string(&json!({
        "artifactId": input.artifact_id,
        "artifactHash": input.artifact_hash,
    }))
    .map_err(|_| domain_failure("outline_context"))?;
    if let Some(chapter_id) = input.chapter_id.as_deref() {
        let chapter_index = connection
            .query_row(
                "SELECT order_index FROM chapters
                 WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL",
                params![chapter_id, input.novel_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(AppError::database)?;
        let max_version = connection
            .query_row(
                "SELECT COALESCE(MAX(version),0) FROM chapter_outlines
                 WHERE project_id=?1 AND chapter_id=?2",
                params![input.novel_id, chapter_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(AppError::database)?;
        connection
            .execute(
                "UPDATE chapter_outlines SET is_active=0
                 WHERE project_id=?1 AND chapter_id=?2",
                params![input.novel_id, chapter_id],
            )
            .map_err(AppError::database)?;
        connection
            .execute(
                "INSERT INTO chapter_outlines
                 (id,project_id,volume_outline_id,chapter_id,chapter_index,title,content,status,
                  version,is_active,source_type,context_snapshot,created_at,updated_at)
                 VALUES (?1,?2,NULL,?3,?4,?5,?6,'active',?7,1,'workbench_apply',?8,?9,?9)",
                params![
                    id,
                    input.novel_id,
                    chapter_id,
                    chapter_index,
                    title,
                    content,
                    max_version + 1,
                    context_snapshot,
                    input.created_at,
                ],
            )
            .map_err(AppError::database)?;
        let updated = connection
            .execute(
                "UPDATE chapters
                 SET outline=?1,
                     status=CASE WHEN status='not_started' THEN 'outline_ready' ELSE status END,
                     updated_at=?2
                 WHERE id=?3 AND novel_id=?4 AND deleted_at IS NULL",
                params![content, input.created_at, chapter_id, input.novel_id],
            )
            .map_err(|_| domain_failure("chapter_outline_chapter_update"))?;
        if updated != 1 {
            return Err(domain_failure("chapter_outline_chapter_update"));
        }
    } else {
        let max_version = connection
            .query_row(
                "SELECT COALESCE(MAX(version),0) FROM master_outlines WHERE project_id=?1",
                params![input.novel_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(AppError::database)?;
        connection
            .execute(
                "UPDATE master_outlines SET is_active=0 WHERE project_id=?1",
                params![input.novel_id],
            )
            .map_err(AppError::database)?;
        connection
            .execute(
                "INSERT INTO master_outlines
                 (id,project_id,title,content,status,version,is_active,source_type,
                  context_snapshot,created_at,updated_at)
                 VALUES (?1,?2,?3,?4,'active',?5,1,'workbench_apply',?6,?7,?7)",
                params![
                    id,
                    input.novel_id,
                    title,
                    content,
                    max_version + 1,
                    context_snapshot,
                    input.created_at,
                ],
            )
            .map_err(AppError::database)?;
    }
    Ok(DomainOutcome::Applied)
}

fn parse_characters(value: &Value) -> Result<Vec<CharacterCandidate>, &'static str> {
    let rows = candidate_items(value, &["characters", "candidates"], "name");
    if rows.is_empty() {
        return Err("EMPTY_CANDIDATE");
    }
    if rows.len() > MAX_ITEMS {
        return Err("TOO_MANY_CANDIDATES");
    }
    let mut names = HashSet::new();
    let mut candidates = Vec::new();
    for row in rows {
        let object = row.as_object().ok_or("STRUCTURED_PAYLOAD_INVALID")?;
        let name =
            trimmed_text(object.get("name"), MAX_NAME_CHARS).ok_or("STRUCTURED_PAYLOAD_INVALID")?;
        if !names.insert(name.clone()) {
            return Err("DUPLICATE_CANDIDATE");
        }
        let role = match trimmed_text(object.get("roleType"), 40) {
            Some(role)
                if matches!(
                    role.as_str(),
                    "protagonist" | "supporting" | "antagonist" | "neutral"
                ) =>
            {
                role
            }
            Some(_) => return Err("STRUCTURED_PAYLOAD_INVALID"),
            None => "supporting".to_string(),
        };
        candidates.push(CharacterCandidate {
            name,
            role_type: role,
            gender: optional_field(object, "gender"),
            identity: optional_field(object, "identity"),
            faction: optional_field(object, "faction"),
            relation_to_protagonist: optional_field(object, "relationToProtagonist"),
            goal: optional_field(object, "goal"),
            personality: optional_field(object, "personality"),
            motivation: optional_field(object, "motivation"),
            ability: optional_field(object, "ability"),
            limitation: optional_field(object, "limitation"),
            background: optional_field(object, "background"),
            arc: optional_field(object, "arc"),
            notes: optional_field(object, "notes"),
            special_ability: optional_field(object, "specialAbility"),
            ability_limits: optional_field(object, "abilityLimits"),
            behavior_limits: optional_field(object, "behaviorLimits"),
            forbidden_behaviors: optional_field(object, "forbiddenBehaviors"),
            current_state: optional_field(object, "currentState"),
        });
    }
    if candidates.is_empty() {
        Err("EMPTY_CANDIDATE")
    } else {
        Ok(candidates)
    }
}

fn existing_protagonists(
    connection: &Connection,
    novel_id: &str,
) -> Result<ExistingProtagonists, AppError> {
    let (main_character, protagonists_json) = connection
        .query_row(
            "SELECT main_character, protagonists_json FROM novels
             WHERE id=?1 AND deleted_at IS NULL",
            params![novel_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(scope_mismatch)?;
    let mut names = HashSet::new();
    let main_character = main_character.trim();
    if !main_character.is_empty() {
        names.insert(main_character.to_string());
    }
    let protagonists_json = protagonists_json.trim();
    let mut novel_profiles_present = false;
    if !protagonists_json.is_empty() && protagonists_json != "[]" {
        match serde_json::from_str::<Value>(protagonists_json) {
            Ok(Value::Array(profiles)) => {
                for profile in profiles {
                    if let Some(name) = profile
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|name| !name.is_empty())
                    {
                        novel_profiles_present = true;
                        names.insert(name.to_string());
                    }
                }
            }
            // Malformed or non-array profile data is an occupied source. Do not
            // repair it by silently replacing it during artifact application.
            _ => novel_profiles_present = true,
        }
    }

    let mut has_table_protagonist = false;
    let mut protagonist_statement = connection
        .prepare("SELECT name FROM protagonists WHERE novel_id=?1")
        .map_err(AppError::database)?;
    let protagonist_rows = protagonist_statement
        .query_map(params![novel_id], |row| row.get::<_, String>(0))
        .map_err(AppError::database)?;
    for name in protagonist_rows {
        has_table_protagonist = true;
        let name = name.map_err(AppError::database)?;
        let name = name.trim();
        if !name.is_empty() {
            names.insert(name.to_string());
        }
    }

    let mut has_character_protagonist = false;
    let mut character_statement = connection
        .prepare(
            "SELECT name FROM characters
             WHERE novel_id=?1 AND is_active=1
               AND (is_protagonist=1 OR role_type='protagonist')",
        )
        .map_err(AppError::database)?;
    let character_rows = character_statement
        .query_map(params![novel_id], |row| row.get::<_, String>(0))
        .map_err(AppError::database)?;
    for name in character_rows {
        has_character_protagonist = true;
        let name = name.map_err(AppError::database)?;
        let name = name.trim();
        if !name.is_empty() {
            names.insert(name.to_string());
        }
    }

    Ok(ExistingProtagonists {
        has_any: !main_character.is_empty()
            || novel_profiles_present
            || has_table_protagonist
            || has_character_protagonist,
        names,
    })
}

fn write_formal_protagonist_projection(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    protagonist_id: &str,
    candidate: &CharacterCandidate,
) -> Result<(), AppError> {
    let profile_json = serde_json::to_string(&vec![json!({
        "id": protagonist_id,
        "label": "primary",
        "name": candidate.name,
        "gender": candidate.gender.as_deref().unwrap_or_default(),
        "identity": candidate.identity.as_deref().unwrap_or_default(),
        "personality": candidate.personality.as_deref().unwrap_or_default(),
        "goal": candidate.goal.as_deref().unwrap_or_default(),
        "motivation": candidate.motivation.as_deref().unwrap_or_default(),
        "ability": candidate.ability.as_deref().unwrap_or_default(),
        "limitation": candidate.limitation.as_deref().unwrap_or_default(),
        "background": candidate.background.as_deref().unwrap_or_default(),
        "arc": candidate.arc.as_deref().unwrap_or_default(),
        "notes": candidate.notes.as_deref().or(candidate.current_state.as_deref()).unwrap_or_default(),
        "specialAbility": candidate.special_ability,
        "abilityLimits": candidate.ability_limits,
        "forbiddenBehaviors": candidate.forbidden_behaviors,
    })])
    .map_err(|_| domain_failure("protagonist_profile_serialize"))?;
    let updated = connection
        .execute(
            "UPDATE novels
             SET protagonist_mode='single', protagonists_json=?1, main_character=?2, updated_at=?3
             WHERE id=?4 AND deleted_at IS NULL",
            params![
                profile_json,
                candidate.name,
                input.created_at,
                input.novel_id
            ],
        )
        .map_err(AppError::database)?;
    if updated != 1 {
        return Err(domain_failure("protagonist_novel_projection"));
    }
    connection
        .execute(
            "INSERT INTO protagonists (
                id,novel_id,name,identity,personality,goal,special_ability,ability_limits,
                forbidden_behaviors,current_state,created_at,updated_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
            params![
                protagonist_id,
                input.novel_id,
                candidate.name,
                candidate.identity,
                candidate.personality,
                candidate.goal,
                candidate.special_ability,
                candidate.ability_limits,
                candidate.forbidden_behaviors,
                candidate.current_state,
                input.created_at,
            ],
        )
        .map_err(AppError::database)?;
    Ok(())
}

fn apply_characters(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    bundle: &artifact_service::ResultArtifactBundle,
) -> Result<DomainOutcome, AppError> {
    let value = candidate_value(bundle).ok_or_else(|| domain_failure("character_payload"))?;
    let candidates = match parse_characters(&value) {
        Ok(candidates) => candidates,
        Err(code) => return Ok(DomainOutcome::Conflict(code)),
    };
    let existing_protagonists = existing_protagonists(connection, &input.novel_id)?;
    let protagonist_candidates = candidates
        .iter()
        .filter(|candidate| candidate.role_type == "protagonist")
        .collect::<Vec<_>>();
    if existing_protagonists.has_any
        && protagonist_candidates
            .iter()
            .any(|candidate| !existing_protagonists.names.contains(&candidate.name))
    {
        return Ok(DomainOutcome::Conflict("PROTAGONIST_ALREADY_EXISTS"));
    }
    if !existing_protagonists.has_any && protagonist_candidates.len() > 1 {
        return Ok(DomainOutcome::Conflict("PROTAGONIST_CANDIDATES_AMBIGUOUS"));
    }
    let promoted_protagonist_name = (!existing_protagonists.has_any)
        .then(|| {
            protagonist_candidates
                .first()
                .map(|candidate| candidate.name.clone())
        })
        .flatten();
    let existing =
        character_asset_repository::find_characters_by_novel(connection, &input.novel_id)
            .map_err(|_| domain_failure("character_read"))?;
    let existing_names = existing
        .into_iter()
        .map(|character| character.name)
        .collect::<HashSet<_>>();
    if promoted_protagonist_name
        .as_ref()
        .is_some_and(|name| existing_names.contains(name))
    {
        return Ok(DomainOutcome::Conflict("PROTAGONIST_NAME_CONFLICT"));
    }
    let candidates = candidates
        .into_iter()
        .filter(|candidate| {
            !existing_names.contains(&candidate.name)
                && !(existing_protagonists.has_any
                    && candidate.role_type == "protagonist"
                    && existing_protagonists.names.contains(&candidate.name))
        })
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        return Ok(DomainOutcome::Conflict(
            "CHARACTER_CANDIDATES_ALREADY_APPLIED",
        ));
    }
    for candidate in candidates {
        let character_id = uuid::Uuid::new_v4().to_string();
        let is_promoted = promoted_protagonist_name.as_deref() == Some(candidate.name.as_str());
        if is_promoted {
            write_formal_protagonist_projection(connection, input, &character_id, &candidate)?;
        }
        character_asset_repository::insert_character(
            connection,
            &character_id,
            &input.novel_id,
            &candidate.name,
            &candidate.role_type,
            candidate.identity.as_deref(),
            candidate.faction.as_deref(),
            candidate.relation_to_protagonist.as_deref(),
            candidate.goal.as_deref(),
            candidate.personality.as_deref(),
            candidate.behavior_limits.as_deref(),
            candidate.forbidden_behaviors.as_deref(),
            candidate.current_state.as_deref(),
            "ai_generated",
            is_promoted,
            &input.created_at,
        )
        .map_err(|_| domain_failure("character_insert"))?;
        if is_promoted {
            connection
                .execute(
                    "UPDATE characters
                     SET protagonist_key='primary', protagonist_label='主角',
                         protagonist_order=0, source_type='workbench_apply'
                     WHERE id=?1",
                    params![character_id],
                )
                .map_err(AppError::database)?;
        }
    }
    bind_characters_to_planned_chapters(connection, &input.novel_id, &input.created_at)?;
    Ok(DomainOutcome::Applied)
}

fn parse_events(value: &Value) -> Result<Vec<EventCandidate>, &'static str> {
    let rows = candidate_items(value, &["events", "suggestions", "candidates"], "title");
    if rows.is_empty() || rows.len() > MAX_ITEMS {
        return Err("EMPTY_CANDIDATE");
    }
    let mut seen = HashSet::new();
    let mut candidates = Vec::new();
    for row in rows {
        let object = row.as_object().ok_or("STRUCTURED_PAYLOAD_INVALID")?;
        let title = trimmed_text(object.get("title"), MAX_NAME_CHARS)
            .or_else(|| trimmed_text(object.get("name"), MAX_NAME_CHARS))
            .ok_or("STRUCTURED_PAYLOAD_INVALID")?;
        let description = trimmed_text(object.get("description"), MAX_FIELD_CHARS)
            .or_else(|| trimmed_text(object.get("summary"), MAX_FIELD_CHARS))
            .unwrap_or_else(|| title.clone());
        if !seen.insert((title.clone(), description.clone())) {
            continue;
        }
        let involved_character_ids = object
            .get("involvedCharacterIds")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|id| !id.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .filter(|items| !items.is_empty())
            .and_then(|items| serde_json::to_string(&items).ok());
        candidates.push(EventCandidate {
            title,
            description,
            involved_character_ids,
            impact: optional_field(object, "impact"),
            risk: optional_field(object, "risk"),
        });
    }
    if candidates.is_empty() {
        Err("EMPTY_CANDIDATE")
    } else {
        Ok(candidates)
    }
}

fn apply_events(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    bundle: &artifact_service::ResultArtifactBundle,
) -> Result<DomainOutcome, AppError> {
    let Some(chapter_id) = input.chapter_id.as_deref() else {
        return Ok(DomainOutcome::Conflict("CHAPTER_TARGET_REQUIRED"));
    };
    let value = candidate_value(bundle).ok_or_else(|| domain_failure("event_payload"))?;
    let candidates = match parse_events(&value) {
        Ok(candidates) => candidates,
        Err(code) => return Ok(DomainOutcome::Conflict(code)),
    };
    for candidate in candidates {
        chapter_event_repository::insert_chapter_event(
            connection,
            &uuid::Uuid::new_v4().to_string(),
            &input.novel_id,
            chapter_id,
            &candidate.title,
            &candidate.description,
            candidate.involved_character_ids.as_deref(),
            candidate.impact.as_deref(),
            candidate.risk.as_deref(),
            "adopted",
            "ai_suggested",
            Some(&bundle.artifact.task_id),
            &input.created_at,
        )
        .map_err(|_| domain_failure("event_insert"))?;
    }
    Ok(DomainOutcome::Applied)
}

fn parse_settings(value: &Value) -> Result<Vec<SettingCandidate>, &'static str> {
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
        });
    }
    if candidates.is_empty() {
        Err("EMPTY_CANDIDATE")
    } else {
        Ok(candidates)
    }
}

fn apply_settings(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    bundle: &artifact_service::ResultArtifactBundle,
) -> Result<DomainOutcome, AppError> {
    let value = candidate_value(bundle).ok_or_else(|| domain_failure("setting_payload"))?;
    let candidates = match parse_settings(&value) {
        Ok(candidates) => candidates,
        Err(code) => return Ok(DomainOutcome::Conflict(code)),
    };
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
    for candidate in candidates {
        match candidate.target {
            SettingTarget::World => world_setting_repository::insert_world_setting(
                connection,
                &uuid::Uuid::new_v4().to_string(),
                &input.novel_id,
                &candidate.name,
                &candidate.content,
                true,
                &input.created_at,
            )
            .map_err(|_| domain_failure("setting_insert"))?,
            SettingTarget::Rule => world_setting_repository::insert_rule_system(
                connection,
                &uuid::Uuid::new_v4().to_string(),
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
    }
    Ok(DomainOutcome::Applied)
}

fn existing_context_record_id(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
    context_type: &str,
    title: &str,
) -> Result<Option<String>, AppError> {
    connection
        .query_row(
            "SELECT id FROM context_records
             WHERE novel_id=?1 AND chapter_id=?2 AND context_type=?3 AND title=?4
             ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1",
            params![novel_id, chapter_id, context_type, title],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)
}

fn normalized_context_type(value: Option<&Value>) -> String {
    match value.and_then(Value::as_str).map(str::trim) {
        Some(
            value @ ("chapter_summary" | "volume_summary" | "character_state" | "foreshadow"
            | "rule" | "relationship" | "plot_progress" | "other"),
        ) => value.to_string(),
        _ => "other".to_string(),
    }
}

fn summary_context_records(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    object: Option<&Map<String, Value>>,
    volume_id: Option<&str>,
    summary: &str,
    content_hash: Option<&str>,
    draft_version: Option<i64>,
) -> Result<Vec<SaveContextRecordInput>, AppError> {
    let mut records = Vec::new();
    let mut seen = HashSet::new();
    if let Some(items) = object
        .and_then(|value| value.get("contextRecords"))
        .and_then(Value::as_array)
    {
        for item in items.iter().take(MAX_ITEMS) {
            let Some(item) = item.as_object() else {
                continue;
            };
            let Some(content) = trimmed_text(item.get("content"), MAX_FIELD_CHARS) else {
                continue;
            };
            let context_type = normalized_context_type(item.get("contextType"));
            let title = trimmed_text(item.get("title"), MAX_NAME_CHARS)
                .unwrap_or_else(|| "上下文记录".to_string());
            if !seen.insert((context_type.clone(), title.clone())) {
                continue;
            }
            let id = existing_context_record_id(
                connection,
                &input.novel_id,
                &input.chapter_id.clone().unwrap_or_default(),
                &context_type,
                &title,
            )?
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let importance = item
                .get("importance")
                .and_then(Value::as_i64)
                .unwrap_or(3)
                .clamp(1, 5);
            records.push(SaveContextRecordInput {
                id: Some(id),
                novel_id: input.novel_id.clone(),
                chapter_id: input.chapter_id.clone(),
                volume_id: volume_id.map(str::to_string),
                context_type,
                title,
                content,
                importance: Some(importance),
                is_active: Some(true),
                content_hash: content_hash.map(str::to_string),
                draft_version,
            });
        }
    }
    if !records
        .iter()
        .any(|record| record.context_type == "chapter_summary")
    {
        let title = object
            .and_then(|value| trimmed_text(value.get("summaryTitle"), MAX_NAME_CHARS))
            .unwrap_or_else(|| "章节总结".to_string());
        let id = existing_context_record_id(
            connection,
            &input.novel_id,
            &input.chapter_id.clone().unwrap_or_default(),
            "chapter_summary",
            &title,
        )?
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        records.push(SaveContextRecordInput {
            id: Some(id),
            novel_id: input.novel_id.clone(),
            chapter_id: input.chapter_id.clone(),
            volume_id: volume_id.map(str::to_string),
            context_type: "chapter_summary".to_string(),
            title,
            content: summary.to_string(),
            importance: Some(5),
            is_active: Some(true),
            content_hash: content_hash.map(str::to_string),
            draft_version,
        });
    }
    Ok(records)
}

fn resolve_summary_character_id(
    connection: &Connection,
    novel_id: &str,
    object: &Map<String, Value>,
) -> Result<Option<String>, AppError> {
    if let Some(character_id) = trimmed_text(object.get("characterId"), MAX_NAME_CHARS) {
        return connection
            .query_row(
                "SELECT id FROM characters
                 WHERE id=?1 AND novel_id=?2 AND is_active=1 LIMIT 1",
                params![character_id, novel_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::database);
    }
    let Some(name) = trimmed_text(
        object.get("characterName").or_else(|| object.get("name")),
        MAX_NAME_CHARS,
    ) else {
        return Ok(None);
    };
    connection
        .query_row(
            "SELECT id FROM characters
             WHERE novel_id=?1 AND name=?2 AND is_active=1
             ORDER BY is_protagonist DESC, protagonist_order, created_at, id LIMIT 1",
            params![novel_id, name],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)
}

fn existing_character_state_id(
    connection: &Connection,
    novel_id: &str,
    chapter_id: &str,
    character_id: &str,
) -> Result<Option<String>, AppError> {
    connection
        .query_row(
            "SELECT id FROM character_states
             WHERE novel_id=?1 AND chapter_id=?2 AND character_id=?3
             ORDER BY created_at DESC, id DESC LIMIT 1",
            params![novel_id, chapter_id, character_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)
}

fn summary_character_states(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    object: Option<&Map<String, Value>>,
) -> Result<Vec<SaveCharacterStateInput>, AppError> {
    let Some(chapter_id) = input.chapter_id.as_deref() else {
        return Ok(Vec::new());
    };
    let mut changes = Vec::<Map<String, Value>>::new();
    if let Some(items) = object
        .and_then(|value| value.get("characterChanges"))
        .and_then(Value::as_array)
    {
        changes.extend(
            items
                .iter()
                .take(MAX_ITEMS)
                .filter_map(Value::as_object)
                .cloned(),
        );
    }
    if let Some(items) = object
        .and_then(|value| value.get("importantCharacterChanges"))
        .and_then(Value::as_array)
    {
        for item in items.iter().take(MAX_ITEMS).filter_map(Value::as_object) {
            let mut normalized = item.clone();
            if normalized.get("characterName").is_none() {
                if let Some(name) = normalized.get("name").cloned() {
                    normalized.insert("characterName".to_string(), name);
                }
            }
            if normalized.get("stateSummary").is_none() {
                if let Some(change) = normalized.get("change").cloned() {
                    normalized.insert("stateSummary".to_string(), change);
                }
            }
            changes.push(normalized);
        }
    }
    if let Some(protagonist_state) =
        object.and_then(|value| trimmed_text(value.get("protagonistStateChange"), MAX_FIELD_CHARS))
    {
        let protagonist = connection
            .query_row(
                "SELECT id,name FROM characters
                 WHERE novel_id=?1 AND is_active=1 AND is_protagonist=1
                 ORDER BY protagonist_order, created_at, id LIMIT 1",
                params![input.novel_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(AppError::database)?;
        if let Some((character_id, character_name)) = protagonist {
            let mut change = Map::new();
            change.insert("characterId".to_string(), Value::String(character_id));
            change.insert("characterName".to_string(), Value::String(character_name));
            change.insert("stateSummary".to_string(), Value::String(protagonist_state));
            changes.push(change);
        }
    }

    let mut seen = HashSet::new();
    let mut states = Vec::new();
    for change in changes {
        let Some(state_summary) = trimmed_text(change.get("stateSummary"), MAX_FIELD_CHARS) else {
            continue;
        };
        let Some(character_id) =
            resolve_summary_character_id(connection, &input.novel_id, &change)?
        else {
            continue;
        };
        if !seen.insert(character_id.clone()) {
            continue;
        }
        let id =
            existing_character_state_id(connection, &input.novel_id, chapter_id, &character_id)?
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        states.push(SaveCharacterStateInput {
            id: Some(id),
            novel_id: input.novel_id.clone(),
            character_id,
            chapter_id: Some(chapter_id.to_string()),
            state_summary,
            relationship_changes: stored_field(&change, "relationshipChanges"),
            goal_changes: stored_field(&change, "goalChanges"),
            location: stored_field(&change, "location"),
            health_state: stored_field(&change, "healthState"),
            knowledge_state: stored_field(&change, "knowledgeState"),
        });
    }
    Ok(states)
}

fn apply_summary(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    bundle: &artifact_service::ResultArtifactBundle,
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
    let object = value.as_object();
    let summary = object
        .and_then(|object| trimmed_text(object.get("summary"), MAX_FIELD_CHARS))
        .unwrap_or_else(|| candidate_text(bundle).trim().to_string());
    if summary.is_empty() || summary.chars().count() > MAX_FIELD_CHARS {
        return Ok(DomainOutcome::Conflict("EMPTY_CANDIDATE"));
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
        validation_status: Some("passed".to_string()),
        validation_result: None,
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
    let character_states = summary_character_states(connection, input, object)?;
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

fn apply_context_compression(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    bundle: &artifact_service::ResultArtifactBundle,
) -> Result<DomainOutcome, AppError> {
    if input.chapter_id.is_some() || input.target_id != input.novel_id {
        return Ok(DomainOutcome::Conflict(
            "CONTEXT_COMPRESSION_NOVEL_TARGET_REQUIRED",
        ));
    }
    let target_hint = connection
        .query_row(
            "SELECT target_hint_json FROM ai_tasks WHERE task_id=?1",
            params![bundle.artifact.task_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(AppError::database)?
        .flatten()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    if target_hint
        .as_ref()
        .and_then(|value| value.get("derivationType"))
        .and_then(Value::as_str)
        != Some(CONTEXT_COMPRESSION_DERIVATION_TYPE)
    {
        return Ok(DomainOutcome::Conflict(
            "CONTEXT_COMPRESSION_DERIVATION_MISMATCH",
        ));
    }
    let Some(value) = bundle.structured_payload_json.as_ref() else {
        return Ok(DomainOutcome::Conflict(
            "CONTEXT_COMPRESSION_PAYLOAD_INVALID",
        ));
    };
    let source = context_compression_source(connection, &input.novel_id)?;
    let candidate = match parse_context_compression_candidate(value, input, &source) {
        Ok(candidate) => candidate,
        Err(code) => return Ok(DomainOutcome::Conflict(code)),
    };

    connection
        .execute(
            "UPDATE context_records
             SET is_active=0, updated_at=?1
             WHERE novel_id=?2 AND is_active=1
               AND substr(title,1,length(?3))=?3",
            params![
                input.created_at,
                input.novel_id,
                CONTEXT_COMPRESSION_TITLE_PREFIX
            ],
        )
        .map_err(|_| domain_failure("context_compression_deactivate"))?;
    let record_id = uuid::Uuid::new_v4().to_string();
    let title = format!(
        "{} {} {}",
        CONTEXT_COMPRESSION_TITLE_PREFIX,
        CONTEXT_COMPRESSION_PROVIDER_VERSION,
        candidate.source_revision
    );
    context_record_repository::insert_context_record(
        connection,
        &record_id,
        &input.novel_id,
        None,
        None,
        "plot_progress",
        &title,
        &candidate.compressed_text,
        5,
        true,
        Some(&candidate.source_revision),
        None,
        &input.created_at,
    )
    .map_err(|_| domain_failure("context_compression_insert"))?;
    Ok(DomainOutcome::Applied)
}

fn apply_domain(
    connection: &Connection,
    input: &ApplyStructuredArtifactInput,
    bundle: &artifact_service::ResultArtifactBundle,
) -> Result<DomainOutcome, AppError> {
    match bundle.artifact.artifact_type.as_str() {
        "outline" => apply_outline(connection, input, bundle),
        "character_candidates" => apply_characters(connection, input, bundle),
        "event_candidates" => apply_events(connection, input, bundle),
        "setting_candidates" => apply_settings(connection, input, bundle),
        "chapter_summary" => apply_summary(connection, input, bundle),
        "generic_json" => apply_context_compression(connection, input, bundle),
        _ => Ok(DomainOutcome::Conflict(
            "STRUCTURED_ARTIFACT_TYPE_UNSUPPORTED",
        )),
    }
}

pub fn apply_structured_artifact(
    connection: &mut Connection,
    input: ApplyStructuredArtifactInput,
) -> Result<crate::repositories::conversation_repository::ArtifactDecisionRecord, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let bundle = validate_static_scope(&transaction, &input)?;
    if let Some(existing) = existing_decision(&transaction, &input)? {
        validate_existing_identity(&existing, &input)?;
        crate::repositories::conversation_repository::reconcile_conversation_status(
            &transaction,
            &existing.conversation_id,
            if existing.conflict_code.is_some() {
                "failed"
            } else {
                "completed"
            },
            &existing.created_at,
        )?;
        transaction.commit().map_err(AppError::database)?;
        return Ok(existing);
    }

    let base_conflict = validate_dynamic_base(&transaction, &input, &bundle)?;
    let outcome = if let Some(conflict) = base_conflict {
        DomainOutcome::Conflict(conflict)
    } else {
        apply_domain(&transaction, &input, &bundle)?
    };
    let (apply_transaction_id, conflict_code) = match outcome {
        DomainOutcome::Applied => (Some(format!("apply-{}", uuid::Uuid::new_v4())), None),
        DomainOutcome::Conflict(code) => (None, Some(code)),
    };
    let decision = insert_decision(
        &transaction,
        &input,
        apply_transaction_id.as_deref(),
        conflict_code,
    )?;
    crate::repositories::conversation_repository::reconcile_conversation_status(
        &transaction,
        &input.conversation_id,
        if conflict_code.is_some() {
            "failed"
        } else {
            "completed"
        },
        &input.created_at,
    )?;
    transaction.commit().map_err(AppError::database)?;
    Ok(decision)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repositories::large_text_repository;
    use crate::services::{ai_task_service, artifact_service, conversation_service};
    use serde_json::json;

    const NOVEL_ID: &str = "00000000-0000-4000-8000-000000000001";
    const CHAPTER_ID: &str = "00000000-0000-4000-8000-000000000002";
    const DRAFT_ID: &str = "00000000-0000-4000-8000-000000000003";
    const SUMMARY_CHARACTER_ID: &str = "00000000-0000-4000-8000-000000000010";
    const NOW: &str = "2026-08-28T00:00:00Z";
    const CHAPTER_REVISION: &str = "2026-08-28T00:00:00Z";
    const DRAFT_CONTENT: &str = "第一章采用稿正文";

    fn empty_connection() -> Connection {
        let mut connection = Connection::open_in_memory().expect("connection");
        connection
            .execute_batch("PRAGMA foreign_keys=ON;")
            .expect("foreign keys");
        crate::db::create_tables(&mut connection).expect("schema");
        connection
            .execute(
                "INSERT INTO novels (id,title,outline,created_at,updated_at)
                 VALUES (?1,'原子应用测试','',?2,?2)",
                params![NOVEL_ID, NOW],
            )
            .expect("novel");
        connection
    }

    fn connection() -> Connection {
        let connection = empty_connection();
        connection
            .execute(
                "INSERT INTO chapters
                 (id,novel_id,title,order_index,status,adopted_draft_id,word_count,created_at,updated_at)
                 VALUES (?1,?2,'第一章',1,'adopted',?3,8,?4,?5)",
                params![CHAPTER_ID, NOVEL_ID, DRAFT_ID, NOW, CHAPTER_REVISION],
            )
            .expect("chapter");
        connection
            .execute(
                "INSERT INTO chapter_drafts
                 (id,novel_id,chapter_id,title,content,source,version_no,word_count,is_adopted,
                  created_at,updated_at,content_hash)
                 VALUES (?1,?2,?3,'第一章',?4,'ai',3,8,1,?5,?5,?6)",
                params![
                    DRAFT_ID,
                    NOVEL_ID,
                    CHAPTER_ID,
                    DRAFT_CONTENT,
                    NOW,
                    large_text_repository::sha256(DRAFT_CONTENT),
                ],
            )
            .expect("draft");
        connection
    }

    #[test]
    fn character_candidate_parser_rejects_silent_downgrades_and_ambiguous_names() {
        assert_eq!(
            parse_characters(&json!({
                "characters": [
                    {"name":"沈砚"},
                    {"name":"沈砚","roleType":"protagonist"}
                ]
            }))
            .err(),
            Some("DUPLICATE_CANDIDATE")
        );
        assert_eq!(
            parse_characters(&json!({
                "characters": [{"name":"沈砚","roleType":"Protagonist"}]
            }))
            .err(),
            Some("STRUCTURED_PAYLOAD_INVALID")
        );
        assert_eq!(
            parse_characters(&json!({
                "characters": vec![json!({"name":"配角"}); MAX_ITEMS + 1]
            }))
            .err(),
            Some("TOO_MANY_CANDIDATES")
        );

        let protagonist = parse_characters(&json!({
            "characters": [{
                "name":"沈砚",
                "roleType":"protagonist",
                "motivation":"找回被删除的故乡",
                "specialAbility":"读取受损航图的残留记忆",
                "abilityLimits":"每次只能读取一页",
                "behaviorLimits":"不会拿无辜者试验能力",
                "background":"旧港档案馆幸存者",
                "arc":"从独自追查到信任同伴"
            }]
        }))
        .expect("formal protagonist fields");
        assert_eq!(
            protagonist[0].special_ability.as_deref(),
            Some("读取受损航图的残留记忆")
        );
        assert_eq!(
            protagonist[0].ability_limits.as_deref(),
            Some("每次只能读取一页")
        );
        assert_eq!(
            protagonist[0].behavior_limits.as_deref(),
            Some("不会拿无辜者试验能力")
        );
        assert_eq!(
            protagonist[0].background.as_deref(),
            Some("旧港档案馆幸存者")
        );
        assert_eq!(protagonist[0].arc.as_deref(), Some("从独自追查到信任同伴"));
    }

    #[test]
    fn setting_candidate_parser_keeps_same_name_world_and_rule_as_distinct_assets() {
        let candidates = parse_settings(&json!({
            "settings": [
                {"name":"雾城法则","description":"城市每夜删除一段记录"},
                {
                    "name":"雾城法则",
                    "targetType":"rule_system",
                    "description":"已删除记录不得直接恢复"
                }
            ]
        }))
        .expect("world and rule namespaces must remain distinct");
        assert_eq!(candidates.len(), 2);
        assert!(candidates
            .iter()
            .any(|candidate| candidate.target == SettingTarget::World));
        assert!(candidates
            .iter()
            .any(|candidate| candidate.target == SettingTarget::Rule));

        assert_eq!(
            parse_settings(&json!({
                "settings": vec![json!({"name":"设定"}); MAX_ITEMS + 1]
            }))
            .err(),
            Some("TOO_MANY_CANDIDATES")
        );
    }

    fn story_plan_payload() -> Value {
        json!({
            "planKind":"story_plan",
            "title":"作品总纲",
            "content":"档案修复师沈砚追查城市删除记忆的真相，并阻止下一次全城清洗。",
            "targetWordCount":12_300,
            "volumes":[
                {
                    "title":"第一卷 缺页",
                    "summary":"沈砚发现被系统抹除的档案。",
                    "goal":"确认记忆删除确实存在",
                    "mainConflict":"个人记忆与城市秩序冲突",
                    "outline":"沈砚从异常档案进入调查，并取得第一份不可篡改的证据。",
                    "chapters":[
                        {
                            "title":"第一章 空白索引",
                            "outline":"沈砚修复档案时发现一页指向不存在的居民。",
                            "goal":"发现异常",
                            "targetWordCount":4_100
                        },
                        {
                            "title":"第二章 被删去的人",
                            "outline":"沈砚沿索引寻找居民，却发现所有人都不记得对方。",
                            "goal":"取得人证",
                            "targetWordCount":4_100
                        }
                    ]
                },
                {
                    "title":"第二卷 回声",
                    "summary":"沈砚进入记忆清洗系统。",
                    "goal":"保存城市真实记忆",
                    "mainConflict":"公开真相会造成秩序崩溃",
                    "outline":"沈砚必须在真相与城市稳定之间作出选择。",
                    "chapters":[
                        {
                            "title":"第三章 城市备份",
                            "outline":"沈砚找到最后一份城市记忆备份并公开真相。",
                            "goal":"完成主线闭环",
                            "targetWordCount":4_100
                        }
                    ]
                }
            ]
        })
    }

    fn create_conversation(connection: &mut Connection, suffix: &str) -> String {
        let id = format!("conversation-{suffix}");
        conversation_service::create(
            connection,
            conversation_service::CreateConversationInput {
                conversation_id: id.clone(),
                novel_id: NOVEL_ID.to_string(),
                title: format!("候选 {suffix}"),
                default_model: None,
                created_at: NOW.to_string(),
            },
        )
        .expect("conversation");
        id
    }

    fn publish_simple(
        connection: &mut Connection,
        suffix: &str,
        artifact_type: &str,
        chapter_id: Option<&str>,
        payload: Value,
    ) -> (
        conversation_service::ConversationArtifactCardRecord,
        artifact_service::ResultArtifactBundle,
    ) {
        let conversation_id = create_conversation(connection, suffix);
        publish_simple_in_conversation(
            connection,
            conversation_id,
            artifact_type,
            chapter_id,
            payload,
        )
    }

    fn publish_simple_in_conversation(
        connection: &mut Connection,
        conversation_id: String,
        artifact_type: &str,
        chapter_id: Option<&str>,
        payload: Value,
    ) -> (
        conversation_service::ConversationArtifactCardRecord,
        artifact_service::ResultArtifactBundle,
    ) {
        let card = conversation_service::publish_structured_candidate(
            connection,
            conversation_service::PublishStructuredCandidateInput {
                conversation_id,
                novel_id: NOVEL_ID.to_string(),
                chapter_id: chapter_id.map(str::to_string),
                artifact_type: artifact_type.to_string(),
                derivation_type: None,
                title: format!("{artifact_type} candidate"),
                summary: "结构化候选".to_string(),
                structured_payload_json: payload,
                created_at: NOW.to_string(),
            },
        )
        .expect("publish candidate");
        let bundle = artifact_service::get_artifact_bundle(
            connection,
            card.artifact_id.as_deref().expect("artifact id"),
        )
        .expect("artifact bundle");
        (card, bundle)
    }

    fn word_goal_story_plan(root_target: i64, chapter_targets: &[i64]) -> Value {
        let chapters = chapter_targets
            .iter()
            .enumerate()
            .map(|(index, target)| {
                json!({
                    "title": format!("第{}章", index + 1),
                    "outline": format!("推进悬疑主线的第{}个关键节点。", index + 1),
                    "goal": "推进并验证一个关键线索",
                    "targetWordCount": target,
                })
            })
            .collect::<Vec<_>>();
        json!({
            "planKind":"story_plan",
            "title":"六万字悬疑故事总纲",
            "content":"调查者逐层追查旧案，在最终章完成真相与人物命运的闭环。",
            "targetWordCount":root_target,
            "volumes":[{
                "title":"第一卷 旧案",
                "summary":"从异常线索进入旧案核心。",
                "goal":"查明旧案真相",
                "mainConflict":"公开真相与保护相关人的冲突",
                "outline":"逐章发现、验证并串联证据，最终完成真相闭环。",
                "chapters":chapters,
            }]
        })
    }

    fn publish_story_plan_with_word_goal(
        connection: &mut Connection,
        suffix: &str,
        user_goal: &str,
        payload: Value,
    ) -> (
        conversation_service::ConversationArtifactCardRecord,
        artifact_service::ResultArtifactBundle,
    ) {
        let conversation_id = create_conversation(connection, suffix);
        connection
            .execute(
                "INSERT INTO conversation_turns
                 (turn_id,conversation_id,sequence,role,content,created_at)
                 VALUES (?1,?2,0,'user',?3,?4)",
                params![format!("turn-{suffix}"), conversation_id, user_goal, NOW],
            )
            .expect("word goal user turn");
        publish_simple_in_conversation(connection, conversation_id, "outline", None, payload)
    }

    fn publish_draft_based(
        connection: &mut Connection,
        suffix: &str,
        artifact_type: &str,
        payload: Value,
    ) -> (
        conversation_service::ConversationArtifactCardRecord,
        artifact_service::ResultArtifactBundle,
    ) {
        let conversation_id = create_conversation(connection, suffix);
        let raw = serde_json::to_string(&payload).expect("payload json");
        let mut task_input =
            ai_task_service::tests::system_task_input(&format!("apply-{suffix}"), artifact_type);
        task_input.task_type = "context_summarize".to_string();
        task_input.novel_id = NOVEL_ID.to_string();
        task_input.chapter_id = Some(CHAPTER_ID.to_string());
        task_input.draft_id = Some(DRAFT_ID.to_string());
        task_input.scope_type = "draft".to_string();
        task_input.target_hint_json = Some(json!({
            "conversationId": conversation_id,
            "candidateOnly": true,
            "baseChapterRevision": CHAPTER_REVISION,
        }));
        task_input.input_snapshot.input_type = "workbench_apply_test".to_string();
        task_input.input_snapshot.payload_json = json!({"conversationId": conversation_id});
        task_input.input_snapshot.body = raw.clone();
        task_input.input_snapshot.source_draft_id = Some(DRAFT_ID.to_string());
        task_input.input_snapshot.source_draft_version = Some(3);
        task_input.input_snapshot.base_content_hash =
            Some(large_text_repository::sha256(DRAFT_CONTENT));
        let task = ai_task_service::create_task(connection, task_input).expect("task");
        let queued = ai_task_service::queue_attempt(connection, &task.task_id).expect("queue");
        let claimed = ai_task_service::claim_attempt(
            connection,
            ai_task_service::ClaimAiTaskAttemptInput {
                task_id: task.task_id.clone(),
                attempt_id: queued.attempt.attempt_id,
                provider_id: "mock".to_string(),
                model_id: "mock-v1".to_string(),
                provider_request_id: Some(format!("request-{suffix}")),
            },
        )
        .expect("claim");
        ai_task_service::mark_provider_succeeded(
            connection,
            &task.task_id,
            &claimed.attempt.attempt_id,
            json!({
                "provider": "mock",
                "model": "mock-v1",
                "providerRequestId": format!("request-{suffix}"),
                "responseHash": large_text_repository::sha256(&raw),
                "responseLength": raw.chars().count(),
                "tokenInput": 1,
                "tokenOutput": 1,
                "tokenTotal": 2,
                "finishReason": "stop",
                "durationMs": 1,
            }),
        )
        .expect("provider success");
        let bundle = artifact_service::create_artifact(
            connection,
            artifact_service::CreateResultArtifactInput {
                task_id: task.task_id,
                attempt_id: claimed.attempt.attempt_id,
                artifact_type: artifact_type.to_string(),
                schema_version: 1,
                raw_content: raw,
                display_content: Some("结构化候选".to_string()),
                structured_payload_json: Some(payload),
                parent_artifact_id: None,
                derivation_type: None,
            },
        )
        .expect("artifact");
        let card = conversation_service::create_artifact_card(
            connection,
            conversation_service::CreateArtifactCardInput {
                card_id: format!("card-{suffix}"),
                conversation_id,
                turn_id: None,
                run_id: None,
                artifact_id: Some(bundle.artifact.artifact_id.clone()),
                artifact_type: artifact_type.to_string(),
                title: format!("{artifact_type} candidate"),
                summary: "结构化候选".to_string(),
                content: None,
                status: "candidate".to_string(),
                created_at: NOW.to_string(),
            },
        )
        .expect("card");
        (card, bundle)
    }

    fn apply_input(
        card: &conversation_service::ConversationArtifactCardRecord,
        bundle: &artifact_service::ResultArtifactBundle,
    ) -> ApplyStructuredArtifactInput {
        let artifact = &bundle.artifact;
        let chapter_target = matches!(
            artifact.artifact_type.as_str(),
            "event_candidates" | "chapter_summary"
        ) || (artifact.artifact_type == "outline"
            && artifact.source_chapter_id.is_some());
        ApplyStructuredArtifactInput {
            decision_id: format!("decision-{}", card.card_id),
            artifact_id: artifact.artifact_id.clone(),
            artifact_hash: artifact.content_hash.clone(),
            card_id: card.card_id.clone(),
            conversation_id: card.conversation_id.clone(),
            idempotency_key: format!("{}:request_apply:atomic-v1", card.card_id),
            actor: "user".to_string(),
            target_type: "asset".to_string(),
            target_id: if chapter_target {
                artifact.source_chapter_id.clone().expect("chapter target")
            } else {
                NOVEL_ID.to_string()
            },
            novel_id: NOVEL_ID.to_string(),
            chapter_id: artifact.source_chapter_id.clone(),
            base_revision: artifact.source_base_content_hash.clone(),
            created_at: NOW.to_string(),
        }
    }

    fn count(connection: &Connection, table: &str) -> i64 {
        connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("row count")
    }

    fn context_compression_payload(connection: &Connection) -> Value {
        let source = context_compression_source(connection, NOVEL_ID).expect("compression source");
        let mut required_text = Vec::new();
        required_text.extend(source.character_names.iter().cloned());
        required_text.extend(source.chapter_titles.iter().cloned());
        required_text.extend(source.foreshadow_titles.iter().cloned());
        required_text.extend(source.timeline_titles.iter().cloned());
        required_text.extend(source.world_titles.iter().cloned());
        required_text.extend(source.rule_titles.iter().cloned());
        required_text.extend(source.outline_titles.iter().cloned());
        required_text.extend(source.style_names.iter().cloned());
        required_text.extend(source.output_names.iter().cloned());
        let compressed_text = if required_text.is_empty() {
            "原子应用测试作品上下文".to_string()
        } else {
            format!("原子应用测试作品上下文\n{}", required_text.join("\n"))
        };
        let bucket = |required: &[String]| {
            json!({
                "required": required,
                "present": required,
                "missing": [],
            })
        };
        json!({
            "providerId": CONTEXT_COMPRESSION_PROVIDER_ID,
            "version": CONTEXT_COMPRESSION_PROVIDER_VERSION,
            "config": { "tokenBudget": 4_000 },
            "novelId": NOVEL_ID,
            "sourceRevision": source.revision,
            "compressedText": compressed_text,
            "coverage": {
                "characters": bucket(&source.character_names),
                "plot": bucket(&source.chapter_titles),
                "foreshadow": bucket(&source.foreshadow_titles),
                "timeline": bucket(&source.timeline_titles),
                "world": bucket(&source.world_titles),
                "rules": bucket(&source.rule_titles),
                "outlines": bucket(&source.outline_titles),
                "style": bucket(&source.style_names),
                "output": bucket(&source.output_names),
                "tokens": {
                    "budget": 4_000,
                    "used": compressed_text.chars().count(),
                    "withinBudget": true,
                },
            },
            "valid": true,
        })
    }

    fn publish_context_compression(
        connection: &mut Connection,
        suffix: &str,
        payload: Value,
    ) -> (
        conversation_service::ConversationArtifactCardRecord,
        artifact_service::ResultArtifactBundle,
    ) {
        let conversation_id = create_conversation(connection, suffix);
        let card = conversation_service::publish_structured_candidate(
            connection,
            conversation_service::PublishStructuredCandidateInput {
                conversation_id,
                novel_id: NOVEL_ID.to_string(),
                chapter_id: None,
                artifact_type: "generic_json".to_string(),
                derivation_type: Some(CONTEXT_COMPRESSION_DERIVATION_TYPE.to_string()),
                title: CONTEXT_COMPRESSION_TITLE_PREFIX.to_string(),
                summary: "覆盖率通过".to_string(),
                structured_payload_json: payload,
                created_at: NOW.to_string(),
            },
        )
        .expect("publish context compression");
        let bundle = artifact_service::get_artifact_bundle(
            connection,
            card.artifact_id.as_deref().expect("artifact id"),
        )
        .expect("context compression artifact");
        (card, bundle)
    }

    #[test]
    fn context_compression_publish_and_apply_are_atomic_and_versioned() {
        let mut connection = empty_connection();
        context_record_repository::insert_context_record(
            &connection,
            "00000000-0000-4000-8000-000000000099",
            NOVEL_ID,
            None,
            None,
            "plot_progress",
            "小说上下文压缩 1.0.0 rev-old",
            "旧压缩上下文",
            5,
            true,
            Some("rev-old"),
            None,
            NOW,
        )
        .expect("old compression record");
        let payload = context_compression_payload(&connection);
        let (card, bundle) =
            publish_context_compression(&mut connection, "context-compression", payload.clone());
        assert_eq!(bundle.artifact.artifact_type, "generic_json");
        assert!(bundle.artifact.derivation_type.is_none());

        let decision = apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect("apply context compression");
        assert!(decision.apply_transaction_id.is_some());
        assert!(decision.conflict_code.is_none());
        let records =
            context_record_repository::find_context_records_by_novel(&connection, NOVEL_ID)
                .expect("context records");
        let compressed = records
            .iter()
            .filter(|record| record.title.starts_with(CONTEXT_COMPRESSION_TITLE_PREFIX))
            .collect::<Vec<_>>();
        assert_eq!(compressed.len(), 2);
        assert_eq!(
            compressed.iter().filter(|record| record.is_active).count(),
            1
        );
        let active = compressed
            .iter()
            .find(|record| record.is_active)
            .expect("new active compression");
        assert_eq!(
            active.content_hash.as_deref(),
            payload.get("sourceRevision").and_then(Value::as_str)
        );
        assert_eq!(
            active.content,
            payload
                .get("compressedText")
                .and_then(Value::as_str)
                .expect("compressed text")
        );
        assert_eq!(count(&connection, "artifact_decisions"), 1);
    }

    #[test]
    fn context_compression_rejects_scope_validity_and_stale_revision_without_domain_writes() {
        let cases = [
            ("scope", "CONTEXT_COMPRESSION_SCOPE_MISMATCH"),
            ("validity", "CONTEXT_COMPRESSION_VALIDATION_FAILED"),
            ("revision", "CONTEXT_COMPRESSION_SOURCE_REVISION_CONFLICT"),
        ];
        for (case, expected_conflict) in cases {
            let mut connection = empty_connection();
            let mut payload = context_compression_payload(&connection);
            if case == "scope" {
                payload["novelId"] = json!("00000000-0000-4000-8000-000000000404");
            } else if case == "validity" {
                payload["valid"] = json!(false);
            }
            let (card, bundle) = publish_context_compression(
                &mut connection,
                &format!("context-compression-{case}"),
                payload,
            );
            if case == "revision" {
                connection
                    .execute(
                        "UPDATE novels SET updated_at='2026-08-28T01:00:00Z' WHERE id=?1",
                        params![NOVEL_ID],
                    )
                    .expect("mutate compression source");
            }
            let decision = apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
                .expect("record compression conflict");
            assert_eq!(decision.conflict_code.as_deref(), Some(expected_conflict));
            assert!(decision.apply_transaction_id.is_none());
            assert_eq!(count(&connection, "context_records"), 0);
            assert_eq!(count(&connection, "artifact_decisions"), 1);
        }
    }

    #[test]
    fn context_compression_rolls_back_domain_changes_when_decision_insert_fails() {
        let mut connection = empty_connection();
        context_record_repository::insert_context_record(
            &connection,
            "00000000-0000-4000-8000-000000000098",
            NOVEL_ID,
            None,
            None,
            "plot_progress",
            "小说上下文压缩 1.0.0 rev-old",
            "旧压缩上下文",
            5,
            true,
            Some("rev-old"),
            None,
            NOW,
        )
        .expect("old compression record");
        let payload = context_compression_payload(&connection);
        let (card, bundle) =
            publish_context_compression(&mut connection, "context-compression-rollback", payload);
        connection
            .execute_batch(
                "CREATE TRIGGER fail_context_compression_decision
                 BEFORE INSERT ON artifact_decisions
                 BEGIN SELECT RAISE(ABORT, 'forced decision failure'); END;",
            )
            .expect("failure trigger");

        apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect_err("decision failure must roll back context writes");
        let state: (i64, i64) = connection
            .query_row(
                "SELECT COUNT(*), SUM(is_active) FROM context_records
                 WHERE novel_id=?1 AND substr(title,1,length(?2))=?2",
                params![NOVEL_ID, CONTEXT_COMPRESSION_TITLE_PREFIX],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("compression state after rollback");
        assert_eq!(state, (1, 1));
        assert_eq!(count(&connection, "artifact_decisions"), 0);
    }

    #[test]
    fn applies_story_plan_to_an_empty_project_atomically() {
        let mut connection = empty_connection();
        connection
            .execute(
                "INSERT INTO characters
                 (id,novel_id,name,role_type,source,is_active,is_protagonist,created_at,updated_at)
                 VALUES ('existing-story-protagonist',?1,'沈砚','protagonist','manual',1,1,?2,?2)",
                params![NOVEL_ID, NOW],
            )
            .expect("seed story protagonist");
        let payload = story_plan_payload();
        let (card, bundle) =
            publish_simple(&mut connection, "story-plan", "outline", None, payload);

        let decision = apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect("apply story plan");
        assert!(decision.apply_transaction_id.is_some());
        assert!(decision.conflict_code.is_none());
        assert_eq!(count(&connection, "master_outlines"), 1);
        assert_eq!(count(&connection, "volumes"), 2);
        assert_eq!(count(&connection, "volume_outlines"), 2);
        assert_eq!(count(&connection, "chapters"), 3);
        assert_eq!(count(&connection, "chapter_outlines"), 3);
        assert_eq!(count(&connection, "chapter_characters"), 3);
        assert_eq!(count(&connection, "artifact_decisions"), 1);
        let planned_protagonist_bindings: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM chapter_characters
                 WHERE character_id='existing-story-protagonist'
                   AND role_in_chapter='main' AND must_appear=1",
                [],
                |row| row.get(0),
            )
            .expect("story plan character bindings");
        assert_eq!(planned_protagonist_bindings, 3);
        let complete_chapters: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM chapters
                 WHERE novel_id=?1 AND volume_id IS NOT NULL
                   AND LENGTH(TRIM(title))>0 AND LENGTH(TRIM(outline))>0
                   AND LENGTH(TRIM(goal))>0 AND target_word_count>0",
                params![NOVEL_ID],
                |row| row.get(0),
            )
            .expect("complete chapter fields");
        assert_eq!(complete_chapters, 3);
        let chapter_order: String = connection
            .query_row(
                "SELECT GROUP_CONCAT(title,'|') FROM (
                    SELECT title FROM chapters WHERE novel_id=?1 ORDER BY order_index
                 )",
                params![NOVEL_ID],
                |row| row.get(0),
            )
            .expect("stable chapter order");
        assert_eq!(
            chapter_order,
            "第一章 空白索引|第二章 被删去的人|第三章 城市备份"
        );
        let volume_dtos =
            crate::repositories::volume_repository::find_by_novel_id(&connection, NOVEL_ID)
                .expect("volume DTOs");
        assert_eq!(volume_dtos.len(), 2);
        assert_eq!(volume_dtos[0].title, "第一卷 缺页");
        assert_eq!(volume_dtos[1].title, "第二卷 回声");
        let chapter_dtos =
            crate::repositories::chapter_repository::find_by_novel_id(&connection, NOVEL_ID)
                .expect("chapter DTOs");
        assert_eq!(chapter_dtos.len(), 3);
        assert_eq!(chapter_dtos[0].title, "第一章 空白索引");
        assert_eq!(chapter_dtos[1].title, "第二章 被删去的人");
        assert_eq!(chapter_dtos[2].title, "第三章 城市备份");
        assert!(chapter_dtos.iter().all(|chapter| {
            chapter.volume_id.is_some()
                && chapter
                    .outline
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty())
                && chapter
                    .goal
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty())
                && chapter.target_word_count.is_some_and(|value| value > 0)
        }));

        let master: (String, String, i64, String) = connection
            .query_row(
                "SELECT id,title,is_active,content FROM master_outlines",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("master outline");
        assert_eq!(master.1, "作品总纲");
        assert_eq!(master.2, 1);
        assert!(master.3.contains("阻止下一次全城清洗"));
        let linked_volume_outlines: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM volume_outlines AS outline
                 JOIN volumes AS volume ON volume.id=outline.volume_id
                 WHERE outline.project_id=?1 AND outline.master_outline_id=?2
                   AND outline.is_active=1 AND outline.source_type='workbench_apply'",
                params![NOVEL_ID, master.0],
                |row| row.get(0),
            )
            .expect("linked volume outlines");
        assert_eq!(linked_volume_outlines, 2);
        let linked_chapter_outlines: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM chapter_outlines AS outline
                 JOIN chapters AS chapter ON chapter.id=outline.chapter_id
                 JOIN volume_outlines AS volume_outline
                   ON volume_outline.id=outline.volume_outline_id
                 WHERE outline.project_id=?1 AND outline.is_active=1
                   AND outline.source_type='workbench_apply'",
                params![NOVEL_ID],
                |row| row.get(0),
            )
            .expect("linked chapter outlines");
        assert_eq!(linked_chapter_outlines, 3);

        let novel: (String, i64, Option<String>, Option<String>) = connection
            .query_row(
                "SELECT outline,target_word_count,current_volume_id,current_chapter_id
                 FROM novels WHERE id=?1",
                params![NOVEL_ID],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("updated novel");
        assert_eq!(novel.0, master.3);
        assert_eq!(novel.1, 12_300);
        let first_volume: String = connection
            .query_row(
                "SELECT id FROM volumes WHERE novel_id=?1 ORDER BY order_index LIMIT 1",
                params![NOVEL_ID],
                |row| row.get(0),
            )
            .expect("first volume");
        let first_chapter: (String, i64, String) = connection
            .query_row(
                "SELECT id,target_word_count,status FROM chapters
                 WHERE novel_id=?1 ORDER BY order_index LIMIT 1",
                params![NOVEL_ID],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("first chapter");
        assert_eq!(novel.2.as_deref(), Some(first_volume.as_str()));
        assert_eq!(novel.3.as_deref(), Some(first_chapter.0.as_str()));
        assert_eq!(first_chapter.1, 4_100);
        assert_eq!(first_chapter.2, "outline_ready");
    }

    #[test]
    fn story_plan_binds_later_formal_characters_only_to_chapters_with_name_clues() {
        let mut connection = empty_connection();
        let mut payload = story_plan_payload();
        payload["volumes"][0]["chapters"][0]["characterNames"] = json!(["闻舟"]);
        payload["volumes"][0]["chapters"][1]["outline"] =
            json!("苏弥沿索引寻找居民，却发现所有人都不记得对方。");
        let (plan_card, plan_bundle) = publish_simple(
            &mut connection,
            "story-plan-character-clues",
            "outline",
            None,
            payload,
        );
        apply_structured_artifact(&mut connection, apply_input(&plan_card, &plan_bundle))
            .expect("apply story plan before characters exist");
        assert_eq!(count(&connection, "chapter_characters"), 0);

        let (character_card, character_bundle) = publish_simple(
            &mut connection,
            "characters-after-story-plan",
            "character_candidates",
            None,
            json!({
                "characters":[
                    {"name":"闻舟","roleType":"supporting","goal":"守住旧港"},
                    {"name":"苏弥","roleType":"antagonist","goal":"销毁异常索引"},
                    {"name":"章外人","roleType":"neutral","goal":"保持旁观"}
                ]
            }),
        );
        apply_structured_artifact(
            &mut connection,
            apply_input(&character_card, &character_bundle),
        )
        .expect("apply formal characters after story plan");

        let mut statement = connection
            .prepare(
                "SELECT character.name,chapter.title,relation.must_appear
                   FROM chapter_characters AS relation
                   JOIN characters AS character ON character.id=relation.character_id
                   JOIN chapters AS chapter ON chapter.id=relation.chapter_id
                  WHERE relation.novel_id=?1
               ORDER BY chapter.order_index,character.name",
            )
            .expect("binding query");
        let bindings = statement
            .query_map(params![NOVEL_ID], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .expect("binding rows")
            .collect::<Result<Vec<_>, _>>()
            .expect("bindings");
        assert_eq!(
            bindings,
            vec![
                ("闻舟".to_string(), "第一章 空白索引".to_string(), 0),
                ("苏弥".to_string(), "第二章 被删去的人".to_string(), 0),
            ]
        );
        assert!(bindings.iter().all(|(name, _, _)| name != "章外人"));
    }

    #[test]
    fn story_plan_treats_a_protagonist_role_clue_as_required_direct_appearance() {
        let mut connection = empty_connection();
        connection
            .execute(
                "INSERT INTO characters
                 (id,novel_id,name,role_type,goal,source,is_active,is_protagonist,created_at,updated_at)
                 VALUES ('sparse-protagonist',?1,'林砚','protagonist','查明旧案真相','manual',1,1,?2,?2)",
                params![NOVEL_ID, NOW],
            )
            .expect("seed sparse protagonist");
        let mut payload = story_plan_payload();
        payload["volumes"][0]["chapters"][0]["outline"] =
            json!("主角整理遗物时发现指向旧厂的异常编号。");
        payload["volumes"][0]["chapters"][1]["outline"] = json!("档案馆出现一份被删除的夜班记录。");
        payload["volumes"][1]["chapters"][0]["outline"] = json!("最后一份城市记忆备份被公开。");
        let (card, bundle) = publish_simple(
            &mut connection,
            "story-plan-protagonist-role-clue",
            "outline",
            None,
            payload,
        );

        apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect("apply sparse story plan");

        let bindings = connection
            .prepare(
                "SELECT chapter.title,relation.role_in_chapter,relation.must_appear
                   FROM chapter_characters AS relation
                   JOIN chapters AS chapter ON chapter.id=relation.chapter_id
                  WHERE relation.novel_id=?1 AND relation.character_id='sparse-protagonist'
               ORDER BY chapter.order_index",
            )
            .expect("binding query")
            .query_map(params![NOVEL_ID], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .expect("binding rows")
            .collect::<Result<Vec<_>, _>>()
            .expect("bindings");
        assert_eq!(
            bindings,
            vec![("第一章 空白索引".to_string(), "main".to_string(), 1,)]
        );
    }

    #[test]
    fn story_plan_treats_a_matching_protagonist_goal_as_required_direct_appearance() {
        let mut connection = empty_connection();
        connection
            .execute(
                "INSERT INTO characters
                 (id,novel_id,name,role_type,goal,source,is_active,is_protagonist,created_at,updated_at)
                 VALUES ('goal-protagonist',?1,'林砚','protagonist','查明旧案真相','manual',1,1,?2,?2)",
                params![NOVEL_ID, NOW],
            )
            .expect("seed goal protagonist");
        let mut payload = story_plan_payload();
        payload["volumes"][0]["chapters"][0]["outline"] = json!("遗物中的异常编号指向旧厂。");
        payload["volumes"][0]["chapters"][0]["goal"] = json!("查明旧案真相");
        payload["volumes"][0]["chapters"][1]["outline"] = json!("档案馆出现一份被删除的夜班记录。");
        payload["volumes"][1]["chapters"][0]["outline"] = json!("最后一份城市记忆备份被公开。");
        let (card, bundle) = publish_simple(
            &mut connection,
            "story-plan-protagonist-goal-clue",
            "outline",
            None,
            payload,
        );

        apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect("apply goal-based sparse story plan");

        let binding = connection
            .query_row(
                "SELECT chapter.title,relation.role_in_chapter,relation.must_appear
                   FROM chapter_characters AS relation
                   JOIN chapters AS chapter ON chapter.id=relation.chapter_id
                  WHERE relation.novel_id=?1 AND relation.character_id='goal-protagonist'",
                params![NOVEL_ID],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .expect("goal binding");
        assert_eq!(
            binding,
            ("第一章 空白索引".to_string(), "main".to_string(), 1,)
        );
    }

    #[test]
    fn story_plan_word_goal_accepts_root_and_chapter_sum_inside_frozen_tolerance() {
        let mut connection = empty_connection();
        let payload = word_goal_story_plan(60_000, &[10_000; 6]);
        let (card, bundle) = publish_story_plan_with_word_goal(
            &mut connection,
            "word-goal-valid",
            "写个六万字左右的悬疑故事。",
            payload,
        );

        let decision = apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect("apply word-goal plan");
        assert!(decision.conflict_code.is_none());
        assert!(decision.apply_transaction_id.is_some());
        assert_eq!(count(&connection, "volumes"), 1);
        assert_eq!(count(&connection, "chapters"), 6);
        let hint: String = connection
            .query_row(
                "SELECT target_hint_json FROM ai_tasks WHERE task_id=?1",
                params![bundle.artifact.task_id],
                |row| row.get(0),
            )
            .expect("task hint");
        let hint: Value = serde_json::from_str(&hint).expect("task hint json");
        assert_eq!(hint["bookWordGoal"]["targetWords"], 60_000);
        assert_eq!(hint["bookWordGoal"]["minimumWords"], 54_000);
        assert_eq!(hint["bookWordGoal"]["maximumWords"], 66_000);
    }

    #[test]
    fn story_plan_word_goal_keeps_the_first_real_turn_across_automatic_asset_turns() {
        let mut connection = empty_connection();
        let conversation_id = create_conversation(&mut connection, "word-goal-auto-turns");
        let user_goal = "想写约6万字的都市故事。";
        for (turn_id, sequence, content) in [
            ("turn-real-brief", 0_i64, user_goal.to_string()),
            (
                "turn-auto-world",
                1,
                format!(
                    "生成世界与规则设定候选。创意依据：{user_goal}\n\n[[ANS_WORKBENCH_TURN:v1;origin=workbench_asset_preparation]]"
                ),
            ),
            (
                "turn-auto-plan",
                2,
                format!(
                    "生成全书规划候选。创意依据：{user_goal}\n\n[[ANS_WORKBENCH_TURN:v1;origin=workbench_asset_preparation]]"
                ),
            ),
            ("turn-later-user", 3, "继续写八万字".to_string()),
        ] {
            connection
                .execute(
                    "INSERT INTO conversation_turns
                     (turn_id,conversation_id,sequence,role,content,created_at)
                     VALUES (?1,?2,?3,'user',?4,?5)",
                    params![turn_id, conversation_id, sequence, content, NOW],
                )
                .expect("conversation turn");
        }
        let (card, bundle) = publish_simple_in_conversation(
            &mut connection,
            conversation_id,
            "outline",
            None,
            word_goal_story_plan(60_000, &[10_000; 6]),
        );

        let hint: String = connection
            .query_row(
                "SELECT target_hint_json FROM ai_tasks WHERE task_id=?1",
                params![bundle.artifact.task_id],
                |row| row.get(0),
            )
            .expect("task hint");
        let hint: Value = serde_json::from_str(&hint).expect("task hint json");
        assert_eq!(hint["bookWordGoal"]["sourceTurnId"], "turn-real-brief");
        assert_eq!(hint["bookWordGoal"]["sourceTurnSequence"], 0);
        assert_eq!(
            hint["bookWordGoal"]["sourceContentSha256"],
            large_text_repository::sha256(user_goal)
        );
        assert_eq!(hint["bookWordGoal"]["targetWords"], 60_000);

        let decision = apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect("apply plan frozen from the real user turn");
        assert!(decision.conflict_code.is_none());
        assert!(decision.apply_transaction_id.is_some());
        assert_eq!(count(&connection, "chapters"), 6);
    }

    #[test]
    fn story_plan_word_goal_conflicts_before_domain_writes_for_each_mismatch() {
        for (suffix, payload) in [
            (
                "word-goal-root-low",
                word_goal_story_plan(53_000, &[10_000; 6]),
            ),
            (
                "word-goal-sum-low",
                word_goal_story_plan(60_000, &[8_800, 8_800, 8_800, 8_800, 8_800, 9_000]),
            ),
        ] {
            let mut connection = empty_connection();
            let (card, bundle) = publish_story_plan_with_word_goal(
                &mut connection,
                suffix,
                "写个六万字左右的悬疑故事。",
                payload,
            );
            let decision = apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
                .expect("record word-goal conflict");
            assert_eq!(
                decision.conflict_code.as_deref(),
                Some("STORY_PLAN_WORD_GOAL_CONFLICT"),
                "{suffix}"
            );
            assert!(decision.apply_transaction_id.is_none());
            for table in [
                "master_outlines",
                "volumes",
                "volume_outlines",
                "chapters",
                "chapter_outlines",
            ] {
                assert_eq!(count(&connection, table), 0, "{suffix}: {table}");
            }
        }
    }

    #[test]
    fn story_plan_conflicts_when_any_project_structure_already_exists() {
        let mut connection = connection();
        let (card, bundle) = publish_simple(
            &mut connection,
            "story-plan-existing-structure",
            "outline",
            None,
            story_plan_payload(),
        );

        let decision = apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect("record target conflict");
        assert_eq!(
            decision.conflict_code.as_deref(),
            Some("STORY_PLAN_TARGET_CONFLICT")
        );
        assert!(decision.apply_transaction_id.is_none());
        assert_eq!(count(&connection, "chapters"), 1);
        assert_eq!(count(&connection, "volumes"), 0);
        assert_eq!(count(&connection, "master_outlines"), 0);
        assert_eq!(count(&connection, "volume_outlines"), 0);
        assert_eq!(count(&connection, "chapter_outlines"), 0);
        assert_eq!(count(&connection, "artifact_decisions"), 1);
        let novel_outline: String = connection
            .query_row(
                "SELECT outline FROM novels WHERE id=?1",
                params![NOVEL_ID],
                |row| row.get(0),
            )
            .expect("preserved novel");
        assert!(novel_outline.is_empty());
    }

    #[test]
    fn story_plan_replay_returns_the_original_decision_without_duplicate_structure() {
        let mut connection = empty_connection();
        let (card, bundle) = publish_simple(
            &mut connection,
            "story-plan-replay",
            "outline",
            None,
            story_plan_payload(),
        );
        let input = apply_input(&card, &bundle);
        let applied = apply_structured_artifact(&mut connection, input.clone()).expect("apply");
        let first_ids: (Option<String>, Option<String>) = connection
            .query_row(
                "SELECT current_volume_id,current_chapter_id FROM novels WHERE id=?1",
                params![NOVEL_ID],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("first materialization ids");

        let mut replay = input;
        replay.decision_id = "decision-story-plan-replay-must-not-insert".to_string();
        let replayed = apply_structured_artifact(&mut connection, replay).expect("replay");
        assert_eq!(replayed.decision_id, applied.decision_id);
        assert_eq!(count(&connection, "master_outlines"), 1);
        assert_eq!(count(&connection, "volumes"), 2);
        assert_eq!(count(&connection, "volume_outlines"), 2);
        assert_eq!(count(&connection, "chapters"), 3);
        assert_eq!(count(&connection, "chapter_outlines"), 3);
        assert_eq!(count(&connection, "artifact_decisions"), 1);
        let replayed_ids: (Option<String>, Option<String>) = connection
            .query_row(
                "SELECT current_volume_id,current_chapter_id FROM novels WHERE id=?1",
                params![NOVEL_ID],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("replayed materialization ids");
        assert_eq!(replayed_ids, first_ids);
    }

    #[test]
    fn story_plan_rejects_invalid_and_oversized_payloads_before_domain_writes() {
        let mut connection = empty_connection();
        let invalid = json!({
            "planKind":"story_plan",
            "title":"无章节计划",
            "content":"不应写入",
            "targetWordCount":1_000,
            "volumes":[{
                "title":"空卷",
                "outline":"没有章节",
                "chapters":[]
            }]
        });
        let (card, bundle) = publish_simple(
            &mut connection,
            "story-plan-invalid",
            "outline",
            None,
            invalid,
        );
        let invalid_decision =
            apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
                .expect("record invalid payload");
        assert_eq!(
            invalid_decision.conflict_code.as_deref(),
            Some("STRUCTURED_PAYLOAD_INVALID")
        );

        let mut oversized = story_plan_payload();
        oversized["volumes"][0]["chapters"][0]["title"] =
            Value::String("超".repeat(MAX_NAME_CHARS + 1));
        let (card, bundle) = publish_simple(
            &mut connection,
            "story-plan-oversized",
            "outline",
            None,
            oversized,
        );
        let oversized_decision =
            apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
                .expect("record oversized payload");
        assert_eq!(
            oversized_decision.conflict_code.as_deref(),
            Some("STRUCTURED_PAYLOAD_LIMIT_EXCEEDED")
        );
        assert_eq!(count(&connection, "volumes"), 0);
        assert_eq!(count(&connection, "chapters"), 0);
        assert_eq!(count(&connection, "master_outlines"), 0);
        assert_eq!(count(&connection, "volume_outlines"), 0);
        assert_eq!(count(&connection, "chapter_outlines"), 0);
        assert_eq!(count(&connection, "artifact_decisions"), 2);
    }

    #[test]
    fn story_plan_domain_writes_roll_back_when_decision_insert_fails() {
        let mut connection = empty_connection();
        let (card, bundle) = publish_simple(
            &mut connection,
            "story-plan-rollback",
            "outline",
            None,
            story_plan_payload(),
        );
        connection
            .execute_batch(
                "CREATE TRIGGER fail_story_plan_decision
                 BEFORE INSERT ON artifact_decisions
                 BEGIN SELECT RAISE(ABORT, 'forced story plan decision failure'); END;",
            )
            .expect("failure trigger");

        apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect_err("decision failure must roll back the complete story plan");
        assert_eq!(count(&connection, "volumes"), 0);
        assert_eq!(count(&connection, "chapters"), 0);
        assert_eq!(count(&connection, "master_outlines"), 0);
        assert_eq!(count(&connection, "volume_outlines"), 0);
        assert_eq!(count(&connection, "chapter_outlines"), 0);
        assert_eq!(count(&connection, "artifact_decisions"), 0);
        let novel: (String, Option<i64>, Option<String>, Option<String>) = connection
            .query_row(
                "SELECT outline,target_word_count,current_volume_id,current_chapter_id
                 FROM novels WHERE id=?1",
                params![NOVEL_ID],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("rolled back novel");
        assert!(novel.0.is_empty());
        assert_eq!(novel.1, None);
        assert_eq!(novel.2, None);
        assert_eq!(novel.3, None);
    }

    #[test]
    fn chapter_outline_apply_synchronizes_the_chapter_fact() {
        let mut connection = connection();
        let (card, bundle) = publish_simple(
            &mut connection,
            "chapter-outline-sync",
            "outline",
            Some(CHAPTER_ID),
            json!({"title":"第一章章纲","content":"林夏从旧航图中发现隐藏航线。"}),
        );
        let mut input = apply_input(&card, &bundle);
        input.created_at = "2026-08-28T01:00:00Z".to_string();

        let decision = apply_structured_artifact(&mut connection, input)
            .expect("apply chapter outline atomically");
        assert!(decision.conflict_code.is_none());
        let chapter: (Option<String>, String, String) = connection
            .query_row(
                "SELECT outline,status,updated_at FROM chapters WHERE id=?1",
                params![CHAPTER_ID],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("synchronized chapter fact");
        assert_eq!(
            chapter,
            (
                Some("林夏从旧航图中发现隐藏航线。".to_string()),
                "adopted".to_string(),
                "2026-08-28T01:00:00Z".to_string(),
            )
        );
        let active_outline: (String, i64) = connection
            .query_row(
                "SELECT content,is_active FROM chapter_outlines
                 WHERE project_id=?1 AND chapter_id=?2",
                params![NOVEL_ID, CHAPTER_ID],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("active structured chapter outline");
        assert_eq!(
            active_outline,
            ("林夏从旧航图中发现隐藏航线。".to_string(), 1)
        );
    }

    #[test]
    fn chapter_outline_apply_advances_only_not_started_status() {
        let mut connection = connection();
        connection
            .execute(
                "UPDATE chapters SET status='not_started' WHERE id=?1",
                params![CHAPTER_ID],
            )
            .expect("not-started chapter");
        let (card, bundle) = publish_simple(
            &mut connection,
            "chapter-outline-status",
            "outline",
            Some(CHAPTER_ID),
            json!({"title":"第一章章纲","content":"章纲准备完成。"}),
        );

        apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect("apply outline to not-started chapter");
        let status: String = connection
            .query_row(
                "SELECT status FROM chapters WHERE id=?1",
                params![CHAPTER_ID],
                |row| row.get(0),
            )
            .expect("advanced chapter status");
        assert_eq!(status, "outline_ready");
    }

    #[test]
    fn chapter_outline_apply_rolls_back_when_chapter_sync_misses() {
        let mut connection = connection();
        let (card, bundle) = publish_simple(
            &mut connection,
            "chapter-outline-sync-miss",
            "outline",
            Some(CHAPTER_ID),
            json!({"title":"不应采用的章纲","content":"该章纲必须随事务回滚。"}),
        );
        connection
            .execute_batch(&format!(
                "CREATE TRIGGER ignore_chapter_outline_sync
                 BEFORE UPDATE OF outline ON chapters
                 WHEN OLD.id='{CHAPTER_ID}'
                 BEGIN SELECT RAISE(IGNORE); END;"
            ))
            .expect("chapter update miss trigger");

        let error = apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect_err("zero-row chapter synchronization must fail closed");
        assert_eq!(error.code, "STRUCTURED_APPLY_DOMAIN_WRITE_FAILED");
        assert_eq!(count(&connection, "chapter_outlines"), 0);
        assert_eq!(count(&connection, "artifact_decisions"), 0);
        let outline: Option<String> = connection
            .query_row(
                "SELECT outline FROM chapters WHERE id=?1",
                params![CHAPTER_ID],
                |row| row.get(0),
            )
            .expect("unchanged chapter outline");
        assert!(outline.is_none());
    }

    #[test]
    fn applies_all_supported_structured_types_and_replays_idempotently() {
        let mut connection = connection();
        let fixtures = [
            publish_simple(
                &mut connection,
                "outline",
                "outline",
                None,
                json!({"data":{"title":"第一卷总纲","content":"主角发现被隐藏的航线。"}}),
            ),
            publish_simple(
                &mut connection,
                "characters",
                "character_candidates",
                None,
                json!({"characters":[{"name":"林夏","roleType":"supporting","goal":"查明真相"}]}),
            ),
            publish_simple(
                &mut connection,
                "events",
                "event_candidates",
                Some(CHAPTER_ID),
                json!({"events":[{"title":"发现航线","description":"林夏在旧图中找到航线。"}]}),
            ),
            publish_simple(
                &mut connection,
                "settings",
                "setting_candidates",
                None,
                json!({"settings":[
                    {"name":"潮汐城","category":"location","description":"随引力潮移动的港城。"},
                    {
                        "name":"潮汐航法",
                        "category":"world_rules",
                        "description":"航线必须随双月引力重新计算。",
                        "forbiddenRules":["禁止在退潮钟响后离港"]
                    }
                ]}),
            ),
            publish_draft_based(
                &mut connection,
                "summary",
                "chapter_summary",
                json!({
                    "summary":"林夏发现了被隐藏的航线。",
                    "keyEvents":["发现航线"],
                    "factsMustRemember":["航线只能在双月重合时显现"],
                    "characterChanges":[{
                        "characterName":"林夏",
                        "stateSummary":"掌握了隐藏航线的位置",
                        "knowledgeState":"知道双月重合是开启条件"
                    }],
                    "contextRecords":[{
                        "contextType":"plot_progress",
                        "title":"隐藏航线",
                        "content":"林夏已取得航线坐标。",
                        "importance":5
                    }]
                }),
            ),
        ];

        let mut decisions = Vec::new();
        for (card, bundle) in &fixtures {
            let decision = apply_structured_artifact(&mut connection, apply_input(card, bundle))
                .expect("apply");
            assert!(decision.apply_transaction_id.is_some());
            assert!(decision.conflict_code.is_none());
            decisions.push(decision);
        }

        assert_eq!(count(&connection, "master_outlines"), 1);
        let outline: (String, String) = connection
            .query_row("SELECT title,content FROM master_outlines", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .expect("outline content");
        assert_eq!(outline.0, "第一卷总纲");
        assert_eq!(outline.1, "主角发现被隐藏的航线。");
        assert_eq!(count(&connection, "characters"), 1);
        assert_eq!(count(&connection, "chapter_events"), 1);
        assert_eq!(count(&connection, "world_settings"), 1);
        assert_eq!(count(&connection, "rule_systems"), 1);
        assert_eq!(count(&connection, "chapter_summaries"), 1);
        assert_eq!(count(&connection, "context_records"), 2);
        assert_eq!(count(&connection, "character_states"), 1);
        assert_eq!(count(&connection, "memory_documents"), 2);
        assert_eq!(count(&connection, "memory_chunks"), 2);
        assert_eq!(count(&connection, "artifact_decisions"), 5);
        let rule: (String, String, Option<String>) = connection
            .query_row(
                "SELECT category,content,forbidden_rules FROM rule_systems WHERE novel_id=?1",
                params![NOVEL_ID],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("formal rule system");
        assert_eq!(rule.0, "other");
        assert!(rule.1.contains("双月引力"));
        assert_eq!(rule.2.as_deref(), Some("[\"禁止在退潮钟响后离港\"]"));
        let chapter_status: String = connection
            .query_row(
                "SELECT status FROM chapters WHERE id=?1",
                params![CHAPTER_ID],
                |row| row.get(0),
            )
            .expect("summarized chapter status");
        assert_eq!(chapter_status, "summarized");
        let current_state: Option<String> = connection
            .query_row(
                "SELECT current_state FROM characters WHERE novel_id=?1 AND name='林夏'",
                params![NOVEL_ID],
                |row| row.get(0),
            )
            .expect("character state projection");
        assert_eq!(current_state.as_deref(), Some("掌握了隐藏航线的位置"));
        let memory_source: (String, String) = connection
            .query_row(
                "SELECT source_type,status FROM memory_documents
                  WHERE source_type='chapter_summary'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("summary memory");
        assert_eq!(
            memory_source,
            ("chapter_summary".to_string(), "active".to_string())
        );
        let context_memory: (String, String) = connection
            .query_row(
                "SELECT source_type,status FROM memory_documents
                  WHERE source_type='context_record'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("custom context memory");
        assert_eq!(
            context_memory,
            ("context_record".to_string(), "active".to_string())
        );

        let (card, bundle) = &fixtures[1];
        let mut replay = apply_input(card, bundle);
        replay.decision_id = "decision-replay-must-not-insert".to_string();
        let replayed = apply_structured_artifact(&mut connection, replay).expect("replay");
        assert_eq!(replayed.decision_id, decisions[1].decision_id);
        assert_eq!(count(&connection, "characters"), 1);
        assert_eq!(count(&connection, "artifact_decisions"), 5);
    }

    #[test]
    fn promotes_a_single_protagonist_candidate_to_all_formal_read_sources() {
        let mut connection = connection();
        connection
            .execute(
                "UPDATE novels SET protagonists_json='[{\"name\":\"\"}]' WHERE id=?1",
                params![NOVEL_ID],
            )
            .expect("seed empty UI profile placeholder");
        let (card, bundle) = publish_simple(
            &mut connection,
            "formal-protagonist",
            "character_candidates",
            None,
            json!({
                "characters":[
                    {
                        "name":"沈砚",
                        "roleType":"protagonist",
                        "identity":"失忆的航图修复师",
                        "goal":"找回被抹去的故乡",
                        "personality":"谨慎但不退缩",
                        "gender":"女",
                        "motivation":"证明故乡并非虚构",
                        "ability":"辨认被篡改的航线",
                        "limitation":"只能在退潮时读取航图",
                        "background":"来自已从地图抹去的旧港",
                        "arc":"从独自求证走向与同伴共同守护真相",
                        "notes":"随身携带一页烧焦的故乡航图",
                        "specialAbility":"触摸航图时读取残留记忆",
                        "abilityLimits":"每次读取只能持续十息",
                        "behaviorLimits":"不会拿无辜者试验能力",
                        "forbiddenBehaviors":"不会牺牲无辜者",
                        "currentState":"刚抵达潮汐城"
                    },
                    {"name":"闻舟","roleType":"supporting","goal":"守住港口"}
                ]
            }),
        );

        let decision = apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect("apply protagonist candidate");
        assert!(decision.apply_transaction_id.is_some());
        assert!(decision.conflict_code.is_none());

        let character: (String, i64, Option<String>, Option<String>, Option<String>) = connection
            .query_row(
                "SELECT role_type,is_protagonist,protagonist_key,protagonist_label,source_type
                 FROM characters WHERE novel_id=?1 AND name='沈砚'",
                params![NOVEL_ID],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("formal protagonist character");
        assert_eq!(character.0, "protagonist");
        assert_eq!(character.1, 1);
        assert_eq!(character.2.as_deref(), Some("primary"));
        assert_eq!(character.3.as_deref(), Some("主角"));
        assert_eq!(character.4.as_deref(), Some("workbench_apply"));

        let novel = crate::repositories::novel_repository::find_by_id(&connection, NOVEL_ID)
            .expect("read novel")
            .expect("novel exists");
        assert_eq!(novel.protagonist_mode, "single");
        assert_eq!(novel.main_character, "沈砚");
        assert_eq!(novel.protagonists.len(), 1);
        assert_eq!(novel.protagonists[0].name, "沈砚");
        assert_eq!(novel.protagonists[0].label, "primary");
        assert_eq!(novel.protagonists[0].gender, "女");
        assert_eq!(novel.protagonists[0].motivation, "证明故乡并非虚构");
        assert_eq!(novel.protagonists[0].ability, "辨认被篡改的航线");
        assert_eq!(novel.protagonists[0].limitation, "只能在退潮时读取航图");
        assert_eq!(novel.protagonists[0].background, "来自已从地图抹去的旧港");
        assert_eq!(
            novel.protagonists[0].arc,
            "从独自求证走向与同伴共同守护真相"
        );
        assert_eq!(
            novel.protagonists[0].special_ability.as_deref(),
            Some("触摸航图时读取残留记忆")
        );
        assert_eq!(
            novel.protagonists[0].ability_limits.as_deref(),
            Some("每次读取只能持续十息")
        );

        let legacy = crate::repositories::world_setting_repository::find_protagonist_by_novel(
            &connection,
            NOVEL_ID,
        )
        .expect("read legacy protagonist")
        .expect("legacy protagonist projection");
        assert_eq!(legacy.name, "沈砚");
        assert_eq!(legacy.identity.as_deref(), Some("失忆的航图修复师"));
        assert_eq!(
            legacy.special_ability.as_deref(),
            Some("触摸航图时读取残留记忆")
        );
        assert_eq!(
            legacy.ability_limits.as_deref(),
            Some("每次读取只能持续十息")
        );
        let behavior_limits: Option<String> = connection
            .query_row(
                "SELECT behavior_limits FROM characters WHERE novel_id=?1 AND name='沈砚'",
                params![NOVEL_ID],
                |row| row.get(0),
            )
            .expect("character behavior limits");
        assert_eq!(behavior_limits.as_deref(), Some("不会拿无辜者试验能力"));
        assert_eq!(count(&connection, "characters"), 2);
        assert_eq!(count(&connection, "protagonists"), 1);
        let protagonist_binding_count: i64 = connection
            .query_row(
                "SELECT COUNT(*)
                 FROM chapter_characters AS relation
                 JOIN characters AS character ON character.id=relation.character_id
                 WHERE relation.chapter_id=?1 AND character.name='沈砚'",
                params![CHAPTER_ID],
                |row| row.get(0),
            )
            .expect("protagonist binding count");
        assert_eq!(protagonist_binding_count, 0);
        assert_eq!(count(&connection, "artifact_decisions"), 1);
    }

    #[test]
    fn legacy_behavior_limits_remain_character_constraints_not_protagonist_abilities() {
        let mut connection = connection();
        let (card, bundle) = publish_simple(
            &mut connection,
            "legacy-protagonist-fields",
            "character_candidates",
            None,
            json!({
                "characters":[{
                    "name":"沈砚",
                    "roleType":"protagonist",
                    "identity":"航图修复师",
                    "goal":"找到失落航线",
                    "personality":"谨慎",
                    "behaviorLimits":"不会使用未经验证的航图"
                }]
            }),
        );

        let decision = apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect("apply legacy protagonist candidate");
        assert!(decision.conflict_code.is_none());

        let novel = crate::repositories::novel_repository::find_by_id(&connection, NOVEL_ID)
            .expect("read novel")
            .expect("novel exists");
        assert_eq!(novel.protagonists.len(), 1);
        assert!(novel.protagonists[0].special_ability.is_none());
        assert!(novel.protagonists[0].ability_limits.is_none());
        assert!(novel.protagonists[0].limitation.is_empty());

        let legacy = crate::repositories::world_setting_repository::find_protagonist_by_novel(
            &connection,
            NOVEL_ID,
        )
        .expect("read legacy protagonist")
        .expect("legacy protagonist projection");
        assert!(legacy.special_ability.is_none());
        assert!(legacy.ability_limits.is_none());

        let behavior_limits: Option<String> = connection
            .query_row(
                "SELECT behavior_limits FROM characters WHERE novel_id=?1 AND name='沈砚'",
                params![NOVEL_ID],
                |row| row.get(0),
            )
            .expect("legacy behavior limits");
        assert_eq!(behavior_limits.as_deref(), Some("不会使用未经验证的航图"));
    }

    #[test]
    fn existing_protagonist_conflict_precedes_every_domain_write() {
        let mut connection = connection();
        let existing_profile = json!([{
            "id":"existing-profile",
            "label":"primary",
            "name":"顾临",
            "gender":"",
            "identity":"守塔人",
            "personality":"沉静",
            "goal":"守住灯塔",
            "motivation":"",
            "ability":"",
            "limitation":"",
            "background":"",
            "arc":"",
            "notes":"",
            "specialAbility":null,
            "abilityLimits":null,
            "forbiddenBehaviors":"不离开灯塔"
        }])
        .to_string();
        connection
            .execute(
                "UPDATE novels
                 SET protagonist_mode='single',protagonists_json=?1,main_character='顾临'
                 WHERE id=?2",
                params![existing_profile, NOVEL_ID],
            )
            .expect("seed existing novel protagonist");
        connection
            .execute(
                "INSERT INTO protagonists (id,novel_id,name,created_at,updated_at)
                 VALUES ('existing-protagonist',?1,'顾临',?2,?2)",
                params![NOVEL_ID, NOW],
            )
            .expect("seed existing legacy protagonist");
        connection
            .execute(
                "INSERT INTO characters
                 (id,novel_id,name,role_type,is_protagonist,protagonist_key,is_active,created_at,updated_at)
                 VALUES ('existing-character',?1,'顾临','protagonist',1,'primary',1,?2,?2)",
                params![NOVEL_ID, NOW],
            )
            .expect("seed existing protagonist character");
        let before_json: String = connection
            .query_row(
                "SELECT protagonists_json FROM novels WHERE id=?1",
                params![NOVEL_ID],
                |row| row.get(0),
            )
            .expect("existing protagonist json");
        let (card, bundle) = publish_simple(
            &mut connection,
            "protagonist-conflict",
            "character_candidates",
            None,
            json!({
                "characters":[
                    {"name":"沈砚","roleType":"protagonist","goal":"取代现有主角"},
                    {"name":"闻舟","roleType":"supporting","goal":"不应部分写入"}
                ]
            }),
        );

        let decision = apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect("record protagonist conflict");
        assert_eq!(
            decision.conflict_code.as_deref(),
            Some("PROTAGONIST_ALREADY_EXISTS")
        );
        assert!(decision.apply_transaction_id.is_none());
        assert_eq!(count(&connection, "characters"), 1);
        assert_eq!(count(&connection, "protagonists"), 1);
        let after_json: String = connection
            .query_row(
                "SELECT protagonists_json FROM novels WHERE id=?1",
                params![NOVEL_ID],
                |row| row.get(0),
            )
            .expect("preserved protagonist json");
        assert_eq!(after_json, before_json);
        let existing_name: String = connection
            .query_row(
                "SELECT name FROM protagonists WHERE novel_id=?1",
                params![NOVEL_ID],
                |row| row.get(0),
            )
            .expect("preserved legacy protagonist");
        assert_eq!(existing_name, "顾临");
        assert_eq!(count(&connection, "artifact_decisions"), 1);
    }

    #[test]
    fn records_trusted_base_conflicts_without_domain_writes() {
        let mut connection = connection();
        let (card, bundle) = publish_draft_based(
            &mut connection,
            "drift",
            "event_candidates",
            json!({"events":[{"title":"旧基线事件","description":"不应写入"}]}),
        );
        connection
            .execute(
                "UPDATE chapters SET updated_at='2026-08-28T01:00:00Z' WHERE id=?1",
                params![CHAPTER_ID],
            )
            .expect("drift chapter");
        let decision = apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect("conflict");
        assert_eq!(
            decision.conflict_code.as_deref(),
            Some("STRUCTURED_CHAPTER_BASE_CONFLICT")
        );
        assert!(decision.apply_transaction_id.is_none());
        assert_eq!(count(&connection, "chapter_events"), 0);

        let (card, bundle) = publish_simple(
            &mut connection,
            "forged-base",
            "setting_candidates",
            None,
            json!({"settings":[{"name":"伪造基线设定","description":"不应写入"}]}),
        );
        let mut forged = apply_input(&card, &bundle);
        forged.base_revision = Some("client-forged-revision".to_string());
        let decision = apply_structured_artifact(&mut connection, forged).expect("base conflict");
        assert_eq!(
            decision.conflict_code.as_deref(),
            Some("STRUCTURED_BASE_REVISION_CONFLICT")
        );
        assert_eq!(count(&connection, "world_settings"), 0);
    }

    #[test]
    fn decision_failure_rolls_back_domain_write_and_reports_are_forbidden() {
        let mut connection = connection();
        let (card, bundle) = publish_simple(
            &mut connection,
            "rollback",
            "setting_candidates",
            None,
            json!({"settings":[
                {"name":"回滚设定","description":"不得残留"},
                {
                    "name":"回滚规则",
                    "category":"world_rules",
                    "description":"规则也不得残留",
                    "forbiddenRules":["不得绕过事务"]
                }
            ]}),
        );
        connection
            .execute_batch(
                "CREATE TRIGGER fail_structured_decision
                 BEFORE INSERT ON artifact_decisions
                 BEGIN SELECT RAISE(ABORT, 'forced decision failure'); END;",
            )
            .expect("failure trigger");
        apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect_err("decision failure must roll back");
        assert_eq!(count(&connection, "world_settings"), 0);
        assert_eq!(count(&connection, "rule_systems"), 0);
        assert_eq!(count(&connection, "artifact_decisions"), 0);
        connection
            .execute_batch("DROP TRIGGER fail_structured_decision;")
            .expect("drop trigger");

        let (card, bundle) = publish_simple(
            &mut connection,
            "report",
            "quality_report",
            None,
            json!({"summary":"只读报告"}),
        );
        let error = apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect_err("report apply must fail");
        assert_eq!(error.code, "ARTIFACT_APPLY_FORBIDDEN");
        assert_eq!(count(&connection, "artifact_decisions"), 0);
    }

    #[test]
    fn historical_summary_backfill_preserves_the_latest_chapter_state() {
        let mut connection = connection();
        connection
            .execute_batch(&format!(
                "INSERT INTO volumes
                    (id,novel_id,title,order_index,status,created_at,updated_at)
                 VALUES
                    ('00000000-0000-4000-8000-000000000011','{NOVEL_ID}',
                     '第一卷',-20,'planned','2026-08-20T00:00:00Z','2026-08-20T00:00:00Z'),
                    ('00000000-0000-4000-8000-000000000012','{NOVEL_ID}',
                     '第二卷',-10,'planned','2026-08-20T00:00:00Z','2026-08-20T00:00:00Z');
                 UPDATE chapters
                    SET volume_id='00000000-0000-4000-8000-000000000011', order_index=1
                  WHERE id='{CHAPTER_ID}';
                 INSERT INTO chapters
                    (id,novel_id,volume_id,title,order_index,status,word_count,created_at,updated_at)
                 VALUES
                    ('00000000-0000-4000-8000-000000000013','{NOVEL_ID}',
                     '00000000-0000-4000-8000-000000000012','第三章',1,'summarized',1000,
                     '2026-08-22T00:00:00Z','2026-08-22T00:00:00Z'),
                    ('00000000-0000-4000-8000-000000000015','{NOVEL_ID}',NULL,
                     '未归卷章节',999,'summarized',1000,
                     '2026-08-23T00:00:00Z','2026-08-23T00:00:00Z'),
                    ('00000000-0000-4000-8000-000000000017','{NOVEL_ID}',
                     '00000000-0000-4000-8000-000000000012','已删除章节',999,'summarized',1000,
                     '2026-08-24T00:00:00Z','2026-08-24T00:00:00Z');
                 UPDATE chapters
                    SET deleted_at='2026-08-25T00:00:00Z'
                  WHERE id='00000000-0000-4000-8000-000000000017';
                 INSERT INTO characters
                    (id,novel_id,name,role_type,current_state,is_active,created_at,updated_at)
                 VALUES
                    ('{SUMMARY_CHARACTER_ID}','{NOVEL_ID}','林夏','supporting','第三章后的状态',1,
                     '2026-08-20T00:00:00Z','2026-08-22T00:00:00Z');
                 INSERT INTO character_states
                    (id,novel_id,character_id,chapter_id,state_summary,created_at)
                 VALUES
                    ('00000000-0000-4000-8000-000000000014','{NOVEL_ID}',
                     '{SUMMARY_CHARACTER_ID}','00000000-0000-4000-8000-000000000013',
                     '第三章后的状态','2026-08-22T00:00:00Z'),
                    ('00000000-0000-4000-8000-000000000016','{NOVEL_ID}',
                     '{SUMMARY_CHARACTER_ID}','00000000-0000-4000-8000-000000000015',
                     '未归卷章节状态','2026-08-23T00:00:00Z'),
                    ('00000000-0000-4000-8000-000000000018','{NOVEL_ID}',
                     '{SUMMARY_CHARACTER_ID}','00000000-0000-4000-8000-000000000017',
                     '软删章节状态','2026-08-24T00:00:00Z'),
                    ('00000000-0000-4000-8000-000000000019','{NOVEL_ID}',
                     '{SUMMARY_CHARACTER_ID}',NULL,
                     '无章节状态','2026-08-25T00:00:00Z');"
            ))
            .expect("later formal character state");
        let (card, bundle) = publish_draft_based(
            &mut connection,
            "historical-summary-backfill",
            "chapter_summary",
            json!({
                "summary":"回填第一章总结。",
                "characterChanges":[{
                    "characterName":"林夏",
                    "stateSummary":"第一章后的历史状态"
                }]
            }),
        );

        let decision = apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect("apply historical summary");
        assert!(decision.conflict_code.is_none());
        let current_state: Option<String> = connection
            .query_row(
                "SELECT current_state FROM characters WHERE id=?1",
                params![SUMMARY_CHARACTER_ID],
                |row| row.get(0),
            )
            .expect("chronological current state");
        assert_eq!(current_state.as_deref(), Some("第三章后的状态"));
        let histories =
            crate::repositories::character_state_repository::find_character_states_by_character(
                &connection,
                SUMMARY_CHARACTER_ID,
            )
            .expect("chronological character histories");
        assert_eq!(histories.len(), 4);
        assert_eq!(
            histories[0].chapter_id.as_deref(),
            Some("00000000-0000-4000-8000-000000000013")
        );
        assert_eq!(histories[0].state_summary, "第三章后的状态");
        assert_eq!(histories[1].chapter_id.as_deref(), Some(CHAPTER_ID));
        assert_eq!(
            histories[2].chapter_id.as_deref(),
            Some("00000000-0000-4000-8000-000000000015")
        );
        assert!(histories[3].chapter_id.is_none());
        assert!(histories
            .iter()
            .all(|state| state.state_summary != "软删章节状态"));
    }

    #[test]
    fn summary_decision_failure_rolls_back_context_memory_and_state() {
        let mut connection = connection();
        connection
            .execute(
                "INSERT INTO characters
                 (id,novel_id,name,role_type,is_active,created_at,updated_at)
                 VALUES (?1,?2,'林夏','supporting',1,?3,?3)",
                params![SUMMARY_CHARACTER_ID, NOVEL_ID, NOW],
            )
            .expect("summary character");
        let (card, bundle) = publish_draft_based(
            &mut connection,
            "summary-rollback",
            "chapter_summary",
            json!({
                "summary":"不应残留的章节总结。",
                "factsMustRemember":["不应残留的事实"],
                "characterChanges":[{
                    "characterName":"林夏",
                    "stateSummary":"不应残留的人物状态",
                    "knowledgeState":"不应残留的认知"
                }],
                "contextRecords":[{
                    "contextType":"plot_progress",
                    "title":"不应残留的上下文",
                    "content":"事务失败后必须消失。",
                    "importance":5
                }]
            }),
        );
        connection
            .execute_batch(
                "CREATE TRIGGER fail_summary_decision
                 BEFORE INSERT ON artifact_decisions
                 BEGIN SELECT RAISE(ABORT, 'forced summary decision failure'); END;",
            )
            .expect("summary failure trigger");

        apply_structured_artifact(&mut connection, apply_input(&card, &bundle))
            .expect_err("decision failure must roll back complete summary materialization");
        assert_eq!(count(&connection, "chapter_summaries"), 0);
        assert_eq!(count(&connection, "context_records"), 0);
        assert_eq!(count(&connection, "character_states"), 0);
        assert_eq!(count(&connection, "memory_documents"), 0);
        assert_eq!(count(&connection, "memory_chunks"), 0);
        assert_eq!(count(&connection, "artifact_decisions"), 0);
        let chapter_status: String = connection
            .query_row(
                "SELECT status FROM chapters WHERE id=?1",
                params![CHAPTER_ID],
                |row| row.get(0),
            )
            .expect("rolled back chapter status");
        assert_eq!(chapter_status, "adopted");
        let character_state: Option<String> = connection
            .query_row(
                "SELECT current_state FROM characters WHERE id=?1",
                params![SUMMARY_CHARACTER_ID],
                |row| row.get(0),
            )
            .expect("rolled back character projection");
        assert!(character_state.is_none());
    }
}
