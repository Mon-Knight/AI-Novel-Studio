/**
 * AI Novel Studio - AI settings service.
 */
import { lsGet, lsSet } from '../database/db';
import type { AiGenerateOptions, AiSettings } from '../../types/ai';
import { validateRealAiConfig } from './realAiClient';
import { executeAiTask } from './aiExecutionPipeline';
import { isAiRequestCancelled } from './aiCancellation';

const AI_SETTINGS_KEY = 'ai_novel_studio_ai_settings';
const E2E_ENABLED = import.meta.env.VITE_AI_NOVEL_STUDIO_E2E === '1';

const defaultSettings: AiSettings = {
  runtimeMode: 'mock',
  provider: 'mock',
  baseUrl: '',
  apiKey: '',
  modelName: '',
  temperature: 0.7,
  maxTokens: 8000,
  timeoutSeconds: 120,
  maxRequestsPerMinute: 12,
  maxConcurrentAiRequests: 2,
  budgetWarningPercent: 80,
  mockMode: true,
};

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}

function normalizeOptionalPrice(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.min(1_000_000, Math.max(0, numeric));
}

function normalizeOptionalBudget(value: unknown, maximum: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.min(maximum, numeric);
}

function migrateSettings(stored: Partial<AiSettings>): AiSettings {
  const merged = { ...defaultSettings, ...stored } as AiSettings;

  if (!merged.runtimeMode) {
    merged.runtimeMode = merged.mockMode ? 'mock' : 'api';
  }

  merged.runtimeMode = merged.runtimeMode === 'api' ? 'api' : 'mock';
  merged.mockMode = merged.runtimeMode === 'mock';
  merged.provider =
    merged.runtimeMode === 'mock'
      ? 'mock'
      : merged.provider === 'deepseek'
        ? 'deepseek'
        : 'openai_compatible';
  merged.baseUrl = merged.baseUrl ?? '';
  merged.apiKey = merged.apiKey ?? '';
  merged.modelName = merged.modelName ?? '';
  merged.temperature = normalizeNumber(merged.temperature, 0.7, 0, 2);
  merged.maxTokens = Math.round(normalizeNumber(merged.maxTokens, 8000, 1, 200000));
  merged.timeoutSeconds = Math.round(normalizeNumber(merged.timeoutSeconds, 120, 1, 1800));
  merged.inputPricePerMillionTokens = normalizeOptionalPrice(merged.inputPricePerMillionTokens);
  merged.outputPricePerMillionTokens = normalizeOptionalPrice(merged.outputPricePerMillionTokens);
  merged.maxRequestsPerMinute = Math.round(
    normalizeNumber(merged.maxRequestsPerMinute, 12, 1, 120),
  );
  merged.maxConcurrentAiRequests = Math.round(
    normalizeNumber(merged.maxConcurrentAiRequests, 2, 1, 8),
  );
  merged.dailyTokenBudget = normalizeOptionalBudget(merged.dailyTokenBudget, 10_000_000_000);
  merged.dailyCostBudgetUsd = normalizeOptionalBudget(merged.dailyCostBudgetUsd, 1_000_000);
  merged.budgetWarningPercent = Math.round(
    normalizeNumber(merged.budgetWarningPercent, 80, 50, 99),
  );

  if (
    merged.dailyCostBudgetUsd !== undefined &&
    (merged.inputPricePerMillionTokens === undefined ||
      merged.outputPricePerMillionTokens === undefined)
  ) {
    merged.dailyCostBudgetUsd = undefined;
  }

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
    if (E2E_ENABLED) return { ...defaultSettings };
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

  async testConnection(
    settings: AiSettings,
    options: AiGenerateOptions = {},
  ): Promise<{ ok: boolean; message: string }> {
    const normalized = migrateSettings({ ...settings, runtimeMode: 'api' });
    try {
      validateApiSettings(normalized);
      const result = await executeAiTask({
        taskType: 'connection_test',
        scopeType: 'system',
        novelId: 'system',
        settings: normalized,
        compilation: {
          sources: [],
          taskInput: { purpose: 'settings_connection_test' },
        },
        signal: options.signal,
      });
      const valid =
        result.text.trim() === 'OK' &&
        result.artifactBundle?.artifact.processingStatus !== 'invalid';
      if (!valid) {
        return {
          ok: false,
          message: `连接已建立，但模型未按要求返回 OK：${result.text.slice(0, 40).trim()}`,
        };
      }
      return {
        ok: true,
        message: `连接成功，模型返回：${result.text.slice(0, 40).trim()}（${result.provider.durationMs}ms）`,
      };
    } catch (e: unknown) {
      if (options.signal?.aborted || isAiRequestCancelled(e)) throw e;
      const message = e instanceof Error ? e.message : String(e || '连接失败');
      return { ok: false, message };
    }
  },
};
