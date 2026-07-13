import { useMemo, useState } from 'react';
import type { CoCreationFieldSuggestionV1 } from '../../types/coCreation';
import { deserializeWorkingDraft } from '../../features/co-creation/draftState';

interface Props {
  payload?: Record<string, unknown>;
  busy?: boolean;
  onEditField: (fieldPath: string, value: unknown) => void | Promise<void>;
  onAccept: (
    suggestionId: string,
    editedValue?: unknown,
    allowReplaceConfirmed?: boolean,
    acknowledgeConflicts?: boolean,
  ) => void | Promise<void>;
  onReject: (suggestionId: string) => void | Promise<void>;
  onAcceptAll: () => void | Promise<void>;
}

const stateLabels: Record<string, string> = {
  user_confirmed: '用户已确认',
  ai_suggested: 'AI 建议',
  ai_inferred: 'AI 推断',
  temporary_assumption: '临时假设',
  conflict: '存在冲突',
  blank: '空缺',
};

function valueText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return JSON.stringify(value, null, 2);
}

function SuggestionCard({
  suggestion, busy, value, requiresReplaceAck, replaceAck, conflictAck,
  onValue, onReplaceAck, onConflictAck, onAccept, onReject,
}: {
  suggestion: CoCreationFieldSuggestionV1;
  busy?: boolean;
  value: string;
  requiresReplaceAck: boolean;
  replaceAck: boolean;
  conflictAck: boolean;
  onValue: (value: string) => void;
  onReplaceAck: (value: boolean) => void;
  onConflictAck: (value: boolean) => void;
  onAccept: () => void;
  onReject: () => void;
}) {
  const requiresConflictAck = suggestion.conflicts.some((conflict) => conflict.severity === 'blocking');
  return (
    <article className={`co-creation-suggestion is-${suggestion.fieldState}`}>
      <header>
        <span>{suggestion.target.fieldPath}</span>
        <em>{stateLabels[suggestion.fieldState]}</em>
      </header>
      <textarea value={value} onChange={(event) => onValue(event.target.value)} rows={4} disabled={busy} />
      <div className="co-creation-suggestion-meta">
        <span>置信度 {Math.round(suggestion.confidence * 100)}%</span>
        <span>来源 {suggestion.sourceReferences.length} 项</span>
      </div>
      <details className="co-creation-source-details">
        <summary>查看来源与关联影响</summary>
        <ul>
          {suggestion.sourceReferences.map((reference, index) => (
            <li key={`${reference.sourceType}:${reference.sourceId}:${index}`}>
              <strong>{reference.sourceType}</strong>
              <code>{reference.sourceId}</code>
              {reference.excerpt && <span>“{reference.excerpt}”</span>}
            </li>
          ))}
        </ul>
        <p>
          {suggestion.conflicts.length > 0
            ? `检测到 ${suggestion.conflicts.length} 项关联影响，采用前必须处理阻断冲突。`
            : '未检测到阻断关联影响；正式写入仍需后续 ApplyPlan 审查。'}
        </p>
      </details>
      {suggestion.conflicts.map((conflict) => (
        <div key={conflict.code} className={`co-creation-conflict is-${conflict.severity}`}>
          {conflict.message}
        </div>
      ))}
      {requiresReplaceAck && (
        <label className="co-creation-safety-ack">
          <input
            type="checkbox"
            checked={replaceAck}
            disabled={busy}
            onChange={(event) => onReplaceAck(event.target.checked)}
          />
          我确认替换已由作者确认的字段
        </label>
      )}
      {requiresConflictAck && (
        <label className="co-creation-safety-ack">
          <input
            type="checkbox"
            checked={conflictAck}
            disabled={busy}
            onChange={(event) => onConflictAck(event.target.checked)}
          />
          我已查看并确认阻断关联影响
        </label>
      )}
      <footer>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onReject}>拒绝</button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || (requiresReplaceAck && !replaceAck) || (requiresConflictAck && !conflictAck)}
          onClick={onAccept}
        >
          采用到草案
        </button>
      </footer>
    </article>
  );
}

export default function CoCreationDraftPanel({
  payload, busy, onEditField, onAccept, onReject, onAcceptAll,
}: Props) {
  const draft = useMemo(() => deserializeWorkingDraft(payload), [payload]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [replaceAcks, setReplaceAcks] = useState<Record<string, boolean>>({});
  const [conflictAcks, setConflictAcks] = useState<Record<string, boolean>>({});
  const pending = draft.suggestions.filter((item) => item.decision === 'pending');
  const batchSafe = pending.every((suggestion) => (
    draft.fields[suggestion.target.fieldPath]?.state !== 'user_confirmed'
      && !suggestion.conflicts.some((conflict) => conflict.severity === 'blocking')
  ));

  return (
    <aside className="co-creation-draft-panel" aria-label="当前设定与待确认草案">
      <div className="co-creation-draft-heading">
        <div>
          <strong>当前设定与本轮变更</strong>
          <span>工作草案，不是正式作品数据</span>
        </div>
        {pending.length > 1 && batchSafe && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void onAcceptAll()}>
            批量采用
          </button>
        )}
      </div>
      <section className="co-creation-field-summary">
        <h3>当前设定摘要</h3>
        {Object.keys(draft.fields).length === 0 && <p className="co-creation-empty-copy">尚未形成结构化字段。</p>}
        {Object.entries(draft.fields).map(([path, field]) => (
          <label key={path}>
            <span><code>{path}</code><em>{stateLabels[field.state]}</em></span>
            <textarea
              defaultValue={valueText(field.value)}
              rows={2}
              disabled={busy}
              onBlur={(event) => {
                if (event.target.value !== valueText(field.value)) void onEditField(path, event.target.value);
              }}
            />
          </label>
        ))}
      </section>
      <section className="co-creation-pending-list">
        <h3>AI 补全草案 <span>{pending.length}</span></h3>
        {pending.length === 0 && <p className="co-creation-empty-copy">本轮没有待确认建议。</p>}
        {pending.map((suggestion) => {
          const value = edits[suggestion.suggestionId] ?? valueText(suggestion.suggestedValue);
          const requiresReplaceAck = draft.fields[suggestion.target.fieldPath]?.state === 'user_confirmed';
          const replaceAck = !!replaceAcks[suggestion.suggestionId];
          const conflictAck = !!conflictAcks[suggestion.suggestionId];
          return (
            <SuggestionCard
              key={suggestion.suggestionId}
              suggestion={suggestion}
              busy={busy}
              value={value}
              requiresReplaceAck={requiresReplaceAck}
              replaceAck={replaceAck}
              conflictAck={conflictAck}
              onValue={(next) => setEdits((previous) => ({ ...previous, [suggestion.suggestionId]: next }))}
              onReplaceAck={(next) => setReplaceAcks((previous) => ({
                ...previous, [suggestion.suggestionId]: next,
              }))}
              onConflictAck={(next) => setConflictAcks((previous) => ({
                ...previous, [suggestion.suggestionId]: next,
              }))}
              onReject={() => void onReject(suggestion.suggestionId)}
              onAccept={() => void onAccept(suggestion.suggestionId, value, replaceAck, conflictAck)}
            />
          );
        })}
      </section>
    </aside>
  );
}
