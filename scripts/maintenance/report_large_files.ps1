# report_large_files.ps1
# AI Novel Studio - Local large file and build artifact scan script
# Read-only scan, never deletes or moves any file
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\maintenance\report_large_files.ps1 -Root "F:\ai-novel-studio"

param(
    [string]$Root = "F:\ai-novel-studio"
)

$ErrorActionPreference = "Stop"
$ReportDir = Join-Path $Root "reports"
$ReportFile = Join-Path $ReportDir "local-storage-report.md"
$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# Protected directories (never auto-delete)
$ProtectedDirs = @(
    ".git", "src", "src-tauri", "docs", "prompts", "public", ".github"
)

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

# ============================================
# Start scan
# ============================================

Write-Host "=== AI Novel Studio Local Large File Scan ===" -ForegroundColor Cyan
Write-Host "Scan directory: $Root"
Write-Host "Time: $Timestamp"
Write-Host ""

# Create report directory
if (-not (Test-Path $ReportDir)) {
    New-Item -Path $ReportDir -ItemType Directory -Force | Out-Null
    Write-Host "Created report directory: $ReportDir"
}

# Initialize report
$reportHeader = @"
# AI Novel Studio Local Storage Scan Report

Scan time: $Timestamp
Scan directory: $Root
Script: scripts/maintenance/report_large_files.ps1

"@
Set-Content -Path $ReportFile -Value $reportHeader -Encoding UTF8

# ============================================
# 1. Total project size
# ============================================
Write-Host "[1/7] Computing total project size..." -ForegroundColor Yellow
$totalSize = Get-DirSize $Root
Add-Content -Path $ReportFile -Value "" -Encoding UTF8
Add-Content -Path $ReportFile -Value "## 1. Total Project Size" -Encoding UTF8
Add-Content -Path $ReportFile -Value "" -Encoding UTF8
Add-Content -Path $ReportFile -Value "- Total size: $(Format-Size $totalSize)" -Encoding UTF8
Write-Host "  Total size: $(Format-Size $totalSize)"

# ============================================
# 2. Top-level directory sizes
# ============================================
Write-Host "[2/7] Computing top-level directory sizes..." -ForegroundColor Yellow
Add-Content -Path $ReportFile -Value "" -Encoding UTF8
Add-Content -Path $ReportFile -Value "## 2. Top-Level Directory Sizes" -Encoding UTF8
Add-Content -Path $ReportFile -Value "" -Encoding UTF8

$topDirs = Get-ChildItem -Path $Root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $size = Get-DirSize $_.FullName
    [PSCustomObject]@{ Name = $_.Name; Size = $size; Path = $_.FullName }
} | Sort-Object -Property Size -Descending

foreach ($dir in $topDirs) {
    $note = ""
    if ($dir.Name -in $ProtectedDirs) {
        $note = " [PROTECTED - do not delete]"
    }
    if ($dir.Name -eq "node_modules") {
        $note = " [Rebuildable: npm install]"
    }
    if ($dir.Name -eq "dist") {
        $note = " [Rebuildable: npm run build]"
    }
    if ($dir.Name -eq "src-tauri") {
        $note = " [Contains source + build cache]"
    }

    $line = "{0,-25} {1,12}{2}" -f $dir.Name, (Format-Size $dir.Size), $note
    Add-Content -Path $ReportFile -Value $line -Encoding UTF8
    Write-Host "  $line"
}
Add-Content -Path $ReportFile -Value "" -Encoding UTF8

# ============================================
# 3. Files over 100MB
# ============================================
Write-Host "[3/7] Scanning for files over 100MB..." -ForegroundColor Yellow
Add-Content -Path $ReportFile -Value "## 3. Files Over 100MB" -Encoding UTF8
Add-Content -Path $ReportFile -Value "" -Encoding UTF8

$largeFiles = Get-ChildItem -Path $Root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Length -ge 100MB } |
    Sort-Object -Property Length -Descending

