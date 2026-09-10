import { useCallback, useState } from 'react';

export type WorkbenchSidePanelView = 'launcher' | 'plugins' | 'context' | 'artifacts' | 'events';

export interface WorkbenchSidePanelState {
  view: WorkbenchSidePanelView | null;
  open: (view: WorkbenchSidePanelView) => void;
  openPlugins: () => void;
  back: () => void;
  toggle: () => void;
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
  const view: WorkbenchSidePanelView | null = showPlugins ? 'plugins' : localView;
  const open = useCallback(
    (next: WorkbenchSidePanelView) => {
      if (next === 'plugins') {
        setShowPlugins(true);
        return;
      }
      setShowPlugins(false);
      setLocalView(next);
    },
    [setShowPlugins],
  );
  const close = useCallback(() => {
    setShowPlugins(false);
    setLocalView(null);
  }, [setShowPlugins]);
  const back = useCallback(() => open('launcher'), [open]);
  const toggle = useCallback(() => {
    if (view) close();
    else setLocalView('launcher');
  }, [close, view]);
  const openPlugins = useCallback(() => open('plugins'), [open]);
  return { view, open, openPlugins, back, toggle, close };
}
