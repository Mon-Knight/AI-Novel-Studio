import path from 'node:path';
import fs from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { browser } from '@wdio/globals';
import type { Frameworks } from '@wdio/types';
import { sanitizeArtifactDirectory, sanitizeSecrets } from '../../scripts/e2e/artifact-sanitizer.ts';
import { bridgeDiagnostics } from './helpers';

const workspaceRoot = path.resolve(import.meta.dirname, '../..');
const appPath = path.resolve(
  process.env.AI_NOVEL_STUDIO_E2E_APP
    ?? path.join(workspaceRoot, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'ai-novel-studio.exe' : 'ai-novel-studio'),
);
const artifactRoot = path.resolve(
  process.env.AI_NOVEL_STUDIO_E2E_ARTIFACTS ?? path.join(workspaceRoot, 'test-results', 'e2e'),
);
const driverPort = Number(process.env.AI_NOVEL_STUDIO_E2E_DRIVER_PORT ?? '4444');
const e2eDataDir = process.env.AI_NOVEL_STUDIO_E2E_DATA_DIR;

if (!fs.existsSync(appPath)) {
  throw new Error(`E2E application was not found: ${appPath}`);
}

fs.mkdirSync(artifactRoot, { recursive: true });

let driver: ReturnType<typeof spawn> | undefined;
let driverLog: fs.WriteStream | undefined;

