import { dbCall, generateId, isTauri, nowISO } from '../database/db';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import type {
  ArtifactDecision,
  ArtifactDecisionKind,
  ReviewAuthorization,
} from '../../types/conversation';
import { applyArtifactBundle } from './artifactApply';

export interface RecordDecisionInput {
  conversationId: string;
  cardId: string;
  artifactId: string;
  decision: ArtifactDecisionKind;
  targetType: string;
  targetId: string;
  novelId: string;
  chapterId?: string;
  baseRevision?: string;
  applyTransactionId?: string;
  conflictCode?: string;
}

function localDecision(input: RecordDecisionInput, artifactHash: string): ArtifactDecision {
  return {
    decisionId: `decision-${generateId()}`,
    artifactId: input.artifactId,
    artifactHash,
    cardId: input.cardId,
    conversationId: input.conversationId,
    decision: input.decision,
    idempotencyKey: `${input.cardId}:${input.decision}`,
    actor: 'user',
    targetType: input.targetType,
    targetId: input.targetId,
    baseRevision: input.baseRevision,
    applyTransactionId: input.applyTransactionId,
    conflictCode: input.conflictCode,
    createdAt: nowISO(),
  };
}

export const artifactDecisionService = {
  async record(input: RecordDecisionInput): Promise<{
    decision: ArtifactDecision;
    authorization?: ReviewAuthorization;
  }> {
    const artifactHash = input.artifactId
      ? await aiTaskRuntimeService
          .getArtifact(input.artifactId)
          .then((bundle) => bundle.artifact.contentHash)
          .catch(() => 'browser-fallback-hash')
      : 'browser-fallback-hash';
    const createdAt = nowISO();
    const decision = await dbCall<ArtifactDecision>(
      'record_artifact_decision',
      {
        input: {
          decisionId: `decision-${generateId()}`,
          artifactId: input.artifactId,
          artifactHash,
          cardId: input.cardId,
          conversationId: input.conversationId,
          decision: input.decision,
          idempotencyKey: `${input.cardId}:${input.decision}`,
          actor: 'user',
          targetType: input.targetType,
          targetId: input.targetId,
          baseRevision: input.baseRevision,
          applyTransactionId: input.applyTransactionId,
          conflictCode: input.conflictCode,
          createdAt,
        },
      },
      () => localDecision(input, artifactHash),
    );
    if (
      input.decision === 'confirm' &&
      input.targetType === 'chapter' &&
      input.chapterId &&
      isTauri()
    ) {
      const authorization = await dbCall<ReviewAuthorization>('issue_review_authorization', {
        input: {
          authorizationId: `review-${generateId()}`,
          decisionId: decision.decisionId,
          artifactId: input.artifactId,
          novelId: input.novelId,
          chapterId: input.chapterId,
          issuedAt: createdAt,
        },
      });
      return { decision, authorization };
    }
    return { decision };
  },

  consume(authorizationId: string, draftId: string): Promise<ReviewAuthorization> {
    return dbCall<ReviewAuthorization>('consume_review_authorization', {
      input: {
        authorizationId,
        draftId,
        consumedAt: nowISO(),
      },
    });
  },

  async applyStructured(input: RecordDecisionInput): Promise<{
    decision: ArtifactDecision;
    authorization?: ReviewAuthorization;
  }> {
    if (!isTauri()) {
      return this.record({
        ...input,
        decision: 'request_apply',
        conflictCode: 'BROWSER_APPLY_UNSUPPORTED',
      });
    }
    const bundle = await aiTaskRuntimeService.getArtifact(input.artifactId);
    const outcome = await applyArtifactBundle(input, bundle);
    return this.record({
      ...input,
      decision: 'request_apply',
      applyTransactionId: outcome.applyTransactionId,
      conflictCode: outcome.conflictCode,
      baseRevision: input.baseRevision ?? bundle.artifact.contentHash,
    });
  },
};