if ($largeFiles.Count -eq 0) {
    Add-Content -Path $ReportFile -Value "No files over 100MB found." -Encoding UTF8
    Write-Host "  No files over 100MB found."
} else {
    foreach ($file in $largeFiles) {
        $relPath = $file.FullName.Replace($Root, "").TrimStart("\")
        $line = "{0,12}  {1}" -f (Format-Size $file.Length), $relPath
        Add-Content -Path $ReportFile -Value $line -Encoding UTF8
        Write-Host "  $line"
    }
}
Add-Content -Path $ReportFile -Value "" -Encoding UTF8

# ============================================
# 4. Common build directories
# ============================================
Write-Host "[4/7] Checking common build directories..." -ForegroundColor Yellow
Add-Content -Path $ReportFile -Value "## 4. Common Build Directories" -Encoding UTF8
Add-Content -Path $ReportFile -Value "" -Encoding UTF8

$buildDirs = @(
    @{Path = Join-Path $Root "node_modules"; Label = "node_modules"; Advice = "Rebuildable: npm install"},
    @{Path = Join-Path $Root "src-tauri\target"; Label = "src-tauri/target"; Advice = "Rebuildable: cargo build"},
    @{Path = Join-Path $Root "dist"; Label = "dist"; Advice = "Rebuildable: npm run build"},
    @{Path = Join-Path $Root "build"; Label = "build"; Advice = "Rebuildable"}
)

foreach ($bd in $buildDirs) {
    if (Test-Path $bd.Path) {
        $size = Get-DirSize $bd.Path
        $line = "{0,-25} {1,12}  {2}" -f $bd.Label, (Format-Size $size), $bd.Advice
        Add-Content -Path $ReportFile -Value $line -Encoding UTF8
        Write-Host "  $line"
    } else {
        Add-Content -Path $ReportFile -Value "$($bd.Label): Not found" -Encoding UTF8
        Write-Host "  $($bd.Label): Not found"
    }
}
Add-Content -Path $ReportFile -Value "" -Encoding UTF8

# ============================================
# 5. Installer files
# ============================================
Write-Host "[5/7] Checking installer files..." -ForegroundColor Yellow
Add-Content -Path $ReportFile -Value "## 5. Installer Files" -Encoding UTF8
Add-Content -Path $ReportFile -Value "" -Encoding UTF8

$installerPatterns = @("*.exe", "*.msi", "*.zip", "*.7z", "*.rar")
$installerFiles = Get-ChildItem -Path $Root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $installerPatterns -contains $_.Extension.ToLower() }

if ($installerFiles.Count -eq 0) {
    Add-Content -Path $ReportFile -Value "No installer files found." -Encoding UTF8
} else {
    foreach ($file in $installerFiles | Sort-Object -Property Length -Descending) {
        $relPath = $file.FullName.Replace($Root, "").TrimStart("\")
        $status = ""
        if ($file.Name -match "1\.7\.10") {
            $status = " [STABLE BASELINE - keep]"
        } elseif ($file.Name -match "1\.7\.1[1-9]") {
            $status = " [CURRENT VERSION]"
        } else {
            $status = " [Archive candidate]"
        }
        $line = "{0,12}  {1}{2}" -f (Format-Size $file.Length), $relPath, $status
        Add-Content -Path $ReportFile -Value $line -Encoding UTF8
        Write-Host "  $line"
    }
}
Add-Content -Path $ReportFile -Value "" -Encoding UTF8

# ============================================
# 6. src-tauri/target detail
# ============================================
Write-Host "[6/7] Checking src-tauri/target detail..." -ForegroundColor Yellow
Add-Content -Path $ReportFile -Value "## 6. src-tauri/target Subdirectories" -Encoding UTF8
Add-Content -Path $ReportFile -Value "" -Encoding UTF8

$targetDir = Join-Path $Root "src-tauri\target"
if (Test-Path $targetDir) {
    $targetSubDirs = Get-ChildItem -Path $targetDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $size = Get-DirSize $_.FullName
        [PSCustomObject]@{ Name = $_.Name; Size = $size }
    } | Sort-Object -Property Size -Descending

    foreach ($sub in $targetSubDirs) {
        $line = "  target/{0,-20} {1}" -f $sub.Name, (Format-Size $sub.Size)
        Add-Content -Path $ReportFile -Value $line -Encoding UTF8
        Write-Host "  $line"
    }
} else {
    Add-Content -Path $ReportFile -Value "src-tauri/target directory not found." -Encoding UTF8
}
Add-Content -Path $ReportFile -Value "" -Encoding UTF8

