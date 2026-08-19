use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const REPORT_FILE_NAME: &str = "native-crash-reports.jsonl";
const PREVIOUS_REPORT_FILE_NAME: &str = "native-crash-reports.previous.jsonl";
const MAX_REPORT_FILE_BYTES: u64 = 128 * 1024;
const MAX_REPORTS_RETURNED: usize = 50;

static REPORT_DIRECTORY: OnceCell<PathBuf> = OnceCell::new();

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeCrashReport {
    pub schema_version: u8,
    pub captured_at: String,
    pub kind: String,
    pub app_version: String,
    pub source_file: Option<String>,
    pub source_line: Option<u32>,
    pub source_column: Option<u32>,
}

fn report_path(directory: &Path) -> PathBuf {
    directory.join(REPORT_FILE_NAME)
}

fn previous_report_path(directory: &Path) -> PathBuf {
    directory.join(PREVIOUS_REPORT_FILE_NAME)
}

fn source_file_name(path: &str) -> Option<String> {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_owned)
}

fn build_report(source: Option<(&str, u32, u32)>) -> NativeCrashReport {
    NativeCrashReport {
        schema_version: 1,
        captured_at: chrono::Utc::now().to_rfc3339(),
        kind: "rust_panic".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        source_file: source.and_then(|(file, _, _)| source_file_name(file)),
        source_line: source.map(|(_, line, _)| line),
        source_column: source.map(|(_, _, column)| column),
    }
}

fn rotate_if_needed(directory: &Path) -> std::io::Result<()> {
    let current = report_path(directory);
    let should_rotate = fs::metadata(&current)
        .map(|metadata| metadata.len() >= MAX_REPORT_FILE_BYTES)
        .unwrap_or(false);
    if !should_rotate {
        return Ok(());
    }

    let previous = previous_report_path(directory);
    if previous.exists() {
        fs::remove_file(&previous)?;
    }
    fs::rename(current, previous)
}

fn append_report(directory: &Path, report: &NativeCrashReport) -> std::io::Result<()> {
    fs::create_dir_all(directory)?;
    rotate_if_needed(directory)?;
    let encoded = serde_json::to_string(report)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(report_path(directory))?;
    writeln!(file, "{encoded}")
}

fn load_report_file(path: &Path) -> Vec<NativeCrashReport> {
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    content
        .lines()
        .filter_map(|line| serde_json::from_str::<NativeCrashReport>(line).ok())
        .collect()
}

fn load_reports_from(directory: &Path) -> Vec<NativeCrashReport> {
    let mut reports = load_report_file(&previous_report_path(directory));
    reports.extend(load_report_file(&report_path(directory)));
    let remove_count = reports.len().saturating_sub(MAX_REPORTS_RETURNED);
    reports.drain(..remove_count);
    reports
}

fn clear_reports_from(directory: &Path) -> std::io::Result<()> {
    for path in [report_path(directory), previous_report_path(directory)] {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

/// Installs a best-effort native panic envelope before database and UI startup.
/// The envelope deliberately excludes the panic payload, stack, paths and user content.
pub fn install_native_crash_report_hook(directory: &Path) {
    let directory = directory.to_path_buf();
    let _ = REPORT_DIRECTORY.set(directory.clone());
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        let source = panic_info
            .location()
            .map(|location| (location.file(), location.line(), location.column()));
        let _ = append_report(&directory, &build_report(source));
        previous_hook(panic_info);
    }));
}

#[tauri::command]
pub fn get_native_crash_reports() -> Result<Vec<NativeCrashReport>, String> {
    let Some(directory) = REPORT_DIRECTORY.get() else {
        return Ok(Vec::new());
    };
    Ok(load_reports_from(directory))
}

#[tauri::command]
pub fn clear_native_crash_reports() -> Result<(), String> {
    let Some(directory) = REPORT_DIRECTORY.get() else {
        return Ok(());
    };
    clear_reports_from(directory).map_err(|_| "清理本机崩溃报告失败".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn test_directory() -> PathBuf {
        std::env::temp_dir().join(format!("ai-novel-studio-crash-report-{}", Uuid::new_v4()))
    }

    #[test]
    fn native_report_excludes_payload_and_full_source_path() {
        let report = build_report(Some((r"C:\secret\workspace\main.rs", 41, 9)));
        let encoded = serde_json::to_string(&report).expect("report should serialize");

        assert_eq!(report.source_file.as_deref(), Some("main.rs"));
        assert_eq!(report.source_line, Some(41));
        assert!(!encoded.contains("secret"));
        assert!(!encoded.contains("payload"));
        assert!(!encoded.contains("message"));
        assert!(!encoded.contains("stack"));
    }

    #[test]
    fn native_reports_are_bounded_and_clearable() {
        let directory = test_directory();
        for line in 0..55 {
            let report = build_report(Some(("main.rs", line, 1)));
            append_report(&directory, &report).expect("report should append");
        }

        let reports = load_reports_from(&directory);
        assert_eq!(reports.len(), MAX_REPORTS_RETURNED);
        assert_eq!(
            reports.first().and_then(|report| report.source_line),
            Some(5)
        );
        assert_eq!(
            reports.last().and_then(|report| report.source_line),
            Some(54)
        );

        clear_reports_from(&directory).expect("reports should clear");
        assert!(load_reports_from(&directory).is_empty());
        let _ = fs::remove_dir_all(directory);
    }
}
