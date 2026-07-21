import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomInt, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { finished } from 'node:stream/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(import.meta.dirname, '../..');
const configPath = path.join(workspaceRoot, 'tests', 'e2e', 'wdio.conf.ts');
const explicitAppPath = process.env.AI_NOVEL_STUDIO_E2E_APP
  ? path.resolve(process.env.AI_NOVEL_STUDIO_E2E_APP)
  : undefined;
const productionCargoTargetDirectory = path.join(workspaceRoot, 'src-tauri', 'target');
const cargoTargetOverride = process.env.AI_NOVEL_STUDIO_E2E_CARGO_TARGET_DIR?.trim();
const e2eCargoTargetDirectory = path.resolve(
  workspaceRoot,
  cargoTargetOverride || path.join('.e2e-tools', 'target'),
);
assertIndependentCargoTarget(e2eCargoTargetDirectory, productionCargoTargetDirectory);
const releaseDirectory = path.join(e2eCargoTargetDirectory, 'release');
const cargoAppPath = path.join(
  releaseDirectory,
  process.platform === 'win32' ? 'ai-novel-studio.exe' : 'ai-novel-studio',
);
const tauriConfig = JSON.parse(
  fs.readFileSync(path.join(workspaceRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'),
) as { package?: { productName?: string } };
const productAppPath = path.join(
  releaseDirectory,
  process.platform === 'win32'
    ? `${tauriConfig.package?.productName ?? 'AI Novel Studio'}.exe`
    : tauriConfig.package?.productName ?? 'AI Novel Studio',
);
const allSpecs = [
  'app-start.spec.ts',
  'project-create-open.spec.ts',
  'project-edit-save.spec.ts',
  'chapter-save.spec.ts',
  'large-text-save.spec.ts',
  'candidate-review-apply.spec.ts',
  'leave-guard.spec.ts',
  'generation-job-cancel.spec.ts',
  'restart-task-recovery.spec.ts',
];
const specs = selectSpecs(process.argv.slice(2));

const artifactRoot = path.resolve(process.env.AI_NOVEL_STUDIO_E2E_ARTIFACTS ?? path.join(workspaceRoot, 'test-results', 'e2e'));
const keepData = process.env.AI_NOVEL_STUDIO_E2E_KEEP_DATA === '1';
const driverPortBase = process.env.AI_NOVEL_STUDIO_E2E_DRIVER_PORT
  ? validateDriverPortBase(Number(process.env.AI_NOVEL_STUDIO_E2E_DRIVER_PORT), specs.length)
  : await findAvailableDriverPortBase(specs.length);
const specTimeoutMs = positiveIntegerEnvironment('AI_NOVEL_STUDIO_E2E_SPEC_TIMEOUT', 10 * 60 * 1000);
const realDriver = process.env.AI_NOVEL_STUDIO_E2E_DRIVER ?? (process.platform === 'win32' ? 'tauri-driver.exe' : 'tauri-driver');
const nativeDriver = resolveNativeDriver();

if (process.env.AI_NOVEL_STUDIO_E2E !== undefined && process.env.AI_NOVEL_STUDIO_E2E !== '1') {
  throw new Error('AI_NOVEL_STUDIO_E2E must be 1 when supplied.');
}
fs.mkdirSync(artifactRoot, { recursive: true });

let activeWdioPid: number | undefined;
let signalCleanupStarted = false;
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-studio-e2e-'));
let appPath: string;
try {
  appPath = await ensureE2eApplication(runRoot);
} catch (error) {
  try {
    await removeDirectory(runRoot);
  } catch (cleanupError) {
    throw new Error(
      `E2E application preparation failed (${redactLogText(String(error))}) and its temporary directory could not be removed: ${redactLogText(String(cleanupError))}`,
    );
  }
  throw error;
}
console.log(`[E2E] application: ${diagnosticPath(appPath)}`);
console.log(`[E2E] Cargo target: ${diagnosticPath(e2eCargoTargetDirectory)}`);
console.log(`[E2E] driver port base: ${driverPortBase}`);
if (nativeDriver) console.log(`[E2E] native WebDriver: ${diagnosticPath(nativeDriver)}`);
installSignalCleanup();

let failures = 0;
for (const [index, spec] of specs.entries()) {
  const safeSpec = spec.replace(/\.spec\.ts$/, '');
  const specRoot = path.join(runRoot, `${String(index + 1).padStart(2, '0')}-${safeSpec}`);
  const specArtifacts = path.join(artifactRoot, safeSpec);
  await removeDirectChildDirectory(artifactRoot, specArtifacts);
  fs.mkdirSync(specRoot, { recursive: true });
  fs.mkdirSync(specArtifacts, { recursive: true });
  const runId = randomUUID();
  const markerPath = path.join(specRoot, '.ai-novel-studio-e2e-marker');
  fs.writeFileSync(markerPath, `${runId}\n`, { encoding: 'utf8', flag: 'wx' });
  const before = await snapshotProcesses();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AI_NOVEL_STUDIO_E2E: '1',
    AI_NOVEL_STUDIO_E2E_RUN_ID: runId,
    AI_NOVEL_STUDIO_E2E_DATA_DIR: specRoot,
    AI_NOVEL_STUDIO_E2E_ARTIFACTS: specArtifacts,
    AI_NOVEL_STUDIO_E2E_DRIVER_PORT: String(driverPortBase + index),
    AI_NOVEL_STUDIO_E2E_DRIVER: realDriver,
    ...(nativeDriver ? { AI_NOVEL_STUDIO_E2E_NATIVE_DRIVER: nativeDriver } : {}),
    AI_NOVEL_STUDIO_E2E_APP: appPath,
  };
  console.log(`\n[E2E] ${spec} (isolated data: ${diagnosticPath(specRoot)})`);
  let result: WdioRunResult = { exitCode: 1, signal: null, timedOut: false };
  let cleanup: CleanupResult = { ownedPids: [], remainingPids: [] };
  let cleanupError: string | undefined;
  try {
    result = await runWdio(spec, env, specArtifacts);
    const browserHealthFailure = validateBrowserHealthArtifact(specArtifacts);
    if (browserHealthFailure) {
      result = { ...result, exitCode: 1 };
      console.error(`[E2E] ${spec} browser health check failed: ${browserHealthFailure}`);
    }
  } catch (error) {
    console.error(`[E2E] ${spec} could not start: ${redactLogText(String(error))}`);
  } finally {
    try {
      cleanup = await cleanupOwnedProcesses(before, appPath, specRoot, result.wdioPid);
    } catch (error) {
      cleanupError = appendCleanupError(cleanupError, `process cleanup failed: ${redactLogText(String(error))}`);
      result = { ...result, exitCode: 1 };
      console.error(`[E2E] ${spec} process cleanup could not be verified: ${cleanupError}`);
    }
    if (cleanup.remainingPids.length > 0) {
      cleanupError = appendCleanupError(
        cleanupError,
        `owned processes remained after cleanup: ${cleanup.remainingPids.join(', ')}`,
      );
      result = { ...result, exitCode: 1 };
      console.error(`[E2E] ${spec} left owned processes after cleanup: ${cleanup.remainingPids.join(', ')}`);
    }
    await copyRustLog(specRoot, specArtifacts);
    if (!keepData && result.exitCode === 0) {
      try {
        await removeDirectory(specRoot);
      } catch (error) {
        cleanupError = appendCleanupError(cleanupError, `data cleanup failed: ${redactLogText(String(error))}`);
        result = { ...result, exitCode: 1 };
        console.error(`[E2E] ${spec} passed, but its isolated data could not be removed: ${cleanupError}`);
      }
    }
    await writeRunMetadata(specArtifacts, {
      spec,
      runId,
      specRoot: diagnosticPath(specRoot),
      markerPath: diagnosticPath(markerPath),
      databasePath: diagnosticPath(path.join(specRoot, 'ai-novel-studio.db')),
      driverPort: driverPortBase + index,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      wdioPid: result.wdioPid,
      ownedPids: cleanup.ownedPids,
      remainingPids: cleanup.remainingPids,
      cleanupError: cleanupError ?? null,
      dataDirectoryRetained: keepData || result.exitCode !== 0,
    });
    await sanitizeArtifactDirectory(specArtifacts);
  }
  if (result.exitCode !== 0) failures += 1;
  if (cleanupError) {
    console.error('[E2E] aborting the remaining specs because the previous test environment was not cleanly released.');
    break;
  }
}

let suiteCleanupError: string | undefined;
if (!keepData && failures === 0) {
  try {
    await removeDirectory(runRoot);
  } catch (error) {
    suiteCleanupError = `suite cleanup failed: ${redactLogText(String(error))}`;
    failures += 1;
    console.error(`[E2E] ${suiteCleanupError}`);
  }
}
await writeRunMetadata(artifactRoot, {
  scope: 'suite',
  specs,
  failures,
  runRoot: diagnosticPath(runRoot),
  cargoTarget: diagnosticPath(e2eCargoTargetDirectory),
  driverPortBase,
  cleanupError: suiteCleanupError ?? null,
  dataDirectoryRetained: keepData || failures !== 0,
});
if (failures > 0) {
  console.error(`[E2E] ${failures}/${specs.length} spec(s) failed. Failure artifacts are in ${diagnosticPath(artifactRoot)}`);
  console.error(`[E2E] isolated failure data was retained in ${diagnosticPath(runRoot)}`);
  process.exitCode = 1;
} else {
  console.log(`[E2E] all ${specs.length} independent desktop specs passed.`);
  if (keepData) console.log(`[E2E] isolated test data was retained in ${diagnosticPath(runRoot)}`);
}

interface WdioRunResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  wdioPid?: number;
}

