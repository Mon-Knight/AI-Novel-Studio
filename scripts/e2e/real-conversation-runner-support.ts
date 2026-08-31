import fs from 'node:fs';
import path from 'node:path';

export const REAL_ACCEPTANCE_TAURI_DRIVER_VERSION = '0.1.5';

const MAX_INSTALL_MANIFEST_BYTES = 64 * 1024;
const MAX_RUST_LOG_BYTES = 256 * 1024;
const MAX_RUST_LOG_LINES = 400;
const MAX_NATIVE_REPORT_BYTES = 128 * 1024;
const NATIVE_REPORT_NAMES = [
  'native-crash-reports.previous.jsonl',
  'native-crash-reports.jsonl',
] as const;
const SAFE_RUST_RUNTIME_EVENTS = new Set([
  'runtime: E2E marker and isolated directories verified',
  'diagnostics: waiting up to 2 seconds for database lock',
  'diagnostics: database lock acquired',
  'diagnostics: integrity check',
  'diagnostics: foreign key pragma',
  'diagnostics: journal mode pragma',
  'diagnostics: schema and row counts',
  'diagnostics: complete',
  'fault-injection: corrupted one isolated large-text chunk',
  'get_system_accent_color: start',
  'get_system_accent_color: skipped in E2E mode',
  'get_system_accent_color: complete',
  'get_system_accent_color: registry query timed out',
  'get_all_novels: waiting for database lock',
  'get_all_novels: database lock acquired',
  'get_all_novels: complete',
]);
const SAFE_RUST_RUNTIME_EVENT_PATTERNS = [
  /^startup: database initialized elapsed_ms=[0-9]{1,16}$/,
  /^startup: tauri setup ready elapsed_ms=[0-9]{1,16}$/,
  /^startup-timing: scope=[a-z0-9_]{1,32} stage=[a-z0-9_]{1,32} phase_ms=[0-9]{1,16} total_ms=[0-9]{1,16}$/,
];

export interface RealAcceptanceTauriDriverResolution {
  executable: string;
  source: 'explicit' | 'repository-pinned';
  version: string;
}

export function resolveRealAcceptanceTauriDriver(input: {
  workspaceRoot: string;
  explicit?: string;
  pathValue?: string;
  platform?: NodeJS.Platform;
}): RealAcceptanceTauriDriverResolution {
  const platform = input.platform ?? process.platform;
  const executableName = platform === 'win32' ? 'tauri-driver.exe' : 'tauri-driver';
  const explicit = input.explicit?.trim();
  const reference =
    explicit || path.join(input.workspaceRoot, '.e2e-tools', 'tauri-driver', 'bin', executableName);
  const executable = resolveExecutableReference(
    reference,
    input.pathValue ?? process.env.PATH ?? '',
  );
  if (!executable) {
    throw new Error(
      explicit
        ? 'AI_NOVEL_STUDIO_REAL_E2E_DRIVER does not resolve to an executable.'
        : `The repository-pinned tauri-driver ${REAL_ACCEPTANCE_TAURI_DRIVER_VERSION} is unavailable.`,
    );
  }
  const version = installedTauriDriverVersion(executable);
  if (version !== REAL_ACCEPTANCE_TAURI_DRIVER_VERSION) {
    throw new Error(
      `tauri-driver version mismatch: expected ${REAL_ACCEPTANCE_TAURI_DRIVER_VERSION}, received ${version}.`,
    );
  }
  return {
    executable,
    source: explicit ? 'explicit' : 'repository-pinned',
    version,
  };
}

function resolveExecutableReference(reference: string, pathValue: string): string | undefined {
  if (path.isAbsolute(reference) || reference.includes('/') || reference.includes('\\')) {
    const resolved = path.resolve(reference);
    return isNonEmptyFile(resolved) ? resolved : undefined;
  }
  for (const entry of pathValue.split(path.delimiter)) {
    const directory = entry.trim().replace(/^"|"$/g, '');
    if (!directory) continue;
    const candidate = path.join(directory, reference);
    if (isNonEmptyFile(candidate)) return path.resolve(candidate);
  }
  return undefined;
}

