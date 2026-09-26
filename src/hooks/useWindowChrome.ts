import { useCallback, useEffect, useState } from 'react';
import { isTauriRuntime } from '../services/tauri/runtime';
import { appLogger } from '../services/observability/appLogger';

export interface WindowChrome {
  /** True only inside the Tauri desktop shell, where the frame bar owns the window controls. */
  native: boolean;
  maximized: boolean;
  minimize: () => void;
  toggleMaximize: () => void;
  /** Requests a close through Tauri so the workspace leave guard keeps its say. */
  close: () => void;
}

type AppWindow = typeof import('@tauri-apps/api/window').appWindow;

// Loaded lazily: the module warns about missing Tauri metadata when imported in a browser.
const loadAppWindow = (): Promise<AppWindow> =>
  import('@tauri-apps/api/window').then((module) => module.appWindow);

function reportChromeFailure(action: string, error: unknown): void {
  appLogger.warn('[WINDOW_CHROME] action failed', {
    action,
    message: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Window controls for the undecorated desktop window. In browser development mode every
 * action is a no-op and `native` is false so the frame bar renders without controls.
 */
export function useWindowChrome(): WindowChrome {
  const native = isTauriRuntime();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void loadAppWindow()
      .then(async (appWindow) => {
        const refresh = () =>
          appWindow
            .isMaximized()
            .then((value) => {
              if (!disposed) setMaximized(value);
            })
            .catch((error) => reportChromeFailure('isMaximized', error));
        void refresh();
        const dispose = await appWindow.onResized(() => void refresh());
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch((error) => reportChromeFailure('onResized', error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [native]);

  const run = useCallback(
    (action: string, task: (appWindow: AppWindow) => Promise<void>) => {
      if (!native) return;
      loadAppWindow()
        .then(task)
        .catch((error) => reportChromeFailure(action, error));
    },
    [native],
  );

  return {
    native,
    maximized,
    minimize: useCallback(() => run('minimize', (appWindow) => appWindow.minimize()), [run]),
    toggleMaximize: useCallback(
      () => run('toggleMaximize', (appWindow) => appWindow.toggleMaximize()),
      [run],
    ),
    close: useCallback(() => run('close', (appWindow) => appWindow.close()), [run]),
  };
}
