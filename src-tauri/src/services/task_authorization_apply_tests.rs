//! Formal-write behavior exercised through real immutable Task/Artifact facts and isolated SQLite.
use super::tests::fixture;
use super::*;
use crate::repositories::{draft_repository, large_text_repository};
use crate::services::{
    ai_task_service as tasks, artifact_service, conversation_service as conversations,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

fn complete_event(
    conn: &mut Connection,
    mut event: conversations::AppendToolEventInput,
) -> Result<(), AppError> {
    let event_id = event.event_id.clone();
    let result = event.result.take();
    let finished_at = event.finished_at.take();
    let duration_ms = event.duration_ms.take();
    let error = event.error.take();
    event.status = "running".into();
    conversations::append_tool_event(conn, event)?;
    conversations::update_tool_event(
        conn,
        conversations::UpdateToolEventInput {
            event_id,
            status: "succeeded".into(),
            duration_ms,
            error,
            result,
            finished_at,
        },
    )?;
    Ok(())
}

pub(crate) fn publish(
    conn: &mut Connection,
    spec: &IssueInput,
    suffix: &str,
    kind: &str,
    raw: &str,
    payload: Option<Value>,
) -> (String, String) {
    let now = Utc::now().to_rfc3339();
    let run = format!("auth-run-{suffix}");
    let card = format!("auth-card-{suffix}");
    let model = baseline::require_task(conn, spec).unwrap();
    conversations::create_run(
        conn,
        conversations::CreateRunInput {
            run_id: run.clone(),
            conversation_id: spec.conversation_id.clone(),
            turn_id: spec.source_turn_id.clone(),
            model_snapshot: model.clone(),
            worker_id: "offline-authority-fixture".into(),
            chapter_id: Some(spec.chapter_ids[0].clone()),
            created_at: now.clone(),
        },
    )
    .unwrap();
    conversations::update_run(
        conn,
        conversations::UpdateRunInput {
            run_id: run.clone(),
            status: "running".into(),
            error: None,
            updated_at: now.clone(),
            started_at: Some(now.clone()),
            finished_at: None,
        },
    )
    .unwrap();
    let started:i64=conn.query_row("SELECT CAST(strftime('%s',created_at) AS INTEGER)*1000 FROM conversation_turns WHERE turn_id=?1",[&spec.source_turn_id],|r|r.get(0)).unwrap();
    complete_event(conn,conversations::AppendToolEventInput{event_id:format!("contract-{suffix}"),run_id:run.clone(),tool_name:"dsh.execution_contract".into(),arguments_summary:json!({"source":"ans-host","execution":{"version":1,"rootTaskId":spec.conversation_id,"rootRunId":"auth-run-root","rootTurnId":spec.source_turn_id,"budgetEpoch":"auth-fixture-epoch","startedAtMs":started}}),status:"succeeded".into(),duration_ms:None,error:None,result:Some(json!({})),created_at:now.clone(),finished_at:Some(now.clone())}).unwrap();
    let mut input = tasks::tests::system_task_input(&format!("auth-task-{suffix}"), kind);
    input.task_type = if kind == "outline" {
        "outline_generate"
    } else if kind == "chapter_summary" {
        "chapter_summary"
    } else {
        "chapter_generate"
    }
    .into();
    input.novel_id = Some(spec.novel_id.clone());
    input.chapter_id = Some(spec.chapter_ids[0].clone());
    input.scope_type = "chapter".into();
    let chapter_revision: String = conn
        .query_row(
            "SELECT updated_at FROM chapters WHERE id=?1",
            [&spec.chapter_ids[0]],
            |r| r.get(0),
        )
        .unwrap();
    input.target_hint_json = Some(
        json!({"conversationId":spec.conversation_id,"turnId":spec.source_turn_id,"runId":run,"modelSnapshot":model,"baseChapterRevision":chapter_revision}),
    );
    input.input_snapshot.body = raw.into();
    input.input_snapshot.payload_json = json!({"conversationId":spec.conversation_id});
    if kind == "chapter_summary" {
        input.input_snapshot.payload_json["summaryGroundingVersion"] = json!(1);
        input.input_snapshot.payload_json["summaryCoverageVersion"] = json!(1);
        let adopted: String = conn
            .query_row(
                "SELECT adopted_draft_id FROM chapters WHERE id=?1",
                [&spec.chapter_ids[0]],
                |r| r.get(0),
            )
            .unwrap();
        let draft = draft_repository::find_draft(conn, &adopted)
            .unwrap()
            .unwrap();
        let full = crate::services::draft_service::load_full_content(conn, &draft).unwrap();
        input.draft_id = Some(adopted.clone());
        input.scope_type = "draft".into();
        input.input_snapshot.source_draft_id = Some(adopted);
        input.input_snapshot.source_draft_version = Some(draft.version_no);
        input.input_snapshot.base_content_hash = Some(full.content_hash);
    }
    let task = tasks::create_task(conn, input).unwrap();
    let queued = tasks::queue_attempt(conn, &task.task_id).unwrap();
    let attempt = tasks::claim_attempt(
        conn,
        tasks::ClaimAiTaskAttemptInput {
            task_id: task.task_id.clone(),
            attempt_id: queued.attempt.attempt_id,
            provider_id: "mock".into(),
            model_id: "offline".into(),
            provider_request_id: Some(format!("offline-{suffix}")),
        },
    )
    .unwrap();
    tasks::mark_provider_succeeded(conn,&task.task_id,&attempt.attempt.attempt_id,json!({"provider":"mock","model":"offline","providerRequestId":format!("offline-{suffix}"),"responseHash":large_text_repository::sha256(raw),"responseLength":raw.chars().count(),"tokenInput":1,"tokenOutput":1,"tokenTotal":2,"finishReason":"stop","durationMs":1})).unwrap();
    let artifact = artifact_service::create_artifact(
        conn,
        artifact_service::CreateResultArtifactInput {
            task_id: task.task_id,
            attempt_id: attempt.attempt.attempt_id,
            artifact_type: kind.into(),
            schema_version: 1,
            raw_content: raw.into(),
            display_content: None,
            structured_payload_json: payload,
            parent_artifact_id: None,
            derivation_type: None,
        },
    )
    .unwrap();
    assert!(
        matches!(
            artifact.artifact.processing_status.as_str(),
            "valid" | "valid_with_warnings"
        ),
        "{:?}",
        artifact.issues
    );
    conversations::create_artifact_card(
        conn,
        conversations::CreateArtifactCardInput {
            card_id: card.clone(),
            conversation_id: spec.conversation_id.clone(),
            turn_id: Some(spec.source_turn_id.clone()),
            run_id: Some(run.clone()),
            artifact_id: Some(artifact.artifact.artifact_id.clone()),
            artifact_type: kind.into(),
            title: "离线候选".into(),
            summary: "隔离测试".into(),
            content: None,
            status: "candidate".into(),
            created_at: now.clone(),
        },
    )
    .unwrap();
    if kind == "chapter_text" {
        let policy = large_text_repository::sha256(&format!(
            "{}{}{}",
            include_str!("../../../scripts/dsh/chapter-integrity.mjs"),
            include_str!("../../../scripts/dsh/chapter-integrity-boundary.mjs"),
            include_str!("../../../scripts/dsh/chapter-integrity-narrative.mjs")
        ));
        let words = crate::services::draft_service::word_count(raw);
        complete_event(conn,conversations::AppendToolEventInput{event_id:format!("{run}-native-admission"),run_id:run.clone(),tool_name:"dsh.candidate_admission".into(),arguments_summary:json!({"source":"ans-native-host","policy":"ans_chapter_integrity_native_v1","policyHash":policy,"rootTaskId":spec.conversation_id,"rootTurnId":spec.source_turn_id,"novelId":spec.novel_id,"chapterId":spec.chapter_ids[0],"artifactId":artifact.artifact.artifact_id,"contentHash":artifact.artifact.content_hash,"wordRange":{"target":words,"minimum":1,"maximum":words+10},"previousChapterId":null,"previousSourceHash":null}),status:"succeeded".into(),duration_ms:None,error:None,result:Some(json!({"issues":[],"semanticRules":"not_checked","formalWrite":false})),created_at:now.clone(),finished_at:Some(now.clone())}).unwrap();
    }
    conversations::update_run(
        conn,
        conversations::UpdateRunInput {
            run_id: run.clone(),
            status: "completed".into(),
            error: None,
            updated_at: now.clone(),
            started_at: None,
            finished_at: Some(now.clone()),
        },
    )
    .unwrap();
    (card, artifact.artifact.artifact_id)
}
pub(super) fn input(
    grant: &Authorization,
    card: String,
    artifact: String,
    action: Action,
) -> ApplyInput {
    ApplyInput {
        authorization_id: grant.authorization_id.clone(),
        operation_id: format!("apply:{card}"),
        card_id: card,
        artifact_id: artifact,
        action,
    }
}
#[test]
fn planning_receipt_is_atomic_idempotent_and_cannot_refresh_external_conflicts() {
    let (mut conn, mut spec) = fixture();
    spec.actions = vec![ActionLimit {
        action: Action::ApplyPlanning,
        max_writes: 2,
    }];
    spec.max_writes = 2;
    let grant = issue(&mut conn, spec.clone()).unwrap();
    let (card, artifact) = publish(
        &mut conn,
        &spec,
        "plan",
        "outline",
        r#"{"title":"章纲","content":"新的章节规划。"}"#,
        Some(json!({"title":"章纲","content":"新的章节规划。"})),
    );
    let request = input(&grant, card, artifact, Action::ApplyPlanning);
    let receipt = apply(&mut conn, request.clone()).unwrap();
    assert_eq!(receipt.authority, "task_preauthorized");
    assert_eq!(load(&conn, &grant.authorization_id).unwrap().used_writes, 1);
    assert!(apply(&mut conn, request.clone()).unwrap().replayed);
    let actor: String = conn
        .query_row(
            "SELECT actor FROM artifact_decisions WHERE decision_id=?1",
            [receipt.result["decisionId"].as_str().unwrap()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(actor, "task_preauthorized");
    conn.execute(
        "UPDATE chapters SET outline='用户中途改动' WHERE id=?1",
        [&spec.chapter_ids[0]],
    )
    .unwrap();
    let mut other = request;
    other.operation_id = "new-operation".into();
    assert_eq!(
        apply(&mut conn, other).unwrap_err().code,
        "TASK_AUTHORIZATION_BASE_CONFLICT"
    );
    revoke(
        &mut conn,
        RevokeInput {
            authorization_id: grant.authorization_id,
            reason: None,
        },
    )
    .unwrap();
}
#[test]
fn later_reject_blocks_new_preauthorized_apply_but_preserves_receipt_replay() {
    let (mut conn, mut spec) = fixture();
    spec.actions = vec![ActionLimit {
        action: Action::AdoptChapterText,
        max_writes: 2,
    }];
    spec.max_writes = 2;
    let grant = issue(&mut conn, spec.clone()).unwrap();
    let (card, artifact) = publish(
        &mut conn,
        &spec,
        "decision-guard",
        "chapter_text",
        "她推开门，看见雨后的街道。",
        None,
    );
    let request = input(
        &grant,
        card.clone(),
        artifact.clone(),
        Action::AdoptChapterText,
    );
    let first = apply(&mut conn, request.clone()).unwrap();
    let bundle = artifact_service::get_artifact_bundle(&conn, &artifact).unwrap();
    conversations::record_artifact_decision(
        &mut conn,
        conversations::RecordArtifactDecisionInput {
            decision_id: "decision-guard-reject".into(),
            artifact_id: artifact.clone(),
            artifact_hash: bundle.artifact.content_hash,
            card_id: card.clone(),
            conversation_id: spec.conversation_id.clone(),
            decision: "reject".into(),
            idempotency_key: "decision-guard-reject-op".into(),
            actor: "user".into(),
            target_type: "chapter".into(),
            target_id: spec.chapter_ids[0].clone(),
            base_revision: None,
            apply_transaction_id: None,
            conflict_code: None,
            created_at: Utc::now().to_rfc3339(),
        },
    )
    .unwrap();

    assert!(apply(&mut conn, request.clone()).unwrap().replayed);
    let mut fresh = request;
    fresh.operation_id = "decision-guard-new-operation".into();
    assert_eq!(
        apply(&mut conn, fresh).unwrap_err().code,
        "TASK_AUTHORIZATION_CANDIDATE_DECISION_INVALID"
    );
    assert_eq!(load(&conn, &grant.authorization_id).unwrap().used_writes, 1);
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM task_authorization_receipts WHERE authorization_id=?1",
            [&grant.authorization_id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap(),
        1
    );
    assert_eq!(
        first.receipt_id,
        receipts::list(&conn, &grant.authorization_id).unwrap()[0].receipt_id
    );
}

#[test]
fn request_revision_blocks_a_new_preauthorized_apply_before_quota() {
    let (mut conn, mut spec) = fixture();
    spec.actions = vec![ActionLimit {
        action: Action::AdoptChapterText,
        max_writes: 1,
    }];
    spec.max_writes = 1;
    let grant = issue(&mut conn, spec.clone()).unwrap();
    let (card, artifact) = publish(
        &mut conn,
        &spec,
        "decision-guard-revision",
        "chapter_text",
        "她把信放回桌面。",
        None,
    );
    let bundle = artifact_service::get_artifact_bundle(&conn, &artifact).unwrap();
    conversations::record_artifact_decision(
        &mut conn,
        conversations::RecordArtifactDecisionInput {
            decision_id: "decision-guard-request-revision".into(),
            artifact_id: artifact.clone(),
            artifact_hash: bundle.artifact.content_hash,
            card_id: card.clone(),
            conversation_id: spec.conversation_id.clone(),
            decision: "request_revision".into(),
            idempotency_key: "decision-guard-request-revision-op".into(),
            actor: "user".into(),
            target_type: "chapter".into(),
            target_id: spec.chapter_ids[0].clone(),
            base_revision: None,
            apply_transaction_id: None,
            conflict_code: None,
            created_at: Utc::now().to_rfc3339(),
        },
    )
    .unwrap();
    assert_eq!(
        apply(
            &mut conn,
            input(&grant, card, artifact, Action::AdoptChapterText),
        )
        .unwrap_err()
        .code,
        "TASK_AUTHORIZATION_CANDIDATE_DECISION_INVALID"
    );
    assert_eq!(load(&conn, &grant.authorization_id).unwrap().used_writes, 0);
}

#[test]
fn preauthorized_large_body_adoption_has_no_fabricated_review_and_replay_survives_revoke() {
    let (mut conn, spec) = fixture();
    let grant = issue(&mut conn, spec.clone()).unwrap();
    let prose = "她打开窗户，看见雨后的街道。".repeat(9_000);
    let (card, artifact) = publish(&mut conn, &spec, "body", "chapter_text", &prose, None);
    let request = input(&grant, card, artifact, Action::AdoptChapterText);
    let receipt = apply(&mut conn, request.clone()).unwrap();
    let draft_id = receipt.result["adoptedDraftId"].as_str().unwrap();
    let draft = draft_repository::find_draft(&conn, draft_id)
        .unwrap()
        .unwrap();
    assert!(draft.is_adopted);
    assert!(draft.large_text_ref_id.is_some());
    assert_eq!(
        crate::services::draft_service::load_full_content(&conn, &draft)
            .unwrap()
            .content,
        prose
    );
    let reviews: i64 = conn
        .query_row("SELECT COUNT(*) FROM review_authorizations", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(reviews, 0);
    revoke(
        &mut conn,
        RevokeInput {
            authorization_id: grant.authorization_id.clone(),
            reason: None,
        },
    )
    .unwrap();
    assert!(apply(&mut conn, request.clone()).unwrap().replayed);
    let mut new_operation = request;
    new_operation.operation_id = "late-callback-with-new-identity".into();
    assert!(apply(&mut conn, new_operation).is_err());
    assert_eq!(load(&conn, &grant.authorization_id).unwrap().used_writes, 1);
}

#[test]
fn summary_auto_apply_records_no_human_review_and_blocks_character_errors() {
    for blocking in [false, true] {
        let (mut conn, mut spec) = fixture();
        let content = "林夏走进图书馆。";
        conn.execute("INSERT INTO chapter_drafts(id,novel_id,chapter_id,content,source,version_no,word_count,is_adopted,content_hash,created_at,updated_at)VALUES('00000000-0000-4000-8000-000000000103',?1,?2,?3,'manual',1,8,0,?4,'t','t')",params![spec.novel_id,spec.chapter_ids[0],content,large_text_repository::sha256(content)]).unwrap();
        crate::services::chapter_service::adopt_chapter_draft(
            &mut conn,
            "00000000-0000-4000-8000-000000000103",
            &spec.chapter_ids[0],
        )
        .unwrap();
        spec.actions = vec![ActionLimit {
            action: Action::ApplySummary,
            max_writes: 1,
        }];
        spec.max_writes = 1;
        let grant = issue(&mut conn, spec.clone()).unwrap();
        let mut claims = vec![json!({"path":"/summary","status":"confirmed","quotes":[content]})];
        if blocking {
            claims.push(json!({"path":"/characterChanges/0/stateSummary","status":"confirmed","quotes":[content]}));
        }
        let payload = if blocking {
            json!({"summary":content,"characterChanges":[{"characterName":"根本不存在的角色","stateSummary":"走进图书馆"}],"contextRecords":[],"grounding":{"version":1,"claims":claims}})
        } else {
            json!({"summary":content,"characterChanges":[],"contextRecords":[],"grounding":{"version":1,"claims":claims}})
        };
        let raw = payload.to_string();
        let (card, artifact) = publish(
            &mut conn,
            &spec,
            "summary",
            "chapter_summary",
            &raw,
            Some(payload),
        );
        let result = apply(
            &mut conn,
            input(&grant, card, artifact, Action::ApplySummary),
        );
        if blocking {
            assert_eq!(
                result.unwrap_err().code,
                "SUMMARY_BLOCKING_VALIDATION_ERROR"
            );
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM chapter_summaries", [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, 0);
            assert_eq!(load(&conn, &grant.authorization_id).unwrap().used_writes, 0);
        } else {
            result.unwrap();
            let raw: String = conn
                .query_row("SELECT validation_result FROM chapter_summaries", [], |r| {
                    r.get(0)
                })
                .unwrap();
            let validation: Value = serde_json::from_str(&raw).unwrap();
            assert_eq!(validation["authorReviewed"], false);
            assert_eq!(validation["semanticValidation"], "not_checked");
            assert_eq!(
                validation["applicationProvenance"]["mode"],
                "task_preauthorization"
            );
            assert_eq!(
                validation["applicationProvenance"]["authorizationId"],
                grant.authorization_id
            );
        }
    }
}
