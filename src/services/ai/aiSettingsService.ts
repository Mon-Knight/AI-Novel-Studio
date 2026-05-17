/**
 * AI Novel Studio - AI 设置服务
 */
import { lsGet, lsSet } from '../database/db';
import type { AiSettings } from '../../types/ai';

const AI_SETTINGS_KEY = 'ai_novel_studio_ai_settings';

const defaultSettings: AiSettings = {
  runtimeMode: 'mock',
  provider: 'openai_compatible',
  baseUrl: '',
  apiKey: '',
  modelName: '',
  temperature: 0.7,
  maxTokens: 4000,
  timeoutSeconds: 120,
  mockMode: true,
};

function migrateSettings(stored: Partial<AiSettings>): AiSettings {
  const merged = { ...defaultSettings, ...stored } as AiSettings;
  // 兼容旧数据：如果没有 runtimeMode，从 mockMode 派生
  if (!merged.runtimeMode) {
    merged.runtimeMode = merged.mockMode ? 'mock' : 'api';
  }
  // 确保 mockMode 与 runtimeMode 一致
  merged.mockMode = merged.runtimeMode === 'mock';
  return merged;
}

export const aiSettingsService = {
  getSettings(): AiSettings {
    const stored = lsGet<Partial<AiSettings>>(AI_SETTINGS_KEY);
    return stored ? migrateSettings(stored) : { ...defaultSettings };
  },

  saveSettings(settings: AiSettings): void {
    // 保存前统一状态
    settings.mockMode = settings.runtimeMode === 'mock';
    lsSet(AI_SETTINGS_KEY, settings);
  },

  maskApiKey(key: string): string {
    if (!key || key.length < 8) return key;
    return key.slice(0, 4) + '...' + key.slice(-4);
  },

  async testConnection(settings: AiSettings): Promise<{ ok: boolean; message: string }> {
    try {
      const resp = await fetch(settings.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.apiKey}` },
        body: JSON.stringify({ model: settings.modelName, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
        signal: AbortSignal.timeout(15000),
      });
      if (resp.ok) return { ok: true, message: 'API 连接正常' };
      const text = await resp.text();
      return { ok: false, message: `HTTP ${resp.status}: ${text.slice(0, 100)}` };
    } catch (e: any) {
      return { ok: false, message: e.message || '网络请求失败' };
    }
  },
};
