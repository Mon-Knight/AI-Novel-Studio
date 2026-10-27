//! Host capture for `submit_chapter_stage`.
//!
//! The gateway only validates and returns a hash. This module keeps the exact
//! tool arguments, then writes one authoritative stage row after the tool result
//! matches that content. Metadata-only hashes never become a successful stage.

use crate::repositories::large_text_repository;
use crate::services::chapter_workflow_stage_service::{
    self, ChapterWorkflowStageOutput, CompleteChapterWorkflowStageInput,
    StartChapterWorkflowStageInput, BINDING_CLOSE_MARKER, BINDING_OPEN_MARKER,
    WORKFLOW_BINDING_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

const EXECUTION_CONTRACT_TOOL: &str = "dsh.execution_contract";

pub(super) const TASK_KIND: &str = "chapter_stage_write";
pub(super) const TOOL_NAME: &str = "submit_chapter_stage";
pub(super) const ALLOWED_TOOLS: &str =
    "novel.read_context,chapter.read_outline,get_character_states,search_memory,submit_chapter_stage";

pub(super) fn is_stage_task(task_kind: &str) -> bool {
    task_kind == TASK_KIND
}

pub(super) fn expected_contract(task_kind: &str) -> Option<Result<Option<(&'static str, &'static str)>, String>> {
    (task_kind == TASK_KIND).then_some(Ok(None))
}

pub(super) fn instruction() -> String {
    "只提交当前一个 Scene 或 Beat 阶段。使用 submit_chapter_stage，不要调用 generate_chapter，不要写正式正文。阶段正文必须包含与本用户回合一致的 CHAPTER_WORKFLOW_BINDING。".to_string()
}

pub(super) fn validate_contract(task_kind: &str, chapter_id: Option<&str>, expected_tool: Option<&str>, expected_artifact: Option<&str>) -> Result<(), String> {
    if task_kind != TASK_KIND {
        return Ok(());
    }
    if chapter_id.is_none() {
        return Err("DSH_TASK_CONTRACT_INVALID: chapter_stage_write 必须绑定章节".to_string());
    }
    if expected_tool.is_some() || expected_artifact.is_some() {
        return Err("DSH_TASK_CONTRACT_INVALID: chapter_stage_write 不是章节候选任务".to_string());
    }
    Ok(())
}

pub(super) fn remember_submission(connection: &Connection, event_id: &str, arguments: &str) -> Result<(), String> {
    let document_id = arguments_document_id(event_id);
    let exists: bool = connection
        .query_row("SELECT EXISTS(SELECT 1 FROM large_text_documents WHERE id=?1)", params![document_id], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if exists {
        return Ok(());
    }
    large_text_repository::insert_document_for_target(
        connection,
        &document_id,
        "tool_event",
        event_id,
        "stage_arguments",
        None,
        arguments,
        &large_text_repository::sha256(arguments),
        &chrono::Utc::now().to_rfc3339(),
    )
    .map_err(|error| error.to_string())
}

pub(super) fn accept_submission(connection: &mut Connection, run_id: &str, event_id: &str, gateway_result: &str) -> Result<(), String> {
    let arguments = large_text_repository::read_verified_document(connection, &arguments_document_id(event_id))
        .map_err(|error| error.to_string())?;
    let submission = parse_submission(&arguments.content)?;
    let gateway = parse_gateway_result(gateway_result)?;
    if gateway.stage_key != submission.stage_key || gateway.stage_kind != submission.stage_kind || gateway.content_hash != large_text_repository::sha256(&submission.content) || gateway.content_chars != submission.content.chars().count() {
        return Err("CHAPTER_STAGE_RESULT_MISMATCH: 工具回执与原始阶段内容不一致".to_string());
    }
    let binding = binding_from_content(&submission.content)?;
    let run = load_run(connection, run_id)?;
    if binding.workflow_id != run.turn_id || submission.novel_id != run.novel_id || run.chapter_id.as_deref() != Some(submission.chapter_id.as_str()) {
        return Err("CHAPTER_STAGE_SCOPE_MISMATCH: 阶段提交与当前运行作用域不一致".to_string());
    }
    if binding.stage_key != submission.stage_key {
        return Err("CHAPTER_STAGE_BINDING_MISMATCH: 阶段绑定与本次阶段标识不一致".to_string());
    }
    let (scene_id, beat_id) = stage_identity(&submission.stage_kind, &submission.stage_key)?;
    require_predecessor(connection, &run.turn_id, &submission.stage_kind, scene_id.as_deref(), beat_id.as_deref())?;
    let context_hash = execution_contract_hash(connection, run_id)?;
    let base_hash = previous_result_hash(connection, &run.turn_id).unwrap_or_else(|| large_text_repository::sha256(""));
    let running = chapter_workflow_stage_service::start_stage(connection, StartChapterWorkflowStageInput {
        workflow_id: run.turn_id,
        conversation_id: run.conversation_id,
        novel_id: run.novel_id,
        chapter_id: submission.chapter_id,
        run_id: run_id.to_string(),
        stage_key: submission.stage_key,
        stage_kind: submission.stage_kind,
        scene_id,
        beat_id,
        plan_version: 2,
        context_hash,
        base_hash,
        input_hash: binding.input_hash,
        plan_hash: binding.plan_hash,
        model_snapshot_hash: None,
        attempt: None,
    }).map_err(|error| error.to_string())?;
    chapter_workflow_stage_service::complete_stage(connection, CompleteChapterWorkflowStageInput {
        stage_id: running.stage_id,
        expected_revision: running.revision,
        expected_result_hash: gateway.content_hash,
        output: ChapterWorkflowStageOutput::LargeText(submission.content),
    }).map(|_| ()).map_err(|error| error.to_string())
}

fn arguments_document_id(event_id: &str) -> String {
    format!("{event_id}-stage-arguments")
}

struct Submission {
    novel_id: String,
    chapter_id: String,
    stage_key: String,
    stage_kind: String,
    content: String,
}

struct GatewayResult {
    stage_key: String,
    stage_kind: String,
    content_hash: String,
    content_chars: usize,
}

struct Binding {
    workflow_id: String,
    stage_key: String,
    input_hash: String,
    plan_hash: String,
}

struct RunScope {
    conversation_id: String,
    turn_id: String,
    novel_id: String,
    chapter_id: Option<String>,
}

fn parse_submission(arguments: &str) -> Result<Submission, String> {
    let value = serde_json::from_str::<Value>(arguments).map_err(|_| "CHAPTER_STAGE_ARGUMENTS_INVALID".to_string())?;
    let object = value.as_object().ok_or_else(|| "CHAPTER_STAGE_ARGUMENTS_INVALID".to_string())?;
    if object.len() != 5 { return Err("CHAPTER_STAGE_ARGUMENTS_INVALID".to_string()); }
    Ok(Submission {
        novel_id: required_string(object, "novelId")?,
        chapter_id: required_string(object, "chapterId")?,
        stage_key: required_string(object, "stageKey")?,
        stage_kind: required_string(object, "stageKind")?,
        content: required_string(object, "content")?,
    })
}

fn parse_gateway_result(result: &str) -> Result<GatewayResult, String> {
    let value = serde_json::from_str::<Value>(result).map_err(|_| "CHAPTER_STAGE_GATEWAY_INVALID".to_string())?;
    if value.get("ok").and_then(Value::as_bool) != Some(true) || value.get("stageSubmissionVersion").and_then(Value::as_i64) != Some(1) {
        return Err("CHAPTER_STAGE_GATEWAY_INVALID".to_string());
    }
    let chars = value.get("contentChars").and_then(Value::as_u64).ok_or_else(|| "CHAPTER_STAGE_GATEWAY_INVALID".to_string())?;
    Ok(GatewayResult {
        stage_key: required_string(value.as_object().unwrap(), "stageKey")?,
        stage_kind: required_string(value.as_object().unwrap(), "stageKind")?,
        content_hash: required_string(value.as_object().unwrap(), "contentHash")?,
        content_chars: usize::try_from(chars).map_err(|_| "CHAPTER_STAGE_GATEWAY_INVALID".to_string())?,
    })
}

fn required_string(object: &serde_json::Map<String, Value>, key: &str) -> Result<String, String> {
    object.get(key).and_then(Value::as_str).filter(|value| !value.is_empty()).map(str::to_string).ok_or_else(|| "CHAPTER_STAGE_FIELD_MISSING".to_string())
}

fn binding_from_content(content: &str) -> Result<Binding, String> {
    let start = content.find(BINDING_OPEN_MARKER).ok_or_else(|| "CHAPTER_STAGE_BINDING_MISSING".to_string())?;
    let body_start = start + BINDING_OPEN_MARKER.len();
    let end_offset = content[body_start..].find(BINDING_CLOSE_MARKER).ok_or_else(|| "CHAPTER_STAGE_BINDING_MISSING".to_string())?;
    let body_end = body_start + end_offset;
    if content[body_end + BINDING_CLOSE_MARKER.len()..].contains(BINDING_OPEN_MARKER) {
        return Err("CHAPTER_STAGE_BINDING_DUPLICATE".to_string());
    }
    let value = serde_json::from_str::<Value>(content[body_start..body_end].trim()).map_err(|_| "CHAPTER_STAGE_BINDING_INVALID".to_string())?;
    let object = value.as_object().ok_or_else(|| "CHAPTER_STAGE_BINDING_INVALID".to_string())?;
    if object.len() != 5 || object.get("schemaVersion").and_then(Value::as_i64) != Some(WORKFLOW_BINDING_VERSION) {
        return Err("CHAPTER_STAGE_BINDING_INVALID".to_string());
    }
    Ok(Binding {
        workflow_id: required_string(object, "workflowId")?,
        stage_key: required_string(object, "stageKey")?,
        input_hash: required_string(object, "inputHash")?,
        plan_hash: required_string(object, "planHash")?,
    })
}

fn stage_identity(kind: &str, key: &str) -> Result<(Option<String>, Option<String>), String> {
    match kind {
        "scene_plan" if key == "scene_plan" => Ok((None, None)),
        "beat_plan" => one_id(key, "beat_plan").map(|scene| (Some(scene), None)),
        "beat_write" => two_ids(key, "beat_write"),
        "beat_state" => two_ids(key, "beat_state"),
        _ => Err("CHAPTER_STAGE_KEY_INVALID".to_string()),
    }
}

fn one_id(key: &str, prefix: &str) -> Result<String, String> {
    let value = key.strip_prefix(&format!("{prefix}:")).ok_or_else(|| "CHAPTER_STAGE_KEY_INVALID".to_string())?;
    if value.is_empty() || value.contains(':') { return Err("CHAPTER_STAGE_KEY_INVALID".to_string()); }
    Ok(value.to_string())
}

fn two_ids(key: &str, prefix: &str) -> Result<(Option<String>, Option<String>), String> {
    let value = key.strip_prefix(&format!("{prefix}:")).ok_or_else(|| "CHAPTER_STAGE_KEY_INVALID".to_string())?;
    let (scene, beat) = value.split_once(':').ok_or_else(|| "CHAPTER_STAGE_KEY_INVALID".to_string())?;
    if scene.is_empty() || beat.is_empty() || beat.contains(':') { return Err("CHAPTER_STAGE_KEY_INVALID".to_string()); }
    Ok((Some(scene.to_string()), Some(beat.to_string())))
}

fn require_predecessor(connection: &Connection, workflow_id: &str, kind: &str, scene_id: Option<&str>, beat_id: Option<&str>) -> Result<(), String> {
    let ready = match kind {
        "scene_plan" => true,
        "beat_plan" => stage_succeeded(connection, workflow_id, "scene_plan", None, None)?,
        "beat_write" => stage_succeeded(connection, workflow_id, "beat_plan", scene_id, None)?,
        "beat_state" => stage_succeeded(connection, workflow_id, "beat_write", scene_id, beat_id)?,
        _ => false,
    };
    if ready { Ok(()) } else { Err("CHAPTER_STAGE_ORDER_INVALID: 前置阶段尚未成功".to_string()) }
}

fn stage_succeeded(connection: &Connection, workflow_id: &str, kind: &str, scene_id: Option<&str>, beat_id: Option<&str>) -> Result<bool, String> {
    connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM chapter_workflow_stages WHERE workflow_id=?1 AND stage_kind=?2 AND status='succeeded' AND scene_id IS ?3 AND beat_id IS ?4)",
        params![workflow_id, kind, scene_id, beat_id],
        |row| row.get(0),
    ).map_err(|error| error.to_string())
}

