/**
 * AI Novel Studio - OpenAI-Compatible real AI client.
 *
 * Tauri release builds use the Rust backend command to avoid WebView CORS
 * differences. Browser dev mode falls back to fetch with the same request body.
 */
import { invoke } from '@tauri-apps/api/tauri';
import type { AiGenerateRequest, AiGenerateResponse, AiClient } from '../../types/ai';
import { isTauri } from '../database/db';

export interface RealAiClientConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
}

interface TauriAiResponse {
  text: string;
  raw?: unknown;
  tokenInput?: number;
  tokenOutput?: number;
  tokenTotal?: number;
  totalTokens?: number;
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, '');

  if (clean.endsWith('/chat/completions')) {
    return clean;
  }

  if (clean.endsWith('/v1')) {
    return `${clean}/chat/completions`;
  }

  return `${clean}/v1/chat/completions`;
}

export function validateRealAiConfig(config: RealAiClientConfig): void {
  const missing: string[] = [];
  if (!config.baseUrl?.trim()) missing.push('API Base URL');
  if (!config.apiKey?.trim()) missing.push('API Key');
  if (!config.modelName?.trim()) missing.push('模型名称');
  if (missing.length > 0) {
    throw new Error(`当前为 API 模式，但 ${missing.join(' / ')} 未配置，请先到设置中心配置。`);
  }

  const temperature = config.temperature ?? 0.7;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new Error('temperature 配置不合法，请在设置中心填写 0 到 2 之间的数值。');
  }

  const maxTokens = config.maxTokens ?? 8000;
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    throw new Error('maxTokens 配置不合法，请在设置中心填写大于 0 的最大输出 Token。');
  }

  const timeoutSeconds = config.timeoutSeconds ?? 120;
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error('timeoutSeconds 配置不合法，请在设置中心填写大于 0 的超时时间。');
  }
}

function normalizeHttpError(status: number, errorBody: string, modelName: string): Error {
  if (status === 400) {
    return new Error(`AI 调用失败：请求参数不合法（400 Bad Request），请检查模型名称、max_tokens 和提示词格式。${shortBody(errorBody)}`);
  }
  if (status === 401) {
    return new Error('AI 调用失败：API Key 无效或已过期（401 Unauthorized），请检查设置中心的 API Key。');
  }
  if (status === 403) {
    const lowerBody = errorBody.toLowerCase();
    if (lowerBody.includes('model') || lowerBody.includes('permission') || lowerBody.includes('access')) {
      return new Error(`AI 调用失败：当前 API Key 无权访问模型「${modelName}」，请检查设置中心的模型名称或平台授权。`);
    }
    return new Error('AI 调用失败：服务拒绝访问（403 Forbidden），请检查 API Key 权限。');
  }
  if (status === 429) {
    return new Error('AI 调用失败：请求过于频繁或额度不足（429 Rate Limit），请稍后重试或检查账户额度。');
  }
  if (status >= 500) {
    if (errorBody.toLowerCase().includes('overload')) {
      return new Error('AI 调用失败：模型服务当前过载（overloaded_error），请稍后重试。');
    }
    return new Error(`AI 调用失败：模型服务错误（${status}），请稍后重试。${shortBody(errorBody)}`);
  }
  return new Error(`AI 调用失败：HTTP ${status}。${shortBody(errorBody)}`);
}

function shortBody(body: string): string {
  const text = body.trim();
  return text ? ` 服务返回：${text.slice(0, 240)}` : '';
}

function getLastUserMessage(request: AiGenerateRequest): string {
  return [...request.messages].reverse().find((message) => message.role === 'user')?.content || '';
}

export class RealAiClient implements AiClient {
  private config: RealAiClientConfig;

  constructor(config: RealAiClientConfig) {
    this.config = config;
  }

  async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    validateRealAiConfig(this.config);

    if (import.meta.env.DEV) {
      const lastUserMessage = getLastUserMessage(request);
      console.info(`[RealAiClient] messages count=${request.messages.length}`);
      console.info(`[RealAiClient] last user message includes chapterOutline=${lastUserMessage.includes('【当前章节大纲】')}`);
      console.info(`[RealAiClient] last user message includes outline checklist=${lastUserMessage.includes('【章节大纲执行清单】')}`);
      console.info(`[RealAiClient] last user message includes requiredCharacters=${lastUserMessage.includes('【本章必须直接出场角色】')}`);
    }

    if (isTauri()) {
      return this.generateViaTauri(request);
    }

    return this.generateViaFetch(request);
  }

  private buildRequestBody(request: AiGenerateRequest): Record<string, unknown> {
    return {
      model: request.modelName || this.config.modelName.trim(),
      messages: request.messages,
      temperature: request.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? this.config.maxTokens ?? 8000,
    };
  }

  private async generateViaTauri(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const response = await invoke<TauriAiResponse>('ai_chat_completion', {
      request: {
        baseUrl: this.config.baseUrl,
        apiKey: this.config.apiKey,
        modelName: request.modelName || this.config.modelName,
        messages: request.messages,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        maxTokens: request.maxTokens ?? this.config.maxTokens ?? 8000,
        timeoutSeconds: this.config.timeoutSeconds ?? 120,
      },
    });

    return {
      text: response.text,
      raw: response.raw,
      tokenInput: response.tokenInput,
      tokenOutput: response.tokenOutput,
      tokenTotal: response.tokenTotal ?? response.totalTokens,
    };
  }

  private async generateViaFetch(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const url = buildChatCompletionsUrl(this.config.baseUrl);
    const controller = new AbortController();
    const timeoutSeconds = this.config.timeoutSeconds ?? 120;
    const timeout = window.setTimeout(() => controller.abort(), timeoutSeconds * 1000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(this.buildRequestBody(request)),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw normalizeHttpError(response.status, errorBody, request.modelName || this.config.modelName);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';

      if (!String(text).trim()) {
        throw new Error('AI 调用失败：模型返回空内容，请检查提示词、模型名称或重试。');
      }

      return {
        text,
        raw: data,
        tokenInput: data.usage?.prompt_tokens,
        tokenOutput: data.usage?.completion_tokens,
        tokenTotal: data.usage?.total_tokens,
      };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`AI 调用失败：请求超时（${timeoutSeconds} 秒），请检查网络或增加超时时间。`);
      }
      if (err instanceof TypeError && String(err.message).includes('fetch')) {
        throw new Error('AI 调用失败：网络请求失败，请检查 API Base URL、网络连接或代理设置。');
      }
      throw err;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}
