import type { ChapterDraft } from '../../types/ai';
import type { AutonomousStoryPlan } from '../../types/autonomousCreation';
import type {
  AutonomousAutomationPolicy,
  AutonomousBookRun,
  AutonomousSchedulerSnapshot,
} from '../../types/autonomousScheduler';
import { autonomousSchedulerService as scheduler } from './autonomousSchedulerService';
import { autonomousPlanPersistence } from './autonomousPersistence';
import { submitProductionAiEntry } from './productionAiEntryService';
import { taskSessionAdapter } from '../dsh/taskSessionAdapter';
import { generateId } from '../database/db';

/** UI subscription/projection only. The pending IPC represents one native root,
 * not a renderer chapter loop, recovery timer or transferable authority. */
export class NativeAutonomousScheduler {
  private readonly snapshots = new Map<string, AutonomousSchedulerSnapshot>();
  private readonly listeners = new Set<() => void>();
  private readonly pending = new Map<
    string,
    { promise: Promise<void>; controller: AbortController }
  >();

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  snapshot(planId: string): AutonomousSchedulerSnapshot {
    let snapshot = this.snapshots.get(planId);
    if (!snapshot) {
      snapshot = {
        capability: scheduler.capability(),
        run: null,
        attempts: [],
        workerActive: false,
        busy: false,
      };
      this.snapshots.set(planId, snapshot);
    }
    return snapshot;
  }
  private publish(planId: string, change: Partial<AutonomousSchedulerSnapshot>) {
    this.snapshots.set(planId, { ...this.snapshot(planId), ...change });
    this.listeners.forEach((listener) => listener());
  }
  async refresh(novelId: string, planId: string) {
    const runs = await scheduler.listRuns(novelId, 50);
    const run = runs.find((run) => run.planId === planId) ?? null;
    const attempts = run ? await scheduler.listAttempts(run.runId, 100) : [];
    this.publish(planId, {
      run,
      attempts,
      workerActive: Boolean(run && this.pending.has(run.runId)),
      busy: false,
    });
    // A read, remount or restart never dispatches a model or claims a lease.
  }
  async recoverStartup() {
    const runs = await scheduler.recoverInterruptedRuns();
    for (const run of runs) this.publish(run.planId, { run, workerActive: false, busy: false });
  }
  private attach(run: AutonomousBookRun, explicitResume = false) {
    if (this.pending.has(run.runId)) return;
    const controller = new AbortController();
    const promise = (async () => {
      const plan = await autonomousPlanPersistence.getPlan(run.planId);
      if (!plan || plan.novelId !== run.novelId) throw new Error('调度计划不存在或作用域不一致。');
      const root = plan.runtimeSchedulerTasks?.find((task) => task.runId === run.runId);
      await submitProductionAiEntry({
        novelId: run.novelId,
        conversationId: root?.conversationId,
        modelSnapshot: root?.modelSnapshot,
        goal: explicitResume
          ? '明确继续本任务限定范围内的逐章创作；不得重放未知写入。'
          : '按已应用计划与有限调度策略逐章生成候选；没有有效任务授权时不得采用或应用总结。',
        entry: { kind: 'autonomous_scheduler', runId: run.runId, explicitResume },
        signal: controller.signal,
      });
    })()
      .catch((error: unknown) => {
        this.publish(run.planId, { error: error instanceof Error ? error.message : String(error) });
      })
      .finally(async () => {
        this.pending.delete(run.runId);
        await this.refresh(run.novelId, run.planId).catch((error: unknown) =>
          this.publish(run.planId, { error: String(error), workerActive: false, busy: false }),
        );
      });
    this.pending.set(run.runId, { promise, controller });
    this.publish(run.planId, { workerActive: true, busy: true, error: undefined });
  }
  async start(plan: AutonomousStoryPlan, policy: AutonomousAutomationPolicy) {
    const run = await scheduler.createRun({
      operationId: `autonomous-scheduler:${plan.planId}:${generateId()}`,
      novelId: plan.novelId,
      planId: plan.planId,
      policy,
    });
    this.publish(plan.planId, { run, attempts: [], error: undefined });
    this.attach(run);
    return run;
  }
  private async change(run: AutonomousBookRun, action: 'pause' | 'stop' | 'resume') {
    if (action !== 'resume') {
      this.pending.get(run.runId)?.controller.abort();
      const plan = await autonomousPlanPersistence.getPlan(run.planId);
      const root = plan?.runtimeSchedulerTasks?.find((task) => task.runId === run.runId);
      if (root) await taskSessionAdapter.cancel(root.conversationId);
    }
    const current = (await scheduler.getRun(run.runId)) ?? run;
    const operationId = `${action}:${run.runId}:${generateId()}`;
    const updated =
      action === 'pause'
        ? await scheduler.pauseRun(operationId, run.runId, current.stateRevision, 'user_paused')
        : action === 'stop'
          ? await scheduler.stopRun(operationId, run.runId, current.stateRevision, 'user_stopped')
          : await scheduler.resumeRun(operationId, run.runId, current.stateRevision);
    this.publish(run.planId, { run: updated, error: undefined });
    if (action === 'resume') this.attach(updated, true);
    return updated;
  }
  async waitForRun(runId: string) {
    await this.pending.get(runId)?.promise;
    const run = await scheduler.getRun(runId);
    if (!run || run.status !== 'completed')
      throw new Error('逐章任务已停止或等待处理；已保存候选以权威事实为准。');
  }
  pause(run: AutonomousBookRun) {
    return this.change(run, 'pause');
  }
  resume(run: AutonomousBookRun) {
    return this.change(run, 'resume');
  }
  stop(run: AutonomousBookRun) {
    return this.change(run, 'stop');
  }
  async promoteUserAdoptedDraft(draft: ChapterDraft) {
    for (const run of await scheduler.listRuns(draft.novelId, 50)) {
      const attempt = [...(await scheduler.listAttempts(run.runId, 100))]
        .reverse()
        .find(
          (attempt) =>
            attempt.status === 'candidate_ready' &&
            attempt.chapterId === draft.chapterId &&
            attempt.candidateDraftId === draft.id,
        );
      if (!attempt) continue;
      const current = (await scheduler.getRun(run.runId)) ?? run;
      const promoted = await scheduler.promoteAttempt({
        operationId: `user-promote:${attempt.attemptId}:${draft.id}`,
        runId: run.runId,
        attemptId: attempt.attemptId,
        expectedRevision: current.stateRevision,
        outcome: 'adopted',
        adoptedDraftId: draft.id,
        analysisConfirmed: false,
        userConfirmed: true,
      });
      this.publish(run.planId, { run: promoted.run });
      if (promoted.run.status === 'queued') this.attach(promoted.run);
      return true;
    }
    return false;
  }
}
