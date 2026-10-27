use super::*;
use crate::repositories::chapter_workflow_stage_repository as repo;
use crate::repositories::large_text_repository;
use crate::services::ai_fact_security;
use crate::services::ai_task_service::{
    self, ClaimAiTaskAttemptInput, ConstraintSnapshotInput, ContextSnapshotInput,
    CreateAiTaskInput, InputSnapshotInput,
};
use crate::services::artifact_service::{self, CreateResultArtifactInput};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

struct StageScopeFixture {
    novel_id: String,
    chapter_id: String,
    conversation_id: String,
    workflow_id: String,
    run_id: String,
}

fn connection() -> Connection {
    let mut connection = Connection::open_in_memory().expect("open in-memory database");
    connection
        .execute_batch("PRAGMA foreign_keys=ON;")
        .expect("enable foreign keys");
    crate::db::create_tables(&mut connection).expect("create current schema");
    connection
}

fn hash(value: &str) -> String {
    large_text_repository::sha256(value)
}

fn seed_scope(connection: &Connection, suffix: &str) -> StageScopeFixture {
    let novel_id = format!("novel-{suffix}");
    let chapter_id = format!("chapter-{suffix}");
    let conversation_id = format!("conversation-{suffix}");
    let workflow_id = format!("turn-{suffix}");
    let run_id = format!("run-{suffix}");
    connection
        .execute_batch(&format!(
            "INSERT INTO novels (id, title, status, created_at, updated_at)
             VALUES ('{novel_id}', 'Novel', 'draft', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO chapters (id, novel_id, title, status, created_at, updated_at)
             VALUES ('{chapter_id}', '{novel_id}', 'Chapter', 'not_started',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO task_conversations
                 (conversation_id, novel_id, title, status, created_at, updated_at)
             VALUES ('{conversation_id}', '{novel_id}', 'Task', 'idle',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO conversation_turns
                 (turn_id, conversation_id, sequence, role, content, created_at)
             VALUES ('{workflow_id}', '{conversation_id}', 0, 'user', 'write chapter',
                     '2026-01-01T00:00:00Z');
             INSERT INTO task_runs
                 (run_id, conversation_id, turn_id, status, model_snapshot_json, worker_id,
                  chapter_id, created_at, updated_at)
             VALUES ('{run_id}', '{conversation_id}', '{workflow_id}', 'queued',
                     '{{\"providerId\":\"mock\",\"modelId\":\"mock-v1\"}}', 'worker-1',
                     '{chapter_id}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');"
        ))
        .expect("seed workflow scope");
    StageScopeFixture {
        novel_id,
        chapter_id,
        conversation_id,
        workflow_id,
        run_id,
    }
}

fn stage_input(
    scope: &StageScopeFixture,
    stage_key: &str,
    stage_kind: &str,
) -> StartChapterWorkflowStageInput {
    StartChapterWorkflowStageInput {
        workflow_id: scope.workflow_id.clone(),
        conversation_id: scope.conversation_id.clone(),
        novel_id: scope.novel_id.clone(),
        chapter_id: scope.chapter_id.clone(),
        run_id: scope.run_id.clone(),
        stage_key: stage_key.to_string(),
        stage_kind: stage_kind.to_string(),
        scene_id: Some("scene-1".to_string()),
        beat_id: Some("beat-1".to_string()),
        plan_version: 2,
        context_hash: hash("context"),
        base_hash: hash("base"),
        input_hash: hash("input"),
        plan_hash: hash("plan"),
        model_snapshot_hash: None,
        attempt: None,
    }
}

fn complete_large(
    stage: &ChapterWorkflowStageRecord,
    text: &str,
) -> CompleteChapterWorkflowStageInput {
    CompleteChapterWorkflowStageInput {
        stage_id: stage.stage_id.clone(),
        expected_revision: stage.revision,
        expected_result_hash: hash(text),
        output: ChapterWorkflowStageOutput::LargeText(text.to_string()),
    }
}

fn complete_json(
    stage: &ChapterWorkflowStageRecord,
    text: &str,
) -> CompleteChapterWorkflowStageInput {
    CompleteChapterWorkflowStageInput {
        stage_id: stage.stage_id.clone(),
        expected_revision: stage.revision,
        expected_result_hash: hash(text),
        output: ChapterWorkflowStageOutput::BoundedJson(text.to_string()),
    }
}

fn list_input(scope: &StageScopeFixture) -> ListChapterWorkflowStagesInput {
    ListChapterWorkflowStagesInput {
        novel_id: scope.novel_id.clone(),
        chapter_id: scope.chapter_id.clone(),
        conversation_id: None,
        workflow_id: None,
        run_id: None,
        stage_key: None,
        stage_kinds: None,
        statuses: None,
        limit: None,
    }
}

/// Mirrors the real lifecycle: a stage is started from the prepared queued run,
/// and the run then transitions queued -> running before a result is completed.
fn start_running_stage(
    connection: &mut Connection,
    scope: &StageScopeFixture,
    stage_key: &str,
    stage_kind: &str,
) -> ChapterWorkflowStageRecord {
    let stage = start_stage(connection, stage_input(scope, stage_key, stage_kind))
        .expect("start chapter workflow stage");
    mark_run_running(connection, &scope.run_id);
    stage
}

fn mark_run_running(connection: &Connection, run_id: &str) {
    connection
        .execute(
            "UPDATE task_runs SET status = 'running', started_at = '2026-01-01T00:00:01Z'
             WHERE run_id = ?1",
            params![run_id],
        )
        .expect("mark run running");
}

fn stage_binding(stage: &ChapterWorkflowStageRecord) -> Value {
    json!({
        "schemaVersion": 1,
        "workflowId": stage.workflow_id,
        "stageKey": stage.stage_key,
        "inputHash": stage.input_hash,
        "planHash": stage.plan_hash,
    })
}

fn binding_block(binding: &Value) -> String {
    format!(
        "[CHAPTER_WORKFLOW_BINDING]\n{}\n[/CHAPTER_WORKFLOW_BINDING]",
        serde_json::to_string(binding).expect("serialize binding")
    )
}

fn provider_request_body(content: &str) -> String {
    json!({
        "model": "mock-v1",
        "messages": [
            { "role": "system", "content": "You write one chapter beat." },
            { "role": "user", "content": content },
        ],
        "temperature": 0.4,
        "maxTokens": 64,
    })
    .to_string()
}

/// Isolated SQLite/Mock fixture: legal AiTask -> Attempt -> Snapshot -> Artifact
/// chain with the stage binding present only in the decoded real request message.
#[allow(clippy::too_many_arguments)]
fn seed_mock_artifact(
    connection: &mut Connection,
    scope: &StageScopeFixture,
    operation: &str,
    body: String,
    metadata_binding: Option<&Value>,
    result: &str,
) -> String {
    let template = "Write the requested chapter beat.";
    let payload = metadata_binding
        .map(|binding| {
            json!({
                "chapterWorkflow": binding,
                "taskInput": { "chapterWorkflow": binding },
            })
        })
        .unwrap_or_else(|| json!({}));
    let task = ai_task_service::create_task(
        connection,
        CreateAiTaskInput {
            operation_id: format!("workflow-artifact-{operation}"),
            request_hash_version: Some(ai_fact_security::REQUEST_HASH_VERSION),
            request_hash: None,
            trace_id: Some(format!("trace-{operation}")),
            task_type: "chapter_generate".to_string(),
            novel_id: scope.novel_id.clone(),
            chapter_id: Some(scope.chapter_id.clone()),
            draft_id: None,
            scope_type: "chapter".to_string(),
            expected_artifact_type: "chapter_text".to_string(),
            expected_artifact_schema_version: 1,
            target_hint_json: Some(json!({ "purpose": "workflow-stage-test" })),
            input_snapshot: InputSnapshotInput {
                schema_version: 1,
                input_type: "compiled_provider_messages_v1".to_string(),
                payload_json: payload,
                body,
                source_draft_id: None,
                source_draft_version: None,
                base_content_hash: None,
            },
            context_snapshot: ContextSnapshotInput {
                schema_version: 1,
                source_manifest_json: json!([]),
                compiled_context: "Mock chapter context for the workflow stage.".to_string(),
                budget_json: json!({ "maxTokens": 64 }),
                compiler_version: "mock-workflow-test-v1".to_string(),
            },
            constraint_snapshot: ConstraintSnapshotInput {
                schema_version: 1,
                payload_json: json!({ "candidateOnly": true }),
                prompt_template_id: "chapter-workflow-test".to_string(),
                prompt_template_version: "1".to_string(),
                prompt_template_hash: large_text_repository::sha256(template),
                prompt_template_body: template.to_string(),
                provider_options_json: json!({
                    "providerId": "mock",
                    "model": "mock-v1",
                }),
            },
        },
    )
    .expect("create isolated mock AI task");
    let queued =
        ai_task_service::queue_attempt(connection, &task.task_id).expect("queue mock attempt");
    let request_id = format!("request-{operation}");
    ai_task_service::claim_attempt(
        connection,
        ClaimAiTaskAttemptInput {
            task_id: task.task_id.clone(),
            attempt_id: queued.attempt.attempt_id.clone(),
            provider_id: "mock".to_string(),
            model_id: "mock-v1".to_string(),
            provider_request_id: Some(request_id.clone()),
        },
    )
    .expect("claim mock attempt");
    ai_task_service::mark_provider_succeeded(
        connection,
        &task.task_id,
        &queued.attempt.attempt_id,
        json!({
            "provider": "mock",
            "model": "mock-v1",
            "providerRequestId": request_id,
            "responseHash": large_text_repository::sha256(result),
            "responseLength": result.chars().count(),
            "tokenInput": 1,
            "tokenOutput": 1,
            "tokenTotal": 2,
            "finishReason": "stop",
            "durationMs": 1,
        }),
    )
    .expect("mark mock provider succeeded");
    let bundle = artifact_service::create_artifact(
        connection,
        CreateResultArtifactInput {
            task_id: task.task_id,
            attempt_id: queued.attempt.attempt_id,
            artifact_type: "chapter_text".to_string(),
            schema_version: 1,
            raw_content: result.to_string(),
            display_content: None,
            structured_payload_json: None,
            parent_artifact_id: None,
            derivation_type: None,
        },
    )
    .expect("create mock artifact");
    assert!(matches!(
        bundle.artifact.processing_status.as_str(),
        "valid" | "valid_with_warnings"
    ));
    bundle.artifact.artifact_id
}

fn assert_stage_remains_running(connection: &Connection, stage: &ChapterWorkflowStageRecord) {
    let current = repo::find_stage(connection, &stage.stage_id)
        .expect("find stage")
        .expect("stage");
    assert_eq!(current.status, "running");
    assert_eq!(current.revision, stage.revision);
    assert!(current.result_hash.is_none());
    assert!(current.result_document_id.is_none());
    assert!(current.result_json.is_none());
    assert!(current.verified_artifact_id.is_none());
    let succeeded: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM chapter_workflow_stages
             WHERE stage_id = ?1 AND status = 'succeeded'",
            params![stage.stage_id],
            |row| row.get(0),
        )
        .expect("count succeeded stage rows");
    assert_eq!(succeeded, 0, "failed completion must have zero success");
}

fn verified_artifact_completion(
    stage: &ChapterWorkflowStageRecord,
    artifact_id: &str,
    result: &str,
) -> CompleteChapterWorkflowStageInput {
    CompleteChapterWorkflowStageInput {
        stage_id: stage.stage_id.clone(),
        expected_revision: stage.revision,
        expected_result_hash: hash(result),
        output: ChapterWorkflowStageOutput::VerifiedArtifact(artifact_id.to_string()),
    }
}

#[test]
fn stage_migration_creates_guards_and_rejects_direct_unsafe_rows() {
    let connection = connection();
    for name in [
        "chapter_workflow_stages",
        "trg_chapter_workflow_stages_validate_insert",
        "trg_chapter_workflow_stages_immutable_identity",
        "trg_chapter_workflow_stages_status_edges",
        "trg_chapter_workflow_stages_terminal_immutable",
        "trg_chapter_workflow_stages_revision_cas",
    ] {
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = ?1",
                params![name],
                |row| row.get(0),
            )
            .expect("read schema object");
        assert_eq!(count, 1, "missing schema object {name}");
    }
    let scope = seed_scope(&connection, "schema");
    let insert_error = connection
        .execute(
            "INSERT INTO chapter_workflow_stages (
                stage_id, workflow_id, conversation_id, novel_id, chapter_id, run_id,
                stage_key, stage_kind, plan_version, model_snapshot_hash, context_hash,
                base_hash, input_hash, plan_hash, attempt, status, revision, created_at, updated_at
             ) VALUES (
                'unsafe-stage', ?1, ?2, ?3, 'chapter-missing', ?4, 'beat_write', 'beat_write', 2,
                ?5, ?6, ?7, ?8, ?9, 1, 'pending', 1, 'now', 'now'
             )",
            params![
                scope.workflow_id,
                scope.conversation_id,
                scope.novel_id,
                scope.run_id,
                hash("model"),
                hash("context"),
                hash("base"),
                hash("input"),
                hash("plan"),
            ],
        )
        .expect_err("cross-scope direct insert must fail");
    assert!(insert_error
        .to_string()
        .contains("invalid chapter workflow stage scope"));
}

