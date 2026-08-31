import type { ConversationArtifactCard, ReviewAuthorization } from '../../../types/conversation';
import type { ResultArtifactType } from '../../../types/result-artifact';
import { computeContentSha256 } from '../../../utils/contentIntegrity';
import { isTauri } from '../../database/db';
import { draftVersionService } from '../../database/draftVersionService';
import { aiTaskRuntimeService } from '../../ai-tasks/aiTaskRuntimeService';
import { taskConversationService } from '../../conversation/taskConversationService';
import {
  artifactDecisionService,
  type AdoptReviewAuthorizedDraftResult,
} from '../../conversation/artifactDecisionService';
import { projectCapability } from './projectCapability';
import {
  failure,
  hashPublicValue,
  mapUnknownError,
  success,
  validateChapterScope,
  validateConversationScope,
  validateNonEmpty,
} from './domainResult';
import type {
  AdoptedDraftResult,
  ArtifactPublishResult,
  ArtifactReviewResult,
  DomainRequest,
  DomainResult,
} from './domainTypes';

const ARTIFACT_TYPES = new Set<ResultArtifactType>([
  'generic_text',
  'generic_json',
  'chapter_text',
  'scene_text',
  'outline',
  'character_candidates',
  'event_candidates',
  'setting_candidates',
  'quality_report',
  'chapter_summary',
  'volume_summary',
  'style_analysis',
  'tool_result',
  'plan',
]);

function isArtifactType(value: string): value is ResultArtifactType {
  return ARTIFACT_TYPES.has(value as ResultArtifactType);
}

function draftSource(): {
  source: 'sqlite' | 'localstorage';
  storageMode: 'sqlite' | 'browser_fallback';
} {
  return isTauri()
    ? { source: 'sqlite', storageMode: 'sqlite' }
    : { source: 'localstorage', storageMode: 'browser_fallback' };
}

function candidateScope(payload: unknown): { novelId?: string; chapterId?: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const root = payload as Record<string, unknown>;
  const nested =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : undefined;
  return {
    novelId:
      typeof root.novelId === 'string'
        ? root.novelId
        : typeof nested?.novelId === 'string'
          ? nested.novelId
          : undefined,
    chapterId:
      typeof root.chapterId === 'string'
        ? root.chapterId
        : typeof nested?.chapterId === 'string'
          ? nested.chapterId
          : undefined,
  };
}

async function verifyCandidateTarget(
  card: ConversationArtifactCard,
  request: DomainRequest,
): Promise<DomainResult<never> | undefined> {
  if (isTauri()) {
    if (!card.artifactId) return failure('INTEGRITY_ERROR', '桌面候选缺少 ResultArtifact 引用。');
    const bundle = await aiTaskRuntimeService.getArtifact(card.artifactId);
    const artifact = bundle.artifact;
    if (
      artifact.sourceNovelId !== request.novelId ||
      artifact.sourceChapterId !== request.chapterId ||
      !['chapter_text', 'scene_text'].includes(artifact.artifactType)
    ) {
      return failure('SCOPE_MISMATCH', '候选产物与当前作品/章节不匹配。', 'artifact', 'artifact');
    }
    return undefined;
  }

  if (!card.content) return failure('INTEGRITY_ERROR', '浏览器候选缺少可验证的作用域快照。');
  let payload: unknown;
  try {
    payload = JSON.parse(card.content) as unknown;
  } catch {
    return failure('INTEGRITY_ERROR', '浏览器候选作用域快照无法解析。');
  }
  const scope = candidateScope(payload);
  if (scope.novelId !== request.novelId || scope.chapterId !== request.chapterId) {
    return failure('SCOPE_MISMATCH', '候选产物与当前作品/章节不匹配。', 'artifact', 'artifact');
  }
  return undefined;
}

function findCard(
  bundle: Awaited<ReturnType<typeof taskConversationService.get>>,
  request: DomainRequest,
): ConversationArtifactCard | undefined {
  if (!bundle) return undefined;
  return bundle.artifacts.find(
    (card) =>
      (request.cardId ? card.cardId === request.cardId : true) &&
      (request.artifactId ? card.artifactId === request.artifactId : true),
  );
}

function mapReview(
  decision: Awaited<ReturnType<typeof artifactDecisionService.record>>,
): ArtifactReviewResult {
  return {
    decisionId: decision.decision.decisionId,
    artifactId: decision.decision.artifactId,
    ...(decision.authorization?.authorizationId
      ? { authorizationId: decision.authorization.authorizationId }
      : {}),
    status: decision.authorization?.status ?? 'recorded',
  };
}

