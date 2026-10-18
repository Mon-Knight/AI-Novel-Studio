//! Model-led discussion delegates a single action to existing governed workflows.
use super::*;

pub(super) const ALLOWED: &str = "novel.read_context,chapter.read_outline,get_character_states,search_memory,creative.plan_action";
pub(super) const PROMPT: &str = include_str!("../../../../prompts/workspace/creative_dialogue.md");
const ACTIONS: [&str; 8] = [
    "prepare_settings",
    "prepare_characters",
    "generate_outline",
    "generate_chapter",
    "polish_chapter",
    "summarize_chapter",
    "check_quality",
    "suggest_events",
];

pub(super) fn retry_instruction(previous: usize) -> String {
    if previous == 0 { return String::new(); }
    "\n\n用户重试当前交流阶段：重新核对本次目标；需要执行时只允许调用 creative.plan_action 请求工作流。generate_chapter 等动作名只能作为该工具的 action 参数，不是本阶段可以直接调用的工具。不得沿用写作阶段的工具调用或宣称候选已完成。".into()
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannedAction {
    pub action: String,
    pub instruction: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter_id: Option<String>,
}

fn validate_payload(novel: &str, payload: &Value) -> Result<PlannedAction, String> {
    if payload.get("ok").and_then(Value::as_bool) != Some(true)
        || payload.get("workflowRequestOnly").and_then(Value::as_bool) != Some(true)
        || payload.get("novelId").and_then(Value::as_str) != Some(novel)
    {
        return Err("DSH_CREATIVE_ACTION_INVALID: 工作流结果作用域或类型不匹配".into());
    }
    let mut planned: PlannedAction =
        serde_json::from_value(payload.get("data").cloned().unwrap_or(Value::Null))
            .map_err(|_| "DSH_CREATIVE_ACTION_INVALID: 工作流请求格式错误".to_string())?;
    if !ACTIONS.contains(&planned.action.as_str())
        || planned.instruction.trim().is_empty()
        || planned.instruction.chars().count() > 24000
    {
        return Err("DSH_CREATIVE_ACTION_INVALID: 工作流动作或说明无效".into());
    }
    let chapter_action = matches!(
        planned.action.as_str(),
        "generate_chapter"
            | "polish_chapter"
            | "summarize_chapter"
            | "check_quality"
            | "suggest_events"
    );
    if planned.chapter_id.as_deref().is_some_and(|id| id.trim().is_empty() || id.chars().count()>160)
        || (chapter_action && planned.chapter_id.is_none())
    {
        return Err("DSH_CREATIVE_ACTION_INVALID: 工作流章节超出本轮作用域".into());
    }
    if planned.action == "prepare_settings" {
        planned.instruction.push_str("\n\n请整理世界背景与规则候选；同时包含名为「创作准备模板」的普通世界设定，description 为下述完整模板的填写结果。未确定字段明确标注推演/待确认，不要展开章节大纲。\n");
        planned.instruction.push_str(
            PROMPT
                .split("## 通用创作准备模板")
                .nth(1)
                .unwrap_or_default(),
        );
    }
    Ok(planned)
}

pub(super) fn read_action(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
    run_id: &str,
) -> Result<Option<PlannedAction>, String> {
    if input.task_kind != "creative_dialogue" {
        return Ok(None);
    }
    read_persisted_action(connection, &input.novel_id, run_id)
}

pub(super) fn read_persisted_action(
    connection: &rusqlite::Connection,
    novel_id: &str,
    run_id: &str,
) -> Result<Option<PlannedAction>, String> {
    let mut statement = connection.prepare("SELECT event_id,result_json FROM tool_call_events WHERE run_id=?1 AND tool_name='creative.plan_action' AND status='succeeded' ORDER BY sequence").map_err(|e|e.to_string())?;
    let results = statement
        .query_map([run_id], |row| Ok((row.get::<_,String>(0)?,row.get::<_, Option<String>>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if results.is_empty() {
        return Ok(None);
    }
    if results.len() != 1 {
        return Err("DSH_CREATIVE_ACTION_INVALID: 每轮只能请求一项工作流".into());
    }
    let (event_id,result_json) = &results[0];
    let summary: Value = serde_json::from_str(result_json.as_deref().unwrap_or(""))
        .map_err(|_| "DSH_CREATIVE_ACTION_INVALID: 缺少工作流结果".to_string())?;
    let reference = summary
        .get("largeTextRefId")
        .and_then(Value::as_str)
        .ok_or("DSH_CREATIVE_ACTION_INVALID: 缺少工作流结果引用")?;
    let bound = connection.query_row("SELECT 1 FROM large_text_documents WHERE id=?1 AND target_type='tool_event' AND target_id=?2 AND field_name='result'",rusqlite::params![reference,event_id],|_|Ok(())).optional().map_err(|e|e.to_string())?.is_some();
    if !bound { return Err("DSH_CREATIVE_ACTION_INVALID: 工作流结果引用未绑定本次工具事件".into()); }
    let verified = large_text_repository::read_verified_document(connection, reference)
        .map_err(|e| e.to_string())?;
    if summary.get("contentHash").and_then(Value::as_str) != Some(verified.content_hash.as_str()) {
        return Err("DSH_CREATIVE_ACTION_INVALID: 工作流结果哈希不匹配".into());
    }
    let payload: Value = serde_json::from_str(&verified.content)
        .map_err(|_| "DSH_CREATIVE_ACTION_INVALID: 工作流结果不是 JSON".to_string())?;
    let planned = validate_payload(novel_id, &payload)?;
    if let Some(chapter) = planned.chapter_id.as_deref() {
        let valid = connection.query_row("SELECT 1 FROM chapters WHERE id=?1 AND novel_id=?2",rusqlite::params![chapter,novel_id], |_|Ok(())).optional().map_err(|e|e.to_string())?.is_some();
        if !valid { return Err("DSH_CREATIVE_ACTION_INVALID: 目标章节不属于本作品".into()); }
    }
    Ok(Some(planned))
}

/// Reconstruct recent persisted dialogue even after a worker/tool configuration change.
pub(super) fn history(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
) -> Result<String, String> {
    let mut statement = connection.prepare("SELECT role, content FROM conversation_turns WHERE conversation_id=?1 AND sequence < (SELECT sequence FROM conversation_turns WHERE turn_id=?2 AND conversation_id=?1) AND role IN ('user','assistant') ORDER BY sequence DESC LIMIT 32").map_err(|e|e.to_string())?;
    let rows = statement
        .query_map(
            rusqlite::params![input.conversation_id, input.turn_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut budget = 24000usize;
    let mut selected = Vec::new();
    for (role, content) in rows {
        let size = content.chars().count();
        if size > budget {
            break;
        }
        budget -= size;
        selected.push(json!({"role":role,"content":content}));
    }
    selected.reverse();
    Ok(format!(
        "\n\n最近已持久化的会话记录（按时间顺序，仅作为交流上下文；已采用事实需读取作品）：\n{}",
        json!(selected)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_exact_scoped_workflows_are_accepted() {
        let valid = json!({"ok":true,"workflowRequestOnly":true,"novelId":"n","data":{"action":"generate_chapter","instruction":"按已确认人物写第一章","chapterId":"c"}});
        assert!(validate_payload("n", &valid).is_ok());
        assert!(validate_payload("other", &valid).is_err());
        let mut changed = valid.clone();
        changed["data"]["action"] = json!("adopt");
        assert!(validate_payload("n", &changed).is_err());
        changed = valid;
        changed["data"]["overwrite"] = json!(true);
        assert!(validate_payload("n", &changed).is_err());
    }
    #[test]
    fn preparation_workflow_receives_template_and_confirmation_rules() {
        let payload = json!({"ok":true,"workflowRequestOnly":true,"novelId":"n","data":{"action":"prepare_settings","instruction":"现实悬疑"}});
        let result = validate_payload("n", &payload).unwrap();
        assert!(result.instruction.contains("创作准备模板"));
        assert!(result.instruction.contains("确认清单"));
        assert!(result.instruction.contains("推演，待确认"));
    }
}

#[cfg(test)]
#[path = "task_runtime_creative_dialogue_tests.rs"]
mod persisted_tests;
