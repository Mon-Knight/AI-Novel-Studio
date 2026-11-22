//! Authoritative finite text checks reuse the exact dependency-free Writer evaluator.
//! Only trusted embedded modules touch disk; manuscript material travels through stdin.
use super::*;
use serde::Serialize;
use std::io::{Read, Write};
use std::process::{Command, Stdio};

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Issue {
    pub code: String,
    pub summary: String,
    pub severity: String,
}

struct ModuleDirectory(PathBuf);
impl Drop for ModuleDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[cfg(windows)]
fn configure_background_process(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_background_process(_command: &mut Command) {}

fn node_compatible_path(path: &std::path::Path) -> PathBuf {
    #[cfg(windows)]
    {
        let rendered = path.to_string_lossy();
        if let Some(stripped) = rendered.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }
    path.to_path_buf()
}

pub(in super::super) fn inspect(
    root: Option<&execution::RootExecution>,
    pending: &chapter_gate::PendingChapterCandidate,
) -> Result<Vec<Issue>, String> {
    if let Some(root) = root {
        root.check()?;
    }
    if pending.text.len() > 4 * 1024 * 1024 {
        return Err("DSH_CHAPTER_INTEGRITY_INPUT_TOO_LARGE".into());
    }
    let directory =
        std::env::temp_dir().join(format!("ans-chapter-integrity-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&directory)
        .map_err(|_| "DSH_CHAPTER_INTEGRITY_DIRECTORY_FAILED".to_string())?;
    let directory = ModuleDirectory(directory);
    for (name,content) in [
        ("chapter-integrity.mjs",include_str!("../../../../scripts/dsh/chapter-integrity.mjs")),
        ("chapter-integrity-boundary.mjs",include_str!("../../../../scripts/dsh/chapter-integrity-boundary.mjs")),
        ("chapter-integrity-narrative.mjs",include_str!("../../../../scripts/dsh/chapter-integrity-narrative.mjs")),
        ("check.mjs","import { inspectChapterCandidateIntegrity } from './chapter-integrity.mjs';\nlet raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>8388608)process.exit(2);}const value=JSON.parse(raw);process.stdout.write(JSON.stringify(inspectChapterCandidateIntegrity(value)));"),
    ] { std::fs::write(directory.0.join(name),content).map_err(|_|"DSH_CHAPTER_INTEGRITY_MODULE_WRITE_FAILED".to_string())?; }
    let mut command = Command::new("node");
    configure_background_process(&mut command);
    let mut child = command
        .arg(node_compatible_path(&directory.0.join("check.mjs")))
        .current_dir(node_compatible_path(&directory.0))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "DSH_CHAPTER_INTEGRITY_NODE_UNAVAILABLE".to_string())?;
    let payload = serde_json::to_vec(
        &json!({"candidateText":pending.text,"previousChapterText":pending.previous_chapter_text}),
    )
    .map_err(|_| "DSH_CHAPTER_INTEGRITY_INPUT_INVALID".to_string())?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or("DSH_CHAPTER_INTEGRITY_STDIN_UNAVAILABLE")?;
    let write = std::thread::spawn(move || {
        let result = stdin.write_all(&payload);
        drop(stdin);
        result
    });
    let mut stdout = child
        .stdout
        .take()
        .ok_or("DSH_CHAPTER_INTEGRITY_STDOUT_UNAVAILABLE")?;
    let read = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .by_ref()
            .take(65_537)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let started = std::time::Instant::now();
    let result = loop {
        if root.is_some_and(|r| r.check().is_err()) || started.elapsed() > Duration::from_secs(15) {
            let _ = child.kill();
            let _ = child.wait();
            break Err("DSH_CHAPTER_INTEGRITY_INTERRUPTED".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                break if status.success() {
                    Ok(())
                } else {
                    Err("DSH_CHAPTER_INTEGRITY_CHECK_FAILED".into())
                }
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err("DSH_CHAPTER_INTEGRITY_WAIT_FAILED".into());
            }
        }
    };
    let written = write
        .join()
        .map_err(|_| "DSH_CHAPTER_INTEGRITY_INPUT_FAILED")?
        .map_err(|_| "DSH_CHAPTER_INTEGRITY_INPUT_FAILED");
    let bytes = read
        .join()
        .map_err(|_| "DSH_CHAPTER_INTEGRITY_OUTPUT_FAILED")?
        .map_err(|_| "DSH_CHAPTER_INTEGRITY_OUTPUT_FAILED")?;
    result?;
    written?;
    if bytes.len() > 65_536 {
        return Err("DSH_CHAPTER_INTEGRITY_OUTPUT_TOO_LARGE".into());
    }
    let issues: Vec<Issue> = serde_json::from_slice(&bytes)
        .map_err(|_| "DSH_CHAPTER_INTEGRITY_OUTPUT_INVALID".to_string())?;
    if issues.len() > 10
        || issues
            .iter()
            .any(|i| i.summary.chars().count() > 500 || !known_issue(&i.code, &i.severity))
    {
        return Err("DSH_CHAPTER_INTEGRITY_OUTPUT_INVALID".into());
    }
    Ok(issues)
}

fn known_issue(code: &str, severity: &str) -> bool {
    match code {
        "chapter_opening_rollback"
        | "chapter_boundary_sentence_repetition"
        | "chapter_tail_pollution"
        | "chapter_meta_reasoning_leakage"
        | "chapter_authorial_label_leakage" => severity == "error",
        "chapter_boundary_action_replay"
        | "chapter_source_chain_break"
        | "chapter_dialogue_reference_conflict"
        | "chapter_temporal_semantics_conflict"
        | "chapter_audit_voice_leakage" => severity == "warning",
        _ => false,
    }
}