function mapAdopted(
  authorization: ReviewAuthorization,
  outcome: AdoptReviewAuthorizedDraftResult,
  contentHash: string,
): AdoptedDraftResult {
  const draft = outcome.adoptedDraft;
  return {
    authorizationId: authorization.authorizationId,
    draftId: draft.id,
    chapterId: draft.chapterId,
    novelId: draft.novelId,
    versionNo: draft.versionNo,
    isAdopted: true,
    contentHash,
  };
}

export const artifactCapability = {
  /**
   * Publish a candidate projection.  The method never accepts a formal-draft
   * write request; desktop callers must provide an existing ResultArtifact ID.
   */
  async publishCandidate(request: DomainRequest): Promise<DomainResult<ArtifactPublishResult>> {
    const scopeError = validateConversationScope(request);
    if (scopeError) return scopeError;
    const titleError = validateNonEmpty(request.title, 'title');
    if (titleError) return titleError;
    const artifactType = request.artifactType ?? 'chapter_text';
    if (!isArtifactType(artifactType)) {
      return failure('INVALID_ARGUMENT', `不支持的候选产物类型：${artifactType}。`);
    }
    if (!request.artifactId && request.structuredPayload === undefined) {
      return failure('INVALID_ARGUMENT', '候选发布必须引用 ResultArtifact 或结构化候选。');
    }
    if (['chapter_text', 'scene_text'].includes(artifactType)) {
      if (!request.chapterId) return failure('INVALID_SCOPE', '章节候选必须绑定 chapterId。');
      if (request.structuredPayload !== undefined) {
        const scope = candidateScope(request.structuredPayload);
        if (scope.novelId !== request.novelId || scope.chapterId !== request.chapterId) {
          return failure('SCOPE_MISMATCH', '候选结构与当前作品/章节不匹配。');
        }
      }
    }

    try {
      if (['chapter_text', 'scene_text'].includes(artifactType)) {
        const target = await projectCapability.readChapterPosition({
          novelId: request.novelId,
          chapterId: request.chapterId,
        });
        if (!target.ok) {
          return failure(
            target.error?.code ?? 'UPSTREAM_FAILURE',
            target.error?.message ?? '章节候选目标无法确认。',
            target.source,
            target.storageMode,
            target.warnings,
          );
        }
      }
      const bundle = await taskConversationService.get(request.conversationId!);
      if (!bundle) return failure('NOT_FOUND', '任务对话不存在。', 'runtime', 'runtime');
      if (bundle.conversation.novelId !== request.novelId) {
        return failure('SCOPE_MISMATCH', '任务对话不属于当前作品。', 'runtime', 'runtime');
      }
      let card: ConversationArtifactCard;
      if (request.artifactId) {
        card = await taskConversationService.createArtifactCard({
          conversationId: request.conversationId!,
          artifactId: request.artifactId,
          artifactType,
          title: request.title!.trim(),
          summary: request.summary?.trim() || '候选产物，等待用户审阅。',
          status: 'candidate',
          createdAt: new Date().toISOString(),
        });
      } else {
        card = await taskConversationService.publishStructuredCandidate({
          conversationId: request.conversationId!,
          novelId: request.novelId,
          chapterId: request.chapterId,
          artifactType,
          derivationType: request.derivationType,
          title: request.title!.trim(),
          summary: request.summary?.trim() || '结构化候选，等待用户确认。',
          structuredPayloadJson: request.structuredPayload,
        });
      }
      const data: ArtifactPublishResult = {
        conversationId: card.conversationId,
        cardId: card.cardId,
        ...(card.artifactId ? { artifactId: card.artifactId } : {}),
        artifactType: card.artifactType,
        status: card.status,
      };
      return success(data, {
        source: 'artifact',
        storageMode: 'artifact',
        warnings: [],
        revision: null,
        contentHash: await hashPublicValue(data),
      });
    } catch (error) {
      return mapUnknownError(error, 'artifact');
    }
  },

  /** Issue the user审阅 authorization; model callers must not bypass this method. */
  async requestReview(request: DomainRequest): Promise<DomainResult<ArtifactReviewResult>> {
    const scopeError = validateChapterScope(request);
    if (scopeError) return scopeError;
    if (!request.conversationId || !request.cardId || !request.artifactId) {
      return failure('INVALID_SCOPE', '审阅请求需要 conversationId、cardId 和 artifactId。');
    }
    const confirmed = validateNonEmpty(request.userConfirmedAt, 'userConfirmedAt');
    if (confirmed) return failure('CONFIRMATION_REQUIRED', '候选进入审阅前必须记录用户确认时间。');

    try {
      const bundle = await taskConversationService.get(request.conversationId);
      if (!bundle) return failure('NOT_FOUND', '任务对话不存在。', 'runtime', 'runtime');
      if (bundle.conversation.novelId !== request.novelId) {
        return failure('SCOPE_MISMATCH', '任务对话不属于当前作品。', 'runtime', 'runtime');
      }
      const card = findCard(bundle, request);
      if (!card)
        return failure('NOT_FOUND', '候选产物卡片不存在或不匹配。', 'artifact', 'artifact');
      const targetError = await verifyCandidateTarget(card, request);
      if (targetError) return targetError;
      const recorded = await artifactDecisionService.record({
        conversationId: request.conversationId,
        cardId: card.cardId,
        artifactId: request.artifactId,
        decision: 'confirm',
        targetType: 'chapter',
        targetId: request.chapterId!,
        novelId: request.novelId,
        chapterId: request.chapterId,
      });
      const data = mapReview(recorded);
      return success(data, {
        source: 'artifact',
        storageMode: 'artifact',
        warnings: [],
        revision: null,
        contentHash: await hashPublicValue(data),
      });
    } catch (error) {
      return mapUnknownError(error, 'artifact');
    }
  },

  /** Consume a user-issued authorization and perform the existing CAS adopt path. */
  async applyAuthorizedDraft(request: DomainRequest): Promise<DomainResult<AdoptedDraftResult>> {
    const scopeError = validateChapterScope(request);
    if (scopeError) return scopeError;
    if (!request.authorizationId || !request.draftId) {
      return failure('INVALID_SCOPE', '采用请求需要 authorizationId 和 draftId。');
    }
    if (
      !Number.isInteger(request.expectedDraftVersion) ||
      (request.expectedDraftVersion ?? 0) < 1 ||
      !request.expectedContentHash?.trim()
    ) {
      return failure('INVALID_ARGUMENT', '采用请求必须携带期望的草稿版本和正文 hash。');
    }

    try {
      const authorization = await artifactDecisionService.getAuthorization(request.authorizationId);
      if (!authorization) return failure('NOT_FOUND', '审阅授权不存在。', 'artifact', 'artifact');
      if (authorization.status !== 'issued') {
        return failure('CONFLICT', '审阅授权已消费或已过期。', 'artifact', 'artifact');
      }
      if (
        authorization.novelId !== request.novelId ||
        authorization.chapterId !== request.chapterId
      ) {
        return failure('SCOPE_MISMATCH', '审阅授权与当前作品/章节不匹配。', 'artifact', 'artifact');
      }
      const draft = await draftVersionService.getById(request.chapterId!, request.draftId);
      const persistedSource = draftSource();
      if (!draft)
        return failure(
          'NOT_FOUND',
          '目标草稿不存在。',
          persistedSource.source,
          persistedSource.storageMode,
        );
      if (draft.novelId !== request.novelId || draft.chapterId !== request.chapterId) {
        return failure(
          'SCOPE_MISMATCH',
          '目标草稿与当前作品/章节不匹配。',
          persistedSource.source,
          persistedSource.storageMode,
        );
      }
      if (draft.versionNo !== request.expectedDraftVersion) {
        return failure(
          'CONFLICT',
          '目标草稿版本已变化。',
          persistedSource.source,
          persistedSource.storageMode,
        );
      }
      const actualHash =
        draft.contentState?.status === 'ready'
          ? draft.contentState.contentHash
          : await computeContentSha256(draft.content);
      if (actualHash !== request.expectedContentHash) {
        return failure(
          'CONFLICT',
          '目标草稿正文已变化。',
          persistedSource.source,
          persistedSource.storageMode,
        );
      }
      const outcome = await artifactDecisionService.adoptReviewAuthorizedDraft({
        authorizationId: request.authorizationId,
        draftId: request.draftId,
        expectedDraftVersion: request.expectedDraftVersion,
        expectedContentHash: request.expectedContentHash,
      });
      const data = mapAdopted(outcome.authorization, outcome, actualHash);
      return success(data, {
        source: 'artifact',
        storageMode: 'artifact',
        warnings: [],
        revision: null,
        contentHash: await hashPublicValue(data),
      });
    } catch (error) {
      return mapUnknownError(error, 'artifact');
    }
  },
};

export type ArtifactCapability = typeof artifactCapability;
