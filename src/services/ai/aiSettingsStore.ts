import type { AiSettings, GatewayModelConfig, LocalChapterModelSettings } from '../../types/ai';
import { lsGet, lsSet } from '../database/db';

const AI_SETTINGS_KEY = 'ai_novel_studio_ai_settings';
const E2E_ENABLED = import.meta.env?.VITE_AI_NOVEL_STUDIO_E2E === '1';

interface SessionCredentials {
  providerApiKey: string;
  localChapterModelApiKey: string;
  gatewayApiKey: string;
}

let sessionCredentials: SessionCredentials = {
  providerApiKey: '',
  localChapterModelApiKey: 'local-no-key-required',
  gatewayApiKey: '',
};

export function getDefaultLocalChapterModelSettings(): LocalChapterModelSettings {
  return {
    enabled: false,
    providerId: 'local_llama_cpp',
    baseUrl: 'http://127.0.0.1:8080/v1',
    apiKey: 'local-no-key-required',
    modelName: 'qwen35-9b-novel-v3',
    timeoutSeconds: 120,
    contextTokens: 4096,
    maxTokens: 1024,
    temperature: 0.7,
    topP: 0.8,
    topK: 20,
    repeatPenalty: 1.08,
    allowCloudWriterFallback: true,
  };
}

export function getDefaultGatewaySettings(): GatewayModelConfig {
  return {
    enabled: false,
    providerId: 'ai_gateway',
    baseUrl: '',
    apiKey: '',
    modelName: '',
    timeoutSeconds: 120,
    contextTokens: 32000,
    maxTokens: 4000,
    temperature: 0.7,
    topP: 0.8,
    topK: 20,
    repeatPenalty: 1.08,
  };
}

export const getDefaultRemoteWriterSettings = getDefaultGatewaySettings;

const defaultSettings: AiSettings = {
  runtimeMode: 'mock',
  provider: 'mock',
  baseUrl: '',
  apiKey: '',
  modelName: '',
  temperature: 0.7,
  maxTokens: 8000,
  timeoutSeconds: 120,
  maxRequestsPerMinute: 12,
  maxConcurrentAiRequests: 2,
  budgetWarningPercent: 80,
  mockMode: true,
};

function normalizeNumber(
  val: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (val === null || val === undefined || val === '') return fallback;
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function normalizeOptionalPrice(val: unknown): number | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(n, 1000);
}

function normalizeOptionalBudget(val: unknown, max: number): number | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, max);
}

function normalizeOptionalInteger(
  val: unknown,
  min: number,
  max: number,
): number | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  const n = Number(val);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(Math.max(Math.round(n), min), max);
}

function normalizeLocalChapterModelSettings(
  stored: LocalChapterModelSettings | undefined,
): LocalChapterModelSettings | undefined {
  if (!stored) return undefined;
  const defaults = getDefaultLocalChapterModelSettings();
  return {
    enabled: stored.enabled === true,
    providerId: String(stored.providerId ?? defaults.providerId).trim() || defaults.providerId,
    baseUrl: String(stored.baseUrl ?? defaults.baseUrl).trim(),
    apiKey: String(stored.apiKey ?? defaults.apiKey),
    modelName: String(stored.modelName ?? defaults.modelName).trim(),
    timeoutSeconds: Math.round(
      normalizeNumber(stored.timeoutSeconds, defaults.timeoutSeconds, 1, 1800),
    ),
    // The first local scene protocol is deliberately fixed to the model's verified budget.
    contextTokens: 4096,
    maxTokens: 1024,
    temperature: normalizeNumber(stored.temperature, defaults.temperature, 0, 2),
    topP: normalizeNumber(stored.topP, defaults.topP, 0, 1),
    topK: Math.round(normalizeNumber(stored.topK, defaults.topK, 0, 4096)),
    repeatPenalty: normalizeNumber(stored.repeatPenalty, defaults.repeatPenalty, 0.01, 3),
    minTokens: normalizeOptionalInteger(stored.minTokens, 0, 1024),
    noRepeatNgramSize: normalizeOptionalInteger(stored.noRepeatNgramSize, 0, 32),
    seed: normalizeOptionalInteger(stored.seed, -2_147_483_648, 2_147_483_647),
    allowCloudWriterFallback: stored.allowCloudWriterFallback !== false,
  };
}