#[test]
fn start_uses_authoritative_run_snapshot_and_rejects_scope_swaps() {
    let mut connection = connection();
    let scope = seed_scope(&connection, "scope");
    let mut input = stage_input(&scope, "beat_write:scene-1:beat-1", "beat_write");
    let claimed = hash("not-the-run-snapshot");
    input.model_snapshot_hash = Some(claimed);
    let error = start_stage(&mut connection, input).expect_err("forged model hash must fail");
    assert_eq!(error.code, codes::CHAPTER_WORKFLOW_STAGE_INPUT_INVALID);

    let mut wrong_chapter = stage_input(&scope, "beat_write:scene-1:beat-1", "beat_write");
    wrong_chapter.chapter_id = "chapter-missing".to_string();
    let error = start_stage(&mut connection, wrong_chapter).expect_err("wrong chapter must fail");
    assert_eq!(error.code, codes::CHAPTER_WORKFLOW_STAGE_SCOPE_MISMATCH);

    let mut wrong_run = stage_input(&scope, "beat_write:scene-1:beat-1", "beat_write");
    wrong_run.run_id = "run-missing".to_string();
    let error = start_stage(&mut connection, wrong_run).expect_err("wrong run must fail");
    assert_eq!(error.code, codes::CHAPTER_WORKFLOW_STAGE_SCOPE_MISMATCH);

    let running = start_running_stage(
        &mut connection,
        &scope,
        "beat_write:scene-1:beat-1",
        "beat_write",
    );
    assert_eq!(running.status, "running");
    assert_eq!(running.revision, 2);
    assert_eq!(running.attempt, 1);
    assert_eq!(
        running.model_snapshot_hash,
        ai_fact_security::canonical_hash(
            &serde_json::json!({"providerId":"mock","modelId":"mock-v1"})
        )
        .expect("authoritative model hash")
    );
}