function validateDriverPortBase(base: number, specCount: number): number {
  const highestPort = base + specCount - 1 + 1000;
  if (!Number.isSafeInteger(base) || base < 1024 || highestPort > 65535) {
    throw new Error(`AI_NOVEL_STUDIO_E2E_DRIVER_PORT cannot reserve ${specCount} driver/native port pairs from ${String(base)}.`);
  }
  return base;
}

async function findAvailableDriverPortBase(specCount: number): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const base = validateDriverPortBase(randomInt(20_000, 40_000), specCount);
    const ports = Array.from({ length: specCount }, (_, index) => [base + index, base + index + 1000]).flat();
    let available = true;
    for (const port of ports) {
      if (!(await isPortAvailable(port))) {
        available = false;
        break;
      }
    }
    if (available) return base;
  }
  throw new Error('Unable to reserve an available local port block for desktop E2E drivers.');
}

async function isPortAvailable(port: number): Promise<boolean> {
  if (!(await canBindPort(port, '127.0.0.1', false))) return false;
  return canBindPort(port, '::1', true);
}

function canBindPort(port: number, host: string, allowUnavailableAddress: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve(allowUnavailableAddress && ['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(error.code ?? ''));
    });
    server.listen({ port, host, exclusive: true }, () => {
      server.close((error) => resolve(!error));
    });
  });
}

