param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
        'components',
        'workspace-reliability',
        'workspace-recovery',
        'large-text-integrity',
        'migrations',
        'ai-task-pipeline',
        'ai-artifacts',
        'ai-p0-safety',
        'placement',
        'apply-plan',
        'constraint-validation',
        'chapter-diff',
        'candidate-lifecycle',
        'ai-task-center',
        'ai-worker',
        'ai-workflow'
    )]
    [string]$Suite
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$vitestWrapper = Join-Path $PSScriptRoot 'run_vitest_suite.ps1'
$manifest = Join-Path $repoRoot 'src-tauri\Cargo.toml'

$suiteConfig = @{
    'components' = @{
        TestPath = 'src/test/components'
        CargoTests = @()
    }
    'workspace-reliability' = @{
        TestPath = 'src/test/workspace-reliability'
        CargoTests = @()
    }
    'workspace-recovery' = @{
        TestPath = 'src/test/workspace-recovery'
        CargoTests = @(
            'services::recovery_service::tests::db12_recovery_upsert_keeps_latest_snapshot',
            'services::recovery_service::tests::db13_recovery_cleanup_is_exact',
            'services::recovery_service::tests::db14_recovery_is_isolated_from_draft_history'
        )
    }
    'large-text-integrity' = @{
        TestPath = 'src/test/large-text-integrity'
        CargoTests = @(
            'services::draft_service::tests::db04_hash_mismatch_rolls_back_everything',
            'services::draft_service::tests::db05_chunk_failure_rolls_back_transaction',
            'services::draft_service::tests::db06_missing_update_target_rolls_back',
            'services::draft_service::tests::db07_cross_chapter_update_is_rejected',
            'services::draft_service::tests::db08_operation_retry_returns_one_business_result',
            'services::draft_service::tests::db09_operation_payload_conflict_is_rejected',
            'services::draft_service::tests::db10_cleanup_failure_after_commit_still_succeeds',
            'services::draft_service::tests::db11_corrupt_large_text_returns_unavailable'
        )
    }
    'migrations' = @{
        TestPath = 'src/test/migrations'
        CargoTests = @(
            'migrations::tests::db01_initializes_ordered_migration_ledger',
            'migrations::tests::db02_repeated_migration_is_idempotent',
            'migrations::tests::db03_checksum_conflict_stops_migrations',
            'migrations::tests::db15_upgrades_legacy_schema_and_preserves_draft',
            'migrations::tests::db17_m1_schema_has_all_tables_indexes_and_foreign_keys',
            'migrations::tests::db18_failed_migration_rolls_back_only_the_current_item',
            'migrations::tests::db19_upgrade_preserves_adopted_pointer_and_legacy_ai_rows',
            'db::tests::db20_empty_database_initializes_complete_m2_ledger',
            'migrations::tests::db21_snapshots_reject_update_and_delete',
            'migrations::tests::db22_v220_ledger_upgrades_from_005_and_restarts_idempotently',
            'migrations::tests::db23_m2_schema_has_tables_indexes_and_triggers',
            'migrations::tests::db24_m2_proposal_plan_and_link_reject_delete',
            'migrations::tests::db25_exact_legacy_snapshot_baseline_upgrades_through_015',
            'migrations::tests::db26_unknown_legacy_snapshot_checksums_fail_closed',
            'migrations::tests::db27_mixed_legacy_snapshot_checksums_fail_closed',
            'migrations::tests::db28_fake_legacy_snapshot_schema_fails_closed',
            'migrations::tests::db29_incomplete_legacy_ledger_fails_before_forward_writes',
            'migrations::tests::db30_fake_existing_delete_guard_blocks_015',
            'migrations::tests::db35_orchestration_upgrade_is_idempotent_and_enforces_graph_integrity',
            'db::tests::db31_database_initialization_failure_returns_error',
            'tests::db32_database_startup_errors_are_classified',
            'tests::db33_database_startup_notice_redacts_internal_details',
            'db::tests::db34_malformed_database_returns_sqlite_diagnostics',
            'errors::tests::db16_app_error_serializes_as_stable_object'
        )
    }
    'ai-task-pipeline' = @{
        TestPath = 'src/test/ai-task-pipeline'
        CargoTests = @(
            'domain::ai_task::tests::task01_accepts_frozen_legal_edges',
            'domain::ai_task::tests::task02_rejects_illegal_and_terminal_edges',
            'services::ai_task_service::tests::task03_create_is_idempotent_and_conflicts_on_changed_payload',
            'services::ai_task_service::tests::task04_snapshots_are_persisted_once_without_secrets',
            'services::ai_task_service::tests::task05_cas_rejects_stale_worker_and_illegal_transition',
            'services::ai_task_service::tests::task06_double_worker_creates_only_one_attempt',
            'services::ai_task_service::tests::task07_retry_creates_new_attempt_only_for_retryable_error',
            'services::ai_task_service::tests::task08_cancelled_late_response_never_creates_artifact',
            'services::ai_task_service::tests::task09_queued_cancel_creates_no_provider_attempt',
            'services::ai_task_service::tests::task10_non_retryable_failure_cannot_create_second_attempt',
            'services::ai_task_service::tests::task11_late_response_metadata_excludes_response_body',
            'services::ai_task_service::tests::task12_snapshot_update_is_rejected_by_immutable_boundary',
            'services::ai_task_service::tests::task13_completed_task_cannot_be_restarted',
            'services::ai_task_service::tests::task14_client_request_hash_mismatch_fails_closed',
            'services::ai_task_service::tests::task15_abort_acknowledgement_finalizes_cancellation',
            'services::ai_task_service::tests::task16_cross_task_attempt_identity_is_rejected',
            'services::ai_task_service::tests::task17_cancel_race_marks_provider_success_as_late_response',
            'services::ai_task_service::tests::task18_snapshot_insert_failure_rolls_back_task_and_creates_no_attempt'
        )
    }
    'ai-artifacts' = @{
        TestPath = 'src/test/ai-artifacts'
        CargoTests = @(
            'services::artifact_service::tests::art01_malformed_json_keeps_raw_artifact_and_fails_task',
            'services::artifact_service::tests::art02_large_raw_response_round_trips_without_preview_truncation',
            'services::artifact_service::tests::art03_provider_target_is_non_authoritative_warning',
            'services::artifact_service::tests::art04_repository_rejects_in_place_content_update',
            'services::artifact_service::tests::art05_schema_version_is_persisted_as_identity',
            'services::artifact_service::tests::art07_chapter_artifact_without_source_baseline_is_invalid',
            'services::artifact_service::tests::art08_empty_response_is_invalid_but_raw_reference_exists',
            'services::artifact_service::tests::art09_cancelled_task_rejects_artifact_creation',
            'services::artifact_service::tests::art10_connection_test_requires_exact_ok_semantics',
            'services::artifact_service::tests::art11_validation_issue_never_contains_full_provider_body'
        )
    }
    'ai-p0-safety' = @{
        TestPath = 'src/test/ai-p0-safety'
        CargoTests = @(
            'services::draft_service::tests::p001_adopts_the_displayed_draft_instead_of_latest',
            'services::draft_service::tests::p002_adopt_rejects_changed_hash_and_replays_same_operation',
            'services::draft_service::tests::p003_tauri_draft_preserves_task_artifact_note_and_source'
        )
    }
    'placement' = @{
        TestPath = 'src/test/placement'
        CargoTests = @(
            'services::apply_service::tests::plc01_creates_one_ready_task_scope_target',
            'services::apply_service::tests::plc02_user_target_has_priority_and_keeps_scope_candidate',
            'services::apply_service::tests::plc03_invalid_artifact_is_rejected',
            'services::apply_service::tests::plc04_cross_novel_user_target_is_rejected',
            'services::apply_service::tests::plc05_chapter_revision_change_makes_proposal_stale',
            'services::apply_service::tests::plc06_draft_hash_change_makes_proposal_stale',
            'services::apply_service::tests::plc07_rebuild_creates_new_immutable_child',
            'services::apply_service::tests::plc08_proposal_delete_is_protected',
            'services::apply_service::tests::plc09_target_delete_is_protected',
            'services::apply_service::tests::plc10_deleted_target_is_stale'
        )
    }
    'apply-plan' = @{
        TestPath = 'src/test/apply-plan'
        CargoTests = @(
            'services::apply_service::tests::apply01_plan_is_ready_and_single_target',
            'services::apply_service::tests::apply02_plan_request_is_immutable',
            'services::apply_service::tests::apply03_plan_delete_is_protected',
            'services::apply_service::tests::apply04_request_hash_mismatch_fails_closed',
            'services::apply_service::tests::apply05_operation_id_mismatch_fails_closed',
            'services::apply_service::tests::apply06_stale_version_prevents_business_write',
            'services::apply_service::tests::apply07_execute_creates_adopted_draft_and_link',
            'services::apply_service::tests::apply08_replay_returns_first_result_without_second_write',
            'services::apply_service::tests::apply09_target_link_delete_is_protected',
            'services::apply_service::tests::apply10_link_failure_rolls_back_draft_and_adoption',
            'services::apply_service::tests::apply11_quality_fix_side_effects_commit_together',
            'services::apply_service::tests::apply12_missing_quality_issue_rolls_back_everything'
        )
    }
    'constraint-validation' = @{
        TestPath = 'src/test/constraint-validation'
        CargoTests = @(
            'services::constraint_validation_service::tests::cv01_runs_are_append_only_and_latest_block_controls_authority_gate'
        )
    }
    'chapter-diff' = @{
        TestPath = 'src/test/chapter-diff'
        CargoTests = @()
    }
    'candidate-lifecycle' = @{
        TestPath = 'src/test/candidate-lifecycle'
        CargoTests = @(
            'services::artifact_service::tests::art12_recovers_latest_completed_chapter_candidate_without_new_schema',
            'services::artifact_service::tests::art13_running_task_is_exposed_for_interrupted_recovery_without_a_candidate'
        )
    }
    'ai-task-center' = @{
        TestPath = 'src/test/ai-task-center'
        CargoTests = @(
            'repositories::ai_task_view_repository::tests::task_center01_unified_source_wins_exact_id_dedup',
            'repositories::ai_task_view_repository::tests::task_center02_completed_candidate_waits_for_review',
            'repositories::ai_task_view_repository::tests::task_center03_query_failure_is_an_error_not_empty',
            'repositories::ai_task_view_repository::tests::task_center04_reopens_sqlite_and_restores_persisted_task'
        )
    }
    'ai-worker' = @{
        TestPath = 'src/test/ai-worker'
        CargoTests = @(
            'ai_worker::tests::worker01_two_workers_cannot_claim_the_same_task',
            'ai_worker::tests::worker02_progress_and_lease_are_persisted',
            'ai_worker::tests::worker03_expired_lease_recovers_with_new_attempt',
            'ai_worker::tests::worker04_cancel_request_reaches_terminal_cancelled',
            'ai_worker::tests::worker05_temporary_error_queues_a_new_attempt',
            'ai_worker::tests::worker06_success_creates_exactly_one_artifact_and_no_canon_write',
            'ai_worker::tests::worker07_malformed_result_fails_and_is_not_reported_success',
            'ai_worker::tests::worker08_mock_provider_honors_cancellation_token',
            'ai_worker::tests::worker09_dependency_is_rechecked_at_claim_time',
            'ai_worker::tests::worker10_parallel_nodes_are_claimed_once_each',
            'ai_worker::tests::worker11_mock_workflow_creates_one_review_bundle_without_canon_write',
            'ai_worker::tests::worker12_local_retry_creates_attempt_only_for_failed_child',
            'ai_worker::tests::worker16_stage_2e_quality_revision_completes_once_without_canon_write',
            'ai_worker::tests::worker17_stage_2e_local_retry_only_repeats_failed_child',
            'ai_worker::tests::worker18_stage_2e_stale_late_response_creates_no_artifact'
        )
    }
    'ai-workflow' = @{
        TestPath = 'src/test/ai-task-center'
        CargoTests = @(
            'services::workflow_service::tests::workflow01_parent_root_children_and_dependencies_are_persisted',
            'services::workflow_service::tests::workflow02_cross_project_dependency_and_cycle_are_rejected',
            'services::workflow_service::tests::workflow03_dependency_blocks_then_releases_downstream',
            'services::workflow_service::tests::workflow04_local_retry_preserves_successful_siblings',
            'services::workflow_service::tests::workflow05_parent_cancel_cascades_and_keeps_completed_artifact',
            'services::workflow_service::tests::workflow06_stale_propagates_to_tasks_and_artifacts',
            'services::workflow_service::tests::workflow07_reopen_restores_graph_state',
            'services::workflow_service::tests::workflow08_adopted_draft_change_marks_entire_workflow_stale',
            'services::workflow_service::tests::workflow09_parent_status_is_derived_from_required_children',
            'services::apply_service::tests::workflow_stale_artifact_cannot_create_apply_plan',
            'ai_worker::tests::worker09_dependency_is_rechecked_at_claim_time',
            'ai_worker::tests::worker10_parallel_nodes_are_claimed_once_each',
            'ai_worker::tests::worker11_mock_workflow_creates_one_review_bundle_without_canon_write',
            'ai_worker::tests::worker12_local_retry_creates_attempt_only_for_failed_child',
            'ai_worker::tests::worker16_stage_2e_quality_revision_completes_once_without_canon_write',
            'ai_worker::tests::worker17_stage_2e_local_retry_only_repeats_failed_child',
            'ai_worker::tests::worker18_stage_2e_stale_late_response_creates_no_artifact'
        )
    }
}

