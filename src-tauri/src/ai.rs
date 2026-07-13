use reqwest::blocking::Client as BlockingClient;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatCompletionRequest {
    pub base_url: String,
    pub api_key: String,
    pub model_name: String,
    pub messages: Vec<AiChatMessage>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<u32>,
    pub timeout_seconds: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatCompletionResponse {
    pub text: String,
    pub raw: Value,
    pub token_input: Option<i64>,
    pub token_output: Option<i64>,
    pub total_tokens: Option<i64>,
}

fn build_chat_completions_url(base_url: &str) -> String {
    let clean = base_url.trim().trim_end_matches('/').to_string();
    if clean.ends_with("/chat/completions") {
        return clean;
    }
    if clean.ends_with("/v1") {
        return format!("{}/chat/completions", clean);
    }
    format!("{}/v1/chat/completions", clean)
}

fn validate_request(request: &AiChatCompletionRequest) -> Result<(), String> {
    if request.base_url.trim().is_empty() {
        return Err("当前为 API 模式，但 API Base URL 未配置，请先到设置中心配置。".into());
    }
    if request.api_key.trim().is_empty() {
        return Err("当前为 API 模式，但 API Key 未配置，请先到设置中心配置。".into());
    }
    if request.model_name.trim().is_empty() {
        return Err("当前为 API 模式，但模型名称未配置，请先到设置中心配置。".into());
    }
    let temperature = request.temperature.unwrap_or(0.7);
    if !(0.0..=2.0).contains(&temperature) {
        return Err("temperature 必须在 0 到 2 之间，请检查设置中心配置。".into());
    }
    let max_tokens = request.max_tokens.unwrap_or(8000);
    if max_tokens == 0 || max_tokens > 200_000 {
        return Err("max_tokens 配置不合法，请检查设置中心的最大输出 Token。".into());
    }
    let timeout_seconds = request.timeout_seconds.unwrap_or(120);
    if timeout_seconds == 0 || timeout_seconds > 1800 {
        return Err("timeoutSeconds 配置不合法，请检查设置中心的超时时间。".into());
    }
    if request.messages.is_empty() {
        return Err("AI 请求缺少 messages。".into());
    }
    Ok(())
}

fn user_error_from_status(status: reqwest::StatusCode, body: &str, model_name: &str) -> String {
    match status.as_u16() {
        400 => format!("AI 调用失败：请求参数不合法（400 Bad Request）。请检查模型名称、max_tokens 和提示词格式。{}", short_body(body)),
        401 => "AI 调用失败：API Key 无效或已过期（401 Unauthorized），请检查设置中心的 API Key。".into(),
        403 => {
            let lower = body.to_lowercase();
            if lower.contains("model") || lower.contains("permission") || lower.contains("access") {
                format!("AI 调用失败：当前 API Key 无权访问模型「{}」，请检查设置中心的模型名称或平台授权。", model_name)
            } else {
                "AI 调用失败：服务拒绝访问（403 Forbidden），请检查 API Key 权限。".into()
            }
        }
        429 => "AI 调用失败：请求过于频繁或额度不足（429 Rate Limit），请稍后重试或检查账户额度。".into(),
        500..=599 => {
            let lower = body.to_lowercase();
            if lower.contains("overloaded") || lower.contains("overload") {
                "AI 调用失败：模型服务当前过载（overloaded_error），请稍后重试。".into()
            } else {
                format!("AI 调用失败：模型服务错误（{}），请稍后重试。{}", status.as_u16(), short_body(body))
            }
        }
        _ => format!("AI 调用失败：HTTP {}。{}", status.as_u16(), short_body(body)),
    }
}

fn short_body(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let snippet: String = trimmed.chars().take(240).collect();
    format!(" 服务返回：{}", snippet)
}

#[tauri::command]
pub fn ai_chat_completion(
    request: AiChatCompletionRequest,
) -> Result<AiChatCompletionResponse, String> {
    validate_request(&request)?;

    let url = build_chat_completions_url(&request.base_url);
    let timeout_seconds = request.timeout_seconds.unwrap_or(120);
    let client = BlockingClient::builder()
        .timeout(Duration::from_secs(timeout_seconds))
        .build()
        .map_err(|e| format!("AI 调用失败：HTTP 客户端初始化失败：{}", e))?;

    #[cfg(debug_assertions)]
    {
        let last_user_message = request
            .messages
            .iter()
            .rev()
            .find(|message| message.role == "user")
            .map(|message| message.content.as_str())
            .unwrap_or("");
        println!(
            "[ai_chat_completion] messages count={}",
            request.messages.len()
        );
        println!(
            "[ai_chat_completion] user message length={}",
            last_user_message.chars().count()
        );
        println!(
            "[ai_chat_completion] contains chapter outline marker={}",
            last_user_message.contains("【当前章节大纲】")
        );
        println!(
            "[ai_chat_completion] contains outline checklist marker={}",
            last_user_message.contains("【章节大纲执行清单】")
        );
        println!(
            "[ai_chat_completion] contains required characters marker={}",
            last_user_message.contains("【本章必须直接出场角色】")
        );
    }

    let body = json!({
        "model": &request.model_name,
        "messages": &request.messages,
        "temperature": request.temperature.unwrap_or(0.7),
        "max_tokens": request.max_tokens.unwrap_or(8000),
    });

    let response = client
        .post(url)
        .bearer_auth(request.api_key.trim())
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| {
            if e.is_timeout() {
                format!(
                    "AI 调用失败：请求超时（{} 秒），请检查网络或增加超时时间。",
                    timeout_seconds
                )
            } else if e.is_connect() {
                "AI 调用失败：网络连接失败，请检查 API Base URL、网络连接或代理设置。".to_string()
            } else {
                format!("AI 调用失败：网络请求失败：{}", e)
            }
        })?;

    let status = response.status();
    let text_body = response
        .text()
        .map_err(|e| format!("AI 调用失败：读取响应失败：{}", e))?;

    if !status.is_success() {
        return Err(user_error_from_status(
            status,
            &text_body,
            &body["model"].as_str().unwrap_or(""),
        ));
    }

    let data: Value = serde_json::from_str(&text_body).map_err(|e| {
        format!(
            "AI 调用失败：响应不是有效 JSON：{}。原始返回：{}",
            e,
            text_body.chars().take(240).collect::<String>()
        )
    })?;

    let content = data
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    if content.trim().is_empty() {
        return Err("AI 调用失败：模型返回空内容，请检查提示词、模型名称或重试。".into());
    }

    let usage = data.get("usage");
    Ok(AiChatCompletionResponse {
        text: content,
        token_input: usage
            .and_then(|u| u.get("prompt_tokens"))
            .and_then(Value::as_i64),
        token_output: usage
            .and_then(|u| u.get("completion_tokens"))
            .and_then(Value::as_i64),
        total_tokens: usage
            .and_then(|u| u.get("total_tokens"))
            .and_then(Value::as_i64),
        raw: data,
    })
}

