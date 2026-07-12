import type { ChapterDraft } from '../../types/ai';
import type {
  CandidateGenerationActivity,
  CandidateReviewRecord,
  PlacementProposal,
} from '../../types/placement';
import { deriveCandidateLifecycle } from '../../features/workspace/candidateLifecycle';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { chapterRepository } from '../database/chapterRepository';
import { dbCall } from '../database/db';
import { draftVersionService } from '../database/draftVersionService';
import { chapterConstraintValidationService } from './chapterConstraintValidationService';
import { placementApplyService } from './placementApplyService';
import { calculateChapterDiff } from './chapterDiffService';

interface AdoptCandidateInput {
  record: CandidateReviewRecord;
  currentNovelId: string;
  currentChapterId: string;
  currentEditorContent: string;
  source: 'ai_generated' | 'ai_regenerated';
  note?: string;
}

const pendingCandidateAdoptions = new Map<string, Promise<ChapterDraft>>();

interface CandidateRecoveryArtifactDto {
  candidateId: string;
  artifactId: string;
  taskId: string;
  novelId: string;
  chapterId: string;
  sourceDraftId: string;
  sourceDraftVersion: number;
  baseContentHash: string;
  content: string;
  contentHash: string;
  contentLength: number;
  processingStatus: string;
  taskStatus: string;
  proposal?: PlacementProposal;
  adopted: boolean;
  createdAt: string;
}

interface ChapterCandidateRecoveryDto {
  candidate?: CandidateRecoveryArtifactDto;
  latestTask?: { taskId: string; status: string; resultArtifactId?: string; createdAt: string };
}

function browserRecovery(novelId: string, chapterId: string): ChapterCandidateRecoveryDto {
  const artifacts: CandidateRecoveryArtifactDto[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith('ai_novel_studio_result_artifact_')) continue;
    try {
      const stored = JSON.parse(localStorage.getItem(key) || '{}') as Record<string, any>;
      if (stored.artifactType !== 'chapter_text'
        || !['valid', 'valid_with_warnings'].includes(stored.processingStatus)
        || stored.source?.novelId !== novelId
        || stored.source?.chapterId !== chapterId) continue;
      const proposals: PlacementProposal[] = [];
      for (let proposalIndex = 0; proposalIndex < localStorage.length; proposalIndex += 1) {
        const proposalKey = localStorage.key(proposalIndex);
        if (!proposalKey?.startsWith('ai_novel_studio_placement_')) continue;
        const proposal = JSON.parse(localStorage.getItem(proposalKey) || '{}') as PlacementProposal;
        if (proposal.artifactId === stored.artifactId) proposals.push(proposal);
      }
      proposals.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      const validationRuns = JSON.parse(localStorage.getItem(
        `ai_novel_studio_chapter_constraint_validation_${stored.artifactId}`,
      ) || '[]') as Array<{ status?: string }>;
      const latestValidationStatus = validationRuns[validationRuns.length - 1]?.status;
      if (!proposals[0] && latestValidationStatus !== 'blocked') continue;
      artifacts.push({
        candidateId: stored.artifactId,
        artifactId: stored.artifactId,
        taskId: stored.taskId,
        novelId,
        chapterId,
        sourceDraftId: stored.source.draftId,
        sourceDraftVersion: stored.source.draftVersion,
        baseContentHash: stored.source.baseContentHash,
        content: stored.displayContent || stored.rawContent || '',
        contentHash: '',
        contentLength: Array.from(stored.displayContent || stored.rawContent || '').length,
        processingStatus: stored.processingStatus,
        taskStatus: 'completed',
        proposal: proposals[0],
        adopted: false,
        createdAt: stored.taskCreatedAt || stored.createdAt || '',
      });
    } catch {
      // A corrupt unrelated browser artifact must not prevent other candidates from recovering.
    }
  }
  artifacts.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return { candidate: artifacts[0] };
}

