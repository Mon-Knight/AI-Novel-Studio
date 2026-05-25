# run_feature_workflow.ps1
# AI Novel Studio - Agent Feature Development Workflow Guide
# Version: v1.0.46
# Purpose: Guide Agent before/after feature development
# Note: Does NOT auto-modify code, auto-commit, or auto-tag

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\..\.."

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AI Novel Studio - Feature Dev Workflow" -ForegroundColor Cyan
Write-Host "  Version: v1.0.46" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$allOk = $true

# Step 1: Check git status
Write-Host "[Step 1/7] Checking git status..." -ForegroundColor Yellow
Push-Location $ProjectRoot
$gitStatus = git status --short 2>&1
Pop-Location
if ($gitStatus -and $gitStatus.Trim().Length -gt 0) {
    Write-Host "  Working tree has changes:" -ForegroundColor Yellow
    $gitStatus | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
} else {
    Write-Host "  Working tree is clean." -ForegroundColor Green
}
Write-Host ""

# Step 2: Check AGENTS.md
Write-Host "[Step 2/7] Checking AGENTS.md..." -ForegroundColor Yellow
if (Test-Path "$ProjectRoot\AGENTS.md") {
    Write-Host "  [OK] AGENTS.md exists." -ForegroundColor Green
} else {
    Write-Host "  [MISSING] AGENTS.md not found! Agent must read it first." -ForegroundColor Red
    $allOk = $false
}
Write-Host ""

# Step 3: Check docs/development-rules.md
Write-Host "[Step 3/7] Checking docs/development-rules.md..." -ForegroundColor Yellow
if (Test-Path "$ProjectRoot\docs\development-rules.md") {
    Write-Host "  [OK] docs/development-rules.md exists." -ForegroundColor Green
} else {
    Write-Host "  [MISSING] docs/development-rules.md not found!" -ForegroundColor Red
    $allOk = $false
}
Write-Host ""

# Step 4: Check feature-development.checklist.md
Write-Host "[Step 4/7] Checking feature-development.checklist.md..." -ForegroundColor Yellow
if (Test-Path "$ProjectRoot\.github\checklists\feature-development.checklist.md") {
    Write-Host "  [OK] feature-development.checklist.md exists." -ForegroundColor Green
} else {
    Write-Host "  [MISSING] feature-development.checklist.md not found!" -ForegroundColor Red
    $allOk = $false
}
Write-Host ""

# Step 5: Run verify_project.ps1
Write-Host "[Step 5/7] Running verify_project.ps1..." -ForegroundColor Yellow
$verifyScript = "$ProjectRoot\scripts\agent-workflow\verify_project.ps1"
if (Test-Path $verifyScript) {
    & powershell -ExecutionPolicy Bypass -File $verifyScript
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [WARN] verify_project.ps1 reported issues." -ForegroundColor Yellow
    } else {
        Write-Host "  [OK] verify_project.ps1 passed." -ForegroundColor Green
    }
} else {
    Write-Host "  [MISSING] verify_project.ps1 not found!" -ForegroundColor Red
    $allOk = $false
}
Write-Host ""

# Step 6: Run check_docs_sync.ps1
Write-Host "[Step 6/7] Running check_docs_sync.ps1..." -ForegroundColor Yellow
$checkDocsScript = "$ProjectRoot\scripts\agent-workflow\check_docs_sync.ps1"
if (Test-Path $checkDocsScript) {
    & powershell -ExecutionPolicy Bypass -File $checkDocsScript
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [WARN] check_docs_sync.ps1 reported issues." -ForegroundColor Yellow
    } else {
        Write-Host "  [OK] check_docs_sync.ps1 passed." -ForegroundColor Green
    }
} else {
    Write-Host "  [MISSING] check_docs_sync.ps1 not found!" -ForegroundColor Red
    $allOk = $false
}
Write-Host ""

# Step 7: Output next steps
Write-Host "[Step 7/7] Workflow summary and next steps..." -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Next Steps" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  1. Confirm you have read AGENTS.md and relevant docs/" -ForegroundColor White
Write-Host "  2. Confirm version goal and forbidden modification scope" -ForegroundColor White
Write-Host "  3. Follow .github/checklists/feature-development.checklist.md" -ForegroundColor White
Write-Host "  4. Re-run this script after modifications complete" -ForegroundColor White
Write-Host "  5. Update CHANGELOG.md and README.md if needed" -ForegroundColor White
Write-Host "  6. Output completion report" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($allOk) {
    Write-Host "  Workflow check: ALL OK" -ForegroundColor Green
} else {
    Write-Host "  Workflow check: SOME ISSUES FOUND" -ForegroundColor Red
}

exit $(if ($allOk) { 0 } else { 1 })
