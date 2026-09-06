import { useState } from 'react';
import { ListTree, Pencil, Save } from 'lucide-react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterOutlineEditor } from './useChapterOutlineEditor';

/** Outline and goal support the reading surface without pushing the prose offscreen. */
export function EditorChapterContext({
  chapter,
  outline,
}: {
  chapter: Chapter;
  outline: ChapterOutlineEditor;
}) {
  const [expanded, setExpanded] = useState(false);
  const excerpt = (chapter.goal || chapter.outline || '尚未填写，按需补充')
    .replace(/\s+/g, ' ')
    .slice(0, 90);
  return (
    <details
      className="editor-info-card editor-chapter-context"
      open={expanded || outline.isEditingOutline}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <ListTree aria-hidden="true" size={14} strokeWidth={1.8} />
        <span>大纲与目标</span>
        <span className="editor-context-excerpt">{excerpt}</span>
      </summary>
      <div className="editor-info-section">
        <div className="editor-info-label editor-context-heading">
          <span>章节大纲</span>
          {!outline.isEditingOutline ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={outline.handleStartEditOutline}
            >
              <Pencil aria-hidden="true" size={13} strokeWidth={1.8} />
              {chapter.outline ? '编辑' : '手动编写'}
            </button>
          ) : (
            <span className="editor-context-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void outline.handleSaveOutline()}
                disabled={outline.saving}
                aria-busy={outline.saving || undefined}
              >
                <Save aria-hidden="true" size={13} strokeWidth={1.8} />
                {outline.saving
                  ? '保存中'
                  : outline.outlineSaveState === 'error'
                    ? '重试保存大纲'
                    : '保存'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={outline.handleCancelEditOutline}
                disabled={outline.saving}
              >
                取消
              </button>
            </span>
          )}
        </div>
        {outline.isEditingOutline ? (
          <textarea
            className="form-textarea editor-outline-textarea"
            data-editor-outline="true"
            aria-label="章节大纲"
            value={outline.outlineDraft}
            onChange={(event) => outline.setOutlineDraft(event.target.value)}
            placeholder={chapter.outline ? '编辑章节大纲...' : '编写章节大纲...'}
            autoFocus
          />
        ) : (
          <p className="editor-info-text">{chapter.outline || '当前章节尚未填写大纲。'}</p>
        )}
        {outline.outlineSaveMsg && (
          <div
            className={`editor-outline-save-feedback is-${outline.outlineSaveState}`}
            data-testid="outline-save-feedback"
            data-save-state={outline.outlineSaveState}
            role={outline.outlineSaveState === 'error' ? 'alert' : 'status'}
          >
            {outline.outlineSaveMsg}
          </div>
        )}
      </div>
      {chapter.goal && (
        <div className="editor-info-section">
          <div className="editor-info-label">本章目标</div>
          <p className="editor-info-text">{chapter.goal}</p>
        </div>
      )}
    </details>
  );
}
