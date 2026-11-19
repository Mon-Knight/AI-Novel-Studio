//! Shared `tools/list` allowlist filtering.
//!
//! This module keeps the existing filter semantics used by every legacy and
//! Canonical tool. The stage submission tool is the only addition: it is
//! appended when the task allowlist names it explicitly, even when the same
//! allowlist selects Canonical read tools. No other legacy tool is exposed by
//! that addition.

use serde_json::Value;
use std::collections::HashSet;

pub(crate) fn filter_tool_list(
    mut tools: Vec<Value>,
    allowed_tools: Result<Option<HashSet<String>>, String>,
) -> Vec<Value> {
    match allowed_tools {
        Ok(Some(allowed)) => {
            tools.retain(|tool| {
                tool.get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| allowed.contains(name))
            });
            crate::stage_submission::append_listed(&mut tools, &allowed);
            tools
        }
        Ok(None) => tools,
        Err(_) => Vec::new(),
    }
}
