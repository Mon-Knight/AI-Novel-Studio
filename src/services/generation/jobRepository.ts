import { dbCall, generateId, lsGet, lsSet, nowISO } from '../database/db';
import type {
  CreateGenerationJobInput,
  GenerationJob,
  GenerationStepName,
  GenerationStepResult,
  GenerationStepStatus,
} from '../../types/generationJob';
import {
  ALLOWED_JOB_TRANSITIONS,
  JOBS_KEY,
  TERMINAL_JOB_STATUSES,
  type UpdateGenerationJobInput,
  stepsKey,
} from './types';
import {
  activeJobControls,
  normalizeJob,
  normalizeJobs,
  normalizeStep,
  normalizeSteps,
  toCreateDbInput,
  toStepDbInput,
} from './jobStateMachine';

export function getLocalJobs(): GenerationJob[] {
  return normalizeJobs(lsGet<unknown>(JOBS_KEY));
}

export function saveLocalJobs(jobs: GenerationJob[]): void {
  lsSet(JOBS_KEY, jobs);
}

export function upsertLocalJob(job: GenerationJob): GenerationJob {
  const jobs = getLocalJobs();
  const idx = jobs.findIndex((item) => item.id === job.id);
  if (idx >= 0) jobs[idx] = job;
  else jobs.unshift(job);
  saveLocalJobs(jobs);
  return job;
}

export function updateLocalJob(
  existing: GenerationJob,
  input: UpdateGenerationJobInput,
): GenerationJob {
  if (TERMINAL_JOB_STATUSES.has(existing.status)) {
    throw new Error(`generation_job_terminal: ${existing.id} is already ${existing.status}`);
  }
  if (input.status && !ALLOWED_JOB_TRANSITIONS[existing.status].has(input.status)) {
    throw new Error(`generation_job_invalid_transition: ${existing.status} -> ${input.status}`);
  }
  if (input.progressPercent !== undefined) {
    if (
      !Number.isInteger(input.progressPercent) ||
      input.progressPercent < 0 ||
      input.progressPercent > 100
    ) {
      throw new Error(
        `generation_job_invalid_progress: ${input.progressPercent} is outside 0..100`,
      );
    }
    if (input.progressPercent < existing.progressPercent) {
      throw new Error(
        `generation_job_progress_regression: ${existing.progressPercent} -> ${input.progressPercent}`,
      );
    }
  }
  return upsertLocalJob({ ...existing, ...input });
}

export function getLocalSteps(jobId: string): GenerationStepResult[] {
  return normalizeSteps(lsGet<unknown>(stepsKey(jobId)));
}

export function saveLocalStep(step: GenerationStepResult): GenerationStepResult {
  const steps = getLocalSteps(step.jobId).filter((item) => item.id !== step.id);
  steps.push(step);
  lsSet(stepsKey(step.jobId), steps);
  return step;
}

export async function createGenerationJob(input: CreateGenerationJobInput): Promise<GenerationJob> {
  const now = nowISO();
  const job: GenerationJob = {
    id: generateId(),
    novelId: input.novelId,
    volumeId: input.volumeId,
    chapterId: input.chapterId,
    jobType: input.jobType,
    status: 'pending',
    progressPercent: 0,
    provider: input.provider,
    modelName: input.modelName,
    retryCount: 0,
    createdAt: now,
  };
  const raw = await dbCall<unknown>('create_generation_job', { input: toCreateDbInput(job) }, () =>
    upsertLocalJob(job),
  );
  const normalized = normalizeJob(raw);
  if (!normalized) throw new Error('生成任务创建返回无效数据');
  return normalized;
}

export async function updateGenerationJob(input: UpdateGenerationJobInput): Promise<GenerationJob> {
  const raw = await dbCall<unknown>('update_generation_job', { input }, () => {
    const existing = getLocalJobs().find((item) => item.id === input.id);
    if (!existing) throw new Error('生成任务不存在');
    return updateLocalJob(existing, input);
  });
  const normalized = normalizeJob(raw);
  if (!normalized) throw new Error('生成任务更新返回无效数据');
  return normalized;
}

export async function getGenerationJobById(id: string): Promise<GenerationJob | null> {
  const raw = await dbCall<unknown | null>(
    'get_generation_job',
    { id },
    () => getLocalJobs().find((item) => item.id === id) ?? null,
  );
  return normalizeJob(raw);
}

export async function getGenerationJobsByChapterId(chapterId: string): Promise<GenerationJob[]> {
  const raw = await dbCall<unknown[]>('get_generation_jobs_by_chapter_id', { chapterId }, () =>
    getLocalJobs().filter((item) => item.chapterId === chapterId),
  );
  return normalizeJobs(raw);
}

export async function cancelGenerationJob(id: string): Promise<GenerationJob | null> {
  const control = activeJobControls.get(id);
  control?.controller.abort();
  await control?.requestSettled;
  const now = nowISO();
  const raw = await dbCall<unknown | null>('cancel_generation_job', { id, finishedAt: now }, () => {
    const existing = getLocalJobs().find((item) => item.id === id);
    if (!existing) return null;
    if (
      existing.status === 'completed' ||
      existing.status === 'failed' ||
      existing.status === 'cancelled'
    ) {
      return existing;
    }
    const cancelled = upsertLocalJob({
      ...existing,
      status: 'cancelled',
      finishedAt: now,
      progressPercent: existing.progressPercent,
    });
    saveLocalStep({
      id: generateId(),
      jobId: existing.id,
      stepName: existing.currentStep ?? 'preflight',
      status: 'cancelled',
      outputText: '任务已取消。',
      createdAt: now,
    });
    return cancelled;
  });
  return normalizeJob(raw);
}

export async function saveGenerationStep(input: {
  jobId: string;
  stepName: GenerationStepName;
  status: GenerationStepStatus;
  inputSnapshot?: unknown;
  outputJson?: unknown;
  outputText?: string;
  errorMessage?: string;
}): Promise<GenerationStepResult> {
  const step: GenerationStepResult = {
    id: generateId(),
    jobId: input.jobId,
    stepName: input.stepName,
    status: input.status,
    inputSnapshot: input.inputSnapshot,
    outputJson: input.outputJson,
    outputText: input.outputText,
    errorMessage: input.errorMessage,
    createdAt: nowISO(),
  };
  const raw = await dbCall<unknown>(
    'save_generation_step_result',
    { input: toStepDbInput(step) },
    () => {
      const parent = getLocalJobs().find((item) => item.id === step.jobId);
      if (!parent) throw new Error(`generation_step_parent_not_found: ${step.jobId}`);
      if (TERMINAL_JOB_STATUSES.has(parent.status)) {
        throw new Error(
          `generation_step_parent_terminal: ${step.jobId} is already ${parent.status}`,
        );
      }
      return saveLocalStep(step);
    },
  );
  const normalized = normalizeStep(raw);
  if (!normalized) throw new Error('生成步骤保存返回无效数据');
  return normalized;
}

export async function getGenerationSteps(jobId: string): Promise<GenerationStepResult[]> {
  const raw = await dbCall<unknown[]>('get_generation_step_results', { jobId }, () =>
    getLocalSteps(jobId),
  );
  return normalizeSteps(raw);
}
