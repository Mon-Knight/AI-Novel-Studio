/**
 * AI Novel Studio - AI settings service.
 */
import type { AiGenerateOptions, AiSettings } from '../../types/ai';
import { requireLoopbackAiBaseUrl, validateRealAiConfig } from './realAiClient';
import { executeAiTask } from './aiExecutionPipeline';
import { isAiRequestCancelled } from './aiCancellation';
import { AiRequestPolicyError, aiRequestPolicyService } from './aiRequestPolicyService';
import {
  getAiSettings,
  maskAiApiKey,
  normalizeAiSettings,
  resolveSessionModelApiKey,
  rememberSessionModelApiKey,
  restoreSessionModelCredentialsFromNative,
  saveAiSettings,
  syncSessionModelCredentialsToNative,
  type SessionModelCredentialIdentity,
} from './aiSettingsStore';
import type { SavedApiModelProfile } from '../../types/ai';
import { isTauriRuntime } from '../tauri/runtime';

export type AiRuntimeSyncStatus = 'skipped' | 'ready' | 'not_registered' | 'error';

export interface AiRuntimeSyncResult {
  status: AiRuntimeSyncStatus;
  message?: string;
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
    return getAiSettings();
  },

  /**
   * Persists provider, credential and governance state. Runtime registration is
   * a separate, bounded step so saving never blocks on Worker startup.
   */
  async saveSettings(settings: AiSettings): Promise<void> {
    const normalized = normalizeAiSettings(settings);
    if (normalized.localChapterModel?.enabled) {
      requireLoopbackAiBaseUrl(normalized.localChapterModel.baseUrl);
    }
    try {
      await aiRequestPolicyService.configureGlobalPolicy(normalized);
    } catch (error) {
      if (
        error instanceof AiRequestPolicyError &&
        error.code === 'AI_REQUEST_POLICY_CONFIG_CONFLICT'
      ) {
        await syncSessionModelCredentialsToNative(normalized);
        saveAiSettings(normalized);
      }
      throw error;
    }
    await syncSessionModelCredentialsToNative(normalized);
    saveAiSettings(normalized);
  },

  async saveConnectionTestResult(settings: AiSettings): Promise<void> {
    const normalized = normalizeAiSettings(settings);
    await syncSessionModelCredentialsToNative(normalized);
    saveAiSettings(normalized);
  },

  /**
   * Registers the saved API model with the pinned Runtime through its isolated
   * probe. The result is derived only from the Runtime projection; a failed or
   * absent model row is reported instead of being treated as ready.
   */
  async syncRuntimeModel(settings?: AiSettings): Promise<AiRuntimeSyncResult> {
    const normalized = normalizeAiSettings(settings ?? getAiSettings());
    if (
      !isTauriRuntime() ||
      normalized.runtimeMode !== 'api' ||
      !normalized.baseUrl.trim() ||
      !normalized.modelName.trim()
    ) {
      return { status: 'skipped' };
    }

    try {
      const [{ dshTaskRuntimeService }, { captureTaskModelSnapshotFromSettings }] =
        await Promise.all([
          import('../dsh/taskRuntimeService'),
          import('../conversation/taskModelSnapshot'),
        ]);
      const snapshot = captureTaskModelSnapshotFromSettings(normalized);
      const rows = await dshTaskRuntimeService.initializeConfiguredModel(snapshot);
      const expectedId = `model:${snapshot.providerId}:${snapshot.modelId}`;
      const model = rows.find((row) => row.id === expectedId);
      if (!model) {
        return {
          status: 'not_registered',
          message: `Runtime 未返回模型 ${snapshot.providerId}:${snapshot.modelId} 的注册结果。`,
        };
      }
      if (
        model.status !== 'loaded' ||
        model.initialization !== 'initialized' ||
        model.availability !== 'available'
      ) {
        return {
          status: 'not_registered',
          message: `Runtime 尚未确认模型 ${snapshot.providerId}:${snapshot.modelId} 已初始化（status=${String(
            model.status,
          )}, initialization=${String(model.initialization)}）。`,
        };
      }
      return { status: 'ready' };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error || 'Runtime 初始化失败');
      return { status: 'error', message };
    }
  },
  maskApiKey(key: string): string {
    return maskAiApiKey(key);
  },

  resolveSessionApiKey(identity: SessionModelCredentialIdentity): string {
    return resolveSessionModelApiKey(identity);
  },

  rememberProviderApiKey(
    profile: Pick<SavedApiModelProfile, 'provider' | 'baseUrl' | 'modelName'>,
    apiKey: string,
  ): void {
    rememberSessionModelApiKey(
      {
        scope: 'provider',
        providerId: profile.provider,
        baseUrl: profile.baseUrl,
        modelId: profile.modelName,
      },
      apiKey,
    );
  },

  async restoreSessionCredentials(): Promise<void> {
    await restoreSessionModelCredentialsFromNative();
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
