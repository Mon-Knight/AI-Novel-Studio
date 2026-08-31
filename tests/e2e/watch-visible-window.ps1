param(
  [Parameter(Mandatory = $true)]
  [string]$ApplicationPath,
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [Parameter(Mandatory = $true)]
  [string]$ReadyPath,
  [int]$TimeoutMs = 30000,
  [int]$PollIntervalMs = 15
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class StartupWindowProbe
{
    private delegate bool EnumWindowsProc(IntPtr window, IntPtr state);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(
        IntPtr window,
        int attribute,
        out int value,
        int valueSize
    );

    private static bool IsCloaked(IntPtr window)
    {
        const int DwmwaCloaked = 14;
        int cloaked;
        int result = DwmGetWindowAttribute(window, DwmwaCloaked, out cloaked, sizeof(int));
        return result == 0 && cloaked != 0;
    }

    public static bool HasVisibleTopLevelWindow(int targetProcessId)
    {
        bool found = false;
        EnumWindows((window, state) =>
        {
            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (
                processId == (uint)targetProcessId &&
                IsWindowVisible(window) &&
                !IsIconic(window) &&
                !IsCloaked(window)
            )
            {
                found = true;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@

function Convert-ToCanonicalPath([string]$Value) {
  $fullPath = [System.IO.Path]::GetFullPath($Value)
  if ($fullPath.StartsWith('\\?\')) {
    $fullPath = $fullPath.Substring(4)
  }
  return $fullPath.TrimEnd('\')
}

function Write-Result([hashtable]$Value) {
  $parent = Split-Path -Parent $OutputPath
  [System.IO.Directory]::CreateDirectory($parent) | Out-Null
  $temporary = "$OutputPath.tmp"
  $json = $Value | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText(
    $temporary,
    $json,
    [System.Text.UTF8Encoding]::new($false)
  )
  Move-Item -LiteralPath $temporary -Destination $OutputPath -Force
}

$watcherStartedEpochMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

try {
  if ($TimeoutMs -lt 1000 -or $PollIntervalMs -lt 5) {
    throw 'TimeoutMs must be at least 1000 and PollIntervalMs must be at least 5.'
  }

  $canonicalApplicationPath = Convert-ToCanonicalPath $ApplicationPath
  $processName = [System.IO.Path]::GetFileNameWithoutExtension($canonicalApplicationPath)
  [System.IO.File]::WriteAllText(
    $ReadyPath,
    'ready',
    [System.Text.UTF8Encoding]::new($false)
  )
  $targetProcess = $null

  while ($stopwatch.ElapsedMilliseconds -lt $TimeoutMs -and $null -eq $targetProcess) {
    foreach ($candidate in [System.Diagnostics.Process]::GetProcessesByName($processName)) {
      try {
        $candidatePath = Convert-ToCanonicalPath $candidate.MainModule.FileName
        if ([StringComparer]::OrdinalIgnoreCase.Equals($candidatePath, $canonicalApplicationPath)) {
          $targetProcess = $candidate
          break
        }
      }
      catch {
        $candidate.Dispose()
      }
    }
    if ($null -eq $targetProcess) {
      Start-Sleep -Milliseconds $PollIntervalMs
    }
  }

  if ($null -eq $targetProcess) {
    throw 'The staged Tauri process was not observed before the timeout.'
  }

  $processId = $targetProcess.Id
  $processCreatedEpochMs = ([DateTimeOffset]$targetProcess.StartTime).ToUniversalTime().ToUnixTimeMilliseconds()
  $processObservedEpochMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $windowVisibleEpochMs = $null

  while ($stopwatch.ElapsedMilliseconds -lt $TimeoutMs) {
    if ($targetProcess.HasExited) {
      throw 'The staged Tauri process exited before a visible window was observed.'
    }
    if ([StartupWindowProbe]::HasVisibleTopLevelWindow($processId)) {
      $windowVisibleEpochMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      break
    }
    Start-Sleep -Milliseconds $PollIntervalMs
  }

  if ($null -eq $windowVisibleEpochMs) {
    throw 'A visible top-level Tauri window was not observed before the timeout.'
  }

  Write-Result @{
    schemaVersion = 1
    processId = $processId
    watcherStartedEpochMs = $watcherStartedEpochMs
    processCreatedEpochMs = $processCreatedEpochMs
    processObservedEpochMs = $processObservedEpochMs
    windowVisibleEpochMs = $windowVisibleEpochMs
    processToWindowVisibleMs = $windowVisibleEpochMs - $processCreatedEpochMs
    pollIntervalMs = $PollIntervalMs
    timeoutMs = $TimeoutMs
  }
}
catch {
  Write-Result @{
    schemaVersion = 1
    watcherStartedEpochMs = $watcherStartedEpochMs
    pollIntervalMs = $PollIntervalMs
    timeoutMs = $TimeoutMs
    error = $_.Exception.Message
  }
  exit 1
}
