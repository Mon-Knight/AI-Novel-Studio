use super::*;

fn active(connection: &Connection, kind: &str, novel: &str, target: &Option<String>) -> Result<Option<Value>,String> {
    let (table,entity)=table(kind)?;
    let scope=if kind=="master" {""} else if kind=="volume" {" AND volume_id IS ?2"} else {" AND chapter_id IS ?2"};
    let sql=format!("SELECT id FROM {table} WHERE project_id=?1{scope} AND is_active=1 ORDER BY updated_at DESC");
    let mut statement=connection.prepare(&sql).map_err(|error|error.to_string())?;
    let ids=if kind=="master" {statement.query_map([novel],|row|row.get::<_,String>(0)).map_err(|error|error.to_string())?.collect::<Result<Vec<_>,_>>()} else {statement.query_map(params![novel,target],|row|row.get::<_,String>(0)).map_err(|error|error.to_string())?.collect::<Result<Vec<_>,_>>()}.map_err(|error|error.to_string())?;
    if ids.len()>1 {return Err("OUTLINE_ACTIVE_STATE_INVALID".into());}
    ids.first().map(|id|read_entity(connection,entity,id)).transpose()
}

pub(super) fn save(connection:&Connection,input:&ApplyInput,facts:&SourceFacts,receipt_id:&str)->Result<Saved,String> {
    let Action::OutlineVersion{outline_type,target_id,parent_outline_id,target_index,title,content,save_as_new_version}=&input.action else {return Err("OUTLINE_ACTION_INVALID".into());};
    let request=&input.source.request;
    if request.format!="editor_text" || request.outline_type!=*outline_type || request.target_id!=*target_id || request.parent_outline_id!=*parent_outline_id || title.trim().is_empty() || title.len()>2000 || content.trim().is_empty() || content.len()>200_000 || target_index.is_some_and(|value|!(1..=100_000).contains(&value)) || request.target_index.is_some_and(|value|Some(value)!=*target_index) {return Err("OUTLINE_ACTION_SCOPE_INVALID".into());}
    let (table,entity)=table(outline_type)?;
    let previous=if *save_as_new_version {None} else {active(connection,outline_type,&input.source.novel_id,target_id)?};
    let now=chrono::Utc::now().to_rfc3339();
    let original=facts.payload["content"].as_str()==Some(content) && facts.payload["title"].as_str()==Some(title);
    let source_type=if original {"ai_generated"} else {"ai_edited"};
    let content_hash=crate::repositories::large_text_repository::sha256(content);
    let snapshot=json!({"schemaVersion":"outline_candidate_application_v1","source":input.source,"saveReceiptId":receipt_id,"appliedContentHash":content_hash}).to_string();
    let id=if let Some(previous)=previous {
        let id=previous["id"].as_str().ok_or("OUTLINE_VERSION_INVALID")?.to_string();
        connection.execute(&format!("UPDATE {table} SET title=?1,content=?2,source_type=?3,context_snapshot=?4,updated_at=?5 WHERE id=?6 AND project_id=?7"),params![title,content,source_type,snapshot,now,id,input.source.novel_id]).map_err(|error|error.to_string())?;
        if outline_type=="chapter" {
            connection.execute("UPDATE chapters SET outline=?1,updated_at=?2 WHERE id=?3 AND novel_id=?4 AND deleted_at IS NULL",params![content,now,target_id,input.source.novel_id]).map_err(|error|error.to_string())?;
        }
        id
    } else {
        let scope=if outline_type=="master" {""} else if outline_type=="volume" {" AND volume_id IS ?2"} else {" AND chapter_id IS ?2"};
        let sql=format!("SELECT COALESCE(MAX(version),0)+1 FROM {table} WHERE project_id=?1{scope}");
        let version:i64=if outline_type=="master" {connection.query_row(&sql,[&input.source.novel_id],|row|row.get(0))} else {connection.query_row(&sql,params![input.source.novel_id,target_id],|row|row.get(0))}.map_err(|error|error.to_string())?;
        let id=uuid::Uuid::new_v4().to_string();
        if outline_type=="master" {
            connection.execute("INSERT INTO master_outlines(id,project_id,title,content,status,version,is_active,source_type,context_snapshot,created_at,updated_at)VALUES(?1,?2,?3,?4,'draft',?5,0,?6,?7,?8,?8)",params![id,input.source.novel_id,title,content,version,source_type,snapshot,now]).map_err(|error|error.to_string())?;
        } else {
            let (parent_column,target_column,index_column)=if outline_type=="volume" {("master_outline_id","volume_id","volume_index")} else {("volume_outline_id","chapter_id","chapter_index")};
            connection.execute(&format!("INSERT INTO {table}(id,project_id,{parent_column},{target_column},{index_column},title,content,status,version,is_active,source_type,context_snapshot,created_at,updated_at)VALUES(?1,?2,?3,?4,?5,?6,?7,'draft',?8,0,?9,?10,?11,?11)"),params![id,input.source.novel_id,parent_outline_id,target_id,target_index.unwrap_or(1),title,content,version,source_type,snapshot,now]).map_err(|error|error.to_string())?;
        }
        id
    };
    Ok(Saved::outline(entity,id,content))
}

