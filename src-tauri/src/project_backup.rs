use crate::db::get_connection;
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params, params_from_iter, Connection, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::{BTreeMap, HashMap, HashSet};

const BACKUP_TYPE: &str = "ai_novel_studio_project";
const BACKUP_SCHEMA_VERSION: u32 = 3;
const MIN_SUPPORTED_BACKUP_SCHEMA_VERSION: u32 = 2;
const SQLITE_BIND_BATCH_SIZE: usize = 900;

type BackupRow = BTreeMap<String, JsonValue>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBackup {
    #[serde(rename = "type")]
    pub backup_type: String,
    pub schema_version: u32,
    pub exported_at: String,
    pub source_app_version: String,
    pub novel: BackupRow,
    pub tables: BTreeMap<String, Vec<BackupRow>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_storage: Option<JsonValue>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProjectBackupInput {
    pub backup: ProjectBackup,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProjectBackupResult {
    pub novel_id: String,
    pub title: String,
    pub restored_records: BTreeMap<String, usize>,
    pub id_map: BTreeMap<String, String>,
}

#[derive(Clone, Copy)]
struct TableSpec {
    name: &'static str,
    filter: &'static str,
}

const PROJECT_TABLES: &[TableSpec] = &[
    TableSpec {
        name: "world_settings",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "rule_systems",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "protagonists",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "volumes",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "chapters",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "style_profiles",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "output_profiles",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "imported_assets",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "characters",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "ai_task_records",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "chapter_drafts",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "chapter_engineering_states",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "chapter_generation_snapshots",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "generation_jobs",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "generation_step_results",
        filter: "job_id IN (SELECT id FROM generation_jobs WHERE novel_id = ?1)",
    },
    TableSpec {
        name: "character_states",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "chapter_characters",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "chapter_events",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "chapter_summaries",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "context_records",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "quality_check_reports",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "quality_check_items",
        filter: "report_id IN (SELECT id FROM quality_check_reports WHERE novel_id = ?1)",
    },
    TableSpec {
        name: "quality_issue_states",
        filter: "chapter_id IN (SELECT id FROM chapters WHERE novel_id = ?1)",
    },
    TableSpec {
        name: "polish_records",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "quality_fix_runs",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "context_read_logs",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "master_outlines",
        filter: "project_id = ?1",
    },
    TableSpec {
        name: "volume_outlines",
        filter: "project_id = ?1",
    },
    TableSpec {
        name: "chapter_outlines",
        filter: "project_id = ?1",
    },
];

const LARGE_TEXT_DOCUMENTS: &str = "large_text_documents";
const LARGE_TEXT_CHUNKS: &str = "large_text_chunks";

const INSERT_ORDER: &[&str] = &[
    "world_settings",
    "rule_systems",
    "protagonists",
    "volumes",
    "chapters",
    "style_profiles",
    "output_profiles",
    "imported_assets",
    "characters",
    "ai_task_records",
    "chapter_drafts",
    "chapter_engineering_states",
    "chapter_generation_snapshots",
    "generation_jobs",
    "generation_step_results",
    "character_states",
    "chapter_characters",
    "chapter_events",
    "chapter_summaries",
    "context_records",
    "quality_check_reports",
    "quality_check_items",
    "quality_issue_states",
    "polish_records",
    "quality_fix_runs",
    "context_read_logs",
    "master_outlines",
    "volume_outlines",
    "chapter_outlines",
    LARGE_TEXT_DOCUMENTS,
    LARGE_TEXT_CHUNKS,
];

const DELETE_ORDER: &[&str] = &[
    LARGE_TEXT_CHUNKS,
    LARGE_TEXT_DOCUMENTS,
    "chapter_outlines",
    "volume_outlines",
    "master_outlines",
    "context_read_logs",
    "quality_fix_runs",
    "polish_records",
    "quality_check_items",
    "quality_issue_states",
    "quality_check_reports",
    "context_records",
    "chapter_summaries",
    "chapter_events",
    "chapter_characters",
    "character_states",
    "generation_step_results",
    "generation_jobs",
    "chapter_generation_snapshots",
    "chapter_engineering_states",
    "chapter_drafts",
    "ai_task_records",
    "characters",
    "imported_assets",
    "output_profiles",
    "style_profiles",
    "chapters",
    "volumes",
    "protagonists",
    "rule_systems",
    "world_settings",
];

const REFERENCE_COLUMNS: &[&str] = &[
    "id",
    "novel_id",
    "project_id",
    "volume_id",
    "chapter_id",
    "current_volume_id",
    "current_chapter_id",
    "adopted_draft_id",
    "ai_task_id",
    "engineering_state_id",
    "style_profile_id",
    "output_profile_id",
    "job_id",
    "source_asset_id",
    "related_style_profile_id",
    "first_appearance_chapter_id",
    "character_id",
    "draft_id",
    "report_id",
    "source_draft_id",
    "result_draft_id",
    "target_draft_id",
    "before_report_id",
    "after_report_id",
    "master_outline_id",
    "volume_outline_id",
    "large_text_ref_id",
    "document_id",
    "target_id",
    "world_id",
];

// These columns contain structured JSON generated by the application. Their
// values can include project record IDs that are not represented by SQLite
// foreign keys, so they need the same remapping as direct reference columns.
const STRUCTURED_JSON_COLUMNS: &[&str] = &[
    "protagonists_json",
    "dual_protagonist_relation_json",
    "structured_json",
    "parsed_json",
    "raw_config_json",
    "chapter_card_json",
    "scene_plan_json",
    "generation_constraints_json",
    "quality_rules_json",
    "compiled_context_json",
    "sources_json",
    "input_snapshot_json",
    "output_json",
    "result_json",
    "involved_character_ids",
    "key_events",
    "character_changes",
    "relationship_changes",
    "goal_changes",
    "important_character_changes",
    "setting_changes",
    "new_foreshadows",
    "resolved_foreshadows",
    "next_chapter_hints",
    "core_events",
    "new_locations",
    "new_items_or_abilities",
    "foreshadowing",
    "unresolved_questions",
    "facts_must_remember",
    "validation_result",
    "fixed_issue_ids",
    "new_issue_ids",
    "changed_ranges_json",
    "used_context_ids",
    "skipped_context_ids",
    "warnings",
    "context_snapshot",
];

fn sql_value_to_json(value: ValueRef<'_>) -> Result<JsonValue, String> {
    match value {
        ValueRef::Null => Ok(JsonValue::Null),
        ValueRef::Integer(value) => Ok(JsonValue::from(value)),
        ValueRef::Real(value) => serde_json::Number::from_f64(value)
            .map(JsonValue::Number)
            .ok_or_else(|| "备份中发现无法表示的浮点数".to_string()),
        ValueRef::Text(value) => Ok(JsonValue::String(
            std::str::from_utf8(value)
                .map_err(|error| format!("备份中发现无效 UTF-8 文本：{}", error))?
                .to_string(),
        )),
        ValueRef::Blob(_) => Err("当前项目备份不支持二进制数据库字段".to_string()),
    }
}

fn json_to_sql_value(value: &JsonValue) -> Result<SqlValue, String> {
    match value {
        JsonValue::Null => Ok(SqlValue::Null),
        JsonValue::Bool(value) => Ok(SqlValue::Integer(i64::from(*value))),
        JsonValue::Number(value) => {
            if let Some(integer) = value.as_i64() {
                Ok(SqlValue::Integer(integer))
            } else if let Some(float) = value.as_f64() {
                Ok(SqlValue::Real(float))
            } else {
                Err("备份中包含无法写入 SQLite 的数字".to_string())
            }
        }
        JsonValue::String(value) => Ok(SqlValue::Text(value.clone())),
        JsonValue::Array(_) | JsonValue::Object(_) => {
            Err("备份数据库行不能包含嵌套 JSON 值".to_string())
        }
    }
}

fn query_rows(
    conn: &Connection,
    table: &str,
    predicate: &str,
    novel_id: &str,
) -> Result<Vec<BackupRow>, String> {
    let sql = format!("SELECT * FROM {table} WHERE {predicate} ORDER BY rowid");
    let mut statement = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let column_names = statement
        .column_names()
        .iter()
        .map(|name| (*name).to_string())
        .collect::<Vec<_>>();
    let mut result = statement
        .query(params![novel_id])
        .map_err(|error| error.to_string())?;
    let mut rows = Vec::new();

    while let Some(row) = result.next().map_err(|error| error.to_string())? {
        let mut backup_row = BackupRow::new();
        for (index, column_name) in column_names.iter().enumerate() {
            backup_row.insert(
                column_name.clone(),
                sql_value_to_json(row.get_ref(index).map_err(|error| error.to_string())?)?,
            );
        }
        rows.push(backup_row);
    }

    Ok(rows)
}

fn query_single_row(conn: &Connection, table: &str, id: &str) -> Result<BackupRow, String> {
    let rows = query_rows(conn, table, "id = ?1", id)?;
    rows.into_iter()
        .next()
        .ok_or_else(|| "作品不存在，无法创建备份".to_string())
}

fn query_rows_by_ids(
    conn: &Connection,
    table: &str,
    column: &str,
    ids: &[String],
) -> Result<Vec<BackupRow>, String> {
    let mut seen = HashSet::new();
    let unique_ids = ids
        .iter()
        .filter(|id| !id.is_empty())
        .filter(|id| seen.insert((*id).clone()))
        .cloned()
        .collect::<Vec<_>>();
    if unique_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut rows = Vec::new();
    for batch in unique_ids.chunks(SQLITE_BIND_BATCH_SIZE) {
        let placeholders = std::iter::repeat("?")
            .take(batch.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql =
            format!("SELECT * FROM {table} WHERE {column} IN ({placeholders}) ORDER BY rowid");
        let mut statement = conn.prepare(&sql).map_err(|error| error.to_string())?;
        let column_names = statement
            .column_names()
            .iter()
            .map(|name| (*name).to_string())
            .collect::<Vec<_>>();
        let values = batch
            .iter()
            .cloned()
            .map(SqlValue::Text)
            .collect::<Vec<_>>();
        let mut result = statement
            .query(params_from_iter(values))
            .map_err(|error| error.to_string())?;

        while let Some(row) = result.next().map_err(|error| error.to_string())? {
            let mut backup_row = BackupRow::new();
            for (index, column_name) in column_names.iter().enumerate() {
                backup_row.insert(
                    column_name.clone(),
                    sql_value_to_json(row.get_ref(index).map_err(|error| error.to_string())?)?,
                );
            }
            rows.push(backup_row);
        }
    }

    Ok(rows)
}

fn table_names() -> Vec<&'static str> {
    let mut names = PROJECT_TABLES
        .iter()
        .map(|spec| spec.name)
        .collect::<Vec<_>>();
    names.push(LARGE_TEXT_DOCUMENTS);
    names.push(LARGE_TEXT_CHUNKS);
    names
}

fn table_names_for_schema(schema_version: u32) -> Vec<&'static str> {
    table_names()
        .into_iter()
        .filter(|table| schema_version >= 3 || *table != "quality_issue_states")
        .collect()
}

fn clear_machine_paths(row: &mut BackupRow) {
    for column in ["cover_path", "file_path"] {
        if row.contains_key(column) {
            row.insert(column.to_string(), JsonValue::Null);
        }
    }
}

fn collect_row_ids(rows: &[BackupRow], ids: &mut Vec<String>) {
    ids.extend(
        rows.iter()
            .filter_map(|row| row.get("id").and_then(JsonValue::as_str))
            .map(str::to_string),
    );
}

fn collect_large_text_reference_ids(rows: &[BackupRow], ids: &mut Vec<String>) {
    ids.extend(
        rows.iter()
            .filter_map(|row| row.get("large_text_ref_id").and_then(JsonValue::as_str))
            .map(str::to_string),
    );
}

fn deduplicate_rows_by_id(rows: &mut Vec<BackupRow>) {
    let mut seen = HashSet::new();
    rows.retain(|row| {
        row.get("id")
            .and_then(JsonValue::as_str)
            .is_some_and(|id| seen.insert(id.to_string()))
    });
}

pub fn export_project_backup_in_conn(
    conn: &Connection,
    novel_id: &str,
) -> Result<ProjectBackup, String> {
    let mut novel = query_single_row(conn, "novels", novel_id)?;
    clear_machine_paths(&mut novel);
    let mut tables = BTreeMap::new();

    for spec in PROJECT_TABLES {
        let mut rows = query_rows(conn, spec.name, spec.filter, novel_id)?;
        if spec.name == "imported_assets" {
            for row in &mut rows {
                clear_machine_paths(row);
            }
        }
        tables.insert(spec.name.to_string(), rows);
    }

    // Large-text documents have no novel_id. Include documents explicitly
    // linked by a project record and documents whose target is any exported
    // project entity, so every supported target type travels with the backup.
    let mut project_entity_ids = vec![novel_id.to_string()];
    let mut referenced_document_ids = Vec::new();
    for rows in tables.values() {
        collect_row_ids(rows, &mut project_entity_ids);
        collect_large_text_reference_ids(rows, &mut referenced_document_ids);
    }
    let mut documents =
        query_rows_by_ids(conn, LARGE_TEXT_DOCUMENTS, "target_id", &project_entity_ids)?;
    documents.extend(query_rows_by_ids(
        conn,
        LARGE_TEXT_DOCUMENTS,
        "id",
        &referenced_document_ids,
    )?);
    deduplicate_rows_by_id(&mut documents);
    let document_ids = documents
        .iter()
        .filter_map(|row| {
            row.get("id")
                .and_then(JsonValue::as_str)
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    let chunks = query_rows_by_ids(conn, LARGE_TEXT_CHUNKS, "document_id", &document_ids)?;
    tables.insert(LARGE_TEXT_DOCUMENTS.to_string(), documents);
    tables.insert(LARGE_TEXT_CHUNKS.to_string(), chunks);
    let backup = ProjectBackup {
        backup_type: BACKUP_TYPE.to_string(),
        schema_version: BACKUP_SCHEMA_VERSION,
        exported_at: chrono::Utc::now().to_rfc3339(),
        source_app_version: env!("CARGO_PKG_VERSION").to_string(),
        novel,
        tables,
        local_storage: None,
    };
    validate_backup_large_text_integrity(&backup)?;

    Ok(backup)
}

fn table_columns(conn: &Connection, table: &str) -> Result<HashSet<String>, String> {
    let sql = format!("PRAGMA table_info({table})");
    let mut statement = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<HashSet<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(columns)
}

fn validate_row(table: &str, row: &BackupRow, columns: &HashSet<String>) -> Result<(), String> {
    if row.is_empty() {
        return Err(format!("备份中的 {table} 包含空记录"));
    }
    if table != LARGE_TEXT_CHUNKS
        && !row
            .get("id")
            .and_then(JsonValue::as_str)
            .is_some_and(|id| !id.trim().is_empty())
    {
        return Err(format!("备份中的 {table} 记录缺少 id"));
    }
    if table == LARGE_TEXT_CHUNKS
        && (!row
            .get("document_id")
            .and_then(JsonValue::as_str)
            .is_some_and(|id| !id.trim().is_empty())
            || row.get("chunk_index").and_then(JsonValue::as_i64).is_none())
    {
        return Err("备份中的 large_text_chunks 记录无效".to_string());
    }
    for column in row.keys() {
        if !columns.contains(column) {
            return Err(format!(
                "备份中的 {table} 包含当前版本不认识的字段：{column}"
            ));
        }
    }
    Ok(())
}

fn validate_backup(conn: &Connection, backup: &ProjectBackup) -> Result<(), String> {
    if backup.backup_type != BACKUP_TYPE {
        return Err("不是 AI Novel Studio 项目备份文件".to_string());
    }
    if !(MIN_SUPPORTED_BACKUP_SCHEMA_VERSION..=BACKUP_SCHEMA_VERSION)
        .contains(&backup.schema_version)
    {
        return Err(format!(
            "不支持的项目备份版本：{}，当前支持版本 {} 至 {}",
            backup.schema_version, MIN_SUPPORTED_BACKUP_SCHEMA_VERSION, BACKUP_SCHEMA_VERSION
        ));
    }
    if !backup
        .novel
        .get("id")
        .and_then(JsonValue::as_str)
        .is_some_and(|id| !id.trim().is_empty())
        || !backup
            .novel
            .get("title")
            .and_then(JsonValue::as_str)
            .is_some_and(|title| !title.trim().is_empty())
    {
        return Err("备份缺少有效的作品信息".to_string());
    }

    let expected = table_names_for_schema(backup.schema_version)
        .into_iter()
        .collect::<HashSet<_>>();
    for table in backup.tables.keys() {
        if !expected.contains(table.as_str()) {
            return Err(format!("备份包含不受支持的数据表：{table}"));
        }
    }
    for table in &expected {
        if !backup.tables.contains_key(*table) {
            return Err(format!("备份缺少数据表：{table}"));
        }
    }

    let novel_columns = table_columns(conn, "novels")?;
    validate_row("novels", &backup.novel, &novel_columns)?;
    for table in table_names_for_schema(backup.schema_version) {
        let columns = table_columns(conn, table)?;
        let rows = backup
            .tables
            .get(table)
            .ok_or_else(|| format!("备份缺少数据表：{table}"))?;
        for row in rows {
            validate_row(table, row, &columns)?;
        }
    }
    validate_backup_large_text_integrity(backup)?;
    Ok(())
}

fn collect_ids_from_rows(rows: &[BackupRow], ids: &mut HashMap<String, String>) {
    for row in rows {
        if let Some(id) = row.get("id").and_then(JsonValue::as_str) {
            ids.entry(id.to_string())
                .or_insert_with(|| uuid::Uuid::new_v4().to_string());
        }
    }
}

fn build_id_map(backup: &ProjectBackup) -> Result<HashMap<String, String>, String> {
    let mut ids = HashMap::new();
    let novel_id = backup
        .novel
        .get("id")
        .and_then(JsonValue::as_str)
        .ok_or_else(|| "备份缺少作品 ID".to_string())?;
    ids.insert(novel_id.to_string(), uuid::Uuid::new_v4().to_string());
    for rows in backup.tables.values() {
        collect_ids_from_rows(rows, &mut ids);
    }
    Ok(ids)
}

fn remap_json_ids(value: &mut JsonValue, id_map: &HashMap<String, String>) {
    match value {
        JsonValue::String(id) => {
            if let Some(remapped) = id_map.get(id) {
                *id = remapped.clone();
            }
        }
        JsonValue::Array(values) => {
            for value in values {
                remap_json_ids(value, id_map);
            }
        }
        JsonValue::Object(values) => {
            for value in values.values_mut() {
                remap_json_ids(value, id_map);
            }
        }
        JsonValue::Null | JsonValue::Bool(_) | JsonValue::Number(_) => {}
    }
}

fn remap_structured_json(value: &JsonValue, id_map: &HashMap<String, String>) -> JsonValue {
    let Some(text) = value.as_str() else {
        return value.clone();
    };
    let Ok(mut parsed) = serde_json::from_str::<JsonValue>(text) else {
        return value.clone();
    };
    remap_json_ids(&mut parsed, id_map);
    serde_json::to_string(&parsed)
        .map(JsonValue::String)
        .unwrap_or_else(|_| value.clone())
}

fn remap_row(row: &BackupRow, id_map: &HashMap<String, String>) -> BackupRow {
    row.iter()
        .map(|(column, value)| {
            let remapped = if column == "cover_path" || column == "file_path" {
                JsonValue::Null
            } else if REFERENCE_COLUMNS.contains(&column.as_str()) {
                value
                    .as_str()
                    .and_then(|id| id_map.get(id))
                    .map(|id| JsonValue::String(id.clone()))
                    .unwrap_or_else(|| value.clone())
            } else if STRUCTURED_JSON_COLUMNS.contains(&column.as_str()) {
                remap_structured_json(value, id_map)
            } else {
                value.clone()
            };
            (column.clone(), remapped)
        })
        .collect()
}

fn insert_rows(
    tx: &Transaction<'_>,
    table: &str,
    rows: &[BackupRow],
    id_map: &HashMap<String, String>,
) -> Result<usize, String> {
    let mut inserted = 0;
    for row in rows {
        let row = remap_row(row, id_map);
        let columns = row.keys().cloned().collect::<Vec<_>>();
        let placeholders = std::iter::repeat("?")
            .take(columns.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "INSERT INTO {table} ({}) VALUES ({placeholders})",
            columns.join(", ")
        );
        let values = columns
            .iter()
            .map(|column| {
                row.get(column)
                    .ok_or_else(|| format!("备份中的 {table} 记录缺少字段 {column}"))
                    .and_then(json_to_sql_value)
            })
            .collect::<Result<Vec<_>, _>>()?;
        tx.execute(&sql, params_from_iter(values))
            .map_err(|error| format!("恢复 {table} 失败：{error}"))?;
        inserted += 1;
    }
    Ok(inserted)
}

type LargeTextChunk = (i64, String, i64, i64, Option<String>);

fn validate_large_text_parts(
    document_id: &str,
    expected_hash: Option<&str>,
    expected_count: i64,
    expected_chars: i64,
    expected_bytes: i64,
    chunks: Vec<LargeTextChunk>,
) -> Result<(), String> {
    use sha2::{Digest, Sha256};

    if chunks.len() as i64 != expected_count {
        return Err(format!("大文本 {document_id} 的分片数量不一致"));
    }

    let mut hasher = Sha256::new();
    let mut total_chars = 0_i64;
    let mut total_bytes = 0_i64;
    for (expected_index, (chunk_index, content, char_count, byte_count, chunk_hash)) in
        chunks.into_iter().enumerate()
    {
        if chunk_index != expected_index as i64 {
            return Err(format!("大文本 {document_id} 的分片索引不连续"));
        }
        let actual_chars = content.encode_utf16().count() as i64;
        let actual_bytes = content.len() as i64;
        if char_count != actual_chars || byte_count != actual_bytes {
            return Err(format!("大文本 {document_id} 的分片元数据不一致"));
        }
        if let Some(expected_chunk_hash) = chunk_hash {
            let actual_chunk_hash = format!("{:x}", Sha256::digest(content.as_bytes()));
            if actual_chunk_hash != expected_chunk_hash {
                return Err(format!("大文本 {document_id} 的分片 SHA-256 校验失败"));
            }
        }
        hasher.update(content.as_bytes());
        total_chars += actual_chars;
        total_bytes += actual_bytes;
    }
    if total_chars != expected_chars || total_bytes != expected_bytes {
        return Err(format!("大文本 {document_id} 的总长度元数据不一致"));
    }
    if let Some(expected_hash) = expected_hash {
        let actual_hash = format!("{:x}", hasher.finalize());
        if actual_hash != expected_hash {
            return Err(format!("大文本 {document_id} 的 SHA-256 校验失败"));
        }
    }
    Ok(())
}

fn backup_string<'a>(row: &'a BackupRow, table: &str, column: &str) -> Result<&'a str, String> {
    row.get(column)
        .and_then(JsonValue::as_str)
        .ok_or_else(|| format!("备份中的 {table} 记录缺少有效的 {column}"))
}

fn backup_i64(row: &BackupRow, table: &str, column: &str) -> Result<i64, String> {
    row.get(column)
        .and_then(JsonValue::as_i64)
        .ok_or_else(|| format!("备份中的 {table} 记录缺少有效的 {column}"))
}

fn validate_backup_large_text_integrity(backup: &ProjectBackup) -> Result<(), String> {
    let documents = backup
        .tables
        .get(LARGE_TEXT_DOCUMENTS)
        .ok_or_else(|| "备份缺少 large_text_documents".to_string())?;
    let chunks = backup
        .tables
        .get(LARGE_TEXT_CHUNKS)
        .ok_or_else(|| "备份缺少 large_text_chunks".to_string())?;
    let mut chunks_by_document: HashMap<String, Vec<LargeTextChunk>> = HashMap::new();
    for row in chunks {
        let document_id = backup_string(row, LARGE_TEXT_CHUNKS, "document_id")?.to_string();
        let chunk_index = backup_i64(row, LARGE_TEXT_CHUNKS, "chunk_index")?;
        let content = backup_string(row, LARGE_TEXT_CHUNKS, "content")?.to_string();
        let char_count = backup_i64(row, LARGE_TEXT_CHUNKS, "char_count")?;
        let byte_count = backup_i64(row, LARGE_TEXT_CHUNKS, "byte_count")?;
        let chunk_hash = match row.get("chunk_sha256") {
            None | Some(JsonValue::Null) => None,
            Some(JsonValue::String(value)) => Some(value.clone()),
            Some(_) => return Err("备份中的 large_text_chunks 包含无效的 chunk_sha256".to_string()),
        };
        chunks_by_document.entry(document_id).or_default().push((
            chunk_index,
            content,
            char_count,
            byte_count,
            chunk_hash,
        ));
    }

    for row in documents {
        let document_id = backup_string(row, LARGE_TEXT_DOCUMENTS, "id")?;
        let expected_hash = match row.get("content_sha256") {
            None | Some(JsonValue::Null) => None,
            Some(JsonValue::String(value)) => Some(value.as_str()),
            Some(_) => {
                return Err("备份中的 large_text_documents 包含无效的 content_sha256".to_string())
            }
        };
        let expected_count = backup_i64(row, LARGE_TEXT_DOCUMENTS, "chunk_count")?;
        let expected_chars = backup_i64(row, LARGE_TEXT_DOCUMENTS, "total_chars")?;
        let expected_bytes = backup_i64(row, LARGE_TEXT_DOCUMENTS, "total_bytes")?;
        let mut document_chunks = chunks_by_document.remove(document_id).unwrap_or_default();
        document_chunks.sort_by_key(|(chunk_index, _, _, _, _)| *chunk_index);
        validate_large_text_parts(
            document_id,
            expected_hash,
            expected_count,
            expected_chars,
            expected_bytes,
            document_chunks,
        )?;
    }
    if let Some(document_id) = chunks_by_document.keys().next() {
        return Err(format!("大文本分片引用了不存在的文档：{document_id}"));
    }
    Ok(())
}

fn validate_large_text_integrity(
    tx: &Transaction<'_>,
    document_ids: &[String],
) -> Result<(), String> {
    for document_id in document_ids {
        let (expected_hash, expected_count, expected_chars, expected_bytes): (Option<String>, i64, i64, i64) = tx
            .query_row(
                "SELECT content_sha256, chunk_count, total_chars, total_bytes FROM large_text_documents WHERE id = ?1",
                params![document_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|error| format!("读取恢复后的大文本元数据失败：{error}"))?;
        let mut statement = tx
            .prepare(
                "SELECT chunk_index, content, char_count, byte_count, chunk_sha256 FROM large_text_chunks WHERE document_id = ?1 ORDER BY chunk_index",
            )
            .map_err(|error| error.to_string())?;
        let chunks = statement
            .query_map(params![document_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        validate_large_text_parts(
            document_id,
            expected_hash.as_deref(),
            expected_count,
            expected_chars,
            expected_bytes,
            chunks,
        )?;
    }
    Ok(())
}
fn validate_foreign_keys(tx: &Transaction<'_>) -> Result<(), String> {
    let mut statement = tx
        .prepare("PRAGMA foreign_key_check")
        .map_err(|error| error.to_string())?;
    let mut rows = statement.query([]).map_err(|error| error.to_string())?;
    if let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let table: String = row.get(0).map_err(|error| error.to_string())?;
        return Err(format!("备份关联校验失败：{table} 存在无效外键"));
    }
    Ok(())
}

fn restore_legacy_quality_issue_states(
    tx: &Transaction<'_>,
    novel_id: &str,
) -> Result<usize, String> {
    tx.execute(
        "INSERT OR IGNORE INTO quality_issue_states
            (id, chapter_id, issue_key, status, resolution_note, resolved_at, created_at, updated_at)
         SELECT
            'legacy:' || CAST(LENGTH(item.chapter_id) AS TEXT) || ':' || item.chapter_id || item.issue_key,
            item.chapter_id,
            item.issue_key,
            CASE WHEN item.status IN ('pending', 'resolved', 'ignored') THEN item.status ELSE 'pending' END,
            item.resolution_note,
            item.resolved_at,
            item.created_at,
            item.updated_at
         FROM quality_check_items AS item
         INNER JOIN chapters AS chapter ON chapter.id = item.chapter_id
         WHERE chapter.novel_id = ?1
           AND item.issue_key IS NOT NULL
           AND TRIM(item.issue_key) <> ''
           AND item.rowid = (
               SELECT candidate.rowid
               FROM quality_check_items AS candidate
               WHERE candidate.chapter_id = item.chapter_id
                 AND candidate.issue_key = item.issue_key
               ORDER BY candidate.updated_at DESC, candidate.rowid DESC
               LIMIT 1
           )",
        params![novel_id],
    )
    .map_err(|error| format!("恢复旧版质量问题状态失败：{error}"))
}

pub fn restore_project_backup_in_conn(
    conn: &mut Connection,
    backup: &ProjectBackup,
) -> Result<ImportProjectBackupResult, String> {
    validate_backup(conn, backup)?;
    let id_map = build_id_map(backup)?;
    let new_novel_id = id_map
        .get(
            backup
                .novel
                .get("id")
                .and_then(JsonValue::as_str)
                .ok_or_else(|| "备份缺少作品 ID".to_string())?,
        )
        .cloned()
        .ok_or_else(|| "无法生成导入作品 ID".to_string())?;
    let title = backup
        .novel
        .get("title")
        .and_then(JsonValue::as_str)
        .unwrap_or("未命名作品")
        .to_string();

    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let novel_rows = vec![backup.novel.clone()];
    insert_rows(&tx, "novels", &novel_rows, &id_map)?;

    let mut restored_records = BTreeMap::new();
    restored_records.insert("novels".to_string(), 1);
    for table in INSERT_ORDER {
        let rows = match backup.tables.get(*table) {
            Some(rows) => rows,
            None if backup.schema_version == 2 && *table == "quality_issue_states" => {
                let inserted = restore_legacy_quality_issue_states(&tx, &new_novel_id)?;
                restored_records.insert((*table).to_string(), inserted);
                continue;
            }
            None => return Err(format!("备份缺少数据表：{table}")),
        };
        let legacy_quality_rows;
        let rows = if backup.schema_version == 2 && *table == "quality_check_items" {
            let mut next_sort_order_by_report = HashMap::<String, i64>::new();
            legacy_quality_rows = rows
                .iter()
                .map(|row| {
                    let mut row = row.clone();
                    let report_id = row
                        .get("report_id")
                        .and_then(JsonValue::as_str)
                        .unwrap_or_default()
                        .to_string();
                    let next_sort_order = next_sort_order_by_report.entry(report_id).or_default();
                    let inferred_sort_order = *next_sort_order;
                    *next_sort_order += 1;
                    row.entry("sort_order".to_string())
                        .or_insert_with(|| JsonValue::from(inferred_sort_order));
                    let missing_issue_key = row
                        .get("issue_key")
                        .and_then(JsonValue::as_str)
                        .map(|issue_key| issue_key.trim().is_empty())
                        .unwrap_or(true);
                    if missing_issue_key {
                        if let Some(id) = row.get("id").cloned() {
                            row.insert("issue_key".to_string(), id);
                        }
                    }
                    row
                })
                .collect::<Vec<_>>();
            &legacy_quality_rows
        } else {
            rows
        };
        let inserted = insert_rows(&tx, table, rows, &id_map)?;
        restored_records.insert((*table).to_string(), inserted);
    }

    let document_ids = backup
        .tables
        .get(LARGE_TEXT_DOCUMENTS)
        .into_iter()
        .flatten()
        .filter_map(|row| row.get("id").and_then(JsonValue::as_str))
        .filter_map(|id| id_map.get(id).cloned())
        .collect::<Vec<_>>();
    validate_large_text_integrity(&tx, &document_ids)?;
    validate_foreign_keys(&tx)?;
    tx.commit().map_err(|error| error.to_string())?;

    Ok(ImportProjectBackupResult {
        novel_id: new_novel_id,
        title,
        restored_records,
        id_map: id_map.into_iter().collect(),
    })
}

fn ids_from_rows(rows: &[BackupRow]) -> Vec<String> {
    rows.iter()
        .filter_map(|row| {
            row.get("id")
                .and_then(JsonValue::as_str)
                .map(str::to_string)
        })
        .collect()
}

fn delete_rows_by_ids(tx: &Transaction<'_>, table: &str, ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    for batch in ids.chunks(SQLITE_BIND_BATCH_SIZE) {
        let placeholders = std::iter::repeat("?")
            .take(batch.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!("DELETE FROM {table} WHERE id IN ({placeholders})");
        let values = batch
            .iter()
            .cloned()
            .map(SqlValue::Text)
            .collect::<Vec<_>>();
        tx.execute(&sql, params_from_iter(values))
            .map_err(|error| format!("清理 {table} 失败：{error}"))?;
    }
    Ok(())
}

fn delete_large_text_chunks_by_document_ids(
    tx: &Transaction<'_>,
    document_ids: &[String],
) -> Result<(), String> {
    if document_ids.is_empty() {
        return Ok(());
    }
    for batch in document_ids.chunks(SQLITE_BIND_BATCH_SIZE) {
        let placeholders = std::iter::repeat("?")
            .take(batch.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!("DELETE FROM {LARGE_TEXT_CHUNKS} WHERE document_id IN ({placeholders})");
        let values = batch
            .iter()
            .cloned()
            .map(SqlValue::Text)
            .collect::<Vec<_>>();
        tx.execute(&sql, params_from_iter(values))
            .map_err(|error| format!("清理大文本分片失败：{error}"))?;
    }
    Ok(())
}

fn purge_project_in_tx(tx: &Transaction<'_>, novel_id: &str) -> Result<(), String> {
    let backup = export_project_backup_in_conn(&*tx, novel_id)?;
    for table in DELETE_ORDER {
        if *table == LARGE_TEXT_CHUNKS {
            let document_ids = backup
                .tables
                .get(LARGE_TEXT_DOCUMENTS)
                .map_or_else(Vec::new, |rows| ids_from_rows(rows));
            delete_large_text_chunks_by_document_ids(tx, &document_ids)?;
        } else {
            let ids = backup
                .tables
                .get(*table)
                .map_or_else(Vec::new, |rows| ids_from_rows(rows));
            delete_rows_by_ids(tx, table, &ids)?;
        }
    }
    tx.execute("DELETE FROM novels WHERE id = ?1", params![novel_id])
        .map_err(|error| format!("清理作品失败：{error}"))?;
    Ok(())
}

#[tauri::command]
pub fn export_project_backup(novel_id: String) -> Result<ProjectBackup, String> {
    let conn = get_connection().lock().map_err(|error| error.to_string())?;
    export_project_backup_in_conn(&conn, &novel_id)
}

#[tauri::command]
pub fn import_project_backup(
    input: ImportProjectBackupInput,
) -> Result<ImportProjectBackupResult, String> {
    let mut conn = get_connection().lock().map_err(|error| error.to_string())?;
    restore_project_backup_in_conn(&mut conn, &input.backup)
}

#[tauri::command]
pub fn discard_imported_project_backup(novel_id: String) -> Result<(), String> {
    let mut conn = get_connection().lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    purge_project_in_tx(&tx, &novel_id)?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_connection() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open in-memory database");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("enable foreign keys");
        crate::db::create_tables(&mut conn).expect("create schema");
        conn
    }

    fn seed_full_project(conn: &Connection, novel_id: &str) {
        let sql = format!(
            "
            INSERT INTO novels (id, title, outline, protagonists_json, dual_protagonist_relation_json, main_character, protagonist_ability, status, current_volume_id, current_chapter_id, total_word_count, created_at, updated_at)
            VALUES ('{novel_id}', '完整备份夹具', '主线', '[\"character-1\"]', '{{\"partnerId\":\"character-1\"}}', '', '', 'draft', 'volume-1', 'chapter-1', 6, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO settings (key, value, updated_at) VALUES ('api_key', 'must-not-export', '2026-01-01T00:00:00Z');
            UPDATE novels SET cover_path = 'C:\\private\\cover.png' WHERE id = '{novel_id}';
            INSERT INTO world_settings (id, novel_id, title, content, created_at, updated_at) VALUES ('world-1', '{novel_id}', '世界', '设定', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO rule_systems (id, novel_id, title, content, created_at, updated_at) VALUES ('rule-1', '{novel_id}', '规则', '规则正文', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO protagonists (id, novel_id, name, created_at, updated_at) VALUES ('protagonist-1', '{novel_id}', '主角', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO volumes (id, novel_id, title, created_at, updated_at) VALUES ('volume-1', '{novel_id}', '第一卷', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO chapters (id, novel_id, volume_id, title, created_at, updated_at) VALUES ('chapter-1', '{novel_id}', 'volume-1', '第一章', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO style_profiles (id, novel_id, name, created_at, updated_at) VALUES ('style-1', '{novel_id}', '风格', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO output_profiles (id, novel_id, name, created_at, updated_at) VALUES ('output-1', '{novel_id}', '输出', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO imported_assets (id, novel_id, file_name, file_path, file_type, asset_type, parsed_json, related_style_profile_id, created_at) VALUES ('asset-1', '{novel_id}', '风格.txt', 'C:\\private\\style.txt', 'text/plain', 'style', '{{\"sourceAssetId\":\"asset-1\",\"styleProfileId\":\"style-1\"}}', 'style-1', '2026-01-01T00:00:00Z');
            INSERT INTO characters (id, novel_id, name, created_at, updated_at) VALUES ('character-1', '{novel_id}', '配角', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO ai_task_records (id, novel_id, chapter_id, task_type, created_at) VALUES ('task-1', '{novel_id}', 'chapter-1', 'generate', '2026-01-01T00:00:00Z');
            INSERT INTO chapter_drafts (id, novel_id, chapter_id, title, content, source, word_count, is_adopted, ai_task_id, large_text_ref_id, created_at, updated_at) VALUES ('draft-1', '{novel_id}', 'chapter-1', '草稿', '预览', 'ai_generated', 6, 1, 'task-1', 'large-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            UPDATE chapters SET adopted_draft_id = 'draft-1' WHERE id = 'chapter-1';
            INSERT INTO chapter_engineering_states (id, novel_id, volume_id, chapter_id, chapter_card_json, scene_plan_json, created_at, updated_at) VALUES ('engineering-1', '{novel_id}', 'volume-1', 'chapter-1', '{{\"novelId\":\"{novel_id}\",\"chapterId\":\"chapter-1\"}}', '[{{\"characterId\":\"character-1\"}}]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO chapter_generation_snapshots (id, novel_id, volume_id, chapter_id, engineering_state_id, style_profile_id, output_profile_id, compiled_context_json, sources_json, created_at) VALUES ('snapshot-1', '{novel_id}', 'volume-1', 'chapter-1', 'engineering-1', 'style-1', 'output-1', '{{\"novelId\":\"{novel_id}\",\"chapterId\":\"chapter-1\",\"volumeId\":\"volume-1\",\"activeEngineeringState\":{{\"id\":\"engineering-1\"}},\"sources\":[{{\"sourceId\":\"style-1\"}}]}}', '[{{\"sourceId\":\"output-1\"}}]', '2026-01-01T00:00:00Z');
            INSERT INTO generation_jobs (id, novel_id, volume_id, chapter_id, job_type, created_at) VALUES ('job-1', '{novel_id}', 'volume-1', 'chapter-1', 'chapter_generation', '2026-01-01T00:00:00Z');
            INSERT INTO generation_step_results (id, job_id, step_name, output_json, created_at) VALUES ('step-1', 'job-1', 'preflight', '{{\"draftId\":\"draft-1\",\"chapterId\":\"chapter-1\"}}', '2026-01-01T00:00:00Z');
            INSERT INTO character_states (id, novel_id, character_id, chapter_id, state_summary, created_at) VALUES ('state-1', '{novel_id}', 'character-1', 'chapter-1', '状态', '2026-01-01T00:00:00Z');
            INSERT INTO chapter_characters (id, novel_id, chapter_id, character_id, created_at, updated_at) VALUES ('chapter-character-1', '{novel_id}', 'chapter-1', 'character-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO chapter_events (id, novel_id, chapter_id, title, involved_character_ids, created_at, updated_at) VALUES ('event-1', '{novel_id}', 'chapter-1', '事件', '[\"character-1\"]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO chapter_summaries (id, novel_id, chapter_id, adopted_draft_id, summary, character_changes, ai_task_id, created_at, updated_at) VALUES ('summary-1', '{novel_id}', 'chapter-1', 'draft-1', '总结', '[{{\"characterId\":\"character-1\"}}]', 'task-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO context_records (id, novel_id, chapter_id, context_type, title, content, created_at, updated_at) VALUES ('context-1', '{novel_id}', 'chapter-1', 'fact', '事实', '内容', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO quality_check_reports (id, novel_id, chapter_id, draft_id, created_at, updated_at) VALUES ('report-1', '{novel_id}', 'chapter-1', 'draft-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO quality_check_items (id, report_id, novel_id, chapter_id, draft_id, issue_type, title, description, issue_key, sort_order, created_at, updated_at) VALUES ('issue-1', 'report-1', '{novel_id}', 'chapter-1', 'draft-1', 'logic', '问题', '说明', 'issue-key-1', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO quality_issue_states (id, chapter_id, issue_key, status, created_at, updated_at) VALUES ('issue-state-1', 'chapter-1', 'issue-key-1', 'resolved', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO polish_records (id, novel_id, chapter_id, source_draft_id, result_draft_id, mode, ai_task_id, created_at, updated_at) VALUES ('polish-1', '{novel_id}', 'chapter-1', 'draft-1', 'draft-1', 'polish', 'task-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO quality_fix_runs (id, novel_id, chapter_id, source_draft_id, target_draft_id, fixed_issue_ids, new_issue_ids, used_context_ids, skipped_context_ids, created_at, updated_at) VALUES ('fix-1', '{novel_id}', 'chapter-1', 'draft-1', 'draft-1', '[\"issue-1\"]', '[]', '[\"context-1\",\"summary-1\"]', '[\"context-1\"]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO context_read_logs (id, novel_id, task_type, chapter_id, volume_id, used_context_ids, skipped_context_ids, created_at) VALUES ('read-log-1', '{novel_id}', 'generate', 'chapter-1', 'volume-1', '[\"context-1\",\"summary-1\"]', '[\"context-1\"]', '2026-01-01T00:00:00Z');
            INSERT INTO master_outlines (id, project_id, title, created_at, updated_at) VALUES ('master-outline-1', '{novel_id}', '总纲', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO volume_outlines (id, project_id, master_outline_id, volume_id, title, created_at, updated_at) VALUES ('volume-outline-1', '{novel_id}', 'master-outline-1', 'volume-1', '卷纲', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO chapter_outlines (id, project_id, volume_outline_id, chapter_id, title, created_at, updated_at) VALUES ('chapter-outline-1', '{novel_id}', 'volume-outline-1', 'chapter-1', '章纲', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO large_text_documents (id, target_type, target_id, field_name, total_chars, total_bytes, chunk_count, content_sha256, created_at, updated_at) VALUES ('large-1', 'draft', 'chapter-1', 'content', 4, 12, 2, '8c88207cc65259056f996760035d72ddbd428d97023a3a165a6ad9b81167dd40', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO large_text_chunks (document_id, chunk_index, content, char_count, byte_count, chunk_sha256, created_at) VALUES ('large-1', 0, '正文', 2, 6, 'd661c3d96d53ebc0ca8a55aae24b5df4a4d1bf28d37337b982fe8ebf54846eeb', '2026-01-01T00:00:00Z');
            INSERT INTO large_text_chunks (document_id, chunk_index, content, char_count, byte_count, chunk_sha256, created_at) VALUES ('large-1', 1, '内容', 2, 6, '7a688306423bec17ca6b53aca56e5c4f2b432380ce4b681ad9c1995445fb48a0', '2026-01-01T00:00:00Z');
            INSERT INTO large_text_documents (id, target_type, target_id, field_name, total_chars, total_bytes, chunk_count, content_sha256, created_at, updated_at) VALUES ('large-character-1', 'character_state', 'state-1', 'content', 4, 12, 1, 'e9589f55a2908aaced631e4df544251c1b0926b982f547ce60b1be72d9b6e6b5', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO large_text_chunks (document_id, chunk_index, content, char_count, byte_count, chunk_sha256, created_at) VALUES ('large-character-1', 0, '角色档案', 4, 12, 'e9589f55a2908aaced631e4df544251c1b0926b982f547ce60b1be72d9b6e6b5', '2026-01-01T00:00:00Z');
            "
        );
        conn.execute_batch(&sql).expect("seed full project");
    }

    fn assert_independent_value_remap(
        source: &JsonValue,
        actual: &JsonValue,
        id_map: &BTreeMap<String, String>,
        path: &str,
    ) {
        match source {
            JsonValue::String(source_text) => {
                if let Some(expected_id) = id_map.get(source_text) {
                    assert_eq!(
                        actual,
                        &JsonValue::String(expected_id.clone()),
                        "{path}: direct ID was not remapped"
                    );
                    return;
                }

                if let Ok(source_json) = serde_json::from_str::<JsonValue>(source_text) {
                    let actual_text = actual
                        .as_str()
                        .unwrap_or_else(|| panic!("{path}: expected JSON text"));
                    let actual_json = serde_json::from_str::<JsonValue>(actual_text)
                        .unwrap_or_else(|_| panic!("{path}: restored JSON is invalid"));
                    assert_independent_value_remap(&source_json, &actual_json, id_map, path);
                } else {
                    assert_eq!(actual, source, "{path}: scalar value changed");
                }
            }
            JsonValue::Array(source_values) => {
                let actual_values = actual
                    .as_array()
                    .unwrap_or_else(|| panic!("{path}: expected JSON array"));
                assert_eq!(
                    source_values.len(),
                    actual_values.len(),
                    "{path}: JSON array length changed"
                );
                for (index, source_value) in source_values.iter().enumerate() {
                    assert_independent_value_remap(
                        source_value,
                        &actual_values[index],
                        id_map,
                        &format!("{path}[{index}]"),
                    );
                }
            }
            JsonValue::Object(source_values) => {
                let actual_values = actual
                    .as_object()
                    .unwrap_or_else(|| panic!("{path}: expected JSON object"));
                assert_eq!(
                    source_values.len(),
                    actual_values.len(),
                    "{path}: JSON object field count changed"
                );
                for (key, source_value) in source_values {
                    let actual_value = actual_values
                        .get(key)
                        .unwrap_or_else(|| panic!("{path}: missing JSON field {key}"));
                    assert_independent_value_remap(
                        source_value,
                        actual_value,
                        id_map,
                        &format!("{path}.{key}"),
                    );
                }
            }
            JsonValue::Null | JsonValue::Bool(_) | JsonValue::Number(_) => {
                assert_eq!(actual, source, "{path}: scalar value changed");
            }
        }
    }

    fn assert_independent_row_remap(
        source: &BackupRow,
        actual: &BackupRow,
        id_map: &BTreeMap<String, String>,
        path: &str,
    ) {
        assert_eq!(source.len(), actual.len(), "{path}: column count changed");
        for (column, source_value) in source {
            let actual_value = actual
                .get(column)
                .unwrap_or_else(|| panic!("{path}: missing column {column}"));
            assert_independent_value_remap(
                source_value,
                actual_value,
                id_map,
                &format!("{path}.{column}"),
            );
        }
    }

    fn assert_backup_is_independently_remapped(
        source: &ProjectBackup,
        actual: &ProjectBackup,
        id_map: &BTreeMap<String, String>,
    ) {
        assert_eq!(source.backup_type, actual.backup_type);
        assert_eq!(source.schema_version, actual.schema_version);
        assert_eq!(source.source_app_version, actual.source_app_version);
        assert_eq!(source.local_storage, actual.local_storage);
        assert_independent_row_remap(&source.novel, &actual.novel, id_map, "novel");
        assert_eq!(source.tables.len(), actual.tables.len());

        for (table, source_rows) in &source.tables {
            let actual_rows = actual
                .tables
                .get(table)
                .unwrap_or_else(|| panic!("missing restored table {table}"));
            assert_eq!(
                source_rows.len(),
                actual_rows.len(),
                "{table}: row count changed"
            );
            for (index, (source_row, actual_row)) in
                source_rows.iter().zip(actual_rows.iter()).enumerate()
            {
                assert_independent_row_remap(
                    source_row,
                    actual_row,
                    id_map,
                    &format!("{table}[{index}]"),
                );
            }
        }
    }

    #[test]
    fn project_backup_export_clear_restore_round_trip_restores_full_project() {
        let mut source = test_connection();
        seed_full_project(&source, "novel-source");
        let backup = export_project_backup_in_conn(&source, "novel-source").expect("export source");
        let serialized = serde_json::to_string(&backup).expect("serialize backup");
        assert!(!serialized.contains("must-not-export"));
        assert_eq!(backup.novel.get("cover_path"), Some(&JsonValue::Null));
        assert_eq!(
            backup.tables["imported_assets"][0].get("file_path"),
            Some(&JsonValue::Null),
        );
        let deserialized =
            serde_json::from_str::<ProjectBackup>(&serialized).expect("deserialize backup");

        {
            let tx = source
                .transaction()
                .expect("start project cleanup transaction");
            purge_project_in_tx(&tx, "novel-source").expect("clear temporary project");
            tx.commit().expect("commit project cleanup");
        }
        source
            .execute("DELETE FROM settings", [])
            .expect("clear temporary settings");
        let cleared_novel_count: i64 = source
            .query_row("SELECT COUNT(*) FROM novels", [], |row| row.get(0))
            .expect("confirm temporary database is clear");
        assert_eq!(cleared_novel_count, 0);
        for table in table_names() {
            let cleared_count: i64 = source
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("confirm temporary project table is clear");
            assert_eq!(
                cleared_count, 0,
                "temporary table {table} still has records"
            );
        }

        let restored =
            restore_project_backup_in_conn(&mut source, &deserialized).expect("restore backup");
        let actual =
            export_project_backup_in_conn(&source, &restored.novel_id).expect("export restored");
        let actual_serialized = serde_json::to_string(&actual).expect("serialize restored backup");
        for source_id in [
            "novel-source",
            "world-1",
            "rule-1",
            "protagonist-1",
            "volume-1",
            "chapter-1",
            "style-1",
            "output-1",
            "asset-1",
            "character-1",
            "task-1",
            "draft-1",
            "engineering-1",
            "snapshot-1",
            "job-1",
            "step-1",
            "state-1",
            "chapter-character-1",
            "event-1",
            "summary-1",
            "context-1",
            "report-1",
            "issue-1",
            "polish-1",
            "fix-1",
            "read-log-1",
            "master-outline-1",
            "volume-outline-1",
            "chapter-outline-1",
            "large-1",
            "large-character-1",
        ] {
            assert!(
                !actual_serialized.contains(&format!("\"{source_id}\"")),
                "restored backup still contains source ID {source_id}",
            );
        }
        assert_backup_is_independently_remapped(&backup, &actual, &restored.id_map);

        let foreign_key_violations: i64 = source
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .expect("foreign key check");
        assert_eq!(foreign_key_violations, 0);

        let restored_character_id = restored
            .id_map
            .get("character-1")
            .expect("character ID map");
        let restored_context_id = restored.id_map.get("context-1").expect("context ID map");
        let restored_summary_id = restored.id_map.get("summary-1").expect("summary ID map");
        let event_ids_json: String = source
            .query_row(
                "SELECT involved_character_ids FROM chapter_events",
                [],
                |row| row.get(0),
            )
            .expect("read restored event IDs");
        let event_ids =
            serde_json::from_str::<Vec<String>>(&event_ids_json).expect("parse event IDs");
        assert_eq!(event_ids, vec![restored_character_id.clone()]);

        let snapshot_json: String = source
            .query_row(
                "SELECT compiled_context_json FROM chapter_generation_snapshots",
                [],
                |row| row.get(0),
            )
            .expect("read restored snapshot JSON");
        let snapshot =
            serde_json::from_str::<JsonValue>(&snapshot_json).expect("parse snapshot JSON");
        assert_eq!(
            snapshot["novelId"].as_str(),
            Some(restored.novel_id.as_str())
        );
        assert_eq!(
            snapshot["activeEngineeringState"]["id"].as_str(),
            restored.id_map.get("engineering-1").map(String::as_str),
        );

        let used_context_ids_json: String = source
            .query_row(
                "SELECT used_context_ids FROM context_read_logs",
                [],
                |row| row.get(0),
            )
            .expect("read restored context log IDs");
        let used_context_ids = serde_json::from_str::<Vec<String>>(&used_context_ids_json)
            .expect("parse restored context log IDs");
        assert_eq!(
            used_context_ids,
            vec![restored_context_id.clone(), restored_summary_id.clone()],
        );

        let (document_id, expected_hash): (String, String) = source
            .query_row(
                "SELECT id, content_sha256 FROM large_text_documents WHERE target_type = 'draft'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read restored document");
        let content = {
            let mut statement = source
                .prepare(
                    "SELECT content FROM large_text_chunks WHERE document_id = ?1 ORDER BY chunk_index",
                )
                .expect("prepare restored chunk query");
            statement
                .query_map(params![document_id], |row| row.get::<_, String>(0))
                .expect("read restored chunks")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect restored chunks")
                .join("")
        };
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        assert_eq!(format!("{:x}", hasher.finalize()), expected_hash);

        let restored_character_document_target: String = source
            .query_row(
                "SELECT target_id FROM large_text_documents WHERE target_type = 'character_state'",
                [],
                |row| row.get(0),
            )
            .expect("read character-state document target");
        assert_eq!(
            restored_character_document_target,
            restored
                .id_map
                .get("state-1")
                .expect("character-state ID map")
                .clone(),
        );
        let document_count: i64 = source
            .query_row("SELECT COUNT(*) FROM large_text_documents", [], |row| {
                row.get(0)
            })
            .expect("count restored documents");
        assert_eq!(document_count, 2);

        let setting_count: i64 = source
            .query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))
            .expect("confirm settings remain excluded");
        assert_eq!(setting_count, 0);
    }

    #[test]
    fn project_backup_schema_two_restores_without_quality_state_table() {
        let source = test_connection();
        seed_full_project(&source, "novel-source");
        let mut backup =
            export_project_backup_in_conn(&source, "novel-source").expect("export source");
        backup.schema_version = 2;
        backup.tables.remove("quality_issue_states");
        let first_issue = backup
            .tables
            .get_mut("quality_check_items")
            .and_then(|rows| rows.first_mut())
            .expect("quality issue fixture");
        first_issue.remove("sort_order");
        first_issue.insert(
            "status".to_string(),
            JsonValue::String("ignored".to_string()),
        );
        first_issue.insert(
            "resolution_note".to_string(),
            JsonValue::String("legacy decision".to_string()),
        );
        let first_issue_template = first_issue.clone();
        let mut second_issue = first_issue_template.clone();
        second_issue.insert(
            "id".to_string(),
            JsonValue::String("issue-legacy-2".to_string()),
        );
        second_issue.insert(
            "issue_key".to_string(),
            JsonValue::String("issue-key-legacy-2".to_string()),
        );
        second_issue.insert(
            "status".to_string(),
            JsonValue::String("pending".to_string()),
        );
        backup
            .tables
            .get_mut("quality_check_items")
            .expect("quality items")
            .push(second_issue);
        let mut second_report = backup
            .tables
            .get("quality_check_reports")
            .and_then(|rows| rows.first())
            .expect("quality report fixture")
            .clone();
        second_report.insert(
            "id".to_string(),
            JsonValue::String("report-legacy-2".to_string()),
        );
        backup
            .tables
            .get_mut("quality_check_reports")
            .expect("quality reports")
            .push(second_report);
        let mut third_issue = first_issue_template;
        third_issue.insert(
            "id".to_string(),
            JsonValue::String("issue-legacy-3".to_string()),
        );
        third_issue.insert(
            "report_id".to_string(),
            JsonValue::String("report-legacy-2".to_string()),
        );
        third_issue.insert(
            "issue_key".to_string(),
            JsonValue::String("issue-key-legacy-3".to_string()),
        );
        backup
            .tables
            .get_mut("quality_check_items")
            .expect("quality items")
            .push(third_issue);

        let mut target = test_connection();
        let restored = restore_project_backup_in_conn(&mut target, &backup)
            .expect("restore schemaVersion 2 backup");
        assert_eq!(restored.restored_records["quality_check_items"], 3);
        assert_eq!(restored.restored_records["quality_issue_states"], 3);
        let item_count: i64 = target
            .query_row("SELECT COUNT(*) FROM quality_check_items", [], |row| {
                row.get(0)
            })
            .expect("count restored quality items");
        let state_count: i64 = target
            .query_row("SELECT COUNT(*) FROM quality_issue_states", [], |row| {
                row.get(0)
            })
            .expect("count restored quality states");
        assert_eq!(item_count, 3);
        assert_eq!(state_count, 3);
        let second_report_id = restored
            .id_map
            .get("report-legacy-2")
            .expect("restored second report id");
        let second_report_sort_order: i64 = target
            .query_row(
                "SELECT sort_order FROM quality_check_items WHERE report_id = ?1",
                params![second_report_id],
                |row| row.get(0),
            )
            .expect("read restored per-report sort order");
        assert_eq!(second_report_sort_order, 0);
        let legacy_state: (String, Option<String>) = target
            .query_row(
                "SELECT status, resolution_note FROM quality_issue_states WHERE issue_key = 'issue-key-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read restored legacy state");
        assert_eq!(
            legacy_state,
            ("ignored".to_string(), Some("legacy decision".to_string()))
        );
    }

    #[test]
    fn project_backup_rejects_invalid_backup_without_partial_write() {
        let source = test_connection();
        seed_full_project(&source, "novel-source");
        let mut backup =
            export_project_backup_in_conn(&source, "novel-source").expect("export source");
        backup
            .tables
            .get_mut("chapter_drafts")
            .and_then(|rows| rows.first_mut())
            .expect("draft fixture")
            .insert(
                "chapter_id".to_string(),
                JsonValue::String("missing-chapter".to_string()),
            );

        let mut target = test_connection();
        target
            .execute(
                "INSERT INTO novels (id, title, outline, protagonists_json, dual_protagonist_relation_json, main_character, protagonist_ability, created_at, updated_at) VALUES ('sentinel', '保留作品', '', '[]', '{}', '', '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
                [],
            )
            .expect("seed sentinel");
        assert!(restore_project_backup_in_conn(&mut target, &backup).is_err());

        let sentinel_count: i64 = target
            .query_row(
                "SELECT COUNT(*) FROM novels WHERE id = 'sentinel'",
                [],
                |row| row.get(0),
            )
            .expect("read sentinel");
        let imported_count: i64 = target
            .query_row(
                "SELECT COUNT(*) FROM novels WHERE title = '完整备份夹具'",
                [],
                |row| row.get(0),
            )
            .expect("read restored rows");
        assert_eq!(sentinel_count, 1);
        assert_eq!(imported_count, 0);
    }

    #[test]
    fn project_backup_rejects_tampered_large_text_without_partial_write() {
        let source = test_connection();
        seed_full_project(&source, "novel-source");
        let mut backup =
            export_project_backup_in_conn(&source, "novel-source").expect("export source");
        backup
            .tables
            .get_mut(LARGE_TEXT_DOCUMENTS)
            .and_then(|rows| rows.first_mut())
            .expect("large-text fixture")
            .insert(
                "content_sha256".to_string(),
                JsonValue::String("00".repeat(32)),
            );

        let mut target = test_connection();
        target
            .execute(
                "INSERT INTO novels (id, title, outline, protagonists_json, dual_protagonist_relation_json, main_character, protagonist_ability, created_at, updated_at) VALUES ('sentinel', '保留作品', '', '[]', '{}', '', '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
                [],
            )
            .expect("seed sentinel");
        assert!(restore_project_backup_in_conn(&mut target, &backup).is_err());

        let sentinel_count: i64 = target
            .query_row(
                "SELECT COUNT(*) FROM novels WHERE id = 'sentinel'",
                [],
                |row| row.get(0),
            )
            .expect("read sentinel");
        let imported_count: i64 = target
            .query_row(
                "SELECT COUNT(*) FROM novels WHERE title = '完整备份夹具'",
                [],
                |row| row.get(0),
            )
            .expect("read restored rows");
        let draft_count: i64 = target
            .query_row("SELECT COUNT(*) FROM chapter_drafts", [], |row| row.get(0))
            .expect("confirm no partial drafts");
        assert_eq!(sentinel_count, 1);
        assert_eq!(imported_count, 0);
        assert_eq!(draft_count, 0);
    }

    #[test]
    fn project_backup_refuses_corrupted_source_large_text() {
        let source = test_connection();
        seed_full_project(&source, "novel-source");
        source
            .execute(
                "UPDATE large_text_chunks SET content = '损坏' WHERE document_id = 'large-1' AND chunk_index = 0",
                [],
            )
            .expect("corrupt source large text");

        assert!(export_project_backup_in_conn(&source, "novel-source").is_err());
    }
}