fn execution_contract_hash(connection: &Connection, run_id: &str) -> Result<String, String> {
    let result_json: String = connection.query_row(
        "SELECT result_json FROM tool_call_events WHERE run_id=?1 AND tool_name=?2 AND status='succeeded'",
        params![run_id, EXECUTION_CONTRACT_TOOL],
        |row| row.get(0),
    ).optional().map_err(|error| error.to_string())?.ok_or_else(|| "CHAPTER_STAGE_CONTRACT_MISSING".to_string())?;
    serde_json::from_str::<Value>(&result_json).ok().and_then(|value| value.get("contentHash").and_then(Value::as_str).map(str::to_string)).filter(|hash| hash.len() == 64).ok_or_else(|| "CHAPTER_STAGE_CONTRACT_MISSING".to_string())
}

fn previous_result_hash(connection: &Connection, workflow_id: &str) -> Option<String> {
    connection.query_row(
        "SELECT result_hash FROM chapter_workflow_stages WHERE workflow_id=?1 AND status='succeeded' ORDER BY created_at DESC, stage_id DESC LIMIT 1",
        params![workflow_id],
        |row| row.get(0),
    ).optional().ok().flatten()
}

fn load_run(connection: &Connection, run_id: &str) -> Result<RunScope, String> {
    connection.query_row(
        "SELECT conversation_id, turn_id, (SELECT novel_id FROM task_conversations WHERE conversation_id=task_runs.conversation_id), chapter_id FROM task_runs WHERE run_id=?1 AND status='running'",
        params![run_id],
        |row| Ok(RunScope { conversation_id: row.get(0)?, turn_id: row.get(1)?, novel_id: row.get(2)?, chapter_id: row.get(3)? }),
    ).map_err(|_| "CHAPTER_STAGE_RUN_NOT_RUNNING".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open() -> Connection {
        let mut connection = Connection::open_in_memory().expect("memory");
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::db::create_tables(&mut connection).unwrap();
        connection
    }

    fn seed(connection: &Connection) {
        connection.execute_batch(
            "INSERT INTO novels (id, title, status, created_at, updated_at) VALUES ('novel-1','N','draft','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
             INSERT INTO chapters (id, novel_id, title, status, created_at, updated_at) VALUES ('chapter-1','novel-1','C','not_started','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
             INSERT INTO task_conversations (conversation_id, novel_id, title, status, created_at, updated_at) VALUES ('conversation-1','novel-1','T','running','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
             INSERT INTO conversation_turns (turn_id, conversation_id, sequence, role, content, created_at) VALUES ('turn-1','conversation-1',0,'user','write','2026-01-01T00:00:00Z');
             INSERT INTO task_runs (run_id, conversation_id, turn_id, status, model_snapshot_json, worker_id, chapter_id, created_at, updated_at) VALUES ('run-1','conversation-1','turn-1','queued','{\"providerId\":\"mock\",\"modelId\":\"mock-v1\"}','worker','chapter-1','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
             INSERT INTO tool_call_events (event_id, run_id, sequence, tool_name, arguments_summary_json, status, created_at) VALUES ('run-1-execution-contract','run-1',0,'dsh.execution_contract','{}','running','2026-01-01T00:00:00Z');"
        ).unwrap();
        connection.execute("UPDATE task_runs SET status='running' WHERE run_id='run-1'", []).unwrap();
        connection.execute(
            "UPDATE tool_call_events SET status='succeeded', result_json=?1, finished_at=created_at WHERE event_id='run-1-execution-contract'",
            params!["{\"contentHash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}"],
        ).unwrap();
    }

    fn content(stage_key: &str) -> String {
        format!("正文\n{BINDING_OPEN_MARKER}\n{{\"schemaVersion\":1,\"workflowId\":\"turn-1\",\"stageKey\":\"{stage_key}\",\"inputHash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"planHash\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"}}\n{BINDING_CLOSE_MARKER}")
    }

    fn arguments(stage_key: &str, stage_kind: &str) -> String {
        serde_json::json!({
            "novelId": "novel-1",
            "chapterId": "chapter-1",
            "stageKey": stage_key,
            "stageKind": stage_kind,
            "content": content(stage_key),
        }).to_string()
    }

    fn gateway(stage_key: &str, stage_kind: &str, body: &str) -> String {
        serde_json::json!({
            "ok": true,
            "stageSubmissionVersion": 1,
            "stageKey": stage_key,
            "stageKind": stage_kind,
            "contentHash": large_text_repository::sha256(body),
            "contentChars": body.chars().count(),
        }).to_string()
    }

    #[test]
    fn scene_plan_submission_becomes_one_succeeded_stage() {
        let mut connection = open();
        seed(&connection);
        let args = arguments("scene_plan", "scene_plan");
        let body = serde_json::from_str::<Value>(&args).unwrap()["content"].as_str().unwrap().to_string();
        remember_submission(&connection, "event-1", &args).unwrap();
        accept_submission(&mut connection, "run-1", "event-1", &gateway("scene_plan", "scene_plan", &body)).unwrap();
        let count: i64 = connection.query_row("SELECT COUNT(*) FROM chapter_workflow_stages WHERE status='succeeded'", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn missing_binding_and_skipped_stage_do_not_succeed() {
        let mut connection = open();
        seed(&connection);
        let args = serde_json::json!({"novelId":"novel-1","chapterId":"chapter-1","stageKey":"beat_plan:scene-1","stageKind":"beat_plan","content":"没有绑定"}).to_string();
        remember_submission(&connection, "event-2", &args).unwrap();
        let error = accept_submission(&mut connection, "run-1", "event-2", &gateway("beat_plan:scene-1", "beat_plan", "没有绑定")).unwrap_err();
        assert!(error.contains("BINDING_MISSING"), "{error}");
        let count: i64 = connection.query_row("SELECT COUNT(*) FROM chapter_workflow_stages", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }
}
