import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { createServer } from 'vite';
import type { AiTask, AiTaskDetail } from '../../types/ai-task';
import type { GenerationJob, GenerationStepResult } from '../../types/generationJob';
import type { ResultArtifactBundle } from '../../types/result-artifact';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
const generationModule = await vite.ssrLoadModule(
  '/src/services/generation/generationJobService.ts',
);
const contextCompilerModule = await vite.ssrLoadModule(
  '/src/services/generation/generationContextCompiler.ts',
);
const generationJobService =
  generationModule.generationJobService as typeof import('./generationJobService').generationJobService;
const generationContextCompiler =
  contextCompilerModule.generationContextCompiler as typeof import('./generationContextCompiler').generationContextCompiler;
const passesChapterQualityGate =
  generationModule.passesChapterQualityGate as typeof import('./generationJobService').passesChapterQualityGate;
const shouldAttemptExternalQualityRepair =
  generationModule.shouldAttemptExternalQualityRepair as typeof import('./generationJobService').shouldAttemptExternalQualityRepair;
const selectResumableBeatPrefix =
  generationModule.selectResumableBeatPrefix as typeof import('./generationJobService').selectResumableBeatPrefix;
const resumableBeatFromRepairArtifact =
  generationModule.resumableBeatFromRepairArtifact as typeof import('./generationJobService').resumableBeatFromRepairArtifact;

after(async () => {
  await vite.close();
});

beforeEach(() => {
  storage.clear();
});

test('production draft job forwards the provisional previous chapter into its frozen context', async () => {
  const provisionalPreviousChapter = {
    chapterId: 'chapter-previous',
    draftId: 'draft-previous-v2',
    contentHash: 'txt_previous',
    content: '前一章尚未采用但已确认用于队列承接的候选正文。',
  };
  const originalCompileAndSave =
    generationContextCompiler.compileAndSave.bind(generationContextCompiler);
  let capturedInput: Parameters<typeof generationContextCompiler.compileAndSave>[0] | undefined;
  generationContextCompiler.compileAndSave = async (input) => {
    capturedInput = input;
    throw new Error('stop_after_context_capture');
  };

  try {
    const result = await generationJobService.runChapterDraftJob({
      novelId: 'novel-1',
      volumeId: 'volume-1',
      chapterId: 'chapter-1',
      provisionalPreviousChapter,
    });

    assert.equal(result.job.status, 'failed');
    assert.match(result.job.errorMessage ?? '', /stop_after_context_capture/);
    assert.deepEqual(capturedInput?.provisionalPreviousChapter, provisionalPreviousChapter);
  } finally {
    generationContextCompiler.compileAndSave = originalCompileAndSave;
  }
});

function createJob(
  id: string,
  status: GenerationJob['status'],
  progressPercent: number,
): GenerationJob {
  return {
    id,
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    jobType: 'chapter_generation',
    status,
    currentStep: 'draft_generation',
    progressPercent,
    retryCount: 0,
    createdAt: `2000-01-01T00:00:0${progressPercent % 10}.000Z`,
  };
}

