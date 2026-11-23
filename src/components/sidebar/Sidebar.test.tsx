import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useThemeStore } from '../../store/themeStore';
import Sidebar from './Sidebar';

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}|{JSON.stringify(location.state)}
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
  it('exposes only project sections and the active project pages without session or hub duplicates', () => {
    renderSidebar('/novels/novel-1/outline');

    const navigation = screen.getByRole('navigation', { name: '全局导航' });
    expect(screen.getByLabelText('应用导航').getAttribute('data-compact')).toBe('false');
    expect(screen.queryByRole('group', { name: '快捷操作' })).toBeNull();
    expect(within(navigation).queryByRole('link', { name: '会话' })).toBeNull();
    expect(within(navigation).queryByRole('link', { name: '资源中心' })).toBeNull();
    expect(within(navigation).getAllByRole('link')).toHaveLength(8);

    const current = within(navigation).getByRole('link', { name: '大纲' });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.getAttribute('href')).toBe('/novels/novel-1/outline');
    expect(
      within(navigation).getByRole('link', { name: '项目库' }).getAttribute('aria-current'),
    ).toBeNull();

    const icons = navigation.querySelectorAll('.nav-icon svg');
    expect(icons).toHaveLength(8);
    icons.forEach((icon) => {
      expect(icon.getAttribute('width')).toBe('18');
      expect(icon.getAttribute('stroke-width')).toBe('1.8');
      expect(icon.getAttribute('fill')).toBe('none');
    });
  });

  it('keeps only the project library entry when viewing the project list', () => {
    renderSidebar('/novels');

    const navigation = screen.getByRole('navigation', { name: '全局导航' });
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['项目库']);
    expect(
      within(navigation).getByRole('link', { name: '项目库' }).getAttribute('aria-current'),
    ).toBe('page');
  });

  it('collapses to an icon rail without quick actions or labels', () => {
    renderSidebar('/novels/novel-1/workspace', true);

    expect(screen.getByLabelText('应用导航').getAttribute('data-compact')).toBe('true');
    expect(screen.queryByRole('group', { name: '快捷操作' })).toBeNull();
    expect(screen.getByRole('link', { name: '章节审阅' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('opens an upward user-center popover from AI Novel Studio, switches theme, and navigates', () => {
    useThemeStore.getState().setPreference('system');
    renderSidebar('/novels');

    const trigger = screen.getByTestId('sidebar-user-menu-trigger');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);

    const popover = screen.getByTestId('sidebar-user-menu');
    expect(popover.getAttribute('role')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByTestId('sidebar-theme-dark'));
    expect(useThemeStore.getState().preference).toBe('dark');

    fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
    expect(screen.queryByTestId('sidebar-user-menu')).not.toBeNull();

    fireEvent.click(within(popover).getByRole('button', { name: 'AI 模型配置' }));
    expect(screen.queryByTestId('sidebar-user-menu')).toBeNull();
    expect(screen.getByTestId('location').textContent).toBe('/settings?tab=ai_models|null');
  });
});
