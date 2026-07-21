import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { createServer } from 'vite';
import type { GenerationJob } from '../../types/generationJob';

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
const generationModule = await vite.ssrLoadModule('/src/services/generation/generationJobService.ts');
const generationJobService = generationModule.generationJobService as typeof import('./generationJobService').generationJobService;

after(async () => {
  await vite.close();
});

beforeEach(() => {
  storage.clear();
});

function createJob(id: string, status: GenerationJob['status'], progressPercent: number): GenerationJob {
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
  const retrying = { ...createJob('job-retrying', 'retrying', 52), currentStep: 'scene_plan' as const };
  const completed = createJob('job-completed', 'completed', 100);
  storage.setItem('ai_novel_studio_generation_jobs', JSON.stringify([running, pending, retrying, completed]));
  storage.setItem('ai_novel_studio_generation_steps_job-running', JSON.stringify([{
    id: 'step-preflight',
    jobId: running.id,
    stepName: 'preflight',
    status: 'succeeded',
    createdAt: '2000-01-01T00:00:00.000Z',
  }]));

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
  storage.setItem('ai_novel_studio_generation_steps_job-camel-step', JSON.stringify([{
    id: 'step-camel',
    jobId: running.id,
    stepName: 'patch_apply',
    status: 'succeeded',
    inputSnapshotJson: JSON.stringify({ baseRevision: 3 }),
    outputJson: JSON.stringify({ appliedCount: 2, skippedCount: 1 }),
    outputText: 'patched',
    createdAt: '2000-01-01T00:00:09.000Z',
  }]));

  const steps = await generationJobService.getSteps(running.id);
  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0]?.inputSnapshot, { baseRevision: 3 });
  assert.deepEqual(steps[0]?.outputJson, { appliedCount: 2, skippedCount: 1 });
});
