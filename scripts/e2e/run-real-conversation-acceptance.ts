/* eslint-disable no-console */
import { execFile, spawn } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {
  assertAdoptedContentHashes,
  redactLogText,
  sanitizeArtifactDirectory,
} from './artifact-sanitizer.ts';
import {
  assertCurrentRealConversationPassingEvidence,
  assertSecretAbsent,
  environmentWithoutRealCredential,
  preparedRealConversationChapterCount,
  readRealConversationAcceptanceProfile,
  REAL_ACCEPTANCE_CANDIDATE_INTEGRITY_CONTRACT_VERSION,
  REAL_ACCEPTANCE_EVIDENCE_SCHEMA_VERSION,
  REAL_ACCEPTANCE_ENV,
  REAL_ACCEPTANCE_GATE_CHAPTER_LIMIT,
  REAL_ACCEPTANCE_PREPARED_FIXTURE_CANARIES,
  resolveRealConversationRunChapterCount,
  type RealConversationAcceptanceFailureStage,
  type RealConversationAcceptanceProfile,
} from './real-conversation-acceptance-profile.ts';
import {
  readDriverExitReport,
  resolveDriverExitReportPath,
  waitForDriverExitReport,
  type DriverExitReport,
} from './driver-liveness-guard.ts';
import {
  resolveRealAcceptanceTauriDriver,
  retainSafeRealAcceptanceDiagnostics,
} from './real-conversation-runner-support.ts';

const workspaceRoot = path.resolve(import.meta.dirname, '../..');
const realWdioConfig = path.join(workspaceRoot, 'tests', 'real-acceptance', 'wdio.conf.ts');
const realSpec = path.join(workspaceRoot, 'tests', 'real-acceptance', 'conversation-60000.spec.ts');
const cargoTargetDirectory = path.join(workspaceRoot, '.e2e-tools', 'real-acceptance-target');
const dshRuntimeRoot = path.join(workspaceRoot, 'src-tauri', '.payload-staging', 'dsh-runtime');
const dshGatewayBin = path.join(
  workspaceRoot,
  'src-tauri',
  'target',
  'debug',
  process.platform === 'win32' ? 'novel-domain-gateway.exe' : 'novel-domain-gateway',
);

let activeChild: ReturnType<typeof spawn> | undefined;
let activeCredential = '';

try {
  await main();
} catch (error) {
  process.exitCode = 1;
  console.error(`[REAL ACCEPTANCE] ${safeError(error, activeCredential)}`);
} finally {
  activeCredential = '';
}

