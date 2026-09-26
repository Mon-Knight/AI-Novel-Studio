import type { SavedApiModelProfile } from '../../types/ai';
import { createUniqueId } from '../../utils/uniqueId';
import {
  createSavedApiModelProfile,
  normalizedApiEndpoint,
  persistableSavedApiModel,
} from './savedApiModels';

export interface SavedApiSourceGroup {
  key: string;
  sourceId?: string;
  provider: SavedApiModelProfile['provider'];
  baseUrl: string;
  label: string;
  models: SavedApiModelProfile[];
}

export function savedApiSourceKey(
  profile: Pick<SavedApiModelProfile, 'provider' | 'baseUrl' | 'sourceId'>,
): string {
  const sourceId = profile.sourceId?.trim();
  if (sourceId) return `id:${sourceId}`;
  return `ep:${profile.provider}:${normalizedApiEndpoint(profile.baseUrl)}`;
}

export function inferApiSourceLabel(profiles: SavedApiModelProfile[], baseUrl: string): string {
  const named = profiles.map((profile) => profile.sourceLabel?.trim()).find(Boolean);
  if (named) return named;
  if (profiles.length === 1) {
    const only = profiles[0]?.label.trim();
    if (only) return only;
  }
  const shared = profiles[0]?.label.trim();
  if (shared && profiles.every((profile) => profile.label.trim() === shared)) return shared;
  try {
    const host = new URL(baseUrl).hostname.replace(/^www\./u, '').trim();
    if (host) return host;
  } catch {
    /* use fallback */
  }
  return shared || '自定义来源';
}

export function groupSavedApiModelsBySource(
  profiles: SavedApiModelProfile[],
): SavedApiSourceGroup[] {
  const groups = new Map<string, SavedApiModelProfile[]>();
  for (const profile of profiles) {
    const key = savedApiSourceKey(profile);
    const list = groups.get(key) ?? [];
    list.push(profile);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, models]) => ({
    key,
    sourceId: models.find((model) => model.sourceId?.trim())?.sourceId,
    provider: models[0]!.provider,
    baseUrl: models[0]!.baseUrl,
    label: inferApiSourceLabel(models, models[0]!.baseUrl),
    models,
  }));
}

export function primaryProfileInSource(
  group: SavedApiSourceGroup,
  activeId?: string,
): SavedApiModelProfile {
  return group.models.find((model) => model.id === activeId) ?? group.models[0]!;
}

export function replaceSavedApiSourceModels(
  list: SavedApiModelProfile[],
  sourceKey: string | undefined,
  nextModels: SavedApiModelProfile[],
): SavedApiModelProfile[] {
  const kept = sourceKey
    ? list.filter((profile) => savedApiSourceKey(profile) !== sourceKey)
    : list;
  return [...kept, ...nextModels.map((profile) => persistableSavedApiModel(profile))];
}

export function assignSourceId(sourceId?: string): string {
  return sourceId?.trim() || createUniqueId();
}

export function profilesFromSourceCatalog(input: {
  sourceId: string;
  sourceLabel: string;
  provider: SavedApiModelProfile['provider'];
  baseUrl: string;
  temperature: number;
  timeoutSeconds: number;
  previous: SavedApiModelProfile[];
  models: Array<{
    id?: string;
    modelName: string;
    label: string;
    maxTokens: number;
    contextTokens?: number;
  }>;
}): SavedApiModelProfile[] {
  return input.models
    .map((model) => {
      const modelName = model.modelName.trim();
      if (!modelName) return undefined;
      const previous =
        input.previous.find((item) => item.id && item.id === model.id) ??
        input.previous.find((item) => item.modelName.trim() === modelName);
      return createSavedApiModelProfile({
        id: previous?.id ?? model.id,
        sourceId: input.sourceId,
        sourceLabel: input.sourceLabel.trim() || undefined,
        label: model.label.trim() || modelName,
        provider: input.provider,
        baseUrl: input.baseUrl,
        modelName,
        temperature: input.temperature,
        maxTokens: model.maxTokens,
        contextTokens: model.contextTokens,
        timeoutSeconds: input.timeoutSeconds,
        inputPricePerMillionTokens: previous?.inputPricePerMillionTokens,
        outputPricePerMillionTokens: previous?.outputPricePerMillionTokens,
        lastTestAt: previous?.lastTestAt,
        lastTestOk: previous?.lastTestOk,
      });
    })
    .filter((profile): profile is SavedApiModelProfile => Boolean(profile));
}
