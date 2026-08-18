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
        "topK",
        "repeatPenalty",
        "maxTokens",
        "responseFormat",
        "seed",
        "stop",
        "frequencyPenalty",
        "presencePenalty",
        "reasoningEffort",
        "thinkingMode",
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

fn validate_response_cost_metadata(map: &Map<String, Value>) -> Result<(), AppError> {
    const COST_FIELDS: &[&str] = &[
        "costStatus",
        "costCurrency",
        "pricingSource",
        "costEstimate",
        "inputPricePerMillionTokens",
        "outputPricePerMillionTokens",
    ];
    if !COST_FIELDS.iter().any(|field| map.contains_key(*field)) {
        return Ok(());
    }

    let status = map.get("costStatus").and_then(Value::as_str);
    let currency = map.get("costCurrency").and_then(Value::as_str);
    let source = map.get("pricingSource").and_then(Value::as_str);
    if !matches!(
        status,
        Some("complete" | "mock" | "unpriced" | "usage_missing")
    ) || currency != Some("USD")
        || !matches!(source, Some("user_configured" | "mock" | "unconfigured"))
    {
        return Err(AppError::new(
            codes::AI_RESPONSE_METADATA_INVALID,
            "Provider 成本元数据 identity 无效",
            false,
        ));
    }

    for key in [
        "costEstimate",
        "inputPricePerMillionTokens",
        "outputPricePerMillionTokens",
    ] {
        if let Some(number) = map.get(key) {
            let Some(number) = number.as_f64() else {
                return Err(AppError::new(
                    codes::AI_RESPONSE_METADATA_INVALID,
                    "Provider 成本元数据数值无效",
                    false,
                ));
            };
            if !number.is_finite() || !(0.0..=1_000_000.0).contains(&number) {
                return Err(AppError::new(
                    codes::AI_RESPONSE_METADATA_INVALID,
                    "Provider 成本元数据超出范围",
                    false,
                ));
            }
        }
    }

    let cost_estimate = map.get("costEstimate").and_then(Value::as_f64);
    let input_rate = map
        .get("inputPricePerMillionTokens")
        .and_then(Value::as_f64);
    let output_rate = map
        .get("outputPricePerMillionTokens")
        .and_then(Value::as_f64);
    let valid_status_fields = match status {
        Some("complete") => {
            source == Some("user_configured")
                && cost_estimate.is_some()
                && input_rate.is_some()
                && output_rate.is_some()
        }
        Some("mock") => {
            source == Some("mock")
                && cost_estimate == Some(0.0)
                && input_rate == Some(0.0)
                && output_rate == Some(0.0)
        }
        Some("unpriced") => {
            source == Some("unconfigured")
                && cost_estimate.is_none()
                && (input_rate.is_none() || output_rate.is_none())
        }
        Some("usage_missing") => {
            source == Some("user_configured")
                && cost_estimate.is_none()
                && input_rate.is_some()
                && output_rate.is_some()
        }
        _ => false,
    };
    if !valid_status_fields {
        return Err(AppError::new(
            codes::AI_RESPONSE_METADATA_INVALID,
            "Provider 成本元数据与计量状态不一致",
            false,
        ));
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
        "costStatus",
        "costCurrency",
        "pricingSource",
        "costEstimate",
        "inputPricePerMillionTokens",
        "outputPricePerMillionTokens",
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
    for field in [
        "responseLength",
        "tokenInput",
        "tokenOutput",
        "tokenTotal",
        "durationMs",
    ] {
        if let Some(value) = map.get(field) {
            let non_negative_integer = value.as_i64().is_some_and(|number| number >= 0);
            if !non_negative_integer {
                return Err(AppError::new(
                    codes::AI_RESPONSE_METADATA_INVALID,
                    "Provider 响应计数元数据必须是非负整数",
                    false,
                )
                .with_details(serde_json::json!({ "field": field })));
            }
        }
    }
    validate_response_cost_metadata(map)?;
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

    fn complete_cost_metadata() -> Value {
        serde_json::json!({
            "costStatus": "complete",
            "costCurrency": "USD",
            "pricingSource": "user_configured",
            "costEstimate": 1.5,
            "inputPricePerMillionTokens": 2.0,
            "outputPricePerMillionTokens": 8.0,
        })
    }

    fn mock_cost_metadata() -> Value {
        serde_json::json!({
            "costStatus": "mock",
            "costCurrency": "USD",
            "pricingSource": "mock",
            "costEstimate": 0.0,
            "inputPricePerMillionTokens": 0.0,
            "outputPricePerMillionTokens": 0.0,
        })
    }

    fn set_field(mut metadata: Value, field: &str, value: Value) -> Value {
        metadata
            .as_object_mut()
            .expect("test metadata must be an object")
            .insert(field.to_string(), value);
        metadata
    }

    fn assert_response_cost_invalid(metadata: Value) {
        let error = validate_response_metadata(&metadata)
            .expect_err("tampered cost metadata must be rejected");
        assert_eq!(error.code, codes::AI_RESPONSE_METADATA_INVALID);
    }

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

    #[test]
    fn security03_provider_options_reject_response_cost_fields() {
        let error = validate_provider_options(&serde_json::json!({
            "model": "model-a",
            "costStatus": "complete",
        }))
        .expect_err("response cost fields must not be accepted as provider options");
        assert_eq!(error.code, codes::AI_TASK_INPUT_INVALID);
    }

    #[test]
    fn security04_accepts_valid_cost_status_shapes() {
        for metadata in [
            complete_cost_metadata(),
            mock_cost_metadata(),
            serde_json::json!({
                "costStatus": "unpriced",
                "costCurrency": "USD",
                "pricingSource": "unconfigured",
                "inputPricePerMillionTokens": 2.0,
            }),
            serde_json::json!({
                "costStatus": "usage_missing",
                "costCurrency": "USD",
                "pricingSource": "user_configured",
                "inputPricePerMillionTokens": 2.0,
                "outputPricePerMillionTokens": 8.0,
            }),
        ] {
            validate_response_metadata(&metadata).expect("valid cost metadata must be accepted");
        }
    }

    #[test]
    fn security05_rejects_invalid_cost_identity() {
        for metadata in [
            set_field(
                complete_cost_metadata(),
                "costStatus",
                serde_json::json!("unknown"),
            ),
            set_field(
                complete_cost_metadata(),
                "costCurrency",
                serde_json::json!("EUR"),
            ),
            set_field(
                complete_cost_metadata(),
                "pricingSource",
                serde_json::json!("provider_reported"),
            ),
            set_field(
                complete_cost_metadata(),
                "pricingSource",
                serde_json::json!("mock"),
            ),
        ] {
            assert_response_cost_invalid(metadata);
        }
    }

    #[test]
    fn security06_rejects_invalid_cost_rates() {
        for rate in [
            serde_json::json!(-0.01),
            serde_json::json!(1_000_000.01),
            serde_json::json!("2.0"),
        ] {
            assert_response_cost_invalid(set_field(
                complete_cost_metadata(),
                "inputPricePerMillionTokens",
                rate,
            ));
        }
    }

    #[test]
    fn security07_complete_cost_requires_estimate_and_frozen_rates() {
        for field in [
            "costEstimate",
            "inputPricePerMillionTokens",
            "outputPricePerMillionTokens",
        ] {
            let mut metadata = complete_cost_metadata();
            metadata
                .as_object_mut()
                .expect("test metadata must be an object")
                .remove(field);
            assert_response_cost_invalid(metadata);
        }
    }

    #[test]
    fn security08_mock_cost_and_frozen_rates_must_be_zero() {
        for field in [
            "costEstimate",
            "inputPricePerMillionTokens",
            "outputPricePerMillionTokens",
        ] {
            assert_response_cost_invalid(set_field(
                mock_cost_metadata(),
                field,
                serde_json::json!(0.01),
            ));
        }
    }

    #[test]
    fn security09_response_counts_require_non_negative_json_integers() {
        validate_response_metadata(&serde_json::json!({
            "responseLength": 0,
            "tokenInput": 1,
            "tokenOutput": 2,
            "tokenTotal": 3,
            "durationMs": 4,
        }))
        .expect("non-negative integer response counts must be accepted");

        for field in [
            "responseLength",
            "tokenInput",
            "tokenOutput",
            "tokenTotal",
            "durationMs",
        ] {
            for invalid in [
                serde_json::json!(-1),
                serde_json::json!(1.5),
                serde_json::json!("1"),
                serde_json::json!(true),
                Value::Null,
            ] {
                assert_response_cost_invalid(set_field(serde_json::json!({}), field, invalid));
            }
        }
    }
}
