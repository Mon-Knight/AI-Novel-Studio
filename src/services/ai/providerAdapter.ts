import type {
  AiGenerateOptions,
  AiGenerateRequest,
  AiGenerateResponse,
  AiPricingSnapshot,
  AiSettings,
  AiUsageCost,
} from '../../types/ai';
import type { AiTaskType } from '../../types/ai-task';
import type { RouteDecision } from '../../types/modelRuntime';
import { MockAiClient } from './mockAiClient';
import { RealAiClient, validateGatewayConfig, validateRealAiConfig } from './realAiClient';
import { calculateAiUsageCost, createAiPricingSnapshot } from './aiCost';
import { isAiRequestCancelled } from './aiCancellation';
import { aiPerformanceMonitor } from '../observability/aiPerformanceMonitor';

export interface ProviderAdapterResult {
  text: string;
  raw?: unknown;
  providerId: string;
  modelId: string;
  tokenInput?: number;
  tokenOutput?: number;
  tokenTotal?: number;
  finishReason?: string;
  usageCost?: AiUsageCost;
  durationMs: number;
}

export interface ProviderAdapter {
  readonly providerId: string;
  readonly modelId: string;
  readonly runtimeMode?: AiSettings['runtimeMode'];
  readonly pricingSnapshot?: AiPricingSnapshot;
  execute(request: AiGenerateRequest, options?: AiGenerateOptions): Promise<ProviderAdapterResult>;
}

