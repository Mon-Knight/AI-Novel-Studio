import type { ConversationStartupRecovery } from '../../services/startup/startupCoordinator';
import { StartupDialogFrame } from './StartupDialogFrame';

export interface StartupConversationRecoveryState extends ConversationStartupRecovery {
  error?: string;
}

interface StartupConversationRecoveryDialogProps {
  recovery: StartupConversationRecoveryState;
  onDismiss: () => void;
}

function StartupConversationRecoveryDialog({
  recovery,
  onDismiss,
}: StartupConversationRecoveryDialogProps) {
  const failed = Boolean(recovery.error);
  return (
    <StartupDialogFrame
      role={failed ? 'alertdialog' : 'dialog'}
      labelledBy="startup-conversation-recovery-title"
      maxWidth={480}
      onDismiss={onDismiss}
      overlayProps={{
        'data-testid': 'conversation-recovery-dialog',
        'data-recovered-runs': String(recovery.recoveredRuns),
        'data-recovery-status': failed ? 'failed' : 'recovered',
      }}
    >
      <h2 id="startup-conversation-recovery-title" className="startup-dialog-title">
        {failed ? '创作任务恢复失败' : '创作任务已安全收尾'}
      </h2>
      <div className="startup-dialog-message" data-testid={failed ? 'error-notice' : undefined}>
        {failed
          ? '无法确认上次退出时的任务对话状态。新的创作执行已暂停，请重新启动应用后再试。'
          : `检测到 ${recovery.recoveredRuns} 个上次退出时仍在运行的创作任务，现已标记为中断。对话、工具记录和已形成的候选均已保留，系统没有自动重发请求。`}
      </div>
      <div className="startup-dialog-actions">
        <button
          type="button"
          className="btn btn-primary"
          data-testid="conversation-recovery-dismiss"
          data-startup-dialog-dismiss
          onClick={onDismiss}
        >
          知道了
        </button>
      </div>
    </StartupDialogFrame>
  );
}

export default StartupConversationRecoveryDialog;
