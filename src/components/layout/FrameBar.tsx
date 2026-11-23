import { Copy, Minus, PanelLeft, Square, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { APP_VERSION } from '../../constants/version';
import type { WindowChrome } from '../../hooks/useWindowChrome';
import {
  HUB_HOME_PATH,
  isEntryActive,
  resolveShellContext,
  TOP_NAV_ENTRIES,
} from './shellNavigation';

interface FrameBarProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  chrome: WindowChrome;
}

/**
 * ZCode-style tab strip that is also the window title bar: the empty surface drags the
 * undecorated window (double-click maximizes), and the trailing group hosts the window controls.
 */
export function FrameBar({ sidebarCollapsed, onToggleSidebar, chrome }: FrameBarProps) {
  const location = useLocation();
  const context = resolveShellContext(location.pathname);
  const showPageTab =
    context.section === 'project' || context.section === 'other'
      ? location.pathname !== '/novels'
      : context.section === 'hub'
        ? location.pathname !== HUB_HOME_PATH
        : false;

  return (
    <header
      className="app-frame-bar"
      data-testid="app-frame-bar"
      data-section={context.section}
      data-tauri-drag-region
    >
      <div className="frame-brand" aria-label="AI Novel Studio" data-tauri-drag-region>
        <span className="frame-brand-mark" aria-hidden="true" data-tauri-drag-region>
          AI
        </span>
      </div>
      <button
        type="button"
        className={`frame-icon-button ${sidebarCollapsed ? '' : 'is-active'}`.trim()}
        aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
        aria-pressed={!sidebarCollapsed}
        aria-expanded={!sidebarCollapsed}
        data-testid="shell-toggle-sidebar"
        title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
        onClick={onToggleSidebar}
      >
        <PanelLeft aria-hidden="true" size={16} strokeWidth={1.8} />
      </button>
      <nav className="frame-tabs" aria-label="工作区标签" data-tauri-drag-region>
        {TOP_NAV_ENTRIES.map((entry) => {
          const active = isEntryActive(entry, location.pathname) && !showPageTab;
          const Icon = entry.icon;
          return (
            <Link
              key={entry.path}
              to={entry.path}
              className={`frame-tab ${active ? 'is-active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon aria-hidden="true" size={14} strokeWidth={1.8} />
              <span>{entry.label}</span>
            </Link>
          );
        })}
        {showPageTab && (
          <span className="frame-tab is-active is-page" aria-current="page">
            {context.pageLabel}
          </span>
        )}
      </nav>
      <div className="frame-actions">
        <span className="frame-version" title="当前版本" data-tauri-drag-region>
          {APP_VERSION}
        </span>
      </div>
      {chrome.native && (
        <div className="frame-window-controls" role="group" aria-label="窗口控制">
          <button
            type="button"
            className="frame-window-button"
            data-testid="window-minimize"
            aria-label="最小化"
            title="最小化"
            onClick={chrome.minimize}
          >
            <Minus aria-hidden="true" size={14} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="frame-window-button"
            data-testid="window-toggle-maximize"
            aria-label={chrome.maximized ? '还原' : '最大化'}
            aria-pressed={chrome.maximized}
            title={chrome.maximized ? '还原' : '最大化'}
            onClick={chrome.toggleMaximize}
          >
            {chrome.maximized ? (
              <Copy aria-hidden="true" size={12} strokeWidth={1.8} />
            ) : (
              <Square aria-hidden="true" size={12} strokeWidth={1.8} />
            )}
          </button>
          <button
            type="button"
            className="frame-window-button is-close"
            data-testid="window-close"
            aria-label="关闭"
            title="关闭"
            onClick={chrome.close}
          >
            <X aria-hidden="true" size={15} strokeWidth={1.8} />
          </button>
        </div>
      )}
    </header>
  );
}
