//! Dynamic isolated SQLite tests for the one native root lifecycle.
use super::*;
use crate::services::ai_request_policy_service as requests;
use rusqlite::{params, Connection};

fn fixture() -> (Connection, StartTaskTurnInput) {
    let mut connection = Connection::open_in_memory().unwrap();
    crate::db::create_tables(&mut connection).unwrap();
    let time = now();
    let novel = "00000000-0000-4000-8000-000000000201";
    let chapter = "00000000-0000-4000-8000-000000000202";
    connection.execute("INSERT INTO novels(id,title,outline,created_at,updated_at)VALUES(?1,'隔离根任务','',?2,?2)",params![novel,time]).unwrap();
    connection.execute("INSERT INTO chapters(id,novel_id,title,outline,order_index,status,created_at,updated_at)VALUES(?1,?2,'第一章','隔离章节大纲',1,'outline_ready',?3,?3)",params![chapter,novel,time]).unwrap();
    let model = json!({"providerId":"mock","modelId":"offline-exact","runtimeMode":"mock","capabilities":["conversation_turn","chapter_generate"],"options":{"maxTokens":8000},"runtime":{"adapterProtocol":DSH_PROTOCOL,"adapterProvider":"mock"}});
    conversation_service::create(
        &mut connection,
        conversation_service::CreateConversationInput {
            conversation_id: "unified-conversation".into(),
            novel_id: novel.into(),
            title: "隔离根目标".into(),
            default_model: Some(model.clone()),
            created_at: time.clone(),
        },
    )
    .unwrap();
    conversation_service::append_turn(
        &mut connection,
        conversation_service::AppendTurnInput {
            conversation_id: "unified-conversation".into(),
            turn_id: "unified-root-turn".into(),
            role: "user".into(),
            content: "读取作品并讨论目标".into(),
            created_at: time,
        },
    )
    .unwrap();
    let input:StartTaskTurnInput=serde_json::from_value(json!({"conversationId":"unified-conversation","novelId":novel,"turnId":"unified-root-turn","goal":"读取作品并讨论目标","chapterId":chapter,"taskKind":"read","modelSnapshot":model,"requestPolicy":{"maxRequestsPerMinute":120,"maxConcurrentRequests":2,"warningPercent":80,"timeoutSeconds":120}})).unwrap();
    (connection, input)
}
fn run(connection: &mut Connection, input: &mut StartTaskTurnInput, id: &str) {
    if input.execution.is_none() {
        input.execution = Some(execution::RootExecution::new(connection, input).unwrap());
    }
    input
        .execution
        .as_ref()
        .unwrap()
        .dispatch_enabled
        .store(true, Ordering::SeqCst);
    conversation_service::create_run(
        connection,
        CreateRunInput {
            run_id: id.into(),
            conversation_id: input.conversation_id.clone(),
            turn_id: input.turn_id.clone(),
            model_snapshot: input.model_snapshot.clone(),
            worker_id: "isolated-worker".into(),
            chapter_id: input.chapter_id.clone(),
            created_at: now(),
        },
    )
    .unwrap();
    conversation_service::update_run(
        connection,
        UpdateRunInput {
            run_id: id.into(),
            status: "running".into(),
            error: None,
            updated_at: now(),
            started_at: Some(now()),
            finished_at: None,
        },
    )
    .unwrap();
    retry::record_contract(connection, input, id).unwrap();
}
fn reserve(
    connection: &mut Connection,
    root: &execution::RootExecution,
    id: &str,
) -> requests::AiRequestPolicyLeaseGrant {
    requests::reserve_request(
        connection,
        requests::ReserveAiRequestInput {
            owner_id: root.owner_id.clone(),
            provider_request_id: id.into(),
            max_requests_per_minute: 120,
            max_concurrent_requests: 2,
            daily_token_budget: Some(256_000),
            daily_cost_budget_usd: Some(5.0),
            estimated_input_tokens: 20,
            estimated_output_tokens: 30,
            input_price_per_million_tokens: Some(0.0),
            output_price_per_million_tokens: Some(0.0),
            warning_percent: 80,
            ttl_ms: 60_000,
        },
    )
    .unwrap()
}
fn settle(
    connection: &mut Connection,
    root: &execution::RootExecution,
    grant: requests::AiRequestPolicyLeaseGrant,
    known: bool,
) {
    let id = grant.reservation_id.clone();
    requests::settle_request(
        connection,
        requests::SettleAiRequestInput {
            reservation_id: grant.reservation_id,
            owner_id: grant.owner_id,
            lease_token: grant.lease_token,
            outcome: "succeeded".into(),
            token_input: known.then_some(12),
            token_output: known.then_some(8),
        },
    )
    .unwrap();
    usage::record_request_usage(connection, root, &id, known).unwrap();
}

