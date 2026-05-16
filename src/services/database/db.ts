/**
 * AI Novel Studio - 数据库服务适配层
 * Tauri 环境下使用 Rust SQLite，浏览器开发环境使用 localStorage 回退
 */

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
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
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
 * 统一调用入口：根据环境自动选择 Tauri invoke 或 localStorage
 */
export async function dbCall<T>(
  command: string,
  args?: Record<string, unknown>,
  fallback?: () => T,
): Promise<T> {
  if (isTauri()) {
    return tauriInvoke<T>(command, args);
  }
  if (fallback) {
    return fallback();
  }
  throw new Error(`No fallback for command: ${command}`);
}

export { lsGet, lsSet, lsRemove, generateId, nowISO, isTauri };
