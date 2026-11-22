use rusqlite::Connection;
use std::time::Instant;

pub(super) fn recover_interrupted_work(connection: &mut Connection, total_started_at: Instant) {
    let mut phase_started_at = Instant::now();
    crate::services::ai_request_policy_service::recover_interrupted_reservations(connection)
        .expect("Failed to recover interrupted AI request reservations");
    super::record_e2e_startup_timing(
        "database",
        "ai_request_reservation_recovery",
        phase_started_at,
        total_started_at,
    );

    phase_started_at = Instant::now();
    crate::services::chapter_workflow_stage_service::recover_interrupted_stages(connection)
        .expect("Failed to recover interrupted chapter workflow stages");
    super::record_e2e_startup_timing(
        "database",
        "chapter_workflow_stage_recovery",
        phase_started_at,
        total_started_at,
    );

    phase_started_at = Instant::now();
    crate::services::agent_plan_service::recover_interrupted_plans(connection)
        .expect("Failed to recover interrupted Agent Plans");
    super::record_e2e_startup_timing(
        "database",
        "agent_plan_recovery",
        phase_started_at,
        total_started_at,
    );

    phase_started_at = Instant::now();
    crate::services::autonomous_scheduler_service::recover_interrupted_runs(connection)
        .expect("Failed to recover interrupted autonomous book runs");
    super::record_e2e_startup_timing(
        "database",
        "autonomous_recovery",
        phase_started_at,
        total_started_at,
    );

    #[cfg(not(test))]
    spawn_obsolete_dsh_residue_cleanup();
}

#[cfg(not(test))]
fn extended_windows_path(path: &std::path::Path) -> std::path::PathBuf {
    #[cfg(windows)]
    {
        let raw = path.to_string_lossy();
        if !raw.starts_with(r"\\?\") && path.is_absolute() {
            return std::path::PathBuf::from(format!(r"\\?\{raw}"));
        }
    }
    path.to_path_buf()
}

#[cfg(not(test))]
fn spawn_obsolete_dsh_residue_cleanup() {
    let data_dir = super::get_data_dir();
    let _ = std::thread::Builder::new()
        .name("ans-dsh-residue-cleanup".to_string())
        .spawn(move || {
            let _ = std::fs::remove_file(data_dir.join(".dsh-runtime.lock"));
            for dir_name in ["dsh-runtime", "dsh-task-workers"] {
                let target = data_dir.join(dir_name);
                if target.exists() {
                    let _ = std::fs::remove_dir_all(extended_windows_path(&target));
                }
            }
            if let Ok(entries) = std::fs::read_dir(&data_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let is_unpack = path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n.starts_with(".dsh-runtime-unpack-"));
                    if is_unpack {
                        let _ = std::fs::remove_dir_all(extended_windows_path(&path));
                    }
                }
            }
        });
}
