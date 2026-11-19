use super::*;

fn source(text: &str) -> StyleSourceSnapshot {
    let hash=large_text_repository::sha256(text);
    StyleSourceSnapshot{source_id:"source-a".into(),content_hash:hash.clone(),utf8_byte_length:text.len(),samples:vec![StyleSampleSnapshot{sample_id:"sample-a".into(),content:Some(text.into()),content_hash:hash,utf8_byte_length:text.len(),section_id:None,start_utf16:None,end_utf16:None,layers:vec![]}],reference:None}
}

#[test]
fn style_source_library_checks_full_hash_utf16_bytes_and_no_novel_scope() {
    let conn=Connection::open_in_memory().unwrap();
    let valid=source("离线夹具：并非真实用户作品。😀");
    assert!(validate_source(&conn,None,&valid).is_ok());
    assert!(validate_source(&conn,Some("novel-a"),&valid).is_err());
    let mut changed=valid.clone();changed.samples[0].content=Some("另一段".into());
    assert!(validate_source(&conn,None,&changed).is_err());
    let mut changed=valid.clone();changed.utf8_byte_length+=1;
    assert!(validate_source(&conn,None,&changed).is_err());
    let mut changed=valid.clone();changed.samples[0].section_id=Some("chapter-a".into());
    assert!(validate_source(&conn,None,&changed).is_err());
    assert!(validate_source(&conn,None,&source(&"😀".repeat(10_001))).is_err());
    let mut changed=valid;changed.samples.push(changed.samples[0].clone());
    assert!(validate_source(&conn,None,&changed).is_err());
}

#[test]
fn style_source_unknown_fields_and_foreign_project_are_rejected() {
    let conn=Connection::open_in_memory().unwrap();
    let mut value=serde_json::to_value(source("离线测试文本")).unwrap();
    value["novelId"]=serde_json::json!("pretend-novel");
    assert!(serde_json::from_value::<StyleSourceSnapshot>(value).is_err());
    let mut project=source("sample");
    project.reference=Some(StyleReferenceScope{novel_id:"novel-a".into(),work_id:"work-a".into(),import_id:"import-a".into(),source_hash:project.content_hash.clone()});
    assert!(validate_source(&conn,None,&project).is_err());
    assert!(validate_source(&conn,Some("novel-b"),&project).is_err());
}

#[test]
fn style_source_project_rechecks_real_import_hash_range_and_current_version() {
    use crate::domain::reference_library::{ImportReferenceWorkInput, ReferenceDuplicateAction, ReferenceFileAnalysisInput, ReferenceSectionInput};
    #[derive(serde::Serialize)]
    #[serde(rename_all="camelCase")]
    struct Plan<'a> { order_index:i64,title:&'a str,content_hash:&'a str,char_count:i64,source_start_utf16:i64,source_end_utf16:i64 }
    let mut conn=Connection::open_in_memory().unwrap();
    crate::db::create_tables(&mut conn).unwrap();
    conn.execute("INSERT INTO novels(id,title,created_at,updated_at) VALUES('project-source','offline','now','now')",[]).unwrap();
    let body="离线😀参考文本，只供测试，不是真实正文。";
    let hash=large_text_repository::sha256(body);
    let units=body.encode_utf16().count() as i64;
    let count=body.chars().count() as i64;
    let plan=serde_json::to_string(&[Plan{order_index:1,title:"fixture",content_hash:&hash,char_count:count,source_start_utf16:0,source_end_utf16:units}]).unwrap();
    let imported=reference_library_service::commit_import(&mut conn,ImportReferenceWorkInput{
        operation_id:"source-import-test".into(),novel_id:"project-source".into(),duplicate_action:ReferenceDuplicateAction::CreateWork,duplicate_import_id:None,work_id:None,title:Some("offline".into()),purpose:Some("style".into()),description:None,source_file_path:None,
        analysis:ReferenceFileAnalysisInput{file_name:"fixture.txt".into(),encoding:"utf-8".into(),encoding_source:"utf8_valid".into(),source_hash:hash.clone(),decoded_text_hash:hash.clone(),source_byte_length:body.len() as i64,decoded_utf8_byte_length:body.len() as i64,total_chars:count,parser_version:"reference_txt_parser_v1".into(),section_plan_hash:large_text_repository::sha256(&plan),sections:vec![ReferenceSectionInput{order_index:1,title:"fixture".into(),content:body.into(),content_hash:hash.clone(),char_count:count,source_start_utf16:0,source_end_utf16:units}],warnings:vec![],text:body.into()}
    }).unwrap();
    let work=imported.bundle.work;
    let sample_text="离线😀";
    let mut request=StyleSourceSnapshot{source_id:work.active_import_id.clone(),content_hash:hash.clone(),utf8_byte_length:sample_text.len(),reference:Some(StyleReferenceScope{novel_id:"project-source".into(),work_id:work.id,import_id:work.active_import_id.clone(),source_hash:hash}),samples:vec![StyleSampleSnapshot{sample_id:"sample".into(),content:None,content_hash:large_text_repository::sha256(sample_text),utf8_byte_length:sample_text.len(),section_id:Some(imported.bundle.sections[0].id.clone()),start_utf16:Some(0),end_utf16:Some(4),layers:vec!["opening".into()]}]};
    assert_eq!(validate_source(&conn,Some("project-source"),&request).unwrap()[0].content.as_deref(),Some(sample_text));
    assert!(validate_source(&conn,Some("foreign-project"),&request).is_err());
    request.samples[0].end_utf16=Some(3);
    assert!(validate_source(&conn,Some("project-source"),&request).is_err());
    request.samples[0].end_utf16=Some(4);
    request.samples[0].content=Some("renderer-forgery".into());
    assert!(validate_source(&conn,Some("project-source"),&request).is_err());
    request.samples[0].content=None;
    conn.execute("UPDATE reference_imports SET is_current=0 WHERE id=?1",[&work.active_import_id]).unwrap();
    assert!(validate_source(&conn,Some("project-source"),&request).is_err());
}
