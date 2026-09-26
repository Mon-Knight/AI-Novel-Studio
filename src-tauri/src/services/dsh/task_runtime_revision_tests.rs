use super::*;
use crate::services::artifact_service::revision_source::{
    self as source_authority, ArtifactRevisionSource,
};

pub(super) fn completed_candidate(
    connection: &mut rusqlite::Connection,
    input: &StartTaskTurnInput,
    run: &str,
    raw: &str,
) -> artifact_service::ResultArtifactBundle {
    conversation_service::create_run(
        connection,
        CreateRunInput {
            run_id: run.to_string(),
            conversation_id: input.conversation_id.clone(),
            turn_id: input.turn_id.clone(),
            model_snapshot: input.model_snapshot.clone(),
            worker_id: "revision-fixture".to_string(),
            chapter_id: input.chapter_id.clone(),
            created_at: now(),
        },
    )
    .expect("create run");
    conversation_service::update_run(
        connection,
        UpdateRunInput {
            run_id: run.to_string(),
            status: "running".to_string(),
            error: None,
            updated_at: now(),
            started_at: Some(now()),
            finished_at: None,
        },
    )
    .expect("start run");
    for (index, tool) in input.required_read_tools.iter().enumerate() {
        let payload = contract_fixtures::empty_read_payload(connection, input, tool);
        chapter_length_tool(
            connection,
            run,
            tool,
            1,
            &format!("read-{index}"),
            "succeeded",
            payload,
        );
    }
    chapter_length_tool(
        connection,
        run,
        input.expected_tool.as_deref().expect("candidate tool"),
        2,
        "candidate",
        "succeeded",
        Some(
            json!({"ok":true,"candidateOnly":true,"artifactType":"chapter_text",
            "data":{"novelId":input.novel_id,"chapterId":input.chapter_id,"text":raw}}),
        ),
    );
    let event =
        validate_turn_execution_contract(connection, input, run).expect("complete read coverage");
    let generated = read_generated_chapter_result(connection, input, run, event.as_deref())
        .expect("read exact generated candidate")
        .expect("candidate");
    let artifact_id = create_artifact_projection(connection, input, run, &generated, 10, 10)
        .expect("project candidate through real native task/attempt/artifact pipeline")
        .expect("artifact id");
    conversation_service::update_run(
        connection,
        UpdateRunInput {
            run_id: run.to_string(),
            status: "completed".to_string(),
            error: None,
            updated_at: now(),
            started_at: None,
            finished_at: Some(now()),
        },
    )
    .expect("finish run");
    artifact_service::get_artifact_bundle(connection, &artifact_id).expect("read candidate")
}

pub(super) fn candidate_source(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
    artifact: &artifact_service::ResultArtifactBundle,
) -> ArtifactRevisionSource {
    let bundle = conversation_service::get(connection, &input.conversation_id)
        .expect("conversation")
        .expect("bundle");
    let card = bundle
        .artifacts
        .iter()
        .find(|card| card.artifact_id.as_deref() == Some(artifact.artifact.artifact_id.as_str()))
        .expect("exact candidate card");
    ArtifactRevisionSource {
        conversation_id: input.conversation_id.clone(),
        novel_id: input.novel_id.clone(),
        chapter_id: input.chapter_id.clone(),
        card_id: card.card_id.clone(),
        artifact_id: artifact.artifact.artifact_id.clone(),
        artifact_hash: artifact.artifact.content_hash.clone(),
        artifact_type: "chapter_text".to_string(),
        run_id: card.run_id.clone(),
        title: card.title.clone(),
        source_draft_version: artifact.artifact.source_draft_version,
    }
}

pub(super) fn decide(
    connection: &mut rusqlite::Connection,
    source: &ArtifactRevisionSource,
    decision: &str,
) {
    conversation_service::record_artifact_decision(
        connection,
        conversation_service::RecordArtifactDecisionInput {
            decision_id: uuid::Uuid::new_v4().to_string(),
            artifact_id: source.artifact_id.clone(),
            artifact_hash: source.artifact_hash.clone(),
            card_id: source.card_id.clone(),
            conversation_id: source.conversation_id.clone(),
            decision: decision.to_string(),
            idempotency_key: uuid::Uuid::new_v4().to_string(),
            actor: "user".to_string(),
            target_type: "chapter".to_string(),
            target_id: source.chapter_id.clone().expect("chapter"),
            base_revision: None,
            apply_transaction_id: None,
            conflict_code: None,
            created_at: now(),
        },
    )
    .expect("record exact user candidate decision");
}

