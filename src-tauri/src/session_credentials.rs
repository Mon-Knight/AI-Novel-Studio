use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

const MAX_SESSION_CREDENTIALS: usize = 256;
const MAX_SCOPE_LEN: usize = 64;
const MAX_PROVIDER_ID_LEN: usize = 200;
const MAX_BASE_URL_LEN: usize = 2048;
const MAX_MODEL_ID_LEN: usize = 200;
const MAX_API_KEY_LEN: usize = 16_384;
const MAX_PERSISTED_BYTES: usize = 8 * 1024 * 1024;
const PERSIST_FILE_NAME: &str = "session-model-credentials.dpapi";
const PERSIST_VERSION: u32 = 1;
const PROTECT_ENTROPY: &[u8] = b"ai-novel-studio.session-model-credentials.v1";

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

#[derive(Serialize, Deserialize)]
struct PersistedVaultFile {
    version: u32,
    credentials: Vec<PersistedCredentialRecord>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedCredentialRecord {
    scope: String,
    provider_id: String,
    base_url: String,
    model_id: String,
    api_key: String,
}

pub struct SessionCredentialVault {
    credentials: Mutex<HashMap<CredentialKey, String>>,
    persist_path: PathBuf,
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

fn unavailable() -> String {
    "会话凭据注册表暂时不可用。".to_string()
}

fn persist_write_error() -> String {
    "会话凭据无法保存。".to_string()
}

fn persist_read_error() -> String {
    "会话凭据无法读取。".to_string()
}

fn staging_path(path: &Path) -> PathBuf {
    let mut staging = path.as_os_str().to_os_string();
    staging.push(".tmp");
    PathBuf::from(staging)
}

fn encode_credentials(credentials: &HashMap<CredentialKey, String>) -> Result<Vec<u8>, String> {
    let file = PersistedVaultFile {
        version: PERSIST_VERSION,
        credentials: credentials
            .iter()
            .map(|(key, api_key)| PersistedCredentialRecord {
                scope: key.scope.clone(),
                provider_id: key.provider_id.clone(),
                base_url: key.base_url.clone(),
                model_id: key.model_id.clone(),
                api_key: api_key.clone(),
            })
            .collect(),
    };
    serde_json::to_vec(&file).map_err(|_| persist_write_error())
}

fn decode_credentials(bytes: &[u8]) -> Result<HashMap<CredentialKey, String>, String> {
    let file: PersistedVaultFile =
        serde_json::from_slice(bytes).map_err(|_| persist_read_error())?;
    if file.version != PERSIST_VERSION {
        return Err(persist_read_error());
    }
    let mut credentials = HashMap::new();
    for record in file.credentials {
        if credentials.len() >= MAX_SESSION_CREDENTIALS {
            break;
        }
        let identity = SessionModelCredentialIdentity {
            scope: record.scope,
            provider_id: record.provider_id,
            base_url: record.base_url,
            model_id: record.model_id,
        };
        let Ok(key) = credential_key(&identity) else {
            continue;
        };
        let api_key = record.api_key.trim();
        if !valid_single_line(api_key, MAX_API_KEY_LEN) {
            continue;
        }
        credentials.insert(key, api_key.to_string());
    }
    Ok(credentials)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|_| persist_write_error())?;
    }
    let staging = staging_path(path);
    fs::write(&staging, bytes).map_err(|_| persist_write_error())?;
    if path.exists() {
        fs::remove_file(path).map_err(|_| persist_write_error())?;
    }
    match fs::rename(&staging, path) {
        Ok(()) => Ok(()),
        Err(_) => {
            let _ = fs::remove_file(&staging);
            Err(persist_write_error())
        }
    }
}

fn remove_persist_file(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(persist_write_error()),
    }
}

