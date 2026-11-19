//! Narrow SQLite writers. Only the explicit manual application transaction calls these.
use super::{fail, hash, validation::SourceFacts, Action, ApplyInput};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
#[path = "outline_candidate_apply_versions.rs"]
mod versions;
#[path = "outline_candidate_apply_structure.rs"]
mod structure;

pub(super) struct Saved {
    pub entity_type: &'static str,
    pub entity_id: String,
    pub content_hash: String,
    pub candidate_index: Option<usize>,
    pub created_volume_id: Option<String>,
}
impl Saved {
    fn outline(kind: &'static str, id: String, content: &str) -> Self {
        Self {entity_type:kind,entity_id:id,content_hash:crate::repositories::large_text_repository::sha256(content),candidate_index:None,created_volume_id:None}
    }
}

pub(super) fn table(kind: &str) -> Result<(&'static str, &'static str), String> {
    match kind {
        "master" => Ok(("master_outlines", "master_outline")),
        "volume" => Ok(("volume_outlines", "volume_outline")),
        "chapter" => Ok(("chapter_outlines", "chapter_outline")),
        _ => Err("OUTLINE_TYPE_INVALID".into()),
    }
}

pub(super) fn read_entity(connection: &Connection, kind: &str, id: &str) -> Result<Value, String> {
    if kind=="volume" { return serde_json::to_value(crate::services::volume_service::get_volume(connection,id)?.ok_or("OUTLINE_APPLIED_TARGET_UNAVAILABLE: 已提交分卷已变化，请读取权威回执")?).map_err(|error|error.to_string()); }
    if kind=="chapter" { return serde_json::to_value(crate::services::chapter_service::get_chapter(connection,id)?.ok_or("OUTLINE_APPLIED_TARGET_UNAVAILABLE: 已提交章节已变化，请读取权威回执")?).map_err(|error|error.to_string()); }
    let (name,parent,target,index)=match kind {
        "master_outline" => ("master_outlines","NULL","NULL","1"),
        "volume_outline" => ("volume_outlines","master_outline_id","volume_id","volume_index"),
        "chapter_outline" => ("chapter_outlines","volume_outline_id","chapter_id","chapter_index"),
        _=>return Err("OUTLINE_TYPE_INVALID".into()),
    };
    let sql=format!("SELECT id,project_id,title,content,status,version,is_active,source_type,context_snapshot,created_at,updated_at,{parent},{target},{index} FROM {name} WHERE id=?1");
    let mut value=connection.query_row(&sql,[id],|row|Ok(json!({"id":row.get::<_,String>(0)?,"projectId":row.get::<_,String>(1)?,"title":row.get::<_,String>(2)?,"content":row.get::<_,String>(3)?,"status":row.get::<_,String>(4)?,"version":row.get::<_,i64>(5)?,"isActive":row.get::<_,i64>(6)?!=0,"sourceType":row.get::<_,String>(7)?,"contextSnapshot":row.get::<_,Option<String>>(8)?,"createdAt":row.get::<_,String>(9)?,"updatedAt":row.get::<_,String>(10)?,"parent":row.get::<_,Option<String>>(11)?,"target":row.get::<_,Option<String>>(12)?,"index":row.get::<_,i64>(13)?}))).optional().map_err(|error|error.to_string())?.ok_or("OUTLINE_APPLIED_TARGET_UNAVAILABLE: 已提交大纲已变化，请读取权威回执")?;
    if kind!="master_outline" {
        let parent=value.as_object_mut().unwrap().remove("parent").unwrap();
        let target=value.as_object_mut().unwrap().remove("target").unwrap();
        let index=value.as_object_mut().unwrap().remove("index").unwrap();
        if kind=="volume_outline" {value["masterOutlineId"]=parent;value["volumeId"]=target;value["volumeIndex"]=index;}
        else {value["volumeOutlineId"]=parent;value["chapterId"]=target;value["chapterIndex"]=index;}
    } else {for key in ["parent","target","index"] {value.as_object_mut().unwrap().remove(key);}}
    Ok(value)
}

pub(super) fn execute(connection: &Connection, input: &ApplyInput, facts: &SourceFacts, receipts: &[Value], receipt_id: &str) -> Result<Saved, String> {
    match &input.action {
        Action::OutlineVersion {..} => versions::save(connection,input,facts,receipt_id),
        Action::AdoptOutlineVersion {..} => versions::adopt(connection,input,receipts),
        Action::Volume {..} => structure::volume(connection,input),
        Action::Chapter {..} => structure::chapter(connection,input,facts,receipts),
    }
}
