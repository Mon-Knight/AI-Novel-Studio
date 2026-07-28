import { appLogger } from '../observability/appLogger';
import { dbCall, generateId, lsGet, lsSet, nowISO } from '../database/db';
import { createAiClient, aiSettingsService } from '../ai/aiClient';
import { isAiRequestCancelled } from '../ai/aiCancellation';
import { qualityCheckAiService } from '../ai/qualityCheckAiService';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { qualityCheckService } from '../quality/qualityCheckService';
import { generationContextCompiler } from './generationContextCompiler';
import { countTextWords, hashTextContent } from '../../utils/contentHash';
import { toSafeNumber, toSafeString } from '../../utils/dataGuard';
import type { AiGenerateRequest, ChapterDraft } from '../../types/ai';
import type { ChapterGenerationSnapshot } from '../../types/generationContext';
import type { QualityCheckItem } from '../../types/qualityCheck';
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
    let job = await this.create({
      novelId: input.novelId,
      volumeId: input.volumeId,
      chapterId: input.chapterId,
      jobType: 'chapter_generation',
      provider: settings.provider,
      modelName: settings.modelName,
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
      await runStep('preflight', 8, async () => ({
        outputJson: {
          runtimeMode: settings.runtimeMode,
          provider: settings.provider,
          modelName: settings.modelName,
          chapterId: input.chapterId,
        },
        outputText: '正文生成预检通过。',
      }));
      let snapshot: ChapterGenerationSnapshot | null = null;
      await runStep('compile_context', 24, async () => {
        snapshot = await generationContextCompiler.compileAndSave({
          novelId: input.novelId,
          volumeId: input.volumeId,
          chapterId: input.chapterId,
          currentEditorContent: input.currentEditorContent,
        });
        return {
          outputJson: { snapshotId: snapshot.id, contextHash: snapshot.contextHash },
          outputText: snapshot.promptSummary,
        };
      });
      let generatedText = '';
      await runStep('draft_generation', 72, async () => {
        if (!snapshot) throw new Error('missing_context_snapshot');
        const request = buildSnapshotGenerateRequest(snapshot);
        const client = createAiClient(settings);
        const response = await trackActiveAiRequest(
          control,
          client.generate(request, {
            signal: control.controller.signal,
            requestId: `${job.id}:draft:${generateId()}`,
            stream: true,
            onStreamEvent: input.onStreamEvent,
          }),
        );
        generatedText = response.text.trim();
        if (!generatedText) throw new Error('正文模型返回为空');
        job = await this.update({
          id: job.id,
          actualInputTokens: response.tokenInput,
          actualOutputTokens: response.tokenOutput,
          costEstimate: response.usageCost?.estimatedCost,
        });
        return {
          outputJson: {
            provider: settings.provider,
            modelName: settings.modelName,
            contextHash: snapshot.contextHash,
            tokenInput: response.tokenInput,
            tokenOutput: response.tokenOutput,
            tokenTotal: response.tokenTotal,
            costEstimate: response.usageCost?.estimatedCost,
            costStatus: response.usageCost?.status,
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
          aiTaskId: job.id,
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
        return {
          outputJson: {
            reportId: saved.report?.id || report.id,
            score: result.overallScore,
            issueCount: result.items.length,
            pendingCount: saved.statistics.pending,
          },
          outputText: `质量检查完成：评分 ${result.overallScore}，发现 ${result.items.length} 个问题。`,
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
