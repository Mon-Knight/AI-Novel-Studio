//! OpenAI-compatible wire tool builder, URL resolver, and SSE/JSON response parser.

use super::native_agent_transport::{NativeChatStepOutput, NativeToolCall};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::net::IpAddr;

pub(crate) fn to_wire_tool_name(canonical: &str) -> String {
    canonical.replace('.', "_")
}

pub(crate) fn build_openai_tools(allowed_csv: Option<&str>) -> Vec<Value> {
    let Some(csv) = allowed_csv.map(str::trim).filter(|s| !s.is_empty()) else {
        return Vec::new();
    };
    novel_domain_gateway::list_tools_for_allowlist_csv(Some(csv))
        .into_iter()
        .filter_map(|schema| {
            let name = schema.get("name")?.as_str()?;
            let wire = to_wire_tool_name(name);
            let description = schema
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("");
            let parameters = schema
                .get("inputSchema")
                .cloned()
                .unwrap_or_else(|| json!({"type":"object","properties":{}}));
            Some(json!({
                "type": "function",
                "function": {
                    "name": wire,
                    "description": description,
                    "parameters": parameters,
                }
            }))
        })
        .collect()
}

pub(crate) fn is_loopback_base_url(base_url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(base_url.trim()) else {
        return false;
    };
    parsed.host_str().is_some_and(|host| {
        let host = host.trim_matches(|c| c == '[' || c == ']');
        host.eq_ignore_ascii_case("localhost")
            || host
                .parse::<IpAddr>()
                .map(|ip| ip.is_loopback())
                .unwrap_or(false)
    })
}

pub(crate) fn resolve_chat_completions_url(base_url: &str) -> Result<reqwest::Url, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let mut url = reqwest::Url::parse(trimmed).map_err(|e| format!("模型服务地址无效: {e}"))?;
    let path = url.path().trim_end_matches('/').to_string();
    let target_path = if path.ends_with("/chat/completions") {
        path
    } else if path.is_empty() || path == "/" {
        "/v1/chat/completions".to_string()
    } else {
        format!("{path}/chat/completions")
    };
    url.set_path(&target_path);
    Ok(url)
}

#[derive(Default)]
struct ToolCallPartial {
    id: String,
    name: String,
    arguments: String,
}

pub(crate) fn parse_chat_response_body(raw: &str) -> Result<NativeChatStepOutput, String> {
    let trimmed = raw.trim();
    if trimmed.starts_with('{') && !trimmed.starts_with("data:") {
        let payload: Value =
            serde_json::from_str(trimmed).map_err(|_| "模型返回了无效 JSON 响应".to_string())?;
        return parse_chat_payloads(&[payload], true);
    }
    let mut payloads = Vec::new();
    let mut saw_done = false;
    for line in raw.lines() {
        let line = line.trim_end_matches('\r');
        let Some(rest) = line.strip_prefix("data:") else {
            continue;
        };
        let value = rest.trim();
        if value.is_empty() {
            continue;
        }
        if value == "[DONE]" {
            saw_done = true;
            continue;
        }
        let parsed: Value = serde_json::from_str(value)
            .map_err(|_| "AI 调用失败：模型服务返回了损坏的 SSE 数据帧".to_string())?;
        payloads.push(parsed);
    }
    parse_chat_payloads(&payloads, saw_done)
}

fn parse_chat_payloads(payloads: &[Value], saw_done: bool) -> Result<NativeChatStepOutput, String> {
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut finish_reason: Option<String> = None;
    let mut prompt_tokens: Option<u64> = None;
    let mut completion_tokens: Option<u64> = None;
    let mut tool_map: BTreeMap<usize, ToolCallPartial> = BTreeMap::new();

    for payload in payloads {
        if let Some(err) = payload.get("error") {
            let msg = err
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("上游流式错误");
            return Err(format!("AI 模型流式返回错误: {msg}"));
        }
        if let Some(usage) = payload.get("usage") {
            if let Some(pt) = usage
                .get("prompt_tokens")
                .or_else(|| usage.get("input_tokens"))
                .and_then(Value::as_u64)
            {
                prompt_tokens = Some(pt);
            }
            if let Some(ct) = usage
                .get("completion_tokens")
                .or_else(|| usage.get("output_tokens"))
                .and_then(Value::as_u64)
            {
                completion_tokens = Some(ct);
            }
        }
        let Some(choices) = payload.get("choices").and_then(Value::as_array) else {
            continue;
        };
        for choice in choices {
            if let Some(fr) = choice.get("finish_reason").and_then(Value::as_str) {
                if !fr.is_empty() {
                    finish_reason = Some(fr.to_string());
                }
            }
            let msg = choice
                .get("delta")
                .or_else(|| choice.get("message"))
                .unwrap_or(&Value::Null);
            if let Some(text) = msg.get("content").and_then(Value::as_str) {
                content.push_str(text);
            }
            for key in ["reasoning_content", "reasoning"] {
                if let Some(r) = msg.get(key).and_then(Value::as_str) {
                    reasoning.push_str(r);
                }
            }
            if let Some(calls) = msg.get("tool_calls").and_then(Value::as_array) {
                for (fallback_idx, call) in calls.iter().enumerate() {
                    let idx = call
                        .get("index")
                        .and_then(Value::as_u64)
                        .map(|v| v as usize)
                        .unwrap_or(fallback_idx);
                    let entry = tool_map.entry(idx).or_default();
                    if let Some(id) = call.get("id").and_then(Value::as_str) {
                        if !id.is_empty() {
                            entry.id = id.to_string();
                        }
                    }
                    if let Some(func) = call.get("function") {
                        if let Some(name) = func.get("name").and_then(Value::as_str) {
                            entry.name.push_str(name);
                        }
                        if let Some(args) = func.get("arguments").and_then(Value::as_str) {
                            entry.arguments.push_str(args);
                        }
                    }
                }
            }
        }
    }

    if !saw_done && finish_reason.is_none() {
        return Err("STREAM_CLOSED: 流式响应在完成标记前中断".to_string());
    }

    let tool_calls: Vec<NativeToolCall> = tool_map
        .into_iter()
        .enumerate()
        .filter(|(_, (_, item))| !item.name.trim().is_empty())
        .map(|(n, (_, item))| NativeToolCall {
            id: if item.id.trim().is_empty() {
                format!("call_native_{}", n + 1)
            } else {
                item.id
            },
            name: item.name,
            arguments: if item.arguments.trim().is_empty() {
                "{}".to_string()
            } else {
                item.arguments
            },
        })
        .collect();

    let estimated_completion = (content.chars().count() as u64)
        .saturating_add(
            tool_calls
                .iter()
                .map(|c| (c.name.len() + c.arguments.len()) as u64 / 3)
                .sum::<u64>(),
        )
        .max(1);

    Ok(NativeChatStepOutput {
        content,
        reasoning,
        tool_calls,
        prompt_tokens: prompt_tokens.unwrap_or(1),
        completion_tokens: completion_tokens.unwrap_or(estimated_completion),
        finish_reason,
        governed_identity: None,
    })
}
