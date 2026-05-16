import type { Chapter } from '../../types/chapter';
import { ChapterStatusLabels } from '../../types/chapter';

interface StatusBarProps {
  chapter?: Chapter;
}

function StatusBar({ chapter }: StatusBarProps) {
  const wordCount = chapter?.wordCount ?? 0;
  const targetWords = chapter?.targetWordCount ?? 0;
  const status = chapter?.status || 'not_started';

  return (
    <div className="workspace-statusbar">
      <div className="statusbar-item">
        <span>本章：</span>
        <strong>{wordCount.toLocaleString()} 字</strong>
      </div>
      <span className="statusbar-separator" />
      <div className="statusbar-item">
        <span>目标：</span>
        <strong>{targetWords.toLocaleString()} 字</strong>
      </div>
      <span className="statusbar-separator" />
      <div className="statusbar-item">
        <span>状态：</span>
        <span>{ChapterStatusLabels[status]}</span>
      </div>
      <span className="statusbar-separator" />
      <div className="statusbar-item">
        <span className="status-dot saved" />
        <span>已保存</span>
      </div>
    </div>
  );
}

export default StatusBar;
