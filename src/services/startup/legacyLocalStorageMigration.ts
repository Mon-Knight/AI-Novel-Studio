import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../tauri/runtime';

export interface LegacyStorageEntry {
  key: string;
  value: string;
}

interface LegacyStorageMigrationSnapshot {
  phase: 'probing' | 'ready' | 'complete' | 'failed';
  entries: LegacyStorageEntry[];
  error?: string | null;
}

export interface LegacyStorageMigrationResult {
  status: 'not-desktop' | 'complete' | 'migrated' | 'failed';
  migratedEntries: number;
  error?: string;
}

const APPLICATION_STORAGE_PREFIX = 'ai_novel_studio_';
const PROBE_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 50;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function validateEntries(entries: unknown): LegacyStorageEntry[] {
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  const valid: LegacyStorageEntry[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const key = (entry as { key?: unknown }).key;
    const value = (entry as { value?: unknown }).value;
    if (
      typeof key !== 'string' ||
      typeof value !== 'string' ||
      !key.startsWith(APPLICATION_STORAGE_PREFIX) ||
      seen.has(key)
    ) {
      continue;
    }
    seen.add(key);
    valid.push({ key, value });
  }
  return valid;
}

/**
 * Merges legacy HTTP-origin preferences without overwriting data that has
 * already been written under the Tauri 2 HTTPS origin.
 */
export function applyLegacyStorageEntries(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  entries: LegacyStorageEntry[],
): number {
  let migrated = 0;
  for (const entry of validateEntries(entries)) {
    if (storage.getItem(entry.key) !== null) continue;
    storage.setItem(entry.key, entry.value);
    migrated += 1;
  }
  return migrated;
}

export async function applyPendingLegacyLocalStorageMigration(): Promise<LegacyStorageMigrationResult> {
  if (!isTauriRuntime()) {
    return { status: 'not-desktop', migratedEntries: 0 };
  }

  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  let snapshot: LegacyStorageMigrationSnapshot | undefined;
  while (Date.now() < deadline) {
    snapshot = await invoke<LegacyStorageMigrationSnapshot>(
      'get_legacy_local_storage_migration_snapshot',
    );
    if (snapshot.phase !== 'probing') break;
    await sleep(POLL_INTERVAL_MS);
  }

  if (!snapshot) {
    return {
      status: 'failed',
      migratedEntries: 0,
      error: 'legacy_local_storage_probe_unavailable',
    };
  }
  if (snapshot.phase === 'failed') {
    return {
      status: 'failed',
      migratedEntries: 0,
      error: snapshot.error || 'legacy_local_storage_probe_failed',
    };
  }
  if (snapshot.phase === 'probing') {
    return {
      status: 'failed',
      migratedEntries: 0,
      error: 'legacy_local_storage_probe_timeout',
    };
  }
  if (snapshot.phase === 'complete') {
    return { status: 'complete', migratedEntries: 0 };
  }

  const entries = validateEntries(snapshot.entries);
  const migratedEntries = applyLegacyStorageEntries(localStorage, entries);
  await invoke('complete_legacy_local_storage_migration', {
    input: { migratedEntries },
  });
  return { status: 'migrated', migratedEntries };
}
