import type {
  AiSettings,
  CloudApiProvider,
  GatewayModelConfig,
  LocalChapterModelSettings,
  SavedApiModelProfile,
  SavedGatewayModelProfile,
  SavedLocalModelProfile,
} from '../../types/ai';
import { createUniqueId } from '../../utils/uniqueId';
import {
  persistableSavedApiModel,
  profileFromActiveSettings,
  savedApiModelMatchesSettings,
  upsertSavedApiModel,
} from './savedApiModels';
import {
  optionalModelIdentityKey,
  persistableSavedGatewayModel,
  persistableSavedLocalModel,
  profileFromGatewaySettings,
  profileFromLocalSettings,
  upsertByIdentity,
} from './savedOptionalModels';
import { lsGet, lsSet } from '../database/db';
import { isTauriRuntime, tauriInvoke } from '../tauri/runtime';

const AI_SETTINGS_KEY = 'ai_novel_studio_ai_settings';
const E2E_ENABLED = import.meta.env?.VITE_AI_NOVEL_STUDIO_E2E === '1';
const REAL_PROVIDER_E2E_ENABLED =
  E2E_ENABLED && import.meta.env?.VITE_AI_NOVEL_STUDIO_REAL_E2E === '1';

export const DEFAULT_MAX_REQUESTS_PER_MINUTE = 60;

export type SessionModelCredentialScope = 'provider' | 'local_chapter_model' | 'gateway';

export interface SessionModelCredentialIdentity {
  scope: SessionModelCredentialScope;
  providerId: string;
  baseUrl: string;
  modelId: string;
}

const sessionModelCredentials = new Map<string, string>();
let nativeCredentialRestorePromise: Promise<void> | null = null;

function canonicalProviderId(providerId: string): string {
  const normalized = providerId.trim().toLowerCase();
  return normalized === 'deepseek' || normalized === 'deepseek-official'
    ? 'deepseek-official'
    : normalized;
}

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function credentialIdentityKey(identity: SessionModelCredentialIdentity): string | undefined {
  const providerId = canonicalProviderId(identity.providerId);
  const baseUrl = normalizedBaseUrl(identity.baseUrl);
  const modelId = identity.modelId.trim();
  if (!providerId || providerId === 'mock' || !baseUrl || !modelId) return undefined;
  return JSON.stringify([identity.scope, providerId, baseUrl, modelId]);
}

function rememberSessionModelApiKey(
  identity: SessionModelCredentialIdentity,
  apiKey: string,
): void {
  const key = credentialIdentityKey(identity);
  if (!key) return;
  if (apiKey.trim()) sessionModelCredentials.set(key, apiKey.trim());
  else sessionModelCredentials.delete(key);
}

export function resolveSessionModelApiKey(identity: SessionModelCredentialIdentity): string {
  const key = credentialIdentityKey(identity);
  return key ? (sessionModelCredentials.get(key) ?? '') : '';
}

function providerCredentialIdentity(settings: AiSettings): SessionModelCredentialIdentity {
  return {
    scope: 'provider',
    providerId: settings.provider,
    baseUrl: settings.baseUrl,
    modelId: settings.modelName,
  };
}

function localCredentialIdentity(
  settings: LocalChapterModelSettings,
): SessionModelCredentialIdentity {
  return {
    scope: 'local_chapter_model',
    providerId: settings.providerId,
    baseUrl: settings.baseUrl,
    modelId: settings.modelName,
  };
}

function gatewayCredentialIdentity(settings: GatewayModelConfig): SessionModelCredentialIdentity {
  return {
    scope: 'gateway',
    providerId: settings.providerId,
    baseUrl: settings.baseUrl,
    modelId: settings.modelName,
  };
}

function uniqueCredentialIdentities(
  identities: SessionModelCredentialIdentity[],
): SessionModelCredentialIdentity[] {
  const unique = new Map<string, SessionModelCredentialIdentity>();
  for (const identity of identities) {
    const key = credentialIdentityKey(identity);
    if (key && !unique.has(key)) unique.set(key, identity);
  }
  return [...unique.values()];
}

