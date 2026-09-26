param()

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tauriRoot = Join-Path $root "src-tauri"

if (-not (Test-Path -LiteralPath $tauriRoot)) {
  throw "Missing src-tauri directory: $tauriRoot"
}

Push-Location $root
$cargoExitCode = 1
try {
  node scripts/quality/run-cargo-tests.mjs --filter ai_task_delete
  $cargoExitCode = $LASTEXITCODE
} finally {
  Pop-Location
}

exit $cargoExitCode
