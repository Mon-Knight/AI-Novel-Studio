# Development preflight is read-only. Verification uses the shared change selector.
[CmdletBinding()]
param(
    [ValidateSet('Prepare', 'Verify')]
    [string]$Phase = 'Prepare',
    [string]$Base,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$code = 0
Push-Location $projectRoot
try {
    if ($Phase -eq 'Prepare') {
        Write-Host "Development preflight: $projectRoot"
        & git status --short --branch
        if ($LASTEXITCODE -ne 0) { throw 'Unable to read Git status.' }
        foreach ($file in @('AGENTS.md', 'package.json', 'docs/development-rules.md')) {
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing $file" }
        }
        $package = Get-Content -LiteralPath package.json -Raw -Encoding UTF8 | ConvertFrom-Json
        Write-Host "Version: $($package.version); Node requirement: $($package.engines.node)"
        Write-Host 'Preserve existing edits. Read task-relevant documents; no tests were run.'
        Write-Host 'After implementation and documentation updates: npm run verify:change'
    } else {
        $arguments = @('scripts/quality/verify-change.mjs')
        if ($Base) { $arguments += @('--base', $Base) }
        if ($DryRun) { $arguments += '--dry-run' }
        & node @arguments
        $code = $LASTEXITCODE
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    $code = 1
} finally {
    Pop-Location
}
exit $code
