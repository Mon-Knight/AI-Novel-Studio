//! Persistent chapter-attempt budget. One epoch shares 3 candidate calls and 480s.
//! Automatic repair stays on the latest epoch. Only an explicit retry opens another.
//! The epoch is stored on the run snapshot; process memory cannot reset it.
use super::chapter_gate::{enforce_draft_budget, DraftBudget};
use super::chapter_recovery::{CHAPTER_CALL_BUDGET_EXHAUSTED, CHAPTER_WALL_BUDGET_EXHAUSTED};
use super::StartTaskTurnInput;
use rusqlite::params;
use serde_json::Value;
use std::collections::HashSet;
use std::time::Duration;

const HOST_WALL: Duration = Duration::from_secs(480);
const HOST_GATE_REQUIRED: &str =
    "DSH_CHAPTER_HOST_GATE_REQUIRED: 章节写作必须先草稿再准入，不能直接生成候选卡";

struct TurnRun {
    run_id: String,
    status: String,
    error: Option<String>,
    snapshot: String,
    started_at: String,
    planning_only: bool,
}

pub(crate) fn bind_draft_attempt(input: &mut StartTaskTurnInput) -> Result<DraftBudget, String> {
    let connection = crate::db::get_connection()
        .lock()
        .map_err(|_| "数据库锁失败".to_string())?;
    bind_draft_attempt_connection(&connection, input)
}

pub(crate) fn bind_draft_attempt_connection(
    connection: &rusqlite::Connection,
    input: &mut StartTaskTurnInput,
) -> Result<DraftBudget, String> {
    if !super::chapter_gate::is_gated_draft(input) {
        return Err(HOST_GATE_REQUIRED.to_string());
    }
    let gate = input
        .chapter_host_gate
        .as_ref()
        .ok_or_else(|| HOST_GATE_REQUIRED.to_string())?;
    let continues = gate
        .continues_run_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if gate.explicit_retry && continues.is_some() {
        return Err("DSH_CHAPTER_BUDGET_EPOCH_MISMATCH: 显式重试不能同时声明自动续修".to_string());
    }
    let runs = load_runs(connection, &input.conversation_id, &input.turn_id)?;
    if runs.iter().any(|run| {
        matches!(
            run.status.as_str(),
            "queued" | "running" | "cancel_requested"
        )
    }) {
        return Err("当前任务已有活动运行".to_string());
    }
    let epoch = if gate.explicit_retry {
        // A user retry first completes a creative planning Run on the same turn.
        // Keep it in wall/call accounting, but check the last actual draft outcome.
        if let Some(latest) = runs
            .iter()
            .rev()
            .find(|run| !(run.status == "completed" && run.planning_only))
        {
            if !matches!(latest.status.as_str(), "failed" | "cancelled") {
                return Err(
                    "DSH_CHAPTER_EXPLICIT_RETRY_BLOCKED: 只能在失败或取消后显式重试".to_string(),
                );
            }
        }
        format!("attempt:{}", uuid::Uuid::new_v4())
    } else if let Some(continues) = continues.as_deref() {
        let linked = runs
            .iter()
            .find(|run| run.run_id == continues)
            .ok_or_else(|| {
                "DSH_CHAPTER_BUDGET_EPOCH_MISMATCH: 自动续修运行不属于本次回合".to_string()
            })?;
        let linked_epoch = run_epoch(linked, &input.turn_id);
        if let Some(latest) = runs.last() {
            if linked_epoch != run_epoch(latest, &input.turn_id) {
                return Err(
                    "DSH_CHAPTER_BUDGET_EPOCH_MISMATCH: 自动续修不能切换或重置预算".to_string(),
                );
            }
        }
        linked_epoch
    } else if let Some(latest) = runs.last() {
        run_epoch(latest, &input.turn_id)
    } else {
        format!("turn:{}", input.turn_id)
    };
    stamp_epoch(&mut input.model_snapshot, &epoch)?;
    let usage = usage(connection, input)?;
    enforce_draft_budget(&usage)?;
    Ok(usage)
}

pub(crate) fn enforce_admission_budget(
    connection: &rusqlite::Connection,
    conversation_id: &str,
    turn_id: &str,
    snapshot: &Value,
) -> Result<(), String> {
    let mut authoritative = snapshot.clone();
    if epoch_of(&authoritative).is_none() {
        stamp_epoch(&mut authoritative, &format!("turn:{turn_id}"))?;
    }
    let usage = usage_for(connection, conversation_id, turn_id, &authoritative)?;
    if usage.calls > 3 {
        return Err(CHAPTER_CALL_BUDGET_EXHAUSTED.to_string());
    }
    if usage.remaining.is_zero() {
        return Err(CHAPTER_WALL_BUDGET_EXHAUSTED.to_string());
    }
    Ok(())
}

pub(crate) fn usage(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
) -> Result<DraftBudget, String> {
    usage_for(
        connection,
        &input.conversation_id,
        &input.turn_id,
        &input.model_snapshot,
    )
}

