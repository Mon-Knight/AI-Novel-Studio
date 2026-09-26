//! 039 rebuilds `result_artifacts` parent FK so lineage can cross tasks.
//! Released 010 stays frozen. Runner disables FKs before this transaction, then restores dependents.

use crate::errors::{codes, AppError};
use rusqlite::{params, types::ValueRef, Connection, OptionalExtension, Transaction};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub(crate) const MIGRATION_ID: &str = "039_result_artifacts_cross_task_lineage";
pub(crate) const MIGRATION_DEFINITION: &str =
    "result_artifacts_cross_task_lineage_v1(safe_table_rebuild,single_column_parent_fk,explicit_dependents,verified_foreign_keys)";

const RELEASED_TABLE: &str = "result_artifacts";
const REBUILD_TABLE: &str = "result_artifacts_039_rebuild";
const RELEASED_PARENT_FK: &str =
    "FOREIGN KEY (task_id, parent_artifact_id) REFERENCES result_artifacts(task_id, artifact_id)";

#[rustfmt::skip]
const COLUMNS: &[&str] = &[
    "artifact_id", "task_id", "attempt_id", "source_input_snapshot_id",
    "artifact_type", "schema_version", "raw_content_ref_id", "display_content_ref_id",
    "display_content_hash", "structured_payload_ref_id", "structured_payload_hash",
    "source_novel_id", "source_chapter_id", "source_draft_id", "source_draft_version",
    "source_base_content_hash", "content_hash", "content_length", "processing_status",
    "parent_artifact_id", "derivation_type", "created_at",
];
#[rustfmt::skip]
const TABLE_INDEXES: &[&str] = &[
    "idx_result_artifacts_task_created", "idx_result_artifacts_attempt",
    "idx_result_artifacts_status_hash", "uq_result_artifacts_attempt_root",
];
#[rustfmt::skip]
const TABLE_TRIGGERS: &[&str] = &[
    "trg_result_artifacts_immutable_content", "trg_result_artifacts_immutable_delete",
    "trg_result_artifacts_status_edges", "trg_result_artifacts_validate_insert",
];
#[rustfmt::skip]
const OTHER_TRIGGERS: &[&str] = &[
    "trg_ai_tasks_result_artifact_link", "trg_ai_tasks_completed_artifact",
    "trg_ai_large_text_documents_immutable_update", "trg_ai_large_text_documents_immutable_delete",
    "trg_ai_large_text_chunks_immutable_insert", "trg_ai_large_text_chunks_immutable_update",
    "trg_ai_large_text_chunks_immutable_delete", "trg_placement_proposals_validate_artifact",
    "trg_conversation_artifact_cards_projection_insert",
];
struct ForeignKey {
    table: String,
    on_delete: String,
    cols: Vec<(String, Option<String>)>,
}

struct CatalogObject {
    kind: String,
    name: String,
    tbl_name: String,
    sql: String,
}

enum ParentKind {
    ReleasedComposite,
    Lineage,
    Other,
}

fn invalid(reason: &str, details: Value) -> AppError {
    AppError::new(
        codes::DATABASE_TRANSACTION_FAILED,
        "结果产物跨任务血缘迁移未完成，数据库保持原状",
        false,
    )
    .with_details(json!({ "migrationId": MIGRATION_ID, "reason": reason, "details": details }))
}

fn quoted(name: &str) -> String {
    let q = '"';
    let doubled = format!("{q}{q}");
    format!("{q}{}{q}", name.replace(q, doubled.as_str()))
}

fn table_sql(connection: &Connection, name: &str) -> Result<Option<String>, AppError> {
    connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
            params![name],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(AppError::database)
        .map(Option::flatten)
}

fn table_columns(connection: &Connection) -> Result<Vec<String>, AppError> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({})", quoted(RELEASED_TABLE)))
        .map_err(AppError::database)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(columns)
}

fn foreign_keys_enabled(connection: &Connection) -> Result<bool, AppError> {
    connection
        .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
        .map(|value| value == 1)
        .map_err(AppError::database)
}

