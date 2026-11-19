use super::*;
use crate::services::ai_task_service::{
    self, tests::connection, tests::system_task_input, ClaimAiTaskAttemptInput,
};
use rusqlite::params;

fn validating_task(
    connection: &mut Connection,
    operation_id: &str,
    artifact_type: &str,
    raw: &str,
) -> Result<(String, String), Box<dyn std::error::Error>> {
    let task =
        ai_task_service::create_task(connection, system_task_input(operation_id, artifact_type))?;
    let queued = ai_task_service::queue_attempt(connection, &task.task_id)?;
    ai_task_service::claim_attempt(
        connection,
        ClaimAiTaskAttemptInput {
            task_id: task.task_id.clone(),
            attempt_id: queued.attempt.attempt_id.clone(),
            provider_id: "mock".to_string(),
            model_id: "mock-v1".to_string(),
            provider_request_id: Some(format!("request-{operation_id}")),
        },
    )?;
    ai_task_service::mark_provider_succeeded(
        connection,
        &task.task_id,
        &queued.attempt.attempt_id,
        serde_json::json!({
            "provider": "mock",
            "model": "mock-v1",
            "providerRequestId": format!("request-{operation_id}"),
            "responseHash": large_text_repository::sha256(raw),
            "responseLength": raw.chars().count(),
            "tokenInput": 1,
            "tokenOutput": 1,
            "tokenTotal": 2,
            "finishReason": "stop",
            "durationMs": 1
        }),
    )?;
    Ok((task.task_id, queued.attempt.attempt_id))
}

fn artifact_input(
    task_id: String,
    attempt_id: String,
    artifact_type: &str,
    raw: &str,
) -> CreateResultArtifactInput {
    CreateResultArtifactInput {
        task_id,
        attempt_id,
        artifact_type: artifact_type.to_string(),
        schema_version: 1,
        raw_content: raw.to_string(),
        display_content: None,
        structured_payload_json: None,
        parent_artifact_id: None,
        derivation_type: None,
    }
}

#[test]
fn art01_valid_artifact_completes_task_and_round_trips_all_content(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = connection()?;
    let raw = r#"{"ok":true,"targetId":"provider-hint"}"#;
    let (task_id, attempt_id) =
        validating_task(&mut connection, "artifact-valid", "generic_json", raw)?;
    let bundle = create_artifact(
        &mut connection,
        artifact_input(task_id.clone(), attempt_id.clone(), "generic_json", raw),
    )?;
    assert_eq!(bundle.artifact.processing_status, "valid_with_warnings");
    assert_eq!(bundle.raw_content, raw);
    assert_eq!(
        bundle.structured_payload_json,
        Some(serde_json::from_str(raw)?)
    );
    assert_eq!(bundle.issues.len(), 1);
    let task = ai_task_repository::find_task(&connection, &task_id)?.unwrap();
    assert_eq!(task.status, "completed");
    assert_eq!(
        task.result_artifact_id.as_deref(),
        Some(bundle.artifact.artifact_id.as_str())
    );
    assert_eq!(list_task_artifacts(&connection, &task_id)?.len(), 1);
    let replay = create_artifact(
        &mut connection,
        artifact_input(task_id.clone(), attempt_id.clone(), "generic_json", raw),
    )?;
    assert_eq!(replay.artifact.artifact_id, bundle.artifact.artifact_id);
    let mut changed_replay =
        artifact_input(task_id.clone(), attempt_id.clone(), "generic_json", raw);
    changed_replay.display_content = Some("different display".to_string());
    let conflict = create_artifact(&mut connection, changed_replay)
        .expect_err("changed artifact replay must conflict");
    assert_eq!(conflict.code, codes::OPERATION_PAYLOAD_CONFLICT);
    let provider_replay = ai_task_service::mark_provider_succeeded(
        &mut connection,
        &task_id,
        &attempt_id,
        serde_json::json!({
            "provider": "mock",
            "model": "mock-v1",
            "providerRequestId": "request-artifact-valid",
            "responseHash": large_text_repository::sha256(raw),
            "responseLength": raw.chars().count(),
            "tokenInput": 1,
            "tokenOutput": 1,
            "tokenTotal": 2,
            "finishReason": "stop",
            "durationMs": 1
        }),
    )?;
    assert_eq!(provider_replay.task.status, "completed");
    Ok(())
}

