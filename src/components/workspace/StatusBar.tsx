import { formatNumber } from '../../utils/format';
import type { Chapter } from '../../types/chapter';
import { ChapterStatusLabels } from '../../types/chapter';
import type { WorkspaceRecoverySaveStatus } from '../../types/workspaceRecovery';

interface StatusBarProps {
  chapter?: Chapter;
  draftWordCount?: number;
  isDirty?: boolean;
  draftVersion?: string;
  contentAvailable?: boolean;
  recoverySaveStatus?: WorkspaceRecoverySaveStatus;
}

function StatusBar({
  chapter,
  draftWordCount,
  isDirty,
  draftVersion,
  contentAvailable = true,
  recoverySaveStatus = 'idle',
}: StatusBarProps) {
  const wordCount = draftWordCount ?? chapter?.wordCount ?? 0;
  const targetWords = chapter?.targetWordCount ?? 0;
  const status = chapter?.status || 'not_started';

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
      <div className="statusbar-item">
        <span className={`status-dot ${isDirty || !contentAvailable ? 'unsaved' : 'saved'}`} />
        <span>
          {!contentAvailable
            ? '正文不可用'
            : isDirty && recoverySaveStatus === 'saving'
              ? '正在更新恢复快照'
              : isDirty && recoverySaveStatus === 'saved'
                ? '未保存 · 恢复快照已更新'
                : isDirty && recoverySaveStatus === 'failed'
                  ? '未保存 · 恢复快照失败'
                  : isDirty
                    ? '未保存'
                    : '已保存'}
        </span>
      </div>
    </div>
  );
}

export default StatusBar;
