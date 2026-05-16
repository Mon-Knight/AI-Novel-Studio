import type { Chapter } from '../../types/chapter';

interface EditorAreaProps {
  chapter?: Chapter;
  novelTitle?: string;
}

function EditorArea({ chapter, novelTitle }: EditorAreaProps) {
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
      <div className="editor-toolbar">
        <button className="toolbar-btn">💾 保存草稿</button>
        <span className="toolbar-separator" />
        <button className="toolbar-btn">🔄 重新生成</button>
        <button className="toolbar-btn">✨ 润色</button>
        <span className="toolbar-separator" />
        <button className="toolbar-btn primary">✅ 确认采用</button>
      </div>

      <div className="editor-chapter-title">
        第{chapter.chapterNumber}章：{chapter.title}
      </div>

      {/* 章节大纲和目标 */}
      {(chapter.outline || chapter.goal) && (
        <div style={{
          maxWidth: 720, margin: '0 auto 24px', padding: '16px 20px',
          background: 'var(--color-primary-light)', borderRadius: 8,
          border: '1px solid var(--color-border)', fontSize: 14,
          color: 'var(--color-text-secondary)', lineHeight: 1.8,
        }}>
          {chapter.outline && (
            <div>
              <strong>📋 章节大纲：</strong>
              <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{chapter.outline}</div>
            </div>
          )}
          {chapter.goal && (
            <div style={{ marginTop: chapter.outline ? 8 : 0 }}>
              <strong>🎯 本章目标：</strong>{chapter.goal}
            </div>
          )}
        </div>
      )}

      {/* 正文区 */}
      <div className="editor-empty">
        <div className="editor-empty-icon">📄</div>
        <div>当前章节还没有正文</div>
        <div className="text-sm text-muted">
          后续版本将在这里生成 AI 初稿
        </div>
      </div>
    </div>
  );
}

export default EditorArea;
