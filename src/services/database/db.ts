import { appLogger } from '../observability/appLogger';
/**
 * AI Novel Studio - 数据库服务适配层
 * Tauri 环境下使用 Rust SQLite，浏览器开发环境使用 localStorage 回退
 */

import { safeJsonParse } from '../../utils/dataGuard';
import { describeUnknownError } from '../../utils/errorMessage';
import { normalizeAppError } from '../../types/appError';
import { isTauriRuntime, tauriInvoke } from '../tauri/runtime';

// ==================== localStorage 回退实现 ====================

function lsGet<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  return safeJsonParse<T | null>(raw, null);
}

function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    appLogger.error('localStorage set failed:', e);
    throw e;
  }
}

function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nowISO(): string {
  return new Date().toISOString();
}

// ==================== 统一接口导出 ====================

export type DbMode = 'tauri' | 'localstorage';

export function getDbMode(): DbMode {
  return isTauriRuntime() ? 'tauri' : 'localstorage';
}

export function isTauri(): boolean {
  return isTauriRuntime();
}

function shouldLogDbCommand(command: string): boolean {
  return command.includes('ai_task');
}

function isSensitiveLogKey(key: string): boolean {
  if (/hash|length|count|id|version|status/i.test(key)) return false;
  return (
    /(^|_)(content|recovery_content|text|body|prompt|messages?|api_?key|token|secret)($|_)/i.test(
      key,
    ) || /recoveryContent|currentEditorContent|adoptedContent|apiKey/i.test(key)
  );
}

function sanitizeForDbLog(value: unknown, depth = 0, key = ''): unknown {
  if (isSensitiveLogKey(key)) {
    const length = typeof value === 'string' ? value.length : undefined;
    return length === undefined ? '[REDACTED]' : `[REDACTED length=${length}]`;
  }
  if (depth > 3) return '[MaxDepth]';
  if (typeof value === 'string') {
    return value.length > 300 ? `${value.slice(0, 300)}...[truncated]` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeForDbLog(item, depth + 1, key));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeForDbLog(item, depth + 1, key),
      ]),
    );
  }
  return value;
}

/**
 * 统一调用入口：桌面端使用 Tauri/SQLite，浏览器开发态使用 localStorage。
 * Tauri 模式下不静默降级，避免同一业务链路写入和读取落到不同存储。
 */
export async function dbCall<T>(
  command: string,
  args?: Record<string, unknown>,
  fallback?: () => T | Promise<T>,
): Promise<T> {
  if (isTauriRuntime()) {
    if (shouldLogDbCommand(command)) {
      appLogger.debug('[DB_CALL] invoke start', {
        command,
        args: sanitizeForDbLog(args),
        isTauri: true,
      });
    }
    try {
      // Tauri invoke cannot be cancelled by rejecting a JavaScript timer.  The
      // former three-second Promise.race could therefore report a failed write
      // while Rust/SQLite committed it moments later, encouraging a duplicate
      // retry.  Wait for the authoritative command result instead.
      const result = await tauriInvoke<T>(command, args);
      if (shouldLogDbCommand(command)) {
        appLogger.debug('[DB_CALL] invoke success', {
          command,
          result: sanitizeForDbLog(result),
        });
      }
      return result;
    } catch (e: unknown) {
      const errorMessage = describeUnknownError(e, `Tauri command failed: ${command}`);
      const appError = normalizeAppError(e, errorMessage);
      appLogger.error('[DB_CALL_FAILED]', {
        command,
        args: sanitizeForDbLog(args),
        code: appError.code,
        retryable: appError.retryable,
        traceId: appError.traceId,
        operationId: appError.operationId,
      });
      if (e instanceof Error) {
        throw e;
      }
      const normalizedError = new Error(errorMessage);
      Object.assign(normalizedError, {
        command,
        args: sanitizeForDbLog(args),
        rawError: e,
      });
      throw normalizedError;
    }
  }
  if (fallback) {
    if (shouldLogDbCommand(command)) {
      appLogger.debug('[DB_CALL] localStorage fallback', {
        command,
        args: sanitizeForDbLog(args),
        isTauri: false,
      });
    }
    return await fallback();
  }
  throw new Error(`No fallback for command: ${command}`);
}

export { lsGet, lsSet, lsRemove, generateId, nowISO };
