//! Novel Domain Gateway library — shared between in-process native runtime and MCP stdio binary.
//!
//! Opens the novel SQLite database READ-ONLY and serves scoped read tools plus
//! candidate-only validation sinks. Never runs migrations, recovery, or writes.

mod domain_candidate;
pub mod secret_guard;
#[cfg(test)]
mod sql_column_contract;
mod stage_submission;
#[path = "../../shared/summary_application_policy.rs"]
mod summary_context_policy;
mod task_budget;
mod tool_allowlist;
pub mod tools;

use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::path::Path;

pub const PROTOCOL_VERSION: &str = "2024-11-05";
pub const SERVER_NAME: &str = "novel-domain-gateway";
pub const SERVER_VERSION: &str = "0.1.0";
pub const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Default)]
pub struct InProcessToolSecurity<'a> {
    pub allowed_tools_csv: Option<&'a str>,
    pub novel_id: Option<&'a str>,
    pub chapter_id: Option<&'a str>,
    pub candidate_policy: Option<&'a str>,
}

pub fn open_readonly_path(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("open read-only failed: {}", error))
}

pub fn open_readonly(path: &str) -> Result<Connection, String> {
    open_readonly_path(Path::new(path))
}

pub fn list_tools_for_allowlist_csv(allowed_tools_csv: Option<&str>) -> Vec<Value> {
    tools::list_tools_for_allowlist_csv(allowed_tools_csv)
}

/// Executes one novel-domain tool directly in-process over a read-only SQLite connection.
/// Returns `(payload_json_string, is_error)` matching the exact MCP content contract.
pub fn call_tool_in_process(
    connection: &Connection,
    name: &str,
    arguments: &Value,
    security: InProcessToolSecurity<'_>,
    authorize_budget: &dyn Fn(&str) -> Result<(), String>,
) -> Result<(String, bool), String> {
    let context = tools::build_in_process_security_context(
        security.allowed_tools_csv,
        security.novel_id,
        security.chapter_id,
        security.candidate_policy,
    );
    match tools::call_tool_with_security_and_budget(
        connection,
        name,
        arguments,
        context,
        authorize_budget,
    ) {
        Ok(payload) => {
            if secret_guard::contains_secret_value(&payload) {
                return Err("tool output contains credential-like content; rejected".to_string());
            }
            let text = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
            if text.len() > MAX_OUTPUT_BYTES {
                return Err("tool output exceeds 2 MiB cap".to_string());
            }
            Ok((text, false))
        }
        Err(message) => Ok((json!({ "error": message }).to_string(), true)),
    }
}

pub fn handle_mcp_method(
    method: &str,
    params: Option<&Value>,
    connection: &Connection,
) -> Result<Value, String> {
    match method {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {"listChanged": false}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION}
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({"tools": tools::tool_list()})),
        "tools/call" => {
            let params = params.ok_or_else(|| "missing params".to_string())?;
            let name = params
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| "missing tool name".to_string())?;
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let result = match tools::call_tool(connection, name, &arguments) {
                Ok(payload) => {
                    if secret_guard::contains_secret_value(&payload) {
                        return Err(
                            "tool output contains credential-like content; rejected".to_string()
                        );
                    }
                    let text =
                        serde_json::to_string(&payload).map_err(|error| error.to_string())?;
                    if text.len() > MAX_OUTPUT_BYTES {
                        return Err("tool output exceeds 2 MiB cap".to_string());
                    }
                    json!({
                        "content": [{"type": "text", "text": text}],
                        "structuredContent": payload,
                        "isError": false
                    })
                }
                Err(message) => json!({
                    "content": [{"type": "text", "text": json!({"error": message}).to_string()}],
                    "isError": true
                }),
            };
            Ok(result)
        }
        other => Err(format!("method not found: {}", other)),
    }
}