function selectSpecs(args: string[]): string[] {
  const smoke = args.includes('--smoke');
  const specIndex = args.indexOf('--spec');
  if (smoke && specIndex >= 0) {
    throw new Error('--smoke and --spec cannot be used together.');
  }
  if (specIndex < 0) return smoke ? allSpecs.slice(0, 1) : allSpecs;

  const requested = args[specIndex + 1];
  if (!requested || requested.startsWith('--')) {
    throw new Error('--spec requires one E2E spec name.');
  }
  if (args.indexOf('--spec', specIndex + 1) >= 0) {
    throw new Error('--spec can be supplied only once.');
  }
  const normalized = requested.endsWith('.spec.ts') ? requested : `${requested}.spec.ts`;
  if (!allSpecs.includes(normalized)) {
    throw new Error(`Unknown E2E spec: ${requested}. Expected one of: ${allSpecs.join(', ')}`);
  }
  return [normalized];
}

async function runWdio(
  spec: string,
  env: NodeJS.ProcessEnv,
  specArtifacts: string,
): Promise<WdioRunResult> {
  const wdioEntry = path.join(workspaceRoot, 'node_modules', '@wdio', 'cli', 'bin', 'wdio.js');
  const logPath = path.join(specArtifacts, 'wdio.log');
  fs.writeFileSync(logPath, '', { encoding: 'utf8', flag: 'w' });
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  let logError: Error | undefined;
  logStream.on('error', (error) => {
    logError ??= error;
  });

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(process.execPath, [wdioEntry, 'run', configPath, '--spec', path.join(workspaceRoot, 'tests', 'e2e', spec)], {
      cwd: workspaceRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });
  } catch (error) {
    logStream.end();
    try {
      await finished(logStream);
    } catch (streamError) {
      logError ??= streamError instanceof Error ? streamError : new Error(String(streamError));
    }
    if (logError) {
      throw new Error(
        `WebdriverIO could not start (${redactLogText(String(error))}) and its output log could not be closed: ${redactLogText(String(logError))}`,
      );
    }
    throw error;
  }

  const teeOutput = (chunk: Buffer, destination: NodeJS.WriteStream) => {
    destination.write(chunk);
    if (!logStream.destroyed && !logStream.writableEnded) logStream.write(chunk);
  };
  child.stdout?.on('data', (chunk: Buffer) => teeOutput(chunk, process.stdout));
  child.stderr?.on('data', (chunk: Buffer) => teeOutput(chunk, process.stderr));
  activeWdioPid = child.pid;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let forceSettleTimer: NodeJS.Timeout | undefined;
    const settle = async (result: WdioRunResult, launchError?: Error) => {
      if (settled) return;
      settled = true;
      if (activeWdioPid === child.pid) activeWdioPid = undefined;
      clearTimeout(timeoutTimer);
      if (forceSettleTimer) clearTimeout(forceSettleTimer);
      logStream.end();
      try {
        await finished(logStream);
      } catch (error) {
        logError ??= error instanceof Error ? error : new Error(String(error));
      }
      if (logError) {
        console.error(`[E2E] ${spec} output log could not be completed: ${redactLogText(String(logError))}`);
        result = { ...result, exitCode: 1 };
      }
      if (launchError) {
        if (logError) {
          reject(new Error(
            `WebdriverIO could not start (${redactLogText(String(launchError))}) and its output log could not be completed: ${redactLogText(String(logError))}`,
          ));
        } else {
          reject(launchError);
        }
      } else {
        resolve(result);
      }
    };
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      console.error(`[E2E] ${spec} exceeded the ${specTimeoutMs}ms process timeout; terminating its process tree.`);
      void cleanupProcessTrees(child.pid ? [child.pid] : []).finally(() => {
        if (settled) return;
        forceSettleTimer = setTimeout(() => void settle({
          exitCode: 1,
          signal: 'SIGTERM',
          timedOut: true,
          wdioPid: child.pid,
        }), 5000);
      });
    }, specTimeoutMs);
    child.once('error', (error) => {
      clearTimeout(timeoutTimer);
      if (timedOut) void settle({ exitCode: 1, signal: 'SIGTERM', timedOut: true, wdioPid: child.pid });
      else void settle({ exitCode: 1, signal: null, timedOut: false, wdioPid: child.pid }, error);
    });
    child.once('close', (exitCode, signal) => void settle({
      exitCode: exitCode ?? 1,
      signal: signal ?? (timedOut ? 'SIGTERM' : null),
      timedOut,
      wdioPid: child.pid,
    }));
  });
}

