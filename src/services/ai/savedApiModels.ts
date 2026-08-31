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
  if (profile.lastTestAt) next.lastTestAt = profile.lastTestAt;
  if (typeof profile.lastTestOk === 'boolean') next.lastTestOk = profile.lastTestOk;
  return next;
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
