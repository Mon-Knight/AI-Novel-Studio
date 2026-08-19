import { appLogger } from '../observability/appLogger';
import { dbCall, generateId, lsGet, lsSet, nowISO } from '../database/db';
import { aiSettingsService } from '../ai/aiClient';
import {
  executeChapterGeneration,
  type ChapterProseResumeBeat,
} from '../ai/chapterGenerationExecutionService';
import { trimExternalBeatRepairAtNaturalBoundary } from '../ai/chapterProseOrchestrator';
import { isAiRequestCancelled } from '../ai/aiCancellation';
import { checkLocalChapterModelAvailability } from '../ai/localChapterModelHealthService';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import { qualityCheckAiService } from '../ai/qualityCheckAiService';
import {
  chapterQualityGateService,
  passesChapterQualityGate as chapterPassesQualityGate,
} from '../ai/chapterQualityGateService';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { qualityCheckService } from '../quality/qualityCheckService';
import { generationContextCompiler } from './generationContextCompiler';
import { countTextWords, hashTextContent } from '../../utils/contentHash';
import { toSafeNumber, toSafeString } from '../../utils/dataGuard';
import type { AiGenerateRequest, ChapterDraft } from '../../types/ai';
import type { AiTask, AiTaskDetail } from '../../types/ai-task';
import type { ChapterGenerationSnapshot } from '../../types/generationContext';
import type { QualityCheckItem } from '../../types/qualityCheck';
import type { ResultArtifactBundle } from '../../types/result-artifact';
import type {
  CreateGenerationJobInput,
  GenerationJob,
  GenerationJobStatus,
  GenerationStepName,
  GenerationStepResult,
  GenerationStepStatus,
  RunChapterDraftGenerationJobInput,
  RunMockGenerationJobInput,
  StartupGenerationRecovery,
} from '../../types/generationJob';

const JOBS_KEY = 'ai_novel_studio_generation_jobs';
const STEPS_KEY_PREFIX = 'ai_novel_studio_generation_steps_';
const STARTUP_RECOVERY_ERROR_CODE = 'APP_RESTART_INTERRUPTED';
const STARTUP_RECOVERY_MESSAGE =
  '应用在任务完成前退出；已保留完成步骤和草稿，请确认后手动重新开始。';

interface ActiveJobControl {
  controller: AbortController;
  requestSettled?: Promise<void>;
}

const activeJobControls = new Map<string, ActiveJobControl>();