function normalizeDiagnosticPath(value: string): string {
  let normalized = fs.realpathSync.native(value);
  if (process.platform === 'win32') {
    normalized = normalized
      .replace(/^\\\\\?\\UNC\\/i, '\\\\')
      .replace(/^\\\\\?\\/, '')
      .replace(/\//g, '\\')
      .toLowerCase();
  }
  return path.normalize(normalized);
}

function driverCommand(): string {
  if (process.env.AI_NOVEL_STUDIO_E2E_DRIVER) return process.env.AI_NOVEL_STUDIO_E2E_DRIVER;
  return process.platform === 'win32' ? 'tauri-driver.exe' : 'tauri-driver';
}

export const config = {
  runner: 'local',
  specs: [path.resolve(import.meta.dirname, '*.spec.ts')],
  exclude: [path.resolve(import.meta.dirname, 'helpers.ts')],
  maxInstances: 1,
  capabilities: [{
    browserName: 'wry',
    'tauri:options': {
      application: appPath,
      // Keep EdgeDriver's DevToolsActivePort lookup in the same isolated
      // WebView2 directory that the Rust runtime configures at startup.
      webviewOptions: e2eDataDir ? { userDataFolder: path.join(e2eDataDir, 'webview2') } : {},
    },
    'wdio:enforceWebDriverClassic': true,
  }],
  hostname: process.env.AI_NOVEL_STUDIO_E2E_DRIVER_HOST ?? '127.0.0.1',
  port: driverPort,
  path: '/',
  logLevel: process.env.AI_NOVEL_STUDIO_E2E_LOG_LEVEL ?? 'warn',
  outputDir: artifactRoot,
  framework: 'mocha',
  reporters: [['spec', { stdout: true }]],
  mochaOpts: {
    timeout: Number(process.env.AI_NOVEL_STUDIO_E2E_TIMEOUT ?? '120000'),
    fullTrace: true,
  },
  waitforTimeout: Number(process.env.AI_NOVEL_STUDIO_E2E_WAIT ?? '15000'),
  connectionRetryTimeout: 120000,
  connectionRetryCount: 2,
  baseUrl: 'tauri://localhost',
  injectGlobals: true,

  async onPrepare() {
    if (process.env.AI_NOVEL_STUDIO_E2E !== '1') {
      throw new Error('Desktop E2E requires AI_NOVEL_STUDIO_E2E=1. Use scripts/e2e/run-e2e.ts.');
    }
    if (!process.env.AI_NOVEL_STUDIO_E2E_DATA_DIR) {
      throw new Error('Desktop E2E requires a unique AI_NOVEL_STUDIO_E2E_DATA_DIR.');
    }
    fs.mkdirSync(process.env.AI_NOVEL_STUDIO_E2E_DATA_DIR, { recursive: true });
    const logPath = path.join(artifactRoot, 'tauri-driver.log');
    driverLog = fs.createWriteStream(logPath, { flags: 'w' });
    const driverArgs = ['--port', String(driverPort), '--native-port', String(driverPort + 1000)];
    if (process.env.AI_NOVEL_STUDIO_E2E_NATIVE_DRIVER) {
      driverArgs.push('--native-driver', process.env.AI_NOVEL_STUDIO_E2E_NATIVE_DRIVER);
    }
    driver = spawn(driverCommand(), driverArgs, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        AI_NOVEL_STUDIO_E2E: '1',
        AI_NOVEL_STUDIO_E2E_DATA_DIR: process.env.AI_NOVEL_STUDIO_E2E_DATA_DIR,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    driver.stdout?.pipe(driverLog, { end: false });
    driver.stderr?.pipe(driverLog, { end: false });
    try {
      const currentDriver = driver;
      let driverStartFailure: Error | undefined;
      currentDriver.once('error', (error) => {
        driverStartFailure = error;
      });
      currentDriver.once('exit', (code, signal) => {
        driverStartFailure = new Error(
          `tauri-driver exited before becoming ready (code ${String(code)}, signal ${String(signal)})`,
        );
      });
      await waitForDriver(driverPort, () => driverStartFailure);
    } catch (error) {
      await stopDriver();
      await closeDriverLog();
      throw error;
    }
  },

  async before() {
    await waitForTestIdFromBrowser('app-shell');
    const diagnostics = await bridgeDiagnostics();
    if (!e2eDataDir) throw new Error('The active spec does not have an isolated E2E data directory');

    const expectedDataDir = normalizeDiagnosticPath(path.resolve(e2eDataDir));
    const expectedDatabasePath = normalizeDiagnosticPath(path.join(e2eDataDir, 'ai-novel-studio.db'));
    const actualDataDir = diagnostics.dataDir ? normalizeDiagnosticPath(diagnostics.dataDir) : '';
    const actualDatabasePath = diagnostics.databasePath ? normalizeDiagnosticPath(diagnostics.databasePath) : '';
    if (actualDataDir !== expectedDataDir) {
      throw new Error(`E2E data directory mismatch: expected ${expectedDataDir}, received ${actualDataDir || '<empty>'}`);
    }
    if (actualDatabasePath !== expectedDatabasePath) {
      throw new Error(`E2E database path mismatch: expected ${expectedDatabasePath}, received ${actualDatabasePath || '<empty>'}`);
    }
    if (diagnostics.enabled !== true) throw new Error('E2E diagnostics reported enabled=false');
    if (diagnostics.schemaReady !== true) throw new Error('E2E database schema is not ready');
    if (diagnostics.integrityCheck !== 'ok') {
      throw new Error(`E2E database integrity check failed: ${diagnostics.integrityCheck ?? '<empty>'}`);
    }
    if (diagnostics.networkBlocked !== true) throw new Error('E2E network blocking is not enabled');
    if (diagnostics.webviewNetwork?.installed !== true) throw new Error('E2E WebView network guard is not installed');
    if (diagnostics.webviewNetwork.total !== 0) throw new Error('E2E WebView made a network request during startup');
  },

  async beforeSession() {
    if (process.env.AI_NOVEL_STUDIO_E2E_DATA_DIR) {
      fs.mkdirSync(process.env.AI_NOVEL_STUDIO_E2E_DATA_DIR, { recursive: true });
    }
  },

  async beforeCommand(command: string) {
    if (command === 'newSession' && process.env.AI_NOVEL_STUDIO_E2E_DATA_DIR) {
      fs.mkdirSync(process.env.AI_NOVEL_STUDIO_E2E_DATA_DIR, { recursive: true });
    }
  },

  async afterTest(test: Frameworks.Test, _context: unknown, result: Frameworks.TestResult) {
    let diagnostics: unknown;
    let healthError: Error | undefined;
    try {
      diagnostics = await getBrowserDiagnostics(7500);
      fs.writeFileSync(
        path.join(artifactRoot, 'frontend-diagnostics.json'),
        JSON.stringify(sanitizeSecrets(diagnostics), null, 2),
        'utf8',
      );
      healthError = browserHealthError(diagnostics);
    } catch (error) {
      healthError = error instanceof Error ? error : new Error(String(error));
    }

    if (!result.passed || healthError) {
      const safeName = sanitizeName(`${test.parent}-${test.title}`);
      const screenshotPath = path.join(artifactRoot, `${safeName}.png`);
      const sourcePath = path.join(artifactRoot, `${safeName}.html`);
      try { await browser.saveScreenshot(screenshotPath); } catch { /* best effort */ }
      try { fs.writeFileSync(sourcePath, sanitizeSecrets(await browser.getPageSource()), 'utf8'); } catch { /* best effort */ }
      if (diagnostics !== undefined) {
        fs.writeFileSync(path.join(artifactRoot, `${safeName}.json`), JSON.stringify(sanitizeSecrets(diagnostics), null, 2), 'utf8');
      }
    }

  },

  async onComplete() {
    await stopDriver();
    await closeDriverLog();
    const issues = await sanitizeArtifactDirectory(artifactRoot);
    if (issues.length > 0) {
      throw new Error(`E2E artifact sanitization failed: ${issues.join('; ')}`);
    }
  },
};

async function waitForDriver(port: number, getStartFailure: () => Error | undefined): Promise<void> {
  const deadline = Date.now() + 30000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const startFailure = getStartFailure();
    if (startFailure) throw startFailure;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const startFailure = getStartFailure();
  if (startFailure) throw startFailure;
  throw new Error(`tauri-driver did not become ready on port ${port}: ${String(lastError ?? 'timeout')}`);
}

async function waitForTestIdFromBrowser(testId: string): Promise<void> {
  const element = await browser.$(`[data-testid="${testId}"]`);
  await element.waitForDisplayed({ timeout: 30000 });
}

function sanitizeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'e2e-failure';
}

async function getBrowserDiagnostics(timeoutMs: number): Promise<unknown> {
  return browser.executeAsync((limit, done: (value: unknown) => void) => {
    const bridge = (window as unknown as { __AI_NOVEL_STUDIO_E2E__?: { getDiagnostics?: () => unknown; getConsoleLogs?: () => unknown; getUnhandledErrors?: () => unknown; getNetworkAttempts?: () => unknown } }).__AI_NOVEL_STUDIO_E2E__;
    if (!bridge) return done({ error: 'E2E bridge is unavailable' });

    const collect = (label: string, operation: () => unknown): Promise<unknown> => new Promise((resolve) => {
      let settled = false;
      const finish = (value: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      };
      const timer = window.setTimeout(() => finish({ error: `${label} timed out after ${limit}ms` }), limit);
      Promise.resolve()
        .then(operation)
        .then(finish)
        .catch((error) => finish({ error: String(error) }));
    });

    Promise.all([
      collect('backend diagnostics', () => bridge.getDiagnostics?.()),
      collect('console logs', () => bridge.getConsoleLogs?.()),
      collect('unhandled errors', () => bridge.getUnhandledErrors?.()),
      collect('network attempts', () => bridge.getNetworkAttempts?.()),
    ]).then(([diagnostics, logs, errors, networkAttempts]) => done({
      route: window.location.href,
      domSummary: {
        title: document.title,
        elementCount: document.getElementsByTagName('*').length,
        bodyTextLength: document.body?.innerText.length ?? 0,
        testIds: [...new Set([...document.querySelectorAll<HTMLElement>('[data-testid]')]
          .map((element) => element.dataset.testid)
          .filter((testId): testId is string => Boolean(testId)))],
      },
      diagnostics,
      logs,
      errors,
      networkAttempts,
    })).catch((error) => done({ error: String(error) }));
  }, timeoutMs);
}

function browserHealthError(value: unknown): Error | undefined {
  if (!value || typeof value !== 'object') return new Error('Front-end diagnostics were unavailable');
  const snapshot = value as {
    error?: unknown;
    errors?: unknown;
    logs?: unknown;
    networkAttempts?: { installed?: unknown; total?: unknown };
  };
  if (snapshot.error) return new Error(`Front-end diagnostics failed: ${String(snapshot.error)}`);
  if (!Array.isArray(snapshot.errors)) return new Error('Front-end unhandled-error diagnostics were unavailable');
  if (snapshot.errors.length > 0) return new Error(`Front-end reported ${snapshot.errors.length} unhandled error(s)`);
  if (!Array.isArray(snapshot.logs)) return new Error('Front-end console diagnostics were unavailable');
  const consoleErrors = snapshot.logs.filter((entry) => (
    entry && typeof entry === 'object' && (entry as { level?: unknown }).level === 'error'
  ));
  if (consoleErrors.length > 0) return new Error(`Front-end console reported ${consoleErrors.length} error(s)`);
  if (snapshot.networkAttempts?.installed !== true) return new Error('E2E WebView network guard is not installed');
  if (snapshot.networkAttempts.total !== 0) {
    return new Error(`E2E WebView blocked ${String(snapshot.networkAttempts.total)} external network request(s)`);
  }
  return undefined;
}

async function stopDriver(): Promise<void> {
  const currentDriver = driver;
  driver = undefined;
  if (!currentDriver || currentDriver.exitCode !== null || currentDriver.signalCode !== null) return;

  if (process.platform === 'win32' && currentDriver.pid) {
    await new Promise<void>((resolve) => {
      execFile('taskkill.exe', ['/PID', String(currentDriver.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    });
  } else {
    try { currentDriver.kill('SIGTERM'); } catch { /* already exited */ }
  }
  await waitForChildExit(currentDriver, 5000);
}

async function waitForChildExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function closeDriverLog(): Promise<void> {
  const currentLog = driverLog;
  driverLog = undefined;
  if (!currentLog || currentLog.closed) return;
  await new Promise<void>((resolve) => currentLog.end(resolve));
}

export default config;
