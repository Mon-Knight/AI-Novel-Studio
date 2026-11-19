//! Isolated SQLite fixtures; all model outputs are controlled structured tool arguments.
use super::*;
use crate::repositories::world_setting_repository;
use crate::services::world_rule_governance;

pub(super) fn stage_label(input: &StartTaskTurnInput) -> String {
    let prefix = format!("chapter:{}:", input.chapter_id.as_deref().unwrap());
    context(input)
        .unwrap()
        .stage
        .key
        .strip_prefix(&prefix)
        .unwrap()
        .to_string()
}

pub(super) fn fixture(scene_count: usize) -> (Connection, StartTaskTurnInput) {
    let mut connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    crate::db::create_tables(&mut connection).unwrap();
    let time = now();
    let novel = "00000000-0000-4000-8000-000000000501";
    let chapter = "00000000-0000-4000-8000-000000000502";
    connection.execute("INSERT INTO novels(id,title,outline,created_at,updated_at)VALUES(?1,'隔离阶段作品','大纲',?2,?2)",params![novel,time]).unwrap();
    connection.execute("INSERT INTO chapters(id,novel_id,title,outline,order_index,status,target_word_count,created_at,updated_at)VALUES(?1,?2,'第一章','已应用章纲',1,'outline_ready',?3,?4,?4)",params![chapter,novel,(scene_count*650) as i64,time]).unwrap();
    connection.execute("INSERT INTO world_settings(id,novel_id,title,content,is_active,created_at,updated_at)VALUES('staged-world',?1,'世界','临河旧城有真实物理约束。',1,?2,?2)",params![novel,time]).unwrap();
    connection.execute("INSERT INTO rule_systems(id,novel_id,title,category,content,is_active,created_at,updated_at)VALUES('staged-rule',?1,'规则','social','未知信息不得成为既成事实。',1,?2,?2)",params![novel,time]).unwrap();
    connection.execute("INSERT INTO protagonists(id,novel_id,name,created_at,updated_at)VALUES('staged-person',?1,'沈砚',?2,?2)",params![novel,time]).unwrap();
    let scenes=json!((0..scene_count).map(|i|json!({"id":format!("scene-{}",i+1),"sceneNo":i+1,"title":format!("现场{}",i+1),
        "planVersion":2,"beats":[],"goal":"核对现场线索并承担行动后果","targetCharacters":650,"location":"旧城",
        "characters":["沈砚"],"conflict":"信息不完整","contextCapsule":"尚未进入现场","constraints":["不把推测写为事实"],
        "expectedEndState":"取得可核对线索","transition":"停在下一步行动前","keyActions":[],"keyDialogue":"","informationRelease":[],"result":"计划目标不是实际结果"})).collect::<Vec<_>>());
    connection.execute("INSERT INTO chapter_engineering_states(id,novel_id,chapter_id,chapter_card_json,scene_plan_json,generation_constraints_json,quality_rules_json,draft_version,active_version,status,created_at,updated_at)VALUES('staged-plan',?1,?2,'{}',?3,'{}','{}',1,1,'active',?4,?4)",params![novel,chapter,scenes.to_string(),time]).unwrap();
    let model = json!({"providerId":"mock","modelId":"staged-offline","runtimeMode":"mock","options":{"maxTokens":8000},
        "runtime":{"adapterProtocol":DSH_PROTOCOL,"adapterProvider":"mock"}});
    conversation_service::create_initialized(
        &mut connection,
        conversation_service::CreateInitializedConversationInput {
            conversation_id: "staged-conversation".into(),
            turn_id: "staged-turn".into(),
            novel_id: novel.into(),
            title: "隔离分阶段任务".into(),
            goal: "按已应用计划写章".into(),
            default_model: model.clone(),
            created_at: time,
        },
    )
    .unwrap();
    let target = (scene_count * 650) as i64;
    let mut input:StartTaskTurnInput=serde_json::from_value(json!({"conversationId":"staged-conversation","turnId":"staged-turn",
        "novelId":novel,"chapterId":chapter,"goal":"按已应用计划写章","taskKind":"chapter_write",
        "expectedTool":"generate_chapter","expectedArtifactType":"chapter_text","requiredReadTools":["novel.read_context","chapter.read_outline","get_character_states","search_memory"],
        "chapterWordRange":{"target":target,"minimum":target,"maximum":target},"modelSnapshot":model,
        "requestPolicy":{"maxRequestsPerMinute":120,"maxConcurrentRequests":2,"warningPercent":80,"timeoutSeconds":120}})).unwrap();
    let root = execution::RootExecution::new(&connection, &input).unwrap();
    input.execution = Some(root);
    (connection, input)
}

