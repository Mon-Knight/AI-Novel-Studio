import { appLogger } from '../observability/appLogger';
import { generateId } from '../database/db';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import type { ChapterDraft } from '../../types/ai';
import type {
  AutonomousChapterPlan,
  AutonomousChapterRun,
  AutonomousStoryPlan,
} from '../../types/autonomousCreation';
import type { MultiAgentSessionBundle } from '../../types/multiAgent';
import type {
  AutonomousAutomationPolicy,
  AutonomousBookRun,
  AutonomousRunLeaseProof,
  AutonomousSchedulerSnapshot,
} from '../../types/autonomousScheduler';
import { autonomousSchedulerService } from './autonomousSchedulerService';
import { autonomousChapterRuntimeLoader } from './autonomousChapterRuntimeLoader';

type SchedulerService = typeof autonomousSchedulerService;

interface SchedulerWorkerDependencies {
  scheduler: SchedulerService;
  getPlan(planId: string): Promise<AutonomousStoryPlan | null>;
  generateCandidate(
    planId: string,
    signal: AbortSignal,
    selection: 'next_unadopted' | 'next_missing_candidate',
  ): Promise<{
    plan: AutonomousStoryPlan;
    chapter: AutonomousChapterPlan;
    run: AutonomousChapterRun;
  }>;
  adoptDraft(draftId: string, chapterId: string): Promise<ChapterDraft>;
  getReview(sessionId: string): Promise<MultiAgentSessionBundle | null>;
  confirmAnalysis(
    planId: string,
    chapterId: string,
    draftId: string,
    signal: AbortSignal,
  ): Promise<void>;
  generateId(): string;
  setInterval(callback: () => void, delay: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
}

interface ActiveWorker {
  controller: AbortController;
  promise: Promise<void>;
}

const RECOVERY_SWEEP_INTERVAL_MS = 15_000;

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function errorCode(reason: unknown): string | undefined {
  if (!reason || typeof reason !== 'object') return undefined;
  return typeof (reason as { code?: unknown }).code === 'string'
    ? (reason as { code: string }).code
    : undefined;
}

function proof(
  grant: Awaited<ReturnType<SchedulerService['acquireLease']>>,
): AutonomousRunLeaseProof {
  return { leaseId: grant.lease.leaseId, epoch: grant.lease.epoch, token: grant.token };
}

function defaultSnapshot(): AutonomousSchedulerSnapshot {
  return {
    capability: autonomousSchedulerService.capability(),
    run: null,
    attempts: [],
    workerActive: false,
    busy: false,
  };
}

export function estimateChapterReservation(
  plan: AutonomousStoryPlan,
  chapterNumber: number,
): {
  estimatedTokens: number;
  estimatedCostUsd: number;
} {
  const chapter = plan.chapters.find((item) => item.chapterNumber === chapterNumber);
  const targetWords = chapter?.targetWordCount ?? plan.brief.targetWordsPerChapter ?? 2_400;
  const estimatedTokens = Math.max(2_000, Math.min(10_000_000, Math.ceil(targetWords * 3)));
  // Frozen conservative ceiling used only for scheduler reservation; the request ledger remains authoritative.
  const estimatedCostUsd = Math.round((estimatedTokens / 1_000_000) * 30 * 10000) / 10000;
  return { estimatedTokens, estimatedCostUsd };
}

export class AutonomousSchedulerWorker {
  private readonly ownerId: string;
  private readonly active = new Map<string, ActiveWorker>();
  private readonly snapshots = new Map<string, AutonomousSchedulerSnapshot>();
  private readonly listeners = new Set<() => void>();
  private startupPromise: Promise<void> | null = null;
  private recoverySweepPromise: Promise<void> | null = null;
  private recoveryInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly dependencies: SchedulerWorkerDependencies) {
    this.ownerId = `desktop-process:${dependencies.generateId()}`;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(planId: string): AutonomousSchedulerSnapshot {
    const existing = this.snapshots.get(planId);
    if (existing) return existing;
    const initial = defaultSnapshot();
    this.snapshots.set(planId, initial);
    return initial;
  }

  private publish(planId: string, update: Partial<AutonomousSchedulerSnapshot>): void {
    const current = this.snapshot(planId);
    this.snapshots.set(planId, { ...current, ...update });
    this.listeners.forEach((listener) => listener());
  }

  async refresh(novelId: string, planId: string): Promise<void> {
    const capability = this.dependencies.scheduler.capability();
    if (!capability.persistent) {
      this.publish(planId, { capability, run: null, attempts: [], workerActive: false });
      return;
    }
    const runs = await this.dependencies.scheduler.listRuns(novelId, 50);
    const run = runs.find((item) => item.planId === planId) ?? null;
    const attempts = run ? await this.dependencies.scheduler.listAttempts(run.runId, 100) : [];
    this.publish(planId, {
      capability,
      run,
      attempts,
      workerActive: run ? this.active.has(run.runId) : false,
      error: undefined,
    });
    if (run?.status === 'queued') this.attach(run);
  }

  private recoverAndAttach(): Promise<void> {
    if (this.recoverySweepPromise) return this.recoverySweepPromise;
    const sweep = this.dependencies.scheduler
      .recoverInterruptedRuns()
      .then((runs) => {
        runs.forEach((run) => {
          this.publish(run.planId, { run, error: undefined });
          this.attach(run);
        });
      })
      .catch((reason) => {
        appLogger.warn('[AutonomousScheduler] 启动恢复失败', reason);
      })
      .finally(() => {
        if (this.recoverySweepPromise === sweep) this.recoverySweepPromise = null;
      });
    this.recoverySweepPromise = sweep;
    return sweep;
  }

  recoverStartup(): Promise<void> {
    if (!this.dependencies.scheduler.capability().persistent) return Promise.resolve();
    if (this.startupPromise) return this.startupPromise;
    this.startupPromise = this.recoverAndAttach().then(() => {
      if (this.recoveryInterval !== null) return;
      this.recoveryInterval = this.dependencies.setInterval(() => {
        void this.recoverAndAttach();
      }, RECOVERY_SWEEP_INTERVAL_MS);
    });
    return this.startupPromise;
  }

  async start(
    plan: AutonomousStoryPlan,
    policy: AutonomousAutomationPolicy,
  ): Promise<AutonomousBookRun> {
    const run = await this.dependencies.scheduler.createRun({
      operationId: `autonomous-scheduler:${plan.planId}:${this.dependencies.generateId()}`,
      novelId: plan.novelId,
      planId: plan.planId,
      policy,
    });
    this.publish(plan.planId, { run, attempts: [], busy: false, error: undefined });
    this.attach(run);
    return run;
  }

  private attach(run: AutonomousBookRun): void {
    if (this.active.has(run.runId) || !['queued', 'running'].includes(run.status)) return;
    const controller = new AbortController();
    const promise = this.execute(run, controller.signal)
      .catch((reason) => {
        if (!controller.signal.aborted) {
          this.publish(run.planId, { error: message(reason) });
          appLogger.warn('[AutonomousScheduler] worker stopped', {
            runId: run.runId,
            code: errorCode(reason),
          });
        }
      })
      .finally(() => {
        if (this.active.get(run.runId)?.controller === controller) this.active.delete(run.runId);
        this.publish(run.planId, { workerActive: false, busy: false });
      });
    this.active.set(run.runId, { controller, promise });
    this.publish(run.planId, { workerActive: true, error: undefined });
  }

  private async pauseOwnedRunAfterFailure(
    run: AutonomousBookRun,
    lease: AutonomousRunLeaseProof,
    reason: unknown,
  ): Promise<AutonomousBookRun | null> {
    try {
      // Revalidate the lease immediately before the state transition. A worker that has already
      // been fenced by a newer epoch must never pause the replacement owner's run.
      await this.dependencies.scheduler.heartbeat(run.runId, lease, 90);
      const latest = await this.dependencies.scheduler.getRun(run.runId);
      if (!latest || latest.status !== 'running') return latest;
      const reasonCode = (errorCode(reason) ?? 'unexpected')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_')
        .slice(0, 160);
      const paused = await this.dependencies.scheduler.pauseRun(
        `scheduler-worker-error:${this.dependencies.generateId()}`,
        latest.runId,
        latest.stateRevision,
        `worker_error:${reasonCode}`,
      );
      this.publish(paused.planId, { run: paused, busy: false, error: message(reason) });
      return paused;
    } catch (cleanupReason) {
      appLogger.warn('[AutonomousScheduler] owned-run cleanup skipped', {
        runId: run.runId,
        code: errorCode(cleanupReason),
      });
      return null;
    }
  }

  private async execute(initial: AutonomousBookRun, signal: AbortSignal): Promise<void> {
    const grant = await this.dependencies.scheduler.acquireLease(initial.runId, this.ownerId, 90);
    const lease = proof(grant);
    let run = initial;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      run = (await this.dependencies.scheduler.getRun(initial.runId)) ?? initial;
      this.publish(run.planId, { run, workerActive: true });
      heartbeat = this.dependencies.setInterval(() => {
        void this.dependencies.scheduler.heartbeat(run.runId, lease, 90).catch((reason) => {
          appLogger.warn('[AutonomousScheduler] heartbeat failed', {
            runId: run.runId,
            code: errorCode(reason),
          });
        });
      }, 30_000);
      while (!signal.aborted && run.status === 'running') {
        const plan = await this.dependencies.getPlan(run.planId);
        if (!plan || plan.status !== 'applied')
          throw new Error('无人值守任务绑定的全书计划不可用。');
        const reservation = estimateChapterReservation(plan, run.nextChapterNumber);
        let claimed: Awaited<ReturnType<SchedulerService['claimChapter']>>;
        try {
          claimed = await this.dependencies.scheduler.claimChapter({
            runId: run.runId,
            lease,
            ...reservation,
          });
        } catch (reason) {
          if (
            [
              'AUTONOMOUS_RUN_BUDGET_EXCEEDED',
              'AUTONOMOUS_RUN_WINDOW_CLOSED',
              'AUTONOMOUS_RUN_POLICY_BLOCKED',
            ].includes(errorCode(reason) ?? '')
          ) {
            const latest = await this.dependencies.scheduler.getRun(run.runId);
            if (latest?.status === 'running') {
              run = await this.dependencies.scheduler.pauseRun(
                `scheduler-blocked:${run.runId}:${this.dependencies.generateId()}`,
                run.runId,
                latest.stateRevision,
                errorCode(reason)?.toLowerCase(),
              );
              this.publish(run.planId, { run, error: message(reason) });
              break;
            }
          }
          throw reason;
        }
        this.publish(run.planId, { run: claimed.run, busy: true });
        try {
          const claimedChapter = plan.chapters.find(
            (chapter) => chapter.id === claimed.attempt.chapterId,
          );
          if (!claimedChapter) throw new Error('调度 claim 引用的计划章节不存在。');
          const existingRun = [...(plan.chapterRuns ?? [])]
            .reverse()
            .find(
              (chapterRun) =>
                chapterRun.chapterId === claimed.attempt.chapterId &&
                Boolean(chapterRun.candidateDraftId ?? chapterRun.adoptedDraftId),
            );
          const generated = existingRun
            ? {
                plan,
                chapter: claimedChapter,
                run: {
                  ...existingRun,
                  candidateDraftId: existingRun.candidateDraftId ?? existingRun.adoptedDraftId,
                },
              }
            : await this.dependencies.generateCandidate(
                run.planId,
                signal,
                'next_missing_candidate',
              );
          if (
            generated.chapter.id !== claimed.attempt.chapterId ||
            !generated.run.candidateDraftId
          ) {
            throw new Error('调度 claim 与实际生成的章节候选不一致。');
          }
          const review = generated.run.reviewSessionId
            ? await this.dependencies.getReview(generated.run.reviewSessionId)
            : null;
          const consensus = review?.rounds[review.rounds.length - 1]?.consensus;
          const successfulExperts = consensus?.successfulExperts ?? 0;
          const averageScore = consensus?.averageScore ?? generated.run.averageScore ?? 0;
          const acceptanceRate = consensus?.acceptanceRate ?? generated.run.acceptanceRate ?? 0;
          const qualityPasses =
            successfulExperts >= run.policy.minimumSuccessfulExperts &&
            averageScore >= run.policy.minimumAverageScore &&
            acceptanceRate >= run.policy.minimumAcceptanceRate;
          let outcome: 'candidate_ready' | 'adopted' | 'confirmed' = 'candidate_ready';
          let adoptedDraftId: string | undefined;
          let analysisConfirmed = false;
          if (run.mode !== 'draft_night' && qualityPasses) {
            const adopted = await this.dependencies.adoptDraft(
              generated.run.candidateDraftId,
              generated.chapter.id,
            );
            adoptedDraftId = adopted.id;
            outcome = 'adopted';
            if (run.mode === 'full_auto') {
              await this.dependencies.confirmAnalysis(
                run.planId,
                generated.chapter.id,
                adopted.id,
                signal,
              );
              analysisConfirmed = true;
              outcome = 'confirmed';
            }
          }
          const finished = await this.dependencies.scheduler.finishChapter({
            runId: run.runId,
            attemptId: claimed.attempt.attemptId,
            lease,
            outcome,
            candidateDraftId: generated.run.candidateDraftId,
            adoptedDraftId,
            reviewSessionId: generated.run.reviewSessionId,
            successfulExperts,
            averageScore,
            acceptanceRate,
            analysisConfirmed,
          });
          run = finished.run;
        } catch (reason) {
          if (signal.aborted) throw reason;
          const failed = await this.dependencies.scheduler.finishChapter({
            runId: run.runId,
            attemptId: claimed.attempt.attemptId,
            lease,
            outcome: 'failed',
            error: { code: 'AUTONOMOUS_WORKER_FAILED', retryable: true },
          });
          run = failed.run;
        }
        const attempts = await this.dependencies.scheduler.listAttempts(run.runId, 100);
        this.publish(run.planId, { run, attempts, busy: false });
      }
    } catch (reason) {
      if (!signal.aborted) {
        const paused = await this.pauseOwnedRunAfterFailure(run, lease, reason);
        if (paused) run = paused;
      }
      throw reason;
    } finally {
      if (heartbeat !== null) this.dependencies.clearInterval(heartbeat);
      const latest = await this.dependencies.scheduler.getRun(run.runId).catch(() => null);
      if (latest) this.publish(run.planId, { run: latest, busy: false });
    }
  }

