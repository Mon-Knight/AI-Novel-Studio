/**
 * AI Novel Studio - 数据库服务适配层
 * Tauri 环境下使用 Rust SQLite，浏览器开发环境使用 localStorage 回退
 */

import { safeJsonParse } from '../../utils/dataGuard';
import { describeUnknownError } from '../../utils/errorMessage';
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
    console.error('localStorage set failed:', e);
  }
}

function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch { /* ignore */ }
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

function sanitizeForDbLog(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[MaxDepth]';
  if (typeof value === 'string') {
    return value.length > 300 ? `${value.slice(0, 300)}...[truncated]` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeForDbLog(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeForDbLog(item, depth + 1),
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
  fallback?: () => T,
): Promise<T> {
  if (isTauriRuntime()) {
    if (shouldLogDbCommand(command)) {
      console.log('[DB_CALL] invoke start', {
        command,
        args: sanitizeForDbLog(args),
        isTauri: true,
      });
    }
    try {
      const result = await Promise.race([
        tauriInvoke<T>(command, args),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('tauri_timeout')), 3000)
        ),
      ]);
      if (shouldLogDbCommand(command)) {
        console.log('[DB_CALL] invoke success', {
          command,
          result: sanitizeForDbLog(result),
        });
      }
      return result;
    } catch (e: unknown) {
      const errorMessage = describeUnknownError(e, `Tauri command failed: ${command}`);
      console.error('[DB_CALL_FAILED]', {
        command,
        args: sanitizeForDbLog(args),
        errorMessage,
        rawError: e,
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
      console.log('[DB_CALL] localStorage fallback', {
        command,
        args: sanitizeForDbLog(args),
        isTauri: false,
      });
    }
    return fallback();
  }
  throw new Error(`No fallback for command: ${command}`);
}

export { lsGet, lsSet, lsRemove, generateId, nowISO };
