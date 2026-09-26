import { useEffect, useRef } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HubLayout } from '../../components/layout/HubLayout';
import { useWorkbenchIntent } from '../../pages/Workbench/hooks/useWorkbenchIntent';
import { useWorkbenchFocus } from '../../components/layout/workbenchFocus';
import AppShell from '../../components/layout/AppShell';

vi.mock('../../components/sidebar/Sidebar', () => ({
  default: ({ compact }: { compact: boolean }) => (
    <aside aria-label="应用导航" data-compact={String(compact)} />
  ),
}));

describe('application shell', () => {
  beforeEach(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ai_novel_studio_sidebar_collapsed')) localStorage.removeItem(key);
    }
  });
  it.each([
    ['/novels/fixture/workspace', 'writing', 'true'],
    ['/novels/fixture/workspace/', 'writing', 'true'],
    ['/novels/fixture', 'standard', 'false'],
    ['/novels', 'standard', 'false'],
    ['/settings', 'hub', null],
    ['/styles', 'hub', null],
    ['/', 'workbench', null],
  ] as const)(
    'selects the scoped shell for %s and keeps the frame bar on every route',
    (route, layout, compact) => {
      render(
        <MemoryRouter initialEntries={[route]}>
          <AppShell>
            <p>route content</p>
          </AppShell>
        </MemoryRouter>,
      );
      expect(screen.getByTestId('app-shell').getAttribute('data-layout')).toBe(layout);
      expect(screen.getByTestId('app-frame-bar')).not.toBeNull();
      const sidebar = screen.queryByLabelText('应用导航');
      expect(sidebar?.getAttribute('data-compact') ?? null).toBe(compact);
      expect(screen.getByText('route content')).not.toBeNull();
    },
  );

  it('collapses the sidebar from the frame bar and remembers the choice', () => {
    localStorage.removeItem('ai_novel_studio_sidebar_collapsed');
    render(
      <MemoryRouter initialEntries={['/novels']}>
        <AppShell>
          <p>route content</p>
        </AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('应用导航')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
    expect(screen.queryByLabelText('应用导航')).toBeNull();
    expect(screen.getByTestId('app-shell').getAttribute('data-sidebar')).toBe('collapsed');
    expect(localStorage.getItem('ai_novel_studio_sidebar_collapsed')).toBe('1');
    localStorage.removeItem('ai_novel_studio_sidebar_collapsed');
  });
});
function SearchTarget() {
  const searchRef = useRef<HTMLInputElement>(null);
  const { focusMode, toggleFocusMode, exitFocusMode } = useWorkbenchFocus();
  const { searchFocusToken } = useWorkbenchIntent(() => undefined, exitFocusMode);
  useEffect(() => {
    if (searchFocusToken) searchRef.current?.focus();
  }, [searchFocusToken]);
  return (
    <aside className="workbench-tree" data-focus-mode={focusMode ? 'true' : 'false'}>
      <input ref={searchRef} aria-label="任务搜索测试" />
      <button type="button" data-testid="workbench-toggle-focus" onClick={toggleFocusMode}>
        专注
      </button>
    </aside>
  );
}

function ShellRoutes() {
  const navigate = useNavigate();
  return (
    <AppShell>
      <button onClick={() => navigate('/styles')}>测试资源路由</button>
      <button onClick={() => navigate('/')}>测试会话路由</button>
      <Routes>
        <Route
          path="/styles"
          element={
            <HubLayout>
              <p>资源内容</p>
            </HubLayout>
          }
        />
        <Route path="/" element={<SearchTarget />} />
      </Routes>
    </AppShell>
  );
}

