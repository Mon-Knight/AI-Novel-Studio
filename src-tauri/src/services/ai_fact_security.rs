use crate::errors::{codes, AppError};
use crate::repositories::large_text_repository;
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub const REQUEST_HASH_VERSION: i64 = 1;
const MAX_METADATA_BYTES: usize = 64 * 1024;

pub fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let ordered = map
                .iter()
                .map(|(key, child)| (key.clone(), canonicalize(child)))
                .collect::<BTreeMap<_, _>>();
            Value::Object(Map::from_iter(ordered))
        }
        Value::Array(items) => Value::Array(items.iter().map(canonicalize).collect()),
        _ => value.clone(),
    }
}

pub fn canonical_json(value: &Value) -> Result<String, AppError> {
    serde_json::to_string(&canonicalize(value)).map_err(|_| {
        AppError::new(
            codes::AI_TASK_INPUT_INVALID,
            "AI 执行元数据无法规范化",
            false,
        )
    })
}

pub fn canonical_hash(value: &Value) -> Result<String, AppError> {
    Ok(large_text_repository::sha256(&canonical_json(value)?))
}

fn secret_key(key: &str) -> bool {
    let normalized = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "apikey"
            | "authorization"
            | "accesstoken"
            | "refreshtoken"
            | "password"
            | "secret"
            | "clientsecret"
            | "credential"
            | "cookie"
            | "setcookie"
            | "privatekey"
    )
}

pub fn contains_secret_value(value: &Value) -> bool {
    match value {
        Value::Object(map) => map
            .iter()
            .any(|(key, child)| secret_key(key) || contains_secret_value(child)),
        Value::Array(items) => items.iter().any(contains_secret_value),
        Value::String(text) => contains_secret_text(text),
        _ => false,
    }
}

pub fn contains_secret_text(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    if lower.contains("bearer ")
        || lower.contains("authorization:")
        || lower.contains("x-api-key")
        || lower.contains("api_key=")
        || lower.contains("-----begin private key-----")
    {
        return true;
    }
    text.split(|character: char| character.is_whitespace() || "\"'=:,;()[]{}".contains(character))
        .any(|token| {
            (token.starts_with("sk-") && token.len() >= 19)
                || (token.starts_with("AKIA") && token.len() == 20)
        })
}

pub fn validate_metadata(value: &Value, label: &str) -> Result<(), AppError> {
    let serialized = canonical_json(value)?;
    if serialized.len() > MAX_METADATA_BYTES {
        return Err(AppError::new(
            codes::AI_TASK_INPUT_INVALID,
            format!("{label} 超过允许的元数据大小"),
            false,
        ));
    }
    if contains_secret_value(value) {
        return Err(AppError::new(
            codes::AI_TASK_SECRET_DETECTED,
            format!("{label} 包含凭据或授权信息"),
            false,
        ));
    }
    Ok(())
}

pub fn validate_body(text: &str, label: &str) -> Result<(), AppError> {
    if contains_secret_text(text) {
        return Err(AppError::new(
            codes::AI_TASK_SECRET_DETECTED,
            format!("{label} 包含疑似凭据或授权信息"),
            false,
        ));
    }
    Ok(())
}

pub fn validate_provider_options(value: &Value) -> Result<(), AppError> {
    validate_metadata(value, "Provider 选项")?;
    let Some(map) = value.as_object() else {
        return Err(AppError::new(
            codes::AI_TASK_INPUT_INVALID,
            "Provider 选项必须是对象",
            false,
        ));
    };
    const ALLOWED: &[&str] = &[
        "providerId",
        "model",
        "temperature",
        "topP",
        "maxTokens",
        "responseFormat",
        "seed",
        "stop",
        "frequencyPenalty",
        "presencePenalty",
        "reasoningEffort",
    ];
    for (key, child) in map {
        if !ALLOWED.contains(&key.as_str()) || child.is_object() {
            return Err(AppError::new(
                codes::AI_TASK_INPUT_INVALID,
                "Provider 选项包含未授权字段",
                false,
            )
            .with_details(serde_json::json!({ "field": key })));
        }
    }
    Ok(())
}

pub fn validate_response_metadata(value: &Value) -> Result<(), AppError> {
    validate_metadata(value, "Provider 响应元数据")?;
    let Some(map) = value.as_object() else {
        return Err(AppError::new(
            codes::AI_RESPONSE_METADATA_INVALID,
            "Provider 响应元数据必须是对象",
            false,
        ));
    };
    const ALLOWED: &[&str] = &[
        "provider",
        "model",
        "providerRequestId",
        "responseHash",
        "responseLength",
        "tokenInput",
        "tokenOutput",
        "tokenTotal",
        "finishReason",
        "durationMs",
    ];
    for (key, child) in map {
        let scalar_or_null =
            child.is_null() || child.is_boolean() || child.is_number() || child.is_string();
        if !ALLOWED.contains(&key.as_str()) || !scalar_or_null {
            return Err(AppError::new(
                codes::AI_RESPONSE_METADATA_INVALID,
                "Provider 响应元数据包含未授权字段",
                false,
            )
            .with_details(serde_json::json!({ "field": key })));
        }
        if child.as_str().is_some_and(|text| text.len() > 512) {
            return Err(AppError::new(
                codes::AI_RESPONSE_METADATA_INVALID,
                "Provider 响应元数据字段过长",
                false,
            ));
        }
    }
    Ok(())
}

pub fn validate_identifier(value: &str, label: &str, max_len: usize) -> Result<(), AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > max_len || contains_secret_text(trimmed) {
        return Err(AppError::new(
            codes::AI_TASK_INPUT_INVALID,
            format!("{label} 无效"),
            false,
        ));
    }
    Ok(())
}

pub fn safe_error_json(error: &AppError) -> Value {
    let message = if error.message.len() <= 512 && !contains_secret_text(&error.message) {
        error.message.clone()
    } else {
        "AI 执行失败，敏感详情未写入任务记录".to_string()
    };
    serde_json::json!({
        "code": error.code,
        "message": message,
        "retryable": error.retryable,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn security01_canonical_json_sorts_nested_keys() {
        let left = serde_json::json!({"z": 1, "a": {"y": 2, "b": 3}});
        let right = serde_json::json!({"a": {"b": 3, "y": 2}, "z": 1});
        assert_eq!(
            canonical_json(&left).unwrap(),
            canonical_json(&right).unwrap()
        );
    }

    #[test]
    fn security02_rejects_secret_keys_and_raw_bearer_values() {
        assert!(contains_secret_value(
            &serde_json::json!({"apiKey": "value"})
        ));
        assert!(contains_secret_text("Authorization: Bearer hidden"));
    }
}
