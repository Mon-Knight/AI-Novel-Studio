//! Isolated SQLite only. No real user data, model invocation or external service.
use super::*;
use crate::services::{artifact_service, conversation_service as conversations};
use crate::services::dsh::task_runtime::{domain_entry, StartTaskTurnInput, TaskRuntimeResult};

fn fixture(format:&str, outline_type:&str, payload:Value)->(Connection,Value) {
    let mut connection=Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    crate::db::create_tables(&mut connection).unwrap();
    let now=chrono::Utc::now().to_rfc3339();
    connection.execute("INSERT INTO novels(id,title,created_at,updated_at)VALUES('outline-novel','隔离大纲作品',?1,?1)",[&now]).unwrap();
    let model=json!({"providerId":"mock","modelId":"offline","runtimeMode":"mock","capabilities":[],"options":{},"capturedAt":now});
    conversations::create_initialized(&mut connection,serde_json::from_value(json!({"conversationId":"outline-task","turnId":"outline-turn","novelId":"outline-novel","title":"隔离大纲任务","goal":"只生成大纲候选，保存和采用分别确认","defaultModel":model,"createdAt":now})).unwrap()).unwrap();
    let request=json!({"kind":"outline_generate","outlineType":outline_type,"format":format});
    let mut input:StartTaskTurnInput=serde_json::from_value(json!({"conversationId":"outline-task","turnId":"outline-turn","novelId":"outline-novel","goal":"只生成大纲候选，保存和采用分别确认","modelSnapshot":model,"requestPolicy":{"maxRequestsPerMinute":60,"maxConcurrentRequests":2,"warningPercent":80,"timeoutSeconds":30},"unifiedRuntime":{"version":1,"entry":request}})).unwrap();
    domain_entry::prepare(&mut connection,&mut input).unwrap();
    conversations::create_run(&mut connection,serde_json::from_value(json!({"runId":"outline-run","conversationId":"outline-task","turnId":"outline-turn","modelSnapshot":model,"workerId":"offline-fixture","createdAt":now})).unwrap()).unwrap();
    let envelope=json!({"entryKind":"outline_generate","stageKey":format,"payload":payload});
    let published=conversations::publish_structured_candidate(&mut connection,serde_json::from_value(json!({"conversationId":"outline-task","novelId":"outline-novel","artifactType":"generic_json","title":"隔离大纲候选","summary":"结构协议候选，非文学质量证明","structuredPayloadJson":envelope,"createdAt":now})).unwrap()).unwrap();
    let artifact_id=published.artifact_id.unwrap();
    conversations::create_artifact_card(&mut connection,serde_json::from_value(json!({"cardId":"outline-card","conversationId":"outline-task","turnId":"outline-turn","runId":"outline-run","artifactId":artifact_id,"artifactType":"generic_json","title":"隔离大纲候选","summary":"尚未保存或采用","status":"candidate","createdAt":now})).unwrap()).unwrap();
    conversations::append_tool_event(&mut connection,serde_json::from_value(json!({"eventId":"outline-contract","runId":"outline-run","toolName":"dsh.execution_contract","argumentsSummary":{"source":"ans-host","execution":{"rootTaskId":"outline-task","rootTurnId":"outline-turn","scope":{"novelId":"outline-novel"},"domainPolicy":domain_entry::admission_policy(&input).unwrap()}},"status":"running","createdAt":now})).unwrap()).unwrap();
    conversations::update_tool_event(&mut connection,serde_json::from_value(json!({"eventId":"outline-contract","status":"succeeded","finishedAt":now})).unwrap()).unwrap();
    conversations::update_run(&mut connection,serde_json::from_value(json!({"runId":"outline-run","status":"running","updatedAt":now,"startedAt":now})).unwrap()).unwrap();
    let run=conversations::update_run(&mut connection,serde_json::from_value(json!({"runId":"outline-run","status":"completed","updatedAt":now,"finishedAt":now})).unwrap()).unwrap();
    let result=TaskRuntimeResult{run,session_id:"offline".into(),agent_id:"offline".into(),worker_id:"offline".into(),runtime:"offline-fixture".into(),assistant_text:None,artifact_id:Some(artifact_id.clone()),planned_action:None,session_lifecycle:None,model_tool_attestation:None,pending_chapter_candidate:None};
    domain_entry::after_candidate(&mut connection,&input,&result).unwrap();
    assert!(domain_entry::next_stage(&mut connection,&input,&result).unwrap().is_none(),"outline generation is exactly one bounded candidate stage");
    let artifact=artifact_service::get_artifact_bundle(&connection,&artifact_id).unwrap();
    let source=json!({"version":1,"novelId":"outline-novel","conversationId":"outline-task","turnId":"outline-turn","runId":"outline-run","cardId":"outline-card","artifactId":artifact_id,"artifactHash":artifact.artifact.content_hash,"request":request});
    (connection,source)
}
fn apply(connection:&mut Connection,source:&Value,operation:&str,action:Value)->Result<Value,String>{
    apply_with(connection,serde_json::from_value(json!({"source":source,"operationId":operation,"action":action})).unwrap())
}
fn count(connection:&Connection,table:&str)->i64{connection.query_row(&format!("SELECT COUNT(*) FROM {table}"),[],|row|row.get(0)).unwrap()}

