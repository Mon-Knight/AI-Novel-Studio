import {
  ArrowDownToLine,
  BookOpenText,
  Bot,
  Boxes,
  LayoutTemplate,
  Palette,
  Settings2,
  Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { APP_VERSION } from '../../constants/version';

interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

interface SidebarProps {
  compact?: boolean;
}

const mainNavItems: NavItem[] = [
  { path: '/', label: '创作工作台', icon: Sparkles },
  { path: '/novels', label: '小说作品', icon: BookOpenText },
  { path: '/assets', label: '创作资产', icon: Boxes },
  { path: '/styles', label: '风格方案', icon: Palette },
  { path: '/templates', label: '模板中心', icon: LayoutTemplate },
  { path: '/ai-tasks', label: 'AI任务记录', icon: Bot },
];

const toolNavItems: NavItem[] = [
  { path: '/import-export', label: '导入导出', icon: ArrowDownToLine },
  { path: '/settings', label: '设置中心', icon: Settings2 },
];

function Sidebar({ compact = false }: SidebarProps) {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    if (path.startsWith('/coming-soon')) return location.pathname === '/coming-soon';
    return location.pathname.startsWith(path);
  };

  return (
    <aside
      className={`app-sidebar ${compact ? 'app-sidebar--compact' : ''}`}
      aria-label="应用导航"
      data-compact={compact ? 'true' : 'false'}
    >
      <div className="sidebar-brand" title={compact ? 'AI Novel Studio' : undefined}>
        <div className="sidebar-brand-icon" aria-hidden="true">
          AI
        </div>
        <span className="sidebar-brand-text">AI Novel Studio</span>
      </div>

      <nav className="sidebar-nav" aria-label="全局导航">
        <div className="sidebar-nav-section">创作</div>
        {mainNavItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`sidebar-nav-item ${active ? 'active' : ''}`}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
            >
              <span className="nav-icon" aria-hidden="true">
                <Icon size={18} strokeWidth={1.8} />
              </span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          );
        })}

        <div className="sidebar-nav-section" style={{ marginTop: 8 }}>
          工具
        </div>
        {toolNavItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`sidebar-nav-item ${active ? 'active' : ''}`}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
            >
              <span className="nav-icon" aria-hidden="true">
                <Icon size={18} strokeWidth={1.8} />
              </span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <span className="version">{APP_VERSION}</span>
      </div>
    </aside>
  );
}

export default Sidebar;
