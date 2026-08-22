import { appLogger } from '../observability/appLogger';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import { trimExternalBeatRepairAtNaturalBoundary } from '../ai/chapterProseOrchestrator';
import type { ChapterProseResumeBeat } from '../ai/chapterGenerationExecutionService';
import type { AiTask, AiTaskDetail } from '../../types/ai-task';
import type { GenerationJob, GenerationStepResult } from '../../types/generationJob';
import type { ResultArtifactBundle } from '../../types/result-artifact';
import { toSafeString } from '../../utils/dataGuard';
import { objectValue, positiveInteger } from './types';

export function resumableBeatFromStep(
  job: GenerationJob,
  step: GenerationStepResult,
): ChapterProseResumeBeat | undefined {
  if (step.stepName !== 'draft_generation' || step.status !== 'succeeded' || !step.outputText) {
    return undefined;
  }
  const input = objectValue(step.inputSnapshot);
  const output = objectValue(step.outputJson);
  const sceneNo = positiveInteger(input?.sceneNo ?? output?.sceneNo);
  const beatOrder = positiveInteger(input?.beatOrder ?? output?.beatOrder);
  const generationUnitNo = positiveInteger(input?.generationUnitNo ?? output?.generationUnitNo);
  const generationUnitCount = positiveInteger(
    input?.generationUnitCount ?? output?.generationUnitCount,
  );
  const providerId = toSafeString(output?.provider, job.provider).trim();
  const modelId = toSafeString(output?.modelName, job.modelName).trim();
  if (
    !sceneNo ||
    !beatOrder ||
    !generationUnitNo ||
    !generationUnitCount ||
    !providerId ||
    !modelId
  ) {
    return undefined;
  }
  return {
    sceneNo,
    beatOrder,
    generationUnitNo,
    generationUnitCount,
    text: step.outputText,
    sourceJobId: job.id,
    taskId: toSafeString(output?.taskId ?? input?.taskId).trim() || undefined,
    attemptId: toSafeString(output?.attemptId ?? input?.attemptId).trim() || undefined,
    providerId,
    modelId,
    finishReason: toSafeString(output?.finishReason).trim() || undefined,
  };
}

export function generationUnitIdentity(taskInput: Record<string, unknown>): {
  generationUnitNo?: number;
  generationUnitCount?: number;
} {
  const explicitUnitNo = positiveInteger(taskInput.generationUnitNo);
  const explicitUnitCount = positiveInteger(taskInput.generationUnitCount);
  if (explicitUnitNo && explicitUnitCount) {
    return { generationUnitNo: explicitUnitNo, generationUnitCount: explicitUnitCount };
  }

  const targetSceneNo = positiveInteger(taskInput.sceneNo);
  const targetBeatOrder = positiveInteger(taskInput.beatOrder);
  const scenePlan = Array.isArray(taskInput.scenePlan) ? taskInput.scenePlan : [];
  const units: Array<{ sceneNo: number; beatOrder: number }> = [];
  for (const rawScene of scenePlan) {
    const scene = objectValue(rawScene);
    const sceneNo = positiveInteger(scene?.sceneNo);
    const beats = Array.isArray(scene?.beats) ? scene.beats : [];
    if (!sceneNo) continue;
    for (const rawBeat of beats) {
      const beatOrder = positiveInteger(objectValue(rawBeat)?.order);
      if (beatOrder) units.push({ sceneNo, beatOrder });
    }
  }
  const index = units.findIndex(
    (unit) => unit.sceneNo === targetSceneNo && unit.beatOrder === targetBeatOrder,
  );
  return {
    generationUnitNo: index >= 0 ? index + 1 : undefined,
    generationUnitCount: units.length || undefined,
  };
}

/**
 * A repair task can complete successfully while the then-current semantic
 * validator rejects its text. Rebuild a checkpoint candidate from the
 * immutable runtime artifact so a later rerun can validate it with the
 * current rules before spending another local-model attempt.
 */
export function resumableBeatFromRepairArtifact(input: {
  job: GenerationJob;
  task: AiTask;
  detail: AiTaskDetail;
  artifact: ResultArtifactBundle;
  contextHash: string;
}): ChapterProseResumeBeat | undefined {
  const { job, task, detail, artifact } = input;
  if (
    task.taskType !== 'chapter_beat_repair' ||
    task.status !== 'completed' ||
    !task.resultArtifactId ||
    detail.task.taskId !== task.taskId ||
    artifact.artifact.artifactId !== task.resultArtifactId ||
    artifact.artifact.taskId !== task.taskId ||
    (artifact.artifact.processingStatus !== 'valid' &&
      artifact.artifact.processingStatus !== 'valid_with_warnings')
  ) {
    return undefined;
  }
  const payload = objectValue(detail.inputSnapshot.payloadJson);
  const taskInput = objectValue(payload?.taskInput);
  if (
    !taskInput ||
    toSafeString(taskInput.generationJobId) !== job.id ||
    toSafeString(taskInput.contextHash) !== input.contextHash
  ) {
    return undefined;
  }
  const sceneNo = positiveInteger(taskInput.sceneNo);
  const beatOrder = positiveInteger(taskInput.beatOrder);
  const { generationUnitNo, generationUnitCount } = generationUnitIdentity(taskInput);
  const minimumCharacters = positiveInteger(taskInput.minimumCharacterCount);
  const maximumCharacters = positiveInteger(taskInput.maximumCharacterCount);
  const requiredBeatText = toSafeString(taskInput.requiredBeatText).trim();
  const attempt = [...detail.attempts]
    .filter((candidate) => candidate.status === 'succeeded')
    .sort((left, right) => right.attemptNumber - left.attemptNumber)[0];
  const responseMetadata = objectValue(attempt?.responseMetadataJson);
  const finishReason = toSafeString(
    responseMetadata?.finishReason ?? responseMetadata?.finish_reason,
  ).trim();
  if (
    !sceneNo ||
    !beatOrder ||
    !generationUnitNo ||
    !generationUnitCount ||
    !minimumCharacters ||
    !maximumCharacters ||
    !requiredBeatText ||
    !attempt?.providerId ||
    !attempt.modelId ||
    finishReason !== 'stop' ||
    !artifact.rawContent.trim()
  ) {
    return undefined;
  }
  let text: string;
  try {
    text = trimExternalBeatRepairAtNaturalBoundary(
      artifact.rawContent,
      finishReason,
      minimumCharacters,
      maximumCharacters,
      requiredBeatText,
    );
  } catch {
    return undefined;
  }
  return {
    sceneNo,
    beatOrder,
    generationUnitNo,
    generationUnitCount,
    text,
    sourceJobId: job.id,
    taskId: task.taskId,
    attemptId: attempt.attemptId,
    providerId: attempt.providerId,
    modelId: attempt.modelId,
    finishReason,
  };
}

