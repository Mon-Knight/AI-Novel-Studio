export interface FocusSnapshot {
  element: HTMLElement;
  scroll: Array<{ element: HTMLElement; top: number; left: number }>;
  selection?: {
    start: number;
    end: number;
    direction: 'forward' | 'backward' | 'none';
    value: string;
  };
}

function isTextInput(element: HTMLElement): element is HTMLTextAreaElement | HTMLInputElement {
  const view = element.ownerDocument.defaultView;
  return Boolean(
    view &&
    (element instanceof view.HTMLTextAreaElement || element instanceof view.HTMLInputElement),
  );
}

export function captureFocusSnapshot(element: HTMLElement | null): FocusSnapshot | null {
  if (!element) return null;
  const scroll: FocusSnapshot['scroll'] = [];
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    scroll.push({ element: current, top: current.scrollTop, left: current.scrollLeft });
  }
  const selection =
    isTextInput(element) && element.selectionStart !== null && element.selectionEnd !== null
      ? {
          start: element.selectionStart,
          end: element.selectionEnd,
          direction: element.selectionDirection ?? 'none',
          value: element.value,
        }
      : undefined;
  return { element, scroll, selection };
}

export function restoreFocusSnapshot(snapshot: FocusSnapshot | null): void {
  if (!snapshot?.element.isConnected || snapshot.element.closest('[inert], [hidden]')) return;
  const { element, selection } = snapshot;
  element.focus({ preventScroll: true });
  if (selection && isTextInput(element) && element.value === selection.value) {
    element.setSelectionRange(selection.start, selection.end, selection.direction);
  }
  for (const item of snapshot.scroll) {
    if (!item.element.isConnected) continue;
    item.element.scrollTop = item.top;
    item.element.scrollLeft = item.left;
  }
}
