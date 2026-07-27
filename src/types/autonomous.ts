/**
 * Autonomous Generation Type Definitions
 * v2.7.0 - Phase 0: Autonomous Task Scheduler Foundation
 */

export type AutonomousJobStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AutonomousActionType =
  | 'auto_generate'
  | 'auto_quality_check'
  | 'auto_adopt'
  | 'auto_fix'
  | 'auto_retry'
  | 'auto_pause'
  | 'auto_summary'
  | 'continuity_check'
  | 'continuity_warning'
  | 'expert_review'
  | 'skip_chapter';

export interface AutonomousGenerationJob {
  id: string;
  novelId: string;
  operationId: string;
  status: AutonomousJobStatus;
  totalChapters: number;
  completedChapters: number;
  currentChapterId: string | null;
  currentChapterAttempt: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  estimatedCostUsd: number;
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  pausedReason: string | null;
  pausedChapterId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QualityThresholds {
  novelId: string;
  minTotalScore: number;
  minLogicScore: number;
  minSettingScore: number;
  minCharacterScore: number;
  minContinuityScore: number;
  minLanguageScore: number;
  minPacingScore: number;
  maxRetryAttempts: number;
  maxCriticalIssues: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutonomousAction {
  id: string;
  jobId: string;
  novelId: string;
  chapterId: string;
  actionType: AutonomousActionType;
  qualityScore: number | null;
  qualityReportId: string | null;
  decisionReason: string;
  success: boolean;
  errorMessage: string | null;
  tokensUsed: number | null;
  durationMs: number | null;
  createdAt: string;
}

export interface ChapterGenerationLock {
  chapterId: string;
  jobId: string;
  lockedBy: string;
  lockedAt: string;
  expiresAt: string;
}

// ==================== Command Parameters ====================

export interface CreateAutonomousJobParams {
  novelId: string;
  totalChapters: number;
}

export interface UpdateAutonomousJobStatusParams {
  jobId: string;
  status: AutonomousJobStatus;
  completedAt?: string | null;
}

export interface UpdateAutonomousJobProgressParams {
  jobId: string;
  completedChapters: number;
  currentChapterId: string | null;
  currentChapterAttempt: number;
  /** Token deltas recorded by this operation. */
  tokensInput?: number;
  tokensOutput?: number;
  estimatedCostUsd: number;
}

export interface PauseAutonomousJobParams {
  jobId: string;
  reason: string;
  chapterId: string | null;
}

export interface SaveQualityThresholdsParams {
  novelId: string;
  minTotalScore?: number;
  minLogicScore?: number;
  minSettingScore?: number;
  minCharacterScore?: number;
  minContinuityScore?: number;
  minLanguageScore?: number;
  minPacingScore?: number;
  maxRetryAttempts?: number;
  maxCriticalIssues?: number;
}

export interface LogAutonomousActionParams {
  jobId: string;
  novelId: string;
  chapterId: string;
  actionType: AutonomousActionType;
  qualityScore?: number | null;
  qualityReportId?: string | null;
  decisionReason: string;
  success: boolean;
  errorMessage?: string | null;
  tokensUsed?: number | null;
  durationMs?: number | null;
}

export interface AcquireChapterLockParams {
  chapterId: string;
  jobId: string;
  lockedBy: string;
  ttlSeconds: number;
}

export interface ReleaseChapterLockParams {
  chapterId: string;
  jobId: string;
  lockedBy: string;
}
