use std::fs;
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=../scripts/dsh/unpack-payload.mjs");
    println!("cargo:rerun-if-changed=bin/gateway-sha256.txt");
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let bin = manifest.join("bin");
    let zip = bin.join("dsh-runtime.zip");
    let unpacker = bin.join("unpack-payload.mjs");
    let release = std::env::var("PROFILE").ok().as_deref() == Some("release");
    let gateway_hash = fs::read_to_string(bin.join("gateway-sha256.txt"))
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let valid_gateway_hash =
        gateway_hash.len() == 64 && gateway_hash.chars().all(|value| value.is_ascii_hexdigit());
    if release && !valid_gateway_hash {
        panic!("release Gateway identity is missing; run npm run dsh:assets first");
    }
    println!("cargo:rustc-env=ANS_DSH_GATEWAY_SHA256={gateway_hash}");

    fs::create_dir_all(&bin).expect("create ignored DSH resource directory");
    if !unpacker.is_file() {
        fs::copy(
            manifest.join("../scripts/dsh/unpack-payload.mjs"),
            &unpacker,
        )
        .expect("stage DSH unpacker for debug resource validation");
    }
    if !zip.is_file() && !release {
        fs::write(&zip, []).expect("create ignored debug DSH zip placeholder");
    }
    if release
        && (fs::metadata(&zip).map(|value| value.len()).unwrap_or(0) == 0
            || fs::metadata(&unpacker)
                .map(|value| value.len())
                .unwrap_or(0)
                == 0)
    {
        panic!("release DSH resources are missing; run npm run dsh:assets first");
    }
    tauri_build::build()
}