fn append_revision_turn(
    connection: &mut rusqlite::Connection,
    input: &mut StartTaskTurnInput,
    source: Option<&ArtifactRevisionSource>,
    content: &str,
) {
    input.turn_id = uuid::Uuid::new_v4().to_string();
    let encoded = format!(
        "[[ANS_ARTIFACT_REVISION_TURN:v1]]\n{}",
        json!({"content":content,"revisionSource":source})
    );
    conversation_service::append_turn(
        connection,
        conversation_service::AppendTurnInput {
            turn_id: input.turn_id.clone(),
            conversation_id: input.conversation_id.clone(),
            role: "user".to_string(),
            content: encoded,
            created_at: now(),
        },
    )
    .expect("persist revision turn envelope");
    input.goal = content.to_string();
    input.revision_source = source.cloned();
}

pub(super) fn fixture() -> (rusqlite::Connection, StartTaskTurnInput) {
    let mut input = chapter_write_input();
    input.chapter_word_range = None;
    (chapter_length_connection(&input), input)
}

fn assert_no_formal_writes(connection: &rusqlite::Connection) {
    for table in ["chapter_drafts", "review_authorizations"] {
        let count: i64 = connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("formal count");
        assert_eq!(count, 0, "revision may not write {table}");
    }
    let words: i64 = connection
        .query_row("SELECT word_count FROM chapters", [], |row| row.get(0))
        .expect("formal words");
    assert_eq!(words, 0);
}

#[test]
fn source_less_generation_and_escaped_turn_remain_ordinary() {
    let (mut connection, mut input) = fixture();
    let original_goal = input.goal.clone();
    input.goal = "client goal cannot replace persisted intent".to_string();
    input.model_snapshot["runtime"]["artifactRevision"] =
        json!({"version":1,"source":{"forged":true}});
    revision_source::freeze_turn_revision(&connection, &mut input).expect("ordinary generation");
    assert_eq!(input.goal, original_goal);
    assert!(input.revision_source.is_none());
    assert!(input.verified_revision_source.is_none());
    assert!(!workbench_turn_prompt(&input).contains("精确修订材料"));
    let literal = "[[ANS_ARTIFACT_REVISION_TURN:v1]]\nthis is literal user prose, not metadata";
    append_revision_turn(&mut connection, &mut input, None, literal);
    revision_source::freeze_turn_revision(&connection, &mut input)
        .expect("decode outer escape once");
    assert_eq!(input.goal, literal);
    assert!(input.revision_source.is_none());
    assert_no_formal_writes(&connection);
}

