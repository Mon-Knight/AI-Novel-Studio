param(
    [Parameter(Mandatory = $true)]
    [string]$Filter,

    [int]$MinimumCount = 1
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$manifest = Join-Path $repoRoot 'src-tauri\Cargo.toml'

# Keep Cargo's normal stderr progress out of the captured pipeline; otherwise
# Windows PowerShell can turn it into NativeCommandError under Stop.
$listOutput = @(& cargo test --manifest-path $manifest $Filter -- --list)
$listExitCode = $LASTEXITCODE
$listOutput | ForEach-Object { Write-Host $_ }
if ($listExitCode -ne 0) {
    Write-Error "cargo test --list failed with exit code $listExitCode"
    exit $listExitCode
}

$matchedCount = @(
    $listOutput | Where-Object { "$_" -match ': test$' }
).Count
if ($matchedCount -lt $MinimumCount) {
    Write-Error "Cargo filter '$Filter' matched $matchedCount tests; expected at least $MinimumCount."
    exit 5
}

& cargo test --manifest-path $manifest $Filter -- --nocapture
$testExitCode = $LASTEXITCODE
if ($testExitCode -ne 0) {
    Write-Error "cargo test failed with exit code $testExitCode"
}
exit $testExitCode
