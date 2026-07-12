import type { ChapterDraft } from './ai';
import type { ConstraintValidationResult } from './chapterConstraintValidation';
import type { ChapterDiffResult } from './chapterDiff';

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
  /** Stable lifecycle identity. For persisted chapter candidates this equals artifactId. */
  candidateId?: string;
  artifactId: string;
  proposal?: PlacementProposal;
  content: string;
  contentHash: string;
  wordCount: number;
  taskId: string;
  baseContent?: string;
  createdAt?: string;
  constraintValidation?: ConstraintValidationResult;
  diff?: ChapterDiffResult;
}

export type CandidateGenerationStatus = 'idle' | 'generating' | 'validating' | 'cancelled' | 'failed';

export interface CandidateGenerationActivity {
  requestId: string;
  taskId?: string;
  candidateId?: string;
  novelId: string;
  chapterId: string;
  status: CandidateGenerationStatus;
  message?: string;
}

export interface CandidateReviewRecord {
  candidate: PlacementCandidate;
  target: import('./workspaceSafety').DraftResultMetadata;
  source?: 'ai_generated' | 'ai_regenerated';
  validationNote?: string;
  adopted?: boolean;
  invalidated?: boolean;
  invalidatedReason?: string;
}

export type CandidateLifecycleStatus =
  | 'empty'
  | 'generating'
  | 'validating'
  | 'ready'
  | 'blocked'
  | 'baseline_changed'
  | 'adopted'
  | 'invalidated'
  | 'cancelled'
  | 'failed'
  | 'read_failed'
  | 'diff_failed'
  | 'empty_content'
  | 'identity_mismatch';

export interface CandidateLifecycleContext {
  record: CandidateReviewRecord | null;
  candidate: PlacementCandidate | null;
  candidateId?: string;
  candidateChapterId?: string;
  targetChapterId?: string;
  content: string;
  baseContent?: string;
  baseDraftId?: string;
  baseDraftVersion?: number;
  baseContentHash?: string;
  constraintStatus?: ConstraintValidationResult['status'];
  generation: CandidateGenerationActivity | null;
  status: CandidateLifecycleStatus;
  canAdopt: boolean;
  cannotAdoptReason?: string;
  baselineChanged: boolean;
  diffUsesFrozenBaseline: boolean;
}
