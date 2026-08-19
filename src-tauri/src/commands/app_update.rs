use crate::errors::{codes, AppError};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Wry};

const STABLE_ENDPOINT: &str =
    "https://github.com/Mon-Knight/AI-Novel-Studio/releases/download/updates-stable/latest.json";
const BETA_ENDPOINT: &str =
    "https://github.com/Mon-Knight/AI-Novel-Studio/releases/download/updates-beta/latest.json";
const PUBLIC_KEY_REPLACEMENT_SLOT: &str = "UPDATER_PUBLIC_KEY_REPLACED_IN_RELEASE_CI";
const MAX_RELEASE_NOTES_CHARS: usize = 4_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UpdateChannel {
    Stable,
    Beta,
}

impl UpdateChannel {
    fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "stable" => Ok(Self::Stable),
            "beta" => Ok(Self::Beta),
            _ => Err(AppError::new(
                codes::APP_UPDATE_CHANNEL_INVALID,
                "更新通道无效",
                false,
            )),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Beta => "beta",
        }
    }

    fn endpoint(self) -> &'static str {
        match self {
            Self::Stable => STABLE_ENDPOINT,
            Self::Beta => BETA_ENDPOINT,
        }
    }

    fn accepts_version(self, version: &str) -> bool {
        let without_build_metadata = version.split('+').next().unwrap_or(version);
        let is_prerelease = without_build_metadata.contains('-');
        match self {
            Self::Stable => !is_prerelease,
            Self::Beta => is_prerelease,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckAppUpdateInput {
    pub channel: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallAppUpdateInput {
    pub channel: String,
    pub expected_version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateCapabilities {
    pub supported_platform: bool,
    pub updater_configured: bool,
    pub current_version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateCheckResult {
    pub channel: String,
    pub current_version: String,
    pub should_update: bool,
    pub latest_version: Option<String>,
    pub published_at: Option<String>,
    pub release_notes: Option<String>,
}

fn public_key_is_configured(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty() && value != PUBLIC_KEY_REPLACEMENT_SLOT
}

fn updater_is_configured(app: &AppHandle) -> bool {
    let updater = &app.config().tauri.updater;
    updater.active && public_key_is_configured(&updater.pubkey)
}

fn ensure_updater_ready(app: &AppHandle) -> Result<(), AppError> {
    if !cfg!(target_os = "windows") {
        return Err(AppError::new(
            codes::APP_UPDATE_PLATFORM_UNSUPPORTED,
            "当前平台未启用桌面更新",
            false,
        ));
    }
    if !updater_is_configured(app) {
        return Err(AppError::new(
            codes::APP_UPDATE_NOT_CONFIGURED,
            "当前安装包未注入更新签名配置",
            false,
        ));
    }
    Ok(())
}

fn safe_release_notes(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control() || matches!(*character, '\n' | '\r' | '\t'))
        .take(MAX_RELEASE_NOTES_CHARS)
        .collect::<String>()
        .trim()
        .to_string()
}

fn check_error(error: tauri::updater::Error) -> AppError {
    let retryable = matches!(
        error,
        tauri::updater::Error::Network(_) | tauri::updater::Error::ReleaseNotFound
    );
    let code = match error {
        tauri::updater::Error::SerdeJson(_)
        | tauri::updater::Error::Semver(_)
        | tauri::updater::Error::TargetNotFound(_)
        | tauri::updater::Error::InvalidResponseType(_, _, _) => codes::APP_UPDATE_MANIFEST_INVALID,
        _ => codes::APP_UPDATE_CHECK_FAILED,
    };
    AppError::new(code, "更新检查失败", retryable)
}

fn install_error(_error: tauri::updater::Error) -> AppError {
    AppError::new(
        codes::APP_UPDATE_INSTALL_FAILED,
        "更新下载或签名校验失败",
        true,
    )
}

async fn fetch_channel_update(
    app: AppHandle,
    channel: UpdateChannel,
) -> Result<Option<tauri::updater::UpdateResponse<Wry>>, AppError> {
    let endpoints = vec![channel.endpoint().to_string()];
    match tauri::updater::builder(app)
        .skip_events()
        .endpoints(&endpoints)
        .timeout(Duration::from_secs(20))
        .check()
        .await
    {
        Ok(response) => Ok(Some(response)),
        Err(tauri::updater::Error::UpToDate) => Ok(None),
        Err(error) => Err(check_error(error)),
    }
}

fn result_from_response(
    channel: UpdateChannel,
    response: tauri::updater::UpdateResponse<Wry>,
) -> Result<AppUpdateCheckResult, AppError> {
    let current_version = response.current_version().to_string();
    if !response.is_update_available() {
        return Ok(AppUpdateCheckResult {
            channel: channel.as_str().to_string(),
            current_version,
            should_update: false,
            latest_version: None,
            published_at: None,
            release_notes: None,
        });
    }

    let latest_version = response.latest_version().to_string();
    if !channel.accepts_version(&latest_version) {
        return Err(AppError::new(
            codes::APP_UPDATE_MANIFEST_INVALID,
            "更新索引与所选通道不一致",
            false,
        ));
    }
    let release_notes = response
        .body()
        .map(|body| safe_release_notes(body))
        .filter(|body| !body.is_empty());

    Ok(AppUpdateCheckResult {
        channel: channel.as_str().to_string(),
        current_version,
        should_update: true,
        latest_version: Some(latest_version),
        published_at: response.date().map(ToString::to_string),
        release_notes,
    })
}

#[tauri::command]
pub fn get_app_update_capabilities(app: AppHandle) -> AppUpdateCapabilities {
    AppUpdateCapabilities {
        supported_platform: cfg!(target_os = "windows"),
        updater_configured: updater_is_configured(&app),
        current_version: app.package_info().version.to_string(),
    }
}

#[tauri::command]
pub async fn check_app_update(
    app: AppHandle,
    input: CheckAppUpdateInput,
) -> Result<AppUpdateCheckResult, AppError> {
    ensure_updater_ready(&app)?;
    let channel = UpdateChannel::parse(&input.channel)?;
    match fetch_channel_update(app.clone(), channel).await? {
        Some(response) => result_from_response(channel, response),
        None => Ok(AppUpdateCheckResult {
            channel: channel.as_str().to_string(),
            current_version: app.package_info().version.to_string(),
            should_update: false,
            latest_version: None,
            published_at: None,
            release_notes: None,
        }),
    }
}

#[tauri::command]
pub async fn install_app_update(
    app: AppHandle,
    input: InstallAppUpdateInput,
) -> Result<(), AppError> {
    ensure_updater_ready(&app)?;
    let channel = UpdateChannel::parse(&input.channel)?;
    if input.expected_version.len() > 64 || !channel.accepts_version(&input.expected_version) {
        return Err(AppError::new(
            codes::APP_UPDATE_MANIFEST_INVALID,
            "待安装版本与更新通道不一致",
            false,
        ));
    }

    let response = match fetch_channel_update(app, channel).await? {
        Some(response) => response,
        None => {
            return Err(AppError::new(
                codes::APP_UPDATE_NOT_AVAILABLE,
                "当前没有可安装的更新",
                false,
            ))
        }
    };
    if !response.is_update_available() {
        return Err(AppError::new(
            codes::APP_UPDATE_NOT_AVAILABLE,
            "当前没有可安装的更新",
            false,
        ));
    }
    if response.latest_version() != input.expected_version {
        return Err(AppError::new(
            codes::APP_UPDATE_CHANGED,
            "更新版本已变化，请重新检查",
            true,
        ));
    }

    response.download_and_install().await.map_err(install_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channels_are_explicit_and_isolated() {
        assert_eq!(
            UpdateChannel::parse("stable").unwrap(),
            UpdateChannel::Stable
        );
        assert_eq!(UpdateChannel::parse("beta").unwrap(), UpdateChannel::Beta);
        assert!(UpdateChannel::parse("nightly").is_err());
        assert!(UpdateChannel::Stable.accepts_version("3.1.0"));
        assert!(!UpdateChannel::Stable.accepts_version("3.1.0-beta.1"));
        assert!(UpdateChannel::Beta.accepts_version("3.1.0-beta.1"));
        assert!(!UpdateChannel::Beta.accepts_version("3.1.0"));
        assert_ne!(
            UpdateChannel::Stable.endpoint(),
            UpdateChannel::Beta.endpoint()
        );
    }

    #[test]
    fn release_notes_are_bounded_and_remove_unsafe_controls() {
        let notes = format!("line one\0\n{}", "x".repeat(MAX_RELEASE_NOTES_CHARS + 50));
        let safe = safe_release_notes(&notes);
        assert!(!safe.contains('\0'));
        assert!(safe.contains('\n'));
        assert!(safe.chars().count() <= MAX_RELEASE_NOTES_CHARS);
    }

    #[test]
    fn release_build_public_key_slot_is_not_runtime_configuration() {
        assert!(!public_key_is_configured(""));
        assert!(!public_key_is_configured(PUBLIC_KEY_REPLACEMENT_SLOT));
        assert!(public_key_is_configured("RWQexample-public-key"));
    }
}
