import { ArrowLeft } from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { HUB_GROUPS, isEntryActive } from './shellNavigation';

export type SettingsTabKey = 'general' | 'ai_models' | 'governance' | 'data' | 'diagnostics';

interface HubSidebarProps {
  /** When provided, the settings entries switch panes in place instead of navigating. */
  activeSettingsTab?: SettingsTabKey;
  onSelectSettingsTab?: (tab: SettingsTabKey) => void;
}

function settingsTabFromPath(path: string): SettingsTabKey | null {
  const match = /^\/settings\?tab=([a-z_]+)$/u.exec(path);
  return match ? (match[1] as SettingsTabKey) : null;
}

/**
 * ZCode-style grouped navigation for the resource center: creative resources, data records
 * and the settings categories share one left rail with a "back to workspace" entry on top.
 */
export function HubSidebar({ activeSettingsTab, onSelectSettingsTab }: HubSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside className="settings-sidebar hub-sidebar" data-testid="settings-sidebar">
      <button
        type="button"
        className="hub-back"
        data-testid="settings-back-home-btn"
        onClick={() => navigate('/')}
      >
        <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.8} />
        返回工作区
      </button>

      <nav className="hub-nav" aria-label="资源中心导航">
        {HUB_GROUPS.map((group) => (
          <div className="hub-nav-group" key={group.label}>
            <div className="hub-nav-section">{group.label}</div>
            {group.entries.map((entry) => {
              const Icon = entry.icon;
              const settingsTab = settingsTabFromPath(entry.path);
              if (settingsTab && onSelectSettingsTab) {
                const active = activeSettingsTab === settingsTab;
                return (
                  <button
                    key={entry.path}
                    type="button"
                    className={`hub-nav-item ${active ? 'is-active' : ''}`.trim()}
                    data-testid={`settings-nav-${settingsTab}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onSelectSettingsTab(settingsTab)}
                  >
                    <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
                    <span>{entry.label}</span>
                  </button>
                );
              }
              const active = isEntryActive(entry, location.pathname, location.search);
              return (
                <NavLink
                  key={entry.path}
                  to={entry.path}
                  className={`hub-nav-item ${active ? 'is-active' : ''}`.trim()}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
                  <span>{entry.label}</span>
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
