//! 042 permits genuine library scope in the SAME task/candidate facts.
//! The runner must disable FKs before its IMMEDIATE transaction; no released SQL is edited.
use crate::errors::AppError;
use rusqlite::{params, types::ValueRef, Connection, Transaction};
use sha2::{Digest, Sha256};

pub(crate) const MIGRATION_ID: &str = "042_library_task_scope";
pub(crate) const MIGRATION_DEFINITION: &str = "library_task_scope_v1(nullable_novel_identity,three_fact_safe_rebuild,old_row_fingerprints,preserved_dependents,immutable_bounded_source,exact_task_run_artifact_scope,no_formal_authority,foreign_key_check)";
const TABLES: [&str; 3] = ["task_conversations", "ai_tasks", "result_artifacts"];

fn invalid(reason: &str) -> AppError {
    AppError::new("LIBRARY_SCOPE_MIGRATION_FAILED", reason, false)
}
fn quote(value: &str) -> String { format!("\"{}\"", value.replace('"', "\"\"")) }
fn replace(sql: String, from: &str, to: &str) -> Result<String, AppError> {
    if sql.matches(from).count() != 1 { return Err(invalid("未识别的旧表约束，停止 library 迁移")); }
    Ok(sql.replacen(from, to, 1))
}
fn columns(conn: &Connection, table: &str) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", quote(table))).map_err(AppError::database)?;
    let rows = stmt.query_map([], |row| row.get(1)).map_err(AppError::database)?;
    rows.collect::<Result<_, _>>().map_err(AppError::database)
}
fn fingerprint(conn: &Connection, table: &str, columns: &[String]) -> Result<(usize, String), AppError> {
    let names = columns.iter().map(|c| quote(c)).collect::<Vec<_>>().join(",");
    let mut stmt = conn.prepare(&format!("SELECT {names} FROM {} ORDER BY {}", quote(table), quote(&columns[0]))).map_err(AppError::database)?;
    let mut rows = stmt.query([]).map_err(AppError::database)?;
    let mut hasher = Sha256::new();
    let mut count = 0usize;
    while let Some(row) = rows.next().map_err(AppError::database)? {
        count += 1;
        for index in 0..columns.len() {
            match row.get_ref(index).map_err(AppError::database)? {
                ValueRef::Null => hasher.update([0]),
                ValueRef::Integer(v) => { hasher.update([1]); hasher.update(v.to_le_bytes()); }
                ValueRef::Real(v) => { hasher.update([2]); hasher.update(v.to_le_bytes()); }
                ValueRef::Text(v) => { hasher.update([3]); hasher.update(v.len().to_le_bytes()); hasher.update(v); }
                ValueRef::Blob(v) => { hasher.update([4]); hasher.update(v.len().to_le_bytes()); hasher.update(v); }
            }
        }
    }
    Ok((count, format!("{:x}", hasher.finalize())))
}
fn rewrite_table(table: &str, sql: String) -> Result<String, AppError> {
    let mut sql = replace(sql, if table == "result_artifacts" { "source_novel_id TEXT NOT NULL" } else { "novel_id TEXT NOT NULL" }, if table == "result_artifacts" { "source_novel_id TEXT" } else { "novel_id TEXT" })?;
    if table == "ai_tasks" {
        sql = replace(sql, "('system','novel','chapter','draft','selection')", "('system','novel','chapter','draft','selection','library')")?;
        sql = replace(sql, "(scope_type = 'system' AND novel_id = 'system'", "(scope_type = 'library' AND novel_id IS NULL AND chapter_id IS NULL AND draft_id IS NULL) OR\n                    (scope_type = 'system' AND novel_id = 'system'")?;
    }
    if table == "task_conversations" {
        let start = sql.find('(').ok_or_else(|| invalid("缺少表定义起点"))? + 1;
        sql.insert_str(start, "scope_type TEXT NOT NULL DEFAULT 'novel' CHECK(scope_type IN ('novel','library')), source_snapshot_json TEXT DEFAULT NULL, ");
    }
    let extra = match table {
        "task_conversations" => ", CHECK((scope_type='novel' AND novel_id IS NOT NULL AND source_snapshot_json IS NULL) OR (scope_type='library' AND novel_id IS NULL AND source_snapshot_json IS NOT NULL AND json_valid(source_snapshot_json)))",
        "ai_tasks" => ", CHECK((scope_type='library' AND novel_id IS NULL AND chapter_id IS NULL AND draft_id IS NULL AND task_type='style_analyze' AND expected_artifact_type='style_analysis') OR (scope_type<>'library' AND novel_id IS NOT NULL))",
        "result_artifacts" => ", CHECK(source_novel_id IS NOT NULL OR (artifact_type='style_analysis' AND source_chapter_id IS NULL AND source_draft_id IS NULL AND source_draft_version IS NULL AND source_base_content_hash IS NULL))",
        _ => return Err(invalid("未知重建表")),
    };
    let end = sql.rfind(')').ok_or_else(|| invalid("缺少表定义终点"))?;
    sql.insert_str(end, extra);
    Ok(sql)
}
fn rewrite_dependent(name: &str, sql: String) -> Result<String, AppError> {
    match name {
        "trg_ai_tasks_validate_target_insert" => replace(sql, "NEW.scope_type <> 'system'", "NEW.scope_type NOT IN ('system','library')"),
        "trg_result_artifacts_validate_insert" => replace(sql, "t.novel_id = NEW.source_novel_id", "t.novel_id IS NEW.source_novel_id"),
        "trg_conversation_artifact_cards_projection_insert" => replace(sql, "t.novel_id = c.novel_id", "(t.novel_id = c.novel_id OR (c.scope_type='library' AND t.scope_type='library' AND t.novel_id IS NULL AND a.source_novel_id IS NULL AND a.artifact_type='style_analysis' AND json_extract(t.target_hint_json,'$.conversationId')=NEW.conversation_id AND json_extract(t.target_hint_json,'$.turnId')=NEW.turn_id AND json_extract(t.target_hint_json,'$.runId')=NEW.run_id AND json_extract(t.target_hint_json,'$.librarySourceId')=json_extract(c.source_snapshot_json,'$.sourceId') AND json_extract(t.target_hint_json,'$.librarySourceHash')=json_extract(c.source_snapshot_json,'$.sourceHash')))"),
        _ => Ok(sql),
    }
}

