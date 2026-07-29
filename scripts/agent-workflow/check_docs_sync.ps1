param(
    [Parameter(Mandatory = $false)]
    [string]$ProjectRoot
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Join-Path $ScriptDir "..\.."
}

try {
    $ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot -ErrorAction Stop).Path
} catch {
    Write-Host "[FAIL] Project root does not exist: $ProjectRoot" -ForegroundColor Red
    exit 1
}

$Results = New-Object System.Collections.Generic.List[object]

function Add-CheckResult {
    param(
        [string]$Name,
        [bool]$Passed,
        [string]$Detail
    )

    [void]$Results.Add([pscustomobject]@{
        Name   = $Name
        Passed = $Passed
        Detail = $Detail
    })

    if ($Passed) {
        Write-Host "  [OK] $Name - $Detail" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] $Name - $Detail" -ForegroundColor Red
    }
}

function Get-ProjectPath {
    param([string]$RelativePath)
    return Join-Path $ProjectRoot $RelativePath
}

function Read-Utf8Text {
    param([string]$RelativePath)
    return Get-Content -Raw -Encoding UTF8 -LiteralPath (Get-ProjectPath $RelativePath)
}

function Get-OptionalText {
    param([string]$RelativePath)
    $path = Get-ProjectPath $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return $null
    }
    return Read-Utf8Text $RelativePath
}

function Get-UniqueCapture {
    param(
        [string]$Label,
        [string]$Content,
        [string]$Pattern,
        [string]$GroupName = "value"
    )

    $matches = [regex]::Matches([string]$Content, $Pattern)
    if ($matches.Count -ne 1) {
        Add-CheckResult $Label $false "expected exactly one declaration, found $($matches.Count)"
        return $null
    }

    $value = $matches[0].Groups[$GroupName].Value.Trim()
    Add-CheckResult $Label $true $value
    return $value
}

function Test-ExpectedValue {
    param(
        [string]$Label,
        [string]$Expected,
        [string]$Actual
    )

    if ($null -eq $Actual) {
        return
    }

    Add-CheckResult $Label ($Actual -ceq $Expected) "expected '$Expected', got '$Actual'"
}

