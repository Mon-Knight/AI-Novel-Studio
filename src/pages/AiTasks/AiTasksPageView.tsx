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

  return (
    <div
      style={{ padding: 32, maxWidth: 900, margin: '0 auto', height: '100%', overflowY: 'auto' }}
    >
      <BackButton label="返回工作台" to="/" />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 22,
          fontWeight: 700,
          marginBottom: 8,
          marginTop: 12,
        }}
      >
        <Bot aria-hidden="true" size={22} strokeWidth={1.8} />
        AI 任务记录
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>
        查看所有 AI 生成、分析、检查和润色任务的执行记录
        {visibleCost > 0 && <span> · 当前页已计价 {formatUsd(visibleCost)}</span>}
      </div>
      {msg && (
        <div
          style={{
            padding: '8px 16px',
            marginBottom: 16,
            background:
              msg.includes('失败') || msg.includes('未删除') || msg.includes('仍检测')
                ? 'var(--color-error-bg)'
                : 'var(--color-primary-light)',
            borderRadius: 6,
            fontSize: 13,
            color:
              msg.includes('失败') || msg.includes('未删除') || msg.includes('仍检测')
                ? 'var(--color-error-text)'
                : 'var(--color-primary)',
          }}
        >
          {msg}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <button
          className={`btn btn-sm ${selectMode ? 'btn-primary' : 'btn-secondary'}`}
          onClick={onToggleSelectMode}
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
            <button className="btn btn-sm btn-secondary" onClick={onToggleSelectAll}>
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
              disabled={deleting || selectedIds.size === 0}
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
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>类型：</span>
        {TYPE_FILTERS.map((value) => (
          <button
            key={value}
            className={`btn btn-xs ${typeFilter === value ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onTypeFilterChange(value)}
            style={{ fontSize: 11, padding: '2px 8px' }}
          >
            {value === 'all' ? '全部' : AiTaskTypeLabels[value]}
          </button>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>状态：</span>
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
              style={{ fontSize: 11, padding: '2px 8px' }}
            >
              {StatusIcon && <StatusIcon aria-hidden="true" size={13} strokeWidth={1.8} />}
              {label}
            </button>
          );
        })}
      </div>
      {(typeFilter !== 'all' || statusFilter !== 'all') && tasks.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button
            className="btn btn-xs btn-danger"
            onClick={onDeleteFiltered}
            disabled={deleting || deletableTaskCount === 0}
          >
            <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
            删除当前页的 {deletableTaskCount} 条终态记录
          </button>
        </div>
      )}
      {tasks.length === 0 ? (
        <div className="detail-card" style={{ textAlign: 'center', padding: 32 }}>
          <Bot
            aria-hidden="true"
            size={40}
            strokeWidth={1.8}
            style={{ marginBottom: 12, color: 'var(--color-text-muted)' }}
          />
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>暂无 AI 任务记录</div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-muted)',
              maxWidth: 400,
              margin: '0 auto',
            }}
          >
            当你生成正文、分析风格、推荐角色、推荐事件、总结章节或润色正文后，这里会显示任务记录。
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {pagedTasks.map((task) => (
            <AiTaskRecordCard
              key={task.id}
              task={task}
              expanded={expandedId === task.id}
              selected={selectedIds.has(task.id)}
              selectMode={selectMode}
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
                disabled={visiblePage <= 1}
                onClick={onPreviousPage}
              >
                上一页
              </button>
              <span>
                第 {visiblePage} / {totalPages} 页 · 共 {total} 条
              </span>
              <button
                className="btn btn-secondary btn-sm"
                disabled={visiblePage >= totalPages}
                onClick={onNextPage}
              >
                下一页
              </button>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}

export default AiTasksPageView;