pub(super) fn start(connection: &mut Connection, input: &StartTaskTurnInput, run_id: &str) {
    input
        .execution
        .as_ref()
        .unwrap()
        .check_stage(connection, input)
        .unwrap();
    conversation_service::create_run(
        connection,
        CreateRunInput {
            run_id: run_id.into(),
            conversation_id: input.conversation_id.clone(),
            turn_id: input.turn_id.clone(),
            chapter_id: input.chapter_id.clone(),
            worker_id: "isolated-staged-worker".into(),
            model_snapshot: input.model_snapshot.clone(),
            created_at: now(),
        },
    )
    .unwrap();
    status(connection, run_id, "running");
    retry::record_contract(connection, input, run_id).unwrap();
    begin(connection, input, run_id).unwrap();
}

pub(super) fn status(
    connection: &mut Connection,
    run_id: &str,
    status: &str,
) -> conversation_service::TaskRunRecord {
    conversation_service::update_run(
        connection,
        UpdateRunInput {
            run_id: run_id.into(),
            status: status.into(),
            error: (status == "failed").then_some("CONTROLLED_CRASH".into()),
            updated_at: now(),
            started_at: (status == "running").then(now),
            finished_at: (status != "running").then(now),
        },
    )
    .unwrap()
}

fn section(projection: &Value, fingerprint: &str, max: usize) -> Value {
    let content = projection.to_string();
    let count = projection
        .as_array()
        .map(Vec::len)
        .unwrap_or(usize::from(!projection.is_null()));
    json!({"status":"complete","requiredCount":count,"includedCount":count,"projectionHash":large_text_repository::sha256(&content),
        "requiredBytes":content.len(),"projectedBytes":content.len(),"maxBytes":max,"semanticValidation":"not_checked",
        "sourceIds":projection.as_array().map(|v|v.iter().map(|s|s["id"].clone()).collect::<Vec<_>>()).unwrap_or_default(),"ruleSetFingerprint":fingerprint})
}

fn read_payload(connection: &Connection, input: &StartTaskTurnInput, tool: &str) -> Value {
    let novel=input.require_novel_id().expect("novel-only staged fixture");
    if tool == "novel.read_context" {
        let snapshot =
            world_rule_governance::rule_set_snapshot(connection, &novel).unwrap();
        let worlds = json!(world_setting_repository::find_world_settings_by_novel(
            connection,
            &novel
        )
        .unwrap());
        let rules = json!(world_setting_repository::find_rule_systems_by_novel(
            connection,
            &novel
        )
        .unwrap());
        json!({"ok":true,"data":{"worldSettings":worlds,"ruleSystems":rules,"contextCoverage":{"schemaVersion":"writing_context_coverage_v1",
            "novelId":novel,"worldSettings":section(&worlds,&snapshot.fingerprint,131072),"ruleSystems":section(&rules,&snapshot.fingerprint,131072)}}})
    } else if tool == "chapter.read_outline" {
        let state = json!(
            crate::services::chapter_engineering_service::get_active_chapter_engineering_state(
                connection,
                input.chapter_id.as_deref().unwrap()
            )
            .unwrap()
        );
        json!({"ok":true,"data":{"engineeringState":state,"contextCoverage":{"schemaVersion":"writing_context_coverage_v1",
            "novelId":novel,"chapterId":input.chapter_id,"engineeringState":section(&state,"",65536)}}})
    } else {
        json!({"ok":true,"data":[]})
    }
}

pub(super) fn event(connection: &mut Connection, run_id: &str, id: &str, tool: &str) {
    conversation_service::append_tool_event(connection,AppendToolEventInput {event_id:id.into(),run_id:run_id.into(),tool_name:tool.into(),
        arguments_summary:json!({"callId":id,"dshTurn":1,"dshStep":1,"dshResponseId":"turn:1:step:1","governedProviderRequestId":format!("fixture-{run_id}")}),
        status:"running".into(),duration_ms:None,error:None,result:None,created_at:now(),finished_at:None}).unwrap();
}
fn succeeded(connection: &mut Connection, id: &str, payload: Value) {
    let content = payload.to_string();
    let hash = large_text_repository::sha256(&content);
    let document = format!("{id}-result");
    large_text_repository::insert_document_for_target(
        connection,
        &document,
        "tool_event",
        id,
        "result",
        None,
        &content,
        &hash,
        &now(),
    )
    .unwrap();
    conversation_service::update_tool_event(connection,UpdateToolEventInput {event_id:id.into(),status:"succeeded".into(),duration_ms:Some(0),
        error:None,result:Some(json!({"largeTextRefId":document,"contentHash":hash,"contentChars":content.chars().count(),"isError":false})),finished_at:Some(now())}).unwrap();
}

