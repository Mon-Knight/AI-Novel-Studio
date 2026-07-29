import { memo } from 'react';
import { formatDateTime } from '../../utils/date';
import { formatTokenCount } from '../../utils/format';
import type { AiTaskRecord } from '../../types/ai';
import { AiTaskTypeLabels } from '../../types/ai';
import { formatUsd, type ActiveExecutionState } from './aiTasksPresentation';

interface AiTaskRecordCardProps {
  task: AiTaskRecord;
  expanded: boolean;
  selected: boolean;
  selectMode: boolean;
  activeExecutionState: ActiveExecutionState;
  onToggleSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onStop: (task: AiTaskRecord) => void;
  onDelete: (task: AiTaskRecord) => void;
}

function statusLabel(status: AiTaskRecord['status']): string {
  return status === 'succeeded'
    ? '成功'
    : status === 'failed'
      ? '失败'
      : status === 'cancelled'
        ? '已取消'
        : status === 'running'
          ? '运行中'
          : '等待';
}

function statusColor(status: AiTaskRecord['status']): string {
  return status === 'succeeded'
    ? 'var(--color-success)'
    : status === 'failed'
      ? 'var(--color-error)'
      : status === 'cancelled'
        ? 'var(--color-text-muted)'
        : 'var(--color-warning)';
}

function statusBackground(status: AiTaskRecord['status']): string {
  return status === 'succeeded'
    ? 'var(--color-success-bg)'
    : status === 'failed'
      ? 'var(--color-error-bg)'
      : status === 'cancelled'
        ? 'var(--color-bg-hover)'
        : 'var(--color-warning-bg)';
}

function statusTextColor(status: AiTaskRecord['status']): string {
  return status === 'succeeded'
    ? 'var(--color-success-text)'
    : status === 'failed'
      ? 'var(--color-error-text)'
      : status === 'cancelled'
        ? 'var(--color-text-secondary)'
        : 'var(--color-warning-text)';
}

function AiTaskRecordCard({
  task,
  expanded,
  selected,
  selectMode,
  activeExecutionState,
  onToggleSelect,
  onToggleExpand,
  onStop,
  onDelete,
}: AiTaskRecordCardProps) {
  const canStop =
    (task.status === 'running' || task.status === 'pending') && activeExecutionState !== 'inactive';
  const canDelete =
    task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled';

  return (
    <div
      className="detail-card"
      style={{
        cursor: 'pointer',
        borderLeft: `3px solid ${statusColor(task.status)}`,
        background: selected ? 'var(--color-primary-light)' : undefined,
      }}
      onClick={() => (selectMode ? canDelete && onToggleSelect(task.id) : onToggleExpand(task.id))}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              flexWrap: 'wrap',
              marginBottom: 4,
            }}
          >
            {selectMode && canDelete && (
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(task.id)}
                onClick={(event) => event.stopPropagation()}
              />
            )}
            <span style={{ fontWeight: 600, fontSize: 13 }}>{AiTaskTypeLabels[task.taskType]}</span>
            <span
              style={{
                fontSize: 11,
                padding: '1px 6px',
                borderRadius: 3,
                background: statusBackground(task.status),
                color: statusTextColor(task.status),
              }}
            >
              {statusLabel(task.status)}
            </span>
            {task.modelName && (
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                {task.modelName}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {task.inputSummary && task.inputSummary.slice(0, 60)}
            {task.inputSummary && task.inputSummary.length > 60 && '…'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
            {formatDateTime(task.createdAt)}
            {task.finishedAt && ` → ${formatDateTime(task.finishedAt)}`}
          </div>
        </div>
        {!selectMode && (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 8 }}
          >
            {canStop && (
              <button
                className="btn btn-secondary btn-xs"
                onClick={(event) => {
                  event.stopPropagation();
                  onStop(task);
                }}
                disabled={activeExecutionState === 'cancelling'}
                title="停止当前 AI 请求"
              >
                {activeExecutionState === 'cancelling' ? '停止中' : '停止'}
              </button>
            )}
            {canDelete && (
              <button
                className="btn btn-text btn-sm"
                style={{ color: 'var(--color-error)', fontSize: 16 }}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(task);
                }}
                title="删除此记录"
              >
                🗑️
              </button>
            )}
          </div>
        )}
      </div>
      {expanded && (
        <div
          style={{
            marginTop: 8,
            padding: 8,
            background: 'var(--color-bg-primary)',
            borderRadius: 4,
            fontSize: 11,
          }}
        >
          <div>
            <strong>任务 ID：</strong>
            {task.id}
          </div>
          {task.novelId && (
            <div>
              <strong>作品 ID：</strong>
              {task.novelId}
            </div>
          )}
          {task.chapterId && (
            <div>
              <strong>章节 ID：</strong>
              {task.chapterId}
            </div>
          )}
          {task.modelName && (
            <div>
              <strong>模型：</strong>
              {task.modelName}
            </div>
          )}
          {task.tokenInput != null && (
            <div>
              <strong>输入 Token：</strong>
              {formatTokenCount(task.tokenInput)}
            </div>
          )}
          {task.tokenOutput != null && (
            <div>
              <strong>输出 Token：</strong>
              {formatTokenCount(task.tokenOutput)}
            </div>
          )}
          {task.costStatus === 'complete' && task.costEstimate !== undefined && (
            <div>
              <strong>成本：</strong>
              {formatUsd(task.costEstimate)}
            </div>
          )}
          {task.costStatus === 'unpriced' && (
            <div>
              <strong>成本：</strong>未配置模型单价
            </div>
          )}
          {task.costStatus === 'usage_missing' && (
            <div>
              <strong>成本：</strong>Provider 未返回完整用量
            </div>
          )}
          {task.costStatus === 'mock' && (
            <div>
              <strong>成本：</strong>
              {formatUsd(0)}
            </div>
          )}
          {task.errorMessage && (
            <div style={{ color: 'var(--color-error)', marginTop: 4 }}>
              <strong>错误：</strong>
              {task.errorMessage}
            </div>
          )}
          {task.resultText && (
            <div
              style={{
                marginTop: 4,
                whiteSpace: 'pre-wrap',
                maxHeight: 120,
                overflowY: 'auto',
                background: 'var(--color-bg-hover)',
                padding: 6,
                borderRadius: 3,
              }}
            >
              {task.resultText.slice(0, 300)}
              {task.resultText.length > 300 && '…'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(AiTaskRecordCard);