#[test]
fn revision_cas_terminal_immutability_and_one_success_per_stage_hold() {
    let mut connection = connection();
    let scope = seed_scope(&connection, "cas");
    let running = start_running_stage(
        &mut connection,
        &scope,
        "beat_write:scene-1:beat-1",
        "beat_write",
    );

    let mut stale = complete_large(&running, "第一条 Beat 正文。");
    stale.expected_revision = running.revision - 1;
    let error = complete_stage(&mut connection, stale).expect_err("stale revision must fail");
    assert_eq!(error.code, codes::CHAPTER_WORKFLOW_STAGE_CONFLICT);

    let succeeded = complete_stage(
        &mut connection,
        complete_large(&running, "第一条 Beat 正文。"),
    )
    .expect("complete stage");
    assert_eq!(succeeded.status, "succeeded");
    assert_eq!(succeeded.revision, running.revision + 1);
    assert!(succeeded.result_hash.is_some());
    assert!(succeeded.result_document_id.is_some());

    let late = complete_stage(&mut connection, complete_large(&succeeded, "迟到结果。"))
        .expect_err("terminal stage must reject late result");
    assert_eq!(late.code, codes::CHAPTER_WORKFLOW_STAGE_TERMINAL);

    let direct = connection.execute(
        "UPDATE chapter_workflow_stages SET revision = revision + 1 WHERE stage_id = ?1",
        params![succeeded.stage_id],
    );
    assert!(direct.is_err(), "terminal rows must be immutable");

    let second = start_stage(
        &mut connection,
        StartChapterWorkflowStageInput {
            attempt: Some(2),
            ..stage_input(&scope, "beat_write:scene-1:beat-1", "beat_write")
        },
    )
    .expect("second attempt starts");
    let duplicate_success = complete_stage(
        &mut connection,
        complete_large(&second, "第二条 Beat 正文。"),
    );
    assert_eq!(
        duplicate_success
            .expect_err("a workflow/stage pair can only have one successful attempt")
            .code,
        codes::CHAPTER_WORKFLOW_STAGE_CONFLICT
    );
    let success_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM chapter_workflow_stages
             WHERE workflow_id = ?1 AND stage_key = 'beat_write:scene-1:beat-1'
               AND status = 'succeeded'",
            params![scope.workflow_id],
            |row| row.get(0),
        )
        .expect("count successful stage");
    assert_eq!(success_count, 1);
}

