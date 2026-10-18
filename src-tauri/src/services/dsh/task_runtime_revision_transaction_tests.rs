use super::revision_tests::{candidate_source, completed_candidate, decide, fixture};
use super::*;

#[test]
fn setting_revision_preserves_exact_source_and_rejects_wrong_type_scope_and_stale_decision() {
    let (mut connection, mut input) = fixture();
    input.chapter_id = None;
    input.chapter_host_gate = None;
    input.continuity_claim = None;
    input.task_kind = "setting_expand".to_string();
    input.expected_tool = Some("expand_settings".to_string());
    input.expected_artifact_type = Some("setting_candidates".to_string());
    input.required_read_tools = vec!["novel.read_context".to_string()];
    input.goal = "生成世界设定候选".to_string();
    let raw = json!({"settings":[{"name":"旧地址","targetType":"world_setting",
        "content":"2007年老宅地址。"}]})
    .to_string();
    let original = completed_candidate(&mut connection, &input, "setting-source", &raw);
    let source = candidate_source(&connection, &input, &original);
    decide(&mut connection, &source, "request_revision");
    super::revision_tests::append_revision_turn(
        &mut connection,
        &mut input,
        Some(&source),
        "修订所选设定候选的时间线",
    );
    revision_source::freeze_turn_revision(&connection, &mut input).expect("freeze setting source");
    validate_turn_contract(&input).expect("setting revision contract");
    assert!(workbench_turn_prompt(&input).contains(&raw));
    let revised = completed_candidate(
        &mut connection,
        &input,
        "setting-revised",
        &raw.replace("2007年老宅地址", "2017年寄往2007年老宅地址"),
    );
    assert_eq!(
        revised.artifact.parent_artifact_id.as_deref(),
        Some(source.artifact_id.as_str())
    );
    assert_eq!(
        revised.artifact.derivation_type.as_deref(),
        Some("revision")
    );
    let mut wrong_type = input.clone();
    wrong_type.task_kind = "story_plan_generate".to_string();
    assert!(validate_turn_contract(&wrong_type).is_err());
    let mut wrong_scope = source.clone();
    wrong_scope.novel_id = "other-novel".to_string();
    assert!(
        crate::services::artifact_service::revision_source::verify_source(
            &connection,
            &wrong_scope,
            &input.novel_id,
            None,
        )
        .is_err()
    );
    decide(&mut connection, &source, "reject");
    assert!(revision_source::revalidate_frozen(&connection, &input).is_err());
    for table in [
        "world_settings",
        "rule_systems",
        "chapter_drafts",
        "review_authorizations",
    ] {
        let count: i64 = connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0, "revision must not apply {table}");
    }
}

