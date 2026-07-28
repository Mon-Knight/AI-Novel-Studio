/**
 * AI Novel Studio - AI Client 工厂
 */
import type { AiClient, AiSettings } from '../../types/ai';
import { MockAiClient } from './mockAiClient';
import { RealAiClient } from './realAiClient';
import { aiSettingsService } from './aiSettingsService';
import { attachAiUsageCost } from './aiCost';

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
      return attachAiUsageCost(await client.generate(request, options), resolvedSettings);
    },
  };
}

export { aiSettingsService } from './aiSettingsService';
export { MockAiClient } from './mockAiClient';
export { RealAiClient } from './realAiClient';
