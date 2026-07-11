param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
        'components',
        'workspace-reliability',
        'workspace-recovery',
        'large-text-integrity',
        'migrations'
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
            'errors::tests::db16_app_error_serializes_as_stable_object'
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
