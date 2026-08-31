import type { SavedGatewayModelProfile, SavedLocalModelProfile } from '../../types/ai';
import {
  getDefaultGatewaySettings,
  getDefaultLocalChapterModelSettings,
} from '../../services/ai/aiSettingsStore';

export interface LocalModelEditorDraft {
  id?: string;
  label: string;
  providerId: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  timeoutSeconds: number;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  seed?: number;
  allowCloudWriterFallback: boolean;
}

export interface GatewayModelEditorDraft {
  id?: string;
  label: string;
  providerId: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  timeoutSeconds: number;
  contextTokens: number;
  maxTokens: number;
  temperature: number;
}

export function emptyLocalModelDraft(): LocalModelEditorDraft {
  const defaults = getDefaultLocalChapterModelSettings();
  return {
    label: '',
    providerId: defaults.providerId,
    baseUrl: defaults.baseUrl,
    apiKey: defaults.apiKey,
    modelName: '',
    timeoutSeconds: defaults.timeoutSeconds,
    temperature: defaults.temperature,
    topP: defaults.topP,
    topK: defaults.topK,
    repeatPenalty: defaults.repeatPenalty,
    allowCloudWriterFallback: defaults.allowCloudWriterFallback !== false,
  };
}

export function draftFromLocalProfile(
  profile: SavedLocalModelProfile,
  apiKey: string,
): LocalModelEditorDraft {
  return {
    id: profile.id,
    label: profile.label,
    providerId: profile.providerId,
    baseUrl: profile.baseUrl,
    apiKey: apiKey || 'local-no-key-required',
    modelName: profile.modelName,
    timeoutSeconds: profile.timeoutSeconds,
    temperature: profile.temperature,
    topP: profile.topP,
    topK: profile.topK,
    repeatPenalty: profile.repeatPenalty,
    seed: profile.seed,
    allowCloudWriterFallback: profile.allowCloudWriterFallback !== false,
  };
}

export function emptyGatewayModelDraft(): GatewayModelEditorDraft {
  const defaults = getDefaultGatewaySettings();
  return {
    label: '',
    providerId: defaults.providerId,
    baseUrl: '',
    apiKey: '',
    modelName: '',
    timeoutSeconds: defaults.timeoutSeconds,
    contextTokens: defaults.contextTokens ?? 32000,
    maxTokens: defaults.maxTokens ?? 4000,
    temperature: defaults.temperature ?? 0.7,
  };
}

export function draftFromGatewayProfile(
  profile: SavedGatewayModelProfile,
  apiKey: string,
): GatewayModelEditorDraft {
  return {
    id: profile.id,
    label: profile.label,
    providerId: profile.providerId,
    baseUrl: profile.baseUrl,
    apiKey,
    modelName: profile.modelName,
    timeoutSeconds: profile.timeoutSeconds,
    contextTokens: profile.contextTokens ?? 32000,
    maxTokens: profile.maxTokens ?? 4000,
    temperature: profile.temperature ?? 0.7,
  };
}