  private async changeState(
    run: AutonomousBookRun,
    action: 'pause' | 'resume' | 'stop',
  ): Promise<AutonomousBookRun> {
    if (action !== 'resume') this.active.get(run.runId)?.controller.abort();
    const operationId = `${action}:${run.runId}:${this.dependencies.generateId()}`;
    const current = (await this.dependencies.scheduler.getRun(run.runId)) ?? run;
    const updated =
      action === 'pause'
        ? await this.dependencies.scheduler.pauseRun(
            operationId,
            run.runId,
            current.stateRevision,
            'user_paused',
          )
        : action === 'resume'
          ? await this.dependencies.scheduler.resumeRun(
              operationId,
              run.runId,
              current.stateRevision,
            )
          : await this.dependencies.scheduler.stopRun(
              operationId,
              run.runId,
              current.stateRevision,
              'user_stopped',
            );
    this.publish(run.planId, { run: updated, error: undefined });
    if (action === 'resume') this.attach(updated);
    return updated;
  }

  pause(run: AutonomousBookRun): Promise<AutonomousBookRun> {
    return this.changeState(run, 'pause');
  }

  resume(run: AutonomousBookRun): Promise<AutonomousBookRun> {
    return this.changeState(run, 'resume');
  }

  stop(run: AutonomousBookRun): Promise<AutonomousBookRun> {
    return this.changeState(run, 'stop');
  }
}

