import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ToastProvider from '../../components/ToastProvider';
import LoadingModal from '../../components/common/LoadingModal';
import { showToast } from '../../utils/toast';
import {
  getActiveLoadingOperationCountForTests,
  runWithLoading,
  useGlobalLoadingModal,
} from '../../lib/runWithLoading';

function advance(milliseconds: number): void {
  act(() => {
    vi.advanceTimersByTime(milliseconds);
  });
}

function GlobalLoadingHarness() {
  const loading = useGlobalLoadingModal();
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
      autoCloseMs={loading.autoCloseMs}
      operationId={loading.operationId}
      onCancel={loading.onCancel}
      onClose={loading.closeModal}
    />
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-05T00:00:00.000Z'));
});

describe('toast reading time and notification queue', () => {
  it('dismisses an ordinary toast after four seconds of unpaused reading time', () => {
    render(
      <ToastProvider>
        <button>背景操作</button>
      </ToastProvider>,
    );
    act(() => showToast({ message: '草稿保存完成' }));
    advance(3999);
    expect(screen.getByText('草稿保存完成')).toBeTruthy();
    advance(1);
    expect(screen.queryByText('草稿保存完成')).toBeNull();
  });

  it('pauses while hovered and resumes only the remaining time', () => {
    render(
      <ToastProvider>
        <span>页面</span>
      </ToastProvider>,
    );
    act(() => showToast({ kind: 'success', message: '悬浮阅读此条提示' }));
    const toast = screen.getByTestId('success-notice');
    advance(1000);
    fireEvent.mouseEnter(toast);
    advance(20000);
    expect(screen.getByText('悬浮阅读此条提示')).toBeTruthy();
    fireEvent.mouseLeave(toast);
    advance(2999);
    expect(screen.getByText('悬浮阅读此条提示')).toBeTruthy();
    advance(1);
    expect(screen.queryByText('悬浮阅读此条提示')).toBeNull();
  });

  it('keeps keyboard focus and child focus paused, then resumes after focus leaves', () => {
    render(
      <ToastProvider>
        <button>继续创作</button>
      </ToastProvider>,
    );
    act(() => showToast({ message: '键盘正在阅读提示' }));
    const toast = screen.getByRole('status');
    advance(1500);
    act(() => toast.focus());
    advance(15000);
    expect(screen.getByText('键盘正在阅读提示')).toBeTruthy();
    act(() => within(toast).getByRole('button').focus());
    advance(15000);
    expect(screen.getByText('键盘正在阅读提示')).toBeTruthy();
    act(() => screen.getByRole('button', { name: '继续创作' }).focus());
    advance(2499);
    expect(screen.getByText('键盘正在阅读提示')).toBeTruthy();
    advance(1);
    expect(screen.queryByText('键盘正在阅读提示')).toBeNull();
  });

  it('does not resume a hovered toast just because keyboard focus has left it', () => {
    render(
      <ToastProvider>
        <button>后台按钮</button>
      </ToastProvider>,
    );
    act(() => showToast({ message: '两种阅读暂停共同生效' }));
    const toast = screen.getByRole('status');
    advance(1000);
    fireEvent.mouseEnter(toast);
    act(() => toast.focus());
    advance(10000);
    act(() => screen.getByRole('button', { name: '后台按钮' }).focus());
    advance(10000);
    expect(screen.getByText('两种阅读暂停共同生效')).toBeTruthy();
    fireEvent.mouseLeave(toast);
    advance(3000);
    expect(screen.queryByText('两种阅读暂停共同生效')).toBeNull();
  });

  it('keeps default errors, warnings and explicit duration-zero notices until dismissed', () => {
    render(
      <ToastProvider>
        <span>页面</span>
      </ToastProvider>,
    );
    act(() => {
      showToast({ kind: 'error', message: '保存失败，请处理磁盘问题' });
      showToast({ kind: 'warning', message: '发现待核对的来源' });
      showToast({ kind: 'info', durationMs: 0, message: '手动关闭此提醒' });
    });
    expect(vi.getTimerCount()).toBe(0);
    advance(60000);
    expect(screen.getByRole('alert').textContent).toContain('保存失败');
    expect(screen.getByText('发现待核对的来源')).toBeTruthy();
    expect(screen.getByText('手动关闭此提醒')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭通知：手动关闭此提醒' }));
    expect(screen.queryByText('手动关闭此提醒')).toBeNull();
    expect(screen.getByText('保存失败，请处理磁盘问题')).toBeTruthy();
  });

  it('queues more than three important errors without deleting them and reveals all on demand', () => {
    render(
      <ToastProvider>
        <span>页面</span>
      </ToastProvider>,
    );
    act(() => {
      for (let index = 1; index <= 5; index += 1) {
        showToast({ kind: 'error', message: `重要错误${index}` });
      }
    });
    expect(screen.getAllByRole('alert')).toHaveLength(3);
    expect(screen.queryByText('重要错误4')).toBeNull();
    advance(60000);
    fireEvent.click(screen.getByRole('button', { name: '还有 2 条通知，查看全部' }));
    expect(screen.getAllByRole('alert')).toHaveLength(5);
    expect(screen.getByRole('button', { name: '收起通知' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    for (let index = 1; index <= 5; index += 1)
      expect(screen.getByText(`重要错误${index}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '收起通知' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭通知：重要错误1' }));
    expect(screen.getByText('重要错误4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '还有 1 条通知，查看全部' }));
    expect(screen.getByText('重要错误5')).toBeTruthy();
  });
});

describe('single-owner loading result feedback', () => {
  it.each([800, 1200, 1500, 0])(
    'honors %ims with the real global state and only one timer',
    async (duration) => {
      render(<GlobalLoadingHarness />);
      await act(async () => {
        await runWithLoading(
          {
            title: '本地测试操作',
            successMessage: '任务已完成',
            successAutoCloseMs: duration,
            operationId: `notification-duration-${duration}`,
          },
          async () => 'synthetic result',
        );
      });
      expect(screen.getByRole('dialog', { name: '本地测试操作' })).toBeTruthy();
      expect(screen.getByText('任务已完成')).toBeTruthy();
      // Flush React/jsdom's zero-delay bookkeeping without consuming result reading time.
      advance(0);
      expect(vi.getTimerCount()).toBe(duration === 0 ? 0 : 1);
      if (duration === 0) {
        advance(60000);
        expect(screen.getByText('任务已完成')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: '完成' }));
      } else {
        advance(duration - 1);
        expect(screen.getByText('任务已完成')).toBeTruthy();
        advance(1);
      }
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(getActiveLoadingOperationCountForTests()).toBe(0);
    },
  );

  it('does not let an older result timer close a new running operation', async () => {
    render(<GlobalLoadingHarness />);
    await act(async () => {
      await runWithLoading(
        { title: '旧结果', operationId: 'notification-old', successAutoCloseMs: 800 },
        async () => undefined,
      );
    });
    advance(300);
    const gate = deferred<void>();
    let next!: Promise<void>;
    act(() => {
      next = runWithLoading(
        { title: '当前操作', operationId: 'notification-current', successAutoCloseMs: 1500 },
        () => gate.promise,
      );
    });
    expect(vi.getTimerCount()).toBe(0);
    advance(10000);
    expect(screen.getByRole('dialog', { name: '当前操作' })).toBeTruthy();
    await act(async () => {
      gate.resolve();
      await next;
    });
    expect(vi.getTimerCount()).toBe(1);
    advance(1499);
    expect(screen.getByRole('dialog', { name: '当前操作' })).toBeTruthy();
    advance(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('restarts a complete result interval when a success modal is reused for another identity', () => {
    const onClose = vi.fn();
    const view = render(
      <LoadingModal
        open
        state="success"
        title="旧结果"
        operationId="old-result"
        autoCloseMs={800}
        onClose={onClose}
      />,
    );
    advance(500);
    view.rerender(
      <LoadingModal
        open
        state="success"
        title="新结果"
        operationId="new-result"
        autoCloseMs={1500}
        onClose={onClose}
      />,
    );
    expect(vi.getTimerCount()).toBe(1);
    advance(1499);
    expect(onClose).not.toHaveBeenCalled();
    advance(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('pauses global success feedback while hovered without a second hook timer closing it', async () => {
    render(<GlobalLoadingHarness />);
    await act(async () => {
      await runWithLoading(
        { title: '正在阅读结果', operationId: 'notification-hover', successAutoCloseMs: 1500 },
        async () => undefined,
      );
    });
    const dialog = screen.getByRole('dialog', { name: '正在阅读结果' });
    advance(500);
    fireEvent.mouseEnter(dialog);
    advance(10000);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.mouseLeave(dialog);
    advance(999);
    expect(screen.getByRole('dialog')).toBeTruthy();
    advance(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('pauses success feedback while the user navigates its keyboard controls', () => {
    const onClose = vi.fn();
    render(
      <LoadingModal
        open
        state="success"
        title="键盘阅读"
        operationId="notification-keyboard"
        autoCloseMs={1200}
        onClose={onClose}
      />,
    );
    advance(400);
    const finish = screen.getByRole('button', { name: '完成' });
    fireEvent.keyDown(finish, { key: 'Tab', shiftKey: true });
    advance(10000);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(finish);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not auto-close an error, including one replacing an earlier success', async () => {
    render(<GlobalLoadingHarness />);
    await act(async () => {
      await runWithLoading(
        { title: '旧成功', operationId: 'notification-before-error', successAutoCloseMs: 800 },
        async () => undefined,
      );
    });
    advance(300);
    await act(async () => {
      await expect(
        runWithLoading({ title: '失败操作', operationId: 'notification-error' }, async () => {
          throw new Error('合成错误：存储不可用');
        }),
      ).rejects.toThrow('合成错误');
    });
    advance(60000);
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.getByRole('alertdialog', { name: '失败操作' })).toBeTruthy();
    expect(screen.getByText('合成错误：存储不可用')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(getActiveLoadingOperationCountForTests()).toBe(0);
  });

  it('uses only a spinner for unknown progress and only a bounded progress bar when known', () => {
    const view = render(<LoadingModal open title="处理中" percent={-1} />);
    expect(view.container.querySelectorAll('.loading-modal-spinner')).toHaveLength(1);
    expect(view.container.querySelector('.loading-modal-progress-indeterminate')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    view.rerender(<LoadingModal open title="处理中" percent={45} />);
    expect(view.container.querySelector('.loading-modal-spinner')).toBeNull();
    expect(
      screen.getByRole('progressbar', { name: '处理进度' }).getAttribute('aria-valuenow'),
    ).toBe('45');
    view.rerender(<LoadingModal open title="处理中" percent={140} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });
});
