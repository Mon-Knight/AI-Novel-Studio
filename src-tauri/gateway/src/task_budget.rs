//! Native root authority reserves every actual capability before dispatch.
//! The URL is inherited from the trusted host, never taken from model arguments.
use serde_json::json;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

pub(crate) fn authorize(tool_name: &str) -> Result<(), String> {
    match std::env::var("ANS_TASK_BUDGET_URL") {
        Err(std::env::VarError::NotPresent) => Ok(()),
        Err(_) => Err("DSH_TOOL_BUDGET_AUTHORITY_INVALID".into()),
        Ok(url) => authorize_at(&url, tool_name),
    }
}
fn authorize_at(url: &str, tool_name: &str) -> Result<(), String> {
    let port = url
        .strip_prefix("http://127.0.0.1:")
        .and_then(|v| v.parse::<u16>().ok())
        .filter(|v| *v > 0)
        .ok_or("DSH_TOOL_BUDGET_AUTHORITY_INVALID")?;
    let mut stream = TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}")
            .parse()
            .map_err(|_| "DSH_TOOL_BUDGET_AUTHORITY_INVALID")?,
        Duration::from_secs(3),
    )
    .map_err(|_| "DSH_TOOL_BUDGET_AUTHORITY_UNAVAILABLE")?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| "DSH_TOOL_BUDGET_AUTHORITY_UNAVAILABLE")?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| "DSH_TOOL_BUDGET_AUTHORITY_UNAVAILABLE")?;
    let body = json!({"toolName":tool_name}).to_string();
    write!(stream,"POST /tool HTTP/1.1\r\nhost: 127.0.0.1:{port}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",body.len(),body).map_err(|_|"DSH_TOOL_BUDGET_AUTHORITY_UNAVAILABLE")?;
    let mut response = Vec::new();
    stream
        .take(16_385)
        .read_to_end(&mut response)
        .map_err(|_| "DSH_TOOL_BUDGET_AUTHORITY_UNAVAILABLE")?;
    if response.len() > 16_384 {
        return Err("DSH_TOOL_BUDGET_RESPONSE_INVALID".into());
    }
    let response =
        std::str::from_utf8(&response).map_err(|_| "DSH_TOOL_BUDGET_RESPONSE_INVALID")?;
    let (header, body) = response
        .split_once("\r\n\r\n")
        .ok_or("DSH_TOOL_BUDGET_RESPONSE_INVALID")?;
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|_| "DSH_TOOL_BUDGET_RESPONSE_INVALID")?;
    if header
        .lines()
        .next()
        .and_then(|v| v.split_whitespace().nth(1))
        == Some("200")
        && value.get("allowed").and_then(serde_json::Value::as_bool) == Some(true)
    {
        return Ok(());
    }
    Err(value
        .get("error")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("DSH_TOOL_BUDGET_REJECTED")
        .chars()
        .take(300)
        .collect())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn external_or_malformed_budget_authority_is_rejected_without_dispatch() {
        for url in [
            "https://127.0.0.1:80",
            "http://remote.test:80",
            "http://127.0.0.1:0",
            "http://127.0.0.1:80/foreign",
            "http://localhost:80",
        ] {
            assert_eq!(
                authorize_at(url, "novel.read").unwrap_err(),
                "DSH_TOOL_BUDGET_AUTHORITY_INVALID"
            );
        }
    }
}
