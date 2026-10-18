import type { TaskRun } from '../../types/conversation';
import { isDraftContentReady } from '../../types/draftContentState';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { verifyArtifactRevisionSource } from '../conversation/artifactRevisionSourceService';
import { getChapterWordRangePercents } from '../conversation/chapterWordRangePolicy';
import { captureTaskModelSnapshot } from '../conversation/taskModelSnapshot';
import { selectCandidateTool } from '../conversation/taskGoalRouting';
import type { TaskRuntimeEvent, TaskRuntimeInput } from '../conversation/taskRuntimeAdapter';
import { prepareTaskWritingPreferences } from '../conversation/taskWritingPreferences';
import { observeTurnRunProjection } from '../conversation/turnRunProjection';
import { findPreviousChapterForContinuity } from '../conversation/workbenchChapterWriter';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { volumeRepository } from '../database/volumeRepository';
import { dshTaskRuntimeService, type DshTaskRuntimeInput } from '../dsh/taskRuntimeService';
import { inspectChapterCandidateIntegrity } from '../generation/chapterCandidateIntegrity';
import { planWritingSubAgentTurn, toDshTaskStartContract } from './writingSubAgentContract';

const HOST_CANDIDATE_CALLS = 3;

function hostError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

/** Same order as the deterministic writer. Native code re-reads; this only fails closed early. */
export async function resolveWritingSubAgentContinuity(
  novelId: string,
  chapterId: string,
): Promise<{ chapterId: string; sourceHash: string } | undefined> {
  const [chapters, volumes] = await Promise.all([
    chapterRepository.getByNovelId(novelId),
    volumeRepository.getByNovelId(novelId),
  ]);
  const scopedChapters = chapters.filter((chapter) => chapter.novelId === novelId);
  const current = scopedChapters.find((chapter) => chapter.id === chapterId);
  if (!current)
    throw hostError('DSH_PREVIOUS_CHAPTER_SCOPE_MISMATCH', '目标章节不存在或不属于当前作品。');
  const previous = findPreviousChapterForContinuity(
    scopedChapters,
    volumes.filter((volume) => volume.novelId === novelId),
    chapterId,
  );
  if (!previous || previous.novelId !== novelId) return undefined;
  const draft = await draftVersionService.getAdoptedByChapterId(previous.id);
  if (!draft?.isAdopted || draft.chapterId !== previous.id || draft.novelId !== novelId) {
    throw hostError(
      'WORKBENCH_PREVIOUS_CHAPTER_NOT_ADOPTED',
      '上一章尚未采用为正式正文，不能生成下一章。',
    );
  }
  if (draft.contentState && !isDraftContentReady(draft.contentState)) {
    throw hostError(
      'WORKBENCH_PREVIOUS_CHAPTER_CONTENT_UNAVAILABLE',
      '上一章采用稿不可读，不能生成下一章。',
    );
  }
  const content = draft.contentState?.content ?? draft.content;
  if (!content.trim()) {
    throw hostError(
      'WORKBENCH_PREVIOUS_CHAPTER_CONTENT_UNAVAILABLE',
      '上一章采用稿不可读，不能生成下一章。',
    );
  }
  const computed = (await computeContentSha256(content)).toLowerCase();
  const stored = draft.contentState?.contentHash?.toLowerCase();
  if (stored && stored !== computed) {
    throw hostError(
      'WORKBENCH_PREVIOUS_CHAPTER_CONTENT_UNAVAILABLE',
      '上一章采用稿不可读，不能生成下一章。',
    );
  }
  return { chapterId: previous.id, sourceHash: stored && stored.length === 64 ? stored : computed };
}