async function trackActiveAiRequest<T>(control: ActiveJobControl, request: Promise<T>): Promise<T> {
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

const TERMINAL_JOB_STATUSES: ReadonlySet<GenerationJobStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

const ALLOWED_JOB_TRANSITIONS: Readonly<
  Record<GenerationJobStatus, ReadonlySet<GenerationJobStatus>>
> = {
  pending: new Set(['pending', 'running', 'retrying', 'failed', 'cancelled']),
  running: new Set(['running', 'retrying', 'completed', 'failed', 'cancelled']),
  retrying: new Set(['retrying', 'running', 'completed', 'failed', 'cancelled']),
  failed: new Set(['failed']),
  completed: new Set(['completed']),
  cancelled: new Set(['cancelled']),
};

interface RawGenerationJob extends Partial<GenerationJob> {
  world_id?: string | null;
  novel_id?: string;
  volume_id?: string | null;
  chapter_id?: string;
  job_type?: string;
  current_step?: string | null;
  progress_percent?: number;
  model_name?: string | null;
  input_token_estimate?: number | null;
  output_token_estimate?: number | null;
  actual_input_tokens?: number | null;
  actual_output_tokens?: number | null;
  cost_estimate?: number | null;
  error_code?: string | null;
  error_message?: string | null;
  retry_count?: number;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
}

interface RawGenerationStepResult extends Partial<GenerationStepResult> {
  job_id?: string;
  step_name?: string;
  inputSnapshotJson?: string | null;
  input_snapshot_json?: string | null;
  output_json?: string | null;
  output_text?: string | null;
  error_message?: string | null;
  created_at?: string;
}

interface UpdateGenerationJobInput {
  id: string;
  status?: GenerationJobStatus;
  currentStep?: GenerationStepName;
  progressPercent?: number;
  provider?: string;
  modelName?: string;
  inputTokenEstimate?: number;
  outputTokenEstimate?: number;
  actualInputTokens?: number;
  actualOutputTokens?: number;
  costEstimate?: number;
  errorCode?: string;
  errorMessage?: string;
  retryCount?: number;
  startedAt?: string;
  finishedAt?: string;
}

type GenerationJobProgressCallback = (job: GenerationJob, steps: GenerationStepResult[]) => void;
type ChapterDraftJobResult = { job: GenerationJob; draft?: ChapterDraft };
type PatchCandidate = {
  issueId: string;
  severity: string;
  riskLevel: 'low' | 'medium' | 'high';
  quote: string;
  replacementText: string;
  rationale: string;
};

function stepsKey(jobId: string): string {
  return `${STEPS_KEY_PREFIX}${jobId}`;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function normalizeJsonField(value: unknown, fallback?: unknown): unknown {
  const candidate = value ?? fallback;
  return typeof candidate === 'string' ? parseJson(candidate) : candidate;
}

function normalizeJob(raw: unknown): GenerationJob | null {
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

function normalizeJobs(raw: unknown): GenerationJob[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeJob)
    .filter((item): item is GenerationJob => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function normalizeStep(raw: unknown): GenerationStepResult | null {
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

function normalizeSteps(raw: unknown): GenerationStepResult[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeStep)
    .filter((item): item is GenerationStepResult => item !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function resumableBeatFromStep(
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

function generationUnitIdentity(taskInput: Record<string, unknown>): {
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

async function collectRepairArtifactResumeBeats(input: {
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

function normalizeJobStatus(value: unknown): GenerationJobStatus {
  const status = toSafeString(value);
  if (
    status === 'pending' ||
    status === 'running' ||
    status === 'retrying' ||
    status === 'failed' ||
    status === 'completed' ||
    status === 'cancelled'
  ) {
    return status;
  }
  return 'pending';
}

function normalizeStepName(value: unknown): GenerationStepName | undefined {
  const name = toSafeString(value);
  const allowed: GenerationStepName[] = [
    'preflight',
    'compile_context',
    'chapter_card',
    'scene_plan',
    'draft_generation',
    'quality_check',
    'patch_generation',
    'patch_apply',
    'save_version',
  ];
  return allowed.includes(name as GenerationStepName) ? (name as GenerationStepName) : undefined;
}

function normalizeStepStatus(value: unknown): GenerationStepStatus {
  const status = toSafeString(value);
  if (
    status === 'pending' ||
    status === 'running' ||
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'skipped' ||
    status === 'cancelled'
  ) {
    return status;
  }
  return 'pending';
}

function optionalNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function getLocalJobs(): GenerationJob[] {
  return normalizeJobs(lsGet<unknown>(JOBS_KEY));
}

function saveLocalJobs(jobs: GenerationJob[]): void {
  lsSet(JOBS_KEY, jobs);
}

function upsertLocalJob(job: GenerationJob): GenerationJob {
  const jobs = getLocalJobs();
  const idx = jobs.findIndex((item) => item.id === job.id);
  if (idx >= 0) jobs[idx] = job;
  else jobs.unshift(job);
  saveLocalJobs(jobs);
  return job;
}

function updateLocalJob(existing: GenerationJob, input: UpdateGenerationJobInput): GenerationJob {
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

function getLocalSteps(jobId: string): GenerationStepResult[] {
  return normalizeSteps(lsGet<unknown>(stepsKey(jobId)));
}

function saveLocalStep(step: GenerationStepResult): GenerationStepResult {
  const steps = getLocalSteps(step.jobId).filter((item) => item.id !== step.id);
  steps.push(step);
  lsSet(stepsKey(step.jobId), steps);
  return step;
}

function toCreateDbInput(job: GenerationJob) {
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

function toStepDbInput(step: GenerationStepResult) {
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buildMockDraft(snapshot: ChapterGenerationSnapshot): string {
  const base = snapshot.compiledContext.baseContext;
  const engineering = snapshot.compiledContext.activeEngineeringState;
  const sceneLines = engineering?.scenePlan.length
    ? engineering.scenePlan
        .map(
          (scene) =>
            `- ${scene.sceneNo}. ${scene.title || '未命名场景'}：${scene.goal || scene.conflict || '推进本章目标'}`,
        )
        .join('\n')
    : '- 根据章节大纲推进本章目标';
  return [
    `【Mock 初稿】${base.chapterTitle || '未命名章节'}`,
    '',
    `目标字数：${base.targetWordCount || engineering?.chapterCard.targetWordCount || '未设置'}`,
    `上下文快照：${snapshot.contextHash}`,
    '',
    '场景推进：',
    sceneLines,
    '',
    '这里是 v1.9.7 Mock Provider 生成的占位正文结果，用于验证任务队列、步骤记录、轮询与取消链路；真实正文生成将在 v2.0.0 接入。',
  ].join('\n');
}

function buildSnapshotGenerateRequest(snapshot: ChapterGenerationSnapshot): AiGenerateRequest {
  const base = snapshot.compiledContext.baseContext;
  return {
    taskType: 'chapter_generate',
    messages: [
      {
        role: 'system',
        content: [
          '你是一位专业小说作家。',
          '你必须只依据本次 generation_context_snapshot 生成正文。',
          '不得引入快照之外的新设定、新角色、新秘密提前揭示或未授权剧情。',
          '请直接输出小说正文，不要输出说明、分析或 Markdown 标记。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `请根据以下 generation_context_snapshot 生成《${base.chapterTitle || '未命名章节'}》正文。`,
          `目标字数：${base.targetWordCount || snapshot.compiledContext.activeEngineeringState?.chapterCard.targetWordCount || '按上下文要求'}`,
          `context_hash：${snapshot.contextHash}`,
          '',
          snapshot.compiledPromptText,
        ].join('\n'),
      },
    ],
    promptTemplateSource: 'generation_context_snapshot',
  };
}

function buildLocalSceneTaskInput(snapshot: ChapterGenerationSnapshot): Record<string, unknown> {
  const base = snapshot.compiledContext.baseContext;
  const engineering = snapshot.compiledContext.activeEngineeringState;
  const card = engineering?.chapterCard;
  const constraints = engineering?.generationConstraints;
  const scene = engineering?.scenePlan[0];
  const sceneGoal =
    scene?.goal?.trim() ||
    card?.chapterGoal?.trim() ||
    base.chapterGoal?.trim() ||
    '推进本章核心目标。';
  const sceneBeats = [
    ...(scene?.beats ?? []).map((beat) => beat.text),
    ...(scene?.keyActions ?? []),
    ...(scene?.keyDialogue ? [scene.keyDialogue] : []),
    ...(scene?.informationRelease ?? []).map((item) => `释放信息：${item}`),
    ...(scene?.result ? [`场景结果：${scene.result}`] : []),
    ...(scene?.transition ? [`场景转场：${scene.transition}`] : []),
    ...(card?.mustHappenEvents ?? []),
    ...(base.outlineKeyPoints ?? []).map((point) => point.text),
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
  const sceneConstraints = [
    card?.viewpointCharacter ? `视角角色：${card.viewpointCharacter}` : '',
    constraints?.narrativePerson ? `叙事人称：${constraints.narrativePerson}` : '',
    scene?.location
      ? `当前地点：${scene.location}`
      : card?.primaryLocation
        ? `当前地点：${card.primaryLocation}`
        : '',
    scene?.characters?.length ? `当前角色：${scene.characters.join('、')}` : '',
    ...(constraints?.mustFollow ?? []).map((item) => `必须遵守：${item}`),
    ...(constraints?.forbiddenChanges ?? []).map((item) => `不得改变：${item}`),
    ...(constraints?.forbiddenAdditions ?? []).map((item) => `不得新增：${item}`),
    ...(constraints?.forbiddenEarlyEvents ?? []).map((item) => `不得提前发生：${item}`),
    ...(constraints?.forbiddenEarlyReveals ?? []).map((item) => `不得提前揭示：${item}`),
    ...(card?.forbiddenWriting ?? []).map((item) => `写法禁区：${item}`),
    '只输出当前场景连续正文，不提前收束整章或写入后续场景。',
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24);
  const sceneContext = [
    `章节：${base.chapterTitle}`,
    base.volumeTitle ? `分卷：${base.volumeTitle}` : '',
    base.previousContext ? `前文上下文：\n${base.previousContext}` : '',
    card?.openingState ? `场景开场状态：${card.openingState}` : '',
    card?.endingState ? `章节预期结束状态：${card.endingState}` : '',
    card?.knownInformation?.length ? `已知信息：${card.knownInformation.join('；')}` : '',
    card?.releasedInformation?.length ? `已释放信息：${card.releasedInformation.join('；')}` : '',
    card?.reservedMysteries?.length ? `保留悬念：${card.reservedMysteries.join('；')}` : '',
    scene?.conflict
      ? `场景冲突：${scene.conflict}`
      : card?.coreConflict
        ? `核心冲突：${card.coreConflict}`
        : '',
    base.styleProfile ? `风格方案：\n${base.styleProfile}` : '',
    base.outputProfile ? `输出方案：\n${base.outputProfile}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    chapterTitle: base.chapterTitle,
    targetWordCount: base.targetWordCount ?? card?.targetWordCount,
    minimumWordCount: constraints?.wordRange.min,
    contextHash: snapshot.contextHash,
    sceneGoal,
    sceneBeats: sceneBeats.length ? sceneBeats : ['完成当前章节的核心事件推进。'],
    sceneConstraints,
    scenePlan: engineering?.scenePlan ?? [],
    sceneContext:
      sceneContext || `章节：${base.chapterTitle}\n请依据当前章节目标推进一个连续场景。`,
    snapshotId: snapshot.id,
  };
}

function buildPatchCandidates(items: QualityCheckItem[]): PatchCandidate[] {
  return items
    .filter((item) => item.status === 'pending' && item.quote?.trim() && item.suggestion?.trim())
    .map((item) => {
      const quote = item.quote?.trim() || '';
      const suggestion = item.suggestion?.trim() || '';
      const riskLevel: PatchCandidate['riskLevel'] =
        item.severity === 'low' && quote.length <= 120
          ? 'low'
          : item.severity === 'critical' || item.severity === 'high'
            ? 'high'
            : 'medium';
      return {
        issueId: item.id,
        severity: item.severity,
        riskLevel,
        quote,
        replacementText: suggestion,
        rationale: item.title || item.description,
      };
    });
}

function applyLowRiskPatches(
  content: string,
  patches: PatchCandidate[],
): {
  content: string;
  applied: PatchCandidate[];
  skipped: PatchCandidate[];
} {
  let nextContent = content;
  const applied: PatchCandidate[] = [];
  const skipped: PatchCandidate[] = [];
  for (const patch of patches) {
    if (patch.riskLevel !== 'low' || !patch.quote || !patch.replacementText) {
      skipped.push(patch);
      continue;
    }
    if (!nextContent.includes(patch.quote)) {
      skipped.push(patch);
      continue;
    }
    nextContent = nextContent.replace(patch.quote, patch.replacementText);
    applied.push(patch);
  }
  return { content: nextContent, applied, skipped };
}

export function passesChapterQualityGate(score: number, items: QualityCheckItem[]): boolean {
  return chapterPassesQualityGate(score, items);
}

export function shouldAttemptExternalQualityRepair(input: {
  localChapterModelEnabled: boolean;
  runtimeMode: 'mock' | 'api';
  manualReviewRequired: boolean;
  qualityItems: QualityCheckItem[];
  /**
   * Audit-only. Beat repair happens before the immutable chapter draft exists,
   * so it does not consume that saved draft's one quality-repair round.
   */
  externalBeatRepairUsed: boolean;
}): boolean {
  return (
    input.localChapterModelEnabled &&
    input.runtimeMode === 'api' &&
    input.manualReviewRequired &&
    input.qualityItems.some((item) => item.status === 'pending')
  );
}

export const generationJobService = {
  async recoverInterruptedAtStartup(): Promise<StartupGenerationRecovery> {
    const recoveredAt = nowISO();
    return dbCall<StartupGenerationRecovery>('recover_interrupted_generation_jobs', {}, () => {
      const jobs = getLocalJobs();
      const interrupted = jobs.filter(
        (job) => job.status === 'pending' || job.status === 'running' || job.status === 'retrying',
      );
      if (interrupted.length === 0) {
        return { recoveredJobs: 0, recoveredAt };
      }
      const interruptedIds = new Set(interrupted.map((job) => job.id));
      saveLocalJobs(
        jobs.map((job) => {
          if (!interruptedIds.has(job.id)) return job;
          return {
            ...job,
            status: 'failed',
            errorCode: STARTUP_RECOVERY_ERROR_CODE,
            errorMessage: STARTUP_RECOVERY_MESSAGE,
            finishedAt: recoveredAt,
          };
        }),
      );
      for (const job of interrupted) {
        saveLocalStep({
          id: generateId(),
          jobId: job.id,
          stepName: job.currentStep ?? 'preflight',
          status: 'failed',
          outputJson: {
            recoveryReason: STARTUP_RECOVERY_ERROR_CODE,
            previousStatus: job.status,
            preservedProgressPercent: job.progressPercent,
          },
          outputText: STARTUP_RECOVERY_MESSAGE,
          errorMessage: STARTUP_RECOVERY_MESSAGE,
          createdAt: recoveredAt,
        });
      }
      return { recoveredJobs: interrupted.length, recoveredAt };
    });
  },

  async create(input: CreateGenerationJobInput): Promise<GenerationJob> {
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
    const raw = await dbCall<unknown>(
      'create_generation_job',
      { input: toCreateDbInput(job) },
      () => upsertLocalJob(job),
    );
    const normalized = normalizeJob(raw);
    if (!normalized) throw new Error('生成任务创建返回无效数据');
    return normalized;
  },

  async update(input: UpdateGenerationJobInput): Promise<GenerationJob> {
    const raw = await dbCall<unknown>('update_generation_job', { input }, () => {
      const existing = getLocalJobs().find((item) => item.id === input.id);
      if (!existing) throw new Error('生成任务不存在');
      return updateLocalJob(existing, input);
    });
    const normalized = normalizeJob(raw);
    if (!normalized) throw new Error('生成任务更新返回无效数据');
    return normalized;
  },

  async getById(id: string): Promise<GenerationJob | null> {
    const raw = await dbCall<unknown | null>(
      'get_generation_job',
      { id },
      () => getLocalJobs().find((item) => item.id === id) ?? null,
    );
    return normalizeJob(raw);
  },

  async getByChapterId(chapterId: string): Promise<GenerationJob[]> {
    const raw = await dbCall<unknown[]>('get_generation_jobs_by_chapter_id', { chapterId }, () =>
      getLocalJobs().filter((item) => item.chapterId === chapterId),
    );
    return normalizeJobs(raw);
  },

  async cancel(id: string): Promise<GenerationJob | null> {
    const control = activeJobControls.get(id);
    control?.controller.abort();
    await control?.requestSettled;
    const now = nowISO();
    const raw = await dbCall<unknown | null>(
      'cancel_generation_job',
      { id, finishedAt: now },
      () => {
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
      },
    );
    return normalizeJob(raw);
  },

  async saveStep(input: {
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
  },

  async getSteps(jobId: string): Promise<GenerationStepResult[]> {
    const raw = await dbCall<unknown[]>('get_generation_step_results', { jobId }, () =>
      getLocalSteps(jobId),
    );
    return normalizeSteps(raw);
  },

  async runMockChapterJob(
    input: RunMockGenerationJobInput,
    onProgress?: GenerationJobProgressCallback,
  ): Promise<GenerationJob> {
    let job = await this.create({
      novelId: input.novelId,
      volumeId: input.volumeId,
      chapterId: input.chapterId,
      jobType: 'chapter_generation_mock',
      provider: 'mock',
      modelName: 'mock-generation-runner',
    });
    let steps: GenerationStepResult[] = [];

    const emit = async () => {
      steps = await this.getSteps(job.id);
      onProgress?.(job, steps);
    };
    const ensureNotCancelled = async () => {
      const latest = await this.getById(job.id);
      if (latest?.status === 'cancelled') throw new Error('generation_job_cancelled');
    };
    const updateJob = async (patch: Omit<UpdateGenerationJobInput, 'id'>) => {
      job = await this.update({ ...patch, id: job.id });
      await emit();
    };
    const runStep = async (
      stepName: GenerationStepName,
      progressPercent: number,
      action: () => Promise<{
        outputJson?: unknown;
        outputText?: string;
        status?: GenerationStepStatus;
      }>,
      inputSnapshot?: unknown,
    ) => {
      await ensureNotCancelled();
      await updateJob({ status: 'running', currentStep: stepName, progressPercent });
      await delay(120);
      const result = await action();
      await ensureNotCancelled();
      const step = await this.saveStep({
        jobId: job.id,
        stepName,
        status: result.status ?? 'succeeded',
        inputSnapshot,
        outputJson: result.outputJson,
        outputText: result.outputText,
      });
      steps = [...steps, step];
      onProgress?.(job, steps);
    };

    try {
      await updateJob({ status: 'running', startedAt: nowISO(), progressPercent: 1 });
      await runStep('preflight', 8, async () => ({
        outputJson: { novelId: input.novelId, chapterId: input.chapterId, ok: true },
        outputText: 'Mock 预检通过。',
      }));
      let snapshot: ChapterGenerationSnapshot | null = null;
      await runStep('compile_context', 24, async () => {
        snapshot = await generationContextCompiler.compileAndSave({
          novelId: input.novelId,
          volumeId: input.volumeId,
          chapterId: input.chapterId,
          currentEditorContent: input.currentEditorContent,
          provisionalPreviousChapter: input.provisionalPreviousChapter,
        });
        return {
          outputJson: { snapshotId: snapshot.id, contextHash: snapshot.contextHash },
          outputText: snapshot.promptSummary,
        };
      });
      await runStep('chapter_card', 38, async () => ({
        outputJson: {
          engineeringStateId: snapshot?.engineeringStateId,
          hasActiveEngineeringState: Boolean(snapshot?.compiledContext.activeEngineeringState),
        },
        outputText: snapshot?.compiledContext.activeEngineeringState
          ? `读取 active 工程状态 v${snapshot.compiledContext.activeEngineeringState.draftVersion}。`
          : '未读取到 active 工程状态，使用旧式上下文降级。',
      }));
      await runStep('scene_plan', 52, async () => {
        const scenes = snapshot?.compiledContext.activeEngineeringState?.scenePlan ?? [];
        return {
          outputJson: {
            sceneCount: scenes.length,
            scenes: scenes.map((scene) => ({ no: scene.sceneNo, title: scene.title })),
          },
          outputText: scenes.length
            ? `读取 ${scenes.length} 个工程场景。`
            : '无工程场景，Mock 将按章节大纲推进。',
        };
      });
      await runStep('draft_generation', 72, async () => {
        if (!snapshot) throw new Error('missing_context_snapshot');
        const mockDraft = buildMockDraft(snapshot);
        return {
          outputJson: {
            provider: 'mock',
            contextHash: snapshot.contextHash,
            textLength: mockDraft.length,
          },
          outputText: mockDraft,
        };
      });
      await runStep('quality_check', 82, async () => ({
        status: 'skipped',
        outputText: 'v1.9.7 不接真实质量检查，已记录为 skipped。',
      }));
      await runStep('patch_generation', 90, async () => ({
        status: 'skipped',
        outputText: 'v1.9.7 不生成局部 patch，已记录为 skipped。',
      }));
      await runStep('patch_apply', 96, async () => ({
        status: 'skipped',
        outputText: 'v1.9.7 不应用 patch，已记录为 skipped。',
      }));
      await runStep('save_version', 99, async () => ({
        status: 'skipped',
        outputText: 'v1.9.7 不保存正文版本；v2.0.0 将接入正文版本保存。',
      }));
      await ensureNotCancelled();
      job = await this.update({
        id: job.id,
        status: 'completed',
        progressPercent: 100,
        currentStep: 'save_version',
        finishedAt: nowISO(),
      });
      await emit();
      return job;
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'generation_job_cancelled') {
        const cancelled = await this.cancel(job.id);
        if (cancelled) job = cancelled;
        await emit();
        return job;
      }
      const persisted = await this.getById(job.id);
      if (
        persisted &&
        (persisted.status === 'completed' ||
          persisted.status === 'failed' ||
          persisted.status === 'cancelled')
      ) {
        job = persisted;
        await emit();
        return job;
      }
      const message = e instanceof Error ? e.message : '生成任务失败';
      try {
        await this.saveStep({
          jobId: job.id,
          stepName: job.currentStep ?? 'preflight',
          status: 'failed',
          errorMessage: message,
        });
        job = await this.update({
          id: job.id,
          status: 'failed',
          errorMessage: message,
          progressPercent: job.progressPercent,
          finishedAt: nowISO(),
        });
      } catch (finalizationError) {
        const terminal = await this.getById(job.id);
        if (!terminal || !TERMINAL_JOB_STATUSES.has(terminal.status)) throw finalizationError;
        job = terminal;
      }
      await emit();
      return job;
    }
  },

  async runChapterDraftJob(
    input: RunChapterDraftGenerationJobInput,
    onProgress?: GenerationJobProgressCallback,
  ): Promise<ChapterDraftJobResult> {
    const settings = aiSettingsService.getSettings();
    const chapterProvider = settings.localChapterModel?.enabled
      ? settings.localChapterModel.providerId
      : settings.provider;
    const chapterModel = settings.localChapterModel?.enabled
      ? settings.localChapterModel.modelName
      : settings.modelName;
    let job = await this.create({
      novelId: input.novelId,
      volumeId: input.volumeId,
      chapterId: input.chapterId,
      jobType: 'chapter_generation',
      provider: chapterProvider,
      modelName: chapterModel,
    });
    let steps: GenerationStepResult[] = [];
    let savedDraft: ChapterDraft | undefined;
    let qualityItems: QualityCheckItem[] = [];
    let patchCandidates: PatchCandidate[] = [];
    const control: ActiveJobControl = { controller: new AbortController() };
    activeJobControls.set(job.id, control);
    const onCallerAbort = () => control.controller.abort();
    input.signal?.addEventListener('abort', onCallerAbort, { once: true });
    if (input.signal?.aborted) onCallerAbort();

    const emit = async () => {
      steps = await this.getSteps(job.id);
      onProgress?.(job, steps);
    };
    const ensureNotCancelled = async () => {
      const latest = await this.getById(job.id);
      if (latest?.status === 'cancelled') throw new Error('generation_job_cancelled');
    };
    const updateJob = async (patch: Omit<UpdateGenerationJobInput, 'id'>) => {
      job = await this.update({ ...patch, id: job.id });
      await emit();
    };
    const runStep = async (
      stepName: GenerationStepName,
      progressPercent: number,
      action: () => Promise<{
        outputJson?: unknown;
        outputText?: string;
        status?: GenerationStepStatus;
      }>,
      inputSnapshot?: unknown,
    ) => {
      await ensureNotCancelled();
      await updateJob({ status: 'running', currentStep: stepName, progressPercent });
      const result = await action();
      await ensureNotCancelled();
      const step = await this.saveStep({
        jobId: job.id,
        stepName,
        status: result.status ?? 'succeeded',
        inputSnapshot,
        outputJson: result.outputJson,
        outputText: result.outputText,
      });
      steps = [...steps, step];
      onProgress?.(job, steps);
    };

    try {
      await updateJob({ status: 'running', startedAt: nowISO(), progressPercent: 1 });
      await runStep('preflight', 8, async () => {
        const localAvailability = settings.localChapterModel?.enabled
          ? await checkLocalChapterModelAvailability(
              settings.localChapterModel,
              control.controller.signal,
            )
          : undefined;
        if (localAvailability && (!localAvailability.healthOk || !localAvailability.modelOk)) {
          throw new Error(localAvailability.message);
        }
        return {
          outputJson: {
            runtimeMode: settings.runtimeMode,
            provider: chapterProvider,
            modelName: chapterModel,
            chapterId: input.chapterId,
            localAvailability: localAvailability
              ? {
                  healthOk: localAvailability.healthOk,
                  modelOk: localAvailability.modelOk,
                  smokeCalled: false,
                }
              : undefined,
          },
          outputText: localAvailability
            ? '正文生成预检通过：本地服务健康、模型匹配，未执行 smoke 生成。'
            : '正文生成预检通过。',
        };
      });
      let snapshot: ChapterGenerationSnapshot | null = null;
      await runStep('compile_context', 24, async () => {
        snapshot = await generationContextCompiler.compileAndSave({
          novelId: input.novelId,
          volumeId: input.volumeId,
          chapterId: input.chapterId,
          currentEditorContent: input.currentEditorContent,
          provisionalPreviousChapter: input.provisionalPreviousChapter,
        });
        return {
          outputJson: { snapshotId: snapshot.id, contextHash: snapshot.contextHash },
          outputText: snapshot.promptSummary,
        };
      });
      let resumeBeats: ChapterProseResumeBeat[] = [];
      const compiledSnapshot = snapshot as ChapterGenerationSnapshot | null;
      if (settings.localChapterModel?.enabled && compiledSnapshot) {
        const resumableJobs = (await this.getByChapterId(input.chapterId))
          .filter(
            (candidate) =>
              candidate.id !== job.id &&
              candidate.status === 'failed' &&
              candidate.jobType === 'chapter_generation' &&
              candidate.provider === chapterProvider &&
              candidate.modelName === chapterModel,
          )
          .slice(0, 20);
        const candidates = await Promise.all(
          resumableJobs.map(async (candidate) => ({
            job: candidate,
            steps: await this.getSteps(candidate.id),
          })),
        );
        const repairBeats = await collectRepairArtifactResumeBeats({
          novelId: input.novelId,
          chapterId: input.chapterId,
          candidates,
          contextHash: compiledSnapshot.contextHash,
        });
        resumeBeats = selectResumableBeatPrefix({
          candidates,
          contextHash: compiledSnapshot.contextHash,
          provider: chapterProvider,
          modelName: chapterModel,
          repairBeats,
        });
      }
      let generatedText = '';
      let aiTaskId: string | undefined;
      let externalBeatRepairUsed = false;
      await runStep('draft_generation', 72, async () => {
        if (!snapshot) throw new Error('missing_context_snapshot');
        const request = buildSnapshotGenerateRequest(snapshot);
        const response = await trackActiveAiRequest(
          control,
          executeChapterGeneration({
            novelId: input.novelId,
            chapterId: input.chapterId,
            operationId: `${job.id}:draft`,
            traceId: job.id,
            settings,
            request,
            sourceId: snapshot.id,
            sourceVersion: snapshot.contextHash,
            taskInput: {
              chapterTitle: snapshot.compiledContext.baseContext.chapterTitle,
              targetWordCount:
                snapshot.compiledContext.baseContext.targetWordCount ??
                snapshot.compiledContext.activeEngineeringState?.chapterCard.targetWordCount,
              contextHash: snapshot.contextHash,
              promptTemplateSource: request.promptTemplateSource,
              generationJobId: job.id,
              snapshotId: snapshot.id,
              ...buildLocalSceneTaskInput(snapshot),
            },
            targetHintJson: {
              generationJobId: job.id,
              snapshotId: snapshot.id,
              contextHash: snapshot.contextHash,
            },
            resumeBeats,
            signal: control.controller.signal,
            stream: true,
            onStreamEvent: input.onStreamEvent,
            onSceneCompleted: async (scene) => {
              const sceneStep = await this.saveStep({
                jobId: job.id,
                stepName: 'draft_generation',
                status: 'succeeded',
                inputSnapshot: {
                  sceneNo: scene.sceneNo,
                  beatOrder: scene.beatOrder,
                  generationUnitNo: scene.generationUnitNo,
                  generationUnitCount: scene.generationUnitCount,
                  title: scene.title,
                  taskId: scene.taskId,
                  attemptId: scene.attemptId,
                  reusedFromJobId: scene.reusedFromJobId,
                },
                outputJson: {
                  sceneNo: scene.sceneNo,
                  beatOrder: scene.beatOrder,
                  generationUnitNo: scene.generationUnitNo,
                  generationUnitCount: scene.generationUnitCount,
                  taskId: scene.taskId,
                  attemptId: scene.attemptId,
                  provider: scene.provider.providerId,
                  modelName: scene.provider.modelId,
                  finishReason: scene.provider.finishReason,
                  tokenInput: scene.provider.tokenInput,
                  tokenOutput: scene.provider.tokenOutput,
                  reusedFromJobId: scene.reusedFromJobId,
                },
                outputText: scene.text,
              });
              steps = [...steps, sceneStep];
              onProgress?.(job, steps);
            },
          }),
        );
        aiTaskId = response.taskId;
        externalBeatRepairUsed = response.externalRepairUsed === true;
        generatedText = response.text.trim();
        if (!generatedText) throw new Error('正文模型返回为空');
        const sceneResults = response.sceneResults ?? [
          {
            sceneNo: 1,
            beatOrder: undefined,
            generationUnitNo: undefined,
            generationUnitCount: undefined,
            taskId: response.taskId,
            attemptId: response.attemptId,
            provider: response.provider,
            reusedFromJobId: undefined,
          },
        ];
        const actualInputTokens = sceneResults.reduce(
          (total, scene) => total + (scene.provider.tokenInput ?? 0),
          0,
        );
        const actualOutputTokens = sceneResults.reduce(
          (total, scene) => total + (scene.provider.tokenOutput ?? 0),
          0,
        );
        job = await this.update({
          id: job.id,
          actualInputTokens: actualInputTokens || response.provider.tokenInput,
          actualOutputTokens: actualOutputTokens || response.provider.tokenOutput,
          costEstimate: response.provider.usageCost?.estimatedCost,
        });
        return {
          outputJson: {
            provider: response.provider.providerId,
            modelName: response.provider.modelId,
            contextHash: snapshot.contextHash,
            aiTaskId: response.taskId,
            sceneCount: new Set(sceneResults.map((scene) => scene.sceneNo)).size,
            generationUnitCount: sceneResults.length,
            reusedGenerationUnitCount: sceneResults.filter((scene) => scene.reusedFromJobId).length,
            resumedFromJobIds: [
              ...new Set(
                sceneResults
                  .map((scene) => scene.reusedFromJobId)
                  .filter((sourceJobId): sourceJobId is string => Boolean(sourceJobId)),
              ),
            ],
            sceneResults: sceneResults.map((scene) => ({
              sceneNo: scene.sceneNo,
              beatOrder: scene.beatOrder,
              generationUnitNo: scene.generationUnitNo,
              generationUnitCount: scene.generationUnitCount,
              taskId: scene.taskId,
              attemptId: scene.attemptId,
              provider: scene.provider.providerId,
              modelName: scene.provider.modelId,
              finishReason: scene.provider.finishReason,
              tokenInput: scene.provider.tokenInput,
              tokenOutput: scene.provider.tokenOutput,
              reusedFromJobId: scene.reusedFromJobId,
            })),
            tokenInput: response.provider.tokenInput,
            tokenOutput: response.provider.tokenOutput,
            tokenTotal: response.provider.tokenTotal,
            costEstimate: response.provider.usageCost?.estimatedCost,
            costStatus: response.provider.usageCost?.status,
            textLength: generatedText.length,
          },
          outputText: generatedText,
        };
      });
      await runStep('save_version', 96, async () => {
        if (!snapshot) throw new Error('missing_context_snapshot');
        savedDraft = await draftVersionService.create({
          novelId: input.novelId,
          chapterId: input.chapterId,
          title: input.title || `AI 初稿 ${new Date().toLocaleString()}`,
          content: generatedText,
          source: 'ai_generated',
          aiTaskId,
          note: `v2.0.0 generation job ${job.id} / context ${snapshot.contextHash}`,
        });
        await input.onDraftSaved?.(savedDraft, job.id);
        const chapter = await chapterRepository.getById(input.chapterId);
        if (chapter && chapter.status !== 'adopted' && chapter.status !== 'summarized') {
          await chapterRepository
            .update(chapter.id, { status: 'draft_generated' })
            .catch((error) => {
              appLogger.warn('[GenerationJob] draft saved but chapter status refresh failed', {
                chapterId: chapter.id,
                error,
              });
            });
        }
        return {
          outputJson: {
            draftId: savedDraft.id,
            versionNo: savedDraft.versionNo,
            contextHash: snapshot.contextHash,
          },
          outputText: `已保存正文草稿 v${savedDraft.versionNo}。`,
        };
      });
      await runStep('quality_check', 99, async () => {
        if (!savedDraft) throw new Error('missing_saved_draft');
        const chapter = await chapterRepository.getById(input.chapterId);
        const contentHash = hashTextContent(savedDraft.content);
        const checkedAt = nowISO();
        const result = await trackActiveAiRequest(
          control,
          qualityCheckAiService.runCheck(
            {
              novelId: input.novelId,
              chapterId: input.chapterId,
              draftId: savedDraft.id,
              volumeId: input.volumeId,
              draftContent: savedDraft.content,
              chapterTitle: chapter?.title || input.title || '未命名章节',
              chapterOutline: chapter?.outline,
              chapterGoal: chapter?.goal,
              contentHash,
              wordCount: countTextWords(savedDraft.content),
            },
            {
              signal: control.controller.signal,
              requestId: `${job.id}:quality:${generateId()}`,
            },
          ),
        );
        const report = await qualityCheckService.createReport({
          novelId: input.novelId,
          chapterId: input.chapterId,
          draftId: savedDraft.id,
          scope: 'current_draft',
          contentHash,
          contentLength: savedDraft.content.length,
          checkedAt,
        });
        const saved = await qualityCheckService.saveResult({
          reportId: report.id,
          novelId: input.novelId,
          chapterId: input.chapterId,
          draftId: savedDraft.id,
          result,
          draftVersion: savedDraft.versionNo,
          model: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
          contentHash,
          contentLength: savedDraft.content.length,
          checkedAt,
          aiTaskId: result.aiTaskId,
        });
        qualityItems = saved.items;

        const initialScore = result.overallScore;
        let finalScore = initialScore;
        let finalReportId = saved.report?.id || report.id;
        let externalRepairAttempted = false;
        let externalRepairSucceeded = false;
        let manualReviewRequired = !passesChapterQualityGate(finalScore, qualityItems);

        // A Beat-level repair is a pre-draft rescue for malformed local output.
        // The scored, immutable source draft still owns one separate targeted
        // quality-repair round, persisted and enforced by qualityFixService.
        if (
          shouldAttemptExternalQualityRepair({
            localChapterModelEnabled: settings.localChapterModel?.enabled === true,
            runtimeMode: settings.runtimeMode,
            manualReviewRequired,
            qualityItems,
            externalBeatRepairUsed,
          })
        ) {
          externalRepairAttempted = true;
          try {
            const sourceDraft = savedDraft;
            const sourceReport = saved.report;
            if (!sourceReport) throw new Error('missing_saved_quality_report');
            const repaired = await chapterQualityGateService.runRepairAndRecheck(
              {
                novelId: input.novelId,
                chapterId: input.chapterId,
                volumeId: input.volumeId,
                chapterTitle: chapter?.title || input.title || '未命名章节',
                chapterOutline: chapter?.outline,
                chapterGoal: chapter?.goal,
                draft: sourceDraft,
                report: sourceReport,
                items: qualityItems,
              },
              {
                signal: control.controller.signal,
                requestIdPrefix: `${job.id}:external-quality`,
                cancel: () => control.controller.abort(),
                trackRequest: (request) => trackActiveAiRequest(control, request),
              },
            );
            externalRepairSucceeded = repaired.repairApplied;
            savedDraft = repaired.finalDraft;
            qualityItems = repaired.finalItems;
            finalReportId = repaired.finalReport.id;
            finalScore = repaired.finalScore;
            manualReviewRequired = !repaired.qualityGatePassed;
            if (repaired.finalDraft.id !== sourceDraft.id) {
              await input.onDraftSaved?.(repaired.finalDraft, job.id);
            }
          } catch (repairError) {
            appLogger.warn(
              '[GenerationJob] external quality repair failed; manual review required',
              {
                jobId: job.id,
                error: repairError,
              },
            );
          }
        }

        return {
          outputJson: {
            reportId: finalReportId,
            initialScore,
            finalScore,
            issueCount: qualityItems.length,
            pendingCount: qualityItems.filter((item) => item.status === 'pending').length,
            criticalCount: qualityItems.filter(
              (item) => item.status === 'pending' && item.severity === 'critical',
            ).length,
            highCount: qualityItems.filter(
              (item) => item.status === 'pending' && item.severity === 'high',
            ).length,
            qualityGatePassed: !manualReviewRequired,
            externalRepairAttempted,
            externalRepairSucceeded,
            externalBeatRepairUsed,
          },
          outputText: manualReviewRequired
            ? `质量检查完成：${initialScore} → ${finalScore} 分，仍需人工处理（外部质量修稿${externalRepairAttempted ? '已执行' : '未执行'}${externalBeatRepairUsed ? '；此前另有 Beat 定点修稿' : ''}）。`
            : `质量门禁通过：${finalScore} 分，critical/high 均为 0。`,
        };
      });
      await runStep('patch_generation', 99, async () => {
        patchCandidates = buildPatchCandidates(qualityItems);
        return {
          outputJson: {
            patchCount: patchCandidates.length,
            lowRiskCount: patchCandidates.filter((patch) => patch.riskLevel === 'low').length,
            patches: patchCandidates,
          },
          outputText: patchCandidates.length
            ? `已生成 ${patchCandidates.length} 个局部修复建议，其中 ${patchCandidates.filter((patch) => patch.riskLevel === 'low').length} 个为低风险。`
            : '未生成可自动处理的局部修复建议。',
        };
      });
      await runStep('patch_apply', 99, async () => {
        if (!savedDraft) throw new Error('missing_saved_draft');
        if (settings.localChapterModel?.enabled) {
          return {
            status: 'skipped',
            outputJson: {
              appliedCount: 0,
              skippedCount: patchCandidates.length,
              reason: 'local_prose_quality_gate_owns_external_repair_round',
            },
            outputText: '本地正文流程不自动应用低风险 patch；请依据最终评分和问题列表人工确认。',
          };
        }
        const result = applyLowRiskPatches(savedDraft.content, patchCandidates);
        if (result.applied.length === 0 || result.content === savedDraft.content) {
          return {
            status: 'skipped',
            outputJson: { appliedCount: 0, skippedCount: result.skipped.length },
            outputText: '没有可自动应用的低风险 patch。',
          };
        }
        const patchedDraft = await draftVersionService.create({
          novelId: input.novelId,
          chapterId: input.chapterId,
          title: `${input.title || '章节'} - AI 局部修复`,
          content: result.content,
          source: 'ai_regenerated',
          aiTaskId: job.id,
          note: `v2.0.2 auto patch from generation job ${job.id}; applied ${result.applied.length} low-risk patches`,
        });
        savedDraft = patchedDraft;
        return {
          outputJson: {
            draftId: patchedDraft.id,
            versionNo: patchedDraft.versionNo,
            appliedCount: result.applied.length,
            skippedCount: result.skipped.length,
          },
          outputText: `已自动应用 ${result.applied.length} 个低风险 patch，并保存修复草稿 v${patchedDraft.versionNo}。`,
        };
      });
      await ensureNotCancelled();
      job = await this.update({
        id: job.id,
        status: 'completed',
        progressPercent: 100,
        currentStep: 'save_version',
        finishedAt: nowISO(),
      });
      await emit();
      return { job, draft: savedDraft };
    } catch (e: unknown) {
      if (
        isAiRequestCancelled(e) ||
        (e instanceof Error && e.message === 'generation_job_cancelled')
      ) {
        const cancelled = await this.cancel(job.id);
        if (cancelled) job = cancelled;
        await emit();
        return { job, draft: savedDraft };
      }
      const persisted = await this.getById(job.id);
      if (
        persisted &&
        (persisted.status === 'completed' ||
          persisted.status === 'failed' ||
          persisted.status === 'cancelled')
      ) {
        job = persisted;
        await emit();
        return { job, draft: savedDraft };
      }
      const message = e instanceof Error ? e.message : '正文生成任务失败';
      try {
        await this.saveStep({
          jobId: job.id,
          stepName: job.currentStep ?? 'preflight',
          status: 'failed',
          errorMessage: message,
        });
        job = await this.update({
          id: job.id,
          status: 'failed',
          errorMessage: message,
          progressPercent: job.progressPercent,
          finishedAt: nowISO(),
        });
      } catch (finalizationError) {
        const terminal = await this.getById(job.id);
        if (!terminal || !TERMINAL_JOB_STATUSES.has(terminal.status)) throw finalizationError;
        job = terminal;
      }
      await emit();
      return { job, draft: savedDraft };
    } finally {
      input.signal?.removeEventListener('abort', onCallerAbort);
      if (activeJobControls.get(job.id) === control) {
        activeJobControls.delete(job.id);
      }
    }
  },
};