#[test]
fn failed_attempt_can_be_retried_without_reusing_terminal_row() {
    let mut connection = connection();
    let scope = seed_scope(&connection, "retry");
    let first = start_running_stage(&mut connection, &scope, "beat_plan:scene-1", "beat_plan");
    let failed = fail_stage(
        &mut connection,
        FailChapterWorkflowStageInput {
            stage_id: first.stage_id.clone(),
            expected_revision: first.revision,
            error_code: "BEAT_PLAN_INVALID".to_string(),
        },
    )
    .expect("fail first attempt");
    assert_eq!(failed.status, "failed");
    assert_eq!(failed.error_code.as_deref(), Some("BEAT_PLAN_INVALID"));
    assert_eq!(
        fail_stage(
            &mut connection,
            FailChapterWorkflowStageInput {
                stage_id: first.stage_id,
                expected_revision: first.revision,
                error_code: "BEAT_PLAN_INVALID".to_string(),
            },
        )
        .expect_err("terminal failure cannot be rewritten")
        .code,
        codes::CHAPTER_WORKFLOW_STAGE_TERMINAL
    );

    let second = start_stage(
        &mut connection,
        StartChapterWorkflowStageInput {
            attempt: Some(2),
            ..stage_input(&scope, "beat_plan:scene-1", "beat_plan")
        },
    )
    .expect("start second attempt");
    assert_eq!(second.attempt, 2);
    let succeeded = complete_stage(
        &mut connection,
        complete_json(&second, r#"{"beats":[{"order":1,"text":"推进"}]}"#),
    )
    .expect("complete second attempt");
    assert_eq!(succeeded.status, "succeeded");
}

#[test]
fn cancellation_recovery_and_late_results_fail_closed() {
    let mut connection = connection();
    let scope = seed_scope(&connection, "cancel");
    let running = start_running_stage(
        &mut connection,
        &scope,
        "beat_write:scene-1:beat-1",
        "beat_write",
    );
    let cancelled = cancel_stage(
        &mut connection,
        CancelChapterWorkflowStageInput {
            stage_id: running.stage_id.clone(),
            expected_revision: None,
        },
    )
    .expect("cancel stage");
    assert_eq!(cancelled.status, "cancelled");
    let late = complete_stage(
        &mut connection,
        complete_large(&cancelled, "取消后的迟到正文。"),
    )
    .expect_err("late result after cancellation must fail");
    assert_eq!(late.code, codes::CHAPTER_WORKFLOW_STAGE_TERMINAL);

    let active = start_stage(
        &mut connection,
        stage_input(&scope, "beat_state:scene-1:beat-1", "beat_state"),
    )
    .expect("start active stage");
    let cancelled_by_run = cancel_active_stages_for_run(&mut connection, &scope.run_id)
        .expect("cancel active stages for run");
    assert_eq!(cancelled_by_run, 1);
    assert_eq!(
        repo::find_stage(&connection, &active.stage_id)
            .expect("find cancelled stage")
            .expect("stage")
            .status,
        "cancelled"
    );
    assert!(complete_stage(
        &mut connection,
        complete_json(&active, r#"{"actualStateChange":[]}"#),
    )
    .is_err());

    let interrupted = start_stage(
        &mut connection,
        stage_input(&scope, "scene_close:scene-1", "scene_close"),
    )
    .expect("start stage before restart");
    let recovered = recover_interrupted_stages(&mut connection).expect("recover running stages");
    assert_eq!(recovered, 1);
    let recovered_stage = repo::find_stage(&connection, &interrupted.stage_id)
        .expect("find recovered stage")
        .expect("stage");
    assert_eq!(recovered_stage.status, "failed");
    assert_eq!(
        recovered_stage.error_code.as_deref(),
        Some(repo::INTERRUPTED_ERROR_CODE)
    );
    assert_eq!(recovered_stage.revision, interrupted.revision + 1);
    assert!(recovered_stage.result_hash.is_none());
    assert_eq!(
        recover_interrupted_stages(&mut connection).expect("recovery is idempotent"),
        0
    );
    assert_eq!(
        complete_stage(
            &mut connection,
            complete_large(&recovered_stage, "重启后的迟到正文。"),
        )
        .expect_err("interrupted stage cannot accept late result")
        .code,
        codes::CHAPTER_WORKFLOW_STAGE_TERMINAL
    );
}

#[test]
fn large_text_results_are_verified_and_queries_stay_chapter_scoped() {
    let mut connection = connection();
    let scope = seed_scope(&connection, "result");
    let running = start_running_stage(
        &mut connection,
        &scope,
        "beat_write:scene-1:beat-1",
        "beat_write",
    );
    let prose = "雨落在城墙上，沈岚没有回头。".repeat(12);
    let succeeded =
        complete_stage(&mut connection, complete_large(&running, &prose)).expect("complete stage");
    let document_id = succeeded.result_document_id.expect("result document id");
    let verified =
        large_text_repository::read_verified_document(&connection, &document_id).expect("read doc");
    assert_eq!(verified.content, prose);
    assert_eq!(
        verified.content_hash,
        succeeded.result_hash.expect("result hash")
    );

    let rows = list_stages(&connection, list_input(&scope)).expect("list stages");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].stage_id, succeeded.stage_id);
    assert_eq!(rows[0].stage_kind, "beat_write");
    assert_eq!(rows[0].result_json, None);

    let mut filtered = list_input(&scope);
    filtered.statuses = Some(vec!["running".to_string()]);
    assert!(list_stages(&connection, filtered)
        .expect("filtered query")
        .is_empty());

    let mut other_chapter = list_input(&scope);
    other_chapter.chapter_id = "chapter-other".to_string();
    assert_eq!(
        list_stages(&connection, other_chapter)
            .expect_err("cross-chapter query must fail")
            .code,
        codes::CHAPTER_WORKFLOW_STAGE_SCOPE_MISMATCH
    );

    let hash_mismatch = CompleteChapterWorkflowStageInput {
        stage_id: succeeded.stage_id.clone(),
        expected_revision: succeeded.revision,
        expected_result_hash: hash("different"),
        output: ChapterWorkflowStageOutput::LargeText("different".to_string()),
    };
    assert_eq!(
        complete_stage(&mut connection, hash_mismatch)
            .expect_err("terminal stage remains terminal")
            .code,
        codes::CHAPTER_WORKFLOW_STAGE_TERMINAL
    );

    let second = start_stage(
        &mut connection,
        StartChapterWorkflowStageInput {
            attempt: Some(2),
            ..stage_input(&scope, "beat_state:scene-1:beat-1", "beat_state")
        },
    )
    .expect("start bounded json stage");
    let json = r#"{"actualStateChange":[],"endState":null,"unknowns":["未确认"],"semanticValidation":"not_checked"}"#;
    let bounded = complete_stage(&mut connection, complete_json(&second, json))
        .expect("complete bounded json");
    assert_eq!(bounded.result_json.as_deref(), Some(json));
    assert!(bounded.result_document_id.is_none());

    let oversized = format!("{{\"state\":\"{}\"}}", "x".repeat(17_000));
    let third = start_stage(
        &mut connection,
        StartChapterWorkflowStageInput {
            attempt: Some(3),
            ..stage_input(&scope, "beat_state:scene-1:beat-2", "beat_state")
        },
    )
    .expect("start oversized json stage");
    assert_eq!(
        complete_stage(&mut connection, complete_json(&third, &oversized))
            .expect_err("oversized JSON must fail")
            .code,
        codes::CHAPTER_WORKFLOW_STAGE_RESULT_INVALID
    );
}

