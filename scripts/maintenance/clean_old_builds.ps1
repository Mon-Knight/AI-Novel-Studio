# clean_old_builds.ps1
# AI Novel Studio - Old build artifact cleanup script
# Default dry-run, only REPORTS what would be cleaned, does not delete
# Usage:
#   dry-run: powershell -File .\scripts\maintenance\clean_old_builds.ps1 -Root "F:\ai-novel-studio" -DryRun
#   execute: powershell -File .\scripts\maintenance\clean_old_builds.ps1 -Root "F:\ai-novel-studio" -Apply

param(
    [string]$Root = "F:\ai-novel-studio",
    [switch]$DryRun = $true,
    [switch]$Apply = $false
)

$ErrorActionPreference = "Stop"

# Current stable version to protect
$KeepVersion = "1.7.10"

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

function Get-DirSize {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return 0 }
    try {
        $files = Get-ChildItem -Path $Path -Recurse -File -ErrorAction SilentlyContinue
        if ($files) {
            return ($files | Measure-Object -Property Length -Sum).Sum
        }
        return 0
    } catch {
        return 0
    }
}

$isDryRun = $DryRun -and (-not $Apply)
$isRealRun = $Apply

Write-Host "=== AI Novel Studio Old Build Cleanup ===" -ForegroundColor Cyan
if ($isDryRun) {
    Write-Host "Mode: DRY-RUN (preview only, no deletions)" -ForegroundColor Yellow
} else {
    Write-Host "Mode: REAL DELETION" -ForegroundColor Red
}
Write-Host "Project root: $Root"
Write-Host ""

# ============================================
# Define cleanup targets
# ============================================
$cleanupTargets = @()

# 1. src-tauri/target/debug
$debugDir = Join-Path $Root "src-tauri\target\debug"
if (Test-Path $debugDir) {
    $size = Get-DirSize $debugDir
    $cleanupTargets += [PSCustomObject]@{
        Path        = $debugDir
        Size        = $size
        Label       = "src-tauri/target/debug (Rust debug build)"
        CanRebuild  = $true
    }
}

# 2. Rust incremental compilation cache
$incrementalDir = Join-Path $Root "src-tauri\target\release\incremental"
if (Test-Path $incrementalDir) {
    $size = Get-DirSize $incrementalDir
    $cleanupTargets += [PSCustomObject]@{
        Path        = $incrementalDir
        Size        = $size
        Label       = "Rust incremental compilation cache"
        CanRebuild  = $true
    }
}

# 3. dist directory
$distDir = Join-Path $Root "dist"
if (Test-Path $distDir) {
    $size = Get-DirSize $distDir
    $cleanupTargets += [PSCustomObject]@{
        Path        = $distDir
        Size        = $size
        Label       = "dist (frontend build output)"
        CanRebuild  = $true
    }
}

# 4. Vite cache
$viteCache = Join-Path $Root "node_modules\.vite"
if (Test-Path $viteCache) {
    $size = Get-DirSize $viteCache
    $cleanupTargets += [PSCustomObject]@{
        Path        = $viteCache
        Size        = $size
        Label       = "Vite cache (node_modules/.vite)"
        CanRebuild  = $true
    }
}

# 5. Release build intermediate files (NOT installers)
$releaseDir = Join-Path $Root "src-tauri\target\release"
if (Test-Path $releaseDir) {
    $releaseFiles = Get-ChildItem -Path $releaseDir -File -ErrorAction SilentlyContinue |
        Where-Object {
            $ext = $_.Extension.ToLower()
            # Exclude installer files
            $ext -notin @('.exe', '.msi')
        }
    foreach ($file in $releaseFiles) {
        $cleanupTargets += [PSCustomObject]@{
            Path        = $file.FullName
            Size        = $file.Length
            Label       = "target/release/$($file.Name) (Rust release intermediate)"
            CanRebuild  = $true
        }
    }
}

# ============================================
# Protected paths (NEVER clean)
# ============================================
$protectedPaths = @(
    (Join-Path $Root ".git"),
    (Join-Path $Root "src"),
    (Join-Path $Root "src-tauri\src"),
    (Join-Path $Root "docs"),
    (Join-Path $Root "README.md"),
    (Join-Path $Root "CHANGELOG.md"),
    (Join-Path $Root "package.json"),
    (Join-Path $Root "src-tauri\Cargo.toml"),
    (Join-Path $Root "package-lock.json")
)

