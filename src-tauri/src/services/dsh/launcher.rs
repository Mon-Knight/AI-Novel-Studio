//! `DshRuntimeLauncher`: the swappable runtime-carrier seam.
//!
//! Windows delivery reality (spike finding): the official Python single-file
//! runtime ships only linux-x64 / linux-arm64 / macos-arm64, so v3.1.0's only
//! carrier is a system Node satisfying DSH's `^22.19.0 || >=24.0.0`. A future
//! Windows single-file runtime swaps in behind this trait without changing the
//! supervisor or the wire protocol.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

/// Everything one runtime launch needs; no secrets in files, env only.
pub struct DshLaunchConfig {
    /// Runtime entry script (normally <checkout>/packages/examples/jsonrpc-demo/lib/bin.js,
    /// overridable via DSH_RUNTIME_BIN).
    pub runtime_bin: PathBuf,
    /// Rendered cordis.yml path (see crate::config::cordis_yml).
    pub cordis_config: PathBuf,
    /// JSONL session root (DSH_SESSION_ROOT); sessions are disposable.
    pub session_root: PathBuf,
    /// Harness home (DSH_HOME); isolated per runtime instance.
    pub home: PathBuf,
    /// Provider credential, injected via env only.
    pub api_key: String,
    /// OpenAI-compatible base URL (DEEPSEEK_BASE_URL) — points at the local
    /// model-gateway proxy in production.
    pub base_url: String,
    /// Planner persona (DSH_SYSTEM_PROMPT).
    pub system_prompt: String,
    /// Working directory recorded in every SDK session header; keep it stable
    /// across restarts so sessions resume from their JSONL root.
    pub cwd: PathBuf,
}

/// Spawns the DSH runtime process for one launch config.
pub trait DshRuntimeLauncher {
    fn launch(&self, config: &DshLaunchConfig) -> std::io::Result<Child>;
}

/// Node carrier: `node <runtime_bin>`.
pub struct NodeDshRuntime;

impl NodeDshRuntime {
    /// Verifies system Node satisfies `^22.19.0 || >=24.0.0`.
    pub fn check_node() -> Result<String, String> {
        let output = Command::new("node")
            .arg("--version")
            .output()
            .map_err(|error| format!("node not found: {}", error))?;
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let mut parts = version.trim_start_matches('v').split('.');
        let major: u32 = parts
            .next()
            .and_then(|part| part.parse().ok())
            .ok_or_else(|| format!("unparseable node version: {}", version))?;
        let minor: u32 = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
        let ok = major > 24 || (major == 24) || (major == 22 && minor >= 19);
        if !ok {
            return Err(format!(
                "node {} does not satisfy ^22.19.0 || >=24.0.0",
                version
            ));
        }
        Ok(version)
    }

    /// Resolves the runtime entry script: `DSH_RUNTIME_BIN` wins, then the
    /// pinned checkout's jsonrpc-demo bin. Never hard-codes a machine path.
    pub fn runtime_bin(checkout: &str) -> Result<String, String> {
        if let Ok(bin) = std::env::var("DSH_RUNTIME_BIN") {
            if !bin.trim().is_empty() && std::path::Path::new(&bin).is_file() {
                return Ok(bin);
            }
        }
        let bin = std::path::Path::new(checkout)
            .join("packages/examples/jsonrpc-demo/lib/bin.js")
            .to_string_lossy()
            .to_string();
        if std::path::Path::new(&bin).is_file() {
            Ok(bin)
        } else {
            Err(format!(
                "runtime bin not found at {} (build the pinned harness checkout first)",
                bin
            ))
        }
    }
}

impl DshRuntimeLauncher for NodeDshRuntime {
    fn launch(&self, config: &DshLaunchConfig) -> std::io::Result<Child> {
        let mut command = Command::new("node");
        command
            .arg(&config.runtime_bin)
            .current_dir(&config.cwd)
            .env("DSH_CORDIS_CONFIG", &config.cordis_config)
            .env("DSH_SESSION_ROOT", &config.session_root)
            .env("DSH_HOME", &config.home)
            .env("DEEPSEEK_API_KEY", &config.api_key)
            .env("DEEPSEEK_BASE_URL", &config.base_url)
            .env("DSH_SYSTEM_PROMPT", &config.system_prompt)
            .env("DSH_MAX_TOKENS_AS_SUCCESS", "true")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command.spawn()
    }
}
