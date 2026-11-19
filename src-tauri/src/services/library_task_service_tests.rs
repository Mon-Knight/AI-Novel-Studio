use super::*;
use crate::services::task_style_source::StyleSampleSnapshot;

fn input(id:&str)->CreateLibraryTaskInput {
    let body="完全虚构的离线测试样本。";
    let hash=text::sha256(body);
    CreateLibraryTaskInput{conversation_id:id.into(),turn_id:format!("{id}-turn"),title:"离线风格".into(),goal:"分析本次文本的风格".into(),default_model:json!({"providerId":"mock","modelId":"offline","runtimeMode":"mock","options":{}}),created_at:"2026-11-11T00:00:00Z".into(),source:StyleSourceSnapshot{source_id:format!("{id}-source"),content_hash:hash.clone(),utf8_byte_length:body.len(),samples:vec![StyleSampleSnapshot{sample_id:"sample".into(),content:Some(body.into()),content_hash:hash,utf8_byte_length:body.len(),section_id:None,start_utf16:None,end_utf16:None,layers:vec![]}],reference:None}}
}
fn database()->Connection {
    let mut c=Connection::open_in_memory().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    crate::db::create_tables(&mut c).unwrap();c
}
#[test]
fn library_task_persists_true_null_and_idempotent_source_without_fake_novel() {
    let mut c=database();let request=input("library-a");
    let first=create_initialized(&mut c,request.clone()).unwrap();
    let second=create_initialized(&mut c,request.clone()).unwrap();
    assert!(first.conversation.novel_id.is_none());
    assert_eq!(first.conversation.conversation_id,second.conversation.conversation_id);
    assert_eq!(c.query_row("SELECT COUNT(*) FROM novels",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    assert_eq!(c.query_row("SELECT COUNT(*) FROM task_conversations WHERE novel_id IS NULL AND scope_type='library'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    assert_eq!(load_source(&c,"library-a").unwrap(),request.source);
    let mut conflicting=request;conflicting.goal="新目标不得借用旧身份".into();
    assert!(create_initialized(&mut c,conflicting).is_err());
}
#[test]
fn library_task_source_isolation_and_immutability_reject_cross_task_and_novel_access() {
    let mut c=database();let a=input("library-a");let b=input("library-b");
    create_initialized(&mut c,a.clone()).unwrap();create_initialized(&mut c,b.clone()).unwrap();
    assert!(validate_runtime_scope(&c,"library-a","library-a-turn",&a.source.source_id,&a.source.content_hash).is_ok());
    assert!(validate_runtime_scope(&c,"library-a","library-b-turn",&a.source.source_id,&a.source.content_hash).is_err());
    assert!(validate_runtime_scope(&c,"library-a","library-a-turn",&b.source.source_id,&b.source.content_hash).is_err());
    assert!(crate::repositories::conversation_repository::validate_task_runtime_scope(&c,"library-a","library-a-turn","a-novel",None).is_err());
    assert!(c.execute("UPDATE task_conversations SET novel_id='a-novel' WHERE conversation_id='library-a'",[]).is_err());
    let metadata=source_metadata(&c,"library-a").unwrap();let document=metadata["bodyRefId"].as_str().unwrap();
    assert!(c.execute("UPDATE large_text_chunks SET content='changed' WHERE document_id=?1",[document]).is_err());
    assert!(c.execute("DELETE FROM large_text_documents WHERE id=?1",[document]).is_err());
    assert!(c.execute("INSERT INTO task_authorizations(authorization_id,conversation_id,novel_id,source_turn_id,spec_json,spec_hash,model_snapshot_json,model_snapshot_hash,baseline_json,baseline_hash,status,issued_at,expires_at) VALUES('grant','library-a','a-novel','library-a-turn','{}',?1,'{}',?1,'{}',?1,'active','now','later')",["a".repeat(64)]).is_err());
    assert_eq!(c.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check",[],|r|r.get::<_,i64>(0)).unwrap(),0);
}

#[test]
fn library_task_ai_request_rejects_cross_run_source_or_model() {
    let mut c=database();let request=input("library-model");
    create_initialized(&mut c,request.clone()).unwrap();
    conversations::create_run(&mut c,conversations::CreateRunInput{run_id:"style-run".into(),conversation_id:request.conversation_id.clone(),turn_id:request.turn_id.clone(),model_snapshot:request.default_model.clone(),worker_id:"offline-worker".into(),chapter_id:None,created_at:request.created_at.clone()}).unwrap();
    let mut task=crate::services::ai_task_service::tests::system_task_input("style-op","style_analysis");
    task.scope_type="library".into();task.task_type="style_analyze".into();task.novel_id=None;
    task.target_hint_json=Some(json!({"conversationId":request.conversation_id,"turnId":request.turn_id,"runId":"style-run","librarySourceId":request.source.source_id,"librarySourceHash":request.source.content_hash,"modelSnapshot":request.default_model}));
    assert!(validate_ai_task_scope(&c,&task).is_ok());
    let original=task.clone();
    task.target_hint_json.as_mut().unwrap()["runId"]=json!("another-run");
    assert!(validate_ai_task_scope(&c,&task).is_err());
    task=original.clone();task.target_hint_json.as_mut().unwrap()["librarySourceId"]=json!("another-source");
    assert!(validate_ai_task_scope(&c,&task).is_err());
    task=original.clone();task.target_hint_json.as_mut().unwrap()["modelSnapshot"]["modelId"]=json!("different-model");
    assert!(validate_ai_task_scope(&c,&task).is_err());
    task=original;task.novel_id=Some("fake-novel".into());
    assert!(validate_ai_task_scope(&c,&task).is_err());
}
