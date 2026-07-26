import type {
  AgentExecutionLeaseRecord,
  AgentPlanBundle,
  AgentPlanError,
  AgentPlanLeaseGrant,
  AgentPlanLeaseProof,
  AgentPlanRecord,
  AgentPlanStepClaim,
} from '../../types/agentPlan';
import type { ToolResult } from '../../types/toolRegistry';
import { dbCall, generateId, isTauri } from '../database/db';
import {
  CHAPTER_READINESS_PLANNER_ID,
  CHAPTER_READINESS_PLANNER_VERSION,
} from './chapterReadinessPlanner';

export class AgentPlanDesktopRequiredError extends Error {
  readonly code = 'AGENT_PLAN_DESKTOP_REQUIRED';
  readonly retryable = false;

  constructor() {
    super('章节准备计划仅在桌面端使用 SQLite 持久运行，浏览器模式不会伪造 Plan。');
    this.name = 'AgentPlanDesktopRequiredError';
  }
}

function requireDesktop(): void {
  if (!isTauri()) throw new AgentPlanDesktopRequiredError();
}

export const agentPlanPersistenceService = {
  isAvailable(): boolean {
    return isTauri();
  },

  newOperationId(prefix: string): string {
    return `${prefix}:${generateId()}`;
  },

  async create(input: {
    novelId: string;
    chapterId: string;
    registryHash: string;
    operationId: string;
  }): Promise<AgentPlanBundle> {
    requireDesktop();
    return dbCall('create_agent_plan', {
      input: {
        ...input,
        plannerId: CHAPTER_READINESS_PLANNER_ID,
        plannerVersion: CHAPTER_READINESS_PLANNER_VERSION,
      },
    });
  },

  async get(planId: string): Promise<AgentPlanBundle> {
    requireDesktop();
    return dbCall('get_agent_plan', { input: { planId } });
  },

  async listByChapter(chapterId: string, limit = 20): Promise<AgentPlanRecord[]> {
    requireDesktop();
    return dbCall('list_agent_plans_by_chapter', { input: { chapterId, limit } });
  },

  async acquireLease(planId: string, ownerId: string): Promise<AgentPlanLeaseGrant> {
    requireDesktop();
    return dbCall('acquire_agent_plan_lease', {
      input: { planId, ownerId, ttlSeconds: 300 },
    });
  },

  async claim(planId: string, stepId: string, lease: AgentPlanLeaseProof): Promise<AgentPlanStepClaim> {
    requireDesktop();
    return dbCall('claim_agent_plan_step', { input: { planId, stepId, lease } });
  },

  async complete(input: {
    planId: string;
    stepId: string;
    attemptId: string;
    outputJson: ToolResult;
    lease: AgentPlanLeaseProof;
  }): Promise<AgentPlanBundle> {
    requireDesktop();
    return dbCall('complete_agent_plan_step', { input });
  },

  async fail(input: {
    planId: string;
    stepId: string;
    attemptId: string;
    error: AgentPlanError;
    lease: AgentPlanLeaseProof;
  }): Promise<AgentPlanBundle> {
    requireDesktop();
    return dbCall('fail_agent_plan_step', { input });
  },

  async authorizeRetry(
    planId: string,
    stepId: string,
    operationId: string,
  ): Promise<AgentPlanBundle> {
    requireDesktop();
    return dbCall('authorize_agent_plan_retry', {
      input: { planId, stepId, operationId },
    });
  },

  async releaseLease(
    planId: string,
    lease: AgentPlanLeaseProof,
  ): Promise<AgentExecutionLeaseRecord> {
    requireDesktop();
    return dbCall('release_agent_plan_lease', { input: { planId, lease } });
  },

  async cancel(planId: string): Promise<AgentPlanBundle> {
    requireDesktop();
    return dbCall('cancel_agent_plan', { input: { planId } });
  },

  async recover(): Promise<AgentPlanBundle[]> {
    requireDesktop();
    return dbCall('recover_interrupted_agent_plans');
  },
};

export type AgentPlanPersistence = typeof agentPlanPersistenceService;
