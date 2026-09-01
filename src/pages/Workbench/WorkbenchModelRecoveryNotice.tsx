import type { WorkbenchModelDirectoryStatus } from '../../services/conversation/workbenchModelAvailability';
import { CircleAlert, Plus, RefreshCw, Settings } from 'lucide-react';

interface WorkbenchModelRecoveryNoticeProps {
  message: string;
  status: WorkbenchModelDirectoryStatus;
  refreshing: boolean;
  testId: string;
  onRetry: () => void;
  onOpenSettings: () => void;
  onCreateTask?: () => void;
}

export function WorkbenchModelRecoveryNotice({
  message,
  status,
  refreshing,
  testId,
  onRetry,
  onOpenSettings,
  onCreateTask,
}: WorkbenchModelRecoveryNoticeProps) {
  if (!message) return null;

  const unavailable = status === 'unavailable';

  return (
    <div
      className={`workbench-readiness-hint${unavailable ? ' is-warning' : ''}`}
      data-testid={testId}
      role={unavailable ? 'alert' : 'status'}
      aria-busy={refreshing}
    >
      <CircleAlert
        className="workbench-readiness-icon"
        aria-hidden="true"
        size={15}
        strokeWidth={1.8}
      />
      <span className="workbench-readiness-copy">{message}</span>
      {unavailable && (
        <div className="workbench-recovery-actions">
          {onCreateTask && (
            <button
              type="button"
              className="workbench-recovery-action"
              data-testid={`${testId}-create-task`}
              onClick={onCreateTask}
            >
              <Plus aria-hidden="true" size={13} strokeWidth={1.8} />
              <span>使用当前模型新建任务</span>
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
            <RefreshCw aria-hidden="true" size={13} strokeWidth={1.8} />
            <span>重试</span>
          </button>
          <button
            type="button"
            className="workbench-recovery-action"
            data-testid={`${testId}-settings`}
            onClick={onOpenSettings}
          >
            <Settings aria-hidden="true" size={13} strokeWidth={1.8} />
            <span>模型设置</span>
          </button>
        </div>
      )}
    </div>
  );
}
