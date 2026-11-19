use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[cfg(feature = "e2e")]
#[path = "legacy_local_storage_e2e.rs"]
mod e2e;
#[cfg(feature = "e2e")]
pub use e2e::*;
#[cfg(test)]
#[path = "legacy_local_storage_tests.rs"]
mod tests;

pub const LEGACY_STORAGE_MIGRATION_WINDOW_LABEL: &str = "legacy-storage-migration";
const LEGACY_STORAGE_ORIGIN: &str = "http://tauri.localhost";
const LEGACY_STORAGE_PAGE: &str = "/legacy-storage-migration.html";
const COMPLETION_FILE: &str = "legacy-local-storage-migration-v1.json";
const APPLICATION_STORAGE_PREFIX: &str = "ai_novel_studio_";
const MAX_ENTRIES: usize = 2_048;
const MAX_KEY_BYTES: usize = 512;
const MAX_VALUE_BYTES: usize = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 16 * 1024 * 1024;
const PROBE_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyStorageEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageLegacyStorageInput {
    pub origin: String,
    pub entries: Vec<LegacyStorageEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteLegacyStorageInput {
    pub migrated_entries: usize,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyStorageMigrationSnapshot {
    pub phase: &'static str,
    pub entries: Vec<LegacyStorageEntry>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyStorageProbeStatus {
    pub applied: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompletionMarker {
    schema_version: u32,
    completed_at: String,
    migrated_entries: usize,
    source_origin: String,
}

struct Inner {
    data_dir: PathBuf,
    ready: AtomicBool,
    applied: AtomicBool,
    entries: Mutex<Option<Vec<LegacyStorageEntry>>>,
    error: Mutex<Option<String>>,
    #[cfg(feature = "e2e")]
    e2e_seed_completed: AtomicBool,
    #[cfg(feature = "e2e")]
    e2e_probe_entries: Mutex<Option<Vec<LegacyStorageEntry>>>,
    #[cfg(feature = "e2e")]
    e2e_seed_requested: AtomicBool,
    #[cfg(feature = "e2e")]
    e2e_probe_requested: AtomicBool,
}

#[derive(Clone)]
pub struct LegacyStorageMigrationState {
    inner: Arc<Inner>,
}

impl LegacyStorageMigrationState {
    pub fn new(data_dir: PathBuf) -> Self {
        let completed = completion_path(&data_dir).is_file();
        Self {
            inner: Arc::new(Inner {
                data_dir,
                ready: AtomicBool::new(completed),
                applied: AtomicBool::new(completed),
                entries: Mutex::new(None),
                error: Mutex::new(None),
                #[cfg(feature = "e2e")]
                e2e_seed_completed: AtomicBool::new(false),
                #[cfg(feature = "e2e")]
                e2e_probe_entries: Mutex::new(None),
                #[cfg(feature = "e2e")]
                e2e_seed_requested: AtomicBool::new(false),
                #[cfg(feature = "e2e")]
                e2e_probe_requested: AtomicBool::new(false),
            }),
        }
    }

    pub fn requires_probe(&self) -> bool {
        !self.inner.ready.load(Ordering::Acquire)
    }

    fn stage(&self, entries: Vec<LegacyStorageEntry>) -> Result<(), String> {
        validate_entries(&entries)?;
        if entries.is_empty() {
            self.write_completion_marker(0)?;
            self.inner.applied.store(true, Ordering::Release);
        } else {
            *self
                .inner
                .entries
                .lock()
                .map_err(|_| "legacy_local_storage_state_poisoned".to_string())? = Some(entries);
        }
        self.inner.ready.store(true, Ordering::Release);
        Ok(())
    }

    fn snapshot(&self) -> LegacyStorageMigrationSnapshot {
        if !self.inner.ready.load(Ordering::Acquire) {
            return LegacyStorageMigrationSnapshot {
                phase: "probing",
                entries: Vec::new(),
                error: None,
            };
        }
        if let Some(error) = self.inner.error.lock().ok().and_then(|value| value.clone()) {
            return LegacyStorageMigrationSnapshot {
                phase: "failed",
                entries: Vec::new(),
                error: Some(error),
            };
        }
        let entries = self
            .inner
            .entries
            .lock()
            .ok()
            .and_then(|value| value.clone())
            .unwrap_or_default();
        LegacyStorageMigrationSnapshot {
            phase: if entries.is_empty() {
                "complete"
            } else {
                "ready"
            },
            entries,
            error: None,
        }
    }

    fn complete(&self, migrated_entries: usize) -> Result<(), String> {
        if migrated_entries > MAX_ENTRIES {
            return Err("legacy_local_storage_migration_count_invalid".to_string());
        }
        self.write_completion_marker(migrated_entries)?;
        self.inner.applied.store(true, Ordering::Release);
        if let Ok(mut entries) = self.inner.entries.lock() {
            *entries = None;
        }
        Ok(())
    }

    pub fn fail(&self, error: impl Into<String>) {
        if let Ok(mut value) = self.inner.error.lock() {
            *value = Some(error.into());
        }
        self.inner.ready.store(true, Ordering::Release);
    }

    fn probe_status(&self) -> LegacyStorageProbeStatus {
        LegacyStorageProbeStatus {
            applied: self.inner.applied.load(Ordering::Acquire),
            error: self.inner.error.lock().ok().and_then(|value| value.clone()),
        }
    }

    fn write_completion_marker(&self, migrated_entries: usize) -> Result<(), String> {
        fs::create_dir_all(&self.inner.data_dir)
            .map_err(|error| format!("cannot create legacy migration directory: {error}"))?;
        let marker = CompletionMarker {
            schema_version: 1,
            completed_at: time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .map_err(|error| format!("cannot format legacy migration timestamp: {error}"))?,
            migrated_entries,
            source_origin: LEGACY_STORAGE_ORIGIN.to_string(),
        };
        let bytes = serde_json::to_vec_pretty(&marker)
            .map_err(|error| format!("cannot serialize legacy migration marker: {error}"))?;
        write_atomic(&completion_path(&self.inner.data_dir), &bytes)
    }

    #[cfg(feature = "e2e")]
    fn reset_e2e_seed(&self) {
        let _ = fs::remove_file(completion_path(&self.inner.data_dir));
        self.inner.ready.store(false, Ordering::Release);
        self.inner.applied.store(false, Ordering::Release);
        self.inner
            .e2e_seed_completed
            .store(false, Ordering::Release);
        self.inner
            .e2e_seed_requested
            .store(false, Ordering::Release);
        self.inner
            .e2e_probe_requested
            .store(false, Ordering::Release);
        if let Ok(mut entries) = self.inner.entries.lock() {
            *entries = None;
        }
        if let Ok(mut entries) = self.inner.e2e_probe_entries.lock() {
            *entries = None;
        }
        if let Ok(mut error) = self.inner.error.lock() {
            *error = None;
        }
    }

    #[cfg(feature = "e2e")]
    fn reset_e2e_probe(&self) {
        if let Ok(mut entries) = self.inner.e2e_probe_entries.lock() {
            *entries = None;
        }
        self.inner
            .e2e_probe_requested
            .store(false, Ordering::Release);
    }
}

fn completion_path(data_dir: &Path) -> PathBuf {
    data_dir.join(COMPLETION_FILE)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "legacy_local_storage_marker_path_invalid".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("cannot create legacy migration marker directory: {error}"))?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("legacy-local-storage-migration"),
        std::process::id()
    ));
    fs::write(&temporary, bytes)
        .map_err(|error| format!("cannot write legacy migration marker: {error}"))?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("cannot replace legacy migration marker: {error}"))?;
    }
    fs::rename(&temporary, path)
        .map_err(|error| format!("cannot publish legacy migration marker: {error}"))
}

