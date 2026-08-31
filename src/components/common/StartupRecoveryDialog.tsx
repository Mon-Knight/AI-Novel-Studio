import type { StartupGenerationRecovery } from '../../types/generationJob';
import { StartupDialogFrame } from './StartupDialogFrame';

export interface StartupRecoveryState extends StartupGenerationRecovery {
  error?: string;
}

interface StartupRecoveryDialogProps {
  recovery: StartupRecoveryState;
  onDismiss: () => void;
}

function StartupRecoveryDialog({ recovery, onDismiss }: StartupRecoveryDialogProps) {
  const failed = Boolean(recovery.error);

  return (
    <StartupDialogFrame
      role={failed ? 'alertdialog' : 'dialog'}
      labelledBy="startup-recovery-title"
      maxWidth={480}
      onDismiss={onDismiss}
      overlayProps={{
        'data-testid': 'recovery-dialog',
        'data-recovered-jobs': String(recovery.recoveredJobs),
        'data-recovery-status': failed ? 'failed' : 'recovered',
      }}
    >
      <h2 id="startup-recovery-title" className="startup-dialog-title">
        {failed ? '任务恢复检查失败' : '生成任务已安全收尾'}
      </h2>
      <div className="startup-dialog-message" data-testid={failed ? 'error-notice' : undefined}>
        {failed
          ? '无法确认上次退出时的生成任务状态。请暂时不要重复启动旧任务，并查看诊断日志。'
          : `检测到 ${recovery.recoveredJobs} 个在上次退出时尚未完成的章节生成任务，现已标记为失败。已完成的步骤、草稿和质量结果均已保留；系统没有自动重发 AI 请求。`}
      </div>
      <div className="startup-dialog-actions">
        <button
          type="button"
          className="btn btn-primary"
          data-testid="recovery-dismiss"
          data-startup-dialog-dismiss
          onClick={onDismiss}
        >
          知道了
        </button>
      </div>
    </StartupDialogFrame>
  );
}

export default StartupRecoveryDialog;
