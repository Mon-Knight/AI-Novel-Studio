import {
  Ban,
  Bot,
  CheckSquare2,
  CircleCheck,
  CircleX,
  Clock3,
  ListChecks,
  LoaderCircle,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import BackButton from '../../components/common/BackButton';
import { PageHeader, PageLayout } from '../../components/common/PageLayout';
import EmptyState from '../../components/common/EmptyState';
import LoadingState from '../../components/common/LoadingState';
import ErrorState from '../../components/common/ErrorState';
import type { AiTaskRecord, AiTaskStatus, AiTaskType } from '../../types/ai';
import { AiTaskTypeLabels } from '../../types/ai';
import AiTaskRecordCard from './AiTaskRecordCard';
import {
  STATUS_FILTERS,
  TYPE_FILTERS,
  formatUsd,
  type ActiveExecutionState,
} from './aiTasksPresentation';

export interface AiTasksPageViewProps {
  loading?: boolean;
  staleResults?: boolean;
  requestedPage?: number;
  loadError?: string;
  onRetryLoad?: () => void;
  tasks: AiTaskRecord[];
  total: number;
  typeFilter: AiTaskType | 'all';
  statusFilter: AiTaskStatus | 'all';
  expandedId: string | null;
  msg: string;
  selectedIds: Set<string>;
  selectMode: boolean;
  deleting: boolean;
  visibleCost: number;
  totalPages: number;
  visiblePage: number;
  pagedTasks: AiTaskRecord[];
  executionStates: ReadonlyMap<string, ActiveExecutionState>;
  onTypeFilterChange: (value: AiTaskType | 'all') => void;
  onStatusFilterChange: (value: AiTaskStatus | 'all') => void;
  onToggleSelectMode: () => void;
  onToggleSelectAll: () => void;
  onDeleteSelected: () => void;
  onClearAll: () => void;
  onDeleteFiltered: () => void;
  onToggleSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onStopTask: (task: AiTaskRecord) => void;
  onDeleteOne: (task: AiTaskRecord) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}

function AiTasksPageView({
  loading = false,
  staleResults = false,
  requestedPage,
  loadError = '',
  onRetryLoad,
  tasks,
  total,
  typeFilter,
  statusFilter,
  expandedId,
  msg,
  selectedIds,
  selectMode,
  deleting,
  visibleCost,
  totalPages,
  visiblePage,
  pagedTasks,
  executionStates,
  onTypeFilterChange,
  onStatusFilterChange,
  onToggleSelectMode,
  onToggleSelectAll,
  onDeleteSelected,
  onClearAll,
  onDeleteFiltered,
  onToggleSelect,
  onToggleExpand,
  onStopTask,
  onDeleteOne,
  onPreviousPage,
  onNextPage,
}: AiTasksPageViewProps) {
  const deletableTaskCount = tasks.filter(
    (task) =>
      task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled',
  ).length;
  const msgIsError = msg.includes('失败') || msg.includes('未删除') || msg.includes('仍检测');

  return (
    <PageLayout>
      <BackButton label="返回工作台" to="/" />
      <PageHeader
        title="AI 任务记录"
        icon={Bot}
        description={
          <>
            查看生成、分析、检查和润色的执行记录
            {visibleCost > 0 && (
              <span>
                {' '}
                · {staleResults ? '上次结果' : '当前页'}已计价 {formatUsd(visibleCost)}
              </span>
            )}
          </>
        }
      />
      {msg && (
        <div
          role={msgIsError ? 'alert' : 'status'}
          className={`resource-notice ${msgIsError ? 'resource-notice--error' : 'resource-notice--success'}`}
        >
          {msg}
        </div>
      )}
      <div className="resource-toolbar">
        <button
          className={`btn btn-sm ${selectMode ? 'btn-primary' : 'btn-secondary'}`}
          onClick={onToggleSelectMode}
          disabled={deleting || (staleResults && !selectMode)}
        >
          {selectMode ? (
            <>
              <X aria-hidden="true" size={15} strokeWidth={1.8} />
              取消选择
            </>
          ) : (
            <>
              <ListChecks aria-hidden="true" size={15} strokeWidth={1.8} />
              多选
            </>
          )}
        </button>
        {selectMode && (
          <>
            <button
              className="btn btn-sm btn-secondary"
              onClick={onToggleSelectAll}
              disabled={deleting || staleResults}
            >
              {deletableTaskCount > 0 && selectedIds.size === deletableTaskCount ? (
                <>
                  <Square aria-hidden="true" size={15} strokeWidth={1.8} />
                  取消全选
                </>
              ) : (
                <>
                  <CheckSquare2 aria-hidden="true" size={15} strokeWidth={1.8} />
                  全选终态
                </>
              )}
            </button>
            <button
              className="btn btn-sm btn-danger"
              onClick={onDeleteSelected}
              disabled={deleting || staleResults || selectedIds.size === 0}
            >
              {deleting ? (
                <>
                  <LoaderCircle aria-hidden="true" size={15} strokeWidth={1.8} />
                  删除中...
                </>
              ) : (
                <>
                  <Trash2 aria-hidden="true" size={15} strokeWidth={1.8} />
                  删除选中（{selectedIds.size}）
                </>
              )}
            </button>
          </>
        )}
        <button
          className="btn btn-sm btn-danger"
          onClick={onClearAll}
          disabled={deleting || total === 0}
        >
          {deleting ? (
            <>
              <LoaderCircle aria-hidden="true" size={15} strokeWidth={1.8} />
              处理中...
            </>
          ) : (
            <>
              <Trash2 aria-hidden="true" size={15} strokeWidth={1.8} />
              清空全部记录
            </>
          )}
        </button>
      </div>
      <div className="resource-toolbar">
        <span className="resource-meta">类型：</span>
        {TYPE_FILTERS.map((value) => (
          <button
            key={value}
            className={`btn btn-xs ${typeFilter === value ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onTypeFilterChange(value)}
          >
            {value === 'all' ? '全部' : AiTaskTypeLabels[value]}
          </button>
        ))}
      </div>
      <div className="resource-toolbar resource-gap-bottom-lg">
        <span className="resource-meta">状态：</span>
        {STATUS_FILTERS.map((value) => {
          const StatusIcon =
            value === 'succeeded'
              ? CircleCheck
              : value === 'failed'
                ? CircleX
                : value === 'pending'
                  ? Clock3
                  : value === 'running'
                    ? LoaderCircle
                    : value === 'cancelled'
                      ? Ban
                      : null;
          const label =
            value === 'all'
              ? '全部'
              : {
                  succeeded: '成功',
                  failed: '失败',
                  pending: '等待',
                  running: '运行中',
                  cancelled: '已取消',
                }[value];
          return (
            <button
              key={value}
              className={`btn btn-xs ${statusFilter === value ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => onStatusFilterChange(value)}
            >
              {StatusIcon && <StatusIcon aria-hidden="true" size={13} strokeWidth={1.8} />}
              {label}
            </button>
          );
        })}
      </div>
      {(typeFilter !== 'all' || statusFilter !== 'all') && tasks.length > 0 && (
        <div className="resource-gap-bottom">
          <button
            className="btn btn-xs btn-danger"
            onClick={onDeleteFiltered}
            disabled={deleting || staleResults || deletableTaskCount === 0}
          >
            <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
            删除当前页的 {deletableTaskCount} 条终态记录
          </button>
        </div>
      )}
      {loadError && (
        <ErrorState message="任务记录读取失败" detail={loadError} onRetry={onRetryLoad} />
      )}
      {staleResults && tasks.length > 0 && (
        <div className="list-refreshing" role="status" data-testid="ai-tasks-stale-results">
          当前保留上次读取的第 {visiblePage}{' '}
          页结果，不属于当前筛选或页码；读取成功前不可选择或删除这些记录。
        </div>
      )}
      {loading &&
        (tasks.length > 0 ? (
          <div className="list-refreshing" role="status">
            正在更新任务记录，暂时保留已读取结果…
          </div>
        ) : (
          <LoadingState text="正在更新任务记录…" />
        ))}
      {tasks.length === 0 && !loading && !loadError ? (
        <EmptyState
          icon={Bot}
          title={
            typeFilter !== 'all' || statusFilter !== 'all'
              ? '当前筛选没有匹配记录'
              : '暂无 AI 任务记录'
          }
          description={
            typeFilter !== 'all' || statusFilter !== 'all'
              ? '更换筛选条件，或清除筛选查看全部记录。'
              : '执行创作任务后，记录会显示在这里。'
          }
          action={
            typeFilter !== 'all' || statusFilter !== 'all'
              ? {
                  label: '清除筛选',
                  onClick: () => {
                    onTypeFilterChange('all');
                    onStatusFilterChange('all');
                  },
                }
              : undefined
          }
        />
      ) : (
        <div className="resource-list">
          {pagedTasks.map((task) => (
            <AiTaskRecordCard
              key={task.id}
              task={task}
              expanded={expandedId === task.id}
              selected={selectedIds.has(task.id)}
              selectMode={selectMode}
              staleResults={staleResults}
              deleting={deleting}
              activeExecutionState={executionStates.get(task.id) ?? 'inactive'}
              onToggleSelect={onToggleSelect}
              onToggleExpand={onToggleExpand}
              onStop={onStopTask}
              onDelete={onDeleteOne}
            />
          ))}
          {totalPages > 1 && (
            <nav className="list-pagination" aria-label="AI 任务分页">
              <button
                className="btn btn-secondary btn-sm"
                disabled={staleResults || (requestedPage ?? visiblePage) <= 1}
                onClick={onPreviousPage}
              >
                上一页
              </button>
              <span>
                {staleResults ? '上次结果：' : ''}第 {visiblePage} / {totalPages} 页 · 共 {total} 条
                {staleResults && requestedPage ? `；请求第 ${requestedPage} 页` : ''}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={staleResults || (requestedPage ?? visiblePage) >= totalPages}
                onClick={onNextPage}
              >
                下一页
              </button>
            </nav>
          )}
        </div>
      )}
    </PageLayout>
  );
}

export default AiTasksPageView;