pub(super) fn reads(connection: &mut Connection, input: &StartTaskTurnInput, run: &str) {
    for tool in &input.required_read_tools {
        let id = format!("{run}-{tool}");
        event(connection, run, &id, tool);
        let payload = read_payload(connection, input, tool);
        succeeded(connection, &id, payload);
    }
}

pub(super) fn submit(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    run: &str,
    args: Value,
) -> Result<(), String> {
    let id = format!("{run}-submit");
    event(connection, run, &id, "submit_chapter_stage");
    chapter_stage::remember_submission(connection, &id, &args.to_string())?;
    let body = args["content"].as_str().unwrap();
    let gateway = json!({"ok":true,"stageSubmissionVersion":1,"stageKey":args["stageKey"],"stageKind":args["stageKind"],
        "contentHash":large_text_repository::sha256(body),"contentChars":body.chars().count()});
    accept_submission(connection, input, run, &id, &gateway.to_string())?;
    succeeded(connection, &id, gateway);
    Ok(())
}

pub(super) fn step(
    connection: &mut Connection,
    input: &StartTaskTurnInput,
    run: &str,
) -> TaskRuntimeResult {
    let model_stage = context(input)
        .map(|context| {
            matches!(
                context.stage.kind.as_str(),
                "beat_plan" | "beat_write" | "beat_state"
            )
        })
        .unwrap_or(false);
    start(connection, input, run);
    if is_local(input) {
        execute_local(connection, input, run).unwrap();
    } else {
        reads(connection, input, run);
        submit(connection, input, run, mock_arguments(input).unwrap()).unwrap();
    }
    if model_stage {
        model_usage(connection, input, run);
    }
    TaskRuntimeResult {
        run: status(connection, run, "completed"),
        session_id: format!("isolated-{run}"),
        agent_id: "isolated-stage".into(),
        worker_id: "isolated-staged-worker".into(),
        runtime: "controlled-offline-fixture".into(),
        assistant_text: None,
        artifact_id: None,
        planned_action: None,
        session_lifecycle: None,
        model_tool_attestation: None,
        pending_chapter_candidate: None,
    }
}

fn model_usage(connection: &Connection, input: &StartTaskTurnInput, run: &str) {
    let root = input.execution.as_ref().unwrap();
    let day = "2026-11-13";
    connection
        .execute(
            "INSERT OR IGNORE INTO ai_request_daily_usage(day_key,updated_at_ms)VALUES(?1,1)",
            [day],
        )
        .unwrap();
    let reservation = format!("{run}-usage");
    connection
        .execute(
            "INSERT INTO ai_request_reservations(
                reservation_id,owner_id,provider_request_id,lease_token_hash,policy_revision,
                policy_hash,day_key,started_at_ms,expires_at_ms,estimated_input_tokens,
                estimated_output_tokens,estimated_cost_units,input_price_per_million_tokens,
                output_price_per_million_tokens,status,dispatched_at_ms,settlement_hash,
                accounted_input_tokens,accounted_output_tokens,accounted_cost_units,
                accounted_cost_status,settled_at_ms)
             VALUES(?1,?2,?3,?4,1,?4,?5,1,2,1,1,1,1.0,1.0,'settled',1,?4,1,1,1,'complete',1)",
            params![
                reservation,
                root.owner_id,
                format!("provider-{run}"),
                "0".repeat(64),
                day
            ],
        )
        .unwrap();
    host_facts::append(
        connection,
        AppendToolEventInput {
            event_id: format!("{reservation}-root-usage"),
            run_id: run.into(),
            tool_name: "dsh.request_usage".into(),
            arguments_summary: json!({"source":"ans-host","usageKnown":true,
                "reservationId":reservation,"rootTurnId":root.root_turn_id}),
            status: "succeeded".into(),
            duration_ms: None,
            error: None,
            result: Some(json!({"usageKnown":true})),
            created_at: now(),
            finished_at: Some(now()),
        },
    )
    .unwrap();
}

pub(super) fn advance(connection: &mut Connection, input: &mut StartTaskTurnInput, run: &str) {
    let result = step(connection, input, run);
    let mut next = next_stage(connection, input, &result)
        .unwrap()
        .expect("next controlled stage");
    next.execution.as_mut().unwrap().parent_run_id = Some(run.into());
    *input = next;
}