#[test]
fn native_root_counts_real_request_facts_across_sequential_child_runs_and_retry() {
    let (mut connection, mut input) = fixture();
    run(&mut connection, &mut input, "root-run");
    let mut root = input.execution.clone().unwrap();
    root.max_requests = 1;
    let grant = reserve(&mut connection, &root, "native-unified-request-one");
    settle(&mut connection, &root, grant, true);
    conversation_service::update_run(
        &mut connection,
        UpdateRunInput {
            run_id: "root-run".into(),
            status: "completed".into(),
            error: None,
            updated_at: now(),
            started_at: None,
            finished_at: Some(now()),
        },
    )
    .unwrap();
    input.execution.as_mut().unwrap().parent_run_id = Some("root-run".into());
    run(&mut connection, &mut input, "child-run");
    let evidence =
        usage::usage_for_root(&connection, &input.conversation_id, &input.turn_id).unwrap();
    assert_eq!(evidence.requests, 1);
    assert_eq!((evidence.token_input, evidence.token_output), (12, 8));
    assert!(evidence.usage_known);
    assert_eq!(
        usage::before_dispatch(&connection, &root, 1, 1, Some(0.0), Some(0.0)).unwrap_err(),
        "DSH_ROOT_REQUEST_BUDGET_EXHAUSTED"
    );
    let restored = execution::RootExecution::new(&connection, &input).unwrap();
    assert_eq!(restored.owner_id, root.owner_id);
    assert_eq!(restored.root_run_id, root.root_run_id);
    assert_eq!(restored.started_at_ms, root.started_at_ms);
}
#[test]
fn native_root_missing_usage_stops_followup_even_when_global_governor_estimates_usage() {
    let (mut connection, mut input) = fixture();
    run(&mut connection, &mut input, "root-run");
    let root = input.execution.clone().unwrap();
    let grant = reserve(&mut connection, &root, "native-unified-missing-usage");
    settle(&mut connection, &root, grant, false);
    let evidence =
        usage::usage_for_root(&connection, &input.conversation_id, &input.turn_id).unwrap();
    assert!(!evidence.usage_known);
    assert_eq!(evidence.token_input, 20);
    assert!(
        usage::before_dispatch(&connection, &root, 1, 1, Some(0.0), Some(0.0))
            .unwrap_err()
            .starts_with("DSH_ROOT_USAGE_UNKNOWN")
    );
}
#[test]
fn native_gateway_capability_reservations_cannot_exceed_parent_tool_budget() {
    let (mut connection, mut input) = fixture();
    run(&mut connection, &mut input, "root-run");
    let mut root = input.execution.clone().unwrap();
    root.max_tools = 1;
    usage::authorize_tool(&mut connection, &root, "novel.read").unwrap();
    assert_eq!(
        usage::authorize_tool(&mut connection, &root, "novel.read").unwrap_err(),
        "DSH_ROOT_TOOL_BUDGET_EXHAUSTED"
    );
    assert_eq!(
        usage::usage_for_root(&connection, &input.conversation_id, &input.turn_id)
            .unwrap()
            .tools,
        1
    );
}
#[test]
fn native_root_cancellation_is_inherited_and_chapter_child_scope_only_narrows() {
    let (connection, input) = fixture();
    let root = execution::RootExecution::new(&connection, &input).unwrap();
    let child = root.clone();
    root.cancel.store(true, Ordering::SeqCst);
    assert!(child.check().is_err());
    let action = creative_dialogue::PlannedAction {
        action: "generate_chapter".into(),
        instruction: "写另一章".into(),
        chapter_id: Some("foreign-chapter".into()),
    };
    assert!(
        dispatch::from_action(&input, &action, input.chapter_id.as_deref())
            .unwrap_err()
            .starts_with("DSH_CHILD_SCOPE_EXPANSION")
    );
    let mut action = action;
    action.action = "adopt".into();
    action.chapter_id = input.chapter_id.clone();
    assert_eq!(
        dispatch::from_action(&input, &action, input.chapter_id.as_deref()).unwrap_err(),
        "DSH_CHILD_ACTION_UNKNOWN"
    );
}
#[test]
fn native_root_keeps_original_baseline_after_manual_edit_and_new_execution_memory() {
    let (mut connection, mut input) = fixture();
    run(&mut connection, &mut input, "root-run");
    let root = input.execution.clone().unwrap();
    connection
        .execute(
            "UPDATE chapters SET outline='人工中途改写',updated_at='changed-by-author' WHERE id=?1",
            [input.chapter_id.as_ref().unwrap()],
        )
        .unwrap();
    assert_eq!(
        root.baseline(
            &connection,
            input.require_novel_id().unwrap(),
            input.chapter_id.as_deref().unwrap()
        )
        .unwrap_err()
        .code,
        "DSH_ROOT_BASELINE_CHANGED"
    );
    let restored = execution::RootExecution::new(&connection, &input).unwrap();
    assert!(
        restored
            .baseline(
                &connection,
                input.require_novel_id().unwrap(),
                input.chapter_id.as_deref().unwrap()
            )
            .is_err(),
        "new process-local state must not refresh away a persisted root conflict"
    );
}
#[test]
fn native_mock_route_keeps_exact_selected_identity_and_never_needs_real_key() {
    let (_, input) = fixture();
    let route = selected_model_route(&input).unwrap();
    assert_eq!(route.logical_provider, "mock");
    assert_eq!(route.model, "offline-exact");
    assert!(route.base_url.starts_with("http://127.0.0.1:0/"));
    let transport = provider_transport(&input).unwrap();
    assert_eq!(transport.upstream_key, "ans-offline-no-credentials");
}
#[test]
fn native_new_goal_has_zero_usage_only_when_no_prior_runs_or_reservations_exist() {
    let (mut connection, input) = fixture();
    let evidence =
        usage::usage_for_root(&connection, &input.conversation_id, &input.turn_id).unwrap();
    assert!(evidence.usage_known);
    assert_eq!(evidence.requests, 0);
    conversation_service::create_run(
        &mut connection,
        CreateRunInput {
            run_id: "legacy-without-contract".into(),
            conversation_id: input.conversation_id.clone(),
            turn_id: input.turn_id.clone(),
            model_snapshot: input.model_snapshot.clone(),
            worker_id: "legacy".into(),
            chapter_id: input.chapter_id.clone(),
            created_at: now(),
        },
    )
    .unwrap();
    assert!(
        usage::usage_for_root(&connection, &input.conversation_id, &input.turn_id).is_err(),
        "missing contracts cannot be treated as zero usage"
    );
}

