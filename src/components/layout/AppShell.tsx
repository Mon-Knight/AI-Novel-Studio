import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Sidebar from '../sidebar/Sidebar';
import { FrameBar } from './FrameBar';
import {
  resolveShellContext,
  type ShellLayout,
  type WorkbenchIntentState,
} from './shellNavigation';
import { WorkbenchFocusProvider, useWorkbenchFocusController } from './workbenchFocus';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useWindowChrome } from '../../hooks/useWindowChrome';
import '../../styles/app-shell.css';
import '../../styles/frame.css';

interface AppShellProps {
  children: ReactNode;
}

const SIDEBAR_COLLAPSED_KEY = 'ai_novel_studio_sidebar_collapsed';
const SIDEBAR_SCOPES: ShellLayout[] = ['standard', 'writing', 'workbench', 'hub'];

function readCollapsed(scope: ShellLayout): boolean {
  try {
    const scoped = localStorage.getItem(`${SIDEBAR_COLLAPSED_KEY}:${scope}`);
    // Migrate the former shared preference once; subsequent choices are route-scoped.
    return (scoped ?? localStorage.getItem(SIDEBAR_COLLAPSED_KEY)) === '1';
  } catch {
    return false;
  }
}

function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const context = resolveShellContext(location.pathname);
  const chrome = useWindowChrome();
  const focus = useWorkbenchFocusController();
  const [collapsedByScope, setCollapsedByScope] = useState<Record<ShellLayout, boolean>>(() => ({
    standard: readCollapsed('standard'),
    writing: readCollapsed('writing'),
    workbench: readCollapsed('workbench'),
    hub: readCollapsed('hub'),
  }));
  const searchRequested =
    context.layout === 'workbench' &&
    (location.state as WorkbenchIntentState | null)?.workbenchIntent === 'search';
  const preferredCollapsed = collapsedByScope[context.layout];
  const workbenchFocused = context.layout === 'workbench' && focus.focusMode;
  const sidebarCollapsed = (preferredCollapsed || workbenchFocused) && !searchRequested;
  const revealWorkbenchTree = useCallback(() => {
    setCollapsedByScope((current) =>
      current.workbench ? { ...current, workbench: false } : current,
    );
  }, []);

  useLayoutEffect(() => {
    // Cover search handed over by quick actions as well as the shell shortcut.
    // The derived state makes the tree visible before the search intent focuses it.
    if (!searchRequested) return;
    revealWorkbenchTree();
    focus.exitFocusMode();
  }, [focus, revealWorkbenchTree, searchRequested]);

  useEffect(() => {
    try {
      for (const scope of SIDEBAR_SCOPES) {
        localStorage.setItem(
          `${SIDEBAR_COLLAPSED_KEY}:${scope}`,
          collapsedByScope[scope] ? '1' : '0',
        );
      }
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsedByScope.standard ? '1' : '0');
    } catch {
      // Preference persistence is best effort.
    }
  }, [collapsedByScope]);

  const handOff = useCallback(
    (workbenchIntent: WorkbenchIntentState['workbenchIntent']) => {
      if (workbenchIntent === 'search') {
        revealWorkbenchTree();
        focus.exitFocusMode();
      }
      navigate('/', { state: { workbenchIntent } satisfies WorkbenchIntentState });
    },
    [focus, navigate, revealWorkbenchTree],
  );
  useKeyboardShortcuts([
    { key: 'n', ctrlOrMeta: true, allowInInputs: true, action: () => handOff('new-task') },
    { key: 'k', ctrlOrMeta: true, allowInInputs: true, action: () => handOff('search') },
  ]);

  const showGlobalSidebar = context.layout === 'standard' || context.layout === 'writing';

  return (
    <WorkbenchFocusProvider value={focus}>
      <div
        className={`app-shell app-shell--${context.layout}`}
        data-testid="app-shell"
        data-layout={context.layout}
        data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}
        data-focus-mode={workbenchFocused ? 'true' : 'false'}
        data-window-frame={chrome.native ? 'custom' : 'browser'}
        data-window-maximized={chrome.maximized ? 'true' : 'false'}
      >
        <FrameBar
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => {
            if (workbenchFocused) {
              focus.exitFocusMode();
              revealWorkbenchTree();
              return;
            }
            setCollapsedByScope((current) => ({
              ...current,
              [context.layout]: !sidebarCollapsed,
            }));
          }}
          chrome={chrome}
        />
        <div className="app-body">
          {showGlobalSidebar && !sidebarCollapsed && (
            <Sidebar compact={context.layout === 'writing'} />
          )}
          <div className="app-main">
            <div className="app-content">{children}</div>
          </div>
        </div>
      </div>
    </WorkbenchFocusProvider>
  );
}

export default AppShell;
