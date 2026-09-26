import { NavLink, useLocation } from 'react-router-dom';
import { SidebarFooter } from '../layout/SidebarFooter';
import { SidebarQuickActions } from '../layout/SidebarQuickActions';
import { isEntryActive, sidebarGroups } from '../layout/shellNavigation';

interface SidebarProps {
  compact?: boolean;
}

/**
 * ZCode-style global sidebar: quick actions, workspace sections, the active project's
 * pages and a footer identity row. The workbench route renders its own project/task tree.
 */
function Sidebar({ compact = false }: SidebarProps) {
  const location = useLocation();
  const groups = sidebarGroups(location.pathname);

  return (
    <aside
      className={`app-sidebar ${compact ? 'app-sidebar--compact' : ''}`}
      aria-label="应用导航"
      data-compact={compact ? 'true' : 'false'}
    >
      {!compact && <SidebarQuickActions />}

      <nav className="sidebar-nav" aria-label="全局导航">
        {groups.map((group) => (
          <div className="sidebar-group" key={group.label}>
            <div className="sidebar-nav-section">{group.label}</div>
            {group.entries.map((entry) => {
              const Icon = entry.icon;
              const active = isEntryActive(entry, location.pathname, location.search);
              return (
                <NavLink
                  key={entry.path}
                  to={entry.path}
                  className={`sidebar-nav-item ${active ? 'active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  aria-label={entry.label}
                  title={entry.label}
                >
                  <span className="nav-icon" aria-hidden="true">
                    <Icon size={18} strokeWidth={1.8} />
                  </span>
                  <span className="nav-label">{entry.label}</span>
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <SidebarFooter />
    </aside>
  );
}

export default Sidebar;
