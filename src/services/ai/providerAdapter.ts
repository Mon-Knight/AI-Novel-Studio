import type {
  AiGenerateOptions,
  AiGenerateRequest,
  AiGenerateResponse,
  AiSettings,
  AiUsageCost,
} from '../../types/ai';
import { MockAiClient } from './mockAiClient';
import { RealAiClient, validateRealAiConfig } from './realAiClient';
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

export function createProviderAdapter(settings: AiSettings): ProviderAdapter {
  const providerId = settings.runtimeMode === 'mock' ? 'mock' : settings.provider;
  const modelId = resolveModelId(settings);
  const client =
    settings.runtimeMode === 'mock'
      ? new MockAiClient()
      : new RealAiClient({
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          modelName: settings.modelName,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          timeoutSeconds: settings.timeoutSeconds,
          provider: settings.provider,
          inputPricePerMillionTokens: settings.inputPricePerMillionTokens,
          outputPricePerMillionTokens: settings.outputPricePerMillionTokens,
          maxRequestsPerMinute: settings.maxRequestsPerMinute,
          maxConcurrentAiRequests: settings.maxConcurrentAiRequests,
          dailyTokenBudget: settings.dailyTokenBudget,
          dailyCostBudgetUsd: settings.dailyCostBudgetUsd,
          budgetWarningPercent: settings.budgetWarningPercent,
        });

  if (settings.runtimeMode === 'api') {
    validateRealAiConfig({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      modelName: settings.modelName,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      timeoutSeconds: settings.timeoutSeconds,
    });
  }

  return {
    providerId,
    modelId,
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
            calculateAiUsageCost(
              createAiPricingSnapshot(settings),
              response.tokenInput,
              response.tokenOutput,
            ),
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
