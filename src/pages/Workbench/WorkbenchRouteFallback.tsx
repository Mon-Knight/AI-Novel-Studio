import { useLayoutEffect } from 'react';
import '../../styles/workbench.css';

function markOnce(name: string): void {
  if (performance.getEntriesByName(name).length === 0) performance.mark(name);
}

export function WorkbenchLoadingSurface() {
  return (
    <div
      className="workbench-loading-surface"
      data-testid="workbench-loading"
      role="status"
      aria-label="正在恢复创作任务"
    >
      <div className="workbench-loading-header">
        <span className="workbench-skeleton-line is-title" />
        <span className="workbench-skeleton-line is-control" />
      </div>
      <div className="workbench-loading-body">
        <span className="workbench-skeleton-line is-message" />
        <span className="workbench-skeleton-line is-message is-short" />
        <span className="workbench-skeleton-line is-message" />
      </div>
      <div className="workbench-loading-composer" aria-hidden="true" />
    </div>
  );
}

export function WorkbenchRouteFallback() {
  useLayoutEffect(() => {
    markOnce('workbench-route-fallback-visible');
  }, []);

  return (
    <div className="workbench-page" data-testid="creative-workbench" aria-busy="true">
      <aside className="workbench-tree" aria-label="正在加载小说项目与创作任务">
        <div className="workbench-tree-header">
          <div>
            <div className="workbench-eyebrow">创作工作台</div>
            <h1>创作任务</h1>
          </div>
          <span className="workbench-new-task" aria-hidden="true">
            +
          </span>
        </div>
        <div className="workbench-tree-scroll">
          <div className="workbench-tree-skeleton" aria-hidden="true">
            <span className="workbench-skeleton-line is-project" />
            <span className="workbench-skeleton-line is-task" />
            <span className="workbench-skeleton-line is-task is-short" />
          </div>
        </div>
      </aside>

      <main className="workbench-main agent-console-main">
        <WorkbenchLoadingSurface />
      </main>
    </div>
  );
}

export default WorkbenchRouteFallback;