function installSignalCleanup(): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      if (signalCleanupStarted) return;
      signalCleanupStarted = true;
      const pid = activeWdioPid;
      console.error(`[E2E] received ${signal}; terminating the active WebdriverIO process tree.`);
      void cleanupProcessTrees(pid ? [pid] : []).finally(() => process.exit(1));
    });
  }
}

async function ensureE2eApplication(dataRoot: string): Promise<string> {
  if (process.env.AI_NOVEL_STUDIO_E2E_SKIP_BUILD === '1') {
    const resolvedAppPath = explicitAppPath ?? resolveBuiltApplication();
    assertApplication(resolvedAppPath, 'AI_NOVEL_STUDIO_E2E_SKIP_BUILD was requested');
    return stageApplication(resolvedAppPath, dataRoot);
  }

  console.log('[E2E] building the Tauri test application with the E2E frontend flag...');
  fs.mkdirSync(e2eCargoTargetDirectory, { recursive: true });
  const tauriCli = path.join(workspaceRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  const child = spawn(
    process.execPath,
    [tauriCli, 'build', '--features', 'e2e', '--bundles', 'none', '--ci'],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        CARGO_TARGET_DIR: e2eCargoTargetDirectory,
        VITE_AI_NOVEL_STUDIO_E2E: '1',
      },
      stdio: 'inherit',
      windowsHide: false,
    },
  );
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`Tauri E2E build failed with exit code ${exitCode}`);
  const resolvedAppPath = explicitAppPath ?? resolveBuiltApplication();
  assertApplication(resolvedAppPath, 'Tauri E2E build completed');
  return stageApplication(resolvedAppPath, dataRoot);
}

