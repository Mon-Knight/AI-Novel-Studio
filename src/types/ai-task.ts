import type { AppError } from './appError';

export type UnifiedAiTaskStatus =
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

export interface UnifiedAiTask {
  taskId: string;
  taskType: string;
  novelId: string;
  chapterId?: string;
  draftId?: string;
  scopeType: string;
  status: UnifiedAiTaskStatus;
  inputSnapshotId?: string;
  contextSnapshotId?: string;
  constraintSnapshotId?: string;
  currentAttemptId?: string;
  resultArtifactId?: string;
  traceId: string;
  operationId: string;
  requestHash: string;
  errorJson?: string;
  error?: AppError;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AiTaskAttemptStart {
  task: UnifiedAiTask;
  attemptId: string;
  attemptNumber: number;
}

export interface AiTaskSnapshotInput {
  schemaVersion: number;
  inputType: string;
  payloadJson: unknown;
  body?: string;
  sourceDraftId?: string;
  sourceDraftVersion?: number;
  baseContentHash?: string;
}

export interface AiTaskContextSnapshotInput {
  schemaVersion: number;
  sourceManifestJson: unknown;
  compiledContext?: string;
  budgetJson: unknown;
  compilerVersion: string;
}

export interface AiTaskConstraintSnapshotInput {
  schemaVersion: number;
  payloadJson: unknown;
  promptTemplateId: string;
  promptTemplateVersion: string;
  promptTemplateHash: string;
  promptTemplateBody?: string;
  providerOptionsJson: unknown;
}
