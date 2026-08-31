param()

$ErrorActionPreference = "Stop"

$RepositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$CheckScript = Join-Path $PSScriptRoot "check_docs_sync.ps1"
$PowerShellExe = Join-Path $PSHOME "powershell.exe"
$TempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$FixtureRoot = Join-Path $TempRoot ("ai novel studio docs-sync [fixture]-" + [guid]::NewGuid().ToString("N"))
$FixtureMarker = Join-Path $FixtureRoot ".docs-sync-fixture"
$RepositoryPackage = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $RepositoryRoot "package.json") | ConvertFrom-Json
$CurrentVersion = [string]$RepositoryPackage.version
$CurrentMajor = [int]($CurrentVersion.Split('.')[0])
$StaleMajor = if ($CurrentMajor -eq 1) { 99 } else { 1 }
$StaleVersion = "$StaleMajor.0.0"
$SameMajorStaleVersion = if ($CurrentVersion -ceq "$CurrentMajor.999.999") { "$CurrentMajor.999.998" } else { "$CurrentMajor.999.999" }
$RepositoryReadme = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $RepositoryRoot "README.md")
$CurrentStageMatch = [regex]::Match($RepositoryReadme, '(?m)^\*\*阶段：(?<stage>[^*\r\n]+)\*\*\r?$')
if (-not $CurrentStageMatch.Success) {
    throw "Unable to read the current stage from README.md."
}
$CurrentStage = $CurrentStageMatch.Groups["stage"].Value.Trim()

function Invoke-DocsSyncCheck {
    param([string]$Root)

    $output = & $PowerShellExe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $CheckScript -ProjectRoot $Root 2>&1
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output   = ($output | Out-String).Trim()
    }
}

function Assert-CheckResult {
    param(
        [string]$Label,
        [bool]$ShouldPass,
        [pscustomobject]$Result
    )

    $passed = $Result.ExitCode -eq 0
    if ($passed -ne $ShouldPass) {
        throw "$Label returned exit code $($Result.ExitCode).`n$($Result.Output)"
    }

    $expectation = if ($ShouldPass) { "passed" } else { "failed closed" }
    Write-Host "  [OK] $Label $expectation"
}

function Copy-RepositoryFileToFixture {
    param([string]$RelativePath)

    $source = Join-Path $RepositoryRoot $RelativePath
    $destination = Join-Path $FixtureRoot $RelativePath
    $destinationParent = Split-Path -Parent $destination
    if (-not (Test-Path -LiteralPath $destinationParent)) {
        New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
    }
    Copy-Item -LiteralPath $source -Destination $destination -Force
}

function Copy-RepositoryTreeToFixture {
    param([string]$RelativePath)

    $source = Join-Path $RepositoryRoot $RelativePath
    $destination = Join-Path $FixtureRoot $RelativePath
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $destination -Recurse -Force
}

function Assert-MissingArtifactFails {
    param([string]$RelativePath)

    $fixturePath = Join-Path $FixtureRoot $RelativePath
    Remove-Item -LiteralPath $fixturePath -Force
    Assert-CheckResult "missing $RelativePath" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture $RelativePath
}

function Move-WorkflowStepBefore {
    param(
        [string]$Content,
        [string]$StepName,
        [string]$AnchorStepName
    )

    $stepPattern = "(?ms)^      - name: $([regex]::Escape($StepName))\r?\n.*?(?=^      - |\z)"
    $stepMatch = [regex]::Match($Content, $stepPattern)
    if (-not $stepMatch.Success) {
        throw "Unable to locate workflow step '$StepName'."
    }

    $withoutStep = $Content.Remove($stepMatch.Index, $stepMatch.Length)
    $anchorPattern = "(?m)^      - name: $([regex]::Escape($AnchorStepName))\r?$"
    $anchorMatch = [regex]::Match($withoutStep, $anchorPattern)
    if (-not $anchorMatch.Success) {
        throw "Unable to locate workflow anchor '$AnchorStepName'."
    }

    return $withoutStep.Insert($anchorMatch.Index, $stepMatch.Value)
}

Write-Host "========================================"
Write-Host "  Document Sync Regression Tests"
Write-Host "========================================"

