import { invoke } from '@tauri-apps/api/tauri';

type TauriWindow = Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
};

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const tauriWindow = window as TauriWindow;
  return (
    typeof tauriWindow.__TAURI_IPC__ === 'function' ||
    typeof tauriWindow.__TAURI__ === 'object' ||
    typeof tauriWindow.__TAURI_INTERNALS__ === 'object'
  );
}

export async function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error(`当前不是 Tauri 环境，无法调用命令：${command}`);
  }

  if (command.includes('ai_task')) {
    console.log('[TAURI_RUNTIME] invoke', { command });
  }
  return invoke<T>(command, args);
}
