# archive_old_builds.ps1
# AI Novel Studio - Old build artifact archive script
# Default: dry-run, only shows what WOULD be moved
# Usage:
#   dry-run: powershell -File .\scripts\maintenance\archive_old_builds.ps1 -Root "F:\ai-novel-studio" -ArchiveRoot "E:\AI-Novel-Studio-Archive" -KeepRecent 3 -DryRun
#   execute: powershell -File .\scripts\maintenance\archive_old_builds.ps1 -Root "F:\ai-novel-studio" -ArchiveRoot "E:\AI-Novel-Studio-Archive" -KeepRecent 3 -Apply

param(
    [string]$Root = "F:\ai-novel-studio",
    [string]$ArchiveRoot = "E:\AI-Novel-Studio-Archive",
    [int]$KeepRecent = 3,
    [switch]$DryRun = $true,
    [switch]$Apply = $false
)

$ErrorActionPreference = "Stop"

# Versions to always keep
$AlwaysKeepVersions = @("1.7.10", "1.7.11")

function Format-Size {
    param([long]$Bytes)
    if ($Bytes -ge 1GB) {
        return "{0:N2} GB" -f ($Bytes / 1GB)
    }
    if ($Bytes -ge 1MB) {
        return "{0:N2} MB" -f ($Bytes / 1MB)
    }
    if ($Bytes -ge 1KB) {
        return "{0:N2} KB" -f ($Bytes / 1KB)
    }
    return "$Bytes B"
}

$isDryRun = $DryRun -and (-not $Apply)
$isRealRun = $Apply

Write-Host "=== AI Novel Studio Old Build Archive ===" -ForegroundColor Cyan
if ($isDryRun) {
    Write-Host "Mode: DRY-RUN (preview only, no changes)" -ForegroundColor Yellow
} else {
    Write-Host "Mode: REAL EXECUTION (will move files)" -ForegroundColor Red
}
Write-Host "Project root: $Root"
Write-Host "Archive target: $ArchiveRoot"
Write-Host "Keep recent: $KeepRecent versions"
Write-Host "Always keep: $($AlwaysKeepVersions -join ', ')"
Write-Host ""

# Source directories
$BundleDir = Join-Path $Root "src-tauri\target\release\bundle"
$NsisDir = Join-Path $BundleDir "nsis"
$MsiDir = Join-Path $BundleDir "msi"

# Collect all installers
$allInstallers = @()

if (Test-Path $NsisDir) {
    $allInstallers += Get-ChildItem -Path $NsisDir -Filter "*.exe" -ErrorAction SilentlyContinue
}
if (Test-Path $MsiDir) {
    $allInstallers += Get-ChildItem -Path $MsiDir -Filter "*.msi" -ErrorAction SilentlyContinue
}

# Also scan root for zip/7z/rar
$allInstallers += Get-ChildItem -Path $Root -Filter "*.zip" -ErrorAction SilentlyContinue
$allInstallers += Get-ChildItem -Path $Root -Filter "*.7z" -ErrorAction SilentlyContinue
$allInstallers += Get-ChildItem -Path $Root -Filter "*.rar" -ErrorAction SilentlyContinue

if ($allInstallers.Count -eq 0) {
    Write-Host "No installer files found. Nothing to archive." -ForegroundColor Green
    exit 0
}

# Group by version
$versionGroups = @{}
foreach ($file in $allInstallers) {
    $name = $file.BaseName
    if ($name -match '(\d+\.\d+\.\d+)') {
        $ver = $matches[1]
        if (-not $versionGroups.ContainsKey($ver)) {
            $versionGroups[$ver] = @()
        }
        $versionGroups[$ver] += $file
    } else {
        $key = "_unknown"
        if (-not $versionGroups.ContainsKey($key)) {
            $versionGroups[$key] = @()
        }
        $versionGroups[$key] += $file
    }
}

# Sort versions
$sortedVersions = $versionGroups.Keys | Where-Object { $_ -ne "_unknown" } | Sort-Object { [version]$_ } -Descending
$allSortedKeys = @($sortedVersions)
if ($versionGroups.ContainsKey("_unknown")) {
    $allSortedKeys += "_unknown"
}

