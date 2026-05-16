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
};
