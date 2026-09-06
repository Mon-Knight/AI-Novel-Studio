import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TaskConversation } from '../../types/conversation';
import { taskConversationService } from '../../services/conversation/taskConversationService';
import { useWorkbenchConversationDirectory } from './useWorkbenchConversationDirectory';

vi.mock('../../services/conversation/taskConversationService', () => ({
  taskConversationService: { listPage: vi.fn() },
}));
vi.mock('../../services/startup/startupCoordinator', () => ({
  startupCoordinator: { waitForConversationRecovery: vi.fn(async () => undefined) },
}));

const row = (id: string): TaskConversation => ({
  conversationId: id,
  novelId: 'novel-test',
  title: id,
  status: 'idle',
  createdAt: '2026-09-05',
  updatedAt: '2026-09-05',
});
const list = vi.mocked(taskConversationService.listPage);
beforeEach(() => {
  vi.useFakeTimers();
  list.mockReset();
});
afterEach(() => vi.useRealTimers());

it('coalesces typed queries while retaining the previous directory until the new result arrives', async () => {
  list.mockResolvedValueOnce({ items: [row('原任务')] });
  const { result } = renderHook(() => useWorkbenchConversationDirectory(vi.fn()));
  await act(async () => {
    await result.current.refresh();
  });
  let resolve!: (page: { items: TaskConversation[] }) => void;
  list.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => {
    result.current.setQuery('新');
    result.current.setQuery('新的');
    result.current.setQuery('新的任务');
  });
  expect(result.current.items[0].title).toBe('原任务');
  expect(result.current.query).toBe('新的任务');
  expect(result.current.displayQuery).toBe('');
  expect(result.current.loading).toBe(true);
  expect(list).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(list).toHaveBeenCalledTimes(2);
  expect(list.mock.calls[1][0]?.query).toBe('新的任务');
  expect(result.current.items[0].title).toBe('原任务');
  await act(async () => resolve({ items: [row('新的任务')] }));
  expect(result.current.items[0].title).toBe('新的任务');
  expect(result.current.displayQuery).toBe('新的任务');
  expect(result.current.loading).toBe(false);
});

it('invalidates an older request during the debounce gap so it cannot revive an obsolete query', async () => {
  list.mockResolvedValueOnce({ items: [row('初始')] });
  const { result } = renderHook(() => useWorkbenchConversationDirectory(vi.fn()));
  await act(async () => {
    await result.current.refresh();
  });
  let oldResolve!: (page: { items: TaskConversation[] }) => void;
  list.mockImplementationOnce(
    () =>
      new Promise((done) => {
        oldResolve = done;
      }),
  );
  act(() => result.current.setQuery('旧查询'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  act(() => result.current.setQuery('新查询'));
  await act(async () => oldResolve({ items: [row('过期结果')] }));
  expect(result.current.items[0].title).toBe('初始');
  expect(result.current.loading).toBe(true);
  list.mockResolvedValueOnce({ items: [row('最新结果')] });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(result.current.items[0].title).toBe('最新结果');
  expect(result.current.displayQuery).toBe('新查询');
});

it('retains old rows on query failure with an explicit error, and cancels queued queries on unmount', async () => {
  list.mockResolvedValueOnce({ items: [row('保留的任务')] });
  const view = renderHook(() => useWorkbenchConversationDirectory(vi.fn()));
  await act(async () => {
    await view.result.current.refresh();
  });
  list.mockRejectedValueOnce(new Error('隔离查询失败'));
  act(() => view.result.current.setQuery('失败查询'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(view.result.current.items[0].title).toBe('保留的任务');
  expect(view.result.current.error).toBe('隔离查询失败');
  expect(view.result.current.loading).toBe(false);
  act(() => view.result.current.setQuery('卸载后的查询'));
  view.unmount();
  await vi.advanceTimersByTimeAsync(200);
  expect(list).toHaveBeenCalledTimes(2);
});
