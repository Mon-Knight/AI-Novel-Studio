param()

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Read-Utf8Text {
  param([string]$Path)
  return Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root $Path)
}

function Assert-Equal {
  param(
    [string]$Label,
    [string]$Expected,
    [string]$Actual
  )
  if ($Actual -ne $Expected) {
    throw "Version mismatch [$Label]: expected '$Expected', got '$Actual'."
  }
  Write-Host "  [OK] $Label = $Actual"
}

function Assert-RegexVersion {
  param(
    [string]$Label,
    [string]$Content,
    [string]$Pattern,
    [string]$Expected
  )
  $match = [regex]::Match($Content, $Pattern)
  if (-not $match.Success) {
    throw "Unable to read current version from $Label."
  }
  Assert-Equal $Label $Expected $match.Groups[1].Value
}

$package = Read-Utf8Text "package.json" | ConvertFrom-Json
$expected = [string]$package.version
if (-not $expected) {
  throw "package.json version is empty."
}

Write-Host "========================================"
Write-Host "  AI Novel Studio - Version Sync Check"
Write-Host "  Expected: v$expected"
Write-Host "========================================"

$lock = Read-Utf8Text "package-lock.json"
$lockVersionMatch = [regex]::Match($lock, '(?ms)^\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"version"\s*:\s*"([^"]+)"')
if (-not $lockVersionMatch.Success) { throw "Unable to read top-level version from package-lock.json." }
Assert-Equal "package-lock.json top-level" $expected $lockVersionMatch.Groups[1].Value

$lockPackageMatch = [regex]::Match($lock, '(?ms)"packages"\s*:\s*\{\s*""\s*:\s*\{.*?"version"\s*:\s*"([^"]+)"')
if (-not $lockPackageMatch.Success) { throw "Unable to read packages[''].version from package-lock.json." }
Assert-Equal "package-lock.json packages['']" $expected $lockPackageMatch.Groups[1].Value

$cargo = Read-Utf8Text "src-tauri/Cargo.toml"
$cargoMatch = [regex]::Match($cargo, '(?m)^version\s*=\s*"([^"]+)"')
if (-not $cargoMatch.Success) { throw "Unable to read package version from src-tauri/Cargo.toml." }
Assert-Equal "src-tauri/Cargo.toml" $expected $cargoMatch.Groups[1].Value

$cargoLock = Read-Utf8Text "src-tauri/Cargo.lock"
$cargoLockMatch = [regex]::Match($cargoLock, '(?ms)^\[\[package\]\]\s*name\s*=\s*"ai-novel-studio"\s*version\s*=\s*"([^"]+)"')
if (-not $cargoLockMatch.Success) { throw "Unable to read ai-novel-studio version from src-tauri/Cargo.lock." }
Assert-Equal "src-tauri/Cargo.lock" $expected $cargoLockMatch.Groups[1].Value

$tauri = Read-Utf8Text "src-tauri/tauri.conf.json" | ConvertFrom-Json
Assert-Equal "src-tauri/tauri.conf.json" $expected ([string]$tauri.package.version)

$versionSource = Read-Utf8Text "src/constants/version.ts"
$versionMatch = [regex]::Match($versionSource, "APP_VERSION\s*=\s*'v([^']+)'")
if (-not $versionMatch.Success) { throw "Unable to read APP_VERSION from src/constants/version.ts." }
Assert-Equal "src/constants/version.ts" $expected $versionMatch.Groups[1].Value

$readme = Read-Utf8Text "README.md"
Assert-RegexVersion "README.md current version" $readme '(?m)^\*\*[^*\r\n]*v([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)\*\*\r?$' $expected

$changelog = Read-Utf8Text "CHANGELOG.md"
Assert-RegexVersion "CHANGELOG.md newest entry" $changelog '(?m)^##\s+v([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)\b' $expected

$roadmap = Read-Utf8Text "docs/version-roadmap.md"
Assert-RegexVersion "docs/version-roadmap.md current version" $roadmap '(?m)^>\s*[^\r\n]*v([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)\b' $expected

$testing = Read-Utf8Text "docs/technical/testing.md"
Assert-RegexVersion "docs/technical/testing.md current version" $testing '(?m)^>\s*[^\r\n]*v([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)\b' $expected

$docsIndex = Read-Utf8Text "docs/README.md"
Assert-RegexVersion "docs/README.md testing index version" $docsIndex '(?m)^\|\s*\[testing\.md\][^\r\n]*v([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)\b' $expected

$releaseHistory = Read-Utf8Text "docs/project/release-history.md"
if (-not $releaseHistory.Contains('[`CHANGELOG.md`](../../CHANGELOG.md)')) {
  throw "docs/project/release-history.md must point to CHANGELOG.md as the current release source."
}
Write-Host "  [OK] release history delegates current notes to CHANGELOG.md"

$fragmentedNotes = @(Get-ChildItem -LiteralPath (Join-Path $root "docs") -File -Filter "release-notes-v*.md")
if ($fragmentedNotes.Count -ne 0) {
  $names = ($fragmentedNotes | Select-Object -ExpandProperty Name) -join ", "
  throw "Per-version release note fragments are not allowed; merge them into docs/project/release-history.md: $names"
}
Write-Host "  [OK] no per-version release note fragments"

Write-Host "Version sync checks passed."
