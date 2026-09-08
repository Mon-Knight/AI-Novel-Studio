import { useState } from 'react';
import type { WorkbenchModelDirectoryStatus } from '../../services/conversation/workbenchModelAvailability';
import { ChevronDown, CircleAlert, Plus, RefreshCw, Settings } from 'lucide-react';

interface WorkbenchModelRecoveryNoticeProps {
  message: string;
  status: WorkbenchModelDirectoryStatus;
  refreshing: boolean;
  testId: string;
  onRetry: () => void;
  onOpenSettings: () => void;
  onCreateTask?: () => void;
}

/**
 * Compact model-directory status bar. The full explanation stays in the DOM (and in the
 * tooltip) but is clamped to one line so the composer keeps its space for the draft;
 * the recovery actions are always one click away on the same row.
 */
export function WorkbenchModelRecoveryNotice({
  message,
  status,
  refreshing,
  testId,
  onRetry,
  onOpenSettings,
  onCreateTask,
}: WorkbenchModelRecoveryNoticeProps) {
  const [expanded, setExpanded] = useState(false);
  if (!message) return null;

  const unavailable = status === 'unavailable';

  return (
    <div
      className={`workbench-readiness-hint workbench-model-status${unavailable ? ' is-warning' : ''}${expanded ? ' is-expanded' : ''}`}
      data-testid={testId}
      data-status={status}
      role={unavailable ? 'alert' : 'status'}
      aria-busy={refreshing}
    >
      <CircleAlert
        className="workbench-readiness-icon"
        aria-hidden="true"
        size={15}
        strokeWidth={1.8}
      />
      <span className="workbench-readiness-copy workbench-model-status-copy" title={message}>
        {message}
      </span>
      <button
        type="button"
        className="workbench-model-status-expand"
        aria-label={expanded ? '收起模型说明' : '展开模型说明'}
        aria-expanded={expanded}
        title={expanded ? '收起说明' : '展开说明'}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronDown aria-hidden="true" size={13} strokeWidth={1.8} />
      </button>
      {unavailable && (
        <div className="workbench-recovery-actions">
          {onCreateTask && (
            <button
              type="button"
              className="workbench-recovery-action is-primary"
              data-testid={`${testId}-create-task`}
              aria-label="使用当前模型新建任务"
              title="使用当前设置的模型新建一个任务，草稿会带过去"
              onClick={onCreateTask}
            >
              <Plus aria-hidden="true" size={13} strokeWidth={1.8} />
              <span>新建任务</span>
            </button>
          )}
          <button
            type="button"
            className="workbench-recovery-action"
            data-testid={`${testId}-retry`}
            aria-label="重试模型目录"
            title="重试模型目录"
            disabled={refreshing}
            onClick={onRetry}
          >
            <RefreshCw
              className={refreshing ? 'is-spinning' : undefined}
              aria-hidden="true"
              size={13}
              strokeWidth={1.8}
            />
            <span>重试</span>
          </button>
          <button
            type="button"
            className="workbench-recovery-action"
            data-testid={`${testId}-settings`}
            aria-label="模型设置"
            title="打开模型设置"
            onClick={onOpenSettings}
          >
            <Settings aria-hidden="true" size={13} strokeWidth={1.8} />
            <span>设置</span>
          </button>
        </div>
      )}
    </div>
  );
}
