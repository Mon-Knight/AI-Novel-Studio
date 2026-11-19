//! Authority-owned baselines. Only a successful receipt may replace a grant baseline.
use super::task_authorization_contract::IssueInput;
use crate::errors::AppError;
use crate::repositories::draft_repository;
use crate::services::{ai_fact_security, draft_service, world_rule_governance};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

pub(crate) fn error(code: &str, message: &str) -> AppError {
    AppError::new(code, message, false)
}
pub(crate) fn model_identity(model: &Value) -> Result<Value, AppError> {
    if ai_fact_security::contains_secret_value(model) {
        return Err(error(
            "TASK_AUTHORIZATION_MODEL_INVALID",
            "模型快照包含凭据",
        ));
    }
    for key in ["providerId", "modelId", "runtimeMode"] {
        if model
            .get(key)
            .and_then(Value::as_str)
            .is_none_or(|v| v.trim().is_empty())
        {
            return Err(error(
                "TASK_AUTHORIZATION_MODEL_INVALID",
                "冻结模型身份不完整",
            ));
        }
    }
    Ok(
        json!({"providerId":model["providerId"],"modelId":model["modelId"],
        "runtimeMode":model["runtimeMode"],"baseUrl":model.get("baseUrl"),
        "options":model.get("options"),"pricing":model.get("pricing")}),
    )
}
fn scoped_rows_hash(conn: &Connection, table: &str, scope: &str) -> Result<String, AppError> {
    let column = match table {
        "chapters" => "id",
        "chapter_outlines"
        | "chapter_summaries"
        | "context_records"
        | "character_states"
        | "chapter_engineering_states"
        | "chapter_characters" => "chapter_id",
        "master_outlines" | "volume_outlines" => "project_id",
        "characters" | "protagonists" => "novel_id",
        _ => return Err(error("TASK_AUTHORIZATION_BASELINE_INVALID", "未知基线实体")),
    };
    let mut statement = conn
        .prepare(&format!(
            "SELECT * FROM {table} WHERE {column}=?1 ORDER BY rowid"
        ))
        .map_err(AppError::database)?;
    let columns = statement
        .column_names()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let values = statement
        .query_map([scope], |row| {
            use rusqlite::types::ValueRef;
            let mut value = serde_json::Map::new();
            for (index, key) in columns.iter().enumerate() {
                let cell = match row.get_ref(index)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(v) => json!(v),
                    ValueRef::Real(v) => json!(v),
                    ValueRef::Text(v) => json!(std::str::from_utf8(v).map_err(|e| {
                        rusqlite::Error::FromSqlConversionFailure(
                            index,
                            rusqlite::types::Type::Text,
                            Box::new(e),
                        )
                    })?),
                    ValueRef::Blob(_) => {
                        return Err(rusqlite::Error::InvalidColumnType(
                            index,
                            key.clone(),
                            rusqlite::types::Type::Blob,
                        ))
                    }
                };
                value.insert(key.clone(), cell);
            }
            Ok(Value::Object(value))
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    ai_fact_security::canonical_hash(&json!(values))
}
fn chapter(conn: &Connection, novel: &str, id: &str) -> Result<Value, AppError> {
    draft_repository::validate_target(conn, novel, id)?;
    let (volume, title, outline, goal, status, updated, adopted): (Option<String>,String,Option<String>,Option<String>,String,String,Option<String>) = conn.query_row(
        "SELECT volume_id,title,outline,goal,status,updated_at,adopted_draft_id FROM chapters WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL",
        params![id,novel], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?)))
        .map_err(AppError::database)?;
    let draft = if let Some(draft_id) = adopted {
        let row = draft_repository::find_draft(conn, &draft_id)?
            .ok_or_else(|| error("TASK_AUTHORIZATION_BASELINE_INVALID", "采用稿缺失"))?;
        if !row.is_adopted || row.chapter_id != id || row.novel_id != novel {
            return Err(error(
                "TASK_AUTHORIZATION_BASELINE_INVALID",
                "采用稿归属不一致",
            ));
        }
        let full = draft_service::load_full_content(conn, &row)?;
        json!({"id":draft_id,"version":row.version_no,"hash":full.content_hash})
    } else {
        Value::Null
    };
    let mut rows = serde_json::Map::new();
    for table in [
        "chapters",
        "chapter_outlines",
        "chapter_summaries",
        "context_records",
        "character_states",
        "chapter_engineering_states",
        "chapter_characters",
    ] {
        rows.insert(table.into(), json!(scoped_rows_hash(conn, table, id)?));
    }
    Ok(
        json!({"id":id,"volumeId":volume,"title":title,"outline":outline,"goal":goal,"status":status,"revision":updated,"adoptedDraft":draft,"nativeRows":rows}),
    )
}
pub(crate) fn review_chapter_hash(
    conn: &Connection,
    novel: &str,
    id: &str,
) -> Result<String, AppError> {
    ai_fact_security::canonical_hash(&chapter(conn, novel, id)?)
}

