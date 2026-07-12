import type { ChapterDraft } from './ai';

export interface PlacementTarget {
  targetType: string;
  targetId: string;
  novelId: string;
  chapterId?: string;
  draftId?: string;
  action: string;
  expectedVersion?: number;
  expectedHash?: string;
  sourcePriority: 1 | 2 | 3 | 4;
  confidence: number;
  reason: string;
  isReady: boolean;
}

export interface PlacementProposal {
  proposalId: string;
  artifactId: string;
  parentProposalId?: string;
  schemaVersion: number;
  targets: PlacementTarget[];
  confidence: number;
  reasons: string[];
  warnings: string[];
  unresolvedItems: string[];
  projectRevisionHash: string;
  createdAt: string;
}

export interface ProposalValidation {
  proposalId: string;
  stale: boolean;
  reason?: string;
  currentProjectRevisionHash: string;
}

export interface ApplyOperation {
  applyOperationId: string;
  operationIndex: number;
  targetType: string;
  targetId: string;
  action: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  expectedVersion?: number;
  expectedHash?: string;
}

export type ApplyPlanStatus = 'draft' | 'validated' | 'blocked' | 'ready' | 'applying'
  | 'completed' | 'failed' | 'commit_unknown' | 'cancelled';

export interface ApplyPlan {
  planId: string;
  proposalId: string;
  artifactId: string;
  parentPlanId?: string;
  schemaVersion: number;
  operations: ApplyOperation[];
  dependencies: Array<{ operationId: string; dependsOnOperationId: string }>;
  expectedVersions: Record<string, number | null>;
  expectedHashes: Record<string, string | null>;
  conflicts: Array<{ code: string; message: string }>;
  operationId: string;
  requestHash: string;
  status: ApplyPlanStatus;
  result?: unknown;
  createdAt: string;
  completedAt?: string;
}

export interface ArtifactTargetLink {
  linkId: string;
  artifactId: string;
  planId: string;
  applyOperationId: string;
  targetType: string;
  targetId: string;
  targetVersion?: number;
  targetHash?: string;
  operationId: string;
  resultMetadata?: unknown;
  createdAt: string;
}

export interface ApplyExecutionResult {
  planId: string;
  operationId: string;
  status: ApplyPlanStatus;
  targetLinks: ArtifactTargetLink[];
  result: { draft: ChapterDraft; contentHash: string } | unknown;
  idempotentReplay: boolean;
}

export interface PlacementCandidate {
  artifactId: string;
  proposal: PlacementProposal;
  content: string;
  contentHash: string;
  wordCount: number;
  taskId: string;
}