function resolveBuiltApplication(): string {
  const candidates = [...new Set([cargoAppPath, productAppPath])]
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => ({ candidate, modifiedAt: fs.statSync(candidate).mtimeMs }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  return candidates[0]?.candidate ?? cargoAppPath;
}

function assertApplication(application: string, context: string): void {
  if (!fs.existsSync(application)) {
    throw new Error(`${context}, but the E2E application was not found: ${diagnosticPath(application)}`);
  }
  const stat = fs.statSync(application);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`${context}, but the E2E application is not a non-empty file: ${diagnosticPath(application)}`);
  }
}

function stageApplication(source: string, dataRoot: string): string {
  const stagedAt = Date.now();
  const destinationDirectory = path.join(dataRoot, 'application');
  const destination = path.join(
    destinationDirectory,
    process.platform === 'win32' ? 'ai-novel-studio-e2e.exe' : 'ai-novel-studio-e2e',
  );
  fs.mkdirSync(destinationDirectory, { recursive: true });
  fs.copyFileSync(source, destination);
  const stagedDate = new Date();
  fs.utimesSync(destination, stagedDate, stagedDate);
  assertApplication(destination, 'The Cargo application binary was staged for this E2E run');
  const destinationStat = fs.statSync(destination);
  if (destinationStat.size !== fs.statSync(source).size) {
    throw new Error(`The staged E2E application size does not match its Cargo source: ${diagnosticPath(destination)}`);
  }
  if (destinationStat.mtimeMs < stagedAt - 2000) {
    throw new Error(`The staged E2E application has a stale modification time: ${diagnosticPath(destination)}`);
  }
  return destination;
}

interface ProcessInfo {
  pid: number;
  parentPid: number;
  name: string;
  path?: string;
  commandLine?: string;
  creationDate?: string;
}

interface CleanupResult {
  ownedPids: number[];
  remainingPids: number[];
}

