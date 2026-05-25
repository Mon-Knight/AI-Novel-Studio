# check_docs_sync.ps1
# AI Novel Studio - Document Sync Check
# Version: v1.0.44
# Purpose: Check key documents exist and version is synced

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\..\.."

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AI Novel Studio - Document Sync Check" -ForegroundColor Cyan
Write-Host "  Version: v1.0.44" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$Results = @()
$CURRENT_VERSION = "1.0.44"

# Check file existence
$requiredFiles = @(
    "AGENTS.md",
    ".github/copilot-instructions.md",
    "docs/development-rules.md",
    "docs/agent-workflow.md",
    "docs/version-roadmap.md",
    "README.md",
    "CHANGELOG.md"
)

Write-Host "[check_docs] Checking required documents..." -ForegroundColor Yellow
foreach ($file in $requiredFiles) {
    $fullPath = Join-Path $ProjectRoot $file
    if (Test-Path $fullPath) {
        Write-Host "  [OK] $file" -ForegroundColor Green
        $Results += @{ File = $file; Status = "EXISTS" }
    } else {
        Write-Host "  [MISSING] $file" -ForegroundColor Red
        $Results += @{ File = $file; Status = "MISSING" }
    }
}
Write-Host ""

# Check version in CHANGELOG.md
Write-Host "[check_docs] Checking version v$CURRENT_VERSION in CHANGELOG.md..." -ForegroundColor Yellow
$changelogPath = Join-Path $ProjectRoot "CHANGELOG.md"
if (Test-Path $changelogPath) {
    $changelogContent = Get-Content $changelogPath -Raw
    if ($changelogContent -match "v$CURRENT_VERSION") {
        Write-Host "  [OK] CHANGELOG.md contains v$CURRENT_VERSION" -ForegroundColor Green
        $Results += @{ File = "CHANGELOG.md"; Status = "VERSION_FOUND" }
    } else {
        Write-Host "  [WARN] CHANGELOG.md does NOT contain v$CURRENT_VERSION" -ForegroundColor Yellow
        $Results += @{ File = "CHANGELOG.md"; Status = "VERSION_MISSING" }
    }
}
Write-Host ""

# Check Agent Runtime mention in README.md
Write-Host "[check_docs] Checking 'Agent Workflow Runtime' or 'Agent Runtime' in README.md..." -ForegroundColor Yellow
$readmePath = Join-Path $ProjectRoot "README.md"
if (Test-Path $readmePath) {
    $readmeContent = Get-Content $readmePath -Raw
    if ($readmeContent -match "Agent (Workflow )?Runtime") {
        Write-Host "  [OK] README.md mentions Agent Runtime" -ForegroundColor Green
        $Results += @{ File = "README.md"; Status = "RUNTIME_MENTIONED" }
    } else {
        Write-Host "  [WARN] README.md does NOT mention Agent Runtime" -ForegroundColor Yellow
        $Results += @{ File = "README.md"; Status = "RUNTIME_MISSING" }
    }
}
Write-Host ""

# Check checklists existence
Write-Host "[check_docs] Checking checklists..." -ForegroundColor Yellow
$checklistFiles = @(
    ".github/checklists/feature-development.checklist.md",
    ".github/checklists/release.checklist.md",
    ".github/checklists/ui-review.checklist.md",
    ".github/checklists/verification.checklist.md"
)
foreach ($file in $checklistFiles) {
    $fullPath = Join-Path $ProjectRoot $file
    if (Test-Path $fullPath) {
        Write-Host "  [OK] $file" -ForegroundColor Green
    } else {
        Write-Host "  [MISSING] $file" -ForegroundColor Red
    }
}
Write-Host ""

# Check workflow scripts existence
Write-Host "[check_docs] Checking workflow scripts..." -ForegroundColor Yellow
$scriptFiles = @(
    "scripts/agent-workflow/verify_project.ps1",
    "scripts/agent-workflow/check_docs_sync.ps1",
    "scripts/agent-workflow/run_feature_workflow.ps1",
    "scripts/agent-workflow/release_workflow.ps1"
)
foreach ($file in $scriptFiles) {
    $fullPath = Join-Path $ProjectRoot $file
    if (Test-Path $fullPath) {
        Write-Host "  [OK] $file" -ForegroundColor Green
    } else {
        Write-Host "  [MISSING] $file" -ForegroundColor Red
    }
}
Write-Host ""

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Document Sync Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
$missingCount = ($Results | Where-Object { $_.Status -eq "MISSING" }).Count
$warnCount = ($Results | Where-Object { $_.Status -eq "VERSION_MISSING" -or $_.Status -eq "RUNTIME_MISSING" }).Count

if ($missingCount -eq 0 -and $warnCount -eq 0) {
    Write-Host "  All checks passed." -ForegroundColor Green
} else {
    if ($missingCount -gt 0) {
        Write-Host "  $missingCount file(s) missing." -ForegroundColor Red
    }
    if ($warnCount -gt 0) {
        Write-Host "  $warnCount warning(s) found." -ForegroundColor Yellow
    }
}
Write-Host "========================================" -ForegroundColor Cyan

exit $(if ($missingCount -gt 0) { 1 } else { 0 })
