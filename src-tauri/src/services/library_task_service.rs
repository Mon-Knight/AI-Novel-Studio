//! Library task admission over existing conversation/run/AI fact tables.
use crate::errors::AppError;
use crate::repositories::{conversation_repository as conversations, large_text_repository as text};
use crate::services::{ai_fact_security, task_style_source::{self, StyleSourceSnapshot}};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateLibraryTaskInput {
    pub conversation_id: String,
    pub turn_id: String,
    pub title: String,
    pub goal: String,
    pub default_model: Value,
    pub created_at: String,
    pub source: StyleSourceSnapshot,
}

fn invalid(message: &str) -> AppError { AppError::new("LIBRARY_TASK_SCOPE_INVALID", message, false) }

fn initialized(connection: &Connection, conversation_id: &str, turn_id: &str) -> Result<conversations::InitializedTaskConversation, AppError> {
    let conversation = conversations::get_conversation(connection, conversation_id)?.ok_or_else(|| invalid("任务不存在"))?;
    let turn = connection.query_row("SELECT turn_id,conversation_id,sequence,role,content,run_id,created_at FROM conversation_turns WHERE turn_id=?1 AND conversation_id=?2 AND role='user'",params![turn_id,conversation_id],|r| Ok(conversations::ConversationTurnRecord {turn_id:r.get(0)?,conversation_id:r.get(1)?,sequence:r.get(2)?,role:r.get(3)?,content:r.get(4)?,run_id:r.get(5)?,created_at:r.get(6)?})).map_err(AppError::database)?;
    Ok(conversations::InitializedTaskConversation { conversation, turn })
}

pub fn create_initialized(connection: &mut Connection, input: CreateLibraryTaskInput) -> Result<conversations::InitializedTaskConversation, AppError> {
    for (value, field, max) in [(&input.conversation_id,"conversationId",160),(&input.turn_id,"turnId",160),(&input.title,"title",160),(&input.goal,"goal",2_000),(&input.created_at,"createdAt",80)] {
        ai_fact_security::validate_identifier(value,field,max)?;
    }
    if !input.default_model.is_object() || input.default_model.pointer("/runtime/toolCallingAttestation").is_some() {
        return Err(invalid("模型快照无效或自报模型认证"));
    }
    ai_fact_security::validate_metadata(&input.default_model,"冻结模型")?;
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(AppError::database)?;
    task_style_source::validate_source(&tx, None, &input.source)?;
    let body = ai_fact_security::canonical_json(&serde_json::to_value(&input.source).map_err(|_| invalid("来源快照无法序列化"))?)?;
    let body_hash = text::sha256(&body);
    let existing: Option<Option<String>> = tx.query_row("SELECT source_snapshot_json FROM task_conversations WHERE conversation_id=?1",[&input.conversation_id],|r|r.get(0)).optional().map_err(AppError::database)?;
    if let Some(existing) = existing {
        let metadata:Value = serde_json::from_str(&existing.ok_or_else(|| invalid("任务不是 library scope"))?).map_err(|_|invalid("来源证据损坏"))?;
        let persisted = initialized(&tx,&input.conversation_id,&input.turn_id)?;
        if persisted.conversation.novel_id.is_some() || persisted.conversation.default_model.as_ref()!=Some(&input.default_model)
            || persisted.conversation.title!=input.title || persisted.turn.content!=input.goal || metadata["bodyHash"]!=body_hash
        { return Err(invalid("相同任务身份对应不同来源、模型或目标")); }
        tx.commit().map_err(AppError::database)?;
        return Ok(persisted);
    }
    let document_id = uuid::Uuid::new_v4().to_string();
    text::insert_document_for_target(&tx,&document_id,"task_source",&input.conversation_id,"style_source",None,&body,&body_hash,&input.created_at)?;
    let source = json!({"sourceId":input.source.source_id,"sourceHash":input.source.content_hash,"utf8ByteLength":input.source.utf8_byte_length,"bodyRefId":document_id,"bodyHash":body_hash});
    tx.execute("INSERT INTO task_conversations(conversation_id,novel_id,title,status,default_model_json,created_at,updated_at,scope_type,source_snapshot_json) VALUES(?1,NULL,?2,'idle',?3,?4,?4,'library',?5)",params![input.conversation_id,input.title,ai_fact_security::canonical_json(&input.default_model)?,input.created_at,source.to_string()]).map_err(AppError::database)?;
    tx.execute("INSERT INTO conversation_turns(turn_id,conversation_id,sequence,role,content,created_at) VALUES(?1,?2,0,'user',?3,?4)",params![input.turn_id,input.conversation_id,input.goal,input.created_at]).map_err(AppError::database)?;
    let result=initialized(&tx,&input.conversation_id,&input.turn_id)?;
    if let Err(error)=tx.commit() {
        // A response/commit error is not permission to create a new task or replay a model call.
        let persisted=initialized(connection,&input.conversation_id,&input.turn_id);
        if let Ok(persisted)=persisted {
            if load_source(connection,&input.conversation_id)?.content_hash==input.source.content_hash { return Ok(persisted); }
        }
        return Err(AppError::new("DATABASE_COMMIT_UNKNOWN",format!("任务提交结果未确认：{error}"),true));
    }
    Ok(result)
}

