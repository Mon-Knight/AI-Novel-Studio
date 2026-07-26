import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  AgentPlanBundle,
  AgentPlanLeaseProof,
  AgentPlanStepAttemptRecord,
} from '../../types/agentPlan';
import type {
  ToolDescriptorV1,
  ToolJsonSchema,
  ToolPermission,
  ToolResult,
} from '../../types/toolRegistry';
import { canonicalHash } from '../ai/compilation/canonical';
import { ToolRegistry, type ToolDefinition } from '../agent-tools/toolRegistry';
import type { AgentPlanPersistence } from './agentPlanPersistenceService';
import { createAgentPlanRuntime } from './agentPlanRuntimeService';

const identities = [
  'novel.read_context@1',
  'chapter.read_outline@1',
  'chapter.read_context@1',
  'style.read_profile@1',
  'style.read_output_control@1',
  'verification.check_readiness@1',
] as const;
const dependencies = [[], [0], [0], [0], [0], [1, 2, 3, 4]] as const;
const permissions: ToolPermission[][] = [
  ['novel.read'],
  ['chapter.read', 'novel.read'],
  ['chapter.read', 'novel.read'],
  ['novel.read', 'style.read'],
  ['novel.read', 'style.read'],
  ['chapter.read', 'novel.read', 'style.read', 'verification.execute'],
];
const stepKeys = [
  'read_novel_context',
  'read_chapter_outline',
  'read_chapter_context',
  'read_style_profile',
  'read_output_control',
  'check_readiness',
];

