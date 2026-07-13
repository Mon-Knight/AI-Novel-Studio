import { useMemo, useState } from 'react';
import type { CoCreationFieldSuggestionV1 } from '../../types/coCreation';
import type {
  CoCreationApplyPreparationV1,
  CoCreationApplyResultV1,
} from '../../types/coCreationApply';
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
  applyPreparation?: CoCreationApplyPreparationV1 | null;
  lastApplyResult?: CoCreationApplyResultV1 | null;
  onPrepareApply: (suggestionIds: string[]) => void | Promise<void>;
  onConfirmApply: () => void | Promise<void>;
  onCancelApply: () => void;
  onPrepareUndo: (planId?: string) => void | Promise<void>;
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

function hasOriginalValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
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
  applyPreparation, lastApplyResult, onPrepareApply, onConfirmApply, onCancelApply, onPrepareUndo,
}: Props) {
  const draft = useMemo(() => deserializeWorkingDraft(payload), [payload]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [replaceAcks, setReplaceAcks] = useState<Record<string, boolean>>({});
  const [conflictAcks, setConflictAcks] = useState<Record<string, boolean>>({});
  const [formalSelections, setFormalSelections] = useState<Record<string, boolean>>({});
  const [formalArtifactSelection, setFormalArtifactSelection] = useState('');
  const pending = draft.suggestions.filter((item) => item.decision === 'pending');
  const accepted = draft.suggestions.filter((item) => (
    item.decision === 'accepted_to_draft' && !item.formalApplyPlanId
  ));
  const formalArtifactIds = [...new Set(accepted
    .map((item) => item.sourceArtifactId)
    .filter((value): value is string => !!value))];
  const selectedFormalArtifactId = formalArtifactIds.includes(formalArtifactSelection)
    ? formalArtifactSelection
    : (formalArtifactIds[formalArtifactIds.length - 1] ?? '');
  const activeAccepted = accepted.filter((item) => item.sourceArtifactId === selectedFormalArtifactId);
  const untraceableAcceptedCount = accepted.length - accepted.filter((item) => !!item.sourceArtifactId).length;
  const appliedPlanIds = [...new Set(draft.suggestions
    .map((item) => item.formalApplyPlanId)
    .filter((value): value is string => !!value))];
  const selectedFormalIds = activeAccepted
    .filter((item) => formalSelections[item.suggestionId] !== false)
    .map((item) => item.suggestionId);
  const batchSafe = pending.every((suggestion) => (
    draft.fields[suggestion.target.fieldPath]?.state !== 'user_confirmed'
      && !hasOriginalValue(suggestion.originalValue)
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
          const requiresReplaceAck = draft.fields[suggestion.target.fieldPath]?.state === 'user_confirmed'
            || hasOriginalValue(suggestion.originalValue);
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
      <section className="co-creation-formal-apply" aria-label="正式采用">
        <div className="co-creation-draft-heading">
          <div>
            <h3>正式作品数据</h3>
            <span>草案与 Canon 保持隔离，确认 ApplyPlan 后才会写入</span>
          </div>
        </div>
        {accepted.length === 0 && !applyPreparation && (
          <p className="co-creation-empty-copy">先逐项采用 AI 建议，再准备正式写入。</p>
        )}
        {!applyPreparation && formalArtifactIds.length > 1 && (
          <label className="co-creation-formal-source">
            <span>待写入 AI 轮次</span>
            <select
              value={selectedFormalArtifactId}
              disabled={busy}
              onChange={(event) => setFormalArtifactSelection(event.target.value)}
            >
              {formalArtifactIds.map((artifactId, index) => (
                <option key={artifactId} value={artifactId}>
                  {index === formalArtifactIds.length - 1 ? '最新轮次 · ' : '历史轮次 · '}{artifactId}
                </option>
              ))}
            </select>
          </label>
        )}
        {!applyPreparation && untraceableAcceptedCount > 0 && (
          <p className="co-creation-impact-warning">
            {untraceableAcceptedCount} 项旧草案缺少 Artifact 来源，不能写入正式数据，请重新生成。
          </p>
        )}
        {!applyPreparation && activeAccepted.map((suggestion) => (
          <label key={`formal:${suggestion.suggestionId}`} className="co-creation-formal-choice">
            <input
              type="checkbox"
              checked={formalSelections[suggestion.suggestionId] !== false}
              disabled={busy}
              onChange={(event) => setFormalSelections((previous) => ({
                ...previous,
                [suggestion.suggestionId]: event.target.checked,
              }))}
            />
            <span>
              <code>{suggestion.target.fieldPath}</code>
              <em>{valueText(draft.fields[suggestion.target.fieldPath]?.value)}</em>
            </span>
          </label>
        ))}
        {!applyPreparation && activeAccepted.length > 0 && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || selectedFormalIds.length === 0}
            onClick={() => void onPrepareApply(selectedFormalIds)}
          >
            准备正式写入
          </button>
        )}
        {applyPreparation && (
          <div className="co-creation-apply-review" role="region" aria-label="ApplyPlan 审查">
            <strong>请确认本次正式变更</strong>
            <ul>
              {applyPreparation.affectedTargets.map((target) => (
                <li key={`${target.targetType}:${target.targetId}:${target.action}`}>
                  <span>{target.targetType} · {target.action}</span>
                  <small>{target.fieldPaths.join('、')}</small>
                </li>
              ))}
            </ul>
            {applyPreparation.impactWarnings.map((warning) => (
              <p key={warning} className="co-creation-impact-warning">{warning}</p>
            ))}
            <p>目标版本与内容哈希会在事务内再次检查；过期计划不会写入。</p>
            <footer>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onCancelApply}>
                返回修改
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void onConfirmApply()}>
                确认执行 ApplyPlan
              </button>
            </footer>
          </div>
        )}
        {lastApplyResult && !applyPreparation && (
          <div className="co-creation-apply-result" role="status">
            <span>最近一次正式写入已完成，共 {lastApplyResult.execution.targetLinks.length} 个目标。</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void onPrepareUndo(lastApplyResult.execution.planId)}>
              准备撤销本次变更
            </button>
          </div>
        )}
        {!lastApplyResult && !applyPreparation && appliedPlanIds.map((planId) => (
          <div key={planId} className="co-creation-apply-result" role="status">
            <span>这批字段已写入正式数据，可通过反向 ApplyPlan 撤销。</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void onPrepareUndo(planId)}>
              准备撤销正式变更
            </button>
          </div>
        ))}
      </section>
    </aside>
  );
}