pub fn source_metadata(connection:&Connection, conversation_id:&str)->Result<Value,AppError> {
    let raw:Option<String>=connection.query_row("SELECT source_snapshot_json FROM task_conversations WHERE conversation_id=?1 AND scope_type='library' AND novel_id IS NULL",[conversation_id],|r|r.get(0)).optional().map_err(AppError::database)?.flatten();
    serde_json::from_str(&raw.ok_or_else(||invalid("不是当前 library 任务"))?).map_err(|_|invalid("来源证据损坏"))
}

pub fn load_source(connection:&Connection,conversation_id:&str)->Result<StyleSourceSnapshot,AppError> {
    let metadata=source_metadata(connection,conversation_id)?;
    let doc=metadata["bodyRefId"].as_str().ok_or_else(||invalid("来源引用缺失"))?;
    text::validate_document_target(connection,doc,"task_source",conversation_id,"style_source")?;
    let body=text::read_verified_document(connection,doc)?;
    if metadata["bodyHash"]!=body.content_hash { return Err(invalid("来源快照哈希不一致")); }
    let source:StyleSourceSnapshot=serde_json::from_str(&body.content).map_err(|_|invalid("来源快照无效"))?;
    if metadata["sourceId"]!=source.source_id || metadata["sourceHash"]!=source.content_hash || metadata["utf8ByteLength"]!=source.utf8_byte_length { return Err(invalid("来源绑定不一致")); }
    task_style_source::validate_source(connection,None,&source)?;
    Ok(source)
}

pub fn validate_runtime_scope(connection:&Connection,conversation_id:&str,turn_id:&str,source_id:&str,source_hash:&str)->Result<String,AppError> {
    let metadata=source_metadata(connection,conversation_id)?;
    if metadata["sourceId"]!=source_id || metadata["sourceHash"]!=source_hash { return Err(invalid("library 来源不属于当前任务")); }
    let result=initialized(connection,conversation_id,turn_id)?;
    if result.conversation.archived_at.is_some() { return Err(invalid("归档任务不能运行")); }
    load_source(connection,conversation_id)?;
    Ok(result.turn.content)
}

pub fn validate_ai_task_scope(connection:&Connection,input:&crate::services::ai_task_service::CreateAiTaskInput)->Result<(),AppError> {
    if input.novel_id.is_some() || input.chapter_id.is_some() || input.draft_id.is_some() || input.task_type!="style_analyze" || input.expected_artifact_type!="style_analysis" { return Err(invalid("library 任务不得扩大作品、章节或候选权限")); }
    let hint=input.target_hint_json.as_ref().ok_or_else(||invalid("缺少任务来源"))?;
    let field=|key:&str|hint[key].as_str().ok_or_else(||invalid("缺少精确任务来源身份"));
    let conversation=field("conversationId")?;
    let turn=field("turnId")?;
    validate_runtime_scope(connection,conversation,turn,field("librarySourceId")?,field("librarySourceHash")?)?;
    let model:Option<String>=connection.query_row("SELECT model_snapshot_json FROM task_runs WHERE run_id=?1 AND conversation_id=?2 AND turn_id=?3",params![field("runId")?,conversation,turn],|r|r.get(0)).optional().map_err(AppError::database)?;
    let model:Value=serde_json::from_str(&model.ok_or_else(||invalid("library AI 请求不属于当前运行"))?).map_err(|_|invalid("运行模型快照损坏"))?;
    if hint.get("modelSnapshot")!=Some(&model) {return Err(invalid("library AI 请求改变了冻结模型"));}
    Ok(())
}

#[cfg(test)]
#[path="library_task_service_tests.rs"]
mod tests;