fn grouped_foreign_keys(connection: &Connection) -> Result<Vec<ForeignKey>, AppError> {
    let mut statement = connection
        .prepare(
            r#"SELECT id, "table", "from", "to", on_delete
             FROM pragma_foreign_key_list(?1) ORDER BY id, seq"#,
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![RELEASED_TABLE], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    let mut grouped: Vec<ForeignKey> = Vec::new();
    let mut current_id = None;
    for (id, table, from, to, on_delete) in rows {
        if current_id == Some(id) {
            grouped.last_mut().expect("fk group").cols.push((from, to));
            continue;
        }
        current_id = Some(id);
        grouped.push(ForeignKey {
            table,
            on_delete,
            cols: vec![(from, to)],
        });
    }
    Ok(grouped)
}

fn from_cols(key: &ForeignKey) -> Vec<&str> {
    key.cols.iter().map(|(from, _)| from.as_str()).collect()
}

fn to_cols(key: &ForeignKey) -> Vec<Option<&str>> {
    key.cols.iter().map(|(_, to)| to.as_deref()).collect()
}

fn parent_kind(keys: &[ForeignKey]) -> ParentKind {
    let parents: Vec<&ForeignKey> = keys
        .iter()
        .filter(|key| key.table == RELEASED_TABLE)
        .collect();
    match parents.as_slice() {
        [key]
            if from_cols(key) == ["task_id", "parent_artifact_id"]
                && to_cols(key) == [Some("task_id"), Some("artifact_id")] =>
        {
            ParentKind::ReleasedComposite
        }
        [key]
            if from_cols(key) == ["parent_artifact_id"]
                && to_cols(key) == [Some("artifact_id")] =>
        {
            ParentKind::Lineage
        }
        _ => ParentKind::Other,
    }
}

fn keys_json(keys: &[ForeignKey]) -> Value {
    json!(keys
        .iter()
        .map(|key| json!({
            "table": key.table,
            "onDelete": key.on_delete,
            "from": from_cols(key),
            "to": key.cols.iter().map(|(_, to)| to.clone()).collect::<Vec<_>>(),
        }))
        .collect::<Vec<_>>())
}

fn has_fk(keys: &[ForeignKey], from: &[&str], table: &str) -> bool {
    keys.iter()
        .any(|key| key.table == table && from_cols(key) == from)
}

fn require_object(connection: &Connection, kind: &str, name: &str) -> Result<(), AppError> {
    let found: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type=?1 AND name=?2",
            params![kind, name],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if found == 1 {
        Ok(())
    } else {
        Err(invalid("missing_schema_object", json!({ "type": kind, "name": name })))
    }
}

fn foreign_key_violations(connection: &Connection) -> Result<Vec<Value>, AppError> {
    let mut statement = connection
        .prepare("PRAGMA foreign_key_check")
        .map_err(AppError::database)?;
    let violations = statement
        .query_map([], |row| {
            Ok(json!({
                "table": row.get::<_, String>(0)?,
                "rowId": row.get::<_, Option<i64>>(1)?,
                "parent": row.get::<_, String>(2)?,
            }))
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(violations)
}

fn verify_lineage_schema(connection: &Connection, keys: &[ForeignKey]) -> Result<(), AppError> {
    let ParentKind::Lineage = parent_kind(keys) else {
        return Err(invalid(
            "lineage_parent_fk_missing",
            json!({ "foreignKeys": keys_json(keys) }),
        ));
    };
    let parent = keys
        .iter()
        .find(|key| key.table == RELEASED_TABLE)
        .ok_or_else(|| invalid("lineage_parent_fk_missing", json!({})))?;
    if parent.on_delete != "RESTRICT" {
        return Err(invalid(
            "lineage_parent_fk_on_delete",
            json!({ "onDelete": parent.on_delete }),
        ));
    }
    for (from, table) in [
        (&["task_id", "attempt_id"][..], "ai_task_attempts"),
        (
            &["task_id", "source_input_snapshot_id"][..],
            "ai_input_snapshots",
        ),
        (&["raw_content_ref_id"][..], "large_text_documents"),
        (&["display_content_ref_id"][..], "large_text_documents"),
        (&["structured_payload_ref_id"][..], "large_text_documents"),
    ] {
        if !has_fk(keys, from, table) {
            return Err(invalid(
                "required_foreign_key_missing",
                json!({ "from": from, "table": table, "foreignKeys": keys_json(keys) }),
            ));
        }
    }
    let sql = table_sql(connection, RELEASED_TABLE)?
        .ok_or_else(|| invalid("patched_table_missing", json!({})))?;
    if !sql.contains("UNIQUE(task_id, artifact_id)")
        || sql.contains(RELEASED_PARENT_FK)
        || sql.contains("FOREIGN KEY (task_id, parent_artifact_id)")
    {
        return Err(invalid("rewritten_table_sql_invalid", json!({})));
    }
    let columns = table_columns(connection)?;
    if columns.as_slice() != COLUMNS {
        return Err(invalid("unexpected_columns", json!({ "columns": columns })));
    }
    for name in TABLE_INDEXES {
        require_object(connection, "index", name)?;
    }
    for name in TABLE_TRIGGERS.iter().chain(OTHER_TRIGGERS) {
        require_object(connection, "trigger", name)?;
    }
    let violations = foreign_key_violations(connection)?;
    if violations.is_empty() {
        Ok(())
    } else {
        Err(invalid("foreign_key_violation", json!(violations)))
    }
}

fn row_fingerprint(connection: &Connection) -> Result<(i64, String), AppError> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT {} FROM {RELEASED_TABLE} ORDER BY artifact_id",
            COLUMNS.join(", ")
        ))
        .map_err(AppError::database)?;
    let mut hasher = Sha256::new();
    let mut count = 0_i64;
    let mut rows = statement.query([]).map_err(AppError::database)?;
    while let Some(row) = rows.next().map_err(AppError::database)? {
        count += 1;
        for index in 0..COLUMNS.len() {
            hasher.update([0]);
            match row.get_ref(index).map_err(AppError::database)? {
                ValueRef::Null => hasher.update([1]),
                ValueRef::Integer(value) => hasher.update(value.to_le_bytes()),
                ValueRef::Real(value) => hasher.update(value.to_le_bytes()),
                ValueRef::Text(value) => hasher.update(value),
                ValueRef::Blob(value) => hasher.update(value),
            }
        }
    }
    Ok((count, format!("{:x}", hasher.finalize())))
}

