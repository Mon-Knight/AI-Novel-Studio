import { useState, useEffect, useRef, useCallback } from 'react';
import type { Chapter } from '../../types/chapter';
import type { ChapterDraft } from '../../types/ai';
import { draftVersionService } from '../../services/database/draftVersionService';
import { ChapterStatusLabels } from '../../types/chapter';
import { formatDateTime } from '../../utils/date';
import { formatNumber } from '../../utils/format';
import { runWithLoading } from '../../lib/runWithLoading';

interface EditorAreaProps {
  chapter?: Chapter;
  novelTitle?: string;
  novelId?: string;
  currentDraft?: ChapterDraft | null;
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

function EditorArea({ chapter, novelTitle, novelId, currentDraft, onOpenPanel, onDraftChange }: EditorAreaProps) {
  const [content, setContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [lastSaved, setLastSaved] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 加载当前草稿
  useEffect(() => {
    if (currentDraft) {
      setContent(currentDraft.content);
      setIsDirty(false);
      setLastSaved(formatDateTime(currentDraft.updatedAt));
      onDraftChange?.(currentDraft.wordCount, false);
    } else if (chapter) {
      setContent('');
      setIsDirty(false);
      setLastSaved('');
      onDraftChange?.(0, false);
    }
  }, [currentDraft?.id, chapter?.id]);

  const handleContentChange = (value: string) => {
    setContent(value);
    const wc = countWords(value);
    setIsDirty(wc !== (currentDraft?.wordCount || 0) || value !== (currentDraft?.content || ''));
    onDraftChange?.(wc, value !== (currentDraft?.content || ''));
  };

  const handleSave = useCallback(async () => {
    if (!chapter || !novelId) return;
    try {
      await runWithLoading(
        {
          title: '正在保存草稿',
          initialMessage: '正在保存正文……',
          successMessage: '草稿已保存',
          errorMessage: '保存失败',
          successAutoCloseMs: 800,
        },
        async ({ setMessage }) => {
          if (currentDraft && !currentDraft.isAdopted) {
            setMessage('正在更新草稿……');
            await draftVersionService.update(currentDraft.id, chapter.id, content, 'user_edited');
          } else {
            setMessage('正在创建草稿……');
            await draftVersionService.create({
              novelId, chapterId: chapter.id, content, source: 'user_edited',
            });
          }
        },
      );
      setIsDirty(false);
      setSaveMsg('已保存');
      setLastSaved(formatDateTime(new Date()));
      setTimeout(() => setSaveMsg(''), 2000);
    } catch {
      setSaveMsg('保存失败');
      setTimeout(() => setSaveMsg(''), 3000);
    }
  }, [chapter, novelId, content, currentDraft]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (isDirty) handleSave(); }
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

  const draftSourceLabel: Record<string, string> = {
    ai_generated: 'AI 初稿', ai_regenerated: 'AI 重生成',
    user_edited: '用户编辑', ai_polished: 'AI 润色',
    imported: '导入', manual_placeholder: '手动占位',
  };

  return (
    <div className="editor-content">
      <div className="editor-toolbar">
        <button className={`toolbar-btn`} onClick={handleSave} title="Ctrl+S 保存"
          style={{ color: isDirty ? 'var(--color-warning)' : undefined }}>
          💾 {saveMsg || (isDirty ? '保存草稿 *' : '保存草稿')}
        </button>
        <span className="toolbar-separator" />
        <button className="toolbar-btn" onClick={() => onOpenPanel?.('ai-generate')}>🤖 AI 生成</button>
        <button className="toolbar-btn" onClick={() => onOpenPanel?.('outline')}>📋 查看大纲</button>
        <button className="toolbar-btn" onClick={() => onOpenPanel?.('draft-history')}>📋 草稿历史</button>
        <span className="toolbar-separator" />
        <button className="toolbar-btn" onClick={() => { handleContentChange(content.replace(/\n{3,}/g, '\n\n').trim()); setSaveMsg('已排版'); setTimeout(() => setSaveMsg(''), 2000); }}>📐 一键排版</button>
        <span className="toolbar-separator" />
        <button className="toolbar-btn primary" onClick={() => onOpenPanel?.('ai-generate')}>✅ 确认采用</button>
      </div>

      <div className="editor-chapter-title">第{chapter.chapterNumber}章：{chapter.title}</div>

      {/* 草稿版本信息 */}
      {currentDraft && (
        <div style={{
          maxWidth: 880, margin: '0 auto 12px', padding: '8px 16px',
          background: currentDraft.isAdopted ? '#e8f5e9' : 'var(--color-bg-hover)',
          borderRadius: 6, fontSize: 13, display: 'flex', alignItems: 'center', gap: 16,
          border: currentDraft.isAdopted ? '1px solid #c8e6c9' : '1px solid var(--color-border-light)',
        }}>
          <span>📄 草稿 v{currentDraft.versionNo}</span>
          <span>来源：{draftSourceLabel[currentDraft.source] || currentDraft.source}</span>
          <span>字数：{formatNumber(currentDraft.wordCount)}</span>
          {currentDraft.isAdopted && <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>✅ 已采用</span>}
        </div>
      )}

      {/* 章节信息卡片 */}
      {(chapter.outline || chapter.goal) && (
        <div className="editor-info-card">
          {chapter.outline && <div className="editor-info-section"><div className="editor-info-label">📋 章节大纲</div><div className="editor-info-text">{chapter.outline}</div></div>}
          {chapter.goal && <div className="editor-info-section"><div className="editor-info-label">🎯 本章目标</div><div className="editor-info-text">{chapter.goal}</div></div>}
          <div className="editor-info-meta">
            <span>状态：{ChapterStatusLabels[chapter.status]}</span>
            <span>目标字数：{formatNumber(chapter.targetWordCount || 0)} 字</span>
            {lastSaved && <span>上次保存：{lastSaved}</span>}
          </div>
        </div>
      )}

      {!chapter.outline && (
        <div className="editor-hint-banner">💡 当前章节还没有大纲，建议先在作品详情页补充章节大纲，后续 AI 将根据大纲生成正文。</div>
      )}

      <div className="editor-paper">
        <textarea ref={textareaRef} className="editor-textarea" value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          placeholder="在这里输入或粘贴正文内容...&#10;&#10;点击右侧 AI 生成面板，AI 将根据章节大纲生成正文。"
          spellCheck={false} />
      </div>

      {!content && (
        <div className="editor-empty-state">
          <div className="editor-empty-icon">✍️</div>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>当前章节还没有正文</div>
          <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
            点击右侧 AI 生成面板，AI 将根据章节大纲自动生成正文。
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={() => onOpenPanel?.('ai-generate')}>🤖 打开 AI 生成面板</button>
            <button className="btn btn-secondary btn-sm" onClick={() => onOpenPanel?.('outline')}>📋 查看大纲</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default EditorArea;