function normalizeGatewaySettings(
  stored: GatewayModelConfig | undefined,
): GatewayModelConfig | undefined {
  if (!stored) return undefined;
  const defaults = getDefaultGatewaySettings();
  return {
    enabled: stored.enabled === true,
    providerId: String(stored.providerId ?? defaults.providerId).trim() || defaults.providerId,
    baseUrl: String(stored.baseUrl ?? defaults.baseUrl).trim(),
    apiKey: String(stored.apiKey ?? defaults.apiKey),
    modelName: String(stored.modelName ?? defaults.modelName).trim(),
    timeoutSeconds: Math.round(
      normalizeNumber(stored.timeoutSeconds, defaults.timeoutSeconds, 1, 1800),
    ),
    contextTokens: Math.round(
      normalizeNumber(stored.contextTokens, defaults.contextTokens ?? 32000, 1024, 200000),
    ),
    maxTokens: Math.round(
      normalizeNumber(stored.maxTokens, defaults.maxTokens ?? 4000, 1, 32000),
    ),
    temperature: normalizeNumber(stored.temperature, defaults.temperature ?? 0.7, 0, 2),
    topP: normalizeNumber(stored.topP, defaults.topP ?? 0.8, 0, 1),
    topK: Math.round(normalizeNumber(stored.topK, defaults.topK ?? 20, 0, 4096)),
    repeatPenalty: normalizeNumber(stored.repeatPenalty, defaults.repeatPenalty ?? 1.08, 0.01, 3),
    minTokens: normalizeOptionalInteger(stored.minTokens, 0, 8000),
    noRepeatNgramSize: normalizeOptionalInteger(stored.noRepeatNgramSize, 0, 32),
    seed: normalizeOptionalInteger(stored.seed, -2_147_483_648, 2_147_483_647),
  };
}

export const normalizeRemoteWriterSettings = normalizeGatewaySettings;

export function normalizeAiSettings(stored: Partial<AiSettings>): AiSettings {
  const merged = { ...defaultSettings, ...stored } as AiSettings;

  if (!merged.runtimeMode) merged.runtimeMode = merged.mockMode ? 'mock' : 'api';

  merged.runtimeMode = merged.runtimeMode === 'api' ? 'api' : 'mock';
  merged.mockMode = merged.runtimeMode === 'mock';
  merged.provider =
    merged.runtimeMode === 'mock'
      ? 'mock'
      : merged.provider === 'deepseek'
        ? 'deepseek'
        : 'openai_compatible';
  merged.baseUrl = merged.baseUrl ?? '';
  merged.apiKey = merged.apiKey ?? '';
  merged.modelName = merged.modelName ?? '';
  merged.temperature = normalizeNumber(merged.temperature, 0.7, 0, 2);
  merged.maxTokens = Math.round(normalizeNumber(merged.maxTokens, 8000, 1, 200000));
  merged.timeoutSeconds = Math.round(normalizeNumber(merged.timeoutSeconds, 120, 1, 1800));
  merged.inputPricePerMillionTokens = normalizeOptionalPrice(merged.inputPricePerMillionTokens);
  merged.outputPricePerMillionTokens = normalizeOptionalPrice(merged.outputPricePerMillionTokens);
  merged.maxRequestsPerMinute = Math.round(
    normalizeNumber(merged.maxRequestsPerMinute, 12, 1, 120),
  );
  merged.maxConcurrentAiRequests = Math.round(
    normalizeNumber(merged.maxConcurrentAiRequests, 2, 1, 8),
  );
  merged.dailyTokenBudget = normalizeOptionalBudget(merged.dailyTokenBudget, 10_000_000_000);
  merged.dailyCostBudgetUsd = normalizeOptionalBudget(merged.dailyCostBudgetUsd, 1_000_000);
  merged.budgetWarningPercent = Math.round(
    normalizeNumber(merged.budgetWarningPercent, 80, 50, 99),
  );

  if (
    merged.dailyCostBudgetUsd !== undefined &&
    (merged.inputPricePerMillionTokens === undefined ||
      merged.outputPricePerMillionTokens === undefined)
  ) {
    merged.dailyCostBudgetUsd = undefined;
  }

  const localChapterModel = normalizeLocalChapterModelSettings(stored.localChapterModel);
  if (localChapterModel) merged.localChapterModel = localChapterModel;
  else delete merged.localChapterModel;

  const rawGateway = stored.gateway ?? stored.remoteWriter;
  const gateway = normalizeGatewaySettings(rawGateway);
  if (gateway) {
    merged.gateway = gateway;
    merged.remoteWriter = gateway;
  } else {
    delete merged.gateway;
    delete merged.remoteWriter;
  }

  return merged;
}

