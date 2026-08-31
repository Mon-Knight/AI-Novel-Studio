import { LoaderCircle, Puzzle } from 'lucide-react';

export function WorkbenchFailureState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="workbench-empty-state is-error" role="alert">
      <h2>工作台暂时无法读取内容</h2>
      <p>{message}</p>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>
        重新读取
      </button>
    </div>
  );
}

export function WorkbenchPreparingState({ label, testId }: { label: string; testId: string }) {
  return (
    <div
      className="workbench-message-region workbench-recovery-region"
      data-testid={testId}
      role="status"
      aria-label={label}
    >
      <div className="workbench-recovery-state">
        <LoaderCircle
          className="workbench-readiness-icon is-spinning"
          aria-hidden="true"
          strokeWidth={1.8}
          size={17}
        />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function WorkbenchStartupHeader({
  novelTitle,
  failed,
  onShowPlugins,
}: {
  novelTitle: string;
  failed: boolean;
  onShowPlugins: () => void;
}) {
  return (
    <header className="workbench-task-header workbench-task-header--preparing">
      <div className="workbench-task-header-inner">
        <div className="workbench-task-heading">
          <div className="workbench-task-title-block">
            <div className="workbench-eyebrow">{novelTitle}</div>
            <h2>{failed ? '暂时无法恢复创作任务' : '正在恢复最近的创作任务'}</h2>
          </div>
        </div>
        <button
          type="button"
          className="workbench-header-icon-button"
          aria-label="查看当前插件"
          title="查看当前插件"
          onClick={onShowPlugins}
        >
          <Puzzle aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}

export function WorkbenchEmptyProjects({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  return (
    <div className="workbench-empty-state" data-testid="workbench-no-projects">
      <h1>还没有小说项目</h1>
      <p>工作台需要一个小说项目。</p>
      <button
        type="button"
        className="btn btn-primary"
        data-testid="workbench-open-novels"
        onClick={onOpenLibrary}
      >
        打开小说作品
      </button>
    </div>
  );
}

export function WorkbenchEmptyTasks({
  creatingTask,
  conversationsLoading,
  onCreateTask,
  onShowPlugins,
}: {
  creatingTask: boolean;
  conversationsLoading: boolean;
  onCreateTask: () => void;
  onShowPlugins: () => void;
}) {
  return (
    <div className="workbench-empty-state">
      <h2>当前项目还没有创作任务</h2>
      <div className="workbench-empty-actions">
        <button
          type="button"
          className="btn btn-primary"
          data-testid="workbench-create-empty-task"
          disabled={creatingTask || conversationsLoading}
          onClick={onCreateTask}
        >
          新建创作任务
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          data-testid="workbench-current-plugins"
          onClick={onShowPlugins}
        >
          当前插件
        </button>
      </div>
    </div>
  );
}