#[test]
fn outline_generation_and_new_version_save_never_implicitly_adopt_and_edited_body_is_preserved(){
    let (mut connection,source)=fixture("editor_text","master",json!({"title":"模型总纲","content":"模型原始总纲"}));
    assert_eq!(count(&connection,"master_outlines"),0,"native model candidate cannot write the outline library");
    let content="作者改写的总纲\n保留作者判断与空行。";
    let action=json!({"kind":"outline_version","outlineType":"master","title":"作者标题","content":content,"saveAsNewVersion":true});
    let saved=apply(&mut connection,&source,"explicit-save",action.clone()).unwrap();
    assert_eq!(saved["outline"]["content"],content);
    assert_eq!(saved["outline"]["sourceType"],"ai_edited");
    assert_eq!(saved["outline"]["isActive"],false);
    assert_eq!(saved["receipt"]["authority"],"manual_confirmation");
    assert_eq!(count(&connection,"artifact_decisions"),1);
    let replay=apply(&mut connection,&source,"explicit-save",action).unwrap();
    assert_eq!(replay["receipt"],saved["receipt"]);
    assert_eq!(count(&connection,"master_outlines"),1);
    assert_eq!(count(&connection,"artifact_decisions"),1);
    let adopted=apply(&mut connection,&source,"explicit-adopt",json!({"kind":"adopt_outline_version","outlineType":"master","outlineId":saved["outline"]["id"],"expectedVersion":saved["outline"]["version"],"expectedContentHash":saved["receipt"]["appliedContentHash"],"expectedActive":null})).unwrap();
    assert_eq!(adopted["outline"]["isActive"],true);
    assert_eq!(adopted["outline"]["content"],content);
    assert_eq!(count(&connection,"artifact_decisions"),2);
}

#[test]
fn outline_save_conflicts_do_not_discard_edits_or_create_partial_receipts(){
    let (mut connection,source)=fixture("editor_text","master",json!({"title":"总纲","content":"待审阅总纲"}));
    connection.execute("UPDATE novels SET title='用户中途更改的作品标题' WHERE id='outline-novel'",[]).unwrap();
    let error=apply(&mut connection,&source,"stale-save",json!({"kind":"outline_version","outlineType":"master","title":"作者保留标题","content":"作者保留正文","saveAsNewVersion":true})).unwrap_err();
    assert!(error.contains("OUTLINE_BASELINE_CONFLICT"));
    assert_eq!(count(&connection,"master_outlines"),0);
    assert_eq!(count(&connection,"artifact_decisions"),0);
    let existing=artifact_service::get_artifact_bundle(&connection,source["artifactId"].as_str().unwrap()).unwrap();
    assert!(existing.raw_content.contains("待审阅总纲"));
}

#[test]
fn outline_batch_limits_creation_advances_only_own_receipts_and_rejects_other_writers(){
    let chapters=(0..3).map(|index|json!({"title":format!("第{}章",index+1),"outline":"有明确线索的章节提纲","targetWordCount":2400})).collect::<Vec<_>>();
    let (mut connection,source)=fixture("chapter_candidates","chapter",json!({"chapters":chapters}));
    assert_eq!(count(&connection,"chapters"),0);
    let action=|index|json!({"kind":"chapter","candidateIndex":index,"candidate":{"title":format!("作者第{}章",index+1),"outline":"作者调整的完整章纲","targetWordCount":2600}});
    let first=apply(&mut connection,&source,"chapter-0",action(0)).unwrap();
    assert_eq!(count(&connection,"volumes"),1);
    assert_eq!(count(&connection,"chapters"),1);
    let mut second=action(1); second["targetVolumeId"]=first["volume"]["id"].clone();
    apply(&mut connection,&source,"chapter-1",second).unwrap();
    assert_eq!(count(&connection,"chapters"),2,"the owning receipt proves the advanced structure baseline");
    let duplicate=apply(&mut connection,&source,"duplicate-index",action(0)).unwrap_err();
    assert!(duplicate.contains("OUTLINE_CANDIDATE_ALREADY_APPLIED"));
    assert_eq!(count(&connection,"chapters"),2);
    connection.execute("UPDATE volumes SET title='其他任务修改的卷标题'",[]).unwrap();
    assert!(apply(&mut connection,&source,"chapter-2",action(2)).unwrap_err().contains("OUTLINE_BASELINE_CONFLICT"));
    assert_eq!(count(&connection,"chapters"),2);
    assert_eq!(count(&connection,"artifact_decisions"),2);
}
