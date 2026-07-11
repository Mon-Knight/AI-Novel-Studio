/**
 * AI Novel Studio - AI settings service.
 */
import { lsGet, lsSet } from '../database/db';
import type { AiSettings } from '../../types/ai';
import { RealAiClient, validateRealAiConfig } from './realAiClient';
import { unifiedAiPipeline } from '../ai-tasks/unifiedAiPipeline';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { normalizeAppError } from '../../types/appError';

const AI_SETTINGS_KEY = 'ai_novel_studio_ai_settings';

const defaultSettings: AiSettings = {
  runtimeMode: 'mock',
  provider: 'mock',
  baseUrl: '',
  apiKey: '',
  modelName: '',
  temperature: 0.7,
  maxTokens: 8000,
  timeoutSeconds: 120,
  mockMode: true,
};

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}

function migrateSettings(stored: Partial<AiSettings>): AiSettings {
  const merged = { ...defaultSettings, ...stored } as AiSettings;

  if (!merged.runtimeMode) {
    merged.runtimeMode = merged.mockMode ? 'mock' : 'api';
  }

  merged.runtimeMode = merged.runtimeMode === 'api' ? 'api' : 'mock';
  merged.mockMode = merged.runtimeMode === 'mock';
  merged.provider = merged.runtimeMode === 'mock'
    ? 'mock'
    : (merged.provider === 'deepseek' ? 'deepseek' : 'openai_compatible');
  merged.baseUrl = merged.baseUrl ?? '';
  merged.apiKey = merged.apiKey ?? '';
  merged.modelName = merged.modelName ?? '';
  merged.temperature = normalizeNumber(merged.temperature, 0.7, 0, 2);
  merged.maxTokens = Math.round(normalizeNumber(merged.maxTokens, 8000, 1, 200000));
  merged.timeoutSeconds = Math.round(normalizeNumber(merged.timeoutSeconds, 120, 1, 1800));

  return merged;
}

export function validateApiSettings(settings: AiSettings): void {
  if (settings.runtimeMode !== 'api') return;
  validateRealAiConfig({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    modelName: settings.modelName,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    timeoutSeconds: settings.timeoutSeconds,
  });
}

export const aiSettingsService = {
  getSettings(): AiSettings {
    const stored = lsGet<Partial<AiSettings>>(AI_SETTINGS_KEY);
    return stored ? migrateSettings(stored) : { ...defaultSettings };
  },

  saveSettings(settings: AiSettings): void {
    const normalized = migrateSettings(settings);
    lsSet(AI_SETTINGS_KEY, normalized);
  },

  maskApiKey(key: string): string {
    if (!key || key.length < 8) return key;
    return key.slice(0, 4) + '...' + key.slice(-4);
  },

  async testConnection(settings: AiSettings): Promise<{ ok: boolean; message: string }> {
    const normalized = migrateSettings({ ...settings, runtimeMode: 'api' });
    const start = Date.now();
    try {
      validateApiSettings(normalized);
      const client = new RealAiClient({
        baseUrl: normalized.baseUrl,
        apiKey: normalized.apiKey,
        modelName: normalized.modelName,
        temperature: normalized.temperature,
        maxTokens: normalized.maxTokens,
        timeoutSeconds: normalized.timeoutSeconds,
      });

      const prompt = '请只回复 OK，用于测试连接。';
      const request = {
        taskType: 'connection_test' as const,
        messages: [{ role: 'user' as const, content: prompt }],
        temperature: 0.1,
        maxTokens: 100,
      };
      const result = await unifiedAiPipeline.run({
        taskType: 'connection_test',
        novelId: 'system',
        scopeType: 'system',
        inputSnapshot: {
          schemaVersion: 1,
          inputType: 'connection_test_input',
          payloadJson: { expectedResponse: 'OK' },
        },
        contextSnapshot: {
          schemaVersion: 1,
          sourceManifestJson: [],
          budgetJson: { maxTokens: 100 },
          compilerVersion: 'connection-test-v1',
        },
        constraintSnapshot: {
          schemaVersion: 1,
          payloadJson: { responseMode: 'exact_text', expectedResponse: 'OK' },
          promptTemplateId: 'connection-test',
          promptTemplateVersion: '1',
          promptTemplateHash: await computeContentSha256(prompt),
          promptTemplateBody: prompt,
          providerOptionsJson: {
            provider: normalized.provider,
            model: normalized.modelName,
            temperature: 0.1,
            maxTokens: 100,
            timeoutSeconds: normalized.timeoutSeconds,
          },
        },
        artifactType: 'generic_text',
        expectedOk: true,
        providerId: normalized.provider,
        timeoutMs: (normalized.timeoutSeconds ?? 120) * 1000,
        client,
        request,
      });

      const latencyMs = Date.now() - start;
      return { ok: true, message: `连接成功，模型返回：${result.response.text.slice(0, 40).trim()}（${latencyMs}ms）` };
    } catch (e: unknown) {
      const message = normalizeAppError(e, '连接失败').message;
      return { ok: false, message };
    }
  },
};
