/**
 * AI Novel Studio - AI settings service.
 */
import { lsGet, lsSet } from '../database/db';
import type { AiSettings } from '../../types/ai';
import { validateRealAiConfig } from './realAiClient';
import { buildConnectionTestPrompt } from './promptBuilder';
import { executeAiTask } from './aiExecutionPipeline';

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

  async testConnection(settings: AiSettings): Promise<{ ok: boolean; message: string }> {
    const normalized = migrateSettings({ ...settings, runtimeMode: 'api' });
    try {
      validateApiSettings(normalized);
      const request = buildConnectionTestPrompt();
      const systemPrompt = request.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n');
      const result = await executeAiTask({
        taskType: 'connection_test',
        scopeType: 'system',
        novelId: 'system',
        expectedArtifactType: 'generic_text',
        request,
        settings: normalized,
        inputType: 'connection_test_messages_v1',
        inputPayloadJson: { purpose: 'settings_connection_test' },
        sourceManifestJson: { sources: [] },
        compiledContext: systemPrompt,
        compilerVersion: 'connection_test_v1',
        constraintPayloadJson: { expectedExactText: 'OK' },
        promptTemplateId: 'system/connection_test',
        promptTemplateVersion: '1',
        promptTemplateBody: systemPrompt,
      });
      const valid = result.text.trim() === 'OK'
        && result.artifactBundle?.artifact.processingStatus !== 'invalid';
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
      const message = e instanceof Error ? e.message : String(e || '连接失败');
      return { ok: false, message };
    }
  },
};
