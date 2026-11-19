use super::*;
use crate::domain::writing::{CreateChapterInput, CreateVolumeInput, UpdateVolumeInput};
use crate::services::{chapter_service, volume_service};

fn candidate(value:&Value, required:&[&str], allowed:&[&str])->Result<(),String> {
    let object=value.as_object().ok_or("OUTLINE_CANDIDATE_SCHEMA_INVALID")?;
    if object.keys().any(|key|!allowed.contains(&key.as_str())) {return Err("OUTLINE_CANDIDATE_SCHEMA_INVALID".into());}
    for key in required {if !value[*key].as_str().is_some_and(|value|!value.trim().is_empty() && value.len()<=200_000) {return Err("OUTLINE_CANDIDATE_SCHEMA_INVALID".into());}}
    for key in ["goal","mainConflict"] {if let Some(value)=object.get(key) {if !value.as_str().is_some_and(|value|value.len()<=200_000) {return Err("OUTLINE_CANDIDATE_SCHEMA_INVALID".into());}}}
    Ok(())
}
fn optional_text(value:&Value,key:&str)->Option<String>{value[key].as_str().map(str::to_string)}
fn create_volume(connection:&Connection,novel:&str,title:&str,body:Option<&Value>)->Result<String,String>{
    let order:i64=connection.query_row("SELECT COALESCE(MAX(order_index),-1)+1 FROM volumes WHERE novel_id=?1 AND deleted_at IS NULL",[novel],|row|row.get(0)).map_err(|error|error.to_string())?;
    Ok(volume_service::create_volume(connection,CreateVolumeInput{novel_id:novel.into(),title:title.into(),summary:body.and_then(|value|optional_text(value,"summary")),goal:body.and_then(|value|optional_text(value,"goal")),main_conflict:body.and_then(|value|optional_text(value,"mainConflict")),order_index:Some(order)})?.id)
}

pub(super) fn volume(connection:&Connection,input:&ApplyInput)->Result<Saved,String>{
    let Action::Volume{target_volume_id,candidate:value}=&input.action else{return Err("OUTLINE_ACTION_INVALID".into());};
    let request=&input.source.request;
    if request.format!="volume_candidate" || request.outline_type!="volume" || request.target_id!=*target_volume_id {return Err("OUTLINE_ACTION_SCOPE_INVALID".into());}
    candidate(value,&["title","summary"],&["title","summary","goal","mainConflict"])?;
    // One generated single-volume candidate cannot be replayed as multiple creates.
    let applied:i64=connection.query_row("SELECT COUNT(*) FROM tool_call_events WHERE run_id=?1 AND tool_name='dsh.outline_application_receipt' AND json_extract(result_json,'$.receipt.artifactId')=?2 AND json_extract(result_json,'$.receipt.entityType')='volume'",params![input.source.run_id,input.source.artifact_id],|row|row.get(0)).map_err(|error|error.to_string())?;
    if applied>0{return Err("OUTLINE_CANDIDATE_ALREADY_APPLIED".into());}
    let id=if let Some(id)=target_volume_id {
        let target=volume_service::get_volume(connection,id)?.ok_or("OUTLINE_SCOPE_MISMATCH")?;
        if target.novel_id!=input.source.novel_id{return Err("OUTLINE_SCOPE_MISMATCH".into());}
        volume_service::update_volume(connection,id,UpdateVolumeInput{title:optional_text(value,"title"),summary:optional_text(value,"summary"),goal:optional_text(value,"goal"),main_conflict:optional_text(value,"mainConflict"),order_index:None,status:None})?;
        id.clone()
    }else{create_volume(connection,&input.source.novel_id,value["title"].as_str().unwrap(),Some(value))?};
    Ok(Saved{entity_type:"volume",entity_id:id,content_hash:hash(value)?,candidate_index:None,created_volume_id:None})
}

pub(super) fn chapter(connection:&Connection,input:&ApplyInput,facts:&SourceFacts,receipts:&[Value])->Result<Saved,String>{
    let Action::Chapter{target_volume_id,candidate_index,candidate:value}=&input.action else{return Err("OUTLINE_ACTION_INVALID".into());};
    let request=&input.source.request;
    if request.format!="chapter_candidates" || request.outline_type!="chapter" || !facts.payload["chapters"].as_array().is_some_and(|items|*candidate_index<items.len()) {return Err("OUTLINE_ACTION_SCOPE_INVALID".into());}
    if receipts.iter().any(|receipt|receipt["candidateIndex"].as_u64()==Some(*candidate_index as u64)){return Err("OUTLINE_CANDIDATE_ALREADY_APPLIED".into());}
    candidate(value,&["title","outline"],&["title","outline","goal","targetWordCount"])?;
    let target=match value.get("targetWordCount") {Some(value)=>Some(value.as_i64().filter(|value|(1..=1_000_000).contains(value)).ok_or("OUTLINE_CANDIDATE_SCHEMA_INVALID")?),None=>Some(2500)};
    let created=receipts.iter().find_map(|receipt|receipt["createdVolumeId"].as_str()).map(str::to_string);
    let mut created_volume=None;
    let volume=if let Some(original)=request.volume_id.as_ref() {
        if target_volume_id.as_ref()!=Some(original){return Err("OUTLINE_ACTION_SCOPE_INVALID".into());}
        original.clone()
    }else if let Some(created)=created {
        if target_volume_id.as_ref().is_some_and(|target|target!=&created){return Err("OUTLINE_ACTION_SCOPE_INVALID".into());}
        created
    }else{
        if target_volume_id.is_some(){return Err("OUTLINE_ACTION_SCOPE_INVALID".into());}
        let count:i64=connection.query_row("SELECT COUNT(*) FROM volumes WHERE novel_id=?1 AND deleted_at IS NULL",[&input.source.novel_id],|row|row.get(0)).map_err(|error|error.to_string())?;
        if count!=0{return Err("OUTLINE_VOLUME_SCOPE_REQUIRED".into());}
        let id=create_volume(connection,&input.source.novel_id,"正文",None)?;
        created_volume=Some(id.clone());
        id
    };
    let owned=volume_service::get_volume(connection,&volume)?.ok_or("OUTLINE_SCOPE_MISMATCH")?;
    if owned.novel_id!=input.source.novel_id{return Err("OUTLINE_SCOPE_MISMATCH".into());}
    let order:i64=connection.query_row("SELECT COALESCE(MAX(order_index),-1)+1 FROM chapters WHERE novel_id=?1 AND volume_id=?2 AND deleted_at IS NULL",params![input.source.novel_id,volume],|row|row.get(0)).map_err(|error|error.to_string())?;
    let chapter=chapter_service::create_chapter(connection,CreateChapterInput{novel_id:input.source.novel_id.clone(),volume_id:Some(volume),title:value["title"].as_str().unwrap().to_string(),outline:optional_text(value,"outline"),goal:optional_text(value,"goal"),target_word_count:target,order_index:Some(order)})?;
    Ok(Saved{entity_type:"chapter",entity_id:chapter.id,content_hash:hash(value)?,candidate_index:Some(*candidate_index),created_volume_id:created_volume})
}
