import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AutonomousStoryPlan } from '../../types/autonomousCreation';
import type {
  AutonomousAutomationMode,
  AutonomousAutomationPolicy,
  AutonomousBookRun,
} from '../../types/autonomousScheduler';
import { autonomousSchedulerService } from './autonomousSchedulerService';
import { AutonomousSchedulerWorker, estimateChapterReservation } from './autonomousSchedulerWorker';

function recoveryWorker(
  persistent: boolean,
  recoverInterruptedRuns: () => Promise<AutonomousBookRun[]>,
): AutonomousSchedulerWorker {
  const scheduler = {
    capability: () =>
      persistent
        ? ({ persistent: true, runtime: 'tauri' } as const)
        : ({ persistent: false, runtime: 'browser' } as const),
    recoverInterruptedRuns,
  } as unknown as typeof autonomousSchedulerService;

  return new AutonomousSchedulerWorker({
    scheduler,
    getPlan: async () => null,
    generateCandidate: async () => {
      throw new Error('unexpected candidate generation');
    },
    adoptDraft: async () => {
      throw new Error('unexpected draft adoption');
    },
    getReview: async () => null,
    confirmAnalysis: async () => undefined,
    generateId: () => 'startup-owner',
    setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
    clearInterval: () => undefined,
  });
}

function plan(): AutonomousStoryPlan {
  return {
    planId: 'plan-1',
    novelId: 'novel-1',
    status: 'applied',
    brief: { targetWordsPerChapter: 2400 },
    chapters: [{ id: 'chapter-1', chapterNumber: 1, targetWordCount: 2400 }],
  } as AutonomousStoryPlan;
}