async function snapshotProcesses(): Promise<ProcessInfo[]> {
  if (process.platform !== 'win32') return [];
  const script = '$ErrorActionPreference="Stop"; @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,CreationDate) | ConvertTo-Json -Compress';
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { maxBuffer: 10 * 1024 * 1024 });
    if (!stdout.trim()) throw new Error('CIM returned an empty process snapshot.');
    const parsed = JSON.parse(stdout) as Record<string, unknown> | Array<Record<string, unknown>>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    if (rows.length === 0) throw new Error('CIM returned no processes.');
    return rows.map((row, index) => {
      if (!row || typeof row !== 'object') {
        throw new Error(`CIM process row ${index} is not an object.`);
      }
      const pid = Number(row.ProcessId);
      const parentPid = Number(row.ParentProcessId);
      if (!Number.isSafeInteger(pid) || pid < 0 || !Number.isSafeInteger(parentPid) || parentPid < 0) {
        throw new Error(`CIM process row ${index} has invalid process identifiers.`);
      }
      return {
        pid,
        parentPid,
        name: String(row.Name ?? ''),
        path: row.ExecutablePath ? String(row.ExecutablePath) : undefined,
        commandLine: row.CommandLine ? String(row.CommandLine) : undefined,
        creationDate: row.CreationDate ? String(row.CreationDate) : undefined,
      };
    }).filter((process) => process.pid > 0);
  } catch (error) {
    throw new Error(`Could not obtain a trustworthy Windows process snapshot: ${redactLogText(String(error))}`);
  }
}

function findOwnedProcesses(
  after: ProcessInfo[],
  before: ProcessInfo[],
  application: string,
  specRoot: string,
  wdioPid?: number,
): number[] {
  const previousByPid = new Map(before.map((item) => [item.pid, item]));
  const current = after.filter((item) => !isSameProcess(previousByPid.get(item.pid), item));
  const currentPids = new Set(current.map((item) => item.pid));
  const appNeedle = processOwnershipNeedle(application);
  const dataNeedle = processOwnershipNeedle(specRoot);
  const webviewNeedle = processOwnershipNeedle(path.join(specRoot, 'webview2'));
  const owned = new Set<number>();
  const ancestryRoots = new Set<number>();

  if (wdioPid) {
    ancestryRoots.add(wdioPid);
    if (currentPids.has(wdioPid)) owned.add(wdioPid);
  }
  for (const item of current) {
    const executable = item.path ? processOwnershipNeedle(item.path) : undefined;
    const commandLine = item.commandLine ? processOwnershipNeedle(item.commandLine) : undefined;
    if (
      executable === appNeedle
      || commandLine?.includes(appNeedle)
      || commandLine?.includes(dataNeedle)
      || commandLine?.includes(webviewNeedle)
    ) {
      owned.add(item.pid);
    }
  }

  let addedDescendant = true;
  while (addedDescendant) {
    addedDescendant = false;
    for (const item of current) {
      if (owned.has(item.pid) || (!ancestryRoots.has(item.parentPid) && !owned.has(item.parentPid))) continue;
      owned.add(item.pid);
      addedDescendant = true;
    }
  }
  return [...owned];
}

function isSameProcess(previous: ProcessInfo | undefined, current: ProcessInfo): boolean {
  if (!previous) return false;
  if (previous.creationDate && current.creationDate) {
    return previous.creationDate === current.creationDate;
  }
  // If CIM withholds creation time, refusing to claim a reused PID is the safer option.
  return previous.pid === current.pid;
}

function processOwnershipNeedle(value: string): string {
  return value.replaceAll('/', '\\').toLowerCase();
}

async function cleanupOwnedProcesses(
  before: ProcessInfo[],
  application: string,
  specRoot: string,
  wdioPid?: number,
): Promise<CleanupResult> {
  const initialSnapshot = await snapshotProcesses();
  const initial = findOwnedProcesses(initialSnapshot, before, application, specRoot, wdioPid);
  await cleanupProcessTrees(initial);

  const deadline = Date.now() + 5000;
  let remainingSnapshot = await snapshotProcesses();
  let remaining = findOwnedProcesses(remainingSnapshot, before, application, specRoot, wdioPid);
  while (remaining.length > 0 && Date.now() < deadline) {
    await cleanupProcessTrees(remaining);
    await delay(200);
    remainingSnapshot = await snapshotProcesses();
    remaining = findOwnedProcesses(remainingSnapshot, before, application, specRoot, wdioPid);
  }
  return { ownedPids: initial, remainingPids: remaining };
}

