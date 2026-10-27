import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import {
  captureFocusSnapshot,
  restoreFocusSnapshot,
} from '../../../components/common/focusRestoration';
import { hasActiveModal } from '../../../components/common/useModalAccessibility';
import { isComposingKeyboardEvent } from '../../../utils/keyboardEvent';
import type { WorkbenchSidePanelPresentation } from './useWorkbenchSidePanel';

const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const PANEL_TRIGGERS =
  '[data-testid="workbench-toggle-side-panel"], [data-testid="workbench-current-plugins"], [data-testid="workbench-toggle-focus"], [data-testid="workbench-open-context"], [data-testid="workbench-open-artifacts"], [data-testid="shell-toggle-sidebar"]';

function panelOpener(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // The insertion action is hidden in the same commit that mounts this panel.
  return active?.closest('.workbench-attach-menu')
    ? document.querySelector<HTMLElement>('[data-testid="workbench-composer-attach"]')
    : active;
}

/** A docked reference view stays open while writing. The narrow overlay is transient. */
export function useWorkbenchSidePanelAccessibility({
  panelRef,
  view,
  scopeKey,
  presentation = 'transient',
  temporarilyHidden = false,
  onClose,
}: {
  panelRef: RefObject<HTMLElement>;
  view: string;
  scopeKey: string;
  presentation?: WorkbenchSidePanelPresentation;
  temporarilyHidden?: boolean;
  onClose: () => void;
}) {
  const openerRef = useRef(captureFocusSnapshot(panelOpener()));
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  const initialScope = useRef(scopeKey);
  const restoreOnClose = useRef(true);
  const wasTemporarilyHidden = useRef(temporarilyHidden);
  const hiddenRef = useRef(temporarilyHidden);
  hiddenRef.current = temporarilyHidden;

  useClientLayoutEffect(() => {
    if (initialScope.current !== scopeKey) {
      restoreOnClose.current = false;
      latestClose.current();
      return;
    }
    if (hiddenRef.current) return;
    panelRef.current?.focus({ preventScroll: true });
  }, [panelRef, scopeKey, view]);

  useClientLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel) {
      if (temporarilyHidden) panel.setAttribute('inert', '');
      else panel.removeAttribute('inert');
    }
    if (temporarilyHidden && !wasTemporarilyHidden.current) {
      const active = document.activeElement;
      if (active !== document.body && panel?.contains(active)) {
        restoreFocusSnapshot(captureFocusSnapshot(openerRef.current?.element ?? null));
      }
    }
    wasTemporarilyHidden.current = temporarilyHidden;
  }, [panelRef, temporarilyHidden]);

  useClientLayoutEffect(() => {
    const panel = panelRef.current;
    return () => {
      if (!restoreOnClose.current) return;
      const active = document.activeElement;
      if (active !== document.body && !panel?.contains(active)) return;
      // Restore focus without undoing deliberate scrolling while the panel was open.
      restoreFocusSnapshot(captureFocusSnapshot(openerRef.current?.element ?? null));
    };
  }, [panelRef]);

  useEffect(() => {
    const isOverlay = () => presentation === 'transient' || window.innerWidth <= 1180;
    const dismissForOutside = (event: Event) => {
      if (
        temporarilyHidden ||
        !isOverlay() ||
        hasActiveModal() ||
        !(event.target instanceof Element)
      )
        return;
      if (
        panelRef.current?.contains(event.target) ||
        event.target.closest(PANEL_TRIGGERS) ||
        event.target.closest('[aria-modal="true"]')
      )
        return;
      restoreOnClose.current = false;
      latestClose.current();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (
        temporarilyHidden ||
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        isComposingKeyboardEvent(event) ||
        hasActiveModal() ||
        !(event.target instanceof Node) ||
        !panelRef.current?.contains(event.target)
      )
        return;
      // Native selection popups own their first Escape.
      if (event.target instanceof HTMLSelectElement) return;
      event.preventDefault();
      event.stopPropagation();
      restoreOnClose.current = true;
      latestClose.current();
    };
    document.addEventListener('pointerdown', dismissForOutside);
    document.addEventListener('focusin', dismissForOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissForOutside);
      document.removeEventListener('focusin', dismissForOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [panelRef, presentation, temporarilyHidden]);
}