function withoutCredentials(settings: AiSettings): Record<string, unknown> {
  const local = settings.localChapterModel;
  const gateway = settings.gateway ?? settings.remoteWriter;
  return {
    runtimeMode: settings.runtimeMode,
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    modelName: settings.modelName,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    timeoutSeconds: settings.timeoutSeconds,
    inputPricePerMillionTokens: settings.inputPricePerMillionTokens,
    outputPricePerMillionTokens: settings.outputPricePerMillionTokens,
    maxRequestsPerMinute: settings.maxRequestsPerMinute,
    maxConcurrentAiRequests: settings.maxConcurrentAiRequests,
    dailyTokenBudget: settings.dailyTokenBudget,
    dailyCostBudgetUsd: settings.dailyCostBudgetUsd,
    budgetWarningPercent: settings.budgetWarningPercent,
    mockMode: settings.mockMode,
    lastTestAt: settings.lastTestAt,
    lastTestOk: settings.lastTestOk,
    lastTestMessage: settings.lastTestMessage,
    ...(local
      ? {
          localChapterModel: {
            enabled: local.enabled,
            providerId: local.providerId,
            baseUrl: local.baseUrl,
            modelName: local.modelName,
            timeoutSeconds: local.timeoutSeconds,
            contextTokens: local.contextTokens,
            maxTokens: local.maxTokens,
            temperature: local.temperature,
            topP: local.topP,
            topK: local.topK,
            repeatPenalty: local.repeatPenalty,
            minTokens: local.minTokens,
            noRepeatNgramSize: local.noRepeatNgramSize,
            seed: local.seed,
            allowCloudWriterFallback: local.allowCloudWriterFallback !== false,
          },
        }
      : {}),
    ...(gateway
      ? {
          gateway: {
            enabled: gateway.enabled,
            providerId: gateway.providerId,
            baseUrl: gateway.baseUrl,
            modelName: gateway.modelName,
            timeoutSeconds: gateway.timeoutSeconds,
            contextTokens: gateway.contextTokens,
            maxTokens: gateway.maxTokens,
            temperature: gateway.temperature,
            topP: gateway.topP,
            topK: gateway.topK,
            repeatPenalty: gateway.repeatPenalty,
            minTokens: gateway.minTokens,
            noRepeatNgramSize: gateway.noRepeatNgramSize,
            seed: gateway.seed,
          },
          remoteWriter: {
            enabled: gateway.enabled,
            providerId: gateway.providerId,
            baseUrl: gateway.baseUrl,
            modelName: gateway.modelName,
            timeoutSeconds: gateway.timeoutSeconds,
            contextTokens: gateway.contextTokens,
            maxTokens: gateway.maxTokens,
            temperature: gateway.temperature,
            topP: gateway.topP,
            topK: gateway.topK,
            repeatPenalty: gateway.repeatPenalty,
            minTokens: gateway.minTokens,
            noRepeatNgramSize: gateway.noRepeatNgramSize,
            seed: gateway.seed,
          },
        }
      : {}),
  };
}

function withSessionCredentials(settings: AiSettings): AiSettings {
  const gatewayWithKey = (settings.gateway ?? settings.remoteWriter)
    ? {
        ...(settings.gateway ?? settings.remoteWriter)!,
        apiKey: sessionCredentials.gatewayApiKey,
      }
    : undefined;

  return {
    ...settings,
    apiKey: sessionCredentials.providerApiKey,
    ...(settings.localChapterModel
      ? {
          localChapterModel: {
            ...settings.localChapterModel,
            apiKey: sessionCredentials.localChapterModelApiKey,
          },
        }
      : {}),
    ...(gatewayWithKey
      ? {
          gateway: gatewayWithKey,
          remoteWriter: gatewayWithKey,
        }
      : {}),
  };
}

export function getAiSettings(): AiSettings {
  if (E2E_ENABLED) return { ...defaultSettings };
  const stored = lsGet<Partial<AiSettings>>(AI_SETTINGS_KEY);
  if (!stored) return withSessionCredentials({ ...defaultSettings });

  const hasLegacyProviderKey = Object.prototype.hasOwnProperty.call(stored, 'apiKey');
  const hasLegacyLocalKey = Object.prototype.hasOwnProperty.call(
    stored.localChapterModel ?? {},
    'apiKey',
  );
  const hasLegacyGatewayKey = Object.prototype.hasOwnProperty.call(
    stored.gateway ?? {},
    'apiKey',
  );
  const hasLegacyRemoteKey = Object.prototype.hasOwnProperty.call(
    stored.remoteWriter ?? {},
    'apiKey',
  );
  if (hasLegacyProviderKey && typeof stored.apiKey === 'string') {
    sessionCredentials.providerApiKey = stored.apiKey;
  }
  if (hasLegacyLocalKey && typeof stored.localChapterModel?.apiKey === 'string') {
    sessionCredentials.localChapterModelApiKey = stored.localChapterModel.apiKey;
  }
  if (hasLegacyGatewayKey && typeof stored.gateway?.apiKey === 'string') {
    sessionCredentials.gatewayApiKey = stored.gateway.apiKey;
  } else if (hasLegacyRemoteKey && typeof stored.remoteWriter?.apiKey === 'string') {
    sessionCredentials.gatewayApiKey = stored.remoteWriter.apiKey;
  }

  const normalized = normalizeAiSettings(stored);
  if (hasLegacyProviderKey || hasLegacyLocalKey || hasLegacyGatewayKey || hasLegacyRemoteKey) {
    lsSet(AI_SETTINGS_KEY, withoutCredentials(normalized));
  }
  return withSessionCredentials(normalized);
}

export function saveAiSettings(settings: AiSettings): void {
  const normalized = normalizeAiSettings(settings);
  sessionCredentials = {
    providerApiKey: normalized.apiKey,
    localChapterModelApiKey:
      normalized.localChapterModel?.apiKey ?? sessionCredentials.localChapterModelApiKey,
    gatewayApiKey:
      normalized.gateway?.apiKey ??
      normalized.remoteWriter?.apiKey ??
      sessionCredentials.gatewayApiKey,
  };
  lsSet(AI_SETTINGS_KEY, withoutCredentials(normalized));
}

export function maskAiApiKey(key: string): string {
  if (!key || key.length < 8) return key;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
