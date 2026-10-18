import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskConversation, TaskModelSnapshot } from '../../types/conversation';
import { loadProjectTaskModel, resolveProjectTaskModel } from './projectTaskModel';

const fixture = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('./taskConversationService', () => ({
  taskConversationService: { listPage: fixture.list },
}));

const model: TaskModelSnapshot = {
  providerId: 'provider',
  modelId: 'model-3.8',
  runtimeMode: 'api',
  baseUrl: 'https://configured.example/v1',
  capabilities: [],
  options: { temperature: 0.8 },
  capturedAt: '2026-10-16T00:00:00Z',
};
const item = (id: string, novelId = 'novel', updatedAt = '2026-10-16'): TaskConversation => ({
  conversationId: id,
  novelId,
  title: id,
  status: 'idle',
  createdAt: '2026-10-15',
  updatedAt,
  defaultModel: model,
});

describe('project model inheritance', () => {
  beforeEach(() => fixture.list.mockReset());
  it('uses the latest active project choice and preserves its exact endpoint and options', () => {
    const inherited = resolveProjectTaskModel(
      'novel',
      [
        {
          ...item('old', 'novel', '2026-10-14'),
          defaultModel: { ...model, capturedAt: '2026-10-14T00:00:00Z' },
        },
        item('other', 'other', '2026-10-18'),
        { ...item('archived', 'novel', '2026-10-18'), status: 'archived' },
        item('recent'),
      ],
      () => {
        throw new Error('must not use global model');
      },
    );
    expect(inherited.model).toEqual(model);
    expect(inherited.model).not.toBe(model);
    expect(inherited.sourceLabel).toContain('recent');
    inherited.model.options.temperature = 0.1;
    expect(model.options.temperature).toBe(0.8);
  });
  it('background activity in a 3.7 task cannot replace a later explicit 3.8 choice', () => {
    const selected = resolveProjectTaskModel(
      'novel',
      [
        {
          ...item('old-3.7-active-again', 'novel', '2026-10-19'),
          defaultModel: { ...model, modelId: 'model-3.7', capturedAt: '2026-10-15T00:00:00Z' },
        },
        item('explicit-3.8', 'novel', '2026-10-16'),
      ],
      () => model,
    );
    expect(selected.model.modelId).toBe('model-3.8');
    expect(selected.model.capturedAt).toBe(model.capturedAt);
    expect(selected.sourceLabel).toContain('explicit-3.8');
  });
  it('inheriting an older choice into a new task does not refresh its selection time', () => {
    const older = {
      ...item('old-3.7'),
      defaultModel: { ...model, modelId: 'model-3.7', capturedAt: '2026-10-15T00:00:00Z' },
    };
    const inherited = resolveProjectTaskModel('novel', [older], () => model);
    expect(inherited.model.capturedAt).toBe(older.defaultModel.capturedAt);
    const next = resolveProjectTaskModel(
      'novel',
      [
        item('explicit-3.8'),
        {
          ...item('newly-created-from-3.7', 'novel', '2026-10-20'),
          createdAt: '2026-10-20',
          defaultModel: inherited.model,
        },
      ],
      () => model,
    );
    expect(next.model.modelId).toBe('model-3.8');
  });
  it('anchors a legacy choice to its original creation time and labels the conservative fallback', () => {
    for (const capturedAt of ['', 'not-a-date']) {
      const legacy = {
        ...item('legacy-3.7', 'novel', '2026-10-20'),
        createdAt: '2026-10-15T00:00:00Z',
        defaultModel: { ...model, modelId: 'model-3.7', capturedAt },
      };
      const inherited = resolveProjectTaskModel('novel', [legacy], () => model);
      expect(inherited.sourceLabel).toContain('按原会话创建时间保守确定');
      expect(inherited.model.capturedAt).toBe(legacy.createdAt);
      expect(legacy.defaultModel.capturedAt).toBe(capturedAt);
      const next = resolveProjectTaskModel(
        'novel',
        [
          item('explicit-3.8'),
          {
            ...item('inherited-legacy', 'novel', '2026-10-21'),
            createdAt: '2026-10-21',
            defaultModel: inherited.model,
          },
        ],
        () => model,
      );
      expect(next.model.modelId).toBe('model-3.8');
    }
  });
  it('compares selection instants across time zones and rejects wholly unreadable legacy times', () => {
    const selected = resolveProjectTaskModel(
      'novel',
      [
        {
          ...item('offset-3.7'),
          defaultModel: { ...model, modelId: 'model-3.7', capturedAt: '2026-10-16T01:00:00+08:00' },
        },
        item('later-utc-3.8'),
      ],
      () => model,
    );
    expect(selected.model.modelId).toBe('model-3.8');
    expect(() =>
      resolveProjectTaskModel(
        'novel',
        [{ ...item('invalid'), createdAt: 'invalid', defaultModel: { ...model, capturedAt: '' } }],
        () => model,
      ),
    ).toThrow('选择时间无法核对');
  });
  it('uses settings only when this project has no persisted choice', () => {
    expect(resolveProjectTaskModel('empty', [item('other')], () => model)).toEqual({
      model,
      sourceLabel: '使用 AI 设置中的默认模型',
    });
  });
  it('reads a project-specific later page before falling back to settings', async () => {
    const cursor = { updatedAt: '2026-10-15', conversationId: 'without-model' };
    fixture.list
      .mockResolvedValueOnce({
        items: [{ ...item('without-model'), defaultModel: undefined }],
        nextCursor: cursor,
      })
      .mockResolvedValueOnce({ items: [item('saved')] });
    const fallback = vi.fn(() => model);
    const saved = await loadProjectTaskModel('novel', fallback);
    expect(fixture.list.mock.calls.map((args) => args[0])).toEqual([
      { novelId: 'novel', archive: 'active', limit: 100, cursor: undefined },
      { novelId: 'novel', archive: 'active', limit: 100, cursor },
    ]);
    expect(saved.sourceLabel).toContain('saved');
    expect(fallback).not.toHaveBeenCalled();
  });
  it('does not replace an unreadable project selection with a global model', async () => {
    fixture.list.mockRejectedValueOnce(new Error('目录读取失败'));
    const fallback = vi.fn(() => model);
    await expect(loadProjectTaskModel('novel', fallback)).rejects.toThrow('目录读取失败');
    expect(fallback).not.toHaveBeenCalled();
  });
  it('scans later pages even when the first active page already contains a model', async () => {
    const cursor = { updatedAt: '2026-10-18', conversationId: 'old-active' };
    fixture.list
      .mockResolvedValueOnce({
        items: [
          {
            ...item('old-active', 'novel', cursor.updatedAt),
            defaultModel: { ...model, modelId: 'model-3.7', capturedAt: '2026-10-15T00:00:00Z' },
          },
        ],
        nextCursor: cursor,
      })
      .mockResolvedValueOnce({ items: [item('newest-choice')] });
    const fallback = vi.fn(() => model);
    const selected = await loadProjectTaskModel('novel', fallback);
    expect(selected.model.modelId).toBe('model-3.8');
    expect(selected.sourceLabel).toContain('newest-choice');
    expect(fixture.list).toHaveBeenCalledTimes(2);
    expect(fallback).not.toHaveBeenCalled();
  });
  it('does not use a partial first page when later project choices cannot be read', async () => {
    fixture.list
      .mockResolvedValueOnce({
        items: [item('first')],
        nextCursor: { updatedAt: '2026-10-15', conversationId: 'first' },
      })
      .mockRejectedValueOnce(new Error('后续页读取失败'));
    const fallback = vi.fn(() => model);
    await expect(loadProjectTaskModel('novel', fallback)).rejects.toThrow('后续页读取失败');
    expect(fallback).not.toHaveBeenCalled();
  });
  it('rejects a conversation repeated across pages rather than choosing from an unstable directory', async () => {
    fixture.list
      .mockResolvedValueOnce({
        items: [item('repeated')],
        nextCursor: { updatedAt: '2026-10-15', conversationId: 'repeated' },
      })
      .mockResolvedValueOnce({ items: [item('repeated')] });
    await expect(loadProjectTaskModel('novel', () => model)).rejects.toThrow('任务目录已变化');
  });
  it('rejects a nonadvancing page cursor rather than waiting indefinitely', async () => {
    const cursor = { updatedAt: '2026-10-15', conversationId: 'same' };
    fixture.list.mockResolvedValue({ items: [], nextCursor: cursor });
    await expect(loadProjectTaskModel('novel', () => model)).rejects.toThrow('未能推进');
    expect(fixture.list).toHaveBeenCalledTimes(2);
  });
});
