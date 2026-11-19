//! Exercise post-candidate grant reconciliation using committed SQLite facts, not a model.
use super::*;
use crate::services::{
    task_authorization_contract::{Action, ActionLimit, ApplyInput},
    task_authorization_service as grants,
};

#[test]
fn pending_grant_retires_only_completed_root_and_keeps_committed_receipt() {
    for continues in [true, false] {
        let (mut connection, mut spec) = grants::grant_fixture();
        let (kind, action, raw, payload) = if continues {
            (
                "chapter_text",
                Action::AdoptChapterText,
                "她推开门，走进雨后的街道。",
                None,
            )
        } else {
            let plan = r#"{"title":"章纲","content":"新的章节规划。"}"#;
            (
                "outline",
                Action::ApplyPlanning,
                plan,
                Some(serde_json::from_str(plan).unwrap()),
            )
        };
        spec.actions = vec![ActionLimit {
            action: action.clone(),
            max_writes: 2,
        }];
        spec.max_writes = 2;
        let (card, artifact) =
            grants::publish_test_candidate(&mut connection, &spec, "late", kind, raw, payload);
        let grant = grants::issue(&mut connection, spec.clone()).unwrap();
        let mut input: StartTaskTurnInput = serde_json::from_value(json!({
            "conversationId":spec.conversation_id,"novelId":spec.novel_id,"turnId":spec.source_turn_id,
            "chapterId":spec.chapter_ids[0],"goal":"处理当前候选","taskKind":"creative_dialogue",
            "modelSnapshot":grant.model_snapshot,
            "requestPolicy":{"maxRequestsPerMinute":120,"maxConcurrentRequests":2,"warningPercent":80,"timeoutSeconds":120}
        })).unwrap();
        input.execution = Some(execution::RootExecution::new(&connection, &input).unwrap());

        let mut other = spec.clone();
        other.source_turn_id = "independent-root".into();
        conversation_service::append_turn(
            &mut connection,
            conversation_service::AppendTurnInput {
                turn_id: other.source_turn_id.clone(),
                conversation_id: other.conversation_id.clone(),
                role: "user".into(),
                content: "另一独立目标".into(),
                created_at: now(),
            },
        )
        .unwrap();
        let unrelated = grants::issue(&mut connection, other).unwrap();
        let receipt = grants::try_apply_candidate(
            &mut connection,
            &spec.conversation_id,
            &spec.source_turn_id,
            &card,
            &artifact,
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            grants::load(&connection, &grant.authorization_id)
                .unwrap()
                .status,
            "active"
        );
        let next =
            after_authorized_application(&mut connection, &mut input, &receipt, "auth-run-late")
                .unwrap();
        assert_eq!(
            next.as_ref().map(|stage| stage.task_kind.as_str()),
            continues.then_some("chapter_summary")
        );
        let finished = grants::load(&connection, &grant.authorization_id).unwrap();
        assert_eq!(
            finished.status,
            if continues { "active" } else { "revoked" }
        );
        assert_eq!(finished.used_writes, 1);
        assert_eq!(
            grants::load(&connection, &unrelated.authorization_id)
                .unwrap()
                .status,
            "active"
        );
        let replay = grants::apply(
            &mut connection,
            ApplyInput {
                authorization_id: grant.authorization_id.clone(),
                operation_id: receipt.operation_id.clone(),
                card_id: card,
                artifact_id: artifact,
                action,
            },
        )
        .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.receipt_id, receipt.receipt_id);
        assert_eq!(
            grants::list_receipts(&connection, &grant.authorization_id)
                .unwrap()
                .len(),
            1
        );
    }
}
