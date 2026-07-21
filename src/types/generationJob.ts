export type GenerationJobStatus =
  | 'pending'
  | 'running'
  | 'retrying'
  | 'failed'
  | 'completed'
  | 'cancelled';

export type GenerationJobType = 'chapter_generation_mock' | 'chapter_generation';

export type GenerationStepName =
  | 'preflight'
  | 'compile_context'
  | 'chapter_card'
  | 'scene_plan'
  | 'draft_generation'
  | 'quality_check'
  | 'patch_generation'
  | 'patch_apply'
  | 'save_version';

export type GenerationStepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface GenerationJob {
  id: string;
  worldId?: string;
  novelId: string;
  volumeId?: string;
  chapterId: string;
  jobType: GenerationJobType;
  status: GenerationJobStatus;
  currentStep?: GenerationStepName;
  progressPercent: number;
  provider?: string;
  modelName?: string;
  inputTokenEstimate?: number;
  outputTokenEstimate?: number;
  actualInputTokens?: number;
  actualOutputTokens?: number;
  costEstimate?: number;
  errorCode?: string;
  errorMessage?: string;
  retryCount: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface GenerationStepResult {
  id: string;
  jobId: string;
  stepName: GenerationStepName;
  status: GenerationStepStatus;
  inputSnapshot?: unknown;
  outputJson?: unknown;
  outputText?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface CreateGenerationJobInput {
  novelId: string;
  volumeId?: string;
  chapterId: string;
  jobType: GenerationJobType;
  provider?: string;
  modelName?: string;
}

export interface RunMockGenerationJobInput {
  novelId: string;
  volumeId?: string;
  chapterId: string;
  currentEditorContent?: string;
}

export interface RunChapterDraftGenerationJobInput extends RunMockGenerationJobInput {
  title?: string;
}

export interface StartupGenerationRecovery {
  recoveredJobs: number;
  recoveredAt: string;
}
