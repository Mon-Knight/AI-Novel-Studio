import { dbCall, generateId, isTauri, nowISO } from '../database/db';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import type {
  ArtifactDecision,
  ArtifactDecisionKind,
  ReviewAuthorization,
} from '../../types/conversation';
import type { ChapterDraft } from '../../types/ai';
import type { WorldRuleSaveGuard } from '../../types/worldRules';
import { draftVersionService } from '../database/draftVersionService';
import { chapterRepository } from '../database/chapterRepository';
import { volumeRepository } from '../database/volumeRepository';
import { inspectChapterCandidateIntegrity } from '../generation/chapterCandidateIntegrity';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { taskConversationService } from './taskConversationService';
import {
  assertBrowserChapterRuleBaseline,
  assertBrowserReviewAuthorizationBaseline,
} from './browserChapterReviewBaseline';
import { findPreviousChapterForContinuity } from './workbenchChapterWriter';
import { planStructuredApply, STRUCTURED_APPLY_REJECTION_MESSAGES } from './structuredApplyPolicy';

export interface AdoptReviewAuthorizedDraftInput {
  authorizationId: string;
  draftId: string;
  expectedDraftVersion: number;
  expectedContentHash: string;
}

export interface AdoptReviewAuthorizedDraftResult {
  authorization: ReviewAuthorization;
  adoptedDraft: ChapterDraft;
  summaryFollowUp: ChapterSummaryFollowUp;
}

export interface ChapterSummaryFollowUp {
  status: 'pending_generation' | 'ready';
  nextAction?: 'summarize_chapter';
  instruction?: '总结本章';
  chapterId: string;
  adoptedDraftId: string;
}

function pendingChapterSummaryFollowUp(
  authorization: ReviewAuthorization,
  adoptedDraftId: string,
): ChapterSummaryFollowUp {
  return {
    status: 'pending_generation',
    nextAction: 'summarize_chapter',
    instruction: '总结本章',
    chapterId: authorization.chapterId,
    adoptedDraftId,
  };
}

function reviewAdoptionError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

async function assertReviewAuthorizedDraftIntegrity(
  authorization: ReviewAuthorization,
  input: AdoptReviewAuthorizedDraftInput,
): Promise<void> {
  const draft = await draftVersionService.getById(authorization.chapterId, input.draftId);
  if (!draft) {
    throw reviewAdoptionError('TARGET_DRAFT_NOT_FOUND', '审阅授权对应的章节草稿不存在。');
  }
  if (draft.novelId !== authorization.novelId || draft.chapterId !== authorization.chapterId) {
    throw reviewAdoptionError(
      'REVIEW_AUTHORIZATION_SCOPE_MISMATCH',
      '审阅授权与最终章节草稿的作品或章节范围不一致。',
    );
  }
  if (draft.versionNo !== input.expectedDraftVersion) {
    throw reviewAdoptionError('DOCUMENT_VERSION_CONFLICT', '目标草稿版本已变化。');
  }
  const contentHash = await computeContentSha256(draft.content);
  if (contentHash !== input.expectedContentHash) {
    throw reviewAdoptionError('DOCUMENT_VERSION_CONFLICT', '目标草稿正文已变化。');
  }
  if (!draft.content.trim()) {
    throw reviewAdoptionError(
      'WORKBENCH_CHAPTER_INTEGRITY_CONTEXT_UNAVAILABLE',
      '最终章节正文为空或不可读取，已阻止采用。',
    );
  }

  const [chapters, volumes] = await Promise.all([
    chapterRepository.getByNovelId(authorization.novelId),
    volumeRepository.getByNovelId(authorization.novelId),
  ]);
  const currentChapter = chapters.find((chapter) => chapter.id === authorization.chapterId);
  if (!currentChapter || currentChapter.novelId !== authorization.novelId) {
    throw reviewAdoptionError(
      'WORKBENCH_CHAPTER_INTEGRITY_CONTEXT_UNAVAILABLE',
      '目标章节无法从当前作品读取，已阻止采用。',
    );
  }

  const previousChapter = findPreviousChapterForContinuity(
    chapters,
    volumes,
    authorization.chapterId,
  );
  let previousChapterText: string | undefined;
  if (previousChapter) {
    const previousDraft = await draftVersionService.getAdoptedByChapterId(previousChapter.id);
    if (!previousDraft?.isAdopted || !previousDraft.content.trim()) {
      throw reviewAdoptionError(
        'WORKBENCH_CHAPTER_INTEGRITY_CONTEXT_UNAVAILABLE',
        '上一章采用正文为空或不可读取，无法完成采用前完整性复核。',
      );
    }
    previousChapterText = previousDraft.content;
  }

  const issues = inspectChapterCandidateIntegrity({
    candidateText: draft.content,
    previousChapterText,
  });
  if (issues.length > 0) {
    throw reviewAdoptionError(
      'WORKBENCH_CHAPTER_INTEGRITY_FAILED',
      `章节正文采用前完整性复核未通过：${issues.map((issue) => issue.code).join(', ')}。请先修复正文。`,
    );
  }
}

