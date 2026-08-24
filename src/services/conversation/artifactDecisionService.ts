import { dbCall, generateId, isTauri, nowISO } from '../database/db';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import type {
  ArtifactDecision,
  ArtifactDecisionKind,
  ReviewAuthorization,
} from '../../types/conversation';
import type { ResultArtifactBundle, ResultArtifactType } from '../../types/result-artifact';
import type { ChapterDraft } from '../../types/ai';
import { draftVersionService } from '../database/draftVersionService';
import { applyArtifactBundle } from './artifactApply';
import { taskConversationService } from './taskConversationService';

export interface AdoptReviewAuthorizedDraftInput {
  authorizationId: string;
  draftId: string;
  expectedDraftVersion: number;
  expectedContentHash: string;
}

export interface AdoptReviewAuthorizedDraftResult {
  authorization: ReviewAuthorization;
  adoptedDraft: ChapterDraft;
}

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

const browserAuthorizations = new Map<string, ReviewAuthorization>();

async function resolveDecisionArtifactHash(input: RecordDecisionInput): Promise<string> {
  if (!input.artifactId.trim()) {
    throw new Error('产物决定必须引用 ResultArtifact。');
  }
  if (!isTauri()) {
    return aiTaskRuntimeService
      .getArtifact(input.artifactId)
      .then((bundle) => bundle.artifact.contentHash)
      .catch(() => 'browser-fallback-hash');
  }

  const bundle = await aiTaskRuntimeService.getArtifact(input.artifactId);
  const { artifact } = bundle;
  if (!['valid', 'valid_with_warnings'].includes(artifact.processingStatus)) {
    throw new Error('产物尚未通过结构校验，不能记录用户决定。');
  }
  if (artifact.sourceNovelId !== input.novelId) {
    throw new Error('产物与当前作品不匹配。');
  }
  if (
    input.targetType === 'chapter' &&
    (!input.chapterId ||
      artifact.artifactType !== 'chapter_text' ||
      artifact.sourceChapterId !== input.chapterId)
  ) {
    throw new Error('章节产物与当前章节不匹配。');
  }
  return artifact.contentHash;
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
    const artifactHash = await resolveDecisionArtifactHash(input);
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
    if (input.decision === 'confirm' && input.targetType === 'chapter' && input.chapterId) {
      if (isTauri()) {
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
      const auth: ReviewAuthorization = {
        authorizationId: `review-${generateId()}`,
        decisionId: decision.decisionId,
        artifactId: input.artifactId,
        novelId: input.novelId,
        chapterId: input.chapterId,
        status: 'issued',
        issuedAt: createdAt,
      };
      browserAuthorizations.set(auth.authorizationId, auth);
      return { decision, authorization: auth };
    }
    return { decision };
  },

  async consume(authorizationId: string, draftId: string): Promise<ReviewAuthorization> {
    if (!isTauri()) {
      const existing = browserAuthorizations.get(authorizationId);
      const updated: ReviewAuthorization = {
        authorizationId,
        decisionId: existing?.decisionId ?? 'decision-browser',
        artifactId: existing?.artifactId ?? '',
        novelId: existing?.novelId ?? '',
        chapterId: existing?.chapterId ?? '',
        status: 'consumed',
        issuedAt: existing?.issuedAt ?? nowISO(),
        consumedAt: nowISO(),
        consumedByDraftId: draftId,
      };
      browserAuthorizations.set(authorizationId, updated);
      return updated;
    }
    return dbCall<ReviewAuthorization>('consume_review_authorization', {
      input: {
        authorizationId,
        draftId,
        consumedAt: nowISO(),
      },
    });
  },

  async getAuthorization(authorizationId: string): Promise<ReviewAuthorization | null> {
    if (!authorizationId) return null;
    if (!isTauri()) {
      return browserAuthorizations.get(authorizationId) ?? null;
    }
    return dbCall<ReviewAuthorization | null>(
      'get_review_authorization',
      { authorizationId },
      () => browserAuthorizations.get(authorizationId) ?? null,
    );
  },

  async adoptReviewAuthorizedDraft(
    input: AdoptReviewAuthorizedDraftInput,
  ): Promise<AdoptReviewAuthorizedDraftResult> {
    if (!isTauri()) {
      const existing = await this.getAuthorization(input.authorizationId);
      if (!existing) throw new Error('审阅授权不存在。');
      const auth = await this.consume(input.authorizationId, input.draftId);
      const draft = await draftVersionService.adopt(input.draftId, existing.chapterId);
      return {
        authorization: auth,
        adoptedDraft: draft,
      };
    }
    return dbCall<AdoptReviewAuthorizedDraftResult>('adopt_review_authorized_draft', { input });
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