# ============================================
# 7. Summary
# ============================================
Write-Host "[7/7] Generating summary..." -ForegroundColor Yellow
Add-Content -Path $ReportFile -Value "## 7. Summary" -Encoding UTF8
Add-Content -Path $ReportFile -Value "" -Encoding UTF8

Add-Content -Path $ReportFile -Value "### Cleanup Candidates" -Encoding UTF8
Add-Content -Path $ReportFile -Value "" -Encoding UTF8
Add-Content -Path $ReportFile -Value "- node_modules: Can be rebuilt via npm install" -Encoding UTF8
Add-Content -Path $ReportFile -Value "- src-tauri/target: Can be rebuilt via cargo build (warning: will lose built installers)" -Encoding UTF8
Add-Content -Path $ReportFile -Value "- dist: Can be rebuilt via npm run build" -Encoding UTF8
Add-Content -Path $ReportFile -Value "- Old version installers: Archive first, then delete" -Encoding UTF8
Add-Content -Path $ReportFile -Value "" -Encoding UTF8

Add-Content -Path $ReportFile -Value "### Must Keep" -Encoding UTF8
Add-Content -Path $ReportFile -Value "" -Encoding UTF8
Add-Content -Path $ReportFile -Value "- .git directory and Git history" -Encoding UTF8
Add-Content -Path $ReportFile -Value "- src/, src-tauri/src/ source code" -Encoding UTF8
Add-Content -Path $ReportFile -Value "- docs/ documentation" -Encoding UTF8
Add-Content -Path $ReportFile -Value "- README.md, CHANGELOG.md, package.json, Cargo.toml" -Encoding UTF8
Add-Content -Path $ReportFile -Value "- v1.7.10 NSIS installer (stable baseline)" -Encoding UTF8
Add-Content -Path $ReportFile -Value "- v1.7.10 MSI installer (stable baseline)" -Encoding UTF8
Add-Content -Path $ReportFile -Value "- User database files, export backup files" -Encoding UTF8
Add-Content -Path $ReportFile -Value "" -Encoding UTF8

Add-Content -Path $ReportFile -Value "### Recommended Operation Order" -Encoding UTF8
Add-Content -Path $ReportFile -Value "" -Encoding UTF8
Add-Content -Path $ReportFile -Value "1. READ this report first." -Encoding UTF8
Add-Content -Path $ReportFile -Value "2. Run archive_old_builds.ps1 -DryRun to preview archive plan." -Encoding UTF8
Add-Content -Path $ReportFile -Value "3. Run clean_old_builds.ps1 -DryRun to preview cleanup plan." -Encoding UTF8
Add-Content -Path $ReportFile -Value "4. After user confirmation, archive first, then clean." -Encoding UTF8
Add-Content -Path $ReportFile -Value "5. NEVER delete .git directory." -Encoding UTF8
Add-Content -Path $ReportFile -Value "" -Encoding UTF8

Add-Content -Path $ReportFile -Value "---" -Encoding UTF8
Add-Content -Path $ReportFile -Value "" -Encoding UTF8
Add-Content -Path $ReportFile -Value "Report generated by scripts/maintenance/report_large_files.ps1 (read-only)" -Encoding UTF8

Write-Host ""
Write-Host "=== Scan Complete ===" -ForegroundColor Green
Write-Host "Report saved: $ReportFile" -ForegroundColor Green
Write-Host ""
