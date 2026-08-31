import type { ChapterDraft } from '../../types/ai';
import type { ArtifactDecision, ConversationArtifactCard } from '../../types/conversation';
import type { ResultArtifactBundle } from '../../types/result-artifact';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import { draftVersionService } from '../database/draftVersionService';
import {
  artifactDecisionService,
  type AdoptReviewAuthorizedDraftResult,
  type RecordDecisionInput,
} from './artifactDecisionService';

const VALID_ARTIFACT_STATUSES = new Set(['valid', 'valid_with_warnings']);

export interface WorkbenchChapterConversationAdoptionInput {
  conversationId: string;
  novelId: string;
  chapterId: string;
  artifact: ConversationArtifactCard;
}

export interface WorkbenchChapterConversationAdoptionDependencies {
  getArtifact?: (artifactId: string) => Promise<ResultArtifactBundle>;
  recordDecision?: (
    input: RecordDecisionInput,
  ) => ReturnType<typeof artifactDecisionService.record>;
  createDraft?: typeof draftVersionService.create;
  adoptDraft?: typeof artifactDecisionService.adoptReviewAuthorizedDraft;
}

export interface WorkbenchChapterConversationAdoptionResult {
  decision: ArtifactDecision;
  adoption: AdoptReviewAuthorizedDraftResult;
}

function adoptionError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

async function verifyCandidate(
  input: WorkbenchChapterConversationAdoptionInput,
  getArtifact: (artifactId: string) => Promise<ResultArtifactBundle>,
): Promise<ResultArtifactBundle> {
  const { artifact } = input;
  if (!artifact.artifactId || artifact.artifactType !== 'chapter_text') {
    throw adoptionError('WORKBENCH_DECISION_TARGET_INVALID', '当前产物不是可采用的章节正文候选。');
  }
  if (
    artifact.conversationId !== input.conversationId ||
    artifact.artifactEvidence?.sourceNovelId !== input.novelId ||
    artifact.artifactEvidence.sourceChapterId !== input.chapterId ||
    !VALID_ARTIFACT_STATUSES.has(artifact.artifactEvidence.processingStatus)
  ) {
    throw adoptionError(
      'WORKBENCH_DECISION_SCOPE_MISMATCH',
      '章节候选与当前任务、作品或章节范围不一致。',
    );
  }

  const bundle = await getArtifact(artifact.artifactId);
  if (
    bundle.artifact.artifactId !== artifact.artifactId ||
    bundle.artifact.artifactType !== 'chapter_text' ||
    bundle.artifact.sourceNovelId !== input.novelId ||
    bundle.artifact.sourceChapterId !== input.chapterId ||
    !VALID_ARTIFACT_STATUSES.has(bundle.artifact.processingStatus)
  ) {
    throw adoptionError(
      'WORKBENCH_DECISION_SCOPE_MISMATCH',
      '章节候选的权威 ResultArtifact 与当前目标不一致。',
    );
  }
  if (!bundle.rawContent.trim()) {
    throw adoptionError('WORKBENCH_CHAPTER_INTEGRITY_CONTEXT_UNAVAILABLE', '章节候选正文为空。');
  }
  const contentHash = await computeContentSha256(bundle.rawContent);
  if (
    bundle.artifact.contentHash &&
    !contentHash.startsWith('fallback_') &&
    contentHash.toLowerCase() !== bundle.artifact.contentHash.toLowerCase()
  ) {
    throw adoptionError('WORKBENCH_CHAPTER_INTEGRITY_FAILED', '章节候选正文哈希校验失败。');
  }
  return bundle;
}

/**
 * Applies an unchanged chapter candidate from an explicit conversation command.
 * The command shortens the UI path only; it retains the existing review
 * authorization, draft persistence, integrity check, and atomic adoption chain.
 */
export async function adoptWorkbenchChapterCandidateFromConversation(
  input: WorkbenchChapterConversationAdoptionInput,
  dependencies: WorkbenchChapterConversationAdoptionDependencies = {},
): Promise<WorkbenchChapterConversationAdoptionResult> {
  const getArtifact = dependencies.getArtifact ?? aiTaskRuntimeService.getArtifact;
  const recordDecision =
    dependencies.recordDecision ?? artifactDecisionService.record.bind(artifactDecisionService);
  const createDraft =
    dependencies.createDraft ?? draftVersionService.create.bind(draftVersionService);
  const adoptDraft =
    dependencies.adoptDraft ??
    artifactDecisionService.adoptReviewAuthorizedDraft.bind(artifactDecisionService);
  const bundle = await verifyCandidate(input, getArtifact);
  const artifactId = input.artifact.artifactId!;
  const result = await recordDecision({
    conversationId: input.conversationId,
    cardId: input.artifact.cardId,
    artifactId,
    decision: 'confirm',
    targetType: 'chapter',
    targetId: input.chapterId,
    novelId: input.novelId,
    chapterId: input.chapterId,
    baseRevision: input.artifact.artifactEvidence?.baseContentHash,
  });
  if (!result.authorization) {
    throw adoptionError(
      'WORKBENCH_REVIEW_AUTHORIZATION_MISSING',
      '章节候选已确认，但没有形成可消费的审阅授权。',
    );
  }

  const draft: ChapterDraft = await createDraft({
    novelId: input.novelId,
    chapterId: input.chapterId,
    content: bundle.rawContent,
    source: 'ai_generated',
    operationId: `workbench-dialogue-adopt-${result.authorization.authorizationId}`,
    aiTaskId: bundle.artifact.taskId,
    note: '通过创作工作台对话显式采用未修改候选',
  });
  const expectedContentHash = await computeContentSha256(draft.content);
  return {
    decision: result.decision,
    adoption: await adoptDraft({
      authorizationId: result.authorization.authorizationId,
      draftId: draft.id,
      expectedDraftVersion: draft.versionNo,
      expectedContentHash,
    }),
  };
}
