import type { Chapter, ChapterDraft } from '../../types/chapter';

interface StatusBarProps {
  chapter?: Chapter;
  draft?: ChapterDraft;
}

const chapterStatusLabels: Record<string, string> = {
  unwritten: '未生成',
  ai_draft: 'AI初稿',
  user_revised: '待修改',
  adopted: '已采用',
  summarized: '已总结',
};

function StatusBar({ chapter, draft }: StatusBarProps) {
  const wordCount = draft?.wordCount || chapter?.currentWords || 0;
  const targetWords = chapter?.targetWords || 0;
  const status = chapter?.status || 'unwritten';

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
        <span>{chapterStatusLabels[status]}</span>
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
