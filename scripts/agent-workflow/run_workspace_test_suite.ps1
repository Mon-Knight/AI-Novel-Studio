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
        'ai-p0-safety'
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
            'services::ai_task_service::tests::task15_abort_acknowledgement_finalizes_cancellation'
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
