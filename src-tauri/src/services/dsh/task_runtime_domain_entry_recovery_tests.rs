//! Resume is a new explicit user turn, not a model or startup replay.
use super::*;
#[test]
fn domain_cancel_then_explicit_resume_preserves_root_model_and_valid_foundation(){
    let mut connection=db();
    let mut input=input(&mut connection,json!({"kind":"autonomous_plan","operationId":"cancel-plan","brief":brief()}),None);
    prepare(&mut connection,&mut input).unwrap();
    let foundation=candidate_schema::mock_payload(context(&input).unwrap()).unwrap();
    let outcome=result(&mut connection,&input,foundation,0);
    after_candidate(&mut connection,&input,&outcome).unwrap();
    let before=crate::services::autonomous_story_service::get_plan_by_operation(&connection,"cancel-plan").unwrap().unwrap();
    cleanup(&mut connection,&input,"DSH_ROOT_CANCELLED").unwrap();
    let cancelled=crate::services::autonomous_story_service::get_plan_by_operation(&connection,"cancel-plan").unwrap().unwrap();
    assert_eq!(cancelled["status"],"cancelled");assert_eq!(cancelled["storyBible"],before["storyBible"]);
    conversation_service::append_turn(&mut connection,conversation_service::AppendTurnInput{turn_id:"explicit-resume".to_string(),conversation_id:input.conversation_id.clone(),role:"user".to_string(),content:"明确继续本任务有效检查点；不重放未知调用。".to_string(),created_at:chrono::Utc::now().to_rfc3339()}).unwrap();
    input.turn_id="explicit-resume".to_string();
    prepare(&mut connection,&mut input).unwrap();
    assert_eq!(context(&input).unwrap()["stageKey"],"characters");
    let resumed=crate::services::autonomous_story_service::get_plan_by_operation(&connection,"cancel-plan").unwrap().unwrap();
    assert_eq!(resumed["runtimeConversationId"],"domain-task");assert_eq!(resumed["runtimeModelSnapshot"],input.model_snapshot);
    let calls:i64=connection.query_row("SELECT COUNT(*) FROM ai_task_attempts",[],|row|row.get(0)).unwrap();
    assert_eq!(calls,1,"preparing a resumed phase must not repeat the committed foundation call");
}
