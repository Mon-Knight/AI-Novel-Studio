use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

const MAX_SESSION_CREDENTIALS: usize = 256;
const MAX_SCOPE_LEN: usize = 64;
const MAX_PROVIDER_ID_LEN: usize = 200;
const MAX_BASE_URL_LEN: usize = 2048;
const MAX_MODEL_ID_LEN: usize = 200;
const MAX_API_KEY_LEN: usize = 16_384;

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionModelCredentialIdentity {
    scope: String,
    provider_id: String,
    base_url: String,
    model_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSessionModelCredentialInput {
    identity: SessionModelCredentialIdentity,
    api_key: String,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct CredentialKey {
    scope: String,
    provider_id: String,
    base_url: String,
    model_id: String,
}

#[derive(Default)]
pub struct SessionCredentialVault {
    credentials: Mutex<HashMap<CredentialKey, String>>,
}

fn canonical_provider_id(provider_id: &str) -> String {
    let normalized = provider_id.trim().to_lowercase();
    if normalized == "deepseek" || normalized == "deepseek-official" {
        "deepseek-official".to_string()
    } else {
        normalized
    }
}

fn valid_single_line(value: &str, max_len: usize) -> bool {
    !value.is_empty() && value.len() <= max_len && !value.chars().any(char::is_control)
}

fn credential_key(identity: &SessionModelCredentialIdentity) -> Result<CredentialKey, String> {
    let scope = identity.scope.trim();
    if !valid_single_line(scope, MAX_SCOPE_LEN)
        || !matches!(scope, "provider" | "local_chapter_model" | "gateway")
    {
        return Err("会话凭据身份 scope 不受支持。".to_string());
    }
    let provider_id = canonical_provider_id(&identity.provider_id);
    let base_url = identity.base_url.trim().trim_end_matches('/').to_string();
    let model_id = identity.model_id.trim().to_string();
    if provider_id == "mock"
        || !valid_single_line(&provider_id, MAX_PROVIDER_ID_LEN)
        || !valid_single_line(&base_url, MAX_BASE_URL_LEN)
        || !valid_single_line(&model_id, MAX_MODEL_ID_LEN)
    {
        return Err("会话凭据身份不完整。".to_string());
    }
    Ok(CredentialKey {
        scope: scope.to_string(),
        provider_id,
        base_url,
        model_id,
    })
}

impl SessionCredentialVault {
    fn set(
        &self,
        identity: &SessionModelCredentialIdentity,
        api_key: String,
    ) -> Result<(), String> {
        let key = credential_key(identity)?;
        let mut credentials = self
            .credentials
            .lock()
            .map_err(|_| "会话凭据注册表暂时不可用。".to_string())?;
        let normalized = api_key.trim();
        if normalized.is_empty() {
            credentials.remove(&key);
        } else {
            if !valid_single_line(normalized, MAX_API_KEY_LEN) {
                return Err("会话凭据格式不合法。".to_string());
            }
            if !credentials.contains_key(&key) && credentials.len() >= MAX_SESSION_CREDENTIALS {
                return Err("会话凭据注册表容量已满。".to_string());
            }
            credentials.insert(key, normalized.to_string());
        }
        Ok(())
    }

    fn resolve(&self, identity: &SessionModelCredentialIdentity) -> Result<String, String> {
        let key = credential_key(identity)?;
        let credentials = self
            .credentials
            .lock()
            .map_err(|_| "会话凭据注册表暂时不可用。".to_string())?;
        Ok(credentials.get(&key).cloned().unwrap_or_default())
    }
}

#[tauri::command]
pub fn set_session_model_credential(
    state: State<'_, SessionCredentialVault>,
    input: SetSessionModelCredentialInput,
) -> Result<(), String> {
    state.set(&input.identity, input.api_key)
}

#[tauri::command]
pub fn resolve_session_model_credential(
    state: State<'_, SessionCredentialVault>,
    identity: SessionModelCredentialIdentity,
) -> Result<String, String> {
    state.resolve(&identity)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> SessionModelCredentialIdentity {
        SessionModelCredentialIdentity {
            scope: "provider".to_string(),
            provider_id: "deepseek".to_string(),
            base_url: "https://api.deepseek.com/v1/".to_string(),
            model_id: "deepseek-chat".to_string(),
        }
    }

    #[test]
    fn credential_is_bound_to_the_exact_normalized_identity() {
        let vault = SessionCredentialVault::default();
        vault
            .set(&identity(), " session-only-key ".to_string())
            .expect("store session credential");

        let mut alias = identity();
        alias.provider_id = "deepseek-official".to_string();
        alias.base_url = "https://api.deepseek.com/v1".to_string();
        assert_eq!(
            vault.resolve(&alias).expect("resolve alias"),
            "session-only-key"
        );

        let mut wrong_scope = alias.clone();
        wrong_scope.scope = "gateway".to_string();
        assert_eq!(
            vault.resolve(&wrong_scope).expect("resolve wrong scope"),
            ""
        );

        let mut wrong_endpoint = alias.clone();
        wrong_endpoint.base_url = "https://other.invalid/v1".to_string();
        assert_eq!(
            vault
                .resolve(&wrong_endpoint)
                .expect("resolve wrong endpoint"),
            ""
        );

        let mut wrong_model = alias;
        wrong_model.model_id = "deepseek-reasoner".to_string();
        assert_eq!(
            vault.resolve(&wrong_model).expect("resolve wrong model"),
            ""
        );
    }

    #[test]
    fn empty_value_removes_only_the_matching_credential() {
        let vault = SessionCredentialVault::default();
        let first = identity();
        let mut second = identity();
        second.model_id = "deepseek-reasoner".to_string();
        vault
            .set(&first, "first-key".to_string())
            .expect("store first credential");
        vault
            .set(&second, "second-key".to_string())
            .expect("store second credential");

        vault
            .set(&first, "   ".to_string())
            .expect("remove first credential");

        assert_eq!(
            vault.resolve(&first).expect("resolve removed credential"),
            ""
        );
        assert_eq!(
            vault.resolve(&second).expect("resolve retained credential"),
            "second-key"
        );
    }

    #[test]
    fn a_new_application_vault_starts_empty() {
        let first_process = SessionCredentialVault::default();
        first_process
            .set(&identity(), "process-only-key".to_string())
            .expect("store process credential");
        assert_eq!(
            first_process
                .resolve(&identity())
                .expect("resolve process credential"),
            "process-only-key"
        );

        let next_process = SessionCredentialVault::default();
        assert_eq!(
            next_process
                .resolve(&identity())
                .expect("resolve new process credential"),
            ""
        );
    }

    #[test]
    fn invalid_identity_is_rejected_without_echoing_input() {
        let vault = SessionCredentialVault::default();
        let mut invalid = identity();
        invalid.scope = "unknown-secret-scope".to_string();
        let error = vault
            .set(&invalid, "must-not-appear-in-errors".to_string())
            .expect_err("invalid scope must fail");
        assert!(!error.contains("must-not-appear-in-errors"));
        assert!(!error.contains("unknown-secret-scope"));
    }

    #[test]
    fn oversized_or_multiline_values_are_rejected() {
        let vault = SessionCredentialVault::default();
        let oversized = "x".repeat(MAX_API_KEY_LEN + 1);
        assert!(vault.set(&identity(), oversized).is_err());
        assert!(vault
            .set(&identity(), "line-one\nline-two".to_string())
            .is_err());

        let mut multiline_identity = identity();
        multiline_identity.model_id = "model\nother".to_string();
        assert!(vault.resolve(&multiline_identity).is_err());
    }
}
