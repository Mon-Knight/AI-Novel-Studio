import { dbCall, generateId, isTauri, nowISO } from '../database/db';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import type {
  ArtifactDecision,
  ArtifactDecisionKind,
  ReviewAuthorization,
} from '../../types/conversation';
import type { ResultArtifactBundle, ResultArtifactType } from '../../types/result-artifact';
import { applyArtifactBundle } from './artifactApply';
import { taskConversationService } from './taskConversationService';

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
    const bundle = isTauri()
      ? await aiTaskRuntimeService.getArtifact(input.artifactId)
      : await syntheticBrowserBundle(input);
    if (!bundle) {
      return this.record({
        ...input,
        decision: 'request_apply',
        conflictCode: 'BROWSER_APPLY_UNSUPPORTED',
      });
    }
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

async function syntheticBrowserBundle(
  input: RecordDecisionInput,
): Promise<ResultArtifactBundle | undefined> {
  const conversation = await taskConversationService.get(input.conversationId);
  const card = conversation?.artifacts.find((item) => item.cardId === input.cardId);
  if (!card?.content) return undefined;
  let structured: unknown;
  try {
    structured = JSON.parse(card.content) as unknown;
  } catch {
    structured = undefined;
  }
  const artifactType: ResultArtifactType =
    card.artifactType === 'generic' ? 'generic_json' : card.artifactType;
  return {
    artifact: {
      artifactId: card.artifactId || input.artifactId,
      taskId: 'browser-fallback',
      attemptId: 'browser-fallback',
      sourceInputSnapshotId: 'browser-fallback',
      artifactType,
      schemaVersion: 1,
      rawContentRefId: 'browser-fallback',
      sourceNovelId: input.novelId,
      contentHash: 'browser-fallback-hash',
      contentLength: card.content.length,
      processingStatus: 'valid',
      createdAt: card.createdAt,
    },
    rawContent: card.content,
    structuredPayloadJson: structured,
    issues: [],
  };
}
