import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Sidebar from './Sidebar';

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}|{JSON.stringify(location.state)}
    </output>
  );
}

function renderSidebar(route: string, compact = false) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Sidebar compact={compact} />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('exposes workspace sections, the active project pages and an accessible current route', () => {
    renderSidebar('/novels/novel-1/outline');

    const navigation = screen.getByRole('navigation', { name: '全局导航' });
    expect(screen.getByLabelText('应用导航').getAttribute('data-compact')).toBe('false');
    expect(within(navigation).getAllByRole('link')).toHaveLength(10);

    const current = within(navigation).getByRole('link', { name: '大纲' });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.getAttribute('href')).toBe('/novels/novel-1/outline');
    expect(
      within(navigation).getByRole('link', { name: '项目' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(navigation).getByRole('link', { name: '会话' }).getAttribute('aria-current'),
    ).toBe(null);

    const icons = navigation.querySelectorAll('.nav-icon svg');
    expect(icons).toHaveLength(10);
    icons.forEach((icon) => {
      expect(icon.getAttribute('width')).toBe('18');
      expect(icon.getAttribute('stroke-width')).toBe('1.8');
      expect(icon.getAttribute('fill')).toBe('none');
    });
  });

  it('keeps only the workspace entries outside a project and hands quick actions to the workbench', () => {
    renderSidebar('/novels');

    const navigation = screen.getByRole('navigation', { name: '全局导航' });
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['会话', '项目', '资源中心']);

    fireEvent.click(screen.getByRole('button', { name: '新建创作任务' }));
    expect(screen.getByTestId('location').textContent).toBe('/|{"workbenchIntent":"new-task"}');
  });

  it('collapses to an icon rail without quick actions or labels', () => {
    renderSidebar('/novels/novel-1/workspace', true);

    expect(screen.getByLabelText('应用导航').getAttribute('data-compact')).toBe('true');
    expect(screen.queryByRole('group', { name: '快捷操作' })).toBeNull();
    expect(screen.getByRole('link', { name: '章节审阅' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });
});
