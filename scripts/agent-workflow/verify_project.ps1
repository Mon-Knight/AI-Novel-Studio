# verify_project.ps1
# AI Novel Studio - Unified Project Verification
# Version: v1.0.45
# Purpose: Run all build and verification steps, output unified summary

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\..\.."

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AI Novel Studio - Project Verification" -ForegroundColor Cyan
Write-Host "  Version: v1.0.45" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$Results = @()

# Step 1: cargo check
Write-Host "[verify_project] Running cargo check..." -ForegroundColor Yellow
Push-Location "$ProjectRoot\src-tauri"
try {
    $cargoOutput = cargo check 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[verify_project] cargo check: PASS" -ForegroundColor Green
        $Results += @{ Step = "cargo check"; Status = "PASS" }
    } else {
        Write-Host "[verify_project] cargo check: FAIL" -ForegroundColor Red
        Write-Host "  Exit code: $LASTEXITCODE" -ForegroundColor Red
        $Results += @{ Step = "cargo check"; Status = "FAIL" }
    }
} catch {
    Write-Host "[verify_project] cargo check: FAIL (exception)" -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    $Results += @{ Step = "cargo check"; Status = "FAIL" }
} finally {
    Pop-Location
}
Write-Host ""

# Step 2: npm run build
Write-Host "[verify_project] Running npm run build..." -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    $npmBuildOutput = npm run build 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[verify_project] npm run build: PASS" -ForegroundColor Green
        $Results += @{ Step = "npm run build"; Status = "PASS" }
    } else {
        Write-Host "[verify_project] npm run build: FAIL" -ForegroundColor Red
        Write-Host "  Exit code: $LASTEXITCODE" -ForegroundColor Red
        $Results += @{ Step = "npm run build"; Status = "FAIL" }
    }
} catch {
    Write-Host "[verify_project] npm run build: FAIL (exception)" -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    $Results += @{ Step = "npm run build"; Status = "FAIL" }
} finally {
    Pop-Location
}
Write-Host ""

# Step 3: npm run tauri build
Write-Host "[verify_project] Running npm run tauri build..." -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    $tauriBuildOutput = npm run tauri build 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[verify_project] npm run tauri build: PASS" -ForegroundColor Green
        $Results += @{ Step = "npm run tauri build"; Status = "PASS" }
    } else {
        Write-Host "[verify_project] npm run tauri build: FAIL" -ForegroundColor Red
        Write-Host "  Exit code: $LASTEXITCODE" -ForegroundColor Red
        $Results += @{ Step = "npm run tauri build"; Status = "FAIL" }
    }
} catch {
    Write-Host "[verify_project] npm run tauri build: FAIL (exception)" -ForegroundColor Red
    Write-Host "  $_" -ForegroundColor Red
    $Results += @{ Step = "npm run tauri build"; Status = "FAIL" }
} finally {
    Pop-Location
}
Write-Host ""

# Step 4: pytest (if available)
Write-Host "[verify_project] Checking pytest..." -ForegroundColor Yellow
$pytestAvailable = Get-Command pytest -ErrorAction SilentlyContinue
if ($pytestAvailable) {
    Push-Location $ProjectRoot
    try {
        $pytestOutput = pytest 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[verify_project] pytest: PASS" -ForegroundColor Green
            $Results += @{ Step = "pytest"; Status = "PASS" }
        } else {
            Write-Host "[verify_project] pytest: FAIL" -ForegroundColor Red
            $Results += @{ Step = "pytest"; Status = "FAIL" }
        }
    } catch {
        Write-Host "[verify_project] pytest: FAIL (exception)" -ForegroundColor Red
        $Results += @{ Step = "pytest"; Status = "FAIL" }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[verify_project] pytest: SKIPPED (not configured)" -ForegroundColor DarkYellow
    $Results += @{ Step = "pytest"; Status = "SKIPPED" }
}
Write-Host ""

# Step 5: git status
Write-Host "[verify_project] Checking git status..." -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    $gitStatus = git status --short 2>&1
    if ($gitStatus -and $gitStatus.Trim().Length -gt 0) {
        Write-Host "[verify_project] git status: DIRTY" -ForegroundColor Yellow
        Write-Host "  Modified files:" -ForegroundColor Yellow
        $gitStatus | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
        $Results += @{ Step = "git status"; Status = "DIRTY" }
    } else {
        Write-Host "[verify_project] git status: CLEAN" -ForegroundColor Green
        $Results += @{ Step = "git status"; Status = "CLEAN" }
    }
} catch {
    Write-Host "[verify_project] git status: FAIL (not a git repo?)" -ForegroundColor Red
    $Results += @{ Step = "git status"; Status = "FAIL" }
} finally {
    Pop-Location
}
Write-Host ""

# Step 6: Check all checklists exist
Write-Host "[verify_project] Checking checklists..." -ForegroundColor Yellow
$checklistFiles = @(
    ".github/checklists/feature-development.checklist.md",
    ".github/checklists/release.checklist.md",
    ".github/checklists/ui-review.checklist.md",
    ".github/checklists/verification.checklist.md",
    ".github/checklists/docs-sync.checklist.md",
    ".github/checklists/database-change.checklist.md",
    ".github/checklists/tauri-build.checklist.md",
    ".github/checklists/bugfix.checklist.md"
)
$missingChecklists = @()
foreach ($file in $checklistFiles) {
    $fullPath = Join-Path $ProjectRoot $file
    if (-not (Test-Path $fullPath)) {
        $missingChecklists += $file
        Write-Host "  [MISSING] $file" -ForegroundColor Red
    }
}
if ($missingChecklists.Count -eq 0) {
    Write-Host "[verify_project] checklists: ALL PRESENT" -ForegroundColor Green
    $Results += @{ Step = "checklists"; Status = "PASS" }
} else {
    Write-Host "[verify_project] checklists: $($missingChecklists.Count) MISSING" -ForegroundColor Red
    $Results += @{ Step = "checklists"; Status = "FAIL" }
}
Write-Host ""

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Verification Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
$allPassed = $true
foreach ($result in $Results) {
    $color = if ($result.Status -eq "PASS" -or $result.Status -eq "CLEAN") { "Green" }
             elseif ($result.Status -eq "SKIPPED") { "DarkYellow" }
             else { "Red"; $allPassed = $false }
    Write-Host "  [$($result.Status)] $($result.Step)" -ForegroundColor $color
}

Write-Host ""
if ($allPassed) {
    Write-Host "  Overall: ALL CHECKS PASSED" -ForegroundColor Green
} else {
    Write-Host "  Overall: SOME CHECKS FAILED" -ForegroundColor Red
}
Write-Host "========================================" -ForegroundColor Cyan

exit $(if ($allPassed) { 0 } else { 1 })
