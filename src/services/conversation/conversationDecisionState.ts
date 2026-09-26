import type {
  ArtifactDecision,
  TaskConversation,
  TaskConversationBundle,
} from '../../types/conversation';
import { isReadOnlyReportType } from './structuredApplyPolicy';

export function latestDecisionForCard(
  bundle: TaskConversationBundle,
  cardId: string,
): ArtifactDecision | undefined {
  const related = (bundle.decisions ?? []).filter(
    (decision) =>
      decision.cardId === cardId && decision.conversationId === bundle.conversation.conversationId,
  );
  return related[related.length - 1];
}

export function hasUnresolvedArtifactCandidate(bundle: TaskConversationBundle): boolean {
  const authorizations = bundle.authorizations ?? [];
  return bundle.artifacts.some((card) => {
    if (!['candidate', 'confirmed'].includes(card.status)) return false;
    const decision = latestDecisionForCard(bundle, card.cardId);
    if (!decision) return true;
    if (decision.decision === 'confirm') {
      if (isReadOnlyReportType(card.artifactType)) return false;
      return !authorizations.some(
        (authorization) =>
          authorization.decisionId === decision.decisionId &&
          authorization.status === 'consumed' &&
          Boolean(authorization.consumedByDraftId),
      );
    }
    return (
      decision.decision === 'request_apply' &&
      !decision.applyTransactionId &&
      !decision.conflictCode
    );
  });
}

export function decisionFallbackStatus(
  bundle: TaskConversationBundle,
  decision: ArtifactDecision,
): TaskConversation['status'] {
  if (decision.conflictCode) return 'failed';
  if (decision.decision === 'confirm') {
    const reviewed = bundle.artifacts.find(
      (card) => card.cardId === decision.cardId && card.artifactId === decision.artifactId,
    );
    if (reviewed && isReadOnlyReportType(reviewed.artifactType)) return 'completed';
  }
  if (decision.decision === 'reject' || decision.decision === 'request_revision') return 'idle';
  if (decision.decision === 'request_apply' && decision.applyTransactionId) return 'completed';
  if (decision.decision === 'confirm' || decision.decision === 'request_apply') {
    return 'waiting_user';
  }
  return 'idle';
}

export function reconcileLocalConversationStatus(
  bundle: TaskConversationBundle,
  fallbackStatus: TaskConversation['status'],
  updatedAt: string,
): void {
  if (bundle.conversation.archivedAt) return;
  const hasActiveRun = bundle.runs.some((run) =>
    ['queued', 'running', 'cancel_requested'].includes(run.status),
  );
  bundle.conversation.status = hasUnresolvedArtifactCandidate(bundle)
    ? 'waiting_user'
    : hasActiveRun
      ? 'running'
      : fallbackStatus;
  bundle.conversation.updatedAt = updatedAt;
}