function recoveredActivity(
  latestTask: ChapterCandidateRecoveryDto['latestTask'],
  novelId: string,
  chapterId: string,
): CandidateGenerationActivity | null {
  if (!latestTask) return null;
  if (latestTask.status === 'failed') {
    return { requestId: latestTask.taskId, taskId: latestTask.taskId, novelId, chapterId, status: 'failed', message: '上次生成失败，旧候选仍可继续审查。' };
  }
  if (latestTask.status === 'cancelled' || latestTask.status === 'cancel_requested') {
    return { requestId: latestTask.taskId, taskId: latestTask.taskId, novelId, chapterId, status: 'cancelled', message: '上次生成已取消。' };
  }
  if (!['completed', 'applied'].includes(latestTask.status)) {
    return { requestId: latestTask.taskId, taskId: latestTask.taskId, novelId, chapterId, status: 'failed', message: '上次生成因应用退出而中断，可以重新生成。' };
  }
  return {
    requestId: latestTask.taskId,
    taskId: latestTask.taskId,
    candidateId: latestTask.resultArtifactId,
    novelId,
    chapterId,
    status: 'idle',
  };
}

async function validateAuthoritativeContext(input: AdoptCandidateInput): Promise<void> {
  const { record } = input;
  const candidateId = record.candidate.candidateId || record.candidate.artifactId;
  if (candidateId !== record.candidate.artifactId) {
    throw new Error('候选身份与 Artifact 不一致。');
  }
  const chapter = await chapterRepository.getById(input.currentChapterId);
  if (!chapter || chapter.deletedAt || chapter.novelId !== input.currentNovelId) {
    throw new Error('目标章节不存在或不属于当前作品。');
  }
  const drafts = await draftVersionService.getByChapterId(input.currentChapterId);
  if (drafts.some((draft) => draft.artifactId === candidateId)) {
    throw new Error('该候选已经采用，不能再次采用。');
  }
  const latestDraft = drafts.reduce<ChapterDraft | null>(
    (latest, draft) => (!latest || draft.versionNo > latest.versionNo ? draft : latest),
    null,
  );
  const latestValidation = await chapterConstraintValidationService.getLatest(candidateId);
  const authoritativeRecord: CandidateReviewRecord = {
    ...record,
    candidate: { ...record.candidate, constraintValidation: latestValidation || record.candidate.constraintValidation },
  };
  const lifecycle = deriveCandidateLifecycle({
    record: authoritativeRecord,
    currentNovelId: input.currentNovelId,
    currentChapterId: input.currentChapterId,
    currentDraft: latestDraft,
    currentEditorContent: input.currentEditorContent,
  });
  if (!lifecycle.canAdopt) throw new Error(lifecycle.cannotAdoptReason || '当前候选不可采用。');

  const actualCandidateHash = await computeContentSha256(record.candidate.content);
  if (record.candidate.contentHash !== actualCandidateHash) {
    throw new Error('候选正文哈希已变化，已阻止采用。');
  }
  const proposalValidation = await placementApplyService.validateProposal(record.candidate.proposal!.proposalId);
  if (proposalValidation.stale) {
    throw new Error(proposalValidation.reason || '候选目标已过期，请重新生成。');
  }
}