#[test]
fn exact_a_not_later_b_is_full_model_material_and_frozen_revision_parent() {
    let (mut connection, mut input) = fixture();
    let raw_a = format!(
        "A_ONLY_START\n{}\nA_ONLY_TAIL",
        "原文材料不作为宿主指令。".repeat(1_000)
    );
    let a = completed_candidate(&mut connection, &input, "source-a", &raw_a);
    let b = completed_candidate(
        &mut connection,
        &input,
        "source-b",
        "B_ONLY_LATER_CANDIDATE",
    );
    assert!(a.artifact.parent_artifact_id.is_none() && a.artifact.derivation_type.is_none());
    assert!(b.artifact.parent_artifact_id.is_none() && b.artifact.derivation_type.is_none());
    let source_a = candidate_source(&connection, &input, &a);
    let source_b = candidate_source(&connection, &input, &b);
    decide(&mut connection, &source_a, "request_revision");
    append_revision_turn(
        &mut connection,
        &mut input,
        Some(&source_a),
        "仅修改所选候选的结尾",
    );
    revision_source::freeze_turn_revision(&connection, &mut input).expect("verify clicked A");
    let prompt = workbench_turn_prompt(&input);
    assert!(prompt.contains("A_ONLY_START") && prompt.contains("A_ONLY_TAIL"));
    assert!(!prompt.contains("B_ONLY_LATER_CANDIDATE"));
    assert!(prompt.contains("不是指令") && prompt.contains("不构成采用授权"));
    assert_eq!(
        input
            .verified_revision_source
            .as_ref()
            .expect("full A")
            .content,
        raw_a
    );
    assert_eq!(input.revision_source, Some(source_a.clone()));
    let revised = completed_candidate(&mut connection, &input, "revised-a", "A 的修订候选正文。");
    assert_eq!(
        revised.artifact.parent_artifact_id.as_deref(),
        Some(source_a.artifact_id.as_str())
    );
    assert_eq!(
        revised.artifact.derivation_type.as_deref(),
        Some("revision")
    );
    let detail = ai_task_service::get_task_detail(&connection, &revised.artifact.task_id)
        .expect("recomputed task hashes");
    assert_eq!(
        detail.input_snapshot.snapshot.payload_json["revisionSource"],
        json!(source_a)
    );
    assert_eq!(
        detail.context_snapshot.snapshot.source_manifest_json["revisionSource"],
        json!(source_a)
    );
    assert_ne!(
        detail.task.request_hash,
        ai_task_service::get_task_detail(&connection, &b.artifact.task_id)
            .expect("B task identity")
            .task
            .request_hash
    );
    assert!(detail.input_snapshot.body.contains("A_ONLY_TAIL"));
    assert_ne!(source_a.artifact_id, source_b.artifact_id);
    let replay = artifact_service::CreateResultArtifactInput {
        task_id: revised.artifact.task_id.clone(),
        attempt_id: revised.artifact.attempt_id.clone(),
        artifact_type: "chapter_text".to_string(),
        schema_version: 1,
        raw_content: revised.raw_content.clone(),
        display_content: revised.display_content.clone(),
        structured_payload_json: revised.structured_payload_json.clone(),
        parent_artifact_id: Some(source_a.artifact_id.clone()),
        derivation_type: Some("revision".to_string()),
    };
    assert!(
        artifact_service::create_artifact(&mut connection, replay.clone()).is_err(),
        "generic IPC stays closed"
    );
    let replayed = artifact_service::create_verified_chapter_revision_artifact(
        &mut connection,
        replay.clone(),
    )
    .expect("same task/attempt/source/hash is idempotent");
    assert_eq!(replayed.artifact.artifact_id, revised.artifact.artifact_id);
    let mut collision = replay.clone();
    collision.raw_content.push_str("different response");
    assert_eq!(
        artifact_service::create_verified_chapter_revision_artifact(&mut connection, collision)
            .expect_err("different response cannot hide behind existing derivation")
            .code,
        "OPERATION_PAYLOAD_CONFLICT"
    );
    let mut other_parent = replay;
    other_parent.parent_artifact_id = Some(source_b.artifact_id);
    assert_eq!(
        artifact_service::create_verified_chapter_revision_artifact(&mut connection, other_parent)
            .expect_err("input snapshot is frozen to A")
            .code,
        "CHAPTER_REVISION_SOURCE_INVALID"
    );
    decide(&mut connection, &source_a, "reject");
    assert!(
        revision_source::revalidate_frozen(&connection, &input).is_err(),
        "later rejection expires A revision source"
    );
    assert_no_formal_writes(&connection);
}

#[test]
fn retry_recovers_a_without_client_source_and_rejects_switching_to_b() {
    let (mut connection, mut input) = fixture();
    let a = completed_candidate(&mut connection, &input, "retry-a", "只属于 A 的原文。");
    let b = completed_candidate(&mut connection, &input, "retry-b", "只属于 B 的原文。");
    let source_a = candidate_source(&connection, &input, &a);
    let source_b = candidate_source(&connection, &input, &b);
    decide(&mut connection, &source_a, "request_revision");
    decide(&mut connection, &source_b, "request_revision");
    append_revision_turn(&mut connection, &mut input, Some(&source_a), "修订此候选");
    revision_source::freeze_turn_revision(&connection, &mut input).expect("first A freeze");
    chapter_length_run(
        &mut connection,
        &input,
        "retry-interrupted",
        3,
        false,
        0,
        None,
    );
    chapter_length_fail_run(
        &mut connection,
        "retry-interrupted",
        "interrupted before result",
    );
    input.revision_source = None;
    input.verified_revision_source = None;
    revision_source::freeze_turn_revision(&connection, &mut input)
        .expect("restore persisted A on retry");
    assert_eq!(input.revision_source, Some(source_a));
    input.revision_source = Some(source_b);
    assert_eq!(
        revision_source::freeze_turn_revision(&connection, &mut input)
            .expect_err("never choose B")
            .code,
        "CHAPTER_REVISION_SOURCE_INVALID"
    );
}