pub(super) fn adopt(connection:&Connection,input:&ApplyInput,receipts:&[Value])->Result<Saved,String> {
    let Action::AdoptOutlineVersion{outline_type,target_id,outline_id,expected_version,expected_content_hash,expected_active}=&input.action else{return Err("OUTLINE_ACTION_INVALID".into());};
    let request=&input.source.request;
    if request.format!="editor_text" || request.outline_type!=*outline_type || request.target_id!=*target_id {return Err("OUTLINE_ACTION_SCOPE_INVALID".into());}
    let (table,entity)=table(outline_type)?;
    let selected=read_entity(connection,entity,outline_id)?;
    let body=selected["content"].as_str().ok_or("OUTLINE_VERSION_INVALID")?;
    let digest=crate::repositories::large_text_repository::sha256(body);
    let target_matches=match outline_type.as_str(){"volume"=>selected["volumeId"].as_str()==target_id.as_deref(),"chapter"=>selected["chapterId"].as_str()==target_id.as_deref(),_=>true};
    if selected["projectId"]!=input.source.novel_id || !target_matches || selected["version"].as_i64()!=Some(*expected_version) || &digest!=expected_content_hash {return Err("OUTLINE_VERSION_CONFLICT".into());}
    let provenance:Value=serde_json::from_str(selected["contextSnapshot"].as_str().ok_or("OUTLINE_SAVE_RECEIPT_REQUIRED")?).map_err(|_|"OUTLINE_SAVE_RECEIPT_REQUIRED")?;
    if provenance["schemaVersion"]!="outline_candidate_application_v1" || !receipts.iter().any(|record|record["receipt"]["receiptId"]==provenance["saveReceiptId"] && record["receipt"]["entityId"]==*outline_id && record["receipt"]["appliedContentHash"]==digest){return Err("OUTLINE_SAVE_RECEIPT_REQUIRED".into());}
    let actual=active(connection,outline_type,&input.source.novel_id,target_id)?;
    let matches=match (expected_active,actual.as_ref()) {
        (None,None)=>true,
        (Some(expected),Some(actual))=>actual["id"]==expected.id && actual["version"].as_i64()==Some(expected.version) && actual["content"].as_str().is_some_and(|body|crate::repositories::large_text_repository::sha256(body)==expected.content_hash),
        _=>false,
    };
    if !matches{return Err(fail("OUTLINE_ACTIVE_BASELINE_CONFLICT","当前采用大纲已变化；所选版本和编辑内容均保留，请重新查看采用目标"));}
    let now=chrono::Utc::now().to_rfc3339();
    let scope=if outline_type=="master" {""} else if outline_type=="volume" {" AND volume_id IS ?2"} else {" AND chapter_id IS ?2"};
    let sql=format!("UPDATE {table} SET is_active=0 WHERE project_id=?1{scope}");
    if outline_type=="master" {connection.execute(&sql,[&input.source.novel_id])} else {connection.execute(&sql,params![input.source.novel_id,target_id])}.map_err(|error|error.to_string())?;
    connection.execute(&format!("UPDATE {table} SET is_active=1,status='active',updated_at=?1 WHERE id=?2 AND project_id=?3"),params![now,outline_id,input.source.novel_id]).map_err(|error|error.to_string())?;
    if outline_type=="chapter" {connection.execute("UPDATE chapters SET outline=?1,updated_at=?2 WHERE id=?3 AND novel_id=?4 AND deleted_at IS NULL",params![body,now,target_id,input.source.novel_id]).map_err(|error|error.to_string())?;}
    Ok(Saved::outline(entity,outline_id.clone(),body))
}