test('local startup recovery is idempotent and preserves the interrupted checkpoint', async () => {
  const running = createJob('job-running', 'running', 72);
  const pending = { ...createJob('job-pending', 'pending', 0), currentStep: undefined };
  const retrying = {
    ...createJob('job-retrying', 'retrying', 52),
    currentStep: 'scene_plan' as const,
  };
  const completed = createJob('job-completed', 'completed', 100);
  storage.setItem(
    'ai_novel_studio_generation_jobs',
    JSON.stringify([running, pending, retrying, completed]),
  );
  storage.setItem(
    'ai_novel_studio_generation_steps_job-running',
    JSON.stringify([
      {
        id: 'step-preflight',
        jobId: running.id,
        stepName: 'preflight',
        status: 'succeeded',
        createdAt: '2000-01-01T00:00:00.000Z',
      },
    ]),
  );

  const first = await generationJobService.recoverInterruptedAtStartup();
  assert.equal(first.recoveredJobs, 3);

  const recovered = await generationJobService.getById(running.id);
  assert.equal(recovered?.status, 'failed');
  assert.equal(recovered?.errorCode, 'APP_RESTART_INTERRUPTED');
  assert.equal(recovered?.currentStep, 'draft_generation');
  assert.equal(recovered?.progressPercent, 72);

  const steps = await generationJobService.getSteps(running.id);
  assert.equal(steps.length, 2);
  const recoveryStep = steps.find((step) => step.status === 'failed');
  assert.equal(recoveryStep?.stepName, 'draft_generation');
  assert.deepEqual(recoveryStep?.outputJson, {
    recoveryReason: 'APP_RESTART_INTERRUPTED',
    previousStatus: 'running',
    preservedProgressPercent: 72,
  });
  assert.equal((await generationJobService.getById(pending.id))?.status, 'failed');
  assert.equal((await generationJobService.getSteps(pending.id))[0]?.stepName, 'preflight');
  assert.equal((await generationJobService.getById(retrying.id))?.status, 'failed');
  assert.equal((await generationJobService.getSteps(retrying.id))[0]?.stepName, 'scene_plan');

  const second = await generationJobService.recoverInterruptedAtStartup();
  assert.equal(second.recoveredJobs, 0);
  assert.equal((await generationJobService.getSteps(running.id)).length, 2);
  assert.equal((await generationJobService.getSteps(pending.id)).length, 1);
  assert.equal((await generationJobService.getSteps(retrying.id)).length, 1);
  assert.equal((await generationJobService.getById(completed.id))?.status, 'completed');
});

test('local generation jobs reject progress regression and terminal revival', async () => {
  const running = createJob('job-state-machine', 'running', 72);
  storage.setItem('ai_novel_studio_generation_jobs', JSON.stringify([running]));

  await assert.rejects(
    generationJobService.update({ id: running.id, progressPercent: 50 }),
    /generation_job_progress_regression/,
  );

  const cancelled = await generationJobService.cancel(running.id);
  assert.equal(cancelled?.status, 'cancelled');
  const cancellationSteps = await generationJobService.getSteps(running.id);
  assert.equal(cancellationSteps.length, 1);
  assert.equal(cancellationSteps[0]?.status, 'cancelled');
  assert.equal(cancellationSteps[0]?.stepName, 'draft_generation');
  await generationJobService.cancel(running.id);
  assert.equal((await generationJobService.getSteps(running.id)).length, 1);
  await assert.rejects(
    generationJobService.update({ id: running.id, status: 'completed', progressPercent: 100 }),
    /generation_job_terminal/,
  );
  await assert.rejects(
    generationJobService.saveStep({
      jobId: running.id,
      stepName: 'draft_generation',
      status: 'succeeded',
      outputJson: { late: true },
    }),
    /generation_step_parent_terminal/,
  );
  assert.equal((await generationJobService.getById(running.id))?.status, 'cancelled');
  assert.equal((await generationJobService.getSteps(running.id)).length, 1);
});

test('step normalization parses Tauri camelCase JSON fields', async () => {
  const running = createJob('job-camel-step', 'running', 72);
  storage.setItem('ai_novel_studio_generation_jobs', JSON.stringify([running]));
  storage.setItem(
    'ai_novel_studio_generation_steps_job-camel-step',
    JSON.stringify([
      {
        id: 'step-camel',
        jobId: running.id,
        stepName: 'patch_apply',
        status: 'succeeded',
        inputSnapshotJson: JSON.stringify({ baseRevision: 3 }),
        outputJson: JSON.stringify({ appliedCount: 2, skippedCount: 1 }),
        outputText: 'patched',
        createdAt: '2000-01-01T00:00:09.000Z',
      },
    ]),
  );

  const steps = await generationJobService.getSteps(running.id);
  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0]?.inputSnapshot, { baseRevision: 3 });
  assert.deepEqual(steps[0]?.outputJson, { appliedCount: 2, skippedCount: 1 });
});

