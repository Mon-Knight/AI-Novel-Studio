import { appLogger } from '../observability/appLogger';
/**
 * AI Novel Studio - OpenAI-Compatible real AI client.
 *
 * Tauri release builds use the Rust backend command to avoid WebView CORS
 * differences. Browser dev mode falls back to fetch with the same request body.
 */
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import type {
  AiGenerateOptions,
  AiGenerateRequest,
  AiGenerateResponse,
  AiClient,
  AiSettings,
} from '../../types/ai';
import { isTauri } from '../database/db';
import {
  AiRequestCancelledError,
  isAiRequestCancelled,
  throwIfAiRequestCancelled,
} from './aiCancellation';
import { createProviderTransportRequestId } from './providerRequestPolicy';
import {
  AI_STREAM_EVENT_NAME,
  AI_STREAM_INTERRUPTED_ERROR,
  AI_STREAM_INVALID_ERROR,
  OpenAiSseDecoder,
  emitAiStreamEvent,
} from './aiStreamProtocol';
import { aiRequestPolicyService, type AiRequestPolicyLease } from './aiRequestPolicyService';
import { attachAiUsageCost } from './aiCost';

export interface RealAiClientConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  seed?: number;
  allowTruncatedOutput?: boolean;
  timeoutSeconds?: number;
  provider?: AiSettings['provider'];
  inputPricePerMillionTokens?: number;
  outputPricePerMillionTokens?: number;
  maxRequestsPerMinute?: number;
  maxConcurrentAiRequests?: number;
  dailyTokenBudget?: number;
  dailyCostBudgetUsd?: number;
  budgetWarningPercent?: number;
  requireLoopback?: boolean;
}

interface TauriAiResponse {
  text: string;
  raw?: unknown;
  tokenInput?: number;
  tokenOutput?: number;
  tokenTotal?: number;
  totalTokens?: number;
  finishReason?: string;
}

interface TauriAiStreamEvent {
  type: 'delta' | 'usage';
  requestId: string;
  sequence?: number;
  text?: string;
  tokenInput?: number;
  tokenOutput?: number;
  tokenTotal?: number;
}

const OUTPUT_TOKEN_TRUNCATION_ERROR =
  'AI 调用失败：模型在输出 Token 上限处停止，响应内容不完整且未采纳；请缩小单次输出或提高最大输出 Token 后重试。';

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

export function isLoopbackAiBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname === 'localhost' || hostname === '::1') return true;
    const octets = hostname.split('.').map(Number);
    return (
      octets.length === 4 &&
      octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
      octets[0] === 127
    );
  } catch {
    return false;
  }
}

export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .trim();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan')
  ) {
    return true;
  }
  if (
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80:')
  ) {
    return true;
  }
  const octets = host.split('.').map(Number);
  if (
    octets.length === 4 &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
  ) {
    const [a, b] = octets;
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT / VPC)
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (Link-Local)
  }
  return false;
}

export function validateGatewayConfig(config: {
  baseUrl: string;
  apiKey: string;
  modelName: string;
}): void {
  if (!config.baseUrl?.trim()) {
    throw new Error('AI Gateway API Base URL 未配置。');
  }
  if (!config.apiKey?.trim()) {
    throw new Error('AI Gateway 必须配置鉴权 Token / API Key，不允许匿名调用。');
  }
  if (!config.modelName?.trim()) {
    throw new Error('AI Gateway 模型名称未配置。');
  }

  let url: URL;
  try {
    url = new URL(config.baseUrl.trim());
  } catch {
    throw new Error('AI Gateway API Base URL 格式无效。');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('AI Gateway URL 协议必须为 http 或 https。');
  }

  const isPrivate = isPrivateOrLoopbackHost(url.hostname);
  if (!isPrivate && url.protocol !== 'https:') {
    throw new Error('公网 AI Gateway Endpoint 必须使用 HTTPS 协议以保证通信安全。');
  }
}

export const validateRemoteWriterConfig = validateGatewayConfig;

