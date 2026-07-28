import { normalizeAppError, type AppError } from '../../types/appError';

export type AppLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppLogEntry {
  id: string;
  timestamp: string;
  level: AppLogLevel;
  event: string;
  details: unknown[];
  traceId?: string;
  operationId?: string;
}

type LogListener = (entry: AppLogEntry) => void;

const MAX_BUFFER_ENTRIES = 250;
const MAX_PERSISTED_ERRORS = 50;
const MAX_STRING_LENGTH = 500;
const LOCAL_ERROR_KEY = 'ai_novel_studio_local_error_reports_v1';
const SENSITIVE_KEY =
  /api.?key|authorization|cookie|secret|password|prompt|content|body|raw|response|request|text|message|token(?!s?(Used|Input|Output|Count)$)/iu;

const entries: AppLogEntry[] = [];
const listeners = new Set<LogListener>();

function id(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function truncate(value: string): string {
  return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
}

export function sanitizeDiagnosticValue(
  value: unknown,
  key = '',
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (typeof value === 'string') return truncate(value.replace(/[\r\n\t]+/gu, ' ').trim());
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
  if (value instanceof Error) {
    const normalized = normalizeAppError(value);
    return {
      name: value.name,
      code: normalized.code,
      message: '[REDACTED]',
      retryable: normalized.retryable,
      traceId: normalized.traceId,
      operationId: normalized.operationId,
    };
  }
  if (depth >= 4) return '[MAX_DEPTH]';
  if (typeof value !== 'object') return truncate(String(value));
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => sanitizeDiagnosticValue(item, '', depth + 1, seen));
  }
  const output: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 50)) {
    output[childKey] = sanitizeDiagnosticValue(childValue, childKey, depth + 1, seen);
  }
  return output;
}

function eventName(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return truncate(value.trim());
  if (value instanceof Error) return value.name || 'Error';
  return 'APP_EVENT';
}

function extractIdentity(details: unknown[]): Pick<AppLogEntry, 'traceId' | 'operationId'> {
  for (const detail of details) {
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) continue;
    const record = detail as Record<string, unknown>;
    return {
      traceId: typeof record.traceId === 'string' ? record.traceId : undefined,
      operationId: typeof record.operationId === 'string' ? record.operationId : undefined,
    };
  }
  return {};
}

function persistError(entry: AppLogEntry): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_ERROR_KEY) || '[]') as unknown;
    const previous = Array.isArray(parsed) ? parsed : [];
    localStorage.setItem(
      LOCAL_ERROR_KEY,
      JSON.stringify([...previous, entry].slice(-MAX_PERSISTED_ERRORS)),
    );
  } catch {
    // Diagnostics must never make the product action fail.
  }
}

function writeToConsole(level: AppLogLevel, event: string, details: unknown[]): void {
  const method = level === 'debug' ? 'debug' : level;
  // This is the only production console sink. All call sites use appLogger.
  console[method](`[${level.toUpperCase()}] ${event}`, ...details);
}

function emit(level: AppLogLevel, first?: unknown, ...rawDetails: unknown[]): AppLogEntry {
  const details = (typeof first === 'string' ? rawDetails : [first, ...rawDetails])
    .filter((detail) => detail !== undefined)
    .map((detail) => sanitizeDiagnosticValue(detail));
  const identity = extractIdentity(details);
  const entry: AppLogEntry = {
    id: id(),
    timestamp: new Date().toISOString(),
    level,
    event: eventName(first),
    details,
    ...identity,
  };
  entries.push(entry);
  if (entries.length > MAX_BUFFER_ENTRIES) entries.splice(0, entries.length - MAX_BUFFER_ENTRIES);
  if (level === 'error') persistError(entry);
  for (const listener of listeners) listener(entry);
  writeToConsole(level, entry.event, entry.details);
  return entry;
}

export const appLogger = {
  debug: (first?: unknown, ...details: unknown[]) => emit('debug', first, ...details),
  info: (first?: unknown, ...details: unknown[]) => emit('info', first, ...details),
  warn: (first?: unknown, ...details: unknown[]) => emit('warn', first, ...details),
  error: (first?: unknown, ...details: unknown[]) => emit('error', first, ...details),
  captureError(event: string, value: unknown, context: Record<string, unknown> = {}): AppError {
    const normalized = normalizeAppError(value, '操作失败，请稍后重试。', {
      traceId: typeof context.traceId === 'string' ? context.traceId : undefined,
      operationId: typeof context.operationId === 'string' ? context.operationId : undefined,
    });
    emit('error', event, {
      ...context,
      code: normalized.code,
      message: '[REDACTED]',
      retryable: normalized.retryable,
      traceId: normalized.traceId,
      operationId: normalized.operationId,
      details: normalized.details,
    });
    return normalized;
  },
  getEntries: (): readonly AppLogEntry[] => [...entries],
  getLocalErrorReports(): readonly AppLogEntry[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const value = JSON.parse(localStorage.getItem(LOCAL_ERROR_KEY) || '[]') as unknown;
      return Array.isArray(value) ? (value as AppLogEntry[]) : [];
    } catch {
      return [];
    }
  },
  clearLocalErrorReports(): void {
    try {
      localStorage.removeItem(LOCAL_ERROR_KEY);
    } catch {
      // Best-effort local cleanup.
    }
  },
  subscribe(listener: LogListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

let globalHandlersInstalled = false;

export function installGlobalErrorHandlers(): () => void {
  if (globalHandlersInstalled || typeof window === 'undefined') return () => undefined;
  globalHandlersInstalled = true;
  const handleError = (event: ErrorEvent) => {
    appLogger.captureError('WINDOW_UNHANDLED_ERROR', event.error ?? event.message, {
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  };
  const handleRejection = (event: PromiseRejectionEvent) => {
    appLogger.captureError('WINDOW_UNHANDLED_REJECTION', event.reason);
  };
  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleRejection);
  return () => {
    window.removeEventListener('error', handleError);
    window.removeEventListener('unhandledrejection', handleRejection);
    globalHandlersInstalled = false;
  };
}

export const localErrorReportStorageKey = LOCAL_ERROR_KEY;
