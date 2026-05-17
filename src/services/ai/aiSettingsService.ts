/**
 * AI Novel Studio - AI 设置服务
 */
import { lsGet, lsSet } from '../database/db';
import type { AiSettings } from '../../types/ai';

const AI_SETTINGS_KEY = 'ai_novel_studio_ai_settings';

const defaultSettings: AiSettings = {
  baseUrl: '',
  apiKey: '',
  modelName: '',
  temperature: 0.7,
  maxTokens: 4000,
  timeoutSeconds: 120,
  mockMode: true,
};

export const aiSettingsService = {
  getSettings(): AiSettings {
    const stored = lsGet<AiSettings>(AI_SETTINGS_KEY);
    return stored ? { ...defaultSettings, ...stored } : { ...defaultSettings };
  },

  saveSettings(settings: AiSettings): void {
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
