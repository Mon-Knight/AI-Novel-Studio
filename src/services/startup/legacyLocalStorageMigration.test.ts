import assert from 'node:assert/strict';
import test from 'node:test';
import { applyLegacyStorageEntries } from './legacyLocalStorageMigration.ts';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test('migrates missing application preferences from the legacy origin', () => {
  const storage = new MemoryStorage();
  const migrated = applyLegacyStorageEntries(storage, [
    { key: 'ai_novel_studio_update_channel_v1', value: 'beta' },
    { key: 'ai_novel_studio_theme_preference', value: 'dark' },
  ]);

  assert.equal(migrated, 2);
  assert.equal(storage.getItem('ai_novel_studio_update_channel_v1'), 'beta');
  assert.equal(storage.getItem('ai_novel_studio_theme_preference'), 'dark');
});

test('never overwrites preferences already written under the Tauri 2 origin', () => {
  const storage = new MemoryStorage({
    ai_novel_studio_update_channel_v1: 'stable',
  });
  const migrated = applyLegacyStorageEntries(storage, [
    { key: 'ai_novel_studio_update_channel_v1', value: 'beta' },
    { key: 'ai_novel_studio_theme_preference', value: 'dark' },
  ]);

  assert.equal(migrated, 1);
  assert.equal(storage.getItem('ai_novel_studio_update_channel_v1'), 'stable');
  assert.equal(storage.getItem('ai_novel_studio_theme_preference'), 'dark');
});

test('drops malformed, duplicate and non-application keys before writing', () => {
  const storage = new MemoryStorage();
  const migrated = applyLegacyStorageEntries(storage, [
    { key: 'foreign_key', value: 'ignored' },
    { key: 'ai_novel_studio_theme_preference', value: 'dark' },
    { key: 'ai_novel_studio_theme_preference', value: 'light' },
    { key: 42, value: 'ignored' } as never,
    { key: 'ai_novel_studio_broken', value: null } as never,
  ]);

  assert.equal(migrated, 1);
  assert.equal(storage.getItem('ai_novel_studio_theme_preference'), 'dark');
  assert.equal(storage.getItem('foreign_key'), null);
});

test('reports zero when there is nothing to migrate', () => {
  assert.equal(applyLegacyStorageEntries(new MemoryStorage(), []), 0);
});
