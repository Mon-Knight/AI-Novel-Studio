use super::ProjectBackup;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

// This is deliberately the same key policy used by the WebView preflight.
const POLICY_JSON: &str =
    include_str!("../../src/services/backup/projectBackupLocalStoragePolicy.json");
const ERROR: &str = "项目备份的补充缓存包含不支持的键、无效记录或跨项目作用域。";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Policy {
    collections: Vec<String>,
    chapter_prefixes: Vec<String>,
    raw_chapter_prefix: String,
    job_prefix: String,
    reference_library_key: String,
    owner_keys: Vec<String>,
    chapter_keys: Vec<String>,
    direct_chapter_keys: Vec<String>,
    draft_keys: Vec<String>,
    cross_chapter_draft_keys: Vec<String>,
    volume_keys: Vec<String>,
    job_keys: Vec<String>,
    identity_keys: Vec<String>,
    forbidden_keys: Vec<String>,
}

struct Scope {
    novel_id: String,
    chapters: HashSet<String>,
    volumes: HashSet<String>,
    jobs: HashSet<String>,
    profiles: HashSet<String>,
    drafts: HashMap<String, String>,
}

fn object(value: &Value) -> Result<&Map<String, Value>, String> {
    value.as_object().ok_or_else(|| ERROR.to_string())
}

fn rows(value: &Value) -> Result<&Vec<Value>, String> {
    let rows = value.as_array().ok_or_else(|| ERROR.to_string())?;
    if rows.iter().any(|row| !row.is_object()) {
        return Err(ERROR.to_string());
    }
    Ok(rows)
}

fn strings<'a, K: AsRef<str>>(
    row: &'a Map<String, Value>,
    keys: &[K],
    policy: &Policy,
) -> Result<Vec<&'a str>, String> {
    let mut values = Vec::new();
    for key in keys {
        match row.get(key.as_ref()) {
            None | Some(Value::Null) => {}
            Some(Value::String(value)) if value.is_empty() => {}
            Some(Value::String(value))
                if !value.trim().is_empty() && !policy.forbidden_keys.contains(value) =>
            {
                values.push(value.as_str());
            }
            _ => return Err(ERROR.to_string()),
        }
    }
    Ok(values)
}

fn ids(value: Option<&Value>, policy: &Policy) -> Result<HashSet<String>, String> {
    let mut result = HashSet::new();
    if let Some(value) = value {
        for row in rows(value)? {
            for id in strings(object(row)?, &["id"], policy)? {
                result.insert(id.to_string());
            }
        }
    }
    Ok(result)
}