export async function collectRepairArtifactResumeBeats(input: {
  novelId: string;
  chapterId: string;
  candidates: Array<{ job: GenerationJob; steps: GenerationStepResult[] }>;
  contextHash: string;
}): Promise<ChapterProseResumeBeat[]> {
  if (input.candidates.length === 0) return [];
  try {
    const jobs = new Map(input.candidates.map((candidate) => [candidate.job.id, candidate.job]));
    const runtimeTasks = (await aiTaskRuntimeService.list(input.novelId, 100))
      .filter(
        (task) =>
          task.chapterId === input.chapterId &&
          task.taskType === 'chapter_beat_repair' &&
          task.status === 'completed' &&
          Boolean(task.resultArtifactId),
      )
      .filter((task) =>
        [...jobs.keys()].some(
          (jobId) =>
            task.operationId.startsWith(`${jobId}:`) || task.traceId.startsWith(`${jobId}:`),
        ),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 40);
    const loaded = await Promise.allSettled(
      runtimeTasks.map(async (task) => {
        const sourceJobId = [...jobs.keys()].find(
          (jobId) =>
            task.operationId.startsWith(`${jobId}:`) || task.traceId.startsWith(`${jobId}:`),
        );
        if (!sourceJobId || !task.resultArtifactId) return undefined;
        const [detail, artifact] = await Promise.all([
          aiTaskRuntimeService.get(task.taskId, task.traceId),
          aiTaskRuntimeService.getArtifact(task.resultArtifactId),
        ]);
        return resumableBeatFromRepairArtifact({
          job: jobs.get(sourceJobId)!,
          task,
          detail,
          artifact,
          contextHash: input.contextHash,
        });
      }),
    );
    return loaded.flatMap((result) =>
      result.status === 'fulfilled' && result.value ? [result.value] : [],
    );
  } catch (error) {
    appLogger.warn('[GENERATION_JOB] Repair artifact checkpoint discovery skipped', {
      chapterId: input.chapterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export function selectResumableBeatPrefix(input: {
  candidates: Array<{ job: GenerationJob; steps: GenerationStepResult[] }>;
  contextHash: string;
  provider: string;
  modelName: string;
  repairBeats?: ChapterProseResumeBeat[];
}): ChapterProseResumeBeat[] {
  return (
    input.candidates
      .filter(
        ({ job }) =>
          job.status === 'failed' &&
          job.jobType === 'chapter_generation' &&
          job.provider === input.provider &&
          job.modelName === input.modelName,
      )
      .map(({ job, steps }) => {
        const contextStep = steps.find(
          (step) =>
            step.stepName === 'compile_context' &&
            step.status === 'succeeded' &&
            toSafeString(objectValue(step.outputJson)?.contextHash) === input.contextHash,
        );
        if (!contextStep)
          return { createdAt: job.createdAt, beats: [] as ChapterProseResumeBeat[] };

        const byUnit = new Map<number, ChapterProseResumeBeat>();
        for (const step of steps) {
          const beat = resumableBeatFromStep(job, step);
          if (beat) byUnit.set(beat.generationUnitNo, beat);
        }
        for (const beat of input.repairBeats ?? []) {
          if (beat.sourceJobId === job.id && !byUnit.has(beat.generationUnitNo)) {
            byUnit.set(beat.generationUnitNo, beat);
          }
        }
        const beats: ChapterProseResumeBeat[] = [];
        const expectedCount = byUnit.get(1)?.generationUnitCount;
        if (expectedCount) {
          for (let unitNo = 1; unitNo <= expectedCount; unitNo += 1) {
            const beat = byUnit.get(unitNo);
            if (!beat || beat.generationUnitCount !== expectedCount) break;
            beats.push(beat);
          }
        }
        return { createdAt: job.createdAt, beats };
      })
      .filter((candidate) => candidate.beats.length > 0)
      .sort(
        (left, right) =>
          right.beats.length - left.beats.length || right.createdAt.localeCompare(left.createdAt),
      )[0]?.beats ?? []
  );
}
