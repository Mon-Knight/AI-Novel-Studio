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
    recover_staging_for_gateway(data_dir, env!("ANS_DSH_GATEWAY_SHA256"))
}

fn recover_staging_for_gateway(
    data_dir: &std::path::Path,
    gateway_hash: &str,
) -> Option<std::path::PathBuf> {
    let final_root = data_dir.join("dsh-runtime");
    if payload_complete_for_gateway(&final_root, gateway_hash) {
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
        if !entry.file_type().ok().is_some_and(|kind| kind.is_dir()) {
            continue;
        }
        let candidate = path.join("dsh-runtime");
        // Absolute Junctions belong to their staging location. Leave these
        // carriers untouched for the bundled unpacker to rebuild safely.
        if validated_junction_count(&candidate) == Some(0)
            && payload_complete_for_gateway(&candidate, gateway_hash)
        {
            staged.push((
                entry.metadata().and_then(|meta| meta.modified()).ok(),
                path,
                candidate,
            ));
        }
    }
    staged.sort_by(|left, right| right.0.cmp(&left.0));
    let (_, temporary, candidate) = staged.into_iter().next()?;
    promote_plain_staging(
        &candidate,
        &final_root,
        gateway_hash,
        |source, destination| std::fs::rename(source, destination),
    )?;
    let _ = std::fs::remove_dir_all(&temporary);
    Some(final_root)
}

fn promote_plain_staging(
    candidate: &std::path::Path,
    final_root: &std::path::Path,
    gateway_hash: &str,
    rename_candidate: impl FnOnce(&std::path::Path, &std::path::Path) -> std::io::Result<()>,
) -> Option<()> {
    if validated_junction_count(candidate) != Some(0)
        || !payload_complete_for_gateway(candidate, gateway_hash)
    {
        return None;
    }
    let previous =
        final_root.with_file_name(format!(".dsh-runtime-recovery-{}", uuid::Uuid::new_v4()));
    let had_previous = match std::fs::symlink_metadata(final_root) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => true,
        Ok(_) => return None,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(_) => return None,
    };
    if had_previous {
        std::fs::rename(final_root, &previous).ok()?;
    }
    if rename_candidate(candidate, final_root).is_err() {
        if had_previous {
            let _ = std::fs::rename(&previous, final_root);
        }
        return None;
    }
    if !payload_complete_for_gateway(final_root, gateway_hash) {
        let _ = std::fs::rename(final_root, candidate);
        if had_previous {
            let _ = std::fs::rename(&previous, final_root);
        }
        return None;
    }
    if had_previous {
        let _ = std::fs::remove_dir_all(previous);
    }
    Some(())
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

fn payload_gateway_matches_matrix(root: &std::path::Path, current_gateway_hash: &str) -> bool {
    if current_gateway_hash.len() != 64 {
        return false;
    }
    let expected = std::fs::read_to_string(root.join("VERSION_MATRIX.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|matrix| {
            matrix
                .get("gatewaySha256")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        });
    let Some(expected) = expected else {
        return false;
    };
    if expected.len() != 64
        || !expected.eq_ignore_ascii_case(current_gateway_hash)
        || !expected
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return false;
    }
    let gateway = root.join("gateway/novel-domain-gateway.exe");
    std::fs::read(gateway)
        .ok()
        .map(|bytes| crate::repositories::large_text_repository::sha256_bytes(&bytes))
        .is_some_and(|actual| actual.eq_ignore_ascii_case(&expected))
}

fn relative_junction_path(root: &std::path::Path, value: &str) -> Option<std::path::PathBuf> {
    let relative = std::path::Path::new(value);
    (!value.is_empty()
        && relative
            .components()
            .all(|component| matches!(component, std::path::Component::Normal(_))))
    .then(|| root.join(relative))
}

fn critical_junction(link: &std::path::Path) -> bool {
    std::iter::once("packages/examples/jsonrpc-demo/lib/bin.js")
        .chain(TASK_SERVER_PATHS.iter().copied())
        .chain(
            WORKBENCH_COMPOSITION
                .iter()
                .flat_map(|entry| entry.required_paths.iter().copied()),
        )
        .filter_map(|required| required.split_once("/lib/").map(|(package, _)| package))
        .any(|package| link.starts_with(std::path::Path::new(package).join("node_modules")))
}

// Every manifest path is checked lexically; actual targets are checked for
// entry-point packages (or every entry in a small manifest). Resolving all
// 5,000+ pnpm links during each runtime health poll is prohibitively slow.
fn validated_junction_count(root: &std::path::Path) -> Option<usize> {
    let metadata = std::fs::symlink_metadata(root).ok()?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return None;
    }
    let canonical_root = root.canonicalize().ok()?;
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("JUNCTIONS.json")).ok()?).ok()?;
    let junctions = manifest.as_array()?;
    for entry in junctions {
        let relative_link = entry.get("link")?.as_str()?;
        let link = relative_junction_path(root, relative_link)?;
        let target = relative_junction_path(root, entry.get("target")?.as_str()?)?;
        if link == target {
            return None;
        }
        if junctions.len() <= 128 || critical_junction(std::path::Path::new(relative_link)) {
            let actual = link.canonicalize().ok()?;
            let expected = target.canonicalize().ok()?;
            if actual != expected || !actual.starts_with(&canonical_root) {
                return None;
            }
        }
    }
    Some(junctions.len())
}

/// A payload counts as usable only when every runtime-critical piece exists
/// and its Gateway matches both VERSION_MATRIX and this application build.
pub(crate) fn payload_complete(root: &std::path::Path) -> bool {
    payload_complete_for_gateway(root, env!("ANS_DSH_GATEWAY_SHA256"))
}

fn payload_complete_for_gateway(root: &std::path::Path, gateway_hash: &str) -> bool {
    root.join("packages/examples/jsonrpc-demo/lib/bin.js")
        .is_file()
        && root.join("packages/sdk/server/lib/index.js").is_file()
        && root.join("packages/sdk/protocol/lib/index.js").is_file()
        && root.join("VERSION_MATRIX.json").is_file()
        && validated_junction_count(root).is_some()
        && root.join("node_modules/.pnpm").is_dir()
        && payload_gateway_matches_matrix(root, gateway_hash)
}

/// Locates the gateway binary: DSH_GATEWAY_BIN env, then next to the app exe.
pub(crate) fn resolve_gateway_bin() -> Result<String, String> {
    if let Ok(bin) = std::env::var("DSH_GATEWAY_BIN") {
        if !bin.trim().is_empty() && std::path::Path::new(&bin).is_file() {
            return Ok(bin);
        }
    }
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        .ok_or_else(|| "无法定位应用可执行目录".to_string())?;
    let data_root = crate::db::get_data_dir().join("dsh-runtime");
    let candidates = [
        payload_complete(&data_root).then(|| data_root.join("gateway/novel-domain-gateway.exe")),
        Some(exe_dir.join("dsh-runtime/gateway/novel-domain-gateway.exe")),
        Some(exe_dir.join("novel-domain-gateway.exe")),
    ];
    if let Some(candidate) = candidates
        .iter()
        .flatten()
        .find(|candidate| candidate.is_file())
    {
        return Ok(candidate.to_string_lossy().to_string());
    }
    Err(format!(
        "novel-domain-gateway 未找到（可设 DSH_GATEWAY_BIN 指定）；已检查应用数据和安装目录"
    ))
}

#[cfg(test)]
#[path = "config_tests.rs"]
mod tests;