export const autonomousSchedulerWorker = new AutonomousSchedulerWorker({
  scheduler: autonomousSchedulerService,
  async getPlan(planId) {
    const { autonomousPlanPersistence } = await import('./autonomousPersistence');
    return autonomousPlanPersistence.getPlan(planId);
  },
  async generateCandidate(planId, signal, selection) {
    return autonomousChapterRuntimeLoader.generateNextCandidate(planId, {
      signal,
      selection,
    });
  },
  async adoptDraft(draftId, chapterId) {
    return draftVersionService.adopt(draftId, chapterId);
  },
  async getReview(sessionId) {
    const { multiAgentService } = await import('../multi-agent/multiAgentRuntime');
    return multiAgentService.getSession(sessionId);
  },
  async confirmAnalysis(planId, chapterId, draftId, signal) {
    const postChapter = await import('./autonomousPostChapterRuntime');
    const draft = await draftVersionService.getById(chapterId, draftId);
    const chapter = await chapterRepository.getById(chapterId);
    if (!draft || !chapter) throw new Error('全自动收束缺少正式章节或采用稿。');
    await postChapter.runAutonomousPostChapterAnalysis(planId, draft, signal);
    await postChapter.autonomousPostChapterService.confirmAnalysis({ planId, chapter, draft });
  },
  generateId,
  setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
  clearInterval: (handle) => globalThis.clearInterval(handle),
});
