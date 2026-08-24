use crate::db::get_connection;
use crate::services::{
    ai_fact_security, autonomous_scheduler_service::AutonomousAutomationPolicy,
    autonomous_story_service,
};
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params, params_from_iter, Connection, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};

const BACKUP_TYPE: &str = "ai_novel_studio_project";
const BACKUP_SCHEMA_VERSION: u32 = 11;
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
        name: "task_conversations",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "conversation_turns",
        filter: "conversation_id IN (SELECT conversation_id FROM task_conversations WHERE novel_id = ?1)",
    },
    TableSpec {
        name: "task_runs",
        filter: "conversation_id IN (SELECT conversation_id FROM task_conversations WHERE novel_id = ?1)",
    },
    TableSpec {
        name: "tool_call_events",
        filter: "run_id IN (SELECT run_id FROM task_runs WHERE conversation_id IN (SELECT conversation_id FROM task_conversations WHERE novel_id = ?1))",
    },
    TableSpec {
        name: "conversation_artifact_cards",
        filter: "conversation_id IN (SELECT conversation_id FROM task_conversations WHERE novel_id = ?1)",
    },
    TableSpec {
        name: "artifact_decisions",
        filter: "conversation_id IN (SELECT conversation_id FROM task_conversations WHERE novel_id = ?1)",
    },
    TableSpec {
        name: "review_authorizations",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "ai_tasks",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "ai_task_attempts",
        filter: "task_id IN (SELECT task_id FROM ai_tasks WHERE novel_id = ?1)",
    },
    TableSpec {
        name: "ai_input_snapshots",
        filter: "task_id IN (SELECT task_id FROM ai_tasks WHERE novel_id = ?1)",
    },
    TableSpec {
        name: "ai_context_snapshots",
        filter: "task_id IN (SELECT task_id FROM ai_tasks WHERE novel_id = ?1)",
    },
    TableSpec {
        name: "ai_constraint_snapshots",
        filter: "task_id IN (SELECT task_id FROM ai_tasks WHERE novel_id = ?1)",
    },
    TableSpec {
        name: "result_artifacts",
        filter: "task_id IN (SELECT task_id FROM ai_tasks WHERE novel_id = ?1)",
    },
    TableSpec {
        name: "artifact_validation_issues",
        filter: "artifact_id IN (SELECT artifact_id FROM result_artifacts WHERE task_id IN (SELECT task_id FROM ai_tasks WHERE novel_id = ?1))",
    },
    TableSpec {
        name: "reference_works",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "reference_imports",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "reference_sections",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "memory_documents",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "memory_chunks",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "memory_embeddings",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "memory_retrieval_logs",
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
        name: "autonomous_story_plans",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "autonomous_book_runs",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "autonomous_run_leases",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "autonomous_run_chapter_attempts",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "autonomous_run_checkpoints",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "multi_agent_sessions",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "multi_agent_rounds",
        filter: "session_id IN (SELECT session_id FROM multi_agent_sessions WHERE novel_id = ?1)",
    },
    TableSpec {
        name: "multi_agent_opinions",
        filter: "session_id IN (SELECT session_id FROM multi_agent_sessions WHERE novel_id = ?1)",
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
        name: "factions",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "locations",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "faction_relations",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "location_links",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "character_factions",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "chapter_factions",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "chapter_locations",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "chapter_event_factions",
        filter: "novel_id = ?1",
    },
    TableSpec {
        name: "chapter_event_locations",
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
    "chapter_drafts",
    "task_conversations",
    "conversation_turns",
    "task_runs",
    "tool_call_events",
    "ai_tasks",
    LARGE_TEXT_DOCUMENTS,
    LARGE_TEXT_CHUNKS,
    "ai_input_snapshots",
    "ai_context_snapshots",
    "ai_constraint_snapshots",
    "ai_task_attempts",
    "result_artifacts",
    "artifact_validation_issues",
    "conversation_artifact_cards",
    "artifact_decisions",
    "review_authorizations",
    "reference_works",
    "reference_imports",
    "reference_sections",
    "style_profiles",
    "output_profiles",
    "imported_assets",
    "characters",
    "ai_task_records",
    "memory_documents",
    "memory_chunks",
    "memory_embeddings",
    "memory_retrieval_logs",
    "autonomous_story_plans",
    "autonomous_book_runs",
    "autonomous_run_leases",
    "autonomous_run_chapter_attempts",
    "autonomous_run_checkpoints",
    "multi_agent_sessions",
    "multi_agent_rounds",
    "multi_agent_opinions",
    "chapter_engineering_states",
    "chapter_generation_snapshots",
    "generation_jobs",
    "generation_step_results",
    "character_states",
    "chapter_characters",
    "chapter_events",
    "factions",
    "locations",
    "faction_relations",
    "location_links",
    "character_factions",
    "chapter_factions",
    "chapter_locations",
    "chapter_event_factions",
    "chapter_event_locations",
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
];

const DELETE_ORDER: &[&str] = &[
    "autonomous_run_checkpoints",
    "autonomous_run_chapter_attempts",
    "autonomous_run_leases",
    "autonomous_book_runs",
    "memory_embeddings",
    "memory_chunks",
    "memory_documents",
    "memory_retrieval_logs",
    "reference_sections",
    "reference_imports",
    "reference_works",
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
    "chapter_event_locations",
    "chapter_event_factions",
    "chapter_locations",
    "chapter_factions",
    "character_factions",
    "location_links",
    "faction_relations",
    "locations",
    "factions",
    "chapter_events",
    "chapter_characters",
    "character_states",
    "generation_step_results",
    "generation_jobs",
    "chapter_generation_snapshots",
    "chapter_engineering_states",
    "multi_agent_opinions",
    "multi_agent_rounds",
    "multi_agent_sessions",
    "autonomous_story_plans",
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
    "reference_work_id",
    "reference_import_id",
    "source_reference_work_id",
    "source_reference_import_id",
    "related_style_profile_id",
    "first_appearance_chapter_id",
    "character_id",
    "draft_id",
    "report_id",
    "source_draft_id",
    "input_draft_id",
    "output_draft_id",
    "final_draft_id",
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
    "session_id",
    "review_session_id",
    "opinion_id",
    "operation_id",
    "plan_id",
    "source_id",
    "chunk_id",
    "run_id",
    "lease_id",
    "attempt_id",
    "checkpoint_id",
    "parent_location_id",
    "source_faction_id",
    "target_faction_id",
    "source_location_id",
    "target_location_id",
    "faction_id",
    "location_id",
    "chapter_event_id",
    "conversation_id",
    "turn_id",
    "event_id",
    "call_id",
    "task_id",
    "snapshot_id",
    "artifact_id",
    "card_id",
    "issue_id",
    "provider_request_id",
    "input_snapshot_id",
    "context_snapshot_id",
    "constraint_snapshot_id",
    "current_attempt_id",
    "result_artifact_id",
    "source_input_snapshot_id",
    "source_novel_id",
    "source_chapter_id",
    "parent_artifact_id",
    "body_ref_id",
    "compiled_context_ref_id",
    "prompt_template_ref_id",
    "raw_content_ref_id",
    "display_content_ref_id",
    "structured_payload_ref_id",
];

const IDENTITY_COLUMNS: &[&str] = &[
    "id",
    "session_id",
    "opinion_id",
    "operation_id",
    "plan_id",
    "run_id",
    "lease_id",
    "attempt_id",
    "checkpoint_id",
    "conversation_id",
    "turn_id",
    "event_id",
    "task_id",
    "snapshot_id",
    "artifact_id",
    "card_id",
    "issue_id",
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
    "analysis_metadata_json",
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
    "plan_json",
    "metadata_json",
    "entity_keys_json",
    "filters_json",
    "selected_chunk_ids_json",
    "score_reasons_json",
    "policy_json",
    "payload_json",
    "decision_json",
    "error_json",
    "target_hint_json",
    "model_snapshot_json",
    "arguments_summary_json",
    "source_manifest_json",
    "budget_json",
    "provider_options_json",
    "response_metadata_json",
    "details_json",
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

fn is_multi_agent_table(table: &str) -> bool {
    matches!(
        table,
        "multi_agent_sessions" | "multi_agent_rounds" | "multi_agent_opinions"
    )
}

fn is_autonomous_story_table(table: &str) -> bool {
    table == "autonomous_story_plans"
}

fn is_reference_library_table(table: &str) -> bool {
    matches!(
        table,
        "reference_works" | "reference_imports" | "reference_sections"
    )
}

fn is_memory_table(table: &str) -> bool {
    matches!(
        table,
        "memory_documents" | "memory_chunks" | "memory_embeddings" | "memory_retrieval_logs"
    )
}

fn is_autonomous_scheduler_table(table: &str) -> bool {
    matches!(
        table,
        "autonomous_book_runs"
            | "autonomous_run_leases"
            | "autonomous_run_chapter_attempts"
            | "autonomous_run_checkpoints"
    )
}

fn is_story_asset_table(table: &str) -> bool {
    matches!(
        table,
        "factions"
            | "locations"
            | "faction_relations"
            | "location_links"
            | "character_factions"
            | "chapter_factions"
            | "chapter_locations"
            | "chapter_event_factions"
            | "chapter_event_locations"
    )
}

fn is_conversation_workbench_table(table: &str) -> bool {
    matches!(
        table,
        "task_conversations"
            | "conversation_turns"
            | "task_runs"
            | "tool_call_events"
            | "conversation_artifact_cards"
            | "artifact_decisions"
            | "review_authorizations"
            | "ai_tasks"
            | "ai_task_attempts"
            | "ai_input_snapshots"
            | "ai_context_snapshots"
            | "ai_constraint_snapshots"
            | "result_artifacts"
            | "artifact_validation_issues"
    )
}

fn table_names_for_schema(schema_version: u32) -> Vec<&'static str> {
    table_names()
        .into_iter()
        .filter(|table| schema_version >= 3 || *table != "quality_issue_states")
        .filter(|table| schema_version >= 4 || !is_multi_agent_table(table))
        .filter(|table| schema_version >= 5 || !is_autonomous_story_table(table))
        .filter(|table| schema_version >= 6 || !is_reference_library_table(table))
        .filter(|table| schema_version >= 7 || !is_memory_table(table))
        .filter(|table| schema_version >= 8 || !is_autonomous_scheduler_table(table))
        .filter(|table| schema_version >= 9 || !is_story_asset_table(table))
        .filter(|table| schema_version >= 10 || !is_conversation_workbench_table(table))
        .filter(|table| {
            schema_version >= 11
                || !matches!(*table, "artifact_decisions" | "review_authorizations")
        })
        .collect()
}

fn clear_machine_paths(row: &mut BackupRow) {
    for column in ["cover_path", "file_path", "source_file_path"] {
        if row.contains_key(column) {
            row.insert(column.to_string(), JsonValue::Null);
        }
    }
}

fn collect_row_ids(rows: &[BackupRow], ids: &mut Vec<String>) {
    for row in rows {
        for column in IDENTITY_COLUMNS {
            if let Some(id) = row.get(*column).and_then(JsonValue::as_str) {
                ids.push(id.to_string());
            }
        }
    }
}

