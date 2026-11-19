//! Native scope and baseline checks shared by outline generation and manual application.
use super::{fail, hash, OutlineRequest, OutlineSource};
use crate::services::{artifact_service, world_rule_governance};
use rusqlite::{params, types::ValueRef, Connection, OptionalExtension};
use serde_json::{json, Value};

pub(super) struct SourceFacts {
    pub baseline_hash: String,
    pub payload: Value,
}

fn rows(connection: &Connection, sql: &str, scope: &str) -> Result<Value, String> {
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let columns = statement.column_names().iter().map(|name| name.to_string()).collect::<Vec<_>>();
    let values = statement.query_map([scope], |row| {
        let mut value = serde_json::Map::new();
        for (index, column) in columns.iter().enumerate() {
            let cell = match row.get_ref(index)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(value) => json!(value),
                ValueRef::Real(value) => json!(value),
                ValueRef::Text(value) => json!(String::from_utf8_lossy(value)),
                ValueRef::Blob(_) => return Err(rusqlite::Error::InvalidColumnType(index, column.clone(), rusqlite::types::Type::Blob)),
            };
            value.insert(column.clone(), cell);
        }
        Ok(Value::Object(value))
    }).map_err(|error| error.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|error| error.to_string())?;
    Ok(json!(values))
}

pub(crate) fn capture_baseline(connection: &Connection, novel: &str) -> Result<String, String> {
    let exists: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM novels WHERE id=?1 AND deleted_at IS NULL)",[novel],|row|row.get(0)).map_err(|error|error.to_string())?;
    if !exists { return Err(fail("OUTLINE_SCOPE_MISMATCH", "作品不存在或已删除")); }
    let mut value = serde_json::Map::new();
    for (key, sql) in [
        ("novel", "SELECT id,title,outline,target_word_count,updated_at FROM novels WHERE id=?1"),
        ("volumes", "SELECT * FROM volumes WHERE novel_id=?1 ORDER BY id"),
        ("chapters", "SELECT * FROM chapters WHERE novel_id=?1 ORDER BY id"),
        ("master", "SELECT * FROM master_outlines WHERE project_id=?1 ORDER BY id"),
        ("volumeOutlines", "SELECT * FROM volume_outlines WHERE project_id=?1 ORDER BY id"),
        ("chapterOutlines", "SELECT * FROM chapter_outlines WHERE project_id=?1 ORDER BY id"),
        ("protagonists", "SELECT * FROM protagonists WHERE novel_id=?1 ORDER BY id"),
        ("characters", "SELECT * FROM characters WHERE novel_id=?1 ORDER BY id"),
    ] { value.insert(key.into(), rows(connection, sql, novel)?); }
    value.insert("rules".into(), json!(world_rule_governance::rule_set_snapshot(connection, novel).map_err(|error|error.to_string())?.fingerprint));
    hash(&Value::Object(value))
}

fn owned(connection: &Connection, table: &str, scope_column: &str, id: &str, novel: &str) -> Result<(), String> {
    let deleted = if matches!(table,"volumes"|"chapters") {" AND deleted_at IS NULL"} else {""};
    let sql = format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1 AND {scope_column}=?2{deleted})");
    let exists: bool = connection.query_row(&sql,params![id,novel],|row|row.get(0)).map_err(|error|error.to_string())?;
    if !exists { return Err(fail("OUTLINE_SCOPE_MISMATCH", "大纲目标或上级版本不属于本作品")); }
    Ok(())
}

pub(crate) fn validate_request(connection: &Connection, novel: &str, chapter: Option<&str>, request: &OutlineRequest) -> Result<(), String> {
    if request.kind != "outline_generate" || !["master","volume","chapter"].contains(&request.outline_type.as_str()) || !["editor_text","volume_candidate","chapter_candidates"].contains(&request.format.as_str()) {
        return Err(fail("OUTLINE_REQUEST_INVALID", "未知的大纲生成类型或格式"));
    }
    for value in [&request.target_id,&request.volume_id,&request.parent_outline_id] {
        if value.as_ref().is_some_and(|value| value.trim().is_empty() || value.len()>200) { return Err("OUTLINE_REQUEST_INVALID".into()); }
    }
    if request.target_title.as_ref().is_some_and(|value|value.len()>2000) || request.chapter_goal.as_ref().is_some_and(|value|value.len()>10_000) || request.target_index.is_some_and(|value|!(1..=100_000).contains(&value)) { return Err("OUTLINE_REQUEST_INVALID".into()); }
    if request.outline_type == "master" && (request.format!="editor_text" || request.target_id.is_some() || request.volume_id.is_some() || request.parent_outline_id.is_some() || chapter.is_some()) { return Err("OUTLINE_REQUEST_SCOPE_INVALID".into()); }
    if request.format=="volume_candidate" && request.outline_type!="volume" || request.format=="chapter_candidates" && request.outline_type!="chapter" { return Err("OUTLINE_REQUEST_SCOPE_INVALID".into()); }
    if request.format=="chapter_candidates" {
        if !request.chapter_count.is_none_or(|count|(1..=50).contains(&count)) || chapter.is_some() { return Err("OUTLINE_CANDIDATE_COUNT_INVALID".into()); }
    } else if request.chapter_count.is_some() { return Err("OUTLINE_REQUEST_SCOPE_INVALID".into()); }
    if request.outline_type=="volume" && (chapter.is_some() || request.volume_id.is_some()) { return Err("OUTLINE_REQUEST_SCOPE_INVALID".into()); }
    if request.outline_type=="chapter" && request.format=="editor_text" && (request.target_id.is_none() || chapter!=request.target_id.as_deref()) { return Err("OUTLINE_CHAPTER_SCOPE_REQUIRED".into()); }
    if let Some(id)=request.target_id.as_deref() {
        owned(connection, if request.outline_type=="volume" {"volumes"} else {"chapters"}, "novel_id", id, novel)?;
    }
    if let Some(id)=request.volume_id.as_deref() { owned(connection,"volumes","novel_id",id,novel)?; }
    if let Some(id)=request.parent_outline_id.as_deref() {
        owned(connection, if request.outline_type=="chapter" {"volume_outlines"} else {"master_outlines"}, "project_id", id, novel)?;
    }
    if let (Some(chapter),Some(volume))=(request.target_id.as_deref().filter(|_|request.outline_type=="chapter"),request.volume_id.as_deref()) {
        let matches:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM chapters WHERE id=?1 AND volume_id=?2)",params![chapter,volume],|row|row.get(0)).map_err(|error|error.to_string())?;
        if !matches { return Err("OUTLINE_SCOPE_MISMATCH".into()); }
    }
    Ok(())
}