# Current version installers (protected)
$nsisInstaller = Join-Path $Root "src-tauri\target\release\bundle\nsis\AI Novel Studio_${KeepVersion}_x64-setup.exe"
$msiInstaller = Join-Path $Root "src-tauri\target\release\bundle\msi\AI Novel Studio_${KeepVersion}_x64_en-US.msi"
$protectedPaths += $nsisInstaller
$protectedPaths += $msiInstaller

Write-Host "SAFETY RULES:" -ForegroundColor White
Write-Host "  NEVER clean: .git, src/, docs/, config files, v$KeepVersion installers" -ForegroundColor Red
Write-Host "  Database files and user exports are NOT in the cleanup list" -ForegroundColor Red
Write-Host ""

# ============================================
# Display cleanup candidates
# ============================================
if ($cleanupTargets.Count -eq 0) {
    Write-Host "No cleanable build artifacts found." -ForegroundColor Green
    exit 0
}

Write-Host "Cleanable build artifacts:" -ForegroundColor White
Write-Host ""

$totalCleanSize = 0
foreach ($target in $cleanupTargets) {
    $rebuild = if ($target.CanRebuild) { "[Rebuildable]" } else { "[CAUTION]" }
    $line = "{0,12}  {1,-60}  {2}" -f (Format-Size $target.Size), $target.Label, $rebuild
    Write-Host "  $line"
    $totalCleanSize += $target.Size
}

Write-Host ""
Write-Host "Estimated space to free: $(Format-Size $totalCleanSize)" -ForegroundColor Cyan
Write-Host ""

# Show protected items
Write-Host "The following will NOT be cleaned:" -ForegroundColor Green
foreach ($pp in $protectedPaths) {
    $exists = Test-Path $pp
    $mark = if ($exists) { "[EXISTS]" } else { "[NOT FOUND]" }
    Write-Host "  $mark $pp" -ForegroundColor Green
}

if ($isDryRun) {
    Write-Host ""
    Write-Host "=== DRY-RUN COMPLETE ===" -ForegroundColor Green
    Write-Host "Nothing was deleted. To actually clean, add -Apply parameter:" -ForegroundColor Yellow
    Write-Host "  .\scripts\maintenance\clean_old_builds.ps1 -Apply" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "STRONG RECOMMENDATIONS before cleaning:" -ForegroundColor Yellow
    Write-Host "  1. Run archive_old_builds.ps1 first to archive old installers"
    Write-Host "  2. Verify 'npm run build' and 'cargo check' work"
    Write-Host "  3. Close all running project processes"
    exit 0
}

# ============================================
# Real deletion (-Apply)
# ============================================
if ($isRealRun) {
    Write-Host ""
    Write-Host "!!! WARNING: About to DELETE files !!!" -ForegroundColor Red
    Write-Host "Estimated space to free: $(Format-Size $totalCleanSize)" -ForegroundColor Red
    Write-Host ""

    $confirm1 = Read-Host "Type YES to confirm deletion of build artifacts"
    if ($confirm1 -ne "YES") {
        Write-Host "Operation cancelled." -ForegroundColor Yellow
        exit 0
    }

    $confirm2 = Read-Host "Type DELETE to confirm again (these files are rebuildable)"
    if ($confirm2 -ne "DELETE") {
        Write-Host "Operation cancelled." -ForegroundColor Yellow
        exit 0
    }

    $deleted = 0
    $failed = 0
    $freedSize = 0

    foreach ($target in $cleanupTargets) {
        try {
            if (Test-Path $target.Path) {
                Remove-Item -Path $target.Path -Recurse -Force -ErrorAction Stop
                Write-Host "  [DELETED] $($target.Label) ($(Format-Size $target.Size))"
                $deleted++
                $freedSize += $target.Size
            }
        } catch {
            Write-Host "  [FAILED] $($target.Label): $_" -ForegroundColor Red
            $failed++
        }
    }

    Write-Host ""
    Write-Host "=== CLEANUP COMPLETE ===" -ForegroundColor Green
    Write-Host "Deleted:  $deleted items" -ForegroundColor Green
    Write-Host "Freed:    $(Format-Size $freedSize)" -ForegroundColor Green
    if ($failed -gt 0) {
        Write-Host "Failed:   $failed items" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Suggested rebuild verification: npm install && npm run build && cargo check" -ForegroundColor Yellow
}
