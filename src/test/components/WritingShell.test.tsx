import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppShell from '../../components/layout/AppShell';

vi.mock('../../components/sidebar/Sidebar', () => ({
  default: ({ compact }: { compact: boolean }) => (
    <aside aria-label="应用导航" data-compact={String(compact)} />
  ),
}));
vi.mock('../../components/topbar/TopBar', () => ({
  default: () => <header data-testid="shell-topbar">桌面顶部栏</header>,
}));

describe('writing shell', () => {
  it.each([
    ['/novels/fixture/workspace', 'writing', true, true],
    ['/novels/fixture/workspace/', 'writing', true, true],
    ['/novels/fixture', 'standard', false, true],
    ['/settings', 'standard', false, true],
    ['/', 'workbench', true, false],
  ] as const)(
    'selects the scoped shell for %s without dropping the writing topbar',
    (route, layout, compact, topbar) => {
      render(
        <MemoryRouter initialEntries={[route]}>
          <AppShell>
            <p>route content</p>
          </AppShell>
        </MemoryRouter>,
      );
      expect(screen.getByTestId('app-shell').getAttribute('data-layout')).toBe(layout);
      expect(screen.getByLabelText('应用导航').getAttribute('data-compact')).toBe(String(compact));
      expect(Boolean(screen.queryByTestId('shell-topbar'))).toBe(topbar);
    },
  );
});
