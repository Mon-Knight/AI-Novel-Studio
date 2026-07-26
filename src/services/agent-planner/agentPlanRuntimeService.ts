import type {
  AgentPlanBundle,
  AgentPlanError,
  AgentPlanLeaseProof,
} from '../../types/agentPlan';
import type { ToolRegistry } from '../agent-tools/toolRegistry';
import { productionToolRegistry } from '../agent-tools/productionToolRegistry';
import {
  agentPlanPersistenceService,
  type AgentPlanPersistence,
} from './agentPlanPersistenceService';
import {
  nextRunnableStep,
  verifyChapterReadinessPlan,
} from './chapterReadinessPlanner';

export interface AgentPlanRuntimeDependencies {
  persistence: AgentPlanPersistence;
  registry: ToolRegistry;
}

export interface AgentPlanProgressEvent {
  bundle: AgentPlanBundle;
  activeStepId?: string;
}

export interface RunAgentPlanOptions {
  onProgress?: (event: AgentPlanProgressEvent) => void;
}

class AgentPlanToolResultError extends Error {
  readonly code = 'AGENT_PLAN_TOOL_FAILED';
  readonly retryable = true;

  constructor(message: string) {
    super(message);
    this.name = 'AgentPlanToolResultError';
  }
}

function leaseProof(grant: Awaited<ReturnType<AgentPlanPersistence['acquireLease']>>): AgentPlanLeaseProof {
  return {
    leaseId: grant.lease.leaseId,
    epoch: grant.lease.epoch,
    ownerId: grant.lease.ownerId,
    token: grant.token,
  };
}

function safeRuntimeError(error: unknown): AgentPlanError {
  const record = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown; retryable?: unknown }
    : undefined;
  const message = typeof record?.message === 'string' && record.message.length <= 500
    ? record.message
    : '本地工具执行失败';
  return {
    code: typeof record?.code === 'string' ? record.code : 'AGENT_PLAN_TOOL_FAILED',
    message,
    // A local tool failure never triggers an automatic replay. Persist it as
    // waiting_retry so only the explicit retry command can create a new Attempt.
    retryable: true,
  };
}

export function createAgentPlanRuntime(
  dependencies: AgentPlanRuntimeDependencies,
) {
  const { persistence, registry } = dependencies;

  async function runExisting(
    planId: string,
    options: RunAgentPlanOptions = {},
  ): Promise<AgentPlanBundle> {
    let bundle = await persistence.get(planId);
    const manifest = await registry.getManifest();
    await verifyChapterReadinessPlan(bundle, manifest);
    if (bundle.plan.status === 'completed'
      || bundle.plan.status === 'failed'
      || bundle.plan.status === 'cancelled') return bundle;
    if (bundle.plan.status === 'waiting_retry') {
      throw new AgentPlanToolResultError('计划等待用户显式继续，不能自动重试。');
    }

    const ownerId = persistence.newOperationId('chapter-readiness-executor');
    const grant = await persistence.acquireLease(planId, ownerId);
    const lease = leaseProof(grant);
    let leaseReleased = false;
    try {
      while (bundle.plan.status === 'ready' || bundle.plan.status === 'running') {
        await verifyChapterReadinessPlan(bundle, manifest);
        const step = nextRunnableStep(bundle);
        if (!step) {
          throw new AgentPlanToolResultError('计划没有可运行步骤，依赖状态不一致。');
        }
        const claim = await persistence.claim(planId, step.stepId, lease);
        options.onProgress?.({ bundle: await persistence.get(planId), activeStepId: step.stepId });
        let result: Awaited<ReturnType<ToolRegistry['invoke']>>;
        try {
          result = await registry.invoke(
            step.toolName,
            step.toolVersion,
            step.argumentsJson,
            {
              invocationId: claim.attempt.attemptId,
              novelId: bundle.plan.novelId,
              chapterId: bundle.plan.chapterId,
              grantedPermissions: step.permissionsJson,
              allowedTools: [step.toolIdentity],
              dryRun: true,
            },
          );
          if (!result.ok) {
            throw new AgentPlanToolResultError(result.error || `工具 ${step.toolIdentity} 返回失败`);
          }
        } catch (error) {
          bundle = await persistence.fail({
            planId,
            stepId: step.stepId,
            attemptId: claim.attempt.attemptId,
            error: safeRuntimeError(error),
            lease,
          });
          leaseReleased = true;
          options.onProgress?.({ bundle });
          return bundle;
        }
        // Persistence failures are not tool failures. In particular, a lost IPC
        // response may follow a successful commit, so never overwrite it with a
        // failed Attempt. The caller reloads the authoritative Plan instead.
        bundle = await persistence.complete({
          planId,
          stepId: step.stepId,
          attemptId: claim.attempt.attemptId,
          outputJson: result,
          lease,
        });
        if (bundle.plan.status === 'completed') leaseReleased = true;
        options.onProgress?.({ bundle });
      }
      return bundle;
    } finally {
      if (!leaseReleased) {
        await persistence.releaseLease(planId, lease).catch(() => undefined);
      }
    }
  }

  return {
    async createAndRun(
      input: { novelId: string; chapterId: string; operationId?: string },
      options: RunAgentPlanOptions = {},
    ): Promise<AgentPlanBundle> {
      const manifest = await registry.getManifest();
      const bundle = await persistence.create({
        novelId: input.novelId,
        chapterId: input.chapterId,
        registryHash: manifest.registryHash,
        operationId: input.operationId
          ?? persistence.newOperationId('chapter-readiness-create'),
      });
      options.onProgress?.({ bundle });
      return runExisting(bundle.plan.planId, options);
    },

    async runExisting(planId: string, options: RunAgentPlanOptions = {}): Promise<AgentPlanBundle> {
      return runExisting(planId, options);
    },

    async authorizeRetryAndRun(
      planId: string,
      stepId: string,
      options: RunAgentPlanOptions = {},
    ): Promise<AgentPlanBundle> {
      const bundle = await persistence.authorizeRetry(
        planId,
        stepId,
        persistence.newOperationId('chapter-readiness-retry'),
      );
      options.onProgress?.({ bundle });
      return runExisting(planId, options);
    },
  };
}

export const agentPlanRuntimeService = createAgentPlanRuntime({
  persistence: agentPlanPersistenceService,
  registry: productionToolRegistry,
});
