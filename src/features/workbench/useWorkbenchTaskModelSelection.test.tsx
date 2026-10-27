import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskConversation, TaskModelSnapshot } from '../../types/conversation';
import type { CurrentPluginProjection } from '../../services/conversation/currentPluginService';
import { useWorkbenchTaskModelSelection } from './useWorkbenchTaskModelSelection';
import { saveAiSettings } from '../../services/ai/aiSettingsStore';

const fixture = vi.hoisted(() => ({ update: vi.fn(), capture: vi.fn() }));
vi.mock('../../services/conversation/taskConversationService', () => ({
  taskConversationService: { updateDefaultModel: fixture.update },
}));
vi.mock('../../services/conversation/taskModelSnapshot', () => ({
  captureTaskModelSnapshot: fixture.capture,
}));

const model = (modelId: string): TaskModelSnapshot => ({
  providerId: 'mock',
  modelId,
  runtimeMode: 'mock',
  capabilities: [],
  options: {},
  capturedAt: '2026-10-13T00:00:00Z',
});
const conversation = (conversationId: string, defaultModel = model('A')): TaskConversation => ({
  conversationId,
  novelId: 'novel',
  title: conversationId,
  status: 'idle',
  defaultModel,
  createdAt: '2026-10-13T00:00:00Z',
  updatedAt: '2026-10-13T01:00:00Z',
});
const plugins: CurrentPluginProjection[] = ['A', 'B'].map((name) => ({
  id: `model:mock:${name}`,
  name,
  category: 'model',
  source: 'runtime-registry',
  version: '1',
  description: '',
  status: 'loaded',
  availability: 'available',
  initialization: 'initialized',
  health: 'healthy',
  capabilities: [],
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function setup(disabled = false) {
  const ref = { current: 'task-a' };
  const onPersisted = vi.fn();
  const input = {
    conversationId: 'task-a',
    conversationRef: ref,
    selectedModel: model('A'),
    disabled,
    plugins,
    pluginsLoading: false,
    pluginsError: '',
    onPersisted,
  };
  return { ref, onPersisted, input };
}

describe('same-task next-turn model persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    fixture.capture.mockImplementation((_provider: string, id: string) => model(id));
    fixture.update.mockImplementation(async (id: string, snapshot: TaskModelSnapshot) =>
      conversation(id, snapshot),
    );
  });

  it('publishes only a successful save and synchronously blocks duplicate selection/submission', async () => {
    const save = deferred<TaskConversation>();
    fixture.update.mockReturnValue(save.promise);
    const { input, onPersisted } = setup();
    const hook = renderHook(useWorkbenchTaskModelSelection, { initialProps: input });
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.changeModel('mock:B');
    });
    expect(hook.result.current.modelChangePending).toBe(true);
    expect(hook.result.current.isChangingModel()).toBe(true);
    expect(input.selectedModel.modelId).toBe('A');
    expect(onPersisted).not.toHaveBeenCalled();
    await act(async () => {
      await hook.result.current.changeModel('mock:A');
    });
    expect(fixture.update).toHaveBeenCalledTimes(1);
    const updated = conversation('task-a', model('B'));
    await act(async () => {
      save.resolve(updated);
      await pending;
    });
    expect(onPersisted).toHaveBeenCalledExactlyOnceWith(updated);
    expect(hook.result.current.modelChangePending).toBe(false);
    expect(hook.result.current.isChangingModel()).toBe(false);
  });

  it('keeps the prior selection on save failure and permits an explicit retry', async () => {
    fixture.update.mockRejectedValueOnce(new Error('模型保存失败'));
    const { input, onPersisted } = setup();
    const hook = renderHook(useWorkbenchTaskModelSelection, { initialProps: input });
    await act(async () => {
      await hook.result.current.changeModel('mock:B');
    });
    expect(onPersisted).not.toHaveBeenCalled();
    expect(input.selectedModel.modelId).toBe('A');
    expect(hook.result.current.modelChangeError).toBe('模型保存失败');
    await act(async () => {
      await hook.result.current.changeModel('mock:B');
    });
    expect(onPersisted.mock.calls[0][0].defaultModel.modelId).toBe('B');
    expect(hook.result.current.modelChangeError).toBe('');
  });

  it('does not surface an old task failure after navigating away and back', async () => {
    const save = deferred<TaskConversation>();
    fixture.update.mockReturnValue(save.promise);
    const { input, ref, onPersisted } = setup();
    const hook = renderHook(useWorkbenchTaskModelSelection, { initialProps: input });
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.changeModel('mock:B');
    });
    ref.current = 'task-b';
    hook.rerender({ ...input, conversationId: 'task-b' });
    expect(hook.result.current.modelChangePending).toBe(false);
    expect(hook.result.current.isChangingModel()).toBe(false);
    ref.current = 'task-a';
    hook.rerender(input);
    expect(hook.result.current.modelChangePending).toBe(true);
    await act(async () => {
      save.reject(new Error('旧任务异步失败'));
      await pending;
    });
    expect(hook.result.current.modelChangeError).toBe('');
    expect(onPersisted).not.toHaveBeenCalled();
  });

  it('publishes a late successful save with its original task identity, not the newly selected task', async () => {
    const save = deferred<TaskConversation>();
    fixture.update.mockReturnValue(save.promise);
    const { input, ref, onPersisted } = setup();
    const hook = renderHook(useWorkbenchTaskModelSelection, { initialProps: input });
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.changeModel('mock:B');
    });
    ref.current = 'task-b';
    hook.rerender({ ...input, conversationId: 'task-b' });
    await act(async () => {
      save.resolve(conversation('task-a', model('B')));
      await pending;
    });
    expect(onPersisted.mock.calls[0][0].conversationId).toBe('task-a');
    expect(hook.result.current.modelChangePending).toBe(false);
    expect(hook.result.current.modelChangeError).toBe('');
  });

  it.each([{ disabled: true }, { pluginsLoading: true }])(
    'fails closed before saving when task or directory is busy: %o',
    async (override) => {
      const { input } = setup();
      const hook = renderHook(useWorkbenchTaskModelSelection, {
        initialProps: { ...input, ...override },
      });
      await act(async () => {
        await hook.result.current.changeModel('mock:B');
      });
      expect(fixture.update).not.toHaveBeenCalled();
    },
  );

  it('permits explicit selection despite the old model directory error, without authorizing a run', async () => {
    const { input, onPersisted } = setup();
    const hook = renderHook(useWorkbenchTaskModelSelection, {
      initialProps: { ...input, pluginsError: '旧模型目录失败' },
    });
    await act(async () => {
      await hook.result.current.changeModel('mock:B');
    });
    expect(onPersisted.mock.calls[0][0].defaultModel.modelId).toBe('B');
    expect(fixture.update).toHaveBeenCalledTimes(1);
  });

  it('persists configured API B even when only old A is in the task runtime directory', async () => {
    saveAiSettings({
      runtimeMode: 'api',
      provider: 'openai_compatible',
      baseUrl: 'https://configured.invalid/v1',
      modelName: 'API-B',
      apiKey: '',
      mockMode: false,
    });
    const { input, onPersisted } = setup();
    const hook = renderHook(useWorkbenchTaskModelSelection, { initialProps: input });
    await act(async () => {
      await hook.result.current.changeModel('openai_compatible:API-B');
    });
    expect(fixture.capture).toHaveBeenCalledWith('openai_compatible', 'API-B');
    expect(onPersisted.mock.calls[0][0].defaultModel.modelId).toBe('API-B');
  });

  it('rejects a forged directory selection and reports an unconfigured exact model without saving', async () => {
    const { input } = setup();
    const hook = renderHook(useWorkbenchTaskModelSelection, { initialProps: input });
    await act(async () => {
      await hook.result.current.changeModel('mock:forged');
    });
    expect(fixture.capture).not.toHaveBeenCalled();
    fixture.capture.mockImplementationOnce(() => {
      throw new Error('所选模型尚未配置 endpoint');
    });
    await act(async () => {
      await hook.result.current.changeModel('mock:B');
    });
    expect(hook.result.current.modelChangeError).toContain('尚未配置');
    expect(fixture.update).not.toHaveBeenCalled();
    expect(hook.result.current.modelChangePending).toBe(false);
  });
});
