import { invoke } from '@tauri-apps/api/tauri';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI_IPC__ === 'function';
}

export async function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error(`当前不是 Tauri 环境，无法调用命令：${command}`);
  }

  return invoke<T>(command, args);
}
