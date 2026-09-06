import type { ChapterDraft } from '../../../types/ai';
import { FileText, NotebookPen, RefreshCw } from 'lucide-react';
import type { Chapter } from '../../../types/chapter';
import { countTextWords, hashTextContent } from '../../../utils/contentHash';
import ContentUnavailableState from '../ContentUnavailableState';
import type { EditorAreaProps, EditorDocumentState } from './editorAreaTypes';
import type { EditorDocumentController } from './useEditorDocumentController';
import type { ChapterOutlineEditor } from './useChapterOutlineEditor';
import { EditorChapterContext } from './EditorChapterContext';

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
          <NotebookPen aria-hidden="true" size={36} strokeWidth={1.8} />
          <h1>选择章节开始写作</h1>
          <p>请从章节目录选择一章，或退出专注模式查看目录。</p>
        </div>
      </div>
    );
  }
  const ready = documentState === 'ready';
  const busy = document.saving || document.adopting;
  return (
    <div className="editor-content" data-document-state={documentState}>
      <h1 className="editor-chapter-title">
        第{chapter.chapterNumber}章：{chapter.title}
      </h1>

      {ready && currentDraft && (
        <details className="editor-document-metadata" key={`${chapter.id}:${currentDraft.id}`}>
          <summary>
            <FileText aria-hidden="true" size={14} strokeWidth={1.8} />
            草稿信息 · v{currentDraft.versionNo}
          </summary>
          <div>
            <span>来源：{DRAFT_SOURCE_LABELS[currentDraft.source] || currentDraft.source}</span>
            <span>{currentDraft.isAdopted ? '此草稿已采用' : '草稿未采用'}</span>
            {document.lastSaved && <span>上次保存：{document.lastSaved}</span>}
          </div>
        </details>
      )}

      {ready && (document.saveMsg || document.adoptMsg) && (
        <div className="editor-action-feedback" aria-label="正文操作反馈">
          {document.saveMsg && (
            <div className={`editor-save-feedback is-${document.saveState}`}>
              <span
                data-testid="editor-save-feedback"
                data-save-state={document.saveState}
                role={document.saveState === 'error' ? 'alert' : 'status'}
              >
                {document.saveMsg}
              </span>
              {document.saveState === 'error' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy || reviewLocked}
                  data-testid="editor-save-retry"
                  onClick={() => void document.handleSave()}
                >
                  <RefreshCw aria-hidden="true" size={13} strokeWidth={1.8} />
                  重试保存
                </button>
              )}
            </div>
          )}
          {document.adoptMsg && (
            <div className={`editor-adopt-feedback is-${document.adoptState}`}>
              <span
                data-testid="editor-adopt-feedback"
                data-adopt-state={document.adoptState}
                role={document.adoptState === 'error' ? 'alert' : 'status'}
              >
                {document.adoptMsg}
              </span>
              {document.adoptState === 'error' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy || reviewLocked}
                  data-testid="editor-adopt-retry"
                  onClick={() => void document.handleAdoptCurrent()}
                >
                  <RefreshCw aria-hidden="true" size={13} strokeWidth={1.8} />
                  重试采用
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {ready ? (
        <EditorChapterContext key={chapter.id} chapter={chapter} outline={outline} />
      ) : (
        <div
          className="editor-document-load-notice"
          role={documentState === 'error' ? 'alert' : 'status'}
        >
          {documentState === 'loading'
            ? '正在校验并读取完整正文，下方保留切换前内容且暂不可编辑。'
            : '完整正文不可用。下方仅保留切换前的安全内容供参考，不会写入当前章节。'}
        </div>
      )}

      {ready && document.effectiveContentState?.status === 'unavailable' ? (
        <ContentUnavailableState
          state={document.effectiveContentState}
          retrying={retryingContent}
          onRetry={() => onRetryContent?.()}
          onOpenHistory={onOpenDraftHistory}
          onBackToChapters={onBackToChapters}
        />
      ) : (
        <div className="editor-paper">
          {ready && reviewLocked && (
            <div className="editor-review-banner" data-testid="chapter-review-lock">
              <span>当前为审阅模式：打开不等于保存，保存不等于采用。</span>
              <button
                type="button"
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
            aria-label={`第${chapter.chapterNumber}章 ${chapter.title} 正文`}
            aria-disabled={!ready || undefined}
            aria-busy={document.adopting || undefined}
            data-document-state={documentState}
            data-chapter-id={ready ? chapter.id : (document.loadedChapterIdRef.current ?? '')}
            data-target-chapter-id={chapter.id}
            data-draft-id={currentDraft?.id ?? ''}
            data-draft-version={currentDraft?.versionNo ?? ''}
            data-content-hash={hashTextContent(document.content)}
            data-adopted={currentDraft?.isAdopted ? 'true' : 'false'}
            data-word-count={countTextWords(document.content)}
            data-dirty={document.isDirty ? 'true' : 'false'}
            data-saving={ready && document.saving ? 'true' : 'false'}
            data-review-locked={reviewLocked ? 'true' : 'false'}
            readOnly={!ready || reviewLocked || document.adopting}
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
    </div>
  );
}