export const chapterCandidateService = {
  async recover(novelId: string, chapterId: string): Promise<{
    record: CandidateReviewRecord | null;
    activity: CandidateGenerationActivity | null;
  }> {
    const recovered = await dbCall<ChapterCandidateRecoveryDto>(
      'recover_chapter_candidate',
      { novelId, chapterId },
      () => browserRecovery(novelId, chapterId),
    );
    const activity = recoveredActivity(recovered.latestTask, novelId, chapterId);
    const persisted = recovered.candidate;
    if (!persisted) return { record: null, activity };

    const chapterDrafts = await draftVersionService.getByChapterId(chapterId);
    const sourceDraft = chapterDrafts.find((draft) => draft.id === persisted.sourceDraftId);
    const adopted = persisted.adopted
      || chapterDrafts.some((draft) => draft.artifactId === persisted.artifactId);
    if (!sourceDraft || sourceDraft.novelId !== novelId || sourceDraft.contentState?.status === 'unavailable') {
      return {
        record: {
          candidate: {
            candidateId: persisted.candidateId,
            artifactId: persisted.artifactId,
            taskId: persisted.taskId,
            content: persisted.content,
            contentHash: persisted.contentHash || await computeContentSha256(persisted.content),
            wordCount: Array.from(persisted.content).length,
            createdAt: persisted.createdAt,
          },
          target: {
            resultId: persisted.artifactId,
            artifactId: persisted.artifactId,
            taskId: persisted.taskId,
            novelId,
            chapterId,
            sourceDraftId: persisted.sourceDraftId,
            sourceRevision: persisted.sourceDraftVersion,
            baseContentHash: persisted.baseContentHash,
            contentHash: persisted.contentHash,
            source: 'ai_generate',
          },
          invalidated: true,
          invalidatedReason: '候选的冻结基线已无法读取。',
          adopted,
        },
        activity,
      };
    }
    const contentHash = persisted.contentHash || await computeContentSha256(persisted.content);
    const validation = await chapterConstraintValidationService.getLatest(persisted.artifactId);
    const diff = await calculateChapterDiff({
      novelId,
      chapterId,
      baseDraftId: persisted.sourceDraftId,
      baseDraftVersion: persisted.sourceDraftVersion,
      baseContentHash: persisted.baseContentHash,
      candidateArtifactId: persisted.artifactId,
      candidateNovelId: novelId,
      candidateChapterId: chapterId,
      candidateSourceDraftId: persisted.sourceDraftId,
      candidateSourceDraftVersion: persisted.sourceDraftVersion,
      candidateBaseContentHash: persisted.baseContentHash,
      baseContent: sourceDraft.content,
      candidateContent: persisted.content,
    });
    let invalidatedReason: string | undefined;
    if (!persisted.proposal && !adopted && validation?.status !== 'blocked') invalidatedReason = '候选缺少采用目标。';
    if (persisted.proposal && !adopted) {
      const proposalValidation = await placementApplyService.validateProposal(persisted.proposal.proposalId);
      if (proposalValidation.stale) invalidatedReason = proposalValidation.reason || '候选采用目标已经过期。';
    }
    return {
      record: {
        candidate: {
          candidateId: persisted.candidateId,
          artifactId: persisted.artifactId,
          taskId: persisted.taskId,
          proposal: persisted.proposal,
          content: persisted.content,
          contentHash,
          wordCount: Array.from(persisted.content).length,
          baseContent: sourceDraft.content,
          createdAt: persisted.createdAt,
          constraintValidation: validation || undefined,
          diff,
        },
        target: {
          resultId: persisted.artifactId,
          artifactId: persisted.artifactId,
          taskId: persisted.taskId,
          novelId,
          chapterId,
          sourceDraftId: persisted.sourceDraftId,
          sourceRevision: persisted.sourceDraftVersion,
          baseContentHash: persisted.baseContentHash,
          contentHash,
          source: 'ai_generate',
        },
        source: 'ai_generated',
        adopted,
        invalidated: !!invalidatedReason,
        invalidatedReason,
      },
      activity,
    };
  },

  async adopt(input: AdoptCandidateInput): Promise<ChapterDraft> {
    const candidateId = input.record.candidate.candidateId || input.record.candidate.artifactId;
    const inFlight = pendingCandidateAdoptions.get(candidateId);
    if (inFlight) return inFlight;

    const run = (async () => {
      await validateAuthoritativeContext(input);
      const proposalId = input.record.candidate.proposal!.proposalId;
      const plan = await placementApplyService.createPlan({
        proposalId,
        source: input.source,
        note: input.note,
      });
      const execution = await placementApplyService.executePlan(plan);
      if (execution.status !== 'completed' || execution.targetLinks.length !== 1) {
        throw new Error('ApplyPlan 未完整提交，正式正文保持不变。');
      }
      const authoritative = await draftVersionService.getAdoptedByChapterId(input.currentChapterId);
      if (!authoritative
        || !authoritative.isAdopted
        || authoritative.novelId !== input.currentNovelId
        || authoritative.chapterId !== input.currentChapterId
        || authoritative.artifactId !== candidateId) {
        throw new Error('采用完成后读取到的权威正文身份不一致。');
      }
      return authoritative;
    })();
    pendingCandidateAdoptions.set(candidateId, run);
    try {
      return await run;
    } finally {
      pendingCandidateAdoptions.delete(candidateId);
    }
  },
};