export function requireLoopbackAiBaseUrl(baseUrl: string): void {
  if (!isLoopbackAiBaseUrl(baseUrl)) {
    throw new Error('本地章节模型 Base URL 只允许 localhost、127.0.0.0/8 或 [::1] 回环地址。');
  }
}

export function validateRealAiConfig(config: RealAiClientConfig): void {
  const missing: string[] = [];
  if (!config.baseUrl?.trim()) missing.push('API Base URL');
  if (!config.apiKey?.trim()) missing.push('API Key');
  if (!config.modelName?.trim()) missing.push('模型名称');
  if (missing.length > 0) {
    throw new Error(`当前为 API 模式，但 ${missing.join(' / ')} 未配置，请先到设置中心配置。`);
  }
  if (config.requireLoopback) requireLoopbackAiBaseUrl(config.baseUrl);

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

  if (
    config.topP !== undefined &&
    (!Number.isFinite(config.topP) || config.topP < 0 || config.topP > 1)
  ) {
    throw new Error('topP 配置不合法，请填写 0 到 1 之间的数值。');
  }
  if (
    config.topK !== undefined &&
    (!Number.isInteger(config.topK) || config.topK < 0 || config.topK > 4096)
  ) {
    throw new Error('topK 配置不合法，请填写 0 到 4096 之间的整数。');
  }
  if (
    config.repeatPenalty !== undefined &&
    (!Number.isFinite(config.repeatPenalty) ||
      config.repeatPenalty <= 0 ||
      config.repeatPenalty > 3)
  ) {
    throw new Error('repeatPenalty 配置不合法，请填写大于 0 且不超过 3 的数值。');
  }
  if (config.seed !== undefined && !Number.isInteger(config.seed)) {
    throw new Error('seed 配置不合法，请填写整数。');
  }
}

export function buildOpenAiChatRequestBody(
  config: RealAiClientConfig,
  request: AiGenerateRequest,
  stream = false,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.modelName || config.modelName.trim(),
    messages: request.messages,
    temperature: request.temperature ?? config.temperature ?? 0.7,
    max_tokens: request.maxTokens ?? config.maxTokens ?? 8000,
  };
  const topP = request.topP ?? config.topP;
  const topK = request.topK ?? config.topK;
  const repeatPenalty = request.repeatPenalty ?? config.repeatPenalty;
  const seed = request.seed ?? config.seed;
  if (topP !== undefined) body.top_p = topP;
  if (topK !== undefined) body.top_k = topK;
  if (repeatPenalty !== undefined) body.repeat_penalty = repeatPenalty;
  if (seed !== undefined) body.seed = seed;
  if (request.thinkingMode !== undefined) {
    body.thinking = { type: request.thinkingMode };
  }
  if (stream) body.stream = true;
  return body;
}

