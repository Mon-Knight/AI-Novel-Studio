[CmdletBinding()]
param(
  [string]$ApiKey = $env:DSH_E2E_API_KEY,
  [string]$CredentialFile = (Join-Path $env:USERPROFILE '.dsh\.credentials.yaml'),
  [string]$CredentialName = 'DEEPSEEK_API_KEY',
  [string]$RuntimeRoot = $env:DSH_RUNTIME_ROOT,
  [string]$GatewayBin = $env:DSH_GATEWAY_BIN,
  [string]$BaseUrl = $env:DSH_E2E_BASE_URL,
  [string]$Model = $env:DSH_E2E_MODEL
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$tauriRoot = Join-Path $repoRoot 'src-tauri'
$apiKeyWasExplicitlySupplied = $PSBoundParameters.ContainsKey('ApiKey')

function Resolve-RequiredFile([string]$PathValue, [string]$Label) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    throw "$Label is required"
  }
  $resolved = Resolve-Path -LiteralPath $PathValue -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $resolved.Path -PathType Leaf)) {
    throw "$Label must be a file: $PathValue"
  }
  return $resolved.Path
}

function Resolve-RequiredDirectory([string]$PathValue, [string]$Label) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    throw "$Label is required"
  }
  $resolved = Resolve-Path -LiteralPath $PathValue -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $resolved.Path -PathType Container)) {
    throw "$Label must be a directory: $PathValue"
  }
  return $resolved.Path
}

function Read-Credential([string]$PathValue, [string]$Name) {
  $resolved = Resolve-RequiredFile $PathValue 'CredentialFile'
  $raw = Get-Content -LiteralPath $resolved -Raw
  $escapedName = [regex]::Escape($Name)
  $match = [regex]::Match($raw, "(?m)^\s*$escapedName\s*:\s*(.+?)\s*$")
  if (-not $match.Success) {
    throw "CredentialFile does not contain $Name"
  }
  $value = $match.Groups[1].Value.Trim().Trim('"').Trim("'")
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$Name is empty"
  }
  return $value
}

function Is-ExplicitBaseUrl([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
  $uri = [Uri]$Value
  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -notin @('http', 'https')) {
    throw 'BaseUrl must be an absolute http(s) URL'
  }
  if (-not [string]::IsNullOrWhiteSpace($uri.UserInfo) -or
    -not [string]::IsNullOrWhiteSpace($uri.Query) -or
    -not [string]::IsNullOrWhiteSpace($uri.Fragment)) {
    throw 'BaseUrl must not contain userinfo, query, or fragment credentials'
  }
  return $true
}

function Is-LoopbackBaseUrl([string]$Value) {
  $uri = [Uri]$Value
  $hostName = $uri.DnsSafeHost.ToLowerInvariant()
  if ($hostName -eq 'localhost') { return $true }

  $address = $null
  if (-not [System.Net.IPAddress]::TryParse($hostName, [ref]$address)) {
    return $false
  }
  if ($address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
    $bytes = $address.GetAddressBytes()
    return $bytes.Length -eq 4 -and $bytes[0] -eq 127
  }
  return $address.Equals([System.Net.IPAddress]::IPv6Loopback)
}

$oldEnvironment = @{}
foreach ($name in @(
    'DSH_E2E_API_KEY',
    'DSH_RUNTIME_ROOT',
    'DSH_GATEWAY_BIN',
  'DSH_E2E_BASE_URL',
  'DSH_E2E_MODEL'
  )) {
  $existing = Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue
  $oldEnvironment[$name] = if ($null -eq $existing) { $null } else { $existing.Value }
}

