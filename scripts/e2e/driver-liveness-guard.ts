import fs from 'node:fs';
import path from 'node:path';

export const DRIVER_EXIT_REPORT_FILENAME = 'tauri-driver-exit.json';

export type DriverExitKind = 'process_error' | 'process_exit';

export interface DriverExitReport {
  schemaVersion: 1;
  kind: DriverExitKind;
  exitCode: number | null;
  signal: string | null;
  observedAt: string;
}

export interface DriverExitReportInput {
  kind: DriverExitKind;
  exitCode?: number | null;
  signal?: string | null;
  observedAt?: string;
}

export interface DriverLivenessSnapshot {
  ready: boolean;
  shutdownRequested: boolean;
  exitReported: boolean;
}

interface WaitForDriverExitReportOptions {
  signal?: AbortSignal;
  pollIntervalMs?: number;
}

export function resolveDriverExitReportPath(artifactRoot: string): string {
  return path.join(path.resolve(artifactRoot), DRIVER_EXIT_REPORT_FILENAME);
}

export function clearDriverExitReport(filePath: string): void {
  fs.rmSync(filePath, { force: true });
}

export function writeDriverExitReport(filePath: string, input: DriverExitReportInput): boolean {
  const report: DriverExitReport = {
    schemaVersion: 1,
    kind: input.kind,
    exitCode: input.exitCode ?? null,
    signal: input.signal ?? null,
    observedAt: input.observedAt ?? new Date().toISOString(),
  };
  assertDriverExitReport(report);
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

export function writeUnexpectedDriverExitReport(
  filePath: string,
  state: DriverLivenessSnapshot,
  input: DriverExitReportInput,
): boolean {
  if (!state.ready || state.shutdownRequested || state.exitReported) return false;
  return writeDriverExitReport(filePath, input);
}

export function readDriverExitReport(filePath: string): DriverExitReport | undefined {
  let raw: string;
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size > 4096) {
      throw new Error('The tauri-driver exit report is not a bounded regular file.');
    }
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }

  let report: unknown;
  try {
    report = JSON.parse(raw);
  } catch {
    throw new Error('The tauri-driver exit report is not valid JSON.');
  }
  assertDriverExitReport(report);
  return report;
}

export async function waitForDriverExitReport(
  filePath: string,
  options: WaitForDriverExitReportOptions = {},
): Promise<DriverExitReport | undefined> {
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 10_000) {
    throw new Error('The tauri-driver liveness poll interval must be from 1 to 10000ms.');
  }

  while (!options.signal?.aborted) {
    const report = readDriverExitReport(filePath);
    if (report) return report;
    await waitForPoll(pollIntervalMs, options.signal);
  }
  return undefined;
}

function assertDriverExitReport(value: unknown): asserts value is DriverExitReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The tauri-driver exit report must be an object.');
  }
  const report = value as Partial<DriverExitReport>;
  const expectedKeys = ['exitCode', 'kind', 'observedAt', 'schemaVersion', 'signal'];
  const actualKeys = Object.keys(report).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error('The tauri-driver exit report has unexpected fields.');
  }
  if (report.schemaVersion !== 1) {
    throw new Error('The tauri-driver exit report has an unsupported schema version.');
  }
  if (report.kind !== 'process_error' && report.kind !== 'process_exit') {
    throw new Error('The tauri-driver exit report has an invalid failure kind.');
  }
  const exitCode = report.exitCode;
  if (
    exitCode !== null &&
    (typeof exitCode !== 'number' || !Number.isSafeInteger(exitCode) || exitCode < 0)
  ) {
    throw new Error('The tauri-driver exit report has an invalid exit code.');
  }
  const signal = report.signal;
  if (signal !== null && (typeof signal !== 'string' || !/^[A-Z0-9]{1,32}$/.test(signal))) {
    throw new Error('The tauri-driver exit report has an invalid signal.');
  }
  if (
    typeof report.observedAt !== 'string' ||
    report.observedAt.length > 64 ||
    Number.isNaN(Date.parse(report.observedAt))
  ) {
    throw new Error('The tauri-driver exit report has an invalid timestamp.');
  }
}

function waitForPoll(timeoutMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    signal?.addEventListener('abort', finish, { once: true });
  });
}
