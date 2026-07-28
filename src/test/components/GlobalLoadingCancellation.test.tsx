import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import LoadingModal from '../../components/common/LoadingModal';
import {
  getActiveLoadingOperationCountForTests,
  runWithLoading,
  useGlobalLoadingModal,
} from '../../lib/runWithLoading';

function LoadingHarness() {
  const loading = useGlobalLoadingModal(0);
  return (
    <LoadingModal
      open={loading.open}
      state={loading.state}
      title={loading.title}
      message={loading.message}
      stage={loading.stage}
      percent={loading.percent}
      cancelable={loading.cancelable}
      errorMessage={loading.errorMessage}
      autoCloseMs={0}
      onCancel={loading.onCancel}
      onClose={loading.closeModal}
    />
  );
}

describe('global loading cancellation', () => {
  it('binds the cancel button to the task AbortSignal and waits for safe settlement', async () => {
    render(<LoadingHarness />);
    let observedSignal: AbortSignal | undefined;
    const task = runWithLoading(
      {
        title: '可取消 AI 请求',
        cancelable: true,
        operationId: 'cancel-test',
        successAutoCloseMs: 0,
      },
      async ({ signal }) => {
        observedSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('cancelled', 'AbortError')),
            { once: true },
          );
        });
        return 'unexpected';
      },
    );
    const outcome = task.then(
      () => ({ status: 'fulfilled' as const, error: undefined }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );

    await userEvent.click(await screen.findByRole('button', { name: '取消' }));

    await expect(outcome).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'AI_REQUEST_CANCELLED' },
    });
    expect(observedSignal?.aborted).toBe(true);
    expect(await screen.findByText('操作已取消')).toBeTruthy();
    expect(getActiveLoadingOperationCountForTests()).toBe(0);
  });

  it('discards a successful return that arrives after cancellation', async () => {
    render(<LoadingHarness />);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = runWithLoading(
      {
        title: '迟到完成请求',
        cancelable: true,
        operationId: 'late-completion-test',
        successAutoCloseMs: 0,
      },
      async () => {
        await gate;
        return 'late result';
      },
    );
    const outcome = task.then(
      () => ({ status: 'fulfilled' as const, error: undefined }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );

    await userEvent.click(await screen.findByRole('button', { name: '取消' }));
    expect(screen.getByText('正在停止当前任务…')).toBeTruthy();
    release?.();

    await expect(outcome).resolves.toMatchObject({
      status: 'rejected',
      error: { code: 'AI_REQUEST_CANCELLED' },
    });
    expect(screen.queryByText('操作完成')).toBeNull();
    expect(getActiveLoadingOperationCountForTests()).toBe(0);
  });

  it('ignores terminal events from an older overlapping operation', async () => {
    render(<LoadingHarness />);
    let finishOld: (() => void) | undefined;
    let finishCurrent: (() => void) | undefined;
    const oldTask = runWithLoading(
      { title: '旧操作', operationId: 'old-operation', successAutoCloseMs: 0 },
      async () => {
        await new Promise<void>((resolve) => {
          finishOld = resolve;
        });
      },
    );
    const currentTask = runWithLoading(
      { title: '当前操作', operationId: 'current-operation', successAutoCloseMs: 0 },
      async () => {
        await new Promise<void>((resolve) => {
          finishCurrent = resolve;
        });
      },
    );

    expect(await screen.findByText('当前操作')).toBeTruthy();
    finishOld?.();
    await oldTask;
    expect(screen.getByText('当前操作')).toBeTruthy();

    finishCurrent?.();
    await currentTask;
    expect(await screen.findByText('操作完成')).toBeTruthy();
    expect(getActiveLoadingOperationCountForTests()).toBe(0);
  });
});
