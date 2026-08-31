import assert from 'node:assert/strict';
import test from 'node:test';
import type { LegacyChapterContextMigrationResult } from '../context/legacyChapterContextMigrationService';
import type { StartupGenerationRecovery } from '../../types/generationJob';
import { createStartupCoordinator } from './startupCoordinator';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const EMPTY_CONTEXT_MIGRATION: LegacyChapterContextMigrationResult = {
  performed: false,
  chapterSummaries: { inserted: 0, matched: 0, skipped: 0 },
  contextRecords: { inserted: 0, matched: 0, skipped: 0 },
  characterStates: { inserted: 0, matched: 0, skipped: 0 },
  idMap: {},
  warnings: [],
  localRecordsRemoved: { chapterSummaries: 0, contextRecords: 0, characterStates: 0 },
};

const EMPTY_GENERATION_RECOVERY: StartupGenerationRecovery = {
  recoveredJobs: 0,
  recoveredAt: '2026-08-27T00:00:00.000Z',
};

test('isStarted observes start state without triggering recovery', async () => {
  let invocationCount = 0;
  const coordinator = createStartupCoordinator({
    async recoverConversations() {
      invocationCount += 1;
      return 0;
    },
    async migrateContext() {
      invocationCount += 1;
      return EMPTY_CONTEXT_MIGRATION;
    },
    async recoverGeneration() {
      invocationCount += 1;
      return EMPTY_GENERATION_RECOVERY;
    },
  });

  assert.equal(coordinator.isStarted(), false);
  assert.equal(coordinator.isStarted(), false);
  assert.equal(invocationCount, 0);

  const started = coordinator.start();
  assert.equal(coordinator.isStarted(), true);
  assert.strictEqual(coordinator.start(), started);

  await started;
  assert.equal(invocationCount, 3);
});

test('starts every recovery once and releases each readiness independently', async () => {
  const calls: string[] = [];
  const conversation = createDeferred<number>();
  const context = createDeferred<LegacyChapterContextMigrationResult>();
  const generation = createDeferred<StartupGenerationRecovery>();
  const coordinator = createStartupCoordinator({
    recoverConversations() {
      calls.push('conversation');
      return conversation.promise;
    },
    migrateContext() {
      calls.push('context');
      return context.promise;
    },
    recoverGeneration() {
      calls.push('generation');
      return generation.promise;
    },
  });
  let emissions = 0;
  const unsubscribe = coordinator.subscribe(() => {
    emissions += 1;
  });

  const started = coordinator.start();
  const conversationReady = coordinator.waitForConversationRecovery();
  const contextReady = coordinator.waitForContextMigration();
  const generationReady = coordinator.waitForGenerationRecovery();
  assert.strictEqual(coordinator.start(), started);

  await Promise.resolve();
  assert.deepEqual(calls, ['conversation', 'context', 'generation']);
  assert.deepEqual(
    {
      conversation: coordinator.getSnapshot().conversationRecovery.status,
      context: coordinator.getSnapshot().contextMigration.status,
      generation: coordinator.getSnapshot().generationRecovery.status,
    },
    { conversation: 'running', context: 'running', generation: 'running' },
  );

  context.resolve(EMPTY_CONTEXT_MIGRATION);
  await contextReady;
  assert.equal(coordinator.getSnapshot().contextMigration.status, 'succeeded');
  assert.equal(coordinator.getSnapshot().conversationRecovery.status, 'running');
  assert.equal(coordinator.getSnapshot().generationRecovery.status, 'running');

  generation.resolve(EMPTY_GENERATION_RECOVERY);
  await generationReady;
  assert.equal(coordinator.getSnapshot().generationRecovery.status, 'succeeded');
  assert.equal(coordinator.getSnapshot().conversationRecovery.status, 'running');

  conversation.resolve(2);
  await conversationReady;
  await started;
  assert.equal(coordinator.getSnapshot().conversationRecovery.result?.recoveredRuns, 2);
  assert.equal(emissions, 6);
  assert.deepEqual(calls, ['conversation', 'context', 'generation']);
  unsubscribe();
});

test('reconciles desktop runtime liveness before recovering persisted conversation runs', async () => {
  const calls: string[] = [];
  let observedActiveRunIds: readonly string[] | undefined;
  const coordinator = createStartupCoordinator({
    async listConversationRuntimeStatuses() {
      calls.push('list-runtime-statuses');
      return [
        { runId: 'run-attesting', status: 'attesting' },
        { runId: 'run-queued', status: 'queued' },
        { runId: 'run-running', status: 'running' },
        { runId: 'run-cancelling', status: 'cancel_requested' },
        { runId: 'run-running', status: 'running' },
        { runId: 'run-idle', status: 'idle' },
        { runId: '   ', status: 'running' },
      ];
    },
    async recoverConversations(activeRuntimeRunIds) {
      calls.push('recover-persisted-runs');
      observedActiveRunIds = activeRuntimeRunIds;
      return 2;
    },
    async migrateContext() {
      return EMPTY_CONTEXT_MIGRATION;
    },
    async recoverGeneration() {
      return EMPTY_GENERATION_RECOVERY;
    },
  });

  await coordinator.waitForConversationRecovery();

  assert.deepEqual(calls, ['list-runtime-statuses', 'recover-persisted-runs']);
  assert.deepEqual(observedActiveRunIds, [
    'run-attesting',
    'run-queued',
    'run-running',
    'run-cancelling',
  ]);
  assert.equal(coordinator.getSnapshot().conversationRecovery.result?.recoveredRuns, 2);
});

