import type { CloudApiProvider, SavedApiModelProfile } from '../../types/ai';

export interface ApiModelEditorDraft {
  id?: string;
  label: string;
  provider: CloudApiProvider;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  timeoutSeconds: number;
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
    timeoutSeconds: 120,
  };
}

export function draftFromSavedProfile(
  profile: SavedApiModelProfile,
  apiKey: string,
): ApiModelEditorDraft {
  return {
    id: profile.id,
    label: profile.label,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    apiKey,
    modelName: profile.modelName,
    temperature: profile.temperature ?? 0.7,
    maxTokens: profile.maxTokens ?? 8000,
    timeoutSeconds: profile.timeoutSeconds ?? 120,
  };
}
