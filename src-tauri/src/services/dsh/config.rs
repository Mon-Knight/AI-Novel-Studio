//! Renders the production cordis.yml with file:// URL plugin specifiers
//! pointing at the pinned harness checkout's built packages, the novel domain
//! gateway binary and the read-only fixture/novel database path.
//!
//! P1 finding (spike): bare plugin `name:` rows resolve from the
//! *configuration project* directory, not from the runtime bin; absolute
//! Windows paths must be file:// URLs (percent-encoded spaces), which makes
//! the launch configuration fully self-contained.

/// The production composition template; `{CHECKOUT}`, `{GATEWAY_BIN}` and
/// `{GATEWAY_DB}` are replaced at render time.
const TEMPLATE: &str = include_str!("../../../../scripts/dsh/cordis-template.yml");
const TASK_SERVER_TEMPLATE: &str =
    include_str!("../../../../scripts/dsh/ans-task-server-template.mjs");

/// One entry in the immutable Cordis composition used by the conversational
/// workbench.  `required_paths` are availability checks only: a present file
/// never means the plugin was initialized or is healthy.
#[derive(Debug, Clone, Copy)]
pub struct RuntimeCompositionSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub kind: &'static str,
    pub required_paths: &'static [&'static str],
    pub capabilities: &'static [&'static str],
}

const TASK_SERVER_PATHS: &[&str] = &[
    "packages/sdk/protocol/lib/index.js",
    "packages/core/agent/lib/index.js",
    "packages/llm/llm/lib/index.js",
    "packages/core/session/lib/index.js",
];
const DEEPSEEK_PATHS: &[&str] = &["packages/llm/llm-deepseek/lib/index.js"];
const AGENT_SPINE_PATHS: &[&str] = &["packages/examples/agent-spine-demo/lib/index.js"];
const SESSION_PATHS: &[&str] = &["packages/session/session-persistence-jsonl/lib/index.js"];
const TOKEN_METER_PATHS: &[&str] = &["packages/llm/token-meter/lib/index.js"];
const COMPACTION_PATHS: &[&str] = &["packages/compaction/compaction-basic/lib/index.js"];
const MCP_PATHS: &[&str] = &["packages/mcp/mcp-client/lib/index.js"];

/// Static identity of the rendered composition. Runtime state is supplied by
/// the adapter's `runtime/health` response and must not be inferred from this
/// list.
pub const WORKBENCH_COMPOSITION: &[RuntimeCompositionSpec] = &[
    RuntimeCompositionSpec {
        id: "sdk-jsonrpc-server",
        name: "ANS Task Runtime Adapter",
        kind: "runtime",
        required_paths: TASK_SERVER_PATHS,
        capabilities: &[
            "initialize",
            "persistent-session",
            "resume",
            "scoped-cancel",
        ],
    },
    RuntimeCompositionSpec {
        id: "llm-deepseek",
        name: "DeepSeek Provider",
        kind: "model",
        required_paths: DEEPSEEK_PATHS,
        capabilities: &["provider-directory", "model-directory", "streaming"],
    },
    RuntimeCompositionSpec {
        id: "agent-spine",
        name: "Harness Agent Spine",
        kind: "runtime",
        required_paths: AGENT_SPINE_PATHS,
        capabilities: &["agent", "turn", "step", "tool-pipeline"],
    },
    RuntimeCompositionSpec {
        id: "sessions",
        name: "Session Persistence",
        kind: "storage",
        required_paths: SESSION_PATHS,
        capabilities: &["append-only-events", "flush", "resume"],
    },
    RuntimeCompositionSpec {
        id: "token-meter",
        name: "Token Meter",
        kind: "runtime",
        required_paths: TOKEN_METER_PATHS,
        capabilities: &["usage-metering"],
    },
    RuntimeCompositionSpec {
        id: "compaction-basic",
        name: "Session Compaction",
        kind: "runtime",
        required_paths: COMPACTION_PATHS,
        capabilities: &["session-compaction", "auto-compact"],
    },
    RuntimeCompositionSpec {
        id: "mcp-novel",
        name: "Novel MCP Gateway",
        kind: "tool",
        required_paths: MCP_PATHS,
        capabilities: &[
            "scoped-tool-registry",
            "read-only-context",
            "candidate-generation",
        ],
    },
];