#[test]
fn art02_malformed_and_large_responses_keep_complete_verified_raw_body(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = connection()?;
    let malformed = "sensitive novel body ".repeat(8_000);
    let (task_id, attempt_id) = validating_task(
        &mut connection,
        "artifact-malformed",
        "generic_json",
        &malformed,
    )?;
    let invalid = create_artifact(
        &mut connection,
        artifact_input(task_id.clone(), attempt_id, "generic_json", &malformed),
    )?;
    assert_eq!(invalid.artifact.processing_status, "invalid");
    assert_eq!(invalid.raw_content, malformed);
    assert!(invalid
        .issues
        .iter()
        .any(|item| item.code == codes::ARTIFACT_PARSE_FAILED));
    assert!(invalid
        .issues
        .iter()
        .all(|item| !item.message.contains("sensitive novel body")));
    assert_eq!(
        ai_task_repository::find_task(&connection, &task_id)?
            .unwrap()
            .status,
        "failed"
    );

    let large = serde_json::json!({"body": "长正文".repeat(60_000)}).to_string();
    let (large_task, large_attempt) =
        validating_task(&mut connection, "artifact-large", "generic_json", &large)?;
    let valid = create_artifact(
        &mut connection,
        artifact_input(large_task, large_attempt, "generic_json", &large),
    )?;
    assert_eq!(valid.artifact.processing_status, "valid");
    assert_eq!(valid.raw_content, large);
    assert_eq!(
        valid.artifact.content_hash,
        large_text_repository::sha256(&large)
    );
    Ok(())
}

#[test]
fn art03_cross_attempt_unknown_contract_and_raw_mismatch_leave_no_documents(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = connection()?;
    let raw_a = r#"{"a":1}"#;
    let raw_b = r#"{"b":2}"#;
    let (task_a, attempt_a) =
        validating_task(&mut connection, "artifact-cross-a", "generic_json", raw_a)?;
    let (_task_b, attempt_b) =
        validating_task(&mut connection, "artifact-cross-b", "generic_json", raw_b)?;
    let before: i64 = connection.query_row(
        "SELECT COUNT(*) FROM large_text_documents WHERE target_type='result_artifact'",
        [],
        |row| row.get(0),
    )?;
    let cross = create_artifact(
        &mut connection,
        artifact_input(task_a.clone(), attempt_b, "generic_json", raw_a),
    )
    .expect_err("cross-task attempt must fail");
    assert_eq!(cross.code, codes::AI_ATTEMPT_NOT_FOUND);
    let unknown = create_artifact(
        &mut connection,
        artifact_input(task_a.clone(), attempt_a.clone(), "future_unknown", raw_a),
    )
    .expect_err("unknown artifact contract must fail");
    assert_eq!(unknown.code, codes::ARTIFACT_TYPE_UNSUPPORTED);
    let mismatch = create_artifact(
        &mut connection,
        artifact_input(task_a, attempt_a, "generic_json", r#"{"forged":true}"#),
    )
    .expect_err("raw response identity mismatch must fail");
    assert_eq!(mismatch.code, codes::ARTIFACT_SOURCE_MISMATCH);
    let after: i64 = connection.query_row(
        "SELECT COUNT(*) FROM large_text_documents WHERE target_type='result_artifact'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(after, before);
    Ok(())
}

#[test]
fn art04_snapshots_artifacts_issues_and_referenced_large_text_are_immutable(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = connection()?;
    let raw = "not-json";
    let (task_id, attempt_id) =
        validating_task(&mut connection, "artifact-immutable", "generic_json", raw)?;
    let bundle = create_artifact(
        &mut connection,
        artifact_input(task_id.clone(), attempt_id, "generic_json", raw),
    )?;
    assert!(!bundle.issues.is_empty());
    assert!(connection
        .execute(
            "UPDATE ai_input_snapshots SET payload_json='{}' WHERE task_id=?1",
            params![task_id],
        )
        .is_err());
    assert!(connection
        .execute(
            "DELETE FROM ai_context_snapshots WHERE task_id=?1",
            params![task_id],
        )
        .is_err());
    assert!(connection
        .execute(
            "UPDATE result_artifacts SET content_length=0 WHERE artifact_id=?1",
            params![bundle.artifact.artifact_id],
        )
        .is_err());
    assert!(connection
        .execute(
            "DELETE FROM result_artifacts WHERE artifact_id=?1",
            params![bundle.artifact.artifact_id],
        )
        .is_err());
    assert!(connection
        .execute(
            "UPDATE artifact_validation_issues SET message='changed' WHERE artifact_id=?1",
            params![bundle.artifact.artifact_id],
        )
        .is_err());
    assert!(connection
        .execute(
            "DELETE FROM artifact_validation_issues WHERE artifact_id=?1",
            params![bundle.artifact.artifact_id],
        )
        .is_err());
    assert!(connection
        .execute(
            "UPDATE large_text_documents SET title='changed' WHERE id=?1",
            params![bundle.artifact.raw_content_ref_id],
        )
        .is_err());
    assert!(connection
        .execute(
            "UPDATE large_text_chunks SET content='changed' WHERE document_id=?1 AND chunk_index=0",
            params![bundle.artifact.raw_content_ref_id],
        )
        .is_err());
    assert!(connection
        .execute(
            "INSERT INTO large_text_chunks
                (document_id,chunk_index,content,char_count,byte_count,chunk_sha256,created_at)
             VALUES (?1,999,'x',1,1,'hash','now')",
            params![bundle.artifact.raw_content_ref_id],
        )
        .is_err());
    Ok(())
}

#[test]
fn art05_file_database_restart_reads_task_attempt_snapshots_artifact_and_issues(
) -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::temp_dir().join(format!(
        "ai-novel-studio-m1-restart-{}.db",
        uuid::Uuid::new_v4()
    ));
    let (task_id, artifact_id) = {
        let mut connection = Connection::open(&path)?;
        connection.execute_batch("PRAGMA foreign_keys=ON;")?;
        crate::db::create_tables(&mut connection)?;
        let raw = r#"{"ok":true,"targetId":"hint"}"#;
        let (task_id, attempt_id) =
            validating_task(&mut connection, "artifact-restart", "generic_json", raw)?;
        let bundle = create_artifact(
            &mut connection,
            artifact_input(task_id.clone(), attempt_id, "generic_json", raw),
        )?;
        (task_id, bundle.artifact.artifact_id)
    };
    {
        let mut reopened = Connection::open(&path)?;
        reopened.execute_batch("PRAGMA foreign_keys=ON;")?;
        crate::db::create_tables(&mut reopened)?;
        let detail = ai_task_service::get_task_detail(&reopened, &task_id)?;
        assert_eq!(detail.task.status, "completed");
        assert_eq!(detail.attempts.len(), 1);
        assert!(!detail.context_snapshot.compiled_context.is_empty());
        let artifact = get_artifact_bundle(&reopened, &artifact_id)?;
        assert_eq!(artifact.artifact.task_id, task_id);
        assert_eq!(artifact.issues.len(), 1);
        assert!(artifact.structured_payload_json.is_some());
    }
    std::fs::remove_file(path)?;
    Ok(())
}

#[test]
fn art06_response_metadata_whitelist_rejects_raw_body_without_state_change(
) -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = connection()?;
    let task = ai_task_service::create_task(
        &mut connection,
        system_task_input("metadata-whitelist", "generic_json"),
    )?;
    let queued = ai_task_service::queue_attempt(&mut connection, &task.task_id)?;
    ai_task_service::claim_attempt(
        &mut connection,
        ClaimAiTaskAttemptInput {
            task_id: task.task_id.clone(),
            attempt_id: queued.attempt.attempt_id.clone(),
            provider_id: "mock".to_string(),
            model_id: "mock-v1".to_string(),
            provider_request_id: None,
        },
    )?;
    let raw = r#"{"ok":true}"#;
    let error = ai_task_service::mark_provider_succeeded(
        &mut connection,
        &task.task_id,
        &queued.attempt.attempt_id,
        serde_json::json!({
            "responseHash": large_text_repository::sha256(raw),
            "responseLength": raw.chars().count(),
            "rawBody": raw
        }),
    )
    .expect_err("raw response body metadata must fail");
    assert_eq!(error.code, codes::AI_RESPONSE_METADATA_INVALID);
    let persisted = ai_task_repository::find_task(&connection, &task.task_id)?.unwrap();
    assert_eq!(persisted.status, "running");
    Ok(())
}

