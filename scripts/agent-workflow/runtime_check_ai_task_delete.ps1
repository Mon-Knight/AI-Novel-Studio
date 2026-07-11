param()

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tauriRoot = Join-Path $root "src-tauri"

if (-not (Test-Path -LiteralPath $tauriRoot)) {
  throw "Missing src-tauri directory: $tauriRoot"
}

Push-Location $tauriRoot
$cargoExitCode = 1
try {
  cargo test ai_task_delete_runtime_insert_list_delete_clear -- --nocapture
  $cargoExitCode = $LASTEXITCODE
} finally {
  Pop-Location
}

exit $cargoExitCode
