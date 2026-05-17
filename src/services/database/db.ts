/**
 * AI Novel Studio - 数据库服务适配层
 * Tauri 环境下使用 Rust SQLite，浏览器开发环境使用 localStorage 回退
 */

import { safeJsonParse } from '../../utils/dataGuard';

// 检测是否在 Tauri 环境中
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

// Tauri invoke 包装
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/tauri');
  return invoke<T>(cmd, args);
}

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
  return isTauri() ? 'tauri' : 'localstorage';
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
  if (isTauri()) {
    try {
      const result = await Promise.race([
        tauriInvoke<T>(command, args),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('tauri_timeout')), 3000)
        ),
      ]);
      return result;
    } catch (e: unknown) {
      console.error(`[db] Tauri command failed: ${command}`, e);
      throw e;
    }
  }
  if (fallback) {
    return fallback();
  }
  throw new Error(`No fallback for command: ${command}`);
}

export { lsGet, lsSet, lsRemove, generateId, nowISO, isTauri };
