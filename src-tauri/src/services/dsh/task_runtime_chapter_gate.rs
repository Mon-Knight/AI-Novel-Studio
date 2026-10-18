//! Chapter candidate host gate. Issue codes are a finite checklist, not a semantic
//! proof. Only `admit` may project an artifact, and it never calls the provider.
use super::chapter_recovery::{CHAPTER_CALL_BUDGET_EXHAUSTED, CHAPTER_WALL_BUDGET_EXHAUSTED};
use super::{
    create_artifact_projection, is_chapter_writing_turn, notify_projection, now,
    read_generated_chapter_result, validate_turn_execution_contract, ModelToolAttestation,
    StartTaskTurnInput, TaskProjectionObserver, TaskRuntimeResult,
};
use crate::repositories::large_text_repository;
use crate::services::conversation_service::{self, UpdateRunInput};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

pub(crate) const WITHHELD_ERROR: &str = "DSH_CHAPTER_CANDIDATE_WITHHELD: 候选已通过字数门禁但尚未准入，不是成功结果，也没有可用候选卡";
const HOST_CALLS: usize = 3;
fn issue_severity(code: &str) -> Option<&'static str> {
    Some(match code {
        "chapter_opening_rollback" | "chapter_boundary_sentence_repetition" | "chapter_tail_pollution"
        | "chapter_meta_reasoning_leakage" | "chapter_authorial_label_leakage" => "error",
        "chapter_boundary_action_replay" | "chapter_source_chain_break"
        | "chapter_dialogue_reference_conflict" | "chapter_temporal_semantics_conflict"
        | "chapter_audit_voice_leakage" => "warning",
        _ => return None,
    })
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContinuityClaim {
    pub previous_chapter_id: String,
    pub source_hash: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterHostGate {
    pub phase: String,
    #[serde(default)]
    pub source_run_id: Option<String>,
    #[serde(default)]
    pub content_hash: Option<String>,
    #[serde(default)]
    pub issue_codes: Vec<String>,
    #[serde(default)]
    pub issue_severities: Vec<String>,
    #[serde(default)]
    pub max_integrity_repairs: Option<u32>,
    /// Prior draft in the same epoch. Omitting it must not open a new budget.
    #[serde(default)]
    pub continues_run_id: Option<String>,
    /// Explicit user retry. Not a remaining-count; the host assigns the epoch.
    #[serde(default)]
    pub explicit_retry: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingChapterCandidate {
    pub run_id: String,
    pub content_hash: String,
    pub text: String,
    pub word_count: i64,
    pub previous_chapter_text: Option<String>,
    pub previous_chapter_id: Option<String>,
    pub previous_source_hash: Option<String>,
}

#[derive(Debug)]
pub(crate) struct DraftBudget {
    pub remaining: Duration,
    pub calls: usize,
    pub length_repairs: usize,
}

pub(crate) fn is_gated_draft(input: &StartTaskTurnInput) -> bool {
    input.chapter_host_gate.as_ref().is_some_and(|gate| gate.phase == "draft")
}

pub(crate) fn is_admit(input: &StartTaskTurnInput) -> bool {
    input.chapter_host_gate.as_ref().is_some_and(|gate| gate.phase == "admit")
}

pub(crate) fn withholds_artifact(input: &StartTaskTurnInput) -> bool {
    is_chapter_writing_turn(input) && !is_admit(input)
}

pub(crate) fn validate_host_gate(input: &StartTaskTurnInput) -> Result<(), String> {
    if !is_chapter_writing_turn(input) {
        if input.continuity_claim.is_some() || input.chapter_host_gate.is_some() {
            return Err("DSH_TASK_CONTRACT_INVALID: 只有章节写作可以声明前章或候选准入".to_string());
        }
        return Ok(());
    }
    let Some(gate) = input.chapter_host_gate.as_ref() else {
        return Err(
            "DSH_CHAPTER_HOST_GATE_REQUIRED: 章节写作必须先草稿再准入，不能直接生成候选卡".to_string(),
        );
    };
    if gate.phase != "draft" && gate.phase != "admit" {
        return Err("DSH_CHAPTER_GATE_PHASE_INVALID".to_string());
    }
    if gate.max_integrity_repairs.is_some_and(|value| value > 2) {
        return Err("DSH_CHAPTER_INTEGRITY_BUDGET_INVALID".to_string());
    }
    validate_issue_list(gate)?;
    if gate.phase == "admit"
        && (gate.source_run_id.as_deref().unwrap_or("").trim().is_empty()
            || !super::chapter_continuity::is_sha256(gate.content_hash.as_deref().unwrap_or("")))
    {
        return Err("DSH_CHAPTER_ADMISSION_IDENTITY_REQUIRED".to_string());
    }
    Ok(())
}

fn validate_issue_list(gate: &ChapterHostGate) -> Result<(), String> {
    if gate.issue_codes.len() != gate.issue_severities.len() {
        return Err("DSH_CHAPTER_INTEGRITY_ISSUES_INVALID".to_string());
    }
    for (code, severity) in gate.issue_codes.iter().zip(&gate.issue_severities) {
        if issue_severity(code) != Some(severity.as_str()) {
            return Err(format!("DSH_CHAPTER_INTEGRITY_ISSUES_INVALID: {code}"));
        }
    }
    Ok(())
}

pub(crate) fn repair_prompt(input: &StartTaskTurnInput) -> String {
    let Some(gate) = input.chapter_host_gate.as_ref().filter(|gate| gate.phase == "draft") else {
        return String::new();
    };
    let codes: Vec<&str> = gate
        .issue_codes
        .iter()
        .zip(&gate.issue_severities)
        .filter(|(_, severity)| severity.as_str() == "error")
        .map(|(code, _)| code.as_str())
        .collect();
    if codes.is_empty() {
        return String::new();
    }
    format!(
        "\n\n章节完整性有界修复：宿主有限文本检查发现 {}。这不是语义证明，模型不得自行宣称准入或写入正式正文。请重写整章完整正文并消除这些问题，保持原字数区间、冻结模型、章节和工具范围。",
        codes.join(", ")
    )
}

pub(crate) fn pending_candidate(
    input: &StartTaskTurnInput,
    run_id: &str,
    text: &str,
) -> PendingChapterCandidate {
    PendingChapterCandidate {
        run_id: run_id.to_string(),
        content_hash: large_text_repository::sha256(text),
        text: text.to_string(),
        word_count: crate::services::draft_service::word_count(text),
        previous_chapter_text: input.verified_continuity.as_ref().map(|item| item.content.clone()),
        previous_chapter_id: input.verified_continuity.as_ref().map(|item| item.chapter_id.clone()),
        previous_source_hash: input
            .verified_continuity
            .as_ref()
            .map(|item| item.source_hash.clone()),
    }
}

pub(crate) fn capped_output_tokens(input: &StartTaskTurnInput) -> u64 {
    let frozen = input
        .model_snapshot
        .pointer("/options/maxTokens")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .unwrap_or(8000);
    let Some(range) = input.chapter_word_range.as_ref() else {
        return frozen;
    };
    let maximum = u64::try_from(range.maximum.max(0)).unwrap_or(0);
    let estimate = maximum.saturating_mul(169).saturating_add(99) / 100;
    estimate.clamp(1000, 32_000).min(frozen)
}

pub(crate) fn enforce_draft_budget(usage: &DraftBudget) -> Result<(), String> {
    if usage.calls >= HOST_CALLS {
        return Err(CHAPTER_CALL_BUDGET_EXHAUSTED.to_string());
    }
    if usage.remaining.is_zero() {
        return Err(CHAPTER_WALL_BUDGET_EXHAUSTED.to_string());
    }
    Ok(())
}

pub(crate) fn turn_usage(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
) -> Result<DraftBudget, String> {
    super::chapter_budget::usage(connection, input)
}

pub(crate) fn fail_abandoned_withheld(
    connection: &mut rusqlite::Connection,
    conversation_id: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare("SELECT run_id, error FROM task_runs WHERE conversation_id=?1 AND status='running'")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![conversation_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    drop(statement);
    let finished_at = now();
    for (run_id, error) in rows {
        if !error.as_deref().unwrap_or("").starts_with("DSH_CHAPTER_CANDIDATE_WITHHELD") {
            continue;
        }
        conversation_service::update_run(
            connection,
            UpdateRunInput {
                run_id,
                status: "failed".to_string(),
                error,
                updated_at: finished_at.clone(),
                started_at: None,
                finished_at: Some(finished_at.clone()),
            },
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn admit(
    input: StartTaskTurnInput,
    notifier: Option<TaskProjectionObserver>,
) -> Result<TaskRuntimeResult, String> {
    if active_worker(&input.conversation_id)? {
        return Err("当前任务已有活动运行".to_string());
    }
    let mut connection = crate::db::get_connection()
        .lock()
        .map_err(|_| "数据库锁失败".to_string())?;
    admit_connection(&mut connection, input, notifier)
}

pub(crate) fn admit_connection(
    connection: &mut rusqlite::Connection,
    mut input: StartTaskTurnInput,
    notifier: Option<TaskProjectionObserver>,
) -> Result<TaskRuntimeResult, String> {
    let gate = input
        .chapter_host_gate
        .clone()
        .ok_or_else(|| "DSH_CHAPTER_ADMISSION_IDENTITY_REQUIRED".to_string())?;
    if gate.issue_severities.iter().any(|severity| severity == "error") {
        return Err(
            "DSH_CHAPTER_INTEGRITY_ERROR_WITHHELD: 宿主有限文本检查发现 error，候选不可用；这不是语义证明"
                .to_string(),
        );
    }
    super::chapter_continuity::freeze_continuity(connection, &mut input)?;
    super::chapter_continuity::revalidate_now(connection, &input)?;
    let run_id = gate.source_run_id.clone().unwrap_or_default();
    let expected_hash = gate
        .content_hash
        .as_deref()
        .unwrap_or("")
        .to_ascii_lowercase();
    let run = crate::repositories::conversation_repository::get_run(connection, &run_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "DSH_CHAPTER_ADMISSION_RUN_NOT_FOUND".to_string())?;
    if run.conversation_id != input.conversation_id
        || run.turn_id != input.turn_id
        || run.chapter_id.as_deref() != input.chapter_id.as_deref()
    {
        return Err("DSH_CHAPTER_ADMISSION_SCOPE_MISMATCH".to_string());
    }
    if frozen_generation_snapshot(&run.model_snapshot)
        != frozen_generation_snapshot(&input.model_snapshot)
    {
        return Err(
            "DSH_CHAPTER_ADMISSION_MODEL_MISMATCH: 准入不能改写冻结模型选项".to_string(),
        );
    }
    let novel_id: String = connection
        .query_row(
            "SELECT novel_id FROM task_conversations WHERE conversation_id=?1",
            params![input.conversation_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| "DSH_CHAPTER_ADMISSION_SCOPE_MISMATCH".to_string())?;
    if novel_id != input.novel_id || matches!(run.status.as_str(), "cancelled" | "cancel_requested")
    {
        return Err("DSH_CHAPTER_ADMISSION_SCOPE_MISMATCH".to_string());
    }
    let event_id = validate_turn_execution_contract(connection, &input, &run_id)
        .map_err(|error| error.to_string())?;
    let generated = read_generated_chapter_result(connection, &input, &run_id, event_id.as_deref())
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "DSH_EXPECTED_CANDIDATE_RESULT_MISSING".to_string())?;
    if large_text_repository::sha256(&generated.text) != expected_hash {
        return Err("DSH_CHAPTER_ADMISSION_HASH_MISMATCH".to_string());
    }
    if let Some(artifact_id) = existing_artifact(connection, &input.conversation_id, &run_id)? {
        if run.status == "running" {
            complete_run(connection, &run_id)?;
        } else if run.status != "completed" {
            return Err("DSH_CHAPTER_ADMISSION_SCOPE_MISMATCH".to_string());
        }
        let run = reload_run(connection, &run_id)?;
        return Ok(admission_result(run, artifact_id, notifier));
    }
    if run.status != "running"
        || !run
            .error
            .as_deref()
            .unwrap_or("")
            .starts_with("DSH_CHAPTER_CANDIDATE_WITHHELD")
    {
        return Err("DSH_CHAPTER_ADMISSION_NOT_WITHHELD".to_string());
    }
    super::chapter_budget::enforce_admission_budget(
        connection,
        &input.conversation_id,
        &input.turn_id,
        &run.model_snapshot,
    )?;
    input.model_snapshot = run.model_snapshot.clone();
    let artifact_id = create_artifact_projection(connection, &input, &run_id, &generated, 0, 0)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "DSH_CHAPTER_ADMISSION_EMPTY".to_string())?;
    complete_run(connection, &run_id)?;
    let run = reload_run(connection, &run_id)?;
    let _ = notify_projection(notifier.as_ref(), &input.conversation_id, &run_id, "artifact");
    let _ = notify_projection(notifier.as_ref(), &input.conversation_id, &run_id, "terminal");
    Ok(admission_result(run, artifact_id, notifier))
}

fn admission_result(
    run: conversation_service::TaskRunRecord,
    artifact_id: String,
    _notifier: Option<TaskProjectionObserver>,
) -> TaskRuntimeResult {
    let attestation = attestation_from_snapshot(&run.model_snapshot);
    TaskRuntimeResult {
        session_id: format!("admission:{}", run.run_id),
        agent_id: format!("admission:{}", run.run_id),
        worker_id: run.worker_id.clone(),
        runtime: "dsh-headless-persistent".to_string(),
        assistant_text: None,
        artifact_id: Some(artifact_id),
        planned_action: None,
        session_lifecycle: None,
        model_tool_attestation: attestation,
        pending_chapter_candidate: None,
        run,
    }
}

fn reload_run(
    connection: &rusqlite::Connection,
    run_id: &str,
) -> Result<conversation_service::TaskRunRecord, String> {
    crate::repositories::conversation_repository::get_run(connection, run_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "DSH_CHAPTER_ADMISSION_RUN_NOT_FOUND".to_string())
}

fn complete_run(connection: &mut rusqlite::Connection, run_id: &str) -> Result<(), String> {
    let finished_at = now();
    conversation_service::update_run(
        connection,
        UpdateRunInput {
            run_id: run_id.to_string(),
            status: "completed".to_string(),
            error: None,
            updated_at: finished_at.clone(),
            started_at: None,
            finished_at: Some(finished_at),
        },
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn existing_artifact(
    connection: &rusqlite::Connection,
    conversation_id: &str,
    run_id: &str,
) -> Result<Option<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT artifact_id FROM conversation_artifact_cards
             WHERE conversation_id=?1 AND run_id=?2 AND artifact_type='chapter_text'
               AND artifact_id IS NOT NULL",
        )
        .map_err(|error| error.to_string())?;
    let ids = statement
        .query_map(params![conversation_id, run_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    match ids.len() {
        0 => Ok(None),
        1 => Ok(ids.into_iter().next()),
        _ => Err("DSH_CHAPTER_ADMISSION_CONFLICT".to_string()),
    }
}

fn active_worker(conversation_id: &str) -> Result<bool, String> {
    let workers = super::active()
        .lock()
        .map_err(|_| "Worker 状态锁失败".to_string())?;
    Ok(workers.get(conversation_id).is_some_and(|worker| {
        matches!(worker.status.as_str(), "attesting" | "running" | "cancel_requested")
    }))
}

fn attestation_from_snapshot(snapshot: &Value) -> Option<ModelToolAttestation> {
    snapshot
        .pointer("/runtime/toolCallingAttestation")
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
}

fn frozen_generation_snapshot(snapshot: &Value) -> Value {
    let mut copy = snapshot.clone();
    if let Some(runtime) = copy.get_mut("runtime").and_then(Value::as_object_mut) {
        runtime.remove("toolCallingAttestation");
        runtime.remove("chapterBudgetEpoch");
    }
    copy
}