try {
  if ([string]::IsNullOrWhiteSpace($Model)) { $Model = 'deepseek-v4-flash' }
  $Model = $Model.Trim()
  if ($Model.Length -gt 200 -or $Model -match '[\r\n]') {
    throw 'Model must be a single-line identifier of at most 200 characters'
  }

  $usingLocalUpstream = $false
  if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
    $BaseUrl = $null
  } else {
    Is-ExplicitBaseUrl $BaseUrl | Out-Null
    if (-not (Is-LoopbackBaseUrl $BaseUrl)) {
      throw 'BaseUrl override is restricted to a loopback host for the local-model test profile'
    }
    $usingLocalUpstream = $true
  }

  if ($usingLocalUpstream -and -not $apiKeyWasExplicitlySupplied) {
    # A loopback model normally does not need a cloud credential. Ignore any
    # inherited DSH_E2E_API_KEY and use a harmless sentinel unless the caller
    # explicitly supplies a local key with -ApiKey.
    $ApiKey = 'local-no-key-required'
  } elseif ([string]::IsNullOrWhiteSpace($ApiKey)) {
    if ($usingLocalUpstream) {
      throw 'ApiKey is empty; pass -ApiKey only when the loopback model requires a key'
    }
    $ApiKey = Read-Credential $CredentialFile $CredentialName
  }
  if ([string]::IsNullOrWhiteSpace($ApiKey)) { throw 'ApiKey is empty' }

  if ([string]::IsNullOrWhiteSpace($RuntimeRoot)) {
    $RuntimeRoot = Join-Path $tauriRoot '.payload-staging\dsh-runtime'
  }
  if ([string]::IsNullOrWhiteSpace($GatewayBin)) {
    $GatewayBin = Join-Path $tauriRoot 'target\debug\novel-domain-gateway.exe'
  }
  $RuntimeRoot = Resolve-RequiredDirectory $RuntimeRoot 'RuntimeRoot'
  $GatewayBin = Resolve-RequiredFile $GatewayBin 'GatewayBin'
  if (-not (Test-Path -LiteralPath (Join-Path $RuntimeRoot 'packages\examples\jsonrpc-demo\lib\bin.js') -PathType Leaf)) {
    throw 'RuntimeRoot is not a complete DSH payload'
  }
  $env:DSH_E2E_API_KEY = $ApiKey
  $env:DSH_RUNTIME_ROOT = $RuntimeRoot
  $env:DSH_GATEWAY_BIN = $GatewayBin
  $env:DSH_E2E_MODEL = $Model
  if ($null -ne $BaseUrl) { $env:DSH_E2E_BASE_URL = $BaseUrl }
  else { Remove-Item Env:DSH_E2E_BASE_URL -ErrorAction SilentlyContinue }

  $stdoutPath = [IO.Path]::GetTempFileName()
  $stderrPath = [IO.Path]::GetTempFileName()
  Push-Location $tauriRoot
  try {
    # Cargo writes compiler diagnostics to stderr even on a successful run.
    # Start-Process owns both native streams, avoiding PowerShell 5's
    # NativeCommandError wrapper and preserving the real exit code.
    $cargoProcess = Start-Process -FilePath 'cargo.exe' `
      -ArgumentList @('test', '--locked', 'e2e_prepare_via_local_proxy', '--', '--ignored', '--nocapture') `
      -WorkingDirectory $tauriRoot `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath `
      -Wait `
      -PassThru `
      -WindowStyle Hidden
    $exitCode = $cargoProcess.ExitCode
    # Read cargo's UTF-8 diagnostics explicitly; Windows PowerShell 5 uses
    # the active ANSI code page for Get-Content by default.
    $stdout = if (Test-Path -LiteralPath $stdoutPath) {
      [IO.File]::ReadAllText($stdoutPath, [Text.Encoding]::UTF8)
    } else { '' }
    $stderr = if (Test-Path -LiteralPath $stderrPath) {
      [IO.File]::ReadAllText($stderrPath, [Text.Encoding]::UTF8)
    } else { '' }
    $output = ($stdout + [Environment]::NewLine + $stderr)
  } finally {
    Pop-Location
  }

  # Never echo the credential, even if an upstream error accidentally includes it.
  $safeOutput = $output.Replace($ApiKey, '[redacted]')
  # PowerShell 5 formats native stderr as an ErrorRecord even when cargo
  # succeeds. Keep the compiler/test text, but remove the wrapper noise.
  $safeOutput = ($safeOutput -split "`r?`n" |
    Where-Object {
      $_ -notmatch '^cargo\.exe\s*:' -and
      $_ -notmatch '^At .*run-real-model-smoke\.ps1:' -and
      $_ -notmatch '^\s*CategoryInfo\s*:' -and
      $_ -notmatch '^\s*FullyQualifiedErrorId\s*:'
  }) -join [Environment]::NewLine
  if ($exitCode -ne 0) {
    # Write-Error is itself wrapped as an ErrorRecord by Windows PowerShell 5
    # and obscures the cargo failure with a second stack-like diagnostic. Emit
    # plain stderr and preserve cargo's exit code for CI callers.
    [Console]::Error.WriteLine($safeOutput.Trim())
    exit $exitCode
  }
  $baseLabel = if ([string]::IsNullOrWhiteSpace($BaseUrl)) { 'configured DeepSeek upstream' } else { $BaseUrl }
  Write-Output ('DSH real-model smoke passed: model=' + $Model + '; baseUrl=' + $baseLabel)
  Write-Output ($safeOutput.Trim())
} finally {
  foreach ($temporaryPath in @($stdoutPath, $stderrPath)) {
    if (-not [string]::IsNullOrWhiteSpace($temporaryPath)) {
      Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
  }
  foreach ($name in $oldEnvironment.Keys) {
    $previous = $oldEnvironment[$name]
    if ($null -eq $previous) { Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue }
    else { Set-Item -Path "Env:$name" -Value $previous }
  }
}
