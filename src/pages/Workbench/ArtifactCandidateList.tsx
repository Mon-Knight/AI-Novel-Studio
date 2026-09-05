import { useEffect, useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import {
  extractArtifactCandidateOptions,
  type ArtifactCandidateOption,
} from './artifactCandidateOptions';

interface ArtifactCandidateDraft {
  title: string;
  summary: string;
  notes: string;
}

interface ArtifactCandidateListProps {
  artifactType: string;
  content: string;
  onDecide?: (decision: 'request_revision') => void;
}

function draftFor(item: ArtifactCandidateOption, drafts: Record<string, ArtifactCandidateDraft>) {
  return drafts[item.id] ?? { title: item.title, summary: item.summary, notes: '' };
}

export function ArtifactCandidateList({
  artifactType,
  content,
  onDecide,
}: ArtifactCandidateListProps) {
  const extracted = useMemo(
    () => extractArtifactCandidateOptions(artifactType, content),
    [artifactType, content],
  );
  const paragraphMode = artifactType === 'chapter_summary';
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(extracted.items.map((item) => item.id)),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ArtifactCandidateDraft>>({});

  useEffect(() => {
    setSelectedIds(new Set(extracted.items.map((item) => item.id)));
    setEditingId(null);
    setDrafts({});
  }, [extracted]);

  if (extracted.items.length === 0) {
    if (extracted.unparsed) {
      return (
        <p
          className="workbench-artifact-candidates-empty"
          data-testid="workbench-artifact-candidates-unparsed"
        >
          未能解析为可选候选，请查看原始数据。
        </p>
      );
    }
    return null;
  }

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleEditing = (item: ArtifactCandidateOption) => {
    setEditingId((current) => (current === item.id ? null : item.id));
    setDrafts((current) =>
      current[item.id]
        ? current
        : {
            ...current,
            [item.id]: { title: item.title, summary: item.summary, notes: '' },
          },
    );
  };

  const updateDraft = (id: string, patch: Partial<ArtifactCandidateDraft>) => {
    setDrafts((current) => {
      const baseline = current[id] ?? { title: '', summary: '', notes: '' };
      return { ...current, [id]: { ...baseline, ...patch } };
    });
  };

  return (
    <ul
      className={`workbench-artifact-candidates${paragraphMode ? ' is-paragraphs' : ''}`}
      data-testid="workbench-artifact-candidates"
      data-mode={paragraphMode ? 'paragraphs' : 'options'}
    >
      {extracted.items.map((item) => {
        const selected = selectedIds.has(item.id);
        const editing = editingId === item.id;
        const draft = draftFor(item, drafts);
        return (
          <li
            className={
              selected || paragraphMode
                ? 'workbench-artifact-candidate'
                : 'workbench-artifact-candidate is-deselected'
            }
            data-testid="workbench-artifact-candidate"
            data-candidate-id={item.id}
            data-selected={paragraphMode ? undefined : selected ? 'true' : 'false'}
            key={item.id}
          >
            <div className="workbench-artifact-candidate-header">
              {paragraphMode ? (
                <h4 className="workbench-artifact-candidate-title">{draft.title}</h4>
              ) : (
                <label className="workbench-artifact-candidate-select">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleSelected(item.id)}
                  />
                  <span className="workbench-artifact-candidate-title">{draft.title}</span>
                </label>
              )}
            </div>
            {draft.summary ? (
              <p className="workbench-artifact-candidate-summary">{draft.summary}</p>
            ) : null}
            {draft.notes && !editing ? (
              <p className="workbench-artifact-candidate-notes">{draft.notes}</p>
            ) : null}
            <div className="workbench-artifact-candidate-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                data-testid="workbench-artifact-candidate-edit"
                aria-expanded={editing}
                onClick={() => toggleEditing(item)}
              >
                <Pencil aria-hidden="true" size={13} strokeWidth={1.8} />
                修改
              </button>
              {onDecide ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  data-testid="workbench-artifact-candidate-revise"
                  onClick={() => onDecide('request_revision')}
                >
                  修订
                </button>
              ) : null}
            </div>
            {editing ? (
              <div className="workbench-artifact-candidate-editor">
                <label>
                  标题
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(event) => updateDraft(item.id, { title: event.target.value })}
                  />
                </label>
                <label>
                  摘要
                  <textarea
                    rows={3}
                    value={draft.summary}
                    onChange={(event) => updateDraft(item.id, { summary: event.target.value })}
                  />
                </label>
                <label>
                  备注
                  <textarea
                    rows={2}
                    value={draft.notes}
                    onChange={(event) => updateDraft(item.id, { notes: event.target.value })}
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