function Test-CurrentMarkersMatchVersion {
    param(
        [string]$RelativePath,
        [string]$Content,
        [string]$CurrentVersion
    )

    if ($null -eq $Content) {
        return
    }

    $currentMajor = [int]($CurrentVersion.Split('.')[0])
    $versionRegex = New-Object System.Text.RegularExpressions.Regex('v(?<major>[0-9]+)(?:\.(?:[0-9]+|x)){1,2}', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $markerRegex = New-Object System.Text.RegularExpressions.Regex('(?:当前所处|当前阶段|（当前[^）\r\n]*）|\*\*当前[^*\r\n]*\*\*)')
    $staleMarkers = New-Object System.Collections.Generic.List[string]

    foreach ($line in [regex]::Split($Content, '\r?\n')) {
        $versionMatches = @($versionRegex.Matches($line))
        if ($versionMatches.Count -eq 0) {
            continue
        }

        foreach ($markerMatch in $markerRegex.Matches($line)) {
            $nearestVersion = $null
            $nearestDistance = [int]::MaxValue
            foreach ($versionMatch in $versionMatches) {
                $versionEnd = $versionMatch.Index + $versionMatch.Length
                $markerEnd = $markerMatch.Index + $markerMatch.Length
                if ($versionEnd -le $markerMatch.Index) {
                    $distance = $markerMatch.Index - $versionEnd
                } elseif ($markerEnd -le $versionMatch.Index) {
                    $distance = $versionMatch.Index - $markerEnd
                } else {
                    $distance = 0
                }

                if ($distance -lt $nearestDistance) {
                    $nearestVersion = $versionMatch
                    $nearestDistance = $distance
                }
            }

            if ($null -ne $nearestVersion) {
                $markerVersion = $nearestVersion.Value.Substring(1)
                $markerMatchesCurrent = if ($markerVersion -match '\.x(?:\.x)?$') {
                    [int]$nearestVersion.Groups["major"].Value -eq $currentMajor
                } else {
                    $markerVersion -ceq $CurrentVersion
                }

                if (-not $markerMatchesCurrent) {
                    $staleMarker = ($line -replace '\s+', ' ').Trim()
                    if (-not $staleMarkers.Contains($staleMarker)) {
                        [void]$staleMarkers.Add($staleMarker)
                    }
                }
            }
        }
    }

    if ($staleMarkers.Count -eq 0) {
        Add-CheckResult "$RelativePath current markers" $true "all explicit current markers target v$CurrentVersion or v$currentMajor.x"
    } else {
        Add-CheckResult "$RelativePath current markers" $false ($staleMarkers -join "; ")
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AI Novel Studio - Document Sync Check" -ForegroundColor Cyan
Write-Host "  Root: $ProjectRoot" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$documentFiles = @(
    "README.md",
    "CHANGELOG.md",
    "docs/version-roadmap.md",
    "docs/agent-runtime.md",
    "docs/development-skills.md",
    "AGENTS.md",
    ".github/copilot-instructions.md",
    "docs/development-rules.md",
    "docs/agent-workflow.md",
    "docs/ai-agent-roadmap.md",
    "docs/project/git-workflow.md",
    "docs/project/release-history.md",
    "docs/technical/diagnostics.md"
)

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

$skillFiles = @(
    ".github/skills/agent-task-writer/SKILL.md",
    ".github/skills/bugfix-safe-patch/SKILL.md",
    ".github/skills/docs-sync/SKILL.md",
    ".github/skills/db-migration-guard/SKILL.md",
    ".github/skills/implement-feature/SKILL.md",
    ".github/skills/plan-version/SKILL.md",
    ".github/skills/release-package/SKILL.md",
    ".github/skills/review-ui/SKILL.md",
    ".github/skills/tauri-desktop-build/SKILL.md",
    ".github/skills/verify-build/SKILL.md"
)

$workflowScriptFiles = @(
    "scripts/agent-workflow/verify_project.ps1",
    "scripts/agent-workflow/check_docs_sync.ps1",
    "scripts/agent-workflow/test_docs_sync.ps1",
    "scripts/agent-workflow/run_feature_workflow.ps1",
    "scripts/agent-workflow/release_workflow.ps1"
)

$governanceFiles = @(
    ".github/pull_request_template.md",
    ".github/dependabot.yml",
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
    ".github/workflows/security.yml",
    ".github/workflows/windows-desktop-e2e.yml"
)

$requiredFiles = @(
    "package.json"
    $documentFiles
    $checklistFiles
    $skillFiles
    $workflowScriptFiles
    $governanceFiles
) | Select-Object -Unique

Write-Host ""
Write-Host "[check_docs] Required artifacts" -ForegroundColor Yellow
foreach ($file in $requiredFiles) {
    $exists = Test-Path -LiteralPath (Get-ProjectPath $file) -PathType Leaf
    Add-CheckResult $file $exists $(if ($exists) { "exists" } else { "missing" })
}

$fastCiWorkflow = Get-OptionalText ".github/workflows/ci.yml"
Add-CheckResult "fast CI bundle budget" ([string]$fastCiWorkflow).Contains("npm run test:bundle-size") "production build is followed by the bundle-size gate"

$desktopWorkflow = Get-OptionalText ".github/workflows/windows-desktop-e2e.yml"
$desktopWorkflowHasReusableGate =
    ([string]$desktopWorkflow).Contains("workflow_call:") -and
    ([string]$desktopWorkflow).Contains("npm run test:bundle-size")
Add-CheckResult "reusable desktop release gate" $desktopWorkflowHasReusableGate "workflow_call and bundle-size gate are present"

$releaseWorkflow = Get-OptionalText ".github/workflows/release.yml"
$releaseRequiresDesktopGate =
    ([string]$releaseWorkflow).Contains("uses: ./.github/workflows/windows-desktop-e2e.yml") -and
    ([string]$releaseWorkflow).Contains("needs: desktop-gate") -and
    ([string]$releaseWorkflow).Contains("suite: full") -and
    ([string]$releaseWorkflow).Contains("npm run test:bundle-size")
Add-CheckResult "release waits for full desktop gate" $releaseRequiresDesktopGate "signed release depends on full reusable desktop E2E and bundle budgets"

$releaseNoteFragments = @(Get-ChildItem -LiteralPath (Get-ProjectPath "docs") -File -Filter "release-notes-v*.md" -ErrorAction SilentlyContinue)
Add-CheckResult "single release history archive" ($releaseNoteFragments.Count -eq 0) $(if ($releaseNoteFragments.Count -eq 0) { "no per-version fragments" } else { ($releaseNoteFragments.Name -join ", ") })

$releaseHistory = Get-OptionalText "docs/project/release-history.md"
$archivedReleaseCount = [regex]::Matches([string]$releaseHistory, '(?m)^<a id="v[^">]+"></a>$').Count
Add-CheckResult "release history snapshot count" ($archivedReleaseCount -eq 40) "expected 40 merged snapshots, found $archivedReleaseCount"
Add-CheckResult "release history CHANGELOG authority" ([string]$releaseHistory).Contains('[`CHANGELOG.md`](../../CHANGELOG.md)') "CHANGELOG is the active release source"

$gitWorkflow = Get-OptionalText "docs/project/git-workflow.md"
$gitWorkflowRequiredTerms = @("main", "codex/", "Pull Request", "required check", "force push", "hotfix", "tag", "rollback")
$missingGitWorkflowTerms = @($gitWorkflowRequiredTerms | Where-Object { -not ([string]$gitWorkflow).Contains($_) })
Add-CheckResult "Git workflow policy coverage" ($missingGitWorkflowTerms.Count -eq 0) $(if ($missingGitWorkflowTerms.Count -eq 0) { "branch, review, release and rollback terms present" } else { "missing: $($missingGitWorkflowTerms -join ', ')" })

$directMainPushLocations = @()
foreach ($policyFile in @(
    "AGENTS.md",
    ".github/copilot-instructions.md",
    ".github/skills/release-package/SKILL.md",
    ".github/checklists/release.checklist.md",
    "docs/development-rules.md",
    "docs/product-design.md",
    "docs/version-roadmap.md",
    "scripts/agent-workflow/release_workflow.ps1"
)) {
    $policyText = Get-OptionalText $policyFile
    if ([regex]::IsMatch([string]$policyText, '(?m)^\s*git push origin main\s*$')) {
        $directMainPushLocations += $policyFile
    }
}
Add-CheckResult "protected main workflow" ($directMainPushLocations.Count -eq 0) $(if ($directMainPushLocations.Count -eq 0) { "no active direct-push instructions" } else { "direct push instruction in: $($directMainPushLocations -join ', ')" })

$currentVersion = $null
$packagePath = Get-ProjectPath "package.json"
if (Test-Path -LiteralPath $packagePath -PathType Leaf) {
    try {
        $package = Read-Utf8Text "package.json" | ConvertFrom-Json
        $candidateVersion = [string]$package.version
        if ($candidateVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
            throw "version '$candidateVersion' is not a semantic X.Y.Z version"
        }
        $currentVersion = $candidateVersion
        Add-CheckResult "package.json version source" $true "v$currentVersion"
    } catch {
        Add-CheckResult "package.json version source" $false $_.Exception.Message
    }
}

if ($null -ne $currentVersion) {
    Write-Host ""
    Write-Host "[check_docs] Authoritative version and stage declarations" -ForegroundColor Yellow

    $readme = Get-OptionalText "README.md"
    $changelog = Get-OptionalText "CHANGELOG.md"
    $roadmap = Get-OptionalText "docs/version-roadmap.md"
    $agentRuntime = Get-OptionalText "docs/agent-runtime.md"
    $agents = Get-OptionalText "AGENTS.md"
    $copilot = Get-OptionalText ".github/copilot-instructions.md"
    $agentWorkflow = Get-OptionalText "docs/agent-workflow.md"
    $aiAgentRoadmap = Get-OptionalText "docs/ai-agent-roadmap.md"
    $developmentSkills = Get-OptionalText "docs/development-skills.md"

    $readmeVersion = Get-UniqueCapture "README current version declaration" $readme '(?m)^\*\*当前版本：v(?<value>[0-9]+\.[0-9]+\.[0-9]+)\*\*\r?$'
    Test-ExpectedValue "README current version" $currentVersion $readmeVersion

    $readmeStage = Get-UniqueCapture "README current stage declaration" $readme '(?m)^\*\*阶段：(?<value>[^*\r\n]+)\*\*\r?$'

    $roadmapMatches = [regex]::Matches([string]$roadmap, '(?m)^>\s*当前版本：v(?<version>[0-9]+\.[0-9]+\.[0-9]+)[（(](?<stage>[^）)\r\n]+)[）)]\r?$')
    $roadmapStage = $null
    if ($roadmapMatches.Count -eq 1) {
        $roadmapVersion = $roadmapMatches[0].Groups["version"].Value.Trim()
        $roadmapStage = $roadmapMatches[0].Groups["stage"].Value.Trim()
        Add-CheckResult "roadmap current declaration" $true "v$roadmapVersion ($roadmapStage)"
        Test-ExpectedValue "roadmap current version" $currentVersion $roadmapVersion
    } else {
        Add-CheckResult "roadmap current declaration" $false "expected exactly one declaration, found $($roadmapMatches.Count)"
    }

    if ($null -ne $readmeStage -and $null -ne $roadmapStage) {
        Test-ExpectedValue "README/roadmap stage mirror" $roadmapStage $readmeStage
    }

    $runtimeVersion = Get-UniqueCapture "Agent Runtime version declaration" $agentRuntime '(?m)^>\s*版本：v(?<value>[0-9]+\.[0-9]+\.[0-9]+)\s*\r?$'
    Test-ExpectedValue "Agent Runtime current version" $currentVersion $runtimeVersion

    $changelogMatches = [regex]::Matches([string]$changelog, '(?m)^##\s+v(?<version>[0-9]+\.[0-9]+\.[0-9]+)\b(?<suffix>[^\r\n]*)\r?$')
    $changelogMatch = if ($changelogMatches.Count -gt 0) { $changelogMatches[0] } else { $null }
    if ($null -ne $changelogMatch -and $changelogMatch.Success) {
        Test-ExpectedValue "CHANGELOG newest entry" $currentVersion $changelogMatch.Groups["version"].Value
        $currentEntryCount = @($changelogMatches | Where-Object { $_.Groups["version"].Value -ceq $currentVersion }).Count
        Add-CheckResult "CHANGELOG unique current entry" ($currentEntryCount -eq 1) "expected one v$currentVersion heading, found $currentEntryCount"

        $changelogStageMatch = [regex]::Match($changelogMatch.Groups["suffix"].Value, '\s+-\s+(?<stage>[^\r\n]+)$')
        if (-not $changelogStageMatch.Success) {
            Add-CheckResult "CHANGELOG current stage" $false "newest release heading has no stage"
        } else {
            $changelogStage = $changelogStageMatch.Groups["stage"].Value.Trim()
            Add-CheckResult "CHANGELOG current stage" $true $changelogStage
            if ($null -ne $roadmapStage) {
                Test-ExpectedValue "CHANGELOG/roadmap stage mirror" $roadmapStage $changelogStage
            }
        }
    } else {
        Add-CheckResult "CHANGELOG newest entry" $false "no release heading found"
    }

    Add-CheckResult "README Agent Runtime mention" ([regex]::IsMatch([string]$readme, 'Agent (Workflow )?Runtime')) "README must retain an Agent Runtime reference"
    Add-CheckResult "AGENTS version source reference" ([regex]::IsMatch([string]$agents, 'package\.json') -and [regex]::IsMatch([string]$agents, 'src-tauri/Cargo\.toml')) "references package.json and src-tauri/Cargo.toml"
    Add-CheckResult "Copilot version/roadmap reference" ([regex]::IsMatch([string]$copilot, 'package\.json') -and [regex]::IsMatch([string]$copilot, 'docs/version-roadmap\.md')) "references package.json and docs/version-roadmap.md"

    Write-Host ""
    Write-Host "[check_docs] Stale current-state markers" -ForegroundColor Yellow
    Test-CurrentMarkersMatchVersion "AGENTS.md" $agents $currentVersion
    Test-CurrentMarkersMatchVersion "docs/version-roadmap.md" $roadmap $currentVersion
    Test-CurrentMarkersMatchVersion "docs/agent-workflow.md" $agentWorkflow $currentVersion
    Test-CurrentMarkersMatchVersion "docs/ai-agent-roadmap.md" $aiAgentRoadmap $currentVersion

    $forbiddenMarkers = @(
        @{ Label = "Agent workflow mode wording"; Content = $agentWorkflow; Pattern = '单 Agent 模式（当前）' },
        @{ Label = "AGENTS collaboration/version coupling"; Content = $agents; Pattern = '当前协作模式（v[0-9]+\.x）' },
        @{ Label = "Copilot obsolete product focus"; Content = $copilot; Pattern = '当前版本重点是作品管理首页、写作工作台和 AI 章节生成基础流程。' },
        @{ Label = "Development Skills obsolete runtime status"; Content = $developmentSkills; Pattern = 'v1\.0\.44 占位（v2\.x 实现）' },
        @{ Label = "AI roadmap obsolete starting point"; Content = $aiAgentRoadmap; Pattern = '当前：用户手动触发每次 AI 操作' }
    )

    foreach ($check in $forbiddenMarkers) {
        $isAbsent = -not [regex]::IsMatch([string]$check.Content, [string]$check.Pattern)
        Add-CheckResult ([string]$check.Label) $isAbsent $(if ($isAbsent) { "obsolete wording absent" } else { "obsolete wording found" })
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Document Sync Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$failedResults = @($Results | Where-Object { -not $_.Passed })
if ($failedResults.Count -eq 0) {
    Write-Host "  All $($Results.Count) checks passed." -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    exit 0
}

Write-Host "  $($failedResults.Count) of $($Results.Count) checks failed:" -ForegroundColor Red
foreach ($failure in $failedResults) {
    Write-Host "  - $($failure.Name): $($failure.Detail)" -ForegroundColor Red
}
Write-Host "========================================" -ForegroundColor Cyan
exit 1