fn collect_large_text_reference_ids(rows: &[BackupRow], ids: &mut Vec<String>) {
    for row in rows {
        for column in [
            "large_text_ref_id",
            "body_ref_id",
            "compiled_context_ref_id",
            "prompt_template_ref_id",
            "raw_content_ref_id",
            "display_content_ref_id",
            "structured_payload_ref_id",
        ] {
            if let Some(id) = row.get(column).and_then(JsonValue::as_str) {
                ids.push(id.to_string());
            }
        }
        if let Some(document_id) = row
            .get("result_json")
            .and_then(JsonValue::as_str)
            .and_then(|raw| serde_json::from_str::<JsonValue>(raw).ok())
            .and_then(|value| value.get("largeTextRefId").cloned())
            .and_then(|value| value.as_str().map(str::to_string))
        {
            ids.push(document_id);
        }
    }
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
        if matches!(spec.name, "imported_assets" | "reference_imports") {
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
    let has_non_empty_text = |column: &str| {
        row.get(column)
            .and_then(JsonValue::as_str)
            .is_some_and(|id| !id.trim().is_empty())
    };
    let has_valid_identity = match table {
        LARGE_TEXT_CHUNKS => true,
        "multi_agent_sessions" => has_non_empty_text("session_id"),
        "multi_agent_rounds" => {
            has_non_empty_text("session_id")
                && row
                    .get("round_number")
                    .and_then(JsonValue::as_i64)
                    .is_some()
        }
        "multi_agent_opinions" => has_non_empty_text("opinion_id"),
        "autonomous_story_plans" => has_non_empty_text("plan_id"),
        "autonomous_book_runs" => has_non_empty_text("run_id"),
        "autonomous_run_leases" => has_non_empty_text("lease_id"),
        "autonomous_run_chapter_attempts" => has_non_empty_text("attempt_id"),
        "autonomous_run_checkpoints" => has_non_empty_text("checkpoint_id"),
        "task_conversations" => has_non_empty_text("conversation_id"),
        "conversation_turns" => has_non_empty_text("turn_id"),
        "task_runs" => has_non_empty_text("run_id"),
        "tool_call_events" => has_non_empty_text("event_id"),
        "conversation_artifact_cards" => has_non_empty_text("card_id"),
        "artifact_decisions" => has_non_empty_text("decision_id"),
        "review_authorizations" => has_non_empty_text("authorization_id"),
        "ai_tasks" => has_non_empty_text("task_id"),
        "ai_task_attempts" => has_non_empty_text("attempt_id"),
        "ai_input_snapshots" | "ai_context_snapshots" | "ai_constraint_snapshots" => {
            has_non_empty_text("snapshot_id")
        }
        "result_artifacts" => has_non_empty_text("artifact_id"),
        "artifact_validation_issues" => has_non_empty_text("issue_id"),
        _ => has_non_empty_text("id"),
    };
    if !has_valid_identity {
        return Err(format!("备份中的 {table} 记录缺少有效标识"));
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

    let text_is_one_of = |column: &str, allowed: &[&str]| {
        row.get(column)
            .and_then(JsonValue::as_str)
            .is_some_and(|value| allowed.contains(&value))
    };
    let required_json_object = |column: &str| {
        row.get(column)
            .and_then(JsonValue::as_str)
            .and_then(|value| serde_json::from_str::<JsonValue>(value).ok())
            .is_some_and(|value| value.is_object())
    };
    let optional_valid_json = |column: &str| match row.get(column) {
        None | Some(JsonValue::Null) => true,
        Some(JsonValue::String(value)) => serde_json::from_str::<JsonValue>(value).is_ok(),
        Some(_) => false,
    };
    let optional_json_object = |column: &str| match row.get(column) {
        None | Some(JsonValue::Null) => true,
        Some(JsonValue::String(value)) => serde_json::from_str::<JsonValue>(value)
            .ok()
            .is_some_and(|value| value.is_object()),
        Some(_) => false,
    };
    let optional_non_empty_text = |column: &str| match row.get(column) {
        None | Some(JsonValue::Null) => true,
        Some(JsonValue::String(value)) => !value.trim().is_empty(),
        Some(_) => false,
    };

    let valid_workbench_row = match table {
        "task_conversations" => {
            has_non_empty_text("novel_id")
                && has_non_empty_text("title")
                && text_is_one_of(
                    "status",
                    &[
                        "idle",
                        "running",
                        "waiting_user",
                        "failed",
                        "completed",
                        "archived",
                    ],
                )
                && optional_json_object("default_model_json")
        }
        "conversation_turns" => {
            has_non_empty_text("conversation_id")
                && row
                    .get("sequence")
                    .and_then(JsonValue::as_i64)
                    .is_some_and(|sequence| sequence >= 0)
                && text_is_one_of("role", &["user", "assistant", "system"])
                && has_non_empty_text("content")
                && optional_non_empty_text("run_id")
        }
        "task_runs" => {
            has_non_empty_text("conversation_id")
                && has_non_empty_text("turn_id")
                && has_non_empty_text("worker_id")
                && text_is_one_of(
                    "status",
                    &[
                        "queued",
                        "running",
                        "completed",
                        "failed",
                        "cancel_requested",
                        "cancelled",
                    ],
                )
                && required_json_object("model_snapshot_json")
        }
        "tool_call_events" => {
            has_non_empty_text("run_id")
                && has_non_empty_text("tool_name")
                && row
                    .get("sequence")
                    .and_then(JsonValue::as_i64)
                    .is_some_and(|sequence| sequence >= 0)
                && text_is_one_of(
                    "status",
                    &[
                        "pending",
                        "queued",
                        "running",
                        "succeeded",
                        "failed",
                        "cancelled",
                        "skipped",
                    ],
                )
                && required_json_object("arguments_summary_json")
                && optional_valid_json("result_json")
                && optional_non_empty_text("call_id")
                && row
                    .get("duration_ms")
                    .is_none_or(|value| value.is_null() || value.as_i64().is_some_and(|ms| ms >= 0))
        }
        "conversation_artifact_cards" => {
            has_non_empty_text("conversation_id")
                && has_non_empty_text("artifact_type")
                && has_non_empty_text("title")
                && text_is_one_of("status", &["candidate", "confirmed", "rejected"])
                && optional_non_empty_text("turn_id")
                && optional_non_empty_text("run_id")
                && optional_non_empty_text("artifact_id")
                && (!has_non_empty_text("artifact_id")
                    || row
                        .get("content")
                        .and_then(JsonValue::as_str)
                        .is_some_and(str::is_empty))
        }
        _ => true,
    };
    if !valid_workbench_row {
        return Err(format!("备份中的 {table} 记录状态、作用域或 JSON 无效"));
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
    validate_backup_reference_library(backup)?;
    validate_backup_memory(backup)?;
    validate_backup_large_text_integrity(backup)?;
    Ok(())
}

fn backup_text_hash(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn required_backup_str<'a>(
    row: &'a BackupRow,
    column: &str,
    table: &str,
) -> Result<&'a str, String> {
    row.get(column)
        .and_then(JsonValue::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("备份中的 {table}.{column} 无效"))
}

fn required_backup_i64(row: &BackupRow, column: &str, table: &str) -> Result<i64, String> {
    row.get(column)
        .and_then(JsonValue::as_i64)
        .ok_or_else(|| format!("备份中的 {table}.{column} 无效"))
}

fn valid_backup_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_backup_reference_library(backup: &ProjectBackup) -> Result<(), String> {
    if backup.schema_version < 6 {
        return Ok(());
    }
    let works = backup
        .tables
        .get("reference_works")
        .ok_or_else(|| "备份缺少 reference_works".to_string())?;
    let imports = backup
        .tables
        .get("reference_imports")
        .ok_or_else(|| "备份缺少 reference_imports".to_string())?;
    let sections = backup
        .tables
        .get("reference_sections")
        .ok_or_else(|| "备份缺少 reference_sections".to_string())?;
    let novel_id = required_backup_str(&backup.novel, "id", "novels")?;
    let work_ids = works
        .iter()
        .map(|row| {
            let id = required_backup_str(row, "id", "reference_works")?;
            if required_backup_str(row, "novel_id", "reference_works")? != novel_id {
                return Err("备份中的参考作品越过小说作用域".to_string());
            }
            if required_backup_i64(row, "revision", "reference_works")? < 1 {
                return Err("备份中的参考作品 revision 无效".to_string());
            }
            Ok(id.to_string())
        })
        .collect::<Result<HashSet<_>, String>>()?;

    let documents = backup
        .tables
        .get(LARGE_TEXT_DOCUMENTS)
        .into_iter()
        .flatten()
        .filter_map(|row| {
            row.get("id")
                .and_then(JsonValue::as_str)
                .map(|id| (id, row))
        })
        .collect::<HashMap<_, _>>();
    let mut import_scope = HashMap::<String, String>::new();
    let mut versions = HashMap::<String, Vec<i64>>::new();
    let mut current_counts = HashMap::<String, usize>::new();
    let mut expected_sections = HashMap::<String, i64>::new();
    for row in imports {
        let id = required_backup_str(row, "id", "reference_imports")?;
        let work_id = required_backup_str(row, "reference_work_id", "reference_imports")?;
        if !work_ids.contains(work_id)
            || required_backup_str(row, "novel_id", "reference_imports")? != novel_id
        {
            return Err("备份中的参考导入越过作品作用域".to_string());
        }
        let version = required_backup_i64(row, "version_no", "reference_imports")?;
        if version < 1 {
            return Err("备份中的参考导入版本无效".to_string());
        }
        versions
            .entry(work_id.to_string())
            .or_default()
            .push(version);
        if required_backup_i64(row, "is_current", "reference_imports")? == 1 {
            *current_counts.entry(work_id.to_string()).or_default() += 1;
        }
        let decoded_hash = required_backup_str(row, "decoded_text_sha256", "reference_imports")?;
        if !valid_backup_hash(decoded_hash) {
            return Err("备份中的参考导入正文哈希无效".to_string());
        }
        if let Some(document_id) = row.get("large_text_ref_id").and_then(JsonValue::as_str) {
            let document = documents
                .get(document_id)
                .ok_or_else(|| "备份中的参考导入缺少大文本正文".to_string())?;
            if document.get("content_sha256").and_then(JsonValue::as_str) != Some(decoded_hash)
                || document.get("target_type").and_then(JsonValue::as_str)
                    != Some("reference_import")
                || document.get("target_id").and_then(JsonValue::as_str) != Some(id)
                || document.get("field_name").and_then(JsonValue::as_str) != Some("source_text")
            {
                return Err("备份中的参考导入大文本身份不一致".to_string());
            }
        } else {
            let source_text = required_backup_str(row, "source_text", "reference_imports")?;
            if backup_text_hash(source_text) != decoded_hash {
                return Err("备份中的参考导入正文已被篡改".to_string());
            }
        }
        import_scope.insert(id.to_string(), work_id.to_string());
        expected_sections.insert(
            id.to_string(),
            required_backup_i64(row, "section_count", "reference_imports")?,
        );
    }
    for work_id in &work_ids {
        let mut work_versions = versions.remove(work_id).unwrap_or_default();
        work_versions.sort_unstable();
        if work_versions
            != (1..=i64::try_from(work_versions.len()).unwrap_or_default()).collect::<Vec<_>>()
            || current_counts.get(work_id).copied().unwrap_or_default() != 1
        {
            return Err("备份中的参考作品版本序列或当前版本无效".to_string());
        }
    }

    let mut section_orders = HashMap::<String, Vec<i64>>::new();
    for row in sections {
        let import_id = required_backup_str(row, "reference_import_id", "reference_sections")?;
        let work_id = required_backup_str(row, "reference_work_id", "reference_sections")?;
        if import_scope.get(import_id).map(String::as_str) != Some(work_id)
            || required_backup_str(row, "novel_id", "reference_sections")? != novel_id
        {
            return Err("备份中的参考章节越过导入作用域".to_string());
        }
        let section_id = required_backup_str(row, "id", "reference_sections")?;
        let content = required_backup_str(row, "content", "reference_sections")?;
        let content_hash = required_backup_str(row, "content_hash", "reference_sections")?;
        if !valid_backup_hash(content_hash) {
            return Err("备份中的参考章节正文哈希无效".to_string());
        }
        let expected_chars = required_backup_i64(row, "char_count", "reference_sections")?;
        let expected_bytes = required_backup_i64(row, "utf8_byte_count", "reference_sections")?;
        if let Some(document_id) = row.get("large_text_ref_id").and_then(JsonValue::as_str) {
            let document = documents
                .get(document_id)
                .ok_or_else(|| "备份中的参考章节缺少大文本正文".to_string())?;
            if document.get("content_sha256").and_then(JsonValue::as_str) != Some(content_hash)
                || document.get("target_type").and_then(JsonValue::as_str)
                    != Some("reference_section")
                || document.get("target_id").and_then(JsonValue::as_str) != Some(section_id)
                || document.get("field_name").and_then(JsonValue::as_str) != Some("content")
                || document.get("total_chars").and_then(JsonValue::as_i64) != Some(expected_chars)
                || document.get("total_bytes").and_then(JsonValue::as_i64) != Some(expected_bytes)
                || content.chars().count() as i64 > expected_chars
                || content.len() as i64 > expected_bytes
            {
                return Err("备份中的参考章节大文本身份不一致".to_string());
            }
        } else if backup_text_hash(content) != content_hash
            || content.chars().count() as i64 != expected_chars
            || content.len() as i64 != expected_bytes
        {
            return Err("备份中的参考章节正文已被篡改".to_string());
        }
        section_orders
            .entry(import_id.to_string())
            .or_default()
            .push(required_backup_i64(
                row,
                "order_index",
                "reference_sections",
            )?);
    }
    for (import_id, expected_count) in expected_sections {
        let mut orders = section_orders.remove(&import_id).unwrap_or_default();
        orders.sort_unstable();
        if orders.len() as i64 != expected_count
            || orders != (1..=expected_count).collect::<Vec<_>>()
        {
            return Err("备份中的参考章节序列不完整".to_string());
        }
    }
    Ok(())
}

fn backup_vector_hash(vector: &[f32]) -> String {
    let mut hasher = Sha256::new();
    hasher.update((vector.len() as u64).to_le_bytes());
    for value in vector {
        hasher.update(value.to_le_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn validate_backup_memory(backup: &ProjectBackup) -> Result<(), String> {
    if backup.schema_version < 7 {
        return Ok(());
    }
    let novel_id = required_backup_str(&backup.novel, "id", "novels")?;
    let documents = backup
        .tables
        .get("memory_documents")
        .ok_or_else(|| "备份缺少 memory_documents".to_string())?;
    let chunks = backup
        .tables
        .get("memory_chunks")
        .ok_or_else(|| "备份缺少 memory_chunks".to_string())?;
    let embeddings = backup
        .tables
        .get("memory_embeddings")
        .ok_or_else(|| "备份缺少 memory_embeddings".to_string())?;
    let logs = backup
        .tables
        .get("memory_retrieval_logs")
        .ok_or_else(|| "备份缺少 memory_retrieval_logs".to_string())?;
    let chapter_ids = backup
        .tables
        .get("chapters")
        .into_iter()
        .flatten()
        .filter_map(|row| row.get("id").and_then(JsonValue::as_str))
        .collect::<HashSet<_>>();
    let adopted_draft_ids = backup
        .tables
        .get("chapter_drafts")
        .into_iter()
        .flatten()
        .filter_map(|row| row.get("id").and_then(JsonValue::as_str))
        .collect::<HashSet<_>>();
    let source_tables = [
        ("adopted_draft", "chapter_drafts"),
        ("chapter_summary", "chapter_summaries"),
        ("context_record", "context_records"),
    ];
    let source_ids = source_tables
        .iter()
        .map(|(source_type, table)| {
            let ids = backup
                .tables
                .get(*table)
                .into_iter()
                .flatten()
                .filter_map(|row| row.get("id").and_then(JsonValue::as_str))
                .collect::<HashSet<_>>();
            (*source_type, ids)
        })
        .collect::<HashMap<_, _>>();

    let mut document_scope = HashMap::<String, (&str, &str)>::new();
    let mut active_sources = HashSet::<(&str, &str)>::new();
    for row in documents {
        let id = required_backup_str(row, "id", "memory_documents")?;
        if required_backup_str(row, "novel_id", "memory_documents")? != novel_id {
            return Err("备份中的 Memory 文档越过小说作用域".to_string());
        }
        let source_type = required_backup_str(row, "source_type", "memory_documents")?;
        let source_id = required_backup_str(row, "source_id", "memory_documents")?;
        if !source_ids
            .get(source_type)
            .is_some_and(|ids| ids.contains(source_id))
        {
            return Err("备份中的 Memory 来源不存在".to_string());
        }
        let source_hash = required_backup_str(row, "source_hash", "memory_documents")?;
        if !valid_backup_hash(source_hash)
            || required_backup_i64(row, "source_version", "memory_documents")? < 1
        {
            return Err("备份中的 Memory 来源版本或哈希无效".to_string());
        }
        let adopted_draft_id = required_backup_str(row, "adopted_draft_id", "memory_documents")?;
        let chapter_id = required_backup_str(row, "chapter_id", "memory_documents")?;
        if !adopted_draft_ids.contains(adopted_draft_id) || !chapter_ids.contains(chapter_id) {
            return Err("备份中的 Memory 采用稿或章节身份无效".to_string());
        }
        let status = required_backup_str(row, "status", "memory_documents")?;
        if !matches!(status, "active" | "invalidated") {
            return Err("备份中的 Memory 文档状态无效".to_string());
        }
        if status == "active" && !active_sources.insert((source_type, source_id)) {
            return Err("备份中的 Memory 来源存在多个有效版本".to_string());
        }
        let metadata = required_backup_str(row, "metadata_json", "memory_documents")?;
        if !serde_json::from_str::<JsonValue>(metadata).is_ok_and(|value| value.is_object()) {
            return Err("备份中的 Memory 文档元数据无效".to_string());
        }
        document_scope.insert(id.to_string(), (chapter_id, adopted_draft_id));
    }

    let mut chunk_scope = HashMap::<String, (&str, &str)>::new();
    let mut ordinals = HashMap::<&str, Vec<i64>>::new();
    for row in chunks {
        let id = required_backup_str(row, "id", "memory_chunks")?;
        if required_backup_str(row, "novel_id", "memory_chunks")? != novel_id {
            return Err("备份中的 Memory 分块越过小说作用域".to_string());
        }
        let document_id = required_backup_str(row, "document_id", "memory_chunks")?;
        let chapter_id = required_backup_str(row, "chapter_id", "memory_chunks")?;
        if document_scope.get(document_id).map(|scope| scope.0) != Some(chapter_id) {
            return Err("备份中的 Memory 分块归属无效".to_string());
        }
        let text = required_backup_str(row, "text", "memory_chunks")?;
        let content_hash = required_backup_str(row, "content_hash", "memory_chunks")?;
        if backup_text_hash(text) != content_hash
            || required_backup_i64(row, "token_count", "memory_chunks")? < 1
        {
            return Err("备份中的 Memory 分块正文或 Token 统计无效".to_string());
        }
        let entity_keys = required_backup_str(row, "entity_keys_json", "memory_chunks")?;
        let metadata = required_backup_str(row, "metadata_json", "memory_chunks")?;
        if !serde_json::from_str::<JsonValue>(entity_keys).is_ok_and(|value| value.is_array())
            || !serde_json::from_str::<JsonValue>(metadata).is_ok_and(|value| value.is_object())
        {
            return Err("备份中的 Memory 分块结构化元数据无效".to_string());
        }
        ordinals
            .entry(document_id)
            .or_default()
            .push(required_backup_i64(row, "ordinal", "memory_chunks")?);
        chunk_scope.insert(id.to_string(), (document_id, content_hash));
    }
    for values in ordinals.values_mut() {
        values.sort_unstable();
        if *values != (0..values.len() as i64).collect::<Vec<_>>() {
            return Err("备份中的 Memory 分块序号不连续".to_string());
        }
    }

    let mut model_dimensions = HashMap::<(&str, &str), i64>::new();
    for row in embeddings {
        if required_backup_str(row, "novel_id", "memory_embeddings")? != novel_id {
            return Err("备份中的 Memory Embedding 越过小说作用域".to_string());
        }
        let chunk_id = required_backup_str(row, "chunk_id", "memory_embeddings")?;
        let chunk_content_hash =
            required_backup_str(row, "chunk_content_hash", "memory_embeddings")?;
        if chunk_scope.get(chunk_id).map(|scope| scope.1) != Some(chunk_content_hash) {
            return Err("备份中的 Memory Embedding 分块哈希无效".to_string());
        }
        let provider = required_backup_str(row, "provider", "memory_embeddings")?;
        let model = required_backup_str(row, "model", "memory_embeddings")?;
        let dimension = required_backup_i64(row, "dimension", "memory_embeddings")?;
        if dimension < 1 || dimension > 8192 {
            return Err("备份中的 Memory Embedding 维度无效".to_string());
        }
        if let Some(existing) = model_dimensions.insert((provider, model), dimension) {
            if existing != dimension {
                return Err("备份中的同一 Embedding 模型存在多个维度".to_string());
            }
        }
        let vector_json = required_backup_str(row, "vector_json", "memory_embeddings")?;
        let vector = serde_json::from_str::<Vec<f32>>(vector_json)
            .map_err(|_| "备份中的 Memory Embedding 向量格式无效".to_string())?;
        if vector.len() != dimension as usize || vector.iter().any(|value| !value.is_finite()) {
            return Err("备份中的 Memory Embedding 向量维度无效".to_string());
        }
        let norm = vector
            .iter()
            .map(|value| f64::from(*value).powi(2))
            .sum::<f64>()
            .sqrt();
        let stored_norm = row
            .get("vector_norm")
            .and_then(JsonValue::as_f64)
            .ok_or_else(|| "备份中的 Memory Embedding 范数无效".to_string())?;
        if norm <= f64::EPSILON
            || (norm - stored_norm).abs() > 1e-6
            || backup_vector_hash(&vector)
                != required_backup_str(row, "vector_hash", "memory_embeddings")?
        {
            return Err("备份中的 Memory Embedding 完整性校验失败".to_string());
        }
    }

    for row in logs {
        if required_backup_str(row, "novel_id", "memory_retrieval_logs")? != novel_id {
            return Err("备份中的 Memory 检索日志越过小说作用域".to_string());
        }
        let selected = serde_json::from_str::<Vec<String>>(required_backup_str(
            row,
            "selected_chunk_ids_json",
            "memory_retrieval_logs",
        )?)
        .map_err(|_| "备份中的 Memory 检索结果无效".to_string())?;
        if selected
            .iter()
            .any(|chunk_id| !chunk_scope.contains_key(chunk_id))
        {
            return Err("备份中的 Memory 检索日志引用未知分块".to_string());
        }
        let reasons = serde_json::from_str::<JsonValue>(required_backup_str(
            row,
            "score_reasons_json",
            "memory_retrieval_logs",
        )?)
        .map_err(|_| "备份中的 Memory 评分原因无效".to_string())?;
        if !reasons.is_array() {
            return Err("备份中的 Memory 评分原因无效".to_string());
        }
    }
    Ok(())
}

fn collect_ids_from_rows(rows: &[BackupRow], ids: &mut HashMap<String, String>) {
    for row in rows {
        for column in IDENTITY_COLUMNS {
            if let Some(id) = row.get(*column).and_then(JsonValue::as_str) {
                ids.entry(id.to_string())
                    .or_insert_with(|| uuid::Uuid::new_v4().to_string());
            }
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
            let remapped = if matches!(
                column.as_str(),
                "cover_path" | "file_path" | "source_file_path"
            ) {
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

fn parsed_json_column(row: &BackupRow, table: &str, column: &str) -> Result<JsonValue, String> {
    let raw = row
        .get(column)
        .and_then(JsonValue::as_str)
        .ok_or_else(|| format!("备份中的 {table}.{column} 无效"))?;
    serde_json::from_str(raw).map_err(|error| format!("备份中的 {table}.{column} 无效：{error}"))
}

fn canonical_value_hash(value: &JsonValue) -> Result<String, String> {
    ai_fact_security::canonical_json(value)
        .map(|canonical| backup_text_hash(&canonical))
        .map_err(|error| error.to_string())
}

fn refresh_restored_ai_fact_hashes(
    tables: &mut BTreeMap<String, Vec<BackupRow>>,
    id_map: &HashMap<String, String>,
) -> Result<(), String> {
    let document_hashes = tables
        .get(LARGE_TEXT_DOCUMENTS)
        .into_iter()
        .flatten()
        .filter_map(|row| {
            let id = row.get("id")?.as_str()?;
            let hash = row.get("content_sha256")?.as_str()?;
            let remapped = id_map.get(id).cloned().unwrap_or_else(|| id.to_string());
            Some((remapped, hash.to_string()))
        })
        .collect::<HashMap<_, _>>();

    let mut input_hashes = HashMap::new();
    if let Some(rows) = tables.get_mut("ai_input_snapshots") {
        for source in rows.iter_mut() {
            let mut row = remap_row(source, id_map);
            let body_ref = required_backup_str(&row, "body_ref_id", "ai_input_snapshots")?;
            let body_hash = document_hashes
                .get(body_ref)
                .ok_or_else(|| "备份中的 AI Input Snapshot 缺少正文".to_string())?;
            let value = serde_json::json!({
                "schemaVersion": required_backup_i64(&row, "schema_version", "ai_input_snapshots")?,
                "inputType": required_backup_str(&row, "input_type", "ai_input_snapshots")?,
                "payload": parsed_json_column(&row, "ai_input_snapshots", "payload_json")?,
                "bodyHash": body_hash,
                "sourceDraftId": row.get("source_draft_id").cloned().unwrap_or(JsonValue::Null),
                "sourceDraftVersion": row.get("source_draft_version").cloned().unwrap_or(JsonValue::Null),
                "baseContentHash": row.get("base_content_hash").cloned().unwrap_or(JsonValue::Null),
            });
            let hash = canonical_value_hash(&value)?;
            row.insert("content_hash".to_string(), JsonValue::String(hash.clone()));
            input_hashes.insert(
                required_backup_str(&row, "task_id", "ai_input_snapshots")?.to_string(),
                hash,
            );
            *source = row;
        }
    }

    let mut context_hashes = HashMap::new();
    if let Some(rows) = tables.get_mut("ai_context_snapshots") {
        for source in rows.iter_mut() {
            let mut row = remap_row(source, id_map);
            let compiled_ref =
                required_backup_str(&row, "compiled_context_ref_id", "ai_context_snapshots")?;
            let compiled_hash = document_hashes
                .get(compiled_ref)
                .ok_or_else(|| "备份中的 AI Context Snapshot 缺少编译正文".to_string())?;
            let value = serde_json::json!({
                "schemaVersion": required_backup_i64(&row, "schema_version", "ai_context_snapshots")?,
                "sourceManifest": parsed_json_column(&row, "ai_context_snapshots", "source_manifest_json")?,
                "compiledContextHash": compiled_hash,
                "budget": parsed_json_column(&row, "ai_context_snapshots", "budget_json")?,
                "compilerVersion": required_backup_str(&row, "compiler_version", "ai_context_snapshots")?,
            });
            let hash = canonical_value_hash(&value)?;
            row.insert("content_hash".to_string(), JsonValue::String(hash.clone()));
            context_hashes.insert(
                required_backup_str(&row, "task_id", "ai_context_snapshots")?.to_string(),
                hash,
            );
            *source = row;
        }
    }

    let mut constraint_hashes = HashMap::new();
    if let Some(rows) = tables.get_mut("ai_constraint_snapshots") {
        for source in rows.iter_mut() {
            let mut row = remap_row(source, id_map);
            let template_ref =
                required_backup_str(&row, "prompt_template_ref_id", "ai_constraint_snapshots")?;
            let template_hash = document_hashes
                .get(template_ref)
                .ok_or_else(|| "备份中的 AI Constraint Snapshot 缺少提示词正文".to_string())?;
            let value = serde_json::json!({
                "schemaVersion": required_backup_i64(&row, "schema_version", "ai_constraint_snapshots")?,
                "payload": parsed_json_column(&row, "ai_constraint_snapshots", "payload_json")?,
                "promptTemplateId": required_backup_str(&row, "prompt_template_id", "ai_constraint_snapshots")?,
                "promptTemplateVersion": required_backup_str(&row, "prompt_template_version", "ai_constraint_snapshots")?,
                "declaredPromptTemplateHash": required_backup_str(&row, "prompt_template_hash", "ai_constraint_snapshots")?,
                "actualPromptTemplateHash": template_hash,
                "providerOptions": parsed_json_column(&row, "ai_constraint_snapshots", "provider_options_json")?,
            });
            let hash = canonical_value_hash(&value)?;
            row.insert("content_hash".to_string(), JsonValue::String(hash.clone()));
            constraint_hashes.insert(
                required_backup_str(&row, "task_id", "ai_constraint_snapshots")?.to_string(),
                hash,
            );
            *source = row;
        }
    }

    if let Some(rows) = tables.get_mut("ai_tasks") {
        for source in rows.iter_mut() {
            let mut row = remap_row(source, id_map);
            let task_id = required_backup_str(&row, "task_id", "ai_tasks")?;
            let target_hint = match row.get("target_hint_json") {
                Some(JsonValue::String(raw)) => serde_json::from_str(raw)
                    .map_err(|error| format!("备份中的 ai_tasks.target_hint_json 无效：{error}"))?,
                _ => JsonValue::Null,
            };
            let request = serde_json::json!({
                "requestContractVersion": required_backup_i64(&row, "request_hash_version", "ai_tasks")?,
                "taskType": required_backup_str(&row, "task_type", "ai_tasks")?,
                "scopeType": required_backup_str(&row, "scope_type", "ai_tasks")?,
                "novelId": required_backup_str(&row, "novel_id", "ai_tasks")?,
                "chapterId": row.get("chapter_id").cloned().unwrap_or(JsonValue::Null),
                "draftId": row.get("draft_id").cloned().unwrap_or(JsonValue::Null),
                "expectedArtifactType": required_backup_str(&row, "expected_artifact_type", "ai_tasks")?,
                "expectedArtifactSchemaVersion": required_backup_i64(&row, "expected_artifact_schema_version", "ai_tasks")?,
                "targetHint": target_hint,
                "inputSnapshotHash": input_hashes.get(task_id).ok_or_else(|| "备份中的 AI Task 缺少 Input Snapshot".to_string())?,
                "contextSnapshotHash": context_hashes.get(task_id).ok_or_else(|| "备份中的 AI Task 缺少 Context Snapshot".to_string())?,
                "constraintSnapshotHash": constraint_hashes.get(task_id).ok_or_else(|| "备份中的 AI Task 缺少 Constraint Snapshot".to_string())?,
            });
            row.insert(
                "request_hash".to_string(),
                JsonValue::String(canonical_value_hash(&request)?),
            );
            *source = row;
        }
    }
    Ok(())
}

fn refresh_restored_autonomous_plan(mut row: BackupRow) -> Result<BackupRow, String> {
    let plan_json = row
        .get("plan_json")
        .and_then(JsonValue::as_str)
        .ok_or_else(|| "autonomous_story_plans.plan_json is missing".to_string())?;
    let mut plan = serde_json::from_str::<JsonValue>(plan_json)
        .map_err(|error| format!("autonomous_story_plans.plan_json is invalid: {error}"))?;
    let (canonical_plan, plan_hash) =
        autonomous_story_service::refresh_restored_plan_hashes(&mut plan)
            .map_err(|error| error.to_string())?;
    let request_hash = plan
        .get("requestHash")
        .and_then(JsonValue::as_str)
        .ok_or_else(|| "restored autonomous plan requestHash is missing".to_string())?
        .to_string();

    for (column, plan_key) in [
        ("plan_id", "planId"),
        ("operation_id", "operationId"),
        ("novel_id", "novelId"),
    ] {
        if row.get(column).and_then(JsonValue::as_str)
            != plan.get(plan_key).and_then(JsonValue::as_str)
        {
            return Err(format!(
                "autonomous_story_plans.{column} does not match plan_json.{plan_key}"
            ));
        }
    }

    row.insert("request_hash".to_string(), JsonValue::String(request_hash));
    row.insert("plan_json".to_string(), JsonValue::String(canonical_plan));
    row.insert("plan_hash".to_string(), JsonValue::String(plan_hash));
    Ok(row)
}

fn canonicalize_backup_json(row: &mut BackupRow, column: &str) -> Result<Option<String>, String> {
    let Some(value) = row.get(column) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let text = value
        .as_str()
        .ok_or_else(|| format!("{column} is not JSON text"))?;
    let parsed = serde_json::from_str::<JsonValue>(text)
        .map_err(|error| format!("{column} is invalid JSON: {error}"))?;
    let canonical = ai_fact_security::canonical_json(&parsed).map_err(|error| error.to_string())?;
    row.insert(column.to_string(), JsonValue::String(canonical.clone()));
    Ok(Some(canonical))
}

fn refresh_restored_scheduler_row(table: &str, mut row: BackupRow) -> Result<BackupRow, String> {
    let now = chrono::Utc::now().to_rfc3339();
    match table {
        "autonomous_book_runs" => {
            let policy_json = canonicalize_backup_json(&mut row, "policy_json")?
                .ok_or_else(|| "restored scheduler policy is missing".to_string())?;
            let policy = serde_json::from_str::<AutonomousAutomationPolicy>(&policy_json)
                .map_err(|error| format!("restored scheduler policy is invalid: {error}"))?;
            let total_chapters = required_backup_i64(&row, "total_chapters", table)?;
            policy
                .validate(total_chapters)
                .map_err(|error| error.to_string())?;
            let policy_hash = backup_text_hash(&policy_json);
            let novel_id = required_backup_str(&row, "novel_id", table)?;
            let plan_id = required_backup_str(&row, "plan_id", table)?;
            let request_hash = ai_fact_security::canonical_hash(&serde_json::json!({
                "novelId": novel_id,
                "planId": plan_id,
                "policyHash": policy_hash,
            }))
            .map_err(|error| error.to_string())?;
            row.insert("policy_hash".to_string(), JsonValue::String(policy_hash));
            row.insert("request_hash".to_string(), JsonValue::String(request_hash));
            if row.get("status").and_then(JsonValue::as_str) == Some("running") {
                row.insert(
                    "status".to_string(),
                    JsonValue::String("queued".to_string()),
                );
                row.insert(
                    "pause_reason".to_string(),
                    JsonValue::String("restored_without_active_lease".to_string()),
                );
                row.insert("updated_at".to_string(), JsonValue::String(now));
            }
        }
        "autonomous_run_leases" => {
            row.insert(
                "status".to_string(),
                JsonValue::String("expired".to_string()),
            );
            row.insert("expires_at".to_string(), JsonValue::String(now.clone()));
            row.insert("released_at".to_string(), JsonValue::String(now));
            row.insert(
                "owner_id".to_string(),
                JsonValue::String("restored-project".to_string()),
            );
            let lease_id = required_backup_str(&row, "lease_id", table)?;
            row.insert(
                "token_hash".to_string(),
                JsonValue::String(backup_text_hash(lease_id)),
            );
        }
        "autonomous_run_chapter_attempts" => {
            if let Some(decision_json) = canonicalize_backup_json(&mut row, "decision_json")? {
                row.insert(
                    "decision_hash".to_string(),
                    JsonValue::String(backup_text_hash(&decision_json)),
                );
            }
            let _ = canonicalize_backup_json(&mut row, "error_json")?;
            if row.get("status").and_then(JsonValue::as_str) == Some("claimed") {
                row.insert(
                    "status".to_string(),
                    JsonValue::String("abandoned".to_string()),
                );
                row.insert("finished_at".to_string(), JsonValue::String(now));
                let error = ai_fact_security::canonical_json(&serde_json::json!({
                    "code": "RESTORED_INTERRUPTED_ATTEMPT",
                    "retryable": true,
                }))
                .map_err(|error| error.to_string())?;
                row.insert("error_json".to_string(), JsonValue::String(error));
            }
        }
        "autonomous_run_checkpoints" => {
            let payload_json = canonicalize_backup_json(&mut row, "payload_json")?
                .ok_or_else(|| "restored scheduler checkpoint payload is missing".to_string())?;
            row.insert(
                "payload_hash".to_string(),
                JsonValue::String(backup_text_hash(&payload_json)),
            );
        }
        _ => {}
    }
    Ok(row)
}

fn order_location_rows(rows: &[BackupRow]) -> Result<Vec<BackupRow>, String> {
    let all_ids = rows
        .iter()
        .filter_map(|row| row.get("id").and_then(JsonValue::as_str))
        .collect::<HashSet<_>>();
    let mut pending = rows.to_vec();
    let mut inserted = HashSet::<String>::new();
    let mut ordered = Vec::with_capacity(rows.len());
    while !pending.is_empty() {
        let before = pending.len();
        let mut index = 0;
        while index < pending.len() {
            let parent = pending[index]
                .get("parent_location_id")
                .and_then(JsonValue::as_str)
                .filter(|value| !value.is_empty());
            if parent.is_none() || parent.is_some_and(|id| inserted.contains(id)) {
                let row = pending.remove(index);
                if let Some(id) = row.get("id").and_then(JsonValue::as_str) {
                    inserted.insert(id.to_string());
                }
                ordered.push(row);
            } else {
                index += 1;
            }
        }
        if pending.len() == before {
            let missing = pending
                .iter()
                .filter_map(|row| row.get("parent_location_id").and_then(JsonValue::as_str))
                .find(|parent| !all_ids.contains(parent));
            return Err(if missing.is_some() {
                "备份中的地点引用了缺失的上级地点".to_string()
            } else {
                "备份中的地点层级存在循环".to_string()
            });
        }
    }
    Ok(ordered)
}

fn insert_rows(
    tx: &Transaction<'_>,
    table: &str,
    rows: &[BackupRow],
    id_map: &HashMap<String, String>,
) -> Result<usize, String> {
    let mut inserted = 0;
    let ordered_rows = if table == "locations" {
        order_location_rows(rows)?
    } else {
        rows.to_vec()
    };
    for row in &ordered_rows {
        let mut row = remap_row(row, id_map);
        if table == "ai_tasks"
            && row
                .get("result_artifact_id")
                .and_then(JsonValue::as_str)
                .is_some()
            && matches!(
                row.get("status").and_then(JsonValue::as_str),
                Some("completed" | "failed")
            )
        {
            row.insert(
                "status".to_string(),
                JsonValue::String("validating".to_string()),
            );
        }
        let row = if is_autonomous_story_table(table) {
            refresh_restored_autonomous_plan(row)?
        } else if is_autonomous_scheduler_table(table) {
            refresh_restored_scheduler_row(table, row)?
        } else {
            row
        };
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
        // large_text_documents/large_text_chunks persist Unicode scalar counts,
        // matching Rust `chars()` and the writer/reader integrity contract.
        let actual_chars = content.chars().count() as i64;
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

fn enter_workbench_restore_mode(tx: &Transaction<'_>) -> Result<(), String> {
    tx.execute_batch(
        "DROP TRIGGER IF EXISTS trg_task_runs_validate_insert;
         DROP TRIGGER IF EXISTS trg_tool_call_events_validate_insert;",
    )
    .map_err(|error| format!("进入任务事实恢复模式失败：{error}"))
}

fn leave_workbench_restore_mode(tx: &Transaction<'_>) -> Result<(), String> {
    tx.execute_batch(
        "CREATE TRIGGER IF NOT EXISTS trg_task_runs_validate_insert
            BEFORE INSERT ON task_runs
            WHEN NEW.status <> 'queued'
              OR json_valid(NEW.model_snapshot_json) = 0
              OR json_type(NEW.model_snapshot_json) <> 'object'
              OR NOT EXISTS (
                  SELECT 1 FROM conversation_turns
                  WHERE turn_id = NEW.turn_id
                    AND conversation_id = NEW.conversation_id
                    AND role = 'user'
              )
            BEGIN SELECT RAISE(ABORT, 'invalid task run scope or snapshot'); END;
         CREATE TRIGGER IF NOT EXISTS trg_tool_call_events_validate_insert
            BEFORE INSERT ON tool_call_events
            WHEN NEW.status NOT IN ('pending', 'queued', 'running')
              OR NEW.sequence < 0
              OR json_valid(NEW.arguments_summary_json) = 0
              OR json_type(NEW.arguments_summary_json) <> 'object'
              OR NOT EXISTS (
                  SELECT 1 FROM task_runs
                  WHERE run_id = NEW.run_id
                    AND status IN ('queued', 'running', 'cancel_requested')
              )
            BEGIN SELECT RAISE(ABORT, 'invalid tool call event'); END;",
    )
    .map_err(|error| format!("退出任务事实恢复模式失败：{error}"))
}

pub fn restore_project_backup_in_conn(
    conn: &mut Connection,
    backup: &ProjectBackup,
) -> Result<ImportProjectBackupResult, String> {
    validate_backup(conn, backup)?;
    let id_map = build_id_map(backup)?;
    let mut restored_tables = backup.tables.clone();
    refresh_restored_ai_fact_hashes(&mut restored_tables, &id_map)?;
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
    tx.execute_batch("PRAGMA defer_foreign_keys = ON;")
        .map_err(|error| format!("启用备份恢复延迟外键失败：{error}"))?;
    enter_workbench_restore_mode(&tx)?;
    let novel_rows = vec![backup.novel.clone()];
    insert_rows(&tx, "novels", &novel_rows, &id_map)?;

    let mut restored_records = BTreeMap::new();
    restored_records.insert("novels".to_string(), 1);
    for table in INSERT_ORDER {
        let rows = match restored_tables.get(*table) {
            Some(rows) => rows,
            None if backup.schema_version == 2 && *table == "quality_issue_states" => {
                let inserted = restore_legacy_quality_issue_states(&tx, &new_novel_id)?;
                restored_records.insert((*table).to_string(), inserted);
                continue;
            }
            None if backup.schema_version < 4 && is_multi_agent_table(table) => {
                restored_records.insert((*table).to_string(), 0);
                continue;
            }
            None if backup.schema_version < 5 && is_autonomous_story_table(table) => {
                restored_records.insert((*table).to_string(), 0);
                continue;
            }
            None if backup.schema_version < 6 && is_reference_library_table(table) => {
                restored_records.insert((*table).to_string(), 0);
                continue;
            }
            None if backup.schema_version < 7 && is_memory_table(table) => {
                restored_records.insert((*table).to_string(), 0);
                continue;
            }
            None if backup.schema_version < 8 && is_autonomous_scheduler_table(table) => {
                restored_records.insert((*table).to_string(), 0);
                continue;
            }
            None if backup.schema_version < 9 && is_story_asset_table(table) => {
                restored_records.insert((*table).to_string(), 0);
                continue;
            }
            None if backup.schema_version < 10 && is_conversation_workbench_table(table) => {
                restored_records.insert((*table).to_string(), 0);
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

    // ResultArtifact insertion is guarded by the task's `validating` edge.
    // Restore the source terminal edge only after every referenced artifact has
    // been inserted and validated.
    if let Some(rows) = restored_tables.get("ai_tasks") {
        for source in rows {
            let Some(source_status) = source.get("status").and_then(JsonValue::as_str) else {
                continue;
            };
            let Some(source_artifact_id) =
                source.get("result_artifact_id").and_then(JsonValue::as_str)
            else {
                continue;
            };
            if !matches!(source_status, "completed" | "failed") {
                continue;
            }
            let task_id = source
                .get("task_id")
                .and_then(JsonValue::as_str)
                .ok_or_else(|| "备份中的 AI Task 缺少 task_id".to_string())?;
            let artifact_id = source_artifact_id;
            tx.execute(
                "UPDATE ai_tasks SET status=?2, result_artifact_id=?3 WHERE task_id=?1",
                params![task_id, source_status, artifact_id],
            )
            .map_err(|error| format!("恢复 AI Task 终态失败：{error}"))?;
        }
    }

    let document_ids = restored_tables
        .get(LARGE_TEXT_DOCUMENTS)
        .into_iter()
        .flatten()
        .filter_map(|row| row.get("id").and_then(JsonValue::as_str))
        .filter_map(|id| id_map.get(id).cloned())
        .collect::<Vec<_>>();
    validate_large_text_integrity(&tx, &document_ids)?;
    validate_foreign_keys(&tx)?;
    leave_workbench_restore_mode(&tx)?;
    tx.commit().map_err(|error| error.to_string())?;

    Ok(ImportProjectBackupResult {
        novel_id: new_novel_id,
        title,
        restored_records,
        id_map: id_map.into_iter().collect(),
    })
}

fn ids_from_rows(rows: &[BackupRow], identity_column: &str) -> Vec<String> {
    rows.iter()
        .filter_map(|row| {
            row.get(identity_column)
                .and_then(JsonValue::as_str)
                .map(str::to_string)
        })
        .collect()
}

fn deletion_identity_column(table: &str) -> &'static str {
    if is_multi_agent_table(table) {
        "session_id"
    } else if is_autonomous_story_table(table) {
        "plan_id"
    } else if table == "autonomous_book_runs" {
        "run_id"
    } else if table == "autonomous_run_leases" {
        "lease_id"
    } else if table == "autonomous_run_chapter_attempts" {
        "attempt_id"
    } else if table == "autonomous_run_checkpoints" {
        "checkpoint_id"
    } else {
        "id"
    }
}

fn delete_rows_by_ids(
    tx: &Transaction<'_>,
    table: &str,
    identity_column: &str,
    ids: &[String],
) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    for batch in ids.chunks(SQLITE_BIND_BATCH_SIZE) {
        let placeholders = std::iter::repeat("?")
            .take(batch.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!("DELETE FROM {table} WHERE {identity_column} IN ({placeholders})");
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

fn delete_location_rows(tx: &Transaction<'_>, rows: &[BackupRow]) -> Result<(), String> {
    let ordered = order_location_rows(rows)?;
    for row in ordered.iter().rev() {
        let id = required_backup_str(row, "id", "locations")?;
        tx.execute("DELETE FROM locations WHERE id = ?1", params![id])
            .map_err(|error| format!("failed to purge locations: {error}"))?;
    }
    Ok(())
}

fn purge_conversation_workbench_facts(tx: &Transaction<'_>, novel_id: &str) -> Result<(), String> {
    tx.execute(
        "DELETE FROM review_authorizations WHERE novel_id=?1",
        params![novel_id],
    )
    .map_err(|error| format!("清理审阅授权失败：{error}"))?;
    tx.execute(
        "DELETE FROM artifact_decisions
         WHERE conversation_id IN (SELECT conversation_id FROM task_conversations WHERE novel_id=?1)",
        params![novel_id],
    )
    .map_err(|error| format!("清理产物决定失败：{error}"))?;
    tx.execute(
        "DELETE FROM conversation_artifact_cards
         WHERE conversation_id IN (SELECT conversation_id FROM task_conversations WHERE novel_id=?1)",
        params![novel_id],
    )
    .map_err(|error| format!("清理任务产物卡片失败：{error}"))?;
    tx.execute(
        "DELETE FROM artifact_validation_issues
         WHERE artifact_id IN (
             SELECT artifact_id FROM result_artifacts
             WHERE task_id IN (SELECT task_id FROM ai_tasks WHERE novel_id=?1)
         )",
        params![novel_id],
    )
    .map_err(|error| format!("清理任务产物校验事实失败：{error}"))?;
    tx.execute(
        "DELETE FROM result_artifacts
         WHERE task_id IN (SELECT task_id FROM ai_tasks WHERE novel_id=?1)",
        params![novel_id],
    )
    .map_err(|error| format!("清理任务 ResultArtifact 失败：{error}"))?;
    tx.execute(
        "DELETE FROM ai_task_attempts
         WHERE task_id IN (SELECT task_id FROM ai_tasks WHERE novel_id=?1)",
        params![novel_id],
    )
    .map_err(|error| format!("清理任务 Attempt 失败：{error}"))?;
    for table in [
        "ai_input_snapshots",
        "ai_context_snapshots",
        "ai_constraint_snapshots",
    ] {
        tx.execute(
            &format!(
                "DELETE FROM {table} WHERE task_id IN (SELECT task_id FROM ai_tasks WHERE novel_id=?1)"
            ),
            params![novel_id],
        )
        .map_err(|error| format!("清理任务 Snapshot 失败：{error}"))?;
    }
    tx.execute("DELETE FROM ai_tasks WHERE novel_id=?1", params![novel_id])
        .map_err(|error| format!("清理 AI Task 失败：{error}"))?;
    tx.execute(
        "DELETE FROM tool_call_events
         WHERE run_id IN (
             SELECT run_id FROM task_runs
             WHERE conversation_id IN (SELECT conversation_id FROM task_conversations WHERE novel_id=?1)
         )",
        params![novel_id],
    )
    .map_err(|error| format!("清理任务工具事件失败：{error}"))?;
    tx.execute(
        "DELETE FROM task_runs
         WHERE conversation_id IN (SELECT conversation_id FROM task_conversations WHERE novel_id=?1)",
        params![novel_id],
    )
    .map_err(|error| format!("清理任务运行失败：{error}"))?;
    tx.execute(
        "DELETE FROM conversation_turns
         WHERE conversation_id IN (SELECT conversation_id FROM task_conversations WHERE novel_id=?1)",
        params![novel_id],
    )
    .map_err(|error| format!("清理任务回合失败：{error}"))?;
    tx.execute(
        "DELETE FROM task_conversations WHERE novel_id=?1",
        params![novel_id],
    )
    .map_err(|error| format!("清理任务对话失败：{error}"))?;
    Ok(())
}

pub(crate) fn purge_project_in_tx(tx: &Transaction<'_>, novel_id: &str) -> Result<(), String> {
    let backup = export_project_backup_in_conn(&*tx, novel_id)?;
    tx.execute_batch(
        "PRAGMA defer_foreign_keys = ON;
         DROP TRIGGER IF EXISTS trg_autonomous_run_checkpoints_append_only_delete;
         DROP TRIGGER IF EXISTS trg_conversation_turns_append_only_delete;
         DROP TRIGGER IF EXISTS trg_ai_tasks_no_delete;
         DROP TRIGGER IF EXISTS trg_ai_task_attempts_no_delete;
         DROP TRIGGER IF EXISTS trg_ai_input_snapshots_immutable_delete;
         DROP TRIGGER IF EXISTS trg_ai_context_snapshots_immutable_delete;
         DROP TRIGGER IF EXISTS trg_ai_constraint_snapshots_immutable_delete;
         DROP TRIGGER IF EXISTS trg_result_artifacts_immutable_delete;
         DROP TRIGGER IF EXISTS trg_artifact_validation_issues_append_only_delete;",
    )
    .map_err(|error| format!("进入项目清理维护模式失败：{error}"))?;
    purge_conversation_workbench_facts(tx, novel_id)?;
    for table in DELETE_ORDER {
        if *table == LARGE_TEXT_CHUNKS {
            let document_ids = backup
                .tables
                .get(LARGE_TEXT_DOCUMENTS)
                .map_or_else(Vec::new, |rows| ids_from_rows(rows, "id"));
            delete_large_text_chunks_by_document_ids(tx, &document_ids)?;
        } else if *table == "locations" {
            let rows = backup
                .tables
                .get(*table)
                .map(Vec::as_slice)
                .unwrap_or_default();
            delete_location_rows(tx, rows)?;
        } else {
            let identity_column = deletion_identity_column(table);
            let ids = backup
                .tables
                .get(*table)
                .map_or_else(Vec::new, |rows| ids_from_rows(rows, identity_column));
            delete_rows_by_ids(tx, table, identity_column, &ids)?;
        }
    }
    tx.execute("DELETE FROM novels WHERE id = ?1", params![novel_id])
        .map_err(|error| format!("清理作品失败：{error}"))?;
    tx.execute_batch(
        "CREATE TRIGGER IF NOT EXISTS trg_conversation_turns_append_only_delete
         BEFORE DELETE ON conversation_turns
         BEGIN SELECT RAISE(ABORT, 'conversation turns are append only'); END;
         CREATE TRIGGER IF NOT EXISTS trg_autonomous_run_checkpoints_append_only_delete
         BEFORE DELETE ON autonomous_run_checkpoints
         BEGIN SELECT RAISE(ABORT, 'autonomous run checkpoint is append only'); END;
         CREATE TRIGGER IF NOT EXISTS trg_ai_tasks_no_delete
         BEFORE DELETE ON ai_tasks BEGIN SELECT RAISE(ABORT, 'durable task fact'); END;
         CREATE TRIGGER IF NOT EXISTS trg_ai_task_attempts_no_delete
         BEFORE DELETE ON ai_task_attempts BEGIN SELECT RAISE(ABORT, 'durable attempt fact'); END;
         CREATE TRIGGER IF NOT EXISTS trg_ai_input_snapshots_immutable_delete
         BEFORE DELETE ON ai_input_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
         CREATE TRIGGER IF NOT EXISTS trg_ai_context_snapshots_immutable_delete
         BEFORE DELETE ON ai_context_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
         CREATE TRIGGER IF NOT EXISTS trg_ai_constraint_snapshots_immutable_delete
         BEFORE DELETE ON ai_constraint_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
         CREATE TRIGGER IF NOT EXISTS trg_result_artifacts_immutable_delete
         BEFORE DELETE ON result_artifacts BEGIN SELECT RAISE(ABORT, 'immutable artifact'); END;
         CREATE TRIGGER IF NOT EXISTS trg_artifact_validation_issues_append_only_delete
         BEFORE DELETE ON artifact_validation_issues BEGIN SELECT RAISE(ABORT, 'append-only issue'); END;",
    )
    .map_err(|error| format!("退出项目清理维护模式失败：{error}"))?;
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

    fn keep_tables_for_declared_schema(backup: &mut ProjectBackup) {
        let allowed = table_names_for_schema(backup.schema_version)
            .into_iter()
            .collect::<HashSet<_>>();
        backup
            .tables
            .retain(|table, _| allowed.contains(table.as_str()));
    }

    fn test_connection() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open in-memory database");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("enable foreign keys");
        crate::db::create_tables(&mut conn).expect("create schema");
        conn
    }

    fn seed_autonomous_plan(conn: &Connection, novel_id: &str, plan_id: &str, operation_id: &str) {
        let mut plan = serde_json::json!({
            "schemaVersion": 1,
            "planId": plan_id,
            "operationId": operation_id,
            "requestHash": "pending",
            "novelId": novel_id,
            "status": "running",
            "stage": "foundation",
            "revision": 1,
            "brief": {
                "premise": "A city forgets one resident every midnight.",
                "genre": "speculative mystery",
                "targetChapterCount": 12,
                "targetWordsPerChapter": 2400,
                "readerPromise": "escalating clues and costly choices",
                "endingPreference": "the truth is made public",
                "constraints": ["every clue must be traceable"]
            },
            "volumes": [{ "id": "volume-1" }],
            "chapters": [{
                "id": "chapter-1",
                "chapterNumber": 1,
                "volumeId": "volume-1",
                "characterIds": ["character-1"]
            }],
            "characters": [{ "id": "character-1" }],
            "worldElements": [{ "id": "world-1" }],
            "arcs": [],
            "conflicts": [],
            "pacingPhases": [],
            "pacingCurve": [],
            "agentRuns": [],
            "progress": {
                "completedVolumeIds": [],
                "currentVolumeIndex": 0,
                "adoptedChapterNumbers": [],
                "lastCheckpoint": "foundation"
            },
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z"
        });
        let (plan_json, plan_hash) =
            autonomous_story_service::refresh_restored_plan_hashes(&mut plan)
                .expect("prepare autonomous plan fixture");
        let request_hash = plan["requestHash"]
            .as_str()
            .expect("autonomous request hash");
        conn.execute(
            "INSERT INTO autonomous_story_plans (
                plan_id, operation_id, novel_id, request_hash, schema_version,
                status, stage, revision, target_chapter_count, completed_chapter_count,
                plan_json, plan_hash, created_at, updated_at
             ) VALUES (?1,?2,?3,?4,1,'running','foundation',1,12,1,?5,?6,?7,?7)",
            params![
                plan_id,
                operation_id,
                novel_id,
                request_hash,
                plan_json,
                plan_hash,
                "2026-01-01T00:00:00Z",
            ],
        )
        .expect("seed autonomous plan");
    }

    fn seed_minimal_backup_project(conn: &Connection, novel_id: &str) {
        conn.execute_batch(&format!(
            "INSERT INTO novels (id, title, status, created_at, updated_at)
             VALUES ('{novel_id}', 'Backup fixture', 'draft',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO volumes (id, novel_id, title, created_at, updated_at)
             VALUES ('volume-1', '{novel_id}', 'Volume 1',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO chapters (id, novel_id, volume_id, title, created_at, updated_at)
             VALUES ('chapter-1', '{novel_id}', 'volume-1', 'Chapter 1',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO characters (id, novel_id, name, created_at, updated_at)
             VALUES ('character-1', '{novel_id}', 'Character 1',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO chapter_events
                 (id, novel_id, chapter_id, title, involved_character_ids, created_at, updated_at)
             VALUES ('event-1', '{novel_id}', 'chapter-1', 'Event 1', '[\"character-1\"]',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');"
        ))
        .expect("seed minimal backup project");
    }

    fn seed_applied_autonomous_plan(conn: &Connection, novel_id: &str) {
        seed_autonomous_plan(
            conn,
            novel_id,
            "autonomous-plan-1",
            "autonomous-plan-operation-1",
        );
        conn.execute(
            "UPDATE autonomous_story_plans
             SET status = 'ready', stage = 'ready', updated_at = ?1, completed_at = ?1
             WHERE plan_id = 'autonomous-plan-1'",
            ["2026-01-01T00:01:00Z"],
        )
        .expect("advance autonomous plan fixture to ready");
        conn.execute(
            "UPDATE autonomous_story_plans
             SET status = 'applied', stage = 'applied', updated_at = ?1, applied_at = ?1
             WHERE plan_id = 'autonomous-plan-1'",
            ["2026-01-01T00:02:00Z"],
        )
        .expect("advance autonomous plan fixture to applied");
    }

    fn seed_running_scheduler_fixture(conn: &Connection, novel_id: &str) {
        let policy_json = ai_fact_security::canonical_json(&serde_json::json!({
            "schemaVersion": 1,
            "mode": "full_auto",
            "maxChapters": 1,
            "maxConsecutiveFailures": 3,
            "maxRetriesPerChapter": 2,
            "minimumSuccessfulExperts": 2,
            "minimumAverageScore": 80.0,
            "minimumAcceptanceRate": 0.75,
            "autoConfirmAnalysis": true,
            "dailyTokenBudget": 50000,
            "bookTokenBudget": 500000,
            "dailyCostBudgetUsd": 10.0,
            "bookCostBudgetUsd": 100.0,
            "runWindow": null
        }))
        .expect("canonicalize scheduler policy fixture");
        let policy_hash = backup_text_hash(&policy_json);
        let request_hash = ai_fact_security::canonical_hash(&serde_json::json!({
            "novelId": novel_id,
            "planId": "autonomous-plan-1",
            "policyHash": policy_hash,
        }))
        .expect("hash scheduler request fixture");
        let decision_json = ai_fact_security::canonical_json(&serde_json::json!({
            "action": "generate",
            "chapterId": "chapter-1",
            "runId": "scheduler-run-1"
        }))
        .expect("canonicalize scheduler decision fixture");
        let decision_hash = backup_text_hash(&decision_json);
        let payload_json = ai_fact_security::canonical_json(&serde_json::json!({
            "attemptId": "scheduler-attempt-1",
            "chapterId": "chapter-1",
            "runId": "scheduler-run-1"
        }))
        .expect("canonicalize scheduler checkpoint fixture");
        let payload_hash = backup_text_hash(&payload_json);

        conn.execute(
            "INSERT INTO autonomous_book_runs
                (run_id, operation_id, request_hash, novel_id, plan_id, mode,
                 policy_json, policy_hash, status, state_revision, next_chapter_number,
                 total_chapters, completed_chapters, token_input, token_output, cost_usd,
                 usage_day, daily_token_input, daily_token_output, daily_cost_usd,
                 consecutive_failures, created_at, updated_at, started_at)
             VALUES
                ('scheduler-run-1', 'scheduler-run-operation-1', ?1, ?2,
                 'autonomous-plan-1', 'full_auto', ?3, ?4, 'running', 3, 1, 1,
                 0, 120, 80, 0.003, '2026-01-01', 120, 80, 0.003, 0,
                 '2026-01-01T00:03:00Z', '2026-01-01T00:04:00Z',
                 '2026-01-01T00:03:00Z')",
            params![request_hash, novel_id, policy_json, policy_hash],
        )
        .expect("seed running autonomous scheduler run");
        conn.execute(
            "INSERT INTO autonomous_run_leases
                (lease_id, run_id, novel_id, epoch, owner_id, token_hash, expires_at,
                 status, acquired_at, renewed_at)
             VALUES
                ('scheduler-lease-1', 'scheduler-run-1', ?1, 1, 'source-process', ?2,
                 '2099-01-01T00:00:00Z', 'active', '2026-01-01T00:03:00Z',
                 '2026-01-01T00:04:00Z')",
            params![novel_id, "b".repeat(64)],
        )
        .expect("seed active autonomous scheduler lease");
        conn.execute(
            "INSERT INTO autonomous_run_chapter_attempts
                (attempt_id, run_id, novel_id, chapter_id, chapter_number,
                 attempt_number, operation_id, lease_id, lease_epoch, status,
                 estimated_tokens, estimated_cost_usd, decision_json, decision_hash,
                 claimed_at)
             VALUES
                ('scheduler-attempt-1', 'scheduler-run-1', ?1, 'chapter-1', 1, 1,
                 'scheduler-attempt-operation-1', 'scheduler-lease-1', 1, 'claimed',
                 4000, 0.04, ?2, ?3, '2026-01-01T00:04:00Z')",
            params![novel_id, decision_json, decision_hash],
        )
        .expect("seed claimed autonomous scheduler attempt");
        conn.execute(
            "INSERT INTO autonomous_run_checkpoints
                (checkpoint_id, run_id, novel_id, sequence, event_type, attempt_id,
                 run_status, payload_json, payload_hash, created_at)
             VALUES
                ('scheduler-checkpoint-1', 'scheduler-run-1', ?1, 1,
                 'chapter_claimed', 'scheduler-attempt-1', 'running', ?2, ?3,
                 '2026-01-01T00:04:00Z')",
            params![novel_id, payload_json, payload_hash],
        )
        .expect("seed autonomous scheduler checkpoint");
    }

    fn seed_story_asset_fixture(conn: &Connection, novel_id: &str) {
        conn.execute_batch(&format!(
            "INSERT INTO factions
                (id, novel_id, name, kind, description, goals, revision, created_at, updated_at)
             VALUES
                ('faction-a', '{novel_id}', 'Faction A', 'guild', 'First faction',
                 'Protect the archive', 2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO factions
                (id, novel_id, name, kind, description, goals, revision, created_at, updated_at)
             VALUES
                ('faction-b', '{novel_id}', 'Faction B', 'court', 'Second faction',
                 'Control the archive', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO locations
                (id, novel_id, name, kind, description, revision, created_at, updated_at)
             VALUES
                ('location-root', '{novel_id}', 'Archive', 'city', 'Root location', 3,
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO locations
                (id, novel_id, name, kind, description, parent_location_id, revision,
                 created_at, updated_at)
             VALUES
                ('location-child', '{novel_id}', 'Vault', 'room', 'Child location',
                 'location-root', 2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO faction_relations
                (id, novel_id, source_faction_id, target_faction_id, relation_type,
                 description, revision, created_at, updated_at)
             VALUES
                ('faction-relation-1', '{novel_id}', 'faction-a', 'faction-b', 'rival',
                 'Compete for access', 2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO location_links
                (id, novel_id, source_location_id, target_location_id, link_type,
                 description, revision, created_at, updated_at)
             VALUES
                ('location-link-1', '{novel_id}', 'location-root', 'location-child',
                 'contains', 'Hidden stair', 2, '2026-01-01T00:00:00Z',
                 '2026-01-01T00:00:00Z');
             INSERT INTO character_factions
                (id, novel_id, character_id, faction_id, role, revision, created_at, updated_at)
             VALUES
                ('character-faction-1', '{novel_id}', 'character-1', 'faction-a',
                 'archivist', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO chapter_factions
                (id, novel_id, chapter_id, faction_id, role, revision, created_at, updated_at)
             VALUES
                ('chapter-faction-1', '{novel_id}', 'chapter-1', 'faction-b',
                 'opposition', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO chapter_locations
                (id, novel_id, chapter_id, location_id, role, revision, created_at, updated_at)
             VALUES
                ('chapter-location-1', '{novel_id}', 'chapter-1', 'location-child',
                 'primary', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO chapter_event_factions
                (id, novel_id, chapter_event_id, faction_id, role, revision, created_at, updated_at)
             VALUES
                ('event-faction-1', '{novel_id}', 'event-1', 'faction-a', 'instigator',
                 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO chapter_event_locations
                (id, novel_id, chapter_event_id, location_id, role, revision, created_at, updated_at)
             VALUES
                ('event-location-1', '{novel_id}', 'event-1', 'location-child', 'scene',
                 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');"
        ))
        .expect("seed story asset fixture");
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
            INSERT INTO reference_works (id, novel_id, title, purpose, description, revision, created_at, updated_at)
            VALUES ('reference-work-1', '{novel_id}', '参考作品', 'style', '分层分析来源', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO reference_imports (id, reference_work_id, novel_id, version_no, is_current, operation_id, request_hash, file_name, source_file_path, source_format, source_sha256, source_byte_count, detected_encoding, selected_encoding, encoding_source, decoded_text_sha256, decoded_char_count, decoded_utf8_byte_count, source_text, section_count, parser_version, section_plan_sha256, warnings_json, imported_at)
            VALUES ('reference-import-1', 'reference-work-1', '{novel_id}', 1, 1, 'reference-operation-1', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'reference.txt', 'C:/private/reference.txt', 'txt', 'ae2d496ace550ab8a93c285efd3a0a19395715cb3f28c27a714145d3f50cb5cc', 12, 'utf-8', 'utf-8', 'utf8_valid', 'ae2d496ace550ab8a93c285efd3a0a19395715cb3f28c27a714145d3f50cb5cc', 4, 12, '参考正文', 1, 'reference_txt_parser_v1', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '[]', '2026-01-01T00:00:00Z');
            INSERT INTO reference_sections (id, reference_import_id, reference_work_id, novel_id, order_index, section_kind, title, content, content_hash, char_count, utf8_byte_count, source_start_utf16, source_end_utf16, created_at)
            VALUES ('reference-section-1', 'reference-import-1', 'reference-work-1', '{novel_id}', 1, 'unstructured', '全文', '参考正文', 'ae2d496ace550ab8a93c285efd3a0a19395715cb3f28c27a714145d3f50cb5cc', 4, 12, 0, 4, '2026-01-01T00:00:00Z');
            INSERT INTO style_profiles (id, novel_id, name, source_type, source_reference_work_id, source_reference_import_id, source_content_sha256, source_state, analysis_metadata_json, created_at, updated_at)
            VALUES ('style-1', '{novel_id}', '风格', 'ai_analyzed', 'reference-work-1', 'reference-import-1', 'ae2d496ace550ab8a93c285efd3a0a19395715cb3f28c27a714145d3f50cb5cc', 'available', '{{\"sourceWorkId\":\"reference-work-1\",\"sourceImportId\":\"reference-import-1\"}}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO output_profiles (id, novel_id, name, created_at, updated_at) VALUES ('output-1', '{novel_id}', '输出', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO imported_assets (id, novel_id, file_name, file_path, file_type, asset_type, parsed_json, related_style_profile_id, created_at) VALUES ('asset-1', '{novel_id}', '风格.txt', 'C:\\private\\style.txt', 'text/plain', 'style', '{{\"sourceAssetId\":\"asset-1\",\"styleProfileId\":\"style-1\"}}', 'style-1', '2026-01-01T00:00:00Z');
            INSERT INTO characters (id, novel_id, name, created_at, updated_at) VALUES ('character-1', '{novel_id}', '配角', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO ai_task_records (
                id, novel_id, chapter_id, task_type, status,
                token_input, token_output, token_total,
                input_price_per_million_tokens, output_price_per_million_tokens,
                cost_estimate, cost_currency, cost_status, pricing_source, created_at
            ) VALUES (
                'task-1', '{novel_id}', 'chapter-1', 'generate', 'succeeded',
                1200, 800, 2000,
                2.5, 10.0,
                0.011, 'USD', 'complete', 'user_configured', '2026-01-01T00:00:00Z'
            );
            INSERT INTO chapter_drafts (id, novel_id, chapter_id, title, content, source, word_count, is_adopted, ai_task_id, large_text_ref_id, created_at, updated_at) VALUES ('draft-1', '{novel_id}', 'chapter-1', '草稿', '预览', 'ai_generated', 6, 1, 'task-1', 'large-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO chapter_drafts (id, novel_id, chapter_id, title, content, source, word_count, is_adopted, ai_task_id, created_at, updated_at) VALUES ('draft-2', '{novel_id}', 'chapter-1', '协作修订稿', '修订后的正文', 'ai_generated', 6, 0, 'task-1', '2026-01-01T00:01:00Z', '2026-01-01T00:01:00Z');
            UPDATE chapters SET adopted_draft_id = 'draft-1' WHERE id = 'chapter-1';
            INSERT INTO memory_documents (id, novel_id, source_type, source_id, source_version, source_hash, adopted_draft_id, chapter_id, status, metadata_json, created_at, updated_at)
            VALUES ('memory-document-1', '{novel_id}', 'adopted_draft', 'draft-1', 1, '8c88207cc65259056f996760035d72ddbd428d97023a3a165a6ad9b81167dd40', 'draft-1', 'chapter-1', 'active', '{{\"kind\":\"scene\"}}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
            INSERT INTO memory_chunks (id, document_id, novel_id, chapter_id, ordinal, text, token_count, importance, chapter_order_index, temporal_start_chapter, entity_keys_json, metadata_json, content_hash, created_at)
            VALUES ('memory-chunk-1', 'memory-document-1', '{novel_id}', 'chapter-1', 0, '记忆正文', 8, 0.9, 1, 1, '[\"character-1\"]', '{{\"factType\":\"event\"}}', 'af5f7676318b704dc7fb13d4aae3172e96e6591b4f367be9114774a3fe6861fc', '2026-01-01T00:00:00Z');
            INSERT INTO memory_embeddings (id, chunk_id, novel_id, provider, model, dimension, vector_json, vector_norm, vector_hash, chunk_content_hash, created_at)
            VALUES ('memory-embedding-1', 'memory-chunk-1', '{novel_id}', 'fixture', 'embed-v1', 2, '[1.0,0.0]', 1.0, '01655b3a712fa992d2d1b41b16dfae912d48f8a0646436931cf9570cfd0e296e', 'af5f7676318b704dc7fb13d4aae3172e96e6591b4f367be9114774a3fe6861fc', '2026-01-01T00:00:00Z');
            INSERT INTO memory_retrieval_logs (id, novel_id, query_hash, query_embedding_hash, filters_json, retrieval_mode, embedding_provider, embedding_model, embedding_dimension, fts_available, candidate_count, selected_chunk_ids_json, score_reasons_json, top_k, page_offset, token_budget, used_tokens, created_at)
            VALUES ('memory-request-1', '{novel_id}', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', '01655b3a712fa992d2d1b41b16dfae912d48f8a0646436931cf9570cfd0e296e', '{{\"chapterId\":\"chapter-1\"}}', 'hybrid', 'fixture', 'embed-v1', 2, 1, 1, '[\"memory-chunk-1\"]', '[{{\"chunkId\":\"memory-chunk-1\",\"score\":{{\"finalScore\":1.0}}}}]', 5, 0, 100, 8, '2026-01-01T00:00:00Z');
            INSERT INTO multi_agent_sessions (session_id, operation_id, novel_id, chapter_id, source_draft_id, source_draft_version, source_content_hash, expert_types_json, max_rounds, acceptance_threshold, minimum_average_score, minimum_successful_experts, status, current_round, accepted, final_action, final_draft_id, total_tokens_input, total_tokens_output, total_tokens_used, duration_ms, created_at, updated_at, completed_at)
            VALUES ('session-1', 'operation-1', '{novel_id}', 'chapter-1', 'draft-1', 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '[\"outline\",\"quality\"]', 2, 0.8, 80, 2, 'completed', 2, 1, 'accept', 'draft-2', 42, 18, 60, 200, '2026-01-01T00:00:00Z', '2026-01-01T00:02:00Z', '2026-01-01T00:02:00Z');
            INSERT INTO multi_agent_rounds (session_id, round_number, input_draft_id, input_draft_version, input_content_hash, output_draft_id, output_draft_version, output_content_hash, agreed, acceptance_rate, average_score, successful_experts, failed_experts, required_successful_experts, action, major_concerns_json, merged_suggestions_json, tokens_input, tokens_output, tokens_used, duration_ms, started_at, completed_at)
            VALUES ('session-1', 1, 'draft-1', 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'draft-2', 1, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 0, 0.5, 75, 2, 0, 2, 'revise', '[\"节奏偏慢\"]', '[\"收紧冲突\"]', 20, 10, 30, 120, '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z');
            INSERT INTO multi_agent_rounds (session_id, round_number, input_draft_id, input_draft_version, input_content_hash, agreed, acceptance_rate, average_score, successful_experts, failed_experts, required_successful_experts, action, major_concerns_json, merged_suggestions_json, tokens_input, tokens_output, tokens_used, duration_ms, started_at, completed_at)
            VALUES ('session-1', 2, 'draft-2', 1, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 1, 1, 90, 2, 0, 2, 'accept', '[]', '[]', 22, 8, 30, 80, '2026-01-01T00:01:00Z', '2026-01-01T00:02:00Z');
            INSERT INTO multi_agent_opinions (opinion_id, session_id, round_number, expert_type, status, score, accepted, summary, issues_json, suggestions_json, provider, model, ai_task_id, tokens_input, tokens_output, tokens_used, duration_ms)
            VALUES ('opinion-1', 'session-1', 1, 'outline', 'succeeded', 80, 1, '结构基本成立', '[]', '[\"加强转折\"]', 'mock', 'deterministic', 'task-1', 10, 5, 15, 60);
            INSERT INTO multi_agent_opinions (opinion_id, session_id, round_number, expert_type, status, score, accepted, summary, issues_json, suggestions_json, provider, model, ai_task_id, tokens_input, tokens_output, tokens_used, duration_ms)
            VALUES ('opinion-2', 'session-1', 1, 'quality', 'succeeded', 70, 0, '需要修订节奏', '[\"节奏偏慢\"]', '[\"收紧冲突\"]', 'mock', 'deterministic', 'task-1', 10, 5, 15, 60);
            INSERT INTO multi_agent_opinions (opinion_id, session_id, round_number, expert_type, status, score, accepted, summary, issues_json, suggestions_json, provider, model, ai_task_id, tokens_input, tokens_output, tokens_used, duration_ms)
            VALUES ('opinion-3', 'session-1', 2, 'outline', 'succeeded', 92, 1, '结构通过', '[]', '[]', 'mock', 'deterministic', 'task-1', 11, 4, 15, 40);
            INSERT INTO multi_agent_opinions (opinion_id, session_id, round_number, expert_type, status, score, accepted, summary, issues_json, suggestions_json, provider, model, ai_task_id, tokens_input, tokens_output, tokens_used, duration_ms)
            VALUES ('opinion-4', 'session-1', 2, 'quality', 'succeeded', 88, 1, '质量通过', '[]', '[]', 'mock', 'deterministic', 'task-1', 11, 4, 15, 40);
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
        seed_autonomous_plan(
            conn,
            novel_id,
            "autonomous-plan-1",
            "autonomous-operation-1",
        );
    }

    fn assert_independent_value_remap(
        source: &JsonValue,
        actual: &JsonValue,
        id_map: &BTreeMap<String, String>,
        path: &str,
    ) {
        if path.starts_with("autonomous_story_plans")
            && (path.ends_with(".request_hash")
                || path.ends_with(".requestHash")
                || path.ends_with(".plan_hash"))
        {
            let restored_hash = actual.as_str().expect("restored SHA-256 value");
            assert_eq!(restored_hash.len(), 64, "{path}: invalid SHA-256 length");
            assert!(
                restored_hash
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
                "{path}: invalid SHA-256 format"
            );
            assert_ne!(actual, source, "{path}: hash was not refreshed");
            return;
        }
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

    fn seed_workbench_artifact_graph(conn: &mut Connection, novel_id: &str) {
        use crate::repositories::large_text_repository;
        use crate::services::ai_task_service::{
            ClaimAiTaskAttemptInput, ConstraintSnapshotInput, ContextSnapshotInput,
            CreateAiTaskInput, InputSnapshotInput,
        };
        use crate::services::{ai_task_service, artifact_service, conversation_service};

        let created_at = "2026-08-21T00:00:00Z".to_string();
        conversation_service::create(
            conn,
            conversation_service::CreateConversationInput {
                conversation_id: "conversation-backup".to_string(),
                novel_id: novel_id.to_string(),
                title: "备份任务".to_string(),
                default_model: Some(serde_json::json!({
                    "providerId":"deepseek",
                    "modelId":"deepseek-chat"
                })),
                created_at: created_at.clone(),
            },
        )
        .expect("create workbench conversation");
        conversation_service::append_turn(
            conn,
            conversation_service::AppendTurnInput {
                turn_id: "turn-backup".to_string(),
                conversation_id: "conversation-backup".to_string(),
                role: "user".to_string(),
                content: "生成本章候选".to_string(),
                created_at: created_at.clone(),
            },
        )
        .expect("append workbench user turn");
        conversation_service::create_run(
            conn,
            conversation_service::CreateRunInput {
                run_id: "run-backup".to_string(),
                conversation_id: "conversation-backup".to_string(),
                turn_id: "turn-backup".to_string(),
                model_snapshot: serde_json::json!({
                    "providerId":"deepseek",
                    "modelId":"deepseek-chat",
                    "runtime":{"adapterProtocol":"ans_task_session_v1"}
                }),
                worker_id: "worker-backup".to_string(),
                created_at: created_at.clone(),
            },
        )
        .expect("create workbench run");
        conversation_service::update_run(
            conn,
            conversation_service::UpdateRunInput {
                run_id: "run-backup".to_string(),
                status: "running".to_string(),
                error: None,
                updated_at: created_at.clone(),
                started_at: Some(created_at.clone()),
                finished_at: None,
            },
        )
        .expect("start workbench run");
        let event = conversation_service::append_tool_event(
            conn,
            conversation_service::AppendToolEventInput {
                event_id: "tool-event-backup".to_string(),
                run_id: "run-backup".to_string(),
                tool_name: "generate_chapter".to_string(),
                arguments_summary: serde_json::json!({"callId":"call-backup","argumentsHash":"safe"}),
                status: "running".to_string(),
                duration_ms: None,
                error: None,
                result: None,
                created_at: created_at.clone(),
                finished_at: None,
            },
        )
        .expect("append tool event");
        let tool_body = serde_json::json!({
            "ok":true,
            "artifactType":"chapter_text",
            "candidateOnly":true,
            "data":{"novelId":novel_id,"chapterId":"chapter-1","text":"备份候选正文"}
        })
        .to_string();
        let tool_hash = large_text_repository::sha256(&tool_body);
        large_text_repository::insert_document_for_target(
            conn,
            "tool-result-backup",
            "tool_event",
            &event.event_id,
            "result",
            None,
            &tool_body,
            &tool_hash,
            &created_at,
        )
        .expect("persist tool result body");
        conversation_service::update_tool_event(
            conn,
            conversation_service::UpdateToolEventInput {
                event_id: event.event_id,
                status: "succeeded".to_string(),
                duration_ms: Some(10),
                error: None,
                result: Some(serde_json::json!({
                    "callId":"call-backup",
                    "largeTextRefId":"tool-result-backup",
                    "contentHash":tool_hash
                })),
                finished_at: Some(created_at.clone()),
            },
        )
        .expect("settle tool event");

        let prompt = "只生成候选，不写正式正文。";
        let task = ai_task_service::create_task(
            conn,
            CreateAiTaskInput {
                operation_id: "workbench-run-backup".to_string(),
                request_hash_version: None,
                request_hash: None,
                trace_id: None,
                task_type: "chapter_generate".to_string(),
                novel_id: novel_id.to_string(),
                chapter_id: Some("chapter-1".to_string()),
                draft_id: None,
                scope_type: "chapter".to_string(),
                expected_artifact_type: "chapter_text".to_string(),
                expected_artifact_schema_version: 1,
                target_hint_json: Some(serde_json::json!({
                    "conversationId":"conversation-backup",
                    "turnId":"turn-backup",
                    "runId":"run-backup"
                })),
                input_snapshot: InputSnapshotInput {
                    schema_version: 1,
                    input_type: "workbench_dsh_messages_v1".to_string(),
                    payload_json: serde_json::json!({
                        "conversationId":"conversation-backup",
                        "goal":"生成本章候选"
                    }),
                    body: "生成本章候选".to_string(),
                    source_draft_id: None,
                    source_draft_version: None,
                    base_content_hash: None,
                },
                context_snapshot: ContextSnapshotInput {
                    schema_version: 1,
                    source_manifest_json: serde_json::json!({"contractVersion":"workbench_v1","sources":[]}),
                    compiled_context: "目标章节：chapter-1".to_string(),
                    budget_json: serde_json::json!({"maxChars":1000,"compiledContextChars":19}),
                    compiler_version: "workbench_v1".to_string(),
                },
                constraint_snapshot: ConstraintSnapshotInput {
                    schema_version: 1,
                    payload_json: serde_json::json!({"candidateOnly":true}),
                    prompt_template_id: "workbench/chapter_generate".to_string(),
                    prompt_template_version: "1".to_string(),
                    prompt_template_hash: large_text_repository::sha256(prompt),
                    prompt_template_body: prompt.to_string(),
                    provider_options_json: serde_json::json!({"maxTokens":8000}),
                },
            },
        )
        .expect("create workbench ai task");
        let queued = ai_task_service::queue_attempt(conn, &task.task_id).expect("queue attempt");
        let attempt = ai_task_service::claim_attempt(
            conn,
            ClaimAiTaskAttemptInput {
                task_id: task.task_id.clone(),
                attempt_id: queued.attempt.attempt_id,
                provider_id: "deepseek".to_string(),
                model_id: "deepseek-chat".to_string(),
                provider_request_id: Some("run-backup".to_string()),
            },
        )
        .expect("claim attempt");
        let candidate = "备份候选正文";
        ai_task_service::mark_provider_succeeded(
            conn,
            &task.task_id,
            &attempt.attempt.attempt_id,
            serde_json::json!({
                "provider":"deepseek",
                "model":"deepseek-chat",
                "providerRequestId":"run-backup",
                "responseHash":large_text_repository::sha256(candidate),
                "responseLength":candidate.chars().count(),
                "tokenInput":10,
                "tokenOutput":20,
                "tokenTotal":30,
                "finishReason":"tool_result",
                "durationMs":10
            }),
        )
        .expect("complete provider attempt");
        let artifact = artifact_service::create_artifact(
            conn,
            artifact_service::CreateResultArtifactInput {
                task_id: task.task_id,
                attempt_id: attempt.attempt.attempt_id,
                artifact_type: "chapter_text".to_string(),
                schema_version: 1,
                raw_content: candidate.to_string(),
                display_content: None,
                structured_payload_json: None,
                parent_artifact_id: None,
                derivation_type: None,
            },
        )
        .expect("create workbench artifact");
        conversation_service::create_artifact_card(
            conn,
            conversation_service::CreateArtifactCardInput {
                card_id: "card-backup".to_string(),
                conversation_id: "conversation-backup".to_string(),
                turn_id: Some("turn-backup".to_string()),
                run_id: Some("run-backup".to_string()),
                artifact_id: Some(artifact.artifact.artifact_id),
                artifact_type: "chapter_text".to_string(),
                title: "章节候选".to_string(),
                summary: "备份候选".to_string(),
                content: None,
                status: "candidate".to_string(),
                created_at: created_at.clone(),
            },
        )
        .expect("create artifact projection");
        conversation_service::update_run(
            conn,
            conversation_service::UpdateRunInput {
                run_id: "run-backup".to_string(),
                status: "completed".to_string(),
                error: None,
                updated_at: created_at.clone(),
                started_at: None,
                finished_at: Some(created_at),
            },
        )
        .expect("complete workbench run");
    }

    #[test]
    fn project_backup_round_trips_workbench_result_artifact_graph() {
        let mut source = test_connection();
        seed_minimal_backup_project(&source, "novel-source");
        seed_workbench_artifact_graph(&mut source, "novel-source");
        let backup = export_project_backup_in_conn(&source, "novel-source")
            .expect("export workbench artifact graph");
        assert_eq!(backup.tables["task_conversations"].len(), 1);
        assert_eq!(backup.tables["tool_call_events"].len(), 1);
        assert_eq!(backup.tables["result_artifacts"].len(), 1);
        assert!(backup.tables[LARGE_TEXT_DOCUMENTS].iter().any(|row| {
            row.get("id").and_then(JsonValue::as_str) == Some("tool-result-backup")
        }));

        let mut target = test_connection();
        let restored = restore_project_backup_in_conn(&mut target, &backup)
            .expect("restore workbench artifact graph");
        let new_conversation = restored.id_map["conversation-backup"].as_str();
        let new_run = restored.id_map["run-backup"].as_str();
        let new_artifact = restored
            .id_map
            .get(
                backup.tables["result_artifacts"][0]["artifact_id"]
                    .as_str()
                    .expect("source artifact id"),
            )
            .expect("remapped artifact");
        let restored_card: (String, String, String) = target
            .query_row(
                "SELECT conversation_id, run_id, artifact_id FROM conversation_artifact_cards LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read restored artifact card");
        assert_eq!(restored_card.0, new_conversation);
        assert_eq!(restored_card.1, new_run);
        assert_eq!(restored_card.2, *new_artifact);
        let call_id: String = target
            .query_row("SELECT call_id FROM tool_call_events LIMIT 1", [], |row| {
                row.get(0)
            })
            .expect("restored stable call id");
        assert_eq!(call_id, "call-backup");
        let foreign_key_violations: i64 = target
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .expect("workbench foreign key check");
        assert_eq!(foreign_key_violations, 0);
    }

    #[test]
    fn project_backup_rejects_invalid_workbench_status_and_json_without_partial_write() {
        let mut source = test_connection();
        seed_minimal_backup_project(&source, "novel-source");
        seed_workbench_artifact_graph(&mut source, "novel-source");
        let backup = export_project_backup_in_conn(&source, "novel-source")
            .expect("export workbench artifact graph");

        let mut invalid_status = backup.clone();
        invalid_status
            .tables
            .get_mut("task_runs")
            .and_then(|rows| rows.first_mut())
            .expect("task run backup row")
            .insert(
                "status".to_string(),
                JsonValue::String("forged_terminal".to_string()),
            );

        let mut invalid_json = backup;
        invalid_json
            .tables
            .get_mut("tool_call_events")
            .and_then(|rows| rows.first_mut())
            .expect("tool event backup row")
            .insert(
                "arguments_summary_json".to_string(),
                JsonValue::String("[]".to_string()),
            );

        for (table, invalid_backup) in [
            ("task_runs", invalid_status),
            ("tool_call_events", invalid_json),
        ] {
            let mut target = test_connection();
            let error = restore_project_backup_in_conn(&mut target, &invalid_backup)
                .expect_err("invalid workbench row must fail closed");
            assert!(error.contains(table), "unexpected error: {error}");
            let novel_count: i64 = target
                .query_row("SELECT COUNT(*) FROM novels", [], |row| row.get(0))
                .expect("count novels after rejected restore");
            assert_eq!(novel_count, 0, "{table} restore wrote partial data");
        }
    }

    #[test]
    fn project_backup_export_clear_restore_round_trip_restores_full_project() {
        let mut source = test_connection();
        seed_full_project(&source, "novel-source");
        let backup = export_project_backup_in_conn(&source, "novel-source").expect("export source");
        assert_eq!(backup.tables["multi_agent_sessions"].len(), 1);
        assert_eq!(backup.tables["multi_agent_rounds"].len(), 2);
        assert_eq!(backup.tables["multi_agent_opinions"].len(), 4);
        assert_eq!(backup.tables["autonomous_story_plans"].len(), 1);
        assert_eq!(backup.tables["reference_works"].len(), 1);
        assert_eq!(backup.tables["reference_imports"].len(), 1);
        assert_eq!(backup.tables["reference_sections"].len(), 1);
        let serialized = serde_json::to_string(&backup).expect("serialize backup");
        assert!(!serialized.contains("must-not-export"));
        assert_eq!(backup.novel.get("cover_path"), Some(&JsonValue::Null));
        assert_eq!(
            backup.tables["imported_assets"][0].get("file_path"),
            Some(&JsonValue::Null),
        );
        assert_eq!(
            backup.tables["reference_imports"][0].get("source_file_path"),
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
            "reference-work-1",
            "reference-import-1",
            "reference-section-1",
            "reference-operation-1",
            "style-1",
            "output-1",
            "asset-1",
            "character-1",
            "task-1",
            "draft-1",
            "draft-2",
            "session-1",
            "operation-1",
            "opinion-1",
            "opinion-2",
            "opinion-3",
            "opinion-4",
            "autonomous-plan-1",
            "autonomous-operation-1",
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

        let restored_session_id = restored.id_map.get("session-1").expect("session ID map");
        let restored_draft_id = restored.id_map.get("draft-2").expect("draft ID map");
        let (final_draft_id, round_count, accepted): (String, i64, i64) = source
            .query_row(
                "SELECT final_draft_id, current_round, accepted FROM multi_agent_sessions WHERE session_id = ?1",
                params![restored_session_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read restored Multi-Agent session");
        assert_eq!(final_draft_id, *restored_draft_id);
        assert_eq!((round_count, accepted), (2, 1));
        let restored_opinion_count: i64 = source
            .query_row(
                "SELECT COUNT(*) FROM multi_agent_opinions WHERE session_id = ?1",
                params![restored_session_id],
                |row| row.get(0),
            )
            .expect("count restored Multi-Agent opinions");
        assert_eq!(restored_opinion_count, 4);

        let restored_plan_id = restored
            .id_map
            .get("autonomous-plan-1")
            .expect("autonomous plan ID map");
        let (stored_request_hash, stored_plan_hash, stored_plan_json): (String, String, String) =
            source
                .query_row(
                    "SELECT request_hash, plan_hash, plan_json
                     FROM autonomous_story_plans WHERE plan_id = ?1",
                    params![restored_plan_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .expect("read restored autonomous plan");
        let restored_plan: JsonValue =
            serde_json::from_str(&stored_plan_json).expect("parse restored autonomous plan");
        assert_eq!(restored_plan["requestHash"], stored_request_hash);
        assert_eq!(restored_plan["novelId"], restored.novel_id);
        assert_eq!(restored_plan["planId"], *restored_plan_id);
        let (canonical_plan, expected_plan_hash) =
            autonomous_story_service::refresh_restored_plan_hashes(&mut restored_plan.clone())
                .expect("recompute restored autonomous plan hashes");
        assert_eq!(canonical_plan, stored_plan_json);
        assert_eq!(expected_plan_hash, stored_plan_hash);

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
    fn project_backup_schema_eight_recovers_interrupted_scheduler_with_fresh_identity_hashes() {
        let source = test_connection();
        seed_minimal_backup_project(&source, "novel-source");
        seed_applied_autonomous_plan(&source, "novel-source");
        seed_running_scheduler_fixture(&source, "novel-source");

        let mut backup =
            export_project_backup_in_conn(&source, "novel-source").expect("export scheduler");
        backup.schema_version = 8;
        keep_tables_for_declared_schema(&mut backup);
        assert!(!backup.tables.contains_key("factions"));
        assert_eq!(backup.tables["autonomous_book_runs"].len(), 1);
        assert_eq!(backup.tables["autonomous_run_leases"].len(), 1);
        assert_eq!(backup.tables["autonomous_run_chapter_attempts"].len(), 1);
        assert_eq!(backup.tables["autonomous_run_checkpoints"].len(), 1);

        for (table, column, stale) in [
            ("autonomous_book_runs", "policy_hash", "1"),
            ("autonomous_book_runs", "request_hash", "2"),
            ("autonomous_run_chapter_attempts", "decision_hash", "3"),
            ("autonomous_run_checkpoints", "payload_hash", "4"),
        ] {
            backup
                .tables
                .get_mut(table)
                .and_then(|rows| rows.first_mut())
                .expect("scheduler backup fixture")
                .insert(column.to_string(), JsonValue::String(stale.repeat(64)));
        }

        let mut target = test_connection();
        let restored = restore_project_backup_in_conn(&mut target, &backup)
            .expect("restore schemaVersion 8 scheduler backup");
        for table in [
            "autonomous_book_runs",
            "autonomous_run_leases",
            "autonomous_run_chapter_attempts",
            "autonomous_run_checkpoints",
        ] {
            assert_eq!(restored.restored_records[table], 1, "{table} row count");
        }
        for table in [
            "factions",
            "locations",
            "faction_relations",
            "location_links",
            "character_factions",
            "chapter_factions",
            "chapter_locations",
            "chapter_event_factions",
            "chapter_event_locations",
        ] {
            assert_eq!(
                restored.restored_records[table], 0,
                "legacy {table} row count"
            );
        }

        let restored_run_id = restored
            .id_map
            .get("scheduler-run-1")
            .expect("scheduler run ID map");
        let restored_plan_id = restored
            .id_map
            .get("autonomous-plan-1")
            .expect("scheduler plan ID map");
        let restored_chapter_id = restored
            .id_map
            .get("chapter-1")
            .expect("scheduler chapter ID map");
        let restored_lease_id = restored
            .id_map
            .get("scheduler-lease-1")
            .expect("scheduler lease ID map");
        let restored_attempt_id = restored
            .id_map
            .get("scheduler-attempt-1")
            .expect("scheduler attempt ID map");
        let restored_checkpoint_id = restored
            .id_map
            .get("scheduler-checkpoint-1")
            .expect("scheduler checkpoint ID map");
        for (source_id, restored_id) in [
            ("scheduler-run-1", restored_run_id),
            ("scheduler-lease-1", restored_lease_id),
            ("scheduler-attempt-1", restored_attempt_id),
            ("scheduler-checkpoint-1", restored_checkpoint_id),
        ] {
            assert_ne!(restored_id, source_id, "{source_id} was not remapped");
        }

        let (run_status, pause_reason, policy_json, policy_hash, request_hash): (
            String,
            Option<String>,
            String,
            String,
            String,
        ) = target
            .query_row(
                "SELECT status, pause_reason, policy_json, policy_hash, request_hash
                 FROM autonomous_book_runs WHERE run_id = ?1",
                params![restored_run_id],
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
            .expect("read restored scheduler run");
        assert_eq!(run_status, "queued");
        assert_eq!(
            pause_reason.as_deref(),
            Some("restored_without_active_lease")
        );
        let expected_policy_hash = backup_text_hash(&policy_json);
        assert_eq!(policy_hash, expected_policy_hash);
        assert_ne!(policy_hash, "1".repeat(64));
        let expected_request_hash = ai_fact_security::canonical_hash(&serde_json::json!({
            "novelId": restored.novel_id,
            "planId": restored_plan_id,
            "policyHash": policy_hash,
        }))
        .expect("recompute restored scheduler request hash");
        assert_eq!(request_hash, expected_request_hash);
        assert_ne!(request_hash, "2".repeat(64));

        let (lease_status, lease_owner, lease_token_hash, released_at): (
            String,
            String,
            String,
            Option<String>,
        ) = target
            .query_row(
                "SELECT status, owner_id, token_hash, released_at
                 FROM autonomous_run_leases WHERE lease_id = ?1",
                params![restored_lease_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("read restored scheduler lease");
        assert_eq!(lease_status, "expired");
        assert_eq!(lease_owner, "restored-project");
        assert_eq!(lease_token_hash, backup_text_hash(restored_lease_id));
        assert!(released_at.is_some());
        let active_lease_count: i64 = target
            .query_row(
                "SELECT COUNT(*) FROM autonomous_run_leases WHERE status = 'active'",
                [],
                |row| row.get(0),
            )
            .expect("count active restored scheduler leases");
        assert_eq!(active_lease_count, 0);

        let (attempt_status, decision_json, decision_hash, error_json, finished_at): (
            String,
            String,
            String,
            String,
            Option<String>,
        ) = target
            .query_row(
                "SELECT status, decision_json, decision_hash, error_json, finished_at
                 FROM autonomous_run_chapter_attempts WHERE attempt_id = ?1",
                params![restored_attempt_id],
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
            .expect("read restored scheduler attempt");
        assert_eq!(attempt_status, "abandoned");
        assert_eq!(decision_hash, backup_text_hash(&decision_json));
        assert_ne!(decision_hash, "3".repeat(64));
        let decision: JsonValue =
            serde_json::from_str(&decision_json).expect("parse restored scheduler decision");
        assert_eq!(decision["runId"], *restored_run_id);
        assert_eq!(decision["chapterId"], *restored_chapter_id);
        let interrupted_error: JsonValue =
            serde_json::from_str(&error_json).expect("parse restored scheduler error");
        assert_eq!(interrupted_error["code"], "RESTORED_INTERRUPTED_ATTEMPT");
        assert_eq!(interrupted_error["retryable"], true);
        assert!(finished_at.is_some());

        let (payload_json, payload_hash): (String, String) = target
            .query_row(
                "SELECT payload_json, payload_hash FROM autonomous_run_checkpoints
                 WHERE checkpoint_id = ?1",
                params![restored_checkpoint_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read restored scheduler checkpoint");
        assert_eq!(payload_hash, backup_text_hash(&payload_json));
        assert_ne!(payload_hash, "4".repeat(64));
        let payload: JsonValue =
            serde_json::from_str(&payload_json).expect("parse restored checkpoint payload");
        assert_eq!(payload["runId"], *restored_run_id);
        assert_eq!(payload["attemptId"], *restored_attempt_id);
        assert_eq!(payload["chapterId"], *restored_chapter_id);
    }

    #[test]
    fn project_backup_schema_nine_restores_out_of_order_story_asset_graph() {
        let source = test_connection();
        seed_minimal_backup_project(&source, "novel-source");
        seed_story_asset_fixture(&source, "novel-source");
        let mut backup =
            export_project_backup_in_conn(&source, "novel-source").expect("export story assets");
        assert_eq!(backup.schema_version, 11);

        for (table, expected) in [
            ("factions", 2),
            ("locations", 2),
            ("faction_relations", 1),
            ("location_links", 1),
            ("character_factions", 1),
            ("chapter_factions", 1),
            ("chapter_locations", 1),
            ("chapter_event_factions", 1),
            ("chapter_event_locations", 1),
        ] {
            assert_eq!(backup.tables[table].len(), expected, "exported {table}");
        }
        backup
            .tables
            .get_mut("locations")
            .expect("location backup fixture")
            .sort_by_key(|row| {
                usize::from(row.get("id").and_then(JsonValue::as_str) != Some("location-child"))
            });
        assert_eq!(backup.tables["locations"][0]["id"], "location-child");
        assert_eq!(
            backup.tables["locations"][0]["parent_location_id"],
            "location-root"
        );

        let mut target = test_connection();
        let restored = restore_project_backup_in_conn(&mut target, &backup)
            .expect("restore out-of-order story asset graph");
        for (table, expected) in [
            ("factions", 2),
            ("locations", 2),
            ("faction_relations", 1),
            ("location_links", 1),
            ("character_factions", 1),
            ("chapter_factions", 1),
            ("chapter_locations", 1),
            ("chapter_event_factions", 1),
            ("chapter_event_locations", 1),
        ] {
            assert_eq!(
                restored.restored_records[table], expected,
                "restored {table}"
            );
        }

        let restored_child_id = restored
            .id_map
            .get("location-child")
            .expect("child location ID map");
        let restored_root_id = restored
            .id_map
            .get("location-root")
            .expect("root location ID map");
        let restored_parent_id: String = target
            .query_row(
                "SELECT parent_location_id FROM locations WHERE id = ?1",
                params![restored_child_id],
                |row| row.get(0),
            )
            .expect("read restored child location parent");
        assert_eq!(restored_parent_id, *restored_root_id);

        for (table, left_column, left_source, right_column, right_source) in [
            (
                "faction_relations",
                "source_faction_id",
                "faction-a",
                "target_faction_id",
                "faction-b",
            ),
            (
                "location_links",
                "source_location_id",
                "location-root",
                "target_location_id",
                "location-child",
            ),
            (
                "character_factions",
                "character_id",
                "character-1",
                "faction_id",
                "faction-a",
            ),
            (
                "chapter_factions",
                "chapter_id",
                "chapter-1",
                "faction_id",
                "faction-b",
            ),
            (
                "chapter_locations",
                "chapter_id",
                "chapter-1",
                "location_id",
                "location-child",
            ),
            (
                "chapter_event_factions",
                "chapter_event_id",
                "event-1",
                "faction_id",
                "faction-a",
            ),
            (
                "chapter_event_locations",
                "chapter_event_id",
                "event-1",
                "location_id",
                "location-child",
            ),
        ] {
            let left_id = restored
                .id_map
                .get(left_source)
                .unwrap_or_else(|| panic!("missing ID map for {left_source}"));
            let right_id = restored
                .id_map
                .get(right_source)
                .unwrap_or_else(|| panic!("missing ID map for {right_source}"));
            let sql = format!(
                "SELECT COUNT(*) FROM {table} WHERE {left_column} = ?1 AND {right_column} = ?2"
            );
            let relation_count: i64 = target
                .query_row(&sql, params![left_id, right_id], |row| row.get(0))
                .unwrap_or_else(|_| panic!("read restored relation from {table}"));
            assert_eq!(relation_count, 1, "restored relation in {table}");
        }

        let foreign_key_violations: i64 = target
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .expect("story asset foreign key check");
        assert_eq!(foreign_key_violations, 0);
    }

    #[test]
    fn project_cleanup_removes_scheduler_and_assets_then_restores_checkpoint_trigger() {
        let mut connection = test_connection();
        seed_minimal_backup_project(&connection, "novel-source");
        seed_applied_autonomous_plan(&connection, "novel-source");
        seed_running_scheduler_fixture(&connection, "novel-source");
        seed_story_asset_fixture(&connection, "novel-source");
        connection
            .execute_batch(
                "INSERT INTO task_conversations
                    (conversation_id, novel_id, title, status, created_at, updated_at)
                 VALUES ('conversation-cleanup', 'novel-source', '清理任务', 'idle', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z');
                 INSERT INTO conversation_turns
                    (turn_id, conversation_id, sequence, role, content, created_at)
                 VALUES ('turn-cleanup', 'conversation-cleanup', 0, 'user', '清理', '2026-08-20T00:00:01Z');
                 INSERT INTO task_runs
                    (run_id, conversation_id, turn_id, status, model_snapshot_json, worker_id, created_at, updated_at)
                 VALUES ('run-cleanup', 'conversation-cleanup', 'turn-cleanup', 'queued', '{}', 'worker-cleanup', '2026-08-20T00:00:02Z', '2026-08-20T00:00:02Z');
                 INSERT INTO conversation_artifact_cards
                    (card_id, conversation_id, turn_id, run_id, artifact_type, title, summary, content, status, created_at)
                 VALUES ('card-cleanup', 'conversation-cleanup', 'turn-cleanup', 'run-cleanup', 'generic', '候选', '摘要', '内容', 'candidate', '2026-08-20T00:00:03Z');",
            )
            .expect("seed conversation cleanup fixture");
        let backup = export_project_backup_in_conn(&connection, "novel-source")
            .expect("export cleanup fixture");

        {
            let tx = connection
                .transaction()
                .expect("start project cleanup transaction");
            purge_project_in_tx(&tx, "novel-source").expect("purge scheduler and story assets");
            tx.commit().expect("commit project cleanup transaction");
        }

        let novel_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM novels", [], |row| row.get(0))
            .expect("count novels after project cleanup");
        assert_eq!(novel_count, 0);
        for (table, expected) in [
            ("task_conversations", 0),
            ("conversation_turns", 0),
            ("task_runs", 0),
            ("conversation_artifact_cards", 0),
        ] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("count conversation cleanup table");
            assert_eq!(count, expected, "conversation cleanup table {table}");
        }
        let turn_delete_trigger: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='trg_conversation_turns_append_only_delete'",
                [],
                |row| row.get(0),
            )
            .expect("conversation turn trigger restored");
        assert_eq!(turn_delete_trigger, 1);
        for table in [
            "autonomous_story_plans",
            "autonomous_book_runs",
            "autonomous_run_leases",
            "autonomous_run_chapter_attempts",
            "autonomous_run_checkpoints",
            "factions",
            "locations",
            "faction_relations",
            "location_links",
            "character_factions",
            "chapter_factions",
            "chapter_locations",
            "chapter_event_factions",
            "chapter_event_locations",
        ] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap_or_else(|_| panic!("count {table} after project cleanup"));
            assert_eq!(count, 0, "project cleanup left {table} rows");
        }
        let trigger_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'trigger'
                   AND name = 'trg_autonomous_run_checkpoints_append_only_delete'",
                [],
                |row| row.get(0),
            )
            .expect("confirm checkpoint delete trigger was restored");
        assert_eq!(trigger_count, 1);

        let restored = restore_project_backup_in_conn(&mut connection, &backup)
            .expect("restore cleanup fixture after purge");
        let restored_checkpoint_id = restored
            .id_map
            .get("scheduler-checkpoint-1")
            .expect("restored checkpoint ID map");
        let delete_error = connection
            .execute(
                "DELETE FROM autonomous_run_checkpoints WHERE checkpoint_id = ?1",
                params![restored_checkpoint_id],
            )
            .expect_err("restored checkpoint delete trigger must remain active");
        assert!(delete_error.to_string().contains("append only"));
    }

    #[test]
    fn project_backup_autonomous_plans_are_project_isolated() {
        let source = test_connection();
        source
            .execute_batch(
                "INSERT INTO novels (id,title,status,created_at,updated_at)
                 VALUES ('novel-source','Source','draft','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
                 INSERT INTO novels (id,title,status,created_at,updated_at)
                 VALUES ('novel-other','Other','draft','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');",
            )
            .expect("seed isolated novels");
        seed_autonomous_plan(&source, "novel-source", "plan-source", "operation-source");
        seed_autonomous_plan(&source, "novel-other", "plan-other", "operation-other");

        let backup =
            export_project_backup_in_conn(&source, "novel-source").expect("export source plan");
        assert_eq!(backup.schema_version, 11);
        let plans = &backup.tables["autonomous_story_plans"];
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0]["plan_id"], "plan-source");
        let serialized = serde_json::to_string(&backup).expect("serialize isolated backup");
        assert!(!serialized.contains("plan-other"));
        assert!(!serialized.contains("operation-other"));

        let mut target = test_connection();
        let restored = restore_project_backup_in_conn(&mut target, &backup)
            .expect("restore isolated autonomous plan");
        assert_eq!(restored.restored_records["autonomous_story_plans"], 1);
        let restored_plan_count: i64 = target
            .query_row(
                "SELECT COUNT(*) FROM autonomous_story_plans WHERE novel_id = ?1",
                params![restored.novel_id],
                |row| row.get(0),
            )
            .expect("count isolated restored plans");
        assert_eq!(restored_plan_count, 1);
    }

    #[test]
    fn project_backup_schema_four_restores_without_autonomous_plans() {
        let source = test_connection();
        seed_full_project(&source, "novel-source");
        let mut backup =
            export_project_backup_in_conn(&source, "novel-source").expect("export source");
        backup.schema_version = 4;
        keep_tables_for_declared_schema(&mut backup);
        for table in [
            "autonomous_story_plans",
            "reference_works",
            "reference_imports",
            "reference_sections",
            "memory_documents",
            "memory_chunks",
            "memory_embeddings",
            "memory_retrieval_logs",
        ] {
            backup.tables.remove(table);
        }

        let mut target = test_connection();
        let restored = restore_project_backup_in_conn(&mut target, &backup)
            .expect("restore schemaVersion 4 backup");
        assert_eq!(restored.restored_records["autonomous_story_plans"], 0);
        let count: i64 = target
            .query_row("SELECT COUNT(*) FROM autonomous_story_plans", [], |row| {
                row.get(0)
            })
            .expect("count restored autonomous plans");
        assert_eq!(count, 0);
    }

    #[test]
    fn project_backup_schema_five_restores_without_reference_library() {
        let source = test_connection();
        seed_full_project(&source, "novel-source");
        let mut backup =
            export_project_backup_in_conn(&source, "novel-source").expect("export source");
        backup.schema_version = 5;
        keep_tables_for_declared_schema(&mut backup);
        for table in [
            "reference_works",
            "reference_imports",
            "reference_sections",
            "memory_documents",
            "memory_chunks",
            "memory_embeddings",
            "memory_retrieval_logs",
        ] {
            backup.tables.remove(table);
        }

        let mut target = test_connection();
        let restored = restore_project_backup_in_conn(&mut target, &backup)
            .expect("restore schemaVersion 5 backup");
        assert_eq!(restored.restored_records["reference_works"], 0);
        assert_eq!(restored.restored_records["reference_imports"], 0);
        assert_eq!(restored.restored_records["reference_sections"], 0);
    }

    #[test]
    fn project_backup_schema_six_restores_without_memory_tables() {
        let source = test_connection();
        seed_full_project(&source, "novel-source");
        let mut backup =
            export_project_backup_in_conn(&source, "novel-source").expect("export source");
        backup.schema_version = 6;
        keep_tables_for_declared_schema(&mut backup);
        for table in [
            "memory_documents",
            "memory_chunks",
            "memory_embeddings",
            "memory_retrieval_logs",
        ] {
            backup.tables.remove(table);
        }

        let mut target = test_connection();
        let restored = restore_project_backup_in_conn(&mut target, &backup)
            .expect("restore schemaVersion 6 backup");
        assert_eq!(restored.restored_records["memory_documents"], 0);
        assert_eq!(restored.restored_records["memory_chunks"], 0);
        assert_eq!(restored.restored_records["memory_embeddings"], 0);
        assert_eq!(restored.restored_records["memory_retrieval_logs"], 0);
    }

    #[test]
    fn project_backup_rejects_tampered_reference_content_without_partial_write() {
        let source = test_connection();
        seed_full_project(&source, "novel-source");
        let mut backup =
            export_project_backup_in_conn(&source, "novel-source").expect("export source");
        backup
            .tables
            .get_mut("reference_sections")
            .and_then(|rows| rows.first_mut())
            .expect("reference section fixture")
            .insert(
                "content".to_string(),
                JsonValue::String("篡改正文".to_string()),
            );

        let mut target = test_connection();
        let error = restore_project_backup_in_conn(&mut target, &backup)
            .expect_err("tampered reference content must fail");
        assert!(error.contains("参考章节正文已被篡改"));
        let novel_count: i64 = target
            .query_row("SELECT COUNT(*) FROM novels", [], |row| row.get(0))
            .expect("count novels after rejected restore");
        assert_eq!(novel_count, 0);
    }

    #[test]
    fn project_backup_schema_two_restores_without_quality_state_table() {
        let source = test_connection();
        seed_full_project(&source, "novel-source");
        let mut backup =
            export_project_backup_in_conn(&source, "novel-source").expect("export source");
        backup.schema_version = 2;
        keep_tables_for_declared_schema(&mut backup);
        for table in [
            "quality_issue_states",
            "multi_agent_sessions",
            "multi_agent_rounds",
            "multi_agent_opinions",
            "autonomous_story_plans",
            "reference_works",
            "reference_imports",
            "reference_sections",
            "memory_documents",
            "memory_chunks",
            "memory_embeddings",
            "memory_retrieval_logs",
        ] {
            backup.tables.remove(table);
        }
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

    #[test]
    fn project_backup_round_trips_large_reference_section_content() {
        let mut source = test_connection();
        source
            .execute(
                "INSERT INTO novels (id, title, created_at, updated_at)
                 VALUES ('reference-large-source', '大章节备份', 'now', 'now')",
                [],
            )
            .expect("seed reference novel");
        let content = "参考章节🙂\r\nASCII words\r\n".repeat(12_000);
        let content_hash = crate::repositories::large_text_repository::sha256(&content);
        crate::repositories::large_text_repository::insert_document_for_target(
            &source,
            "reference-import-document",
            "reference_import",
            "reference-import-large",
            "source_text",
            Some("reference.txt"),
            &content,
            &content_hash,
            "now",
        )
        .expect("store reference import large text");
        crate::repositories::large_text_repository::insert_document_for_target(
            &source,
            "reference-section-document",
            "reference_section",
            "reference-section-large",
            "content",
            Some("全文"),
            &content,
            &content_hash,
            "now",
        )
        .expect("store reference section large text");
        source
            .execute(
                "INSERT INTO reference_works
                    (id, novel_id, title, purpose, revision, created_at, updated_at)
                 VALUES ('reference-work-large', 'reference-large-source', '参考作品',
                         'style', 1, 'now', 'now')",
                [],
            )
            .expect("seed reference work");
        source
            .execute(
                "INSERT INTO reference_imports
                    (id, reference_work_id, novel_id, version_no, is_current, operation_id,
                     request_hash, file_name, source_format, source_sha256, source_byte_count,
                     selected_encoding, encoding_source, decoded_text_sha256,
                     decoded_char_count, decoded_utf8_byte_count, source_text, large_text_ref_id,
                     section_count, parser_version, section_plan_sha256, warnings_json, imported_at)
                 VALUES ('reference-import-large', 'reference-work-large',
                         'reference-large-source', 1, 1, 'reference-operation-large', ?1,
                         'reference.txt', 'txt', ?2, ?3, 'utf-8', 'utf8_valid', ?2,
                         ?4, ?3, ?5, 'reference-import-document', 1,
                         'reference_txt_parser_v1', ?6, '[]', 'now')",
                params![
                    "a".repeat(64),
                    content_hash,
                    content.len() as i64,
                    content.chars().count() as i64,
                    content.chars().take(4_000).collect::<String>(),
                    "b".repeat(64),
                ],
            )
            .expect("seed reference import");
        source
            .execute(
                "INSERT INTO reference_sections
                    (id, reference_import_id, reference_work_id, novel_id, order_index,
                     section_kind, title, content, large_text_ref_id, content_hash, char_count,
                     utf8_byte_count, source_start_utf16, source_end_utf16, created_at)
                 VALUES ('reference-section-large', 'reference-import-large',
                         'reference-work-large', 'reference-large-source', 1, 'unstructured',
                         '全文', ?1, 'reference-section-document', ?2, ?3, ?4, 0, ?5, 'now')",
                params![
                    content.chars().take(4_000).collect::<String>(),
                    content_hash,
                    content.chars().count() as i64,
                    content.len() as i64,
                    content.encode_utf16().count() as i64,
                ],
            )
            .expect("seed reference section");

        let backup = export_project_backup_in_conn(&source, "reference-large-source")
            .expect("export large reference section");
        let restored = restore_project_backup_in_conn(&mut source, &backup)
            .expect("restore large reference section");
        let section = crate::services::reference_library_service::get_section_content(
            &source,
            &restored.novel_id,
            restored.id_map["reference-work-large"].as_str(),
            restored.id_map["reference-import-large"].as_str(),
            restored.id_map["reference-section-large"].as_str(),
        )
        .expect("read restored large reference section");
        assert_eq!(section.content, content);
    }
}
