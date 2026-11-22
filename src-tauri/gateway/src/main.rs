//! Novel Domain Gateway — MCP stdio CLI entry over `novel_domain_gateway` library.

use novel_domain_gateway::{handle_mcp_method, open_readonly, tools, SERVER_VERSION};
use serde_json::{json, Value};
use std::io::{BufRead, Write};

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
            Err(_) => continue,
        };
        let id = match request.get("id") {
            Some(id) if !id.is_null() => id.clone(),
            _ => continue,
        };
        let method = match request.get("method").and_then(Value::as_str) {
            Some(method) => method,
            None => continue,
        };
        let frame = match handle_mcp_method(method, request.get("params"), &connection) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

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
        let result = handle_mcp_method("tools/call", Some(&params), &connection)
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
        let result = handle_mcp_method("tools/call", Some(&params), &connection)
            .expect("domain rejection is returned as an MCP tool result");

        assert_eq!(result["isError"], true);
        assert!(result.get("structuredContent").is_none());
        assert!(result["content"][0]["text"]
            .as_str()
            .expect("error content must be text")
            .contains("chapter not found in novel"));
    }
}