async function cleanupProcessTrees(rootPids: number[]): Promise<void> {
  if (process.platform !== 'win32') {
    for (const pid of rootPids) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ }
    }
    return;
  }
  for (const pid of rootPids) {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    } catch {
      // The process may have exited between the snapshot and taskkill.
    }
  }
}

async function writeRunMetadata(dir: string, data: Record<string, unknown>): Promise<void> {
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ ...data, generatedAt: new Date().toISOString() }, null, 2), 'utf8');
}

async function copyRustLog(dataDir: string, artifactsDir: string): Promise<void> {
  const source = path.join(dataDir, 'e2e-rust.log');
  if (!fs.existsSync(source)) return;
  try {
    const contents = await fs.promises.readFile(source, 'utf8');
    await fs.promises.writeFile(path.join(artifactsDir, 'rust-backend.log'), redactLogText(contents), 'utf8');
  } catch { /* best effort */ }
}

async function removeDirectory(target: string): Promise<void> {
  try {
    await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    throw new Error(`Could not remove ${diagnosticPath(target)}: ${redactLogText(String(error))}`);
  }
  if (fs.existsSync(target)) {
    throw new Error(`Could not verify removal of ${diagnosticPath(target)}.`);
  }
}

async function removeDirectChildDirectory(root: string, target: string): Promise<void> {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative === '..' || path.isAbsolute(relative) || relative.startsWith(`..${path.sep}`) || relative.includes(path.sep)) {
    throw new Error(
      `Refusing to remove an E2E artifact path outside a direct child of ${diagnosticPath(root)}: ${diagnosticPath(target)}`,
    );
  }
  try {
    await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    throw new Error(`Could not clear the E2E artifact directory: ${redactLogText(String(error))}`);
  }
}

function appendCleanupError(current: string | undefined, next: string): string {
  return current ? `${current}; ${next}` : next;
}

function assertIndependentCargoTarget(e2eTarget: string, productionTarget: string): void {
  if (pathsOverlap(e2eTarget, productionTarget)) {
    throw new Error(
      'AI_NOVEL_STUDIO_E2E_CARGO_TARGET_DIR must be independent from src-tauri/target so E2E builds cannot overwrite production artifacts.',
    );
  }
}

function pathsOverlap(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return isSameOrDescendant(resolvedLeft, resolvedRight) || isSameOrDescendant(resolvedRight, resolvedLeft);
}