function isNonEmptyFile(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

function installedTauriDriverVersion(executable: string): string {
  const installRoot = path.dirname(path.dirname(executable));
  const manifestPath = path.join(installRoot, '.crates2.json');
  let manifest: unknown;
  try {
    const stats = fs.statSync(manifestPath);
    if (!stats.isFile() || stats.size < 1 || stats.size > MAX_INSTALL_MANIFEST_BYTES) {
      throw new Error('invalid manifest');
    }
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
  } catch {
    throw new Error('tauri-driver installation metadata is unavailable or invalid.');
  }
  const expectedExecutable = path.basename(executable);
  const installs =
    manifest && typeof manifest === 'object' && !Array.isArray(manifest)
      ? (manifest as Record<string, unknown>).installs
      : undefined;
  if (!installs || typeof installs !== 'object' || Array.isArray(installs)) {
    throw new Error('tauri-driver installation metadata has no installs registry.');
  }
  for (const [identity, installation] of Object.entries(installs)) {
    const match = identity.match(
      /^tauri-driver ([0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?) \([^\r\n]+\)$/,
    );
    if (!match || !installation || typeof installation !== 'object') continue;
    const bins = (installation as Record<string, unknown>).bins;
    if (Array.isArray(bins) && bins.some((value) => value === expectedExecutable)) {
      return match[1]!;
    }
  }
  throw new Error('tauri-driver installation metadata does not identify the selected executable.');
}

export interface RetainedRealAcceptanceDiagnostics {
  directory?: string;
  files: string[];
}

export function retainSafeRealAcceptanceDiagnostics(input: {
  dataDirectory: string;
  evidenceDirectory: string;
}): RetainedRealAcceptanceDiagnostics {
  const files: string[] = [];
  const outputDirectory = path.join(input.evidenceDirectory, 'diagnostics');
  const writeDiagnostic = (name: string, value: unknown) => {
    fs.mkdirSync(outputDirectory, { recursive: true });
    const target = path.join(outputDirectory, name);
    fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    files.push(target);
  };

  const rustLogPath = path.join(input.dataDirectory, 'e2e-rust.log');
  if (isNonEmptyFile(rustLogPath)) {
    const retained = readBoundedTail(rustLogPath, MAX_RUST_LOG_BYTES);
    const sourceLines = retained.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const acceptedLines = sourceLines.filter(isSafeRustRuntimeEvent);
    const lines = acceptedLines.slice(-MAX_RUST_LOG_LINES);
    writeDiagnostic('rust-runtime-events.json', {
      schemaVersion: 1,
      source: 'e2e-rust-log',
      truncated: retained.truncated || acceptedLines.length > lines.length,
      lineCount: lines.length,
      rejectedLineCount: sourceLines.length - acceptedLines.length,
      lines,
    });
  }

  let rejectedRecordCount = 0;
  const reports: SafeNativeCrashReport[] = [];
  for (const name of NATIVE_REPORT_NAMES) {
    const reportPath = path.join(input.dataDirectory, name);
    if (!isNonEmptyFile(reportPath)) continue;
    const retained = readBoundedTail(reportPath, MAX_NATIVE_REPORT_BYTES);
    for (const line of retained.content.split(/\r?\n/).filter(Boolean)) {
      const report = parseSafeNativeCrashReport(line);
      if (report) reports.push(report);
      else rejectedRecordCount += 1;
    }
    if (retained.truncated) rejectedRecordCount += 1;
  }
  if (reports.length > 0 || rejectedRecordCount > 0) {
    writeDiagnostic('native-crash-reports.json', {
      schemaVersion: 1,
      source: 'native-rust-panic-envelope',
      reportCount: reports.length,
      rejectedRecordCount,
      reports: reports.slice(-50),
    });
  }

  return { directory: files.length > 0 ? outputDirectory : undefined, files };
}

function isSafeRustRuntimeEvent(value: string): boolean {
  return (
    SAFE_RUST_RUNTIME_EVENTS.has(value) ||
    SAFE_RUST_RUNTIME_EVENT_PATTERNS.some((pattern) => pattern.test(value))
  );
}

interface SafeNativeCrashReport {
  schemaVersion: 1;
  capturedAt: string;
  kind: 'rust_panic';
  appVersion: string;
  sourceFile: string | null;
  sourceLine: number | null;
  sourceColumn: number | null;
}

function parseSafeNativeCrashReport(line: string): SafeNativeCrashReport | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const report = value as Record<string, unknown>;
  const capturedAt = report.capturedAt;
  const appVersion = report.appVersion;
  if (
    report.schemaVersion !== 1 ||
    report.kind !== 'rust_panic' ||
    typeof capturedAt !== 'string' ||
    capturedAt.length > 64 ||
    Number.isNaN(Date.parse(capturedAt)) ||
    typeof appVersion !== 'string' ||
    !/^[0-9A-Za-z.+-]{1,32}$/.test(appVersion)
  ) {
    return undefined;
  }
  const sourceFile = safeSourceFile(report.sourceFile);
  const sourceLine = safeOptionalInteger(report.sourceLine);
  const sourceColumn = safeOptionalInteger(report.sourceColumn);
  if (sourceFile === undefined || sourceLine === undefined || sourceColumn === undefined) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    capturedAt,
    kind: 'rust_panic',
    appVersion,
    sourceFile,
    sourceLine,
    sourceColumn,
  };
}

function safeSourceFile(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 128 ||
    path.basename(value) !== value ||
    /[\\/:]/.test(value) ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32)
  ) {
    return undefined;
  }
  return value;
}

function safeOptionalInteger(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function readBoundedTail(
  filePath: string,
  maxBytes: number,
): {
  content: string;
  truncated: boolean;
} {
  const size = fs.statSync(filePath).size;
  const length = Math.min(size, maxBytes);
  const buffer = Buffer.alloc(length);
  const handle = fs.openSync(filePath, 'r');
  try {
    fs.readSync(handle, buffer, 0, length, size - length);
  } finally {
    fs.closeSync(handle);
  }
  return { content: buffer.toString('utf8'), truncated: size > length };
}
