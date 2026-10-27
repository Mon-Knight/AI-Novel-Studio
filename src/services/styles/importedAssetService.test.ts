import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  mode: 'tauri' as 'tauri' | 'localstorage',
  storage: new Map<string, unknown>(),
  calls: [] as Array<{ command: string; args: Record<string, unknown> | undefined }>,
  sqlite: new Map<string, Record<string, unknown>>(),
}));

vi.mock('../database/db', () => ({
  getDbMode: () => state.mode,
  lsGet: <T>(key: string) => (state.storage.has(key) ? (state.storage.get(key) as T) : null),
  lsSet: (key: string, value: unknown) => {
    state.storage.set(key, value);
  },
  generateId: () => `local-${state.storage.size}`,
  nowISO: () => '2026-09-08T00:00:00.000Z',
  dbCall: async (command: string, args?: Record<string, unknown>) => {
    state.calls.push({ command, args });
    if (command === 'list_imported_assets') {
      const novelId = (args?.novelId as string | null) ?? null;
      return [...state.sqlite.values()].filter((row) => !novelId || row.novelId === novelId);
    }
    if (command === 'save_imported_asset') {
      const input = args!.input as Record<string, unknown>;
      if (input.novelId === 'deleted-novel') throw new Error('LOCAL_ASSET_INVALID: 作品不存在');
      const id = (input.id as string | undefined) ?? `sqlite-${state.sqlite.size + 1}`;
      const row = { ...input, id, createdAt: input.createdAt ?? '2026-09-08T00:00:00.000Z' };
      state.sqlite.set(id, row);
      return row;
    }
    if (command === 'delete_imported_asset') {
      state.sqlite.delete(args!.assetId as string);
      return undefined;
    }
    throw new Error(`unexpected command ${command}`);
  },
}));

import { IMPORTED_ASSETS_SQLITE_MIGRATION_KEY, importedAssetService } from './importedAssetService';

const LEGACY_KEY = 'ai_novel_studio_imported_assets';

beforeEach(() => {
  state.mode = 'tauri';
  state.storage.clear();
  state.calls.length = 0;
  state.sqlite.clear();
});

describe('importedAssetService (desktop SQLite truth)', () => {
  it('migrates legacy LocalStorage rows once, skips orphans, then reads from SQLite only', async () => {
    state.storage.set(LEGACY_KEY, [
      {
        id: 'legacy-1',
        novelId: 'novel-1',
        fileName: 'a.txt',
        fileType: 'txt',
        assetType: 'style_reference',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'legacy-2',
        novelId: 'deleted-novel',
        fileName: 'b.txt',
        fileType: 'txt',
        assetType: 'other',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
    const all = await importedAssetService.getAll();
    expect(all.map((asset) => asset.id)).toEqual(['legacy-1']);
    expect(state.storage.get(IMPORTED_ASSETS_SQLITE_MIGRATION_KEY)).toBe(true);
    const saves = state.calls.filter((call) => call.command === 'save_imported_asset');
    expect(saves).toHaveLength(2);
    expect((saves[0].args!.input as { id: string }).id).toBe('legacy-1');

    state.calls.length = 0;
    await importedAssetService.getAll('novel-1');
    expect(state.calls.map((call) => call.command)).toEqual(['list_imported_assets']);
  });

  it('creates and removes through SQLite commands on desktop', async () => {
    const created = await importedAssetService.create({
      fileName: 'c.json',
      fileType: 'json',
      assetType: 'config',
      parsedJson: '{}',
    });
    expect(created.id).toBe('sqlite-1');
    expect(created.novelId).toBeUndefined();
    await importedAssetService.remove(created.id);
    expect(state.sqlite.size).toBe(0);
    expect(state.storage.has(LEGACY_KEY)).toBe(false);
  });

  it('keeps the LocalStorage path in browser mode without touching SQLite', async () => {
    state.mode = 'localstorage';
    const created = await importedAssetService.create({
      fileName: 'd.txt',
      fileType: 'txt',
      assetType: 'novel_text',
    });
    expect(await importedAssetService.getAll()).toEqual([created]);
    await importedAssetService.remove(created.id);
    expect(await importedAssetService.getAll()).toEqual([]);
    expect(state.calls).toEqual([]);
  });
});