test('manual rerun reuses only the longest contiguous Beat prefix from the same frozen route', () => {
  const candidateJob = (
    id: string,
    createdAt: string,
    modelName = 'qwen35-9b-novel-v3',
  ): GenerationJob => ({
    ...createJob(id, 'failed', 72),
    provider: 'local_llama_cpp',
    modelName,
    createdAt,
  });
  const candidateSteps = (
    jobId: string,
    contextHash: string,
    units: number[],
  ): GenerationStepResult[] => [
    {
      id: `${jobId}-context`,
      jobId,
      stepName: 'compile_context',
      status: 'succeeded',
      outputJson: { contextHash },
      createdAt: '2000-01-01T00:00:00.000Z',
    },
    ...units.map((unitNo) => ({
      id: `${jobId}-beat-${unitNo}`,
      jobId,
      stepName: 'draft_generation' as const,
      status: 'succeeded' as const,
      inputSnapshot: {
        sceneNo: unitNo <= 2 ? 1 : 2,
        beatOrder: unitNo <= 2 ? unitNo : unitNo - 2,
        generationUnitNo: unitNo,
        generationUnitCount: 4,
        taskId: `${jobId}-task-${unitNo}`,
      },
      outputJson: {
        provider: unitNo === 2 ? 'openai_compatible' : 'local_llama_cpp',
        modelName: unitNo === 2 ? 'deepseek-v4-flash' : 'qwen35-9b-novel-v3',
        finishReason: 'stop',
      },
      outputText: `第 ${unitNo} 个已通过的 Beat 正文。`,
      createdAt: `2000-01-01T00:00:0${unitNo}.000Z`,
    })),
  ];
  const longest = candidateJob('job-longest', '2000-01-01T00:00:01.000Z');
  const newerButShorter = candidateJob('job-newer', '2000-01-01T00:00:02.000Z');
  const wrongContext = candidateJob('job-wrong-context', '2000-01-01T00:00:03.000Z');
  const wrongModel = candidateJob('job-wrong-model', '2000-01-01T00:00:04.000Z', 'another-model');

  const selected = selectResumableBeatPrefix({
    candidates: [
      { job: longest, steps: candidateSteps(longest.id, 'context-a', [1, 2, 4]) },
      { job: newerButShorter, steps: candidateSteps(newerButShorter.id, 'context-a', [1]) },
      { job: wrongContext, steps: candidateSteps(wrongContext.id, 'context-b', [1, 2, 3]) },
      { job: wrongModel, steps: candidateSteps(wrongModel.id, 'context-a', [1, 2, 3]) },
    ],
    contextHash: 'context-a',
    provider: 'local_llama_cpp',
    modelName: 'qwen35-9b-novel-v3',
  });

  assert.deepEqual(
    selected.map((beat) => [beat.generationUnitNo, beat.sourceJobId]),
    [
      [1, longest.id],
      [2, longest.id],
    ],
  );
  assert.equal(selected[1]?.providerId, 'openai_compatible');
  assert.equal(selected[1]?.modelId, 'deepseek-v4-flash');
});

test('manual rerun extends a successful prefix with a revalidated repair artifact', () => {
  const job: GenerationJob = {
    ...createJob('job-with-repair', 'failed', 72),
    provider: 'local_llama_cpp',
    modelName: 'qwen35-9b-novel-v3',
  };
  const steps: GenerationStepResult[] = [
    {
      id: 'context',
      jobId: job.id,
      stepName: 'compile_context',
      status: 'succeeded',
      outputJson: { contextHash: 'context-a' },
      createdAt: '2000-01-01T00:00:00.000Z',
    },
    ...[1, 2].map((unitNo) => ({
      id: `beat-${unitNo}`,
      jobId: job.id,
      stepName: 'draft_generation' as const,
      status: 'succeeded' as const,
      inputSnapshot: {
        sceneNo: 1,
        beatOrder: unitNo,
        generationUnitNo: unitNo,
        generationUnitCount: 4,
      },
      outputJson: {
        provider: 'local_llama_cpp',
        modelName: 'qwen35-9b-novel-v3',
        finishReason: 'stop',
      },
      outputText: `第 ${unitNo} 个已通过的 Beat 正文。`,
      createdAt: `2000-01-01T00:00:0${unitNo}.000Z`,
    })),
  ];
  const selected = selectResumableBeatPrefix({
    candidates: [{ job, steps }],
    contextHash: 'context-a',
    provider: 'local_llama_cpp',
    modelName: 'qwen35-9b-novel-v3',
    repairBeats: [
      {
        sceneNo: 2,
        beatOrder: 1,
        generationUnitNo: 3,
        generationUnitCount: 4,
        text: '重新校验后通过的外部修稿。',
        sourceJobId: job.id,
        taskId: 'repair-task',
        attemptId: 'repair-attempt',
        providerId: 'openai_compatible',
        modelId: 'deepseek-v4-flash',
        finishReason: 'stop',
      },
    ],
  });

  assert.deepEqual(
    selected.map((beat) => beat.generationUnitNo),
    [1, 2, 3],
  );
  assert.equal(selected[2]?.taskId, 'repair-task');
});

