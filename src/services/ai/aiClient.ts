/**
 * AI Novel Studio - AI Client 工厂
 */
import type { AiClient, AiSettings } from '../../types/ai';
import { MockAiClient } from './mockAiClient';
import { RealAiClient } from './realAiClient';
import { aiSettingsService } from './aiSettingsService';

export function createAiClient(settings?: AiSettings): AiClient {
  const resolvedSettings = settings ?? aiSettingsService.getSettings();

  if (resolvedSettings.runtimeMode === 'mock') {
    return new MockAiClient();
  }

  return new RealAiClient({
    baseUrl: resolvedSettings.baseUrl,
    apiKey: resolvedSettings.apiKey,
    modelName: resolvedSettings.modelName,
    temperature: resolvedSettings.temperature,
    maxTokens: resolvedSettings.maxTokens,
    timeoutSeconds: resolvedSettings.timeoutSeconds,
  });
}

export { aiSettingsService } from './aiSettingsService';
export { MockAiClient } from './mockAiClient';
export { RealAiClient } from './realAiClient';
