# release_workflow.ps1
# AI Novel Studio - Pre-release Check
# Version: v1.0.44
# Purpose: Pre-release checks, does NOT force release
# Warning: Does NOT auto-create tag, auto-push, auto-delete, or auto-modify version

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\..\.."

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AI Novel Studio - Pre-release Check" -ForegroundColor Cyan
Write-Host "  Version: v1.0.44" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$CURRENT_VERSION = "1.0.44"
$allOk = $true

# Step 1: Check CHANGELOG.md contains current version
Write-Host "[Step 1/5] Checking CHANGELOG.md for v$CURRENT_VERSION..." -ForegroundColor Yellow
$changelogPath = Join-Path $ProjectRoot "CHANGELOG.md"
if (Test-Path $changelogPath) {
    $changelogContent = Get-Content $changelogPath -Raw
    if ($changelogContent -match "v$CURRENT_VERSION") {
        Write-Host "  [OK] CHANGELOG.md contains v$CURRENT_VERSION" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] CHANGELOG.md does NOT contain v$CURRENT_VERSION" -ForegroundColor Red
        Write-Host "         Please add v$CURRENT_VERSION entry before release." -ForegroundColor Red
        $allOk = $false
    }
} else {
    Write-Host "  [FAIL] CHANGELOG.md not found!" -ForegroundColor Red
    $allOk = $false
}
Write-Host ""

# Step 2: Check README.md is updated
Write-Host "[Step 2/5] Checking README.md..." -ForegroundColor Yellow
$readmePath = Join-Path $ProjectRoot "README.md"
if (Test-Path $readmePath) {
    $readmeContent = Get-Content $readmePath -Raw
    if ($readmeContent -match "v$CURRENT_VERSION") {
        Write-Host "  [OK] README.md mentions v$CURRENT_VERSION" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] README.md does NOT mention v$CURRENT_VERSION" -ForegroundColor Yellow
        Write-Host "         Current version may need to be updated in README." -ForegroundColor Yellow
    }
    if ($readmeContent -match "Agent (Workflow )?Runtime") {
        Write-Host "  [OK] README.md mentions Agent Runtime" -ForegroundColor Green
    } else {
        Write-Host "  [INFO] README.md does not mention Agent Runtime (may be fine for non-Agent releases)" -ForegroundColor DarkYellow
    }
} else {
    Write-Host "  [FAIL] README.md not found!" -ForegroundColor Red
    $allOk = $false
}
Write-Host ""

# Step 3: Run verify_project.ps1
Write-Host "[Step 3/5] Running verify_project.ps1..." -ForegroundColor Yellow
$verifyScript = "$ProjectRoot\scripts\agent-workflow\verify_project.ps1"
if (Test-Path $verifyScript) {
    & powershell -ExecutionPolicy Bypass -File $verifyScript
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [FAIL] verify_project.ps1 reported issues. Fix before release." -ForegroundColor Red
        $allOk = $false
    } else {
        Write-Host "  [OK] verify_project.ps1 passed." -ForegroundColor Green
    }
} else {
    Write-Host "  [FAIL] verify_project.ps1 not found!" -ForegroundColor Red
    $allOk = $false
}
Write-Host ""

# Step 4: Check git status
Write-Host "[Step 4/5] Checking git status..." -ForegroundColor Yellow
Push-Location $ProjectRoot
$gitStatus = git status --short 2>&1
Pop-Location
if ($gitStatus -and $gitStatus.Trim().Length -gt 0) {
    Write-Host "  [WARN] Working tree is DIRTY. Uncommitted changes:" -ForegroundColor Yellow
    $gitStatus | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
    Write-Host "         Please commit all changes before release." -ForegroundColor Yellow
} else {
    Write-Host "  [OK] Working tree is CLEAN." -ForegroundColor Green
}
Write-Host ""

# Step 5: Release recommendation
Write-Host "[Step 5/5] Release recommendation..." -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Release Recommendation" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if ($allOk) {
    Write-Host "  [OK] All checks passed." -ForegroundColor Green
    Write-Host ""
    Write-Host "  You may now create the release:" -ForegroundColor White
    Write-Host "    git tag v$CURRENT_VERSION" -ForegroundColor White
    Write-Host "    git push origin main" -ForegroundColor White
    Write-Host "    git push origin v$CURRENT_VERSION" -ForegroundColor White
} else {
    Write-Host "  [BLOCKED] Some checks failed." -ForegroundColor Red
    Write-Host "  Please fix the issues above before creating a release." -ForegroundColor Red
}
Write-Host "========================================" -ForegroundColor Cyan

exit $(if ($allOk) { 0 } else { 1 })
