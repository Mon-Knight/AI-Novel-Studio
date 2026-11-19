import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { browser, expect } from '@wdio/globals';
import { bridgeDiagnostics, waitForTestId } from './helpers';

const execFileAsync = promisify(execFile);

const CLOSE_NATIVE_DIALOG_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class NativeDialogProbe {
  private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

  [DllImport("user32.dll")]
  private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetClassName(IntPtr hwnd, StringBuilder className, int maxCount);

  [DllImport("user32.dll")]
  private static extern bool IsWindowVisible(IntPtr hwnd);

  [DllImport("user32.dll")]
  private static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

  public static int CloseDialogs(int targetProcessId) {
    int closed = 0;
    EnumWindows((hwnd, _) => {
      uint owner;
      GetWindowThreadProcessId(hwnd, out owner);
      if (owner != targetProcessId || !IsWindowVisible(hwnd)) return true;
      var className = new StringBuilder(64);
      GetClassName(hwnd, className, className.Capacity);
      if (className.ToString() == "#32770") {
        if (PostMessage(hwnd, 0x0010, IntPtr.Zero, IntPtr.Zero)) closed += 1;
      }
      return true;
    }, IntPtr.Zero);
    return closed;
  }
}
'@
[NativeDialogProbe]::CloseDialogs([int]$env:ANS_NATIVE_DIALOG_PID)
`;

interface NativeDialogResult {
  settled: boolean;
  value?: string | string[] | null;
  error?: string;
}

async function closeNativeDialogs(processId: number): Promise<number> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      CLOSE_NATIVE_DIALOG_SCRIPT,
    ],
    {
      windowsHide: true,
      timeout: 15000,
      env: { ...process.env, ANS_NATIVE_DIALOG_PID: String(processId) },
    },
  );
  return Number(stdout.trim()) || 0;
}

async function runNativeDialogProbe(
  command: 'plugin:dialog|open' | 'plugin:dialog|save',
  processId: number,
): Promise<NativeDialogResult> {
  await browser.execute((dialogCommand) => {
    const target = window as unknown as {
      __TAURI_INTERNALS__?: { invoke: (name: string, args?: unknown) => Promise<unknown> };
      __nativeDialogProbe?: NativeDialogResult;
    };
    const internals = target.__TAURI_INTERNALS__;
    if (!internals) throw new Error('Tauri IPC internals are unavailable');
    target.__nativeDialogProbe = { settled: false };
    void internals
      .invoke(dialogCommand, {
        options: {
          multiple: false,
          directory: false,
          title: 'AI Novel Studio native dialog E2E probe',
        },
      })
      .then((value) => {
        target.__nativeDialogProbe = {
          settled: true,
          value: value as string | string[] | null,
        };
      })
      .catch((error: unknown) => {
        target.__nativeDialogProbe = { settled: true, error: String(error) };
      });
  }, command);

  let closed = 0;
  await browser.waitUntil(
    async () => {
      closed += await closeNativeDialogs(processId);
      return closed > 0;
    },
    {
      timeout: 20000,
      interval: 250,
      timeoutMsg: `The native ${command} dialog did not appear`,
    },
  );

  await browser.waitUntil(
    async () =>
      (await browser.execute(
        () =>
          (window as unknown as { __nativeDialogProbe?: NativeDialogResult }).__nativeDialogProbe
            ?.settled === true,
      )) === true,
    {
      timeout: 20000,
      timeoutMsg: `The native ${command} dialog did not settle after WM_CLOSE`,
    },
  );

  const result = await browser.execute(
    () => (window as unknown as { __nativeDialogProbe?: NativeDialogResult }).__nativeDialogProbe,
  );
  if (!result) throw new Error('The native dialog probe result is unavailable');
  return result;
}

describe('Tauri 2 native plugin desktop contract', () => {
  it('opens and cancels a real Windows file-open dialog through the scoped dialog plugin', async () => {
    await waitForTestId('app-shell');
    const diagnostics = await bridgeDiagnostics();
    const processId = diagnostics.processId;
    if (!processId) throw new Error('E2E diagnostics did not expose the desktop process id');

    const result = await runNativeDialogProbe('plugin:dialog|open', processId);
    expect(result.error).toBeUndefined();
    expect(result.value).toBeNull();
  });

  it('opens and cancels a real Windows file-save dialog through the scoped dialog plugin', async () => {
    const diagnostics = await bridgeDiagnostics();
    const processId = diagnostics.processId;
    if (!processId) throw new Error('E2E diagnostics did not expose the desktop process id');

    const result = await runNativeDialogProbe('plugin:dialog|save', processId);
    expect(result.error).toBeUndefined();
    expect(result.value).toBeNull();
  });

  it('rejects a frontend FS read outside the declared sidecar scope', async () => {
    const diagnostics = await bridgeDiagnostics();
    if (!diagnostics.dataDir) throw new Error('E2E diagnostics did not expose the data directory');
    const outsideScope = path.join(diagnostics.dataDir, 'frontend-scope-denied.txt');
    fs.writeFileSync(outsideScope, 'desktop-e2e-scope-secret', 'utf8');

    let rejection = '';
    try {
      await browser.executeAsync((targetPath, done) => {
        const internals = (
          window as unknown as {
            __TAURI_INTERNALS__?: { invoke: (name: string, args?: unknown) => Promise<unknown> };
          }
        ).__TAURI_INTERNALS__;
        if (!internals) return done({ ok: false, error: 'Tauri IPC internals are unavailable' });
        void internals
          .invoke('plugin:fs|read_text_file', { path: targetPath })
          .then((value) => done({ ok: true, value }))
          .catch((error: unknown) => done({ ok: false, error: String(error) }));
      }, outsideScope);
    } catch (error) {
      // The plugin rejects before JavaScript can consume the IPC error, which
      // is itself the desktop ACL evidence this test is asserting.
      rejection = String(error);
    }

    expect(rejection).toMatch(/forbidden path|not allowed|scope|denied/iu);
  });

  it('submits a Windows toast through the notification plugin and does not fall back silently', async () => {
    const response = await browser.executeAsync((done) => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__?: { invoke: (name: string, args?: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      if (!internals) return done({ ok: false, error: 'Tauri IPC internals are unavailable' });

      void (async () => {
        const initiallyGranted = await internals.invoke(
          'plugin:notification|is_permission_granted',
        );
        let permission = initiallyGranted;
        if (permission !== true) {
          permission = await internals.invoke('plugin:notification|request_permission');
        }
        if (permission !== true && permission !== 'granted') {
          throw new Error(`notification permission is ${String(permission)}`);
        }
        await internals.invoke('plugin:notification|notify', {
          options: {
            title: 'AI Novel Studio desktop E2E',
            body: 'Native notification capability verified',
          },
        });
        done({ ok: true, permission });
      })().catch((error: unknown) => done({ ok: false, error: String(error) }));
    });

    const result = response as { ok: boolean; error?: string; permission?: unknown };
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.permission).toBe(true);
  });
});