function persistedModelCredentialIdentities(
  settings: AiSettings,
): SessionModelCredentialIdentity[] {
  const identities: SessionModelCredentialIdentity[] = [];
  if (settings.runtimeMode === 'api') identities.push(providerCredentialIdentity(settings));
  if (settings.localChapterModel)
    identities.push(localCredentialIdentity(settings.localChapterModel));
  const gateway = settings.gateway ?? settings.remoteWriter;
  if (gateway) identities.push(gatewayCredentialIdentity(gateway));
  for (const profile of settings.savedApiModels ?? []) {
    identities.push({
      scope: 'provider',
      providerId: profile.provider,
      baseUrl: profile.baseUrl,
      modelId: profile.modelName,
    });
  }
  for (const profile of settings.savedLocalModels ?? []) {
    identities.push({
      scope: 'local_chapter_model',
      providerId: profile.providerId,
      baseUrl: profile.baseUrl,
      modelId: profile.modelName,
    });
  }
  for (const profile of settings.savedGatewayModels ?? []) {
    identities.push({
      scope: 'gateway',
      providerId: profile.providerId,
      baseUrl: profile.baseUrl,
      modelId: profile.modelName,
    });
  }
  return uniqueCredentialIdentities(identities);
}

async function setNativeSessionModelApiKey(
  identity: SessionModelCredentialIdentity,
  apiKey: string,
): Promise<void> {
  await tauriInvoke<void>('set_session_model_credential', {
    input: { identity, apiKey },
  });
}

export async function resolveSessionModelApiKeyAsync(
  identity: SessionModelCredentialIdentity,
): Promise<string> {
  const cached = resolveSessionModelApiKey(identity);
  if (cached || !isTauriRuntime()) return cached;
  const apiKey = await tauriInvoke<string>('resolve_session_model_credential', { identity });
  rememberSessionModelApiKey(identity, apiKey);
  return resolveSessionModelApiKey(identity);
}

export async function syncSessionModelCredentialsToNative(settings: AiSettings): Promise<void> {
  if (!isTauriRuntime()) return;
  const bindings: Array<{ identity: SessionModelCredentialIdentity; apiKey: string }> = [];
  if (settings.runtimeMode === 'api') {
    bindings.push({ identity: providerCredentialIdentity(settings), apiKey: settings.apiKey });
  }
  if (settings.localChapterModel) {
    bindings.push({
      identity: localCredentialIdentity(settings.localChapterModel),
      apiKey: settings.localChapterModel.apiKey,
    });
  }
  const gateway = settings.gateway ?? settings.remoteWriter;
  if (gateway) {
    bindings.push({ identity: gatewayCredentialIdentity(gateway), apiKey: gateway.apiKey });
  }
  await Promise.all(
    bindings.map(({ identity, apiKey }) => setNativeSessionModelApiKey(identity, apiKey)),
  );
}

export function restoreSessionModelCredentialsFromNative(): Promise<void> {
  if (!isTauriRuntime()) return Promise.resolve();
  if (!nativeCredentialRestorePromise) {
    nativeCredentialRestorePromise = Promise.resolve().then(async () => {
      const settings = getAiSettings();
      await Promise.all(
        persistedModelCredentialIdentities(settings).map((identity) =>
          resolveSessionModelApiKeyAsync(identity).then(() => undefined),
        ),
      );
    });
  }
  return nativeCredentialRestorePromise;
}

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
  maxRequestsPerMinute: DEFAULT_MAX_REQUESTS_PER_MINUTE,
  maxConcurrentAiRequests: 2,
  budgetWarningPercent: 80,
  mockMode: true,
  savedApiModels: [],
};

