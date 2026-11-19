//! Isolated task-authority behavior tests. No real user database or model requests.
use super::*;
use crate::services::conversation_service;
use rusqlite::Connection;
use serde_json::json;

pub(crate) fn fixture() -> (Connection, IssueInput) {
    let mut conn = Connection::open_in_memory().expect("isolated sqlite");
    conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    crate::db::create_tables(&mut conn).unwrap();
    let now = Utc::now().to_rfc3339();
    conn.execute("INSERT INTO novels(id,title,outline,created_at,updated_at)VALUES('00000000-0000-4000-8000-000000000101','隔离授权作品','',?1,?1)",[&now]).unwrap();
    conn.execute("INSERT INTO chapters(id,novel_id,title,order_index,status,word_count,created_at,updated_at)VALUES('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000101','第一章',1,'outline_ready',0,?1,?1)",[&now]).unwrap();
    conversation_service::create(&mut conn,conversation_service::CreateConversationInput{conversation_id:"auth-conversation".into(),novel_id:"00000000-0000-4000-8000-000000000101".into(),title:"隔离任务".into(),default_model:Some(json!({"providerId":"mock","modelId":"offline","runtimeMode":"mock","capabilities":[],"options":{},"capturedAt":now})),created_at:now.clone()}).unwrap();
    conversation_service::append_turn(
        &mut conn,
        conversation_service::AppendTurnInput {
            turn_id: "auth-root".into(),
            conversation_id: "auth-conversation".into(),
            role: "user".into(),
            content: "写本章并总结；在明确授权范围内执行。".into(),
            created_at: now,
        },
    )
    .unwrap();
    let spec = IssueInput {
        conversation_id: "auth-conversation".into(),
        novel_id: "00000000-0000-4000-8000-000000000101".into(),
        source_turn_id: "auth-root".into(),
        chapter_ids: vec!["00000000-0000-4000-8000-000000000102".into()],
        allow_novel_planning: false,
        creation_scope: None,
        actions: vec![
            ActionLimit {
                action: Action::AdoptChapterText,
                max_writes: 2,
            },
            ActionLimit {
                action: Action::ApplySummary,
                max_writes: 2,
            },
        ],
        max_writes: 4,
        budget: Budget {
            max_requests: 24,
            max_tool_calls: 64,
            max_revisions: 2,
            max_tokens: 256_000,
            max_cost_usd: 5.0,
            max_wall_clock_ms: 900_000,
        },
        expires_at: (Utc::now() + chrono::Duration::minutes(15)).to_rfc3339(),
    };
    (conn, spec)
}
#[test]
fn task_authority_issue_view_revoke_and_immutable_scope() {
    let (mut conn, spec) = fixture();
    let grant = issue(&mut conn, spec.clone()).unwrap();
    assert_eq!(grant.status, "active");
    assert_eq!(grant.used_writes, 0);
    assert_eq!(list(&conn, &spec.conversation_id).unwrap().len(), 1);
    assert!(conn.execute("UPDATE task_authorizations SET spec_json='{}',revision=revision+1 WHERE authorization_id=?1",[&grant.authorization_id]).is_err());
    let revoked = revoke(
        &mut conn,
        RevokeInput {
            authorization_id: grant.authorization_id.clone(),
            reason: Some("停止新的自动写入".into()),
        },
    )
    .unwrap();
    assert_eq!(revoked.status, "revoked");
    assert!(revoked.revoked_at.is_some());
    assert_eq!(
        validate_active(&conn, &revoked, &revoked.model_snapshot)
            .unwrap_err()
            .code,
        "TASK_AUTHORIZATION_INACTIVE"
    );
    assert_eq!(
        revoke(
            &mut conn,
            RevokeInput {
                authorization_id: grant.authorization_id,
                reason: None
            }
        )
        .unwrap()
        .revision,
        revoked.revision
    );
}
#[test]
fn task_authority_rejects_unknown_actions_unbounded_scope_and_forged_user() {
    assert!(serde_json::from_value::<Action>(json!("delete_world")).is_err());
    let (mut conn, mut spec) = fixture();
    spec.source_turn_id = "absent".into();
    assert!(issue(&mut conn, spec).is_err());
    let (_, mut spec) = fixture();
    spec.budget.max_requests = 0;
    assert_eq!(
        issue(&mut conn, spec).unwrap_err().code,
        "TASK_AUTHORIZATION_INPUT_INVALID"
    );
    let (_, mut spec) = fixture();
    spec.chapter_ids.clear();
    assert!(issue(&mut conn, spec).is_err());
    let (_, mut spec) = fixture();
    spec.expires_at = (Utc::now() - chrono::Duration::seconds(1)).to_rfc3339();
    assert!(issue(&mut conn, spec).is_err());
}
#[test]
fn task_authority_native_baseline_rejects_manual_edits_and_model_change() {
    let (mut conn, spec) = fixture();
    let grant = issue(&mut conn, spec).unwrap();
    // Initial use does not require a model request; dispatch uses the narrowed limits.
    validate_active(&conn, &grant, &grant.model_snapshot).unwrap();
    conn.execute("UPDATE chapters SET outline='作者中途修改' WHERE id='00000000-0000-4000-8000-000000000102'",[]).unwrap();
    assert_eq!(
        validate_active(&conn, &grant, &grant.model_snapshot)
            .unwrap_err()
            .code,
        "TASK_AUTHORIZATION_BASE_CONFLICT"
    );
    let (mut conn, spec) = fixture();
    let grant = issue(&mut conn, spec).unwrap();
    let mut other = grant.model_snapshot.clone();
    other["modelId"] = json!("silently-switched");
    assert_eq!(
        validate_active(&conn, &grant, &other).unwrap_err().code,
        "TASK_AUTHORIZATION_MODEL_CONFLICT"
    );
}
#[test]
fn task_authority_creations_require_explicit_bounded_volume_and_count() {
    let (mut conn, mut spec) = fixture();
    spec.allow_novel_planning = true;
    spec.actions.push(ActionLimit {
        action: Action::ApplyPlanning,
        max_writes: 1,
    });
    spec.creation_scope = Some(CreationScope {
        first_volume_index: 1,
        last_volume_index: 2,
        max_new_volumes: 2,
        max_new_chapters: 4,
    });
    assert!(issue(&mut conn, spec.clone()).is_ok());
    spec.creation_scope.as_mut().unwrap().max_new_chapters = 201;
    assert!(issue(&mut conn, spec).is_err());
}
#[test]
fn task_authority_backup_restores_active_permission_as_nonexecutable_history() {
    let (mut conn, spec) = fixture();
    let grant = issue(&mut conn, spec).unwrap();
    let backup = crate::project_backup::export_project_backup_in_conn(
        &conn,
        "00000000-0000-4000-8000-000000000101",
    )
    .unwrap();
    assert_eq!(backup.schema_version, 13);
    let restored =
        crate::project_backup::restore_project_backup_in_conn(&mut conn, &backup).unwrap();
    let copied_id = restored.id_map.get(&grant.authorization_id).unwrap();
    let copied = load(&conn, copied_id).unwrap();
    assert_eq!(copied.status, "expired");
    assert_eq!(copied.used_writes, 0);
    assert!(validate_active(&conn, &copied, &copied.model_snapshot).is_err());
}

