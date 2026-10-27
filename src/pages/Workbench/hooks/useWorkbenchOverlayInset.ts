import { useLayoutEffect, useEffect, type RefObject } from 'react';

const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function overlayTopPx(page: HTMLElement): string {
  const header = page.querySelector<HTMLElement>('[data-testid="workbench-task-header"]');
  if (!header) return '0px';
  const pageRect = page.getBoundingClientRect();
  const headerRect = header.getBoundingClientRect();
  return `${Math.max(0, Math.round(headerRect.bottom - pageRect.top))}px`;
}

/**
 * Overlay panels sit below the live task header. ResizeObserver + rAF measure the
 * header/page delta and write `--workbench-panel-top` only when the pixel value changes.
 */
export function useWorkbenchOverlayInset(
  pageRef: RefObject<HTMLElement | null>,
  observeKey?: string,
) {
  useClientLayoutEffect(() => {
    const page = pageRef.current;
    if (!page || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    let last = '';
    const observed = new Set<Element>();
    const apply = () => {
      frame = 0;
      const next = overlayTopPx(page);
      if (next === last) return;
      last = next;
      page.style.setProperty('--workbench-panel-top', next);
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };
    const observer = new ResizeObserver(schedule);
    const watch = (node: Element | null) => {
      if (!node || observed.has(node)) return;
      observed.add(node);
      observer.observe(node);
    };
    watch(page);
    watch(page.querySelector('[data-testid="workbench-task-header"]'));
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [observeKey, pageRef]);
}
