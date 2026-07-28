import { useLocation } from 'react-router-dom';
import { APP_VERSION, APP_PLATFORM_LABEL } from '../../constants/version';

const pageTitles: Record<string, string> = {
  '/': 'AI Novel Studio',
  '/styles': '风格方案',
  '/settings': '设置中心',
  '/coming-soon': '即将开放',
};

function getPageTitle(pathname: string): string {
  if (pathname.startsWith('/novels/') && pathname.endsWith('/workspace')) {
    return '写作工作台';
  }
  if (pathname.startsWith('/novels/') && pathname.endsWith('/autonomous-planning')) {
    return '自主创作规划';
  }
  if (
    (pathname.startsWith('/novels/') && pathname.endsWith('/setting-suggestions')) ||
    (pathname.startsWith('/worlds/') && pathname.endsWith('/lore/suggestions'))
  ) {
    return '设定库 AI 推演';
  }
  if (pathname.startsWith('/novels/')) {
    return '作品详情';
  }
  return pageTitles[pathname] || 'AI Novel Studio';
}

function TopBar() {
  const location = useLocation();
  const title = getPageTitle(location.pathname);

  return (
    <header className="app-topbar">
      <span className="topbar-title">{title}</span>
      <div className="topbar-actions">
        <span className="text-sm text-muted">
          {APP_VERSION} · {APP_PLATFORM_LABEL}
        </span>
      </div>
    </header>
  );
}

export default TopBar;