#[cfg(windows)]
fn protect_bytes(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: plaintext.len() as u32,
        pbData: plaintext.as_ptr().cast_mut(),
    };
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: PROTECT_ENTROPY.len() as u32,
        pbData: PROTECT_ENTROPY.as_ptr().cast_mut(),
    };
    let description: Vec<u16> = "AI Novel Studio session credentials"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // SAFETY: input/entropy point at live buffers for the duration of the call;
    // output is zeroed and only read after CryptProtectData succeeds.
    let ok = unsafe {
        CryptProtectData(
            &input,
            description.as_ptr(),
            &entropy,
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(persist_write_error());
    }
    let bytes = if output.pbData.is_null() || output.cbData == 0 {
        Vec::new()
    } else {
        // SAFETY: CryptProtectData allocated output.pbData with output.cbData bytes.
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() }
    };
    if !output.pbData.is_null() {
        // SAFETY: pbData came from CryptProtectData and must be freed with LocalFree.
        unsafe {
            LocalFree(output.pbData.cast());
        }
    }
    Ok(bytes)
}

#[cfg(windows)]
fn unprotect_bytes(protected: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: protected.len() as u32,
        pbData: protected.as_ptr().cast_mut(),
    };
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: PROTECT_ENTROPY.len() as u32,
        pbData: PROTECT_ENTROPY.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // SAFETY: input/entropy point at live buffers for the duration of the call;
    // output is zeroed and only read after CryptUnprotectData succeeds.
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            &entropy,
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(persist_read_error());
    }
    let bytes = if output.pbData.is_null() || output.cbData == 0 {
        Vec::new()
    } else {
        // SAFETY: CryptUnprotectData allocated output.pbData with output.cbData bytes.
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() }
    };
    if !output.pbData.is_null() {
        // SAFETY: pbData came from CryptUnprotectData and must be freed with LocalFree.
        unsafe {
            LocalFree(output.pbData.cast());
        }
    }
    Ok(bytes)
}

#[cfg(not(windows))]
fn protect_bytes(_plaintext: &[u8]) -> Result<Vec<u8>, String> {
    Err(persist_write_error())
}

#[cfg(not(windows))]
fn unprotect_bytes(_protected: &[u8]) -> Result<Vec<u8>, String> {
    Err(persist_read_error())
}

impl SessionCredentialVault {
    pub fn from_app_data_dir(app_data_dir: &Path) -> Self {
        Self::from_path(app_data_dir.join(PERSIST_FILE_NAME))
    }

    pub fn from_path(path: impl AsRef<Path>) -> Self {
        let vault = Self {
            credentials: Mutex::new(HashMap::new()),
            persist_path: path.as_ref().to_path_buf(),
        };
        let _ = vault.load();
        vault
    }

    fn load(&self) -> Result<(), String> {
        let loaded = self.read_persisted()?;
        let mut credentials = self.credentials.lock().map_err(|_| unavailable())?;
        *credentials = loaded;
        Ok(())
    }

    fn save(&self) -> Result<(), String> {
        let credentials = self.credentials.lock().map_err(|_| unavailable())?;
        self.save_locked(&credentials)
    }

    fn read_persisted(&self) -> Result<HashMap<CredentialKey, String>, String> {
        let bytes = match fs::read(&self.persist_path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(HashMap::new()),
            Err(_) => return Err(persist_read_error()),
        };
        if bytes.is_empty() {
            return Ok(HashMap::new());
        }
        if bytes.len() > MAX_PERSISTED_BYTES {
            return Err(persist_read_error());
        }
        let plaintext = unprotect_bytes(&bytes)?;
        decode_credentials(&plaintext)
    }

    fn save_locked(&self, credentials: &HashMap<CredentialKey, String>) -> Result<(), String> {
        if credentials.is_empty() {
            return remove_persist_file(&self.persist_path);
        }
        let plaintext = encode_credentials(credentials)?;
        let protected = protect_bytes(&plaintext)?;
        write_atomic(&self.persist_path, &protected)
    }

