import { invoke } from '@tauri-apps/api/core';

const LEGACY_ORIGIN = 'http://tauri.localhost';
const STORAGE_PREFIX = 'ai_novel_studio_';
const E2E_SENTINEL_KEY = 'ai_novel_studio_e2e_legacy_storage_migration_v1';
const E2E_SENTINEL_VALUE = 'migrated-from-http-origin';
const APPLY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 100;
const E2E_ENABLED = import.meta.env?.VITE_AI_NOVEL_STUDIO_E2E === '1';

interface StorageEntry {
  key: string;
  value: string;
}

interface ProbeStatus {
  applied: boolean;
  error?: string | null;
}

function readApplicationStorage(): StorageEntry[] {
  const entries: StorageEntry[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(STORAGE_PREFIX)) continue;
    entries.push({ key, value: localStorage.getItem(key) ?? '' });
  }
  return entries.sort((left, right) => left.key.localeCompare(right.key));
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function failProbe(error: unknown): Promise<void> {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'legacy_local_storage_probe_failed';
  try {
    await invoke('fail_legacy_local_storage_probe', { error: message.slice(0, 500) });
  } catch {
    // The Rust startup timeout remains the final fallback when the window is
    // already closing or the IPC bridge is unavailable.
  }
}

async function runE2eHost(): Promise<void> {
  for (;;) {
    if (await invoke<boolean>('take_e2e_legacy_storage_seed_request')) {
      localStorage.setItem(E2E_SENTINEL_KEY, E2E_SENTINEL_VALUE);
      localStorage.setItem('ai_novel_studio_update_channel_v1', 'beta');
      localStorage.setItem('ai_novel_studio_theme_preference', 'dark');
      await invoke('finish_e2e_legacy_storage_seed');
    }
    if (await invoke<boolean>('take_e2e_legacy_storage_probe_request')) {
      await invoke('finish_e2e_legacy_storage_probe', {
        entries: readApplicationStorage(),
      });
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function runMigrationProbe(): Promise<void> {
  if (window.location.origin !== LEGACY_ORIGIN) {
    await failProbe('legacy_local_storage_origin_mismatch');
    return;
  }

  const entries = readApplicationStorage();
  await invoke('stage_legacy_local_storage', {
    input: { origin: window.location.origin, entries },
  });
  if (entries.length === 0) {
    if (!E2E_ENABLED) await invoke('close_legacy_local_storage_probe');
    return;
  }

  const deadline = Date.now() + APPLY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await invoke<ProbeStatus>('get_legacy_local_storage_probe_status');
    if (status.error) {
      await failProbe(status.error);
      return;
    }
    if (status.applied) {
      for (const entry of entries) localStorage.removeItem(entry.key);
      if (!E2E_ENABLED) await invoke('close_legacy_local_storage_probe');
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  await failProbe('legacy_local_storage_apply_timeout');
}

async function main(): Promise<void> {
  await runMigrationProbe();
  if (E2E_ENABLED) await runE2eHost();
}

void main().catch((error: unknown) => {
  void failProbe(error);
});
