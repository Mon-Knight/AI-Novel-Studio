import { execFileSync } from 'node:child_process';

// WebView2 Runtime 150+ intentionally drops WEBVIEW2_* environment overrides (and HKCU
// policies) when the host process runs at High integrity. msedgedriver relies on that
// override to enable remote debugging, so an elevated terminal cannot create sessions.
const ELEVATED_INTEGRITY_SIDS = ['S-1-16-12288', 'S-1-16-16384'];

export const ALLOW_ELEVATED_ENV = 'AI_NOVEL_STUDIO_E2E_ALLOW_ELEVATED';

export function isElevatedWindowsToken(whoamiGroupsOutput: string): boolean {
  return ELEVATED_INTEGRITY_SIDS.some((sid) =>
    new RegExp(`(?<![\\w-])${sid}(?![\\w-])`, 'u').test(whoamiGroupsOutput),
  );
}

export function readWindowsTokenGroups(): string {
  return execFileSync('whoami.exe', ['/groups', '/fo', 'csv'], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

export function assertUnelevatedWindowsHost(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  readGroups: () => string = readWindowsTokenGroups,
): void {
  if (platform !== 'win32' || env[ALLOW_ELEVATED_ENV] === '1') return;
  let groups: string;
  try {
    groups = readGroups();
  } catch (error) {
    throw new Error(
      `Could not determine the Windows integrity level of this terminal: ${String(error)}`,
    );
  }
  if (!isElevatedWindowsToken(groups)) return;
  throw new Error(
    'Desktop E2E must start from a non-elevated (medium integrity) terminal. ' +
      'WebView2 Runtime 150+ drops WEBVIEW2_* environment overrides from an elevated host, so ' +
      'msedgedriver cannot enable remote debugging and every spec would time out while creating ' +
      `its WebDriver session. Re-run from a normal user terminal, or set ${ALLOW_ELEVATED_ENV}=1 ` +
      'only if this host has been configured to allow elevated automation.',
  );
}
