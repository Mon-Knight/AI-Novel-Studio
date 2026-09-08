import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { browser } from '@wdio/globals';
import { assertUnelevatedWindowsHost } from '../../scripts/e2e/host-integrity.ts';

/**
 * Shared WebdriverIO configuration for carriers that drive the *production* desktop
 * binary (no Cargo `e2e` feature, no network block). Two flavours exist:
 *
 * - real profile: the operator's own settings, DPAPI vault and database (see
 *   wdio.real-profile.conf.ts). Required when a credential only exists in the vault.
 * - isolated profile: `LOCALAPPDATA` / `APPDATA` / WebView2 folder redirected under a
 *   temporary root so the run touches nothing the operator owns (see
 *   wdio.fault-injection.conf.ts). Used with loopback fault-injection upstreams.
 *
 * Both are opt-in and never part of `test:all`.
 */

export interface ProductionCarrierOptions {
  /** Absolute spec paths. */
  specs: string[];
  /** Env var that must equal "1" before the carrier starts. */
  enableEnv: string;
  /** Env var overriding the application path. */
  appEnv: string;
  /** Env var holding the run id (defaulted at config load so workers inherit it). */
  runIdEnv: string;
  /** Env var holding the artifact directory (defaulted at config load). */
  artifactsEnv: string;
  /** Env var overriding the tauri-driver port. */
  driverPortEnv: string;
  defaultDriverPort: number;
  /** Sub-folder of test-results used for artifacts. */
  artifactFolder: string;
  /** Mocha timeout for one spec file. */
  specTimeoutMs: number;
  /**
   * Isolated profile: everything the desktop app persists is redirected below
   * `<artifactRoot>/profile`. The DSH runtime payload is reused read-only from
   * `dshRuntimeRootEnv` (or the operator's unpacked payload) to avoid a 1.4 GB unpack.
   */
  isolatedProfile?: {
    dshRuntimeRootEnv: string;
  };
  /** Env var that receives the tauri-driver pid so specs can locate the app process tree. */
  driverPidEnv?: string;
}

