import type { ChapterDraft } from '../../../types/ai';
import {
  CheckCircle2,
  FileText,
  Lightbulb,
  ListTree,
  NotebookPen,
  Pencil,
  Save,
  Target,
} from 'lucide-react';
import { ChapterStatusLabels, type Chapter } from '../../../types/chapter';
import { countTextWords, hashTextContent } from '../../../utils/contentHash';
import { formatNumber } from '../../../utils/format';
import ContentUnavailableState from '../ContentUnavailableState';
import type { EditorAreaProps, EditorDocumentState } from './editorAreaTypes';
import type { EditorDocumentController } from './useEditorDocumentController';
import type { ChapterOutlineEditor } from './useChapterOutlineEditor';

interface EditorAreaViewProps {
  chapter?: Chapter;
  currentDraft?: ChapterDraft | null;
  documentState: EditorDocumentState;
  document: EditorDocumentController;
  outline: ChapterOutlineEditor;
  onRetryContent?: EditorAreaProps['onRetryContent'];
  retryingContent?: boolean;
  onOpenDraftHistory?: EditorAreaProps['onOpenDraftHistory'];
  onBackToChapters?: EditorAreaProps['onBackToChapters'];
  reviewLocked?: boolean;
  onUnlockReview?: () => void;
}

const DRAFT_SOURCE_LABELS: Record<string, string> = {
  ai_generated: 'AI 初稿',
  ai_regenerated: 'AI 重生成',
  user_edited: '用户编辑',
  ai_polished: 'AI 润色',
  imported: '导入',
  manual_placeholder: '手动占位',
};

