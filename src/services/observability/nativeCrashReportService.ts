import { isTauriRuntime, tauriInvoke } from '../tauri/runtime';

export interface NativeCrashReport {
  schemaVersion: number;
  capturedAt: string;
  kind: 'rust_panic';
  appVersion: string;
  sourceFile?: string;
  sourceLine?: number;
  sourceColumn?: number;
}

export const nativeCrashReportService = {
  async list(): Promise<readonly NativeCrashReport[]> {
    if (!isTauriRuntime()) return [];
    return tauriInvoke<NativeCrashReport[]>('get_native_crash_reports');
  },

  async clear(): Promise<void> {
    if (!isTauriRuntime()) return;
    await tauriInvoke<void>('clear_native_crash_reports');
  },
};
