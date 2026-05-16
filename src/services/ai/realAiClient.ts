/**
 * AI Novel Studio - Real AI Client
 * OpenAI Compatible Chat Completions API
 */
import type { AiGenerateRequest, AiGenerateResponse, AiClient } from '../../types/ai';

interface RealAiClientConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
}

export class RealAiClient implements AiClient {
  private config: RealAiClientConfig;

  constructor(config: RealAiClientConfig) {
    this.config = config;
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const { baseUrl, apiKey, modelName, temperature, maxTokens, timeoutSeconds } = this.config;

    if (!baseUrl) throw new Error('API Base URL 未设置，请在设置中心配置 AI 接口。');
    if (!apiKey) throw new Error('API Key 未设置，请在设置中心配置 AI 接口。');
    if (!modelName) throw new Error('模型名称未设置，请在设置中心配置 AI 接口。');

    // 清理 URL
    let url = baseUrl.replace(/\/+$/, '');
    if (!url.endsWith('/v1') && !url.includes('/chat/completions')) {
      url += '/v1';
    }
    url += '/chat/completions';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (timeoutSeconds || 120) * 1000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: request.modelName || modelName,
          messages: request.messages,
          temperature: request.temperature ?? temperature ?? 0.7,
          max_tokens: request.maxTokens ?? maxTokens ?? 4000,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        if (response.status === 401) throw new Error('API Key 无效（401 Unauthorized），请检查设置。');
        if (response.status === 429) throw new Error('请求过于频繁（429），请稍后重试。');
        if (response.status >= 500) throw new Error(`AI 服务错误（${response.status}），请稍后重试。`);
        throw new Error(`AI 请求失败（${response.status}）：${errorBody.slice(0, 200)}`);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';

      if (!text.trim()) {
        throw new Error('AI 返回了空内容，请检查提示词或重试。');
      }

      return {
        text,
        raw: data,
        tokenInput: data.usage?.prompt_tokens,
        tokenOutput: data.usage?.completion_tokens,
      };
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`请求超时（${timeoutSeconds || 120}秒），请检查网络或增加超时时间。`);
      }
      throw err;
    }
  }
}
