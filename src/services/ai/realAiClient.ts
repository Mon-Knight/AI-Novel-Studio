/**
 * AI Novel Studio - OpenAI-Compatible real AI client.
 *
 * Tauri release builds use the Rust backend command to avoid WebView CORS
 * differences. Browser dev mode falls back to fetch with the same request body.
 */
import { invoke } from '@tauri-apps/api/tauri';
import type { AiGenerateOptions, AiGenerateRequest, AiGenerateResponse, AiClient } from '../../types/ai';
import { isTauri } from '../database/db';
import {
  AiRequestCancelledError,
  isAiRequestCancelled,
  throwIfAiRequestCancelled,
} from './aiCancellation';

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
    return new Error('AI 调用失败：请求参数不合法（400 Bad Request），请检查模型名称、max_tokens 和提示词格式。');
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
    return new Error(`AI 调用失败：模型服务错误（${status}），请稍后重试。`);
  }
  return new Error(`AI 调用失败：HTTP ${status}。`);
}

function getLastUserMessage(request: AiGenerateRequest): string {
  return [...request.messages].reverse().find((message) => message.role === 'user')?.content || '';
}

function createAiRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `ai-${uuid}` : `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class RealAiClient implements AiClient {
  private config: RealAiClientConfig;

  constructor(config: RealAiClientConfig) {
    this.config = config;
  }

  async generate(request: AiGenerateRequest, options: AiGenerateOptions = {}): Promise<AiGenerateResponse> {
    throwIfAiRequestCancelled(options.signal);
    validateRealAiConfig(this.config);

    if (import.meta.env.DEV) {
      const lastUserMessage = getLastUserMessage(request);
      console.info(`[RealAiClient] messages count=${request.messages.length}`);
      console.info(`[RealAiClient] last user message includes chapterOutline=${lastUserMessage.includes('【当前章节大纲】')}`);
      console.info(`[RealAiClient] last user message includes outline checklist=${lastUserMessage.includes('【章节大纲执行清单】')}`);
      console.info(`[RealAiClient] last user message includes requiredCharacters=${lastUserMessage.includes('【本章必须直接出场角色】')}`);
    }

    if (isTauri()) {
      return this.generateViaTauri(request, options);
    }

    return this.generateViaFetch(request, options);
  }

  private buildRequestBody(request: AiGenerateRequest): Record<string, unknown> {
    return {
      model: request.modelName || this.config.modelName.trim(),
      messages: request.messages,
      temperature: request.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? this.config.maxTokens ?? 8000,
    };
  }

  private async generateViaTauri(
    request: AiGenerateRequest,
    options: AiGenerateOptions,
  ): Promise<AiGenerateResponse> {
    const signal = options.signal;
    const requestId = options.requestId?.trim() || (signal ? createAiRequestId() : undefined);
    const responsePromise = invoke<TauriAiResponse>('ai_chat_completion', {
      request: {
        requestId,
        baseUrl: this.config.baseUrl,
        apiKey: this.config.apiKey,
        modelName: request.modelName || this.config.modelName,
        messages: request.messages,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        maxTokens: request.maxTokens ?? this.config.maxTokens ?? 8000,
        timeoutSeconds: this.config.timeoutSeconds ?? 120,
      },
    });

    let removeAbortListener: () => void = () => {};
    let response: TauriAiResponse;
    try {
      if (!signal || !requestId) {
        response = await responsePromise;
      } else {
        type ResponseOutcome =
          | { kind: 'response'; response: TauriAiResponse }
          | { kind: 'response-error'; error: unknown };
        type CancellationOutcome = { kind: 'cancellation'; confirmed: boolean };
        const responseOutcome = responsePromise.then<ResponseOutcome, ResponseOutcome>(
          (value) => ({ kind: 'response', response: value }),
          (error: unknown) => ({ kind: 'response-error', error }),
        );
        let abortHandled = false;
        const cancellationOutcome = new Promise<CancellationOutcome>((resolve) => {
          const onAbort = () => {
            if (abortHandled) return;
            abortHandled = true;
            void invoke<boolean>('cancel_ai_request', { requestId }).then(
              () => resolve({ kind: 'cancellation', confirmed: true }),
              () => {
                console.warn(
                  '[RealAiClient] cancel_ai_request could not be confirmed; waiting for the active request to settle.',
                );
                resolve({ kind: 'cancellation', confirmed: false });
              },
            );
          };
          signal.addEventListener('abort', onAbort, { once: true });
          removeAbortListener = () => signal.removeEventListener('abort', onAbort);
          if (signal.aborted) onAbort();
        });
        const outcome = await Promise.race([responseOutcome, cancellationOutcome]);
        if (outcome.kind === 'cancellation') {
          if (!outcome.confirmed) {
            // The IPC transport failed, so do not report cancellation until the
            // original command has settled and can no longer produce a late result.
            await responseOutcome;
          }
          throw new AiRequestCancelledError();
        }
        if (outcome.kind === 'response-error') {
          if (signal.aborted) {
            // The original command is already settled, so a stalled cancellation
            // IPC cannot leave an in-flight response or justify blocking the caller.
            throw new AiRequestCancelledError();
          }
          throw outcome.error;
        }
        response = outcome.response;
        if (signal.aborted) {
          throw new AiRequestCancelledError();
        }
      }
      throwIfAiRequestCancelled(signal);
    } catch (error: unknown) {
      if (isAiRequestCancelled(error)) {
        throw new AiRequestCancelledError();
      }
      throw error;
    } finally {
      removeAbortListener();
    }

    return {
      text: response.text,
      raw: response.raw,
      tokenInput: response.tokenInput,
      tokenOutput: response.tokenOutput,
      tokenTotal: response.tokenTotal ?? response.totalTokens,
    };
  }

  private async generateViaFetch(
    request: AiGenerateRequest,
    options: AiGenerateOptions,
  ): Promise<AiGenerateResponse> {
    const url = buildChatCompletionsUrl(this.config.baseUrl);
    const controller = new AbortController();
    const timeoutSeconds = this.config.timeoutSeconds ?? 120;
    let abortCause: 'caller' | 'timeout' | undefined;
    const abort = (cause: 'caller' | 'timeout') => {
      if (controller.signal.aborted) return;
      abortCause = cause;
      controller.abort();
    };
    const onCallerAbort = () => abort('caller');
    options.signal?.addEventListener('abort', onCallerAbort, { once: true });
    if (options.signal?.aborted) onCallerAbort();
    const timeout = window.setTimeout(() => abort('timeout'), timeoutSeconds * 1000);

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

      const data = await response.json().catch(() => {
        throw new Error('AI 调用失败：模型服务返回了无法解析的响应。');
      });
      const text = data.choices?.[0]?.message?.content || '';

      if (!String(text).trim()) {
        throw new Error('AI 调用失败：模型返回空内容，请检查提示词、模型名称或重试。');
      }

      throwIfAiRequestCancelled(options.signal);
      return {
        text,
        raw: data,
        tokenInput: data.usage?.prompt_tokens,
        tokenOutput: data.usage?.completion_tokens,
        tokenTotal: data.usage?.total_tokens,
      };
    } catch (err: unknown) {
      if (controller.signal.aborted && abortCause === 'caller') {
        throw new AiRequestCancelledError();
      }
      if (controller.signal.aborted && abortCause === 'timeout') {
        throw new Error(`AI 调用失败：请求超时（${timeoutSeconds} 秒），请检查网络或增加超时时间。`);
      }
      if (err instanceof TypeError && String(err.message).includes('fetch')) {
        throw new Error('AI 调用失败：网络请求失败，请检查 API Base URL、网络连接或代理设置。');
      }
      throw err;
    } finally {
      window.clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onCallerAbort);
    }
  }
}
