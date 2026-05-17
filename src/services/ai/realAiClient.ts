/**
 * AI Novel Studio - Real AI Client (v1.0.22)
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

/**
 * 安全拼接 Chat Completions URL
 * 支持：https://api.deepseek.com
 *       https://api.deepseek.com/v1
 *       https://api.deepseek.com/v1/chat/completions
 *       https://ai678.top/v1
 *       https://token-plan-cn.xiaomimimo.com/v1
 */
function buildChatCompletionsUrl(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, '');

  if (clean.endsWith('/chat/completions')) {
    return clean;
  }

  if (clean.endsWith('/v1')) {
    return `${clean}/chat/completions`;
  }

  return `${clean}/v1/chat/completions`;
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

    const url = buildChatCompletionsUrl(baseUrl);

    const controller = new AbortController();
    const timeoutMs = (timeoutSeconds || 120) * 1000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // 构建请求体：不发送 top_p 避免兼容性问题
      const body: Record<string, unknown> = {
        model: request.modelName || modelName,
        messages: request.messages,
        temperature: request.temperature ?? temperature ?? 0.7,
        max_tokens: request.maxTokens ?? maxTokens ?? 8000,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        const status = response.status;

        if (status === 401) {
          throw new Error('API Key 无效（401 Unauthorized），请检查 API Key 是否正确。');
        }
        if (status === 403) {
          const lowerBody = errorBody.toLowerCase();
          if (lowerBody.includes('model') || lowerBody.includes('permission') || lowerBody.includes('access')) {
            throw new Error(`当前令牌无权访问模型「${modelName}」（403 Forbidden），请检查 modelName 是否与平台授权一致。`);
          }
          throw new Error('访问被拒绝（403 Forbidden），请检查 API Key 权限。');
        }
        if (status === 429) {
          throw new Error('请求过于频繁（429 Rate Limit），请稍后重试或降低请求频率。');
        }
        if (status >= 500) {
          if (errorBody.includes('overloaded') || errorBody.includes('overload')) {
            throw new Error('AI 服务当前过载（overloaded），请稍后重试。');
          }
          throw new Error(`AI 服务错误（${status}），请稍后重试。`);
        }
        throw new Error(`AI 请求失败（${status}）：${errorBody.slice(0, 200)}`);
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
        throw new Error(`请求超时（${timeoutSeconds || 120}秒），请检查网络连接或增加超时时间。`);
      }
      // 如果已经是友好错误信息，直接抛出
      if (err instanceof Error && err.message && !err.message.includes('[object')) {
        throw err;
      }
      throw new Error(`网络请求失败：${String(err).slice(0, 200)}`);
    }
  }
}
