import type { Chapter, ChapterDraft } from '../../types/chapter';

interface EditorAreaProps {
  chapter?: Chapter;
  draft?: ChapterDraft;
  novelTitle?: string;
}

function EditorArea({ chapter, draft, novelTitle }: EditorAreaProps) {
  if (!chapter) {
    return (
      <div className="editor-content">
        <div className="editor-empty">
          <div className="editor-empty-icon">📝</div>
          <div>请从左侧目录树中选择一个章节</div>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-content">
      {/* 工具栏 */}
      <div className="editor-toolbar">
        <button className="toolbar-btn">💾 保存草稿</button>
        <span className="toolbar-separator" />
        <button className="toolbar-btn">🔄 重新生成</button>
        <button className="toolbar-btn">✨ 润色</button>
        <span className="toolbar-separator" />
        <button className="toolbar-btn primary">✅ 确认采用</button>
      </div>

      {/* 正文区 */}
      <div className="editor-chapter-title">
        第{chapter.chapterNumber}章：{chapter.title}
      </div>

      {draft ? (
        <div className="editor-body" contentEditable={true} suppressContentEditableWarning={true}>
          {draft.content}
        </div>
      ) : (
        <div className="editor-empty">
          <div className="editor-empty-icon">📄</div>
          <div>本章尚未生成正文</div>
          <div className="text-sm text-muted">
            请点击右侧「AI生成」面板生成本章内容
          </div>
        </div>
      )}
    </div>
  );
}

export default EditorArea;
