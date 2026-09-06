import { useEffect, useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { ArtifactCandidateReviewDraft } from '../../types/artifactReview';
import { formatArtifactReviewNotes } from './artifactRevisionPrompt';
import {
  extractArtifactCandidateOptions,
  type ArtifactCandidateOption,
} from './artifactCandidateOptions';

interface ArtifactCandidateListProps {
  artifactType: string;
  content: string;
  drafts: Record<string, ArtifactCandidateReviewDraft>;
  onDraftChange: (candidateId: string, draft: ArtifactCandidateReviewDraft) => void;
  reviewAvailable?: boolean;
  disabled?: boolean;
}

function draftFor(
  item: ArtifactCandidateOption,
  drafts: Record<string, ArtifactCandidateReviewDraft>,
) {
  return Object.prototype.hasOwnProperty.call(drafts, item.id)
    ? drafts[item.id]
    : {
        originalTitle: item.title,
        suggestedTitle: '',
        suggestedSummary: '',
        notes: '',
      };
}

export function ArtifactApplyScopeNotice() {
  return (
    <p className="workbench-artifact-apply-scope" data-testid="workbench-artifact-apply-scope">
      应用范围：整份原始候选的全部内容。审阅标记和修订意见不改变应用范围；如需修改，请先要求修订并审阅新候选。
    </p>
  );
}

export function ArtifactCandidateList({
  artifactType,
  content,
  drafts,
  onDraftChange,
  reviewAvailable = false,
  disabled = false,
}: ArtifactCandidateListProps) {
  const extracted = useMemo(
    () => extractArtifactCandidateOptions(artifactType, content),
    [artifactType, content],
  );
  const paragraphMode = artifactType === 'chapter_summary';
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const reviewDisabled = disabled || !reviewAvailable;

  useEffect(() => {
    setReviewedIds(new Set());
    setEditingId(null);
  }, [extracted]);

  if (extracted.items.length === 0) {
    if (extracted.unparsed) {
      return (
        <p
          className="workbench-artifact-candidates-empty"
          data-testid="workbench-artifact-candidates-unparsed"
        >
          未能解析候选条目，请查看原始数据。
        </p>
      );
    }
    return null;
  }

  const toggleReviewed = (id: string) => {
    setReviewedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleEditing = (item: ArtifactCandidateOption) => {
    setEditingId((current) => (current === item.id ? null : item.id));
  };

  const updateDraft = (
    item: ArtifactCandidateOption,
    patch: Partial<ArtifactCandidateReviewDraft>,
  ) => {
    onDraftChange(item.id, { ...draftFor(item, drafts), ...patch });
  };

  return (
    <ul
      className={`workbench-artifact-candidates${paragraphMode ? ' is-paragraphs' : ''}`}
      data-testid="workbench-artifact-candidates"
      data-mode={paragraphMode ? 'paragraphs' : 'options'}
    >
      {extracted.items.map((item) => {
        const reviewed = reviewedIds.has(item.id);
        const editing = editingId === item.id;
        const draft = draftFor(item, drafts);
        const itemRevisionNotes = formatArtifactReviewNotes({ [item.id]: draft });
        return (
          <li
            className="workbench-artifact-candidate"
            data-testid="workbench-artifact-candidate"
            data-candidate-id={item.id}
            data-reviewed={paragraphMode ? undefined : reviewed ? 'true' : 'false'}
            key={item.id}
          >
            <div className="workbench-artifact-candidate-header">
              <h4 className="workbench-artifact-candidate-title">{item.title}</h4>
              {!paragraphMode && (
                <label className="workbench-artifact-candidate-select">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    disabled={reviewDisabled}
                    onChange={() => toggleReviewed(item.id)}
                  />
                  <span>已审阅</span>
                </label>
              )}
            </div>
            {item.summary ? (
              <p className="workbench-artifact-candidate-summary">{item.summary}</p>
            ) : null}
            {itemRevisionNotes && !editing ? (
              <p className="workbench-artifact-candidate-notes">{itemRevisionNotes}</p>
            ) : null}
            <div className="workbench-artifact-candidate-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="workbench-artifact-candidate-edit"
                aria-expanded={editing}
                disabled={reviewDisabled}
                onClick={() => toggleEditing(item)}
              >
                <Pencil aria-hidden="true" size={13} strokeWidth={1.8} />
                填写修订意见
              </button>
            </div>
            {editing ? (
              <div className="workbench-artifact-candidate-editor">
                <p className="workbench-artifact-review-hint">
                  以下为本地修订意见，不会修改原始候选。本次应用会话内切换任务仍会保留，退出应用后清除；请用卡片底部“带出全部意见”追加到输入区，检查后再发送。
                </p>
                <label>
                  建议标题
                  <input
                    type="text"
                    value={draft.suggestedTitle}
                    placeholder={item.title}
                    disabled={reviewDisabled}
                    onChange={(event) => updateDraft(item, { suggestedTitle: event.target.value })}
                  />
                </label>
                <label>
                  建议摘要
                  <textarea
                    rows={3}
                    value={draft.suggestedSummary}
                    placeholder={item.summary}
                    disabled={reviewDisabled}
                    onChange={(event) =>
                      updateDraft(item, { suggestedSummary: event.target.value })
                    }
                  />
                </label>
                <label>
                  补充要求
                  <textarea
                    rows={2}
                    value={draft.notes}
                    disabled={reviewDisabled}
                    onChange={(event) => updateDraft(item, { notes: event.target.value })}
                  />
                </label>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
