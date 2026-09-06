import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiTaskRecord } from '../../types/ai';
import AiTasksPage from '../../pages/AiTasks/AiTasksPage';

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  deleteOne: vi.fn(),
  deleteMany: vi.fn(),
  clearAll: vi.fn(),
  getActiveExecutionState: vi.fn(),
  cancelActiveExecution: vi.fn(),
  confirmDanger: vi.fn(),
}));

vi.mock('../../services/ai/aiTaskService', () => ({ aiTaskService: mocks }));
vi.mock('../../utils/nativeDialog', () => ({ confirmDanger: mocks.confirmDanger }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function task(id: string, status: AiTaskRecord['status'] = 'succeeded'): AiTaskRecord {
  return {
    id,
    taskType: 'chapter_generate',
    status,
    inputSummary: `${id} 记录摘要`,
    createdAt: '2026-09-05T10:00:00.000Z',
    modelName: '隔离模型',
  };
}

function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AiTasksPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getAll.mockResolvedValue({ items: [], total: 0 });
  mocks.confirmDanger.mockResolvedValue(true);
  mocks.getActiveExecutionState.mockReturnValue('inactive');
  mocks.cancelActiveExecution.mockReturnValue('requested');
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AI task read-state and stale result safety', () => {
  it('keeps first-load failures distinct from an empty library and supports an explicit retry', async () => {
    const first = deferred<{ items: AiTaskRecord[]; total: number }>();
    mocks.getAll.mockReturnValueOnce(first.promise);
    renderPage();
    expect(screen.getByText('正在更新任务记录…')).toBeTruthy();
    expect(screen.queryByText('暂无 AI 任务记录')).toBeNull();
    await act(async () => first.reject(new Error('隔离读取失败')));
    expect(screen.getByText('任务记录读取失败')).toBeTruthy();
    expect(screen.queryByText('暂无 AI 任务记录')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('暂无 AI 任务记录')).toBeTruthy();
    expect(mocks.getAll).toHaveBeenCalledTimes(2);
  });

  it('retains the loaded page label and disables old-row selection while the next page is pending', async () => {
    const next = deferred<{ items: AiTaskRecord[]; total: number }>();
    mocks.getAll
      .mockResolvedValueOnce({ items: [task('page-1')], total: 100 })
      .mockReturnValueOnce(next.promise);
    renderPage();
    await screen.findByText('page-1 记录摘要');
    fireEvent.click(screen.getByRole('button', { name: '多选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择任务记录 page-1' }));
    expect(
      (screen.getByRole('button', { name: '删除选中（1）' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByText('page-1 记录摘要')).toBeTruthy();
    expect(screen.getByTestId('ai-tasks-stale-results').textContent).toContain('第 1 页');
    expect(screen.getByRole('navigation', { name: 'AI 任务分页' }).textContent).toContain(
      '上次结果：第 1 / 2 页',
    );
    const staleCheckbox = screen.getByRole('checkbox', {
      name: '选择任务记录 page-1',
    }) as HTMLInputElement;
    expect(staleCheckbox.disabled).toBe(true);
    expect((screen.getByRole('button', { name: '全选终态' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(staleCheckbox);
    fireEvent.click(screen.getByRole('button', { name: '全选终态' }));
    expect(screen.getByRole('button', { name: '删除选中（0）' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消选择' }));
    const deleteOld = screen.getByRole('button', {
      name: '删除任务记录 page-1',
    }) as HTMLButtonElement;
    expect(deleteOld.disabled).toBe(true);
    fireEvent.click(deleteOld);
    expect(mocks.confirmDanger).not.toHaveBeenCalled();
    await act(async () => next.resolve({ items: [task('page-2')], total: 100 }));
    expect(screen.queryByText('page-1 记录摘要')).toBeNull();
    expect(screen.getByText('page-2 记录摘要')).toBeTruthy();
    expect(screen.queryByTestId('ai-tasks-stale-results')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'AI 任务分页' }).textContent).toContain(
      '第 2 / 2 页',
    );
    expect(
      (screen.getByRole('button', { name: '删除任务记录 page-2' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('leaves failed-filter results readable but not deletable until the retry publishes its own result', async () => {
    const filtered = deferred<{ items: AiTaskRecord[]; total: number }>();
    mocks.getAll
      .mockResolvedValueOnce({ items: [task('old')], total: 1 })
      .mockReturnValueOnce(filtered.promise);
    renderPage();
    await screen.findByText('old 记录摘要');
    fireEvent.click(screen.getByRole('button', { name: '失败' }));
    await act(async () => filtered.reject(new Error('筛选读取失败')));
    expect(screen.getByText('old 记录摘要')).toBeTruthy();
    expect(screen.getByText('筛选读取失败')).toBeTruthy();
    expect(screen.queryByText('当前筛选没有匹配记录')).toBeNull();
    expect(
      (screen.getByRole('button', { name: /删除当前页的/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: '删除任务记录 old' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByTestId('ai-task-record'));
    expect(screen.getByText('任务 ID：')).toBeTruthy();
    const retry = deferred<{ items: AiTaskRecord[]; total: number }>();
    mocks.getAll.mockReturnValueOnce(retry.promise);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(screen.getByText('old 记录摘要')).toBeTruthy();
    await act(async () => retry.resolve({ items: [], total: 0 }));
    expect(screen.getByText('当前筛选没有匹配记录')).toBeTruthy();
    expect(screen.queryByText('old 记录摘要')).toBeNull();
    expect(mocks.deleteOne).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a delete confirmation if the displayed query changes before the user confirms', async () => {
    const confirmation = deferred<boolean>();
    const filtered = deferred<{ items: AiTaskRecord[]; total: number }>();
    mocks.confirmDanger.mockReturnValueOnce(confirmation.promise);
    mocks.getAll
      .mockResolvedValueOnce({ items: [task('old')], total: 1 })
      .mockReturnValueOnce(filtered.promise);
    renderPage();
    await screen.findByText('old 记录摘要');
    fireEvent.click(screen.getByRole('button', { name: '删除任务记录 old' }));
    fireEvent.click(screen.getByRole('button', { name: '失败' }));
    await act(async () => confirmation.resolve(true));
    expect(mocks.deleteOne).not.toHaveBeenCalled();
    expect(screen.getByText('列表已变化，未删除旧结果；请重新读取并选择记录。')).toBeTruthy();
    await act(async () => filtered.resolve({ items: [task('new', 'failed')], total: 1 }));
  });

  it('ignores a slower previous-filter response after the current filter has published', async () => {
    const failed = deferred<{ items: AiTaskRecord[]; total: number }>();
    const cancelled = deferred<{ items: AiTaskRecord[]; total: number }>();
    mocks.getAll
      .mockResolvedValueOnce({ items: [task('initial')], total: 1 })
      .mockReturnValueOnce(failed.promise)
      .mockReturnValueOnce(cancelled.promise);
    renderPage();
    await screen.findByText('initial 记录摘要');
    fireEvent.click(screen.getByRole('button', { name: '失败' }));
    fireEvent.click(screen.getByRole('button', { name: '已取消' }));
    await act(async () => cancelled.resolve({ items: [task('latest', 'cancelled')], total: 1 }));
    expect(screen.getByText('latest 记录摘要')).toBeTruthy();
    await act(async () => failed.resolve({ items: [task('stale', 'failed')], total: 1 }));
    expect(screen.queryByText('stale 记录摘要')).toBeNull();
    expect(screen.getByText('latest 记录摘要')).toBeTruthy();
    expect(screen.queryByTestId('ai-tasks-stale-results')).toBeNull();
  });

  it('prunes selection when a same-query refresh removes a previously selected row', async () => {
    vi.useFakeTimers();
    mocks.getAll
      .mockResolvedValueOnce({ items: [task('selected'), task('active', 'running')], total: 2 })
      .mockResolvedValueOnce({ items: [task('replacement'), task('active', 'running')], total: 2 });
    await act(async () => {
      renderPage();
    });
    fireEvent.click(screen.getByRole('button', { name: '多选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择任务记录 selected' }));
    expect(screen.getByRole('button', { name: '删除选中（1）' })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.queryByText('selected 记录摘要')).toBeNull();
    expect(screen.getByRole('button', { name: '删除选中（0）' })).toBeTruthy();
    expect(
      (screen.getByRole('checkbox', { name: '选择任务记录 replacement' }) as HTMLInputElement)
        .checked,
    ).toBe(false);
  });

  it('keeps errors visible after an older success timer and preserves stopping by original task identity', async () => {
    vi.useFakeTimers();
    const records = { items: [task('active', 'running'), task('finished')], total: 2 };
    mocks.getAll.mockResolvedValue(records);
    mocks.getActiveExecutionState.mockImplementation((id: string) =>
      id === 'active' ? 'active' : 'inactive',
    );
    mocks.deleteOne.mockRejectedValue(new Error('隔离删除失败'));
    await act(async () => {
      renderPage();
    });
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(mocks.cancelActiveExecution).toHaveBeenCalledWith('active');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '删除任务记录 finished' }));
    });
    expect(screen.getByText('删除失败：隔离删除失败')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(screen.getByText('删除失败：隔离删除失败')).toBeTruthy();
    const filter = deferred<{ items: AiTaskRecord[]; total: number }>();
    mocks.getAll.mockReturnValue(filter.promise);
    fireEvent.click(screen.getByRole('button', { name: '失败' }));
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(mocks.cancelActiveExecution).toHaveBeenLastCalledWith('active');
    expect(
      (screen.getByRole('button', { name: '删除任务记录 finished' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('retains explicit clear-all confirmation and resets page-scoped selection after success', async () => {
    mocks.getAll
      .mockResolvedValueOnce({ items: [task('one')], total: 1 })
      .mockResolvedValue({ items: [], total: 0 });
    mocks.clearAll.mockResolvedValue({ deletedCount: 1 });
    renderPage();
    await screen.findByText('one 记录摘要');
    fireEvent.click(screen.getByRole('button', { name: '多选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择任务记录 one' }));
    fireEvent.click(screen.getByRole('button', { name: '清空全部记录' }));
    await waitFor(() => expect(mocks.clearAll).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('暂无 AI 任务记录')).toBeTruthy();
    expect(mocks.confirmDanger).toHaveBeenCalledWith(
      expect.objectContaining({ title: '清空全部记录' }),
    );
    expect(screen.getByText('清理完成，已删除 1 条记录')).toBeTruthy();
  });
});