fn validate_entries(entries: &[LegacyStorageEntry]) -> Result<(), String> {
    if entries.len() > MAX_ENTRIES {
        return Err("legacy_local_storage_too_many_entries".to_string());
    }
    let mut keys = std::collections::HashSet::new();
    let mut total_bytes = 0usize;
    for entry in entries {
        if !entry.key.starts_with(APPLICATION_STORAGE_PREFIX) {
            return Err("legacy_local_storage_key_not_allowed".to_string());
        }
        if entry.key.len() > MAX_KEY_BYTES {
            return Err("legacy_local_storage_key_too_large".to_string());
        }
        if entry.value.len() > MAX_VALUE_BYTES {
            return Err("legacy_local_storage_value_too_large".to_string());
        }
        if !keys.insert(entry.key.as_str()) {
            return Err("legacy_local_storage_duplicate_key".to_string());
        }
        total_bytes = total_bytes
            .checked_add(entry.key.len() + entry.value.len())
            .ok_or_else(|| "legacy_local_storage_size_invalid".to_string())?;
    }
    if total_bytes > MAX_TOTAL_BYTES {
        return Err("legacy_local_storage_payload_too_large".to_string());
    }
    Ok(())
}

fn ensure_window_label(window: &WebviewWindow, expected: &str) -> Result<(), String> {
    if window.label() == expected {
        Ok(())
    } else {
        Err("legacy_local_storage_window_not_allowed".to_string())
    }
}

fn legacy_page_url(mode: Option<&str>) -> Result<Url, String> {
    let query = mode
        .map(|value| format!("?mode={value}"))
        .unwrap_or_default();
    Url::parse(&format!(
        "{LEGACY_STORAGE_ORIGIN}{LEGACY_STORAGE_PAGE}{query}"
    ))
    .map_err(|error| format!("cannot build legacy storage page URL: {error}"))
}

fn create_legacy_window(
    app: &AppHandle,
    label: &str,
    mode: Option<&str>,
) -> Result<WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.close();
    }
    WebviewWindowBuilder::new(app, label, WebviewUrl::External(legacy_page_url(mode)?))
        .title("AI Novel Studio 设置迁移")
        .visible(false)
        .focused(false)
        .focusable(false)
        .decorations(false)
        .skip_taskbar(true)
        .inner_size(1.0, 1.0)
        .use_https_scheme(false)
        .build()
        .map_err(|error| format!("cannot create legacy storage migration window: {error}"))
}