#[test]
fn issuing_during_an_active_stage_is_explicitly_refused_then_allowed_after_stop() {
    let (mut conn, spec) = fixture();
    let model = baseline::require_task(&conn, &spec).unwrap();
    let now = Utc::now().to_rfc3339();
    conversation_service::create_run(
        &mut conn,
        conversation_service::CreateRunInput {
            run_id: "running-grant-stage".into(),
            conversation_id: spec.conversation_id.clone(),
            turn_id: spec.source_turn_id.clone(),
            model_snapshot: model,
            worker_id: "isolated".into(),
            chapter_id: Some(spec.chapter_ids[0].clone()),
            created_at: now.clone(),
        },
    )
    .unwrap();
    assert_eq!(
        issue(&mut conn, spec.clone()).unwrap_err().code,
        "TASK_AUTHORIZATION_TASK_RUNNING"
    );
    assert!(list(&conn, &spec.conversation_id).unwrap().is_empty());
    conversation_service::update_run(
        &mut conn,
        conversation_service::UpdateRunInput {
            run_id: "running-grant-stage".into(),
            status: "cancelled".into(),
            error: None,
            updated_at: now.clone(),
            started_at: None,
            finished_at: Some(now),
        },
    )
    .unwrap();
    assert_eq!(issue(&mut conn, spec).unwrap().status, "active");
}
#[test]
fn root_end_revokes_only_its_authority_while_explicit_task_cancel_revokes_all() {
    let (mut conn, spec) = fixture();
    let first = issue(&mut conn, spec.clone()).unwrap();
    conversation_service::append_turn(
        &mut conn,
        conversation_service::AppendTurnInput {
            turn_id: "second-explicit-goal".into(),
            conversation_id: spec.conversation_id.clone(),
            role: "user".into(),
            content: "另一个明确目标".into(),
            created_at: Utc::now().to_rfc3339(),
        },
    )
    .unwrap();
    let mut second_spec = spec.clone();
    second_spec.source_turn_id = "second-explicit-goal".into();
    let second = issue(&mut conn, second_spec).unwrap();
    revoke_for_root(
        &conn,
        &spec.conversation_id,
        &spec.source_turn_id,
        "原目标结束",
    )
    .unwrap();
    assert_eq!(
        load(&conn, &first.authorization_id).unwrap().status,
        "revoked"
    );
    assert_eq!(
        load(&conn, &second.authorization_id).unwrap().status,
        "active"
    );
    revoke_for_task(&conn, &spec.conversation_id, "用户显式取消整个任务").unwrap();
    assert_eq!(
        load(&conn, &second.authorization_id).unwrap().status,
        "revoked"
    );
}
