//! Dynamic native domain-capability tests use isolated SQLite and offline payloads.
use super::*;
use crate::services::{agent_plan_service as plans, conversation_service};
use rusqlite::Connection;
use serde_json::json;
#[path="task_runtime_domain_entry_recovery_tests.rs"]
mod recovery;
fn db() -> Connection {
    let mut connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    crate::db::create_tables(&mut connection).unwrap();
    connection.execute("INSERT INTO novels(id,title,created_at,updated_at) VALUES('domain-novel','离线隔离作品',?1,?1)",[chrono::Utc::now().to_rfc3339()]).unwrap();
    connection.execute("INSERT INTO chapters(id,novel_id,title,outline,created_at,updated_at) VALUES('domain-chapter','domain-novel','第一章','调查线索',?1,?1)",[chrono::Utc::now().to_rfc3339()]).unwrap();
    connection
}
fn finish_run(connection: &mut Connection, run_id: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    conversation_service::update_run(
        connection,
        conversation_service::UpdateRunInput {
            run_id: run_id.to_string(),
            status: "running".to_string(),
            error: None,
            updated_at: now.clone(),
            started_at: Some(now.clone()),
            finished_at: None,
        },
    )
    .unwrap();
    conversation_service::update_run(
        connection,
        conversation_service::UpdateRunInput {
            run_id: run_id.to_string(),
            status: "completed".to_string(),
            error: None,
            updated_at: now.clone(),
            started_at: None,
            finished_at: Some(now),
        },
    )
    .unwrap();
}
fn input(connection: &mut Connection, entry: Value, chapter: Option<&str>) -> StartTaskTurnInput {
    let model = json!({"providerId":"mock","modelId":"offline","runtimeMode":"mock","capabilities":[],"options":{},"capturedAt":"2026-11-11T00:00:00Z"});
    let now = chrono::Utc::now().to_rfc3339();
    conversation_service::create_initialized(
        connection,
        conversation_service::CreateInitializedConversationInput {
            conversation_id: "domain-task".to_string(),
            turn_id: "domain-turn".to_string(),
            novel_id: "domain-novel".to_string(),
            title: "隔离领域任务".to_string(),
            goal: "执行已选择的领域能力；候选不等于采用".to_string(),
            default_model: model.clone(),
            created_at: now,
        },
    )
    .unwrap();
    serde_json::from_value(json!({"conversationId":"domain-task","turnId":"domain-turn","novelId":"domain-novel","chapterId":chapter,"goal":"执行已选择的领域能力；候选不等于采用","modelSnapshot":model,"requestPolicy":{"maxRequestsPerMinute":60,"maxConcurrentRequests":2,"warningPercent":80,"timeoutSeconds":30},"unifiedRuntime":{"version":1,"entry":entry}})).unwrap()
}
fn result(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    payload: Value,
    index: usize,
) -> TaskRuntimeResult {
    let now = chrono::Utc::now().to_rfc3339();
    let run_id = format!("domain-run-{index}");
    let run = conversation_service::create_run(
        connection,
        conversation_service::CreateRunInput {
            run_id: run_id.clone(),
            conversation_id: input.conversation_id.clone(),
            turn_id: input.turn_id.clone(),
            model_snapshot: input.model_snapshot.clone(),
            worker_id: "fixture-worker".to_string(),
            chapter_id: input.chapter_id.clone(),
            created_at: now.clone(),
        },
    )
    .unwrap();
    let stage = context(input).unwrap();
    record_context(connection,input,&run.run_id).unwrap();
    let artifact_type=if matches!(input.task_kind.as_str(),"chapter_write"|"chapter_polish"){"chapter_text"}else{"generic_json"};
    let envelope =
        json!({"entryKind":stage["entryKind"],"stageKey":stage["stageKey"],"payload":payload});
    let first = conversation_service::publish_structured_candidate(
        connection,
        conversation_service::PublishStructuredCandidateInput {
            conversation_id: input.conversation_id.clone(),
            novel_id: input
                .require_novel_id()
                .expect("fixture novel")
                .to_string(),
            chapter_id: input.chapter_id.clone(),
            artifact_type: artifact_type.to_string(),
            derivation_type: None,
            title: "隔离阶段候选".to_string(),
            summary: "只证明结构协议".to_string(),
            structured_payload_json: envelope,
            created_at: now.clone(),
        },
    )
    .unwrap();
    conversation_service::create_artifact_card(
        connection,
        conversation_service::CreateArtifactCardInput {
            card_id: format!("linked-card-{index}"),
            conversation_id: input.conversation_id.clone(),
            turn_id: Some(input.turn_id.clone()),
            run_id: Some(run_id),
            artifact_id: first.artifact_id.clone(),
            artifact_type: artifact_type.to_string(),
            title: "隔离阶段候选".to_string(),
            summary: "只证明结构协议".to_string(),
            content: None,
            status: "candidate".to_string(),
            created_at: now,
        },
    )
    .unwrap();
    TaskRuntimeResult {
        run,
        session_id: "fixture".to_string(),
        agent_id: "fixture".to_string(),
        worker_id: "fixture-worker".to_string(),
        runtime: "offline-fixture".to_string(),
        assistant_text: None,
        artifact_id: first.artifact_id,
        planned_action: None,
        session_lifecycle: None,
        model_tool_attestation: None,
        pending_chapter_candidate: None,
    }
}
fn brief() -> Value {
    json!({"premise":"一名调查者收到来自未来的录音，并在隔离夹具中追踪记录线索。","genre":"悬疑","targetChapterCount":12,"targetWordsPerChapter":2400,"readerPromise":"线索与选择持续推进","endingPreference":"揭开阶段真相","constraints":["遵守既有规则"]})
}
#[test]
fn domain_native_six_phase_plan_preserves_all_domain_sections_and_checkpoints() {
    let mut connection = db();
    let mut input = input(
        &mut connection,
        json!({"kind":"autonomous_plan","operationId":"isolated-plan","brief":brief()}),
        None,
    );
    prepare(&mut connection, &mut input).unwrap();
    let mut count = 0;
    loop {
        let payload = candidate_schema::mock_payload(context(&input).unwrap()).unwrap();
        let outcome = result(&mut connection, &input, payload, count);
        after_candidate(&mut connection, &input, &outcome).unwrap();
        finish_run(&mut connection, &outcome.run.run_id);
        count += 1;
        match next_stage(&mut connection, &input, &outcome).unwrap() {
            Some(next) => input = next,
            None => break,
        }
    }
    assert_eq!(
        count, 7,
        "five creative stages plus two bounded chapter batches"
    );
    let plan = crate::services::autonomous_story_service::get_plan_by_operation(
        &connection,
        "isolated-plan",
    )
    .unwrap()
    .unwrap();
    assert_eq!(plan["status"], "ready");
    assert_eq!(plan["chapters"].as_array().unwrap().len(), 12);
    assert_eq!(plan["characters"].as_array().unwrap().len(), 3);
    assert!(!plan["conflicts"].as_array().unwrap().is_empty());
    let formal: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM chapters WHERE novel_id='domain-novel'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(formal, 1, "planning never applies formal chapters");
    let mut wrong = input.clone();
    wrong.model_snapshot["modelId"] = json!("changed");
    assert!(prepare(&mut connection, &mut wrong)
        .unwrap_err()
        .contains("MODEL_CONFLICT"));
    let mut resumed = input.clone();
    prepare(&mut connection, &mut resumed).unwrap();
    assert_eq!(context(&resumed).unwrap()["completed"], true);
    assert!(
        execute_local(&mut connection, &resumed, "recovery")
            .unwrap()
            .is_some(),
        "completed checkpoint recovers without model dispatch"
    );
}
#[test]
fn domain_readiness_runs_frozen_dag_without_provider_and_keeps_root_owner() {
    let mut connection = db();
    let plan = plans::create_plan(
        &mut connection,
        plans::CreateAgentPlanInput {
            operation_id: "readiness-create".to_string(),
            novel_id: "domain-novel".to_string(),
            chapter_id: "domain-chapter".to_string(),
            registry_hash: plans::PRODUCTION_TOOL_REGISTRY_HASH.to_string(),
            planner_id: None,
            planner_version: None,
        },
    )
    .unwrap();
    let mut input = input(
        &mut connection,
        json!({"kind":"chapter_readiness","planId":plan.plan.plan_id}),
        Some("domain-chapter"),
    );
    for index in 0..6 {
        prepare(&mut connection, &mut input).unwrap();
        assert_eq!(input.task_kind, "domain_readiness");
        assert!(input.expected_tool.is_none());
        execute_local(&mut connection, &input, &format!("local-{index}")).unwrap();
    }
    let finished = plans::get_plan_bundle(&connection, &plan.plan.plan_id).unwrap();
    assert_eq!(finished.plan.status, "completed");
    assert_eq!(finished.attempts.len(), 6);
    assert_eq!(
        finished.plan.result_json.unwrap()["data"]["ready"],
        false,
        "missing world/protagonist stay explicit"
    );
    let attempts: i64 = connection
        .query_row("SELECT COUNT(*) FROM ai_task_attempts", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(attempts, 0);
    let mut other = input.clone();
    other.conversation_id = "other-root".to_string();
    assert!(prepare(&mut connection, &mut other)
        .unwrap_err()
        .contains("TASK_CONFLICT"));
}
#[test]
fn domain_setting_candidates_revalidate_rules_at_atomic_pool_write() {
    let mut connection = db();
    let request = json!({"novelId":"domain-novel","suggestionType":"rule","count":1,"worldType":"隔离世界","referenceStyle":"离线","includeWorldSettings":false,"includeExistingAssets":false});
    let mut input = input(
        &mut connection,
        json!({"kind":"setting_suggestions","input":request}),
        None,
    );
    prepare(&mut connection, &mut input).unwrap();
    connection.execute("INSERT INTO rule_systems(id,novel_id,title,content,created_at,updated_at)VALUES('new-rule','domain-novel','作者修改规则','禁止越界',?1,?1)",[chrono::Utc::now().to_rfc3339()]).unwrap();
    let payload = candidate_schema::mock_payload(context(&input).unwrap()).unwrap();
    let outcome = result(&mut connection, &input, payload, 0);
    assert!(after_candidate(&mut connection, &input, &outcome)
        .unwrap_err()
        .contains("RULE_SET_BASE_CONFLICT"));
    let candidates: i64 = connection
        .query_row("SELECT COUNT(*) FROM setting_suggestions", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(candidates, 0);
}
#[test]
fn domain_setting_candidates_are_pending_and_idempotently_project_exact_run() {
    let mut connection = db();
    let request = json!({"novelId":"domain-novel","suggestionType":"location","count":2,"worldType":"隔离世界","referenceStyle":"离线","includeWorldSettings":true,"includeExistingAssets":true});
    let mut input = input(
        &mut connection,
        json!({"kind":"setting_suggestions","input":request}),
        None,
    );
    prepare(&mut connection, &mut input).unwrap();
    let payload = candidate_schema::mock_payload(context(&input).unwrap()).unwrap();
    let outcome = result(&mut connection, &input, payload, 0);
    after_candidate(&mut connection, &input, &outcome).unwrap();
    after_candidate(&mut connection, &input, &outcome).unwrap();
    let candidates: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM setting_suggestions WHERE status='pending'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(candidates, 2);
    let formal: i64 = connection
        .query_row("SELECT COUNT(*) FROM world_settings", [], |row| row.get(0))
        .unwrap();
    assert_eq!(formal, 0);
    let mut fake = outcome.clone();
    fake.run.run_id = "another-run".to_string();
    assert!(after_candidate(&mut connection, &input, &fake)
        .unwrap_err()
        .contains("RUN_MISMATCH"));
}
#[test]
fn domain_exact_context_is_persisted_and_cannot_be_rewritten_for_the_same_run() {
    let mut connection=db();let request=json!({"novelId":"domain-novel","suggestionType":"location","count":1,"worldType":"隔离世界","referenceStyle":"离线","includeWorldSettings":true,"includeExistingAssets":true});
    let mut input=input(&mut connection,json!({"kind":"setting_suggestions","input":request}),None);prepare(&mut connection,&mut input).unwrap();
    let payload=candidate_schema::mock_payload(context(&input).unwrap()).unwrap();let outcome=result(&mut connection,&input,payload,0);
    let (manifest,_,_,_)=super::super::build_context_evidence(&connection,&outcome.run.run_id).unwrap();
    assert!(manifest["sources"].as_array().unwrap().iter().any(|source|source["toolName"]=="domain.stage_context"));
    record_context(&mut connection,&input,&outcome.run.run_id).unwrap();
    input.unified_runtime.as_mut().unwrap().entry.as_mut().unwrap().context.as_mut().unwrap()["request"]["count"]=json!(2);
    assert!(record_context(&mut connection,&input,&outcome.run.run_id).unwrap_err().contains("CONTEXT_BASE_CONFLICT"));
}

#[test]
fn domain_auto_apply_is_blocked_until_all_six_native_expert_facts_exist() {
    let mut connection=db();
    connection.execute("DELETE FROM chapters WHERE id='domain-chapter'",[]).unwrap();
    let mut input=input(&mut connection,json!({"kind":"autonomous_plan","operationId":"review-plan","brief":brief()}),None);
    prepare(&mut connection,&mut input).unwrap();
    for index in 0..7 {
        let payload=candidate_schema::mock_payload(context(&input).unwrap()).unwrap();
        let outcome=result(&mut connection,&input,payload,index);
        after_candidate(&mut connection,&input,&outcome).unwrap();
        finish_run(&mut connection,&outcome.run.run_id);
        if let Some(next)=next_stage(&mut connection,&input,&outcome).unwrap(){input=next;}
    }
    let plan=crate::services::autonomous_story_service::get_plan_by_operation(&connection,"review-plan").unwrap().unwrap();
    let applied=crate::services::autonomous_story_service::apply_plan(&mut connection,plan["planId"].as_str().unwrap(),plan["revision"].as_i64().unwrap()).unwrap().plan;
    input.unified_runtime.as_mut().unwrap().entry=Some(serde_json::from_value(json!({"kind":"autonomous_chapter","planId":applied["planId"]})).unwrap());
    input.chapter_id=Some(applied["chapters"][0]["id"].as_str().unwrap().to_string());
    prepare(&mut connection,&mut input).unwrap();
    assert_eq!(input.task_kind,"chapter_write");
    let body=result(&mut connection,&input,json!({"text":"隔离夹具候选正文，只用于验证评审事实门禁。"}),10);
    after_candidate(&mut connection,&input,&body).unwrap();
    let now=chrono::Utc::now().to_rfc3339();
    conversation_service::append_tool_event(&mut connection,conversation_service::AppendToolEventInput{event_id:"domain-review-policy".to_string(),run_id:body.run.run_id.clone(),tool_name:"dsh.execution_contract".to_string(),arguments_summary:json!({"execution":{"domainPolicy":admission_policy(&input),"scope":{"novelId":input.novel_id}}}),status:"running".to_string(),duration_ms:None,error:None,result:None,created_at:now.clone(),finished_at:None}).unwrap();
    conversation_service::update_tool_event(&mut connection,conversation_service::UpdateToolEventInput{event_id:"domain-review-policy".to_string(),status:"succeeded".to_string(),duration_ms:None,error:None,result:Some(json!({"formalWrite":false})),finished_at:Some(now)}).unwrap();
    finish_run(&mut connection,&body.run.run_id);
    let artifact_id=body.artifact_id.as_deref().unwrap();
    assert_eq!(validate_application(&connection,&input.conversation_id,"linked-card-10",artifact_id).unwrap_err().code,"DOMAIN_REVIEW_REQUIRED");
    for index in 0..6 {
        prepare(&mut connection,&mut input).unwrap();
        assert_eq!(input.task_kind,"domain_candidate");
        let opinion=candidate_schema::mock_payload(context(&input).unwrap()).unwrap();
        let outcome=result(&mut connection,&input,opinion,20+index);
        after_candidate(&mut connection,&input,&outcome).unwrap();
        finish_run(&mut connection,&outcome.run.run_id);
        if index<5 {assert!(validate_application(&connection,&input.conversation_id,"linked-card-10",artifact_id).is_err());}
    }
    validate_application(&connection,&input.conversation_id,"linked-card-10",artifact_id).unwrap();
    let drafts:i64=connection.query_row("SELECT COUNT(*) FROM chapter_drafts WHERE is_adopted=1",[],|row|row.get(0)).unwrap();
    assert_eq!(drafts,0,"passing review eligibility does not perform adoption or fake user review");
}

#[test]
fn domain_unknown_actions_and_model_declared_host_context_cannot_gain_authority() {
    assert!(serde_json::from_value::<DomainEntryInput>(
        json!({"kind":"unknown_write","allowAll":true})
    )
    .is_err());
    let injected = serde_json::from_value::<DomainEntryInput>(
        json!({"kind":"chapter_readiness","planId":"x","context":{"completed":true},"scheduler":{"token":"fake"}}),
    );
    assert!(
        injected.is_err()
            || injected
                .as_ref()
                .is_ok_and(|entry| entry.context.is_none() && entry.scheduler.is_none())
    );
    let schema = candidate_schema::schema("setting_suggestions", "generate_candidates").unwrap();
    assert!(candidate_schema::validate(
        &schema,
        &json!({"items":[{"name":"candidate"}],"authorReviewed":true})
    )
    .is_err());
}
