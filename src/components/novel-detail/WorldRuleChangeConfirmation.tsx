import { useEffect, useRef, useState } from 'react';
import { ModalFrame } from '../common/ModalFrame';
import RuleChangeReview from './RuleChangeReview';
import type {
  WorldRuleChange,
  WorldRuleChangeImpact,
  WorldRuleChangeIntent,
  WorldRuleSaveGuard,
} from '../../types/worldRules';

export type WorldRuleApplicationGuard = Required<
  Pick<WorldRuleSaveGuard, 'expectedRuleSetFingerprint' | 'changeAuthorization'>
>;
export interface WorldRuleChangeConfirmationProps {
  preview?: WorldRuleChangeImpact | null;
  busy?: boolean;
  error?: string;
  title?: string;
  previewedContent?: string;
  change?: WorldRuleChange;
  onConfirm: (guard: WorldRuleApplicationGuard) => void | Promise<void>;
  onCancel: () => void;
}
/** Shared by manual/legacy/workbench paths; only a preview-bound user action yields a guard. */
export default function WorldRuleChangeConfirmation({
  preview,
  busy = false,
  error,
  title = '审阅世界规则变更',
  previewedContent,
  change,
  onConfirm,
  onCancel,
}: WorldRuleChangeConfirmationProps) {
  const [intent, setIntent] = useState<WorldRuleChangeIntent>('confirm_change');
  const [notes, setNotes] = useState('');
  const [acceptedHash, setAcceptedHash] = useState('');
  const previousHash = useRef('');
  useEffect(() => {
    if (!preview || previousHash.current === preview.previewHash) return;
    previousHash.current = preview.previewHash;
    setIntent('confirm_change');
    setNotes('');
    setAcceptedHash('');
  }, [preview]);
  if (!preview) return null;
  const cancel = () => {
    if (!busy) {
      setAcceptedHash('');
      onCancel();
    }
  };
  const valid =
    acceptedHash === preview.previewHash &&
    !preview.blockingConflicts.length &&
    (intent === 'confirm_change' || Boolean(notes.trim()));
  return (
    <ModalFrame
      title={title}
      maxWidth={720}
      busy={busy}
      onDismiss={cancel}
      dismissOnBackdrop={false}
      dialogProps={{ 'data-testid': 'world-rule-change-confirmation' }}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="world-rule-change-cancel"
            disabled={busy}
            onClick={cancel}
          >
            取消（保留候选）
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="world-rule-change-confirm"
            disabled={busy || !valid}
            onClick={() =>
              onConfirm({
                expectedRuleSetFingerprint: preview.ruleSetFingerprint,
                changeAuthorization: {
                  previewHash: preview.previewHash,
                  intent,
                  notes: notes.trim() || undefined,
                },
              })
            }
          >
            {busy ? '处理中…' : '确认本次变更'}
          </button>
        </>
      }
    >
      {previewedContent && (
        <details open>
          <summary>本次拟应用内容（确认绑定这一版本）</summary>
          <pre
            className="detail-fact-text detail-fact-text--pre"
            data-testid="world-rule-previewed-content"
          >
            {previewedContent}
          </pre>
        </details>
      )}
      <RuleChangeReview
        impact={preview}
        change={change}
        intent={intent}
        notes={notes}
        confirmed={acceptedHash === preview.previewHash}
        onIntent={(v) => {
          setIntent(v);
          setAcceptedHash('');
        }}
        onNotes={(v) => {
          setNotes(v);
          setAcceptedHash('');
        }}
        onConfirm={(value) => setAcceptedHash(value ? preview.previewHash : '')}
      />
      {error && <p role="alert">{error}</p>}
    </ModalFrame>
  );
}