pub async fn ai_chat_completion_async(
    request: AiChatCompletionRequest,
    cancellation: CancellationToken,
) -> Result<AiChatCompletionResponse, String> {
    validate_request(&request)?;
    let url = build_chat_completions_url(&request.base_url);
    let timeout_seconds = request.timeout_seconds.unwrap_or(120);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_seconds))
        .build()
        .map_err(|error| format!("AI 调用失败：HTTP 客户端初始化失败：{error}"))?;
    let body = json!({
        "model": request.model_name,
        "messages": request.messages,
        "temperature": request.temperature.unwrap_or(0.7),
        "max_tokens": request.max_tokens.unwrap_or(8000),
    });
    let response = cancellation
        .run_until_cancelled(
            client
                .post(url)
                .bearer_auth(request.api_key.trim())
                .header("Content-Type", "application/json")
                .json(&body)
                .send(),
        )
        .await
        .ok_or_else(|| "AI 请求已取消".to_string())?
        .map_err(|error| {
            if error.is_timeout() {
                format!("AI 调用失败：请求超时（{timeout_seconds} 秒），请检查网络或增加超时时间。")
            } else if error.is_connect() {
                "AI 调用失败：网络连接失败，请检查 API Base URL、网络连接或代理设置。".to_string()
            } else {
                format!("AI 调用失败：网络请求失败：{error}")
            }
        })?;
    let status = response.status();
    let text_body = cancellation
        .run_until_cancelled(response.text())
        .await
        .ok_or_else(|| "AI 请求已取消".to_string())?
        .map_err(|error| format!("AI 调用失败：读取响应失败：{error}"))?;
    if !status.is_success() {
        return Err(user_error_from_status(
            status,
            &text_body,
            body["model"].as_str().unwrap_or(""),
        ));
    }
    let data: Value = serde_json::from_str(&text_body)
        .map_err(|error| format!("AI 调用失败：响应不是有效 JSON：{error}"))?;
    let content = data
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if content.trim().is_empty() {
        return Err("AI 调用失败：模型返回空内容，请检查提示词、模型名称或重试。".into());
    }
    let usage = data.get("usage");
    Ok(AiChatCompletionResponse {
        text: content,
        token_input: usage
            .and_then(|value| value.get("prompt_tokens"))
            .and_then(Value::as_i64),
        token_output: usage
            .and_then(|value| value.get("completion_tokens"))
            .and_then(Value::as_i64),
        total_tokens: usage
            .and_then(|value| value.get("total_tokens"))
            .and_then(Value::as_i64),
        raw: data,
    })
}
