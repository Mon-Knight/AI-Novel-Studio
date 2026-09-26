import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

export interface WorkbenchFocusApi {
  focusMode: boolean;
  setFocusMode: Dispatch<SetStateAction<boolean>>;
  toggleFocusMode: () => void;
  exitFocusMode: () => void;
}

const WorkbenchFocusContext = createContext<WorkbenchFocusApi | null>(null);

export function WorkbenchFocusProvider({
  value,
  children,
}: {
  value: WorkbenchFocusApi;
  children: ReactNode;
}) {
  return <WorkbenchFocusContext.Provider value={value}>{children}</WorkbenchFocusContext.Provider>;
}

/** Session-only controller for AppShell; never persist this flag. */
// eslint-disable-next-line react-refresh/only-export-components -- session focus API is consumed by AppShell and Page.
export function useWorkbenchFocusController(): WorkbenchFocusApi {
  const [focusMode, setFocusMode] = useState(false);
  const toggleFocusMode = useCallback(() => setFocusMode((current) => !current), []);
  const exitFocusMode = useCallback(() => setFocusMode(false), []);
  return useMemo(
    () => ({ focusMode, setFocusMode, toggleFocusMode, exitFocusMode }),
    [exitFocusMode, focusMode, toggleFocusMode],
  );
}

/**
 * Page consumes the shell provider. Isolated tests without AppShell keep a local
 * fallback so they can still toggle focus without writing LocalStorage.
 */
// eslint-disable-next-line react-refresh/only-export-components -- tests and Page consume the same session API.
export function useWorkbenchFocus(): WorkbenchFocusApi {
  const context = useContext(WorkbenchFocusContext);
  const fallback = useWorkbenchFocusController();
  return context ?? fallback;
}