pub(super) fn validate_source(connection: &Connection, source: &OutlineSource) -> Result<SourceFacts, String> {
    if source.version!=1 || source.artifact_hash.len()!=64 { return Err("OUTLINE_SOURCE_INVALID".into()); }
    let row:Option<(String,String,Option<String>,String)>=connection.query_row("SELECT r.turn_id,r.conversation_id,r.chapter_id,e.arguments_summary_json FROM conversation_artifact_cards c JOIN task_runs r ON r.run_id=c.run_id JOIN tool_call_events e ON e.run_id=r.run_id AND e.tool_name='dsh.execution_contract' AND e.status='succeeded' WHERE r.status='completed' AND c.card_id=?1 AND c.artifact_id=?2 AND c.conversation_id=?3 AND c.run_id=?4 AND c.turn_id=?5",params![source.card_id,source.artifact_id,source.conversation_id,source.run_id,source.turn_id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional().map_err(|error|error.to_string())?;
    let (turn,conversation,chapter,raw)=row.ok_or("OUTLINE_SOURCE_REQUIRED")?;
    if turn!=source.turn_id || conversation!=source.conversation_id { return Err("OUTLINE_SCOPE_MISMATCH".into()); }
    let contract:Value=serde_json::from_str(&raw).map_err(|_|"OUTLINE_SOURCE_CONTRACT_INVALID")?;
    let policy=contract.pointer("/execution/domainPolicy").ok_or("OUTLINE_SOURCE_CONTRACT_REQUIRED")?;
    if contract["source"]!="ans-host" || policy["kind"]!="outline_generate" || contract.pointer("/execution/scope/novelId").and_then(Value::as_str)!=Some(&source.novel_id) { return Err("OUTLINE_SOURCE_CONTRACT_INVALID".into()); }
    let frozen:OutlineRequest=serde_json::from_value(policy["outlineRequest"].clone()).map_err(|_|"OUTLINE_SOURCE_CONTRACT_INVALID")?;
    if frozen!=source.request { return Err("OUTLINE_SCOPE_MISMATCH".into()); }
    validate_request(connection,&source.novel_id,chapter.as_deref(),&source.request)?;
    let rules=world_rule_governance::rule_set_snapshot(connection,&source.novel_id).map_err(|error|error.to_string())?.fingerprint;
    if policy["outlineRulesFingerprint"].as_str()!=Some(&rules) { return Err(fail("OUTLINE_RULE_BASELINE_CONFLICT", "候选生成后世界规则已变化，不能用新的章节基线绕过来源校验")); }
    let bundle=artifact_service::get_artifact_bundle(connection,&source.artifact_id).map_err(|error|error.to_string())?;
    if bundle.artifact.source_novel_id.as_deref()!=Some(source.novel_id.as_str()) || bundle.artifact.source_chapter_id!=chapter || bundle.artifact.content_hash!=source.artifact_hash || bundle.artifact.artifact_type!="generic_json" || !matches!(bundle.artifact.processing_status.as_str(),"valid"|"valid_with_warnings") { return Err("OUTLINE_SOURCE_OR_VALIDATION_INVALID".into()); }
    let envelope:Value=serde_json::from_str(&bundle.raw_content).map_err(|_|"OUTLINE_CANDIDATE_SCHEMA_INVALID")?;
    if envelope["entryKind"]!="outline_generate" || envelope["stageKey"]!=source.request.format { return Err("OUTLINE_CANDIDATE_SCHEMA_INVALID".into()); }
    let schema=crate::services::dsh::task_runtime::domain_entry::candidate_schema::schema("outline_generate",&source.request.format)?;
    crate::services::dsh::task_runtime::domain_entry::candidate_schema::validate(&schema,&envelope["payload"])?;
    if source.request.format=="chapter_candidates" && envelope["payload"]["chapters"].as_array().is_none_or(|items|items.len()>source.request.chapter_count.unwrap_or(6) as usize) { return Err("OUTLINE_CANDIDATE_COUNT_INVALID".into()); }
    Ok(SourceFacts{baseline_hash:policy["outlineBaselineHash"].as_str().ok_or("OUTLINE_BASELINE_REQUIRED")?.to_string(),payload:envelope["payload"].clone()})
}
