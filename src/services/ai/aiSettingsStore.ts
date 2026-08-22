import type { AiSettings, LocalChapterModelSettings, RemoteWriterSettings } from '../../types/ai';
import { lsGet, lsSet } from '../database/db';

const AI_SETTINGS_KEY = 'ai_novel_studio_ai_settings';
const E2E_ENABLED = import.meta.env?.VITE_AI_NOVEL_STUDIO_E2E === '1';

interface SessionCredentials {
  providerApiKey: string;
  localChapterModelApiKey: string;
  remoteWriterApiKey: string;
}

let sessionCredentials: SessionCredentials = {
  providerApiKey: '',
  localChapterModelApiKey: 'local-no-key-required',
  remoteWriterApiKey: '',
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

export function getDefaultRemoteWriterSettings(): RemoteWriterSettings {
  return {
    enabled: false,
    providerId: 'remote_openai_compatible',
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

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}

function normalizeOptionalPrice(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.min(1_000_000, Math.max(0, numeric));
}

function normalizeOptionalBudget(value: unknown, maximum: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.min(maximum, numeric);
}

function normalizeOptionalInteger(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.round(Math.min(max, Math.max(min, numeric)));
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

function normalizeRemoteWriterSettings(
  stored: RemoteWriterSettings | undefined,
): RemoteWriterSettings | undefined {
  if (!stored) return undefined;
  const defaults = getDefaultRemoteWriterSettings();
  return {
    enabled: stored.enabled === true,
    providerId: String(stored.providerId ?? defaults.providerId).trim() || defaults.providerId,
    baseUrl: String(stored.baseUrl ?? defaults.baseUrl).trim(),
    apiKey: String(stored.apiKey ?? defaults.apiKey),
    modelName: String(stored.modelName ?? defaults.modelName).trim(),
    timeoutSeconds: Math.round(
      normalizeNumber(stored.timeoutSeconds, defaults.timeoutSeconds, 1, 1800),
    ),
    contextTokens:
      normalizeOptionalInteger(stored.contextTokens, 1024, 200000) ?? defaults.contextTokens,
    maxTokens: normalizeOptionalInteger(stored.maxTokens, 1, 32000) ?? defaults.maxTokens,
    temperature: normalizeNumber(stored.temperature, defaults.temperature ?? 0.7, 0, 2),
    topP: normalizeNumber(stored.topP, defaults.topP ?? 0.8, 0, 1),
    topK: Math.round(normalizeNumber(stored.topK, defaults.topK ?? 20, 0, 4096)),
    repeatPenalty: normalizeNumber(stored.repeatPenalty, defaults.repeatPenalty ?? 1.08, 0.01, 3),
    minTokens: normalizeOptionalInteger(stored.minTokens, 0, 8000),
    noRepeatNgramSize: normalizeOptionalInteger(stored.noRepeatNgramSize, 0, 32),
    seed: normalizeOptionalInteger(stored.seed, -2_147_483_648, 2_147_483_647),
  };
}

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

  const remoteWriter = normalizeRemoteWriterSettings(stored.remoteWriter);
  if (remoteWriter) merged.remoteWriter = remoteWriter;
  else delete merged.remoteWriter;

  return merged;
}

function withoutCredentials(settings: AiSettings): Record<string, unknown> {
  const local = settings.localChapterModel;
  const remote = settings.remoteWriter;
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
    ...(remote
      ? {
          remoteWriter: {
            enabled: remote.enabled,
            providerId: remote.providerId,
            baseUrl: remote.baseUrl,
            modelName: remote.modelName,
            timeoutSeconds: remote.timeoutSeconds,
            contextTokens: remote.contextTokens,
            maxTokens: remote.maxTokens,
            temperature: remote.temperature,
            topP: remote.topP,
            topK: remote.topK,
            repeatPenalty: remote.repeatPenalty,
            minTokens: remote.minTokens,
            noRepeatNgramSize: remote.noRepeatNgramSize,
            seed: remote.seed,
          },
        }
      : {}),
  };
}

function withSessionCredentials(settings: AiSettings): AiSettings {
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
    ...(settings.remoteWriter
      ? {
          remoteWriter: {
            ...settings.remoteWriter,
            apiKey: sessionCredentials.remoteWriterApiKey,
          },
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
  if (hasLegacyRemoteKey && typeof stored.remoteWriter?.apiKey === 'string') {
    sessionCredentials.remoteWriterApiKey = stored.remoteWriter.apiKey;
  }

  const normalized = normalizeAiSettings(stored);
  if (hasLegacyProviderKey || hasLegacyLocalKey || hasLegacyRemoteKey) {
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
    remoteWriterApiKey: normalized.remoteWriter?.apiKey ?? sessionCredentials.remoteWriterApiKey,
  };
  lsSet(AI_SETTINGS_KEY, withoutCredentials(normalized));
}

export function maskAiApiKey(key: string): string {
  if (!key || key.length < 8) return key;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
