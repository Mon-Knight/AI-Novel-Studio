# verify_project.ps1
# AI Novel Studio - Unified Project Verification
# Version: derived from package.json
# Purpose: Run the complete release-quality verification matrix.

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$package = Get-Content -LiteralPath (Join-Path $ProjectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$CURRENT_VERSION = [string]$package.version
$Results = @()

function Resolve-Executable {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Candidates
    )

    foreach ($candidate in $Candidates) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) {
            return $command.Source
        }
    }

    throw "Required executable was not found: $($Candidates -join ', ')"
}

function Add-VerificationResult {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Step,
        [Parameter(Mandatory = $true)]
        [ValidateSet("PASS", "FAIL", "CLEAN", "DIRTY")]
        [string]$Status
    )

    $script:Results += [pscustomobject]@{
        Step = $Step
        Status = $Status
    }
}

function Invoke-VerificationStep {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory = $true)]
        [string]$Executable,
        [string[]]$Arguments = @()
    )

    Write-Host "[verify_project] Running $Name..." -ForegroundColor Yellow
    Push-Location $WorkingDirectory
    try {
        & $Executable @Arguments
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) {
            $exitCode = 0
        }

        if ($exitCode -eq 0) {
            Write-Host "[verify_project] ${Name}: PASS" -ForegroundColor Green
            Add-VerificationResult -Step $Name -Status "PASS"
        } else {
            Write-Host "[verify_project] ${Name}: FAIL (exit code $exitCode)" -ForegroundColor Red
            Add-VerificationResult -Step $Name -Status "FAIL"
        }
    } catch {
        Write-Host "[verify_project] ${Name}: FAIL" -ForegroundColor Red
        Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
        Add-VerificationResult -Step $Name -Status "FAIL"
    } finally {
        Pop-Location
    }
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AI Novel Studio - Project Verification" -ForegroundColor Cyan
Write-Host "  Version: v$CURRENT_VERSION" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

try {
    $npm = Resolve-Executable -Candidates @("npm.cmd", "npm")
} catch {
    $npm = "npm.cmd"
}

try {
    $cargo = Resolve-Executable -Candidates @("cargo.exe", "cargo")
} catch {
    $cargoFallback = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
    $cargo = if (Test-Path -LiteralPath $cargoFallback) { $cargoFallback } else { "cargo.exe" }
}

if (Test-Path -LiteralPath $cargo) {
    $cargoDirectory = Split-Path -Parent $cargo
    $pathEntries = @($env:PATH -split ';')
    if ($cargoDirectory -and $cargoDirectory -notin $pathEntries) {
        $env:PATH = "$cargoDirectory;$env:PATH"
    }
}

$npmSteps = @(
    @{ Name = "npm run test:version-sync"; Arguments = @("run", "test:version-sync") },
    @{ Name = "npm run test:docs-sync"; Arguments = @("run", "test:docs-sync") },
    @{ Name = "npm run test:coverage"; Arguments = @("run", "test:coverage") },
    @{ Name = "npm run test:component-size"; Arguments = @("run", "test:component-size") },
    @{ Name = "npm run lint:ci"; Arguments = @("run", "lint:ci") },
    @{ Name = "npm run build"; Arguments = @("run", "build") },
    @{ Name = "npm run test:bundle-size"; Arguments = @("run", "test:bundle-size") },
    @{ Name = "npm run test:ai-tasks-delete"; Arguments = @("run", "test:ai-tasks-delete") },
    @{ Name = "npm run test:project-backup"; Arguments = @("run", "test:project-backup") }
)

foreach ($step in $npmSteps) {
    Invoke-VerificationStep -Name $step.Name -WorkingDirectory $ProjectRoot -Executable $npm -Arguments $step.Arguments
}

Invoke-VerificationStep -Name "cargo check" -WorkingDirectory (Join-Path $ProjectRoot "src-tauri") -Executable $cargo -Arguments @("check")
Invoke-VerificationStep -Name "cargo clean -p novel-domain-gateway" -WorkingDirectory (Join-Path $ProjectRoot "src-tauri") -Executable $cargo -Arguments @("clean", "-p", "novel-domain-gateway")
Invoke-VerificationStep -Name "cargo build -p novel-domain-gateway" -WorkingDirectory (Join-Path $ProjectRoot "src-tauri") -Executable $cargo -Arguments @("build", "--locked", "-p", "novel-domain-gateway")
Invoke-VerificationStep -Name "cargo test" -WorkingDirectory (Join-Path $ProjectRoot "src-tauri") -Executable $cargo -Arguments @("test", "--locked", "--", "--test-threads=1")

# The complete desktop suite is a release gate, not a substitute for Node or Rust tests.
Invoke-VerificationStep -Name "npm run test:e2e" -WorkingDirectory $ProjectRoot -Executable $npm -Arguments @("run", "test:e2e")
Invoke-VerificationStep -Name "npm run tauri:build" -WorkingDirectory $ProjectRoot -Executable $npm -Arguments @("run", "tauri:build")

Write-Host "[verify_project] Checking required checklists..." -ForegroundColor Yellow
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
$missingChecklists = @($checklistFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $ProjectRoot $_)) })
if ($missingChecklists.Count -eq 0) {
    Write-Host "[verify_project] required checklists: PASS" -ForegroundColor Green
    Add-VerificationResult -Step "required checklists" -Status "PASS"
} else {
    $missingChecklists | ForEach-Object { Write-Host "  [MISSING] $_" -ForegroundColor Red }
    Add-VerificationResult -Step "required checklists" -Status "FAIL"
}
Write-Host ""

# A release-quality run must finish from a clean tree. release_workflow.ps1 repeats
# this check so that a dirty tree can never receive a release recommendation.
Write-Host "[verify_project] Checking git status..." -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    $gitStatus = @(git status --short 2>&1)
    if ($LASTEXITCODE -ne 0) {
        $gitStatus | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        Add-VerificationResult -Step "git status" -Status "FAIL"
    } elseif ($gitStatus.Count -gt 0) {
        Write-Host "[verify_project] git status: DIRTY" -ForegroundColor Red
        $gitStatus | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        Add-VerificationResult -Step "git status" -Status "DIRTY"
    } else {
        Write-Host "[verify_project] git status: CLEAN" -ForegroundColor Green
        Add-VerificationResult -Step "git status" -Status "CLEAN"
    }
} catch {
    Write-Host "[verify_project] git status: FAIL" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    Add-VerificationResult -Step "git status" -Status "FAIL"
} finally {
    Pop-Location
}
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Verification Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
$allPassed = $true
foreach ($result in $Results) {
    $color = if ($result.Status -in @("PASS", "CLEAN")) {
        "Green"
    } else {
        $allPassed = $false
        "Red"
    }
    Write-Host "  [$($result.Status)] $($result.Step)" -ForegroundColor $color
}

Write-Host ""
if ($allPassed) {
    Write-Host "  Overall: ALL CHECKS PASSED" -ForegroundColor Green
} else {
    Write-Host "  Overall: RELEASE BLOCKED" -ForegroundColor Red
}
Write-Host "========================================" -ForegroundColor Cyan

exit $(if ($allPassed) { 0 } else { 1 })
