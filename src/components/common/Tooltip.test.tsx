import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens on hover and focus, keeps one disclosure visible and closes on Escape', () => {
    vi.useFakeTimers();
    render(
      <>
        <Tooltip content="第一个完整标题">
          <button type="button">第一个触发点</button>
        </Tooltip>
        <Tooltip content="第二个完整标题">
          <button type="button">第二个触发点</button>
        </Tooltip>
      </>,
    );
    const first = screen.getByRole('button', { name: '第一个触发点' });
    const second = screen.getByRole('button', { name: '第二个触发点' });

    fireEvent.mouseEnter(first);
    act(() => vi.advanceTimersByTime(200));
    const firstTooltip = screen.getByRole('tooltip');
    expect(firstTooltip.textContent).toBe('第一个完整标题');
    expect(first.getAttribute('aria-describedby')).toBe(firstTooltip.id);

    fireEvent.focus(second);
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    expect(screen.getByRole('tooltip').textContent).toBe('第二个完整标题');
    expect(second.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(second.getAttribute('aria-describedby')).toBeNull();
  });
});
