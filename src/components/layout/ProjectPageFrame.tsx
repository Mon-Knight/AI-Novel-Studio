import type { ReactNode } from 'react';
import { NavLink, useLocation, useParams } from 'react-router-dom';
import { isEntryActive, projectEntries } from './shellNavigation';
import '../../styles/hub.css';

/**
 * Shared frame for every page of one novel: a horizontal tab strip over the page content so
 * 概览 / 章节审阅 / 大纲 / 设定推演 / 参考资料 / 故事资产 / 自主创作 read as one project surface.
 */
export function ProjectPageFrame({ children }: { children: ReactNode }) {
  const { novelId = '' } = useParams<{ novelId: string }>();
  const location = useLocation();
  const entries = novelId ? projectEntries(novelId) : [];

  return (
    <div className="project-frame" data-testid="project-frame" data-novel-id={novelId}>
      {entries.length > 0 && (
        <nav className="project-tabs" aria-label="作品页面">
          {entries.map((entry) => {
            const Icon = entry.icon;
            const active = isEntryActive(entry, location.pathname);
            return (
              <NavLink
                key={entry.path}
                to={entry.path}
                className={`project-tab ${active ? 'is-active' : ''}`.trim()}
                aria-current={active ? 'page' : undefined}
              >
                <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
                <span>{entry.label}</span>
              </NavLink>
            );
          })}
        </nav>
      )}
      <div className="project-frame-content">{children}</div>
    </div>
  );
}