test('fails closed without sweeping persisted runs when runtime liveness cannot be read', async () => {
  let recoveryCalled = false;
  const coordinator = createStartupCoordinator({
    async listConversationRuntimeStatuses() {
      throw new Error('runtime status unavailable');
    },
    async recoverConversations() {
      recoveryCalled = true;
      return 0;
    },
    async migrateContext() {
      return EMPTY_CONTEXT_MIGRATION;
    },
    async recoverGeneration() {
      return EMPTY_GENERATION_RECOVERY;
    },
  });

  await assert.rejects(coordinator.waitForConversationRecovery(), /runtime status unavailable/);
  assert.equal(recoveryCalled, false);
  assert.equal(coordinator.getSnapshot().conversationRecovery.status, 'failed');
});

test('records failures, rejects readiness and keeps other recoveries running', async () => {
  const reports: Array<{ code: string; message: string }> = [];
  const coordinator = createStartupCoordinator({
    async recoverConversations() {
      throw new Error('conversation failed');
    },
    async migrateContext() {
      throw 'context failed';
    },
    async recoverGeneration() {
      throw { reason: 'generation failed' };
    },
    reportError(code, message) {
      reports.push({ code, message });
    },
  });

  const settlements = await Promise.allSettled([
    coordinator.waitForConversationRecovery(),
    coordinator.waitForContextMigration(),
    coordinator.waitForGenerationRecovery(),
    coordinator.start(),
  ]);
  assert.deepEqual(
    settlements.map((settlement) => settlement.status),
    ['rejected', 'rejected', 'rejected', 'fulfilled'],
  );

  const snapshot = coordinator.getSnapshot();
  assert.deepEqual(
    {
      conversation: snapshot.conversationRecovery,
      context: snapshot.contextMigration,
      generation: snapshot.generationRecovery,
    },
    {
      conversation: { status: 'failed', error: 'conversation failed' },
      context: { status: 'failed', error: 'context failed' },
      generation: { status: 'failed', error: 'generation failed' },
    },
  );
  assert.deepEqual(reports, [
    {
      code: '[STARTUP_CONVERSATION_RECOVERY_FAILED]',
      message: 'conversation failed',
    },
    { code: '[STARTUP_CONTEXT_MIGRATION_FAILED]', message: 'context failed' },
    { code: '[STARTUP_TASK_RECOVERY_FAILED]', message: 'generation failed' },
  ]);
});

test('reconciles a successful startup operation that completes after the timeout', async () => {
  const conversation = createDeferred<number>();
  const coordinator = createStartupCoordinator({
    recoverConversations: () => conversation.promise,
    async migrateContext() {
      return EMPTY_CONTEXT_MIGRATION;
    },
    async recoverGeneration() {
      return EMPTY_GENERATION_RECOVERY;
    },
    taskTimeoutMs: 10,
  });

  await assert.rejects(coordinator.waitForConversationRecovery(), /超过 10 ms/);
  assert.equal(coordinator.getSnapshot().conversationRecovery.status, 'failed');

  conversation.resolve(3);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(coordinator.getSnapshot().conversationRecovery, {
    status: 'succeeded',
    result: { recoveredRuns: 3 },
  });
  await coordinator.start();
});

test('allows readiness to be retried after a timed-out operation succeeds late', async () => {
  const context = createDeferred<LegacyChapterContextMigrationResult>();
  let migrationCalls = 0;
  const coordinator = createStartupCoordinator({
    async recoverConversations() {
      return 0;
    },
    migrateContext() {
      migrationCalls += 1;
      return context.promise;
    },
    async recoverGeneration() {
      return EMPTY_GENERATION_RECOVERY;
    },
    taskTimeoutMs: 10,
  });

  await assert.rejects(coordinator.waitForContextMigration(), /超过 10 ms/);
  context.resolve(EMPTY_CONTEXT_MIGRATION);
  await new Promise((resolve) => setTimeout(resolve, 0));

  await coordinator.waitForContextMigration();
  assert.equal(migrationCalls, 1);
  assert.deepEqual(coordinator.getSnapshot().contextMigration, {
    status: 'succeeded',
    result: EMPTY_CONTEXT_MIGRATION,
  });
});