fn safe_tree(value: &Value, policy: &Policy, depth: usize) -> Result<(), String> {
    if depth > 100 {
        return Err(ERROR.to_string());
    }
    match value {
        Value::Array(values) => {
            for value in values {
                safe_tree(value, policy, depth + 1)?;
            }
        }
        Value::Object(row) => {
            for (key, value) in row {
                if policy.forbidden_keys.contains(key) {
                    return Err(ERROR.to_string());
                }
                if policy.identity_keys.contains(key) {
                    strings(row, &[key], policy)?;
                }
                safe_tree(value, policy, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn check_links<K: AsRef<str>>(
    row: &Map<String, Value>,
    keys: &[K],
    allowed: &HashSet<String>,
    policy: &Policy,
) -> Result<bool, String> {
    let values = strings(row, keys, policy)?;
    if values.iter().any(|value| !allowed.contains(*value)) {
        return Err(ERROR.to_string());
    }
    Ok(!values.is_empty())
}

fn chapter_of<'a>(row: &'a Map<String, Value>, policy: &Policy) -> Result<Option<&'a str>, String> {
    let chapters = strings(row, &policy.direct_chapter_keys, policy)?;
    if chapters.iter().any(|id| Some(id) != chapters.first()) {
        return Err(ERROR.to_string());
    }
    Ok(chapters.first().copied())
}

fn register_draft(
    row: &Map<String, Value>,
    chapter: &str,
    scope: &mut Scope,
    policy: &Policy,
) -> Result<(), String> {
    let draft_ids = strings(row, &["id"], policy)?;
    let id = draft_ids.first().ok_or(ERROR)?;
    if !scope.chapters.contains(chapter)
        || strings(row, &policy.owner_keys, policy)?
            .iter()
            .any(|owner| *owner != scope.novel_id)
        || chapter_of(row, policy)?.is_some_and(|owner| owner != chapter)
        || scope.drafts.get(*id).is_some_and(|owner| owner != chapter)
    {
        return Err(ERROR.to_string());
    }
    scope.drafts.insert(id.to_string(), chapter.to_string());
    Ok(())
}

fn check_tree(
    value: &Value,
    scope: &Scope,
    policy: &Policy,
    inherited_chapter: Option<&str>,
    check_drafts: bool,
) -> Result<(), String> {
    match value {
        Value::Array(values) => {
            for value in values {
                check_tree(value, scope, policy, inherited_chapter, check_drafts)?;
            }
        }
        Value::Object(row) => {
            if strings(row, &policy.owner_keys, policy)?
                .iter()
                .any(|id| *id != scope.novel_id)
            {
                return Err(ERROR.to_string());
            }
            check_links(row, &policy.chapter_keys, &scope.chapters, policy)?;
            check_links(row, &policy.volume_keys, &scope.volumes, policy)?;
            check_links(row, &policy.job_keys, &scope.jobs, policy)?;
            let chapter = chapter_of(row, policy)?.or(inherited_chapter);
            if check_drafts {
                for id in strings(row, &policy.draft_keys, policy)? {
                    let owner = scope.drafts.get(id).ok_or(ERROR)?;
                    if chapter.is_some_and(|chapter| owner != chapter) {
                        return Err(ERROR.to_string());
                    }
                }
                for id in strings(row, &policy.cross_chapter_draft_keys, policy)? {
                    if !scope.drafts.contains_key(id) {
                        return Err(ERROR.to_string());
                    }
                }
            }
            for value in row.values() {
                check_tree(value, scope, policy, chapter, check_drafts)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn check_record(
    value: &Value,
    scope: &Scope,
    policy: &Policy,
    inherited: bool,
    profile: bool,
    check_drafts: bool,
) -> Result<(), String> {
    let row = object(value)?;
    let root = row.get("session").and_then(Value::as_object).unwrap_or(row);
    let owners = strings(root, &policy.owner_keys, policy)?;
    if owners.iter().any(|id| *id != scope.novel_id) {
        return Err(ERROR.to_string());
    }
    let chapter = check_links(root, &policy.chapter_keys, &scope.chapters, policy)?;
    let volume = check_links(root, &policy.volume_keys, &scope.volumes, policy)?;
    let job = check_links(root, &policy.job_keys, &scope.jobs, policy)?;
    let linked_profile = profile
        && strings(root, &["id"], policy)?
            .iter()
            .any(|id| scope.profiles.contains(*id));
    if !inherited && owners.is_empty() && !chapter && !volume && !job && !linked_profile {
        return Err(ERROR.to_string());
    }
    check_tree(
        value,
        scope,
        policy,
        chapter_of(root, policy)?,
        check_drafts,
    )
}

fn check_references(value: &Value, scope: &Scope, policy: &Policy) -> Result<(), String> {
    let state = object(value)?;
    if state.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || !state
            .get("operations")
            .and_then(Value::as_object)
            .is_some_and(Map::is_empty)
    {
        return Err(ERROR.to_string());
    }
    let works = rows(state.get("works").ok_or(ERROR)?)?;
    let imports = rows(state.get("imports").ok_or(ERROR)?)?;
    let sections = rows(state.get("sections").ok_or(ERROR)?)?;
    let work_ids = ids(state.get("works"), policy)?;
    let import_ids = ids(state.get("imports"), policy)?;
    for work in works {
        check_record(work, scope, policy, false, false, true)?;
    }
    for item in imports {
        if !check_links(
            object(item)?,
            &["workId", "reference_work_id"],
            &work_ids,
            policy,
        )? {
            return Err(ERROR.to_string());
        }
        check_record(item, scope, policy, true, false, true)?;
    }
    for section in sections {
        if !check_links(
            object(section)?,
            &["importId", "reference_import_id"],
            &import_ids,
            policy,
        )? {
            return Err(ERROR.to_string());
        }
        check_links(
            object(section)?,
            &["workId", "reference_work_id"],
            &work_ids,
            policy,
        )?;
        check_record(section, scope, policy, true, false, true)?;
    }
    Ok(())
}

pub(super) fn validate(backup: &ProjectBackup) -> Result<(), String> {
    let Some(data) = &backup.local_storage else {
        return Ok(());
    };
    let policy: Policy = serde_json::from_str(POLICY_JSON).map_err(|_| ERROR.to_string())?;
    safe_tree(data, &policy, 0)?;
    let data = object(data)?;
    if data.get("version").and_then(Value::as_u64) != Some(1)
        || data
            .keys()
            .any(|key| !["version", "collections", "entries", "rawEntries"].contains(&key.as_str()))
    {
        return Err(ERROR.to_string());
    }
    let collections = object(data.get("collections").ok_or(ERROR)?)?;
    let entries = object(data.get("entries").ok_or(ERROR)?)?;
    let empty = Map::new();
    let raw_entries = data
        .get("rawEntries")
        .map(object)
        .transpose()?
        .unwrap_or(&empty);
    let novel_id = backup
        .novel
        .get("id")
        .and_then(Value::as_str)
        .ok_or(ERROR)?;
    if novel_id.trim().is_empty() || policy.forbidden_keys.iter().any(|key| key == novel_id) {
        return Err(ERROR.to_string());
    }
    let table_ids = |name: &str| -> HashSet<String> {
        backup
            .tables
            .get(name)
            .into_iter()
            .flatten()
            .filter_map(|row| row.get("id").and_then(Value::as_str).map(str::to_string))
            .collect()
    };
    let mut scope = Scope {
        novel_id: novel_id.to_string(),
        chapters: table_ids("chapters"),
        volumes: table_ids("volumes"),
        jobs: table_ids("generation_jobs"),
        profiles: HashSet::new(),
        drafts: HashMap::new(),
    };
    let entry_chapters = scope.chapters.clone();
    for snapshot in backup
        .tables
        .get("chapter_generation_snapshots")
        .into_iter()
        .flatten()
    {
        for key in [
            "style_profile_id",
            "output_profile_id",
            "styleProfileId",
            "outputProfileId",
        ] {
            if let Some(id) = snapshot.get(key).and_then(Value::as_str) {
                scope.profiles.insert(id.to_string());
            }
        }
    }
    for (key, collection) in collections {
        if !policy.collections.contains(key) {
            return Err(ERROR.to_string());
        }
        rows(collection)?;
    }
    for key in [
        "ai_novel_studio_volumes",
        "ai_novel_studio_chapters",
        "ai_novel_studio_generation_jobs",
    ] {
        if let Some(collection) = collections.get(key) {
            for row in rows(collection)? {
                check_record(row, &scope, &policy, false, false, false)?;
                let row = object(row)?;
                let target = match key {
                    "ai_novel_studio_volumes" => &mut scope.volumes,
                    "ai_novel_studio_chapters" => &mut scope.chapters,
                    _ => &mut scope.jobs,
                };
                for id in strings(row, &["id"], &policy)? {
                    target.insert(id.to_string());
                }
            }
        }
    }
    if let Some(plans) = collections.get("ai_novel_studio_autonomous_story_plans") {
        for plan in rows(plans)? {
            let plan = object(plan)?;
            let owners = strings(plan, &policy.owner_keys, &policy)?;
            if owners.is_empty() || owners.iter().any(|id| *id != novel_id) {
                return Err(ERROR.to_string());
            }
            scope.chapters.extend(ids(plan.get("chapters"), &policy)?);
            scope.volumes.extend(ids(plan.get("volumes"), &policy)?);
        }
    }
    for draft in backup.tables.get("chapter_drafts").into_iter().flatten() {
        let draft = draft
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect::<Map<_, _>>();
        let chapter = chapter_of(&draft, &policy)?.ok_or(ERROR)?;
        register_draft(&draft, chapter, &mut scope, &policy)?;
    }
    for (key, value) in entries {
        let prefix = ["ai_novel_studio_draft_", "ai_novel_studio_drafts_list_"]
            .into_iter()
            .find(|prefix| key.starts_with(*prefix));
        let Some(prefix) = prefix else {
            continue;
        };
        let chapter = &key[prefix.len()..];
        if !entry_chapters.contains(chapter) {
            return Err(ERROR.to_string());
        }
        if prefix == "ai_novel_studio_draft_" {
            register_draft(object(value)?, chapter, &mut scope, &policy)?;
        } else {
            for draft in rows(value)? {
                register_draft(object(draft)?, chapter, &mut scope, &policy)?;
            }
        }
    }
    for (key, collection) in collections {
        for row in rows(collection)? {
            let novel = key == "ai_novel_studio_novels";
            if novel && row.get("id").and_then(Value::as_str) != Some(novel_id) {
                return Err(ERROR.to_string());
            }
            let profile =
                key == "ai_novel_studio_style_profiles" || key == "ai_novel_studio_output_profiles";
            check_record(row, &scope, &policy, novel, profile, true)?;
        }
    }
    for (raw, entries) in [(false, entries), (true, raw_entries)] {
        for (key, value) in entries {
            if !raw && key == &policy.reference_library_key {
                check_references(value, &scope, &policy)?;
                continue;
            }
            let prefix = if raw {
                key.starts_with(&policy.raw_chapter_prefix)
                    .then_some(&policy.raw_chapter_prefix)
            } else {
                policy
                    .chapter_prefixes
                    .iter()
                    .chain(std::iter::once(&policy.job_prefix))
                    .find(|prefix| key.starts_with(prefix.as_str()))
            }
            .ok_or(ERROR)?;
            let id = &key[prefix.len()..];
            let job = prefix == &policy.job_prefix;
            if !(if job { &scope.jobs } else { &entry_chapters }).contains(id) {
                return Err(ERROR.to_string());
            }
            if raw {
                if !value.is_string() {
                    return Err(ERROR.to_string());
                }
            } else {
                let single;
                let entry_rows = if key.starts_with("ai_novel_studio_draft_") {
                    single = vec![value.clone()];
                    &single
                } else {
                    rows(value)?
                };
                for row in entry_rows {
                    let keys = if job {
                        &policy.job_keys
                    } else {
                        &policy.chapter_keys
                    };
                    if strings(object(row)?, keys, &policy)?
                        .iter()
                        .any(|value| *value != id)
                    {
                        return Err(ERROR.to_string());
                    }
                    check_record(row, &scope, &policy, true, false, true)?;
                }
            }
        }
    }
    Ok(())
}
