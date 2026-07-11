import type { AiGenerateRequest, AiGenerateResponse, AiClient } from '../../types/ai';
import type { AppError } from '../../types/appError';
import { computeContentSha256 } from '../../utils/contentIntegrity';

export interface ProviderResponseMetadata {
  provider?: string;
  model?: string;
  responseHash: string;
  responseLength: number;
  tokenInput?: number;
  tokenOutput?: number;
  tokenTotal?: number;
  finishReason?: string;
}

export interface ProviderAdapterResult {
  response: AiGenerateResponse;
  metadata: ProviderResponseMetadata;
}

export interface ProviderAdapter {
  execute(attemptId: string, client: AiClient, request: AiGenerateRequest, timeoutMs: number): Promise<ProviderAdapterResult>;
  cancel(attemptId: string): boolean;
}

const activeControllers = new Map<string, AbortController>();

export function normalizeProviderError(value: unknown): AppError {
  const message = value instanceof Error ? value.message : String(value || 'AI Provider 调用失败');
  const lower = message.toLowerCase();
  if ((value instanceof DOMException && value.name === 'AbortError') || lower.includes('取消')) {
    return { code: 'AI_PROVIDER_CANCELLED', message: 'AI 请求已取消', retryable: false };
  }
  if (lower.includes('timeout') || lower.includes('超时')) {
    return { code: 'AI_PROVIDER_TIMEOUT', message: 'AI Provider 请求超时', retryable: true };
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return { code: 'AI_PROVIDER_RATE_LIMITED', message: 'AI Provider 请求受限', retryable: true };
  }
  if (/\b5\d\d\b/.test(lower) || lower.includes('overload')) {
    return { code: 'AI_PROVIDER_SERVER_ERROR', message: 'AI Provider 服务暂时不可用', retryable: true };
  }
  if (lower.includes('json') || lower.includes('响应不是')) {
    return { code: 'AI_PROVIDER_MALFORMED_RESPONSE', message: 'AI Provider 响应格式无效', retryable: false };
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('网络')) {
    return { code: 'AI_PROVIDER_NETWORK_ERROR', message: 'AI Provider 网络请求失败', retryable: true };
  }
  return { code: 'AI_PROVIDER_SERVER_ERROR', message: 'AI Provider 调用失败', retryable: false };
}

export const providerAdapter: ProviderAdapter = {
  async execute(attemptId, client, request, timeoutMs) {
    const controller = new AbortController();
    activeControllers.set(attemptId, controller);
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(1, timeoutMs));
    try {
      const response = await client.generate({ ...request, signal: controller.signal });
      const text = response.text || '';
      const rawContent = response.raw === undefined ? text : JSON.stringify(response.raw);
      return {
        response,
        metadata: {
          model: request.modelName,
          responseHash: await computeContentSha256(rawContent),
          responseLength: Array.from(rawContent).length,
          tokenInput: response.tokenInput,
          tokenOutput: response.tokenOutput,
          tokenTotal: response.tokenTotal,
        },
      };
    } catch (error) {
      if (timedOut) {
        throw { code: 'AI_PROVIDER_TIMEOUT', message: 'AI Provider 请求超时', retryable: true } satisfies AppError;
      }
      throw normalizeProviderError(error);
    } finally {
      window.clearTimeout(timeout);
      activeControllers.delete(attemptId);
    }
  },

  cancel(attemptId) {
    const controller = activeControllers.get(attemptId);
    if (!controller) return false;
    controller.abort();
    return true;
  },
};