export default function EditorAreaView({
  chapter,
  currentDraft,
  documentState,
  document,
  outline,
  onRetryContent,
  retryingContent,
  onOpenDraftHistory,
  onBackToChapters,
  reviewLocked = false,
  onUnlockReview,
}: EditorAreaViewProps) {
  if (!chapter) {
    return (
      <div className="editor-content">
        <div className="editor-empty">
          <div className="editor-empty-icon">
            <NotebookPen aria-hidden="true" size={36} strokeWidth={1.5} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>选择章节开始写作</div>
          <div className="text-sm text-muted">请从左侧目录树中选择一个章节</div>
        </div>
      </div>
    );
  }

  if (documentState !== 'ready') {
    const isLoading = documentState === 'loading';
    return (
      <div className="editor-content" data-document-state={documentState}>
        <div className="editor-chapter-title">
          第{chapter.chapterNumber}章：{chapter.title}
        </div>
        <div
          role="status"
          style={{
            width: 'min(100%, 920px)',
            maxWidth: 920,
            margin: '0 auto 10px',
            padding: '9px 12px',
            color: isLoading ? 'var(--color-text-secondary)' : 'var(--color-error)',
            background: 'var(--color-bg-hover)',
            border: '1px solid var(--color-border-light)',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {isLoading
            ? '正在校验并读取完整正文，下方保留切换前内容且暂不可编辑。'
            : '完整正文不可用。下方仅保留切换前的安全内容供参考，不会写入当前章节。'}
        </div>
        <div className="editor-paper">
          <textarea
            ref={document.textareaRef}
            className="editor-textarea"
            data-testid="chapter-editor"
            data-document-state={documentState}
            data-chapter-id={document.loadedChapterIdRef.current ?? ''}
            data-target-chapter-id={chapter.id}
            data-draft-id={currentDraft?.id ?? ''}
            data-draft-version={currentDraft?.versionNo ?? ''}
            data-content-hash={hashTextContent(document.content)}
            data-adopted={currentDraft?.isAdopted ? 'true' : 'false'}
            data-word-count={countTextWords(document.content)}
            data-dirty={document.isDirty ? 'true' : 'false'}
            data-saving="false"
            aria-disabled="true"
            readOnly
            value={document.content}
            onSelect={document.handleSelectionChange}
            spellCheck={false}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="editor-content">
      <div className="editor-chapter-title">
        第{chapter.chapterNumber}章：{chapter.title}
      </div>

      {currentDraft && (
        <div
          style={{
            width: 'min(100%, 920px)',
            maxWidth: 920,
            margin: '0 auto 10px',
            padding: '7px 12px',
            background: currentDraft.isAdopted
              ? 'var(--color-success-bg)'
              : 'var(--color-bg-hover)',
            borderRadius: 6,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            border: currentDraft.isAdopted
              ? '1px solid var(--color-success-border)'
              : '1px solid var(--color-border-light)',
          }}
        >
          <span className="editor-meta-item">
            <FileText aria-hidden="true" size={14} strokeWidth={1.8} />
            <span>草稿 v{currentDraft.versionNo}</span>
          </span>
          <span>来源：{DRAFT_SOURCE_LABELS[currentDraft.source] || currentDraft.source}</span>
          <span>字数：{formatNumber(currentDraft.wordCount)}</span>
          {currentDraft.isAdopted && (
            <span
              className="editor-meta-item"
              style={{ color: 'var(--color-success)', fontWeight: 600 }}
            >
              <CheckCircle2 aria-hidden="true" size={14} strokeWidth={1.8} />
              <span>已采用</span>
            </span>
          )}
          {document.saveMsg && (
            <span
              style={{
                color:
                  document.saveMsg.startsWith('❌') || document.saveMsg.includes('失败')
                    ? 'var(--color-error)'
                    : 'var(--color-success)',
                fontWeight: 600,
              }}
            >
              {document.saveMsg}
            </span>
          )}
        </div>
      )}

      {(chapter.outline || chapter.goal) && (
        <div className="editor-info-card">
          {chapter.outline && (
            <div className="editor-info-section">
              <div
                className="editor-info-label"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <span className="editor-info-label-copy">
                  <ListTree aria-hidden="true" size={14} strokeWidth={1.8} />
                  <span>章节大纲</span>
                </span>
                {!outline.isEditingOutline ? (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={outline.handleStartEditOutline}
                    style={{ fontSize: 11 }}
                  >
                    <Pencil aria-hidden="true" size={13} strokeWidth={1.8} />
                    <span>编辑</span>
                  </button>
                ) : (
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={outline.handleSaveOutline}
                      disabled={document.saving}
                      style={{ fontSize: 11 }}
                    >
                      <Save aria-hidden="true" size={13} strokeWidth={1.8} />
                      <span>保存</span>
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={outline.handleCancelEditOutline}
                      style={{ fontSize: 11 }}
                    >
                      取消
                    </button>
                  </span>
                )}
              </div>
              {outline.isEditingOutline ? (
                <textarea
                  className="form-textarea"
                  value={outline.outlineDraft}
                  onChange={(event) => outline.setOutlineDraft(event.target.value)}
                  style={{
                    width: '100%',
                    height: 120,
                    resize: 'vertical',
                    fontSize: 14,
                    lineHeight: 1.8,
                    fontFamily: 'var(--font-family-editor)',
                    marginTop: 8,
                  }}
                  placeholder="编辑章节大纲..."
                  autoFocus
                />
              ) : (
                <div className="editor-info-text">{chapter.outline}</div>
              )}
              {outline.outlineSaveMsg && (
                <div
                  style={{
                    fontSize: 11,
                    marginTop: 4,
                    color: outline.outlineSaveMsg.startsWith('✅')
                      ? 'var(--color-success)'
                      : 'var(--color-error)',
                  }}
                >
                  {outline.outlineSaveMsg}
                </div>
              )}
            </div>
          )}
          {chapter.goal && (
            <div className="editor-info-section">
              <div className="editor-info-label editor-info-label-copy">
                <Target aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>本章目标</span>
              </div>
              <div className="editor-info-text">{chapter.goal}</div>
            </div>
          )}
          <div className="editor-info-meta">
            <span>状态：{ChapterStatusLabels[chapter.status]}</span>
            <span>目标字数：{formatNumber(chapter.targetWordCount || 0)} 字</span>
            {document.lastSaved && <span>上次保存：{document.lastSaved}</span>}
          </div>
        </div>
      )}

      {!chapter.outline && !outline.isEditingOutline && (
        <div className="editor-hint-banner">
          <Lightbulb aria-hidden="true" size={15} strokeWidth={1.8} />
          <span>当前章节还没有大纲，建议先补充章节目标和剧情节点。</span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={outline.handleStartEditOutline}
            style={{ marginLeft: 8, fontSize: 11 }}
          >
            <Pencil aria-hidden="true" size={13} strokeWidth={1.8} />
            <span>手动编写</span>
          </button>
        </div>
      )}

      {outline.isEditingOutline && !chapter.outline && (
        <div className="editor-info-card" style={{ marginTop: 8 }}>
          <div className="editor-info-section">
            <div
              className="editor-info-label"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <span className="editor-info-label-copy">
                <ListTree aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>编写章节大纲</span>
              </span>
              <span style={{ display: 'flex', gap: 4 }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={outline.handleSaveOutline}
                  disabled={document.saving}
                  style={{ fontSize: 11 }}
                >
                  <Save aria-hidden="true" size={13} strokeWidth={1.8} />
                  <span>保存</span>
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={outline.handleCancelEditOutline}
                  style={{ fontSize: 11 }}
                >
                  取消
                </button>
              </span>
            </div>
            <textarea
              className="form-textarea"
              value={outline.outlineDraft}
              onChange={(event) => outline.setOutlineDraft(event.target.value)}
              style={{
                width: '100%',
                height: 120,
                resize: 'vertical',
                fontSize: 14,
                lineHeight: 1.8,
                fontFamily: 'var(--font-family-editor)',
                marginTop: 8,
              }}
              placeholder="编写章节大纲..."
              autoFocus
            />
            {outline.outlineSaveMsg && (
              <div
                style={{
                  fontSize: 11,
                  marginTop: 4,
                  color: outline.outlineSaveMsg.startsWith('✅')
                    ? 'var(--color-success)'
                    : 'var(--color-error)',
                }}
              >
                {outline.outlineSaveMsg}
              </div>
            )}
          </div>
        </div>
      )}

      {document.effectiveContentState?.status === 'unavailable' ? (
        <ContentUnavailableState
          state={document.effectiveContentState}
          retrying={retryingContent}
          onRetry={() => onRetryContent?.()}
          onOpenHistory={onOpenDraftHistory}
          onBackToChapters={onBackToChapters}
        />
      ) : (
        <div className="editor-paper">
          {reviewLocked && (
            <div className="editor-review-banner" data-testid="chapter-review-lock">
              <span>当前为对话确认后的审阅模式：打开不等于保存，保存不等于采用。</span>
              <button
                className="btn btn-secondary btn-sm"
                data-testid="chapter-review-unlock"
                onClick={() => onUnlockReview?.()}
              >
                进入编辑
              </button>
            </div>
          )}
          <textarea
            ref={document.textareaRef}
            className="editor-textarea"
            data-testid="chapter-editor"
            data-chapter-id={chapter.id}
            data-draft-id={currentDraft?.id ?? ''}
            data-draft-version={currentDraft?.versionNo ?? ''}
            data-content-hash={hashTextContent(document.content)}
            data-adopted={currentDraft?.isAdopted ? 'true' : 'false'}
            data-word-count={countTextWords(document.content)}
            data-dirty={document.isDirty ? 'true' : 'false'}
            data-saving={document.saving ? 'true' : 'false'}
            data-review-locked={reviewLocked ? 'true' : 'false'}
            readOnly={reviewLocked}
            value={document.content}
            onChange={(event) => document.handleContentChange(event.target.value)}
            onSelect={document.handleSelectionChange}
            placeholder={
              '在这里输入或粘贴正文内容。\n\n对话中确认的章节候选稿会进入此处供你审阅和修改。'
            }
            spellCheck={false}
          />
        </div>
      )}

      {!document.content && document.effectiveContentState?.status !== 'unavailable' && (
        <div className="editor-empty-state">
          <div className="editor-empty-icon">
            <NotebookPen aria-hidden="true" size={36} strokeWidth={1.5} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>当前章节还没有正文</div>
          <div
            style={{
              fontSize: 14,
              color: 'var(--color-text-secondary)',
              marginBottom: 16,
            }}
          >
            正文为空。
          </div>
        </div>
      )}
    </div>
  );
}
