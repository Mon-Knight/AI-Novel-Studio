//! Reuse a rejected full draft only while its narrative sources still match formal material.
use super::*;

#[path = "task_runtime_length_source_projection.rs"]
pub(super) mod projection;

fn receipt(
    connection: &rusqlite::Connection,
    run: &str,
    candidate: &str,
    tool: &str,
) -> Result<Value, String> {
    let event: String = connection.query_row(
        "SELECT event_id FROM tool_call_events WHERE run_id=?1 AND tool_name=?2 AND status='succeeded'
         AND sequence<(SELECT sequence FROM tool_call_events WHERE event_id=?3 AND run_id=?1) ORDER BY sequence DESC LIMIT 1",
        rusqlite::params![run,tool,candidate], |row|row.get(0),
    ).map_err(|_|format!("缺少{tool}完整来源回执"))?;
    context_coverage::verified_payload(connection, &event, tool)
        .map_err(|_| format!("{tool}来源回执不完整或已损坏"))
}

fn matches_projection(old: &Value, current: &Value) -> bool {
    match current {
        Value::Object(fields) => {
            old.is_object()
                && fields.iter().all(|(key, value)| {
                    old.get(key)
                        .is_some_and(|old| matches_projection(old, value))
                })
        }
        Value::Array(values) => {
            let Some(old) = old.as_array().filter(|old| old.len() == values.len()) else {
                return false;
            };
            let mut used = vec![false; old.len()];
            values.iter().all(|value| {
                let found = old
                    .iter()
                    .enumerate()
                    .position(|(index, old)| !used[index] && matches_projection(old, value));
                if let Some(index) = found {
                    used[index] = true;
                    true
                } else {
                    false
                }
            })
        }
        _ => old == current,
    }
}

pub(super) fn validate(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
    run: &str,
    candidate: &str,
) -> Result<(), String> {
    let chapter = receipt(connection, run, candidate, "chapter.read_outline")?;
    let live =
        projection::current(connection, input).map_err(|_| "当前正式源无法完整读取".to_string())?;
    // Check adopted manuscript first: the common old-Run case is a chapter adopted later.
    for (key, label) in [
        ("currentAdoptedDraft", "本章采用稿"),
        ("chapter", "本章章纲或章节位置"),
        ("outline", "章节大纲"),
        ("masterOutline", "全书大纲"),
        ("volumeOutline", "分卷大纲"),
        ("engineeringState", "章节工程材料"),
        ("chapterRoles", "本章人物安排"),
        ("chapterEvents", "本章事件"),
        ("previousChapterSummaries", "前章总结材料"),
        ("targetChapterSummary", "本章总结材料"),
    ] {
        if !chapter
            .get("data")
            .and_then(|data| data.get(key))
            .is_some_and(|old| matches_projection(old, &live[key]))
        {
            return Err(format!("{label}已变化，或旧回执未完整保留该来源"));
        }
    }
    let novel = receipt(connection, run, candidate, "novel.read_context")?;
    for (key, label) in [
        ("novel", "作品方向"),
        ("chapters", "章节顺序或采用指针"),
        ("volumes", "分卷顺序"),
    ] {
        if !novel
            .get("data")
            .and_then(|data| data.get(key))
            .is_some_and(|old| matches_projection(old, &live[key]))
        {
            return Err(format!("{label}已变化，或旧回执未完整保留该来源"));
        }
    }
    let characters = receipt(connection, run, candidate, "get_character_states")?;
    for (key, label) in [("characters", "人物设定"), ("stateTrack", "人物状态材料")] {
        if !characters
            .get("data")
            .and_then(|data| data.get(key))
            .is_some_and(|old| matches_projection(old, &live[key]))
        {
            return Err(format!("{label}已变化，或旧回执未完整保留该来源"));
        }
    }
    let host = connection.query_row(
        "SELECT arguments_summary_json FROM tool_call_events WHERE run_id=?1 AND tool_name='dsh.execution_contract' AND status='succeeded'",
        [run],|row|row.get::<_,String>(0),
    ).optional().map_err(|e|e.to_string())?.and_then(|raw|serde_json::from_str::<Value>(&raw).ok());
    let current = projection::host_baseline(connection, input)
        .map_err(|_| "当前前章正文或人物来源无法复验".to_string())?;
    if let Some(old) = host
        .as_ref()
        .and_then(|host| host.get("lengthSourceBaseline"))
    {
        if old.get("schemaVersion") != current.get("schemaVersion") {
            return Err("旧稿正式源基线版本不可复验".into());
        }
        if old.get("previous") != current.get("previous") {
            return Err("前章采用正文或章节顺序已变化".into());
        }
        if old.get("profilesHash") != current.get("profilesHash") {
            return Err("人物正式资料已变化".into());
        }
    } else {
        // Older Runs can still recover from complete receipts. A predecessor without its
        // original full-body hash, or merged/clipped protagonist profiles, is not provable.
        if !current["previous"].is_null() {
            return Err("旧回执缺少可复验的前章全文基线".into());
        }
        if current["legacyProfilesEmpty"] != json!(true) {
            return Err("旧回执缺少可复验的完整主角资料基线".into());
        }
        for data in [&novel["data"], &characters["data"]] {
            if data.get("protagonistSource").and_then(Value::as_str) != Some("none")
                || data
                    .get("protagonists")
                    .and_then(Value::as_array)
                    .is_none_or(|items| !items.is_empty())
            {
                return Err("旧回执缺少可复验的完整主角资料基线".into());
            }
        }
    }
    Ok(())
}
