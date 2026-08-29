/**
 * AI Novel Studio - AI settings service.
 */
import type { AiGenerateOptions, AiSettings } from '../../types/ai';
import { requireLoopbackAiBaseUrl, validateRealAiConfig } from './realAiClient';
import { executeAiTask } from './aiExecutionPipeline';
import { isAiRequestCancelled } from './aiCancellation';
import { aiRequestPolicyService } from './aiRequestPolicyService';
import {
  getAiSettings,
  maskAiApiKey,
  normalizeAiSettings,
  resolveSessionModelApiKey,
  saveAiSettings,
  type SessionModelCredentialIdentity,
} from './aiSettingsStore';

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
    return getAiSettings();
  },

  async saveSettings(settings: AiSettings): Promise<void> {
    const normalized = normalizeAiSettings(settings);
    if (normalized.localChapterModel?.enabled) {
      requireLoopbackAiBaseUrl(normalized.localChapterModel.baseUrl);
    }
    await aiRequestPolicyService.configureGlobalPolicy(normalized);
    saveAiSettings(normalized);
  },

  maskApiKey(key: string): string {
    return maskAiApiKey(key);
  },

  resolveSessionApiKey(identity: SessionModelCredentialIdentity): string {
    return resolveSessionModelApiKey(identity);
  },

  async testConnection(
    settings: AiSettings,
    options: AiGenerateOptions = {},
  ): Promise<{ ok: boolean; message: string }> {
    const normalized = normalizeAiSettings({ ...settings, runtimeMode: 'api' });
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