export function createProductionCarrierConfig(options: ProductionCarrierOptions) {
  const workspaceRoot = path.resolve(import.meta.dirname, '../..');
  const runId = (process.env[options.runIdEnv] ??= new Date().toISOString().replace(/[:.]/g, '-'));
  const artifactRoot = path.resolve(
    (process.env[options.artifactsEnv] ??= path.join(
      workspaceRoot,
      'test-results',
      options.artifactFolder,
      runId,
    )),
  );
  const appPath = path.resolve(
    process.env[options.appEnv] ??
      path.join(workspaceRoot, 'src-tauri', 'target', 'release', 'AI Novel Studio.exe'),
  );
  const driverPort = Number(
    process.env[options.driverPortEnv] ?? String(options.defaultDriverPort),
  );
  const localAppData =
    process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? '', 'AppData', 'Local');
  const profileRoot = path.join(artifactRoot, 'profile');
  // wry hands WebView2 `%LOCALAPPDATA%\<bundle identifier>` and WebView2 appends `EBWebView`
  // itself. The driver must receive the same parent folder, otherwise the driven instance
  // gets a nested, empty profile without the saved settings.
  const webviewDataDir = options.isolatedProfile
    ? path.join(profileRoot, 'webview2')
    : path.join(localAppData, 'com.ainovelstudio.app');

  let driver: ReturnType<typeof spawn> | undefined;
  let driverLog: fs.WriteStream | undefined;

  return {
    runner: 'local',
    specs: options.specs,
    exclude: [],
    maxInstances: 1,
    capabilities: [
      {
        browserName: 'wry',
        'tauri:options': {
          application: appPath,
          webviewOptions: { userDataFolder: webviewDataDir },
        },
        'wdio:enforceWebDriverClassic': true,
      },
    ],
    hostname: '127.0.0.1',
    port: driverPort,
    path: '/',
    logLevel: 'warn' as const,
    outputDir: artifactRoot,
    framework: 'mocha',
    reporters: [['spec', { stdout: true }]],
    mochaOpts: {
      timeout: options.specTimeoutMs,
      fullTrace: true,
    },
    waitforTimeout: 30_000,
    connectionRetryTimeout: 120_000,
    connectionRetryCount: 1,
    baseUrl: 'tauri://localhost',
    injectGlobals: true,

    async onPrepare() {
      if (process.env[options.enableEnv] !== '1') {
        throw new Error(`This carrier is opt-in: set ${options.enableEnv}=1 to run it.`);
      }
      if (process.env.AI_NOVEL_STUDIO_E2E !== undefined) {
        throw new Error(
          'Production carriers must not run inside the isolated E2E carrier (AI_NOVEL_STUDIO_E2E blocks network).',
        );
      }
      assertUnelevatedWindowsHost();
      if (!fs.existsSync(appPath)) {
        throw new Error(`Production application was not found: ${appPath}`);
      }
      if (!options.isolatedProfile && process.platform === 'win32' && isDesktopAppRunning()) {
        throw new Error(
          'The desktop app is already running. Close it first so the driver-launched instance owns the profile.',
        );
      }
      fs.mkdirSync(artifactRoot, { recursive: true });

      const env = environmentWithoutIsolatedE2e();
      if (options.isolatedProfile) {
        const isolatedLocalAppData = path.join(profileRoot, 'LocalAppData');
        const isolatedAppData = path.join(profileRoot, 'AppData');
        fs.mkdirSync(isolatedLocalAppData, { recursive: true });
        fs.mkdirSync(isolatedAppData, { recursive: true });
        fs.mkdirSync(webviewDataDir, { recursive: true });
        env.LOCALAPPDATA = isolatedLocalAppData;
        env.APPDATA = isolatedAppData;
        const runtimeRoot =
          process.env[options.isolatedProfile.dshRuntimeRootEnv]?.trim() ||
          path.join(localAppData, 'AI Novel Studio', 'dsh-runtime');
        if (fs.existsSync(runtimeRoot)) {
          env.DSH_RUNTIME_ROOT = runtimeRoot;
        }
      }

      const driverArgs = ['--port', String(driverPort), '--native-port', String(driverPort + 1000)];
      const nativeDriver = resolveNativeDriver(workspaceRoot);
      if (nativeDriver) driverArgs.push('--native-driver', nativeDriver);
      driverLog = fs.createWriteStream(path.join(artifactRoot, 'tauri-driver.log'), { flags: 'w' });
      driver = spawn(resolveTauriDriver(workspaceRoot), driverArgs, {
        cwd: workspaceRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      if (options.driverPidEnv && driver.pid) {
        process.env[options.driverPidEnv] = String(driver.pid);
      }
      driver.stdout?.pipe(driverLog, { end: false });
      driver.stderr?.pipe(driverLog, { end: false });
      let startFailure: Error | undefined;
      driver.once('error', (error) => {
        startFailure = error;
      });
      driver.once('exit', (code, signal) => {
        startFailure ??= new Error(
          `tauri-driver exited before becoming ready (code ${String(code)}, signal ${String(signal)})`,
        );
      });
      try {
        await waitForDriver(driverPort, () => startFailure);
      } catch (error) {
        await stopDriver();
        throw error;
      }
    },

    async before() {
      await browser.setTimeout({ script: 90_000 });
      await browser.$('[data-testid="app-shell"]').waitForDisplayed({ timeout: 90_000 });
    },

    async onComplete() {
      await stopDriver();
      const currentLog = driverLog;
      driverLog = undefined;
      if (currentLog && !currentLog.closed) {
        await new Promise<void>((resolve) => currentLog.end(resolve));
      }
    },
  };

  async function stopDriver(): Promise<void> {
    const current = driver;
    driver = undefined;
    if (!current || current.exitCode !== null || current.signalCode !== null) return;
    if (process.platform === 'win32' && current.pid) {
      await new Promise<void>((resolve) => {
        execFile(
          'taskkill.exe',
          ['/PID', String(current.pid), '/T', '/F'],
          { windowsHide: true },
          () => resolve(),
        );
      });
    } else {
      try {
        current.kill('SIGTERM');
      } catch {
        /* already exited */
      }
    }
    if (current.exitCode !== null || current.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      current.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

function environmentWithoutIsolatedE2e(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('AI_NOVEL_STUDIO_E2E')) continue;
    env[key] = value;
  }
  return env;
}

function isDesktopAppRunning(): boolean {
  const output = execFileSync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return /"(?:AI Novel Studio|ai-novel-studio)\.exe"/iu.test(output);
}

function resolveTauriDriver(workspaceRoot: string): string {
  const override = process.env.AI_NOVEL_STUDIO_E2E_DRIVER?.trim();
  if (override) return override;
  const bundled = path.join(
    workspaceRoot,
    '.e2e-tools',
    'tauri-driver',
    'bin',
    process.platform === 'win32' ? 'tauri-driver.exe' : 'tauri-driver',
  );
  if (fs.existsSync(bundled)) return bundled;
  return process.platform === 'win32' ? 'tauri-driver.exe' : 'tauri-driver';
}

function resolveNativeDriver(workspaceRoot: string): string | undefined {
  const override = process.env.AI_NOVEL_STUDIO_E2E_NATIVE_DRIVER?.trim();
  if (override) return override;
  if (process.platform !== 'win32') return undefined;
  const toolsRoot = path.join(workspaceRoot, '.e2e-tools');
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(toolsRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('edgedriver-'))
    .map((entry) => path.join(toolsRoot, entry.name, 'msedgedriver.exe'))
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => ({ candidate, modifiedAt: fs.statSync(candidate).mtimeMs }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  return candidates[0]?.candidate;
}

async function waitForDriver(
  port: number,
  getStartFailure: () => Error | undefined,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const failure = getStartFailure();
    if (failure) throw failure;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `tauri-driver did not become ready on port ${port}: ${String(lastError ?? 'timeout')}`,
  );
}
