use crate::errors::{codes, AppError};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Url};
use tauri_plugin_updater::{Update, UpdaterExt};
use time::format_description::well_known::Rfc3339;

const STABLE_ENDPOINT: &str =
    "https://github.com/Mon-Knight/AI-Novel-Studio/releases/download/updates-stable/latest.json";
const BETA_ENDPOINT: &str =
    "https://github.com/Mon-Knight/AI-Novel-Studio/releases/download/updates-beta/latest.json";
const PUBLIC_KEY_REPLACEMENT_SLOT: &str = "UPDATER_PUBLIC_KEY_REPLACED_IN_RELEASE_CI";
const MAX_RELEASE_NOTES_CHARS: usize = 4_000;
const UPDATE_STATUS_EVENT: &str = "tauri://update-status";
const UPDATE_PROGRESS_EVENT: &str = "tauri://update-download-progress";

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

    fn default_endpoint(self) -> &'static str {
        match self {
            Self::Stable => STABLE_ENDPOINT,
            Self::Beta => BETA_ENDPOINT,
        }
    }

    fn endpoint(self) -> String {
        #[cfg(feature = "update-e2e")]
        if let Ok(endpoint) = std::env::var("AI_NOVEL_STUDIO_UPDATE_ACCEPTANCE_ENDPOINT") {
            if !endpoint.trim().is_empty() {
                return endpoint.trim().to_string();
            }
        }
        self.default_endpoint().to_string()
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
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(|pubkey| pubkey.as_str())
        .is_some_and(public_key_is_configured)
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

fn check_error(error: tauri_plugin_updater::Error) -> AppError {
    let retryable = matches!(
        error,
        tauri_plugin_updater::Error::Network(_)
            | tauri_plugin_updater::Error::Reqwest(_)
            | tauri_plugin_updater::Error::ReleaseNotFound
    );
    let code = match error {
        tauri_plugin_updater::Error::Serialization(_)
        | tauri_plugin_updater::Error::Semver(_)
        | tauri_plugin_updater::Error::UrlParse(_)
        | tauri_plugin_updater::Error::TargetNotFound(_)
        | tauri_plugin_updater::Error::TargetsNotFound(_) => codes::APP_UPDATE_MANIFEST_INVALID,
        _ => codes::APP_UPDATE_CHECK_FAILED,
    };
    AppError::new(code, "更新检查失败", retryable)
}

fn install_error(_error: tauri_plugin_updater::Error) -> AppError {
    AppError::new(
        codes::APP_UPDATE_INSTALL_FAILED,
        "更新下载或签名校验失败",
        true,
    )
}

async fn fetch_channel_update(
    app: AppHandle,
    channel: UpdateChannel,
) -> Result<Option<Update>, AppError> {
    let endpoint = Url::parse(&channel.endpoint())
        .map_err(tauri_plugin_updater::Error::from)
        .map_err(check_error)?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(check_error)?
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(check_error)?;
    updater.check().await.map_err(check_error)
}

fn emit_update_status(app: &AppHandle, status: &str, error: Option<&str>) {
    let _ = app.emit(
        UPDATE_STATUS_EVENT,
        serde_json::json!({ "status": status, "error": error }),
    );
}

fn published_at_rfc3339(date: Option<time::OffsetDateTime>) -> Option<String> {
    date.and_then(|value| value.format(&Rfc3339).ok())
}

fn result_from_response(
    channel: UpdateChannel,
    response: Update,
) -> Result<AppUpdateCheckResult, AppError> {
    let current_version = response.current_version.clone();
    let latest_version = response.version.clone();
    if !channel.accepts_version(&latest_version) {
        return Err(AppError::new(
            codes::APP_UPDATE_MANIFEST_INVALID,
            "更新索引与所选通道不一致",
            false,
        ));
    }
    let release_notes = response
        .body
        .as_deref()
        .map(safe_release_notes)
        .filter(|body| !body.is_empty());

    Ok(AppUpdateCheckResult {
        channel: channel.as_str().to_string(),
        current_version,
        should_update: true,
        latest_version: Some(latest_version),
        published_at: published_at_rfc3339(response.date),
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

    let response = match fetch_channel_update(app.clone(), channel).await? {
        Some(response) => response,
        None => {
            return Err(AppError::new(
                codes::APP_UPDATE_NOT_AVAILABLE,
                "当前没有可安装的更新",
                false,
            ))
        }
    };
    if response.version != input.expected_version {
        return Err(AppError::new(
            codes::APP_UPDATE_CHANGED,
            "更新版本已变化，请重新检查",
            true,
        ));
    }

    emit_update_status(&app, "PENDING", None);
    let progress_app = app.clone();
    // The plugin calls its download-finished callback before verifying the
    // signature, so emit DOWNLOADED only after `download` returns successfully.
    let download_result = response
        .download(
            move |chunk_length, content_length| {
                let _ = progress_app.emit(
                    UPDATE_PROGRESS_EVENT,
                    serde_json::json!({
                        "chunkLength": chunk_length,
                        "contentLength": content_length,
                    }),
                );
            },
            || {},
        )
        .await;
    let bytes = match download_result {
        Ok(bytes) => bytes,
        Err(error) => {
            emit_update_status(&app, "ERROR", Some("APP_UPDATE_INSTALL_FAILED"));
            return Err(install_error(error));
        }
    };
    emit_update_status(&app, "DOWNLOADED", None);
    if let Err(error) = response.install(&bytes) {
        emit_update_status(&app, "ERROR", Some("APP_UPDATE_INSTALL_FAILED"));
        return Err(install_error(error));
    }
    // Windows normally exits after launching the installer, so this is
    // primarily for runtimes that return control to the application.
    emit_update_status(&app, "DONE", None);
    Ok(())
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
            UpdateChannel::Stable.default_endpoint(),
            UpdateChannel::Beta.default_endpoint()
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
    fn published_dates_remain_browser_compatible_rfc3339() {
        let date = time::macros::datetime!(2026-10-28 13:12:15.123 UTC);
        let formatted = published_at_rfc3339(Some(date)).unwrap();
        assert_eq!(formatted, "2026-10-28T13:12:15.123Z");
        assert!(time::OffsetDateTime::parse(&formatted, &Rfc3339).is_ok());
        assert_eq!(published_at_rfc3339(None), None);
    }

    #[test]
    fn release_build_public_key_slot_is_not_runtime_configuration() {
        assert!(!public_key_is_configured(""));
        assert!(!public_key_is_configured(PUBLIC_KEY_REPLACEMENT_SLOT));
        assert!(public_key_is_configured("RWQexample-public-key"));
    }
}

#[cfg(feature = "update-e2e")]
fn append_acceptance_log(path: &str, value: serde_json::Value) {
    use std::io::Write;

    let path = std::path::Path::new(path);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{value}");
        let _ = file.flush();
    }
}

#[cfg(feature = "update-e2e")]
pub fn start_update_acceptance(app: AppHandle) {
    let action = match std::env::var("AI_NOVEL_STUDIO_UPDATE_ACCEPTANCE_ACTION") {
        Ok(value) if value == "check" || value == "install" => value,
        _ => return,
    };
    let log_path = match std::env::var("AI_NOVEL_STUDIO_UPDATE_ACCEPTANCE_LOG") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => return,
    };
    let expected_version = std::env::var("AI_NOVEL_STUDIO_UPDATE_ACCEPTANCE_VERSION")
        .unwrap_or_default()
        .trim()
        .to_string();

    tauri::async_runtime::spawn(async move {
        let current_version = app.package_info().version.to_string();
        append_acceptance_log(
            &log_path,
            serde_json::json!({
                "phase": "started",
                "action": action,
                "currentVersion": current_version,
                "expectedVersion": expected_version,
            }),
        );

        if action == "install" && current_version == expected_version {
            append_acceptance_log(
                &log_path,
                serde_json::json!({
                    "phase": "already-installed",
                    "currentVersion": current_version,
                }),
            );
            app.exit(0);
            return;
        }

        let result = if action == "check" {
            check_app_update(
                app.clone(),
                CheckAppUpdateInput {
                    channel: "stable".to_string(),
                },
            )
            .await
            .map(|value| {
                serde_json::json!({
                    "phase": "check-complete",
                    "shouldUpdate": value.should_update,
                    "latestVersion": value.latest_version,
                })
            })
            .map_err(|error| error.message)
        } else {
            if expected_version.is_empty() {
                Err("AI_NOVEL_STUDIO_UPDATE_ACCEPTANCE_VERSION is required".to_string())
            } else {
                append_acceptance_log(
                    &log_path,
                    serde_json::json!({
                        "phase": "install-scheduled",
                        "expectedVersion": expected_version,
                    }),
                );
                install_app_update(
                    app.clone(),
                    InstallAppUpdateInput {
                        channel: "stable".to_string(),
                        expected_version,
                    },
                )
                .await
                .map(|_| serde_json::json!({ "phase": "install-returned" }))
                .map_err(|error| error.message)
            }
        };

        match result {
            Ok(value) => append_acceptance_log(&log_path, value),
            Err(error) => append_acceptance_log(
                &log_path,
                serde_json::json!({ "phase": "failed", "error": error }),
            ),
        }
        app.exit(0);
    });
}
