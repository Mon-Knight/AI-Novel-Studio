import type { AiSettings, CloudApiProvider, SavedApiModelProfile } from '../../types/ai';
import { createUniqueId } from '../../utils/uniqueId';

export function normalizedApiEndpoint(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function cloudApiProviderLabel(provider: CloudApiProvider): string {
  return provider === 'deepseek' ? 'DeepSeek' : 'OpenAI 兼容';
}

export function savedApiModelIdentityKey(input: {
  provider: string;
  baseUrl: string;
  modelName: string;
}): string {
  return [input.provider, normalizedApiEndpoint(input.baseUrl), input.modelName.trim()].join('\0');
}

export function savedApiModelMatchesSettings(
  profile: SavedApiModelProfile,
  settings: Pick<AiSettings, 'provider' | 'baseUrl' | 'modelName'>,
): boolean {
  return (
    savedApiModelIdentityKey(profile) ===
    savedApiModelIdentityKey({
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      modelName: settings.modelName,
    })
  );
}

function isCloudApiProvider(value: unknown): value is CloudApiProvider {
  return value === 'deepseek' || value === 'openai_compatible';
}

function clampNumber(val: unknown, fallback: number, min: number, max: number): number {
  if (val === null || val === undefined || val === '') return fallback;
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function optionalPrice(val: unknown): number | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.min(n, 1000);
}

export function persistableSavedApiModel(profile: SavedApiModelProfile): SavedApiModelProfile {
  const next: SavedApiModelProfile = {
    id: profile.id,
    label: profile.label,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    modelName: profile.modelName,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    timeoutSeconds: profile.timeoutSeconds,
    inputPricePerMillionTokens: profile.inputPricePerMillionTokens,
    outputPricePerMillionTokens: profile.outputPricePerMillionTokens,
  };
  const sourceId = profile.sourceId?.trim();
  const sourceLabel = profile.sourceLabel?.trim();
  if (sourceId) next.sourceId = sourceId;
  if (sourceLabel) next.sourceLabel = sourceLabel;
  if (typeof profile.contextTokens === 'number' && profile.contextTokens > 0) {
    next.contextTokens = Math.round(profile.contextTokens);
  }
  if (profile.lastTestAt) next.lastTestAt = profile.lastTestAt;
  if (typeof profile.lastTestOk === 'boolean') next.lastTestOk = profile.lastTestOk;
  return next;
}

export function normalizeSavedApiModelProfile(stored: unknown): SavedApiModelProfile | undefined {
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
    sourceId: raw.sourceId,
    sourceLabel: raw.sourceLabel,
    temperature: clampNumber(raw.temperature, 0.7, 0, 2),
    maxTokens: Math.round(clampNumber(raw.maxTokens, 8000, 1, 200000)),
    contextTokens: Math.round(clampNumber(raw.contextTokens, 0, 0, 2_000_000)),
    timeoutSeconds: Math.round(clampNumber(raw.timeoutSeconds, 120, 1, 1800)),
    inputPricePerMillionTokens: optionalPrice(raw.inputPricePerMillionTokens),
    outputPricePerMillionTokens: optionalPrice(raw.outputPricePerMillionTokens),
    lastTestAt: typeof raw.lastTestAt === 'string' ? raw.lastTestAt : undefined,
    lastTestOk: typeof raw.lastTestOk === 'boolean' ? raw.lastTestOk : undefined,
  });
}

export function profileFromActiveSettings(
  settings: AiSettings,
  id: string,
  label?: string,
): SavedApiModelProfile | undefined {
  if (settings.provider === 'mock') return undefined;
  const baseUrl = settings.baseUrl.trim();
  const modelName = settings.modelName.trim();
  if (!baseUrl || !modelName) return undefined;
  return persistableSavedApiModel({
    id,
    label: label?.trim() || modelName,
    provider: settings.provider,
    baseUrl,
    modelName,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    timeoutSeconds: settings.timeoutSeconds,
    inputPricePerMillionTokens: settings.inputPricePerMillionTokens,
    outputPricePerMillionTokens: settings.outputPricePerMillionTokens,
    lastTestAt: settings.lastTestAt,
    lastTestOk: settings.lastTestOk,
  });
}

export function createSavedApiModelProfile(
  input: Omit<SavedApiModelProfile, 'id'> & { id?: string },
): SavedApiModelProfile {
  return persistableSavedApiModel({
    ...input,
    id: input.id?.trim() || createUniqueId(),
    label: input.label.trim() || input.modelName.trim(),
    baseUrl: input.baseUrl.trim(),
    modelName: input.modelName.trim(),
  });
}

export function upsertSavedApiModel(
  list: SavedApiModelProfile[],
  profile: SavedApiModelProfile,
): SavedApiModelProfile[] {
  const next = persistableSavedApiModel(profile);
  const identity = savedApiModelIdentityKey(next);
  const index = list.findIndex(
    (item) => item.id === next.id || savedApiModelIdentityKey(item) === identity,
  );
  if (index < 0) return [...list, next];
  const merged = persistableSavedApiModel({ ...list[index], ...next, id: list[index].id });
  return list.map((item, itemIndex) => (itemIndex === index ? merged : item));
}

export function applySavedApiModel(
  settings: AiSettings,
  profile: SavedApiModelProfile,
  apiKey: string,
): AiSettings {
  return {
    ...settings,
    runtimeMode: 'api',
    mockMode: false,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    modelName: profile.modelName,
    apiKey,
    temperature: profile.temperature ?? settings.temperature,
    maxTokens: profile.maxTokens ?? settings.maxTokens,
    timeoutSeconds: profile.timeoutSeconds ?? settings.timeoutSeconds,
    inputPricePerMillionTokens: profile.inputPricePerMillionTokens,
    outputPricePerMillionTokens: profile.outputPricePerMillionTokens,
    lastTestAt: profile.lastTestAt,
    lastTestOk: profile.lastTestOk,
    activeSavedApiModelId: profile.id,
  };
}
