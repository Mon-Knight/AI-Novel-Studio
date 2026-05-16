/**
 * AI Novel Studio - AI Client 工厂
 */
import type { AiClient } from '../../types/ai';
import { MockAiClient } from './mockAiClient';
import { RealAiClient } from './realAiClient';
import { aiSettingsService } from './aiSettingsService';

export function createAiClient(): AiClient {
  const settings = aiSettingsService.getSettings();

  if (settings.mockMode) {
    return new MockAiClient();
  }

  return new RealAiClient({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    modelName: settings.modelName,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    timeoutSeconds: settings.timeoutSeconds,
  });
}

export { aiSettingsService } from './aiSettingsService';
export { MockAiClient } from './mockAiClient';
export { RealAiClient } from './realAiClient';