pub(crate) fn apply(tx: &Transaction<'_>) -> Result<(), AppError> {
    let fk: i64 = tx.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).map_err(AppError::database)?;
    if fk != 0 { return Err(invalid("042 必须在事务开始前关闭 FK，并在提交后恢复")); }
    let mut stmt = tx.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('index','trigger','view') AND (tbl_name IN ('task_conversations','ai_tasks','result_artifacts') OR instr(sql,'task_conversations')>0 OR instr(sql,'ai_tasks')>0 OR instr(sql,'result_artifacts')>0) ORDER BY type,name").map_err(AppError::database)?;
    let objects: Vec<(String, String, String)> = stmt.query_map([], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(AppError::database)?.collect::<Result<_, _>>().map_err(AppError::database)?;
    drop(stmt);
    for name in ["trg_ai_tasks_validate_target_insert", "trg_result_artifacts_validate_insert", "trg_conversation_artifact_cards_projection_insert", "trg_task_authorizations_scope"] {
        if !objects.iter().any(|(_, found, _)| found == name) { return Err(invalid("旧数据库缺少必要作用域约束")); }
    }
    for (kind, name, _) in &objects {
        tx.execute(&format!("DROP {} {}", kind.to_ascii_uppercase(), quote(name)), []).map_err(AppError::database)?;
    }
    for table in TABLES {
        let old_sql: String = tx.query_row("SELECT sql FROM sqlite_master WHERE type='table' AND name=?1", [table], |r| r.get(0)).map_err(AppError::database)?;
        let cols = columns(tx, table)?;
        if cols.is_empty() || cols.iter().any(|c| c == "source_snapshot_json") { return Err(invalid("未知或部分已迁移的表结构")); }
        let before = fingerprint(tx, table, &cols)?;
        let names = cols.iter().map(|c| quote(c)).collect::<Vec<_>>().join(",");
        let temporary = format!("{table}_042_rebuild");
        let sql = rewrite_table(table, old_sql)?;
        let first_paren = sql.find('(').ok_or_else(|| invalid("无效 CREATE TABLE"))?;
        let temporary_sql = format!("CREATE TABLE {} {}", quote(&temporary), &sql[first_paren..]);
        tx.execute_batch(&temporary_sql).map_err(AppError::database)?;
        tx.execute(&format!("INSERT INTO {} ({names}) SELECT {names} FROM {}", quote(&temporary), quote(table)), []).map_err(AppError::database)?;
        tx.execute(&format!("DROP TABLE {}", quote(table)), []).map_err(AppError::database)?;
        tx.execute_batch(&sql).map_err(AppError::database)?;
        tx.execute(&format!("INSERT INTO {} ({names}) SELECT {names} FROM {}", quote(table), quote(&temporary)), []).map_err(AppError::database)?;
        tx.execute(&format!("DROP TABLE {}", quote(&temporary)), []).map_err(AppError::database)?;
        if fingerprint(tx, table, &cols)? != before { return Err(invalid("旧作品事实指纹发生变化，事务回滚")); }
    }
    for (_, name, sql) in objects { tx.execute_batch(&rewrite_dependent(&name, sql)?).map_err(AppError::database)?; }
    tx.execute_batch(LIBRARY_GUARDS).map_err(AppError::database)?;
    let violations: i64 = tx.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).map_err(AppError::database)?;
    if violations != 0 { return Err(invalid("library 迁移外键复验失败")); }
    Ok(())
}

