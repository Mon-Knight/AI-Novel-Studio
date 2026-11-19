//! Durable execution-stage recovery. No credentials, adoption or budget reset is stored here.
use super::*;
use crate::repositories::conversation_repository as repository;

#[path = "task_runtime_retry_legacy.rs"]
mod legacy;

pub(super) use legacy::legacy_word_range;

const CONTRACT_TOOL: &str = "dsh.execution_contract";
const INVALID: &str = "DSH_RETRY_SOURCE_INVALID: 原失败阶段缺少完整且匹配的执行事实";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionContract {
    pub goal: String,
    pub task_kind: String,
    pub expected_tool: Option<String>,
    pub expected_artifact_type: Option<String>,
    pub required_read_tools: Vec<String>,
    pub chapter_word_range: Option<ChapterWordRangeInput>,
}

impl ExecutionContract {
    pub(super) fn from_input(input: &StartTaskTurnInput) -> Self {
        Self {
            goal: input.goal.clone(),
            task_kind: input.task_kind.clone(),
            expected_tool: input.expected_tool.clone(),
            expected_artifact_type: input.expected_artifact_type.clone(),
            required_read_tools: input.required_read_tools.clone(),
            chapter_word_range: input.chapter_word_range.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryResolution {
    pub source_run_id: String,
    pub turn_id: String,
    pub chapter_id: Option<String>,
    pub model_snapshot: Value,
    pub execution: Option<ExecutionContract>,
}

pub fn resolve(
    conversation_id: &str,
    novel_id: &str,
    source_run_id: &str,
) -> Result<RetryResolution, String> {
    let connection = crate::db::get_connection()
        .lock()
        .map_err(|_| "数据库锁失败".to_string())?;
    resolve_connection(&connection, conversation_id, novel_id, source_run_id)
}

pub(super) fn resolve_connection(
    connection: &rusqlite::Connection,
    conversation_id: &str,
    novel_id: &str,
    source_run_id: &str,
) -> Result<RetryResolution, String> {
    let bundle = repository::get_bundle(connection, conversation_id)
        .map_err(|e| e.to_string())?
        .ok_or(INVALID)?;
    let source = bundle
        .runs
        .iter()
        .find(|run| run.run_id == source_run_id)
        .ok_or(INVALID)?;
    conversation_service::validate_task_runtime_scope(
        connection,
        conversation_id,
        &source.turn_id,
        novel_id,
        source.chapter_id.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    if bundle.conversation.novel_id.as_deref() != Some(novel_id)
        || bundle.conversation.archived_at.is_some()
        || bundle.conversation.status == "archived"
        || !matches!(source.status.as_str(), "failed" | "cancelled")
        || !bundle
            .turns
            .iter()
            .any(|turn| turn.turn_id == source.turn_id && turn.role == "user")
        || bundle.runs.iter().any(|run| {
            matches!(
                run.status.as_str(),
                "queued" | "running" | "cancel_requested"
            )
        })
    {
        return Err(INVALID.into());
    }
    let siblings: Vec<_> = bundle
        .runs
        .iter()
        .filter(|run| run.turn_id == source.turn_id)
        .collect();
    if bundle.artifacts.iter().any(|card| {
        card.turn_id.as_deref() == Some(&source.turn_id)
            || card
                .run_id
                .as_ref()
                .is_some_and(|id| siblings.iter().any(|run| &run.run_id == id))
    }) {
        return Err("DSH_RETRY_ALREADY_HAS_CANDIDATE: 原回合已经有候选，请审阅现有候选".into());
    }
    let planning_only = |run: &&conversation_service::TaskRunRecord| {
        let events: Vec<_> = bundle
            .tool_events
            .iter()
            .filter(|event| event.run_id == run.run_id)
            .collect();
        run.status == "completed"
            && events
                .iter()
                .filter(|event| {
                    event.tool_name == "creative.plan_action" && event.status == "succeeded"
                })
                .count()
                == 1
            && !events.iter().any(|event| {
                CANDIDATE_TOOLS
                    .split(',')
                    .any(|tool| tool == event.tool_name)
            })
    };
    if siblings
        .iter()
        .rev()
        .find(|run| !planning_only(run))
        .map(|run| run.run_id.as_str())
        != Some(source_run_id)
    {
        return Err("DSH_RETRY_STAGE_SUPERSEDED: 原阶段已有更新执行结果".into());
    }
    let execution = read_contract(connection, &bundle, source_run_id)?;
    Ok(RetryResolution {
        source_run_id: source_run_id.into(),
        turn_id: source.turn_id.clone(),
        chapter_id: source.chapter_id.clone(),
        model_snapshot: source.model_snapshot.clone(),
        execution,
    })
}

pub(super) fn read_contract(
    connection: &rusqlite::Connection,
    bundle: &conversation_service::TaskConversationBundle,
    run_id: &str,
) -> Result<Option<ExecutionContract>, String> {
    let records: Vec<_> = bundle
        .tool_events
        .iter()
        .filter(|event| event.run_id == run_id && event.tool_name == CONTRACT_TOOL)
        .collect();
    if records.is_empty() {
        return legacy::legacy_contract(connection, bundle, run_id);
    }
    if records.len() != 1
        || records[0].status != "succeeded"
        || records[0]
            .arguments_summary
            .get("source")
            .and_then(Value::as_str)
            != Some("ans-host")
    {
        return Err(INVALID.into());
    }
    let record = records[0];
    let result = record.result.as_ref().ok_or(INVALID)?;
    let reference = result
        .get("largeTextRefId")
        .and_then(Value::as_str)
        .ok_or(INVALID)?;
    let bound = connection.query_row("SELECT 1 FROM large_text_documents WHERE id=?1 AND target_type='tool_event' AND target_id=?2 AND field_name='result'", rusqlite::params![reference, record.event_id], |_| Ok(())).optional().map_err(|e| e.to_string())?.is_some();
    if !bound {
        return Err(INVALID.into());
    }
    let document = large_text_repository::read_verified_document(connection, reference)
        .map_err(|e| e.to_string())?;
    if result.get("contentHash").and_then(Value::as_str) != Some(document.content_hash.as_str()) {
        return Err(INVALID.into());
    }
    serde_json::from_str(&document.content)
        .map(Some)
        .map_err(|_| INVALID.to_string())
}

pub(super) fn validate_retry(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
) -> Result<(), String> {
    let Some(source_id) = input.retry_source_run_id.as_deref() else {
        return Ok(());
    };
    let resolution = resolve_connection(
        connection,
        &input.conversation_id,
        input.require_novel_id()?,
        source_id,
    )?;
    if resolution.turn_id != input.turn_id
        || resolution.chapter_id != input.chapter_id
        || model_identity(&resolution.model_snapshot) != model_identity(&input.model_snapshot)
        || resolution
            .execution
            .as_ref()
            .is_some_and(|contract| *contract != ExecutionContract::from_input(input))
    {
        return Err(INVALID.into());
    }
    if is_chapter_writing_turn(input)
        && !input
            .chapter_host_gate
            .as_ref()
            .is_some_and(|gate| gate.explicit_retry)
    {
        return Err(INVALID.into());
    }
    Ok(())
}

pub(super) fn model_identity(value: &Value) -> Value {
    let mut copy = value.clone();
    if let Some(runtime) = copy.get_mut("runtime").and_then(Value::as_object_mut) {
        runtime.remove("toolCallingAttestation");
        runtime.remove("chapterBudgetEpoch");
        runtime.remove("artifactRevision");
    }
    copy
}

pub(super) fn record_contract(
    connection: &mut rusqlite::Connection,
    input: &StartTaskTurnInput,
    run_id: &str,
) -> Result<(), String> {
    let length_source_baseline = length_sources::projection::host_baseline(connection, input)?;
    let summary_source = summary_scope::source_metadata(connection, input)?;
    let text =
        serde_json::to_string(&ExecutionContract::from_input(input)).map_err(|e| e.to_string())?;
    let hash = large_text_repository::sha256(&text);
    let event_id = format!("{run_id}-execution-contract");
    let document_id = format!("{event_id}-result");
    let created = now();
    large_text_repository::insert_document_for_target(
        connection,
        &document_id,
        "tool_event",
        &event_id,
        "result",
        None,
        &text,
        &hash,
        &created,
    )
    .map_err(|e| e.to_string())?;
    conversation_service::append_tool_event(
        connection,
        AppendToolEventInput {
            event_id: event_id.clone(),
            run_id: run_id.into(),
            tool_name: CONTRACT_TOOL.into(),
            arguments_summary: json!({"source":"ans-host","taskKind":input.task_kind,
                "summarySource":summary_source,"execution":execution::execution_metadata(input),
                "lengthSourceBaseline":length_source_baseline,
                "requestTimeoutSeconds":input.request_policy.timeout_seconds.max(1)}),
            status: "running".into(),
            duration_ms: None,
            error: None,
            result: None,
            created_at: created.clone(),
            finished_at: None,
        },
    )
    .map_err(|e| e.to_string())?;
    conversation_service::update_tool_event(
        connection,
        UpdateToolEventInput {
            event_id,
            status: "succeeded".into(),
            duration_ms: None,
            error: None,
            result: Some(json!({"largeTextRefId":document_id,"contentHash":hash})),
            finished_at: Some(created),
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