#[test]
fn native_root_revision_budget_counts_same_run_model_repairs_and_children() {
    let (mut connection, mut input) = fixture();
    run(&mut connection, &mut input, "root-run");
    let mut root = input.execution.clone().unwrap();
    root.max_revisions = 0;
    usage::authorize_tool(&mut connection, &root, "generate_chapter").unwrap();
    assert_eq!(
        usage::authorize_tool(&mut connection, &root, "generate_chapter").unwrap_err(),
        "DSH_ROOT_REVISION_BUDGET_EXHAUSTED"
    );
    root.max_revisions = 2;
    usage::authorize_tool(&mut connection, &root, "generate_chapter").unwrap();
    assert_eq!(
        usage::usage_for_root(&connection, &input.conversation_id, &input.turn_id)
            .unwrap()
            .revisions,
        1
    );
    conversation_service::update_run(
        &mut connection,
        UpdateRunInput {
            run_id: "root-run".into(),
            status: "failed".into(),
            error: Some("controlled model repair".into()),
            updated_at: now(),
            started_at: None,
            finished_at: Some(now()),
        },
    )
    .unwrap();
    input.execution.as_mut().unwrap().revision_depth = 1;
    run(&mut connection, &mut input, "child-repair-run");
    assert_eq!(
        usage::usage_for_root(&connection, &input.conversation_id, &input.turn_id)
            .unwrap()
            .revisions,
        2,
        "splitting a repair into a new Run cannot reset the repair count"
    );
}
#[test]
fn native_root_pauses_provider_authority_while_waiting_without_losing_candidate_scope() {
    let (mut connection, mut input) = fixture();
    run(&mut connection, &mut input, "root-run");
    let root = input.execution.clone().unwrap();
    assert!(usage::before_dispatch(&connection, &root, 1, 1, Some(0.0), Some(0.0)).is_ok());
    root.dispatch_enabled.store(false, Ordering::SeqCst);
    assert_eq!(
        usage::before_dispatch(&connection, &root, 1, 1, Some(0.0), Some(0.0)).unwrap_err(),
        "DSH_ROOT_NOT_EXECUTING"
    );
    assert!(
        root.check().is_ok(),
        "a paused root can still reconcile exact receipts without dispatching a model"
    );
}
#[test]
fn native_root_unknown_pricing_stops_before_any_provider_reservation() {
    let (mut connection, mut input) = fixture();
    run(&mut connection, &mut input, "root-run");
    let root = input.execution.clone().unwrap();
    assert!(usage::before_dispatch(&connection, &root, 1, 1, None, None)
        .unwrap_err()
        .starts_with("DSH_ROOT_PRICING_REQUIRED"));
    assert_eq!(
        usage::usage_for_root(&connection, &input.conversation_id, &input.turn_id)
            .unwrap()
            .requests,
        0
    );
}
#[test]
fn native_root_startup_recovery_settles_active_reservation_conservatively_for_retry() {
    let (mut connection, mut input) = fixture();
    run(&mut connection, &mut input, "root-run");
    let mut root = input.execution.clone().unwrap();
    root.max_requests = 2;
    let crashed = reserve(&mut connection, &root, "native-unified-crashed-active");
    let before =
        usage::usage_for_root(&connection, &input.conversation_id, &input.turn_id).unwrap();
    assert!(!before.usage_known);
    assert!(
        usage::before_dispatch(&connection, &root, 1, 1, Some(0.0), Some(0.0))
            .unwrap_err()
            .starts_with("DSH_ROOT_USAGE_UNKNOWN")
    );

    assert_eq!(
        requests::recover_interrupted_reservations(&mut connection).unwrap(),
        1
    );
    assert_eq!(
        requests::recover_interrupted_reservations(&mut connection).unwrap(),
        0
    );

    let row: (String, i64, i64, i64, String) = connection
        .query_row(
            "SELECT status,accounted_input_tokens,accounted_output_tokens,accounted_cost_units,accounted_cost_status
             FROM ai_request_reservations WHERE reservation_id=?1",
            [&crashed.reservation_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap();
    assert_eq!(row, ("failed".into(), 20, 30, 0, "complete".into()));

    let after = usage::usage_for_root(&connection, &input.conversation_id, &input.turn_id).unwrap();
    assert!(after.usage_known);
    assert_eq!(after.requests, 1);
    assert_eq!((after.token_input, after.token_output), (20, 30));
    assert!(usage::before_dispatch(&connection, &root, 1, 1, Some(0.0), Some(0.0)).is_ok());

    root.max_requests = 1;
    assert_eq!(
        usage::before_dispatch(&connection, &root, 1, 1, Some(0.0), Some(0.0)).unwrap_err(),
        "DSH_ROOT_REQUEST_BUDGET_EXHAUSTED"
    );
    root.max_requests = 2;
    root.max_tokens = 50;
    assert_eq!(
        usage::before_dispatch(&connection, &root, 1, 1, Some(0.0), Some(0.0)).unwrap_err(),
        "DSH_ROOT_TOKEN_BUDGET_EXHAUSTED"
    );
}
#[test]
fn native_root_keeps_expired_and_unpriced_failed_reservations_fail_closed() {
    let (mut connection, mut input) = fixture();
    run(&mut connection, &mut input, "root-run-unpriced");
    let root = input.execution.clone().unwrap();
    requests::reserve_request(
        &mut connection,
        requests::ReserveAiRequestInput {
            owner_id: root.owner_id.clone(),
            provider_request_id: "native-unified-unpriced-active".into(),
            max_requests_per_minute: 120,
            max_concurrent_requests: 2,
            daily_token_budget: Some(256_000),
            daily_cost_budget_usd: None,
            estimated_input_tokens: 20,
            estimated_output_tokens: 30,
            input_price_per_million_tokens: None,
            output_price_per_million_tokens: None,
            warning_percent: 80,
            ttl_ms: 60_000,
        },
    )
    .unwrap();
    assert_eq!(
        requests::recover_interrupted_reservations(&mut connection).unwrap(),
        1
    );
    let unpriced =
        usage::usage_for_root(&connection, &input.conversation_id, &input.turn_id).unwrap();
    assert!(!unpriced.usage_known);
    assert!(
        usage::before_dispatch(&connection, &root, 1, 1, Some(0.0), Some(0.0))
            .unwrap_err()
            .starts_with("DSH_ROOT_USAGE_UNKNOWN")
    );

    let (mut connection, mut input) = fixture();
    run(&mut connection, &mut input, "root-run-expired");
    let root = input.execution.clone().unwrap();
    let expired_grant = reserve(&mut connection, &root, "native-unified-expired");
    connection
        .execute(
            "UPDATE ai_request_reservations
             SET status='expired',
                 settlement_hash=?2,
                 accounted_input_tokens=estimated_input_tokens,
                 accounted_output_tokens=estimated_output_tokens,
                 accounted_cost_units=estimated_cost_units,
                 accounted_cost_status='complete',
                 settled_at_ms=expires_at_ms
             WHERE reservation_id=?1 AND status='active'",
            params![
                expired_grant.reservation_id,
                large_text_repository::sha256("test-expired")
            ],
        )
        .unwrap();
    let expired =
        usage::usage_for_root(&connection, &input.conversation_id, &input.turn_id).unwrap();
    assert!(!expired.usage_known);
    assert!(
        usage::before_dispatch(&connection, &root, 1, 1, Some(0.0), Some(0.0))
            .unwrap_err()
            .starts_with("DSH_ROOT_USAGE_UNKNOWN")
    );
}