async function main(): Promise<void> {
  const profile = readRealConversationAcceptanceProfile(process.env);
  activeCredential = profile.apiKey;
  const runId = randomUUID();
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-studio-real-e2e-'));
  const dataDirectory = path.join(runRoot, 'data');
  const transientArtifacts = path.join(runRoot, 'diagnostics');
  const evidenceParent = path.resolve(
    process.env[REAL_ACCEPTANCE_ENV.artifacts]?.trim() ||
      path.join(workspaceRoot, 'test-results', 'real-conversation-acceptance'),
  );
  const evidenceDirectory = path.join(
    evidenceParent,
    `${profile.mode}-${profile.scenario}-${runId}`,
  );
  const providerEvidenceDirectory = path.join(evidenceDirectory, 'provider-requests');
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.mkdirSync(transientArtifacts, { recursive: true });
  fs.mkdirSync(evidenceParent, { recursive: true });
  fs.mkdirSync(evidenceDirectory, { recursive: false });
  fs.mkdirSync(providerEvidenceDirectory, { recursive: false });
  fs.writeFileSync(path.join(dataDirectory, '.ai-novel-studio-e2e-marker'), `${runId}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });

  let activeFailureStage: RealConversationAcceptanceFailureStage = 'runner_preparation';
  installSignalHandlers();
  try {
    const application = await prepareApplication(profile, runRoot);
    assertDshCarrier();
    const driverPort = process.env[REAL_ACCEPTANCE_ENV.driverPort]
      ? validatePort(Number(process.env[REAL_ACCEPTANCE_ENV.driverPort]))
      : await findAvailableDriverPort();
    const driver = resolveRealAcceptanceTauriDriver({
      workspaceRoot,
      explicit: process.env[REAL_ACCEPTANCE_ENV.driver],
    });
    const nativeDriver = resolveNativeDriver();

    const chapterScope =
      profile.scenario === 'prepared-assets'
        ? `${preparedRealConversationChapterCount(profile)} prepared chapters`
        : profile.mode === 'full'
          ? 'all chapters from the applied story plan'
          : `up to ${REAL_ACCEPTANCE_GATE_CHAPTER_LIMIT} chapters from the applied story plan`;
    console.log(
      `[REAL ACCEPTANCE] starting ${profile.mode}/${profile.scenario} profile (${chapterScope}, model=${profile.model})`,
    );
    console.log(
      `[REAL ACCEPTANCE] tauri-driver ${driver.version} (${driver.source}); version contract verified.`,
    );
    activeFailureStage = 'test_execution';
    const result = await runWdio({
      profile,
      runId,
      dataDirectory,
      transientArtifacts,
      evidenceDirectory,
      providerEvidenceDirectory,
      application,
      driverPort,
      driver: driver.executable,
      nativeDriver,
    });

    activeFailureStage = 'artifact_audit';
    await sanitizeAndAuditArtifacts(profile, transientArtifacts, evidenceDirectory, dataDirectory);
    if (result !== 0) {
      activeFailureStage = 'diagnostics';
      reportFailureDiagnostics(transientArtifacts, profile.apiKey);
      activeFailureStage = 'test_execution';
      throw new Error(`WebdriverIO exited with code ${result}.`);
    }
    activeFailureStage = 'evidence_validation';
    const evidencePath = path.join(evidenceDirectory, 'real-conversation-evidence.json');
    if (!fs.existsSync(evidencePath)) {
      throw new Error('The real conversation evidence file was not produced.');
    }
    const evidence: unknown = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    assertCurrentRealConversationPassingEvidence(evidence);
    const plannedChapterCount = Number(evidence.plannedChapterCount);
    const chapterCount = Number(evidence.chapterCount);
    const expectedChapterCount =
      Number.isSafeInteger(plannedChapterCount) && plannedChapterCount >= 1
        ? resolveRealConversationRunChapterCount(profile, plannedChapterCount)
        : 0;
    if (
      evidence.status !== 'passed' ||
      evidence.scenario !== profile.scenario ||
      plannedChapterCount < 1 ||
      chapterCount !== expectedChapterCount ||
      (profile.scenario === 'prepared-assets' &&
        plannedChapterCount !== preparedRealConversationChapterCount(profile))
    ) {
      throw new Error('The real conversation evidence did not report a complete passing profile.');
    }
    console.log(`[REAL ACCEPTANCE] passed; sanitized evidence: ${evidencePath}`);
  } catch (error) {
    try {
      await retainAndAuditSafeDiagnostics(profile, dataDirectory, evidenceDirectory);
    } catch {
      console.error('[REAL ACCEPTANCE] safe native diagnostics could not be retained.');
    }
    const evidencePath = path.join(evidenceDirectory, 'real-conversation-evidence.json');
    if (!fs.existsSync(evidencePath)) {
      fs.writeFileSync(
        evidencePath,
        JSON.stringify(
          {
            evidenceSchemaVersion: REAL_ACCEPTANCE_EVIDENCE_SCHEMA_VERSION,
            candidateIntegrityContractVersion: REAL_ACCEPTANCE_CANDIDATE_INTEGRITY_CONTRACT_VERSION,
            status: 'failed',
            failureStage: activeFailureStage,
            failureReason: safeError(error, profile.apiKey),
            model: { providerId: 'openai_compatible', modelId: profile.model },
            scenario: profile.scenario,
            preseededFormalStoryAssets: profile.scenario === 'prepared-assets',
            automaticAssetPreflightRetries: [],
            plannedChapterCount:
              profile.scenario === 'prepared-assets'
                ? preparedRealConversationChapterCount(profile)
                : 0,
            plannedTargetWordCount: 0,
            chapterCount: 0,
            completedChapterCount: 0,
            totalWordCount: 0,
            totalDurationMs: 0,
            chapters: [],
          },
          null,
          2,
        ),
        { encoding: 'utf8', flag: 'wx' },
      );
    }
    throw error;
  } finally {
    const child = activeChild;
    if (child) await terminateProcessTree(child);
    activeChild = undefined;
    removeTemporaryRunRoot(runRoot);
  }
}

interface WdioInput {
  profile: RealConversationAcceptanceProfile;
  runId: string;
  dataDirectory: string;
  transientArtifacts: string;
  evidenceDirectory: string;
  providerEvidenceDirectory: string;
  application: string;
  driverPort: number;
  driver: string;
  nativeDriver?: string;
}

async function runWdio(input: WdioInput): Promise<number> {
  const wdioEntry = path.join(workspaceRoot, 'node_modules', '@wdio', 'cli', 'bin', 'wdio.js');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AI_NOVEL_STUDIO_E2E: '1',
    AI_NOVEL_STUDIO_E2E_RUN_ID: input.runId,
    AI_NOVEL_STUDIO_E2E_DATA_DIR: input.dataDirectory,
    AI_NOVEL_STUDIO_E2E_ARTIFACTS: input.transientArtifacts,
    AI_NOVEL_STUDIO_E2E_APP: input.application,
    AI_NOVEL_STUDIO_E2E_DRIVER_PORT: String(input.driverPort),
    AI_NOVEL_STUDIO_E2E_DRIVER: input.driver,
    AI_NOVEL_STUDIO_REAL_E2E: '1',
    AI_NOVEL_STUDIO_REAL_E2E_BASE_URL: input.profile.baseUrl,
    AI_NOVEL_STUDIO_REAL_E2E_MODEL: input.profile.model,
    AI_NOVEL_STUDIO_REAL_E2E_API_KEY: input.profile.apiKey,
    AI_NOVEL_STUDIO_REAL_E2E_MODE: input.profile.mode,
    AI_NOVEL_STUDIO_REAL_E2E_SCENARIO: input.profile.scenario,
    AI_NOVEL_STUDIO_REAL_E2E_CHAPTER_TIMEOUT_MS: String(input.profile.chapterTimeoutMs),
    [REAL_ACCEPTANCE_ENV.evidenceDirectory]: input.evidenceDirectory,
    [REAL_ACCEPTANCE_ENV.providerEvidenceDirectory]: input.providerEvidenceDirectory,
    [REAL_ACCEPTANCE_ENV.preparedFixtureCanaries]: JSON.stringify(
      REAL_ACCEPTANCE_PREPARED_FIXTURE_CANARIES,
    ),
    DSH_RUNTIME_ROOT: dshRuntimeRoot,
    DSH_GATEWAY_BIN: dshGatewayBin,
    ...(input.nativeDriver ? { AI_NOVEL_STUDIO_E2E_NATIVE_DRIVER: input.nativeDriver } : {}),
  };
  const child = spawn(process.execPath, [wdioEntry, 'run', realWdioConfig, '--spec', realSpec], {
    cwd: workspaceRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  activeChild = child;
  forwardRedactedLines(child.stdout, process.stdout, input.profile.apiKey);
  forwardRedactedLines(child.stderr, process.stderr, input.profile.apiKey);
  const reportPath = resolveDriverExitReportPath(input.transientArtifacts);
  const livenessAbort = new AbortController();
  let driverFailure: DriverExitReport | undefined;
  let driverReportInvalid = false;
  let driverFailureLogged = false;
  let driverValidationFailureLogged = false;
  const livenessTask = waitForDriverExitReport(reportPath, {
    signal: livenessAbort.signal,
    pollIntervalMs: 100,
  })
    .then(async (report) => {
      if (!report) return;
      driverFailure = report;
      driverFailureLogged = true;
      console.error(`[REAL ACCEPTANCE] tauri-driver ${formatDriverExit(report)} after readiness.`);
      await terminateProcessTree(child);
    })
    .catch(async (error) => {
      if (livenessAbort.signal.aborted) return;
      driverReportInvalid = true;
      driverValidationFailureLogged = true;
      console.error(
        `[REAL ACCEPTANCE] tauri-driver liveness report failed validation (${safeError(error, input.profile.apiKey)}); terminating the WebdriverIO process tree.`,
      );
      await terminateProcessTree(child);
    });
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode) => resolve(exitCode ?? 1));
    });
    try {
      const finalReport = readDriverExitReport(reportPath);
      if (finalReport) {
        driverFailure ??= finalReport;
        if (!driverFailureLogged) {
          driverFailureLogged = true;
          console.error(
            `[REAL ACCEPTANCE] tauri-driver ${formatDriverExit(finalReport)} after readiness.`,
          );
        }
      }
    } catch (error) {
      driverReportInvalid = true;
      if (!driverValidationFailureLogged) {
        driverValidationFailureLogged = true;
        console.error(
          `[REAL ACCEPTANCE] tauri-driver liveness report failed validation (${safeError(error, input.profile.apiKey)}).`,
        );
      }
    }
    return driverFailure || driverReportInvalid ? 1 : code;
  } catch (error) {
    await terminateProcessTree(child);
    throw error;
  } finally {
    livenessAbort.abort();
    await livenessTask;
    if (activeChild === child) activeChild = undefined;
  }
}

function formatDriverExit(report: DriverExitReport): string {
  if (report.kind === 'process_error') return 'reported a process error';
  return `exited unexpectedly (code ${String(report.exitCode)}, signal ${report.signal ?? 'none'})`;
}

async function terminateProcessTree(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    await new Promise<void>((resolve) => {
      execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () =>
        resolve(),
      );
    });
  } else {
    try {
      child.kill('SIGTERM');
    } catch {
      return;
    }
  }
  await waitForChildExit(child, 5000);
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

async function prepareApplication(
  profile: RealConversationAcceptanceProfile,
  runRoot: string,
): Promise<string> {
  const explicit = process.env[REAL_ACCEPTANCE_ENV.app]?.trim();
  let source: string;
  if (explicit) {
    source = path.resolve(explicit);
    assertApplication(source, `${REAL_ACCEPTANCE_ENV.app} was supplied`);
  } else {
    fs.mkdirSync(cargoTargetDirectory, { recursive: true });
    const tauriCli = path.join(workspaceRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
    const buildEnvironment = {
      ...environmentWithoutRealCredential(process.env),
      CARGO_TARGET_DIR: cargoTargetDirectory,
      VITE_AI_NOVEL_STUDIO_E2E: '1',
      VITE_AI_NOVEL_STUDIO_REAL_E2E: '1',
    };
    console.log('[REAL ACCEPTANCE] building an unpackaged real-profile Tauri test carrier...');
    const result = await runChild(
      process.execPath,
      [tauriCli, 'build', '--features', 'e2e', '--bundles', 'none', '--ci'],
      buildEnvironment,
      profile.apiKey,
    );
    if (result !== 0) throw new Error(`Tauri real-profile build exited with code ${result}.`);
    source = resolveBuiltApplication();
    assertApplication(source, 'Tauri real-profile build completed');
  }

  const applicationDirectory = path.join(runRoot, 'application');
  const staged = path.join(
    applicationDirectory,
    process.platform === 'win32' ? 'ai-novel-studio-real-e2e.exe' : 'ai-novel-studio-real-e2e',
  );
  fs.mkdirSync(applicationDirectory, { recursive: true });
  fs.copyFileSync(source, staged);
  assertApplication(staged, 'The real-profile application was staged');
  return staged;
}

function resolveBuiltApplication(): string {
  const releaseDirectory = path.join(cargoTargetDirectory, 'release');
  const names =
    process.platform === 'win32'
      ? ['ai-novel-studio.exe', 'AI Novel Studio.exe']
      : ['ai-novel-studio', 'AI Novel Studio'];
  const candidates = names
    .map((name) => path.join(releaseDirectory, name))
    .filter((candidate) => fs.existsSync(candidate))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  return candidates[0] ?? path.join(releaseDirectory, names[0]);
}

function assertApplication(application: string, context: string): void {
  if (!fs.existsSync(application) || !fs.statSync(application).isFile()) {
    throw new Error(`${context}, but no application executable was found.`);
  }
}

function assertDshCarrier(): void {
  const runtimeEntry = path.join(
    dshRuntimeRoot,
    'packages',
    'examples',
    'jsonrpc-demo',
    'lib',
    'bin.js',
  );
  if (!fs.existsSync(runtimeEntry) || !fs.statSync(runtimeEntry).isFile()) {
    throw new Error('The pinned DSH runtime payload is unavailable for real acceptance.');
  }
  if (!fs.existsSync(dshGatewayBin) || !fs.statSync(dshGatewayBin).isFile()) {
    throw new Error('The local novel-domain gateway is unavailable for real acceptance.');
  }
}

function resolveNativeDriver(): string | undefined {
  const explicit = process.env[REAL_ACCEPTANCE_ENV.nativeDriver]?.trim();
  if (process.platform !== 'win32') return explicit;
  if (explicit) {
    const resolved = resolveExecutable(explicit);
    if (resolved) return resolved;
    throw new Error(`${REAL_ACCEPTANCE_ENV.nativeDriver} does not resolve to an executable.`);
  }

  const toolsRoot = path.join(workspaceRoot, '.e2e-tools');
  const candidates = findNamedFiles(toolsRoot, 'msedgedriver.exe')
    .filter((candidate) => !isWithin(candidate, cargoTargetDirectory))
    .map((candidate) => ({ candidate, modifiedAt: fs.statSync(candidate).mtimeMs }))
    .sort(
      (left, right) =>
        right.modifiedAt - left.modifiedAt || left.candidate.localeCompare(right.candidate),
    );
  if (candidates[0]) return candidates[0].candidate;

  const fromPath = findOnPath('msedgedriver.exe');
  if (fromPath) return fromPath;
  throw new Error(
    'Microsoft Edge WebDriver was not found. Set AI_NOVEL_STUDIO_REAL_E2E_NATIVE_DRIVER or place msedgedriver.exe under .e2e-tools.',
  );
}

function resolveExecutable(reference: string): string | undefined {
  if (path.isAbsolute(reference) || reference.includes('/') || reference.includes('\\')) {
    const resolved = path.resolve(reference);
    return fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : undefined;
  }
  return findOnPath(reference);
}

function findOnPath(executable: string): string | undefined {
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry.replace(/^"|"$/g, ''), executable);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function findNamedFiles(root: string, name: string): string[] {
  if (!fs.existsSync(root)) return [];
  const matches: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) {
        matches.push(absolute);
      }
    }
  }
  return matches;
}

function isWithin(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function runChild(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  credential: string,
): Promise<number> {
  const child = spawn(command, args, {
    cwd: workspaceRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  activeChild = child;
  forwardRedactedLines(child.stdout, process.stdout, credential);
  forwardRedactedLines(child.stderr, process.stderr, credential);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

function forwardRedactedLines(
  source: NodeJS.ReadableStream | null,
  destination: NodeJS.WriteStream,
  credential: string,
): void {
  if (!source) return;
  const reader = readline.createInterface({ input: source });
  reader.on('line', (line) => {
    const exactRedaction = credential ? line.split(credential).join('[REDACTED_KEY]') : line;
    destination.write(`${redactLogText(exactRedaction)}\n`);
  });
}

async function sanitizeAndAuditArtifacts(
  profile: RealConversationAcceptanceProfile,
  transientArtifacts: string,
  evidenceDirectory: string,
  dataDirectory: string,
): Promise<void> {
  await retainAndAuditSafeDiagnostics(profile, dataDirectory, evidenceDirectory);
  const issues = [
    ...(await sanitizeArtifactDirectory(transientArtifacts)),
    ...(await sanitizeArtifactDirectory(evidenceDirectory)),
  ];
  if (issues.length > 0) throw new Error('Acceptance artifacts could not be sanitized.');

  const evidencePath = path.join(evidenceDirectory, 'real-conversation-evidence.json');
  if (fs.existsSync(evidencePath)) {
    try {
      const evidence = fs.readFileSync(evidencePath);
      assertAdoptedContentHashes(evidence);
      assertSecretAbsent(evidence, profile.apiKey, 'acceptance evidence');
    } catch (error) {
      fs.rmSync(evidencePath, { force: true });
      throw error;
    }
  }
  for (const name of ['ai-novel-studio.db', 'ai-novel-studio.db-wal', 'ai-novel-studio.db-shm']) {
    const databaseFile = path.join(dataDirectory, name);
    if (fs.existsSync(databaseFile)) {
      assertSecretAbsent(fs.readFileSync(databaseFile), profile.apiKey, 'isolated SQLite data');
    }
  }
}

async function retainAndAuditSafeDiagnostics(
  profile: RealConversationAcceptanceProfile,
  dataDirectory: string,
  evidenceDirectory: string,
): Promise<void> {
  const retained = retainSafeRealAcceptanceDiagnostics({ dataDirectory, evidenceDirectory });
  if (!retained.directory || retained.files.length === 0) return;
  try {
    const issues = await sanitizeArtifactDirectory(retained.directory);
    if (issues.length > 0) throw new Error('Retained native diagnostics could not be sanitized.');
    for (const file of retained.files) {
      assertSecretAbsent(
        fs.readFileSync(file),
        profile.apiKey,
        `retained diagnostic ${path.basename(file)}`,
      );
    }
  } catch (error) {
    for (const file of retained.files) fs.rmSync(file, { force: true });
    throw error;
  }
}

function reportFailureDiagnostics(directory: string, credential: string): void {
  const candidates = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(json|log|txt)$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
    .slice(0, 4);
  for (const candidate of candidates) {
    const raw = fs.readFileSync(candidate);
    assertSecretAbsent(raw, credential, `failure diagnostic ${path.basename(candidate)}`);
    const textContent = raw.toString('utf8').slice(0, 12_000);
    console.error(
      `[REAL ACCEPTANCE DIAGNOSTIC] ${path.basename(candidate)}\n${redactLogText(textContent)}`,
    );
  }
}

function safeError(error: unknown, credential: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const exactRedaction = credential ? message.split(credential).join('[REDACTED_KEY]') : message;
  return redactLogText(exactRedaction);
}

function validatePort(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1024 || value > 64535) {
    throw new Error(`${REAL_ACCEPTANCE_ENV.driverPort} must be an integer from 1024 to 64535.`);
  }
  return value;
}

async function findAvailableDriverPort(): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const port = randomInt(20_000, 40_000);
    if ((await canBind(port)) && (await canBind(port + 1000))) return port;
  }
  throw new Error('No available WebDriver port pair was found.');
}

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () =>
      server.close((error) => resolve(!error)),
    );
  });
}

function installSignalHandlers(): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      const child = activeChild;
      if (child?.pid) {
        try {
          child.kill('SIGTERM');
        } catch {
          // The child already exited.
        }
      }
      process.exitCode = 1;
    });
  }
}

function removeTemporaryRunRoot(runRoot: string): void {
  const temporaryRoot = fs.realpathSync.native(os.tmpdir());
  const resolvedRunRoot = fs.realpathSync.native(runRoot);
  const relative = path.relative(temporaryRoot, resolvedRunRoot);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Refusing to remove a real acceptance directory outside the OS temp root.');
  }
  fs.rmSync(resolvedRunRoot, { recursive: true, force: true });
}