/// Percent-encodes a path for use inside a file:// URL: unreserved chars,
/// ':' and '/' stay literal; everything else (spaces, non-ASCII, %, #, ?) is
/// encoded so Chinese user names or exotic install paths yield legal URLs.
fn url_encode_path(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' | b':' => {
                encoded.push(*byte as char)
            }
            _ => encoded.push_str(&format!("%{:02X}", byte)),
        }
    }
    encoded
}

/// Renders the cordis.yml for the given paths (backslashes normalized, URL-encoded).
pub fn cordis_yml(checkout: &str, gateway_bin: &str, gateway_db: &str) -> String {
    let checkout = url_encode_path(&checkout.replace('\\', "/"));
    let gateway_bin = gateway_bin.replace('\\', "/");
    let gateway_db = gateway_db.replace('\\', "/");
    TEMPLATE
        .replace("{CHECKOUT}", &checkout)
        .replace("{GATEWAY_BIN}", &gateway_bin)
        .replace("{GATEWAY_DB}", &gateway_db)
}

/// Renders the task-workbench composition with the ANS-owned thin JSON-RPC
/// plugin. The rest of the graph remains the pinned Harness Bundle/Profile
/// composition; only the protocol surface is replaced so it can call public
/// `agents.create/resume` and retain a live Agent handle.
pub fn task_cordis_yml(
    checkout: &str,
    gateway_bin: &str,
    gateway_db: &str,
    task_server: &std::path::Path,
) -> String {
    let encoded_checkout = url_encode_path(&checkout.replace('\\', "/"));
    let official_server = format!("file:///{encoded_checkout}/packages/sdk/server/lib/index.js");
    let task_server = format!(
        "file:///{}",
        url_encode_path(&task_server.to_string_lossy().replace('\\', "/"))
    );
    cordis_yml(checkout, gateway_bin, gateway_db).replace(&official_server, &task_server)
}

/// Materializes the ANS protocol plugin beside a task worker. All imports are
/// absolute URLs into the verified fixed carrier, so no ambient node_modules
/// or machine-global package can change the runtime composition.
pub fn task_server_script(checkout: &str, source_commit: &str, protocol: &str) -> String {
    TASK_SERVER_TEMPLATE
        .replace("{CHECKOUT}", &url_encode_path(&checkout.replace('\\', "/")))
        .replace("{SOURCE_COMMIT}", source_commit)
        .replace("{PROTOCOL}", protocol)
}

/// Pure filter: keeps a checkout path only when it names an existing directory.
pub fn checkout_if_dir(value: Option<String>) -> Option<String> {
    value.filter(|item| !item.trim().is_empty() && std::path::Path::new(item).is_dir())
}

/// Returns `DSH_CHECKOUT` when it names an existing directory.
pub fn checkout_from_env() -> Option<String> {
    checkout_if_dir(std::env::var("DSH_CHECKOUT").ok())
}

