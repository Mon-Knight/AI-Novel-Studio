import type {
  AiGenerateOptions,
  AiGenerateRequest,
  AiGenerateResponse,
  AiSettings,
} from '../../types/ai';
import { MockAiClient } from './mockAiClient';
import { RealAiClient, validateRealAiConfig } from './realAiClient';

export interface ProviderAdapterResult {
  text: string;
  raw?: unknown;
  providerId: string;
  modelId: string;
  tokenInput?: number;
  tokenOutput?: number;
  tokenTotal?: number;
  finishReason?: string;
  durationMs: number;
}

export interface ProviderAdapter {
  readonly providerId: string;
  readonly modelId: string;
  execute(
    request: AiGenerateRequest,
    options?: AiGenerateOptions,
  ): Promise<ProviderAdapterResult>;
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
  const client = settings.runtimeMode === 'mock'
    ? new MockAiClient()
    : new RealAiClient({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        modelName: settings.modelName,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        timeoutSeconds: settings.timeoutSeconds,
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
      const response: AiGenerateResponse = await client.generate(request, options);
      return {
        text: response.text,
        raw: response.raw,
        providerId,
        modelId,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
        finishReason: readFinishReason(response.raw),
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      };
    },
  };
}