    fn set(
        &self,
        identity: &SessionModelCredentialIdentity,
        api_key: String,
    ) -> Result<(), String> {
        let key = credential_key(identity)?;
        let mut credentials = self.credentials.lock().map_err(|_| unavailable())?;
        let snapshot = credentials.clone();
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
        if let Err(error) = self.save_locked(&credentials) {
            *credentials = snapshot;
            return Err(error);
        }
        Ok(())
    }

    fn resolve(&self, identity: &SessionModelCredentialIdentity) -> Result<String, String> {
        let key = credential_key(identity)?;
        let credentials = self.credentials.lock().map_err(|_| unavailable())?;
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

    struct PersistPath(PathBuf);

    impl PersistPath {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!(
                "ai-novel-studio-session-credentials-{}-{}.dpapi",
                std::process::id(),
                uuid::Uuid::new_v4()
            )))
        }
    }

    impl Drop for PersistPath {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
            let _ = fs::remove_file(staging_path(&self.0));
        }
    }

    fn identity() -> SessionModelCredentialIdentity {
        SessionModelCredentialIdentity {
            scope: "provider".to_string(),
            provider_id: "deepseek".to_string(),
            base_url: "https://api.deepseek.com/v1/".to_string(),
            model_id: "deepseek-chat".to_string(),
        }
    }

    fn isolated_vault() -> (PersistPath, SessionCredentialVault) {
        let persist = PersistPath::new();
        let vault = SessionCredentialVault::from_path(&persist.0);
        (persist, vault)
    }

    #[test]
    fn credential_is_bound_to_the_exact_normalized_identity() {
        let (_persist, vault) = isolated_vault();
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
        let (_persist, vault) = isolated_vault();
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
    fn persist_and_reload_into_a_new_vault_recovers_the_key() {
        let persist = PersistPath::new();
        {
            let vault = SessionCredentialVault::from_path(&persist.0);
            vault
                .set(&identity(), " persisted-key ".to_string())
                .expect("store persisted credential");
            vault.save().expect("flush persisted credential");
            assert_eq!(
                vault.resolve(&identity()).expect("resolve before reload"),
                "persisted-key"
            );
        }

        let reloaded = SessionCredentialVault {
            credentials: Mutex::new(HashMap::new()),
            persist_path: persist.0.clone(),
        };
        reloaded.load().expect("load persisted credential");
        let mut alias = identity();
        alias.provider_id = "deepseek-official".to_string();
        alias.base_url = "https://api.deepseek.com/v1".to_string();
        assert_eq!(
            reloaded
                .resolve(&alias)
                .expect("resolve reloaded credential"),
            "persisted-key"
        );
    }

    #[test]
    fn empty_key_deletes_persisted_credential() {
        let persist = PersistPath::new();
        let vault = SessionCredentialVault::from_path(&persist.0);
        vault
            .set(&identity(), "delete-me".to_string())
            .expect("store credential to delete");
        vault
            .set(&identity(), "".to_string())
            .expect("delete credential with empty key");
        vault.save().expect("flush deleted credential");

        let reloaded = SessionCredentialVault::from_path(&persist.0);
        assert_eq!(
            reloaded
                .resolve(&identity())
                .expect("resolve deleted persisted credential"),
            ""
        );
    }

    #[test]
    fn invalid_identity_is_rejected_without_echoing_input() {
        let (_persist, vault) = isolated_vault();
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
        let (_persist, vault) = isolated_vault();
        let oversized = "x".repeat(MAX_API_KEY_LEN + 1);
        assert!(vault.set(&identity(), oversized).is_err());
        assert!(vault
            .set(
                &identity(),
                "line-one
line-two"
                    .to_string()
            )
            .is_err());

        let mut multiline_identity = identity();
        multiline_identity.model_id = "model
other"
            .to_string();
        assert!(vault.resolve(&multiline_identity).is_err());
    }
}