function normalizeNumber(val: unknown, fallback: number, min: number, max: number): number {
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

function normalizeOptionalInteger(val: unknown, min: number, max: number): number | undefined {
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
    maxTokens: Math.round(normalizeNumber(stored.maxTokens, defaults.maxTokens ?? 4000, 1, 32000)),
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

function isCloudApiProvider(value: unknown): value is CloudApiProvider {
  return value === 'deepseek' || value === 'openai_compatible';
}

function normalizeSavedApiModelProfile(stored: unknown): SavedApiModelProfile | undefined {
  if (!stored || typeof stored !== 'object') return undefined;
  const raw = stored as Partial<SavedApiModelProfile>;
  if (!isCloudApiProvider(raw.provider)) return undefined;
  const id = String(raw.id ?? '').trim();
  const baseUrl = String(raw.baseUrl ?? '').trim();
  const modelName = String(raw.modelName ?? '').trim();
  const label = String(raw.label ?? '').trim() || modelName;
  if (!id || !baseUrl || !modelName) return undefined;
  return persistableSavedApiModel({
    id,
    label,
    provider: raw.provider,
    baseUrl,
    modelName,
    temperature: normalizeNumber(raw.temperature, 0.7, 0, 2),
    maxTokens: Math.round(normalizeNumber(raw.maxTokens, 8000, 1, 200000)),
    timeoutSeconds: Math.round(normalizeNumber(raw.timeoutSeconds, 120, 1, 1800)),
    inputPricePerMillionTokens: normalizeOptionalPrice(raw.inputPricePerMillionTokens),
    outputPricePerMillionTokens: normalizeOptionalPrice(raw.outputPricePerMillionTokens),
    lastTestAt: typeof raw.lastTestAt === 'string' ? raw.lastTestAt : undefined,
    lastTestOk: typeof raw.lastTestOk === 'boolean' ? raw.lastTestOk : undefined,
  });
}

function normalizeSavedApiModels(
  stored: Partial<AiSettings>,
  merged: AiSettings,
): { savedApiModels: SavedApiModelProfile[]; activeSavedApiModelId?: string } {
  const fromStore = Array.isArray(stored.savedApiModels)
    ? stored.savedApiModels
        .map((item) => normalizeSavedApiModelProfile(item))
        .filter((item): item is SavedApiModelProfile => Boolean(item))
    : [];
  const savedApiModels =
    fromStore.length > 0
      ? fromStore.filter(
          (profile, index, list) =>
            list.findIndex(
              (item) =>
                item.id === profile.id ||
                (item.provider === profile.provider &&
                  item.baseUrl === profile.baseUrl &&
                  item.modelName === profile.modelName),
            ) === index,
        )
      : (() => {
          const seeded = profileFromActiveSettings(merged, 'legacy-cloud');
          return seeded ? [seeded] : [];
        })();
  const requestedId = String(
    stored.activeSavedApiModelId ?? merged.activeSavedApiModelId ?? '',
  ).trim();
  const matched =
    savedApiModels.find((profile) => profile.id === requestedId) ??
    savedApiModels.find((profile) => savedApiModelMatchesSettings(profile, merged));
  return {
    savedApiModels,
    activeSavedApiModelId: matched?.id,
  };
}

function uniqueOptionalProfiles<
  T extends { id: string; providerId: string; baseUrl: string; modelName: string },
>(list: T[]): T[] {
  return list.filter(
    (profile, index) =>
      list.findIndex(
        (item) =>
          item.id === profile.id ||
          optionalModelIdentityKey(item) === optionalModelIdentityKey(profile),
      ) === index,
  );
}

function normalizeSavedLocalModels(
  stored: Partial<AiSettings>,
  local: LocalChapterModelSettings | undefined,
): { savedLocalModels: SavedLocalModelProfile[]; activeSavedLocalModelId?: string } {
  const fromStore = Array.isArray(stored.savedLocalModels)
    ? stored.savedLocalModels
        .map((item) => {
          if (!item || typeof item !== 'object') return undefined;
          const raw = item as Partial<SavedLocalModelProfile>;
          const id = String(raw.id ?? '').trim();
          const baseUrl = String(raw.baseUrl ?? '').trim();
          const modelName = String(raw.modelName ?? '').trim();
          const providerId = String(raw.providerId ?? '').trim();
          if (!id || !baseUrl || !modelName || !providerId) return undefined;
          return persistableSavedLocalModel({
            id,
            label: String(raw.label ?? '').trim() || modelName,
            providerId,
            baseUrl,
            modelName,
            timeoutSeconds: normalizeNumber(raw.timeoutSeconds, 120, 1, 1800),
            temperature: normalizeNumber(raw.temperature, 0.7, 0, 2),
            topP: normalizeNumber(raw.topP, 0.8, 0, 1),
            topK: Math.round(normalizeNumber(raw.topK, 20, 0, 4096)),
            repeatPenalty: normalizeNumber(raw.repeatPenalty, 1.08, 0.01, 3),
            minTokens: normalizeOptionalInteger(raw.minTokens, 0, 1024),
            noRepeatNgramSize: normalizeOptionalInteger(raw.noRepeatNgramSize, 0, 32),
            seed: normalizeOptionalInteger(raw.seed, -2_147_483_648, 2_147_483_647),
            allowCloudWriterFallback: raw.allowCloudWriterFallback !== false,
            lastTestOk: typeof raw.lastTestOk === 'boolean' ? raw.lastTestOk : undefined,
          });
        })
        .filter((item): item is SavedLocalModelProfile => Boolean(item))
    : [];
  const savedLocalModels =
    fromStore.length > 0
      ? uniqueOptionalProfiles(fromStore)
      : local
        ? (() => {
            const seeded = profileFromLocalSettings(local, 'legacy-local');
            return seeded ? [seeded] : [];
          })()
        : [];
  const requestedId = String(stored.activeSavedLocalModelId ?? '').trim();
  const matched =
    savedLocalModels.find((profile) => profile.id === requestedId) ??
    (local
      ? savedLocalModels.find(
          (profile) => optionalModelIdentityKey(profile) === optionalModelIdentityKey(local),
        )
      : undefined);
  return { savedLocalModels, activeSavedLocalModelId: matched?.id };
}

function normalizeSavedGatewayModels(
  stored: Partial<AiSettings>,
  gateway: GatewayModelConfig | undefined,
): { savedGatewayModels: SavedGatewayModelProfile[]; activeSavedGatewayModelId?: string } {
  const fromStore = Array.isArray(stored.savedGatewayModels)
    ? stored.savedGatewayModels
        .map((item) => {
          if (!item || typeof item !== 'object') return undefined;
          const raw = item as Partial<SavedGatewayModelProfile>;
          const id = String(raw.id ?? '').trim();
          const baseUrl = String(raw.baseUrl ?? '').trim();
          const modelName = String(raw.modelName ?? '').trim();
          const providerId = String(raw.providerId ?? '').trim();
          if (!id || !baseUrl || !modelName || !providerId) return undefined;
          return persistableSavedGatewayModel({
            id,
            label: String(raw.label ?? '').trim() || modelName,
            providerId,
            baseUrl,
            modelName,
            timeoutSeconds: normalizeNumber(raw.timeoutSeconds, 120, 1, 1800),
            contextTokens: normalizeOptionalInteger(raw.contextTokens, 1024, 200000),
            maxTokens: normalizeOptionalInteger(raw.maxTokens, 1, 32000),
            temperature:
              raw.temperature === undefined
                ? undefined
                : normalizeNumber(raw.temperature, 0.7, 0, 2),
            topP: raw.topP === undefined ? undefined : normalizeNumber(raw.topP, 0.8, 0, 1),
            topK:
              raw.topK === undefined
                ? undefined
                : Math.round(normalizeNumber(raw.topK, 20, 0, 4096)),
            repeatPenalty:
              raw.repeatPenalty === undefined
                ? undefined
                : normalizeNumber(raw.repeatPenalty, 1.08, 0.01, 3),
            minTokens: normalizeOptionalInteger(raw.minTokens, 0, 8000),
            noRepeatNgramSize: normalizeOptionalInteger(raw.noRepeatNgramSize, 0, 32),
            seed: normalizeOptionalInteger(raw.seed, -2_147_483_648, 2_147_483_647),
            lastTestOk: typeof raw.lastTestOk === 'boolean' ? raw.lastTestOk : undefined,
          });
        })
        .filter((item): item is SavedGatewayModelProfile => Boolean(item))
    : [];
  const savedGatewayModels =
    fromStore.length > 0
      ? uniqueOptionalProfiles(fromStore)
      : gateway
        ? (() => {
            const seeded = profileFromGatewaySettings(gateway, 'legacy-gateway');
            return seeded ? [seeded] : [];
          })()
        : [];
  const requestedId = String(stored.activeSavedGatewayModelId ?? '').trim();
  const matched =
    savedGatewayModels.find((profile) => profile.id === requestedId) ??
    (gateway
      ? savedGatewayModels.find(
          (profile) => optionalModelIdentityKey(profile) === optionalModelIdentityKey(gateway),
        )
      : undefined);
  return { savedGatewayModels, activeSavedGatewayModelId: matched?.id };
}

function withUpsertedOptionalModels(settings: AiSettings): AiSettings {
  let next = settings;
  if (next.localChapterModel) {
    const list = next.savedLocalModels ?? [];
    const matched = list.find(
      (item) =>
        optionalModelIdentityKey(item) === optionalModelIdentityKey(next.localChapterModel!),
    );
    const profile = profileFromLocalSettings(
      next.localChapterModel,
      matched?.id ?? createUniqueId(),
      matched?.label,
    );
    if (profile) {
      const savedLocalModels = upsertByIdentity(list, profile);
      next = {
        ...next,
        savedLocalModels,
        activeSavedLocalModelId:
          savedLocalModels.find(
            (item) => optionalModelIdentityKey(item) === optionalModelIdentityKey(profile),
          )?.id ?? profile.id,
      };
    }
  }
  const gateway = next.gateway ?? next.remoteWriter;
  if (gateway) {
    const list = next.savedGatewayModels ?? [];
    const matched = list.find(
      (item) => optionalModelIdentityKey(item) === optionalModelIdentityKey(gateway),
    );
    const profile = profileFromGatewaySettings(
      gateway,
      matched?.id ?? createUniqueId(),
      matched?.label,
    );
    if (profile) {
      const savedGatewayModels = upsertByIdentity(list, profile);
      next = {
        ...next,
        savedGatewayModels,
        activeSavedGatewayModelId:
          savedGatewayModels.find(
            (item) => optionalModelIdentityKey(item) === optionalModelIdentityKey(profile),
          )?.id ?? profile.id,
      };
    }
  }
  return next;
}

function withUpsertedActiveApiModel(settings: AiSettings): AiSettings {
  const list = settings.savedApiModels ?? [];
  const matched = list.find((item) => savedApiModelMatchesSettings(item, settings));
  const profile = profileFromActiveSettings(
    settings,
    matched?.id ?? createUniqueId(),
    matched?.label,
  );
  if (!profile) {
    return {
      ...settings,
      savedApiModels: list,
    };
  }
  const savedApiModels = upsertSavedApiModel(list, profile);
  const active =
    savedApiModels.find((item) => savedApiModelMatchesSettings(item, settings)) ?? profile;
  return {
    ...settings,
    savedApiModels,
    activeSavedApiModelId: active.id,
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
    normalizeNumber(merged.maxRequestsPerMinute, DEFAULT_MAX_REQUESTS_PER_MINUTE, 1, 120),
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

  const saved = normalizeSavedApiModels(stored, merged);
  merged.savedApiModels = saved.savedApiModels;
  if (saved.activeSavedApiModelId) merged.activeSavedApiModelId = saved.activeSavedApiModelId;
  else delete merged.activeSavedApiModelId;

  const savedLocal = normalizeSavedLocalModels(stored, merged.localChapterModel);
  if (savedLocal.savedLocalModels.length > 0) {
    merged.savedLocalModels = savedLocal.savedLocalModels;
    if (savedLocal.activeSavedLocalModelId)
      merged.activeSavedLocalModelId = savedLocal.activeSavedLocalModelId;
    else delete merged.activeSavedLocalModelId;
  } else {
    delete merged.savedLocalModels;
    delete merged.activeSavedLocalModelId;
  }

  const savedGateway = normalizeSavedGatewayModels(stored, merged.gateway ?? merged.remoteWriter);
  if (savedGateway.savedGatewayModels.length > 0) {
    merged.savedGatewayModels = savedGateway.savedGatewayModels;
    if (savedGateway.activeSavedGatewayModelId) {
      merged.activeSavedGatewayModelId = savedGateway.activeSavedGatewayModelId;
    } else delete merged.activeSavedGatewayModelId;
  } else {
    delete merged.savedGatewayModels;
    delete merged.activeSavedGatewayModelId;
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
    savedApiModels: (settings.savedApiModels ?? []).map((profile) =>
      persistableSavedApiModel(profile),
    ),
    activeSavedApiModelId: settings.activeSavedApiModelId,
    ...(settings.savedLocalModels?.length
      ? {
          savedLocalModels: settings.savedLocalModels.map((profile) =>
            persistableSavedLocalModel(profile),
          ),
          activeSavedLocalModelId: settings.activeSavedLocalModelId,
        }
      : {}),
    ...(settings.savedGatewayModels?.length
      ? {
          savedGatewayModels: settings.savedGatewayModels.map((profile) =>
            persistableSavedGatewayModel(profile),
          ),
          activeSavedGatewayModelId: settings.activeSavedGatewayModelId,
        }
      : {}),
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
  const gateway = settings.gateway ?? settings.remoteWriter;
  const gatewayWithKey = gateway
    ? {
        ...gateway,
        apiKey: resolveSessionModelApiKey(gatewayCredentialIdentity(gateway)),
      }
    : undefined;

  return {
    ...settings,
    apiKey:
      settings.runtimeMode === 'api'
        ? resolveSessionModelApiKey(providerCredentialIdentity(settings))
        : '',
    ...(settings.localChapterModel
      ? {
          localChapterModel: {
            ...settings.localChapterModel,
            apiKey:
              resolveSessionModelApiKey(localCredentialIdentity(settings.localChapterModel)) ||
              'local-no-key-required',
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

export function resetSessionModelCredentialsForTests(): void {
  sessionModelCredentials.clear();
  nativeCredentialRestorePromise = null;
}

export function getAiSettings(): AiSettings {
  if (E2E_ENABLED && !REAL_PROVIDER_E2E_ENABLED) return { ...defaultSettings };
  const stored = lsGet<Partial<AiSettings>>(AI_SETTINGS_KEY);
  if (!stored) return withSessionCredentials({ ...defaultSettings });

  const normalized = normalizeAiSettings(stored);

  const hasLegacyProviderKey = Object.prototype.hasOwnProperty.call(stored, 'apiKey');
  const hasLegacyLocalKey = Object.prototype.hasOwnProperty.call(
    stored.localChapterModel ?? {},
    'apiKey',
  );
  const hasLegacyGatewayKey = Object.prototype.hasOwnProperty.call(stored.gateway ?? {}, 'apiKey');
  const hasLegacyRemoteKey = Object.prototype.hasOwnProperty.call(
    stored.remoteWriter ?? {},
    'apiKey',
  );
  if (hasLegacyProviderKey && typeof stored.apiKey === 'string') {
    rememberSessionModelApiKey(providerCredentialIdentity(normalized), stored.apiKey);
  }
  if (
    hasLegacyLocalKey &&
    normalized.localChapterModel &&
    typeof stored.localChapterModel?.apiKey === 'string'
  ) {
    rememberSessionModelApiKey(
      localCredentialIdentity(normalized.localChapterModel),
      stored.localChapterModel.apiKey,
    );
  }
  const normalizedGateway = normalized.gateway ?? normalized.remoteWriter;
  if (normalizedGateway && hasLegacyGatewayKey && typeof stored.gateway?.apiKey === 'string') {
    rememberSessionModelApiKey(gatewayCredentialIdentity(normalizedGateway), stored.gateway.apiKey);
  } else if (
    normalizedGateway &&
    hasLegacyRemoteKey &&
    typeof stored.remoteWriter?.apiKey === 'string'
  ) {
    rememberSessionModelApiKey(
      gatewayCredentialIdentity(normalizedGateway),
      stored.remoteWriter.apiKey,
    );
  }

  if (hasLegacyProviderKey || hasLegacyLocalKey || hasLegacyGatewayKey || hasLegacyRemoteKey) {
    lsSet(AI_SETTINGS_KEY, withoutCredentials(normalized));
  }
  return withSessionCredentials(normalized);
}

export function saveAiSettings(settings: AiSettings): void {
  const normalized = withUpsertedOptionalModels(
    withUpsertedActiveApiModel(normalizeAiSettings(settings)),
  );
  if (normalized.runtimeMode === 'api') {
    rememberSessionModelApiKey(providerCredentialIdentity(normalized), normalized.apiKey);
  }
  if (normalized.localChapterModel) {
    rememberSessionModelApiKey(
      localCredentialIdentity(normalized.localChapterModel),
      normalized.localChapterModel.apiKey,
    );
  }
  const gateway = normalized.gateway ?? normalized.remoteWriter;
  if (gateway) {
    rememberSessionModelApiKey(gatewayCredentialIdentity(gateway), gateway.apiKey);
  }
  lsSet(AI_SETTINGS_KEY, withoutCredentials(normalized));
}

export function maskAiApiKey(key: string): string {
  if (!key) return '';
  if (key.length < 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
