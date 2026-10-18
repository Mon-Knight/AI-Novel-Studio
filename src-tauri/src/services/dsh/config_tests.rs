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
    assert!(yaml.contains("file:///F:/%E5%BA%94%E7%94%A8%20%E7%9B%AE%E5%BD%95/ans-task-server.mjs"));
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
    let gateway = root.join("gateway/novel-domain-gateway.exe");
    std::fs::create_dir_all(gateway.parent().expect("gateway parent")).expect("gateway dir");
    std::fs::write(&gateway, b"gateway").expect("write gateway");
    let gateway_hash = crate::repositories::large_text_repository::sha256_bytes(b"gateway");
    std::fs::write(
        root.join("VERSION_MATRIX.json"),
        format!(r#"{{"gatewaySha256":"{}"}}"#, gateway_hash),
    )
    .expect("write matrix");
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
    let gateway_hash = crate::repositories::large_text_repository::sha256_bytes(b"gateway");
    let recovered =
        recover_staging_for_gateway(&data_dir, &gateway_hash).expect("recover leftover payload");
    assert_eq!(recovered, data_dir.join("dsh-runtime"));
    assert!(payload_complete_for_gateway(&recovered, &gateway_hash));
    assert!(!data_dir.join(".dsh-runtime-unpack-1-1").exists());
    let _ = std::fs::remove_dir_all(&data_dir);
}