function readFinishReason(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const choices = (raw as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return undefined;
  const value = (first as Record<string, unknown>).finish_reason;
  return typeof value === 'string' && value.length <= 128 ? value : undefined;
}

function resolveModelId(settings: AiSettings): string {
  return settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName.trim();
}

export function createProviderAdapter(
  settings: AiSettings,
  taskType?: AiTaskType,
  route?: Pick<RouteDecision, 'selected'>,
): ProviderAdapter {
  const local = settings.localChapterModel;
  const remote = settings.gateway ?? settings.remoteWriter;
  if (taskType === 'chapter_scene_generate' && !route) {
    throw new Error('chapter_scene_generate 必须携带冻结的 Model Router 决策。');
  }

  const isLocalChapterScene = route?.selected.kind === 'local';
  const isRemoteChapterScene = route?.selected.kind === 'remote';

  if (isLocalChapterScene && taskType !== 'chapter_scene_generate') {
    throw new Error('专用本地正文模型只能执行 chapter_scene_generate。');
  }
  if (isLocalChapterScene && !local?.enabled) {
    throw new Error('Model Router 选择了未启用的专用本地正文模型，已拒绝派发。');
  }

  if (isRemoteChapterScene && taskType !== 'chapter_scene_generate') {
    throw new Error('专用远程模型 / AI Gateway 只能执行 chapter_scene_generate。');
  }
  if (isRemoteChapterScene && (!remote || !remote.enabled)) {
    throw new Error('Model Router 选择了未启用的专用远程模型 / AI Gateway，已拒绝派发。');
  }
  if (isRemoteChapterScene && remote) {
    validateGatewayConfig(remote);
  }

  const effective: {
    runtimeMode: 'mock' | 'api';
    provider: AiSettings['provider'];
    baseUrl: string;
    apiKey: string;
    modelName: string;
    temperature?: number;
    maxTokens?: number;
    timeoutSeconds?: number;
    topP?: number;
    topK?: number;
    repeatPenalty?: number;
    seed?: number;
    allowTruncatedOutput?: boolean;
    requireLoopback?: boolean;
  } =
    isLocalChapterScene && local
      ? {
          runtimeMode: 'api' as const,
          provider: 'openai_compatible' as const,
          baseUrl: local.baseUrl,
          apiKey: local.apiKey || 'local-no-key-required',
          modelName: local.modelName,
          temperature: local.temperature,
          maxTokens: 1024,
          timeoutSeconds: local.timeoutSeconds,
          topP: local.topP,
          topK: local.topK,
          repeatPenalty: local.repeatPenalty,
          seed: local.seed,
          allowTruncatedOutput: true,
          requireLoopback: true,
        }
      : isRemoteChapterScene && remote
        ? {
            runtimeMode: 'api' as const,
            provider: 'openai_compatible' as const,
            baseUrl: remote.baseUrl,
            apiKey: remote.apiKey,
            modelName: remote.modelName,
            temperature: remote.temperature,
            maxTokens: remote.maxTokens ?? 4000,
            timeoutSeconds: remote.timeoutSeconds,
            topP: remote.topP,
            topK: remote.topK,
            repeatPenalty: remote.repeatPenalty,
            seed: remote.seed,
            allowTruncatedOutput: true,
            requireLoopback: false,
          }
        : {
            runtimeMode: settings.runtimeMode,
            provider: settings.provider,
            baseUrl: settings.baseUrl,
            apiKey: settings.apiKey,
            modelName: settings.modelName,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
            timeoutSeconds: settings.timeoutSeconds,
            allowTruncatedOutput: taskType === 'chapter_scene_generate',
            requireLoopback: false,
          };
  const providerId =
    isLocalChapterScene && local
      ? local.providerId.trim() || 'local_llama_cpp'
      : isRemoteChapterScene && remote
        ? remote.providerId.trim() || 'remote_openai_compatible'
        : settings.runtimeMode === 'mock'
          ? 'mock'
          : settings.provider;
  const modelId =
    isLocalChapterScene && local
      ? local.modelName.trim()
      : isRemoteChapterScene && remote
        ? remote.modelName.trim()
        : resolveModelId(settings);
  if (route) {
    const expectedKind = isLocalChapterScene
      ? 'local'
      : isRemoteChapterScene
        ? 'remote'
        : settings.runtimeMode === 'mock'
          ? 'mock'
          : 'cloud';
    const expectedEndpointId = `${expectedKind === 'local' ? 'local' : expectedKind === 'remote' ? 'remote' : 'cloud'}.${providerId}.${modelId}`;
    if (
      route.selected.endpointId !== expectedEndpointId ||
      route.selected.providerId !== providerId ||
      route.selected.modelId !== modelId ||
      route.selected.kind !== expectedKind
    ) {
      throw new Error('Model Router 选择与当前 Provider 配置不一致，已拒绝派发。');
    }
  }
  const pricingSettings = isLocalChapterScene
    ? {
        ...settings,
        runtimeMode: 'api' as const,
        provider: 'openai_compatible' as const,
        inputPricePerMillionTokens: undefined,
        outputPricePerMillionTokens: undefined,
        dailyCostBudgetUsd: undefined,
      }
    : isRemoteChapterScene
      ? {
          ...settings,
          runtimeMode: 'api' as const,
          provider: 'openai_compatible' as const,
        }
      : settings;
  const client =
    effective.runtimeMode === 'mock'
      ? new MockAiClient()
      : new RealAiClient({
          baseUrl: effective.baseUrl,
          apiKey: effective.apiKey,
          modelName: effective.modelName,
          temperature: effective.temperature,
          maxTokens: effective.maxTokens,
          topP: effective.topP,
          topK: effective.topK,
          repeatPenalty: effective.repeatPenalty,
          seed: effective.seed,
          allowTruncatedOutput: effective.allowTruncatedOutput,
          timeoutSeconds: effective.timeoutSeconds,
          provider: effective.provider,
          inputPricePerMillionTokens: pricingSettings.inputPricePerMillionTokens,
          outputPricePerMillionTokens: pricingSettings.outputPricePerMillionTokens,
          maxRequestsPerMinute: settings.maxRequestsPerMinute,
          maxConcurrentAiRequests: settings.maxConcurrentAiRequests,
          dailyTokenBudget: settings.dailyTokenBudget,
          dailyCostBudgetUsd: pricingSettings.dailyCostBudgetUsd,
          budgetWarningPercent: settings.budgetWarningPercent,
          requireLoopback: effective.requireLoopback,
        });

  if (effective.runtimeMode === 'api') {
    validateRealAiConfig({
      baseUrl: effective.baseUrl,
      apiKey: effective.apiKey,
      modelName: effective.modelName,
      temperature: effective.temperature,
      maxTokens: effective.maxTokens,
      topP: effective.topP,
      topK: effective.topK,
      repeatPenalty: effective.repeatPenalty,
      seed: effective.seed,
      allowTruncatedOutput: effective.allowTruncatedOutput,
      timeoutSeconds: effective.timeoutSeconds,
      requireLoopback: effective.requireLoopback,
    });
  }

  const pricingSnapshot = createAiPricingSnapshot(pricingSettings);

  return {
    providerId,
    modelId,
    runtimeMode: effective.runtimeMode,
    pricingSnapshot,
    async execute(
      request: AiGenerateRequest,
      options: AiGenerateOptions = {},
    ): Promise<ProviderAdapterResult> {
      const startedAt = performance.now();
      try {
        const response: AiGenerateResponse = await client.generate(request, options);
        const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
        aiPerformanceMonitor.record({
          recordedAt: new Date().toISOString(),
          providerId,
          modelId,
          taskType: request.taskType,
          outcome: 'success',
          durationMs,
          tokenTotal: response.tokenTotal,
        });
        return {
          text: response.text,
          raw: response.raw,
          providerId,
          modelId,
          tokenInput: response.tokenInput,
          tokenOutput: response.tokenOutput,
          tokenTotal: response.tokenTotal,
          finishReason: response.finishReason ?? readFinishReason(response.raw),
          usageCost:
            response.usageCost ??
            calculateAiUsageCost(pricingSnapshot, response.tokenInput, response.tokenOutput),
          durationMs,
        };
      } catch (error) {
        aiPerformanceMonitor.record({
          recordedAt: new Date().toISOString(),
          providerId,
          modelId,
          taskType: request.taskType,
          outcome: options.signal?.aborted || isAiRequestCancelled(error) ? 'cancelled' : 'failed',
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        });
        throw error;
      }
    },
  };
}
