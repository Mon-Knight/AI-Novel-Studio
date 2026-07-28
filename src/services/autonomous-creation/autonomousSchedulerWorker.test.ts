import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AutonomousStoryPlan } from '../../types/autonomousCreation';
import type {
  AutonomousAutomationMode,
  AutonomousAutomationPolicy,
  AutonomousBookRun,
} from '../../types/autonomousScheduler';
import { autonomousSchedulerService } from './autonomousSchedulerService';
import { AutonomousSchedulerWorker, estimateChapterReservation } from './autonomousSchedulerWorker';

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
  let selection = '';
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
      return { id: 'draft-1', chapterId: 'chapter-1', isAdopted: true } as never;
    },
    getReview: async () =>
      ({
        session: {},
        rounds: [{ consensus: { successfulExperts: 6, averageScore: 90, acceptanceRate: 1 } }],
      }) as never,
    confirmAnalysis: async () => {
      confirmed += 1;
    },
    generateId: () => 'id',
    setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
    clearInterval: () => undefined,
  });
  await worker.start(story, policy(mode));
  await waitFor(() => worker.snapshot(story.planId).run?.status === 'completed');
  return { finishedOutcome, adopted, confirmed, selection };
}

test('scheduler worker maps the three frozen modes to candidate, adopted and confirmed outcomes', async () => {
  assert.deepEqual(await executeMode('draft_night'), {
    finishedOutcome: 'candidate_ready',
    adopted: 0,
    confirmed: 0,
    selection: 'next_missing_candidate',
  });
  assert.deepEqual(await executeMode('quality_gate'), {
    finishedOutcome: 'adopted',
    adopted: 1,
    confirmed: 0,
    selection: 'next_missing_candidate',
  });
  assert.deepEqual(await executeMode('full_auto'), {
    finishedOutcome: 'confirmed',
    adopted: 1,
    confirmed: 1,
    selection: 'next_missing_candidate',
  });
});

test('reservation uses a bounded conservative chapter estimate', () => {
  assert.deepEqual(estimateChapterReservation(plan(), 1), {
    estimatedTokens: 7200,
    estimatedCostUsd: 0.216,
  });
});
