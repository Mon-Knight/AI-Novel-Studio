//! Novel Domain Gateway — AI Novel Studio v3.1.0 (workspace member crate).
//!
//! An MCP stdio server (protocol 2024-11-05, JSON-RPC 2.0 line frames) that the
//! DSH runtime spawns via `@deepseek-ai/dsh-mcp-client` (`serverName: novel`).
//! It opens the novel SQLite READ-ONLY and serves scoped read tools plus a
//! candidate-only validation sink. The sink returns model-authored candidate
//! text for the ANS ResultArtifact pipeline; it never writes chapters or any
//! other business fact. The gateway never runs migrations, recovery, or writes;
//! stdout carries only protocol frames and diagnostics go to stderr.
//! Credential-like inputs and outputs are rejected (mirrors ai_fact_security;
//! see secret_guard.rs).
//!
//! Deviation note: the task book planned a package [[bin]]; a workspace member
//! crate is used instead so the app's bin crate stays untouched. The binary
//! lands at src-tauri/target/debug/novel-domain-gateway.exe.
//!
//! Usage:
//!   novel-domain-gateway --db <novel.sqlite>           # MCP stdio loop
//!   novel-domain-gateway --db <novel.sqlite> --smoke   # one-shot self check

mod secret_guard;
mod tools;

use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::io::{BufRead, Write};

const PROTOCOL_VERSION: &str = "2024-11-05";
const SERVER_NAME: &str = "novel-domain-gateway";
const SERVER_VERSION: &str = "0.1.0";
const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

fn open_readonly(path: &str) -> Result<Connection, String> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("open read-only failed: {}", error))
}

fn main() {
    let mut db_path: Option<String> = None;
    let mut smoke = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--db" => db_path = args.next(),
            "--smoke" => smoke = true,
            other => eprintln!("ignored argument: {}", other),
        }
    }
    let db_path = match db_path {
        Some(path) => path,
        None => {
            eprintln!("usage: novel-domain-gateway --db <novel.sqlite> [--smoke]");
            std::process::exit(1);
        }
    };
    let connection = match open_readonly(&db_path) {
        Ok(connection) => connection,
        Err(error) => {
            eprintln!("{}", error);
            std::process::exit(1);
        }
    };

    if smoke {
        tools::run_smoke(&connection);
        return;
    }

    eprintln!(
        "novel-domain-gateway {} serving {}",
        SERVER_VERSION, db_path
    );
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut output = stdout.lock();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => break,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(_) => continue, // malformed frames are ignored per JSON-RPC
        };
        let id = match request.get("id") {
            Some(id) if !id.is_null() => id.clone(),
            _ => continue, // notification (e.g. notifications/initialized)
        };
        let method = match request.get("method").and_then(Value::as_str) {
            Some(method) => method,
            None => continue,
        };
        let frame = match handle_method(method, request.get("params"), &connection) {
            Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
            Err(message) => {
                json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32603, "message": message}})
            }
        };
        if writeln!(output, "{}", frame).is_err() {
            break;
        }
        if output.flush().is_err() {
            break;
        }
    }
    eprintln!("stdin closed, exiting");
}

fn handle_method(
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

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("open fixture database");
        connection
            .execute_batch(
                "CREATE TABLE chapters (
                    id TEXT PRIMARY KEY,
                    novel_id TEXT NOT NULL,
                    deleted_at TEXT
                );
                INSERT INTO chapters (id, novel_id) VALUES ('chapter-1', 'novel-1');",
            )
            .expect("create fixture schema");
        connection
    }

    #[test]
    fn successful_tool_call_exposes_matching_structured_content() {
        let connection = fixture_connection();
        let params = json!({
            "name": "generate_chapter",
            "arguments": {
                "novelId": "novel-1",
                "chapterId": "chapter-1",
                "candidateText": "雨过天青。\n城门缓缓打开。"
            }
        });
        let result = handle_method("tools/call", Some(&params), &connection)
            .expect("tool call should succeed");

        assert_eq!(result["isError"], false);
        assert_eq!(
            result["structuredContent"]["data"]["text"],
            "雨过天青。\n城门缓缓打开。"
        );
        let text_payload: Value = serde_json::from_str(
            result["content"][0]["text"]
                .as_str()
                .expect("text content must be a JSON string"),
        )
        .expect("text content must encode the structured payload");
        assert_eq!(text_payload, result["structuredContent"]);
    }

    #[test]
    fn failed_tool_call_stays_an_mcp_tool_error_without_structured_content() {
        let connection = fixture_connection();
        let params = json!({
            "name": "generate_chapter",
            "arguments": {
                "novelId": "other-novel",
                "chapterId": "chapter-1",
                "candidateText": "候选正文"
            }
        });
        let result = handle_method("tools/call", Some(&params), &connection)
            .expect("domain rejection is returned as an MCP tool result");

        assert_eq!(result["isError"], true);
        assert!(result.get("structuredContent").is_none());
        assert!(result["content"][0]["text"]
            .as_str()
            .expect("error content must be text")
            .contains("chapter not found in novel"));
    }
}
