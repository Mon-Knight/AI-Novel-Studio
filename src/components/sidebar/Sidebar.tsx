import { NavLink, useLocation } from 'react-router-dom';
import { APP_VERSION } from '../../constants/version';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

const mainNavItems: NavItem[] = [
  { path: '/', label: '小说作品', icon: '📖' },
  { path: '/assets', label: '创作资产', icon: '📦' },
  { path: '/styles', label: '风格方案', icon: '🎨' },
  { path: '/templates', label: '模板中心', icon: '📋' },
  { path: '/ai-tasks', label: 'AI任务记录', icon: '🤖' },
];

const toolNavItems: NavItem[] = [
  { path: '/import-export', label: '导入导出', icon: '📥' },
  { path: '/settings', label: '设置中心', icon: '⚙️' },
];

function Sidebar() {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    if (path.startsWith('/coming-soon')) return location.pathname === '/coming-soon';
    return location.pathname.startsWith(path);
  };

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">AI</div>
        <span className="sidebar-brand-text">AI Novel Studio</span>
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-nav-section">创作</div>
        {mainNavItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={`sidebar-nav-item ${isActive(item.path) ? 'active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}

        <div className="sidebar-nav-section" style={{ marginTop: 8 }}>工具</div>
        {toolNavItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={`sidebar-nav-item ${isActive(item.path) ? 'active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <span className="version">{APP_VERSION}</span>
      </div>
    </aside>
  );
}

export default Sidebar;