#[test]
fn rejects_payload_when_gateway_hash_is_stale() {
    let root = std::env::temp_dir().join(format!(
        "ans-dsh-stale-gateway-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos()
    ));
    write_complete_payload(&root);
    std::fs::write(root.join("gateway/novel-domain-gateway.exe"), b"stale")
        .expect("replace gateway");
    let gateway_hash = crate::repositories::large_text_repository::sha256_bytes(b"gateway");
    assert!(!payload_complete_for_gateway(&root, &gateway_hash));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn rejects_self_consistent_gateway_from_an_older_application() {
    let root = std::env::temp_dir().join(format!("ans-dsh-old-build-{}", uuid::Uuid::new_v4()));
    write_complete_payload(&root);
    let old_hash = crate::repositories::large_text_repository::sha256_bytes(b"gateway");
    let current_hash = crate::repositories::large_text_repository::sha256_bytes(b"new-gateway");
    assert!(payload_complete_for_gateway(&root, &old_hash));
    assert!(!payload_complete_for_gateway(&root, &current_hash));
    assert!(!payload_complete_for_gateway(&root, ""));
    std::fs::remove_dir_all(&root).expect("remove isolated fixture");
}

#[test]
fn checkout_filter_requires_existing_dir() {
    // Pure-function test: no global env mutation (avoids races with the
    // integration scenarios that read DSH_CHECKOUT in parallel threads).
    assert!(checkout_if_dir(None).is_none());
    assert!(checkout_if_dir(Some("".to_string())).is_none());
    assert!(checkout_if_dir(Some("F:\\definitely-not-a-real-dir-987654".to_string())).is_none());
    let existing = std::env::temp_dir().to_string_lossy().to_string();
    assert_eq!(
        checkout_if_dir(Some(existing.clone())).as_deref(),
        Some(existing.as_str())
    );
}

fn isolated_data(label: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!("ans-dsh-{label}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).expect("create isolated fixture");
    root
}

fn create_junction(link: &std::path::Path, target: &std::path::Path) {
    std::fs::create_dir_all(link.parent().expect("link parent")).expect("create link parent");
    let status = std::process::Command::new("node")
        .args([
            "-e",
            "require('node:fs').symlinkSync(process.argv[1], process.argv[2], 'junction')",
        ])
        .arg(target)
        .arg(link)
        .status()
        .expect("run local Node Junction fixture");
    assert!(status.success(), "create isolated runtime Junction");
}

fn write_alias(root: &std::path::Path) {
    create_junction(
        &root.join("protocol-alias"),
        &root.join("packages/sdk/protocol"),
    );
    std::fs::write(
        root.join("JUNCTIONS.json"),
        r#"[{"link":"protocol-alias","target":"packages/sdk/protocol"}]"#,
    )
    .expect("write Junction manifest");
}

#[test]
fn rejects_junctions_after_the_payload_is_relocated() {
    let data = isolated_data("relocated-junction");
    let source = data.join("staged-runtime");
    write_complete_payload(&source);
    write_alias(&source);
    let hash = crate::repositories::large_text_repository::sha256_bytes(b"gateway");
    assert!(payload_complete_for_gateway(&source, &hash));
    let relocated = data.join("dsh-runtime");
    std::fs::rename(&source, &relocated).expect("simulate interruption after carrier rename");
    assert!(!payload_complete_for_gateway(&relocated, &hash));
    std::fs::remove_dir_all(data).expect("remove isolated fixture");
}

#[test]
fn rejects_escaping_and_mismatched_junction_targets_without_touching_external_data() {
    let data = isolated_data("external-junction");
    let root = data.join("dsh-runtime");
    let external = data.join("external");
    write_complete_payload(&root);
    std::fs::create_dir_all(&external).expect("external fixture");
    std::fs::write(external.join("sentinel"), b"preserve").expect("external sentinel");
    create_junction(&root.join("protocol-alias"), &external);
    let hash = crate::repositories::large_text_repository::sha256_bytes(b"gateway");
    for target in ["../external", "packages/sdk/protocol"] {
        std::fs::write(
            root.join("JUNCTIONS.json"),
            serde_json::json!([{"link":"protocol-alias","target":target}]).to_string(),
        )
        .expect("write hostile manifest");
        assert!(!payload_complete_for_gateway(&root, &hash));
        assert_eq!(
            std::fs::read(external.join("sentinel")).expect("sentinel"),
            b"preserve"
        );
    }
    std::fs::remove_dir_all(data).expect("remove isolated fixture");
}

#[test]
fn checks_all_manifest_paths_even_outside_critical_packages() {
    let data = isolated_data("large-manifest");
    let root = data.join("dsh-runtime");
    write_complete_payload(&root);
    let mut entries = (0..129)
        .map(|index| serde_json::json!({"link":format!("alias-{index}"),"target":"packages/sdk/protocol"}))
        .collect::<Vec<_>>();
    entries.push(serde_json::json!({"link":"other-package/link","target":"../external"}));
    std::fs::write(
        root.join("JUNCTIONS.json"),
        serde_json::to_vec(&entries).expect("json"),
    )
    .expect("large manifest");
    assert!(validated_junction_count(&root).is_none());
    std::fs::remove_dir_all(data).expect("remove isolated fixture");
}

#[test]
fn large_manifest_checks_the_critical_boot_link_after_relocation() {
    let data = isolated_data("large-relocated-manifest");
    let source = data.join("staged-runtime");
    write_complete_payload(&source);
    let boot_link = "packages/examples/jsonrpc-demo/node_modules/@deepseek-ai/dsh-app-boot";
    create_junction(
        &source.join(boot_link),
        &source.join("packages/sdk/protocol"),
    );
    let mut entries = (0..129)
        .map(|index| serde_json::json!({"link":format!("other/alias-{index}"),"target":"packages/sdk/protocol"}))
        .collect::<Vec<_>>();
    entries.push(serde_json::json!({"link":boot_link,"target":"packages/sdk/protocol"}));
    std::fs::write(
        source.join("JUNCTIONS.json"),
        serde_json::to_vec(&entries).expect("json"),
    )
    .expect("large manifest");
    let hash = crate::repositories::large_text_repository::sha256_bytes(b"gateway");
    assert!(payload_complete_for_gateway(&source, &hash));
    let relocated = data.join("dsh-runtime");
    std::fs::rename(&source, &relocated).expect("simulate interruption after carrier rename");
    assert!(!payload_complete_for_gateway(&relocated, &hash));
    std::fs::remove_dir_all(data).expect("remove isolated fixture");
}

#[test]
fn leaves_staging_junctions_and_old_runtime_for_safe_bundled_reextraction() {
    let data = isolated_data("staging-junction");
    let final_root = data.join("dsh-runtime");
    let staged = data.join(".dsh-runtime-unpack-1-1/dsh-runtime");
    write_complete_payload(&final_root);
    std::fs::write(final_root.join("gateway/novel-domain-gateway.exe"), b"old")
        .expect("old gateway");
    write_complete_payload(&staged);
    write_alias(&staged);
    let hash = crate::repositories::large_text_repository::sha256_bytes(b"gateway");
    assert!(payload_complete_for_gateway(&staged, &hash));
    assert!(recover_staging_for_gateway(&data, &hash).is_none());
    assert_eq!(
        std::fs::read(final_root.join("gateway/novel-domain-gateway.exe")).expect("old"),
        b"old"
    );
    assert!(payload_complete_for_gateway(&staged, &hash));
    std::fs::remove_dir_all(data).expect("remove isolated fixture");
}

#[test]
fn failed_plain_staging_promotion_restores_the_original_runtime() {
    let data = isolated_data("promotion-failure");
    let final_root = data.join("dsh-runtime");
    let staged = data.join(".dsh-runtime-unpack-1-1/dsh-runtime");
    write_complete_payload(&final_root);
    std::fs::write(final_root.join("gateway/novel-domain-gateway.exe"), b"old")
        .expect("old gateway");
    write_complete_payload(&staged);
    let hash = crate::repositories::large_text_repository::sha256_bytes(b"gateway");
    assert!(promote_plain_staging(&staged, &final_root, &hash, |_, _| {
        Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "injected rename failure",
        ))
    })
    .is_none());
    assert_eq!(
        std::fs::read(final_root.join("gateway/novel-domain-gateway.exe")).expect("old"),
        b"old"
    );
    assert!(payload_complete_for_gateway(&staged, &hash));
    assert_eq!(std::fs::read_dir(&data).expect("read fixture").count(), 2);
    std::fs::remove_dir_all(data).expect("remove isolated fixture");
}

