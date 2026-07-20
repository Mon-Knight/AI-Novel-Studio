import { formatNumber } from '../../utils/format';
import type { Chapter } from '../../types/chapter';
import { ChapterStatusLabels } from '../../types/chapter';

interface StatusBarProps {
  chapter?: Chapter;
  draftWordCount?: number;
  isDirty?: boolean;
  draftVersion?: string;
}

function StatusBar({ chapter, draftWordCount, isDirty, draftVersion }: StatusBarProps) {
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
        <strong data-testid="chapter-word-count" data-word-count={wordCount}>{formatNumber(wordCount)}</strong>
        <span className="text-muted"> / {formatNumber(targetWords)}</span>
      </div>
      <span className="statusbar-separator" />
      <div className="statusbar-item">
        <span>状态：</span>
        <span style={{
          color:
            status === 'not_started' ? 'var(--color-text-muted)' :
            status === 'outline_ready' ? 'var(--color-primary)' :
            status === 'adopted' ? 'var(--color-success)' :
            status === 'summarized' ? '#059669' : 'var(--color-warning)',
        }}>
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
        <span className={`status-dot ${isDirty ? 'unsaved' : 'saved'}`} />
        <span>{isDirty ? '未保存' : '已保存'}</span>
      </div>
    </div>
  );
}

export default StatusBar;