#[test]
fn verified_artifact_entry_fails_closed_for_missing_artifact() {
    let mut connection = connection();
    let scope = seed_scope(&connection, "verified-missing");
    let stage = start_running_stage(
        &mut connection,
        &scope,
        "beat_write:scene-1:beat-1",
        "beat_write",
    );
    let missing = complete_stage(
        &mut connection,
        CompleteChapterWorkflowStageInput {
            stage_id: stage.stage_id.clone(),
            expected_revision: stage.revision,
            expected_result_hash: hash("missing artifact"),
            output: ChapterWorkflowStageOutput::VerifiedArtifact("artifact-missing".to_string()),
        },
    )
    .expect_err("missing artifact must fail closed");
    assert_eq!(missing.code, codes::ARTIFACT_NOT_FOUND);
    assert_stage_remains_running(&connection, &stage);
}

#[test]
fn verified_artifact_with_real_message_binding_completes_stage() {
    let mut connection = connection();
    let scope = seed_scope(&connection, "verified-positive");
    let stage = start_running_stage(
        &mut connection,
        &scope,
        "beat_write:scene-1:beat-1",
        "beat_write",
    );
    let binding = stage_binding(&stage);
    let prose = "雨停后，沈岚把灯留在桌上，等待下一声敲门。".repeat(4);
    let content = format!("写下一段 Beat 正文。\n{}", binding_block(&binding));
    // Metadata also carries the binding, but admission relies on the real message.
    let artifact_id = seed_mock_artifact(
        &mut connection,
        &scope,
        "positive",
        provider_request_body(&content),
        Some(&binding),
        &prose,
    );
    let completed = complete_stage(
        &mut connection,
        verified_artifact_completion(&stage, &artifact_id, &prose),
    )
    .expect("complete stage with verified artifact");
    assert_eq!(completed.status, "succeeded");
    assert_eq!(
        completed.verified_artifact_id.as_deref(),
        Some(artifact_id.as_str())
    );
    assert_eq!(
        completed.result_hash.as_deref(),
        Some(hash(&prose).as_str())
    );
    assert!(completed.result_document_id.is_none());
    assert!(completed.result_json.is_none());
    let success_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM chapter_workflow_stages
             WHERE stage_id = ?1 AND status = 'succeeded'",
            params![stage.stage_id],
            |row| row.get(0),
        )
        .expect("count successful stage");
    assert_eq!(success_count, 1);
}