$config = $suiteConfig[$Suite]
& powershell -NoProfile -ExecutionPolicy Bypass -File $vitestWrapper -TestPath $config.TestPath
$vitestExitCode = $LASTEXITCODE
if ($vitestExitCode -ne 0) {
    exit $vitestExitCode
}

$cargoTests = @($config.CargoTests)
if ($cargoTests.Count -eq 0) {
    exit 0
}

# Cargo writes normal compilation progress and warnings to stderr. Capturing
# stderr in Windows PowerShell while ErrorActionPreference is Stop promotes
# those harmless lines to NativeCommandError and produces a false failure.
$listOutput = @(& cargo test --manifest-path $manifest -- --list)
$listExitCode = $LASTEXITCODE
$listOutput | ForEach-Object { Write-Host $_ }
if ($listExitCode -ne 0) {
    Write-Error "cargo test --list failed with exit code $listExitCode"
    exit $listExitCode
}

foreach ($cargoTest in $cargoTests) {
    $exactPattern = '^' + [regex]::Escape($cargoTest) + ': test$'
    $matched = @(
        $listOutput | Where-Object { "$_" -match $exactPattern }
    ).Count
    if ($matched -ne 1) {
        Write-Error "Required Rust/SQLite test '$cargoTest' was discovered $matched times. Refusing a zero-test or ambiguous pass."
        exit 5
    }
}

& cargo test --manifest-path $manifest -- --nocapture
$cargoExitCode = $LASTEXITCODE
if ($cargoExitCode -ne 0) {
    Write-Error "Rust/SQLite suite failed with exit code $cargoExitCode"
}
exit $cargoExitCode