pub fn start_probe(app: AppHandle, state: LegacyStorageMigrationState) -> Result<(), String> {
    if !state.requires_probe() && !cfg!(feature = "e2e") {
        return Ok(());
    }
    let needs_migration_probe = state.requires_probe();

    let window_state = state.clone();
    std::thread::spawn(move || {
        // In desktop tests the WebDriver session must bind to the visible main
        // window before the auxiliary HTTP-origin WebView exists.
        #[cfg(feature = "e2e")]
        std::thread::sleep(Duration::from_millis(1_500));

        let create_app = app.clone();
        let create_state = window_state.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            if let Err(error) =
                create_legacy_window(&create_app, LEGACY_STORAGE_MIGRATION_WINDOW_LABEL, None)
            {
                create_state.fail(error);
            }
        }) {
            window_state.fail(format!("cannot schedule legacy storage probe: {error}"));
            return;
        }

        if !needs_migration_probe {
            return;
        }
        let timeout_state = window_state.clone();
        std::thread::spawn(move || {
            let started = Instant::now();
            while started.elapsed() < PROBE_TIMEOUT {
                if !timeout_state.requires_probe() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            timeout_state.fail("legacy_local_storage_probe_timeout");
            if let Some(window) = app.get_webview_window(LEGACY_STORAGE_MIGRATION_WINDOW_LABEL) {
                let _ = window.close();
            }
        });
    });
    Ok(())
}

pub fn initialize_runtime(app: AppHandle, state: LegacyStorageMigrationState) {
    if let Err(error) = start_probe(app.clone(), state.clone()) {
        crate::errors::log_workspace_event(crate::errors::WorkspaceLogEvent {
            level: "warn",
            event: "legacy_local_storage_probe_failed",
            trace_id: None,
            operation_id: None,
            novel_id: None,
            chapter_id: None,
            draft_id: None,
            error_code: Some("LEGACY_LOCAL_STORAGE_PROBE_FAILED"),
            metadata: Some(serde_json::json!({ "stage": "window_creation" })),
        });
        state.fail(error);
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
    #[cfg(feature = "e2e")]
    {
        let focus_app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(350));
            let window_app = focus_app.clone();
            let _ = focus_app.run_on_main_thread(move || {
                if let Some(window) = window_app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            });
        });
    }
    #[cfg(feature = "update-e2e")]
    crate::commands::app_update::start_update_acceptance(app);
}

#[tauri::command]
pub fn stage_legacy_local_storage(
    window: WebviewWindow,
    state: State<'_, LegacyStorageMigrationState>,
    input: StageLegacyStorageInput,
) -> Result<(), String> {
    ensure_window_label(&window, LEGACY_STORAGE_MIGRATION_WINDOW_LABEL)?;
    if input.origin != LEGACY_STORAGE_ORIGIN {
        return Err("legacy_local_storage_origin_mismatch".to_string());
    }
    state.stage(input.entries)
}

#[tauri::command]
pub fn get_legacy_local_storage_migration_snapshot(
    window: WebviewWindow,
    state: State<'_, LegacyStorageMigrationState>,
) -> Result<LegacyStorageMigrationSnapshot, String> {
    ensure_window_label(&window, "main")?;
    Ok(state.snapshot())
}

#[tauri::command]
pub fn complete_legacy_local_storage_migration(
    window: WebviewWindow,
    state: State<'_, LegacyStorageMigrationState>,
    input: CompleteLegacyStorageInput,
) -> Result<(), String> {
    ensure_window_label(&window, "main")?;
    state.complete(input.migrated_entries)
}

#[tauri::command]
pub fn get_legacy_local_storage_probe_status(
    window: WebviewWindow,
    state: State<'_, LegacyStorageMigrationState>,
) -> Result<LegacyStorageProbeStatus, String> {
    ensure_window_label(&window, LEGACY_STORAGE_MIGRATION_WINDOW_LABEL)?;
    Ok(state.probe_status())
}

#[tauri::command]
pub fn fail_legacy_local_storage_probe(
    window: WebviewWindow,
    state: State<'_, LegacyStorageMigrationState>,
    error: String,
) -> Result<(), String> {
    ensure_window_label(&window, LEGACY_STORAGE_MIGRATION_WINDOW_LABEL)?;
    state.fail(if error.trim().is_empty() {
        "legacy_local_storage_probe_failed"
    } else {
        error.trim()
    });
    window
        .close()
        .map_err(|error| format!("cannot close legacy storage probe: {error}"))
}

#[tauri::command]
pub fn close_legacy_local_storage_probe(window: WebviewWindow) -> Result<(), String> {
    ensure_window_label(&window, LEGACY_STORAGE_MIGRATION_WINDOW_LABEL)?;
    window
        .close()
        .map_err(|error| format!("cannot close legacy storage probe: {error}"))
}
