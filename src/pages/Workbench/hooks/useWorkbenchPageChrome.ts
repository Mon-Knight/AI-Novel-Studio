import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { useWorkbenchFocus } from '../../../components/layout/workbenchFocus';
import { useWorkbenchOverlayInset } from './useWorkbenchOverlayInset';
import type { WorkbenchSidePanelState, WorkbenchSidePanelView } from './useWorkbenchSidePanel';

export function appendWorkbenchExample(current: string, example: string): string {
  const next = example.trim();
  if (!next) return current;
  return current ? `${current}\n\n${next}` : next;
}

function focusWorkbenchComposerInput() {
  const input = document.querySelector<HTMLTextAreaElement>(
    '[data-testid="workbench-composer-input"]',
  );
  input?.focus({ preventScroll: true });
}

export function useWorkbenchPageChrome({
  sidePanel,
  selectedConversationId,
  setDraft,
  setStartupDraft,
}: {
  sidePanel: Pick<WorkbenchSidePanelState, 'view' | 'open' | 'toggle'>;
  selectedConversationId: string;
  setDraft: Dispatch<SetStateAction<string>>;
  setStartupDraft: Dispatch<SetStateAction<string>>;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  useWorkbenchOverlayInset(pageRef, selectedConversationId || 'startup');
  const { focusMode, toggleFocusMode, exitFocusMode } = useWorkbenchFocus();
  const { view, open, toggle } = sidePanel;

  const openReference = useCallback(
    (next: WorkbenchSidePanelView) => {
      if (focusMode && view === next) {
        exitFocusMode();
        return;
      }
      exitFocusMode();
      open(next);
    },
    [exitFocusMode, focusMode, open, view],
  );

  const toggleSidePanel = useCallback(() => {
    if (focusMode) {
      exitFocusMode();
      if (view) return;
    }
    toggle();
  }, [exitFocusMode, focusMode, toggle, view]);

  const insertExample = useCallback(
    (text: string) => {
      const apply = (current: string) => appendWorkbenchExample(current, text);
      if (selectedConversationId) setDraft(apply);
      else setStartupDraft(apply);
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(focusWorkbenchComposerInput);
      } else {
        focusWorkbenchComposerInput();
      }
    },
    [selectedConversationId, setDraft, setStartupDraft],
  );

  return {
    pageRef,
    focusMode,
    toggleFocusMode,
    exitFocusMode,
    openReference,
    toggleSidePanel,
    insertExample,
  };
}
