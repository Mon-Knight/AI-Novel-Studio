import { useLayoutEffect, useRef, type RefObject } from 'react';
import { captureFocusSnapshot, restoreFocusSnapshot } from './focusRestoration';
import { isComposingKeyboardEvent } from '../../utils/keyboardEvent';

const FOCUSABLE_SELECTOR =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [tabindex]';
const modalStack: Array<{ dialog: HTMLElement; overlay: HTMLElement }> = [];
let releaseActiveIsolation: (() => void) | undefined;
const isolatedElements = new WeakMap<
  HTMLElement,
  {
    count: number;
    inert: boolean;
    inertAttribute: string | null;
    ariaHidden: string | null;
  }
>();

export function hasActiveModal(): boolean {
  return modalStack.length > 0;
}

function visibleFocusable(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (
      element.tabIndex < 0 ||
      element.matches(':disabled') ||
      element.closest('[hidden], [inert]')
    )
      return false;
    for (
      let current: HTMLElement | null = element;
      current && current !== dialog;
      current = current.parentElement
    ) {
      const style = current.ownerDocument.defaultView?.getComputedStyle(current);
      if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    }
    return true;
  });
}

function isolateBackground(overlay: HTMLElement): () => void {
  const background = new Set<HTMLElement>();
  for (
    let branch: HTMLElement | null = overlay;
    branch?.parentElement;
    branch = branch.parentElement
  ) {
    for (const sibling of Array.from(branch.parentElement.children)) {
      if (
        sibling instanceof HTMLElement &&
        sibling !== branch &&
        !['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)
      ) {
        background.add(sibling);
      }
    }
    if (branch.parentElement === document.body) break;
  }
  for (const element of background) {
    const state = isolatedElements.get(element);
    if (state) state.count += 1;
    else
      isolatedElements.set(element, {
        count: 1,
        inert: Boolean(element.inert),
        inertAttribute: element.getAttribute('inert'),
        ariaHidden: element.getAttribute('aria-hidden'),
      });
    element.inert = true;
    element.setAttribute('inert', '');
    element.setAttribute('aria-hidden', 'true');
  }
  return () => {
    for (const element of background) {
      const state = isolatedElements.get(element);
      if (!state || --state.count > 0) continue;
      element.inert = state.inert;
      if (state.inertAttribute === null) element.removeAttribute('inert');
      else element.setAttribute('inert', state.inertAttribute);
      if (state.ariaHidden === null) element.removeAttribute('aria-hidden');
      else element.setAttribute('aria-hidden', state.ariaHidden);
      isolatedElements.delete(element);
    }
  };
}

function reconcileModalIsolation(): void {
  // Only the top modal owns background isolation. Recompute after each stack
  // change so two siblings mounted in one commit cannot make each other inert.
  releaseActiveIsolation?.();
  const top = modalStack[modalStack.length - 1];
  releaseActiveIsolation = top ? isolateBackground(top.overlay) : undefined;
}

/** Shared by startup and task dialogs; only the top modal owns keyboard focus. */
export function useModalAccessibility(input: {
  overlayRef: RefObject<HTMLElement>;
  dialogRef: RefObject<HTMLElement>;
  onDismiss?: () => void;
  busy?: boolean;
  initialFocusSelector?: string;
}): void {
  const latest = useRef(input);
  latest.current = input;
  const opener = useRef(
    captureFocusSnapshot(
      typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
    ),
  );

  useLayoutEffect(() => {
    const overlay = input.overlayRef.current;
    const dialog = input.dialogRef.current;
    if (!overlay || !dialog) return;
    const openerSnapshot = opener.current;
    const entry = { dialog, overlay };
    modalStack.push(entry);
    reconcileModalIsolation();
    const isTop = () => modalStack[modalStack.length - 1] === entry;
    const focusInitial = () => {
      const candidates = visibleFocusable(dialog);
      const preferred = latest.current.initialFocusSelector
        ? dialog.querySelector<HTMLElement>(latest.current.initialFocusSelector)
        : dialog.querySelector<HTMLElement>('[autofocus], [data-modal-initial-focus]');
      const target =
        preferred && candidates.includes(preferred)
          ? preferred
          : (candidates.find((element) => !element.hasAttribute('data-modal-close')) ?? dialog);
      target.focus({ preventScroll: true });
    };
    focusInitial();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTop() || event.defaultPrevented || isComposingKeyboardEvent(event)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!latest.current.busy) latest.current.onDismiss?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const candidates = visibleFocusable(dialog);
      const first = candidates[0];
      const last = candidates[candidates.length - 1];
      if (!first) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
      } else if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (isTop() && event.target instanceof Node && !dialog.contains(event.target)) focusInitial();
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      const wasTop = isTop();
      const index = modalStack.indexOf(entry);
      if (index !== -1) modalStack.splice(index, 1);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
      reconcileModalIsolation();
      if (wasTop) {
        restoreFocusSnapshot(openerSnapshot);
        const remaining = modalStack[modalStack.length - 1];
        if (remaining && !remaining.dialog.contains(document.activeElement)) {
          const candidates = visibleFocusable(remaining.dialog);
          (
            candidates.find((element) => !element.hasAttribute('data-modal-close')) ??
            remaining.dialog
          ).focus({ preventScroll: true });
        }
      }
    };
  }, [input.dialogRef, input.overlayRef]);
}