fn usage_for(
    connection: &rusqlite::Connection,
    conversation_id: &str,
    turn_id: &str,
    snapshot: &Value,
) -> Result<DraftBudget, String> {
    let epoch = epoch_of(snapshot);
    let runs = load_runs(connection, conversation_id, turn_id)?;
    let selected: Vec<&TurnRun> = runs
        .iter()
        .filter(|run| in_epoch(run, epoch.as_deref(), turn_id))
        .collect();
    let selected_ids: HashSet<&str> = selected.iter().map(|run| run.run_id.as_str()).collect();
    let calls = candidate_events(connection, conversation_id, turn_id)?
        .into_iter()
        .filter(|run_id| epoch.is_none() || selected_ids.contains(run_id.as_str()))
        .count();
    let repairs = selected
        .iter()
        .filter(|run| {
            run.status == "failed"
                && run
                    .error
                    .as_deref()
                    .unwrap_or("")
                    .starts_with("DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED")
        })
        .count();
    let earliest = selected.iter().map(|run| run.started_at.as_str()).min();
    let elapsed = match earliest {
        Some(value) => wall_elapsed(value)?,
        None => Duration::ZERO,
    };
    Ok(DraftBudget {
        remaining: HOST_WALL.saturating_sub(elapsed),
        calls,
        length_repairs: repairs,
    })
}

fn in_epoch(run: &TurnRun, epoch: Option<&str>, turn_id: &str) -> bool {
    let Some(epoch) = epoch else {
        return true;
    };
    match stored_epoch(&run.snapshot) {
        Some(value) => value == epoch,
        None => epoch == format!("turn:{turn_id}"),
    }
}

fn run_epoch(run: &TurnRun, turn_id: &str) -> String {
    stored_epoch(&run.snapshot).unwrap_or_else(|| format!("turn:{turn_id}"))
}

fn stored_epoch(snapshot: &str) -> Option<String> {
    let value: Value = serde_json::from_str(snapshot).ok()?;
    epoch_of(&value)
}

fn epoch_of(snapshot: &Value) -> Option<String> {
    snapshot
        .pointer("/runtime/chapterBudgetEpoch")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn stamp_epoch(snapshot: &mut Value, epoch: &str) -> Result<(), String> {
    let root = snapshot
        .as_object_mut()
        .ok_or_else(|| "modelSnapshot 无效或包含凭据字段".to_string())?;
    let runtime = root
        .entry("runtime")
        .or_insert_with(|| Value::Object(Default::default()));
    let object = runtime
        .as_object_mut()
        .ok_or_else(|| "DSH_CHAPTER_BUDGET_UNREADABLE".to_string())?;
    object.insert(
        "chapterBudgetEpoch".to_string(),
        Value::String(epoch.to_string()),
    );
    Ok(())
}

fn load_runs(
    connection: &rusqlite::Connection,
    conversation_id: &str,
    turn_id: &str,
) -> Result<Vec<TurnRun>, String> {
    let mut statement = connection
        .prepare(
            "SELECT r.run_id, r.status, r.error, r.model_snapshot_json,
                    COALESCE(r.started_at, r.created_at),
                    EXISTS(SELECT 1 FROM tool_call_events p
                           WHERE p.run_id=r.run_id AND p.tool_name='creative.plan_action'
                             AND p.status='succeeded')
                    AND NOT EXISTS(SELECT 1 FROM tool_call_events c
                                   WHERE c.run_id=r.run_id AND c.tool_name IN
                                     ('generate_chapter','polish_chapter','generate_outline',
                                      'generate_characters','suggest_events','expand_settings',
                                      'check_quality','summarize_chapter'))
                    AND NOT EXISTS(SELECT 1 FROM conversation_artifact_cards a
                                   WHERE a.run_id=r.run_id)
             FROM task_runs r
             WHERE conversation_id=?1 AND turn_id=?2
             ORDER BY r.created_at ASC, r.run_id ASC",
        )
        .map_err(|_| "DSH_CHAPTER_BUDGET_UNREADABLE".to_string())?;
    let rows = statement
        .query_map(params![conversation_id, turn_id], |row| {
            Ok(TurnRun {
                run_id: row.get(0)?,
                status: row.get(1)?,
                error: row.get(2)?,
                snapshot: row.get(3)?,
                started_at: row.get(4)?,
                planning_only: row.get(5)?,
            })
        })
        .map_err(|_| "DSH_CHAPTER_BUDGET_UNREADABLE".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "DSH_CHAPTER_BUDGET_UNREADABLE".to_string())?;
    Ok(rows)
}

fn candidate_events(
    connection: &rusqlite::Connection,
    conversation_id: &str,
    turn_id: &str,
) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT e.run_id FROM tool_call_events e
             JOIN task_runs r ON r.run_id = e.run_id
             WHERE r.conversation_id=?1 AND r.turn_id=?2
               AND e.tool_name IN ('generate_chapter','polish_chapter')",
        )
        .map_err(|_| "DSH_CHAPTER_BUDGET_UNREADABLE".to_string())?;
    let rows = statement
        .query_map(params![conversation_id, turn_id], |row| row.get(0))
        .map_err(|_| "DSH_CHAPTER_BUDGET_UNREADABLE".to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|_| "DSH_CHAPTER_BUDGET_UNREADABLE".to_string())?;
    Ok(rows)
}

fn wall_elapsed(timestamp: &str) -> Result<Duration, String> {
    let started = chrono::DateTime::parse_from_rfc3339(timestamp)
        .map_err(|_| "DSH_CHAPTER_BUDGET_UNREADABLE".to_string())?;
    let elapsed = chrono::Utc::now().signed_duration_since(started);
    if elapsed.num_milliseconds() <= 0 {
        return Ok(Duration::ZERO);
    }
    Ok(Duration::from_millis(elapsed.num_milliseconds() as u64))
}
