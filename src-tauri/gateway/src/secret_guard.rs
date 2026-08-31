//! Credential-detection predicates for the gateway.
//!
//! SOURCE OF TRUTH: src-tauri/src/services/ai_fact_security.rs. This standalone
//! gateway crate cannot depend on the app's bin crate, so the two predicates
//! are mirrored here; the drift test below keeps the lists in sync. v3.2 should
//! extract a shared read-only crate and delete this copy.

use serde_json::Value;

fn secret_key(key: &str) -> bool {
    let normalized = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    [
        "apikey",
        "authorization",
        "accesstoken",
        "refreshtoken",
        "authtoken",
        "apitoken",
        "bearertoken",
        "sessiontoken",
        "password",
        "passphrase",
        "secret",
        "credential",
        "credentials",
        "cookie",
        "cookies",
        "privatekey",
    ]
    .iter()
    .any(|suffix| normalized.ends_with(suffix))
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
        || lower.contains("x_api_key")
        || lower.contains("xapikey")
        || lower.contains("openaiapikey")
        || lower.contains("api_key=")
        || lower.contains("apikey=")
        || lower.contains("api-key=")
        || lower.contains("credentials=")
        || lower.contains("\"credentials\"")
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Drift guard: every local secret-key entry must still exist in the app's
    /// ai_fact_security.rs source (the authoritative list).
    #[test]
    fn secret_key_list_matches_app_source() {
        let source = include_str!("../../src/services/ai_fact_security.rs");
        for entry in [
            "apikey",
            "authorization",
            "accesstoken",
            "refreshtoken",
            "authtoken",
            "apitoken",
            "bearertoken",
            "sessiontoken",
            "password",
            "passphrase",
            "secret",
            "credential",
            "credentials",
            "cookie",
            "cookies",
            "privatekey",
        ] {
            assert!(
                source.contains(&format!("\"{}\"", entry)),
                "secret key {} drifted from ai_fact_security.rs",
                entry
            );
        }
    }

    #[test]
    fn detects_credential_shapes() {
        assert!(contains_secret_text("Bearer abcdef"));
        assert!(contains_secret_text("Authorization: x"));
        assert!(contains_secret_text("sk-123456789012345678"));
        assert!(contains_secret_text("AKIA1234567890123456"));
        assert!(contains_secret_text("openaiApiKey=hidden"));
        assert!(!contains_secret_text("普通正文，没有任何凭据。"));
        for key in [
            "apiKey",
            "x-api-key",
            "xApiKey",
            "openaiApiKey",
            "credentials",
        ] {
            let mut value = serde_json::Map::new();
            value.insert("novelId".to_string(), serde_json::json!("n1"));
            value.insert(key.to_string(), serde_json::json!("sk-x"));
            assert!(contains_secret_value(&Value::Object(value)));
        }
    }
}
