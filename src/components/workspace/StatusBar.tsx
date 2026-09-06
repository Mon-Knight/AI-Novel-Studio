import { formatNumber } from '../../utils/format';
import type { Chapter } from '../../types/chapter';
import type { WorkspaceRecoverySaveStatus } from '../../types/workspaceRecovery';
import type { DocumentSaveState, DocumentAdoptState } from './editor-area/editorAreaTypes';

interface StatusBarProps {
  chapter?: Chapter;
  draftWordCount?: number;
  isDirty?: boolean;
  draftVersion?: string;
  contentAvailable?: boolean;
  recoverySaveStatus?: WorkspaceRecoverySaveStatus;
  documentSaveState?: DocumentSaveState;
  documentSaveMessage?: string;
  documentAdoptState?: DocumentAdoptState;
  documentAdoptMessage?: string;
  draftAdopted?: boolean;
}

function resolveSaveStatus(
  contentAvailable: boolean,
  isDirty: boolean,
  recoverySaveStatus: WorkspaceRecoverySaveStatus,
  documentSaveState: DocumentSaveState,
  documentSaveMessage: string,
  hasPersistedDraft: boolean,
): { label: string; tone: 'saved' | 'unsaved' | 'saving' | 'error' } {
  if (!contentAvailable) return { label: '正文不可用', tone: 'error' };
  if (documentSaveState === 'saving') return { label: '正在保存正文', tone: 'saving' };
  if (documentSaveState === 'error') {
    return { label: documentSaveMessage || '正文保存失败', tone: 'error' };
  }
  if (isDirty && recoverySaveStatus === 'saving') {
    return { label: '未保存 · 正在更新恢复快照', tone: 'unsaved' };
  }
  if (isDirty && recoverySaveStatus === 'failed') {
    return { label: '未保存 · 恢复快照失败', tone: 'error' };
  }
  if (isDirty && recoverySaveStatus === 'saved') {
    return { label: '未保存 · 恢复快照已更新', tone: 'unsaved' };
  }
  if (isDirty || documentSaveState === 'editing') {
    return { label: '未保存', tone: 'unsaved' };
  }
  if (documentSaveState === 'saved' || hasPersistedDraft) {
    return { label: '已保存', tone: 'saved' };
  }
  return { label: '未保存', tone: 'unsaved' };
}

function StatusBar({
  chapter,
  draftWordCount,
  isDirty,
  draftVersion,
  contentAvailable = true,
  recoverySaveStatus = 'idle',
  documentSaveState = 'idle',
  documentSaveMessage = '',
  documentAdoptState = 'idle',
  documentAdoptMessage = '',
  draftAdopted = false,
}: StatusBarProps) {
  const wordCount = draftWordCount ?? chapter?.wordCount ?? 0;
  const targetWords = chapter?.targetWordCount ?? 0;
  const saveStatus = resolveSaveStatus(
    contentAvailable,
    Boolean(isDirty),
    recoverySaveStatus,
    documentSaveState,
    documentSaveMessage,
    Boolean(draftVersion && draftVersion !== 'v0 占位'),
  );
  const adoptLabel =
    documentAdoptState === 'error'
      ? documentAdoptMessage || '采用失败'
      : documentAdoptState === 'confirming'
        ? '等待确认采用'
        : documentAdoptState === 'adopting'
          ? '正在采用'
          : !isDirty && (documentAdoptState === 'adopted' || draftAdopted)
            ? '已采用为正式正文'
            : '当前内容未采用';

  return (
    <div className="workspace-statusbar">
      <div className="statusbar-item">
        <span>字数：</span>
        <strong data-testid="chapter-word-count" data-word-count={wordCount}>
          {formatNumber(wordCount)}
        </strong>
        <span className="text-muted"> / {formatNumber(targetWords)}</span>
      </div>
      <span className="statusbar-separator" />
      <div
        className={`statusbar-item statusbar-save-state is-${saveStatus.tone}`}
        data-testid="document-save-status"
        data-save-state={documentSaveState}
        data-save-tone={saveStatus.tone}
      >
        <span className={`status-dot ${saveStatus.tone}`} aria-hidden="true" />
        <span
          className="statusbar-save-label"
          aria-live="polite"
          role={saveStatus.tone === 'error' ? 'alert' : 'status'}
          title={saveStatus.label}
        >
          {saveStatus.label}
        </span>
      </div>
      <span className="statusbar-separator" />
      <div
        className={`statusbar-item statusbar-adopt-state is-${documentAdoptState}`}
        data-testid="document-adopt-status"
        data-adopt-state={documentAdoptState}
      >
        <span role={documentAdoptState === 'error' ? 'alert' : 'status'} title={adoptLabel}>
          {adoptLabel}
        </span>
      </div>
    </div>
  );
}

export default StatusBar;
