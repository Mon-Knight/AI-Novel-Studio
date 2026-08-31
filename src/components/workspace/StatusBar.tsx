import { formatNumber } from '../../utils/format';
import type { Chapter } from '../../types/chapter';
import { ChapterStatusLabels } from '../../types/chapter';
import type { WorkspaceRecoverySaveStatus } from '../../types/workspaceRecovery';
import type { DocumentSaveState } from './editor-area/editorAreaTypes';

interface StatusBarProps {
  chapter?: Chapter;
  draftWordCount?: number;
  isDirty?: boolean;
  draftVersion?: string;
  contentAvailable?: boolean;
  recoverySaveStatus?: WorkspaceRecoverySaveStatus;
  documentSaveState?: DocumentSaveState;
  documentSaveMessage?: string;
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
}: StatusBarProps) {
  const wordCount = draftWordCount ?? chapter?.wordCount ?? 0;
  const targetWords = chapter?.targetWordCount ?? 0;
  const status = chapter?.status || 'not_started';
  const saveStatus = resolveSaveStatus(
    contentAvailable,
    Boolean(isDirty),
    recoverySaveStatus,
    documentSaveState,
    documentSaveMessage,
    Boolean(draftVersion && draftVersion !== 'v0 占位'),
  );

  return (
    <div className="workspace-statusbar">
      {chapter && (
        <>
          <div className="statusbar-item">
            <span>第{chapter.chapterNumber}章：</span>
            <strong>{chapter.title}</strong>
          </div>
          <span className="statusbar-separator" />
        </>
      )}
      <div className="statusbar-item">
        <span>字数：</span>
        <strong data-testid="chapter-word-count" data-word-count={wordCount}>
          {formatNumber(wordCount)}
        </strong>
        <span className="text-muted"> / {formatNumber(targetWords)}</span>
      </div>
      <span className="statusbar-separator" />
      <div className="statusbar-item">
        <span>状态：</span>
        <span
          style={{
            color:
              status === 'not_started'
                ? 'var(--color-text-muted)'
                : status === 'outline_ready'
                  ? 'var(--color-primary)'
                  : status === 'adopted'
                    ? 'var(--color-success)'
                    : status === 'summarized'
                      ? 'var(--color-success)'
                      : 'var(--color-warning)',
          }}
        >
          {ChapterStatusLabels[status]}
        </span>
      </div>
      <span className="statusbar-separator" />
      <div className="statusbar-item">
        <span>草稿：</span>
        <span>{draftVersion || 'v0 占位'}</span>
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
        >
          {saveStatus.label}
        </span>
      </div>
    </div>
  );
}

export default StatusBar;