export interface RecordDecisionInput extends Pick<
  WorldRuleSaveGuard,
  'expectedRuleSetFingerprint' | 'changeAuthorization'
> {
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

async function resolveDecisionArtifactHash(input: RecordDecisionInput): Promise<string> {
  if (!input.artifactId.trim()) {
    throw new Error('产物决定必须引用 ResultArtifact。');
  }
  if (!isTauri()) {
    const conversation = await taskConversationService.get(input.conversationId);
    const card = conversation?.artifacts.find((item) => item.cardId === input.cardId);
    if (
      !conversation ||
      conversation.conversation.novelId !== input.novelId ||
      !card ||
      card.artifactId !== input.artifactId ||
      !card.content
    ) {
      throw new Error('浏览器候选与当前任务、作品或产物身份不匹配。');
    }
    if (input.targetType === 'chapter') {
      if (!input.chapterId || card.artifactType !== 'chapter_text') {
        throw new Error('章节产物与当前章节不匹配。');
      }
      let source: { data?: { novelId?: string; chapterId?: string }; browserRuleSet?: unknown };
      try {
        source = JSON.parse(card.content) as { data?: { novelId?: string; chapterId?: string } };
      } catch {
        throw new Error('浏览器章节候选缺少可验证的来源信息。');
      }
      if (source.data?.novelId !== input.novelId || source.data.chapterId !== input.chapterId) {
        throw new Error('章节产物与当前章节不匹配。');
      }
      if (input.decision === 'confirm')
        await assertBrowserChapterRuleBaseline(input.novelId, source.browserRuleSet);
    }
    return computeContentSha256(card.content);
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

export const artifactDecisionService = {
  async record(input: RecordDecisionInput): Promise<{
    decision: ArtifactDecision;
    authorization?: ReviewAuthorization;
  }> {
    const artifactHash = await resolveDecisionArtifactHash(input);
    const createdAt = nowISO();
    const requestedDecision: ArtifactDecision = {
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
    };
    const decision = await dbCall<ArtifactDecision>(
      'record_artifact_decision',
      { input: requestedDecision },
      () => taskConversationService.recordBrowserArtifactDecision(requestedDecision),
    );
    if (input.decision === 'confirm' && input.targetType === 'chapter' && input.chapterId) {
      if (isTauri()) {
        const existing = (
          await taskConversationService.get(input.conversationId, { hydrateArtifacts: false })
        )?.authorizations?.find((item) => item.decisionId === decision.decisionId);
        if (existing?.status === 'expired')
          throw new Error('审阅授权已失效，请重新生成候选后审阅。');
        if (existing?.status === 'consumed') return { decision, authorization: existing };
        const authorization = await dbCall<ReviewAuthorization>('issue_review_authorization', {
          input: {
            authorizationId: existing?.authorizationId ?? `review-${generateId()}`,
            decisionId: decision.decisionId,
            artifactId: input.artifactId,
            novelId: input.novelId,
            chapterId: input.chapterId,
            issuedAt: createdAt,
          },
        });
        return { decision, authorization };
      }
      const persisted = await taskConversationService.get(input.conversationId);
      const existingAuthorization = persisted?.authorizations?.find(
        (item) => item.decisionId === decision.decisionId,
      );
      if (existingAuthorization) return { decision, authorization: existingAuthorization };
      const authorization: ReviewAuthorization = {
        authorizationId: `review-${generateId()}`,
        decisionId: decision.decisionId,
        artifactId: input.artifactId,
        novelId: input.novelId,
        chapterId: input.chapterId,
        status: 'issued',
        issuedAt: createdAt,
      };
      return {
        decision,
        authorization: await taskConversationService.issueBrowserReviewAuthorization(
          input.conversationId,
          authorization,
        ),
      };
    }
    return { decision };
  },

  async consume(authorizationId: string, draftId: string): Promise<ReviewAuthorization> {
    if (!isTauri()) {
      void authorizationId;
      void draftId;
      throw new Error('浏览器审阅授权只能在章节草稿采用成功后消费。');
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
      const authorization =
        await taskConversationService.getBrowserReviewAuthorization(authorizationId);
      if (authorization?.status === 'issued') {
        try {
          await assertBrowserReviewAuthorizationBaseline(authorizationId, authorization.novelId);
        } catch (error) {
          if (
            !error ||
            typeof error !== 'object' ||
            !('code' in error) ||
            !['RULE_SET_BASE_CONFLICT', 'RULE_SET_SNAPSHOT_REQUIRED'].includes(String(error.code))
          )
            throw error;
          taskConversationService.expireBrowserReviewAuthorizations(authorization.novelId, [
            authorizationId,
          ]);
          return { ...authorization, status: 'expired' };
        }
      }
      return authorization;
    }
    return dbCall<ReviewAuthorization | null>('get_review_authorization', { authorizationId });
  },

  async ensureChapterSummaryFollowUp(authorizationId: string): Promise<ChapterSummaryFollowUp> {
    if (!authorizationId.trim()) throw new Error('审阅授权不能为空。');
    if (!isTauri()) {
      const authorization = await this.getAuthorization(authorizationId);
      if (
        !authorization ||
        authorization.status !== 'consumed' ||
        !authorization.consumedByDraftId
      ) {
        throw new Error('浏览器审阅授权尚未形成正式采用事实。');
      }
      return pendingChapterSummaryFollowUp(authorization, authorization.consumedByDraftId);
    }
    return dbCall<ChapterSummaryFollowUp>('ensure_chapter_summary_follow_up', {
      authorizationId,
    });
  },

  async adoptReviewAuthorizedDraft(
    input: AdoptReviewAuthorizedDraftInput,
  ): Promise<AdoptReviewAuthorizedDraftResult> {
    const existing = await this.getAuthorization(input.authorizationId);
    if (!existing) throw new Error('审阅授权不存在。');

    if (!isTauri()) {
      if (existing.status === 'consumed') {
        if (existing.consumedByDraftId !== input.draftId) {
          throw new Error('审阅授权已被其他草稿消费。');
        }
        const adopted = await draftVersionService.getById(existing.chapterId, input.draftId);
        if (!adopted?.isAdopted) throw new Error('审阅授权采用事实不完整。');
        return {
          authorization: existing,
          adoptedDraft: adopted,
          summaryFollowUp: pendingChapterSummaryFollowUp(existing, adopted.id),
        };
      }
      if (existing.status !== 'issued') throw new Error('审阅授权已失效。');
      await assertReviewAuthorizedDraftIntegrity(existing, input);
      const currentAuthorization = await this.getAuthorization(input.authorizationId);
      if (currentAuthorization?.status !== 'issued')
        throw new Error('世界规则或授权状态已变化，已阻止采用。');
      const draft = await draftVersionService.adopt(input.draftId, existing.chapterId);
      if (
        draft.id !== input.draftId ||
        draft.novelId !== existing.novelId ||
        draft.chapterId !== existing.chapterId ||
        !draft.isAdopted
      ) {
        throw new Error('章节草稿采用结果与审阅授权不匹配。');
      }
      const auth = await taskConversationService.completeBrowserReviewAdoption(
        input.authorizationId,
        input.draftId,
      );
      return {
        authorization: auth,
        adoptedDraft: draft,
        summaryFollowUp: pendingChapterSummaryFollowUp(auth, draft.id),
      };
    }
    if (existing.status === 'issued') {
      await assertReviewAuthorizedDraftIntegrity(existing, input);
    }
    return dbCall<AdoptReviewAuthorizedDraftResult>('adopt_review_authorized_draft', { input });
  },

  async readCandidateForReview(
    input: RecordDecisionInput,
  ): Promise<{ content: string; artifactHash: string }> {
    const artifactHash = await resolveDecisionArtifactHash(input);
    if (!isTauri()) throw new Error('规则候选正式审阅仅限桌面持久产物。');
    const bundle = await aiTaskRuntimeService.getArtifact(input.artifactId);
    if (
      !bundle.rawContent.trim() ||
      (await computeContentSha256(bundle.rawContent)) !== artifactHash
    ) {
      throw new Error('候选全文无法读取或哈希不匹配，不能确认应用。');
    }
    return { content: bundle.rawContent, artifactHash };
  },

  async applyStructured(input: RecordDecisionInput): Promise<{
    decision: ArtifactDecision;
    authorization?: ReviewAuthorization;
  }> {
    if (!isTauri()) {
      return this.record({
        ...input,
        decision: 'request_apply',
        applyTransactionId: undefined,
        conflictCode: 'BROWSER_APPLY_UNSUPPORTED',
      });
    }

    const bundle = await aiTaskRuntimeService.getArtifact(input.artifactId);
    const { artifact } = bundle;
    const planned = planStructuredApply({
      artifact,
      payload: bundle.structuredPayloadJson,
      requested: {
        novelId: input.novelId,
        targetType: input.targetType,
        targetId: input.targetId,
        chapterId: input.chapterId,
      },
    });
    if (!planned.ok) {
      const message = STRUCTURED_APPLY_REJECTION_MESSAGES[planned.reason];
      throw new Error(
        planned.reason === 'TYPE_UNSUPPORTED' ? `${message}：${artifact.artifactType}` : message,
      );
    }

    const createdAt = nowISO();
    const decision = await dbCall<ArtifactDecision>('apply_structured_artifact', {
      input: {
        decisionId: `decision-${generateId()}`,
        artifactId: artifact.artifactId,
        artifactHash: artifact.contentHash,
        cardId: input.cardId,
        conversationId: input.conversationId,
        idempotencyKey: `${input.cardId}:request_apply:atomic-v1`,
        actor: 'user',
        targetType: planned.plan.targetType,
        targetId: planned.plan.targetId,
        novelId: artifact.sourceNovelId,
        chapterId: planned.plan.chapterId,
        baseRevision: artifact.sourceBaseContentHash,
        ...(input.expectedRuleSetFingerprint
          ? { expectedRuleSetFingerprint: input.expectedRuleSetFingerprint }
          : {}),
        ...(input.changeAuthorization ? { changeAuthorization: input.changeAuthorization } : {}),
        createdAt,
      },
    });
    return { decision };
  },
};
