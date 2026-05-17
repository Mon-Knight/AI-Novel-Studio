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
  maxTokens: 8000,
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
    const startTime = Date.now();
    try {
      // 校验必填字段
      if (!settings.baseUrl?.trim()) return { ok: false, message: '请先填写 API Base URL' };
      if (!settings.apiKey?.trim()) return { ok: false, message: '请先填写 API Key' };
      if (!settings.modelName?.trim()) return { ok: false, message: '请先填写模型名称' };

      // 使用与 realAiClient 相同的 URL 构建逻辑
      const clean = settings.baseUrl.trim().replace(/\/+$/, '');
      let url: string;
      if (clean.endsWith('/chat/completions')) {
        url = clean;
      } else if (clean.endsWith('/v1')) {
        url = `${clean}/chat/completions`;
      } else {
        url = `${clean}/v1/chat/completions`;
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.modelName,
          messages: [{ role: 'user', content: '请只回复"OK"，用于测试连接。' }],
          temperature: 0.1,
          max_tokens: 100,
        }),
        signal: AbortSignal.timeout(15000),
      });

      const latencyMs = Date.now() - startTime;

      if (resp.ok) {
        const data = await resp.json();
        const text = data.choices?.[0]?.message?.content || '';
        if (text.trim()) {
          return { ok: true, message: `连接成功！（${latencyMs}ms，返回 ${text.slice(0, 20).trim()}）` };
        }
        return { ok: true, message: `连接成功！（${latencyMs}ms，但返回内容为空，请检查模型配置）` };
      }

      const errorBody = await resp.text().catch(() => '');
      const status = resp.status;

      if (status === 401) {
        return { ok: false, message: 'API Key 无效（401 Unauthorized），请检查 API Key 是否正确。' };
      }
      if (status === 403) {
        const lowerBody = errorBody.toLowerCase();
        if (lowerBody.includes('model') || lowerBody.includes('permission') || lowerBody.includes('access')) {
          return { ok: false, message: `当前令牌无权访问模型「${settings.modelName}」（403 Forbidden），请检查 modelName 是否与平台授权一致。` };
        }
        return { ok: false, message: '访问被拒绝（403 Forbidden），请检查 API Key 权限。' };
      }
      if (status === 429) {
        return { ok: false, message: '请求过于频繁（429 Rate Limit），请稍后重试。' };
      }
      return { ok: false, message: `HTTP ${status}: ${errorBody.slice(0, 200)}` };
    } catch (e: any) {
      const latencyMs = Date.now() - startTime;
      const msg = e.message || String(e);
      if (msg.includes('timeout') || msg.includes('Timeout') || msg.includes('abort')) {
        return { ok: false, message: `连接超时（15秒），请检查 API Base URL 是否正确，或网络是否可达。` };
      }
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('network')) {
        return { ok: false, message: `网络请求失败（${latencyMs}ms 后超时），请检查：1) Base URL 是否正确 2) 网络是否连通 3) 是否需要代理。` };
      }
      return { ok: false, message: msg.slice(0, 200) || '网络请求失败' };
    }
  },
};
