import type { ChapterDraft } from '../../types/ai';
import type {
  GenerationJob,
  GenerationJobStatus,
  GenerationStepName,
  GenerationStepResult,
  GenerationStepStatus,
} from '../../types/generationJob';
import { toSafeString } from '../../utils/dataGuard';

export const JOBS_KEY = 'ai_novel_studio_generation_jobs';
export const STEPS_KEY_PREFIX = 'ai_novel_studio_generation_steps_';
export const STARTUP_RECOVERY_ERROR_CODE = 'APP_RESTART_INTERRUPTED';
export const STARTUP_RECOVERY_MESSAGE =
  '应用在任务完成前退出；已保留完成步骤和草稿，请确认后手动重新开始。';

export interface ActiveJobControl {
  controller: AbortController;
  requestSettled?: Promise<void>;
}

export const TERMINAL_JOB_STATUSES: ReadonlySet<GenerationJobStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

export const ALLOWED_JOB_TRANSITIONS: Readonly<
  Record<GenerationJobStatus, ReadonlySet<GenerationJobStatus>>
> = {
  pending: new Set(['pending', 'running', 'retrying', 'failed', 'cancelled']),
  running: new Set(['running', 'retrying', 'completed', 'failed', 'cancelled']),
  retrying: new Set(['retrying', 'running', 'completed', 'failed', 'cancelled']),
  failed: new Set(['failed']),
  completed: new Set(['completed']),
  cancelled: new Set(['cancelled']),
};

export interface RawGenerationJob extends Partial<GenerationJob> {
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

export interface RawGenerationStepResult extends Partial<GenerationStepResult> {
  job_id?: string;
  step_name?: string;
  inputSnapshotJson?: string | null;
  input_snapshot_json?: string | null;
  output_json?: string | null;
  output_text?: string | null;
  error_message?: string | null;
  created_at?: string;
}

export interface UpdateGenerationJobInput {
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

export type GenerationJobProgressCallback = (
  job: GenerationJob,
  steps: GenerationStepResult[],
) => void;

export type ChapterDraftJobResult = { job: GenerationJob; draft?: ChapterDraft };

export type PatchCandidate = {
  issueId: string;
  severity: string;
  riskLevel: 'low' | 'medium' | 'high';
  quote: string;
  replacementText: string;
  rationale: string;
};

export function stepsKey(jobId: string): string {
  return `${STEPS_KEY_PREFIX}${jobId}`;
}

export function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function normalizeJsonField(value: unknown, fallback?: unknown): unknown {
  const candidate = value ?? fallback;
  return typeof candidate === 'string' ? parseJson(candidate) : candidate;
}

export function normalizeJobStatus(value: unknown): GenerationJobStatus {
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

export function normalizeStepName(value: unknown): GenerationStepName | undefined {
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

export function normalizeStepStatus(value: unknown): GenerationStepStatus {
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

export function optionalNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
