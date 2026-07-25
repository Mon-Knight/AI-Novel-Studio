import type { PendingWorkspaceLeave } from '../../types/workspaceLeave';

interface WorkspaceLeaveDialogProps {
  request: PendingWorkspaceLeave;
  busy?: boolean;
  errorMessage?: string;
  saveDisabled?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

function WorkspaceLeaveDialog({
  request,
  busy = false,
  errorMessage,
  saveDisabled = false,
  onSave,
  onDiscard,
  onCancel,
}: WorkspaceLeaveDialogProps) {
  return (
    <div className="modal-overlay workspace-leave-overlay" role="presentation">
      <div
        className="modal-dialog workspace-leave-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-leave-title"
        data-testid="workspace-leave-dialog"
        data-leave-reason={request.reason}
      >
        <div className="modal-title" id="workspace-leave-title">
          {saveDisabled ? '正文暂时无法完整读取' : '正文尚未保存'}
        </div>
        {saveDisabled ? (
          <>
            <p>为避免用截断内容覆盖完整正文，编辑与保存功能已暂停。</p>
            <p className="text-muted">可以继续离开或取消；继续离开不会删除恢复快照或修改持久正文。</p>
          </>
        ) : (
          <>
            <p>当前章节存在未保存修改。离开前请选择如何处理。</p>
            <p className="text-muted">恢复快照不等同于正式保存；只有“保存并继续”会写入正式草稿。</p>
          </>
        )}
        {errorMessage && <div className="workspace-leave-error" role="alert">{errorMessage}</div>}
        <div className="workspace-leave-actions">
          {!saveDisabled && (
            <button
              className="btn btn-primary"
              data-testid="workspace-leave-save"
              onClick={onSave}
              disabled={busy}
            >
              {busy ? '正在处理…' : '保存并继续'}
            </button>
          )}
          <button
            className={saveDisabled ? 'btn btn-primary' : 'btn btn-danger'}
            data-testid="workspace-leave-discard"
            onClick={onDiscard}
            disabled={busy}
          >
            {saveDisabled ? '继续离开' : '放弃修改并继续'}
          </button>
          <button
            className="btn btn-secondary"
            data-testid="workspace-leave-cancel"
            onClick={onCancel}
            disabled={busy}
          >取消</button>
        </div>
      </div>
    </div>
  );
}

export default WorkspaceLeaveDialog;
