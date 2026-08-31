import type {
  AiSettings,
  GatewayModelConfig,
  LocalChapterModelSettings,
  SavedGatewayModelProfile,
  SavedLocalModelProfile,
} from '../../types/ai';
import { createUniqueId } from '../../utils/uniqueId';
import { normalizedApiEndpoint } from './savedApiModels';

export function optionalModelIdentityKey(input: {
  providerId: string;
  baseUrl: string;
  modelName: string;
}): string {
  return [
    input.providerId.trim(),
    normalizedApiEndpoint(input.baseUrl),
    input.modelName.trim(),
  ].join('\0');
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function persistableSavedLocalModel(
  profile: SavedLocalModelProfile,
): SavedLocalModelProfile {
  return omitUndefined({
    id: profile.id,
    label: profile.label.trim() || profile.modelName.trim(),
    providerId: profile.providerId.trim(),
    baseUrl: profile.baseUrl.trim(),
    modelName: profile.modelName.trim(),
    timeoutSeconds: profile.timeoutSeconds,
    temperature: profile.temperature,
    topP: profile.topP,
    topK: profile.topK,
    repeatPenalty: profile.repeatPenalty,
    minTokens: profile.minTokens,
    noRepeatNgramSize: profile.noRepeatNgramSize,
    seed: profile.seed,
    allowCloudWriterFallback: profile.allowCloudWriterFallback,
    lastTestOk: profile.lastTestOk,
  });
}

export function persistableSavedGatewayModel(
  profile: SavedGatewayModelProfile,
): SavedGatewayModelProfile {
  return omitUndefined({
    id: profile.id,
    label: profile.label.trim() || profile.modelName.trim(),
    providerId: profile.providerId.trim(),
    baseUrl: profile.baseUrl.trim(),
    modelName: profile.modelName.trim(),
    timeoutSeconds: profile.timeoutSeconds,
    contextTokens: profile.contextTokens,
    maxTokens: profile.maxTokens,
    temperature: profile.temperature,
    topP: profile.topP,
    topK: profile.topK,
    repeatPenalty: profile.repeatPenalty,
    minTokens: profile.minTokens,
    noRepeatNgramSize: profile.noRepeatNgramSize,
    seed: profile.seed,
    lastTestOk: profile.lastTestOk,
  });
}

export function profileFromLocalSettings(
  local: LocalChapterModelSettings,
  id: string,
  label?: string,
): SavedLocalModelProfile | undefined {
  if (!local.baseUrl.trim() || !local.modelName.trim()) return undefined;
  return persistableSavedLocalModel({
    id,
    label: label?.trim() || local.modelName.trim(),
    providerId: local.providerId,
    baseUrl: local.baseUrl,
    modelName: local.modelName,
    timeoutSeconds: local.timeoutSeconds,
    temperature: local.temperature,
    topP: local.topP,
    topK: local.topK,
    repeatPenalty: local.repeatPenalty,
    minTokens: local.minTokens,
    noRepeatNgramSize: local.noRepeatNgramSize,
    seed: local.seed,
    allowCloudWriterFallback: local.allowCloudWriterFallback,
  });
}

export function profileFromGatewaySettings(
  gateway: GatewayModelConfig,
  id: string,
  label?: string,
): SavedGatewayModelProfile | undefined {
  if (!gateway.baseUrl.trim() || !gateway.modelName.trim()) return undefined;
  return persistableSavedGatewayModel({
    id,
    label: label?.trim() || gateway.modelName.trim(),
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
  });
}

export function upsertByIdentity<
  T extends { id: string; providerId: string; baseUrl: string; modelName: string },
>(list: T[], profile: T): T[] {
  const identity = optionalModelIdentityKey(profile);
  const index = list.findIndex(
    (item) => item.id === profile.id || optionalModelIdentityKey(item) === identity,
  );
  if (index < 0) return [...list, profile];
  const merged = { ...list[index], ...profile, id: list[index].id };
  return list.map((item, itemIndex) => (itemIndex === index ? merged : item));
}

export function createLocalModelProfile(
  input: Omit<SavedLocalModelProfile, 'id'> & { id?: string },
): SavedLocalModelProfile {
  return persistableSavedLocalModel({ ...input, id: input.id?.trim() || createUniqueId() });
}

export function createGatewayModelProfile(
  input: Omit<SavedGatewayModelProfile, 'id'> & { id?: string },
): SavedGatewayModelProfile {
  return persistableSavedGatewayModel({ ...input, id: input.id?.trim() || createUniqueId() });
}

export function applySavedLocalModel(
  settings: AiSettings,
  profile: SavedLocalModelProfile,
  apiKey: string,
): AiSettings {
  const enabled = settings.localChapterModel?.enabled === true;
  return {
    ...settings,
    activeSavedLocalModelId: profile.id,
    localChapterModel: {
      enabled,
      providerId: profile.providerId,
      baseUrl: profile.baseUrl,
      apiKey: apiKey.trim() || 'local-no-key-required',
      modelName: profile.modelName,
      timeoutSeconds: profile.timeoutSeconds,
      contextTokens: 4096,
      maxTokens: 1024,
      temperature: profile.temperature,
      topP: profile.topP,
      topK: profile.topK,
      repeatPenalty: profile.repeatPenalty,
      minTokens: profile.minTokens,
      noRepeatNgramSize: profile.noRepeatNgramSize,
      seed: profile.seed,
      allowCloudWriterFallback: profile.allowCloudWriterFallback !== false,
    },
  };
}

export function applySavedGatewayModel(
  settings: AiSettings,
  profile: SavedGatewayModelProfile,
  apiKey: string,
): AiSettings {
  const enabled = settings.gateway?.enabled === true || settings.remoteWriter?.enabled === true;
  const gateway = {
    enabled,
    providerId: profile.providerId,
    baseUrl: profile.baseUrl,
    apiKey,
    modelName: profile.modelName,
    timeoutSeconds: profile.timeoutSeconds,
    contextTokens: profile.contextTokens,
    maxTokens: profile.maxTokens,
    temperature: profile.temperature,
    topP: profile.topP,
    topK: profile.topK,
    repeatPenalty: profile.repeatPenalty,
    minTokens: profile.minTokens,
    noRepeatNgramSize: profile.noRepeatNgramSize,
    seed: profile.seed,
  };
  return {
    ...settings,
    activeSavedGatewayModelId: profile.id,
    gateway,
    remoteWriter: gateway,
  };
}