#[test]
fn verified_artifact_metadata_only_escaped_and_wrong_bindings_fail_closed() {
    let mut connection = connection();
    let scope = seed_scope(&connection, "verified-negative");
    let stage = start_running_stage(
        &mut connection,
        &scope,
        "beat_write:scene-1:beat-1",
        "beat_write",
    );
    let binding = stage_binding(&stage);
    let prose = "这一段正文用于验证负例，不允许写入成功。";
    let mut wrong = binding.clone();
    wrong["stageKey"] = json!("beat_write:scene-1:beat-other");

    let metadata_only = seed_mock_artifact(
        &mut connection,
        &scope,
        "metadata-only",
        provider_request_body("正文没有任何绑定块。"),
        Some(&binding),
        prose,
    );
    let error = complete_stage(
        &mut connection,
        verified_artifact_completion(&stage, &metadata_only, prose),
    )
    .expect_err("metadata-only binding is not a real request proof");
    assert_eq!(error.code, codes::CHAPTER_WORKFLOW_STAGE_RESULT_INVALID);
    assert_stage_remains_running(&connection, &stage);

    // Escaped/double-encoded JSON must not be unescaped into an accepted binding.
    let escaped = serde_json::to_string(&format!("正文。\n{}", binding_block(&binding)))
        .expect("escape binding content");
    let escaped_artifact = seed_mock_artifact(
        &mut connection,
        &scope,
        "escaped-json",
        provider_request_body(&escaped),
        Some(&binding),
        prose,
    );
    let error = complete_stage(
        &mut connection,
        verified_artifact_completion(&stage, &escaped_artifact, prose),
    )
    .expect_err("escaped JSON marker must fail closed");
    assert_eq!(error.code, codes::CHAPTER_WORKFLOW_STAGE_RESULT_INVALID);
    assert_stage_remains_running(&connection, &stage);

    let wrong_artifact = seed_mock_artifact(
        &mut connection,
        &scope,
        "wrong-binding",
        provider_request_body(&format!("正文。\n{}", binding_block(&wrong))),
        Some(&binding),
        prose,
    );
    let error = complete_stage(
        &mut connection,
        verified_artifact_completion(&stage, &wrong_artifact, prose),
    )
    .expect_err("wrong binding must fail closed");
    assert_eq!(error.code, codes::CHAPTER_WORKFLOW_STAGE_RESULT_INVALID);
    assert_stage_remains_running(&connection, &stage);

    // A valid block may not mask a second, mismatched block in the same request.
    let mixed_body = json!({
        "model": "mock-v1",
        "messages": [
            {
                "role": "system",
                "content": format!("系统提示。\n{}", binding_block(&binding)),
            },
            {
                "role": "user",
                "content": format!("用户提示。\n{}", binding_block(&wrong)),
            },
        ],
    })
    .to_string();
    let mixed_artifact = seed_mock_artifact(
        &mut connection,
        &scope,
        "mixed-binding",
        mixed_body,
        Some(&binding),
        prose,
    );
    let error = complete_stage(
        &mut connection,
        verified_artifact_completion(&stage, &mixed_artifact, prose),
    )
    .expect_err("mixed bindings must fail closed");
    assert_eq!(error.code, codes::CHAPTER_WORKFLOW_STAGE_RESULT_INVALID);
    assert_stage_remains_running(&connection, &stage);

    let duplicate_content = format!("{}\n{}", binding_block(&binding), binding_block(&binding));
    let duplicate_artifact = seed_mock_artifact(
        &mut connection,
        &scope,
        "duplicate-binding",
        provider_request_body(&duplicate_content),
        Some(&binding),
        prose,
    );
    let error = complete_stage(
        &mut connection,
        verified_artifact_completion(&stage, &duplicate_artifact, prose),
    )
    .expect_err("duplicate marker blocks must fail closed");
    assert_eq!(error.code, codes::CHAPTER_WORKFLOW_STAGE_RESULT_INVALID);
    assert_stage_remains_running(&connection, &stage);
}

#[test]
fn queued_or_terminal_runs_block_stage_writes_but_convergence_still_works() {
    let mut connection = connection();

    // Completion is only allowed after the outer run really entered running.
    let queued_scope = seed_scope(&connection, "run-queued");
    let queued_stage = start_stage(
        &mut connection,
        stage_input(&queued_scope, "beat_write:scene-1:beat-1", "beat_write"),
    )
    .expect("start stage while run is queued");
    let error = complete_stage(
        &mut connection,
        complete_large(&queued_stage, "Run 尚未启动时的正文。"),
    )
    .expect_err("queued run cannot accept a completed stage");
    assert_eq!(error.code, codes::CHAPTER_WORKFLOW_STAGE_CONFLICT);
    assert_stage_remains_running(&connection, &queued_stage);
    mark_run_running(&connection, &queued_scope.run_id);
    let completed = complete_stage(
        &mut connection,
        complete_large(&queued_stage, "Run 启动后的正文。"),
    )
    .expect("running run completes stage");
    assert_eq!(completed.status, "succeeded");

    // Late completion after a failed run is rejected, but fail_stage converges.
    let failed_scope = seed_scope(&connection, "run-failed");
    let failed_stage = start_running_stage(
        &mut connection,
        &failed_scope,
        "beat_write:scene-1:beat-1",
        "beat_write",
    );
    connection
        .execute(
            "UPDATE task_runs SET status = 'failed' WHERE run_id = ?1",
            params![failed_scope.run_id],
        )
        .expect("fail run");
    let error = complete_stage(
        &mut connection,
        complete_large(&failed_stage, "Run 失败后的迟到正文。"),
    )
    .expect_err("failed run cannot accept a late result");
    assert_eq!(error.code, codes::CHAPTER_WORKFLOW_STAGE_CONFLICT);
    assert_stage_remains_running(&connection, &failed_stage);
    let converged = fail_stage(
        &mut connection,
        FailChapterWorkflowStageInput {
            stage_id: failed_stage.stage_id.clone(),
            expected_revision: failed_stage.revision,
            error_code: "RUN_FAILED".to_string(),
        },
    )
    .expect("failure path still converges a terminal run");
    assert_eq!(converged.status, "failed");

    // A cancel request also rejects completion; cancel_stage still converges.
    let cancel_scope = seed_scope(&connection, "run-cancel-requested");
    let cancel_stage_row = start_running_stage(
        &mut connection,
        &cancel_scope,
        "beat_write:scene-1:beat-1",
        "beat_write",
    );
    connection
        .execute(
            "UPDATE task_runs SET status = 'cancel_requested' WHERE run_id = ?1",
            params![cancel_scope.run_id],
        )
        .expect("request run cancellation");
    let error = complete_stage(
        &mut connection,
        complete_large(&cancel_stage_row, "取消请求后的迟到正文。"),
    )
    .expect_err("cancel_requested run cannot accept a late result");
    assert_eq!(error.code, codes::CHAPTER_WORKFLOW_STAGE_CONFLICT);
    let cancelled = cancel_stage(
        &mut connection,
        CancelChapterWorkflowStageInput {
            stage_id: cancel_stage_row.stage_id.clone(),
            expected_revision: None,
        },
    )
    .expect("cancel path still converges a terminal run");
    assert_eq!(cancelled.status, "cancelled");

    // Starting after a terminal run is rejected; a queued pending row cannot begin.
    let start_scope = seed_scope(&connection, "run-start-terminal");
    connection
        .execute(
            "UPDATE task_runs SET status = 'failed' WHERE run_id = ?1",
            params![start_scope.run_id],
        )
        .expect("fail run before start");
    assert_eq!(
        start_stage(
            &mut connection,
            stage_input(&start_scope, "beat_write:scene-1:beat-1", "beat_write"),
        )
        .expect_err("terminal run cannot start a stage")
        .code,
        codes::CHAPTER_WORKFLOW_STAGE_CONFLICT
    );

    let begin_scope = seed_scope(&connection, "run-begin-terminal");
    let pending = queue_stage(
        &mut connection,
        stage_input(&begin_scope, "beat_plan:scene-1", "beat_plan"),
    )
    .expect("queue pending stage while run is queued");
    assert_eq!(pending.status, "pending");
    connection
        .execute(
            "UPDATE task_runs SET status = 'failed' WHERE run_id = ?1",
            params![begin_scope.run_id],
        )
        .expect("fail run before begin");
    assert_eq!(
        begin_stage(&mut connection, &pending.stage_id, pending.revision)
            .expect_err("terminal run cannot begin a pending stage")
            .code,
        codes::CHAPTER_WORKFLOW_STAGE_CONFLICT
    );
}

