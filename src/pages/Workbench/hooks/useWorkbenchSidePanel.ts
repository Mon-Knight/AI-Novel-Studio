import { useCallback, useState } from 'react';

export type WorkbenchSidePanelView = 'launcher' | 'plugins' | 'context' | 'artifacts' | 'events';
export type WorkbenchSidePanelPresentation = 'transient' | 'pinned';

export interface WorkbenchSidePanelState {
  view: WorkbenchSidePanelView | null;
  presentation: WorkbenchSidePanelPresentation;
  open: (view: WorkbenchSidePanelView) => void;
  openPlugins: () => void;
  back: () => void;
  toggle: () => void;
  togglePresentation: () => void;
  close: () => void;
}

/**
 * The plugin panel keeps its own flag (owned by the plugin hook); every other view is local.
 * The launcher is the side panel's idle view and the target of "back".
 */
export function useWorkbenchSidePanel(
  showPlugins: boolean,
  setShowPlugins: (value: boolean) => void,
): WorkbenchSidePanelState {
  const [localView, setLocalView] = useState<Exclude<WorkbenchSidePanelView, 'plugins'> | null>(
    null,
  );
  const [presentation, setPresentation] = useState<WorkbenchSidePanelPresentation>('transient');
  const view: WorkbenchSidePanelView | null = showPlugins ? 'plugins' : localView;
  const close = useCallback(() => {
    setShowPlugins(false);
    setLocalView(null);
  }, [setShowPlugins]);
  const open = useCallback(
    (next: WorkbenchSidePanelView) => {
      if (view === next) {
        close();
        return;
      }
      setShowPlugins(next === 'plugins');
      setLocalView(next === 'plugins' ? null : next);
    },
    [close, setShowPlugins, view],
  );
  const back = useCallback(() => open('launcher'), [open]);
  const toggle = useCallback(() => {
    if (view) close();
    else setLocalView('launcher');
  }, [close, view]);
  const togglePresentation = useCallback(() => {
    setPresentation((current) => (current === 'pinned' ? 'transient' : 'pinned'));
  }, []);
  const openPlugins = useCallback(() => open('plugins'), [open]);
  return { view, presentation, open, openPlugins, back, toggle, togglePresentation, close };
}