function policy(mode: AutonomousAutomationMode): AutonomousAutomationPolicy {
  return {
    schemaVersion: 1,
    mode,
    maxChapters: 1,
    maxConsecutiveFailures: 3,
    maxRetriesPerChapter: 2,
    minimumSuccessfulExperts: 4,
    minimumAverageScore: 80,
    minimumAcceptanceRate: 0.75,
    autoConfirmAnalysis: mode === 'full_auto',
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('worker did not reach expected state');
}

async function executeMode(mode: AutonomousAutomationMode) {
  const story = plan();
  let run: AutonomousBookRun;
  let finishedOutcome = '';
  let adopted = 0;
  let confirmed = 0;
  let authorized = 0;
  let selection = '';
  const sideEffectOrder: string[] = [];
  const scheduler = {
    capability: () => ({ persistent: true as const, runtime: 'tauri' as const }),
    async createRun(input: { policy: AutonomousAutomationPolicy }) {
      run = {
        runId: `run-${mode}`,
        operationId: 'operation',
        requestHash: 'hash',
        novelId: story.novelId,
        planId: story.planId,
        mode,
        policy: input.policy,
        policyHash: 'policy-hash',
        status: 'queued',
        stateRevision: 1,
        nextChapterNumber: 1,
        totalChapters: 1,
        completedChapters: 0,
        tokenInput: 0,
        tokenOutput: 0,
        costUsd: 0,
        usageDay: '2026-07-28',
        dailyTokenInput: 0,
        dailyTokenOutput: 0,
        dailyCostUsd: 0,
        consecutiveFailures: 0,
        createdAt: '',
        updatedAt: '',
      };
      return run;
    },
    async acquireLease() {
      run = { ...run, status: 'running', stateRevision: 2 };
      return {
        lease: { leaseId: 'lease', runId: run.runId, novelId: run.novelId, epoch: 1 },
        token: '1234567890123456',
      };
    },
    async getRun() {
      return run;
    },
    async claimChapter() {
      return {
        run,
        attempt: { attemptId: 'attempt', chapterId: 'chapter-1' },
        chapterPlan: { id: 'chapter-1' },
      };
    },
    async finishChapter(input: { outcome: string }) {
      sideEffectOrder.push('finish');
      finishedOutcome = input.outcome;
      run = { ...run, status: 'completed', stateRevision: 3, completedChapters: 1 };
      return { run, attempt: {}, decision: {}, replayed: false };
    },
    async listAttempts() {
      return [];
    },
    async heartbeat() {
      return {};
    },
    async authorizeFullAutoAttempt() {
      authorized += 1;
      sideEffectOrder.push('authorize');
      return {
        run,
        attempt: {},
        authorizationId: 'full-auto-authorization',
        authorizationHash: 'authorization-hash',
        replayed: false,
      };
    },
  } as unknown as typeof autonomousSchedulerService;

  const worker = new AutonomousSchedulerWorker({
    scheduler,
    getPlan: async () => story,
    generateCandidate: async (_planId, _signal, candidateSelection) => {
      selection = candidateSelection;
      return {
        plan: story,
        chapter: story.chapters[0],
        run: {
          runId: 'chapter-run',
          operationId: 'chapter-operation',
          chapterId: 'chapter-1',
          chapterNumber: 1,
          status: 'candidate_ready',
          candidateDraftId: 'draft-1',
          reviewSessionId: 'review-1',
          plannedCharacterBeatIds: [],
          confirmedCharacterBeatIds: [],
          createdAt: '',
          updatedAt: '',
        },
      };
    },
    adoptDraft: async () => {
      adopted += 1;
      sideEffectOrder.push('adopt');
      return { id: 'draft-1', chapterId: 'chapter-1', isAdopted: true } as never;
    },
    getReview: async () =>
      ({
        session: {},
        rounds: [{ consensus: { successfulExperts: 6, averageScore: 90, acceptanceRate: 1 } }],
      }) as never,
    confirmAnalysis: async () => {
      confirmed += 1;
      sideEffectOrder.push('confirm');
    },
    generateId: () => 'id',
    setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
    clearInterval: () => undefined,
  });
  await worker.start(story, policy(mode));
  await waitFor(() => worker.snapshot(story.planId).run?.status === 'completed');
  return { finishedOutcome, adopted, confirmed, authorized, selection, sideEffectOrder };
}

test('scheduler worker keeps review modes as candidates and reserves adoption for full auto', async () => {
  assert.deepEqual(await executeMode('draft_night'), {
    finishedOutcome: 'candidate_ready',
    adopted: 0,
    confirmed: 0,
    authorized: 0,
    selection: 'next_missing_candidate',
    sideEffectOrder: ['finish'],
  });
  assert.deepEqual(await executeMode('quality_gate'), {
    finishedOutcome: 'candidate_ready',
    adopted: 0,
    confirmed: 0,
    authorized: 0,
    selection: 'next_missing_candidate',
    sideEffectOrder: ['finish'],
  });
  assert.deepEqual(await executeMode('full_auto'), {
    finishedOutcome: 'confirmed',
    adopted: 1,
    confirmed: 1,
    authorized: 1,
    selection: 'next_missing_candidate',
    sideEffectOrder: ['authorize', 'adopt', 'confirm', 'finish'],
  });
});

test('user adoption promotes the matching candidate with explicit confirmation and current CAS', async () => {
  const story = plan();
  const pausedRun = {
    runId: 'run-user-promotion',
    operationId: 'run-operation',
    requestHash: 'request-hash',
    novelId: story.novelId,
    planId: story.planId,
    mode: 'quality_gate',
    policy: policy('quality_gate'),
    policyHash: 'policy-hash',
    status: 'paused',
    stateRevision: 7,
    nextChapterNumber: 1,
    totalChapters: 1,
    completedChapters: 0,
    tokenInput: 0,
    tokenOutput: 0,
    costUsd: 0,
    usageDay: '2026-08-18',
    dailyTokenInput: 0,
    dailyTokenOutput: 0,
    dailyCostUsd: 0,
    consecutiveFailures: 0,
    createdAt: '',
    updatedAt: '',
  } satisfies AutonomousBookRun;
  let received: Record<string, unknown> | undefined;
  const scheduler = {
    capability: () => ({ persistent: true as const, runtime: 'tauri' as const }),
    listRuns: async () => [pausedRun],
    listAttempts: async () => [
      {
        attemptId: 'attempt-user-promotion',
        chapterId: 'chapter-1',
        candidateDraftId: 'draft-1',
        status: 'candidate_ready',
      },
    ],
    getRun: async () => pausedRun,
    async promoteAttempt(input: Record<string, unknown>) {
      received = input;
      return {
        run: { ...pausedRun, status: 'completed', stateRevision: 8, completedChapters: 1 },
        attempt: {
          attemptId: 'attempt-user-promotion',
          chapterId: 'chapter-1',
          candidateDraftId: 'draft-1',
          adoptedDraftId: 'draft-1',
          status: 'adopted',
        },
        decision: {},
        replayed: false,
      };
    },
  } as unknown as typeof autonomousSchedulerService;
  const worker = new AutonomousSchedulerWorker({
    scheduler,
    getPlan: async () => story,
    generateCandidate: async () => {
      throw new Error('unexpected generation');
    },
    adoptDraft: async () => {
      throw new Error('unexpected adoption');
    },
    getReview: async () => null,
    confirmAnalysis: async () => undefined,
    generateId: () => 'id',
    setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
    clearInterval: () => undefined,
  });

  assert.equal(
    await worker.promoteUserAdoptedDraft({
      id: 'draft-1',
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      isAdopted: true,
    } as never),
    true,
  );
  assert.deepEqual(received, {
    operationId: 'user-promote:attempt-user-promotion:draft-1',
    runId: 'run-user-promotion',
    attemptId: 'attempt-user-promotion',
    expectedRevision: 7,
    outcome: 'adopted',
    adoptedDraftId: 'draft-1',
    analysisConfirmed: false,
    userConfirmed: true,
  });
});

test('reservation uses a bounded conservative chapter estimate', () => {
  assert.deepEqual(estimateChapterReservation(plan(), 1), {
    estimatedTokens: 7200,
    estimatedCostUsd: 0.216,
  });
});

test('application entry owns scheduler recovery instead of the lazy route hook', () => {
  const mainSource = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8');
  const hookSource = readFileSync(new URL('./useAutonomousScheduler.ts', import.meta.url), 'utf8');

  assert.match(
    mainSource,
    /import\('\.\/services\/autonomous-creation\/autonomousSchedulerWorker'\)/,
  );
  assert.match(
    mainSource,
    /\.then\(\(\{ autonomousSchedulerWorker \}\) => autonomousSchedulerWorker\.recoverStartup\(\)\)/,
  );
  assert.ok(
    mainSource.indexOf('void startupCoordinator.start();') <
      mainSource.indexOf('ReactDOM.createRoot'),
  );
  assert.doesNotMatch(hookSource, /recoverStartup/);
});

test('desktop startup recovery is idempotent across concurrent and settled calls', async () => {
  let recoveryCalls = 0;
  let releaseRecovery!: () => void;
  const recoveryGate = new Promise<void>((resolve) => {
    releaseRecovery = resolve;
  });
  const worker = recoveryWorker(true, async () => {
    recoveryCalls += 1;
    await recoveryGate;
    return [];
  });

  const first = worker.recoverStartup();
  const concurrent = worker.recoverStartup();

  assert.strictEqual(concurrent, first);
  assert.equal(recoveryCalls, 1);

  releaseRecovery();
  await first;

  const settled = worker.recoverStartup();
  assert.strictEqual(settled, first);
  await settled;
  assert.equal(recoveryCalls, 1);
});

test('browser startup recovery is a no-op without calling the persistent scheduler', async () => {
  let recoveryCalls = 0;
  const worker = recoveryWorker(false, async () => {
    recoveryCalls += 1;
    return [];
  });

  await Promise.all([worker.recoverStartup(), worker.recoverStartup()]);

  assert.equal(recoveryCalls, 0);
});

test('desktop recovery sweep claims a run after a previous process lease expires', async () => {
  const story = plan();
  const queuedRun = {
    runId: 'run-recovery-sweep',
    operationId: 'operation-recovery-sweep',
    requestHash: 'request-hash',
    novelId: story.novelId,
    planId: story.planId,
    mode: 'draft_night',
    policy: policy('draft_night'),
    policyHash: 'policy-hash',
    status: 'queued',
    stateRevision: 3,
    nextChapterNumber: 1,
    totalChapters: 1,
    completedChapters: 0,
    tokenInput: 0,
    tokenOutput: 0,
    costUsd: 0,
    usageDay: '2026-07-30',
    dailyTokenInput: 0,
    dailyTokenOutput: 0,
    dailyCostUsd: 0,
    consecutiveFailures: 0,
    createdAt: '',
    updatedAt: '',
  } as AutonomousBookRun;
  let recoveryCalls = 0;
  let acquireCalls = 0;
  let recoverySweep: (() => void) | undefined;
  const scheduler = {
    capability: () => ({ persistent: true as const, runtime: 'tauri' as const }),
    async recoverInterruptedRuns() {
      recoveryCalls += 1;
      return recoveryCalls === 1 ? [] : [queuedRun];
    },
    async acquireLease() {
      acquireCalls += 1;
      return {
        lease: {
          leaseId: 'lease-recovery-sweep',
          runId: queuedRun.runId,
          novelId: queuedRun.novelId,
          epoch: 2,
        },
        token: '1234567890123456',
      };
    },
    async getRun() {
      return { ...queuedRun, status: 'completed' as const, stateRevision: 4 };
    },
  } as unknown as typeof autonomousSchedulerService;
  const worker = new AutonomousSchedulerWorker({
    scheduler,
    getPlan: async () => story,
    generateCandidate: async () => {
      throw new Error('unexpected candidate generation');
    },
    adoptDraft: async () => {
      throw new Error('unexpected draft adoption');
    },
    getReview: async () => null,
    confirmAnalysis: async () => undefined,
    generateId: () => 'recovery-sweep-owner',
    setInterval: (callback, delay) => {
      if (delay === 15_000) recoverySweep = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: () => undefined,
  });

  await worker.recoverStartup();
  assert.equal(recoveryCalls, 1);
  assert.ok(recoverySweep);

  recoverySweep();
  await waitFor(() => acquireCalls === 1);

  assert.equal(recoveryCalls, 2);
  assert.equal(acquireCalls, 1);
});

test('pre-claim failure pauses an owned run instead of leaving a zombie lease', async () => {
  const story = plan();
  let run = {
    runId: 'run-owned-failure',
    operationId: 'operation-owned-failure',
    requestHash: 'request-hash',
    novelId: story.novelId,
    planId: story.planId,
    mode: 'draft_night',
    policy: policy('draft_night'),
    policyHash: 'policy-hash',
    status: 'queued',
    stateRevision: 3,
    nextChapterNumber: 1,
    totalChapters: 1,
    completedChapters: 0,
    tokenInput: 0,
    tokenOutput: 0,
    costUsd: 0,
    usageDay: '2026-07-30',
    dailyTokenInput: 0,
    dailyTokenOutput: 0,
    dailyCostUsd: 0,
    consecutiveFailures: 0,
    createdAt: '',
    updatedAt: '',
  } as AutonomousBookRun;
  let heartbeatCalls = 0;
  let pauseCalls = 0;
  let pauseReason = '';
  const scheduler = {
    capability: () => ({ persistent: true as const, runtime: 'tauri' as const }),
    async recoverInterruptedRuns() {
      return [run];
    },
    async acquireLease() {
      run = { ...run, status: 'running', stateRevision: 4 };
      return {
        lease: { leaseId: 'lease-owned-failure', runId: run.runId, novelId: run.novelId, epoch: 2 },
        token: '1234567890123456',
      };
    },
    async getRun() {
      return run;
    },
    async heartbeat() {
      heartbeatCalls += 1;
      return {};
    },
    async pauseRun(
      _operationId: string,
      _runId: string,
      expectedRevision: number,
      reason?: string,
    ) {
      pauseCalls += 1;
      pauseReason = reason ?? '';
      assert.equal(expectedRevision, 4);
      run = { ...run, status: 'paused', stateRevision: 5, pauseReason };
      return run;
    },
  } as unknown as typeof autonomousSchedulerService;
  const worker = new AutonomousSchedulerWorker({
    scheduler,
    getPlan: async () => null,
    generateCandidate: async () => {
      throw new Error('unexpected candidate generation');
    },
    adoptDraft: async () => {
      throw new Error('unexpected draft adoption');
    },
    getReview: async () => null,
    confirmAnalysis: async () => undefined,
    generateId: () => 'owned-failure-cleanup',
    setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
    clearInterval: () => undefined,
  });

  await worker.recoverStartup();
  await waitFor(() => pauseCalls === 1);

  assert.equal(heartbeatCalls, 1);
  assert.equal(pauseReason, 'worker_error:unexpected');
  assert.equal(worker.snapshot(story.planId).run?.status, 'paused');
});

test('a fenced worker does not pause the replacement owner after cleanup lease verification fails', async () => {
  const story = plan();
  let run = {
    runId: 'run-fenced-failure',
    operationId: 'operation-fenced-failure',
    requestHash: 'request-hash',
    novelId: story.novelId,
    planId: story.planId,
    mode: 'draft_night',
    policy: policy('draft_night'),
    policyHash: 'policy-hash',
    status: 'queued',
    stateRevision: 3,
    nextChapterNumber: 1,
    totalChapters: 1,
    completedChapters: 0,
    tokenInput: 0,
    tokenOutput: 0,
    costUsd: 0,
    usageDay: '2026-07-30',
    dailyTokenInput: 0,
    dailyTokenOutput: 0,
    dailyCostUsd: 0,
    consecutiveFailures: 0,
    createdAt: '',
    updatedAt: '',
  } as AutonomousBookRun;
  let pauseCalls = 0;
  const scheduler = {
    capability: () => ({ persistent: true as const, runtime: 'tauri' as const }),
    async recoverInterruptedRuns() {
      return [run];
    },
    async acquireLease() {
      run = { ...run, status: 'running', stateRevision: 4 };
      return {
        lease: {
          leaseId: 'lease-fenced-failure',
          runId: run.runId,
          novelId: run.novelId,
          epoch: 2,
        },
        token: '1234567890123456',
      };
    },
    async getRun() {
      return run;
    },
    async heartbeat() {
      throw Object.assign(new Error('lease fenced'), { code: 'AUTONOMOUS_RUN_LEASE_EXPIRED' });
    },
    async pauseRun() {
      pauseCalls += 1;
      return run;
    },
  } as unknown as typeof autonomousSchedulerService;
  const worker = new AutonomousSchedulerWorker({
    scheduler,
    getPlan: async () => null,
    generateCandidate: async () => {
      throw new Error('unexpected candidate generation');
    },
    adoptDraft: async () => {
      throw new Error('unexpected draft adoption');
    },
    getReview: async () => null,
    confirmAnalysis: async () => undefined,
    generateId: () => 'fenced-failure-cleanup',
    setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
    clearInterval: () => undefined,
  });

  await worker.recoverStartup();
  await waitFor(() => worker.snapshot(story.planId).workerActive === false);

  assert.equal(pauseCalls, 0);
  assert.equal(worker.snapshot(story.planId).run?.status, 'running');
});
