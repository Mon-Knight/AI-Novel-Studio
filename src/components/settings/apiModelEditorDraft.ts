import type { CloudApiProvider, SavedApiModelProfile } from '../../types/ai';
import { inferApiSourceLabel } from '../../services/ai/savedApiSources';

export interface ApiSourceModelDraft {
  id?: string;
  modelName: string;
  label: string;
  maxTokens: number;
  contextTokens: number;
  expanded?: boolean;
}

export interface ApiModelEditorDraft {
  id?: string;
  sourceId?: string;
  label: string;
  provider: CloudApiProvider;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  contextTokens: number;
  timeoutSeconds: number;
  selectedModelIndex: number;
  models: ApiSourceModelDraft[];
}

export function emptySourceModelDraft(): ApiSourceModelDraft {
  return { modelName: '', label: '', maxTokens: 8000, contextTokens: 0, expanded: false };
}

export function emptyApiModelDraft(): ApiModelEditorDraft {
  return {
    label: '',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    modelName: '',
    temperature: 0.7,
    maxTokens: 8000,
    contextTokens: 0,
    timeoutSeconds: 120,
    selectedModelIndex: 0,
    models: [emptySourceModelDraft()],
  };
}

export function syncPrimaryModelFields(draft: ApiModelEditorDraft): ApiModelEditorDraft {
  const selected = draft.models[draft.selectedModelIndex] ?? draft.models[0];
  if (!selected) return draft;
  return {
    ...draft,
    id: selected.id,
    modelName: selected.modelName,
    maxTokens: selected.maxTokens,
    contextTokens: selected.contextTokens,
  };
}

export function draftFromSavedProfile(
  profile: SavedApiModelProfile,
  apiKey: string,
): ApiModelEditorDraft {
  return draftFromSourceProfiles([profile], apiKey, profile.id);
}

export function draftFromSourceProfiles(
  profiles: SavedApiModelProfile[],
  apiKey: string,
  activeId?: string,
): ApiModelEditorDraft {
  if (profiles.length === 0) return emptyApiModelDraft();
  const selectedIndex = Math.max(
    0,
    profiles.findIndex((profile) => profile.id === activeId),
  );
  const primary = profiles[selectedIndex] ?? profiles[0]!;
  return syncPrimaryModelFields({
    id: primary.id,
    sourceId: profiles.find((profile) => profile.sourceId?.trim())?.sourceId,
    label: inferApiSourceLabel(profiles, primary.baseUrl),
    provider: primary.provider,
    baseUrl: primary.baseUrl,
    apiKey,
    modelName: primary.modelName,
    temperature: primary.temperature ?? 0.7,
    maxTokens: primary.maxTokens ?? 8000,
    contextTokens: primary.contextTokens ?? 0,
    timeoutSeconds: primary.timeoutSeconds ?? 120,
    selectedModelIndex: selectedIndex,
    models: profiles.map((profile) => ({
      id: profile.id,
      modelName: profile.modelName,
      label: profile.label === profile.modelName ? '' : profile.label,
      maxTokens: profile.maxTokens ?? 8000,
      contextTokens: profile.contextTokens ?? 0,
      expanded: false,
    })),
  });
}
