import type { AppError } from './appError';
import type { ResultArtifactType } from './result-artifact';

export type AiTaskType =
  | 'connection_test'
  | 'chapter_generate'
  | 'chapter_beat_repair'
  | 'chapter_scene_generate'
  | 'chapter_scene_plan_generate'
  | 'chapter_rewrite'
  | 'chapter_polish'
  | 'character_generate'
  | 'event_suggest'
  | 'setting_expand'
  | 'outline_generate'
  | 'volume_outline_generate'
  | 'chapter_outline_generate'
  | 'context_summarize'
  | 'chapter_summary'
  | 'volume_summary'
  | 'style_analyze'
  | 'quality_check'
  | 'quality_fix'
  | 'autonomous_plot_plan'
  | 'autonomous_character_evolution'
  | 'autonomous_world_build'
  | 'autonomous_conflict_generate'
  | 'autonomous_pacing_control'
  | 'autonomous_chapter_batch';

export type AiTaskStatus =
  | 'created'
  | 'preparing_context'
  | 'ready'
  | 'queued'
  | 'running'
  | 'validating'
  | 'completed'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled';

export type AiAttemptStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'
  | 'late_response_ignored';

export type AiTaskScope = 'system' | 'novel' | 'chapter' | 'draft' | 'selection';

export interface AiTask {
  taskId: string;
  taskType: AiTaskType;
  novelId: string;
  chapterId?: string;
  draftId?: string;
  scopeType: AiTaskScope;
  status: AiTaskStatus;
  stateRevision: number;
  inputSnapshotId: string;
  contextSnapshotId: string;
  constraintSnapshotId: string;
  currentAttemptId?: string;
  resultArtifactId?: string;
  traceId: string;
  operationId: string;
  requestHashVersion: number;
  requestHash: string;
  expectedArtifactType: ResultArtifactType;
  expectedArtifactSchemaVersion: number;
  targetHintJson?: unknown;
  errorJson?: AppError;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  appliedAt?: string;
}

export interface AiTaskAttempt {
  attemptId: string;
  taskId: string;
  attemptNumber: number;
  providerId?: string;
  modelId?: string;
  providerRequestId?: string;
  status: AiAttemptStatus;
  stateRevision: number;
  responseMetadataJson?: Record<string, unknown>;
  errorJson?: AppError;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface AiInputSnapshot {
  snapshotId: string;
  taskId: string;
  schemaVersion: number;
  inputType: string;
  payloadJson: unknown;
  bodyRefId: string;
  sourceDraftId?: string;
  sourceDraftVersion?: number;
  baseContentHash?: string;
  contentHash: string;
  createdAt: string;
  body: string;
}

export interface AiContextSnapshot {
  snapshotId: string;
  taskId: string;
  schemaVersion: number;
  sourceManifestJson: unknown;
  compiledContextRefId: string;
  budgetJson: unknown;
  compilerVersion: string;
  contentHash: string;
  createdAt: string;
  compiledContext: string;
}

export interface AiConstraintSnapshot {
  snapshotId: string;
  taskId: string;
  schemaVersion: number;
  payloadJson: unknown;
  promptTemplateId: string;
  promptTemplateVersion: string;
  promptTemplateHash: string;
  promptTemplateRefId: string;
  providerOptionsJson: Record<string, unknown>;
  contentHash: string;
  createdAt: string;
  promptTemplateBody: string;
}

export interface AiTaskDetail {
  task: AiTask;
  attempts: AiTaskAttempt[];
  inputSnapshot: AiInputSnapshot;
  contextSnapshot: AiContextSnapshot;
  constraintSnapshot: AiConstraintSnapshot;
}

export interface InputSnapshotInput {
  schemaVersion: number;
  inputType: string;
  payloadJson: unknown;
  body: string;
  sourceDraftId?: string;
  sourceDraftVersion?: number;
  baseContentHash?: string;
}

export interface ContextSnapshotInput {
  schemaVersion: number;
  sourceManifestJson: unknown;
  compiledContext: string;
  budgetJson: unknown;
  compilerVersion: string;
}

export interface ConstraintSnapshotInput {
  schemaVersion: number;
  payloadJson: unknown;
  promptTemplateId: string;
  promptTemplateVersion: string;
  promptTemplateHash: string;
  promptTemplateBody: string;
  providerOptionsJson: Record<string, unknown>;
}

export interface CreateAiTaskInput {
  operationId: string;
  requestHashVersion?: number;
  requestHash?: string;
  traceId?: string;
  taskType: AiTaskType;
  novelId: string;
  chapterId?: string;
  draftId?: string;
  scopeType: AiTaskScope;
  expectedArtifactType: ResultArtifactType;
  expectedArtifactSchemaVersion: number;
  targetHintJson?: unknown;
  inputSnapshot: InputSnapshotInput;
  contextSnapshot: ContextSnapshotInput;
  constraintSnapshot: ConstraintSnapshotInput;
}

export interface ClaimAiTaskAttemptInput {
  taskId: string;
  attemptId: string;
  providerId: string;
  modelId: string;
  providerRequestId?: string;
}

export interface AiTaskAttemptResult {
  task: AiTask;
  attempt: AiTaskAttempt;
}