static UNPACK_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Resolves the runtime root (the directory whose layout mirrors the harness
/// checkout: packages/.../lib plus bin.js). Resolution order:
/// 1. `DSH_RUNTIME_ROOT` env (explicit carrier: checkout or payload);
/// 2. verified payload in the writable application-data directory;
/// 3. exe/resource-adjacent payload, or a bundled zip atomically unpacked into
///    application data;
/// 3. `DSH_CHECKOUT` env (built harness checkout, dev fallback).
pub fn runtime_root() -> Option<String> {
    if let Some(root) = checkout_if_dir(std::env::var("DSH_RUNTIME_ROOT").ok()) {
        return Some(root);
    }
    let data_dir = crate::db::get_data_dir();
    let writable = data_dir.join("dsh-runtime");
    if payload_complete(&writable) {
        return Some(writable.to_string_lossy().to_string());
    }
    if let Some(recovered) = recover_complete_staging(&data_dir) {
        return Some(recovered.to_string_lossy().to_string());
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for candidate in [
                dir.join("dsh-runtime"),
                dir.join("resources").join("dsh-runtime"),
            ] {
                if payload_complete(&candidate) {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
            if let Some(unpacked) = unpack_bundled_payload(dir) {
                return Some(unpacked.to_string_lossy().to_string());
            }
        }
    }
    checkout_from_env()
}

fn recover_complete_staging(data_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let final_root = data_dir.join("dsh-runtime");
    if payload_complete(&final_root) {
        return Some(final_root);
    }
    let mut staged = Vec::new();
    for entry in std::fs::read_dir(data_dir).ok()?.flatten() {
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if !name.starts_with(".dsh-runtime-unpack-") {
            continue;
        }
        let candidate = path.join("dsh-runtime");
        if payload_complete(&candidate) {
            staged.push((
                entry.metadata().and_then(|meta| meta.modified()).ok(),
                path,
                candidate,
            ));
        }
    }
    staged.sort_by(|left, right| right.0.cmp(&left.0));
    let (_, temporary, candidate) = staged.into_iter().next()?;
    if final_root.exists() {
        let _ = std::fs::remove_dir_all(&final_root);
    }
    std::fs::rename(&candidate, &final_root).ok()?;
    let _ = std::fs::remove_dir_all(&temporary);
    payload_complete(&final_root).then_some(final_root)
}

fn unpack_bundled_payload(exe_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let _guard = UNPACK_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let destination = crate::db::get_data_dir();
    let root = destination.join("dsh-runtime");
    if payload_complete(&root) {
        return Some(root);
    }
    if let Some(recovered) = recover_complete_staging(&destination) {
        return Some(recovered);
    }
    let roots = [
        exe_dir.to_path_buf(),
        exe_dir.join("resources"),
        exe_dir.join("bin"),
        exe_dir.join("resources").join("bin"),
    ];
    let (zip, unpacker) = roots.iter().find_map(|root| {
        let zip = root.join("dsh-runtime.zip");
        let unpacker = root.join("unpack-payload.mjs");
        (zip.is_file() && unpacker.is_file()).then(|| (zip, unpacker))
    })?;
    let status = std::process::Command::new("node")
        .arg(unpacker)
        .arg(zip)
        .arg(&destination)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .ok()?;
    if status.success() && payload_complete(&root) {
        Some(root)
    } else {
        recover_complete_staging(&destination)
    }
}

/// A payload counts as usable only when every runtime-critical piece exists.
fn payload_complete(root: &std::path::Path) -> bool {
    root.join("packages/examples/jsonrpc-demo/lib/bin.js")
        .is_file()
        && root.join("packages/sdk/server/lib/index.js").is_file()
        && root.join("packages/sdk/protocol/lib/index.js").is_file()
        && root.join("VERSION_MATRIX.json").is_file()
        && root.join("JUNCTIONS.json").is_file()
        && root.join("node_modules/.pnpm").is_dir()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_file_urls_with_percent_encoding() {
        let yaml = cordis_yml(
            "F:\\DeepSeek Harness",
            "F:\\app\\gateway.exe",
            "F:\\app\\novel.db",
        );
        assert!(yaml.contains("file:///F:/DeepSeek%20Harness/packages/sdk/server/lib/index.js"));
        assert!(yaml.contains("command: 'F:/app/gateway.exe'"));
        assert!(yaml.contains("args: ['--db', 'F:/app/novel.db']"));
        assert!(yaml.contains("toolBash: false"));
        assert!(!yaml.contains("enableRunInBackground"));
        assert!(!yaml.contains("{CHECKOUT}"));
        assert!(!yaml.contains("{GATEWAY_BIN}"));
        assert!(!yaml.contains("{GATEWAY_DB}"));
    }

    #[test]
    fn renders_persistent_task_server_from_fixed_carrier() {
        let yaml = task_cordis_yml(
            "F:\\DeepSeek Harness",
            "F:\\app\\gateway.exe",
            "F:\\app\\novel.db",
            std::path::Path::new("F:\\应用 目录\\ans-task-server.mjs"),
        );
        assert!(
            yaml.contains("file:///F:/%E5%BA%94%E7%94%A8%20%E7%9B%AE%E5%BD%95/ans-task-server.mjs")
        );
        assert!(!yaml.contains("packages/sdk/server/lib/index.js"));

        let script = task_server_script(
            "F:\\DeepSeek Harness",
            "47f943859bef60e4160492346772ded9b24f765a",
            "ans_task_session_v2",
        );
        assert!(script.contains("file:///F:/DeepSeek%20Harness/"));
        assert!(script.contains("47f943859bef60e4160492346772ded9b24f765a"));
        assert!(script.contains("ans_task_session_v2"));
        assert!(!script.contains("{CHECKOUT}"));
        assert!(!script.contains("{SOURCE_COMMIT}"));
        assert!(!script.contains("{PROTOCOL}"));
    }

    #[test]
    fn runtime_composition_manifest_matches_the_rendered_template() {
        let ids = WORKBENCH_COMPOSITION
            .iter()
            .map(|entry| entry.id)
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(ids.len(), WORKBENCH_COMPOSITION.len());
        for entry in WORKBENCH_COMPOSITION {
            assert!(
                TEMPLATE.contains(&format!("- id: {}", entry.id)),
                "composition entry missing from template: {}",
                entry.id
            );
            assert!(!entry.required_paths.is_empty());
            assert!(!entry.capabilities.is_empty());
        }
    }

    #[test]
    fn encodes_non_ascii_and_special_chars() {
        let yaml = cordis_yml("F:\\作品 目录#1", "g", "d");
        assert!(yaml.contains("file:///F:/%E4%BD%9C%E5%93%81%20%E7%9B%AE%E5%BD%95%231"));
        assert!(!yaml.contains("作品"));
    }

    fn write_complete_payload(root: &std::path::Path) {
        for relative in [
            "packages/examples/jsonrpc-demo/lib/bin.js",
            "packages/sdk/server/lib/index.js",
            "packages/sdk/protocol/lib/index.js",
            "node_modules/.pnpm/placeholder.txt",
        ] {
            let path = root.join(relative);
            std::fs::create_dir_all(path.parent().expect("parent")).expect("create parent");
            std::fs::write(&path, b"ok").expect("write payload file");
        }
        std::fs::write(root.join("VERSION_MATRIX.json"), "{}").expect("write matrix");
        std::fs::write(root.join("JUNCTIONS.json"), "[]").expect("write junctions");
    }

    #[test]
    fn recovers_complete_leftover_unpack_directory() {
        let data_dir = std::env::temp_dir().join(format!(
            "ans-dsh-recover-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        let leftover = data_dir.join(".dsh-runtime-unpack-1-1").join("dsh-runtime");
        write_complete_payload(&leftover);
        let recovered = recover_complete_staging(&data_dir).expect("recover leftover payload");
        assert_eq!(recovered, data_dir.join("dsh-runtime"));
        assert!(payload_complete(&recovered));
        assert!(!data_dir.join(".dsh-runtime-unpack-1-1").exists());
        let _ = std::fs::remove_dir_all(&data_dir);
    }

    #[test]
    fn checkout_filter_requires_existing_dir() {
        // Pure-function test: no global env mutation (avoids races with the
        // integration scenarios that read DSH_CHECKOUT in parallel threads).
        assert!(checkout_if_dir(None).is_none());
        assert!(checkout_if_dir(Some("".to_string())).is_none());
        assert!(
            checkout_if_dir(Some("F:\\definitely-not-a-real-dir-987654".to_string())).is_none()
        );
        let existing = std::env::temp_dir().to_string_lossy().to_string();
        assert_eq!(
            checkout_if_dir(Some(existing.clone())).as_deref(),
            Some(existing.as_str())
        );
    }
}