Assert-CheckResult "live repository" $true (Invoke-DocsSyncCheck $RepositoryRoot)
Assert-CheckResult "missing project root" $false (Invoke-DocsSyncCheck (Join-Path $TempRoot ("missing docs-sync root " + [guid]::NewGuid().ToString("N"))))

try {
    New-Item -ItemType Directory -Path $FixtureRoot -Force | Out-Null
    Set-Content -LiteralPath $FixtureMarker -Value "temporary docs-sync fixture" -Encoding UTF8

    foreach ($tree in @("docs", ".github/checklists", ".github/skills", ".github/workflows", "scripts/agent-workflow")) {
        Copy-RepositoryTreeToFixture $tree
    }
    foreach ($file in @("package.json", "README.md", "CHANGELOG.md", "AGENTS.md", ".github/copilot-instructions.md", ".github/pull_request_template.md", ".github/dependabot.yml")) {
        Copy-RepositoryFileToFixture $file
    }

    Assert-CheckResult "valid fixture" $true (Invoke-DocsSyncCheck $FixtureRoot)

    foreach ($missingArtifact in @(
        "docs/development-skills.md",
        "docs/project/git-workflow.md",
        "docs/project/release-history.md",
        ".github/checklists/docs-sync.checklist.md",
        ".github/skills/docs-sync/SKILL.md",
        ".github/pull_request_template.md",
        ".github/workflows/release.yml",
        "scripts/agent-workflow/release_workflow.ps1"
    )) {
        Assert-MissingArtifactFails $missingArtifact
    }

    $releaseWorkflowPath = Join-Path $FixtureRoot ".github/workflows/release.yml"
    $releaseWorkflow = Get-Content -Raw -Encoding UTF8 -LiteralPath $releaseWorkflowPath
    $releaseWorkflow = $releaseWorkflow -replace 'needs: desktop-gate', 'needs: omitted-desktop-gate'
    Set-Content -LiteralPath $releaseWorkflowPath -Value $releaseWorkflow -Encoding UTF8
    Assert-CheckResult "release without desktop dependency" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture ".github/workflows/release.yml"

    $releaseWorkflow = Get-Content -Raw -Encoding UTF8 -LiteralPath $releaseWorkflowPath
    $releaseWorkflow = Move-WorkflowStepBefore $releaseWorkflow "Run Rust tests" "Checkout pinned DSH runtime source"
    Set-Content -LiteralPath $releaseWorkflowPath -Value $releaseWorkflow -Encoding UTF8
    Assert-CheckResult "release tests before DSH runtime" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture ".github/workflows/release.yml"

    $releaseWorkflow = Get-Content -Raw -Encoding UTF8 -LiteralPath $releaseWorkflowPath
    $releaseParallelRust = $releaseWorkflow.Replace('-- --test-threads=1', '-- --test-threads=8')
    Set-Content -LiteralPath $releaseWorkflowPath -Value $releaseParallelRust -Encoding UTF8
    Assert-CheckResult "release Rust tests without serial DSH guard" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture ".github/workflows/release.yml"

    $releaseWorkflow = Get-Content -Raw -Encoding UTF8 -LiteralPath $releaseWorkflowPath
    $releaseWithoutDshExport = $releaseWorkflow.Replace('"DSH_CHECKOUT=$env:GITHUB_WORKSPACE\.dsh-checkout"', '"DSH_CHECKOUT_REMOVED"')
    if ($releaseWithoutDshExport -ceq $releaseWorkflow) {
        throw "Unable to remove the release DSH_CHECKOUT export fixture."
    }
    Set-Content -LiteralPath $releaseWorkflowPath -Value $releaseWithoutDshExport -Encoding UTF8
    Assert-CheckResult "release without DSH runtime export" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture ".github/workflows/release.yml"

    $desktopWorkflowPath = Join-Path $FixtureRoot ".github/workflows/windows-desktop-e2e.yml"
    $desktopWorkflow = Get-Content -Raw -Encoding UTF8 -LiteralPath $desktopWorkflowPath
    $desktopWorkflow = $desktopWorkflow -replace 'workflow_call:', 'workflow_call_removed:'
    Set-Content -LiteralPath $desktopWorkflowPath -Value $desktopWorkflow -Encoding UTF8
    Assert-CheckResult "desktop workflow without reusable gate" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture ".github/workflows/windows-desktop-e2e.yml"

    $desktopWorkflow = Get-Content -Raw -Encoding UTF8 -LiteralPath $desktopWorkflowPath
    $desktopWorkflow = Move-WorkflowStepBefore $desktopWorkflow "Run Rust tests" "Checkout pinned DSH runtime source"
    Set-Content -LiteralPath $desktopWorkflowPath -Value $desktopWorkflow -Encoding UTF8
    Assert-CheckResult "desktop tests before DSH runtime" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture ".github/workflows/windows-desktop-e2e.yml"

    $desktopWorkflow = Get-Content -Raw -Encoding UTF8 -LiteralPath $desktopWorkflowPath
    $desktopParallelRust = $desktopWorkflow.Replace('-- --test-threads=1', '-- --test-threads=8')
    Set-Content -LiteralPath $desktopWorkflowPath -Value $desktopParallelRust -Encoding UTF8
    Assert-CheckResult "desktop Rust tests without serial DSH guard" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture ".github/workflows/windows-desktop-e2e.yml"

    $desktopWorkflow = Get-Content -Raw -Encoding UTF8 -LiteralPath $desktopWorkflowPath
    $desktopWithoutDshExport = $desktopWorkflow.Replace('"DSH_CHECKOUT=$env:GITHUB_WORKSPACE\.dsh-checkout"', '"DSH_CHECKOUT_REMOVED"')
    if ($desktopWithoutDshExport -ceq $desktopWorkflow) {
        throw "Unable to remove the desktop DSH_CHECKOUT export fixture."
    }
    Set-Content -LiteralPath $desktopWorkflowPath -Value $desktopWithoutDshExport -Encoding UTF8
    Assert-CheckResult "desktop workflow without DSH runtime export" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture ".github/workflows/windows-desktop-e2e.yml"

    $verificationScriptPath = Join-Path $FixtureRoot "scripts/agent-workflow/verify_project.ps1"
    $verificationScript = Get-Content -Raw -Encoding UTF8 -LiteralPath $verificationScriptPath
    $verificationParallelRust = $verificationScript.Replace('--test-threads=1', '--test-threads=8')
    Set-Content -LiteralPath $verificationScriptPath -Value $verificationParallelRust -Encoding UTF8
    Assert-CheckResult "local verification without serial DSH guard" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture "scripts/agent-workflow/verify_project.ps1"

    $pullRequestTemplatePath = Join-Path $FixtureRoot ".github/pull_request_template.md"
    $pullRequestTemplate = Get-Content -Raw -Encoding UTF8 -LiteralPath $pullRequestTemplatePath
    $pullRequestTemplateParallelRust = $pullRequestTemplate.Replace('-- --test-threads=1', '')
    Set-Content -LiteralPath $pullRequestTemplatePath -Value $pullRequestTemplateParallelRust -Encoding UTF8
    Assert-CheckResult "PR template without serial DSH guard" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture ".github/pull_request_template.md"

    $fastCiWorkflowPath = Join-Path $FixtureRoot ".github/workflows/ci.yml"
    $fastCiWorkflow = Get-Content -Raw -Encoding UTF8 -LiteralPath $fastCiWorkflowPath
    $fastCiWorkflow = $fastCiWorkflow -replace 'npm run test:bundle-size', 'npm run bundle-size-gate-removed'
    Set-Content -LiteralPath $fastCiWorkflowPath -Value $fastCiWorkflow -Encoding UTF8
    Assert-CheckResult "fast CI without bundle budget" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture ".github/workflows/ci.yml"

    $fragmentedReleaseNote = Join-Path $FixtureRoot "docs/release-notes-v9.9.9.md"
    Set-Content -LiteralPath $fragmentedReleaseNote -Value "# fragmented release note fixture" -Encoding UTF8
    Assert-CheckResult "fragmented release notes" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Remove-Item -LiteralPath $fragmentedReleaseNote -Force

    $developmentRulesPath = Join-Path $FixtureRoot "docs/development-rules.md"
    Add-Content -LiteralPath $developmentRulesPath -Value "`ngit push origin main" -Encoding UTF8
    Assert-CheckResult "direct main push instruction" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture "docs/development-rules.md"

    $packagePath = Join-Path $FixtureRoot "package.json"
    Set-Content -LiteralPath $packagePath -Value '{ invalid json' -Encoding UTF8
    Assert-CheckResult "invalid package.json" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture "package.json"

    $readmePath = Join-Path $FixtureRoot "README.md"
    $readme = Get-Content -Raw -Encoding UTF8 -LiteralPath $readmePath
    Set-Content -LiteralPath $readmePath -Value ($readme + "`n**当前版本：v$CurrentVersion**`n") -Encoding UTF8
    Assert-CheckResult "duplicate README current version" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture "README.md"

    $readme = Get-Content -Raw -Encoding UTF8 -LiteralPath $readmePath
    $readme = $readme -replace [regex]::Escape("**阶段：$CurrentStage**"), '**阶段：过期阶段夹具**'
    Set-Content -LiteralPath $readmePath -Value $readme -Encoding UTF8
    Assert-CheckResult "README/roadmap stage mismatch" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture "README.md"

    $readme = Get-Content -Raw -Encoding UTF8 -LiteralPath $readmePath
    $readme = $readme -replace 'Agent (Workflow )?Runtime', 'Agent Engine'
    Set-Content -LiteralPath $readmePath -Value $readme -Encoding UTF8
    Assert-CheckResult "missing README Agent Runtime mention" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture "README.md"

    $roadmapPath = Join-Path $FixtureRoot "docs/version-roadmap.md"
    Add-Content -LiteralPath $roadmapPath -Value "`n| v$StaleMajor.x | **当前** | stale-version fixture |" -Encoding UTF8
    Assert-CheckResult "stale current-version marker" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture "docs/version-roadmap.md"

    Add-Content -LiteralPath $roadmapPath -Value "`n| v$SameMajorStaleVersion | **当前** | stale-same-major fixture |" -Encoding UTF8
    Assert-CheckResult "stale same-major current-version marker" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture "docs/version-roadmap.md"

    $aiRoadmapPath = Join-Path $FixtureRoot "docs/ai-agent-roadmap.md"
    Add-Content -LiteralPath $aiRoadmapPath -Value "`n## Phase $StaleMajor：过期阶段夹具（v$StaleMajor.x，当前阶段）" -Encoding UTF8
    Assert-CheckResult "stale current-stage marker" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture "docs/ai-agent-roadmap.md"

    $changelogPath = Join-Path $FixtureRoot "CHANGELOG.md"
    $changelog = Get-Content -Raw -Encoding UTF8 -LiteralPath $changelogPath
    $changelog = $changelog -replace "(?m)^##\s+v$([regex]::Escape($CurrentVersion))\b", "## v$StaleVersion"
    Set-Content -LiteralPath $changelogPath -Value $changelog -Encoding UTF8
    Assert-CheckResult "stale CHANGELOG newest entry" $false (Invoke-DocsSyncCheck $FixtureRoot)
    Copy-RepositoryFileToFixture "CHANGELOG.md"

    $changelog = Get-Content -Raw -Encoding UTF8 -LiteralPath $changelogPath
    Set-Content -LiteralPath $changelogPath -Value ($changelog + "`n## v$CurrentVersion (fixture) - $CurrentStage`n") -Encoding UTF8
    Assert-CheckResult "duplicate CHANGELOG current entry" $false (Invoke-DocsSyncCheck $FixtureRoot)

    Write-Host "Document sync regression tests passed."
} finally {
    $resolvedFixture = [System.IO.Path]::GetFullPath($FixtureRoot)
    $tempPrefix = $TempRoot.TrimEnd('\') + '\'
    $isInsideTemp = $resolvedFixture.StartsWith($tempPrefix, [System.StringComparison]::OrdinalIgnoreCase)
    if ($isInsideTemp -and (Test-Path -LiteralPath $FixtureMarker -PathType Leaf)) {
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    } elseif (Test-Path -LiteralPath $resolvedFixture) {
        throw "Refusing to remove unverified fixture path: $resolvedFixture"
    }
}