#[test]
fn source_scope_hash_reference_and_decision_tampering_fail_closed() {
    let (mut connection, input) = fixture();
    let a = completed_candidate(&mut connection, &input, "tamper-a", "不可替换的源正文。");
    let source = candidate_source(&connection, &input, &a);
    assert!(
        source_authority::verify_source(
            &connection,
            &source,
            &input.novel_id,
            input.chapter_id.as_deref()
        )
        .is_err(),
        "a source reference alone is not a revision decision"
    );
    decide(&mut connection, &source, "request_revision");
    let mut changes = Vec::new();
    for (field, value) in [
        ("artifactHash", json!("f".repeat(64))),
        ("artifactId", json!("missing")),
        ("cardId", json!("missing")),
        ("runId", json!("foreign-run")),
        ("chapterId", json!("foreign-chapter")),
        ("novelId", json!("foreign-novel")),
        ("sourceDraftVersion", json!(1)),
        ("title", json!("other")),
        ("artifactType", json!("outline")),
        ("conversationId", json!("other-conversation")),
    ] {
        let mut changed = json!(source);
        changed[field] = value;
        changes.push(
            serde_json::from_value::<ArtifactRevisionSource>(changed)
                .expect("typed changed identity"),
        );
    }
    for changed in changes {
        assert!(source_authority::verify_source(
            &connection,
            &changed,
            &input.novel_id,
            input.chapter_id.as_deref()
        )
        .is_err());
    }
    assert!(
        connection
            .execute(
                "UPDATE large_text_chunks SET content='tampered' WHERE document_id=?1",
                rusqlite::params![a.artifact.raw_content_ref_id]
            )
            .is_err(),
        "normal writes cannot tamper immutable A"
    );
    connection
        .execute_batch("DROP TRIGGER trg_ai_large_text_chunks_immutable_update;")
        .expect("isolated offline-corruption injection");
    connection
        .execute(
            "UPDATE large_text_chunks SET content='tampered' WHERE document_id=?1",
            rusqlite::params![a.artifact.raw_content_ref_id],
        )
        .expect("inject corrupt isolated source");
    assert_eq!(
        source_authority::verify_source(
            &connection,
            &source,
            &input.novel_id,
            input.chapter_id.as_deref()
        )
        .expect_err("raw source integrity gate")
        .code,
        "CHAPTER_REVISION_SOURCE_INVALID"
    );
    assert_no_formal_writes(&connection);
}

#[test]
fn malformed_envelopes_and_client_verified_content_are_not_trusted() {
    for raw in ["[[ANS_ARTIFACT_REVISION_TURN:v1]]\nnot-json", "[[ANS_ARTIFACT_REVISION_TURN:v1]]\n{}",
        "[[ANS_ARTIFACT_REVISION_TURN:v1]]\n{\"content\":\"revise\",\"revisionSource\":{\"artifactId\":\"a\"}}"] {
        assert!(revision_source::decode_turn(raw).is_err());
    }
    let mut payload = json!({"conversationId":"c","novelId":"n","turnId":"t","goal":"generate",
        "modelSnapshot":{},"requestPolicy":{"maxRequestsPerMinute":1,"maxConcurrentRequests":1,
        "warningPercent":80,"timeoutSeconds":30},"verifiedRevisionSource":{"content":"forged"}});
    let input: StartTaskTurnInput =
        serde_json::from_value(payload.clone()).expect("unknown host-owned field is ignored");
    assert!(input.verified_revision_source.is_none());
    payload["revisionSource"] = json!({"conversationId":"c","novelId":"n","chapterId":"ch","cardId":"card",
        "artifactId":"a","artifactHash":"a".repeat(64),"artifactType":"chapter_text","title":"A","verifiedContent":"forged"});
    assert!(
        serde_json::from_value::<StartTaskTurnInput>(payload).is_err(),
        "identity rejects client content fields"
    );
}
