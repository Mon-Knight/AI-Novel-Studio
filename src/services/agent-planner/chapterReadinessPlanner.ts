import type { AgentPlanBundle, AgentPlanStepRecord } from '../../types/agentPlan';
import type { ToolDescriptorV1, ToolRegistryManifestV1 } from '../../types/toolRegistry';
import { canonicalHash } from '../ai/compilation/canonical';

export const CHAPTER_READINESS_PLANNER_ID = 'chapter_readiness_plan_v1' as const;
export const CHAPTER_READINESS_PLANNER_VERSION = 1 as const;

const expectedSteps = [
  { key: 'read_novel_context', tool: 'novel.read_context@1', dependencies: [] },
  { key: 'read_chapter_outline', tool: 'chapter.read_outline@1', dependencies: [0] },
  { key: 'read_chapter_context', tool: 'chapter.read_context@1', dependencies: [0] },
  { key: 'read_style_profile', tool: 'style.read_profile@1', dependencies: [0] },
  { key: 'read_output_control', tool: 'style.read_output_control@1', dependencies: [0] },
  { key: 'check_readiness', tool: 'verification.check_readiness@1', dependencies: [1, 2, 3, 4] },
] as const;

export class AgentPlanContractError extends Error {
  readonly code = 'AGENT_PLAN_CONTRACT_MISMATCH';
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'AgentPlanContractError';
  }
}

function exactStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function descriptorFor(
  manifest: ToolRegistryManifestV1,
  identity: string,
): ToolDescriptorV1 {
  const descriptor = manifest.tools.find((tool) => `${tool.name}@${tool.version}` === identity);
  if (!descriptor) throw new AgentPlanContractError(`Registry 缺少工具 ${identity}`);
  return descriptor;
}

export async function verifyChapterReadinessPlan(
  bundle: AgentPlanBundle,
  manifest: ToolRegistryManifestV1,
): Promise<void> {
  if (bundle.plan.contractVersion !== 'agent_plan_v1'
    || bundle.plan.plannerId !== CHAPTER_READINESS_PLANNER_ID
    || bundle.plan.plannerVersion !== CHAPTER_READINESS_PLANNER_VERSION
    || bundle.plan.registryHash !== manifest.registryHash
    || bundle.steps.length !== expectedSteps.length) {
    throw new AgentPlanContractError('持久 Plan 头部或 Registry identity 不匹配');
  }
  const stepById = new Map(bundle.steps.map((step) => [step.stepId, step]));
  for (let index = 0; index < expectedSteps.length; index += 1) {
    const expected = expectedSteps[index];
    const step = bundle.steps[index];
    if (!step
      || step.ordinal !== index + 1
      || step.stepKey !== expected.key
      || step.toolIdentity !== expected.tool
      || step.registryHash !== manifest.registryHash) {
      throw new AgentPlanContractError(`Plan 第 ${index + 1} 步 identity 不匹配`);
    }
    const descriptor = descriptorFor(manifest, expected.tool);
    if (step.toolName !== descriptor.name
      || step.toolVersion !== descriptor.version
      || step.scope !== descriptor.scope
      || !exactStringArray(step.permissionsJson, descriptor.permissions)
      || step.inputSchemaHash !== await canonicalHash(descriptor.inputSchema)
      || step.outputSchemaHash !== await canonicalHash(descriptor.outputSchema)
      || step.argumentsHash !== await canonicalHash(step.argumentsJson)) {
      throw new AgentPlanContractError(`Plan 步骤 ${step.stepKey} 的 schema、权限或参数已漂移`);
    }
    const actualDependencies = bundle.dependencies
      .filter((dependency) => dependency.stepId === step.stepId)
      .sort((left, right) => left.dependencyOrdinal - right.dependencyOrdinal)
      .map((dependency) => stepById.get(dependency.dependsOnStepId)?.ordinal);
    const expectedOrdinals = expected.dependencies.map((dependencyIndex) => dependencyIndex + 1);
    if (actualDependencies.some((ordinal) => ordinal === undefined)
      || actualDependencies.length !== expectedOrdinals.length
      || actualDependencies.some((ordinal, dependencyIndex) => (
        ordinal !== expectedOrdinals[dependencyIndex]
      ))) {
      throw new AgentPlanContractError(`Plan 步骤 ${step.stepKey} 的依赖图已漂移`);
    }
  }
}

export function nextRunnableStep(bundle: AgentPlanBundle): AgentPlanStepRecord | undefined {
  const statusByStep = new Map(bundle.steps.map((step) => [step.stepId, step.status]));
  return bundle.steps.find((step) => step.status === 'pending'
    && bundle.dependencies
      .filter((dependency) => dependency.stepId === step.stepId)
      .every((dependency) => statusByStep.get(dependency.dependsOnStepId) === 'completed'));
}
