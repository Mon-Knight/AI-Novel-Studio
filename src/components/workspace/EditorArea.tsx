import { useState, useEffect, useRef, useCallback } from 'react';
import type { Chapter } from '../../types/chapter';
import type { ChapterDraftPreview } from '../../services/database/draftService';
import { draftService } from '../../services/database/draftService';
import { ChapterStatusLabels } from '../../types/chapter';

interface EditorAreaProps {
  chapter?: Chapter;
  novelTitle?: string;
  novelId?: string;
  onOpenPanel?: (panel: string) => void;
  onDraftChange?: (wordCount: number, isDirty: boolean) => void;
}

function countWords(text: string): number {
  const cleaned = text.replace(/[#*\-`>\s]+/g, ' ').trim();
  if (!cleaned) return 0;
  const cjk = (cleaned.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const words = (cleaned.match(/[a-zA-Z0-9]+/g) || []).length;
  return cjk + words;
}

function EditorArea({ chapter, novelTitle, novelId, onOpenPanel, onDraftChange }: EditorAreaProps) {
  const [draft, setDraft] = useState<ChapterDraftPreview | null>(null);
  const [content, setContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [lastSaved, setLastSaved] = useState<string>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 加载草稿
  useEffect(() => {
    if (chapter) {
      draftService.getByChapterId(chapter.id).then((d) => {
        setDraft(d);
        setContent(d?.content || '');
        setIsDirty(false);
        setLastSaved(d?.updatedAt ? new Date(d.updatedAt).toLocaleTimeString('zh-CN') : '');
        onDraftChange?.(d?.wordCount || 0, false);
      }).catch(() => {
        setDraft(null);
        setContent('');
        setIsDirty(false);
      });
    } else {
      setDraft(null);
      setContent('');
      setIsDirty(false);
    }
  }, [chapter?.id]);

  const handleContentChange = (value: string) => {
    setContent(value);
    const wc = countWords(value);
    setIsDirty(wc !== (draft?.wordCount || 0) || value !== (draft?.content || ''));
    onDraftChange?.(wc, value !== (draft?.content || ''));
  };

  const handleSave = useCallback(async () => {
    if (!chapter || !novelId) return;
    try {
      const result = await draftService.save({
        novelId,
        chapterId: chapter.id,
        content,
        source: 'user_edited',
      });
      setDraft(result);
      setIsDirty(false);
      setSaveMsg('已保存');
      setLastSaved(new Date().toLocaleTimeString('zh-CN'));
      onDraftChange?.(result.wordCount, false);
      setTimeout(() => setSaveMsg(''), 2000);
    } catch {
      setSaveMsg('保存失败');
      setTimeout(() => setSaveMsg(''), 3000);
    }
  }, [chapter, novelId, content, onDraftChange]);

  // Ctrl+S 保存
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isDirty, handleSave]);

  if (!chapter) {
    return (
      <div className="editor-content">
        <div className="editor-empty">
          <div className="editor-empty-icon">📝</div>
          <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>选择章节开始写作</div>
          <div className="text-sm text-muted">请从左侧目录树中选择一个章节</div>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-content">
      {/* 工具栏 */}
      <div className="editor-toolbar">
        <button
          className={`toolbar-btn ${isDirty ? '' : ''}`}
          onClick={handleSave}
          title="Ctrl+S 保存"
          style={{ color: isDirty ? 'var(--color-warning)' : undefined }}
        >
          💾 {saveMsg || (isDirty ? '保存草稿 *' : '保存草稿')}
        </button>
        <span className="toolbar-separator" />
        <button className="toolbar-btn" onClick={() => onOpenPanel?.('ai-generate')}>
          🤖 AI 生成
        </button>
        <button className="toolbar-btn" onClick={() => onOpenPanel?.('outline')}>
          📋 查看大纲
        </button>
        <span className="toolbar-separator" />
        <button className="toolbar-btn" onClick={() => {
          const cleaned = content.replace(/\n{3,}/g, '\n\n').trim();
          handleContentChange(cleaned);
          setSaveMsg('已排版');
          setTimeout(() => setSaveMsg(''), 2000);
        }}>
          📐 一键排版
        </button>
        <span className="toolbar-separator" />
        <button className="toolbar-btn primary" onClick={() => setSaveMsg('正式采用功能将在 v0.5.0 接入')}>
          ✅ 确认采用
        </button>
      </div>

      {/* 章节标题 */}
      <div className="editor-chapter-title">
        第{chapter.chapterNumber}章：{chapter.title}
      </div>

      {/* 章节信息卡片 */}
      <div className="editor-info-card">
        {chapter.outline && (
          <div className="editor-info-section">
            <div className="editor-info-label">📋 章节大纲</div>
            <div className="editor-info-text">{chapter.outline}</div>
          </div>
        )}
        {chapter.goal && (
          <div className="editor-info-section">
            <div className="editor-info-label">🎯 本章目标</div>
            <div className="editor-info-text">{chapter.goal}</div>
          </div>
        )}
        <div className="editor-info-meta">
          <span>状态：{ChapterStatusLabels[chapter.status]}</span>
          <span>目标字数：{(chapter.targetWordCount || 0).toLocaleString()} 字</span>
          {lastSaved && <span>上次保存：{lastSaved}</span>}
        </div>
      </div>

      {!chapter.outline && (
        <div className="editor-hint-banner">
          💡 当前章节还没有大纲，建议先在作品详情页补充章节大纲，后续 AI 将根据大纲生成正文。
        </div>
      )}

      {/* 正文编辑区 - 纸张风格 */}
      <div className="editor-paper">
        <textarea
          ref={textareaRef}
          className="editor-textarea"
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          placeholder="在这里输入或粘贴正文内容...&#10;&#10;v0.5.0 将支持 AI 根据大纲自动生成正文。"
          spellCheck={false}
        />
      </div>

      {/* 空状态提示 */}
      {!content && (
        <div className="editor-empty-state">
          <div className="editor-empty-icon">✍️</div>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>当前章节还没有正文</div>
          <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
            你可以先查看本章大纲、选择风格和输出控制。
            <br />v0.5.0 将在这里接入 AI 正文生成。
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={() => onOpenPanel?.('ai-generate')}>
              🤖 打开 AI 生成面板
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => onOpenPanel?.('outline')}>
              📋 查看大纲
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default EditorArea;
