import { nowISO } from '../database/db';
import { toSafeNumber, toSafeString } from '../../utils/dataGuard';
import type { GenerationJob, GenerationStepResult } from '../../types/generationJob';
import {
  type ActiveJobControl,
  type RawGenerationJob,
  type RawGenerationStepResult,
  normalizeJobStatus,
  normalizeJsonField,
  normalizeStepName,
  normalizeStepStatus,
  optionalNumber,
} from './types';

export const activeJobControls = new Map<string, ActiveJobControl>();

export async function trackActiveAiRequest<T>(
  control: ActiveJobControl,
  request: Promise<T>,
): Promise<T> {
  const settled = request.then(
    () => undefined,
    () => undefined,
  );
  control.requestSettled = settled;
  try {
    return await request;
  } finally {
    if (control.requestSettled === settled) {
      control.requestSettled = undefined;
    }
  }
}

export function normalizeJob(raw: unknown): GenerationJob | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as RawGenerationJob;
  const id = toSafeString(item.id).trim();
  const novelId = toSafeString(item.novelId ?? item.novel_id).trim();
  const chapterId = toSafeString(item.chapterId ?? item.chapter_id).trim();
  const jobType = toSafeString(item.jobType ?? item.job_type, 'chapter_generation_mock');
  if (!id || !novelId || !chapterId) return null;
  return {
    id,
    worldId: toSafeString(item.worldId ?? item.world_id).trim() || undefined,
    novelId,
    volumeId: toSafeString(item.volumeId ?? item.volume_id).trim() || undefined,
    chapterId,
    jobType: jobType === 'chapter_generation' ? 'chapter_generation' : 'chapter_generation_mock',
    status: normalizeJobStatus(item.status),
    currentStep: normalizeStepName(item.currentStep ?? item.current_step),
    progressPercent: toSafeNumber(item.progressPercent ?? item.progress_percent, 0),
    provider: toSafeString(item.provider).trim() || undefined,
    modelName: toSafeString(item.modelName ?? item.model_name).trim() || undefined,
    inputTokenEstimate: optionalNumber(item.inputTokenEstimate ?? item.input_token_estimate),
    outputTokenEstimate: optionalNumber(item.outputTokenEstimate ?? item.output_token_estimate),
    actualInputTokens: optionalNumber(item.actualInputTokens ?? item.actual_input_tokens),
    actualOutputTokens: optionalNumber(item.actualOutputTokens ?? item.actual_output_tokens),
    costEstimate: optionalNumber(item.costEstimate ?? item.cost_estimate),
    errorCode: toSafeString(item.errorCode ?? item.error_code).trim() || undefined,
    errorMessage: toSafeString(item.errorMessage ?? item.error_message).trim() || undefined,
    retryCount: toSafeNumber(item.retryCount ?? item.retry_count, 0),
    createdAt: toSafeString(item.createdAt ?? item.created_at, nowISO()),
    startedAt: toSafeString(item.startedAt ?? item.started_at).trim() || undefined,
    finishedAt: toSafeString(item.finishedAt ?? item.finished_at).trim() || undefined,
  };
}

export function normalizeJobs(raw: unknown): GenerationJob[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeJob)
    .filter((item): item is GenerationJob => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function normalizeStep(raw: unknown): GenerationStepResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as RawGenerationStepResult;
  const id = toSafeString(item.id).trim();
  const jobId = toSafeString(item.jobId ?? item.job_id).trim();
  const stepName = normalizeStepName(item.stepName ?? item.step_name);
  if (!id || !jobId || !stepName) return null;
  return {
    id,
    jobId,
    stepName,
    status: normalizeStepStatus(item.status),
    inputSnapshot:
      item.inputSnapshot ?? normalizeJsonField(item.inputSnapshotJson, item.input_snapshot_json),
    outputJson: normalizeJsonField(item.outputJson, item.output_json),
    outputText: toSafeString(item.outputText ?? item.output_text).trim() || undefined,
    errorMessage: toSafeString(item.errorMessage ?? item.error_message).trim() || undefined,
    createdAt: toSafeString(item.createdAt ?? item.created_at, nowISO()),
  };
}

export function normalizeSteps(raw: unknown): GenerationStepResult[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeStep)
    .filter((item): item is GenerationStepResult => item !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function toCreateDbInput(job: GenerationJob) {
  return {
    id: job.id,
    worldId: job.worldId,
    novelId: job.novelId,
    volumeId: job.volumeId,
    chapterId: job.chapterId,
    jobType: job.jobType,
    status: job.status,
    currentStep: job.currentStep,
    progressPercent: job.progressPercent,
    provider: job.provider,
    modelName: job.modelName,
    retryCount: job.retryCount,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
  };
}

export function toStepDbInput(step: GenerationStepResult) {
  return {
    id: step.id,
    jobId: step.jobId,
    stepName: step.stepName,
    status: step.status,
    inputSnapshotJson: step.inputSnapshot ? JSON.stringify(step.inputSnapshot) : undefined,
    outputJson: step.outputJson ? JSON.stringify(step.outputJson) : undefined,
    outputText: step.outputText,
    errorMessage: step.errorMessage,
    createdAt: step.createdAt,
  };
}