pub(crate) fn all_chapters(conn: &Connection, novel: &str) -> Result<Vec<String>, AppError> {
    conn.prepare("SELECT id FROM chapters WHERE novel_id=?1 AND deleted_at IS NULL ORDER BY id")
        .map_err(AppError::database)?
        .query_map([novel], |r| r.get(0))
        .map_err(AppError::database)?
        .collect::<Result<_, _>>()
        .map_err(AppError::database)
}
pub(crate) fn capture(
    conn: &Connection,
    spec: &IssueInput,
    tracked: &[String],
) -> Result<Value, AppError> {
    let rules = world_rule_governance::rule_set_snapshot(conn, &spec.novel_id)?;
    let chapters = tracked
        .iter()
        .map(|id| chapter(conn, &spec.novel_id, id))
        .collect::<Result<Vec<_>, _>>()?;
    let structure = if spec.allow_novel_planning || spec.creation_scope.is_some() {
        let mut volumes=conn.prepare("SELECT id,title,summary,goal,main_conflict,order_index,status,updated_at,deleted_at FROM volumes WHERE novel_id=?1 ORDER BY id").map_err(AppError::database)?;
        let rows=volumes.query_map([&spec.novel_id], |r| Ok(json!({"id":r.get::<_,String>(0)?,"title":r.get::<_,String>(1)?,
            "summary":r.get::<_,Option<String>>(2)?,"goal":r.get::<_,Option<String>>(3)?,"conflict":r.get::<_,Option<String>>(4)?,
            "index":r.get::<_,i64>(5)?,"status":r.get::<_,String>(6)?,"revision":r.get::<_,String>(7)?,"deleted":r.get::<_,Option<String>>(8)?})))
            .map_err(AppError::database)?.collect::<Result<Vec<_>,_>>().map_err(AppError::database)?;
        let novel = conn
            .query_row(
                "SELECT outline,target_word_count FROM novels WHERE id=?1",
                [&spec.novel_id],
                |r| Ok(json!({"outline":r.get::<_,String>(0)?,"words":r.get::<_,Option<i64>>(1)?})),
            )
            .map_err(AppError::database)?;
        json!({"volumes":rows,"chapterIds":all_chapters(conn,&spec.novel_id)?,"novel":novel,
            "masterOutlineHash":scoped_rows_hash(conn,"master_outlines",&spec.novel_id)?,"volumeOutlineHash":scoped_rows_hash(conn,"volume_outlines",&spec.novel_id)?})
    } else {
        Value::Null
    };
    Ok(
        json!({"rules":rules.fingerprint,"chapters":chapters,"structure":structure,
        "charactersHash":scoped_rows_hash(conn,"characters",&spec.novel_id)?,"protagonistsHash":scoped_rows_hash(conn,"protagonists",&spec.novel_id)?}),
    )
}
pub(crate) fn tracked(baseline: &Value) -> Vec<String> {
    baseline
        .get("chapters")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|v| v.get("id").and_then(Value::as_str).map(str::to_string))
        .collect()
}
pub(crate) fn require_task(conn: &Connection, spec: &IssueInput) -> Result<Value, AppError> {
    let row=conn.query_row("SELECT c.default_model_json FROM task_conversations c JOIN conversation_turns t ON t.conversation_id=c.conversation_id
        WHERE c.conversation_id=?1 AND c.novel_id=?2 AND c.archived_at IS NULL AND t.turn_id=?3 AND t.role='user'",
        params![spec.conversation_id,spec.novel_id,spec.source_turn_id],|r|r.get::<_,Option<String>>(0))
        .optional().map_err(AppError::database)?.flatten().ok_or_else(||error("TASK_AUTHORIZATION_SCOPE_INVALID","授权必须绑定本任务的真实用户请求及明确模型"))?;
    let model: Value = serde_json::from_str(&row)
        .map_err(|_| error("TASK_AUTHORIZATION_MODEL_INVALID", "任务模型快照无效"))?;
    model_identity(&model)?;
    Ok(model)
}