#[test]
fn failed_final_location_validation_restores_the_original_runtime() {
    let data = isolated_data("promotion-verification-failure");
    let final_root = data.join("dsh-runtime");
    let staged = data.join(".dsh-runtime-unpack-1-1/dsh-runtime");
    write_complete_payload(&final_root);
    std::fs::write(final_root.join("gateway/novel-domain-gateway.exe"), b"old")
        .expect("old gateway");
    write_complete_payload(&staged);
    let hash = crate::repositories::large_text_repository::sha256_bytes(b"gateway");
    assert!(
        promote_plain_staging(&staged, &final_root, &hash, |source, destination| {
            std::fs::rename(source, destination)?;
            std::fs::write(
                destination.join("gateway/novel-domain-gateway.exe"),
                b"corrupt",
            )
        })
        .is_none()
    );
    assert_eq!(
        std::fs::read(final_root.join("gateway/novel-domain-gateway.exe")).expect("old"),
        b"old"
    );
    assert!(staged.exists());
    assert_eq!(std::fs::read_dir(&data).expect("read fixture").count(), 2);
    std::fs::remove_dir_all(data).expect("remove isolated fixture");
}

#[test]
fn plain_staging_safely_replaces_a_stale_runtime() {
    let data = isolated_data("promotion-success");
    let final_root = data.join("dsh-runtime");
    let staged = data.join(".dsh-runtime-unpack-1-1/dsh-runtime");
    write_complete_payload(&final_root);
    std::fs::write(final_root.join("gateway/novel-domain-gateway.exe"), b"old")
        .expect("old gateway");
    write_complete_payload(&staged);
    let hash = crate::repositories::large_text_repository::sha256_bytes(b"gateway");
    assert_eq!(
        recover_staging_for_gateway(&data, &hash),
        Some(final_root.clone())
    );
    assert!(payload_complete_for_gateway(&final_root, &hash));
    assert_eq!(std::fs::read_dir(&data).expect("read fixture").count(), 1);
    std::fs::remove_dir_all(data).expect("remove isolated fixture");
}

#[test]
fn rejects_symlinked_runtime_and_staging_roots() {
    let data = isolated_data("root-symlink");
    let external = data.join("external/dsh-runtime");
    let final_root = data.join("dsh-runtime");
    write_complete_payload(&external);
    create_junction(&final_root, &external);
    let hash = crate::repositories::large_text_repository::sha256_bytes(b"gateway");
    assert!(!payload_complete_for_gateway(&final_root, &hash));
    let staged = data.join(".dsh-runtime-unpack-1-1/dsh-runtime");
    write_complete_payload(&staged);
    assert!(recover_staging_for_gateway(&data, &hash).is_none());
    assert!(final_root
        .symlink_metadata()
        .expect("root link")
        .file_type()
        .is_symlink());
    assert!(payload_complete_for_gateway(&external, &hash));
    std::fs::remove_dir_all(data).expect("remove isolated fixture");

    let data = isolated_data("staging-parent-symlink");
    let external = data.join("external/dsh-runtime");
    write_complete_payload(&external);
    create_junction(
        &data.join(".dsh-runtime-unpack-1-1"),
        external.parent().expect("external parent"),
    );
    assert!(recover_staging_for_gateway(&data, &hash).is_none());
    assert!(payload_complete_for_gateway(&external, &hash));
    std::fs::remove_dir_all(data).expect("remove isolated fixture");
}

#[test]
#[ignore = "read-only timing requires an explicitly supplied isolated pinned carrier"]
fn validates_real_carrier_junctions_without_a_full_pnpm_canonical_scan() {
    let root = std::path::PathBuf::from(
        std::env::var("ANS_DSH_JUNCTION_BENCH_ROOT").expect("isolated carrier"),
    );
    let start = std::time::Instant::now();
    let count = validated_junction_count(&root).expect("current carrier Junction integrity");
    let elapsed = start.elapsed();
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("JUNCTIONS.json")).expect("manifest"))
            .expect("json");
    let actual_checks = manifest
        .as_array()
        .expect("array")
        .iter()
        .filter(|entry| {
            critical_junction(std::path::Path::new(
                entry
                    .get("link")
                    .and_then(serde_json::Value::as_str)
                    .expect("link"),
            ))
        })
        .count();
    assert!(
        count > 128,
        "measure the real carrier, not an empty mock manifest"
    );
    println!(
        "carrier Junction integrity: {count} manifest paths + {actual_checks} actual targets in {} ms",
        elapsed.as_millis()
    );
}
