import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppShell from '../../components/layout/AppShell';

vi.mock('../../components/sidebar/Sidebar', () => ({
  default: ({ compact }: { compact: boolean }) => (
    <aside aria-label="应用导航" data-compact={String(compact)} />
  ),
}));

describe('application shell', () => {
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
