//! DSH (DeepSeek Harness) out-of-process brain — v3.1.0.
//!
//! Design authority: docs/architecture/dsh-feasibility-spike.md; evidence:
//! reports/dsh-spike/spike-report.md. DSH plans and reasons; ANS keeps fact
//! interpretation, veto, budget, execution, transactions and final adoption.

pub mod baseline_freshness;
pub mod commands;
pub mod config;
pub mod launcher;
pub mod ledger;
pub mod models;
pub mod proposal_validator;
pub mod supervisor;
#[cfg(test)]
mod tests;
