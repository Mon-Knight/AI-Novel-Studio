export type AutonomousAutomationMode = 'draft_night' | 'quality_gate' | 'full_auto';
export type AutonomousBookRunStatus =
  'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
export type AutonomousRunAttemptStatus =
  'claimed' | 'candidate_ready' | 'adopted' | 'confirmed' | 'failed' | 'cancelled' | 'abandoned';

export interface AutonomousRunWindow {
  startMinute: number;
  endMinute: number;
  utcOffsetMinutes: number;
}

export interface AutonomousAutomationPolicy {
  schemaVersion: 1;
  mode: AutonomousAutomationMode;
  maxChapters: number;
  maxConsecutiveFailures: number;
  maxRetriesPerChapter: number;
  minimumSuccessfulExperts: number;
  minimumAverageScore: number;
  minimumAcceptanceRate: number;
  autoConfirmAnalysis: boolean;
  dailyTokenBudget?: number;
  bookTokenBudget?: number;
  dailyCostBudgetUsd?: number;
  bookCostBudgetUsd?: number;
  runWindow?: AutonomousRunWindow;
}

export interface AutonomousBookRun {
  runId: string;
  operationId: string;
  requestHash: string;
  novelId: string;
  planId: string;
  mode: AutonomousAutomationMode;
  policy: AutonomousAutomationPolicy;
  policyHash: string;
  status: AutonomousBookRunStatus;
  stateRevision: number;
  nextChapterNumber: number;
  totalChapters: number;
  completedChapters: number;
  tokenInput: number;
  tokenOutput: number;
  costUsd: number;
  usageDay: string;
  dailyTokenInput: number;
  dailyTokenOutput: number;
  dailyCostUsd: number;
  consecutiveFailures: number;
  pauseReason?: string;
  error?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  pausedAt?: string;
  completedAt?: string;
}

export interface AutonomousRunLease {
  leaseId: string;
  runId: string;
  novelId: string;
  epoch: number;
  ownerId: string;
  expiresAt: string;
  status: 'active' | 'released' | 'expired';
  acquiredAt: string;
  renewedAt?: string;
  releasedAt?: string;
}

export interface AutonomousRunLeaseProof {
  leaseId: string;
  epoch: number;
  token: string;
}

export interface AutonomousRunLeaseGrant {
  lease: AutonomousRunLease;
  token: string;
}

export interface AutonomousRunChapterAttempt {
  attemptId: string;
  runId: string;
  novelId: string;
  chapterId: string;
  chapterNumber: number;
  attemptNumber: number;
  operationId: string;
  leaseId: string;
  leaseEpoch: number;
  status: AutonomousRunAttemptStatus;
  estimatedTokens: number;
  estimatedCostUsd: number;
  tokenInput?: number;
  tokenOutput?: number;
  costUsd?: number;
  candidateDraftId?: string;
  adoptedDraftId?: string;
  reviewSessionId?: string;
  successfulExperts?: number;
  averageScore?: number;
  acceptanceRate?: number;
  analysisConfirmed: boolean;
  decision?: Record<string, unknown>;
  decisionHash?: string;
  error?: Record<string, unknown>;
  claimedAt: string;
  finishedAt?: string;
}

export interface AutonomousRunChapterClaim {
  run: AutonomousBookRun;
  attempt: AutonomousRunChapterAttempt;
  chapterPlan: Record<string, unknown>;
}

export interface FinishAutonomousRunChapterResult {
  run: AutonomousBookRun;
  attempt: AutonomousRunChapterAttempt;
  decision: Record<string, unknown>;
  replayed: boolean;
}

export interface AutonomousSchedulerCapability {
  persistent: boolean;
  runtime: 'tauri' | 'browser';
  reason?: string;
}

export interface AutonomousSchedulerSnapshot {
  capability: AutonomousSchedulerCapability;
  run: AutonomousBookRun | null;
  attempts: AutonomousRunChapterAttempt[];
  workerActive: boolean;
  busy: boolean;
  error?: string;
}
