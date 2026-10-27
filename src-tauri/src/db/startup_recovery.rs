use rusqlite::Connection;
use std::time::Instant;

pub(super) fn recover_interrupted_work(connection: &mut Connection, total_started_at: Instant) {
    let mut phase_started_at = Instant::now();
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
}
