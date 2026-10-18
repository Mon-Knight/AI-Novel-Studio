import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskModelSnapshot } from '../../../types/conversation';
import { useWorkbenchTaskCreator } from './useWorkbenchTaskCreator';

const fixture = vi.hoisted(() => ({ load: vi.fn(), capture: vi.fn() }));
vi.mock('../../../services/conversation/projectTaskModel', () => ({
  loadProjectTaskModel: fixture.load,
}));
vi.mock('../../../services/conversation/taskModelSnapshot', () => ({
  captureTaskModelSnapshot: fixture.capture,
}));
const model = (modelId: string): TaskModelSnapshot => ({
  providerId: 'configured',
  modelId,
  runtimeMode: 'api',
  baseUrl: `https://${modelId}.example/v1`,
  capabilities: [],
  options: { temperature: 0.7 },
  capturedAt: '2026-10-16',
});
const inherited = { model: model('project'), sourceLabel: '沿用本作品最近会话' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function input() {
  return {
    selectedNovelId: 'novel',
    chapters: [],
    creatingTask: false,
    contextPending: false,
    contextFailed: false,
    submissionRef: { current: false },
    initialGoal: '先聊聊小说构思',
    chapterId: '',
    setOpen: vi.fn(),
    onCreated: vi.fn(),
    selectChapter: vi.fn().mockResolvedValue(undefined),
    validateModelForSend: vi.fn(async (value: TaskModelSnapshot) => value),
    createTask: vi
      .fn()
      .mockResolvedValue({
        conversation: { conversationId: 'task', novelId: 'novel' },
        turn: { turnId: 'turn' },
      }),
    startInitializedTask: vi.fn().mockResolvedValue(undefined),
  };
}

describe('new task project model lookup', () => {
  beforeEach(() => {
    fixture.capture.mockImplementation((_provider?: string, id?: string) => model(id ?? 'global'));
    fixture.load.mockResolvedValue(inherited);
  });
  it('blocks creation until lookup settles and submits the exact inherited snapshot only on explicit send', async () => {
    const lookup = deferred<typeof inherited>();
    fixture.load.mockReturnValue(lookup.promise);
    const props = input();
    const { result } = renderHook(useWorkbenchTaskCreator, { initialProps: props });
    act(() => result.current.open());
    expect(result.current.formProps.modelPending).toBe(true);
    expect(result.current.formProps.creating).toBe(false);
    act(() => result.current.formProps.onSubmit());
    expect(props.createTask).not.toHaveBeenCalled();
    expect(props.startInitializedTask).not.toHaveBeenCalled();
    await act(async () => {
      lookup.resolve(inherited);
      await lookup.promise;
    });
    expect(result.current.model).toEqual(inherited.model);
    expect(result.current.formProps.modelUnresolved).toBe(false);
    expect(props.createTask).not.toHaveBeenCalled();
    await act(async () => result.current.formProps.onSubmit());
    await waitFor(() =>
      expect(props.createTask).toHaveBeenCalledExactlyOnceWith('先聊聊小说构思', inherited.model),
    );
    expect(props.startInitializedTask).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ modelSnapshot: inherited.model, conversationId: 'task' }),
    );
  });
  it('cancels a pending lookup on close without creating a conversation or changing its later selection', async () => {
    const lookup = deferred<typeof inherited>();
    fixture.load.mockReturnValue(lookup.promise);
    const props = input();
    const { result } = renderHook(useWorkbenchTaskCreator, { initialProps: props });
    act(() => result.current.open('保留准备目标'));
    act(() => result.current.formProps.onCancel());
    expect(props.setOpen).toHaveBeenLastCalledWith(false);
    await act(async () => {
      lookup.resolve(inherited);
      await lookup.promise;
    });
    expect(result.current.model.modelId).toBe('global');
    expect(props.createTask).not.toHaveBeenCalled();
  });
  it('ignores the old project result even when it arrives after the new project lookup', async () => {
    const old = deferred<typeof inherited>();
    fixture.load
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ model: model('new-project'), sourceLabel: '新作品' });
    const props = input();
    const { result, rerender } = renderHook(useWorkbenchTaskCreator, { initialProps: props });
    act(() => result.current.open());
    rerender({ ...props, selectedNovelId: 'new-novel' });
    expect(props.setOpen).toHaveBeenLastCalledWith(false);
    await act(async () => result.current.open());
    await waitFor(() => expect(result.current.model.modelId).toBe('new-project'));
    await act(async () => {
      old.resolve(inherited);
      await old.promise;
    });
    expect(result.current.model.modelId).toBe('new-project');
    expect(props.createTask).not.toHaveBeenCalled();
  });
  it('preserves the entered goal on read failure and deliberate retry, without silently using the global model', async () => {
    fixture.load.mockRejectedValueOnce(new Error('目录暂不可读')).mockResolvedValueOnce(inherited);
    const props = input();
    const { result } = renderHook(useWorkbenchTaskCreator, { initialProps: props });
    await act(async () => result.current.open('已经写好的要求'));
    await waitFor(() => expect(result.current.formProps.error).toBe('目录暂不可读'));
    act(() => result.current.formProps.onSubmit());
    expect(props.createTask).not.toHaveBeenCalled();
    await act(async () => result.current.formProps.onRetryModelSource());
    await waitFor(() => expect(result.current.formProps.modelUnresolved).toBe(false));
    expect(result.current.formProps.goal).toBe('已经写好的要求');
    expect(result.current.model).toEqual(inherited.model);
    expect(props.createTask).not.toHaveBeenCalled();
  });
  it('allows an explicit configured model selection after lookup failure', async () => {
    fixture.load.mockRejectedValueOnce(new Error('目录暂不可读'));
    const props = input();
    const { result } = renderHook(useWorkbenchTaskCreator, { initialProps: props });
    await act(async () => result.current.open());
    await waitFor(() => expect(result.current.formProps.error).toBe('目录暂不可读'));
    act(() => result.current.formProps.onModelChange('configured:manual'));
    expect(result.current.formProps.modelUnresolved).toBe(false);
    expect(result.current.model).toEqual(model('manual'));
    expect(result.current.formProps.error).toBe('');
    expect(props.createTask).not.toHaveBeenCalled();
  });
});
