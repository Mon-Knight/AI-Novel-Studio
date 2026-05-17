/**
 * AI Novel Studio - AI settings service.
 */
import { lsGet, lsSet } from '../database/db';
import type { AiSettings } from '../../types/ai';
import { RealAiClient, validateRealAiConfig } from './realAiClient';
import { aiTaskService } from './aiTaskService';

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
    const task = await aiTaskService.create('connection_test', {
      runtimeMode: 'api',
      provider: normalized.provider,
      modelName: normalized.modelName,
      inputSummary: '测试设置中心 API 连接',
    }).catch(() => null);

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

      const response = await client.generate({
        taskType: 'connection_test',
        messages: [{ role: 'user', content: '请只回复 OK，用于测试连接。' }],
        temperature: 0.1,
        maxTokens: 100,
      });

      const latencyMs = Date.now() - start;
      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: response.text,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
      });

      return { ok: true, message: `连接成功，模型返回：${response.text.slice(0, 40).trim()}（${latencyMs}ms）` };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e || '连接失败');
      if (task) await aiTaskService.markFailed(task.id, message);
      return { ok: false, message };
    }
  },
};