function descriptor(identity: string, toolPermissions: ToolPermission[]): ToolDescriptorV1 {
  const [name, version] = identity.split('@');
  const chapterScope = name.startsWith('chapter.') || name === 'verification.check_readiness';
  const properties: Record<string, ToolJsonSchema> = chapterScope
    ? { novelId: { type: 'string' as const }, chapterId: { type: 'string' as const } }
    : { novelId: { type: 'string' as const } };
  return {
    name,
    version,
    description: `Test ${name}`,
    inputSchema: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      required: ['ok'],
      properties: { ok: { type: 'boolean' }, data: {} },
      additionalProperties: false,
    },
    permissions: toolPermissions,
    scope: chapterScope ? 'chapter' : 'novel',
    sideEffect: 'none',
    confirmationPolicy: 'never',
    timeoutMs: 1000,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function harness(failingIdentity?: string) {
  const calls: string[] = [];
  const definitions: ToolDefinition[] = identities.map((identity, index) => ({
    descriptor: descriptor(identity, permissions[index]),
    handler: async () => {
      calls.push(identity);
      if (identity === failingIdentity) throw new Error('local read failed');
      return identity === 'verification.check_readiness@1'
        ? { ok: true, data: { ready: true, score: 100, missing: [], warnings: [], summary: 'ready' } }
        : { ok: true, data: { identity } };
    },
  }));
  const registry = new ToolRegistry(definitions);
  const manifest = await registry.getManifest();
  const now = '2026-07-26T00:00:00Z';
  const steps = await Promise.all(identities.map(async (identity, index) => {
    const tool = manifest.tools.find((candidate) => `${candidate.name}@${candidate.version}` === identity)!;
    const argumentsJson = tool.scope === 'chapter'
      ? { novelId: 'novel-1', chapterId: 'chapter-1' }
      : { novelId: 'novel-1' };
    return {
      stepId: `step-${index + 1}`,
      planId: 'plan-1',
      stepKey: stepKeys[index],
      ordinal: index + 1,
      title: stepKeys[index],
      toolName: tool.name,
      toolVersion: tool.version,
      toolIdentity: identity,
      registryHash: manifest.registryHash,
      inputSchemaHash: await canonicalHash(tool.inputSchema),
      outputSchemaHash: await canonicalHash(tool.outputSchema),
      permissionsJson: tool.permissions,
      scope: tool.scope,
      argumentsJson,
      argumentsHash: await canonicalHash(argumentsJson),
      status: 'pending' as const,
      stateRevision: 0,
      createdAt: now,
      updatedAt: now,
    };
  }));
  const bundle: AgentPlanBundle = {
    plan: {
      planId: 'plan-1',
      operationId: 'create-op',
      requestHash: 'a'.repeat(64),
      contractVersion: 'agent_plan_v1',
      plannerId: 'chapter_readiness_plan_v1',
      plannerVersion: 1,
      registryHash: manifest.registryHash,
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      status: 'ready',
      stateRevision: 0,
      createdAt: now,
      updatedAt: now,
    },
    steps,
    dependencies: dependencies.flatMap((parents, childIndex) => parents.map((parentIndex, dependencyIndex) => ({
      planId: 'plan-1',
      stepId: `step-${childIndex + 1}`,
      dependsOnStepId: `step-${parentIndex + 1}`,
      dependencyOrdinal: dependencyIndex + 1,
      createdAt: now,
    }))),
    attempts: [],
    checkpoints: [],
  };
  let attemptCounter = 0;
  let released = 0;
  const proof: AgentPlanLeaseProof = {
    leaseId: 'lease-1', epoch: 1, ownerId: 'owner-1', token: 'transient-token',
  };
  const persistence = {
    isAvailable: () => true,
    newOperationId: (prefix: string) => `${prefix}:operation`,
    create: async () => clone(bundle),
    get: async () => clone(bundle),
    listByChapter: async () => [clone(bundle.plan)],
    acquireLease: async () => ({
      lease: {
        leaseId: proof.leaseId,
        planId: bundle.plan.planId,
        epoch: proof.epoch,
        ownerId: proof.ownerId,
        expiresAt: '2026-07-26T00:05:00Z',
        status: 'active' as const,
        acquiredAt: now,
      },
      token: proof.token,
    }),
    claim: async (_planId: string, stepId: string) => {
      const step = bundle.steps.find((candidate) => candidate.stepId === stepId)!;
      step.status = 'running';
      bundle.plan.status = 'running';
      attemptCounter += 1;
      const attempt: AgentPlanStepAttemptRecord = {
        attemptId: `attempt-${attemptCounter}`,
        planId: bundle.plan.planId,
        stepId,
        attemptNumber: 1,
        leaseId: proof.leaseId,
        leaseEpoch: proof.epoch,
        status: 'running',
        startedAt: now,
      };
      bundle.attempts.push(attempt);
      return { plan: clone(bundle.plan), step: clone(step), attempt: clone(attempt) };
    },
    complete: async (input: { stepId: string; attemptId: string; outputJson: ToolResult }) => {
      const step = bundle.steps.find((candidate) => candidate.stepId === input.stepId)!;
      const attempt = bundle.attempts.find((candidate) => candidate.attemptId === input.attemptId)!;
      step.status = 'completed';
      step.outputJson = clone(input.outputJson);
      attempt.status = 'succeeded';
      attempt.outputJson = clone(input.outputJson);
      if (bundle.steps.every((candidate) => candidate.status === 'completed')) {
        bundle.plan.status = 'completed';
        bundle.plan.resultJson = clone(input.outputJson) as never;
      }
      return clone(bundle);
    },
    fail: async (input: { stepId: string; attemptId: string; error: { code: string; message: string; retryable: boolean } }) => {
      const step = bundle.steps.find((candidate) => candidate.stepId === input.stepId)!;
      const attempt = bundle.attempts.find((candidate) => candidate.attemptId === input.attemptId)!;
      step.status = 'waiting_retry';
      step.errorJson = clone(input.error);
      attempt.status = 'failed';
      attempt.errorJson = clone(input.error);
      bundle.plan.status = 'waiting_retry';
      bundle.plan.errorJson = clone(input.error);
      return clone(bundle);
    },
    authorizeRetry: async () => clone(bundle),
    releaseLease: async () => {
      released += 1;
      return {
        leaseId: proof.leaseId,
        planId: bundle.plan.planId,
        epoch: proof.epoch,
        ownerId: proof.ownerId,
        expiresAt: now,
        status: 'released' as const,
        acquiredAt: now,
        releasedAt: now,
      };
    },
    cancel: async () => clone(bundle),
    recover: async () => [],
  } as unknown as AgentPlanPersistence;
  return {
    runtime: createAgentPlanRuntime({ persistence, registry }),
    calls,
    getBundle: () => clone(bundle),
    getReleased: () => released,
    tamper: () => { bundle.steps[0].argumentsHash = '0'.repeat(64); },
  };
}

test('planner runtime executes the frozen DAG once and completes with readiness result', async () => {
  const testHarness = await harness();
  const result = await testHarness.runtime.runExisting('plan-1');
  assert.equal(result.plan.status, 'completed');
  assert.deepEqual(testHarness.calls, identities);
  assert.equal(result.attempts.length, 6);
  assert.equal(testHarness.getReleased(), 0, 'backend releases final lease atomically');
});

test('planner runtime persists one failed Attempt and does not automatically retry', async () => {
  const testHarness = await harness('chapter.read_outline@1');
  const result = await testHarness.runtime.runExisting('plan-1');
  assert.equal(result.plan.status, 'waiting_retry');
  assert.deepEqual(testHarness.calls, ['novel.read_context@1', 'chapter.read_outline@1']);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[1].errorJson?.retryable, true);
});

test('planner runtime rejects persisted contract drift before claiming a tool', async () => {
  const testHarness = await harness();
  testHarness.tamper();
  await assert.rejects(
    () => testHarness.runtime.runExisting('plan-1'),
    /schema、权限或参数已漂移/,
  );
  assert.deepEqual(testHarness.calls, []);
  assert.equal(testHarness.getBundle().attempts.length, 0);
});