function isSameOrDescendant(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function validateBrowserHealthArtifact(specArtifacts: string): string | undefined {
  const diagnosticPathname = path.join(specArtifacts, 'frontend-diagnostics.json');
  if (!fs.existsSync(diagnosticPathname)) return 'frontend-diagnostics.json was not created';

  let snapshot: {
    error?: unknown;
    errors?: unknown;
    logs?: unknown;
    networkAttempts?: { installed?: unknown; total?: unknown };
  };
  try {
    snapshot = JSON.parse(fs.readFileSync(diagnosticPathname, 'utf8')) as typeof snapshot;
  } catch (error) {
    return `frontend-diagnostics.json could not be parsed: ${redactLogText(String(error))}`;
  }

  if (snapshot.error) return 'front-end diagnostics reported a collection error';
  if (!Array.isArray(snapshot.errors)) return 'front-end unhandled-error diagnostics were unavailable';
  if (snapshot.errors.length > 0) return `front-end reported ${snapshot.errors.length} unhandled error(s)`;
  if (!Array.isArray(snapshot.logs)) return 'front-end console diagnostics were unavailable';
  const consoleErrorCount = snapshot.logs.filter((entry) => (
    entry && typeof entry === 'object' && (entry as { level?: unknown }).level === 'error'
  )).length;
  if (consoleErrorCount > 0) return `front-end console reported ${consoleErrorCount} error(s)`;
  if (snapshot.networkAttempts?.installed !== true) return 'E2E WebView network guard was not installed';
  if (snapshot.networkAttempts.total !== 0) {
    return `E2E WebView blocked ${String(snapshot.networkAttempts.total)} external network request(s)`;
  }
  return undefined;
}

async function sanitizeArtifactDirectory(root: string): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await sanitizeArtifactDirectory(target);
      continue;
    }
    if (!entry.isFile() || !/\.(json|html|log|txt)$/i.test(entry.name)) continue;
    try {
      const contents = await fs.promises.readFile(target, 'utf8');
      await fs.promises.writeFile(target, redactLogText(contents), 'utf8');
    } catch { /* best effort */ }
  }
}

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received ${raw}.`);
  }
  return value;
}

function resolveNativeDriver(): string | undefined {
  if (process.platform !== 'win32') return process.env.AI_NOVEL_STUDIO_E2E_NATIVE_DRIVER;

  const override = process.env.AI_NOVEL_STUDIO_E2E_NATIVE_DRIVER?.trim();
  if (override) {
    const resolved = resolveExecutable(override);
    if (resolved) return resolved;
    throw new Error(
      `AI_NOVEL_STUDIO_E2E_NATIVE_DRIVER does not resolve to an executable: ${diagnosticPath(override)}`,
    );
  }

  const toolsRoot = path.join(workspaceRoot, '.e2e-tools');
  const discovered = findFiles(toolsRoot, 'msedgedriver.exe', [e2eCargoTargetDirectory])
    .map((candidate) => ({ candidate, modifiedAt: fs.statSync(candidate).mtimeMs }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt || left.candidate.localeCompare(right.candidate));
  if (discovered.length > 0) return discovered[0].candidate;

  const fromPath = findOnPath('msedgedriver.exe');
  if (fromPath) return fromPath;
  throw new Error(
    'Microsoft Edge WebDriver was not found. Set AI_NOVEL_STUDIO_E2E_NATIVE_DRIVER, '
    + 'place msedgedriver.exe under .e2e-tools, or add it to PATH. Its major version must match WebView2.',
  );
}

function resolveExecutable(reference: string): string | undefined {
  if (path.isAbsolute(reference) || reference.includes('/') || reference.includes('\\')) {
    const resolved = path.resolve(reference);
    return fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : undefined;
  }
  const local = path.resolve(reference);
  if (fs.existsSync(local) && fs.statSync(local).isFile()) return local;
  return findOnPath(reference);
}

function findOnPath(executable: string): string | undefined {
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry.replace(/^"|"$/g, ''), executable);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* not present in this PATH entry */ }
  }
  return undefined;
}

function findFiles(root: string, fileName: string, excludedRoots: string[] = []): string[] {
  if (excludedRoots.some((excluded) => isSameOrDescendant(root, excluded))) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const matches: string[] = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) matches.push(...findFiles(target, fileName, excludedRoots));
    else if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) matches.push(target);
  }
  return matches;
}

function redactLogText(value: string): string {
  return value
    .replace(/("(?:api[_-]?key|authorization|token|password|secret|cookie)"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_KEY]')
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,"']+/gi, '$1[REDACTED]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|token|password|secret|cookie)\s*[:=]\s*)[^\s,"']+/gi, '$1[REDACTED]')
    .replace(/[A-Za-z]:\\[^\n"']+/g, '[REDACTED_PATH]');
}

function diagnosticPath(target: string): string {
  const absoluteTarget = path.resolve(target);
  const temporaryRoot = path.resolve(os.tmpdir());
  const relativeToTemp = path.relative(temporaryRoot, absoluteTarget);
  if (relativeToTemp && relativeToTemp !== '..' && !path.isAbsolute(relativeToTemp) && !relativeToTemp.startsWith(`..${path.sep}`)) {
    return path.join('%TEMP%', relativeToTemp);
  }
  const relativeToWorkspace = path.relative(workspaceRoot, absoluteTarget);
  if (relativeToWorkspace && relativeToWorkspace !== '..' && !path.isAbsolute(relativeToWorkspace) && !relativeToWorkspace.startsWith(`..${path.sep}`)) {
    return path.join('%WORKSPACE%', relativeToWorkspace);
  }
  return redactLogText(absoluteTarget);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
