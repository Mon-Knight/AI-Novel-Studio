import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const chromeHarness = vi.hoisted(() => ({
  native: false,
  maximized: false,
  resizedListener: undefined as (() => void) | undefined,
  minimize: vi.fn(async () => undefined),
  toggleMaximize: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
  unlisten: vi.fn(),
}));

vi.mock('../../services/tauri/runtime', () => ({
  isTauriRuntime: () => chromeHarness.native,
}));

vi.mock('@tauri-apps/api/window', () => ({
  appWindow: {
    isMaximized: async () => chromeHarness.maximized,
    onResized: async (listener: () => void) => {
      chromeHarness.resizedListener = listener;
      return chromeHarness.unlisten;
    },
    minimize: chromeHarness.minimize,
    toggleMaximize: chromeHarness.toggleMaximize,
    close: chromeHarness.close,
  },
}));

vi.mock('../../components/sidebar/Sidebar', () => ({
  default: () => <aside aria-label="应用导航" />,
}));

const { default: AppShell } = await import('../../components/layout/AppShell');

function renderShell(route = '/novels') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppShell>
        <p>route content</p>
      </AppShell>
    </MemoryRouter>,
  );
}

describe('frame bar window chrome', () => {
  afterEach(() => {
    chromeHarness.native = false;
    chromeHarness.maximized = false;
    chromeHarness.resizedListener = undefined;
    vi.clearAllMocks();
  });

  it('renders no window controls in browser mode and keeps the frame bar draggable-only', () => {
    renderShell();
    expect(screen.queryByRole('group', { name: '窗口控制' })).toBeNull();
    expect(screen.getByTestId('app-shell').getAttribute('data-window-frame')).toBe('browser');
    expect(screen.getByTestId('app-frame-bar').hasAttribute('data-tauri-drag-region')).toBe(true);
  });

  it('owns minimize, maximize and close for the undecorated Tauri window', async () => {
    chromeHarness.native = true;
    renderShell();
    const shell = screen.getByTestId('app-shell');
    expect(shell.getAttribute('data-window-frame')).toBe('custom');
    await waitFor(() => expect(chromeHarness.resizedListener).toBeTypeOf('function'));

    fireEvent.click(screen.getByRole('button', { name: '最小化' }));
    await waitFor(() => expect(chromeHarness.minimize).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: '最大化' }));
    await waitFor(() => expect(chromeHarness.toggleMaximize).toHaveBeenCalledOnce());

    chromeHarness.maximized = true;
    await act(async () => chromeHarness.resizedListener?.());
    await waitFor(() => expect(shell.getAttribute('data-window-maximized')).toBe('true'));
    expect(screen.getByRole('button', { name: '还原' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(chromeHarness.close).toHaveBeenCalledOnce());
  });

  it('keeps interactive frame bar controls outside the drag region', () => {
    chromeHarness.native = true;
    renderShell();
    for (const name of ['收起侧栏', '资源中心与设置', '最小化', '最大化', '关闭']) {
      expect(screen.getByRole('button', { name }).hasAttribute('data-tauri-drag-region')).toBe(
        false,
      );
    }
    expect(screen.getByRole('link', { name: /会话/ }).hasAttribute('data-tauri-drag-region')).toBe(
      false,
    );
  });
});
