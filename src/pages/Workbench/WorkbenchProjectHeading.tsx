import { ChevronRight } from 'lucide-react';
import { Tooltip } from '../../components/common/Tooltip';

interface WorkbenchProjectHeadingProps {
  novelId: string;
  title: string;
  taskCount: number;
  current: boolean;
  collapsed: boolean;
  collapseDisabled: boolean;
  onToggleCollapse: () => void;
  onSelect: () => void;
}

export function WorkbenchProjectHeading({
  novelId,
  title,
  taskCount,
  current,
  collapsed,
  collapseDisabled,
  onToggleCollapse,
  onSelect,
}: WorkbenchProjectHeadingProps) {
  return (
    <div
      className={`workbench-project-heading ${current ? 'is-current' : ''}`.trim()}
      data-selected={current ? 'true' : 'false'}
    >
      <button
        type="button"
        className="workbench-project-collapse"
        aria-label={`${collapsed ? '展开' : '收起'}${title}的任务`}
        aria-expanded={!collapsed}
        disabled={collapseDisabled}
        title={collapseDisabled ? '搜索结果保持展开' : undefined}
        onClick={onToggleCollapse}
      >
        <ChevronRight aria-hidden="true" size={14} strokeWidth={1.8} />
      </button>
      <Tooltip
        boundarySelector=".workbench-tree"
        content={
          <>
            <span className="ui-tooltip-title">{title}</span>
            <span className="ui-tooltip-detail">
              {taskCount} 个任务{current ? ' · 当前项目' : ''}
            </span>
          </>
        }
      >
        <button
          type="button"
          className={`workbench-project-row ${current ? 'is-active' : ''}`}
          data-testid="workbench-project"
          data-novel-id={novelId}
          data-selected={current ? 'true' : 'false'}
          aria-current={current ? 'true' : undefined}
          aria-label={`${title}，${taskCount} 个任务${current ? '，当前项目' : ''}`}
          onClick={onSelect}
        >
          <span className="workbench-project-mark" aria-hidden="true">
            {title.slice(0, 1) || '书'}
          </span>
          <span className="workbench-project-title">{title}</span>
          <span className="workbench-project-count" aria-hidden="true">
            {taskCount}
          </span>
        </button>
      </Tooltip>
    </div>
  );
}
