import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Sidebar from './Sidebar';

describe('Sidebar', () => {
  it('renders a compact icon rail with an accessible current route', () => {
    render(
      <MemoryRouter initialEntries={['/novels/novel-1']}>
        <Sidebar compact />
      </MemoryRouter>,
    );

    const navigation = screen.getByRole('navigation', { name: '全局导航' });
    const currentLink = within(navigation).getByRole('link', { name: '小说作品' });

    expect(screen.getByLabelText('应用导航').getAttribute('data-compact')).toBe('true');
    expect(currentLink.getAttribute('aria-current')).toBe('page');
    expect(currentLink.getAttribute('title')).toBe('小说作品');
    expect(within(navigation).getAllByRole('link')).toHaveLength(8);
    expect(navigation.querySelectorAll('.nav-icon svg')).toHaveLength(8);
  });
});
