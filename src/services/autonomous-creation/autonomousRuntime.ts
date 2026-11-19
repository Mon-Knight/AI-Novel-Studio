import { autonomousPlanPersistence } from './autonomousPersistence';
import { AiAutonomousCreationProvider } from './autonomousProvider';
import { AutonomousStoryService } from './autonomousStoryService';
import { aiSettingsService } from '../ai/aiSettingsService';

import { isTauri, generateId } from '../database/db';
import type { GenerateAutonomousPlanInput } from '../../types/autonomousCreation';
import { validateStoryBrief } from './autonomousPlanBuilder';
import { submitProductionAiEntry } from './productionAiEntryService';

// Restricted browser development compatibility; never selected by desktop models.
const browserPlanning = new AutonomousStoryService({
  provider: new AiAutonomousCreationProvider(),
  persistence: autonomousPlanPersistence,
  maxConcurrentProviderCalls: () =>
    Math.max(1, aiSettingsService.getSettings().maxConcurrentAiRequests ?? 2),
});

export const autonomousStoryService = {
  async generate(input: GenerateAutonomousPlanInput) {
    if (!isTauri()) return browserPlanning.generate(input);
    const brief = validateStoryBrief(input.brief);
    const planningMode =
      input.planningMode ??
      (input.baseline &&
      (input.baseline.existingVolumes.length > 0 || input.baseline.existingChapters.length > 0)
        ? 'continuation'
        : 'greenfield');
    const operationId = input.operationId ?? generateId();
    const previous = await autonomousPlanPersistence.getPlanByOperation(operationId);
    const frozen = previous;
    await submitProductionAiEntry({
      novelId: input.novelId,
      goal: `生成全书自主规划候选：${brief.premise}`,
      entry: {
        kind: 'autonomous_plan',
        operationId,
        brief,
        planningMode,
        volumeStrategy: input.volumeStrategy ?? 'create_new_volume',
        baseline: input.baseline,
        resumePlanId: previous?.planId,
      },
      conversationId: frozen?.runtimeConversationId,
      modelSnapshot: frozen?.runtimeModelSnapshot,
      signal: input.signal,
    });
    const plan = await autonomousPlanPersistence.getPlanByOperation(operationId);
    if (!plan || plan.novelId !== input.novelId || !['ready', 'applied'].includes(plan.status)) {
      throw new Error('统一任务未生成完整的全书规划；请查看任务阶段与停止原因。');
    }
    input.onProgress?.(plan);
    return plan;
  },
  async resume(
    planId: string,
    signal?: AbortSignal,
    onProgress?: GenerateAutonomousPlanInput['onProgress'],
  ) {
    if (!isTauri()) return browserPlanning.resume(planId, signal, onProgress);
    const plan = await autonomousPlanPersistence.getPlan(planId);
    if (!plan) throw new Error('自主创作计划不存在。');
    return autonomousStoryService.generate({
      novelId: plan.novelId,
      brief: plan.brief,
      operationId: plan.operationId,
      planningMode: plan.planningMode,
      volumeStrategy: plan.volumeStrategy,
      baseline: plan.baseline,
      signal,
      onProgress,
    });
  },
  getPlan: autonomousPlanPersistence.getPlan,
  listPlansByNovel: autonomousPlanPersistence.listPlansByNovel,
  applyPlan: autonomousPlanPersistence.applyPlan,
};
