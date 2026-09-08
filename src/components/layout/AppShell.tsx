import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Sidebar from '../sidebar/Sidebar';
import { FrameBar } from './FrameBar';
import { resolveShellContext, type WorkbenchIntentState } from './shellNavigation';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useWindowChrome } from '../../hooks/useWindowChrome';
import '../../styles/app-shell.css';
import '../../styles/frame.css';

interface AppShellProps {
  children: ReactNode;
}

const SIDEBAR_COLLAPSED_KEY = 'ai_novel_studio_sidebar_collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const context = resolveShellContext(location.pathname);
  const chrome = useWindowChrome();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      // Preference persistence is best effort.
    }
  }, [sidebarCollapsed]);

  const handOff = useCallback(
    (workbenchIntent: WorkbenchIntentState['workbenchIntent']) =>
      navigate('/', { state: { workbenchIntent } satisfies WorkbenchIntentState }),
    [navigate],
  );
  useKeyboardShortcuts([
    { key: 'n', ctrlOrMeta: true, allowInInputs: true, action: () => handOff('new-task') },
    { key: 'k', ctrlOrMeta: true, allowInInputs: true, action: () => handOff('search') },
  ]);

  const showGlobalSidebar = context.layout === 'standard' || context.layout === 'writing';

  return (
    <div
      className={`app-shell app-shell--${context.layout}`}
      data-testid="app-shell"
      data-layout={context.layout}
      data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}
      data-window-frame={chrome.native ? 'custom' : 'browser'}
      data-window-maximized={chrome.maximized ? 'true' : 'false'}
    >
      <FrameBar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
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
  );
}

export default AppShell;
