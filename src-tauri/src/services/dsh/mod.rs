//! Native in-process Agent Runtime and Workbench task execution services.
//!
//! Replaces the external Node.js DSH carrier, `model-proxy.mjs`, and stdio MCP
//! subprocesses with direct Rust SSE streaming, SQLite `AiRequestPolicy` leases,
//! and in-process `novel_domain_gateway` read/candidate tool execution.

pub mod baseline_freshness;
pub mod canonical_manifest;
pub mod commands;
pub mod config;
pub mod ledger;
pub mod models;
pub(crate) mod native_agent_evidence;
pub(crate) mod native_agent_loop;
pub(crate) mod native_agent_sse;
pub(crate) mod native_agent_transport;
pub mod proposal_validator;
pub mod task_runtime;

#[cfg(test)]
mod tests;
