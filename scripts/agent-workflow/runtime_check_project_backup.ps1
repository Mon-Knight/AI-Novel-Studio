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
  cargo test project_backup_ -- --nocapture
  $cargoExitCode = $LASTEXITCODE
} finally {
  Pop-Location
}

exit $cargoExitCode
