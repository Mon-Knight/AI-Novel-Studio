import WorldRuleChangeConfirmation from '../../components/novel-detail/WorldRuleChangeConfirmation';
import type { useWorkbenchArtifacts } from './hooks/useWorkbenchArtifacts';

type RuleChangeActions = Pick<
  ReturnType<typeof useWorkbenchArtifacts>,
  | 'pendingRuleChangeReview'
  | 'ruleChangeReviewBusy'
  | 'ruleChangeReviewError'
  | 'confirmRuleChangeReview'
  | 'cancelRuleChangeReview'
>;

export function WorkbenchRuleChangeReview({ actions }: { actions: RuleChangeActions }) {
  const pending = actions.pendingRuleChangeReview;
  return (
    <WorldRuleChangeConfirmation
      preview={pending?.preview}
      title={pending ? `审阅规则候选：${pending.artifact.title}` : undefined}
      previewedContent={pending?.artifact.content}
      busy={actions.ruleChangeReviewBusy}
      error={actions.ruleChangeReviewError}
      onConfirm={actions.confirmRuleChangeReview}
      onCancel={actions.cancelRuleChangeReview}
    />
  );
}