describe('scoped sidebar preferences and search handoff', () => {
  beforeEach(() => localStorage.clear());

  it('keeps resource-center collapse independent from workbench navigation', () => {
    render(
      <MemoryRouter initialEntries={['/styles']}>
        <ShellRoutes />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('shell-toggle-sidebar'));
    expect(screen.getByTestId('app-shell').getAttribute('data-sidebar')).toBe('collapsed');
    expect(screen.getByTestId('shell-toggle-sidebar').getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem('ai_novel_studio_sidebar_collapsed:hub')).toBe('1');
    fireEvent.click(screen.getByText('测试会话路由'));
    expect(screen.getByTestId('app-shell').getAttribute('data-sidebar')).toBe('expanded');
    fireEvent.click(screen.getByText('测试资源路由'));
    expect(screen.getByTestId('app-shell').getAttribute('data-sidebar')).toBe('collapsed');
    fireEvent.click(screen.getByTestId('shell-toggle-sidebar'));
    expect(screen.getByTestId('app-shell').getAttribute('data-sidebar')).toBe('expanded');
  });

  it('does not consume a composing Ctrl+K as a navigation or focus request', () => {
    localStorage.setItem('ai_novel_studio_sidebar_collapsed:workbench', '1');
    render(
      <MemoryRouter initialEntries={['/']}>
        <ShellRoutes />
      </MemoryRouter>,
    );
    const outside = screen.getByText('测试资源路由');
    outside.focus();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true, keyCode: 229 });
    expect(document.activeElement).toBe(outside);
    expect(screen.getByTestId('app-shell').getAttribute('data-sidebar')).toBe('collapsed');
  });

  it.each(['/', '/styles'])(
    'reveals and focuses a collapsed workbench search from %s',
    async (route) => {
      localStorage.setItem('ai_novel_studio_sidebar_collapsed:workbench', '1');
      render(
        <MemoryRouter initialEntries={[route]}>
          <ShellRoutes />
        </MemoryRouter>,
      );
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByLabelText('任务搜索测试')),
      );
      expect(screen.getByTestId('app-shell').getAttribute('data-sidebar')).toBe('expanded');
      expect(localStorage.getItem('ai_novel_studio_sidebar_collapsed:workbench')).toBe('0');
    },
  );
});

describe('workbench session focus', () => {
  beforeEach(() => localStorage.clear());

  it('keeps a local focus fallback without a shell provider and does not write LocalStorage', () => {
    function Probe() {
      const { focusMode, toggleFocusMode } = useWorkbenchFocus();
      return (
        <button type="button" data-testid="workbench-toggle-focus" onClick={toggleFocusMode}>
          {focusMode ? 'on' : 'off'}
        </button>
      );
    }
    render(<Probe />);
    fireEvent.click(screen.getByTestId('workbench-toggle-focus'));
    expect(screen.getByTestId('workbench-toggle-focus').textContent).toBe('on');
    expect(localStorage.getItem('ai_novel_studio_sidebar_collapsed:workbench')).toBeNull();
  });

  it('collapses the tree during focus without writing the sidebar preference, and FrameBar expand exits focus', () => {
    localStorage.setItem('ai_novel_studio_sidebar_collapsed:workbench', '0');
    render(
      <MemoryRouter initialEntries={['/']}>
        <ShellRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('app-shell').getAttribute('data-sidebar')).toBe('expanded');
    fireEvent.click(screen.getByTestId('workbench-toggle-focus'));
    expect(screen.getByTestId('app-shell').getAttribute('data-focus-mode')).toBe('true');
    expect(screen.getByTestId('app-shell').getAttribute('data-sidebar')).toBe('collapsed');
    expect(screen.getByTestId('shell-toggle-sidebar').getAttribute('aria-label')).toBe('展开侧栏');
    expect(localStorage.getItem('ai_novel_studio_sidebar_collapsed:workbench')).toBe('0');
    fireEvent.click(screen.getByTestId('shell-toggle-sidebar'));
    expect(screen.getByTestId('app-shell').getAttribute('data-focus-mode')).toBe('false');
    expect(screen.getByTestId('app-shell').getAttribute('data-sidebar')).toBe('expanded');
    expect(localStorage.getItem('ai_novel_studio_sidebar_collapsed:workbench')).toBe('0');
  });

  it('exits focus then focuses search on Ctrl+K', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <ShellRoutes />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('workbench-toggle-focus'));
    expect(screen.getByTestId('app-shell').getAttribute('data-focus-mode')).toBe('true');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('任务搜索测试')));
    expect(screen.getByTestId('app-shell').getAttribute('data-focus-mode')).toBe('false');
    expect(screen.getByTestId('app-shell').getAttribute('data-sidebar')).toBe('expanded');
  });
});
