use rusqlite::ErrorCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fmt;

#[allow(dead_code)]
pub mod codes {
    pub const DOCUMENT_VERSION_CONFLICT: &str = "DOCUMENT_VERSION_CONFLICT";
    pub const DOCUMENT_HASH_MISMATCH: &str = "DOCUMENT_HASH_MISMATCH";
    pub const TARGET_NOVEL_NOT_FOUND: &str = "TARGET_NOVEL_NOT_FOUND";
    pub const TARGET_CHAPTER_NOT_FOUND: &str = "TARGET_CHAPTER_NOT_FOUND";
    pub const TARGET_CHAPTER_DELETED: &str = "TARGET_CHAPTER_DELETED";
    pub const TARGET_DRAFT_NOT_FOUND: &str = "TARGET_DRAFT_NOT_FOUND";
    pub const DRAFT_UPDATE_ZERO_ROWS: &str = "DRAFT_UPDATE_ZERO_ROWS";
    pub const LARGE_TEXT_HASH_MISMATCH: &str = "LARGE_TEXT_HASH_MISMATCH";
    pub const LARGE_TEXT_CHUNK_MISSING: &str = "LARGE_TEXT_CHUNK_MISSING";
    pub const LARGE_TEXT_CONTENT_UNAVAILABLE: &str = "LARGE_TEXT_CONTENT_UNAVAILABLE";
    pub const LARGE_TEXT_REFERENCE_INVALID: &str = "LARGE_TEXT_REFERENCE_INVALID";
    pub const RECOVERY_SNAPSHOT_NOT_FOUND: &str = "RECOVERY_SNAPSHOT_NOT_FOUND";
    pub const RECOVERY_BASE_CONFLICT: &str = "RECOVERY_BASE_CONFLICT";
    pub const RECOVERY_CONTENT_INVALID: &str = "RECOVERY_CONTENT_INVALID";
    pub const DATABASE_BUSY: &str = "DATABASE_BUSY";
    pub const DATABASE_TRANSACTION_FAILED: &str = "DATABASE_TRANSACTION_FAILED";
    pub const DATABASE_COMMIT_UNKNOWN: &str = "DATABASE_COMMIT_UNKNOWN";
    pub const OPERATION_ALREADY_COMPLETED: &str = "OPERATION_ALREADY_COMPLETED";
    pub const OPERATION_IN_PROGRESS: &str = "OPERATION_IN_PROGRESS";
    pub const OPERATION_PAYLOAD_CONFLICT: &str = "OPERATION_PAYLOAD_CONFLICT";
    pub const WORKSPACE_LEAVE_CANCELLED: &str = "WORKSPACE_LEAVE_CANCELLED";
    pub const WORKSPACE_SAVE_FAILED: &str = "WORKSPACE_SAVE_FAILED";
    pub const WINDOW_CLOSE_BLOCKED: &str = "WINDOW_CLOSE_BLOCKED";
}

/// Stable, serializable error contract used by the v2.2 workspace commands.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable,
            trace_id: None,
            operation_id: None,
            details: None,
        }
    }

    pub fn with_context(mut self, trace_id: Option<&str>, operation_id: Option<&str>) -> Self {
        self.trace_id = trace_id.map(ToOwned::to_owned);
        self.operation_id = operation_id.map(ToOwned::to_owned);
        self
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn database(error: rusqlite::Error) -> Self {
        let retryable = matches!(
            error.sqlite_error_code(),
            Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked)
        );
        let code = if retryable {
            codes::DATABASE_BUSY
        } else {
            codes::DATABASE_TRANSACTION_FAILED
        };
        Self::new(code, "数据库操作失败", retryable)
            .with_details(json!({ "sqliteError": error.to_string() }))
    }

    pub fn poisoned_lock() -> Self {
        Self::new(
            codes::DATABASE_TRANSACTION_FAILED,
            "数据库连接暂时不可用",
            true,
        )
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        Self::database(error)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLogEvent<'a> {
    pub level: &'a str,
    pub event: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub novel_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chapter_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draft_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

/// Local-only structured logging. Callers must provide metadata, never body text or credentials.
pub fn log_workspace_event(event: WorkspaceLogEvent<'_>) {
    if let Ok(serialized) = serde_json::to_string(&event) {
        eprintln!("{serialized}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db16_app_error_serializes_as_stable_object() {
        let error = AppError::new(codes::DOCUMENT_VERSION_CONFLICT, "草稿版本已变化", false)
            .with_context(Some("trace-1"), Some("operation-1"))
            .with_details(json!({ "expectedVersion": 1, "actualVersion": 2 }));

        let value = serde_json::to_value(error).expect("AppError should serialize");
        assert_eq!(value["code"], codes::DOCUMENT_VERSION_CONFLICT);
        assert_eq!(value["retryable"], false);
        assert_eq!(value["traceId"], "trace-1");
        assert_eq!(value["operationId"], "operation-1");
        assert!(value["details"].is_object());
        let decoded: AppError =
            serde_json::from_value(value).expect("serialized AppError should round-trip");
        assert_eq!(decoded.code, codes::DOCUMENT_VERSION_CONFLICT);
        assert_eq!(decoded.trace_id.as_deref(), Some("trace-1"));
    }
}