Write-Host ""
Write-Host "Found installer packages by version:" -ForegroundColor White

$toArchive = @()
$toKeep = @()
$totalArchiveSize = 0
$keepCount = 0

foreach ($ver in $allSortedKeys) {
    $files = $versionGroups[$ver]
    $shouldKeep = $false

    # Always keep certain versions
    if ($AlwaysKeepVersions -contains $ver) { $shouldKeep = $true }
    # Keep recent N versions
    if ($ver -ne "_unknown" -and $keepCount -lt $KeepRecent) {
        $shouldKeep = $true
    }

    if ($shouldKeep -and $ver -ne "_unknown") {
        $keepCount++
    }

    foreach ($file in $files) {
        $sizeStr = Format-Size $file.Length
        if ($shouldKeep) {
            $toKeep += $file
            Write-Host "  [KEEP]    $($file.Name) ($sizeStr)" -ForegroundColor Green
        } else {
            $toArchive += $file
            $totalArchiveSize += $file.Length
            Write-Host "  [ARCHIVE] $($file.Name) ($sizeStr)" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "Summary:" -ForegroundColor White
Write-Host "  Keep:    $($toKeep.Count) files" -ForegroundColor Green
Write-Host "  Archive: $($toArchive.Count) files, total $(Format-Size $totalArchiveSize)" -ForegroundColor Yellow

if ($toArchive.Count -eq 0) {
    Write-Host ""
    Write-Host "No files to archive." -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "Archive destination preview:" -ForegroundColor White
foreach ($file in $toArchive) {
    if ($file.Name -match '(\d+\.\d+\.\d+)') {
        $ver = $matches[1]
        $destPath = Join-Path $ArchiveRoot "v$ver\$($file.Name)"
    } else {
        $destPath = Join-Path $ArchiveRoot "unknown\$($file.Name)"
    }
    Write-Host "  $($file.FullName)  ->  $destPath" -ForegroundColor Gray
}

if ($isDryRun) {
    Write-Host ""
    Write-Host "=== DRY-RUN COMPLETE ===" -ForegroundColor Green
    Write-Host "No files were moved. To actually archive, add -Apply parameter:" -ForegroundColor Yellow
    Write-Host "  .\scripts\maintenance\archive_old_builds.ps1 -Apply" -ForegroundColor Yellow
    exit 0
}

# ============================================
# Real execution (-Apply)
# ============================================
if ($isRealRun) {
    Write-Host ""
    Write-Host "WARNING: About to move files for real!" -ForegroundColor Red
    Write-Host ""

    $confirm = Read-Host "Type YES to confirm moving $($toArchive.Count) files to $ArchiveRoot"
    if ($confirm -ne "YES") {
        Write-Host "Operation cancelled." -ForegroundColor Yellow
        exit 0
    }

    # Create archive directory structure
    if (-not (Test-Path $ArchiveRoot)) {
        New-Item -Path $ArchiveRoot -ItemType Directory -Force | Out-Null
        Write-Host "Created archive root: $ArchiveRoot"
    }

    $moved = 0
    $failed = 0

    foreach ($file in $toArchive) {
        if ($file.Name -match '(\d+\.\d+\.\d+)') {
            $ver = $matches[1]
            $destDir = Join-Path $ArchiveRoot "v$ver"
        } else {
            $destDir = Join-Path $ArchiveRoot "unknown"
        }

        if (-not (Test-Path $destDir)) {
            New-Item -Path $destDir -ItemType Directory -Force | Out-Null
        }

        $destPath = Join-Path $destDir $file.Name
        try {
            Move-Item -Path $file.FullName -Destination $destPath -Force
            Write-Host "  [MOVED] $($file.Name) -> $destPath" -ForegroundColor Green
            $moved++
        } catch {
            Write-Host "  [FAILED] $($file.Name) : $_" -ForegroundColor Red
            $failed++
        }
    }

    Write-Host ""
    Write-Host "=== ARCHIVE COMPLETE ===" -ForegroundColor Green
    Write-Host "Moved:  $moved files" -ForegroundColor Green
    if ($failed -gt 0) {
        Write-Host "Failed: $failed files" -ForegroundColor Red
    }
    Write-Host "Archive location: $ArchiveRoot" -ForegroundColor Green
}