#[test]
fn art07_retry_keeps_prior_invalid_artifact_readable() -> Result<(), Box<dyn std::error::Error>> {
    let mut connection = connection()?;
    let invalid_raw = "not-json";
    let (task_id, first_attempt) = validating_task(
        &mut connection,
        "artifact-history",
        "generic_json",
        invalid_raw,
    )?;
    let invalid = create_artifact(
        &mut connection,
        artifact_input(task_id.clone(), first_attempt, "generic_json", invalid_raw),
    )?;
    let queued = ai_task_service::queue_attempt(&mut connection, &task_id)?;
    ai_task_service::claim_attempt(
        &mut connection,
        ClaimAiTaskAttemptInput {
            task_id: task_id.clone(),
            attempt_id: queued.attempt.attempt_id.clone(),
            provider_id: "mock".to_string(),
            model_id: "mock-v1".to_string(),
            provider_request_id: Some("request-history-retry".to_string()),
        },
    )?;
    let valid_raw = r#"{"ok":true}"#;
    ai_task_service::mark_provider_succeeded(
        &mut connection,
        &task_id,
        &queued.attempt.attempt_id,
        serde_json::json!({
            "provider": "mock",
            "model": "mock-v1",
            "providerRequestId": "request-history-retry",
            "responseHash": large_text_repository::sha256(valid_raw),
            "responseLength": valid_raw.chars().count()
        }),
    )?;
    let valid = create_artifact(
        &mut connection,
        artifact_input(
            task_id.clone(),
            queued.attempt.attempt_id,
            "generic_json",
            valid_raw,
        ),
    )?;
    assert_eq!(
        get_artifact_bundle(&connection, &invalid.artifact.artifact_id)?.raw_content,
        invalid_raw
    );
    assert_eq!(
        get_artifact_bundle(&connection, &valid.artifact.artifact_id)?.raw_content,
        valid_raw
    );
    assert_eq!(list_task_artifacts(&connection, &task_id)?.len(), 2);
    Ok(())
}
