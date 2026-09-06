import type { WorkbenchConversationDirectory } from '../../features/workbench/useWorkbenchConversationDirectory';

interface Props {
  directory: WorkbenchConversationDirectory;
  empty: boolean;
  error: string;
  onRetry: () => void;
}

export function WorkbenchDirectoryFeedback({ directory, empty, error, onRetry }: Props) {
  const failure = directory.error || error;
  return (
    <>
      {empty && !directory.loading && !failure && (
        <div className="workbench-tree-feedback">
          {directory.query.trim()
            ? '没有匹配的任务'
            : directory.archive === 'archived'
              ? '暂无归档任务'
              : '暂无创作任务'}
        </div>
      )}
      {directory.hasMore && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          data-testid="workbench-load-more-tasks"
          disabled={directory.loading}
          onClick={directory.loadMore}
        >
          加载更多任务
        </button>
      )}
      {failure && (
        <div className="workbench-tree-feedback is-error" role="alert">
          <span>{failure}</span>
          <button
            type="button"
            onClick={
              directory.error ? () => void directory.refresh().catch(() => undefined) : onRetry
            }
          >
            重试任务
          </button>
        </div>
      )}
    </>
  );
}