#[test]
fn archived_conversation_and_deleted_targets_block_stage_writes() {
    let mut connection = connection();

    let archived_scope = seed_scope(&connection, "archived-complete");
    let archived_stage = start_running_stage(
        &mut connection,
        &archived_scope,
        "beat_write:scene-1:beat-1",
        "beat_write",
    );
    connection
        .execute(
            "UPDATE task_conversations
             SET archived_at = '2026-01-01T00:00:02Z', status = 'archived'
             WHERE conversation_id = ?1",
            params![archived_scope.conversation_id],
        )
        .expect("archive conversation");
    assert_eq!(
        complete_stage(
            &mut connection,
            complete_large(&archived_stage, "归档后的迟到正文。"),
        )
        .expect_err("archived conversation cannot accept a stage result")
        .code,
        codes::CHAPTER_WORKFLOW_STAGE_CONFLICT
    );
    assert_stage_remains_running(&connection, &archived_stage);

    let archived_start_scope = seed_scope(&connection, "archived-start");
    connection
        .execute(
            "UPDATE task_conversations
             SET archived_at = '2026-01-01T00:00:02Z', status = 'archived'
             WHERE conversation_id = ?1",
            params![archived_start_scope.conversation_id],
        )
        .expect("archive conversation before start");
    assert_eq!(
        start_stage(
            &mut connection,
            stage_input(
                &archived_start_scope,
                "beat_write:scene-1:beat-1",
                "beat_write",
            ),
        )
        .expect_err("archived conversation cannot start a stage")
        .code,
        codes::CHAPTER_WORKFLOW_STAGE_SCOPE_MISMATCH
    );

    let archived_begin_scope = seed_scope(&connection, "archived-begin");
    let pending = queue_stage(
        &mut connection,
        stage_input(&archived_begin_scope, "beat_plan:scene-1", "beat_plan"),
    )
    .expect("queue pending stage");
    connection
        .execute(
            "UPDATE task_conversations
             SET archived_at = '2026-01-01T00:00:02Z', status = 'archived'
             WHERE conversation_id = ?1",
            params![archived_begin_scope.conversation_id],
        )
        .expect("archive conversation before begin");
    assert_eq!(
        begin_stage(&mut connection, &pending.stage_id, pending.revision)
            .expect_err("archived conversation cannot begin a pending stage")
            .code,
        codes::CHAPTER_WORKFLOW_STAGE_CONFLICT
    );

    let deleted_chapter_scope = seed_scope(&connection, "deleted-chapter");
    let deleted_chapter_stage = start_running_stage(
        &mut connection,
        &deleted_chapter_scope,
        "beat_write:scene-1:beat-1",
        "beat_write",
    );
    connection
        .execute(
            "UPDATE chapters SET deleted_at = '2026-01-01T00:00:02Z' WHERE id = ?1",
            params![deleted_chapter_scope.chapter_id],
        )
        .expect("soft delete chapter");
    assert_eq!(
        complete_stage(
            &mut connection,
            complete_large(&deleted_chapter_stage, "删除章节后的迟到正文。"),
        )
        .expect_err("deleted chapter cannot accept a stage result")
        .code,
        codes::CHAPTER_WORKFLOW_STAGE_CONFLICT
    );

    let deleted_novel_scope = seed_scope(&connection, "deleted-novel");
    let deleted_novel_stage = start_running_stage(
        &mut connection,
        &deleted_novel_scope,
        "beat_write:scene-1:beat-1",
        "beat_write",
    );
    connection
        .execute(
            "UPDATE novels SET deleted_at = '2026-01-01T00:00:02Z' WHERE id = ?1",
            params![deleted_novel_scope.novel_id],
        )
        .expect("soft delete novel");
    assert_eq!(
        complete_stage(
            &mut connection,
            complete_large(&deleted_novel_stage, "删除作品后的迟到正文。"),
        )
        .expect_err("deleted novel cannot accept a stage result")
        .code,
        codes::CHAPTER_WORKFLOW_STAGE_CONFLICT
    );
}

