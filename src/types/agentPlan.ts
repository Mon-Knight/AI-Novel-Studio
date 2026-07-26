import type { ToolPermission, ToolResult } from './toolRegistry';

export type AgentPlanStatus =
  | 'ready'
  | 'running'
  | 'waiting_retry'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentPlanStepStatus =
  | 'pending'
  | 'running'
  | 'waiting_retry'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentPlanRecord {
  planId: string;
  operationId: string;
  requestHash: string;
  contractVersion: 'agent_plan_v1';
  plannerId: 'chapter_readiness_plan_v1';
  plannerVersion: 1;
  registryHash: string;
  novelId: string;
  chapterId: string;
  status: AgentPlanStatus;
  stateRevision: number;
  resultJson?: ToolResult<ChapterReadinessResult> | null;
  errorJson?: AgentPlanError | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface AgentPlanStepRecord {
  stepId: string;
  planId: string;
  stepKey: string;
  ordinal: number;
  title: string;
  toolName: string;
  toolVersion: string;
  toolIdentity: string;
  registryHash: string;
  inputSchemaHash: string;
  outputSchemaHash: string;
  permissionsJson: ToolPermission[];
  scope: 'system' | 'novel' | 'chapter' | 'draft';
  argumentsJson: Record<string, unknown>;
  argumentsHash: string;
  status: AgentPlanStepStatus;
  stateRevision: number;
  outputJson?: ToolResult | null;
  outputHash?: string | null;
  errorJson?: AgentPlanError | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface AgentPlanStepDependencyRecord {
  planId: string;
  stepId: string;
  dependsOnStepId: string;
  dependencyOrdinal: number;
  createdAt: string;
}

export interface AgentPlanStepAttemptRecord {
  attemptId: string;
  planId: string;
  stepId: string;
  attemptNumber: number;
  leaseId: string;
  leaseEpoch: number;
  status: 'running' | 'succeeded' | 'failed' | 'abandoned';
  outputJson?: ToolResult | null;
  outputHash?: string | null;
  errorJson?: AgentPlanError | null;
  startedAt: string;
  finishedAt?: string | null;
}

export interface AgentPlanCheckpointRecord {
  checkpointId: string;
  planId: string;
  sequence: number;
  eventType:
    | 'plan_created'
    | 'lease_acquired'
    | 'step_claimed'
    | 'step_completed'
    | 'step_failed'
    | 'retry_authorized'
    | 'lease_released'
    | 'interrupted_recovered'
    | 'plan_cancelled';
  stepId?: string | null;
  attemptId?: string | null;
  planStatus: AgentPlanStatus;
  stepStatus?: AgentPlanStepStatus | null;
  payloadJson: Record<string, unknown>;
  payloadHash: string;
  createdAt: string;
}

export interface AgentPlanBundle {
  plan: AgentPlanRecord;
  steps: AgentPlanStepRecord[];
  dependencies: AgentPlanStepDependencyRecord[];
  attempts: AgentPlanStepAttemptRecord[];
  checkpoints: AgentPlanCheckpointRecord[];
}

export interface AgentExecutionLeaseRecord {
  leaseId: string;
  planId: string;
  epoch: number;
  ownerId: string;
  expiresAt: string;
  status: 'active' | 'released' | 'expired';
  acquiredAt: string;
  releasedAt?: string | null;
}

export interface AgentPlanLeaseGrant {
  lease: AgentExecutionLeaseRecord;
  token: string;
}

export interface AgentPlanLeaseProof {
  leaseId: string;
  epoch: number;
  ownerId: string;
  token: string;
}

export interface AgentPlanStepClaim {
  plan: AgentPlanRecord;
  step: AgentPlanStepRecord;
  attempt: AgentPlanStepAttemptRecord;
}

export interface AgentPlanError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ChapterReadinessMissingItem {
  code: string;
  label: string;
  blocking: boolean;
}

export interface ChapterReadinessResult {
  ready: boolean;
  score: number;
  missing: ChapterReadinessMissingItem[];
  warnings: string[];
  summary: string;
}
