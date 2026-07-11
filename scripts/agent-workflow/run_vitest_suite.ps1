param(
    [Parameter(Mandatory = $true)]
    [string]$TestPath
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$resolvedTestPath = Join-Path $repoRoot $TestPath
$vitest = Join-Path $repoRoot 'node_modules\.bin\vitest.cmd'
$config = Join-Path $repoRoot 'vitest.config.ts'

if (-not (Test-Path -LiteralPath $vitest)) {
    Write-Error 'Vitest is not installed. Run npm install before executing this suite.'
    exit 2
}

if (-not (Test-Path -LiteralPath $resolvedTestPath)) {
    Write-Error "Test path does not exist: $TestPath"
    exit 3
}

$testCount = @(
    Get-ChildItem -LiteralPath $resolvedTestPath -Recurse -File |
        Where-Object { $_.Name -match '\.test\.(ts|tsx)$' }
).Count

if ($testCount -eq 0) {
    Write-Error "No Vitest test files found under: $TestPath"
    exit 4
}

& $vitest run --config $config $resolvedTestPath
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
    Write-Error "Vitest suite failed with exit code $exitCode"
}
exit $exitCode