export async function runHostGatedChapterTurn(
  input: TaskRuntimeInput,
  onEvent: ((event: TaskRuntimeEvent) => void) | undefined,
  review: (
    input: TaskRuntimeInput,
    chapterId: string,
    artifactId: string | undefined,
  ) => Promise<void>,
): Promise<TaskRun> {
  input.cancellationSignal?.throwIfAborted();
  const chapterId = input.chapterId;
  if (!chapterId) throw hostError('DSH_CHAPTER_TARGET_REQUIRED', '章节写作必须绑定目标章节。');
  const chapter = await chapterRepository.getById(chapterId);
  if (!chapter || chapter.novelId !== input.novelId) {
    throw new Error('目标章节不存在或不属于当前作品。');
  }
  const continuity = await resolveWritingSubAgentContinuity(input.novelId, chapterId);
  const preferences = await prepareTaskWritingPreferences(input);
  const revision = await verifyArtifactRevisionSource(input);
  const contract = planWritingSubAgentTurn({
    novelId: input.novelId,
    chapterId,
    goal: input.goal,
    mode: input.workflowAction
      ? input.workflowAction === 'polish_chapter'
        ? 'polish'
        : 'generate'
      : selectCandidateTool(input.goal, chapterId)?.name === 'polish_chapter'
        ? 'polish'
        : 'generate',
    modelSnapshot: input.modelSnapshot ?? captureTaskModelSnapshot(),
    targetWordCount: preferences.targetWordCount ?? (chapter.targetWordCount || undefined),
    wordRangePercents: getChapterWordRangePercents(),
    ...(continuity ? { previousChapter: continuity } : {}),
    ...(revision?.source ? { revisionSource: revision.source } : {}),
  });
  const projected = toDshTaskStartContract(contract);
  const base: DshTaskRuntimeInput = {
    ...input,
    ...projected,
    ...(input.retryExecution ?? {}),
    revisionSource: revision?.source,
    modelSnapshot: contract.modelSnapshot,
  };
  const seenRuns = new Set<string>();
  let repairCodes: string[] = [];
  let explicitRetry = input.explicitChapterRetry === true;
  let continuesRunId: string | undefined;
  for (;;) {
    input.cancellationSignal?.throwIfAborted();
    const drafted = await dshTaskRuntimeService.start(
      {
        ...base,
        retrySourceRunId: explicitRetry ? input.retrySourceRunId : undefined,
        chapterHostGate: {
          phase: 'draft',
          ...(continuesRunId ? { continuesRunId } : {}),
          ...(explicitRetry ? { explicitRetry: true } : {}),
          issueCodes: repairCodes,
          issueSeverities: repairCodes.map(() => 'error' as const),
          maxIntegrityRepairs: contract.budget.maxIntegrityRepairs,
        },
      },
      (notice) =>
        observeTurnRunProjection(input.conversationId, input.turnId, notice.runId, onEvent),
    );
    const pending = drafted.pendingChapterCandidate;
    if (!pending?.runId || !pending.contentHash || !pending.text.trim()) {
      throw new Error(drafted.run.error || 'DSH 未保留可复核的章节候选');
    }
    if (drafted.run.status === 'completed' || drafted.artifactId) {
      throw hostError('DSH_CHAPTER_CANDIDATE_WITHHELD', '未准入的章节草稿不能被报告为成功候选。');
    }
    if (seenRuns.has(pending.runId) || seenRuns.size >= HOST_CANDIDATE_CALLS) {
      throw new Error('DSH_CHAPTER_CANDIDATE_ATTEMPTS_EXHAUSTED: 宿主停止草稿且未准入');
    }
    seenRuns.add(pending.runId);
    explicitRetry = false;
    continuesRunId = pending.runId;
    const issues = inspectChapterCandidateIntegrity({
      candidateText: pending.text,
      previousChapterText: pending.previousChapterText,
    });
    const errors = issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) {
      repairCodes = [...new Set(errors.map((issue) => issue.code))].sort();
      continue;
    }
    input.cancellationSignal?.throwIfAborted();
    const admitted = await dshTaskRuntimeService.start(
      {
        ...base,
        retrySourceRunId: undefined,
        chapterHostGate: {
          phase: 'admit',
          sourceRunId: pending.runId,
          contentHash: pending.contentHash,
          issueCodes: issues.map((issue) => issue.code),
          issueSeverities: issues.map((issue) => issue.severity),
          maxIntegrityRepairs: contract.budget.maxIntegrityRepairs,
        },
      },
      (notice) =>
        observeTurnRunProjection(input.conversationId, input.turnId, notice.runId, onEvent),
    );
    if (!admitted.artifactId || admitted.pendingChapterCandidate) {
      throw new Error(admitted.run.error || 'DSH 未准入章节候选');
    }
    onEvent?.({ run: admitted.run });
    await review(input, chapterId, admitted.artifactId);
    return admitted.run;
  }
}
