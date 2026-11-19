//! Freeze the exact host-derived domain input as an existing ToolCallEvent and
//! LargeText source. ContextSnapshot evidence can reference it without previews.
use super::{context,entry,StartTaskTurnInput};
use crate::repositories::large_text_repository;
use crate::services::{ai_fact_security,conversation_service};
use rusqlite::{params,Connection,OptionalExtension};
use serde_json::json;
pub(crate) fn record_context(connection:&mut Connection,input:&StartTaskTurnInput,run_id:&str)->Result<(),String>{
    if entry(input).is_none(){return Ok(());}
    let stage=context(input)?;
    if ai_fact_security::contains_secret_value(stage){return Err("DOMAIN_CONTEXT_SECRET_REJECTED".to_string());}
    let text=ai_fact_security::canonical_json(stage).map_err(|error|error.to_string())?;
    if text.len()>2*1024*1024{return Err("DOMAIN_CONTEXT_LIMIT_REACHED".to_string());}
    let hash=large_text_repository::sha256(&text);let event_id=format!("{run_id}-domain-context");let document_id=format!("{event_id}-text");
    let prior:Option<String>=connection.query_row("SELECT result_json FROM tool_call_events WHERE event_id=?1 AND run_id=?2 AND status='succeeded'",params![event_id,run_id],|row|row.get(0)).optional().map_err(|error|error.to_string())?;
    if let Some(prior)=prior{
        let value:serde_json::Value=serde_json::from_str(&prior).map_err(|_|"DOMAIN_CONTEXT_RECEIPT_INVALID")?;
        if value["contentHash"]!=hash{return Err("DOMAIN_CONTEXT_BASE_CONFLICT".to_string());}
        let verified=large_text_repository::read_verified_document(connection,&document_id).map_err(|error|error.to_string())?;
        if verified.content_hash!=hash{return Err("DOMAIN_CONTEXT_BASE_CONFLICT".to_string());}return Ok(());
    }
    let now=chrono::Utc::now().to_rfc3339();
    conversation_service::append_tool_event(connection,conversation_service::AppendToolEventInput{event_id:event_id.clone(),run_id:run_id.to_string(),tool_name:"domain.stage_context".to_string(),arguments_summary:json!({"source":"ans-native-host","toolVersion":"1","argumentsHash":hash,"entryKind":stage.get("entryKind"),"stageKey":stage.get("stageKey"),"planId":stage.get("planId"),"expectedRevision":stage.get("expectedRevision"),"formalWrite":false}),status:"running".to_string(),duration_ms:None,error:None,result:None,created_at:now.clone(),finished_at:None}).map_err(|error|error.to_string())?;
    large_text_repository::insert_document_for_target(connection,&document_id,"tool_event",&event_id,"domain_stage_context",None,&text,&hash,&now).map_err(|error|error.to_string())?;
    conversation_service::update_tool_event(connection,conversation_service::UpdateToolEventInput{event_id,status:"succeeded".to_string(),duration_ms:None,error:None,result:Some(json!({"largeTextRefId":document_id,"contentHash":hash,"contentChars":text.chars().count(),"formalWrite":false})),finished_at:Some(now)}).map_err(|error|error.to_string())?;
    Ok(())
}
