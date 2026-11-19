import { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkbenchOverlayInset } from './useWorkbenchOverlayInset';

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  useWorkbenchOverlayInset(ref, 'task');
  return (
    <div ref={ref} data-testid="page">
      <header data-testid="workbench-task-header">head</header>
    </div>
  );
}

describe('useWorkbenchOverlayInset', () => {
  const observers: ResizeObserverCallback[] = [];

  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    class RO implements ResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        observers.push(cb);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): ResizeObserverEntry[] {
        return [];
      }
    }
    vi.stubGlobal('ResizeObserver', RO);
  });

  it('writes --workbench-panel-top from the header/page delta only when it changes', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.getAttribute('data-testid') === 'workbench-task-header') {
        return { top: 40, bottom: 92, left: 0, right: 1200, width: 1200, height: 52 } as DOMRect;
      }
      if (this.getAttribute('data-testid') === 'page') {
        return { top: 40, bottom: 800, left: 0, right: 1200, width: 1200, height: 760 } as DOMRect;
      }
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
    });
    render(<Harness />);
    const page = screen.getByTestId('page');
    expect(page.style.getPropertyValue('--workbench-panel-top')).toBe('52px');
    const setProperty = vi.spyOn(page.style, 'setProperty');
    act(() => {
      observers[0]?.([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    });
    expect(setProperty).not.toHaveBeenCalled();
  });
});
