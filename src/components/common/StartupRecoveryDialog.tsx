import { useEffect, useState } from 'react';
import type { StartupGenerationRecovery } from '../../types/generationJob';

export interface StartupRecoveryState extends StartupGenerationRecovery {
  error?: string;
}

interface StartupRecoveryDialogProps {
  recovery: StartupRecoveryState;
}

function StartupRecoveryDialog({ recovery }: StartupRecoveryDialogProps) {
  const shouldOpen = recovery.recoveredJobs > 0 || Boolean(recovery.error);
  const [open, setOpen] = useState(shouldOpen);

  useEffect(() => {
    setOpen(shouldOpen);
  }, [shouldOpen]);

  if (!open) return null;
  const failed = Boolean(recovery.error);

  return (
    <div
      className="modal-overlay"
      role={failed ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      aria-labelledby="startup-recovery-title"
      data-testid="recovery-dialog"
      data-recovered-jobs={String(recovery.recoveredJobs)}
      data-recovery-status={failed ? 'failed' : 'recovered'}
    >
      <div className="modal-dialog" style={{ maxWidth: 480 }}>
        <div id="startup-recovery-title" className="modal-title">
          {failed ? '任务恢复检查失败' : '生成任务已安全收尾'}
        </div>
        <div
          data-testid={failed ? 'error-notice' : undefined}
          style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, color: 'var(--color-text-secondary)' }}
        >
          {failed
            ? '无法确认上次退出时的生成任务状态。请暂时不要重复启动旧任务，并查看诊断日志。'
            : `检测到 ${recovery.recoveredJobs} 个在上次退出时尚未完成的章节生成任务，现已标记为失败。已完成的步骤、草稿和质量结果均已保留；系统没有自动重发 AI 请求。`}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="recovery-dismiss"
            onClick={() => setOpen(false)}
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}

export default StartupRecoveryDialog;