fn catalog_dependents(connection: &Connection) -> Result<Vec<CatalogObject>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT type, name, tbl_name, sql FROM sqlite_master
             WHERE sql IS NOT NULL AND type IN ('index', 'trigger', 'view')
               AND (tbl_name = ?1 OR instr(sql, ?1) > 0)
             ORDER BY type, name",
        )
        .map_err(AppError::database)?;
    let objects = statement
        .query_map(params![RELEASED_TABLE], |row| {
            Ok(CatalogObject {
                kind: row.get(0)?,
                name: row.get(1)?,
                tbl_name: row.get(2)?,
                sql: row.get(3)?,
            })
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(objects)
}

fn require_expected_dependents(dependents: &[CatalogObject]) -> Result<(), AppError> {
    let names: Vec<&str> = dependents
        .iter()
        .map(|object| object.name.as_str())
        .collect();
    for name in TABLE_INDEXES
        .iter()
        .chain(TABLE_TRIGGERS)
        .chain(OTHER_TRIGGERS)
    {
        if !names.contains(name) {
            return Err(invalid("missing_dependent_object", json!({ "name": name })));
        }
    }
    Ok(())
}

fn rewritten_create_sql(
    released_sql: &str,
    table_name: &str,
    parent_target: &str,
) -> Result<String, AppError> {
    let prefix = if released_sql.starts_with("CREATE TABLE IF NOT EXISTS result_artifacts (") {
        "CREATE TABLE IF NOT EXISTS result_artifacts ("
    } else if released_sql.starts_with("CREATE TABLE result_artifacts (") {
        "CREATE TABLE result_artifacts ("
    } else {
        return Err(invalid("released_create_sql_unrecognized", json!({})));
    };
    if released_sql.matches(RELEASED_PARENT_FK).count() != 1 {
        return Err(invalid(
            "released_foreign_key_not_found",
            json!({ "occurrences": released_sql.matches(RELEASED_PARENT_FK).count() }),
        ));
    }
    let parent_fk =
        format!("FOREIGN KEY (parent_artifact_id) REFERENCES {parent_target}(artifact_id)");
    let replaced = released_sql.replacen(RELEASED_PARENT_FK, &parent_fk, 1);
    Ok(format!(
        "CREATE TABLE {table_name} ({}",
        &replaced[prefix.len()..]
    ))
}

fn drop_other_dependents(
    transaction: &Transaction<'_>,
    dependents: &[CatalogObject],
) -> Result<(), AppError> {
    for object in dependents {
        if object.tbl_name == RELEASED_TABLE {
            continue;
        }
        let sql = match object.kind.as_str() {
            "trigger" => format!("DROP TRIGGER {}", quoted(&object.name)),
            "view" => format!("DROP VIEW {}", quoted(&object.name)),
            kind => {
                return Err(invalid(
                    "unexpected_dependent",
                    json!({ "type": kind, "name": object.name }),
                ));
            }
        };
        transaction.execute(&sql, []).map_err(AppError::database)?;
    }
    Ok(())
}

fn restore_dependents(
    transaction: &Transaction<'_>,
    dependents: &[CatalogObject],
) -> Result<(), AppError> {
    for on_table in [true, false] {
        for kind in ["index", "trigger", "view"] {
            for object in dependents {
                if object.kind == kind && (object.tbl_name == RELEASED_TABLE) == on_table {
                    transaction
                        .execute_batch(&object.sql)
                        .map_err(AppError::database)?;
                }
            }
        }
    }
    Ok(())
}

fn copy_rows(transaction: &Transaction<'_>, from: &str, to: &str) -> Result<(), AppError> {
    let cols = COLUMNS.join(", ");
    transaction
        .execute(
            &format!("INSERT INTO {to} ({cols}) SELECT {cols} FROM {from}"),
            [],
        )
        .map_err(AppError::database)?;
    Ok(())
}

fn rebuild(transaction: &Transaction<'_>, released_sql: &str) -> Result<(), AppError> {
    let before = row_fingerprint(transaction)?;
    let dependents = catalog_dependents(transaction)?;
    require_expected_dependents(&dependents)?;
    let exists: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name=?1",
            params![REBUILD_TABLE],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if exists != 0 {
        return Err(invalid("rebuild_table_exists", json!({})));
    }
    drop_other_dependents(transaction, &dependents)?;
    transaction
        .execute_batch(&rewritten_create_sql(
            released_sql,
            REBUILD_TABLE,
            REBUILD_TABLE,
        )?)
        .map_err(AppError::database)?;
    copy_rows(transaction, RELEASED_TABLE, REBUILD_TABLE)?;
    transaction
        .execute(&format!("DROP TABLE {RELEASED_TABLE}"), [])
        .map_err(AppError::database)?;
    transaction
        .execute_batch(&rewritten_create_sql(
            released_sql,
            RELEASED_TABLE,
            RELEASED_TABLE,
        )?)
        .map_err(AppError::database)?;
    copy_rows(transaction, REBUILD_TABLE, RELEASED_TABLE)?;
    transaction
        .execute(&format!("DROP TABLE {REBUILD_TABLE}"), [])
        .map_err(AppError::database)?;
    restore_dependents(transaction, &dependents)?;
    if row_fingerprint(transaction)? != before {
        return Err(invalid("row_fingerprint_changed", json!({})));
    }
    Ok(())
}

pub(crate) fn apply(transaction: &Transaction<'_>) -> Result<(), AppError> {
    let released_sql = table_sql(transaction, RELEASED_TABLE)?
        .ok_or_else(|| invalid("released_table_missing", json!({})))?;
    let columns = table_columns(transaction)?;
    if columns.as_slice() != COLUMNS {
        return Err(invalid("unexpected_columns", json!({ "columns": columns })));
    }
    let keys = grouped_foreign_keys(transaction)?;
    match parent_kind(&keys) {
        ParentKind::Lineage => verify_lineage_schema(transaction, &keys),
        ParentKind::ReleasedComposite => {
            if foreign_keys_enabled(transaction)? {
                return Err(invalid("foreign_keys_must_be_off", json!({})));
            }
            rebuild(transaction, &released_sql)?;
            let keys = grouped_foreign_keys(transaction)?;
            verify_lineage_schema(transaction, &keys)
        }
        ParentKind::Other => Err(invalid(
            "released_foreign_key_not_found",
            json!({ "foreignKeys": keys_json(&keys) }),
        )),
    }
}
