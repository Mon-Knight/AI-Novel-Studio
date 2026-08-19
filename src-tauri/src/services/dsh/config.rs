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

/// Pure filter: keeps a checkout path only when it names an existing directory.
pub fn checkout_if_dir(value: Option<String>) -> Option<String> {
    value.filter(|item| !item.trim().is_empty() && std::path::Path::new(item).is_dir())
}

/// Returns `DSH_CHECKOUT` when it names an existing directory.
pub fn checkout_from_env() -> Option<String> {
    checkout_if_dir(std::env::var("DSH_CHECKOUT").ok())
}

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
    let writable = crate::db::get_data_dir().join("dsh-runtime");
    if payload_complete(&writable) {
        return Some(writable.to_string_lossy().to_string());
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

fn unpack_bundled_payload(exe_dir: &std::path::Path) -> Option<std::path::PathBuf> {
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
    let destination = crate::db::get_data_dir();
    let status = std::process::Command::new("node")
        .arg(unpacker)
        .arg(zip)
        .arg(&destination)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .ok()?;
    let root = destination.join("dsh-runtime");
    if status.success() && payload_complete(&root) {
        Some(root)
    } else {
        None
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
        assert!(!yaml.contains("{CHECKOUT}"));
        assert!(!yaml.contains("{GATEWAY_BIN}"));
        assert!(!yaml.contains("{GATEWAY_DB}"));
    }

    #[test]
    fn encodes_non_ascii_and_special_chars() {
        let yaml = cordis_yml("F:\\作品 目录#1", "g", "d");
        assert!(yaml.contains("file:///F:/%E4%BD%9C%E5%93%81%20%E7%9B%AE%E5%BD%95%231"));
        assert!(!yaml.contains("作品"));
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