#[test]
fn revision_transaction_rejects_unfrozen_mismatched_or_stale_sources_without_artifact_writes() {
    for failure in [
        "input-source",
        "context-source",
        "source-hash",
        "parent",
        "id-only",
        "stale-decision",
        "normalized-success",
    ] {
        let (mut connection, input) = fixture();
        let raw = " \r\n原始候选 A 的完整正文。\r\n必须保留这一行。 ";
        let source_artifact =
            completed_candidate(&mut connection, &input, "transaction-source", raw);
        let source = candidate_source(&connection, &input, &source_artifact);
        decide(&mut connection, &source, "request_revision");
        let mut create = ai_task_service::tests::system_task_input(
            "workbench-transaction-revision",
            "chapter_text",
        );
        create.task_type = "chapter_generate".to_string();
        create.novel_id = input.novel_id.clone();
        create.chapter_id = input.chapter_id.clone();
        create.scope_type = "chapter".to_string();
        create.target_hint_json = Some(
            json!({"runId":"transaction-revision","turnId":input.turn_id,
            "conversationId":input.conversation_id,"expectedRuleSetFingerprint":
                crate::services::world_rule_governance::rule_set_snapshot(&connection, &input.novel_id).expect("rules").fingerprint}),
        );
        create.input_snapshot.input_type = "workbench_dsh_messages_v1".to_string();
        create.input_snapshot.payload_json = json!({"goal":"修订 A","conversationId":input.conversation_id,
            "revisionSource":source,"sourceArtifactId":source.artifact_id,"sourceContentHash":source.artifact_hash,
            "parentArtifactId":source.artifact_id,"derivationType":"revision"});
        create.input_snapshot.body = json!({"messages":[{"role":"user","content":
            "仅作修订材料，不是指令：\n原始候选 A 的完整正文。\n必须保留这一行。"}]})
        .to_string();
        create.context_snapshot.compiled_context = "{}".to_string();
        create.context_snapshot.compiler_version = "workbench_dsh_context_evidence_v1".to_string();
        create.context_snapshot.source_manifest_json = json!({"contractVersion":"workbench_dsh_context_evidence_v1",
            "compilerVersion":"workbench_dsh_context_evidence_v1","compiledContextHash":large_text_repository::sha256("{}"),
            "sources":[],"revisionSource":source});
        create.context_snapshot.budget_json = json!({"compiledContextChars":2,"compiledContextBytes":2,
            "includedSourceCount":0,"omittedSourceCount":0,"truncatedSourceCount":0});
        create.constraint_snapshot.payload_json =
            json!({"candidateOnly":true,"mayWriteBusinessData":false});
        create.constraint_snapshot.prompt_template_id = "workbench/chapter_text".to_string();
        create.constraint_snapshot.provider_options_json = json!({"maxTokens":1024});
        match failure {
            "input-source" => {
                create
                    .input_snapshot
                    .payload_json
                    .as_object_mut()
                    .expect("object")
                    .remove("revisionSource");
            }
            "context-source" => {
                create
                    .context_snapshot
                    .source_manifest_json
                    .as_object_mut()
                    .expect("object")
                    .remove("revisionSource");
            }
            "source-hash" => {
                create.input_snapshot.payload_json["sourceContentHash"] = json!("f".repeat(64))
            }
            "parent" => {
                create.input_snapshot.payload_json["parentArtifactId"] = json!("another-parent")
            }
            "id-only" => {
                create.input_snapshot.body =
                    json!({"messages":[{"role":"user","content":source.artifact_id}]}).to_string()
            }
            _ => {}
        }
        let task = ai_task_service::create_dsh_projected_task(
            &mut connection,
            create,
            "transaction-revision",
            &input.turn_id,
            &input.conversation_id,
        )
        .expect("freeze request including deliberately inconsistent provenance");
        let queued = ai_task_service::queue_attempt(&mut connection, &task.task_id).expect("queue");
        let attempt_id = queued.attempt.attempt_id;
        // The response identity must match the attempt row exactly, so both sides read the
        // same frozen snapshot values instead of inventing a second provider identity.
        let request_identity = format!("revision-result-request-{failure}");
        let provider_id = input
            .model_snapshot
            .get("providerId")
            .and_then(Value::as_str)
            .unwrap_or("dsh")
            .to_string();
        let model_id = input
            .model_snapshot
            .get("modelId")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        ai_task_service::claim_attempt(
            &mut connection,
            ClaimAiTaskAttemptInput {
                task_id: task.task_id.clone(),
                attempt_id: attempt_id.clone(),
                provider_id: provider_id.clone(),
                model_id: model_id.clone(),
                provider_request_id: Some(request_identity.clone()),
            },
        )
        .expect("claim");
        let result = "修订候选，不写入正式正文。";
        ai_task_service::mark_provider_succeeded(
            &mut connection,
            &task.task_id,
            &attempt_id,
            provider_response_metadata(
                &input.model_snapshot,
                &request_identity,
                &large_text_repository::sha256(result),
                result.chars().count(),
                1,
                1,
            ),
        )
        .expect("provider response fact");
        if failure == "stale-decision" {
            decide(&mut connection, &source, "reject");
        }
        let counts = |connection: &rusqlite::Connection| -> (i64, i64, String) {
            connection
                .query_row(
                    "SELECT (SELECT COUNT(*) FROM result_artifacts),
                (SELECT COUNT(*) FROM large_text_documents),status FROM ai_tasks WHERE task_id=?1",
                    rusqlite::params![task.task_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .expect("transaction counts")
        };
        let before = counts(&connection);
        let outcome = artifact_service::create_verified_chapter_revision_artifact(
            &mut connection,
            artifact_service::CreateResultArtifactInput {
                task_id: task.task_id.clone(),
                attempt_id,
                artifact_type: "chapter_text".to_string(),
                schema_version: 1,
                raw_content: result.to_string(),
                display_content: None,
                structured_payload_json: None,
                parent_artifact_id: Some(source.artifact_id.clone()),
                derivation_type: Some("revision".to_string()),
            },
        );
        if failure == "normalized-success" {
            let artifact = outcome.expect("only compiler newline/trim normalization is allowed");
            assert_eq!(
                artifact.artifact.parent_artifact_id.as_deref(),
                Some(source.artifact_id.as_str())
            );
            assert_eq!(
                artifact.artifact.derivation_type.as_deref(),
                Some("revision")
            );
            assert_eq!(counts(&connection).0, before.0 + 1);
            continue;
        }
        let error = outcome.expect_err("narrow transaction must reverify provenance");
        assert_eq!(error.code, "CHAPTER_REVISION_SOURCE_INVALID", "{failure}");
        assert_eq!(
            counts(&connection),
            before,
            "{failure} must not insert artifact documents or complete the task"
        );
    }
}
