/**
 * AI Novel Studio - AI Client 工厂
 */
import type { AiClient, AiSettings } from '../../types/ai';
import { MockAiClient } from './mockAiClient';
import { RealAiClient } from './realAiClient';
import { aiSettingsService } from './aiSettingsService';
import { attachAiUsageCost } from './aiCost';

const GOVERNED_TASK_TYPES = new Set([
  'chapter_generate',
  'chapter_beat_repair',
  'chapter_scene_generate',
  'chapter_scene_plan_generate',
  'autonomous_plot_plan',
  'autonomous_character_evolution',
  'autonomous_world_build',
  'autonomous_conflict_generate',
  'autonomous_pacing_control',
  'autonomous_chapter_batch',
]);

export function createAiClient(settings?: AiSettings): AiClient {
  const resolvedSettings = settings ?? aiSettingsService.getSettings();
  const client: AiClient =
    resolvedSettings.runtimeMode === 'mock'
      ? new MockAiClient()
      : new RealAiClient({
          baseUrl: resolvedSettings.baseUrl,
          apiKey: resolvedSettings.apiKey,
          modelName: resolvedSettings.modelName,
          temperature: resolvedSettings.temperature,
          maxTokens: resolvedSettings.maxTokens,
          timeoutSeconds: resolvedSettings.timeoutSeconds,
          provider: resolvedSettings.provider,
          inputPricePerMillionTokens: resolvedSettings.inputPricePerMillionTokens,
          outputPricePerMillionTokens: resolvedSettings.outputPricePerMillionTokens,
          maxRequestsPerMinute: resolvedSettings.maxRequestsPerMinute,
          maxConcurrentAiRequests: resolvedSettings.maxConcurrentAiRequests,
          dailyTokenBudget: resolvedSettings.dailyTokenBudget,
          dailyCostBudgetUsd: resolvedSettings.dailyCostBudgetUsd,
          budgetWarningPercent: resolvedSettings.budgetWarningPercent,
        });

  return {
    async generate(request, options) {
      if (request.taskType && GOVERNED_TASK_TYPES.has(request.taskType)) {
        throw new Error(
          `Task ${request.taskType} must run through executeAiTask and its compiled contract.`,
        );
      }
      return attachAiUsageCost(await client.generate(request, options), resolvedSettings);
    },
  };
}

export { aiSettingsService } from './aiSettingsService';
export { MockAiClient } from './mockAiClient';
export { RealAiClient } from './realAiClient';
