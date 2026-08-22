import { useState } from 'react';
import type { RecoveryPromptState } from '../../types/workspaceRecovery';
import { formatDateTime } from '../../utils/date';
import { countTextWords } from '../../utils/contentHash';

interface RecoveryDialogProps {
  state: Exclude<RecoveryPromptState, { status: 'none' | 'loading' }>;
  currentContent?: string;
  busy?: boolean;
  onRestore: () => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
  onLater: () => void;
  onSaveAsDraft?: () => void | Promise<void>;
}

function downloadRecovery(content: string, chapterId: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `recovery-${chapterId}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function RecoveryDialog({
  state,
  currentContent = '',
  busy = false,
  onRestore,
  onDiscard,
  onLater,
  onSaveAsDraft,
}: RecoveryDialogProps) {
  const [showComparison, setShowComparison] = useState(false);
  const snapshot = state.snapshot;
  const conflict = state.status === 'conflict';

  return (
    <div className="modal-overlay workspace-recovery-overlay" role="presentation">
      <div
        className="modal-dialog workspace-recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-recovery-title"
        data-testid="workspace-recovery-dialog"
      >
        <div className="modal-title" id="workspace-recovery-title">
          {conflict ? '⚠️ 发现旧版本恢复内容' : '🛟 发现未保存正文'}
        </div>
        <p>这是上次未保存的编辑内容，它尚未成为正式草稿；恢复后仍需再次保存。</p>
        {conflict && (
          <div className="workspace-recovery-conflict" role="alert">
            恢复内容基于旧版正文，已禁止直接覆盖当前正文。你仍可查看、复制、导出或另存为候选草稿。
          </div>
        )}
        <dl className="workspace-recovery-meta">
          <div>
            <dt>更新时间</dt>
            <dd>{formatDateTime(snapshot.updatedAt)}</dd>
          </div>
          <div>
            <dt>恢复字数</dt>
            <dd>{countTextWords(snapshot.recoveryContent)}</dd>
          </div>
          <div>
            <dt>基础草稿</dt>
            <dd>{snapshot.baseDraftVersion ? `v${snapshot.baseDraftVersion}` : '无'}</dd>
          </div>
          <div>
            <dt>基线状态</dt>
            <dd>{conflict ? '存在冲突' : '匹配'}</dd>
          </div>
        </dl>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setShowComparison((value) => !value)}
        >
          {showComparison ? '收起内容' : '查看差异'}
        </button>
        {showComparison && (
          <div className="workspace-recovery-compare">
            <section>
              <h4>当前正文</h4>
              <pre>{currentContent || '（当前正文不可用或为空）'}</pre>
            </section>
            <section>
              <h4>恢复内容</h4>
              <pre>{snapshot.recoveryContent}</pre>
            </section>
          </div>
        )}
        <div className="workspace-recovery-actions">
          {!conflict && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => void onRestore()}
              disabled={busy}
            >
              恢复
            </button>
          )}
          {conflict && onSaveAsDraft && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => void onSaveAsDraft()}
              disabled={busy}
            >
              另存为候选草稿
            </button>
          )}
          {conflict && (
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => void navigator.clipboard.writeText(snapshot.recoveryContent)}
                disabled={busy}
              >
                复制内容
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => downloadRecovery(snapshot.recoveryContent, snapshot.chapterId)}
                disabled={busy}
              >
                导出
              </button>
            </>
          )}
          <button className="btn btn-secondary btn-sm" onClick={onLater} disabled={busy}>
            稍后处理
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => void onDiscard()}
            disabled={busy}
          >
            放弃恢复
          </button>
        </div>
      </div>
    </div>
  );
}

export default RecoveryDialog;
