import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutonomousBookRun } from '../../types/autonomousScheduler';
import type { AutonomousStoryPlan } from '../../types/autonomousCreation';
const fixture = vi.hoisted(() => ({
  submit: vi.fn(),
  cancel: vi.fn(),
  getPlan: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  attempts: vi.fn(),
  recover: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
  promote: vi.fn(),
}));
vi.mock('./productionAiEntryService', () => ({ submitProductionAiEntry: fixture.submit }));
vi.mock('./autonomousPersistence', () => ({
  autonomousPlanPersistence: { getPlan: fixture.getPlan },
}));
vi.mock('../dsh/taskSessionAdapter', () => ({ taskSessionAdapter: { cancel: fixture.cancel } }));
vi.mock('../database/db', () => ({ generateId: () => 'operation' }));
vi.mock('./autonomousSchedulerService', () => ({
  autonomousSchedulerService: {
    capability: () => ({ persistent: true, runtime: 'tauri' }),
    createRun: fixture.create,
    listRuns: fixture.list,
    getRun: fixture.get,
    listAttempts: fixture.attempts,
    recoverInterruptedRuns: fixture.recover,
    pauseRun: fixture.pause,
    resumeRun: fixture.resume,
    stopRun: fixture.stop,
    promoteAttempt: fixture.promote,
  },
}));
import { NativeAutonomousScheduler } from './nativeAutonomousScheduler';
const run = {
  runId: 'run',
  novelId: 'novel',
  planId: 'plan',
  stateRevision: 1,
  status: 'queued',
} as AutonomousBookRun;
const plan = {
  planId: 'plan',
  novelId: 'novel',
  runtimeSchedulerTasks: [
    {
      runId: 'run',
      conversationId: 'root',
      modelSnapshot: {
        providerId: 'mock',
        modelId: 'offline',
        runtimeMode: 'mock',
        capturedAt: 'frozen',
        capabilities: [],
        options: {},
      },
    },
  ],
  // The scheduler only projects these frozen references in this isolated unit fixture.
} as unknown as AutonomousStoryPlan;
beforeEach(() => {
  vi.clearAllMocks();
  fixture.create.mockResolvedValue(run);
  fixture.get.mockResolvedValue(run);
  fixture.list.mockResolvedValue([run]);
  fixture.attempts.mockResolvedValue([]);
  fixture.recover.mockResolvedValue([run]);
  fixture.getPlan.mockResolvedValue(plan);
  fixture.cancel.mockResolvedValue(true);
  fixture.submit.mockResolvedValue({
    conversationId: 'root',
    run: { status: 'completed' },
    artifactIds: [],
  });
});
describe('native scheduler projection ownership', () => {
  it('recovery and refresh only project facts and never dispatch a model or background queue', async () => {
    const scheduler = new NativeAutonomousScheduler();
    await scheduler.recoverStartup();
    await scheduler.refresh('novel', 'plan');
    expect(fixture.submit).not.toHaveBeenCalled();
    expect(scheduler.snapshot('plan').workerActive).toBe(false);
    expect(scheduler.snapshot('plan').run?.status).toBe('queued');
  });
  it('start submits exactly one bounded native root and preserves the frozen model/task reference', async () => {
    const scheduler = new NativeAutonomousScheduler();
    await scheduler.start(plan, {
      mode: 'draft_night',
      maxChapters: 2,
    } as AutonomousBookRun['policy']);
    await vi.waitFor(() => expect(fixture.submit).toHaveBeenCalledOnce());
    expect(fixture.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'root',
        modelSnapshot: plan.runtimeSchedulerTasks![0].modelSnapshot,
        entry: { kind: 'autonomous_scheduler', runId: 'run', explicitResume: false },
      }),
    );
    await vi.waitFor(() => expect(scheduler.snapshot('plan').workerActive).toBe(false));
  });
  it('stop cancels the same native root and keeps authoritative stopped state, not an all-undone claim', async () => {
    let finish!: () => void;
    fixture.submit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    fixture.stop.mockImplementation(async () => {
      const stopped = { ...run, status: 'stopped' };
      fixture.get.mockResolvedValue(stopped);
      fixture.list.mockResolvedValue([stopped]);
      return stopped;
    });
    const scheduler = new NativeAutonomousScheduler();
    await scheduler.start(plan, {
      mode: 'draft_night',
      maxChapters: 2,
    } as AutonomousBookRun['policy']);
    await vi.waitFor(() => expect(fixture.submit).toHaveBeenCalledOnce());
    await scheduler.stop(run);
    expect(fixture.cancel).toHaveBeenCalledWith('root');
    expect(fixture.submit.mock.calls[0][0].signal.aborted).toBe(true);
    finish();
    await vi.waitFor(() => expect(scheduler.snapshot('plan').workerActive).toBe(false));
    expect(scheduler.snapshot('plan').run?.status).toBe('stopped');
    expect(fixture.submit).toHaveBeenCalledTimes(1);
  });
  it('host failure remains visible and never reattaches automatically on the next read', async () => {
    fixture.submit.mockRejectedValueOnce(new Error('COMMIT_OUTCOME_UNKNOWN'));
    const scheduler = new NativeAutonomousScheduler();
    await scheduler.start(plan, {
      mode: 'draft_night',
      maxChapters: 2,
    } as AutonomousBookRun['policy']);
    await vi.waitFor(() =>
      expect(scheduler.snapshot('plan').error).toContain('COMMIT_OUTCOME_UNKNOWN'),
    );
    await scheduler.refresh('novel', 'plan');
    expect(fixture.submit).toHaveBeenCalledTimes(1);
  });
});
