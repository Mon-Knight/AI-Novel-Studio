import { isTauriRuntime, tauriInvoke } from '../tauri/runtime';
import type {
  AutonomousAutomationMode,
  AutonomousAutomationPolicy,
  AutonomousBookRun,
  AutonomousRunChapterAttempt,
  AutonomousRunChapterClaim,
  AutonomousRunLease,
  AutonomousRunLeaseGrant,
  AutonomousRunLeaseProof,
  AutonomousSchedulerCapability,
  FinishAutonomousRunChapterResult,
} from '../../types/autonomousScheduler';
import type { AutonomousStoryPlan } from '../../types/autonomousCreation';

export class PersistentSchedulerUnavailableError extends Error {
  readonly code = 'AUTONOMOUS_SCHEDULER_DESKTOP_REQUIRED';

  constructor() {
    super('跨进程无人值守调度仅在桌面版可用；浏览器模式不会伪造持久任务。');
    this.name = 'PersistentSchedulerUnavailableError';
  }
}

function requireDesktop(): void {
  if (!isTauriRuntime()) throw new PersistentSchedulerUnavailableError();
}

export function createDefaultAutonomousPolicy(
  plan: AutonomousStoryPlan,
  mode: AutonomousAutomationMode = 'draft_night',
): AutonomousAutomationPolicy {
  return {
    schemaVersion: 1,
    mode,
    maxChapters: plan.chapters.length,
    maxConsecutiveFailures: 3,
    maxRetriesPerChapter: 2,
    minimumSuccessfulExperts: 4,
    minimumAverageScore: 80,
    minimumAcceptanceRate: 0.75,
    autoConfirmAnalysis: mode === 'full_auto',
    dailyTokenBudget: 500_000,
    bookTokenBudget: Math.max(500_000, plan.chapters.length * 15_000),
    dailyCostBudgetUsd: 25,
    bookCostBudgetUsd: Math.max(25, plan.chapters.length * 0.5),
  };
}

async function invokeInput<T>(command: string, input: Record<string, unknown>): Promise<T> {
  requireDesktop();
  return tauriInvoke<T>(command, { input });
}

export const autonomousSchedulerService = {
  capability(): AutonomousSchedulerCapability {
    return isTauriRuntime()
      ? { persistent: true, runtime: 'tauri' }
      : {
          persistent: false,
          runtime: 'browser',
          reason: '浏览器开发模式不创建跨进程 lease；队列仅可在当前页面前台临时运行。',
        };
  },

  createRun(input: {
    operationId: string;
    novelId: string;
    planId: string;
    policy: AutonomousAutomationPolicy;
  }): Promise<AutonomousBookRun> {
    return invokeInput('create_autonomous_book_run', input);
  },

  getRun(runId: string): Promise<AutonomousBookRun | null> {
    return invokeInput('get_autonomous_book_run', { runId });
  },

  listRuns(novelId: string, limit = 50): Promise<AutonomousBookRun[]> {
    return invokeInput('list_autonomous_book_runs', { novelId, limit });
  },

  acquireLease(runId: string, ownerId: string, ttlSeconds = 90): Promise<AutonomousRunLeaseGrant> {
    return invokeInput('acquire_autonomous_run_lease', { runId, ownerId, ttlSeconds });
  },

  heartbeat(
    runId: string,
    lease: AutonomousRunLeaseProof,
    ttlSeconds = 90,
  ): Promise<AutonomousRunLease> {
    return invokeInput('heartbeat_autonomous_run', { runId, lease, ttlSeconds });
  },

  claimChapter(input: {
    runId: string;
    lease: AutonomousRunLeaseProof;
    estimatedTokens: number;
    estimatedCostUsd: number;
  }): Promise<AutonomousRunChapterClaim> {
    return invokeInput('claim_autonomous_run_chapter', input);
  },

  finishChapter(input: {
    runId: string;
    attemptId: string;
    lease: AutonomousRunLeaseProof;
    outcome: 'candidate_ready' | 'adopted' | 'confirmed' | 'failed' | 'cancelled';
    tokenInput?: number;
    tokenOutput?: number;
    costUsd?: number;
    candidateDraftId?: string;
    adoptedDraftId?: string;
    reviewSessionId?: string;
    successfulExperts?: number;
    averageScore?: number;
    acceptanceRate?: number;
    analysisConfirmed?: boolean;
    error?: Record<string, unknown>;
  }): Promise<FinishAutonomousRunChapterResult> {
    return invokeInput('finish_autonomous_run_chapter', input);
  },

  promoteAttempt(input: {
    operationId: string;
    runId: string;
    attemptId: string;
    expectedRevision: number;
    outcome: 'adopted' | 'confirmed';
    adoptedDraftId: string;
    analysisConfirmed?: boolean;
    userConfirmed: boolean;
  }): Promise<FinishAutonomousRunChapterResult> {
    return invokeInput('promote_autonomous_run_attempt', input);
  },

  listAttempts(runId: string, limit = 100): Promise<AutonomousRunChapterAttempt[]> {
    return invokeInput('list_autonomous_run_attempts', { runId, limit });
  },

  pauseRun(
    operationId: string,
    runId: string,
    expectedRevision: number,
    reason?: string,
  ): Promise<AutonomousBookRun> {
    return invokeInput('pause_autonomous_book_run', {
      operationId,
      runId,
      expectedRevision,
      reason,
    });
  },

  resumeRun(
    operationId: string,
    runId: string,
    expectedRevision: number,
  ): Promise<AutonomousBookRun> {
    return invokeInput('resume_autonomous_book_run', { operationId, runId, expectedRevision });
  },

  stopRun(
    operationId: string,
    runId: string,
    expectedRevision: number,
    reason?: string,
  ): Promise<AutonomousBookRun> {
    return invokeInput('stop_autonomous_book_run', {
      operationId,
      runId,
      expectedRevision,
      reason,
    });
  },

  recoverInterruptedRuns(): Promise<AutonomousBookRun[]> {
    requireDesktop();
    return tauriInvoke('recover_interrupted_autonomous_runs');
  },
};
