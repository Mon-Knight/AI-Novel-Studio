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

/// Renders the cordis.yml for the given paths (backslashes normalized).
pub fn cordis_yml(checkout: &str, gateway_bin: &str, gateway_db: &str) -> String {
    let checkout = checkout.replace(' ', "%20").replace('\\', "/");
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
/// 2. exe-adjacent `dsh-runtime/` payload (also `resources/dsh-runtime` for
///    bundled Windows installs); the payload is only accepted when COMPLETE
///    (bin.js + server entry + VERSION_MATRIX.json + .pnpm store), so a partial
///    build can never shadow a usable DSH_CHECKOUT;
/// 3. `DSH_CHECKOUT` env (built harness checkout, dev fallback).
pub fn runtime_root() -> Option<String> {
    if let Some(root) = checkout_if_dir(std::env::var("DSH_RUNTIME_ROOT").ok()) {
        return Some(root);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for candidate in [dir.join("dsh-runtime"), dir.join("resources").join("dsh-runtime")] {
                if payload_complete(&candidate) {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
        }
    }
    checkout_from_env()
}

/// A payload counts as usable only when every runtime-critical piece exists.
fn payload_complete(root: &std::path::Path) -> bool {
    root.join("packages/examples/jsonrpc-demo/lib/bin.js").is_file()
        && root.join("packages/sdk/server/lib/index.js").is_file()
        && root.join("packages/sdk/protocol/lib/index.js").is_file()
        && root.join("VERSION_MATRIX.json").is_file()
        && root.join("node_modules/.pnpm").is_dir()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_file_urls_with_percent_encoding() {
        let yaml = cordis_yml("F:\\DeepSeek Harness", "F:\\app\\gateway.exe", "F:\\app\\novel.db");
        assert!(yaml.contains("file:///F:/DeepSeek%20Harness/packages/sdk/server/lib/index.js"));
        assert!(yaml.contains("command: 'F:/app/gateway.exe'"));
        assert!(yaml.contains("args: ['--db', 'F:/app/novel.db']"));
        assert!(!yaml.contains("{CHECKOUT}"));
        assert!(!yaml.contains("{GATEWAY_BIN}"));
        assert!(!yaml.contains("{GATEWAY_DB}"));
    }

    #[test]
    fn checkout_filter_requires_existing_dir() {
        // Pure-function test: no global env mutation (avoids races with the
        // integration scenarios that read DSH_CHECKOUT in parallel threads).
        assert!(checkout_if_dir(None).is_none());
        assert!(checkout_if_dir(Some("".to_string())).is_none());
        assert!(checkout_if_dir(Some("F:\\definitely-not-a-real-dir-987654".to_string())).is_none());
        let existing = std::env::temp_dir().to_string_lossy().to_string();
        assert_eq!(checkout_if_dir(Some(existing.clone())).as_deref(), Some(existing.as_str()));
    }
}