test('completed external repair artifact is rebuilt only for the same job and context', () => {
  const job: GenerationJob = {
    ...createJob('job-repair-runtime', 'failed', 72),
    provider: 'local_llama_cpp',
    modelName: 'qwen35-9b-novel-v3',
  };
  const task = {
    taskId: 'repair-task',
    taskType: 'chapter_beat_repair',
    status: 'completed',
    resultArtifactId: 'artifact-1',
  } as unknown as AiTask;
  const rawContent = [
    '林舟打开门离开。',
    ...Array.from({ length: 8 }, (_, i) => `${i}段${'甲'.repeat(36)}。`),
  ].join('\n\n');
  const detail = {
    task,
    attempts: [
      {
        attemptId: 'attempt-1',
        attemptNumber: 1,
        status: 'succeeded',
        providerId: 'openai_compatible',
        modelId: 'deepseek-v4-flash',
        responseMetadataJson: { finishReason: 'stop' },
      },
    ],
    inputSnapshot: {
      payloadJson: {
        taskInput: {
          generationJobId: job.id,
          contextHash: 'context-a',
          sceneNo: 2,
          beatOrder: 1,
          minimumCharacterCount: 100,
          maximumCharacterCount: 200,
          requiredBeatText: '林舟打开门离开。',
          scenePlan: [
            { sceneNo: 1, beats: [{ order: 1 }, { order: 2 }] },
            { sceneNo: 2, beats: [{ order: 1 }, { order: 2 }] },
          ],
        },
      },
    },
  } as unknown as AiTaskDetail;
  const artifact = {
    artifact: {
      artifactId: 'artifact-1',
      taskId: task.taskId,
      processingStatus: 'valid',
    },
    rawContent,
  } as unknown as ResultArtifactBundle;

  const rebuilt = resumableBeatFromRepairArtifact({
    job,
    task,
    detail,
    artifact,
    contextHash: 'context-a',
  });
  assert.equal(rebuilt?.generationUnitNo, 3);
  assert.equal(rebuilt?.generationUnitCount, 4);
  assert.equal(rebuilt?.providerId, 'openai_compatible');
  assert.ok((rebuilt?.text.length ?? 0) < rawContent.length);
  assert.equal(
    resumableBeatFromRepairArtifact({
      job,
      task,
      detail,
      artifact,
      contextHash: 'different-context',
    }),
    undefined,
  );
});

test('quality gate requires score 80 and no pending critical/high issue', () => {
  const issue = (severity: 'critical' | 'high' | 'medium', status: 'pending' | 'ignored') =>
    ({ severity, status }) as never;
  assert.equal(passesChapterQualityGate(80, []), true);
  assert.equal(passesChapterQualityGate(79, []), false);
  assert.equal(passesChapterQualityGate(95, [issue('critical', 'pending')]), false);
  assert.equal(passesChapterQualityGate(95, [issue('high', 'pending')]), false);
  assert.equal(passesChapterQualityGate(95, [issue('high', 'ignored')]), true);
  assert.equal(passesChapterQualityGate(95, [issue('medium', 'pending')]), true);
});

test('saved draft quality repair remains eligible after Beat-level external rescue', () => {
  const pendingIssue = { status: 'pending', severity: 'critical' } as never;
  assert.equal(
    shouldAttemptExternalQualityRepair({
      localChapterModelEnabled: true,
      runtimeMode: 'api',
      manualReviewRequired: true,
      qualityItems: [pendingIssue],
      externalBeatRepairUsed: true,
    }),
    true,
  );
  assert.equal(
    shouldAttemptExternalQualityRepair({
      localChapterModelEnabled: true,
      runtimeMode: 'api',
      manualReviewRequired: false,
      qualityItems: [pendingIssue],
      externalBeatRepairUsed: true,
    }),
    false,
  );
});