const LIBRARY_GUARDS: &str = "
CREATE INDEX idx_task_conversations_scope ON task_conversations(scope_type,updated_at DESC);
CREATE TRIGGER trg_task_conversations_scope_immutable BEFORE UPDATE OF novel_id,scope_type,source_snapshot_json ON task_conversations
WHEN NEW.novel_id IS NOT OLD.novel_id OR NEW.scope_type<>OLD.scope_type OR NEW.source_snapshot_json IS NOT OLD.source_snapshot_json
BEGIN SELECT RAISE(ABORT,'immutable task scope'); END;
CREATE TRIGGER trg_library_source_validate BEFORE INSERT ON task_conversations WHEN NEW.scope_type='library' AND (
 COALESCE(json_type(NEW.source_snapshot_json,'$.sourceId'),'')<>'text' OR length(json_extract(NEW.source_snapshot_json,'$.sourceId')) NOT BETWEEN 1 AND 160
 OR COALESCE(length(json_extract(NEW.source_snapshot_json,'$.sourceHash')),0)<>64
 OR COALESCE(json_extract(NEW.source_snapshot_json,'$.utf8ByteLength'),0) NOT BETWEEN 1 AND 80000
 OR NOT EXISTS(SELECT 1 FROM large_text_documents d WHERE d.id=json_extract(NEW.source_snapshot_json,'$.bodyRefId') AND d.target_type='task_source' AND d.target_id=NEW.conversation_id AND d.field_name='style_source' AND d.status='ready' AND d.content_sha256=json_extract(NEW.source_snapshot_json,'$.bodyHash')))
BEGIN SELECT RAISE(ABORT,'invalid library source'); END;
CREATE TRIGGER trg_library_task_target BEFORE INSERT ON ai_tasks WHEN NEW.scope_type='library' AND NOT EXISTS(
 SELECT 1 FROM task_conversations c JOIN task_runs r ON r.conversation_id=c.conversation_id
 WHERE c.scope_type='library' AND c.novel_id IS NULL AND c.conversation_id=json_extract(NEW.target_hint_json,'$.conversationId')
 AND r.run_id=json_extract(NEW.target_hint_json,'$.runId') AND r.turn_id=json_extract(NEW.target_hint_json,'$.turnId')
 AND json_extract(c.source_snapshot_json,'$.sourceId')=json_extract(NEW.target_hint_json,'$.librarySourceId')
 AND json_extract(c.source_snapshot_json,'$.sourceHash')=json_extract(NEW.target_hint_json,'$.librarySourceHash'))
BEGIN SELECT RAISE(ABORT,'invalid library task ownership'); END;
CREATE TRIGGER trg_library_task_no_apply BEFORE UPDATE OF status ON ai_tasks WHEN OLD.scope_type='library' AND NEW.status IN ('applying','applied')
BEGIN SELECT RAISE(ABORT,'library task has no formal write authority'); END;
CREATE TRIGGER trg_library_run_no_chapter BEFORE INSERT ON task_runs WHEN NEW.chapter_id IS NOT NULL AND EXISTS(SELECT 1 FROM task_conversations c WHERE c.conversation_id=NEW.conversation_id AND c.scope_type='library')
BEGIN SELECT RAISE(ABORT,'library task cannot access chapters'); END;
CREATE TRIGGER trg_library_task_no_grant BEFORE INSERT ON task_authorizations WHEN EXISTS(SELECT 1 FROM task_conversations c WHERE c.conversation_id=NEW.conversation_id AND c.scope_type='library')
BEGIN SELECT RAISE(ABORT,'library task cannot receive novel authorization'); END;
CREATE TRIGGER trg_library_source_document_update BEFORE UPDATE ON large_text_documents WHEN EXISTS(SELECT 1 FROM task_conversations WHERE json_extract(source_snapshot_json,'$.bodyRefId')=OLD.id)
BEGIN SELECT RAISE(ABORT,'immutable task source'); END;
CREATE TRIGGER trg_library_source_document_delete BEFORE DELETE ON large_text_documents WHEN EXISTS(SELECT 1 FROM task_conversations WHERE json_extract(source_snapshot_json,'$.bodyRefId')=OLD.id)
BEGIN SELECT RAISE(ABORT,'immutable task source'); END;
CREATE TRIGGER trg_library_source_chunk_insert BEFORE INSERT ON large_text_chunks WHEN EXISTS(SELECT 1 FROM task_conversations WHERE json_extract(source_snapshot_json,'$.bodyRefId')=NEW.document_id)
BEGIN SELECT RAISE(ABORT,'immutable task source'); END;
CREATE TRIGGER trg_library_source_chunk_update BEFORE UPDATE ON large_text_chunks WHEN EXISTS(SELECT 1 FROM task_conversations WHERE json_extract(source_snapshot_json,'$.bodyRefId') IN (NEW.document_id,OLD.document_id))
BEGIN SELECT RAISE(ABORT,'immutable task source'); END;
CREATE TRIGGER trg_library_source_chunk_delete BEFORE DELETE ON large_text_chunks WHEN EXISTS(SELECT 1 FROM task_conversations WHERE json_extract(source_snapshot_json,'$.bodyRefId')=OLD.document_id)
BEGIN SELECT RAISE(ABORT,'immutable task source'); END;";

#[cfg(test)]
#[path = "migrations_library_task_scope_tests.rs"]
mod tests;