#[test]
fn backup_schema_twelve_round_trips_stage_and_result_document() {
    let mut source = connection();
    let scope = seed_scope(&source, "backup");
    let running = start_running_stage(
        &mut source,
        &scope,
        "beat_write:scene-1:beat-1",
        "beat_write",
    );
    let prose = "备份中的 Beat 正文。".repeat(30);
    let succeeded =
        complete_stage(&mut source, complete_large(&running, &prose)).expect("complete stage");
    let backup = crate::project_backup::export_project_backup_in_conn(&source, &scope.novel_id)
        .expect("export project backup");
    assert_eq!(backup.schema_version, 12);
    assert_eq!(backup.tables["chapter_workflow_stages"].len(), 1);

    let mut target = connection();
    let restored = crate::project_backup::restore_project_backup_in_conn(&mut target, &backup)
        .expect("restore project backup");
    assert_eq!(restored.restored_records["chapter_workflow_stages"], 1);
    let restored_novel = restored.novel_id.clone();
    let restored_chapter = restored.id_map[&scope.chapter_id].clone();
    let restored_stage_id = restored.id_map[&succeeded.stage_id].clone();
    let rows = list_stages(
        &target,
        ListChapterWorkflowStagesInput {
            novel_id: restored_novel,
            chapter_id: restored_chapter,
            conversation_id: None,
            workflow_id: None,
            run_id: None,
            stage_key: None,
            stage_kinds: None,
            statuses: None,
            limit: None,
        },
    )
    .expect("list restored stages");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].stage_id, restored_stage_id);
    assert_eq!(rows[0].status, "succeeded");
    let restored_document_id = rows[0]
        .result_document_id
        .as_deref()
        .expect("restored document id");
    assert_ne!(
        restored_document_id,
        succeeded.result_document_id.as_deref().unwrap_or_default()
    );
    let verified = large_text_repository::read_verified_document(&target, restored_document_id)
        .expect("read restored result");
    assert_eq!(verified.content, prose);
    assert_eq!(
        rows[0].result_hash.as_deref(),
        Some(verified.content_hash.as_str())
    );
}

#[test]
fn project_purge_removes_stage_and_its_result_document_before_workbench_fks() {
    let mut connection = connection();
    let scope = seed_scope(&connection, "purge");
    let running = start_running_stage(
        &mut connection,
        &scope,
        "beat_write:scene-1:beat-1",
        "beat_write",
    );
    let succeeded = complete_stage(
        &mut connection,
        complete_large(&running, "待清理的阶段正文。"),
    )
    .expect("complete stage");
    let document_id = succeeded
        .result_document_id
        .clone()
        .expect("result document id");
    let transaction = connection.transaction().expect("purge transaction");
    crate::project_backup::purge_project_in_tx(&transaction, &scope.novel_id)
        .expect("purge project with workflow stage");
    transaction.commit().expect("commit purge");
    let stage_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM chapter_workflow_stages WHERE novel_id = ?1",
            params![scope.novel_id],
            |row| row.get(0),
        )
        .expect("count purged stages");
    assert_eq!(stage_count, 0);
    let document_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM large_text_documents WHERE id = ?1",
            params![document_id],
            |row| row.get(0),
        )
        .expect("count purged document");
    assert_eq!(document_count, 0);
    let novel_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM novels WHERE id = ?1",
            params![scope.novel_id],
            |row| row.get(0),
        )
        .expect("count purged novel");
    assert_eq!(novel_count, 0);
}

#[test]
fn shared_chapter_writing_stage_protocol_matches_native_marker_contract() {
    let contract: Value = serde_json::from_str(include_str!(
        "../../../contracts/chapter-writing-stage/v1.json"
    ))
    .expect("parse shared chapter writing stage protocol");
    assert_eq!(
        contract["contractVersion"].as_str(),
        Some("chapter_workflow_binding_v1")
    );
    assert_eq!(
        contract["bindingVersion"].as_i64(),
        Some(super::contract::WORKFLOW_BINDING_VERSION)
    );
    assert_eq!(
        contract["startMarker"].as_str(),
        Some(super::contract::BINDING_OPEN_MARKER)
    );
    assert_eq!(
        contract["endMarker"].as_str(),
        Some(super::contract::BINDING_CLOSE_MARKER)
    );
    assert_eq!(
        contract["maxIdentityUtf8Bytes"].as_u64(),
        Some(super::contract::MAX_IDENTITY_UTF8_BYTES as u64)
    );
    let schema = &contract["bindingSchema"];
    assert_eq!(schema["type"].as_str(), Some("object"));
    assert_eq!(schema["additionalProperties"].as_bool(), Some(false));
    let properties = schema["properties"]
        .as_object()
        .expect("binding schema properties object");
    let mut required = schema["required"]
        .as_array()
        .expect("binding schema required array")
        .iter()
        .map(|field| field.as_str().expect("required field name"))
        .collect::<Vec<_>>();
    required.sort_unstable();
    assert_eq!(
        required,
        vec![
            "inputHash",
            "planHash",
            "schemaVersion",
            "stageKey",
            "workflowId"
        ]
    );
    assert_eq!(properties.len(), 5);
    for field in &required {
        assert!(properties.contains_key(*field), "missing property {field}");
    }
    assert_eq!(
        properties["schemaVersion"]["const"].as_i64(),
        Some(super::contract::WORKFLOW_BINDING_VERSION)
    );
    assert_eq!(
        contract["authority"]["metadataAloneIsEvidence"].as_bool(),
        Some(false)
    );
    assert_eq!(
        contract["authority"]["mustAppearInActualRequestMessages"].as_bool(),
        Some(true)
    );
    assert_eq!(
        contract["authority"]["formalWrites"].as_str(),
        Some("forbidden")
    );
    assert_eq!(
        contract["authority"]["isAdoptionAuthorization"].as_bool(),
        Some(false)
    );
}
