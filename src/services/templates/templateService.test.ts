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
      case 'list_user_templates':
        return [...state.sqlite.values()].sort((left, right) =>
          String(right.updatedAt).localeCompare(String(left.updatedAt)),
        );
      case 'save_user_template': {
        const input = args!.input as Record<string, unknown>;
        if (input.type === 'poem') throw new Error('USER_TEMPLATE_INVALID: 模板类型非法');
        const id = (input.id as string | undefined) ?? `sqlite-${state.sqlite.size + 1}`;
        const previous = state.sqlite.get(id);
        const row = {
          ...input,
          id,
          fileName: input.fileName ?? null,
          createdAt: previous?.createdAt ?? input.createdAt ?? '2026-09-08T00:00:00.000Z',
          updatedAt: input.updatedAt ?? `2026-09-08T00:00:0${state.calls.length}.000Z`,
        };
        state.sqlite.set(id, row);
        return row;
      }
      case 'delete_user_template':
        state.sqlite.delete(args!.templateId as string);
        return undefined;
      default:
        throw new Error(`unexpected command ${command}`);
    }
  },
}));

import { templateService, USER_TEMPLATES_SQLITE_MIGRATION_KEY } from './templateService';

const LEGACY_KEY = 'ai_novel_studio_user_templates';

beforeEach(() => {
  state.mode = 'tauri';
  state.storage.clear();
  state.calls.length = 0;
  state.sqlite.clear();
});

describe('templateService (desktop SQLite truth)', () => {
  it('migrates legacy templates once and skips rows the database rejects', async () => {
    state.storage.set(LEGACY_KEY, [
      {
        id: 'legacy-1',
        name: '旧模板',
        type: 'chapter_outline',
        description: '',
        content: '正文',
        tags: ['a'],
        variables: [],
        source: 'user_created',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'legacy-bad',
        name: '坏模板',
        type: 'poem',
        description: '',
        content: '正文',
        tags: [],
        variables: [],
        source: 'user_created',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
    const all = await templateService.getAll();
    expect(all.map((template) => template.id)).toEqual(['legacy-1']);
    expect(all[0].tags).toEqual(['a']);
    expect(state.storage.get(USER_TEMPLATES_SQLITE_MIGRATION_KEY)).toBe(true);
    state.calls.length = 0;
    await templateService.getAll();
    expect(state.calls.map((call) => call.command)).toEqual(['list_user_templates']);
  });

  it('creates, updates by merging over the stored row, and deletes through commands', async () => {
    const created = await templateService.create({
      name: '新模板',
      type: 'custom',
      content: '内容',
      source: 'user_created',
    });
    expect(created.id).toBe('sqlite-1');
    expect(created.description).toBe('');
    const updated = await templateService.update(created.id, { name: '改名' });
    expect(updated?.name).toBe('改名');
    expect(updated?.content).toBe('内容');
    expect(await templateService.update('missing', { name: 'x' })).toBeNull();
    expect((await templateService.getByType('custom')).map((t) => t.id)).toEqual([created.id]);
    await templateService.remove(created.id);
    expect(await templateService.getAll()).toEqual([]);
  });

  it('keeps LocalStorage semantics in browser mode', async () => {
    state.mode = 'localstorage';
    const created = await templateService.create({
      name: '浏览器模板',
      type: 'polish',
      content: '内容',
      source: 'user_imported',
      tags: ['x'],
    });
    expect((await templateService.getById(created.id))?.tags).toEqual(['x']);
    await templateService.clearAll();
    expect(await templateService.getAll()).toEqual([]);
    expect(state.calls).toEqual([]);
  });
});
