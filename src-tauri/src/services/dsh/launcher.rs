//! `DshRuntimeLauncher`: the swappable runtime-carrier seam.
//!
//! Windows delivery reality (spike finding): the official Python single-file
//! runtime ships only linux-x64 / linux-arm64 / macos-arm64, so v3.1.0's only
//! carrier is a system Node satisfying DSH's `^22.19.0 || >=24.0.0`. A future
//! Windows single-file runtime swaps in behind this trait without changing the
//! supervisor or the wire protocol.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

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
    /// Optional ANS task allowlist inherited by the novel gateway. Empty means
    /// the legacy DSH preparation composition (all carrier tools).
    pub allowed_tools: Option<String>,
    /// Authoritative host scope inherited by the read-only novel gateway.
    pub task_novel_id: Option<String>,
    pub task_chapter_id: Option<String>,
    /// Optional host-owned validation profile for an automatic candidate turn.
    /// This is process-scoped so the model cannot weaken the policy in tool args.
    pub candidate_policy: Option<String>,
}

/// Spawns the DSH runtime process for one launch config.
pub trait DshRuntimeLauncher {
    fn launch(&self, config: &DshLaunchConfig) -> std::io::Result<Child>;
}

/// Node carrier: `node <runtime_bin>`.
pub struct NodeDshRuntime;

/// DSH processes communicate exclusively through redirected stdio. On
/// Windows they must not inherit an interactive/dev-test console, otherwise a
/// terminal Ctrl+C can terminate the persistent Worker and its gateway while
/// the desktop host is still running.
pub(super) fn configure_background_process(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    #[cfg(not(windows))]
    let _ = command;
}

pub(super) fn node_compatible_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        const VERBATIM_UNC: &str = r"\\?\UNC\";
        const VERBATIM: &str = r"\\?\";
        let value = path.to_string_lossy();
        if let Some(rest) = value.strip_prefix(VERBATIM_UNC) {
            return PathBuf::from(format!(r"\\{}", rest));
        }
        if let Some(rest) = value.strip_prefix(VERBATIM) {
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

impl NodeDshRuntime {
    /// Verifies system Node satisfies `^22.19.0 || >=24.0.0`.
    pub fn check_node() -> Result<String, String> {
        let mut command = Command::new("node");
        configure_background_process(&mut command);
        let output = command
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
        configure_background_process(&mut command);
        command
            .arg(node_compatible_path(&config.runtime_bin))
            .current_dir(node_compatible_path(&config.cwd))
            .env(
                "DSH_CORDIS_CONFIG",
                node_compatible_path(&config.cordis_config),
            )
            .env(
                "DSH_SESSION_ROOT",
                node_compatible_path(&config.session_root),
            )
            .env("DSH_HOME", node_compatible_path(&config.home))
            .env("DEEPSEEK_API_KEY", &config.api_key)
            .env("DEEPSEEK_BASE_URL", &config.base_url)
            .env("DSH_SYSTEM_PROMPT", &config.system_prompt)
            .env("DSH_MAX_TOKENS_AS_SUCCESS", "true")
            .env_remove("ANS_ALLOWED_TOOLS")
            .env_remove("ANS_TASK_NOVEL_ID")
            .env_remove("ANS_TASK_CHAPTER_ID")
            .env_remove("ANS_CANDIDATE_POLICY")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(allowed_tools) = &config.allowed_tools {
            command.env("ANS_ALLOWED_TOOLS", allowed_tools);
        }
        if let Some(novel_id) = &config.task_novel_id {
            command.env("ANS_TASK_NOVEL_ID", novel_id);
        }
        if let Some(chapter_id) = &config.task_chapter_id {
            command.env("ANS_TASK_CHAPTER_ID", chapter_id);
        }
        if let Some(candidate_policy) = &config.candidate_policy {
            command.env("ANS_CANDIDATE_POLICY", candidate_policy);
        }
        command.spawn()
    }
}

#[cfg(test)]
mod path_tests {
    use super::*;

    #[test]
    fn ordinary_paths_are_unchanged() {
        let path = Path::new(r"C:\Users\writer\dsh-task-workers");
        assert_eq!(node_compatible_path(path), path);
    }

    #[cfg(windows)]
    #[test]
    fn strips_windows_verbatim_prefix_for_node_entry_paths() {
        assert_eq!(
            node_compatible_path(Path::new(r"\\?\C:\Users\writer\model-proxy.mjs")),
            PathBuf::from(r"C:\Users\writer\model-proxy.mjs")
        );
        assert_eq!(
            node_compatible_path(Path::new(r"\\?\UNC\server\share\runtime.mjs")),
            PathBuf::from(r"\\server\share\runtime.mjs")
        );
    }
}
