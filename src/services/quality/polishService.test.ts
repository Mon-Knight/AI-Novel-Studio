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
    switch (command) {
      case 'list_polish_records':
        return [...state.sqlite.values()].filter((row) => row.chapterId === args!.chapterId);
      case 'get_polish_record':
        return state.sqlite.get(args!.recordId as string) ?? null;
      case 'create_polish_record': {
        const input = args!.input as Record<string, unknown>;
        if (input.sourceDraftId === 'missing-draft') {
          throw new Error('LOCAL_ASSET_INVALID: 来源草稿不存在');
        }
        const id = (input.id as string | undefined) ?? `sqlite-${state.sqlite.size + 1}`;
        const row = {
          ...input,
          id,
          status: input.status ?? 'pending',
          createdAt: input.createdAt ?? '2026-09-08T00:00:00.000Z',
          updatedAt: input.updatedAt ?? '2026-09-08T00:00:00.000Z',
        };
        state.sqlite.set(id, row);
        return row;
      }
      case 'update_polish_record': {
        const input = args!.input as Record<string, unknown>;
        const existing = state.sqlite.get(input.id as string);
        if (!existing) return null;
        const next = { ...existing };
        for (const key of ['resultDraftId', 'aiTaskId', 'status', 'errorMessage']) {
          if (input[key] !== undefined) next[key] = input[key];
        }
        state.sqlite.set(existing.id as string, next);
        return next;
      }
      case 'delete_polish_record':
        state.sqlite.delete(args!.recordId as string);
        return undefined;
      default:
        throw new Error(`unexpected command ${command}`);
    }
  },
}));

import { POLISH_RECORDS_SQLITE_MIGRATION_KEY, polishService } from './polishService';

const LEGACY_KEY = 'ai_novel_studio_polish_records';

beforeEach(() => {
  state.mode = 'tauri';
  state.storage.clear();
  state.calls.length = 0;
  state.sqlite.clear();
});

describe('polishService (desktop SQLite truth)', () => {
  it('migrates legacy records once and leaves orphans out of SQLite', async () => {
    state.storage.set(LEGACY_KEY, [
      {
        id: 'legacy-1',
        novelId: 'novel-1',
        chapterId: 'chapter-1',
        sourceDraftId: 'draft-1',
        mode: 'keep_plot',
        status: 'succeeded',
        resultDraftId: 'draft-2',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:05:00.000Z',
      },
      {
        id: 'legacy-orphan',
        novelId: 'novel-1',
        chapterId: 'chapter-1',
        sourceDraftId: 'missing-draft',
        mode: 'custom',
        status: 'failed',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
    const records = await polishService.getByChapterId('chapter-1');
    expect(records.map((record) => record.id)).toEqual(['legacy-1']);
    expect(records[0].resultDraftId).toBe('draft-2');
    expect(state.storage.get(POLISH_RECORDS_SQLITE_MIGRATION_KEY)).toBe(true);

    state.calls.length = 0;
    expect(await polishService.getById('legacy-1')).not.toBeNull();
    expect(state.calls.map((call) => call.command)).toEqual(['get_polish_record']);
  });

  it('drives the lifecycle through SQLite commands and only sends provided patch fields', async () => {
    const created = await polishService.create({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      sourceDraftId: 'draft-1',
      mode: 'enhance_description',
    });
    expect(created.status).toBe('pending');
    const running = await polishService.update(created.id, { status: 'running' });
    expect(running?.status).toBe('running');
    const patch = state.calls[state.calls.length - 1].args!.input as Record<string, unknown>;
    expect(patch).toEqual({
      id: created.id,
      resultDraftId: undefined,
      aiTaskId: undefined,
      status: 'running',
      errorMessage: undefined,
    });
    expect(await polishService.update('missing', { status: 'failed' })).toBeNull();
    await polishService.remove(created.id);
    expect(await polishService.getByChapterId('chapter-1')).toEqual([]);
  });

  it('keeps the LocalStorage path in browser mode', async () => {
    state.mode = 'localstorage';
    const created = await polishService.create({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      sourceDraftId: 'draft-1',
      mode: 'fix_language',
    });
    expect((await polishService.update(created.id, { status: 'succeeded' }))?.status).toBe(
      'succeeded',
    );
    expect(await polishService.getByChapterId('chapter-1')).toHaveLength(1);
    expect(state.calls).toEqual([]);
  });
});