function normalizeHttpError(status: number, errorBody: string, modelName: string): Error {
  if (status === 400) {
    return new Error(
      'AI 调用失败：请求参数不合法（400 Bad Request），请检查模型名称、max_tokens 和提示词格式。',
    );
  }
  if (status === 401) {
    return new Error(
      'AI 调用失败：API Key 无效或已过期（401 Unauthorized），请检查设置中心的 API Key。',
    );
  }
  if (status === 403) {
    const lowerBody = errorBody.toLowerCase();
    if (
      lowerBody.includes('model') ||
      lowerBody.includes('permission') ||
      lowerBody.includes('access')
    ) {
      return new Error(
        `AI 调用失败：当前 API Key 无权访问模型「${modelName}」，请检查设置中心的模型名称或平台授权。`,
      );
    }
    return new Error('AI 调用失败：服务拒绝访问（403 Forbidden），请检查 API Key 权限。');
  }
  if (status === 429) {
    return new Error(
      'AI 调用失败：请求过于频繁或额度不足（429 Rate Limit），请稍后重试或检查账户额度。',
    );
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export class RealAiClient implements AiClient {
  private config: RealAiClientConfig;

  constructor(config: RealAiClientConfig) {
    this.config = config;
  }

  private policySettings(): AiSettings {
    return {
      runtimeMode: 'api',
      provider: this.config.provider === 'deepseek' ? 'deepseek' : 'openai_compatible',
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      modelName: this.config.modelName,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      timeoutSeconds: this.config.timeoutSeconds,
      inputPricePerMillionTokens: this.config.inputPricePerMillionTokens,
      outputPricePerMillionTokens: this.config.outputPricePerMillionTokens,
      maxRequestsPerMinute: this.config.maxRequestsPerMinute ?? 120,
      maxConcurrentAiRequests: this.config.maxConcurrentAiRequests ?? 8,
      dailyTokenBudget: this.config.dailyTokenBudget,
      dailyCostBudgetUsd: this.config.dailyCostBudgetUsd,
      budgetWarningPercent: this.config.budgetWarningPercent,
      mockMode: false,
    };
  }

  private async settlePolicy(
    lease: AiRequestPolicyLease,
    settings: AiSettings,
    response?: AiGenerateResponse,
  ): Promise<void> {
    await aiRequestPolicyService.settleRequest(lease, settings, response);
  }

  async generate(
    request: AiGenerateRequest,
    options: AiGenerateOptions = {},
  ): Promise<AiGenerateResponse> {
    throwIfAiRequestCancelled(options.signal);
    validateRealAiConfig(this.config);
    const governedOptions: AiGenerateOptions = {
      ...options,
      requestId: options.requestId?.trim() || createProviderTransportRequestId('ai'),
    };
    const policySettings = this.policySettings();
    const policyLease = await aiRequestPolicyService.beginRequest(
      policySettings,
      request,
      governedOptions.requestId,
    );

    if (import.meta.env?.DEV) {
      const lastUserMessage = getLastUserMessage(request);
      appLogger.info(`[RealAiClient] messages count=${request.messages.length}`);
      appLogger.info(
        `[RealAiClient] last user message includes chapterOutline=${lastUserMessage.includes('【当前章节大纲】')}`,
      );
      appLogger.info(
        `[RealAiClient] last user message includes outline checklist=${lastUserMessage.includes('【章节大纲执行清单】')}`,
      );
      appLogger.info(
        `[RealAiClient] last user message includes requiredCharacters=${lastUserMessage.includes('【本章必须直接出场角色】')}`,
      );
    }

    const useStream =
      governedOptions.stream === true || governedOptions.onStreamEvent !== undefined;
    let response: AiGenerateResponse;
    try {
      response = isTauri()
        ? useStream
          ? await this.generateStreamViaTauri(request, governedOptions, policyLease)
          : await this.generateViaTauri(request, governedOptions, policyLease)
        : useStream
          ? await this.generateStreamViaFetch(request, governedOptions)
          : await this.generateViaFetch(request, governedOptions);
    } catch (providerError) {
      try {
        await this.settlePolicy(policyLease, policySettings);
      } catch (settlementError) {
        appLogger.captureError(
          'AI_REQUEST_POLICY_SETTLEMENT_FAILED_AFTER_PROVIDER_FAILURE',
          settlementError,
          { providerFailurePreserved: true },
        );
      }
      throw providerError;
    }
    await this.settlePolicy(policyLease, policySettings, response);
    const frozenPricingSettings =
      policyLease.storage === 'sqlite'
        ? {
            ...policySettings,
            inputPricePerMillionTokens: policyLease.inputPricePerMillionTokens,
            outputPricePerMillionTokens: policyLease.outputPricePerMillionTokens,
          }
        : policySettings;
    return attachAiUsageCost(response, frozenPricingSettings);
  }

  private buildRequestBody(request: AiGenerateRequest, stream = false): Record<string, unknown> {
    return buildOpenAiChatRequestBody(this.config, request, stream);
  }

  private async generateViaTauri(
    request: AiGenerateRequest,
    options: AiGenerateOptions,
    policyLease: AiRequestPolicyLease,
  ): Promise<AiGenerateResponse> {
    const signal = options.signal;
    const requestId =
      options.requestId?.trim() || (signal ? createProviderTransportRequestId('ai') : undefined);
    const responsePromise = invoke<TauriAiResponse>('ai_chat_completion', {
      request: {
        requestId,
        baseUrl: this.config.baseUrl,
        requireLoopback: this.config.requireLoopback === true,
        apiKey: this.config.apiKey,
        modelName: request.modelName || this.config.modelName,
        messages: request.messages,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        maxTokens: request.maxTokens ?? this.config.maxTokens ?? 8000,
        topP: request.topP ?? this.config.topP,
        topK: request.topK ?? this.config.topK,
        repeatPenalty: request.repeatPenalty ?? this.config.repeatPenalty,
        seed: request.seed ?? this.config.seed,
        thinkingMode: request.thinkingMode,
        allowTruncatedOutput: this.config.allowTruncatedOutput,
        timeoutSeconds: this.config.timeoutSeconds ?? 120,
        policyLease: {
          reservationId: policyLease.id,
          ownerId: policyLease.ownerId,
          providerRequestId: policyLease.providerRequestId,
          leaseToken: policyLease.leaseToken,
        },
      },
    });
    const response = await this.awaitTauriResponse(responsePromise, signal, requestId);

    return {
      text: response.text,
      raw: response.raw,
      tokenInput: response.tokenInput,
      tokenOutput: response.tokenOutput,
      tokenTotal: response.tokenTotal ?? response.totalTokens,
      finishReason: response.finishReason,
    };
  }

  private async awaitTauriResponse(
    responsePromise: Promise<TauriAiResponse>,
    signal: AbortSignal | undefined,
    requestId: string | undefined,
  ): Promise<TauriAiResponse> {
    let removeAbortListener: () => void = () => {};
    try {
      if (!signal || !requestId) {
        const response = await responsePromise;
        throwIfAiRequestCancelled(signal);
        return response;
      }

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
              appLogger.warn(
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
          // The IPC transport failed, so wait until late results are impossible.
          await responseOutcome;
        }
        throw new AiRequestCancelledError();
      }
      if (outcome.kind === 'response-error') {
        if (signal.aborted) throw new AiRequestCancelledError();
        throw outcome.error;
      }
      if (signal.aborted) throw new AiRequestCancelledError();
      return outcome.response;
    } catch (error: unknown) {
      if (isAiRequestCancelled(error)) throw new AiRequestCancelledError();
      throw error;
    } finally {
      removeAbortListener();
    }
  }

  private async generateStreamViaTauri(
    request: AiGenerateRequest,
    options: AiGenerateOptions,
    policyLease: AiRequestPolicyLease,
  ): Promise<AiGenerateResponse> {
    const requestId = options.requestId?.trim() || createProviderTransportRequestId('ai-stream');
    let lastSequence = 0;
    let protocolError: Error | undefined;
    const unlisten = await listen<TauriAiStreamEvent>(AI_STREAM_EVENT_NAME, ({ payload }) => {
      if (payload.requestId !== requestId || protocolError) return;
      if (payload.type === 'delta') {
        if (
          typeof payload.sequence !== 'number' ||
          payload.sequence !== lastSequence + 1 ||
          typeof payload.text !== 'string'
        ) {
          protocolError = new Error(AI_STREAM_INVALID_ERROR);
          return;
        }
        lastSequence = payload.sequence;
        emitAiStreamEvent(options.onStreamEvent, {
          type: 'delta',
          requestId,
          sequence: payload.sequence,
          text: payload.text,
        });
        return;
      }
      if (payload.type === 'usage') {
        emitAiStreamEvent(options.onStreamEvent, {
          type: 'usage',
          requestId,
          tokenInput: payload.tokenInput,
          tokenOutput: payload.tokenOutput,
          tokenTotal: payload.tokenTotal,
        });
      }
    });

    emitAiStreamEvent(options.onStreamEvent, { type: 'started', requestId });
    try {
      const responsePromise = invoke<TauriAiResponse>('ai_chat_completion_stream', {
        request: {
          requestId,
          baseUrl: this.config.baseUrl,
          requireLoopback: this.config.requireLoopback === true,
          apiKey: this.config.apiKey,
          modelName: request.modelName || this.config.modelName,
          messages: request.messages,
          temperature: request.temperature ?? this.config.temperature ?? 0.7,
          maxTokens: request.maxTokens ?? this.config.maxTokens ?? 8000,
          topP: request.topP ?? this.config.topP,
          topK: request.topK ?? this.config.topK,
          repeatPenalty: request.repeatPenalty ?? this.config.repeatPenalty,
          seed: request.seed ?? this.config.seed,
          thinkingMode: request.thinkingMode,
          allowTruncatedOutput: this.config.allowTruncatedOutput,
          timeoutSeconds: this.config.timeoutSeconds ?? 120,
          policyLease: {
            reservationId: policyLease.id,
            ownerId: policyLease.ownerId,
            providerRequestId: policyLease.providerRequestId,
            leaseToken: policyLease.leaseToken,
          },
        },
      });
      const response = await this.awaitTauriResponse(responsePromise, options.signal, requestId);
      if (protocolError) throw protocolError;
      throwIfAiRequestCancelled(options.signal);
      emitAiStreamEvent(options.onStreamEvent, {
        type: 'completed',
        requestId,
        finishReason: response.finishReason,
      });
      return {
        text: response.text,
        raw: response.raw,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal ?? response.totalTokens,
        finishReason: response.finishReason,
      };
    } catch (error: unknown) {
      emitAiStreamEvent(options.onStreamEvent, {
        type: 'error',
        requestId,
        code: isAiRequestCancelled(error) ? 'AI_REQUEST_CANCELLED' : 'AI_STREAM_FAILED',
      });
      throw error;
    } finally {
      unlisten();
    }
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
    const timeout = globalThis.setTimeout(() => abort('timeout'), timeoutSeconds * 1000);

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
        throw normalizeHttpError(
          response.status,
          errorBody,
          request.modelName || this.config.modelName,
        );
      }

      const data = await response.json().catch(() => {
        throw new Error('AI 调用失败：模型服务返回了无法解析的响应。');
      });
      const firstChoice = data.choices?.[0];
      const content = firstChoice?.message?.content;

      const finishReason =
        typeof firstChoice?.finish_reason === 'string' ? firstChoice.finish_reason : undefined;
      if (finishReason === 'length' && !this.config.allowTruncatedOutput) {
        throw new Error(OUTPUT_TOKEN_TRUNCATION_ERROR);
      }
      if (typeof content !== 'string') {
        throw new Error('AI 调用失败：模型服务返回内容格式无效，请检查兼容接口或重试。');
      }
      const text = content;

      if (!text.trim()) {
        throw new Error('AI 调用失败：模型返回空内容，请检查提示词、模型名称或重试。');
      }

      throwIfAiRequestCancelled(options.signal);
      return {
        text,
        raw: data,
        tokenInput: data.usage?.prompt_tokens,
        tokenOutput: data.usage?.completion_tokens,
        tokenTotal: data.usage?.total_tokens,
        finishReason,
      };
    } catch (err: unknown) {
      if (controller.signal.aborted && abortCause === 'caller') {
        throw new AiRequestCancelledError();
      }
      if (controller.signal.aborted && abortCause === 'timeout') {
        throw new Error(
          `AI 调用失败：请求超时（${timeoutSeconds} 秒），请检查网络或增加超时时间。`,
        );
      }
      if (err instanceof TypeError && String(err.message).includes('fetch')) {
        throw new Error('AI 调用失败：网络请求失败，请检查 API Base URL、网络连接或代理设置。');
      }
      throw err;
    } finally {
      globalThis.clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  private async generateStreamViaFetch(
    request: AiGenerateRequest,
    options: AiGenerateOptions,
  ): Promise<AiGenerateResponse> {
    const url = buildChatCompletionsUrl(this.config.baseUrl);
    const requestId = options.requestId?.trim() || createProviderTransportRequestId('ai-stream');
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
    const timeout = globalThis.setTimeout(() => abort('timeout'), timeoutSeconds * 1000);
    emitAiStreamEvent(options.onStreamEvent, { type: 'started', requestId });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(this.buildRequestBody(request, true)),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw normalizeHttpError(
          response.status,
          errorBody,
          request.modelName || this.config.modelName,
        );
      }
      if (!response.body) throw new Error(AI_STREAM_INVALID_ERROR);

      const decoder = new OpenAiSseDecoder();
      const reader = response.body.getReader();
      let text = '';
      let sequence = 0;
      let sawDone = false;
      let finishReason: string | undefined;
      let tokenInput: number | undefined;
      let tokenOutput: number | undefined;
      let tokenTotal: number | undefined;

      const consumePayload = (payload: string) => {
        if (payload.trim() === '[DONE]') {
          sawDone = true;
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          throw new Error(AI_STREAM_INVALID_ERROR);
        }
        const data = asRecord(parsed);
        if (!data || data.error !== undefined) throw new Error(AI_STREAM_INVALID_ERROR);

        const choices = Array.isArray(data.choices) ? data.choices : [];
        const firstChoice = asRecord(choices[0]);
        if (firstChoice) {
          const delta = asRecord(firstChoice.delta);
          const content = delta?.content;
          if (content !== undefined && content !== null && typeof content !== 'string') {
            throw new Error(AI_STREAM_INVALID_ERROR);
          }
          if (typeof content === 'string' && content.length > 0) {
            text += content;
            sequence += 1;
            emitAiStreamEvent(options.onStreamEvent, {
              type: 'delta',
              requestId,
              sequence,
              text: content,
            });
          }
          const nextFinishReason = firstChoice.finish_reason;
          if (nextFinishReason !== undefined && nextFinishReason !== null) {
            if (typeof nextFinishReason !== 'string') throw new Error(AI_STREAM_INVALID_ERROR);
            finishReason = nextFinishReason;
            if (finishReason === 'length' && !this.config.allowTruncatedOutput) {
              throw new Error(OUTPUT_TOKEN_TRUNCATION_ERROR);
            }
          }
        }

        const usage = asRecord(data.usage);
        if (usage) {
          tokenInput = asOptionalNumber(usage.prompt_tokens);
          tokenOutput = asOptionalNumber(usage.completion_tokens);
          tokenTotal = asOptionalNumber(usage.total_tokens);
          emitAiStreamEvent(options.onStreamEvent, {
            type: 'usage',
            requestId,
            tokenInput,
            tokenOutput,
            tokenTotal,
          });
        }
      };

      try {
        for (;;) {
          throwIfAiRequestCancelled(options.signal);
          const next = await reader.read();
          if (next.done) break;
          for (const payload of decoder.push(next.value)) consumePayload(payload);
        }
        for (const payload of decoder.finish()) consumePayload(payload);
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      } finally {
        reader.releaseLock();
      }

      if (!sawDone && finishReason === undefined) throw new Error(AI_STREAM_INTERRUPTED_ERROR);
      if (!text.trim()) {
        throw new Error('AI 调用失败：模型返回空内容，请检查提示词、模型名称或重试。');
      }
      throwIfAiRequestCancelled(options.signal);
      emitAiStreamEvent(options.onStreamEvent, {
        type: 'completed',
        requestId,
        finishReason,
      });
      return {
        text,
        raw: { streamed: true, requestId, finishReason },
        tokenInput,
        tokenOutput,
        tokenTotal,
        finishReason,
      };
    } catch (error: unknown) {
      const normalized = (() => {
        if (controller.signal.aborted && abortCause === 'caller') {
          return new AiRequestCancelledError();
        }
        if (controller.signal.aborted && abortCause === 'timeout') {
          return new Error(
            `AI 调用失败：请求超时（${timeoutSeconds} 秒），请检查网络或增加超时时间。`,
          );
        }
        if (error instanceof TypeError && String(error.message).includes('fetch')) {
          return new Error('AI 调用失败：网络请求失败，请检查 API Base URL、网络连接或代理设置。');
        }
        return error;
      })();
      emitAiStreamEvent(options.onStreamEvent, {
        type: 'error',
        requestId,
        code: isAiRequestCancelled(normalized) ? 'AI_REQUEST_CANCELLED' : 'AI_STREAM_FAILED',
      });
      throw normalized;
    } finally {
      globalThis.clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onCallerAbort);
    }
  }
}
